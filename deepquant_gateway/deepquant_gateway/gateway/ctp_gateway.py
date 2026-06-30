import sys
import time
from datetime import datetime
from time import sleep
from pathlib import Path

from deepquant.event import EventEngine, Event
from deepquant.trader.constant import (
    Direction,
    Offset,
    Exchange,
    OrderType,
    Product,
    Status,
    OptionType
)
from deepquant.trader.gateway import BaseGateway
from deepquant.trader.object import (
    TickData,
    OrderData,
    TradeData,
    PositionData,
    AccountData,
    ContractData,
    OrderRequest,
    CancelRequest,
    SubscribeRequest,
)
from deepquant.trader.utility import get_folder_path, ZoneInfo
from deepquant.trader.event import EVENT_TIMER

from deepquant_ctp.api import (
    MdApi,
    TdApi,
    THOST_FTDC_OST_NoTradeQueueing,
    THOST_FTDC_OST_PartTradedQueueing,
    THOST_FTDC_OST_AllTraded,
    THOST_FTDC_OST_Canceled,
    THOST_FTDC_OST_Unknown,
    THOST_FTDC_D_Buy,
    THOST_FTDC_D_Sell,
    THOST_FTDC_PD_Long,
    THOST_FTDC_PD_Short,
    THOST_FTDC_OPT_LimitPrice,
    THOST_FTDC_OPT_AnyPrice,
    THOST_FTDC_OF_Open,
    THOST_FTDC_OFEN_Close,
    THOST_FTDC_OFEN_CloseYesterday,
    THOST_FTDC_OFEN_CloseToday,
    THOST_FTDC_PC_Futures,
    THOST_FTDC_PC_Options,
    THOST_FTDC_PC_SpotOption,
    THOST_FTDC_PC_Combination,
    THOST_FTDC_CP_CallOptions,
    THOST_FTDC_CP_PutOptions,
    THOST_FTDC_HF_Speculation,
    THOST_FTDC_CC_Immediately,
    THOST_FTDC_FCC_NotForceClose,
    THOST_FTDC_TC_GFD,
    THOST_FTDC_VC_AV,
    THOST_FTDC_TC_IOC,
    THOST_FTDC_VC_CV,
    THOST_FTDC_AF_Delete,
    THOST_FTDC_OSS_InsertRejected
)


# 委托状态映射
STATUS_CTP2VT: dict[str, Status] = {
    THOST_FTDC_OST_NoTradeQueueing: Status.NOTTRADED,
    THOST_FTDC_OST_PartTradedQueueing: Status.PARTTRADED,
    THOST_FTDC_OST_AllTraded: Status.ALLTRADED,
    THOST_FTDC_OST_Canceled: Status.CANCELLED,
    THOST_FTDC_OST_Unknown: Status.SUBMITTING
}

# 多空方向映射
DIRECTION_VT2CTP: dict[Direction, str] = {
    Direction.LONG: THOST_FTDC_D_Buy,
    Direction.SHORT: THOST_FTDC_D_Sell
}
DIRECTION_CTP2VT: dict[str, Direction] = {v: k for k, v in DIRECTION_VT2CTP.items()}
DIRECTION_CTP2VT[THOST_FTDC_PD_Long] = Direction.LONG
DIRECTION_CTP2VT[THOST_FTDC_PD_Short] = Direction.SHORT

# 委托类型映射
ORDERTYPE_VT2CTP: dict[OrderType, tuple] = {
    OrderType.LIMIT: (THOST_FTDC_OPT_LimitPrice, THOST_FTDC_TC_GFD, THOST_FTDC_VC_AV),
    OrderType.MARKET: (THOST_FTDC_OPT_AnyPrice, THOST_FTDC_TC_GFD, THOST_FTDC_VC_AV),
    OrderType.FAK: (THOST_FTDC_OPT_LimitPrice, THOST_FTDC_TC_IOC, THOST_FTDC_VC_AV),
    OrderType.FOK: (THOST_FTDC_OPT_LimitPrice, THOST_FTDC_TC_IOC, THOST_FTDC_VC_CV),
}
ORDERTYPE_CTP2VT: dict[tuple, OrderType] = {v: k for k, v in ORDERTYPE_VT2CTP.items()}

# 开平方向映射
OFFSET_VT2CTP: dict[Offset, str] = {
    Offset.OPEN: THOST_FTDC_OF_Open,
    Offset.CLOSE: THOST_FTDC_OFEN_Close,
    Offset.CLOSETODAY: THOST_FTDC_OFEN_CloseToday,
    Offset.CLOSEYESTERDAY: THOST_FTDC_OFEN_CloseYesterday,
}
OFFSET_CTP2VT: dict[str, Offset] = {v: k for k, v in OFFSET_VT2CTP.items()}

# 交易所映射
EXCHANGE_CTP2VT: dict[str, Exchange] = {
    "CFFEX": Exchange.CFFEX,
    "SHFE": Exchange.SHFE,
    "CZCE": Exchange.CZCE,
    "DCE": Exchange.DCE,
    "INE": Exchange.INE,
    "GFEX": Exchange.GFEX
}

# 产品类型映射
PRODUCT_CTP2VT: dict[str, Product] = {
    THOST_FTDC_PC_Futures: Product.FUTURES,
    THOST_FTDC_PC_Options: Product.OPTION,
    THOST_FTDC_PC_SpotOption: Product.OPTION,
    THOST_FTDC_PC_Combination: Product.SPREAD
}

# 期权类型映射
OPTIONTYPE_CTP2VT: dict[str, OptionType] = {
    THOST_FTDC_CP_CallOptions: OptionType.CALL,
    THOST_FTDC_CP_PutOptions: OptionType.PUT
}

# 其他常量
MAX_FLOAT = sys.float_info.max                  # 浮点数极限值
CHINA_TZ = ZoneInfo("Asia/Shanghai")       # 中国时区

# 合约数据全局缓存字典
symbol_contract_map: dict[str, ContractData] = {}


class CtpGateway(BaseGateway):
    """
    VeighNa用于对接期货CTP柜台的交易接口。
    """

    default_name: str = "CTP"

    default_setting: dict[str, str | list[str]] = {  # type: ignore[assignment]
        "用户名": "",
        "密码": "",
        "经纪商代码": "",
        "交易服务器": "",
        "行情服务器": "",
        "产品名称": "",
        "授权编码": "",
        "柜台环境": ["实盘", "测试"]
    }

    exchanges: list[Exchange] = list(EXCHANGE_CTP2VT.values())

    def __init__(self, event_engine: EventEngine, gateway_name: str) -> None:
        """构造函数"""
        super().__init__(event_engine, gateway_name)

        self.td_api: CtpTdApi = CtpTdApi(self)
        self.md_api: CtpMdApi = CtpMdApi(self)

        self.count: int = 0

    def connect(self, setting: dict) -> None:
        """连接交易接口"""
        userid: str = setting["用户名"]
        password: str = setting["密码"]
        brokerid: str = setting["经纪商代码"]
        td_address: str = setting["交易服务器"]
        md_address: str = setting["行情服务器"]
        appid: str = setting["产品名称"]
        auth_code: str = setting["授权编码"]

        envrionment: str = setting.get("柜台环境", "实盘")
        production_mode: bool = envrionment == "实盘"

        self.write_log(f"[CtpGateway] ====== 开始连接 ======")
        self.write_log(f"[CtpGateway] 用户={userid} 经纪商={brokerid}")
        self.write_log(f"[CtpGateway] 交易地址={td_address} 行情地址={md_address}")
        self.write_log(f"[CtpGateway] 产品名称={appid} 授权编码={auth_code} 环境={envrionment}")

        if (
            (not td_address.startswith("tcp://"))
            and (not td_address.startswith("ssl://"))
            and (not td_address.startswith("socks"))
        ):
            td_address = "tcp://" + td_address

        if (
            (not md_address.startswith("tcp://"))
            and (not md_address.startswith("ssl://"))
            and (not md_address.startswith("socks"))
        ):
            md_address = "tcp://" + md_address
        # Store settings for auto-reconnect
        self._last_td_address = td_address
        self._last_md_address = md_address
        self._last_userid = userid
        self._last_password = password
        self._last_brokerid = brokerid
        self._last_auth_code = auth_code
        self._last_appid = appid
        self._last_production = production_mode

        self.write_log(f"[CtpGateway] → 连接交易接口 {td_address}")
        self.td_api.connect(td_address, userid, password, brokerid, auth_code, appid, production_mode)
        self.write_log(f"[CtpGateway] → 连接行情接口 {md_address}")
        self.md_api.connect(md_address, userid, password, brokerid, production_mode)

        self.init_query()

    def subscribe(self, req: SubscribeRequest) -> None:
        """订阅行情"""
        self.md_api.subscribe(req)

    def reconnect_md(self) -> None:
        """Auto-reconnect market data after disconnect (called from MdApi callback)."""
        if not hasattr(self, '_last_md_address') or not self._last_md_address:
            self.write_log("[CtpGateway] 无历史行情地址，跳过重连")
            return
        # Prevent reentrant reconnect loops
        if getattr(self, '_reconnecting_md', False):
            return
        self._reconnecting_md = True
        try:
            self.write_log(f"[CtpGateway] 🔄 自动重连行情接口 {self._last_md_address}")
            import time as _time
            _time.sleep(2)
            self.md_api = CtpMdApi(self)
            self.md_api.connect(self._last_md_address, self._last_userid, self._last_password, self._last_brokerid, self._last_production)
        except Exception as e:
            self.write_log(f"[CtpGateway] 行情重连失败: {e}")
        finally:
            self._reconnecting_md = False

    def reconnect_td(self) -> None:
        """Auto-reconnect trading after disconnect."""
        if not hasattr(self, '_last_td_address') or not self._last_td_address:
            self.write_log("[CtpGateway] 无历史交易地址，跳过重连")
            return
        if getattr(self, '_reconnecting_td', False):
            return
        self._reconnecting_td = True
        try:
            self.write_log(f"[CtpGateway] 🔄 自动重连交易接口 {self._last_td_address}")
            import time as _time
            _time.sleep(2)
            self.td_api = CtpTdApi(self)
            self.td_api.connect(self._last_td_address, self._last_userid, self._last_password, self._last_brokerid, self._last_auth_code, self._last_appid, self._last_production)
        except Exception as e:
            self.write_log(f"[CtpGateway] 交易重连失败: {e}")
        finally:
            self._reconnecting_td = False

    def send_order(self, req: OrderRequest) -> str:
        """委托下单"""
        return self.td_api.send_order(req)

    def cancel_order(self, req: CancelRequest) -> None:
        """委托撤单"""
        self.td_api.cancel_order(req)

    def query_account(self) -> None:
        """查询资金"""
        self.td_api.query_account()

    def query_position(self) -> None:
        """查询持仓"""
        self.td_api.query_position()

    def close(self) -> None:
        """关闭接口"""
        self.td_api.close()
        self.md_api.close()

    def write_error(self, msg: str, error: dict) -> None:
        """输出错误信息日志"""
        error_id: int = error["ErrorID"]
        error_msg: str = error["ErrorMsg"]

        log_msg: str = f"{msg}，代码：{error_id}，信息：{error_msg}"
        self.write_log(log_msg)

    def process_timer_event(self, event: Event) -> None:
        """定时事件处理"""
        self.count += 1
        if self.count < 2:
            return
        self.count = 0

        func = self.query_functions.pop(0)
        func()
        self.query_functions.append(func)

        self.md_api.update_date()

    def init_query(self) -> None:
        """初始化查询任务"""
        self.query_functions: list = [self.query_account, self.query_position]
        self.event_engine.register(EVENT_TIMER, self.process_timer_event)


class CtpMdApi(MdApi):
    """"""

    def __init__(self, gateway: CtpGateway) -> None:
        """构造函数"""
        super().__init__()

        self.gateway: CtpGateway = gateway
        self.gateway_name: str = gateway.gateway_name

        self.reqid: int = 0

        self.connect_status: bool = False
        self.login_status: bool = False
        self.subscribed: set = set()

        self.userid: str = ""
        self.password: str = ""
        self.brokerid: str = ""

        self.current_date: str = datetime.now().strftime("%Y%m%d")

    def onFrontConnected(self) -> None:
        """服务器连接成功回报"""
        now = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        self.gateway.write_log(f"[MdApi] onFrontConnected 行情服务器TCP连接成功 [{now}]")
        self.gateway.write_log(f"[MdApi] → 即将登录: user={self.userid}, broker={self.brokerid}")
        self.login()

    def onFrontDisconnected(self, reason: int) -> None:
        """服务器连接断开回报"""
        self.login_status = False
        self.connect_status = False
        desc = _disconnect_reason_text(reason)
        self.gateway.write_log(f"[MdApi] ❌ 行情连接断开! reason={reason} (0x{reason:04X}) → {desc}")
        self.gateway.write_log(f"[MdApi]    connect_status={self.connect_status} login_status={self.login_status}")

    def onRspUserLogin(self, data: dict, error: dict, reqid: int, last: bool) -> None:
        """用户登录请求回报"""
        if not error["ErrorID"]:
            self.login_status = True
            self.gateway.write_log("[MdApi] ✅ 行情登录成功")
            for symbol in self.subscribed:
                self.subscribeMarketData(symbol)
        else:
            self.gateway.write_log(f"[MdApi] ❌ 行情登录失败! reqid={reqid} last={last}")
            self.gateway.write_log(f"[MdApi] 回包详情:\n{_format_error(error, data)}")
            self.gateway.write_error("行情服务器登录失败", error)

    def onRspError(self, error: dict, reqid: int, last: bool) -> None:
        """请求报错回报"""
        self.gateway.write_log(f"[MdApi] ❌ onRspError reqid={reqid} last={last}")
        self.gateway.write_log(f"[MdApi] 回包详情:\n{_format_error(error)}")
        self.gateway.write_error("行情接口报错", error)

    def onRspSubMarketData(self, data: dict, error: dict, reqid: int, last: bool) -> None:
        """订阅行情回报"""
        self.gateway.write_log(f"[MdApi] onRspSubMarketData reqid={reqid} data={data} error={error}")
        if not error or not error["ErrorID"]:
            self.gateway.write_log(f"[MdApi] ✅ 行情订阅成功: {data.get('InstrumentID','?')}")
            return
        self.gateway.write_error("行情订阅失败", error)

    def onRtnDepthMarketData(self, data: dict) -> None:
        """行情数据推送"""
        # 过滤没有时间戳的异常行情数据
        if not data["UpdateTime"]:
            return

        # 合约查找：如果 symbol_contract_map 中没有（TD 未登录时），自动创建占位合约
        symbol: str = data["InstrumentID"]
        contract: ContractData | None = symbol_contract_map.get(symbol, None)
        if not contract:
            # MD-only mode: guess exchange from symbol prefix
            exchange = _guess_exchange(symbol)
            contract = ContractData(
                symbol=symbol,
                exchange=exchange,
                name=symbol,
                product=Product.FUTURES,
                size=1,
                pricetick=1.0,
                min_volume=1,
                gateway_name=self.gateway_name,
            )
            symbol_contract_map[symbol] = contract
            self.gateway.on_contract(contract)

        # 对大商所的交易日字段取本地日期
        if not data["ActionDay"] or contract.exchange == Exchange.DCE:
            date_str: str = self.current_date
        else:
            date_str = data["ActionDay"]

        timestamp: str = f"{date_str} {data['UpdateTime']}.{data['UpdateMillisec']}"
        dt: datetime = datetime.strptime(timestamp, "%Y%m%d %H:%M:%S.%f")
        dt = dt.replace(tzinfo=CHINA_TZ)

        tick: TickData = TickData(
            symbol=symbol,
            exchange=contract.exchange,
            datetime=dt,
            name=contract.name,
            volume=data["Volume"],
            turnover=data["Turnover"],
            open_interest=data["OpenInterest"],
            last_price=adjust_price(data["LastPrice"]),
            limit_up=data["UpperLimitPrice"],
            limit_down=data["LowerLimitPrice"],
            open_price=adjust_price(data["OpenPrice"]),
            high_price=adjust_price(data["HighestPrice"]),
            low_price=adjust_price(data["LowestPrice"]),
            pre_close=adjust_price(data["PreClosePrice"]),
            bid_price_1=adjust_price(data["BidPrice1"]),
            ask_price_1=adjust_price(data["AskPrice1"]),
            bid_volume_1=data["BidVolume1"],
            ask_volume_1=data["AskVolume1"],
            gateway_name=self.gateway_name
        )

        if data["BidVolume2"] or data["AskVolume2"]:
            tick.bid_price_2 = adjust_price(data["BidPrice2"])
            tick.bid_price_3 = adjust_price(data["BidPrice3"])
            tick.bid_price_4 = adjust_price(data["BidPrice4"])
            tick.bid_price_5 = adjust_price(data["BidPrice5"])

            tick.ask_price_2 = adjust_price(data["AskPrice2"])
            tick.ask_price_3 = adjust_price(data["AskPrice3"])
            tick.ask_price_4 = adjust_price(data["AskPrice4"])
            tick.ask_price_5 = adjust_price(data["AskPrice5"])

            tick.bid_volume_2 = data["BidVolume2"]
            tick.bid_volume_3 = data["BidVolume3"]
            tick.bid_volume_4 = data["BidVolume4"]
            tick.bid_volume_5 = data["BidVolume5"]

            tick.ask_volume_2 = data["AskVolume2"]
            tick.ask_volume_3 = data["AskVolume3"]
            tick.ask_volume_4 = data["AskVolume4"]
            tick.ask_volume_5 = data["AskVolume5"]

        self.gateway.on_tick(tick)

    def connect(
        self,
        address: str,
        userid: str,
        password: str,
        brokerid: str,
        production_mode: bool
    ) -> None:
        """连接服务器"""
        t0 = time.time()
        self.userid = userid
        self.password = password
        self.brokerid = brokerid

        self.gateway.write_log(f"[MdApi] connect: address={address} user={userid} broker={brokerid} production={production_mode}")

        # 禁止重复发起连接，会导致异常崩溃
        if not self.connect_status:
            path: Path = get_folder_path(self.gateway_name.lower())
            flow_path = (str(path) + "\\Md").encode("GBK")
            self.gateway.write_log(f"[MdApi] → createFtdcMdApi flowPath={path}\\Md")
            api = self.createFtdcMdApi(flow_path, production_mode)
            t1 = time.time()
            api_str = f"{api:#x}" if api is not None else "OK(C++)"
            self.gateway.write_log(f"[MdApi]   createFtdcMdApi 完成, api={api_str}, 耗时={(t1-t0)*1000:.0f}ms")

            self.gateway.write_log(f"[MdApi] → registerFront {address}")
            self.registerFront(address)
            t2 = time.time()
            self.gateway.write_log(f"[MdApi]   registerFront 完成, 耗时={(t2-t1)*1000:.0f}ms")

            self.gateway.write_log(f"[MdApi] → init() 开始建立TCP连接...")
            ret = self.init()
            t3 = time.time()
            self.gateway.write_log(f"[MdApi]   init() 返回={ret} (None/0=成功), 总耗时={(t3-t0)*1000:.0f}ms")

            self.connect_status = True

    def login(self) -> None:
        """用户登录"""
        ctp_req: dict = {
            "UserID": self.userid,
            "Password": self.password,
            "BrokerID": self.brokerid
        }
        self.reqid += 1
        self.gateway.write_log(f"[MdApi] → reqUserLogin reqid={self.reqid} user={self.userid} broker={self.brokerid}")
        ret = self.reqUserLogin(ctp_req, self.reqid)
        self.gateway.write_log(f"[MdApi]   reqUserLogin 返回={ret} (0=成功)")

    def subscribe(self, req: SubscribeRequest) -> None:
        """订阅行情"""
        self.gateway.write_log(f"[MdApi] subscribe: symbol={req.symbol} exchange={req.exchange} login_status={self.login_status}")
        if self.login_status:
            self.subscribeMarketData(req.symbol)
        self.subscribed.add(req.symbol)

    def close(self) -> None:
        """关闭连接"""
        if self.connect_status:
            self.gateway.write_log("[MdApi] → exit()")
            self.exit()

    def update_date(self) -> None:
        """更新当前日期"""
        self.current_date = datetime.now().strftime("%Y%m%d")


class CtpTdApi(TdApi):
    """"""

    def __init__(self, gateway: CtpGateway) -> None:
        """构造函数"""
        super().__init__()

        self.gateway: CtpGateway = gateway
        self.gateway_name: str = gateway.gateway_name

        self.reqid: int = 0
        self.order_ref: int = 0

        self.connect_status: bool = False
        self.login_status: bool = False
        self.auth_status: bool = False
        self.login_failed: bool = False
        self.auth_failed: bool = False
        self.contract_inited: bool = False

        self.userid: str = ""
        self.password: str = ""
        self.brokerid: str = ""
        self.auth_code: str = ""
        self.appid: str = ""

        self.frontid: int = 0
        self.sessionid: int = 0
        self.order_data: list[dict] = []
        self.trade_data: list[dict] = []
        self.positions: dict[str, PositionData] = {}
        self.sysid_orderid_map: dict[str, str] = {}

    def onFrontConnected(self) -> None:
        """服务器连接成功回报"""
        now = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        self.gateway.write_log(f"[TdApi] onFrontConnected 交易服务器TCP连接成功 [{now}]")
        if self.auth_code:
            self.gateway.write_log(f"[TdApi] → 需要认证 auth_code=*** appid='{self.appid}'，调用 authenticate()")
            self.authenticate()
        else:
            self.gateway.write_log("[TdApi] → 无需认证(授权编码为空)，直接调用 login()")
            self.login()

    def onFrontDisconnected(self, reason: int) -> None:
        """服务器连接断开回报"""
        self.login_status = False
        self.connect_status = False
        desc = _disconnect_reason_text(reason)
        self.gateway.write_log(f"[TdApi] ❌ 交易连接断开! reason={reason} (0x{reason:04X}) → {desc}")
        self.gateway.write_log(f"[TdApi]    connect_status={self.connect_status} login_status={self.login_status} auth_status={self.auth_status}")

    def onRspAuthenticate(self, data: dict, error: dict, reqid: int, last: bool) -> None:
        """用户授权验证回报"""
        if not error['ErrorID']:
            self.auth_status = True
            self.gateway.write_log("[TdApi] ✅ 认证成功，→ login()")
            self.login()
        else:
            if error['ErrorID'] == 63:
                self.auth_failed = True
            self.gateway.write_log(f"[TdApi] ❌ 认证失败! reqid={reqid} last={last}")
            self.gateway.write_log(f"[TdApi] 回包详情:\n{_format_error(error, data)}")
            self.gateway.write_error("交易服务器授权验证失败", error)

    def onRspUserLogin(self, data: dict, error: dict, reqid: int, last: bool) -> None:
        """用户登录请求回报"""
        if not error["ErrorID"]:
            self.frontid = data["FrontID"]
            self.sessionid = data["SessionID"]
            self.login_status = True
            self.gateway.write_log(f"[TdApi] ✅ 交易登录成功! FrontID={self.frontid} SessionID={self.sessionid}")
            self.gateway.write_log("[TdApi] → reqSettlementInfoConfirm 确认结算单...")
            ctp_req: dict = {
                "BrokerID": self.brokerid,
                "InvestorID": self.userid
            }
            self.reqid += 1
            self.reqSettlementInfoConfirm(ctp_req, self.reqid)
        else:
            self.login_failed = True
            self.gateway.write_log(f"[TdApi] ❌ 交易登录失败! reqid={reqid} last={last}")
            self.gateway.write_log(f"[TdApi] 回包详情:\n{_format_error(error, data)}")
            self.gateway.write_error("交易服务器登录失败", error)

    def onRspOrderInsert(self, data: dict, error: dict, reqid: int, last: bool) -> None:
        """委托下单失败回报"""
        order_ref: str = data["OrderRef"]
        orderid: str = f"{self.frontid}_{self.sessionid}_{order_ref}"

        symbol: str = data["InstrumentID"]
        contract: ContractData = symbol_contract_map[symbol]

        order: OrderData = OrderData(
            symbol=symbol,
            exchange=contract.exchange,
            orderid=orderid,
            direction=DIRECTION_CTP2VT[data["Direction"]],
            offset=OFFSET_CTP2VT.get(data["CombOffsetFlag"], Offset.NONE),
            price=data["LimitPrice"],
            volume=data["VolumeTotalOriginal"],
            status=Status.REJECTED,
            gateway_name=self.gateway_name
        )
        self.gateway.on_order(order)

        self.gateway.write_error("交易委托失败", error)

    def onRspOrderAction(self, data: dict, error: dict, reqid: int, last: bool) -> None:
        """委托撤单失败回报"""
        self.gateway.write_error("交易撤单失败", error)

    def onRspSettlementInfoConfirm(self, data: dict, error: dict, reqid: int, last: bool) -> None:
        """确认结算单回报"""
        self.gateway.write_log(f"[TdApi] onRspSettlementInfoConfirm 结算确认成功 error={error}")
        self.gateway.write_log("[TdApi] → reqQryInstrument 查询合约...")

        # 由于流控，单次查询可能失败，通过while循环持续尝试，直到成功发出请求
        attempt = 0
        while True:
            self.reqid += 1
            n: int = self.reqQryInstrument({}, self.reqid)
            if not n:
                self.gateway.write_log(f"[TdApi] ✅ reqQryInstrument 请求发送成功 reqid={self.reqid} (尝试{attempt+1}次)")
                break
            else:
                attempt += 1
                self.gateway.write_log(f"[TdApi] ⚠️ reqQryInstrument 流控重试 ret={n} 尝试#{attempt}")
                sleep(1)

    def onRspQryInvestorPosition(self, data: dict, error: dict, reqid: int, last: bool) -> None:
        """持仓查询回报"""
        if not data:
            return

        # 必须已经收到了合约信息后才能处理
        symbol: str = data["InstrumentID"]
        contract: ContractData | None = symbol_contract_map.get(symbol, None)

        if contract:
            # 获取之前缓存的持仓数据缓存
            key: str = f"{data['InstrumentID'], data['PosiDirection']}"
            position: PositionData | None = self.positions.get(key, None)
            if not position:
                position = PositionData(
                    symbol=data["InstrumentID"],
                    exchange=contract.exchange,
                    direction=DIRECTION_CTP2VT[data["PosiDirection"]],
                    gateway_name=self.gateway_name
                )
                self.positions[key] = position

            # 对于上期所昨仓需要特殊处理
            if position.exchange in {Exchange.SHFE, Exchange.INE}:
                if data["YdPosition"] and not data["TodayPosition"]:
                    position.yd_volume = data["Position"]
            # 对于其他交易所昨仓的计算
            else:
                position.yd_volume = data["Position"] - data["TodayPosition"]

            # 获取合约的乘数信息
            size: float = contract.size

            # 计算之前已有仓位的持仓总成本
            cost: float = position.price * position.volume * size

            # 累加更新持仓数量和盈亏
            position.volume += data["Position"]
            position.pnl += data["PositionProfit"]

            # 计算更新后的持仓总成本和均价
            if position.volume and size:
                cost += data["PositionCost"]
                position.price = cost / (position.volume * size)

            # 更新仓位冻结数量
            if position.direction == Direction.LONG:
                position.frozen += data["ShortFrozen"]
            else:
                position.frozen += data["LongFrozen"]

        if last:
            for position in self.positions.values():
                self.gateway.on_position(position)

            self.positions.clear()

    def onRspQryTradingAccount(self, data: dict, error: dict, reqid: int, last: bool) -> None:
        """资金查询回报"""
        if "AccountID" not in data:
            return

        account: AccountData = AccountData(
            accountid=data["AccountID"],
            balance=data["Balance"],
            frozen=data["FrozenMargin"] + data["FrozenCash"] + data["FrozenCommission"],
            gateway_name=self.gateway_name
        )
        account.available = data["Available"]

        self.gateway.on_account(account)

    def onRspQryInstrument(self, data: dict, error: dict, reqid: int, last: bool) -> None:
        """合约查询回报"""
        product: Product | None = PRODUCT_CTP2VT.get(data["ProductClass"], None)
        if product:
            contract: ContractData = ContractData(
                symbol=data["InstrumentID"],
                exchange=EXCHANGE_CTP2VT[data["ExchangeID"]],
                name=data["InstrumentName"],
                product=product,
                size=data["VolumeMultiple"],
                pricetick=data["PriceTick"],
                min_volume=data["MinLimitOrderVolume"],
                max_volume=data["MaxLimitOrderVolume"],
                gateway_name=self.gateway_name
            )

            # 期权相关
            if contract.product == Product.OPTION:
                # 移除郑商所期权产品名称带有的C/P后缀
                if contract.exchange == Exchange.CZCE:
                    contract.option_portfolio = data["ProductID"][:-1]
                else:
                    contract.option_portfolio = data["ProductID"]

                contract.option_underlying = data["UnderlyingInstrID"]
                contract.option_type = OPTIONTYPE_CTP2VT.get(data["OptionsType"], None)
                contract.option_strike = data["StrikePrice"]
                contract.option_index = str(data["StrikePrice"])
                contract.option_listed = datetime.strptime(data["OpenDate"], "%Y%m%d")
                contract.option_expiry = datetime.strptime(data["ExpireDate"], "%Y%m%d")

            self.gateway.on_contract(contract)

            symbol_contract_map[contract.symbol] = contract

        if last:
            self.contract_inited = True
            self.gateway.write_log(f"[TdApi] ✅ 合约信息查询成功! 共{symbol_contract_map.__len__()}个合约")

            for data in self.order_data:
                self.onRtnOrder(data)
            self.order_data.clear()

            for data in self.trade_data:
                self.onRtnTrade(data)
            self.trade_data.clear()

    def onRtnOrder(self, data: dict) -> None:
        """委托更新推送"""
        if not self.contract_inited:
            self.order_data.append(data)
            return

        symbol: str = data["InstrumentID"]
        contract: ContractData = symbol_contract_map[symbol]

        frontid: int = data["FrontID"]
        sessionid: int = data["SessionID"]
        order_ref: str = data["OrderRef"]
        orderid: str = f"{frontid}_{sessionid}_{order_ref}"

        status: Status | None = STATUS_CTP2VT.get(data["OrderStatus"], None)
        if not status:
            self.gateway.write_log(f"收到不支持的委托状态，委托号：{orderid}")
            return

        # 因为报单提交被拒绝导致的撤单状态，需要调整映射为拒单状态
        if (
            data["OrderStatus"] == THOST_FTDC_OST_Canceled
            and data["OrderSubmitStatus"] == THOST_FTDC_OSS_InsertRejected
        ):
            status = Status.REJECTED

        timestamp: str = f"{data['InsertDate']} {data['InsertTime']}"
        dt: datetime = datetime.strptime(timestamp, "%Y%m%d %H:%M:%S")
        dt = dt.replace(tzinfo=CHINA_TZ)

        tp: tuple = (data["OrderPriceType"], data["TimeCondition"], data["VolumeCondition"])
        order_type: OrderType | None = ORDERTYPE_CTP2VT.get(tp, None)
        if not order_type:
            self.gateway.write_log(f"收到不支持的委托类型，委托号：{orderid}")
            return

        order: OrderData = OrderData(
            symbol=symbol,
            exchange=contract.exchange,
            orderid=orderid,
            type=order_type,
            direction=DIRECTION_CTP2VT[data["Direction"]],
            offset=OFFSET_CTP2VT[data["CombOffsetFlag"]],
            price=data["LimitPrice"],
            volume=data["VolumeTotalOriginal"],
            traded=data["VolumeTraded"],
            status=status,
            datetime=dt,
            gateway_name=self.gateway_name
        )
        self.gateway.on_order(order)

        self.sysid_orderid_map[data["OrderSysID"]] = orderid

        # 特殊情况撤单（非交易时段、资金不足等）的日志输出
        status_msg: str = data["StatusMsg"]
        if (
            data["OrderStatus"] == THOST_FTDC_OST_Canceled
            and status_msg != "已撤单"       # 正常撤单
        ):
            self.gateway.write_log(f"委托 {orderid} 状态更新，{status_msg}")

    def onRtnTrade(self, data: dict) -> None:
        """成交数据推送"""
        if not self.contract_inited:
            self.trade_data.append(data)
            return

        symbol: str = data["InstrumentID"]
        contract: ContractData = symbol_contract_map[symbol]

        orderid: str = self.sysid_orderid_map[data["OrderSysID"]]

        timestamp: str = f"{data['TradeDate']} {data['TradeTime']}"
        dt: datetime = datetime.strptime(timestamp, "%Y%m%d %H:%M:%S")
        dt = dt.replace(tzinfo=CHINA_TZ)

        trade: TradeData = TradeData(
            symbol=symbol,
            exchange=contract.exchange,
            orderid=orderid,
            tradeid=data["TradeID"],
            direction=DIRECTION_CTP2VT[data["Direction"]],
            offset=OFFSET_CTP2VT[data["OffsetFlag"]],
            price=data["Price"],
            volume=data["Volume"],
            datetime=dt,
            gateway_name=self.gateway_name
        )
        self.gateway.on_trade(trade)

    def connect(
        self,
        address: str,
        userid: str,
        password: str,
        brokerid: str,
        auth_code: str,
        appid: str,
        production_mode: bool
    ) -> None:
        """连接服务器"""
        t0 = time.time()
        self.userid = userid
        self.password = password
        self.brokerid = brokerid
        self.auth_code = auth_code
        self.appid = appid

        self.gateway.write_log(f"[TdApi] connect: address={address} user={userid} broker={brokerid} auth={'有' if auth_code else '无'} appid='{appid}' production={production_mode}")

        if not self.connect_status:
            path: Path = get_folder_path(self.gateway_name.lower())
            self.gateway.write_log(f"[TdApi] → createFtdcTraderApi flowPath={path}\\Td")
            api = self.createFtdcTraderApi((str(path) + "\\Td").encode("GBK"), production_mode)
            t1 = time.time()
            api_str = f"{api:#x}" if api is not None else "OK(C++)"
            self.gateway.write_log(f"[TdApi]   createFtdcTraderApi 完成, api={api_str}, 耗时={(t1-t0)*1000:.0f}ms")

            self.gateway.write_log("[TdApi] → subscribePrivateTopic(TERT_RESTART) subscribePublicTopic(TERT_RESTART)")
            self.subscribePrivateTopic(0)
            self.subscribePublicTopic(0)
            t2 = time.time()
            self.gateway.write_log(f"[TdApi]   subscribe 完成, 耗时={(t2-t1)*1000:.0f}ms")

            self.gateway.write_log(f"[TdApi] → registerFront {address}")
            self.registerFront(address)
            t3 = time.time()
            self.gateway.write_log(f"[TdApi]   registerFront 完成, 耗时={(t3-t2)*1000:.0f}ms")

            self.gateway.write_log("[TdApi] → init() 开始建立TCP连接...")
            ret = self.init()
            t4 = time.time()
            self.gateway.write_log(f"[TdApi]   init() 返回={ret} (None/0=成功), 总耗时={(t4-t0)*1000:.0f}ms")

            self.connect_status = True
        else:
            self.authenticate()

    def authenticate(self) -> None:
        """发起授权验证"""
        if self.auth_failed:
            return

        ctp_req: dict = {
            "UserID": self.userid,
            "BrokerID": self.brokerid,
            "AuthCode": self.auth_code,
            "AppID": self.appid
        }

        self.reqid += 1
        self.gateway.write_log(f"[TdApi] → reqAuthenticate reqid={self.reqid} user={self.userid} appid='{self.appid}'")
        ret = self.reqAuthenticate(ctp_req, self.reqid)
        self.gateway.write_log(f"[TdApi]   reqAuthenticate 返回={ret} (0=成功)")

    def login(self) -> None:
        """用户登录"""
        if self.login_failed:
            return

        ctp_req: dict = {
            "UserID": self.userid,
            "Password": self.password,
            "BrokerID": self.brokerid
        }

        self.reqid += 1
        self.gateway.write_log(f"[TdApi] → reqUserLogin reqid={self.reqid} user={self.userid} broker={self.brokerid}")
        ret = self.reqUserLogin(ctp_req, self.reqid)
        self.gateway.write_log(f"[TdApi]   reqUserLogin 返回={ret} (0=成功)")

    def send_order(self, req: OrderRequest) -> str:
        """委托下单"""
        if req.offset not in OFFSET_VT2CTP:
            self.gateway.write_log("请选择开平方向")
            return ""

        if req.type not in ORDERTYPE_VT2CTP:
            self.gateway.write_log(f"当前接口不支持该类型的委托{req.type.value}")
            return ""

        self.order_ref += 1

        tp: tuple = ORDERTYPE_VT2CTP[req.type]
        price_type, time_condition, volume_condition = tp

        ctp_req: dict = {
            "InstrumentID": req.symbol,
            "ExchangeID": req.exchange.value,
            "LimitPrice": req.price,
            "VolumeTotalOriginal": int(req.volume),
            "OrderPriceType": price_type,
            "Direction": DIRECTION_VT2CTP.get(req.direction, ""),
            "CombOffsetFlag": OFFSET_VT2CTP.get(req.offset, ""),
            "OrderRef": str(self.order_ref),
            "InvestorID": self.userid,
            "UserID": self.userid,
            "BrokerID": self.brokerid,
            "CombHedgeFlag": THOST_FTDC_HF_Speculation,
            "ContingentCondition": THOST_FTDC_CC_Immediately,
            "ForceCloseReason": THOST_FTDC_FCC_NotForceClose,
            "IsAutoSuspend": 0,
            "TimeCondition": time_condition,
            "VolumeCondition": volume_condition,
            "MinVolume": 1
        }

        self.reqid += 1
        n: int = self.reqOrderInsert(ctp_req, self.reqid)
        if n:
            self.gateway.write_log(f"委托请求发送失败，错误代码：{n}")
            return ""

        orderid: str = f"{self.frontid}_{self.sessionid}_{self.order_ref}"
        order: OrderData = req.create_order_data(orderid, self.gateway_name)
        self.gateway.on_order(order)

        return order.vt_orderid

    def cancel_order(self, req: CancelRequest) -> None:
        """委托撤单"""
        frontid, sessionid, order_ref = req.orderid.split("_")

        ctp_req: dict = {
            "InstrumentID": req.symbol,
            "ExchangeID": req.exchange.value,
            "OrderRef": order_ref,
            "FrontID": int(frontid),
            "SessionID": int(sessionid),
            "ActionFlag": THOST_FTDC_AF_Delete,
            "BrokerID": self.brokerid,
            "InvestorID": self.userid
        }

        self.reqid += 1
        self.reqOrderAction(ctp_req, self.reqid)

    def query_account(self) -> None:
        """查询资金"""
        self.reqid += 1
        self.reqQryTradingAccount({}, self.reqid)

    def query_position(self) -> None:
        """查询持仓"""
        if not symbol_contract_map:
            return

        ctp_req: dict = {
            "BrokerID": self.brokerid,
            "InvestorID": self.userid
        }

        self.reqid += 1
        self.reqQryInvestorPosition(ctp_req, self.reqid)

    def query_contract(self) -> None:
        """查询合约（主动触发）"""
        if not self.login_status:
            return
        self.reqid += 1
        n: int = self.reqQryInstrument({}, self.reqid)
        self.gateway.write_log(f"[TdApi] query_contract 手动触发 reqid={self.reqid} ret={n}")

    def close(self) -> None:
        """关闭连接"""
        if self.connect_status:
            self.exit()


# ---------------------------------------------------------------------------
# CTP disconnect reason code descriptions
# ---------------------------------------------------------------------------
_CTP_DISCONNECT_REASONS: dict[int, str] = {
    0x1001: "网络读失败",
    0x1002: "网络写失败",
    0x2001: "还未建立连接",
    0x2002: "重复连接",
    0x2003: "还未认证",
    0x2004: "客户端认证失败",
    0x2005: "客户端认证参数错误",
    0x2006: "客户端未初始化",
    0x2007: "密码错误",
    0x2008: "重复认证",
    0x2009: "认证失败",
    0x200A: "未登录",
    0x200B: "未初始化",
    0x3001: "发送报文失败",
    0x3002: "接收报文失败",
    0x3003: "对端关闭了连接",
    0x3004: "网络超时",
    0x3005: "网络初始化失败",
    0x3006: "该会话不能重连",
    0x3007: "该会话连接数满",
    0x3008: "该用户连接数满",
    0x4001: "前置网络异常",
    0x4002: "前置主动关闭连接",
    0x4003: "前置未启动",
    0x4004: "前置不可达",
    0x4005: "前置已关闭",
    0x4006: "前置拒绝连接",
    0x4007: "前置鉴权失败",
    0x4008: "前置版本不匹配",
    0x4009: "前置已断开",
    0x400A: "前置会话数满",
    0x400B: "前置用户数满",
    0x400C: "前置数据同步中",
    0x400D: "前置流控拒绝",
    0x5001: "API版本不匹配",
    0x5002: "API初始化失败",
}


def _format_error(error: dict, data: dict | None = None) -> str:
    """Format CTP error response for detailed logging."""
    lines = []
    lines.append(f"  ErrorID  : {error.get('ErrorID', '?')}")
    lines.append(f"  ErrorMsg : {error.get('ErrorMsg', '?')}")
    if data:
        for k, v in data.items():
            if v and k not in ("ErrorID", "ErrorMsg"):
                lines.append(f"  {k}: {v}")
    return "\n".join(lines)


def _disconnect_reason_text(reason: int) -> str:
    """Return human-readable CTP disconnect reason."""
    desc = _CTP_DISCONNECT_REASONS.get(reason, "")
    return f"{desc}" if desc else f"未知原因码"


# ---------------------------------------------------------------------------
# Exchange guessing for MD-only mode (when TD is not connected)
# ---------------------------------------------------------------------------
_EXCHANGE_PREFIX: dict[str, Exchange] = {
    # Shanghai
    "rb": Exchange.SHFE, "wr": Exchange.SHFE, "hc": Exchange.SHFE,
    "cu": Exchange.SHFE, "al": Exchange.SHFE, "zn": Exchange.SHFE,
    "pb": Exchange.SHFE, "ni": Exchange.SHFE, "sn": Exchange.SHFE,
    "au": Exchange.SHFE, "ag": Exchange.SHFE, "bu": Exchange.SHFE,
    "ru": Exchange.SHFE, "sp": Exchange.SHFE, "fu": Exchange.SHFE,
    "ss": Exchange.SHFE, "ao": Exchange.SHFE, "br": Exchange.SHFE,
    # Dalian
    "c": Exchange.DCE, "cs": Exchange.DCE, "a": Exchange.DCE,
    "b": Exchange.DCE, "m": Exchange.DCE, "y": Exchange.DCE,
    "p": Exchange.DCE, "l": Exchange.DCE, "v": Exchange.DCE,
    "pp": Exchange.DCE, "j": Exchange.DCE, "jm": Exchange.DCE,
    "i": Exchange.DCE, "jd": Exchange.DCE, "eg": Exchange.DCE,
    "eb": Exchange.DCE, "pg": Exchange.DCE, "lh": Exchange.DCE,
    "rr": Exchange.DCE, "fb": Exchange.DCE, "bb": Exchange.DCE,
    # Zhengzhou
    "CF": Exchange.CZCE, "SR": Exchange.CZCE, "TA": Exchange.CZCE,
    "OI": Exchange.CZCE, "RI": Exchange.CZCE, "MA": Exchange.CZCE,
    "FG": Exchange.CZCE, "ZC": Exchange.CZCE, "RM": Exchange.CZCE,
    "RS": Exchange.CZCE, "JR": Exchange.CZCE, "LR": Exchange.CZCE,
    "WH": Exchange.CZCE, "PM": Exchange.CZCE, "SF": Exchange.CZCE,
    "SM": Exchange.CZCE, "UR": Exchange.CZCE, "SA": Exchange.CZCE,
    "PF": Exchange.CZCE, "PK": Exchange.CZCE, "SH": Exchange.CZCE,
    "AP": Exchange.CZCE, "CJ": Exchange.CZCE, "CY": Exchange.CZCE,
    # Mid-financial
    "IF": Exchange.CFFEX, "IC": Exchange.CFFEX, "IH": Exchange.CFFEX,
    "IM": Exchange.CFFEX, "T": Exchange.CFFEX, "TF": Exchange.CFFEX,
    "TS": Exchange.CFFEX, "TL": Exchange.CFFEX,
    # Energy
    "sc": Exchange.INE, "lu": Exchange.INE, "nr": Exchange.INE,
    "bc": Exchange.INE,
    # Guangzhou
    "si": Exchange.GFEX, "lc": Exchange.GFEX,
}


def _guess_exchange(symbol: str) -> Exchange:
    """Guess exchange from symbol prefix for MD-only mode."""
    # Try exact prefix match first (e.g., "rb2510" -> "rb")
    import re
    m = re.match(r'^([A-Za-z]+)', symbol)
    if m:
        prefix = m.group(1).lower()
        for pf, ex in _EXCHANGE_PREFIX.items():
            if prefix == pf.lower():
                return ex
    return Exchange.SHFE  # default


def adjust_price(price: float) -> float:
    """将异常的浮点数最大值（MAX_FLOAT）数据调整为0"""
    if price == MAX_FLOAT:
        price = 0
    return price
