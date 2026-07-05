// ===== Tab 1: 行情交易（P0–P2） =====

const TabTrading = {
  template: `
    <div class="trading-layout">
      <trading-onboarding v-if="showOnboarding" @connect="ui.showAccountDrawer = true"
        @add-watchlist="addDefaultWatchlist" @select-symbol="focusWatchlist" />

      <template v-else>
        <div class="symbol-bar" v-if="chartSymbol">
          <div class="sym-info">
            <div class="contract-label-col" v-if="isIndexOption(chartSymbol)">
              <span class="option-line">{{ contractLabel(chartSymbol) }}</span>
              <span class="option-line">{{ contractSubLabel(chartSymbol) }}</span>
              <span class="option-code">{{ contractCodeLine(chartSymbol) }}</span>
            </div>
            <template v-else>
              <span class="sym-name">{{ contractLabel(chartSymbol) }}</span>
              <span class="sym-code">{{ chartSymbol }} · {{ chartModeLabel }}</span>
            </template>
            <span class="sym-code" v-if="isIndexOption(chartSymbol)">{{ chartModeLabel }}</span>
          </div>
          <span class="sym-price flash-target" :class="[chgCls(activeTick), priceFlashCls]">{{ fmtPrice(activeTick?.last_price) }}</span>
          <span class="sym-chg" :class="chgCls(activeTick)">{{ chgAbs(activeTick) }} {{ chgText(activeTick) }}</span>
          <div class="sym-intervals">
            <button class="btn btn-xs" v-for="iv in intervals" :key="iv"
              :class="{ 'btn-primary': chartInterval === iv }" @click="loadChart(chartSymbol, iv)">{{ iv === 'tick' ? '分时' : iv }}</button>
          </div>
          <button class="btn btn-xs" @click="ui.showTickStream = !ui.showTickStream">{{ ui.showTickStream ? '隐藏逐笔' : '逐笔' }}</button>
        </div>

        <div class="trading-main">
          <div class="trading-center panel">
            <div class="kline-wrap">
              <div class="kline-container" ref="klineEl"></div>
              <div v-if="chartEmpty" class="chart-empty-overlay">
                <div>{{ chartEmptyHint }}</div>
                <div v-if="chartEmptySub" class="hint-sub">{{ chartEmptySub }}</div>
                <div v-if="chartEmptyActions" class="chart-empty-actions">
                  <button class="btn btn-xs btn-primary" @click="goDataDownload">下载历史数据</button>
                  <button class="btn btn-xs" @click="goDataRecorder">查看录制状态</button>
                </div>
              </div>
            </div>
            <tick-stream-drawer :open="ui.showTickStream" :symbol="chartSymbol" @close="ui.showTickStream = false" />
          </div>

          <div class="trading-right panel">
            <div class="panel-header"><span class="panel-title">五档盘口</span></div>
            <div class="depth-panel" v-if="symbolTick">
              <div class="depth-asks">
                <div v-for="i in depthAskLevels" :key="'a'+i" class="depth-row" @click="setPrice('ask', i)">
                  <span class="depth-label">卖{{ i }}</span>
                  <span class="depth-price ask">{{ fmtPrice(symbolTick['ask_price_'+i]) }}</span>
                  <span class="depth-vol">{{ fmtVol(symbolTick['ask_volume_'+i]) }}</span>
                </div>
              </div>
              <div class="depth-mid">
                <span class="depth-last" :class="chgCls(symbolTick)">{{ fmtPrice(symbolTick.last_price) }}</span>
              </div>
              <div class="depth-bids">
                <div v-for="i in depthBidLevels" :key="'b'+i" class="depth-row" @click="setPrice('bid', i)">
                  <span class="depth-label">买{{ i }}</span>
                  <span class="depth-price bid">{{ fmtPrice(symbolTick['bid_price_'+i]) }}</span>
                  <span class="depth-vol">{{ fmtVol(symbolTick['bid_volume_'+i]) }}</span>
                </div>
              </div>
            </div>
            <div v-else class="depth-empty">{{ chartSymbol ? '等待 ' + chartSymbol + ' 行情…' : '选择合约后显示盘口' }}</div>

            <div class="panel-header order-header"><span class="panel-title">三键下单</span></div>
            <div class="panel-body ths-order-panel">
              <div class="order-contract-card" v-if="form.symbol">
                <div class="occ-body contract-label-col">
                  <template v-if="isIndexOption(form.symbol)">
                    <span class="option-line">{{ contractLabel(form.symbol) }}</span>
                    <span class="option-line">{{ contractSubLabel(form.symbol) }}</span>
                    <span class="option-code">{{ contractCodeLine(form.symbol) }}</span>
                  </template>
                  <template v-else>
                    <div class="occ-name">{{ contractLabel(form.symbol) }}</div>
                    <div class="occ-code">{{ form.symbol }}</div>
                  </template>
                </div>
              </div>

              <div v-else class="contract-picker-panel">
                <p class="cp-panel-hint">请从左侧自选选择，或在此选择合约</p>
                <contract-picker compact @pick="applySymbol" />
              </div>

              <div class="ths-pos-bar" v-if="form.symbol">
                <span>持多 <b class="up">{{ longPos?.volume || 0 }}</b></span>
                <span>持空 <b class="down">{{ shortPos?.volume || 0 }}</b></span>
              </div>

              <div class="ths-price-modes">
                <button v-for="m in priceModes" :key="m.id" class="ths-mode-btn"
                  :class="{ active: priceMode === m.id }" @click="setPriceMode(m.id)">{{ m.label }}</button>
              </div>

              <div class="ths-stepper">
                <span class="ths-stepper-label">价格</span>
                <button type="button" class="ths-step-btn" @click="stepPrice(-1)" :disabled="priceMode !== 'limit'">−</button>
                <input v-model="form.price" class="ths-step-input" :readonly="priceMode !== 'limit'" placeholder="价格">
                <button type="button" class="ths-step-btn" @click="stepPrice(1)" :disabled="priceMode !== 'limit'">+</button>
              </div>
              <div class="ths-stepper">
                <span class="ths-stepper-label">数量</span>
                <button type="button" class="ths-step-btn" @click="stepVolume(-1)">−</button>
                <input v-model="form.volume" class="ths-step-input" type="number" min="1" @change="saveDefaultVolume">
                <button type="button" class="ths-step-btn" @click="stepVolume(1)">+</button>
              </div>

              <div class="ths-three-keys">
                <button type="button" class="ths-key ths-key-buy" @click="threeKeyOpen('LONG')" :disabled="!canOrder">
                  <span class="ths-key-name">{{ keyLabels.buy }}</span>
                  <span class="ths-key-price">{{ fmtPrice(keyPrice('LONG')) }}</span>
                </button>
                <button type="button" class="ths-key ths-key-sell" @click="threeKeyOpen('SHORT')" :disabled="!canOrder">
                  <span class="ths-key-name">{{ keyLabels.sell }}</span>
                  <span class="ths-key-price">{{ fmtPrice(keyPrice('SHORT')) }}</span>
                </button>
                <div class="ths-key-close-col">
                  <button v-if="longPos" type="button" class="ths-key ths-key-close" @click="threeKeyClose('LONG')">
                    <span class="ths-key-name">平多</span>
                    <span class="ths-key-sub">{{ longPos.volume }}手</span>
                  </button>
                  <button v-if="shortPos" type="button" class="ths-key ths-key-close" @click="threeKeyClose('SHORT')">
                    <span class="ths-key-name">平空</span>
                    <span class="ths-key-sub">{{ shortPos.volume }}手</span>
                  </button>
                  <button v-if="!longPos && !shortPos" type="button" class="ths-key ths-key-close ths-key-disabled" disabled>
                    <span class="ths-key-name">平仓</span>
                    <span class="ths-key-sub">无持仓</span>
                  </button>
                </div>
              </div>
              <div class="ths-hint">F1 {{ keyLabels.buy }} · F2 {{ keyLabels.sell }} · F3 平仓</div>
            </div>
          </div>
        </div>

        <bottom-dock :height="ui.bottomDockHeight" :active-symbol="chartSymbol"
          @resize="h => { ui.bottomDockHeight = h; }"
          @cancel-all="cancelAll" @close-all="closeAll"
          @cancel-order="cancelOrder" @close-pos="closePos" @edit-order="editOrder"
          @select-symbol="applySymbol" />
      </template>
    </div>`,
  setup() {
    const klineEl = ref(null);
    let chartInstance = null;
    let chartResizeObs = null;
    let chartBars = [];
    let timeshareState = null;
    const chartSymbol = ref('');
    const chartInterval = ref('1m');
    const chartMode = ref('candle');
    const chartEmpty = ref(true);
    const chartEmptyHint = ref('在左侧自选点击合约');
    const chartEmptySub = ref('');
    const priceMode = ref('opponent');
    const priceFlashCls = ref('');
    const priceModes = [
      { id: 'opponent', label: '对手价' },
      { id: 'queue', label: '排队价' },
      { id: 'last', label: '最新价' },
      { id: 'limit', label: '指定价' },
    ];
    const intervals = ['tick', '1m', '5m', '15m', '1h', 'd'];
    /** 卖盘自上而下：卖五→卖一（卖一贴近现价） */
    const depthAskLevels = [5, 4, 3, 2, 1];
    const depthBidLevels = [1, 2, 3, 4, 5];
    const tradingPrefs = $loadTradingPrefs();
    const form = reactive({
      exchange: '', product: '', symbol: '', direction: 'LONG', offset: 'OPEN',
      orderType: 'LIMIT', price: '', volume: String(tradingPrefs.defaultVolume || 1), gateway: '',
    });

    const showOnboarding = computed(() => $onboardingStep() > 0);
    const symbolTick = computed(() => $lookupTick(chartSymbol.value));
    const activeTick = symbolTick;
    const chartModeLabel = computed(() => chartMode.value === 'timeshare' ? '分时' : 'K线');
    const canOrder = computed(() => form.symbol && Number(form.volume) > 0);
    const symbolPositions = computed(() =>
      Object.values(store.position).filter(p => (p.vt_symbol || '') === form.symbol));
    const longPos = computed(() => symbolPositions.value.find(p => p.direction === 'LONG'));
    const shortPos = computed(() => symbolPositions.value.find(p => p.direction === 'SHORT'));
    const keyLabels = computed(() => $threeKeyLabels(longPos.value?.volume || 0, shortPos.value?.volume || 0));

    function contractLabel(vt) { return $contractLabel(vt); }
    function contractSubLabel(vt) { return $contractSubLabel(vt); }
    function contractCodeLine(vt) { return $contractCodeLine(vt); }
    function isIndexOption(vt) { return $isIndexOption(vt); }

    function syncFormPrice(dir) {
      const t = $lookupTick(form.symbol);
      if (!t || priceMode.value === 'limit') return;
      const p = $resolveOrderPrice(t, dir || 'LONG', priceMode.value, form.price);
      if (p) form.price = String(p);
      form.orderType = priceMode.value === 'market' ? 'MARKET' : 'LIMIT';
    }

    function setPriceMode(mode) {
      priceMode.value = mode;
      syncFormPrice('LONG');
    }

    function keyPrice(dir) {
      const t = $lookupTick(form.symbol);
      if (!t) return 0;
      if (priceMode.value === 'limit') return parseFloat(form.price) || 0;
      return $resolveOrderPrice(t, dir, priceMode.value, form.price);
    }

    function stepPrice(delta) {
      if (priceMode.value !== 'limit') return;
      const step = $priceTickStep(form.symbol);
      const cur = parseFloat(form.price) || keyPrice('LONG') || 0;
      form.price = String(Math.max(0, +(cur + delta * step).toFixed(4)));
    }

    function stepVolume(delta) {
      const cur = parseInt(form.volume, 10) || 1;
      form.volume = String(Math.max(1, cur + delta));
      saveDefaultVolume();
    }

    function ensureChart() {
      if (!klineEl.value) return false;
      if (chartInstance) {
        try { chartInstance.resize(); } catch (e) {
          chartInstance.dispose();
          chartInstance = null;
        }
        if (chartInstance) return true;
      }
      chartInstance = $echartsInit(klineEl.value);
      chartInstance.setOption($chartBaseOption('candle'), true);
      if (typeof ResizeObserver !== 'undefined') {
        chartResizeObs = new ResizeObserver(() => { try { chartInstance?.resize(); } catch (e) { /* ignore */ } });
        chartResizeObs.observe(klineEl.value);
      }
      window.addEventListener('resize', () => { try { chartInstance?.resize(); } catch (e) { /* ignore */ } });
      return true;
    }

    function refreshMarkLines() {
      if (!chartInstance || !chartSymbol.value) return;
      if (chartMode.value === 'timeshare' && timeshareState) {
        $updateTimeshareMarkLines(chartInstance, timeshareState, chartSymbol.value);
        return;
      }
      $updateChartMarkLines(chartInstance, chartSymbol.value);
    }

    function clearChartView() {
      chartBars = [];
      timeshareState = null;
      chartEmpty.value = true;
      chartEmptyHint.value = chartSymbol.value ? `暂无 ${chartSymbol.value} 行情数据` : '在左侧自选点击合约';
      chartEmptySub.value = '';
      if (chartInstance) $clearChart(chartInstance);
    }

    async function loadTimeshare(vtSymbol) {
      if (!ensureChart()) return;
      vtSymbol = $normalizeVt(vtSymbol);
      const { symbol, exchange } = $parseVtSymbol(vtSymbol);
      const ex = exchange || form.exchange || 'CFFEX';
      chartMode.value = 'timeshare';
      chartEmptyHint.value = `加载 ${vtSymbol} 分时…`;
      chartEmptySub.value = '';
      chartEmpty.value = true;

      try {
        const bars = await $fetchIntradayBars(symbol, ex);
        const tick = $lookupTick(vtSymbol);
        const preClose = tick?.pre_close || tick?.open_price || bars[0]?.open;
        timeshareState = $buildTimeshareState(bars, ex, preClose, tick, vtSymbol);
        if (!timeshareState) {
          chartEmptyHint.value = `暂无 ${vtSymbol} 分时数据`;
          chartEmptySub.value = '请确认已连接网关并订阅行情';
          chartEmpty.value = true;
          if (chartInstance) $clearChart(chartInstance);
          return;
        }
        $applyTimeshareChart(chartInstance, timeshareState, vtSymbol);
        chartEmpty.value = !timeshareState.hasAnyData;
        if (chartEmpty.value) {
          chartEmptyHint.value = `等待 ${vtSymbol} 分时成交…`;
          chartEmptySub.value = timeshareState.sessionDate ? `交易日 ${timeshareState.sessionDate}` : '';
        }
        nextTick(() => chartInstance?.resize());
      } catch (e) {
        console.error('loadTimeshare:', e);
        chartEmptyHint.value = `加载分时失败`;
        chartEmptySub.value = String(e.message || e);
        chartEmpty.value = true;
      }
    }

    function updateTimeshareFromTick(tick) {
      if (!timeshareState || !tick || !$tickMatchesVt(tick, chartSymbol.value)) return;
      const changed = $applyTickToTimeshareState(timeshareState, tick);
      if (!changed || !chartInstance) return;
      $patchTimeshareChart(chartInstance, timeshareState, chartSymbol.value);
      chartEmpty.value = !timeshareState.hasAnyData;
      if (!chartEmpty.value) chartEmptySub.value = '';
    }

    function renderCandles(bars) {
      if (!ensureChart() || !bars.length) return false;
      chartBars = bars.slice();
      chartMode.value = 'candle';
      timeshareState = null;
      chartEmptySub.value = '';
      $applyCandleChart(chartInstance, chartBars, chartSymbol.value);
      chartEmpty.value = false;
      nextTick(() => chartInstance?.resize());
      return true;
    }

    async function applySymbol(vt) {
      if (!vt) return;
      vt = $normalizeVt(vt);
      chartSymbol.value = vt;
      clearChartView();
      $setActiveSymbol(vt);
      form.exchange = vt.split('.')[1] || form.exchange;
      form.product = $productFromVt(vt);
      form.symbol = vt;
      form.offset = 'OPEN';
      setPriceMode(priceMode.value);
      $fetchContractName(vt);
      persistContract();
      const { symbol, exchange } = $parseVtSymbol(vt);
      if (store.connectedGateways.length) {
        const subSym = $resolveSubscribeSymbol(vt);
        store.connectedGateways.forEach(gw => $restSubscribe(subSym, exchange, gw));
      }
      await nextTick();
      await loadChart(vt, chartInterval.value);
    }

    async function loadChart(vtSymbol, interval) {
      if (!vtSymbol) return;
      vtSymbol = $normalizeVt(vtSymbol);
      chartSymbol.value = vtSymbol;
      chartInterval.value = interval || '1m';

      if (interval === 'tick') {
        await loadTimeshare(vtSymbol);
        persistContract();
        return;
      }

      chartMode.value = 'candle';
      timeshareState = null;

      const { symbol, exchange } = $parseVtSymbol(vtSymbol);
      const ex = exchange || form.exchange || 'CFFEX';
      const apiInterval = CHART_INTERVAL_API[interval] || '1m';

      try {
        const resp = await $apiGet(`/api/bars?symbol=${encodeURIComponent(symbol)}&exchange=${encodeURIComponent(ex)}&interval=${encodeURIComponent(apiInterval)}&start=&end=`);
        let bars = Array.isArray(resp) ? resp : (resp.bars || []);
        const aggN = AGGREGATE_N[interval];
        if (aggN && bars.length) bars = $aggregateBars(bars, aggN);
        if (bars.length) {
          renderCandles(bars);
        } else {
          const tick = $lookupTick(vtSymbol);
          const seed = tick ? $tickToSeedBar(tick) : null;
          if (seed) {
            renderCandles([seed]);
            chartEmptySub.value = '历史 K 线为空，仅显示最新价';
          } else {
            chartEmptyHint.value = `暂无 ${vtSymbol} ${interval} K 线`;
            chartEmptySub.value = '请确认 DataRecorder 已录制或数据库有历史数据';
            clearChartView();
          }
        }
      } catch (e) {
        console.error('loadChart:', e);
        clearChartView();
      }
      persistContract();
    }

    function onTickUpdate(tick) {
      if (!tick || !$tickMatchesVt(tick, chartSymbol.value)) return;
      if (priceMode.value !== 'limit') syncFormPrice('LONG');
      if (tradingPrefs.priceFlash) {
        const dir = store.tickPulse?.dir === 'down' ? 'flash-down' : 'flash-up';
        priceFlashCls.value = dir;
        setTimeout(() => { priceFlashCls.value = ''; }, 350);
      }
      if (chartMode.value === 'timeshare' || chartInterval.value === 'tick') {
        updateTimeshareFromTick(tick);
        return;
      }
      if (!chartInstance) return;
      if (!chartBars.length) {
        const seed = $tickToSeedBar(tick);
        if (seed) renderCandles([seed]);
        return;
      }
      const last = chartBars[chartBars.length - 1];
      chartBars[chartBars.length - 1] = {
        ...last,
        datetime: last.datetime || tick.datetime || tick.time,
        close: tick.last_price,
        close_price: tick.last_price,
        high: Math.max(last.high ?? last.high_price ?? tick.last_price, tick.last_price),
        high_price: Math.max(last.high ?? last.high_price ?? tick.last_price, tick.last_price),
        low: Math.min(last.low ?? last.low_price ?? tick.last_price, tick.last_price),
        low_price: Math.min(last.low ?? last.low_price ?? tick.last_price, tick.last_price),
        volume: (last.volume || 0) + (tick.last_volume || 0),
      };
      $patchCandleChart(chartInstance, chartBars, chartSymbol.value);
      chartEmpty.value = false;
    }

    function persistContract() {
      if (!form.symbol) return;
      $saveTradingContract({
        symbol: form.symbol,
        exchange: form.exchange || form.symbol.split('.')[1] || '',
        product: form.product || $productFromVt(form.symbol),
        chartInterval: chartInterval.value,
      });
    }

    function saveDefaultVolume() {
      $saveTradingPrefs({ defaultVolume: parseInt(form.volume, 10) || 1 });
    }

    async function sendOrder(dir, offset, label, volumeOverride) {
      if (!form.symbol) return;
      const vol = volumeOverride ?? (parseInt(form.volume, 10) || 1);
      if (vol <= 0) return;
      const { symbol, exchange } = $parseVtSymbol(form.symbol);
      const t = $lookupTick(form.symbol);
      const price = offset === 'OPEN'
        ? $resolveOrderPrice(t, dir, priceMode.value, form.price)
        : (priceMode.value === 'market' ? 0 : $resolveOrderPrice(t, dir === 'LONG' ? 'SHORT' : 'LONG', priceMode.value, form.price));
      const orderType = (offset !== 'OPEN' && priceMode.value === 'market') || priceMode.value === 'market'
        ? 'MARKET' : 'LIMIT';
      if ($loadTradingPrefs().orderConfirm) {
        const px = orderType === 'MARKET' ? '市价' : price;
        const ok = confirm(`确认${label}\n${vol}手 @ ${px}`);
        if (!ok) return;
      }
      saveDefaultVolume();
      await $restSendOrder({
        symbol, exchange: exchange || form.exchange, direction: dir, offset,
        price: orderType === 'MARKET' ? 0 : price, volume: vol, order_type: orderType,
        reference: 'ThreeKey', gateway: form.gateway || '',
      });
    }

    async function threeKeyOpen(dir) {
      if (!canOrder.value) return;
      await sendOrder(dir, 'OPEN', keyLabels.value[dir === 'LONG' ? 'buy' : 'sell']);
    }

    async function threeKeyClose(posDir) {
      const pos = posDir === 'LONG' ? longPos.value : shortPos.value;
      if (!pos) { $toast('当前方向无持仓', 'info'); return; }
      const vol = Math.min(parseInt(form.volume, 10) || 1, pos.volume);
      const closeDir = posDir === 'LONG' ? 'SHORT' : 'LONG';
      const off = $defaultCloseOffset(form.exchange || pos.exchange);
      await sendOrder(closeDir, off, posDir === 'LONG' ? '平多' : '平空', vol);
    }

    async function placeOrder(dir) { await threeKeyOpen(dir); }

    function setPrice(side, i) {
      const t = symbolTick.value;
      if (!t) return;
      priceMode.value = 'limit';
      form.orderType = 'LIMIT';
      const key = `${side}_price_${i}`;
      form.price = String(t[key] || '');
    }

    function editOrder(o) {
      const np = prompt('新价格（留空取消）', String(o.price || ''));
      if (np === null || np === '') return;
      cancelOrder(o);
      setTimeout(async () => {
        const { symbol, exchange } = $parseVtSymbol(o.vt_symbol || form.symbol);
        await $restSendOrder({
          symbol, exchange: exchange || o.exchange,
          direction: o.direction, offset: o.offset,
          price: parseFloat(np) || 0, volume: (o.volume || 1) - (o.traded || 0),
          order_type: 'LIMIT', reference: 'Amend', gateway: o.gateway_name || '',
        });
      }, 300);
    }

    function cancelOrder(o) { $restCancelOrder(o.orderid || o.vt_orderid, o.symbol, o.exchange, o.gateway_name || ''); }

    async function restoreTradingContract() {
      const vt = ui.activeSymbol || $loadTradingContract()?.symbol;
      if (!vt) return;
      const saved = $loadTradingContract();
      if (saved?.chartInterval) chartInterval.value = saved.chartInterval;
      await applySymbol(vt);
    }
    function cancelAll() { Object.values(store.order).forEach(o => { if ($isActiveOrder(o)) cancelOrder(o); }); }
    function closeAll() {
      Object.values(store.position).forEach(p => {
        const { symbol, exchange } = $parseVtSymbol(p.vt_symbol);
        $restSendOrder({ symbol, exchange: exchange || p.exchange, direction: p.direction === 'LONG' ? 'SHORT' : 'LONG',
          offset: $defaultCloseOffset(p.exchange), price: 0, volume: p.volume, order_type: 'MARKET', reference: 'QuickClose', gateway: '' });
      });
    }
    function closePos(pos) {
      const { symbol, exchange } = $parseVtSymbol(pos.vt_symbol);
      $restSendOrder({ symbol, exchange: exchange || pos.exchange, direction: pos.direction === 'LONG' ? 'SHORT' : 'LONG',
        offset: $defaultCloseOffset(pos.exchange), price: 0, volume: pos.volume, order_type: 'MARKET', reference: 'QuickClose', gateway: '' });
    }
    function addDefaultWatchlist() {
      $defaultWatchlistItems().forEach(i => $addToWatchlist(i.vt_symbol));
      $invokeWatchlistSubscribe();
      $preloadWatchlistNames();
    }
    function focusWatchlist() { if (ui.watchlist.length) applySymbol(ui.watchlist[0].vt_symbol); }

    watch(showOnboarding, v => { if (!v) nextTick(() => { ensureChart(); restoreTradingContract(); }); });
    watch(() => ui.activeSymbol, vt => {
      if (!vt) {
        chartSymbol.value = '';
        form.symbol = '';
        clearChartView();
        return;
      }
      if (vt !== chartSymbol.value) applySymbol(vt);
    });
    watch(() => store.tickPulse?.n, () => {
      const vt = store.tickPulse?.vt;
      if (!vt || !$tickMatchesVt({ vt_symbol: vt }, chartSymbol.value)) return;
      const t = $lookupTick(chartSymbol.value);
      if (t) onTickUpdate(t);
    });
    watch(() => [store.position, store.order, store.backtestMarkers], refreshMarkLines, { deep: true });
    watch(() => store.connectedGateways.join(','), (key, prev) => {
      if (!key || key === prev) return;
      $invokeWatchlistSubscribe();
      $queryTradingSnapshot();
      if (form.symbol) {
        const { symbol, exchange } = $parseVtSymbol(form.symbol);
        $restSubscribe(symbol, exchange, form.gateway);
      }
    });

    function reloadChartForTheme() {
      if (!chartInstance) return;
      const sym = chartSymbol.value;
      const mode = chartMode.value;
      const bars = chartBars.slice();
      const ts = timeshareState;
      chartInstance.dispose();
      chartInstance = null;
      if (!ensureChart()) return;
      if (mode === 'timeshare' && ts) {
        $applyTimeshareChart(chartInstance, ts, sym);
      } else if (bars.length) {
        $applyCandleChart(chartInstance, bars, sym);
      } else {
        chartInstance.setOption($chartBaseOption('candle'), true);
      }
    }

    onMounted(() => {
      window.__applyTradingSymbol = applySymbol;
      window.__jumpToSymbol = vt => { applySymbol(vt); };
      nextTick(async () => {
        if (!showOnboarding.value) { ensureChart(); await restoreTradingContract(); }
        $preloadWatchlistNames();
      });
      window.__tradingPlaceOrder = placeOrder;
      window.__tradingCloseOrder = () => {
        if (longPos.value) threeKeyClose('LONG');
        else if (shortPos.value) threeKeyClose('SHORT');
        else $toast('请先选择持仓', 'info');
      };
      window.addEventListener('dq-theme-change', reloadChartForTheme);
    });
    const chartEmptyActions = computed(() =>
      chartEmpty.value && !!chartSymbol.value && !!chartEmptySub.value
    );

    function goDataDownload() {
      const parsed = $parseVtSymbol(chartSymbol.value);
      $openDataTab({
        sub: 'local',
        symbol: parsed.symbol,
        exchange: parsed.exchange,
        interval: chartInterval.value === 'tick' ? '1m' : chartInterval.value,
        vt_symbol: chartSymbol.value,
        action: 'update',
      });
    }

    function goDataRecorder() {
      $openDataTab({ sub: 'recorder' });
    }

    onUnmounted(() => {
      window.removeEventListener('dq-theme-change', reloadChartForTheme);
      chartResizeObs?.disconnect();
      if (chartInstance) { chartInstance.dispose(); chartInstance = null; }
      window.__tradingPlaceOrder = null;
      window.__tradingCloseOrder = null;
      window.__applyTradingSymbol = null;
      window.__jumpToSymbol = null;
    });

    return {
      ui, klineEl, chartSymbol, chartInterval, chartMode, chartModeLabel, chartEmpty, chartEmptyHint, chartEmptySub, chartEmptyActions,
      goDataDownload, goDataRecorder,
      symbolTick, priceMode, priceModes,
      form, intervals, depthAskLevels, depthBidLevels, priceFlashCls,
      showOnboarding, activeTick, canOrder, longPos, shortPos, keyLabels,
      contractLabel, contractSubLabel, contractCodeLine, isIndexOption,
      loadChart, applySymbol,
      threeKeyOpen, threeKeyClose, placeOrder, cancelOrder, cancelAll, closeAll, closePos, editOrder,
      setPriceMode, stepPrice, stepVolume, keyPrice, setPrice, saveDefaultVolume,
      addDefaultWatchlist, focusWatchlist,
      store, fmtPrice: $fmtPrice, fmtVol: $fmtVol, chgCls: $chgCls, chgText: $chgText, chgAbs: $chgAbs,
    };
  },
};
