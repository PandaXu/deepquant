#!/bin/bash
# Build TTS backend for deepquant_ctp
# Compiles pybind11 wrappers against TTS CTP-compatible headers and dylibs.
#
# Prerequisites:
#   pip install pybind11 meson ninja (in venv)
#   TTS 6.7.11 dylibs already downloaded to backends/tts/
#
# Usage:
#   bash build_tts.sh

set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

VENV_PYTHON="../.venv/bin/python"
VENV_MESON="../.venv/bin/meson"

if [ ! -f "$VENV_MESON" ]; then
    echo "Installing meson & ninja..."
    "$VENV_PYTHON" -m pip install meson ninja pybind11
fi

API_DIR="deepquant_ctp/api"
BACKEND_TTS="$API_DIR/backends/tts"
TTS_HEADERS="/tmp/tts_6.7.11"

# Download TTS 6.7.11 if not already done
if [ ! -f "$TTS_HEADERS/ThostFtdcMdApi.h" ]; then
    echo "Downloading TTS 6.7.11..."
    curl -L -o /tmp/tts_6.7.11.zip "http://www.openctp.cn/download/CTPAPI/TTS/tts_6.7.11.zip"
    unzip -o /tmp/tts_6.7.11.zip "tts_6.7.11/ThostFtdc*.h" "tts_6.7.11/mac64/*" -d /tmp/
fi

# Copy TTS dylibs to backend directory
cp "$TTS_HEADERS/mac64/thostmduserapi_se.dylib" "$BACKEND_TTS/"
cp "$TTS_HEADERS/mac64/thosttraderapi_se.dylib" "$BACKEND_TTS/"

# Create temporary meson build directory for TTS
TTS_BUILD="build_tts"
rm -rf "$TTS_BUILD"
mkdir -p "$TTS_BUILD"

echo "=== Setting up TTS build ==="

# Compile vnctpmd.cpp against TTS headers
PYBIND11_INCLUDE=$("$VENV_PYTHON" -c "import pybind11; print(pybind11.get_include())")
PYTHON_INCLUDE=$("$VENV_PYTHON" -c "import sysconfig; print(sysconfig.get_path('include'))")

CPP_FLAGS="-std=c++17 -O3 -mmacosx-version-min=10.12 -fPIC"
INCLUDE_FLAGS="-I$TTS_HEADERS -I$API_DIR/vnctp -I$PYBIND11_INCLUDE -I$PYTHON_INCLUDE"

echo "Compiling vnctpmd (TTS)..."
c++ $CPP_FLAGS $INCLUDE_FLAGS \
    -shared \
    -o "$BACKEND_TTS/vnctpmd.cpython-312-darwin.so" \
    "$API_DIR/vnctp/vnctpmd/vnctpmd.cpp" \
    -L"$BACKEND_TTS" -lthostmduserapi_se \
    -Wl,-rpath,@loader_path \
    -Wl,-install_name,@loader_path/libthostmduserapi_se.dylib

echo "Compiling vnctptd (TTS)..."
c++ $CPP_FLAGS $INCLUDE_FLAGS \
    -shared \
    -o "$BACKEND_TTS/vnctptd.cpython-312-darwin.so" \
    "$API_DIR/vnctp/vnctptd/vnctptd.cpp" \
    -L"$BACKEND_TTS" -lthosttraderapi_se \
    -Wl,-rpath,@loader_path \
    -Wl,-install_name,@loader_path/libthosttraderapi_se.dylib

# Re-sign
echo "Re-signing..."
codesign --remove-signature "$BACKEND_TTS/vnctpmd.cpython-312-darwin.so" 2>/dev/null || true
codesign --remove-signature "$BACKEND_TTS/vnctptd.cpython-312-darwin.so" 2>/dev/null || true
codesign -s - "$BACKEND_TTS/vnctpmd.cpython-312-darwin.so"
codesign -s - "$BACKEND_TTS/vnctptd.cpython-312-darwin.so"

echo ""
echo "=== TTS backend built ==="
ls -la "$BACKEND_TTS/"*.so "$BACKEND_TTS/"*.dylib
echo ""
echo "Test with:"
echo "  $VENV_PYTHON run_gateway.py --backend tts --account 5 --symbols rb2501.SHFE"
