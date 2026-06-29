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
              <thead><tr><th>别名</th><th>网关</th><th>用户名</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="a in store.gatewayAccounts" :key="a.id || a.alias">
                  <td>{{ a.alias }}</td><td>{{ a.gateway }}</td><td>{{ a.username || '—' }}</td>
                  <td>
                    <button class="btn btn-xs" @click="loadAccount(a)">加载</button>
                    <button class="btn btn-xs btn-danger" @click="deleteAccount(a)">删除</button>
                  </td>
                </tr>
                <tr v-if="!store.gatewayAccounts || store.gatewayAccounts.length === 0"><td colspan="4" class="empty">无已存账户</td></tr>
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
                <td>{{ a.vt_accountid }}</td><td class="num">{{ $fmtPrice(a.balance) }}</td>
                <td class="num">{{ $fmtPrice(a.frozen) }}</td><td class="num">{{ $fmtPrice(a.available) }}</td>
                <td>{{ a.gateway_name }}</td>
              </tr>
              <tr v-if="accountList.length === 0"><td colspan="5" class="empty">暂无账户</td></tr>
            </tbody>
          </table>
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

    // Load config from localStorage
    function loadConfig() {
      try {
        const saved = JSON.parse(localStorage.getItem('deepquant_config') || '{}');
        if (saved.font) cfg.font = saved.font;
        if (saved.fontSize) cfg.fontSize = saved.fontSize;
        if (saved.theme) cfg.theme = saved.theme;
        if (saved.visibleExchanges) cfg.visibleExchanges = saved.visibleExchanges;
      } catch(e){}
    }
    function saveConfig() {
      localStorage.setItem('deepquant_config', JSON.stringify({ font:cfg.font, fontSize:cfg.fontSize, theme:cfg.theme, visibleExchanges:cfg.visibleExchanges }));
      $toast('配置已保存', 'success');
      // Apply theme
      if (cfg.theme === 'light') document.body.classList.add('theme-light');
      else document.body.classList.remove('theme-light');
    }

    async function onGatewayChange() {
      gw.settings = {};
      if (!gw.gateway) return;
      try {
        const setting = await $apiGet(`/api/gateway-settings?gateway=${gw.gateway}`);
        gw.settings = setting || {};
      } catch(e){ $toast('加载网关设置失败', 'error'); }
    }
    function connectGateway() {
      if (!gw.gateway) return;
      $wsSend({ action: 'connect_gateway', payload: { gateway_name: gw.gateway, setting: gw.settings } });
      $toast(`正在连接 ${gw.gateway}...`, 'info');
    }
    function disconnectGateway() {
      if (!gw.gateway) return;
      $wsSend({ action: 'disconnect_gateway', payload: { gateway_name: gw.gateway } });
      $toast(`已断开 ${gw.gateway}`, 'info');
    }
    function loadAccount(a) {
      gw.gateway = a.gateway;
      try { gw.settings = JSON.parse(a.setting_json || '{}'); } catch(e){ gw.settings = {}; }
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
      $wsSend({ action: 'get_gateways' });
      await $loadGatewayAccounts();
    });

    return { gw, cfg, exchanges, accountList, loadConfig, saveConfig, onGatewayChange,
      connectGateway, disconnectGateway, loadAccount, deleteAccount, saveCurrentAccount, store };
  }
};
