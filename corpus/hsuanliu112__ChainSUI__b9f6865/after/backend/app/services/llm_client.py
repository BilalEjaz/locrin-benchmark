"""
LLM Client — Agent 決策層的模型呼叫（OpenAI-compatible endpoint）

刻意用 httpx 直打 /chat/completions（而非 openai SDK），因為：
  - httpx 已是既有相依，不增加套件；與 delegation_service / walrus_service 同模式。
  - OpenAI-compatible 是開源模型的共同介面：Ollama、vLLM、DashScope compatible-mode、
    OpenRouter 都支援。換模型只需改 .env 的 LLM_BASE_URL / LLM_MODEL，程式不動。

設計原則（對齊 CLAUDE.md 鐵律 2 fail-closed，但決策層例外採 fail-open）：
  - 這一層只產生「建議」，不是安全邊界（邊界是 agent_guardrails + 鏈上 cap）。
  - 因此逾時/連線失敗/壞 JSON 一律回 None，讓上層 fallback 回規則路徑——
    結算不能因為 AI 掛掉就卡住。
  - 強制 JSON 物件輸出（response_format），呼叫端再用 pydantic 驗證。
"""
import json
import logging
from typing import Any, Dict, List, Optional

import httpx

from app.config import settings

logger = logging.getLogger(__name__)


class LLMClient:
    """OpenAI-compatible chat completions 的極簡 async 客戶端。"""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ):
        self.base_url = (base_url or settings.LLM_BASE_URL).rstrip("/")
        self.api_key = api_key or settings.LLM_API_KEY
        self.model = model or settings.LLM_MODEL
        self.timeout = timeout if timeout is not None else settings.LLM_TIMEOUT_SECONDS
        self.max_retries = max_retries if max_retries is not None else settings.LLM_MAX_RETRIES

    @property
    def enabled(self) -> bool:
        return bool(settings.AGENT_LLM_ENABLED and self.base_url and self.model)

    async def complete_json(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.0,
    ) -> Optional[Dict[str, Any]]:
        """
        送出一次 chat completion 並要求 JSON 物件輸出。
        成功回傳解析後的 dict；任何失敗（未啟用/逾時/連線/HTTP 錯誤/壞 JSON）回 None。
        """
        if not self.enabled:
            return None

        messages: List[Dict[str, str]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "response_format": {"type": "json_object"},
            "stream": False,
        }
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"

        url = f"{self.base_url}/chat/completions"
        last_err: Optional[str] = None

        for attempt in range(self.max_retries + 1):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code != 200:
                    last_err = f"HTTP {resp.status_code}: {resp.text[:200]}"
                    logger.warning("LLM 呼叫非 200（attempt %d）：%s", attempt + 1, last_err)
                    continue
                data = resp.json()
                content = (
                    data.get("choices", [{}])[0].get("message", {}).get("content", "")
                )
                if not content:
                    last_err = "LLM 回應無 content"
                    continue
                return self._extract_json(content)
            except (httpx.TimeoutException, httpx.HTTPError) as e:
                last_err = f"{type(e).__name__}: {e}"
                logger.warning("LLM 呼叫失敗（attempt %d）：%s", attempt + 1, last_err)
            except Exception as e:  # noqa: BLE001
                last_err = f"未預期錯誤 {type(e).__name__}: {e}"
                logger.warning("LLM 呼叫未預期錯誤（attempt %d）：%s", attempt + 1, last_err)

        logger.info("LLM 決策不可用，將 fallback 回規則路徑（末次錯誤：%s）", last_err)
        return None

    @staticmethod
    def _extract_json(content: str) -> Optional[Dict[str, Any]]:
        """
        從模型回應抽出 JSON 物件。優先直接 parse；失敗則擷取第一個 {...} 區塊
        （某些開源模型即使指定 json_object 仍會夾帶 markdown fence 或前導文字）。
        """
        content = content.strip()
        try:
            obj = json.loads(content)
            return obj if isinstance(obj, dict) else None
        except (json.JSONDecodeError, ValueError):
            pass
        start = content.find("{")
        end = content.rfind("}")
        if start != -1 and end != -1 and end > start:
            try:
                obj = json.loads(content[start : end + 1])
                return obj if isinstance(obj, dict) else None
            except (json.JSONDecodeError, ValueError):
                return None
        return None


# 全域單例（讀 settings；換模型改 .env 即可）
llm_client = LLMClient()
