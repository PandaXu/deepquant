cmake_minimum_required(VERSION 3.16)
project(VeighNaWasm VERSION 4.4.0 LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

set(QT_WASM_ROOT "$ENV{HOME}/qt6-wasm")
set(Qt6_DIR "${QT_WASM_ROOT}/lib/cmake/Qt6")
set(Qt6HostInfo_DIR "${QT_WASM_ROOT}/lib/cmake/Qt6HostInfo")
set(QT_BUILD_CMAKE_PREFIX_PATH "${QT_WASM_ROOT}")
set(QT_HOST_PATH "/opt/homebrew/Cellar/qtbase/6.11.1")

find_package(Qt6 REQUIRED COMPONENTS Widgets Core Gui)

qt_add_executable(veighna_wasm main_wasm.cpp)
target_include_directories(veighna_wasm PRIVATE
    ${Qt6Widgets_INCLUDE_DIRS}
    ${Qt6Gui_INCLUDE_DIRS}
    ${Qt6Core_INCLUDE_DIRS}
)
# MAIN_MODULE dynamic linking: symbols resolved at runtime from Qt .so files
target_link_options(veighna_wasm PRIVATE
    -sERROR_ON_UNDEFINED_SYMBOLS=0
    -sALLOW_MEMORY_GROWTH=1
    -sTOTAL_MEMORY=256MB
)
set_target_properties(veighna_wasm PROPERTIES
    OUTPUT_NAME veighna
    SUFFIX ".html"
)
