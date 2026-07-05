// ===== 数据管理：合约目录（分页 + 排序） =====
const DataContractBrowser = {
  emits: ['watchlist', 'openTrading'],
  template: `
    <div class="data-contract-browser">
      <div class="data-source-tabs">
        <button class="btn btn-xs" :class="{ 'btn-primary': source === 'public' }" @click="switchSource('public')">公共目录 (akshare)</button>
        <button class="btn btn-xs" :class="{ 'btn-primary': source === 'gateway' }" @click="switchSource('gateway')">网关合约 (实时)</button>
        <label class="data-opt-toggle" v-if="source === 'gateway'"><input type="checkbox" v-model="showGatewayCol"> 网关列</label>
      </div>
      <div class="data-contract-toolbar">
        <input v-model="filter" class="input input-sm" placeholder="筛选代码/名称/交易所" style="flex:1">
        <div class="data-contract-filters">
          <button class="btn btn-xs" :class="{ 'btn-primary': category === '' }" @click="setCategory('')">全部</button>
          <button class="btn btn-xs" :class="{ 'btn-primary': category === 'index_option' }" @click="setCategory('index_option')">股指期权</button>
          <button class="btn btn-xs" :class="{ 'btn-primary': category === 'future' }" @click="setCategory('future')">期货</button>
        </div>
        <button class="btn btn-xs btn-primary" @click="load">查询</button>
      </div>
      <div class="data-contract-table-wrap">
        <table class="data-table compact">
          <thead><tr>
            <th class="sortable" @click="sortBy('vt_symbol')">合约 {{ sortMark('vt_symbol') }}</th>
            <th class="sortable" @click="sortBy('exchange')">交易所 {{ sortMark('exchange') }}</th>
            <th class="sortable" @click="sortBy('name')">名称 {{ sortMark('name') }}</th>
            <th>品种</th><th class="num">乘数</th>
            <th v-if="showGatewayCol">网关</th>
            <th></th>
          </tr></thead>
          <tbody>
            <tr v-for="c in pageRows" :key="c.vt_symbol">
              <td>{{ c.vt_symbol }}</td><td>{{ c.exchange }}</td>
              <td class="data-contract-name">
                <template v-if="isIndexOption(c.vt_symbol)">
                  <div>{{ contractLabel(c.vt_symbol) }}</div>
                  <div class="hint-sub">{{ contractSubLabel(c.vt_symbol) }}</div>
                </template>
                <template v-else>{{ c.name || contractLabel(c.vt_symbol) }}</template>
              </td>
              <td>{{ c.product }}</td><td class="num">{{ c.size }}</td>
              <td v-if="showGatewayCol">{{ c.gateway_name || '—' }}</td>
              <td class="data-row-actions">
                <button class="btn btn-xs" @click="$emit('openTrading', c.vt_symbol)">行情</button>
              </td>
            </tr>
            <tr v-if="!pageRows.length"><td :colspan="showGatewayCol ? 7 : 6" class="empty">{{ emptyHint }}</td></tr>
          </tbody>
        </table>
      </div>
      <div v-if="sortedRows.length > pageSize" class="data-pager">
        <button class="btn btn-xs" :disabled="page <= 0" @click="page--">上一页</button>
        <span>{{ page + 1 }} / {{ totalPages }} · 共 {{ sortedRows.length }} 条</span>
        <button class="btn btn-xs" :disabled="page >= totalPages - 1" @click="page++">下一页</button>
      </div>
    </div>`,
  setup(props, { emit }) {
    const source = ref('public');
    const filter = ref('');
    const rows = ref([]);
    const loading = ref(false);
    const showGatewayCol = ref(false);
    const sortCol = ref('vt_symbol');
    const sortDir = ref(1);
    const page = ref(0);
    const pageSize = 100;
    const category = ref('');

    const filtered = computed(() => {
      let list = rows.value;
      if (category.value === 'index_option') {
        list = list.filter(c => $isIndexOption(c.vt_symbol) || ['IO', 'HO', 'MO'].includes($productFromVt(c.vt_symbol)));
      } else if (category.value === 'future') {
        list = list.filter(c => !$isIndexOption(c.vt_symbol) && !['IO', 'HO', 'MO'].includes($productFromVt(c.vt_symbol)));
      }
      const q = filter.value.trim().toLowerCase();
      if (!q) return list;
      return list.filter(c =>
        (c.vt_symbol || '').toLowerCase().includes(q) ||
        (c.exchange || '').toLowerCase().includes(q) ||
        (c.name || '').toLowerCase().includes(q) ||
        (c.product || '').toLowerCase().includes(q) ||
        ($contractLabel(c.vt_symbol) || '').toLowerCase().includes(q)
      );
    });

    const sortedRows = computed(() => {
      const col = sortCol.value;
      const dir = sortDir.value;
      return [...filtered.value].sort((a, b) => {
        const av = a[col] ?? '';
        const bv = b[col] ?? '';
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    });

    const totalPages = computed(() => Math.max(1, Math.ceil(sortedRows.value.length / pageSize)));
    const pageRows = computed(() => {
      const start = page.value * pageSize;
      return sortedRows.value.slice(start, start + pageSize);
    });

    const emptyHint = computed(() => {
      if (loading.value) return '加载中…';
      if (source.value === 'gateway') {
        if (!store.connectedGateways?.length) return '请先在设置中连接网关账户';
        return '暂无合约（TD 登录后需等待柜台合约查询完成，可点查询重试）';
      }
      return '点击查询加载公共合约目录';
    });

    function sortBy(col) {
      if (sortCol.value === col) sortDir.value *= -1;
      else { sortCol.value = col; sortDir.value = 1; }
      page.value = 0;
    }
    function sortMark(col) {
      if (sortCol.value !== col) return '';
      return sortDir.value > 0 ? '↑' : '↓';
    }

    function switchSource(s) {
      source.value = s;
      rows.value = [];
      page.value = 0;
      if (s !== 'gateway') showGatewayCol.value = false;
      load();
    }

    function setCategory(c) {
      category.value = c;
      page.value = 0;
    }

    async function load() {
      loading.value = true;
      page.value = 0;
      try {
        if (source.value === 'gateway') {
          const data = await $apiGet(`/api/contracts?filter=${encodeURIComponent(filter.value || '')}`);
          rows.value = data || [];
        } else {
          const all = [];
          for (const ex of CONTRACT_EXCHANGES) {
            try {
              const d = await $apiGet(`/api/contracts/public?exchange=${ex.value}`);
              for (const c of (d.contracts || [])) {
                all.push({
                  vt_symbol: c.vt_symbol || `${c.symbol}.${ex.value}`,
                  symbol: c.symbol,
                  exchange: ex.value,
                  name: c.name || '',
                  product: c.product || '',
                  size: c.size || '',
                  gateway_name: '',
                });
              }
            } catch (e) { /* skip */ }
          }
          rows.value = all;
          all.forEach(c => {
            if (c.name) $setContractNameIfBetter(c.vt_symbol, c.name);
            else $ensureContractName(c.vt_symbol);
          });
        }
      } catch (e) {
        $toast('查询合约失败', 'error');
      } finally {
        loading.value = false;
      }
    }

    watch(filter, () => { page.value = 0; });
    watch(category, () => { page.value = 0; });

    onMounted(() => { if (source.value === 'public') load(); });

    return {
      source, filter, category, loading, showGatewayCol, page, pageSize, pageRows, sortedRows, totalPages,
      emptyHint, sortBy, sortMark, switchSource, setCategory, load,
      contractLabel: $contractLabel, contractSubLabel: $contractSubLabel, isIndexOption: $isIndexOption,
    };
  },
};
