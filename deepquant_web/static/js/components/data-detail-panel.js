// ===== 数据管理：详情面板（摘要 + K线 + 表） =====
const DataDetailPanel = {
  props: {
    selection: { type: Object, default: null },
    dmAvailable: { type: Boolean, default: false },
  },
  emits: ['update', 'delete', 'openTrading', 'openBacktest', 'materialize', 'download'],
  template: `
    <div class="data-detail-panel">
      <div v-if="!selection" class="empty-hint">在左侧选择合约查看数据详情</div>
      <template v-else>
        <div class="data-summary-bar">
          <div class="data-summary-main">
          <template v-if="isIndexOption(selection.vt_symbol)">
            <strong>{{ contractLabel(selection.vt_symbol) }}</strong>
            <strong class="mut">{{ contractSubLabel(selection.vt_symbol) }}</strong>
            <span class="mut">{{ contractCodeLine(selection.vt_symbol) }}.{{ selection.exchange }}</span>
          </template>
          <template v-else>
            <strong>{{ contractLabel(selection.vt_symbol) }}</strong>
            <span class="mut">{{ selection.vt_symbol }}</span>
          </template>
          <span class="mut">{{ intervalLabel(viewTab === 'chart' ? previewInterval : selection.interval) }}</span>
          <span v-if="!selection.catalogOnly" class="num">{{ selection.count?.toLocaleString() }} 条</span>
          <span v-else class="data-source-badge">{{ selection.expired ? '已过期 · 未下载' : '挂牌 · 未下载' }}</span>
        </div>
          <div class="data-summary-sub">
            <span v-if="selection.start">{{ fmtRange(selection.start, selection.effective_end || selection.end) }}</span>
            <span v-if="selection.expired && !selection.catalogOnly" class="data-source-badge expired">已过期 · 可回测</span>
            <span v-if="selection.sourceLabel" class="data-source-badge">{{ selection.sourceLabel }}</span>
            <span class="data-freshness" :class="selection.freshness?.level">{{ selection.freshness?.label }}</span>
          </div>
          <div class="data-summary-actions">
            <button v-if="selection.catalogOnly && dmAvailable" class="btn btn-xs btn-primary" @click="$emit('download')">下载历史数据</button>
            <button v-else-if="selection.kind === 'bar' && dmAvailable" class="btn btn-xs btn-primary" @click="$emit('update')">更新到今天</button>
            <button v-if="selection.kind === 'tick' || selection.sources?.includes('recorded')" class="btn btn-xs" @click="$emit('materialize')">物化 Tick→1m</button>
            <button v-if="selection.kind === 'bar' && !selection.catalogOnly && selection.count > 0" class="btn btn-xs" @click="$emit('openBacktest')">用于回测</button>
            <button class="btn btn-xs" @click="$emit('openTrading')">在行情中打开</button>
            <button v-if="selection.kind === 'bar' && dmAvailable && !selection.catalogOnly" class="btn btn-xs mut" @click="$emit('delete')">删除</button>
          </div>
        </div>
        <div class="data-detail-tabs">
          <button class="btn btn-xs" :class="{ 'btn-primary': viewTab === 'chart' }" @click="setViewTab('chart')">K线</button>
          <button class="btn btn-xs" :class="{ 'btn-primary': viewTab === 'table' }" @click="setViewTab('table')">明细</button>
          <div v-if="showIntervalBar" class="data-chart-intervals">
            <button v-for="iv in previewIntervals" :key="iv" class="btn btn-xs"
              :class="{ 'btn-primary': previewInterval === iv }"
              @click="setPreviewInterval(iv)">{{ intervalLabel(iv) }}</button>
          </div>
        </div>
        <div v-show="viewTab === 'chart'" class="data-preview-chart" ref="chartEl"></div>
        <div v-show="viewTab === 'table'" class="data-bar-table-wrap">
          <table class="data-table compact">
            <thead><tr>
              <th>时间</th><th class="num">开</th><th class="num">高</th><th class="num">低</th><th class="num">收</th><th class="num">量</th>
            </tr></thead>
            <tbody>
              <tr v-for="(b, i) in pageBars" :key="i">
                <td>{{ fmtDt(b.datetime) }}</td>
                <td class="num">{{ b.open }}</td>
                <td class="num">{{ b.high }}</td>
                <td class="num">{{ b.low }}</td>
                <td class="num">{{ b.close }}</td>
                <td class="num">{{ b.volume }}</td>
              </tr>
              <tr v-if="!pageBars.length && !loading"><td colspan="6" class="empty">{{ emptyHint }}</td></tr>
              <tr v-if="loading"><td colspan="6" class="empty">加载中…</td></tr>
            </tbody>
          </table>
          <div v-if="bars.length > pageSize" class="data-pager">
            <button class="btn btn-xs" :disabled="page <= 0" @click="page--">上一页</button>
            <span>{{ page + 1 }} / {{ totalPages }}</span>
            <button class="btn btn-xs" :disabled="page >= totalPages - 1" @click="page++">下一页</button>
          </div>
        </div>
      </template>
    </div>`,
  setup(props) {
    const chartEl = ref(null);
    const bars = ref([]);
    const loading = ref(false);
    const page = ref(0);
    const viewTab = ref('chart');
    const previewInterval = ref('1m');
    const previewIntervals = ['1m', '5m', '15m', '1h', 'd'];
    const pageSize = 50;
    let chartInstance = null;
    let selectionKey = '';

    const showIntervalBar = computed(() =>
      props.selection?.kind === 'bar' && !props.selection?.catalogOnly && viewTab.value === 'chart');

    function normalizePreviewInterval(itv) {
      if (!itv || itv === 'tick') return '1m';
      if (itv === 'w') return 'd';
      return previewIntervals.includes(itv) ? itv : '1m';
    }

    function previewDateRange(sel, interval) {
      const end = (sel.effective_end || sel.end || '').slice(0, 10)
        || new Date().toISOString().slice(0, 10);
      let start = (sel.start || '').slice(0, 10);
      const lookbackDays = { '1m': 60, '5m': 60, '15m': 90, '1h': 180 };
      const days = lookbackDays[interval];
      if (days != null) {
        const endD = new Date(`${end}T12:00:00`);
        const startD = new Date(endD);
        startD.setDate(startD.getDate() - days);
        const computed = startD.toISOString().slice(0, 10);
        if (!start || start < computed) start = computed;
      }
      if (!start) start = $defaultDownloadDates(interval).start;
      return { start, end };
    }

    const pageBars = computed(() => {
      const rev = [...bars.value].reverse();
      const start = page.value * pageSize;
      return rev.slice(start, start + pageSize);
    });
    const totalPages = computed(() => Math.max(1, Math.ceil(bars.value.length / pageSize)));
    const emptyHint = computed(() => {
      if (props.selection?.catalogOnly) {
        return props.selection.expired
          ? '该过期合约尚无本地数据，可下载历史 K 线用于回测'
          : '该合约尚无本地数据，点击「下载历史数据」开始下载';
      }
      if (props.selection?.kind === 'tick') {
        return 'Tick 录制数据请通过分钟线合并查看，或前往行情 Tab 逐笔';
      }
      if (props.selection?.expired) return '暂无预览数据（过期合约若库中有数据，请检查时间范围）';
      return '暂无 K 线预览数据';
    });

    function intervalLabel(itv) {
      return DATA_INTERVAL_LABELS[itv] || itv;
    }
    function fmtRange(s, e) {
      const a = (s || '').slice(0, 16).replace('T', ' ');
      const b = (e || '').slice(0, 16).replace('T', ' ');
      return `${a} → ${b}`;
    }
    function fmtDt(dt) {
      if (!dt) return '';
      return String(dt).slice(0, 19).replace('T', ' ');
    }

    function ensureChart() {
      if (!chartEl.value) return null;
      if (!chartInstance) {
        chartInstance = echarts.init(chartEl.value);
        chartInstance.setOption($chartBaseOption('candle'));
      }
      return chartInstance;
    }

    function setViewTab(tab) {
      viewTab.value = tab;
      if (tab === 'chart') {
        nextTick(() => {
          const inst = ensureChart();
          if (inst) {
            inst.resize();
            if (bars.value.length) $applyCandleChart(inst, bars.value, props.selection?.vt_symbol);
          }
        });
      }
    }

    function setPreviewInterval(iv) {
      if (previewInterval.value === iv) return;
      previewInterval.value = iv;
      loadPreview(props.selection);
    }

    async function loadPreview(sel) {
      if (!sel) {
        bars.value = [];
        if (chartInstance) $clearChart(chartInstance);
        return;
      }
      $ensureContractName(sel.vt_symbol);
      if (sel.kind === 'tick') {
        bars.value = [];
        if (chartInstance) $clearChart(chartInstance);
        return;
      }
      if (sel.catalogOnly) {
        bars.value = [];
        if (chartInstance) $clearChart(chartInstance);
        return;
      }
      loading.value = true;
      page.value = 0;
      try {
        const interval = previewInterval.value || '1m';
        const apiInterval = CHART_INTERVAL_API[interval] || interval;
        const { start, end } = previewDateRange(sel, interval);
        const q = new URLSearchParams({
          symbol: sel.symbol,
          exchange: sel.exchange,
          interval: apiInterval,
          start,
          end,
        });
        const data = await $apiGet(`/api/bars?${q}`);
        let loaded = data.bars || [];
        const aggN = AGGREGATE_N[interval];
        if (aggN && loaded.length) loaded = $aggregateBars(loaded, aggN);
        bars.value = loaded;
        await nextTick();
        if (viewTab.value === 'chart') {
          const inst = ensureChart();
          if (inst && bars.value.length) {
            $applyCandleChart(inst, bars.value, sel.vt_symbol);
          } else if (inst) {
            $clearChart(inst);
          }
        }
      } catch (e) {
        bars.value = [];
        $toast('加载预览失败', 'error');
      } finally {
        loading.value = false;
      }
    }

    watch(
      () => (props.selection ? $dataNodeKey(props.selection) : ''),
      (key) => {
        if (key !== selectionKey) {
          selectionKey = key;
          previewInterval.value = normalizePreviewInterval(props.selection?.interval);
        }
        loadPreview(props.selection);
      },
      { immediate: true },
    );
    watch(() => store.dataPreviewRevision, () => {
      if (props.selection) loadPreview(props.selection);
    });

    onUnmounted(() => {
      if (chartInstance) {
        chartInstance.dispose();
        chartInstance = null;
      }
    });

    return {
      chartEl, bars, loading, page, pageSize, pageBars, totalPages, emptyHint, viewTab,
      previewInterval, previewIntervals, showIntervalBar, setPreviewInterval,
      intervalLabel, fmtRange, fmtDt, contractLabel: $contractLabel,
      contractSubLabel: $contractSubLabel, contractCodeLine: $contractCodeLine,
      isIndexOption: $isIndexOption, setViewTab,
    };
  },
};
