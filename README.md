# DeepQuant — 量化交易平台

微服务架构的量化交易系统，支持 CTP/TTS 多网关、实时行情、策略交易、数据录制。

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                   deepquant_web  (:8080)                     │
│                   Vue3 + ECharts 前端                        │
│                   行情交易 · 数据管理 · 策略 · 日志 · 设置      │
└──────────────────────────┬──────────────────────────────────┘
                           │ WS + REST
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  deepquant_server  (:8888)                   │
│                  API 网关 · 无 MainEngine                    │
│                                                             │
│  · account_store    账户管理 (SQLite)                        │
│  · gateway_registry 网关路由 (配置驱动)                       │
│  · strategy_mgr     策略调度                                 │
│  · WS fan-out       事件广播 → Web                           │
└──────┬──────────────┬──────────────┬────────────────────────┘
       │ HTTP+WS      │ HTTP+WS      │ WS
       ▼              ▼              ▼
┌────────────┐ ┌────────────┐ ┌────────────────────────────┐
│ gateway    │ │ gateway    │ │  datarecorder  (:8900)     │
│ :8889      │ │ :8890      │ │  监听 gateway WS 事件       │
│ CTP/official│ │ TTS/tts    │ │  tick → Bar → DB           │
│ SimNow仿真  │ │ OpenCTP    │ └────────────────────────────┘
└──────┬─────┘ └──────┬─────┘
       │              │
       ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                   deepquant_ctp  (协议层)                     │
│  api/backends/                                              │
│    official/   CTP 6.7.11 原生库                             │
│    tts/        TTS 兼容库                                    │
└─────────────────────────────────────────────────────────────┘
```

## 项目结构

```
deepquant/
├── deepquant/                  # 核心库 (事件引擎、交易对象、数据工具)
├── deepquant_server/           # API 网关 (:8888)
│   ├── server.py               #   FastAPI + WebSocket
│   ├── gateway_client.py       #   HTTP+WS 客户端 → gateway
│   ├── account_store.py        #   账户管理 (SQLite)
│   └── strategy_service.py     #   策略调度
├── deepquant_gateway/          # 网关服务 (:8889+)
│   └── server.py               #   独立 MainEngine，连接 CTP/TTS
├── deepquant_ctp/              # CTP 协议层 (纯协议，无网关逻辑)
│   └── api/                    #   多后端 C++ 绑定
├── deepquant_gateway/          # 网关服务 (:8889+)
│   ├── gateway/                #   网关实现
│   │   ├── ctp_gateway.py      #     CtpGateway
│   │   └── tts_gateway.py      #     TtsGateway (TTS 独立后端)
├── deepquant_web/              # Web 前端 (:8080)
│   └── static/                 #   Vue3 + ECharts SPA
└── deepquant_datarecorder/     # 数据录制器 (:8900)
    └── engine.py               #   tick/bar 持久化
```

## 快速开始

### 启动全部服务

```bash
# 1. Gateway (可启多个实例，不同端口+后端)
PYTHONPATH="deepquant:deepquant_gateway:deepquant_ctp" \
  python deepquant_gateway/run.py

# 2. Server
PYTHONPATH="deepquant:deepquant_server:deepquant_ctp" \
  python deepquant_server/run.py

# 3. Web
python deepquant_web/run.py
```

| 服务 | 端口 | 说明 |
|------|------|------|
| Gateway | 8889 | 交易网关 (CTP official) |
| Server | 8888 | API 网关 |
| Web | 8080 | 前端界面 |

### 多网关配置（规划中）

```toml
# gateways.toml
[[gateways]]
id = "ctp-simnow"
port = 8889
backend = "official"
accounts = [3, 4]

[[gateways]]
id = "tts-openctp"
port = 8890
backend = "tts"
accounts = [5]
```

## 服务间通信

| 方向 | 协议 | 说明 |
|------|------|------|
| Web → Server | WS + REST | 前端交互 |
| Server → Gateway | HTTP | 控制面：connect/disconnect/subscribe |
| Server ← Gateway | WS | 数据面：tick/order/trade/position/account/log |
| Datarecorder ← Gateway | WS | 行情数据录制 |

## 关键设计

- **Server 零代码引用网关** — 通过 GatewayClient (HTTP+WS) 通信，Gateway 可独立重启
- **多后端共存** — `load_backend("official")` 和 `load_backend("tts")` 加载不同 .so，同一进程内共存
- **账户归属网关** — 每个账户绑定到特定 gateway 实例，切换账户即切换网关
- **事件流单向** — Gateway → Server → Web，数据流清晰可追踪

## 许可证

MIT License
