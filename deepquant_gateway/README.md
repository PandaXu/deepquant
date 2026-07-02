# DeepQuant Gateway

独立交易网关微服务，管理 CTP/TTS 连接，推送实时行情和交易事件。

**端口：** :8889 (CTP), :8890 (TTS)，可通过 `gateways.toml` 配置多实例。

## 启动

```bash
PYTHONPATH="deepquant:deepquant_gateway:deepquant_ctp" \
  python deepquant_gateway/run.py --instance ctp-simnow

# 或启动 TTS 实例
python deepquant_gateway/run.py --instance tts-openctp
```

## API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/status` | GET | 网关状态 |
| `/connect` | POST | 连接 CTP/TTS |
| `/disconnect` | POST | 断开 |
| `/subscribe` | POST | 订阅行情 |
| `/send_order` | POST | 下单 |
| `/cancel_order` | POST | 撤单 |
| `/ws` | WS | 事件推送 |

## 配置

`gateways.toml` 定义多实例：

```toml
[[gateways]]
id = "ctp-simnow"       port = 8889  backend = "official"
id = "tts-openctp"      port = 8890  backend = "tts"
```
