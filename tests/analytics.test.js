const test = require('node:test');
const assert = require('node:assert');
const { boot } = require('./helpers/harness');

const ANCHOR = { baseShares: 500, baseAvgPrice: 80, originalPrincipal: 40000, baseCash: 0, shares: 500, avgPrice: 80 };
const log = (id, tradeDate, type, price, shares) => ({ id, tradeDate, type, price, shares, amount: 0, memo: '' });
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.01, `${a} vs ${b}`);

function analyze(logs, price) {
  const app = boot({ saved: { tickers: { SOXL: { ...ANCHOR, logs } } } });
  return { app, result: app.run(`analyzeRotations(appState.tickers.SOXL, ${price}, '2026-11-08')`) };
}

test('매도 후 재매수를 한 회전으로 묶는다', () => {
  const { result } = analyze([log(2, '2026-11-05', 'BUY', 45, 110), log(1, '2026-11-01', 'SELL', 50, 100)], 60);
  assert.strictEqual(result.rotations.length, 1);
  const r = result.rotations[0];
  assert.strictEqual(r.status, 'done');
  assert.strictEqual(r.daysWaited, 4);
  close(r.shareChange, 10);
  assert.strictEqual(r.won, true);
  assert.strictEqual(result.wins, 1);
  close(result.winPct, 100);
});

test('회전 효과는 안 했을 때와 비교한 현재가 기준 손익이다', () => {
  const { result } = analyze([log(2, '2026-11-05', 'BUY', 45, 100), log(1, '2026-11-01', 'SELL', 50, 100)], 60);
  const r = result.rotations[0];
  close(r.shareChange, 0);
  close(r.cashLeft, 4995 - 4504.5);
  close(r.effectNow, 490.5);
  close(result.effectVsHold, 490.5);
});

test('재매수가 없으면 대기 중으로 표시한다', () => {
  const { result } = analyze([log(1, '2026-11-01', 'SELL', 50, 100)], 60);
  assert.strictEqual(result.waiting.status, 'waiting');
  assert.strictEqual(result.waiting.daysWaited, 7);
  assert.strictEqual(result.finishedCount, 0);
  assert.strictEqual(result.winPct, null);
  close(result.waiting.effectNow, 4995 - 6000);
});

test('판 돈을 넘긴 매수는 새 돈으로 분리한다', () => {
  const { result } = analyze([log(2, '2026-11-05', 'BUY', 45, 200), log(1, '2026-11-01', 'SELL', 50, 100)], 60);
  const r = result.rotations[0];
  close(r.cost, 4995);
  close(r.buyShares, 200 * (4995 / 9009));
  close(result.newMoneyCost, 9009 - 4995);
});

test('매도 없는 매수는 회전이 아니라 새 돈이다', () => {
  const { result } = analyze([log(1, '2026-11-01', 'BUY', 45, 100)], 60);
  assert.strictEqual(result.rotations.length, 0);
  close(result.newMoneyCost, 4504.5);
  close(result.effectVsHold, 100 * 60 - 4504.5 + 0);
});

test('비싸게 되사면 실패로 센다', () => {
  const { result } = analyze([log(2, '2026-11-05', 'BUY', 55, 80), log(1, '2026-11-01', 'SELL', 50, 100)], 60);
  assert.strictEqual(result.rotations[0].won, false);
  assert.strictEqual(result.wins, 0);
});

test('나눠서 재매수한 뒤 다음 매도가 오면 앞 회전을 닫는다', () => {
  const { result } = analyze([
    log(3, '2026-11-07', 'SELL', 52, 50),
    log(2, '2026-11-05', 'BUY', 45, 20),
    log(1, '2026-11-01', 'SELL', 50, 100)
  ], 60);
  assert.strictEqual(result.rotations.length, 2);
  assert.strictEqual(result.rotations[0].status, 'done');
  assert.strictEqual(result.rotations[1].status, 'waiting');
});

test('수수료는 매도·매수 체결 금액의 0.1%다', () => {
  const { result } = analyze([log(2, '2026-11-05', 'BUY', 45, 100), log(1, '2026-11-01', 'SELL', 50, 100)], 60);
  close(result.fees, 5 + 4.5);
});

test('입금·인출이 있어도 거래 효과는 흔들리지 않는다', () => {
  const { result } = analyze([log(2, '2026-11-05', 'WITHDRAW', 300, 1), log(1, '2026-11-01', 'DEPOSIT', 1000, 1)], 60);
  close(result.effectVsHold, 0);
});

test('40분할 사이클 수익률은 그때의 시드 기준이다', () => {
  const buy = (id, d, price, shares) => ({ id, tradeDate: d, type: 'BUY', price, shares, amount: 0, memo: '' });
  const grad = (id, d, amount) => ({ id, tradeDate: d, type: 'GRADUATE', price: 50, shares: 10, amount, memo: '' });
  const app = boot({ saved: { tickers: { SOXL: { growth: { totalBudget: 10300, cumulativeProfit: 300, heldShares: 5, avgPrice: 40, history: [
    buy(5, '2026-10-20', 40, 5), grad(4, '2026-10-10', 200), buy(3, '2026-10-01', 40, 5), grad(2, '2026-09-11', 100), buy(1, '2026-09-01', 40, 5)
  ] } } } } });
  const r = app.run(`analyzeGrowthCycles(appState.tickers.SOXL.growth, '2026-11-08')`);
  assert.strictEqual(r.count, 2);
  assert.strictEqual(r.wins, 2);
  close(r.cycles[0].profitPct * 10000, 100);
  close(r.cycles[1].profitPct * 10100, 200);
  assert.strictEqual(r.cycles[0].days, 10);
  assert.strictEqual(r.currentCycleDays, 19);
});

test('기록이 없어도 성적표가 안내 문구로 표시된다', () => {
  const app = boot();
  app.run('renderJournalAnalytics()');
  assert.ok(app.els['journal-analytics'].innerHTML.includes('아직 원금 탈출 매매 기록이 없습니다'));
});

test('기록이 있으면 성적표에 회전 표와 대기 안내가 나온다', () => {
  const app = boot({ saved: { tickers: { SOXL: { ...ANCHOR, logs: [log(3, '2026-11-07', 'SELL', 52, 50), log(2, '2026-11-05', 'BUY', 45, 100), log(1, '2026-11-01', 'SELL', 50, 100)] } } } });
  app.run('renderJournalAnalytics()');
  const html = app.els['journal-analytics'].innerHTML;
  assert.ok(html.includes('재매수를 기다리고 있습니다'));
  assert.strictEqual((html.match(/<tr>/g) || []).length, 3);
});
