// ===== 数据管理：任务进度条（可收起） =====
const DataTaskBar = {
  emits: ['goLog'],
  template: `
    <div v-if="hasTasks" class="data-task-bar" :class="{ collapsed: !store.dataTaskBarExpanded }">
      <div class="data-task-bar-hd" @click="toggleExpand">
        <span class="data-task-bar-title">{{ barTitle }}</span>
        <div v-if="primaryProgress" class="data-task-progress-inline">
          <div class="data-task-progress-track">
            <div class="data-task-progress-fill" :style="{ width: primaryProgress.pct + '%' }"></div>
          </div>
          <span class="hint-sub">{{ primaryProgress.text }}</span>
        </div>
        <button class="btn btn-xs mut data-task-expand-btn" @click.stop="toggleExpand">
          {{ store.dataTaskBarExpanded ? '收起 ▾' : '展开 ▸' }}
        </button>
      </div>
      <div v-show="store.dataTaskBarExpanded" class="data-task-bar-body">
        <div v-for="t in visibleTasks" :key="t.id" class="data-task-item" :class="'task-' + t.status">
          <span v-if="t.status === 'running'" class="data-task-spinner">⏳</span>
          <span v-else-if="t.status === 'success'" class="data-task-ok">✓</span>
          <span v-else-if="t.status === 'error'" class="data-task-err">✕</span>
          <div class="data-task-main">
            <span class="data-task-label">{{ t.label }}</span>
            <span v-if="!t.progress?.total" class="hint-sub">{{ t.message || '' }}</span>
            <div v-if="t.progress?.total" class="data-task-progress-row">
              <div class="data-task-progress-track wide">
                <div class="data-task-progress-fill" :class="'task-' + t.status"
                  :style="{ width: progressPct(t) + '%' }"></div>
              </div>
              <span class="hint-sub">{{ progressText(t) }}</span>
            </div>
            <span v-else-if="t.message && t.progress?.total" class="hint-sub">{{ t.message }}</span>
          </div>
          <button v-if="t.status === 'running'" class="btn btn-xs mut" @click="cancel(t.id)">取消</button>
          <button v-else class="btn btn-xs mut" @click="dismiss(t.id)">×</button>
        </div>
        <div class="data-task-bar-foot">
          <button class="btn btn-xs" @click="$emit('goLog')">日志</button>
          <button v-if="finishedCount" class="btn btn-xs mut" @click="clearFinished">清除完成</button>
        </div>
      </div>
    </div>`,
  setup(props, { emit }) {
    const visibleTasks = computed(() => store.dataTasks.slice(0, 12));
    const hasTasks = computed(() => store.dataTasks.length > 0);
    const finishedCount = computed(() =>
      store.dataTasks.filter(t => t.status === 'success' || t.status === 'error').length
    );
    const runningTasks = computed(() => store.dataTasks.filter(t => t.status === 'running'));

    const primaryProgress = computed(() => {
      const t = runningTasks.value.find(x => x.progress?.total) || runningTasks.value[0];
      if (!t?.progress?.total) return null;
      const cur = t.progress.current || 0;
      const total = t.progress.total;
      return {
        pct: Math.min(100, Math.round((cur / total) * 100)),
        text: `${cur}/${total} · ${t.label}`,
      };
    });

    const barTitle = computed(() => {
      const n = runningTasks.value.length;
      if (n) return `补数进度 (${n} 进行中)`;
      if (finishedCount.value) return '补数任务';
      return '任务';
    });

    function progressPct(t) {
      if (!t.progress?.total) return t.status === 'success' ? 100 : 0;
      return Math.min(100, Math.round(((t.progress.current || 0) / t.progress.total) * 100));
    }

    function progressText(t) {
      const pct = progressPct(t);
      const msg = t.message || '';
      return `${t.progress.current}/${t.progress.total} (${pct}%)${msg ? ' · ' + msg : ''}`;
    }

    function toggleExpand() {
      store.dataTaskBarExpanded = !store.dataTaskBarExpanded;
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

    return {
      store, visibleTasks, hasTasks, finishedCount, primaryProgress, barTitle,
      progressPct, progressText, toggleExpand, dismiss, cancel, clearFinished,
    };
  },
};
