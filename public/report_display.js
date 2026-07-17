/** 
 * report_display.js
 * ====================
 * Renders the latest Stock Pulse report as a simple HTML list on the page.
 * Add this alongside client_refresh.js -- call renderReport() after the
 * daily refresh completes (or on its own, to just show whatever's cached).
 *
 * Usage in index.html, after client_refresh.js:
 *   <div id="stock-pulse-report"></div>
 *   <script src="report_display.js"></script>
 *   <script>
 *     runDailyRefreshIfNeeded().then(() => renderReport());
 *   </script>
 */

function renderReport(containerId = 'stock-pulse-report') {
  return loadReport().then(function(report) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.warn(`[report_display] No element with id="${containerId}" found on the page.`);
      return report;
    }

    if (report.error) {
      container.innerHTML = '<p>No report available yet. Visit the site to trigger today\'s refresh.</p>';
      return report;
    }

    function renderSection(title, items, colorClass) {
      if (!items || items.length === 0) {
        return `<h3>${title}</h3><p><em>None right now.</em></p>`;
      }
      const rows = items.map(function(item) {
        const trendPart = item.trendPct !== undefined ? ` &nbsp; trend: ${item.trendPct}%` : '';
        const streakPart = item.streakDays !== undefined ? ` &nbsp; (${item.streakDays}d)` : '';
        return `<li><strong>${item.symbol}</strong> &nbsp; score: ${item.score}${trendPart}${streakPart} &nbsp; @ $${item.lastClose}</li>`;
      }).join('');
      return `<h3 class="${colorClass}">${title} (${items.length})</h3><ul>${rows}</ul>`;
    }

    container.innerHTML = `
      <div class="stock-pulse-report">
        <p><small>As of ${report.asOfDate}</small></p>
        ${renderSection('Active Buy Signals', report.long, 'long-active')}
        ${renderSection('Active Short Signals', report.short, 'short-active')}
        ${renderSection('Buy Watch List', report.longWatch, 'long-watch')}
        ${renderSection('Short Watch List', report.shortWatch, 'short-watch')}
      </div>
    `;

    return report;
  }).catch(function(err) {
    console.error('[report_display] Failed to load report:', err);
    const container = document.getElementById(containerId);
    if (container) {
      container.innerHTML = '<p>Failed to load report. Check console for details.</p>';
    }
  });
}

