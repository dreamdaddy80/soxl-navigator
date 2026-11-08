// 기록장의 내 매매 성적표

function renderRotationAnalytics(t, cur) {
  const a = analyzeRotations(t, cur, todayISO());
  if (a.rotations.length === 0 && a.newMoneyCost === 0) {
    return `<div class="bt-placeholder">아직 원금 탈출 매매 기록이 없습니다. 매도·재매수를 기록하면 실제 성적이 여기에 쌓입니다.</div>`;
  }

  const waitingHTML = a.waiting ? (() => {
    const w = a.waiting;
    const rebuyShares = cur > 0 ? Math.floor(w.proceeds / (cur * (1 + TRADING_FEE_RATE))) : 0;
    const moved = w.netSellPrice > 0 ? cur / w.netSellPrice - 1 : 0;
    return `
      <div class="bt-verdict ${moved > 0 ? 'bt-verdict-bad' : 'bt-verdict-flat'}">
        ⏳ ${w.sellDate} 매도분 <strong>${formatUSD(w.proceeds)}</strong>이 ${w.daysWaited}일째 재매수를 기다리고 있습니다.
        현재가는 매도 단가보다 ${formatBtSignedPct(moved)}이고, 지금 되사면 ${rebuyShares.toLocaleString()}주(판 수량 대비 ${formatShareDelta(rebuyShares - w.sellShares)})입니다.
      </div>`;
  })() : '';

  const rows = [...a.rotations].reverse().slice(0, 10).map(r => `
    <tr>
      <td><strong>${r.sellDate}</strong><br/><small class="bt-rule-desc">${r.buyDate ? `→ ${r.buyDate}` : '재매수 대기'}</small></td>
      <td>${r.daysWaited}일</td>
      <td>${formatUSD(r.netSellPrice)}</td>
      <td>${r.netBuyPrice == null ? '-' : formatUSD(r.netBuyPrice)}</td>
      <td>${r.status === 'waiting' ? '-' : `${r.shareChange >= 0 ? '+' : ''}${Number(r.shareChange.toFixed(2))}주`}</td>
      <td class="${r.effectNow >= 0 ? 'bt-best' : 'analytics-negative'}">${formatSignedUSD(r.effectNow)}</td>
    </tr>`).join('');

  return `
    ${waitingHTML}
    <div class="diagnosis-box">
      <div class="diag-item highlight-diag">
        <span class="diag-label">지금까지 거래 전체 효과 (아무 거래도 안 했을 때 대비)</span>
        <strong class="diag-value">${formatSignedUSD(a.effectVsHold)}</strong>
        <span class="diag-sub">현재 자산 ${formatUSD(a.actualValue)} · 그대로 뒀다면 ${formatUSD(a.holdValue)} (새로 넣은 돈은 현금으로 뒀다고 가정)</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">판 가격보다 싸게 되산 회전</span>
        <strong class="diag-value">${a.finishedCount ? `${a.wins} / ${a.finishedCount}` : '-'}</strong>
        <span class="diag-sub">${a.winPct == null ? '끝난 회전 없음' : `수수료 포함 ${formatBtPct(a.winPct)}`} · 재매수까지 중앙값 ${a.medianDaysWaited == null ? '-' : `${Math.round(a.medianDaysWaited)}일`}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">낸 수수료 (편도 0.1% 기준)</span>
        <strong class="diag-value">${formatUSD(a.fees)}</strong>
        <span class="diag-sub">회전에 쓰지 않은 새 돈 매수 ${formatUSD(a.newMoneyCost)}</span>
      </div>
    </div>
    ${rows ? `
    <div class="table-responsive">
      <table class="bt-table">
        <thead>
          <tr>
            <th>매도일</th>
            <th>대기</th>
            <th>순매도 단가</th>
            <th>순매수 단가</th>
            <th>주식 수 변화</th>
            <th>안 했을 때 대비 (현재가 기준)</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : ''}
  `;
}

function renderGrowthAnalytics(t) {
  const a = analyzeGrowthCycles(t.growth, todayISO());
  if (a.count === 0 && a.currentCycleDays == null) {
    return `<div class="bt-placeholder">아직 40분할 기록이 없습니다.</div>`;
  }

  const splitBt = getSplitBacktestResult(appState.currentTicker);
  const btAvg = splitBt && splitBt.result.overall ? splitBt.result.overall.plain.avgCycleProfit : null;
  return `
    <div class="diagnosis-box">
      <div class="diag-item">
        <span class="diag-label">졸업한 사이클</span>
        <strong class="diag-value">${a.count}회</strong>
        <span class="diag-sub">수익 ${a.wins}회 · 누적 ${formatSignedUSD(a.totalProfit)}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">졸업 1회 평균 수익 (시드 대비)</span>
        <strong class="diag-value">${a.avgProfitPct == null ? '-' : formatBtSignedPct(a.avgProfitPct)}</strong>
        <span class="diag-sub">${btAvg == null ? '과거 검증을 실행하면 비교값이 표시됩니다' : `과거 검증 평균 ${formatBtSignedPct(btAvg)}`}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">졸업까지 걸린 기간 (중앙값)</span>
        <strong class="diag-value">${a.medianDays == null ? '-' : `${Math.round(a.medianDays)}일`}</strong>
        <span class="diag-sub">${a.currentCycleDays == null ? '진행 중인 사이클 없음' : `지금 사이클 ${a.currentCycleDays}일째`}</span>
      </div>
    </div>
  `;
}

function renderJournalAnalytics() {
  const box = document.getElementById('journal-analytics');
  if (!box) return;
  const ticker = appState.currentTicker;
  const t = appState.tickers[ticker];
  document.getElementById('journal-analytics-title').textContent = `📊 내 매매 성적표 (${ticker})`;
  box.innerHTML = `
    <h4 class="analytics-heading">🛠️ 원금 탈출</h4>
    ${renderRotationAnalytics(t, t.currentPrice)}
    <h4 class="analytics-heading">🌱 40분할</h4>
    ${renderGrowthAnalytics(t)}
    <div class="bt-notes"><div>기록장의 체결 내역만으로 계산합니다. 금액은 입력한 체결가와 편도 수수료 0.1% 기준이며 세금은 반영하지 않았습니다.</div></div>
  `;
}
