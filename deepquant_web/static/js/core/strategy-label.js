// ===== 策略类中文名映射 =====

const STRATEGY_CN = {
  DoubleMaStrategy: '双均线策略',
  AtrRsiStrategy: 'ATR-RSI 策略',
  BollChannelStrategy: '布林通道策略',
  KingKeltnerStrategy: '肯特纳通道策略',
  MultiSignalStrategy: '多信号组合策略',
  MultiTimeframeStrategy: '多周期策略',
  TurtleSignalStrategy: '海龟信号策略',
  DualThrustStrategy: 'Dual Thrust 策略',
  RbreakerStrategy: 'R-Breaker 策略',
  TestStrategy: '测试策略',
  CtaTemplate: 'CTA 策略模板',
};

/** 策略类英文名 → 中文展示 */
function $strategyLabel(className) {
  if (!className) return '—';
  if (STRATEGY_CN[className]) return STRATEGY_CN[className];
  return className
    .replace(/Strategy$/, '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim() + ' 策略';
}

function $strategyStatusCn(status) {
  const map = {
    running: '运行中', trading: '运行中', inited: '已初始化', stopped: '已停止',
    starting: '启动中', stopping: '停止中',
  };
  return map[String(status || '').toLowerCase()] || status || '已停止';
}

function $normStrategyStatus(s) {
  const st = String(s || 'stopped').toLowerCase();
  return st === 'trading' ? 'running' : st;
}
