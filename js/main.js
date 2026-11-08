// 앱 시작

let autoRefreshTimer = null;
let refreshMinute = 0;

// 초기 실행 및 60초마다 실시간 시세 자동 갱신
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('log-date').value = todayISO();
  document.getElementById('g-input-buy-date').value = todayISO();
  populateInputsFromState();
  switchView(appState.currentView || 'overview');
  recalcAll(false);
  recalcGrowthMode(false);
  fetchMarketDataAndAnalyze();

  if (autoRefreshTimer) clearInterval(autoRefreshTimer);
  autoRefreshTimer = setInterval(() => {
    refreshMinute += 1;
    const everyFiveMinutes = refreshMinute % 5 === 0;
    // 화면을 보고 있지 않을 때는 호출을 쉬되, 알림이 걸려 있으면 5분마다 확인한다
    if (!document.hidden || (everyFiveMinutes && hasActiveAlerts(appState.currentTicker))) {
      fetchMarketDataAndAnalyze(true);
    }
    if (everyFiveMinutes) checkOtherTickerAlerts();
  }, 60000);

  // 다른 앱을 보다 돌아왔을 때 시세가 오래됐으면 바로 다시 불러온다
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !isQuoteFresh(appState.tickers[appState.currentTicker])) {
      fetchMarketDataAndAnalyze(true);
    }
  });
});
