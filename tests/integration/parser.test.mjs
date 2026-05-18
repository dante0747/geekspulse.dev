/**
 * tests/integration/parser.test.mjs
 * Integration tests for scripts/lib/parser.mjs
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = name => readFileSync(join(__dirname, '../fixtures', name), 'utf8');

// Mock images.mjs to prevent real HTTP image extraction
vi.mock('../../scripts/lib/images.mjs', () => ({
  extractBestImage: vi.fn(() => null),
}));

import { parseFeedXml, fetchOneFeed, buildArticleRecord } from '../../scripts/lib/parser.mjs';

const MOCK_FEED = {
  id: 'test-feed',
  name: 'Test Feed',
  url: 'https://example.com/feed.xml',
  category: 'General',
};

// ── parseFeedXml — RSS ────────────────────────────────────────────────────────

describe('parseFeedXml — rss-valid.xml', () => {
  let articles;
  beforeEach(() => {
    articles = parseFeedXml(fixture('rss-valid.xml'), MOCK_FEED);
  });

  it('returns 3 articles', () => {
    expect(articles).toHaveLength(3);
  });

  it('each article has required fields', () => {
    for (const a of articles) {
      expect(a).toHaveProperty('id');
      expect(a).toHaveProperty('title');
      expect(a).toHaveProperty('link');
      expect(a).toHaveProperty('source');
      expect(a).toHaveProperty('category');
      expect(a).toHaveProperty('publishedAt');
      expect(a).toHaveProperty('summary');
      expect(a).toHaveProperty('image');
    }
  });

  it('link is a valid absolute URL', () => {
    for (const a of articles) {
      expect(() => new URL(a.link)).not.toThrow();
      expect(a.link).toMatch(/^https?:\/\//);
    }
  });

  it('publishedAt is an ISO string or null', () => {
    for (const a of articles) {
      if (a.publishedAt !== null) {
        expect(a.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    }
  });

  it('source matches feed name', () => {
    expect(articles[0].source).toBe('Test Feed');
  });
});

describe('parseFeedXml — rss-encoded-content.xml', () => {
  it('strips HTML from content:encoded', () => {
    const articles = parseFeedXml(fixture('rss-encoded-content.xml'), MOCK_FEED);
    const first = articles[0];
    expect(first.summary).not.toMatch(/<[^>]+>/);
  });

  it('low-value snippet "Read more" produces summary: ""', () => {
    const articles = parseFeedXml(fixture('rss-encoded-content.xml'), MOCK_FEED);
    const readMoreArticle = articles.find(a => a.link.includes('encoded-2'));
    expect(readMoreArticle).toBeDefined();
    expect(readMoreArticle.summary).toBe('');
  });

  it('HTML is stripped from titles', () => {
    const articles = parseFeedXml(fixture('rss-encoded-content.xml'), MOCK_FEED);
    const first = articles[0];
    expect(first.title).not.toMatch(/<[^>]+>/);
    expect(first.title).toContain('HTML Title');
  });
});

describe('parseFeedXml — atom-valid.xml', () => {
  it('returns 3 entries from valid Atom feed', () => {
    const articles = parseFeedXml(fixture('atom-valid.xml'), MOCK_FEED);
    expect(articles).toHaveLength(3);
  });

  it('each atom entry has required fields', () => {
    const articles = parseFeedXml(fixture('atom-valid.xml'), MOCK_FEED);
    for (const a of articles) {
      expect(a.link).toMatch(/^https?:\/\//);
      expect(a.title).toBeTruthy();
    }
  });
});

describe('parseFeedXml — atom-alternate-link.xml', () => {
  it('uses the rel=alternate link as the article URL', () => {
    const articles = parseFeedXml(fixture('atom-alternate-link.xml'), MOCK_FEED);
    expect(articles).toHaveLength(1);
    expect(articles[0].link).toBe('https://example.com/actual-article');
  });
});

describe('parseFeedXml — rss-single-item.xml (non-array regression)', () => {
  it('returns a 1-element array for single-item feed', () => {
    const articles = parseFeedXml(fixture('rss-single-item.xml'), MOCK_FEED);
    expect(articles).toHaveLength(1);
    expect(articles[0].link).toBe('https://example.com/only-article');
  });
});

describe('parseFeedXml — rss-empty.xml', () => {
  it('returns empty array for feed with zero items', () => {
    const articles = parseFeedXml(fixture('rss-empty.xml'), MOCK_FEED);
    expect(articles).toEqual([]);
  });
});

// ── buildArticleRecord ────────────────────────────────────────────────────────

describe('buildArticleRecord', () => {
  const record = buildArticleRecord(MOCK_FEED, {
    link: 'https://example.com/test-article',
    title: 'Test Article',
    summary: 'A test summary',
    date: '2024-01-01T00:00:00.000Z',
    image: 'https://example.com/img.jpg',
  });

  it('id is exactly 12 hex chars', () => {
    expect(record.id).toMatch(/^[0-9a-f]{12}$/);
  });

  it('fetchedAt is a valid ISO timestamp close to Date.now()', () => {
    const now = Date.now();
    const fetchedAt = new Date(record.fetchedAt).getTime();
    expect(Math.abs(fetchedAt - now)).toBeLessThan(5000);
  });

  it('fallbackImage is a non-empty string', () => {
    expect(typeof record.fallbackImage).toBe('string');
    expect(record.fallbackImage.length).toBeGreaterThan(0);
  });

  it('imageType is "real" when image provided', () => {
    expect(record.imageType).toBe('real');
  });

  it('imageType is "fallback" when no image', () => {
    const r = buildArticleRecord(MOCK_FEED, {
      link: 'https://example.com/no-img',
      title: 'No Image',
      summary: '',
      date: null,
      image: null,
    });
    expect(r.imageType).toBe('fallback');
  });
});

// ── fetchOneFeed with mocked fetch ────────────────────────────────────────────

describe('fetchOneFeed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns ok:true with articles on successful 200', async () => {
    const xml = fixture('rss-valid.xml');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => xml,
    }));
    const result = await fetchOneFeed(MOCK_FEED);
    expect(result.ok).toBe(true);
    expect(result.articles.length).toBeGreaterThan(0);
  });

  it('returns ok:false with error message on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '',
    }));
    const result = await fetchOneFeed(MOCK_FEED);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('404');
    expect(result.articles).toEqual([]);
  });

  it('returns ok:false when fetch throws AbortError', async () => {
    const err = new DOMException('The operation was aborted.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(err));
    const result = await fetchOneFeed(MOCK_FEED);
    expect(result.ok).toBe(false);
    expect(result.articles).toEqual([]);
  });

  it('returns ok:false or empty articles on malformed XML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<not valid xml <<< >>>',
    }));
    const result = await fetchOneFeed(MOCK_FEED);
    // Parser is lenient — either ok:false or ok:true with 0 articles
    expect(result.articles.length === 0 || result.ok === false).toBe(true);
  });
});

