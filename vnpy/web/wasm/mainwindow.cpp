#include "mainwindow.h"
#include <QGridLayout>
#include <QFormLayout>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QHeaderView>
#include <QMenuBar>
#include <QMenu>
#include <QAction>
#include <QJsonArray>
#include <QDateTime>
#include <QDebug>
#include <QDoubleValidator>
#include <QSplitter>
#include <QApplication>
#include <QStyleFactory>
#include <QFont>

#include "datamodels.h"

MainWindow::MainWindow(QWidget* parent)
    : QMainWindow(parent)
{
    // Dark palette
    qApp->setStyle(QStyleFactory::create("Fusion"));
    QPalette p;
    p.setColor(QPalette::Window, QColor(Colors::BG));
    p.setColor(QPalette::WindowText, QColor(Colors::TEXT));
    p.setColor(QPalette::Base, QColor("#252526"));
    p.setColor(QPalette::AlternateBase, QColor(Colors::SURFACE));
    p.setColor(QPalette::Text, QColor(Colors::TEXT));
    p.setColor(QPalette::Button, QColor(Colors::SURFACE));
    p.setColor(QPalette::ButtonText, QColor(Colors::TEXT));
    p.setColor(QPalette::BrightText, QColor("#ff0000"));
    p.setColor(QPalette::Highlight, QColor(Colors::ACCENT));
    p.setColor(QPalette::HighlightedText, QColor("#ffffff"));
    qApp->setPalette(p);
    qApp->setStyleSheet(
        "QMainWindow { background: #1e1e1e; }"
        "QDockWidget { background: #2d2d2d; border: 1px solid #3c3c3c; titlebar-close-icon: none; titlebar-normal-icon: none; }"
        "QDockWidget::title { background: #333; padding: 2px 8px; font-size: 11px; color: #808080; }"
        "QTableWidget { background: #2d2d2d; gridline-color: #3c3c3c; border: none; font-size: 12px; }"
        "QTableWidget::item { padding: 2px 6px; }"
        "QHeaderView::section { background: #333; color: #d4d4d4; padding: 3px 6px; border: none; border-bottom: 1px solid #3c3c3c; font-weight: bold; font-size: 11px; }"
        "QLineEdit, QComboBox { background: #252526; color: #d4d4d4; border: 1px solid #3c3c3c; padding: 3px 6px; border-radius: 2px; }"
        "QPushButton { background: #333; color: #d4d4d4; border: 1px solid #3c3c3c; padding: 5px; border-radius: 2px; font-weight: bold; }"
        "QPushButton:hover { background: #444; }"
        "QPushButton#btnLong { background: #c42b1c; color: #fff; border: none; }"
        "QPushButton#btnShort { background: #0b6016; color: #fff; border: none; }"
        "QTabWidget::pane { border: none; }"
        "QTabBar::tab { background: #333; color: #808080; padding: 3px 12px; border: none; font-size: 11px; }"
        "QTabBar::tab:selected { color: #d4d4d4; border-bottom: 2px solid #007acc; }"
        "QMenuBar { background: #252526; color: #d4d4d4; }"
        "QMenuBar::item:selected { background: #007acc; }"
        "QMenu { background: #2d2d2d; color: #d4d4d4; border: 1px solid #3c3c3c; }"
    );

    // Monitor definitions
    auto defs = createMonitorDefs();
    m_tickDef = defs["tick"];
    m_orderDef = defs["order"];
    m_tradeDef = defs["trade"];
    m_posDef = defs["position"];
    m_accDef = defs["account"];
    m_logDef = defs["log"];

    initUI();

    // WebSocket client — connect to local Python backend
    m_client = new WebSocketClient(QUrl("ws://localhost:8888/ws"), this);
    connect(m_client, &WebSocketClient::tickReceived, this, &MainWindow::onTick);
    connect(m_client, &WebSocketClient::orderReceived, this, &MainWindow::onOrder);
    connect(m_client, &WebSocketClient::tradeReceived, this, &MainWindow::onTrade);
    connect(m_client, &WebSocketClient::positionReceived, this, &MainWindow::onPosition);
    connect(m_client, &WebSocketClient::accountReceived, this, &MainWindow::onAccount);
    connect(m_client, &WebSocketClient::logReceived, this, &MainWindow::onLog);
    connect(m_client, &WebSocketClient::connected, this, [this]() {
        if (m_wsStatus) m_wsStatus->setText("● Connected");
        if (m_wsStatus) m_wsStatus->setStyleSheet("color:#4ec94e;");
    });
    connect(m_client, &WebSocketClient::disconnected, this, [this]() {
        if (m_wsStatus) m_wsStatus->setText("● Disconnected");
        if (m_wsStatus) m_wsStatus->setStyleSheet("color:#666;");
    });
    m_client->connectToServer();

    // Clock
    connect(&m_clockTimer, &QTimer::timeout, this, [this]() {
        statusBar()->showMessage(QDateTime::currentDateTime().toString("HH:mm:ss"));
    });
    m_clockTimer.start(1000);
}

void MainWindow::initUI() {
    setWindowTitle("VeighNa Trader 社区版 — 4.4.0 [WASM]");
    resize(1400, 900);

    // Menu bar
    QMenu* sysMenu = menuBar()->addMenu("系统");
    QAction* connAct = sysMenu->addAction("🔌 连接网关");
    connect(connAct, &QAction::triggered, this, &MainWindow::onConnectGateway);
    sysMenu->addSeparator();
    QAction* quitAct = sysMenu->addAction("退出");
    connect(quitAct, &QAction::triggered, qApp, &QApplication::quit);

    QMenu* funcMenu = menuBar()->addMenu("功能");
    QAction* refreshAct = funcMenu->addAction("🔄 刷新状态");
    connect(refreshAct, &QAction::triggered, this, &MainWindow::onRefreshStatus);

    QMenu* helpMenu = menuBar()->addMenu("帮助");
    helpMenu->addAction("VeighNa WebAssembly v4.4.0");

    // Status bar
    m_wsStatus = new QLabel("● Connecting...");
    m_wsStatus->setStyleSheet("color:#d7ba7d; font-size:11px; padding:2px 8px;");
    statusBar()->addPermanentWidget(m_wsStatus);

    // Central widget: use splitter to hold dock widgets
    setDockNestingEnabled(true);
    setTabPosition(Qt::AllDockWidgetAreas, QTabWidget::North);
    initDocks();
}

void MainWindow::initDocks() {
    // Left: Trading widget
    QDockWidget* tradeDock = new QDockWidget("📝 交易", this);
    initTradingWidget(tradeDock);
    addDockWidget(Qt::LeftDockWidgetArea, tradeDock);

    // Right top: TickMonitor
    QDockWidget* tickDock = createMonitor(m_tickDef, "📈 行情", Qt::RightDockWidgetArea);
    addDockWidget(Qt::RightDockWidgetArea, tickDock);

    // Right bottom: Order (tabbed with Active Orders)
    QDockWidget* orderDock = createMonitor(m_orderDef, "📋 委托", Qt::RightDockWidgetArea);
    addDockWidget(Qt::RightDockWidgetArea, orderDock);

    // Bottom left: TradeMonitor
    QDockWidget* tradeMonDock = createMonitor(m_tradeDef, "💰 成交", Qt::BottomDockWidgetArea);
    addDockWidget(Qt::BottomDockWidgetArea, tradeMonDock);

    // Bottom center: Log
    QDockWidget* logDock = createMonitor(m_logDef, "📜 日志", Qt::BottomDockWidgetArea);
    addDockWidget(Qt::BottomDockWidgetArea, logDock);

    // Bottom right: Account + Position (tabbed)
    QDockWidget* accPosDock = new QDockWidget("资金/持仓", this);
    QTabWidget* tab = new QTabWidget();
    QTableWidget* accTable = new QTableWidget();
    QTableWidget* posTable = new QTableWidget();
    m_monitors["account"] = accTable;
    m_monitors["position"] = posTable;

    auto setupTable = [](QTableWidget* t, const MonitorDef& def) {
        t->setColumnCount(def.columns.size());
        QStringList labels;
        for (auto& c : def.columns) labels << c.label;
        t->setHorizontalHeaderLabels(labels);
        t->horizontalHeader()->setStretchLastSection(true);
        t->setAlternatingRowColors(true);
        t->setEditTriggers(QAbstractItemView::NoEditTriggers);
        t->setSelectionBehavior(QAbstractItemView::SelectRows);
        t->verticalHeader()->setVisible(false);
        t->setSortingEnabled(def.sorting);
    };
    setupTable(accTable, m_accDef);
    setupTable(posTable, m_posDef);

    tab->addTab(accTable, "资金");
    tab->addTab(posTable, "持仓");
    accPosDock->setWidget(tab);
    addDockWidget(Qt::BottomDockWidgetArea, accPosDock);

    // Set initial sizes
    resizeDocks({tradeDock}, {300}, Qt::Horizontal);
}

QDockWidget* MainWindow::createMonitor(const MonitorDef& def, const QString& title,
                                        Qt::DockWidgetArea area) {
    QDockWidget* dock = new QDockWidget(title, this);
    QTableWidget* table = new QTableWidget();
    table->setColumnCount(def.columns.size());
    QStringList labels;
    for (auto& c : def.columns) labels << c.label;
    table->setHorizontalHeaderLabels(labels);
    table->horizontalHeader()->setStretchLastSection(true);
    table->setAlternatingRowColors(true);
    table->setEditTriggers(QAbstractItemView::NoEditTriggers);
    table->setSelectionBehavior(QAbstractItemView::SelectRows);
    table->verticalHeader()->setVisible(false);
    table->setSortingEnabled(def.sorting);
    table->setContextMenuPolicy(Qt::CustomContextMenu);

    m_monitors[def.name] = table;
    dock->setWidget(table);
    return dock;
}

void MainWindow::initTradingWidget(QDockWidget* dock) {
    QWidget* w = new QWidget();
    QVBoxLayout* vbox = new QVBoxLayout(w);
    vbox->setSpacing(4);
    vbox->setContentsMargins(8,8,8,8);

    // Form
    QGridLayout* grid = new QGridLayout();
    grid->setSpacing(2);
    int r = 0;

    m_exchangeCombo = new QComboBox();
    m_exchangeCombo->addItems({"CFFEX","SHFE","CZCE","DCE","INE","GFEX"});

    m_symbolEdit = new QLineEdit();
    m_symbolEdit->setPlaceholderText("输入合约代码回车订阅");
    connect(m_symbolEdit, &QLineEdit::returnPressed, this, &MainWindow::onSetSymbol);

    m_nameEdit = new QLineEdit();
    m_nameEdit->setReadOnly(true);

    m_directionCombo = new QComboBox();
    m_directionCombo->addItems({"多", "空"});

    m_offsetCombo = new QComboBox();
    m_offsetCombo->addItems({"开", "平", "平今", "平昨"});

    m_orderTypeCombo = new QComboBox();
    m_orderTypeCombo->addItems({"限价", "市价", "FAK", "FOK"});

    m_priceEdit = new QLineEdit();
    m_priceEdit->setValidator(new QDoubleValidator(0, 1e9, 10, this));
    m_priceEdit->setPlaceholderText("价格");

    m_volumeEdit = new QLineEdit();
    m_volumeEdit->setValidator(new QDoubleValidator(0, 1e9, 10, this));
    m_volumeEdit->setText("1");

    m_gatewayCombo = new QComboBox();
    m_gatewayCombo->addItems({"CTP"});

    m_priceCheck = new QCheckBox("价格随行情");

    QPushButton* btnLong = new QPushButton("多");
    btnLong->setObjectName("btnLong");
    connect(btnLong, &QPushButton::clicked, this, [this](){ onSendOrder("LONG"); });

    QPushButton* btnShort = new QPushButton("空");
    btnShort->setObjectName("btnShort");
    connect(btnShort, &QPushButton::clicked, this, [this](){ onSendOrder("SHORT"); });

    QPushButton* btnCancelAll = new QPushButton("全撤");
    connect(btnCancelAll, &QPushButton::clicked, this, &MainWindow::onCancelAll);

    auto addRow = [&](const QString& label, QWidget* w1, QWidget* w2 = nullptr) {
        QLabel* l = new QLabel(label);
        l->setStyleSheet("color:#808080;font-size:11px;");
        grid->addWidget(l, r, 0);
        if (w2) {
            grid->addWidget(w1, r, 1);
            grid->addWidget(w2, r, 2);
        } else {
            grid->addWidget(w1, r, 1, 1, 2);
        }
        r++;
    };

    addRow("交易所", m_exchangeCombo);
    addRow("代码", m_symbolEdit);
    addRow("名称", m_nameEdit);
    addRow("方向", m_directionCombo);
    addRow("开平", m_offsetCombo);
    addRow("类型", m_orderTypeCombo);
    addRow("价格", m_priceEdit, m_priceCheck);
    addRow("数量", m_volumeEdit);
    addRow("接口", m_gatewayCombo);

    QHBoxLayout* btnRow = new QHBoxLayout();
    btnRow->addWidget(btnShort);
    btnRow->addWidget(btnLong);
    grid->addLayout(btnRow, r, 0, 1, 3);
    r++;

    grid->addWidget(btnCancelAll, r, 0, 1, 3);

    vbox->addLayout(grid);

    // Depth panel
    initDepthPanel(w);
    vbox->addStretch();

    dock->setWidget(w);
    dock->setMinimumWidth(280);
    dock->setMaximumWidth(320);
}

void MainWindow::initDepthPanel(QWidget* parent) {
    QWidget* depth = new QWidget();
    QFormLayout* form = new QFormLayout(depth);
    form->setSpacing(1);
    form->setContentsMargins(4,8,4,4);

    auto makeRow = [&](const QString& bidColor, const QString& askColor, int idx) {
        QLabel* price = new QLabel("--");
        price->setStyleSheet(QString("color:%1;font-family:Consolas;font-size:12px;").arg(askColor));
        QLabel* vol = new QLabel("--");
        vol->setStyleSheet(QString("color:%1;font-family:Consolas;font-size:12px;").arg(askColor));
        vol->setAlignment(Qt::AlignRight);
        form->addRow(price, vol);
        m_depthLabels[idx*2] = price;
        m_depthLabels[idx*2+1] = vol;
    };

    // Ask 5..1
    makeRow(Colors::BID, Colors::ASK, 4); // ask5
    makeRow(Colors::BID, Colors::ASK, 3); // ask4
    makeRow(Colors::BID, Colors::ASK, 2); // ask3
    makeRow(Colors::BID, Colors::ASK, 1); // ask2
    makeRow(Colors::BID, Colors::ASK, 0); // ask1

    // Mid
    QLabel* midPrice = new QLabel("最新");
    midPrice->setStyleSheet("font-weight:bold;font-size:14px;color:#d4d4d4;");
    QLabel* midRet = new QLabel("涨跌幅");
    midRet->setStyleSheet("font-size:12px;color:#808080;");
    midRet->setAlignment(Qt::AlignRight);
    form->addRow(midPrice, midRet);
    m_depthLabels[10] = midPrice;
    m_depthLabels[11] = midRet;

    // Bid 1..5
    auto makeBidRow = [&](int idx) {
        QLabel* price = new QLabel("--");
        price->setStyleSheet(QString("color:%1;font-family:Consolas;font-size:12px;").arg(Colors::BID));
        QLabel* vol = new QLabel("--");
        vol->setStyleSheet(QString("color:%1;font-family:Consolas;font-size:12px;").arg(Colors::BID));
        vol->setAlignment(Qt::AlignRight);
        form->addRow(price, vol);
        int base = 12 + idx*2;
        m_depthLabels[base] = price;
        m_depthLabels[base+1] = vol;
    };
    makeBidRow(0); // bid1
    makeBidRow(1); // bid2
    makeBidRow(2); // bid3
    makeBidRow(3); // bid4
    makeBidRow(4); // bid5

    QVBoxLayout* vbox = qobject_cast<QVBoxLayout*>(parent->layout());
    if (vbox) vbox->addWidget(depth);
}

// ---- WebSocket → UI slots ----

void MainWindow::onTick(const QJsonObject& data) {
    QString key = data["vt_symbol"].toString();
    m_ticks[key] = data;
    updateMonitorTable(m_monitors["tick"], m_tickDef, m_ticks);

    // Update depth if watching this symbol
    if (key == m_vtSymbol) updateDepth(data);
}

void MainWindow::onOrder(const QJsonObject& data) {
    QString key = data["vt_orderid"].toString();
    m_orders[key] = data;
    updateMonitorTable(m_monitors["order"], m_orderDef, m_orders);
}

void MainWindow::onTrade(const QJsonObject& data) {
    QString key = data["vt_tradeid"].toString();
    if (key.isEmpty()) key = data["tradeid"].toString();
    m_trades[key] = data;
    updateMonitorTable(m_monitors["trade"], m_tradeDef, m_trades);
}

void MainWindow::onPosition(const QJsonObject& data) {
    QString key = data["vt_positionid"].toString();
    m_positions[key] = data;
    updateMonitorTable(m_monitors["position"], m_posDef, m_positions);
}

void MainWindow::onAccount(const QJsonObject& data) {
    QString key = data["vt_accountid"].toString();
    m_accounts[key] = data;
    updateMonitorTable(m_monitors["account"], m_accDef, m_accounts);
}

void MainWindow::onLog(const QJsonObject& data) {
    QString time = data["time"].toString();
    if (time.length() > 12) time = time.mid(11, 8);
    QString gw = data["gateway_name"].toString();
    QString msg = data["msg"].toString();
    m_logs.prepend(QString("[%1] [%2] %3").arg(time, gw, msg));
    if (m_logs.size() > 500) m_logs.resize(500);

    // Log monitor: use simple text table
    QTableWidget* table = m_monitors["log"];
    if (!table) return;
    table->setRowCount(qMin(m_logs.size(), 200));
    for (int i = 0; i < qMin(m_logs.size(), 200); i++) {
        QStringList parts = m_logs[i].split("] ");
        QString ts = parts.value(0).mid(1);
        QString gw = parts.value(1).isEmpty() ? "" : parts.value(1).mid(1);
        QString ms = parts.mid(2).join("] ");

        QTableWidgetItem* ti = new QTableWidgetItem(ts);
        ti->setForeground(QColor("#569cd6"));
        table->setItem(i, 0, ti);

        QTableWidgetItem* mi = new QTableWidgetItem(ms);
        table->setItem(i, 1, mi);

        QTableWidgetItem* gi = new QTableWidgetItem(gw);
        gi->setForeground(QColor(Colors::DIM));
        table->setItem(i, 2, gi);
    }
}

// ---- Trading actions ----

void MainWindow::onSetSymbol() {
    QString symbol = m_symbolEdit->text().trimmed();
    QString exchange = m_exchangeCombo->currentText();
    if (symbol.isEmpty()) return;

    m_vtSymbol = QString("%1.%2").arg(symbol, exchange);
    m_nameEdit->clear();
    m_priceEdit->clear();
    m_volumeEdit->setText("1");
    clearDepth();

    m_client->subscribeSymbol(symbol, exchange);
}

void MainWindow::onSendOrder(const QString& direction) {
    QString symbol = m_symbolEdit->text().trimmed();
    if (symbol.isEmpty()) return;

    QString exchange = m_exchangeCombo->currentText();
    QString offset = m_offsetCombo->currentText();
    QString orderType = m_orderTypeCombo->currentText();
    double price = m_priceEdit->text().toDouble();
    double volume = m_volumeEdit->text().toDouble();
    QString gateway = m_gatewayCombo->currentText();

    m_client->sendOrder(symbol, exchange, direction, offset,
                         price, volume, orderType, gateway);
}

void MainWindow::onCancelAll() {
    for (auto it = m_orders.begin(); it != m_orders.end(); ++it) {
        QJsonObject ord = it.value();
        QString status = ord["status"].toString();
        if (status == "SUBMITTING" || status == "NOTTRADED" || status == "PARTTRADED" ||
            status == "提交中" || status == "未成交" || status == "部分成交") {
            m_client->cancelOrder(
                ord["orderid"].toString(),
                ord["symbol"].toString(),
                ord["exchange"].toString(),
                ord["gateway_name"].toString()
            );
        }
    }
}

void MainWindow::onConnectGateway() {
    // In WASM, gateway config is sent to the Python backend via WebSocket
    m_client->sendAction("get_status");
}

void MainWindow::onRefreshStatus() {
    m_client->sendAction("get_status");
}

// ---- Helpers ----

void MainWindow::updateMonitorTable(QTableWidget* table, const MonitorDef& def,
                                     const QMap<QString, QJsonObject>& data) {
    if (!table) return;
    table->setSortingEnabled(false);

    QList<QJsonObject> rows;
    for (auto it = data.begin(); it != data.end(); ++it) rows.append(it.value());
    std::reverse(rows.begin(), rows.end());

    table->setRowCount(rows.size());
    for (int r = 0; r < rows.size(); r++) {
        const QJsonObject& row = rows[r];
        for (int c = 0; c < def.columns.size(); c++) {
            const ColumnDef& col = def.columns[c];
            QJsonValue val = row[col.key];
            QTableWidgetItem* item = new QTableWidgetItem(formatValue(col.key, val));
            item->setForeground(cellColor(col.key, val, col));
            item->setTextAlignment(Qt::AlignCenter);
            table->setItem(r, c, item);
        }
    }

    table->setSortingEnabled(def.sorting);
    table->resizeColumnsToContents();
}

QString MainWindow::formatValue(const QString& key, const QJsonValue& val) const {
    if (val.isUndefined() || val.isNull()) return "";
    if (val.isString()) return val.toString();
    if (val.isDouble()) {
        double d = val.toDouble();
        return QString::number(d, 'f', qAbs(d) < 10 ? 4 : 2);
    }
    return val.toVariant().toString();
}

QColor MainWindow::cellColor(const QString& key, const QJsonValue& val,
                              const ColumnDef& col) const {
    QString type = col.colorType;
    if (type == "bid") return QColor(Colors::BID);
    if (type == "ask") return QColor(Colors::ASK);
    if (type == "direction") {
        QString v = val.toString();
        return (v == "SHORT" || v == "空") ? QColor(Colors::SHORT) : QColor(Colors::LONG);
    }
    if (type == "pnl") {
        double v = val.toDouble();
        return v < 0 ? QColor(Colors::SHORT) : QColor(Colors::LONG);
    }
    return QColor(Colors::TEXT);
}

void MainWindow::updateDepth(const QJsonObject& tick) {
    int dg = m_priceDigits;
    auto sd = [&](int idx, const QString& key) {
        if (m_depthLabels[idx]) m_depthLabels[idx]->setText(
            QString::number(tick[key].toDouble(), 'f', dg));
    };

    sd(8, "ask_price_5"); sd(9, "ask_volume_5");
    sd(6, "ask_price_4"); sd(7, "ask_volume_4");
    sd(4, "ask_price_3"); sd(5, "ask_volume_3");
    sd(2, "ask_price_2"); sd(3, "ask_volume_2");
    sd(0, "ask_price_1"); sd(1, "ask_volume_1");

    double lp = tick["last_price"].toDouble();
    m_depthLabels[10]->setText(QString::number(lp, 'f', dg));

    double pre = tick["pre_close"].toDouble();
    if (pre > 0) {
        double ret = (lp / pre - 1) * 100;
        m_depthLabels[11]->setText(QString("%1%2%").arg(ret >= 0 ? "+" : "").arg(ret, 0, 'f', 2));
    }

    sd(12, "bid_price_1"); sd(13, "bid_volume_1");
    sd(14, "bid_price_2"); sd(15, "bid_volume_2");
    sd(16, "bid_price_3"); sd(17, "bid_volume_3");
    sd(18, "bid_price_4"); sd(19, "bid_volume_4");
    sd(20, "bid_price_5"); sd(21, "bid_volume_5");

    if (m_priceCheck->isChecked()) {
        m_priceEdit->setText(QString::number(lp, 'f', dg));
    }
}

void MainWindow::clearDepth() {
    for (int i = 0; i < 22; i++) {
        if (m_depthLabels[i] && i != 10 && i != 11)
            m_depthLabels[i]->setText("--");
    }
    m_depthLabels[10]->setText("最新");
    m_depthLabels[11]->setText("涨跌幅");
}
