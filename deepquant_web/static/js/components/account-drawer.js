// ===== 账户连接侧滑面板 =====

const AccountDrawer = {
  props: { open: Boolean },
  emits: ['close', 'connected', 'manage'],
  template: `
    <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
      <div class="drawer-panel">
        <div class="drawer-header">
          <span>连接交易账户</span>
          <button type="button" class="btn btn-xs" @click="$emit('close')">✕</button>
        </div>
        <div class="drawer-body">
          <div v-if="store.activeAccount" class="stg-drawer-active">
            <span class="ws-dot on"></span>
            当前：<b>{{ store.activeAccount }}</b>
            <span v-if="activeGw" class="hint-sub"> · {{ activeGw }}</span>
          </div>
          <table class="data-table compact">
            <thead><tr><th></th><th>别名</th><th>网关</th><th>用户</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="a in store.gatewayAccounts" :key="a.id || a.alias"
                :class="{ 'row-active': store.activeAccount === a.alias }">
                <td><span class="ws-dot" :class="store.activeAccount === a.alias ? 'on' : 'off'"></span></td>
                <td>{{ a.alias }}</td>
                <td>{{ a.gateway }}</td>
                <td>{{ username(a) }}</td>
                <td>
                  <button v-if="store.activeAccount === a.alias" type="button" class="btn btn-xs btn-warn" @click="disconnect(a)">断开</button>
                  <button v-else type="button" class="btn btn-xs btn-primary" @click="connect(a)">连接</button>
                </td>
              </tr>
              <tr v-if="!store.gatewayAccounts.length"><td colspan="5" class="empty">无已存账户</td></tr>
            </tbody>
          </table>
          <div class="stg-drawer-actions">
            <button type="button" class="btn btn-sm btn-primary" @click="goAdd">+ 添加账户</button>
            <button type="button" class="btn btn-sm" @click="goManage">管理账户 →</button>
          </div>
        </div>
      </div>
    </div>`,
  setup(props, { emit }) {
    const activeGw = computed(() => {
      const a = store.gatewayAccounts.find(x => x.alias === store.activeAccount);
      return a?.gateway || '';
    });

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

    function goManage() {
      emit('close');
      emit('manage');
    }

    function goAdd() {
      emit('close');
      window.__setActiveTab && window.__setActiveTab('settings', 'accounts');
      nextTick(() => window.__settingsStartNewAccount && window.__settingsStartNewAccount());
    }

    onMounted(() => { $loadGatewayAccounts(); });

    return { store, activeGw, username, connect, disconnect, goManage, goAdd };
  },
};
