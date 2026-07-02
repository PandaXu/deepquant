# DeepQuant DataRecorder

独立行情录制服务，直接连接 Gateway WS 接收 tick 事件，批量持久化到数据库。

**端口：** :8900

## 架构

```
Gateway (:8889) ──WS──► DataRecorder (:8900)
                              │
                    ┌─────────┼─────────┐
                    │         │         │
                 TickBuffer  BarGen   Writer
                    │         │         │
                    └─────────┴────┬────┘
                                   ▼
                               SQLite DB
```

**零依赖：** 不依赖 MainEngine、EventEngine，只需 Gateway 的 WS 地址。

## 启动

```bash
PYTHONPATH="deepquant:deepquant_datarecorder" \
  python deepquant_datarecorder/run.py --gateway http://127.0.0.1:8889
```

## 配置

```toml
# config.toml
gateway_url = "http://127.0.0.1:8889"
db_path = "~/.vntrader/database.db"
batch_interval = 10    # 批量写入间隔(秒)
batch_size = 200       # 批量写入条数
```

## 模块

| 文件 | 说明 |
|------|------|
| `run.py` | 入口 |
| `gateway_ws.py` | Gateway WS 客户端，接收 tick 事件 |
| `buffer.py` | TickBuffer — 按合约缓存，批量刷盘 |
| `writer.py` | DatabaseWriter — SQLite 批量写入 |
