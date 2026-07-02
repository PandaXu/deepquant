// ===== DeepQuant App — Bootstrap =====

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
    const orderCount = computed(() => Object.keys(store.order).length);
    const tickCount = computed(() => Object.keys(store.tick).length);
    const posCount = computed(() => Object.keys(store.position).length);
    const tradeCount = computed(() => Object.keys(store.trade).length);

    // Collapse log when leaving log tab
    const logPaused = computed({
      get: () => store.logPaused,
      set: (v) => { store.logPaused = v; }
    });

    // Gateway connection status display
    const gatewayLabel = computed(() => {
      const gws = store.connectedGateways;
      const acct = store.activeAccount;
      if (!store.wsStatus) return { dot: 'off', text: 'WS 断开' };
      if (gws.length > 0 && acct) return { dot: 'on', text: acct + ' — ' + gws.join(', ') + ' 已连接' };
      if (gws.length > 0) return { dot: 'on', text: gws.join(', ') + ' 已连接' };
      return { dot: 'off', text: '网关未连接' };
    });

    // Auto-pause log when not on log tab, resume when entering
    watch(activeTab, (tab) => { store.logPaused = tab !== 'log'; });

    // Auto-subscribe default contracts after WS connects
    const _autoSubscribed = ref(false);
    function doAutoSubscribe() {
      if (_autoSubscribed.value) return;
      _autoSubscribed.value = true;
      setTimeout(() => {
        ['au2609.SHFE', 'rb2609.SHFE', 'IF2606.CFFEX'].forEach(vt => {
          const parts = vt.split('.');
          $restSubscribe(parts[0], parts[1]);
        });
      }, 2000);
    }
    watch(() => store.wsStatus, (connected) => { if (connected) doAutoSubscribe(); });
    onMounted(() => { if (store.wsStatus) doAutoSubscribe(); });

    return { tabs, activeTab, orderCount, tickCount, posCount, tradeCount, logPaused, store, wsConnect: $wsConnect, gatewayLabel };
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
