import { createChart, CrosshairMode } from 'lightweight-charts';
import { fetchKlines, subscribeKlines, unsubscribeKlines, subscribeTicker, unsubscribeTicker, fetchFlowData, fetchFearGreedIndex } from './api.js';
import { analyzeChart } from './analyzer.js';
import { calculateEMA, calculateBollingerBands } from './indicators.js';

// Configuration
const WATCHLIST = [
  { symbol: 'BTCUSDT', name: 'Bitcoin' },
  { symbol: 'ETHUSDT', name: 'Ethereum' },
  { symbol: 'SOLUSDT', name: 'Solana' },
  { symbol: 'BNBUSDT', name: 'BNB' },
  { symbol: 'XRPUSDT', name: 'XRP' },
  { symbol: 'DOGEUSDT', name: 'Dogecoin' }
];

const TIMEFRAMES = [
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H', default: true },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
];

// App State
let currentSymbol = 'BTCUSDT';
let currentInterval = '1h';
let chartData = [];
let chartInstance = null;
let candleSeries = null;
let volumeSeries = null;
let indicatorSeries = {};

let flowDataCache = null;
let fngDataCache = null;

// Risk Settings
let atrMultiplier = 1.5;
let riskRewardRatio = 2.0;

// Alerts & Notification State
let previousSignals = {}; // tracks key: 'symbol_interval' -> current active signal (e.g. 'BUY')
let alertLog = JSON.parse(localStorage.getItem('trading_alert_log') || '[]');
let soundEnabled = true;
let tgEnabled = localStorage.getItem('tg_alerts_enabled') === 'true';
let tgToken = localStorage.getItem('tg_bot_token') || '';
let tgChatId = localStorage.getItem('tg_chat_id') || '';

// Load Cancellation token for race conditions
let currentLoadRequestId = 0;

// Theme & Chart configuration constants
let currentTheme = localStorage.getItem('theme') || 'dark';

const CHART_COLORS = {
  bg: '#080c14',
  text: '#64748b',
  grid: 'rgba(30, 41, 59, 0.5)',
  up: '#10b981',
  down: '#ef4444',
  volUp: 'rgba(16, 185, 129, 0.4)',
  volDown: 'rgba(239, 68, 68, 0.4)',
  ema9: '#f59e0b',
  ema21: '#3b82f6',
  ema50: '#8b5cf6',
  ema200: '#ec4899',
  bb: 'rgba(255, 255, 255, 0.15)'
};

const LIGHT_CHART_COLORS = {
  bg: '#ffffff',
  text: '#475569',
  grid: 'rgba(203, 213, 225, 0.5)',
  up: '#059669',
  down: '#dc2626',
  volUp: 'rgba(5, 150, 105, 0.3)',
  volDown: 'rgba(220, 38, 38, 0.3)',
  ema9: '#d97706',
  ema21: '#2563eb',
  ema50: '#7c3aed',
  ema200: '#db2777',
  bb: 'rgba(15, 23, 42, 0.12)'
};

function getColors() {
  return currentTheme === 'light' ? LIGHT_CHART_COLORS : CHART_COLORS;
}

// DOM Elements
const els = {
  // Sidebar
  sidebar: document.getElementById('sidebar'),
  sidebarToggle: document.getElementById('sidebar-toggle'),
  sidebarClose: document.getElementById('sidebar-close'),
  sidebarBackdrop: document.getElementById('sidebar-backdrop'),
  watchlist: document.getElementById('watchlist'),
  timeframes: document.getElementById('timeframes'),
  toggles: document.querySelectorAll('.indicator-toggle'),
  atrInput: document.getElementById('atrMultiplier'),
  atrVal: document.getElementById('atrMultiplierVal'),
  rrInput: document.getElementById('riskRewardRatio'),
  themeToggleBtn: document.getElementById('theme-toggle-btn'),
  
  // Header
  hSymbol: document.getElementById('header-symbol'),
  hPrice: document.getElementById('header-price'),
  hChange: document.getElementById('header-change'),
  hHigh: document.getElementById('header-high'),
  hLow: document.getElementById('header-low'),
  hFng: document.getElementById('header-fng'),
  
  // Chart
  chartContainer: document.getElementById('chart-container'),
  loading: document.getElementById('loading'),
  
  // Verdict Card
  vSignal: document.getElementById('verdict-signal'),
  vTier: document.getElementById('verdict-tier'),
  vPair: document.getElementById('verdict-pair'),
  vAlignment: document.getElementById('verdict-alignment'),
  sEntry: document.getElementById('setup-entry'),
  sSl: document.getElementById('setup-sl'),
  sSlPct: document.getElementById('setup-sl-pct'),
  sTp1: document.getElementById('setup-tp1'),
  sTp1Pct: document.getElementById('setup-tp1-pct'),
  sTp2: document.getElementById('setup-tp2'),
  sTp2Pct: document.getElementById('setup-tp2-pct'),
  sRr: document.getElementById('setup-rr'),
  
  // Lanes
  lanes: {
    T: { bias: document.getElementById('lane-T-bias'), tier: document.getElementById('lane-T-tier'), detail: document.getElementById('lane-T-detail') },
    F: { bias: document.getElementById('lane-F-bias'), tier: document.getElementById('lane-F-tier'), detail: document.getElementById('lane-F-detail') },
    N: { bias: document.getElementById('lane-N-bias'), tier: document.getElementById('lane-N-tier'), detail: document.getElementById('lane-N-detail') },
    M: { bias: document.getElementById('lane-M-bias'), tier: document.getElementById('lane-M-tier'), detail: document.getElementById('lane-M-detail') }
  },
  
  // Stats
  reasonsList: document.getElementById('reasons-list'),
  valPrice: document.getElementById('val-price'),
  valRsi: document.getElementById('val-rsi'),
  valMacd: document.getElementById('val-macd'),
  valEma9: document.getElementById('val-ema9'),
  valEma21: document.getElementById('val-ema21'),
  valEma50: document.getElementById('val-ema50'),
  valEma200: document.getElementById('val-ema200'),
  valBb: document.getElementById('val-bb'),
  valAtr: document.getElementById('val-atr'),

  // Alerts Settings UI
  btnNotifications: document.getElementById('btn-enable-notifications'),
  toggleSound: document.getElementById('toggle-sound-alerts'),
  toggleTelegram: document.getElementById('toggle-telegram-alerts'),
  tgCredentials: document.getElementById('telegram-credentials'),
  tgTokenInput: document.getElementById('tg-token'),
  tgChatIdInput: document.getElementById('tg-chatid'),
  btnTestTelegram: document.getElementById('btn-test-telegram'),
  
  // Tab panels and logs
  tabBtns: document.querySelectorAll('.tab-btn'),
  tabContents: document.querySelectorAll('.tab-content'),
  alertsLog: document.getElementById('alerts-log'),
  
  // Login Gatekeeper Elements
  loginOverlay: document.getElementById('login-overlay'),
  loginCard: document.querySelector('.login-card'),
  loginForm: document.getElementById('login-form'),
  usernameInput: document.getElementById('username'),
  passwordInput: document.getElementById('password'),
  togglePwVisibility: document.getElementById('toggle-pw-visibility'),
  loginError: document.getElementById('login-error'),
  appContainer: document.querySelector('.app-container')
};

// Formatting utilities
const fmt = {
  price: (val) => val < 1 ? val.toPrecision(4) : val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  pct: (val) => (val > 0 ? '+' : '') + val.toFixed(2) + '%'
};

// ──────────────────────────────────────────────────
// INITIALIZATION
// ──────────────────────────────────────────────────

async function initApp() {
  initUI();
  initChart();
  
  // Set initial theme
  applyTheme(currentTheme);
  
  // Pre-fetch slow data once
  fngDataCache = await fetchFearGreedIndex();
  updateFngHeader(fngDataCache);
  
  await loadSymbolData(currentSymbol, currentInterval);
  
  // Periodic background updates
  setInterval(async () => {
    flowDataCache = await fetchFlowData(currentSymbol, currentInterval);
    fngDataCache = await fetchFearGreedIndex();
    updateFngHeader(fngDataCache);
    if (chartData.length > 0) runAnalysis();
  }, 60000); // every minute
}

// ──────────────────────────────────────────────────
// GATEKEEPER AUTHENTICATION
// ──────────────────────────────────────────────────
function initGatekeeper() {
  const isAuth = sessionStorage.getItem('apex_auth') === 'true';
  
  // If already authenticated during this tab session, unlock instantly
  if (isAuth) {
    els.appContainer.classList.remove('blur-active');
    els.loginOverlay.classList.add('hidden');
    initApp();
    return;
  }

  // Toggle Password Visibility
  if (els.togglePwVisibility) {
    els.togglePwVisibility.addEventListener('click', () => {
      const type = els.passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      els.passwordInput.setAttribute('type', type);
      els.togglePwVisibility.textContent = type === 'password' ? '👁️' : '🙈';
    });
  }

  // Handle Form Submission
  if (els.loginForm) {
    els.loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      
      const username = els.usernameInput.value.trim();
      const password = els.passwordInput.value;
      
      // Credentials Check
      if (username === 'omboss4' && password === 'OmYadav@0204') {
        sessionStorage.setItem('apex_auth', 'true');
        
        // Success Transition
        els.loginOverlay.classList.add('hidden');
        els.appContainer.classList.remove('blur-active');
        
        // Initialize Application fully
        initApp();
      } else {
        // Error Feedback: Shake and Display warning
        els.loginError.classList.remove('hidden');
        els.loginCard.classList.add('shake');
        
        // Clear password input
        els.passwordInput.value = '';
        els.passwordInput.focus();
        
        // Remove shake animation class after completion to allow re-trigger
        setTimeout(() => {
          els.loginCard.classList.remove('shake');
        }, 400);
      }
    });
  }
}

function initUI() {
  // Watchlist
  els.watchlist.innerHTML = WATCHLIST.map(s => `
    <div class="watchlist-item ${s.symbol === currentSymbol ? 'active' : ''}" data-symbol="${s.symbol}">
      <span class="icon">📈</span>
      <div>
        <div class="symbol-name">${s.symbol.replace('USDT', '/USDT')}</div>
        <div class="symbol-fullname">${s.name}</div>
      </div>
      <div style="flex:1"></div>
      <div class="price-badge" id="badge-${s.symbol}">--</div>
    </div>
  `).join('');

  const closeSidebarOnMobile = () => {
    if (window.innerWidth <= 1024) {
      if (els.sidebar) els.sidebar.classList.remove('open');
      if (els.sidebarBackdrop) els.sidebarBackdrop.classList.remove('open');
      setTimeout(() => {
        if (chartInstance) {
          chartInstance.resize(els.chartContainer.clientWidth, els.chartContainer.clientHeight);
        }
      }, 300);
    }
  };

  if (els.sidebarToggle && els.sidebarBackdrop) {
    els.sidebarToggle.addEventListener('click', () => {
      const isOpen = els.sidebar.classList.toggle('open');
      els.sidebarBackdrop.classList.toggle('open', isOpen);
      setTimeout(() => {
        if (chartInstance) {
          chartInstance.resize(els.chartContainer.clientWidth, els.chartContainer.clientHeight);
        }
      }, 300);
    });

    els.sidebarBackdrop.addEventListener('click', () => {
      closeSidebarOnMobile();
    });
  }

  if (els.sidebarClose) {
    els.sidebarClose.addEventListener('click', () => {
      closeSidebarOnMobile();
    });
  }

  els.watchlist.querySelectorAll('.watchlist-item').forEach(el => {
    el.addEventListener('click', () => {
      els.watchlist.querySelectorAll('.watchlist-item').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      currentSymbol = el.dataset.symbol;
      loadSymbolData(currentSymbol, currentInterval);
      closeSidebarOnMobile();
    });
  });

  // Timeframes
  els.timeframes.innerHTML = TIMEFRAMES.map(t => `
    <button class="timeframe-btn ${t.value === currentInterval ? 'active' : ''}" data-interval="${t.value}">
      ${t.label}
    </button>
  `).join('');

  els.timeframes.querySelectorAll('.timeframe-btn').forEach(el => {
    el.addEventListener('click', () => {
      els.timeframes.querySelectorAll('.timeframe-btn').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      currentInterval = el.dataset.interval;
      loadSymbolData(currentSymbol, currentInterval);
      closeSidebarOnMobile();
    });
  });

  // Indicator Toggles
  els.toggles.forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const ind = e.target.dataset.indicator;
      if (indicatorSeries[ind]) {
        indicatorSeries[ind].applyOptions({ visible: e.target.checked });
      }
    });
  });
  // Settings Sliders
  els.atrInput.addEventListener('input', (e) => {
    atrMultiplier = parseFloat(e.target.value);
    els.atrVal.textContent = atrMultiplier.toFixed(1);
    if (chartData.length > 0) runAnalysis();
  });
  
  els.rrInput.addEventListener('input', (e) => {
    riskRewardRatio = parseFloat(e.target.value);
    els.rrVal.textContent = riskRewardRatio.toFixed(1);
    if (chartData.length > 0) runAnalysis();
  });

  // --- Notification & Alerts Configuration ---
  
  // Set initial input values from state
  els.toggleSound.checked = soundEnabled;
  els.toggleTelegram.checked = tgEnabled;
  els.tgTokenInput.value = tgToken;
  els.tgChatIdInput.value = tgChatId;
  
  if (tgEnabled) {
    els.tgCredentials.classList.remove('hidden');
  }

  // Update browser notifications button state
  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      els.btnNotifications.textContent = '🔔 Alerts Enabled';
      els.btnNotifications.classList.add('active');
    } else if (Notification.permission === 'denied') {
      els.btnNotifications.textContent = '🔕 Alerts Blocked';
      els.btnNotifications.disabled = true;
    }
  } else {
    els.btnNotifications.textContent = '🚫 Notifications Unsupported';
    els.btnNotifications.disabled = true;
  }

  // Browser notifications button listener
  els.btnNotifications.addEventListener('click', () => {
    if ('Notification' in window) {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          els.btnNotifications.textContent = '🔔 Alerts Enabled';
          els.btnNotifications.classList.add('active');
          sendBrowserNotification('Notifications Enabled', 'You will now receive alerts for entry signals.');
        } else if (permission === 'denied') {
          els.btnNotifications.textContent = '🔕 Alerts Blocked';
          els.btnNotifications.classList.remove('active');
        }
      });
    }
  });

  // Sound toggler listener
  els.toggleSound.addEventListener('change', (e) => {
    soundEnabled = e.target.checked;
    if (soundEnabled) {
      playAlertSound('BUY');
    }
  });

  // Telegram alerts toggler listener
  els.toggleTelegram.addEventListener('change', (e) => {
    tgEnabled = e.target.checked;
    localStorage.setItem('tg_alerts_enabled', tgEnabled);
    if (tgEnabled) {
      els.tgCredentials.classList.remove('hidden');
    } else {
      els.tgCredentials.classList.add('hidden');
    }
  });

  // Save Telegram credential changes
  const saveTelegramCreds = () => {
    tgToken = els.tgTokenInput.value.trim();
    tgChatId = els.tgChatIdInput.value.trim();
    localStorage.setItem('tg_bot_token', tgToken);
    localStorage.setItem('tg_chat_id', tgChatId);
  };
  els.tgTokenInput.addEventListener('input', saveTelegramCreds);
  els.tgChatIdInput.addEventListener('input', saveTelegramCreds);

  // Test Telegram button listener
  els.btnTestTelegram.addEventListener('click', async () => {
    saveTelegramCreds();
    if (!tgToken || !tgChatId) {
      alert('Please enter both Bot Token and Chat ID.');
      return;
    }
    els.btnTestTelegram.textContent = 'Sending...';
    els.btnTestTelegram.disabled = true;
    const success = await sendTelegramAlert('⚡ Antigravity Alerts Test: Telegram connection is active!');
    els.btnTestTelegram.textContent = success ? 'Success! ✅' : 'Failed ❌';
    setTimeout(() => {
      els.btnTestTelegram.textContent = 'Test Telegram';
      els.btnTestTelegram.disabled = false;
    }, 2000);
  });

  // Tabs listener
  els.tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      els.tabBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      const tabId = btn.dataset.tab;
      els.tabContents.forEach(content => {
        if (content.id === `tab-${tabId}`) {
          content.classList.add('active');
        } else {
          content.classList.remove('active');
        }
      });
    });
  });

  // Theme Toggle Listener
  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener('click', () => {
      const newTheme = currentTheme === 'light' ? 'dark' : 'light';
      applyTheme(newTheme);
    });
  }

  // Render initial logs
  renderAlertLog();
}

function applyTheme(theme) {
  currentTheme = theme;
  localStorage.setItem('theme', theme);

  if (theme === 'light') {
    document.body.classList.add('light-theme');
    if (els.themeToggleBtn) els.themeToggleBtn.innerHTML = '☀️';
  } else {
    document.body.classList.remove('light-theme');
    if (els.themeToggleBtn) els.themeToggleBtn.innerHTML = '🌙';
  }

  // Update chart elements if initialized
  if (chartInstance) {
    const colors = getColors();
    chartInstance.applyOptions({
      layout: {
        background: { type: 'solid', color: colors.bg },
        textColor: colors.text,
      },
      grid: {
        vertLines: { color: colors.grid },
        horzLines: { color: colors.grid },
      },
      rightPriceScale: {
        borderColor: colors.grid,
      },
      timeScale: {
        borderColor: colors.grid,
      }
    });

    if (candleSeries) {
      candleSeries.applyOptions({
        upColor: colors.up,
        downColor: colors.down,
        wickUpColor: colors.up,
        wickDownColor: colors.down,
      });
    }

    if (indicatorSeries.ema9) indicatorSeries.ema9.applyOptions({ color: colors.ema9 });
    if (indicatorSeries.ema21) indicatorSeries.ema21.applyOptions({ color: colors.ema21 });
    if (indicatorSeries.ema50) indicatorSeries.ema50.applyOptions({ color: colors.ema50 });
    if (indicatorSeries.ema200) indicatorSeries.ema200.applyOptions({ color: colors.ema200 });

    if (indicatorSeries.bbUpper) indicatorSeries.bbUpper.applyOptions({ color: colors.bb });
    if (indicatorSeries.bbLower) indicatorSeries.bbLower.applyOptions({ color: colors.bb });

    // Update volume bars color
    if (volumeSeries && chartData.length > 0) {
      volumeSeries.setData(chartData.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? colors.volUp : colors.volDown
      })));
    }
  }

  // Update fear & greed index color if active
  if (fngDataCache) {
    updateFngHeader(fngDataCache);
  }
}

function initChart() {
  const colors = getColors();
  chartInstance = createChart(els.chartContainer, {
    layout: {
      background: { type: 'solid', color: colors.bg },
      textColor: colors.text,
      fontFamily: 'JetBrains Mono',
    },
    grid: {
      vertLines: { color: colors.grid, style: 1 },
      horzLines: { color: colors.grid, style: 1 },
    },
    crosshair: { mode: CrosshairMode.Normal },
    rightPriceScale: { 
      borderColor: colors.grid,
      scaleMargins: {
        top: 0.1, // 10% margin at the top
        bottom: 0.3 // 30% margin at the bottom (leaves room for volume)
      }
    },
    timeScale: { borderColor: colors.grid, timeVisible: true },
  });

  candleSeries = chartInstance.addCandlestickSeries({
    upColor: colors.up,
    downColor: colors.down,
    borderVisible: false,
    wickUpColor: colors.up,
    wickDownColor: colors.down,
  });

  volumeSeries = chartInstance.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: '', // Keep as an overlay scale
  });

  volumeSeries.priceScale().applyOptions({
    scaleMargins: {
      top: 0.8, // 80% margin at the top (restricts volume to bottom 20%)
      bottom: 0,
    },
  });

  // Technical Indicators
  indicatorSeries.ema9 = chartInstance.addLineSeries({ color: colors.ema9, lineWidth: 1, title: 'EMA 9' });
  indicatorSeries.ema21 = chartInstance.addLineSeries({ color: colors.ema21, lineWidth: 2, title: 'EMA 21' });
  indicatorSeries.ema50 = chartInstance.addLineSeries({ color: colors.ema50, lineWidth: 1, visible: false, title: 'EMA 50' });
  indicatorSeries.ema200 = chartInstance.addLineSeries({ color: colors.ema200, lineWidth: 2, visible: false, title: 'EMA 200' });
  
  indicatorSeries.bbUpper = chartInstance.addLineSeries({ color: colors.bb, lineWidth: 1, lineStyle: 2, title: 'BB Upper' });
  indicatorSeries.bbLower = chartInstance.addLineSeries({ color: colors.bb, lineWidth: 1, lineStyle: 2, title: 'BB Lower' });

  // Sync toggles state
  els.toggles.forEach(toggle => {
    const ind = toggle.dataset.indicator;
    if (indicatorSeries[ind]) {
      indicatorSeries[ind].applyOptions({ visible: toggle.checked });
    }
  });

  // Handle container resize with ResizeObserver (handles mobile orientation + dynamic layouts)
  let resizeTimer;
  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (chartInstance && els.chartContainer.clientWidth > 0 && els.chartContainer.clientHeight > 0) {
        chartInstance.resize(els.chartContainer.clientWidth, els.chartContainer.clientHeight);
      }
    }, 50);
  });
  resizeObserver.observe(els.chartContainer);
}

// ──────────────────────────────────────────────────
// DATA LOADING
// ──────────────────────────────────────────────────

async function loadSymbolData(symbol, interval) {
  const requestId = ++currentLoadRequestId;
  
  els.loading.style.display = 'flex';
  els.hSymbol.textContent = `${symbol.replace('USDT', '/USDT')}`;
  els.vPair.textContent = `${symbol.replace('USDT', '/USDT')} · ${interval}`;
  
  unsubscribeKlines();
  unsubscribeTicker();

  // Clear all series data immediately to prevent scale mixing from previous symbol
  if (candleSeries) candleSeries.setData([]);
  if (volumeSeries) volumeSeries.setData([]);
  Object.values(indicatorSeries).forEach(series => {
    if (series) series.setData([]);
  });

  try {
    // 1. Fetch historical candles
    const fetchedKlines = await fetchKlines(symbol, interval, 300);
    if (requestId !== currentLoadRequestId) return;
    
    // 2. Fetch Flow Data
    const fetchedFlow = await fetchFlowData(symbol, interval);
    if (requestId !== currentLoadRequestId) return;
    
    // Safe to assign to global variables now
    chartData = fetchedKlines;
    flowDataCache = fetchedFlow;
    
    // Update chart
    candleSeries.setData(chartData);
    volumeSeries.setData(chartData.map(c => ({
      time: c.time,
      value: c.volume,
      color: c.close >= c.open ? getColors().volUp : getColors().volDown
    })));
    
    // Calculate and draw historical indicators ONCE
    drawHistoricalIndicators();
    
    // Initial run
    runAnalysis();
    updateHeaderStats();

    // Subscribe to live updates
    subscribeKlines(symbol, interval, (update) => {
      if (requestId !== currentLoadRequestId) return;
      const last = chartData[chartData.length - 1];
      if (update.time === last.time) {
        chartData[chartData.length - 1] = update; // Update current candle
      } else if (update.time > last.time) {
        chartData.push(update); // New candle
        if (chartData.length > 500) chartData.shift();
      }

      candleSeries.update(update);
      volumeSeries.update({
        time: update.time,
        value: update.volume,
        color: update.close >= update.open ? getColors().volUp : getColors().volDown
      });

      const result = runAnalysis(); // Re-run analysis on every tick
      if (result && result.status === 'SUCCESS') {
        updateLiveIndicators(update.time, result.indicators);
      }
    });

    subscribeTicker(symbol, (ticker) => {
      if (requestId !== currentLoadRequestId) return;
      updateHeaderStats(ticker);
    });

  } catch (error) {
    if (requestId === currentLoadRequestId) {
      console.error('Data load error:', error);
    }
  } finally {
    if (requestId === currentLoadRequestId) {
      els.loading.style.display = 'none';
    }
  }
}

function updateHeaderStats(ticker) {
  if (!ticker) return;
  
  els.hPrice.textContent = `$${fmt.price(ticker.price)}`;
  els.hPrice.className = ticker.changeRaw >= 0 ? 'price-up' : 'price-down';
  
  els.hChange.textContent = fmt.pct(ticker.changePct);
  els.hChange.className = `stat-val ${ticker.changeRaw >= 0 ? 'change-up' : 'change-down'}`;
  
  els.hHigh.textContent = fmt.price(ticker.high);
  els.hLow.textContent = fmt.price(ticker.low);
  
  // Update watchlist badge
  const badge = document.getElementById(`badge-${currentSymbol}`);
  if (badge) {
    badge.textContent = `$${fmt.price(ticker.price)}`;
    badge.className = `price-badge ${ticker.changeRaw >= 0 ? 'up' : 'down'}`;
  }
}

function updateFngHeader(fngData) {
  if (!fngData) return;
  els.hFng.textContent = `${fngData.value} · ${fngData.classification}`;
  const colors = getColors();
  if (fngData.value >= 60) els.hFng.style.color = colors.up;
  else if (fngData.value <= 40) els.hFng.style.color = colors.down;
  else els.hFng.style.color = colors.text;
}

// ──────────────────────────────────────────────────
// ANALYSIS & RENDER
// ──────────────────────────────────────────────────

function runAnalysis() {
  if (chartData.length < 50) return null;
  
  const result = analyzeChart(chartData, flowDataCache, fngDataCache, {
    atrMultiplier,
    riskRewardRatio
  });
  
  if (result.status === 'SUCCESS') {
    renderDashboard(result);
    checkForAlerts(currentSymbol, currentInterval, result.verdict);
  }
  return result;
}

function drawHistoricalIndicators() {
  if (chartData.length === 0) return;
  const closes = chartData.map(c => c.close);
  
  const mapData = (arr) => arr.map((val, i) => val !== null ? { time: chartData[i].time, value: val } : null).filter(Boolean);
  
  const ema9 = calculateEMA(closes, 9);
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const bb = calculateBollingerBands(closes, 20, 2);
  
  indicatorSeries.ema9.setData(mapData(ema9));
  indicatorSeries.ema21.setData(mapData(ema21));
  indicatorSeries.ema50.setData(mapData(ema50));
  indicatorSeries.ema200.setData(mapData(ema200));
  
  indicatorSeries.bbUpper.setData(mapData(bb.upper));
  indicatorSeries.bbLower.setData(mapData(bb.lower));
}

function updateLiveIndicators(time, ind) {
  if (ind.ema9 !== null) indicatorSeries.ema9.update({ time, value: ind.ema9 });
  if (ind.ema21 !== null) indicatorSeries.ema21.update({ time, value: ind.ema21 });
  if (ind.ema50 !== null) indicatorSeries.ema50.update({ time, value: ind.ema50 });
  if (ind.ema200 !== null) indicatorSeries.ema200.update({ time, value: ind.ema200 });
  if (ind.bollinger.upper !== null) indicatorSeries.bbUpper.update({ time, value: ind.bollinger.upper });
  if (ind.bollinger.lower !== null) indicatorSeries.bbLower.update({ time, value: ind.bollinger.lower });
}

function renderDashboard(result) {
  const v = result.verdict;
  const currentPrice = v.entry;
  
  // 1. Verdict Card
  els.vSignal.textContent = v.signal.replace('_', ' ');
  els.vSignal.className = `verdict-signal ${v.signal.toLowerCase().replace('_', '-')}`;
  
  els.vTier.textContent = v.tier;
  els.vTier.className = `tier-badge tier-${v.tier.toLowerCase()}`;
  
  els.vAlignment.textContent = v.lanesAligned;
  
  // Trade Setup
  els.sEntry.textContent = `$${fmt.price(v.entry)}`;
  if (v.signal !== 'HOLD' && v.sl > 0) {
    els.sSl.textContent = `$${fmt.price(v.sl)}`;
    els.sSlPct.textContent = `(${fmt.pct(((v.sl - v.entry) / v.entry) * 100)})`;
    
    els.sTp1.textContent = `$${fmt.price(v.tp1)}`;
    els.sTp1Pct.textContent = `(${fmt.pct(((v.tp1 - v.entry) / v.entry) * 100)})`;
    
    els.sTp2.textContent = `$${fmt.price(v.tp2)}`;
    els.sTp2Pct.textContent = `(${fmt.pct(((v.tp2 - v.entry) / v.entry) * 100)})`;
    
    els.sRr.textContent = v.rrRatio;
  } else {
    els.sSl.textContent = '--'; els.sSlPct.textContent = '';
    els.sTp1.textContent = '--'; els.sTp1Pct.textContent = '';
    els.sTp2.textContent = '--'; els.sTp2Pct.textContent = '';
    els.sRr.textContent = '0.0';
  }
  
  // 2. Lane Cards
  result.lanes.forEach(lane => {
    const el = els.lanes[lane.lane];
    if (el) {
      el.bias.textContent = lane.bias;
      el.bias.className = `bias-text ${lane.bias.toLowerCase()}`;
      el.tier.textContent = `· tier ${lane.tier}`;
      el.detail.textContent = lane.detail;
    }
  });
  
  // 3. Reasons List
  const allReasons = [];
  result.lanes.forEach(l => {
    l.reasons.forEach(r => {
      // Only show bullish/bearish reasons to reduce noise
      if (r.type !== 'neutral') {
        allReasons.push({ ...r, laneName: l.name });
      }
    });
  });
  
  if (allReasons.length === 0) {
    els.reasonsList.innerHTML = `<li><span class="text">Market is flat. Waiting for setup.</span></li>`;
  } else {
    els.reasonsList.innerHTML = allReasons.map(r => {
      const icon = r.type === 'bullish' ? '🟢' : '🔴';
      return `<li class="${r.type}">
        <span class="bullet">${icon}</span>
        <span class="text"><b>${r.laneName}:</b> ${r.text}</span>
      </li>`;
    }).join('');
  }
  
  // 4. Raw Stats Table
  const ind = result.indicators;
  els.valPrice.textContent = fmt.price(ind.price);
  els.valPrice.className = `val font-mono ${v.signal.includes('BUY') ? 'up' : v.signal.includes('SELL') ? 'down' : ''}`;
  
  els.valRsi.textContent = ind.rsi ? ind.rsi.toFixed(1) : '--';
  els.valMacd.textContent = ind.macd && ind.macd.macd !== null ? `${ind.macd.macd.toFixed(2)} / ${ind.macd.signal.toFixed(2)}` : '--';
  
  els.valEma9.textContent = ind.ema9 ? fmt.price(ind.ema9) : '--';
  els.valEma21.textContent = ind.ema21 ? fmt.price(ind.ema21) : '--';
  els.valEma50.textContent = ind.ema50 ? fmt.price(ind.ema50) : '--';
  els.valEma200.textContent = ind.ema200 ? fmt.price(ind.ema200) : '--';
  
  els.valBb.textContent = ind.bollinger && ind.bollinger.upper !== null 
    ? `${fmt.price(ind.bollinger.upper)} / ${fmt.price(ind.bollinger.lower)}` 
    : '--';
    
  els.valAtr.textContent = ind.atr ? ind.atr.toFixed(2) : '--';
}

// Start
initGatekeeper();

// ──────────────────────────────────────────────────
// ALERTS & NOTIFICATIONS HELPERS
// ──────────────────────────────────────────────────

function playAlertSound(type = 'buy') {
  if (!soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    if (type.includes('BUY')) {
      // Double beep going up (cheerful)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, audioCtx.currentTime); // C5
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      osc.start();
      
      osc.frequency.setValueAtTime(659.25, audioCtx.currentTime + 0.12); // E5
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime + 0.12);
      
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc.stop(audioCtx.currentTime + 0.35);
    } else {
      // Double beep going down (warning)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440.00, audioCtx.currentTime); // A4
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
      osc.start();
      
      osc.frequency.setValueAtTime(349.23, audioCtx.currentTime + 0.12); // F4
      gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime + 0.12);
      
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);
      osc.stop(audioCtx.currentTime + 0.35);
    }
  } catch (e) {
    console.error('Audio alert error:', e);
  }
}

function sendBrowserNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch (e) {
      console.error('Notification trigger error:', e);
    }
  }
}

async function sendTelegramAlert(message) {
  if (!tgToken || !tgChatId) return false;
  try {
    const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgChatId,
        text: message,
        parse_mode: 'Markdown'
      })
    });
    const data = await response.json();
    return data.ok;
  } catch (e) {
    console.error('Telegram alert error:', e);
    return false;
  }
}

function renderAlertLog() {
  if (!els.alertsLog) return;
  if (alertLog.length === 0) {
    els.alertsLog.innerHTML = `<li class="empty-log">No entry alerts yet. Watching markets...</li>`;
    return;
  }
  
  els.alertsLog.innerHTML = alertLog.slice().reverse().map(alert => {
    const isBuy = alert.signal.includes('BUY');
    const typeClass = isBuy ? 'buy-alert' : 'sell-alert';
    const titleClass = isBuy ? 'buy' : 'sell';
    const icon = isBuy ? '🟢' : '🔴';
    
    return `<li class="${typeClass}">
      <span class="alert-time">${alert.timestamp}</span>
      <div class="alert-title ${titleClass}">
        ${icon} ${alert.signal.replace('_', ' ')} ${alert.symbol} @ $${fmt.price(alert.entry)}
      </div>
      <div class="alert-metrics">
        <span>SL: $${fmt.price(alert.sl)}</span>
        <span>R:R: ${alert.rrRatio}</span>
        <span>TP1: $${fmt.price(alert.tp1)}</span>
        <span>TP2: $${fmt.price(alert.tp2)}</span>
      </div>
    </li>`;
  }).join('');
}

function logAlert(alertObj) {
  alertLog.push(alertObj);
  if (alertLog.length > 50) {
    alertLog.shift();
  }
  localStorage.setItem('trading_alert_log', JSON.stringify(alertLog));
  renderAlertLog();
}

function checkForAlerts(symbol, interval, verdict) {
  const signalKey = `${symbol}_${interval}`;
  const prevSignal = previousSignals[signalKey];
  const currentSignal = verdict.signal;
  
  // Set initial state without alerting
  if (prevSignal === undefined) {
    previousSignals[signalKey] = currentSignal;
    return;
  }
  
  // Trigger alert if signal changed and it's an entry (BUY/SELL)
  if (prevSignal !== currentSignal) {
    previousSignals[signalKey] = currentSignal;
    
    if (currentSignal !== 'HOLD' && currentSignal !== 'NEUTRAL') {
      const isBuy = currentSignal.includes('BUY');
      const actionText = isBuy ? '🟢 BUY' : '🔴 SELL';
      const timestamp = new Date().toLocaleTimeString();
      
      const alertObj = {
        timestamp,
        symbol: symbol.replace('USDT', '/USDT'),
        interval,
        signal: currentSignal,
        entry: verdict.entry,
        sl: verdict.sl,
        tp1: verdict.tp1,
        tp2: verdict.tp2,
        rrRatio: verdict.rrRatio
      };
      
      logAlert(alertObj);
      playAlertSound(currentSignal);
      
      const title = `${actionText} Signal for ${alertObj.symbol} (${interval})`;
      const body = `Entry: $${fmt.price(verdict.entry)} | SL: $${fmt.price(verdict.sl)} | TP1: $${fmt.price(verdict.tp1)} | R:R: ${verdict.rrRatio}`;
      sendBrowserNotification(title, body);
      
      if (tgEnabled) {
        const tgMsg = `*⚡ Antigravity Trade Alert*\n` +
                      `${isBuy ? '🟢' : '🔴'} *${currentSignal.replace('_', ' ')}*\n` +
                      `*Asset:* ${alertObj.symbol} (${interval})\n` +
                      `*Entry:* $${fmt.price(verdict.entry)}\n` +
                      `*Stop Loss:* $${fmt.price(verdict.sl)}\n` +
                      `*Take Profit 1:* $${fmt.price(verdict.tp1)}\n` +
                      `*Take Profit 2:* $${fmt.price(verdict.tp2)}\n` +
                      `*Risk:Reward:* ${verdict.rrRatio}`;
        sendTelegramAlert(tgMsg);
      }
    }
  }
}
