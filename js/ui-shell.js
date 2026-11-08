// 화면 틀: 설정 시트, 규칙 배지, 하위 탭, 용어 풀이, 표 보조 기능 (계산 없음)

const GLOSSARY = {
  '본전 주가': '남은 주식을 이 가격에 다 팔면 회복 목표 원금을 되찾는 가격입니다. (원금 − 현금) ÷ 보유 주식 수',
  '구출 현금': '물린 주식을 일부 팔아 확보해 둔 현금입니다. 재매수에 씁니다.',
  '탈출': '평가손실 상태에서 원금을 되찾아 본전까지 회복하는 것을 말합니다.',
  '회전': '반등에 일부 팔고 더 낮은 가격에 다시 사서 주식 수를 늘리는 한 번의 왕복 매매입니다.',
  '반등 회전': '반등에 일부 팔고 눌림목에서 되사는 주문 규칙입니다.',
  'VR 규칙': '기준 평가금 V의 ±15%를 벗어난 가격에만 주문을 내는 규칙입니다. V는 2주마다 갱신합니다.',
  '졸업': '40분할에서 목표 수익률에 도달해 보유분을 전량 매도하고 사이클을 끝내는 것입니다.',
  '1회차': '시드를 분할 횟수로 나눈 1조각만큼 매수한 단계입니다. 40분할이면 1조각 = 시드의 1/40입니다.',
  'LOC': '장 마감 시 종가가 지정한 가격 이하일 때만 종가로 체결되는 주문입니다.',
  '시드': '40분할에 실제로 쓸 수 있는 현금입니다. 이미 주식에 묶인 돈은 시드가 될 수 없습니다.',
  'RSI': '최근 상승과 하락의 강도를 0~100으로 나타낸 지표입니다. 낮을수록 많이 내린 상태입니다.',
  '볼린저밴드': '20일 평균선 위아래로 표준편차 2배만큼 그린 띠입니다. 가격의 상대적 위치를 봅니다.'
};

function termHTML(key, label = key) {
  return `<button type="button" class="term" data-term="${escapeHTML(key)}">${escapeHTML(label)}</button>`;
}

// ------------------------------ 규칙 배지와 설정 시트 ------------------------------
function ruleName(t) {
  return isVrRule(t) ? 'VR' : '반등 회전';
}

function renderRuleBadge(t) {
  const badge = document.getElementById('rule-badge');
  if (badge) badge.textContent = `현재 규칙: ${ruleName(t)}`;

  const ticker = document.getElementById('settings-rule-ticker');
  if (ticker) ticker.textContent = `${appState.currentTicker}에 적용 중 · 종목별로 따로 저장됩니다`;

  const body = document.getElementById('settings-rule-body');
  if (!body) return;
  const vr = isVrRule(t);
  body.innerHTML = `
    <div class="segmented segmented-sm" role="radiogroup" aria-label="주문 규칙">
      <button type="button" role="radio" class="segment ${vr ? 'active' : ''}" aria-checked="${vr}" onclick="setPlanRule('VR')">VR</button>
      <button type="button" role="radio" class="segment ${vr ? '' : 'active'}" aria-checked="${!vr}" onclick="setPlanRule('ROTATION')">반등 회전</button>
    </div>
    <p class="sheet-hint">${GLOSSARY[vr ? 'VR 규칙' : '반등 회전']}</p>
    ${vr ? '<button type="button" class="text-link-btn" onclick="resetVrBase()">기준 평가금 V를 지금 평가금으로 다시 잡기</button>' : ''}
  `;
}

let settingsReturnFocus = null;

function openSettings(sectionId) {
  const sheet = document.getElementById('settings-sheet');
  settingsReturnFocus = document.activeElement;
  document.getElementById('settings-backdrop').hidden = false;
  sheet.hidden = false;
  document.getElementById('app-shell').inert = true;
  document.documentElement.classList.add('sheet-open');
  sheet.focus();
  if (sectionId) {
    const section = document.getElementById(sectionId);
    if (section) section.scrollIntoView({ block: 'start' });
  }
}

function closeSettings() {
  document.getElementById('settings-backdrop').hidden = true;
  document.getElementById('settings-sheet').hidden = true;
  document.getElementById('app-shell').inert = false;
  document.documentElement.classList.remove('sheet-open');
  if (settingsReturnFocus && settingsReturnFocus.focus) settingsReturnFocus.focus();
  settingsReturnFocus = null;
}

function openManualPrice() {
  openSettings('settings-quote');
  document.getElementById('manual-price-details').open = true;
}

// ------------------------------ 하위 탭과 세그먼트 ------------------------------
const SUBTABS = { rescue: ['sim', 'scenario', 'backtest', 'alt'] };

function setSubTab(group, id) {
  SUBTABS[group].forEach(name => {
    const on = name === id;
    const tab = document.getElementById(`subtab-${group}-${name}`);
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
    document.getElementById(`panel-${group}-${name}`).classList.toggle('active', on);
  });
}

function setJournalSegment(segment) {
  const page = document.getElementById('view-journal');
  page.classList.toggle('journal-seg-rescue', segment === 'rescue');
  page.classList.toggle('journal-seg-growth', segment === 'growth');
  ['rescue', 'growth'].forEach(name => {
    const on = name === segment;
    const btn = document.getElementById(`segment-${name}`);
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', String(on));
  });
}

// ------------------------------ 프리셋 하이라이트 ------------------------------
// 프리셋 버튼의 선택 표시를 실제 값과 맞춘다. 프리셋에 없는 값이면 모두 해제된다
function syncPresetButtons(containerId, value) {
  const buttons = document.querySelectorAll(`#${containerId} button`);
  buttons.forEach(btn => {
    const on = isPresetMatch(value, btn.dataset.preset);
    btn.classList.toggle('active-preset', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

function isPresetMatch(value, preset) {
  return Math.abs(Number(value) - Number(preset)) < 0.05; // 호가 단위 반올림 오차는 같은 값으로 본다
}

// ------------------------------ 긴 표 접기 ------------------------------
const expandedTables = {};

function isTableExpanded(id) {
  return Boolean(expandedTables[id]);
}

function tableMoreHTML(id, total, shown) {
  if (total <= shown) return '';
  const label = isTableExpanded(id) ? '핵심 행만 보기' : `전체 ${total}행 보기`;
  return `<button type="button" class="text-link-btn table-more-btn" aria-expanded="${isTableExpanded(id)}" onclick="toggleTableRows('${id}')">${label}</button>`;
}

function toggleTableRows(id) {
  expandedTables[id] = !expandedTables[id];
  recalcGrowthMode(false);
}

// ------------------------------ 표 머리글을 칸에 연결 (모바일 카드형·숫자 정렬) ------------------------------
const NUMERIC_CELL = /^[-+▲▼]?\s*\$?\d[\d,]*(\.\d+)?\s*(%|주|일|회|개월)?(\s|$|\/|\()/;

function labelTable(table) {
  const headers = [...table.querySelectorAll('thead th')];
  const rows = [...table.querySelectorAll('tbody tr')];
  headers.forEach((th, col) => {
    const cells = rows.map(tr => tr.children[col]).filter(Boolean);
    const filled = cells.filter(td => !td.querySelector('input, select, button') && !['-', ''].includes(td.textContent.trim()));
    const numeric = col > 0 && filled.length > 0 && filled.filter(td => NUMERIC_CELL.test(td.textContent.trim())).length >= filled.length / 2;
    th.classList.toggle('num', numeric);
    cells.forEach(td => {
      td.dataset.label = th.textContent.trim();
      td.classList.toggle('num', numeric);
      td.classList.toggle('col-opt', th.classList.contains('col-opt'));
    });
  });
}

function labelAllTables() {
  document.querySelectorAll('.main-workspace table').forEach(labelTable);
}

// ------------------------------ 용어 풀이 팝오버 ------------------------------
function showTermPopover(el) {
  const pop = document.getElementById('term-popover');
  const key = el.dataset.term;
  pop.innerHTML = `<strong>${escapeHTML(key)}</strong>${escapeHTML(GLOSSARY[key] || '')}`;
  pop.hidden = false;
  const r = el.getBoundingClientRect();
  const width = pop.offsetWidth;
  const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
  const below = r.bottom + pop.offsetHeight + 12 < window.innerHeight;
  pop.style.left = `${left}px`;
  pop.style.top = `${below ? r.bottom + 6 : r.top - pop.offsetHeight - 6}px`;
}

function hideTermPopover() {
  document.getElementById('term-popover').hidden = true;
}

function initShell() {
  document.getElementById('glossary-list').innerHTML = Object.entries(GLOSSARY)
    .map(([key, text]) => `<div><dt>${escapeHTML(key)}</dt><dd>${escapeHTML(text)}</dd></div>`)
    .join('');

  document.addEventListener('click', e => {
    const term = e.target.closest('.term');
    if (term) {
      e.preventDefault();
      showTermPopover(term);
    } else {
      hideTermPopover();
    }
  });
  document.addEventListener('mouseover', e => {
    const term = e.target.closest('.term');
    if (term) showTermPopover(term);
  });
  document.addEventListener('mouseout', e => {
    if (e.target.closest('.term')) hideTermPopover();
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    hideTermPopover();
    if (!document.getElementById('settings-sheet').hidden) closeSettings();
  });
  window.addEventListener('scroll', hideTermPopover, { passive: true });

  labelAllTables();
  new MutationObserver(labelAllTables).observe(document.querySelector('.main-workspace'), { childList: true, subtree: true });
}
