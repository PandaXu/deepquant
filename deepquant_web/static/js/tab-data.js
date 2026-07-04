// ===== Tab 2: 数据管理 =====

const TabData = {
  template: `
    <div class="data-tab">
      <div class="data-top-bar panel" style="flex:0 0 auto">
        <div class="data-subtabs">
          <button v-for="t in subTabs" :key="t.id" class="btn btn-xs"
            :class="{ 'btn-primary': subTab === t.id }" @click="subTab = t.id">{{ t.label }}</button>
        </div>
        <input v-if="subTab === 'local'" v-model="search" class="input input-sm data-search" placeholder="搜索合约…">
        <div class="data-top-meta">
          <span v-if="healthLine" class="hint-sub data-health-line">{{ healthLine }}</span>
          <span class="data-dm-badge" :class="store.dataManagerAvailable ? 'on' : 'off'">
            DataManager {{ store.dataManagerAvailable ? '已加载' : '未加载' }}
          </span>
          <button v-if="store.dataManagerAvailable" class="btn btn-xs" @click="syncMinute">同步分钟</button>
          <button v-if="store.dataManagerAvailable && subTab === 'local'" class="btn btn-xs btn-primary" @click="updateAll">全部更新</button>
          <button class="btn btn-xs" @click="importOpen = true">导入</button>
          <button class="btn btn-xs" @click="refreshAll">↻</button>
        </div>
      </div>

      <data-watchlist-check
        v-if="subTab === 'local'"
        @update="onWatchlistUpdate"
        @batch-update="onBatchUpdate"
      />

      <div v-show="subTab === 'local'" class="data-split">
        <div class="data-left panel">
          <div class="panel-header">
            <span class="panel-title">本地数据</span>
            <label v-if="subTab === 'local'" class="data-opt-toggle" style="margin-left:auto">
              <input type="checkbox" v-model="store.dataIncludeListedOptions" @change="onToggleListedOptions">
              挂牌合约
            </label>
          </div>
          <div class="panel-body data-tree-wrap">
            <data-tree-nav :tree="filteredTree" :selected-key="selectedKey" @select="onSelect" />
          </div>
        </div>
        <div class="data-right panel">
          <data-detail-panel
            :selection="selection"
            :dm-available="store.dataManagerAvailable"
            @update="onUpdate"
            @delete="onDelete"
            @open-trading="openTrading"
            @open-backtest="openBacktest"
            @materialize="onMaterialize"
            @download="onDownload"
          />
        </div>
      </div>

      <div v-show="subTab === 'contracts'" class="data-full panel">
        <div class="panel-header"><span class="panel-title">合约目录</span></div>
        <div class="panel-body">
          <data-contract-browser @open-trading="openTrading" />
        </div>
      </div>

      <div v-show="subTab === 'recorder'" class="data-full panel">
        <div class="panel-header">
          <span class="panel-title">录制状态</span>
          <button class="btn btn-xs" @click="$loadRecorderStatus()">刷新</button>
        </div>
        <div class="panel-body">
          <data-recorder-panel :status="recorderView" @refresh="$loadRecorderStatus()" />
        </div>
      </div>

      <data-task-bar @go-log="goLog" />
      <data-import-modal
        :open="importOpen"
        :preset="importPreset"
        :dm-available="store.dataManagerAvailable"
        @close="importOpen = false"
        @done="refreshAll"
      />
    </div>`,
  setup() {
    const subTabs = [
      { id: 'local', label: '本地数据' },
      { id: 'contracts', label: '合约目录' },
      { id: 'recorder', label: '录制状态' },
    ];
    const subTab = ref(store.dataSubTab || 'local');
    const search = ref('');
    const importOpen = ref(false);
    const importPreset = ref(null);

    const selection = computed(() => {
      const key = store.dataSelectedKey;
      if (key && store.dataTree?.length) {
        const node = $findDataNode(store.dataTree, key);
        if (node) return node;
      }
      return store.dataSelection;
    });
    const selectedKey = computed(() => store.dataSelectedKey || '');

    const filteredTree = computed(() => $matchDataTreeSearch(store.dataTree, search.value));

    const healthLine = computed(() => {
      const h = store.dataHealth;
      if (!h) return '';
      const parts = [];
      if (h.bar_series != null) parts.push(`K线 ${h.bar_series} 组`);
      if (h.db_size_bytes) parts.push($fmtBytes(h.db_size_bytes));
      return parts.join(' · ');
    });

    const recorderView = computed(() => ({
      ...(store.recorderStatus || {}),
      db_path: store.dataHealth?.db_path,
      db_size_bytes: store.dataHealth?.db_size_bytes,
    }));

    watch(subTab, (v) => { store.dataSubTab = v; });

    function onSelect(node) {
      $selectDataNode(node);
    }

    function onWatchlistUpdate(r) {
      $startDataUpdate({ symbol: r.symbol, exchange: r.exchange, interval: r.interval, kind: 'bar', vt_symbol: r.vt_symbol });
    }

    function onBatchUpdate({ items }) {
      if (!items?.length) return;
      $startBatchUpdate(items);
      $toast(`已提交批量更新 ${items.length} 个合约`, 'info');
    }

    function onUpdate() {
      const sel = selection.value;
      if (sel?.kind === 'bar') $startDataUpdate(sel);
    }

    function onDelete() {
      $startDataDelete(selection.value);
    }

    function openBacktest() {
      const sel = selection.value;
      if (!sel) return;
      store.dataDeepLink = null;
      if (typeof window.__openBacktestWithSymbol === 'function') {
        window.__openBacktestWithSymbol(sel.vt_symbol, sel.interval === 'tick' ? '1m' : sel.interval);
      } else if (typeof window.__setActiveTab === 'function') {
        window.__setActiveTab('strategy');
      }
    }

    function openTrading(vt) {
      const sym = $normalizeVt(vt || selection.value?.vt_symbol);
      if (!sym) return;
      $setActiveSymbol(sym);
      if (typeof window.__applyTradingSymbol === 'function') window.__applyTradingSymbol(sym);
      if (typeof window.__setActiveTab === 'function') window.__setActiveTab('trading');
    }

    function onMaterialize() {
      if (selection.value) $materializeBarData(selection.value);
    }

    function onDownload() {
      const sel = selection.value;
      if (!sel) return;
      if (sel.catalogOnly) $startDataDownloadForSelection(sel);
      else onUpdate();
    }

    function onToggleListedOptions() {
      $rebuildDataTree();
    }

    function syncMinute() {
      $wsSend({ action: 'sync_minute_data', payload: { task_id: `sync-${Date.now().toString(36)}` } });
    }

    function updateAll() {
      $startUpdateAllBars();
    }

    function goLog() {
      if (typeof window.__setActiveTab === 'function') window.__setActiveTab('log');
    }

    async function refreshAll() {
      await Promise.all([
        $loadDataHealth(),
        $loadListedCatalog(),
        $loadRecorderStatus(),
      ]);
      await $loadDataOverviewRest();
      $refreshDataOverview();
    }

    function applyDeepLink(link) {
      if (!link) return;
      subTab.value = link.sub || 'local';
      refreshAll().then(() => {
        if (link.symbol && link.exchange) {
          const key = `${link.interval === 'tick' ? 'tick' : 'bar'}:${link.interval}:${link.exchange}:${link.symbol}`;
          let node = $findDataNode(store.dataTree, key);
          if (!node) {
            node = {
              kind: link.interval === 'tick' ? 'tick' : 'bar',
              symbol: link.symbol,
              exchange: link.exchange,
              interval: link.interval || '1m',
              vt_symbol: `${link.symbol}.${link.exchange}`,
              label: link.symbol,
              count: 0,
              start: '',
              end: '',
              freshness: $computeDataFreshness(''),
            };
          }
          onSelect(node);
        }
        if (link.action === 'import') {
          importPreset.value = link.symbol ? { symbol: link.symbol, exchange: link.exchange, interval: link.interval || '1m' } : null;
          importOpen.value = true;
        }
        if (link.action === 'update' && link.symbol && link.exchange) {
          $startDataUpdate({ symbol: link.symbol, exchange: link.exchange, interval: link.interval || '1m', kind: 'bar', vt_symbol: link.vt_symbol });
        }
      });
      store.dataDeepLink = null;
    }

    watch(() => store.dataDeepLink, (link) => {
      if (link) applyDeepLink(link);
    }, { immediate: true });

    watch(() => store.dataTree, () => {
      $ensureDataTreeSelection();
    });

    onMounted(() => {
      refreshAll();
      $syncDataWatchlistToServer();
      if (store.dataDeepLink) applyDeepLink(store.dataDeepLink);
    });

    return {
      store, subTabs, subTab, search, selection, selectedKey, filteredTree,
      importOpen, importPreset, healthLine, recorderView,
      onSelect, onWatchlistUpdate, onBatchUpdate,
      onUpdate, onDelete, openBacktest, openTrading, onMaterialize, onDownload, onToggleListedOptions,
      syncMinute, updateAll, goLog, refreshAll,
    };
  },
};
