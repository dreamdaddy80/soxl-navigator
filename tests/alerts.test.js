const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./helpers/harness');

const alertsOf = app => app.run('appState.tickers.SOXL.alerts');

function appAt(price, options = {}) {
  const app = boot(options);
  app.run(`appState.tickers.SOXL.currentPrice = ${price}`);
  return app;
}

test('예전 저장 데이터에는 빈 알림 목록이 생기고 탈출가는 그대로다', () => {
  const app = boot({ saved: { tickers: { SOXL: { baseShares: 500, baseAvgPrice: 80, originalPrincipal: 40000, shares: 500, avgPrice: 80, logs: [] } } } });
  assert.strictEqual(alertsOf(app).length, 0);
  assert.strictEqual(app.run('appState.tickers.SOXL.avgPrice'), 80);
});

test('백업에 섞인 잘못된 알림을 걸러낸다', () => {
  const app = boot({ saved: { tickers: { SOXL: { alerts: [
    { id: 1, price: 50, direction: 'above', label: 'ok', active: true },
    { id: 2, price: -1, direction: 'above', active: true },
    { id: 3, price: 50, direction: 'sideways', active: true },
    'nope'
  ] } } } });
  assert.strictEqual(alertsOf(app).length, 1);
});

test('현재가보다 높으면 상승, 낮으면 하락 알림이 된다', () => {
  const app = appAt(45);
  app.run('addPriceAlert(50, "매도"); addPriceAlert(40, "재매수");');
  const [low, high] = [...alertsOf(app)].sort((a, b) => a.price - b.price);
  assert.strictEqual(high.direction, 'above');
  assert.strictEqual(low.direction, 'below');
});

test('같은 가격을 중복으로 걸 수 없다', () => {
  const app = appAt(45);
  app.run('addPriceAlert(50, "a"); addPriceAlert(50, "b");');
  assert.strictEqual(alertsOf(app).length, 1);
});

test('목표가에 닿으면 한 번만 울린다', () => {
  const app = appAt(45);
  app.run('addPriceAlert(50, "매도")');
  app.run('checkPriceAlerts("SOXL", 49.99)');
  assert.strictEqual(alertsOf(app)[0].active, true);
  app.run('checkPriceAlerts("SOXL", 50.2)');
  assert.strictEqual(alertsOf(app)[0].active, false);
  assert.strictEqual(alertsOf(app)[0].triggeredPrice, 50.2);
  const firstTime = alertsOf(app)[0].triggeredAt;
  app.run('checkPriceAlerts("SOXL", 51)');
  assert.strictEqual(alertsOf(app)[0].triggeredAt, firstTime);
  assert.ok(app.els['alert-toast-area'].innerHTML.includes('50.00'));
});

test('하락 알림은 목표가 아래로 내려올 때 울린다', () => {
  const app = appAt(45);
  app.run('addPriceAlert(40, "재매수")');
  app.run('checkPriceAlerts("SOXL", 41)');
  assert.strictEqual(alertsOf(app)[0].active, true);
  app.run('checkPriceAlerts("SOXL", 39.5)');
  assert.strictEqual(alertsOf(app)[0].active, false);
});

test('메모의 HTML은 화면에서 이스케이프한다', () => {
  const app = appAt(45);
  app.run('addPriceAlert(50, "<img src=x>")');
  assert.ok(!app.els['alert-list'].innerHTML.includes('<img'));
});

test('알림은 저장했다 다시 불러와도 유지되고 텔레그램 토큰은 백업에 없다', () => {
  const app = appAt(45, { store: { telegram_alert_config: JSON.stringify({ token: '1:abc', chatId: '5' }) } });
  app.run('addPriceAlert(50, "매도")');
  const saved = app.store.soxl_rescue_nav_v3;
  assert.ok(!saved.includes('1:abc'));
  const reloaded = boot({ saved: JSON.parse(saved) });
  assert.strictEqual(alertsOf(reloaded).length, 1);
  assert.strictEqual(alertsOf(reloaded)[0].active, true);
});

test('텔레그램이 연결돼 있으면 종목과 가격만 보낸다', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, body: String(init.body) }); return { status: 200, json: async () => ({ ok: true, result: {} }) }; };
  const app = appAt(45, { fetch, store: { telegram_alert_config: JSON.stringify({ token: '1:abc', chatId: '5' }) } });
  app.run('addPriceAlert(50, "매도")');
  app.run('checkPriceAlerts("SOXL", 50.5)');
  await new Promise(resolve => setImmediate(resolve));
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/bot1:abc/sendMessage'));
  const text = new URLSearchParams(calls[0].body).get('text');
  assert.ok(text.includes('SOXL') && text.includes('$50.00'));
  assert.ok(!text.includes('100주'));
});

test('텔레그램 전송 실패는 상태 줄에 표시하고 앱을 멈추지 않는다', async () => {
  const fetch = async () => ({ status: 401, json: async () => ({ ok: false, description: 'Unauthorized' }) });
  const app = appAt(45, { fetch, store: { telegram_alert_config: JSON.stringify({ token: '1:abc', chatId: '5' }) } });
  app.run('addPriceAlert(50, "매도")');
  app.run('checkPriceAlerts("SOXL", 50.5)');
  await new Promise(resolve => setImmediate(resolve));
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(app.els['alert-channel-status'].innerHTML.includes('Unauthorized'));
});

test('텔레그램 설정은 봇에서 대화 ID를 찾아 테스트 메시지 후 저장한다', async () => {
  const methods = [];
  const fetch = async url => {
    const method = url.split('/').pop();
    methods.push(method);
    const result = method === 'getUpdates' ? [{ message: { chat: { id: 77 } } }] : {};
    return { status: 200, json: async () => ({ ok: true, result }) };
  };
  const app = boot({ fetch, prompts: ['123:abc-DEF', '77'] });
  await app.run('setTelegramAlert()');
  assert.deepStrictEqual(methods, ['getUpdates', 'sendMessage']);
  assert.strictEqual(JSON.parse(app.store.telegram_alert_config).chatId, '77');
});

test('형식이 틀린 봇 토큰은 요청 없이 거절한다', async () => {
  let called = false;
  const app = boot({ fetch: async () => { called = true; return {}; }, prompts: ['../evil'] });
  await app.run('setTelegramAlert()');
  assert.strictEqual(called, false);
  assert.strictEqual(app.store.telegram_alert_config, undefined);
});
