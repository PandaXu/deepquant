// ===== 设置 — 交易偏好（改即存） =====

const SettingsTradingPrefs = {
  template: `
    <div class="panel stg-section-panel">
      <div class="panel-header">
        <span class="panel-title">交易偏好</span>
        <span v-if="savedHint" class="stg-save-hint">{{ savedHint }}</span>
      </div>
      <div class="panel-body form-grid stg-form-body">
        <div class="form-row">
          <label>默认手数</label>
          <input v-model.number="prefs.defaultVolume" class="input" type="number" min="1" style="width:80px">
          <span class="hint-sub">下单面板默认填入的手数</span>
        </div>
        <div class="form-row">
          <label>下单确认</label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="prefs.orderConfirm" style="width:auto"> 提交前弹窗确认
          </label>
          <span class="hint-sub">避免误触实盘下单</span>
        </div>
        <div class="form-row">
          <label>价格闪动</label>
          <label class="checkbox-label">
            <input type="checkbox" v-model="prefs.priceFlash" style="width:auto"> 自选/行情涨跌闪动
          </label>
        </div>
      </div>
    </div>`,
  setup() {
    const loaded = $loadTradingPrefs();
    const prefs = reactive({
      defaultVolume: loaded.defaultVolume,
      orderConfirm: loaded.orderConfirm,
      priceFlash: loaded.priceFlash,
    });
    const savedHint = ref('');
    let saveTimer = null;
    let hintTimer = null;

    function persist() {
      $saveTradingPrefs({
        defaultVolume: prefs.defaultVolume || 1,
        orderConfirm: prefs.orderConfirm,
        priceFlash: prefs.priceFlash,
      });
      savedHint.value = '已自动保存';
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { savedHint.value = ''; }, 2000);
    }

    watch(prefs, () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 400);
    }, { deep: true });

    return { prefs, savedHint };
  },
};
