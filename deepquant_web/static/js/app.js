// ===== DeepQuant App — Shell + Bootstrap =====

const App = {
  template: `
    <div class="app-shell">
      <header id="header" class="status-bar">
        <div class="logo">Deep<span>Quant</span></div>
        <div class="status-group">
          <span class="status-chip" :class="store.wsStatus ? 'on' : 'off'" title="WebSocket">
            <span class="ws-dot" :class="store.wsStatus ? 'on' : 'off'"></span> WS
          </span>
          <span class="status-chip" :class="gatewayConnected ? 'on' : 'off'" title="交易网关">
            <span class="ws-dot" :class="gatewayConnected ? 'on' : 'off'"></span>
            {{ gatewayConnected ? (store.activeAccount || store.connectedGateways.join(', ')) : '网关未连' }}
          </span>
        </div>
        <div class="account-chip-wrap">
          <button class="account-chip" @click="ui.accountMenuOpen = !ui.accountMenuOpen">
            {{ store.activeAccount || '选择账户' }} ▾
          </button>
          <div v-if="ui.accountMenuOpen" class="account-menu" @mouseleave="ui.accountMenuOpen = false">
            <button v-for="a in store.gatewayAccounts" :key="a.id" @click="switchAccount(a)">
              {{ a.alias }} · {{ a.gateway }}
              <span v-if="store.activeAccount === a.alias"> ✓</span>
            </button>
            <button @click="openAccountDrawer">连接账户…</button>
            <button @click="goTab('settings')">管理账户</button>
          </div>
        </div>
        <div class="fund-summary" v-if="primaryAccount">
          <span>可用 <b class="num">{{ fmtPrice(primaryAccount.available) }}</b></span>
          <span v-if="totalFloatPnl !== null" :class="totalFloatPnl >= 0 ? 'up' : 'down'" style="margin-left:10px">
            浮盈 {{ totalFloatPnl >= 0 ? '+' : '' }}{{ fmtPrice(totalFloatPnl) }}
          </span>
          <span class="latency-badge" :class="latencyClass()" style="margin-left:10px" title="行情延迟">⏱ {{ latencyLabel() }}</span>
        </div>
        <div class="header-actions">
          <button class="btn btn-xs" @click="wsConnect()" title="重连 WS">↻</button>
          <span id="clock" class="clock">--:--:--</span>
        </div>
      </header>

      <div v-if="bannerText" class="app-banner" :class="bannerClass">
        {{ bannerText }}
        <button v-if="!gatewayConnected" class="btn btn-xs btn-primary" @click="openAccountDrawer">连接</button>
      </div>

      <div class="app-body">
        <watchlist-panel :collapsed="ui.sidebarCollapsed" @toggle="toggleSidebar" @select="onWatchlistSelect" />
        <div class="main-column">
          <nav id="tab-bar">
            <button v-for="t in tabs" :key="t.id" class="tab-btn"
              :class="{ active: activeTab === t.id }" @click="setTab(t.id)">
              {{ t.icon }} {{ t.label }}
            </button>
            <div class="tab-stats">
              自选 {{ ui.watchlist.length }} · 持仓 {{ posCount }} · 挂单 {{ activeOrderCount }}
            </div>
          </nav>
          <div v-show="activeTab === 'trading'" class="tab-content"><tab-trading /></div>
          <div v-show="activeTab === 'data'" class="tab-content"><tab-data /></div>
          <div v-show="activeTab === 'strategy'" class="tab-content"><tab-strategy /></div>
          <div v-show="activeTab === 'log'" class="tab-content"><tab-log /></div>
          <div v-show="activeTab === 'settings'" class="tab-content"><tab-settings /></div>
        </div>
      </div>

      <div v-if="miniLogs.length" class="mini-log-bar" @click="goTab('log')">
        <span v-for="(l, i) in miniLogs" :key="i" :class="'ml-' + (l.level || 'INFO')">{{ l.msg }}</span>
      </div>

      <account-drawer :open="ui.showAccountDrawer" @close="ui.showAccountDrawer = false" @connected="onAccountConnected" />

      <add-watchlist-modal :open="ui.showAddSymbol" @close="ui.showAddSymbol = false" @add="onAddWatchlist" />
    </div>`,
  setup() {
    const tabs = [
      { id: 'trading', icon: '📈', label: '交易' },
      { id: 'data', icon: '📊', label: '数据' },
      { id: 'strategy', icon: '⚙️', label: '策略' },
      { id: 'log', icon: '📋', label: '日志' },
      { id: 'settings', icon: '🔧', label: '设置' },
    ];
    const prefs = $loadUiPrefs();
    const activeTab = ref(prefs.activeTab || 'trading');

    window.__setActiveTab = (id) => setTab(id);

    const posCount = computed(() => Object.keys(store.position).length);
    const activeOrderCount = computed(() => $activeOrderCount());
    const gatewayConnected = computed(() => store.connectedGateways.length > 0);
    const primaryAccount = computed(() => $primaryAccount());
    const totalFloatPnl = computed(() => {
      const ps = Object.values(store.position);
      if (!ps.length) return null;
      return ps.reduce((s, p) => s + Number(p.position_profit || p.pnl || 0), 0);
    });

    const bannerText = computed(() => {
      if (!store.wsStatus) return 'WebSocket 断开，正在重连…';
      if (!gatewayConnected.value) return '网关未连接 — 连接后可订阅行情与交易';
      return '';
    });
    const bannerClass = computed(() => !store.wsStatus ? 'warn' : 'error');

    const miniLogs = computed(() => {
      return store.log.filter(l => ['WARN', 'ERROR'].includes(l.level)).slice(-3);
    });

    function setTab(id) {
      activeTab.value = id;
      store.logPaused = id !== 'log';
      $saveUiPrefs({ activeTab: id });
    }
    function goTab(id) { setTab(id); }
    function toggleSidebar() { $toggleSidebar(); nextTick(() => window.dispatchEvent(new Event('resize'))); }
    function onWatchlistSelect(vt) { if (activeTab.value !== 'trading') setTab('trading'); }
    function openAccountDrawer() { ui.showAccountDrawer = true; ui.accountMenuOpen = false; }
    function onAccountConnected() {
      $hydrateTicks();
      $queryTradingSnapshot();
      $invokeWatchlistSubscribe();
      if (ui.activeSymbol) window.__applyTradingSymbol && window.__applyTradingSymbol(ui.activeSymbol);
      setTab('trading');
    }
    async function switchAccount(a) {
      ui.accountMenuOpen = false;
      if (store.activeAccount === a.alias) return;
      await $restConnectAccount(a.id);
    }
    function onAddWatchlist(vt) {
      vt = $normalizeVt(vt);
      if (ui.watchlist.some(w => w.vt_symbol === vt)) {
        $toast('已在自选中', 'info');
      } else {
        $addToWatchlist(vt);
        $toast('已添加自选', 'success');
      }
      $setActiveSymbol(vt);
      ui.showAddSymbol = false;
      $invokeWatchlistSubscribe();
      $fetchContractName(vt);
      if (activeTab.value !== 'trading') setTab('trading');
      else window.__applyTradingSymbol && window.__applyTradingSymbol(vt);
    }

    watch(activeTab, (tab) => { store.logPaused = tab !== 'log'; });

    onMounted(() => {
      $loadGatewayAccounts();
      $preloadWatchlistNames();
      try {
        const cfg = $loadJson(PERSIST_KEYS.config, {});
        if (cfg.theme === 'light') document.body.classList.add('theme-light');
        if (cfg.fontSize) document.documentElement.style.fontSize = cfg.fontSize + 'px';
      } catch (e) { /* ignore */ }
      document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        if (e.key === 'F1') { e.preventDefault(); window.__tradingPlaceOrder && window.__tradingPlaceOrder('LONG'); }
        if (e.key === 'F2') { e.preventDefault(); window.__tradingPlaceOrder && window.__tradingPlaceOrder('SHORT'); }
        if (e.key === 'F3') { e.preventDefault(); window.__tradingCloseOrder && window.__tradingCloseOrder(); }
      });
    });

    return {
      tabs, activeTab, ui, store, posCount, activeOrderCount, gatewayConnected, primaryAccount,
      bannerText, bannerClass, miniLogs, totalFloatPnl,
      setTab, goTab, toggleSidebar, onWatchlistSelect, openAccountDrawer, onAccountConnected,
      switchAccount, onAddWatchlist, wsConnect: $wsConnect, fmtPrice: $fmtPrice,
      latencyLabel: $latencyLabel, latencyClass: $latencyClass,
    };
  },
};

const app = createApp(App);
app.component('watchlist-panel', WatchlistPanel);
app.component('contract-picker', ContractPicker);
app.component('add-watchlist-modal', AddWatchlistModal);
app.component('account-drawer', AccountDrawer);
app.component('bottom-dock', BottomDock);
app.component('tick-stream-drawer', TickStreamDrawer);
app.component('trading-onboarding', TradingOnboarding);
app.component('data-tree-nav', DataTreeNav);
app.component('data-detail-panel', DataDetailPanel);
app.component('data-download-drawer', DataDownloadDrawer);
app.component('data-recorder-panel', DataRecorderPanel);
app.component('data-contract-browser', DataContractBrowser);
app.component('data-task-bar', DataTaskBar);
app.component('data-import-modal', DataImportModal);
app.component('data-watchlist-check', DataWatchlistCheck);
app.component('tab-trading', TabTrading);
app.component('tab-data', TabData);
app.component('tab-strategy', TabStrategy);
app.component('tab-log', TabLog);
app.component('tab-settings', TabSettings);
app.mount('#app');
