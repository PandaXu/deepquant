// ===== 回测研究面板 — 运行态 + 结果展示（量化平台常见模式）=====

const BT_RUN_STEPS = [
  { id: 'prepare', label: '准备参数' },
  { id: 'load', label: '加载数据' },
  { id: 'run', label: '策略回测' },
  { id: 'report', label: '生成报告' },
];

function $btStepIndex(stepId) {
  return BT_RUN_STEPS.findIndex(s => s.id === stepId);
}

/** 根据引擎日志推断当前阶段 */
function $btInferStepFromLog(msg) {
  const s = String(msg || '');
  if (/统计指标计算完成|Backtesting finished|回测完成/i.test(s)) return 'report';
  if (/run_backtesting|开始回测|策略回测|回测结束/i.test(s)) return 'run';
  if (/历史数据|load_data|加载|数据为空|download/i.test(s)) return 'load';
  return null;
}

function $btNormalizeResult(result) {
  if (!result) return null;
  const r = result;
  const trades = r.trades || [];
  return {
    totalReturn: r.total_return,
    annualReturn: r.annual_return,
    sharpe: r.sharpe_ratio,
    ewmSharpe: r.ewm_sharpe,
    maxDdPct: r.max_ddpercent != null ? r.max_ddpercent : r.max_drawdown,
    maxDdAbs: r.max_drawdown,
    returnDdRatio: r.return_drawdown_ratio,
    totalTrades: r.total_trades ?? r.total_trade_count ?? trades.length,
    profitDays: r.profit_days,
    lossDays: r.loss_days,
    totalDays: r.total_days,
    endBalance: r.end_balance,
    capital: r.capital,
    totalNetPnl: r.total_net_pnl,
    totalCommission: r.total_commission,
    startDate: r.start_date,
    endDate: r.end_date,
    balance: r.balance || r.daily_balance,
    dailyDates: r.daily_dates,
    trades,
  };
}

/** vnpy 统计：total_return / max_ddpercent 已是百分数 */
function $btFmtReturnPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
}

function $btFmtDdPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Math.abs(Number(v)).toFixed(2) + '%';
}

function $btFmtNum(v, digits = 2) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return Number(v).toFixed(digits);
}

function $btFmtMoney(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e4).toFixed(2) + '万';
  return n.toFixed(0);
}

function $btKpiCards(metrics, prev) {
  if (!metrics) return [];
  const p = prev ? $btNormalizeResult(prev) : null;
  const delta = (cur, old, fmt) => {
    if (old == null || cur == null || !Number.isFinite(Number(cur)) || !Number.isFinite(Number(old))) return '';
    const d = Number(cur) - Number(old);
    if (Math.abs(d) < 0.005) return '';
    return fmt(d);
  };
  return [
    { key: 'ret', term: 'total_return', label: '总收益率', value: $btFmtReturnPct(metrics.totalReturn),
      cls: (metrics.totalReturn || 0) >= 0 ? 'up' : 'down',
      delta: p ? delta(metrics.totalReturn, p.totalReturn, v => (v >= 0 ? '+' : '') + v.toFixed(2) + 'pt') : '' },
    { key: 'sharpe', term: 'sharpe_ratio', label: '夏普比率', value: $btFmtNum(metrics.sharpe),
      delta: p ? delta(metrics.sharpe, p.sharpe, v => (v >= 0 ? '+' : '') + v.toFixed(2)) : '' },
    { key: 'dd', term: 'max_ddpercent', label: '最大回撤', value: $btFmtDdPct(metrics.maxDdPct), cls: 'down' },
    { key: 'trades', term: 'total_trades', label: '成交笔数', value: String(metrics.totalTrades ?? '—'),
      delta: p && metrics.totalTrades != null && p.totalTrades != null
        ? delta(metrics.totalTrades, p.totalTrades, v => (v >= 0 ? '+' : '') + Math.round(v)) : '' },
    { key: 'annual', term: 'annual_return', label: '年化收益', value: $btFmtReturnPct(metrics.annualReturn),
      cls: (metrics.annualReturn || 0) >= 0 ? 'up' : 'down' },
    { key: 'ratio', term: 'return_drawdown_ratio', label: '收益回撤比', value: $btFmtNum(metrics.returnDdRatio) },
  ];
}

function $btBuildEquityOption(result) {
  const m = $btNormalizeResult(result);
  if (!m?.balance?.length) return null;
  const balance = m.balance.map(b => (typeof b === 'number' ? b : b.balance));
  const dates = (m.dailyDates?.length === balance.length)
    ? m.dailyDates.map(d => String(d).slice(0, 10))
    : balance.map((_, i) => i + 1);
  const peak = [];
  let p = balance[0];
  const ddPct = balance.map(v => {
    p = Math.max(p, v);
    return p > 0 ? ((v - p) / p) * 100 : 0;
  });
  return {
    backgroundColor: 'transparent',
    animationDuration: 800,
    tooltip: { trigger: 'axis' },
    legend: { data: ['权益', '回撤%'], textStyle: { color: '#94a3b8', fontSize: 10 }, top: 0 },
    grid: [
      { left: '10%', right: '4%', top: '14%', height: '48%' },
      { left: '10%', right: '4%', top: '70%', height: '18%' },
    ],
    xAxis: [
      { type: 'category', data: dates, gridIndex: 0, axisLabel: { show: false } },
      { type: 'category', data: dates, gridIndex: 1, axisLabel: { rotate: 30, fontSize: 9 } },
    ],
    yAxis: [
      { type: 'value', scale: true, gridIndex: 0, splitLine: { lineStyle: { color: 'rgba(255,255,255,0.06)' } } },
      { type: 'value', gridIndex: 1, max: 0, splitLine: { show: false } },
    ],
    series: [
      {
        name: '权益', type: 'line', xAxisIndex: 0, yAxisIndex: 0, data: balance, showSymbol: false,
        lineStyle: { width: 2, color: '#3b82f6' },
        areaStyle: { color: 'rgba(59,130,246,0.15)' },
      },
      {
        name: '回撤%', type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: ddPct, showSymbol: false,
        lineStyle: { width: 1, color: '#f59e0b' },
        areaStyle: { color: 'rgba(245,158,11,0.12)' },
      },
    ],
  };
}

function $btFormatTradeRow(t) {
  const dir = String(t.direction ?? '').toUpperCase();
  const isLong = dir.includes('LONG') || dir.includes('多') || dir === 'BUY';
  const dt = t.datetime ? String(t.datetime).replace('T', ' ').slice(0, 19) : '—';
  return {
    time: dt,
    direction: isLong ? '多' : '空',
    dirCls: isLong ? 'up' : 'down',
    offset: t.offset || '—',
    price: t.price != null ? Number(t.price).toFixed(2) : '—',
    volume: t.volume ?? '—',
  };
}

function $btElapsedText(startMs) {
  if (!startMs) return '0s';
  const sec = Math.floor((Date.now() - startMs) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
