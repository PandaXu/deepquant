// ===== Tab 5: 设置 =====

const TabSettings = {
  template: `
    <div style="display:flex;flex-direction:column;flex:1;overflow-y:auto;padding:8px;gap:8px">
      <!-- Gateway Connection -->
      <div class="panel">
        <div class="panel-header"><span class="panel-title">🔌 网关连接</span></div>
        <div class="panel-body" style="padding:8px;display:flex;flex-direction:column;gap:8px">
          <div class="form-row"><label>网关</label><select v-model="gw.gateway" @change="onGatewayChange" class="input"><option value="">选择网关</option><option v-for="g in store.gateways" :value="g">{{ g }}</option></select></div>
          <div v-if="gw.gateway" class="form-grid">
            <div v-for="(v, k) in gw.settings" :key="k" class="form-row">
              <label>{{ k }}</label>
              <input v-model="gw.settings[k]" class="input" :type="k.toLowerCase().includes('password') ? 'password' : 'text'">
            </div>
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="btn btn-sm btn-primary" @click="connectGateway">连接</button>
              <button class="btn btn-sm btn-danger" @click="disconnectGateway">断开</button>
            </div>
          </div>
          <!-- Saved Accounts -->
          <div style="margin-top:8px">
            <div style="font-size:11px;font-weight:600;color:var(--text-dim);margin-bottom:4px">已存账户</div>
            <table class="data-table">
              <thead><tr><th></th><th>别名</th><th>网关</th><th>用户名</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="a in store.gatewayAccounts" :key="a.id || a.alias" :class="{ 'row-active': store.activeAccount === a.alias }">
                  <td><span class="ws-dot" :class="store.activeAccount === a.alias ? 'on' : 'off'" style="display:inline-block"></span></td>
                  <td>{{ a.alias }}</td><td>{{ a.gateway }}</td><td>{{ accountUsername(a) }}</td>
                  <td>
                    <button v-if="store.activeAccount === a.alias" class="btn btn-xs btn-warn" @click="disconnectAccount(a)">断开</button>
                    <button v-else class="btn btn-xs btn-primary" @click="connectAccount(a)">连接</button>
                    <button class="btn btn-xs" @click="loadAccount(a)">加载</button>
                    <button class="btn btn-xs btn-danger" @click="deleteAccount(a)">删除</button>
                  </td>
                </tr>
                <tr v-if="!store.gatewayAccounts || store.gatewayAccounts.length === 0"><td colspan="5" class="empty">无已存账户</td></tr>
              </tbody>
            </table>
            <button class="btn btn-sm" @click="saveCurrentAccount" style="margin-top:4px" :disabled="!gw.gateway">保存当前账户</button>
          </div>
        </div>
      </div>

      <!-- Account Table -->
      <div class="panel">
        <div class="panel-header"><span class="panel-title">💰 账户列表</span></div>
        <div class="panel-body" style="overflow:auto">
          <table class="data-table">
            <thead><tr><th>账户ID</th><th class="num">余额</th><th class="num">冻结</th><th class="num">可用</th><th>网关</th></tr></thead>
            <tbody>
              <tr v-for="a in accountList" :key="a.vt_accountid">
                <td>{{ a.vt_accountid }}</td><td class="num">{{ fmtPrice(a.balance) }}</td>
                <td class="num">{{ fmtPrice(a.frozen) }}</td><td class="num">{{ fmtPrice(a.available) }}</td>
                <td>{{ a.gateway_name }}</td>
              </tr>
              <tr v-if="accountList.length === 0"><td colspan="5" class="empty">暂无账户</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Trading Preferences -->
      <div class="panel">
        <div class="panel-header"><span class="panel-title">📋 交易偏好</span></div>
        <div class="panel-body form-grid" style="padding:8px">
          <div class="form-row"><label>默认手数</label><input v-model.number="tradePrefs.defaultVolume" class="input" type="number" min="1" style="width:80px"></div>
          <div class="form-row"><label>下单确认</label>
            <label class="checkbox-label"><input type="checkbox" v-model="tradePrefs.orderConfirm" style="width:auto"> 提交前弹窗确认</label></div>
          <div class="form-row"><label>价格闪动</label>
            <label class="checkbox-label"><input type="checkbox" v-model="tradePrefs.priceFlash" style="width:auto"> 自选/行情涨跌闪动</label></div>
          <button class="btn btn-sm btn-primary" @click="saveTradePrefs" style="margin-top:4px">保存交易偏好</button>
        </div>
      </div>

      <!-- Global Config -->
      <div class="panel">
        <div class="panel-header"><span class="panel-title">⚙️ 全局配置</span></div>
        <div class="panel-body form-grid" style="padding:8px">
          <div class="form-row"><label>字体</label><select v-model="cfg.font" class="input"><option>PingFang SC</option><option>Microsoft YaHei</option><option>Inter</option></select></div>
          <div class="form-row"><label>字号</label><input v-model="cfg.fontSize" class="input" type="number" min="10" max="18"></div>
          <div class="form-row"><label>主题</label><select v-model="cfg.theme" class="input"><option value="dark">暗色</option><option value="light">亮色</option></select></div>
          <div class="form-row"><label>交易所可见性</label>
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:4px">
              <label v-for="ex in exchanges" :key="ex.value" class="checkbox-label">
                <input type="checkbox" :checked="cfg.visibleExchanges[ex.value]" @change="cfg.visibleExchanges[ex.value] = $event.target.checked" style="width:auto">
                {{ ex.name }}
              </label>
            </div>
          </div>
          <button class="btn btn-sm btn-primary" @click="saveConfig" style="margin-top:8px">保存配置</button>
        </div>
      </div>
    </div>`,
  setup() {
    const gw = reactive({ gateway:'', settings:{} });
    const cfg = reactive({ font:'PingFang SC', fontSize:12, theme:'dark', visibleExchanges:{CFFEX:true,SHFE:true,DCE:true,CZCE:true,INE:true,GFEX:true} });
    const exchanges = [
      { value:'CFFEX', name:'中金所' }, { value:'SHFE', name:'上期所' },
      { value:'DCE', name:'大商所' }, { value:'CZCE', name:'郑商所' },
      { value:'INE', name:'上海能源' }, { value:'GFEX', name:'广期所' },
    ];
    const accountList = computed(() => Object.values(store.account));
    const tradePrefs = reactive({
      defaultVolume: $loadTradingPrefs().defaultVolume,
      orderConfirm: $loadTradingPrefs().orderConfirm,
      priceFlash: $loadTradingPrefs().priceFlash,
    });

    function saveTradePrefs() {
      $saveTradingPrefs({
        defaultVolume: tradePrefs.defaultVolume || 1,
        orderConfirm: tradePrefs.orderConfirm,
        priceFlash: tradePrefs.priceFlash,
      });
      $toast('交易偏好已保存', 'success');
    }

    // Load config from localStorage
    function loadConfig() {
      try {
        const saved = $loadJson(PERSIST_KEYS.config, {});
        if (saved.font) cfg.font = saved.font;
        if (saved.fontSize) cfg.fontSize = saved.fontSize;
        if (saved.theme) cfg.theme = saved.theme;
        if (saved.visibleExchanges) cfg.visibleExchanges = saved.visibleExchanges;
      } catch (e) { /* ignore */ }
    }
    function saveConfig() {
      $saveJson(PERSIST_KEYS.config, {
        font: cfg.font, fontSize: cfg.fontSize, theme: cfg.theme, visibleExchanges: cfg.visibleExchanges,
      });
      $toast('配置已保存', 'success');
      document.body.classList.toggle('theme-light', cfg.theme === 'light');
      document.documentElement.style.fontSize = cfg.fontSize + 'px';
    }

    async function onGatewayChange() {
      gw.settings = {};
      if (!gw.gateway) return;
      // Use default_setting from gateway object stored in _gatewayObjects
      const g = window._gatewayObjects ? window._gatewayObjects[gw.gateway] : null;
      if (g && g.default_setting) {
        gw.settings = JSON.parse(JSON.stringify(g.default_setting)); // deep clone
      }
    }
    const loadedAccountId = ref(null);

    function accountUsername(a) {
      const s = a.setting || {};
      return s['用户名'] || s.username || s['UserID'] || '—';
    }

    function connectGateway() {
      if (!gw.gateway) return;
      if (!loadedAccountId.value) {
        $toast('请从已存账户列表连接，或先保存当前账户', 'error');
        return;
      }
      $restConnectAccount(loadedAccountId.value);
    }
    function connectAccount(a) {
      loadedAccountId.value = a.id;
      gw.gateway = a.gateway;
      gw.settings = a.setting || {};
      $restConnectAccount(a.id);
    }
    function disconnectAccount(a) {
      $restDisconnectAccount(a.id);
      loadedAccountId.value = null;
      store.activeAccount = '';
      $toast(`已断开 ${a.alias}`, 'info');
    }
    function disconnectGateway() {
      if (!gw.gateway) return;
      if (loadedAccountId.value) {
        $restDisconnectAccount(loadedAccountId.value);
        loadedAccountId.value = null;
      }
      $toast(`已断开 ${gw.gateway}`, 'info');
    }
    function loadAccount(a) {
      loadedAccountId.value = a.id;
      gw.gateway = a.gateway;
      gw.settings = a.setting || {};
    }
    async function deleteAccount(a) {
      if (!confirm('确定删除账户 ' + a.alias + '?')) return;
      await $deleteGatewayAccount(a.id || a.alias);
      $toast('已删除', 'info');
    }
    async function saveCurrentAccount() {
      const alias = prompt('请输入账户别名:');
      if (!alias) return;
      await $saveGatewayAccount(alias, gw.gateway, gw.settings);
      $toast('已保存', 'success');
    }

    onMounted(async () => {
      loadConfig();
      // Load accounts first (fast, local DB) — gateway list is slower (HTTP to Gateway service)
      await $loadGatewayAccounts();
      // Load gateways in background, may timeout if Gateway service is down
      window._gatewayObjects = window._gatewayObjects || {};
      try { const data = await $apiGet('/api/gateways'); if (Array.isArray(data)) { store.gateways = data.map(g => { window._gatewayObjects[g.name] = g; return g.name; }); } } catch(e) {}
    });

    return { gw, cfg, exchanges, accountList, tradePrefs, saveTradePrefs, accountUsername, loadConfig, saveConfig, onGatewayChange,
      connectGateway, connectAccount, disconnectAccount, disconnectGateway, loadAccount, deleteAccount, saveCurrentAccount, store, fmtPrice: $fmtPrice, fmtVol: $fmtVol };
  }
};
