"""
WebSocket 通知器
提供業務邏輯層使用的通知功能
"""
from typing import Optional, Dict, Any
import logging
from app.websocket.manager import ConnectionManager

logger = logging.getLogger(__name__)


class WebSocketNotifier:
    """WebSocket 通知服務"""

    def __init__(self, manager: ConnectionManager):
        self.manager = manager

    async def notify_trip_accepted(self, trip_id: int, passenger_id: int, driver_info: Dict[str, Any]):
        """
        通知乘客：司機已接單

        Args:
            trip_id: 行程 ID
            passenger_id: 乘客 ID
            driver_info: 司機資訊
        """
        await self.manager.emit_to_user(
            passenger_id,
            "trip_accepted",
            {
                "trip_id": trip_id,
                "driver": driver_info,
                "message": "司機已接單"
            }
        )
        logger.info(f"已通知乘客 {passenger_id}：行程 {trip_id} 被接受")

    async def notify_trip_started(self, trip_id: int):
        """
        通知行程開始

        Args:
            trip_id: 行程 ID
        """
        room_name = f"trip_{trip_id}"
        await self.manager.emit_to_room(
            room_name,
            "trip_started",
            {
                "trip_id": trip_id,
                "message": "行程已開始"
            }
        )
        logger.info(f"已通知行程 {trip_id} 開始")

    async def notify_trip_arrived(self, trip_id: int):
        """
        通知司機已到達

        Args:
            trip_id: 行程 ID
        """
        room_name = f"trip_{trip_id}"
        await self.manager.emit_to_room(
            room_name,
            "trip_arrived",
            {
                "trip_id": trip_id,
                "message": "司機已到達"
            }
        )
        logger.info(f"已通知行程 {trip_id} 到達")

    async def notify_trip_completed(self, trip_id: int):
        """
        通知行程完成

        Args:
            trip_id: 行程 ID
        """
        room_name = f"trip_{trip_id}"
        await self.manager.emit_to_room(
            room_name,
            "trip_completed",
            {
                "trip_id": trip_id,
                "message": "行程已完成"
            }
        )
        logger.info(f"已通知行程 {trip_id} 完成")

    async def notify_trip_cancelled(self, trip_id: int, cancelled_by: str, reason: Optional[str] = None):
        """
        通知行程取消

        Args:
            trip_id: 行程 ID
            cancelled_by: 取消者（passenger/driver）
            reason: 取消原因
        """
        room_name = f"trip_{trip_id}"
        await self.manager.emit_to_room(
            room_name,
            "trip_cancelled",
            {
                "trip_id": trip_id,
                "cancelled_by": cancelled_by,
                "reason": reason,
                "message": "行程已取消"
            }
        )
        logger.info(f"已通知行程 {trip_id} 取消，取消者: {cancelled_by}")

    async def notify_payment_processing(self, trip_id: int):
        """
        通知支付處理中

        Args:
            trip_id: 行程 ID
        """
        room_name = f"trip_{trip_id}"
        await self.manager.emit_to_room(
            room_name,
            "payment_processing",
            {
                "trip_id": trip_id,
                "message": "支付處理中"
            }
        )
        logger.info(f"已通知行程 {trip_id} 支付處理中")

    async def notify_payment_completed(self, trip_id: int, passenger_id: int, driver_id: int, amount: float):
        """
        通知支付完成

        Args:
            trip_id: 行程 ID
            passenger_id: 乘客 ID
            driver_id: 司機 ID
            amount: 支付金額
        """
        # 通知乘客
        await self.manager.emit_to_user(
            passenger_id,
            "payment_completed",
            {
                "trip_id": trip_id,
                "amount": amount,
                "message": "支付成功"
            }
        )

        # 通知司機
        await self.manager.emit_to_user(
            driver_id,
            "payment_completed",
            {
                "trip_id": trip_id,
                "amount": amount,
                "message": "收款成功"
            }
        )
        logger.info(f"已通知行程 {trip_id} 支付完成，金額: {amount}")

    async def notify_payment_failed(self, trip_id: int, reason: str):
        """
        通知支付失敗

        Args:
            trip_id: 行程 ID
            reason: 失敗原因
        """
        room_name = f"trip_{trip_id}"
        await self.manager.emit_to_room(
            room_name,
            "payment_failed",
            {
                "trip_id": trip_id,
                "reason": reason,
                "message": "支付失敗"
            }
        )
        logger.info(f"已通知行程 {trip_id} 支付失敗: {reason}")

    async def notify_new_trip_available(self, trip_id: int, trip_info: Dict[str, Any]):
        """
        通知所有在線司機有新行程（廣播到司機房間）

        Args:
            trip_id: 行程 ID
            trip_info: 行程資訊
        """
        # 廣播到所有在線司機的房間
        await self.manager.emit_to_room(
            "drivers_online",
            "new_trip_available",
            {
                "trip_id": trip_id,
                "trip": trip_info,
                "message": "有新行程可接"
            }
        )
        logger.info(f"已廣播新行程 {trip_id} 給所有在線司機")

    async def add_driver_to_online_room(self, driver_id: int):
        """
        將司機加入在線司機房間

        Args:
            driver_id: 司機 ID
        """
        sid = self.manager.user_to_socket.get(driver_id)
        if sid:
            await self.manager.join_room(sid, "drivers_online")
            logger.info(f"司機 {driver_id} 加入在線司機房間")

    async def remove_driver_from_online_room(self, driver_id: int):
        """
        將司機從在線司機房間移除

        Args:
            driver_id: 司機 ID
        """
        sid = self.manager.user_to_socket.get(driver_id)
        if sid:
            await self.manager.leave_room(sid, "drivers_online")
            logger.info(f"司機 {driver_id} 離開在線司機房間")

    async def notify_vehicle_location_update(
        self,
        vehicle_id: str,
        lat: float,
        lng: float,
        driver_id: Optional[int] = None
    ):
        """
        通知車輛位置更新（用於召回）

        Args:
            vehicle_id: 車輛 ID
            lat: 緯度
            lng: 經度
            driver_id: 司機 ID（可選）
        """
        # 如果有driver_id，發送給該司機
        if driver_id:
            await self.manager.emit_to_user(
                driver_id,
                "vehicle_location_update",
                {
                    "vehicle_id": vehicle_id,
                    "lat": lat,
                    "lng": lng
                }
            )
            logger.debug(f"已通知司機 {driver_id} 車輛 {vehicle_id} 位置更新")

        # 也廣播給所有在線司機（用於地圖顯示）
        await self.manager.emit_to_room(
            "drivers_online",
            "vehicle_location_update",
            {
                "vehicle_id": vehicle_id,
                "lat": lat,
                "lng": lng
            }
        )

    async def notify_vehicle_recall_completed(
        self,
        vehicle_id: str,
        final_lat: float,
        final_lng: float,
        driver_id: Optional[int] = None
    ):
        """
        通知車輛召回完成

        Args:
            vehicle_id: 車輛 ID
            final_lat: 最終緯度
            final_lng: 最終經度
            driver_id: 司機 ID（可選）
        """
        data = {
            "vehicle_id": vehicle_id,
            "lat": final_lat,
            "lng": final_lng,
            "message": "車輛已到達目標位置"
        }

        # 通知司機
        if driver_id:
            await self.manager.emit_to_user(
                driver_id,
                "vehicle_recall_completed",
                data
            )

        # 也廣播給所有在線司機
        await self.manager.emit_to_room(
            "drivers_online",
            "vehicle_recall_completed",
            data
        )
        logger.info(f"已通知車輛 {vehicle_id} 召回完成")

    async def notify_agent_decision(self, user_id: int, payload: Dict[str, Any]):
        """
        通知乘客一則 Agent 結算決策（executed / pending / needs_review / failed）。

        payload 由 agent_brain 組好，含 decision_id / trip_id / kind / action /
        amount_mist / reason / tx_digest。pending 類前端應彈出「確認/拒絕」卡片。
        """
        await self.manager.emit_to_user(user_id, "agent_decision", payload)
        logger.info(
            "已通知乘客 %s Agent 決策：trip=%s kind=%s action=%s",
            user_id, payload.get("trip_id"), payload.get("kind"), payload.get("action"),
        )
