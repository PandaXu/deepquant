// ===== 数据管理：任务条（运行中 + 最近完成） =====
const DataTaskBar = {
  emits: ['goLog', 'dismiss'],
  template: `
    <div v-if="visibleTasks.length" class="data-task-bar">
      <div v-for="t in visibleTasks" :key="t.id" class="data-task-item" :class="'task-' + t.status">
        <span v-if="t.status === 'running'" class="data-task-spinner">⏳</span>
        <span v-else-if="t.status === 'success'" class="data-task-ok">✓</span>
        <span v-else-if="t.status === 'error'" class="data-task-err">✕</span>
        <span class="data-task-label">{{ t.label }}</span>
        <span class="hint-sub">{{ progressText(t) }}</span>
        <button v-if="t.status === 'running'" class="btn btn-xs mut" @click="cancel(t.id)">取消</button>
        <button v-else class="btn btn-xs mut" @click="dismiss(t.id)">×</button>
      </div>
      <button class="btn btn-xs" @click="$emit('goLog')">日志</button>
      <button v-if="finishedCount" class="btn btn-xs mut" @click="clearFinished">清除完成</button>
    </div>`,
  setup(props, { emit }) {
    const visibleTasks = computed(() => store.dataTasks.slice(0, 8));
    const finishedCount = computed(() =>
      store.dataTasks.filter(t => t.status === 'success' || t.status === 'error').length
    );

    function progressText(t) {
      if (t.progress?.total) {
        const pct = `${t.progress.current}/${t.progress.total}`;
        const msg = t.message || '';
        return msg ? `${pct} · ${msg}` : pct;
      }
      return t.message || '';
    }

    function dismiss(id) {
      const i = store.dataTasks.findIndex(t => t.id === id);
      if (i >= 0) store.dataTasks.splice(i, 1);
    }

    function cancel(id) {
      $cancelDataTask(id);
      dismiss(id);
    }

    function clearFinished() {
      store.dataTasks = store.dataTasks.filter(t => t.status === 'running');
    }

    return { visibleTasks, finishedCount, progressText, dismiss, cancel, clearFinished, store };
  },
};
