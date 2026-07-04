// ===== 合约搜索（代码 / 中文 / 拼音简写） =====

const PRODUCT_PINYIN = {
  IF: 'gz', IH: 'sz', IC: 'zz', IM: 'zz1000',
  RB: 'lw', HC: 'rz', I: 'tk', J: 'jm', JM: 'jm', SS: 'bxg',
  AU: 'hj', AG: 'by', CU: 'pt', AL: 'lv', ZN: 'x', PB: 'qian', NI: 'nie', SN: 'xi',
  M: 'dp', Y: 'dy', P: 'zly', C: 'ym', A: 'dd', B: 'dd2',
  SR: 'bt', CF: 'mh', TA: 'pta', MA: 'jm', FG: 'bl', SA: 'cj',
  SC: 'yy', LU: 'dy2', FU: 'ry',
};

function $contractSearchText(vt) {
  const code = (vt || '').split('.')[0].toUpperCase();
  const prod = $productFromVt(vt);
  const name = contractNameCache[$normalizeVt(vt)] || $productCnName(vt) || '';
  const py = PRODUCT_PINYIN[prod] || '';
  return [vt, code, prod, name, py].join(' ').toLowerCase();
}

function $matchContractQuery(q, vt) {
  if (!q) return true;
  return $contractSearchText(vt).includes(q.trim().toLowerCase());
}

/** 自选分组 */
const WATCHLIST_GROUPS = {
  CFFEX: '股指', SHFE: '上期所', DCE: '大商所', CZCE: '郑商所', INE: '能源', GFEX: '广期所',
};

function $watchlistGroup(vt) {
  const ex = (vt || '').split('.')[1] || '';
  return WATCHLIST_GROUPS[ex] || ex || '其他';
}

function $groupWatchlist(items) {
  const map = {};
  items.forEach(item => {
    const g = $watchlistGroup(item.vt_symbol);
    if (!map[g]) map[g] = [];
    map[g].push(item);
  });
  const order = ['股指', '上期所', '大商所', '郑商所', '能源', '广期所', '其他'];
  return order.filter(g => map[g]).map(g => ({ name: g, items: map[g] }));
}
