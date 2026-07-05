// ===== 专业名词说明（系统 info 图标，点击弹出） =====

const TermHelp = {
  name: 'TermHelp',
  props: {
    term: { type: String, required: true },
    title: { type: String, default: '' },
    text: { type: String, default: '' },
  },
  template: `
    <span v-if="show" class="term-help" @click.stop>
      <span ref="triggerEl" role="button" tabindex="0" class="term-help-icon-btn" :class="{ open: visible }"
        @click="toggle" @keydown.enter.prevent="toggle" @keydown.space.prevent="toggle"
        :aria-expanded="visible" :aria-label="'说明：' + title">
        <svg class="term-help-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.5"/>
          <path d="M12 11v5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <circle cx="12" cy="8" r="0.9" fill="currentColor"/>
        </svg>
      </span>
      <teleport to="body">
        <div v-if="visible" class="term-help-pop term-help-pop-portal" :style="popStyle"
          role="tooltip" @click.stop>
          <div class="term-help-pop-title">{{ title }}</div>
          <div class="term-help-pop-body">{{ text }}</div>
        </div>
      </teleport>
    </span>
  `,
  setup(props) {
    const { ref, computed, watch, nextTick, onMounted, onUnmounted } = Vue;
    const visible = ref(false);
    const triggerEl = ref(null);
    const popStyle = ref({});
    const entry = computed(() => $termExplain(props.term) || {});
    const title = computed(() => props.title || entry.value.title || props.term);
    const text = computed(() => props.text || entry.value.text || '');
    const show = computed(() => {
      if (props.text) return true;
      return typeof $termNeedsHelp === 'function'
        && $termNeedsHelp(props.term)
        && !!entry.value.text;
    });

    function close() { visible.value = false; }

    function updatePopPosition() {
      const el = triggerEl.value;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const w = Math.min(260, window.innerWidth * 0.72);
      let left = r.left + r.width / 2;
      const pad = 8;
      left = Math.max(pad + w / 2, Math.min(window.innerWidth - pad - w / 2, left));
      popStyle.value = {
        top: `${Math.round(r.bottom + 6)}px`,
        left: `${Math.round(left)}px`,
        width: `${Math.round(w)}px`,
      };
    }

    function toggle() {
      if (typeof $termHelpCloseAll === 'function') $termHelpCloseAll();
      visible.value = !visible.value;
      if (visible.value) {
        nextTick(() => {
          updatePopPosition();
          if (typeof $termHelpRegister === 'function') $termHelpRegister(close);
        });
      }
    }

    function onDocClick() { close(); }

    function onReposition() {
      if (visible.value) updatePopPosition();
    }

    watch(visible, (open) => {
      if (open) nextTick(updatePopPosition);
    });

    onMounted(() => {
      document.addEventListener('click', onDocClick);
      window.addEventListener('scroll', onReposition, true);
      window.addEventListener('resize', onReposition);
      window.addEventListener('dq-theme-change', onReposition);
    });
    onUnmounted(() => {
      document.removeEventListener('click', onDocClick);
      window.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('dq-theme-change', onReposition);
      if (typeof $termHelpUnregister === 'function') $termHelpUnregister(close);
    });

    return { visible, title, text, show, toggle, close, triggerEl, popStyle };
  },
};

/** 标签文字 + 可选说明图标（仅专业名词） */
const TermLabel = {
  name: 'TermLabel',
  props: {
    term: { type: String, required: true },
  },
  template: `
    <span v-if="needsHelp" class="term-label">
      <slot></slot>
      <term-help :term="term" />
    </span>
    <slot v-else></slot>
  `,
  setup(props) {
    const { computed } = Vue;
    const needsHelp = computed(() =>
      typeof $termNeedsHelp === 'function'
      && $termNeedsHelp(props.term)
      && !!($termExplain(props.term)?.text)
    );
    return { needsHelp };
  },
};

let _termHelpActiveClose = null;

function $termHelpRegister(closeFn) {
  _termHelpActiveClose = closeFn;
}

function $termHelpUnregister(closeFn) {
  if (_termHelpActiveClose === closeFn) _termHelpActiveClose = null;
}

function $termHelpCloseAll() {
  if (_termHelpActiveClose) {
    _termHelpActiveClose();
    _termHelpActiveClose = null;
  }
}
