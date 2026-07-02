# DeepQuant CTP

纯协议层，提供 CTP/TTS C++ 原生库绑定。

不包含网关业务逻辑（网关逻辑已移至 `deepquant_gateway`）。

## 后端

| 后端 | 目录 | 说明 |
|------|------|------|
| official | `api/backends/official/` | CTP 6.7.11 官方库 |
| tts | `api/backends/tts/` | TTS 兼容库 (OpenCTP) |

## 使用

```python
from deepquant_ctp.api import load_backend, MdApi, TdApi

# 加载 TTS 后端
be = load_backend("tts")
```
