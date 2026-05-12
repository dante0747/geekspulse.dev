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

const SEO_ARTICLE_COUNT = 10;

/** Escape a string for safe inclusion in HTML. */
function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

  const articles = (feedData.articles || []).slice(0, SEO_ARTICLE_COUNT);
  if (articles.length === 0) {
    console.warn('[generate-seo-content] No articles found in feed.json — skipping.');
    process.exit(0);
  }

  // Build article HTML
  const articleItems = articles.map(a => {
    const imageHtml = (a.image || a.fallbackImage)
      ? `<img src="${esc(a.image || a.fallbackImage)}" alt="${esc('Article image for: ' + a.title)}" loading="lazy" decoding="async" width="640" height="360" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:4px;display:block;margin-bottom:8px" />`
      : '';
    const dateStr = formatDate(a.publishedAt);
    const summary = a.summary ? `<p style="font-size:13px;color:#94A3B8;margin:4px 0 8px;line-height:1.5">${esc(a.summary)}</p>` : '';
    return `
    <article style="border:1px solid #30363d;border-radius:8px;padding:16px;background:#0D1117">
      ${imageHtml}
      <h3 style="font-size:14px;font-weight:700;margin:0 0 6px;line-height:1.4">
        <a href="${esc(a.link)}" rel="noopener noreferrer" style="color:#F8FAFC;text-decoration:none">${esc(a.title)}</a>
      </h3>
      ${summary}
      <small style="font-size:11px;color:#64748B">${esc(a.source)}${dateStr ? ' &middot; ' + dateStr : ''}</small>
    </article>`;
  }).join('\n');

  const generatedAt = feedData.generatedAt ? new Date(feedData.generatedAt).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '';
  const generatedComment = generatedAt ? ` (generated ${generatedAt})` : '';

  const injectedHtml = `
  <!-- Latest articles from ${articles.length} of ${feedData.articleCount || articles.length} cached stories${generatedComment} -->
  <section id="seoLatestFallback" class="seo-latest-articles" aria-label="Latest developer news (SEO fallback)" style="margin-top:24px">
    <h2 style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:#06B6D4;margin-bottom:16px">
      Latest Developer News
    </h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
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
  console.log(`[generate-seo-content] ✓ Injected ${articles.length} latest articles into index.html.`);
}

main().catch(err => { console.error('[generate-seo-content] ✗', err); process.exit(1); });

