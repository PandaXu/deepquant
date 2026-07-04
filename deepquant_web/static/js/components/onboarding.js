// ===== 首次使用引导 =====

const TradingOnboarding = {
  emits: ['connect', 'add-watchlist', 'select-symbol'],
  template: `
    <div class="onboarding-card">
      <div class="ob-title">👋 欢迎使用 DeepQuant</div>
      <div class="ob-step">Step {{ step }}/3 · {{ stepTitle }}</div>
      <p class="ob-desc">{{ stepDesc }}</p>
      <div class="ob-actions">
        <button v-if="step === 1" class="btn btn-primary" @click="$emit('connect')">连接交易账户</button>
        <button v-if="step === 2" class="btn btn-primary" @click="$emit('add-watchlist')">添加默认自选</button>
        <button v-if="step === 3" class="btn btn-primary" @click="$emit('select-symbol')">选择合约开始</button>
        <button v-if="step === 1" class="btn btn-sm" @click="$emit('connect')">管理账户</button>
      </div>
      <div class="ob-progress">
        <span :class="{ done: step > 1 }">○ 连接网关</span>
        <span :class="{ done: step > 2 }">○ 添加自选</span>
        <span :class="{ done: step > 3 }">○ 开始交易</span>
      </div>
    </div>`,
  setup() {
    const step = computed(() => $onboardingStep() || 0);
    const stepTitle = computed(() => ['', '连接交易账户', '添加自选合约', '选择合约'][step.value] || '');
    const stepDesc = computed(() => ({
      1: '连接网关后才能订阅行情、查询持仓与下单。',
      2: '将常用合约加入自选，连接后自动订阅行情。',
      3: '在左侧自选列表点击合约，查看 K 线与盘口。',
    }[step.value] || ''));
    return { step, stepTitle, stepDesc };
  },
};
