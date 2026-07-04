// ===== 数据管理：录制状态 =====
const DataRecorderPanel = {
  props: {
    status: { type: Object, default: null },
  },
  emits: ['refresh'],
  template: `
    <div class="data-recorder-panel">
      <div class="data-recorder-cards">
        <div class="data-stat-card">
          <div class="label">Tick 录制合约</div>
          <div class="value num">{{ status?.tick_symbols ?? '—' }}</div>
        </div>
        <div class="data-stat-card">
          <div class="label">Bar 录制合约</div>
          <div class="value num">{{ status?.bar_symbols ?? '—' }}</div>
        </div>
        <div class="data-stat-card" v-if="status?.db_size_bytes">
          <div class="label">数据库大小</div>
          <div class="value num">{{ fmtBytes(status.db_size_bytes) }}</div>
        </div>
      </div>
      <p class="hint-sub">{{ status?.hint || '由 start.sh 启动 DataRecorder…' }}</p>
      <p v-if="status?.db_path" class="hint-sub">路径：{{ status.db_path }}</p>
      <div class="panel-header" style="margin-top:12px">
        <span class="panel-title">最近 Tick 写入</span>
        <button class="btn btn-xs" @click="$emit('refresh')">刷新</button>
      </div>
      <table class="data-table compact">
        <thead><tr><th>合约</th><th class="num">条数</th><th>最新时间</th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in status?.recent_ticks || []" :key="'t'+i">
            <td>{{ r.symbol }}</td><td class="num">{{ r.count?.toLocaleString() }}</td>
            <td>{{ fmtEnd(r.end) }}</td>
          </tr>
          <tr v-if="!(status?.recent_ticks||[]).length"><td colspan="3" class="empty">暂无 Tick 录制</td></tr>
        </tbody>
      </table>
      <div class="panel-header" style="margin-top:12px"><span class="panel-title">最近 Bar 写入</span></div>
      <table class="data-table compact">
        <thead><tr><th>合约</th><th>周期</th><th class="num">条数</th><th>最新时间</th></tr></thead>
        <tbody>
          <tr v-for="(r, i) in status?.recent_bars || []" :key="'b'+i">
            <td>{{ r.symbol }}</td><td>{{ r.interval }}</td><td class="num">{{ r.count?.toLocaleString() }}</td>
            <td>{{ fmtEnd(r.end) }}</td>
          </tr>
          <tr v-if="!(status?.recent_bars||[]).length"><td colspan="4" class="empty">暂无 Bar 录制</td></tr>
        </tbody>
      </table>
    </div>`,
  setup() {
    function fmtEnd(v) {
      if (!v) return '—';
      return String(v).slice(0, 19).replace('T', ' ');
    }
    function fmtBytes(n) { return $fmtBytes(n); }
    return { fmtEnd, fmtBytes };
  },
};
