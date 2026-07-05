// ===== 数据管理：树导航与工具（方案 C：交易所 → 品种 → 合约 → 周期） =====

const DATA_INTERVAL_ORDER = ['1m', '1h', 'd', 'w', 'tick'];
/** 树中未下载时仍展示的 K 线周期（便于选择下载） */
const DATA_DOWNLOAD_PLACEHOLDER_INTERVALS = ['1m', 'd'];
const DATA_INTERVAL_LABELS = {
  '1m': '分钟线',
  '1h': '小时线',
  d: '日线',
  w: '周线',
  tick: 'Tick 录制',
};

const CFFEX_INDEX_OPTION_PRODUCTS = new Set(['IO', 'HO', 'MO']);

function $isCffexIndexOptionSymbol(symbol) {
  const p = (symbol || '').match(/^([A-Za-z]+)/);
  return CFFEX_INDEX_OPTION_PRODUCTS.has(p?.[1]?.toUpperCase() || '');
}

function $productGroupLabel(product) {
  const p = (product || 'OTHER').toUpperCase();
  const cn = typeof $productCnName === 'function' ? $productCnName(`${p}9999.SHFE`) : '';
  if (cn && cn !== p && !cn.toUpperCase().startsWith(p)) return `${p} · ${cn}`;
  return p;
}

function $leafFromDataRow(row, kind) {
  const effectiveEnd = row.effective_end || row.end || '';
  const catalogOnly = !!row.catalogOnly;
  const count = row.count || 0;
  const expired = typeof isExpired === 'function' ? isExpired(row.symbol) : false;
  let freshness = $computeDataFreshness(effectiveEnd);
  if (catalogOnly) {
    freshness = expired
      ? { label: '已过期 · 未下载', level: 'none' }
      : { label: '未下载', level: 'none' };
  } else if (expired && count > 0) freshness = { label: '已过期', level: 'expired' };

  return {
    kind,
    symbol: row.symbol,
    exchange: row.exchange,
    interval: row.interval || (kind === 'tick' ? 'tick' : ''),
    vt_symbol: row.vt_symbol || `${row.symbol}.${row.exchange}`,
    label: row.symbol,
    count,
    start: row.start || '',
    end: row.end || '',
    effective_end: row.effective_end || effectiveEnd,
    stored_end: row.stored_end || row.end || '',
    sources: row.sources || [],
    sourceLabel: catalogOnly ? '' : $dataSourceLabel(row.sources),
    freshness,
    catalogOnly,
    expired,
    listed: row.listed !== false,
  };
}

function $dataNodeKey(node) {
  if (!node) return '';
  if (node.kind === 'group') return `g:${node.groupKey}`;
  return `${node.kind}:${node.interval}:${node.exchange}:${node.symbol}`;
}

function $computeDataFreshness(endIso) {
  if (!endIso) return { label: '无数据', level: 'none' };
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime())) return { label: '未知', level: 'none' };
  const now = new Date();
  const diffMs = now.getTime() - end.getTime();
  const diffDays = diffMs / (86400000);
  if (diffDays < 1.5) return { label: '最新', level: 'ok' };
  if (diffDays <= 3) return { label: `距最新 ${Math.ceil(diffDays)} 天`, level: 'warn' };
  return { label: '数据偏旧', level: 'stale' };
}

function $dataSourceLabel(sources) {
  if (!sources?.length) return '';
  const map = { stored: '下载', recorded: '录制' };
  return sources.map(s => map[s] || s).join('+');
}

function $contractMapKey(symbol, exchange) {
  return `${symbol}\0${exchange}`;
}

function $catalogPlaceholderRow(symbol, exchange, interval, vt_symbol, listed) {
  return {
    symbol,
    exchange,
    interval,
    vt_symbol: vt_symbol || `${symbol}.${exchange}`,
    count: 0,
    catalogOnly: true,
    listed: listed !== false,
  };
}

function $ensureDownloadPlaceholders(entry) {
  const { symbol, exchange } = entry;
  if (!symbol || !exchange) return;
  let vt = `${symbol}.${exchange}`;
  for (const row of entry.intervals.values()) {
    if (row.vt_symbol) { vt = row.vt_symbol; break; }
  }
  for (const itv of DATA_DOWNLOAD_PLACEHOLDER_INTERVALS) {
    if (entry.intervals.has(itv)) continue;
    entry.intervals.set(itv, $catalogPlaceholderRow(symbol, exchange, itv, vt, true));
  }
}

function $collectContractMap(barRows, tickRows, listedCatalog, includeListed) {
  const map = new Map();

  function putInterval(symbol, exchange, interval, row, kind) {
    const key = $contractMapKey(symbol, exchange);
    if (!map.has(key)) {
      map.set(key, { symbol, exchange, intervals: new Map() });
    }
    map.get(key).intervals.set(interval, { ...row, kind: kind || 'bar', interval });
  }

  for (const row of barRows || []) {
    putInterval(row.symbol, row.exchange, row.interval || '1m', row, 'bar');
  }
  for (const row of tickRows || []) {
    putInterval(row.symbol, row.exchange, 'tick', row, 'tick');
  }

  if (includeListed) {
    for (const cat of listedCatalog || []) {
      const sym = cat.symbol;
      const ex = cat.exchange;
      if (!sym || !ex) continue;
      const key = $contractMapKey(sym, ex);
      if (!map.has(key)) map.set(key, { symbol: sym, exchange: ex, intervals: new Map() });
      const entry = map.get(key);
      const vt = cat.vt_symbol || `${sym}.${ex}`;
      for (const itv of DATA_DOWNLOAD_PLACEHOLDER_INTERVALS) {
        if (!entry.intervals.has(itv)) {
          entry.intervals.set(itv, $catalogPlaceholderRow(sym, ex, itv, vt, cat.listed));
        }
      }
    }
  }

  for (const entry of map.values()) {
    $ensureDownloadPlaceholders(entry);
  }

  return map;
}

function $contractHasLocalData(entry) {
  for (const [, row] of entry.intervals) {
    if (!row.catalogOnly && (row.count > 0 || row.interval === 'tick')) return true;
  }
  return false;
}

function $bumpGroupCounts(node, leaf) {
  node.count = (node.count || 0) + 1;
  if (leaf.count > 0) node.dataCount = (node.dataCount || 0) + 1;
}

function $exchangeSortOrder(exchange) {
  const order = (CONTRACT_EXCHANGES || []).map(e => e.value);
  const idx = order.indexOf(exchange);
  return idx < 0 ? 99 : idx;
}

function $buildDataTree(barRows, tickRows, selectedKey, listedCatalog, includeListed) {
  const showListed = includeListed !== false;
  const contractMap = $collectContractMap(barRows, tickRows, listedCatalog, showListed);

  const entries = [...contractMap.values()].filter(entry =>
    showListed || $contractHasLocalData(entry)
  );

  entries.sort((a, b) => {
    const ex = $exchangeSortOrder(a.exchange) - $exchangeSortOrder(b.exchange);
    if (ex !== 0) return ex;
    const pa = $productFromVt(`${a.symbol}.${a.exchange}`);
    const pb = $productFromVt(`${b.symbol}.${b.exchange}`);
    const prod = pa.localeCompare(pb);
    if (prod !== 0) return prod;
    return (b.symbol || '').localeCompare(a.symbol || '');
  });

  const exchangeNodes = {};
  const productNodes = {};
  const contractNodes = {};

  for (const entry of entries) {
    const { symbol, exchange } = entry;
    const vt = `${symbol}.${exchange}`;
    const product = $productFromVt(vt) || 'OTHER';

    const exKey = `ex:${exchange}`;
    if (!exchangeNodes[exKey]) {
      exchangeNodes[exKey] = {
        kind: 'group',
        groupType: 'exchange',
        groupKey: exKey,
        label: exchange,
        exchange,
        expanded: false,
        children: [],
        count: 0,
        dataCount: 0,
      };
    }
    const exNode = exchangeNodes[exKey];

    const prodKey = `${exKey}:${product}`;
    if (!productNodes[prodKey]) {
      productNodes[prodKey] = {
        kind: 'group',
        groupType: 'product',
        groupKey: prodKey,
        label: $productGroupLabel(product),
        product,
        exchange,
        expanded: false,
        children: [],
        count: 0,
        dataCount: 0,
      };
      exNode.children.push(productNodes[prodKey]);
    }
    const prodNode = productNodes[prodKey];

    const conKey = `${prodKey}:${symbol}`;
    if (!contractNodes[conKey]) {
      contractNodes[conKey] = {
        kind: 'group',
        groupType: 'contract',
        groupKey: conKey,
        label: symbol,
        symbol,
        exchange,
        vt_symbol: vt,
        expanded: false,
        children: [],
        count: 0,
        dataCount: 0,
      };
      prodNode.children.push(contractNodes[conKey]);
    }
    const conNode = contractNodes[conKey];

    for (const itv of DATA_INTERVAL_ORDER) {
      const row = entry.intervals.get(itv);
      if (!row) continue;
      const leaf = $leafFromDataRow(row, row.kind || (itv === 'tick' ? 'tick' : 'bar'));
      conNode.children.push(leaf);
      $bumpGroupCounts(conNode, leaf);
      $bumpGroupCounts(prodNode, leaf);
      $bumpGroupCounts(exNode, leaf);
    }
  }

  const tree = Object.values(exchangeNodes)
    .filter(n => n.children.length > 0)
    .sort((a, b) => $exchangeSortOrder(a.exchange) - $exchangeSortOrder(b.exchange));

  if (selectedKey) $expandDataTreeToKey(tree, selectedKey);
  return tree;
}

function $flattenDataLeaves(tree) {
  const out = [];
  function walk(nodes) {
    for (const n of nodes || []) {
      if (n.kind === 'bar' || n.kind === 'tick') out.push(n);
      else if (n.children) walk(n.children);
    }
  }
  walk(tree);
  return out;
}

function $findDataNode(tree, key) {
  let found = null;
  function walk(nodes) {
    for (const n of nodes || []) {
      if ($dataNodeKey(n) === key) { found = n; return; }
      walk(n.children);
      if (found) return;
    }
  }
  walk(tree);
  return found;
}

function $expandDataTreeToKey(tree, key) {
  if (!key || !tree) return;
  function walk(nodes, ancestors) {
    for (const n of nodes || []) {
      if ($dataNodeKey(n) === key) {
        ancestors.forEach(a => { a.expanded = true; });
        return true;
      }
      if (n.children?.length && walk(n.children, [...ancestors, n])) return true;
    }
    return false;
  }
  walk(tree, []);
}

function $resyncDataSelection(tree, key) {
  if (!key || !tree) return null;
  $expandDataTreeToKey(tree, key);
  return $findDataNode(tree, key);
}

function $matchDataTreeSearch(tree, q) {
  const query = (q || '').trim().toLowerCase();
  if (!query) return tree;

  function filterNodes(nodes) {
    const out = [];
    for (const n of nodes || []) {
      if (n.kind === 'bar' || n.kind === 'tick') {
        const cn = typeof $contractLabel === 'function' ? $contractLabel(n.vt_symbol) : '';
        const sub = typeof $contractSubLabel === 'function' ? $contractSubLabel(n.vt_symbol) : '';
        const hay = `${n.vt_symbol} ${n.symbol} ${n.exchange} ${cn} ${sub} ${DATA_INTERVAL_LABELS[n.interval] || n.interval}`.toLowerCase();
        if (hay.includes(query)) out.push({ ...n });
      } else if (n.groupType === 'contract') {
        const cn = typeof $contractLabel === 'function' ? $contractLabel(n.vt_symbol) : '';
        const sub = typeof $contractSubLabel === 'function' ? $contractSubLabel(n.vt_symbol) : '';
        const hay = `${n.vt_symbol} ${n.symbol} ${n.exchange} ${cn} ${sub}`.toLowerCase();
        const kids = filterNodes(n.children);
        if (hay.includes(query)) {
          out.push({ ...n, children: n.children || [], expanded: true });
        } else if (kids.length) {
          out.push({ ...n, children: kids, expanded: true });
        }
      } else {
        const kids = filterNodes(n.children);
        if (kids.length) out.push({ ...n, children: kids, expanded: true });
      }
    }
    return out;
  }
  return filterNodes(tree);
}

function $watchlistVtSet() {
  const set = new Set();
  for (const w of ui.watchlist || []) {
    const vt = $normalizeVt(w.vt_symbol);
    if (vt) set.add(vt);
  }
  return set;
}

function $filterDataTreeWatchlist(tree) {
  const wl = $watchlistVtSet();
  if (!wl.size) return [];

  function filterNodes(nodes) {
    const out = [];
    for (const n of nodes || []) {
      if (n.kind === 'bar' || n.kind === 'tick') {
        if (wl.has($normalizeVt(n.vt_symbol))) out.push({ ...n });
      } else if (n.groupType === 'contract') {
        const vt = $normalizeVt(n.vt_symbol || `${n.symbol}.${n.exchange}`);
        if (wl.has(vt)) {
          out.push({ ...n, children: n.children || [], expanded: true });
        }
      } else {
        const kids = filterNodes(n.children);
        if (kids.length) out.push({ ...n, children: kids, expanded: true });
      }
    }
    return out;
  }
  return filterNodes(tree);
}

function $parseDataDeepLink(raw) {
  if (!raw) return null;
  const p = typeof raw === 'string' ? Object.fromEntries(new URLSearchParams(raw)) : raw;
  if (!p.symbol && !p.vt_symbol && !p.sub) return null;
  let symbol = p.symbol || '';
  let exchange = p.exchange || '';
  if (p.vt_symbol) {
    const parsed = $parseVtSymbol(p.vt_symbol);
    symbol = parsed.symbol;
    exchange = parsed.exchange || exchange;
  }
  return {
    sub: p.sub || 'local',
    symbol,
    exchange,
    interval: p.interval || '1m',
    action: p.action || 'view',
    vt_symbol: p.vt_symbol || (symbol && exchange ? `${symbol}.${exchange}` : ''),
  };
}

function $initDataTabFromUrl() {
  const q = new URLSearchParams(location.search);
  if (q.get('tab') !== 'data') return;
  const link = $parseDataDeepLink(location.search);
  if (link) $openDataTab(link);
}

function $defaultDownloadDates(interval) {
  const end = new Date();
  const start = new Date();
  const days = interval === 'd' || interval === 'w' ? 1095 : 60;
  start.setDate(start.getDate() - days);
  const fmt = d => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}
