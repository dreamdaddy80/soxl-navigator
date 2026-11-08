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

// 시작점 후보: 상장 1년 뒤부터, 끝까지 minRemaining거래일 이상 남은 날
// crashDrawdown > 0이면 직전 1년 최고 종가 대비 그만큼 이상 떨어진 날만
function btStartIndices(bars, crashDrawdown, minRemaining) {
  const starts = [];
  for (let s = BT_YEAR_BARS; s <= bars.length - 1 - minRemaining; s++) {
    if (crashDrawdown > 0) {
      let high = 0;
      for (let k = s - BT_YEAR_BARS; k < s; k++) if (bars[k].c > high) high = bars[k].c;
      if (bars[s].c > high * (1 - crashDrawdown)) continue;
    }
    starts.push(s);
  }
  return starts;
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

  const starts = btStartIndices(bars, crashDrawdown, 1);

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
// 회전 1번의 단계별 발생 빈도: 매도가 체결됐나 → 재매수가 언제 체결됐나 → 재매수 뒤 더 빠졌나
// 시작일 종가 기준으로 매도가(+up)를 걸고, 체결되면 매도가×(1-drop)에 재매수를 건다.
// -------------------------------------------------------------------------
function btRotationOdds(bars, opts) {
  const { up, drop } = opts;
  const window = BT_YEAR_BARS;
  const starts = btStartIndices(bars, opts.crashDrawdown || 0, window);
  let sold60 = 0;
  let sold252 = 0;
  let soldTotal = 0;
  let rebuy20 = 0;
  let rebuy60 = 0;
  let rebuy252 = 0;
  let rebuyChecked = 0;
  let rebought = 0;
  let deeper10 = 0;
  let deeper20 = 0;
  const runUps = [];
  const rebuyDays = [];

  starts.forEach(s => {
    const sellAt = bars[s].c * (1 + up);
    let sellIdx = -1;
    for (let i = s + 1; i <= s + window; i++) {
      if (bars[i].h >= sellAt) { sellIdx = i; break; }
    }
    if (sellIdx < 0) return;
    if (sellIdx - s <= 60) sold60++;
    sold252++;
    if (sellIdx + window > bars.length - 1) return; // 재매수를 1년 지켜볼 데이터가 없는 경우 제외
    soldTotal++;

    const sellPx = Math.max(bars[sellIdx].o, sellAt);
    const buyAt = sellPx * (1 - drop);
    let buyIdx = -1;
    let high = sellPx;
    for (let i = sellIdx + 1; i <= sellIdx + window; i++) {
      if (bars[i].l <= buyAt) { buyIdx = i; break; }
      high = Math.max(high, bars[i].h);
    }
    rebuyChecked++;
    if (buyIdx < 0) {
      runUps.push(high / sellPx - 1); // 1년 내내 재매수가 안 온 동안 매도가 위로 얼마나 올랐나
      return;
    }
    const days = buyIdx - sellIdx;
    rebuyDays.push(days);
    if (days <= 20) rebuy20++;
    if (days <= 60) rebuy60++;
    rebuy252++;

    if (buyIdx + 60 > bars.length - 1) return;
    rebought++;
    const buyPx = Math.min(bars[buyIdx].o, buyAt);
    let low = buyPx;
    for (let i = buyIdx + 1; i <= buyIdx + 60; i++) low = Math.min(low, bars[i].l);
    if (low <= buyPx * 0.9) deeper10++;
    if (low <= buyPx * 0.8) deeper20++;
  });

  return {
    n: starts.length,
    sellFill60Pct: btPct(sold60, starts.length),
    sellFill252Pct: btPct(sold252, starts.length),
    soldCount: rebuyChecked,
    rebuy20Pct: btPct(rebuy20, rebuyChecked),
    rebuy60Pct: btPct(rebuy60, rebuyChecked),
    rebuy252Pct: btPct(rebuy252, rebuyChecked),
    medianRebuyDays: btMedian(rebuyDays),
    medianRunUpWhenMissed: btMedian(runUps),
    reboughtCount: rebought,
    deeper10Pct: btPct(deeper10, rebought),
    deeper20Pct: btPct(deeper20, rebought)
  };
}

// -------------------------------------------------------------------------
// 대안 규칙 비교: 같은 시작점에서 2년 동안 여러 규칙의 자산 경로(시작 = 1)를 만들어 비교
// bars에는 같은 날짜의 1배 ETF 종가 u가 붙어 있어야 한다 (btAlignWithBase)
// -------------------------------------------------------------------------
const BT_ALT_RULES = [
  { id: 'hold', label: '그냥 보유', desc: '아무것도 하지 않음' },
  { id: 'rotation', label: '앱 회전 규칙', desc: '시뮬레이터 설정 그대로, 재매수가 올 때까지 대기' },
  { id: 'rotation20', label: '회전 + 20일 대기 한도', desc: '20거래일 안에 재매수가 안 오면 그날 종가에 재매수' },
  { id: 'trendCash', label: '200일선 아래면 현금', desc: '전일 종가가 200일 평균 아래면 전량 팔고, 위로 올라오면 다시 매수' },
  { id: 'trendBase', label: '200일선 아래면 1배 ETF', desc: '200일 평균 아래 구간에는 1배 ETF로 갈아탔다가 위로 올라오면 복귀' },
  { id: 'halfBase', label: '절반을 1배 ETF로', desc: '시작일에 절반을 1배 ETF로 바꾸고 그대로 보유' },
  { id: 'allBase', label: '전부 1배 ETF로', desc: '시작일에 전부 1배 ETF로 바꾸고 그대로 보유' }
];

function btAlignWithBase(bars, baseBars) {
  const baseClose = new Map(baseBars.map(b => [b.d, b.c]));
  return bars.filter(b => baseClose.has(b.d)).map(b => ({ ...b, u: baseClose.get(b.d) }));
}

function btSmaSeries(closes, period) {
  const out = new Array(closes.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function btRotationPath(bars, s, end, opts, timeout) {
  const { up, drop, ratio } = opts;
  const startValue = 1000 * bars[s].c;
  let shares = 1000;
  let cash = 0;
  let state = 'SELL';
  let target = bars[s].c * (1 + up);
  let since = s;
  const path = [1];
  for (let i = s + 1; i <= end; i++) {
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
    path.push((shares * b.c + cash) / startValue);
  }
  return path;
}

// 레버리지·1배 ETF·현금 사이를 종가에 옮기는 규칙들 (옮길 때마다 매도·매수 수수료)
function btSwitchPath(bars, sma200, s, end, ruleId) {
  let lev = 1 / bars[s].c; // 시작 가치 1
  let base = 0;
  let cash = 0;
  const moveToBase = (i, frac) => {
    const v = lev * frac * bars[i].c * (1 - BT_FEE_RATE);
    lev *= 1 - frac;
    base += (v * (1 - BT_FEE_RATE)) / bars[i].u;
  };
  if (ruleId === 'halfBase') moveToBase(s, 0.5);
  if (ruleId === 'allBase') moveToBase(s, 1);

  const path = [];
  for (let i = s; i <= end; i++) {
    const b = bars[i];
    if (ruleId === 'trendCash' || ruleId === 'trendBase') {
      const above = bars[i - 1].c > sma200[i - 1];
      if (!above && lev > 0) {
        if (ruleId === 'trendBase') moveToBase(i, 1);
        else { cash += lev * b.c * (1 - BT_FEE_RATE); lev = 0; }
      } else if (above && lev === 0) {
        const v = cash + base * b.u * (1 - BT_FEE_RATE);
        cash = 0;
        base = 0;
        lev = (v * (1 - BT_FEE_RATE)) / b.c;
      }
    }
    path.push(lev * b.c + base * b.u + cash);
  }
  return path;
}

// opts: { up, drop, ratio, crashDrawdown, breakevenMultiple }
function btAlternativesStudy(bars, baseBars, opts) {
  const aligned = btAlignWithBase(bars, baseBars);
  const horizon = BT_YEAR_BARS * 2;
  const beMult = opts.breakevenMultiple > 1 ? opts.breakevenMultiple : 0;
  const starts = btStartIndices(aligned, opts.crashDrawdown || 0, horizon);
  const sma200 = btSmaSeries(aligned.map(b => b.c), 200);

  const stats = BT_ALT_RULES.map(rule => ({ rule, r1: [], r2: [], beat2: 0, reached: 0, days: [], dd: [] }));
  starts.forEach(s => {
    const end = s + horizon;
    let holdPath = null;
    stats.forEach(st => {
      const id = st.rule.id;
      const path = id === 'rotation' ? btRotationPath(aligned, s, end, opts, 0)
        : id === 'rotation20' ? btRotationPath(aligned, s, end, opts, 20)
          : id === 'hold' ? aligned.slice(s, end + 1).map(b => b.c / aligned[s].c)
            : btSwitchPath(aligned, sma200, s, end, id);
      if (id === 'hold') holdPath = path;
      st.r1.push(path[BT_YEAR_BARS] / holdPath[BT_YEAR_BARS]);
      st.r2.push(path[horizon] / holdPath[horizon]);
      if (path[horizon] > holdPath[horizon] * 1.0001) st.beat2++;
      if (beMult > 0) {
        const k = path.findIndex(v => v >= beMult);
        if (k >= 0) { st.reached++; st.days.push(k); }
      }
      let peak = 1;
      let mdd = 0;
      path.forEach(v => { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); });
      st.dd.push(mdd);
    });
  });

  return {
    n: starts.length,
    from: aligned.length ? aligned[0].d : null,
    to: aligned.length ? aligned[aligned.length - 1].d : null,
    breakevenMultiple: beMult,
    rules: stats.map(st => ({
      id: st.rule.id,
      label: st.rule.label,
      desc: st.rule.desc,
      ratio1y: btMedian(st.r1),
      ratio2y: btMedian(st.r2),
      beat2yPct: btPct(st.beat2, starts.length),
      breakevenPct: beMult > 0 ? btPct(st.reached, starts.length) : null,
      medianBreakevenDays: btMedian(st.days),
      medianDrawdown: btMedian(st.dd),
      worstDrawdown: st.dd.length ? Math.min(...st.dd) : null
    }))
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
  module.exports = { btMedian, btRsiSeries, btBollingerLowerSeries, btRotationRun, btRotationStudy, btRotationOdds, btAlternativesStudy, btSplitSim, btSplitStudy };
}
