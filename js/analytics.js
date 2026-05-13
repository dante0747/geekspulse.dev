// ── Google Analytics 4 event helper ─────────────────────────────
// Safely fires a GA4 custom event. No-ops if gtag is not loaded
// (e.g. blocked by an ad-blocker) so it never breaks the app.

export function gaEvent(eventName, params) {
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params || {});
    }
  } catch (_) { /* silent fail */ }
}

