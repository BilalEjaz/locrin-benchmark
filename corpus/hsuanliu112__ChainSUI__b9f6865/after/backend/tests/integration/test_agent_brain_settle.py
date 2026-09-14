"""
agent_brain.settle_trip / execute_confirmed：決策 → 護欄 → 分級 → 執行 的編排。

三層不變式（見 docs/PRODUCTION_HARDENING_ROADMAP.md）：
    LLM 決策 → agent_guardrails（Python 硬邊界）→ agent_service（鏈上）。

分級：
    金額 ≤ auto_threshold_mist 且 release/refund → 自動代發（auto_executed）
    金額 >  auto_threshold_mist 或 hold_for_confirm → pending（待乘客確認），不代發
    flag_review → needs_review，不代發
護欄攔截（超額 / 動作不在白名單）→ agent_service 不被呼叫、success=False、status=failed。
絕不製造假交易 hash：代發成功的 tx_digest 來自被注入的 agent_service fake，鏈上失敗則明確 failed。
"""
from types import SimpleNamespace

import pytest

import app.services.agent_service as agent_service_module
from app.config import settings
from app.core.agent_guardrails import ACTION_BITS
from app.models.agent_decision import AgentDecisionRecord
from app.services import llm_client as llm_module
from app.services.agent_brain import AgentBrain, SettlementContext
from tests.integration.conftest import FakeResult

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
    )


def _cap(
    allowed_actions=ACTION_BITS["release_escrow"] | ACTION_BITS["refund"],
    max_spend_per_tx=1_000_000_000,
    daily_limit=5_000_000_000,
    auto_threshold_mist=1_000_000_000,
):
    return SimpleNamespace(
        cap_object_id=CAP_ID,
        user_id=1,
        revoked=False,
        allowed_actions=allowed_actions,
        max_spend_per_tx=max_spend_per_tx,
        daily_limit=daily_limit,
        auto_threshold_mist=auto_threshold_mist,
    )


class _AgentRecorder:
    """注入式 agent_service fake：記錄呼叫並回固定結果，絕不觸鏈。"""

    def __init__(self, result):
        self.result = result
        self.release_calls = []
        self.refund_calls = []

    async def release_escrow_via_agent(self, **kwargs):
        self.release_calls.append(kwargs)
        return self.result

    async def refund_escrow_via_agent(self, **kwargs):
        self.refund_calls.append(kwargs)
        return self.result

    @property
    def total_calls(self):
        return len(self.release_calls) + len(self.refund_calls)


@pytest.fixture
def enable_llm(monkeypatch):
    monkeypatch.setattr(settings, "AGENT_LLM_ENABLED", True)
    monkeypatch.setattr(llm_module.llm_client, "base_url", "http://llm.local/v1")
    monkeypatch.setattr(llm_module.llm_client, "model", "qwen2.5")


def _stub_decision(monkeypatch, action, *, amount_mist=999):
    """讓 LLM 回傳指定動作（amount 故意亂報，驗證會被忽略）。"""
    async def _fake(_system, _user, **_kw):
        return {"action": action, "amount_mist": amount_mist, "confidence": 0.9, "reason": "測試"}
    monkeypatch.setattr(llm_module.llm_client, "complete_json", _fake)


def _install_agent(monkeypatch, result):
    rec = _AgentRecorder(result)
    monkeypatch.setattr(
        agent_service_module.agent_service, "release_escrow_via_agent",
        rec.release_escrow_via_agent,
    )
    monkeypatch.setattr(
        agent_service_module.agent_service, "refund_escrow_via_agent",
        rec.refund_escrow_via_agent,
    )
    return rec


# ========================================================================
# 情境 2：分級
# ========================================================================

async def test_small_release_auto_executed(enable_llm, monkeypatch, fake_session_factory):
    """金額 ≤ 門檻 + release → 自動代發，status=auto_executed，有呼叫 release。"""
    _stub_decision(monkeypatch, "release")
    rec = _install_agent(monkeypatch, {"success": True, "transaction_hash": "0xabc"})
    cap = _cap(auto_threshold_mist=1_000_000_000)
    db = fake_session_factory([
        FakeResult(many=[cap]),  # _get_auto_threshold
        FakeResult(cap),         # _get_cap_record
    ])

    out = await AgentBrain().settle_trip(db, _ctx(rule_action="release", amount_mist=500_000_000))

    assert out["handled"] is True
    assert out["executed"] is True
    assert out["deferred"] is False
    assert out["payment_status"] == "released"
    assert out["result"]["transaction_hash"] == "0xabc"
    assert len(rec.release_calls) == 1
    assert rec.refund_calls == []
    # 已落表：status=auto_executed，tx_digest 來自 agent_service（非假造）
    (row,) = db.added
    assert row.status == "auto_executed"
    assert row.tx_digest == "0xabc"
    assert row.amount_mist == 500_000_000  # 忽略 LLM 自報的 999


async def test_large_amount_deferred_pending(enable_llm, monkeypatch, fake_session_factory):
    """金額 > 門檻 → pending_confirmation，status=pending，未呼叫 agent_service。"""
    _stub_decision(monkeypatch, "release")
    rec = _install_agent(monkeypatch, {"success": True, "transaction_hash": "0xabc"})
    cap = _cap(auto_threshold_mist=100_000_000)  # 0.1 SUI 門檻
    db = fake_session_factory([FakeResult(many=[cap])])  # 只查門檻

    out = await AgentBrain().settle_trip(db, _ctx(rule_action="release", amount_mist=500_000_000))

    assert out["handled"] is True
    assert out["executed"] is False
    assert out["deferred"] is True
    assert out["payment_status"] == "pending_confirmation"
    assert rec.total_calls == 0  # 大額不自動代發
    (row,) = db.added
    assert row.status == "pending"
    assert row.action == "release"  # pending 存規則資金方向
    assert row.tx_digest is None


async def test_flag_review_needs_review(enable_llm, monkeypatch, fake_session_factory):
    """flag_review → needs_review，未呼叫 agent_service。"""
    _stub_decision(monkeypatch, "flag_review")
    rec = _install_agent(monkeypatch, {"success": True, "transaction_hash": "0xabc"})
    cap = _cap()
    db = fake_session_factory([FakeResult(many=[cap])])

    out = await AgentBrain().settle_trip(db, _ctx(rule_action="release", amount_mist=100))

    assert out["handled"] is True
    assert out["executed"] is False
    assert out["deferred"] is True
    assert out["payment_status"] == "flagged"
    assert rec.total_calls == 0
    (row,) = db.added
    assert row.status == "needs_review"


async def test_hold_for_confirm_deferred(enable_llm, monkeypatch, fake_session_factory):
    """hold_for_confirm（即使金額小）→ pending，未代發。"""
    _stub_decision(monkeypatch, "hold_for_confirm")
    rec = _install_agent(monkeypatch, {"success": True, "transaction_hash": "0xabc"})
    cap = _cap(auto_threshold_mist=1_000_000_000)
    db = fake_session_factory([FakeResult(many=[cap])])

    out = await AgentBrain().settle_trip(db, _ctx(rule_action="release", amount_mist=100))

    assert out["deferred"] is True
    assert out["payment_status"] == "pending_confirmation"
    assert rec.total_calls == 0
    (row,) = db.added
    assert row.status == "pending"


async def test_disabled_returns_handled_false_no_record(monkeypatch, fake_session_factory):
    """LLM 未啟用 → {"handled": False}，不落表、不呼叫任何鏈上動作。"""
    monkeypatch.setattr(settings, "AGENT_LLM_ENABLED", False)
    rec = _install_agent(monkeypatch, {"success": True, "transaction_hash": "0xabc"})
    db = fake_session_factory([])  # 不應有任何查詢

    out = await AgentBrain().settle_trip(db, _ctx())

    assert out == {"handled": False}
    assert db.added == []
    assert db.commits == 0
    assert rec.total_calls == 0


async def test_small_refund_auto_executed(enable_llm, monkeypatch, fake_session_factory):
    """小額 refund → auto_executed，呼叫 refund（非 release）。"""
    _stub_decision(monkeypatch, "refund")
    rec = _install_agent(monkeypatch, {"success": True, "transaction_hash": "0xdef"})
    cap = _cap(auto_threshold_mist=1_000_000_000)
    db = fake_session_factory([FakeResult(many=[cap]), FakeResult(cap)])

    out = await AgentBrain().settle_trip(db, _ctx(rule_action="refund", amount_mist=300_000_000))

    assert out["executed"] is True
    assert out["payment_status"] == "refunded"
    assert len(rec.refund_calls) == 1
    assert rec.release_calls == []
    (row,) = db.added
    assert row.status == "auto_executed"


# ========================================================================
# 情境 3：護欄攔截（送鏈前就擋，agent_service 不被呼叫）
# ========================================================================

async def test_guardrail_over_per_tx_limit_blocks(enable_llm, monkeypatch, fake_session_factory):
    """金額 > max_spend_per_tx → 護欄拒絕、agent_service 未呼叫、success=False、status=failed。"""
    _stub_decision(monkeypatch, "release")
    rec = _install_agent(monkeypatch, {"success": True, "transaction_hash": "0xabc"})
    # 門檻高（能進自動路徑），但單筆上限低於金額 → 護欄擋
    cap = _cap(auto_threshold_mist=10_000_000_000, max_spend_per_tx=100_000_000)
    db = fake_session_factory([FakeResult(many=[cap]), FakeResult(cap)])

    out = await AgentBrain().settle_trip(db, _ctx(rule_action="release", amount_mist=500_000_000))

    assert out["handled"] is True
    assert out["executed"] is False
    assert out["payment_status"] == "failed"
    assert out["result"]["success"] is False
    assert "護欄" in out["result"]["error"]
    assert "transaction_hash" not in out["result"]  # 不得夾帶假 hash
    assert rec.total_calls == 0  # 護欄擋在 agent_service 之前
    (row,) = db.added
    assert row.status == "failed"
    assert row.tx_digest is None


async def test_guardrail_action_not_allowed_blocks(enable_llm, monkeypatch, fake_session_factory):
    """只授權 refund 卻要 release → 護欄拒絕、agent_service 未呼叫、status=failed。"""
    _stub_decision(monkeypatch, "release")
    rec = _install_agent(monkeypatch, {"success": True, "transaction_hash": "0xabc"})
    cap = _cap(allowed_actions=ACTION_BITS["refund"], auto_threshold_mist=10_000_000_000)
    db = fake_session_factory([FakeResult(many=[cap]), FakeResult(cap)])

    out = await AgentBrain().settle_trip(db, _ctx(rule_action="release", amount_mist=100_000_000))

    assert out["executed"] is False
    assert out["payment_status"] == "failed"
    assert out["result"]["success"] is False
    assert rec.total_calls == 0
    (row,) = db.added
    assert row.status == "failed"


async def test_missing_cap_blocks_before_chain(enable_llm, monkeypatch, fake_session_factory):
    """找不到有效 OperatorCap → success=False、agent_service 未呼叫、status=failed。"""
    _stub_decision(monkeypatch, "release")
    rec = _install_agent(monkeypatch, {"success": True, "transaction_hash": "0xabc"})
    cap = _cap(auto_threshold_mist=10_000_000_000)
    db = fake_session_factory([
        FakeResult(many=[cap]),  # 門檻查得到
        FakeResult(None),        # 但 _get_cap_record 查不到（例如已撤銷）
    ])

    out = await AgentBrain().settle_trip(db, _ctx(rule_action="release", amount_mist=100_000_000))

    assert out["executed"] is False
    assert out["payment_status"] == "failed"
    assert "OperatorCap" in out["result"]["error"]
    assert rec.total_calls == 0
    (row,) = db.added
    assert row.status == "failed"


# ========================================================================
# 情境 4：execute_confirmed（乘客確認 pending 後代發）
# ========================================================================

def _pending_record():
    return AgentDecisionRecord(
        trip_id=42,
        user_id=1,
        action="release",
        amount_mist=500_000_000,
        status="pending",
        reason="待確認",
        confidence=0.9,
        source="llm",
        escrow_object_id=ESCROW_ID,
        operator_cap_id=CAP_ID,
        tx_digest=None,
    )


async def test_execute_confirmed_success(monkeypatch, fake_session_factory):
    """確認後代發成功 → status=confirmed + tx_digest。"""
    rec = _install_agent(monkeypatch, {"success": True, "transaction_hash": "0xfeed"})
    cap = _cap(auto_threshold_mist=1_000_000_000)
    db = fake_session_factory([FakeResult(cap)])  # _get_cap_record
    record = _pending_record()

    result = await AgentBrain().execute_confirmed(db, record)

    assert result["success"] is True
    assert record.status == "confirmed"
    assert record.tx_digest == "0xfeed"
    assert len(rec.release_calls) == 1
    assert db.commits == 1


async def test_execute_confirmed_chain_failure(monkeypatch, fake_session_factory):
    """代發上鏈失敗 → status=failed，error 有值、tx_digest 為 None（不造假）。"""
    rec = _install_agent(monkeypatch, {"success": False, "error": "鏈上失敗: RPC down"})
    cap = _cap(auto_threshold_mist=1_000_000_000)
    db = fake_session_factory([FakeResult(cap)])
    record = _pending_record()

    result = await AgentBrain().execute_confirmed(db, record)

    assert result["success"] is False
    assert record.status == "failed"
    assert record.tx_digest is None
    assert "RPC down" in record.error
    assert len(rec.release_calls) == 1
    assert db.commits == 1
