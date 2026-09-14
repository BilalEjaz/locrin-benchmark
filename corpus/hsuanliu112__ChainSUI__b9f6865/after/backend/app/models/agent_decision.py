# backend/app/models/agent_decision.py
"""
AgentDecisionRecord — Agent 結算決策紀錄

每次 agent_brain 對一筆行程做結算決策（LLM 或規則）都落一列，作為：
  - 前端 /agent/activities 活動 feed 的資料來源；
  - 大額決策的 pending 佇列（乘客 confirm/decline 前的暫存）。

status 生命週期：
  auto_executed  — 小額，已自動代發上鏈（tx_digest 有值）
  pending        — 大額 / hold_for_confirm，待乘客確認
  confirmed      — 乘客確認後代發成功
  declined       — 乘客拒絕，不代發
  needs_review   — flag_review，需人工審查
  failed         — 代發上鏈失敗（error 有值）
"""
from sqlalchemy import (
    Column,
    Integer,
    String,
    BigInteger,
    Float,
    DateTime,
    ForeignKey,
)
from sqlalchemy.sql import func

from app.core.database import Base


class AgentDecisionRecord(Base):
    __tablename__ = "agent_decisions"

    id = Column(Integer, primary_key=True)

    trip_id = Column(
        Integer, ForeignKey("trips.trip_id", ondelete="CASCADE"),
        nullable=False, index=True,
    )
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False, index=True,
        comment="乘客（資源擁有者）",
    )
    action = Column(String(32), nullable=False, comment="release/refund/hold_for_confirm/flag_review")
    amount_mist = Column(BigInteger, nullable=False)
    status = Column(
        String(32), nullable=False, index=True,
        comment="auto_executed/pending/confirmed/declined/needs_review/failed",
    )
    reason = Column(String(500), nullable=True, comment="決策理由（繁中一句話）")
    confidence = Column(Float, nullable=True)
    source = Column(String(16), nullable=True, comment="llm/rules/fallback")
    escrow_object_id = Column(String(66), nullable=False)
    operator_cap_id = Column(String(66), nullable=False)
    tx_digest = Column(String(66), nullable=True, comment="代發成功的鏈上交易 digest")
    error = Column(String(500), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    def __repr__(self):
        return (
            f"<AgentDecisionRecord trip={self.trip_id} action={self.action} "
            f"status={self.status} amount={self.amount_mist}>"
        )
