// ===== Tab 3: 策略 =====

const TabStrategy = {
  template: `
    <div class="strategy-layout">
      <div class="strategy-subtabs">
        <button class="dock-tab" :class="{ active: subTab === 'run' }" @click="subTab = 'run'">运行中策略</button>
        <button class="dock-tab" :class="{ active: subTab === 'lab' }" @click="subTab = 'lab'">回测实验室</button>
      </div>

      <div v-show="subTab === 'run'" class="strategy-section">
        <div class="panel">
          <div class="panel-header">
            <span class="panel-title">⚙️ CTA 策略</span>
            <div style="margin-left:auto;display:flex;gap:6px">
              <button class="btn btn-sm btn-primary" @click="showAddModal = true">+ 添加</button>
              <button class="btn btn-sm" @click="refreshStrategies">刷新</button>
            </div>
          </div>
          <div class="panel-body strategy-cards">
            <div v-for="s in store.strategies" :key="s.strategy_name || s.id" class="strategy-card">
              <div class="sc-header">
                <span class="sc-name">{{ s.strategy_name || s.class_name }}</span>
                <span :class="'sc-status status-' + normStatus(s.status).toUpperCase()">{{ strategyStatus(s.status) }}</span>
              </div>
              <div class="sc-body">
                <div class="sc-row"><span>策略类型</span><span>{{ strategyLabel(s.class_name) }}</span></div>
                <div class="sc-row"><span>合约</span>
                  <span class="contract-label-col">
                    <template v-if="isIndexOption(s.vt_symbol)">
                      <span class="option-line">{{ contractLabel(s.vt_symbol) }}</span>
                      <span class="option-line">{{ contractSubLabel(s.vt_symbol) }}</span>
                      <span class="option-code">{{ contractCodeLine(s.vt_symbol) }}</span>
                    </template>
                    <template v-else>
                      <span>{{ contractLabel(s.vt_symbol) }}</span>
                      <span class="sc-sub">{{ s.vt_symbol }}</span>
                    </template>
                  </span>
                </div>
              </div>
              <div class="sc-actions">
                <button class="btn btn-xs" @click="jumpToChart(s.vt_symbol)" v-if="s.vt_symbol">看K线</button>
                <button class="btn btn-xs btn-primary" @click="initStrategy(s)" v-if="canInit(s)">初始化</button>
                <button class="btn btn-xs" @click="goDownloadData(s)" v-if="s.vt_symbol" title="补历史数据">补数据</button>
                <button class="btn btn-xs btn-success" @click="startStrategy(s)" v-if="canStart(s)">启动</button>
                <button class="btn btn-xs btn-warn" @click="stopStrategy(s)" v-if="canStop(s)">停止</button>
                <button class="btn btn-xs" @click="editStrategy(s)">编辑</button>
                <button class="btn btn-xs btn-danger" @click="removeStrategy(s)">删除</button>
              </div>
            </div>
            <div v-if="!store.strategies?.length" class="empty" style="width:100%;padding:32px;text-align:center">暂无策略</div>
          </div>
        </div>
      </div>

      <div v-show="subTab === 'lab'" class="strategy-section">
        <div class="panel">
          <div class="panel-header"><span class="panel-title">🔬 回测实验室</span></div>
          <div class="backtest-form">
            <div class="form-row"><label>策略</label><select v-model="bt.className" class="input"><option v-for="c in store.btClasses" :value="c">{{ strategyLabel(c) }}</option></select></div>
            <div class="form-row"><label>合约</label><input v-model="bt.vtSymbol" class="input" placeholder="IF2606.CFFEX" @change="checkBtCoverage"></div>
            <div class="form-row"><label>周期</label><select v-model="bt.interval" class="input" @change="checkBtCoverage"><option>1m</option><option>1h</option><option>d</option></select></div>
            <div class="form-row"><label>起始</label><input v-model="bt.start" class="input" type="date" @change="checkBtCoverage"></div>
            <div class="form-row"><label>结束</label><input v-model="bt.end" class="input" type="date" @change="checkBtCoverage"></div>
            <div class="form-row"><label>资金</label><input v-model="bt.capital" class="input" type="number" style="width:100px"></div>
            <button class="btn btn-sm btn-primary" @click="runBacktest" :disabled="bt.running">{{ bt.running ? '回测中…' : '开始回测' }}</button>
            <button v-if="bt.result && bt.vtSymbol" class="btn btn-sm" @click="jumpToChart(bt.vtSymbol)">K线查看</button>
          </div>
          <div v-if="bt.coverage" class="data-bt-coverage" :class="'cov-' + bt.coverage.status">
            <span>数据：{{ covLabel(bt.coverage.status) }} — {{ bt.coverage.detail }}</span>
            <button v-if="bt.coverage.status !== 'ok'" class="btn btn-xs" @click="goDownloadForBt">下载数据</button>
          </div>
          <div ref="equityEl" class="equity-chart"></div>
          <div v-if="bt.result" class="panel-body" style="padding:8px">
            <table class="data-table">
              <thead><tr><th>收益率</th><th class="num">夏普</th><th class="num">最大回撤</th><th class="num">成交笔数</th></tr></thead>
              <tbody><tr>
                <td :class="btReturnCls">{{ btReturnText }}</td>
                <td class="num">{{ (bt.result.sharpe_ratio||0).toFixed(2) }}</td>
                <td class="num">{{ btDrawdownText }}</td>
                <td class="num">{{ bt.result.total_trades||0 }}</td>
              </tr></tbody>
            </table>
          </div>
          <div v-if="bt.logs.length" class="bt-log-list">
            <div v-for="(l,i) in bt.logs" :key="i">{{ l }}</div>
          </div>
        </div>
      </div>

      <!-- Add/Edit Strategy Modal -->
      <div v-if="showAddModal" class="modal-overlay" @click.self="showAddModal = false">
        <div class="modal">
          <div class="modal-header">
            <span>{{ editingStrategy ? '编辑策略' : '添加策略' }}</span>
            <button class="btn btn-xs" @click="showAddModal = false">✕</button>
          </div>
          <div class="modal-body form-grid">
            <div class="form-row"><label>策略类型</label><select v-model="newStrategy.class_name" class="input"><option v-for="c in store.ctaClasses" :value="c">{{ strategyLabel(c) }}</option></select></div>
            <div class="form-row"><label>策略名称</label><input v-model="newStrategy.strategy_name" class="input"></div>
            <div class="form-row"><label>合约</label><input v-model="newStrategy.vt_symbol" class="input" placeholder="如 IF2606.CFFEX"></div>
            <div class="form-row"><label>参数 (JSON)</label><input v-model="newStrategy.paramsJson" class="input" placeholder='{"fast_window":10}'></div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-sm btn-primary" @click="saveStrategy">{{ editingStrategy ? '保存' : '添加' }}</button>
          </div>
        </div>
      </div>
    </div>`,
  setup() {
    const subTab = ref('run');
    const showAddModal = ref(false);
    const editingStrategy = ref(null);
    const newStrategy = reactive({ class_name:'', strategy_name:'', vt_symbol:'', paramsJson:'{}' });
    const bt = reactive({ className:'', vtSymbol:'', interval:'d', start:'', end:'', capital:'1000000', result:null, logs:[], running:false, coverage:null });
    const equityEl = ref(null);
    let equityChart = null;

    function normStatus(s) { return String(s || 'stopped').toLowerCase(); }
    const statusText = s => ({ running:'运行中', inited:'已初始化', stopped:'已停止', starting:'启动中', stopping:'停止中' }[normStatus(s)] || s || '已停止');
    function canInit(s) { const st = normStatus(s.status); return !st || st === 'stopped'; }
    function canStart(s) { return normStatus(s.status) === 'inited'; }
    function canStop(s) { return normStatus(s.status) === 'running'; }

    function refreshStrategies() {
      $wsSend({ action: 'get_cta_strategies' });
      $wsSend({ action: 'get_cta_classes' });
    }

    function initStrategy(s) {
      store.lastStrategyDataError = null;
      $wsSend({ action: 'cta_strategy_init', payload: { strategy_name: s.strategy_name } });
    }

    function goDownloadData(s) {
      $openDataTabForStrategy(s);
    }

    function covLabel(st) {
      return ({ ok: '充足', missing: '缺失', partial: '部分', stale: '偏旧', tick_only: '仅Tick' }[st] || st);
    }

    async function checkBtCoverage() {
      if (!bt.vtSymbol) { bt.coverage = null; return; }
      try {
        const data = await $checkDataCoverage([{
          vt_symbol: bt.vtSymbol,
          interval: bt.interval,
          start: bt.start,
          end: bt.end,
        }]);
        bt.coverage = (data.results || [])[0] || null;
      } catch (e) {
        bt.coverage = $findLocalDataCoverage(bt.vtSymbol, bt.interval);
      }
    }

    function goDownloadForBt() {
      const parsed = $parseVtSymbol(bt.vtSymbol);
      $openDataTab({
        sub: 'local',
        symbol: parsed.symbol,
        exchange: parsed.exchange,
        interval: bt.interval,
        vt_symbol: bt.vtSymbol,
        action: 'update',
      });
    }

    window.__openBacktestWithSymbol = (vt, interval) => {
      subTab.value = 'lab';
      bt.vtSymbol = vt;
      if (interval) bt.interval = interval;
      if (!bt.start) {
        const d = $defaultDownloadDates();
        bt.start = d.start;
        bt.end = d.end;
      }
      checkBtCoverage();
    };
    function startStrategy(s) { $wsSend({ action: 'cta_strategy_start', payload: { strategy_name: s.strategy_name } }); }
    function stopStrategy(s) { $wsSend({ action: 'cta_strategy_stop', payload: { strategy_name: s.strategy_name } }); }
    function removeStrategy(s) { if(confirm('确定删除策略 ' + s.strategy_name + '?')) $wsSend({ action: 'cta_strategy_remove', payload: { strategy_name: s.strategy_name } }); }
    function editStrategy(s) {
      editingStrategy.value = s;
      newStrategy.class_name = s.class_name;
      newStrategy.strategy_name = s.strategy_name;
      newStrategy.vt_symbol = s.vt_symbol || '';
      newStrategy.paramsJson = JSON.stringify(s.parameters || {});
      showAddModal.value = true;
    }

    function saveStrategy() {
      let params = {};
      try { params = JSON.parse(newStrategy.paramsJson || '{}'); }
      catch(e) { $toast('参数JSON格式错误', 'error'); return; }
      if (editingStrategy.value) {
        $wsSend({ action: 'edit_cta_strategy', payload: { strategy_name: newStrategy.strategy_name, setting: params } });
      } else {
        $wsSend({ action: 'add_cta_strategy', payload: {
          class_name: newStrategy.class_name,
          strategy_name: newStrategy.strategy_name,
          vt_symbol: newStrategy.vt_symbol,
          parameters: params,
        }});
      }
      showAddModal.value = false;
      editingStrategy.value = null;
      setTimeout(refreshStrategies, 500);
    }

    function jumpToChart(vt) {
      if (!vt) return;
      $setActiveSymbol(vt);
      if (window.__setActiveTab) window.__setActiveTab('trading');
      nextTick(() => { if (window.__jumpToSymbol) window.__jumpToSymbol(vt); });
    }

    function extractBacktestMarkers(result, vtSymbol) {
      const trades = result?.trades || result?.trade_list || [];
      if (!Array.isArray(trades) || !trades.length) return [];
      return trades.slice(0, 200).map(t => ({
        vt_symbol: (vtSymbol || t.vt_symbol || '').toUpperCase(),
        datetime: t.datetime || t.trade_time || t.time,
        side: (t.direction === 'LONG' || t.direction === 'BUY') ? 'BUY' : 'SELL',
      })).filter(m => m.datetime && m.vt_symbol);
    }

    function runBacktest() {
      if (!bt.className || !bt.vtSymbol) return $toast('请填写策略和合约', 'error');
      bt.result = null;
      bt.logs = [];
      bt.running = true;
      store.backtestResult = null;
      store.backtestError = null;
      store.backtestMarkers = [];
      $wsSend({ action: 'start_backtesting', payload: {
        class_name: bt.className,
        vt_symbol: bt.vtSymbol,
        interval: bt.interval,
        start: bt.start,
        end: bt.end,
        capital: parseFloat(bt.capital) || 1000000,
        rate: 0.0001,
        slippage: 0.2,
        size: 10,
        pricetick: 1,
      }});
      $toast('回测已启动', 'info');
    }

    function renderEquityChart(result) {
      if (!equityEl.value || typeof echarts === 'undefined') return;
      const balance = result.balance || result.daily_balance;
      if (!balance || !balance.length) return;
      if (!equityChart) equityChart = echarts.init(equityEl.value, 'dark');
      const dates = balance.map((_, i) => String(i + 1));
      const values = balance.map(b => (typeof b === 'number' ? b : b.balance || b));
      equityChart.setOption({
        backgroundColor: 'transparent',
        grid: { left: '8%', right: '4%', top: '8%', bottom: '12%' },
        xAxis: { type: 'category', data: dates, axisLabel: { show: false } },
        yAxis: { type: 'value', scale: true },
        series: [{ type: 'line', data: values, showSymbol: false, lineStyle: { width: 1.5, color: '#3b82f6' }, areaStyle: { color: 'rgba(59,130,246,0.15)' } }],
        tooltip: { trigger: 'axis' },
      });
    }

    const btReturnText = computed(() => {
      const v = (bt.result?.total_return || 0) * 100;
      return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
    });
    const btReturnCls = computed(() => (bt.result?.total_return || 0) >= 0 ? 'up' : 'down');
    const btDrawdownText = computed(() => ((bt.result?.max_drawdown || 0) * 100).toFixed(2) + '%');

    watch(() => store.backtestResult, (result) => {
      if (!result) return;
      bt.result = result;
      bt.running = false;
      store.backtestMarkers = extractBacktestMarkers(result, bt.vtSymbol);
      renderEquityChart(result);
      $toast('回测完成', 'success');
    });

    watch(() => store.backtestError, (err) => {
      if (!err) return;
      bt.running = false;
      bt.logs.push(String(err));
      $toast(String(err), 'error');
    });

    watch(() => store.lastStrategyDataError, (err) => {
      if (!err) return;
      const s = store.strategies.find(x => x.strategy_name === err.strategy_name);
      if (s) setTimeout(() => {
        if (confirm('策略历史数据不足，是否前往数据管理下载？')) goDownloadData(s);
      }, 100);
    });

    onMounted(() => {
      refreshStrategies();
      $wsSend({ action: 'get_backtest_classes' });
      $preloadWatchlistNames();
      const d = $defaultDownloadDates();
      if (!bt.start) bt.start = d.start;
      if (!bt.end) bt.end = d.end;
    });

    onUnmounted(() => {
      if (equityChart) { equityChart.dispose(); equityChart = null; }
      window.__openBacktestWithSymbol = null;
    });

    return {
      subTab, showAddModal, editingStrategy, newStrategy, bt, equityEl,
      normStatus, statusText, canInit, canStart, canStop,
      strategyLabel: $strategyLabel, strategyStatus: $strategyStatusCn, contractLabel: $contractLabel,
      contractSubLabel: $contractSubLabel, contractCodeLine: $contractCodeLine, isIndexOption: $isIndexOption,
      btReturnText, btReturnCls, btDrawdownText,
      refreshStrategies, initStrategy, startStrategy, stopStrategy, removeStrategy, editStrategy, saveStrategy, runBacktest, jumpToChart,
      goDownloadData, covLabel, checkBtCoverage, goDownloadForBt, store,
    };
  }
};
