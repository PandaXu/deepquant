// ===== Tab 4: 日志 =====
const TabLog = {
  template: `
    <div class="panel" style="display:flex;flex-direction:column;flex:1;margin:8px;min-height:0">
      <div class="panel-header">
        <span class="panel-title">📋 实时日志</span>
        <select v-model="levelFilter" style="width:80px;margin-left:12px" class="input input-sm">
          <option value="">全部</option><option>INFO</option><option>WARN</option><option>ERROR</option>
        </select>
        <input v-model="searchText" class="input input-sm" placeholder="搜索..." style="width:150px;margin-left:4px">
        <div style="margin-left:auto;display:flex;gap:4px">
          <button class="btn btn-xs" @click="store.logPaused = !store.logPaused">{{ store.logPaused ? '▶ 恢复' : '⏸ 暂停' }}</button>
          <button class="btn btn-xs" @click="clearLog">清空</button>
          <button class="btn btn-xs" @click="exportLog">CSV</button>
        </div>
      </div>
      <div class="panel-body" style="overflow:auto;flex:1;min-height:0" ref="logBody">
        <table class="data-table">
          <thead><tr>
            <th style="width:90px">时间</th>
            <th style="width:50px">级别</th>
            <th style="width:80px">来源</th>
            <th>消息</th>
          </tr></thead>
          <tbody>
            <tr v-for="(l, i) in filteredLog" :key="i" :class="'log-' + (l.level || 'INFO')">
              <td class="num" style="font-family:var(--font-mono);font-size:10px">{{ l.time }}</td>
              <td><span :class="'log-badge log-badge-' + (l.level || 'INFO')">{{ l.level || 'INFO' }}</span></td>
              <td style="font-size:11px;color:var(--text-dim)">{{ l.source }}</td>
              <td style="font-size:12px">{{ l.msg }}</td>
            </tr>
            <tr v-if="filteredLog.length === 0"><td colspan="4" class="empty">暂无日志</td></tr>
          </tbody>
        </table>
      </div>
      <div style="padding:4px 12px;font-size:10px;color:var(--text-dim);border-top:1px solid var(--border)">
        共 {{ store.log.length }} 条，显示 {{ filteredLog.length }} 条
      </div>
    </div>`,
  setup() {
    const { ref, computed, watch, nextTick } = Vue;

    const levelFilter = ref('');
    const searchText = ref('');
    const logBody = ref(null);

    const filteredLog = computed(() => {
      let arr = store.log;
      if (levelFilter.value) arr = arr.filter(l => l.level === levelFilter.value);
      if (searchText.value) {
        const q = searchText.value.toLowerCase();
        arr = arr.filter(l => (l.msg||'').toLowerCase().includes(q) || (l.source||'').toLowerCase().includes(q));
      }
      return arr;
    });

    // Auto-scroll
    watch(() => store.log.length, () => {
      if (!store.logPaused && logBody.value) {
        nextTick(() => { logBody.value.scrollTop = logBody.value.scrollHeight; });
      }
    });

    function clearLog() { store.log.splice(0, store.log.length); }
    function exportLog() {
      $exportCSV(['时间','级别','来源','消息'],
        filteredLog.value.map(l => [l.time, l.level, l.source, l.msg]),
        `log_${new Date().toISOString().slice(0,19).replace(/:/g,'-')}.csv`);
    }

    return { levelFilter, searchText, logBody, filteredLog, clearLog, exportLog, store };
  }
};
