// 화면 표시 규칙: 계산값이 아니라 무엇을 어떻게 보여 주는지 확인한다
const test = require('node:test');
const assert = require('node:assert');
const { boot, syntheticBars } = require('./helpers/harness');

const WINTER_REGULAR = Date.UTC(2026, 11, 15, 15, 0); // 뉴욕 12/15(화) 10:00
const soxl = app => app.run('appState.tickers.SOXL');

const REAL_POSITION = {
  baseShares: 727, baseAvgPrice: 101, originalPrincipal: 73427, baseCash: 0, shares: 727, avgPrice: 101, currentPrice: 52.45
};

function appWith(ticker = {}, growth = {}) {
  const app = boot({ saved: { tickers: { SOXL: { ...REAL_POSITION, ...ticker, growth: { totalBudget: 73427, splits: 40, targetProfitPct: 10, history: [], ...growth } } } } });
  app.run(`Date.now = () => ${WINTER_REGULAR}`);
  app.run(`Object.assign(appState.tickers.SOXL, { currentPrice: 52.45, prevClose: 52, lastQuoteAt: ${WINTER_REGULAR}, dayHigh: 52.45, dayLow: 52.45 })`);
  return app;
}

const heldGrowth = { totalBudget: 10000, seedConfirmed: 1, heldShares: 20, avgPrice: 40, history: [{ id: 1, tradeDate: '2026-11-01', type: 'BUY', price: 40, shares: 20, amount: 800, memo: '' }] };

test('졸업 확정: 보유가 없으면 비활성이고 안내가 붙는다', () => {
  const app = appWith();
  app.run('recalcGrowthMode(false)');
  assert.strictEqual(app.els['g-graduate-btn'].disabled, true);
  assert.ok(app.els['g-graduate-hint'].textContent.includes('보유 주식이 없습니다'));
});

test('졸업 확정: 목표가 전에는 비활성, 도달하면 활성', () => {
  const app = appWith({}, heldGrowth);
  app.run('Object.assign(appState.tickers.SOXL, { currentPrice: 43, dayHigh: 43.5 }); recalcGrowthMode(false)');
  assert.strictEqual(app.els['g-graduate-btn'].disabled, true);
  assert.ok(app.els['g-graduate-hint'].textContent.includes('목표가 $44.00 도달 시 활성화'));
  app.run('appState.tickers.SOXL.currentPrice = 44; recalcGrowthMode(false)');
  assert.strictEqual(app.els['g-graduate-btn'].disabled, false);
});

test('시드: 회복 목표 원금과 같은 시드는 비워 보여 주되 저장값은 그대로 둔다', () => {
  const app = appWith();
  app.run('populateInputsFromState(); recalcGrowthMode(false)');
  assert.strictEqual(app.els['g-total-budget'].value, '');
  assert.strictEqual(app.els['g-one-unit-usd'].textContent, '-');
  assert.ok(app.els['g-seed-notice'].textContent.includes('가용 현금은 $0.00'));
  assert.ok(app.els['g-buy-orders-content'].innerHTML.includes('시드를 입력하면'));
  assert.strictEqual(soxl(app).growth.totalBudget, 73427);
});

test('시드: 입력하면 확정되고 가용 현금보다 크면 경고한다', () => {
  const app = appWith();
  app.els['g-total-budget'] = { value: '5000' };
  app.els['g-splits'] = { value: '40' };
  app.els['g-target-profit'] = { value: '10' };
  app.run('recalcGrowthMode(true)');
  assert.strictEqual(soxl(app).growth.totalBudget, 5000);
  assert.strictEqual(soxl(app).growth.seedConfirmed, 1);
  assert.strictEqual(app.els['g-one-unit-usd'].textContent, '$125.00');
  assert.strictEqual(app.els['g-seed-notice'].style.display, '');
  assert.ok(app.els['g-seed-notice'].textContent.includes('가용 현금 $0.00보다 큽니다'));
});

test('시드: 40분할 기록이 있으면 저장된 시드를 그대로 쓴다', () => {
  const app = appWith({}, { ...heldGrowth, seedConfirmed: 0, totalBudget: 73427 });
  app.run('populateInputsFromState(); recalcGrowthMode(false)');
  assert.strictEqual(app.els['g-total-budget'].value, 73427);
  assert.strictEqual(app.els['g-one-unit-usd'].textContent, '$1,835.68');
});

test('RSI 부스터면 1회분과 오늘 배정액의 차이를 옆에 설명한다', () => {
  const app = appWith({ rsi: 30.4, bbLower: 50 }, { ...heldGrowth, totalBudget: 73427, seedConfirmed: 1 });
  app.run('appState.tickers.SOXL.rsi = 30.4; recalcGrowthMode(false)');
  assert.ok(app.els['g-buy-total-budget'].textContent.includes('$2,753.51'));
  assert.ok(app.els['g-buy-budget-note'].textContent.includes('1회분 $1,835.68 × 1.5'));
  assert.ok(app.els['g-one-unit-krw'].textContent.includes('×1.5 = $2,753.51'));
});

test('체결되면 영역은 본전 변화량과 이유를 함께 보여 준다', () => {
  const app = appWith({ vrValue: 38131.15, vrNextUpdate: '2026-12-29' });
  app.run('renderToday()');
  const html = app.els['today-order'].innerHTML;
  assert.match(html, /본전 \+\$\d+\.\d\d ↑ \(손실 구간 매도로 남은 주식의 본전이 올라감\)/);
});

test('시장 위치 문구는 사실만 서술하고 행동을 권하지 않는다', () => {
  const app = appWith({ rsi: 30.4, bbLower: 52, bbUpper: 80 });
  app.run('Object.assign(appState.tickers.SOXL, { rsi: 30.4, bbLower: 52, bbUpper: 80 }); recalcAll(false)');
  const title = app.els['signal-title'].textContent;
  assert.strictEqual(title, '단기 과매도 구간 (RSI 30.4 · 볼린저 하단 근처)');
  ['유리', '타이밍입니다', '바닥'].forEach(word => assert.ok(!title.includes(word), word));
  assert.ok(!app.els['ind-rsi-status'].textContent.includes('유리'));
});

test('헤더 배지는 현재 규칙을 보여 주고 차트 안내와 같은 용어를 쓴다', () => {
  const app = appWith();
  app.run('renderToday()');
  assert.strictEqual(app.els['rule-badge'].textContent, '현재 규칙: VR');
  assert.ok(app.els['chart-rule-notice'].innerHTML.includes('<strong>반등 회전</strong>'));
  app.run('setPlanRule("ROTATION")');
  assert.strictEqual(app.els['rule-badge'].textContent, '현재 규칙: 반등 회전');
});

test('시세 출처: 시장 데이터 기준 시각을 앱 갱신 시각과 따로 표시한다', () => {
  const app = appWith();
  app.run(`Object.assign(appState.tickers.SOXL, { quoteSource: 'Twelve Data', quoteSessionKey: 'AFTER', quoteAsOfDate: '2026-11-06' })`);
  assert.strictEqual(app.run('formatQuoteAsOf(appState.tickers.SOXL)'), 'Twelve Data · 11/6(금) 애프터 마감');
  app.run('recalcAll(false)');
  assert.strictEqual(app.els['quote-source-line'].textContent, 'Twelve Data · 11/6(금) 애프터 마감');
});

test('시세 출처: 오래된 시세는 마지막 확인임을 밝힌다', () => {
  const app = appWith();
  app.run(`Object.assign(appState.tickers.SOXL, { quoteSource: 'Twelve Data', quoteSessionKey: 'CLOSE', quoteAsOfDate: '2026-11-06', lastQuoteAt: ${WINTER_REGULAR - 3600000} }); recalcAll(false)`);
  assert.ok(app.els['quote-source-line'].textContent.startsWith('마지막 확인'));
});

test('프리셋 일치: 호가 반올림 오차만 같은 값으로 본다', () => {
  const app = boot();
  assert.strictEqual(app.run('isPresetMatch(10, "10")'), true);
  assert.strictEqual(app.run('isPresetMatch("10.0", "10")'), true);
  assert.strictEqual(app.run('isPresetMatch(10.4, "10")'), false);
  assert.strictEqual(app.run('isPresetMatch(25, "20")'), false);
});

test('기록장: 졸업(전량 매도)을 폼으로 기록하면 사이클이 닫힌다', () => {
  const app = appWith({}, heldGrowth);
  app.els['g-input-type'] = { value: 'GRADUATE' };
  app.els['g-input-buy-price'] = { value: '44' };
  app.els['g-input-buy-shares'] = { value: '20' };
  app.els['g-input-buy-memo'] = { value: '' };
  app.els['g-input-buy-date'] = { value: '2026-12-10' };
  app.run('addGrowthDailyBuy({ preventDefault() {} })');
  const g = soxl(app).growth;
  assert.strictEqual(g.heldShares, 0);
  assert.strictEqual(g.cycleCount, 2);
  assert.strictEqual(g.history[0].type, 'GRADUATE');
  assert.strictEqual(g.history[0].tradeDate, '2026-12-10');
  assert.strictEqual(g.history[0].amount, Number((20 * 44 * 0.999 - 20 * 40 * 1.001).toFixed(2)));
});

test('빈 기록장에는 다음 행동 버튼이 있다', () => {
  const app = appWith();
  app.run('renderLogs(); renderGrowthCompoundAndHistory()');
  assert.ok(app.els['log-tbody'].innerHTML.includes('탈출 시뮬레이터 값 가져오기'));
  assert.ok(app.els['g-history-tbody'].innerHTML.includes('오늘 1회분 수량 채우기'));
});

test('긴 표는 핵심 행만 보이고 펼칠 수 있다', () => {
  const { bars } = syntheticBars(4000);
  const seed = boot();
  seed.run('(sym, bars) => writeBacktestHistoryCache(sym, { at: Date.now(), source: "test", bars })')('SOXL', bars);
  const store = Object.fromEntries(Object.entries(seed.store).filter(([key]) => key.startsWith('bt_history_v1_')));
  const app = boot({ store });
  app.run('appState.tickers.SOXL.growth.seedConfirmed = 1; recalcGrowthMode(false)');
  const total = app.run('getSplitBacktestResult("SOXL").result.rows.length');
  const rowCount = () => (app.els['bt-split-result'].innerHTML.match(/<tr>/g) || []).length - 1; // 머리글 제외
  assert.ok(total > 5, String(total));
  assert.ok(rowCount() <= 5);
  assert.ok(app.els['bt-split-result'].innerHTML.includes(`전체 ${total}행 보기`));
  app.run('toggleTableRows("split-bt")');
  assert.strictEqual(rowCount(), total);
  assert.strictEqual((app.els['g-compound-tbody'].innerHTML.match(/회 졸업 시/g) || []).length, 5);
});

test('시세 출처 필드가 생겨도 예전 백업과 호환된다', () => {
  const old = { tickers: { SOXL: { ...REAL_POSITION, marketSessionLabel: '🟢 최근 정규장 마감·체결 주가', logs: [] } } };
  const app = boot({ saved: old });
  assert.strictEqual(soxl(app).quoteSource, '');
  assert.strictEqual(soxl(app).shares, 727);
  const backup = app.run('JSON.stringify(appState)');
  const again = boot({ saved: JSON.parse(backup) });
  assert.strictEqual(soxl(again).originalPrincipal, 73427);
});
