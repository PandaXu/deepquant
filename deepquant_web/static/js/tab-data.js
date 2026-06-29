// ===== Tab 2: 数据管理 =====

const TabData = {
  template: `
    <div style="display:flex;flex-direction:column;flex:1;overflow:hidden;padding:8px;gap:8px">
      <!-- Contract Query -->
      <div class="panel" style="flex:0 0 auto">
        <div class="panel-header">
          <span class="panel-title">📋 合约查询</span>
          <input v-model="contractFilter" class="input" placeholder="按代码/交易所筛选" style="width:180px;height:24px;font-size:11px;margin-left:auto">
          <button class="btn btn-xs" @click="exportContracts">CSV</button>
        </div>
        <div class="panel-body" style="max-height:300px;overflow:auto">
          <table class="data-table">
            <thead><tr>
              <th>合约代码</th><th>交易所</th><th>名称</th><th>品种</th><th>乘数</th>
              <th class="num">最小变动</th><th class="num">最小手数</th>
              <th>期权组合</th><th>到期日</th><th>行权价</th><th>期权类型</th><th>网关</th>
            </tr></thead>
            <tbody>
              <tr v-for="c in filteredContracts" :key="c.vt_symbol">
                <td>{{ c.vt_symbol }}</td><td>{{ c.exchange }}</td><td>{{ c.name }}</td>
                <td>{{ c.product }}</td><td class="num">{{ c.size }}</td>
                <td class="num">{{ c.pricetick }}</td><td class="num">{{ c.min_volume }}</td>
                <td>{{ c.option_portfolio || '' }}</td><td>{{ c.option_expiry || '' }}</td>
                <td class="num">{{ c.option_strike || '' }}</td><td>{{ c.option_type || '' }}</td>
                <td>{{ c.gateway_name }}</td>
              </tr>
              <tr v-if="filteredContracts.length === 0"><td colspan="12" class="empty">输入筛选条件后点击"查询"</td></tr>
            </tbody>
          </table>
        </div>
        <div style="padding:4px 8px;display:flex;gap:8px">
          <button class="btn btn-sm btn-primary" @click="queryContracts">🔍 查询</button>
          <span style="font-size:10px;color:var(--text-dim)">共 {{ filteredContracts.length }} 条</span>
        </div>
      </div>

      <!-- Data Download -->
      <div class="panel" style="flex:0 0 auto">
        <div class="panel-header"><span class="panel-title">⬇️ 历史数据下载</span></div>
        <div style="display:flex;gap:8px;padding:8px;flex-wrap:wrap;align-items:end">
          <div class="form-row"><label>交易所</label><select v-model="dl.exchange" @change="onDlExchange" class="input"><option value="">选择</option><option v-for="e in exchanges" :value="e.value">{{ e.name }}</option></select></div>
          <div class="form-row"><label>品种</label><select v-model="dl.product" @change="onDlProduct" class="input"><option value="">选择</option><option v-for="p in dlProducts" :value="p">{{ p }}</option></select></div>
          <div class="form-row"><label>合约</label><select v-model="dl.symbol" class="input"><option value="">选择</option><option v-for="c in dlContracts" :value="c.vt_symbol">{{ c.symbol }}</option></select></div>
          <div class="form-row"><label>周期</label><select v-model="dl.interval" class="input"><option>1m</option><option>5m</option><option>15m</option><option>30m</option><option>1h</option><option>d</option><option>w</option></select></div>
          <div class="form-row"><label>起始日</label><input v-model="dl.start" class="input" type="date"></div>
          <div class="form-row"><label>结束日</label><input v-model="dl.end" class="input" type="date"></div>
          <button class="btn btn-sm btn-primary" @click="startDownload" :disabled="dl.downloading">{{ dl.downloading ? '下载中...' : '下载' }}</button>
        </div>
        <div v-if="dl.downloading" class="progress-bar" style="margin:0 8px 8px">
          <div class="progress-fill" :style="{width: dl.progress + '%'}"></div>
          <span style="font-size:10px;text-align:center;display:block">{{ dl.progress }}%</span>
        </div>
      </div>

      <!-- Data Overview -->
      <div class="panel" style="flex:1;min-height:0">
        <div class="panel-header">
          <span class="panel-title">📊 数据概览</span>
          <button class="btn btn-xs" @click="refreshOverview">刷新</button>
        </div>
        <div class="panel-body" style="overflow:auto">
          <table class="data-table">
            <thead><tr><th>合约</th><th>交易所</th><th>周期</th><th class="num">数据量</th><th>开始时间</th><th>结束时间</th></tr></thead>
            <tbody>
              <tr v-for="d in store.dataOverview" :key="d.vt_symbol + d.interval">
                <td>{{ d.vt_symbol }}</td><td>{{ d.exchange }}</td><td>{{ d.interval }}</td>
                <td class="num">{{ d.count }}</td><td>{{ d.start }}</td><td>{{ d.end }}</td>
              </tr>
              <tr v-if="store.dataOverview.length === 0"><td colspan="6" class="empty">暂无数据</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>`,
  setup() {
    const contractFilter = ref('');
    const allContracts = ref([]);
    const dl = reactive({ exchange:'', product:'', symbol:'', interval:'1m', start:'', end:'', downloading:false, progress:0 });
    const dlProducts = ref([]);
    const dlContracts = ref([]);
    const exchanges = [
      { value:'CFFEX', name:'中金所' }, { value:'SHFE', name:'上期所' },
      { value:'DCE', name:'大商所' }, { value:'CZCE', name:'郑商所' },
      { value:'INE', name:'上海能源' }, { value:'GFEX', name:'广期所' },
    ];

    const filteredContracts = computed(() => {
      if (!contractFilter.value) return allContracts.value;
      const q = contractFilter.value.toLowerCase();
      return allContracts.value.filter(c => (c.vt_symbol||'').toLowerCase().includes(q) || (c.exchange||'').toLowerCase().includes(q));
    });

    async function queryContracts() {
      try {
        const data = await $apiGet(`/api/contracts?filter=${encodeURIComponent(contractFilter.value || '')}`);
        allContracts.value = data || [];
      } catch(e) { $toast('查询合约失败', 'error'); }
    }
    function exportContracts() {
      $exportCSV(['合约代码','交易所','名称','品种','乘数','最小变动','最小手数','网关'],
        filteredContracts.value.map(c => [c.vt_symbol, c.exchange, c.name, c.product, c.size, c.pricetick, c.min_volume, c.gateway_name]),
        `contracts_${new Date().toISOString().slice(0,10)}.csv`);
    }

    async function onDlExchange() { dl.product=''; dlContracts.value=[]; if(dl.exchange) { try { dlProducts.value = await $apiGet(`/api/contracts/products?exchange=${dl.exchange}`) || []; } catch(e){} } }
    async function onDlProduct() { dl.symbol=''; if(dl.product) { try { dlContracts.value = await $apiGet(`/api/contracts/public?exchange=${dl.exchange}&product=${dl.product}`) || []; } catch(e){} } }
    function startDownload() {
      if (!dl.symbol) return $toast('请选择合约', 'error');
      dl.downloading = true; dl.progress = 0;
      const parts = dl.symbol.split('.');
      $wsSend({ action: 'download_bar_data', payload: { symbol: parts[0], exchange: parts[1]||dl.exchange, interval: dl.interval, start: dl.start, end: dl.end } });
      // Simulate progress (server doesn't push progress yet)
      const timer = setInterval(() => { if(dl.progress < 90) dl.progress += 10; else clearInterval(timer); }, 500);
      setTimeout(() => { dl.downloading = false; dl.progress = 100; clearInterval(timer); $toast('下载完成', 'success'); }, 8000);
    }
    function refreshOverview() { $wsSend({ action: 'get_data_overview' }); }

    onMounted(() => { refreshOverview(); });

    return { contractFilter, allContracts, dl, dlProducts, dlContracts, exchanges, filteredContracts,
      queryContracts, exportContracts, onDlExchange, onDlProduct, startDownload, refreshOverview, store };
  }
};
