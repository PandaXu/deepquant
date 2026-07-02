# DeepQuant DataRecorder

行情数据录制器，监听 Gateway WS 事件流，将 tick/bar 数据持久化到数据库。

## 模块

| 模块 | 说明 |
|------|------|
| `engine.py` | RecorderEngine — tick/bar 录制引擎 |
| `ui/widget.py` | Qt 桌面配置界面 |
