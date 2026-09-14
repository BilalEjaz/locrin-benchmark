# backend/app/api/v1/agent.py
"""
Agent 委託 API — 使用者管理其 OperatorCap 授權（Phase 1）
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_async_session
from app.core.rate_limit import rate_limit
from app.api.deps import get_current_user
from app.models.user import User
from app.services.delegation_service import DelegationService

router = APIRouter(prefix="/agent", tags=["agent"])


class RecordDelegationRequest(BaseModel):
    cap_object_id: str


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
    """查詢您目前有效的委託 cap（沒有回 null）。"""
    cap = await DelegationService(db).get_active_cap(current_user.id)
    return {"active_cap_object_id": cap, "has_active_delegation": cap is not None}


@router.delete("/delegation")
async def revoke_delegation(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_async_session),
):
    """撤銷您的委託（DB 標記；請另在錢包簽署鏈上 revoke 以完全生效）。"""
    return await DelegationService(db).revoke(current_user.id)
