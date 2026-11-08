// 브라우저 없이 앱 스크립트를 index.html 순서대로 불러오는 테스트 도구
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function localScripts() {
  return [...readProjectFile('index.html').matchAll(/<script src="([^"?]+)(?:\?[^"]*)?"><\/script>/g)]
    .map(m => m[1])
    .filter(src => !/^https?:/.test(src));
}

function fakeElement(id) {
  return {
    id,
    value: '',
    innerHTML: '',
    textContent: '',
    style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    appendChild(child) { this.innerHTML += child.innerHTML; }
  };
}

const SIMULATOR_DEFAULTS = {
  'sell-ratio-slider': '20',
  'drop-ratio-slider': '10',
  'bt-rot-timeout': '0',
  'bt-rot-start': 'crash'
};

// saved: localStorage에 들어 있던 앱 상태, store: 그 밖의 localStorage 항목, prompts: prompt() 응답 순서
function boot({ saved = null, store: extraStore = {}, prompts = [], fetch = null } = {}) {
  const store = { ...extraStore };
  if (saved) store.soxl_rescue_nav_v3 = JSON.stringify(saved);

  const els = {};
  const el = id => els[id] || (els[id] = fakeElement(id));
  Object.entries(SIMULATOR_DEFAULTS).forEach(([id, value]) => { el(id).value = value; });

  const promptQueue = [...prompts];
  const context = vm.createContext({
    console,
    fetch,
    AbortController,
    URLSearchParams,
    setTimeout: () => 0,
    clearTimeout() {},
    localStorage: {
      getItem: key => store[key] ?? null,
      setItem(key, value) { store[key] = value; },
      removeItem(key) { delete store[key]; }
    },
    window: { addEventListener() {} },
    document: { getElementById: el, addEventListener() {}, createElement: () => fakeElement(''), querySelectorAll: () => [] },
    alert() {},
    confirm: () => true,
    prompt: () => (promptQueue.length ? promptQueue.shift() : null)
  });

  localScripts().forEach(file => {
    vm.runInContext(readProjectFile(file), context, { filename: file });
  });

  return { els, store, run: code => vm.runInContext(code, context) };
}

// 재현 가능한 가상 일봉: 상승장 사이에 깊은 하락장을 끼워 넣는다
function syntheticBars(days = 2400, seed = 12345) {
  let state = seed;
  const random = () => {
    state = (state + 0x6d2b79f5) | 0;
    let x = Math.imul(state ^ (state >>> 15), 1 | state);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const bars = [];
  const baseBars = [];
  let levClose = 50;
  let baseClose = 100;
  const start = Date.UTC(2015, 0, 1);
  for (let i = 0; i < days; i++) {
    const inBear = i % 700 > 520;
    const shock = (random() - 0.5) * 0.04 + (inBear ? -0.006 : 0.002);
    const open = levClose * (1 + (random() - 0.5) * 0.01);
    levClose *= 1 + shock * 3;
    baseClose *= 1 + shock;
    const spread = 1 + random() * 0.03;
    const d = new Date(start + i * 86400000).toISOString().slice(0, 10);
    bars.push({ d, o: open, h: Math.max(open, levClose) * spread, l: Math.min(open, levClose) / spread, c: levClose });
    baseBars.push({ d, o: baseClose, h: baseClose, l: baseClose, c: baseClose });
  }
  return { bars, baseBars };
}

module.exports = { boot, localScripts, readProjectFile, syntheticBars };
