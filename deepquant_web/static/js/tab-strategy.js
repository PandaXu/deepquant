// ===== Tab 3: 策略 =====
const { ref, reactive, onMounted } = Vue;

const TabStrategy = {
  template: `
    <div style="display:flex;flex-direction:column;flex:1;overflow-y:auto;padding:8px;gap:8px">
      <!-- CTA Strategy Management -->
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">⚙️ CTA 策略管理</span>
          <div style="margin-left:auto;display:flex;gap:6px">
            <button class="btn btn-sm btn-primary" @click="showAddModal = true">+ 添加</button>
            <button class="btn btn-sm" @click="refreshStrategies">刷新</button>
          </div>
        </div>
        <div class="panel-body" style="display:flex;flex-wrap:wrap;gap:8px;padding:8px">
          <div v-for="s in $s.strategies" :key="s.strategy_name || s.id" class="strategy-card">
            <div class="sc-header">
              <span class="sc-name">{{ s.strategy_name || s.class_name }}</span>
              <span :class="'sc-status status-' + (s.status || 'STOPPED')">{{ statusText(s.status) }}</span>
            </div>
            <div class="sc-body">
              <div class="sc-row"><span>合约</span><span>{{ s.vt_symbol || '—' }}</span></div>
              <div class="sc-row"><span>类型</span><span>{{ s.class_name || '—' }}</span></div>
              <div v-if="s.parameters" class="sc-row"><span>参数</span><span>{{ JSON.stringify(s.parameters) }}</span></div>
            </div>
            <div class="sc-actions">
              <button class="btn btn-xs btn-primary" @click="initStrategy(s)" v-if="!s.status || s.status==='STOPPED'">初始化</button>
              <button class="btn btn-xs btn-success" @click="startStrategy(s)" v-if="s.status==='INITED'">启动</button>
              <button class="btn btn-xs btn-warn" @click="stopStrategy(s)" v-if="s.status==='RUNNING'">停止</button>
              <button class="btn btn-xs" @click="editStrategy(s)">编辑</button>
              <button class="btn btn-xs btn-danger" @click="removeStrategy(s)">删除</button>
            </div>
          </div>
          <div v-if="!$s.strategies || $s.strategies.length === 0" class="empty" style="width:100%;text-align:center;padding:24px;color:var(--text-dim)">
            暂无策略，点击“添加”创建
          </div>
        </div>
      </div>

      <!-- Backtest Panel -->
      <div class="panel">
        <div class="panel-header"><span class="panel-title">🔬 策略回测</span></div>
        <div style="display:flex;gap:8px;padding:8px;flex-wrap:wrap;align-items:end">
          <div class="form-row"><label>策略</label><select v-model="bt.className" class="input"><option v-for="c in $s.btClasses" :value="c">{{ c }}</option></select></div>
          <div class="form-row"><label>合约</label><input v-model="bt.vtSymbol" class="input" placeholder="如 IF2606.CFFEX"></div>
          <div class="form-row"><label>周期</label><select v-model="bt.interval" class="input"><option>1m</option><option>1h</option><option>d</option></select></div>
          <div class="form-row"><label>起始</label><input v-model="bt.start" class="input" type="date"></div>
          <div class="form-row"><label>结束</label><input v-model="bt.end" class="input" type="date"></div>
          <div class="form-row"><label>资金</label><input v-model="bt.capital" class="input" type="number" style="width:80px"></div>
          <button class="btn btn-sm btn-primary" @click="runBacktest">开始回测</button>
        </div>
        <!-- Equity Curve -->
        <div ref="equityEl" style="height:200px;margin:0 8px"></div>
        <!-- Results -->
        <div v-if="bt.result" class="panel-body" style="padding:8px">
          <table class="data-table">
            <thead><tr><th>收益率</th><th class="num">夏普</th><th class="num">最大回撤</th><th class="num">交易天数</th><th class="num">成交笔数</th></tr></thead>
            <tbody>
              <tr>
                <td :class="(bt.result.total_return||0)>=0?'up':'down'">{{ (bt.result.total_return||0).toFixed(2) }}%</td>
                <td class="num">{{ (bt.result.sharpe_ratio||0).toFixed(2) }}</td>
                <td class="num">{{ (bt.result.max_drawdown||0).toFixed(2) }}%</td>
                <td class="num">{{ bt.result.total_days||0 }}</td>
                <td class="num">{{ bt.result.total_trades||0 }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <!-- Log -->
        <div v-if="bt.logs.length" class="panel-body" style="max-height:150px;overflow:auto;padding:4px 8px;font-size:11px;font-family:var(--font-mono)">
          <div v-for="(l,i) in bt.logs" :key="i" style="color:var(--text-dim);padding:1px 0">{{ l }}</div>
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
            <div class="form-row"><label>策略类型</label><select v-model="newStrategy.class_name" class="input"><option v-for="c in $s.btClasses" :value="c">{{ c }}</option></select></div>
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
    const showAddModal = ref(false);
    const editingStrategy = ref(null);
    const newStrategy = reactive({ class_name:'', strategy_name:'', vt_symbol:'', paramsJson:'{}' });
    const bt = reactive({ className:'', vtSymbol:'', interval:'d', start:'', end:'', capital:'1000000', result:null, logs:[] });
    const equityEl = ref(null);

    const statusText = s => ({ RUNNING:'运行中', INITED:'已初始化', STOPPED:'已停止', STARTING:'启动中', STOPPING:'停止中' }[s] || s || '已停止');

    function refreshStrategies() { $wsSend({ action: 'get_cta_strategies' }); $wsSend({ action: 'get_cta_classes' }); }

    function initStrategy(s) { $wsSend({ action: 'cta_strategy_init', payload: { strategy_name: s.strategy_name } }); }
    function startStrategy(s) { $wsSend({ action: 'cta_strategy_start', payload: { strategy_name: s.strategy_name } }); }
    function stopStrategy(s) { $wsSend({ action: 'cta_strategy_stop', payload: { strategy_name: s.strategy_name } }); }
    function removeStrategy(s) { if(confirm('确定删除策略 ' + s.strategy_name + '?')) $wsSend({ action: 'cta_strategy_remove', payload: { strategy_name: s.strategy_name } }); }
    function editStrategy(s) { editingStrategy.value = s; newStrategy.class_name = s.class_name; newStrategy.strategy_name = s.strategy_name; newStrategy.vt_symbol = s.vt_symbol || ''; newStrategy.paramsJson = JSON.stringify(s.parameters || {}); showAddModal.value = true; }

    function saveStrategy() {
      let params = {}; try { params = JSON.parse(newStrategy.paramsJson || '{}'); } catch(e) { $toast('参数JSON格式错误', 'error'); return; }
      const payload = { class_name: newStrategy.class_name, strategy_name: newStrategy.strategy_name, vt_symbol: newStrategy.vt_symbol, parameters: params };
      $wsSend({ action: editingStrategy.value ? 'cta_strategy_edit' : 'cta_strategy_add', payload });
      showAddModal.value = false; editingStrategy.value = null;
      setTimeout(refreshStrategies, 500);
    }

    function runBacktest() {
      if (!bt.className || !bt.vtSymbol) return $toast('请填写策略和合约', 'error');
      bt.result = null; bt.logs = [];
      $wsSend({ action: 'run_backtesting', payload: { class_name: bt.className, vt_symbol: bt.vtSymbol, interval: bt.interval, start: bt.start, end: bt.end, capital: parseFloat(bt.capital) || 1000000, rate: 0.0001, slippage: 0, size: 1, pricetick: 0.01 } });
      $toast('回测已启动', 'info');
    }

    onMounted(() => { refreshStrategies(); $wsSend({ action: 'get_bt_classes' }); });

    return { showAddModal, editingStrategy, newStrategy, bt, equityEl, statusText,
      refreshStrategies, initStrategy, startStrategy, stopStrategy, removeStrategy, editStrategy, saveStrategy, runBacktest };
  }
};
