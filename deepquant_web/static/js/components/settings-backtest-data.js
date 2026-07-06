// ===== 设置 — 回测数据保留 =====

const SettingsBacktestData = {
  template: `
    <div class="panel stg-section-panel">
      <div class="panel-header">
        <span class="panel-title">回测数据保留</span>
        <span v-if="lastSaved" class="stg-save-hint">上次保存 {{ lastSaved }}</span>
      </div>
      <div class="panel-body form-grid stg-form-body">
        <div class="form-row">
          <label><term-label term="bt_max_saves">每实例最多保留</term-label></label>
          <input v-model.number="btSettings.max_saves_per_strategy" class="input" type="number" min="5" max="200" style="width:80px"> 条（非验证基准）
        </div>
        <div class="form-row">
          <label><term-label term="bt_retention_days">自动清理天数</term-label></label>
          <input v-model.number="btSettings.retention_days" class="input" type="number" min="0" max="3650" style="width:80px">
          <span class="hint-sub">0 = 不按时间清理</span>
        </div>
        <div class="form-row">
          <label><term-label term="bt_auto_archive_loss">存档亏损记录</term-label></label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="btSettings.auto_archive_loss" style="width:auto"> 自动保存亏损回测到历史
          </label>
        </div>
        <div class="stg-form-actions">
          <button type="button" class="btn btn-sm btn-primary" :disabled="saving" @click="saveBtSettings">
            {{ saving ? '保存中…' : '保存保留规则' }}
          </button>
        </div>
      </div>
    </div>`,
  setup() {
    const btSettings = reactive({
      max_saves_per_strategy: 20,
      retention_days: 0,
      auto_archive_loss: true,
    });
    const saving = ref(false);
    const lastSaved = ref('');

    function applyBtSettings(data) {
      if (!data) return;
      if (data.max_saves_per_strategy != null) btSettings.max_saves_per_strategy = data.max_saves_per_strategy;
      if (data.retention_days != null) btSettings.retention_days = data.retention_days;
      if (data.auto_archive_loss != null) btSettings.auto_archive_loss = data.auto_archive_loss;
    }

    function saveBtSettings() {
      saving.value = true;
      store._btSettingsPendingSave = true;
      $wsSend({
        action: 'set_backtest_settings',
        payload: {
          max_saves_per_strategy: parseInt(btSettings.max_saves_per_strategy, 10) || 20,
          retention_days: parseInt(btSettings.retention_days, 10) || 0,
          auto_archive_loss: !!btSettings.auto_archive_loss,
        },
      });
    }

    watch(() => store.backtestSettings, (data) => {
      applyBtSettings(data);
      if (store._btSettingsPendingSave) {
        store._btSettingsPendingSave = false;
        saving.value = false;
        lastSaved.value = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      }
    });

    onMounted(() => {
      $wsSend({ action: 'get_backtest_settings' });
    });

    return { btSettings, saving, lastSaved, saveBtSettings, store };
  },
};
