"""
Agent Brain — 結算決策層（LLM 建議 → 護欄 → 鏈上）

三層不變式（見 docs/PRODUCTION_HARDENING_ROADMAP.md）：
    LLM 決策（可換模型、可失效）
      → agent_guardrails.validate_action（強型別白名單 + 額度，Python 硬邊界）
      → agent_service.*_via_agent（OperatorCap，鏈上硬邊界）

本模組只產生「結構化建議」，安全邊界永遠在 guardrails 與鏈上 cap。
fail-open：LLM 未啟用 / 逾時 / 壞輸出 → 回規則路徑（結算不被 AI 卡住），只是少了智能判斷與理由。

分級權限：
    決策金額 ≤ 委託的 auto_threshold_mist → 直接代發（auto_executed）
    決策金額 >  auto_threshold_mist        → 存 pending，推播乘客確認（confirm 後才代發）
    flag_review                            → 一律 pending（needs_review），不自動代發
"""
import logging
from dataclasses import dataclass
from typing import Any, Dict, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.agent_guardrails import (
    ACTION_BITS,
    GuardrailViolation,
    validate_action,
)
from app.models.agent_decision import AgentDecisionRecord
from app.models.delegation import OperatorDelegation
from app.services.llm_client import llm_client

logger = logging.getLogger(__name__)

# 決策動作（對外語彙）→ guardrails 動作字串
_FUND_ACTION_TO_GUARDRAIL = {
    "release": "release_escrow",
    "refund": "refund",
}
_VALID_ACTIONS = {"release", "refund", "hold_for_confirm", "flag_review"}

_SYSTEM_PROMPT = (
    "你是去中心化叫車平台的結算稽核 Agent。你只做結算決策，不做其他事。\n"
    "系統會給你一筆行程的事實摘要，以及規則引擎建議的動作（release=放款給司機 / "
    "refund=退款給乘客）。你的任務是判斷該建議是否合理，並輸出結構化決策。\n"
    "可選動作：\n"
    "  release        — 同意放款給司機（行程正常完成、或已提供服務）\n"
    "  refund         — 同意退款給乘客（行程未開始就取消、或明顯未提供服務）\n"
    "  hold_for_confirm — 動作方向正確但金額大或有疑慮，建議先讓乘客確認\n"
    "  flag_review    — 偵測到異常（時長/距離與預估嚴重不符、疑似爭議或詐騙），需人工審查，不可自動結算\n"
    "規則：金額一律沿用系統給的 amount_mist，不可自行更改或編造。理由用繁體中文一句話。\n"
    '只輸出 JSON，格式：{"action": "...", "amount_mist": <int>, "confidence": <0~1 float>, "reason": "..."}'
)


@dataclass(frozen=True)
class SettlementContext:
    """agent_brain 決策所需的行程上下文。"""

    trip_id: int
    user_id: int  # 乘客（資源擁有者）
    rule_action: str  # 規則建議：release | refund
    amount_mist: int
    escrow_object_id: str
    operator_cap_id: str
    # 供 LLM 判斷合理性的事實摘要
    distance_km: Optional[float] = None
    estimated_minutes: Optional[int] = None
    actual_minutes: Optional[int] = None
    cancelled_by: Optional[str] = None
    has_dispute: bool = False


@dataclass(frozen=True)
class AgentDecision:
    action: str  # release | refund | hold_for_confirm | flag_review
    amount_mist: int
    confidence: float
    reason: str
    source: str  # llm | rules | fallback


class AgentBrain:
    async def decide_settlement(self, ctx: SettlementContext) -> AgentDecision:
        """
        產生結算決策。LLM 未啟用或失敗時，回規則建議本身（source=rules/fallback）。
        """
        if not llm_client.enabled:
            return self._rule_decision(ctx, source="rules")

        result = await llm_client.complete_json(
            _SYSTEM_PROMPT, self._build_user_prompt(ctx)
        )
        if result is None:
            return self._rule_decision(ctx, source="fallback")

        decision = self._parse_decision(result, ctx)
        if decision is None:
            logger.info("LLM 決策輸出不合法，fallback 回規則路徑 trip=%s", ctx.trip_id)
            return self._rule_decision(ctx, source="fallback")
        return decision

    @staticmethod
    def _rule_decision(ctx: SettlementContext, *, source: str) -> AgentDecision:
        reason = (
            "行程正常完成，依規則放款給司機。"
            if ctx.rule_action == "release"
            else "行程未提供服務，依規則退款給乘客。"
        )
        return AgentDecision(
            action=ctx.rule_action,
            amount_mist=ctx.amount_mist,
            confidence=1.0,
            reason=reason,
            source=source,
        )

    @staticmethod
    def _build_user_prompt(ctx: SettlementContext) -> str:
        lines = [
            f"行程編號：{ctx.trip_id}",
            f"規則建議動作：{ctx.rule_action}",
            f"金額（MIST）：{ctx.amount_mist}",
        ]
        if ctx.distance_km is not None:
            lines.append(f"距離（公里）：{ctx.distance_km}")
        if ctx.estimated_minutes is not None:
            lines.append(f"預估時長（分）：{ctx.estimated_minutes}")
        if ctx.actual_minutes is not None:
            lines.append(f"實際時長（分）：{ctx.actual_minutes}")
        if ctx.cancelled_by:
            lines.append(f"取消方：{ctx.cancelled_by}")
        lines.append(f"是否有爭議：{'是' if ctx.has_dispute else '否'}")
        return "\n".join(lines)

    @staticmethod
    def _parse_decision(
        raw: Dict[str, Any], ctx: SettlementContext
    ) -> Optional[AgentDecision]:
        action = raw.get("action")
        if action not in _VALID_ACTIONS:
            return None
        # 金額一律以系統給的為準，忽略 LLM 自報的 amount（防編造/竄改）
        try:
            confidence = float(raw.get("confidence", 0.0))
        except (ValueError, TypeError):
            confidence = 0.0
        confidence = max(0.0, min(1.0, confidence))
        reason = str(raw.get("reason") or "").strip() or "（模型未提供理由）"
        return AgentDecision(
            action=action,
            amount_mist=ctx.amount_mist,
            confidence=confidence,
            reason=reason[:500],
            source="llm",
        )

    async def settle_trip(
        self,
        db: AsyncSession,
        ctx: SettlementContext,
    ) -> Dict[str, Any]:
        """
        決策 → 護欄 → 分級 → 執行/延後 的完整編排，並落 agent_decisions 表。

        回傳：
          handled=False → LLM 未啟用，呼叫端應走自己的規則結算路徑（行為與導入前相同）。
          handled=True  → 已由 brain 處理，帶：
            executed（是否已代發上鏈）、deferred（是否 pending 待確認）、
            result（agent_service 結果，executed 時有）、decision_id、decision、payment_status。
        """
        if not llm_client.enabled:
            return {"handled": False}

        decision = await self.decide_settlement(ctx)

        # 取委託的自動門檻（找不到用預設 1 SUI）
        threshold = await self._get_auto_threshold(db, ctx.user_id)

        # flag_review：一律不自動結算
        if decision.action == "flag_review":
            record = await self._record(
                db, ctx, decision, status="needs_review", tx_digest=None
            )
            await self._notify(ctx.user_id, "needs_review", ctx, decision, record.id)
            return {
                "handled": True,
                "executed": False,
                "deferred": True,
                "decision_id": record.id,
                "decision": decision,
                "payment_status": "flagged",
            }

        # hold_for_confirm，或金額超過自動門檻 → pending 待乘客確認
        needs_confirm = decision.action == "hold_for_confirm" or ctx.amount_mist > threshold
        if needs_confirm:
            # 存 pending 時，動作以規則建議的資金方向為準（hold 只是「需確認」的訊號）
            record = await self._record(
                db, ctx, decision, status="pending", tx_digest=None,
                effective_action=ctx.rule_action,
            )
            await self._notify(ctx.user_id, "pending", ctx, decision, record.id)
            logger.info(
                "🤖 大額/待確認決策 trip=%s 金額=%s > 門檻=%s，存 pending",
                ctx.trip_id, ctx.amount_mist, threshold,
            )
            return {
                "handled": True,
                "executed": False,
                "deferred": True,
                "decision_id": record.id,
                "decision": decision,
                "payment_status": "pending_confirmation",
            }

        # 資金方向防護：LLM 只能「確認規則方向」或「升級為需確認/審查」，
        # 不能把 release 翻成 refund（或反向）改變收款方。方向不符 → 一律升級為 needs_review，
        # 絕不自動代發被竄改方向的資金動作（防 prompt injection 改變資金流向）。
        if decision.action != ctx.rule_action:
            logger.warning(
                "🛑 LLM 決策方向(%s)與規則(%s)不符 trip=%s，升級為 needs_review 不自動代發",
                decision.action, ctx.rule_action, ctx.trip_id,
            )
            record = await self._record(
                db, ctx, decision, status="needs_review", tx_digest=None,
                effective_action=ctx.rule_action,
            )
            await self._notify(ctx.user_id, "needs_review", ctx, decision, record.id)
            return {
                "handled": True,
                "executed": False,
                "deferred": True,
                "decision_id": record.id,
                "decision": decision,
                "payment_status": "flagged",
            }

        # 小額且方向與規則一致 → 過護欄後自動代發（動作固定用 rule_action）
        result = await self._execute_fund_action(db, ctx, ctx.rule_action)
        status = "auto_executed" if result.get("success") else "failed"
        record = await self._record(
            db, ctx, decision, status=status,
            tx_digest=result.get("transaction_hash"),
            effective_action=ctx.rule_action,
            error=None if result.get("success") else result.get("error"),
        )
        await self._notify(
            ctx.user_id,
            "executed" if result.get("success") else "failed",
            ctx, decision, record.id, tx_digest=result.get("transaction_hash"),
        )
        return {
            "handled": True,
            "executed": bool(result.get("success")),
            "deferred": False,
            "result": result,
            "decision_id": record.id,
            "decision": decision,
            "payment_status": (
                ("refunded" if decision.action == "refund" else "released")
                if result.get("success") else "failed"
            ),
        }

    async def execute_confirmed(
        self, db: AsyncSession, record: AgentDecisionRecord
    ) -> Dict[str, Any]:
        """乘客確認 pending 決策後，實際代發上鏈。"""
        action = record.action  # release | refund（存 pending 時已寫入資金方向）
        ctx = SettlementContext(
            trip_id=record.trip_id,
            user_id=record.user_id,
            rule_action=action,
            amount_mist=record.amount_mist,
            escrow_object_id=record.escrow_object_id,
            operator_cap_id=record.operator_cap_id,
        )
        result = await self._execute_fund_action(db, ctx, action)
        record.status = "confirmed" if result.get("success") else "failed"
        record.tx_digest = result.get("transaction_hash")
        if not result.get("success"):
            record.error = result.get("error")
        await db.commit()
        return result

    async def _execute_fund_action(
        self, db: AsyncSession, ctx: SettlementContext, action: str
    ) -> Dict[str, Any]:
        """過 guardrails 後呼叫 agent_service 代發。"""
        from app.services.agent_service import agent_service

        cap = await self._get_cap_record(db, ctx.user_id, ctx.operator_cap_id)
        if not cap:
            return {"success": False, "error": "找不到有效的 OperatorCap 委託"}

        daily_remaining = self._daily_remaining(cap)
        try:
            validated = validate_action(
                {
                    "action": _FUND_ACTION_TO_GUARDRAIL[action],
                    "operator_cap_id": ctx.operator_cap_id,
                    "escrow_object_id": ctx.escrow_object_id,
                    "amount_mist": ctx.amount_mist,
                    "trip_id": ctx.trip_id,
                },
                allowed_actions_mask=cap.allowed_actions or 0,
                max_spend_per_tx=cap.max_spend_per_tx or 0,
                daily_remaining=daily_remaining,
                caller_user_id=ctx.user_id,
                resource_owner_user_id=ctx.user_id,
            )
        except GuardrailViolation as e:
            logger.warning("護欄拒絕 Agent 動作 trip=%s：%s", ctx.trip_id, e)
            return {"success": False, "error": f"護欄拒絕：{e}"}

        if validated.action == "release_escrow":
            return await agent_service.release_escrow_via_agent(
                escrow_object_id=validated.escrow_object_id,
                operator_cap_id=validated.operator_cap_id,
                trip_id=validated.trip_id,
            )
        return await agent_service.refund_escrow_via_agent(
            escrow_object_id=validated.escrow_object_id,
            operator_cap_id=validated.operator_cap_id,
        )

    async def _record(
        self,
        db: AsyncSession,
        ctx: SettlementContext,
        decision: AgentDecision,
        *,
        status: str,
        tx_digest: Optional[str],
        effective_action: Optional[str] = None,
        error: Optional[str] = None,
    ) -> AgentDecisionRecord:
        record = AgentDecisionRecord(
            trip_id=ctx.trip_id,
            user_id=ctx.user_id,
            action=effective_action or decision.action,
            amount_mist=ctx.amount_mist,
            status=status,
            reason=decision.reason,
            confidence=decision.confidence,
            source=decision.source,
            escrow_object_id=ctx.escrow_object_id,
            operator_cap_id=ctx.operator_cap_id,
            tx_digest=tx_digest,
            error=error,
        )
        db.add(record)
        await db.commit()
        await db.refresh(record)
        return record

    @staticmethod
    async def _notify(
        user_id: int,
        kind: str,
        ctx: SettlementContext,
        decision: AgentDecision,
        decision_id: int,
        *,
        tx_digest: Optional[str] = None,
    ) -> None:
        """透過既有 WebSocket 通知乘客 Agent 決策（best-effort）。"""
        try:
            from app.websocket.dependencies import get_notifier

            notifier = get_notifier()
            if not notifier:
                return
            await notifier.notify_agent_decision(
                user_id,
                {
                    "decision_id": decision_id,
                    "trip_id": ctx.trip_id,
                    "kind": kind,  # executed | pending | needs_review | failed
                    "action": decision.action,
                    "amount_mist": ctx.amount_mist,
                    "reason": decision.reason,
                    "tx_digest": tx_digest,
                },
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("Agent 決策通知失敗（不影響結算）：%s", e)

    @staticmethod
    async def _get_auto_threshold(db: AsyncSession, user_id: int) -> int:
        cap = (await db.execute(
            select(OperatorDelegation)
            .where(
                OperatorDelegation.user_id == user_id,
                OperatorDelegation.revoked == False,  # noqa: E712
            )
            .order_by(OperatorDelegation.created_at.desc())
        )).scalars().first()
        if cap and cap.auto_threshold_mist is not None:
            return cap.auto_threshold_mist
        return 1_000_000_000  # 預設 1 SUI

    @staticmethod
    async def _get_cap_record(
        db: AsyncSession, user_id: int, cap_object_id: str
    ) -> Optional[OperatorDelegation]:
        return (await db.execute(
            select(OperatorDelegation).where(
                OperatorDelegation.user_id == user_id,
                OperatorDelegation.cap_object_id == cap_object_id,
                OperatorDelegation.revoked == False,  # noqa: E712
            )
        )).scalar_one_or_none()

    @staticmethod
    def _daily_remaining(cap: OperatorDelegation) -> int:
        """
        每日剩餘額度。鏈上 cap 才是最終邊界（spent_today 由合約 authorize_action 追蹤），
        後端這裡以 daily_limit 為保守上界；真正的逐筆扣減仍由鏈上把關。
        """
        return cap.daily_limit if cap.daily_limit is not None else 0


# 全域單例
agent_brain = AgentBrain()
