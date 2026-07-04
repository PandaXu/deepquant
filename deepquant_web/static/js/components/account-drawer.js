// ===== 账户连接侧滑面板 =====

const AccountDrawer = {
  props: { open: Boolean },
  emits: ['close', 'connected'],
  template: `
    <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer-panel">
        <div class="drawer-header">
          <span>连接交易账户</span>
          <button class="btn btn-xs" @click="$emit('close')">✕</button>
        </div>
        <div class="drawer-body">
          <table class="data-table">
            <thead><tr><th></th><th>别名</th><th>网关</th><th>用户</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="a in store.gatewayAccounts" :key="a.id || a.alias"
                :class="{ 'row-active': store.activeAccount === a.alias }">
                <td><span class="ws-dot" :class="store.activeAccount === a.alias ? 'on' : 'off'"></span></td>
                <td>{{ a.alias }}</td>
                <td>{{ a.gateway }}</td>
                <td>{{ username(a) }}</td>
                <td>
                  <button v-if="store.activeAccount === a.alias" class="btn btn-xs btn-warn" @click="disconnect(a)">断开</button>
                  <button v-else class="btn btn-xs btn-primary" @click="connect(a)">连接</button>
                </td>
              </tr>
              <tr v-if="!store.gatewayAccounts.length"><td colspan="5" class="empty">无已存账户，请前往设置添加</td></tr>
            </tbody>
          </table>
          <button class="btn btn-sm" style="margin-top:12px" @click="goSettings">管理账户 →</button>
        </div>
      </div>
    </div>`,
  setup(props, { emit }) {
    function username(a) {
      const s = a.setting || {};
      return s['用户名'] || s.username || s['UserID'] || '—';
    }
    async function connect(a) {
      const ok = await $restConnectAccount(a.id);
      if (ok) { emit('connected'); emit('close'); }
    }
    async function disconnect(a) {
      await $restDisconnectAccount(a.id);
      emit('close');
    }
    function goSettings() {
      emit('close');
      window.__setActiveTab && window.__setActiveTab('settings');
    }
    onMounted(() => { $loadGatewayAccounts(); });
    return { store, username, connect, disconnect, goSettings };
  },
};
