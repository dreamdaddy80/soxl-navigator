// 원금 탈출·40분할 장부: 보유 수량과 금액은 기록을 재생한 결과에서만 나온다

// 저장 데이터를 "원금 기준점 + 매매 기록" 한 가지 기준으로 맞춘다.
// t: 기본값과 합친 종목 데이터, src: 저장돼 있던 원본 종목 데이터
function repairPrincipalAnchor(t, src) {
  const hasAnchor = Number(src.baseShares) > 0 && Number(src.baseAvgPrice) > 0 && Number(src.originalPrincipal) > 0;
  // 2026-11-08 배포본 하나가 빈 기준점을 샘플 기본값(100주·$60·$6,000)으로 채워 저장한 경우
  const isSampleLeak = Number(src.baseShares) === 100 && Number(src.baseAvgPrice) === 60 &&
    Number(src.originalPrincipal) === 6000 && !(t.shares === 100 && t.avgPrice === 60);

  if (t.logs.length === 0 && (!hasAnchor || isSampleLeak)) {
    // 기준점이 없던 예전 버전에서는 입력칸 값(보유 수량·평단)이 곧 기준점이었다
    t.baseShares = t.shares;
    t.baseAvgPrice = t.avgPrice;
  }
  const expected = Number((t.baseShares * t.baseAvgPrice).toFixed(2));
  if (Math.abs((t.originalPrincipal || 0) - expected) > 0.01) {
    t.originalPrincipal = expected;
  }

  // 시작 현금 필드가 생기기 전에는 기록 없이 [보유 구출 현금] 칸에 직접 넣은 금액이 있을 수 있다.
  // 지금 보이는 탈출가가 바뀌지 않도록 그 금액을 작전 시작 현금으로 옮긴다.
  if (!('baseCash' in src)) {
    t.baseCash = t.logs.length === 0 ? Math.max(0, Number(t.reservedCash) || 0) : 0;
  }
}

function ensurePrincipalAnchor(t) {
  if (typeof t.baseShares !== 'number' || t.baseShares <= 0) {
    t.baseShares = t.shares || 0;
  }
  if (typeof t.baseAvgPrice !== 'number' || t.baseAvgPrice <= 0) {
    t.baseAvgPrice = t.avgPrice || 0;
  }
  if (typeof t.originalPrincipal !== 'number' || t.originalPrincipal <= 0) {
    t.originalPrincipal = Number((t.baseShares * t.baseAvgPrice).toFixed(2));
  }
}

// 회복 목표 원금 = 최초 원금 + 보유 현금을 초과한 매수에 새로 투입한 돈
function getTotalPrincipal(t) {
  return (t.originalPrincipal || 0) + (t.addedPrincipal || 0);
}

// 매매 기록(추가·수정·삭제) 변경 시 초기 원금(originalPrincipal)은 고정하고 현재 잔고만 정확히 재계산 (수수료 0.1% 반영)
function recalculateRescueBalanceFromLogs(t) {
  ensurePrincipalAnchor(t);

  const originalPrincipal = t.originalPrincipal;
  let curShares = t.baseShares;
  let curCash = Math.max(0, Number(t.baseCash) || 0);
  let addedPrincipal = 0;

  // 오래된 기록부터 순서대로 재생
  sortByTradeDate(t.logs);
  const chronological = [...(t.logs || [])].reverse();
  chronological.forEach(item => {
    const p = Number(item.price) || 0;
    const s = Number(item.shares) || 0;
    const grossAmt = p * s;

    if (item.type === 'DEPOSIT') {
      // 외부에서 넣은 돈: 현금과 회복 목표 원금이 함께 늘어난다
      item.shares = 1;
      item.amount = Number(p.toFixed(2));
      curCash = Number((curCash + item.amount).toFixed(2));
      addedPrincipal = Number((addedPrincipal + item.amount).toFixed(2));
    } else if (item.type === 'WITHDRAW') {
      // 구출 현금을 빼서 다른 곳에 쓴 돈: 돌려받은 셈이므로 회복 목표 원금에서 뺀다
      item.shares = 1;
      const out = Math.min(Number(p.toFixed(2)), curCash);
      item.amount = out;
      curCash = Number((curCash - out).toFixed(2));
      addedPrincipal = Number((addedPrincipal - out).toFixed(2));
    } else if (item.type === 'SELL') {
      const netProceeds = Number((grossAmt * (1 - TRADING_FEE_RATE)).toFixed(2));
      item.amount = netProceeds;
      curShares = Math.max(0, Number((curShares - s).toFixed(4)));
      curCash = Number((curCash + netProceeds).toFixed(2));
    } else {
      const netCost = Number((grossAmt * (1 + TRADING_FEE_RATE)).toFixed(2));
      item.amount = netCost;
      curShares = Number((curShares + s).toFixed(4));
      if (netCost > curCash) {
        // 확보 현금보다 많이 산 부분은 새로 넣은 돈이므로 회복 목표 원금에 더한다
        addedPrincipal = Number((addedPrincipal + netCost - curCash).toFixed(2));
        curCash = 0;
      } else {
        curCash = Number((curCash - netCost).toFixed(2));
      }
    }
  });

  t.shares = curShares;
  t.reservedCash = curCash;
  t.addedPrincipal = addedPrincipal;
  const neededFromStock = Math.max(0, originalPrincipal + addedPrincipal - curCash);
  t.avgPrice = curShares > 0 ? Number((neededFromStock / curShares).toFixed(2)) : t.baseAvgPrice;
}

// 40분할 수익 모드에서 기록(수정·삭제) 변경 시 평단가·수량·누적수익 재계산
// 40분할 기록을 체결일 순서로 재생한 결과. 보유·평단·누적수익은 이 값에서만 나온다
function replayGrowthLedger(history) {
  const ordered = [...(history || [])];
  sortByTradeDate(ordered);
  ordered.reverse();

  let heldShares = 0;
  let totalCost = 0;
  let cumulativeProfit = 0;
  let cycleCount = 1;
  ordered.forEach(item => {
    const shares = Number(item.shares) || 0;
    if (item.type === 'BUY') {
      totalCost += (Number(item.price) || 0) * shares;
      heldShares = Number((heldShares + shares).toFixed(4));
    } else if (item.type === 'ADJUST') {
      totalCost = Math.max(0, totalCost + (Number(item.amount) || 0));
      heldShares = Math.max(0, Number((heldShares + shares).toFixed(4)));
    } else if (item.type === 'GRADUATE') {
      cumulativeProfit = Number((cumulativeProfit + (Number(item.amount) || 0)).toFixed(2));
      cycleCount += 1;
      heldShares = 0;
      totalCost = 0;
    }
  });
  return { heldShares, totalCost, cumulativeProfit, cycleCount };
}

// 기록 재생 결과를 목표 보유분(수량·총 매입금액)에 맞추는 조정 기록. 이미 같으면 null
function growthAdjustmentRecord(ledger, targetShares, targetCost, memo) {
  const shares = Number((targetShares - ledger.heldShares).toFixed(4));
  const amount = Number((targetCost - ledger.totalCost).toFixed(2));
  if (shares === 0 && Math.abs(amount) < 0.01) return null;
  return { id: Date.now(), tradeDate: todayISO(), type: 'ADJUST', price: 0, shares, amount, memo };
}

// 입력칸으로 보유 수량·평단을 직접 고치던 버전의 저장 데이터를 기록 기준으로 옮긴다.
// 화면에 보이던 보유분과 시드가 바뀌지 않도록, 기록과 다른 만큼을 조정 기록으로 남긴다.
function repairGrowthLedger(t, src) {
  const saved = src.growth;
  if (!saved || typeof saved !== 'object') return;
  const g = t.growth;
  const ledger = replayGrowthLedger(g.history);

  if (saved.heldShares != null) {
    const savedShares = Math.max(0, Number(saved.heldShares) || 0);
    const ledgerAvg = ledger.heldShares > 0 ? ledger.totalCost / ledger.heldShares : 0;
    const savedAvg = Number(saved.avgPrice) > 0 ? Number(saved.avgPrice) : (ledgerAvg || t.currentPrice);
    const sharesDiffer = Math.abs(savedShares - ledger.heldShares) > 0.0001;
    const avgDiffers = savedShares > 0 && ledger.heldShares > 0 && Math.abs(savedAvg - ledgerAvg) > GROWTH_AVG_TOLERANCE;
    if (sharesDiffer || avgDiffers) {
      const record = growthAdjustmentRecord(ledger, savedShares, savedShares * savedAvg, '이전 버전에서 직접 입력한 보유분을 기록으로 옮김');
      if (record) g.history.unshift(record);
    }
  }

  if (Number(saved.totalBudget) > 0) {
    g.baseTotalBudget = Number((Number(saved.totalBudget) - ledger.cumulativeProfit).toFixed(2));
  }
}

function recalculateGrowthFromHistory(t) {
  const g = t.growth;
  if (!g.baseTotalBudget) {
    g.baseTotalBudget = Number(((g.totalBudget || 0) - (g.cumulativeProfit || 0)).toFixed(2));
  }

  sortByTradeDate(g.history);
  g.history.forEach(item => {
    if (item.type === 'BUY') item.amount = Number(((Number(item.price) || 0) * (Number(item.shares) || 0)).toFixed(2));
  });

  const ledger = replayGrowthLedger(g.history);
  g.heldShares = ledger.heldShares;
  g.avgPrice = ledger.heldShares > 0 ? Number((ledger.totalCost / ledger.heldShares).toFixed(2)) : t.currentPrice;
  g.cumulativeProfit = ledger.cumulativeProfit;
  g.cycleCount = ledger.cycleCount;
  g.totalBudget = Number((g.baseTotalBudget + ledger.cumulativeProfit).toFixed(2));
}

// 입금·인출 기록은 주식 수 없이 금액(price 필드)만 쓴다
function isCashLogType(type) {
  return type === 'DEPOSIT' || type === 'WITHDRAW';
}
