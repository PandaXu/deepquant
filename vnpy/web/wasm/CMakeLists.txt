cmake_minimum_required(VERSION 3.16)
project(VeighNaWasm VERSION 4.4.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)
set(CMAKE_AUTOUIC ON)

# Find Qt6
find_package(Qt6 REQUIRED COMPONENTS
    Widgets
    WebSockets
    Network
    Core
)

# Source files
set(SOURCES
    main.cpp
    mainwindow.cpp
    mainwindow.h
    websocketclient.cpp
    websocketclient.h
    datamodels.h
)

# Create executable
if(EMSCRIPTEN)
    # WASM build: produces .html + .js + .wasm
    add_executable(veighna_wasm ${SOURCES})
    set_target_properties(veighna_wasm PROPERTIES
        OUTPUT_NAME veighna
        SUFFIX ".html"
    )
    target_link_libraries(veighna_wasm PRIVATE
        Qt6::Widgets
        Qt6::WebSockets
        Qt6::Network
    )
    # Qt6 WASM-specific: asyncify for WebSocket, enable threads
    target_link_options(veighna_wasm PRIVATE
        -sASYNCIFY
        -sALLOW_MEMORY_GROWTH=1
        -sTOTAL_MEMORY=128MB
        -sUSE_QT6_HTTP=ON
    )
    # Copy to web directory
    install(TARGETS veighna_wasm DESTINATION ${CMAKE_SOURCE_DIR}/../wasm-dist)
    install(FILES
        qtloader.js
        qtlogo.svg
        DESTINATION ${CMAKE_SOURCE_DIR}/../wasm-dist
    )
else()
    # Desktop build for testing
    add_executable(veighna_desktop ${SOURCES})
    target_link_libraries(veighna_desktop PRIVATE
        Qt6::Widgets
        Qt6::WebSockets
        Qt6::Network
    )
endif()
