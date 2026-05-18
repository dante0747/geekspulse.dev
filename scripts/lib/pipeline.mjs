/**
 * scripts/lib/pipeline.mjs
 * Article set transforms and the named pipeline pass functions.
 */

import {
  MIN_PER_CATEGORY, MAX_PER_CATEGORY,
  MIN_SUMMARY_LEN, ARTICLE_FETCH_CONCURRENCY,
} from './config.mjs';
import { getFallbackImage, runLimited } from './utils.mjs';
import { ollamaClient, saveCache }      from './ai.mjs';
import { classifyArticle }              from './classifier.mjs';
import { detectSponsored }              from './sponsored.mjs';
import { summarizeArticle }             from './summarizer.mjs';
import { fetchArticleImage }            from './images.mjs';

// ── Article set transforms ─────────────────────────────────────────────────

/**
 * Deduplicate by link — when the same URL appears in multiple feeds, keep the
 * version with the most specific category (non-General beats General) so that
 * articles aggregated by Planet Python / This Week in Rust / etc. aren't lost
 * just because they also appeared on Hacker News or Lobsters.
 */
export function deduplicateArticles(allArticles) {
  const seenLinks = new Map(); // link → index in result array
  const result    = [];
  for (const a of allArticles) {
    if (!seenLinks.has(a.link)) {
      seenLinks.set(a.link, result.length);
      result.push(a);
    } else if (a.category !== 'General') {
      // Replace an existing General entry with this more-specific one
      const idx = seenLinks.get(a.link);
      if (result[idx].category === 'General') result[idx] = a;
    }
  }
  return result;
}

/**
 * Guarantee a minimum number of articles per category before filling the rest
 * from the sorted pool. High-volume categories (General, Security, DevOps…)
 * can otherwise consume all slots before slower ones (Java, Rust, Go,
 * Architecture…) appear, leaving them with zero articles in the feed.
 */
export function guaranteeCategoryRepresentation(articles, minPerCat = MIN_PER_CATEGORY) {
  const buckets    = {};
  for (const a of articles) {
    (buckets[a.category] = buckets[a.category] || []).push(a);
  }
  const guaranteed = new Set();
  for (const bucket of Object.values(buckets)) {
    for (const a of bucket.slice(0, minPerCat)) guaranteed.add(a);
  }
  const result = [...guaranteed];
  for (const a of articles) {
    if (!guaranteed.has(a)) result.push(a);
  }
  return result;
}

/**
 * Drop articles once any single category has reached `maxPerCat` entries.
 * Applied after classification is finalised so high-volume feeds (e.g.
 * Security) cannot push other categories to zero.
 */
export function capByCategory(articles, maxPerCat = MAX_PER_CATEGORY) {
  const counts = {};
  const capped = [];
  for (const a of articles) {
    const n = (counts[a.category] = (counts[a.category] || 0) + 1);
    if (n <= maxPerCat) capped.push(a);
  }
  return capped;
}

// ── Pipeline passes ────────────────────────────────────────────────────────

/** Run keyword + optional LLM classification on every article in-place. */
export async function runClassificationPass(articles) {
  console.log(`[build-feed] Classifying ${articles.length} articles…`);
  let llmHits = 0;
  await runLimited(articles, 4, async a => {
    const prev      = a.category;
    a.category      = await classifyArticle(a.title, a.summary || '', a.category);
    a.fallbackImage = getFallbackImage(a.category);
    if (ollamaClient && a.category !== prev) llmHits++;
  });
  if (ollamaClient) {
    console.log(`[build-feed]   ↳ LLM reclassified ${llmHits}/${articles.length} articles`);
    await saveCache();
    console.log(`[build-feed]   ↳ Cache saved to .ai-category-cache.json`);
  }
}

/** Stamp sponsored:true on promotional articles (regex + optional LLM) in-place. */
export async function runSponsoredDetectionPass(articles) {
  let flagged = 0;
  await runLimited(articles, 4, async a => {
    if (await detectSponsored(a.title, a.summary || '')) {
      a.sponsored = true;
      flagged++;
    }
  });
  console.log(`[build-feed] Sponsored detection: ${flagged} article(s) flagged.`);
  if (ollamaClient) {
    await saveCache();
    console.log(`[build-feed]   ↳ Sponsored cache entries saved to .ai-category-cache.json`);
  }
}

/** Fill missing/short article summaries using the LLM (Ollama only). */
export async function runSummarizationPass(articles) {
  if (!ollamaClient) return;
  const needSummary = articles.filter(a => (a.summary || '').length < MIN_SUMMARY_LEN);
  console.log(`[build-feed] Summarizing ${needSummary.length} articles with missing/short snippets…`);
  let summarized = 0;
  await runLimited(needSummary, 4, async a => {
    const result = await summarizeArticle(a.title, a.summary || '', a.link);
    if (result && result !== a.summary) { a.summary = result; a.summaryType = 'ai'; summarized++; }
  });
  console.log(`[build-feed]   ↳ Generated ${summarized} new summaries`);
  await saveCache();
}

/** Resolve og:image for articles that have no image from the feed XML (Node has no CORS). */
export async function runImageResolutionPass(articles) {
  const needImage = articles.filter(a => !a.image && a.link);
  if (!needImage.length) return;
  console.log(`[build-feed] Resolving og:image for ${needImage.length} articles…`);
  let resolved = 0;
  await runLimited(needImage, ARTICLE_FETCH_CONCURRENCY, async a => {
    const img = await fetchArticleImage(a.link);
    if (img) { a.image = img; a.imageType = 'real'; resolved++; }
  });
  console.log(`[build-feed]   ↳ filled ${resolved}/${needImage.length} (${Math.round(resolved / needImage.length * 100)}%)`);
}

