// ===== DeepQuant App Manager — Vue 3 App =====
const { createApp, reactive, computed, watch, onMounted, onUnmounted, nextTick } = Vue;

const APP_NAME = new URLSearchParams(location.search).get('app') || 'PaperAccount';
const WS = { ws: null, pending: [] };

// ---- WS / API (standalone for apps page) ----
const _apiBase = localStorage.getItem('api_host') ||
  (() => { const p = new URLSearchParams(location.search); return p.get('api') || 'http://' + location.hostname + ':8888'; })();

function wsConnect() {
  const proto = _apiBase.startsWith('https') ? 'wss' : 'ws';
  const host = _apiBase.replace(/^https?:\/\//, '');
  WS.ws = new WebSocket(proto + '://' + host + '/ws');
  WS.ws.onopen = () => { WS.pending.forEach(m => WS.ws.send(m)); WS.pending = []; };
  WS.ws.onmessage = e => handleMsg(JSON.parse(e.data));
  WS.ws.onclose = () => { WS.pending = []; setTimeout(wsConnect, 2000); };
}
function wsSend(o) {
  const m = JSON.stringify(o);
  if (WS.ws && WS.ws.readyState === 1) WS.ws.send(m);
  else WS.pending.push(m);
}
async function apiGet(path) { return (await fetch(_apiBase + path)).json(); }

const EXCHANGES = [['SHFE','上期所'],['DCE','大商所'],['CZCE','郑商所'],['CFFEX','中金所'],['INE','上海能源'],['GFEX','广期所']];

function ctaCn(c) {
  var m = { DoubleMaStrategy:'双均线策略', KingKeltnerStrategy:'肯特纳通道', AtrRsiStrategy:'ATR+RSI策略', BollChannelStrategy:'布林带策略', MultiSignalStrategy:'多信号策略', MultiTimeframeStrategy:'多周期策略', RsiStrategy:'RSI策略', TurtleStrategy:'海龟策略' };
  return m[c] || c;
}

var FIELD_CN = { strategy_name:'策略名称', class_name:'策略类型', vt_symbol:'交易合约', setting:'配置', auto_init:'自动初始化', fast_window:'快线窗口', slow_window:'慢线窗口', atr_window:'ATR窗口', rsi_window:'RSI窗口', boll_window:'布林窗口', ma_window:'均线窗口', boll_dev:'标准差倍数', fixed_size:'固定数量', trailing_percent:'移动止损(%)', atr_multiplier:'ATR倍数', rsi_entry:'RSI入场', rsi_exit:'RSI离场', entry_window:'入场周期', exit_window:'离场周期' };

// ---- Message Handler ----
var _handlers = [];
function handleMsg(m) { var d = m.data, t = m.type; _handlers.forEach(function(h) { h(t, d); }); }
function onMsg(fn) { _handlers.push(fn); }

// ===== Paper Account Component =====
var PaperAccount = {
  template: '<div><h2>PaperAccount — 模拟交易账户</h2><div class="card"><h3>交易配置</h3><div class="form-row"><label>滑点</label><input v-model.number="slippage" type="number" step="any"></div><div class="form-row"><label>撮合间隔(秒)</label><input v-model.number="interval" type="number"></div><div class="form-row"><label>即时模式</label><label style="min-width:auto"><input v-model="instant" type="checkbox"> 启用即时撮合</label></div><div class="form-row"><label>初始资金</label><input v-model.number="capital" type="number"><button class="btn btn-primary" @click="apply">保存配置</button><button class="btn btn-danger" @click="reset">重置账户</button></div><div class="hint">{{ status }}</div></div></div>',
  data: function() { return { slippage: 0, interval: 30, instant: true, capital: 1000000, status: '' }; },
  mounted: function() {
    var self = this;
    wsSend({ action: 'get_paper_settings', payload: {} });
    onMsg(function(t, d) { if (t === 'paper_settings' && d) { self.slippage = d.slippage || 0; self.interval = d.interval || 30; self.instant = d.instant !== false; } });
  },
  methods: {
    apply: function() {
      wsSend({ action: 'save_paper_settings', payload: { slippage: this.slippage, interval: this.interval, instant: this.instant, capital: this.capital } });
      this.status = '配置已保存 √'; setTimeout(() => this.status = '', 2000);
    },
    reset: function() {
      if (!confirm('确认重置模拟账户？')) return;
      wsSend({ action: 'reset_paper_account', payload: { capital: this.capital } });
      this.status = '账户已重置 √'; setTimeout(() => this.status = '', 2000);
    }
  }
};

// ===== CTA Strategy Component =====
var CtaStrategy = {
  template: '<div><h2>CTA策略管理</h2><div class="card"><div class="card-header"><h3>策略列表</h3><div style="display:flex;gap:6px"><select v-model="selectedClass"><option value="">选择策略类型...</option><option v-for="c in classes" :value="c">{{ ctaCn(c) }}</option></select><button class="btn btn-primary" @click="addStrategy">添加策略</button><button class="btn" @click="refresh">刷新</button></div></div><div><div v-if="!strategies.length" style="color:var(--text-dim);padding:12px">暂无策略，请添加</div><div v-for="s in strategies" :key="s.strategy_name" class="strategy-card"><h4>{{ s.strategy_name }} — {{ (s.vt_symbol||"").split(".")[0] }}<span class="meta">{{ ctaCn(s.class_name) }}</span><span class="badge" :class="s.variables?.trading ? \'trading\' : (s.variables?.inited ? \'inited\' : \'stopped\')">{{ s.variables?.trading ? \'运行中\' : (s.variables?.inited ? \'已初始化\' : \'已停止\') }}</span></h4><div style="display:flex;gap:6px;margin-bottom:10px"><button class="btn btn-sm btn-primary" :disabled="s.variables?.inited" @click="act(s,\'init\')">初始化</button><button class="btn btn-sm btn-success" :disabled="s.variables?.trading" @click="act(s,\'start\')">启动</button><button class="btn btn-sm btn-danger" :disabled="!s.variables?.trading" @click="act(s,\'stop\')">停止</button><button class="btn btn-sm" :disabled="s.variables?.trading" @click="edit(s)">编辑</button><button class="btn btn-sm btn-danger" :disabled="s.variables?.trading" @click="act(s,\'remove\')">移除</button></div><table class="data-table"><thead><tr><th>参数</th><th v-for="(v,k) in s.parameters||{}" :key="k">{{ k }}</th></tr></thead><tbody><tr><td></td><td v-for="(v,k) in s.parameters||{}" :key="k">{{ v }}</td></tr></tbody></table><table class="data-table" style="margin-top:8px"><thead><tr><th>变量</th><th v-for="(v,k) in s.variables||{}" :key="k">{{ k }}</th></tr></thead><tbody><tr><td></td><td v-for="(v,k) in s.variables||{}" :key="k">{{ v }}</td></tr></tbody></table></div></div></div><div class="card"><h3>运行日志</h3><div ref="logEl" class="log-panel" style="max-height:300px;overflow:auto;font-size:11px"><div v-for="(l,i) in logs" :key="i" class="log-entry">{{ (l.created_at||"").slice(11,19) }} [{{ l.level }}] {{ l.message }}</div></div></div></div>',
  data: function() { return { strategies: [], classes: [], logs: [], selectedClass: '' }; },
  mounted: function() {
    var self = this;
    this.refresh();
    wsSend({ action: 'get_cta_classes', payload: {} });
    this._timer = setInterval(function() { self.refresh(); }, 3000);
    onMsg(function(t, d) {
      if (t === 'cta_classes' && d) self.classes = d;
      if (t === 'cta_strategies' && d) { self.strategies = d; self._onStrategies(d); }
      if (t === 'cta_params' && d && self._pendingClass) { self._showAddDialog(d, self._pendingClass); self._pendingClass = null; }
      if (t === 'strategy_logs' && d) self.logs = d;
    });
  },
  unmounted: function() { clearInterval(this._timer); },
  methods: {
    ctaCn: ctaCn,
    refresh: function() { wsSend({ action: 'get_cta_strategies', payload: {} }); },
    act: function(s, action) { wsSend({ action: 'cta_strategy_' + action, payload: { strategy_name: s.strategy_name } }); },
    addStrategy: function() {
      var cls = this.selectedClass;
      if (!cls) return alert('请选择策略类型');
      this._pendingClass = cls;
      wsSend({ action: 'get_cta_params', payload: { class_name: cls } });
    },
    edit: function(s) { this._showEditDialog(s); },
    _onStrategies: function(d) {
      if (this._editName) {
        var s = d.find(function(x) { return x.strategy_name === this._editName; }.bind(this));
        if (s) this._showEditDialog(s);
        this._editName = null;
      }
    },
    _showDialog: function(params, name, cb) {
      var self = this;
      var overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
      var fields = Object.entries(params).map(function(entry) {
        var k = entry[0], v = entry[1];
        var label = FIELD_CN[k] || k;
        return '<div class="form-row"><label>' + label + '</label><input id="se-' + k + '" value="' + v + '" placeholder="' + label + '" style="flex:1"></div>';
      }).join('');
      overlay.innerHTML = '<div class="modal" style="max-width:560px"><h3>' + (name ? '编辑策略: ' + name : '添加新策略') + '</h3><div>' + fields + '</div><div class="btn-row"><button class="btn" onclick="this.closest(\'.modal-overlay\').remove()">取消</button><button id="se-ok" class="btn btn-primary">' + (name ? '保存修改' : '添加策略') + '</button></div></div>';
      document.body.appendChild(overlay);
      document.getElementById('se-ok').onclick = function() {
        var s = {};
        Object.keys(params).forEach(function(k) {
          var el = document.getElementById('se-' + k);
          if (!el) return;
          s[k] = typeof params[k] === 'boolean' ? el.value === 'True' || el.value === 'true'
            : typeof params[k] === 'number' ? parseFloat(el.value) || 0 : el.value;
        });
        overlay.remove();
        cb(s);
      };
    },
    _showAddDialog: function(params, cls) {
      var p = {};
      Object.keys(params).forEach(function(k) { p[k] = params[k]; });
      p.class_name = cls;
      p.strategy_name = '';
      this._showDialog(p, null, function(setting) {
        wsSend({ action: 'cta_strategy_add', payload: { class_name: cls, parameters: setting } });
      });
    },
    _showEditDialog: function(s) {
      this._showDialog(s.parameters || {}, s.strategy_name, function(setting) {
        wsSend({ action: 'cta_strategy_edit', payload: { strategy_name: s.strategy_name, parameters: setting } });
      });
    }
  }
};

// ===== CTA Backtester Component =====
var CtaBacktester = {
  template: '<div><h2>CTA策略回测</h2><div class="card"><div class="card-header"><h3>回测配置</h3></div><div class="form-row"><label>策略类型</label><select v-model="cfg.className"><option value="">选择...</option><option v-for="c in classes" :value="c">{{ c }}</option></select></div><div class="form-row"><label>回测合约</label><input v-model="cfg.symbol" placeholder="如 rb2510.SHFE"></div><div class="form-row"><label>K线周期</label><select v-model="cfg.interval"><option value="MINUTE">分钟线</option><option value="HOUR">小时线</option><option value="DAILY">日线</option></select></div><div class="form-row"><label>回测起始日</label><input v-model="cfg.start" type="date"></div><div class="form-row"><label>回测结束日</label><input v-model="cfg.end" type="date"></div><div class="form-row"><label>初始资金</label><input v-model.number="cfg.capital" type="number"></div><div class="form-row"><label>手续费率</label><input v-model.number="cfg.rate" type="number" step="any"></div><div class="form-row"><label>滑点</label><input v-model.number="cfg.slippage" type="number" step="any"></div><div class="form-row"><label>合约乘数</label><input v-model.number="cfg.size" type="number"></div><div class="form-row"><label>价格跳动</label><input v-model.number="cfg.pricetick" type="number" step="any"></div><div class="form-row"><label></label><button class="btn btn-primary" @click="start">开始回测</button><button class="btn btn-warn" @click="stop">停止</button><button class="btn" @click="loadClasses">刷新策略类型</button></div></div><div class="card"><div class="card-header"><h3>回测结果</h3></div><table class="data-table"><tr v-if="!result.total_days"><td colspan="2" style="color:var(--text-dim)">尚未执行回测</td></tr><template v-else><tr><td>总收益率</td><td :style="{color: result.total_return > 0 ? \'var(--red)\' : \'var(--green)\'}">{{ (result.total_return*100).toFixed(2) }}%</td></tr><tr><td>夏普比率</td><td>{{ (result.sharpe_ratio||0).toFixed(2) }}</td></tr><tr><td>最大回撤</td><td>{{ (result.max_drawdown*100).toFixed(2) }}%</td></tr><tr><td>总交易日</td><td>{{ result.total_days||0 }}</td></tr><tr><td>总成交笔数</td><td>{{ result.total_trades||0 }}</td></tr></template></table></div><div class="card"><h3>回测日志</h3><div class="log-panel" style="max-height:300px;overflow:auto;font-size:11px"><div v-for="(l,i) in logs" :key="i" class="log-entry">{{ l }}</div></div></div></div>',
  data: function() {
    return {
      classes: [], result: {}, logs: [],
      cfg: reactive({ className:'', symbol:'', interval:'MINUTE', start:'2024-01-01', end:'2025-01-01', capital:1000000, rate:0.0001, slippage:0.2, size:10, pricetick:1 })
    };
  },
  mounted: function() {
    var self = this;
    this.loadClasses();
    onMsg(function(t, d) {
      if (t === 'bt_classes' && d) self.classes = d;
      if (t === 'backtestResult' && d) self.result = d;
      if (t === 'eBacktesterLog' && d) self.logs.push(d.msg || d.message || JSON.stringify(d));
    });
  },
  methods: {
    loadClasses: function() { wsSend({ action: 'get_bt_classes', payload: {} }); },
    start: function() {
      if (!this.cfg.symbol) return alert('请输入回测合约');
      wsSend({ action: 'run_backtesting', payload: {
        class_name: this.cfg.className, vt_symbol: this.cfg.symbol, interval: this.cfg.interval,
        start_date: this.cfg.start, end_date: this.cfg.end, capital: this.cfg.capital,
        rate: this.cfg.rate, slippage: this.cfg.slippage, size: this.cfg.size, pricetick: this.cfg.pricetick
      }});
    },
    stop: function() { wsSend({ action: 'stop_backtesting', payload: {} }); }
  }
};

// ===== Data Manager Component =====
var DataManager = {
  template: '<div><h2>数据管理</h2><div class="card"><div class="card-header"><h3>下载历史数据</h3></div><div class="form-row"><label>交易所</label><select v-model="dm.exchange" @change="onExchange"><option v-for="e in EXCHANGES" :value="e[0]">{{ e[0] }} ({{ e[1] }})</option></select></div><div class="form-row"><label>品种</label><select v-model="dm.product" @change="onProduct"><option value="">全部品种</option><option v-for="p in dm.products" :value="p.prefix">{{ p.prefix }} - {{ p.name }}</option></select></div><div class="form-row"><label>合约</label><select v-model="dm.symbol"><option value="">全部合约</option><option v-for="c in dm.contracts" :value="c.symbol">{{ c.symbol }} | {{ c.name }}</option></select></div><div class="form-row"><label>K线周期</label><select v-model="dm.interval"><option value="1m">1分钟</option><option value="5m">5分钟</option><option value="15m">15分钟</option><option value="30m">30分钟</option><option value="1h">1小时</option><option value="4h">4小时</option><option value="1d">日线</option><option value="1w">周线</option></select></div><div class="form-row"><label>起始日期</label><input v-model="dm.start" type="date"></div><div class="form-row"><label>结束日期</label><input v-model="dm.end" type="date"></div><div class="form-row"><label></label><button class="btn btn-primary" @click="download">下载数据</button><button class="btn" @click="refresh">刷新概览</button></div><div class="hint">{{ dm.status }}</div></div><div class="card"><h3>已导入数据概览</h3><table class="data-table"><thead><tr><th>合约</th><th>交易所</th><th>周期</th><th>数据量</th><th>开始时间</th><th>结束时间</th></tr></thead><tbody><tr v-if="!dm.overview.length"><td colspan="6" style="color:var(--text-dim)">点击刷新加载</td></tr><tr v-for="r in dm.overview" :key="(r.vt_symbol||\'\')+(r.exchange||\'\')+(r.interval||\'\')"><td>{{ r.vt_symbol }}</td><td>{{ r.exchange }}</td><td>{{ r.interval }}</td><td>{{ r.count }}</td><td>{{ r.start }}</td><td>{{ r.end }}</td></tr></tbody></table></div></div>',
  data: function() {
    return {
      EXCHANGES: EXCHANGES,
      dm: reactive({ exchange:'SHFE', product:'', symbol:'', interval:'1m', start:'2024-01-01', end:'2025-12-31',
        products:[], contracts:[], overview:[], status:'' })
    };
  },
  mounted: function() {
    var self = this;
    this.onExchange();
    onMsg(function(t, d) { if (t === 'data_overview' && d) self.dm.overview = d || []; });
  },
  methods: {
    onExchange: function() {
      var self = this;
      var ex = this.dm.exchange;
      this.dm.products = [];
      this.dm.contracts = [];
      apiGet('/api/contracts/products?exchange=' + encodeURIComponent(ex)).then(function(r) {
        self.dm.products = r.products || [];
      }).catch(function() {});
      this.onProduct();
    },
    onProduct: function() {
      var self = this;
      var ex = this.dm.exchange, prod = this.dm.product;
      var params = 'exchange=' + encodeURIComponent(ex);
      if (prod) params += '&product=' + encodeURIComponent(prod);
      apiGet('/api/contracts/public?' + params).then(function(r) {
        self.dm.contracts = r.contracts || [];
      }).catch(function() { self.dm.contracts = []; });
    },
    download: function() {
      if (!this.dm.symbol) return alert('请选择合约');
      this.dm.status = '下载中: ' + this.dm.symbol + '.' + this.dm.exchange + ' ' + this.dm.interval + ' ' + this.dm.start + '~' + this.dm.end + '...';
      wsSend({ action: 'download_bar_data', payload: { symbol: this.dm.symbol, exchange: this.dm.exchange, interval: this.dm.interval, start: this.dm.start, end: this.dm.end } });
    },
    refresh: function() { wsSend({ action: 'get_data_overview', payload: {} }); }
  }
};

// ===== App Mount =====
var app = createApp({
  components: { PaperAccount: PaperAccount, CtaStrategy: CtaStrategy, CtaBacktester: CtaBacktester, DataManager: DataManager },
  data: function() { return { appName: APP_NAME }; },
  mounted: function() { wsConnect(); }
});

app.mount('#app');
