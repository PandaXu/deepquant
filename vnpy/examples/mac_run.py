"""
VeighNa 全功能启动脚本（macOS Apple Silicon + CTP）
"""
from vnpy.trader.setting import SETTINGS
SETTINGS["font.family"] = "PingFang SC"

from vnpy.event import EventEngine
from vnpy.trader.engine import MainEngine
from vnpy.trader.ui import MainWindow, create_qapp

from vnpy_ctp import CtpGateway
from vnpy_paperaccount import PaperAccountApp
from vnpy_ctastrategy import CtaStrategyApp
from vnpy_ctabacktester import CtaBacktesterApp
from vnpy_datamanager import DataManagerApp


def main():
    qapp = create_qapp()

    event_engine = EventEngine()
    main_engine = MainEngine(event_engine)

    # CTP 网关（需 CTP 账户和网络连接才能实际交易）
    main_engine.add_gateway(CtpGateway)
    print("✅ CTP Gateway 已加载")

    # App 模块
    main_engine.add_app(PaperAccountApp)
    main_engine.add_app(CtaStrategyApp)
    main_engine.add_app(CtaBacktesterApp)
    main_engine.add_app(DataManagerApp)
    print("✅ 4 个 App 已加载")

    main_window = MainWindow(main_engine, event_engine)
    main_window.showMaximized()

    qapp.exec()


if __name__ == "__main__":
    main()
