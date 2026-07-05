# DeepQuant Server

API 网关，通过 GatewayClient (HTTP+WS) 连接 Gateway 微服务。提供 REST API 和 WebSocket 给前端。

**端口：** :8888

## 启动

```bash
PYTHONPATH="deepquant:deepquant_server:deepquant_ctp:deepquant_datamanager:deepquant_ctabacktester" \
  python deepquant_server/run.py
```

或使用 `./start.sh`（已配置完整 PYTHONPATH）。

## 可选依赖

```bash
pip install -e deepquant_ctabacktester   # CTA 回测（Web 策略 Tab）
pip install -e deepquant_datamanager     # 数据管理
pip install vnpy_ctastrategy             # CTA 实盘
```

`pyproject.toml` 中 `backtester = ["deepquant_ctabacktester"]`。

## API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 服务状态 |
| `/api/gateways` | GET | 可用网关列表 |
| `/api/gateway-accounts` | GET/POST | 账户管理 |
| `/api/gateway-accounts/{id}/connect` | POST | 连接账户 |
| `/api/orders` | POST | 下单 |
| `/api/orders/{id}` | DELETE | 撤单 |
| `/api/subscribe` | POST | 订阅行情 |
| `/api/bars` | GET | 历史K线 |
| `/api/contracts/products` | GET | 品种列表 |
| `/ws` | WS | 实时事件推送 |
