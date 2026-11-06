/**
 * js/signal.js
 *
 * The two "live instrument" pieces of the header:
 *  - renderTicker():     a scrolling headline ticker under the status line
 *  - renderPulseGraph(): stories-per-hour bars for the last 24 hours, built
 *                        from real article timestamps (the site's "pulse")
 */

import { esc, safeUrl, catClass } from './utils.js';

const HOURS = 24;
const HOUR_MS = 3_600_000;
const TICKER_ITEMS = 14;
const TICKER_SPEED = 70; // px per second

function byNewest(a, b) {
  return (new Date(b.date).getTime() || 0) - (new Date(a.date).getTime() || 0);
}

// ── Ticker ─────────────────────────────────────────────────────────

function tickerItem(a, decorative) {
  const cat = a.category || 'General';
  const href = safeUrl(a.link);
  return `<li class="ticker-item ${catClass(cat)}"><a href="${esc(href)}" target="_blank" rel="noopener noreferrer"${decorative ? ' tabindex="-1"' : ''}><span class="ticker-cat">${esc(cat)}</span><span class="ticker-title">${esc(a.title)}</span></a></li>`;
}

export function renderTicker(articles) {
  const wrap  = document.getElementById('ticker');
  const track = document.getElementById('tickerTrack');
  const clone = document.getElementById('tickerClone');
  if (!wrap || !track) return;

  const items = articles
    .filter(a => a && a.title && a.link && a.link !== '#')
    .slice()
    .sort(byNewest)
    .slice(0, TICKER_ITEMS);

  if (!items.length) { wrap.hidden = true; return; }

  track.innerHTML = items.map(a => tickerItem(a, false)).join('');
  // A second, hidden copy makes the loop seamless.
  if (clone) clone.innerHTML = items.map(a => tickerItem(a, true)).join('');
  wrap.hidden = false;

  requestAnimationFrame(() => {
    const width = track.scrollWidth;
    if (width > 0) wrap.style.setProperty('--ticker-dur', `${Math.round(width / TICKER_SPEED)}s`);
  });
}

// ── Pulse graph ────────────────────────────────────────────────────

function hourLabel(hoursAgo) {
  const d = new Date(Date.now() - hoursAgo * HOUR_MS);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Count stories per hour for the last 24 hours (oldest first). */
export function hourlyCounts(articles, now = Date.now()) {
  const counts = new Array(HOURS).fill(0);
  for (const a of articles) {
    const t = new Date(a?.date).getTime();
    if (!Number.isFinite(t)) continue;
    const age = now - t;
    if (age < 0 || age >= HOURS * HOUR_MS) continue;
    counts[HOURS - 1 - Math.floor(age / HOUR_MS)]++;
  }
  return counts;
}

export function renderPulseGraph(articles) {
  const bars = document.getElementById('pulseBars');
  if (!bars) return;

  const counts = hourlyCounts(articles);
  const max = Math.max(1, ...counts);
  const total = counts.reduce((s, n) => s + n, 0);
  const peakIdx = counts.indexOf(Math.max(...counts));

  bars.innerHTML = counts.map((n, i) => {
    const hoursAgo = HOURS - 1 - i;
    const h = n ? Math.max(0.06, n / max) : 0.02;
    const cls = [n === max && n > 0 ? 'is-peak' : '', i === HOURS - 1 ? 'is-now' : ''].filter(Boolean).join(' ');
    return `<i${cls ? ` class="${cls}"` : ''} style="--h:${h.toFixed(3)}" title="${esc(hourLabel(hoursAgo))} · ${n} ${n === 1 ? 'story' : 'stories'}"></i>`;
  }).join('');
  bars.setAttribute('aria-label', `${total} stories published in the last 24 hours. Busiest hour: ${Math.max(...counts)} stories.`);

  const peak = document.getElementById('pulsePeak');
  if (peak) peak.textContent = total ? `peak ${counts[peakIdx]}/h @ ${hourLabel(HOURS - 1 - peakIdx)}` : 'quiet day';
  const totalEl = document.getElementById('pulseTotal');
  if (totalEl) totalEl.textContent = String(total);
}
