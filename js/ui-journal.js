// 원금 탈출 매매 기록장

let editingLogId = null;

function toggleLogTypeHint() {
  const type = document.getElementById('log-type').value;
  const memoInput = document.getElementById('log-memo');
  const cashType = isCashLogType(type);
  document.getElementById('log-price-label').textContent = cashType ? '금액 ($)' : '체결 가격 ($)';
  document.getElementById('log-price').placeholder = cashType ? '예: 5000' : '예: 50.10';
  document.getElementById('log-shares-group').style.display = cashType ? 'none' : '';
  document.getElementById('log-shares').required = !cashType;
  if (type === 'SELL') {
    memoInput.placeholder = '예: $45.0 이하에서 재매수 대기';
  } else if (type === 'DEPOSIT') {
    memoInput.placeholder = '예: 월급에서 추가 투입';
  } else if (type === 'WITHDRAW') {
    memoInput.placeholder = '예: 생활비로 일부 인출';
  } else {
    memoInput.placeholder = '예: 확보 현금으로 저점 재매수 완료!';
  }
}

// 원금 탈출 체결 한 건을 기록하고 잔고를 다시 계산한다. 막힌 입력이면 null
function recordRescueTrade(t, { type, price, shares, tradeDate, memo }) {
  ensurePrincipalAnchor(t);

  if (type === 'SELL' && shares > t.shares) {
    alert('현재 보유 주식 수보다 많이 매도할 수 없습니다.');
    return null;
  }
  if (type === 'WITHDRAW' && price > (t.reservedCash || 0)) {
    alert(`보유 구출 현금(${formatUSD(t.reservedCash || 0)})보다 많이 인출할 수 없습니다.`);
    return null;
  }

  const record = {
    id: Date.now(),
    tradeDate,
    type,
    price,
    shares,
    amount: Number((price * shares).toFixed(2)),
    memo
  };
  t.logs.unshift(record);
  recalculateRescueBalanceFromLogs(t);
  return record;
}

function addTradeLog(e) {
  e.preventDefault();
  const t = appState.tickers[appState.currentTicker];
  const type = document.getElementById('log-type').value;
  const price = parseFloat(document.getElementById('log-price').value);
  const shares = isCashLogType(type) ? 1 : parseFloat(document.getElementById('log-shares').value);
  const memo = document.getElementById('log-memo').value.trim();
  const tradeDate = document.getElementById('log-date').value || todayISO();

  if (!price || !shares || price <= 0 || shares <= 0) return;
  if (!recordRescueTrade(t, { type, price, shares, tradeDate, memo })) return;

  document.getElementById('log-price').value = '';
  document.getElementById('log-shares').value = '';
  document.getElementById('log-memo').value = '';

  saveState();
  populateInputsFromState();
  recalcAll(false);
}

function startEditLog(id) {
  editingLogId = id;
  renderLogs();
}

function cancelEditLog() {
  editingLogId = null;
  renderLogs();
}

function saveEditLog(id) {
  const t = appState.tickers[appState.currentTicker];
  const item = t.logs.find(l => l.id === id);
  if (!item) return;

  const newType = document.getElementById(`edit-log-type-${id}`)?.value || item.type;
  const newPrice = parseFloat(document.getElementById(`edit-log-price-${id}`)?.value);
  const newShares = isCashLogType(newType) ? 1 : parseFloat(document.getElementById(`edit-log-shares-${id}`)?.value);
  const newMemo = document.getElementById(`edit-log-memo-${id}`)?.value.trim() || '';
  const newDate = document.getElementById(`edit-log-date-${id}`)?.value;

  if (!newPrice || !newShares || newPrice <= 0 || newShares <= 0) {
    alert('올바른 체결 가격(금액)과 수량을 입력해 주세요.');
    return;
  }

  if (newDate) item.tradeDate = newDate;
  item.type = newType;
  item.price = newPrice;
  item.shares = newShares;
  item.amount = Number((newPrice * newShares).toFixed(2));
  item.memo = newMemo;

  editingLogId = null;
  recalculateRescueBalanceFromLogs(t);
  saveState();
  populateInputsFromState();
  recalcAll(false);
}

function deleteLog(id) {
  const t = appState.tickers[appState.currentTicker];
  t.logs = t.logs.filter(item => item.id !== id);
  if (editingLogId === id) editingLogId = null;
  recalculateRescueBalanceFromLogs(t);
  saveState();
  populateInputsFromState();
  recalcAll(false);
}

function renderLogs() {
  renderJournalAnalytics();
  const t = appState.tickers[appState.currentTicker];
  const tbody = document.getElementById('log-tbody');
  tbody.innerHTML = '';

  if (!t.logs || t.logs.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 24px;">
          아직 기록된 구출 작전 내역이 없습니다. 반등 시 일부 매도하거나 재매수했을 때 기록해 보세요!
        </td>
      </tr>
    `;
    return;
  }

  t.logs.forEach(item => {
    const tr = document.createElement('tr');
    const isSell = item.type === 'SELL';
    const isCash = isCashLogType(item.type);
    const badge = {
      SELL: `<span style="color: var(--accent-red); font-weight: 700;">🔴 일부 매도</span>`,
      BUY: `<span style="color: var(--accent-green); font-weight: 700;">🟢 저점 재매수</span>`,
      DEPOSIT: `<span style="color: var(--accent-blue); font-weight: 700;">💵 외부 자금 입금</span>`,
      WITHDRAW: `<span style="color: #b45309; font-weight: 700;">🏧 구출 현금 인출</span>`
    }[item.type];
    const typeOptions = [
      ['SELL', '🔴 일부 매도'], ['BUY', '🟢 저점 재매수'], ['DEPOSIT', '💵 외부 자금 입금'], ['WITHDRAW', '🏧 구출 현금 인출']
    ].map(([v, label]) => `<option value="${v}" ${item.type === v ? 'selected' : ''}>${label}</option>`).join('');

    const rebuyGuide = isSell
      ? `-10%: <strong>$${(item.price * 0.9).toFixed(2)}</strong> / -15%: <strong>$${(item.price * 0.85).toFixed(2)}</strong>`
      : `-`;

    if (editingLogId === item.id) {
      tr.innerHTML = `
        <td><input type="date" id="edit-log-date-${item.id}" class="inline-edit-input" value="${getTradeDate(item)}" /></td>
        <td>
          <select id="edit-log-type-${item.id}" class="inline-edit-select">${typeOptions}</select>
        </td>
        <td><input type="number" id="edit-log-price-${item.id}" class="inline-edit-input" step="0.01" value="${item.price}" /></td>
        <td><input type="number" id="edit-log-shares-${item.id}" class="inline-edit-input" step="0.01" value="${item.shares}" /></td>
        <td><span style="color:var(--text-muted);font-size:0.8rem;">저장 시 자동계산</span></td>
        <td>${rebuyGuide}</td>
        <td><input type="text" id="edit-log-memo-${item.id}" class="inline-edit-input" value="${escapeHTML(item.memo)}" /></td>
        <td>
          <div class="action-btn-group">
            <button type="button" class="btn-save-inline" onclick="saveEditLog(${item.id})">💾 저장</button>
            <button type="button" class="btn-cancel-inline" onclick="cancelEditLog()">취소</button>
          </div>
        </td>
      `;
    } else {
      tr.innerHTML = `
        <td>${escapeHTML(displayTradeDate(item))}</td>
        <td>${badge}</td>
        <td><strong>${isCash ? '-' : formatUSD(item.price)}</strong></td>
        <td>${isCash ? '-' : `${item.shares}주`}</td>
        <td>${item.type === 'WITHDRAW' ? '-' : ''}${formatUSD(item.amount)}</td>
        <td>${rebuyGuide}</td>
        <td>${escapeHTML(item.memo) || '-'}</td>
        <td>
          <div class="action-btn-group">
            <button type="button" class="btn-edit" onclick="startEditLog(${item.id})">✏️ 수정</button>
            <button type="button" class="btn-delete" onclick="deleteLog(${item.id})">삭제</button>
          </div>
        </td>
      `;
    }
    tbody.appendChild(tr);
  });
}
