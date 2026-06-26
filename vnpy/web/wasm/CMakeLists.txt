cmake_minimum_required(VERSION 3.16)
project(VeighNaWasm VERSION 4.4.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)

set(QT_WASM_ROOT "$ENV{HOME}/qt6-wasm")

# Manually set Qt6 paths
set(Qt6_DIR "${QT_WASM_ROOT}/lib/cmake/Qt6")
set(Qt6HostInfo_DIR "${QT_WASM_ROOT}/lib/cmake/Qt6HostInfo")
set(QT_BUILD_CMAKE_PREFIX_PATH "${QT_WASM_ROOT}")
set(QT_HOST_PATH "/opt/homebrew/Cellar/qtbase/6.11.1")

# Suppress private module warnings
set(QT_FIND_PRIVATE_MODULES FALSE)

find_package(Qt6 REQUIRED COMPONENTS Widgets Core Gui)

add_executable(veighna_wasm main_wasm.cpp)
target_link_libraries(veighna_wasm PRIVATE Qt6::Widgets Qt6::Gui Qt6::Core)
target_link_options(veighna_wasm PRIVATE
    -sALLOW_MEMORY_GROWTH=1
    -sTOTAL_MEMORY=128MB
    -lembind
    "SHELL:-sEXPORTED_FUNCTIONS=['_main']"
    "SHELL:-sEXPORTED_RUNTIME_METHODS=['ccall','cwrap']"
)
set_target_properties(veighna_wasm PROPERTIES
    OUTPUT_NAME veighna
    SUFFIX ".html"
)
