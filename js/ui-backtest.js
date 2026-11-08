// 과거 검증·시나리오·대안 비교 화면

// =========================================================================
// [과거 검증] 상장 이후 일봉으로 앱 규칙을 백테스트 (엔진은 backtest.js)
// =========================================================================
const BT_HISTORY_STORAGE_PREFIX = 'bt_history_v1_'; // 백업 코드에 넣지 않는 기기별 캐시

const BT_HISTORY_TTL_MS = 12 * 60 * 60 * 1000;

const BT_HISTORY_TIMEOUT_MS = 30000;

const btHistory = {}; // ticker → { at, source, bars }

const btResults = { rotation: {}, odds: {}, alternatives: {}, split: {} }; // ticker → { key, result }

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
    throw new Error(twelveError ? `Twelve Data: ${twelveError} / 무료 경로 응답 없음` : '무료 경로 응답 없음 · 시세 키를 등록하면 안정적으로 받을 수 있습니다');
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
    box.innerHTML = `<div class="bt-placeholder">${ticker} 상장 이후 일봉을 받아오는 중입니다. (최대 30초)</div>`;
  }
  try {
    await loadBacktestHistory(ticker, allowNetwork);
    if (ticker !== appState.currentTicker) return;
    // 일봉은 두 검증이 같이 쓰므로 양쪽을 모두 다시 그린다 (40분할 쪽은 복리 시뮬레이터도 함께 갱신)
    renderRotationBacktest();
    recalcGrowthMode(false);
  } catch (e) {
    if (ticker === appState.currentTicker) {
      box.innerHTML = `<div class="bt-placeholder bt-error">과거 일봉을 받지 못했습니다: ${escapeHTML(e.message)}</div>`;
    }
  } finally {
    if (allowNetwork) btLoading[ticker] = false;
  }
}

function runRotationBacktest() {
  runBacktestWithHistory('rotation', true);
}

// 회전 1번이 갈 수 있는 네 갈래(계획대로 / 팔고 계속 오름 / 재매수 뒤 더 빠짐 / 매도 미체결)를 같은 숫자로 보여준다
function renderRotationScenarios(p) {
  const box = document.getElementById('scenario-result');
  if (!box) return;
  const ticker = appState.currentTicker;
  const t = appState.tickers[ticker];
  ensurePrincipalAnchor(t);
  const cur = t.currentPrice;
  const shares = t.shares;
  const cash = t.reservedCash || 0;
  const principal = getTotalPrincipal(t) || (shares * t.avgPrice);
  const sellPrice = parseFloat(document.getElementById('sim-sell-price').value) || t.autoSellTarget1 || cur;
  const buyPrice = parseFloat(document.getElementById('sim-buy-price').value) || sellPrice * (1 - p.drop);
  if (!(shares > 0 && cur > 0 && sellPrice > 0 && buyPrice > 0)) {
    box.innerHTML = `<div class="bt-placeholder">보유 주식과 현재가가 있어야 시나리오를 계산할 수 있습니다.</div>`;
    return;
  }

  const sold = Math.round(shares * p.ratio);
  const cashSecured = sold * sellPrice * (1 - TRADING_FEE_RATE);
  const rebuy = Math.floor(cashSecured / (buyPrice * (1 + TRADING_FEE_RATE)));
  const leftover = cashSecured - rebuy * buyPrice * (1 + TRADING_FEE_RATE);
  const paths = {
    hold: { shares, cash },
    plan: { shares: shares - sold + rebuy, cash: cash + leftover },
    soldOnly: { shares: shares - sold, cash: cash + cashSecured }
  };
  const breakevenOf = x => x.shares > 0 ? Math.max(0, principal - x.cash) / x.shares : 0;
  const valueAt = (x, price) => x.shares * price + x.cash;
  const beHold = breakevenOf(paths.hold);
  const bePlan = breakevenOf(paths.plan);
  const beSoldOnly = breakevenOf(paths.soldOnly);
  const deeperPrice = buyPrice * 0.8;
  const missAtBreakeven = valueAt(paths.hold, beHold) - valueAt(paths.soldOnly, beHold);

  // 과거 발생 빈도 (과거 검증의 '시작 시점' 설정을 따른다)
  const history = readBacktestHistoryCache(ticker);
  const up = sellPrice / cur - 1;
  const drop = 1 - buyPrice / sellPrice;
  let odds = null;
  if (history && up > 0 && drop > 0) {
    const key = JSON.stringify([history.at, up.toFixed(4), drop.toFixed(4), p.crashOnly]);
    let cached = btResults.odds[ticker];
    if (!cached || cached.key !== key) {
      cached = { key, result: btRotationOdds(history.bars, { up, drop, crashDrawdown: p.crashOnly ? 0.45 : 0 }) };
      btResults.odds[ticker] = cached;
    }
    odds = cached.result.n ? cached.result : null;
  }
  const oddsHint = history
    ? '매도가가 현재가보다 높고 재매수가가 매도가보다 낮아야 과거 빈도를 셀 수 있습니다.'
    : '과거 빈도는 과거 검증 탭에서 일봉을 받으면 표시됩니다.';

  const scenarios = [
    {
      cls: 'scenario-good',
      title: '계획대로: 매도 → 재매수 체결',
      body: `주식 ${shares.toLocaleString()}주 → <strong>${paths.plan.shares.toLocaleString()}주</strong>, 본전 주가 ${formatUSD(beHold)} → <strong>${formatUSD(bePlan)}</strong>`,
      odds: odds && `팔고 나서 20거래일 안에 재매수가 체결된 경우 ${formatBtPct(odds.rebuy20Pct)}, 60거래일 안 ${formatBtPct(odds.rebuy60Pct)}`
    },
    {
      cls: 'scenario-bad',
      title: '팔고 나서 계속 오름: 재매수 못 함',
      body: `${paths.soldOnly.shares.toLocaleString()}주 + 현금 ${formatUSD(paths.soldOnly.cash)}로 남아 본전 주가가 ${formatUSD(beHold)} → <strong>${formatUSD(beSoldOnly)}</strong>로 <strong>올라갑니다.</strong> 주가가 ${formatUSD(beHold)}까지 그대로 오르면 그냥 보유보다 <strong>${formatUSD(missAtBreakeven)}</strong> 적습니다.`,
      odds: odds && `1년이 지나도 재매수가 안 온 경우 ${formatBtPct(100 - odds.rebuy252Pct)}${odds.medianRunUpWhenMissed != null ? ` · 그동안 주가는 매도가보다 중앙값 ${formatBtSignedPct(odds.medianRunUpWhenMissed, 0)}까지 올랐습니다` : ''}`
    },
    {
      cls: 'scenario-warn',
      title: '재매수 뒤 더 빠짐',
      body: `재매수가(${formatUSD(buyPrice)})에서 -20% 더 빠져 ${formatUSD(deeperPrice)}가 되면 평가액 ${formatUSD(valueAt(paths.plan, deeperPrice))} (그냥 보유 ${formatUSD(valueAt(paths.hold, deeperPrice))}). 회전을 마친 뒤의 하락은 보유보다 불리하지 않지만, 재매수가가 바닥이라는 뜻도 아닙니다.`,
      odds: odds && `재매수 후 60거래일 안에 -10% 넘게 더 빠진 경우 ${formatBtPct(odds.deeper10Pct)}, -20% 넘게 ${formatBtPct(odds.deeper20Pct)}`
    },
    {
      cls: 'scenario-neutral',
      title: '반등 없이 하락: 매도 미체결',
      body: `매도가(${formatUSD(sellPrice)})에 닿지 않으면 아무 주문도 체결되지 않아 그냥 보유와 같습니다.`,
      odds: odds && `60거래일 안에 매도가에 닿은 경우 ${formatBtPct(odds.sellFill60Pct)}, 1년 안 ${formatBtPct(odds.sellFill252Pct)}`
    }
  ];

  const labelled = [
    [deeperPrice, '재매수가 -20%'],
    [buyPrice, '재매수가'],
    [cur, '현재가'],
    [sellPrice, '매도가'],
    [sellPrice * 1.3, '매도가 +30%'],
    [beHold, '지금 본전']
  ];
  const grid = new Map();
  labelled.forEach(([price, label]) => {
    const key = Number(price.toFixed(2));
    if (!(key > 0)) return;
    grid.set(key, [...(grid.get(key) || []), label]);
  });
  const rowsHTML = [...grid.keys()].sort((a, b) => a - b).map(price => {
    const vals = [valueAt(paths.hold, price), valueAt(paths.plan, price), valueAt(paths.soldOnly, price)];
    const best = Math.max(...vals.map(v => Math.round(v)));
    return `
      <tr>
        <td><strong>${formatUSD(price)}</strong><br/><small class="bt-rule-desc">${grid.get(price).join(' · ')}</small></td>
        ${vals.map(v => `<td${Math.round(v) === best ? ' class="bt-best"' : ''}>${formatUSD(v)}</td>`).join('')}
      </tr>`;
  }).join('');

  document.getElementById('concl-rescue-scenario').innerHTML =
    `재매수를 못 하면 본전이 <strong>${formatUSD(beHold)} → ${formatUSD(beSoldOnly)}</strong>로 올라갑니다. 계획대로 되면 ${formatUSD(bePlan)}입니다.`;

  box.innerHTML = `
    <div class="scenario-grid">
      ${scenarios.map(sc => `
        <div class="scenario-item ${sc.cls}">
          <strong class="scenario-title">${sc.title}</strong>
          <span class="scenario-body">${sc.body}</span>
          <span class="scenario-odds">${sc.odds || oddsHint}</span>
        </div>`).join('')}
    </div>
    <div class="table-responsive">
      <table class="bt-table">
        <thead>
          <tr>
            <th>그 뒤 주가</th>
            <th>그냥 보유</th>
            <th>계획대로 회전한 뒤</th>
            <th>팔고 재매수 못 한 채</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
    <div class="bt-notes">
      <div>금액은 그 가격에서의 총 평가액(주식 + 현금)입니다. '계획대로 회전한 뒤'는 재매수가까지 내려갔다가 그 가격이 된 경우입니다. 노란 칸은 그 가격에서 가장 큰 값입니다.</div>
      <div>${odds ? `과거 빈도는 ${ticker} 일봉의 시작점 ${odds.n.toLocaleString()}일(${p.crashOnly ? '폭락 후' : '모든 거래일'} · 과거 검증 탭의 '시작 시점' 설정)에서 지금과 같은 비율(+${(up * 100).toFixed(1)}% 매도, 매도가 -${(drop * 100).toFixed(1)}% 재매수)로 센 값입니다. ` : ''}과거 빈도가 앞으로의 확률을 보장하지 않습니다.</div>
    </div>
  `;
}

// 대안 비교는 1배 ETF 일봉도 필요하다 (Twelve Data 키가 있으면 최대 2회 조회)
async function runAlternativesBacktest() {
  const ticker = appState.currentTicker;
  const base = BT_BASE_TICKER[ticker];
  const box = document.getElementById('bt-alt-result');
  const loadingKey = `${ticker}:alt`;
  if (!box || btLoading[loadingKey]) return;
  btLoading[loadingKey] = true;
  box.innerHTML = `<div class="bt-placeholder">${ticker}·${base} 상장 이후 일봉을 받아오는 중입니다. (최대 1분)</div>`;
  try {
    await loadBacktestHistory(ticker, true);
    await loadBacktestHistory(base, true);
    if (ticker !== appState.currentTicker) return;
    renderRotationBacktest();
  } catch (e) {
    if (ticker === appState.currentTicker) {
      box.innerHTML = `<div class="bt-placeholder bt-error">과거 일봉을 받지 못했습니다: ${escapeHTML(e.message)}</div>`;
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
    box.innerHTML = `<div class="bt-placeholder"><strong>대안과 비교</strong>를 누르면 ${history ? '' : `${ticker}와 `}${base} 일봉을 받아 비교합니다${getQuoteApiKey() ? ` (Twelve Data ${history ? 1 : 2}회 조회)` : ''}.</div>`;
    document.getElementById('concl-rescue-alt').textContent = '아직 비교 전입니다. 대안과 비교를 누르면 결과가 여기에 요약됩니다.';
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

  const candidates = r.rules.filter(x => x.id !== 'hold' && x.ratio2y != null);
  const topRule = candidates.reduce((a, b) => (b.ratio2y > a.ratio2y ? b : a), candidates[0]);
  document.getElementById('concl-rescue-alt').innerHTML = !topRule ? '비교할 수 있는 규칙이 없습니다.' : topRule.ratio2y > 1
    ? `2년 뒤 자산 중앙값이 가장 나았던 규칙은 <strong>${topRule.label}</strong>입니다 (보유 대비 ${formatBtSignedPct(topRule.ratio2y - 1)}).`
    : `비교한 규칙 모두 2년 뒤 자산 중앙값이 그냥 보유보다 낮았습니다. 가장 가까운 규칙은 <strong>${topRule.label}</strong>입니다 (${formatBtSignedPct(topRule.ratio2y - 1)}).`;

  box.innerHTML = `
    <div class="table-responsive">
      <table class="bt-table">
        <thead>
          <tr>
            <th>규칙</th>
            <th class="col-opt">1년 뒤 자산 (보유 대비)</th>
            <th>2년 뒤 자산 (보유 대비)</th>
            <th>2년 뒤 보유보다 나은 비율</th>
            ${withBreakeven ? `<th class="col-opt">2년 안 본전(+${((r.breakevenMultiple - 1) * 100).toFixed(0)}%) 도달</th><th class="col-opt">도달까지 거래일 (중앙값)</th>` : ''}
            <th>시작 후 추가 낙폭 (중앙값 / 최악)</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
    <div class="bt-notes">
      <div>자산 비율은 중앙값입니다. 노란 칸은 그 열에서 가장 나은 값입니다. 시작점 ${r.n.toLocaleString()}일 (${r.from} ~ ${r.to}, 끝까지 2년이 남은 날만).</div>
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
  renderRotationScenarios(p);
  renderAlternativesBacktest(p);

  const history = btHistory[ticker] || readBacktestHistoryCache(ticker);
  if (!history) {
    box.innerHTML = `<div class="bt-placeholder">아직 검증 전입니다. <strong>과거 일봉으로 검증</strong>을 누르면 ${ticker} 상장 이후 일봉을 한 번 받아 이 기기에 저장합니다${getQuoteApiKey() ? ' (Twelve Data 1회 조회)' : ''}.</div>`;
    document.getElementById('concl-rescue-backtest').textContent = '아직 검증 전입니다. 과거 일봉으로 검증을 누르면 결론이 여기에 표시됩니다.';
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
  const holdBetterPct = 100 - h1.beatPct;
  const headline = h1.beatPct < 50
    ? `과거엔 그냥 보유가 ${formatBtPct(holdBetterPct)} 확률로 더 나았음`
    : `과거엔 이 회전 규칙이 ${formatBtPct(h1.beatPct)} 확률로 더 나았음`;
  document.getElementById('concl-rescue-backtest').innerHTML =
    `<strong>${headline}</strong> <span>1년 뒤 회전 쪽 자산은 보유 대비 중앙값 ${formatBtSignedPct(median - 1)}입니다.</span>`;

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
    <div class="diagnosis-box">
      ${horizonItem(h1, '1년 뒤')}
      ${horizonItem(h2, '2년 뒤')}
      ${breakevenHTML}
    </div>
    <div class="bt-notes">
      <div>시작점: ${startLabel} ${r.startCount.toLocaleString()}일 · 서로 겹치지 않는 하락 구간은 약 <strong>${r.episodes.length}번</strong>뿐이라 통계적 증명이 아닌 방향성으로 보세요.</div>
      <div>회전이 지는 주된 이유: 팔고 난 뒤 눌림목이 오지 않고 계속 오르면 현금이 묶인 채 회복을 놓칩니다. 위의 '재매수 대기 한도'를 바꿔 비교해 보세요.</div>
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

// 접힌 표에 남길 행: 첫해, 연복리 최고·최저, 최근 2개
function splitCoreRows(rows) {
  const byCagr = [...rows].sort((a, b) => a.plain.cagr - b.plain.cagr);
  const keep = new Set([rows[0], byCagr[0], byCagr[byCagr.length - 1], ...rows.slice(-2)]);
  return rows.filter(r => keep.has(r));
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
    box.innerHTML = `<div class="bt-placeholder">아직 검증 전입니다. <strong>과거 일봉으로 검증</strong>을 누르면 ${ticker} 상장 이후 일봉을 한 번 받아 이 기기에 저장합니다${getQuoteApiKey() ? ' (Twelve Data 1회 조회)' : ''}.</div>`;
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
  const coreRows = splitCoreRows(result.rows);
  const rowsHTML = (isTableExpanded('split-bt') ? result.rows : coreRows).map(r => {
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
            <th class="col-opt">최대 낙폭 (40분할 / 보유)</th>
            <th class="col-opt">졸업 횟수/년 · 1회 수익</th>
            <th class="col-opt">최장 갇힘</th>
          </tr>
        </thead>
        <tbody>${rowsHTML}</tbody>
      </table>
    </div>
    ${tableMoreHTML('split-bt', result.rows.length, coreRows.length)}
    <div class="bt-notes">
      <div>각 행은 그 해 첫 거래일에 시작해 데이터 끝(${result.to})까지 운용한 결과입니다. 데이터 끝에 아직 갇혀 있는 사이클은 평가손익으로 계산합니다.</div>
      <div>${btDataLine(history)} · 수수료 편도 0.1%, LOC는 종가 체결, 소수점 수량, 양도세 22% 미반영. 2010년 이후는 기술주 강세장이었고 과거 결과가 미래를 보장하지 않습니다.</div>
    </div>
  `;
}
