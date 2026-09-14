debug_mode = False  # noqa: F401

from . import position as position  # noqa: F401
from . import capital_management as capital_management  # noqa: F401
from . import exit_strategy as exit_strategy  # noqa: F401
try:
    from .strategy import Strategy  # noqa: F401
except ImportError:
    from .strategy import STRATEGY as Strategy  # noqa: F401
from .market import Market  # noqa: F401
from .currencies import Currency  # noqa: F401
try:
    from .portfolio import Portfolio  # noqa: F401
except ImportError:
    from .portfolio import PORTFOLIO as Portfolio  # noqa: F401
try:
    from .position_collection import PositionCollection  # noqa: F401
except ImportError:
    from .position_collection import POSITIONCOLLECTION as PositionCollection  # noqa: F401
from .indicators import BaseIndicator, MACD  # noqa: F401

try:
    from .indicators import (  # noqa: F401
        BollingerBands,
        MovingAverageCrossing,
        RelativeMomentumIndex,
        RelativeStrengthIndex,
    )
except ImportError:  # Compatibility with extensions built before PascalCase exports.
    from .indicators import BOLLINGERBANDS as BollingerBands  # noqa: F401
    from .indicators import MOVINGAVERAGECROSSING as MovingAverageCrossing  # noqa: F401
    from .indicators import RELATIVEMOMENTUMINDEX as RelativeMomentumIndex  # noqa: F401
    from .indicators import RELATIVESTRENGTHINDEX as RelativeStrengthIndex  # noqa: F401
try:
    from .backtester import Backtester  # noqa: F401
except ImportError:
    from .backtester import BACKTESTER as Backtester  # noqa: F401
from .signal import Signal  # noqa: F401
from .execution import ExecutionCosts, TradeCost  # noqa: F401
from .performance import BacktestResult, PerformanceMetrics, TradeResult  # noqa: F401
from .performance import plot_equity_drawdown, write_html_report  # noqa: F401
from .debug import (  # noqa: F401
    configure_logging,
    disable_debug_logging,
    enable_debug_logging,
)
from .validation import (  # noqa: F401
    MarketSplit,
    WalkForwardResult,
    WalkForwardSplitter,
    WalkForwardWindow,
    chronological_split,
    slice_market,
)
from .data_quality import (  # noqa: F401
    DataQualityIssue,
    DataQualityReport,
    IssueSeverity,
    validate_market_data,
)
from .ledger import LedgerEntry, PositionAnalytics, TradeLedger  # noqa: F401
from .orders import (  # noqa: F401
    Order,
    OrderBook,
    OrderFill,
    OrderSide,
    OrderStatus,
    OrderType,
)

try:
    from ._version import version as __version__  # noqa: F401

except ImportError:
    __version__ = "0.0.0"

# -
