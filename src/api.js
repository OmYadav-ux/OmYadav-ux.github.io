/**
 * Binance API Wrapper + External Data Sources
 * Supports: Spot Klines, Futures Flow Data, Fear & Greed Index
 */

const BASE_URL = 'https://api.binance.com/api/v3';
const FUTURES_URL = 'https://fapi.binance.com';
const WS_BASE_URL = 'wss://stream.binance.com:9443/ws';

let socket = null;

/**
 * Fetches historical candlestick data from Binance
 */
export async function fetchKlines(symbol, interval, limit = 300) {
  try {
    const response = await fetch(
      `${BASE_URL}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch klines: ${response.statusText}`);
    }
    const data = await response.json();
    return data.map(item => ({
      time: Math.floor(item[0] / 1000),
      open: parseFloat(item[1]),
      high: parseFloat(item[2]),
      low: parseFloat(item[3]),
      close: parseFloat(item[4]),
      volume: parseFloat(item[5])
    }));
  } catch (error) {
    console.error('Error fetching historical candles:', error);
    throw error;
  }
}

/**
 * Subscribes to real-time candlestick updates via WebSocket
 */
export function subscribeKlines(symbol, interval, onUpdate) {
  if (socket) {
    socket.close();
  }

  const symLower = symbol.toLowerCase();
  const wsUrl = `${WS_BASE_URL}/${symLower}@kline_${interval}`;

  socket = new WebSocket(wsUrl);

  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.e === 'kline') {
        const kline = data.k;
        const update = {
          time: Math.floor(kline.t / 1000),
          open: parseFloat(kline.o),
          high: parseFloat(kline.h),
          low: parseFloat(kline.l),
          close: parseFloat(kline.c),
          volume: parseFloat(kline.v),
          isClosed: kline.x
        };
        onUpdate(update);
      }
    } catch (err) {
      console.error('Error parsing WebSocket message:', err);
    }
  };

  socket.onerror = (error) => {
    console.error('WebSocket Error:', error);
  };

  socket.onclose = (event) => {
    console.log('WebSocket Connection Closed:', event.reason);
  };
}

/**
 * Unsubscribes from current candlestick WebSocket stream
 */
export function unsubscribeKlines() {
  if (socket) {
    socket.close();
    socket = null;
  }
}

let tickerSocket = null;

/**
 * Subscribes to real-time 24hr rolling ticker updates
 * @param {string} symbol - e.g. 'BTCUSDT'
 * @param {function} onUpdate - callback triggered on tick
 */
export function subscribeTicker(symbol, onUpdate) {
  if (tickerSocket) {
    tickerSocket.close();
  }

  const symLower = symbol.toLowerCase();
  const wsUrl = `${WS_BASE_URL}/${symLower}@ticker`;

  tickerSocket = new WebSocket(wsUrl);

  tickerSocket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.e === '24hrTicker') {
        onUpdate({
          price: parseFloat(data.c),
          changeRaw: parseFloat(data.p),
          changePct: parseFloat(data.P),
          high: parseFloat(data.h),
          low: parseFloat(data.l)
        });
      }
    } catch (err) {
      console.error('Error parsing Ticker WebSocket message:', err);
    }
  };
}

export function unsubscribeTicker() {
  if (tickerSocket) {
    tickerSocket.close();
    tickerSocket = null;
  }
}

// ──────────────────────────────────────────────────
// FLOW LANE DATA — Binance Futures Public Endpoints
// ──────────────────────────────────────────────────

/**
 * Fetches the latest funding rate for a futures symbol
 * @param {string} symbol - e.g. 'BTCUSDT'
 * @returns {Promise<{ symbol: string, fundingRate: number, fundingTime: number }>}
 */
export async function fetchFundingRate(symbol) {
  try {
    const response = await fetch(
      `${FUTURES_URL}/fapi/v1/fundingRate?symbol=${symbol.toUpperCase()}&limit=1`
    );
    if (!response.ok) return { symbol, fundingRate: 0, fundingTime: 0 };
    const data = await response.json();
    if (data.length === 0) return { symbol, fundingRate: 0, fundingTime: 0 };
    return {
      symbol: data[0].symbol,
      fundingRate: parseFloat(data[0].fundingRate),
      fundingTime: data[0].fundingTime
    };
  } catch (error) {
    console.warn('Could not fetch funding rate:', error.message);
    return { symbol, fundingRate: 0, fundingTime: 0 };
  }
}

/**
 * Fetches current open interest for a futures symbol
 * @param {string} symbol - e.g. 'BTCUSDT'
 * @returns {Promise<{ symbol: string, openInterest: number }>}
 */
export async function fetchOpenInterest(symbol) {
  try {
    const response = await fetch(
      `${FUTURES_URL}/fapi/v1/openInterest?symbol=${symbol.toUpperCase()}`
    );
    if (!response.ok) return { symbol, openInterest: 0 };
    const data = await response.json();
    return {
      symbol: data.symbol,
      openInterest: parseFloat(data.openInterest)
    };
  } catch (error) {
    console.warn('Could not fetch open interest:', error.message);
    return { symbol, openInterest: 0 };
  }
}

/**
 * Fetches global Long/Short account ratio (last 5 data points)
 * @param {string} symbol - e.g. 'BTCUSDT'
 * @param {string} period - e.g. '1h', '4h', '1d'
 * @returns {Promise<{ longShortRatio: number, longAccount: number, shortAccount: number, timestamp: number }[]>}
 */
export async function fetchLongShortRatio(symbol, period = '1h') {
  try {
    const response = await fetch(
      `${FUTURES_URL}/futures/data/globalLongShortAccountRatio?symbol=${symbol.toUpperCase()}&period=${period}&limit=5`
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.map(item => ({
      longShortRatio: parseFloat(item.longShortRatio),
      longAccount: parseFloat(item.longAccount),
      shortAccount: parseFloat(item.shortAccount),
      timestamp: item.timestamp
    }));
  } catch (error) {
    console.warn('Could not fetch long/short ratio:', error.message);
    return [];
  }
}

/**
 * Fetches Open Interest history (last 10 data points) — used to calculate OI % change
 * @param {string} symbol - e.g. 'BTCUSDT'
 * @param {string} period - e.g. '1h', '4h', '1d'
 * @returns {Promise<{ sumOpenInterest: number, sumOpenInterestValue: number, timestamp: number }[]>}
 */
export async function fetchOpenInterestHist(symbol, period = '1h') {
  try {
    const response = await fetch(
      `${FUTURES_URL}/futures/data/openInterestHist?symbol=${symbol.toUpperCase()}&period=${period}&limit=10`
    );
    if (!response.ok) return [];
    const data = await response.json();
    return data.map(item => ({
      sumOpenInterest: parseFloat(item.sumOpenInterest),
      sumOpenInterestValue: parseFloat(item.sumOpenInterestValue),
      timestamp: item.timestamp
    }));
  } catch (error) {
    console.warn('Could not fetch OI history:', error.message);
    return [];
  }
}

/**
 * Convenience: fetch all flow data at once
 */
export async function fetchFlowData(symbol, period = '1h') {
  const [funding, oi, lsRatio, oiHist] = await Promise.all([
    fetchFundingRate(symbol),
    fetchOpenInterest(symbol),
    fetchLongShortRatio(symbol, period),
    fetchOpenInterestHist(symbol, period)
  ]);

  // Calculate OI % change from historical data
  let oiChange = 0;
  if (oiHist.length >= 2) {
    const oldest = oiHist[0].sumOpenInterestValue;
    const newest = oiHist[oiHist.length - 1].sumOpenInterestValue;
    if (oldest > 0) {
      oiChange = ((newest - oldest) / oldest) * 100;
    }
  }

  // Get latest long/short ratio
  const latestLS = lsRatio.length > 0 ? lsRatio[lsRatio.length - 1] : { longShortRatio: 1, longAccount: 0.5, shortAccount: 0.5 };

  return {
    fundingRate: funding.fundingRate,
    openInterest: oi.openInterest,
    oiChangePercent: oiChange,
    longShortRatio: latestLS.longShortRatio,
    longAccount: latestLS.longAccount,
    shortAccount: latestLS.shortAccount
  };
}

// ──────────────────────────────────────────────────
// NARRATIVE LANE — Fear & Greed Index
// ──────────────────────────────────────────────────

/**
 * Fetches the current Crypto Fear & Greed Index
 * @returns {Promise<{ value: number, classification: string, timestamp: number }>}
 */
export async function fetchFearGreedIndex() {
  try {
    const response = await fetch('https://api.alternative.me/fng/?limit=1');
    if (!response.ok) return { value: 50, classification: 'Neutral', timestamp: 0 };
    const data = await response.json();
    if (data.data && data.data.length > 0) {
      return {
        value: parseInt(data.data[0].value),
        classification: data.data[0].value_classification,
        timestamp: parseInt(data.data[0].timestamp) * 1000
      };
    }
    return { value: 50, classification: 'Neutral', timestamp: 0 };
  } catch (error) {
    console.warn('Could not fetch Fear & Greed Index:', error.message);
    return { value: 50, classification: 'Neutral', timestamp: 0 };
  }
}
