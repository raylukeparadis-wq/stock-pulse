/**
 * client_refresh.js
 * ====================
 * Add this to your stock-pulse frontend (loaded on page visit).
 * Checks whether today's data has already been refreshed; if not, fetches
 * fresh bars directly from alpaca-proxy for every symbol (no Worker
 * subrequest limit applies -- this runs in the browser, not a Worker) and
 * submits everything in ONE request. The Worker stores it all as a single
 * R2 object and re-analyzes.
 *
 * Usage: include this script on your page and call runDailyRefreshIfNeeded()
 * on load, e.g.:
 *
 *   <script src="client_refresh.js"></script>
 *   <script>runDailyRefreshIfNeeded().then(() => loadAndDisplayReport());</script>
 */

const WORKER_BASE = 'https://stock-pulse-worker.raylukeparadis.workers.dev';
const ALPACA_PROXY_BASE = 'https://alpaca-proxy.raylukeparadis.workers.dev';
const FETCH_DELAY_MS = 150; // small pause between alpaca-proxy calls, courtesy pacing

async function fetchLatestBarFromAlpaca(symbol) {
  try {
    const resp = await fetch(`${ALPACA_PROXY_BASE}/bars?symbol=${symbol}&limit=1`);
    if (!resp.ok) return null;
    const payload = await resp.json();
    const bars = payload.bars || [];
    return bars.length ? bars[bars.length - 1] : null;
  } catch (e) {
    console.warn(`[refresh] fetch failed for ${symbol}:`, e);
    return null;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Runs the full client-driven refresh if today hasn't been completed yet.
 * Safe to call on every page load -- it's a fast no-op (one status check)
 * if a refresh already finished today.
 *
 * Reports progress via the optional onProgress callback:
 *   onProgress({ symbolsDone, totalSymbols })
 */
async function runDailyRefreshIfNeeded(onProgress = null) {
  const statusResp = await fetch(`${WORKER_BASE}/status`);
  const status = await statusResp.json();

  if (status.alreadyRefreshedToday) {
    return { skipped: true, reason: `Already refreshed today (${status.today}).` };
  }

  const { symbols } = status;
  const bars = {};

  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    bars[sym] = await fetchLatestBarFromAlpaca(sym);
    await sleep(FETCH_DELAY_MS);

    if (onProgress) {
      onProgress({ symbolsDone: i + 1, totalSymbols: symbols.length });
    }
  }

  const submitResp = await fetch(`${WORKER_BASE}/submit-daily-update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bars }),
  });
  const result = await submitResp.json();

  return { skipped: false, completed: true, result };
}

/**
 * Fetches and returns the latest analysis report (the four modes).
 * Call this after runDailyRefreshIfNeeded() completes, or on its own if
 * you just want to display whatever's currently cached without triggering
 * a refresh.
 */
async function loadReport() {
  const resp = await fetch(`${WORKER_BASE}/report/latest`);
  return resp.json();
}

