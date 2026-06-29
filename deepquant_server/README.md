# VeighNa Web Trader

基于 FastAPI 的 VeighNa Web 交易界面，提供与桌面客户端一致的交易功能。

## 安装

```bash
cd vnpy_web
pip install -e .
```

安装可选依赖（CTA 策略、回测等）：

```bash
pip install -e ".[all]"
# 或者按需安装：
pip install -e ".[cta,backtester,datamanager]"
```

## 启动

```bash
python run.py                    # 默认 0.0.0.0:8888
python run.py --port 9999        # 自定义端口
python run.py --host 127.0.0.1   # 仅本地访问
```

或者直接启动 server 模块：

```bash
python -m vnpy_web.server
```

## 访问

打开浏览器访问 `http://localhost:8888`

## API 接口

| 端点 | 说明 |
|------|------|
| `GET /` | 主交易界面 |
| `GET /app` | 应用页面（策略管理、回测等） |
| `GET /api/status` | 引擎状态 |
| `GET /api/gateways` | 可用网关列表 |
| `GET /api/apps` | 已注册的应用 |
| `GET /api/contracts` | 合约查询 |
| `GET /api/settings` | 系统设置 |
| `POST /api/settings` | 保存设置 |
| `GET /api/data` | 缓存数据（tick/order/trade/position） |
| `GET /api/about` | 版本信息 |
| `GET /api/contracts/public` | 公开合约数据 |
| `GET /api/contracts/products` | 交易所品种列表 |
| `WS /ws` | WebSocket 实时数据推送 |

## 可选依赖

| 分组 | 包名 | 功能 |
|------|------|------|
| ctp | vnpy_ctp | CTP 期货网关 |
| paper | vnpy_paperaccount | 模拟交易 |
| cta | vnpy_ctastrategy | CTA 策略引擎 |
| backtester | vnpy_ctabacktester | CTA 回测引擎 |
| datamanager | vnpy_datamanager | 历史数据管理 |

## 与桌面版的区别

- 基于浏览器，无需安装 Qt 桌面环境
- 不包含图表可视化（K线图等）
- 不包含部分高级应用（价差交易、算法交易、期权管理等）
- 所有功能通过 REST API + WebSocket 提供
