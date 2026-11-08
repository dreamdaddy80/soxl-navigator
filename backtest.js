// =========================================================================
// 과거 일봉 검증(백테스트) 엔진
// DOM·상태에 의존하지 않는 순수 함수만 둔다. bars는 오래된 날짜부터 [{ d, o, h, l, c }].
// 체결 가정: 지정가는 그날 고가·저가가 닿으면 체결(갭이면 시가), LOC는 종가 체결, 편도 수수료 0.1%.
// =========================================================================
const BT_FEE_RATE = 0.001;
const BT_YEAR_BARS = 252;

function btMedian(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function btPct(part, whole) {
  return whole > 0 ? (part / whole) * 100 : null;
}

// 앱의 computeRSI와 같은 Wilder 방식 RSI를 날짜별로 미리 계산 (i일 종가까지 반영)
function btRsiSeries(closes, period = 14) {
  const out = new Array(closes.length).fill(50);
  if (closes.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

// 앱의 computeBollingerBands와 같은 20일·2σ 하단선
function btBollingerLowerSeries(closes, period = 20, mult = 2) {
  const out = new Array(closes.length).fill(0);
  for (let i = period - 1; i < closes.length; i++) {
    let sum = 0;
    for (let k = i - period + 1; k <= i; k++) sum += closes[k];
    const mean = sum / period;
    let variance = 0;
    for (let k = i - period + 1; k <= i; k++) variance += (closes[k] - mean) ** 2;
    out[i] = mean - mult * Math.sqrt(variance / period);
  }
  return out;
}

// -------------------------------------------------------------------------
// 원금 탈출 회전: start일 종가에 1000주를 들고 시작
//   SELL 대기: 고가가 기준가×(1+up)에 닿으면 ratio만큼 매도
//   BUY 대기: 저가가 매도가×(1-drop)에 닿으면 현금 전액 정수 재매수
//             timeout > 0이면 그 거래일 수를 넘긴 날 종가에 재매수 (앱 기본 규칙은 0 = 무한 대기)
// 같은 기간 1000주를 그냥 보유한 것과 비교한다.
// -------------------------------------------------------------------------
function btRotationRun(bars, start, opts, checkpoints, breakevenValue) {
  const { up, drop, ratio, timeout = 0 } = opts;
  const holdShares = 1000;
  let shares = holdShares;
  let cash = 0;
  let state = 'SELL';
  let target = bars[start].c * (1 + up);
  let since = start;
  let beRot = -1;
  let beHold = -1;
  const lastCheckpoint = checkpoints.length ? checkpoints[checkpoints.length - 1] : 0;
  const results = [];
  let nextCp = 0;

  for (let i = start + 1; i < bars.length; i++) {
    const b = bars[i];
    if (state === 'SELL' && b.h >= target) {
      const px = Math.max(b.o, target);
      const qty = Math.round(shares * ratio);
      shares -= qty;
      cash += qty * px * (1 - BT_FEE_RATE);
      state = 'BUY';
      target = px * (1 - drop);
      since = i;
    } else if (state === 'BUY' && (b.l <= target || (timeout > 0 && i - since >= timeout))) {
      const px = b.l <= target ? Math.min(b.o, target) : b.c;
      const qty = Math.floor(cash / (px * (1 + BT_FEE_RATE)));
      shares += qty;
      cash -= qty * px * (1 + BT_FEE_RATE);
      state = 'SELL';
      target = px * (1 + up);
    }

    const rotValue = shares * b.c + cash;
    const holdValue = holdShares * b.c;
    if (breakevenValue > 0) {
      if (beRot < 0 && rotValue >= breakevenValue) beRot = i - start;
      if (beHold < 0 && holdValue >= breakevenValue) beHold = i - start;
    }
    while (nextCp < checkpoints.length && i - start === checkpoints[nextCp]) {
      results.push({ days: checkpoints[nextCp], ratio: rotValue / holdValue, cashStuck: state === 'BUY' && cash > rotValue * 0.05 });
      nextCp++;
    }

    const breakevenDone = !(breakevenValue > 0) || (beRot >= 0 && beHold >= 0);
    if (i - start >= lastCheckpoint && breakevenDone) break;
  }
  return { checkpoints: results, beRot, beHold };
}

// 시작일마다 회전 vs 보유를 돌려 분포를 요약한다.
// opts.crashDrawdown: 직전 1년 최고 종가 대비 이만큼 이상 떨어진 날만 시작점으로 (0이면 모든 날)
// opts.breakevenMultiple: 시작가 대비 본전 배수 (예: 현재가 30, 본전 66이면 2.2). 1 이하면 본전 분석 생략
function btRotationStudy(bars, opts) {
  const horizons = opts.horizons || [BT_YEAR_BARS, BT_YEAR_BARS * 2];
  const crashDrawdown = opts.crashDrawdown || 0;
  const beMult = opts.breakevenMultiple > 1 ? opts.breakevenMultiple : 0;

  const starts = [];
  for (let s = BT_YEAR_BARS; s < bars.length - 1; s++) {
    if (crashDrawdown > 0) {
      let high = 0;
      for (let k = s - BT_YEAR_BARS; k < s; k++) if (bars[k].c > high) high = bars[k].c;
      if (bars[s].c > high * (1 - crashDrawdown)) continue;
    }
    starts.push(s);
  }

  // 겹치는 시작일이 많으므로 60거래일 넘게 끊긴 구간을 독립 에피소드로 센다
  const episodes = [];
  starts.forEach(s => {
    const last = episodes[episodes.length - 1];
    if (!last || s - last.end > 60) episodes.push({ from: bars[s].d, to: bars[s].d, end: s });
    else { last.end = s; last.to = bars[s].d; }
  });

  const perHorizon = horizons.map(days => ({ days, ratios: [], stuck: 0 }));
  const be = { n: 0, holdReached: 0, rotReached: 0, bothReached: 0, rotFaster: 0, holdDays: [], rotDays: [] };

  starts.forEach(s => {
    const remaining = bars.length - 1 - s;
    const cps = horizons.filter(h => h <= remaining);
    const withBreakeven = beMult > 0 && remaining >= BT_YEAR_BARS;
    if (!cps.length && !withBreakeven) return;
    const run = btRotationRun(bars, s, opts, cps, withBreakeven ? 1000 * bars[s].c * beMult : 0);
    run.checkpoints.forEach(cp => {
      const h = perHorizon.find(x => x.days === cp.days);
      h.ratios.push(cp.ratio);
      if (cp.cashStuck) h.stuck++;
    });
    if (withBreakeven) {
      be.n++;
      if (run.beHold >= 0) { be.holdReached++; be.holdDays.push(run.beHold); }
      if (run.beRot >= 0) { be.rotReached++; be.rotDays.push(run.beRot); }
      if (run.beHold >= 0 && run.beRot >= 0) {
        be.bothReached++;
        if (run.beRot < run.beHold) be.rotFaster++;
      }
    }
  });

  return {
    from: bars[0].d,
    to: bars[bars.length - 1].d,
    startCount: starts.length,
    episodes: episodes.map(e => ({ from: e.from, to: e.to })),
    horizons: perHorizon.map(h => ({
      days: h.days,
      n: h.ratios.length,
      beatPct: btPct(h.ratios.filter(r => r > 1).length, h.ratios.length),
      medianRatio: btMedian(h.ratios),
      stuckPct: btPct(h.stuck, h.ratios.length)
    })),
    breakeven: beMult > 0 ? {
      multiple: beMult,
      n: be.n,
      holdReached: be.holdReached,
      rotReached: be.rotReached,
      rotFasterPct: btPct(be.rotFaster, be.bothReached),
      medianHoldDays: btMedian(be.holdDays),
      medianRotDays: btMedian(be.rotDays)
    } : null
  };
}

// -------------------------------------------------------------------------
// 40분할 무한매수법 (앱 주문표 규칙 그대로)
//   사이클 첫날: 1회분 종가 매수
//   전반전(회차 < 분할/2): 1회분 절반은 평단 LOC, 절반은 전일 종가 +5% LOC
//   후반전: 1회분 전액 평단 LOC
//   매일 평단 +target 지정가 전량 매도 → 졸업하면 남은 현금 전부가 다음 사이클 시드(복리)
//   booster: 전일 RSI ≤ 38 또는 종가 ≤ 볼린저 하단×1.02면 1.5회분, RSI ≥ 64면 0.5회분
//   남은 현금이 1회분의 1/4 미만이면 매수 없이 졸업만 기다린다(= 소진·갇힘)
// -------------------------------------------------------------------------
function btSplitSim(bars, from, to, opts, indicators) {
  const { splits, target, booster } = opts;
  const closes = indicators.closes;
  let budget = 1;
  let cash = 1;
  let shares = 0;
  let cost = 0;
  let cycleStart = from;
  let stuckSince = -1;
  let peak = 1;
  let mdd = 0;
  let holdPeak = closes[from];
  let holdMdd = 0;
  const cycles = [];
  const stuckSpans = [];

  for (let i = from; i <= to; i++) {
    const b = bars[i];
    holdPeak = Math.max(holdPeak, b.c);
    holdMdd = Math.min(holdMdd, b.c / holdPeak - 1);

    if (shares > 0) {
      const sellAt = (cost / shares) * (1 + target);
      if (b.h >= sellAt) {
        const px = Math.max(b.o, sellAt);
        const proceeds = shares * px * (1 - BT_FEE_RATE);
        cycles.push({ days: i - cycleStart, profit: (proceeds - cost) / budget, exhausted: stuckSince >= 0 });
        if (stuckSince >= 0) { stuckSpans.push(i - stuckSince); stuckSince = -1; }
        cash += proceeds;
        budget = cash;
        shares = 0;
        cost = 0;
        cycleStart = i + 1;
        peak = Math.max(peak, cash);
        mdd = Math.min(mdd, cash / peak - 1);
        continue;
      }
    }

    const unit = budget / splits;
    let mult = 1;
    if (booster && i > 0) {
      const rsi = indicators.rsi[i - 1];
      if (rsi <= 38 || closes[i - 1] <= indicators.bbLower[i - 1] * 1.02) mult = 1.5;
      else if (rsi >= 64) mult = 0.5;
    }
    const todayBudget = Math.min(cash, unit * mult);

    if (todayBudget >= unit * 0.25) {
      const buy = amount => {
        shares += amount / (b.c * (1 + BT_FEE_RATE));
        cost += amount; // 매수 수수료를 원가에 포함
        cash -= amount;
      };
      if (shares === 0) {
        buy(todayBudget);
      } else {
        const avg = cost / shares;
        const turn = cost / unit;
        const orders = turn < splits / 2
          ? [[todayBudget / 2, avg], [todayBudget / 2, closes[i - 1] * 1.05]]
          : [[todayBudget, avg]];
        orders.forEach(([amount, limit]) => {
          if (b.c <= limit && cash >= amount - 1e-12) buy(amount);
        });
      }
    } else if (shares > 0 && stuckSince < 0) {
      stuckSince = i;
    }

    const equity = cash + shares * b.c;
    peak = Math.max(peak, equity);
    mdd = Math.min(mdd, equity / peak - 1);
  }

  const final = cash + shares * bars[to].c;
  const years = (to - from) / BT_YEAR_BARS;
  const openStuck = stuckSince >= 0 ? to - stuckSince : 0;
  return {
    years,
    final,
    cagr: years > 0 ? final ** (1 / years) - 1 : 0,
    mdd,
    cycles,
    stuckEpisodes: stuckSpans.length + (openStuck ? 1 : 0),
    maxStuckDays: Math.max(0, openStuck, ...stuckSpans),
    openStuckDays: openStuck,
    holdCagr: years > 0 ? (bars[to].c / bars[from].c) ** (1 / years) - 1 : 0,
    holdMdd
  };
}

function btSummarizeSplit(sim) {
  const profits = sim.cycles.map(c => c.profit);
  return {
    cagr: sim.cagr,
    mdd: sim.mdd,
    cyclesPerYear: sim.years > 0 ? sim.cycles.length / sim.years : 0,
    avgCycleProfit: profits.length ? profits.reduce((a, b) => a + b, 0) / profits.length : null,
    medianCycleDays: btMedian(sim.cycles.map(c => c.days)),
    stuckEpisodes: sim.stuckEpisodes,
    maxStuckDays: sim.maxStuckDays,
    openStuckDays: sim.openStuckDays,
    holdCagr: sim.holdCagr,
    holdMdd: sim.holdMdd
  };
}

// 시작 연도별로 부스터 없음/있음/보유를 비교한다 (끝까지 최소 1년이 남는 해만)
function btSplitStudy(bars, opts) {
  const closes = bars.map(b => b.c);
  const indicators = { closes, rsi: btRsiSeries(closes), bbLower: btBollingerLowerSeries(closes) };
  const last = bars.length - 1;
  const minFrom = 21; // 지표 계산에 필요한 최소 일봉

  const startIdx = [];
  let year = '';
  for (let i = minFrom; i <= last - BT_YEAR_BARS; i++) {
    const y = bars[i].d.slice(0, 4);
    if (y !== year) { startIdx.push(i); year = y; }
  }

  const rows = startIdx.map(from => ({
    startDate: bars[from].d,
    plain: btSummarizeSplit(btSplitSim(bars, from, last, { ...opts, booster: false }, indicators)),
    booster: btSummarizeSplit(btSplitSim(bars, from, last, { ...opts, booster: true }, indicators))
  }));

  return { from: bars[0].d, to: bars[last].d, rows, overall: rows[0] || null };
}

if (typeof module !== 'undefined') {
  module.exports = { btMedian, btRsiSeries, btBollingerLowerSeries, btRotationRun, btRotationStudy, btSplitSim, btSplitStudy };
}
