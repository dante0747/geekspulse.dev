import { PREF } from './storage.js';

// ── Theme preference ──────────────────────────────────────────────
// 'system' follows prefers-color-scheme; 'light' / 'dark' force a theme by
// setting <html data-theme>. The inline script in index.html applies a saved
// choice before first paint; this module keeps it in sync afterwards.

export const THEMES = ['system', 'light', 'dark'];
const THEME_COLORS = { light: '#F6F6F4', dark: '#0B0C10' };

export function getThemePref() {
  try {
    const t = PREF.get('theme');
    return THEMES.includes(t) ? t : 'system';
  } catch { return 'system'; }
}

export function resolvedTheme() {
  const forced = document.documentElement.dataset.theme;
  if (forced === 'light' || forced === 'dark') return forced;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function syncThemeColorMeta(pref) {
  document.querySelectorAll('meta[name="theme-color"]').forEach(meta => {
    if (!meta.dataset.defaultContent) meta.dataset.defaultContent = meta.content;
    meta.content = pref === 'system' ? meta.dataset.defaultContent : THEME_COLORS[pref];
  });
}

export function applyTheme(pref) {
  const root = document.documentElement;
  if (pref === 'light' || pref === 'dark') root.dataset.theme = pref;
  else delete root.dataset.theme;
  syncThemeColorMeta(pref);
}

export function setThemePref(pref) {
  const value = THEMES.includes(pref) ? pref : 'system';
  try {
    if (value === 'system') localStorage.removeItem('geeksup_theme');
    else PREF.set('theme', value);
  } catch { /* storage unavailable — apply for this page view only */ }
  applyTheme(value);
  return value;
}

export function initTheme() {
  applyTheme(getThemePref());
}
