// ===== 数据管理：自选数据完整性检查 =====
const DataWatchlistCheck = {
  emits: ['update', 'batchUpdate'],
  template: `
    <div class="data-watchlist-check panel" style="flex:0 0 auto">
      <div class="panel-header">
        <span class="panel-title">自选数据检查</span>
        <div style="margin-left:auto;display:flex;gap:6px;align-items:center">
          <select v-model="interval" class="input input-sm">
            <option value="1m">1m</option><option value="1h">1h</option><option value="d">d</option>
          </select>
          <button class="btn btn-xs btn-primary" @click="runCheck" :disabled="loading">{{ loading ? '检查中…' : '检查自选' }}</button>
          <button v-if="missingItems.length" class="btn btn-xs" @click="batchUpdate">批量更新缺失</button>
        </div>
      </div>
      <div v-if="results.length" class="panel-body" style="max-height:140px;overflow:auto;padding:4px 8px">
        <table class="data-table compact">
          <thead><tr><th>合约</th><th>状态</th><th>说明</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in results" :key="r.vt_symbol + r.interval">
              <td>
                <div>{{ contractLabel(r.vt_symbol) }}</div>
                <div class="hint-sub">{{ r.vt_symbol }}</div>
              </td>
              <td><span class="data-cov-badge" :class="r.status">{{ covLabel(r.status) }}</span></td>
              <td>{{ r.detail }}<span v-if="r.coverage_pct != null && r.status !== 'ok'" class="hint-sub"> · {{ r.coverage_pct }}%</span></td>
              <td>
                <button v-if="r.status === 'tick_only'" class="btn btn-xs" @click="materialize(r)">物化</button>
                <button v-else-if="r.status !== 'ok'" class="btn btn-xs" @click="$emit('update', r)">更新</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>`,
  setup(props, { emit }) {
    const interval = ref('1m');
    const results = ref([]);
    const loading = ref(false);

    const missingItems = computed(() =>
      results.value.filter(r => r.status === 'missing' || r.status === 'partial' || r.status === 'stale')
    );

    function covLabel(s) {
      return ({ ok: '充足', missing: '缺失', partial: '部分', stale: '偏旧', tick_only: '仅Tick' }[s] || s);
    }

    async function runCheck() {
      const items = (ui.watchlist || []).map(w => ({
        vt_symbol: w.vt_symbol,
        interval: interval.value,
      }));
      if (!items.length) return $toast('自选为空', 'info');
      loading.value = true;
      try {
        const data = await $checkDataCoverage(items);
        results.value = data.results || [];
      } catch (e) {
        $toast('检查失败', 'error');
      } finally {
        loading.value = false;
      }
    }

    function batchUpdate() {
      const items = missingItems.value.map(r => ({
        symbol: r.symbol,
        exchange: r.exchange,
        interval: r.interval,
      }));
      emit('batchUpdate', { items });
    }

    function materialize(r) {
      $materializeBarData({ symbol: r.symbol, exchange: r.exchange, interval: '1m', kind: 'bar' });
    }

    return { interval, results, loading, missingItems, covLabel, runCheck, batchUpdate, materialize, contractLabel: $contractLabel };
  },
};
