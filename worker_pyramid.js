// Stock Pulse - Cloudflare Worker (R2-backed, chunked refresh). See docs for routes.
const MIN_HISTORY = 252, BUY_THRESHOLD = 2.0, ATR_CAP = 1.10, DRAWDOWN_FLOOR = -15.0;
const DEFAULT_TOP_N_BUYS = 10;
const BUY_PERSISTENCE_DAYS = 2, ATR_EXIT_THRESHOLD = 1.6, TRAILING_STOP_PCT = 6.5, PROFIT_TARGET_PCT = 3.25;
const SCORE_REVERSAL_THRESHOLD = -1.0, SCORE_PERSISTENCE_DAYS = 2, MA50_PERSISTENCE_DAYS = 3;
const ALPACA_PROXY_BASE = 'https://api.paradiserl.com';
// ---- Indicators ----
function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50.0;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const ag = gains / period, al = losses / period;
  return al === 0 ? 100.0 : 100 - 100 / (1 + ag / al);
}
function computeMomentum(closes, period = 10) {
  if (closes.length < period + 1) return 0.0;
  const past = closes[closes.length - 1 - period], cur = closes[closes.length - 1];
  return past ? ((cur - past) / past) * 100 : 0.0;
}
function computeVolumeTrend(volumes, period = 10) {
  if (volumes.length < period * 2) return 0.0;
  const ra = volumes.slice(-period).reduce((a, b) => a + b, 0) / period;
  const pa = volumes.slice(-period * 2, -period).reduce((a, b) => a + b, 0) / period;
  return pa ? ((ra - pa) / pa) * 100 : 0.0;
}
function computeVWAPPosition(bars, period = 20) {
  const recent = bars.slice(-period);
  if (recent.length === 0) return 0.0;
  let cumPV = 0, cumV = 0;
  for (const b of recent) { cumPV += ((b.high + b.low + b.close) / 3) * b.volume; cumV += b.volume; }
  const vwap = cumV ? cumPV / cumV : recent[recent.length - 1].close;
  const lastClose = recent[recent.length - 1].close;
  return vwap ? ((lastClose - vwap) / vwap) * 100 : 0.0;
}
function computeDrawdown(closes, lookback = 252) {
  const window = closes.length >= lookback ? closes.slice(-lookback) : closes;
  const peak = Math.max(...window);
  return peak ? ((closes[closes.length - 1] - peak) / peak) * 100 : 0.0;
}
function computePctBelowMA(closes, period) {
  const window = closes.length >= period ? closes.slice(-period) : closes;
  const ma = window.reduce((a, b) => a + b, 0) / window.length;
  return ma ? ((closes[closes.length - 1] - ma) / ma) * 100 : 0.0;
}
function computeATRRatio(bars, period = 14, lookback = 60) {
  const rb = bars.length >= lookback + 1 ? bars.slice(-(lookback + 1)) : bars;
  const trs = [];
  for (let i = 1; i < rb.length; i++) {
    const h = rb[i].high, l = rb[i].low, pc = rb[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  if (trs.length < period) return 1.0;
  const curAtr = trs.slice(-period).reduce((a, b) => a + b, 0) / period;
  const baseAtr = trs.reduce((a, b) => a + b, 0) / trs.length;
  return baseAtr ? curAtr / baseAtr : 1.0;
}
function computeCompositeScore(rsi, momentum, volTrend, vwapPos) {
  const clamp = (v) => Math.max(-1, Math.min(1, v));
  return (rsi - 50) / 50 + clamp(momentum / 10) + clamp(volTrend / 20) + clamp(vwapPos / 5);
}
function longSignalAt(bars, i) {
  const wb = bars.slice(0, i + 1);
  const closes = wb.map(b => b.close), volumes = wb.map(b => b.volume);
  const volTrend = computeVolumeTrend(volumes);
  const score = computeCompositeScore(computeRSI(closes), computeMomentum(closes), volTrend, computeVWAPPosition(wb));
  const drawdown = computeDrawdown(closes), atrRatio = computeATRRatio(wb);
  const pctMa50 = computePctBelowMA(closes, 50), pctMa200 = computePctBelowMA(closes, 200);
  const gatesPass = score >= BUY_THRESHOLD && atrRatio <= ATR_CAP && drawdown >= DRAWDOWN_FLOOR
    && pctMa50 > 0 && pctMa200 > 0 && volTrend > 0;
  return { gatesPass, score, atrRatio, drawdown, pctMa50, pctMa200, volTrend };
}
// ---- Sector / historical-strength reference ----
const SECTOR_MAP = {"A":"Health Care","AAPL":"Information Technology","ABBV":"Health Care","ABNB":"Consumer Discretionary","ABT":"Health Care","ACGL":"Financials","ACN":"Information Technology","ADBE":"Information Technology","ADI":"Information Technology","ADM":"Consumer Staples","ADP":"Information Technology","ADSK":"Information Technology","AEE":"Utilities","AEP":"Utilities","AES":"Utilities","AFL":"Financials","AIG":"Financials","AIZ":"Financials","AJG":"Financials","AKAM":"Information Technology","ALB":"Materials","ALGN":"Health Care","ALL":"Financials","ALLE":"Industrials","AMAT":"Information Technology","AMCR":"Materials","AMD":"Information Technology","AME":"Industrials","AMGN":"Health Care","AMP":"Financials","AMT":"Real Estate","AMZN":"Consumer Discretionary","ANET":"Information Technology","AON":"Financials","AOS":"Industrials","APA":"Energy","APD":"Materials","APH":"Information Technology","APO":"Financials","APP":"Information Technology","APTV":"Consumer Discretionary","ARE":"Real Estate","ARES":"Financials","ATO":"Utilities","AVB":"Real Estate","AVGO":"Information Technology","AVY":"Materials","AWK":"Utilities","AXON":"Industrials","AXP":"Financials","AZO":"Consumer Discretionary","BA":"Industrials","BAC":"Financials","BALL":"Materials","BAX":"Health Care","BBY":"Consumer Discretionary","BDX":"Health Care","BEN":"Financials","BG":"Consumer Staples","BIIB":"Health Care","BK":"Financials","BKNG":"Consumer Discretionary","BKR":"Energy","BLDR":"Industrials","BLK":"Financials","BMY":"Health Care","BNY":"Financials","BR":"Information Technology","BRK.B":"Financials","BRO":"Financials","BSX":"Health Care","BX":"Financials","BXP":"Real Estate","C":"Financials","CAG":"Consumer Staples","CAH":"Health Care","CARR":"Industrials","CASY":"Consumer Staples","CAT":"Industrials","CB":"Financials","CBOE":"Financials","CBRE":"Real Estate","CCI":"Real Estate","CCL":"Consumer Discretionary","CDNS":"Information Technology","CDW":"Information Technology","CEG":"Utilities","CF":"Materials","CFG":"Financials","CHD":"Consumer Staples","CHRW":"Industrials","CHTR":"Communication Services","CI":"Health Care","CIEN":"Information Technology","CINF":"Financials","CL":"Consumer Staples","CLX":"Consumer Staples","CMCSA":"Communication Services","CME":"Financials","CMG":"Consumer Discretionary","CMI":"Industrials","CMS":"Utilities","CNP":"Utilities","COF":"Financials","COHR":"Information Technology","COIN":"Financials","COO":"Health Care","COP":"Energy","COR":"Health Care","COST":"Consumer Staples","CPAY":"Financials","CPB":"Consumer Staples","CPRT":"Industrials","CPT":"Real Estate","CRH":"Materials","CRL":"Health Care","CRM":"Information Technology","CRWD":"Information Technology","CSCO":"Information Technology","CSGP":"Real Estate","CSX":"Industrials","CTAS":"Industrials","CTSH":"Information Technology","CTVA":"Materials","CVNA":"Consumer Discretionary","CVS":"Health Care","CVX":"Energy","D":"Utilities","DAL":"Industrials","DASH":"Consumer Discretionary","DDOG":"Information Technology","DE":"Industrials","DECK":"Consumer Discretionary","DELL":"Information Technology","DG":"Consumer Discretionary","DGX":"Health Care","DHI":"Consumer Discretionary","DHR":"Health Care","DIS":"Communication Services","DLR":"Real Estate","DLTR":"Consumer Discretionary","DOC":"Real Estate","DOV":"Industrials","DOW":"Materials","DPZ":"Consumer Discretionary","DRI":"Consumer Discretionary","DTE":"Utilities","DUK":"Utilities","DVA":"Health Care","DVN":"Energy","EA":"Communication Services","EBAY":"Consumer Discretionary","ECL":"Materials","ED":"Utilities","EFX":"Industrials","EG":"Financials","EIX":"Utilities","EL":"Consumer Staples","ELV":"Health Care","EME":"Industrials","EMR":"Industrials","EOG":"Energy","EPAM":"Information Technology","EQIX":"Real Estate","EQR":"Real Estate","EQT":"Energy","ERIE":"Financials","ES":"Utilities","ESS":"Real Estate","ETN":"Industrials","ETR":"Utilities","EVRG":"Utilities","EW":"Health Care","EXC":"Utilities","EXE":"Energy","EXPD":"Industrials","EXPE":"Consumer Discretionary","EXR":"Real Estate","F":"Consumer Discretionary","FANG":"Energy","FAST":"Industrials","FCX":"Materials","FDS":"Financials","FDX":"Industrials","FE":"Utilities","FFIV":"Information Technology","FICO":"Information Technology","FIS":"Information Technology","FITB":"Financials","FIX":"Industrials","FOX":"Communication Services","FOXA":"Communication Services","FRT":"Real Estate","FSLR":"Information Technology","FTNT":"Information Technology","FTV":"Industrials","GD":"Industrials","GDDY":"Information Technology","GE":"Industrials","GEHC":"Health Care","GEN":"Information Technology","GEV":"Industrials","GILD":"Health Care","GIS":"Consumer Staples","GL":"Financials","GLW":"Information Technology","GM":"Consumer Discretionary","GNRC":"Industrials","GOOG":"Communication Services","GOOGL":"Communication Services","GPC":"Consumer Discretionary","GPN":"Financials","GRMN":"Consumer Discretionary","GS":"Financials","GWW":"Industrials","HAL":"Energy","HAS":"Consumer Discretionary","HBAN":"Financials","HCA":"Health Care","HD":"Consumer Discretionary","HIG":"Financials","HII":"Industrials","HLT":"Consumer Discretionary","HON":"Industrials","HOOD":"Financials","HPE":"Information Technology","HPQ":"Information Technology","HRL":"Consumer Staples","HSIC":"Health Care","HST":"Real Estate","HSY":"Consumer Staples","HUBB":"Industrials","HUM":"Health Care","HWM":"Industrials","IBKR":"Financials","IBM":"Information Technology","ICE":"Financials","IDXX":"Health Care","IEX":"Industrials","IFF":"Materials","INCY":"Health Care","INTC":"Information Technology","INTU":"Information Technology","INVH":"Real Estate","IP":"Materials","IQV":"Health Care","IR":"Industrials","IRM":"Real Estate","ISRG":"Health Care","IT":"Information Technology","ITW":"Industrials","IVZ":"Financials","J":"Industrials","JBHT":"Industrials","JBL":"Information Technology","JCI":"Industrials","JKHY":"Financials","JNJ":"Health Care","JPM":"Financials","KDP":"Consumer Staples","KEY":"Financials","KEYS":"Information Technology","KHC":"Consumer Staples","KIM":"Real Estate","KKR":"Financials","KMB":"Consumer Staples","KMI":"Energy","KO":"Consumer Staples","KR":"Consumer Staples","KVUE":"Consumer Staples","L":"Financials","LDOS":"Information Technology","LEN":"Consumer Discretionary","LH":"Health Care","LHX":"Industrials","LII":"Industrials","LIN":"Materials","LITE":"Information Technology","LLY":"Health Care","LMT":"Industrials","LNT":"Utilities","LOW":"Consumer Discretionary","LRCX":"Information Technology","LULU":"Consumer Discretionary","LUV":"Industrials","LVS":"Consumer Discretionary","LYB":"Materials","LYV":"Communication Services","MA":"Financials","MAA":"Real Estate","MAR":"Consumer Discretionary","MAS":"Industrials","MCD":"Consumer Discretionary","MCHP":"Information Technology","MCK":"Health Care","MCO":"Financials","MDLZ":"Consumer Staples","MDT":"Health Care","MET":"Financials","META":"Communication Services","MGM":"Consumer Discretionary","MKC":"Consumer Staples","MLM":"Materials","MMC":"Financials","MMM":"Industrials","MNST":"Consumer Staples","MO":"Consumer Staples","MOS":"Materials","MPC":"Energy","MPWR":"Information Technology","MRK":"Health Care","MRNA":"Health Care","MS":"Financials","MSCI":"Financials","MSFT":"Information Technology","MSI":"Information Technology","MTB":"Financials","MTD":"Health Care","MU":"Information Technology","NCLH":"Consumer Discretionary","NDAQ":"Financials","NDSN":"Industrials","NEE":"Utilities","NEM":"Materials","NFLX":"Communication Services","NI":"Utilities","NKE":"Consumer Discretionary","NOC":"Industrials","NOW":"Information Technology","NRG":"Utilities","NSC":"Industrials","NTAP":"Information Technology","NTRS":"Financials","NUE":"Materials","NVDA":"Information Technology","NVR":"Consumer Discretionary","NWS":"Communication Services","NWSA":"Communication Services","NXPI":"Information Technology","O":"Real Estate","ODFL":"Industrials","OKE":"Energy","OMC":"Communication Services","ON":"Information Technology","ORCL":"Information Technology","ORLY":"Consumer Discretionary","OTIS":"Industrials","OXY":"Energy","PANW":"Information Technology","PAYX":"Information Technology","PCAR":"Industrials","PCG":"Utilities","PEG":"Utilities","PEP":"Consumer Staples","PFE":"Health Care","PFG":"Financials","PG":"Consumer Staples","PGR":"Financials","PH":"Industrials","PHM":"Consumer Discretionary","PKG":"Materials","PLD":"Real Estate","PLTR":"Information Technology","PM":"Consumer Staples","PNC":"Financials","PNR":"Industrials","PNW":"Utilities","PODD":"Health Care","POOL":"Consumer Discretionary","PPG":"Materials","PPL":"Utilities","PRU":"Financials","PSA":"Real Estate","PSKY":"Communication Services","PSX":"Energy","PTC":"Information Technology","PWR":"Industrials","PYPL":"Financials","Q":"Communication Services","QCOM":"Information Technology","RCL":"Consumer Discretionary","REG":"Real Estate","REGN":"Health Care","RF":"Financials","RJF":"Financials","RL":"Consumer Discretionary","RMD":"Health Care","ROK":"Industrials","ROL":"Industrials","ROP":"Industrials","ROST":"Consumer Discretionary","RSG":"Industrials","RTX":"Industrials","RVTY":"Health Care","SBAC":"Real Estate","SBUX":"Consumer Discretionary","SCHW":"Financials","SHW":"Materials","SJM":"Consumer Staples","SLB":"Energy","SMCI":"Information Technology","SNA":"Industrials","SNDK":"Information Technology","SNPS":"Information Technology","SO":"Utilities","SOLV":"Health Care","SPG":"Real Estate","SPGI":"Financials","SRE":"Utilities","STE":"Health Care","STLD":"Materials","STT":"Financials","STX":"Information Technology","STZ":"Consumer Staples","SW":"Materials","SWK":"Industrials","SWKS":"Information Technology","SYF":"Financials","SYK":"Health Care","SYY":"Consumer Staples","T":"Communication Services","TAP":"Consumer Staples","TDG":"Industrials","TDY":"Industrials","TECH":"Health Care","TEL":"Information Technology","TER":"Information Technology","TFC":"Financials","TGT":"Consumer Discretionary","TJX":"Consumer Discretionary","TKO":"Communication Services","TMO":"Health Care","TMUS":"Communication Services","TPL":"Energy","TPR":"Consumer Discretionary","TRGP":"Energy","TRMB":"Information Technology","TROW":"Financials","TRV":"Financials","TSCO":"Consumer Discretionary","TSLA":"Consumer Discretionary","TSN":"Consumer Staples","TT":"Industrials","TTD":"Communication Services","TTWO":"Communication Services","TXN":"Information Technology","TXT":"Industrials","TYL":"Information Technology","UAL":"Industrials","UBER":"Industrials","UDR":"Real Estate","UHS":"Health Care","ULTA":"Consumer Discretionary","UNH":"Health Care","UNP":"Industrials","UPS":"Industrials","URI":"Industrials","USB":"Financials","V":"Financials","VEEV":"Health Care","VICI":"Real Estate","VLO":"Energy","VLTO":"Industrials","VMC":"Materials","VRSK":"Industrials","VRSN":"Information Technology","VRT":"Industrials","VRTX":"Health Care","VST":"Utilities","VTR":"Real Estate","VTRS":"Health Care","VZ":"Communication Services","WAB":"Industrials","WAT":"Health Care","WBD":"Communication Services","WDAY":"Information Technology","WDC":"Information Technology","WEC":"Utilities","WELL":"Real Estate","WFC":"Financials","WM":"Industrials","WMB":"Energy","WMT":"Consumer Staples","WRB":"Financials","WSM":"Consumer Discretionary","WST":"Health Care","WTW":"Financials","WY":"Real Estate","WYNN":"Consumer Discretionary","XEL":"Utilities","XOM":"Energy","XYL":"Industrials","XYZ":"Financials","YUM":"Consumer Discretionary","ZBH":"Health Care","ZBRA":"Information Technology","ZTS":"Health Care"};
const HISTORICAL_STRENGTH = {"Industrials|100to250":{"tier":"neutral","avgReturn":0.29,"n":352},"Industrials|50to100":{"tier":"strong","avgReturn":0.99,"n":178},"Health Care|100to250":{"tier":"weak","avgReturn":-0.04,"n":177},"Information Technology|250to500":{"tier":"neutral","avgReturn":0.52,"n":171},"Information Technology|100to250":{"tier":"neutral","avgReturn":0.09,"n":315},"Financials|50to100":{"tier":"strong","avgReturn":0.81,"n":260},"Financials|100to250":{"tier":"neutral","avgReturn":0.49,"n":323},"Consumer Discretionary|100to250":{"tier":"weak","avgReturn":-0.07,"n":222},"Information Technology|50to100":{"tier":"strong","avgReturn":0.96,"n":156},"Real Estate|100to250":{"tier":"weak","avgReturn":-0.42,"n":117},"Health Care|250to500":{"tier":"neutral","avgReturn":0.25,"n":146},"Utilities|50to100":{"tier":"neutral","avgReturn":0.09,"n":149},"Consumer Staples|50to100":{"tier":"weak","avgReturn":-0.34,"n":111},"Financials|250to500":{"tier":"weak","avgReturn":-0.29,"n":169},"Industrials|250to500":{"tier":"strong","avgReturn":1.48,"n":226},"Industrials|500plus":{"tier":"strong","avgReturn":1.23,"n":101},"Health Care|50to100":{"tier":"neutral","avgReturn":0.12,"n":109},"Energy|100to250":{"tier":"neutral","avgReturn":0.12,"n":118}};
function getPriceBucket(p) { return p < 25 ? 'under25' : p < 50 ? '25to50' : p < 100 ? '50to100' : p < 250 ? '100to250' : p < 500 ? '250to500' : '500plus'; }
function getHistoricalStrength(sector, price) { return HISTORICAL_STRENGTH[sector + '|' + getPriceBucket(price)] || null; }
function getSector(symbol, overrides) { return (overrides && overrides[symbol]) || SECTOR_MAP[symbol] || 'Unknown'; }
function round2(n) { return Math.round(n * 100) / 100; }
// ---- Exit simulation & per-symbol evaluation ----
function evaluateSymbol(sym, bars, sectorOverrides) {
  if (!bars || bars.length < MIN_HISTORY + 2) return null;
  let longStreak = 0, lastLong = null, cDate = null, cPrice = null, cIndex = null;
  for (let i = MIN_HISTORY; i < bars.length; i++) {
    const r = longSignalAt(bars, i);
    longStreak = r.gatesPass ? longStreak + 1 : 0;
    lastLong = r;
    if (longStreak === BUY_PERSISTENCE_DAYS) { cDate = bars[i].date; cPrice = bars[i].close; cIndex = i; }
  }
  const lastClose = bars[bars.length - 1].close, lastDate = bars[bars.length - 1].date, sector = getSector(sym, sectorOverrides);
  const out = { longActive: null, longWatch: null, trackedPosition: null };
  if (cIndex !== null) {
    const daysSinceEntry = (new Date(lastDate) - new Date(cDate)) / 86400000;
    if (daysSinceEntry <= 30) {
      out.trackedPosition = {
        symbol: sym, sector, entryDate: cDate, entryPrice: cPrice, lastClose, lastDate,
        currentlyActiveBuy: longStreak >= BUY_PERSISTENCE_DAYS,
        historicalStrength: getHistoricalStrength(sector, cPrice),
      };
    }
  }
  if (longStreak >= BUY_PERSISTENCE_DAYS) {
    out.longActive = { symbol: sym, sector, score: round2(lastLong.score), streakDays: longStreak, lastClose, lastDate, entryDate: cDate, entryPrice: cPrice, historicalStrength: getHistoricalStrength(sector, cPrice) };
  } else if (longStreak === 1) {
    out.longWatch = { symbol: sym, sector, score: round2(lastLong.score), lastClose, lastDate, historicalStrength: getHistoricalStrength(sector, lastClose) };
  }
  return out;
}
// ---- R2 / KV storage ----
const BARS_PREFIX = 'bars/';
function barsKey(symbol) { return `${BARS_PREFIX}${symbol}.json`; }
async function getSymbolBars(env, symbol) {
  const obj = await env.STOCK_PULSE_R2.get(barsKey(symbol));
  if (!obj) return null;
  const parsed = JSON.parse(await obj.text());
  return (parsed && !Array.isArray(parsed) && Array.isArray(parsed.bars)) ? parsed.bars : parsed;
}
async function putSymbolBars(env, symbol, bars) { await env.STOCK_PULSE_R2.put(barsKey(symbol), JSON.stringify(bars)); }
async function getSymbolBarsBatch(env, symbols) {
  const results = await Promise.all(symbols.map(sym => getSymbolBars(env, sym)));
  const out = {};
  symbols.forEach((sym, i) => { if (results[i]) out[sym] = results[i]; });
  return out;
}
async function putSymbolBarsBatch(env, map) { await Promise.all(Object.entries(map).map(([sym, bars]) => putSymbolBars(env, sym, bars))); }
async function listAllSymbolsFromR2(env) {
  let symbols = [], cursor;
  do {
    const listed = await env.STOCK_PULSE_R2.list({ prefix: BARS_PREFIX, cursor });
    symbols.push(...listed.objects.map(o => o.key.slice(BARS_PREFIX.length, -'.json'.length)));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
  return symbols;
}
async function saveSymbolList(env, symbols) { await env.STOCK_PULSE_KV.put('symbol_list', JSON.stringify(symbols)); }
async function getSymbolList(env) {
  const raw = await env.STOCK_PULSE_KV.get('symbol_list');
  if (raw) return JSON.parse(raw);
  const symbols = await listAllSymbolsFromR2(env);
  await saveSymbolList(env, symbols);
  return symbols;
}
const CHUNK_SIZE = 20, MAX_RETRIES_PER_SYMBOL = 2;
async function savePendingQueue(env, queue) { await env.STOCK_PULSE_KV.put('pending_queue', JSON.stringify(queue)); }
async function getPendingQueue(env, allSymbols) {
  const raw = await env.STOCK_PULSE_KV.get('pending_queue');
  if (raw) return JSON.parse(raw);
  const fresh = [...allSymbols];
  await savePendingQueue(env, fresh);
  return fresh;
}
async function getRetryCounts(env) { const raw = await env.STOCK_PULSE_KV.get('retry_counts'); return raw ? JSON.parse(raw) : {}; }
async function saveRetryCounts(env, counts) { await env.STOCK_PULSE_KV.put('retry_counts', JSON.stringify(counts)); }
async function getStatus(env) {
  const today = new Date().toISOString().slice(0, 10);
  const symbols = await getSymbolList(env);
  const alreadyRefreshedToday = (await env.STOCK_PULSE_KV.get('last_full_refresh_date')) === today;
  const queue = alreadyRefreshedToday ? [] : await getPendingQueue(env, symbols);
  return { today, alreadyRefreshedToday, totalSymbols: symbols.length, remainingInQueue: queue.length, chunkSymbols: queue.slice(0, CHUNK_SIZE), chunkSize: CHUNK_SIZE };
}
function emptyPartial() { return { long: [], longWatch: [], stale: [], trackedPositions: [] }; }
async function getPartialReport(env) { const raw = await env.STOCK_PULSE_KV.get('partial_report'); return raw ? JSON.parse(raw) : emptyPartial(); }
async function savePartialReport(env, partial) { await env.STOCK_PULSE_KV.put('partial_report', JSON.stringify(partial)); }
function validateBar(newBar, existingBars) {
  if (!newBar || typeof newBar !== 'object') return { valid: false, reason: 'not an object' };
  const { date, open, high, low, close, volume } = newBar;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { valid: false, reason: 'invalid date format' };
  for (const [name, val] of [['open', open], ['high', high], ['low', low], ['close', close], ['volume', volume]])
    if (typeof val !== 'number' || !isFinite(val) || val < 0) return { valid: false, reason: `invalid ${name}: ${val}` };
  if (high < low || high < open || high < close || low > open || low > close) return { valid: false, reason: 'OHLC values inconsistent (high/low bounds violated)' };
  if (existingBars && existingBars.length > 0) {
    const lastClose = existingBars[existingBars.length - 1].close;
    if (lastClose > 0) {
      const pctMove = Math.abs((close - lastClose) / lastClose) * 100;
      if (pctMove > 50) return { valid: false, reason: `implausible ${pctMove.toFixed(1)}% single-day move from last known close` };
    }
  }
  return { valid: true };
}
async function submitChunk(env, newBarsBySymbol) {
  const allSymbols = await getSymbolList(env);
  if (!allSymbols || allSymbols.length === 0) return { error: 'No data in R2 yet -- run /seed-all first.' };
  const queue = await getPendingQueue(env, allSymbols);
  const retryCounts = await getRetryCounts(env);
  const partial = await getPartialReport(env);
  const sectorOverrides = await getSectorOverrides(env);
  const perfAcc = await getSectorPerfAccumulator(env);
  const attemptedSymbols = Object.keys(newBarsBySymbol);
  const chunkBars = await getSymbolBarsBatch(env, attemptedSymbols);
  let updatedCount = 0, requeuedCount = 0, givenUpCount = 0;
  const stillFailed = [];
  const accumulatePerf = (sym, bars) => {
    if (!bars || bars.length < 2) return;
    const prev = bars[bars.length - 2].close, last = bars[bars.length - 1].close;
    if (!prev) return;
    const pct = ((last - prev) / prev) * 100;
    if (!isFinite(pct)) return;
    const sector = getSector(sym, sectorOverrides);
    if (!perfAcc[sector]) perfAcc[sector] = { sumPct: 0, count: 0 };
    perfAcc[sector].sumPct += pct;
    perfAcc[sector].count += 1;
  };
  const pushEval = (sym, bars) => {
    accumulatePerf(sym, bars);
    const e = evaluateSymbol(sym, bars, sectorOverrides);
    if (!e) return;
    if (e.longActive) partial.long.push(e.longActive);
    if (e.longWatch) partial.longWatch.push(e.longWatch);
    if (e.trackedPosition) partial.trackedPositions.push(e.trackedPosition);
  };
  for (const sym of attemptedSymbols) {
    const bars = chunkBars[sym];
    if (!bars) continue;
    const newBar = newBarsBySymbol[sym];
    let succeeded = false;
    if (newBar && validateBar(newBar, bars).valid) {
      if (!new Set(bars.map(b => b.date)).has(newBar.date)) { bars.push(newBar); updatedCount++; }
      succeeded = true;
    }
    if (succeeded) {
      delete retryCounts[sym];
      pushEval(sym, bars);
    } else {
      const attemptsSoFar = (retryCounts[sym] || 0) + 1;
      if (attemptsSoFar <= MAX_RETRIES_PER_SYMBOL) {
        retryCounts[sym] = attemptsSoFar; stillFailed.push(sym); requeuedCount++;
      } else {
        delete retryCounts[sym]; givenUpCount++;
        partial.stale.push({ symbol: sym, lastKnownDate: bars[bars.length - 1]?.date, lastKnownClose: bars[bars.length - 1]?.close });
        pushEval(sym, bars);
      }
    }
  }
  await putSymbolBarsBatch(env, chunkBars);
  await saveSectorPerfAccumulator(env, perfAcc);
  const newQueue = queue.filter(sym => !attemptedSymbols.includes(sym));
  newQueue.push(...stillFailed);
  const cycleComplete = newQueue.length === 0;
  if (cycleComplete) {
    await finalizeReport(env, partial);
    await env.STOCK_PULSE_KV.delete('pending_queue');
    await env.STOCK_PULSE_KV.delete('retry_counts');
    await env.STOCK_PULSE_KV.delete('sector_perf_accumulator');
    await savePartialReport(env, emptyPartial());
  } else {
    await savePendingQueue(env, newQueue);
    await saveRetryCounts(env, retryCounts);
    await savePartialReport(env, partial);
  }
  return { updatedCount, requeuedCount, givenUpCount, remainingInQueue: newQueue.length, cycleComplete, totalSymbols: allSymbols.length, reportGenerated: cycleComplete };
}
// ---- Server-side refresh (cron + trigger) ----
const CRON_RETRY_COUNT = 2, CRON_RETRY_DELAY_MS = 500, LOCK_TIMEOUT_MS = 55000;
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
async function fetchLatestBarFromAlpacaServerSide(symbol) {
  for (let attempt = 0; attempt <= CRON_RETRY_COUNT; attempt++) {
    try {
      const resp = await fetch(`${ALPACA_PROXY_BASE}/bars?symbol=${symbol}&limit=1`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/124.0.0.0 Mobile Safari/537.36', 'Accept': 'application/json' },
      });
      if (resp.ok) {
        const bars = (await resp.json()).bars || [];
        if (bars.length) return bars[bars.length - 1];
      }
    } catch (e) { /* retry */ }
    if (attempt < CRON_RETRY_COUNT) await sleep(CRON_RETRY_DELAY_MS);
  }
  return null;
}
async function acquireLock(env) {
  const raw = await env.STOCK_PULSE_KV.get('cron_lock');
  if (raw && Date.now() - parseInt(raw, 10) < LOCK_TIMEOUT_MS) return false;
  await env.STOCK_PULSE_KV.put('cron_lock', String(Date.now()));
  return true;
}
async function releaseLock(env) { await env.STOCK_PULSE_KV.delete('cron_lock'); }
async function runOneChunkServerSide(env) {
  const today = new Date().toISOString().slice(0, 10);
  if ((await env.STOCK_PULSE_KV.get('last_full_refresh_date')) === today) return { skipped: true, reason: `Already refreshed today (${today}).` };
  if (!(await acquireLock(env))) return { skipped: true, reason: 'Another invocation is already in progress.' };
  try {
    const allSymbols = await getSymbolList(env);
    if (allSymbols.length === 0) return { error: 'No data in R2 yet -- run /seed-all first.' };
    const chunkSymbols = (await getPendingQueue(env, allSymbols)).slice(0, CHUNK_SIZE);
    const bars = {};
    for (const sym of chunkSymbols) bars[sym] = await fetchLatestBarFromAlpacaServerSide(sym);
    return await submitChunk(env, bars);
  } finally {
    await releaseLock(env);
  }
}
function dedupeBySymbol(items) {
  const seen = new Set(), result = [];
  for (const item of items) if (!seen.has(item.symbol)) { seen.add(item.symbol); result.push(item); }
  return result;
}
// ---- Paper portfolio ----
const PAPER_PORTFOLIO_POSITION_SIZE = 1000, DEFAULT_PAPER_PORTFOLIO_STARTING_CASH = 40000;
const MAX_ENTRY_AGE_DAYS = 5;
async function getStartingCash(env) {
  const raw = await env.STOCK_PULSE_KV.get('starting_cash');
  const v = parseInt(raw, 10);
  return Number.isInteger(v) && v > 0 ? v : DEFAULT_PAPER_PORTFOLIO_STARTING_CASH;
}
function freshPortfolio(startingCash) { return { startingCash, cash: startingCash, holdings: {}, closedHistory: [] }; }
async function loadPaperPortfolio(env) {
  const raw = await env.STOCK_PULSE_KV.get('paper_portfolio');
  if (raw) return JSON.parse(raw);
  return freshPortfolio(await getStartingCash(env));
}
async function savePaperPortfolio(env, portfolio) { await env.STOCK_PULSE_KV.put('paper_portfolio', JSON.stringify(portfolio)); }
// --- Pyramiding tranche model ---
// Each holding = { sector, entryDate, peakPrice, tranches:[{entry,lastHarvest,shares,entryDate}],
//   everPaidOut, harvested (total $ banked), pyramidCount }.
// Rules: no ATR/score/MA50/tight-trailing exits. Repeating +25% harvest per tranche
// (trim back to $1000, bank profit). Pyramid +$1000 only when the stock has paid out
// AND fires a FRESH buy re-trigger (off->on) AND cash available. Full exit when price
// falls 25% below the position's peak price during ownership.
const HARVEST_STEP = 0.25;      // harvest each +25% climb from last harvest
const DRAWDOWN_EXIT = 0.25;     // exit whole position at 25% below peak price
function priceForSymbol(symbol, report) {
  const t = (report.trackedPositions || []).find(x => x.symbol === symbol);
  if (t && typeof t.lastClose === 'number') return t.lastClose;
  const l = (report.long || []).find(x => x.symbol === symbol);
  if (l && typeof l.lastClose === 'number') return l.lastClose;
  const w = (report.longWatch || []).find(x => x.symbol === symbol);
  if (w && typeof w.lastClose === 'number') return w.lastClose;
  return null;
}
function updatePaperPortfolio(portfolio, report, prevActiveSet) {
  const asOf = new Date(report.asOfDate);
  const activeBuys = {};
  for (const b of report.long || []) if (b.entryDate) activeBuys[b.symbol] = b;
  const activeSet = new Set(Object.keys(activeBuys));
  const prev = prevActiveSet || new Set();
  // 1. Process existing holdings: peak update -> drawdown exit -> else harvest tranches
  for (const symbol of Object.keys(portfolio.holdings)) {
    const h = portfolio.holdings[symbol];
    const price = priceForSymbol(symbol, report);
    if (price == null || price <= 0) continue; // no fresh price this cycle; leave as-is
    if (price > h.peakPrice) h.peakPrice = price;
    // full exit: 25% below peak
    if (price <= h.peakPrice * (1 - DRAWDOWN_EXIT)) {
      const totalShares = h.tranches.reduce((s, t) => s + t.shares, 0);
      const proceeds = totalShares * price;
      const invested = h.tranches.length * PAPER_PORTFOLIO_POSITION_SIZE;
      portfolio.cash += proceeds;
      portfolio.closedHistory.push({
        symbol, sector: h.sector, entryDate: h.entryDate, entryPrice: h.tranches[0].entry,
        exitDate: report.asOfDate, exitPrice: round2(price),
        tranches: h.tranches.length, harvested: round2(h.harvested || 0),
        // total P&L = exit proceeds + everything harvested - everything invested
        pnlDollar: round2(proceeds + (h.harvested || 0) - invested),
        pnlPct: round2(((proceeds + (h.harvested || 0) - invested) / invested) * 100),
        reason: 'drawdown_25pct',
      });
      delete portfolio.holdings[symbol];
      continue;
    }
    // harvest each tranche on every fresh +25% climb
    for (const t of h.tranches) {
      while (price >= t.lastHarvest * (1 + HARVEST_STEP)) {
        const curVal = t.shares * price;
        if (curVal <= PAPER_PORTFOLIO_POSITION_SIZE) break;
        const profit = curVal - PAPER_PORTFOLIO_POSITION_SIZE;
        t.shares -= profit / price;             // trim back to $1000 of value
        portfolio.cash += profit;               // bank the profit
        h.harvested = (h.harvested || 0) + profit;
        t.lastHarvest = t.lastHarvest * (1 + HARVEST_STEP);
        h.everPaidOut = true;
      }
    }
  }
  // 2. Fresh entries and pyramid-adds
  const freshTriggers = new Set([...activeSet].filter(s => !prev.has(s)));
  for (const symbol of Object.keys(activeBuys)) {
    const buy = activeBuys[symbol];
    const entryAgeDays = (asOf - new Date(buy.entryDate)) / 86400000;
    if (portfolio.holdings[symbol]) {
      // pyramid: held + paid out + FRESH re-trigger + cash
      const h = portfolio.holdings[symbol];
      if (h.everPaidOut && freshTriggers.has(symbol) && portfolio.cash >= PAPER_PORTFOLIO_POSITION_SIZE) {
        const price = priceForSymbol(symbol, report) || buy.entryPrice;
        h.tranches.push({ entry: price, lastHarvest: price, shares: PAPER_PORTFOLIO_POSITION_SIZE / price, entryDate: buy.entryDate });
        h.pyramidCount = (h.pyramidCount || 0) + 1;
        portfolio.cash -= PAPER_PORTFOLIO_POSITION_SIZE;
      }
    } else {
      // new entry (respect freshness gate + cash)
      if (portfolio.cash < PAPER_PORTFOLIO_POSITION_SIZE) continue;
      if (entryAgeDays > MAX_ENTRY_AGE_DAYS) continue;
      portfolio.holdings[symbol] = {
        sector: buy.sector, entryDate: buy.entryDate, peakPrice: buy.entryPrice, everPaidOut: false,
        harvested: 0, pyramidCount: 0,
        tranches: [{ entry: buy.entryPrice, lastHarvest: buy.entryPrice, shares: PAPER_PORTFOLIO_POSITION_SIZE / buy.entryPrice, entryDate: buy.entryDate }],
      };
      portfolio.cash -= PAPER_PORTFOLIO_POSITION_SIZE;
    }
  }
  return { portfolio, activeSymbols: [...activeSet] };
}
function buildPaperPortfolioSnapshot(portfolio, report) {
  const holdings = Object.entries(portfolio.holdings).map(([symbol, h]) => {
    const currentPrice = priceForSymbol(symbol, report) || h.tranches[0].entry;
    const totalShares = h.tranches.reduce((s, t) => s + t.shares, 0);
    const invested = h.tranches.length * PAPER_PORTFOLIO_POSITION_SIZE;
    const currentValue = totalShares * currentPrice;
    const harvested = h.harvested || 0;
    // live P&L = current holding value + harvested cash - invested capital
    const pnlDollar = currentValue + harvested - invested;
    // pending actions (for report Sell Watch / Sell Triggers / Harvest sections)
    const drawdownPct = h.peakPrice > 0 ? ((h.peakPrice - currentPrice) / h.peakPrice) * 100 : 0;
    const atDrawdownExit = currentPrice <= h.peakPrice * (1 - DRAWDOWN_EXIT); // >=25% down => exiting
    const nearDrawdown = !atDrawdownExit && drawdownPct >= 15;                 // 15-25% down => watch
    const harvestDue = h.tranches.some(t => currentPrice >= t.lastHarvest * (1 + HARVEST_STEP));
    return {
      symbol, sector: h.sector, entryDate: h.entryDate,
      entryPrice: h.tranches[0].entry, currentPrice: round2(currentPrice),
      trancheCount: h.tranches.length, pyramidRounds: h.tranches.length - 1,
      peakPrice: round2(h.peakPrice), harvested: round2(harvested), invested,
      currentValue: round2(currentValue),
      drawdownPct: round2(drawdownPct), atDrawdownExit, nearDrawdown, harvestDue,
      pnlDollar: round2(pnlDollar), pnlPct: round2((pnlDollar / invested) * 100),
    };
  });
  const holdingsValue = holdings.reduce((sum, h) => sum + h.currentValue, 0), totalValue = portfolio.cash + holdingsValue;
  const startingCash = (typeof portfolio.startingCash === 'number' && portfolio.startingCash > 0)
    ? portfolio.startingCash : DEFAULT_PAPER_PORTFOLIO_STARTING_CASH;
  return {
    startingCash, cash: round2(portfolio.cash), holdingsValue: round2(holdingsValue),
    totalValue: round2(totalValue), totalReturnPct: round2(((totalValue - startingCash) / startingCash) * 100),
    holdingsCount: holdings.length, holdings, closedHistory: portfolio.closedHistory,
  };
}
async function getTopNBuys(env) {
  const raw = await env.STOCK_PULSE_KV.get('top_n_buys');
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_TOP_N_BUYS;
}
async function getSectorOverrides(env) {
  const raw = await env.STOCK_PULSE_KV.get('sector_overrides');
  if (!raw) return {};
  try { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}
async function getSectorPerfAccumulator(env) {
  const raw = await env.STOCK_PULSE_KV.get('sector_perf_accumulator');
  if (!raw) return {};
  try { const o = JSON.parse(raw); return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}
async function saveSectorPerfAccumulator(env, acc) {
  await env.STOCK_PULSE_KV.put('sector_perf_accumulator', JSON.stringify(acc));
}
function buildSectorPerformance(acc) {
  const out = {};
  for (const [sector, agg] of Object.entries(acc || {})) {
    if (agg && agg.count > 0) out[sector] = { avgPct: Math.round((agg.sumPct / agg.count) * 100) / 100, count: agg.count };
  }
  return out;
}
async function finalizeReport(env, partial) {
  const topN = await getTopNBuys(env);
  const long = dedupeBySymbol(partial.long).sort((a, b) => b.score - a.score).slice(0, topN);
  const longWatch = dedupeBySymbol(partial.longWatch).sort((a, b) => b.score - a.score);
  const stale = dedupeBySymbol(partial.stale || []);
  const trackedPositions = dedupeBySymbol(partial.trackedPositions || []).sort((a, b) =>
    b.entryDate.localeCompare(a.entryDate));
  const asOfDate = new Date().toISOString().slice(0, 10);
  const report = { asOfDate, long, longWatch, stale, trackedPositions };
  report.sectorPerformance = buildSectorPerformance(await getSectorPerfAccumulator(env));
  const prevActiveRaw = await env.STOCK_PULSE_KV.get('last_active_buys');
  let prevActiveSet = new Set();
  try { const arr = prevActiveRaw ? JSON.parse(prevActiveRaw) : []; if (Array.isArray(arr)) prevActiveSet = new Set(arr); } catch (e) {}
  const upd = updatePaperPortfolio(await loadPaperPortfolio(env), report, prevActiveSet);
  const portfolio = upd.portfolio;
  await savePaperPortfolio(env, portfolio);
  await env.STOCK_PULSE_KV.put('last_active_buys', JSON.stringify(upd.activeSymbols));
  report.paperPortfolio = buildPaperPortfolioSnapshot(portfolio, report);
  await env.STOCK_PULSE_KV.put('report:latest', JSON.stringify(report));
  await env.STOCK_PULSE_KV.put(`report:${asOfDate}`, JSON.stringify(report));
  await env.STOCK_PULSE_KV.put('last_full_refresh_date', asOfDate);
  return report;
}
// ---- HTTP helpers ----
const CORS_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-Seed-Token' };
function jsonResponse(body, init = {}) {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...(init.headers || {}) } });
}
function textResponse(body, init = {}) { return new Response(body, { ...init, headers: { ...CORS_HEADERS, ...(init.headers || {}) } }); }
function requireSeedToken(request, env) {
  if (!env.SEED_TOKEN) return jsonResponse({ error: 'SEED_TOKEN not configured on this Worker.' }, { status: 500 });
  if (request.headers.get('X-Seed-Token') !== env.SEED_TOKEN) return textResponse('Unauthorized', { status: 401 });
  return null;
}
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_SEC = 60;
async function rateLimited(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const bucket = Math.floor(Date.now() / 1000 / RATE_LIMIT_WINDOW_SEC);
  const key = `rl:${ip}:${bucket}`;
  let count = 0;
  try {
    const raw = await env.STOCK_PULSE_KV.get(key);
    count = raw ? parseInt(raw, 10) : 0;
  } catch (e) { return false; }
  if (count >= RATE_LIMIT_MAX) return true;
  try { await env.STOCK_PULSE_KV.put(key, String(count + 1), { expirationTtl: RATE_LIMIT_WINDOW_SEC + 10 }); } catch (e) {}
  return false;
}
export default {
  async scheduled(event, env, ctx) { ctx.waitUntil(runOneChunkServerSide(env)); },
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
    const url = new URL(request.url);
    if (url.pathname === '/report/latest') {
      if (await rateLimited(request, env)) return textResponse('Rate limit exceeded. Try again shortly.', { status: 429 });
      return jsonResponse(await env.STOCK_PULSE_KV.get('report:latest') || '{"error":"no report yet"}');
    }
    if (url.pathname === '/status') {
      if (await rateLimited(request, env)) return textResponse('Rate limit exceeded. Try again shortly.', { status: 429 });
      return jsonResponse(await getStatus(env));
    }
    if (url.pathname === '/list-unknown') {
      // Read-only. Lists every symbol resolving to Unknown (not in SECTOR_MAP,
      // no override). No R2 reads -- just the symbol list vs the two sources --
      // so it returns the whole universe in one call.
      const denied = requireSeedToken(request, env); if (denied) return denied;
      const allSymbols = await getSymbolList(env);
      const overrides = await getSectorOverrides(env);
      const unknown = allSymbols.filter(s => !SECTOR_MAP[s] && !overrides[s]).sort();
      return jsonResponse({
        totalSymbols: allSymbols.length,
        inSectorMap: allSymbols.filter(s => SECTOR_MAP[s]).length,
        hasOverride: allSymbols.filter(s => overrides[s]).length,
        unknownCount: unknown.length,
        unknown,
      });
    }

    if (url.pathname === '/analyze-atr') {
      const denied = requireSeedToken(request, env); if (denied) return denied;
      const ATR_BATCH = 40;
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const allSymbols = await getSymbolList(env);
      const overrides = await getSectorOverrides(env);
      const batch = allSymbols.slice(offset, offset + ATR_BATCH);
      const barsList = await Promise.all(batch.map(sym => getSymbolBars(env, sym)));
      const raw = await env.STOCK_PULSE_KV.get('atr_analysis_acc');
      let acc = {};
      try { acc = raw ? JSON.parse(raw) : {}; } catch (e) { acc = {}; }
      batch.forEach((sym, i) => {
        const bars = barsList[i];
        if (!Array.isArray(bars) || bars.length < 20) return;
        const atr = computeATRRatio(bars);
        if (!isFinite(atr)) return;
        const sector = getSector(sym, overrides);
        if (!acc[sector]) acc[sector] = { sumAtr: 0, count: 0, overThreshold: 0 };
        acc[sector].sumAtr += atr;
        acc[sector].count += 1;
        if (atr > ATR_EXIT_THRESHOLD) acc[sector].overThreshold += 1;
      });
      const nextOffset = offset + ATR_BATCH;
      const done = nextOffset >= allSymbols.length;
      if (done) {
        await env.STOCK_PULSE_KV.delete('atr_analysis_acc');
        const bySector = Object.keys(acc).sort().map(sector => {
          const a = acc[sector];
          return {
            sector,
            symbols: a.count,
            avgAtrRatio: Math.round((a.sumAtr / a.count) * 1000) / 1000,
            overThresholdPct: Math.round((a.overThreshold / a.count) * 1000) / 10,
          };
        }).sort((x, y) => y.avgAtrRatio - x.avgAtrRatio);
        return jsonResponse({ done: true, atrExitThreshold: ATR_EXIT_THRESHOLD, sectors: bySector,
          note: 'avgAtrRatio = mean current ATR ratio for the sector. overThresholdPct = % of the sector currently above ATR_EXIT_THRESHOLD (would trip the ATR exit). Higher = that sector over-trips a single global threshold.' });
      }
      await env.STOCK_PULSE_KV.put('atr_analysis_acc', JSON.stringify(acc), { expirationTtl: 3600 });
      return jsonResponse({ done: false, scannedRange: `${offset}-${nextOffset}`, totalSymbols: allSymbols.length, nextOffset,
        note: `Accumulating... call again with ?offset=${nextOffset} until done.` });
    }
    if (url.pathname === '/analyze-stale') {
      const denied = requireSeedToken(request, env); if (denied) return denied;
      const rawReport = await env.STOCK_PULSE_KV.get('report:latest');
      if (!rawReport) return jsonResponse({ error: 'No report yet.' });
      const report = JSON.parse(rawReport);
      const stale = (report.stale || []).map(s => s.symbol);
      const overrides = await getSectorOverrides(env);
      const inMap = [], hasOverride = [], pruneCandidates = [];
      for (const sym of stale) {
        if (SECTOR_MAP[sym]) inMap.push(sym);
        else if (overrides[sym]) hasOverride.push(sym);
        else pruneCandidates.push(sym);
      }
      inMap.sort(); hasOverride.sort(); pruneCandidates.sort();
      return jsonResponse({
        totalStale: stale.length,
        keepInSectorMap: { count: inMap.length, symbols: inMap },
        keepHasOverride: { count: hasOverride.length, symbols: hasOverride },
        pruneCandidates: { count: pruneCandidates.length, symbols: pruneCandidates },
        note: 'Read-only cross-reference. Use /analyze-stale-depth?offset=0 to inspect bar-depth of prune candidates.',
      });
    }
    if (url.pathname === '/prune-abandoned') {
      const denied = requireSeedToken(request, env); if (denied) return denied;
      const PRUNE_AGE_DAYS = 60;
      const PRUNE_BATCH = 20;
      const isConfirmed = url.searchParams.get('confirm') === 'yes';
      if (isConfirmed) {
        const denied = requireSeedToken(request, env); if (denied) return denied;
      }
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const allSymbols = await getSymbolList(env);
      const batch = allSymbols.slice(offset, offset + PRUNE_BATCH);
      const barsList = await Promise.all(batch.map(sym => getSymbolBars(env, sym)));
      const now = Date.now();
      const toPrune = [];
      batch.forEach((sym, i) => {
        const bars = barsList[i];
        const n = Array.isArray(bars) ? bars.length : 0;
        const lastDate = n ? bars[n - 1].date : null;
        let ageDays = null;
        if (lastDate) {
          const t = Date.parse(lastDate + 'T00:00:00Z');
          if (!isNaN(t)) ageDays = Math.round((now - t) / 86400000);
        }
        if (ageDays === null || ageDays > PRUNE_AGE_DAYS) {
          toPrune.push({ symbol: sym, lastDate, ageDays });
        }
      });
      let deleted = 0;
      if (isConfirmed && toPrune.length) {
        await Promise.all(toPrune.map(p => env.STOCK_PULSE_R2.delete(barsKey(p.symbol))));
        deleted = toPrune.length;
        const pruneSet = new Set(toPrune.map(p => p.symbol));
        const remaining = allSymbols.filter(s => !pruneSet.has(s));
        await saveSymbolList(env, remaining);
      }
      const nextOffset = offset + PRUNE_BATCH - (isConfirmed ? deleted : 0);
      const done = nextOffset >= allSymbols.length - (isConfirmed ? deleted : 0);
      return jsonResponse({
        mode: isConfirmed ? 'DELETE' : 'dry-run',
        ageThresholdDays: PRUNE_AGE_DAYS,
        scannedRange: `${offset}-${Math.min(offset + PRUNE_BATCH, allSymbols.length)}`,
        totalSymbols: allSymbols.length,
        wouldPrune: toPrune.length,
        deleted,
        prunedThisBatch: toPrune,
        done,
        nextOffset: done ? null : nextOffset,
        note: isConfirmed
          ? 'Deleted the listed symbols from R2 and the symbol list. The list shrank by ' + deleted + '; advance to ?confirm=yes&offset=' + (done ? '(done)' : nextOffset) + ' (offset already adjusted for removals).'
          : 'DRY RUN -- nothing deleted. To delete, add ?confirm=yes and the X-Seed-Token header. Paginate with ?offset=' + (done ? '(done)' : nextOffset),
      });
    }
    if (url.pathname === '/analyze-stale-depth') {
      const denied = requireSeedToken(request, env); if (denied) return denied;
      const DEPTH_BATCH = 40;
      const STALE_AGE_DAYS = 60;
      const offset = parseInt(url.searchParams.get('offset') || '0');
      const rawReport = await env.STOCK_PULSE_KV.get('report:latest');
      if (!rawReport) return jsonResponse({ error: 'No report yet.' });
      const report = JSON.parse(rawReport);
      const overrides = await getSectorOverrides(env);
      const candidates = (report.stale || []).map(s => s.symbol)
        .filter(sym => !SECTOR_MAP[sym] && !overrides[sym])
        .sort();
      const batch = candidates.slice(offset, offset + DEPTH_BATCH);
      const barsList = await Promise.all(batch.map(sym => getSymbolBars(env, sym)));
      const now = Date.now();
      const rows = batch.map((sym, i) => {
        const bars = barsList[i];
        const n = Array.isArray(bars) ? bars.length : 0;
        const lastDate = n ? bars[n - 1].date : null;
        let ageDays = null;
        if (lastDate) {
          const t = Date.parse(lastDate + 'T00:00:00Z');
          if (!isNaN(t)) ageDays = Math.round((now - t) / 86400000);
        }
        return { symbol: sym, bars: n, lastDate, ageDays };
      });
      const abandoned = rows.filter(r => r.ageDays === null || r.ageDays > STALE_AGE_DAYS)
        .sort((a, b) => (b.ageDays || 1e9) - (a.ageDays || 1e9));
      const recent = rows.filter(r => r.ageDays !== null && r.ageDays <= STALE_AGE_DAYS)
        .sort((a, b) => a.ageDays - b.ageDays);
      const nextOffset = offset + DEPTH_BATCH;
      const done = nextOffset >= candidates.length;
      return jsonResponse({
        totalPruneCandidates: candidates.length,
        analyzedRange: `${offset}-${Math.min(nextOffset, candidates.length)}`,
        staleAgeThresholdDays: STALE_AGE_DAYS,
        done,
        nextOffset: done ? null : nextOffset,
        abandoned: { count: abandoned.length, symbols: abandoned },
        recentlyActive: { count: recent.length, symbols: recent },
        note: 'abandoned (last bar older than threshold, or none) = safe to prune. recentlyActive = updated recently, keep. Classified by AGE of most recent bar, not bar count.',
      });
    }
    if (url.pathname === '/trigger-chunk') {
      const denied = requireSeedToken(request, env); if (denied) return denied;
      return jsonResponse(await runOneChunkServerSide(env));
    }
    if (url.pathname === '/diagnose-fetch') {
      const denied = requireSeedToken(request, env); if (denied) return denied;
      const symbol = url.searchParams.get('symbol') || 'AAPL';
      const targetUrl = `${ALPACA_PROXY_BASE}/bars?symbol=${symbol}&limit=1`;
      try {
        const resp = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) Chrome/124.0.0.0 Mobile Safari/537.36', 'Accept': 'application/json' } });
        const bodyText = await resp.text();
        const headersObj = {}; resp.headers.forEach((v, k) => { headersObj[k] = v; });
        return jsonResponse({ targetUrl, status: resp.status, ok: resp.ok, responseHeaders: headersObj, bodySnippet: bodyText.slice(0, 500) });
      } catch (e) { return jsonResponse({ targetUrl, error: e.message || String(e), errorName: e.name }); }
    }
    if (url.pathname === '/reset-cycle') {
      const denied = requireSeedToken(request, env); if (denied) return denied;
      await env.STOCK_PULSE_KV.delete('last_full_refresh_date');
      await env.STOCK_PULSE_KV.delete('pending_queue');
      await env.STOCK_PULSE_KV.delete('retry_counts');
      await env.STOCK_PULSE_KV.delete('sector_perf_accumulator');
      await savePartialReport(env, emptyPartial());
      return jsonResponse({ ok: true, message: 'Cycle reset -- next chunk will start a fresh refresh.' });
    }
    if (url.pathname === '/reset-portfolio') {
      const denied = requireSeedToken(request, env); if (denied) return denied;
      if (url.searchParams.get('confirm') !== 'yes') return jsonResponse({ error: 'Refusing to reset without confirmation. Append ?confirm=yes to proceed.' }, { status: 400 });
      const startingCash = await getStartingCash(env);
      const fresh = freshPortfolio(startingCash);
      await savePaperPortfolio(env, fresh);
      await env.STOCK_PULSE_KV.delete('last_active_buys');
      const rawReport = await env.STOCK_PULSE_KV.get('report:latest');
      if (rawReport) {
        const report = JSON.parse(rawReport);
        report.paperPortfolio = buildPaperPortfolioSnapshot(fresh, report);
        await env.STOCK_PULSE_KV.put('report:latest', JSON.stringify(report));
      }
      return jsonResponse({ ok: true, message: 'Paper portfolio reset to starting cash.', startingCash });
    }
    if (url.pathname === '/config/top-n-buys') {
      if (request.method === 'GET') {
        if (await rateLimited(request, env)) return textResponse('Rate limit exceeded. Try again shortly.', { status: 429 });
        return jsonResponse({ topNBuys: await getTopNBuys(env), default: DEFAULT_TOP_N_BUYS });
      }
      const denied = requireSeedToken(request, env); if (denied) return denied;
      const n = parseInt(url.searchParams.get('value'), 10);
      if (!Number.isInteger(n) || n < 1) return jsonResponse({ error: 'Provide ?value=<positive integer>.' }, { status: 400 });
      await env.STOCK_PULSE_KV.put('top_n_buys', String(n));
      return jsonResponse({ ok: true, topNBuys: n, note: 'Applies on the next completed refresh cycle.' });
    }
    if (url.pathname === '/config/starting-cash') {
      if (request.method === 'GET') {
        if (await rateLimited(request, env)) return textResponse('Rate limit exceeded. Try again shortly.', { status: 429 });
        return jsonResponse({ startingCash: await getStartingCash(env), default: DEFAULT_PAPER_PORTFOLIO_STARTING_CASH });
      }
      const denied = requireSeedToken(request, env); if (denied) return denied;
      const v = parseInt(url.searchParams.get('value'), 10);
      if (!Number.isInteger(v) || v < 1 || v > 100000000) return jsonResponse({ error: 'Provide ?value=<positive integer up to 100000000>.' }, { status: 400 });
      await env.STOCK_PULSE_KV.put('starting_cash', String(v));
      return jsonResponse({ ok: true, startingCash: v, note: 'Applies when the portfolio is next reset (/reset-portfolio?confirm=yes). Existing portfolio is unchanged until then.' });
    }
    if (url.pathname === '/config/sector-overrides') {
      if (request.method === 'GET') {
        if (await rateLimited(request, env)) return textResponse('Rate limit exceeded. Try again shortly.', { status: 429 });
        const overrides = await getSectorOverrides(env);
        return jsonResponse({ overrides, count: Object.keys(overrides).length });
      }
      const denied = requireSeedToken(request, env); if (denied) return denied;
      let incoming;
      try { incoming = await request.json(); } catch (e) { return jsonResponse({ error: 'Body must be JSON, e.g. {"GMED":"Health Care","SUI":"Real Estate"}.' }, { status: 400 }); }
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return jsonResponse({ error: 'Body must be a JSON object mapping SYMBOL -> sector. Use null as a value to remove an entry.' }, { status: 400 });
      }
      const entries = Object.entries(incoming);
      const MAX_OVERRIDES_PER_CALL = 200;
      if (entries.length > MAX_OVERRIDES_PER_CALL) {
        return jsonResponse({ error: `Too many entries in one call (${entries.length}). Max ${MAX_OVERRIDES_PER_CALL}.` }, { status: 400 });
      }
      const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;
      const VALID_SECTORS = new Set([
        'Communication Services', 'Consumer Discretionary', 'Consumer Staples',
        'Energy', 'Financials', 'Health Care', 'Industrials',
        'Information Technology', 'Materials', 'Real Estate', 'Utilities',
      ]);
      const overrides = await getSectorOverrides(env);
      let added = 0, removed = 0;
      const rejected = [];
      for (const [rawSym, sector] of entries) {
        const key = String(rawSym).toUpperCase();
        if (!TICKER_RE.test(key)) { rejected.push({ symbol: rawSym, reason: 'invalid ticker format' }); continue; }
        if (sector === null) {
          if (overrides[key] !== undefined) { delete overrides[key]; removed++; }
        } else if (typeof sector === 'string' && VALID_SECTORS.has(sector.trim())) {
          overrides[key] = sector.trim(); added++;
        } else {
          rejected.push({ symbol: key, reason: 'sector must be one of the standard sectors or null' });
        }
      }
      await env.STOCK_PULSE_KV.put('sector_overrides', JSON.stringify(overrides));
      return jsonResponse({ ok: true, added, removed, rejectedCount: rejected.length, rejected: rejected.slice(0, 20), totalOverrides: Object.keys(overrides).length, note: 'Applies on the next completed refresh cycle.' });
    }
    if (url.pathname === '/migrate-legacy-blob') {
      const denied = requireSeedToken(request, env); if (denied) return denied;
      const MIGRATE_BATCH = 20, offset = parseInt(url.searchParams.get('offset') || '0');
      const legacyObj = await env.STOCK_PULSE_R2.get('all_bars.json');
      if (!legacyObj) return jsonResponse({ done: true, message: 'No legacy all_bars.json blob found -- nothing to migrate.' });
      const legacyData = JSON.parse(await legacyObj.text());
      const legacySymbols = Object.keys(legacyData);
      const batchSymbols = legacySymbols.slice(offset, offset + MIGRATE_BATCH);
      const batchData = {};
      for (const sym of batchSymbols) batchData[sym] = legacyData[sym];
      await putSymbolBarsBatch(env, batchData);
      await saveSymbolList(env, [...new Set([...(await getSymbolList(env)), ...batchSymbols])]);
      const nextOffset = offset + MIGRATE_BATCH, done = nextOffset >= legacySymbols.length;
      return jsonResponse({ done, migratedThisCall: batchSymbols.length, totalLegacySymbols: legacySymbols.length, nextOffset: done ? null : nextOffset, message: done ? 'Migration complete. The old all_bars.json blob can now be safely deleted.' : `Call again with ?offset=${nextOffset} to continue.` });
    }
    if (url.pathname === '/seed-all') {
      const denied = requireSeedToken(request, env); if (denied) return denied;
      if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, { status: 405 });
      let incoming;
      try { incoming = await request.json(); }
      catch (e) { return jsonResponse({ error: 'Body must be valid JSON.' }, { status: 400 }); }
      if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
        return jsonResponse({ error: 'Body must be a JSON object mapping SYMBOL -> {bars:[...]} or SYMBOL -> [bars].' }, { status: 400 });
      }
      const entries = Object.entries(incoming);
      const MAX_SYMBOLS_PER_CALL = 600;
      if (entries.length > MAX_SYMBOLS_PER_CALL) {
        return jsonResponse({ error: `Too many symbols in one call (${entries.length}). Max ${MAX_SYMBOLS_PER_CALL} -- split into batches.` }, { status: 400 });
      }
      const TICKER_RE = /^[A-Z0-9.\-]{1,10}$/;
      const normalized = {};
      const rejected = [];
      for (const [rawSym, data] of entries) {
        const sym = String(rawSym).toUpperCase();
        if (!TICKER_RE.test(sym)) { rejected.push({ symbol: rawSym, reason: 'invalid ticker format' }); continue; }
        const bars = (data && !Array.isArray(data) && Array.isArray(data.bars)) ? data.bars : data;
        if (!Array.isArray(bars) || bars.length === 0) { rejected.push({ symbol: sym, reason: 'bars must be a non-empty array' }); continue; }
        let bad = null;
        for (let i = 0; i < bars.length; i++) {
          const v = validateBar(bars[i], bars.slice(0, i));
          if (!v.valid) { bad = `bar ${i}: ${v.reason}`; break; }
        }
        if (bad) { rejected.push({ symbol: sym, reason: bad }); continue; }
        normalized[sym] = bars;
      }
      const accepted = Object.keys(normalized);
      if (accepted.length === 0) {
        return jsonResponse({ error: 'No valid symbols to seed.', rejectedCount: rejected.length, rejected: rejected.slice(0, 20) }, { status: 400 });
      }
      await putSymbolBarsBatch(env, normalized);
      const mergedSymbolSet = new Set([...(await getSymbolList(env)), ...accepted]);
      await saveSymbolList(env, [...mergedSymbolSet]);
      return jsonResponse({
        ok: true,
        symbolsSeeded: accepted.length,
        rejectedCount: rejected.length,
        rejected: rejected.slice(0, 20),
        totalSymbolsNow: mergedSymbolSet.size,
      });
    }
    return textResponse('Stock Pulse Worker (R2-backed, chunked refresh). Try /status or /report/latest');
  },
};
