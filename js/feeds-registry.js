// ── Feed registry ─────────────────────────────────────────────────
// Single source of truth: /data/feeds.json.
// Call loadFeedsRegistry() once at startup before reading feeds.
// Feeds with "enabled": false in the JSON are excluded automatically.

let _feeds = [];

export async function loadFeedsRegistry() {
  try {
    const resp = await fetch('/data/feeds.json', { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    // Only include feeds that are not explicitly disabled (enabled: false)
    _feeds = Array.isArray(data) ? data.filter(f => f.enabled !== false) : [];
  } catch (e) {
    const reason = e?.name === 'TimeoutError'
      ? 'timed out after 5 s'
      : (e?.message || String(e));
    console.warn(`[GeeksPulse] Could not load feeds registry (${reason}), RSS fallback unavailable.`);
    _feeds = [];
  }
}

export function getFeeds() { return _feeds; }

