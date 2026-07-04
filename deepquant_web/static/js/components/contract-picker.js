// ===== 合约选择面板（三级联动 + 列表点选） =====

const ContractPicker = {
  props: {
    modelValue: { type: String, default: '' },
    compact: { type: Boolean, default: false },
  },
  emits: ['update:modelValue', 'pick'],
  template: `
    <div class="contract-picker" :class="{ compact }">
      <div class="cp-filters">
        <select v-model="exchange" @change="onExchange" class="input">
          <option value="">选择交易所</option>
          <option v-for="ex in exchanges" :key="ex.value" :value="ex.value">{{ ex.name }}</option>
        </select>
        <select v-model="product" @change="onProduct" class="input" :disabled="!exchange">
          <option value="">选择品种</option>
          <option v-for="p in products" :key="p.prefix" :value="p.prefix">{{ p.prefix }} — {{ p.name }}</option>
        </select>
        <input v-model="keyword" class="input input-sm" placeholder="筛选合约（中文/拼音/代码）" :disabled="!product">
      </div>
      <div class="contract-pick-list" v-if="product">
        <button v-for="c in filteredContracts" :key="c.vt_symbol" type="button"
          class="contract-pick-item" :class="{ active: selectedVt === c.vt_symbol || modelValue === c.vt_symbol }"
          @click="pick(c.vt_symbol)">
          <div class="cpi-main">
            <template v-if="isIndexOption(c.vt_symbol)">
              <span class="cpi-line">{{ contractLabel(c.vt_symbol) }}</span>
              <span class="cpi-line">{{ contractSubLabel(c.vt_symbol) }}</span>
              <span class="cpi-code">{{ contractCodeLine(c.vt_symbol) }}</span>
            </template>
            <template v-else>
              <span class="cpi-line">{{ contractLabel(c.vt_symbol) }}</span>
              <span class="cpi-code">{{ c.symbol }}</span>
            </template>
          </div>
          <span v-if="inWatchlist(c.vt_symbol)" class="cpi-tag">已加</span>
        </button>
        <div v-if="loading" class="cp-empty">加载中…</div>
        <div v-else-if="!filteredContracts.length" class="cp-empty">无匹配合约</div>
      </div>
      <div v-else class="cp-empty cp-hint">请先选择交易所和品种</div>
    </div>`,
  setup(props, { emit }) {
    const picker = $createContractPicker();
    const {
      exchange, product, selectedVt, keyword, products, filteredContracts, loading,
      onExchange, onProduct, reset,
    } = picker;

    watch(() => props.modelValue, (vt) => {
      if (vt) selectedVt.value = $normalizeVt(vt);
    }, { immediate: true });

    function pick(vt) {
      vt = $normalizeVt(vt);
      selectedVt.value = vt;
      emit('update:modelValue', vt);
      emit('pick', vt);
    }

    function contractLabel(vt) { return $contractLabel(vt); }
    function contractSubLabel(vt) { return $contractSubLabel(vt); }
    function contractCodeLine(vt) { return $contractCodeLine(vt); }
    function isIndexOption(vt) { return $isIndexOption(vt); }
    function inWatchlist(vt) {
      return ui.watchlist.some(w => w.vt_symbol === $normalizeVt(vt));
    }

    return {
      exchanges: CONTRACT_EXCHANGES,
      exchange, product, selectedVt, keyword, products, filteredContracts, loading,
      onExchange, onProduct, reset, pick,
      contractLabel, contractSubLabel, contractCodeLine, isIndexOption, inWatchlist,
    };
  },
};
