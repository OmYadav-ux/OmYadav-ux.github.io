/**
 * Technical Analysis Indicators
 */

/**
 * Calculates Simple Moving Average (SMA)
 * @param {number[]} prices
 * @param {number} period
 * @returns {(number|null)[]}
 */
export function calculateSMA(prices, period) {
  const sma = new Array(prices.length).fill(null);
  if (prices.length < period) return sma;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  sma[period - 1] = sum / period;

  for (let i = period; i < prices.length; i++) {
    sum = sum - prices[i - period] + prices[i];
    sma[i] = sum / period;
  }
  return sma;
}

/**
 * Calculates Exponential Moving Average (EMA)
 * @param {number[]} prices
 * @param {number} period
 * @returns {(number|null)[]}
 */
export function calculateEMA(prices, period) {
  const ema = new Array(prices.length).fill(null);
  if (prices.length < period) return ema;

  // Initialize first EMA value as SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let currentEma = sum / period;
  ema[period - 1] = currentEma;

  const multiplier = 2 / (period + 1);
  for (let i = period; i < prices.length; i++) {
    currentEma = (prices[i] - currentEma) * multiplier + currentEma;
    ema[i] = currentEma;
  }
  return ema;
}

/**
 * Calculates Relative Strength Index (RSI)
 * @param {number[]} prices
 * @param {number} period
 * @returns {(number|null)[]}
 */
export function calculateRSI(prices, period = 14) {
  const rsi = new Array(prices.length).fill(null);
  if (prices.length <= period) return rsi;

  let avgGain = 0;
  let avgLoss = 0;

  // Calculate first values
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) {
      avgGain += diff;
    } else {
      avgLoss -= diff;
    }
  }

  avgGain /= period;
  avgLoss /= period;

  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsi[i] = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi[i] = 100 - 100 / (1 + rs);
    }
  }

  return rsi;
}

/**
 * Calculates Moving Average Convergence Divergence (MACD)
 * @param {number[]} prices
 * @param {number} fastPeriod
 * @param {number} slowPeriod
 * @param {number} signalPeriod
 * @returns {{ macd: (number|null)[], signal: (number|null)[], histogram: (number|null)[] }}
 */
export function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const length = prices.length;
  const macdLine = new Array(length).fill(null);
  const signalLine = new Array(length).fill(null);
  const histogram = new Array(length).fill(null);

  const fastEma = calculateEMA(prices, fastPeriod);
  const slowEma = calculateEMA(prices, slowPeriod);

  // MACD line is fast EMA - slow EMA
  for (let i = 0; i < length; i++) {
    if (fastEma[i] !== null && slowEma[i] !== null) {
      macdLine[i] = fastEma[i] - slowEma[i];
    }
  }

  // Extract non-null MACD values to compute its EMA (Signal line)
  const firstMacdIdx = macdLine.findIndex(val => val !== null);
  if (firstMacdIdx === -1 || length - firstMacdIdx < signalPeriod) {
    return { macd: macdLine, signal: signalLine, histogram };
  }

  const validMacdSubset = macdLine.slice(firstMacdIdx);
  const signalSubset = calculateEMA(validMacdSubset, signalPeriod);

  // Put signal subset back into signalLine array aligned with index
  for (let i = 0; i < signalSubset.length; i++) {
    signalLine[firstMacdIdx + i] = signalSubset[i];
  }

  // Calculate Histogram = MACD - Signal
  for (let i = 0; i < length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      histogram[i] = macdLine[i] - signalLine[i];
    }
  }

  return { macd: macdLine, signal: signalLine, histogram };
}

/**
 * Calculates Bollinger Bands (BB)
 * @param {number[]} prices
 * @param {number} period
 * @param {number} stdDevMultiplier
 * @returns {{ middle: (number|null)[], upper: (number|null)[], lower: (number|null)[] }}
 */
export function calculateBollingerBands(prices, period = 20, stdDevMultiplier = 2) {
  const middle = calculateSMA(prices, period);
  const upper = new Array(prices.length).fill(null);
  const lower = new Array(prices.length).fill(null);

  for (let i = period - 1; i < prices.length; i++) {
    let varianceSum = 0;
    const mean = middle[i];

    for (let j = i - period + 1; j <= i; j++) {
      varianceSum += Math.pow(prices[j] - mean, 2);
    }

    const stdDev = Math.sqrt(varianceSum / period);
    upper[i] = mean + stdDevMultiplier * stdDev;
    lower[i] = mean - stdDevMultiplier * stdDev;
  }

  return { middle, upper, lower };
}

/**
 * Calculates Average True Range (ATR)
 * @param {{ high: number, low: number, close: number }[]} candles
 * @param {number} period
 * @returns {(number|null)[]}
 */
export function calculateATR(candles, period = 14) {
  const atr = new Array(candles.length).fill(null);
  if (candles.length <= period) return atr;

  const trueRanges = new Array(candles.length).fill(0);
  trueRanges[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const highLow = candles[i].high - candles[i].low;
    const highClosePrev = Math.abs(candles[i].high - candles[i - 1].close);
    const lowClosePrev = Math.abs(candles[i].low - candles[i - 1].close);
    trueRanges[i] = Math.max(highLow, highClosePrev, lowClosePrev);
  }

  // First ATR is the average of first 'period' True Ranges
  let sum = 0;
  for (let i = 1; i <= period; i++) {
    sum += trueRanges[i];
  }
  let currentAtr = sum / period;
  atr[period] = currentAtr;

  // Smoothed ATR calculation
  for (let i = period + 1; i < candles.length; i++) {
    currentAtr = (currentAtr * (period - 1) + trueRanges[i]) / period;
    atr[i] = currentAtr;
  }

  return atr;
}
