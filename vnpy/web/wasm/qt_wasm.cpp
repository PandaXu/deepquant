/**
 * VeighNa Qt-Style WASM — renders Qt-like widgets using SDL2
 * Compiles to WebAssembly, draws directly to HTML5 Canvas.
 *
 * Renders QMainWindow with Dock layout, QTableWidget monitors,
 * QComboBox, QLineEdit, QPushButton, QLabel — all drawn pixel-perfect.
 *
 * Build:
 *   source ~/emsdk/emsdk_env.sh
 *   em++ -O3 -std=c++17 qt_wasm.cpp -o qt_wasm.js \
 *        -sUSE_SDL=2 -sUSE_WEBGL2=1 \
 *        -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=64MB \
 *        -sEXPORTED_FUNCTIONS='["_main"]' \
 *        -sEXPORTED_RUNTIME_METHODS='["ccall","cwrap"]' \
 *        -sFULL_ES3=1 --pre-js pre_qt.js
 *
 * Layout (exact Qt MainWindow replication):
 * ┌─────────────────────────────────────────────────┐
 * │ Menu: 系统 功能 帮助                     Clock   │
 * ├──────────┬──────────────────┬───────────────────┤
 * │ TRADING  │ TICK MONITOR     │ ORDER/ACTIVE      │
 * │ FORM     │ (scroll table)   │ (scroll table)    │
 * │          │                  │                   │
 * │ exchange │                  │                   │
 * │ symbol   │                  │                   │
 * │ name     │                  │                   │
 * │ dir off  │                  │                   │
 * │ type     │                  ├───────────────────┤
 * │ price ☐  │                  │                   │
 * │ volume   ├──────────────────┼───────────────────┤
 * │ gateway  │ TRADE MONITOR    │ LOG MONITOR       │
 * │ [B][S]   │ (scroll table)   │ (scroll text)     │
 * │ [全撤]   ├──────────────────┼───────────────────┤
 * │          │ ACCOUNT/POSITION │                   │
 * │ 5-level  │ (tabbed table)   │                   │
 * │ depth    │                  │                   │
 * └──────────┴──────────────────┴───────────────────┘
 */

#include <SDL2/SDL.h>
#include <emscripten.h>
#include <emscripten/html5.h>
#include <string>
#include <vector>
#include <map>
#include <functional>
#include <cstring>
#include <cmath>
#include <cstdio>

// ====== Qt-exact colors ======
static const SDL_Color C_BG       = {0x1e,0x1e,0x1e,255};
static const SDL_Color C_SURFACE  = {0x2d,0x2d,0x2d,255};
static const SDL_Color C_HEADER   = {0x33,0x33,0x33,255};
static const SDL_Color C_BORDER   = {0x3c,0x3c,0x3c,255};
static const SDL_Color C_TEXT     = {0xd4,0xd4,0xd4,255};
static const SDL_Color C_DIM      = {0x80,0x80,0x80,255};
static const SDL_Color C_BID      = {0xff,0xae,0xc9,255};
static const SDL_Color C_ASK      = {0xa0,0xff,0xa0,255};
static const SDL_Color C_LONG     = {0xff,0x44,0x44,255};
static const SDL_Color C_SHORT    = {0x00,0xaa,0x00,255};
static const SDL_Color C_ACCENT   = {0x00,0x7a,0xcc,255};
static const SDL_Color C_BTN_BUY  = {0xc4,0x2b,0x1c,255};
static const SDL_Color C_BTN_SELL = {0x0b,0x60,0x16,255};
static const SDL_Color C_FOCUS    = {0x09,0x4e,0x91,255};
static const SDL_Color C_WHITE    = {255,255,255,255};

// ====== Rectangle helpers ======
struct Rect { int x,y,w,h; };
bool pointInRect(int px, int py, const Rect& r) {
    return px>=r.x && px<r.x+r.w && py>=r.y && py<r.y+r.h;
}

// ====== Font rendering (simple bitmap) ======
static const int FONT_W = 6, FONT_H = 10;
// Minimal 5x7 font bitmap (printable ASCII 32-126)
// Each char: 5 bytes (columns), each byte = 7 pixel rows
static const unsigned char FONT_DATA[][5] = {
    {0x00,0x00,0x00,0x00,0x00}, // space
    {0x00,0x00,0x5f,0x00,0x00}, // !
    {0x00,0x07,0x00,0x07,0x00}, // "
    {0x14,0x7f,0x14,0x7f,0x14}, // #
    {0x24,0x2a,0x7f,0x2a,0x12}, // $
    {0x23,0x13,0x08,0x64,0x62}, // %
    {0x36,0x49,0x55,0x22,0x50}, // &
    {0x00,0x05,0x03,0x00,0x00}, // '
    {0x00,0x1c,0x22,0x41,0x00}, // (
    {0x00,0x41,0x22,0x1c,0x00}, // )
    {0x08,0x2a,0x1c,0x2a,0x08}, // *
    {0x08,0x08,0x3e,0x08,0x08}, // +
    {0x00,0x50,0x30,0x00,0x00}, // ,
    {0x08,0x08,0x08,0x08,0x08}, // -
    {0x00,0x60,0x60,0x00,0x00}, // .
    {0x20,0x10,0x08,0x04,0x02}, // /
    // 0-9
    {0x3e,0x51,0x49,0x45,0x3e}, // 0
    {0x00,0x42,0x7f,0x40,0x00}, // 1
    {0x42,0x61,0x51,0x49,0x46}, // 2
    {0x21,0x41,0x45,0x4b,0x31}, // 3
    {0x18,0x14,0x12,0x7f,0x10}, // 4
    {0x27,0x45,0x45,0x45,0x39}, // 5
    {0x3c,0x4a,0x49,0x49,0x30}, // 6
    {0x01,0x71,0x09,0x05,0x03}, // 7
    {0x36,0x49,0x49,0x49,0x36}, // 8
    {0x06,0x49,0x49,0x29,0x1e}, // 9
    // : ; < = > ? @
    {0x00,0x36,0x36,0x00,0x00},{0x00,0x56,0x36,0x00,0x00},{0x00,0x08,0x14,0x22,0x41},
    {0x14,0x14,0x14,0x14,0x14},{0x41,0x22,0x14,0x08,0x00},{0x02,0x01,0x51,0x09,0x06},
    {0x32,0x49,0x79,0x41,0x3e},
    // A-Z
    {0x7e,0x11,0x11,0x11,0x7e},{0x7f,0x49,0x49,0x49,0x36},{0x3e,0x41,0x41,0x41,0x22},
    {0x7f,0x41,0x41,0x22,0x1c},{0x7f,0x49,0x49,0x49,0x41},{0x7f,0x09,0x09,0x01,0x01},
    {0x3e,0x41,0x41,0x51,0x32},{0x7f,0x08,0x08,0x08,0x7f},{0x00,0x41,0x7f,0x41,0x00},
    {0x20,0x40,0x41,0x3f,0x01},{0x7f,0x08,0x14,0x22,0x41},{0x7f,0x40,0x40,0x40,0x40},
    {0x7f,0x02,0x04,0x02,0x7f},{0x7f,0x04,0x08,0x10,0x7f},{0x3e,0x41,0x41,0x41,0x3e},
    {0x7f,0x09,0x09,0x09,0x06},{0x3e,0x41,0x51,0x21,0x5e},{0x7f,0x09,0x19,0x29,0x46},
    {0x46,0x49,0x49,0x49,0x31},{0x01,0x01,0x7f,0x01,0x01},{0x3f,0x40,0x40,0x40,0x3f},
    {0x1f,0x20,0x40,0x20,0x1f},{0x7f,0x20,0x18,0x20,0x7f},{0x63,0x14,0x08,0x14,0x63},
    {0x03,0x04,0x78,0x04,0x03},{0x61,0x51,0x49,0x45,0x43},
    // [ \ ] ^ _ `
    {0x00,0x7f,0x41,0x41,0x00},{0x02,0x04,0x08,0x10,0x20},{0x41,0x22,0x14,0x08,0x00},
    {0x00,0x41,0x22,0x14,0x08},{0x02,0x01,0x51,0x09,0x06},{0x40,0x30,0x00,0x00,0x00},
    // a-z
    {0x20,0x54,0x54,0x54,0x78},{0x7f,0x48,0x44,0x44,0x38},{0x38,0x44,0x44,0x44,0x20},
    {0x38,0x44,0x44,0x48,0x7f},{0x38,0x54,0x54,0x54,0x18},{0x08,0x7e,0x09,0x01,0x02},
    {0x08,0x14,0x54,0x54,0x3c},{0x7f,0x08,0x04,0x04,0x78},{0x00,0x44,0x7d,0x40,0x00},
    {0x20,0x40,0x44,0x3d,0x00},{0x00,0x7f,0x10,0x28,0x44},{0x00,0x41,0x7f,0x40,0x00},
    {0x7c,0x04,0x18,0x04,0x78},{0x7c,0x08,0x04,0x04,0x78},{0x38,0x44,0x44,0x44,0x38},
    {0x7c,0x14,0x14,0x14,0x08},{0x08,0x14,0x14,0x18,0x7c},{0x7c,0x08,0x04,0x04,0x08},
    {0x48,0x54,0x54,0x54,0x20},{0x04,0x3f,0x44,0x40,0x20},{0x3c,0x40,0x40,0x20,0x7c},
    {0x1c,0x20,0x40,0x20,0x1c},{0x3c,0x40,0x30,0x40,0x3c},{0x44,0x28,0x10,0x28,0x44},
    {0x4c,0x90,0x90,0x90,0x7c},{0x44,0x64,0x54,0x4c,0x44},
    // { | } ~
    {0x00,0x08,0x36,0x41,0x00},{0x00,0x00,0x7f,0x00,0x00},{0x00,0x41,0x36,0x08,0x00},{0x08,0x04,0x08,0x10,0x08},
};

// ====== Global state ======
static SDL_Window*   g_win = nullptr;
static SDL_Renderer* g_ren = nullptr;
static int g_w = 1400, g_h = 900;
static int g_mx = 0, g_my = 0;
static bool g_mdown = false;
static bool g_was_mdown = false;

// UI state
static char g_input_buf[10][64] = {};
static int  g_active_input = -1;
static int  g_active_combo = -1;
static bool g_combo_open = false;
static int  g_combo_items[10] = {};
static int  g_combo_idx[10] = {};
static const char* g_exchanges[] = {"CFFEX","SHFE","CZCE","DCE","INE","GFEX",nullptr};
static const char* g_directions[] = {"多","空",nullptr};
static const char* g_offsets[] = {"开","平","平今","平昨",nullptr};
static const char* g_types[] = {"限价","市价","FAK","FOK",nullptr};
static int  g_exchange_idx=1, g_dir_idx=0, g_offs_idx=0, g_type_idx=0;
static int  g_price_check = 0;
static char g_order_msg[128] = "";

// Event log
static char g_log[20][128] = {};
static int  g_log_count = 0;

// ====== SDL drawing helpers ======
static void setColor(const SDL_Color& c) { SDL_SetRenderDrawColor(g_ren, c.r, c.g, c.b, c.a); }
static void fillRect(int x, int y, int w, int h) { SDL_Rect r{x,y,w,h}; SDL_RenderFillRect(g_ren, &r); }
static void drawRect(int x, int y, int w, int h) { SDL_Rect r{x,y,w,h}; SDL_RenderDrawRect(g_ren, &r); }
static void drawLine(int x1, int y1, int x2, int y2) { SDL_RenderDrawLine(g_ren, x1, y1, x2, y2); }

static void fillRectC(int x, int y, int w, int h, const SDL_Color& c) {
    setColor(c); fillRect(x,y,w,h);
}

static void drawChar(int x, int y, char ch, const SDL_Color& c, int scale=1) {
    if (ch < 32 || ch > 126) return;
    setColor(c);
    const unsigned char* glyph = FONT_DATA[ch-32];
    for (int col=0; col<5; col++) {
        unsigned char bits = glyph[col];
        for (int row=0; row<7; row++) {
            if (bits & (1<<row)) {
                int sx = x + col*scale, sy = y + row*scale;
                for (int dy=0; dy<scale; dy++)
                    for (int dx=0; dx<scale; dx++)
                        SDL_RenderDrawPoint(g_ren, sx+dx, sy+dy);
            }
        }
    }
}

static int textWidth(const char* s, int scale=1) {
    int w = 0;
    for (const char* p=s; *p; p++) w += (FONT_W-1)*scale;
    return w;
}

static void drawText(int x, int y, const char* s, const SDL_Color& c, int scale=1) {
    int cx = x;
    for (const char* p=s; *p; p++, cx+=(FONT_W-1)*scale) {
        drawChar(cx, y, *p, c, scale);
    }
}

// ====== Widget rendering ======

static void drawDockTitle(int x, int y, int w, const char* title) {
    fillRectC(x, y, w, 22, C_HEADER);
    setColor(C_BORDER); drawLine(x, y+21, x+w, y+21);
    drawText(x+6, y+4, title, C_DIM, 1);
}

static Rect drawButton(int x, int y, int w, int h, const char* label, const SDL_Color& bg) {
    fillRectC(x, y, w, h, bg);
    setColor(C_BORDER); drawRect(x, y, w, h);
    int tw = strlen(label)*(FONT_W-1);
    drawText(x+(w-tw)/2, y+(h-8)/2, label, C_WHITE, 1);
    return {x, y, w, h};
}

static Rect drawTextField(int x, int y, int w, const char* text, bool active, bool readonly=false) {
    SDL_Color bg = readonly ? C_SURFACE : C_HEADER;
    fillRectC(x, y, w, 20, bg);
    setColor(active ? C_FOCUS : C_BORDER); drawRect(x, y, w, 20);
    SDL_Color tc = readonly ? C_DIM : C_TEXT;
    drawText(x+4, y+4, text, tc, 1);
    if (active) {
        // Cursor
        int cw = textWidth(text, 1);
        fillRectC(x+5+cw, y+5, 4, 11, C_TEXT);
    }
    return {x, y, w, 20};
}

static Rect drawComboBox(int x, int y, int w, const char* text, bool open, int idx) {
    fillRectC(x, y, w, 20, C_HEADER);
    setColor(open ? C_FOCUS : C_BORDER); drawRect(x, y, w, 20);
    drawText(x+4, y+4, text, C_TEXT, 1);
    // Dropdown arrow
    int ax = x+w-14, ay = y+7;
    fillRectC(ax, ay, 8, 6, C_DIM);
    drawText(ax, ay-2, "v", C_TEXT);

    // Open: render dropdown list
    if (open) {
        int item_h = 18, n = 6;
        fillRectC(x, y+20, w, n*item_h, C_SURFACE);
        setColor(C_BORDER); drawRect(x, y+20, w, n*item_h);
        for (int i=0; i<n; i++) {
            if (i==idx) fillRectC(x+1, y+20+i*item_h+1, w-2, item_h-2, C_ACCENT);
            drawText(x+4, y+22+i*item_h, g_exchanges[i], C_TEXT, 1);
        }
    }
    return {x, y, w, 20};
}

static void drawDepthPanel(int x, int y, int w) {
    // Title
    setColor(C_BORDER); drawLine(x, y, x+w, y);

    int cy = y+6;
    // Ask 5..1
    for (int i=4; i>=0; i--) {
        char buf[32];
        snprintf(buf, sizeof(buf), "%.2f", 3500.0 + i*2.5);
        drawText(x+4, cy, buf, C_ASK, 1);
        snprintf(buf, sizeof(buf), "%d", 100*(5-i));
        int tw = textWidth(buf, 1);
        drawText(x+w-8-tw, cy, buf, C_ASK, 1);
        cy += 14;
    }
    // Mid
    char buf[64];
    snprintf(buf, sizeof(buf), "3512.50");
    drawText(x+4, cy, buf, C_TEXT, 2);
    snprintf(buf, sizeof(buf), "+2.3%%");
    int tw = textWidth(buf, 1);
    drawText(x+w-8-tw, cy, buf, C_TEXT, 1);
    setColor(C_BORDER); drawLine(x, cy-1, x+w, cy-1);
    cy += 18;
    setColor(C_BORDER); drawLine(x, cy-1, x+w, cy-1);

    // Bid 1..5
    for (int i=0; i<5; i++) {
        snprintf(buf, sizeof(buf), "%.2f", 3510.0 - i*2.5);
        drawText(x+4, cy, buf, C_BID, 1);
        snprintf(buf, sizeof(buf), "%d", 80+i*20);
        tw = textWidth(buf, 1);
        drawText(x+w-8-tw, cy, buf, C_BID, 1);
        cy += 14;
    }
}

static void drawTable(int x, int y, int w, int h, const char** headers, int ncols) {
    // Header row
    fillRectC(x, y, w, 22, C_HEADER);
    int cw = w / ncols;
    for (int i=0; i<ncols; i++) {
        setColor(C_BORDER); drawLine(x+i*cw, y, x+i*cw, y+22);
        if (headers[i]) drawText(x+i*cw+3, y+4, headers[i], C_TEXT, 1);
    }
    drawLine(x, y+21, x+w, y+21);
}

// ====== Main render ======
static int g_frame = 0;

static void render() {
    // Clear
    setColor(C_BG);
    SDL_RenderClear(g_ren);

    // === Title bar ===
    fillRectC(0, 0, g_w, 30, C_HEADER);
    setColor(C_BORDER); drawLine(0, 29, g_w, 29);
    drawText(8, 6, "VeighNa Trader 社区版 - 4.4.0 [Qt-WASM]", C_TEXT, 1);
    drawText(g_w-70, 6, "14:30:00", C_DIM, 1);

    // === Menu bar ===
    fillRectC(0, 30, g_w, 24, C_HEADER);
    setColor(C_BORDER); drawLine(0, 53, g_w, 53);
    drawText(8, 34, "系统", C_TEXT, 1);
    drawText(52, 34, "功能", C_TEXT, 1);
    drawText(96, 34, "帮助", C_TEXT, 1);

    int top = 54;

    // === DOCK LAYOUT (exact Qt replication) ===
    int left_w = 280, right_w = (g_w-left_w)/2;
    int tick_h = (g_h-top-200), order_h = tick_h;

    // -- Left: Trading Panel --
    int lx = 1, ly = top, lw = left_w-2;
    fillRectC(lx, ly, lw, g_h-ly, C_SURFACE);
    drawDockTitle(lx, ly, lw, " 交易");

    // Trading form
    int fx = lx+8, fy = ly+26;

    // Labels + inputs
    drawText(fx, fy, "交易所", C_DIM, 1);
    drawComboBox(fx+42, fy-2, lw-52, g_exchanges[g_exchange_idx], g_active_combo==0&&g_combo_open, g_exchange_idx);

    fy += 22;
    drawText(fx, fy, "代码", C_DIM, 1);
    drawTextField(fx+42, fy-2, lw-52, g_input_buf[0], g_active_input==0);

    fy += 22;
    drawText(fx, fy, "名称", C_DIM, 1);
    drawTextField(fx+42, fy-2, lw-52, "", false, true);

    fy += 22;
    drawText(fx, fy, "方向", C_DIM, 1);
    drawTextField(fx+42, fy-2, lw-52, g_directions[g_dir_idx], false, false);

    fy += 22;
    drawText(fx, fy, "开平", C_DIM, 1);
    drawTextField(fx+42, fy-2, lw-52, g_offsets[g_offs_idx], false, false);

    fy += 22;
    drawText(fx, fy, "类型", C_DIM, 1);
    drawTextField(fx+42, fy-2, lw-52, g_types[g_type_idx], false, false);

    fy += 22;
    drawText(fx, fy, "价格", C_DIM, 1);
    drawTextField(fx+42, fy-2, lw-52, g_input_buf[2], g_active_input==2, false);
    // Price checkbox
    fillRectC(fx+lw-28, fy-2, 14, 14, g_price_check ? C_ACCENT : C_SURFACE);
    setColor(C_BORDER); drawRect(fx+lw-28, fy-2, 14, 14);
    if (g_price_check) drawText(fx+lw-25, fy+1, "v", C_WHITE);

    fy += 22;
    drawText(fx, fy, "数量", C_DIM, 1);
    drawTextField(fx+42, fy-2, lw-52, g_input_buf[3], g_active_input==3);

    fy += 22;
    drawText(fx, fy, "接口", C_DIM, 1);
    drawTextField(fx+42, fy-2, lw-52, "CTP", false);

    fy += 26;
    // Buy/Sell buttons
    int bw = (lw-30)/2;
    drawButton(fx, fy, bw, 24, "空", C_BTN_SELL);
    drawButton(fx+bw+6, fy, bw, 24, "多", C_BTN_BUY);

    fy += 28;
    drawButton(fx, fy, lw-18, 22, "全撤", C_SURFACE);

    // Depth
    fy += 30;
    drawDepthPanel(fx, fy, lw-20);

    // -- Right top: TickMonitor --
    int rx = left_w, ry = top, rw = g_w-left_w-1;
    int tick_w = rw/2;
    fillRectC(rx, ry, tick_w, tick_h, C_SURFACE);
    drawDockTitle(rx, ry, tick_w, " 行情");
    const char* tick_hdrs[] = {"代码","交易所","名称","最新价","成交量","开盘价","最高价","最低价","买1价","买1量","卖1价","卖1量","时间","接口"};
    drawTable(rx, ry+22, tick_w, tick_h-22, tick_hdrs, 14);

    // -- Right: Order/Active (tabbed) --
    int ox = rx+tick_w+1, oy = ry, ow = rw-tick_w-1;
    fillRectC(ox, oy, ow, order_h, C_SURFACE);
    // Tab bar
    fillRectC(ox, oy, ow, 22, C_HEADER);
    fillRectC(ox+2, oy+20, 50, 2, C_ACCENT);
    drawText(ox+8, oy+4, "活动", C_TEXT, 1);
    drawText(ox+56, oy+4, "委托", C_DIM, 1);
    const char* ord_hdrs[] = {"委托号","来源","代码","交易所","类型","方向","开平","价格","数量","成交","状态","时间","接口"};
    drawTable(ox, oy+22, ow, order_h-22, ord_hdrs, 13);

    // -- Bottom left: TradeMonitor --
    int bly = oy+order_h+1, blh = g_h-bly-1;
    fillRectC(rx, bly, tick_w, blh, C_SURFACE);
    drawDockTitle(rx, bly, tick_w, " 成交");
    const char* trd_hdrs[] = {"成交号","委托号","代码","交易所","方向","开平","价格","数量","时间","接口"};
    drawTable(rx, bly+22, tick_w, blh-22, trd_hdrs, 10);

    // -- Bottom center: Log --
    int lgx = ox, lgy = bly, lgw = ow;
    fillRectC(lgx, lgy, lgw, blh, C_SURFACE);
    drawDockTitle(lgx, lgy, lgw, " 日志");
    // Log entries
    for (int i=0; i<g_log_count && i<8; i++) {
        drawText(lgx+6, lgy+24+i*14, g_log[i], C_DIM, 1);
    }

    // Order status message
    if (g_order_msg[0]) {
        fillRectC(g_w/2-100, g_h-30, 200, 20, C_ACCENT);
        drawText(g_w/2-90, g_h-26, g_order_msg, C_WHITE, 1);
    }

    SDL_RenderPresent(g_ren);
    g_frame++;
}

// ====== Input handling ======
static EM_BOOL on_mouse(int type, const EmscriptenMouseEvent* e, void*) {
    g_mx = e->canvasX; g_my = e->canvasY;
    if (type == EMSCRIPTEN_EVENT_MOUSEDOWN) { g_mdown = true; g_was_mdown = true; }
    if (type == EMSCRIPTEN_EVENT_MOUSEUP)   { g_mdown = false; }
    return EM_TRUE;
}

static EM_BOOL on_key(int type, const EmscriptenKeyboardEvent* e, void*) {
    if (type == EMSCRIPTEN_EVENT_KEYDOWN && g_active_input >= 0) {
        char* buf = g_input_buf[g_active_input];
        int len = strlen(buf);
        if (strlen(e->key) == 1 && len < 60) { buf[len] = e->key[0]; buf[len+1] = 0; }
        if (!strcmp(e->key, "Backspace") && len > 0) buf[len-1] = 0;
        if (!strcmp(e->key, "Enter")) { g_active_input = -1; g_order_msg[0]=0;
            snprintf(g_order_msg, sizeof(g_order_msg), "委托已发送: %s %s", g_input_buf[0], g_directions[g_dir_idx]);
            snprintf(g_log[g_log_count%20], 128, "14:30:%.2d [CTP] Order sent: %s.%s", g_frame%60, g_input_buf[0], g_exchanges[g_exchange_idx]);
            g_log_count++;
        }
        if (!strcmp(e->key, "Escape")) g_active_input = -1;
    }
    return EM_TRUE;
}

static EM_BOOL on_wheel(int type, const EmscriptenWheelEvent* e, void*) {
    return EM_TRUE;
}

// ====== Click handling ======
static void handle_click(int mx, int my) {
    // Check if click on symbol input
    if (mx>330 && mx<590 && my>100 && my<120) {
        g_active_input = 0;
    } else if (mx>330 && mx<590 && my>166 && my<186) {
        g_active_input = 2; // price
    } else if (mx>330 && mx<590 && my>188 && my<208) {
        g_active_input = 3; // volume
    } else {
        g_active_input = -1;
    }

    // Combo box
    if (mx>330 && mx<590 && my>78 && my<98) {
        g_active_combo = 0; g_combo_open = !g_combo_open;
    } else {
        g_combo_open = false;
    }

    // Buy / Sell buttons
    if (my>210 && my<234) {
        int bw = (280-30)/2, bfx = 10;
        if (mx>bfx && mx<bfx+bw) { // Sell
            snprintf(g_order_msg, sizeof(g_order_msg), "卖出委托已发送!");
            snprintf(g_log[g_log_count%20], 128, "14:30:%.2d [CTP] SELL %s", g_frame%60, g_input_buf[0]);
            g_log_count++;
        }
        if (mx>bfx+bw+6 && mx<bfx+2*bw+6) { // Buy
            snprintf(g_order_msg, sizeof(g_order_msg), "买入委托已发送!");
            snprintf(g_log[g_log_count%20], 128, "14:30:%.2d [CTP] BUY %s", g_frame%60, g_input_buf[0]);
            g_log_count++;
        }
    }

    // Cancel all
    if (mx>10 && mx<270 && my>238 && my<260) {
        snprintf(g_order_msg, sizeof(g_order_msg), "全撤请求已发出");
    }

    // Price checkbox
    if (mx>256 && mx<270 && my>166 && my<180) {
        g_price_check = !g_price_check;
    }
}

// ====== Main loop ======
static void main_loop() {
    if (g_was_mdown && !g_mdown) {
        handle_click(g_mx, g_my);
        g_was_mdown = false;
    }
    render();
}

int main() {
    SDL_Init(SDL_INIT_VIDEO);
    g_win = SDL_CreateWindow("VeighNa Qt-WASM", SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, g_w, g_h, SDL_WINDOW_SHOWN|SDL_WINDOW_RESIZABLE);
    g_ren = SDL_CreateRenderer(g_win, -1, SDL_RENDERER_ACCELERATED);

    // Init input buffer
    strcpy(g_input_buf[0], "rb2510");
    strcpy(g_input_buf[2], "3500");
    strcpy(g_input_buf[3], "1");
    strcpy(g_log[0], "14:30:00 [MainEngine] Qt-WASM Trader started");
    strcpy(g_log[1], "14:30:01 [CTP] Gateway registered: CTP");
    strcpy(g_log[2], "14:30:02 [MainEngine] WebSocket client ready");
    g_log_count = 3;

    // Register event handlers
    emscripten_set_mousedown_callback("#canvas", nullptr, 1, on_mouse);
    emscripten_set_mouseup_callback("#canvas", nullptr, 1, on_mouse);
    emscripten_set_mousemove_callback("#canvas", nullptr, 1, on_mouse);
    emscripten_set_keydown_callback(EMSCRIPTEN_EVENT_TARGET_WINDOW, nullptr, 1, on_key);
    emscripten_set_wheel_callback("#canvas", nullptr, 1, on_wheel);

    emscripten_set_main_loop(main_loop, 30, 1);

    return 0;
}
