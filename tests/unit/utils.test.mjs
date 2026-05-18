/**
 * tests/unit/utils.test.mjs
 * Unit tests for scripts/lib/utils.mjs (pure Node.js helpers)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  hashId,
  normalizeUrl,
  absUrl,
  decodeHtmlEntities,
  stripHtml,
  isLowValueSnippet,
  truncate,
  normalizeDate,
  newestFirst,
  runLimited,
} from '../../scripts/lib/utils.mjs';

// ── hashId ──────────────────────────────────────────────────────────────────

describe('hashId', () => {
  it('returns a 12-char hex string', () => {
    const h = hashId('https://example.com/article');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic — same input, same output', () => {
    expect(hashId('hello')).toBe(hashId('hello'));
  });

  it('produces different output for different inputs', () => {
    expect(hashId('a')).not.toBe(hashId('b'));
  });
});

// ── normalizeUrl ─────────────────────────────────────────────────────────────

describe('normalizeUrl', () => {
  it('passes through valid https URL', () => {
    expect(normalizeUrl('https://example.com/path')).toBe('https://example.com/path');
  });

  it('passes through valid http URL', () => {
    expect(normalizeUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('strips # fragment', () => {
    expect(normalizeUrl('https://x.com/page#section')).toBe('https://x.com/page');
  });

  it('decodes &amp; entities in URL', () => {
    const result = normalizeUrl('https://example.com/page?a=1&amp;b=2');
    expect(result).toBe('https://example.com/page?a=1&b=2');
  });

  it('rejects javascript: protocol', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
  });

  it('rejects data: protocol', () => {
    expect(normalizeUrl('data:text/html,<h1>hi</h1>')).toBeNull();
  });

  it('returns null for non-URL strings', () => {
    expect(normalizeUrl('not a url')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizeUrl(null)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(normalizeUrl('')).toBeNull();
  });
});

// ── absUrl ───────────────────────────────────────────────────────────────────

describe('absUrl', () => {
  it('resolves relative path against base', () => {
    expect(absUrl('/path/to/page', 'https://example.com')).toBe('https://example.com/path/to/page');
  });

  it('returns absolute URL as-is', () => {
    expect(absUrl('https://other.com/page', 'https://example.com')).toBe('https://other.com/page');
  });

  it('returns null for invalid inputs', () => {
    expect(absUrl(null, 'https://example.com')).toBeNull();
  });
});

// ── decodeHtmlEntities ───────────────────────────────────────────────────────

describe('decodeHtmlEntities', () => {
  it('decodes &amp;', () => expect(decodeHtmlEntities('a &amp; b')).toBe('a & b'));
  it('decodes &lt;',  () => expect(decodeHtmlEntities('&lt;tag&gt;')).toBe('<tag>'));
  it('decodes &gt;',  () => expect(decodeHtmlEntities('&gt;')).toBe('>'));
  it('decodes &quot;',() => expect(decodeHtmlEntities('say &quot;hi&quot;')).toBe('say "hi"'));
  it('decodes &#39;', () => expect(decodeHtmlEntities('it&#39;s')).toBe("it's"));
});

// ── stripHtml ────────────────────────────────────────────────────────────────

describe('stripHtml', () => {
  it('strips HTML tags', () => {
    // The implementation collapses whitespace, so double spaces become single
    expect(stripHtml('<b>Hello</b> <i>World</i>')).toBe('Hello World');
  });

  it('strips CDATA wrappers', () => {
    expect(stripHtml('<![CDATA[plain text]]>')).toBe('plain text');
  });

  it('decodes HTML entities', () => {
    expect(stripHtml('&lt;b&gt;bold&lt;/b&gt;')).toContain('bold');
  });

  it('removes script blocks', () => {
    const result = stripHtml('before<script>alert(1)</script>after');
    expect(result).not.toContain('script');
    expect(result).toContain('before');
    expect(result).toContain('after');
  });

  it('removes style blocks', () => {
    const result = stripHtml('text<style>.a{color:red}</style>more');
    expect(result).not.toContain('color');
  });

  it('trims "Read more" suffix', () => {
    expect(stripHtml('<p>Some article text. Read more</p>')).not.toMatch(/Read more/i);
  });

  it('trims "Comments" suffix', () => {
    expect(stripHtml('<p>Some content</p>Comments')).not.toMatch(/\bComments\b/i);
  });

  it('handles XML parser objects { "#text": "..." }', () => {
    expect(stripHtml({ '#text': '<b>Parsed</b>' })).toBe('Parsed');
  });

  it('returns empty string for null', () => {
    expect(stripHtml(null)).toBe('');
  });

  it('returns empty string for empty input', () => {
    expect(stripHtml('')).toBe('');
  });
});

// ── isLowValueSnippet ────────────────────────────────────────────────────────

describe('isLowValueSnippet', () => {
  it('returns true for empty string', () => expect(isLowValueSnippet('')).toBe(true));
  it('returns true for "comments"', () => expect(isLowValueSnippet('comments')).toBe(true));
  it('returns true for "Read more"', () => expect(isLowValueSnippet('Read more')).toBe(true));
  it('returns true for "Continue reading"', () => expect(isLowValueSnippet('Continue reading')).toBe(true));
  it('returns false for a real sentence', () => {
    expect(isLowValueSnippet('This is a real article snippet with some actual content.')).toBe(false);
  });
});

// ── truncate ─────────────────────────────────────────────────────────────────

describe('truncate', () => {
  it('does not truncate when str.length <= n', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('appends ellipsis when over limit', () => {
    const result = truncate('a'.repeat(221), 220);
    expect(result).toHaveLength(221); // 220 + '…'
    expect(result.endsWith('…')).toBe(true);
  });

  it('handles null input', () => {
    expect(truncate(null)).toBe('');
  });
});

// ── normalizeDate ─────────────────────────────────────────────────────────────

describe('normalizeDate', () => {
  it('valid ISO string round-trips', () => {
    const iso = '2024-03-15T12:00:00.000Z';
    expect(normalizeDate(iso)).toBe(iso);
  });

  it('parses RFC 2822 date to ISO string', () => {
    const result = normalizeDate('Mon, 15 Jan 2024 12:00:00 +0000');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null for invalid date string', () => {
    expect(normalizeDate('not-a-date')).toBeNull();
  });

  it('returns null for null input', () => {
    expect(normalizeDate(null)).toBeNull();
  });
});

// ── newestFirst ───────────────────────────────────────────────────────────────

describe('newestFirst', () => {
  it('sorts articles newest first', () => {
    const articles = [
      { publishedAt: '2024-01-01T00:00:00Z' },
      { publishedAt: '2024-06-01T00:00:00Z' },
      { publishedAt: '2023-01-01T00:00:00Z' },
    ];
    const sorted = [...articles].sort(newestFirst);
    expect(sorted[0].publishedAt).toBe('2024-06-01T00:00:00Z');
    expect(sorted[2].publishedAt).toBe('2023-01-01T00:00:00Z');
  });

  it('sends undated entries to the end', () => {
    const articles = [
      { publishedAt: null },
      { publishedAt: '2024-01-01T00:00:00Z' },
    ];
    const sorted = [...articles].sort(newestFirst);
    expect(sorted[0].publishedAt).toBe('2024-01-01T00:00:00Z');
    expect(sorted[1].publishedAt).toBeNull();
  });
});

// ── runLimited ────────────────────────────────────────────────────────────────

describe('runLimited', () => {
  it('processes all items', async () => {
    const results = [];
    await runLimited([1, 2, 3, 4, 5], 2, async item => {
      results.push(item);
    });
    expect(results).toHaveLength(5);
    expect(results.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  it('respects the concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const items = Array.from({ length: 10 }, (_, i) => i);
    await runLimited(items, 3, async item => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 5));
      concurrent--;
    });
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });
});


