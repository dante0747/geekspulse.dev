/**
 * scripts/generate-seo-content.mjs
 *
 * Injects crawlable, server-rendered content into index.html between marker
 * comments so search engines (and visitors without JavaScript) see real
 * content before the app hydrates:
 *
 *   <!-- GENERATED_LATEST_ARTICLES_START --> … <!-- GENERATED_LATEST_ARTICLES_END -->
 *     The latest articles from public/feed.json, rendered with the same card
 *     markup the app uses so the hand-off to the live feed is seamless.
 *
 *   <!-- GENERATED_SOURCES_START --> … <!-- GENERATED_SOURCES_END -->
 *     The footer source directory, grouped by topic (from data/feeds.json).
 *
 *   <!-- GENERATED_SOURCES_JSONLD_START --> … <!-- GENERATED_SOURCES_JSONLD_END -->
 *     An ItemList JSON-LD block of every enabled source (from data/feeds.json).
 *
 * It also refreshes the JSON-LD dateModified and the static feed-count spans.
 *
 * Run: node scripts/generate-seo-content.mjs
 * Requires Node 18+.
 */

import fs   from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');
const SITE      = 'https://geekspulse.dev';

const SEO_ARTICLE_COUNT = 20;

/** Topic order + human labels for the source directory. */
const CATEGORY_ORDER = [
  ['General',      'General developer news'],
  ['AI',           'AI & machine learning'],
  ['Security',     'Cybersecurity'],
  ['DevOps',       'DevOps & cloud'],
  ['JavaScript',   'JavaScript & TypeScript'],
  ['Python',       'Python'],
  ['Rust',         'Rust'],
  ['Go',           'Go'],
  ['Java',         'Java & the JVM'],
  ['Open Source',  'Open source & Linux'],
  ['Architecture', 'Software architecture'],
];

/** Same sponsored-content regex used in js/config.js — applied at build time too. */
const SPONSORED_RE = /\b(sponsored|partner[ -]content|promoted|advertorial|advertisement|webinar|webcast|brought[ -]to[ -]you[ -]by|in[ -]partnership[ -]with|paid[ -]post|native[ -]ad|content[ -]marketing)\b/i;

/** Returns true if an article looks like sponsored/promotional content.
 *  Checks the pre-computed `sponsored` flag from build-feed.mjs first,
 *  then falls back to the regex for articles that lack it. */
function isSponsored(article) {
  if (article.sponsored === true) return true;
  return SPONSORED_RE.test(article.title || '') || SPONSORED_RE.test(article.summary || '');
}

/** Escape a string for safe inclusion in HTML attribute or text content. */
export function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Mirrors catClass() in js/utils.js. */
function catSlug(category) {
  return 'cat-' + String(category || 'General').toLowerCase().replace(/\s+/g, '-');
}

/**
 * Fully clean a snippet value:
 *  1. Strip CDATA wrappers
 *  2. Remove script/style/img/figure blocks
 *  3. Decode HTML entities (so escaped tags become real tags)
 *  4. Strip all remaining tags
 *  5. Remove low-value trailing noise (Comments, Read more, etc.)
 *  6. Collapse whitespace
 *
 * Always sanitize BEFORE calling esc() — never escape dirty HTML.
 */
function cleanSnippet(value = '') {
  return String(value || '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    // Decode entities so escaped tags like &lt;img...&gt; become real text we can strip
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    // Strip any tags that were hiding behind entities
    .replace(/<[^>]+>/g, ' ')
    .replace(/\bComments\b\s*$/i, '')
    .replace(/\bRead more\b\.?\s*$/i, '')
    .replace(/\bContinue reading\b\.?\s*$/i, '')
    .replace(/\bView article\b\.?\s*$/i, '')
    .replace(/\bLearn more\b\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Returns true if the snippet is too low-value to display. */
function isLowValueSnippet(value = '') {
  const normalized = String(value || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (
    !normalized ||
    normalized === 'comments' ||
    normalized === 'read more' ||
    normalized === 'continue reading' ||
    normalized === 'view article' ||
    normalized === 'learn more'
  );
}

/**
 * Returns true if the URL looks like a small icon/logo rather than an
 * article hero image (so we can skip it and use the fallback instead).
 */
function looksLikeLogo(url) {
  if (!url) return true;
  const u = url.toLowerCase();
  return (
    /lcorner|corner|favicon|logo|icon|avatar|placeholder|blank|default|sprite|pixel|tracking|badge/i.test(u) ||
    // Bookface / YC logo-style S3 URLs are company logos, not hero images
    /bookface-images\.s3\.amazonaws\.com\/logos\//i.test(u) ||
    // LWN decorative layout images
    /static\.lwn\.net\/images\//i.test(u) ||
    // Very short image paths are often icons
    (u.split('/').pop().length < 8 && /\.(png|gif|ico)$/.test(u))
  );
}

/** Cut at a word boundary with an ellipsis — only when the text is actually too long. */
export function truncateWords(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s.,;:!?…-]+$/, '') + '…';
}

/** Format a date string as a human-readable date. */
function formatDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  } catch {
    return '';
  }
}

/** Serialise JSON for an inline <script> — `<` can never close the tag. */
function jsonForScript(value) {
  return JSON.stringify(value, null, 2).replace(/</g, '\\u003c');
}

const SHARE_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';

/** One server-rendered card — same classes as gridCard() in js/cards.js. */
export function renderArticleCard(a, i) {
  const featured = i === 0;
  const rawImage = (!looksLikeLogo(a.image) ? a.image : null) || a.fallbackImage;
  const imageHtml = rawImage
    ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" class="card-img-wrap" tabindex="-1" aria-hidden="true"><img class="card-img" src="${esc(rawImage)}" alt="" itemprop="image" loading="${featured ? 'eager' : 'lazy'}"${featured ? ' fetchpriority="high"' : ''} decoding="async" referrerpolicy="no-referrer" width="640" height="360" /></a>`
    : '';
  const dateStr = formatDate(a.publishedAt);
  const dateIso = dateStr ? new Date(a.publishedAt).toISOString().slice(0, 10) : '';
  // Clean snippet: sanitize first, then escape for HTML output — never escape dirty HTML
  const cleaned = cleanSnippet(a.summary || '');
  const plainSummary = isLowValueSnippet(cleaned) ? '' : truncateWords(cleaned, 220);
  const cat = a.category || 'General';
  const slug = catSlug(cat);
  return `
          <article class="card seo-card ${slug}${featured ? ' card-featured' : ''}" itemscope itemtype="https://schema.org/NewsArticle">
            <meta itemprop="url" content="${esc(a.link)}" />
            <meta itemprop="articleSection" content="${esc(cat)}" />
            ${imageHtml}
            <div class="card-body">
              <div class="card-top">
                <div class="card-source"><span class="src-dot ${slug}" aria-hidden="true"></span><span class="card-source-name" itemprop="publisher" itemscope itemtype="https://schema.org/Organization"><span itemprop="name">${esc(a.source)}</span></span></div>
                ${dateIso ? `<span class="card-sep" aria-hidden="true">·</span><time class="card-date" datetime="${esc(dateIso)}" itemprop="datePublished">${esc(dateStr)}</time>` : ''}
              </div>
              <h3 class="card-title" itemprop="headline"><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a></h3>
              ${plainSummary ? `<p class="card-snippet" itemprop="description">${esc(plainSummary)}</p>` : ''}
            </div>
            <div class="card-footer">
              <div class="card-meta"><span class="card-cat ${slug}">${esc(cat)}</span></div>
              <div class="card-actions">
                <button type="button" class="card-share-btn" data-share-url="${esc(a.link)}" data-share-title="${esc(a.title)}" title="Share" aria-label="Share article">${SHARE_ICON}</button>
              </div>
            </div>
          </article>`;
}

export function renderLatestArticles(feedData) {
  const articles = (feedData.articles || [])
    .filter(a => !isSponsored(a))
    .slice(0, SEO_ARTICLE_COUNT);
  if (articles.length === 0) return null;

  const generatedAt = feedData.generatedAt
    ? new Date(feedData.generatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
    : '';
  const feedCount = feedData.feedCount || feedData.successFeeds || 50;
  return `
          <!-- Latest ${articles.length} of ${feedData.articleCount || articles.length} cached stories${generatedAt ? ` (generated ${generatedAt})` : ''} -->
          <section id="seoLatestFallback" class="seo-latest-articles" aria-labelledby="seoLatestHeading" itemscope itemtype="https://schema.org/CollectionPage">
            <h2 id="seoLatestHeading" itemprop="name">Latest developer &amp; programming news</h2>
            <meta itemprop="description" content="The latest developer news aggregated from ${esc(String(feedCount))} curated RSS feeds covering AI, cybersecurity, DevOps, JavaScript, Python, Rust, Go, Java, open source software and software architecture." />
            <div class="seo-articles-grid feed-grid">
${articles.map(renderArticleCard).join('\n')}
            </div>
          </section>`;
}

function groupFeeds(feeds) {
  const groups = new Map(CATEGORY_ORDER.map(([id, label]) => [id, { id, label, feeds: [] }]));
  for (const f of feeds) {
    if (!groups.has(f.category)) groups.set(f.category, { id: f.category, label: f.category, feeds: [] });
    groups.get(f.category).feeds.push(f);
  }
  return [...groups.values()].filter(g => g.feeds.length > 0);
}

function homepageOf(feed) {
  if (feed.homepage) return feed.homepage;
  try { return new URL(feed.url).origin + '/'; } catch { return '#'; }
}

export function renderSourcesDirectory(feeds) {
  const groups = groupFeeds(feeds);
  const blocks = groups.map(g => `
          <div class="source-group">
            <h3><span class="src-dot ${catSlug(g.id)}" aria-hidden="true"></span><a href="/?topic=${encodeURIComponent(g.id)}#latest" data-filter="${esc(g.id)}">${esc(g.label)}</a></h3>
            <ul>
${g.feeds.map(f => `              <li><a href="${esc(homepageOf(f))}" target="_blank" rel="noopener noreferrer">${esc(f.name)}</a></li>`).join('\n')}
            </ul>
          </div>`).join('');
  return `
        <div class="footer-sources-head">
          <h2 id="sources-heading" class="footer-sources-title">Sources</h2>
          <p>${feeds.length} hand-picked developer &amp; programming news feeds, grouped by topic. <a class="prose-link" href="https://github.com/dante0747/geekspulse.dev/blob/main/docs/feed-selection-criteria.md" target="_blank" rel="noopener noreferrer">How sources are chosen</a></p>
        </div>
        <div class="sources-grid">${blocks}
        </div>`;
}

export function renderSourcesJsonLd(feeds) {
  const list = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Developer news sources aggregated by GeeksPulse',
    description: `All ${feeds.length} RSS feed sources aggregated by GeeksPulse, the free developer news aggregator.`,
    url: `${SITE}/#sources`,
    numberOfItems: feeds.length,
    itemListElement: feeds.map((f, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: f.name,
      url: `${SITE}/?${new URLSearchParams({ source: f.name })}`,
    })),
  };
  return `
  <script type="application/ld+json">
${jsonForScript(list)}
  </script>`;
}

/** Replace the content between two marker comments. Returns html unchanged if missing. */
export function injectBetween(html, name, content) {
  const START = `<!-- ${name}_START -->`;
  const END   = `<!-- ${name}_END -->`;
  const startIdx = html.indexOf(START);
  const endIdx   = html.indexOf(END);
  if (startIdx === -1 || endIdx === -1) {
    console.warn(`[generate-seo-content] ${name} markers not found in index.html — skipping.`);
    return html;
  }
  if (endIdx < startIdx) throw new Error(`Malformed ${name} markers in index.html.`);
  const indent = (html.slice(html.lastIndexOf('\n', endIdx) + 1, endIdx).match(/^\s*/) || [''])[0];
  return html.slice(0, startIdx + START.length) + content + '\n' + indent + html.slice(endIdx);
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { return null; }
}

async function main() {
  const indexPath = path.join(ROOT, 'index.html');
  let html = await fs.readFile(indexPath, 'utf8');

  // ── Sources directory + ItemList (data/feeds.json) ───────────────
  const registry = await readJson(path.join(ROOT, 'data', 'feeds.json'));
  const feeds = Array.isArray(registry) ? registry.filter(f => f.enabled !== false) : [];
  if (feeds.length) {
    html = injectBetween(html, 'GENERATED_SOURCES', renderSourcesDirectory(feeds));
    html = injectBetween(html, 'GENERATED_SOURCES_JSONLD', renderSourcesJsonLd(feeds));
    for (const id of ['heroFeedCount', 'termFeedCount', 'statFeeds']) {
      html = html.replace(new RegExp(`(id="${id}">)\\d+(<)`), `$1${feeds.length}$2`);
    }
  } else {
    console.warn('[generate-seo-content] data/feeds.json missing or empty — sources left unchanged.');
  }

  // ── Latest articles (public/feed.json) ───────────────────────────
  const feedData = await readJson(path.join(ROOT, 'public', 'feed.json'));
  let articleCount = 0;
  if (!feedData) {
    console.warn('[generate-seo-content] public/feed.json not found — latest articles left unchanged.');
  } else {
    const latest = renderLatestArticles(feedData);
    if (latest) {
      html = injectBetween(html, 'GENERATED_LATEST_ARTICLES', latest);
      articleCount = Math.min(SEO_ARTICLE_COUNT, (feedData.articles || []).length);
    } else {
      console.warn('[generate-seo-content] No articles found in feed.json — latest articles left unchanged.');
    }
  }

  // Keep the JSON-LD dateModified current
  const today = new Date().toISOString().slice(0, 10);
  html = html.replace(/"dateModified":\s*"\d{4}-\d{2}-\d{2}"/, `"dateModified": "${today}"`);

  await fs.writeFile(indexPath, html, 'utf8');
  console.log(`[generate-seo-content] ✓ Injected ${articleCount} latest articles and ${feeds.length} sources into index.html.`);
}

// Only run when executed directly (the render helpers are unit-tested).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => { console.error('[generate-seo-content] ✗', err); process.exit(1); });
}
