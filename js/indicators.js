// RSI·이동평균·볼린저밴드 계산

// =======================================================
// 기술적 지표 계산 함수 (RSI 14, 볼린저밴드 20, 이동평균선)
// =======================================================
function computeRSI(closes, period = 14) {
  if (!closes || closes.length <= period) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function computeSMA(values, period) {
  if (!values || values.length < period) return values[values.length - 1] || 0;
  const slice = values.slice(-period);
  const sum = slice.reduce((a, b) => a + b, 0);
  return sum / period;
}

function computeBollingerBands(closes, period = 20, mult = 2) {
  const sma = computeSMA(closes, period);
  const slice = closes.slice(-period);
  const variance = slice.reduce((acc, val) => acc + Math.pow(val - sma, 2), 0) / slice.length;
  const stdDev = Math.sqrt(variance);
  return {
    middle: sma,
    upper: sma + mult * stdDev,
    lower: sma - mult * stdDev
  };
}
