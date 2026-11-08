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
  const interval = appState.chartInterval || 'D';
  // SOXL은 NYSE Arca(TradingView 표기 AMEX), TQQQ는 나스닥 상장
  const symbol = { SOXL: 'AMEX:SOXL', TQQQ: 'NASDAQ:TQQQ' }[ticker] || `AMEX:${ticker}`;

  const titleEl = document.getElementById('chart-title');
  if (titleEl) {
    titleEl.textContent = `📈 ${ticker} 실시간 차트 (볼린저밴드 + RSI 자동 표시)`;
  }

  const container = document.getElementById('tv_chart_container');
  if (!container) return;

  if (typeof TradingView === 'undefined') {
    container.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#64748b;font-weight:600;">📈 실시간 차트를 불러오는 중입니다... 잠시만 기다려 주세요.</div>`;
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
    interval: interval,
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

function changeChartInterval(interval) {
  appState.chartInterval = interval;
  ['D', '60', '15'].forEach(id => {
    const el = document.getElementById('int-' + id);
    if (el) el.classList.toggle('active', id === interval);
  });
  saveState();
  renderTradingViewChart();
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

  document.getElementById('initial-shares').value = t.shares;
  document.getElementById('avg-price').value = Number(t.avgPrice.toFixed(2));
  document.getElementById('current-price').value = t.currentPrice;
  document.getElementById('reserved-cash').value = Number((t.reservedCash || 0).toFixed(2));

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
  document.getElementById('g-total-budget').value = g.totalBudget;
  document.getElementById('g-splits').value = g.splits;
  document.getElementById('g-target-profit').value = g.targetProfitPct;
  document.getElementById('g-held-shares').value = g.heldShares;
  document.getElementById('g-avg-price').value = g.avgPrice || t.currentPrice;

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
    bannerEl.innerHTML = `🔒 최초 원금 <strong>${formatUSD(t.originalPrincipal)}</strong>${addedText} <small>(${baseText} · 기록 ${t.logs.length}건 반영: ${t.baseShares}주 ➔ ${t.shares}주)</small>`;
  } else {
    bannerEl.innerHTML = `🔒 회복 목표 원금: <strong id="anchor-principal-text">${formatUSD(t.originalPrincipal)}</strong> (${baseText})`;
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
  }

  t.sellRatio = parseFloat(document.getElementById('sell-ratio-slider').value) || 20;
  t.simSellPrice = parseFloat(document.getElementById('sim-sell-price').value) || t.currentPrice;
  t.dropRatio = parseFloat(document.getElementById('drop-ratio-slider').value) || 10;
  t.simBuyPrice = parseFloat(document.getElementById('sim-buy-price').value) || 0;

  updateAnchorBanner(t);
  saveState();
}

function computeRealisticTargets(t, forceSyncToSim = false) {
  ensurePrincipalAnchor(t);
  const cur = t.currentPrice;
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
  lossEl.textContent = `${sign}${lossRate.toFixed(2)}% (${sign}${formatUSD(diff)})`;
  lossEl.style.color = diff >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

  document.getElementById('breakeven-price').textContent = formatUSD(breakevenPrice);
  document.getElementById('needed-rise-rate').innerHTML =
    neededRiseRate > 0
      ? `현재가 대비 <strong>+${neededRiseRate.toFixed(1)}%</strong> 상승 필요`
      : `<strong>🎉 본전 탈출 목표 달성!</strong>`;

  if (t.currentPrice >= breakevenPrice) {
    document.getElementById('why-hard-explanation').innerHTML = `
      🎉 <strong>축하합니다! 현재 주가(${formatUSD(t.currentPrice)})가 내 본전 탈출 목표가(${formatUSD(breakevenPrice)}) 이상입니다!</strong>
      다음 운용을 고민 중이라면 <strong>[🌱 40분할]</strong> 메뉴의 🧪 과거 검증에서 이 규칙의 실제 성적(최대 낙폭·갇힌 기간 포함)부터 확인해 보세요.
    `;
  } else {
    const bouncePct = (((t.autoSellTarget1 - t.currentPrice) / t.currentPrice) * 100).toFixed(1);
    document.getElementById('why-hard-explanation').innerHTML = `
      현재 주가(<strong>${formatUSD(t.currentPrice)}</strong>)에서 본전(<strong>${formatUSD(breakevenPrice)}</strong>)까지 한 번에 가려면 <strong>+${neededRiseRate.toFixed(1)}%</strong> 올라야 합니다.
      본전(${formatUSD(breakevenPrice)})까지 마냥 기다리지 말고, 현재가에서 <strong>+${bouncePct}%</strong> 반등해 <strong>추천 목표 매도가(${formatUSD(t.autoSellTarget1)})</strong>에 닿을 때 보유 물량의 15~20%를 일단 팔고, 다시 눌렸을 때 사서 <strong>탈출 기준선 자체를 ${formatUSD(breakevenPrice)} 아래로 끌어내리세요!</strong>
    `;
  }

  updateAutoSignalDashboard(breakevenPrice);
  runSimulator(false, false);
  renderLogs();
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

  document.getElementById('live-day-range').textContent = `${formatUSD(t.dayLow || cur * 0.97)} ~ ${formatUSD(t.dayHigh || cur * 1.03)}`;
  document.getElementById('live-14d-range').textContent = `${formatUSD(t.recentLow)} ~ ${formatUSD(t.recentHigh)}`;

  const rsi = t.rsi || 50;
  const sma5 = t.sma5 || cur * 1.045;
  const sma20 = t.sma20 || cur * 1.09;
  const bbUpper = t.bbUpper || cur * 1.15;
  const bbLower = t.bbLower || cur * 0.90;

  document.getElementById('ind-rsi-val').textContent = `${rsi.toFixed(1)} 점`;
  document.getElementById('ind-rsi-status').textContent =
    rsi >= 60 ? '🔴 단기 과열 (매도·익절 유리)' : rsi <= 38 ? '🟢 단기 과매도 (저점 매수 유리)' : '🟡 중립 구간 (38~60 사이)';

  document.getElementById('ind-sma20-val').textContent = `5일 ${formatUSD(sma5)} / 20일 ${formatUSD(sma20)}`;
  document.getElementById('ind-sma20-status').textContent =
    cur < sma5 ? '1차 저항: 5일선 / 2차 저항: 20일선' : '5일선 돌파 완료! 20일선 저항 도전 중';

  const sell1Pct = (((t.autoSellTarget1 - cur) / cur) * 100).toFixed(1);
  const sell2Pct = (((t.autoSellTarget2 - cur) / cur) * 100).toFixed(1);
  document.getElementById('ind-sell-target').textContent = `${formatUSD(t.autoSellTarget1)} (+${sell1Pct}%) / ${formatUSD(t.autoSellTarget2)} (+${sell2Pct}%)`;
  document.getElementById('ind-sell-basis').textContent = t.sellReasonText || '선택한 반등 기준 적용';

  const buy1Pct = (((t.autoSellTarget1 - t.autoBuyTarget1) / t.autoSellTarget1) * 100).toFixed(0);
  document.getElementById('ind-buy-target').textContent = `${formatUSD(t.autoBuyTarget1)} (매도가 -${buy1Pct}%) / ${formatUSD(t.autoBuyTarget2)}`;
  document.getElementById('ind-buy-basis').textContent = `1차 매도 체결 후 -10% 눌림목 & 볼린저 하단`;

  const topSellEl = document.getElementById('top-sell-target');
  const topBuyEl = document.getElementById('top-buy-target');
  if (topSellEl) topSellEl.textContent = `${formatUSD(t.autoSellTarget1)} (+${sell1Pct}%)`;
  if (topBuyEl) topBuyEl.textContent = `${formatUSD(t.autoBuyTarget1)}`;

  const rationaleBox = document.getElementById('target-rationale-box');
  if (rationaleBox) {
    rationaleBox.innerHTML = `
      <strong>🧐 왜 추천 목표 매도가가 [${formatUSD(t.autoSellTarget1)}]으로 계산되었나요? (산출 근거)</strong><br/>
      • <strong>현재 주가(${formatUSD(cur)})</strong> 기준으로, 차트상 단기 반등이 나올 때 매물대 벽에 부딪혀 다시 꺾이기 쉬운 <strong>[${t.sellReasonText}]</strong> 지점이기 때문입니다.<br/>
      • <strong>기준별 비교:</strong> ⚡짧은 회전(5일선·+4.5%): <strong>${formatUSD(t.sma5 && t.sma5 > cur * 1.02 ? t.sma5 : cur * 1.045)}</strong> ｜ ⚖️표준 반등(20일선·+9%): <strong>${formatUSD(t.sma20 && t.sma20 > cur * 1.05 ? t.sma20 : cur * 1.09)}</strong> ｜ 🚀강한 반등(2주고점·+15%): <strong>${formatUSD(t.recentHigh && t.recentHigh > cur * 1.1 ? t.recentHigh : cur * 1.15)}</strong>
    `;
  }

  const bbWidth = Math.max(0.01, bbUpper - bbLower);
  const percentB = Math.min(100, Math.max(0, ((cur - bbLower) / bbWidth) * 100));
  const timingScore = Math.round(rsi * 0.5 + percentB * 0.5);

  document.getElementById('timing-meter-fill').style.left = `${Math.min(96, Math.max(4, timingScore))}%`;

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
    title.textContent = '⚠️ 최신 시세가 확인되지 않아 오늘의 추천 행동을 보류합니다.';
    desc.textContent = `마지막으로 확인된 가격(${formatUSD(cur)})은 실제 시세와 다를 수 있습니다.`;
    recipe.innerHTML = `• 상단 🔄 버튼으로 시세를 다시 불러오거나, 증권사 앱에서 확인한 현재가를 <strong>[현재 주가]</strong> 칸에 직접 입력하면 신호가 다시 계산됩니다.`;
    return;
  }

  const sell20Shares = Math.round(t.shares * 0.2);
  const sell15Shares = Math.round(t.shares * 0.15);

  if (timingScore >= 64 || rsi >= 62) {
    box.classList.add('sell-mode');
    lSell.classList.add('active');
    scoreLabel.textContent = `타이밍 점수: ${timingScore}점 (🔴 단기 반등 과열 - 매도·익절 적기!)`;
    title.textContent = `🔴 지금은 [단기 반등 고점 구간]입니다! 일부 매도 또는 익절에 유리한 타이밍입니다.`;
    desc.textContent = `단기 지표(RSI ${rsi.toFixed(1)})가 과열되어 한 차례 눌림목 조정이 나올 가능성이 높습니다.`;
    const rebuyTarget = (cur * 0.90).toFixed(2);
    recipe.innerHTML = `
      <strong>📌 모드별 오늘 밤 추천 행동:</strong><br/>
      • <strong>[원금 탈출 모드]:</strong> 보유 중인 ${t.shares}주 중 <strong>${sell20Shares}주(20%)</strong>를 <strong>${formatUSD(cur)} ~ ${formatUSD(t.autoSellTarget1)}</strong>에 분할 매도 후, <strong>$${rebuyTarget} 이하</strong>에서 다시 사세요.<br/>
      • <strong>[수익 창출 모드]:</strong> 평단가 대비 수익 구간이라면 욕심내지 말고 익절하거나 오늘 매수량을 절반(0.5회분)으로 줄이세요!
    `;
  } else if (timingScore <= 36 || rsi <= 38 || cur <= bbLower * 1.02) {
    box.classList.add('buy-mode');
    lBuy.classList.add('active');
    scoreLabel.textContent = `타이밍 점수: ${timingScore}점 (🟢 단기 바닥 과매도 - 매수 적기!)`;
    title.textContent = `🟢 지금은 [단기 과매도 바닥 구간]입니다! 저점 매수·재매수에 가장 유리한 타이밍입니다.`;
    desc.textContent = `최근 하락으로 현재가(${formatUSD(cur)})가 단기 바닥권(볼린저 하단 ${formatUSD(bbLower)}, RSI ${rsi.toFixed(1)})에 진입했습니다.`;
    recipe.innerHTML = `
      <strong>📌 모드별 오늘 밤 추천 행동:</strong><br/>
      • <strong>[원금 탈출 모드]:</strong> 규칙상 지금은 매도 구간이 아닙니다. 아껴둔 구출 현금이 있다면 지금 투입해 주식 수를 늘리세요.<br/>
      • <strong>[수익 창출 모드]:</strong> 평단가를 확 낮출 수 있는 찬스입니다! 오늘 1회분 매수 금액보다 <strong>1.5배 부스터 매수</strong>를 추천합니다!
    `;
  } else {
    box.classList.add('neutral');
    lWait.classList.add('active');
    scoreLabel.textContent = `타이밍 점수: ${timingScore}점 (🟡 중립 구간 - 규칙대로 지정가 주문)`;
    title.textContent = `🟡 현재가(${formatUSD(cur)})는 중립 위치입니다. 아래 목표 타점에 지정가 주문을 걸어두세요!`;
    desc.textContent = `급하게 추격 매수/매도하기보다 정해진 규칙대로 예약 주문을 걸어두는 것이 가장 안전합니다.`;
    const expectedRebuyAfterSell1 = (t.autoSellTarget1 * 0.90).toFixed(2);
    recipe.innerHTML = `
      <strong>📌 모드별 오늘 밤 추천 행동:</strong><br/>
      • <strong>[원금 탈출 모드]:</strong> 1차 반등 저항선인 <strong>${formatUSD(t.autoSellTarget1)}</strong>(+${sell1Pct}%)에 <strong>${sell15Shares}주(15%)</strong> 지정가 매도를 걸어두세요. (체결 시 $${expectedRebuyAfterSell1} 이하 재매수)<br/>
      • <strong>[수익 창출 모드]:</strong> 오늘 배정된 <strong>1회분 금액만큼 정석대로 분할 매수</strong>하고 목표 수익률(+10%) 지정가 매도를 걸어두세요!
    `;
  }
}
