// ===== 数据管理：缺口检查（可关闭、多选、统一补数） =====
const DataGapPanel = {
  template: `
    <div v-if="store.dataGapPanelVisible" class="data-gap-panel panel">
      <div class="panel-header">
        <span class="panel-title">数据缺口</span>
        <span class="hint-sub">{{ summaryText }}</span>
        <div class="data-gap-actions">
          <button class="btn btn-xs" :class="{ 'btn-primary': filterWatchlist }"
            title="仅显示自选合约相关的缺口" @click="toggleWatchlistFilter">
            自选{{ watchlistGapCount ? ' (' + watchlistGapCount + ')' : '' }}
          </button>
          <label class="data-opt-toggle">
            <input type="checkbox" :checked="allSelected" :indeterminate="someSelected && !allSelected" @change="toggleAll">
            全选
          </label>
          <button class="btn btn-xs btn-primary" :disabled="!selectedCount" @click="updateSelected">
            更新选中 ({{ selectedCount }})
          </button>
          <button class="btn btn-xs" @click="rescan" :disabled="store.dataGapScanning">重新检查</button>
          <button class="btn btn-xs mut" title="关闭" @click="close">×</button>
        </div>
      </div>
      <div class="panel-body data-gap-body">
        <div v-if="store.dataGapScanning" class="empty-hint">正在检查本地数据与自选合约…</div>
        <div v-else-if="!displayRows.length" class="empty-hint">
          <template v-if="filterWatchlist">自选合约暂无缺口</template>
          <template v-else>
            暂无缺口<br><small>涵盖：本地已有 K 线序列、自选 1m/日线、有日线缺 1m 的期货</small>
          </template>
        </div>
        <table v-else class="data-table compact">
          <thead><tr>
            <th style="width:28px"></th>
            <th>合约</th>
            <th>数据类型</th>
            <th>状态</th>
            <th>说明</th>
          </tr></thead>
          <tbody>
            <tr v-for="r in displayRows" :key="rowKey(r)"
              class="data-gap-row"
              :class="{ selected: isSelected(r), active: isLinked(r) }"
              @click="linkToLocal(r)">
              <td @click.stop><input type="checkbox" :checked="isSelected(r)" @change="toggle(r)"></td>
              <td class="data-gap-contract">
                <div>{{ contractLabel(r.vt_symbol) }}</div>
                <div class="hint-sub">{{ r.vt_symbol }}</div>
              </td>
              <td>{{ intervalLabel(r.interval) }}</td>
              <td><span class="data-cov-badge" :class="r.status">{{ statusLabel(r.status) }}</span></td>
              <td class="data-gap-detail">
                {{ r.detail }}
                <span v-if="r.coverage_pct != null && r.status !== 'ok'" class="hint-sub"> · {{ r.coverage_pct }}%</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`,
  setup() {
    const selectedKeys = ref(new Set());
    const filterWatchlist = ref(false);

    const watchlistVtSet = computed(() => {
      const s = new Set();
      for (const w of ui.watchlist || []) {
        const vt = $normalizeVt(w.vt_symbol);
        if (vt) s.add(vt);
      }
      return s;
    });

    const isWatchlistRow = (r) => watchlistVtSet.value.has($normalizeVt(r.vt_symbol));

    const displayRows = computed(() => {
      const rows = store.dataGapRows || [];
      if (!filterWatchlist.value) return rows;
      return rows.filter(isWatchlistRow);
    });

    const watchlistGapCount = computed(() =>
      (store.dataGapRows || []).filter(isWatchlistRow).length
    );

    const summaryText = computed(() => {
      if (store.dataGapScanning) return '检查中…';
      const total = displayRows.value.length;
      const all = store.dataGapRows.length;
      if (!all) return '无缺口';
      if (filterWatchlist.value) {
        return `自选 ${total} 项 · 已选 ${selectedKeys.value.size}${total < all ? ` / 共 ${all}` : ''}`;
      }
      return `共 ${total} 项 · 已选 ${selectedKeys.value.size}`;
    });

    const selectedCount = computed(() => selectedKeys.value.size);
    const allSelected = computed(() =>
      displayRows.value.length > 0 && displayRows.value.every(r => selectedKeys.value.has(rowKey(r)))
    );
    const someSelected = computed(() => selectedKeys.value.size > 0);

    function rowKey(r) { return $gapRowKey(r); }
    function isSelected(r) { return selectedKeys.value.has(rowKey(r)); }

    function isLinked(r) {
      const k = `bar:${r.interval}:${r.exchange}:${r.symbol}`;
      return store.dataSelectedKey === k;
    }

    function linkToLocal(r) {
      $linkGapRowToLocalData(r);
    }

    function syncSelectionFromRows() {
      selectedKeys.value = new Set(displayRows.value.map(r => rowKey(r)));
    }

    watch(() => store.dataGapRows, () => syncSelectionFromRows(), { deep: true });
    watch(displayRows, () => {
      const visible = new Set(displayRows.value.map(r => rowKey(r)));
      const next = new Set([...selectedKeys.value].filter(k => visible.has(k)));
      if (!next.size && displayRows.value.length) syncSelectionFromRows();
      else selectedKeys.value = next;
    });

    function toggleWatchlistFilter() {
      filterWatchlist.value = !filterWatchlist.value;
    }

    function toggle(r) {
      const k = rowKey(r);
      const next = new Set(selectedKeys.value);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      selectedKeys.value = next;
    }

    function toggleAll(ev) {
      if (ev.target.checked) syncSelectionFromRows();
      else selectedKeys.value = new Set();
    }

    function selectedRows() {
      return displayRows.value.filter(r => selectedKeys.value.has(rowKey(r)));
    }

    function updateSelected() {
      $startGapUpdates(selectedRows());
    }

    function rescan() {
      $scanDataGaps();
    }

    function close() {
      store.dataGapPanelVisible = false;
    }

    function intervalLabel(itv) {
      return DATA_INTERVAL_LABELS[itv] || itv;
    }

    function statusLabel(s) {
      return ({
        ok: '充足',
        missing: '缺失',
        partial: '部分',
        stale: '偏旧',
        tick_only: '仅Tick',
      }[s] || s);
    }

    return {
      store, summaryText, selectedCount, allSelected, someSelected,
      filterWatchlist, displayRows, watchlistGapCount, toggleWatchlistFilter,
      rowKey, isSelected, isLinked, linkToLocal, toggle, toggleAll, updateSelected, rescan, close,
      intervalLabel, statusLabel, contractLabel: $contractLabel,
    };
  },
};
