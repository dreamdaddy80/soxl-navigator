// 현재 규칙에 맞춰 차트·타점과 탈출시뮬을 바꿔 그린다 (VR 화면은 여기, 회전 화면은 ui-core·ui-rescue·ui-backtest)

const VR_WAITING_TEXT = '시세를 확인하면 계산됩니다.';

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? '' : 'none';
}

function vrBreakeven(t, shares, cash) {
  const principal = getTotalPrincipal(t) || (t.shares * t.avgPrice);
  return shares > 0 ? Math.max(0, principal - cash) / shares : 0;
}

// ------------------------------ 차트·타점 ------------------------------
function renderVrChartTargets(t) {
  const cur = t.currentPrice;
  const targets = vrTargets(t);
  setText('ind-sell-name', 'VR 매도가 (상단 밴드)');
  setText('ind-buy-name', 'VR 매수가 (하단 밴드)');
  const rationale = document.getElementById('target-rationale-box');

  if (!targets) {
    setText('ind-sell-target', '-');
    setText('ind-sell-basis', VR_WAITING_TEXT);
    setText('ind-buy-target', '-');
    setText('ind-buy-basis', VR_WAITING_TEXT);
    if (rationale) rationale.textContent = VR_WAITING_TEXT;
    return;
  }

  const value = t.shares * cur;
  setText('ind-sell-target', `${formatUSD(targets.price)} (${formatBtSignedPct(targets.price / cur - 1)})`);
  setText('ind-sell-basis', `평가금이 V의 +15%가 되는 가격 · ${targets.shares.toLocaleString()}주 매도`);
  setText('ind-buy-target', targets.buyShares > 0 ? `${formatUSD(targets.buyPrice)} (${formatBtSignedPct(targets.buyPrice / cur - 1)})` : '매수 주문 없음');
  setText('ind-buy-basis', targets.buyShares > 0
    ? `평가금이 V의 -15%가 되는 가격 · ${targets.buyShares.toLocaleString()}주 매수 (현금의 50% 한도)`
    : '현금이 없어 매수 주문이 없습니다. 매도가 체결되면 생깁니다.');

  if (rationale) {
    rationale.innerHTML = `
      <strong>VR 주문가의 산출 근거</strong><br/>
      • 기준 평가금 V <strong>${formatUSD(t.vrValue)}</strong> · 지금 평가금 ${formatUSD(value)} (V 대비 ${formatBtSignedPct(value / t.vrValue - 1)})<br/>
      • 매도가 = V × 1.15 ÷ 보유 수량, 매수가 = V × 0.85 ÷ 보유 수량 · 다음 V 갱신 ${escapeHTML(t.vrNextUpdate)}
    `;
  }
}

function renderChartTargets(t) {
  if (isVrRule(t)) renderVrChartTargets(t);
  else renderRotationChartTargets(t);
}

function openSimulatorFromChart() {
  if (!isVrRule(appState.tickers[appState.currentTicker])) applyAutoTargetsToSimulator();
  setSubTab('rescue', 'sim');
  switchView('rescue');
}

// ------------------------------ 시뮬레이터 ------------------------------
function vrFillColumn(t, label, order, emptyText) {
  if (!order) {
    return `<div class="result-col"><span class="res-label">${label}</span><div class="res-compare"><strong class="after-val">-</strong></div><span class="res-sub">${emptyText}</span></div>`;
  }
  const cash = t.reservedCash || 0;
  const after = order.side === 'SELL'
    ? { shares: t.shares - order.shares, cash: cash + order.shares * order.price * (1 - TRADING_FEE_RATE) }
    : { shares: t.shares + order.shares, cash: Math.max(0, cash - order.shares * order.price * (1 + TRADING_FEE_RATE)) };
  return `
    <div class="result-col">
      <span class="res-label">${label} (${formatUSD(order.price)})</span>
      <div class="res-compare">
        <span class="before-val">${t.shares.toLocaleString()}주</span>
        <span class="arrow" aria-hidden="true">→</span>
        <strong class="after-val">${after.shares.toLocaleString()}주</strong>
      </div>
      <span class="res-sub">현금 ${formatUSD(after.cash)} · 본전 ${formatUSD(vrBreakeven(t, after.shares, after.cash))}</span>
    </div>`;
}

function vrLadderRow(t, step, row) {
  const isSell = row.side === 'SELL';
  return `
    <tr>
      <td><strong>${isSell ? '매도' : '매수'} ${step}단계</strong></td>
      <td><strong>${formatUSD(row.price)}</strong></td>
      <td class="${isSell ? 'is-sell' : 'is-buy'}">${row.qty.toLocaleString()}주</td>
      <td>${row.shares.toLocaleString()}주</td>
      <td class="col-opt">${formatUSD(row.cash)}</td>
      <td>${formatUSD(vrBreakeven(t, row.shares, row.cash))}</td>
    </tr>`;
}

function renderVrSimulator(t) {
  const box = document.getElementById('rescue-sim-vr');
  if (!box) return;
  const conclusion = document.getElementById('concl-rescue-sim');
  const targets = vrTargets(t);
  if (!targets) {
    box.innerHTML = `<div class="bt-placeholder">기준 평가금 V가 아직 없습니다. ${VR_WAITING_TEXT}</div>`;
    conclusion.textContent = VR_WAITING_TEXT;
    return;
  }

  const cash = t.reservedCash || 0;
  const value = t.shares * t.currentPrice;
  const sellOrder = targets.shares > 0 ? { side: 'SELL', price: targets.price, shares: targets.shares } : null;
  const buyOrder = targets.buyShares > 0 ? { side: 'REBUY', price: targets.buyPrice, shares: targets.buyShares } : null;
  const sellRows = simulateVrLadder(t.vrValue, t.shares, cash, 'SELL', sellOrder);
  const buyRows = simulateVrLadder(t.vrValue, t.shares, cash, 'REBUY', buyOrder);
  const nextValue = t.vrValue + cash / VR_G;

  conclusion.innerHTML = `지금 평가금은 V의 <strong>${formatBtSignedPct(value / t.vrValue - 1)}</strong> 위치입니다. <strong>${formatUSD(targets.price)}</strong> 이상이면 매도${buyOrder ? `, <strong>${formatUSD(targets.buyPrice)}</strong> 이하면 매수` : ''} 주문이 체결되고, 그 사이에서는 주문이 없습니다.`;

  box.innerHTML = `
    <div class="card">
      <div class="sim-result-banner">
        <div class="result-col">
          <span class="res-label">지금 상태</span>
          <div class="res-compare"><strong class="after-val">${t.shares.toLocaleString()}주</strong></div>
          <span class="res-sub">현금 ${formatUSD(cash)} · 본전 ${formatUSD(vrBreakeven(t, t.shares, cash))}</span>
        </div>
        ${vrFillColumn(t, '매도 체결 시', sellOrder, '매도할 수량이 없습니다')}
        ${vrFillColumn(t, '매수 체결 시', buyOrder, '현금이 없어 매수 주문이 없습니다')}
      </div>

      <div class="roadmap-container">
        <h4>가격대별 VR 주문 (V ${formatUSD(t.vrValue)} 고정, 연속 체결 가정)</h4>
        <div class="table-responsive">
          <table class="roadmap-table">
            <thead>
              <tr>
                <th>단계</th>
                <th>주문가</th>
                <th>수량</th>
                <th>체결 후 보유</th>
                <th class="col-opt">체결 후 현금</th>
                <th>체결 후 본전</th>
              </tr>
            </thead>
            <tbody>
              ${sellRows.map((row, i) => ({ row, step: i + 1 })).reverse().map(({ row, step }) => vrLadderRow(t, step, row)).join('')}
              ${buyRows.map((row, i) => vrLadderRow(t, i + 1, row)).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <div class="bt-notes">
        <div>다음 V 갱신 ${escapeHTML(t.vrNextUpdate)}: 현금이 그대로면 V가 ${formatUSD(t.vrValue)} → ${formatUSD(nextValue)}로 올라가고, 주문가도 함께 올라갑니다.</div>
        <div>매도는 V까지만 팔고, 매수는 V까지 사되 현금의 50%를 넘지 않습니다. 표는 앞 단계가 모두 체결된다고 가정한 계산이며 수수료 편도 0.1%를 반영했습니다.</div>
      </div>
      <div class="sim-actions">
        <button type="button" class="btn-secondary" onclick="switchView('overview')">오늘의 주문 보기</button>
      </div>
    </div>
  `;
}

// ------------------------------ 계획이 틀어지면 ------------------------------
function renderVrScenarios(t) {
  const box = document.getElementById('scenario-result');
  const conclusion = document.getElementById('concl-rescue-scenario');
  const targets = vrTargets(t);
  if (!box) return;
  if (!targets) {
    box.innerHTML = `<div class="bt-placeholder">기준 평가금 V가 아직 없습니다. ${VR_WAITING_TEXT}</div>`;
    conclusion.textContent = VR_WAITING_TEXT;
    return;
  }

  const ticker = appState.currentTicker;
  const cur = t.currentPrice;
  const cash = t.reservedCash || 0;
  const upperPrice = targets.price;
  const lowerPrice = targets.buyPrice;
  const hold = { shares: t.shares, cash };
  const afterSell = { shares: t.shares - targets.shares, cash: cash + targets.shares * upperPrice * (1 - TRADING_FEE_RATE) };
  const afterBuy = { shares: t.shares + targets.buyShares, cash: Math.max(0, cash - targets.buyShares * lowerPrice * (1 + TRADING_FEE_RATE)) };
  const valueAt = (x, price) => x.shares * price + x.cash;
  const beHold = vrBreakeven(t, hold.shares, hold.cash);
  const beSell = vrBreakeven(t, afterSell.shares, afterSell.cash);
  const beBuy = vrBreakeven(t, afterBuy.shares, afterBuy.cash);
  const nextUpper = afterSell.shares > 0 ? (t.vrValue * (1 + VR_BAND)) / afterSell.shares : upperPrice;
  const deeper = lowerPrice * 0.8;
  const hasBuy = targets.buyShares > 0;

  // 과거 빈도: 같은 폭(위·아래)을 어느 쪽이 먼저 닿았나
  const history = readBacktestHistoryCache(ticker);
  const crashOnly = document.getElementById('bt-rot-start').value === 'crash';
  const up = upperPrice / cur - 1;
  const down = 1 - lowerPrice / cur;
  let odds = null;
  if (history && up > 0 && down > 0) {
    const key = JSON.stringify([history.at, up.toFixed(4), down.toFixed(4), crashOnly]);
    let cached = btResults.vrOdds[ticker];
    if (!cached || cached.key !== key) {
      cached = { key, result: btBandTouchOdds(history.bars, { up, down, crashDrawdown: crashOnly ? 0.45 : 0 }) };
      btResults.vrOdds[ticker] = cached;
    }
    odds = cached.result.n ? cached.result : null;
  }
  const oddsHint = history
    ? '현재가가 이미 밴드 밖이면 과거 빈도를 셀 수 없습니다.'
    : '과거 빈도는 과거 검증 탭에서 일봉을 받으면 표시됩니다.';

  conclusion.innerHTML = `매도 후 계속 오르면 본전이 <strong>${formatUSD(beHold)} → ${formatUSD(beSell)}</strong>로 올라갑니다. ${hasBuy ? `하단에서 사면 본전은 ${formatUSD(beBuy)}입니다.` : '지금은 현금이 없어 하단에서 살 수 없습니다.'}`;

  const scenarios = [
    {
      cls: 'scenario-good',
      title: `상단 도달: ${formatUSD(upperPrice)}에 매도`,
      body: `${t.shares.toLocaleString()}주 → <strong>${afterSell.shares.toLocaleString()}주</strong>, 현금 ${formatUSD(afterSell.cash)}. 이 현금은 이후 하단 매수와 V 상승에 쓰입니다.`,
      odds: odds && `60거래일 안에 위쪽 ${formatBtSignedPct(up)}에 먼저 닿은 경우 ${formatBtPct(odds.up60Pct)}, 1년 안 ${formatBtPct(odds.up252Pct)}`
    },
    {
      cls: 'scenario-bad',
      title: '판 뒤 계속 오름',
      body: `본전 주가가 ${formatUSD(beHold)} → <strong>${formatUSD(beSell)}</strong>로 올라갑니다. 다음 매도가는 ${formatUSD(nextUpper)}이고, ${formatUSD(beHold)}까지 오르면 그냥 보유보다 <strong>${formatUSD(valueAt(hold, beHold) - valueAt(afterSell, beHold))}</strong> 적습니다.`,
      odds: null
    },
    {
      cls: 'scenario-warn',
      title: hasBuy ? `하단 도달: ${formatUSD(lowerPrice)}에 매수` : '현금 없이 하락',
      body: hasBuy
        ? `${formatUSD(lowerPrice)}에서 산 뒤 -20% 더 빠져 ${formatUSD(deeper)}가 되면 평가액 ${formatUSD(valueAt(afterBuy, deeper))} (매수 안 했을 때 ${formatUSD(valueAt(hold, deeper))}). 현금의 50%까지만 쓰므로 한 번에 다 쓰지 않습니다.`
        : `현금이 없어 하단에 닿아도 살 수 없습니다. ${formatUSD(deeper)}까지 빠지면 평가액은 ${formatUSD(valueAt(hold, deeper))}입니다.`,
      odds: odds && `60거래일 안에 아래쪽 -${(down * 100).toFixed(1)}%에 먼저 닿은 경우 ${formatBtPct(odds.down60Pct)}, 1년 안 ${formatBtPct(odds.down252Pct)}`
    },
    {
      cls: 'scenario-neutral',
      title: '밴드 안에서 움직임',
      body: `주문이 체결되지 않아 그대로입니다. 2주마다 V가 현금의 1/10만큼 올라 주문가도 조금씩 올라갑니다.`,
      odds: odds && `60거래일 동안 양쪽 모두 닿지 않은 경우 ${formatBtPct(odds.neither60Pct)}`
    }
  ];

  const labelled = [
    [deeper, '하단 -20%'],
    [lowerPrice, '매수가'],
    [cur, '현재가'],
    [upperPrice, '매도가'],
    [upperPrice * 1.3, '매도가 +30%'],
    [beHold, '지금 본전']
  ];
  const grid = new Map();
  labelled.forEach(([price, label]) => {
    const key = Number(price.toFixed(2));
    if (key > 0) grid.set(key, [...(grid.get(key) || []), label]);
  });
  const rowsHTML = [...grid.keys()].sort((a, b) => a - b).map(price => {
    const vals = [valueAt(hold, price), valueAt(afterSell, price), ...(hasBuy ? [valueAt(afterBuy, price)] : [])];
    const best = Math.max(...vals.map(v => Math.round(v)));
    return `
      <tr>
        <td><strong>${formatUSD(price)}</strong><br/><small class="bt-rule-desc">${grid.get(price).join(' · ')}</small></td>
        ${vals.map(v => `<td${Math.round(v) === best ? ' class="bt-best"' : ''}>${formatUSD(v)}</td>`).join('')}
      </tr>`;
  }).join('');

  box.innerHTML = `
    <div class="scenario-grid">
      ${scenarios.map(sc => `
        <div class="scenario-item ${sc.cls}">
          <strong class="scenario-title">${sc.title}</strong>
          <span class="scenario-body">${sc.body}</span>
          ${sc.title === '판 뒤 계속 오름' ? '' : `<span class="scenario-odds">${sc.odds || oddsHint}</span>`}
        </div>`).join('')}
    </div>
    <div class="table-responsive">
      <table class="bt-table">
        <thead>
          <tr>
            <th>그 뒤 주가</th>
            <th>주문 없이 그대로</th>
            <th>매도 체결 뒤</th>
            ${hasBuy ? '<th>매수 체결 뒤</th>' : ''}
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
    <div class="bt-notes">
      <div>금액은 그 가격에서의 총 평가액(주식 + 현금)입니다. 초록색은 그 가격에서 가장 큰 값입니다.</div>
      <div>${odds ? `과거 빈도는 ${ticker} 일봉의 시작점 ${odds.n.toLocaleString()}일(${crashOnly ? '폭락 후' : '모든 거래일'})에서 지금과 같은 폭으로 센 값입니다. ` : ''}과거 빈도가 앞으로의 확률을 보장하지 않습니다.</div>
    </div>
  `;
}

// ------------------------------ 과거 검증 ------------------------------
function renderVrBacktest(p) {
  const box = document.getElementById('bt-rotation-result');
  const conclusion = document.getElementById('concl-rescue-backtest');
  const ticker = appState.currentTicker;
  document.getElementById('bt-rot-rule').innerHTML =
    '규칙: 기준 평가금 V의 <strong>±15%</strong> 가격에 지정가 · 상단에서 V까지 매도 · 하단에서 현금의 50% 안에서 매수 · 2주마다 V를 현금의 1/10만큼 상향 (전량 주식으로 시작)';

  const history = btHistory[ticker] || readBacktestHistoryCache(ticker);
  if (!history) {
    box.innerHTML = `<div class="bt-placeholder">아직 검증 전입니다. <strong>과거 일봉으로 검증</strong>을 누르면 ${ticker} 상장 이후 일봉을 한 번 받아 이 기기에 저장합니다${getQuoteApiKey() ? ' (Twelve Data 1회 조회)' : ''}.</div>`;
    conclusion.textContent = '아직 검증 전입니다. 과거 일봉으로 검증을 누르면 결론이 여기에 표시됩니다.';
    return;
  }

  const crashDrawdown = p.crashOnly ? 0.45 : 0;
  const key = JSON.stringify([history.at, crashDrawdown, p.breakevenMultiple.toFixed(3)]);
  let cached = btResults.vr[ticker];
  if (!cached || cached.key !== key) {
    cached = { key, result: btVrStudy(history.bars, { crashDrawdown, breakevenMultiple: p.breakevenMultiple }) };
    btResults.vr[ticker] = cached;
  }
  const r = cached.result;
  const [h1, h2] = r.horizons;
  const startLabel = p.crashOnly ? '직전 1년 최고 종가 대비 -45% 이하로 떨어진 날' : '상장 1년 뒤부터 모든 거래일';
  if (!h1 || !h1.n) {
    box.innerHTML = `<div class="bt-placeholder">${startLabel}이 1년 이상 지난 시작점이 없어 비교할 수 없습니다.<br/><small>${btDataLine(history)}</small></div>`;
    return;
  }

  conclusion.innerHTML = `<strong>${h1.beatPct < h1.losePct ? `과거엔 그냥 보유가 ${formatBtPct(h1.losePct)} 확률로 더 나았음` : `과거엔 VR이 ${formatBtPct(h1.beatPct)} 확률로 더 나았음`}</strong> <span>1년 뒤 VR 자산은 보유 대비 중앙값 ${formatBtSignedPct(h1.medianRatio - 1)}입니다.</span>`;

  const horizonItem = (h, label) => !h || !h.n ? '' : `
    <div class="diag-item">
      <span class="diag-label">${label} VR이 보유보다 나았던 비율</span>
      <strong class="diag-value">${formatBtPct(h.beatPct)}</strong>
      <span class="diag-sub">자산 비율 중앙값 ${h.medianRatio.toFixed(3)} (${h.n.toLocaleString()}개 시작점)</span>
    </div>`;
  const be = r.breakeven;
  const breakevenHTML = !be || !be.n ? '' : `
    <div class="diag-item highlight-diag">
      <span class="diag-label">지금 본전까지 +${((be.multiple - 1) * 100).toFixed(0)}% 필요 · 과거 같은 상승을 기다렸다면</span>
      <strong class="diag-value">VR이 먼저 도달 ${formatBtPct(be.vrFasterPct)}</strong>
      <span class="diag-sub">본전 도달: 보유 ${be.holdReached}/${be.n} · VR ${be.vrReached}/${be.n} · 걸린 거래일 중앙값 보유 ${be.medianHoldDays ?? '-'} / VR ${be.medianVrDays ?? '-'}</span>
    </div>`;

  box.innerHTML = `
    <div class="diagnosis-box">
      ${horizonItem(h1, '1년 뒤')}
      ${horizonItem(h2, '2년 뒤')}
      ${breakevenHTML}
    </div>
    <div class="bt-notes">
      <div>시작점: ${startLabel} ${r.startCount.toLocaleString()}일 · 서로 겹치지 않는 하락 구간은 약 <strong>${r.episodes.length}번</strong>뿐이라 통계적 증명이 아닌 방향성으로 보세요.</div>
      <div>VR은 큰 낙폭을 막는 규칙이 아닙니다. 현금이 적을 때 급락하면 하락을 대부분 그대로 받습니다.</div>
      <div>${btDataLine(history)} · 수수료 편도 0.1%, 지정가는 고가·저가가 닿은 날 체결 가정, 세금 미반영. 과거 결과가 미래를 보장하지 않습니다.</div>
    </div>
  `;
}

// ------------------------------ 규칙 전환 ------------------------------
function renderRuleScreens(t) {
  const vr = isVrRule(t);
  setVisible('rescue-sim-rotation', !vr);
  setVisible('rescue-sim-vr', vr);
  setVisible('chart-mode-bar', !vr);
  setVisible('bt-rot-timeout-group', !vr);

  setText('rescue-intro', vr
    ? '내 평가금이 기준 평가금 V의 ±15%를 벗어나는 가격과, 체결되면 수량·현금·본전이 어떻게 바뀌는지 계산합니다. 수수료 0.1%와 정수 주문을 반영합니다.'
    : '반등에 일부 팔고 눌림목에서 다시 사 주식 수를 늘리는 계산입니다. 왕복 수수료 0.2%와 정수 주문을 반영하며, 두 주문이 모두 체결된다고 가정합니다.');
  setText('chart-helper', vr
    ? 'VR 주문가는 차트 신호가 아니라 내 평가금과 기준 평가금 V의 차이로 정해집니다. 볼린저밴드·RSI는 시장 위치 참고용입니다.'
    : '회전 규칙의 매도 참고선: 20일 중심선·상단선 또는 RSI 60 이상 · 재매수 참고선: 하단선 또는 RSI 38 이하');
  setText('chart-sim-btn', vr ? 'VR 시뮬레이션 보기' : '이 타점으로 탈출 시뮬레이션');
  setText('scenario-intro', vr
    ? 'VR 주문은 위쪽 매도와 아래쪽 매수로 나뉩니다. 앞으로 갈 수 있는 네 갈래를 지금 V와 내 보유 현황으로 계산합니다.'
    : '시뮬레이터는 매도와 재매수가 모두 체결된 경우만 보여줍니다. 실제로는 아래 네 갈래 중 하나가 됩니다. 숫자는 시뮬레이터 설정과 내 보유 현황으로 계산합니다.');
  setText('bt-card-title', vr ? 'VR 규칙이 실제로 통했나?' : '이 회전 규칙이 실제로 통했나?');
  setText('bt-intro-text', vr
    ? 'VR 규칙을 상장 이후 실제 일봉에 적용해, 같은 날 시작해서 그냥 보유했을 때와 비교합니다.'
    : '시뮬레이터의 매도가·매도 비율·재매수가를 상장 이후 실제 일봉에 적용해, 같은 날 시작해서 그냥 보유했을 때와 비교합니다.');

  renderChartTargets(t);
  if (vr) renderVrSimulator(t);
}
