// ===== 策略 / 回测专业名词解释 =====

const $termGlossary = {
  // —— 策略中心 KPI ——
  strategy_instance: {
    title: '策略实例',
    text: '一条可独立运行的 CTA 策略配置：包含策略类、合约、参数、绑定账户等。同一策略类可部署多个实例。',
  },
  live_trading: {
    title: '实盘中',
    text: '策略引擎已启动，正在根据实时行情自动发单、持仓。需网关在线且已完成初始化。',
  },
  pending_start: {
    title: '待启动',
    text: '策略已完成「初始化」，历史 K 线已加载到引擎，但尚未调用 start 进入自动交易。',
  },
  pos_exposure: {
    title: '总敞口（手）',
    text: '所有「运行中」实例当前净持仓手数之和（多空轧差后的绝对值合计），用于粗略衡量组合风险暴露。',
  },
  gateway_alert: {
    title: '网关告警',
    text: '已初始化或运行中的策略，其绑定网关（CTP/TTS 等）当前未连接，无法正常下单。',
  },

  // —— 生命周期 ——
  configured: {
    title: '已配置',
    text: '策略实例已创建并保存参数，但尚未确认历史数据或回测结果。',
  },
  data_ready: {
    title: '数据就绪',
    text: '本地数据库中已有足够的历史 K 线，满足初始化与回测的最低数据要求。',
  },
  researched: {
    title: '已回测',
    text: '在当前参数与合约下完成过一次有效回测，且快照与现配置一致（未过期）。',
  },
  ready: {
    title: '已预热',
    text: '已执行 init：引擎加载历史 K 线并创建策略对象，可随时 start 实盘。',
  },
  live: {
    title: '实盘中',
    text: '策略 trading 状态为真，正在监听 Tick/K 线并执行交易逻辑。',
  },

  // —— 上线检查 ——
  instance_config: {
    title: '实例配置',
    text: '策略类、交易合约等基础信息是否完整。缺合约则无法初始化。',
  },
  bound_account: {
    title: '绑定账户',
    text: '该实例下单时路由到的网关账户。未绑定时使用系统默认账户。',
  },
  history_data: {
    title: '历史数据',
    text: '本地数据库中是否有所需合约、周期的 K 线。CTA 初始化与回测都依赖历史数据。',
  },
  backtest_validation: {
    title: '回测验证',
    text: '是否在当前参数指纹下跑通过回测并保存快照。总收益为负视为未通过，无法初始化或实盘，需调整参数后重跑。',
  },
  engine_warmup: {
    title: '引擎预热',
    text: '对应 CTA 的初始化：向引擎加载历史 Bar、实例化策略。初始化后才会产生持仓变量。',
  },
  trading_gateway: {
    title: '交易网关',
    text: '连接期货柜台的通道（如 CTP SimNow）。实盘 start 前网关必须在线。',
  },

  // —— 回测指标 ——
  total_return: {
    title: '总收益率',
    text: '回测区间内账户权益相对初始资金的涨跌百分比。统计值已是百分数（如 5.2 表示 +5.2%）。',
  },
  sharpe_ratio: {
    title: '夏普比率',
    text: '风险调整后收益：日均超额收益 ÷ 收益波动 × √年化天数。一般 >1 尚可，>2 较好（视市场而定）。',
  },
  max_drawdown: {
    title: '最大回撤',
    text: '权益曲线从前期高点到后续低点的最大跌幅（%）。衡量最坏情况下可能承受的净值回撤。',
  },
  max_ddpercent: {
    title: '最大回撤',
    text: '权益峰值到谷底的最大跌幅百分比，是评估策略风险的核心指标之一。',
  },
  annual_return: {
    title: '年化收益',
    text: '将总收益率按回测交易日数折算到一年的近似收益率，便于不同区间回测对比。',
  },
  return_drawdown_ratio: {
    title: '收益回撤比',
    text: '总收益与最大回撤幅度的比值（Calmar 类指标）。越高表示单位回撤换来的收益越多。',
  },
  total_trades: {
    title: '成交笔数',
    text: '回测区间内撮合成交的次数（开平仓各算一笔）。过高可能意味着手续费侵蚀利润。',
  },
  end_balance: {
    title: '期末权益',
    text: '回测最后一个交易日的账户权益（含浮动盈亏、扣费后）。',
  },
  profit_days: {
    title: '盈亏日',
    text: '回测区间内日盈亏为正的交易日数量。与亏损日一起反映策略胜率分布。',
  },

  // —— 回测参数 ——
  backtest_capital: {
    title: '初始资金',
    text: '回测开始时账户的现金基数，用于计算仓位、手续费与权益曲线。',
  },
  commission_rate: {
    title: '费率',
    text: '单边手续费率（相对成交金额）。如 0.0001 表示万分之一。影响净收益与高频策略可行性。',
  },
  slippage: {
    title: '滑点',
    text: '假设每笔成交相对盘口多付出的价格跳数（按最小变动价位计）。模拟实盘冲击成本。',
  },
  contract_size: {
    title: '乘数',
    text: '每手合约对应的标的数量（如 IF 300 点/手）。决定每跳盈亏与保证金规模。',
  },
  pricetick: {
    title: '最小变动',
    text: '合约价格最小跳动单位。与滑点设置配合，影响回测成交价格。',
  },
  bar_interval: {
    title: 'K 线周期',
    text: '回测使用的历史 Bar 粒度。CTA 可在引擎内合成更高周期；推荐用 1 分钟源数据。',
  },
  backtest_research: {
    title: '回测研究',
    text: '在历史数据上模拟策略成交，评估收益、回撤、夏普等，不占用真实资金。',
  },

  // —— 交易用语 ——
  direction: {
    title: '方向',
    text: '多（买入方向）或空（卖出方向），对应开仓/加仓时的多空属性。',
  },
  offset: {
    title: '开平',
    text: '开仓（OPEN）建立新仓；平仓（CLOSE）了结已有持仓。国内期货需区分平今/平昨。',
  },
  position: {
    title: '持仓',
    text: '策略当前净持仓手数。正为多、负为空，零表示空仓。',
  },

  // —— 区块标题 ——
  preflight: {
    title: '上线检查清单',
    text: '从配置、数据、回测、预热到网关的一键体检，提示下一步该做什么再启动实盘。',
  },
  last_backtest: {
    title: '最近回测',
    text: '绑定到本实例、且参数指纹一致的上次回测摘要。参数变更后标记为过期需重跑。',
  },
  runtime_variables: {
    title: '运行指标',
    text: '策略运行中的动态变量（如持仓、均线值），init/start 后由引擎推送更新。',
  },

  strategy_class: {
    title: '策略类',
    text: 'CTA 策略的 Python 类名（如双均线、布林通道）。决定交易逻辑与可配置参数项。',
  },
  instance_name: {
    title: '实例名称',
    text: '本部署的唯一标识，用于区分同一策略类的多个运行副本。',
  },
  contract: {
    title: '合约',
    text: '策略监听与下单的目标，格式为「代码.交易所」（如 rb2609.SHFE）。',
  },
  trading_account: {
    title: '交易账户',
    text: '实例发单时使用的网关账户别名。选「默认」则走系统当前连接账户。',
  },
  run_backtest: {
    title: '运行回测',
    text: '按当前表单参数在历史 K 线上模拟成交并计算统计指标；绑定实例时会保存快照供上线检查。',
  },
  backtest_report: {
    title: '回测报告',
    text: '回测完成后的结果页：核心 KPI、权益/回撤曲线、成交明细，用于评估策略是否可上线。',
  },
  backtest_start: {
    title: '回测起始日',
    text: '历史模拟的开始日期（含）。需本地数据库在该区间有对应周期 K 线。',
  },
  backtest_end: {
    title: '回测结束日',
    text: '历史模拟的结束日期（含）。区间越长越能观察不同行情，但计算更慢。',
  },
  strategy_params: {
    title: '策略参数',
    text: '策略类定义的 tunable 变量（如均线周期）。绑定实例时与实盘配置保持一致。',
  },
  loss_days: {
    title: '亏损日',
    text: '回测区间内日盈亏为负的交易日数。与盈亏日一起反映收益稳定性。',
  },
  trade_details: {
    title: '成交明细',
    text: '回测中每笔模拟成交的时间、方向、开平、价格与数量，便于核对信号与滑点影响。',
  },
  equity_curve: {
    title: '权益曲线',
    text: '按日汇总的账户权益走势。上方曲线为净值，下方为相对峰值的回撤百分比。',
  },
  bt_max_saves: {
    title: '回测保留条数',
    text: '每个策略实例在服务端最多保留的历史回测记录数（验证基准不计入此限）。超出后自动清理最旧记录。',
  },
  bt_retention_days: {
    title: '回测清理天数',
    text: '超过此天数的非验证基准回测记录将被自动删除。设为 0 表示不按时间清理。',
  },
  bt_auto_archive_loss: {
    title: '亏损回测存档',
    text: '开启后，亏损的回测结果也会写入历史记录（不可设为验证基准）；关闭则仅保存盈利回测。',
  },
};

/** 上线检查项 id → 名词 key */
const $preflightTermKey = {
  config: 'instance_config',
  account: 'bound_account',
  history_data: 'history_data',
  backtest: 'backtest_validation',
  initialized: 'engine_warmup',
  gateway: 'trading_gateway',
};

function $termExplain(key) {
  return $termGlossary[key] || null;
}

/** 仅这些偏专业的名词显示说明图标 */
const $termHelpKeys = new Set([
  'pos_exposure',
  'gateway_alert',
  'sharpe_ratio',
  'max_drawdown',
  'max_ddpercent',
  'annual_return',
  'return_drawdown_ratio',
  'end_balance',
  'profit_days',
  'loss_days',
  'equity_curve',
  'commission_rate',
  'slippage',
  'contract_size',
  'pricetick',
  'bar_interval',
  'offset',
  'data_ready',
  'researched',
  'ready',
  'backtest_validation',
  'engine_warmup',
  'trading_gateway',
  'history_data',
  'run_backtest',
  'bt_max_saves',
  'bt_retention_days',
  'bt_auto_archive_loss',
]);

function $termNeedsHelp(key) {
  return !!key && $termHelpKeys.has(key);
}
