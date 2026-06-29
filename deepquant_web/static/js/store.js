// ===== DeepQuant Vue Store — Reactive state + WebSocket + API =====
const { reactive, ref, computed, watch, toRaw } = Vue;

// ---- Config ----
const API_BASE = (() => {
  const p = new URLSearchParams(location.search);
  if (p.get('api')) return p.get('api');
  return `http://${location.hostname}:8888`;
})();

// ---- Reactive Store ----
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
  maxLog: 200,
});

// ---- WebSocket ----
let _ws = null, _pending = [];

function $wsConnect() {
  const wsUrl = API_BASE.replace(/^http/, 'ws') + '/ws';
  _ws = new WebSocket(wsUrl);
  _ws.onopen = () => {
    $s.wsReconnect = 0;
    $s.wsStatus = true;
    _pending.forEach(m => { try { _ws.send(m); } catch(e) {} });
    _pending = [];
    $wsSend({ action: 'subscribe_all' });
  };
  _ws.onclose = () => {
    $s.wsStatus = false;
    const delay = Math.min(1000 * ++$s.wsReconnect, 10000);
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
      $s.tick[data.vt_symbol] = data;
    } else if (type === 'order' && data) {
      $s.order[data.orderid || data.vt_orderid] = data;
    } else if (type === 'trade' && data) {
      $s.trade[data.tradeid || data.vt_tradeid] = data;
    } else if (type === 'position' && data) {
      $s.position[data.vt_positionid || data.symbol] = data;
    } else if (type === 'account' && data) {
      $s.account[data.vt_accountid || data.accountid] = data;
    } else if (type === 'contract' && data) {
      $s.contract[data.vt_symbol] = data;
    } else if (type === 'log') {
      const entry = typeof data === 'string' ? { msg: data, time: new Date().toLocaleTimeString() } : data;
      $s.log.push(entry);
      if ($s.log.length > $s.maxLog) $s.log.splice(0, $s.log.length - $s.maxLog);
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

// ---- Clock ----
setInterval(() => {
  const el = document.getElementById('clock');
  if (el) el.textContent = new Date().toLocaleTimeString('zh-CN', { hour12: false });
}, 1000);

// ---- Init WS on load ----
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => $wsConnect());
}
