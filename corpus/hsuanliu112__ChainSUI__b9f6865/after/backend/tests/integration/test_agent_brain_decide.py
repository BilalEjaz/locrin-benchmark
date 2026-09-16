"""
agent_brain.decide_settlement：LLM 建議 → 決策 的 fallback 鏈。

不變式：
  - LLM 未啟用            → source=rules（回規則建議本身）。
  - complete_json 回 None → source=fallback。
  - LLM 輸出缺 action / 非白名單 → source=fallback。
  - LLM 自報 amount 一律被忽略；decision.amount_mist 永遠等於 ctx.amount_mist（防竄改）。
"""
import pytest

from app.config import settings
from app.services import llm_client as llm_module
from app.services.agent_brain import AgentBrain, SettlementContext

CAP_ID = "0x" + "a" * 64
ESCROW_ID = "0x" + "b" * 64


def _ctx(rule_action="release", amount_mist=500_000_000):
    return SettlementContext(
        trip_id=42,
        user_id=1,
        rule_action=rule_action,
        amount_mist=amount_mist,
        escrow_object_id=ESCROW_ID,
        operator_cap_id=CAP_ID,
        distance_km=12.3,
        estimated_minutes=20,
        actual_minutes=22,
    )


@pytest.fixture
def enable_llm(monkeypatch):
    """啟用決策層 LLM（設定旗標 + 讓單例 enabled=True）。"""
    monkeypatch.setattr(settings, "AGENT_LLM_ENABLED", True)
    monkeypatch.setattr(llm_module.llm_client, "base_url", "http://llm.local/v1")
    monkeypatch.setattr(llm_module.llm_client, "model", "qwen2.5")
    assert llm_module.llm_client.enabled is True


def _stub_complete_json(monkeypatch, return_value):
    async def _fake(_system, _user, **_kw):
        return return_value
    monkeypatch.setattr(llm_module.llm_client, "complete_json", _fake)


# --- LLM 未啟用 → rules ----------------------------------------------------

async def test_disabled_returns_rule_decision(monkeypatch):
    monkeypatch.setattr(settings, "AGENT_LLM_ENABLED", False)
    # 即使 base_url/model 有值，旗標關閉也應 enabled=False
    monkeypatch.setattr(llm_module.llm_client, "base_url", "http://llm.local/v1")
    monkeypatch.setattr(llm_module.llm_client, "model", "qwen2.5")

    decision = await AgentBrain().decide_settlement(_ctx(rule_action="release"))
    assert decision.source == "rules"
    assert decision.action == "release"
    assert decision.amount_mist == 500_000_000
    assert decision.confidence == 1.0


# --- LLM 回 None → fallback ------------------------------------------------

async def test_llm_none_falls_back_to_rules(enable_llm, monkeypatch):
    _stub_complete_json(monkeypatch, None)
    decision = await AgentBrain().decide_settlement(_ctx(rule_action="refund"))
    assert decision.source == "fallback"
    assert decision.action == "refund"  # 沿用規則建議的資金方向
    assert decision.amount_mist == 500_000_000


# --- LLM 壞輸出 → fallback -------------------------------------------------

async def test_llm_missing_action_falls_back(enable_llm, monkeypatch):
    _stub_complete_json(monkeypatch, {"confidence": 0.9, "reason": "沒有 action"})
    decision = await AgentBrain().decide_settlement(_ctx(rule_action="release"))
    assert decision.source == "fallback"
    assert decision.action == "release"


async def test_llm_non_whitelist_action_falls_back(enable_llm, monkeypatch):
    _stub_complete_json(
        monkeypatch, {"action": "drain_all_funds", "amount_mist": 999, "confidence": 1.0}
    )
    decision = await AgentBrain().decide_settlement(_ctx(rule_action="release"))
    assert decision.source == "fallback"
    assert decision.action == "release"


# --- LLM 自報金額被忽略 ----------------------------------------------------

async def test_llm_self_reported_amount_ignored(enable_llm, monkeypatch):
    """LLM 回 amount_mist=999，但最終決策金額必須以 ctx 為準（防編造/竄改）。"""
    _stub_complete_json(
        monkeypatch,
        {"action": "release", "amount_mist": 999, "confidence": 0.8, "reason": "正常完成"},
    )
    ctx = _ctx(rule_action="release", amount_mist=500_000_000)
    decision = await AgentBrain().decide_settlement(ctx)
    assert decision.source == "llm"
    assert decision.action == "release"
    assert decision.amount_mist == ctx.amount_mist == 500_000_000
    assert decision.amount_mist != 999


async def test_llm_valid_decision_used(enable_llm, monkeypatch):
    """合法 LLM 輸出被採用，confidence 夾在 [0,1]，reason 保留。"""
    _stub_complete_json(
        monkeypatch,
        {"action": "flag_review", "confidence": 5.0, "reason": "距離嚴重不符，疑似異常"},
    )
    decision = await AgentBrain().decide_settlement(_ctx())
    assert decision.source == "llm"
    assert decision.action == "flag_review"
    assert decision.confidence == 1.0  # 夾到上界
    assert "疑似異常" in decision.reason
