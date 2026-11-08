// 매매 기록 분석: 기록을 다시 읽어 회전과 40분할 사이클의 실제 성적을 계산한다 (화면과 무관)

function daysBetweenDates(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}

function chronologicalRecords(list) {
  const ordered = [...(list || [])];
  sortByTradeDate(ordered);
  return ordered.reverse();
}

// 매도 후 재매수를 한 번의 회전으로 묶는다. 판 돈을 넘겨 산 부분은 새 돈이므로 회전에서 뺀다
function analyzeRotations(t, currentPrice, today) {
  const rotations = [];
  let open = null;
  let newMoneyCost = 0;
  let fees = 0;

  const closeOpen = () => {
    open.status = open.buyShares > 0 ? 'done' : 'waiting';
    rotations.push(open);
    open = null;
  };

  chronologicalRecords(t.logs).forEach(item => {
    const shares = Number(item.shares) || 0;
    const gross = (Number(item.price) || 0) * shares;
    const date = getTradeDate(item);

    if (item.type === 'SELL') {
      fees += gross * TRADING_FEE_RATE;
      if (open && open.buyShares > 0) closeOpen();
      if (!open) open = { sellDate: date, buyDate: null, sellShares: 0, proceeds: 0, buyShares: 0, cost: 0 };
      open.sellShares += shares;
      open.proceeds += Number(item.amount) || 0;
    } else if (item.type === 'BUY') {
      fees += gross * TRADING_FEE_RATE;
      const netCost = Number(item.amount) || 0;
      if (!open) {
        newMoneyCost += netCost;
        return;
      }
      const remaining = Math.max(0, open.proceeds - open.cost);
      const funded = netCost > 0 ? Math.min(1, remaining / netCost) : 0;
      open.buyShares += shares * funded;
      open.cost += netCost * funded;
      open.buyDate = date;
      newMoneyCost += netCost * (1 - funded);
      if (open.cost >= open.proceeds * 0.95) closeOpen();
    }
  });

  if (open) {
    open.status = open.buyShares > 0 ? 'partial' : 'waiting';
    rotations.push(open);
  }

  rotations.forEach(r => {
    r.netSellPrice = r.proceeds / r.sellShares;
    r.netBuyPrice = r.buyShares > 0 ? r.cost / r.buyShares : null;
    r.shareChange = r.buyShares - r.sellShares;
    r.cashLeft = r.proceeds - r.cost;
    r.daysWaited = daysBetweenDates(r.sellDate, r.buyDate || today);
    r.effectNow = r.shareChange * currentPrice + r.cashLeft; // 이 회전을 안 했을 때와 비교한 지금의 손익
    r.won = r.netBuyPrice != null && r.netBuyPrice < r.netSellPrice;
  });

  const finished = rotations.filter(r => r.status !== 'waiting');
  const waiting = rotations.find(r => r.status === 'waiting') || null;
  const actualValue = t.shares * currentPrice + (t.reservedCash || 0);
  const holdValue = t.baseShares * currentPrice + (Number(t.baseCash) || 0) + (t.addedPrincipal || 0);

  return {
    rotations,
    finishedCount: finished.length,
    wins: finished.filter(r => r.won).length,
    winPct: finished.length ? (finished.filter(r => r.won).length / finished.length) * 100 : null,
    medianDaysWaited: finished.length ? btMedian(finished.map(r => r.daysWaited)) : null,
    waiting,
    newMoneyCost,
    fees,
    actualValue,
    holdValue,
    effectVsHold: actualValue - holdValue
  };
}

// 40분할 사이클별 실제 수익. 수익률은 그 사이클의 시드 대비
function analyzeGrowthCycles(g, today) {
  const cycles = [];
  let start = null;
  let seed = g.baseTotalBudget || 0;

  chronologicalRecords(g.history).forEach(item => {
    const date = getTradeDate(item);
    if (item.type === 'BUY' || item.type === 'ADJUST') {
      if (!start) start = date;
    } else if (item.type === 'GRADUATE') {
      const profit = Number(item.amount) || 0;
      cycles.push({
        start: start || date,
        end: date,
        days: daysBetweenDates(start || date, date),
        profit,
        profitPct: seed > 0 ? profit / seed : null
      });
      seed += profit;
      start = null;
    }
  });

  const profits = cycles.map(c => c.profit);
  const rates = cycles.map(c => c.profitPct).filter(v => v != null);
  return {
    cycles,
    count: cycles.length,
    wins: profits.filter(v => v > 0).length,
    totalProfit: profits.reduce((a, b) => a + b, 0),
    avgProfitPct: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
    medianDays: cycles.length ? btMedian(cycles.map(c => c.days)) : null,
    currentCycleDays: start ? daysBetweenDates(start, today) : null
  };
}
