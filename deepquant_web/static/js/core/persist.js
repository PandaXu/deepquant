// ===== localStorage 持久化 =====

const DEFAULT_WATCHLIST_SYMBOLS = ['au2609.SHFE', 'rb2609.SHFE', 'IF2606.CFFEX'];

const PERSIST_KEYS = {
  tradingContract: 'deepquant_trading_contract',
  watchlist: 'deepquant_watchlist',
  sidebarCollapsed: 'deepquant_ui_sidebar_collapsed',
  sidebarWidth: 'deepquant_ui_sidebar_width',
  activeTab: 'deepquant_active_tab',
  bottomDockHeight: 'deepquant_ui_bottom_dock_height',
  config: 'deepquant_config',
};

function $loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function $saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* quota */ }
}

function $loadBool(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === 'true';
  } catch (e) {
    return fallback;
  }
}

function $saveBool(key, value) {
  try {
    localStorage.setItem(key, value ? 'true' : 'false');
  } catch (e) { /* quota */ }
}

function $loadNumber(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch (e) {
    return fallback;
  }
}

function $saveNumber(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) { /* quota */ }
}

function $saveTradingContract(payload) {
  if (!payload?.symbol) return;
  $saveJson(PERSIST_KEYS.tradingContract, payload);
}

function $loadTradingContract() {
  return $loadJson(PERSIST_KEYS.tradingContract, null);
}

function $defaultWatchlistItems() {
  return DEFAULT_WATCHLIST_SYMBOLS.map(vt => ({ vt_symbol: vt, pinned: false }));
}

function $loadWatchlist() {
  const list = $loadJson(PERSIST_KEYS.watchlist, null);
  if (Array.isArray(list) && list.length) return list;
  return $defaultWatchlistItems();
}

function $saveWatchlist(list) {
  $saveJson(PERSIST_KEYS.watchlist, list);
}

function $loadUiPrefs() {
  return {
    sidebarCollapsed: $loadBool(PERSIST_KEYS.sidebarCollapsed, false),
    sidebarWidth: $loadNumber(PERSIST_KEYS.sidebarWidth, 300),
    activeTab: localStorage.getItem(PERSIST_KEYS.activeTab) || 'trading',
    bottomDockHeight: $loadNumber(PERSIST_KEYS.bottomDockHeight, 200),
  };
}

function $saveUiPrefs(prefs) {
  if (prefs.sidebarCollapsed != null) $saveBool(PERSIST_KEYS.sidebarCollapsed, prefs.sidebarCollapsed);
  if (prefs.sidebarWidth != null) $saveNumber(PERSIST_KEYS.sidebarWidth, prefs.sidebarWidth);
  if (prefs.activeTab != null) localStorage.setItem(PERSIST_KEYS.activeTab, prefs.activeTab);
  if (prefs.bottomDockHeight != null) $saveNumber(PERSIST_KEYS.bottomDockHeight, prefs.bottomDockHeight);
}
