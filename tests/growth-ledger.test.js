const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./helpers/harness');

const buy = (id, tradeDate, price, shares) => ({ id, tradeDate, type: 'BUY', price, shares, amount: price * shares, memo: '' });
const grad = (id, tradeDate, amount) => ({ id, tradeDate, type: 'GRADUATE', price: 50, shares: 10, amount, memo: '' });
const growthApp = (growth, options = {}) => boot({ saved: { tickers: { SOXL: { baseShares: 500, baseAvgPrice: 80, originalPrincipal: 40000, shares: 500, avgPrice: 80, logs: [], growth } } }, ...options });
const growthOf = app => app.run('appState.tickers.SOXL.growth');

test('기록과 일치하는 저장 데이터는 조정 기록 없이 그대로다', () => {
  const g = growthOf(growthApp({ totalBudget: 10000, heldShares: 30, avgPrice: 41.67, history: [buy(2, '2026-11-02', 45, 10), buy(1, '2026-11-01', 40, 20)] }));
  assert.strictEqual(g.history.length, 2);
  assert.strictEqual(g.heldShares, 30);
  assert.strictEqual(g.avgPrice, 41.67);
});

test('기록 없이 입력칸에 넣은 보유분은 조정 기록으로 옮겨 유지한다', () => {
  const g = growthOf(growthApp({ totalBudget: 10000, heldShares: 50, avgPrice: 40, history: [] }));
  assert.strictEqual(g.history.length, 1);
  assert.strictEqual(g.history[0].type, 'ADJUST');
  assert.strictEqual(g.heldShares, 50);
  assert.strictEqual(g.avgPrice, 40);
  assert.strictEqual(g.totalBudget, 10000);
});

test('기록보다 많게 직접 고친 수량과 평단을 유지한다', () => {
  const g = growthOf(growthApp({ totalBudget: 10000, heldShares: 30, avgPrice: 42, history: [buy(1, '2026-11-01', 40, 20)] }));
  assert.strictEqual(g.heldShares, 30);
  assert.strictEqual(g.avgPrice, 42);
});

test('기록보다 적게 직접 고친 수량을 유지한다', () => {
  const g = growthOf(growthApp({ totalBudget: 10000, heldShares: 0, avgPrice: 40, history: [buy(1, '2026-11-01', 40, 20)] }));
  assert.strictEqual(g.heldShares, 0);
  assert.strictEqual(g.history[0].type, 'ADJUST');
});

test('예전 방식의 평단 반올림 오차는 조정 기록을 만들지 않는다', () => {
  const g = growthOf(growthApp({ totalBudget: 10000, heldShares: 30, avgPrice: 41.7, history: [buy(2, '2026-11-02', 45, 10), buy(1, '2026-11-01', 40, 20)] }));
  assert.strictEqual(g.history.length, 2);
});

test('보유 수량 필드가 없는 아주 오래된 데이터는 기록을 따른다', () => {
  const g = growthOf(growthApp({ totalBudget: 10000, history: [buy(1, '2026-11-01', 40, 20)] }));
  assert.strictEqual(g.history.length, 1);
  assert.strictEqual(g.heldShares, 20);
});

test('졸업 뒤 직접 입력한 보유분도 다음 사이클에 남는다', () => {
  const g = growthOf(growthApp({ totalBudget: 10100, cumulativeProfit: 100, cycleCount: 2, heldShares: 12, avgPrice: 40, history: [grad(2, '2026-11-02', 100), buy(1, '2026-11-01', 40, 10)] }));
  assert.strictEqual(g.heldShares, 12);
  assert.strictEqual(g.cycleCount, 2);
  assert.strictEqual(g.cumulativeProfit, 100);
  assert.strictEqual(g.totalBudget, 10100);
});

test('시드는 기록의 누적 수익과 어긋나 있어도 화면 값을 유지한다', () => {
  const g = growthOf(growthApp({ totalBudget: 12000, baseTotalBudget: 9000, cumulativeProfit: 100, heldShares: 0, history: [grad(1, '2026-11-02', 100)] }));
  assert.strictEqual(g.totalBudget, 12000);
  assert.strictEqual(g.baseTotalBudget, 11900);
});

test('옮긴 뒤 저장했다 다시 불러와도 조정 기록이 늘지 않는다', () => {
  const first = growthApp({ totalBudget: 10000, heldShares: 33.3333, avgPrice: 41.37, history: [buy(1, '2026-11-01', 40, 20)] });
  const second = boot({ saved: JSON.parse(first.run('JSON.stringify(appState)')) });
  const g = growthOf(second);
  assert.strictEqual(g.history.length, 2);
  assert.strictEqual(g.heldShares, 33.3333);
  assert.strictEqual(g.avgPrice, 41.37);
});

test('조정 기록을 지우면 기록만의 보유분으로 돌아간다', () => {
  const app = growthApp({ totalBudget: 10000, heldShares: 30, avgPrice: 42, history: [buy(1, '2026-11-01', 40, 20)] });
  const id = growthOf(app).history.find(h => h.type === 'ADJUST').id;
  app.run(`deleteGrowthHistory(${id})`);
  assert.strictEqual(growthOf(app).heldShares, 20);
  assert.strictEqual(growthOf(app).avgPrice, 40);
});

test('보유분 맞추기는 입력한 수량과 평단이 되도록 조정 기록을 남긴다', () => {
  const app = growthApp({ totalBudget: 10000, heldShares: 20, avgPrice: 40, history: [buy(1, '2026-11-01', 40, 20)] }, { prompts: ['25', '38.5'] });
  app.run('setGrowthPosition()');
  assert.strictEqual(growthOf(app).heldShares, 25);
  assert.strictEqual(growthOf(app).avgPrice, 38.5);
});

test('입력칸 동기화는 보유 수량을 건드리지 않는다', () => {
  const app = growthApp({ totalBudget: 10000, heldShares: 20, avgPrice: 40, history: [buy(1, '2026-11-01', 40, 20)] });
  app.els['g-held-shares'] = { value: '999' };
  app.els['g-total-budget'] = { value: '20000' };
  app.els['g-splits'] = { value: '40' };
  app.els['g-target-profit'] = { value: '10' };
  app.run('recalcGrowthMode(true)');
  assert.strictEqual(growthOf(app).heldShares, 20);
  assert.strictEqual(growthOf(app).totalBudget, 20000);
});

test('매수 입력은 기록을 재생해 평단을 계산한다', () => {
  const app = growthApp({ totalBudget: 10000, heldShares: 20, avgPrice: 40, history: [buy(1, '2026-11-01', 40, 20)] });
  app.els['g-input-buy-price'] = { value: '50' };
  app.els['g-input-buy-shares'] = { value: '20' };
  app.els['g-input-buy-memo'] = { value: '' };
  app.els['g-input-buy-date'] = { value: '2026-11-03' };
  app.run('addGrowthDailyBuy({ preventDefault() {} })');
  assert.strictEqual(growthOf(app).heldShares, 40);
  assert.strictEqual(growthOf(app).avgPrice, 45);
});

test('졸업은 실제 체결가로 수익을 확정하고 시드에 더한다', () => {
  const app = growthApp({ totalBudget: 10000, heldShares: 20, avgPrice: 40, history: [buy(1, '2026-11-01', 40, 20)] }, { prompts: ['44'] });
  app.run('graduateCurrentCycle()');
  const profit = Number((20 * 44 * 0.999 - 20 * 40 * 1.001).toFixed(2));
  const g = growthOf(app);
  assert.strictEqual(g.heldShares, 0);
  assert.strictEqual(g.cycleCount, 2);
  assert.strictEqual(g.cumulativeProfit, profit);
  assert.strictEqual(g.totalBudget, Number((10000 + profit).toFixed(2)));
});
