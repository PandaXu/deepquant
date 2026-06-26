#pragma once
#include <QMainWindow>
#include <QTableWidget>
#include <QDockWidget>
#include <QComboBox>
#include <QLineEdit>
#include <QPushButton>
#include <QCheckBox>
#include <QLabel>
#include <QTabWidget>
#include <QTextEdit>
#include <QStatusBar>
#include <QMap>
#include <QTimer>

#include "websocketclient.h"
#include "datamodels.h"

class MainWindow : public QMainWindow {
    Q_OBJECT
public:
    explicit MainWindow(QWidget* parent = nullptr);
    ~MainWindow() = default;

private slots:
    // WebSocket → UI
    void onTick(const QJsonObject& data);
    void onOrder(const QJsonObject& data);
    void onTrade(const QJsonObject& data);
    void onPosition(const QJsonObject& data);
    void onAccount(const QJsonObject& data);
    void onLog(const QJsonObject& data);

    // Trading actions
    void onSetSymbol();
    void onSendOrder(const QString& direction);
    void onCancelAll();

    // Menu actions
    void onConnectGateway();
    void onRefreshStatus();

private:
    void initUI();
    void initDocks();
    void initTradingWidget(QDockWidget* dock);
    void initDepthPanel(QWidget* parent);
    QDockWidget* createMonitor(const MonitorDef& def, const QString& title,
                               Qt::DockWidgetArea area);
    void updateMonitorTable(QTableWidget* table, const MonitorDef& def,
                            const QMap<QString, QJsonObject>& data);
    void updateDepth(const QJsonObject& tick);
    void clearDepth();
    QString formatValue(const QString& key, const QJsonValue& val) const;
    QColor cellColor(const QString& key, const QJsonValue& val,
                     const ColumnDef& col) const;

    // WebSocket client
    WebSocketClient* m_client;

    // Data stores
    QMap<QString, QJsonObject> m_ticks;
    QMap<QString, QJsonObject> m_orders;
    QMap<QString, QJsonObject> m_trades;
    QMap<QString, QJsonObject> m_positions;
    QMap<QString, QJsonObject> m_accounts;
    QStringList m_logs;

    // Monitor tables
    QMap<QString, QTableWidget*> m_monitors;
    MonitorDef m_tickDef, m_orderDef, m_tradeDef, m_posDef, m_accDef, m_logDef;

    // Trading form widgets
    QComboBox* m_exchangeCombo;
    QLineEdit* m_symbolEdit;
    QLineEdit* m_nameEdit;
    QComboBox* m_directionCombo;
    QComboBox* m_offsetCombo;
    QComboBox* m_orderTypeCombo;
    QLineEdit* m_priceEdit;
    QLineEdit* m_volumeEdit;
    QComboBox* m_gatewayCombo;
    QCheckBox* m_priceCheck;

    // Depth labels
    QLabel* m_depthLabels[22]; // ask5-1 prices+vols, mid, bid1-5 prices+vols

    // Status
    QString m_vtSymbol;
    int m_priceDigits = 0;
    QTimer m_clockTimer;
    QLabel* m_wsStatus;
};
