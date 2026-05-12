/**
 * scripts/generate-sitemap.mjs
 *
 * Generates sitemap.xml from data/feeds.json so it always stays
 * in sync with the active feed list.
 *
 * Run: node scripts/generate-sitemap.mjs
 * Requires Node 18+.
 */

import fs   from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const TODAY     = new Date().toISOString().slice(0, 10);
const BASE_URL  = 'https://geekspulse.dev';

async function main() {
  // Load feeds
  const feedsRaw = await fs.readFile(path.join(ROOT, 'data', 'feeds.json'), 'utf8');
  const feedsData = JSON.parse(feedsRaw);
  const feeds = Array.isArray(feedsData) ? feedsData : (feedsData.feeds || []);
  const activeFeedsCount = feeds.filter(f => f.enabled !== false).length;

  // Collect unique categories from active feeds
  const categories = [...new Set(
    feeds.filter(f => f.enabled !== false).map(f => f.category).filter(Boolean)
  )];

  function url(loc, priority, changefreq = 'daily') {
    return `
  <url>
    <loc>${BASE_URL}${loc}</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  }

  const lines = [];

  // Homepage
  lines.push(`
  <!-- Homepage — aggregates all ${activeFeedsCount} RSS feeds -->
  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
    <image:image>
      <image:loc>${BASE_URL}/og-image.png</image:loc>
      <image:title>GeeksPulse — Developer News Aggregator</image:title>
      <image:caption>Developer news from ${activeFeedsCount} curated RSS feeds. No ads, no paywalls, no ad trackers.</image:caption>
    </image:image>
  </url>`);

  // Category pages
  lines.push('\n  <!-- ── Category pages ──────────────────────────────────────── -->');
  for (const cat of categories) {
    const isWeekly = ['Rust', 'Go'].includes(cat);
    lines.push(url(`/?filter=${encodeURIComponent(cat)}`, '0.8', isWeekly ? 'weekly' : 'daily'));
  }

  // Individual source pages
  lines.push('\n  <!-- ── Individual feed source pages ───────────────────────── -->');
  for (const feed of feeds.filter(f => f.enabled !== false)) {
    const isWeekly = ['Rust', 'Go'].includes(feed.category);
    lines.push(url(`/?source=${encodeURIComponent(feed.name)}`, '0.6', isWeekly ? 'weekly' : 'daily'));
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
${lines.join('')}

</urlset>
`;

  await fs.writeFile(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
  console.log(`[generate-sitemap] ✓ sitemap.xml written — ${activeFeedsCount} feeds, ${categories.length} categories, ${feeds.filter(f => f.enabled !== false).length} source pages.`);
}

main().catch(err => { console.error('[generate-sitemap] ✗', err); process.exit(1); });

