import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine
} from "recharts";

const WORKER_URL = "https://alpaca-proxy.raylukeparadis.workers.dev";
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

function sentimentColor(s) {
  if (s >= 0.6) return "#22c55e";
  if (s >= 0.2) return "#84cc16";
  if (s >= -0.2) return "#94a3b8";
  if (s >= -0.6) return "#f97316";
  return "#ef4444";
}
function sentimentLabel(s) {
  if (s >= 0.6) return "Bullish";
  if (s >= 0.2) return "Slightly Bullish";
  if (s >= -0.2) return "Neutral";
  if (s >= -0.6) return "Slightly Bearish";
  return "Bearish";
}
function fmtVol(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  return n.toLocaleString();
}

const PriceTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#94a3b8", margin: "0 0 4px" }}>{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color, margin: "2px 0" }}>
          {p.name}: <strong>${p.value?.toLocaleString()}</strong>
        </p>
      ))}
    </div>
  );
};

const VolTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#94a3b8", margin: "0 0 4px" }}>{label}</p>
      <p style={{ color: "#38bdf8", margin: 0 }}>Vol: <strong>{fmtVol(payload[0]?.value)}</strong></p>
    </div>
  );
};

const RSITooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length || !payload[0]?.value) return null;
  const v = payload[0].value;
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, padding: "10px 14px", fontSize: 12 }}>
      <p style={{ color: "#94a3b8", margin: "0 0 4px" }}>{label}</p>
      <p style={{ color: "#a78bfa", margin: 0 }}>RSI: <strong>{v}</strong></p>
      <p style={{ color: v >= 70 ? "#ef4444" : v <= 30 ? "#22c55e" : "#94a3b8", margin: "2px 0 0", fontSize: 11 }}>
        {v >= 70 ? "Overbought" : v <= 30 ? "Oversold" : "Neutral"}
      </p>
    </div>
  );
};

export default function StockAnalyzer() {
  const [ticker, setTicker] = useState("");
  const [input, setInput] = useState("");
  const [activeTab, setActiveTab] = useState("price");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [quote, setQuote] = useState(null);
  const [bars, setBars] = useState([]);
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

  async function handleLookup() {
    if (cooldown > 0) return;
    const t = input.trim().toUpperCase();
    if (!t) return;

    setLoading(true);
    setError(null);
    setQuote(null);
    setBars([]);
    startCooldown();

    try {
      const [quoteRes, barsRes] = await Promise.all([
        fetch(`${WORKER_URL}/quote?symbol=${t}`),
        fetch(`${WORKER_URL}/bars?symbol=${t}&limit=30&timeframe=1Day`),
      ]);

      if (quoteRes.status === 429 || barsRes.status === 429) {
        throw new Error("Rate limited. Please wait a moment and try again.");
      }

      const quoteData = await quoteRes.json();
      const barsData = await barsRes.json();

      if (quoteData.error) throw new Error(quoteData.error);
      if (barsData.error) throw new Error(barsData.error);
      if (!quoteData.price) throw new Error(`No data found for "${t}". Check the ticker symbol.`);

      setQuote(quoteData);
      setBars(barsData.bars || []);
      setTicker(t);
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
  const volRatio = quote ? quote.volume / (quote.volume * 0.9) : 1;
  const momentum = bars.length >= 2
    ? ((bars[bars.length - 1].close - bars[0].close) / bars[0].close * 100).toFixed(2)
    : "0.00";

  // Static news sentiment (placeholder until a news API is wired in)
  const demoSentiment = 0.32;
  const tabs = ["price", "volume", "rsi", "sentiment"];

  return (
    <div style={{
      minHeight: "100vh", background: "#060c18", color: "#e2e8f0",
      fontFamily: "'Inter', system-ui, sans-serif", padding: "24px 16px",
    }}>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 28 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
          }}>📈</div>
          <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>
            Stock Pulse <span style={{ color: "#475569", fontWeight: 400, fontSize: 13 }}>/ Analyzer</span>
          </span>
          <span style={{ marginLeft: "auto", fontSize: 11, color: "#22c55e", background: "#052e16", borderRadius: 6, padding: "2px 8px" }}>
            LIVE
          </span>
        </div>

        {/* Search */}
        <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
          <input
            value={input}
            onChange={e => { setInput(e.target.value.toUpperCase()); setError(null); }}
            onKeyDown={e => e.key === "Enter" && handleLookup()}
            placeholder="Enter ticker (e.g. AAPL, NVDA, TSLA)"
            style={{
              flex: 1, background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 10, padding: "10px 16px", color: "#e2e8f0",
              fontSize: 15, fontWeight: 600, letterSpacing: "0.05em", outline: "none",
            }}
          />
          <button
            onClick={handleLookup}
            disabled={cooldown > 0 || loading}
            style={{
              background: cooldown > 0 || loading ? "#1e293b" : "linear-gradient(135deg, #3b82f6, #6366f1)",
              border: cooldown > 0 || loading ? "1px solid #334155" : "none",
              borderRadius: 10, padding: "10px 22px",
              color: cooldown > 0 || loading ? "#475569" : "#fff",
              fontWeight: 600, fontSize: 14,
              cursor: cooldown > 0 || loading ? "not-allowed" : "pointer",
              minWidth: 110, transition: "all 0.2s",
            }}
          >
            {loading ? "Loading..." : cooldown > 0 ? `Wait ${cooldown}s` : "Analyze"}
          </button>
        </div>

        {error && (
          <div style={{ background: "#1c0a0a", border: "1px solid #7f1d1d", borderRadius: 8, padding: "10px 14px", color: "#fca5a5", fontSize: 13, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {/* Empty state */}
        {!quote && !loading && !error && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#334155" }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
            <p style={{ fontSize: 15, margin: 0 }}>Enter a ticker symbol above to analyze a stock</p>
            <p style={{ fontSize: 13, marginTop: 8 }}>Try AAPL, NVDA, TSLA, MSFT, AMZN...</p>
          </div>
        )}

        {quote && (
          <>
            {/* Hero card */}
            <div style={{
              background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 16, padding: "20px 24px", marginBottom: 20,
              display: "flex", justifyContent: "space-between", alignItems: "flex-start",
              flexWrap: "wrap", gap: 16,
            }}>
              <div>
                <div style={{ fontSize: 13, color: "#64748b", marginBottom: 2 }}>{ticker} · Live Quote</div>
                <div style={{ fontSize: 38, fontWeight: 800, letterSpacing: "-0.03em" }}>
                  ${quote.price.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </div>
                <div style={{ fontSize: 14, color: quote.change >= 0 ? "#22c55e" : "#ef4444", marginTop: 4 }}>
                  {quote.change >= 0 ? "▲" : "▼"} {Math.abs(quote.change).toFixed(2)} ({Math.abs(quote.changePct).toFixed(2)}%) today
                </div>
              </div>
              <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
                {[
                  ["Open", `$${quote.open.toLocaleString()}`],
                  ["Prev Close", `$${quote.prevClose.toLocaleString()}`],
                  ["Volume", fmtVol(quote.volume)],
                  ["30d Momentum", (momentum > 0 ? "+" : "") + momentum + "%"],
                  ["RSI (7)", lastRSI ?? "—"],
                ].map(([label, val]) => (
                  <div key={label} style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: "#cbd5e1" }}>{val}</div>
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
                  {t === "rsi" ? "RSI" : t.charAt(0).toUpperCase() + t.slice(1)}
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
                      <YAxis tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false}
                        domain={["auto", "auto"]} tickFormatter={v => `$${v.toLocaleString()}`} width={72} />
                      <Tooltip content={<PriceTooltip />} />
                      <Line type="monotone" dataKey="close" stroke="#3b82f6" strokeWidth={2.5} dot={false} name="Close" />
                      <Line type="monotone" dataKey="ma" stroke="#f59e0b" strokeWidth={1.5} dot={false} strokeDasharray="4 2" name="5-Day MA" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", gap: 20, paddingLeft: 24, paddingTop: 8 }}>
                    {[["#3b82f6", "Close Price"], ["#f59e0b", "5-Day MA"]].map(([c, l]) => (
                      <div key={l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#64748b" }}>
                        <div style={{ width: 20, height: 2, background: c, borderRadius: 2 }} />{l}
                      </div>
                    ))}
                  </div>
                </>
              )}

              {activeTab === "volume" && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>Volume</span>
                    <span style={{ marginLeft: 16, fontSize: 12, color: "#475569" }}>Last 30 sessions</span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={bars} margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                      <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => fmtVol(v)} width={52} />
                      <Tooltip content={<VolTooltip />} />
                      <Bar dataKey="volume" fill="#38bdf8" radius={[3, 3, 0, 0]} opacity={0.85} />
                    </BarChart>
                  </ResponsiveContainer>
                </>
              )}

              {activeTab === "rsi" && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>RSI (7-period)</span>
                    <span style={{ marginLeft: 12, fontSize: 12, color: lastRSI >= 70 ? "#ef4444" : lastRSI <= 30 ? "#22c55e" : "#64748b" }}>
                      {lastRSI ? `${lastRSI} · ${lastRSI >= 70 ? "Overbought" : lastRSI <= 30 ? "Oversold" : "Neutral zone"}` : ""}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={rsiData} margin={{ left: 8, right: 16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="date" tick={{ fill: "#475569", fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                      <YAxis domain={[0, 100]} tick={{ fill: "#475569", fontSize: 11 }} tickLine={false} axisLine={false} width={36} />
                      <Tooltip content={<RSITooltip />} />
                      <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 2" strokeOpacity={0.6} label={{ value: "70", fill: "#ef4444", fontSize: 10, position: "right" }} />
                      <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="4 2" strokeOpacity={0.6} label={{ value: "30", fill: "#22c55e", fontSize: 10, position: "right" }} />
                      <ReferenceLine y={50} stroke="#334155" strokeDasharray="2 4" />
                      <Line type="monotone" dataKey="rsi" stroke="#a78bfa" strokeWidth={2.5} dot={false} name="RSI" connectNulls />
                    </LineChart>
                  </ResponsiveContainer>
                  <div style={{ paddingLeft: 20, paddingTop: 8, fontSize: 12, color: "#475569" }}>
                    Above 70 = overbought · Below 30 = oversold
                  </div>
                </>
              )}

              {activeTab === "sentiment" && (
                <>
                  <div style={{ paddingLeft: 16, marginBottom: 16 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>News Sentiment</span>
                    <span style={{ marginLeft: 12, fontSize: 12, color: "#475569" }}>Coming soon — news API integration pending</span>
                  </div>
                  <div style={{ padding: "20px 16px", textAlign: "center", color: "#334155" }}>
                    <div style={{ fontSize: 32, marginBottom: 10 }}>📰</div>
                    <p style={{ margin: 0, fontSize: 14 }}>News sentiment will be wired to a live news API in the next update.</p>
                  </div>
                </>
              )}
            </div>

            {/* Signal summary bar */}
            <div style={{
              background: "#0f172a", border: "1px solid #1e293b",
              borderRadius: 14, padding: "16px 20px",
              display: "flex", gap: 20, flexWrap: "wrap",
            }}>
              <div style={{ fontSize: 12, color: "#475569", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", alignSelf: "center" }}>
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
                  label: "Sentiment",
                  value: "Pending",
                  color: "#475569",
                  detail: "news API needed",
                },
              ].map(({ label, value, color, detail }) => (
                <div key={label} style={{
                  flex: 1, minWidth: 100, background: "#060c18", borderRadius: 10, padding: "10px 14px",
                  border: `1px solid ${color}33`,
                }}>
                  <div style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color, marginTop: 4 }}>{value}</div>
                  <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>{detail}</div>
                </div>
              ))}
            </div>

            <p style={{ textAlign: "center", fontSize: 11, color: "#334155", marginTop: 16 }}>
              Live data via Alpaca Markets · Not financial advice
            </p>
          </>
        )}
      </div>
    </div>
  );
}
