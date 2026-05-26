/**
 * scripts/generate-seo-content.mjs
 *
 * Reads public/feed.json and injects the latest 10 articles as
 * static HTML into index.html between:
 *   <!-- GENERATED_LATEST_ARTICLES_START -->
 *   <!-- GENERATED_LATEST_ARTICLES_END -->
 *
 * This ensures search-engine crawlers see real article content
 * even before JavaScript runs.
 *
 * Run: node scripts/generate-seo-content.mjs
 * Requires Node 18+.
 */

import fs   from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const SEO_ARTICLE_COUNT = 20;

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
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

/** Format a date string as a human-readable date. */
function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  } catch {
    return '';
  }
}

async function main() {
  // Read feed.json
  const feedPath = path.join(ROOT, 'public', 'feed.json');
  let feedData;
  try {
    feedData = JSON.parse(await fs.readFile(feedPath, 'utf8'));
  } catch {
    console.warn('[generate-seo-content] public/feed.json not found — skipping SEO injection.');
    process.exit(0);
  }

  const articles = (feedData.articles || [])
    .filter(a => !isSponsored(a))
    .slice(0, SEO_ARTICLE_COUNT);
  if (articles.length === 0) {
    console.warn('[generate-seo-content] No articles found in feed.json — skipping.');
    process.exit(0);
  }

  // Build article HTML
  const articleItems = articles.map(a => {
    // Use image only if it looks like a real hero image; otherwise use fallback
    const rawImage = (!looksLikeLogo(a.image) ? a.image : null) || a.fallbackImage;
    const imageHtml = rawImage
      ? `<div class="seo-card-img-wrap"><img src="${esc(rawImage)}" alt="${esc('Article image for: ' + a.title)}" loading="lazy" decoding="async" width="640" height="360" /></div>`
      : '';
    const dateStr = formatDate(a.publishedAt);
    const dateIso = a.publishedAt ? new Date(a.publishedAt).toISOString().slice(0, 10) : '';
    // Clean snippet: sanitize first, then escape for HTML output — never escape dirty HTML
    const cleaned = cleanSnippet(a.summary || '');
    const plainSummary = !isLowValueSnippet(cleaned) ? cleaned.slice(0, 200).replace(/\s+\S*$/, '…') : '';
    const summary = plainSummary
      ? `<div class="seo-card-summary"><span class="seo-ai-badge">AI Summary</span><p>${esc(plainSummary)}</p></div>`
      : '';
    // Derive a CSS category slug from the article category field (mirrors app logic)
    const catSlug = (a.category || 'general').toLowerCase().replace(/\s+/g, '-');
    const catLabel = esc(a.category || 'General');
    const timeElem = dateIso
      ? `<time datetime="${esc(dateIso)}">${esc(dateStr)}</time>`
      : `<span>${esc(dateStr)}</span>`;
    return `
    <article class="seo-card" itemscope itemtype="https://schema.org/NewsArticle">
      <meta itemprop="headline" content="${esc(a.title)}" />
      <meta itemprop="url" content="${esc(a.link)}" />
      ${dateIso ? `<meta itemprop="datePublished" content="${esc(dateIso)}" />` : ''}
      <meta itemprop="author" content="${esc(a.source)}" />
      <meta itemprop="articleSection" content="${catLabel}" />
      ${imageHtml}
      <h3 itemprop="name"><a href="${esc(a.link)}" rel="noopener noreferrer">${esc(a.title)}</a></h3>
      ${summary}
      <div class="seo-card-footer">
        <div class="card-source">
          <span class="src-dot cat-${esc(catSlug)}"></span>
          <span>${esc(a.source)}${dateStr ? ' &middot; ' + timeElem : ''}</span>
        </div>
        <div class="card-actions">
          <button class="card-share-btn" data-share-url="${esc(a.link)}" data-share-title="${esc(a.title)}" title="Share" aria-label="Share article">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
          <a href="${esc(a.link)}" rel="noopener noreferrer" class="card-link">
            Read →
          </a>
        </div>
      </div>
    </article>`;
  }).join('\n');

  const generatedAt = feedData.generatedAt ? new Date(feedData.generatedAt).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '';
  const generatedComment = generatedAt ? ` (generated ${generatedAt})` : '';

  const injectedHtml = `
  <!-- Latest articles from ${articles.length} of ${feedData.articleCount || articles.length} cached stories${generatedComment} -->
  <section id="seoLatestFallback" class="seo-latest-articles" aria-label="Latest developer news (SEO fallback)" style="margin-top:24px" itemscope itemtype="https://schema.org/CollectionPage">
    <h2 itemprop="name">
      Latest Developer &amp; Programming News
    </h2>
    <p class="sr-only" itemprop="description">The latest developer news aggregated from ${feedData.articleCount || articles.length}+ curated RSS feeds covering AI, cybersecurity, DevOps, JavaScript, Python, Rust, Go, Java, open source software, and software architecture.</p>
    <div class="seo-articles-grid">
${articleItems}
    </div>
  </section>`;

  // Read index.html
  const indexPath = path.join(ROOT, 'index.html');
  let html = await fs.readFile(indexPath, 'utf8');

  const START_MARKER = '<!-- GENERATED_LATEST_ARTICLES_START -->';
  const END_MARKER   = '<!-- GENERATED_LATEST_ARTICLES_END -->';

  if (!html.includes(START_MARKER)) {
    console.warn('[generate-seo-content] Markers not found in index.html — nothing to inject.');
    process.exit(0);
  }

  const startIdx = html.indexOf(START_MARKER) + START_MARKER.length;
  const endIdx   = html.indexOf(END_MARKER);

  if (endIdx < startIdx) {
    console.error('[generate-seo-content] Malformed markers in index.html.');
    process.exit(1);
  }

  const before = html.slice(0, startIdx);
  const after  = html.slice(endIdx);

  const updated = before + '\n' + injectedHtml + '\n  ' + after;

  await fs.writeFile(indexPath, updated, 'utf8');

  // Also update the hardcoded dateModified in the JSON-LD to today's date
  const today = new Date().toISOString().slice(0, 10);
  const withDate = (await fs.readFile(indexPath, 'utf8'))
    .replace(/"dateModified":\s*"\d{4}-\d{2}-\d{2}"/, `"dateModified": "${today}"`);
  await fs.writeFile(indexPath, withDate, 'utf8');

  console.log(`[generate-seo-content] ✓ Injected ${articles.length} latest articles into index.html.`);
}

main().catch(err => { console.error('[generate-seo-content] ✗', err); process.exit(1); });

