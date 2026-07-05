// ===== 合约中文名缓存与展示 =====

const contractNameCache = Vue.reactive({});

/** 品种 → 中文名（tick/API 不可用时的兜底） */
const PRODUCT_CN = {
  IF: '沪深300', IH: '上证50', IC: '中证500', IM: '中证1000',
  IO: '沪深300期权', HO: '上证50期权', MO: '中证1000期权',
  T: '10年国债', TF: '5年国债', TS: '2年国债', TL: '30年国债',
  RB: '螺纹钢', HC: '热轧卷板', I: '铁矿石', J: '焦炭', JM: '焦煤',
  AU: '黄金', AG: '白银', CU: '铜', AL: '铝', ZN: '锌', PB: '铅', NI: '镍', SN: '锡',
  SC: '原油', FU: '燃油', LU: '低硫燃油', BU: '沥青',
  M: '豆粕', Y: '豆油', P: '棕榈油', C: '玉米', A: '豆一', B: '豆二',
  SR: '白糖', CF: '棉花', TA: 'PTA', MA: '甲醇', FG: '玻璃', SA: '纯碱',
};

const _fetchNamePending = new Set();

/** name 是否仅为合约代码（非中文名） */
function $isSymbolLikeName(name, vt) {
  if (!name) return true;
  const code = (vt || '').split('.')[0].toUpperCase();
  const n = String(name).trim().toUpperCase();
  if (n === code) return true;
  // 纯字母数字且包含合约代码 → 视为代码名
  if (/^[A-Z0-9._\-]+$/.test(n) && n.includes(code.replace(/[^A-Z0-9]/g, ''))) return true;
  return false;
}

/** 写入中文名缓存（不被 tick 代码名覆盖） */
function $setContractNameIfBetter(vt, name) {
  const key = $normalizeVt(vt);
  if (!key || !name || $isSymbolLikeName(name, vt)) return;
  const cur = contractNameCache[key];
  if (cur && !$isSymbolLikeName(cur, vt)) return;
  contractNameCache[key] = name;
}

function $productCnName(vt) {
  return PRODUCT_CN[$productFromVt(vt)] || '';
}

/** 股指期权标的简称（用于展示名第一行） */
const OPTION_UNDERLYING_CN = {
  IO: '沪深300',
  HO: '上证50',
  MO: '中证1000',
};

/** 解析 CFFEX 股指期权代码，如 IO2607-C-4950 */
function $parseIndexOption(vt) {
  const symbol = ($parseVtSymbol(vt).symbol || '').toUpperCase();
  const m = symbol.match(/^(IO|HO|MO)(\d{4})-([CP])-(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const yy = parseInt(m[2].slice(0, 2), 10);
  const mm = parseInt(m[2].slice(2), 10);
  const year = yy < 50 ? 2000 + yy : 1900 + yy;
  return {
    product: m[1],
    yymm: m[2],
    year,
    month: mm,
    cp: m[3] === 'C' ? '看涨' : '看跌',
    strike: m[4],
  };
}

function $isIndexOption(vt) {
  return !!$parseIndexOption(vt);
}

/** 期权展示第一行：上证50看涨期权2607 */
function $formatOptionTitle(vt) {
  const opt = $parseIndexOption(vt);
  if (!opt) return '';
  const base = OPTION_UNDERLYING_CN[opt.product] || opt.product;
  return `${base}${opt.cp}期权${opt.yymm}`;
}

/** 期权展示第二行：行权价 */
function $formatOptionStrike(vt) {
  return $parseIndexOption(vt)?.strike || '';
}

/** 确保异步拉取中文名（tick 到达时触发，去重） */
function $ensureContractName(vt) {
  const key = $normalizeVt(vt);
  if (!key) return;
  if (contractNameCache[key] && !$isSymbolLikeName(contractNameCache[key], vt)) return;
  if (_fetchNamePending.has(key)) return;
  _fetchNamePending.add(key);
  $fetchContractName(vt).finally(() => _fetchNamePending.delete(key));
}

/** 异步拉取并缓存合约中文名 */
async function $fetchContractName(vt) {
  if (!vt) return '';
  const key = $normalizeVt(vt);
  const cached = contractNameCache[key];
  if (cached && !$isSymbolLikeName(cached, vt)) return cached;

  const tick = $lookupTick(vt);
  if (tick?.name && !$isSymbolLikeName(tick.name, vt)) {
    contractNameCache[key] = tick.name;
    return tick.name;
  }

  const c = store.contract[key] || store.contract[vt];
  if (c?.name && !$isSymbolLikeName(c.name, vt)) {
    contractNameCache[key] = c.name;
    return c.name;
  }

  const { symbol, exchange } = $parseVtSymbol(vt);
  const product = $productFromVt(vt);
  if (!exchange || !product) return symbol;

  try {
    const list = await $fetchPublicContracts({ exchange, product });
    const hit = list.find(x => $normalizeVt(x.vt_symbol || `${x.symbol}.${exchange}`) === key)
      || list.find(x => (x.symbol || '').toUpperCase() === symbol.toUpperCase());
    if (hit?.name && !$isSymbolLikeName(hit.name, vt)) {
      contractNameCache[key] = hit.name;
      return hit.name;
    }
  } catch (e) { /* ignore */ }

  const fallback = $formatOptionTitle(vt) || $productCnName(vt) || symbol;
  contractNameCache[key] = fallback;
  return fallback;
}

/** 同步展示：期权第一行标题，期货中文名 */
function $contractLabel(vt) {
  if (!vt) return '—';
  const title = $formatOptionTitle(vt);
  if (title) return title;

  const key = $normalizeVt(vt);
  const code = vt.split('.')[0];
  const tick = $lookupTick(vt);

  let name = contractNameCache[key];
  if (!name || $isSymbolLikeName(name, vt)) {
    if (tick?.name && !$isSymbolLikeName(tick.name, vt)) name = tick.name;
    else if (store.contract[key]?.name && !$isSymbolLikeName(store.contract[key].name, vt)) name = store.contract[key].name;
    else name = $productCnName(vt) || name || code;
  }

  if (name && name !== code && !name.toUpperCase().startsWith(code.toUpperCase())) return name;
  if (name && name !== code) return name;
  return code;
}

function $contractSubLabel(vt) {
  if (!vt) return '';
  const strike = $formatOptionStrike(vt);
  if (strike) return strike;
  return $parseVtSymbol(vt).symbol || vt.split('.')[0];
}

/** 期权第三行：合约代码（不含交易所） */
function $contractCodeLine(vt) {
  return $parseVtSymbol(vt).symbol || (vt || '').split('.')[0];
}

/** 批量预加载自选合约名称 */
async function $preloadWatchlistNames() {
  const tasks = (ui.watchlist || []).map(w => $fetchContractName(w.vt_symbol));
  await Promise.allSettled(tasks);
}

/** 预加载数据树叶子合约中文名 */
function $preloadDataTreeNames(tree) {
  for (const leaf of $flattenDataLeaves(tree || [])) {
    if (leaf.vt_symbol) $ensureContractName(leaf.vt_symbol);
  }
}
