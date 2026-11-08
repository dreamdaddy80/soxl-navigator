// 오늘의 작전: 장 시간대를 판단하고, 거래일마다 주문 하나를 정해 체결 전까지 고정한다 (화면과 무관)

const NY_PRE_OPEN = 240; // 04:00
const NY_REGULAR_OPEN = 570; // 09:30
const NY_REGULAR_CLOSE = 960; // 16:00
const NY_AFTER_CLOSE = 1200; // 20:00
const PLAN_MIN_CASH_RATIO = 0.02; // 자산의 2% 미만 잔돈은 재매수 대상으로 보지 않는다

let marketOpenHint = null; // Twelve Data가 알려 주는 정규장 개장 여부 (휴장일 판별용)

function newYorkClock(ms) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(new Date(ms)).map(p => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function addDaysISO(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function isWeekdayISO(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function nextWeekdayISO(date) {
  let next = addDaysISO(date, 1);
  while (!isWeekdayISO(next)) next = addDaysISO(next, 1);
  return next;
}

// 지금이 어느 장인지와, 주문이 적용될 거래일의 장 시작·종료 시각
function getMarketSession(now) {
  const minuteMs = 60000;
  const nowMinute = Math.floor(now / minuteMs) * minuteMs;
  const ny = newYorkClock(nowMinute);
  const weekday = isWeekdayISO(ny.date);

  let key = 'CLOSED';
  if (weekday && ny.minutes >= NY_PRE_OPEN && ny.minutes < NY_REGULAR_OPEN) key = 'PRE';
  else if (weekday && ny.minutes >= NY_REGULAR_OPEN && ny.minutes < NY_REGULAR_CLOSE) key = 'REGULAR';
  else if (weekday && ny.minutes >= NY_REGULAR_CLOSE && ny.minutes < NY_AFTER_CLOSE) key = 'AFTER';

  const sameDay = key !== 'CLOSED' || (weekday && ny.minutes < NY_PRE_OPEN);
  const tradeDay = sameDay ? ny.date : nextWeekdayISO(ny.date);

  // 주말 사이에 서머타임이 바뀌어도 04:00에 맞도록 뉴욕 시각으로 한 번 보정한다
  const daysAhead = Math.round((Date.parse(tradeDay) - Date.parse(ny.date)) / 86400000);
  let preOpenMs = nowMinute + (daysAhead * 1440 + NY_PRE_OPEN - ny.minutes) * minuteMs;
  preOpenMs += (NY_PRE_OPEN - newYorkClock(preOpenMs).minutes) * minuteMs;

  const boundaries = {
    PRE: preOpenMs,
    REGULAR: preOpenMs + (NY_REGULAR_OPEN - NY_PRE_OPEN) * minuteMs,
    AFTER: preOpenMs + (NY_REGULAR_CLOSE - NY_PRE_OPEN) * minuteMs,
    END: preOpenMs + (NY_AFTER_CLOSE - NY_PRE_OPEN) * minuteMs
  };
  const next = {
    PRE: { label: '본장 시작', at: boundaries.REGULAR },
    REGULAR: { label: '본장 마감', at: boundaries.AFTER },
    AFTER: { label: '애프터장 종료', at: boundaries.END },
    CLOSED: { label: '프리장 시작', at: boundaries.PRE }
  }[key];
  const label = { PRE: '프리장', REGULAR: '본장', AFTER: '애프터장', CLOSED: '장 마감' }[key];

  return { key, label, tradeDay, boundaries, next };
}

// 평일 정규장 시간인데 시세 서버가 닫혀 있다고 하면 휴장일이다
function currentMarketSession() {
  const session = getMarketSession(Date.now());
  if (session.key === 'REGULAR' && marketOpenHint === false) {
    return { ...session, key: 'CLOSED', label: '휴장', holiday: true };
  }
  return session;
}

function rescueBreakeven(t) {
  const principal = getTotalPrincipal(t) || (t.shares * t.avgPrice);
  return t.shares > 0 ? Math.max(0, principal - (t.reservedCash || 0)) / t.shares : 0;
}

function planLedgerKey(t) {
  return `${t.shares}|${t.reservedCash || 0}|${appState.targetMode || 'MID'}`;
}

function openRotation(t) {
  const rotations = analyzeRotations(t, t.currentPrice, todayISO()).rotations;
  return [...rotations].reverse().find(r => r.status === 'waiting' || r.status === 'partial') || null;
}

// 재매수에 쓸 만큼 현금이 있으면 재매수 단계, 아니면 다음 반등 매도 단계
function hasRebuyCash(t) {
  const cash = t.reservedCash || 0;
  const equity = t.shares * t.currentPrice + cash;
  return cash >= Math.max(t.currentPrice * (1 + TRADING_FEE_RATE), equity * PLAN_MIN_CASH_RATIO);
}

function buildDailyPlan(t, session) {
  const cur = t.currentPrice;
  // 프리장·본장에는 전일 종가 기준으로 정해야 장중에 목표가가 시세를 따라 도망가지 않는다
  const basis = (session.key === 'PRE' || session.key === 'REGULAR') && t.prevClose > 0 ? t.prevClose : cur;
  // 주문을 정하기 전에 이미 찍힌 고가·저가는 체결 신호로 보면 안 되므로 기억해 둔다
  const barIsToday = session.key === 'REGULAR' || session.key === 'AFTER';
  const common = {
    tradeDay: session.tradeDay,
    ledgerKey: planLedgerKey(t),
    custom: 0,
    basis: Number(basis.toFixed(2)),
    highAtCreate: barIsToday ? t.dayHigh || 0 : 0,
    lowAtCreate: barIsToday ? t.dayLow || 0 : 0
  };
  const breakeven = rescueBreakeven(t);

  if (t.shares > 0 && breakeven > 0 && cur >= breakeven) {
    return { ...common, stage: 'DONE', price: Number(breakeven.toFixed(2)), shares: 0, reason: '' };
  }

  if (hasRebuyCash(t)) {
    const drop = (t.dropRatio || 10) / 100;
    const open = openRotation(t);
    const reference = open ? open.netSellPrice / (1 - TRADING_FEE_RATE) : basis;
    const price = Number((reference * (1 - drop)).toFixed(2));
    const shares = Math.floor((t.reservedCash || 0) / (price * (1 + TRADING_FEE_RATE)));
    if (shares > 0) {
      const reason = open
        ? `직전 매도가 ${formatUSD(reference)} 대비 -${t.dropRatio || 10}% 눌림목`
        : `기준가 ${formatUSD(reference)} 대비 -${t.dropRatio || 10}% 눌림목`;
      return { ...common, stage: 'REBUY', price, shares, reason };
    }
  }

  if (t.shares <= 0) return { ...common, stage: 'EMPTY', price: 0, shares: 0, reason: '' };

  const target = computeSellTargets(t, basis);
  return {
    ...common,
    stage: 'SELL',
    price: Number(target.sell1.toFixed(2)),
    shares: Math.max(1, Math.round(t.shares * ((t.sellRatio || 20) / 100))),
    reason: target.reason.replace('현재가', '기준가')
  };
}

// 거래일과 잔고가 그대로면 같은 주문을 유지한다. 새 주문은 최신 시세가 있을 때만 만든다
function ensureDailyPlan(t) {
  const session = currentMarketSession();
  const plan = t.dailyPlan;
  const reachedBreakeven = t.shares > 0 && rescueBreakeven(t) > 0 && t.currentPrice >= rescueBreakeven(t);
  const planIsCurrent = plan && plan.tradeDay === session.tradeDay && plan.ledgerKey === planLedgerKey(t);
  if (planIsCurrent && (plan.stage === 'DONE') === reachedBreakeven) return plan;
  if (!isQuoteFresh(t)) return planIsCurrent ? plan : null;

  t.dailyPlan = buildDailyPlan(t, session);
  saveState();
  return t.dailyPlan;
}

// 이 주문이 체결되면 잔고가 어떻게 되고 다음 제안이 무엇인지
function previewPlanFill(t, plan) {
  const cash = t.reservedCash || 0;
  const principal = getTotalPrincipal(t) || (t.shares * t.avgPrice);
  const breakevenOf = (shares, money) => (shares > 0 ? Math.max(0, principal - money) / shares : 0);

  if (plan.stage === 'SELL') {
    const proceeds = plan.shares * plan.price * (1 - TRADING_FEE_RATE);
    const shares = t.shares - plan.shares;
    const money = cash + proceeds;
    const nextPrice = Number((plan.price * (1 - (t.dropRatio || 10) / 100)).toFixed(2));
    return {
      shares,
      cash: money,
      breakeven: breakevenOf(shares, money),
      nextStage: 'REBUY',
      nextPrice,
      nextShares: Math.floor(money / (nextPrice * (1 + TRADING_FEE_RATE)))
    };
  }

  const cost = plan.shares * plan.price * (1 + TRADING_FEE_RATE);
  const shares = t.shares + plan.shares;
  const money = Math.max(0, cash - cost);
  return {
    shares,
    cash: money,
    breakeven: breakevenOf(shares, money),
    nextStage: 'SELL',
    nextPrice: Number(computeSellTargets(t, plan.price).sell1.toFixed(2)),
    nextShares: Math.max(1, Math.round(shares * ((t.sellRatio || 20) / 100)))
  };
}
