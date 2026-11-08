// 금액·날짜 표시와 기록 정렬

function formatUSD(val) {
  const num = Number(val) || 0;
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatKRW(usdVal) {
  const krw = Math.round((Number(usdVal) || 0) * (appState.exchangeRate || 1400));
  if (krw >= 100000000) {
    const eok = Math.floor(krw / 100000000);
    const man = Math.round((krw % 100000000) / 10000);
    return `약 ${eok}억 ${man.toLocaleString()}만 원`;
  }
  return `약 ${Math.round(krw / 10000).toLocaleString()}만 원`;
}

function formatSignedUSD(val) {
  const num = Number(val) || 0;
  return (num < 0 ? '-' : '+') + formatUSD(Math.abs(num));
}

function formatShareDelta(n) {
  return `${n >= 0 ? '+' : ''}${n.toLocaleString()}주`;
}

function escapeHTML(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// 로컬 기준 YYYY-MM-DD
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 체결일이 없는 예전 기록은 입력 시각(id = Date.now())을 체결일로 간주
function getTradeDate(item) {
  if (item.tradeDate) return item.tradeDate;
  const d = new Date(Number(item.id) || 0);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function displayTradeDate(item) {
  return item.tradeDate || item.date || getTradeDate(item);
}

// 기록은 최신순으로 보관한다 (체결일 내림차순, 같은 날은 입력 순서 내림차순)
function sortByTradeDate(list) {
  if (!list) return;
  list.sort((a, b) => {
    const da = getTradeDate(a);
    const db = getTradeDate(b);
    if (da !== db) return da < db ? 1 : -1;
    return (Number(b.id) || 0) - (Number(a.id) || 0);
  });
}
