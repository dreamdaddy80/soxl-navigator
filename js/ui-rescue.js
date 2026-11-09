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
      ? `+${freeSharesGained.toLocaleString()}주 증가`
      : `${freeSharesGained}주 감소 (매도가보다 낮게 사야 합니다)`;

  document.getElementById('res-before-shares').textContent = `${totalShares.toLocaleString()}주`;
  document.getElementById('res-after-shares').textContent = `${newTotalShares.toLocaleString()}주`;
  document.getElementById('res-shares-diff').textContent = `두 주문 모두 체결 시 ${formatShareDelta(freeSharesGained)} (잔여 ${formatUSD(leftoverCash)})`;

  document.getElementById('res-before-target').textContent = formatUSD(oldBreakevenPrice);
  document.getElementById('res-after-target').textContent = formatUSD(newBreakevenPrice);
  const priceDropDiff = oldBreakevenPrice - newBreakevenPrice;
  document.getElementById('res-target-diff').innerHTML = `본전 기준선 <strong>${formatSignedUSD(-priceDropDiff)}</strong>`;
  if (!isVrRule(t)) document.getElementById('concl-rescue-sim').innerHTML =
    `두 주문이 모두 체결되면 본전 <strong>${formatUSD(oldBreakevenPrice)} → ${formatUSD(newBreakevenPrice)}</strong>, 주식 ${totalShares.toLocaleString()}주 → ${newTotalShares.toLocaleString()}주`;
  syncPresetButtons('sell-ratio-presets', sellRatio);
  syncPresetButtons('drop-ratio-presets', effectiveDropPct);

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
      <td>${formatShareDelta(addedShares)}</td>
      <td><strong>${formatUSD(cycleTargetPrice)}</strong></td>
      <td>기존 대비 <strong>${formatSignedUSD(-savedTarget)}</strong></td>
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
  toggleLogTypeHint();
}
