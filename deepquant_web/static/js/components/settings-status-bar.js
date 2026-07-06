// ===== 设置页 KPI 状态条 =====

const SettingsStatusBar = {
  emits: ['go-strategy'],
  template: `
    <div class="stg-kpi-row">
      <div class="stg-kpi" :class="store.wsStatus ? 'accent-green' : 'accent-warn'">
        <span class="stg-kpi-val"><span class="ws-dot" :class="store.wsStatus ? 'on' : 'off'"></span></span>
        <span class="stg-kpi-lbl">WebSocket</span>
      </div>
      <div class="stg-kpi" :class="gatewayConnected ? 'accent-green' : 'accent-warn'">
        <span class="stg-kpi-val">{{ gatewayConnected ? '已连' : '未连' }}</span>
        <span class="stg-kpi-lbl"><term-label term="trading_gateway">交易网关</term-label></span>
      </div>
      <div class="stg-kpi">
        <span class="stg-kpi-val stg-kpi-text">{{ store.activeAccount || '—' }}</span>
        <span class="stg-kpi-lbl">当前账户</span>
      </div>
      <div class="stg-kpi" :class="ctaAvailable ? 'accent-blue' : ''">
        <span class="stg-kpi-val">{{ ctaAvailable ? '已加载' : '未安装' }}</span>
        <span class="stg-kpi-lbl">CTA 引擎</span>
      </div>
      <div class="stg-kpi-actions">
        <button v-if="ctaAvailable" type="button" class="btn btn-xs" @click="$emit('go-strategy')">策略中心 →</button>
      </div>
    </div>`,
  setup() {
    const gatewayConnected = computed(() => (store.connectedGateways || []).length > 0);
    const ctaAvailable = computed(() => store.ctaClasses.length > 0 || store.strategies.length > 0);
    return { store, gatewayConnected, ctaAvailable };
  },
};
