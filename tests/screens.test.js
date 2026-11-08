const test = require('node:test');
const assert = require('node:assert');
const { boot, syntheticBars, readProjectFile, localScripts } = require('./helpers/harness');

const { bars, baseBars } = syntheticBars();

function setPrices(app, cur = 27.27, sell = 29.72, buy = 26.75) {
  app.run(`appState.tickers.SOXL.currentPrice = ${cur}`);
  app.run(`document.getElementById('sim-sell-price').value = '${sell}'`);
  app.run(`document.getElementById('sim-buy-price').value = '${buy}'`);
  return app;
}

// 과거 일봉을 이 기기에 저장해 둔 상태로 시작하는 앱
function bootWithHistory({ withBase = false } = {}) {
  const seed = boot();
  const write = seed.run('(sym, bars) => writeBacktestHistoryCache(sym, { at: Date.now(), source: "test", bars })');
  write('SOXL', bars);
  if (withBase) write('SOXX', baseBars);
  const store = Object.fromEntries(Object.entries(seed.store).filter(([key]) => key.startsWith('bt_history_v1_')));
  return setPrices(boot({ store }));
}

test('일봉이 없으면 안내와 가정치를 보여준다', () => {
  const app = setPrices(boot());
  app.run('renderRotationBacktest(); renderGrowthCompoundAndHistory();');
  assert.ok(app.els['bt-rotation-result'].innerHTML.includes('아직 검증 전'));
  assert.ok(app.els['g-compound-summary'].innerHTML.includes('앱 기본 가정치'));
});

test('일봉 캐시는 저장했다 다시 읽어도 같다', () => {
  const restored = bootWithHistory().run('readBacktestHistoryCache("SOXL")');
  assert.strictEqual(restored.bars.length, bars.length);
  assert.ok(Math.abs(restored.bars[1000].c / bars[1000].c - 1) < 1e-4);
});

test('일봉은 백업 데이터에 섞이지 않는다', () => {
  const app = bootWithHistory();
  app.run('saveState()');
  assert.ok(!app.store.soxl_rescue_nav_v3.includes('"bars"'));
});

test('회전 검증은 설정을 규칙 문구와 결과에 반영한다', () => {
  const app = bootWithHistory();
  app.run('renderRotationBacktest()');
  assert.ok(app.els['bt-rot-rule'].innerHTML.includes('+9.0%'));
  assert.ok(app.els['bt-rotation-result'].innerHTML.includes('회전이 보유보다 나았던 비율'));
  app.els['bt-rot-timeout'].value = '20';
  app.run('renderRotationBacktest()');
  assert.ok(app.els['bt-rot-rule'].innerHTML.includes('20거래일'));
});

test('40분할 검증을 하면 복리 시뮬레이터가 과거 평균으로 바뀐다', () => {
  const app = bootWithHistory();
  app.run('renderSplitBacktest(); renderGrowthCompoundAndHistory();');
  assert.ok(app.els['g-compound-summary'].innerHTML.includes('과거 일봉으로 검증한 평균'));
  assert.ok(app.els['g-compound-period-th'].textContent.includes('과거 평균'));
});

test('대안 비교: 1배 ETF 일봉이 없으면 안내, 있으면 규칙 8개 표', () => {
  const without = bootWithHistory();
  without.run('renderRotationBacktest()');
  assert.ok(without.els['bt-alt-result'].innerHTML.includes('SOXX 일봉을 받아'));

  const withBase = bootWithHistory({ withBase: true });
  withBase.run('renderRotationBacktest()');
  assert.strictEqual((withBase.els['bt-alt-result'].innerHTML.match(/<tr>/g) || []).length, 9);
});

test('시나리오: 재매수를 못 하면 본전 주가가 올라간다', () => {
  const app = setPrices(boot());
  app.run('renderRotationBacktest()');
  const html = app.els['scenario-result'].innerHTML;
  const secured = 20 * 29.72 * 0.999;
  assert.ok(html.includes(`$${((6000 - secured) / 80).toFixed(2)}`));
  assert.ok(html.includes('$60.00'));
  assert.ok(html.includes('과거 빈도는 아래'));
});

test('시나리오: 일봉이 있으면 과거 빈도를 표시한다', () => {
  const app = bootWithHistory();
  app.run('renderRotationBacktest()');
  assert.ok(app.els['scenario-result'].innerHTML.includes('1년이 지나도 재매수가 안 온 경우'));
});

test('복리 시뮬레이터: 공제 후 22%로 양도세를 어림한다', () => {
  const app = boot();
  app.run('renderGrowthCompoundAndHistory()');
  const profit = 10000 * (Math.pow(1.055, 6) - 1);
  const tax = Math.max(0, profit * 1400 - 2500000) * 0.22 / 1400;
  assert.ok(app.els['g-compound-summary'].innerHTML.includes(`양도세 $${tax.toFixed(2)}`));
});

test('모든 스크립트와 스타일의 캐시 버전이 같다', () => {
  const versions = new Set([...readProjectFile('index.html').matchAll(/\?v=([0-9-]+)/g)].map(m => m[1]));
  assert.strictEqual(versions.size, 1, [...versions].join(', '));
  assert.ok(localScripts().length >= 2);
});
