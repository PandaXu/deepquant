// ===== 通用确认弹窗 =====

const ConfirmModal = {
  props: {
    open: Boolean,
    title: { type: String, default: '确认' },
    message: { type: String, default: '' },
    confirmLabel: { type: String, default: '确定' },
    cancelLabel: { type: String, default: '取消' },
    danger: Boolean,
  },
  emits: ['confirm', 'cancel'],
  template: `
    <div v-if="open" class="modal-overlay" @click.self="$emit('cancel')">
      <div class="modal confirm-modal">
        <div class="modal-header">
          <span>{{ title }}</span>
          <button type="button" class="btn btn-xs" @click="$emit('cancel')">✕</button>
        </div>
        <div class="modal-body">
          <p class="confirm-modal-msg">{{ message }}</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-sm" @click="$emit('cancel')">{{ cancelLabel }}</button>
          <button type="button" class="btn btn-sm" :class="danger ? 'btn-danger' : 'btn-primary'" @click="$emit('confirm')">{{ confirmLabel }}</button>
        </div>
      </div>
    </div>`,
};
