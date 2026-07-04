// ===== 添加自选弹窗（选择模式） =====

const AddWatchlistModal = {
  props: { open: Boolean },
  emits: ['close', 'add'],
  template: `
    <div v-if="open" class="modal-overlay" @click.self="close">
      <div class="modal add-watchlist-modal">
        <div class="modal-header">
          <span>添加自选</span>
          <button type="button" class="btn btn-xs" @click="close">✕</button>
        </div>
        <div class="modal-body">
          <contract-picker ref="pickerRef" v-model="pendingVt" @pick="onPick" />
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-sm" @click="close">取消</button>
          <button type="button" class="btn btn-sm btn-primary" :disabled="!pendingVt" @click="confirm">添加自选</button>
        </div>
      </div>
    </div>`,
  setup(props, { emit }) {
    const pendingVt = ref('');
    const pickerRef = ref(null);

    watch(() => props.open, (v) => {
      if (v) {
        pendingVt.value = '';
        nextTick(() => pickerRef.value?.reset?.());
      }
    });

    function close() { emit('close'); }

    function onPick(vt) { pendingVt.value = vt; }

    function confirm() {
      if (!pendingVt.value) {
        $toast('请选择合约', 'error');
        return;
      }
      emit('add', pendingVt.value);
    }

    return { pendingVt, pickerRef, close, onPick, confirm };
  },
};
