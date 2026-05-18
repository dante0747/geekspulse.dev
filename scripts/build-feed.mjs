/**
 * scripts/build-feed.mjs
 *
 * Entry point — orchestrates the feed build pipeline.
 *
 * Fetches all enabled RSS/Atom feeds from data/feeds.json,
 * normalises articles, deduplicates, and writes:
 *   public/feed.json        — full article cache consumed by the browser
 *   public/feed-health.json — per-feed health report
 *
 * Run: node scripts/build-feed.mjs
 * Requires Node 18+ (native fetch + crypto).
 *
 * Module layout:
 *   lib/config.mjs      — constants, regex patterns, XML parser
 *   lib/utils.mjs       — pure helpers, streamHtml
 *   lib/ai.mjs          — Ollama client + shared AI cache
 *   lib/classifier.mjs  — keyword + LLM category classification
 *   lib/sponsored.mjs   — regex + LLM sponsored content detection
 *   lib/summarizer.mjs  — LLM article summarization
 *   lib/images.mjs      — image extraction + og:image resolution
 *   lib/parser.mjs      — RSS/Atom parsing + feed fetching
 *   lib/pipeline.mjs    — article set helpers + pipeline pass functions
 */

import fs   from 'node:fs/promises';
import path from 'node:path';

import { ROOT, MIN_PER_CATEGORY, MAX_PER_CATEGORY } from './lib/config.mjs';
import { newestFirst }    from './lib/utils.mjs';
import { initOllama }     from './lib/ai.mjs';
import { fetchOneFeed }   from './lib/parser.mjs';
import {
  deduplicateArticles,
  guaranteeCategoryRepresentation,
  capByCategory,
  runClassificationPass,
  runSponsoredDetectionPass,
  runSummarizationPass,
  runImageResolutionPass,
} from './lib/pipeline.mjs';

// ── Output writers ─────────────────────────────────────────────────────────

async function writeOutputFiles(publicDir, feedJson, healthJson) {
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'feed.json'),        JSON.stringify(feedJson,   null, 2), 'utf8');
  await fs.writeFile(path.join(publicDir, 'feed-health.json'), JSON.stringify(healthJson, null, 2), 'utf8');
}

async function patchReadme(rootDir, feedCount) {
  const readmePath = path.join(rootDir, 'README.md');
  try {
    let readme = await fs.readFile(readmePath, 'utf8');
    readme = readme
      .replace(/RSS_feeds-\d+-/,                            `RSS_feeds-${feedCount}-`)
      .replace(/# \d+ feeds · 0 paywalls · 100% signal/,    `# ${feedCount} feeds · 0 paywalls · 100% signal`);
    await fs.writeFile(readmePath, readme, 'utf8');
    console.log(`[build-feed] README badge updated to ${feedCount} feeds.`);
  } catch (e) {
    console.warn('[build-feed] Could not patch README badge:', e.message);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  await initOllama();

  // ── 1. Fetch all feeds ────────────────────────────────────────────────────
  const feedDefs = JSON.parse(await fs.readFile(path.join(ROOT, 'data', 'feeds.json'), 'utf8'));
  const enabled  = feedDefs.filter(f => f.enabled !== false);
  console.log(`[build-feed] Fetching ${enabled.length} feeds…`);

  const results     = await Promise.allSettled(enabled.map(fetchOneFeed));
  const allArticles = [];
  const health      = [];

  for (const result of results) {
    if (result.status === 'rejected') continue;
    const { feed, articles, ok, error } = result.value;
    health.push({
      id: feed.id, name: feed.name, category: feed.category,
      ok, error: error || null, count: articles.length,
      fetchedAt: new Date().toISOString(),
    });
    if (ok) allArticles.push(...articles);
    console.log(`  ${ok ? '✓' : '✗'} ${feed.name} — ${articles.length} articles${ok ? '' : ` (${error})`}`);
  }

  // ── 2. Deduplicate → sort → guarantee category representation ─────────────
  const deduped  = deduplicateArticles(allArticles).sort(newestFirst);
  const balanced = guaranteeCategoryRepresentation(deduped, MIN_PER_CATEGORY).sort(newestFirst);

  // ── 3. Classify (keyword always runs; LLM when Ollama is available) ────────
  await runClassificationPass(balanced);

  // ── 4. Cap over-represented categories (after classification is final) ──────
  const articles = capByCategory(balanced, MAX_PER_CATEGORY);
  const dropped  = balanced.length - articles.length;
  if (dropped > 0) {
    console.log(`[build-feed] Category cap: dropped ${dropped} over-represented articles (max ${MAX_PER_CATEGORY} per category).`);
  }

  // ── 5. AI passes: sponsored detection → summarization → image resolution ───
  await runSponsoredDetectionPass(articles);
  await runSummarizationPass(articles);
  await runImageResolutionPass(articles);

  // ── 6. Write output files ─────────────────────────────────────────────────
  const successCount = health.filter(h => h.ok).length;
  const failedCount  = health.filter(h => !h.ok).length;

  await writeOutputFiles(path.join(ROOT, 'public'), {
    generatedAt:  new Date().toISOString(),
    feedCount:    enabled.length,
    articleCount: articles.length,
    successFeeds: successCount,
    failedFeeds:  failedCount,
    articles,
  }, {
    generatedAt: new Date().toISOString(),
    feeds: health,
  });

  await patchReadme(ROOT, enabled.length);

  console.log(`\n[build-feed] Done. ${articles.length} articles from ${successCount}/${enabled.length} feeds.`);
  console.log(`  Wrote public/feed.json and public/feed-health.json`);
}

main().catch(err => { console.error('[build-feed] Fatal:', err); process.exit(1); });

