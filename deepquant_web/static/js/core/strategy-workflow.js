// ===== 策略生命周期 & 工作流（Web 量化平台模式，非 Desktop 复刻）=====

/** 生命周期阶段 — 从配置到实盘 */
const STRATEGY_LIFECYCLE = [
  { id: 'configured', label: '已配置', desc: '实例已创建' },
  { id: 'data_ready', label: '数据就绪', desc: '历史 K 线充足' },
  { id: 'researched', label: '已回测', desc: '完成研究验证' },
  { id: 'ready', label: '已预热', desc: '引擎初始化完成' },
  { id: 'live', label: '实盘中', desc: '自动交易运行' },
];

/** 快速创建模板（行业常见：类 + 合约 + 默认参数） */
const STRATEGY_TEMPLATES = [
  {
    id: 'dma_if',
    label: '双均线 · 沪深300',
    desc: '经典趋势跟踪，适合股指主力',
    class_name: 'DoubleMaStrategy',
    vt_symbol: 'IF2606.CFFEX',
    params: { fast_window: 10, slow_window: 20 },
  },
  {
    id: 'boll_rb',
    label: '布林通道 · 螺纹钢',
    desc: '区间突破，适合商品期货',
    class_name: 'BollChannelStrategy',
    vt_symbol: 'rb2609.SHFE',
    params: { boll_window: 18, boll_dev: 3.4, cci_window: 10, atr_window: 30, sl_multiplier: 5.2, fixed_size: 1 },
  },
  {
    id: 'atr_au',
    label: 'ATR-RSI · 黄金',
    desc: '波动率过滤的均值回归',
    class_name: 'AtrRsiStrategy',
    vt_symbol: 'au2609.SHFE',
    params: { atr_length: 22, rsi_length: 14 },
  },
];

const STRATEGY_FILTER_TABS = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '运行中' },
  { id: 'inited', label: '待启动' },
  { id: 'stopped', label: '草稿' },
];

function $lifecycleIndex(stepId) {
  return STRATEGY_LIFECYCLE.findIndex(s => s.id === stepId);
}

function $lifecycleProgress(stepId) {
  const i = $lifecycleIndex(stepId);
  if (i < 0) return 0;
  return Math.round(((i + 1) / STRATEGY_LIFECYCLE.length) * 100);
}

function $filterStrategies(list, filterId) {
  if (!filterId || filterId === 'all') return list || [];
  return (list || []).filter(s => $normStrategyStatus(s.status) === filterId);
}

function $checkStatusIcon(status) {
  return ({ ok: '✓', warn: '!', fail: '✗', optional: '○', pending: '…' }[status] || '·');
}

function $checkStatusClass(status) {
  return ({ ok: 'ok', warn: 'warn', fail: 'fail', optional: 'optional', pending: 'pending' }[status] || '');
}

/** 回测快照是否亏损（total_return 为 vnpy 百分数，< 0 为亏） */
function $isBacktestLoss(snapshot) {
  if (!snapshot || snapshot.total_return == null) return false;
  const n = Number(snapshot.total_return);
  return Number.isFinite(n) && n < 0;
}

function $suggestStrategyName(template, existingNames) {
  const base = (template.class_name || 'Strategy').replace(/Strategy$/, '').toLowerCase();
  const sym = (template.vt_symbol || 'sym').split('.')[0].toLowerCase();
  let name = `${base}_${sym}`;
  let n = 1;
  while (existingNames.includes(name)) {
    name = `${base}_${sym}_${++n}`;
  }
  return name;
}

/** 从策略实例填充回测抽屉（实例绑定模式） */
function $hydrateBacktestFromInstance(bt, strategy) {
  if (!bt || !strategy) return;
  bt.linkedInstance = true;
  bt.standalone = false;
  bt.strategyName = strategy.strategy_name || '';
  bt.className = strategy.class_name || '';
  bt.vtSymbol = strategy.vt_symbol || '';
  bt.params = { ...(strategy.parameters || {}) };
  bt.interval = $strategyBacktestInterval(bt.className);
}

/** 独立回测模式（数据 Tab 等入口，不绑定实例） */
function $hydrateBacktestStandalone(bt, vtSymbol, interval) {
  if (!bt) return;
  bt.linkedInstance = false;
  bt.standalone = true;
  bt.strategyName = '';
  bt.vtSymbol = vtSymbol || '';
  if (interval) bt.interval = interval;
  bt.params = {};
  bt.result = null;
}

let _btSessionCounter = 0;
function $nextBacktestSessionId() {
  _btSessionCounter += 1;
  return `bt-${Date.now()}-${_btSessionCounter}`;
}
