// ===== 当前合约 Tick 逐笔抽屉 =====

const TickStreamDrawer = {
  props: { open: Boolean, symbol: String },
  emits: ['close'],
  template: `
    <div v-if="open && symbol" class="tick-stream-drawer">
      <div class="tsd-header">
        <span>逐笔 · {{ symbol }}</span>
        <span class="tsd-hint">最近 {{ rows.length }} 笔</span>
        <button class="btn btn-xs" @click="$emit('close')">✕</button>
      </div>
      <div class="tsd-body">
        <table class="data-table">
          <thead><tr><th>时间</th><th class="num">最新价</th><th class="num">成交量</th><th class="num">买一</th><th class="num">卖一</th></tr></thead>
          <tbody>
            <tr v-for="(r, i) in rowsRev" :key="i">
              <td class="num" style="font-size:10px">{{ timeStr(r.time) }}</td>
              <td class="num">{{ fmtPrice(r.last_price) }}</td>
              <td class="num">{{ r.volume }}</td>
              <td class="num bid">{{ fmtPrice(r.bid_price_1) }}</td>
              <td class="num ask">{{ fmtPrice(r.ask_price_1) }}</td>
            </tr>
            <tr v-if="!rows.length"><td colspan="5" class="empty">等待 tick 推送…</td></tr>
          </tbody>
        </table>
      </div>
    </div>`,
  setup(props) {
    const rows = computed(() => store.tickStream[$normalizeVt(props.symbol)] || []);
    const rowsRev = computed(() => [...rows.value].reverse().slice(0, 100));
    return { rows, rowsRev, fmtPrice: $fmtPrice, timeStr: $timeStr };
  },
};
