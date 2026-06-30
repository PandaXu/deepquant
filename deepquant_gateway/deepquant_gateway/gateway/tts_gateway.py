"""
TTS Gateway — Tick Trading System (CTP-compatible simulation).

TTS uses the same CTP protocol but connects to different servers
(OpenCTP, SimNow, etc.). When TTS-specific C++ bindings become
available, replace the CtpGateway base with the TTS-specific class.
"""
# Currently TTS and CTP share the same C++ bindings (CTP protocol compatible).
# When vnpy_tts or equivalent TTS-specific C++ bindings are installed,
# import from that package instead.
try:
    # Future: from vnpy_tts import TtsGateway as _Base
    from .ctp_gateway import CtpGateway as _Base
except ImportError:
    _Base = None

if _Base is not None:

    class TtsGateway(_Base):
        """TTS gateway — defaults tuned for simulation/test environments."""

        default_name: str = "TTS"

        default_setting: dict = {
            "用户名": "",
            "密码": "",
            "经纪商代码": "",
            "交易服务器": "tcp://trading.openctp.cn:30001",
            "行情服务器": "tcp://trading.openctp.cn:30011",
            "产品名称": "",
            "授权编码": "",
            "柜台环境": ["测试"]  # TTS is typically test/simulation only
        }

else:
    TtsGateway = None
