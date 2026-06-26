# VeighNa (vnpy) — 量化交易框架

基于 [VeighNa](https://github.com/vnpy/vnpy) v4.4.0 的量化交易平台，添加了 Web GUI 和 Apple Silicon 适配。

## 项目结构

```
vn.py/
├── vnpy/                    # VeighNa 核心框架
│   ├── vnpy/event/          # 事件驱动引擎
│   ├── vnpy/trader/         # 交易核心（引擎/网关/OMS/数据对象）
│   ├── vnpy/alpha/          # Alpha 研究平台（因子/模型/策略/回测）
│   ├── vnpy/rpc/            # ZeroMQ RPC 分布式服务
│   ├── vnpy/chart/          # K 线图表（Qt）
│   ├── web/                 # 🆕 Web GUI（FastAPI + WebSocket）
│   │   ├── server.py        #   后端服务
│   │   └── index.html       #   前端 SPA
│   ├── examples/            # 示例脚本
│   │   ├── mac_run.py       #   macOS GUI 启动脚本
│   │   └── ...
│   └── tests/               # 测试
├── vnpy_ctp/                # CTP 期货网关（macOS Apple Silicon 适配）
├── architecture.html        # 框架架构分析（HTML）
└── vnpy_ctp_analysis.html   # CTP 网关代码分析（HTML）
```

## 快速开始

### 环境要求

- Python >= 3.10
- macOS / Windows / Linux

### 安装

```bash
cd vnpy
python3.12 -m venv .venv
source .venv/bin/activate

# 安装核心框架
pip install -e ".[alpha,dev]"

# 安装 CTP 网关（macOS 需从本地源码编译）
pip install ../vnpy_ctp/

# 安装其他 App
pip install vnpy-ctastrategy vnpy-ctabacktester vnpy-datamanager vnpy-paperaccount
```

### 启动 GUI（桌面版）

```bash
source .venv/bin/activate
python examples/mac_run.py
```

### 启动 Web Trader 🆕

```bash
source .venv/bin/activate
python web/server.py
```

浏览器打开 **http://localhost:8888**

## Web Trader 功能

| 功能 | 说明 |
|------|------|
| 📈 Market Data | 实时行情 tick 推送（WebSocket） |
| 📋 Orders | 委托下单/撤单，状态实时更新 |
| 💰 Trades | 成交记录实时展示 |
| 📊 Positions | 持仓盈亏监控 |
| 🏦 Account | 账户资金查询 |
| 📜 Log | 引擎日志实时输出 |
| 🔌 Gateway | 网关连接管理（CTP 等） |

## CTP macOS 适配

CTP 6.7.11.4 的 macOS SDK 版本较旧，做了以下适配：

- **头文件混合**：Linux 结构体头文件 + macOS API 接口头文件
- **11 处 API 补丁**：用 `#ifndef __APPLE__` 保护 macOS 不支持的函数
- **Framework 链接**：改为 `-framework thostmduserapi_se`

详细分析见 [vnpy_ctp_analysis.html](vnpy_ctp_analysis.html)

## 架构总览

详细架构分析见 [architecture.html](architecture.html)

## 许可证

MIT License — 原始 VeighNa 版权归 Xiaoyou Chen 所有。
