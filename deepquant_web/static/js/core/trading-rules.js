// ===== 下单规则：开平默认值、价格快捷键 =====

/** 各交易所默认平仓方式 */
function $defaultCloseOffset(exchange) {
  const ex = (exchange || '').toUpperCase();
  if (['SHFE', 'INE'].includes(ex)) return 'CLOSETODAY';
  if (ex === 'CZCE') return 'CLOSETODAY';
  return 'CLOSE';
}

/** 合约最小变动价位 */
function $priceTickStep(vt) {
  if (typeof store !== 'undefined') {
    const c = store.contract[$normalizeVt(vt)];
    const tick = c?.pricetick ?? c?.price_tick;
    if (tick && Number(tick) > 0) return Number(tick);
  }
  if (typeof $isIndexOption === 'function' && $isIndexOption(vt)) return 0.2;
  return 1;
}

/** 三键模式：对手/排队/最新/指定价 */
function $resolveOrderPrice(tick, direction, mode, manual) {
  if (mode === 'market') return 0;
  if (mode === 'limit') return parseFloat(manual) || 0;
  const p = $orderPriceKeys(tick);
  if (mode === 'last') return p.last || 0;
  if (mode === 'queue') return $queuePrice(tick, direction) || 0;
  return $opponentPrice(tick, direction) || 0;
}

/** 三键标签：买侧 / 卖侧 / 有无持仓 */
function $threeKeyLabels(longVol, shortVol) {
  const hasL = longVol > 0;
  const hasS = shortVol > 0;
  let buy = '买开';
  let sell = '卖开';
  if (hasL && !hasS) {
    buy = '加多';
    sell = '锁仓';
  } else if (!hasL && hasS) {
    buy = '锁仓';
    sell = '加空';
  } else if (hasL && hasS) {
    buy = '加多';
    sell = '加空';
  }
  return { buy, sell };
}

/** 根据交易所与操作意图推荐开平 */
function $suggestOffset(exchange, intent) {
  if (intent === 'OPEN') return 'OPEN';
  return $defaultCloseOffset(exchange);
}

/** 从 tick 取下单价格 */
function $orderPriceKeys(tick) {
  if (!tick) return { last: 0, bid1: 0, ask1: 0 };
  return {
    last: tick.last_price || 0,
    bid1: tick.bid_price_1 || 0,
    ask1: tick.ask_price_1 || 0,
  };
}

/** 对手价：买用卖一，卖用买一 */
function $opponentPrice(tick, direction) {
  const p = $orderPriceKeys(tick);
  return direction === 'LONG' ? p.ask1 : p.bid1;
}

/** 排队价：买用买一，卖用卖一 */
function $queuePrice(tick, direction) {
  const p = $orderPriceKeys(tick);
  return direction === 'LONG' ? p.bid1 : p.ask1;
}

function $loadTradingPrefs() {
  const cfg = $loadJson(PERSIST_KEYS.config, {});
  return {
    defaultVolume: cfg.defaultVolume || 1,
    orderConfirm: cfg.orderConfirm !== false,
    priceFlash: cfg.priceFlash !== false,
  };
}

function $saveTradingPrefs(partial) {
  const cfg = $loadJson(PERSIST_KEYS.config, {});
  Object.assign(cfg, partial);
  $saveJson(PERSIST_KEYS.config, cfg);
}
