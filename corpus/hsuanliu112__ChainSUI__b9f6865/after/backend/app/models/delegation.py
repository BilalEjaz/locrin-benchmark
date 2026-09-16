# backend/app/models/delegation.py
"""
OperatorDelegation — 使用者委託給平台 Agent 的 OperatorCap 紀錄

使用者在自己的錢包簽發 agent_registry::issue_operator_cap 後，把該 cap 的 object id
回報後端，存於此表。後端代發 escrow 交易（release/refund by agent）時據此找出用戶的 cap。
"""
from sqlalchemy import Column, Integer, String, Boolean, BigInteger, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.core.database import Base


class OperatorDelegation(Base):
    __tablename__ = "operator_delegations"

    id = Column(Integer, primary_key=True)

    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        comment="授權人（乘客/司機）用戶 ID",
    )
    cap_object_id = Column(
        String(66), nullable=False, unique=True, index=True,
        comment="鏈上 OperatorCap 物件 ID（唯一）",
    )
    agent_address = Column(
        String(66), nullable=False,
        comment="被授權的 Agent 位址（平台）",
    )
    max_spend_per_tx = Column(BigInteger, nullable=True, comment="單筆上限（MIST）")
    daily_limit = Column(BigInteger, nullable=True, comment="每日上限（MIST）")
    valid_until = Column(DateTime(timezone=True), nullable=True, comment="授權到期")
    allowed_actions = Column(Integer, nullable=True, comment="動作 bitmask（release=1/refund=2/rate=4/match=8）")
    auto_threshold_mist = Column(
        BigInteger, nullable=False, server_default="1000000000",
        comment="Agent 自動執行門檻（MIST）：≤ 此值自動代發，> 此值需乘客確認。預設 1 SUI",
    )
    revoked = Column(Boolean, default=False, nullable=False, comment="是否已撤銷")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return f"<OperatorDelegation user={self.user_id} cap={self.cap_object_id[:12]}… revoked={self.revoked}>"
