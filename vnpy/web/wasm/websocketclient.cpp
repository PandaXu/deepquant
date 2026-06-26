#include "websocketclient.h"
#include <QDebug>

WebSocketClient::WebSocketClient(const QUrl& url, QObject* parent)
    : QObject(parent), m_url(url)
{
    connect(&m_socket, &QWebSocket::connected, this, &WebSocketClient::onConnected);
    connect(&m_socket, &QWebSocket::disconnected, this, &WebSocketClient::onDisconnected);
    connect(&m_socket, &QWebSocket::textMessageReceived, this, &WebSocketClient::onTextMessageReceived);
    connect(&m_reconnectTimer, &QTimer::timeout, this, &WebSocketClient::onReconnectTimer);
    m_reconnectTimer.setInterval(2000);
}

void WebSocketClient::connectToServer() {
    qDebug() << "WS connecting to" << m_url.toString();
    m_socket.open(m_url);
}

void WebSocketClient::onConnected() {
    m_connected = true;
    m_reconnectTimer.stop();
    qDebug() << "WS connected";
    emit connected();
    sendAction("get_status");
}

void WebSocketClient::onDisconnected() {
    m_connected = false;
    qDebug() << "WS disconnected, reconnecting...";
    emit disconnected();
    m_reconnectTimer.start();
}

void WebSocketClient::onReconnectTimer() {
    if (!m_connected) connectToServer();
}

void WebSocketClient::onTextMessageReceived(const QString& msg) {
    QJsonDocument doc = QJsonDocument::fromJson(msg.toUtf8());
    if (!doc.isObject()) return;
    QJsonObject root = doc.object();
    QString type = root["type"].toString();
    QJsonObject data = root["data"].toObject();

    if (type.startsWith("eTick."))       emit tickReceived(data);
    else if (type.startsWith("eOrder.")) emit orderReceived(data);
    else if (type.startsWith("eTrade.")) emit tradeReceived(data);
    else if (type.startsWith("ePosition.")) emit positionReceived(data);
    else if (type.startsWith("eAccount."))  emit accountReceived(data);
    else if (type == "eLog")             emit logReceived(data);
    else if (type == "status")           emit statusReceived(data);
}

void WebSocketClient::sendAction(const QString& action, const QJsonObject& payload) {
    QJsonObject msg;
    msg["action"] = action;
    msg["payload"] = payload;
    m_socket.sendTextMessage(QJsonDocument(msg).toJson(QJsonDocument::Compact));
}

void WebSocketClient::sendOrder(const QString& symbol, const QString& exchange,
                                 const QString& direction, const QString& offset,
                                 double price, double volume, const QString& orderType,
                                 const QString& gateway) {
    QJsonObject p;
    p["symbol"] = symbol; p["exchange"] = exchange;
    p["direction"] = direction; p["offset"] = offset;
    p["price"] = price; p["volume"] = volume;
    p["order_type"] = orderType; p["gateway"] = gateway;
    sendAction("send_order", p);
}

void WebSocketClient::cancelOrder(const QString& orderid, const QString& symbol,
                                   const QString& exchange, const QString& gateway) {
    QJsonObject p;
    p["orderid"] = orderid; p["symbol"] = symbol;
    p["exchange"] = exchange; p["gateway"] = gateway;
    sendAction("cancel_order", p);
}

void WebSocketClient::subscribeSymbol(const QString& symbol, const QString& exchange) {
    QJsonObject p;
    p["symbol"] = symbol; p["exchange"] = exchange;
    sendAction("subscribe", p);
}
