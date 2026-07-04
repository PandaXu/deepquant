// ===== 数据管理：下载抽屉 =====
const DataDownloadDrawer = {
  props: {
    open: { type: Boolean, default: false },
    preset: { type: Object, default: null },
    dmAvailable: { type: Boolean, default: false },
  },
  emits: ['close', 'started'],
  template: `
    <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer-panel data-download-drawer">
        <div class="panel-header">
          <span class="panel-title">下载历史数据</span>
          <button class="btn btn-xs" @click="$emit('close')">✕</button>
        </div>
        <div v-if="!dmAvailable" class="empty-hint" style="padding:12px">
          DataManager 未加载，请在后端安装 deepquant_datamanager 并配置数据源
        </div>
        <div v-else class="panel-body" style="padding:12px;display:flex;flex-direction:column;gap:10px">
          <contract-picker v-model="vtSymbol" compact @pick="onPick" />
          <div class="form-row"><label>周期</label>
            <select v-model="interval" class="input">
              <option value="1m">分钟线 (1m)</option>
              <option value="1h">小时线 (1h)</option>
              <option value="d">日线 (d)</option>
              <option value="w">周线 (w)</option>
            </select>
          </div>
          <div style="display:flex;gap:8px">
            <div class="form-row" style="flex:1"><label>起始日</label><input v-model="start" type="date" class="input"></div>
            <div class="form-row" style="flex:1"><label>结束日</label><input v-model="end" type="date" class="input"></div>
          </div>
          <p class="hint-sub">任务进度见底部任务条或日志 Tab</p>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-sm" @click="$emit('close')">取消</button>
            <button class="btn btn-sm btn-primary" :disabled="busy || !vtSymbol" @click="submit">
              {{ busy ? '已提交…' : '开始下载' }}
            </button>
          </div>
        </div>
      </div>
    </div>`,
  setup(props, { emit }) {
    const vtSymbol = ref('');
    const interval = ref('1m');
    const start = ref('');
    const end = ref('');
    const busy = ref(false);

    function applyPreset(p) {
      if (!p) return;
      const dates = $defaultDownloadDates();
      start.value = p.start || dates.start;
      end.value = p.end || dates.end;
      interval.value = p.interval || '1m';
      if (p.vt_symbol) vtSymbol.value = $normalizeVt(p.vt_symbol);
      else if (p.symbol && p.exchange) vtSymbol.value = `${p.symbol}.${p.exchange}`;
    }

    function onPick(vt) {
      vtSymbol.value = $normalizeVt(vt);
    }

    function submit() {
      if (!vtSymbol.value) return $toast('请选择合约', 'error');
      const parsed = $parseVtSymbol(vtSymbol.value);
      busy.value = true;
      $startDataDownload({
        symbol: parsed.symbol,
        exchange: parsed.exchange,
        interval: interval.value,
        start: start.value,
        end: end.value,
      });
      emit('started');
      emit('close');
      setTimeout(() => { busy.value = false; }, 1500);
    }

    watch(() => props.open, (v) => {
      if (v) {
        const dates = $defaultDownloadDates();
        if (!start.value) start.value = dates.start;
        if (!end.value) end.value = dates.end;
        applyPreset(props.preset);
      }
    });

    return { vtSymbol, interval, start, end, busy, onPick, submit };
  },
};
