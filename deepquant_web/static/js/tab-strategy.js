// ===== Tab 3: 策略中心 v2 — 主从布局 + 生命周期流水线 =====

const TabStrategy = {
  template: `
    <div class="st-center">
      <!-- KPI 概览 -->
      <div class="st-kpi-row">
        <div class="st-kpi"><span class="st-kpi-val">{{ summary.total }}</span><span class="st-kpi-lbl">策略实例</span></div>
        <div class="st-kpi accent-green"><span class="st-kpi-val">{{ summary.running }}</span><span class="st-kpi-lbl">实盘中</span></div>
        <div class="st-kpi accent-blue"><span class="st-kpi-val">{{ summary.inited }}</span><span class="st-kpi-lbl">待启动</span></div>
        <div class="st-kpi"><span class="st-kpi-val">{{ summary.pos_exposure || 0 }}</span><span class="st-kpi-lbl"><term-label term="pos_exposure">总敞口(手)</term-label></span></div>
        <div class="st-kpi" :class="{ 'accent-warn': summary.gateway_alerts }">
          <span class="st-kpi-val">{{ summary.gateway_alerts || 0 }}</span><span class="st-kpi-lbl"><term-label term="gateway_alert">网关告警</term-label></span>
        </div>
        <div class="st-kpi-actions">
          <button class="btn btn-sm" @click="showEncyclopedia = true">策略百科</button>
          <button class="btn btn-sm btn-primary" @click="openCreate">+ 部署实例</button>
          <button class="btn btn-sm" @click="refreshAll">刷新</button>
        </div>
      </div>

      <div class="st-main">
        <!-- 左侧：实例列表 -->
        <aside class="st-sidebar">
          <div class="st-filter-tabs">
            <button v-for="f in filterTabs" :key="f.id" class="st-filter-tab"
              :class="{ active: listFilter === f.id }" @click="listFilter = f.id">{{ f.label }}</button>
          </div>
          <div class="st-list">
              <div v-for="s in filteredList" :key="s.strategy_name"
              class="st-list-item" :class="{ active: selected?.strategy_name === s.strategy_name }"
              @click="selectStrategy(s)">
              <div class="st-li-top">
                <span class="st-li-name">{{ s.strategy_name }}</span>
                <span :class="'st-pill status-' + normStatus(s.status).toUpperCase()">{{ strategyStatus(s.status) }}</span>
              </div>
              <div class="st-li-sub">{{ strategyLabel(s.class_name) }} · {{ contractLabel(s.vt_symbol) || s.vt_symbol }}</div>
              <div class="st-li-meta" v-if="s.variables?.pos != null">持仓 {{ s.variables.pos }}</div>
            </div>
            <div v-if="!filteredList.length" class="empty st-empty">暂无实例</div>
          </div>
        </aside>

        <!-- 右侧：详情 / 空状态 -->
        <section class="st-detail" v-if="selected">
          <div class="st-detail-head">
            <div>
              <h2 class="st-title">{{ selected.strategy_name }}</h2>
              <div class="st-subtitle">{{ strategyLabel(selected.class_name) }} · {{ selected.vt_symbol }}</div>
            </div>
            <div class="st-head-actions">
              <button class="btn btn-sm" :class="primaryBtnClass" @click="executeNextAction" :disabled="actionBusy || !canExecuteNext">
                {{ actionBusy ? '处理中…' : (preflight?.next_action?.label || '—') }}
              </button>
              <button v-if="normStatus(selected.status) === 'running'" class="btn btn-sm btn-warn" @click="doAction('stop')" :disabled="actionBusy">停止</button>
              <button class="btn btn-sm" @click="openBacktestDrawer">回测研究</button>
              <button class="btn btn-sm" @click="jumpToChart(selected.vt_symbol)" v-if="selected.vt_symbol">K线</button>
              <button class="btn btn-sm" @click="editStrategy" v-if="canEdit(selected)">编辑</button>
              <button class="btn btn-sm btn-danger" @click="removeStrategy" v-if="canEdit(selected)">删除</button>
            </div>
          </div>

          <!-- 生命周期进度 -->
          <div class="st-lifecycle">
            <div class="st-lc-bar"><div class="st-lc-fill" :style="{ width: lifecyclePct + '%' }"></div></div>
            <div class="st-lc-steps">
              <div v-for="(step, i) in lifecycleSteps" :key="step.id"
                class="st-lc-step" :class="{ done: i <= lifecycleIdx, current: step.id === lifecycleStep }">
                <span class="st-lc-dot"></span>
                <span class="st-lc-label">{{ step.label }}<term-help :term="step.id" /></span>
              </div>
            </div>
          </div>

          <!-- 策略原理说明 -->
          <div class="st-panel-block st-doc-section">
            <div class="st-section-title">策略原理与参数逻辑</div>
            <strategy-doc-panel
              :class-name="selected.class_name"
              :parameters="selected.parameters"
              :show-params="true"
            />
          </div>

          <!-- Preflight 检查清单 -->
          <div class="st-preflight" v-if="preflight?.checks">
            <div class="st-section-title">上线检查清单</div>
            <div class="st-check-grid">
              <div v-for="c in preflight.checks" :key="c.id" class="st-check" :class="checkStatusClass(c.status)">
                <span class="st-check-icon">{{ checkStatusIcon(c.status) }}</span>
                <div>
                  <div class="st-check-label">{{ c.label }}<term-help :term="preflightTerm(c.id)" /></div>
                  <div class="st-check-msg">{{ c.message }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- 配置 & 运行指标 -->
          <div class="st-dual-grid">
            <div class="st-panel-block">
              <div class="st-section-title">当前参数值</div>
              <table class="data-table st-mini-table">
                <tbody>
                  <tr v-for="row in docParamRows" :key="row.name">
                    <td><span>{{ row.label }}</span><div v-if="row.logic" class="st-param-hint">{{ row.logic }}</div></td>
                    <td class="num">{{ row.value }}</td>
                  </tr>
                  <tr v-if="!docParamRows.length"><td colspan="2" class="empty">无参数</td></tr>
                </tbody>
              </table>
            </div>
            <div class="st-panel-block">
              <div class="st-section-title">运行指标</div>
              <table class="data-table st-mini-table">
                <tbody>
                  <tr v-for="([k,v]) in varRows" :key="k"><td>{{ k }}</td><td class="num">{{ v }}</td></tr>
                  <tr v-if="!varRows.length"><td colspan="2" class="empty">启动后可见</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- 验证基准 / 回测快照 -->
          <div class="st-panel-block" v-if="selected.last_backtest || preflight?.latest_backtest">
            <div class="st-section-title">
              验证基准
              <span v-if="preflight?.active_backtest_id" class="st-gate-badge">Active</span>
            </div>
            <div v-if="preflight?.backtest_unprofitable && !preflight?.backtest_valid" class="st-bt-loss-banner">
              回测结果为亏损，且无有效验证基准，无法进入初始化/实盘。
            </div>
            <div v-else-if="preflight?.latest_backtest?.status === 'loss' && preflight?.backtest_valid" class="st-bt-warn-banner">
              最近回测亏损（{{ fmtPct(preflight.latest_backtest.total_return) }}），当前验证基准仍有效。
            </div>
            <div v-else-if="preflight?.backtest_stale" class="st-bt-stale">参数或合约已变更，验证基准已过期，请重新运行回测。</div>
            <div v-if="selected.last_backtest" class="st-bt-snapshot" :class="{ 'st-bt-loss': isBacktestLoss(selected.last_backtest) }">
              <term-label term="total_return">收益</term-label> {{ fmtPct(selected.last_backtest.total_return) }} ·
              <term-label term="sharpe_ratio">夏普</term-label> {{ (selected.last_backtest.sharpe_ratio||0).toFixed(2) }} ·
              <term-label term="max_drawdown">回撤</term-label> {{ fmtPct(selected.last_backtest.max_drawdown) }} ·
              <term-label term="bar_interval">周期</term-label> {{ selected.last_backtest.interval || '1m' }} ·
              {{ selected.last_backtest.run_at?.slice(0,10) || '' }}
            </div>
            <div v-else-if="preflight?.latest_backtest" class="st-bt-snapshot st-bt-loss">
              <term-label term="total_return">最近回测</term-label> {{ fmtPct(preflight.latest_backtest.total_return) }} ·
              {{ preflight.latest_backtest.created_at?.slice(0,10) || '' }}
              <span class="st-param-hint">（未设验证基准）</span>
            </div>
          </div>

          <!-- 回测存档列表 -->
          <div class="st-panel-block" v-if="selected && detailSavedList.length">
            <div class="st-section-title">
              回测存档
              <button class="btn btn-xs" @click="openBacktestDrawer">管理</button>
            </div>
            <table class="data-table st-bt-saves-table">
              <thead><tr><th>名称</th><th>状态</th><th>收益</th><th>时间</th><th></th></tr></thead>
              <tbody>
                <tr v-for="s in detailSavedList" :key="s.id" :class="{ 'row-active': s.is_active }">
                  <td>{{ s.label }}</td>
                  <td><span class="st-bt-save-tag" :class="'tag-' + s.status">{{ s.is_active ? '验证基准' : (s.status_label || s.status) }}</span></td>
                  <td :class="(s.total_return || 0) >= 0 ? 'up' : 'down'">{{ fmtPct(s.total_return) }}</td>
                  <td>{{ (s.created_at || '').slice(0, 16).replace('T', ' ') }}</td>
                  <td><button class="btn btn-xs" @click="loadSaveFromDetail(s)">查看</button></td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 内嵌日志 -->
          <div class="st-panel-block">
            <div class="st-section-title">最近日志 <button class="btn btn-xs" @click="loadLogs">刷新</button></div>
            <div class="st-log-inline">
              <div v-for="(l,i) in recentLogs" :key="i" :class="'log-line log-' + (l.level||'INFO').toLowerCase()">
                <span class="log-time">{{ (l.created_at||'').slice(11,19) }}</span> {{ l.message }}
              </div>
              <div v-if="!recentLogs.length" class="empty">暂无日志</div>
            </div>
          </div>
        </section>

        <!-- 空状态：模板画廊 -->
        <section class="st-detail st-empty-detail" v-else>
          <div class="st-empty-hero">
            <h2>策略中心</h2>
            <p>从模板快速部署实例，经「数据 → 回测 → 预热 → 实盘」流水线安全上线。</p>
          </div>
          <div class="st-template-grid">
            <div v-for="t in templates" :key="t.id" class="st-template-card" @click="deployTemplate(t)">
              <div class="st-tpl-title">{{ t.label }}</div>
              <div class="st-tpl-desc">{{ t.desc }}</div>
              <div class="st-tpl-summary">{{ docSummary(t.class_name) }}</div>
              <div class="st-tpl-meta">{{ strategyLabel(t.class_name) }} · {{ t.vt_symbol }}</div>
            </div>
          </div>
        </section>
      </div>

      <!-- 创建/编辑 抽屉 -->
      <div v-if="showForm" class="st-drawer-overlay" @click.self="closeForm">
        <div class="st-drawer">
          <div class="st-drawer-head">
            <span>{{ editing ? '编辑实例' : '部署新实例' }}</span>
            <button class="btn btn-xs" @click="closeForm">✕</button>
          </div>
          <div class="st-drawer-body" v-if="!editing && showTemplates">
            <div class="st-section-title">选择模板</div>
            <div class="st-template-grid compact">
              <div v-for="t in templates" :key="t.id" class="st-template-card" @click="applyTemplate(t)">
                <div class="st-tpl-title">{{ t.label }}</div>
                <div class="st-tpl-desc">{{ t.desc }}</div>
              </div>
              <div class="st-template-card blank" @click="showTemplates = false">
                <div class="st-tpl-title">空白实例</div>
                <div class="st-tpl-desc">自定义策略类与合约</div>
              </div>
            </div>
          </div>
          <div class="st-drawer-body form-grid" v-else>
            <strategy-doc-panel
              v-if="form.class_name"
              :class-name="form.class_name"
              :parameters="form.params"
              compact
              :show-params="false"
            />
            <div class="form-row" v-if="!editing"><label>策略类</label>
              <select v-model="form.class_name" class="input" @change="loadClassParams">
                <option v-for="c in store.ctaClasses" :value="c">{{ strategyLabel(c) }}</option>
              </select>
            </div>
            <div class="form-row"><label>实例名称</label>
              <input v-model="form.strategy_name" class="input" :readonly="!!editing">
            </div>
            <div class="form-row"><label>合约</label>
              <span v-if="editing">{{ form.vt_symbol }}</span>
              <contract-picker v-else v-model="form.vt_symbol" compact @pick="onFormPick" />
            </div>
            <div class="form-row"><label>交易账户</label>
              <select v-model="form.account_id" class="input">
                <option :value="0">默认</option>
                <option v-for="a in store.gatewayAccounts" :key="a.id" :value="a.id">{{ a.alias }} ({{ a.gateway }})</option>
              </select>
            </div>
            <div v-for="key in paramKeys" :key="key" class="form-row form-row-block">
              <label>{{ paramLabel(form.class_name, key) }}<term-help v-if="paramHint(form.class_name, key)" term="strategy_params" :title="paramLabel(form.class_name, key)" :text="paramHint(form.class_name, key)" /></label>
              <input v-if="typeof form.params[key] === 'number'" v-model.number="form.params[key]" class="input" type="number">
              <select v-else-if="typeof form.params[key] === 'boolean'" v-model="form.params[key]" class="input">
                <option :value="true">是</option><option :value="false">否</option>
              </select>
              <input v-else v-model="form.params[key]" class="input">
              <div v-if="paramHint(form.class_name, key)" class="st-param-hint">{{ paramHint(form.class_name, key) }}</div>
            </div>
            <button class="btn btn-sm btn-primary" @click="saveForm" :disabled="saving">{{ saving ? '保存中…' : '确认部署' }}</button>
          </div>
        </div>
      </div>

      <!-- 回测研究 抽屉 -->
      <div v-if="btOpen" class="st-drawer-overlay" @click.self="btOpen = false">
        <div class="st-drawer st-drawer-wide st-drawer-bt">
          <div class="st-drawer-head">
            <span>回测研究{{ bt.linkedInstance && selected ? ' — ' + selected.strategy_name : '' }}</span>
            <button class="btn btn-xs" @click="btOpen = false">✕</button>
          </div>
          <div class="st-drawer-body">
            <div v-if="bt.standalone" class="st-bt-standalone">
              独立回测模式：结果不会保存到策略实例。请在策略中心选中实例后再回测以关联快照。
            </div>
            <div v-else-if="bt.linkedInstance" class="st-bt-linked">
              已绑定实例「{{ bt.strategyName }}」— 策略类与合约已锁定，参数与实例配置同步。
            </div>
            <div class="backtest-form">
              <div class="form-row"><label>策略</label>
                <select v-if="!bt.linkedInstance" v-model="bt.className" class="input" @change="onBtClassChange">
                  <option v-for="c in store.btClasses" :value="c">{{ strategyLabel(c) }}</option>
                </select>
                <span v-else>{{ strategyLabel(bt.className) }}</span>
              </div>
              <div class="form-row"><label>合约</label>
                <contract-picker v-if="!bt.linkedInstance" v-model="bt.vtSymbol" compact @pick="onBtPick" />
                <span v-else>{{ contractLabel(bt.vtSymbol) || bt.vtSymbol }}</span>
              </div>
              <div class="form-row"><label><term-label term="bar_interval">周期</term-label></label>
                <select v-model="bt.interval" class="input" @change="checkBtCoverage">
                  <option value="1m">1m（推荐）</option><option value="1h">1h</option><option value="d">d</option>
                </select>
                <span class="st-param-hint">CTA 策略在引擎内合成更高周期，建议使用 1m 源数据</span>
              </div>
              <div class="form-row"><label>起始</label><input v-model="bt.start" type="date" class="input" @change="checkBtCoverage"></div>
              <div class="form-row"><label>结束</label><input v-model="bt.end" type="date" class="input" @change="checkBtCoverage"></div>
              <div class="form-row"><label>资金</label><input v-model="bt.capital" type="number" class="input" style="width:90px"></div>
              <div class="form-row"><label><term-label term="commission_rate">费率</term-label></label><input v-model="bt.rate" type="number" step="0.0001" class="input" style="width:80px"></div>
              <div class="form-row"><label><term-label term="slippage">滑点</term-label></label><input v-model="bt.slippage" type="number" step="0.1" class="input" style="width:70px"></div>
              <div class="form-row"><label><term-label term="contract_size">乘数</term-label></label><input v-model="bt.size" type="number" class="input" style="width:70px"></div>
              <div class="form-row"><label><term-label term="pricetick">最小变动</term-label></label><input v-model="bt.pricetick" type="number" step="0.01" class="input" style="width:70px"></div>
              <div v-if="btParamKeys.length" class="st-bt-params">
                <div class="st-section-title">策略参数（与实例同步）</div>
                <div v-for="key in btParamKeys" :key="key" class="form-row form-row-block">
                  <label>{{ paramLabel(bt.className, key) }}<term-help v-if="paramHint(bt.className, key)" term="strategy_params" :title="paramLabel(bt.className, key)" :text="paramHint(bt.className, key)" /></label>
                  <input v-if="typeof bt.params[key] === 'number'" v-model.number="bt.params[key]" class="input" type="number" :readonly="bt.linkedInstance">
                  <select v-else-if="typeof bt.params[key] === 'boolean'" v-model="bt.params[key]" class="input" :disabled="bt.linkedInstance">
                    <option :value="true">是</option><option :value="false">否</option>
                  </select>
                  <input v-else v-model="bt.params[key]" class="input" :readonly="bt.linkedInstance">
                </div>
              </div>
              <button class="btn btn-sm btn-primary" @click="runBacktest" :disabled="bt.running">
                <template v-if="bt.running">运行中…</template>
                <template v-else>运行回测<term-help term="run_backtest" /></template>
              </button>
            </div>
            <div v-if="bt.coverage" class="data-bt-coverage" :class="'cov-' + bt.coverage.status">
              {{ covLabel(bt.coverage.status) }} — {{ bt.coverage.detail }}
              <button v-if="bt.coverage.status !== 'ok'" class="btn btn-xs" @click="goDownloadBt">补数据</button>
            </div>

            <!-- 运行态：流水线 + 日志 -->
            <div v-if="btShowRunPanel" class="bt-run-panel">
              <div class="bt-run-head">
                <span class="bt-run-title">{{ bt.running ? '回测运行中' : '处理中…' }}</span>
                <span class="bt-run-elapsed">{{ btElapsed }}</span>
              </div>
              <div class="bt-stepper">
                <div v-for="(step, i) in btRunSteps" :key="step.id" class="bt-step"
                  :class="{ done: i <= btRunStepIdx, active: step.id === btRunPhase }">
                  <span class="bt-step-dot"></span>
                  <span class="bt-step-label">{{ step.label }}</span>
                </div>
              </div>
              <div class="bt-run-msg">{{ store.backtestProgress?.message || '等待服务端响应…' }}</div>
              <div v-if="btLiveLogs.length" class="bt-log-list">
                <div v-for="(l, i) in btLiveLogs" :key="i" class="bt-log-line">
                  <span class="log-time">{{ l.time }}</span> {{ l.msg }}
                </div>
              </div>
              <div v-else class="bt-run-skeleton">
                <div class="bt-skel-bar"></div>
                <div class="bt-skel-chart"></div>
              </div>
            </div>

            <!-- 结果区（store.backtestPanelResult 持久化，避免刷新策略列表时被清掉） -->
            <div v-if="btShowSavesBar" class="bt-saves-bar">
              <label class="bt-saves-label">已保存</label>
              <select v-model="bt.selectedSaveId" class="input input-sm bt-saves-select" @change="onBtSaveSelect">
                <option value="">当前结果（未选存档）</option>
                <option v-for="s in btSavedList" :key="s.id" :value="String(s.id)">{{ s.label_display || s.label }}</option>
              </select>
              <button class="btn btn-xs" @click="saveCurrentBacktest" :disabled="!btDisplayResult">保存</button>
              <button class="btn btn-xs" @click="setActiveBacktest" :disabled="!canSetActiveSave">设为验证基准</button>
              <button class="btn btn-xs" @click="exportSelectedSave" :disabled="!bt.selectedSaveId">导出</button>
              <button class="btn btn-xs btn-danger" @click="deleteSelectedSave" :disabled="!bt.selectedSaveId">删除</button>
            </div>
            <div v-if="btDisplayResult && !bt.running" class="bt-result-panel">
              <div class="bt-result-head">
                <span class="bt-result-title">回测报告</span>
                <div class="bt-result-actions">
                  <button class="btn btn-xs" @click="jumpToChart(bt.vtSymbol)" v-if="bt.vtSymbol">K线标注</button>
                  <button class="btn btn-xs" @click="runBacktest">重新运行</button>
                </div>
              </div>
              <div class="bt-kpi-grid">
                <div v-for="k in btKpis" :key="k.key" class="bt-kpi" :class="k.cls">
                  <div class="bt-kpi-val">{{ k.value }}</div>
                  <div class="bt-kpi-lbl">{{ k.label }}<term-help v-if="k.term" :term="k.term" /></div>
                  <div v-if="k.delta" class="bt-kpi-delta">{{ k.delta }}</div>
                </div>
              </div>
              <div class="bt-chart-caption"><term-label term="equity_curve">权益 / 回撤曲线</term-label></div>
              <div v-if="!btHasEquityData" class="empty" style="padding:24px 0">该记录未含权益曲线数据（请重新运行回测以生成完整报告）</div>
              <div v-show="btHasEquityData" ref="resultChartEl" class="equity-chart bt-equity-chart"></div>
              <div class="bt-meta-row" v-if="btMetrics">
                <span>{{ btMetaRange }}</span>
                <span><term-label term="end_balance">期末</term-label> {{ btFmtMoney(btMetrics.endBalance) }}</span>
                <span><term-label term="profit_days">盈亏日</term-label> {{ btMetrics.profitDays || 0 }}/{{ btMetrics.totalDays || 0 }}</span>
              </div>
              <div v-if="btTrades.length" class="bt-trades-wrap">
                <div class="panel-subtitle">成交明细（最近 {{ Math.min(btTrades.length, 20) }} 笔）</div>
                <table class="data-table bt-trades">
                  <thead><tr><th>时间</th><th>方向</th><th><term-label term="offset">开平</term-label></th><th>价格</th><th>数量</th></tr></thead>
                  <tbody>
                    <tr v-for="(tr, i) in btTrades.slice(0, 20)" :key="i">
                      <td>{{ tr.time }}</td>
                      <td :class="tr.dirCls">{{ tr.direction }}</td>
                      <td>{{ tr.offset }}</td>
                      <td class="num">{{ tr.price }}</td>
                      <td class="num">{{ tr.volume }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div v-else-if="!bt.running && !btShowRunPanel && !btDisplayResult" class="equity-chart bt-equity-placeholder">
              <div class="bt-empty-chart">配置参数后点击「运行回测」查看权益曲线与统计指标</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 策略百科抽屉 -->
      <div v-if="showEncyclopedia" class="st-drawer-overlay" @click.self="showEncyclopedia = false">
        <div class="st-drawer st-drawer-wide">
          <div class="st-drawer-head">
            <span>策略百科</span>
            <button class="btn btn-xs" @click="showEncyclopedia = false">✕</button>
          </div>
          <div class="st-drawer-body st-encyclopedia">
            <div v-for="item in docList" :key="item.class_name" class="st-ency-item">
              <div class="st-ency-head" @click="toggleEncy(item.class_name)">
                <span class="st-ency-title">{{ item.label }}</span>
                <span class="st-doc-type">{{ item.type }}</span>
                <span class="st-ency-toggle">{{ expandedEncy === item.class_name ? '▼' : '▶' }}</span>
              </div>
              <p v-if="expandedEncy !== item.class_name" class="st-ency-teaser">{{ item.summary }}</p>
              <strategy-doc-panel
                v-if="expandedEncy === item.class_name"
                :class-name="item.class_name"
                :show-params="true"
              />
            </div>
          </div>
        </div>
      </div>
    </div>`,
  setup() {
    const listFilter = ref('all');
    const selected = ref(null);
    const showForm = ref(false);
    const showTemplates = ref(true);
    const editing = ref(false);
    const saving = ref(false);
    const actionBusy = ref(false);
    const btOpen = ref(false);
    const showEncyclopedia = ref(false);
    const expandedEncy = ref('');
    const form = reactive({ class_name: '', strategy_name: '', vt_symbol: '', account_id: 0, gateway: 'CTP', params: {} });
    const bt = reactive({
      className: '', vtSymbol: '', interval: '1m', start: '', end: '',
      capital: '1000000', rate: '0.0001', slippage: '0.2', size: '10', pricetick: '1',
      params: {}, linkedInstance: false, standalone: false, strategyName: '', sessionId: '',
      runStartedAt: 0, runPhase: 'prepare',
      running: false, result: null, coverage: null, selectedSaveId: '',
    });
    const equityEl = ref(null);
    const resultChartEl = ref(null);
    let equityChart = null;
    const btTick = ref(0);
    let btTimer = null;

    const filterTabs = STRATEGY_FILTER_TABS;
    const templates = STRATEGY_TEMPLATES;
    const lifecycleSteps = STRATEGY_LIFECYCLE;
    const normStatus = $normStrategyStatus;

    const summary = computed(() => store.strategySummary || {
      total: store.strategies.length,
      running: store.strategies.filter(s => normStatus(s.status) === 'running').length,
      inited: store.strategies.filter(s => normStatus(s.status) === 'inited').length,
      stopped: store.strategies.filter(s => normStatus(s.status) === 'stopped').length,
      pos_exposure: 0,
      gateway_alerts: 0,
    });

    const filteredList = computed(() => $filterStrategies(store.strategies, listFilter.value));

    const preflight = computed(() =>
      selected.value ? store.strategyPreflight[selected.value.strategy_name] : null
    );

    const lifecycleStep = computed(() => preflight.value?.lifecycle_step || 'configured');
    const lifecycleIdx = computed(() => $lifecycleIndex(lifecycleStep.value));
    const lifecyclePct = computed(() => $lifecycleProgress(lifecycleStep.value));

    const docList = computed(() => $strategyDocList());
    const docParamRows = computed(() =>
      selected.value
        ? $strategyParamRows(selected.value.class_name, selected.value.parameters)
        : []
    );

    const varRows = computed(() => {
      const v = selected.value?.variables || {};
      return Object.entries(v).filter(([k]) => !['inited', 'trading'].includes(k)).slice(0, 12);
    });

    const recentLogs = computed(() => (store.strategyLogs || []).slice(-8));

    const paramKeys = computed(() =>
      Object.keys(form.params).filter(k => !['strategy_name', 'vt_symbol'].includes(k))
    );

    const btParamKeys = computed(() =>
      Object.keys(bt.params).filter(k => !['strategy_name', 'vt_symbol'].includes(k))
    );

    const primaryBtnClass = computed(() => {
      const k = preflight.value?.next_action?.kind;
      return k === 'danger' ? 'btn-warn' : 'btn-primary';
    });

    const btReturnText = computed(() => $btFmtReturnPct(btMetrics.value?.totalReturn));
    const btReturnCls = computed(() => (btMetrics.value?.totalReturn || 0) >= 0 ? 'up' : 'down');
    const btDrawdownText = computed(() => $btFmtDdPct(btMetrics.value?.maxDdPct));

    const btRunSteps = BT_RUN_STEPS;

    const btSavedList = computed(() => {
      const name = bt.strategyName || selected.value?.strategy_name || '';
      return name ? (store.backtestSaves[name] || []) : [];
    });

    const detailSavedList = computed(() => {
      const name = selected.value?.strategy_name || '';
      return name ? (store.backtestSaves[name] || []) : [];
    });

    const canExecuteNext = computed(() => {
      const act = preflight.value?.next_action?.id;
      if (!act || actionBusy.value) return false;
      if (act === 'init') return !!preflight.value?.ready_to_init;
      if (act === 'start') return !!preflight.value?.ready_to_start;
      return true;
    });

    const selectedSaveItem = computed(() => {
      if (!bt.selectedSaveId) return null;
      return btSavedList.value.find(s => String(s.id) === String(bt.selectedSaveId)) || null;
    });

    const canSetActiveSave = computed(() => {
      const s = selectedSaveItem.value;
      return !!(s && s.status === 'passed' && !s.is_active);
    });

    const btShowSavesBar = computed(() =>
      bt.linkedInstance && !!(bt.strategyName || selected.value?.strategy_name)
      && (btSavedList.value.length > 0 || !!btDisplayResult.value)
    );

    /** 当前抽屉应展示的回测结果（store 持久层，不受 hydrate/列表刷新影响） */
    const btDisplayResult = computed(() => {
      const panel = store.backtestPanelResult;
      if (!panel) return null;
      if (bt.linkedInstance && bt.strategyName && panel.strategy_name
          && panel.strategy_name !== bt.strategyName) return null;
      return panel;
    });

    const btShowRunPanel = computed(() => {
      if (bt.running) return true;
      const p = store.backtestProgress;
      if (!p) return false;
      if (btDisplayResult.value && (p.status === 'done' || p.phase === 'report')) return false;
      return true;
    });

    const btMetrics = computed(() => $btNormalizeResult(btDisplayResult.value));
    const btHasEquityData = computed(() => !!(btMetrics.value?.balance?.length));
    const btKpis = computed(() => $btKpiCards(btMetrics.value, selected.value?.last_backtest));
    const btTrades = computed(() => (btMetrics.value?.trades || []).map($btFormatTradeRow).reverse());
    const btRunPhase = computed(() =>
      store.backtestProgress?.phase || bt.runPhase || (bt.running ? 'prepare' : '')
    );
    const btRunStepIdx = computed(() => {
      const idx = $btStepIndex(btRunPhase.value);
      return idx >= 0 ? idx : (bt.running ? 0 : BT_RUN_STEPS.length - 1);
    });
    const btElapsed = computed(() => {
      btTick.value;
      return $btElapsedText(bt.runStartedAt);
    });
    const btLiveLogs = computed(() => {
      const logs = store.backtestLogs || [];
      return logs.slice(-12);
    });
    const btMetaRange = computed(() => {
      const m = btMetrics.value;
      if (!m?.startDate && !m?.endDate) return `${bt.start} → ${bt.end}`;
      const s = m.startDate ? String(m.startDate).slice(0, 10) : bt.start;
      const e = m.endDate ? String(m.endDate).slice(0, 10) : bt.end;
      return `${s} → ${e}`;
    });

    function fmtPct(v) {
      if (v == null) return '—';
      return $btFmtReturnPct(v);
    }

    function isBacktestLoss(snapshot) {
      return $isBacktestLoss(snapshot);
    }

    function canEdit(s) { return normStatus(s?.status) !== 'running'; }

    function docSummary(className) {
      const s = $strategyDoc(className)?.summary || '';
      return s.length > 72 ? s.slice(0, 72) + '…' : s;
    }

    function paramLabel(className, key) {
      const meta = $strategyDoc(className)?.params?.find(p => p.name === key);
      return meta?.label || key;
    }

    function paramHint(className, key) {
      return $strategyParamHint(className, key);
    }

    function preflightTerm(id) {
      return ($preflightTermKey && $preflightTermKey[id]) || id;
    }

    function fetchBacktestSaves(name) {
      if (!name) return;
      $wsSend({ action: 'list_backtest_saves', payload: { strategy_name: name } });
    }

    function loadSaveFromDetail(s) {
      if (!s?.id || !selected.value) return;
      openBacktestDrawer();
      bt.selectedSaveId = String(s.id);
      $wsSend({
        action: 'load_backtest_save',
        payload: { strategy_name: selected.value.strategy_name, save_id: parseInt(s.id, 10) },
      });
    }

    function onBtSaveSelect() {
      const name = bt.strategyName || selected.value?.strategy_name;
      if (!name) return;
      if (!bt.selectedSaveId) {
        store.backtestPanelResult = null;
        if (equityChart) { equityChart.dispose(); equityChart = null; }
        return;
      }
      $wsSend({
        action: 'load_backtest_save',
        payload: { strategy_name: name, save_id: parseInt(bt.selectedSaveId, 10) },
      });
    }

    function saveCurrentBacktest() {
      const name = bt.strategyName || selected.value?.strategy_name;
      const r = btDisplayResult.value;
      if (!name || !r) return $toast('无可保存的结果', 'error');
      const label = window.prompt('保存名称（留空则自动生成）', '') ?? '';
      if (label === null) return;
      $wsSend({
        action: 'save_backtest_save',
        payload: {
          strategy_name: name,
          label,
          result: {
            ...r,
            strategy_name: name,
            class_name: bt.className,
            vt_symbol: bt.vtSymbol,
            interval: bt.interval,
            start: bt.start,
            end: bt.end,
            parameters: { ...bt.params },
            rate: parseFloat(bt.rate) || 0.0001,
            slippage: parseFloat(bt.slippage) || 0.2,
            size: parseInt(bt.size, 10) || 10,
            pricetick: parseFloat(bt.pricetick) || 1,
            capital: parseFloat(bt.capital) || 1e6,
          },
        },
      });
    }

    function deleteSelectedSave() {
      const name = bt.strategyName || selected.value?.strategy_name;
      const id = bt.selectedSaveId;
      if (!name || !id) return;
      if (!window.confirm('确定删除这条回测记录？删除后无法恢复。')) return;
      $wsSend({
        action: 'delete_backtest_save',
        payload: { strategy_name: name, save_id: parseInt(id, 10) },
      });
    }

    function setActiveBacktest() {
      const name = bt.strategyName || selected.value?.strategy_name;
      const id = bt.selectedSaveId;
      if (!name || !id || !canSetActiveSave.value) return;
      $wsSend({
        action: 'set_active_backtest',
        payload: { strategy_name: name, save_id: parseInt(id, 10) },
      });
    }

    function exportSelectedSave() {
      const name = bt.strategyName || selected.value?.strategy_name;
      const id = bt.selectedSaveId;
      if (!name || !id) return;
      $wsSend({
        action: 'export_backtest_save',
        payload: { strategy_name: name, save_id: parseInt(id, 10) },
      });
    }

    function toggleEncy(className) {
      expandedEncy.value = expandedEncy.value === className ? '' : className;
    }

    function refreshAll() {
      $wsSend({ action: 'get_cta_strategies' });
      $wsSend({ action: 'get_strategy_summary' });
      $wsSend({ action: 'get_cta_classes' });
      $wsSend({ action: 'get_gateway_accounts' });
      if (selected.value) fetchPreflight(selected.value.strategy_name);
    }

    function fetchPreflight(name) {
      $wsSend({ action: 'get_strategy_preflight', payload: { strategy_name: name } });
    }

    function selectStrategy(s) {
      const sameInstance = selected.value?.strategy_name === s.strategy_name;
      if (!sameInstance) {
        store.backtestPanelResult = null;
        bt.result = null;
      }
      selected.value = s;
      $saveJson(PERSIST_KEYS.strategySelected, s.strategy_name);
      fetchPreflight(s.strategy_name);
      fetchBacktestSaves(s.strategy_name);
      loadLogs();
      if (btOpen.value && selected.value) {
        $hydrateBacktestFromInstance(bt, selected.value);
        fillContractMeta(bt.vtSymbol);
        checkBtCoverage();
        if (btDisplayResult.value) scheduleRenderEquity(btDisplayResult.value);
        else if (equityChart) { equityChart.dispose(); equityChart = null; }
      }
    }

    function loadLogs() {
      if (!selected.value) return;
      $wsSend({ action: 'get_strategy_logs', payload: { strategy_name: selected.value.strategy_name, limit: 50 } });
    }

    function openCreate() {
      editing.value = false;
      showTemplates.value = true;
      showForm.value = true;
    }

    function closeForm() {
      showForm.value = false;
      saving.value = false;
    }

    function deployTemplate(t) {
      applyTemplate(t);
      showTemplates.value = false;
      showForm.value = true;
    }

    function applyTemplate(t) {
      form.class_name = t.class_name;
      form.vt_symbol = t.vt_symbol;
      form.params = { ...t.params };
      const names = store.strategies.map(s => s.strategy_name);
      form.strategy_name = $suggestStrategyName(t, names);
      form.account_id = store.gatewayAccounts.find(a => a.connected)?.id || 0;
      form.gateway = store.gatewayAccounts.find(a => a.id === form.account_id)?.gateway || 'CTP';
      showTemplates.value = false;
      loadClassParams();
    }

    function loadClassParams() {
      if (!form.class_name) return;
      const cached = store.ctaParamSchemas[form.class_name];
      if (cached && !editing.value) {
        Object.entries(cached).forEach(([k, v]) => {
          if (k !== 'strategy_name' && k !== 'vt_symbol' && form.params[k] === undefined) form.params[k] = v;
        });
        return;
      }
      $wsSend({ action: 'get_cta_params', payload: { class_name: form.class_name } });
    }

    watch(() => store.ctaParamSchemas[form.class_name], (schema) => {
      if (!schema || editing.value || !showForm.value) return;
      Object.entries(schema).forEach(([k, v]) => {
        if (k !== 'strategy_name' && k !== 'vt_symbol') form.params[k] = v;
      });
    });

    function onFormPick(p) {
      form.vt_symbol = p.vt_symbol || form.vt_symbol;
      const acct = store.gatewayAccounts.find(a => a.id === form.account_id);
      form.gateway = acct?.gateway || 'CTP';
    }

    function saveForm() {
      if (!form.strategy_name.trim()) return $toast('请填写实例名称', 'error');
      if (!editing.value && !form.vt_symbol.trim()) return $toast('请选择合约', 'error');
      saving.value = true;
      if (editing.value) {
        $wsSend({ action: 'edit_cta_strategy', payload: { strategy_name: form.strategy_name, setting: form.params } });
      } else {
        $wsSend({ action: 'add_cta_strategy', payload: {
          class_name: form.class_name, strategy_name: form.strategy_name,
          vt_symbol: form.vt_symbol, parameters: form.params,
          account_id: form.account_id, gateway: form.gateway,
        }});
      }
    }

    function editStrategy() {
      if (!selected.value) return;
      editing.value = true;
      showTemplates.value = false;
      form.class_name = selected.value.class_name;
      form.strategy_name = selected.value.strategy_name;
      form.vt_symbol = selected.value.vt_symbol;
      form.account_id = selected.value.account_id || 0;
      form.params = { ...(selected.value.parameters || {}) };
      showForm.value = true;
    }

    function removeStrategy() {
      if (!selected.value || !confirm('确定删除实例 ' + selected.value.strategy_name + '?')) return;
      doAction('remove');
    }

    function doAction(act) {
      if (!selected.value) return;
      actionBusy.value = true;
      $wsSend({ action: 'cta_strategy_' + act, payload: { strategy_name: selected.value.strategy_name } });
      setTimeout(() => { actionBusy.value = false; }, 35000);
    }

    function executeNextAction() {
      const act = preflight.value?.next_action?.id;
      if (!act || !selected.value) return;
      if (act === 'connect') {
        if (window.__setActiveTab) window.__setActiveTab('settings');
        $toast('请在设置页连接交易账户', 'info');
        return;
      }
      if (act === 'download_data') {
        $openDataTabForStrategy(selected.value);
        return;
      }
      if (act === 'backtest') { openBacktestDrawer(); return; }
      if (act === 'init') {
        if (!preflight.value?.ready_to_init) {
          const msg = preflight.value?.backtest_unprofitable
            ? '回测亏损或无有效验证基准，请调整参数后重新回测'
            : '尚未满足初始化条件，请完成回测验证';
          $toast(msg, 'error');
          openBacktestDrawer();
          return;
        }
      }
      if (act === 'start' && !preflight.value?.ready_to_start) {
        $toast('请先完成初始化并连接交易网关', 'error');
        return;
      }
      if (act === 'stop') { doAction('stop'); return; }
      if (act === 'init' || act === 'start') { doAction(act); return; }
    }

    function openBacktestDrawer() {
      btOpen.value = true;
      const d = $defaultDownloadDates();
      if (!bt.start) { bt.start = d.start; bt.end = d.end; }
      if (selected.value) {
        $hydrateBacktestFromInstance(bt, selected.value);
        fetchBacktestSaves(selected.value.strategy_name);
      } else {
        bt.linkedInstance = false;
        bt.standalone = true;
        bt.strategyName = '';
        bt.selectedSaveId = '';
        if (!bt.className && store.btClasses.length) bt.className = store.btClasses[0];
        if (bt.className && !Object.keys(bt.params).length) loadBtClassParams();
      }
      fillContractMeta(bt.vtSymbol);
      checkBtCoverage();
      scheduleRenderEquity(btDisplayResult.value);
    }

    function loadBtClassParams() {
      if (!bt.className) return;
      const cached = store.ctaParamSchemas[bt.className];
      if (cached) {
        Object.entries(cached).forEach(([k, v]) => {
          if (k !== 'strategy_name' && k !== 'vt_symbol') bt.params[k] = v;
        });
        return;
      }
      $wsSend({ action: 'get_cta_params', payload: { class_name: bt.className } });
    }

    function onBtClassChange() {
      bt.params = {};
      bt.interval = $strategyBacktestInterval(bt.className);
      loadBtClassParams();
      checkBtCoverage();
    }

    function covLabel(st) {
      return ({ ok: '充足', missing: '缺失', partial: '部分', stale: '偏旧', tick_only: '仅Tick' }[st] || st);
    }

    async function checkBtCoverage() {
      if (!bt.vtSymbol) { bt.coverage = null; return; }
      try {
        const data = await $checkDataCoverage([{ vt_symbol: bt.vtSymbol, interval: bt.interval, start: bt.start, end: bt.end }]);
        bt.coverage = (data.results || [])[0] || null;
      } catch { bt.coverage = $findLocalDataCoverage(bt.vtSymbol, bt.interval); }
    }

    async function fillContractMeta(vt) {
      if (!vt) return;
      const c = store.contract[vt.toUpperCase()];
      if (c?.size) bt.size = String(c.size);
      if (c?.pricetick) bt.pricetick = String(c.pricetick);
    }

    function onBtPick(p) {
      bt.vtSymbol = p.vt_symbol || bt.vtSymbol;
      fillContractMeta(bt.vtSymbol);
      checkBtCoverage();
    }

    function goDownloadBt() {
      const p = $parseVtSymbol(bt.vtSymbol);
      $openDataTab({ sub: 'local', symbol: p.symbol, exchange: p.exchange, interval: bt.interval, vt_symbol: bt.vtSymbol, action: 'update' });
    }

    function startBtTimer() {
      stopBtTimer();
      btTick.value = 0;
      btTimer = setInterval(() => { btTick.value += 1; }, 1000);
    }
    function stopBtTimer() {
      if (btTimer) { clearInterval(btTimer); btTimer = null; }
    }

    function runBacktest() {
      if (!bt.className || !bt.vtSymbol) return $toast('请选择策略和合约', 'error');
      bt.result = null;
      store.backtestPanelResult = null;
      bt.selectedSaveId = '';
      bt.running = true;
      bt.runPhase = 'prepare';
      bt.runStartedAt = Date.now();
      bt.sessionId = $nextBacktestSessionId();
      store.backtestResult = null;
      store.backtestLogs = [];
      store.backtestPendingSession = bt.sessionId;
      store.backtestProgress = { message: '提交回测任务…', phase: 'prepare', session_id: bt.sessionId };
      if (equityChart) { equityChart.dispose(); equityChart = null; }
      startBtTimer();
      const linkName = bt.linkedInstance ? (bt.strategyName || selected.value?.strategy_name || '') : '';
      $wsSend({ action: 'start_backtesting', payload: {
        class_name: bt.className, vt_symbol: bt.vtSymbol, interval: bt.interval,
        start: bt.start, end: bt.end,
        capital: parseFloat(bt.capital) || 1e6,
        rate: parseFloat(bt.rate) || 0.0001,
        slippage: parseFloat(bt.slippage) || 0.2,
        size: parseInt(bt.size, 10) || 10,
        pricetick: parseFloat(bt.pricetick) || 1,
        parameters: { ...bt.params },
        strategy_name: linkName,
        session_id: bt.sessionId,
      }});
    }

    function renderEquity(result) {
      if (!resultChartEl.value || typeof echarts === 'undefined') return;
      const opt = $btBuildEquityOption(result);
      if (!opt) return;
      if (!equityChart) equityChart = echarts.init(resultChartEl.value, 'dark');
      equityChart.resize();
      equityChart.setOption(opt, true);
    }

    function scheduleRenderEquity(result, retries = 0) {
      if (!result) return;
      const m = $btNormalizeResult(result);
      if (!m?.balance?.length) return;
      if (!resultChartEl.value) {
        if (retries < 10) nextTick(() => scheduleRenderEquity(result, retries + 1));
        return;
      }
      nextTick(() => renderEquity(result));
    }

    function jumpToChart(vt) {
      if (!vt) return;
      $setActiveSymbol(vt);
      if (window.__setActiveTab) window.__setActiveTab('trading');
      nextTick(() => { if (window.__jumpToSymbol) window.__jumpToSymbol(vt); });
    }

    window.__openBacktestWithSymbol = (vt, interval) => {
      if (typeof window.__setActiveTab === 'function') window.__setActiveTab('strategy');
      btOpen.value = true;
      const d = $defaultDownloadDates();
      if (!bt.start) { bt.start = d.start; bt.end = d.end; }
      if (selected.value) {
        $hydrateBacktestFromInstance(bt, selected.value);
        if (interval) bt.interval = interval;
      } else {
        $hydrateBacktestStandalone(bt, vt, interval || '1m');
        if (!bt.className && store.btClasses.length) bt.className = store.btClasses[0];
        loadBtClassParams();
        $toast('独立回测：未选中实例，结果不会保存', 'info');
      }
      fillContractMeta(bt.vtSymbol);
      checkBtCoverage();
    };

    watch(() => store.backtestPanelResult, (r) => {
      if (!r) return;
      if (r.strategy_name && bt.linkedInstance && bt.strategyName && r.strategy_name !== bt.strategyName) return;
      bt.running = false;
      bt.runPhase = 'report';
      btOpen.value = true;
      stopBtTimer();
      scheduleRenderEquity(r);
      const isRun = r._panelSource !== 'load';
      const linkedName = r.strategy_name || (bt.linkedInstance ? bt.strategyName : '');
      if (isRun && linkedName && selected.value?.strategy_name === linkedName) {
        if (r.is_active_gate || r.backtest_status === 'passed') {
          selected.value = {
            ...selected.value,
            last_backtest: {
              total_return: r.total_return,
              sharpe_ratio: r.sharpe_ratio,
              max_drawdown: r.max_drawdown,
              total_trades: r.total_trades ?? r.total_trade_count,
              interval: bt.interval,
              run_at: new Date().toISOString(),
            },
          };
        }
        fetchPreflight(linkedName);
        $wsSend({ action: 'get_cta_strategies' });
        fetchBacktestSaves(linkedName);
        if (r.save_id) bt.selectedSaveId = String(r.save_id);
        if (r.is_active_gate) bt.selectedSaveId = String(r.save_id || bt.selectedSaveId);
      } else if (r.save_id) {
        bt.selectedSaveId = String(r.save_id);
      }
    });

    watch(btDisplayResult, (r) => {
      if (r && !bt.running && btOpen.value) scheduleRenderEquity(r);
    });

    watch(() => store.backtestError, (err) => {
      if (!err) return;
      bt.running = false;
      stopBtTimer();
      $toast(String(err), 'error');
      store.backtestError = null;
    });

    watch(() => store.backtestProgress, (p) => {
      if (p?.phase) bt.runPhase = p.phase;
    });

    watch(() => store.ctaParamSchemas[bt.className], (schema) => {
      if (!schema || bt.linkedInstance || !btOpen.value) return;
      Object.entries(schema).forEach(([k, v]) => {
        if (k !== 'strategy_name' && k !== 'vt_symbol') bt.params[k] = v;
      });
    });

    watch(() => selected.value?.parameters, (p) => {
      if (!btOpen.value || !bt.linkedInstance || !p) return;
      bt.params = { ...p };
    }, { deep: true });

    watch(() => store.backtestLastSaved, (ev) => {
      if (!ev) return;
      const name = bt.strategyName || selected.value?.strategy_name;
      if (name && ev.strategy_name === name && ev.save_id) {
        bt.selectedSaveId = String(ev.save_id);
      }
    });

    watch(() => store.backtestSaves, (map) => {
      const name = bt.strategyName || selected.value?.strategy_name;
      if (!name || !bt.selectedSaveId) return;
      const list = map[name] || [];
      if (!list.some(s => String(s.id) === String(bt.selectedSaveId))) {
        const removedId = bt.selectedSaveId;
        bt.selectedSaveId = '';
        const panel = store.backtestPanelResult;
        if (panel && (String(panel.save_id) === String(removedId))) {
          store.backtestPanelResult = null;
          if (equityChart) { equityChart.dispose(); equityChart = null; }
        }
      }
    }, { deep: true });

    watch(() => store.lastCtaAction, (data) => {
      if (!data || !saving.value) return;
      saving.value = false;
      if (!data.error) closeForm();
    });

    watch(() => store.strategies, (list) => {
      actionBusy.value = false;
      if (!list?.length) { selected.value = null; return; }
      const cur = selected.value?.strategy_name;
      if (cur) {
        const hit = list.find(s => s.strategy_name === cur);
        if (hit) {
          selected.value = hit;
          fetchPreflight(cur);
          fetchBacktestSaves(cur);
          if (btDisplayResult.value) scheduleRenderEquity(btDisplayResult.value);
          return;
        }
      }
      const saved = $loadJson(PERSIST_KEYS.strategySelected, '');
      const hit = list.find(s => s.strategy_name === saved) || list[0];
      if (hit) selectStrategy(hit);
    }, { deep: true });

    onMounted(() => {
      refreshAll();
      $wsSend({ action: 'get_backtest_classes' });
      const d = $defaultDownloadDates();
      bt.start = d.start;
      bt.end = d.end;
    });

    onUnmounted(() => {
      stopBtTimer();
      if (equityChart) { equityChart.dispose(); equityChart = null; }
      window.__openBacktestWithSymbol = null;
    });

    return {
      listFilter, filterTabs, filteredList, selected, summary, preflight,
      lifecycleSteps, lifecycleStep, lifecycleIdx, lifecyclePct,
      docParamRows, varRows, recentLogs, templates, docList,
      showForm, showTemplates, editing, saving, form, paramKeys,
      showEncyclopedia, expandedEncy,
      btOpen, bt, equityEl, resultChartEl, btDisplayResult, btShowRunPanel, btShowSavesBar, btSavedList, detailSavedList,
      selectedSaveItem, canSetActiveSave, canExecuteNext, actionBusy, primaryBtnClass, btParamKeys,
      btReturnText, btReturnCls, btDrawdownText,
      btRunSteps, btRunPhase, btRunStepIdx, btElapsed, btLiveLogs,
      btMetrics, btHasEquityData, btKpis, btTrades, btMetaRange,
      normStatus, canEdit, fmtPct, isBacktestLoss, docSummary, paramLabel, paramHint, preflightTerm, toggleEncy,
      strategyLabel: $strategyLabel, strategyStatus: $strategyStatusCn,
      contractLabel: $contractLabel,
      checkStatusIcon: $checkStatusIcon,
      checkStatusClass: $checkStatusClass,
      refreshAll, selectStrategy, openCreate, closeForm, deployTemplate, applyTemplate,
      loadClassParams, onFormPick, saveForm, editStrategy, removeStrategy,
      executeNextAction, doAction, openBacktestDrawer, runBacktest, onBtClassChange,
      fetchBacktestSaves, loadSaveFromDetail, onBtSaveSelect, saveCurrentBacktest, deleteSelectedSave,
      setActiveBacktest, exportSelectedSave,
      checkBtCoverage, covLabel, goDownloadBt, onBtPick, loadLogs, jumpToChart, store,
      btFmtMoney: $btFmtMoney,
    };
  },
};
