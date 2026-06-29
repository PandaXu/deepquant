# Gateway 微服务隔离

**日期:** 2026-06-30  
**目标:** Server 与 Gateway 拆分为独立进程，通过 HTTP + WS 通信，消除代码级耦合

## 架构

```
Web :8080 ←→ Server :8888 ←→ Gateway :8889 ←→ CTP/TTS
```

- Web ↔ Server：WS（不变）
- Server ↔ Gateway：REST（控制面：connect/disconnect/subscribe）+ WS（数据面：tick/order/trade/position/account/log）
- Gateway ↔ CTP/TTS：原生 C++ 库（不变）

## 组件

### deepquant_gateway（新建）
- 独立 FastAPI 进程，端口 8889
- 拥有完整 MainEngine + EventEngine 实例
- REST API：
  - `POST /connect` — 连接交易网关（body: {gateway_type, setting}）
  - `POST /disconnect` — 断开网关
  - `POST /subscribe` — 订阅行情（body: {symbol, exchange, gateway}）
  - `GET /status` — 引擎状态（gateways, exchanges, tick_count 等）
- WS `/ws`：向 Server 推送所有事件（格式同现有 event bridge）

### deepquant_server（修改）
- 删除所有 `from .gateway import CtpGateway` 等直接引用
- 启动时建立到 Gateway 的 WS 客户端连接
- 新增 `GatewayClient` 模块：
  - 管理到 Gateway 的 WS 连接（自动重连）
  - 提供 `request(action, payload)` 方法调用 Gateway REST API
  - 接收 Gateway WS 事件 → 写入 main_engine.event_engine → 现有 bridge_event 推送给 Web
- connect_account/subscribe 改为 HTTP 调用 Gateway
- `/api/status` 合并 Gateway 状态

## 数据流

1. 用户点"连接"→ Web WS → Server → `POST http://gateway:8889/connect` → Gateway 建立 CTP 连接
2. Gateway CTP 收到 tick → Gateway 内部 event_engine → Gateway WS → Server GatewayClient → Server event_engine → bridge_event → Web WS → 前端渲染

## 关键约束

- Gateway 服务完全独立，可单独部署、重启
- Server 启动时 Gateway 不可用不阻塞 Server（延迟连接）
- Gateway WS 断线自动重连，重连后重新推送状态
- 现有 Web 前端代码零改动
