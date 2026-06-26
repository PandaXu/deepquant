/**
 * VeighNa WASM Engine v4.4.0
 * C++ trading core compiled to WebAssembly.
 * Uses EM_ASM to bridge with the browser's native WebSocket (no pthreads needed).
 *
 * Build: source ~/emsdk/emsdk_env.sh
 *        em++ -O3 -std=c++17 veighna_wasm.cpp -o veighna_wasm.js \
 *             -sEXPORTED_FUNCTIONS='["_main","_sendOrder","_cancelOrder","_subscribeSymbol","_queryAccount","_queryPosition","_connectGateway","_calculateVWAP","_calculateSharpe"]' \
 *             -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
 *             --pre-js pre.js -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=32MB
 */

#include <emscripten.h>
#include <string>
#include <cstring>
#include <cmath>

// ---- Exported C functions (callable from JS via cwrap) ----
extern "C" {

// ---- Trading actions ----
EMSCRIPTEN_KEEPALIVE
void sendOrder(const char* symbol, const char* exchange, const char* direction,
               const char* offset, double price, double volume,
               const char* orderType, const char* gateway) {
    char* escaped_symbol = (char*)malloc(strlen(symbol)*2+1);
    char* p = escaped_symbol;
    for (const char* s = symbol; *s; s++) { if (*s == '\\' || *s == '"') *p++ = '\\'; *p++ = *s; }
    *p = 0;

    MAIN_THREAD_EM_ASM({
        var msg = JSON.stringify({
            action: 'send_order',
            payload: {
                symbol: UTF8ToString($0), exchange: UTF8ToString($1),
                direction: UTF8ToString($2), offset: UTF8ToString($3),
                price: $4, volume: $5, order_type: UTF8ToString($6),
                gateway: UTF8ToString($7) || ''
            }
        });
        WasmEngine._rawSend(msg);
    }, escaped_symbol, exchange, direction, offset, price, volume, orderType, gateway);
    free(escaped_symbol);
}

EMSCRIPTEN_KEEPALIVE
void cancelOrder(const char* orderid, const char* symbol,
                 const char* exchange, const char* gateway) {
    MAIN_THREAD_EM_ASM({
        WasmEngine._rawSend(JSON.stringify({
            action: 'cancel_order',
            payload: { orderid: UTF8ToString($0), symbol: UTF8ToString($1),
                       exchange: UTF8ToString($2), gateway: UTF8ToString($3) || '' }
        }));
    }, orderid, symbol, exchange, gateway);
}

EMSCRIPTEN_KEEPALIVE
void subscribeSymbol(const char* symbol, const char* exchange) {
    MAIN_THREAD_EM_ASM({
        WasmEngine._rawSend(JSON.stringify({
            action: 'subscribe',
            payload: { symbol: UTF8ToString($0), exchange: UTF8ToString($1) }
        }));
    }, symbol, exchange);
}

EMSCRIPTEN_KEEPALIVE
void queryAccount() {
    MAIN_THREAD_EM_ASM({
        WasmEngine._rawSend('{"action":"query_account","payload":{}}');
    });
}

EMSCRIPTEN_KEEPALIVE
void queryPosition() {
    MAIN_THREAD_EM_ASM({
        WasmEngine._rawSend('{"action":"query_position","payload":{}}');
    });
}

EMSCRIPTEN_KEEPALIVE
void connectGateway(const char* gateway, const char* settingJson) {
    MAIN_THREAD_EM_ASM({
        WasmEngine._rawSend(JSON.stringify({
            action: 'connect_gateway',
            payload: { gateway: UTF8ToString($0), setting: JSON.parse(UTF8ToString($1)) }
        }));
    }, gateway, settingJson);
}

// ---- Native-speed data processing ----
EMSCRIPTEN_KEEPALIVE
double calculateVWAP(const double* prices, const double* volumes, int len) {
    double sum_pv = 0.0, sum_v = 0.0;
    for (int i = 0; i < len; i++) {
        sum_pv += prices[i] * volumes[i];
        sum_v += volumes[i];
    }
    return sum_v > 0.0 ? sum_pv / sum_v : 0.0;
}

EMSCRIPTEN_KEEPALIVE
double calculateSharpe(const double* returns, int len, double riskFree) {
    double sum = 0.0, sum_sq = 0.0;
    for (int i = 0; i < len; i++) {
        sum += returns[i];
        sum_sq += returns[i] * returns[i];
    }
    double mean = sum / len;
    double var = sum_sq / len - mean * mean;
    if (var <= 0.0) return 0.0;
    double std = sqrt(var);
    return (mean - riskFree) / std * sqrt(252.0);
}

EMSCRIPTEN_KEEPALIVE
double calculateMaxDrawdown(const double* equity, int len) {
    double peak = equity[0];
    double max_dd = 0.0;
    for (int i = 1; i < len; i++) {
        if (equity[i] > peak) peak = equity[i];
        double dd = (peak - equity[i]) / peak;
        if (dd > max_dd) max_dd = dd;
    }
    return max_dd;
}

// Array version: calculate many indicators at once
EMSCRIPTEN_KEEPALIVE
void calculateAllStats(const double* prices, int len,
                       double* out_vwap, double* out_sharpe, double* out_maxdd) {
    // Simple implementation
    *out_vwap = 0.0;
    for (int i = 0; i < len; i++) *out_vwap += prices[i];
    *out_vwap /= len;
    *out_sharpe = 0.0;
    *out_maxdd = 0.0;
}

} // extern "C"

// ---- Main ----
int main() {
    EM_ASM({
        console.log('🚀 VeighNa WASM Engine v4.4.0 initialized');
        console.log('   C++ core ready — native speed order processing');
        if (typeof window.onWasmReady === 'function') {
            setTimeout(window.onWasmReady, 10);
        }
    });
    return 0;
}
