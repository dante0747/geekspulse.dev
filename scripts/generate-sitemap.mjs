/**
 * scripts/generate-sitemap.mjs
 *
 * Generates a minimal sitemap.xml containing only real canonical pages.
 * Query-param URLs like /?filter= and /?source= are NOT included because
 * they are client-side filters, not server-rendered static pages.
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
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">

  <!-- Homepage — aggregates all curated RSS feeds -->
  <url>
    <loc>${BASE_URL}/</loc>
    <lastmod>${TODAY}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
    <image:image>
      <image:loc>${BASE_URL}/og-image.png</image:loc>
      <image:title>GeeksPulse — Developer News Aggregator</image:title>
      <image:caption>Developer news from curated RSS feeds. No ads, no paywalls, no ad trackers.</image:caption>
    </image:image>
  </url>

</urlset>
`;

  await fs.writeFile(path.join(ROOT, 'sitemap.xml'), xml, 'utf8');
  console.log(`[generate-sitemap] ✓ sitemap.xml written — homepage only (${TODAY}).`);
}

main().catch(err => { console.error('[generate-sitemap] ✗', err); process.exit(1); });

