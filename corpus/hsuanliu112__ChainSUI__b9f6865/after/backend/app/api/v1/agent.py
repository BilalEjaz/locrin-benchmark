# backend/app/api/v1/agent.py
"""
Agent API — 使用者管理 OperatorCap 委託、檢視 Agent 活動、確認大額決策

- 委託 CRUD（record / get / revoke，Phase 1）
- 委託設定（自動執行門檻 auto_threshold_mist）
- Agent 活動 feed（agent_decisions）
- 大額決策確認 / 拒絕（pending → confirmed/declined）
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_async_session
from app.core.rate_limit import rate_limit
from app.api.deps import get_current_user
from app.models.user import User
from app.models.agent_decision import AgentDecisionRecord
from app.models.delegation import OperatorDelegation
from app.services.delegation_service import DelegationService

router = APIRouter(prefix="/agent", tags=["agent"])


class RecordDelegationRequest(BaseModel):
    cap_object_id: str


class ThresholdRequest(BaseModel):
    auto_threshold_mist: int


@router.post(
    "/delegation",
    dependencies=[Depends(rate_limit(times=10, seconds=300, scope="delegation"))],
)
async def record_delegation(
    body: RecordDelegationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """回報一個您在錢包簽發的 OperatorCap（授權平台在限額/時效內代為結算）。"""
    result = await DelegationService(db).record_delegation(current_user.id, body.cap_object_id)
    if not result["success"]:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=result["error"])
    return result


@router.get("/delegation")
async def get_delegation(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """查詢您目前有效的委託 cap（沒有回 null），含額度/時效/自動門檻等明細。"""
    cap = await DelegationService(db).get_active_cap(current_user.id)
    detail = None
    if cap:
        row = (await db.execute(
            select(OperatorDelegation).where(OperatorDelegation.cap_object_id == cap)
        )).scalar_one_or_none()
        if row:
            detail = {
                "max_spend_per_tx": row.max_spend_per_tx,
                "daily_limit": row.daily_limit,
                "auto_threshold_mist": row.auto_threshold_mist,
                "allowed_actions": row.allowed_actions,
                "valid_until": row.valid_until.isoformat() if row.valid_until else None,
            }
    return {
        "active_cap_object_id": cap,
        "has_active_delegation": cap is not None,
        "delegation": detail,
    }


@router.delete("/delegation")
async def revoke_delegation(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """撤銷您的委託（DB 標記；請另在錢包簽署鏈上 revoke 以完全生效）。"""
    return await DelegationService(db).revoke(current_user.id)


@router.put("/delegation/settings")
async def update_delegation_settings(
    body: ThresholdRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """設定自動執行門檻：金額 ≤ 此值由 Agent 自動代發，> 此值需您確認。"""
    if body.auto_threshold_mist < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="門檻不可為負")
    rows = (await db.execute(
        select(OperatorDelegation).where(
            OperatorDelegation.user_id == current_user.id,
            OperatorDelegation.revoked == False,  # noqa: E712
        )
    )).scalars().all()
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="沒有有效的委託")
    for r in rows:
        r.auto_threshold_mist = body.auto_threshold_mist
    await db.commit()
    return {"success": True, "auto_threshold_mist": body.auto_threshold_mist}


def _decision_to_dict(d: AgentDecisionRecord) -> dict:
    return {
        "id": d.id,
        "trip_id": d.trip_id,
        "action": d.action,
        "amount_mist": d.amount_mist,
        "status": d.status,
        "reason": d.reason,
        "confidence": d.confidence,
        "source": d.source,
        "tx_digest": d.tx_digest,
        "error": d.error,
        "created_at": d.created_at.isoformat() if d.created_at else None,
    }


@router.get("/activities")
async def list_agent_activities(
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    status_filter: Optional[str] = Query(None, alias="status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """Agent 代理活動 feed（分頁）。可選 status 過濾（如 pending 只看待確認）。"""
    q = select(AgentDecisionRecord).where(AgentDecisionRecord.user_id == current_user.id)
    if status_filter:
        q = q.where(AgentDecisionRecord.status == status_filter)
    q = q.order_by(AgentDecisionRecord.created_at.desc()).limit(limit).offset(offset)
    rows = (await db.execute(q)).scalars().all()
    return {"activities": [_decision_to_dict(r) for r in rows]}


async def _get_pending_decision(
    db: AsyncSession, decision_id: int, user_id: int
) -> AgentDecisionRecord:
    row = (await db.execute(
        select(AgentDecisionRecord).where(
            AgentDecisionRecord.id == decision_id,
            AgentDecisionRecord.user_id == user_id,
        )
    )).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到此決策")
    if row.status != "pending":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"此決策狀態為 {row.status}，無法再次處理",
        )
    return row


@router.post("/decisions/{decision_id}/confirm")
async def confirm_decision(
    decision_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """乘客確認一筆大額 pending 決策 → 實際代發上鏈。"""
    row = await _get_pending_decision(db, decision_id, current_user.id)
    from app.services.agent_brain import agent_brain

    result = await agent_brain.execute_confirmed(db, row)
    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"代發上鏈失敗：{result.get('error')}",
        )
    return {"success": True, "tx_digest": result.get("transaction_hash"), "decision_id": decision_id}


@router.post("/decisions/{decision_id}/decline")
async def decline_decision(
    decision_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """乘客拒絕一筆 pending 決策 → 不代發，標記 declined。"""
    row = await _get_pending_decision(db, decision_id, current_user.id)
    row.status = "declined"
    await db.commit()
    return {"success": True, "decision_id": decision_id, "status": "declined"}
