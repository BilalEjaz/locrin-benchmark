"""Tests for structured performance reporting and execution-cost accounting."""

from datetime import datetime, timedelta
from types import SimpleNamespace

import numpy as np
import pytest

from TradeTide.execution import ExecutionCosts
from TradeTide import Market
from TradeTide.performance import BacktestResult
from TradeTide.validation import WalkForwardSplitter, chronological_split


class FakePosition:
    def __init__(self, start, end, price_difference=2.0, lot_size=10.0):
        self.start_date = start
        self.close_date = end
        self.is_long = True
        self.entry_price = 100.0
        self.exit_price = 102.0
        self.lot_size = lot_size
        self._price_difference = price_difference

    def get_price_difference(self):
        return self._price_difference


class FakePortfolio:
    def __init__(self, times, equity, positions):
        self.record = SimpleNamespace(time=times, equity=equity)
        self.market = SimpleNamespace(pip_value=0.01)
        self._positions = positions

    def get_positions(self):
        return self._positions


def test_result_reports_net_equity_metrics_and_trade_costs():
    start = datetime(2024, 1, 1)
    times = [start + timedelta(days=day) for day in range(4)]
    position = FakePosition(times[0], times[2])
    portfolio = FakePortfolio(times, [1_000.0, 1_005.0, 1_020.0, 1_020.0], [position])
    costs = ExecutionCosts(
        commission_per_lot=1.0,
        slippage_pips=2.0,
        extra_spread_pips=1.0,
        financing_per_lot_per_night=0.5,
    )

    result = BacktestResult.from_portfolio(portfolio, costs)

    # Commission 20 + slippage 0.4 + extra spread 0.1 + two nights 10.
    assert result.trades[0].costs.total == pytest.approx(30.5)
    assert result.equity[-1] == pytest.approx(989.5)
    assert result.trades[0].net_pnl == pytest.approx(-10.5)
    assert result.metrics.total_trades == 1
    assert result.metrics.winning_trades == 0
    assert result.metrics.max_drawdown > 0
    assert result.to_dict()["metrics"]["final_equity"] == pytest.approx(989.5)


def test_zero_cost_model_preserves_recorded_equity():
    start = datetime(2024, 1, 1)
    times = [start + timedelta(hours=1) * index for index in range(3)]
    portfolio = FakePortfolio(times, [100.0, 105.0, 102.0], [])

    result = BacktestResult.from_portfolio(portfolio)

    assert np.asarray(result.equity) == pytest.approx([100.0, 105.0, 102.0])
    assert result.metrics.total_return == pytest.approx(0.02)
    assert result.metrics.total_trades == 0


def test_metrics_include_calmar_and_drawdown_duration_and_plot():
    start = datetime(2024, 1, 1)
    times = [start + timedelta(days=day) for day in range(5)]
    portfolio = FakePortfolio(times, [100.0, 110.0, 90.0, 95.0, 115.0], [])

    result = BacktestResult.from_portfolio(portfolio)

    assert result.metrics.max_drawdown == pytest.approx(2 / 11)
    assert result.metrics.max_drawdown_duration_seconds == pytest.approx(2 * 86_400)
    assert result.metrics.calmar_ratio == pytest.approx(
        result.metrics.annualized_return / result.metrics.max_drawdown
    )
    figure = result.plot_equity_drawdown(show=False)
    assert len(figure.axes) == 2
    assert len(figure.axes[0].collections) == 2


def test_result_writes_a_standalone_interactive_html_report(tmp_path):
    pytest.importorskip("plotly")
    start = datetime(2024, 1, 1)
    times = [start + timedelta(days=day) for day in range(3)]
    portfolio = FakePortfolio(times, [100.0, 105.0, 102.0], [])

    report = BacktestResult.from_portfolio(portfolio).to_html(
        tmp_path / "report.html", title="Test report"
    )

    content = report.read_text(encoding="utf-8")
    assert report.exists()
    assert "Test report" in content
    assert "plotly" in content.lower()


def test_execution_costs_reject_negative_inputs():
    with pytest.raises(ValueError, match="non-negative"):
        ExecutionCosts(commission_per_lot=-1)


def test_walk_forward_windows_are_chronological_and_deterministic():
    market = SimpleNamespace(dates=list(range(12)))
    splitter = WalkForwardSplitter(train_size=4, test_size=3, step_size=2)

    windows = splitter.split(market)

    assert len(windows) == 3
    assert [
        (window.train_start, window.train_end, window.test_start, window.test_end)
        for window in windows
    ] == [
        (0, 4, 4, 7),
        (0, 6, 6, 9),
        (0, 8, 8, 11),
    ]
    assert all(window.train_end <= window.test_start for window in windows)


def test_chronological_split_copies_non_overlapping_market_periods():
    start = datetime(2024, 1, 1)
    market = Market()
    for minute in range(10):
        market.add_tick(start + timedelta(minutes=minute), 1.1002, 1.1000)

    split = chronological_split(market, train_size=0.6)

    assert split.split_index == 6
    assert len(split.train.dates) == 6
    assert len(split.test.dates) == 4
    assert split.train.dates[-1] < split.test.dates[0]
