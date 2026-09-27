/**
 * tests/unit/seo-content.test.mjs
 * Unit tests for the render helpers in scripts/generate-seo-content.mjs.
 */

import { describe, it, expect } from 'vitest';
import {
  esc,
  truncateWords,
  renderArticleCard,
  renderLatestArticles,
  renderSourcesDirectory,
  renderSourcesJsonLd,
  injectBetween,
} from '../../scripts/generate-seo-content.mjs';

const article = {
  title: 'Rust 2.0 <script>alert(1)</script>',
  link: 'https://example.com/rust?a=1&b=2',
  source: 'Rust Blog',
  category: 'Rust',
  publishedAt: '2026-09-20T10:00:00.000Z',
  summary: '<p>Lots of &amp; news about <b>Rust</b> today.</p> Read more',
  summaryType: 'snippet',
  image: 'https://example.com/hero.jpg',
  fallbackImage: '/assets/fallbacks/rust.svg',
};

const feeds = [
  { id: 'hn', name: 'Hacker News', category: 'General', homepage: 'https://news.ycombinator.com/', url: 'https://news.ycombinator.com/rss' },
  { id: 'rust', name: 'Rust Blog', category: 'Rust', homepage: 'https://blog.rust-lang.org/', url: 'https://blog.rust-lang.org/feed.xml' },
  { id: 'x', name: 'Evil </script> Feed', category: 'AI', url: 'https://evil.example/feed' },
];

describe('esc', () => {
  it('escapes HTML special characters', () => {
    expect(esc('<a href="x">\'&')).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
});

describe('truncateWords', () => {
  it('returns short text untouched (no stray ellipsis, no lost last word)', () => {
    expect(truncateWords('Short and complete.', 50)).toBe('Short and complete.');
  });

  it('cuts long text at a word boundary with an ellipsis', () => {
    expect(truncateWords('alpha beta gamma delta', 13)).toBe('alpha beta…');
  });
});

describe('renderArticleCard', () => {
  it('uses the live card classes so the hand-off to the app is seamless', () => {
    const html = renderArticleCard(article, 1);
    expect(html).toContain('class="card seo-card cat-rust"');
    expect(html).toContain('class="card-title"');
    expect(html).toContain('class="card-share-btn"');
  });

  it('escapes titles and links', () => {
    const html = renderArticleCard(article, 1);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('href="https://example.com/rust?a=1&amp;b=2"');
  });

  it('strips markup and trailing noise from the snippet', () => {
    const html = renderArticleCard(article, 1);
    expect(html).toContain('Lots of &amp; news about Rust today.');
    expect(html).not.toContain('Read more');
  });

  it('does not label plain snippets as AI summaries', () => {
    expect(renderArticleCard(article, 1)).not.toMatch(/AI Summary/i);
  });

  it('makes the first card the eager-loaded featured lead', () => {
    const html = renderArticleCard(article, 0);
    expect(html).toContain('card-featured');
    expect(html).toContain('loading="eager"');
    expect(renderArticleCard(article, 2)).toContain('loading="lazy"');
  });

  it('falls back to the category illustration when the image looks like a logo', () => {
    const html = renderArticleCard({ ...article, image: 'https://example.com/logo.png' }, 1);
    expect(html).toContain('src="/assets/fallbacks/rust.svg"');
  });

  it('omits the date for unparseable dates', () => {
    expect(renderArticleCard({ ...article, publishedAt: 'nope' }, 1)).not.toContain('<time');
  });
});

describe('renderLatestArticles', () => {
  it('skips sponsored items and uses the feed count (not article count) in the description', () => {
    const html = renderLatestArticles({
      feedCount: 51,
      articleCount: 485,
      generatedAt: '2026-09-27T20:00:00Z',
      articles: [{ ...article, sponsored: true, title: 'Sponsored thing' }, article],
    });
    expect(html).not.toContain('Sponsored thing');
    expect(html).toContain('aggregated from 51 curated RSS feeds');
    expect(html).not.toContain('485+');
    expect(html).toContain('id="seoLatestFallback"');
  });

  it('returns null when there is nothing to render', () => {
    expect(renderLatestArticles({ articles: [] })).toBeNull();
  });
});

describe('renderSourcesDirectory', () => {
  it('groups sources by topic in editorial order and links topics to filters', () => {
    const html = renderSourcesDirectory(feeds);
    const general = html.indexOf('General developer news');
    const ai = html.indexOf('AI &amp; machine learning');
    const rust = html.indexOf('>Rust<');
    expect(general).toBeGreaterThan(-1);
    expect(general).toBeLessThan(ai);
    expect(ai).toBeLessThan(rust);
    expect(html).toContain('data-filter="Rust"');
    expect(html).toContain('href="/?topic=Rust#latest"');
    expect(html).toContain('id="sources-heading"');
  });

  it('derives a homepage when a feed has none', () => {
    expect(renderSourcesDirectory(feeds)).toContain('href="https://evil.example/"');
  });
});

describe('renderSourcesJsonLd', () => {
  const extractJson = block => block.slice(block.indexOf('>') + 1, block.lastIndexOf('</script>'));

  it('emits valid JSON with one ListItem per source', () => {
    const json = JSON.parse(extractJson(renderSourcesJsonLd(feeds)));
    expect(json['@type']).toBe('ItemList');
    expect(json.numberOfItems).toBe(3);
    expect(json.itemListElement[1]).toMatchObject({ position: 2, name: 'Rust Blog', url: 'https://geekspulse.dev/?source=Rust+Blog' });
  });

  it('can never close its own <script> tag', () => {
    const inner = extractJson(renderSourcesJsonLd(feeds));
    expect(inner).not.toContain('</script>');
    expect(inner).toContain('\\u003c/script>');
  });
});

describe('injectBetween', () => {
  const doc = 'a\n  <!-- X_START -->\n  old\n  <!-- X_END -->\nb';

  it('replaces content between markers', () => {
    const out = injectBetween(doc, 'X', '\n  new');
    expect(out).toContain('new');
    expect(out).not.toContain('old');
    expect(out).toContain('<!-- X_START -->');
    expect(out).toContain('<!-- X_END -->');
  });

  it('is idempotent', () => {
    const once = injectBetween(doc, 'X', '\n  new');
    expect(injectBetween(once, 'X', '\n  new')).toBe(once);
  });

  it('leaves the document untouched when markers are missing', () => {
    expect(injectBetween('no markers here', 'X', 'new')).toBe('no markers here');
  });

  it('throws on reversed markers', () => {
    expect(() => injectBetween('<!-- X_END --> <!-- X_START -->', 'X', 'y')).toThrow(/Malformed/);
  });
});
