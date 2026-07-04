// ===== 持仓 / 委托 / 成交 / 资金 底栏 =====

const BottomDock = {
  props: { height: { type: Number, default: 200 }, activeSymbol: String },
  emits: ['resize', 'cancel-all', 'close-all', 'cancel-order', 'close-pos', 'edit-order', 'select-symbol'],
  template: `
    <div class="bottom-dock" :style="{ height: height + 'px' }">
      <div class="dock-resize" @mousedown="startResize"></div>
      <div class="dock-tabs">
        <button class="dock-tab" :class="{ active: tab === 'pos' }" @click="tab = 'pos'">持仓 <span class="badge">{{ posList.length }}</span></button>
        <button class="dock-tab" :class="{ active: tab === 'order' }" @click="tab = 'order'">委托 <span class="badge">{{ activeOrders.length }}</span></button>
        <button class="dock-tab" :class="{ active: tab === 'trade' }" @click="tab = 'trade'">成交 <span class="badge">{{ tradeList.length }}</span></button>
        <button class="dock-tab" :class="{ active: tab === 'fund' }" @click="tab = 'fund'">资金</button>
        <div style="margin-left:auto;display:flex;gap:4px;padding-right:8px">
          <span v-if="posSummary.pnl !== null" class="dock-summary" :class="posSummary.pnl >= 0 ? 'up' : 'down'">
            浮盈 {{ posSummary.pnl >= 0 ? '+' : '' }}{{ fmtPrice(posSummary.pnl) }}
          </span>
          <button class="btn btn-xs" @click="$emit('cancel-all')">撤全部</button>
          <button class="btn btn-xs btn-warn" @click="$emit('close-all')">一键全平</button>
        </div>
      </div>
      <div class="dock-body">
        <table v-show="tab === 'pos'" class="data-table">
          <thead><tr>
            <th>合约</th><th class="num">方向</th><th class="num">数量</th><th class="num">均价</th><th class="num">盈亏</th><th class="num">操作</th>
          </tr></thead>
          <tbody>
            <tr v-for="p in posList" :key="p.vt_positionid" :class="{ 'row-active': p.vt_symbol === activeSymbol }"
              @click="$emit('select-symbol', p.vt_symbol)">
              <td>
                <div class="contract-label-col">
                  <template v-if="isIndexOption(p.vt_symbol)">
                    <span class="option-line">{{ contractLabel(p.vt_symbol) }}</span>
                    <span class="option-line">{{ contractSubLabel(p.vt_symbol) }}</span>
                    <span class="option-code">{{ contractCodeLine(p.vt_symbol) }}</span>
                  </template>
                  <template v-else>
                    <span>{{ contractLabel(p.vt_symbol) }}</span>
                    <span class="sc-sub">{{ p.vt_symbol }}</span>
                  </template>
                </div>
              </td>
              <td :class="p.direction === 'LONG' ? 'up' : 'down'">{{ p.direction === 'LONG' ? '多' : '空' }}</td>
              <td class="num">{{ p.volume }}</td>
              <td class="num">{{ fmtPrice(p.price) }}</td>
              <td class="num" :class="pnlCls(p)">{{ fmtPrice(p.position_profit || p.pnl) }}</td>
              <td class="num" style="white-space:nowrap">
                <button class="btn btn-xs btn-warn" @click.stop="$emit('close-pos', p)">平</button>
              </td>
            </tr>
            <tr v-if="!posList.length"><td colspan="6" class="empty">暂无持仓</td></tr>
          </tbody>
        </table>
        <table v-show="tab === 'order'" class="data-table">
          <thead><tr>
            <th>合约</th><th>方向</th><th class="num">价格</th><th class="num">数量</th><th>状态</th><th>操作</th>
          </tr></thead>
          <tbody>
            <tr v-for="o in orderList" :key="o.orderid || o.vt_orderid">
              <td>
                <div class="contract-label-col">
                  <template v-if="isIndexOption(o.vt_symbol)">
                    <span class="option-line">{{ contractLabel(o.vt_symbol) }}</span>
                    <span class="option-line">{{ contractSubLabel(o.vt_symbol) }}</span>
                    <span class="option-code">{{ contractCodeLine(o.vt_symbol) }}</span>
                  </template>
                  <template v-else>
                    <span>{{ contractLabel(o.vt_symbol) }}</span>
                  </template>
                </div>
              </td>
              <td>{{ o.direction }}/{{ o.offset }}</td>
              <td class="num">{{ fmtPrice(o.price) }}</td>
              <td class="num">{{ o.volume }}</td>
              <td>{{ statusText(o.status) }}</td>
              <td>
                <button v-if="isActive(o)" class="btn btn-xs" @click="$emit('edit-order', o)">改价</button>
                <button v-if="isActive(o)" class="btn btn-xs btn-danger" @click="$emit('cancel-order', o)">撤</button>
              </td>
            </tr>
            <tr v-if="!orderList.length"><td colspan="6" class="empty">暂无委托</td></tr>
          </tbody>
        </table>
        <table v-show="tab === 'trade'" class="data-table">
          <thead><tr><th>合约</th><th>方向</th><th class="num">价格</th><th class="num">数量</th><th>时间</th></tr></thead>
          <tbody>
            <tr v-for="t in tradeList" :key="t.tradeid">
              <td>
                <div class="contract-label-col">
                  <template v-if="isIndexOption(t.vt_symbol)">
                    <span class="option-line">{{ contractLabel(t.vt_symbol) }}</span>
                    <span class="option-line">{{ contractSubLabel(t.vt_symbol) }}</span>
                    <span class="option-code">{{ contractCodeLine(t.vt_symbol) }}</span>
                  </template>
                  <template v-else>
                    <span>{{ contractLabel(t.vt_symbol) }}</span>
                  </template>
                </div>
              </td>
              <td>{{ t.direction }}</td>
              <td class="num">{{ fmtPrice(t.price) }}</td>
              <td class="num">{{ t.volume }}</td>
              <td class="num">{{ timeStr(t.trade_time || t.time) }}</td>
            </tr>
            <tr v-if="!tradeList.length"><td colspan="5" class="empty">暂无成交</td></tr>
          </tbody>
        </table>
        <table v-show="tab === 'fund'" class="data-table">
          <thead><tr><th>账户</th><th class="num">权益</th><th class="num">可用</th><th class="num">冻结</th><th>网关</th></tr></thead>
          <tbody>
            <tr v-for="a in accountList" :key="a.vt_accountid">
              <td>{{ a.vt_accountid }}</td>
              <td class="num">{{ fmtPrice(a.balance) }}</td>
              <td class="num">{{ fmtPrice(a.available) }}</td>
              <td class="num">{{ fmtPrice(a.frozen) }}</td>
              <td>{{ a.gateway_name }}</td>
            </tr>
            <tr v-if="!accountList.length"><td colspan="5" class="empty">暂无账户数据</td></tr>
          </tbody>
        </table>
      </div>
    </div>`,
  setup(props, { emit }) {
    const tab = ref('pos');
    const posList = computed(() => Object.values(store.position));
    const orderList = computed(() => Object.values(store.order).sort((a, b) =>
      (b.order_time || 0) - (a.order_time || 0)));
    const tradeList = computed(() => Object.values(store.trade).sort((a, b) =>
      (b.trade_time || 0) - (a.trade_time || 0)));
    const activeOrders = computed(() => orderList.value.filter($isActiveOrder));
    const accountList = computed(() => Object.values(store.account));
    const posSummary = computed(() => {
      let pnl = 0;
      posList.value.forEach(p => { pnl += Number(p.position_profit || p.pnl || 0); });
      return { pnl: posList.value.length ? pnl : null };
    });

    function startResize(e) {
      e.preventDefault();
      const startY = e.clientY;
      const startH = props.height;
      function onMove(ev) { emit('resize', Math.min(480, Math.max(120, startH + (startY - ev.clientY)))); }
      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        $saveUiPrefs({ bottomDockHeight: props.height });
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    }

    return {
      tab, posList, orderList, tradeList, activeOrders, accountList, posSummary, startResize,
      fmtPrice: $fmtPrice, timeStr: $timeStr, statusText: $orderStatusText,
      isActive: $isActiveOrder, pnlCls: $pnlCls, contractLabel: $contractLabel,
      contractSubLabel: $contractSubLabel, contractCodeLine: $contractCodeLine, isIndexOption: $isIndexOption,
    };
  },
};
