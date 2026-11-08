// 시세 조회 (Twelve Data, 무료 프록시)

// 자동 조회 성공 또는 사용자가 현재가를 직접 입력한 지 10분 이내인지
function isQuoteFresh(t) {
  return Boolean(t.lastQuoteAt) && Date.now() - t.lastQuoteAt < QUOTE_STALE_MS;
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
    checkPriceAlerts(ticker, livePrice);

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
