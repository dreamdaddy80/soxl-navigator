const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { boot, readProjectFile } = require('./helpers/harness');

const WINTER_REGULAR = Date.UTC(2026, 11, 15, 15, 0); // 뉴욕 12/15(화) 10:00
const NEXT_DAY = Date.UTC(2026, 11, 16, 15, 0);
const sessionAt = (app, ms) => app.run(`getMarketSession(${ms})`);
const planOf = app => app.run('appState.tickers.SOXL.dailyPlan');
const soxl = app => app.run('appState.tickers.SOXL');

function setClock(app, ms) {
  app.run(`Date.now = () => ${ms}`);
}

function setQuote(app, price, ms = WINTER_REGULAR, prevClose = 44) {
  app.run(`Object.assign(appState.tickers.SOXL, { currentPrice: ${price}, prevClose: ${prevClose}, lastQuoteAt: ${ms}, sma5: 0, sma20: 0, recentHigh: 0, dayHigh: ${price}, dayLow: ${price} })`);
}

function appReady(options) {
  const app = boot(options);
  setClock(app, WINTER_REGULAR);
  setQuote(app, 45);
  return app;
}

function fill(app, price, shares) {
  app.run('openTodayPanel("fill")');
  app.els['today-fill-price'] = { value: String(price) };
  app.els['today-fill-shares'] = { value: String(shares) };
  app.els['today-fill-date'] = { value: '2026-12-15' };
  app.run('recordTodayFill()');
}

test('장 구분: 겨울과 여름의 본장 시작이 한국시간으로 1시간 다르다', () => {
  const app = boot();
  const winter = sessionAt(app, WINTER_REGULAR);
  assert.strictEqual(winter.key, 'REGULAR');
  assert.strictEqual(new Date(winter.boundaries.REGULAR).toISOString(), '2026-12-15T14:30:00.000Z');
  const summer = sessionAt(app, Date.UTC(2026, 6, 15, 12, 0)); // 뉴욕 08:00
  assert.strictEqual(summer.key, 'PRE');
  assert.strictEqual(new Date(summer.boundaries.REGULAR).toISOString(), '2026-07-15T13:30:00.000Z');
});

test('장 구분: 애프터장과 마감, 주말을 나눈다', () => {
  const app = boot();
  assert.strictEqual(sessionAt(app, Date.UTC(2026, 11, 15, 22, 0)).key, 'AFTER');
  const friNight = sessionAt(app, Date.UTC(2026, 11, 19, 2, 0)); // 뉴욕 금 12/18 21:00
  assert.strictEqual(friNight.key, 'CLOSED');
  assert.strictEqual(friNight.tradeDay, '2026-12-21');
  assert.strictEqual(sessionAt(app, Date.UTC(2026, 11, 19, 18, 0)).tradeDay, '2026-12-21'); // 토요일
  const earlyMonday = sessionAt(app, Date.UTC(2026, 11, 21, 8, 0)); // 뉴욕 월 03:00
  assert.strictEqual(earlyMonday.key, 'CLOSED');
  assert.strictEqual(earlyMonday.tradeDay, '2026-12-21');
});

test('정규장 시간에 시세 서버가 닫혀 있으면 휴장으로 표시한다', () => {
  const app = appReady();
  app.run('marketOpenHint = false');
  assert.strictEqual(app.run('currentMarketSession().label'), '휴장');
});

test('매도 주문은 전일 종가 기준으로 정하고 시세가 움직여도 고정된다', () => {
  const app = appReady();
  app.run('renderToday()');
  assert.strictEqual(planOf(app).stage, 'SELL');
  assert.strictEqual(planOf(app).price, 47.96);
  assert.strictEqual(planOf(app).shares, 20);
  setQuote(app, 48.5);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).price, 47.96);
  assert.ok(app.els['today-order'].innerHTML.includes('주문가 이상'));
});

test('다음 거래일에는 새 주문을 만든다', () => {
  const app = appReady();
  app.run('renderToday()');
  setClock(app, NEXT_DAY);
  setQuote(app, 50, NEXT_DAY, 50);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).tradeDay, '2026-12-16');
  assert.strictEqual(planOf(app).price, 54.5);
});

test('시세가 오래됐으면 새 주문을 만들지 않고 안내한다', () => {
  const app = appReady();
  app.run(`appState.tickers.SOXL.lastQuoteAt = ${WINTER_REGULAR - 3600000}`);
  app.run('renderToday()');
  assert.strictEqual(planOf(app), null);
  assert.ok(app.els['today-order'].innerHTML.includes('시세를 확인하는 중'));
});

test('이미 정한 오늘의 주문은 시세가 잠시 끊겨도 계속 보여준다', () => {
  const app = appReady();
  app.run('renderToday()');
  app.run(`appState.tickers.SOXL.lastQuoteAt = ${WINTER_REGULAR - 3600000}`);
  app.run('renderToday()');
  assert.ok(app.els['today-order'].innerHTML.includes('47.96'));
});

test('매도 체결 → 재매수 제안 → 체결 → 늘어난 주식으로 다음 매도 제안', () => {
  const app = appReady();
  app.run('renderToday()');

  fill(app, 48, 20);
  let t = soxl(app);
  assert.strictEqual(t.shares, 80);
  assert.strictEqual(t.reservedCash, 959.04);
  assert.strictEqual(planOf(app).stage, 'REBUY');
  assert.strictEqual(planOf(app).price, 43.2);
  assert.strictEqual(planOf(app).shares, Math.floor(959.04 / (43.2 * 1.001)));
  assert.ok(app.els['today-recent'].innerHTML.includes('되돌리기'));

  fill(app, 43.2, planOf(app).shares);
  t = soxl(app);
  assert.strictEqual(t.shares, 102);
  assert.ok(t.reservedCash < 45);
  assert.strictEqual(planOf(app).stage, 'SELL');
  assert.strictEqual(planOf(app).shares, Math.round(102 * 0.2));
  assert.ok(app.els['today-order'].innerHTML.includes('2회차'));
});

test('체결 기록을 되돌리면 잔고와 제안이 돌아온다', () => {
  const app = appReady();
  app.run('renderToday()');
  fill(app, 48, 20);
  app.run('undoTodayFill()');
  assert.strictEqual(soxl(app).shares, 100);
  assert.strictEqual(soxl(app).logs.length, 0);
  assert.strictEqual(planOf(app).stage, 'SELL');
});

test('보유보다 많이 매도 체결로 기록할 수 없다', () => {
  const app = appReady();
  app.run('renderToday()');
  fill(app, 48, 500);
  assert.strictEqual(soxl(app).logs.length, 0);
});

test('재매수에 못 쓰는 잔돈만 있으면 매도 단계로 간다', () => {
  const app = boot({ saved: { tickers: { SOXL: { baseShares: 100, baseAvgPrice: 80, originalPrincipal: 8000, baseCash: 30, shares: 100, avgPrice: 80, logs: [] } } } });
  setClock(app, WINTER_REGULAR);
  setQuote(app, 45);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).stage, 'SELL');
});

test('입금으로 생긴 현금은 재매수 단계로 제안한다', () => {
  const app = boot({ saved: { tickers: { SOXL: { baseShares: 100, baseAvgPrice: 80, originalPrincipal: 8000, baseCash: 0, shares: 100, avgPrice: 80, logs: [{ id: 1, tradeDate: '2026-12-01', type: 'DEPOSIT', price: 1000, shares: 1, amount: 1000, memo: '' }] } } } });
  setClock(app, WINTER_REGULAR);
  setQuote(app, 45);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).stage, 'REBUY');
  assert.strictEqual(planOf(app).price, 39.6);
});

test('직접 조정한 주문은 그날 유지되고 다음 거래일에 풀린다', () => {
  const app = appReady();
  app.run('renderToday(); openTodayPanel("adjust")');
  app.els['today-adjust-price'] = { value: '50' };
  app.els['today-adjust-shares'] = { value: '10' };
  app.run('applyTodayAdjust()');
  assert.strictEqual(planOf(app).price, 50);
  assert.strictEqual(planOf(app).custom, 1);
  setQuote(app, 46);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).price, 50);
  setClock(app, NEXT_DAY);
  setQuote(app, 46, NEXT_DAY, 46);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).custom, 0);
});

test('입력 중에는 시세 갱신이 주문 카드를 다시 그리지 않는다', () => {
  const app = appReady();
  app.run('renderToday(); openTodayPanel("fill")');
  app.els['today-order'].innerHTML = 'typing';
  app.run('renderToday()');
  assert.strictEqual(app.els['today-order'].innerHTML, 'typing');
});

test('본전을 넘으면 주문 대신 판단 카드를 보여주고 내려오면 다시 주문한다', () => {
  const app = appReady();
  setQuote(app, 61);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).stage, 'DONE');
  setQuote(app, 55);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).stage, 'SELL');
});

test('저장 데이터: 예전 형식은 주문 없이 시작하고 잘못된 주문은 버린다', () => {
  const old = boot({ saved: { tickers: { SOXL: { shares: 500, avgPrice: 80, logs: [] } } } });
  assert.strictEqual(planOf(old), null);
  assert.strictEqual(old.run('appState.tickers.SOXL.avgPrice'), 80);
  const bad = boot({ saved: { tickers: { SOXL: { dailyPlan: { stage: 'HACK', tradeDay: '2026-12-15', ledgerKey: 'x' } } } } });
  assert.strictEqual(planOf(bad), null);
});

test('오늘의 주문은 저장했다 다시 불러와도 같다', () => {
  const app = appReady();
  app.run('renderToday()');
  const reloaded = boot({ saved: JSON.parse(app.run('JSON.stringify(appState)')) });
  assert.strictEqual(planOf(reloaded).price, 47.96);
  setClock(reloaded, WINTER_REGULAR);
  reloaded.run('renderToday()');
  assert.strictEqual(planOf(reloaded).price, 47.96);
});

test('주문을 정하기 전의 고가는 닿은 것으로 치지 않고, 그 뒤 새 고가만 알린다', () => {
  const app = appReady();
  app.run('appState.tickers.SOXL.dayHigh = 49');
  app.run('renderToday()');
  assert.ok(!app.els['today-order'].innerHTML.includes('고가'));
  app.run('appState.tickers.SOXL.dayHigh = 49.5');
  app.run('renderToday()');
  assert.ok(app.els['today-order'].innerHTML.includes('오늘 고가'));
});

test('장 마감 뒤에는 지난 일봉의 고가로 체결을 안내하지 않는다', () => {
  const closed = Date.UTC(2026, 11, 16, 3, 0); // 뉴욕 22:00
  const app = boot();
  setClock(app, closed);
  setQuote(app, 45, closed);
  app.run('renderToday()');
  app.run('appState.tickers.SOXL.dayHigh = 60');
  app.run('renderToday()');
  assert.ok(!app.els['today-order'].innerHTML.includes('오늘 고가'));
});

test('코드가 찾는 화면 요소는 모두 실제로 있다', () => {
  const dir = path.join(__dirname, '..', 'js');
  const sources = fs.readdirSync(dir).map(file => fs.readFileSync(path.join(dir, file), 'utf8'));
  const html = readProjectFile('index.html');
  const defined = id => html.includes(`id="${id}"`) || sources.some(src => src.includes(`id="${id}"`));
  const missing = new Set();
  sources.forEach(src => {
    [...src.matchAll(/getElementById\('([^'$]+)'\)/g)].forEach(m => {
      if (!defined(m[1])) missing.add(m[1]);
    });
  });
  assert.deepStrictEqual([...missing], []);
});
