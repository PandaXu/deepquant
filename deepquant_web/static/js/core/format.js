// ===== 行情格式化工具 =====

function $chgCls(t) {
  if (!t) return '';
  const prev = t.pre_close || t.open_price || t.last_price || 0;
  return t.last_price > prev ? 'up' : (t.last_price < prev ? 'down' : '');
}

function $chgText(t) {
  if (!t) return '-';
  const prev = t.pre_close || t.open_price || t.last_price || 0;
  if (!prev) return '-';
  return ((t.last_price - prev) / prev * 100).toFixed(2) + '%';
}

function $chgAbs(t) {
  if (!t) return '';
  const prev = t.pre_close || t.open_price || 0;
  if (!prev || t.last_price == null) return '';
  const d = t.last_price - prev;
  return (d >= 0 ? '+' : '') + d.toFixed(2);
}

function $parseVtSymbol(vt) {
  if (!vt) return { symbol: '', exchange: '' };
  const parts = vt.split('.');
  return { symbol: parts[0] || '', exchange: parts[1] || '' };
}

/** 统一 vt_symbol 键（用于 store 查找） */
function $normalizeVt(vt) {
  if (!vt) return '';
  const { symbol, exchange } = $parseVtSymbol(vt);
  return `${(symbol || '').toUpperCase()}.${(exchange || '').toUpperCase()}`;
}

/** CTP 订阅用的合约代码（商品小写、股指大写） */
function $resolveSubscribeSymbol(vt) {
  const { symbol, exchange } = $parseVtSymbol(vt);
  const ex = (exchange || '').toUpperCase();
  if (!symbol) return '';
  if (ex === 'CFFEX') return symbol.toUpperCase();
  const m = symbol.match(/^([A-Za-z]+)(.*)$/);
  if (!m) return symbol;
  return m[1].toLowerCase() + m[2];
}

/** tick 是否属于指定 vt */
function $tickMatchesVt(tick, vt) {
  if (!tick || !vt) return false;
  return $normalizeVt(tick.vt_symbol) === $normalizeVt(vt);
}

/** 按 vt 查找 tick（严格匹配，不 fallback） */
function $lookupTick(vt) {
  if (!vt) return null;
  const key = $normalizeVt(vt);
  const t = store.tick[key];
  return t && $tickMatchesVt(t, key) ? t : null;
}

/** 写入 tick 到 store（统一键 + 触发响应） */
function $storeTick(data) {
  if (!data || typeof store === 'undefined') return null;
  const t = { ...data };
  if (typeof t.exchange === 'object' && t.exchange?.value) t.exchange = t.exchange.value;
  if (!t.vt_symbol && t.symbol && t.exchange) {
    t.vt_symbol = `${t.symbol}.${t.exchange}`;
  }
  const vt = $normalizeVt(t.vt_symbol || `${t.symbol || ''}.${t.exchange || ''}`);
  if (!vt || vt === '.') return null;
  // 以 symbol+exchange 为准，防止 vt_symbol 字段错误导致串台
  if (t.symbol && t.exchange) {
    const built = $normalizeVt(`${t.symbol}.${t.exchange}`);
    if (built && built !== '.') t.vt_symbol = built;
    else t.vt_symbol = vt;
  } else {
    t.vt_symbol = vt;
  }
  if (t.name && typeof $setContractNameIfBetter === 'function') {
    $setContractNameIfBetter(t.vt_symbol, t.name);
  }
  if (typeof $ensureContractName === 'function') $ensureContractName(t.vt_symbol);
  const prev = store.tick[t.vt_symbol]?.last_price;
  store.tick[t.vt_symbol] = t;
  if (t.last_price != null) {
    const dir = prev != null && t.last_price < prev ? 'down' : 'up';
    const p = store.tickPulse;
    store.tickPulse = { vt: t.vt_symbol, dir, n: (p?.n || 0) + 1 };
  }
  return t;
}

function $productFromVt(vt) {
  const m = (vt || '').split('.')[0].match(/^([A-Za-z]+)/i);
  return m ? m[1].toUpperCase() : '';
}

function $orderStatusText(s) {
  const map = {
    SUBMITTING: '提交中', NOTTRADED: '未成交', PARTTRADED: '部分成交',
    ALLTRADED: '全部成交', CANCELLED: '已撤销', REJECTED: '已拒绝',
  };
  return map[s] || s;
}

function $isActiveOrder(o) {
  return ['SUBMITTING', 'NOTTRADED', 'PARTTRADED'].includes(o.status);
}

function $pnlCls(p) {
  const v = p.position_profit || p.pnl || 0;
  return v > 0 ? 'up' : (v < 0 ? 'down' : '');
}
