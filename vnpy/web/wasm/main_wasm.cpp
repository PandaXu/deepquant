/**
 * VeighNa Trader — Qt6 WebAssembly
 * Actual Qt C++ widgets compiled to WASM!
 */
#include <QApplication>
#include <QMainWindow>
#include <QDockWidget>
#include <QTableWidget>
#include <QTabWidget>
#include <QComboBox>
#include <QLineEdit>
#include <QPushButton>
#include <QLabel>
#include <QCheckBox>
#include <QGridLayout>
#include <QVBoxLayout>
#include <QHBoxLayout>
#include <QFormLayout>
#include <QHeaderView>
#include <QMenuBar>
#include <QMenu>
#include <QStatusBar>
#include <QTimer>
#include <QDateTime>
#include <QPalette>
#include <QStyleFactory>
#include <QFont>

static const char* C_BG   = "#1e1e1e";
static const char* C_SURF = "#2d2d2d";
static const char* C_BTN_L = "#c42b1c"; // buy
static const char* C_BTN_S = "#0b6016"; // sell
static const char* C_BID  = "#ffaec9";
static const char* C_ASK  = "#a0ffa0";
static const char* C_LONG = "#ff4444";
static const char* C_SHORT= "#00aa00";

// ---- Qt Widget helpers ----
static QLabel* makeDepthLabel(const QString& color, Qt::Alignment align = Qt::AlignLeft) {
    QLabel* l = new QLabel("--");
    l->setStyleSheet(QString("color:%1;font-family:Consolas;font-size:12px;").arg(color));
    l->setAlignment(align);
    return l;
}

int main(int argc, char* argv[]) {
    QApplication app(argc, argv);
    app.setApplicationName("VeighNa Trader");
    app.setApplicationVersion("4.4.0 [Qt-WASM]");

    // Dark Fusion theme
    app.setStyle(QStyleFactory::create("Fusion"));
    QPalette p;
    p.setColor(QPalette::Window, QColor(C_BG));
    p.setColor(QPalette::WindowText, QColor("#d4d4d4"));
    p.setColor(QPalette::Base, QColor("#252526"));
    p.setColor(QPalette::Text, QColor("#d4d4d4"));
    p.setColor(QPalette::Button, QColor(C_SURF));
    p.setColor(QPalette::ButtonText, QColor("#d4d4d4"));
    p.setColor(QPalette::Highlight, QColor("#007acc"));
    app.setPalette(p);

    // ---- MainWindow ----
    QMainWindow win;
    win.setWindowTitle("VeighNa Trader 社区版 — 4.4.0 [Qt-WASM]");
    win.resize(1400, 900);

    // Menu
    QMenu* sysMenu = win.menuBar()->addMenu("系统");
    sysMenu->addAction("连接CTP");
    sysMenu->addSeparator();
    sysMenu->addAction("退出");
    win.menuBar()->addMenu("功能");
    win.menuBar()->addMenu("帮助");
    win.statusBar()->showMessage("🚀 Qt6 WebAssembly — all C++ widgets rendered in browser");

    // ---- Left Dock: Trading Widget ----
    QDockWidget* tradeDock = new QDockWidget("📝 交易");
    QWidget* tradeWidget = new QWidget();
    QVBoxLayout* tradeLayout = new QVBoxLayout(tradeWidget);
    tradeLayout->setSpacing(4);

    QGridLayout* form = new QGridLayout();
    int r = 0;
    auto addRow = [&](const char* label, QWidget* w, QWidget* w2=nullptr) {
        QLabel* l = new QLabel(label);
        l->setStyleSheet("color:#808080;font-size:11px;");
        form->addWidget(l, r, 0);
        if (w2) { form->addWidget(w, r, 1); form->addWidget(w2, r, 2); }
        else form->addWidget(w, r, 1, 1, 2);
        r++;
    };

    QComboBox* exCB = new QComboBox();
    exCB->addItems({"CFFEX","SHFE","CZCE","DCE","INE","GFEX"});
    exCB->setCurrentIndex(1);

    QLineEdit* symEdit = new QLineEdit();
    symEdit->setText("rb2510");
    symEdit->setPlaceholderText("输入代码回车订阅");

    QLineEdit* nameEdit = new QLineEdit();
    nameEdit->setReadOnly(true);
    nameEdit->setStyleSheet("color:#808080");

    QComboBox* dirCB = new QComboBox();
    dirCB->addItems({"多","空"});

    QComboBox* offCB = new QComboBox();
    offCB->addItems({"开","平","平今","平昨"});

    QComboBox* typeCB = new QComboBox();
    typeCB->addItems({"限价","市价","FAK","FOK"});

    QLineEdit* priceEdit = new QLineEdit();
    priceEdit->setText("3500");
    QCheckBox* priceChk = new QCheckBox("价格随行情");

    QLineEdit* volEdit = new QLineEdit();
    volEdit->setText("1");

    QComboBox* gwCB = new QComboBox();
    gwCB->addItems({"CTP"});

    addRow("交易所", exCB);
    addRow("代码", symEdit);
    addRow("名称", nameEdit);
    addRow("方向", dirCB);
    addRow("开平", offCB);
    addRow("类型", typeCB);
    addRow("价格", priceEdit, priceChk);
    addRow("数量", volEdit);
    addRow("接口", gwCB);

    QPushButton* btnSell = new QPushButton("空");
    btnSell->setStyleSheet(QString("background:%1;color:#fff;font-weight:bold;padding:5px;").arg(C_BTN_S));
    QPushButton* btnBuy = new QPushButton("多");
    btnBuy->setStyleSheet(QString("background:%1;color:#fff;font-weight:bold;padding:5px;").arg(C_BTN_L));
    QPushButton* btnCancelAll = new QPushButton("全撤");
    btnCancelAll->setStyleSheet("background:#333;color:#808080;padding:5px;");

    QHBoxLayout* btnRow = new QHBoxLayout();
    btnRow->addWidget(btnSell);
    btnRow->addWidget(btnBuy);
    form->addLayout(btnRow, r, 0, 1, 3);
    r++;
    form->addWidget(btnCancelAll, r, 0, 1, 3);

    tradeLayout->addLayout(form);

    // 5-level depth
    QWidget* depthW = new QWidget();
    QFormLayout* depthLayout = new QFormLayout(depthW);
    depthLayout->setSpacing(1);

    // Ask 5..1
    for (int i=4; i>=0; i--) {
        QLabel* p = makeDepthLabel(C_ASK); QLabel* v = makeDepthLabel(C_ASK, Qt::AlignRight);
        depthLayout->addRow(p, v);
    }

    // Mid: last price + return
    QLabel* midP = new QLabel("最新");
    midP->setStyleSheet("font-weight:bold;font-size:14px;color:#d4d4d4;");
    QLabel* midR = new QLabel("涨跌幅");
    midR->setStyleSheet("color:#808080;");
    midR->setAlignment(Qt::AlignRight);
    depthLayout->addRow(midP, midR);

    // Bid 1..5
    for (int i=0; i<5; i++) {
        QLabel* p = makeDepthLabel(C_BID); QLabel* v = makeDepthLabel(C_BID, Qt::AlignRight);
        depthLayout->addRow(p, v);
    }
    tradeLayout->addWidget(depthW);
    tradeDock->setWidget(tradeWidget);
    tradeDock->setMinimumWidth(280);
    tradeDock->setMaximumWidth(320);
    win.addDockWidget(Qt::LeftDockWidgetArea, tradeDock);

    // ---- Right: TickMonitor ----
    QDockWidget* tickDock = new QDockWidget("📈 行情");
    QTableWidget* tickTable = new QTableWidget();
    tickTable->setColumnCount(14);
    tickTable->setHorizontalHeaderLabels({
        "代码","交易所","名称","最新价","成交量","开盘价","最高价","最低价",
        "买1价","买1量","卖1价","卖1量","时间","接口"
    });
    tickTable->setAlternatingRowColors(true);
    tickTable->horizontalHeader()->setStretchLastSection(true);
    tickTable->verticalHeader()->setVisible(false);
    tickTable->setEditTriggers(QAbstractItemView::NoEditTriggers);
    tickDock->setWidget(tickTable);
    win.addDockWidget(Qt::RightDockWidgetArea, tickDock);

    // ---- Right: OrderMonitor ----
    QDockWidget* orderDock = new QDockWidget("📋 委托");
    QTableWidget* orderTable = new QTableWidget();
    orderTable->setColumnCount(13);
    orderTable->setHorizontalHeaderLabels({
        "委托号","来源","代码","交易所","类型","方向","开平","价格",
        "总数量","已成交","状态","时间","接口"
    });
    orderTable->setAlternatingRowColors(true);
    orderTable->horizontalHeader()->setStretchLastSection(true);
    orderTable->verticalHeader()->setVisible(false);
    orderTable->setEditTriggers(QAbstractItemView::NoEditTriggers);
    orderDock->setWidget(orderTable);
    win.addDockWidget(Qt::RightDockWidgetArea, orderDock);

    // ---- Bottom: TradeMonitor ----
    QDockWidget* tradeMonDock = new QDockWidget("💰 成交");
    QTableWidget* tradeMonTable = new QTableWidget();
    tradeMonTable->setColumnCount(10);
    tradeMonTable->setHorizontalHeaderLabels({
        "成交号","委托号","代码","交易所","方向","开平","价格","数量","时间","接口"
    });
    tradeMonTable->setAlternatingRowColors(true);
    tradeMonTable->horizontalHeader()->setStretchLastSection(true);
    tradeMonTable->verticalHeader()->setVisible(false);
    tradeMonTable->setEditTriggers(QAbstractItemView::NoEditTriggers);
    tradeMonDock->setWidget(tradeMonTable);
    win.addDockWidget(Qt::BottomDockWidgetArea, tradeMonDock);

    // ---- Bottom: Account/Position ----
    QDockWidget* accPosDock = new QDockWidget("资金/持仓");
    QTabWidget* accPosTab = new QTabWidget();
    QTableWidget* accTable = new QTableWidget();
    accTable->setColumnCount(5);
    accTable->setHorizontalHeaderLabels({"账号","余额","冻结","可用","接口"});
    accTable->setAlternatingRowColors(true);
    accTable->horizontalHeader()->setStretchLastSection(true);
    accTable->verticalHeader()->setVisible(false);

    QTableWidget* posTable = new QTableWidget();
    posTable->setColumnCount(9);
    posTable->setHorizontalHeaderLabels({
        "代码","交易所","方向","数量","昨仓","冻结","均价","盈亏","接口"
    });
    posTable->setAlternatingRowColors(true);
    posTable->horizontalHeader()->setStretchLastSection(true);
    posTable->verticalHeader()->setVisible(false);

    accPosTab->addTab(accTable, "资金");
    accPosTab->addTab(posTable, "持仓");
    accPosDock->setWidget(accPosTab);
    win.addDockWidget(Qt::BottomDockWidgetArea, accPosDock);

    // ---- Log ----
    QDockWidget* logDock = new QDockWidget("📜 日志");
    QTableWidget* logTable = new QTableWidget();
    logTable->setColumnCount(3);
    logTable->setHorizontalHeaderLabels({"时间","信息","接口"});
    logTable->setAlternatingRowColors(true);
    logTable->horizontalHeader()->setStretchLastSection(true);
    logTable->verticalHeader()->setVisible(false);
    // Add test log entries
    logTable->setRowCount(4);
    auto addLog = [&](int r, const QString& t, const QString& m, const QString& g) {
        QTableWidgetItem* ti = new QTableWidgetItem(t);
        ti->setForeground(QColor("#569cd6"));
        logTable->setItem(r,0,ti);
        logTable->setItem(r,1,new QTableWidgetItem(m));
        QTableWidgetItem* gi = new QTableWidgetItem(g);
        gi->setForeground(QColor("#808080"));
        logTable->setItem(r,2,gi);
    };
    addLog(0, "14:30:00", "Qt6 WebAssembly Trader started", "MainEngine");
    addLog(1, "14:30:01", "CTP Gateway registered", "CTP");
    addLog(2, "14:30:02", "合约信息查询成功", "CTP");
    addLog(3, "14:30:03", "Qt6 Widgets rendering natively in browser", "WASM");
    logDock->setWidget(logTable);
    win.addDockWidget(Qt::BottomDockWidgetArea, logDock);

    // ---- Clock ----
    QTimer* clock = new QTimer(&win);
    QObject::connect(clock, &QTimer::timeout, [&win]() {
        win.statusBar()->showMessage(
            QDateTime::currentDateTime().toString("HH:mm:ss") +
            "  |  Qt6 C++ Widgets compiled to WebAssembly"
        );
    });
    clock->start(1000);

    win.show();
    return app.exec();
}
