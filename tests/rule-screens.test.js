// 현재 규칙에 맞춰 차트·타점과 탈출시뮬이 바뀌는지 확인한다
const test = require('node:test');
const assert = require('node:assert');
const { boot, syntheticBars } = require('./helpers/harness');

const CLOCK = Date.UTC(2026, 11, 15, 15, 0);
const { bars } = syntheticBars();

function ready({ saved, store } = {}) {
  const app = boot({ saved, store });
  app.run(`Date.now = () => ${CLOCK}`);
  app.run(`Object.assign(appState.tickers.SOXL, { currentPrice: 45, prevClose: 44, lastQuoteAt: ${CLOCK}, sma5: 0, sma20: 0, recentHigh: 0, dayHigh: 45, dayLow: 45 })`);
  return app;
}

function vrApp(options) {
  const app = ready(options);
  app.run('computeRealisticTargets(appState.tickers.SOXL, false); renderToday(); renderRotationBacktest()');
  return app;
}

function historyStore() {
  const seed = boot();
  seed.run('(sym, bars) => writeBacktestHistoryCache(sym, { at: Date.now(), source: "test", bars })')('SOXL', bars);
  return Object.fromEntries(Object.entries(seed.store).filter(([key]) => key.startsWith('bt_history_v1_')));
}

test('차트·타점: VR이면 오늘의 주문과 같은 가격을 VR 이름으로 보여 준다', () => {
  const app = vrApp();
  const plan = app.run('appState.tickers.SOXL.dailyPlan');
  assert.strictEqual(plan.stage, 'VR');
  assert.strictEqual(app.els['ind-sell-name'].textContent, 'VR 매도가 (상단 밴드)');
  assert.ok(app.els['ind-sell-target'].textContent.startsWith(`$${plan.price.toFixed(2)}`));
  assert.ok(app.els['ind-sell-basis'].textContent.includes(`${plan.shares}주`));
  assert.strictEqual(app.els['ind-buy-target'].textContent, '매수 주문 없음');
  assert.ok(app.els['target-rationale-box'].innerHTML.includes('기준 평가금 V'));
  assert.strictEqual(app.els['chart-mode-bar'].style.display, 'none');
  assert.strictEqual(app.els['chart-sim-btn'].textContent, 'VR 시뮬레이션 보기');
});

test('차트·타점: 규칙을 바꾸면 회전 목표가로 돌아오고 다시 VR로 바뀐다', () => {
  const app = vrApp();
  app.run('setPlanRule("ROTATION")');
  assert.strictEqual(app.els['ind-sell-name'].textContent, '회전 규칙 매도가 (1차 / 2차)');
  assert.ok(app.els['target-rationale-box'].innerHTML.includes('회전 규칙 목표 매도가'));
  assert.strictEqual(app.els['chart-mode-bar'].style.display, '');
  app.run('setPlanRule("VR")');
  assert.strictEqual(app.els['ind-sell-name'].textContent, 'VR 매도가 (상단 밴드)');
});

test('탈출시뮬: VR이면 회전 계산기를 숨기고 VR 주문표를 보여 준다', () => {
  const app = vrApp();
  assert.strictEqual(app.els['rescue-sim-rotation'].style.display, 'none');
  assert.strictEqual(app.els['rescue-sim-vr'].style.display, '');
  const html = app.els['rescue-sim-vr'].innerHTML;
  assert.ok(html.includes('가격대별 VR 주문'));
  assert.ok(html.includes('매도 1단계'));
  assert.ok(html.includes('현금이 없어 매수 주문이 없습니다'));
  assert.ok(app.els['concl-rescue-sim'].innerHTML.includes('$51.75'));
  app.run('setPlanRule("ROTATION")');
  assert.strictEqual(app.els['rescue-sim-rotation'].style.display, '');
  assert.strictEqual(app.els['rescue-sim-vr'].style.display, 'none');
  assert.ok(app.els['concl-rescue-sim'].innerHTML.includes('두 주문이 모두 체결되면'));
});

test('탈출시뮬: 현금이 있으면 매수 단계까지 나오고 첫 단계는 오늘의 주문과 같다', () => {
  const app = ready({ saved: { tickers: { SOXL: { baseShares: 100, baseAvgPrice: 80, originalPrincipal: 8000, baseCash: 0, shares: 100, avgPrice: 80, logs: [{ id: 1, tradeDate: '2026-12-01', type: 'SELL', price: 50, shares: 20, amount: 0, memo: '' }] } } } });
  app.run('renderToday()');
  const plan = app.run('appState.tickers.SOXL.dailyPlan');
  assert.ok(plan.buyShares > 0);
  const html = app.els['rescue-sim-vr'].innerHTML;
  assert.ok(html.includes('매수 1단계'));
  assert.ok(html.includes(`$${plan.buyPrice.toFixed(2)}`));
});

test('직접 조정한 오늘의 주문 가격이 차트·타점에도 그대로 나온다', () => {
  const app = vrApp();
  app.run('openTodayPanel("adjust", "SELL")');
  app.els['today-adjust-price'] = { value: '60' };
  app.els['today-adjust-shares'] = { value: '5' };
  app.run('applyTodayAdjust()');
  assert.ok(app.els['ind-sell-target'].textContent.startsWith('$60.00'));
});

test('V가 아직 없으면 VR 화면에 계산 대기 안내를 보여 준다', () => {
  const app = boot();
  app.run(`Date.now = () => ${CLOCK}`);
  app.run('renderToday(); renderRotationBacktest()');
  assert.ok(app.els['ind-sell-basis'].textContent.includes('시세를 확인하면'));
  assert.ok(app.els['rescue-sim-vr'].innerHTML.includes('기준 평가금 V가 아직 없습니다'));
  assert.ok(app.els['scenario-result'].innerHTML.includes('기준 평가금 V가 아직 없습니다'));
});

test('시나리오: VR이면 상단·하단 기준으로 계산하고 회전 문구가 없다', () => {
  const app = vrApp();
  const html = app.els['scenario-result'].innerHTML;
  assert.ok(html.includes('상단 도달: $51.75에 매도'));
  assert.ok(html.includes('현금 없이 하락'));
  assert.ok(!html.includes('재매수 못 함'));
  assert.ok(app.els['scenario-intro'].textContent.includes('VR 주문'));
});

test('과거 검증: VR이면 VR 결과를 보여 주고 대기 한도 옵션을 숨긴다', () => {
  const app = vrApp({ store: historyStore() });
  assert.ok(app.els['bt-rot-rule'].innerHTML.includes('기준 평가금 V'));
  assert.ok(app.els['bt-rotation-result'].innerHTML.includes('VR이 보유보다 나았던 비율'));
  assert.ok(!app.els['bt-rotation-result'].innerHTML.includes('회전이 보유보다'));
  assert.strictEqual(app.els['bt-rot-timeout-group'].style.display, 'none');
  assert.strictEqual(app.els['bt-card-title'].textContent, 'VR 규칙이 실제로 통했나?');
  assert.ok(app.els['scenario-result'].innerHTML.includes('먼저 닿은 경우'));
});

test('과거 검증: 회전 규칙으로 바꾸면 회전 결과로 돌아온다', () => {
  const app = vrApp({ store: historyStore() });
  app.els['sim-sell-price'] = { value: '49.05' };
  app.els['sim-buy-price'] = { value: '44.15' };
  app.run('setPlanRule("ROTATION")');
  assert.ok(app.els['bt-rotation-result'].innerHTML.includes('회전이 보유보다 나았던 비율'));
  assert.strictEqual(app.els['bt-rot-timeout-group'].style.display, '');
});

test('VR 연속 체결표: 매도는 15%씩 올라가고 매수는 현금 한도에서 멈춘다', () => {
  const app = boot();
  const sell = app.run('simulateVrLadder(4500, 100, 0, "SELL", null)');
  assert.strictEqual(sell.length, 4);
  assert.strictEqual(sell[0].price, 51.75);
  assert.ok(Math.abs(sell[1].price / sell[0].price - 1.15) < 0.01);
  assert.ok(sell[1].cash > sell[0].cash);
  assert.strictEqual(app.run('simulateVrLadder(4500, 100, 0, "REBUY", null)').length, 0);
});

test('VR 비교 통계: 규칙 경로와 같은 값을 쓰고 비율은 0~100이다', () => {
  const app = boot();
  const study = app.run('btVrStudy')(bars, { crashDrawdown: 0.45, breakevenMultiple: 2 });
  assert.ok(study.startCount > 0);
  assert.ok(study.episodes.length > 0);
  assert.ok(study.horizons[0].beatPct >= 0 && study.horizons[0].beatPct <= 100);
  const odds = app.run('btBandTouchOdds')(bars, { up: 0.15, down: 0.15, crashDrawdown: 0 });
  assert.ok(study.horizons[0].beatPct + study.horizons[0].losePct <= 100.0001);
  assert.ok(odds.n > 0);
  assert.ok(odds.up60Pct + odds.down60Pct <= 100.0001);
  assert.ok(Math.abs(odds.up60Pct + odds.down60Pct + odds.neither60Pct - 100) < 1e-9);
});
