// 원금 탈출 시뮬레이터와 다음 작전 브리핑

// =========================================================================
// [MODE 1: 원금 탈출 시뮬레이터 및 로그 함수들]
// =========================================================================
function setSellRatio(ratio) {
  document.getElementById('sell-ratio-slider').value = ratio;
  runSimulator(false);
}

function setDropRatio(ratio) {
  document.getElementById('drop-ratio-slider').value = ratio;
  runSimulator(true);
}

function runSimulator(recalcBuyPriceFromDrop = true, sync = true) {
  const t = appState.tickers[appState.currentTicker];
  const sellRatio = parseFloat(document.getElementById('sell-ratio-slider').value) || 20;
  const sellPrice = parseFloat(document.getElementById('sim-sell-price').value) || t.autoSellTarget1 || t.currentPrice;
  const dropRatio = parseFloat(document.getElementById('drop-ratio-slider').value) || 10;

  let buyPrice = parseFloat(document.getElementById('sim-buy-price').value) || 0;
  if (recalcBuyPriceFromDrop || buyPrice <= 0) {
    buyPrice = Number((sellPrice * (1 - dropRatio / 100)).toFixed(2));
    document.getElementById('sim-buy-price').value = buyPrice;
  } else {
    const actualDrop = sellPrice > 0 ? Math.round(((sellPrice - buyPrice) / sellPrice) * 100) : dropRatio;
    if (actualDrop > 0 && actualDrop <= 50) {
      document.getElementById('drop-ratio-slider').value = actualDrop;
    }
  }

  if (sync) syncInputsToState();

  const cur = t.currentPrice;
  const diffFromCurPct = cur > 0 ? (((sellPrice - cur) / cur) * 100).toFixed(1) : 0;
  const reasonBadge = document.getElementById('sim-sell-reason-badge');
  if (reasonBadge) {
    reasonBadge.textContent = `현재가 대비 ${diffFromCurPct >= 0 ? '+' : ''}${diffFromCurPct}% 반등 타점`;
  }

  ensurePrincipalAnchor(t);
  const totalShares = t.shares;
  const totalPrincipal = getTotalPrincipal(t) || (totalShares * t.avgPrice);

  const sellShares = Math.round(totalShares * (sellRatio / 100));
  const remainShares = totalShares - sellShares;
  const grossSellCash = sellShares * sellPrice;
  const cashSecured = Number((grossSellCash * (1 - TRADING_FEE_RATE)).toFixed(2));

  const unitBuyCost = buyPrice * (1 + TRADING_FEE_RATE);
  const rebuyWholeShares = unitBuyCost > 0 ? Math.floor(cashSecured / unitBuyCost) : 0;
  const leftoverCash = Math.max(0, Number((cashSecured - rebuyWholeShares * unitBuyCost).toFixed(2)));
  const freeSharesGained = rebuyWholeShares - sellShares;
  const newTotalShares = remainShares + rebuyWholeShares;
  const totalCashAfterCycle = (t.reservedCash || 0) + leftoverCash;
  const newBreakevenPrice = newTotalShares > 0 ? Math.max(0, totalPrincipal - totalCashAfterCycle) / newTotalShares : 0;
  const oldBreakevenPrice = totalShares > 0 ? Math.max(0, totalPrincipal - (t.reservedCash || 0)) / totalShares : 0;

  document.getElementById('sim-current-shares-text').textContent = `${totalShares.toLocaleString()}주`;
  document.getElementById('sell-ratio-display').textContent = `${sellRatio}% (${sellShares.toLocaleString()}주)`;
  document.getElementById('sim-sell-shares').textContent = `${sellShares.toLocaleString()}주`;
  document.getElementById('sim-remain-shares').textContent = `${remainShares.toLocaleString()}주`;
  document.getElementById('sim-cash-secured').textContent = formatUSD(cashSecured);

  const effectiveDropPct = sellPrice > 0 ? (((sellPrice - buyPrice) / sellPrice) * 100).toFixed(1) : dropRatio;
  document.getElementById('drop-ratio-display').textContent = `-${effectiveDropPct}% (${formatUSD(buyPrice)})`;
  document.getElementById('sim-cash-reuse').textContent = formatUSD(cashSecured);
  document.getElementById('sim-rebuy-shares').textContent = `${rebuyWholeShares.toLocaleString()}주 (잔여 ${formatUSD(leftoverCash)})`;
  document.getElementById('sim-free-shares').textContent =
    freeSharesGained >= 0
      ? `+${freeSharesGained.toLocaleString()}주 증가! 🎉`
      : `${freeSharesGained}주 감소 (매도가보다 낮게 사야 합니다)`;

  document.getElementById('res-before-shares').textContent = `${totalShares.toLocaleString()}주`;
  document.getElementById('res-after-shares').textContent = `${newTotalShares.toLocaleString()}주`;
  document.getElementById('res-shares-diff').textContent = `두 주문 모두 체결 시 ${formatShareDelta(freeSharesGained)} (잔여 ${formatUSD(leftoverCash)})`;

  document.getElementById('res-before-target').textContent = formatUSD(oldBreakevenPrice);
  document.getElementById('res-after-target').textContent = formatUSD(newBreakevenPrice);
  const priceDropDiff = oldBreakevenPrice - newBreakevenPrice;
  document.getElementById('res-target-diff').innerHTML = `본전 탈출 기준선 <strong>-${formatUSD(priceDropDiff)}</strong> 단축!`;

  const tbody = document.getElementById('roadmap-tbody');
  tbody.innerHTML = '';

  let simLoopShares = totalShares;
  let simLoopCash = t.reservedCash || 0;

  for (let cycle = 1; cycle <= 6; cycle++) {
    const cSellShares = Math.round(simLoopShares * (sellRatio / 100));
    const cRemain = simLoopShares - cSellShares;
    const cCash = simLoopCash + Number((cSellShares * sellPrice * (1 - TRADING_FEE_RATE)).toFixed(2));
    const cRebuy = unitBuyCost > 0 ? Math.floor(cCash / unitBuyCost) : 0;
    simLoopCash = Math.max(0, Number((cCash - cRebuy * unitBuyCost).toFixed(2)));
    simLoopShares = cRemain + cRebuy;

    const addedShares = simLoopShares - totalShares;
    const cycleTargetPrice = simLoopShares > 0 ? Math.max(0, totalPrincipal - simLoopCash) / simLoopShares : 0;
    const savedTarget = oldBreakevenPrice - cycleTargetPrice;

    if (cycle === 5) {
      document.getElementById('res-5times-target').textContent = formatUSD(cycleTargetPrice);
      document.getElementById('res-5times-shares').innerHTML =
        `총 보유 수량 <strong>${simLoopShares.toLocaleString()}주</strong> (5번 모두 같은 가격에 체결된다는 가정)`;
    }

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${cycle}회전 성공 시</strong></td>
      <td><strong>${simLoopShares.toLocaleString()}주</strong> <small style="color:var(--text-muted);">(${formatUSD(simLoopCash)})</small></td>
      <td style="color: var(--accent-green);">${formatShareDelta(addedShares)}</td>
      <td><strong style="color: var(--accent-blue);">${formatUSD(cycleTargetPrice)}</strong></td>
      <td>기존 대비 <strong>-${formatUSD(savedTarget)}</strong> 단축</td>
    `;
    tbody.appendChild(tr);
  }

  scheduleRotationBacktest();
}

function fillFromSimulator() {
  const sellPrice = document.getElementById('sim-sell-price').value;
  const buyPrice = document.getElementById('sim-buy-price').value;
  const t = appState.tickers[appState.currentTicker];
  const sellRatio = parseFloat(document.getElementById('sell-ratio-slider').value) || 20;
  const sellShares = Math.round(t.shares * (sellRatio / 100));

  document.getElementById('log-type').value = 'SELL';
  document.getElementById('log-price').value = sellPrice;
  document.getElementById('log-shares').value = sellShares;
  document.getElementById('log-memo').value = `목표 재매수가: $${buyPrice} 이하`;
}

function applyCustomPlanToSimulator(sellPrice, buyPrice, sellRatio = 20) {
  const t = appState.tickers[appState.currentTicker];
  t.sellRatio = sellRatio;
  t.simSellPrice = Number(sellPrice.toFixed(2));
  t.simBuyPrice = Number(buyPrice.toFixed(2));
  const drop = sellPrice > 0 ? Math.max(5, Math.min(30, Math.round(((sellPrice - buyPrice) / sellPrice) * 100))) : 10;
  t.dropRatio = drop;

  populateInputsFromState();
  runSimulator(false, true);
  switchView('rescue');
}

function buildPersonalizedStrategyHTML(t) {
  ensurePrincipalAnchor(t);
  const baseShares = t.baseShares;
  const baseAvg = t.baseAvgPrice;
  const originalPrincipal = getTotalPrincipal(t) || (baseShares * baseAvg);
  const curBreakeven = t.shares > 0 ? Math.max(0, originalPrincipal - (t.reservedCash || 0)) / t.shares : baseAvg;
  const cur = t.currentPrice;

  const lastSell = t.logs ? t.logs.find(l => l.type === 'SELL') : null;
  const lastBuy = t.logs ? t.logs.find(l => l.type === 'BUY') : null;

  // CASE 1: 일부 매도 후 구출 현금을 쥐고 재매수를 기다리는 상태 (정수 주문 수량 + 수수료 반영)
  if (t.reservedCash > 0 && lastSell) {
    const sellP = Number(lastSell.price);
    const cash = Number(t.reservedCash);
    const soldSharesEquiv = Math.round(sellP > 0 ? cash / sellP : lastSell.shares);

    const calcPlan = (dropMult) => {
      const p = Number((sellP * dropMult).toFixed(2));
      const unitCost = p * (1 + TRADING_FEE_RATE);
      const buyWhole = unitCost > 0 ? Math.floor(cash / unitCost) : 0;
      const remCash = Math.max(0, Number((cash - buyWhole * unitCost).toFixed(2)));
      const gain = buyWhole - soldSharesEquiv;
      const totShares = t.shares + buyWhole;
      const be = totShares > 0 ? Math.max(0, originalPrincipal - remCash) / totShares : curBreakeven;
      return { p, buyWhole, remCash, gain, totShares, be };
    };

    const plan8 = calcPlan(0.92);
    const plan10 = calcPlan(0.90);
    const plan14 = calcPlan(0.86);

    const isReached = cur <= plan8.p;
    const statusBanner = isReached
      ? `<div style="color:#059669;font-weight:800;margin-bottom:6px;">⚡ 현재가(${formatUSD(cur)})가 이미 목표 재매수 구간에 들어왔습니다! 지금 확보한 현금으로 재매수를 실행하세요!</div>`
      : cur > sellP
        ? `<div style="color:#b45309;font-weight:700;margin-bottom:6px;">💡 현재가(${formatUSD(cur)})가 내 매도가(${formatUSD(sellP)})보다 높습니다. 다시 사면 매도 전보다 주식 수가 줄어듭니다. 다만 과거 데이터에서는 이렇게 오르는 동안 눌림목만 기다리다 현금이 오래 묶인 경우가 많았으니, 언제까지 기다릴지 미리 정해 두세요 (🛠️ 탈출시뮬 › 🧪 과거 검증의 '재매수 대기 한도' 비교 참고).</div>`
        : `<div style="color:#0369a1;font-weight:700;margin-bottom:6px;">📉 현재가(${formatUSD(cur)})가 매도가(${formatUSD(sellP)}) 대비 -${(((sellP - cur) / sellP) * 100).toFixed(1)}% 내려와 있습니다. 아래 3가지 목표가 중 원하는 위치에 지정가 재매수 주문을 걸어두세요!</div>`;

    return {
      stageClass: 'rebuy-stage',
      html: `
        <div class="mission-header">
          <div class="mission-title">🧭 [실전 기록 분석] 현재 2단계: 구출 현금 ${formatUSD(cash)} 저점 재매수 대기 중</div>
          <span class="reason-mini-badge">직전 매도가: ${formatUSD(sellP)} 기준 (정수 주문·수수료 반영)</span>
        </div>
        ${statusBanner}
        <div class="mission-plan-grid">
          <div class="mission-plan-item">
            <span class="mp-badge">🟢 플랜 A · 짧은 눌림목 (-8%)</span>
            <strong class="mp-price">${formatUSD(plan8.p)}에 ${plan8.buyWhole}주 매수</strong>
            <span class="mp-desc">주식 <strong style="color:#059669;">${formatShareDelta(plan8.gain)}</strong> (총 ${plan8.totShares}주 · 잔여 ${formatUSD(plan8.remCash)})</span>
            <span class="mp-desc">실질 탈출가: <strong>${formatUSD(plan8.be)}</strong>로 단축!</span>
          </div>
          <div class="mission-plan-item recommended">
            <span class="mp-badge">⭐ 플랜 B · 표준 추천 (-10%)</span>
            <strong class="mp-price">${formatUSD(plan10.p)}에 ${plan10.buyWhole}주 매수</strong>
            <span class="mp-desc">주식 <strong style="color:#059669;">${formatShareDelta(plan10.gain)}</strong> (총 ${plan10.totShares}주 · 잔여 ${formatUSD(plan10.remCash)})</span>
            <span class="mp-desc">실질 탈출가: <strong>${formatUSD(plan10.be)}</strong>로 단축!</span>
          </div>
          <div class="mission-plan-item">
            <span class="mp-badge">🔥 플랜 C · 깊은 조정 (-14%)</span>
            <strong class="mp-price">${formatUSD(plan14.p)}에 ${plan14.buyWhole}주 매수</strong>
            <span class="mp-desc">주식 <strong style="color:#059669;">${formatShareDelta(plan14.gain)}</strong> (총 ${plan14.totShares}주 · 잔여 ${formatUSD(plan14.remCash)})</span>
            <span class="mp-desc">실질 탈출가: <strong>${formatUSD(plan14.be)}</strong>로 단축!</span>
          </div>
        </div>
      `
    };
  }

  // CASE 2: 매도 후 저점 재매수까지 완료하여 주식 수가 늘어난 상태 (다음 회차 반등 매도 작전 제안!)
  if (t.logs && t.logs.length > 0 && lastBuy) {
    const gainedTotal = t.shares - baseShares;
    const savedTarget = baseAvg - curBreakeven;
    const refPrice = Math.max(cur, Number(lastBuy.price));

    const nextSellShares = Math.round(t.shares * 0.2);
    const nextSell1 = Number(Math.max(t.autoSellTarget1, refPrice * 1.07).toFixed(2));
    const nextRebuy1 = Number((nextSell1 * 0.90).toFixed(2));
    const nextNetCash = nextSellShares * nextSell1 * (1 - TRADING_FEE_RATE);
    const nextBuyWhole = Math.floor(nextNetCash / (nextRebuy1 * (1 + TRADING_FEE_RATE)));
    const nextGainShares = nextBuyWhole - nextSellShares;
    const nextBreakeven = originalPrincipal / (t.shares + nextGainShares);

    return {
      stageClass: 'next-sell-stage',
      html: `
        <div class="mission-header">
          <div class="mission-title">${savedTarget > 0
            ? '🎉 [실전 기록 분석] 재매수 완료 · 탈출가 단축! 다음 회차(Next Cycle) 작전 브리핑'
            : '🧾 [실전 기록 분석] 재매수 기록 반영 · 탈출가가 낮아지지 않았습니다 (추가 투입 원금·매수가 확인)'}</div>
          <button type="button" class="btn-secondary" onclick="applyCustomPlanToSimulator(${nextSell1}, ${nextRebuy1}, 20)">
            🛠️ 이 다음 작전을 시뮬레이터에 바로 적용 ➔
          </button>
        </div>
        <div>
          초기 <strong>${baseShares.toLocaleString()}주(${formatUSD(baseAvg)})</strong>에서 현재 <strong>${t.shares.toLocaleString()}주(${gainedTotal >= 0 ? `+${gainedTotal}주 증가!` : `${gainedTotal}주`})</strong>로 변화하여,
          실질 본전 탈출 목표가가 <strong>${formatUSD(baseAvg)} ➔ ${formatUSD(curBreakeven)} (${savedTarget >= 0 ? `-${formatUSD(savedTarget)} 단축!` : `+${formatUSD(Math.abs(savedTarget))}`})</strong> 되었습니다!
        </div>
        <div class="mission-plan-grid">
          <div class="mission-plan-item">
            <span class="mp-badge">📌 직전 재매수 완료 단가</span>
            <strong class="mp-price">${formatUSD(lastBuy.price)} (${lastBuy.shares}주)</strong>
            <span class="mp-desc">저점 물량 확보 완료! 이제 반등을 기다릴 차례입니다.</span>
          </div>
          <div class="mission-plan-item recommended">
            <span class="mp-badge">🔴 다음 회차 추천 매도가 (20% 물량)</span>
            <strong class="mp-price">${formatUSD(nextSell1)}에 ${nextSellShares}주 매도</strong>
            <span class="mp-desc">직전 매수가/현재가 대비 반등 저항 타점에 미리 지정가 매도를 걸어두세요.</span>
          </div>
          <div class="mission-plan-item">
            <span class="mp-badge">🎯 다음 1회전 추가 성공 시 효과</span>
            <strong class="mp-price">탈출가 ${formatUSD(nextBreakeven)}로 추가 단축!</strong>
            <span class="mp-desc">${formatUSD(nextRebuy1)}(-10%)에 <strong>${nextBuyWhole}주</strong> 다시 사면 <strong>${formatShareDelta(nextGainShares)}</strong> 변화합니다.</span>
          </div>
        </div>
      `
    };
  }

  // CASE 3: 아직 기록된 실전 내역이 없는 초기 상태 -> 첫 1회전 개시 작전 제안
  const firstSellShares = Math.round(t.shares * 0.2);
  const firstSellPrice = t.autoSellTarget1 || Number((cur * 1.09).toFixed(2));
  const firstRebuyPrice = Number((firstSellPrice * 0.90).toFixed(2));
  const firstNetCash = Number((firstSellShares * firstSellPrice * (1 - TRADING_FEE_RATE)).toFixed(2));
  const firstBuyWhole = Math.floor(firstNetCash / (firstRebuyPrice * (1 + TRADING_FEE_RATE)));
  const firstLeftover = Math.max(0, Number((firstNetCash - firstBuyWhole * firstRebuyPrice * (1 + TRADING_FEE_RATE)).toFixed(2)));
  const firstGainShares = firstBuyWhole - firstSellShares;
  const afterFirstBe = Math.max(0, originalPrincipal - firstLeftover) / (t.shares + firstGainShares);

  return {
    stageClass: '',
    html: `
      <div class="mission-header">
        <div class="mission-title">🧭 [맞춤 구출 작전 브리핑] 현재 1단계: 첫 반등 일부 매도(현금 확보) 대기 중</div>
        <button type="button" class="btn-secondary" onclick="applyCustomPlanToSimulator(${firstSellPrice}, ${firstRebuyPrice}, 20)">
          🛠️ 첫 구출 작전 시뮬레이터로 열기 ➔
        </button>
      </div>
      <div>
        현재 보유 중인 <strong>${t.shares.toLocaleString()}주(실질 탈출가 ${formatUSD(curBreakeven)})</strong>를 가장 빠르게 복구하기 위한 <strong>첫 번째 추천 작전(수수료·정수 주문 반영)</strong>입니다:
      </div>
      <div class="mission-plan-grid">
        <div class="mission-plan-item recommended">
          <span class="mp-badge">STEP 1 · 반등 시 20% 일부 매도</span>
          <strong class="mp-price">${formatUSD(firstSellPrice)}에 ${firstSellShares}주 매도</strong>
          <span class="mp-desc">실수령 구출 현금 <strong>${formatUSD(firstNetCash)}</strong> 확보 (나머지 ${t.shares - firstSellShares}주 보유 유지)</span>
        </div>
        <div class="mission-plan-item">
          <span class="mp-badge">STEP 2 · -10% 눌림목 정수 재매수</span>
          <strong class="mp-price">${formatUSD(firstRebuyPrice)}에 ${firstBuyWhole}주 매수</strong>
          <span class="mp-desc">두 주문 모두 체결 시 <strong>${formatShareDelta(firstGainShares)}</strong> (잔여 현금 ${formatUSD(firstLeftover)})</span>
        </div>
        <div class="mission-plan-item">
          <span class="mp-badge">STEP 3 · 1회전 완료 후 탈출 목표가</span>
          <strong class="mp-price">${formatUSD(curBreakeven)} ➔ ${formatUSD(afterFirstBe)}</strong>
          <span class="mp-desc">단 1번의 회전만으로 본전 탈출 기준선이 <strong>-${formatUSD(curBreakeven - afterFirstBe)}</strong> 낮아집니다!</span>
        </div>
      </div>
    `
  };
}
