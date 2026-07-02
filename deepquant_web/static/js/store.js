// ===== DeepQuant Vue Store — Reactive state + WebSocket + API =====
const { reactive, ref, computed, watch, toRaw, onMounted, onUnmounted, nextTick, createApp } = Vue;

// ---- Config ----
const API_BASE = (() => {
  const p = new URLSearchParams(location.search);
  if (p.get('api')) return p.get('api');
  return `http://${location.hostname}:8888`;
})();

// ---- Reactive Store ----
const store = reactive({
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
  connectedGateways: [],   // CTP connection status from server
  activeAccount: '',       // currently connected account alias
});

// ---- WebSocket ----
let _ws = null, _pending = [];

function $wsConnect() {
  const wsUrl = API_BASE.replace(/^http/, 'ws') + '/ws';
  _ws = new WebSocket(wsUrl);
  _ws.onopen = () => {
    store.wsReconnect = 0;
    store.wsStatus = true;
    _pending.forEach(m => { try { _ws.send(m); } catch(e) {} });
    _pending = [];
    $wsSend({ action: 'subscribe_all' });
  };
  _ws.onclose = () => {
    store.wsStatus = false;
    const delay = Math.min(1000 * ++store.wsReconnect, 10000);
    setTimeout($wsConnect, delay);
  };
  _ws.onerror = () => _ws.close();
  _ws.onmessage = _onWsMessage;
}

function $wsSend(data) {
  const msg = JSON.stringify(data);
  if (_ws && _ws.readyState === 1) { _ws.send(msg); }
  else { _pending.push(msg); }
}

function _onWsMessage(e) {
  try {
    const msg = JSON.parse(e.data);
    const { type, data } = msg;
    if (!type) return;

    if (type === 'tick' && data) {
      store.tick[data.vt_symbol] = data;
    } else if (type === 'order' && data) {
      store.order[data.orderid || data.vt_orderid] = data;
    } else if (type === 'trade' && data) {
      store.trade[data.tradeid || data.vt_tradeid] = data;
    } else if (type === 'position' && data) {
      store.position[data.vt_positionid || data.symbol] = data;
    } else if (type === 'account' && data) {
      store.account[data.vt_accountid || data.accountid] = data;
    } else if (type === 'contract' && data) {
      store.contract[data.vt_symbol] = data;
    } else if (type === 'log') {
      const entry = typeof data === 'string' ? { msg: data, time: new Date().toLocaleTimeString() } : data;
      store.log.push(entry);
      if (store.log.length > store.maxLog) store.log.splice(0, store.log.length - store.maxLog);
    } else if (type === 'eLog' && data) {
      const entry = typeof data === 'string'
        ? { time: new Date().toLocaleTimeString('zh-CN', { hour12: false }), level: 'INFO', source: '', msg: data }
        : { time: data.time || data.msg?.time || new Date().toLocaleTimeString('zh-CN', { hour12: false }),
            level: data.level || 'INFO', source: data.source || data.gateway_name || '',
            msg: data.msg || (typeof data === 'string' ? data : JSON.stringify(data)) };
      if (!store.logPaused) {
        store.log.push(entry);
        if (store.log.length > store.maxLog) store.log.splice(0, store.log.length - store.maxLog);
      }
    } else if (type === 'cta_strategies' && Array.isArray(data)) {
      store.strategies = data;
    } else if (type === 'bt_classes' && Array.isArray(data)) {
      store.btClasses = data;
    } else if (type === 'data_overview' && Array.isArray(data)) {
      store.dataOverview = data;
    } else if (type === 'gateway_list' && Array.isArray(data)) {
      store.gateways = data;
    } else if (type === 'gateway_accounts' && Array.isArray(data)) {
      store.gatewayAccounts = data;
    } else if (type === 'strategy_logs' && data) {
      const e = typeof data === 'string' ? { msg: data, time: new Date().toLocaleTimeString() } : data;
      if (!store.logPaused) {
        store.log.push({ time: e.time || new Date().toLocaleTimeString(), level: 'INFO', source: 'STRATEGY', msg: e.msg || JSON.stringify(e) });
        if (store.log.length > store.maxLog) store.log.splice(0, store.log.length - store.maxLog);
      }
    }
  } catch (err) {
    console.error('WS parse error:', err);
  }
}

// ---- API Helpers ----
async function $apiGet(path) {
  const r = await fetch(API_BASE + path);
  if (!r.ok) throw new Error(`API ${path} returned ${r.status}`);
  return r.json();
}

async function $apiPost(path, body) {
  const r = await fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`API ${path} returned ${r.status}`);
  return r.json();
}

// ---- Formatters ----
function $fmtPrice(v, decimals) {
  if (v == null) return '-';
  if (decimals == null) decimals = 2;
  return Number(v).toFixed(decimals);
}

function $fmtVol(v) {
  if (v == null) return '-';
  return Number(v).toLocaleString();
}

function $fmtPnl(v) {
  if (v == null) return '-';
  const n = Number(v);
  return { text: (n >= 0 ? '+' : '') + n.toFixed(2), cls: n > 0 ? 'up' : (n < 0 ? 'down' : '') };
}

function $timeStr(ts) {
  if (!ts) return '';
  if (typeof ts === 'string') return ts.slice(-8);
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

// ---- Toast ----
function $toast(msg, type) {
  const el = document.createElement('div');
  el.className = `toast ${type || ''}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 2500);
}

// ---- REST actions (replace WS for operations, keep WS only for event stream) ----
async function $restConnectAccount(accountId) {
  try {
    const r = await $apiPost('/api/gateway-accounts/' + accountId + '/connect', {});
    if (r.error) { $toast(r.error, 'error'); return false; }
    $toast('连接成功', 'success');
    return true;
  } catch(e) { $toast('连接失败', 'error'); return false; }
}

async function $restDisconnectAccount(accountId) {
  try {
    await $apiPost('/api/gateway-accounts/' + accountId + '/disconnect', {});
    $toast('已断开', 'info');
  } catch(e) { $toast('断开失败', 'error'); }
}

async function $restSendOrder(order) {
  try {
    const r = await $apiPost('/api/orders', order);
    if (r.vt_orderid) { $toast('订单已提交: ' + r.vt_orderid, 'success'); return r; }
    $toast('下单失败', 'error'); return null;
  } catch(e) { $toast('下单失败', 'error'); return null; }
}

async function $restCancelOrder(orderid, symbol, exchange, gateway) {
  try {
    await $apiGet('/api/orders/' + orderid + '?symbol=' + encodeURIComponent(symbol) + '&exchange=' + exchange + '&gateway=' + (gateway || ''));
  } catch(e) { /* silent */ }
}

async function $restSubscribe(symbol, exchange, gateway) {
  try {
    await $apiPost('/api/subscribe', { symbol, exchange, gateway: gateway || '' });
  } catch(e) { /* silent */ }
}

// ---- Contract Expiry ----
function isExpired(code) {
  const m = code.match(/[A-Z]+(\d{2})(\d{2})$/);
  if (!m) return false;
  const yy = parseInt(m[1]), mm = parseInt(m[2]);
  const fullYy = yy < 50 ? 2000 + yy : 1900 + yy;
  const expiry = fullYy * 100 + mm;
  const now = new Date();
  return expiry < now.getFullYear() * 100 + (now.getMonth() + 1);
}

// ---- Gateway Account CRUD ----
async function $loadGatewayAccounts() {
  try { store.gatewayAccounts = await $apiGet('/api/gateway-accounts') || []; } catch(e) { console.error('load gateway accounts:', e); }
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

// ---- Clock ----
setInterval(() => {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
}, 1000);

// ---- Periodic server status poll (gateway connection state) ----
async function $pollStatus() {
  try {
    const data = await $apiGet('/api/status');
    store.connectedGateways = data.gateways || [];
    store.activeAccount = data.active_account || '';
  } catch(e) {}
}
setInterval($pollStatus, 5000);  // Poll every 5 seconds

// ---- Init WS on load ----
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => { $wsConnect(); $pollStatus(); });
}
