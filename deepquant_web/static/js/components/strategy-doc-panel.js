// ===== 策略原理说明面板（可复用） =====

const StrategyDocPanel = {
  props: {
    className: { type: String, default: '' },
    parameters: { type: Object, default: () => ({}) },
    compact: { type: Boolean, default: false },
    showParams: { type: Boolean, default: true },
  },
  template: `
    <div class="st-doc" :class="{ compact }" v-if="doc">
      <div class="st-doc-head">
        <span class="st-doc-type">{{ doc.type }}</span>
        <span class="st-doc-tf">{{ doc.timeframe }}</span>
      </div>
      <p class="st-doc-summary">{{ doc.summary }}</p>
      <div v-if="!compact" class="st-doc-block">
        <div class="st-doc-label">交易逻辑</div>
        <ul class="st-doc-list">
          <li v-for="(line, i) in doc.logic" :key="'l'+i">{{ line }}</li>
        </ul>
      </div>
      <div v-if="showParams && paramRows.length" class="st-doc-block">
        <div class="st-doc-label">参数说明</div>
        <table class="data-table st-doc-table">
          <thead><tr><th>参数</th><th>当前/默认</th><th v-if="!compact">逻辑</th></tr></thead>
          <tbody>
            <tr v-for="row in paramRows" :key="row.name">
              <td><span class="st-doc-pname">{{ row.label }}</span><code v-if="row.label !== row.name" class="st-doc-code">{{ row.name }}</code></td>
              <td class="num">{{ row.value }}</td>
              <td v-if="!compact" class="st-doc-hint">{{ row.logic }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-if="!compact && doc.risks?.length" class="st-doc-block">
        <div class="st-doc-label warn">风险提示</div>
        <ul class="st-doc-list warn">
          <li v-for="(r, i) in doc.risks" :key="'r'+i">{{ r }}</li>
        </ul>
      </div>
      <div v-if="!compact && doc.suitable?.length" class="st-doc-block">
        <div class="st-doc-label">适用场景</div>
        <div class="st-doc-tags">
          <span v-for="(t, i) in doc.suitable" :key="'s'+i" class="st-doc-tag">{{ t }}</span>
        </div>
      </div>
    </div>
  `,
  setup(props) {
    const doc = computed(() => $strategyDoc(props.className));
    const paramRows = computed(() =>
      $strategyParamRows(props.className, props.parameters)
    );
    return { doc, paramRows };
  },
};
