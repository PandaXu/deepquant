# DeepQuant Web

量化交易前端，Vue3 + ECharts SPA。连接 Server 获取实时行情和交易功能。

**端口：** :8080

## 启动

```bash
python deepquant_web/run.py
```

## 页面结构

| Tab | 功能 |
|-----|------|
| 行情交易 | K线图、深度盘口、Tick表格、下单、持仓、订单 |
| 数据管理 | 合约查询、历史数据下载 |
| 策略 | CTA 策略管理、回测 |
| 日志 | 实时日志 |
| 设置 | 网关连接、账户管理、全局配置 |

## 数据流

```
Gateway WS → Server WS → Web WS → store.tick → Vue reactive → UI
```

## API / WS 契约（与 deepquant_server 对齐）

| 用途 | 方式 | 说明 |
|------|------|------|
| 实时事件 | WS `/ws` | tick/order/trade/position/account/log、backtestResult |
| 下单/撤单/订阅 | REST | `POST /api/orders`、`DELETE /api/orders/{id}`、`POST /api/subscribe` |
| 账户 CRUD | REST | `GET/POST /api/gateway-accounts`、`DELETE /api/gateway-accounts/{id}` |
| K 线 | REST | `GET /api/bars` → `{ bars: [{ datetime, open, high, low, close, volume }] }` |
| CTA 策略 | WS action | `get_cta_*`、`add_cta_strategy`、`edit_cta_strategy`、`cta_strategy_*` |
| 回测 | WS action | `get_backtest_classes`、`start_backtesting` |
| 子应用 | — | 已合并入主 Tab（策略/数据管理），不再单独 apps 页面 |

- **Tick 表格**：始终可见，无数据时显示占位提示
- **K 线图**：默认加载主力合约日线，选择合约后自动切换
- **行情条**：水平滚动显示所有活跃 tick
- **深度图**：点击 tick 或选择合约后展示五档盘口
