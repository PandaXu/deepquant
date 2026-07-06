// ===== 设置 — 外观 =====

const SettingsAppearance = {
  template: `
    <div class="panel stg-section-panel">
      <div class="panel-header">
        <span class="panel-title">外观</span>
        <span v-if="savedHint" class="stg-save-hint">{{ savedHint }}</span>
      </div>
      <div class="panel-body stg-form-body">
        <div class="stg-appearance-split">
          <div class="form-grid">
            <div class="form-row">
              <label>字体</label>
              <select v-model="cfg.font" class="input">
                <option>PingFang SC</option>
                <option>Microsoft YaHei</option>
                <option>Inter</option>
              </select>
            </div>
            <div class="form-row">
              <label>字号</label>
              <input v-model.number="cfg.fontSize" class="input" type="number" min="10" max="18" style="width:80px">
            </div>
            <div class="form-row">
              <label>主题</label>
              <select v-model="cfg.theme" class="input">
                <option value="dark">暗色</option>
                <option value="light">亮色</option>
              </select>
            </div>
            <div class="form-row">
              <label>交易所可见性</label>
              <div class="stg-exchange-chips">
                <button type="button" class="btn btn-xs" @click="setAllExchanges(true)">全选</button>
                <button type="button" class="btn btn-xs" @click="setMainExchanges">主流期货</button>
                <label v-for="ex in exchanges" :key="ex.value" class="stg-exchange-chip" :class="{ on: cfg.visibleExchanges[ex.value] }">
                  <input type="checkbox" :checked="cfg.visibleExchanges[ex.value]" @change="cfg.visibleExchanges[ex.value] = $event.target.checked">
                  {{ ex.name }}
                </label>
              </div>
            </div>
          </div>
          <div class="stg-preview panel">
            <div class="panel-header"><span class="panel-title">预览</span></div>
            <div class="panel-body stg-preview-body">
              <div class="stg-preview-quote">
                <span class="stg-preview-name">螺纹钢 rb2609</span>
                <span class="stg-preview-price up">3,245</span>
                <span class="stg-preview-chg up">+12 (+0.37%)</span>
              </div>
              <div class="stg-preview-bars">
                <span v-for="(h, i) in previewBars" :key="i" class="stg-preview-bar" :style="{ height: h + 'px' }"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`,
  setup() {
    const cfg = reactive({
      font: 'PingFang SC',
      fontSize: 12,
      theme: 'dark',
      visibleExchanges: { CFFEX: true, SHFE: true, DCE: true, CZCE: true, INE: true, GFEX: true },
    });
    const exchanges = [
      { value: 'CFFEX', name: '中金所' }, { value: 'SHFE', name: '上期所' },
      { value: 'DCE', name: '大商所' }, { value: 'CZCE', name: '郑商所' },
      { value: 'INE', name: '上海能源' }, { value: 'GFEX', name: '广期所' },
    ];
    const previewBars = [28, 42, 35, 50, 38, 45, 32, 48, 40, 36];
    const savedHint = ref('');
    let saveTimer = null;
    let hintTimer = null;
    let skipWatch = false;

    function loadConfig() {
      try {
        const saved = $loadJson(PERSIST_KEYS.config, {});
        skipWatch = true;
        if (saved.font) cfg.font = saved.font;
        if (saved.fontSize) cfg.fontSize = saved.fontSize;
        if (saved.theme) cfg.theme = saved.theme;
        if (saved.visibleExchanges) cfg.visibleExchanges = { ...cfg.visibleExchanges, ...saved.visibleExchanges };
        skipWatch = false;
      } catch (e) { skipWatch = false; }
    }

    function applyLive() {
      $applyTheme(cfg.theme);
      document.documentElement.style.fontSize = cfg.fontSize + 'px';
    }

    function persist() {
      const payload = {
        font: cfg.font,
        fontSize: cfg.fontSize,
        theme: cfg.theme,
        visibleExchanges: cfg.visibleExchanges,
        ...$loadTradingPrefs(),
      };
      $saveJson(PERSIST_KEYS.config, payload);
      applyLive();
      savedHint.value = '已自动保存';
      clearTimeout(hintTimer);
      hintTimer = setTimeout(() => { savedHint.value = ''; }, 2000);
    }

    function setAllExchanges(on) {
      exchanges.forEach(ex => { cfg.visibleExchanges[ex.value] = on; });
    }

    function setMainExchanges() {
      setAllExchanges(false);
      ['CFFEX', 'SHFE', 'DCE', 'CZCE'].forEach(k => { cfg.visibleExchanges[k] = true; });
    }

    watch(cfg, () => {
      if (skipWatch) return;
      applyLive();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 500);
    }, { deep: true });

    onMounted(loadConfig);

    return { cfg, exchanges, previewBars, savedHint, setAllExchanges, setMainExchanges };
  },
};
