// 백업 코드·파일 내보내기와 복원

// PC <-> 모바일 3초 백업 코드 복사 / 복원 및 JSON 파일 내보내기 / 불러오기
function copyBackupCode() {
  try {
    const code = btoa(encodeURIComponent(JSON.stringify(appState)));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(() => {
        alert('✅ 백업 코드가 클립보드에 복사되었습니다!\n카카오톡 [나에게 보내기]나 메모장에 붙여넣은 뒤, 다른 기기의 설정 > 백업 코드 복원에 붙여넣으면 모든 기록이 즉시 동기화됩니다.');
      }).catch(() => {
        prompt('아래 백업 코드를 복사(Ctrl+C)해서 스마트폰에 붙여넣으세요:', code);
      });
    } else {
      prompt('아래 백업 코드를 복사(Ctrl+C)해서 스마트폰에 붙여넣으세요:', code);
    }
  } catch (e) {
    alert('백업 코드 생성 중 오류가 발생했습니다.');
  }
}

function pasteBackupCode() {
  const code = prompt('복사해 둔 백업 코드를 아래에 붙여넣기 해주세요:');
  if (!code || !code.trim()) return;
  try {
    const decoded = JSON.parse(decodeURIComponent(atob(code.trim())));
    if (!decoded || typeof decoded.tickers !== 'object' || !decoded.tickers.SOXL) {
      throw new Error('Invalid backup data');
    }
    appState = mergeWithDefaults(decoded);
    saveState();
    populateInputsFromState();
    recalcAll(false);
    recalcGrowthMode(false);
    alert('🎉 데이터 복원 및 동기화가 완료되었습니다!');
  } catch (e) {
    alert('❌ 올바르지 않은 백업 코드입니다. 복사한 전체 문자열을 다시 확인해 주세요.');
  }
}

function exportBackupFile() {
  try {
    const blob = new Blob([JSON.stringify(appState, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `soxl-tqqq-backup-${dateStr}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    alert('파일 저장 중 오류가 발생했습니다.');
  }
}

function importBackupFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed || typeof parsed.tickers !== 'object' || !parsed.tickers.SOXL) {
        throw new Error('Invalid JSON');
      }
      appState = mergeWithDefaults(parsed);
      saveState();
      populateInputsFromState();
      recalcAll(false);
      recalcGrowthMode(false);
      alert('🎉 백업 파일에서 모든 매매 기록과 계좌 설정을 성공적으로 불러왔습니다!');
    } catch (err) {
      alert('❌ 올바른 백업 JSON 파일이 아닙니다.');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}
