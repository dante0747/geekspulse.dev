// @vitest-environment happy-dom
/**
 * tests/unit/storage.test.js
 * Unit tests for js/storage.js (requires happy-dom for localStorage)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PREF,
  PULSE_PREF_KEY,
  BOOKMARK_KEY,
  BOOKMARK_MAX,
  getDefaultPreferences,
  loadPreferences,
  savePreferences,
  resetPreferences,
  hasActivePreferences,
  loadBookmarks,
  saveBookmarks,
  isBookmarked,
  toggleBookmark,
} from '../../js/storage.js';

beforeEach(() => {
  localStorage.clear();
});

// ── PREF ─────────────────────────────────────────────────────────────────────

describe('PREF.get / PREF.set', () => {
  it('round-trips a value', () => {
    PREF.set('theme', 'dark');
    expect(PREF.get('theme')).toBe('dark');
  });

  it('returns null for unknown key', () => {
    expect(PREF.get('nonexistent')).toBeNull();
  });

  it('returns null after localStorage.clear()', () => {
    PREF.set('x', '1');
    localStorage.clear();
    expect(PREF.get('x')).toBeNull();
  });
});

// ── loadPreferences / savePreferences ─────────────────────────────────────────

describe('loadPreferences', () => {
  it('returns defaults when storage is empty', () => {
    const prefs = loadPreferences();
    expect(prefs).toEqual(getDefaultPreferences());
  });

  it('returns defaults for corrupted JSON', () => {
    localStorage.setItem(PULSE_PREF_KEY, 'not-json{{{');
    expect(loadPreferences()).toEqual(getDefaultPreferences());
  });

  it('returns defaults for wrong version', () => {
    localStorage.setItem(PULSE_PREF_KEY, JSON.stringify({ version: 99 }));
    expect(loadPreferences()).toEqual(getDefaultPreferences());
  });

  it('falls back to "any" for invalid maxAge', () => {
    localStorage.setItem(PULSE_PREF_KEY, JSON.stringify({ version: 1, maxAge: 'invalid' }));
    expect(loadPreferences().maxAge).toBe('any');
  });

  it('round-trips saved preferences', () => {
    const prefs = { ...getDefaultPreferences(), hideSponsored: true, maxAge: '7d' };
    savePreferences(prefs);
    expect(loadPreferences()).toEqual(prefs);
  });
});

// ── resetPreferences ─────────────────────────────────────────────────────────

describe('resetPreferences', () => {
  it('restores defaults after reset', () => {
    savePreferences({ ...getDefaultPreferences(), hideSponsored: true });
    resetPreferences();
    expect(loadPreferences()).toEqual(getDefaultPreferences());
  });
});

// ── hasActivePreferences ──────────────────────────────────────────────────────

describe('hasActivePreferences', () => {
  it('returns false for default preferences', () => {
    expect(hasActivePreferences(getDefaultPreferences())).toBe(false);
  });

  it('returns true when hideSponsored differs from default', () => {
    expect(hasActivePreferences({ ...getDefaultPreferences(), hideSponsored: true })).toBe(true);
  });

  it('returns true when blockedCategories is non-empty', () => {
    expect(hasActivePreferences({ ...getDefaultPreferences(), blockedCategories: ['Security'] })).toBe(true);
  });

  it('returns true when maxAge differs from default', () => {
    expect(hasActivePreferences({ ...getDefaultPreferences(), maxAge: '24h' })).toBe(true);
  });
});

// ── isBookmarked / toggleBookmark ─────────────────────────────────────────────

describe('isBookmarked', () => {
  it('returns false when article not bookmarked', () => {
    expect(isBookmarked('https://example.com/1')).toBe(false);
  });

  it('returns true after toggleBookmark', () => {
    toggleBookmark({ link: 'https://example.com/1', title: 'Test' });
    expect(isBookmarked('https://example.com/1')).toBe(true);
  });
});

describe('toggleBookmark', () => {
  it('returns true on first call (adds bookmark)', () => {
    const result = toggleBookmark({ link: 'https://example.com/2', title: 'Test' });
    expect(result).toBe(true);
  });

  it('returns false on second call (removes bookmark)', () => {
    const article = { link: 'https://example.com/3', title: 'Test' };
    toggleBookmark(article);
    const result = toggleBookmark(article);
    expect(result).toBe(false);
    expect(isBookmarked(article.link)).toBe(false);
  });

  it('sets bookmarkedAt on the stored entry', () => {
    toggleBookmark({ link: 'https://example.com/4', title: 'Test' });
    const bms = loadBookmarks();
    expect(bms[0].bookmarkedAt).toBeDefined();
    expect(new Date(bms[0].bookmarkedAt).toString()).not.toBe('Invalid Date');
  });
});

// ── loadBookmarks ─────────────────────────────────────────────────────────────

describe('loadBookmarks', () => {
  it('returns [] on empty storage', () => {
    expect(loadBookmarks()).toEqual([]);
  });

  it('returns [] for malformed JSON', () => {
    localStorage.setItem(BOOKMARK_KEY, '{{{bad json');
    expect(loadBookmarks()).toEqual([]);
  });

  it('deserializes correctly', () => {
    const articles = [{ link: 'https://a.com', title: 'A', bookmarkedAt: new Date().toISOString() }];
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(articles));
    expect(loadBookmarks()).toEqual(articles);
  });
});

// ── BOOKMARK_MAX cap ──────────────────────────────────────────────────────────

describe('BOOKMARK_MAX cap', () => {
  it('enforces BOOKMARK_MAX limit when adding bookmarks', () => {
    for (let i = 0; i <= BOOKMARK_MAX; i++) {
      toggleBookmark({ link: `https://example.com/${i}`, title: `Article ${i}` });
    }
    expect(loadBookmarks().length).toBeLessThanOrEqual(BOOKMARK_MAX);
  });
});


