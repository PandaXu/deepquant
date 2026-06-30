// ===== Tab 1: 行情交易 =====

const TabTrading = {
  template: `
    <div class="trading-layout">
      <!-- Top: Chart + Trade Form -->
      <div class="trading-top">
        <!-- K-Line Chart + Depth -->
        <div class="trading-chart panel">
          <div class="panel-header">
            <span class="panel-title">📈 K线图</span>
            <span class="panel-badge">{{ chartSymbol || '—' }}</span>
            <div style="margin-left:auto;display:flex;gap:4px">
              <button class="btn btn-xs" v-for="iv in ['1m','5m','15m','1h','d']" :key="iv"
                :class="{ 'btn-primary': chartInterval === iv }" @click="loadChart(chartSymbol, iv)">
                {{ iv }}
              </button>
            </div>
          </div>
          <div class="kline-container" ref="klineEl"></div>
          <div class="depth-inline" v-if="depthTick">
            <div class="depth-asks">
              <div v-for="i in 5" :key="'a'+i" class="depth-row"
                @click="fillPrice(depthTick['ask_price_'+i])">
                <span class="depth-price ask">{{ fmtPrice(depthTick['ask_price_'+i]) }}</span>
                <span class="depth-vol">{{ fmtVol(depthTick['ask_volume_'+i]) }}</span>
                <span class="depth-label">卖{{ i }}</span>
              </div>
            </div>
            <div class="depth-mid">
              <span class="depth-last" :class="chgCls(depthTick)">{{ fmtPrice(depthTick.last_price) }}</span>
              <span class="depth-chg" :class="chgCls(depthTick)">{{ chgText(depthTick) }}</span>
            </div>
            <div class="depth-bids">
              <div v-for="i in 5" :key="'b'+i" class="depth-row"
                @click="fillPrice(depthTick['bid_price_'+i])">
                <span class="depth-label">买{{ i }}</span>
                <span class="depth-vol">{{ fmtVol(depthTick['bid_volume_'+i]) }}</span>
                <span class="depth-price bid">{{ fmtPrice(depthTick['bid_price_'+i]) }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Trade Form -->
        <div class="trading-form panel">
          <div class="panel-header"><span class="panel-title">📝 下单</span></div>
          <div class="panel-body form-grid">
            <div class="form-row">
              <label>交易所</label>
              <select v-model="form.exchange" @change="onExchange" class="input">
                <option value="">选择交易所</option>
                <option v-for="ex in exchanges" :value="ex.value" :key="ex.value">{{ ex.name }}</option>
              </select>
            </div>
            <div class="form-row">
              <label>品种</label>
              <select v-model="form.product" @change="onProduct" class="input" :disabled="!form.exchange">
                <option value="">选择品种</option>
                <option v-for="p in products" :value="p.prefix" :key="p.prefix">{{ p.prefix }} — {{ p.name }}</option>
              </select>
            </div>
            <div class="form-row">
              <label>合约</label>
              <select v-model="form.symbol" @change="onSymbol" class="input" :disabled="!form.product">
                <option value="">选择合约</option>
                <option v-for="c in filteredContracts" :value="c.vt_symbol" :key="c.vt_symbol">
                  {{ c.expired ? '⚠️ ' : '' }}{{ c.symbol }} — {{ c.name }}
                </option>
              </select>
              <label class="checkbox-label" style="font-size:11px;margin-top:2px">
                <input type="checkbox" v-model="showExpired" style="width:auto"> 显示到期合约
              </label>
            </div>
            <div class="form-row">
              <label>合约名称</label>
              <div class="readonly-field">{{ contractName || '—' }}</div>
            </div>
            <div class="form-row">
              <label>方向</label>
              <select v-model="form.direction" class="input">
                <option value="LONG">🟥 多头</option>
                <option value="SHORT">🟩 空头</option>
              </select>
            </div>
            <div class="form-row">
              <label>开平</label>
              <select v-model="form.offset" class="input">
                <option value="OPEN">开仓</option>
                <option value="CLOSE">平仓</option>
                <option value="CLOSETODAY">平今</option>
                <option value="CLOSEYESTERDAY">平昨</option>
              </select>
            </div>
            <div class="form-row">
              <label>类型</label>
              <select v-model="form.orderType" class="input">
                <option value="LIMIT">限价</option>
                <option value="MARKET">市价</option>
                <option value="STOP">止损</option>
                <option value="FAK">FAK</option>
                <option value="FOK">FOK</option>
              </select>
            </div>
            <div class="form-row">
              <label>价格</label>
              <div style="display:flex;gap:4px">
                <input v-model="form.price" class="input" placeholder="价格" style="flex:1">
                <label class="checkbox-label" style="font-size:11px;white-space:nowrap">
                  <input type="checkbox" v-model="autoPrice" style="width:auto"> 自动
                </label>
              </div>
            </div>
            <div class="form-row">
              <label>数量</label>
              <input v-model="form.volume" class="input" placeholder="数量" type="number" min="1">
            </div>
            <div class="form-row">
              <label>网关</label>
              <select v-model="form.gateway" class="input">
                <option v-for="gw in store.gateways" :value="gw" :key="gw">{{ gw }}</option>
                <option value="">自动</option>
              </select>
            </div>
            <div class="form-actions">
              <button class="btn btn-long" @click="placeOrder('LONG')"
                :disabled="!canOrder">🟥 买入开多</button>
              <button class="btn btn-short" @click="placeOrder('SHORT')"
                :disabled="!canOrder">🟩 卖出开空</button>
            </div>
            <div class="form-actions" style="margin-top:4px">
              <button class="btn btn-sm btn-danger" @click="cancelAll">✕ 全部撤单</button>
              <button class="btn btn-sm btn-warn" @click="closeAll">⚡ 一键全平</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Ticker Strip -->
      <div class="ticker-strip" v-if="tickList.length">
        <div v-for="t in tickList" :key="t.vt_symbol" class="ticker-item" @click="onPickTick(t)">
          <span class="sym">{{ t.vt_symbol.split('.')[0] }}</span>
          <span class="price" :class="chgCls(t)">{{ fmtPrice(t.last_price) }}</span>
          <span class="chg" :class="chgCls(t)">{{ chgText(t) }}</span>
        </div>
      </div>

      <!-- Tick Table -->
      <div class="panel" style="flex:0 0 auto; max-height:200px; margin:0 6px" v-if="tickList.length">
        <div class="panel-header">
          <span class="panel-title">📈 行情 Tick</span>
          <span class="panel-badge">{{ tickList.length }}</span>
          <button class="btn btn-xs" @click="exportTicks" style="margin-left:auto">CSV</button>
        </div>
        <div class="panel-body" style="overflow:auto; max-height:160px">
          <table class="data-table">
            <thead><tr>
              <th @click="sortTick('vt_symbol')">合约</th>
              <th class="num" @click="sortTick('last_price')">最新价</th>
              <th class="num" @click="sortTick('volume')">成交量</th>
              <th class="num" @click="sortTick('open_price')">开盘</th>
              <th class="num" @click="sortTick('high_price')">最高</th>
              <th class="num" @click="sortTick('low_price')">最低</th>
              <th class="num">买一价</th><th class="num">买一量</th>
              <th class="num">卖一价</th><th class="num">卖一量</th>
              <th class="num">时间</th>
            </tr></thead>
            <tbody>
              <tr v-for="t in sortedTickList" :key="t.vt_symbol" @click="onPickTick(t)" style="cursor:pointer">
                <td>{{ t.vt_symbol }}</td>
                <td class="num" :class="chgCls(t)">{{ fmtPrice(t.last_price) }}</td>
                <td class="num">{{ fmtVol(t.volume) }}</td>
                <td class="num">{{ fmtPrice(t.open_price) }}</td>
                <td class="num">{{ fmtPrice(t.high_price) }}</td>
                <td class="num">{{ fmtPrice(t.low_price) }}</td>
                <td class="num bid">{{ fmtPrice(t.bid_price_1) }}</td>
                <td class="num">{{ t.bid_volume_1 }}</td>
                <td class="num ask">{{ fmtPrice(t.ask_price_1) }}</td>
                <td class="num">{{ t.ask_volume_1 }}</td>
                <td class="num" style="font-size:10px">{{ timeStr(t.datetime || t.time) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Bottom Tables -->
      <div class="trading-bottom">
        <!-- Position Table -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">💼 持仓</span>
            <span class="panel-badge">{{ posList.length }}</span>
          </div>
          <div class="panel-body" style="overflow:auto">
            <table class="data-table">
              <thead><tr>
                <th @click="sortPos('symbol')">合约 ↕</th>
                <th class="num" @click="sortPos('direction')">方向</th>
                <th class="num" @click="sortPos('volume')">数量</th>
                <th class="num">昨仓</th>
                <th class="num" @click="sortPos('price')">均价</th>
                <th class="num" @click="sortPos('pnl')">盈亏</th>
                <th class="num">操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="p in posList" :key="p.vt_positionid">
                  <td>{{ p.vt_symbol }}</td>
                  <td :class="p.direction === 'LONG' ? 'up' : 'down'">{{ p.direction === 'LONG' ? '多' : '空' }}</td>
                  <td class="num">{{ p.volume }}</td>
                  <td class="num">{{ p.yd_volume || 0 }}</td>
                  <td class="num">{{ fmtPrice(p.price) }}</td>
                  <td class="num" :class="pnlCls(p)">{{ fmtPrice(p.position_profit || p.pnl) }}</td>
                  <td><button class="btn btn-xs btn-danger" @click="closePos(p)">平仓</button></td>
                </tr>
                <tr v-if="posList.length === 0"><td colspan="7" class="empty">暂无持仓</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <!-- Orders + Trades (tabbed) -->
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">📋 订单</span>
            <span class="panel-badge">{{ orderList.length }}</span>
            <div style="margin-left:auto;display:flex;gap:4px">
              <button class="btn btn-xs" :class="{ 'btn-primary': orderFilter === 'active' }"
                @click="orderFilter = 'active'">活动</button>
              <button class="btn btn-xs" :class="{ 'btn-primary': orderFilter === 'all' }"
                @click="orderFilter = 'all'">全部</button>
            </div>
            <button class="btn btn-xs" @click="exportOrders">CSV</button>
          </div>
          <div class="panel-body" style="overflow:auto;max-height:200px">
            <table class="data-table">
              <thead><tr>
                <th>订单号</th><th>合约</th><th>方向</th><th>价格</th><th>数量</th><th>已成交</th><th>状态</th><th>时间</th><th>操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="o in filteredOrders" :key="o.orderid || o.vt_orderid">
                  <td>{{ (o.orderid || '').toString().slice(-8) }}</td>
                  <td>{{ o.vt_symbol }}</td>
                  <td :class="o.direction === 'LONG' ? 'up' : 'down'">{{ o.direction === 'LONG' ? '多' : '空' }}/{{ o.offset }}</td>
                  <td class="num">{{ fmtPrice(o.price) }}</td>
                  <td class="num">{{ o.volume }}</td>
                  <td class="num">{{ o.traded }}</td>
                  <td>{{ statusText(o.status) }}</td>
                  <td class="num">{{ timeStr(o.order_time || o.create_time) }}</td>
                  <td><button v-if="isActiveOrder(o)" class="btn btn-xs btn-danger" @click="cancelOrder(o)">撤单</button></td>
                </tr>
                <tr v-if="filteredOrders.length === 0"><td colspan="9" class="empty">暂无订单</td></tr>
              </tbody>
            </table>
            <div style="font-size:11px;color:var(--text-dim);padding:4px 12px;font-weight:600;margin-top:8px">成交记录</div>
            <table class="data-table">
              <thead><tr>
                <th>成交号</th><th>合约</th><th>方向</th><th>价格</th><th>数量</th><th>时间</th>
              </tr></thead>
              <tbody>
                <tr v-for="t in tradeList" :key="t.tradeid">
                  <td>{{ (t.tradeid || '').toString().slice(-8) }}</td>
                  <td>{{ t.vt_symbol }}</td>
                  <td :class="t.direction === 'LONG' ? 'up' : 'down'">{{ t.direction === 'LONG' ? '多' : '空' }}</td>
                  <td class="num">{{ fmtPrice(t.price) }}</td>
                  <td class="num">{{ t.volume }}</td>
                  <td class="num">{{ timeStr(t.trade_time || t.time) }}</td>
                </tr>
                <tr v-if="tradeList.length === 0"><td colspan="6" class="empty">暂无成交</td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <!-- Account Summary -->
        <div class="panel">
          <div class="panel-header"><span class="panel-title">💰 账户</span></div>
          <div class="panel-body" style="overflow:auto">
            <table class="data-table">
              <thead><tr><th>账户ID</th><th class="num">余额</th><th class="num">冻结</th><th class="num">可用</th><th>网关</th></tr></thead>
              <tbody>
                <tr v-for="a in accountList" :key="a.vt_accountid">
                  <td>{{ a.vt_accountid }}</td>
                  <td class="num">{{ fmtPrice(a.balance) }}</td>
                  <td class="num">{{ fmtPrice(a.frozen) }}</td>
                  <td class="num">{{ fmtPrice(a.available) }}</td>
                  <td>{{ a.gateway_name }}</td>
                </tr>
                <tr v-if="accountList.length === 0"><td colspan="5" class="empty">暂无账户</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`,
  setup() {
    const klineEl = ref(null);
    let chartInstance = null;
    const chartSymbol = ref('');
    const chartInterval = ref('1m');
    const depthTick = ref(null);
    const showExpired = ref(false);
    const autoPrice = ref(false);
    const orderFilter = ref('active');
    const form = reactive({ exchange:'', product:'', symbol:'', direction:'LONG', offset:'OPEN', orderType:'LIMIT', price:'', volume:'1', gateway:'' });
    const exchanges = [
      { value:'CFFEX', name:'中金所' }, { value:'SHFE', name:'上期所' },
      { value:'DCE', name:'大商所' }, { value:'CZCE', name:'郑商所' },
      { value:'INE', name:'上海能源' }, { value:'GFEX', name:'广期所' },
    ];
    const products = ref([]);
    const contracts = ref([]);
    const posSortKey = ref('');
    const posSortDir = ref(1);

    // ---- Computed ----
    const tickList = computed(() => Object.values(store.tick));
    const orderList = computed(() => Object.values(store.order).sort((a, b) =>
      (b.order_time || b.create_time || 0) - (a.order_time || a.create_time || 0)));
    const tradeList = computed(() => Object.values(store.trade).sort((a, b) =>
      (b.trade_time || b.time || 0) - (a.trade_time || a.time || 0)));
    const posList = computed(() => {
      let arr = Object.values(store.position);
      if (posSortKey.value) {
        arr = [...arr].sort((a, b) => {
          const va = a[posSortKey.value] || 0, vb = b[posSortKey.value] || 0;
          return (va > vb ? 1 : -1) * posSortDir.value;
        });
      }
      return arr;
    });
    const accountList = computed(() => Object.values(store.account));
    const contractName = computed(() => {
      const c = contracts.value.find(c => c.vt_symbol === form.symbol);
      return c ? c.name : '';
    });
    const filteredContracts = computed(() => {
      return contracts.value.filter(c => showExpired.value ? true : !c.expired);
    });
    const filteredOrders = computed(() => {
      if (orderFilter.value === 'active') return orderList.value.filter(o => isActiveOrder(o));
      return orderList.value;
    });
    const canOrder = computed(() => form.symbol && form.volume > 0);

    // ---- Methods ----
    function statusText(s) {
      const map = { SUBMITTING:'提交中', NOTTRADED:'未成交', PARTTRADED:'部分成交', ALLTRADED:'全部成交', CANCELLED:'已撤销', REJECTED:'已拒绝' };
      return map[s] || s;
    }
    function isActiveOrder(o) {
      return ['SUBMITTING','NOTTRADED','PARTTRADED'].includes(o.status);
    }
    function chgCls(t) {
      const prev = t.pre_close || t.open_price || t.last_price || 0;
      return t.last_price > prev ? 'up' : (t.last_price < prev ? 'down' : '');
    }
    function chgText(t) {
      const prev = t.pre_close || t.open_price || t.last_price || 0;
      if (!prev) return '-';
      return ((t.last_price - prev) / prev * 100).toFixed(2) + '%';
    }
    function pnlCls(p) {
      const v = p.position_profit || p.pnl || 0;
      return v > 0 ? 'up' : (v < 0 ? 'down' : '');
    }
    function sortPos(key) {
      if (posSortKey.value === key) { posSortDir.value *= -1; }
      else { posSortKey.value = key; posSortDir.value = 1; }
    }

    // ---- K-Line Chart ----
    function initChart() {
      if (!klineEl.value) return;
      chartInstance = echarts.init(klineEl.value, 'dark');
      chartInstance.setOption({
        backgroundColor: '#0f1117',
        grid: [{ left:'8%', right:'8%', top:'8%', height:'55%' }, { left:'8%', right:'8%', top:'72%', height:'20%' }],
        xAxis: [{ type:'category', gridIndex:0, axisLabel:{show:false} }, { type:'category', gridIndex:1 }],
        yAxis: [{ type:'value', gridIndex:0, scale:true }, { type:'value', gridIndex:1, scale:true }],
        series: [
          { name:'K线', type:'candlestick', xAxisIndex:0, yAxisIndex:0,
            itemStyle:{color:'#ef4444',color0:'#22c55e',borderColor:'#ef4444',borderColor0:'#22c55e'} },
          { name:'成交量', type:'bar', xAxisIndex:1, yAxisIndex:1,
            itemStyle:{color:params=>params.data[2]>0?'#22c55e':'#ef4444'} }
        ],
        tooltip: { trigger:'axis' },
        dataZoom: [{ type:'inside', xAxisIndex:[0,1] }, { type:'slider', xAxisIndex:[0,1], bottom:'2%' }],
      });
      window.addEventListener('resize', () => chartInstance?.resize());
    }

    async function loadChart(vtSymbol, interval) {
      if (!vtSymbol) return;
      chartSymbol.value = vtSymbol;
      chartInterval.value = interval || '1m';
      try {
        const parts = vtSymbol.split('.');
        const exchange = parts.length > 1 ? parts[1] : 'CFFEX';
        const data = await $apiGet(`/api/bars?symbol=${parts[0]}&exchange=${exchange}&interval=${chartInterval.value}&start=&end=`);
        if (data && data.length && chartInstance) {
          const ohlcv = data.map(d => [d.datetime, d.open_price, d.close_price, d.low_price, d.high_price, d.volume || 0]);
          chartInstance.setOption({
            xAxis: [{ data: ohlcv.map(d => d[0]) }, { data: ohlcv.map(d => d[0]) }],
            series: [{ data: ohlcv }, { data: ohlcv.map(d => [d[0], d[5], d[1] > d[2] ? 1 : -1]) }]
          });
        }
      } catch(e) { console.error('load chart:', e); }
    }

    function addTickToChart(tick) {
      if (!chartInstance || !chartSymbol.value) return;
      if (tick.vt_symbol !== chartSymbol.value) return;
      // Real-time tick merge — ECharts appendData approach
      const lastData = chartInstance.getOption().series[0].data;
      if (!lastData || !lastData.length) return;
      const last = lastData[lastData.length - 1];
      if (!last) return;
      const newHigh = Math.max(last[4], tick.last_price);
      const newLow = Math.min(last[3], tick.last_price);
      const newClose = tick.last_price;
      chartInstance.setOption({
        series: [
          { data: [...lastData.slice(0, -1), [last[0], last[1], newClose, newLow, newHigh]] },
          { data: [...chartInstance.getOption().series[1].data.slice(0, -1),
            [last[0], (last[5]||0) + (tick.volume||0), tick.last_price <= last[1] ? 1 : -1]] }
        ]
      });
    }

    // ---- Trade Form ----
    async function onExchange() {
      form.product = ''; form.symbol = ''; products.value = [];
      if (!form.exchange) return;
      try {
        const data = await $apiGet(`/api/contracts/products?exchange=${form.exchange}`) || {}; products.value = Array.isArray(data) ? data : (data.products || []);
      } catch(e) { $toast('加载品种失败', 'error'); }
    }
    async function onProduct() {
      form.symbol = '';
      if (!form.product) return;
      try {
        const raw = await $apiGet(`/api/contracts/public?exchange=${form.exchange}&product=${form.product}`) || {}; const list = Array.isArray(raw) ? raw : (raw.contracts || []); contracts.value = list.map(c => ({...c, expired: isExpired(c.symbol || c.vt_symbol || '') }));
      } catch(e) { $toast('加载合约失败', 'error'); }
    }
    function onSymbol() {
      if (form.symbol) {
        $restSubscribe(form.symbol, form.exchange, form.gateway);
        nextTick(() => loadChart(form.symbol, '1m'));
      }
    }
    function fillPrice(price) { if (price) form.price = String(price); }
    function onPickTick(tick) {
      form.exchange = tick.exchange || '';
      form.symbol = tick.vt_symbol || '';
      if (autoPrice.value) form.price = String(tick.last_price);
      depthTick.value = tick;
      loadChart(tick.vt_symbol, '1m');
    }
    async function placeOrder(dir) {
      if (!canOrder.value) return;
      const parts = (form.symbol || '').split('.');
      await $restSendOrder({
        symbol: parts[0], exchange: parts[1] || form.exchange,
        direction: dir, offset: form.offset, price: form.orderType === 'MARKET' ? 0 : parseFloat(form.price) || 0,
        volume: parseInt(form.volume) || 1, order_type: form.orderType,
        reference: 'ManualTrading', gateway: form.gateway || ''
      });
    }
    function cancelOrder(order) {
      $restCancelOrder(order.orderid || order.vt_orderid, order.symbol, order.exchange, order.gateway_name || '');
    }
    function cancelAll() {
      Object.values(store.order).forEach(o => { if (isActiveOrder(o)) cancelOrder(o); });
    }
    function closeAll() {
      Object.values(store.position).forEach(p => {
        const parts = (p.vt_symbol || '').split('.');
        const oppDir = p.direction === 'LONG' ? 'SHORT' : 'LONG';
        $restSendOrder({ symbol: parts[0], exchange: parts[1] || p.exchange, direction: oppDir, offset: 'CLOSE',
          price: 0, volume: p.volume, order_type: 'MARKET', reference: 'QuickClose', gateway: '' });
      });
      $toast('已发送全平指令', 'info');
    }
    function closePos(pos) {
      const parts = (pos.vt_symbol || '').split('.');
      const oppDir = pos.direction === 'LONG' ? 'SHORT' : 'LONG';
      $restSendOrder({ symbol: parts[0], exchange: parts[1] || pos.exchange, direction: oppDir, offset: 'CLOSE',
        price: 0, volume: pos.volume, order_type: 'MARKET', reference: 'QuickClose', gateway: '' });
    }
    function exportOrders() {
      const h = ['订单号','合约','方向/开平','价格','数量','已成交','状态','时间'];
      const rows = orderList.value.map(o => [o.orderid, o.vt_symbol, o.direction+'/'+o.offset, o.price, o.volume, o.traded, statusText(o.status), o.order_time]);
      $exportCSV(h, rows, `orders_${new Date().toISOString().slice(0,10)}.csv`);
    }

    // ---- Watch tick for chart/depth updates ----
    watch(() => store.tick, () => {
      const ticks = Object.values(store.tick);
      if (ticks.length && chartSymbol.value) {
        const t = ticks.find(t => t.vt_symbol === chartSymbol.value);
        if (t) { depthTick.value = t; addTickToChart(t); }
      }
    }, { deep: true });

    onMounted(() => {
      nextTick(() => { initChart(); });
    });
    // ---- Tick sorting ----
    const tickSortKey = ref('');
    const tickSortDir = ref(1);
    const sortedTickList = computed(() => {
      let arr = Object.values(store.tick);
      if (tickSortKey.value) {
        arr = [...arr].sort((a, b) => {
          const va = a[tickSortKey.value] || 0, vb = b[tickSortKey.value] || 0;
          return (va > vb ? 1 : -1) * tickSortDir.value;
        });
      }
      return arr;
    });
    function sortTick(key) {
      if (tickSortKey.value === key) { tickSortDir.value *= -1; }
      else { tickSortKey.value = key; tickSortDir.value = 1; }
    }
    function exportTicks() {
      $exportCSV(['合约','最新价','成交量','开盘','最高','最低','买一价','买一量','卖一价','卖一量','时间'],
        sortedTickList.value.map(t => [t.vt_symbol, t.last_price, t.volume, t.open_price, t.high_price, t.low_price, t.bid_price_1, t.bid_volume_1, t.ask_price_1, t.ask_volume_1, t.datetime || t.time]),
        'ticks_' + new Date().toISOString().slice(0,10) + '.csv');
    }

    onUnmounted(() => {
      if (chartInstance) { chartInstance.dispose(); chartInstance = null; }
    });

    return {
      klineEl, chartSymbol, chartInterval, depthTick, showExpired, autoPrice, orderFilter,
      form, exchanges, products, posSortKey, posSortDir, tickSortKey, tickSortDir,
      tickList, sortedTickList, orderList, tradeList, posList, accountList, contractName,
      filteredContracts, filteredOrders, canOrder,
      statusText, isActiveOrder, chgCls, chgText, pnlCls, sortPos, sortTick,
      loadChart, fillPrice, onPickTick, onExchange, onProduct, onSymbol,
      placeOrder, cancelOrder, cancelAll, closeAll, closePos, exportOrders, exportTicks,
      store, fmtPrice: $fmtPrice, fmtVol: $fmtVol, timeStr: $timeStr,
    };
  }
};
