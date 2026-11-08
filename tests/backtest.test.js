const test = require('node:test');
const assert = require('node:assert');
const { boot, syntheticBars } = require('./helpers/harness');

const app = boot();
const engine = app.run('({ btVrPath, btRotationRun, btRotationOdds, btAlternativesStudy, btSplitSim, btSplitStudy, btRsiSeries })');
const bar = (d, o, h, l, c) => ({ d, o, h, l, c });
const RULE = { up: 0.09, drop: 0.1, ratio: 0.2 };
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('회전: 매도와 재매수가 지정가에 체결되고 수수료를 뺀다', () => {
  const bars = [bar('d0', 100, 100, 100, 100), bar('d1', 105, 110, 104, 108), bar('d2', 105, 106, 95, 100)];
  const run = engine.btRotationRun(bars, 0, RULE, [2], 0);
  const cash = 200 * 109 * 0.999;
  const qty = Math.floor(cash / (98.1 * 1.001));
  const left = cash - qty * 98.1 * 1.001;
  assert.ok(Math.abs(run.checkpoints[0].ratio - ((800 + qty) * 100 + left) / 100000) < 1e-9);
  assert.strictEqual(run.checkpoints[0].cashStuck, false);
});

test('회전: 재매수가 안 오면 현금이 묶인 것으로 센다', () => {
  const bars = [bar('d0', 100, 100, 100, 100), bar('d1', 105, 110, 104, 108), bar('d2', 112, 125, 110, 120)];
  const run = engine.btRotationRun(bars, 0, RULE, [2], 0);
  assert.strictEqual(run.checkpoints[0].cashStuck, true);
  assert.ok(run.checkpoints[0].ratio < 1);
});

test('회전: 대기 한도가 지나면 그날 종가에 재매수한다', () => {
  const bars = [bar('d0', 100, 100, 100, 100), bar('d1', 105, 110, 104, 108), bar('d2', 112, 125, 110, 120), bar('d3', 120, 125, 118, 122)];
  const run = engine.btRotationRun(bars, 0, { ...RULE, timeout: 2 }, [3], 0);
  assert.strictEqual(run.checkpoints[0].cashStuck, false);
});

test('VR: 상단 밴드 지정가에 V까지 팔고, 현금이 있으면 하단에서 절반 한도로 산다', () => {
  const bars = [
    bar('d0', 100, 100, 100, 100),
    bar('d1', 110, 116, 109, 112),
    bar('d2', 112, 113, 80, 90)
  ];
  const path = engine.btVrPath(bars, 0, 2);
  const sold = Math.round(1000 - 100000 / 115);
  const pool = sold * 115 * 0.999;
  close(path[1], ((1000 - sold) * 112 + pool) / 100000);
  const lower = (100000 * 0.85) / (1000 - sold);
  const buy = Math.floor(Math.min(100000 - (1000 - sold) * lower, pool * 0.5) / (lower * 1.001));
  close(path[2], ((1000 - sold + buy) * 90 + pool - buy * lower * 1.001) / 100000);
});

test('40분할: 첫날 1회분을 사고 평단 +목표%에서 졸업한다', () => {
  const bars = [bar('d0', 100, 100, 100, 100), bar('d1', 100, 100, 100, 100), bar('d2', 100, 115, 100, 112)];
  const indicators = { closes: bars.map(b => b.c), rsi: [50, 50, 50], bbLower: [0, 0, 0] };
  const sim = engine.btSplitSim(bars, 0, 2, { splits: 40, target: 0.1, booster: false }, indicators);
  assert.strictEqual(sim.cycles.length, 1);
  assert.ok(sim.cycles[0].profit > 0 && sim.cycles[0].profit < 0.1);
});

test('백테스트 RSI는 화면 표시용 RSI와 같은 값을 낸다', () => {
  const closes = syntheticBars(200).bars.map(b => b.c);
  const series = engine.btRsiSeries(closes);
  const appRsi = app.run(`computeRSI(${JSON.stringify(closes)})`);
  assert.ok(Math.abs(series[series.length - 1] - appRsi) < 1e-9);
});

test('대안 비교: 보유는 자기 자신과 같고 규칙 8개를 낸다', () => {
  const { bars, baseBars } = syntheticBars();
  const study = engine.btAlternativesStudy(bars, baseBars, { ...RULE, crashDrawdown: 0.45, breakevenMultiple: 2 });
  assert.ok(study.n > 0, '폭락 시작점이 있어야 한다');
  assert.strictEqual(study.rules.length, 8);
  assert.strictEqual(study.rules[0].ratio2y, 1);
  assert.strictEqual(study.rules[0].beat2yPct, 0);
});

test('단계별 빈도는 조건부 관계를 지킨다', () => {
  const odds = engine.btRotationOdds(syntheticBars().bars, { up: 0.09, drop: 0.1, crashDrawdown: 0 });
  assert.ok(odds.n > 0);
  assert.ok(odds.sellFill60Pct <= odds.sellFill252Pct && odds.sellFill252Pct <= 100);
  assert.ok(odds.rebuy20Pct <= odds.rebuy60Pct && odds.rebuy60Pct <= odds.rebuy252Pct);
  assert.ok(odds.deeper20Pct <= odds.deeper10Pct);
});

test('시작 연도별 40분할 결과를 낸다', () => {
  const study = engine.btSplitStudy(syntheticBars().bars, { splits: 40, target: 0.1 });
  assert.ok(study.rows.length >= 2);
  assert.ok(study.overall.plain.mdd <= 0);
});
