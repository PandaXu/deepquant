"""
DeepQuant CTP Gateway — Standalone Launcher.

Launch the CTP gateway independently without the full server.
Reads account credentials from the database and subscribes to market data.

Usage:
    python run_gateway.py --default --symbols rb2501.SHFE,ag2501.SHFE
    python run_gateway.py --account 3
    python run_gateway.py --account SimNow --symbols rb2501.SHFE
    python run_gateway.py --list-accounts
    python run_gateway.py -h
"""
import signal
import sys
import threading
import time
from datetime import datetime

from loguru import logger

from deepquant.event import EventEngine, Event
from deepquant.trader.engine import MainEngine
from deepquant.trader.event import (
    EVENT_TICK,
    EVENT_ORDER,
    EVENT_TRADE,
    EVENT_POSITION,
    EVENT_ACCOUNT,
    EVENT_CONTRACT,
    EVENT_LOG,
)
from deepquant.trader.object import SubscribeRequest, TickData
from deepquant.trader.utility import extract_vt_symbol

from deepquant_ctp import CtpGateway

# DB account reading (cross-package import from server)
try:
    from deepquant_server.account_store import (
        get_accounts,
        get_account,
        get_default_account,
    )
    HAS_ACCOUNT_STORE = True
except ImportError:
    HAS_ACCOUNT_STORE = False


# ---------------------------------------------------------------------------
# CLI argument parsing
# ---------------------------------------------------------------------------
USAGE = """\
用法: python run_gateway.py [选项]

选项:
  --default               使用数据库中的默认账户
  --account <id|名称>      按 ID 或别名选择账户
  --symbols <列表>          逗号分隔的订阅合约 (如 rb2501.SHFE,ag2501.SHFE)
  --list-accounts           列出所有已保存账户并退出
  --debug                   打印详尽握手日志 (等同 --log-level TRACE)
  --log-level <级别>        日志级别: TRACE/DEBUG/INFO/WARNING/ERROR (默认 INFO)
  -h, --help                显示此帮助信息

示例:
  python run_gateway.py --default --symbols rb2501.SHFE
  python run_gateway.py --account SimNow --symbols rb2501.SHFE,ag2501.SHFE
  python run_gateway.py --list-accounts
"""


def parse_args(argv: list[str]) -> dict:
    """Parse CLI arguments manually (matching project style)."""
    opts: dict = {
        "use_default": False,
        "account": None,       # str: id or alias
        "symbols": "",
        "list_accounts": False,
        "log_level": "INFO",
        "debug": False,
        "help": False,
    }
    i = 0
    while i < len(argv):
        arg = argv[i]
        if arg in ("-h", "--help"):
            opts["help"] = True
            i += 1
        elif arg == "--default":
            opts["use_default"] = True
            i += 1
        elif arg == "--account":
            if i + 1 < len(argv):
                opts["account"] = argv[i + 1]
                i += 2
            else:
                logger.error("--account 需要参数: <id|名称>")
                sys.exit(1)
        elif arg == "--symbols":
            if i + 1 < len(argv):
                opts["symbols"] = argv[i + 1]
                i += 2
            else:
                logger.error("--symbols 需要参数: <合约列表>")
                sys.exit(1)
        elif arg == "--list-accounts":
            opts["list_accounts"] = True
            i += 1
        elif arg == "--debug":
            opts["debug"] = True
            opts["log_level"] = "TRACE"
            i += 1
        elif arg == "--log-level":
            if i + 1 < len(argv):
                opts["log_level"] = argv[i + 1].upper()
                i += 2
            else:
                logger.error("--log-level 需要参数: TRACE/DEBUG/INFO/WARNING/ERROR")
                sys.exit(1)
        else:
            logger.error(f"未知参数: {arg}")
            print(USAGE)
            sys.exit(1)
    return opts


# ---------------------------------------------------------------------------
# Account resolution
# ---------------------------------------------------------------------------
def list_accounts() -> None:
    """Print all saved accounts to console."""
    accounts = get_accounts()
    if not accounts:
        print("没有已保存的账户。请先通过 Server GUI 或 REST API 添加账户。")
        return
    print(f"\n{'ID':<4} {'别名':<20} {'网关':<8} {'默认':<6} {'用户名':<20} {'交易服务器':<40}")
    print("-" * 100)
    for a in accounts:
        s = a.get("setting", {})
        is_default = "★" if a.get("is_default") else ""
        print(f"{a['id']:<4} {a['alias']:<20} {a['gateway']:<8} {is_default:<6} "
              f"{s.get('用户名', ''):<20} {s.get('交易服务器', ''):<40}")


def resolve_account(opts: dict) -> dict | None:
    """Resolve account from DB using CLI options."""
    if not HAS_ACCOUNT_STORE:
        logger.error("无法导入 deepquant_server.account_store，请确保 deepquant_server 已安装")
        return None

    accounts = get_accounts()
    if not accounts:
        logger.error("数据库中没有保存的账户")
        return None

    # --account specified
    if opts.get("account"):
        val = opts["account"]
        # Try numeric ID first
        if val.isdigit():
            acct = get_account(int(val))
            if acct:
                logger.info(f"按 ID 选择账户: [{acct['id']}] {acct['alias']}")
                return acct
        # Try alias match
        for a in accounts:
            if a["alias"] == val:
                logger.info(f"按名称选择账户: [{a['id']}] {a['alias']}")
                return a
        # Not found
        logger.error(f"未找到账户: {val}")
        list_accounts()
        return None

    # --default flag
    if opts.get("use_default"):
        acct = get_default_account()
        if acct:
            logger.info(f"使用默认账户: [{acct['id']}] {acct['alias']}")
            return acct
        logger.warning("未设置默认账户，回退到第一个可用账户")

    # Fallback: default account -> first account
    acct = get_default_account()
    if acct:
        logger.info(f"使用默认账户: [{acct['id']}] {acct['alias']}")
        return acct

    acct = accounts[0]
    logger.info(f"使用第一个可用账户: [{acct['id']}] {acct['alias']}")
    return acct


# ---------------------------------------------------------------------------
# Symbol parsing
# ---------------------------------------------------------------------------
def parse_symbols(symbols_str: str) -> list[SubscribeRequest]:
    """Parse comma-separated vt_symbol list into SubscribeRequest list."""
    if not symbols_str:
        return []
    requests: list[SubscribeRequest] = []
    for part in symbols_str.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            symbol, exchange = extract_vt_symbol(part)
            requests.append(SubscribeRequest(symbol=symbol, exchange=exchange))
            logger.info(f"  已解析合约: {symbol}.{exchange.value}")
        except (ValueError, KeyError):
            logger.error(f"  非法合约格式: {part} (期望格式: SYMBOL.EXCHANGE)")
    return requests


# ---------------------------------------------------------------------------
# Event handlers (real-time console output)
# ---------------------------------------------------------------------------
def _fmt_dt(dt_val) -> str:
    """Format datetime to HH:MM:SS."""
    if isinstance(dt_val, datetime):
        return dt_val.strftime("%H:%M:%S")
    return str(dt_val)


def _direction_cn(direction) -> str:
    """Direction enum to Chinese label."""
    v = direction.value if hasattr(direction, "value") else direction
    return {1: "多", 2: "空", "LONG": "多", "SHORT": "空", "NET": "净"}.get(v, str(v))


def _order_type_cn(order_type) -> str:
    v = order_type.value if hasattr(order_type, "value") else order_type
    return {"LIMIT": "限价", "MARKET": "市价", "STOP": "止损", "FAK": "FAK", "FOK": "FOK"}.get(v, str(v))


def _offset_cn(offset) -> str:
    v = offset.value if hasattr(offset, "value") else offset
    return {"OPEN": "开", "CLOSE": "平", "CLOSETODAY": "平今", "CLOSEYESTERDAY": "平昨"}.get(v, str(v))


def _status_cn(status) -> str:
    v = status.value if hasattr(status, "value") else status
    return {
        "SUBMITTING": "提交中", "NOTTRADED": "未成交", "PARTTRADED": "部分成交",
        "ALLTRADED": "全部成交", "CANCELLED": "已撤销", "REJECTED": "拒单",
        "ACTIVE": "活跃",
    }.get(v, str(v))


def handle_tick(event: Event) -> None:
    tick = event.data
    if not isinstance(tick, TickData):
        return
    logger.info(
        f"TICK {tick.vt_symbol} | "
        f"最新={tick.last_price:.1f} 买={tick.bid_price_1:.1f} 卖={tick.ask_price_1:.1f} "
        f"量={tick.volume} 仓={tick.open_interest} | {_fmt_dt(tick.datetime)}"
    )


def handle_order(event: Event) -> None:
    order = event.data
    logger.info(
        f"ORDER {order.vt_orderid} {order.vt_symbol} "
        f"{_direction_cn(order.direction)} {_offset_cn(order.offset)} "
        f"price={order.price:.1f} vol={order.volume} traded={order.traded} "
        f"status={_status_cn(order.status)}"
    )


def handle_trade(event: Event) -> None:
    trade = event.data
    logger.info(
        f"TRADE {trade.vt_tradeid} {trade.vt_symbol} "
        f"{_direction_cn(trade.direction)} {_offset_cn(trade.offset)} "
        f"price={trade.price:.1f} vol={trade.volume}"
    )


def handle_position(event: Event) -> None:
    pos = event.data
    pnl = getattr(pos, "pnl", 0)
    logger.info(
        f"POSITION {pos.vt_symbol} {_direction_cn(pos.direction)} "
        f"vol={pos.volume} frozen={pos.frozen} price={pos.price:.1f} "
        f"pnl={pnl:.1f} yd={pos.yd_volume}"
    )


def handle_account(event: Event) -> None:
    acct = event.data
    logger.info(
        f"ACCOUNT {acct.vt_accountid} "
        f"balance={acct.balance:.1f} frozen={acct.frozen:.1f} "
        f"available={acct.available:.1f}"
    )


def handle_contract(event: Event) -> None:
    c = event.data
    logger.info(
        f"CONTRACT {c.vt_symbol} name={c.name} "
        f"product={c.product.value if hasattr(c.product, 'value') else c.product} "
        f"size={c.size} pricetick={c.pricetick}"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    """Entry point for standalone CTP gateway launcher."""
    opts = parse_args(sys.argv[1:])

    # --help
    if opts["help"]:
        print(USAGE)
        return

    # Configure loguru
    logger.remove()
    logger.add(
        sys.stderr,
        format="<green>{time:HH:mm:ss.SSS}</green> | <level>{level: <8}</level> | <level>{message}</level>",
        level=opts["log_level"],
        colorize=True,
    )

    # --list-accounts
    if opts["list_accounts"]:
        if not HAS_ACCOUNT_STORE:
            logger.error("无法导入账户存储模块 (deepquant_server 未安装?)")
            sys.exit(1)
        list_accounts()
        return

    # Resolve account
    if not HAS_ACCOUNT_STORE:
        logger.error("deepquant_server 未安装，无法读取数据库账户。")
        logger.error("请先安装: pip install -e ../deepquant_server/")
        sys.exit(1)

    account = resolve_account(opts)
    if not account:
        sys.exit(1)

    setting = account.get("setting", {})
    if not setting:
        logger.error("账户配置为空")
        sys.exit(1)

    logger.info(f"账户信息: {account['alias']} (ID={account['id']}, 网关={account['gateway']})")
    logger.info(f"  用户名: {setting.get('用户名', '?')}")
    logger.info(f"  交易服务器: {setting.get('交易服务器', '?')}")
    logger.info(f"  行情服务器: {setting.get('行情服务器', '?')}")

    # Parse symbols
    symbols_str = opts.get("symbols", "")
    subscribe_requests = parse_symbols(symbols_str)
    if not subscribe_requests:
        logger.warning("未指定订阅合约 (--symbols)，将仅建立交易连接，无行情数据推送")

    # -----------------------------------------------------------------------
    # Initialize engine
    # -----------------------------------------------------------------------
    logger.info("初始化交易引擎...")
    event_engine = EventEngine()
    main_engine = MainEngine(event_engine)

    # Register event handlers for real-time console output
    event_engine.register(EVENT_TICK, handle_tick)
    event_engine.register(EVENT_ORDER, handle_order)
    event_engine.register(EVENT_TRADE, handle_trade)
    event_engine.register(EVENT_POSITION, handle_position)
    event_engine.register(EVENT_ACCOUNT, handle_account)
    event_engine.register(EVENT_CONTRACT, handle_contract)

    logger.info("注册事件处理器: TICK ORDER TRADE POSITION ACCOUNT CONTRACT")

    # -----------------------------------------------------------------------
    # Add and connect CTP gateway
    # -----------------------------------------------------------------------
    logger.info("添加 CTP 网关...")
    gateway = main_engine.add_gateway(CtpGateway, "CTP")

    # Print CTP API version info
    try:
        from deepquant_ctp.api import MdApi, TdApi
        logger.info(f"CTP API 库: MdApi={MdApi}, TdApi={TdApi}")
    except Exception:
        pass

    logger.info("-" * 60)
    logger.info("开始 CTP 握手流程...")
    logger.info("-" * 60)
    main_engine.connect(setting, "CTP")

    # Wait for contract loading before subscribing
    # TD API needs to query instruments and populate symbol_contract_map
    # before ticks can be received
    logger.info("等待合约数据加载 (最多 15 秒)...")
    for _ in range(30):
        time.sleep(0.5)
        contracts = main_engine.get_all_contracts()
        if contracts:
            logger.info(f"合约数据已就绪: {len(contracts)} 个合约")
            break
    else:
        logger.warning("等待超时，合约数据可能尚未加载完成")

    # -----------------------------------------------------------------------
    # Subscribe to market data
    # -----------------------------------------------------------------------
    for req in subscribe_requests:
        gateway.subscribe(req)
        logger.info(f"已订阅: {req.symbol}.{req.exchange.value}")

    # -----------------------------------------------------------------------
    # Main loop — wait for shutdown signal
    # -----------------------------------------------------------------------
    shutdown_event = threading.Event()

    def _shutdown(signum, frame):
        sig_name = signal.Signals(signum).name
        logger.info(f"收到信号 {sig_name}，正在退出...")
        shutdown_event.set()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    logger.info("-" * 60)
    logger.info("网关运行中。按 Ctrl+C 退出。")
    logger.info("-" * 60)

    try:
        while not shutdown_event.is_set():
            shutdown_event.wait(timeout=1.0)
    except KeyboardInterrupt:
        pass
    finally:
        logger.info("正在关闭...")
        if gateway:
            gateway.close()
        event_engine.stop()
        logger.info("网关已停止。")


if __name__ == "__main__":
    main()
