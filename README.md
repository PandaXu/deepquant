# VeighNa (vnpy) — 量化交易框架

基于 [VeighNa](https://github.com/vnpy/vnpy) v4.4.0 的量化交易平台，新增 **Web GUI**、**WebAssembly (WASM)**、**macOS Apple Silicon CTP 适配**。

## 项目结构

```
vn.py/
├── vnpy/                           # VeighNa 核心框架
│   ├── vnpy/event/engine.py        #   事件驱动引擎
│   ├── vnpy/trader/                #   交易核心
│   │   ├── engine.py               #   MainEngine / OmsEngine / Email / Wechat
│   │   ├── gateway.py              #   BaseGateway 抽象
│   │   ├── object.py               #   Tick/Order/Trade/Position/Account 数据对象
│   │   ├── converter.py            #   OffsetConverter 期货平仓转换
│   │   ├── utility.py              #   BarGenerator / ArrayManager (TA-Lib)
│   │   ├── optimize.py             #   参数优化 (穷举/遗传算法 DEAP)
│   │   └── ui/                     #   Qt 桌面界面 (mainwindow/widget)
│   ├── vnpy/alpha/                 #   Alpha 研究平台
│   │   ├── lab.py                  #   AlphaLab 研究实验室
│   │   ├── dataset/                #   数据集 (Alpha101/158 因子, 截面/时序函数)
│   │   ├── model/                  #   模型 (LightGBM/MLP/Lasso)
│   │   └── strategy/               #   策略模板 + 回测引擎
│   ├── vnpy/rpc/                   #   ZeroMQ RPC 分布式服务
│   ├── vnpy/chart/                 #   K 线图表 (Qt)
│   │
│   ├── web/                        # 🆕 Web 版本
│   │   ├── server.py               #   FastAPI 后端 + WebSocket 事件桥接
│   │   ├── index.html              #   Qt 风格 SPA 前端 (严格还原)
│   │   ├── wasm/                   #   🆕 Qt6 WASM C++ 源码 (编译就绪)
│   │   │   ├── main.cpp            #   QApplication 入口
│   │   │   ├── mainwindow.h/cpp    #   Qt MainWindow + 所有 Dock/Widget
│   │   │   ├── websocketclient.cpp #   QWebSocket 客户端
│   │   │   ├── datamodels.h        #   列定义/颜色常量
│   │   │   ├── veighna_wasm.cpp    #   Emscripten WASM 引擎 (9 个导出函数)
│   │   │   ├── pre.js              #   WASM↔JS WebSocket 桥接
│   │   │   ├── CMakeLists.txt      #   桌面/WASM 双目标构建
│   │   │   └── build_wasm.sh       #   一键构建脚本
│   │   └── wasm-dist/              #   编译产物
│   │       ├── index.html          #   WASM 完整交易界面 (1:1 Qt 对标)
│   │       ├── veighna_wasm.wasm   #   WebAssembly 二进制 (8.1 KB)
│   │       └── veighna_wasm.js     #   JS glue code (15 KB)
│   │
│   ├── examples/
│   │   └── mac_run.py              #   macOS GUI 启动脚本
│   └── tests/
│
├── vnpy_ctp/                       # CTP 期货网关 (Apple Silicon 适配)
│   ├── vnpy_ctp/gateway/ctp_gateway.py  # Python Gateway 实现
│   ├── vnpy_ctp/api/vnctp/         #   C++ pybind11 绑定层
│   └── meson.build                 #   Meson 构建 (已适配 macOS)
│
├── architecture.html               # 核心框架架构分析
└── vnpy_ctp_analysis.html          # CTP 网关代码逻辑分析
```

## 快速开始

### 环境要求

- Python >= 3.10
- macOS / Windows / Linux
- Emscripten SDK (仅 WASM 编译需要)

### 安装

```bash
cd vnpy
python3.12 -m venv .venv
source .venv/bin/activate

# 安装核心框架
pip install -e ".[alpha,dev]"

# 安装 CTP 网关（macOS 需从本地源码编译）
pip install ../vnpy_ctp/

# 安装 App 模块
pip install vnpy-ctastrategy vnpy-ctabacktester vnpy-datamanager vnpy-paperaccount

# Web 依赖
pip install fastapi uvicorn websockets
```

### 启动桌面 GUI

```bash
source .venv/bin/activate
python examples/mac_run.py
```

### 启动 Web Trader

```bash
source .venv/bin/activate
python web/server.py
```

| URL | 版本 | 引擎 |
|-----|------|------|
| **http://localhost:8888** | Qt 风格 Web Trader | JS WebSocket |
| **http://localhost:8888/wasm** | WASM Trader | C++ WebAssembly |

## 三种 GUI 对比

| 特性 | Qt 桌面版 | Web 版 | WASM 版 |
|------|----------|--------|---------|
| **后端** | Python EventEngine | Python FastAPI | Python FastAPI |
| **前端** | PySide6/Qt C++ | HTML/CSS/JS | C++ → WASM + HTML |
| **通信** | 直接调用 | JS WebSocket | WASM WebSocket |
| **布局** | QMainWindow + Dock | CSS Grid | CSS Grid (同 Qt) |
| **TradingWidget** | ✅ | ✅ | ✅ |
| **5 档盘口** | ✅ | ✅ | ✅ |
| **TickMonitor (14列)** | ✅ | ✅ | ✅ |
| **OrderMonitor (13列)** | ✅ | ✅ | ✅ |
| **ActiveOrderMonitor** | ✅ (Tab) | ✅ (Tab) | ✅ (Tab) |
| **TradeMonitor (10列)** | ✅ | ✅ | ✅ |
| **PositionMonitor (9列)** | ✅ | ✅ | ✅ |
| **AccountMonitor (5列)** | ✅ | ✅ | ✅ |
| **LogMonitor** | ✅ | ✅ | ✅ |
| **ConnectDialog** | ✅ | ✅ | ✅ |
| **颜色体系** | ✅ | ✅ | ✅ |
| **WASM 原生计算** | ❌ | ❌ | ✅ C++ 速度 |

## Web Trader 功能模块

### Qt 1:1 对标清单

每个 Qt GUI 组件的列定义、颜色、交互都严格还原：

| 组件 | 列数 | 列名 |
|------|------|------|
| TickMonitor | 14 | 代码/交易所/名称/最新价/成交量/开盘价/最高价/最低价/买1价/买1量/卖1价/卖1量/时间/接口 |
| OrderMonitor | 13 | 委托号/来源/代码/交易所/类型/方向/开平/价格/总数量/已成交/状态/时间/接口 |
| ActiveOrderMonitor | 13 | (同 OrderMonitor，仅显示活跃委托) |
| TradeMonitor | 10 | 成交号/委托号/代码/交易所/方向/开平/价格/数量/时间/接口 |
| PositionMonitor | 9 | 代码/交易所/方向/数量/昨仓/冻结/均价/盈亏/接口 |
| AccountMonitor | 5 | 账号/余额/冻结/可用/接口 |
| LogMonitor | 3 | 时间/信息/接口 |

### 颜色规则 (与 Qt 完全一致)

| 元素 | 颜色 | 色值 |
|------|------|------|
| 买价/买量 (Bid) | 粉色 | `#ffaec9` |
| 卖价/卖量 (Ask) | 绿色 | `#a0ffa0` |
| 多头方向 (Long) | 红色 | `#ff4444` |
| 空头方向 (Short) | 绿色 | `#00aa00` |
| 盈亏正值 | 红色 | `#ff4444` |
| 盈亏负值 | 绿色 | `#00aa00` |

## WASM 引擎

### 架构

```
浏览器
┌────────────────────────────────────┐
│  C++ WebAssembly (veighna_wasm.wasm)│
│  ┌──────────────────────────┐       │
│  │ 9 个导出函数:              │       │
│  │ sendOrder / cancelOrder   │       │
│  │ subscribeSymbol / query*  │       │
│  │ connectGateway            │       │
│  │ calculateVWAP / Sharpe    │       │
│  │ calculateMaxDrawdown      │       │
│  └──────────────────────────┘       │
│  pre.js ↔ WebSocket ↔ Python 后端   │
└────────────────────────────────────┘
```

### 构建命令

```bash
source ~/emsdk/emsdk_env.sh
cd web/wasm
em++ -O3 -std=c++17 veighna_wasm.cpp -o veighna_wasm.js \
  -sEXPORTED_FUNCTIONS='["_main","_sendOrder","_cancelOrder",...]' \
  -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
  --pre-js pre.js -sALLOW_MEMORY_GROWTH=1
```

### C++ 导出函数

| 函数 | 签名 | 说明 |
|------|------|------|
| `sendOrder` | `(symbol, exchange, direction, offset, price, volume, orderType, gateway)` | 下单 |
| `cancelOrder` | `(orderid, symbol, exchange, gateway)` | 撤单 |
| `subscribeSymbol` | `(symbol, exchange)` | 订阅行情 |
| `queryAccount` | `()` | 查询资金 |
| `queryPosition` | `()` | 查询持仓 |
| `connectGateway` | `(gateway, settingJson)` | 连接网关 |
| `calculateVWAP` | `(prices[], volumes[], len)` | VWAP 计算 |
| `calculateSharpe` | `(returns[], len, riskFree)` | 夏普比率 |
| `calculateMaxDrawdown` | `(equity[], len)` | 最大回撤 |

### Qt6 WASM (完整 Qt Widgets → WASM)

`web/wasm/` 中提供了完整的 C++ Qt6 应用程序源码 (mainwindow.cpp 等 9 个文件)，编译为完整 Qt6 WASM 应用。由于需要从源码编译 Qt6 (~1 小时)，提供了一键脚本 `build_wasm.sh`。

## CTP macOS Apple Silicon 适配

CTP 6.7.11.4 的 macOS SDK 版本较旧 (缺少 9 个 API 函数)，已做以下适配：

- **头文件混合**: Linux `ThostFtdcUserApiStruct.h` + macOS `ThostFtdcTraderApi.h`
- **11 处 C++ 源码补丁**: 用 `#ifndef __APPLE__` 保护不支持的 API
- **meson.build 修复**: macOS 使用 `-framework` 链接方式
- 详细分析: [vnpy_ctp_analysis.html](vnpy_ctp_analysis.html)

## 架构总览

详细分析: [architecture.html](architecture.html)

## 许可证

MIT License — 原始 VeighNa 版权归 Xiaoyou Chen 所有。
