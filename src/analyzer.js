import {
  calculateEMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR
} from './indicators.js';

/**
 * ═══════════════════════════════════════════════════
 *  4-LANE MARKET ANALYZER — Inspired by Deeepr.ai
 * ═══════════════════════════════════════════════════
 *
 *  Lane T (Technical) — EMA, RSI, MACD, Bollinger
 *  Lane F (Flow)      — Funding Rate, OI, Long/Short
 *  Lane N (Narrative)  — Fear & Greed Index
 *  Lane M (Macro)      — Proxy from BTC dominance signals
 *
 *  Synthesizer cross-checks lanes → single verdict
 *  with Entry, SL, TP1, TP2 and confidence tier.
 * ═══════════════════════════════════════════════════
 */

// ──────────────────────────────
// LANE T: TECHNICAL ANALYSIS
// ──────────────────────────────

function analyzeTechnicalLane(candles) {
  const closes = candles.map(c => c.close);

  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const macdData = calculateMACD(closes, 12, 26, 9);
  const bb = calculateBollingerBands(closes, 20, 2);
  const atr = calculateATR(candles, 14);

  const idx = candles.length - 1;
  const currentPrice = closes[idx];
  const currentRsi = rsi[idx];
  const currentMacd = macdData.macd[idx];
  const currentSignal = macdData.signal[idx];
  const currentHist = macdData.histogram[idx];
  const currentBB = { middle: bb.middle[idx], upper: bb.upper[idx], lower: bb.lower[idx] };
  const currentAtr = atr[idx] || (candles[idx].high - candles[idx].low || currentPrice * 0.01);

  const prevPrice = closes[idx - 1];
  const prevRsi = rsi[idx - 1];
  const prevMacd = macdData.macd[idx - 1];
  const prevSignal = macdData.signal[idx - 1];
  const prevHist = macdData.histogram[idx - 1];
  const prevEma9 = ema9[idx - 1];
  const prevEma21 = ema21[idx - 1];

  let bullish = 0;
  let bearish = 0;
  const reasons = [];

  // RSI Rules
  if (currentRsi !== null) {
    if (currentRsi < 30) {
      bullish += 2.5;
      reasons.push({ type: 'bullish', text: `RSI oversold at ${currentRsi.toFixed(1)}` });
    } else if (currentRsi > 70) {
      bearish += 2.5;
      reasons.push({ type: 'bearish', text: `RSI overbought at ${currentRsi.toFixed(1)}` });
    }
    if (prevRsi !== null && prevRsi < 30 && currentRsi >= 30) {
      bullish += 3;
      reasons.push({ type: 'bullish', text: `RSI crossed above 30 — momentum return` });
    } else if (prevRsi !== null && prevRsi > 70 && currentRsi <= 70) {
      bearish += 3;
      reasons.push({ type: 'bearish', text: `RSI crossed below 70 — reversal starting` });
    }
  }

  // EMA Crossover Rules
  if (ema9[idx] !== null && ema21[idx] !== null) {
    if (ema9[idx] > ema21[idx]) {
      bullish += 1;
      if (prevEma9 !== null && prevEma21 !== null && prevEma9 <= prevEma21) {
        bullish += 3;
        reasons.push({ type: 'bullish', text: `EMA 9/21 bullish crossover` });
      }
    } else {
      bearish += 1;
      if (prevEma9 !== null && prevEma21 !== null && prevEma9 >= prevEma21) {
        bearish += 3;
        reasons.push({ type: 'bearish', text: `EMA 9/21 bearish crossover` });
      }
    }
  }

  // EMA 200 trend
  if (ema200[idx] !== null) {
    if (currentPrice > ema200[idx]) {
      bullish += 1.5;
      reasons.push({ type: 'bullish', text: `Above EMA 200 — bullish structure` });
    } else {
      bearish += 1.5;
      reasons.push({ type: 'bearish', text: `Below EMA 200 — bearish structure` });
    }
  }

  // MACD Rules
  if (currentMacd !== null && currentSignal !== null) {
    if (prevMacd <= prevSignal && currentMacd > currentSignal) {
      bullish += 3.5;
      reasons.push({ type: 'bullish', text: `MACD golden cross` });
    } else if (prevMacd >= prevSignal && currentMacd < currentSignal) {
      bearish += 3.5;
      reasons.push({ type: 'bearish', text: `MACD death cross` });
    }
    if (currentHist > 0) bullish += 0.5;
    else if (currentHist < 0) bearish += 0.5;
  }

  // Bollinger Bands Rules
  if (currentBB.upper !== null && currentBB.lower !== null) {
    const range = currentBB.upper - currentBB.lower;
    if (currentPrice - currentBB.lower < range * 0.1) {
      bullish += 2;
      reasons.push({ type: 'bullish', text: `Price near lower Bollinger Band` });
    } else if (currentBB.upper - currentPrice < range * 0.1) {
      bearish += 2;
      reasons.push({ type: 'bearish', text: `Price near upper Bollinger Band` });
    }
  }

  const diff = bullish - bearish;
  let bias = 'NEUTRAL';
  if (diff >= 3) bias = 'BULL';
  else if (diff <= -3) bias = 'BEAR';

  let tier = 'LOW';
  if (Math.abs(diff) >= 6) tier = 'HIGH';
  else if (Math.abs(diff) >= 3) tier = 'MOD';

  return {
    lane: 'T',
    name: 'Technical',
    bias,
    tier,
    scores: { bullish, bearish, diff },
    reasons: reasons.length > 0 ? reasons : [{ type: 'neutral', text: 'Indicators are neutral' }],
    indicators: {
      price: currentPrice,
      rsi: currentRsi,
      macd: { macd: currentMacd, signal: currentSignal, hist: currentHist },
      ema9: ema9[idx], ema21: ema21[idx], ema50: ema50[idx], ema200: ema200[idx],
      bollinger: currentBB,
      atr: currentAtr
    },
    detail: `RSI ${currentRsi ? currentRsi.toFixed(0) : '--'} · ${ema200[idx] && currentPrice > ema200[idx] ? 'Above' : 'Below'} EMA200 · MACD ${currentHist > 0 ? 'bull' : 'bear'}`
  };
}

// ──────────────────────────────
// LANE F: FLOW (Derivatives)
// ──────────────────────────────

function analyzeFlowLane(flowData) {
  let bullish = 0;
  let bearish = 0;
  const reasons = [];

  if (!flowData) {
    return {
      lane: 'F', name: 'Flow', bias: 'NEUTRAL', tier: 'LOW',
      scores: { bullish: 0, bearish: 0, diff: 0 },
      reasons: [{ type: 'neutral', text: 'Flow data unavailable' }],
      data: {},
      detail: 'No data'
    };
  }

  const { fundingRate, oiChangePercent, longShortRatio } = flowData;

  // Funding Rate Analysis
  // Positive funding = longs pay shorts → overheated longs
  // Negative funding = shorts pay longs → overheated shorts
  if (fundingRate > 0.01) {
    bearish += 2;
    reasons.push({ type: 'bearish', text: `Funding rate elevated (${(fundingRate * 100).toFixed(3)}%) — longs overcrowded` });
  } else if (fundingRate < -0.01) {
    bullish += 2;
    reasons.push({ type: 'bullish', text: `Funding rate negative (${(fundingRate * 100).toFixed(3)}%) — shorts overcrowded` });
  } else if (Math.abs(fundingRate) <= 0.01) {
    // Neutral funding is a healthy sign in a trend
    reasons.push({ type: 'neutral', text: `Funding neutral (${(fundingRate * 100).toFixed(3)}%)` });
  }

  // OI Change Analysis
  // Rising OI = new money entering (confirms trend)
  // Falling OI = positions closing (trend weakening)
  if (oiChangePercent > 5) {
    bullish += 2;
    reasons.push({ type: 'bullish', text: `OI rising +${oiChangePercent.toFixed(1)}% — new money entering` });
  } else if (oiChangePercent < -5) {
    bearish += 1.5;
    reasons.push({ type: 'bearish', text: `OI declining ${oiChangePercent.toFixed(1)}% — positions closing` });
  }

  // Long/Short Ratio
  // > 1.5 = very long heavy → could squeeze
  // < 0.7 = very short heavy → could squeeze up
  if (longShortRatio > 1.5) {
    bearish += 1.5;
    reasons.push({ type: 'bearish', text: `Long/Short ratio ${longShortRatio.toFixed(2)} — crowded longs` });
  } else if (longShortRatio < 0.7) {
    bullish += 1.5;
    reasons.push({ type: 'bullish', text: `Long/Short ratio ${longShortRatio.toFixed(2)} — crowded shorts, squeeze potential` });
  } else if (longShortRatio > 1.0) {
    bullish += 0.5;
    reasons.push({ type: 'bullish', text: `Longs leading (${longShortRatio.toFixed(2)})` });
  } else {
    bearish += 0.5;
    reasons.push({ type: 'bearish', text: `Shorts leading (${longShortRatio.toFixed(2)})` });
  }

  const diff = bullish - bearish;
  let bias = 'NEUTRAL';
  if (diff >= 2) bias = 'BULL';
  else if (diff <= -2) bias = 'BEAR';

  let tier = 'LOW';
  if (Math.abs(diff) >= 4) tier = 'HIGH';
  else if (Math.abs(diff) >= 2) tier = 'MOD';

  return {
    lane: 'F',
    name: 'Flow',
    bias,
    tier,
    scores: { bullish, bearish, diff },
    reasons: reasons.length > 0 ? reasons : [{ type: 'neutral', text: 'Flow conditions are balanced' }],
    data: flowData,
    detail: `OI ${oiChangePercent >= 0 ? '+' : ''}${oiChangePercent.toFixed(0)}% · Funding ${(fundingRate * 100).toFixed(3)}% · L/S ${longShortRatio.toFixed(2)}`
  };
}

// ──────────────────────────────
// LANE N: NARRATIVE (Sentiment)
// ──────────────────────────────

function analyzeNarrativeLane(fearGreed) {
  let bullish = 0;
  let bearish = 0;
  const reasons = [];

  if (!fearGreed || fearGreed.value === 50) {
    return {
      lane: 'N', name: 'Narrative', bias: 'NEUTRAL', tier: 'LOW',
      scores: { bullish: 0, bearish: 0, diff: 0 },
      reasons: [{ type: 'neutral', text: 'Sentiment data unavailable or neutral' }],
      data: fearGreed || {},
      detail: 'No data'
    };
  }

  const value = fearGreed.value;
  const classification = fearGreed.classification;

  // Extreme Fear = Contrarian Bullish
  // Extreme Greed = Contrarian Bearish
  if (value <= 20) {
    bullish += 3;
    reasons.push({ type: 'bullish', text: `Extreme Fear (${value}) — historically a buying zone` });
  } else if (value <= 35) {
    bullish += 1.5;
    reasons.push({ type: 'bullish', text: `Fear zone (${value}) — sentiment is pessimistic` });
  } else if (value >= 80) {
    bearish += 3;
    reasons.push({ type: 'bearish', text: `Extreme Greed (${value}) — market euphoria, correction likely` });
  } else if (value >= 65) {
    bearish += 1.5;
    reasons.push({ type: 'bearish', text: `Greed zone (${value}) — sentiment is overconfident` });
  } else {
    reasons.push({ type: 'neutral', text: `Neutral sentiment (${value} — ${classification})` });
  }

  const diff = bullish - bearish;
  let bias = 'NEUTRAL';
  if (diff >= 1.5) bias = 'BULL';
  else if (diff <= -1.5) bias = 'BEAR';

  let tier = 'LOW';
  if (Math.abs(diff) >= 3) tier = 'HIGH';
  else if (Math.abs(diff) >= 1.5) tier = 'MOD';

  return {
    lane: 'N',
    name: 'Narrative',
    bias,
    tier,
    scores: { bullish, bearish, diff },
    reasons,
    data: fearGreed,
    detail: `Fear & Greed: ${value} (${classification})`
  };
}

// ──────────────────────────────
// LANE M: MACRO (Market Structure)
// ──────────────────────────────

function analyzeMacroLane(candles, flowData) {
  // Using candle-derived proxy signals for macro health:
  // 1. Volume trend (rising volume = healthy trend)
  // 2. Volatility compression/expansion via ATR
  // 3. Price position relative to recent range

  let bullish = 0;
  let bearish = 0;
  const reasons = [];
  const idx = candles.length - 1;
  const closes = candles.map(c => c.close);
  const atr = calculateATR(candles, 14);
  const currentAtr = atr[idx] || 0;

  // Volume Analysis — compare recent 5-bar avg volume to 20-bar avg
  const recentVol = candles.slice(-5).reduce((sum, c) => sum + c.volume, 0) / 5;
  const avgVol = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
  const volRatio = avgVol > 0 ? recentVol / avgVol : 1;

  if (volRatio > 1.3) {
    bullish += 1;
    reasons.push({ type: 'bullish', text: `Volume surge (${(volRatio * 100 - 100).toFixed(0)}% above average) — strong participation` });
  } else if (volRatio < 0.7) {
    bearish += 0.5;
    reasons.push({ type: 'bearish', text: `Volume declining (${(100 - volRatio * 100).toFixed(0)}% below average) — weak interest` });
  }

  // Price position in 50-candle range
  const last50 = candles.slice(-50);
  const rangeHigh = Math.max(...last50.map(c => c.high));
  const rangeLow = Math.min(...last50.map(c => c.low));
  const range = rangeHigh - rangeLow;
  const pricePosition = range > 0 ? (closes[idx] - rangeLow) / range : 0.5;

  if (pricePosition > 0.8) {
    bullish += 1.5;
    reasons.push({ type: 'bullish', text: `Price in upper range (${(pricePosition * 100).toFixed(0)}th percentile) — strength` });
  } else if (pricePosition < 0.2) {
    bearish += 1;
    bullish += 0.5; // Also potential reversal point
    reasons.push({ type: 'neutral', text: `Price at range bottom (${(pricePosition * 100).toFixed(0)}th percentile) — weak but potential bounce` });
  }

  // ATR volatility regime — compare current ATR to 50-candle average ATR
  const atrValues = atr.filter(a => a !== null);
  const avgAtr = atrValues.length > 0 ? atrValues.slice(-50).reduce((s, v) => s + v, 0) / Math.min(atrValues.length, 50) : currentAtr;
  const atrRatio = avgAtr > 0 ? currentAtr / avgAtr : 1;

  if (atrRatio > 1.5) {
    reasons.push({ type: 'bearish', text: `High volatility regime (ATR ${(atrRatio * 100 - 100).toFixed(0)}% above norm) — risk elevated` });
    bearish += 1;
  } else if (atrRatio < 0.7) {
    reasons.push({ type: 'bullish', text: `Low volatility (compression) — breakout potential building` });
    bullish += 1;
  }

  const diff = bullish - bearish;
  let bias = 'NEUTRAL';
  if (diff >= 1.5) bias = 'BULL';
  else if (diff <= -1.5) bias = 'BEAR';

  let tier = 'LOW';
  if (Math.abs(diff) >= 3) tier = 'HIGH';
  else if (Math.abs(diff) >= 1.5) tier = 'MOD';

  return {
    lane: 'M',
    name: 'Macro',
    bias,
    tier,
    scores: { bullish, bearish, diff },
    reasons: reasons.length > 0 ? reasons : [{ type: 'neutral', text: 'Macro conditions are neutral' }],
    data: { volRatio, pricePosition, atrRatio },
    detail: `Vol ${volRatio > 1 ? '+' : ''}${((volRatio - 1) * 100).toFixed(0)}% · Range pos ${(pricePosition * 100).toFixed(0)}%`
  };
}

// ──────────────────────────────────
// SYNTHESIZER — Verdict Generator
// ──────────────────────────────────

/**
 * Synthesizes all 4 lanes into a final verdict
 * @param {object[]} lanes - Array of lane analysis results
 * @param {number} currentPrice
 * @param {number} currentAtr
 * @param {{ time, open, high, low, close, volume }[]} candles
 * @param {{ riskRewardRatio: number, atrMultiplier: number }} options
 */
function synthesize(lanes, currentPrice, currentAtr, candles, options) {
  // Weight lanes differently — Technical has highest weight
  const weights = { T: 3, F: 2, N: 1, M: 1.5 };

  let totalBullScore = 0;
  let totalBearScore = 0;
  let alignedBull = 0;
  let alignedBear = 0;

  lanes.forEach(lane => {
    const w = weights[lane.lane] || 1;
    if (lane.bias === 'BULL') {
      totalBullScore += lane.scores.diff * w;
      alignedBull++;
    } else if (lane.bias === 'BEAR') {
      totalBearScore += Math.abs(lane.scores.diff) * w;
      alignedBear++;
    }
  });

  const netScore = totalBullScore - totalBearScore;
  const totalLanes = lanes.length;

  // Determine verdict
  let signal = 'HOLD';
  let confidence = 'Neutral';

  if (netScore >= 8) {
    signal = 'STRONG_BUY';
    confidence = 'Strong Bullish';
  } else if (netScore >= 3) {
    signal = 'BUY';
    confidence = 'Moderate Bullish';
  } else if (netScore <= -8) {
    signal = 'STRONG_SELL';
    confidence = 'Strong Bearish';
  } else if (netScore <= -3) {
    signal = 'SELL';
    confidence = 'Moderate Bearish';
  }

  // Confidence Tier based on lane alignment
  let tier = 'LOW';
  const maxAligned = Math.max(alignedBull, alignedBear);
  if (maxAligned >= 4) tier = 'HIGH';
  else if (maxAligned >= 3) tier = 'HIGH';
  else if (maxAligned >= 2) tier = 'MOD';

  // If signal is just HOLD, tier is always LOW
  if (signal === 'HOLD') tier = 'LOW';

  const lanesAligned = `${maxAligned} / ${totalLanes} lanes aligned`;

  // Calculate Entry, SL, TP1, TP2
  let entry = currentPrice;
  let sl = 0, tp1 = 0, tp2 = 0;

  const last5Candles = candles.slice(-5);
  const localLow = Math.min(...last5Candles.map(c => c.low));
  const localHigh = Math.max(...last5Candles.map(c => c.high));

  if (signal.includes('BUY')) {
    const atrDistance = currentAtr * options.atrMultiplier;
    const buffer = currentPrice * 0.001;
    sl = Math.min(currentPrice - atrDistance, localLow - buffer);
    const riskDistance = currentPrice - sl;
    tp1 = currentPrice + (riskDistance * 1.0);  // TP1 at 1:1 R:R
    tp2 = currentPrice + (riskDistance * options.riskRewardRatio);  // TP2 at user R:R
  } else if (signal.includes('SELL')) {
    const atrDistance = currentAtr * options.atrMultiplier;
    const buffer = currentPrice * 0.001;
    sl = Math.max(currentPrice + atrDistance, localHigh + buffer);
    const riskDistance = sl - currentPrice;
    tp1 = currentPrice - (riskDistance * 1.0);
    tp2 = currentPrice - (riskDistance * options.riskRewardRatio);
  }

  // Calculate R:R ratio
  const riskDistance = Math.abs(entry - sl);
  const rewardDistance = Math.abs(tp2 - entry);
  const rrRatio = riskDistance > 0 ? (rewardDistance / riskDistance).toFixed(1) : '0.0';

  return {
    signal,
    confidence,
    tier,
    lanesAligned,
    scores: {
      bullish: totalBullScore,
      bearish: totalBearScore,
      net: netScore,
      alignedBull,
      alignedBear
    },
    entry,
    sl,
    tp1,
    tp2,
    rrRatio,
    atr: currentAtr
  };
}

// ──────────────────────────────────
// MAIN EXPORT — analyzeChart
// ──────────────────────────────────

/**
 * Full 4-Lane market analysis
 * @param {{ time, open, high, low, close, volume }[]} candles
 * @param {object} flowData - from fetchFlowData()
 * @param {object} fearGreed - from fetchFearGreedIndex()
 * @param {{ riskRewardRatio: number, atrMultiplier: number }} options
 * @returns {object} Complete analysis result with lanes and verdict
 */
export function analyzeChart(candles, flowData = null, fearGreed = null, options = { riskRewardRatio: 2.0, atrMultiplier: 1.5 }) {
  if (candles.length < 50) {
    return {
      status: 'INSUFFICIENT_DATA',
      message: 'Need at least 50 candlesticks to run analysis.',
      verdict: {
        signal: 'HOLD', confidence: 'Neutral', tier: 'LOW',
        lanesAligned: '0 / 4', entry: 0, sl: 0, tp1: 0, tp2: 0, rrRatio: '0.0', atr: 0,
        scores: { bullish: 0, bearish: 0, net: 0, alignedBull: 0, alignedBear: 0 }
      },
      lanes: []
    };
  }

  // Run all 4 lanes independently
  const technicalLane = analyzeTechnicalLane(candles);
  const flowLane = analyzeFlowLane(flowData);
  const narrativeLane = analyzeNarrativeLane(fearGreed);
  const macroLane = analyzeMacroLane(candles, flowData);

  const lanes = [technicalLane, flowLane, narrativeLane, macroLane];

  // Synthesize verdict
  const currentPrice = candles[candles.length - 1].close;
  const currentAtr = technicalLane.indicators.atr;

  const verdict = synthesize(lanes, currentPrice, currentAtr, candles, options);

  return {
    status: 'SUCCESS',
    verdict,
    lanes,
    indicators: technicalLane.indicators
  };
}
