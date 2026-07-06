// ===== Tab 5: 设置中心 =====

const SETTINGS_SECTIONS = [
  { id: 'accounts', label: '连接与账户', icon: '🔌' },
  { id: 'trading', label: '交易偏好', icon: '📋' },
  { id: 'appearance', label: '外观', icon: '🎨' },
  { id: 'data', label: '数据与回测', icon: '📁' },
];

const TabSettings = {
  template: `
    <div class="stg-center">
      <settings-status-bar @go-strategy="goStrategy" />

      <div class="stg-main">
        <nav class="stg-sidebar panel">
          <button v-for="s in sections" :key="s.id" type="button"
            class="stg-nav-item" :class="{ active: section === s.id }"
            @click="setSection(s.id)">
            <span class="stg-nav-icon">{{ s.icon }}</span>
            <span>{{ s.label }}</span>
          </button>
        </nav>

        <section class="stg-content">
          <settings-accounts v-if="section === 'accounts'" />
          <settings-trading-prefs v-else-if="section === 'trading'" />
          <settings-appearance v-else-if="section === 'appearance'" />
          <settings-backtest-data v-else-if="section === 'data'" />
        </section>
      </div>
    </div>`,
  setup() {
    const sections = SETTINGS_SECTIONS;
    const section = ref('accounts');

    function syncUrl(id) {
      try {
        const url = new URL(window.location.href);
        url.searchParams.set('tab', 'settings');
        url.searchParams.set('section', id);
        window.history.replaceState({}, '', url);
      } catch (e) { /* ignore */ }
    }

    function readUrl() {
      try {
        const params = new URLSearchParams(window.location.search);
        const s = params.get('section');
        if (s && sections.some(x => x.id === s)) section.value = s;
      } catch (e) { /* ignore */ }
    }

    function setSection(id) {
      section.value = id;
      syncUrl(id);
    }

    function goStrategy() {
      window.__setActiveTab && window.__setActiveTab('strategy');
    }

    window.__setSettingsSection = (id) => {
      if (id && sections.some(x => x.id === id)) setSection(id);
    };

    onMounted(readUrl);

    return { sections, section, setSection, goStrategy };
  },
};
