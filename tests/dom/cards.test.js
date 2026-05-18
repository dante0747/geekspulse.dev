/**
 * tests/dom/cards.test.js
 * DOM component tests for js/cards.js (runs in happy-dom environment)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock storage.js to prevent localStorage reads
vi.mock('../../js/storage.js', () => ({
  isBookmarked: vi.fn(() => false),
  loadBookmarks: vi.fn(() => []),
}));

// Mock config.js with minimal catMeta
vi.mock('../../js/config.js', () => {
  const icon = '<svg width="15" height="15"></svg>';
  return {
    catMeta: {
      General:    { icon, color: '#94A3B8' },
      Security:   { icon, color: '#F43F5E' },
      JavaScript: { icon, color: '#FBBF24' },
    },
    categories: [
      { id: 'General',    label: 'General',    color: '#94A3B8', icon },
      { id: 'Security',   label: 'Security',   color: '#F43F5E', icon },
      { id: 'JavaScript', label: 'JavaScript', color: '#FBBF24', icon },
    ],
    loadingMessages: ['Loading...'],
  };
});

import { gridCard, listCard, buildSkeletons } from '../../js/cards.js';

const mockArticle = {
  title:         'Test Article Title',
  link:          'https://example.com/article',
  source:        'Test Source',
  category:      'General',
  snippet:       'A test article snippet with some content.',
  image:         'https://example.com/image.jpg',
  fallbackImage: '/assets/fallbacks/general.svg',
  summaryType:   'snippet',
  date:          new Date(Date.now() - 300_000).toISOString(), // 5 min ago
};

// ── gridCard ──────────────────────────────────────────────────────────────────

describe('gridCard', () => {
  let html;
  beforeEach(() => {
    html = gridCard(mockArticle, 0);
  });

  it('returns a non-empty HTML string', () => {
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains article.title (escaped)', () => {
    expect(html).toContain('Test Article Title');
  });

  it('contains article.link in an <a href>', () => {
    expect(html).toContain(`href="${mockArticle.link}"`);
  });

  it('contains article.source', () => {
    expect(html).toContain('Test Source');
  });

  it('data-category attribute matches article.category', () => {
    expect(html).toContain('data-category="General"');
  });

  it('<img> src is set when article has an image', () => {
    expect(html).toContain(`src="${mockArticle.image}"`);
  });

  it('bookmark button data-bm-link equals article.link', () => {
    expect(html).toContain(`data-bm-link="${mockArticle.link}"`);
  });

  it('XSS: title with <script> is escaped in output', () => {
    const xssArticle = { ...mockArticle, title: '<script>alert(1)</script>' };
    const xssHtml = gridCard(xssArticle, 1);
    expect(xssHtml).not.toContain('<script>alert(1)</script>');
    expect(xssHtml).toContain('&lt;script&gt;');
  });
});

// ── gridCard without image ────────────────────────────────────────────────────

describe('gridCard without image', () => {
  it('renders placeholder when no image', () => {
    const noImg = { ...mockArticle, image: null };
    const html = gridCard(noImg, 0);
    expect(html).toContain('card-placeholder');
  });
});

// ── listCard ──────────────────────────────────────────────────────────────────

describe('listCard', () => {
  let html;
  beforeEach(() => {
    html = listCard(mockArticle, 0);
  });

  it('returns a non-empty HTML string', () => {
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(0);
  });

  it('contains article.title', () => {
    expect(html).toContain('Test Article Title');
  });

  it('contains article.link in an <a href>', () => {
    expect(html).toContain(`href="${mockArticle.link}"`);
  });

  it('contains article.source', () => {
    expect(html).toContain('Test Source');
  });

  it('data-category attribute matches article.category', () => {
    expect(html).toContain('data-category="General"');
  });

  it('bookmark button data-bm-link equals article.link', () => {
    expect(html).toContain(`data-bm-link="${mockArticle.link}"`);
  });

  it('XSS: title with <script> is escaped', () => {
    const xssArticle = { ...mockArticle, title: '<script>xss</script>' };
    const xssHtml = listCard(xssArticle, 0);
    expect(xssHtml).not.toContain('<script>xss</script>');
  });
});

// ── buildSkeletons ────────────────────────────────────────────────────────────

describe('buildSkeletons', () => {
  it('returns HTML containing exactly n skeleton elements', () => {
    const html = buildSkeletons(3);
    const count = (html.match(/skeleton-card/g) || []).length;
    expect(count).toBe(3);
  });

  it('result contains "skeleton" CSS class', () => {
    const html = buildSkeletons(2);
    expect(html).toContain('skeleton');
  });

  it('default n=8 produces 8 skeletons', () => {
    const html = buildSkeletons();
    const count = (html.match(/skeleton-card/g) || []).length;
    expect(count).toBe(8);
  });
});

