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

- **Tick 表格**：始终可见，无数据时显示占位提示
- **K 线图**：默认加载主力合约日线，选择合约后自动切换
- **行情条**：水平滚动显示所有活跃 tick
- **深度图**：点击 tick 或选择合约后展示五档盘口
