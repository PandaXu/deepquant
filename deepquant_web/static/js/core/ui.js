// ===== UI 状态（本地偏好 + 自选 + 逐笔缓冲） =====

const { reactive: uiReactive } = Vue;

const ui = uiReactive({
  sidebarCollapsed: false,
  sidebarWidth: 220,
  bottomDockHeight: 200,
  activeSymbol: '',
  watchlist: [],
  subscribed: {},
  showAccountDrawer: false,
  showTickStream: false,
  showAddSymbol: false,
  addSymbolQuery: '',
  accountMenuOpen: false,
});

const TICK_STREAM_MAX = 200;

function $initUi() {
  const prefs = $loadUiPrefs();
  ui.sidebarCollapsed = prefs.sidebarCollapsed;
  ui.sidebarWidth = prefs.sidebarWidth;
  ui.bottomDockHeight = prefs.bottomDockHeight;
  ui.watchlist = $loadWatchlist().map(w => ({ ...w, vt_symbol: $normalizeVt(w.vt_symbol) }));
  const saved = $loadTradingContract();
  if (saved?.symbol) ui.activeSymbol = $normalizeVt(saved.symbol);
  else if (ui.watchlist.length) ui.activeSymbol = ui.watchlist[0].vt_symbol;
}

function $toggleSidebar() {
  ui.sidebarCollapsed = !ui.sidebarCollapsed;
  $saveUiPrefs({ sidebarCollapsed: ui.sidebarCollapsed });
}

function $setActiveSymbol(vt) {
  if (!vt) return;
  vt = $normalizeVt(vt);
  ui.activeSymbol = vt;
  if (!ui.watchlist.find(w => w.vt_symbol === vt)) {
    $addToWatchlist(vt);
  }
}

function $addToWatchlist(vt, pinned) {
  if (!vt) return;
  vt = $normalizeVt(vt);
  if (ui.watchlist.find(w => w.vt_symbol === vt)) return;
  ui.watchlist.push({ vt_symbol: vt, pinned: !!pinned });
  $saveWatchlist(ui.watchlist);
}

function $removeFromWatchlist(vt) {
  ui.watchlist = ui.watchlist.filter(w => w.vt_symbol !== vt);
  $saveWatchlist(ui.watchlist);
  delete ui.subscribed[vt];
}

function $markSubscribed(vt) {
  if (vt) ui.subscribed[$normalizeVt(vt)] = true;
}

function $watchlistStatus(vt) {
  const key = $normalizeVt(vt);
  if ($lookupTick(key)) return 'live';
  if (ui.subscribed[key]) return 'subscribed';
  if (ui.watchlist.find(w => w.vt_symbol === key)) return 'idle';
  return 'none';
}

function $appendTickStream(tick) {
  if (!tick?.vt_symbol) return;
  const vt = $normalizeVt(tick.vt_symbol);
  if (!store.tickStream[vt]) store.tickStream[vt] = [];
  const arr = store.tickStream[vt];
  arr.push({
    time: tick.datetime || tick.time || new Date().toISOString(),
    last_price: tick.last_price,
    volume: tick.last_volume || tick.volume,
    bid_price_1: tick.bid_price_1,
    ask_price_1: tick.ask_price_1,
  });
  if (arr.length > TICK_STREAM_MAX) arr.splice(0, arr.length - TICK_STREAM_MAX);
}

function $autoSubscribeWatchlist() {
  const gws = store.connectedGateways || [];
  if (!gws.length) return;
  const seen = new Set();
  const subscribeOne = (vt) => {
    const key = $normalizeVt(vt);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const { exchange } = $parseVtSymbol(key);
    const symbol = $resolveSubscribeSymbol(key);
    if (!symbol || !exchange) return;
    gws.forEach(gw => {
      $restSubscribe(symbol, exchange, gw).then(ok => { if (ok) $markSubscribed(key); });
    });
  };
  ui.watchlist.forEach(item => subscribeOne(item.vt_symbol));
  if (ui.activeSymbol) subscribeOne(ui.activeSymbol);
}

function $activeOrderCount() {
  return Object.values(store.order).filter($isActiveOrder).length;
}

function $primaryAccount() {
  const list = Object.values(store.account);
  return list.length ? list[0] : null;
}

function $onboardingStep() {
  if (!store.connectedGateways.length) return 1;
  return 0;
}

if (typeof window !== 'undefined') {
  $initUi();
}
