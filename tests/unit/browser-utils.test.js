// @vitest-environment happy-dom
/**
 * tests/unit/browser-utils.test.js
 * Unit tests for js/utils.js (browser utilities — requires happy-dom environment)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock config.js before importing utils.js
vi.mock('../../js/config.js', () => ({
  loadingMessages: ['Loading...'],
  catMeta: {},
  categories: [],
}));

import { esc, safeUrl, catClass, relTime, truncate, readTime, animateCounter } from '../../js/utils.js';

// ── esc ───────────────────────────────────────────────────────────────────────

describe('esc', () => {
  it('escapes &', () => expect(esc('a & b')).toBe('a &amp; b'));
  it('escapes <', () => expect(esc('<tag>')).toBe('&lt;tag&gt;'));
  it('escapes >', () => expect(esc('a>b')).toBe('a&gt;b'));
  it('escapes "', () => expect(esc('say "hi"')).toBe('say &quot;hi&quot;'));
  it("escapes '", () => expect(esc("it's")).toBe('it&#x27;s'));
  it('handles empty string', () => expect(esc('')).toBe(''));
  it('handles null', () => expect(esc(null)).toBe(''));
  it('does not double-escape — esc("&") is "&amp;" not "&amp;amp;"', () => {
    expect(esc('&')).toBe('&amp;');
  });
});

// ── safeUrl ──────────────────────────────────────────────────────────────────

describe('safeUrl', () => {
  it('returns valid https URL unchanged', () => {
    expect(safeUrl('https://example.com/page')).toBe('https://example.com/page');
  });

  it('returns valid http URL unchanged', () => {
    expect(safeUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('returns "#" for javascript: protocol', () => {
    expect(safeUrl('javascript:void(0)')).toBe('#');
  });

  it('returns "#" for relative strings', () => {
    expect(safeUrl('/relative/path')).toBe('#');
  });

  it('returns "#" for empty string', () => {
    expect(safeUrl('')).toBe('#');
  });

  it('returns "#" for null', () => {
    expect(safeUrl(null)).toBe('#');
  });
});

// ── catClass ─────────────────────────────────────────────────────────────────

describe('catClass', () => {
  it('converts "Open Source" to "cat-open-source"', () => {
    expect(catClass('Open Source')).toBe('cat-open-source');
  });

  it('converts "AI" to "cat-ai"', () => {
    expect(catClass('AI')).toBe('cat-ai');
  });

  it('lowercases and replaces spaces', () => {
    expect(catClass('JavaScript')).toBe('cat-javascript');
  });
});

// ── relTime ───────────────────────────────────────────────────────────────────

describe('relTime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-06-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "" for null', () => expect(relTime(null)).toBe(''));
  it('returns "" for invalid date', () => expect(relTime('not-a-date')).toBe(''));

  it('returns "just now" for < 60s ago', () => {
    const d = new Date('2024-06-01T11:59:45Z').toISOString();
    expect(relTime(d)).toBe('just now');
  });

  it('returns "5m ago" for 5 minutes ago', () => {
    const d = new Date('2024-06-01T11:55:00Z').toISOString();
    expect(relTime(d)).toBe('5m ago');
  });

  it('returns "3h ago" for 3 hours ago', () => {
    const d = new Date('2024-06-01T09:00:00Z').toISOString();
    expect(relTime(d)).toBe('3h ago');
  });

  it('returns "2d ago" for 2 days ago', () => {
    const d = new Date('2024-05-30T12:00:00Z').toISOString();
    expect(relTime(d)).toBe('2d ago');
  });
});

// ── truncate (browser) ────────────────────────────────────────────────────────

describe('truncate (browser)', () => {
  it('does not truncate when str.length <= n', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('appends ellipsis when over limit', () => {
    const result = truncate('a'.repeat(161), 160);
    expect(result.endsWith('…')).toBe(true);
  });

  it('defaults n to 160', () => {
    const result = truncate('x'.repeat(161));
    expect(result.endsWith('…')).toBe(true);
    expect(result.length).toBe(161);
  });

  it('handles null', () => {
    expect(truncate(null)).toBe('');
  });
});

// ── readTime ─────────────────────────────────────────────────────────────────

describe('readTime', () => {
  it('returns at least 1 for any input', () => {
    expect(readTime('', '')).toBeGreaterThanOrEqual(1);
  });

  it('returns 1 for empty input', () => {
    expect(readTime('', '')).toBe(1);
  });

  it('returns ~2 for a 400-word text', () => {
    const words = Array.from({ length: 400 }, () => 'word').join(' ');
    expect(readTime(words, '')).toBe(2);
  });
});

// ── animateCounter ────────────────────────────────────────────────────────────

describe('animateCounter', () => {
  it('eventually sets el.textContent to target', async () => {
    const el = document.createElement('span');
    animateCounter(el, 42, 0); // duration=0 so it completes in first tick
    // Wait for the rAF callback to fire
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(el.textContent).toBe('42');
  });

  it('does not crash with null element', () => {
    expect(() => animateCounter(null, 42)).not.toThrow();
  });
});



