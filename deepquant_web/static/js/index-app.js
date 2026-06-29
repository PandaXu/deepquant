// ===== DeepQuant Trading Dashboard — Vue 3 App =====
const { createApp, ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

// ---- Order Status ----
const ORDER_STATUS = {
  SUBMITTING:'提交中', NOTTRADED:'未成交', PARTTRADED:'部分成交',
  ALLTRADED:'全部成交', CANCELLED:'已撤销', REJECTED:'已拒绝'
};

// ===== Components =====

// ---- Ticker Strip ----
const TickerStrip = {
  template: `
    <div class="ticker-strip" v-if="items.length">
      <div v-for="t in items" :key="t.vt_symbol" class="ticker-item"
        @click="$emit('pick', t)">
        <span class="sym">{{ symShort(t.vt_symbol) }}</span>
        <span class="price" :class="chgCls(t)">{{ fmtPrice(t.last_price) }}</span>
        <span class="chg" :class="chgCls(t)">{{ chgText(t) }}</span>
      </div>
    </div>`,
  props: { items: { type: Array, default: () => [] } },
  emits: ['pick'],
  methods: {
    symShort(s) { return (s || '').split('.')[0]; },
    fmtPrice(v) { return v != null ? Number(v).toFixed(2) : '-'; },
    chgCls(t) {
      const prev = t.pre_close || t.open_price || t.last_price || 0;
      const lp = t.last_price || 0;
      return lp > prev ? 'up' : (lp < prev ? 'down' : '');
    },
    chgText(t) {
      const prev = t.pre_close || t.open_price || t.last_price || 0;
      if (!prev) return '-';
      const chg = (t.last_price - prev) / prev * 100;
      return (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    }
  }
};

// ---- Tick Table ----
const TickTable = {
  template: `
    <table class="data-table">
      <thead><tr>
        <th @click="sort('vt_symbol')">合约</th>
        <th class="num" @click="sort('last_price')">最新价</th>
        <th class="num" @click="sort('change')">涨跌</th>
        <th class="num">买一</th><th class="num">卖一</th>
        <th class="num" @click="sort('volume')">成交量</th>
        <th class="num">持仓</th>
      </tr></thead>
      <tbody>
        <tr v-for="t in sorted" :key="t.vt_symbol"
          @click="$emit('pick', t)" style="cursor:pointer">
          <td>{{ symShort(t.vt_symbol) }}</td>
          <td class="num" :class="chgCls(t)">{{ fmtPrice(t.last_price) }}</td>
          <td class="num" :class="chgCls(t)">{{ chgText(t) }}</td>
          <td class="num">{{ fmtPrice(t.bid_price_1) }}</td>
          <td class="num">{{ fmtPrice(t.ask_price_1) }}</td>
          <td class="num">{{ fmtVol(t.volume) }}</td>
          <td class="num">{{ fmtVol(t.open_interest) }}</td>
        </tr>
      </tbody>
    </table>`,
  props: { items: { type: Array, default: () => [] } },
  emits: ['pick'],
  data() { return { sortKey: '', sortDir: 0 }; },
  computed: {
    sorted() {
      let arr = [...this.items];
      if (this.sortKey && this.sortDir) {
        arr.sort((a, b) => {
          const va = a[this.sortKey]; const vb = b[this.sortKey];
          return (va > vb ? 1 : (va < vb ? -1 : 0)) * this.sortDir;
        });
      }
      return arr;
    }
  },
  methods: {
    symShort(s) { return (s || '').split('.')[0]; },
    fmtPrice(v) { return v != null ? Number(v).toFixed(2) : '-'; },
    fmtVol(v) { return v != null ? Number(v).toLocaleString() : '-'; },
    sort(k) {
      if (this.sortKey === k) this.sortDir = this.sortDir === 1 ? -1 : (this.sortDir === -1 ? 0 : 1);
      else { this.sortKey = k; this.sortDir = 1; }
    },
    chgCls(t) {
      const prev = t.pre_close || t.open_price || t.last_price || 0;
      return t.last_price > prev ? 'up' : (t.last_price < prev ? 'down' : '');
    },
    chgText(t) {
      const prev = t.pre_close || t.open_price || t.last_price || 0;
      if (!prev) return '-';
      const chg = (t.last_price - prev) / prev * 100;
      return (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%';
    }
  }
};

// ---- Order Table ----
const OrderTable = {
  template: `
    <table class="data-table">
      <thead><tr>
        <th>订单号</th><th>合约</th><th>方向</th><th class="num">价格</th>
        <th class="num">数量</th><th class="num">已成交</th><th>状态</th>
        <th>时间</th><th></th>
      </tr></thead>
      <tbody>
        <tr v-for="o in sorted" :key="o.orderid || o.vt_orderid">
          <td>{{ o.orderid || o.vt_orderid || '' }}</td>
          <td>{{ symShort(o.vt_symbol || o.symbol) }}</td>
          <td :class="dirCls(o)">{{ o.direction }}{{ o.offset ? '/' + o.offset : '' }}</td>
          <td class="num">{{ fmtPrice(o.price) }}</td>
          <td class="num">{{ fmtVol(o.volume) }}</td>
          <td class="num">{{ fmtVol(o.traded_volume) }}</td>
          <td>{{ ORDER_STATUS[o.status] || o.status }}</td>
          <td>{{ o.order_time || '' }}</td>
          <td><button v-if="canCancel(o)" class="btn btn-xs btn-warn"
            @click.stop="$emit('cancel', o)">撤单</button></td>
        </tr>
      </tbody>
    </table>`,
  props: { items: { type: Array, default: () => [] } },
  emits: ['cancel'],
  data() { return { ORDER_STATUS }; },
  computed: {
    sorted() {
      return [...this.items].sort((a, b) =>
        (b.order_time || b.create_time || '').localeCompare(a.order_time || a.create_time || ''));
    }
  },
  methods: {
    symShort(s) { return (s || '').split('.')[0]; },
    fmtPrice(v) { return v != null ? Number(v).toFixed(2) : '-'; },
    fmtVol(v) { return v != null ? Number(v).toLocaleString() : '-'; },
    dirCls(o) { return /多|LONG|BUY/i.test(o.direction||'') ? 'up' : 'down'; },
    canCancel(o) { return ['SUBMITTING','NOTTRADED','PARTTRADED','提交中','未成交','部分成交'].includes(o.status||''); }
  }
};

// ---- Trade Table ----
const TradeTable = {
  template: `
    <table class="data-table">
      <thead><tr><th>成交号</th><th>合约</th><th>方向</th><th class="num">价格</th><th class="num">数量</th><th>时间</th></tr></thead>
      <tbody>
        <tr v-for="t in sorted" :key="t.tradeid || t.vt_tradeid">
          <td>{{ t.tradeid || t.vt_tradeid }}</td>
          <td>{{ symShort(t.vt_symbol || t.symbol) }}</td>
          <td :class="dirCls(t)">{{ t.direction }}{{ t.offset ? '/' + t.offset : '' }}</td>
          <td class="num">{{ fmtPrice(t.price) }}</td>
          <td class="num">{{ fmtVol(t.volume) }}</td>
          <td>{{ t.trade_time || t.time }}</td>
        </tr>
      </tbody>
    </table>`,
  props: { items: { type: Array, default: () => [] } },
  computed: {
    sorted() {
      return [...this.items].sort((a, b) =>
        (b.trade_time || b.time || '').localeCompare(a.trade_time || a.time || ''));
    }
  },
  methods: {
    symShort(s) { return (s || '').split('.')[0]; },
    fmtPrice(v) { return v != null ? Number(v).toFixed(2) : '-'; },
    fmtVol(v) { return v != null ? Number(v).toLocaleString() : '-'; },
    dirCls(t) { return /多|LONG|BUY/i.test(t.direction||'') ? 'up' : 'down'; }
  }
};

// ---- Position Table ----
const PositionTable = {
  template: `
    <table class="data-table">
      <thead><tr><th>合约</th><th>方向</th><th class="num">数量</th><th class="num">均价</th><th class="num">现价</th><th class="num">盈亏</th><th class="num">盈亏%</th></tr></thead>
      <tbody>
        <tr v-for="p in items" :key="p.vt_positionid || p.vt_symbol">
          <td>{{ symShort(p.vt_symbol || p.symbol) }}</td>
          <td :class="dirCls(p)">{{ p.direction }}</td>
          <td class="num">{{ fmtVol(p.volume) }}</td>
          <td class="num">{{ fmtPrice(p.price) }}</td>
          <td class="num">{{ fmtPrice(p.last_price || p.market_price) }}</td>
          <td class="num" :class="pnlCls(p)">{{ pnlFmt(p).text }}</td>
          <td class="num" :class="pnlCls(p)">{{ pnlPct(p) }}</td>
        </tr>
      </tbody>
    </table>`,
  props: { items: { type: Array, default: () => [] } },
  methods: {
    symShort(s) { return (s || '').split('.')[0]; },
    fmtPrice(v) { return v != null ? Number(v).toFixed(2) : '-'; },
    fmtVol(v) { return v != null ? Number(v).toLocaleString() : '-'; },
    dirCls(p) { return /多|LONG/i.test(p.direction||'') ? 'up' : 'down'; },
    pnlCls(p) { return (p.pnl || p.position_profit || 0) >= 0 ? 'up' : 'down'; },
    pnlFmt(p) {
      const v = p.pnl || p.position_profit || 0;
      return { text: (v >= 0 ? '+' : '') + Number(v).toFixed(2) };
    },
    pnlPct(p) {
      const pp = p.pnl_percent;
      if (pp == null) return '-';
      return (pp >= 0 ? '+' : '') + (pp * 100).toFixed(2) + '%';
    }
  }
};

// ---- Account Summary ----
const AccountSummary = {
  template: `
    <div class="acc-summary" v-if="account">
      <div class="acc-item"><span class="label">余额</span><div class="value">{{ fmtPrice(account.balance || account.available) }}</div></div>
      <div class="acc-item"><span class="label">可用</span><div class="value">{{ fmtPrice(account.available) }}</div></div>
      <div class="acc-item"><span class="label">冻结</span><div class="value">{{ fmtPrice(account.frozen || account.margin) }}</div></div>
      <div class="acc-item"><span class="label">浮动盈亏</span><div class="pnl" :class="pnlCls(account.position_profit)">{{ pnlFmt(account.position_profit) }}</div></div>
      <div class="acc-item"><span class="label">平仓盈亏</span><div class="pnl" :class="pnlCls(account.close_profit)">{{ pnlFmt(account.close_profit) }}</div></div>
    </div>
    <div class="acc-summary" v-else>
      <div class="acc-item"><span class="label">暂无账户数据</span></div>
    </div>`,
  props: { account: Object },
  methods: {
    fmtPrice(v) { return v != null ? Number(v).toFixed(2) : '-'; },
    pnlCls(v) { return (v || 0) >= 0 ? 'positive' : 'negative'; },
    pnlFmt(v) {
      const n = v || 0;
      return (n >= 0 ? '+' : '') + Number(n).toFixed(2);
    }
  }
};

// ---- Log Panel ----
const LogPanel = {
  template: `
    <div ref="el">
      <div v-for="(l, i) in items" :key="i" class="log-entry" :class="logCls(l)">
        <span class="ts">{{ timeStr(l.time || l.timestamp) }}</span>{{ l.msg || l.message }}
      </div>
    </div>`,
  props: { items: { type: Array, default: () => [] } },
  watch: {
    items: { flush: 'post', handler() { this.$nextTick(() => { const e = this.$refs.el; if (e) e.scrollTop = e.scrollHeight; }); } }
  },
  methods: {
    timeStr(ts) {
      if (!ts) return '';
      if (typeof ts === 'string') return ts.slice(-8);
      return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
    },
    logCls(l) {
      const m = l.msg || l.message || '';
      if (/error|错误|失败|拒绝/i.test(m)) return 'error';
      if (/warn|警告|异常/i.test(m)) return 'warn';
      return 'info';
    }
  }
};

// ---- Contract Cascade helpers ----
const _prodCache = {}, _contractCache = {};

// ---- Trade Form (toolbar) ----
const TradeForm = {
  template: `
    <div id="toolbar">
      <span>交易所:</span>
      <select v-model="tf.exchange" @change="onExchange">
        <option value="">选择</option>
        <option v-for="e in exchanges" :value="e[0]">{{ e[0] }}</option>
      </select>
      <span>品种:</span>
      <select v-model="tf.product" @change="onProduct"><option value="">全部</option>
        <option v-for="p in products" :value="p.prefix">{{ p.prefix }} — {{ p.name }}</option>
      </select>
      <span>合约:</span>
      <select v-model="tf.symbol" style="min-width:180px"><option value="">请选择合约</option>
        <option v-for="c in contracts" :value="c.vt_symbol">{{ c.symbol }} — {{ c.name }}{{ c.expired ? ' [已过期]' : '' }}</option>
      </select>
      <span class="sep"></span>
      <span>下单:</span>
      <input v-model="tf.price" placeholder="价格" style="width:80px">
      <input v-model.number="tf.volume" type="number" placeholder="量" style="width:60px">
      <select v-model="tf.orderType"><option value="LIMIT">限价</option><option value="MARKET">市价</option></select>
      <select v-model="tf.offset"><option value="OPEN">开仓</option><option value="CLOSE">平仓</option><option value="CLOSETODAY">平今</option></select>
      <select v-model="tf.gateway"><option value="">自动</option></select>
      <button class="btn btn-danger btn-sm" @click="$emit('order','LONG')">买入</button>
      <button class="btn btn-success btn-sm" @click="$emit('order','SHORT')">卖出</button>
    </div>`,
  emits: ['order'],
  data() {
    return {
      tf: reactive({ exchange:'', product:'', symbol:'', price:'', volume:1, orderType:'LIMIT', offset:'OPEN', gateway:'' }),
      products: [], contracts: [],
      exchanges: [['SHFE','上期所'],['DCE','大商所'],['CZCE','郑商所'],['CFFEX','中金所'],['INE','上海能源'],['GFEX','广期所']]
    };
  },
  methods: {
    async onExchange() {
      const ex = this.tf.exchange;
      if (!ex) return;
      this.tf.product = ''; this.tf.symbol = '';
      const cache = _prodCache[ex] || (_prodCache[ex] = await $apiGet(`/api/contracts/products?exchange=${encodeURIComponent(ex)}`).catch(()=>({products:[]})));
      this.products = cache.products || [];
      this.contracts = [];
    },
    async onProduct() {
      const ex = this.tf.exchange; const prod = this.tf.product;
      if (!ex) return;
      this.tf.symbol = '';
      const key = ex + '|' + prod;
      const cache = _contractCache[key] || (_contractCache[key] = await $apiGet(`/api/contracts?exchange=${encodeURIComponent(ex)}&product=${encodeURIComponent(prod)}`).catch(()=>({contracts:[]})));
      const list = (cache.contracts || []).map(c => ({ ...c, expired: isExpired(c.symbol) }));
      this.contracts = list;
    },
    quickFill(t) {
      const sym = t.vt_symbol || t.symbol;
      if (sym) this.tf.symbol = sym;
      this.tf.price = (t.last_price || t.ask_price_1 || 0).toFixed(2);
    },
    getPayload(dir) {
      return {
        symbol: this.tf.symbol,
        price: parseFloat(this.tf.price) || 0,
        volume: this.tf.volume || 0,
        order_type: this.tf.orderType,
        direction: dir,
        offset: this.tf.offset,
        gateway: this.tf.gateway,
        reference: 'ManualTrading'
      };
    }
  }
};

// ---- Depth Chart ----
const DepthChart = {
  template: `<div class="chart-container" ref="chart"></div>`,
  props: { symbol: String },
  data() { return { chart: null }; },
  mounted() {
    this.chart = echarts.init(this.$refs.chart);
    this.chart.setOption({
      backgroundColor: 'transparent',
      title: { text: '深度图', left:'center', top:8, textStyle:{color:'#6b7080',fontSize:11,fontWeight:400} },
      xAxis: { type:'category', show:false }, yAxis: { type:'value', show:false }, series: []
    });
    window.addEventListener('resize', this._resize);
  },
  unmounted() { this.chart?.dispose(); window.removeEventListener('resize', this._resize); },
  methods: {
    _resize() { this.chart?.resize(); },
    render(tick) {
      if (!this.chart || !tick) return;
      if (!tick.bid_prices || !tick.ask_prices) {
        this.chart.setOption({ title:{text: this.symbol ? this.symbol + ' 深度图' : '深度图'}, series:[] });
        return;
      }
      const bids = [], asks = [];
      let cumBid = 0;
      for (let i = Math.min(tick.bid_prices.length, 10) - 1; i >= 0; i--) {
        cumBid += tick.bid_volumes[i] || 0;
        bids.unshift({ price: tick.bid_prices[i], vol: cumBid });
      }
      let cumAsk = 0;
      for (let i = 0; i < Math.min(tick.ask_prices.length, 10); i++) {
        cumAsk += tick.ask_volumes[i] || 0;
        asks.push({ price: tick.ask_prices[i], vol: cumAsk });
      }
      this.chart.setOption({
        title: { text: (this.symbol||'') + ' 深度图' },
        xAxis: { data: [...bids.map(b=>b.price), ...asks.map(a=>a.price)] },
        series: [
          { name:'Bid', type:'bar', stack:'depth', data:bids.map(b=>b.vol), itemStyle:{color:'rgba(74,222,128,0.5)'}, barWidth:'99%' },
          { name:'Ask', type:'bar', stack:'depth', data:[...Array(bids.length).fill(null), ...asks.map(a=>a.vol)], itemStyle:{color:'rgba(251,113,133,0.5)'}, barWidth:'99%' }
        ]
      });
    }
  }
};

// ---- Status Bar ----
const StatusBar = {
  template: `
    <div id="statusbar">
      <span>委托 {{ orderCount }} | 成交 {{ tradeCount }} | 持仓 {{ posCount }}</span>
      <span style="margin-left:auto">{{ tickCount }} 行情</span>
    </div>`,
  props: ['orderCount', 'tradeCount', 'posCount', 'tickCount']
};

// ---- Account Modal ----
const AccountModal = {
  template: `
    <div class="modal-overlay" v-if="visible" @click.self="$emit('close')">
      <div class="modal">
        <h3>账户管理</h3>
        <table class="data-table">
          <thead><tr><th>账户ID</th><th>网关</th><th>余额</th><th>可用</th><th></th></tr></thead>
          <tbody>
            <tr v-for="a in accounts" :key="a.vt_accountid || a.accountid">
              <td>{{ a.vt_accountid || a.accountid }}</td>
              <td>{{ a.gateway_name || a.gateway }}</td>
              <td>{{ fmtPrice(a.balance) }}</td>
              <td>{{ fmtPrice(a.available) }}</td>
              <td><button class="btn btn-xs btn-danger" @click="del(a)">删除</button></td>
            </tr>
          </tbody>
        </table>
        <div class="btn-row"><button class="btn" @click="$emit('close')">关闭</button></div>
      </div>
    </div>`,
  props: { visible: Boolean, accounts: Array },
  emits: ['close', 'delete'],
  methods: {
    fmtPrice(v) { return v != null ? Number(v).toFixed(2) : '-'; },
    del(a) {
      if (!confirm('确认删除账户 ' + (a.vt_accountid || a.accountid) + '？')) return;
      this.$emit('delete', a);
    }
  }
};

// ===== Main App =====
const app = createApp({
  components: { TickerStrip, TickTable, OrderTable, TradeTable, PositionTable, AccountSummary, LogPanel, TradeForm, DepthChart, StatusBar, AccountModal },
  data() {
    return {
      $s,
      showAccountModal: false,
      depthSymbol: '',
    };
  },
  computed: {
    tickList() { return Object.values($s.tick); },
    orderList() { return Object.values($s.order); },
    tradeList() { return Object.values($s.trade); },
    positionList() { return Object.values($s.position); },
    accountList() { return Object.values($s.account); },
    firstAccount() { return this.accountList[0] || null; },
  },
  mounted() {
    watch(() => this.depthSymbol, sym => {
      const tick = $s.tick[sym];
      if (tick) this.$refs.depthChart?.render(tick);
    });
    watch(() => ({ ...$s.tick }), () => {
      if (this.depthSymbol && this.$refs.depthChart) {
        const tick = $s.tick[this.depthSymbol];
        if (tick) this.$refs.depthChart.render(tick);
      }
    }, { deep: false });
  },
  methods: {
    onPickTick(t) {
      this.$refs.tfRef?.quickFill(t);
      this.depthSymbol = t.vt_symbol || t.symbol;
      nextTick(() => {
        const tick = $s.tick[t.vt_symbol || t.symbol];
        if (tick) this.$refs.depthChart?.render(tick);
      });
    },
    onOrder(dir) {
      const payload = this.$refs.tfRef?.getPayload(dir);
      if (!payload || !payload.symbol || !payload.volume) {
        $toast('请选择合约并输入数量', 'error');
        return;
      }
      $wsSend({ action: 'send_order', payload });
    },
    onCancelOrder(o) {
      $wsSend({ action: 'cancel_order', payload: { orderid: o.orderid || o.vt_orderid } });
    },
    cancelAll() {
      Object.values($s.order).forEach(o => {
        const s = o.status || '';
        if (['SUBMITTING','NOTTRADED','PARTTRADED','提交中','未成交','部分成交'].includes(s)) {
          $wsSend({ action: 'cancel_order', payload: { orderid: o.orderid || o.vt_orderid, symbol: o.symbol, exchange: o.exchange, gateway: o.gateway || o.gateway_name } });
        }
      });
    },
    wsReconnect() { $wsConnect(); },
    refreshSub() { $wsSend({ action: 'subscribe_all' }); },
    delAccount(a) {
      const id = a.vt_accountid || a.accountid;
      $apiPost('/api/account/delete', { vt_accountid: id }).then(() => {
        delete $s.account[id];
        $toast('已删除', 'success');
      }).catch(e => $toast('删除失败: ' + e.message, 'error'));
    },
  }
});

app.mount('#app');
