// ===== 数据管理：树形导航（方案 C：交易所 → 品种 → 合约 → 周期） =====

const DataTreeIntervalLeaf = {
  props: {
    node: { type: Object, required: true },
    selectedKey: { type: String, default: '' },
    depth: { type: Number, default: 0 },
  },
  emits: ['select'],
  template: `
    <div class="data-tree-leaf data-interval-leaf"
      :class="{ active: dataKey === selectedKey, 'catalog-only': node.catalogOnly, expired: node.expired }"
      :style="leafStyle" :ref="setRef"
      @click="$emit('select', node)">
      <span class="data-interval-label">{{ intervalLabel(node.interval) }}</span>
      <span v-if="node.count > 0" class="data-interval-count num">{{ node.count.toLocaleString() }} 条</span>
      <span class="data-freshness" :class="node.freshness?.level">{{ node.freshness?.label }}</span>
      <span v-if="node.sourceLabel" class="data-source-badge">{{ node.sourceLabel }}</span>
    </div>`,
  setup(props) {
    const dataKey = computed(() => $dataNodeKey(props.node));
    const leafStyle = computed(() => ({ paddingLeft: `${28 + props.depth * 12}px` }));

    function setRef(el) {
      if (el) DataTreeNav._leafRefs[dataKey.value] = el;
      else delete DataTreeNav._leafRefs[dataKey.value];
    }
    function intervalLabel(itv) {
      return DATA_INTERVAL_LABELS[itv] || itv;
    }

    return { dataKey, leafStyle, setRef, intervalLabel };
  },
};

const DataTreeBranch = {
  name: 'DataTreeBranch',
  props: {
    nodes: { type: Array, default: () => [] },
    selectedKey: { type: String, default: '' },
    depth: { type: Number, default: 0 },
  },
  emits: ['select'],
  components: { DataTreeIntervalLeaf },
  template: `
    <template v-for="node in nodes" :key="node.groupKey || dataKey(node)">
      <div v-if="node.kind === 'group'" class="data-tree-subgroup">
        <div v-if="node.groupType === 'contract'" class="data-tree-contract-hd" :style="headStyle" @click="toggle(node)">
          <span class="data-tree-caret">{{ node.expanded ? '▼' : '▶' }}</span>
          <div class="data-tree-contract-info">
            <template v-if="isIndexOption(node.vt_symbol)">
              <span class="data-leaf-cn">{{ contractLabel(node.vt_symbol) }}</span>
              <span class="data-leaf-cn sub">{{ contractSubLabel(node.vt_symbol) }}</span>
              <span class="data-leaf-code">{{ contractCodeLine(node.vt_symbol) }}</span>
            </template>
            <template v-else>
              <span class="data-leaf-cn">{{ contractLabel(node.vt_symbol) }}</span>
              <span class="data-leaf-code">{{ node.symbol }}</span>
            </template>
          </div>
          <span class="data-tree-badge">{{ groupBadge(node) }}</span>
        </div>
        <div v-else class="data-tree-group-hd sub" :style="headStyle" @click="toggle(node)">
          <span class="data-tree-caret">{{ node.expanded ? '▼' : '▶' }}</span>
          <span>{{ node.label }}</span>
          <span class="data-tree-badge">{{ groupBadge(node) }}</span>
        </div>
        <div v-show="node.expanded">
          <data-tree-branch
            :nodes="node.children || []"
            :selected-key="selectedKey"
            :depth="depth + 1"
            @select="$emit('select', $event)"
          />
        </div>
      </div>
      <data-tree-interval-leaf
        v-else
        :node="node"
        :selected-key="selectedKey"
        :depth="depth"
        @select="$emit('select', $event)"
      />
    </template>`,
  setup(props) {
    const headStyle = computed(() => ({ paddingLeft: `${16 + props.depth * 12}px` }));
    function toggle(node) { node.expanded = !node.expanded; }
    function dataKey(node) { return $dataNodeKey(node); }
    function groupBadge(node) {
      if (!node || node.kind !== 'group') return '';
      const total = node.count || 0;
      const dataCount = node.dataCount || 0;
      if (node.groupType === 'contract') {
        return dataCount > 0 ? `${dataCount}/${total}` : String(total);
      }
      if (dataCount > 0 && dataCount < total) return `${dataCount}/${total}`;
      return total;
    }
    return {
      headStyle, toggle, dataKey, groupBadge,
      contractLabel: $contractLabel,
      contractSubLabel: $contractSubLabel,
      contractCodeLine: $contractCodeLine,
      isIndexOption: $isIndexOption,
    };
  },
};

DataTreeBranch.components = { DataTreeIntervalLeaf, DataTreeBranch };

const DataTreeNav = {
  components: { DataTreeBranch, DataTreeIntervalLeaf },
  props: {
    tree: { type: Array, default: () => [] },
    selectedKey: { type: String, default: '' },
  },
  emits: ['select'],
  template: `
    <div class="data-tree-nav" ref="rootEl">
      <template v-for="group in tree" :key="group.groupKey">
        <div class="data-tree-group">
          <div class="data-tree-group-hd" @click="toggle(group)">
            <span class="data-tree-caret">{{ group.expanded ? '▼' : '▶' }}</span>
            <span>{{ group.label }}</span>
            <span class="data-tree-badge">{{ groupBadge(group) }}</span>
          </div>
          <div v-show="group.expanded" class="data-tree-children">
            <data-tree-branch
              :nodes="group.children || []"
              :selected-key="selectedKey"
              :depth="0"
              @select="$emit('select', $event)"
            />
          </div>
        </div>
      </template>
      <div v-if="!tree.length" class="empty-hint">本地库暂无数据<br><small>连接网关后下载或启动 DataRecorder</small></div>
    </div>`,
  setup(props) {
    DataTreeNav._leafRefs = {};
    const rootEl = ref(null);

    function toggle(node) { node.expanded = !node.expanded; }

    function groupBadge(node) {
      if (!node || node.kind !== 'group') return '';
      const total = node.count || 0;
      const dataCount = node.dataCount || 0;
      if (dataCount > 0 && dataCount < total) return `${dataCount}/${total}`;
      return total;
    }

    function scrollToSelected(key) {
      if (!key) return;
      nextTick(() => {
        const el = DataTreeNav._leafRefs[key];
        if (el?.scrollIntoView) {
          el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
      });
    }

    watch(() => props.selectedKey, (key) => scrollToSelected(key), { immediate: true });
    watch(() => props.tree, () => scrollToSelected(props.selectedKey));

    return { rootEl, toggle, groupBadge };
  },
};
