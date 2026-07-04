// ===== 数据管理：CSV 导入 =====
const DataImportModal = {
  props: {
    open: { type: Boolean, default: false },
    preset: { type: Object, default: null },
    dmAvailable: { type: Boolean, default: false },
  },
  emits: ['close', 'done'],
  template: `
    <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer-panel data-import-modal">
        <div class="panel-header">
          <span class="panel-title">导入 CSV</span>
          <button class="btn btn-xs" @click="$emit('close')">✕</button>
        </div>
        <div class="panel-body" style="padding:12px;display:flex;flex-direction:column;gap:8px">
          <p class="hint-sub">标准列名：datetime, open, high, low, close, volume（可选 turnover, open_interest）</p>
          <contract-picker v-model="vtSymbol" compact @pick="onPick" />
          <div class="form-row"><label>周期</label>
            <select v-model="interval" class="input">
              <option value="1m">1m</option><option value="1h">1h</option><option value="d">d</option><option value="w">w</option>
            </select>
          </div>
          <div class="form-row"><label>CSV 文件</label><input type="file" accept=".csv,text/csv" @change="onFile" class="input"></div>
          <details class="data-import-advanced">
            <summary>列映射（高级）</summary>
            <div class="form-grid" style="margin-top:8px">
              <div class="form-row"><label>时间列</label><input v-model="mapping.datetime_head" class="input"></div>
              <div class="form-row"><label>时间格式</label><input v-model="mapping.datetime_format" class="input" placeholder="留空=ISO"></div>
              <div class="form-row"><label>时区</label><input v-model="mapping.tz_name" class="input"></div>
            </div>
          </details>
          <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
            <button class="btn btn-sm" @click="$emit('close')">取消</button>
            <button class="btn btn-sm btn-primary" :disabled="busy || !file || !vtSymbol" @click="submit">
              {{ busy ? '导入中…' : '导入' }}
            </button>
          </div>
        </div>
      </div>
    </div>`,
  setup(props, { emit }) {
    const vtSymbol = ref('');
    const interval = ref('1m');
    const file = ref(null);
    const busy = ref(false);
    const mapping = reactive({
      datetime_head: 'datetime',
      datetime_format: '',
      tz_name: 'Asia/Shanghai',
      open_head: 'open',
      high_head: 'high',
      low_head: 'low',
      close_head: 'close',
      volume_head: 'volume',
      turnover_head: 'turnover',
      open_interest_head: 'open_interest',
    });

    function onPick(vt) { vtSymbol.value = $normalizeVt(vt); }
    function onFile(e) { file.value = e.target.files?.[0] || null; }

    async function submit() {
      if (!file.value || !vtSymbol.value) return;
      const parsed = $parseVtSymbol(vtSymbol.value);
      busy.value = true;
      try {
        const fd = new FormData();
        fd.append('file', file.value);
        fd.append('symbol', parsed.symbol);
        fd.append('exchange', parsed.exchange);
        fd.append('interval', interval.value);
        Object.entries(mapping).forEach(([k, v]) => fd.append(k, v));
        const result = await $importBarCsv(fd);
        if (result.error) {
          $toast(result.error, 'error');
        } else {
          $toast(`导入 ${result.count} 条`, 'success');
          emit('done', result);
          emit('close');
        }
      } catch (e) {
        $toast('导入失败: ' + (e.message || e), 'error');
      } finally {
        busy.value = false;
      }
    }

    watch(() => props.open, (v) => {
      if (v && props.preset?.vt_symbol) vtSymbol.value = props.preset.vt_symbol;
    });

    return { vtSymbol, interval, file, busy, mapping, onPick, onFile, submit };
  },
};
