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
│   ├── run.py                  #   多实例入口 (gateways.toml 配置)
│   ├── server.py               #   独立 MainEngine + EventEngine
│   ├── gateway/                #   网关实现
│   │   ├── ctp_gateway.py      #     CtpGateway (official 后端)
│   │   └── tts_gateway.py      #     TtsGateway (tts 后端)
├── deepquant_ctp/              # CTP 协议层 (纯协议，无网关逻辑)
│   └── api/                    #   多后端 C++ 绑定 (official/tts)
├── deepquant_web/              # Web 前端 (:8080)
│   └── static/                 #   Vue3 + ECharts SPA
└── deepquant_datarecorder/     # 数据录制器 (:8900)
    └── engine.py               #   tick/bar 持久化
└── deepquant_datamanager/      # 历史数据管理 App (Server MainEngine)
    └── engine.py               #   下载/更新/导入导出
└── deepquant_ctabacktester/    # CTA 回测 App (Server MainEngine)
    └── engine.py               #   历史回测、参数优化
```

## 快速开始

### 启动全部服务

```bash
# 推荐：一键启动（venv + PYTHONPATH 含 deepquant_ctabacktester）
./start.sh

# 或手动启动
PYTHONPATH="deepquant:deepquant_gateway:deepquant_ctp:deepquant_server:deepquant_datarecorder:deepquant_datamanager:deepquant_ctabacktester" \
  python deepquant_gateway/run.py --instance ctp-simnow

PYTHONPATH="deepquant:deepquant_server:deepquant_ctp:deepquant_datamanager:deepquant_ctabacktester" \
  python deepquant_server/run.py

python deepquant_web/run.py
```

### 可选 App 依赖

Server 按需加载 vnpy/DeepQuant App（ImportError 则跳过）：

| 包名 | 用途 |
|------|------|
| `vnpy_ctastrategy` | CTA 实盘策略 |
| `deepquant_ctabacktester` | CTA 回测（**替代 vnpy_ctabacktester**） |
| `deepquant_datamanager` | 历史数据管理 |
| `vnpy_paperaccount` | 模拟交易 |

安装示例：`pip install -e deepquant_ctabacktester`

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
