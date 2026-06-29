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

    // Auto-pause log when not on log tab, resume when entering
    watch(activeTab, (tab) => { store.logPaused = tab !== 'log'; });

    return { tabs, activeTab, orderCount, tickCount, posCount, tradeCount, logPaused, store, wsConnect: $wsConnect };
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
