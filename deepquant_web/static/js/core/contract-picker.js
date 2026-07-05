// ===== 合约选择器（交易所 → 品种 → 合约列表） =====

/** 支持的交易所列表 */
const CONTRACT_EXCHANGES = [
  { value: 'CFFEX', name: '中金所' },
  { value: 'SHFE', name: '上期所' },
  { value: 'DCE', name: '大商所' },
  { value: 'CZCE', name: '郑商所' },
  { value: 'INE', name: '上海能源' },
  { value: 'GFEX', name: '广期所' },
];

const PUBLIC_CONTRACT_BATCH_SIZE = 100;

/** 分页拉取公共合约目录，每批最多 100 条 */
async function $fetchPublicContracts({ exchange = '', product = '', batchSize = PUBLIC_CONTRACT_BATCH_SIZE } = {}) {
  const limit = Math.min(Math.max(1, batchSize), PUBLIC_CONTRACT_BATCH_SIZE);
  const base = new URLSearchParams({ offset: '0', limit: String(limit) });
  if (exchange) base.set('exchange', exchange);
  if (product) base.set('product', product);

  const first = await $apiGet(`/api/contracts/public?${base}`);
  const all = [...(first.contracts || [])];
  if (!first.has_more) return all;

  const total = first.total || all.length;
  const offsets = [];
  for (let off = all.length; off < total; off += limit) offsets.push(off);
  if (!offsets.length) return all;

  const pages = await Promise.all(offsets.map(async (off) => {
    const p = new URLSearchParams(base);
    p.set('offset', String(off));
    const d = await $apiGet(`/api/contracts/public?${p}`);
    return d.contracts || [];
  }));
  for (const batch of pages) all.push(...batch);
  return all;
}

/**
 * 创建合约选择器响应式状态（在组件 setup 内调用）
 * @returns {object} 选择器状态与方法
 */
function $createContractPicker() {
  const exchange = ref('');
  const product = ref('');
  const selectedVt = ref('');
  const keyword = ref('');
  const products = ref([]);
  const contracts = ref([]);
  const loading = ref(false);

  async function onExchange() {
    product.value = '';
    selectedVt.value = '';
    contracts.value = [];
    if (!exchange.value) {
      products.value = [];
      return;
    }
    loading.value = true;
    try {
      const data = await $apiGet(`/api/contracts/products?exchange=${exchange.value}`) || {};
      products.value = Array.isArray(data) ? data : (data.products || []);
    } catch (e) {
      products.value = [];
      $toast('加载品种失败', 'error');
    } finally {
      loading.value = false;
    }
  }

  async function onProduct() {
    selectedVt.value = '';
    if (!product.value || !exchange.value) {
      contracts.value = [];
      return;
    }
    loading.value = true;
    try {
      const list = await $fetchPublicContracts({
        exchange: exchange.value,
        product: product.value,
      });
      contracts.value = list.map(c => {
        const sym = c.symbol || '';
        const vt = $normalizeVt(c.vt_symbol || `${sym}.${exchange.value}`);
        if (c.name) $setContractNameIfBetter(vt, c.name);
        const listed = c.listed !== false;
        return { ...c, vt_symbol: vt, symbol: sym, listed, expired: isExpired(sym || vt) };
      }).filter(c => !c.expired && c.listed !== false);
    } catch (e) {
      contracts.value = [];
      $toast('加载合约失败', 'error');
    } finally {
      loading.value = false;
    }
  }

  const filteredContracts = computed(() => {
    const q = keyword.value.trim();
    if (!q) return contracts.value;
    return contracts.value.filter(c =>
      $matchContractQuery(q, c.vt_symbol) || $matchContractQuery(q, c.symbol || '')
    );
  });

  function reset() {
    exchange.value = '';
    product.value = '';
    selectedVt.value = '';
    keyword.value = '';
    products.value = [];
    contracts.value = [];
    loading.value = false;
  }

  return {
    exchange, product, selectedVt, keyword, products, contracts, filteredContracts, loading,
    onExchange, onProduct, reset,
  };
}
