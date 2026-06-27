from functools import partial
from datetime import datetime, timedelta

from vnpy.trader.ui import QtWidgets, QtCore, QtGui
from vnpy.trader.engine import MainEngine, EventEngine
from vnpy.trader.constant import Interval, Exchange
from vnpy.trader.object import BarData
from vnpy.trader.database import DB_TZ
from vnpy.trader.utility import available_timezones

from ..engine import APP_NAME, ManagerEngine, BarOverview


INTERVAL_NAME_MAP = {
    Interval.MINUTE: "分钟线",
    Interval.HOUR: "小时线",
    Interval.DAILY: "日线",
}


class ManagerWidget(QtWidgets.QWidget):
    """"""

    def __init__(self, main_engine: MainEngine, event_engine: EventEngine) -> None:
        """"""
        super().__init__()

        self.engine: ManagerEngine = main_engine.get_engine(APP_NAME)
        self._download_thread = None

        self.init_ui()

    def init_ui(self) -> None:
        """"""
        self.setWindowTitle("数据管理")

        self.init_tree()
        self.init_table()

        refresh_button: QtWidgets.QPushButton = QtWidgets.QPushButton("刷新")
        refresh_button.clicked.connect(self.refresh_tree)

        download_button: QtWidgets.QPushButton = QtWidgets.QPushButton("下载数据")
        download_button.clicked.connect(self.download_data)

        hbox1: QtWidgets.QHBoxLayout = QtWidgets.QHBoxLayout()
        hbox1.addWidget(refresh_button)
        hbox1.addWidget(download_button)
        hbox1.addStretch()

        hbox2: QtWidgets.QHBoxLayout = QtWidgets.QHBoxLayout()
        hbox2.addWidget(self.tree)
        hbox2.addWidget(self.table)

        vbox: QtWidgets.QVBoxLayout = QtWidgets.QVBoxLayout()
        vbox.addLayout(hbox1)
        vbox.addLayout(hbox2)

        self.setLayout(vbox)

    def init_tree(self) -> None:
        """"""
        labels: list = [
            "数据",
            "本地代码",
            "代码",
            "交易所",
            "数据量",
            "开始时间",
            "结束时间",
            "",
            "",
            ""
        ]

        self.tree: QtWidgets.QTreeWidget = QtWidgets.QTreeWidget()
        self.tree.setColumnCount(len(labels))
        self.tree.setHeaderLabels(labels)

    def init_table(self) -> None:
        """"""
        labels: list = [
            "时间",
            "开盘价",
            "最高价",
            "最低价",
            "收盘价",
            "成交量",
            "成交额",
            "持仓量"
        ]

        self.table: QtWidgets.QTableWidget = QtWidgets.QTableWidget()
        self.table.setColumnCount(len(labels))
        self.table.setHorizontalHeaderLabels(labels)
        self.table.verticalHeader().setVisible(False)
        self.table.horizontalHeader().setSectionResizeMode(
            QtWidgets.QHeaderView.ResizeMode.ResizeToContents
        )

    def refresh_tree(self) -> None:
        """"""
        self.tree.clear()

        interval_childs: dict[Interval, QtWidgets.QTreeWidgetItem] = {}
        exchange_childs: dict[tuple[Interval, Exchange], QtWidgets.QTreeWidgetItem] = {}

        overviews: list[BarOverview] = self.engine.get_bar_overview()
        overviews.sort(key=lambda x: x.symbol)

        for interval in [Interval.MINUTE, Interval.HOUR, Interval.DAILY]:
            interval_child = QtWidgets.QTreeWidgetItem()
            interval_childs[interval] = interval_child
            interval_name: str = INTERVAL_NAME_MAP[interval]
            interval_child.setText(0, interval_name)

        for overview in overviews:
            key: tuple = (overview.interval, overview.exchange)
            exchange_child: QtWidgets.QTreeWidgetItem = exchange_childs.get(key, None)

            if not exchange_child:
                interval_child = interval_childs[overview.interval]
                exchange_child = QtWidgets.QTreeWidgetItem(interval_child)
                exchange_child.setText(0, overview.exchange.value)
                exchange_childs[key] = exchange_child

            item = QtWidgets.QTreeWidgetItem(exchange_child)
            item.setText(1, f"{overview.symbol}.{overview.exchange.value}")
            item.setText(2, overview.symbol)
            item.setText(3, overview.exchange.value)
            item.setText(4, str(overview.count))
            item.setText(5, overview.start.strftime("%Y-%m-%d %H:%M:%S"))
            item.setText(6, overview.end.strftime("%Y-%m-%d %H:%M:%S"))

            show_button: QtWidgets.QPushButton = QtWidgets.QPushButton("查看")
            show_func = partial(
                self.show_data, overview.symbol, overview.exchange,
                overview.interval, overview.start, overview.end
            )
            show_button.clicked.connect(show_func)

            output_button: QtWidgets.QPushButton = QtWidgets.QPushButton("导出")
            output_func = partial(
                self.output_data, overview.symbol, overview.exchange,
                overview.interval, overview.start, overview.end
            )
            output_button.clicked.connect(output_func)

            delete_button: QtWidgets.QPushButton = QtWidgets.QPushButton("删除")
            delete_func = partial(
                self.delete_data, overview.symbol, overview.exchange, overview.interval
            )
            delete_button.clicked.connect(delete_func)

            self.tree.setItemWidget(item, 7, show_button)
            self.tree.setItemWidget(item, 8, output_button)
            self.tree.setItemWidget(item, 9, delete_button)

        self.tree.addTopLevelItems(list(interval_childs.values()))
        for interval_child in interval_childs.values():
            interval_child.setExpanded(True)

    def import_data(self) -> None:
        """"""
        dialog: ImportDialog = ImportDialog()
        n: int = dialog.exec_()
        if n != dialog.DialogCode.Accepted:
            return

        file_path: str = dialog.file_edit.text()
        symbol: str = dialog.symbol_edit.text()
        exchange = dialog.exchange_combo.currentData()
        interval = dialog.interval_combo.currentData()
        tz_name: str = dialog.tz_combo.currentText()
        datetime_head: str = dialog.datetime_edit.text()
        open_head: str = dialog.open_edit.text()
        low_head: str = dialog.low_edit.text()
        high_head: str = dialog.high_edit.text()
        close_head: str = dialog.close_edit.text()
        volume_head: str = dialog.volume_edit.text()
        turnover_head: str = dialog.turnover_edit.text()
        open_interest_head: str = dialog.open_interest_edit.text()
        datetime_format: str = dialog.format_edit.text()

        start, end, count = self.engine.import_data_from_csv(
            file_path, symbol, exchange, interval, tz_name,
            datetime_head, open_head, high_head, low_head, close_head,
            volume_head, turnover_head, open_interest_head, datetime_format
        )

        msg: str = (
            f"CSV载入成功\n"
            f"代码：{symbol}\n"
            f"交易所：{exchange.value}\n"
            f"周期：{interval.value}\n"
            f"起始：{start}\n"
            f"结束：{end}\n"
            f"总数量：{count}\n"
        )
        QtWidgets.QMessageBox.information(self, "载入成功！", msg)

    def output_data(self, symbol, exchange, interval, start, end) -> None:
        """"""
        dialog: DateRangeDialog = DateRangeDialog(start, end)
        n: int = dialog.exec_()
        if n != dialog.DialogCode.Accepted:
            return
        start, end = dialog.get_date_range()

        path, _ = QtWidgets.QFileDialog.getSaveFileName(self, "导出数据", "", "CSV(*.csv)")
        if not path:
            return

        result: bool = self.engine.output_data_to_csv(
            path, symbol, exchange, interval, start, end
        )
        if not result:
            QtWidgets.QMessageBox.warning(
                self, "导出失败！",
                "该文件已在其他程序中打开，请关闭相关程序后再尝试导出数据。"
            )

    def show_data(self, symbol, exchange, interval, start, end) -> None:
        """"""
        dialog: DateRangeDialog = DateRangeDialog(start, end)
        n: int = dialog.exec_()
        if n != dialog.DialogCode.Accepted:
            return
        start, end = dialog.get_date_range()

        bars: list[BarData] = self.engine.load_bar_data(
            symbol, exchange, interval, start, end
        )

        self.table.setRowCount(0)
        self.table.setRowCount(len(bars))

        for row, bar in enumerate(bars):
            self.table.setItem(row, 0, DataCell(bar.datetime.strftime("%Y-%m-%d %H:%M:%S")))
            self.table.setItem(row, 1, DataCell(str(bar.open_price)))
            self.table.setItem(row, 2, DataCell(str(bar.high_price)))
            self.table.setItem(row, 3, DataCell(str(bar.low_price)))
            self.table.setItem(row, 4, DataCell(str(bar.close_price)))
            self.table.setItem(row, 5, DataCell(str(bar.volume)))
            self.table.setItem(row, 6, DataCell(str(bar.turnover)))
            self.table.setItem(row, 7, DataCell(str(bar.open_interest)))

    def delete_data(self, symbol, exchange, interval) -> None:
        """"""
        n = QtWidgets.QMessageBox.warning(
            self, "删除确认",
            f"请确认是否要删除{symbol} {exchange.value} {interval.value}的全部数据",
            QtWidgets.QMessageBox.StandardButton.Ok,
            QtWidgets.QMessageBox.StandardButton.Cancel
        )
        if n == QtWidgets.QMessageBox.StandardButton.Cancel:
            return

        count: int = self.engine.delete_bar_data(symbol, exchange, interval)
        QtWidgets.QMessageBox.information(
            self, "删除成功",
            f"已删除{symbol} {exchange.value} {interval.value}共计{count}条数据",
            QtWidgets.QMessageBox.StandardButton.Ok
        )

    def download_data(self) -> None:
        """"""
        dialog: DownloadDialog = DownloadDialog(self.engine, self.main_engine)
        dialog.exec_()
        self.refresh_tree()

    def show(self) -> None:
        """"""
        self.showMaximized()


class DataCell(QtWidgets.QTableWidgetItem):
    """"""
    def __init__(self, text: str = "") -> None:
        super().__init__(text)
        self.setTextAlignment(QtCore.Qt.AlignmentFlag.AlignCenter)


class DateRangeDialog(QtWidgets.QDialog):
    """"""
    def __init__(self, start: datetime, end: datetime, parent=None) -> None:
        super().__init__(parent)
        self.setWindowTitle("选择数据区间")

        self.start_edit = QtWidgets.QDateEdit(QtCore.QDate(start.year, start.month, start.day + 1))
        self.end_edit = QtWidgets.QDateEdit(QtCore.QDate(end.year, end.month, end.day + 1))

        button = QtWidgets.QPushButton("确定")
        button.clicked.connect(self.accept)

        form = QtWidgets.QFormLayout()
        form.addRow("开始时间", self.start_edit)
        form.addRow("结束时间", self.end_edit)
        form.addRow(button)
        self.setLayout(form)

    def get_date_range(self) -> tuple[datetime, datetime]:
        start = self.start_edit.dateTime().toPython()
        end = self.end_edit.dateTime().toPython() + timedelta(days=1)
        return start, end


class ImportDialog(QtWidgets.QDialog):
    """"""
    def __init__(self, parent=None) -> None:
        super().__init__()
        self.setWindowTitle("从CSV文件导入数据")
        self.setFixedWidth(300)

        file_button = QtWidgets.QPushButton("选择文件")
        file_button.clicked.connect(self.select_file)
        load_button = QtWidgets.QPushButton("确定")
        load_button.clicked.connect(self.accept)

        self.file_edit = QtWidgets.QLineEdit()
        self.symbol_edit = QtWidgets.QLineEdit()
        self.exchange_combo = QtWidgets.QComboBox()
        for i in Exchange:
            self.exchange_combo.addItem(str(i.name), i)
        self.interval_combo = QtWidgets.QComboBox()
        for i in Interval:
            if i != Interval.TICK:
                self.interval_combo.addItem(str(i.name), i)
        self.tz_combo = QtWidgets.QComboBox()
        self.tz_combo.addItems(available_timezones())
        self.tz_combo.setCurrentIndex(self.tz_combo.findText("Asia/Shanghai"))
        self.datetime_edit = QtWidgets.QLineEdit("datetime")
        self.open_edit = QtWidgets.QLineEdit("open")
        self.high_edit = QtWidgets.QLineEdit("high")
        self.low_edit = QtWidgets.QLineEdit("low")
        self.close_edit = QtWidgets.QLineEdit("close")
        self.volume_edit = QtWidgets.QLineEdit("volume")
        self.turnover_edit = QtWidgets.QLineEdit("turnover")
        self.open_interest_edit = QtWidgets.QLineEdit("open_interest")
        self.format_edit = QtWidgets.QLineEdit("%Y-%m-%d %H:%M:%S")

        form = QtWidgets.QFormLayout()
        form.addRow(file_button, self.file_edit)
        form.addRow(QtWidgets.QLabel("合约信息"))
        form.addRow("代码", self.symbol_edit)
        form.addRow("交易所", self.exchange_combo)
        form.addRow("周期", self.interval_combo)
        form.addRow("时区", self.tz_combo)
        form.addRow(QtWidgets.QLabel("表头信息"))
        form.addRow("时间戳", self.datetime_edit)
        form.addRow("开盘价", self.open_edit)
        form.addRow("最高价", self.high_edit)
        form.addRow("最低价", self.low_edit)
        form.addRow("收盘价", self.close_edit)
        form.addRow("成交量", self.volume_edit)
        form.addRow("成交额", self.turnover_edit)
        form.addRow("持仓量", self.open_interest_edit)
        form.addRow(QtWidgets.QLabel("格式信息"))
        form.addRow("时间格式", self.format_edit)
        form.addRow(load_button)
        self.setLayout(form)

    def select_file(self) -> None:
        result = QtWidgets.QFileDialog.getOpenFileName(self, filter="CSV (*.csv)")
        if result[0]:
            self.file_edit.setText(result[0])


class DownloadDialog(QtWidgets.QDialog):
    """Streamlined download dialog: exchange → product → contract → download."""

    def __init__(self, engine: ManagerEngine, main_engine=None, parent=None) -> None:
        super().__init__()
        self.engine = engine
        self.main_engine = main_engine
        self.setWindowTitle("下载历史数据")
        self.setMinimumWidth(520)

        # Exchange
        self.exchange_combo = QtWidgets.QComboBox()
        for code in ["CFFEX", "SHFE", "DCE", "CZCE", "INE", "GFEX"]:
            display = Exchange._value2member_map_.get(code, Exchange.CFFEX).display_name
            self.exchange_combo.addItem(f"{code}({display})", code)
        self.exchange_combo.currentIndexChanged.connect(self._on_exchange)

        # Product
        self.product_combo = QtWidgets.QComboBox()
        self.product_combo.addItem("全部品种", "")
        self.product_combo.currentIndexChanged.connect(self._on_product)

        # Contract
        self.symbol_combo = QtWidgets.QComboBox()
        self.symbol_combo.addItem("请先选择品种", "")
        self.symbol_combo.setEditable(True)
        self.symbol_combo.setMinimumWidth(400)

        # Interval
        self.interval_combo = QtWidgets.QComboBox()
        for i in Interval:
            if i == Interval.TICK:
                continue
            self.interval_combo.addItem(INTERVAL_NAME_MAP.get(i, i.value), i)

        # Date range
        end_dt = datetime.now()
        start_dt = end_dt - timedelta(days=3 * 365)
        self.start_date = QtWidgets.QDateEdit(QtCore.QDate(start_dt.year, start_dt.month, start_dt.day))
        self.end_date = QtWidgets.QDateEdit(QtCore.QDate(end_dt.year, end_dt.month, end_dt.day))

        # Download button
        dl_btn = QtWidgets.QPushButton("开始下载")
        dl_btn.clicked.connect(self._download)

        # Status
        self.status_label = QtWidgets.QLabel("")
        self.status_label.setStyleSheet("color: #58a6ff; font-size: 11px;")

        form = QtWidgets.QFormLayout()
        form.addRow("交易所", self.exchange_combo)
        form.addRow("品种", self.product_combo)
        form.addRow("合约", self.symbol_combo)
        form.addRow("周期", self.interval_combo)
        form.addRow("开始日期", self.start_date)
        form.addRow("结束日期", self.end_date)
        form.addRow(dl_btn)
        form.addRow(self.status_label)
        self.setLayout(form)

        self._on_exchange()

    def _on_exchange(self) -> None:
        """Load products for selected exchange."""
        ex = self.exchange_combo.currentData()
        self.product_combo.clear()
        self.product_combo.addItem("加载中...", "")
        self._load_products(ex)

    def _load_products(self, exchange_code: str) -> None:
        """Fetch products from contract_cache (in-process, no HTTP needed)."""
        from threading import Thread
        def _fetch():
            try:
                from vnpy.trader.contract_cache import get_products
                prods = get_products(exchange_code)
                result = [{"prefix": k, "name": v} for k, v in prods.items()]
                self._thread_result = result
            except Exception:
                self._thread_result = []
        self._thread_result = None
        Thread(target=_fetch, daemon=True).start()
        # Poll for result on main thread
        QtCore.QTimer.singleShot(100, self._check_products_loaded)

    def _check_products_loaded(self) -> None:
        """Poll for thread result and update UI."""
        if self._thread_result is None:
            QtCore.QTimer.singleShot(100, self._check_products_loaded)
            return
        self.product_combo.clear()
        self.product_combo.addItem("全部品种", "")
        for p in self._thread_result:
            label = f"{p['prefix']} - {p['name']}" if p.get('name') else p['prefix']
            self.product_combo.addItem(label, p['prefix'])

    def _on_product(self) -> None:
        """Load contracts for selected product."""
        ex = self.exchange_combo.currentData()
        prod = self.product_combo.currentData()
        if prod is None:
            return
        self.symbol_combo.clear()
        self.symbol_combo.addItem("加载中...", "")
        self._load_contracts(ex, prod)

    def _load_contracts(self, exchange_code: str, product: str) -> None:
        from threading import Thread
        def _fetch():
            try:
                from vnpy.trader.contract_cache import query_contracts, get_related_products
                from vnpy.trader.constant import Exchange
                contracts = query_contracts(Exchange(exchange_code))
                if product:
                    related = {product}
                    for rp in get_related_products(product):
                        related.add(rp)
                    contracts = [c for c in contracts if c['symbol'].upper()[:len(product)].upper() in related]
                import re
                for c in contracts:
                    m = re.match(r'^[A-Z]+[0-9]+-([CP])-', c['symbol'].upper())
                    if m:
                        c['option_type'] = "看涨" if m.group(1) == 'C' else "看跌"
                self._ct_result = contracts
            except Exception:
                self._ct_result = []
        self._ct_result = None
        Thread(target=_fetch, daemon=True).start()
        QtCore.QTimer.singleShot(100, self._check_contracts_loaded)

    def _check_contracts_loaded(self) -> None:
        if self._ct_result is None:
            QtCore.QTimer.singleShot(100, self._check_contracts_loaded)
            return
        self.symbol_combo.clear()
        if not self._ct_result:
            self.symbol_combo.addItem("无合约", "")
        for c in self._ct_result:
            opt = f" {c.get('option_type', '')}" if c.get('option_type') else ""
            self.symbol_combo.addItem(f"{c['symbol']} | {c['name']}{opt}", c['symbol'])

    def _download(self) -> None:
        symbol = self.symbol_combo.currentData()
        if not symbol:
            QtWidgets.QMessageBox.warning(self, "提示", "请选择合约")
            return

        from vnpy.trader.setting import SETTINGS
        if not SETTINGS.get("datafeed.name"):
            QtWidgets.QMessageBox.warning(self, "未配置数据服务",
                "请先在全局配置中设置 datafeed.name\n"
                "常见选项: rqdata, tqsdk, tushare\n\n"
                "配置后需重启生效。")
            return

        exchange = Exchange(self.exchange_combo.currentData())
        interval = self.interval_combo.currentData()

        sd = self.start_date.date()
        start = datetime(sd.year(), sd.month(), sd.day()).replace(tzinfo=DB_TZ)

        msg = f"下载请求: {symbol}.{exchange.value} {interval.value} {start.strftime('%Y-%m-%d')}~{datetime.now().strftime('%Y-%m-%d')}"
        self.status_label.setText(f"下载中: {symbol}.{exchange.value} {interval.value}...")
        if self.main_engine:
            self.main_engine.write_log(f"[DataManager] {msg}")

        from threading import Thread
        def _run():
            try:
                if interval == Interval.TICK:
                    count = self.engine.download_tick_data(symbol, exchange, start, self._on_progress)
                else:
                    count = self.engine.download_bar_data(symbol, exchange, interval, start, self._on_progress)
                self._dl_result = count
                if self.main_engine:
                    self.main_engine.write_log(f"[DataManager] 下载完成: {symbol}.{exchange.value} {interval.value} → {count}条")
            except Exception as e:
                self._dl_result = -1
                err = f"下载失败: {symbol}.{exchange.value} {interval.value} → {e}"
                self.status_label.setText(err)
                if self.main_engine:
                    self.main_engine.write_log(f"[DataManager] {err}")
        self._dl_result = None
        Thread(target=_run, daemon=True).start()
        QtCore.QTimer.singleShot(500, self._check_download_done)

    def _check_download_done(self) -> None:
        if self._dl_result is None:
            QtCore.QTimer.singleShot(500, self._check_download_done)
            return
        count = self._dl_result
        if count < 0:
            self.status_label.setText("下载失败，请检查数据服务配置")
        else:
            self.status_label.setText(f"下载完成，共 {count} 条数据")
            QtWidgets.QMessageBox.information(self, "下载完成", f"下载总数据量：{count}条")

    def _on_progress(self, msg: str) -> None:
        self.status_label.setText(f"下载进度: {msg}")

    def _on_download_done(self, count: int) -> None:
        if count < 0:
            self.status_label.setText("下载失败，请检查数据服务配置")
        else:
            self.status_label.setText(f"下载完成，共 {count} 条数据")
            QtWidgets.QMessageBox.information(self, "下载完成", f"下载总数据量：{count}条")
