// 40분할 화면과 기록 입력

// 40분할 기록이 없고 시드가 샘플 기본값이거나 회복 목표 원금과 같으면 아직 시드를 정하지 않은 것으로 본다.
// 회복 목표 원금은 이미 주식에 묶인 돈이라 시드로 쓸 수 없다. 저장값은 사용자가 입력할 때까지 그대로 둔다.
function growthSeedUnset(t) {
  const g = t.growth;
  if (g.seedConfirmed || g.heldShares > 0 || (g.history && g.history.length > 0)) return false;
  const isSample = Object.values(DEFAULT_STATE.tickers).some(d => d.growth.totalBudget === g.totalBudget);
  return isSample || Math.abs(g.totalBudget - getTotalPrincipal(t)) < 1;
}

function focusGrowthSeed() {
  switchView('growth');
  const input = document.getElementById('g-total-budget');
  input.scrollIntoView({ block: 'center' });
  input.focus({ preventScroll: true });
}

function renderSeedNotice(t, seedUnset, unspentSeed) {
  const box = document.getElementById('g-seed-notice');
  const cash = t.reservedCash || 0;
  if (seedUnset) {
    const lockedHint = Math.abs(t.growth.totalBudget - getTotalPrincipal(t)) < 1
      ? ` 이전 값 ${formatUSD(t.growth.totalBudget)}는 ${t.shares.toLocaleString()}주에 이미 묶인 회복 목표 원금이라 비워 두었습니다.`
      : '';
    box.className = 'seed-notice is-info';
    box.textContent = `시드를 입력해 주세요. 지금 가용 현금은 ${formatUSD(cash)}입니다.${lockedHint}`;
    box.style.display = '';
  } else if (unspentSeed > cash + 0.005) {
    box.className = 'seed-notice is-warn';
    box.textContent = `아직 쓰지 않은 시드 ${formatUSD(unspentSeed)}가 가용 현금 ${formatUSD(cash)}보다 큽니다. 주식에 묶인 돈은 시드로 쓸 수 없습니다. 별도 자금이라면 무시해도 됩니다.`;
    box.style.display = '';
  } else {
    box.style.display = 'none';
  }
}

function renderGraduateButton(t, g, targetSellPrice) {
  const btn = document.getElementById('g-graduate-btn');
  const hint = document.getElementById('g-graduate-hint');
  const held = g.heldShares > 0;
  const reached = held && Math.max(t.currentPrice, t.dayHigh || 0) >= targetSellPrice;
  btn.disabled = !reached;
  hint.textContent = !held
    ? '보유 주식이 없습니다. 매수 후 목표가에 도달하면 활성화됩니다.'
    : reached
      ? `목표가 ${formatUSD(targetSellPrice)} 도달. 실제로 전량 체결됐다면 눌러서 기록하세요.`
      : `목표가 ${formatUSD(targetSellPrice)} 도달 시 활성화 (현재가 ${formatUSD(t.currentPrice)})`;
}

// 증권사 앱의 실제 보유분과 기록이 다를 때 조정 기록으로 맞춘다
function setGrowthPosition() {
  const t = appState.tickers[appState.currentTicker];
  const g = t.growth;

  const sharesInput = prompt(`[${appState.currentTicker}] 증권사 앱의 40분할 보유 수량(주)을 입력해 주세요:`, String(g.heldShares));
  if (sharesInput === null) return;
  const shares = parseFloat(sharesInput);
  if (!Number.isFinite(shares) || shares < 0) {
    alert('올바른 수량을 입력해 주세요.');
    return;
  }

  let avg = 0;
  if (shares > 0) {
    const avgInput = prompt('증권사 앱의 평균 매입가($)를 입력해 주세요:', String(g.avgPrice));
    if (avgInput === null) return;
    avg = parseFloat(avgInput);
    if (!(avg > 0)) {
      alert('올바른 평균 매입가를 입력해 주세요.');
      return;
    }
  }

  const record = growthAdjustmentRecord(replayGrowthLedger(g.history), shares, shares * avg, '증권사 잔고에 맞춰 보유분 조정');
  if (!record) {
    alert('기록과 입력한 보유분이 이미 같습니다.');
    return;
  }
  g.history.unshift(record);
  recalculateGrowthFromHistory(t);
  saveState();
  populateInputsFromState();
  recalcGrowthMode(false);
}

// =========================================================================
// [MODE 2: 본전 탈출 이후 꾸준한 수익 창출 모드 (스마트 분할매수·무한매수법) 로직]
// =========================================================================
function recalcGrowthMode(syncFromDOM = true) {
  const t = appState.tickers[appState.currentTicker];
  const g = t.growth;

  if (syncFromDOM) {
    const typedBudget = parseFloat(document.getElementById('g-total-budget').value);
    if (typedBudget > 0) {
      g.totalBudget = typedBudget;
      g.seedConfirmed = 1;
    }
    // 사용자가 시드를 바꾸면 기록 재계산의 기준 시드도 함께 갱신
    g.baseTotalBudget = Number((g.totalBudget - (g.cumulativeProfit || 0)).toFixed(2));
    g.splits = parseInt(document.getElementById('g-splits').value, 10) || 40;
    g.targetProfitPct = parseFloat(document.getElementById('g-target-profit').value) || 10;
    saveState();
  }

  const cur = t.currentPrice;
  const oneUnitUSD = g.splits > 0 ? g.totalBudget / g.splits : 0;
  const investedAmount = g.heldShares * g.avgPrice;
  const currentTurn = oneUnitUSD > 0 ? investedAmount / oneUnitUSD : 0;
  const remainingCash = Math.max(0, g.totalBudget - investedAmount);
  const progressPct = Math.min(100, (currentTurn / g.splits) * 100);
  const isFirstHalf = currentTurn < g.splits / 2;

  const evalValue = g.heldShares * cur;
  const profitUSD = evalValue - investedAmount;
  const currentRoi = investedAmount > 0 ? (profitUSD / investedAmount) * 100 : 0;

  const seedUnset = growthSeedUnset(t);
  const seedMoney = value => (seedUnset ? '-' : formatUSD(value));
  renderSeedNotice(t, seedUnset, remainingCash);

  document.getElementById('growth-cycle-badge').textContent = `현재 ${g.cycleCount || 1}번째 사이클 진행 중`;
  document.getElementById('g-held-shares').textContent = `${g.heldShares.toLocaleString()}주`;
  document.getElementById('g-avg-price').textContent = g.heldShares > 0 ? formatUSD(g.avgPrice) : '첫 매수 전';
  document.getElementById('g-one-unit-usd').textContent = seedMoney(oneUnitUSD);
  document.getElementById('g-current-turn').textContent = seedUnset ? '-' : `${currentTurn.toFixed(1)} / ${g.splits}회차`;
  document.getElementById('g-phase-text').textContent = seedUnset ? '' : isFirstHalf
    ? `전반전 (1~${g.splits / 2}회차): 평단 낮추기 구간`
    : `후반전 (${g.splits / 2 + 1}~${g.splits}회차): 방어 매수 구간`;

  document.getElementById('g-remaining-cash').textContent = seedMoney(remainingCash);
  const cashRatio = g.totalBudget > 0 ? ((remainingCash / g.totalBudget) * 100).toFixed(1) : 100;
  document.getElementById('g-remaining-pct').textContent = seedUnset ? '' : `시드의 ${cashRatio}%`;

  document.getElementById('g-progress-label').innerHTML =
    `시드 소진율: <strong>${seedUnset ? '-' : `${progressPct.toFixed(1)}% (${currentTurn.toFixed(1)} / ${g.splits}회차)`}</strong>`;
  document.getElementById('g-progress-fill').style.width = `${progressPct}%`;

  const roiBadge = document.getElementById('g-current-roi-badge');
  if (g.heldShares > 0) {
    const sign = profitUSD >= 0 ? '+' : '';
    roiBadge.textContent = `현재 수익률: ${sign}${currentRoi.toFixed(2)}% (${sign}${formatUSD(profitUSD)})`;
  } else {
    roiBadge.textContent = `현재 수익률: 0.00% (첫 매수 대기 중)`;
  }

  // 오늘 밤 자동 주문 레시피 계산 (라오어 무한매수법 + RSI 부스터 결합)
  const rsi = t.rsi || 50;
  let boosterMultiplier = 1.0;
  let aiTipText = `RSI ${rsi.toFixed(1)}는 부스터 조건 밖이라 규칙상 <strong>1회분(${formatUSD(oneUnitUSD)})</strong>을 배정합니다.`;
  let boosterName = '';

  if (rsi <= 38 || cur <= t.bbLower * 1.02) {
    boosterMultiplier = 1.5;
    boosterName = 'RSI 부스터';
    aiTipText = `<strong>RSI 부스터 조건 충족</strong> (RSI ${rsi.toFixed(1)} · 38 이하 또는 볼린저 하단 근처). 규칙상 오늘은 1.5회분 <strong>${formatUSD(oneUnitUSD * 1.5)}</strong>을 배정합니다.`;
  } else if (rsi >= 64) {
    boosterMultiplier = 0.5;
    boosterName = 'RSI 과열 방어';
    aiTipText = `<strong>RSI 과열 방어 조건 충족</strong> (RSI ${rsi.toFixed(1)} · 64 이상). 규칙상 오늘은 0.5회분 <strong>${formatUSD(oneUnitUSD * 0.5)}</strong>을 배정합니다.`;
  }

  // 과거 검증 결과가 있으면 부스터가 실제로 도움이 됐는지 같이 보여준다
  const splitBt = getSplitBacktestResult(appState.currentTicker);
  if (splitBt && splitBt.result.overall) {
    const { plain, booster } = splitBt.result.overall;
    aiTipText += `<br/><small>과거 검증(상장 초부터): 부스터 사용 연복리 ${formatBtSignedPct(booster.cagr)} · 미사용 ${formatBtSignedPct(plain.cagr)} — 부스터 없이 매일 1회분만 사는 선택지도 있습니다.</small>`;
  }

  const todayBudget = Math.min(remainingCash, oneUnitUSD * boosterMultiplier);
  const budgetFormula = todayBudget < oneUnitUSD * boosterMultiplier
    ? '남은 현금 한도까지만 배정'
    : boosterMultiplier === 1
      ? '1회분 그대로'
      : `1회분 ${formatUSD(oneUnitUSD)} × ${boosterMultiplier} (${boosterName})`;
  document.getElementById('g-buy-total-budget').textContent = `오늘 배정액: ${seedMoney(todayBudget)}`;
  document.getElementById('g-buy-budget-note').textContent = seedUnset ? '' : budgetFormula;
  document.getElementById('g-one-unit-krw').textContent = seedUnset ? ''
    : boosterMultiplier === 1
      ? `${formatKRW(oneUnitUSD)} · 오늘 배정액과 같음`
      : `${formatKRW(oneUnitUSD)} · 오늘은 ×${boosterMultiplier} = ${formatUSD(todayBudget)}`;
  document.getElementById('g-buy-ai-tip').innerHTML = seedUnset ? '' : aiTipText;

  const buyBox = document.getElementById('g-buy-orders-content');
  if (seedUnset) {
    buyBox.innerHTML = `시드를 입력하면 주문표가 나옵니다. <button type="button" class="text-link-btn" onclick="focusGrowthSeed()">시드 입력하기</button>`;
  } else if (remainingCash <= 10) {
    buyBox.innerHTML = `<strong>모든 회차 매수가 완료되었습니다.</strong><br/>규칙상 추가 매수 없이 목표 익절가 도달을 기다립니다.`;
  } else if (g.heldShares === 0) {
    // 1회차 첫 진입
    const firstShares = Math.max(1, Math.floor(todayBudget / cur));
    buyBox.innerHTML = `
      <strong>1회차 첫 진입 주문</strong><br/>
      • 오늘 밤 장 마감(LOC) 또는 현재가(<strong>${formatUSD(cur)}</strong>)로 <strong>${firstShares}주</strong>(약 ${formatUSD(firstShares * cur)}) 매수<br/>
      • 첫 매수가 체결되면 내일부턴 평단가를 기준으로 절반씩 나누어 주문합니다.
    `;
  } else if (isFirstHalf) {
    // 전반전: 절반(50%)은 내 평단가에 LOC 매수, 나머지 절반(50%)은 현재가+5%(큰수)에 LOC 매수
    const halfBudget = todayBudget / 2;
    const order1Price = g.avgPrice;
    const order1Shares = Math.max(1, Math.floor(halfBudget / order1Price));
    const order2Price = Number((cur * 1.05).toFixed(2));
    const order2Shares = Math.max(1, Math.floor(halfBudget / cur));

    buyBox.innerHTML = `
      <strong>전반전 2분할 LOC 매수</strong><br/>
      ① <strong>평단가 LOC (절반):</strong> 내 평단가 <strong>${formatUSD(order1Price)}</strong>에 <strong>${order1Shares}주</strong> <small>(종가가 평단가 이하일 때만 체결)</small><br/>
      ② <strong>체결 우선 LOC (절반):</strong> <strong>${formatUSD(order2Price)}</strong>에 <strong>${order2Shares}주</strong> <small>(종가가 이 가격 이하이면 체결 · 5% 넘게 급등하면 미체결)</small>
    `;
  } else {
    // 후반전: 전액 내 평단가 이하에만 LOC 매수
    const orderPrice = g.avgPrice;
    const orderShares = Math.max(1, Math.floor(todayBudget / orderPrice));
    buyBox.innerHTML = `
      <strong>후반전 방어 LOC 매수</strong><br/>
      • 후반전(${currentTurn.toFixed(1)}회차)부터는 평단가보다 비싸게 사지 않습니다.<br/>
      • <strong>평단가 LOC (전액):</strong> <strong>${formatUSD(orderPrice)}</strong>에 <strong>${orderShares}주</strong> (종가가 평단가 이하일 때만 체결)
    `;
  }

  if (!isQuoteFresh(t)) {
    buyBox.innerHTML = `<div class="is-warn">최신 시세 미확인: 아래 수량은 마지막 확인 가격(${formatUSD(cur)}) 기준입니다. 주문 전 현재가를 확인하세요.</div>` + buyBox.innerHTML;
  }

  // 오늘 매도(익절) 주문표
  const targetSellPrice = Number(((g.heldShares > 0 ? g.avgPrice : cur) * (1 + g.targetProfitPct / 100)).toFixed(2));
  document.getElementById('g-sell-target-price-label').textContent = `목표 익절가: ${formatUSD(targetSellPrice)} (+${g.targetProfitPct}%)`;
  renderGraduateButton(t, g, targetSellPrice);

  const sellBox = document.getElementById('g-sell-orders-content');
  const sellTip = document.getElementById('g-sell-ai-tip');

  if (g.heldShares <= 0) {
    sellBox.innerHTML = `
      • 1회차 매수가 체결된 다음 날부터 보유 수량 전량을 <strong>평단가 +${g.targetProfitPct}%</strong>에 지정가 매도로 겁니다.
    `;
    sellTip.innerHTML = `매일 장이 열리기 전 지정가 매도를 걸어 두면 체결 시 ${termHTML('졸업')}합니다.`;
  } else {
    const expectedProfitIfGrad = (targetSellPrice * (1 - TRADING_FEE_RATE) - g.avgPrice * (1 + TRADING_FEE_RATE)) * g.heldShares;
    sellBox.innerHTML = `
      <strong>전량 익절(졸업) 지정가 매도</strong><br/>
      • <strong>주문 가격:</strong> 내 평단가(${formatUSD(g.avgPrice)}) 대비 +${g.targetProfitPct}%인 <strong>${formatUSD(targetSellPrice)}</strong><br/>
      • <strong>주문 수량:</strong> 현재 보유 수량 전량 <strong>${g.heldShares}주</strong> 지정가(애프터마켓 포함) 매도 걸어두기<br/>
      • <strong>체결 시 확정 순수익 (수수료 차감):</strong> <strong class="is-up">+${formatUSD(expectedProfitIfGrad)} (${formatKRW(expectedProfitIfGrad)})</strong>
    `;
    sellTip.innerHTML = `${formatUSD(targetSellPrice)}에 전량 체결되면 아래 졸업 확정 버튼으로 기록하고 1회차부터 새로 시작합니다.`;
  }

  // 과거 검증 · 연간 복리 시뮬레이터 & 명예의 전당 렌더링
  renderSplitBacktest();
  renderGrowthCompoundAndHistory();
  renderJournalAnalytics();
}

function fillGrowthBuyFromToday() {
  const t = appState.tickers[appState.currentTicker];
  const g = t.growth;
  if (growthSeedUnset(t)) {
    alert('40분할 시드를 먼저 입력해 주세요.');
    focusGrowthSeed();
    return;
  }
  document.getElementById('g-input-type').value = 'BUY';
  toggleGrowthLogType();
  const oneUnit = g.splits > 0 ? g.totalBudget / g.splits : 0;
  const shares = Math.max(1, Math.floor(oneUnit / t.currentPrice));

  document.getElementById('g-input-buy-price').value = t.currentPrice;
  document.getElementById('g-input-buy-shares').value = shares;
  document.getElementById('g-input-buy-memo').value = `정기 분할매수 (${(g.heldShares > 0 ? ((g.heldShares * g.avgPrice) / oneUnit + 1) : 1).toFixed(0)}회차)`;
}

// 거래 종류에 맞춰 입력칸을 바꾼다. 졸업은 보유 전량이 대상이라 수량을 고칠 수 없다
function toggleGrowthLogType() {
  const g = appState.tickers[appState.currentTicker].growth;
  const isGraduate = document.getElementById('g-input-type').value === 'GRADUATE';
  const sharesEl = document.getElementById('g-input-buy-shares');
  document.getElementById('g-input-price-label').textContent = isGraduate ? '전량 매도 체결가 ($)' : '매수 체결가 ($)';
  document.getElementById('g-input-shares-label').textContent = isGraduate ? '수량 (보유 전량)' : '매수 수량 (주)';
  sharesEl.disabled = isGraduate;
  sharesEl.required = !isGraduate;
  sharesEl.value = isGraduate ? g.heldShares : '';
}

function addGrowthDailyBuy(e) {
  e.preventDefault();
  const t = appState.tickers[appState.currentTicker];
  const g = t.growth;

  const price = parseFloat(document.getElementById('g-input-buy-price').value);
  const shares = parseFloat(document.getElementById('g-input-buy-shares').value);
  const memo = document.getElementById('g-input-buy-memo').value.trim();
  const tradeDate = document.getElementById('g-input-buy-date').value || todayISO();

  if (document.getElementById('g-input-type').value === 'GRADUATE') {
    if (g.heldShares <= 0) {
      alert('현재 보유 중인 주식이 없습니다.');
      return;
    }
    if (!(price > 0)) return;
    recordGrowthGraduation(t, price, tradeDate);
    document.getElementById('g-input-type').value = 'BUY';
    toggleGrowthLogType();
    document.getElementById('g-input-buy-price').value = '';
    document.getElementById('g-input-buy-memo').value = '';
    return;
  }

  if (!price || !shares || price <= 0 || shares <= 0) return;

  const before = replayGrowthLedger(g.history);
  const newCost = price * shares;
  const newAvg = Number(((before.totalCost + newCost) / (before.heldShares + shares)).toFixed(2));

  g.history.unshift({
    id: Date.now(),
    tradeDate,
    type: 'BUY',
    price,
    shares,
    amount: newCost,
    memo: memo || `평단가 $${newAvg}로 업데이트`
  });
  recalculateGrowthFromHistory(t);

  document.getElementById('g-input-buy-price').value = '';
  document.getElementById('g-input-buy-shares').value = '';
  document.getElementById('g-input-buy-memo').value = '';

  saveState();
  recalcGrowthMode(false);
}

function graduateCurrentCycle() {
  const t = appState.tickers[appState.currentTicker];
  const g = t.growth;

  if (g.heldShares <= 0) {
    alert('현재 보유 중인 주식이 없습니다. 먼저 분할매수 체결 내역을 추가해 주세요!');
    return;
  }

  const targetSellPrice = Number((g.avgPrice * (1 + g.targetProfitPct / 100)).toFixed(2));
  const sInput = prompt(
    `[${appState.currentTicker}] ${g.heldShares}주 전량의 실제 매도 체결가($)를 입력해 주세요:`,
    String(targetSellPrice)
  );
  if (sInput === null) return;
  const sellPrice = parseFloat(sInput);
  if (!sellPrice || sellPrice <= 0) {
    alert('올바른 매도 체결가를 입력해 주세요.');
    return;
  }

  recordGrowthGraduation(t, sellPrice, todayISO());
}

// 보유 전량 졸업을 기록한다. 실제 체결가 기준으로 매수·매도 수수료(각 0.1%)를 차감한 순수익을 남긴다
function recordGrowthGraduation(t, sellPrice, tradeDate) {
  const g = t.growth;
  const netProceeds = g.heldShares * sellPrice * (1 - TRADING_FEE_RATE);
  const costBasis = g.heldShares * g.avgPrice * (1 + TRADING_FEE_RATE);
  const profit = Number((netProceeds - costBasis).toFixed(2));

  g.history.unshift({
    id: Date.now(),
    tradeDate,
    type: 'GRADUATE',
    price: sellPrice,
    shares: g.heldShares,
    amount: profit,
    memo: `🎉 ${g.cycleCount}사이클 졸업 (${formatSignedUSD(profit)} 확정 · 원금 복리 합산)`
  });

  recalculateGrowthFromHistory(t); // 수익이 시드에 합산된다 (복리 재투자)

  document.getElementById('g-total-budget').value = g.totalBudget;

  saveState();
  recalcGrowthMode(false);
}

let editingGrowthId = null;

function startEditGrowthHistory(id) {
  editingGrowthId = id;
  renderGrowthCompoundAndHistory();
}

function cancelEditGrowthHistory() {
  editingGrowthId = null;
  renderGrowthCompoundAndHistory();
}

function saveEditGrowthHistory(id) {
  const t = appState.tickers[appState.currentTicker];
  const item = t.growth.history.find(h => h.id === id);
  if (!item) return;

  const newPrice = parseFloat(document.getElementById(`edit-g-price-${id}`)?.value);
  const newShares = parseFloat(document.getElementById(`edit-g-shares-${id}`)?.value);
  const newMemo = document.getElementById(`edit-g-memo-${id}`)?.value.trim() || '';
  const newDate = document.getElementById(`edit-g-date-${id}`)?.value;

  if (!newPrice || !newShares || newPrice <= 0 || newShares <= 0) {
    alert('올바른 가격과 수량을 입력해 주세요.');
    return;
  }

  if (newDate) item.tradeDate = newDate;
  item.price = newPrice;
  item.shares = newShares;
  if (item.type === 'BUY') {
    item.amount = Number((newPrice * newShares).toFixed(2));
  } else {
    const newAmount = parseFloat(document.getElementById(`edit-g-amount-${id}`)?.value);
    if (!isNaN(newAmount)) item.amount = Number(newAmount.toFixed(2));
  }
  item.memo = newMemo;

  editingGrowthId = null;
  recalculateGrowthFromHistory(t);
  saveState();
  populateInputsFromState();
  recalcGrowthMode(false);
}

function deleteGrowthHistory(id) {
  const t = appState.tickers[appState.currentTicker];
  t.growth.history = t.growth.history.filter(item => item.id !== id);
  if (editingGrowthId === id) editingGrowthId = null;
  recalculateGrowthFromHistory(t);
  saveState();
  populateInputsFromState();
  recalcGrowthMode(false);
}

function renderGrowthCompoundAndHistory() {
  const t = appState.tickers[appState.currentTicker];
  renderGrowthCompound(t);
  renderGrowthHistory(t);
}

function renderGrowthCompound(t) {
  const g = t.growth;

  document.getElementById('g-cumulative-profit-badge').textContent =
    `누적 확정 수익: ${formatSignedUSD(g.cumulativeProfit || 0)} (${formatKRW(g.cumulativeProfit || 0)})`;

  const seedUnset = growthSeedUnset(t);
  document.getElementById('g-compound-table-wrap').style.display = seedUnset ? 'none' : '';
  if (seedUnset) {
    document.getElementById('g-compound-summary').innerHTML =
      `<div class="bt-placeholder full-row">시드를 입력하면 복리 시뮬레이션을 계산합니다.</div>`;
    return;
  }

  // 과거 검증을 돌렸으면 실제 평균(졸업 1회 수익·연간 졸업 횟수)을, 아니면 앱 기본 가정치를 쓴다
  const splitBt = getSplitBacktestResult(appState.currentTicker);
  const btAll = splitBt && splitBt.result.overall ? splitBt.result.overall.plain : null;
  const useBt = !!(btAll && btAll.avgCycleProfit != null && btAll.cyclesPerYear > 0);
  const avgCycleYield = useBt ? btAll.avgCycleProfit : (g.targetProfitPct / 100) * 0.55;
  const cyclesPerYear = useBt ? btAll.cyclesPerYear : 6;
  const monthsPerCycle = 12 / cyclesPerYear;
  const oneCycleProfit = g.totalBudget * avgCycleYield;
  const oneYearAsset = g.totalBudget * (useBt ? 1 + btAll.cagr : Math.pow(1 + avgCycleYield, cyclesPerYear));
  const oneYearProfit = oneYearAsset - g.totalBudget;
  // 해외주식 양도소득세: 한 해 순이익에서 250만 원을 뺀 금액의 22% (그해 다른 해외주식 손익과 합산)
  const fxRate = appState.exchangeRate || 1400;
  const oneYearTax = Math.max(0, oneYearProfit * fxRate - OVERSEAS_GAINS_DEDUCTION_KRW) * OVERSEAS_GAINS_TAX_RATE / fxRate;
  const oneYearAfterTax = oneYearProfit - oneYearTax;

  const summaryBox = document.getElementById('g-compound-summary');
  if (summaryBox) {
    const caveat = useBt
      ? `상장 초부터 과거 일봉으로 검증한 평균입니다 (1년 값은 실제 연복리 ${formatBtSignedPct(btAll.cagr)} 기준). 같은 기간 최대 낙폭 ${formatBtSignedPct(btAll.mdd, 0)}, 시드를 다 쓰고 최장 ${btAll.maxStuckDays.toLocaleString()}거래일 갇힌 구간이 있었습니다. 세후 금액은 1년 수익을 모두 실현했고 그해 다른 해외주식 손익이 없다고 보고 '(이익 − 250만 원) × 22%'로 어림한 값입니다. 환전 비용은 반영되지 않았습니다.`
      : `앱 기본 가정치입니다 (매 사이클 시드 55% 소진 후 +${g.targetProfitPct}% 졸업, 연 6회 전부 성공). 위 <strong>과거 검증</strong>을 실행하면 실제 과거 평균으로 바뀝니다. 실패·장기 물림 사이클과 환전 비용은 반영되지 않았고, 세후 금액은 '(이익 − 250만 원) × 22%'로 어림한 값입니다.`;
    summaryBox.innerHTML = `
      <div class="diag-item">
        <span class="diag-label">졸업 1회 평균 순수익 ${useBt ? '(과거 평균)' : '(가정치)'}</span>
        <strong class="diag-value">${formatSignedUSD(oneCycleProfit)}</strong>
        <span class="diag-sub">${formatKRW(oneCycleProfit)} (시드 대비 ${formatBtSignedPct(avgCycleYield)})</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">1년(약 ${cyclesPerYear.toFixed(1)}회 졸업) 운영 시 순수익 ${useBt ? '(과거 연복리)' : '(가정치)'}</span>
        <strong class="diag-value">${formatSignedUSD(oneYearProfit)}</strong>
        <span class="diag-sub">${formatKRW(oneYearProfit)} · 세후 약 <strong>${formatSignedUSD(oneYearAfterTax)}</strong> (양도세 ${formatUSD(oneYearTax)})</span>
      </div>
      <div class="diag-item highlight-diag">
        <span class="diag-label">1년 뒤 총 자산 (원금+수익)</span>
        <strong class="diag-value">${formatUSD(oneYearAsset)}</strong>
        <span class="diag-sub">${formatKRW(oneYearAsset)}</span>
      </div>
      <div class="diag-sub" style="grid-column:1/-1;">${caveat}</div>
    `;
  }

  const periodTh = document.getElementById('g-compound-period-th');
  if (periodTh) periodTh.textContent = `졸업 횟수 (약 ${monthsPerCycle.toFixed(1)}개월/회${useBt ? ' · 과거 평균' : ' · 가정치'})`;

  const cTbody = document.getElementById('g-compound-tbody');
  if (cTbody) {
    cTbody.innerHTML = '';
    const coreCounts = [1, 2, 4, 6, 8]; // 접힌 표에 남길 졸업 횟수
    for (let i = 1; i <= 8; i++) {
      if (!isTableExpanded('compound') && !coreCounts.includes(i)) continue;
      const asset = g.totalBudget * Math.pow(1 + avgCycleYield, i);
      const netProfit = asset - g.totalBudget;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${i}회 졸업 시</strong></td>
        <td>약 ${(i * monthsPerCycle).toFixed(1)}개월 뒤</td>
        <td><strong>${formatUSD(asset)}</strong></td>
        <td class="${netProfit >= 0 ? 'is-up' : 'is-down'}">${formatSignedUSD(netProfit)}</td>
        <td>${formatKRW(asset)}</td>
      `;
      cTbody.appendChild(tr);
    }
    document.getElementById('g-compound-more').innerHTML = tableMoreHTML('compound', 8, coreCounts.length);
  }
}

function renderGrowthHistory(t) {
  const g = t.growth;
  const hTbody = document.getElementById('g-history-tbody');
  if (!hTbody) return;
  hTbody.innerHTML = '';

  if (!g.history || g.history.length === 0) {
    hTbody.innerHTML = `
      <tr class="table-empty">
        <td colspan="7">
          <p>아직 기록이 없습니다. 첫 분할매수가 체결되면 기록해 보세요.</p>
          <button type="button" class="btn-secondary" onclick="fillGrowthBuyFromToday()">오늘 1회분 수량 채우기</button>
        </td>
      </tr>
    `;
    return;
  }

  g.history.forEach(item => {
    const tr = document.createElement('tr');
    const isGrad = item.type === 'GRADUATE';
    const isAdjust = item.type === 'ADJUST';
    const badge = isGrad
      ? `<span class="is-sell">졸업 (전량 매도)</span>`
      : isAdjust
        ? `<span>보유분 조정</span>`
        : `<span class="is-buy">정기 분할매수</span>`;

    if (editingGrowthId === item.id) {
      tr.innerHTML = `
        <td><input type="date" id="edit-g-date-${item.id}" class="inline-edit-input" value="${getTradeDate(item)}" /></td>
        <td>${badge}</td>
        <td><input type="number" id="edit-g-price-${item.id}" class="inline-edit-input" step="0.01" value="${item.price}" /></td>
        <td><input type="number" id="edit-g-shares-${item.id}" class="inline-edit-input" step="0.01" value="${item.shares}" /></td>
        <td>
          ${isGrad
            ? `<input type="number" id="edit-g-amount-${item.id}" class="inline-edit-input" step="0.01" value="${item.amount}" />`
            : `<span style="color:var(--text-muted);font-size:0.8rem;">저장 시 자동계산</span>`}
        </td>
        <td><input type="text" id="edit-g-memo-${item.id}" class="inline-edit-input" value="${escapeHTML(item.memo)}" /></td>
        <td>
          <div class="action-btn-group">
            <button type="button" class="btn-save-inline" onclick="saveEditGrowthHistory(${item.id})">저장</button>
            <button type="button" class="btn-cancel-inline" onclick="cancelEditGrowthHistory()">취소</button>
          </div>
        </td>
      `;
    } else {
      tr.innerHTML = `
        <td>${escapeHTML(displayTradeDate(item))}</td>
        <td>${badge}</td>
        <td><strong>${isAdjust ? '-' : formatUSD(item.price)}</strong></td>
        <td>${isAdjust && item.shares > 0 ? '+' : ''}${item.shares}주</td>
        <td><strong>${isGrad || isAdjust ? formatSignedUSD(item.amount) : formatUSD(item.amount)}</strong></td>
        <td>${escapeHTML(item.memo) || '-'}</td>
        <td>
          <div class="action-btn-group">
            ${isAdjust ? '' : `<button type="button" class="btn-edit" onclick="startEditGrowthHistory(${item.id})">수정</button>`}
            <button type="button" class="btn-delete" onclick="deleteGrowthHistory(${item.id})">삭제</button>
          </div>
        </td>
      `;
    }
    hTbody.appendChild(tr);
  });
}
