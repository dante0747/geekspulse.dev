// ── Persistent preferences ───────────────────────────────────────

export const PREF = {
  get: k      => localStorage.getItem('geeksup_' + k),
  set: (k, v) => localStorage.setItem('geeksup_' + k, v),
};

// ── My Pulse: versioned preferences ──────────────────────────────

export const PULSE_PREF_KEY = 'geekspulse.preferences.v1';

export function getDefaultPreferences() {
  return {
    version: 1,
    blockedCategories: [],
    mutedSources: [],
    hideSponsored: false,
    maxAge: 'any',
  };
}

export function loadPreferences() {
  try {
    const raw = localStorage.getItem(PULSE_PREF_KEY);
    if (!raw) return getDefaultPreferences();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 1) return getDefaultPreferences();
    const d = getDefaultPreferences();
    return {
      version: 1,
      blockedCategories: Array.isArray(parsed.blockedCategories) ? parsed.blockedCategories : d.blockedCategories,
      mutedSources:      Array.isArray(parsed.mutedSources)      ? parsed.mutedSources      : d.mutedSources,
      hideSponsored:     typeof parsed.hideSponsored === 'boolean' ? parsed.hideSponsored   : d.hideSponsored,
      maxAge:            ['any','24h','7d','30d'].includes(parsed.maxAge) ? parsed.maxAge   : d.maxAge,
    };
  } catch { return getDefaultPreferences(); }
}

export function savePreferences(prefs) {
  try { localStorage.setItem(PULSE_PREF_KEY, JSON.stringify(prefs)); } catch { /* quota */ }
}

export function resetPreferences() {
  localStorage.removeItem(PULSE_PREF_KEY);
}

export function hasActivePreferences(prefs) {
  const d = getDefaultPreferences();
  return (
    prefs.blockedCategories.length > 0 ||
    prefs.mutedSources.length > 0 ||
    prefs.hideSponsored !== d.hideSponsored ||
    prefs.maxAge !== d.maxAge
  );
}

// ── Bookmarks ─────────────────────────────────────────────────────

export const BOOKMARK_KEY = 'geeksup_bookmarks';

export function loadBookmarks() {
  try { return JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]'); }
  catch { return []; }
}

export function saveBookmarks(bms) {
  localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bms));
}

export function isBookmarked(link) {
  return loadBookmarks().some(b => b.link === link);
}

export function toggleBookmark(article) {
  let bms = loadBookmarks();
  const idx = bms.findIndex(b => b.link === article.link);
  if (idx === -1) {
    bms.unshift({ ...article, bookmarkedAt: new Date().toISOString() });
  } else {
    bms.splice(idx, 1);
  }
  saveBookmarks(bms);
  return idx === -1; // true = just bookmarked
}

