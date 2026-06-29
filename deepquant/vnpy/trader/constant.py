"""
General constant enums used in the trading platform.
"""

from enum import Enum

from .locale import _


class Direction(Enum):
    """
    Direction of order/trade/position.
    """
    LONG = _("多")
    SHORT = _("空")
    NET = _("净")


class Offset(Enum):
    """
    Offset of order/trade.
    """
    NONE = ""
    OPEN = _("开")
    CLOSE = _("平")
    CLOSETODAY = _("平今")
    CLOSEYESTERDAY = _("平昨")


class Status(Enum):
    """
    Order status.
    """
    SUBMITTING = _("提交中")
    NOTTRADED = _("未成交")
    PARTTRADED = _("部分成交")
    ALLTRADED = _("全部成交")
    CANCELLED = _("已撤销")
    REJECTED = _("拒单")


class Product(Enum):
    """
    Product class.
    """
    EQUITY = _("股票")
    FUTURES = _("期货")
    OPTION = _("期权")
    INDEX = _("指数")
    FOREX = _("外汇")
    SPOT = _("现货")
    ETF = "ETF"
    BOND = _("债券")
    WARRANT = _("权证")
    SPREAD = _("价差")
    FUND = _("基金")
    CFD = "CFD"
    SWAP = _("互换")


class OrderType(Enum):
    """
    Order type.
    """
    LIMIT = _("限价")
    MARKET = _("市价")
    STOP = "STOP"
    FAK = "FAK"
    FOK = "FOK"
    RFQ = _("询价")
    ETF = "ETF"


class OptionType(Enum):
    """
    Option type.
    """
    CALL = _("看涨期权")
    PUT = _("看跌期权")


class Exchange(Enum):
    """
    Exchange.
    """
    # Chinese
    CFFEX = "CFFEX"         # 中国金融期货交易所
    SHFE = "SHFE"           # 上海期货交易所
    CZCE = "CZCE"           # 郑州商品交易所
    DCE = "DCE"             # 大连商品交易所
    INE = "INE"             # 上海国际能源交易中心
    GFEX = "GFEX"           # 广州期货交易所
    SSE = "SSE"             # 上海证券交易所
    SZSE = "SZSE"           # 深圳证券交易所
    BSE = "BSE"             # 北京证券交易所
    SHHK = "SHHK"           # 沪港通
    SZHK = "SZHK"           # 深港通
    SGE = "SGE"             # 上海黄金交易所
    WXE = "WXE"             # 无锡不锈钢交易所
    CFETS = "CFETS"         # 外汇交易中心
    XBOND = "XBOND"         # X债券

    # Global
    SMART = "SMART"         # 智能路由(美股)
    NYSE = "NYSE"           # 纽约证券交易所
    NASDAQ = "NASDAQ"       # 纳斯达克交易所
    ARCA = "ARCA"           # ARCA交易所
    EDGEA = "EDGEA"         # Direct Edge交易所
    ISLAND = "ISLAND"       # 纳斯达克ISLAND
    BATS = "BATS"           # Bats Global Markets
    IEX = "IEX"             # IEX交易所
    AMEX = "AMEX"           # 美国证券交易所
    TSE = "TSE"             # 多伦多证券交易所
    NYMEX = "NYMEX"         # 纽约商业交易所
    COMEX = "COMEX"         # 纽约商品交易所
    GLOBEX = "GLOBEX"       # 芝加哥Globex
    IDEALPRO = "IDEALPRO"   # IB外汇ECN
    CME = "CME"             # 芝加哥商业交易所
    ICE = "ICE"             # 洲际交易所
    SEHK = "SEHK"           # 香港证券交易所
    HKFE = "HKFE"           # 香港期货交易所
    SGX = "SGX"             # 新加坡交易所
    CBOT = "CBOT"           # 芝加哥期货交易所
    CBOE = "CBOE"           # 芝加哥期权交易所
    CFE = "CFE"             # CBOE期货交易所
    DME = "DME"             # 迪拜商业交易所
    EUREX = "EUX"           # 欧交所
    APEX = "APEX"           # 亚太交易所
    LME = "LME"             # 伦敦金属交易所
    BMD = "BMD"             # 马来西亚衍生品交易所
    TOCOM = "TOCOM"         # 东京商品交易所
    EUNX = "EUNX"           # 泛欧交易所
    KRX = "KRX"             # 韩国交易所
    OTC = "OTC"             # OTC产品(外汇/CFD)
    IBKRATS = "IBKRATS"     # IB模拟交易

    # Special
    LOCAL = "LOCAL"         # 本地生成数据
    GLOBAL = "GLOBAL"       # 其他未支持交易所

    @property
    def display_name(self) -> str:
        """Return Chinese display name."""
        return _exchange_display_name.get(self.value, self.value)


_exchange_display_name: dict[str, str] = {
    # Chinese
    "CFFEX": "中金所",
    "SHFE": "上期所",
    "CZCE": "郑商所",
    "DCE": "大商所",
    "INE": "上能源",
    "GFEX": "广期所",
    "SSE": "上交所",
    "SZSE": "深交所",
    "BSE": "北交所",
    "SHHK": "沪港通",
    "SZHK": "深港通",
    "SGE": "上金所",
    "WXE": "无锡钢交所",
    "CFETS": "外汇交易中心",
    "XBOND": "X债券",
    # Global
    "SMART": "智能路由",
    "NYSE": "纽交所",
    "NASDAQ": "纳斯达克",
    "ARCA": "ARCA",
    "EDGEA": "EDGEA",
    "ISLAND": "ISLAND",
    "BATS": "BATS",
    "IEX": "IEX",
    "AMEX": "美交所",
    "TSE": "多伦多",
    "NYMEX": "纽商所",
    "COMEX": "COMEX",
    "GLOBEX": "GLOBEX",
    "IDEALPRO": "IB外汇",
    "CME": "芝商所",
    "ICE": "洲际交易所",
    "SEHK": "港交所",
    "HKFE": "港期所",
    "SGX": "新交所",
    "CBOT": "芝加哥期交所",
    "CBOE": "芝加哥期权所",
    "CFE": "CBOE期交所",
    "DME": "迪拜商交所",
    "EUX": "欧交所",
    "APEX": "亚太交易所",
    "LME": "伦敦金属",
    "BMD": "马来西亚衍生品",
    "TOCOM": "东京商交所",
    "EUNX": "泛欧交易所",
    "KRX": "韩国交易所",
    "OTC": "OTC",
    "IBKRATS": "IB模拟",
    "LOCAL": "本地",
    "GLOBAL": "全球",
}


class Currency(Enum):
    """
    Currency.
    """
    USD = "USD"
    HKD = "HKD"
    CNY = "CNY"
    CAD = "CAD"


class Interval(Enum):
    """
    Interval of bar data.
    """
    MINUTE = "1m"
    HOUR = "1h"
    DAILY = "d"
    WEEKLY = "w"
    TICK = "tick"
