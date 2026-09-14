"""Loopback-only HTTP interface to the native backtesting engine."""

import argparse
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
from pathlib import Path
import secrets
import threading
import webbrowser
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator


class IndicatorConfig(BaseModel):
    """One independently configured member of a strategy."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    kind: Literal["bollinger", "crossing", "rmi", "rsi", "macd"] = "bollinger"
    enabled: bool = True
    weight: float = Field(default=1, gt=0, le=100)
    window: int = Field(default=30, ge=2, le=240)
    multiplier: float = Field(default=2, ge=0.5, le=5)
    fast: int = Field(default=12, ge=2, le=240)
    slow: int = Field(default=26, ge=3, le=480)
    smoothing: int = Field(default=14, ge=2, le=240)
    signal: int = Field(default=9, ge=2, le=240)
    overbought: float = Field(default=70, gt=0, lt=100)
    oversold: float = Field(default=30, gt=0, lt=100)

    @model_validator(mode="after")
    def validate_parameters(self):
        if self.kind in ("crossing", "macd") and self.fast >= self.slow:
            raise ValueError("Fast window must be shorter than slow window.")
        if self.kind in ("rsi", "rmi") and self.oversold >= self.overbought:
            raise ValueError("Oversold must be below overbought.")
        return self


class BacktestConfig(BaseModel):
    """Bound resource use and validate values before entering native code."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    name: str = Field(default="Untitled strategy", min_length=1, max_length=80)
    pair: Literal["EUR", "GBP", "CHF", "JPY", "CAD"] = "EUR"
    days: int = Field(default=3, ge=1, le=14)
    indicators: list[IndicatorConfig] = Field(
        default_factory=lambda: [IndicatorConfig()], min_length=1, max_length=8
    )
    combination: Literal["all", "any", "weighted"] = "any"
    threshold: float = Field(default=0, ge=0, le=800)
    capital: float = Field(default=100000, ge=100, le=100000000)
    lot_size: float = Field(default=10000, ge=1, le=1000000)
    positions: int = Field(default=1, ge=1, le=10)
    max_risk: int = Field(default=10000, ge=1, le=100000000)
    exit_policy: Literal["static", "trailing", "break_even"] = "static"
    stop_loss: float = Field(default=4, ge=0.1, le=500)
    take_profit: float = Field(default=4, ge=0.1, le=500)
    break_even_trigger: float = Field(default=2, ge=0.1, le=500)
    commission: float = Field(default=0, ge=0, le=1)
    slippage: float = Field(default=0, ge=0, le=100)
    spread: float = Field(default=0, ge=0, le=100)

    @model_validator(mode="after")
    def validate_relationships(self):
        if not any(item.enabled for item in self.indicators):
            raise ValueError("Enable at least one indicator.")
        if self.lot_size > self.capital:
            raise ValueError("Position size must not exceed starting capital.")
        return self


def create_indicator(config: IndicatorConfig):
    """Construct a native indicator using its documented window units."""
    from TradeTide import (
        BollingerBands,
        MovingAverageCrossing,
        RelativeMomentumIndex,
        RelativeStrengthIndex,
        MACD,
    )

    minutes = lambda value: timedelta(minutes=value)
    if config.kind == "bollinger":
        return BollingerBands(
            window=minutes(config.window), multiplier=config.multiplier
        )
    if config.kind == "crossing":
        return MovingAverageCrossing(
            short_window=minutes(config.fast), long_window=minutes(config.slow)
        )
    if config.kind == "rmi":
        return RelativeMomentumIndex(
            momentum_period=minutes(config.window),
            smooth_window=minutes(config.smoothing),
            over_bought=config.overbought,
            over_sold=config.oversold,
        )
    if config.kind == "rsi":
        return RelativeStrengthIndex(
            window=config.window,
            over_bought=config.overbought,
            over_sold=config.oversold,
        )
    return MACD(
        fast_window=config.fast, slow_window=config.slow, signal_window=config.signal
    )


def run_backtest(config: BacktestConfig) -> dict:
    """Combine native entry signals, simulate positions, and expose their outcomes."""
    from TradeTide import (
        BacktestResult,
        Market,
        Strategy,
        PositionCollection,
        Portfolio,
        ExecutionCosts,
        capital_management,
        exit_strategy,
    )
    from TradeTide import signal_rules

    market = Market()
    dataset = Path(__file__).resolve().parents[1] / "data" / f"{config.pair}_USD.csv"
    market.load_from_csv(str(dataset), timedelta(days=config.days))
    market.currency_pair = f"{config.pair}/USD"
    active_slots = [i + 1 for i, item in enumerate(config.indicators) if item.enabled]
    active = [item for item in config.indicators if item.enabled]
    signals, diagnostics = [], []
    attributes = {
        "bollinger": [
            ("Mean", "_cpp_sma"),
            ("Upper band", "_cpp_upper_band"),
            ("Lower band", "_cpp_lower_band"),
        ],
        "crossing": [
            ("Fast MA", "_cpp_short_moving_average"),
            ("Slow MA", "_cpp_long_moving_average"),
        ],
        "rmi": [("RMI", "_cpp_rmi")],
        "rsi": [("RSI", "_cpp_rsi")],
        "macd": [
            ("MACD", "_cpp_macd"),
            ("Signal", "_cpp_signal"),
            ("Histogram", "_cpp_histogram"),
        ],
    }
    for slot, item in zip(active_slots, active):
        indicator = create_indicator(item)
        strategy = Strategy()
        strategy.add_indicator(indicator)
        entries = list(strategy.get_trade_signal(market))
        signals.append(entries)
        diagnostics.append(
            {
                "kind": item.kind,
                "slot": slot,
                "config": item.model_dump(),
                "buy_signals": entries.count(1),
                "sell_signals": entries.count(-1),
                "series": [
                    {"name": name, "values": list(getattr(indicator, attr))}
                    for name, attr in attributes[item.kind]
                ],
            }
        )
    if config.combination == "weighted":
        combined = signal_rules.weighted(
            *signals,
            weights=[item.weight for item in active],
            threshold=config.threshold,
        )
    else:
        rule = (
            signal_rules.all_of if config.combination == "all" else signal_rules.any_of
        )
        combined = rule(*signals)
    policies = {
        "static": exit_strategy.Static,
        "trailing": exit_strategy.Trailing,
        "break_even": exit_strategy.BreakEven,
    }
    kwargs = {"stop_loss": config.stop_loss, "take_profit": config.take_profit}
    if config.exit_policy == "break_even":
        kwargs["break_even_trigger_pip"] = config.break_even_trigger
    exits = policies[config.exit_policy](**kwargs)
    sizing = capital_management.FixedLot(
        capital=config.capital,
        fixed_lot_size=config.lot_size,
        max_capital_at_risk=config.max_risk,
        max_concurrent_positions=config.positions,
    )
    positions = PositionCollection(market, combined.tolist())
    positions.open_positions(exits)
    positions.propagate_positions()
    portfolio = Portfolio(positions)
    portfolio.simulate(sizing)
    costs = ExecutionCosts(
        commission_per_lot=config.commission,
        slippage_pips=config.slippage,
        extra_spread_pips=config.spread,
    )
    result = BacktestResult.from_portfolio(portfolio, costs)
    payload = dict(result.to_dict())
    payload["config"] = config.model_dump()
    payload["indicators"] = diagnostics
    payload["market"] = {"times": list(market.dates), "prices": list(market.bid.close)}
    accepted = {(trade.entry_time, trade.is_long): trade for trade in result.trades}
    orders = []
    for index, direction in enumerate(combined):
        if not direction:
            continue
        trade = accepted.get((market.dates[index], direction == 1))
        orders.append(
            {
                "id": f"entry-{index}",
                "time": market.dates[index],
                "side": "Buy" if direction == 1 else "Sell",
                "type": "Simulated entry",
                "status": "Executed" if trade else "Skipped",
                "reason": "Portfolio entry"
                if trade
                else (
                    "End of sample"
                    if index == len(combined) - 1
                    else "Portfolio constraints"
                ),
                "price": trade.entry_price if trade else None,
                "size": trade.lot_size if trade else None,
                "contributors": [
                    active_slots[i]
                    for i, stream in enumerate(signals)
                    if stream[index] == direction
                ],
            }
        )
    payload["orders"] = orders
    return json_safe(payload)


def json_safe(value):
    """Represent undefined ratios as null, preserving strict JSON exports."""
    if isinstance(value, dict):
        return {key: json_safe(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [json_safe(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


class WorkspaceServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address):
        super().__init__(address, WorkspaceHandler)
        self.token = secrets.token_urlsafe(32)
        self.run_lock = threading.Lock()


class WorkspaceHandler(BaseHTTPRequestHandler):
    def respond(self, status, content, content_type="application/json"):
        body = content.encode() if isinstance(content, str) else content
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
        )
        self.end_headers()
        self.wfile.write(body)

    def valid_host(self):
        return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

    def do_GET(self):
        if not self.valid_host():
            return self.respond(403, '{"error":"Invalid host"}')
        if self.path == "/api/session":
            return self.respond(200, json.dumps({"token": self.server.token}))
        assets = {
            "/": ("index.html", "text/html; charset=utf-8"),
            "/app.js": ("app.js", "text/javascript; charset=utf-8"),
            "/style.css": ("style.css", "text/css; charset=utf-8"),
            "/logo.png": ("logo.png", "image/png"),
            "/research.mjs": ("research.mjs", "text/javascript; charset=utf-8"),
            "/storage.mjs": ("storage.mjs", "text/javascript; charset=utf-8"),
            "/charts.mjs": ("charts.mjs", "text/javascript; charset=utf-8"),
        }
        if self.path not in assets:
            return self.respond(404, '{"error":"Not found"}')
        name, mime = assets[self.path]
        self.respond(200, Path(__file__).with_name(name).read_bytes(), mime)

    def do_POST(self):
        if (
            not self.valid_host()
            or self.headers.get("X-TradeTide-Token") != self.server.token
        ):
            return self.respond(403, '{"error":"Invalid session; reload the page."}')
        if self.path not in ("/api/backtest", "/api/config"):
            return self.respond(404, '{"error":"Not found"}')
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 8192:
                raise ValueError("Request must contain at most 8 KB of JSON.")
            config = BacktestConfig.model_validate_json(self.rfile.read(size))
        except ValidationError as error:
            issues = []
            for issue in error.errors(include_url=False, include_input=False):
                field = " / ".join(
                    str(part + 1) if isinstance(part, int) else part.replace("_", " ")
                    for part in issue["loc"]
                )
                message = issue["msg"].removeprefix("Value error, ")
                issues.append(f"{field}: {message}" if field else message)
            return self.respond(400, json.dumps({"error": "; ".join(issues)}))
        except ValueError as error:
            return self.respond(400, json.dumps({"error": str(error)}))
        if self.path == "/api/config":
            return self.respond(200, config.model_dump_json())
        if not self.server.run_lock.acquire(blocking=False):
            return self.respond(
                409, '{"error":"A backtest is already running. Try again shortly."}'
            )
        try:
            self.respond(200, json.dumps(run_backtest(config), allow_nan=False))
        except Exception:
            import logging

            logging.getLogger(__name__).exception("Backtest failed")
            self.respond(
                500,
                '{"error":"The backtest failed. Check the terminal for details or try a shorter sample."}',
            )
        finally:
            self.server.run_lock.release()


def main():
    parser = argparse.ArgumentParser(
        description="Open the TradeTide research workspace."
    )
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    try:
        server = WorkspaceServer(("127.0.0.1", args.port))
    except OSError as error:
        parser.exit(1, f"Could not start TradeTide: {error}. Try --port 8766.\n")
    url = f"http://127.0.0.1:{server.server_port}"
    print(f"TradeTide workspace: {url}\nPress Ctrl+C to stop.", flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
