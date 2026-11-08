// 화면 전환, 입력칸 동기화, 홈 대시보드와 오늘의 신호

// 5개 전용 메뉴 뷰 전환 (overview / chart / rescue / growth / journal)
let tvChartRendered = false;

function switchView(viewId) {
  const validViews = ['overview', 'chart', 'rescue', 'growth', 'journal'];
  if (!validViews.includes(viewId)) viewId = 'overview';
  appState.currentView = viewId;

  validViews.forEach(v => {
    const navEl = document.getElementById('nav-' + v);
    const pageEl = document.getElementById('view-' + v);
    if (navEl) navEl.classList.toggle('active', v === viewId);
    if (pageEl) pageEl.classList.toggle('active', v === viewId);
  });

  document.getElementById('app-shell').classList.toggle('is-home', viewId === 'overview');

  if (viewId === 'chart') {
    setTimeout(() => {
      renderTradingViewChart();
      tvChartRendered = true;
    }, 80);
  }
  if (viewId === 'growth') {
    recalcGrowthMode(false);
  }
  saveState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchMainAppMode(mode) {
  switchView(mode === 'GROWTH' ? 'growth' : 'rescue');
}

// TradingView 실제 차트 렌더링 (모바일 높이 0px 버그 방지를 위해 명시적 height 적용)
function renderTradingViewChart() {
  const ticker = appState.currentTicker;
  // SOXL은 NYSE Arca(TradingView 표기 AMEX), TQQQ는 나스닥 상장
  const symbol = { SOXL: 'AMEX:SOXL', TQQQ: 'NASDAQ:TQQQ' }[ticker] || `AMEX:${ticker}`;

  const titleEl = document.getElementById('chart-title');
  if (titleEl) {
    titleEl.textContent = `${ticker} 차트 (볼린저밴드 + RSI)`;
  }

  const container = document.getElementById('tv_chart_container');
  if (!container) return;

  if (typeof TradingView === 'undefined') {
    container.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#64748b;font-weight:600;">차트를 불러오는 중입니다.</div>`;
    // 모바일 느린 네트워크에서 스크립트 로드 완료 후 자동 재시도
    setTimeout(renderTradingViewChart, 800);
    return;
  }

  container.innerHTML = '';
  const isMobile = window.innerWidth <= 768;
  const chartHeight = isMobile ? 390 : 520;

  new TradingView.widget({
    width: '100%',
    height: chartHeight,
    symbol: symbol,
    interval: 'D', // 봉 간격은 TradingView 상단 메뉴에서 바꾼다
    timezone: 'Asia/Seoul',
    theme: 'light',
    style: '1',
    locale: 'kr',
    toolbar_bg: '#ffffff',
    enable_publishing: false,
    hide_top_toolbar: false,
    hide_side_toolbar: isMobile,
    hide_legend: false,
    save_image: false,
    container_id: 'tv_chart_container',
    studies: [
      'BB@tv-basicstudies',
      'RSI@tv-basicstudies'
    ]
  });
}

function setTargetMode(mode) {
  appState.targetMode = mode;
  ['SHORT', 'MID', 'HIGH'].forEach(m => {
    const cls = '.mode-' + m.toLowerCase() + '-btn';
    document.querySelectorAll(cls).forEach(el => {
      el.classList.toggle('active', m === mode);
    });
  });
  const t = appState.tickers[appState.currentTicker];
  computeRealisticTargets(t, true);
  saveState();
  recalcAll(false);
}

function switchTicker(ticker) {
  appState.currentTicker = ticker;
  document.getElementById('btn-soxl').classList.toggle('active', ticker === 'SOXL');
  document.getElementById('btn-tqqq').classList.toggle('active', ticker === 'TQQQ');
  populateInputsFromState();
  tvChartRendered = false;
  if (appState.currentView === 'chart') {
    renderTradingViewChart();
    tvChartRendered = true;
  }
  recalcAll(false);
  recalcGrowthMode(false);
  fetchMarketDataAndAnalyze();
}

function populateInputsFromState() {
  const t = appState.tickers[appState.currentTicker];
  ensurePrincipalAnchor(t);

  document.getElementById('current-price').value = t.currentPrice;

  document.getElementById('sell-ratio-slider').value = t.sellRatio;
  document.getElementById('sim-sell-price').value = t.simSellPrice;
  document.getElementById('drop-ratio-slider').value = t.dropRatio;
  document.getElementById('sim-buy-price').value = t.simBuyPrice;

  const mode = appState.targetMode || 'MID';
  ['SHORT', 'MID', 'HIGH'].forEach(m => {
    const cls = '.mode-' + m.toLowerCase() + '-btn';
    document.querySelectorAll(cls).forEach(el => {
      el.classList.toggle('active', m === mode);
    });
  });

  // Growth 모드 입력창 동기화
  const g = t.growth;
  document.getElementById('g-total-budget').value = growthSeedUnset(t) ? '' : g.totalBudget;
  document.getElementById('g-total-budget').placeholder = `가용 현금 ${formatUSD(t.reservedCash || 0)}`;
  document.getElementById('g-splits').value = g.splits;
  document.getElementById('g-target-profit').value = g.targetProfitPct;

  updateAnchorBanner(t);
}

function updateAnchorBanner(t) {
  ensurePrincipalAnchor(t);
  const bannerEl = document.getElementById('account-anchor-banner');
  if (!bannerEl) return;

  const baseText = `${t.baseShares}주 × ${formatUSD(t.baseAvgPrice)}` +
    (t.baseCash > 0 ? ` + 시작 현금 ${formatUSD(t.baseCash)}` : '');
  const added = t.addedPrincipal || 0;
  const addedText = added !== 0
    ? ` ${added > 0 ? '+ 추가 투입' : '- 인출'} <strong>${formatUSD(Math.abs(added))}</strong>`
    : '';

  if (t.logs && t.logs.length > 0) {
    bannerEl.innerHTML = `최초 원금 <strong>${formatUSD(t.originalPrincipal)}</strong>${addedText} <small>(${baseText} · 기록 ${t.logs.length}건 반영: ${t.baseShares}주 ➔ ${t.shares}주)</small>`;
  } else {
    bannerEl.innerHTML = `회복 목표 원금: <strong id="anchor-principal-text">${formatUSD(t.originalPrincipal)}</strong> (${baseText})`;
  }
}

function resetInitialAnchor() {
  const t = appState.tickers[appState.currentTicker];
  ensurePrincipalAnchor(t);
  const sInput = prompt(
    `[${appState.currentTicker}] 구출 작전을 시작하기 전 '최초 보유 주식 수(주)'를 입력해 주세요:`,
    String(t.baseShares)
  );
  if (sInput === null) return;
  const pInput = prompt(
    `[${appState.currentTicker}] 구출 작전을 시작하기 전 '최초 매입 평단가($)'를 입력해 주세요:`,
    String(t.baseAvgPrice)
  );
  if (pInput === null) return;
  const cInput = prompt(
    `[${appState.currentTicker}] 구출 작전을 시작할 때 이미 갖고 있던 '구출 현금($)'이 있다면 입력해 주세요 (없으면 0):`,
    String(t.baseCash || 0)
  );
  if (cInput === null) return;

  const bs = parseFloat(sInput);
  const bp = parseFloat(pInput);
  const bc = parseFloat(cInput) || 0;
  if (!bs || !bp || bs <= 0 || bp <= 0 || bc < 0) {
    alert('올바른 주식 수, 평단가, 현금을 입력해 주세요.');
    return;
  }

  t.baseShares = bs;
  t.baseAvgPrice = bp;
  t.baseCash = Number(bc.toFixed(2));
  t.originalPrincipal = Number((bs * bp).toFixed(2));
  recalculateRescueBalanceFromLogs(t);

  saveState();
  populateInputsFromState();
  recalcAll(false);
}

// 보유 수량·평단·현금은 원금 기준점과 매매 기록에서만 계산하므로 여기서는 읽지 않는다
function syncInputsToState() {
  const t = appState.tickers[appState.currentTicker];
  ensurePrincipalAnchor(t);

  const typedPrice = parseFloat(document.getElementById('current-price').value);
  if (typedPrice > 0 && typedPrice !== t.currentPrice) {
    // 증권사 앱에서 확인한 가격을 직접 입력한 경우도 최신 시세로 인정
    t.currentPrice = typedPrice;
    t.lastQuoteAt = Date.now();
    t.quoteSource = '직접 입력';
    t.quoteSessionKey = 'MANUAL';
    t.quoteAsOfDate = newYorkClock(Date.now()).date;
  }

  t.sellRatio = parseFloat(document.getElementById('sell-ratio-slider').value) || 20;
  t.simSellPrice = parseFloat(document.getElementById('sim-sell-price').value) || t.currentPrice;
  t.dropRatio = parseFloat(document.getElementById('drop-ratio-slider').value) || 10;
  t.simBuyPrice = parseFloat(document.getElementById('sim-buy-price').value) || 0;

  updateAnchorBanner(t);
  saveState();
}

// 기준 가격(cur)에서 반등 기준별 매도 목표가를 계산한다. 차트 화면은 현재가, 오늘의 주문은 고정된 기준가를 넣는다
function computeSellTargets(t, cur) {
  const totalPrincipal = getTotalPrincipal(t) || (t.shares * t.avgPrice);
  const breakevenPrice = t.shares > 0 ? Math.max(0, totalPrincipal - (t.reservedCash || 0)) / t.shares : t.avgPrice;
  const mode = appState.targetMode || 'MID';

  let shortTarget = cur * 1.045;
  let shortReason = `현재가(${formatUSD(cur)}) 대비 +4.5% 단기 반등 목표가`;
  if (t.sma5 && t.sma5 > cur * 1.02 && t.sma5 < cur * 1.08) {
    shortTarget = t.sma5;
    shortReason = `최근 5일 이동평균선(${formatUSD(t.sma5)}) 1차 단기 저항선`;
  }

  let midTarget = cur * 1.09;
  let midReason = `현재가(${formatUSD(cur)}) 대비 +9.0% 표준 스윙 반등 목표가`;
  if (t.sma20 && t.sma20 > cur * 1.05 && t.sma20 < cur * 1.15) {
    midTarget = t.sma20;
    midReason = `최근 20일 이동평균선·볼린저 중심선(${formatUSD(t.sma20)}) 핵심 저항선`;
  }

  let highTarget = cur * 1.15;
  let highReason = `현재가(${formatUSD(cur)}) 대비 +15.0% 강한 반등 목표가`;
  if (t.recentHigh && t.recentHigh > cur * 1.10 && t.recentHigh < cur * 1.25) {
    highTarget = t.recentHigh;
    highReason = `최근 2주(14일) 최고점(${formatUSD(t.recentHigh)}) 전고점 저항선`;
  }

  let rawSell1 = midTarget;
  let rawSell2 = highTarget;
  let chosenReason = midReason;

  if (mode === 'SHORT') {
    rawSell1 = shortTarget;
    rawSell2 = midTarget;
    chosenReason = shortReason;
  } else if (mode === 'MID') {
    rawSell1 = midTarget;
    rawSell2 = highTarget;
    chosenReason = midReason;
  } else if (mode === 'HIGH') {
    rawSell1 = highTarget;
    rawSell2 = Math.max(highTarget * 1.05, cur * 1.20);
    chosenReason = highReason;
  }

  if (cur < breakevenPrice) {
    const gapToBreakeven = breakevenPrice - cur;
    const maxAllowedSell1 = cur + gapToBreakeven * 0.65;
    const maxAllowedSell2 = cur + gapToBreakeven * 0.88;

    if (rawSell1 > maxAllowedSell1) {
      rawSell1 = maxAllowedSell1;
      chosenReason = `현재가(${formatUSD(cur)})와 본전(${formatUSD(breakevenPrice)}) 사이의 단기 저항 목표 구간`;
    }
    rawSell2 = Math.min(rawSell2, maxAllowedSell2);
    rawSell1 = Math.max(cur * 1.02, rawSell1);
    rawSell2 = Math.max(rawSell1 * 1.03, rawSell2);
  }

  return { sell1: rawSell1, sell2: rawSell2, reason: chosenReason };
}

function computeRealisticTargets(t, forceSyncToSim = false) {
  ensurePrincipalAnchor(t);
  const cur = t.currentPrice;
  const totalPrincipal = getTotalPrincipal(t) || (t.shares * t.avgPrice);
  const breakevenPrice = t.shares > 0 ? Math.max(0, totalPrincipal - (t.reservedCash || 0)) / t.shares : t.avgPrice;
  const { sell1: rawSell1, sell2: rawSell2, reason: chosenReason } = computeSellTargets(t, cur);

  t.autoSellTarget1 = Number(rawSell1.toFixed(2));
  t.autoSellTarget2 = Number(rawSell2.toFixed(2));
  t.sellReasonText = chosenReason;

  t.autoBuyTarget1 = Number((t.autoSellTarget1 * 0.90).toFixed(2));
  t.autoBuyTarget2 = Number(Math.min(cur * 0.90, t.bbLower > 0 ? t.bbLower : cur * 0.88).toFixed(2));

  if (forceSyncToSim || !t.simSellPrice || t.simSellPrice >= breakevenPrice) {
    t.simSellPrice = t.autoSellTarget1;
    const dropRatio = t.dropRatio || 10;
    t.simBuyPrice = Number((t.simSellPrice * (1 - dropRatio / 100)).toFixed(2));
    const simSellEl = document.getElementById('sim-sell-price');
    const simBuyEl = document.getElementById('sim-buy-price');
    if (simSellEl) simSellEl.value = t.simSellPrice;
    if (simBuyEl) simBuyEl.value = t.simBuyPrice;
  }
}

function applyAutoTargetsToSimulator() {
  const t = appState.tickers[appState.currentTicker];
  computeRealisticTargets(t, true);
  runSimulator(false, true);
}

function recalcAll(syncFromDOM = true) {
  if (syncFromDOM) {
    syncInputsToState();
  }
  const t = appState.tickers[appState.currentTicker];
  ensurePrincipalAnchor(t);
  computeRealisticTargets(t, false);

  const totalPrincipal = getTotalPrincipal(t) || (t.shares * t.avgPrice);
  const currentEval = (t.shares * t.currentPrice) + (t.reservedCash || 0);
  const diff = currentEval - totalPrincipal;
  const lossRate = totalPrincipal > 0 ? (diff / totalPrincipal) * 100 : 0;

  const neededFromStock = Math.max(0, totalPrincipal - (t.reservedCash || 0));
  const breakevenPrice = t.shares > 0 ? neededFromStock / t.shares : 0;
  const neededRiseRate = t.currentPrice > 0 ? ((breakevenPrice - t.currentPrice) / t.currentPrice) * 100 : 0;

  updateAnchorBanner(t);

  document.getElementById('total-principal').textContent = formatUSD(totalPrincipal);
  document.getElementById('total-principal-krw').textContent = formatKRW(totalPrincipal);
  document.getElementById('current-eval').textContent = formatUSD(currentEval);

  const lossEl = document.getElementById('current-loss-rate');
  const sign = diff >= 0 ? '+' : '';
  lossEl.textContent = formatSignedUSD(diff);
  lossEl.style.color = diff >= 0 ? 'var(--up)' : 'var(--down)';
  const lossPctEl = document.getElementById('current-loss-pct');
  lossPctEl.textContent = `${sign}${lossRate.toFixed(2)}%`;
  lossPctEl.style.color = lossEl.style.color;

  document.getElementById('breakeven-price').textContent = formatUSD(breakevenPrice);
  document.getElementById('needed-rise-rate').innerHTML =
    neededRiseRate > 0
      ? `<strong>+${neededRiseRate.toFixed(1)}%</strong> 올라야 본전`
      : `<strong>본전 이상</strong>`;

  updateAutoSignalDashboard(breakevenPrice);
  runSimulator(false, false);
  renderLogs();
  renderToday();
}

const TODAY_ORDER_POINTER = `시장 위치를 고정 규칙으로 읽은 참고 지표이며, 이후 방향을 예측하지 않습니다. 실제 주문 가격과 수량은 <button type="button" class="text-link-btn" onclick="switchView('overview')">오늘의 주문</button>에서 확인하세요.`;

const WEEKDAY_KO = ['일', '월', '화', '수', '목', '금', '토'];

// 시세 출처와 시장 데이터 기준 시각 (앱이 불러온 시각과 구분한다)
function formatQuoteAsOf(t) {
  if (!t.quoteSource || !t.quoteAsOfDate) return '';
  if (t.quoteSessionKey === 'MANUAL') return `직접 입력 · ${formatSeoulTime(t.lastQuoteAt)} 기준`;
  const [, month, day] = t.quoteAsOfDate.split('-').map(Number);
  const weekday = WEEKDAY_KO[new Date(`${t.quoteAsOfDate}T00:00:00Z`).getUTCDay()];
  const key = t.quoteSessionKey;
  const live = key === currentMarketSession().key;
  const when = { PRE: live ? '프리장 진행 중' : '프리장 마감', REGULAR: live ? '본장 진행 중' : '본장', AFTER: live ? '애프터 진행 중' : '애프터 마감', CLOSE: '본장 마감' }[key] || '';
  return `${t.quoteSource} · ${month}/${day}(${weekday}) ${when}`.trim();
}

function renderQuoteSource(t) {
  const label = formatQuoteAsOf(t);
  const fresh = isQuoteFresh(t);
  const line = document.getElementById('quote-source-line');
  line.textContent = !label ? '시세 미확인' : fresh ? label : `마지막 확인 ${label}`;
  line.classList.toggle('is-stale', !fresh);
  document.getElementById('settings-quote-asof').textContent = label ? `시세 기준: ${label}` : '시세 기준 시각 없음';
}

function bollingerPositionText(percentB) {
  if (percentB <= 20) return '볼린저 하단 근처';
  if (percentB >= 80) return '볼린저 상단 근처';
  return '볼린저 밴드 중간';
}

function updateAutoSignalDashboard(breakevenPrice) {
  const ticker = appState.currentTicker;
  const t = appState.tickers[ticker];
  const cur = t.currentPrice;
  const prev = t.prevClose || cur;
  const change = cur - prev;
  const changePct = prev > 0 ? (change / prev) * 100 : 0;

  document.getElementById('quote-ticker-label').textContent = `${ticker}`;
  document.getElementById('live-price-display').textContent = formatUSD(cur);
  const fwpMirror = document.getElementById('fwp-live-price-mirror');
  if (fwpMirror) fwpMirror.textContent = formatUSD(cur);

  const chgEl = document.getElementById('live-change-display');
  const chgSign = change >= 0 ? '+' : '';
  chgEl.textContent = `${chgSign}${change.toFixed(2)} (${chgSign}${changePct.toFixed(2)}%)`;
  chgEl.classList.toggle('is-up', change > 0);
  chgEl.classList.toggle('is-down', change < 0);
  renderQuoteSource(t);

  document.getElementById('live-day-range').textContent = `${formatUSD(t.dayLow || cur * 0.97)} ~ ${formatUSD(t.dayHigh || cur * 1.03)}`;
  document.getElementById('live-14d-range').textContent = `${formatUSD(t.recentLow)} ~ ${formatUSD(t.recentHigh)}`;

  const rsi = t.rsi || 50;
  const sma5 = t.sma5 || cur * 1.045;
  const sma20 = t.sma20 || cur * 1.09;
  const bbUpper = t.bbUpper || cur * 1.15;
  const bbLower = t.bbLower || cur * 0.90;

  document.getElementById('ind-rsi-val').textContent = `${rsi.toFixed(1)} 점`;
  document.getElementById('ind-rsi-status').textContent =
    rsi >= 60 ? '단기 과열 (60 이상)' : rsi <= 38 ? '단기 과매도 (38 이하)' : '중립 (38~60)';

  document.getElementById('ind-sma20-val').textContent = `5일 ${formatUSD(sma5)} / 20일 ${formatUSD(sma20)}`;
  document.getElementById('ind-sma20-status').textContent =
    cur < sma5 ? '1차 저항: 5일선 / 2차 저항: 20일선' : '5일선 위 · 다음 저항: 20일선';

  const sell1Pct = (((t.autoSellTarget1 - cur) / cur) * 100).toFixed(1);
  const sell2Pct = (((t.autoSellTarget2 - cur) / cur) * 100).toFixed(1);
  document.getElementById('ind-sell-target').textContent = `${formatUSD(t.autoSellTarget1)} (+${sell1Pct}%) / ${formatUSD(t.autoSellTarget2)} (+${sell2Pct}%)`;
  document.getElementById('ind-sell-basis').textContent = t.sellReasonText || '선택한 반등 기준 적용';

  const buy1Pct = (((t.autoSellTarget1 - t.autoBuyTarget1) / t.autoSellTarget1) * 100).toFixed(0);
  document.getElementById('ind-buy-target').textContent = `${formatUSD(t.autoBuyTarget1)} (매도가 -${buy1Pct}%) / ${formatUSD(t.autoBuyTarget2)}`;
  document.getElementById('ind-buy-basis').textContent = `1차 매도 체결 후 -10% 눌림목 & 볼린저 하단`;

  const rationaleBox = document.getElementById('target-rationale-box');
  if (rationaleBox) {
    rationaleBox.innerHTML = `
      <strong>회전 규칙 목표 매도가 ${formatUSD(t.autoSellTarget1)}의 산출 근거</strong><br/>
      • 현재 주가 ${formatUSD(cur)} 기준 <strong>${t.sellReasonText}</strong><br/>
      • 기준별 비교: 짧은 회전(5일선·+4.5%) <strong>${formatUSD(t.sma5 && t.sma5 > cur * 1.02 ? t.sma5 : cur * 1.045)}</strong> · 표준 반등(20일선·+9%) <strong>${formatUSD(t.sma20 && t.sma20 > cur * 1.05 ? t.sma20 : cur * 1.09)}</strong> · 강한 반등(2주고점·+15%) <strong>${formatUSD(t.recentHigh && t.recentHigh > cur * 1.1 ? t.recentHigh : cur * 1.15)}</strong>
    `;
  }

  const bbWidth = Math.max(0.01, bbUpper - bbLower);
  const percentB = Math.min(100, Math.max(0, ((cur - bbLower) / bbWidth) * 100));
  const timingScore = Math.round(rsi * 0.5 + percentB * 0.5);
  const bandText = bollingerPositionText(percentB);

  document.getElementById('timing-meter-fill').style.left = `${Math.min(96, Math.max(4, timingScore))}%`;
  const meter = document.getElementById('timing-meter');
  meter.setAttribute('aria-valuenow', String(timingScore));

  const box = document.getElementById('signal-result-box');
  const lSell = document.getElementById('light-sell');
  const lWait = document.getElementById('light-wait');
  const lBuy = document.getElementById('light-buy');
  const title = document.getElementById('signal-title');
  const desc = document.getElementById('signal-desc');
  const recipe = document.getElementById('signal-action-recipe');
  const scoreLabel = document.getElementById('score-label-text');

  lSell.classList.remove('active');
  lWait.classList.remove('active');
  lBuy.classList.remove('active');
  box.className = 'signal-box';

  if (!isQuoteFresh(t)) {
    box.classList.add('neutral');
    scoreLabel.textContent = '타이밍 점수: 보류 (시세 미확인)';
    meter.setAttribute('aria-valuetext', '보류, 시세 미확인');
    title.textContent = '시세 미확인: 구간 판단을 보류합니다';
    desc.textContent = `마지막으로 확인된 가격(${formatUSD(cur)})은 실제 시세와 다를 수 있습니다.`;
    recipe.innerHTML = `상단 새로고침으로 다시 불러오거나, <button type="button" class="text-link-btn" onclick="openManualPrice()">증권사 앱의 가격을 직접 입력</button>하면 다시 계산됩니다.`;
    return;
  }

  if (timingScore >= 64 || rsi >= 62) {
    box.classList.add('sell-mode');
    lSell.classList.add('active');
    scoreLabel.textContent = `타이밍 점수: ${timingScore}점 (단기 과열)`;
    meter.setAttribute('aria-valuetext', `${timingScore}점, 단기 과열`);
    title.textContent = `단기 과열 구간 (RSI ${rsi.toFixed(1)} · ${bandText})`;
    desc.textContent = `현재가 ${formatUSD(cur)} · 볼린저 상단 ${formatUSD(bbUpper)}.`;
    recipe.innerHTML = TODAY_ORDER_POINTER;
  } else if (timingScore <= 36 || rsi <= 38 || cur <= bbLower * 1.02) {
    box.classList.add('buy-mode');
    lBuy.classList.add('active');
    scoreLabel.textContent = `타이밍 점수: ${timingScore}점 (단기 과매도)`;
    meter.setAttribute('aria-valuetext', `${timingScore}점, 단기 과매도`);
    title.textContent = `단기 과매도 구간 (RSI ${rsi.toFixed(1)} · ${bandText})`;
    desc.textContent = `현재가 ${formatUSD(cur)} · 볼린저 하단 ${formatUSD(bbLower)}.`;
    recipe.innerHTML = TODAY_ORDER_POINTER;
  } else {
    box.classList.add('neutral');
    lWait.classList.add('active');
    scoreLabel.textContent = `타이밍 점수: ${timingScore}점 (중립)`;
    meter.setAttribute('aria-valuetext', `${timingScore}점, 중립`);
    title.textContent = `중립 구간 (RSI ${rsi.toFixed(1)} · ${bandText})`;
    desc.textContent = `현재가 ${formatUSD(cur)} · 볼린저 밴드 ${formatUSD(bbLower)} ~ ${formatUSD(bbUpper)}.`;
    recipe.innerHTML = TODAY_ORDER_POINTER;
  }
}
