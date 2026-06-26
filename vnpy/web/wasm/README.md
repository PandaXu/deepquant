# VeighNa Qt6 WebAssembly

将 VeighNa Trader Qt 桌面 GUI 编译为 WebAssembly，在浏览器中运行原生 Qt 界面。

## 架构

```
浏览器                                              Python 后端
┌──────────────────────────┐         WebSocket      ┌──────────────┐
│ Qt6 WASM 应用             │ ←───────────────────── │ FastAPI       │
│                           │   JSON {type, data}    │ EventEngine   │
│ ┌───────────────────────┐ │                        │ MainEngine    │
│ │ MainWindow            │ │                        │ CTP Gateway   │
│ │ ├─ TradingWidget      │ │                        │ PaperAccount  │
│ │ │  └─ 5档盘口         │ │                        │ ...           │
│ │ ├─ TickMonitor        │ │                        └──────────────┘
│ │ ├─ OrderMonitor       │ │
│ │ ├─ TradeMonitor       │ │
│ │ ├─ PositionMonitor    │ │
│ │ ├─ AccountMonitor     │ │
│ │ └─ LogMonitor         │ │
│ └───────────────────────┘ │
└──────────────────────────┘
```

## 构建

```bash
# 一键构建（安装 Emscripten + Qt6 WASM + 编译）
cd web/wasm
bash build_wasm.sh
```

### 手动构建步骤

1. **安装 Emscripten SDK**
```bash
git clone --depth 1 https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

2. **编译 Qt6 for WASM**（约 1 小时，仅首次）
```bash
# Qt 官方安装器也提供预编译的 Qt6 WASM 包（推荐）
# 或从源码编译：
git clone https://code.qt.io/qt/qt5.git qt6
cd qt6 && git checkout 6.6.0
./configure -xplatform wasm-emscripten -feature-thread -prefix ~/qt6-wasm
cmake --build . --parallel
```

3. **编译 VeighNa WASM**
```bash
source ~/emsdk/emsdk_env.sh
mkdir build && cd build
~/qt6-wasm/bin/qt-cmake ..
cmake --build . --parallel
```

## 运行

```bash
# 终端 1: Python 后端
python ../server.py

# 终端 2: 提供 WASM 文件
python ../wasm-dist/server.py

# 浏览器打开 http://localhost:8889
```

## 源码文件

| 文件 | 说明 |
|------|------|
| `main.cpp` | 入口，创建 QApplication + MainWindow |
| `mainwindow.h/cpp` | 主窗口：Dock 布局、菜单栏、状态栏、所有 Widget |
| `websocketclient.h/cpp` | WebSocket 客户端，连接 Python 后端 |
| `datamodels.h` | 列定义、颜色常量、数据行工具 |
| `CMakeLists.txt` | 桌面/WASM 双目标构建配置 |

## 与桌面 Qt 版本的对应关系

`mainwindow.cpp` 中的每个 Widget、每个列、每个颜色都严格对应 `vnpy/trader/ui/mainwindow.py` + `widget.py` 的实现。
