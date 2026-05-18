/**
 * tests/integration/build-feed.test.mjs
 * Smoke tests for pipeline.mjs logic and build-feed helpers.
 */

import { describe, it, expect, vi } from 'vitest';

// Mock ai.mjs to prevent LLM calls
vi.mock('../../scripts/lib/ai.mjs', () => ({
  ollamaClient: null,
  aiCache: {},
  saveCache: vi.fn(),
}));

// Mock images.mjs
vi.mock('../../scripts/lib/images.mjs', () => ({
  extractBestImage: vi.fn(() => null),
  fetchArticleImage: vi.fn(async () => null),
}));

import { deduplicateArticles } from '../../scripts/lib/pipeline.mjs';
import { newestFirst } from '../../scripts/lib/utils.mjs';
import { parseFeedXml } from '../../scripts/lib/parser.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { MAX_PER_FEED } from '../../scripts/lib/config.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = name => readFileSync(join(__dirname, '../fixtures', name), 'utf8');

// ── deduplicateArticles ───────────────────────────────────────────────────────

describe('deduplicateArticles', () => {
  it('removes duplicate articles by link', () => {
    const articles = [
      { link: 'https://a.com/1', category: 'General' },
      { link: 'https://a.com/2', category: 'General' },
      { link: 'https://a.com/1', category: 'General' }, // duplicate
      { link: 'https://a.com/3', category: 'Security' },
      { link: 'https://a.com/2', category: 'Security' }, // duplicate with non-General
      { link: 'https://a.com/4', category: 'Python' },
    ];
    const result = deduplicateArticles(articles);
    expect(result).toHaveLength(4);
  });

  it('replaces General entry with more-specific category duplicate', () => {
    const articles = [
      { link: 'https://a.com/x', category: 'General' },
      { link: 'https://a.com/x', category: 'Security' },
    ];
    const result = deduplicateArticles(articles);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe('Security');
  });

  it('feeding 10 articles where 3 share the same id/link → output has 7', () => {
    const articles = Array.from({ length: 10 }, (_, i) => ({
      link: i < 3 ? 'https://a.com/shared' : `https://a.com/${i}`,
      category: 'General',
    }));
    const result = deduplicateArticles(articles);
    expect(result).toHaveLength(8); // 1 shared + 7 unique (indices 3..9)
  });
});

// ── newestFirst sort ──────────────────────────────────────────────────────────

describe('newestFirst sort', () => {
  it('sorts a mixed-date array in descending order', () => {
    const articles = [
      { publishedAt: '2024-01-15T00:00:00Z' },
      { publishedAt: '2024-03-01T00:00:00Z' },
      { publishedAt: '2023-12-25T00:00:00Z' },
      { publishedAt: '2024-02-10T00:00:00Z' },
    ];
    const sorted = [...articles].sort(newestFirst);
    expect(sorted[0].publishedAt).toBe('2024-03-01T00:00:00Z');
    expect(sorted[1].publishedAt).toBe('2024-02-10T00:00:00Z');
    expect(sorted[2].publishedAt).toBe('2024-01-15T00:00:00Z');
    expect(sorted[3].publishedAt).toBe('2023-12-25T00:00:00Z');
  });
});

// ── MAX_PER_FEED cap ──────────────────────────────────────────────────────────

describe('MAX_PER_FEED cap', () => {
  it(`parseFeedXml returns at most MAX_PER_FEED (${MAX_PER_FEED}) articles`, () => {
    // Build a fixture with MAX_PER_FEED + 10 items
    const count = MAX_PER_FEED + 10;
    const items = Array.from({ length: count }, (_, i) => `
    <item>
      <title>Article ${i + 1}</title>
      <link>https://example.com/article-${i + 1}</link>
      <description>This is article ${i + 1} with enough content to be a real snippet.</description>
      <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
    </item>`).join('');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Big Feed</title><link>https://example.com</link>${items}</channel></rss>`;
    const feed = { id: 'big-feed', name: 'Big Feed', url: 'https://example.com', category: 'General' };
    const articles = parseFeedXml(xml, feed);
    expect(articles.length).toBeLessThanOrEqual(MAX_PER_FEED);
    expect(articles.length).toBe(MAX_PER_FEED);
  });
});

