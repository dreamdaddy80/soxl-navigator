// 홈: 장 시간대 → 내 현황 → 오늘의 주문 → 체결 기록 → 다음 제안으로 이어지는 화면

let todayPanel = null; // { type: 'fill' | 'adjust', kind }: 입력 중에는 시세 갱신으로 주문 카드를 다시 그리지 않는다
let lastTodayFill = null;

const TODAY_STAGE_INFO = {
  SELL: { icon: '🔴', verb: '매도', tone: 'today-order-sell', step: 1 },
  REBUY: { icon: '🟢', verb: '재매수', tone: 'today-order-buy', step: 2 }
};

function orderVerb(plan, kind) {
  return plan.stage === 'VR' && kind === 'REBUY' ? '매수' : TODAY_STAGE_INFO[kind].verb;
}

function findPlanOrder(plan, kind) {
  return planOrders(plan).find(order => order.kind === kind) || null;
}

function formatSeoulTime(ms) {
  return new Date(ms).toLocaleTimeString('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatRemaining(ms) {
  const minutes = Math.max(0, Math.round((ms - Date.now()) / 60000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}시간 ${minutes % 60}분` : `${minutes}분`;
}

function renderTodaySession(session) {
  const box = document.getElementById('today-session');
  if (!box) return;
  const b = session.boundaries;
  const steps = [
    ['PRE', '프리장', b.PRE, b.REGULAR],
    ['REGULAR', '본장', b.REGULAR, b.AFTER],
    ['AFTER', '애프터장', b.AFTER, b.END]
  ];
  box.innerHTML = `
    <div class="today-session-steps">
      ${steps.map(([key, label, from, to]) => `
        <div class="today-session-step ${session.key === key ? 'active' : ''}">
          <strong>${label}</strong>
          <span>${formatSeoulTime(from)}~${formatSeoulTime(to)}</span>
        </div>`).join('')}
    </div>
    <div class="today-session-now">
      <strong>${session.holiday ? '오늘은 미국 시장 휴장일입니다' : `지금은 ${session.label}`}</strong>
      <span>${session.next.label}까지 ${formatRemaining(session.next.at)} · 시각은 한국시간</span>
    </div>
  `;
}

function renderTodayPosition(t) {
  const set = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };
  set('today-shares', `${t.shares.toLocaleString()}주`);
  set('today-cash', formatUSD(t.reservedCash || 0));
}

function todaySessionHint(session) {
  if (session.key === 'PRE') return `프리장은 거래가 적어 호가가 튑니다. 증권사 주문에서 '프리장 포함'을 고르면 지금부터 체결될 수 있고, 아니면 본장 시작 시 적용됩니다.`;
  if (session.key === 'REGULAR') return '본장 중에는 지정가 주문이 바로 유효합니다.';
  if (session.key === 'AFTER') return `본장이 끝났습니다. 애프터장 체결을 원하면 증권사 주문에서 '애프터장 포함'을 고르세요.`;
  return '지금 지정가 예약을 걸어 두면 다음 장이 열릴 때 적용됩니다.';
}

function todayPriceState(t, plan, order, session) {
  const cur = t.currentPrice;
  // 프리장·마감 때의 일봉 고가·저가는 지난 거래일 값이다
  const barIsToday = session.key === 'REGULAR' || session.key === 'AFTER';
  const touchedHigh = barIsToday && t.dayHigh >= order.price && (!plan.highAtCreate || t.dayHigh > plan.highAtCreate);
  const touchedLow = barIsToday && t.dayLow > 0 && t.dayLow <= order.price && (!plan.lowAtCreate || t.dayLow < plan.lowAtCreate);
  const distance = formatBtSignedPct(order.price / cur - 1);
  if (order.kind === 'SELL') {
    if (cur >= order.price) return { cls: 'reached', text: `⚡ 현재가 ${formatUSD(cur)}가 주문가 이상입니다. 지정가를 걸면 바로 체결될 수 있습니다.` };
    if (touchedHigh) return { cls: 'reached', text: `오늘 고가 ${formatUSD(t.dayHigh)}가 주문가에 닿았습니다. 증권사 앱에서 체결됐는지 확인해 보세요.` };
    return { cls: '', text: `현재가 ${formatUSD(cur)} · 주문가까지 ${distance}` };
  }
  if (cur <= order.price) return { cls: 'reached', text: `⚡ 현재가 ${formatUSD(cur)}가 주문가 이하입니다. 지정가를 걸면 바로 체결될 수 있습니다.` };
  if (touchedLow) return { cls: 'reached', text: `오늘 저가 ${formatUSD(t.dayLow)}가 주문가에 닿았습니다. 증권사 앱에서 체결됐는지 확인해 보세요.` };
  return { cls: '', text: `현재가 ${formatUSD(cur)} · 주문가까지 ${distance}` };
}

function renderRebuyWaitingNote(t) {
  const open = openRotation(t);
  if (!open) return '';
  const cur = t.currentPrice;
  const sellPrice = open.netSellPrice / (1 - TRADING_FEE_RATE);
  const remaining = Math.max(0, open.proceeds - open.cost);
  const rebuyNow = Math.floor(remaining / (cur * (1 + TRADING_FEE_RATE)));
  const unrecovered = open.sellShares - open.buyShares;
  const delta = rebuyNow - Math.round(unrecovered);
  const overLimit = open.daysWaited >= 28; // 약 20거래일
  return `
    <div class="today-waiting ${overLimit || cur > sellPrice ? 'warn' : ''}">
      ⏳ ${open.sellDate} 매도 후 <strong>${open.daysWaited}일째</strong> 대기 중 · 지금 시세로 되사면 ${rebuyNow.toLocaleString()}주 (판 수량 대비 ${formatShareDelta(delta)})
      ${overLimit || cur > sellPrice ? '<br/>과거 검증에서 회전이 보유보다 뒤처진 주된 이유가 재매수를 기다리다 현금이 묶이는 경우였습니다. 계속 기다릴지, 주문가를 바꿀지 정해 보세요.' : ''}
    </div>`;
}

function renderTodayFillPanel(plan, order) {
  return `
    <div class="today-panel">
      <strong>실제 ${orderVerb(plan, order.kind)} 체결 내용을 입력해 주세요</strong>
      <div class="today-panel-fields">
        <div class="input-group"><label for="today-fill-price">체결가 ($)</label><input type="number" id="today-fill-price" step="0.01" min="0.01" value="${order.price}" /></div>
        <div class="input-group"><label for="today-fill-shares">수량 (주)</label><input type="number" id="today-fill-shares" step="1" min="1" value="${order.shares}" /></div>
        <div class="input-group"><label for="today-fill-date">체결일</label><input type="date" id="today-fill-date" value="${todayISO()}" /></div>
      </div>
      <div class="today-actions">
        <button type="button" class="btn-primary" onclick="recordTodayFill()">기록하고 다음 제안 보기</button>
        <button type="button" class="btn-secondary" onclick="closeTodayPanel()">취소</button>
      </div>
    </div>`;
}

function renderTodayAdjustPanel(plan, order) {
  const mode = appState.targetMode || 'MID';
  const modeButtons = plan.stage !== 'SELL' ? '' : `
    <div class="today-mode-row">
      <span>반등 기준</span>
      ${[['SHORT', '⚡ 짧게 +4.5%'], ['MID', '⚖️ 표준 +9%'], ['HIGH', '🚀 강하게 +15%']]
        .map(([key, label]) => `<button type="button" class="sync-chip-btn ${mode === key ? 'today-mode-active' : ''}" onclick="setTodayMode('${key}')">${label}</button>`).join('')}
    </div>`;
  return `
    <div class="today-panel">
      <strong>${orderVerb(plan, order.kind)} 주문 조정</strong>
      ${modeButtons}
      <div class="today-panel-fields">
        <div class="input-group"><label for="today-adjust-price">주문가 ($)</label><input type="number" id="today-adjust-price" step="0.01" min="0.01" value="${order.price}" /></div>
        <div class="input-group"><label for="today-adjust-shares">수량 (주)</label><input type="number" id="today-adjust-shares" step="1" min="1" value="${order.shares}" /></div>
      </div>
      <div class="today-actions">
        <button type="button" class="btn-primary" onclick="applyTodayAdjust()">이 값으로 고정</button>
        <button type="button" class="btn-secondary" onclick="closeTodayPanel()">취소</button>
      </div>
    </div>`;
}

function renderTodayOrderRow(t, plan, order, session) {
  const info = TODAY_STAGE_INFO[order.kind];
  const state = todayPriceState(t, plan, order, session);
  const after = previewPlanFill(t, plan, order);
  const panelOpen = todayPanel && todayPanel.kind === order.kind;
  const panelHTML = !panelOpen ? '' : todayPanel.type === 'fill' ? renderTodayFillPanel(plan, order) : renderTodayAdjustPanel(plan, order);

  return `
    <div class="today-order-row">
      <h3 class="today-order-main">${info.icon} ${order.shares.toLocaleString()}주 ${orderVerb(plan, order.kind)} <em>@ ${formatUSD(order.price)}</em> <small>지정가</small></h3>
      ${plan.stage === 'VR' ? '' : `<p class="today-reason">${escapeHTML(plan.reason || '직접 정한 주문가')}</p>`}
      <div class="today-price-state ${state.cls}">${state.text}</div>
      ${plan.stage === 'REBUY' ? renderRebuyWaitingNote(t) : ''}
      ${panelHTML || `
      <div class="today-actions">
        <button type="button" class="btn-primary" onclick="openTodayPanel('fill', '${order.kind}')">✅ 체결됐어요</button>
        <button type="button" class="btn-secondary" onclick="openTodayPanel('adjust', '${order.kind}')">✏️ 조정</button>
        <button type="button" class="btn-secondary" onclick="addTodayAlert('${order.kind}')">🔔 도달 알림</button>
      </div>`}
      <div class="today-after">
        <span class="today-after-title">체결되면</span>
        <div class="today-after-grid">
          <div><small>보유</small><strong>${after.shares.toLocaleString()}주</strong></div>
          <div><small>현금</small><strong>${formatUSD(after.cash)}</strong></div>
          <div><small>본전 주가</small><strong>${formatUSD(after.breakeven)}</strong></div>
          <div><small>다음 제안</small><strong>${after.nextText}</strong></div>
        </div>
      </div>
    </div>`;
}

function renderTodayRuleRow(t) {
  return isVrRule(t)
    ? `<div class="today-rule-row">
        <span>주문 규칙: <strong>VR</strong></span>
        <button type="button" class="text-link-btn" onclick="resetVrBase()">V를 지금 평가금으로 다시 잡기</button>
        <button type="button" class="text-link-btn" onclick="setPlanRule('ROTATION')">회전 규칙으로 바꾸기</button>
      </div>`
    : `<div class="today-rule-row">
        <span>주문 규칙: <strong>반등 회전</strong></span>
        <button type="button" class="text-link-btn" onclick="setPlanRule('VR')">VR 규칙으로 바꾸기</button>
      </div>`;
}

function renderTodayOrder(t, session) {
  const box = document.getElementById('today-order');
  if (!box) return;
  const plan = ensureDailyPlan(t);

  if (!plan) {
    box.innerHTML = `
      <div class="today-order today-order-idle">
        <h3>시세를 확인하는 중입니다</h3>
        <p>오늘의 주문은 최신 시세로 한 번 정합니다. 계속 이 문구가 보이면 🔑 시세 키를 확인하거나, 증권사 앱의 가격을 '현재 주가' 칸에 입력해 주세요.</p>
      </div>`;
    return;
  }
  if (plan.stage === 'EMPTY') {
    box.innerHTML = `
      <div class="today-order today-order-idle">
        <h3>보유 주식이 없습니다</h3>
        <p>⚙️ 원금기준에서 보유 수량과 평단을 입력하거나 기록장에 매수를 기록해 주세요.</p>
      </div>`;
    return;
  }
  if (plan.stage === 'DONE') {
    box.innerHTML = `
      <div class="today-order today-order-done">
        <span class="today-tag">오늘의 판단</span>
        <h3>🎉 현재가가 본전(${formatUSD(plan.price)}) 이상입니다</h3>
        <p>회전 주문을 내지 않습니다. 이제 계속 보유할지, 일부 현금화할지 결정할 차례입니다.</p>
        <div class="today-actions"><button type="button" class="btn-secondary" onclick="switchView('growth')">🌱 40분할 실제 성적 보기</button></div>
      </div>`;
    return;
  }

  const orders = planOrders(plan);
  const isVr = plan.stage === 'VR';
  const headRight = isVr
    ? 'VR'
    : `${analyzeRotations(t, t.currentPrice, todayISO()).finishedCount + 1}회차`;
  const statusHTML = isVr
    ? `<div class="today-vr-status">
        기준 평가금 V <strong>${formatUSD(t.vrValue)}</strong> · 지금 평가금 ${formatUSD(t.shares * t.currentPrice)}.
        V의 ±15%를 벗어나는 가격에만 주문합니다. 다음 V 갱신 ${escapeHTML(t.vrNextUpdate)}.
        ${plan.buyShares > 0 ? '' : '<br/>현금이 없어 매수 주문은 없습니다. 매도가 체결되면 생깁니다.'}
      </div>`
    : `<div class="today-steps">
        <span class="${plan.stage === 'SELL' ? 'active' : 'done'}">① 반등 매도</span>
        <span class="today-steps-arrow">→</span>
        <span class="${plan.stage === 'REBUY' ? 'active' : ''}">② 눌림목 재매수</span>
        <span class="today-steps-arrow">→</span>
        <span>다음 회차</span>
      </div>`;
  const ruleNote = isVr
    ? '과거 검증에서 기존 회전 규칙보다는 나았지만, TQQQ에서는 그냥 보유보다 뒤처졌고 큰 낙폭은 막지 못했습니다.'
    : '이 규칙은 과거에 그냥 보유보다 대체로 뒤처졌습니다.';

  box.innerHTML = `
    <div class="today-order ${isVr ? 'today-order-vr' : TODAY_STAGE_INFO[orders[0].kind].tone}">
      <div class="today-order-head">
        <span class="today-tag">오늘의 주문 · ${plan.tradeDay} 거래일${plan.custom ? ' · 직접 조정' : ''}</span>
        <span class="today-round">${headRight}</span>
      </div>
      ${statusHTML}
      ${orders.map(order => renderTodayOrderRow(t, plan, order, session)).join('')}
      <p class="today-note">${todaySessionHint(session)} 오늘 체결되지 않으면 기록할 것이 없고, 다음 거래일에 새 주문을 제안합니다.</p>
      <p class="today-note">규칙이 계산한 참고 주문이며 실행 여부는 본인 판단입니다. ${ruleNote} <button type="button" class="text-link-btn" onclick="switchView('rescue')">시나리오·과거 검증 보기 ➔</button></p>
      ${renderTodayRuleRow(t)}
    </div>`;
}

function renderTodayRecent(t) {
  const box = document.getElementById('today-recent');
  if (!box) return;
  const undoHTML = lastTodayFill && lastTodayFill.ticker === appState.currentTicker ? `
    <div class="today-undo">
      <span>✅ ${escapeHTML(lastTodayFill.text)} 기록 완료</span>
      <button type="button" class="text-link-btn" onclick="undoTodayFill()">되돌리기</button>
    </div>` : '';
  const labels = { SELL: '🔴 매도', BUY: '🟢 매수', DEPOSIT: '💵 입금', WITHDRAW: '🏧 인출' };
  const rows = (t.logs || []).slice(0, 3).map(item => {
    const isCash = isCashLogType(item.type);
    return `
      <div class="today-recent-row">
        <span>${escapeHTML(displayTradeDate(item))}</span>
        <span>${labels[item.type] || item.type}</span>
        <span>${isCash ? formatUSD(item.amount) : `${item.shares}주 @ ${formatUSD(item.price)}`}</span>
      </div>`;
  }).join('');
  box.innerHTML = `
    ${undoHTML}
    <div class="section-row-head">
      <h3>최근 체결</h3>
      <button type="button" class="text-link-btn" onclick="switchView('journal')">기록장 전체 ➔</button>
    </div>
    ${rows || '<div class="today-note">아직 기록이 없습니다. 주문이 체결되면 위의 ✅ 체결됐어요를 눌러 주세요.</div>'}
  `;
}

function renderTodayGrowthRow(t) {
  const box = document.getElementById('today-growth');
  if (!box) return;
  const g = t.growth;
  if (!(g.history && g.history.length > 0)) {
    box.style.display = 'none';
    return;
  }
  box.style.display = '';
  const target = g.heldShares > 0 ? g.avgPrice * (1 + g.targetProfitPct / 100) : 0;
  box.innerHTML = `
    <span>🌱 40분할 ${g.cycleCount}사이클 · ${g.heldShares > 0 ? `${g.heldShares}주 · 졸업 목표 ${formatUSD(target)}` : '첫 매수 대기'}</span>
    <button type="button" class="text-link-btn" onclick="switchView('growth')">오늘 주문표 ➔</button>
  `;
}

// 오늘의 주문이 VR일 때, 회전 규칙으로 계산하는 화면에 다른 규칙임을 알린다
function renderRuleNotices(t) {
  const notices = {
    'rescue-rule-notice': '이 화면은 <strong>반등 회전 규칙</strong>을 비교해 보는 계산기입니다. 실제 오늘의 주문은 <strong>VR 규칙</strong>을 따르므로 매도 수량과 가격이 다릅니다.',
    'chart-rule-notice': '아래 목표 매도가·재매수가는 <strong>반등 회전 규칙</strong> 기준입니다. 실제 오늘의 주문은 <strong>VR 규칙</strong>을 따르므로 가격이 다릅니다.'
  };
  Object.entries(notices).forEach(([id, text]) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = isVrRule(t) ? '' : 'none';
    el.innerHTML = `<span>${text}</span><button type="button" class="text-link-btn" onclick="switchView('overview')">오늘의 주문 ➔</button>`;
  });
}

function renderToday() {
  const t = appState.tickers[appState.currentTicker];
  renderRuleNotices(t);
  const session = currentMarketSession();
  renderTodaySession(session);
  renderTodayPosition(t);
  renderTodayRecent(t);
  renderTodayGrowthRow(t);
  if (!todayPanel) renderTodayOrder(t, session);
  renderPriceAlerts(); // 알림 버튼은 방금 정한 오늘의 주문 가격을 쓴다
}

function openTodayPanel(type, kind) {
  todayPanel = { type, kind };
  renderTodayOrder(appState.tickers[appState.currentTicker], currentMarketSession());
}

function closeTodayPanel() {
  todayPanel = null;
  renderToday();
}

function setTodayMode(mode) {
  todayPanel = null;
  setTargetMode(mode);
}

function setPlanRule(rule) {
  const t = appState.tickers[appState.currentTicker];
  t.planRule = rule;
  if (rule === 'VR') {
    t.vrValue = 0;
    t.vrNextUpdate = '';
  }
  todayPanel = null;
  saveState();
  renderToday();
}

function resetVrBase() {
  const t = appState.tickers[appState.currentTicker];
  t.vrValue = 0;
  t.vrNextUpdate = '';
  todayPanel = null;
  saveState();
  renderToday();
}

function addTodayAlert(kind) {
  const t = appState.tickers[appState.currentTicker];
  const order = findPlanOrder(t.dailyPlan, kind);
  if (order) addPriceAlert(order.price, `오늘의 ${orderVerb(t.dailyPlan, kind)}`);
}

function applyTodayAdjust() {
  const t = appState.tickers[appState.currentTicker];
  const plan = t.dailyPlan;
  const kind = todayPanel && todayPanel.kind;
  const price = parseFloat(document.getElementById('today-adjust-price').value);
  const shares = parseInt(document.getElementById('today-adjust-shares').value, 10);
  if (!plan || !kind || !(price > 0) || !(shares > 0)) {
    alert('올바른 주문가와 수량을 입력해 주세요.');
    return;
  }
  if (kind === 'SELL' && shares > t.shares) {
    alert('보유 수량보다 많이 매도할 수 없습니다.');
    return;
  }
  if (kind === 'REBUY' && shares * price * (1 + TRADING_FEE_RATE) > (t.reservedCash || 0)) {
    alert(`보유 현금 ${formatUSD(t.reservedCash || 0)}을 넘습니다. 새 돈을 넣어 살 때는 기록장에 직접 기록해 주세요.`);
    return;
  }
  if (plan.stage === 'VR' && kind === 'REBUY') {
    plan.buyPrice = Number(price.toFixed(2));
    plan.buyShares = shares;
  } else {
    plan.price = Number(price.toFixed(2));
    plan.shares = shares;
  }
  plan.custom = 1;
  plan.reason = '';
  saveState();
  closeTodayPanel();
}

function recordTodayFill() {
  const t = appState.tickers[appState.currentTicker];
  const plan = t.dailyPlan;
  const kind = todayPanel && todayPanel.kind;
  const price = parseFloat(document.getElementById('today-fill-price').value);
  const shares = parseFloat(document.getElementById('today-fill-shares').value);
  const tradeDate = document.getElementById('today-fill-date').value || todayISO();
  if (!plan || !kind || !(price > 0) || !(shares > 0)) {
    alert('올바른 체결가와 수량을 입력해 주세요.');
    return;
  }

  const verb = orderVerb(plan, kind);
  const record = recordRescueTrade(t, {
    type: kind === 'SELL' ? 'SELL' : 'BUY',
    price,
    shares,
    tradeDate,
    memo: `오늘의 주문 ${verb} 체결`
  });
  if (!record) return;

  lastTodayFill = { ticker: appState.currentTicker, id: record.id, text: `${verb} ${shares}주 @ ${formatUSD(price)}` };
  todayPanel = null;
  saveState();
  populateInputsFromState();
  recalcAll(false);
}

function undoTodayFill() {
  if (!lastTodayFill) return;
  const t = appState.tickers[lastTodayFill.ticker];
  t.logs = t.logs.filter(item => item.id !== lastTodayFill.id);
  lastTodayFill = null;
  recalculateRescueBalanceFromLogs(t);
  saveState();
  populateInputsFromState();
  recalcAll(false);
}
