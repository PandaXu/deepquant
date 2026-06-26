#pragma once
#include <QObject>
#include <QWebSocket>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTimer>
#include <QUrl>

// Connects to the Python FastAPI backend via WebSocket
// Protocol: JSON messages with {type, data, time}
class WebSocketClient : public QObject {
    Q_OBJECT
public:
    explicit WebSocketClient(const QUrl& url, QObject* parent = nullptr);

    void connectToServer();
    void disconnect();
    bool isConnected() const { return m_connected; }

    // Send action commands to backend
    void sendAction(const QString& action, const QJsonObject& payload = {});
    void sendOrder(const QString& symbol, const QString& exchange,
                   const QString& direction, const QString& offset,
                   double price, double volume, const QString& orderType,
                   const QString& gateway);
    void cancelOrder(const QString& orderid, const QString& symbol,
                     const QString& exchange, const QString& gateway);
    void subscribeSymbol(const QString& symbol, const QString& exchange);

signals:
    void connected();
    void disconnected();
    void tickReceived(const QJsonObject& data);
    void orderReceived(const QJsonObject& data);
    void tradeReceived(const QJsonObject& data);
    void positionReceived(const QJsonObject& data);
    void accountReceived(const QJsonObject& data);
    void logReceived(const QJsonObject& data);
    void statusReceived(const QJsonObject& data);

private slots:
    void onConnected();
    void onDisconnected();
    void onTextMessageReceived(const QString& msg);
    void onReconnectTimer();

private:
    QWebSocket m_socket;
    QUrl m_url;
    QTimer m_reconnectTimer;
    bool m_connected = false;
};
