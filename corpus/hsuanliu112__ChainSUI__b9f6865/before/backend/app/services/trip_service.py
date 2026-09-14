# backend/app/services/trip_service.py
"""
Trip 業務邏輯服務 - 重構版
所有配對和行程管理邏輯都在後端，僅在關鍵點調用鏈上合約
"""

import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func, desc

from app.models.ride import Trip
from app.models.user import User
from app.models.vehicle import Vehicle
from app.schemas.trip import (
    TripCreate, TripResponse, TripStatus, TripFareBreakdown,
    TripEstimate, DriverTripInfo, TripSummary
)
from app.services.location_service import LocationService
from app.services.escrow_service import EscrowService  # 新的託管服務
from app.services.surge_pricing_service import SurgePricingService
from app.services.price_oracle import get_price_oracle  # 價格預言機

logger = logging.getLogger(__name__)

class TripService:
    """行程服務 - 業務邏輯完全在後端"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.escrow_service = EscrowService()
        self.surge_pricing_service = SurgePricingService(db)

        # ✅ 費率配置（以美元錨定，穩定不受 SUI 價格波動影響）
        self.BASE_FARE_USD = 1.50  # 起跳價 $1.5 USD
        self.PER_KM_RATE_USD = 0.50  # 每公里 $0.5 USD
        self.PER_MINUTE_RATE_USD = 0.10  # 每分鐘 $0.1 USD

        # ✅ 無手續費模式（改為透過代幣經濟盈利）
        self.PLATFORM_FEE_RATE = 0.0  # 平台費率 0%（無手續費）

        # 配對參數
        self.MAX_PICKUP_DISTANCE_KM = 10.0
        self.MAX_WAIT_TIME_MINUTES = 15
    
    # ========================================================================
    # 行程創建 - 純後端邏輯，不調用合約
    # ========================================================================
    
    async def create_trip_request(self, user_id: int, trip_data: TripCreate) -> TripResponse:
        """
        創建行程請求 - 完全在後端處理

        變更:
        - ❌ 不再調用 ride_matching 合約
        - ✅ 直接在資料庫創建記錄
        - ✅ 觸發後端配對算法
        - ✅ 支持中繼點/停靠點
        """
        # 檢查用戶是否有進行中的行程
        existing_trip = await self._get_user_active_trip(user_id)
        if existing_trip:
            raise ValueError("您已有進行中的行程")

        # 計算距離和預估（考慮中繼點）
        # 如果有中繼點，計算總距離為：起點->中繼點1->中繼點2->...->終點
        if trip_data.waypoints and len(trip_data.waypoints) > 0:
            # 有中繼點的情況：計算每段距離的總和
            total_distance = 0.0

            # 起點到第一個中繼點
            prev_lat, prev_lng = trip_data.pickup_lat, trip_data.pickup_lng

            for waypoint in trip_data.waypoints:
                segment_distance = LocationService.haversine_km(
                    prev_lat, prev_lng,
                    waypoint.lat, waypoint.lng
                )
                total_distance += segment_distance
                prev_lat, prev_lng = waypoint.lat, waypoint.lng

            # 最後一個中繼點到終點
            total_distance += LocationService.haversine_km(
                prev_lat, prev_lng,
                trip_data.dropoff_lat, trip_data.dropoff_lng
            )

            distance_km = total_distance
            logger.info(f"🗺️  包含 {len(trip_data.waypoints)} 個中繼點，總距離: {distance_km:.2f} km")
        else:
            # 沒有中繼點：直線距離
            distance_km = LocationService.haversine_km(
                trip_data.pickup_lat, trip_data.pickup_lng,
                trip_data.dropoff_lat, trip_data.dropoff_lng
            )

        estimated_duration = LocationService.estimate_travel_time_minutes(distance_km)

        # 計算動態定價
        surge_info = await self.surge_pricing_service.calculate_surge_pricing(
            trip_data.pickup_lat,
            trip_data.pickup_lng
        )

        # 根據用戶選擇決定使用哪種定價
        use_dynamic_pricing = trip_data.use_dynamic_pricing
        surge_multiplier = surge_info['surge_multiplier'] if use_dynamic_pricing else 1.0

        # 計算費用（帶完整的動態定價資訊）
        fare_breakdown = await self._calculate_fare(
            distance_km,
            estimated_duration,
            surge_multiplier=surge_multiplier,
            surge_breakdown=surge_info['breakdown'] if use_dynamic_pricing else None,
            surge_reason=surge_info['reason'] if use_dynamic_pricing else None
        )

        # 設定優先級
        priority = 1 if use_dynamic_pricing else 2
        price_type = "dynamic" if use_dynamic_pricing else "standard"

        # 創建本地行程記錄
        trip = Trip(
            user_id=user_id,
            pickup_lat=trip_data.pickup_lat,
            pickup_lng=trip_data.pickup_lng,
            pickup_address=trip_data.pickup_address,
            dropoff_lat=trip_data.dropoff_lat,
            dropoff_lng=trip_data.dropoff_lng,
            dropoff_address=trip_data.dropoff_address,
            passenger_count=trip_data.passenger_count,
            distance_km=distance_km,
            estimated_duration_minutes=estimated_duration,
            status=TripStatus.REQUESTED,
            base_fare=fare_breakdown.base_fare / 1000000000,  # MIST -> SUI
            per_km_rate=fare_breakdown.per_km_rate / 1000000000,  # MIST -> SUI
            service_fee=fare_breakdown.platform_fee / 1000000000,  # MIST -> SUI
            fare=fare_breakdown.driver_amount / 1000000000,  # 車資 (不含平台費) MIST -> SUI
            total_amount=fare_breakdown.total_amount / 1000000000,  # 總金額 MIST -> SUI
            # 動態定價資訊
            surge_multiplier=surge_multiplier,
            surge_reason=surge_info['reason'] if use_dynamic_pricing else None,
            price_type=price_type,
            priority=priority,
            requested_at=datetime.utcnow()
        )

        self.db.add(trip)
        await self.db.commit()
        await self.db.refresh(trip)

        # 創建中繼點記錄（如果有）
        if trip_data.waypoints and len(trip_data.waypoints) > 0:
            from app.models.waypoint import TripWaypoint

            for idx, waypoint in enumerate(trip_data.waypoints):
                trip_waypoint = TripWaypoint(
                    trip_id=trip.trip_id,
                    sequence=idx + 1,  # 從 1 開始（0 是起點，最後是終點）
                    lat=waypoint.lat,
                    lng=waypoint.lng,
                    address=waypoint.address
                )
                self.db.add(trip_waypoint)

            await self.db.commit()
            logger.info(f"✅ 已創建 {len(trip_data.waypoints)} 個中繼點")

            # 重新載入 trip 以包含 waypoints 關聯
            from sqlalchemy.orm import selectinload
            from app.core.database import async_session_maker

            stmt = select(Trip).where(Trip.trip_id == trip.trip_id).options(selectinload(Trip.waypoints))

            # 使用新的 session 重新查詢（避免 greenlet 錯誤）
            async with async_session_maker() as refresh_session:
                result = await refresh_session.execute(stmt)
                trip = result.scalar_one()

        logger.info(f"✅ 行程創建成功 (後端): {trip.trip_id}")

        # 保存 trip_id 用於後續查詢
        trip_id = trip.trip_id

        # ✅ 新增：智能推送給附近司機（不阻塞）
        try:
            await self._notify_nearby_drivers(trip)
        except Exception as e:
            logger.warning(f"推送通知失敗: {e}")

        # 使用新 session 重新查詢 trip（避免 detached 對象問題）
        from sqlalchemy.orm import selectinload
        from app.core.database import async_session_maker

        async with async_session_maker() as response_session:
            stmt = select(Trip).where(Trip.trip_id == trip_id).options(selectinload(Trip.waypoints))
            result = await response_session.execute(stmt)
            fresh_trip = result.scalar_one()

            return await self._build_trip_response(fresh_trip, fare_breakdown)
    
    # ========================================================================
    # 配對邏輯 - 完全在後端
    # ========================================================================
    
    async def find_and_match_driver(self, trip_id: int) -> Optional[DriverTripInfo]:
        """
        配對司機 - 完全在後端執行
        
        變更:
        - ❌ 不調用 confirm_match 合約
        - ✅ 使用後端算法選擇最佳司機
        - ✅ 直接更新資料庫狀態
        """
        trip = await self._get_trip_by_id(trip_id)
        if not trip or trip.status != TripStatus.REQUESTED:
            raise ValueError("行程不存在或狀態不正確")
        
        # 查找附近可用司機
        available_matches = await self._find_available_drivers(
            trip.pickup_lat, trip.pickup_lng, 
            self.MAX_PICKUP_DISTANCE_KM
        )
        
        if not available_matches:
            logger.info(f"未找到可用司機: trip {trip_id}")
            return None
        
        # 選擇最佳匹配 (距離最近)
        best_match = available_matches[0]
        
        # 直接更新資料庫 - 不調用合約
        trip.status = TripStatus.MATCHED
        trip.vehicle_id = best_match["vehicle_id"]
        trip.driver_id = best_match["driver_id"]
        trip.matched_at = datetime.utcnow()
        
        await self.db.commit()
        
        logger.info(f"✅ 配對成功 (後端): trip {trip_id} <- driver {best_match['driver_id']}")
        
        return DriverTripInfo(
            trip_id=trip.trip_id,
            passenger_name=best_match["passenger_name"],
            passenger_phone=best_match["passenger_phone"],
            pickup_location={
                "lat": trip.pickup_lat,
                "lng": trip.pickup_lng,
                "address": trip.pickup_address
            },
            dropoff_location={
                "lat": trip.dropoff_lat,
                "lng": trip.dropoff_lng,
                "address": trip.dropoff_address
            },
            passenger_count=trip.passenger_count,
            estimated_fare=int(trip.fare * 1000000000),  # SUI -> MIST
            distance_to_pickup_km=best_match["distance_km"],
            notes=None
        )
    
    # ========================================================================
    # 司機接受行程 - 後端 + 鏈上支付鎖定
    # ========================================================================
    
    async def accept_trip(self, trip_id: int, driver_id: int, estimated_arrival: int) -> Dict[str, Any]:
        """
        司機接受行程 - 關鍵變更點
        
        變更:
        - ✅ 更新後端狀態
        - ✅ 準備鏈上支付鎖定交易
        - ⚠️  需要前端調用錢包簽署
        """
        trip = await self._get_trip_by_id(trip_id)
        if not trip:
            raise ValueError("行程不存在")
        
        # 允許從 REQUESTED 或 MATCHED 狀態接單
        if trip.status not in [TripStatus.REQUESTED, TripStatus.MATCHED]:
            raise ValueError("行程狀態不正確")
        
        # 如果是 REQUESTED 狀態，設置司機
        if trip.status == TripStatus.REQUESTED:
            trip.driver_id = driver_id
            # 獲取司機的車輛
            driver_vehicles = await self._get_driver_vehicles(driver_id)
            if driver_vehicles:
                trip.vehicle_id = driver_vehicles[0].vehicle_id
        elif trip.driver_id != driver_id:
            raise ValueError("您不是此行程的司機")
        
        # 獲取乘客和司機資訊
        passenger = await self._get_user_by_id(trip.user_id)
        driver = await self._get_user_by_id(driver_id)
        
        # 計算支付金額
        total_amount = int(trip.total_amount * 1000000000)  # SUI -> MIST
        platform_fee = int(total_amount * self.PLATFORM_FEE_RATE)
        
        # 準備鏈上支付鎖定
        escrow_result = await self.escrow_service.lock_payment(
            passenger_wallet=passenger.wallet_address,
            driver_wallet=driver.wallet_address,
            trip_id=trip.trip_id,
            amount=total_amount,
            platform_fee=platform_fee
        )
        
        # 更新行程狀態 (等待支付鎖定確認)
        trip.status = TripStatus.ACCEPTED
        
        # 更新車輛狀態
        if trip.vehicle_id:
            vehicle = await self._get_vehicle_by_id(trip.vehicle_id)
            if vehicle:
                vehicle.status = "on_trip"
        
        await self.db.commit()
        
        logger.info(f"✅ 司機接受行程: {trip_id}, 等待支付鎖定")
        
        return {
            "trip": await self._build_trip_response(trip),
            "escrow_transaction": escrow_result,
            "instructions": [
                "1. 乘客需要使用錢包簽署支付鎖定交易",
                "2. 簽署後資金將被託管在智能合約中",
                "3. 司機可以開始前往接送地點"
            ]
        }
    
    # ========================================================================
    # 確認支付鎖定 - 更新託管ID
    # ========================================================================
    
    async def confirm_payment_lock(self, trip_id: int, tx_hash: str) -> TripResponse:
        """
        確認支付已鎖定（通過 tx_hash 自動提取 escrow_object_id）

        改進功能:
        - 用戶只需提供 tx_hash（交易哈希）
        - 後端自動從區塊鏈查詢並提取 escrow_object_id
        - 驗證交易狀態和金額

        Args:
            trip_id: 行程ID
            tx_hash: 交易哈希（用戶從錢包獲得）

        Returns:
            更新後的行程信息

        Raises:
            ValueError: 交易驗證失敗或未找到託管對象
        """
        trip = await self._get_trip_by_id(trip_id)
        if not trip:
            raise ValueError("行程不存在")

        logger.info(f"🔐 開始確認支付: trip {trip_id}, tx_hash {tx_hash}")

        # 1. 驗證交易狀態
        from app.services.sui_service import sui_service
        tx_status = await sui_service.get_transaction_status(tx_hash)

        if tx_status.status.value != "confirmed":
            raise ValueError(f"交易尚未確認，當前狀態: {tx_status.status.value}")

        logger.info(f"✅ 交易已確認")

        # 2. 自動提取 escrow_object_id
        escrow_object_id = await sui_service.get_escrow_id_from_tx(tx_hash)

        if not escrow_object_id:
            raise ValueError(
                "無法從交易中找到託管對象。"
                "請確認這是一筆 payment_escrow::lock_payment 交易。"
            )

        logger.info(f"✅ 提取到託管對象ID: {escrow_object_id}")

        # 3. 驗證支付金額（可選但推薦）
        expected_amount = int(trip.total_amount * 1_000_000_000)  # SUI -> MIST
        verification = await sui_service.verify_payment_transaction(
            tx_hash=tx_hash,
            expected_recipient=sui_service.contract_package_id,  # 合約地址
            expected_amount=expected_amount
        )

        if not verification.get("valid"):
            logger.warning(f"⚠️ 支付金額驗證失敗: {verification.get('error')}")
            # 不阻止流程，只記錄警告
        else:
            logger.info(f"✅ 支付金額驗證通過")

        # 4. 保存託管對象ID和交易哈希
        trip.escrow_object_id = escrow_object_id
        trip.blockchain_tx_id = tx_hash
        trip.payment_status = "locked"

        await self.db.commit()

        logger.info(f"✅ 支付確認完成: trip {trip_id}, escrow {escrow_object_id}, tx {tx_hash}")

        return await self._build_trip_response(trip)
    
    # ========================================================================
    # 上車 - 純後端（由乘客確認）
    # ========================================================================

    async def pickup_passenger(self, trip_id: int, passenger_id: int) -> TripResponse:
        """
        乘客確認上車 - 純後端操作
        自駕車到達後，由乘客確認已上車
        """
        trip = await self._get_trip_by_id(trip_id)
        if not trip:
            raise ValueError("行程不存在")

        if trip.user_id != passenger_id:
            raise ValueError("您不是此行程的乘客")

        if trip.status != TripStatus.ACCEPTED:
            raise ValueError("行程狀態不正確，當前狀態為: " + trip.status)

        trip.status = TripStatus.PICKED_UP
        trip.picked_up_at = datetime.utcnow()

        await self.db.commit()

        logger.info(f"✅ 乘客已確認上車: trip {trip_id}, passenger {passenger_id}")

        return await self._build_trip_response(trip)

    async def start_trip(self, trip_id: int, driver_id: int) -> TripResponse:
        """
        司機開始行程（picked_up → in_progress）。
        讓 in_progress 成為真正被使用的狀態（問題 7），而非死狀態。
        """
        trip = await self._get_trip_by_id(trip_id)
        if not trip:
            raise ValueError("行程不存在")
        if trip.driver_id != driver_id:
            raise ValueError("您不是此行程的司機")
        if trip.status != TripStatus.PICKED_UP:
            raise ValueError("行程狀態不正確，需為 picked_up，當前為: " + trip.status)

        trip.status = TripStatus.IN_PROGRESS
        await self.db.commit()
        logger.info(f"✅ 行程開始: trip {trip_id}, driver {driver_id}")
        return await self._build_trip_response(trip)
    
    # ========================================================================
    # 完成行程 - 後端 + 鏈上支付釋放
    # ========================================================================
    
    async def complete_trip(self, trip_id: int, driver_id: int) -> Dict[str, Any]:
        """
        完成行程 - 關鍵變更點
        
        變更:
        - ✅ 更新後端狀態
        - ✅ 調用鏈上支付釋放
        - ✅ 可選: 創建鏈上收據
        """
        trip = await self._get_trip_by_id(trip_id)
        if not trip:
            raise ValueError("行程不存在")
        
        if trip.driver_id != driver_id:
            raise ValueError("您不是此行程的司機")
        
        if trip.status not in [TripStatus.PICKED_UP, TripStatus.IN_PROGRESS]:
            raise ValueError("行程狀態不正確")
        
        # 計算實際行程時間
        if trip.picked_up_at:
            now = datetime.utcnow()
            if trip.picked_up_at.tzinfo is not None:
                from datetime import timezone
                now = now.replace(tzinfo=timezone.utc)
            actual_duration = int((now - trip.picked_up_at).total_seconds() / 60)
        else:
            actual_duration = trip.estimated_duration_minutes
        
        # 重新計算最終費用
        fare_breakdown = await self._calculate_fare(trip.distance_km, actual_duration)
        
        # 檢查是否有託管記錄
        if not trip.escrow_object_id:
            raise ValueError("此行程尚未支付，無法完成。請確保乘客已完成支付。")
        
        # 獲取司機和乘客資訊
        driver = await self._get_user_by_id(driver_id)
        passenger = await self._get_user_by_id(trip.user_id)
        
        logger.info(f"🚗 開始完成行程 {trip_id}，司機: {driver.username}，乘客: {passenger.username}")
        logger.info(f"💰 託管對象ID: {trip.escrow_object_id}")
        
        # 計算司機實際收益（扣除平台費用）
        driver_earnings_mist = fare_breakdown.driver_amount * 1000  # micro SUI -> MIST
        
        # 調用鏈上支付釋放：優先走 Agent 委託（乘客的 OperatorCap → release_payment_by_agent），
        # 無委託才退回舊路徑（依賴 operator 私鑰）。
        from app.services.delegation_service import DelegationService
        from app.services.agent_service import agent_service
        passenger_cap = await DelegationService(self.db).get_active_cap(passenger.id)
        if passenger_cap and trip.escrow_object_id:
            logger.info(f"🤖 走 Agent 委託放款（cap={passenger_cap[:12]}…）")
            release_result = await agent_service.release_escrow_via_agent(
                escrow_object_id=trip.escrow_object_id,
                operator_cap_id=passenger_cap,
                trip_id=trip.trip_id,
            )
        else:
            release_result = await self.escrow_service.release_payment(
                escrow_object_id=trip.escrow_object_id,
                driver_wallet=driver.wallet_address,
                trip_id=trip.trip_id,
                amount_mist=driver_earnings_mist
            )

        if not release_result.get("success"):
            error_msg = release_result.get('error', '未知錯誤')
            logger.error(f"❌ 支付釋放失敗: {error_msg}")
            raise Exception(f"支付釋放失敗: {error_msg}")
        
        blockchain_tx_id = release_result.get("transaction_hash")
        logger.info(f"✅ 支付已成功釋放給司機，交易Hash: {blockchain_tx_id}")
        
        # 更新行程狀態
        trip.status = TripStatus.COMPLETED
        trip.completed_at = datetime.utcnow()
        trip.actual_duration_minutes = actual_duration
        trip.total_amount = fare_breakdown.total_amount / 1000000000  # 修正: MIST → SUI (÷ 10^9)
        trip.payment_amount_micro_sui = str(fare_breakdown.total_amount)
        trip.blockchain_tx_id = blockchain_tx_id
        
        # 計算司機實際收益（扣除平台費用）
        driver_earnings_micro = fare_breakdown.driver_amount
        
        # 釋放車輛並更新收益
        if trip.vehicle_id:
            vehicle = await self._get_vehicle_by_id(trip.vehicle_id)
            if vehicle:
                vehicle.status = "available"
                vehicle.total_trips += 1
                vehicle.total_distance_km += trip.distance_km
                # 更新車輛收益
                current_earnings = int(vehicle.total_earnings_micro_sui or 0)
                vehicle.total_earnings_micro_sui = str(current_earnings + driver_earnings_micro)
                logger.info(f"💰 車輛收益更新: +{driver_earnings_micro} micro SUI")
        
        # 更新用戶統計和收益
        passenger.total_rides_as_passenger += 1
        driver.total_rides_as_driver += 1
        # 更新司機總收益
        current_driver_earnings = int(driver.total_earnings_micro_sui or 0)
        driver.total_earnings_micro_sui = str(current_driver_earnings + driver_earnings_micro)
        
        await self.db.commit()
        
        logger.info(f"✅ 行程完成: trip {trip_id}, tx {release_result.get('transaction_hash')}")
        
        # 行程結束：把累積的 GPS 軌跡上傳 Walrus（best-effort，失敗不影響行程完成）
        trajectory_blob_id = ""
        trajectory_hash = b""
        try:
            from app.services.trajectory_service import trajectory_service
            traj = await trajectory_service.flush_to_walrus(trip.trip_id)
            if traj:
                trajectory_blob_id = traj["blob_id"]
                trajectory_hash = traj["content_hash"]
                logger.info(f"🛰️ 軌跡已上傳 Walrus: blob={trajectory_blob_id} 點數={traj['point_count']}")
        except Exception as e:
            logger.warning(f"軌跡上傳 Walrus 失敗 (不影響行程): {e}")

        # 可選: 創建鏈上收據（錨定軌跡 blob_id + hash）
        receipt_result = None
        try:
            receipt_result = await self.escrow_service.create_trip_receipt(
                trip_id=trip.trip_id,
                passenger_address=passenger.wallet_address,
                driver_address=driver.wallet_address,
                pickup_lat=trip.pickup_lat,
                pickup_lng=trip.pickup_lng,
                dropoff_lat=trip.dropoff_lat,
                dropoff_lng=trip.dropoff_lng,
                distance_km=int(trip.distance_km * 1000),  # 轉為米
                final_amount=fare_breakdown.total_amount,
                trajectory_blob_id=trajectory_blob_id,
                trajectory_hash=trajectory_hash,
            )
            logger.info(f"✅ 鏈上收據已創建: {receipt_result.get('receipt_id')}")
        except Exception as e:
            logger.warning(f"創建鏈上收據失敗 (不影響行程): {e}")
        
        return {
            "trip": await self._build_trip_response(trip, fare_breakdown),
            "payment": {
                "transaction_hash": release_result["transaction_hash"],
                "status": "released",
                "driver_amount": fare_breakdown.driver_amount,
                "platform_fee": fare_breakdown.platform_fee
            },
            "receipt": receipt_result
        }
    
    # ========================================================================
    # 取消行程 - 後端 + 可能的退款
    # ========================================================================
    
    async def cancel_trip(self, trip_id: int, user_id: int, reason: str, cancelled_by: str) -> TripResponse:
        """
        取消行程

        邏輯:
        - 行程未開始 (requested, matched, accepted): 退款給乘客
        - 行程已開始 (picked_up, in_progress): 不退款，支付給司機（因為已提供服務）
        """
        trip = await self._get_trip_by_id(trip_id)
        if not trip:
            raise ValueError("行程不存在")

        # 檢查取消權限
        if cancelled_by == "passenger" and trip.user_id != user_id:
            raise ValueError("您不是此行程的乘客")
        elif cancelled_by == "driver" and trip.driver_id != user_id:
            raise ValueError("您不是此行程的司機")

        if trip.status in [TripStatus.COMPLETED, TripStatus.CANCELLED]:
            raise ValueError("行程已完成或已取消")

        # 乘客上車後不允許取消（只能完成行程後申請退款）
        if cancelled_by == "passenger" and trip.status in [TripStatus.PICKED_UP, TripStatus.IN_PROGRESS]:
            raise ValueError("行程已開始，無法取消。請完成行程後如有問題可申請退款。")

        # 處理支付邏輯（優先走 Agent 委託：乘客簽發的 OperatorCap）。
        # 金流失敗一律以 error 記錄並反映在 payment_status，不再靜默吞例外。
        payment_result = None
        if trip.escrow_object_id:
            from app.services.delegation_service import DelegationService
            from app.services.agent_service import agent_service
            passenger_cap = await DelegationService(self.db).get_active_cap(trip.user_id)
            try:
                # 情況 1: 行程已開始 (picked_up, in_progress) - 放款給司機（乘客 cap 授權 release），不退款
                if trip.status in [TripStatus.PICKED_UP, TripStatus.IN_PROGRESS]:
                    if passenger_cap:
                        payment_result = await agent_service.release_escrow_via_agent(
                            escrow_object_id=trip.escrow_object_id,
                            operator_cap_id=passenger_cap,
                            trip_id=trip.trip_id,
                        )
                    else:
                        payment_result = {"success": False, "error": "乘客尚未授權 OperatorCap，無法代為放款"}
                    logger.info(f"🚗 中途取消（行程已開始）→ 放款給司機: trip {trip_id}")

                # 情況 2: 行程未開始 (accepted) - 退款給乘客
                elif trip.status in [TripStatus.ACCEPTED]:
                    if passenger_cap:
                        payment_result = await agent_service.refund_escrow_via_agent(
                            escrow_object_id=trip.escrow_object_id,
                            operator_cap_id=passenger_cap,
                        )
                    else:
                        payment_result = {"success": False, "error": "乘客尚未授權 OperatorCap，無法代為退款"}
                    logger.info(f"💸 取消退款（行程未開始）: trip {trip_id}, 由 {cancelled_by} 發起")

                if payment_result is not None:
                    if payment_result.get("success"):
                        trip.blockchain_tx_id = payment_result.get("transaction_hash")
                        trip.payment_status = "refunded" if trip.status == TripStatus.ACCEPTED else "released"
                    else:
                        trip.payment_status = "failed"
                        logger.error(f"❌ 取消金流失敗 trip {trip_id}: {payment_result.get('error')}")
            except Exception as e:
                trip.payment_status = "failed"
                payment_result = {"success": False, "error": str(e)}
                logger.error(f"❌ 取消金流異常 trip {trip_id}: {e}")
        
        # 更新狀態
        trip.status = TripStatus.CANCELLED
        trip.cancelled_at = datetime.utcnow()
        trip.cancellation_reason = reason
        
        # 釋放車輛
        if trip.vehicle_id:
            vehicle = await self._get_vehicle_by_id(trip.vehicle_id)
            if vehicle:
                vehicle.status = "available"
        
        await self.db.commit()

        logger.info(f"✅ 行程已取消: trip {trip_id} by {cancelled_by}")

        # 發送 WebSocket 通知給雙方
        from app.websocket.dependencies import get_notifier

        notifier = get_notifier()
        if notifier:
            # 通知乘客
            if trip.user_id:
                await notifier.manager.emit_to_user(
                    trip.user_id,
                    'trip_cancelled',
                    {
                        'trip_id': trip_id,
                        'cancelled_by': cancelled_by,
                        'reason': reason,
                        'message': f'行程已被{"司機" if cancelled_by == "driver" else "乘客"}取消'
                    }
                )

            # 通知司機
            if trip.driver_id:
                await notifier.manager.emit_to_user(
                    trip.driver_id,
                    'trip_cancelled',
                    {
                        'trip_id': trip_id,
                        'cancelled_by': cancelled_by,
                        'reason': reason,
                        'message': f'行程已被{"司機" if cancelled_by == "driver" else "乘客"}取消'
                    }
                )
        else:
            logger.warning("WebSocket notifier 未初始化，無法發送取消通知")

        return await self._build_trip_response(trip)
    
    # ========================================================================
    # 預估行程 - 純後端
    # ========================================================================
    
    async def get_trip_estimate(self, pickup_lat: float, pickup_lng: float,
                               dropoff_lat: float, dropoff_lng: float) -> TripEstimate:
        """
        獲取行程預估

        返回兩種定價選項：
        1. 標準叫車（固定價格，priority 2，可能等待較久）
        2. 快速叫車（動態定價，priority 1，優先配對）
        """
        distance_km = LocationService.haversine_km(pickup_lat, pickup_lng, dropoff_lat, dropoff_lng)
        duration_minutes = LocationService.estimate_travel_time_minutes(distance_km)

        # 計算動態定價資訊
        surge_info = await self.surge_pricing_service.calculate_surge_pricing(
            pickup_lat,
            pickup_lng
        )

        # 計算標準價格（無加價）
        standard_fare = await self._calculate_fare(
            distance_km,
            duration_minutes,
            surge_multiplier=1.0,
            surge_breakdown=None,
            surge_reason=None
        )

        # 計算動態價格（含加價）
        dynamic_fare = await self._calculate_fare(
            distance_km,
            duration_minutes,
            surge_multiplier=surge_info['surge_multiplier'],
            surge_breakdown=surge_info['breakdown'],
            surge_reason=surge_info['reason']
        )

        # 查詢可用車輛
        available_vehicles = await self._find_available_drivers(
            pickup_lat,
            pickup_lng,
            self.MAX_PICKUP_DISTANCE_KM
        )

        # 計算預估等待時間
        if available_vehicles:
            avg_distance = sum(v["distance_km"] for v in available_vehicles) / len(available_vehicles)
            base_wait_time = max(3, int(avg_distance * 2))
        else:
            base_wait_time = self.MAX_WAIT_TIME_MINUTES

        # 動態定價使用者的預估等待時間（較短）
        dynamic_wait_time = base_wait_time

        # 標準定價使用者的預估等待時間（可能較長）
        # 如果有動態加價，標準使用者預估等待時間會增加
        if surge_info['has_surge']:
            standard_wait_time = int(base_wait_time * 1.5)  # 增加 50%
        else:
            standard_wait_time = base_wait_time

        return TripEstimate(
            estimated_distance_km=distance_km,
            estimated_duration_minutes=duration_minutes,
            estimated_fare=dynamic_fare,  # 預設顯示動態價格
            available_vehicles_count=len(available_vehicles),
            estimated_wait_time_minutes=dynamic_wait_time,

            # 動態定價資訊
            surge_info=surge_info,
            standard_fare=standard_fare,
            dynamic_fare=dynamic_fare,
            has_surge=surge_info['has_surge']
        )
    
    # ========================================================================
    # 私有輔助方法
    # ========================================================================
    
    async def _calculate_fare(
        self,
        distance_km: float,
        duration_minutes: int,
        surge_multiplier: float = 1.0,
        surge_breakdown: Optional[Dict[str, float]] = None,
        surge_reason: Optional[str] = None
    ) -> TripFareBreakdown:
        """
        計算費用（美元錨定 + 動態 SUI 換算）

        流程：
        1. 以美元計算費用
        2. 獲取 SUI/USD 匯率
        3. 換算成 SUI（MIST）數量

        Args:
            distance_km: 行程距離（公里）
            duration_minutes: 預估時間（分鐘）
            surge_multiplier: 動態加價係數（預設 1.0 無加價）
            surge_breakdown: 加價因素分解
            surge_reason: 加價原因說明

        Returns:
            包含完整費用分解的 TripFareBreakdown（同時包含 USD 和 SUI 金額）
        """
        # 1. 以美元計算費用
        base_fare_usd = self.BASE_FARE_USD
        distance_fare_usd = distance_km * self.PER_KM_RATE_USD
        time_fare_usd = duration_minutes * self.PER_MINUTE_RATE_USD

        # 應用動態加價係數
        subtotal_usd = (base_fare_usd + distance_fare_usd + time_fare_usd) * surge_multiplier
        platform_fee_usd = subtotal_usd * self.PLATFORM_FEE_RATE  # 0% = $0
        total_usd = subtotal_usd + platform_fee_usd
        driver_amount_usd = total_usd - platform_fee_usd

        # 2. 獲取 SUI/USD 匯率
        oracle = get_price_oracle()
        sui_price_usd = await oracle.get_sui_usd_price()

        # 3. 換算成 SUI（MIST）
        # 1 SUI = 1,000,000,000 MIST
        base_fare_mist = int((base_fare_usd / sui_price_usd) * 1_000_000_000)
        distance_fare_mist = int((distance_fare_usd / sui_price_usd) * 1_000_000_000)
        time_fare_mist = int((time_fare_usd / sui_price_usd) * 1_000_000_000)
        platform_fee_mist = int((platform_fee_usd / sui_price_usd) * 1_000_000_000)
        total_amount_mist = int((total_usd / sui_price_usd) * 1_000_000_000)
        driver_amount_mist = int((driver_amount_usd / sui_price_usd) * 1_000_000_000)

        logger.info(
            f"💰 費用計算: ${total_usd:.2f} USD = {total_amount_mist / 1e9:.4f} SUI "
            f"(匯率: 1 SUI = ${sui_price_usd:.2f})"
        )

        return TripFareBreakdown(
            # SUI 金額（MIST 單位）
            base_fare=base_fare_mist,
            distance_fare=distance_fare_mist,
            time_fare=time_fare_mist,
            platform_fee=platform_fee_mist,
            total_amount=total_amount_mist,
            driver_amount=driver_amount_mist,
            # 基本信息
            distance_km=distance_km,
            duration_minutes=duration_minutes,
            per_km_rate=int((self.PER_KM_RATE_USD / sui_price_usd) * 1_000_000_000),
            per_minute_rate=int((self.PER_MINUTE_RATE_USD / sui_price_usd) * 1_000_000_000),
            platform_fee_rate=self.PLATFORM_FEE_RATE,
            surge_multiplier=surge_multiplier,
            surge_breakdown=surge_breakdown,
            surge_reason=surge_reason
        )
    
    async def _get_trip_by_id(self, trip_id: int) -> Optional[Trip]:
        """根據ID獲取行程"""
        from sqlalchemy.orm import selectinload
        stmt = select(Trip).where(Trip.trip_id == trip_id).options(selectinload(Trip.waypoints))
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
    
    async def _get_user_by_id(self, user_id: int) -> Optional[User]:
        """根據ID獲取用戶"""
        stmt = select(User).where(User.id == user_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
    
    async def _get_vehicle_by_id(self, vehicle_id: str) -> Optional[Vehicle]:
        """根據ID獲取車輛"""
        stmt = select(Vehicle).where(Vehicle.vehicle_id == vehicle_id)
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
    
    async def _get_driver_vehicles(self, driver_id: int) -> list:
        """獲取司機的車輛列表"""
        from app.models.vehicle import Vehicle
        stmt = select(Vehicle).where(Vehicle.owner_id == driver_id)
        result = await self.db.execute(stmt)
        return result.scalars().all()
    
    async def _get_user_wallet(self, user_id: int) -> str:
        """獲取用戶錢包地址"""
        user = await self._get_user_by_id(user_id)
        if not user:
            raise ValueError("用戶不存在")
        return user.wallet_address
    
    async def _get_user_active_trip(self, user_id: int) -> Optional[Trip]:
        """獲取用戶的活躍行程"""
        active_statuses = [
            TripStatus.REQUESTED, TripStatus.MATCHED, TripStatus.ACCEPTED, 
            TripStatus.PICKED_UP, TripStatus.IN_PROGRESS
        ]
        stmt = select(Trip).where(
            and_(
                or_(Trip.user_id == user_id, Trip.driver_id == user_id),
                Trip.status.in_(active_statuses)
            )
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()
    
    async def _find_available_drivers(self, lat: float, lng: float, radius_km: float) -> List[Dict[str, Any]]:
        """查找附近可用司機"""
        from app.core.database import async_session_maker

        stmt = select(Vehicle, User).join(User, Vehicle.owner_id == User.id).where(
            and_(
                Vehicle.status == "available",
                Vehicle.is_active == True,
                User.is_active == True,
                User.user_type.in_(["driver", "both"])
            )
        )

        # 使用獨立的數據庫會話避免 greenlet 錯誤
        async with async_session_maker() as session:
            result = await session.execute(stmt)
            vehicles_and_drivers = result.all()
        
        matches = []
        for vehicle, driver in vehicles_and_drivers:
            if vehicle.current_lat and vehicle.current_lng:
                distance_km = LocationService.haversine_km(
                    lat, lng, vehicle.current_lat, vehicle.current_lng
                )
            else:
                import time
                minute_bucket = int(time.time() // 60)
                rand_lat, rand_lng = LocationService.random_point_near(
                    lat, lng, radius_km=radius_km,
                    seed=f"{vehicle.vehicle_id}-{minute_bucket}"
                )
                distance_km = LocationService.haversine_km(lat, lng, rand_lat, rand_lng)
            
            if distance_km <= radius_km:
                matches.append({
                    "vehicle_id": vehicle.vehicle_id,
                    "driver_id": driver.id,
                    "driver_name": driver.username,
                    "passenger_name": driver.username,
                    "passenger_phone": driver.phone_number,
                    "distance_km": distance_km,
                    "vehicle_model": vehicle.model,
                    "vehicle_type": vehicle.vehicle_type
                })
        
        matches.sort(key=lambda x: x["distance_km"])
        return matches
    
    async def _build_trip_response(self, trip: Trip, fare_breakdown: Optional[TripFareBreakdown] = None) -> TripResponse:
        """構建行程響應對象"""
        if not fare_breakdown and trip.distance_km and trip.estimated_duration_minutes:
            fare_breakdown = await self._calculate_fare(trip.distance_km, trip.estimated_duration_minutes)

        # 獲取中繼點數據（如果有）
        from app.schemas.trip import WaypointResponse
        waypoints_response = []
        if hasattr(trip, 'waypoints') and trip.waypoints:
            waypoints_response = [
                WaypointResponse(
                    id=wp.id,
                    sequence=wp.sequence,
                    lat=wp.lat,
                    lng=wp.lng,
                    address=wp.address,
                    arrival_time=wp.arrival_time
                )
                for wp in sorted(trip.waypoints, key=lambda x: x.sequence)
            ]

        return TripResponse(
            trip_id=trip.trip_id,
            user_id=trip.user_id,
            driver_id=trip.driver_id,
            vehicle_id=trip.vehicle_id,
            pickup_lat=trip.pickup_lat,
            pickup_lng=trip.pickup_lng,
            pickup_address=trip.pickup_address,
            dropoff_lat=trip.dropoff_lat,
            dropoff_lng=trip.dropoff_lng,
            dropoff_address=trip.dropoff_address,
            waypoints=waypoints_response,  # 添加中繼點
            passenger_count=trip.passenger_count,
            status=TripStatus(trip.status),
            distance_km=trip.distance_km,
            estimated_duration_minutes=trip.estimated_duration_minutes,
            actual_duration_minutes=trip.actual_duration_minutes,
            fare_breakdown=fare_breakdown,
            payment_amount_micro_sui=trip.payment_amount_micro_sui,
            blockchain_tx_id=trip.blockchain_tx_id,
            escrow_object_id=trip.escrow_object_id,
            # 動態定價資訊
            price_type=trip.price_type,
            priority=trip.priority,
            surge_multiplier=trip.surge_multiplier,
            surge_reason=trip.surge_reason,
            estimated_wait_minutes=trip.estimated_wait_minutes,
            actual_wait_minutes=trip.actual_wait_minutes,
            # 時間戳
            requested_at=trip.requested_at,
            matched_at=trip.matched_at,
            picked_up_at=trip.picked_up_at,
            dropped_off_at=trip.dropped_off_at,
            completed_at=trip.completed_at,
            cancelled_at=trip.cancelled_at,
            cancellation_reason=trip.cancellation_reason
        )

    # ========================================================================
    # 自動升級機制 - 背景任務
    # ========================================================================

    async def auto_upgrade_waiting_trips(self) -> Dict[str, Any]:
        """
        自動升級等待過久的標準叫車訂單

        邏輯：
        1. 查詢等待超過 15 分鐘的 priority 2 訂單
        2. 將其升級為 priority 1（保持原價不變）
        3. 記錄升級資訊
        4. 返回升級數量

        應該透過背景任務定期執行（建議 5 分鐘一次）
        """
        try:
            from datetime import timezone
            now_utc = datetime.now(timezone.utc)
            # 計算 15 分鐘前的時間（tz-aware，避免與 timestamptz 欄位相減時 naive/aware 衝突）
            threshold_time = now_utc - timedelta(minutes=15)

            # 查詢符合條件的訂單
            stmt = select(Trip).where(
                and_(
                    Trip.status == TripStatus.REQUESTED,
                    Trip.driver_id.is_(None),
                    Trip.priority == 2,  # 標準叫車
                    Trip.price_type == "standard",  # 確認是標準定價
                    Trip.requested_at <= threshold_time  # 超過 15 分鐘
                )
            )

            result = await self.db.execute(stmt)
            waiting_trips = result.scalars().all()

            upgraded_count = 0
            upgraded_trip_ids = []

            for trip in waiting_trips:
                # 計算實際等待時間（把可能為 naive 的 requested_at 補成 UTC，避免相減報錯）
                ra = trip.requested_at
                if ra is not None and ra.tzinfo is None:
                    ra = ra.replace(tzinfo=timezone.utc)
                wait_minutes = int((now_utc - ra).total_seconds() / 60) if ra else 0
                trip.actual_wait_minutes = wait_minutes

                # 升級優先級（保持原價）
                trip.priority = 1
                trip.surge_reason = f"等待 {wait_minutes} 分鐘後自動升級為快速叫車（維持標準價格）"

                upgraded_count += 1
                upgraded_trip_ids.append(trip.trip_id)

                logger.info(f"✅ 自動升級行程 {trip.trip_id}（等待 {wait_minutes} 分鐘）")

            # 提交變更
            if upgraded_count > 0:
                await self.db.commit()

            return {
                "upgraded_count": upgraded_count,
                "upgraded_trip_ids": upgraded_trip_ids,
                "threshold_minutes": 15,
                "checked_at": datetime.utcnow().isoformat()
            }

        except Exception as e:
            logger.error(f"❌ 自動升級失敗: {e}")
            await self.db.rollback()
            return {
                "upgraded_count": 0,
                "error": str(e)
            }

    # ========================================================================
    # 智能推送通知 - 混合式配對系統
    # ========================================================================

    async def _notify_nearby_drivers(self, trip: Trip):
        """
        推送新行程給附近司機

        策略：
        1. 查找附近 10km 內的可用司機
        2. 按距離排序，取前 10 位
        3. 透過 WebSocket 推送通知
        4. 司機可以選擇接受或忽略
        5. 行程仍然顯示在可接單列表中

        Args:
            trip: 新創建的行程
        """
        from app.websocket.dependencies import get_notifier

        try:
            # 查找附近可用司機
            nearby_drivers = await self._find_available_drivers(
                trip.pickup_lat,
                trip.pickup_lng,
                radius_km=10.0  # 10 公里內
            )

            if not nearby_drivers:
                logger.info(f"📡 行程 {trip.trip_id}: 附近沒有可用司機")
                return

            # 限制推送數量（前 10 位最近的）
            top_drivers = nearby_drivers[:10]
            logger.info(f"📡 行程 {trip.trip_id}: 推送給 {len(top_drivers)} 位附近司機")

            notifier = get_notifier()
            if not notifier:
                logger.warning("WebSocket notifier 未初始化")
                return

            # 計算 SUI 金額（用於顯示）
            fare_sui = trip.total_amount / 1000000000.0 if trip.total_amount else 0.0

            # 推送給每位司機
            for driver_info in top_drivers:
                await notifier.manager.emit_to_user(
                    driver_info['driver_id'],
                    'new_trip_nearby',
                    {
                        'trip_id': trip.trip_id,
                        'distance_to_pickup': round(driver_info['distance_km'], 1),
                        'pickup_address': trip.pickup_address,
                        'dropoff_address': trip.dropoff_address,
                        'distance_km': round(trip.distance_km, 1),
                        'estimated_fare_sui': round(fare_sui, 4),
                        'estimated_fare_mist': trip.total_amount,
                        'priority': trip.priority,
                        'price_type': trip.price_type,
                        'surge_multiplier': trip.surge_multiplier,
                        'surge_reason': trip.surge_reason,
                        'passenger_count': trip.passenger_count,
                        'timeout_seconds': 60,  # 60 秒後可能推送給其他司機
                        'message': f'新行程！距離您 {driver_info["distance_km"]:.1f} km'
                    }
                )
                logger.info(
                    f"  → 推送給司機 {driver_info['driver_id']} "
                    f"(距離 {driver_info['distance_km']:.1f} km)"
                )

        except Exception as e:
            logger.error(f"推送通知失敗: {e}", exc_info=True)