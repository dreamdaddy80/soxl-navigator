const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./helpers/harness');

const breakeven = t => ((t.originalPrincipal + (t.addedPrincipal || 0) - (t.reservedCash || 0)) / t.shares).toFixed(2);
const log = (id, tradeDate, type, price, shares) => ({ id, tradeDate, type, price, shares, amount: 0, memo: '' });
const soxlFrom = fields => boot({ saved: { tickers: { SOXL: fields } } }).run('appState.tickers.SOXL');
const ANCHOR = { baseShares: 500, baseAvgPrice: 80, originalPrincipal: 40000, baseCash: 0, shares: 500, avgPrice: 80 };

test('새 돈으로 매수하면 원금에 더해진다', () => {
  const t = soxlFrom({ ...ANCHOR, logs: [log(1, '2026-11-01', 'BUY', 45, 100)] });
  assert.strictEqual(t.shares, 600);
  assert.strictEqual(t.addedPrincipal, 4504.5);
  assert.strictEqual(t.avgPrice, 74.17);
});

test('판 돈으로 다시 사면 추가 원금이 없다', () => {
  const t = soxlFrom({ ...ANCHOR, logs: [log(2, '2026-11-03', 'BUY', 45, 100), log(1, '2026-11-01', 'SELL', 50, 100)] });
  assert.strictEqual(t.addedPrincipal, 0);
  assert.strictEqual(t.reservedCash, 490.5);
  assert.strictEqual(breakeven(t), '79.02');
});

test('입력 순서와 무관하게 체결일 순서로 계산한다', () => {
  const t = soxlFrom({ ...ANCHOR, logs: [log(9, '2026-11-01', 'SELL', 50, 100), log(8, '2026-11-03', 'BUY', 45, 100)] });
  assert.strictEqual(t.addedPrincipal, 0);
  assert.strictEqual(t.logs[0].id, 8);
});

test('입금·매수·인출을 원금과 현금에 반영한다', () => {
  const t = soxlFrom({
    ...ANCHOR,
    logs: [log(3, '2026-11-05', 'WITHDRAW', 495.5, 1), log(2, '2026-11-04', 'BUY', 45, 100), log(1, '2026-11-03', 'DEPOSIT', 5000, 1)]
  });
  assert.strictEqual(t.reservedCash, 0);
  assert.strictEqual(t.shares, 600);
  assert.strictEqual(breakeven(t), '74.17');
});

test('기록이 있으면 현금 칸에 저장된 값은 무시하고 다시 계산한다', () => {
  const t = soxlFrom({ ...ANCHOR, reservedCash: 9999, logs: [log(2, '2026-11-03', 'BUY', 45, 100), log(1, '2026-11-01', 'SELL', 50, 100)] });
  assert.strictEqual(t.reservedCash, 490.5);
});

test('백업에 섞인 잘못된 값을 걸러낸다', () => {
  const merged = boot().run(`mergeWithDefaults({
    currentTicker: 'XXX',
    tickers: { SOXL: { shares: '<img onerror=1>', logs: [{ id: '1);alert(1', type: 'HACK', price: '5', shares: 2, memo: '<b>x</b>' }], growth: { history: 'nope' } } }
  })`);
  assert.strictEqual(merged.currentTicker, 'SOXL');
  assert.strictEqual(typeof merged.tickers.SOXL.logs[0].id, 'number');
  assert.strictEqual(merged.tickers.SOXL.logs[0].type, 'SELL');
  assert.strictEqual(merged.tickers.SOXL.growth.history.length, 0);
});

// 예전 버전이 남긴 저장 데이터: 화면의 탈출가가 바뀌면 안 된다
test('기준점이 없는 예전 데이터는 입력칸 값을 기준점으로 삼는다', () => {
  const t = soxlFrom({ shares: 500, avgPrice: 80, reservedCash: 0, logs: [] });
  assert.strictEqual(t.originalPrincipal, 40000);
  assert.strictEqual(breakeven(t), '80.00');
});

test('샘플 기본값이 섞여 저장된 데이터를 복구한다', () => {
  const t = soxlFrom({ baseShares: 100, baseAvgPrice: 60, originalPrincipal: 6000, shares: 500, avgPrice: 80, logs: [] });
  assert.strictEqual(breakeven(t), '80.00');
});

test('기록이 있고 원금만 틀린 데이터는 기준점으로 원금을 고친다', () => {
  const t = soxlFrom({ baseShares: 500, baseAvgPrice: 80, originalPrincipal: 6000, shares: 500, avgPrice: 12, logs: [log(1, '2023-11-14', 'SELL', 50, 100)] });
  assert.strictEqual(t.originalPrincipal, 40000);
  assert.strictEqual(t.shares, 400);
});

test('기록 없이 현금 칸에 직접 넣었던 금액은 시작 현금으로 옮긴다', () => {
  const t = soxlFrom({ baseShares: 500, baseAvgPrice: 80, originalPrincipal: 40000, shares: 500, avgPrice: 80, reservedCash: 500, logs: [] });
  assert.strictEqual(t.baseCash, 500);
  assert.strictEqual(breakeven(t), '79.00');
});

test('저장했다 다시 불러와도 숫자가 같다', () => {
  const first = boot({ saved: { tickers: { SOXL: { ...ANCHOR, logs: [log(2, '2026-11-03', 'BUY', 45, 100), log(1, '2026-11-01', 'SELL', 50, 100)] } } } });
  const again = boot({ saved: JSON.parse(first.run('JSON.stringify(appState)')) }).run('appState.tickers.SOXL');
  assert.strictEqual(again.shares, 500);
  assert.strictEqual(again.reservedCash, 490.5);
});

test('저장 데이터가 없으면 샘플 기본값으로 시작한다', () => {
  assert.strictEqual(breakeven(boot().run('appState.tickers.SOXL')), '60.00');
});
