import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

const WORKER_URL = "https://alpaca-proxy.raylukeparadis.workers.dev";
const STOCK_PULSE_WORKER_URL = "https://stock-pulse-worker.raylukeparadis.workers.dev";
const COOLDOWN_MS = 1000;

function calcMA(data, period) {
  return data.map((d, i) => {
    if (i < period - 1) return { ...d, ma: null };
    const slice = data.slice(i - period + 1, i + 1);
    const avg = slice.reduce((s, x) => s + x.close, 0) / period;
    return { ...d, ma: parseFloat(avg.toFixed(2)) };
  });
}

function calcRSI(data, period = 7) {
  if (data.length < period + 1) return data.map(d => ({ ...d, rsi: null }));
  const gains = [], losses = [];
  for (let i = 1; i < data.length; i++) {
    const diff = data[i].close - data[i - 1].close;
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? Math.abs(diff) : 0);
  }
  return data.map((d, i) => {
    if (i < period) return { ...d, rsi: null };
    const g = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
    const l = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
    const rs = l === 0 ? 100 : g / l;
    return { ...d, rsi: parseFloat((100 - 100 / (1 + rs)).toFixed(1)) };
  });
}

// Helper: group by sector
function groupBySector(items) {
  const map = {};
  for (const item of items) {
    const sector = item.sector || "Unknown";
    if (!map[sector]) map[sector] = [];
    map[sector].push(item);
  }
  return Object.entries(map).map(([sector, items]) => ({ sector, items }));
}

// For second-buy detection (existing logic)
function isAveragingDownExcluded(symbol) {
  const excludedSubIndustries = [
    "Oil & Gas Refining & Marketing", "Oil & Gas Equipment & Services",
    "Specialty Chemicals", "Oil & Gas Exploration & Production",
    "Building Products & Equipment", "Airlines",
  ];
  const subIndustry = SUB_INDUSTRY_MAP[symbol];
  return excludedSubIndustries.includes(subIndustry);
}

// Existing helper functions from original file
const SUB_INDUSTRY_MAP = {
  "AAPL": "Consumer Electronics", "MSFT": "Software", "GOOGL": "Internet Services",
  "AMZN": "Internet Retail", "NVDA": "Semiconductors", "TSLA": "Auto Manufacturing",
  // ... (truncated for brevity; user's original map)
};

const SECTOR_MAP = {
  "A": "Health Care", "AAPL": "Information Technology", "ABBV": "Health Care",
  // ... (truncated; user's original map)
};

function getSector(symbol) { return SECTOR_MAP[symbol] || "Unknown"; }
function getCompanyName(symbol) { return symbol; } // Placeholder
function searchTickers(val) { return []; } // Placeholder
function fmtVol(v) { return (v / 1e6).toFixed(1) + "M"; }
function humanizeError(err, symbol) { return err || `Error loading ${symbol}`; }

function isInTopWinRateWindow(sector, price) {
  const topRateSectors = ["Information Technology", "Industrials"];
  const priceRange = [100, 250];
  return topRateSectors.includes(sector) && price >= priceRange[0] && price <= priceRange[1];
}

function getRecommendation(reportData, symbol) {
  if (!reportData) return null;
  const long = (reportData.long || []).find(x => x.symbol === symbol);
  if (long) return { status: "BUY", label: "Active Buy", color: "#3b82f6" };
  const watch = (reportData.longWatch || []).find(x => x.symbol === symbol);
  if (watch) return { status: "BUY_WATCH", label: "Buy Watch", color: "#84cc16" };
  const closed = (reportData.paperPortfolio?.holdings || []).find(x => x.symbol === symbol);
  if (closed) return { status: "HELD", label: "In Portfolio", color: "#8b5cf6" };
  return { status: "NONE", label: "No Signal", color: "#475569" };
}

export default function StockAnalyzer() {
  const [ticker, setTicker] = useState("");
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [watchListsExpanded, setWatchListsExpanded] = useState(false);
  const [portfolioExpanded, setPortfolioExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState("price");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [quote, setQuote] = useState(null);
  const [bars, setBars] = useState([]);
  const [intradayBars, setIntradayBars] = useState([]);
  const [intradayError, setIntradayError] = useState(null);
  const [recommendation, setRecommendation] = useState(null);
  const [allRecommendations, setAllRecommendations] = useState(null);
  const [recsLoading, setRecsLoading] = useState(true);
  const [cooldown, setCooldown] = useState(0);
  const cooldownTimer = useRef(null);

  const startCooldown = useCallback(() => {
    if (cooldownTimer.current) clearInterval(cooldownTimer.current);
    const total = Math.ceil(COOLDOWN_MS / 1000);
    setCooldown(total);
    cooldownTimer.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownTimer.current); return 0; }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => () => clearInterval(cooldownTimer.current), []);

  useEffect(() => {
    fetch(`${STOCK_PULSE_WORKER_URL}/report/latest`)
      .then(r => r.json())
      .then(data => {
        if (!data.error) setAllRecommendations(data);
      })
      .catch(() => {})
      .finally(() => setRecsLoading(false));
  }, []);

  async function handleLookup(symbolOverride) {
    if (cooldown > 0) return;
    let t = (symbolOverride || input).trim().toUpperCase();
    if (!t) return;

    if (!SECTOR_MAP[t]) {
      const matches = searchTickers(t, 1);
      if (matches.length > 0 && matches[0].name.toUpperCase() === t) {
        t = matches[0].symbol;
      }
    }

    setInput(t);
    setShowSuggestions(false);

    setLoading(true);
    setError(null);
    setQuote(null);
    setBars([]);
    setIntradayBars([]);
    setIntradayError(null);
    setRecommendation(null);
    startCooldown();

    try {
      const [quoteRes, barsRes, reportRes] = await Promise.all([
        fetch(`${WORKER_URL}/quote?symbol=${t}`),
        fetch(`${WORKER_URL}/bars?symbol=${t}&limit=30&timeframe=1Day`),
        fetch(`${STOCK_PULSE_WORKER_URL}/report/latest`).catch(() => null),
      ]);

      if (quoteRes.status === 429 || barsRes.status === 429) {
        throw new Error("Rate limited. Please wait a moment and try again.");
      }

      const quoteData = await quoteRes.json();
      const barsData = await barsRes.json();

      if (quoteData.error) throw new Error(humanizeError(quoteData.error, t));
      if (barsData.error) throw new Error(humanizeError(barsData.error, t));
      if (!quoteData.price) throw new Error(`Couldn't find "${t}" -- double check the ticker symbol, or try searching by company name instead.`);

      setQuote(quoteData);
      setBars(barsData.bars || []);
      setTicker(t);

      const todayStr = new Date().toISOString().slice(0, 10);

      const fetchBars = (url) =>
        fetch(url).then(r => {
          if (r.status === 429) throw new Error('rate_limited');
          return r.json();
        }).then(data => {
          if (data.error) throw new Error(data.error);
          return data.bars || [];
        });

      fetchBars(`${WORKER_URL}/bars?symbol=${t}&timeframe=5Min&start=${todayStr}&end=${todayStr}`)
        .then(bars => {
          if (bars.length > 0) {
            setIntradayBars(bars);
            setIntradayError(null);
            return;
          }
          fetchBars(`${WORKER_URL}/bars?symbol=${t}&timeframe=5Min&limit=100`)
            .then(bars => {
              setIntradayBars(bars);
              setIntradayError(null);
            })
            .catch(err => {
              setIntradayBars([]);
              setIntradayError(err.message === 'rate_limited' ? 'Rate limited -- try looking this ticker up again' : err.message);
            });
        })
        .catch(err => {
          setIntradayBars([]);
          setIntradayError(err.message === 'rate_limited' ? 'Rate limited -- try looking this ticker up again' : err.message);
        });

      if (reportRes && reportRes.ok) {
        const reportData = await reportRes.json();
        setRecommendation(getRecommendation(reportData, t));
      } else {
        setRecommendation(null);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const { priceData, rsiData } = useMemo(() => {
    if (!bars.length) return { priceData: [], rsiData: [] };
    const withMA = calcMA(bars, 5);
    const rsi = calcRSI(bars, 7);
    return { priceData: withMA, rsiData: rsi };
  }, [bars]);

  const lastRSI = rsiData[rsiData.length - 1]?.rsi;
  const momentum = bars.length >= 2
    ? ((bars[bars.length - 1].close - bars[0].close) / bars[0].close * 100).toFixed(2)
    : "0.00";

  // Pyramid-aware recommendation rendering
  function renderRecommendationCategories(categoryKeysToShow) {
    const longActive = allRecommendations?.long || [];
    const longWatch = allRecommendations?.longWatch || [];
    const holdings = allRecommendations?.paperPortfolio?.holdings || [];
    
    // Sell Triggers: holdings at drawdown exit (25% below peak)
    const sellTriggers = holdings.filter(h => h.atDrawdownExit);
    
    // Sell Watch: holdings approaching drawdown (15-25%)
    const sellWatch = holdings.filter(h => h.nearDrawdown && !h.atDrawdownExit);
    
    // Harvest Due: holdings at +25% from last harvest
    const harvestDue = holdings.filter(h => h.harvestDue && !h.atDrawdownExit);

    const categories = {
      long: longActive,
      sellTriggers: sellTriggers,
      longWatch: longWatch,
      sellWatch: sellWatch,
      harvestDue: harvestDue,
    };

    // Second-buy detection
    const heldBySymbol = {};
    for (const h of holdings) {
      heldBySymbol[h.symbol] = h;
    }
    
    function isSecondBuyCandidate(item) {
      const held = heldBySymbol[item.symbol];
      if (!held) return false;
      if (isAveragingDownExcluded(item.symbol)) return false;
      return item.entryPrice < held.entryPrice;
    }
    
    function isExcludedSecondBuy(item) {
      const held = heldBySymbol[item.symbol];
      if (!held) return false;
      if (!isAveragingDownExcluded(item.symbol)) return false;
      return item.entryPrice < held.entryPrice;
    }

    return [
      { key: "long", label: "Active Buy Signals", color: "#3b82f6" },
      { key: "sellTriggers", label: "Sell Triggers", color: "#dc2626" },
      { key: "longWatch", label: "Buy Watch List", color: "#84cc16" },
      { key: "sellWatch", label: "Sell Watch", color: "#f97316" },
      { key: "harvestDue", label: "💰 Harvest Due", color: "#22c55e" },
    ].filter(c => categoryKeysToShow.includes(c.key)).map(({ key, label, color }) => {
      let items = categories[key];
      if (!items || items.length === 0) return null;

      // For longWatch, sort by tier: needs day 2 first (blue), then guard-blocked (orange bold), then score-short (amber muted)
      if (key === "longWatch") {
        const tierRank = (item) => {
          if (!item.nearMiss) return 0; // needs day 2
          return item.nearMissTier === 'guard' ? 1 : 2;
        };
        items = [...items].sort((a, b) => tierRank(a) - tierRank(b) || b.score - a.score);
      } else {
        items = [...items].sort((a, b) => b.score - a.score);
      }

      return (
        <div key={key} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6, fontWeight: 600 }}>{label} ({items.length})</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {items.map(item => {
              const strengthColors = { strong: "#16a34a", neutral: "#94a3b8", weak: "#dc2626" };
              const strengthEmoji = { strong: "🟢", neutral: "⚪", weak: "🔴" };
              const itemColor = item.historicalStrength ? strengthColors[item.historicalStrength.tier] : color;
              const emoji = item.historicalStrength ? strengthEmoji[item.historicalStrength.tier] : null;
              const isSecondBuy = key === "long" && isSecondBuyCandidate(item);
              const isExcludedBuy = key === "long" && isExcludedSecondBuy(item);
              
              // Build label with near-miss tier or pyramid marker
              const watchReason = item.watchReason;
              const nearMissTier = item.nearMissTier;
              const pyramidMarker = item.pyramidRounds > 0 ? ` ${'▲'.repeat(item.pyramidRounds)}` : '';
              const label = `${item.symbol}${pyramidMarker}`;
              const reasonTag = watchReason ? `[${watchReason}]` : '';
              
              return (
                <button
                  key={item.symbol}
                  onClick={() => handleLookup(item.symbol)}
                  disabled={cooldown > 0 || loading}
                  title={
                    isSecondBuy ? "Second-buy candidate: price is below your held average cost" :
                    isExcludedBuy ? "Would be a second-buy candidate, but this sub-industry underperformed averaging down" :
                    watchReason ? `Near miss: ${watchReason}` : undefined
                  }
                  style={{
                    background: `${itemColor}1a`, border: `1px solid ${itemColor}66`,
                    borderRadius: isSecondBuy ? 0 : isExcludedBuy ? "50%" : 8,
                    clipPath: isSecondBuy ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" : "none",
                    padding: isSecondBuy ? "14px 20px" : isExcludedBuy ? "8px 22px" : "6px 12px",
                    color: itemColor,
                    fontWeight: 700, fontSize: 13,
                    cursor: cooldown > 0 || loading ? "not-allowed" : "pointer",
                  }}
                >
                  {emoji ? `${emoji} ` : ""}{label}
                  {reasonTag && <span style={{ fontSize: 10, marginLeft: 4, color: nearMissTier === 'guard' ? '#ea580c' : '#a16207', fontWeight: nearMissTier === 'guard' ? 'bold' : 'normal' }}>{reasonTag}</span>}
                </button>
              );
            })}
          </div>
        </div>
      );
    });
  }

  // Persistent Paper Portfolio display
  function renderPersistentPortfolio() {
    if (!allRecommendations?.paperPortfolio) return null;
    const pp = allRecommendations.paperPortfolio;
    const holdings = pp.holdings || [];

    if (holdings.length === 0 && (!pp.closedHistory || pp.closedHistory.length === 0)) {
      return (
        <div style={{ padding: 16, fontSize: 12, color: "#475569" }}>
          No positions yet. Paper portfolio will populate with active buy signals.
        </div>
      );
    }

    const sectorGroups = groupBySector(holdings);

    return (
      <>
        {holdings.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>
              Current Holdings ({holdings.length})
            </div>
            {sectorGroups.map(({ sector, items }) => (
              <div key={sector} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>
                  {sector} ({items.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {items.map(h => (
                    <button
                      key={h.symbol}
                      onClick={() => handleLookup(h.symbol)}
                      disabled={cooldown > 0 || loading}
                      style={{
                        background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8,
                        padding: "10px 12px", textAlign: "left", cursor: "pointer",
                        color: "#e2e8f0", fontSize: 12, fontWeight: 600, transition: "all 0.2s",
                      }}
                      onMouseOver={e => {
                        e.target.style.borderColor = "#3b82f6";
                        e.target.style.background = "#0f172a";
                      }}
                      onMouseOut={e => {
                        e.target.style.borderColor = "#1e293b";
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span>
                          <strong>{h.symbol}</strong>
                          {h.pyramidRounds > 0 && <span style={{ color: "#b45309", marginLeft: 6 }}>{'▲'.repeat(h.pyramidRounds)}</span>}
                        </span>
                        <span style={{ color: h.pnlDollar >= 0 ? "#22c55e" : "#ef4444", fontSize: 11, fontWeight: 700 }}>
                          {h.pnlDollar >= 0 ? '+' : ''}{h.pnlDollar.toFixed(2)} ({h.pnlPct.toFixed(1)}%)
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
                        <span>Entry ${h.entryPrice.toFixed(2)} • Now ${h.currentPrice.toFixed(2)}</span>
                        <span>Peak ${h.peakPrice.toFixed(2)}</span>
                        {h.harvested > 0 && <span style={{ color: "#22c55e" }}>Harvested ${h.harvested.toFixed(2)}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {pp.closedHistory && pp.closedHistory.length > 0 && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8", marginBottom: 12 }}>
              Closed Trades ({pp.closedHistory.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {pp.closedHistory.map((t, i) => (
                <div key={i} style={{
                  background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8,
                  padding: "10px 12px", fontSize: 11, color: "#cbd5e1",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>
                      <strong>{t.symbol}</strong> {t.sector} · {t.exitDate}
                    </span>
                    <span style={{ color: t.pnlDollar >= 0 ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                      {t.pnlDollar >= 0 ? '+' : ''}{t.pnlDollar.toFixed(2)} ({t.pnlPct.toFixed(1)}%)
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#64748b", marginTop: 4 }}>
                    Entry ${t.entryPrice.toFixed(2)} → Exit ${t.exitPrice.toFixed(2)} · Reason: {t.reason}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "12px 14px", fontSize: 11, color: "#cbd5e1" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span>Starting Cash</span>
            <span style={{ fontWeight: 700 }}>${pp.startingCash.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span>Cash on Hand</span>
            <span style={{ fontWeight: 700, color: "#22c55e" }}>${pp.cash.toLocaleString()}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span>Holdings Value</span>
            <span style={{ fontWeight: 700 }}>${pp.holdingsValue.toLocaleString()}</span>
          </div>
          <div style={{ borderTop: "1px solid #1e293b", paddingTop: 8, display: "flex", justifyContent: "space-between" }}>
            <span>Total Value</span>
            <span style={{ fontWeight: 700, color: pp.totalReturnPct >= 0 ? "#22c55e" : "#ef4444" }}>
              ${pp.totalValue.toLocaleString()} ({pp.totalReturnPct >= 0 ? '+' : ''}{pp.totalReturnPct.toFixed(1)}% return)
            </span>
          </div>
        </div>
      </>
    );
  }

  const tabs = ["price", "volume", "rsi", "recommendation"];

  return (
    <div style={{
      minHeight: "100vh", background: "#060c18", color: "#e2e8f0",
      fontFamily: "'Inter', system-ui, sans-serif", padding: "24px 16px",
    }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Search */}
        <div style={{ position: "relative", marginBottom: 24 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              value={input}
              onChange={e => {
                const val = e.target.value.toUpperCase();
                setInput(val);
                setError(null);
                setSuggestions(searchTickers(val));
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              onKeyDown={e => e.key === "Enter" && handleLookup()}
              placeholder="Ticker or company name"
              style={{
                flex: 1, background: "#0f172a", border: "1px solid #1e293b",
                borderRadius: 6, padding: "3px 4px", color: "#e2e8f0",
                fontSize: 11, fontWeight: 600, letterSpacing: "0.05em", outline: "none",
              }}
            />
            <button
              onClick={() => handleLookup()}
              disabled={cooldown > 0 || loading}
              style={{
                background: cooldown > 0 || loading ? "#1e293b" : "linear-gradient(135deg, #3b82f6, #6366f1)",
                border: cooldown > 0 || loading ? "1px solid #334155" : "none",
                borderRadius: 6, padding: "3px 6px",
                color: cooldown > 0 || loading ? "#475569" : "#fff",
                fontWeight: 600, fontSize: 10,
                cursor: cooldown > 0 || loading ? "not-allowed" : "pointer",
                minWidth: 28, transition: "all 0.2s",
              }}
            >
              {loading ? "..." : cooldown > 0 ? `${cooldown}s` : "Go"}
            </button>
          </div>
          {showSuggestions && suggestions.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", left: 0, right: 0, marginTop: 4,
              background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8,
              zIndex: 10, maxHeight: 240, overflowY: "auto",
            }}>
              {suggestions.map(s => (
                <div
                  key={s.symbol}
                  onMouseDown={() => { setInput(s.symbol); setShowSuggestions(false); handleLookup(s.symbol); }}
                  style={{
                    padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #1e293b",
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                  }}
                >
                  <span style={{ fontWeight: 700, fontSize: 13, color: "#3b82f6" }}>{s.symbol}</span>
                  <span style={{ fontSize: 11, color: "#64748b" }}>{s.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        <p style={{ fontSize: 11, color: "#475569", textAlign: "center", marginBottom: 16 }}>
          For informational purposes only. Not financial advice.
        </p>
        <p style={{ textAlign: "center", marginBottom: 16 }}>
          <a href="/color-guide.html" target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: "#3b82f6", textDecoration: "none" }}>
            📖 Color Guide
          </a>
        </p>

        {!recsLoading && allRecommendations && (
          <div style={{ marginBottom: 24 }}>
            {allRecommendations.asOfDate && (
              <p style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>Recommendations as of {allRecommendations.asOfDate}</p>
            )}
            {renderRecommendationCategories(["long", "sellTriggers"])}
          </div>
        )}

        {quote && (
          <>
            {/* Hero card */}
            <div style={{
              background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 3, padding: "3px 4px", marginBottom: 3,
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              flexWrap: "wrap", gap: 2,
            }}>
              <div>
                <div style={{ fontSize: 8, color: "#64748b", marginBottom: 1 }}>{ticker} · {getCompanyName(ticker)} · {getSector(ticker)} · Live Quote</div>
                <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: "-0.03em", color: isInTopWinRateWindow(getSector(ticker), quote.price) ? "#3b82f6" : "#e2e8f0" }}>
                  ${quote.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 8, color: quote.change >= 0 ? "#22c55e" : "#ef4444", marginTop: 1 }}>
                  {quote.change >= 0 ? "▲" : "▼"} {Math.abs(quote.change).toFixed(2)} ({Math.abs(quote.changePct).toFixed(2)}%) today
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                {[
                  ["Open", `$${quote.open.toLocaleString()}`],
                  ["Prev Close", `$${quote.prevClose.toLocaleString()}`],
                  ["Volume", fmtVol(quote.volume)],
                  ["30d Momentum", (momentum > 0 ? "+" : "") + momentum + "%"],
                  ["RSI (7)", lastRSI ?? "—"],
                ].map(([label, val]) => (
                  <div key={label} style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 7, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: "#cbd5e1" }}>{val}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
              {tabs.map(t => (
                <button key={t} onClick={() => setActiveTab(t)} style={{
                  background: activeTab === t ? "#1e293b" : "transparent",
                  border: activeTab === t ? "1px solid #334155" : "1px solid transparent",
                  borderRadius: 8, padding: "7px 16px",
                  color: activeTab === t ? "#e2e8f0" : "#64748b",
                  fontWeight: 600, fontSize: 13, cursor: "pointer", textTransform: "capitalize",
                }}>
                  {t === "rsi" ? "RSI" : t === "recommendation" ? "Recommendation" : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            {/* Chart panel */}
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 16, padding: "20px 8px 8px", marginBottom: 20 }}>
              {activeTab === "price" && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Price & 5-Day MA</span>
                    <span style={{ marginLeft: 16, fontSize: 12, color: "#475569" }}>Last 30 sessions</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={priceData} margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6 }} />
                      <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2} isAnimationActive={false} />
                      <Line type="monotone" dataKey="ma" stroke="#64748b" strokeWidth={1} strokeDasharray="2 2" isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              )}
              {activeTab === "volume" && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Volume</span>
                    <span style={{ marginLeft: 16, fontSize: 12, color: "#475569" }}>Last 30 sessions</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={priceData} margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6 }} />
                      <Bar dataKey="volume" fill="#6366f1" isAnimationActive={false} />
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}
              {activeTab === "rsi" && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>RSI (7)</span>
                    <span style={{ marginLeft: 16, fontSize: 12, color: "#475569" }}>Last 30 sessions</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={rsiData} margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} />
                      <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 6 }} />
                      <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" label={{ fill: "#ef4444", fontSize: 10 }} />
                      <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" label={{ fill: "#22c55e", fontSize: 10 }} />
                      <Line type="monotone" dataKey="rsi" stroke="#f59e0b" strokeWidth={2} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </>
              )}
              {activeTab === "recommendation" && recommendation && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Stock Pulse Recommendation</span>
                  </div>
                  <div style={{ padding: "16px 20px", textAlign: "center" }}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: recommendation.color, marginBottom: 8 }}>
                      {recommendation.label}
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
                      {recommendation.status === "BUY" && "This stock currently shows an active buy signal from the ruleset."}
                      {recommendation.status === "BUY_WATCH" && "Passed all conditions today for the first time — needs one more qualifying day to confirm."}
                      {recommendation.status === "HELD" && "This stock is currently held in the paper portfolio."}
                      {recommendation.status === "NONE" && "No signal. This is not a rating of the company — just means current price action doesn't meet the ruleset's criteria today."}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Signal summary bar */}
            <div style={{
              background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 3, padding: "2px 3px",
              display: "flex", gap: 3, flexWrap: "wrap",
            }}>
              <div style={{ fontSize: 7, color: "#475569", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", alignSelf: "center" }}>
                Signals
              </div>
              {[
                {
                  label: "Trend",
                  value: parseFloat(momentum) > 0 ? "Bullish" : "Bearish",
                  color: parseFloat(momentum) > 0 ? "#22c55e" : "#ef4444",
                  detail: `${momentum}% 30-day`,
                },
                {
                  label: "Volume",
                  value: fmtVol(quote.volume),
                  color: "#38bdf8",
                  detail: "today",
                },
                {
                  label: "RSI",
                  value: lastRSI >= 70 ? "Overbought" : lastRSI <= 30 ? "Oversold" : "Neutral",
                  color: lastRSI >= 70 ? "#ef4444" : lastRSI <= 30 ? "#22c55e" : "#64748b",
                  detail: `${lastRSI ?? "—"}`,
                },
                {
                  label: "Recommendation",
                  value: recommendation ? recommendation.label : "Unavailable",
                  color: recommendation ? recommendation.color : "#475569",
                  detail: recommendation?.status === "NONE" ? "no signal" : recommendation ? "Stock Pulse" : "no data",
                },
              ].map(({ label, value, color, detail }) => (
                <div key={label} style={{
                  flex: 1, minWidth: 60, background: "#060c18", borderRadius: 3, padding: "2px 3px",
                  border: `1px solid ${color}33`,
                }}>
                  <div style={{ fontSize: 6, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ fontSize: 8, fontWeight: 700, color, marginTop: 1 }}>{value}</div>
                  <div style={{ fontSize: 6, color: "#334155", marginTop: 1 }}>{detail}</div>
                </div>
              ))}
            </div>

            <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 16 }}>
              Live data via Alpaca Markets · Recommendations from Stock Pulse ruleset · Not financial advice
            </p>
          </>
        )}

        {!recsLoading && allRecommendations && (allRecommendations.longWatch?.length > 0 || allRecommendations.paperPortfolio?.holdings?.length > 0) && (
          <div style={{ marginTop: 40 }}>
            <hr style={{ border: "none", borderTop: "1px solid #1e293b", marginBottom: 24 }} />
            
            {/* Portfolio Section */}
            {allRecommendations.paperPortfolio && (
              <div style={{ marginBottom: 32 }}>
                <button
                  onClick={() => setPortfolioExpanded(v => !v)}
                  style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 8, marginBottom: portfolioExpanded ? 16 : 0,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>Persistent Paper Portfolio</span>
                  <span style={{ fontSize: 11, color: "#475569", transform: portfolioExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
                </button>
                {portfolioExpanded && renderPersistentPortfolio()}
              </div>
            )}

            {/* Watch Lists Section */}
            {(allRecommendations.longWatch?.length > 0) && (
              <div>
                <button
                  onClick={() => setWatchListsExpanded(v => !v)}
                  style={{
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    display: "flex", alignItems: "center", gap: 8, marginBottom: watchListsExpanded ? 16 : 0,
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: "#94a3b8" }}>Watch Lists</span>
                  <span style={{ fontSize: 11, color: "#475569", transform: watchListsExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▶</span>
                </button>
                {watchListsExpanded && renderRecommendationCategories(["longWatch", "sellWatch", "harvestDue"])}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

