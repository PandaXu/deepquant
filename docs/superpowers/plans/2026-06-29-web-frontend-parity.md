# Web Frontend Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebuild DeepQuant web frontend to match desktop GUI functionality with 5 tabs: 行情交易, 数据管理, 策略, 日志, 设置.

**Architecture:** Vue 3 CDN SPA with 5-tab layout. Shared state via `store.js` (WebSocket + REST). Each tab gets its own JS module loaded via script tags. ECharts for charts. Pure CSS dark theme.

**Tech Stack:** Vue 3 CDN, ECharts 5.5, no build tools, pure CSS dark theme

## Global Constraints

- No build tools, Vue 3 via CDN (`vue.global.prod.js`), ECharts via CDN
- Dark theme CSS custom properties, 红涨绿跌 (Chinese futures convention)
- WebSocket for real-time data, REST for queries
- All modules loaded via `<script>` tags in order
- Responsive: 900px breakpoint for single-column fallback
- All UI text in Chinese (Simplified)

## File Structure

```
deepquant_web/static/
├── index.html          → Complete rewrite: 5-tab layout
├── css/style.css       → Update: tab nav, full-height layout, new component styles
├── js/store.js         → Enhance: log buffer, gateway state, strategy events
├── js/app.js           → New: main app bootstrap, tab switching, shared state
├── js/tab-trading.js   → New: Tab 1 — KLine, depth, trade form, tables
├── js/tab-data.js      → New: Tab 2 — contract query, data download, overview
├── js/tab-strategy.js  → New: Tab 3 — strategy cards, backtest panel
├── js/tab-log.js       → New: Tab 4 — log table with filter/export
├── js/tab-settings.js  → New: Tab 5 — gateway connect, accounts, global config
└── favicon.png         → Keep
```

---

### Task 1: Update store.js — shared foundation

**Files:**
- Modify: `deepquant_web/static/js/store.js`

**Interfaces:**
- Produces: `$s.log` (enhanced with `{time, level, source, msg}` objects), `$s.gateways`, `$s.gatewayAccounts`
- Produces: `$wsSend()`, `$apiGet()`, `$apiPost()`, `$fmtPrice()`, `$fmtVol()`, `$fmtPnl()`, `$timeStr()`, `$toast()`, `isExpired()`

- [ ] **Step 1: Enhance store.js with new reactive state and WS handlers**

Replace the end of `_onWsMessage` (after existing `else if (type === 'log')` block) and add new WS command helper:

```javascript
// In $s reactive object, add:
const $s = reactive({
  tick: {},
  order: {},
  trade: {},
  position: {},
  account: {},
  contract: {},
  log: [],
  wsStatus: false,
  wsReconnect: 0,
  maxLog: 1000,
  // New state
  gateways: [],
  gatewayAccounts: [],
  strategies: [],
  btClasses: [],
  dataOverview: [],
  logPaused: false,
});

// In _onWsMessage, after existing 'log' handler, add:
    } else if (type === 'eLog' && data) {
      const entry = typeof data === 'string'
        ? { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level: 'INFO', source: '', msg: data }
        : { time: data.time || data.msg?.time || new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            level: data.level || 'INFO', source: data.source || data.gateway_name || '',
            msg: data.msg || (typeof data === 'string' ? data : JSON.stringify(data)) };
      if (!$s.logPaused) {
        $s.log.push(entry);
        if ($s.log.length > $s.maxLog) $s.log.splice(0, $s.log.length - $s.maxLog);
      }
    } else if (type === 'cta_strategies' && Array.isArray(data)) {
      $s.strategies = data;
    } else if (type === 'bt_classes' && Array.isArray(data)) {
      $s.btClasses = data;
    } else if (type === 'data_overview' && Array.isArray(data)) {
      $s.dataOverview = data;
    } else if (type === 'gateway_list' && Array.isArray(data)) {
      $s.gateways = data;
    } else if (type === 'gateway_accounts' && Array.isArray(data)) {
      $s.gatewayAccounts = data;
    } else if (type === 'strategy_logs' && data) {
      const e = typeof data === 'string' ? { msg: data, time: new Date().toLocaleTimeString() } : data;
      if (!$s.logPaused) {
        $s.log.push({ time: e.time || new Date().toLocaleTimeString(), level: 'INFO', source: 'STRATEGY', msg: e.msg || JSON.stringify(e) });
        if ($s.log.length > $s.maxLog) $s.log.splice(0, $s.log.length - $s.maxLog);
      }
    }
```

Add new API helper for gateway account CRUD:

```javascript
// ---- Gateway Account CRUD ----
async function $loadGatewayAccounts() {
  try { $s.gatewayAccounts = await $apiGet('/api/gateway-accounts') || []; } catch(e) { console.error('load gateway accounts:', e); }
}

async function $saveGatewayAccount(alias, gateway, setting) {
  await $apiPost('/api/gateway-accounts', { alias, gateway, setting_json: JSON.stringify(setting) });
  await $loadGatewayAccounts();
}

async function $deleteGatewayAccount(id) {
  await $apiPost('/api/account/delete', { vt_accountid: id });
  await $loadGatewayAccounts();
}

// ---- Export CSV ----
function $exportCSV(headers, rows, filename) {
  const BOM = '﻿';
  const csv = BOM + headers.join(',') + '\n' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename || 'export.csv';
  a.click();
}
```

- [ ] **Step 2: Update MAX_LOG from 200 to 1000 and add logPaused flag**

Already done in step 1 code above.

- [ ] **Step 3: Verify store.js loads without errors**

Open `index.html` in browser, check console for no JS errors.

---

### Task 2: Rewrite index.html — 5-tab layout

**Files:**
- Create: `deepquant_web/static/index.html` (complete rewrite)
- Modify: `deepquant_web/static/css/style.css`

**Interfaces:**
- Consumes: `store.js` (global `$s`, `$wsConnect`, `$wsSend`, etc.)
- Consumes: `app.js`, `tab-trading.js`, `tab-data.js`, `tab-strategy.js`, `tab-log.js`, `tab-settings.js`

- [ ] **Step 1: Write new index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>DeepQuant Trader</title>
<link rel="icon" type="image/png" href="/favicon.png">
<link rel="stylesheet" href="/css/style.css">
<script src="https://cdn.jsdelivr.net/npm/vue@3/dist/vue.global.prod.js"></script>
<script src="https://cdn.jsdelivr.net/npm/echarts@5.5.0/dist/echarts.min.js"></script>
</head>
<body>
<div id="app">
  <!-- Header -->
  <header id="header">
    <div class="logo">Deep<span>Quant</span> Trader</div>
    <div class="ws-status" style="display:flex;align-items:center;gap:6px">
      <div class="ws-dot" :class="$s.wsStatus ? 'on' : 'off'"></div>
      <span style="font-size:11px">{{ $s.wsStatus ? '已连接' : '未连接' }}</span>
      <button class="btn btn-xs" @click="$wsConnect()" title="重新连接">↻</button>
    </div>
    <div id="clock" class="clock">--:--:--</div>
  </header>

  <!-- Tab Bar -->
  <nav id="tab-bar">
    <button v-for="t in tabs" :key="t.id" class="tab-btn"
      :class="{ active: activeTab === t.id }" @click="activeTab = t.id">
      {{ t.icon }} {{ t.label }}
    </button>
    <div style="margin-left:auto;display:flex;gap:6px;align-items:center">
      <span style="font-size:10px;color:var(--text-dim)">
        订单{{ orderCount }} · 持仓{{ posCount }} · 行情{{ tickCount }}
      </span>
    </div>
  </nav>

  <!-- Tab Content -->
  <!-- Tab 1: 行情交易 -->
  <div v-show="activeTab === 'trading'" class="tab-content" id="tab-trading">
    <tab-trading ref="tabTrading"></tab-trading>
  </div>

  <!-- Tab 2: 数据管理 -->
  <div v-show="activeTab === 'data'" class="tab-content" id="tab-data">
    <tab-data></tab-data>
  </div>

  <!-- Tab 3: 策略 -->
  <div v-show="activeTab === 'strategy'" class="tab-content" id="tab-strategy">
    <tab-strategy></tab-strategy>
  </div>

  <!-- Tab 4: 日志 -->
  <div v-show="activeTab === 'log'" class="tab-content" id="tab-log">
    <tab-log></tab-log>
  </div>

  <!-- Tab 5: 设置 -->
  <div v-show="activeTab === 'settings'" class="tab-content" id="tab-settings">
    <tab-settings></tab-settings>
  </div>
</div>

<script src="/js/store.js"></script>
<script src="/js/tab-trading.js"></script>
<script src="/js/tab-data.js"></script>
<script src="/js/tab-strategy.js"></script>
<script src="/js/tab-log.js"></script>
<script src="/js/tab-settings.js"></script>
<script src="/js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Add tab bar CSS to style.css**

Add to `style.css` (after existing `#header` styles):

```css
/* ---- Tab Bar ---- */
#tab-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 12px;
  height: 36px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.tab-btn {
  padding: 6px 16px;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 13px;
  font-family: var(--font);
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: all 0.15s;
  white-space: nowrap;
}
.tab-btn:hover { color: var(--text); background: var(--bg-hover); }
.tab-btn.active { color: var(--accent); background: rgba(59,130,246,0.12); font-weight: 600; }

/* ---- Tab Content ---- */
.tab-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-height: 0;
}

/* ---- Header shrink ---- */
#header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 6px 14px;
  background: var(--bg-card);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  height: 38px;
}
```

- [ ] **Step 3: Verify layout loads**

Start server (`python deepquant_web/run.py`), open browser, confirm 5 tabs render with no JS errors.

---

### Task 3: Write app.js — bootstrap and tab switching

**Files:**
- Create: `deepquant_web/static/js/app.js`

**Interfaces:**
- Consumes: Vue 3 global (`createApp`), all tab components (global registrations from tab-*.js)
- Produces: Vue app mounted on `#app`

- [ ] **Step 1: Write app.js**

```javascript
// ===== DeepQuant App — Bootstrap =====
const { createApp, ref, computed, onMounted } = Vue;

const App = {
  setup() {
    const tabs = [
      { id: 'trading', icon: '📈', label: '行情交易' },
      { id: 'data', icon: '📊', label: '数据管理' },
      { id: 'strategy', icon: '⚙️', label: '策略' },
      { id: 'log', icon: '📋', label: '日志' },
      { id: 'settings', icon: '🔧', label: '设置' },
    ];
    const activeTab = ref('trading');

    // Computed counts for status bar
    const orderCount = computed(() => Object.keys($s.order).length);
    const tickCount = computed(() => Object.keys($s.tick).length);
    const posCount = computed(() => Object.keys($s.position).length);
    const tradeCount = computed(() => Object.keys($s.trade).length);

    // Collapse log when leaving log tab
    const logPaused = computed({
      get: () => $s.logPaused,
      set: (v) => { $s.logPaused = v; }
    });

    return { tabs, activeTab, orderCount, tickCount, posCount, tradeCount, logPaused, $s };
  },
};

const app = createApp(App);
// Register all tab components (must be loaded before this script)
app.component('tab-trading', TabTrading);
app.component('tab-data', TabData);
app.component('tab-strategy', TabStrategy);
app.component('tab-log', TabLog);
app.component('tab-settings', TabSettings);

app.mount('#app');
```

- [ ] **Step 2: Test tab switching**

Open browser, click each tab button, verify content area shows the correct tab.

---

### Task 4: Tab 1 — 行情交易 (Trading Tab)

This is the largest tab. Contains: KLine chart, depth order book, trade form, tick strip, position/order/trade/account tables.

**Files:**
- Create: `deepquant_web/static/js/tab-trading.js`

**Interfaces:**
- Produces: `TabTrading` Vue component (global)
- Consumes: `$s` (tick, order, trade, position, account), `$wsSend`, `$apiGet`, `$exportCSV`, formatters

- [ ] **Step 1: Write TabTrading component with all sub-components**

```javascript
// ===== Tab 1: 行情交易 =====
const TabTrading = {
  template: `
    <div class="trading-layout">
      <!-- Top: Chart + Trade Form -->
      <div class="trading-top">
        <!-- K-Line Chart + Depth -->
        <div class="trading-chart panel">
          <div class="panel-header">
            <span class="panel-title">📈 K线图</span>
            <span class="panel-badge">{{ chartSymbol || '—' }}</span>
            <div style="margin-left:auto;display:flex;gap:4px">
              <button class="btn btn-xs" v-for="iv in ['1m','5m','15m','1h','d']" :key="iv"
                :class="{ 'btn-primary': chartInterval === iv }" @click="loadChart(chartSymbol, iv)">
                {{ iv }}
              </button>
            </div>
          </div>
          <div class="kline-container" ref="klineEl"></div>
          <div class="depth-inline" v-if="depthTick">
            <div class="depth-asks">
              <div v-for="i in 5" :key="'a'+i" class="depth-row"
                @click="fillPrice(depthTick['ask_price_'+i])">
                <span class="depth-price ask">{{ $fmtPrice(depthTick['ask_price_'+i]) }}</span>
                <span class="depth-vol">{{ $fmtVol(depthTick['ask_volume_'+i]) }}</span>
                <span class="depth-label">卖{{ i }}</span>
              </div>
            </div>
            <div class="depth-mid">
              <span class="depth-last" :class="chgCls(depthTick)">{{ $fmtPrice(depthTick.last_price) }}</span>
              <span class="depth-chg" :class="chgCls(depthTick)">{{ chgText(depthTick) }}</span>
            </div>
            <div class="depth-bids">
              <div v-for="i in 5" :key="'b'+i" class="depth-row"
                @click="fillPrice(depthTick['bid_price_'+i])">
                <span class="depth-label">买{{ i }}</span>
                <span class="depth-vol">{{ $fmtVol(depthTick['bid_volume_'+i]) }}</span>
                <span class="depth-price bid">{{ $fmtPrice(depthTick['bid_price_'+i]) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Trade Form -->
        <div class="trading-form panel">
          <div class="panel-header"><span class="panel-title">📝 下单</span></div>
          <div class="panel-body form-grid">
            <div class="form-row">
              <label>交易所</label>
              <select v-model="form.exchange" @change="onExchange" class="input">
                <option value="">选择交易所</option>
                <option v-for="ex in exchanges" :value="ex.value" :key="ex.value">{{ ex.name }}</option>
              </select>
            </div>
            <div class="form-row">
              <label>品种</label>
              <select v-model="form.product" @change="onProduct" class="input" :disabled="!form.exchange">
                <option value="">选择品种</option>
                <option v-for="p in products" :value="p" :key="p">{{ p }}</option>
              </select>
            </div>
            <div class="form-row">
              <label>合约</label>
              <select v-model="form.symbol" @change="onSymbol" class="input" :disabled="!form.product">
                <option value="">选择合约</option>
                <option v-for="c in filteredContracts" :value="c.vt_symbol" :key="c.vt_symbol">
                  {{ c.expired ? '⚠️ ' : '' }}{{ c.symbol }} — {{ c.name }}
                </option>
              </select>
              <label class="checkbox-label" style="font-size:11px;margin-top:2px">
                <input type="checkbox" v-model="showExpired" style="width:auto"> 显示到期合约
              </label>
            </div>
            <div class="form-row">
              <label>合约名称</label>
              <div class="readonly-field">{{ contractName || '—' }}</div>
            </div>
            <div class="form-row">
              <label>方向</label>
              <select v-model="form.direction" class="input">
                <option value="LONG">🟥 多头</option>
                <option value="SHORT">🟩 空头</option>
              </select>
            </div>
            <div class="form-row">
              <label>开平</label>
              <select v-model="form.offset" class="input">
                <option value="OPEN">开仓</option>
                <option value="CLOSE">平仓</option>
                <option value="CLOSETODAY">平今</option>
                <option value="CLOSEYESTERDAY">平昨</option>
              </select>
            </div>
            <div class="form-row">
              <label>类型</label>
              <select v-model="form.orderType" class="input">
                <option value="LIMIT">限价</option>
                <option value="MARKET">市价</option>
                <option value="STOP">止损</option>
                <option value="FAK">FAK</option>
                <option value="FOK">FOK</option>
              </select>
            </div>
            <div class="form-row">
              <label>价格</label>
              <div style="display:flex;gap:4px">
                <input v-model="form.price" class="input" placeholder="价格" style="flex:1">
                <label class="checkbox-label" style="font-size:11px;white-space:nowrap">
                  <input type="checkbox" v-model="autoPrice" style="width:auto"> 自动
                </label>
              </div>
            </div>
            <div class="form-row">
              <label>数量</label>
              <input v-model="form.volume" class="input" placeholder="数量" type="number" min="1">
            </div>
            <div class="form-row">
              <label>网关</label>
              <select v-model="form.gateway" class="input">
                <option v-for="gw in $s.gateways" :value="gw" :key="gw">{{ gw }}</option>
                <option value="">自动</option>
              </select>
            </div>
            <div class="form-actions">
              <button class="btn btn-long" @click="placeOrder('LONG')"
                :disabled="!canOrder">🟥 买入开多</button>
              <button class="btn btn-short" @click="placeOrder('SHORT')"
                :disabled="!canOrder">🟩 卖出开空</button>
            </div>
            <div class="form-actions" style="margin-top:4px">
              <button class="btn btn-sm btn-danger" @click="cancelAll">✕ 全部撤单</button>
              <button class="btn btn-sm btn-warn" @click="closeAll">⚡ 一键全平</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Ticker Strip -->
      <div class="ticker-strip" v-if="tickList.length">
        <div v-for="t in tickList" :key="t.vt_symbol" class="ticker-item" @click="onPickTick(t)">
          <span class="sym">{{ t.vt_symbol.split('.')[0] }}</span>
          <span class="price" :class="chgCls(t)">{{ $fmtPrice(t.last_price) }}</span>
          <span class="chg" :class="chgCls(t)">{{ chgText(t) }}</span>
        </div>
      </div>

      <!-- Bottom Tables -->
      <div class="trading-bottom">
        <!-- Position Table -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">💼 持仓</span>
            <span class="panel-badge">{{ posList.length }}</span>
          </div>
          <div class="panel-body" style="overflow:auto">
            <table class="data-table">
              <thead><tr>
                <th @click="sortPos('symbol')">合约 ↕</th>
                <th class="num" @click="sortPos('direction')">方向</th>
                <th class="num" @click="sortPos('volume')">数量</th>
                <th class="num">昨仓</th>
                <th class="num" @click="sortPos('price')">均价</th>
                <th class="num" @click="sortPos('pnl')">盈亏</th>
                <th class="num">操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="p in posList" :key="p.vt_positionid">
                  <td>{{ p.vt_symbol }}</td>
                  <td :class="p.direction === 'LONG' ? 'up' : 'down'">{{ p.direction === 'LONG' ? '多' : '空' }}</td>
                  <td class="num">{{ p.volume }}</td>
                  <td class="num">{{ p.yd_volume || 0 }}</td>
                  <td class="num">{{ $fmtPrice(p.price) }}</td>
                  <td class="num" :class="pnlCls(p)">{{ $fmtPrice(p.position_profit || p.pnl) }}</td>
                  <td><button class="btn btn-xs btn-danger" @click="closePos(p)">平仓</button></td>
                </tr>
                <tr v-if="posList.length === 0"><td colspan="7" class="empty">暂无持仓</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <!-- Orders + Trades (tabbed) -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">📋 订单</span>
            <span class="panel-badge">{{ orderList.length }}</span>
            <div style="margin-left:auto;display:flex;gap:4px">
              <button class="btn btn-xs" :class="{ 'btn-primary': orderFilter === 'active' }"
                @click="orderFilter = 'active'">活动</button>
              <button class="btn btn-xs" :class="{ 'btn-primary': orderFilter === 'all' }"
                @click="orderFilter = 'all'">全部</button>
            </div>
            <button class="btn btn-xs" @click="exportOrders">CSV</button>
          </div>
          <div class="panel-body" style="overflow:auto;max-height:200px">
            <table class="data-table">
              <thead><tr>
                <th>订单号</th><th>合约</th><th>方向</th><th>价格</th><th>数量</th><th>已成交</th><th>状态</th><th>时间</th><th>操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="o in filteredOrders" :key="o.orderid || o.vt_orderid">
                  <td>{{ (o.orderid || '').toString().slice(-8) }}</td>
                  <td>{{ o.vt_symbol }}</td>
                  <td :class="o.direction === 'LONG' ? 'up' : 'down'">{{ o.direction === 'LONG' ? '多' : '空' }}/{{ o.offset }}</td>
                  <td class="num">{{ $fmtPrice(o.price) }}</td>
                  <td class="num">{{ o.volume }}</td>
                  <td class="num">{{ o.traded }}</td>
                  <td>{{ statusText(o.status) }}</td>
                  <td class="num">{{ $timeStr(o.order_time || o.create_time) }}</td>
                  <td><button v-if="isActiveOrder(o)" class="btn btn-xs btn-danger" @click="cancelOrder(o)">撤单</button></td>
                </tr>
                <tr v-if="filteredOrders.length === 0"><td colspan="9" class="empty">暂无订单</td></tr>
              </tbody>
            </table>
            <div style="font-size:11px;color:var(--text-dim);padding:4px 12px;font-weight:600;margin-top:8px">成交记录</div>
            <table class="data-table">
              <thead><tr>
                <th>成交号</th><th>合约</th><th>方向</th><th>价格</th><th>数量</th><th>时间</th>
              </tr></thead>
              <tbody>
                <tr v-for="t in tradeList" :key="t.tradeid">
                  <td>{{ (t.tradeid || '').toString().slice(-8) }}</td>
                  <td>{{ t.vt_symbol }}</td>
                  <td :class="t.direction === 'LONG' ? 'up' : 'down'">{{ t.direction === 'LONG' ? '多' : '空' }}</td>
                  <td class="num">{{ $fmtPrice(t.price) }}</td>
                  <td class="num">{{ t.volume }}</td>
                  <td class="num">{{ $timeStr(t.trade_time || t.time) }}</td>
                </tr>
                <tr v-if="tradeList.length === 0"><td colspan="6" class="empty">暂无成交</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <!-- Account Summary -->
        <div class="panel">
          <div class="panel-header"><span class="panel-title">💰 账户</span></div>
          <div class="panel-body" style="overflow:auto">
            <table class="data-table">
              <thead><tr><th>账户ID</th><th class="num">余额</th><th class="num">冻结</th><th class="num">可用</th><th>网关</th></tr></thead>
              <tbody>
                <tr v-for="a in accountList" :key="a.vt_accountid">
                  <td>{{ a.vt_accountid }}</td>
                  <td class="num">{{ $fmtPrice(a.balance) }}</td>
                  <td class="num">{{ $fmtPrice(a.frozen) }}</td>
                  <td class="num">{{ $fmtPrice(a.available) }}</td>
                  <td>{{ a.gateway_name }}</td>
                </tr>
                <tr v-if="accountList.length === 0"><td colspan="5" class="empty">暂无账户</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`,
  setup() {
    const klineEl = ref(null);
    let chartInstance = null;
    const chartSymbol = ref('');
    const chartInterval = ref('1m');
    const depthTick = ref(null);
    const showExpired = ref(false);
    const autoPrice = ref(false);
    const orderFilter = ref('active');
    const form = reactive({ exchange:'', product:'', symbol:'', direction:'LONG', offset:'OPEN', orderType:'LIMIT', price:'', volume:'1', gateway:'' });
    const exchanges = [
      { value:'CFFEX', name:'中金所' }, { value:'SHFE', name:'上期所' },
      { value:'DCE', name:'大商所' }, { value:'CZCE', name:'郑商所' },
      { value:'INE', name:'上海能源' }, { value:'GFEX', name:'广期所' },
    ];
    const products = ref([]);
    const contracts = ref([]);
    const contractCache = reactive({});
    const posSortKey = ref('');
    const posSortDir = ref(1);

    // ---- Computed ----
    const tickList = computed(() => Object.values($s.tick));
    const orderList = computed(() => Object.values($s.order).sort((a, b) =>
      (b.order_time || b.create_time || 0) - (a.order_time || a.create_time || 0)));
    const tradeList = computed(() => Object.values($s.trade).sort((a, b) =>
      (b.trade_time || b.time || 0) - (a.trade_time || a.time || 0)));
    const posList = computed(() => {
      let arr = Object.values($s.position);
      if (posSortKey.value) {
        arr = [...arr].sort((a, b) => {
          const va = a[posSortKey.value] || 0, vb = b[posSortKey.value] || 0;
          return (va > vb ? 1 : -1) * posSortDir.value;
        });
      }
      return arr;
    });
    const accountList = computed(() => Object.values($s.account));
    const contractName = computed(() => {
      const c = contracts.value.find(c => c.vt_symbol === form.symbol);
      return c ? c.name : '';
    });
    const filteredContracts = computed(() => {
      return contracts.value.filter(c => showExpired.value ? true : !c.expired);
    });
    const filteredOrders = computed(() => {
      if (orderFilter.value === 'active') return orderList.value.filter(o => isActiveOrder(o));
      return orderList.value;
    });
    const canOrder = computed(() => form.symbol && form.volume > 0);

    // ---- Methods ----
    function statusText(s) {
      const map = { SUBMITTING:'提交中', NOTTRADED:'未成交', PARTTRADED:'部分成交', ALLTRADED:'全部成交', CANCELLED:'已撤销', REJECTED:'已拒绝' };
      return map[s] || s;
    }
    function isActiveOrder(o) {
      return ['SUBMITTING','NOTTRADED','PARTTRADED'].includes(o.status);
    }
    function chgCls(t) {
      const prev = t.pre_close || t.open_price || t.last_price || 0;
      return t.last_price > prev ? 'up' : (t.last_price < prev ? 'down' : '');
    }
    function chgText(t) {
      const prev = t.pre_close || t.open_price || t.last_price || 0;
      if (!prev) return '-';
      return ((t.last_price - prev) / prev * 100).toFixed(2) + '%';
    }
    function pnlCls(p) {
      const v = p.position_profit || p.pnl || 0;
      return v > 0 ? 'up' : (v < 0 ? 'down' : '');
    }
    function sortPos(key) {
      if (posSortKey.value === key) { posSortDir.value *= -1; }
      else { posSortKey.value = key; posSortDir.value = 1; }
    }

    // ---- K-Line Chart ----
    let echartsRoot = null;
    function initChart() {
      if (!klineEl.value) return;
      chartInstance = echarts.init(klineEl.value, 'dark');
      chartInstance.setOption({
        backgroundColor: '#0f1117',
        grid: [{ left:'8%', right:'8%', top:'8%', height:'55%' }, { left:'8%', right:'8%', top:'72%', height:'20%' }],
        xAxis: [{ type:'category', gridIndex:0, axisLabel:{show:false} }, { type:'category', gridIndex:1 }],
        yAxis: [{ type:'value', gridIndex:0, scale:true }, { type:'value', gridIndex:1, scale:true }],
        series: [
          { name:'K线', type:'candlestick', xAxisIndex:0, yAxisIndex:0,
            itemStyle:{color:'#ef4444',color0:'#22c55e',borderColor:'#ef4444',borderColor0:'#22c55e'} },
          { name:'成交量', type:'bar', xAxisIndex:1, yAxisIndex:1,
            itemStyle:{color:params=>params.data[1]>params.data[2]?'#ef4444':'#22c55e'} }
        ],
        tooltip: { trigger:'axis' },
        dataZoom: [{ type:'inside', xAxisIndex:[0,1] }, { type:'slider', xAxisIndex:[0,1], bottom:'2%' }],
      });
      window.addEventListener('resize', () => chartInstance?.resize());
    }

    async function loadChart(vtSymbol, interval) {
      if (!vtSymbol) return;
      chartSymbol.value = vtSymbol;
      chartInterval.value = interval || '1m';
      try {
        const parts = vtSymbol.split('.');
        const exchange = parts.length > 1 ? parts[1] : 'CFFEX';
        const data = await $apiGet(`/api/bars?symbol=${parts[0]}&exchange=${exchange}&interval=${chartInterval.value}&start=&end=`);
        if (data && data.length && chartInstance) {
          const ohlcv = data.map(d => [d.datetime, d.open_price, d.close_price, d.low_price, d.high_price, d.volume || 0]);
          chartInstance.setOption({
            xAxis: [{ data: ohlcv.map(d => d[0]) }, { data: ohlcv.map(d => d[0]) }],
            series: [{ data: ohlcv }, { data: ohlcv.map(d => [d[0], d[5], d[1] > d[2] ? 1 : -1]) }]
          });
        }
      } catch(e) { console.error('load chart:', e); }
    }

    function addTickToChart(tick) {
      if (!chartInstance || !chartSymbol.value) return;
      if (tick.vt_symbol !== chartSymbol.value) return;
      // Real-time tick merge — ECharts appendData approach
      const lastData = chartInstance.getOption().series[0].data;
      if (!lastData || !lastData.length) return;
      const last = lastData[lastData.length - 1];
      if (!last) return;
      const newHigh = Math.max(last[4], tick.last_price);
      const newLow = Math.min(last[3], tick.last_price);
      const newClose = tick.last_price;
      chartInstance.setOption({
        series: [
          { data: [...lastData.slice(0, -1), [last[0], last[1], newClose, newLow, newHigh]] },
          { data: [...chartInstance.getOption().series[1].data.slice(0, -1),
            [last[0], (last[5]||0) + (tick.volume||0) - (last[5]||0) > 0 ? tick.volume||0 : 0]]
        }
      ]);
    }

    // ---- Trade Form ----
    async function onExchange() {
      form.product = ''; form.symbol = ''; products.value = [];
      if (!form.exchange) return;
      try {
        products.value = await $apiGet(`/api/contracts/products?exchange=${form.exchange}`) || [];
      } catch(e) { $toast('加载品种失败', 'error'); }
    }
    async function onProduct() {
      form.symbol = '';
      if (!form.product) return;
      try {
        const raw = await $apiGet(`/api/contracts?exchange=${form.exchange}&product=${form.product}`) || [];
        contracts.value = raw.map(c => ({...c, expired: isExpired(c.symbol || c.vt_symbol || '') }));
      } catch(e) { $toast('加载合约失败', 'error'); }
    }
    function onSymbol() {
      if (form.symbol) {
        $wsSend({ action: 'subscribe', payload: { symbol: form.symbol, exchange: form.exchange, gateway: form.gateway || '' } });
        nextTick(() => loadChart(form.symbol, '1m'));
      }
    }
    function fillPrice(price) { if (price) form.price = String(price); }
    function onPickTick(tick) {
      form.exchange = tick.exchange || '';
      form.symbol = tick.vt_symbol || '';
      if (autoPrice.value) form.price = String(tick.last_price);
      depthTick.value = tick;
      loadChart(tick.vt_symbol, '1m');
    }
    async function placeOrder(dir) {
      if (!canOrder.value) return;
      const parts = (form.symbol || '').split('.');
      $wsSend({
        action: 'send_order',
        payload: {
          symbol: parts[0], exchange: parts[1] || form.exchange,
          direction: dir, offset: form.offset, price: form.orderType === 'MARKET' ? 0 : parseFloat(form.price) || 0,
          volume: parseInt(form.volume) || 1, order_type: form.orderType,
          reference: 'ManualTrading', gateway: form.gateway || ''
        }
      });
    }
    function cancelOrder(order) {
      $wsSend({ action: 'cancel_order', payload: { orderid: order.orderid || order.vt_orderid, symbol: order.symbol, exchange: order.exchange, gateway: order.gateway_name || '' } });
    }
    function cancelAll() {
      Object.values($s.order).forEach(o => { if (isActiveOrder(o)) cancelOrder(o); });
    }
    function closeAll() {
      Object.values($s.position).forEach(p => {
        const parts = (p.vt_symbol || '').split('.');
        const oppDir = p.direction === 'LONG' ? 'SHORT' : 'LONG';
        $wsSend({
          action: 'send_order',
          payload: { symbol: parts[0], exchange: parts[1] || p.exchange, direction: oppDir, offset: 'CLOSE',
            price: 0, volume: p.volume, order_type: 'MARKET', reference: 'QuickClose', gateway: '' }
        });
      });
      $toast('已发送全平指令', 'info');
    }
    function closePos(pos) {
      const parts = (pos.vt_symbol || '').split('.');
      const oppDir = pos.direction === 'LONG' ? 'SHORT' : 'LONG';
      $wsSend({
        action: 'send_order',
        payload: { symbol: parts[0], exchange: parts[1] || pos.exchange, direction: oppDir, offset: 'CLOSE',
          price: 0, volume: pos.volume, order_type: 'MARKET', reference: 'QuickClose', gateway: '' }
      });
    }
    function exportOrders() {
      const h = ['订单号','合约','方向/开平','价格','数量','已成交','状态','时间'];
      const rows = orderList.value.map(o => [o.orderid, o.vt_symbol, o.direction+'/'+o.offset, o.price, o.volume, o.traded, statusText(o.status), o.order_time]);
      $exportCSV(h, rows, `orders_${new Date().toISOString().slice(0,10)}.csv`);
    }

    // ---- Watch tick for chart/depth updates ----
    watch(() => $s.tick, () => {
      const ticks = Object.values($s.tick);
      if (ticks.length && chartSymbol.value) {
        const t = ticks.find(t => t.vt_symbol === chartSymbol.value);
        if (t) { depthTick.value = t; addTickToChart(t); }
      }
    }, { deep: true });

    onMounted(() => {
      nextTick(() => { initChart(); });
    });

    return {
      klineEl, chartSymbol, chartInterval, depthTick, showExpired, autoPrice, orderFilter,
      form, exchanges, products, contractCache, posSortKey, posSortDir,
      tickList, orderList, tradeList, posList, accountList, contractName,
      filteredContracts, filteredOrders, canOrder,
      statusText, isActiveOrder, chgCls, chgText, pnlCls, sortPos,
      loadChart, fillPrice, onPickTick, onExchange, onProduct, onSymbol,
      placeOrder, cancelOrder, cancelAll, closeAll, closePos, exportOrders,
    };
  }
};
```

- [ ] **Step 2: Add trading layout CSS**

Append to `style.css`:

```css
/* ---- Trading Layout ---- */
.trading-layout { display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden; }
.trading-top { display:grid; grid-template-columns:1fr 340px; gap:6px; padding:6px; min-height:0; flex:0 0 50%; }
.trading-chart { display:flex; flex-direction:column; min-height:0; }
.kline-container { flex:1; min-height:200px; }
.trading-form { overflow-y:auto; }
.trading-bottom { display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px; padding:0 6px 6px; flex:1; min-height:0; overflow:hidden; }
.trading-bottom > .panel { overflow:hidden; display:flex; flex-direction:column; }
.trading-bottom .panel-body { flex:1; overflow:auto; min-height:0; }

/* Depth Inline */
.depth-inline { display:flex; gap:8px; padding:6px 8px; font-size:11px; font-family:var(--font-mono); border-top:1px solid var(--border); }
.depth-asks, .depth-bids { flex:1; }
.depth-row { display:flex; gap:8px; padding:1px 0; cursor:pointer; }
.depth-row:hover { background:var(--bg-hover); }
.depth-price.ask { color:var(--ask); }
.depth-price.bid { color:var(--bid); }
.depth-vol { color:var(--text-dim); min-width:40px; text-align:right; }
.depth-label { color:var(--text-muted); font-size:9px; width:20px; }
.depth-mid { display:flex; flex-direction:column; align-items:center; justify-content:center; min-width:80px; }
.depth-last { font-size:16px; font-weight:700; }
.depth-chg { font-size:11px; }

/* Form */
.form-grid { display:flex; flex-direction:column; gap:4px; padding:8px; }
.form-row { display:flex; flex-direction:column; gap:2px; }
.form-row label { font-size:10px; color:var(--text-dim); font-weight:600; text-transform:uppercase; }
.form-actions { display:flex; gap:4px; }
.readonly-field { padding:6px 10px; background:var(--bg-input); border-radius:var(--radius-sm); font-size:13px; color:var(--text-dim); }

/* Buttons */
.btn-long { background:var(--red); color:#fff; flex:1; font-size:13px; font-weight:600; }
.btn-short { background:var(--green); color:#000; flex:1; font-size:13px; font-weight:600; }
.btn-warn { background:var(--orange); color:#000; }
.btn-long:hover, .btn-short:hover { filter:brightness(1.1); }

/* Responsive */
@media (max-width:900px) {
  .trading-top { grid-template-columns:1fr; flex:0 0 auto; }
  .trading-bottom { grid-template-columns:1fr; }
}
```

- [ ] **Step 3: Verify trading tab**

Launch web server, open browser to Tab 1. Test: exchange→product→contract cascade, K-line chart loads, depth panel shows, place a test order via WebSocket.

---

### Task 5: Tab 2 — 数据管理

**Files:**
- Create: `deepquant_web/static/js/tab-data.js`

**Interfaces:**
- Produces: `TabData` Vue component (global)
- Consumes: `$apiGet`, `$wsSend`, `$exportCSV`, `$s.dataOverview`

- [ ] **Step 1: Write TabData component**

```javascript
// ===== Tab 2: 数据管理 =====
const TabData = {
  template: `
    <div style="display:flex;flex-direction:column;flex:1;overflow:hidden;padding:8px;gap:8px">
      <!-- Contract Query -->
      <div class="panel" style="flex:0 0 auto">
        <div class="panel-header">
          <span class="panel-title">📋 合约查询</span>
          <input v-model="contractFilter" class="input" placeholder="按代码/交易所筛选" style="width:180px;height:24px;font-size:11px;margin-left:auto">
          <button class="btn btn-xs" @click="exportContracts">CSV</button>
        </div>
        <div class="panel-body" style="max-height:300px;overflow:auto">
          <table class="data-table">
            <thead><tr>
              <th>合约代码</th><th>交易所</th><th>名称</th><th>品种</th><th>乘数</th>
              <th class="num">最小变动</th><th class="num">最小手数</th>
              <th>期权组合</th><th>到期日</th><th>行权价</th><th>期权类型</th><th>网关</th>
            </tr></thead>
            <tbody>
              <tr v-for="c in filteredContracts" :key="c.vt_symbol">
                <td>{{ c.vt_symbol }}</td><td>{{ c.exchange }}</td><td>{{ c.name }}</td>
                <td>{{ c.product }}</td><td class="num">{{ c.size }}</td>
                <td class="num">{{ c.pricetick }}</td><td class="num">{{ c.min_volume }}</td>
                <td>{{ c.option_portfolio || '' }}</td><td>{{ c.option_expiry || '' }}</td>
                <td class="num">{{ c.option_strike || '' }}</td><td>{{ c.option_type || '' }}</td>
                <td>{{ c.gateway_name }}</td>
              </tr>
              <tr v-if="filteredContracts.length === 0"><td colspan="12" class="empty">输入筛选条件后点击"查询"</td></tr>
            </tbody>
          </table>
        </div>
        <div style="padding:4px 8px;display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" @click="queryContracts">🔍 查询</button>
          <span style="font-size:10px;color:var(--text-dim)">共 {{ filteredContracts.length }} 条</span>
        </div>
      </div>

      <!-- Data Download -->
      <div class="panel" style="flex:0 0 auto">
        <div class="panel-header"><span class="panel-title">⬇️ 历史数据下载</span></div>
        <div style="display:flex;gap:8px;padding:8px;flex-wrap:wrap;align-items:end">
          <div class="form-row"><label>交易所</label><select v-model="dl.exchange" @change="onDlExchange" class="input"><option value="">选择</option><option v-for="e in exchanges" :value="e.value">{{ e.name }}</option></select></div>
          <div class="form-row"><label>品种</label><select v-model="dl.product" @change="onDlProduct" class="input"><option value="">选择</option><option v-for="p in dlProducts" :value="p">{{ p }}</option></select></div>
          <div class="form-row"><label>合约</label><select v-model="dl.symbol" class="input"><option value="">选择</option><option v-for="c in dlContracts" :value="c.vt_symbol">{{ c.symbol }}</option></select></div>
          <div class="form-row"><label>周期</label><select v-model="dl.interval" class="input"><option>1m</option><option>5m</option><option>15m</option><option>30m</option><option>1h</option><option>d</option><option>w</option></select></div>
          <div class="form-row"><label>起始日</label><input v-model="dl.start" class="input" type="date"></div>
          <div class="form-row"><label>结束日</label><input v-model="dl.end" class="input" type="date"></div>
          <button class="btn btn-sm btn-primary" @click="startDownload" :disabled="dl.downloading">{{ dl.downloading ? '下载中...' : '下载' }}</button>
        </div>
        <div v-if="dl.downloading" class="progress-bar" style="margin:0 8px 8px">
          <div class="progress-fill" :style="{width: dl.progress + '%'}"></div>
          <span style="font-size:10px;text-align:center;display:block">{{ dl.progress }}%</span>
        </div>
      </div>

      <!-- Data Overview -->
      <div class="panel" style="flex:1;min-height:0">
        <div class="panel-header">
          <span class="panel-title">📊 数据概览</span>
          <button class="btn btn-xs" @click="refreshOverview">刷新</button>
        </div>
        <div class="panel-body" style="overflow:auto">
          <table class="data-table">
            <thead><tr><th>合约</th><th>交易所</th><th>周期</th><th class="num">数据量</th><th>开始时间</th><th>结束时间</th></tr></thead>
            <tbody>
              <tr v-for="d in $s.dataOverview" :key="d.vt_symbol + d.interval">
                <td>{{ d.vt_symbol }}</td><td>{{ d.exchange }}</td><td>{{ d.interval }}</td>
                <td class="num">{{ d.count }}</td><td>{{ d.start }}</td><td>{{ d.end }}</td>
              </tr>
              <tr v-if="$s.dataOverview.length === 0"><td colspan="6" class="empty">暂无数据</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>`,
  setup() {
    const contractFilter = ref('');
    const allContracts = ref([]);
    const dl = reactive({ exchange:'', product:'', symbol:'', interval:'1m', start:'', end:'', downloading:false, progress:0 });
    const dlProducts = ref([]);
    const dlContracts = ref([]);
    const exchanges = [
      { value:'CFFEX', name:'中金所' }, { value:'SHFE', name:'上期所' },
      { value:'DCE', name:'大商所' }, { value:'CZCE', name:'郑商所' },
      { value:'INE', name:'上海能源' }, { value:'GFEX', name:'广期所' },
    ];

    const filteredContracts = computed(() => {
      if (!contractFilter.value) return allContracts.value;
      const q = contractFilter.value.toLowerCase();
      return allContracts.value.filter(c => (c.vt_symbol||'').toLowerCase().includes(q) || (c.exchange||'').toLowerCase().includes(q));
    });

    async function queryContracts() {
      try {
        const data = await $apiGet(`/api/contracts?filter=${encodeURIComponent(contractFilter.value || '')}`);
        allContracts.value = data || [];
      } catch(e) { $toast('查询合约失败', 'error'); }
    }
    function exportContracts() {
      $exportCSV(['合约代码','交易所','名称','品种','乘数','最小变动','最小手数','网关'],
        filteredContracts.value.map(c => [c.vt_symbol, c.exchange, c.name, c.product, c.size, c.pricetick, c.min_volume, c.gateway_name]),
        `contracts_${new Date().toISOString().slice(0,10)}.csv`);
    }

    async function onDlExchange() { dl.product=''; dlContracts.value=[]; if(dl.exchange) { try { dlProducts.value = await $apiGet(`/api/contracts/products?exchange=${dl.exchange}`) || []; } catch(e){} } }
    async function onDlProduct() { dl.symbol=''; if(dl.product) { try { dlContracts.value = await $apiGet(`/api/contracts/public?exchange=${dl.exchange}&product=${dl.product}`) || []; } catch(e){} } }
    function startDownload() {
      if (!dl.symbol) return $toast('请选择合约', 'error');
      dl.downloading = true; dl.progress = 0;
      const parts = dl.symbol.split('.');
      $wsSend({ action: 'download_bar_data', payload: { symbol: parts[0], exchange: parts[1]||dl.exchange, interval: dl.interval, start: dl.start, end: dl.end } });
      // Simulate progress (server doesn't push progress yet)
      const timer = setInterval(() => { if(dl.progress < 90) dl.progress += 10; else clearInterval(timer); }, 500);
      setTimeout(() => { dl.downloading = false; dl.progress = 100; clearInterval(timer); $toast('下载完成', 'success'); }, 8000);
    }
    function refreshOverview() { $wsSend({ action: 'get_data_overview' }); }

    onMounted(() => { refreshOverview(); });

    return { contractFilter, allContracts, dl, dlProducts, dlContracts, exchanges, filteredContracts,
      queryContracts, exportContracts, onDlExchange, onDlProduct, startDownload, refreshOverview };
  }
};
```

- [ ] **Step 2: Verify Data Manager tab**

Test contract query, download form cascade, overview refresh.

---

### Task 6: Tab 3 — 策略 (Strategy)

**Files:**
- Create: `deepquant_web/static/js/tab-strategy.js`

**Interfaces:**
- Produces: `TabStrategy` Vue component (global)
- Consumes: `$s.strategies`, `$wsSend`, `$apiGet`

- [ ] **Step 1: Write TabStrategy component**

```javascript
// ===== Tab 3: 策略 =====
const TabStrategy = {
  template: `
    <div style="display:flex;flex-direction:column;flex:1;overflow-y:auto;padding:8px;gap:8px">
      <!-- CTA Strategy Management -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">⚙️ CTA 策略管理</span>
          <div style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-sm btn-primary" @click="showAddModal = true">+ 添加</button>
            <button class="btn btn-sm" @click="refreshStrategies">刷新</button>
          </div>
        </div>
        <div class="panel-body" style="display:flex;flex-wrap:wrap;gap:8px;padding:8px">
          <div v-for="s in $s.strategies" :key="s.strategy_name || s.id" class="strategy-card">
            <div class="sc-header">
              <span class="sc-name">{{ s.strategy_name || s.class_name }}</span>
              <span :class="'sc-status status-' + (s.status || 'STOPPED')">{{ statusText(s.status) }}</span>
            </div>
            <div class="sc-body">
              <div class="sc-row"><span>合约</span><span>{{ s.vt_symbol || '—' }}</span></div>
              <div class="sc-row"><span>类型</span><span>{{ s.class_name || '—' }}</span></div>
              <div v-if="s.parameters" class="sc-row"><span>参数</span><span>{{ JSON.stringify(s.parameters) }}</span></div>
            </div>
            <div class="sc-actions">
              <button class="btn btn-xs btn-primary" @click="initStrategy(s)" v-if="!s.status || s.status==='STOPPED'">初始化</button>
              <button class="btn btn-xs btn-long" @click="startStrategy(s)" v-if="s.status==='INITED'">启动</button>
              <button class="btn btn-xs btn-warn" @click="stopStrategy(s)" v-if="s.status==='RUNNING'">停止</button>
              <button class="btn btn-xs" @click="editStrategy(s)">编辑</button>
              <button class="btn btn-xs btn-danger" @click="removeStrategy(s)">删除</button>
            </div>
          </div>
          <div v-if="!$s.strategies || $s.strategies.length === 0" class="empty" style="width:100%;text-align:center;padding:24px;color:var(--text-dim)">
            暂无策略，点击"添加"创建
          </div>
        </div>
      </div>

      <!-- Backtest Panel -->
      <div class="panel">
        <div class="panel-header"><span class="panel-title">🔬 策略回测</span></div>
        <div style="display:flex;gap:8px;padding:8px;flex-wrap:wrap;align-items:end">
          <div class="form-row"><label>策略</label><select v-model="bt.className" class="input"><option v-for="c in $s.btClasses" :value="c">{{ c }}</option></select></div>
          <div class="form-row"><label>合约</label><input v-model="bt.vtSymbol" class="input" placeholder="如 IF2606.CFFEX"></div>
          <div class="form-row"><label>周期</label><select v-model="bt.interval" class="input"><option>1m</option><option>1h</option><option>d</option></select></div>
          <div class="form-row"><label>起始</label><input v-model="bt.start" class="input" type="date"></div>
          <div class="form-row"><label>结束</label><input v-model="bt.end" class="input" type="date"></div>
          <div class="form-row"><label>资金</label><input v-model="bt.capital" class="input" type="number" style="width:80px"></div>
          <button class="btn btn-sm btn-primary" @click="runBacktest">开始回测</button>
        </div>
        <!-- Equity Curve -->
        <div ref="equityEl" style="height:200px;margin:0 8px"></div>
        <!-- Results -->
        <div v-if="bt.result" class="panel-body" style="padding:8px">
          <table class="data-table">
            <thead><tr><th>收益率</th><th class="num">夏普</th><th class="num">最大回撤</th><th class="num">交易天数</th><th class="num">成交笔数</th></tr></thead>
            <tbody>
              <tr>
                <td :class="(bt.result.total_return||0)>=0?'up':'down'">{{ (bt.result.total_return||0).toFixed(2) }}%</td>
                <td class="num">{{ (bt.result.sharpe_ratio||0).toFixed(2) }}</td>
                <td class="num">{{ (bt.result.max_drawdown||0).toFixed(2) }}%</td>
                <td class="num">{{ bt.result.total_days||0 }}</td>
                <td class="num">{{ bt.result.total_trades||0 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- Log -->
        <div v-if="bt.logs.length" class="panel-body" style="max-height:150px;overflow:auto;padding:4px 8px;font-size:11px;font-family:var(--font-mono)">
          <div v-for="(l,i) in bt.logs" :key="i" style="color:var(--text-dim);padding:1px 0">{{ l }}</div>
        </div>
      </div>

      <!-- Add/Edit Strategy Modal -->
      <div v-if="showAddModal" class="modal-overlay" @click.self="showAddModal = false">
        <div class="modal">
          <div class="modal-header">
            <span>{{ editingStrategy ? '编辑策略' : '添加策略' }}</span>
            <button class="btn btn-xs" @click="showAddModal = false">✕</button>
          </div>
          <div class="modal-body form-grid">
            <div class="form-row"><label>策略类型</label><select v-model="newStrategy.class_name" class="input"><option v-for="c in $s.btClasses" :value="c">{{ c }}</option></select></div>
            <div class="form-row"><label>策略名称</label><input v-model="newStrategy.strategy_name" class="input"></div>
            <div class="form-row"><label>合约</label><input v-model="newStrategy.vt_symbol" class="input" placeholder="如 IF2606.CFFEX"></div>
            <div class="form-row"><label>参数 (JSON)</label><input v-model="newStrategy.paramsJson" class="input" placeholder='{"fast_window":10}'></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-sm btn-primary" @click="saveStrategy">{{ editingStrategy ? '保存' : '添加' }}</button>
          </div>
        </div>
      </div>
    </div>`,
  setup() {
    const showAddModal = ref(false);
    const editingStrategy = ref(null);
    const newStrategy = reactive({ class_name:'', strategy_name:'', vt_symbol:'', paramsJson:'{}' });
    const bt = reactive({ className:'', vtSymbol:'', interval:'d', start:'', end:'', capital:'1000000', result:null, logs:[] });
    const equityEl = ref(null);

    const statusText = s => ({ RUNNING:'运行中', INITED:'已初始化', STOPPED:'已停止', STARTING:'启动中', STOPPING:'停止中' }[s] || s || '已停止');

    function refreshStrategies() { $wsSend({ action: 'get_cta_strategies' }); $wsSend({ action: 'get_cta_classes' }); }

    function initStrategy(s) { $wsSend({ action: 'cta_strategy_init', payload: { strategy_name: s.strategy_name } }); }
    function startStrategy(s) { $wsSend({ action: 'cta_strategy_start', payload: { strategy_name: s.strategy_name } }); }
    function stopStrategy(s) { $wsSend({ action: 'cta_strategy_stop', payload: { strategy_name: s.strategy_name } }); }
    function removeStrategy(s) { if(confirm('确定删除策略 ' + s.strategy_name + '?')) $wsSend({ action: 'cta_strategy_remove', payload: { strategy_name: s.strategy_name } }); }
    function editStrategy(s) { editingStrategy.value = s; newStrategy.class_name = s.class_name; newStrategy.strategy_name = s.strategy_name; newStrategy.vt_symbol = s.vt_symbol || ''; newStrategy.paramsJson = JSON.stringify(s.parameters || {}); showAddModal.value = true; }

    function saveStrategy() {
      const params = JSON.parse(newStrategy.paramsJson || '{}');
      const payload = { class_name: newStrategy.class_name, strategy_name: newStrategy.strategy_name, vt_symbol: newStrategy.vt_symbol, parameters: params };
      $wsSend({ action: editingStrategy.value ? 'cta_strategy_edit' : 'cta_strategy_add', payload });
      showAddModal.value = false; editingStrategy.value = null;
      setTimeout(refreshStrategies, 500);
    }

    function runBacktest() {
      if (!bt.className || !bt.vtSymbol) return $toast('请填写策略和合约', 'error');
      bt.result = null; bt.logs = [];
      $wsSend({ action: 'run_backtesting', payload: { class_name: bt.className, vt_symbol: bt.vtSymbol, interval: bt.interval, start: bt.start, end: bt.end, capital: parseFloat(bt.capital) || 1000000, rate: 0.0001, slippage: 0, size: 1, pricetick: 0.01 } });
      $toast('回测已启动', 'info');
    }

    onMounted(() => { refreshStrategies(); $wsSend({ action: 'get_bt_classes' }); });

    return { showAddModal, editingStrategy, newStrategy, bt, equityEl, statusText,
      refreshStrategies, initStrategy, startStrategy, stopStrategy, removeStrategy, editStrategy, saveStrategy, runBacktest };
  }
};
```

- [ ] **Step 2: Add strategy card CSS**

```css
/* ---- Strategy Cards ---- */
.strategy-card { background:var(--bg-card); border:1px solid var(--border); border-radius:var(--radius); padding:10px; min-width:240px; max-width:320px; flex:1; }
.sc-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:6px; }
.sc-name { font-weight:600; font-size:14px; }
.sc-status { font-size:10px; padding:1px 8px; border-radius:10px; }
.status-RUNNING { background:rgba(34,197,94,0.15); color:var(--green); }
.status-INITED { background:rgba(59,130,246,0.15); color:var(--blue); }
.status-STOPPED { background:rgba(107,112,128,0.15); color:var(--text-dim); }
.sc-body { font-size:11px; color:var(--text-dim); }
.sc-row { display:flex; justify-content:space-between; padding:2px 0; }
.sc-actions { display:flex; gap:4px; margin-top:8px; flex-wrap:wrap; }
/* ---- Modal ---- */
.modal-overlay { position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.6); display:flex; align-items:center; justify-content:center; z-index:100; }
.modal { background:var(--bg-card); border-radius:var(--radius); width:400px; max-width:90vw; box-shadow:var(--shadow); }
.modal-header { display:flex; justify-content:space-between; align-items:center; padding:12px 16px; border-bottom:1px solid var(--border); font-weight:600; }
.modal-body { padding:16px; }
.modal-footer { padding:12px 16px; border-top:1px solid var(--border); display:flex; justify-content:flex-end; gap:8px; }
/* ---- Progress Bar ---- */
.progress-bar { background:var(--bg-input); border-radius:4px; overflow:hidden; height:16px; position:relative; }
.progress-fill { background:var(--accent); height:100%; transition:width 0.3s; border-radius:4px; }
```

- [ ] **Step 3: Verify Strategy tab**

Test add/edit/remove strategy lifecycle, backtest form submission.

---

### Task 7: Tab 4 — 日志 (Log)

**Files:**
- Create: `deepquant_web/static/js/tab-log.js`

- [ ] **Step 1: Write TabLog component**

```javascript
// ===== Tab 4: 日志 =====
const TabLog = {
  template: `
    <div class="panel" style="display:flex;flex-direction:column;flex:1;margin:8px;min-height:0">
      <div class="panel-header">
        <span class="panel-title">📋 实时日志</span>
        <select v-model="levelFilter" style="width:80px;margin-left:12px" class="input input-sm">
          <option value="">全部</option><option>INFO</option><option>WARN</option><option>ERROR</option>
        </select>
        <input v-model="searchText" class="input input-sm" placeholder="搜索..." style="width:150px;margin-left:4px">
        <div style="margin-left:auto;display:flex;gap:4px">
          <button class="btn btn-xs" @click="$s.logPaused = !$s.logPaused">{{ $s.logPaused ? '▶ 恢复' : '⏸ 暂停' }}</button>
          <button class="btn btn-xs" @click="clearLog">清空</button>
          <button class="btn btn-xs" @click="exportLog">CSV</button>
        </div>
      </div>
      <div class="panel-body" style="overflow:auto;flex:1;min-height:0" ref="logBody">
        <table class="data-table">
          <thead><tr>
            <th style="width:90px">时间</th>
            <th style="width:50px">级别</th>
            <th style="width:80px">来源</th>
            <th>消息</th>
          </tr></thead>
          <tbody>
            <tr v-for="(l, i) in filteredLog" :key="i" :class="'log-' + (l.level || 'INFO')">
              <td class="num" style="font-family:var(--font-mono);font-size:10px">{{ l.time }}</td>
              <td><span :class="'log-badge log-badge-' + (l.level || 'INFO')">{{ l.level || 'INFO' }}</span></td>
              <td style="font-size:11px;color:var(--text-dim)">{{ l.source }}</td>
              <td style="font-size:12px">{{ l.msg }}</td>
            </tr>
            <tr v-if="filteredLog.length === 0"><td colspan="4" class="empty">暂无日志</td></tr>
          </tbody>
        </table>
      </div>
      <div style="padding:4px 12px;font-size:10px;color:var(--text-dim);border-top:1px solid var(--border)">
        共 {{ $s.log.length }} 条，显示 {{ filteredLog.length }} 条
      </div>
    </div>`,
  setup() {
    const levelFilter = ref('');
    const searchText = ref('');
    const logBody = ref(null);

    const filteredLog = computed(() => {
      let arr = $s.log;
      if (levelFilter.value) arr = arr.filter(l => l.level === levelFilter.value);
      if (searchText.value) {
        const q = searchText.value.toLowerCase();
        arr = arr.filter(l => (l.msg||'').toLowerCase().includes(q) || (l.source||'').toLowerCase().includes(q));
      }
      return arr;
    });

    // Auto-scroll
    watch(() => $s.log.length, () => {
      if (!$s.logPaused && logBody.value) {
        nextTick(() => { logBody.value.scrollTop = logBody.value.scrollHeight; });
      }
    });

    function clearLog() { $s.log.splice(0, $s.log.length); }
    function exportLog() {
      $exportCSV(['时间','级别','来源','消息'],
        filteredLog.value.map(l => [l.time, l.level, l.source, l.msg]),
        `log_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`);
    }

    return { levelFilter, searchText, logBody, filteredLog, clearLog, exportLog };
  }
};
```

- [ ] **Step 2: Add log CSS**

```css
/* ---- Log ---- */
.log-INFO {}
.log-WARN { background:rgba(245,158,11,0.05); }
.log-ERROR { background:rgba(239,68,68,0.05); }
.log-badge { font-size:9px; padding:0 5px; border-radius:8px; font-weight:600; }
.log-badge-INFO { background:rgba(59,130,246,0.2); color:var(--blue); }
.log-badge-WARN { background:rgba(245,158,11,0.2); color:var(--orange); }
.log-badge-ERROR { background:rgba(239,68,68,0.2); color:var(--red); }
.input-sm { height:24px !important; font-size:11px !important; width:auto; }
```

- [ ] **Step 3: Verify Log tab**

Check log entries appear, filter by level, search text, pause/resume.

---

### Task 8: Tab 5 — 设置 (Settings)

**Files:**
- Create: `deepquant_web/static/js/tab-settings.js`

- [ ] **Step 1: Write TabSettings component**

```javascript
// ===== Tab 5: 设置 =====
const TabSettings = {
  template: `
    <div style="display:flex;flex-direction:column;flex:1;overflow-y:auto;padding:8px;gap:8px">
      <!-- Gateway Connection -->
      <div class="panel">
        <div class="panel-header"><span class="panel-title">🔌 网关连接</span></div>
        <div class="panel-body" style="padding:8px;display:flex;flex-direction:column;gap:8px">
          <div class="form-row"><label>网关</label><select v-model="gw.gateway" @change="onGatewayChange" class="input"><option value="">选择网关</option><option v-for="g in $s.gateways" :value="g">{{ g }}</option></select></div>
          <div v-if="gw.gateway" class="form-grid">
            <div v-for="(v, k) in gw.settings" :key="k" class="form-row">
              <label>{{ k }}</label>
              <input v-model="gw.settings[k]" class="input" :type="k.toLowerCase().includes('password') ? 'password' : 'text'">
            </div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn btn-sm btn-primary" @click="connectGateway">连接</button>
              <button class="btn btn-sm btn-danger" @click="disconnectGateway">断开</button>
            </div>
          </div>
          <!-- Saved Accounts -->
          <div style="margin-top:8px">
            <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:4px">已存账户</div>
            <table class="data-table">
              <thead><tr><th>别名</th><th>网关</th><th>用户名</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="a in $s.gatewayAccounts" :key="a.id || a.alias">
                  <td>{{ a.alias }}</td><td>{{ a.gateway }}</td><td>{{ a.username || '—' }}</td>
                  <td>
                    <button class="btn btn-xs" @click="loadAccount(a)">加载</button>
                    <button class="btn btn-xs btn-danger" @click="deleteAccount(a)">删除</button>
                  </td>
                </tr>
                <tr v-if="!$s.gatewayAccounts || $s.gatewayAccounts.length === 0"><td colspan="4" class="empty">无已存账户</td></tr>
              </tbody>
            </table>
            <button class="btn btn-sm" @click="saveCurrentAccount" style="margin-top:4px" :disabled="!gw.gateway">保存当前账户</button>
          </div>
        </div>
      </div>

      <!-- Account Table -->
      <div class="panel">
        <div class="panel-header"><span class="panel-title">💰 账户列表</span></div>
        <div class="panel-body" style="overflow:auto">
          <table class="data-table">
            <thead><tr><th>账户ID</th><th class="num">余额</th><th class="num">冻结</th><th class="num">可用</th><th>网关</th></tr></thead>
            <tbody>
              <tr v-for="a in accountList" :key="a.vt_accountid">
                <td>{{ a.vt_accountid }}</td><td class="num">{{ $fmtPrice(a.balance) }}</td>
                <td class="num">{{ $fmtPrice(a.frozen) }}</td><td class="num">{{ $fmtPrice(a.available) }}</td>
                <td>{{ a.gateway_name }}</td>
              </tr>
              <tr v-if="accountList.length === 0"><td colspan="5" class="empty">暂无账户</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Global Config -->
      <div class="panel">
        <div class="panel-header"><span class="panel-title">⚙️ 全局配置</span></div>
        <div class="panel-body form-grid" style="padding:8px">
          <div class="form-row"><label>字体</label><select v-model="cfg.font" class="input"><option>PingFang SC</option><option>Microsoft YaHei</option><option>Inter</option></select></div>
          <div class="form-row"><label>字号</label><input v-model="cfg.fontSize" class="input" type="number" min="10" max="18"></div>
          <div class="form-row"><label>主题</label><select v-model="cfg.theme" class="input"><option value="dark">暗色</option><option value="light">亮色</option></select></div>
          <div class="form-row"><label>交易所可见性</label>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px">
              <label v-for="ex in exchanges" :key="ex.value" class="checkbox-label">
                <input type="checkbox" :checked="cfg.visibleExchanges[ex.value]" @change="cfg.visibleExchanges[ex.value] = $event.target.checked" style="width:auto">
                {{ ex.name }}
              </label>
            </div>
          </div>
          <button class="btn btn-sm btn-primary" @click="saveConfig" style="margin-top:8px">保存配置</button>
        </div>
      </div>
    </div>`,
  setup() {
    const gw = reactive({ gateway:'', settings:{} });
    const cfg = reactive({ font:'PingFang SC', fontSize:12, theme:'dark', visibleExchanges:{CFFEX:true,SHFE:true,DCE:true,CZCE:true,INE:true,GFEX:true} });
    const exchanges = [
      { value:'CFFEX', name:'中金所' }, { value:'SHFE', name:'上期所' },
      { value:'DCE', name:'大商所' }, { value:'CZCE', name:'郑商所' },
      { value:'INE', name:'上海能源' }, { value:'GFEX', name:'广期所' },
    ];
    const accountList = computed(() => Object.values($s.account));

    // Load config from localStorage
    function loadConfig() {
      try {
        const saved = JSON.parse(localStorage.getItem('deepquant_config') || '{}');
        if (saved.font) cfg.font = saved.font;
        if (saved.fontSize) cfg.fontSize = saved.fontSize;
        if (saved.theme) cfg.theme = saved.theme;
        if (saved.visibleExchanges) cfg.visibleExchanges = saved.visibleExchanges;
      } catch(e){}
    }
    function saveConfig() {
      localStorage.setItem('deepquant_config', JSON.stringify({ font:cfg.font, fontSize:cfg.fontSize, theme:cfg.theme, visibleExchanges:cfg.visibleExchanges }));
      $toast('配置已保存', 'success');
      // Apply theme
      if (cfg.theme === 'light') document.body.classList.add('theme-light');
      else document.body.classList.remove('theme-light');
    }

    async function onGatewayChange() {
      gw.settings = {};
      if (!gw.gateway) return;
      try {
        const setting = await $apiGet(`/api/gateway-settings?gateway=${gw.gateway}`);
        gw.settings = setting || {};
      } catch(e){ $toast('加载网关设置失败', 'error'); }
    }
    function connectGateway() {
      if (!gw.gateway) return;
      $wsSend({ action: 'connect_gateway', payload: { gateway_name: gw.gateway, setting: gw.settings } });
      $toast(`正在连接 ${gw.gateway}...`, 'info');
    }
    function disconnectGateway() {
      if (!gw.gateway) return;
      $wsSend({ action: 'disconnect_gateway', payload: { gateway_name: gw.gateway } });
      $toast(`已断开 ${gw.gateway}`, 'info');
    }
    function loadAccount(a) {
      gw.gateway = a.gateway;
      try { gw.settings = JSON.parse(a.setting_json || '{}'); } catch(e){ gw.settings = {}; }
    }
    async function deleteAccount(a) {
      if (!confirm('确定删除账户 ' + a.alias + '?')) return;
      await $deleteGatewayAccount(a.id || a.alias);
      $toast('已删除', 'info');
    }
    async function saveCurrentAccount() {
      const alias = prompt('请输入账户别名:');
      if (!alias) return;
      await $saveGatewayAccount(alias, gw.gateway, gw.settings);
      $toast('已保存', 'success');
    }

    onMounted(async () => {
      loadConfig();
      $wsSend({ action: 'get_gateways' });
      await $loadGatewayAccounts();
    });

    return { gw, cfg, exchanges, accountList, loadConfig, saveConfig, onGatewayChange,
      connectGateway, disconnectGateway, loadAccount, deleteAccount, saveCurrentAccount };
  }
};
```

- [ ] **Step 2: Verify Settings tab**

Test gateway select → dynamic form, connect/disconnect, save/load account, config persist to localStorage.

---

### Task 9: Integration — Full system test

**Files:** None new — verify all tabs work together.

- [ ] **Step 1: Start server + web and verify all tabs**

```bash
# Terminal 1: Server
cd deepquant_server && ../../deepquant/.venv/bin/python run.py

# Terminal 2: Web
cd deepquant_web && ../../deepquant/.venv/bin/python run.py
```

- [ ] **Step 2: Verify tab switching preserves state**

Click through all 5 tabs. Verify:
- Tab 1: KLine + depth + trade form all functional
- Tab 2: Contract query works
- Tab 3: Strategy CRUD works
- Tab 4: Log flow continues regardless of active tab
- Tab 5: Gateway settings persist

- [ ] **Step 3: Verify WebSocket reconnection**

Kill and restart server. Verify web auto-reconnects and data resumes.

- [ ] **Step 4: Commit final state**

```bash
git add deepquant_web/
git commit -m "feat: rebuild web frontend with 5-tab parity to desktop GUI"
```
