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
  app.run('appState.tickers.SOXL.planRule = "ROTATION"');
  setClock(app, WINTER_REGULAR);
  setQuote(app, 45);
  return app;
}

function vrReady(options) {
  const app = boot(options);
  setClock(app, WINTER_REGULAR);
  setQuote(app, 45);
  app.run('renderToday()');
  return app;
}

function fill(app, price, shares, kind) {
  const orderKind = kind || planOf(app).stage;
  app.run(`openTodayPanel("fill", "${orderKind}")`);
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
  const app = boot({ saved: { tickers: { SOXL: { planRule: 'ROTATION', baseShares: 100, baseAvgPrice: 80, originalPrincipal: 8000, baseCash: 30, shares: 100, avgPrice: 80, logs: [] } } } });
  setClock(app, WINTER_REGULAR);
  setQuote(app, 45);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).stage, 'SELL');
});

test('입금으로 생긴 현금은 재매수 단계로 제안한다', () => {
  const app = boot({ saved: { tickers: { SOXL: { planRule: 'ROTATION', baseShares: 100, baseAvgPrice: 80, originalPrincipal: 8000, baseCash: 0, shares: 100, avgPrice: 80, logs: [{ id: 1, tradeDate: '2026-12-01', type: 'DEPOSIT', price: 1000, shares: 1, amount: 1000, memo: '' }] } } } });
  setClock(app, WINTER_REGULAR);
  setQuote(app, 45);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).stage, 'REBUY');
  assert.strictEqual(planOf(app).price, 39.6);
});

test('직접 조정한 주문은 그날 유지되고 다음 거래일에 풀린다', () => {
  const app = appReady();
  app.run('renderToday(); openTodayPanel("adjust", "SELL")');
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
  app.run('renderToday(); openTodayPanel("fill", "SELL")');
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
  app.run('appState.tickers.SOXL.planRule = "ROTATION"');
  setClock(app, closed);
  setQuote(app, 45, closed);
  app.run('renderToday()');
  app.run('appState.tickers.SOXL.dayHigh = 60');
  app.run('renderToday()');
  assert.ok(!app.els['today-order'].innerHTML.includes('오늘 고가'));
});

test('VR: 처음에는 평가금을 V로 잡고 현금이 없으면 매도 주문만 낸다', () => {
  const app = vrReady();
  const plan = planOf(app);
  assert.strictEqual(plan.stage, 'VR');
  assert.strictEqual(soxl(app).vrValue, 4500);
  assert.strictEqual(plan.price, 51.75);
  assert.strictEqual(plan.shares, 13);
  assert.strictEqual(plan.buyShares, 0);
  assert.strictEqual(soxl(app).vrNextUpdate, '2026-12-29');
});

test('VR: 매도 체결 뒤 같은 V로 매도·매수 주문이 함께 나온다', () => {
  const app = vrReady();
  fill(app, 51.75, 13, 'SELL');
  const plan = planOf(app);
  const cash = soxl(app).reservedCash;
  assert.strictEqual(soxl(app).shares, 87);
  assert.strictEqual(soxl(app).vrValue, 4500);
  assert.strictEqual(plan.price, Number((4500 * 1.15 / 87).toFixed(2)));
  assert.strictEqual(plan.buyPrice, Number((4500 * 0.85 / 87).toFixed(2)));
  const budget = Math.min(4500 - 87 * plan.buyPrice, cash * 0.5);
  assert.strictEqual(plan.buyShares, Math.floor(budget / (plan.buyPrice * 1.001)));
  assert.ok(app.els['today-order'].innerHTML.includes('매수'));
});

test('VR: 매수 쪽을 체결로 기록할 수 있다', () => {
  const app = vrReady();
  fill(app, 51.75, 13, 'SELL');
  const { buyPrice, buyShares } = planOf(app);
  fill(app, buyPrice, buyShares, 'REBUY');
  assert.strictEqual(soxl(app).shares, 87 + buyShares);
  assert.strictEqual(soxl(app).logs[0].type, 'BUY');
});

test('VR: 2주가 지나면 V가 현금의 1/10만큼 오르고 그 전에는 그대로다', () => {
  const app = vrReady();
  fill(app, 51.75, 13, 'SELL');
  const cash = soxl(app).reservedCash;
  const in13 = Date.UTC(2026, 11, 28, 15, 0);
  setClock(app, in13);
  setQuote(app, 45, in13);
  app.run('renderToday()');
  assert.strictEqual(soxl(app).vrValue, 4500);
  const in14 = Date.UTC(2026, 11, 29, 15, 0);
  setClock(app, in14);
  setQuote(app, 45, in14);
  app.run('renderToday()');
  assert.strictEqual(soxl(app).vrValue, Number((4500 + cash / 10).toFixed(2)));
  assert.strictEqual(soxl(app).vrNextUpdate, '2027-01-12');
});

test('VR: 시세가 움직여도 주문가는 그대로고, 저장했다 불러와도 V가 유지된다', () => {
  const app = vrReady();
  setQuote(app, 50);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).price, 51.75);
  const reloaded = boot({ saved: JSON.parse(app.run('JSON.stringify(appState)')) });
  assert.strictEqual(soxl(reloaded).vrValue, 4500);
  assert.strictEqual(planOf(reloaded).price, 51.75);
});

test('VR: 시세가 없으면 V를 정하지 않는다', () => {
  const app = boot();
  setClock(app, WINTER_REGULAR);
  app.run('renderToday()');
  assert.strictEqual(soxl(app).vrValue, 0);
  assert.strictEqual(planOf(app), null);
});

test('규칙을 바꿀 수 있고 VR로 돌아오면 V를 새로 잡는다', () => {
  const app = vrReady();
  app.run('setPlanRule("ROTATION")');
  assert.strictEqual(planOf(app).stage, 'SELL');
  setQuote(app, 40, WINTER_REGULAR, 40);
  app.run('setPlanRule("VR")');
  assert.strictEqual(planOf(app).stage, 'VR');
  assert.strictEqual(soxl(app).vrValue, 4000);
});

test('VR 기준 다시 잡기는 지금 평가금으로 V를 맞춘다', () => {
  const app = vrReady();
  setQuote(app, 42);
  app.run('resetVrBase()');
  assert.strictEqual(soxl(app).vrValue, 4200);
});

test('진행 중이던 회전의 현금은 VR 현금으로 이어진다', () => {
  const app = boot({ saved: { tickers: { SOXL: { baseShares: 100, baseAvgPrice: 80, originalPrincipal: 8000, baseCash: 0, shares: 100, avgPrice: 80, logs: [{ id: 1, tradeDate: '2026-12-01', type: 'SELL', price: 50, shares: 20, amount: 0, memo: '' }] } } } });
  setClock(app, WINTER_REGULAR);
  setQuote(app, 45);
  app.run('renderToday()');
  assert.strictEqual(planOf(app).stage, 'VR');
  assert.strictEqual(soxl(app).vrValue, 3600);
  assert.ok(planOf(app).buyShares > 0);
});

test('알림 버튼은 현재 규칙의 오늘 주문 가격을 쓴다', () => {
  const app = vrReady();
  assert.ok(app.els['alert-presets'].innerHTML.includes('오늘의 매도 $51.75'));
});

test('VR이면 회전 규칙 화면에 다른 규칙임을 알리고, 회전 규칙이면 알리지 않는다', () => {
  const app = vrReady();
  ['rescue-rule-notice', 'chart-rule-notice'].forEach(id => {
    assert.strictEqual(app.els[id].style.display, '');
    assert.ok(app.els[id].innerHTML.includes('VR 규칙'));
  });
  app.run('setPlanRule("ROTATION")');
  ['rescue-rule-notice', 'chart-rule-notice'].forEach(id => {
    assert.strictEqual(app.els[id].style.display, 'none');
  });
});

test('회전 규칙 화면에 추천이라는 표현을 남기지 않는다', () => {
  const html = readProjectFile('index.html');
  ['추천 20%', '추천 -10%', '추천 매도가', '추천 재매수가', '추천 타점'].forEach(text => {
    assert.ok(!html.includes(text), text);
  });
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
