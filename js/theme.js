import { PREF } from './storage.js';

// ── Theme initialisation ──────────────────────────────────────────

export function initTheme() {
  const savedTheme = PREF.get('theme') || 'dark';
  if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}
