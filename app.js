// 기본 상태 데이터 (원금 탈출 모드 + 본전 탈출 후 수익 창출 모드 통합)
const TRADING_FEE_RATE = 0.001; // 편도 0.1% (왕복 0.2% 실전 증권사 수수료·SEC 제비용 반영)
const QUOTE_STALE_MS = 10 * 60 * 1000; // 마지막 시세 확인 후 10분이 지나면 추천 행동을 보류
const QUOTE_TIMEOUT_MS = 15000; // 무료 프록시 응답 대기 한도

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
let autoRefreshTimer = null;

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

function mergeWithDefaults(parsed) {
  const defaults = JSON.parse(JSON.stringify(DEFAULT_STATE));
  const { tickers: defaultTickers, ...defaultTop } = defaults;
  const merged = { ...pickTyped(defaultTop, parsed), tickers: {} };

  Object.keys(defaultTickers).forEach(sym => {
    const d = defaultTickers[sym];
    const src = parsed?.tickers?.[sym] || {};
    const { logs: _l, growth: dGrowth, ...dScalars } = d;
    const { history: _h, ...dGrowthScalars } = dGrowth;
    merged.tickers[sym] = {
      ...pickTyped(dScalars, src),
      logs: sanitizeRecords(src.logs, ['SELL', 'BUY', 'DEPOSIT', 'WITHDRAW']),
      growth: {
        ...pickTyped(dGrowthScalars, src.growth),
        history: sanitizeRecords(src.growth?.history, ['BUY', 'GRADUATE'])
      }
    };
    if (Object.keys(src).length > 0) repairPrincipalAnchor(merged.tickers[sym], src);
    // 보유 수량·현금·탈출가는 항상 기준점과 기록에서 다시 계산한다
    recalculateRescueBalanceFromLogs(merged.tickers[sym]);
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

function formatUSD(val) {
  const num = Number(val) || 0;
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatKRW(usdVal) {
  const krw = Math.round((Number(usdVal) || 0) * (appState.exchangeRate || 1400));
  if (krw >= 100000000) {
    const eok = Math.floor(krw / 100000000);
    const man = Math.round((krw % 100000000) / 10000);
    return `약 ${eok}억 ${man.toLocaleString()}만 원`;
  }
  return `약 ${Math.round(krw / 10000).toLocaleString()}만 원`;
}

function formatSignedUSD(val) {
  const num = Number(val) || 0;
  return (num < 0 ? '-' : '+') + formatUSD(Math.abs(num));
}

function formatShareDelta(n) {
  return `${n >= 0 ? '+' : ''}${n.toLocaleString()}주`;
}

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 로컬 기준 YYYY-MM-DD
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 체결일이 없는 예전 기록은 입력 시각(id = Date.now())을 체결일로 간주
function getTradeDate(item) {
  if (item.tradeDate) return item.tradeDate;
  const d = new Date(Number(item.id) || 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function displayTradeDate(item) {
  return item.tradeDate || item.date || getTradeDate(item);
}

// 기록은 최신순으로 보관한다 (체결일 내림차순, 같은 날은 입력 순서 내림차순)
function sortByTradeDate(list) {
  if (!list) return;
  list.sort((a, b) => {
    const da = getTradeDate(a);
    const db = getTradeDate(b);
    if (da !== db) return da < db ? 1 : -1;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}

// 5개 전용 메뉴 뷰 전환 (overview / chart / rescue / growth / journal)
let tvChartRendered = false;

function switchView(viewId) {
  const validViews = ['overview', 'chart', 'rescue', 'growth', 'journal'];
  if (!validViews.includes(viewId)) viewId = 'overview';
  appState.currentView = viewId;

  validViews.forEach(v => {
    const navEl = document.getElementById('nav-' + v);
    const pageEl = document.getElementById('view-' + v);
    if (navEl) navEl.classList.toggle('active', v === viewId);
    if (pageEl) pageEl.classList.toggle('active', v === viewId);
  });

  if (viewId === 'chart') {
    setTimeout(() => {
      renderTradingViewChart();
      tvChartRendered = true;
    }, 80);
  }
  if (viewId === 'growth') {
    recalcGrowthMode(false);
  }
  saveState();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function switchMainAppMode(mode) {
  switchView(mode === 'GROWTH' ? 'growth' : 'rescue');
}

// TradingView 실제 차트 렌더링 (모바일 높이 0px 버그 방지를 위해 명시적 height 적용)
function renderTradingViewChart() {
  const ticker = appState.currentTicker;
  const interval = appState.chartInterval || 'D';
  // SOXL은 NYSE Arca(TradingView 표기 AMEX), TQQQ는 나스닥 상장
  const symbol = { SOXL: 'AMEX:SOXL', TQQQ: 'NASDAQ:TQQQ' }[ticker] || `AMEX:${ticker}`;

  const titleEl = document.getElementById('chart-title');
  if (titleEl) {
    titleEl.textContent = `📈 ${ticker} 실시간 차트 (볼린저밴드 + RSI 자동 표시)`;
  }

  const container = document.getElementById('tv_chart_container');
  if (!container) return;

  if (typeof TradingView === 'undefined') {
    container.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#64748b;font-weight:600;">📈 실시간 차트를 불러오는 중입니다... 잠시만 기다려 주세요.</div>`;
    // 모바일 느린 네트워크에서 스크립트 로드 완료 후 자동 재시도
    setTimeout(renderTradingViewChart, 800);
    return;
  }

  container.innerHTML = '';
  const isMobile = window.innerWidth <= 768;
  const chartHeight = isMobile ? 390 : 520;

  new TradingView.widget({
    width: '100%',
    height: chartHeight,
    symbol: symbol,
    interval: interval,
    timezone: 'Asia/Seoul',
    theme: 'light',
    style: '1',
    locale: 'kr',
    toolbar_bg: '#ffffff',
    enable_publishing: false,
    hide_top_toolbar: false,
    hide_side_toolbar: isMobile,
    hide_legend: false,
    save_image: false,
    container_id: 'tv_chart_container',
    studies: [
      'BB@tv-basicstudies',
      'RSI@tv-basicstudies'
    ]
  });
}

function changeChartInterval(interval) {
  appState.chartInterval = interval;
  ['D', '60', '15'].forEach(id => {
    const el = document.getElementById('int-' + id);
    if (el) el.classList.toggle('active', id === interval);
  });
  saveState();
  renderTradingViewChart();
}

function setTargetMode(mode) {
  appState.targetMode = mode;
  ['SHORT', 'MID', 'HIGH'].forEach(m => {
    const cls = '.mode-' + m.toLowerCase() + '-btn';
    document.querySelectorAll(cls).forEach(el => {
      el.classList.toggle('active', m === mode);
    });
  });
  const t = appState.tickers[appState.currentTicker];
  computeRealisticTargets(t, true);
  saveState();
  recalcAll(false);
}

function switchTicker(ticker) {
  appState.currentTicker = ticker;
  document.getElementById('btn-soxl').classList.toggle('active', ticker === 'SOXL');
  document.getElementById('btn-tqqq').classList.toggle('active', ticker === 'TQQQ');
  populateInputsFromState();
  tvChartRendered = false;
  if (appState.currentView === 'chart') {
    renderTradingViewChart();
    tvChartRendered = true;
  }
  recalcAll(false);
  recalcGrowthMode(false);
  fetchMarketDataAndAnalyze();
}

function populateInputsFromState() {
  const t = appState.tickers[appState.currentTicker];
  ensurePrincipalAnchor(t);

  document.getElementById('initial-shares').value = t.shares;
  document.getElementById('avg-price').value = Number(t.avgPrice.toFixed(2));
  document.getElementById('current-price').value = t.currentPrice;
  document.getElementById('reserved-cash').value = Number((t.reservedCash || 0).toFixed(2));

  document.getElementById('sell-ratio-slider').value = t.sellRatio;
  document.getElementById('sim-sell-price').value = t.simSellPrice;
  document.getElementById('drop-ratio-slider').value = t.dropRatio;
  document.getElementById('sim-buy-price').value = t.simBuyPrice;

  const mode = appState.targetMode || 'MID';
  ['SHORT', 'MID', 'HIGH'].forEach(m => {
    const cls = '.mode-' + m.toLowerCase() + '-btn';
    document.querySelectorAll(cls).forEach(el => {
      el.classList.toggle('active', m === mode);
    });
  });

  // Growth 모드 입력창 동기화
  const g = t.growth;
  document.getElementById('g-total-budget').value = g.totalBudget;
  document.getElementById('g-splits').value = g.splits;
  document.getElementById('g-target-profit').value = g.targetProfitPct;
  document.getElementById('g-held-shares').value = g.heldShares;
  document.getElementById('g-avg-price').value = g.avgPrice || t.currentPrice;

  updateAnchorBanner(t);
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

// 자동 조회 성공 또는 사용자가 현재가를 직접 입력한 지 10분 이내인지
function isQuoteFresh(t) {
  return Boolean(t.lastQuoteAt) && Date.now() - t.lastQuoteAt < QUOTE_STALE_MS;
}

// 회복 목표 원금 = 최초 원금 + 보유 현금을 초과한 매수에 새로 투입한 돈
function getTotalPrincipal(t) {
  return (t.originalPrincipal || 0) + (t.addedPrincipal || 0);
}

function updateAnchorBanner(t) {
  ensurePrincipalAnchor(t);
  const bannerEl = document.getElementById('account-anchor-banner');
  if (!bannerEl) return;

  const baseText = `${t.baseShares}주 × ${formatUSD(t.baseAvgPrice)}` +
    (t.baseCash > 0 ? ` + 시작 현금 ${formatUSD(t.baseCash)}` : '');
  const added = t.addedPrincipal || 0;
  const addedText = added !== 0
    ? ` ${added > 0 ? '+ 추가 투입' : '- 인출'} <strong>${formatUSD(Math.abs(added))}</strong>`
    : '';

  if (t.logs && t.logs.length > 0) {
    bannerEl.innerHTML = `🔒 최초 원금 <strong>${formatUSD(t.originalPrincipal)}</strong>${addedText} <small>(${baseText} · 기록 ${t.logs.length}건 반영: ${t.baseShares}주 ➔ ${t.shares}주)</small>`;
  } else {
    bannerEl.innerHTML = `🔒 회복 목표 원금: <strong id="anchor-principal-text">${formatUSD(t.originalPrincipal)}</strong> (${baseText})`;
  }
}

function resetInitialAnchor() {
  const t = appState.tickers[appState.currentTicker];
  ensurePrincipalAnchor(t);
  const sInput = prompt(
    `[${appState.currentTicker}] 구출 작전을 시작하기 전 '최초 보유 주식 수(주)'를 입력해 주세요:`,
    String(t.baseShares)
  );
  if (sInput === null) return;
  const pInput = prompt(
    `[${appState.currentTicker}] 구출 작전을 시작하기 전 '최초 매입 평단가($)'를 입력해 주세요:`,
    String(t.baseAvgPrice)
  );
  if (pInput === null) return;
  const cInput = prompt(
    `[${appState.currentTicker}] 구출 작전을 시작할 때 이미 갖고 있던 '구출 현금($)'이 있다면 입력해 주세요 (없으면 0):`,
    String(t.baseCash || 0)
  );
  if (cInput === null) return;

  const bs = parseFloat(sInput);
  const bp = parseFloat(pInput);
  const bc = parseFloat(cInput) || 0;
  if (!bs || !bp || bs <= 0 || bp <= 0 || bc < 0) {
    alert('올바른 주식 수, 평단가, 현금을 입력해 주세요.');
    return;
  }

  t.baseShares = bs;
  t.baseAvgPrice = bp;
  t.baseCash = Number(bc.toFixed(2));
  t.originalPrincipal = Number((bs * bp).toFixed(2));
  recalculateRescueBalanceFromLogs(t);

  saveState();
  populateInputsFromState();
  recalcAll(false);
}

// PC <-> 모바일 3초 백업 코드 복사 / 복원 및 JSON 파일 내보내기 / 불러오기
function copyBackupCode() {
  try {
    const code = btoa(encodeURIComponent(JSON.stringify(appState)));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        alert('✅ 백업 코드가 클립보드에 복사되었습니다!\n카카오톡 [나에게 보내기]나 메모장에 붙여넣은 뒤, 스마트폰에서 [📥 코드 복원]을 눌러 붙여넣으시면 모든 기록이 즉시 동기화됩니다.');
      }).catch(() => {
        prompt('아래 백업 코드를 복사(Ctrl+C)해서 스마트폰에 붙여넣으세요:', code);
      });
    } else {
      prompt('아래 백업 코드를 복사(Ctrl+C)해서 스마트폰에 붙여넣으세요:', code);
    }
  } catch (e) {
    alert('백업 코드 생성 중 오류가 발생했습니다.');
  }
}

function pasteBackupCode() {
  const code = prompt('복사해 둔 백업 코드를 아래에 붙여넣기 해주세요:');
  if (!code || !code.trim()) return;
  try {
    const decoded = JSON.parse(decodeURIComponent(atob(code.trim())));
    if (!decoded || typeof decoded.tickers !== 'object' || !decoded.tickers.SOXL) {
      throw new Error('Invalid backup data');
    }
    appState = mergeWithDefaults(decoded);
    saveState();
    populateInputsFromState();
    recalcAll(false);
    recalcGrowthMode(false);
    alert('🎉 데이터 복원 및 동기화가 완료되었습니다!');
  } catch (e) {
    alert('❌ 올바르지 않은 백업 코드입니다. 복사한 전체 문자열을 다시 확인해 주세요.');
  }
}

function exportBackupFile() {
  try {
    const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `soxl-tqqq-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('파일 저장 중 오류가 발생했습니다.');
  }
}

function importBackupFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || typeof parsed.tickers !== 'object' || !parsed.tickers.SOXL) {
        throw new Error('Invalid JSON');
      }
      appState = mergeWithDefaults(parsed);
      saveState();
      populateInputsFromState();
      recalcAll(false);
      recalcGrowthMode(false);
      alert('🎉 백업 파일에서 모든 매매 기록과 계좌 설정을 성공적으로 불러왔습니다!');
    } catch (err) {
      alert('❌ 올바른 백업 JSON 파일이 아닙니다.');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

// 보유 수량·평단·현금은 원금 기준점과 매매 기록에서만 계산하므로 여기서는 읽지 않는다
function syncInputsToState() {
  const t = appState.tickers[appState.currentTicker];
  ensurePrincipalAnchor(t);

  const typedPrice = parseFloat(document.getElementById('current-price').value);
  if (typedPrice > 0 && typedPrice !== t.currentPrice) {
    // 증권사 앱에서 확인한 가격을 직접 입력한 경우도 최신 시세로 인정
    t.currentPrice = typedPrice;
    t.lastQuoteAt = Date.now();
  }

  t.sellRatio = parseFloat(document.getElementById('sell-ratio-slider').value) || 20;
  t.simSellPrice = parseFloat(document.getElementById('sim-sell-price').value) || t.currentPrice;
  t.dropRatio = parseFloat(document.getElementById('drop-ratio-slider').value) || 10;
  t.simBuyPrice = parseFloat(document.getElementById('sim-buy-price').value) || 0;

  updateAnchorBanner(t);
  saveState();
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
function recalculateGrowthFromHistory(t) {
  const g = t.growth;
  if (!g.baseTotalBudget) {
    g.baseTotalBudget = Number(((g.totalBudget || 0) - (g.cumulativeProfit || 0)).toFixed(2));
  }

  let heldShares = 0;
  let totalCost = 0;
  let cumulativeProfit = 0;
  let cycleCount = 1;

  sortByTradeDate(g.history);
  const chronological = [...(g.history || [])].reverse();
  chronological.forEach(item => {
    const p = Number(item.price) || 0;
    const s = Number(item.shares) || 0;
    if (item.type === 'BUY') {
      const cost = p * s;
      item.amount = Number(cost.toFixed(2));
      totalCost += cost;
      heldShares = Number((heldShares + s).toFixed(4));
    } else if (item.type === 'GRADUATE') {
      cumulativeProfit = Number((cumulativeProfit + (Number(item.amount) || 0)).toFixed(2));
      cycleCount += 1;
      heldShares = 0;
      totalCost = 0;
    }
  });

  g.heldShares = heldShares;
  g.avgPrice = heldShares > 0 ? Number((totalCost / heldShares).toFixed(2)) : t.currentPrice;
  g.cumulativeProfit = cumulativeProfit;
  g.cycleCount = cycleCount;
  g.totalBudget = Number((g.baseTotalBudget + cumulativeProfit).toFixed(2));
}

// =======================================================
// 기술적 지표 계산 함수 (RSI 14, 볼린저밴드 20, 이동평균선)
// =======================================================
function computeRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeSMA(values, period) {
  if (!values || values.length < period) return values[values.length - 1] || 0;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

function computeBollingerBands(closes, period = 20, mult = 2) {
  const sma = computeSMA(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((acc, val) => acc + Math.pow(val - sma, 2), 0) / slice.length;
  const stdDev = Math.sqrt(variance);
  return {
    middle: sma,
    upper: sma + mult * stdDev,
    lower: sma - mult * stdDev
  };
}

function computeRealisticTargets(t, forceSyncToSim = false) {
  ensurePrincipalAnchor(t);
  const cur = t.currentPrice;
  const totalPrincipal = getTotalPrincipal(t) || (t.shares * t.avgPrice);
  const breakevenPrice = t.shares > 0 ? Math.max(0, totalPrincipal - (t.reservedCash || 0)) / t.shares : t.avgPrice;
  const mode = appState.targetMode || 'MID';

  let shortTarget = cur * 1.045;
  let shortReason = `현재가(${formatUSD(cur)}) 대비 +4.5% 단기 반등 목표가`;
  if (t.sma5 && t.sma5 > cur * 1.02 && t.sma5 < cur * 1.08) {
    shortTarget = t.sma5;
    shortReason = `최근 5일 이동평균선(${formatUSD(t.sma5)}) 1차 단기 저항선`;
  }

  let midTarget = cur * 1.09;
  let midReason = `현재가(${formatUSD(cur)}) 대비 +9.0% 표준 스윙 반등 목표가`;
  if (t.sma20 && t.sma20 > cur * 1.05 && t.sma20 < cur * 1.15) {
    midTarget = t.sma20;
    midReason = `최근 20일 이동평균선·볼린저 중심선(${formatUSD(t.sma20)}) 핵심 저항선`;
  }

  let highTarget = cur * 1.15;
  let highReason = `현재가(${formatUSD(cur)}) 대비 +15.0% 강한 반등 목표가`;
  if (t.recentHigh && t.recentHigh > cur * 1.10 && t.recentHigh < cur * 1.25) {
    highTarget = t.recentHigh;
    highReason = `최근 2주(14일) 최고점(${formatUSD(t.recentHigh)}) 전고점 저항선`;
  }

  let rawSell1 = midTarget;
  let rawSell2 = highTarget;
  let chosenReason = midReason;

  if (mode === 'SHORT') {
    rawSell1 = shortTarget;
    rawSell2 = midTarget;
    chosenReason = shortReason;
  } else if (mode === 'MID') {
    rawSell1 = midTarget;
    rawSell2 = highTarget;
    chosenReason = midReason;
  } else if (mode === 'HIGH') {
    rawSell1 = highTarget;
    rawSell2 = Math.max(highTarget * 1.05, cur * 1.20);
    chosenReason = highReason;
  }

  if (cur < breakevenPrice) {
    const gapToBreakeven = breakevenPrice - cur;
    const maxAllowedSell1 = cur + gapToBreakeven * 0.65;
    const maxAllowedSell2 = cur + gapToBreakeven * 0.88;

    if (rawSell1 > maxAllowedSell1) {
      rawSell1 = maxAllowedSell1;
      chosenReason = `현재가(${formatUSD(cur)})와 본전(${formatUSD(breakevenPrice)}) 사이의 단기 저항 목표 구간`;
    }
    rawSell2 = Math.min(rawSell2, maxAllowedSell2);
    rawSell1 = Math.max(cur * 1.02, rawSell1);
    rawSell2 = Math.max(rawSell1 * 1.03, rawSell2);
  }

  t.autoSellTarget1 = Number(rawSell1.toFixed(2));
  t.autoSellTarget2 = Number(rawSell2.toFixed(2));
  t.sellReasonText = chosenReason;

  t.autoBuyTarget1 = Number((t.autoSellTarget1 * 0.90).toFixed(2));
  t.autoBuyTarget2 = Number(Math.min(cur * 0.90, t.bbLower > 0 ? t.bbLower : cur * 0.88).toFixed(2));

  if (forceSyncToSim || !t.simSellPrice || t.simSellPrice >= breakevenPrice) {
    t.simSellPrice = t.autoSellTarget1;
    const dropRatio = t.dropRatio || 10;
    t.simBuyPrice = Number((t.simSellPrice * (1 - dropRatio / 100)).toFixed(2));
    const simSellEl = document.getElementById('sim-sell-price');
    const simBuyEl = document.getElementById('sim-buy-price');
    if (simSellEl) simSellEl.value = t.simSellPrice;
    if (simBuyEl) simBuyEl.value = t.simBuyPrice;
  }
}

// =======================================================
// 시세 데이터 조회 (Twelve Data 키 우선, 없으면 무료 프록시 경유 Yahoo)
// 반환 형식: { bars: [{close, high, low}] 오래된 순, livePrice, prevClose, sessionLabel, source }
// =======================================================
const QUOTE_API_KEY_STORAGE = 'twelvedata_api_key';
const TWELVE_SERIES_TTL_MS = 30 * 60 * 1000; // 일봉은 30분마다만 다시 받아 무료 한도(하루 800회)를 아낀다
const twelveSeriesCache = {};

// 키는 백업 코드·파일에 섞이지 않도록 appState와 따로, 이 기기 브라우저에만 저장
function getQuoteApiKey() {
  try {
    return localStorage.getItem(QUOTE_API_KEY_STORAGE) || '';
  } catch (e) {
    return '';
  }
}

function setQuoteApiKey() {
  const current = getQuoteApiKey();
  const masked = current ? `${current.slice(0, 4)}…${current.slice(-4)}` : '없음';
  const input = prompt(
    `Twelve Data API 키를 입력해 주세요. (현재: ${masked})\n` +
    `twelvedata.com 무료 가입 → 대시보드의 API Keys에서 복사할 수 있습니다.\n` +
    `키는 이 기기 브라우저에만 저장되며, 비워 두고 확인을 누르면 삭제됩니다.`,
    ''
  );
  if (input === null) return;
  const key = input.trim();
  try {
    if (key) localStorage.setItem(QUOTE_API_KEY_STORAGE, key);
    else localStorage.removeItem(QUOTE_API_KEY_STORAGE);
  } catch (e) {
    alert('이 브라우저에서는 키를 저장할 수 없습니다.');
    return;
  }
  Object.keys(twelveSeriesCache).forEach(k => delete twelveSeriesCache[k]);
  fetchMarketDataAndAnalyze();
}

// 유닉스 초 → 뉴욕 현지 시각(0시부터 분)
function getNewYorkMinutes(unixSec) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date(unixSec * 1000));
  const h = Number(parts.find(p => p.type === 'hour').value);
  const m = Number(parts.find(p => p.type === 'minute').value);
  return h * 60 + m;
}

async function fetchTwelveJson(path, apiKey) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.twelvedata.com/${path}&apikey=${encodeURIComponent(apiKey)}`, { signal: controller.signal });
    const json = await res.json().catch(() => null);
    if (!json) throw new Error(`HTTP ${res.status}`);
    if (json.status === 'error' || !res.ok) {
      const code = Number(json.code) || res.status;
      if (code === 401) throw new Error('API 키가 올바르지 않음');
      if (code === 429) throw new Error('무료 사용 한도 초과');
      throw new Error(`${code} ${String(json.message || '').slice(0, 60)}`);
    }
    return json;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('응답 시간 초과');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchFromTwelveData(ticker, apiKey) {
  const sym = encodeURIComponent(ticker);
  const cached = twelveSeriesCache[ticker];
  const needSeries = !cached || Date.now() - cached.at > TWELVE_SERIES_TTL_MS;
  const [quote, series] = await Promise.all([
    fetchTwelveJson(`quote?symbol=${sym}&prepost=true`, apiKey),
    needSeries ? fetchTwelveJson(`time_series?symbol=${sym}&interval=1day&outputsize=70`, apiKey) : null
  ]);

  if (series) {
    const fresh = (series.values || [])
      .map(v => ({ date: v.datetime, close: Number(v.close), high: Number(v.high), low: Number(v.low) }))
      .filter(b => b.close > 0 && b.high > 0 && b.low > 0)
      .reverse();
    if (fresh.length < 21) throw new Error('일봉 데이터 부족');
    twelveSeriesCache[ticker] = { at: Date.now(), bars: fresh };
  }

  const regPrice = Number(quote.close);
  if (!(regPrice > 0)) throw new Error('가격 데이터 없음');

  // 캐시된 일봉의 마지막 날을 최신 시세로 갱신 (장중에는 당일 봉이 계속 바뀜)
  const bars = twelveSeriesCache[ticker].bars.map(b => ({ ...b }));
  const todayBar = { date: quote.datetime, close: regPrice, high: Number(quote.high), low: Number(quote.low) };
  const lastDate = bars[bars.length - 1].date;
  if (todayBar.date === lastDate) bars[bars.length - 1] = todayBar;
  else if (todayBar.date > lastDate) bars.push(todayBar);

  let livePrice = regPrice;
  let prevClose = Number(quote.previous_close);
  let sessionLabel = quote.is_market_open ? '🟢 정규장 실시간 기준 주가' : '🟢 최근 정규장 마감·체결 주가';
  const extPrice = Number(quote.extended_price);
  if (!quote.is_market_open && extPrice > 0 && quote.extended_timestamp) {
    livePrice = extPrice;
    if (getNewYorkMinutes(Number(quote.extended_timestamp)) < 9 * 60 + 30) {
      sessionLabel = '🌅 프리마켓(장전) 실시간 주가';
      prevClose = regPrice; // 장전 등락은 직전 정규장 종가 대비
    } else {
      sessionLabel = '🌙 애프터마켓·최근 체결 주가';
    }
  }

  return { bars, livePrice, prevClose, sessionLabel, source: 'Twelve Data' };
}

// 무료 프록시 여러 곳에 동시에 Yahoo 차트를 요청하고 가장 먼저 온 유효한 응답을 쓴다 (첫 응답이 느린 경우가 많음)
async function fetchYahooChartViaProxies(yahooUrl, timeoutMs = QUOTE_TIMEOUT_MS) {
  // corsproxy.io는 2026-11 기준 API 키 없이는 401/403을 돌려줘 제외
  const endpoints = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(yahooUrl)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(yahooUrl)}`
  ];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await Promise.any(endpoints.map(async url => {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error('No chart data');
      return result;
    }));
  } finally {
    clearTimeout(timeoutId);
    controller.abort(); // 아직 응답하지 않은 나머지 요청 정리
  }
}

async function fetchFromYahooProxies(ticker) {
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=3mo&includePrePost=true`;
  const chartData = await fetchYahooChartViaProxies(yahooUrl);

  const meta = chartData.meta;
  const quote = chartData.indicators.quote[0];
  const bars = [];
  for (let i = 0; i < quote.close.length; i++) {
    if (quote.close[i] != null && quote.high[i] != null && quote.low[i] != null) {
      bars.push({ close: Number(quote.close[i]), high: Number(quote.high[i]), low: Number(quote.low[i]) });
    }
  }
  if (bars.length === 0) throw new Error('No bars');

  const regPrice = Number(meta.regularMarketPrice || bars[bars.length - 1].close);
  let livePrice = regPrice;
  let sessionLabel = '🟢 정규장 실시간 기준 주가';

  const mState = String(meta.marketState || '').toUpperCase();
  if (mState === 'PRE' && meta.preMarketPrice) {
    livePrice = Number(meta.preMarketPrice);
    sessionLabel = '🌅 프리마켓(장전) 실시간 주가';
  } else if ((mState === 'POST' || mState === 'POSTPOST' || mState === 'CLOSED') && meta.postMarketPrice) {
    livePrice = Number(meta.postMarketPrice);
    sessionLabel = '🌙 애프터마켓·최근 체결 주가';
  } else if (mState !== 'REGULAR') {
    sessionLabel = '🟢 최근 정규장 마감·체결 주가';
  }

  // meta.chartPreviousClose는 조회 구간(3개월) 시작 전 종가라 전일 종가로 쓰면 안 된다.
  // 장전에는 직전 정규장 종가, 그 외에는 마지막 일봉의 전날 종가와 비교한다.
  const prevClose = mState === 'PRE'
    ? regPrice
    : (bars.length >= 2 ? bars[bars.length - 2].close : regPrice);

  return { bars, livePrice, prevClose, sessionLabel, source: '무료 경로' };
}

// isAutoRefresh: 60초 주기 갱신이면 사용자가 시뮬레이터에 입력한 매도·매수가를 덮어쓰지 않는다
async function fetchMarketDataAndAnalyze(isAutoRefresh = false) {
  const ticker = appState.currentTicker;
  const badgeEl = document.getElementById('live-connection-badge');
  const statusEl = document.getElementById('price-status-text');
  const timeBadge = document.getElementById('analysis-time-badge');
  const sessionBadge = document.getElementById('market-session-badge');

  badgeEl.textContent = `🔄 ${ticker} 실시간 시세 및 기술적 지표 계산 중...`;

  // 1순위: 사용자가 등록한 Twelve Data 키, 실패하거나 키가 없으면 무료 프록시 경로
  const apiKey = getQuoteApiKey();
  let market = null;
  let twelveError = '';
  if (apiKey) {
    try {
      market = await fetchFromTwelveData(ticker, apiKey);
    } catch (e) {
      twelveError = e.message;
    }
  }
  if (!market) {
    try {
      market = await fetchFromYahooProxies(ticker);
    } catch (e) {
      // 모든 경로 실패 또는 시간 초과
    }
  }

  // 조회 중 종목을 바꿨다면 이전 종목 결과는 버린다 (새 종목 조회가 따로 진행 중)
  if (appState.currentTicker !== ticker) return;

  const t = appState.tickers[ticker];

  if (market) {
    const validBars = market.bars;
    const closes = validBars.map(b => b.close);
    const livePrice = market.livePrice;
    const sessionLabel = market.sessionLabel;

    t.marketSessionLabel = sessionLabel;
    if (sessionBadge) sessionBadge.textContent = sessionLabel;

    const prevClose = market.prevClose || closes[closes.length - 2] || livePrice;

    if (closes.length > 0) {
      closes[closes.length - 1] = livePrice;
    }

    const last14 = validBars.slice(-14);
    const recentLow = Math.min(...last14.map(b => b.low), livePrice);
    const recentHigh = Math.max(...last14.map(b => b.high), livePrice);
    const lastBar = validBars[validBars.length - 1] || { low: livePrice, high: livePrice };

    const rsi = computeRSI(closes, 14);
    const sma5 = computeSMA(closes, 5);
    const bb = computeBollingerBands(closes, 20, 2);

    t.currentPrice = Number(livePrice.toFixed(2));
    t.prevClose = Number(prevClose.toFixed(2));
    t.dayLow = Number(Math.min(lastBar.low, livePrice).toFixed(2));
    t.dayHigh = Number(Math.max(lastBar.high, livePrice).toFixed(2));
    t.recentLow = Number(recentLow.toFixed(2));
    t.recentHigh = Number(recentHigh.toFixed(2));
    t.rsi = Number(rsi.toFixed(1));
    t.sma5 = Number(sma5.toFixed(2));
    t.sma20 = Number(bb.middle.toFixed(2));
    t.bbUpper = Number(bb.upper.toFixed(2));
    t.bbLower = Number(bb.lower.toFixed(2));

    if (t.growth && t.growth.heldShares === 0) {
      t.growth.avgPrice = t.currentPrice;
      const gAvgEl = document.getElementById('g-avg-price');
      if (gAvgEl) gAvgEl.value = t.currentPrice;
    }

    t.lastQuoteAt = Date.now();
    computeRealisticTargets(t, !isAutoRefresh);

    document.getElementById('current-price').value = t.currentPrice;

    const nowStr = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    badgeEl.textContent = `🟢 ${ticker} 실시간 시세·보조지표 연동 완료 (${nowStr})`;
    timeBadge.textContent = `${nowStr} 동기화`;
    if (twelveError) {
      statusEl.textContent = `⚠️ Twelve Data 오류(${twelveError}) · 보조 경로 가격($${t.currentPrice}) 반영`;
      statusEl.style.color = '#b45309';
    } else {
      statusEl.textContent = `✅ ${market.source} 가격($${t.currentPrice}) 자동 반영 완료`;
      statusEl.style.color = 'var(--accent-green)';
    }
  } else {
    // 네트워크/프록시 지연 시 기존 저장된 유효 가격을 보존
    const savedCur = t.currentPrice || parseFloat(document.getElementById('current-price').value) || 45.97;
    t.currentPrice = savedCur;
    document.getElementById('current-price').value = savedCur;
    if (sessionBadge) sessionBadge.textContent = t.marketSessionLabel || '⚡ 최근 저장 시세 기준';
    computeRealisticTargets(t, !isAutoRefresh);

    const lastOkStr = t.lastQuoteAt
      ? new Date(t.lastQuoteAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '기록 없음';
    badgeEl.textContent = `🟡 최근 저장가($${savedCur}) 기반 타점 분석`;
    const reason = twelveError
      ? `Twelve Data 오류(${twelveError})`
      : apiKey ? '시세 서버 응답 없음' : '무료 시세 경로 응답 없음 · 🔑 시세 키를 등록하면 안정적으로 받을 수 있습니다';
    statusEl.textContent = `⚠️ ${reason} · 마지막 확인 ${lastOkStr} · $${savedCur} (증권사 앱 가격으로 직접 수정 가능)`;
    statusEl.style.color = '#b45309';
  }

  saveState();
  recalcAll(false);
  recalcGrowthMode(false);
}

function applyAutoTargetsToSimulator() {
  const t = appState.tickers[appState.currentTicker];
  computeRealisticTargets(t, true);
  runSimulator(false, true);
}

function recalcAll(syncFromDOM = true) {
  if (syncFromDOM) {
    syncInputsToState();
  }
  const t = appState.tickers[appState.currentTicker];
  ensurePrincipalAnchor(t);
  computeRealisticTargets(t, false);

  const totalPrincipal = getTotalPrincipal(t) || (t.shares * t.avgPrice);
  const currentEval = (t.shares * t.currentPrice) + (t.reservedCash || 0);
  const diff = currentEval - totalPrincipal;
  const lossRate = totalPrincipal > 0 ? (diff / totalPrincipal) * 100 : 0;

  const neededFromStock = Math.max(0, totalPrincipal - (t.reservedCash || 0));
  const breakevenPrice = t.shares > 0 ? neededFromStock / t.shares : 0;
  const neededRiseRate = t.currentPrice > 0 ? ((breakevenPrice - t.currentPrice) / t.currentPrice) * 100 : 0;

  updateAnchorBanner(t);

  document.getElementById('total-principal').textContent = formatUSD(totalPrincipal);
  document.getElementById('total-principal-krw').textContent = formatKRW(totalPrincipal);
  document.getElementById('current-eval').textContent = formatUSD(currentEval);

  const lossEl = document.getElementById('current-loss-rate');
  const sign = diff >= 0 ? '+' : '';
  lossEl.textContent = `${sign}${lossRate.toFixed(2)}% (${sign}${formatUSD(diff)})`;
  lossEl.style.color = diff >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';

  document.getElementById('breakeven-price').textContent = formatUSD(breakevenPrice);
  document.getElementById('needed-rise-rate').innerHTML =
    neededRiseRate > 0
      ? `현재가 대비 <strong>+${neededRiseRate.toFixed(1)}%</strong> 상승 필요`
      : `<strong>🎉 본전 탈출 목표 달성!</strong>`;

  if (t.currentPrice >= breakevenPrice) {
    document.getElementById('why-hard-explanation').innerHTML = `
      🎉 <strong>축하합니다! 현재 주가(${formatUSD(t.currentPrice)})가 내 본전 탈출 목표가(${formatUSD(breakevenPrice)}) 이상입니다!</strong>
      다음 운용을 고민 중이라면 <strong>[🌱 40분할]</strong> 메뉴의 🧪 과거 검증에서 이 규칙의 실제 성적(최대 낙폭·갇힌 기간 포함)부터 확인해 보세요.
    `;
  } else {
    const bouncePct = (((t.autoSellTarget1 - t.currentPrice) / t.currentPrice) * 100).toFixed(1);
    document.getElementById('why-hard-explanation').innerHTML = `
      현재 주가(<strong>${formatUSD(t.currentPrice)}</strong>)에서 본전(<strong>${formatUSD(breakevenPrice)}</strong>)까지 한 번에 가려면 <strong>+${neededRiseRate.toFixed(1)}%</strong> 올라야 합니다.
      본전(${formatUSD(breakevenPrice)})까지 마냥 기다리지 말고, 현재가에서 <strong>+${bouncePct}%</strong> 반등해 <strong>추천 목표 매도가(${formatUSD(t.autoSellTarget1)})</strong>에 닿을 때 보유 물량의 15~20%를 일단 팔고, 다시 눌렸을 때 사서 <strong>탈출 기준선 자체를 ${formatUSD(breakevenPrice)} 아래로 끌어내리세요!</strong>
    `;
  }

  updateAutoSignalDashboard(breakevenPrice);
  runSimulator(false, false);
  renderLogs();
}

function updateAutoSignalDashboard(breakevenPrice) {
  const ticker = appState.currentTicker;
  const t = appState.tickers[ticker];
  const cur = t.currentPrice;
  const prev = t.prevClose || cur;
  const change = cur - prev;
  const changePct = prev > 0 ? (change / prev) * 100 : 0;

  document.getElementById('quote-ticker-label').textContent = `${ticker}`;
  document.getElementById('live-price-display').textContent = formatUSD(cur);
  const fwpMirror = document.getElementById('fwp-live-price-mirror');
  if (fwpMirror) fwpMirror.textContent = formatUSD(cur);

  const chgEl = document.getElementById('live-change-display');
  const chgSign = change >= 0 ? '+' : '';
  chgEl.textContent = `${chgSign}${change.toFixed(2)} (${chgSign}${changePct.toFixed(2)}%)`;

  document.getElementById('live-day-range').textContent = `${formatUSD(t.dayLow || cur * 0.97)} ~ ${formatUSD(t.dayHigh || cur * 1.03)}`;
  document.getElementById('live-14d-range').textContent = `${formatUSD(t.recentLow)} ~ ${formatUSD(t.recentHigh)}`;

  const rsi = t.rsi || 50;
  const sma5 = t.sma5 || cur * 1.045;
  const sma20 = t.sma20 || cur * 1.09;
  const bbUpper = t.bbUpper || cur * 1.15;
  const bbLower = t.bbLower || cur * 0.90;

  document.getElementById('ind-rsi-val').textContent = `${rsi.toFixed(1)} 점`;
  document.getElementById('ind-rsi-status').textContent =
    rsi >= 60 ? '🔴 단기 과열 (매도·익절 유리)' : rsi <= 38 ? '🟢 단기 과매도 (저점 매수 유리)' : '🟡 중립 구간 (38~60 사이)';

  document.getElementById('ind-sma20-val').textContent = `5일 ${formatUSD(sma5)} / 20일 ${formatUSD(sma20)}`;
  document.getElementById('ind-sma20-status').textContent =
    cur < sma5 ? '1차 저항: 5일선 / 2차 저항: 20일선' : '5일선 돌파 완료! 20일선 저항 도전 중';

  const sell1Pct = (((t.autoSellTarget1 - cur) / cur) * 100).toFixed(1);
  const sell2Pct = (((t.autoSellTarget2 - cur) / cur) * 100).toFixed(1);
  document.getElementById('ind-sell-target').textContent = `${formatUSD(t.autoSellTarget1)} (+${sell1Pct}%) / ${formatUSD(t.autoSellTarget2)} (+${sell2Pct}%)`;
  document.getElementById('ind-sell-basis').textContent = t.sellReasonText || '선택한 반등 기준 적용';

  const buy1Pct = (((t.autoSellTarget1 - t.autoBuyTarget1) / t.autoSellTarget1) * 100).toFixed(0);
  document.getElementById('ind-buy-target').textContent = `${formatUSD(t.autoBuyTarget1)} (매도가 -${buy1Pct}%) / ${formatUSD(t.autoBuyTarget2)}`;
  document.getElementById('ind-buy-basis').textContent = `1차 매도 체결 후 -10% 눌림목 & 볼린저 하단`;

  const topSellEl = document.getElementById('top-sell-target');
  const topBuyEl = document.getElementById('top-buy-target');
  if (topSellEl) topSellEl.textContent = `${formatUSD(t.autoSellTarget1)} (+${sell1Pct}%)`;
  if (topBuyEl) topBuyEl.textContent = `${formatUSD(t.autoBuyTarget1)}`;

  const rationaleBox = document.getElementById('target-rationale-box');
  if (rationaleBox) {
    rationaleBox.innerHTML = `
      <strong>🧐 왜 추천 목표 매도가가 [${formatUSD(t.autoSellTarget1)}]으로 계산되었나요? (산출 근거)</strong><br/>
      • <strong>현재 주가(${formatUSD(cur)})</strong> 기준으로, 차트상 단기 반등이 나올 때 매물대 벽에 부딪혀 다시 꺾이기 쉬운 <strong>[${t.sellReasonText}]</strong> 지점이기 때문입니다.<br/>
      • <strong>기준별 비교:</strong> ⚡짧은 회전(5일선·+4.5%): <strong>${formatUSD(t.sma5 && t.sma5 > cur * 1.02 ? t.sma5 : cur * 1.045)}</strong> ｜ ⚖️표준 반등(20일선·+9%): <strong>${formatUSD(t.sma20 && t.sma20 > cur * 1.05 ? t.sma20 : cur * 1.09)}</strong> ｜ 🚀강한 반등(2주고점·+15%): <strong>${formatUSD(t.recentHigh && t.recentHigh > cur * 1.1 ? t.recentHigh : cur * 1.15)}</strong>
    `;
  }

  const bbWidth = Math.max(0.01, bbUpper - bbLower);
  const percentB = Math.min(100, Math.max(0, ((cur - bbLower) / bbWidth) * 100));
  const timingScore = Math.round(rsi * 0.5 + percentB * 0.5);

  document.getElementById('timing-meter-fill').style.left = `${Math.min(96, Math.max(4, timingScore))}%`;

  const box = document.getElementById('signal-result-box');
  const lSell = document.getElementById('light-sell');
  const lWait = document.getElementById('light-wait');
  const lBuy = document.getElementById('light-buy');
  const title = document.getElementById('signal-title');
  const desc = document.getElementById('signal-desc');
  const recipe = document.getElementById('signal-action-recipe');
  const scoreLabel = document.getElementById('score-label-text');

  lSell.classList.remove('active');
  lWait.classList.remove('active');
  lBuy.classList.remove('active');
  box.className = 'signal-box';

  if (!isQuoteFresh(t)) {
    box.classList.add('neutral');
    scoreLabel.textContent = '타이밍 점수: 보류 (시세 미확인)';
    title.textContent = '⚠️ 최신 시세가 확인되지 않아 오늘의 추천 행동을 보류합니다.';
    desc.textContent = `마지막으로 확인된 가격(${formatUSD(cur)})은 실제 시세와 다를 수 있습니다.`;
    recipe.innerHTML = `• 상단 🔄 버튼으로 시세를 다시 불러오거나, 증권사 앱에서 확인한 현재가를 <strong>[현재 주가]</strong> 칸에 직접 입력하면 신호가 다시 계산됩니다.`;
    return;
  }

  const sell20Shares = Math.round(t.shares * 0.2);
  const sell15Shares = Math.round(t.shares * 0.15);

  if (timingScore >= 64 || rsi >= 62) {
    box.classList.add('sell-mode');
    lSell.classList.add('active');
    scoreLabel.textContent = `타이밍 점수: ${timingScore}점 (🔴 단기 반등 과열 - 매도·익절 적기!)`;
    title.textContent = `🔴 지금은 [단기 반등 고점 구간]입니다! 일부 매도 또는 익절에 유리한 타이밍입니다.`;
    desc.textContent = `단기 지표(RSI ${rsi.toFixed(1)})가 과열되어 한 차례 눌림목 조정이 나올 가능성이 높습니다.`;
    const rebuyTarget = (cur * 0.90).toFixed(2);
    recipe.innerHTML = `
      <strong>📌 모드별 오늘 밤 추천 행동:</strong><br/>
      • <strong>[원금 탈출 모드]:</strong> 보유 중인 ${t.shares}주 중 <strong>${sell20Shares}주(20%)</strong>를 <strong>${formatUSD(cur)} ~ ${formatUSD(t.autoSellTarget1)}</strong>에 분할 매도 후, <strong>$${rebuyTarget} 이하</strong>에서 다시 사세요.<br/>
      • <strong>[수익 창출 모드]:</strong> 평단가 대비 수익 구간이라면 욕심내지 말고 익절하거나 오늘 매수량을 절반(0.5회분)으로 줄이세요!
    `;
  } else if (timingScore <= 36 || rsi <= 38 || cur <= bbLower * 1.02) {
    box.classList.add('buy-mode');
    lBuy.classList.add('active');
    scoreLabel.textContent = `타이밍 점수: ${timingScore}점 (🟢 단기 바닥 과매도 - 매수 적기!)`;
    title.textContent = `🟢 지금은 [단기 과매도 바닥 구간]입니다! 저점 매수·재매수에 가장 유리한 타이밍입니다.`;
    desc.textContent = `최근 하락으로 현재가(${formatUSD(cur)})가 단기 바닥권(볼린저 하단 ${formatUSD(bbLower)}, RSI ${rsi.toFixed(1)})에 진입했습니다.`;
    recipe.innerHTML = `
      <strong>📌 모드별 오늘 밤 추천 행동:</strong><br/>
      • <strong>[원금 탈출 모드]:</strong> 규칙상 지금은 매도 구간이 아닙니다. 아껴둔 구출 현금이 있다면 지금 투입해 주식 수를 늘리세요.<br/>
      • <strong>[수익 창출 모드]:</strong> 평단가를 확 낮출 수 있는 찬스입니다! 오늘 1회분 매수 금액보다 <strong>1.5배 부스터 매수</strong>를 추천합니다!
    `;
  } else {
    box.classList.add('neutral');
    lWait.classList.add('active');
    scoreLabel.textContent = `타이밍 점수: ${timingScore}점 (🟡 중립 구간 - 규칙대로 지정가 주문)`;
    title.textContent = `🟡 현재가(${formatUSD(cur)})는 중립 위치입니다. 아래 목표 타점에 지정가 주문을 걸어두세요!`;
    desc.textContent = `급하게 추격 매수/매도하기보다 정해진 규칙대로 예약 주문을 걸어두는 것이 가장 안전합니다.`;
    const expectedRebuyAfterSell1 = (t.autoSellTarget1 * 0.90).toFixed(2);
    recipe.innerHTML = `
      <strong>📌 모드별 오늘 밤 추천 행동:</strong><br/>
      • <strong>[원금 탈출 모드]:</strong> 1차 반등 저항선인 <strong>${formatUSD(t.autoSellTarget1)}</strong>(+${sell1Pct}%)에 <strong>${sell15Shares}주(15%)</strong> 지정가 매도를 걸어두세요. (체결 시 $${expectedRebuyAfterSell1} 이하 재매수)<br/>
      • <strong>[수익 창출 모드]:</strong> 오늘 배정된 <strong>1회분 금액만큼 정석대로 분할 매수</strong>하고 목표 수익률(+10%) 지정가 매도를 걸어두세요!
    `;
  }
}

// =========================================================================
// [MODE 2: 본전 탈출 이후 꾸준한 수익 창출 모드 (스마트 분할매수·무한매수법) 로직]
// =========================================================================
function recalcGrowthMode(syncFromDOM = true) {
  const t = appState.tickers[appState.currentTicker];
  const g = t.growth;

  if (syncFromDOM) {
    g.totalBudget = parseFloat(document.getElementById('g-total-budget').value) || g.totalBudget;
    // 사용자가 시드를 바꾸면 기록 재계산의 기준 시드도 함께 갱신
    g.baseTotalBudget = Number((g.totalBudget - (g.cumulativeProfit || 0)).toFixed(2));
    g.splits = parseInt(document.getElementById('g-splits').value, 10) || 40;
    g.targetProfitPct = parseFloat(document.getElementById('g-target-profit').value) || 10;
    g.heldShares = parseFloat(document.getElementById('g-held-shares').value) || 0;
    g.avgPrice = parseFloat(document.getElementById('g-avg-price').value) || t.currentPrice;
    saveState();
  }

  const cur = t.currentPrice;
  const oneUnitUSD = g.splits > 0 ? g.totalBudget / g.splits : 0;
  const investedAmount = g.heldShares * g.avgPrice;
  const currentTurn = oneUnitUSD > 0 ? investedAmount / oneUnitUSD : 0;
  const remainingCash = Math.max(0, g.totalBudget - investedAmount);
  const progressPct = Math.min(100, (currentTurn / g.splits) * 100);
  const isFirstHalf = currentTurn < g.splits / 2;

  const evalValue = g.heldShares * cur;
  const profitUSD = evalValue - investedAmount;
  const currentRoi = investedAmount > 0 ? (profitUSD / investedAmount) * 100 : 0;

  document.getElementById('growth-cycle-badge').textContent = `현재 ${g.cycleCount || 1}번째 사이클 진행 중`;
  document.getElementById('g-one-unit-usd').value = formatUSD(oneUnitUSD);
  document.getElementById('g-one-unit-krw').textContent = `하루 1조각(${formatKRW(oneUnitUSD)})씩만 매수`;
  document.getElementById('g-current-turn').value = `${currentTurn.toFixed(1)} / ${g.splits}회차`;
  document.getElementById('g-phase-text').textContent = isFirstHalf
    ? `🟢 전반전 (1~${g.splits / 2}회차): 공격적 평단 낮추기 구간`
    : `🟡 후반전 (${g.splits / 2 + 1}~${g.splits}회차): 안전 방어 매수 구간`;

  document.getElementById('g-remaining-cash').value = formatUSD(remainingCash);
  const cashRatio = g.totalBudget > 0 ? ((remainingCash / g.totalBudget) * 100).toFixed(1) : 100;
  document.getElementById('g-remaining-pct').textContent = `남은 현금 총알 비중 ${cashRatio}%`;

  document.getElementById('g-progress-label').innerHTML =
    `📊 시드머니 소진 진행률: <strong>${progressPct.toFixed(1)}% (${currentTurn.toFixed(1)}회차 / ${g.splits}회차)</strong>`;
  document.getElementById('g-progress-fill').style.width = `${progressPct}%`;

  const roiBadge = document.getElementById('g-current-roi-badge');
  if (g.heldShares > 0) {
    const sign = profitUSD >= 0 ? '+' : '';
    roiBadge.textContent = `현재 수익률: ${sign}${currentRoi.toFixed(2)}% (${sign}${formatUSD(profitUSD)})`;
  } else {
    roiBadge.textContent = `현재 수익률: 0.00% (첫 매수 대기 중)`;
  }

  // 오늘 밤 자동 주문 레시피 계산 (라오어 무한매수법 + RSI 부스터 결합)
  const rsi = t.rsi || 50;
  let boosterMultiplier = 1.0;
  let aiTipText = `💡 <strong>RSI 결합 팁:</strong> 현재 RSI(${rsi.toFixed(1)})가 중립 구간이므로 정석대로 <strong>딱 1회분(${formatUSD(oneUnitUSD)})</strong>만 매수하세요.`;

  if (rsi <= 38 || cur <= t.bbLower * 1.02) {
    boosterMultiplier = 1.5;
    aiTipText = `🔥 <strong>RSI 저점 부스터 조건 충족</strong> 현재 차트가 과매도 바닥권(RSI ${rsi.toFixed(1)})입니다. 부스터 규칙상 오늘은 1.5회분(<strong>${formatUSD(oneUnitUSD * 1.5)}</strong>)을 매수합니다.`;
  } else if (rsi >= 64) {
    boosterMultiplier = 0.5;
    aiTipText = `🛡️ <strong>RSI 고점 방어 조건 충족</strong> 현재 단기 과열권(RSI ${rsi.toFixed(1)})이라 부스터 규칙상 오늘은 0.5회분(<strong>${formatUSD(oneUnitUSD * 0.5)}</strong>)만 매수합니다.`;
  }

  // 과거 검증 결과가 있으면 부스터가 실제로 도움이 됐는지 같이 보여준다
  const splitBt = getSplitBacktestResult(appState.currentTicker);
  if (splitBt && splitBt.result.overall) {
    const { plain, booster } = splitBt.result.overall;
    aiTipText += `<br/><small style="color:#64748b">🧪 과거 검증(상장 초부터): 부스터 사용 연복리 ${formatBtSignedPct(booster.cagr)} · 미사용 ${formatBtSignedPct(plain.cagr)} — 부스터 없이 매일 1회분만 사는 선택지도 있습니다.</small>`;
  }

  const todayBudget = Math.min(remainingCash, oneUnitUSD * boosterMultiplier);
  document.getElementById('g-buy-total-budget').textContent = `오늘 추천 배정액: ${formatUSD(todayBudget)}`;
  document.getElementById('g-buy-ai-tip').innerHTML = aiTipText;

  const buyBox = document.getElementById('g-buy-orders-content');
  if (remainingCash <= 10) {
    buyBox.innerHTML = `<strong>모든 회차(40회분) 매수가 완료되었습니다.</strong><br/>추가 매수 없이 목표 익절가 도달 또는 단기 반등 매도를 기다리세요.`;
  } else if (g.heldShares === 0) {
    // 1회차 첫 진입
    const firstShares = Math.max(1, Math.floor(todayBudget / cur));
    buyBox.innerHTML = `
      <strong>📌 [1회차 첫 진입 주문]</strong><br/>
      • 아직 보유 주식이 없습니다! 오늘 밤 장 마감(LOC) 또는 현재가(<strong>${formatUSD(cur)}</strong>)로 <strong>${firstShares}주</strong>(약 ${formatUSD(firstShares * cur)})를 첫 매수하세요!<br/>
      • 첫 매수가 체결되면 내일부턴 평단가를 기준으로 절반씩 나누어 주문합니다.
    `;
  } else if (isFirstHalf) {
    // 전반전: 절반(50%)은 내 평단가에 LOC 매수, 나머지 절반(50%)은 현재가+5%(큰수)에 LOC 매수
    const halfBudget = todayBudget / 2;
    const order1Price = g.avgPrice;
    const order1Shares = Math.max(1, Math.floor(halfBudget / order1Price));
    const order2Price = Number((cur * 1.05).toFixed(2));
    const order2Shares = Math.max(1, Math.floor(halfBudget / cur));

    buyBox.innerHTML = `
      <strong>📌 [전반전 2분할 LOC 매수 주문표]</strong><br/>
      1️⃣ <strong>평단가 LOC 매수 (절반):</strong> 내 평단가인 <strong>${formatUSD(order1Price)}</strong>에 <strong>${order1Shares}주</strong> LOC 매수 걸기 <small style="color:#64748b">(종가가 내 평단가보다 낮을 때만 체결되어 평단가를 낮춤)</small><br/>
      2️⃣ <strong>체결 우선 LOC 매수 (절반):</strong> 현재가 대비 여유 있는 <strong>${formatUSD(order2Price)}</strong>에 <strong>${order2Shares}주</strong> LOC 매수 걸기 <small style="color:#64748b">(종가가 이 가격 이하이면 체결 · 장중 5% 넘게 급등하면 체결되지 않음)</small>
    `;
  } else {
    // 후반전: 전액 내 평단가 이하에만 LOC 매수
    const orderPrice = g.avgPrice;
    const orderShares = Math.max(1, Math.floor(todayBudget / orderPrice));
    buyBox.innerHTML = `
      <strong>📌 [후반전 안전 방어 LOC 매수 주문표]</strong><br/>
      • 후반전(${currentTurn.toFixed(1)}회차)부터는 내 평단가보다 비싸게 사지 않습니다!<br/>
      • <strong>평단가 LOC 매수 (전액):</strong> 내 평단가인 <strong>${formatUSD(orderPrice)}</strong>에 <strong>${orderShares}주</strong> LOC 매수를 걸어두세요. (종가가 내 평단가 이하일 때만 매수 체결)
    `;
  }

  if (!isQuoteFresh(t)) {
    buyBox.innerHTML = `<div style="color:#b45309;font-weight:700;margin-bottom:6px;">⚠️ 최신 시세 미확인: 아래 수량은 마지막 확인 가격(${formatUSD(cur)}) 기준입니다. 주문 전 현재가를 확인하세요.</div>` + buyBox.innerHTML;
  }

  // 오늘 매도(익절) 주문표
  const targetSellPrice = Number(((g.heldShares > 0 ? g.avgPrice : cur) * (1 + g.targetProfitPct / 100)).toFixed(2));
  document.getElementById('g-sell-target-price-label').textContent = `목표 익절가: ${formatUSD(targetSellPrice)} (+${g.targetProfitPct}%)`;

  const sellBox = document.getElementById('g-sell-orders-content');
  const sellTip = document.getElementById('g-sell-ai-tip');

  if (g.heldShares <= 0) {
    sellBox.innerHTML = `
      • 1회차 매수가 체결된 다음 날부터 보유 수량 전량을 <strong>평단가 +${g.targetProfitPct}% (${formatUSD(targetSellPrice)})</strong>에 지정가 매도로 걸어두시면 됩니다!
    `;
    sellTip.innerHTML = `💡 매일 장이 열리기 전 지정가 매도를 걸어두면, 밤사이 주가가 급등할 때 자는 동안 자동으로 수익 확정(졸업)됩니다!`;
  } else {
    const expectedProfitIfGrad = (targetSellPrice * (1 - TRADING_FEE_RATE) - g.avgPrice * (1 + TRADING_FEE_RATE)) * g.heldShares;
    sellBox.innerHTML = `
      <strong>📌 [전량 익절(졸업) 지정가 매도 예약]</strong><br/>
      • <strong>주문 가격:</strong> 내 평단가(${formatUSD(g.avgPrice)}) 대비 +${g.targetProfitPct}%인 <strong>${formatUSD(targetSellPrice)}</strong><br/>
      • <strong>주문 수량:</strong> 현재 보유 수량 전량 <strong>${g.heldShares}주</strong> 지정가(애프터마켓 포함) 매도 걸어두기<br/>
      • <strong>체결 시 확정 순수익 (수수료 차감):</strong> <strong style="color:var(--accent-green);">+${formatUSD(expectedProfitIfGrad)} (${formatKRW(expectedProfitIfGrad)}) 🎉</strong>
    `;
    sellTip.innerHTML = `💡 만약 오늘 밤 ${formatUSD(targetSellPrice)}에 도달해 전량 매도되었다면, 우측 상단 <strong>[🎉 목표 달성! 이번 사이클 익절 확정하기]</strong> 버튼을 눌러 수익을 기록하고 1회차부터 새로 시작하세요!`;
  }

  // 과거 검증 · 연간 복리 시뮬레이터 & 명예의 전당 렌더링
  renderSplitBacktest();
  renderGrowthCompoundAndHistory();
}

function fillGrowthBuyFromToday() {
  const t = appState.tickers[appState.currentTicker];
  const g = t.growth;
  const oneUnit = g.splits > 0 ? g.totalBudget / g.splits : 0;
  const shares = Math.max(1, Math.floor(oneUnit / t.currentPrice));

  document.getElementById('g-input-buy-price').value = t.currentPrice;
  document.getElementById('g-input-buy-shares').value = shares;
  document.getElementById('g-input-buy-memo').value = `정기 분할매수 (${(g.heldShares > 0 ? ((g.heldShares * g.avgPrice) / oneUnit + 1) : 1).toFixed(0)}회차)`;
}

function addGrowthDailyBuy(e) {
  e.preventDefault();
  const t = appState.tickers[appState.currentTicker];
  const g = t.growth;

  const price = parseFloat(document.getElementById('g-input-buy-price').value);
  const shares = parseFloat(document.getElementById('g-input-buy-shares').value);
  const memo = document.getElementById('g-input-buy-memo').value.trim();
  const tradeDate = document.getElementById('g-input-buy-date').value || todayISO();

  if (!price || !shares || price <= 0 || shares <= 0) return;

  const prevCost = g.heldShares * g.avgPrice;
  const newCost = price * shares;
  const totalShares = Number((g.heldShares + shares).toFixed(4));
  const newAvg = totalShares > 0 ? Number(((prevCost + newCost) / totalShares).toFixed(2)) : price;

  g.heldShares = totalShares;
  g.avgPrice = newAvg;

  g.history.unshift({
    id: Date.now(),
    tradeDate,
    type: 'BUY',
    price,
    shares,
    amount: newCost,
    memo: memo || `평단가 $${newAvg}로 업데이트`
  });
  sortByTradeDate(g.history);

  document.getElementById('g-held-shares').value = g.heldShares;
  document.getElementById('g-avg-price').value = g.avgPrice;
  document.getElementById('g-input-buy-price').value = '';
  document.getElementById('g-input-buy-shares').value = '';
  document.getElementById('g-input-buy-memo').value = '';

  saveState();
  recalcGrowthMode(false);
}

function graduateCurrentCycle() {
  const t = appState.tickers[appState.currentTicker];
  const g = t.growth;

  if (g.heldShares <= 0) {
    alert('현재 보유 중인 주식이 없습니다. 먼저 분할매수 체결 내역을 추가해 주세요!');
    return;
  }

  const targetSellPrice = Number((g.avgPrice * (1 + g.targetProfitPct / 100)).toFixed(2));
  const sInput = prompt(
    `[${appState.currentTicker}] ${g.heldShares}주 전량의 실제 매도 체결가($)를 입력해 주세요:`,
    String(targetSellPrice)
  );
  if (sInput === null) return;
  const sellPrice = parseFloat(sInput);
  if (!sellPrice || sellPrice <= 0) {
    alert('올바른 매도 체결가를 입력해 주세요.');
    return;
  }

  // 실제 체결가 기준, 매수·매도 수수료(각 0.1%)를 차감한 순수익
  const netProceeds = g.heldShares * sellPrice * (1 - TRADING_FEE_RATE);
  const costBasis = g.heldShares * g.avgPrice * (1 + TRADING_FEE_RATE);
  const profit = Number((netProceeds - costBasis).toFixed(2));

  g.cumulativeProfit = Number(((g.cumulativeProfit || 0) + profit).toFixed(2));
  g.totalBudget = Number((g.totalBudget + profit).toFixed(2)); // 복리 재투자 반영

  g.history.unshift({
    id: Date.now(),
    tradeDate: todayISO(),
    type: 'GRADUATE',
    price: sellPrice,
    shares: g.heldShares,
    amount: profit,
    memo: `🎉 ${g.cycleCount}사이클 졸업 (${formatSignedUSD(profit)} 확정 · 원금 복리 합산)`
  });

  g.cycleCount = (g.cycleCount || 1) + 1;
  g.heldShares = 0;
  g.avgPrice = t.currentPrice;

  document.getElementById('g-total-budget').value = g.totalBudget;
  document.getElementById('g-held-shares').value = 0;
  document.getElementById('g-avg-price').value = t.currentPrice;

  saveState();
  recalcGrowthMode(false);
}

let editingGrowthId = null;
let editingLogId = null;

function startEditGrowthHistory(id) {
  editingGrowthId = id;
  renderGrowthCompoundAndHistory();
}

function cancelEditGrowthHistory() {
  editingGrowthId = null;
  renderGrowthCompoundAndHistory();
}

function saveEditGrowthHistory(id) {
  const t = appState.tickers[appState.currentTicker];
  const item = t.growth.history.find(h => h.id === id);
  if (!item) return;

  const newPrice = parseFloat(document.getElementById(`edit-g-price-${id}`)?.value);
  const newShares = parseFloat(document.getElementById(`edit-g-shares-${id}`)?.value);
  const newMemo = document.getElementById(`edit-g-memo-${id}`)?.value.trim() || '';
  const newDate = document.getElementById(`edit-g-date-${id}`)?.value;

  if (!newPrice || !newShares || newPrice <= 0 || newShares <= 0) {
    alert('올바른 가격과 수량을 입력해 주세요.');
    return;
  }

  if (newDate) item.tradeDate = newDate;
  item.price = newPrice;
  item.shares = newShares;
  if (item.type === 'BUY') {
    item.amount = Number((newPrice * newShares).toFixed(2));
  } else {
    const newAmount = parseFloat(document.getElementById(`edit-g-amount-${id}`)?.value);
    if (!isNaN(newAmount)) item.amount = Number(newAmount.toFixed(2));
  }
  item.memo = newMemo;

  editingGrowthId = null;
  recalculateGrowthFromHistory(t);
  saveState();
  populateInputsFromState();
  recalcGrowthMode(false);
}

function deleteGrowthHistory(id) {
  const t = appState.tickers[appState.currentTicker];
  t.growth.history = t.growth.history.filter(item => item.id !== id);
  if (editingGrowthId === id) editingGrowthId = null;
  recalculateGrowthFromHistory(t);
  saveState();
  populateInputsFromState();
  recalcGrowthMode(false);
}

function renderGrowthCompoundAndHistory() {
  const t = appState.tickers[appState.currentTicker];
  const g = t.growth;

  document.getElementById('g-cumulative-profit-badge').textContent =
    `누적 확정 수익: ${formatSignedUSD(g.cumulativeProfit || 0)} (${formatKRW(g.cumulativeProfit || 0)})`;

  // 과거 검증을 돌렸으면 실제 평균(졸업 1회 수익·연간 졸업 횟수)을, 아니면 앱 기본 가정치를 쓴다
  const splitBt = getSplitBacktestResult(appState.currentTicker);
  const btAll = splitBt && splitBt.result.overall ? splitBt.result.overall.plain : null;
  const useBt = !!(btAll && btAll.avgCycleProfit != null && btAll.cyclesPerYear > 0);
  const avgCycleYield = useBt ? btAll.avgCycleProfit : (g.targetProfitPct / 100) * 0.55;
  const cyclesPerYear = useBt ? btAll.cyclesPerYear : 6;
  const monthsPerCycle = 12 / cyclesPerYear;
  const oneCycleProfit = g.totalBudget * avgCycleYield;
  const oneYearAsset = g.totalBudget * (useBt ? 1 + btAll.cagr : Math.pow(1 + avgCycleYield, cyclesPerYear));
  const oneYearProfit = oneYearAsset - g.totalBudget;

  const summaryBox = document.getElementById('g-compound-summary');
  if (summaryBox) {
    const caveat = useBt
      ? `🧪 상장 초부터 과거 일봉으로 검증한 평균입니다 (1년 값은 실제 연복리 ${formatBtSignedPct(btAll.cagr)} 기준). 같은 기간 최대 낙폭 ${formatBtSignedPct(btAll.mdd, 0)}, 시드를 다 쓰고 최장 ${btAll.maxStuckDays.toLocaleString()}거래일 갇힌 구간이 있었습니다. 양도소득세(22%)·환전 비용은 반영되지 않았습니다.`
      : `⚠️ 앱 기본 가정치입니다 (매 사이클 시드 55% 소진 후 +${g.targetProfitPct}% 졸업, 연 6회 전부 성공). 위 <strong>🧪 과거 검증</strong>을 실행하면 실제 과거 평균으로 바뀝니다. 실패·장기 물림 사이클, 양도소득세(22%), 환전 비용은 반영되지 않았습니다.`;
    summaryBox.innerHTML = `
      <div class="diag-item">
        <span class="diag-label">졸업 1회 평균 순수익 ${useBt ? '(과거 평균)' : '(가정치)'}</span>
        <strong class="diag-value" style="color:var(--accent-green);">${formatSignedUSD(oneCycleProfit)}</strong>
        <span class="diag-sub">${formatKRW(oneCycleProfit)} (시드 대비 ${formatBtSignedPct(avgCycleYield)})</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">1년(약 ${cyclesPerYear.toFixed(1)}회 졸업) 운영 시 순수익 ${useBt ? '(과거 연복리)' : '(가정치)'}</span>
        <strong class="diag-value" style="color:var(--accent-blue);">${formatSignedUSD(oneYearProfit)}</strong>
        <span class="diag-sub">${formatKRW(oneYearProfit)}</span>
      </div>
      <div class="diag-item highlight-diag">
        <span class="diag-label">1년 뒤 총 자산 (원금+수익)</span>
        <strong class="diag-value">${formatUSD(oneYearAsset)}</strong>
        <span class="diag-sub">${formatKRW(oneYearAsset)}</span>
      </div>
      <div class="diag-sub" style="grid-column:1/-1;">${caveat}</div>
    `;
  }

  const periodTh = document.getElementById('g-compound-period-th');
  if (periodTh) periodTh.textContent = `졸업 횟수 (약 ${monthsPerCycle.toFixed(1)}개월/회${useBt ? ' · 과거 평균' : ' · 가정치'})`;

  const cTbody = document.getElementById('g-compound-tbody');
  if (cTbody) {
    cTbody.innerHTML = '';
    for (let i = 1; i <= 8; i++) {
      const asset = g.totalBudget * Math.pow(1 + avgCycleYield, i);
      const netProfit = asset - g.totalBudget;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${i}회 졸업 시</strong></td>
        <td>약 ${(i * monthsPerCycle).toFixed(1)}개월 뒤</td>
        <td><strong>${formatUSD(asset)}</strong></td>
        <td style="color:var(--accent-green); font-weight:800;">${formatSignedUSD(netProfit)}</td>
        <td>${formatKRW(asset)}</td>
      `;
      cTbody.appendChild(tr);
    }
  }

  const hTbody = document.getElementById('g-history-tbody');
  if (!hTbody) return;
  hTbody.innerHTML = '';

  if (!g.history || g.history.length === 0) {
    hTbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align:center; color:var(--text-muted); padding:20px;">
          아직 기록된 분할매수·익절 내역이 없습니다. 오늘 첫 분할매수를 시작하고 기록해 보세요!
        </td>
      </tr>
    `;
    return;
  }

  g.history.forEach(item => {
    const tr = document.createElement('tr');
    const isGrad = item.type === 'GRADUATE';
    const badge = isGrad
      ? `<span style="color:#d97706; font-weight:800;">🏆 사이클 익절 졸업!</span>`
      : `<span style="color:var(--accent-green); font-weight:700;">🟢 정기 분할매수</span>`;

    if (editingGrowthId === item.id) {
      tr.innerHTML = `
        <td><input type="date" id="edit-g-date-${item.id}" class="inline-edit-input" value="${getTradeDate(item)}" /></td>
        <td>${badge}</td>
        <td><input type="number" id="edit-g-price-${item.id}" class="inline-edit-input" step="0.01" value="${item.price}" /></td>
        <td><input type="number" id="edit-g-shares-${item.id}" class="inline-edit-input" step="0.01" value="${item.shares}" /></td>
        <td>
          ${isGrad
            ? `<input type="number" id="edit-g-amount-${item.id}" class="inline-edit-input" step="0.01" value="${item.amount}" />`
            : `<span style="color:var(--text-muted);font-size:0.8rem;">저장 시 자동계산</span>`}
        </td>
        <td><input type="text" id="edit-g-memo-${item.id}" class="inline-edit-input" value="${escapeHTML(item.memo)}" /></td>
        <td>
          <div class="action-btn-group">
            <button type="button" class="btn-save-inline" onclick="saveEditGrowthHistory(${item.id})">💾 저장</button>
            <button type="button" class="btn-cancel-inline" onclick="cancelEditGrowthHistory()">취소</button>
          </div>
        </td>
      `;
    } else {
      tr.innerHTML = `
        <td>${escapeHTML(displayTradeDate(item))}</td>
        <td>${badge}</td>
        <td><strong>${formatUSD(item.price)}</strong></td>
        <td>${item.shares}주</td>
        <td><strong>${isGrad ? formatSignedUSD(item.amount) : formatUSD(item.amount)}</strong></td>
        <td>${escapeHTML(item.memo) || '-'}</td>
        <td>
          <div class="action-btn-group">
            <button type="button" class="btn-edit" onclick="startEditGrowthHistory(${item.id})">✏️ 수정</button>
            <button type="button" class="btn-delete" onclick="deleteGrowthHistory(${item.id})">삭제</button>
          </div>
        </td>
      `;
    }
    hTbody.appendChild(tr);
  });
}

// =========================================================================
// [과거 검증] 상장 이후 일봉으로 앱 규칙을 백테스트 (엔진은 backtest.js)
// =========================================================================
const BT_HISTORY_STORAGE_PREFIX = 'bt_history_v1_'; // 백업 코드에 넣지 않는 기기별 캐시
const BT_HISTORY_TTL_MS = 12 * 60 * 60 * 1000;
const BT_HISTORY_TIMEOUT_MS = 30000;
const btHistory = {}; // ticker → { at, source, bars }
const btResults = { rotation: {}, alternatives: {}, split: {} }; // ticker → { key, result }
const BT_BASE_TICKER = { SOXL: 'SOXX', TQQQ: 'QQQ' }; // 대안 비교용 같은 지수의 1배 ETF
const btLoading = {};
let btRotationTimer = null;

function readBacktestHistoryCache(ticker) {
  if (btHistory[ticker]) return btHistory[ticker];
  try {
    const raw = localStorage.getItem(BT_HISTORY_STORAGE_PREFIX + ticker);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.bars) || parsed.bars.length < 300) return null;
    const bars = parsed.bars.map(([d, o, h, l, c]) => ({ d, o, h, l, c }));
    btHistory[ticker] = { at: Number(parsed.at) || 0, source: parsed.source || '', bars };
    return btHistory[ticker];
  } catch (e) {
    return null;
  }
}

function writeBacktestHistoryCache(ticker, entry) {
  btHistory[ticker] = entry;
  try {
    const compact = entry.bars.map(b => [b.d, ...[b.o, b.h, b.l, b.c].map(v => Number(v.toPrecision(6)))]);
    localStorage.setItem(BT_HISTORY_STORAGE_PREFIX + ticker, JSON.stringify({ at: entry.at, source: entry.source, bars: compact }));
  } catch (e) {
    // 저장 공간이 부족해도 이번 세션 메모리 캐시로는 계속 쓴다
  }
}

function cleanHistoryBars(bars) {
  const out = bars
    .filter(b => b.d && [b.o, b.h, b.l, b.c].every(v => Number.isFinite(v) && v > 0))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  return out.filter((b, i) => i === 0 || b.d !== out[i - 1].d);
}

async function fetchBacktestHistory(ticker) {
  const apiKey = getQuoteApiKey();
  let twelveError = null;
  if (apiKey) {
    try {
      const series = await fetchTwelveJson(`time_series?symbol=${encodeURIComponent(ticker)}&interval=1day&outputsize=5000`, apiKey);
      const bars = cleanHistoryBars((series.values || []).map(v => ({
        d: String(v.datetime).slice(0, 10), o: Number(v.open), h: Number(v.high), l: Number(v.low), c: Number(v.close)
      })));
      if (bars.length >= 300) return { at: Date.now(), source: 'Twelve Data', bars };
      twelveError = '일봉 데이터 부족';
    } catch (e) {
      twelveError = e.message;
    }
  }

  const period2 = Math.floor(Date.now() / 1000);
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=0&period2=${period2}`;
  try {
    const result = await fetchYahooChartViaProxies(yahooUrl, BT_HISTORY_TIMEOUT_MS);
    const q = result.indicators.quote[0];
    const bars = cleanHistoryBars((result.timestamp || []).map((ts, i) => ({
      d: new Date(ts * 1000).toISOString().slice(0, 10),
      o: Number(q.open[i]), h: Number(q.high[i]), l: Number(q.low[i]), c: Number(q.close[i])
    })));
    if (bars.length < 300) throw new Error('일봉 데이터 부족');
    return { at: Date.now(), source: 'Yahoo(무료 경로)', bars };
  } catch (e) {
    throw new Error(twelveError ? `Twelve Data: ${twelveError} / 무료 경로 응답 없음` : '무료 경로 응답 없음 · 🔑 시세 키를 등록하면 안정적으로 받을 수 있습니다');
  }
}

// allowNetwork가 false면 이 기기에 저장된 일봉만 쓴다 (자동 갱신이 API 한도를 쓰지 않도록)
async function loadBacktestHistory(ticker, allowNetwork) {
  const cached = readBacktestHistoryCache(ticker);
  if (cached && (!allowNetwork || Date.now() - cached.at < BT_HISTORY_TTL_MS)) return cached;
  if (!allowNetwork) return null;
  try {
    const fresh = await fetchBacktestHistory(ticker);
    writeBacktestHistoryCache(ticker, fresh);
    return fresh;
  } catch (e) {
    if (cached) return cached; // 받아오지 못하면 예전에 받은 일봉으로라도 검증
    throw e;
  }
}

function formatBtPct(v, digits = 0) {
  return v == null || !Number.isFinite(v) ? '-' : `${v.toFixed(digits)}%`;
}

function formatBtSignedPct(ratio, digits = 1) {
  if (ratio == null || !Number.isFinite(ratio)) return '-';
  const v = ratio * 100;
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}

function btDataLine(entry) {
  const bars = entry.bars;
  const fetched = entry.at ? new Date(entry.at).toLocaleDateString('ko-KR') : '-';
  return `데이터: ${escapeHTML(entry.source)} 일봉 ${bars[0].d} ~ ${bars[bars.length - 1].d} (${bars.length.toLocaleString()}거래일 · ${fetched} 받음)`;
}

async function runBacktestWithHistory(kind, allowNetwork) {
  const ticker = appState.currentTicker;
  const box = document.getElementById(kind === 'rotation' ? 'bt-rotation-result' : 'bt-split-result');
  if (!box) return;
  if (allowNetwork) {
    if (btLoading[ticker]) return;
    btLoading[ticker] = true;
    box.innerHTML = `<div class="bt-placeholder">⏳ ${ticker} 상장 이후 일봉을 받아오는 중입니다... (최대 30초)</div>`;
  }
  try {
    await loadBacktestHistory(ticker, allowNetwork);
    if (ticker !== appState.currentTicker) return;
    // 일봉은 두 검증이 같이 쓰므로 양쪽을 모두 다시 그린다 (40분할 쪽은 복리 시뮬레이터도 함께 갱신)
    renderRotationBacktest();
    recalcGrowthMode(false);
  } catch (e) {
    if (ticker === appState.currentTicker) {
      box.innerHTML = `<div class="bt-placeholder bt-error">⚠️ 과거 일봉을 받지 못했습니다: ${escapeHTML(e.message)}</div>`;
    }
  } finally {
    if (allowNetwork) btLoading[ticker] = false;
  }
}

function runRotationBacktest() {
  runBacktestWithHistory('rotation', true);
}

// 대안 비교는 1배 ETF 일봉도 필요하다 (Twelve Data 키가 있으면 최대 2회 조회)
async function runAlternativesBacktest() {
  const ticker = appState.currentTicker;
  const base = BT_BASE_TICKER[ticker];
  const box = document.getElementById('bt-alt-result');
  const loadingKey = `${ticker}:alt`;
  if (!box || btLoading[loadingKey]) return;
  btLoading[loadingKey] = true;
  box.innerHTML = `<div class="bt-placeholder">⏳ ${ticker}·${base} 상장 이후 일봉을 받아오는 중입니다... (최대 1분)</div>`;
  try {
    await loadBacktestHistory(ticker, true);
    await loadBacktestHistory(base, true);
    if (ticker !== appState.currentTicker) return;
    renderRotationBacktest();
  } catch (e) {
    if (ticker === appState.currentTicker) {
      box.innerHTML = `<div class="bt-placeholder bt-error">⚠️ 과거 일봉을 받지 못했습니다: ${escapeHTML(e.message)}</div>`;
    }
  } finally {
    btLoading[loadingKey] = false;
  }
}

function renderAlternativesBacktest(p) {
  const box = document.getElementById('bt-alt-result');
  if (!box) return;
  const ticker = appState.currentTicker;
  const base = BT_BASE_TICKER[ticker];
  document.getElementById('bt-alt-intro').innerHTML =
    `같은 시작점에서 2년 동안 여러 규칙을 돌려 봅니다. 1배 ETF는 <strong>${base}</strong>입니다. 본전에 빨리 가는 쪽과 추가 하락을 덜 맞는 쪽 중 무엇을 얻고 무엇을 내주는지 비교해 보세요.`;

  const history = readBacktestHistoryCache(ticker);
  const baseHistory = readBacktestHistoryCache(base);
  if (!history || !baseHistory) {
    box.innerHTML = `<div class="bt-placeholder"><strong>📊 대안과 비교</strong>를 누르면 ${history ? '' : `${ticker}와 `}${base} 일봉을 받아 비교합니다${getQuoteApiKey() ? ` (Twelve Data ${history ? 1 : 2}회 조회)` : ''}.</div>`;
    return;
  }

  const crashDrawdown = p.crashOnly ? 0.45 : 0;
  const key = JSON.stringify([history.at, baseHistory.at, p.up, p.drop, p.ratio, crashDrawdown, p.breakevenMultiple.toFixed(3)]);
  let cached = btResults.alternatives[ticker];
  if (!cached || cached.key !== key) {
    cached = {
      key,
      result: btAlternativesStudy(history.bars, baseHistory.bars, {
        up: p.up, drop: p.drop, ratio: p.ratio, crashDrawdown, breakevenMultiple: p.breakevenMultiple
      })
    };
    btResults.alternatives[ticker] = cached;
  }
  const r = cached.result;
  if (!r.n) {
    box.innerHTML = `<div class="bt-placeholder">2년 이상 지난 시작점이 없어 비교할 수 없습니다.</div>`;
    return;
  }

  const withBreakeven = r.breakevenMultiple > 0;
  // 화면에 보이는 자릿수로 반올림해 비교해야 같은 값으로 보이는 칸이 함께 강조된다
  const shown = {
    breakevenPct: v => Math.round(v),
    medianBreakevenDays: v => Math.round(v),
    medianDrawdown: v => Math.round(v * 100)
  };
  const bestOf = (key, pick) => pick(...r.rules.map(x => x[key]).filter(v => v != null).map(shown[key]));
  const bestReach = withBreakeven ? bestOf('breakevenPct', Math.max) : null;
  const bestDays = withBreakeven ? bestOf('medianBreakevenDays', Math.min) : null;
  const bestDd = bestOf('medianDrawdown', Math.max);
  const mark = (key, v, best, text) => `<td${v != null && shown[key](v) === best ? ' class="bt-best"' : ''}>${text}</td>`;
  const vsHold = (rule, ratio) => rule.id === 'hold' ? '기준' : formatBtSignedPct(ratio - 1);

  const rowsHTML = r.rules.map(x => `
    <tr>
      <td><strong>${x.label}</strong><br/><small class="bt-rule-desc">${x.desc}</small></td>
      <td>${vsHold(x, x.ratio1y)}</td>
      <td>${vsHold(x, x.ratio2y)}</td>
      <td>${x.id === 'hold' ? '-' : formatBtPct(x.beat2yPct)}</td>
      ${withBreakeven ? mark('breakevenPct', x.breakevenPct, bestReach, formatBtPct(x.breakevenPct)) : ''}
      ${withBreakeven ? mark('medianBreakevenDays', x.medianBreakevenDays, bestDays, x.medianBreakevenDays == null ? '-' : `${Math.round(x.medianBreakevenDays)}일`) : ''}
      ${mark('medianDrawdown', x.medianDrawdown, bestDd, `${formatBtSignedPct(x.medianDrawdown, 0)} / ${formatBtSignedPct(x.worstDrawdown, 0)}`)}
    </tr>`).join('');

  box.innerHTML = `
    <div class="table-responsive">
      <table class="bt-table">
        <thead>
          <tr>
            <th>규칙</th>
            <th>1년 뒤 자산 (보유 대비)</th>
            <th>2년 뒤 자산 (보유 대비)</th>
            <th>2년 뒤 보유보다 나은 비율</th>
            ${withBreakeven ? `<th>2년 안 본전(+${((r.breakevenMultiple - 1) * 100).toFixed(0)}%) 도달</th><th>도달까지 거래일 (중앙값)</th>` : ''}
            <th>시작 후 추가 낙폭 (중앙값 / 최악)</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
    <div class="bt-notes">
      <div>자산 비율은 중앙값입니다. 초록색은 그 열에서 가장 나은 값입니다. 시작점 ${r.n.toLocaleString()}일 (${r.from} ~ ${r.to}, 끝까지 2년이 남은 날만).</div>
      <div>200일선 규칙은 전일 종가로 판단해 그날 종가에 옮긴다고 가정했고, 옮길 때마다 매도·매수 수수료(편도 0.1%)를 뺐습니다. 세금은 반영하지 않았습니다. 과거에는 폭락이 모두 회복해 보유가 유리했지만, 이번에도 회복한다는 보장은 없습니다.</div>
    </div>
  `;
}

function runSplitBacktest() {
  runBacktestWithHistory('split', true);
}

// 시뮬레이터 슬라이더를 움직일 때마다 다시 계산 (계산은 수십 ms라 짧게 모아서 한 번만)
function scheduleRotationBacktest() {
  clearTimeout(btRotationTimer);
  btRotationTimer = setTimeout(renderRotationBacktest, 250);
}

function getRotationBacktestParams(t) {
  const cur = t.currentPrice;
  const sellPrice = parseFloat(document.getElementById('sim-sell-price').value) || t.autoSellTarget1 || cur;
  const buyPrice = parseFloat(document.getElementById('sim-buy-price').value) || 0;
  const dropSlider = (parseFloat(document.getElementById('drop-ratio-slider').value) || 10) / 100;
  const up = Math.min(1, Math.max(0.01, cur > 0 ? sellPrice / cur - 1 : 0.09));
  const drop = buyPrice > 0 && buyPrice < sellPrice ? Math.min(0.9, Math.max(0.01, 1 - buyPrice / sellPrice)) : dropSlider;
  const ratio = (parseFloat(document.getElementById('sell-ratio-slider').value) || 20) / 100;
  const timeout = parseInt(document.getElementById('bt-rot-timeout').value, 10) || 0;
  const crashOnly = document.getElementById('bt-rot-start').value === 'crash';
  const totalPrincipal = getTotalPrincipal(t) || (t.shares * t.avgPrice);
  const breakeven = t.shares > 0 ? Math.max(0, totalPrincipal - (t.reservedCash || 0)) / t.shares : 0;
  const breakevenMultiple = cur > 0 && breakeven > cur ? breakeven / cur : 0;
  return { up, drop, ratio, timeout, crashOnly, breakevenMultiple };
}

function renderRotationBacktest() {
  const box = document.getElementById('bt-rotation-result');
  if (!box) return;
  const ticker = appState.currentTicker;
  const t = appState.tickers[ticker];
  const p = getRotationBacktestParams(t);
  const ruleText = `규칙: 현재가 대비 <strong>+${(p.up * 100).toFixed(1)}%</strong> 반등에 보유의 <strong>${Math.round(p.ratio * 100)}%</strong> 매도 → 매도가 대비 <strong>-${(p.drop * 100).toFixed(1)}%</strong>에 재매수` +
    (p.timeout ? ` (재매수가 ${p.timeout}거래일 안 오면 그날 종가에 재매수)` : ' (재매수가 올 때까지 대기 · 앱 기본 규칙)');
  document.getElementById('bt-rot-rule').innerHTML = ruleText;
  renderAlternativesBacktest(p);

  const history = btHistory[ticker] || readBacktestHistoryCache(ticker);
  if (!history) {
    box.innerHTML = `<div class="bt-placeholder">아직 검증 전입니다. <strong>📊 과거 일봉으로 검증</strong>을 누르면 ${ticker} 상장 이후 일봉을 한 번 받아 이 기기에 저장합니다${getQuoteApiKey() ? ' (Twelve Data 1회 조회)' : ''}.</div>`;
    return;
  }

  const key = JSON.stringify([history.at, p.up, p.drop, p.ratio, p.timeout, p.crashOnly, p.breakevenMultiple.toFixed(3)]);
  let cachedResult = btResults.rotation[ticker];
  if (!cachedResult || cachedResult.key !== key) {
    cachedResult = {
      key,
      result: btRotationStudy(history.bars, {
        up: p.up, drop: p.drop, ratio: p.ratio, timeout: p.timeout,
        crashDrawdown: p.crashOnly ? 0.45 : 0,
        breakevenMultiple: p.breakevenMultiple
      })
    };
    btResults.rotation[ticker] = cachedResult;
  }
  const r = cachedResult.result;
  const [h1, h2] = r.horizons;
  const startLabel = p.crashOnly ? '직전 1년 최고 종가 대비 -45% 이하로 떨어진 날' : '상장 1년 뒤부터 모든 거래일';

  if (!h1 || !h1.n) {
    box.innerHTML = `<div class="bt-placeholder">${startLabel}이 1년 이상 지난 시작점이 없어 비교할 수 없습니다.<br/><small>${btDataLine(history)}</small></div>`;
    return;
  }

  const median = h1.medianRatio;
  const verdict = median < 0.99
    ? { cls: 'bt-verdict-bad', text: `⚠️ 과거에는 이 규칙보다 <strong>그냥 보유하는 쪽이 대체로 나았습니다.</strong> 1년 뒤 회전 쪽 자산이 보유 대비 중앙값 ${formatBtSignedPct(median - 1)}였습니다.` }
    : median > 1.01
      ? { cls: 'bt-verdict-good', text: `✅ 과거에는 이 규칙이 보유보다 나은 경우가 많았습니다. 1년 뒤 회전 쪽 자산이 보유 대비 중앙값 ${formatBtSignedPct(median - 1)}였습니다.` }
      : { cls: 'bt-verdict-flat', text: `➖ 과거에는 보유와 큰 차이가 없었습니다 (1년 뒤 중앙값 ${formatBtSignedPct(median - 1)}).` };

  const horizonItem = (h, label) => !h || !h.n ? '' : `
    <div class="diag-item">
      <span class="diag-label">${label} 회전이 보유보다 나았던 비율</span>
      <strong class="diag-value">${formatBtPct(h.beatPct)}</strong>
      <span class="diag-sub">자산 비율 중앙값 ${h.medianRatio.toFixed(3)} · 그 시점에 재매수를 못 해 현금이 묶여 있던 비율 ${formatBtPct(h.stuckPct)} (${h.n.toLocaleString()}개 시작점)</span>
    </div>`;

  let breakevenHTML = '';
  const be = r.breakeven;
  if (be && be.n) {
    const needed = (be.multiple - 1) * 100;
    breakevenHTML = `
      <div class="diag-item highlight-diag">
        <span class="diag-label">지금 본전까지 +${needed.toFixed(0)}% 필요 · 과거 같은 상승을 기다렸다면</span>
        <strong class="diag-value">회전이 먼저 도달 ${formatBtPct(be.rotFasterPct)}</strong>
        <span class="diag-sub">본전 도달: 보유 ${be.holdReached}/${be.n} · 회전 ${be.rotReached}/${be.n} · 걸린 거래일 중앙값 보유 ${be.medianHoldDays ?? '-'} / 회전 ${be.medianRotDays ?? '-'}</span>
      </div>`;
  }

  box.innerHTML = `
    <div class="bt-verdict ${verdict.cls}">${verdict.text}</div>
    <div class="diagnosis-box">
      ${horizonItem(h1, '1년 뒤')}
      ${horizonItem(h2, '2년 뒤')}
      ${breakevenHTML}
    </div>
    <div class="bt-notes">
      <div>시작점: ${startLabel} ${r.startCount.toLocaleString()}일 · 서로 겹치지 않는 하락 구간은 약 <strong>${r.episodes.length}번</strong>뿐이라 통계적 증명이 아닌 방향성으로 보세요.</div>
      <div>회전이 지는 주된 이유: 팔고 난 뒤 눌림목이 오지 않고 계속 오르면 현금이 묶인 채 회복을 놓칩니다. 위 '재매수 대기 한도'를 바꿔 비교해 보세요.</div>
      <div>${btDataLine(history)} · 수수료 편도 0.1%, 지정가는 고가·저가가 닿은 날 체결 가정, 세금 미반영. 과거 결과가 미래를 보장하지 않습니다.</div>
    </div>
  `;
}

function getSplitBacktestResult(ticker) {
  const history = btHistory[ticker] || readBacktestHistoryCache(ticker);
  if (!history) return null;
  const g = appState.tickers[ticker].growth;
  const opts = { splits: g.splits || 40, target: (g.targetProfitPct || 10) / 100 };
  const key = JSON.stringify([history.at, opts.splits, opts.target]);
  let cached = btResults.split[ticker];
  if (!cached || cached.key !== key) {
    cached = { key, opts, history, result: btSplitStudy(history.bars, opts) };
    btResults.split[ticker] = cached;
  }
  return cached;
}

function renderSplitBacktest() {
  const box = document.getElementById('bt-split-result');
  if (!box) return;
  const ticker = appState.currentTicker;
  const g = appState.tickers[ticker].growth;
  document.getElementById('bt-split-rule').innerHTML =
    `규칙: 현재 설정 <strong>${g.splits || 40}분할 · +${g.targetProfitPct || 10}% 졸업</strong>, 졸업 수익은 다음 사이클 시드에 합산(복리). RSI 부스터를 쓴 경우·안 쓴 경우·그냥 보유를 함께 비교합니다.`;

  const cached = getSplitBacktestResult(ticker);
  if (!cached) {
    box.innerHTML = `<div class="bt-placeholder">아직 검증 전입니다. <strong>📊 과거 일봉으로 검증</strong>을 누르면 ${ticker} 상장 이후 일봉을 한 번 받아 이 기기에 저장합니다${getQuoteApiKey() ? ' (Twelve Data 1회 조회)' : ''}.</div>`;
    return;
  }
  const { result, history } = cached;
  const all = result.overall;
  if (!all) {
    box.innerHTML = `<div class="bt-placeholder">검증할 기간(최소 1년)이 부족합니다.<br/><small>${btDataLine(history)}</small></div>`;
    return;
  }

  const p = all.plain;
  const boosterWorseYears = result.rows.filter(r => r.booster.cagr < r.plain.cagr).length;
  const cagrs = result.rows.map(r => r.plain.cagr);
  const rowsHTML = result.rows.map(r => {
    const best = Math.max(r.plain.cagr, r.booster.cagr, r.plain.holdCagr);
    const cell = v => `<td${v === best ? ' class="bt-best"' : ''}>${formatBtSignedPct(v)}</td>`;
    return `
      <tr>
        <td><strong>${r.startDate.slice(0, 4)}년</strong></td>
        ${cell(r.plain.cagr)}
        ${cell(r.booster.cagr)}
        ${cell(r.plain.holdCagr)}
        <td>${formatBtSignedPct(r.plain.mdd, 0)} / ${formatBtSignedPct(r.plain.holdMdd, 0)}</td>
        <td>${r.plain.cyclesPerYear.toFixed(1)}회 · ${formatBtSignedPct(r.plain.avgCycleProfit)}</td>
        <td>${r.plain.maxStuckDays.toLocaleString()}일</td>
      </tr>`;
  }).join('');

  box.innerHTML = `
    <div class="diagnosis-box">
      <div class="diag-item">
        <span class="diag-label">졸업 1회 평균 순수익 (시드 대비)</span>
        <strong class="diag-value">${formatBtSignedPct(p.avgCycleProfit)}</strong>
        <span class="diag-sub">연평균 ${p.cyclesPerYear.toFixed(1)}회 졸업 · 졸업까지 중앙값 ${p.medianCycleDays ?? '-'}거래일 (앱 기본 가정은 1회 +${((g.targetProfitPct || 10) * 0.55).toFixed(1)}%, 연 6회)</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">연복리 (시작 연도에 따라)</span>
        <strong class="diag-value">${formatBtSignedPct(Math.min(...cagrs), 0)} ~ ${formatBtSignedPct(Math.max(...cagrs), 0)}</strong>
        <span class="diag-sub">상장 초부터 시작: 40분할 ${formatBtSignedPct(p.cagr)} · 그냥 보유 ${formatBtSignedPct(p.holdCagr)}</span>
      </div>
      <div class="diag-item highlight-diag">
        <span class="diag-label">버텨야 했던 최악의 구간</span>
        <strong class="diag-value">낙폭 ${formatBtSignedPct(p.mdd, 0)}</strong>
        <span class="diag-sub">시드를 다 쓰고 졸업만 기다린 최장 ${p.maxStuckDays.toLocaleString()}거래일(약 ${(p.maxStuckDays / BT_YEAR_BARS).toFixed(1)}년) · 이런 소진 ${p.stuckEpisodes}번</span>
      </div>
    </div>
    <div class="bt-verdict ${boosterWorseYears > result.rows.length / 2 ? 'bt-verdict-bad' : 'bt-verdict-flat'}">
      RSI 부스터는 시작 연도 ${result.rows.length}개 중 <strong>${boosterWorseYears}개</strong>에서 연복리를 낮췄습니다.
    </div>
    <div class="table-responsive">
      <table class="bt-table">
        <thead>
          <tr>
            <th>시작</th>
            <th>40분할 연복리</th>
            <th>+ RSI 부스터</th>
            <th>그냥 보유</th>
            <th>최대 낙폭 (40분할 / 보유)</th>
            <th>졸업 횟수/년 · 1회 수익</th>
            <th>최장 갇힘</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
    <div class="bt-notes">
      <div>각 행은 그 해 첫 거래일에 시작해 데이터 끝(${result.to})까지 운용한 결과입니다. 데이터 끝에 아직 갇혀 있는 사이클은 평가손익으로 계산합니다.</div>
      <div>${btDataLine(history)} · 수수료 편도 0.1%, LOC는 종가 체결, 소수점 수량, 양도세 22% 미반영. 2010년 이후는 기술주 강세장이었고 과거 결과가 미래를 보장하지 않습니다.</div>
    </div>
  `;
}

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

// 입금·인출 기록은 주식 수 없이 금액(price 필드)만 쓴다
function isCashLogType(type) {
  return type === 'DEPOSIT' || type === 'WITHDRAW';
}

function toggleLogTypeHint() {
  const type = document.getElementById('log-type').value;
  const memoInput = document.getElementById('log-memo');
  const cashType = isCashLogType(type);
  document.getElementById('log-price-label').textContent = cashType ? '금액 ($)' : '체결 가격 ($)';
  document.getElementById('log-price').placeholder = cashType ? '예: 5000' : '예: 50.10';
  document.getElementById('log-shares-group').style.display = cashType ? 'none' : '';
  document.getElementById('log-shares').required = !cashType;
  if (type === 'SELL') {
    memoInput.placeholder = '예: $45.0 이하에서 재매수 대기';
  } else if (type === 'DEPOSIT') {
    memoInput.placeholder = '예: 월급에서 추가 투입';
  } else if (type === 'WITHDRAW') {
    memoInput.placeholder = '예: 생활비로 일부 인출';
  } else {
    memoInput.placeholder = '예: 확보 현금으로 저점 재매수 완료!';
  }
}

function addTradeLog(e) {
  e.preventDefault();
  const t = appState.tickers[appState.currentTicker];
  const type = document.getElementById('log-type').value;
  const price = parseFloat(document.getElementById('log-price').value);
  const shares = isCashLogType(type) ? 1 : parseFloat(document.getElementById('log-shares').value);
  const memo = document.getElementById('log-memo').value.trim();
  const tradeDate = document.getElementById('log-date').value || todayISO();

  if (!price || !shares || price <= 0 || shares <= 0) return;

  ensurePrincipalAnchor(t);

  if (type === 'SELL' && shares > t.shares) {
    alert('현재 보유 주식 수보다 많이 매도할 수 없습니다.');
    return;
  }
  if (type === 'WITHDRAW' && price > (t.reservedCash || 0)) {
    alert(`보유 구출 현금(${formatUSD(t.reservedCash || 0)})보다 많이 인출할 수 없습니다.`);
    return;
  }

  const amount = Number((price * shares).toFixed(2));

  t.logs.unshift({
    id: Date.now(),
    tradeDate,
    type,
    price,
    shares,
    amount,
    memo
  });

  recalculateRescueBalanceFromLogs(t);

  document.getElementById('log-price').value = '';
  document.getElementById('log-shares').value = '';
  document.getElementById('log-memo').value = '';

  saveState();
  populateInputsFromState();
  recalcAll(false);
}

function startEditLog(id) {
  editingLogId = id;
  renderLogs();
}

function cancelEditLog() {
  editingLogId = null;
  renderLogs();
}

function saveEditLog(id) {
  const t = appState.tickers[appState.currentTicker];
  const item = t.logs.find(l => l.id === id);
  if (!item) return;

  const newType = document.getElementById(`edit-log-type-${id}`)?.value || item.type;
  const newPrice = parseFloat(document.getElementById(`edit-log-price-${id}`)?.value);
  const newShares = isCashLogType(newType) ? 1 : parseFloat(document.getElementById(`edit-log-shares-${id}`)?.value);
  const newMemo = document.getElementById(`edit-log-memo-${id}`)?.value.trim() || '';
  const newDate = document.getElementById(`edit-log-date-${id}`)?.value;

  if (!newPrice || !newShares || newPrice <= 0 || newShares <= 0) {
    alert('올바른 체결 가격(금액)과 수량을 입력해 주세요.');
    return;
  }

  if (newDate) item.tradeDate = newDate;
  item.type = newType;
  item.price = newPrice;
  item.shares = newShares;
  item.amount = Number((newPrice * newShares).toFixed(2));
  item.memo = newMemo;

  editingLogId = null;
  recalculateRescueBalanceFromLogs(t);
  saveState();
  populateInputsFromState();
  recalcAll(false);
}

function deleteLog(id) {
  const t = appState.tickers[appState.currentTicker];
  t.logs = t.logs.filter(item => item.id !== id);
  if (editingLogId === id) editingLogId = null;
  recalculateRescueBalanceFromLogs(t);
  saveState();
  populateInputsFromState();
  recalcAll(false);
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

function renderLogs() {
  const t = appState.tickers[appState.currentTicker];
  const tbody = document.getElementById('log-tbody');
  const alertBox = document.getElementById('active-sell-alert');
  const overviewMissionBox = document.getElementById('overview-next-mission-box');
  tbody.innerHTML = '';

  const strategy = buildPersonalizedStrategyHTML(t);
  if (alertBox) {
    alertBox.className = `mission-briefing-card ${strategy.stageClass}`;
    alertBox.style.display = 'block';
    alertBox.innerHTML = strategy.html;
  }
  if (overviewMissionBox) {
    overviewMissionBox.className = `mission-briefing-card ${strategy.stageClass}`;
    overviewMissionBox.innerHTML = strategy.html;
  }

  if (!t.logs || t.logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">
          아직 기록된 구출 작전 내역이 없습니다. 반등 시 일부 매도하거나 재매수했을 때 기록해 보세요!
        </td>
      </tr>
    `;
    return;
  }

  t.logs.forEach(item => {
    const tr = document.createElement('tr');
    const isSell = item.type === 'SELL';
    const isCash = isCashLogType(item.type);
    const badge = {
      SELL: `<span style="color: var(--accent-red); font-weight: 700;">🔴 일부 매도</span>`,
      BUY: `<span style="color: var(--accent-green); font-weight: 700;">🟢 저점 재매수</span>`,
      DEPOSIT: `<span style="color: var(--accent-blue); font-weight: 700;">💵 외부 자금 입금</span>`,
      WITHDRAW: `<span style="color: #b45309; font-weight: 700;">🏧 구출 현금 인출</span>`
    }[item.type];
    const typeOptions = [
      ['SELL', '🔴 일부 매도'], ['BUY', '🟢 저점 재매수'], ['DEPOSIT', '💵 외부 자금 입금'], ['WITHDRAW', '🏧 구출 현금 인출']
    ].map(([v, label]) => `<option value="${v}" ${item.type === v ? 'selected' : ''}>${label}</option>`).join('');

    const rebuyGuide = isSell
      ? `-10%: <strong>$${(item.price * 0.9).toFixed(2)}</strong> / -15%: <strong>$${(item.price * 0.85).toFixed(2)}</strong>`
      : `-`;

    if (editingLogId === item.id) {
      tr.innerHTML = `
        <td><input type="date" id="edit-log-date-${item.id}" class="inline-edit-input" value="${getTradeDate(item)}" /></td>
        <td>
          <select id="edit-log-type-${item.id}" class="inline-edit-select">${typeOptions}</select>
        </td>
        <td><input type="number" id="edit-log-price-${item.id}" class="inline-edit-input" step="0.01" value="${item.price}" /></td>
        <td><input type="number" id="edit-log-shares-${item.id}" class="inline-edit-input" step="0.01" value="${item.shares}" /></td>
        <td><span style="color:var(--text-muted);font-size:0.8rem;">저장 시 자동계산</span></td>
        <td>${rebuyGuide}</td>
        <td><input type="text" id="edit-log-memo-${item.id}" class="inline-edit-input" value="${escapeHTML(item.memo)}" /></td>
        <td>
          <div class="action-btn-group">
            <button type="button" class="btn-save-inline" onclick="saveEditLog(${item.id})">💾 저장</button>
            <button type="button" class="btn-cancel-inline" onclick="cancelEditLog()">취소</button>
          </div>
        </td>
      `;
    } else {
      tr.innerHTML = `
        <td>${escapeHTML(displayTradeDate(item))}</td>
        <td>${badge}</td>
        <td><strong>${isCash ? '-' : formatUSD(item.price)}</strong></td>
        <td>${isCash ? '-' : `${item.shares}주`}</td>
        <td>${item.type === 'WITHDRAW' ? '-' : ''}${formatUSD(item.amount)}</td>
        <td>${rebuyGuide}</td>
        <td>${escapeHTML(item.memo) || '-'}</td>
        <td>
          <div class="action-btn-group">
            <button type="button" class="btn-edit" onclick="startEditLog(${item.id})">✏️ 수정</button>
            <button type="button" class="btn-delete" onclick="deleteLog(${item.id})">삭제</button>
          </div>
        </td>
      `;
    }
    tbody.appendChild(tr);
  });
}

// 초기 실행 및 60초마다 실시간 시세 자동 갱신
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('log-date').value = todayISO();
  document.getElementById('g-input-buy-date').value = todayISO();
  populateInputsFromState();
  switchView(appState.currentView || 'overview');
  recalcAll(false);
  recalcGrowthMode(false);
  fetchMarketDataAndAnalyze();

  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    // 화면을 보고 있지 않을 때는 프록시 호출을 쉰다
    if (!document.hidden) fetchMarketDataAndAnalyze(true);
  }, 60000);

  // 다른 앱을 보다 돌아왔을 때 시세가 오래됐으면 바로 다시 불러온다
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isQuoteFresh(appState.tickers[appState.currentTicker])) {
      fetchMarketDataAndAnalyze(true);
    }
  });
});
