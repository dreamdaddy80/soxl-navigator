// 상수, 기본값, 저장 데이터 불러오기와 저장

// 기본 상태 데이터 (원금 탈출 모드 + 본전 탈출 후 수익 창출 모드 통합)
const TRADING_FEE_RATE = 0.001; // 편도 0.1% (왕복 0.2% 실전 증권사 수수료·SEC 제비용 반영)

const QUOTE_STALE_MS = 10 * 60 * 1000; // 마지막 시세 확인 후 10분이 지나면 추천 행동을 보류

const QUOTE_TIMEOUT_MS = 15000; // 무료 프록시 응답 대기 한도

const GROWTH_AVG_TOLERANCE = 0.1; // 예전 방식의 평단 누적 반올림 오차로 보는 범위 ($)

const OVERSEAS_GAINS_TAX_RATE = 0.22; // 해외주식 양도소득세 (지방세 포함)

const OVERSEAS_GAINS_DEDUCTION_KRW = 2500000; // 연간 기본공제

const DEFAULT_STATE = {
  currentTicker: 'SOXL',
  currentView: 'overview', // 'overview' | 'chart' | 'rescue' | 'growth' | 'journal'
  mainAppMode: 'RESCUE',
  chartInterval: 'D',
  targetMode: 'MID', // 'SHORT' (+4.5% / 5일선), 'MID' (+9% / 20일선), 'HIGH' (+15% / 2주고점)
  exchangeRate: 1400,
  tickers: {
    SOXL: {
      baseShares: 100,
      baseAvgPrice: 60.00,
      originalPrincipal: 6000.00,
      baseCash: 0,
      shares: 100,
      avgPrice: 60.00,
      currentPrice: 45.97,
      marketSessionLabel: '실시간 기준 주가',
      prevClose: 45.10,
      dayLow: 44.80,
      dayHigh: 46.50,
      reservedCash: 0,
      recentLow: 41.20,
      recentHigh: 52.80,
      rsi: 46.5,
      sma5: 48.04,
      sma20: 50.10,
      bbUpper: 55.40,
      bbLower: 42.10,
      autoSellTarget1: 50.10,
      autoSellTarget2: 52.80,
      autoBuyTarget1: 45.09,
      autoBuyTarget2: 42.10,
      sellReasonText: '현재가($45.97) 대비 +9.0% 반등 및 20일 이동평균선 저항 구간',
      sellRatio: 20,
      simSellPrice: 50.10,
      dropRatio: 10,
      simBuyPrice: 45.09,
      logs: [],
      alerts: [],
      dailyPlan: null,
      // 본전 탈출 이후 꾸준한 수익 창출 모드(GROWTH) 데이터
      growth: {
        totalBudget: 10000,
        splits: 40,
        targetProfitPct: 10,
        heldShares: 0,
        avgPrice: 45.97,
        cycleCount: 1,
        cumulativeProfit: 0,
        history: []
      }
    },
    TQQQ: {
      baseShares: 100,
      baseAvgPrice: 80.00,
      originalPrincipal: 8000.00,
      baseCash: 0,
      shares: 100,
      avgPrice: 80.00,
      currentPrice: 65.00,
      marketSessionLabel: '실시간 기준 주가',
      prevClose: 64.10,
      dayLow: 63.80,
      dayHigh: 65.90,
      reservedCash: 0,
      recentLow: 58.00,
      recentHigh: 69.00,
      rsi: 54.0,
      sma5: 66.20,
      sma20: 68.50,
      bbUpper: 72.80,
      bbLower: 58.20,
      autoSellTarget1: 70.85,
      autoSellTarget2: 74.00,
      autoBuyTarget1: 63.77,
      autoBuyTarget2: 58.20,
      sellReasonText: '현재가($65.00) 대비 +9.0% 반등 및 20일 이동평균선 저항 구간',
      sellRatio: 20,
      simSellPrice: 70.85,
      dropRatio: 10,
      simBuyPrice: 63.77,
      logs: [],
      alerts: [],
      dailyPlan: null,
      growth: {
        totalBudget: 30000,
        splits: 40,
        targetProfitPct: 10,
        heldShares: 0,
        avgPrice: 65.00,
        cycleCount: 1,
        cumulativeProfit: 0,
        history: []
      }
    }
  }
};

let appState = loadState();

// 기본값과 같은 타입의 값만 받아들인다 (백업 코드로 들어온 문자열이 화면 HTML에 섞이지 않도록)
// 기본값에 없는 키(addedPrincipal, lastQuoteAt 등)는 유한한 숫자일 때만 허용
function pickTyped(defaults, src) {
  const out = { ...defaults };
  Object.keys(src || {}).forEach(k => {
    const v = src[k];
    if (typeof defaults[k] === 'number' || !(k in defaults)) {
      const n = typeof v === 'number' || typeof v === 'string' ? Number(v) : NaN;
      if (Number.isFinite(n)) out[k] = n;
    } else if (typeof defaults[k] === 'string' && typeof v === 'string') {
      out[k] = v;
    }
  });
  return out;
}

function sanitizeRecords(list, allowedTypes) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item === 'object')
    .map((item, i) => {
      const rec = {
        id: Number(item.id) || Date.now() - i,
        date: typeof item.date === 'string' ? item.date : '',
        type: allowedTypes.includes(item.type) ? item.type : allowedTypes[0],
        price: Number(item.price) || 0,
        shares: Number(item.shares) || 0,
        amount: Number(item.amount) || 0,
        memo: typeof item.memo === 'string' ? item.memo : ''
      };
      if (/^\d{4}-\d{2}-\d{2}$/.test(item.tradeDate || '')) rec.tradeDate = item.tradeDate;
      return rec;
    });
}

function sanitizeAlerts(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter(a => a && Number(a.price) > 0 && (a.direction === 'above' || a.direction === 'below'))
    .map((a, i) => ({
      id: Number(a.id) || Date.now() - i,
      price: Number(a.price),
      direction: a.direction,
      label: typeof a.label === 'string' ? a.label.slice(0, 40) : '',
      active: a.active === true,
      createdAt: Number(a.createdAt) || 0,
      triggeredAt: Number(a.triggeredAt) || 0,
      triggeredPrice: Number(a.triggeredPrice) || 0
    }));
}

function sanitizeDailyPlan(plan) {
  if (!plan || typeof plan !== 'object') return null;
  if (!['SELL', 'REBUY', 'DONE', 'EMPTY'].includes(plan.stage)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(plan.tradeDay || '') || typeof plan.ledgerKey !== 'string') return null;
  return {
    stage: plan.stage,
    tradeDay: plan.tradeDay,
    ledgerKey: plan.ledgerKey,
    price: Number(plan.price) || 0,
    shares: Number(plan.shares) || 0,
    basis: Number(plan.basis) || 0,
    highAtCreate: Number(plan.highAtCreate) || 0,
    lowAtCreate: Number(plan.lowAtCreate) || 0,
    custom: plan.custom ? 1 : 0,
    reason: typeof plan.reason === 'string' ? plan.reason.slice(0, 120) : ''
  };
}

function mergeWithDefaults(parsed) {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_STATE));
  const { tickers: defaultTickers, ...defaultTop } = defaults;
  const merged = { ...pickTyped(defaultTop, parsed), tickers: {} };

  Object.keys(defaultTickers).forEach(sym => {
    const d = defaultTickers[sym];
    const src = parsed?.tickers?.[sym] || {};
    const { logs: _l, alerts: _a, dailyPlan: _p, growth: dGrowth, ...dScalars } = d;
    const { history: _h, ...dGrowthScalars } = dGrowth;
    merged.tickers[sym] = {
      ...pickTyped(dScalars, src),
      logs: sanitizeRecords(src.logs, ['SELL', 'BUY', 'DEPOSIT', 'WITHDRAW']),
      alerts: sanitizeAlerts(src.alerts),
      dailyPlan: sanitizeDailyPlan(src.dailyPlan),
      growth: {
        ...pickTyped(dGrowthScalars, src.growth),
        history: sanitizeRecords(src.growth?.history, ['BUY', 'GRADUATE', 'ADJUST'])
      }
    };
    if (Object.keys(src).length > 0) repairPrincipalAnchor(merged.tickers[sym], src);
    // 보유 수량·현금·탈출가는 항상 기준점과 기록에서 다시 계산한다
    recalculateRescueBalanceFromLogs(merged.tickers[sym]);
    if (Object.keys(src).length > 0) repairGrowthLedger(merged.tickers[sym], src);
    recalculateGrowthFromHistory(merged.tickers[sym]);
  });

  if (!merged.tickers[merged.currentTicker]) merged.currentTicker = 'SOXL';
  return merged;
}

function loadState() {
  try {
    const saved = localStorage.getItem('soxl_rescue_nav_v3') || localStorage.getItem('soxl_rescue_nav_v2');
    if (saved) {
      return mergeWithDefaults(JSON.parse(saved));
    }
  } catch (e) {
    console.error('Failed to load state:', e);
  }
  return JSON.parse(JSON.stringify(DEFAULT_STATE));
}

function saveState() {
  try {
    localStorage.setItem('soxl_rescue_nav_v3', JSON.stringify(appState));
  } catch (e) {
    console.error('Failed to save state:', e);
  }
}
