// ===== Tab 4: 日志 =====
const TabLog = {
  template: `
    <div class="panel log-panel">
      <div class="panel-header">
        <span class="panel-title">📋 实时日志</span>
        <select v-model="levelFilter" class="input input-sm" style="width:72px;margin-left:8px">
          <option value="">级别</option><option>INFO</option><option>WARN</option><option>ERROR</option>
        </select>
        <select v-model="sourceFilter" class="input input-sm" style="width:88px;margin-left:4px">
          <option value="">来源</option>
          <option v-for="s in sources" :key="s" :value="s">{{ s || '系统' }}</option>
        </select>
        <label class="checkbox-label" style="margin-left:8px;font-size:11px">
          <input type="checkbox" v-model="hideTickNoise"> 隐藏 Tick 噪音
        </label>
        <input v-model="searchText" class="input input-sm" placeholder="搜索…" style="width:120px;margin-left:4px">
        <div style="margin-left:auto;display:flex;gap:4px">
          <button class="btn btn-xs" @click="store.logPaused = !store.logPaused">{{ store.logPaused ? '▶ 恢复' : '⏸ 暂停' }}</button>
          <button class="btn btn-xs" @click="clearLog">清空</button>
          <button class="btn btn-xs" @click="exportLog">CSV</button>
        </div>
      </div>
      <div class="panel-body log-scroll" ref="logBody">
        <table class="data-table">
          <thead><tr>
            <th style="width:90px">时间</th>
            <th style="width:50px">级别</th>
            <th style="width:80px">来源</th>
            <th>消息</th>
          </tr></thead>
          <tbody>
            <tr v-for="(l, i) in filteredLog" :key="i" :class="'log-' + (l.level || 'INFO')">
              <td class="num log-time">{{ l.time }}</td>
              <td><span :class="'log-badge log-badge-' + (l.level || 'INFO')">{{ l.level || 'INFO' }}</span></td>
              <td class="log-source">{{ l.source }}</td>
              <td class="log-msg">{{ l.msg }}</td>
            </tr>
            <tr v-if="filteredLog.length === 0"><td colspan="4" class="empty">暂无日志</td></tr>
          </tbody>
        </table>
      </div>
      <div class="log-footer">共 {{ store.log.length }} 条，显示 {{ filteredLog.length }} 条</div>
    </div>`,
  setup() {
    const levelFilter = ref('');
    const sourceFilter = ref('');
    const searchText = ref('');
    const hideTickNoise = ref(true);
    const logBody = ref(null);

    const sources = computed(() => {
      const set = new Set(store.log.map(l => l.source || '').filter(Boolean));
      return [...set].sort();
    });

    function isTickNoise(l) {
      const m = (l.msg || '') + (l.source || '');
      return /TickData|eTick\.|行情数据推送/i.test(m);
    }

    const filteredLog = computed(() => {
      let arr = store.log;
      if (hideTickNoise.value) arr = arr.filter(l => !isTickNoise(l));
      if (levelFilter.value) arr = arr.filter(l => l.level === levelFilter.value);
      if (sourceFilter.value) arr = arr.filter(l => (l.source || '') === sourceFilter.value);
      if (searchText.value) {
        const q = searchText.value.toLowerCase();
        arr = arr.filter(l => (l.msg || '').toLowerCase().includes(q) || (l.source || '').toLowerCase().includes(q));
      }
      return arr;
    });

    watch(() => store.log.length, () => {
      if (!store.logPaused && logBody.value) {
        nextTick(() => { logBody.value.scrollTop = logBody.value.scrollHeight; });
      }
    });

    function clearLog() { store.log.splice(0, store.log.length); }
    function exportLog() {
      $exportCSV(['时间', '级别', '来源', '消息'],
        filteredLog.value.map(l => [l.time, l.level, l.source, l.msg]),
        `log_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`);
    }

    return {
      levelFilter, sourceFilter, searchText, hideTickNoise, logBody, filteredLog, sources,
      clearLog, exportLog, store,
    };
  },
};
