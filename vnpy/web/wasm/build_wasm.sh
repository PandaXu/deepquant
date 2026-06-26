#!/bin/bash
# Build VeighNa Qt6 WebAssembly — one-click script
# Prerequisites: Node.js, Python 3.10+
set -e

WASM_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$(dirname "$WASM_DIR")"
BUILD_DIR="$WASM_DIR/build"
DIST_DIR="$WEB_DIR/wasm-dist"
QT_WASM_DIR="$HOME/qt6-wasm"

echo "============================================"
echo "  VeighNa Qt6 WebAssembly Builder"
echo "============================================"
echo ""

# ---- Step 1: Install Emscripten ----
if ! command -v emcc &>/dev/null; then
    echo "[1/5] Installing Emscripten SDK..."
    cd ~
    if [ ! -d emsdk ]; then
        git clone --depth 1 https://github.com/emscripten-core/emsdk.git
    fi
    cd emsdk
    ./emsdk install latest
    ./emsdk activate latest
    source ./emsdk_env.sh
    echo "  ✅ Emscripten installed"
else
    echo "[1/5] ✅ Emscripten already installed: $(emcc --version | head -1)"
fi

# ---- Step 2: Install CMake ----
if ! command -v cmake &>/dev/null; then
    echo "[2/5] Installing CMake..."
    if command -v brew &>/dev/null; then
        brew install cmake
    elif command -v pip3 &>/dev/null; then
        pip3 install cmake
    else
        echo "Please install cmake manually: https://cmake.org/download/"
        exit 1
    fi
    echo "  ✅ CMake installed"
else
    echo "[2/5] ✅ CMake already installed: $(cmake --version | head -1)"
fi

# ---- Step 3: Install Qt6 for WASM ----
if [ ! -f "$QT_WASM_DIR/lib/libQt6Widgets.a" ]; then
    echo "[3/5] Installing Qt6 for WebAssembly (this takes ~1 hour)..."
    mkdir -p "$QT_WASM_DIR" && cd "$QT_WASM_DIR"

    # Download Qt6 source
    QT_VERSION="6.6.0"
    if [ ! -f "qtbase-everywhere-src-${QT_VERSION}.tar.xz" ]; then
        curl -LO "https://download.qt.io/official_releases/qt/6.6/${QT_VERSION}/submodules/qtbase-everywhere-src-${QT_VERSION}.tar.xz"
        tar xf "qtbase-everywhere-src-${QT_VERSION}.tar.xz"
    fi
    if [ ! -f "qtwebsockets-everywhere-src-${QT_VERSION}.tar.xz" ]; then
        curl -LO "https://download.qt.io/official_releases/qt/6.6/${QT_VERSION}/submodules/qtwebsockets-everywhere-src-${QT_VERSION}.tar.xz"
        tar xf "qtwebsockets-everywhere-src-${QT_VERSION}.tar.xz"
    fi

    source ~/emsdk/emsdk_env.sh

    # Configure and build QtBase for WASM
    cd "qtbase-everywhere-src-${QT_VERSION}"
    ./configure -xplatform wasm-emscripten -feature-thread -nomake examples -nomake tests \
        -prefix "$QT_WASM_DIR" -no-opengl -no-dbus -no-icu -no-fontconfig
    cmake --build . --parallel $(sysctl -n hw.ncpu)
    cmake --install .

    # Build QtWebSockets for WASM
    cd "../qtwebsockets-everywhere-src-${QT_VERSION}"
    "$QT_WASM_DIR/bin/qt-cmake" .
    cmake --build . --parallel $(sysctl -n hw.ncpu)
    cmake --install .

    echo "  ✅ Qt6 WASM built"
else
    echo "[3/5] ✅ Qt6 WASM already built at $QT_WASM_DIR"
fi

# ---- Step 4: Build VeighNa WASM app ----
echo "[4/5] Building VeighNa WASM application..."
source ~/emsdk/emsdk_env.sh
export Qt6_DIR="$QT_WASM_DIR/lib/cmake/Qt6"

mkdir -p "$BUILD_DIR" && cd "$BUILD_DIR"
"$QT_WASM_DIR/bin/qt-cmake" "$WASM_DIR/CMakeLists.txt" -DCMAKE_BUILD_TYPE=Release
cmake --build . --parallel $(sysctl -n hw.ncpu)

echo "  ✅ WASM app built"

# ---- Step 5: Deploy ----
echo "[5/5] Deploying..."
mkdir -p "$DIST_DIR"
cp "$BUILD_DIR/veighna.js" "$DIST_DIR/"
cp "$BUILD_DIR/veighna.wasm" "$DIST_DIR/"
cp "$BUILD_DIR/veighna.html" "$DIST_DIR/index.html"

# Also copy Qt WASM runtime support files
if [ -f "$QT_WASM_DIR/plugins/platforms/libqwasm.a" ]; then
    cp "$QT_WASM_DIR/plugins/platforms/libqwasm.a" "$DIST_DIR/" 2>/dev/null || true
fi

# Use the Python server to serve the WASM files
cat > "$DIST_DIR/server.py" <<'PYEOF'
import http.server
import socketserver
import os

PORT = 8889
os.chdir(os.path.dirname(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.dirname(__file__), **kwargs)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Access-Control-Allow-Origin', '*')
        super().end_headers()

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"🚀 VeighNa WASM at http://localhost:{PORT}")
    print(f"   (Python backend must be running on port 8888)")
    httpd.serve_forever()
PYEOF

echo ""
echo "============================================"
echo "  ✅ Build complete!"
echo ""
echo "  Start:"
echo "    Terminal 1: python web/server.py         (backend)"
echo "    Terminal 2: python web/wasm-dist/server.py  (WASM frontend)"
echo "    Browser:    http://localhost:8889"
echo "============================================"
