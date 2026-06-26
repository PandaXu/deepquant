#pragma once
#include <QString>
#include <QJsonObject>
#include <QJsonArray>
#include <QDateTime>
#include <QMap>

// ---- Exact Qt GUI color constants ----
namespace Colors {
    constexpr auto BID     = "#ffaec9";  // pink
    constexpr auto ASK     = "#a0ffa0";  // green
    constexpr auto LONG    = "#ff4444";  // red
    constexpr auto SHORT   = "#00aa00";  // green
    constexpr auto BG      = "#1e1e1e";
    constexpr auto SURFACE = "#2d2d2d";
    constexpr auto HEADER  = "#333333";
    constexpr auto BORDER  = "#3c3c3c";
    constexpr auto TEXT    = "#d4d4d4";
    constexpr auto DIM     = "#808080";
    constexpr auto ACCENT  = "#007acc";
}

// ---- Monitor column definitions (exact Qt headers) ----
struct ColumnDef {
    QString key;
    QString label;
    bool isUpdate;     // changes trigger row update
    QString colorType; // "bid"|"ask"|"direction"|"pnl"|"enum"|""
};

struct MonitorDef {
    QString name;
    QString dataKey;   // key for row matching (empty = always insert)
    QList<ColumnDef> columns;
    bool sorting;
};

inline QMap<QString, MonitorDef> createMonitorDefs() {
    QMap<QString, MonitorDef> defs;

    // TickMonitor
    defs["tick"] = {
        "行情", "vt_symbol",
        {
            {"symbol","代码",false,""}, {"exchange","交易所",false,"enum"},
            {"name","名称",true,""}, {"last_price","最新价",true,""},
            {"volume","成交量",true,""}, {"open_price","开盘价",true,""},
            {"high_price","最高价",true,""}, {"low_price","最低价",true,""},
            {"bid_price_1","买1价",true,"bid"}, {"bid_volume_1","买1量",true,"bid"},
            {"ask_price_1","卖1价",true,"ask"}, {"ask_volume_1","卖1量",true,"ask"},
            {"datetime","时间",true,""}, {"gateway_name","接口",false,""}
        }, true
    };

    // OrderMonitor
    defs["order"] = {
        "委托", "vt_orderid",
        {
            {"orderid","委托号",false,""}, {"reference","来源",false,""},
            {"symbol","代码",false,""}, {"exchange","交易所",false,"enum"},
            {"type","类型",false,"enum"}, {"direction","方向",false,"direction"},
            {"offset","开平",false,"enum"}, {"price","价格",false,""},
            {"volume","总数量",true,""}, {"traded","已成交",true,""},
            {"status","状态",true,"enum"}, {"datetime","时间",true,""},
            {"gateway_name","接口",false,""}
        }, true
    };

    // TradeMonitor
    defs["trade"] = {
        "成交", "",
        {
            {"tradeid","成交号",false,""}, {"orderid","委托号",false,""},
            {"symbol","代码",false,""}, {"exchange","交易所",false,"enum"},
            {"direction","方向",false,"direction"}, {"offset","开平",false,"enum"},
            {"price","价格",false,""}, {"volume","数量",false,""},
            {"datetime","时间",false,""}, {"gateway_name","接口",false,""}
        }, true
    };

    // PositionMonitor
    defs["position"] = {
        "持仓", "vt_positionid",
        {
            {"symbol","代码",false,""}, {"exchange","交易所",false,"enum"},
            {"direction","方向",false,"direction"}, {"volume","数量",true,""},
            {"yd_volume","昨仓",true,""}, {"frozen","冻结",true,""},
            {"price","均价",true,""}, {"pnl","盈亏",true,"pnl"},
            {"gateway_name","接口",false,""}
        }, true
    };

    // AccountMonitor
    defs["account"] = {
        "资金", "vt_accountid",
        {
            {"accountid","账号",false,""}, {"balance","余额",true,""},
            {"frozen","冻结",true,""}, {"available","可用",true,""},
            {"gateway_name","接口",false,""}
        }, true
    };

    // LogMonitor
    defs["log"] = {
        "日志", "",
        {
            {"time","时间",false,""}, {"msg","信息",false,""},
            {"gateway_name","接口",false,""}
        }, false
    };

    return defs;
}

// ---- Data stores ----
struct TickData {
    QString vt_symbol, symbol, exchange, name, gateway_name;
    double last_price=0, volume=0, open_price=0, high_price=0, low_price=0;
    double bid_price_1=0, bid_volume_1=0, ask_price_1=0, ask_volume_1=0;
    double bid_price_2=0, bid_volume_2=0, ask_price_2=0, ask_volume_2=0;
    double bid_price_3=0, bid_volume_3=0, ask_price_3=0, ask_volume_3=0;
    double bid_price_4=0, bid_volume_4=0, ask_price_4=0, ask_volume_4=0;
    double bid_price_5=0, bid_volume_5=0, ask_price_5=0, ask_volume_5=0;
    double pre_close=0, limit_up=0, limit_down=0, open_interest=0, turnover=0;
    QString datetime;

    static TickData fromJson(const QJsonObject& j) {
        TickData t;
        auto s = [&](const char* k, QString& f) { if(j.contains(k)) f=j[k].toString(); };
        auto d = [&](const char* k, double& f) { if(j.contains(k)) f=j[k].toDouble(); };
        s("vt_symbol",t.vt_symbol); s("symbol",t.symbol); s("exchange",t.exchange);
        s("name",t.name); s("gateway_name",t.gateway_name); s("datetime",t.datetime);
        d("last_price",t.last_price); d("volume",t.volume);
        d("open_price",t.open_price); d("high_price",t.high_price); d("low_price",t.low_price);
        d("bid_price_1",t.bid_price_1); d("bid_volume_1",t.bid_volume_1);
        d("ask_price_1",t.ask_price_1); d("ask_volume_1",t.ask_volume_1);
        d("bid_price_2",t.bid_price_2); d("bid_volume_2",t.bid_volume_2);
        d("ask_price_2",t.ask_price_2); d("ask_volume_2",t.ask_volume_2);
        d("bid_price_3",t.bid_price_3); d("bid_volume_3",t.bid_volume_3);
        d("ask_price_3",t.ask_price_3); d("ask_volume_3",t.ask_volume_3);
        d("bid_price_4",t.bid_price_4); d("bid_volume_4",t.bid_volume_4);
        d("ask_price_4",t.ask_price_4); d("ask_volume_4",t.ask_volume_4);
        d("bid_price_5",t.bid_price_5); d("bid_volume_5",t.bid_volume_5);
        d("ask_price_5",t.ask_price_5); d("ask_volume_5",t.ask_volume_5);
        d("pre_close",t.pre_close);
        return t;
    }
};

// Generic row: QJsonObject + typed accessor
using DataRow = QJsonObject;

inline QString rowGet(const DataRow& r, const QString& key) {
    if (!r.contains(key)) return "";
    QJsonValue v = r[key];
    if (v.isString()) return v.toString();
    if (v.isDouble()) {
        double d = v.toDouble();
        return QString::number(d, 'f', qAbs(d)<10 ? 4 : 2);
    }
    return v.toVariant().toString();
}
