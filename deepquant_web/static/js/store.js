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
  ctaClasses: [],
  btClasses: [],
  backtestResult: null,
  backtestPanelResult: null,  // 抽屉内持久展示，直到下次运行回测
  backtestError: null,
  backtestSessionId: null,
  backtestPendingSession: null,
  backtestProgress: null,
  backtestLogs: [],
  backtestSaves: {},
  backtestLastSaved: null,
  backtestSettings: null,
  _btSettingsPendingSave: false,
  ctaParamSchemas: {},
  strategyLogs: [],
  lastCtaAction: null,
  strategySummary: null,
  strategyPreflight: {},
  dataOverview: [],
  dataOverviewTicks: [],
  dataSubTab: 'local',
  dataSelection: null,
  dataSelectedKey: '',
  dataTasks: [],
  dataManagerAvailable: false,
  dataDeepLink: null,
  recorderStatus: null,
  dataTree: [],
  dataHealth: null,
  dataOptionCatalog: [],
  dataListedCatalog: [],
  dataIncludeListedOptions: true,
  lastStrategyDataError: null,
  dataPreviewRevision: 0,
  dataGapPanelVisible: false,
  dataGapScanning: false,
  dataGapRows: [],
  dataTaskBarExpanded: true,
  logPaused: false,
  connectedGateways: [],   // CTP connection status from server
  activeAccount: '',       // currently connected account alias
  tickStream: {},          // vt_symbol → 最近逐笔 ring buffer（仅 UI）
  tickPulse: { vt: '', dir: 'up', n: 0 }, // 最近一次 tick 更新的合约（供闪烁/图表增量）
  banner: '',              // 顶栏 persistent 告警文案
  tickLatencyMs: null,     // 最近 tick 延迟毫秒
  backtestMarkers: [],     // 回测买卖点标注
});

function _ensureVtSymbol(data) {
  if (!data) return data;
  if (!data.vt_symbol && data.symbol && data.exchange) {
    data.vt_symbol = `${data.symbol}.${data.exchange}`;
  }
  return data;
}

function $queryTradingSnapshot() {
  const gws = store.connectedGateways || [];
  gws.forEach(gw => {
    $wsSend({ action: 'query_account', payload: { gateway: gw } });
    $wsSend({ action: 'query_position', payload: { gateway: gw } });
  });
}

function $invokeWatchlistSubscribe() {
  if (typeof $autoSubscribeWatchlist === 'function') $autoSubscribeWatchlist();
}

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
    $hydrateTicks();
    $invokeWatchlistSubscribe();
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
      const t = $storeTick(data);
      if (!t) return;
      if (typeof $recordTickLatency === 'function') $recordTickLatency(t);
      if (typeof $appendTickStream === 'function') $appendTickStream(t);
    } else if (type === 'order' && data) {
      const o = _ensureVtSymbol(data);
      store.order[o.orderid || o.vt_orderid] = o;
    } else if (type === 'trade' && data) {
      const tr = _ensureVtSymbol(data);
      store.trade[tr.tradeid || tr.vt_tradeid] = tr;
    } else if (type === 'position' && data) {
      const p = _ensureVtSymbol(data);
      store.position[p.vt_positionid || p.vt_symbol || p.symbol] = p;
    } else if (type === 'account' && data) {
      store.account[data.vt_accountid || data.accountid || data.gateway_name] = data;
    } else if (type === 'contract' && data) {
      const c = _ensureVtSymbol(data);
      store.contract[c.vt_symbol] = c;
      if (c.name && typeof $setContractNameIfBetter === 'function') {
        $setContractNameIfBetter(c.vt_symbol, c.name);
      }
    } else if (type === 'log') {
      const entry = typeof data === 'string' ? { msg: data, time: new Date().toLocaleTimeString() } : data;
      store.log.push(entry);
      if (store.log.length > store.maxLog) store.log.splice(0, store.log.length - store.maxLog);
      $trackDataManagerLog(entry);
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
    } else if (type === 'strategy_summary' && data) {
      store.strategySummary = data;
    } else if (type === 'strategy_preflight') {
      const name = msg.strategy_name || data?.strategy_name || '';
      if (name && data) store.strategyPreflight[name] = data;
    } else if (type === 'cta_classes' && Array.isArray(data)) {
      store.ctaClasses = data;
    } else if (type === 'bt_classes' && Array.isArray(data)) {
      store.btClasses = data;
    } else if (type === 'backtestResult' && data) {
      store.backtestResult = data;
      store.backtestPanelResult = data;
      store.backtestProgress = null;
      store.backtestSessionId = data.session_id || store.backtestPendingSession;
      store.backtestPendingSession = null;
      $applyBacktestMarkers(data);
    } else if (type === 'backtestError') {
      store.backtestError = typeof data === 'string' ? data : (data?.msg || JSON.stringify(data));
      store.backtestProgress = null;
      store.backtestPendingSession = null;
    } else if (type === 'backtestProgress' && data) {
      store.backtestProgress = data;
    } else if (type === 'backtest_saves') {
      const name = msg.strategy_name || '';
      if (name) store.backtestSaves[name] = Array.isArray(data) ? data : [];
    } else if (type === 'backtest_save_saved') {
      const name = msg.strategy_name || '';
      if (name && data && !data.error) {
        const list = (store.backtestSaves[name] || []).filter(s => s.id !== data.id);
        store.backtestSaves[name] = [data, ...list];
        store.backtestLastSaved = { strategy_name: name, save_id: data.id };
        $toast('回测结果已保存', 'success');
      } else if (data?.error) {
        $toast(data.error, 'error');
      }
    } else if (type === 'backtest_save_loaded') {
      if (data?.error) {
        $toast(data.error, 'error');
      } else if (data) {
        store.backtestPanelResult = data;
      }
    } else if (type === 'backtest_save_deleted') {
      const name = msg.strategy_name || '';
      if (name && data?.deleted) {
        store.backtestSaves[name] = (store.backtestSaves[name] || []).filter(s => s.id !== data.deleted);
        if (data.error) $toast(data.error, 'error');
        else $toast(data.promoted_active_id ? '已删除，已回退验证基准' : '回测记录已删除', 'success');
      } else if (data?.error) {
        $toast(data.error, 'error');
      }
    } else if (type === 'backtest_active_set') {
      const name = msg.strategy_name || '';
      if (data?.error) {
        $toast(data.error, 'error');
      } else if (name) {
        $toast('已设为验证基准', 'success');
        $wsSend({ action: 'get_cta_strategies' });
        $wsSend({ action: 'get_strategy_preflight', payload: { strategy_name: name } });
        $wsSend({ action: 'list_backtest_saves', payload: { strategy_name: name } });
      }
    } else if (type === 'backtest_settings' && data) {
      store.backtestSettings = data;
      if (store._btSettingsPendingSave) {
        store._btSettingsPendingSave = false;
        $toast('回测数据策略已保存', 'success');
      }
    } else if (type === 'backtest_export') {
      if (data?.error) {
        $toast(data.error, 'error');
      } else if (data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backtest_${data.strategy_name || 'export'}_${data.save_id || ''}.json`;
        a.click();
        URL.revokeObjectURL(url);
        $toast('回测报告已导出', 'success');
      }
    } else if (type === 'eBacktesterLog') {
      const msg = typeof data === 'string' ? data : (data?.msg || String(data || ''));
      if (!msg.trim()) return;
      store.backtestLogs.push({
        time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
        msg,
      });
      if (store.backtestLogs.length > 300) store.backtestLogs.splice(0, store.backtestLogs.length - 300);
      if (store.backtestProgress) {
        const step = $btInferStepFromLog(msg);
        if (step) store.backtestProgress.phase = step;
        store.backtestProgress.lastLog = msg;
      }
    } else if (type === 'data_overview' && Array.isArray(data)) {
      store.dataOverview = data;
      $rebuildDataTree();
      $syncDataTreeSelection();
      store.dataPreviewRevision += 1;
    } else if (type === 'tick_overview' && Array.isArray(data)) {
      store.dataOverviewTicks = data;
      $rebuildDataTree();
    } else if (type === 'data_task' && data) {
      $applyDataTask(data);
    } else if (type === 'cta_action_result' && data) {
      store.lastCtaAction = data;
      if (data.error) $toast(data.error, 'error');
      else if (data.message) $toast(data.message, 'success');
    } else if (type === 'cta_batch_result' && data) {
      const errs = (data.results || []).filter(r => r.error);
      if (errs.length) $toast(`批量操作: ${errs.length} 项失败`, 'error');
      else $toast('批量操作完成', 'success');
    } else if (type === 'cta_params') {
      const cn = msg.class_name;
      if (cn && data) store.ctaParamSchemas[cn] = data;
    } else if (type === 'cta_init_result' && data) {
      if (data.error) {
        $toast(data.error, 'error');
        if (String(data.error).includes('历史数据')) {
          store.lastStrategyDataError = data;
          if (data.vt_symbol) {
            $queueAutoDataUpdate(data.vt_symbol, ['1m', 'd'], 'high');
            $toast('已自动排队下载历史数据', 'info');
          }
        }
      } else {
        store.lastStrategyDataError = null;
        $toast(data.message || '策略初始化成功', 'success');
      }
    } else if (type === 'gateway_list' && Array.isArray(data)) {
      store.gateways = data;
    } else if (type === 'gateway_accounts' && Array.isArray(data)) {
      store.gatewayAccounts = data;
    } else if (type === 'strategy_logs') {
      store.strategyLogs = Array.isArray(data) ? data : [];
      const e = typeof data === 'string' ? { msg: data, time: new Date().toLocaleTimeString() } : (Array.isArray(data) ? null : data);
      if (e && !store.logPaused) {
        store.log.push({ time: e.time || new Date().toLocaleTimeString(), level: 'INFO', source: 'STRATEGY', msg: e.msg || JSON.stringify(e) });
        if (store.log.length > store.maxLog) store.log.splice(0, store.log.length - store.maxLog);
      } else if (Array.isArray(data)) {
        data.slice(-5).forEach(row => {
          if (!store.logPaused) {
            store.log.push({
              time: (row.created_at || '').slice(11, 19) || new Date().toLocaleTimeString(),
              level: row.level || 'INFO',
              source: 'STRATEGY',
              msg: `[${row.strategy_name}] ${row.message}`,
            });
          }
        });
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

async function $apiDelete(path) {
  const r = await fetch(API_BASE + path, { method: 'DELETE' });
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
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) {
    const m = String(ts).match(/T(\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : String(ts);
  }
  const pad = n => String(n).padStart(2, '0');
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const time = `${hh}:${mm}:${ss}`;
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (isToday) return time;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

/** 逐笔时间：HH:mm:ss.SSS，非当日加 MM-DD 前缀 */
function $tickTimeStr(ts) {
  if (!ts) return '';
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) {
    const m = String(ts).match(/T(\d{2}:\d{2}:\d{2})/);
    return m ? m[1] : String(ts);
  }
  const pad = n => String(n).padStart(2, '0');
  const hh = pad(d.getHours());
  const mm = pad(d.getMinutes());
  const ss = pad(d.getSeconds());
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  const time = `${hh}:${mm}:${ss}.${ms}`;
  const now = new Date();
  const isToday = d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
  if (isToday) return time;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${time}`;
}

// ---- Toast ----
const _dataTaskNotified = new Set();

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
    await $pollStatus();
    $queryTradingSnapshot();
    $invokeWatchlistSubscribe();
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
    const q = new URLSearchParams({
      symbol: symbol || '',
      exchange: exchange || '',
      gateway: gateway || '',
    });
    await $apiDelete('/api/orders/' + encodeURIComponent(orderid) + '?' + q.toString());
  } catch(e) { $toast('撤单失败', 'error'); }
}

async function $restSubscribe(symbol, exchange, gateway) {
  try {
    const r = await $apiPost('/api/subscribe', { symbol, exchange, gateway: gateway || '' });
    if (r?.error) {
      console.warn('subscribe failed:', symbol, exchange, r.error);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('subscribe error:', symbol, exchange, e);
    return false;
  }
}

async function $hydrateTicks() {
  try {
    const data = await $apiGet('/api/ticks');
    (data?.ticks || []).forEach(t => $storeTick(t));
  } catch (e) { /* gateway offline */ }
}

// ---- Contract Expiry ----
function isExpired(code) {
  const upper = (code || '').split('.')[0].toUpperCase();
  let m = upper.match(/^[A-Z]+(\d{2})(\d{2})$/);
  if (!m) m = upper.match(/^[A-Z]+(\d{2})(\d{2})-/);
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
  await $apiPost('/api/gateway-accounts', { alias, gateway, setting });
  await $loadGatewayAccounts();
}

async function $deleteGatewayAccount(id) {
  await $apiDelete('/api/gateway-accounts/' + encodeURIComponent(id));
  await $loadGatewayAccounts();
}

// ---- Data management helpers ----
function $applyDataTask(task) {
  if (!task?.id) return;
  const idx = store.dataTasks.findIndex(t => t.id === task.id);
  const prev = idx >= 0 ? store.dataTasks[idx] : null;
  const row = { ...task };
  if (idx >= 0) store.dataTasks[idx] = { ...prev, ...row };
  else {
    store.dataTasks.unshift(row);
    if (row.status === 'running') store.dataTaskBarExpanded = true;
  }
  if (store.dataTasks.length > 30) store.dataTasks.length = 30;

  const isBatchProgress = task.status === 'running' && task.progress?.total > 0;
  const batchTotal = prev?.progress?.total || task.progress?.total;
  const isBatchDone = task.status === 'success' && batchTotal > 0;

  if (task.status === 'success') {
    const shouldToast = !isBatchProgress
      && (!isBatchDone || task.progress?.current === task.progress?.total);
    const notifyKey = `${task.id}:success`;
    if (shouldToast && !_dataTaskNotified.has(notifyKey)) {
      _dataTaskNotified.add(notifyKey);
      $toast(task.message || `${task.label} 完成`, 'success');
    }
    $loadDataOverviewRest().then(() => {
      $syncDataTreeSelection();
      store.dataPreviewRevision += 1;
    });
  } else if (task.status === 'error' && !isBatchProgress) {
    const notifyKey = `${task.id}:error`;
    if (!_dataTaskNotified.has(notifyKey)) {
      _dataTaskNotified.add(notifyKey);
      $toast(task.message || `${task.label} 失败`, 'error');
    }
  }
}

function $trackDataManagerLog(entry) {
  // 任务完成/失败由 data_task 事件统一通知；日志不再重复触发 toast
  void entry;
}

function $selectDataNode(node) {
  if (!node) return;
  store.dataSelectedKey = $dataNodeKey(node);
  store.dataSelection = node;
}

function $syncDataTreeSelection() {
  const key = store.dataSelectedKey;
  if (!key || !store.dataTree?.length) return;
  const node = $resyncDataSelection(store.dataTree, key);
  if (node) store.dataSelection = node;
}

function $ensureDataTreeSelection() {
  if (store.dataSelectedKey) {
    $syncDataTreeSelection();
    return;
  }
  const leaves = $flattenDataLeaves(store.dataTree);
  const withData = leaves.find(l => !l.catalogOnly && l.count > 0);
  if (withData) $selectDataNode(withData);
  else if (leaves.length) $selectDataNode(leaves.find(l => !l.catalogOnly) || leaves[0]);
}

function $rebuildDataTree() {
  store.dataTree = $buildDataTree(
    store.dataOverview,
    store.dataOverviewTicks,
    store.dataSelectedKey,
    store.dataListedCatalog,
    store.dataIncludeListedOptions,
  );
  $preloadDataTreeNames(store.dataTree);
  $syncDataTreeSelection();
}

async function $loadListedCatalog() {
  try {
    const list = await $fetchPublicContracts();
    store.dataListedCatalog = list.map(c => ({
      symbol: c.symbol,
      exchange: c.exchange_code || (c.vt_symbol || '').split('.').pop() || '',
      vt_symbol: c.vt_symbol || `${c.symbol}.${c.exchange_code || ''}`,
      name: c.name || '',
      listed: c.listed !== false,
    }));
    store.dataOptionCatalog = store.dataListedCatalog.filter(c =>
      (typeof $isCffexIndexOptionSymbol === 'function'
        ? $isCffexIndexOptionSymbol(c.symbol)
        : /^(IO|HO|MO)/i.test(c.symbol || ''))
    );
    return store.dataListedCatalog;
  } catch (e) {
    return store.dataListedCatalog;
  }
}

async function $loadCffexOptionCatalog() {
  return $loadListedCatalog();
}

function $refreshDataOverview() {
  $wsSend({ action: 'get_data_overview' });
}

async function $loadDataHealth() {
  try {
    const h = await $apiGet('/api/data/health');
    store.dataManagerAvailable = !!h.datamanager;
    store.dataHealth = h;
    if (h.recorder) store.recorderStatus = { ...store.recorderStatus, ...h.recorder };
    return h;
  } catch (e) {
    store.dataManagerAvailable = false;
    return null;
  }
}

async function $loadDataOverviewRest() {
  try {
    const o = await $apiGet('/api/data/overview');
    store.dataOverview = o.bars || [];
    store.dataOverviewTicks = o.ticks || [];
    $rebuildDataTree();
    return o;
  } catch (e) {
    return null;
  }
}

async function $loadRecorderStatus() {
  try {
    store.recorderStatus = await $apiGet('/api/recorder/status');
    return store.recorderStatus;
  } catch (e) {
    return null;
  }
}

function $openDataTab(preset) {
  store.dataDeepLink = preset || null;
  if (preset?.sub) store.dataSubTab = preset.sub;
  if (typeof window.__setActiveTab === 'function') window.__setActiveTab('data');
}

function $startDataDownload(payload) {
  const taskId = `dl-${Date.now().toString(36)}`;
  $wsSend({
    action: 'download_bar_data',
    payload: { ...payload, task_id: taskId, incremental: false },
  });
  return taskId;
}

function $startDataDownloadForSelection(selection) {
  if (!selection) return;
  const interval = selection.interval || '1m';
  if (interval !== 'd' && typeof $isCffexIndexOptionSymbol === 'function'
      && $isCffexIndexOptionSymbol(selection.symbol)) {
    $toast('股指期权 IO/HO/MO 仅支持日线，请在左侧选择「日线」再下载', 'warn');
    return;
  }
  const key = $dataNodeKey(selection);
  if (key) store.dataSelectedKey = key;
  const dates = $defaultDownloadDates(interval);
  $startDataDownload({
    symbol: selection.symbol,
    exchange: selection.exchange,
    interval,
    start: dates.start,
    end: dates.end,
  });
  store.dataTaskBarExpanded = true;
}

function $startDataUpdate(selection, opts) {
  if (!selection) return;
  const key = $dataNodeKey(selection);
  if (key) store.dataSelectedKey = key;
  $wsSend({
    action: 'update_bar_data',
    payload: {
      symbol: selection.symbol,
      exchange: selection.exchange,
      interval: selection.interval,
      end: opts?.end || '',
      materialize_first: selection.interval === '1m',
      task_id: `up-${Date.now().toString(36)}`,
      priority: 'high',
    },
  });
}

function $cancelDataTask(taskId) {
  if (!taskId) return;
  $wsSend({ action: 'cancel_data_task', payload: { task_id: taskId } });
}

function $syncDataWatchlistToServer() {
  const items = (ui.watchlist || []).map(w => ({
    vt_symbol: w.vt_symbol,
    intervals: ['1m', 'd'],
  }));
  $wsSend({ action: 'set_data_watchlist', payload: { items } });
}

function $queueAutoDataUpdate(vt, intervals, priority) {
  const parsed = $parseVtSymbol(vt);
  if (!parsed.symbol || !parsed.exchange) return;
  const ivs = intervals || ['1m', 'd'];
  for (const interval of ivs) {
    _autoUpdatePending.push({
      symbol: parsed.symbol,
      exchange: parsed.exchange,
      interval,
    });
  }
  clearTimeout(_autoUpdateTimer);
  _autoUpdateTimer = setTimeout(() => {
    const raw = _autoUpdatePending.splice(0);
    const seen = new Set();
    const items = raw.filter(it => {
      const k = `${it.symbol}.${it.exchange}:${it.interval}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    if (!items.length) return;
    $startBatchUpdate(items, priority || 'low');
  }, 2500);
}

let _autoUpdatePending = [];
let _autoUpdateTimer = null;

function $materializeBarData(selection) {
  if (!selection) return;
  $wsSend({
    action: 'materialize_bar_data',
    payload: {
      symbol: selection.symbol,
      exchange: selection.exchange,
      interval: selection.interval === 'tick' ? '1m' : selection.interval,
      task_id: `mat-${Date.now().toString(36)}`,
    },
  });
}

function $startDataDelete(selection) {
  if (!selection || selection.kind === 'tick') return;
  if (!confirm(`确认删除 ${selection.vt_symbol} ${selection.interval} 的全部 K 线数据？`)) return;
  $wsSend({
    action: 'delete_bar_data',
    payload: {
      symbol: selection.symbol,
      exchange: selection.exchange,
      interval: selection.interval,
      task_id: `del-${Date.now().toString(36)}`,
    },
  });
}

function $startBatchUpdate(items, priority, label, taskId) {
  if (!items?.length) return;
  $wsSend({
    action: 'auto_update',
    payload: {
      items,
      materialize_first: true,
      priority: priority || 'normal',
      label: label || `批量更新 (${items.length} 项)`,
      task_id: taskId || `batch-up-${Date.now().toString(36)}`,
    },
  });
}

function $startBatchDownload(items, priority, label, taskId) {
  if (!items?.length) return;
  const enriched = items.map(it => {
    const interval = it.interval || 'd';
    const dates = $defaultDownloadDates(interval);
    return {
      symbol: it.symbol,
      exchange: it.exchange,
      interval,
      start: it.start || dates.start,
      end: it.end || dates.end,
    };
  });
  $wsSend({
    action: 'batch_download_bar_data',
    payload: {
      items: enriched,
      incremental: false,
      priority: priority || 'normal',
      label: label || `批量下载 (${enriched.length} 项)`,
      task_id: taskId || `batch-dl-${Date.now().toString(36)}`,
    },
  });
}

function $gapRowKey(r) {
  return `${r.vt_symbol}:${r.interval}`;
}

function $linkGapRowToLocalData(row) {
  if (!row?.symbol || !row?.exchange) return null;
  const interval = row.interval || '1m';
  const vt = row.vt_symbol || `${row.symbol}.${row.exchange}`;
  const key = `bar:${interval}:${row.exchange}:${row.symbol}`;

  let node = $findDataNode(store.dataTree, key);
  if (!node && interval !== '1m') {
    node = $findDataNode(store.dataTree, `bar:1m:${row.exchange}:${row.symbol}`);
  }
  if (!node) {
    node = {
      kind: 'bar',
      symbol: row.symbol,
      exchange: row.exchange,
      interval,
      vt_symbol: vt,
      label: row.symbol,
      count: row.count || 0,
      start: row.start || '',
      end: row.end || row.effective_end || '',
      effective_end: row.effective_end || row.end || '',
      stored_end: row.stored_end || row.end || '',
      sources: row.sources || [],
      catalogOnly: !(row.count > 0),
      expired: typeof isExpired === 'function' ? isExpired(row.symbol) : false,
      freshness: $computeDataFreshness(row.effective_end || row.end || ''),
    };
  }

  if (store.dataTree?.length) $expandDataTreeToKey(store.dataTree, $dataNodeKey(node));
  $selectDataNode(node);
  $ensureContractName(vt);
  store.dataPreviewRevision += 1;
  return node;
}

function $buildGapScanItems() {
  const items = [];
  const seen = new Set();
  const add = (symbol, exchange, interval, vt_symbol) => {
    if (!symbol || !exchange || !interval) return;
    const k = `${symbol}.${exchange}:${interval}`;
    if (seen.has(k)) return;
    seen.add(k);
    items.push({
      symbol,
      exchange,
      interval,
      vt_symbol: vt_symbol || `${symbol}.${exchange}`,
      end: new Date().toISOString().slice(0, 10),
    });
  };

  for (const r of store.dataOverview || []) {
    if (!r.symbol || !r.exchange || r.interval === 'tick') continue;
    add(r.symbol, r.exchange, r.interval, r.vt_symbol);
  }

  for (const w of ui.watchlist || []) {
    const p = $parseVtSymbol(w.vt_symbol);
    add(p.symbol, p.exchange, '1m', w.vt_symbol);
    add(p.symbol, p.exchange, 'd', w.vt_symbol);
  }

  const has1m = new Set(
    (store.dataOverview || []).filter(r => r.interval === '1m').map(r => `${r.symbol}.${r.exchange}`)
  );
  for (const r of store.dataOverview || []) {
    if (r.interval === 'd' && r.symbol && !String(r.symbol).includes('-')) {
      const ck = `${r.symbol}.${r.exchange}`;
      if (!has1m.has(ck)) add(r.symbol, r.exchange, '1m', r.vt_symbol);
    }
  }
  return items;
}

async function $scanDataGaps() {
  if (!store.dataManagerAvailable) {
    $toast('数据补全服务未就绪', 'error');
    return [];
  }
  store.dataGapScanning = true;
  try {
    const items = $buildGapScanItems();
    if (!items.length) {
      store.dataGapRows = [];
      $toast('暂无待检查的合约', 'info');
      return [];
    }
    const data = await $checkDataCoverage(items);
    const gaps = (data.results || []).filter(r =>
      ['missing', 'partial', 'stale', 'tick_only'].includes(r.status)
    );
    store.dataGapRows = gaps;
    store.dataGapPanelVisible = true;
    if (!gaps.length) $toast('数据充足，未发现缺口', 'success');
    else $toast(`发现 ${gaps.length} 项数据缺口`, 'info');
    return gaps;
  } catch (e) {
    $toast('缺口检查失败', 'error');
    return [];
  } finally {
    store.dataGapScanning = false;
  }
}

function $startGapUpdates(rows) {
  if (!rows?.length) {
    $toast('请先选择要更新的项', 'info');
    return;
  }
  const downloadItems = [];
  const updateItems = [];
  const materializeItems = [];
  const skippedOptions = [];
  for (const r of rows) {
    if (r.status === 'tick_only') {
      materializeItems.push(r);
      continue;
    }
    const isOption = typeof $isCffexIndexOptionSymbol === 'function' && $isCffexIndexOptionSymbol(r.symbol);
    if (isOption && r.interval !== 'd') {
      skippedOptions.push(r);
      continue;
    }
    if (r.status === 'missing') {
      downloadItems.push({ symbol: r.symbol, exchange: r.exchange, interval: r.interval });
    } else {
      updateItems.push({ symbol: r.symbol, exchange: r.exchange, interval: r.interval });
    }
  }
  if (downloadItems.length) {
    $startBatchDownload(downloadItems, 'normal', `全量下载 (${downloadItems.length} 项)`);
  }
  if (updateItems.length) {
    $startBatchUpdate(updateItems, 'normal', `增量更新 (${updateItems.length} 项)`);
  }
  for (const r of materializeItems) {
    $materializeBarData({ symbol: r.symbol, exchange: r.exchange, interval: '1m', kind: 'bar' });
  }
  const n = downloadItems.length + updateItems.length + materializeItems.length;
  if (n) {
    store.dataTaskBarExpanded = true;
    $toast(`已提交 ${n} 项补数任务`, 'info');
  }
  if (skippedOptions.length) {
    $toast(`已跳过 ${skippedOptions.length} 项股指期权分钟线（仅支持日线）`, 'warn');
  }
}

async function $checkDataCoverage(items) {
  return $apiPost('/api/data/check', { items });
}

function $findLocalDataCoverage(vtSymbol, interval) {
  const parsed = $parseVtSymbol(vtSymbol);
  const bar = store.dataOverview.find(r =>
    r.symbol === parsed.symbol && r.exchange === parsed.exchange && r.interval === interval
  );
  if (bar) {
    const end = bar.effective_end || bar.end;
    return { status: 'ok', ...bar, end, freshness: $computeDataFreshness(end) };
  }
  const tick = store.dataOverviewTicks.find(r =>
    r.symbol === parsed.symbol && r.exchange === parsed.exchange
  );
  if (tick && interval === '1m') return { status: 'tick_only', ...tick, effective_end: tick.end };
  return { status: 'missing', vt_symbol: `${parsed.symbol}.${parsed.exchange}`, interval };
}

async function $exportBarData(selection) {
  if (!selection || selection.kind === 'tick') return;
  const start = (selection.start || '').slice(0, 10) || $defaultDownloadDates().start;
  const end = (selection.end || '').slice(0, 10) || new Date().toISOString().slice(0, 10);
  const q = new URLSearchParams({
    symbol: selection.symbol,
    exchange: selection.exchange,
    interval: selection.interval,
    start,
    end,
  });
  window.open(`${API_BASE}/api/data/export?${q}`, '_blank');
}

async function $importBarCsv(formData) {
  const r = await fetch(`${API_BASE}/api/data/import`, { method: 'POST', body: formData });
  if (!r.ok) throw new Error(`import failed: ${r.status}`);
  return r.json();
}

function $fmtBytes(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function $openDataTabForStrategy(strategy) {
  const vt = strategy?.vt_symbol;
  if (!vt) return;
  const parsed = $parseVtSymbol(vt);
  $openDataTab({
    sub: 'local',
    symbol: parsed.symbol,
    exchange: parsed.exchange,
    interval: '1m',
    vt_symbol: vt,
    action: 'update',
  });
}

/** 将回测成交转为 K 线买卖点标注 */
function $applyBacktestMarkers(result) {
  const trades = result?.trades;
  if (!Array.isArray(trades) || !trades.length) {
    store.backtestMarkers = [];
    return;
  }
  const vt = result.vt_symbol || '';
  store.backtestMarkers = trades.map(t => {
    const dir = String(t.direction ?? t.offset ?? '').toUpperCase();
    const isBuy = dir.includes('LONG') || dir.includes('多') || dir === 'BUY' || dir === '0';
    return {
      vt_symbol: t.vt_symbol || vt,
      datetime: t.datetime,
      side: isBuy ? 'BUY' : 'SELL',
    };
  });
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
let _lastGatewayKey = '';

async function $pollStatus() {
  try {
    const data = await $apiGet('/api/status');
    const gws = data.gateways || [];
    const key = gws.join(',');
    if (key && key !== _lastGatewayKey) {
      _lastGatewayKey = key;
      store.connectedGateways = gws;
      store.activeAccount = data.active_account || '';
      $hydrateTicks();
      $queryTradingSnapshot();
      $invokeWatchlistSubscribe();
    } else if (!key) {
      _lastGatewayKey = '';
      store.connectedGateways = [];
    } else {
      store.connectedGateways = gws;
      store.activeAccount = data.active_account || '';
    }
  } catch(e) {}
}
setInterval($pollStatus, 5000);  // Poll every 5 seconds

// ---- Init WS on load ----
if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    $wsConnect();
    $pollStatus();
    $initDataTabFromUrl();
  });
}
