"""Exercise the GUI boundary with real native results and loopback requests."""

import json
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest
from pydantic import ValidationError

from TradeTide.gui.server import (
    BacktestConfig,
    IndicatorConfig,
    WorkspaceServer,
    json_safe,
    run_backtest,
)


@pytest.mark.parametrize("strategy", ["bollinger", "crossing", "rmi", "rsi", "macd"])
def test_gui_runs_native_backtest(strategy):
    result = run_backtest(
        BacktestConfig(days=1, indicators=[IndicatorConfig(kind=strategy)])
    )
    assert len(result["times"]) == len(result["equity"]) > 0
    assert result["metrics"]["initial_equity"] == 100000
    assert result["config"]["indicators"][0]["kind"] == strategy
    assert len(result["market"]["times"]) == len(result["market"]["prices"])
    assert result["metrics"]["total_trades"] == len(result["trades"])
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize(
    "values",
    [
        {"days": 0},
        {"days": 15},
        {"capital": float("inf")},
        {"strategy": "unknown"},
        {"pair": "../EUR"},
        {"positions": 100},
        {"strategy": "crossing", "short_window": 50, "long_window": 10},
        {"capital": 100, "lot_size": 1000},
    ],
)
def test_gui_rejects_invalid_configuration(values):
    with pytest.raises(ValidationError):
        BacktestConfig(**values)


def test_json_safe_undefined_metrics():
    assert json_safe({"ratio": float("inf"), "values": [float("nan")]}) == {
        "ratio": None,
        "values": [None],
    }


def test_local_http_boundary():
    server = WorkspaceServer(("127.0.0.1", 0))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    try:
        with urlopen(base) as response:
            assert b"Strategy setup" in response.read()
        with urlopen(base + "/api/session") as response:
            token = json.load(response)["token"]
        with pytest.raises(HTTPError) as error:
            urlopen(Request(base + "/api/backtest", data=b"{}"))
        assert error.value.code == 403
        with pytest.raises(HTTPError) as error:
            urlopen(Request(base, headers={"Host": "untrusted.example"}))
        assert error.value.code == 403
        headers = {"X-TradeTide-Token": token, "Content-Type": "application/json"}
        # Configuration validation must not acquire the simulation lock or run a backtest.
        server.run_lock.acquire()
        try:
            with urlopen(
                Request(
                    base + "/api/config",
                    data=b'{"indicators":[{"kind":"rsi","window":20}]}',
                    headers=headers,
                )
            ) as response:
                config = json.load(response)
                assert config["indicators"][0]["window"] == 20
                assert config["capital"] == 100000
                assert "metrics" not in config
        finally:
            server.run_lock.release()
        with urlopen(base + "/research.mjs") as response:
            assert response.headers["Content-Type"].startswith("text/javascript")
            assert b"buildSweep" in response.read()
        with pytest.raises(HTTPError) as error:
            urlopen(
                Request(base + "/api/backtest", data=b'{"days":0}', headers=headers)
            )
        assert error.value.code == 400
        with urlopen(
            Request(
                base + "/api/backtest",
                data=BacktestConfig(days=1).model_dump_json().encode(),
                headers=headers,
            )
        ) as response:
            assert json.load(response)["metrics"]["initial_equity"] == 100000
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


@pytest.mark.parametrize("combination", ["all", "any", "weighted"])
def test_multi_indicator_rules(combination):
    # Two identical indicators must have the same events as one, for each rule.
    single = run_backtest(BacktestConfig(days=1))
    combined = run_backtest(
        BacktestConfig(
            days=1,
            combination=combination,
            indicators=[IndicatorConfig(), IndicatorConfig()],
        )
    )
    assert combined["equity"] == single["equity"]
    assert combined["orders"]
    assert len(combined["indicators"]) == 2
    assert all(order["contributors"] == [1, 2] for order in combined["orders"])
    accepted = [order for order in combined["orders"] if order["status"] == "Executed"]
    assert len(accepted) == combined["metrics"]["total_trades"]


def test_disabled_indicator_and_vote_threshold():
    config = BacktestConfig(
        days=1,
        combination="weighted",
        threshold=100,
        indicators=[IndicatorConfig(), IndicatorConfig(kind="rsi", enabled=False)],
    )
    result = run_backtest(config)
    assert not result["orders"]
    assert result["metrics"]["total_trades"] == 0
    assert len(result["indicators"]) == 1


@pytest.mark.parametrize("policy", ["static", "trailing", "break_even"])
def test_exit_policies_and_costs(policy):
    free = run_backtest(BacktestConfig(days=1, exit_policy=policy))
    paid = run_backtest(
        BacktestConfig(days=1, exit_policy=policy, commission=0.0001, slippage=0.05)
    )
    assert paid["metrics"]["total_trades"] == free["metrics"]["total_trades"]
    assert paid["metrics"]["final_equity"] < free["metrics"]["final_equity"]
    assert all(trade["costs"]["commission"] > 0 for trade in paid["trades"])


@pytest.mark.parametrize(
    "config",
    [
        {"indicators": []},
        {"indicators": [{"enabled": False}]},
        {"indicators": [{"kind": "rsi", "oversold": 80, "overbought": 20}]},
        {"indicators": [{"kind": "macd", "fast": 40, "slow": 20}]},
        {"indicators": [{"weight": -1}]},
        {"commission": -1},
        {"indicators": [{}] * 9},
    ],
)
def test_strategy_validation(config):
    with pytest.raises(ValidationError):
        BacktestConfig(**config)
