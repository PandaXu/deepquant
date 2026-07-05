// ===== 自选 Watchlist 侧栏（多列 + 分组） =====

const WatchlistPanel = {
  props: { collapsed: Boolean },
  emits: ['select', 'toggle'],
  template: `
    <aside class="watchlist-panel" :class="{ collapsed }" :style="panelStyle">
      <div class="wl-header">
        <button class="btn btn-xs wl-toggle" @click="$emit('toggle')">{{ collapsed ? '▶' : '◀' }}</button>
        <span v-if="!collapsed" class="wl-title">自选</span>
      </div>
      <template v-if="!collapsed">
        <div class="wl-search">
          <input v-model="query" class="input input-sm" placeholder="筛选自选">
          <button type="button" class="btn btn-xs btn-primary" title="添加自选" @click="ui.showAddSymbol = true">+</button>
        </div>
        <div class="wl-table-head">
          <span></span><span>合约</span><span class="num">最新</span><span class="num">涨跌%</span><span class="num">量</span><span></span>
        </div>
        <div class="wl-list">
          <div v-for="grp in filteredGroups" :key="grp.name" class="wl-group">
            <div class="wl-group-title" @click="toggleGroup(grp.name)">{{ collapsedGroups[grp.name] ? '▸' : '▾' }} {{ grp.name }}</div>
            <template v-if="!collapsedGroups[grp.name]">
              <div v-for="item in grp.items" :key="item.vt_symbol"
                class="wl-item wl-row" :class="[flashClass(item.vt_symbol), { active: item.vt_symbol === ui.activeSymbol }]"
                @click="selectItem(item.vt_symbol)" @dblclick="subscribeItem(item.vt_symbol)">
                <span class="wl-dot" :class="'wl-dot-' + statusOf(item.vt_symbol)"></span>
                <div class="wl-sym-col">
                  <template v-if="isIndexOption(item.vt_symbol)">
                    <span class="option-line">{{ contractLabel(item.vt_symbol) }}</span>
                    <span class="option-line">{{ contractSubLabel(item.vt_symbol) }}</span>
                    <span class="option-code">{{ contractCodeLine(item.vt_symbol) }}</span>
                  </template>
                  <template v-else>
                    <span class="wl-sym">{{ contractLabel(item.vt_symbol) }}</span>
                    <span class="wl-sym-sub">{{ contractSubLabel(item.vt_symbol) }}</span>
                  </template>
                </div>
                <span class="wl-price num" :class="chgCls(tickOf(item.vt_symbol))">{{ fmtPrice(tickOf(item.vt_symbol)?.last_price) }}</span>
                <span class="wl-chg num" :class="chgCls(tickOf(item.vt_symbol))">{{ chgText(tickOf(item.vt_symbol)) }}</span>
                <span class="wl-vol num">{{ fmtVolShort(tickOf(item.vt_symbol)?.volume) }}</span>
                <button type="button" class="wl-del" title="删除" @click.stop="removeItem(item.vt_symbol)">×</button>
              </div>
            </template>
          </div>
        </div>
      </template>
      <div v-else class="wl-collapsed-mini" @click="$emit('toggle')">
        <div v-if="ui.activeSymbol" class="wl-mini-card">
          <div>{{ ui.activeSymbol.split('.')[0] }}</div>
          <div>{{ fmtPrice(tickOf(ui.activeSymbol)?.last_price) }}</div>
        </div>
      </div>
    </aside>`,
  setup(props, { emit }) {
    const query = ref('');
    const collapsedGroups = reactive({});
    const flashMap = reactive({});

    const panelStyle = computed(() => ({ width: props.collapsed ? '40px' : (ui.sidebarWidth + 'px') }));

    const filteredGroups = computed(() => {
      const q = query.value.trim();
      let items = ui.watchlist;
      if (q) items = items.filter(w => $matchContractQuery(q, w.vt_symbol));
      return $groupWatchlist(items);
    });

    function tickOf(vt) { return $lookupTick(vt); }
    function statusOf(vt) { return $watchlistStatus(vt); }
    function contractLabel(vt) { return $contractLabel(vt); }
    function contractSubLabel(vt) { return $contractSubLabel(vt); }
    function contractCodeLine(vt) { return $contractCodeLine(vt); }
    function isIndexOption(vt) { return $isIndexOption(vt); }
    function fmtVolShort(v) {
      if (v == null) return '—';
      const n = Number(v);
      if (n >= 10000) return (n / 10000).toFixed(1) + 'w';
      return String(Math.round(n));
    }
    function toggleGroup(name) { collapsedGroups[name] = !collapsedGroups[name]; }
    function selectItem(vt) { $setActiveSymbol(vt); emit('select', vt); }
    function subscribeItem(vt) {
      const { exchange } = $parseVtSymbol(vt);
      const symbol = $resolveSubscribeSymbol(vt);
      if (!store.connectedGateways.length) { $toast('请先连接网关', 'error'); return; }
      store.connectedGateways.forEach(gw => $restSubscribe(symbol, exchange, gw).then(ok => {
        if (ok) $markSubscribed(vt);
      }));
    }
    function removeItem(vt) {
      vt = $normalizeVt(vt);
      const wasActive = ui.activeSymbol === vt;
      $removeFromWatchlist(vt);
      if (!wasActive) return;
      const next = ui.watchlist[0]?.vt_symbol || '';
      ui.activeSymbol = next;
      emit('select', next);
    }
    function flashClass(vt) {
      return flashMap[vt] || '';
    }

    watch(() => store.tickPulse?.n, () => {
      if (!$loadTradingPrefs().priceFlash) return;
      const { vt, dir } = store.tickPulse || {};
      const nvt = $normalizeVt(vt);
      if (!nvt || !ui.watchlist.find(w => w.vt_symbol === nvt)) return;
      flashMap[nvt] = dir === 'down' ? 'flash-down' : 'flash-up';
      setTimeout(() => { flashMap[nvt] = ''; }, 280);
    });

    onMounted(() => { $preloadWatchlistNames(); });

    return {
      ui, query, collapsedGroups, panelStyle, filteredGroups,
      tickOf, statusOf, contractLabel, contractSubLabel, contractCodeLine, isIndexOption, fmtVolShort, toggleGroup, selectItem, subscribeItem, removeItem,
      flashClass, fmtPrice: $fmtPrice, chgCls: $chgCls, chgText: $chgText,
    };
  },
};
