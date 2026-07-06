// ===== 设置 — 连接与账户 =====

const SettingsAccounts = {
  template: `
    <div class="stg-accounts">
      <div class="stg-acct-list panel">
        <div class="panel-header">
          <span class="panel-title">已存账户</span>
          <button type="button" class="btn btn-xs btn-primary" @click="startNew">+ 添加</button>
        </div>
        <div class="panel-body stg-acct-list-body">
          <div v-if="gwLoadError" class="stg-inline-error">
            {{ gwLoadError }}
            <button type="button" class="btn btn-xs" @click="loadGateways">重试</button>
          </div>
          <div v-if="!store.gatewayAccounts.length && !gwLoadError" class="stg-empty">
            <p>尚未添加交易账户</p>
            <p class="hint-sub">连接后可订阅行情、查看持仓与下单</p>
            <button type="button" class="btn btn-sm btn-primary" @click="startNew">添加第一个账户</button>
          </div>
          <div v-for="a in store.gatewayAccounts" :key="a.id || a.alias"
            class="stg-acct-item" :class="{ active: selectedId === a.id, connected: store.activeAccount === a.alias }"
            @click="selectAccount(a)">
            <span class="ws-dot" :class="store.activeAccount === a.alias ? 'on' : 'off'"></span>
            <div class="stg-acct-info">
              <div class="stg-acct-alias">{{ a.alias }}</div>
              <div class="stg-acct-sub">{{ a.gateway }} · {{ accountUsername(a) }}</div>
            </div>
            <div class="stg-acct-actions" @click.stop>
              <button v-if="store.activeAccount === a.alias" type="button" class="btn btn-xs btn-warn" @click="disconnect(a)">断开</button>
              <button v-else type="button" class="btn btn-xs btn-primary" @click="connect(a)">连接</button>
            </div>
          </div>
        </div>
      </div>

      <div class="stg-acct-form panel">
        <div class="panel-header">
          <span class="panel-title">{{ formTitle }}</span>
        </div>
        <div class="panel-body stg-form-body">
          <div v-if="mode === 'idle'" class="stg-empty stg-empty-sm">
            <p>从左侧选择账户进行编辑，或点击「添加」创建新账户</p>
          </div>
          <div v-else-if="!gw.gateway && mode === 'new'" class="stg-empty stg-empty-sm">
            <p>请先选择网关类型</p>
          </div>
          <template v-else>
            <div class="form-row">
              <label>账户别名</label>
              <input v-model="form.alias" class="input" placeholder="如 SimNow 仿真" maxlength="32">
            </div>
            <div class="form-row">
              <label>网关类型</label>
              <select v-model="gw.gateway" class="input" :disabled="mode === 'edit'" @change="onGatewayChange">
                <option value="">选择网关</option>
                <option v-for="g in store.gateways" :key="g" :value="g">{{ g }}</option>
              </select>
            </div>
            <div v-if="gw.gateway" class="stg-field-grid">
              <div v-for="(v, k) in gw.settings" :key="k" class="form-row">
                <label>{{ k }}</label>
                <select v-if="Array.isArray(v)" v-model="gw.settings[k]" class="input">
                  <option v-for="opt in v" :key="opt" :value="opt">{{ opt }}</option>
                </select>
                <input v-else v-model="gw.settings[k]" class="input"
                  :type="fieldType(k)" :placeholder="fieldPlaceholder(k)">
              </div>
            </div>
            <div class="stg-form-actions">
              <button type="button" class="btn btn-sm btn-primary" :disabled="!canSave" @click="saveAccount">
                {{ mode === 'edit' ? '保存更改' : '保存账户' }}
              </button>
              <button v-if="mode === 'edit'" type="button" class="btn btn-sm btn-danger" @click="confirmDelete">删除</button>
              <button v-if="mode === 'new'" type="button" class="btn btn-sm" @click="cancelNew">取消</button>
            </div>
          </template>
        </div>
      </div>

      <confirm-modal
        :open="deleteConfirm.open"
        title="删除账户"
        :message="'确定删除账户「' + (deleteConfirm.alias || '') + '」？此操作不可撤销。'"
        confirm-label="删除"
        danger
        @confirm="doDelete"
        @cancel="deleteConfirm.open = false"
      />
    </div>`,
  setup() {
    const gw = reactive({ gateway: '', settings: {} });
    const form = reactive({ alias: '' });
    const selectedId = ref(null);
    const mode = ref('idle'); // idle | new | edit
    const gwLoadError = ref('');
    const deleteConfirm = reactive({ open: false, id: null, alias: '' });

    const formTitle = computed(() => {
      if (mode.value === 'new') return '添加账户';
      if (mode.value === 'edit') return '编辑账户';
      return '账户详情';
    });

    const canSave = computed(() => {
      if (!gw.gateway || !form.alias.trim()) return false;
      return true;
    });

    function accountUsername(a) {
      const s = a.setting || {};
      return s['用户名'] || s.username || s['UserID'] || '—';
    }

    function fieldType(k) {
      const lower = String(k).toLowerCase();
      if (lower.includes('password') || lower.includes('密码')) return 'password';
      return 'text';
    }

    function fieldPlaceholder(k) {
      if (String(k).includes('服务器')) return 'tcp://host:port';
      return '';
    }

    async function loadGateways() {
      gwLoadError.value = '';
      window._gatewayObjects = window._gatewayObjects || {};
      try {
        const data = await $apiGet('/api/gateways');
        if (Array.isArray(data)) {
          store.gateways = data.map(g => {
            window._gatewayObjects[g.name] = g;
            return g.name;
          });
        }
      } catch (e) {
        gwLoadError.value = '网关服务不可用，请确认 Gateway 已启动';
      }
    }

    async function onGatewayChange() {
      gw.settings = {};
      if (!gw.gateway) return;
      const g = window._gatewayObjects ? window._gatewayObjects[gw.gateway] : null;
      if (g?.default_setting) {
        gw.settings = JSON.parse(JSON.stringify(g.default_setting));
        Object.keys(gw.settings).forEach(k => {
          if (Array.isArray(gw.settings[k])) {
            gw.settings[k] = gw.settings[k][0] || '';
          }
        });
      }
    }

    function selectAccount(a) {
      selectedId.value = a.id;
      mode.value = 'edit';
      form.alias = a.alias;
      gw.gateway = a.gateway;
      gw.settings = JSON.parse(JSON.stringify(a.setting || {}));
    }

    function startNew() {
      selectedId.value = null;
      mode.value = 'new';
      form.alias = '';
      gw.gateway = store.gateways[0] || '';
      onGatewayChange();
    }

    function cancelNew() {
      mode.value = 'idle';
      selectedId.value = null;
      form.alias = '';
      gw.gateway = '';
      gw.settings = {};
    }

    async function saveAccount() {
      const alias = form.alias.trim();
      if (!alias) { $toast('请填写账户别名', 'error'); return; }
      if (!gw.gateway) { $toast('请选择网关', 'error'); return; }
      const setting = JSON.parse(JSON.stringify(gw.settings));
      if (mode.value === 'edit' && selectedId.value) {
        const r = await $updateGatewayAccount(selectedId.value, alias, setting);
        if (r) $toast('账户已更新', 'success');
      } else {
        const r = await $saveGatewayAccount(alias, gw.gateway, setting);
        if (r) {
          $toast('账户已保存', 'success');
          selectAccount(r);
        }
      }
    }

    function confirmDelete() {
      deleteConfirm.id = selectedId.value;
      deleteConfirm.alias = form.alias;
      deleteConfirm.open = true;
    }

    async function doDelete() {
      deleteConfirm.open = false;
      if (!deleteConfirm.id) return;
      await $deleteGatewayAccount(deleteConfirm.id);
      $toast('已删除', 'info');
      cancelNew();
    }

    async function connect(a) {
      selectAccount(a);
      await $restConnectAccount(a.id);
    }

    async function disconnect(a) {
      await $restDisconnectAccount(a.id);
      if (store.activeAccount === a.alias) store.activeAccount = '';
    }

    onMounted(async () => {
      await $loadGatewayAccounts();
      await loadGateways();
      window.__settingsStartNewAccount = startNew;
    });

    onUnmounted(() => {
      if (window.__settingsStartNewAccount === startNew) window.__settingsStartNewAccount = null;
    });

    return {
      store, gw, form, selectedId, mode, gwLoadError, deleteConfirm, formTitle, canSave,
      accountUsername, fieldType, fieldPlaceholder, loadGateways, onGatewayChange,
      selectAccount, startNew, cancelNew, saveAccount, confirmDelete, doDelete, connect, disconnect,
    };
  },
};
