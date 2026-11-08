// 가격 알림: 시세가 갱신될 때 목표가 도달을 확인해 화면·브라우저·텔레그램으로 알린다.
// 서버가 없어서 이 페이지가 열려 있는 동안에만 동작한다.

const TELEGRAM_CONFIG_STORAGE = 'telegram_alert_config'; // 백업 코드에 넣지 않는 기기별 설정
const MAX_PRICE_ALERTS = 50;

function findTriggeredAlerts(alerts, price) {
  return (alerts || []).filter(a => a.active && (a.direction === 'above' ? price >= a.price : price <= a.price));
}

function hasActiveAlerts(ticker) {
  return (appState.tickers[ticker].alerts || []).some(a => a.active);
}

// 실제로 받아 온 시세로만 호출한다 (사용자가 입력칸에 친 가격으로는 울리지 않는다)
function checkPriceAlerts(ticker, price) {
  const t = appState.tickers[ticker];
  const triggered = findTriggeredAlerts(t.alerts, price);
  if (triggered.length === 0) return;

  const now = Date.now();
  triggered.forEach(a => {
    a.active = false;
    a.triggeredAt = now;
    a.triggeredPrice = Number(price.toFixed(2));
    notifyPriceAlert(ticker, a);
  });
  saveState();
  renderPriceAlerts();
}

function notifyPriceAlert(ticker, alertItem) {
  const title = `🔔 ${ticker} ${alertItem.label || '목표가'} ${formatUSD(alertItem.price)} 도달`;
  const body = `현재가 ${formatUSD(alertItem.triggeredPrice)} · 주문 전 증권사 앱의 가격을 확인하세요.`;
  showAlertToast(title, body);
  showBrowserNotification(title, body);
  sendTelegramMessage(`${title}\n${body}`).catch(e => {
    telegramLastError = e.message;
    renderAlertChannelStatus();
  });
}

function showAlertToast(title, body) {
  const area = document.getElementById('alert-toast-area');
  if (!area) return;
  const toast = document.createElement('div');
  toast.className = 'alert-toast';
  toast.innerHTML = `
    <div><strong>${escapeHTML(title)}</strong><span>${escapeHTML(body)}</span></div>
    <button type="button" onclick="this.parentElement.remove()" aria-label="닫기">✕</button>
  `;
  area.appendChild(toast);
}

function browserAlertPermission() {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

function showBrowserNotification(title, body) {
  if (browserAlertPermission() !== 'granted') return;
  try {
    new Notification(title, { body });
  } catch (e) {
    // 모바일 크롬은 이 방식의 알림을 막는다. 화면 알림과 텔레그램은 그대로 동작한다
  }
}

async function enableBrowserAlerts() {
  const permission = browserAlertPermission();
  if (permission === 'unsupported') {
    alert('이 브라우저는 알림을 지원하지 않습니다. 화면 알림 또는 텔레그램을 사용해 주세요.');
    return;
  }
  if (permission === 'denied') {
    alert('브라우저 설정에서 이 사이트의 알림이 차단되어 있습니다. 주소창 왼쪽의 사이트 설정에서 허용해 주세요.');
    return;
  }
  await Notification.requestPermission();
  renderAlertChannelStatus();
}

// ------------------------------ 텔레그램 ------------------------------
let telegramLastError = '';

function getTelegramConfig() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TELEGRAM_CONFIG_STORAGE));
    return parsed && parsed.token && parsed.chatId ? parsed : null;
  } catch (e) {
    return null;
  }
}

// 사전 요청(preflight)이 필요 없도록 폼 형식으로 보낸다
async function callTelegram(token, method, params = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QUOTE_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      body: new URLSearchParams(params),
      signal: controller.signal
    });
    const json = await res.json().catch(() => null);
    if (!json || !json.ok) throw new Error(json?.description || `HTTP ${res.status}`);
    return json.result;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('응답 시간 초과');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendTelegramMessage(text) {
  const config = getTelegramConfig();
  if (!config) return;
  await callTelegram(config.token, 'sendMessage', { chat_id: config.chatId, text });
  telegramLastError = '';
}

// 봇에게 메시지를 한 번 보내 두면 대화 ID를 자동으로 찾아 준다
async function detectTelegramChatId(token) {
  const updates = await callTelegram(token, 'getUpdates');
  const last = [...updates].reverse().find(u => u.message?.chat?.id);
  return last ? String(last.message.chat.id) : '';
}

async function setTelegramAlert() {
  const current = getTelegramConfig();
  const tokenInput = prompt(
    `텔레그램 봇 토큰을 입력해 주세요. (현재: ${current ? '연결됨' : '없음'})\n` +
    `텔레그램의 @BotFather에서 /newbot으로 만들고, 만든 봇에게 아무 메시지나 한 번 보낸 뒤 입력하세요.\n` +
    `토큰은 이 기기 브라우저에만 저장되며, 비워 두고 확인을 누르면 연결이 해제됩니다.`,
    ''
  );
  if (tokenInput === null) return;
  const token = tokenInput.trim();
  if (!token) {
    localStorage.removeItem(TELEGRAM_CONFIG_STORAGE);
    telegramLastError = '';
    renderAlertChannelStatus();
    return;
  }
  if (!/^\d+:[\w-]+$/.test(token)) {
    alert('봇 토큰 형식이 올바르지 않습니다. (예: 123456:ABC-DEF)');
    return;
  }

  let detected = '';
  try {
    detected = await detectTelegramChatId(token);
  } catch (e) {
    alert(`봇에 연결하지 못했습니다: ${e.message}`);
    return;
  }
  const chatInput = prompt('메시지를 받을 대화 ID를 확인해 주세요. (비어 있으면 봇에게 메시지를 먼저 보낸 뒤 다시 시도하세요)', detected);
  if (chatInput === null) return;
  const chatId = chatInput.trim();
  if (!/^-?\d+$/.test(chatId)) {
    alert('대화 ID 형식이 올바르지 않습니다.');
    return;
  }

  try {
    await callTelegram(token, 'sendMessage', { chat_id: chatId, text: '✅ SOXL·TQQQ 네비게이터 알림이 연결되었습니다.' });
    localStorage.setItem(TELEGRAM_CONFIG_STORAGE, JSON.stringify({ token, chatId }));
    telegramLastError = '';
    alert('연결되었습니다. 텔레그램에서 테스트 메시지를 확인해 주세요.');
  } catch (e) {
    alert(`테스트 메시지를 보내지 못했습니다: ${e.message}`);
  }
  renderAlertChannelStatus();
}

// ------------------------------ 알림 관리 ------------------------------
function addPriceAlert(price, label) {
  const ticker = appState.currentTicker;
  const t = appState.tickers[ticker];
  const target = Number(Number(price).toFixed(2));
  if (!(target > 0)) {
    alert('올바른 가격을 입력해 주세요.');
    return false;
  }
  if (target === Number(t.currentPrice.toFixed(2))) {
    alert('현재가와 같은 가격에는 알림을 걸 수 없습니다.');
    return false;
  }
  // 위·아래 방향을 현재가로 정하므로 오래된 가격이면 바로 울리거나 울리지 않을 수 있다
  if (!isQuoteFresh(t) && !confirm(`시세가 최신이 아닙니다 (현재 표시 ${formatUSD(t.currentPrice)}). 이 가격 기준으로 알림을 추가할까요?`)) {
    return false;
  }
  if (t.alerts.some(a => a.active && a.price === target)) {
    alert(`${formatUSD(target)} 알림이 이미 걸려 있습니다.`);
    return false;
  }
  if (t.alerts.length >= MAX_PRICE_ALERTS) {
    alert('알림이 너무 많습니다. 지난 알림을 지운 뒤 다시 추가해 주세요.');
    return false;
  }
  t.alerts.unshift({
    id: Date.now(),
    price: target,
    direction: target > t.currentPrice ? 'above' : 'below',
    label: String(label || '').slice(0, 40),
    active: true,
    createdAt: Date.now(),
    triggeredAt: 0,
    triggeredPrice: 0
  });
  saveState();
  renderPriceAlerts();
  return true;
}

function getAlertPresets(t) {
  const principal = getTotalPrincipal(t) || (t.shares * t.avgPrice);
  const breakeven = t.shares > 0 ? Math.max(0, principal - (t.reservedCash || 0)) / t.shares : 0;
  const presets = {};
  planOrders(t.dailyPlan).forEach(order => {
    presets[order.kind] = { label: order.kind === 'SELL' ? '오늘의 매도' : '오늘의 매수', icon: order.kind === 'SELL' ? '🔴' : '🟢', price: order.price };
  });
  presets.breakeven = { label: '본전', icon: '🎯', price: breakeven };
  return presets;
}

function addPresetAlert(kind) {
  const preset = getAlertPresets(appState.tickers[appState.currentTicker])[kind];
  if (preset) addPriceAlert(preset.price, preset.label);
}

function addCustomAlert() {
  const priceEl = document.getElementById('alert-price');
  const memoEl = document.getElementById('alert-memo');
  if (addPriceAlert(parseFloat(priceEl.value), memoEl.value.trim() || '목표가')) {
    priceEl.value = '';
    memoEl.value = '';
  }
}

function deletePriceAlert(id) {
  const t = appState.tickers[appState.currentTicker];
  t.alerts = t.alerts.filter(a => a.id !== id);
  saveState();
  renderPriceAlerts();
}

// ------------------------------ 화면 ------------------------------
function renderAlertChannelStatus() {
  const el = document.getElementById('alert-channel-status');
  if (!el) return;
  const permissionText = { granted: '켜짐', denied: '차단됨', default: '꺼짐', unsupported: '지원 안 함' }[browserAlertPermission()];
  const otherActive = Object.keys(appState.tickers)
    .filter(sym => sym !== appState.currentTicker)
    .reduce((sum, sym) => sum + appState.tickers[sym].alerts.filter(a => a.active).length, 0);
  el.innerHTML = `🖥️ 브라우저 알림: <strong>${permissionText}</strong> · ✈️ 텔레그램: <strong>${getTelegramConfig() ? '연결됨' : '미연결'}</strong>` +
    (telegramLastError ? ` <span class="alert-error">(마지막 전송 실패: ${escapeHTML(telegramLastError)})</span>` : '') +
    (otherActive ? ` · 다른 종목에 걸린 알림 ${otherActive}개` : '');
}

function formatAlertTime(ms) {
  return new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderPriceAlerts() {
  const listEl = document.getElementById('alert-list');
  if (!listEl) return;
  const t = appState.tickers[appState.currentTicker];
  const cur = t.currentPrice;

  renderAlertChannelStatus();
  const presets = getAlertPresets(t);
  document.getElementById('alert-presets').innerHTML = Object.entries(presets)
    .filter(([, p]) => p.price > 0)
    .map(([kind, p]) => `<button type="button" class="sync-chip-btn" onclick="addPresetAlert('${kind}')">${p.icon} ${p.label} ${formatUSD(p.price)}</button>`)
    .join('');

  if (t.alerts.length === 0) {
    listEl.innerHTML = `<div class="bt-placeholder">걸어 둔 알림이 없습니다. 위 버튼이나 직접 입력으로 추가해 주세요.</div>`;
    return;
  }

  const active = t.alerts.filter(a => a.active).sort((a, b) => b.price - a.price);
  const done = t.alerts.filter(a => !a.active).sort((a, b) => b.triggeredAt - a.triggeredAt);
  const row = (a, status) => `
    <div class="alert-row ${a.active ? '' : 'alert-row-done'}">
      <span class="alert-row-main"><strong>${a.direction === 'above' ? '▲' : '▼'} ${formatUSD(a.price)}</strong> ${escapeHTML(a.label)}</span>
      <span class="alert-row-status">${status}</span>
      <button type="button" class="btn-delete" onclick="deletePriceAlert(${a.id})">삭제</button>
    </div>`;
  listEl.innerHTML = [
    ...active.map(a => row(a, cur > 0 ? `현재가에서 ${formatBtSignedPct(a.price / cur - 1)}` : '대기 중')),
    ...done.map(a => row(a, `🔔 ${formatAlertTime(a.triggeredAt)} 도달 (${formatUSD(a.triggeredPrice)})`))
  ].join('');
}

// 지금 보고 있지 않은 종목의 알림도 확인한다 (그 종목의 화면 값은 건드리지 않는다)
async function checkOtherTickerAlerts() {
  const apiKey = getQuoteApiKey();
  for (const ticker of Object.keys(appState.tickers)) {
    if (ticker === appState.currentTicker || !hasActiveAlerts(ticker)) continue;
    try {
      const market = apiKey ? await fetchFromTwelveData(ticker, apiKey) : await fetchFromYahooProxies(ticker);
      checkPriceAlerts(ticker, market.livePrice);
    } catch (e) {
      // 다음 확인 때 다시 시도한다
    }
  }
}
