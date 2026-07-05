// ===== 内置 CTA 策略原理 & 参数说明（基于 vnpy_ctastrategy 源码）=====

const STRATEGY_DOCS = {
  DoubleMaStrategy: {
    type: '趋势跟踪',
    timeframe: '1 分钟 K 线',
    summary: '通过快、慢两条简单移动平均线的金叉/死叉判断趋势方向，是最经典的 CTA 入门策略。',
    logic: [
      'Tick 合成 1 分钟 K 线，计算 fast_window 与 slow_window 周期的 SMA。',
      '快线上穿慢线（金叉）→ 开多或平空反手做多；快线下穿慢线（死叉）→ 开空或平多反手做空。',
      '已有反向持仓时会先平仓再开新方向，保证单向持仓。',
    ],
    params: [
      { name: 'fast_window', label: '快均线周期', default: 10, logic: '越小越敏感，信号多但假突破多；常用 5–20。' },
      { name: 'slow_window', label: '慢均线周期', default: 20, logic: '决定趋势过滤强度；必须大于 fast_window，常用 20–60。' },
    ],
    risks: ['震荡市频繁交叉导致来回止损（whiplash）。', '仅 1 手固定下单，未做仓位管理。'],
    suitable: ['趋势明显的股指/商品主力', '配合较长周期回测验证参数'],
  },

  BollChannelStrategy: {
    type: '通道突破 + 止损',
    timeframe: '1 分钟 → 15 分钟 K 线',
    summary: '在 15 分钟周期上，用布林带上下轨作为突破入场价，CCI 过滤方向，ATR 追踪止损。',
    logic: [
      '1 分钟 K 线聚合为 15 分钟 K 线后计算指标。',
      '空仓：CCI > 0 在布林上轨挂多单；CCI < 0 在布林下轨挂空单。',
      '持多：记录持仓期最高价，止损价 = 最高价 − ATR × sl_multiplier。',
      '持空：记录持仓期最低价，止损价 = 最低价 + ATR × sl_multiplier。',
    ],
    params: [
      { name: 'boll_window', label: '布林周期', default: 18, logic: '中轨 SMA 窗口；越大通道越宽、信号越少。' },
      { name: 'boll_dev', label: '布林标准差倍数', default: 3.4, logic: '上下轨宽度；越大越难突破、假信号少。' },
      { name: 'cci_window', label: 'CCI 周期', default: 10, logic: '判断多空倾向；CCI 穿越 0 轴决定做多/做空方向。' },
      { name: 'atr_window', label: 'ATR 周期', default: 30, logic: '用于计算动态止损距离。' },
      { name: 'sl_multiplier', label: '止损 ATR 倍数', default: 5.2, logic: '越大止损越宽、越不易被洗出。' },
      { name: 'fixed_size', label: '固定手数', default: 1, logic: '每次开仓数量。' },
    ],
    risks: ['15 分钟级别信号滞后于 1 分钟 tick 流。', 'CCI 与布林组合在横盘时仍可能反复入场。'],
    suitable: ['波动适中的期货品种', '需足够 15m 历史数据'],
  },

  AtrRsiStrategy: {
    type: '波动过滤 + 动量',
    timeframe: '1 分钟 K 线',
    summary: '仅在 ATR 高于其均值（市场活跃）时，用 RSI 超买超卖区触发顺势/反转入场，并用百分比 trailing 止损。',
    logic: [
      'ATR > ATR 均值 → 认为波动放大，允许交易；否则观望。',
      'RSI > 50+rsi_entry → 做多；RSI < 50−rsi_entry → 做空。',
      '持多：止损 = 持仓期最高价 × (1 − trailing_percent/100)。',
      '持空：止损 = 持仓期最低价 × (1 + trailing_percent/100)。',
    ],
    params: [
      { name: 'atr_length', label: 'ATR 周期', default: 22, logic: '衡量当前波动率的窗口。' },
      { name: 'atr_ma_length', label: 'ATR 均值窗口', default: 10, logic: '当前 ATR 需高于该均值才开仓，过滤低波动时段。' },
      { name: 'rsi_length', label: 'RSI 周期', default: 5, logic: '较短周期 RSI 更敏感。' },
      { name: 'rsi_entry', label: 'RSI 入场偏移', default: 16, logic: '实际阈值 = 50±rsi_entry；越大越极端才入场。' },
      { name: 'trailing_percent', label: '移动止损比例(%)', default: 0.8, logic: '从极值价回撤该比例触发平仓。' },
      { name: 'fixed_size', label: '固定手数', default: 1, logic: '每次开仓数量。' },
    ],
    risks: ['RSI 阈值策略在强趋势中可能过早反向。', '固定 +5 tick 滑点加价下单，实盘需注意成交价。'],
    suitable: ['日内波动较大的贵金属、能源', '短周期参数需回测调优'],
  },

  KingKeltnerStrategy: {
    type: '通道突破（OCO）',
    timeframe: '1 分钟 → 5 分钟 K 线',
    summary: '肯特纳通道上下轨同时挂突破单（OCO），成交后用 trailing 百分比保护利润。',
    logic: [
      '5 分钟 K 线计算 Keltner 通道（EMA + ATR 带宽）。',
      '空仓：在 kk_up / kk_down 同时挂 buy stop 与 sell stop，任一触发后取消另一腿。',
      '持多/空：按 intra_trade 极值价 × trailing_percent 挂 trailing 止损单。',
    ],
    params: [
      { name: 'kk_length', label: 'Keltner EMA 周期', default: 11, logic: '通道中轨均线长度。' },
      { name: 'kk_dev', label: 'Keltner ATR 倍数', default: 1.6, logic: '通道宽度；越大突破门槛越高。' },
      { name: 'trailing_percent', label: '移动止损比例(%)', default: 0.8, logic: '持仓后从有利方向极值回撤该比例止损。' },
      { name: 'fixed_size', label: '固定手数', default: 1, logic: 'OCO 两条腿各下的手数。' },
    ],
    risks: ['OCO 在跳空时可能双向下单风险需关注。', '5 分钟合成延迟。'],
    suitable: ['有明确日内区间的品种', '适合突破型行情'],
  },

  TurtleSignalStrategy: {
    type: '趋势跟踪（海龟）',
    timeframe: '1 分钟 K 线',
    summary: '经典海龟法则简化版：唐奇安通道突破入场，ATR 加仓与止损，短通道出场。',
    logic: [
      '空仓：entry_window 日唐奇安高点/低点挂突破单；ATR 用于加仓间距。',
      '最多 4 单位加仓（每 0.5/1/1.5 ATR 加一档）。',
      '持多：止损 = 入场价 − 2×ATR；出场参考 exit_window 唐奇安下轨。',
      '持空：止损 = 入场价 + 2×ATR；出场参考 exit_window 唐奇安上轨。',
    ],
    params: [
      { name: 'entry_window', label: '入场唐奇安周期', default: 20, logic: '突破 N 日高/低才入场；越大信号越少、越偏中长期。' },
      { name: 'exit_window', label: '出场唐奇安周期', default: 10, logic: '通常小于 entry_window，用于止盈/出场。' },
      { name: 'atr_window', label: 'ATR 周期', default: 20, logic: '加仓间距与初始止损距离。' },
      { name: 'fixed_size', label: '单位手数', default: 1, logic: '海龟每个「单位」的手数。' },
    ],
    risks: ['趋势反转时加仓会放大亏损。', '1 分钟 tick 合成下 channel 与经典日线海龟有差异。'],
    suitable: ['长趋势品种（股指、有色）', '需充足历史数据初始化 channel'],
  },

  DualThrustStrategy: {
    type: '日内区间突破',
    timeframe: '1 分钟 K 线（日内）',
    summary: '根据前一日高低点计算 Range，在当日开盘价上下 k1/k2 倍 Range 处挂突破单，收盘前强平。',
    logic: [
      '新交易日：day_range = 前日 high − low；long_entry = 今开 + k1×range；short_entry = 今开 − k2×range。',
      '盘中：收盘价高于今开 → 尝试做多突破；低于今开 → 尝试做空突破。',
      '持有一腿后会反向挂出另一腿止损（类似反转系统）。',
      '14:55 后强制平仓，不隔夜。',
    ],
    params: [
      { name: 'k1', label: '上轨系数', default: 0.4, logic: '做多触发线距离开盘的 Range 倍数；越大越难触发。' },
      { name: 'k2', label: '下轨系数', default: 0.6, logic: '做空触发线；可与 k1 不对称以偏好多/空一侧。' },
      { name: 'fixed_size', label: '固定手数', default: 1, logic: '每次突破下单手数。' },
    ],
    risks: ['Range 过小日易假突破；过大日难入场。', '14:55 强平可能错过尾部行情。'],
    suitable: ['日内波动规律的股指期货', '不适合隔夜持仓需求'],
  },

  MultiSignalStrategy: {
    type: '多因子投票',
    timeframe: '多信号合成（RSI/CCI/MA 各 1m，MA 为 5m）',
    summary: 'RSI、CCI、均线三个子信号各输出 −1/0/+1，求和后作为目标仓位，由 TargetPos 模板自动调仓。',
    logic: [
      'RsiSignal：RSI 高于 50+level → +1，低于 50−level → −1。',
      'CciSignal：CCI 高于 +level → +1，低于 −level → −1。',
      'MaSignal：5 分钟快均线 > 慢均线 → +1，反之 −1。',
      'target_pos = rsi + cci + ma（范围 −3 ~ +3），模板引擎自动买卖至目标仓位。',
    ],
    params: [
      { name: 'rsi_window', label: 'RSI 周期', default: 14, logic: 'RSI 子信号计算窗口。' },
      { name: 'rsi_level', label: 'RSI 阈值偏移', default: 20, logic: '实际边界 50±level。' },
      { name: 'cci_window', label: 'CCI 周期', default: 30, logic: 'CCI 子信号窗口。' },
      { name: 'cci_level', label: 'CCI 阈值', default: 10, logic: 'CCI 超过 ±level 才出信号。' },
      { name: 'fast_window', label: 'MA 快线（5m）', default: 5, logic: '5 分钟 K 线上的快均线。' },
      { name: 'slow_window', label: 'MA 慢线（5m）', default: 20, logic: '5 分钟 K 线上的慢均线。' },
    ],
    risks: ['三信号简单相加，可能频繁调仓。', '目标仓位可达 ±3 手，需关注资金与保证金。'],
    suitable: ['希望分散单一指标风险的场景', '需理解 TargetPos 自动调仓逻辑'],
  },

  MultiTimeframeStrategy: {
    type: '多周期过滤',
    timeframe: '15 分钟定方向 + 5 分钟找入场',
    summary: '15 分钟均线定大趋势，5 分钟 RSI 在趋势方向上寻找入场，反向趋势或 RSI 回归中线时出场。',
    logic: [
      '15m：fast_ma vs slow_ma → ma_trend = +1（多）或 −1（空）。',
      '5m：仅在 ma_trend>0 且 RSI≥rsi_long 时做多；ma_trend<0 且 RSI≤rsi_short 时做空。',
      '持多：ma_trend 转空或 RSI<50 平多；持空：ma_trend 转多或 RSI>50 平空。',
    ],
    params: [
      { name: 'rsi_signal', label: 'RSI 入场偏移', default: 20, logic: '5m RSI 阈值 = 50±rsi_signal。' },
      { name: 'rsi_window', label: 'RSI 周期（5m）', default: 14, logic: '短周期入场 RSI。' },
      { name: 'fast_window', label: '趋势快线（15m）', default: 5, logic: '大周期方向判断。' },
      { name: 'slow_window', label: '趋势慢线（15m）', default: 20, logic: '大周期方向判断。' },
      { name: 'fixed_size', label: '固定手数', default: 1, logic: '每次开仓手数。' },
    ],
    risks: ['15m 趋势切换滞后，5m 可能已反向。', '需同时维护两套 K 线缓存。'],
    suitable: ['希望「大周期定方向、小周期择时」的场景'],
  },

  TestStrategy: {
    type: '系统测试',
    timeframe: 'Tick 驱动',
    summary: '非盈利策略，用于验证网关下单、撤单、停止单等接口是否正常。',
    logic: [
      '每收到 test_trigger 个 tick 执行一项测试：市价单 → 限价单 → 全撤 → 停止单。',
      '全部完成后 test_all_done = true，不再交易。',
    ],
    params: [
      { name: 'test_trigger', label: 'Tick 间隔', default: 10, logic: '累计多少 tick 触发下一项测试。' },
    ],
    risks: ['会在实盘发出真实委托，仅限仿真/小资金测试。'],
    suitable: ['联调网关与交易系统', '勿用于生产盈利'],
  },

  CtaTemplate: {
    type: '开发模板',
    timeframe: '自定义',
    summary: 'VeighNa CTA 策略开发基类，本身不产生交易信号，供二次开发继承。',
    logic: ['继承 CtaTemplate 并实现 on_init / on_start / on_tick / on_bar 等回调。'],
    params: [],
    risks: ['直接使用无实际逻辑。'],
    suitable: ['策略开发者自定义实现'],
  },

  RbreakerStrategy: {
    type: '日内 pivot（扩展）',
    timeframe: '视实现而定',
    summary: 'R-Breaker 日内 pivot 反转/突破策略；若未安装自定义版本，类名可能不可用。',
    logic: ['根据前日 H/L/C 计算 pivot 及 six 条价格线，在突破/反转区挂单。'],
    params: [],
    risks: ['需确认策略文件是否已放入 vnpy_ctastrategy 目录。'],
    suitable: ['日内短线'],
  },
};

/** 获取策略文档；未知类返回自动生成简要说明 */
function $strategyDoc(className) {
  if (!className) return null;
  if (STRATEGY_DOCS[className]) return STRATEGY_DOCS[className];
  return {
    type: '自定义',
    timeframe: '—',
    summary: `${$strategyLabel(className)}：项目内置或自定义策略类，暂无详细文档。可在部署后查看 get_cta_params 返回的参数默认值。`,
    logic: ['请查阅策略源码中的 on_bar / on_tick 逻辑。'],
    params: [],
    risks: ['自定义策略请先充分回测再上线。'],
    suitable: [],
  };
}

/** 全部文档列表（用于百科抽屉） */
function $strategyDocList() {
  return Object.keys(STRATEGY_DOCS).map(name => ({
    class_name: name,
    label: $strategyLabel(name),
    type: STRATEGY_DOCS[name].type,
    summary: STRATEGY_DOCS[name].summary,
  }));
}

/** 参数字段说明（表单 hint） */
function $strategyParamHint(className, paramName) {
  const doc = STRATEGY_DOCS[className];
  if (!doc?.params) return '';
  const p = doc.params.find(x => x.name === paramName);
  return p ? p.logic : '';
}

/** 当前实例参数行（带说明） */
function $strategyParamRows(className, parameters) {
  const doc = STRATEGY_DOCS[className];
  const params = parameters || {};
  const names = doc?.params?.length
    ? doc.params.map(p => p.name)
    : Object.keys(params);
  return names.map(name => {
    const meta = doc?.params?.find(p => p.name === name);
    return {
      name,
      label: meta?.label || name,
      value: params[name] != null ? params[name] : (meta?.default ?? '—'),
      logic: meta?.logic || '',
    };
  });
}

/** 回测推荐 K 线周期 — CTA 策略在引擎内合成更高周期，回测应使用 1m 源数据 */
function $strategyBacktestInterval(className) {
  const doc = STRATEGY_DOCS[className];
  const tf = doc?.timeframe || '';
  if (/tick/i.test(tf)) return '1m';
  if (/日线|daily|\bd\b/i.test(tf)) return 'd';
  return '1m';
}
