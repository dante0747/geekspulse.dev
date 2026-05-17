/**
 * scripts/build-feed.mjs
 *
 * Fetches all enabled RSS/Atom feeds from data/feeds.json,
 * normalises articles, deduplicates, and writes:
 *   public/feed.json        — full article cache consumed by the browser
 *   public/feed-health.json — per-feed health report
 *
 * Run: node scripts/build-feed.mjs
 * Requires Node 18+ (native fetch + crypto).
 */

import fs   from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { XMLParser } from 'fast-xml-parser';
import { Ollama } from 'ollama';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, '..');

const FEED_TIMEOUT_MS  = 10_000;
const ARTICLE_TIMEOUT_MS = 8_000;
const ARTICLE_FETCH_CONCURRENCY = 8;
const MAX_PER_FEED     = 15;
const MAX_ARTICLES     = 300;
const USER_AGENT       = 'GeeksPulse/1.0 (+https://geekspulse.dev; feed-bot)';

const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseTagValue: true,
  trimValues: true,
  processEntities: false,
  htmlEntities: false,
  stopNodes: ['*.description', '*.content', '*.content:encoded', '*.summary'],
});

// ── Category fallback image paths ─────────────────────────────────────────
const CATEGORY_FALLBACK_IMAGES = {
  'General':     '/assets/fallbacks/general.svg',
  'Security':    '/assets/fallbacks/security.svg',
  'AI':          '/assets/fallbacks/ai.svg',
  'Python':      '/assets/fallbacks/python.svg',
  'JavaScript':  '/assets/fallbacks/javascript.svg',
  'DevOps':      '/assets/fallbacks/devops.svg',
  'Open Source': '/assets/fallbacks/open-source.svg',
  'Java':        '/assets/fallbacks/java.svg',
  'Rust':        '/assets/fallbacks/rust.svg',
  'Go':          '/assets/fallbacks/go.svg',
  'Architecture': '/assets/fallbacks/architecture.svg',
};

function getFallbackImage(category) {
  return CATEGORY_FALLBACK_IMAGES[category] || CATEGORY_FALLBACK_IMAGES['General'];
}

// ── Article classifier ────────────────────────────────────────────────────
// Tier 1: keyword rules (always works, zero dependencies)
const CATEGORY_KEYWORDS = {
  'Security':    /\b(CVE|vulnerability|exploit|malware|ransomware|phishing|zero.?day|breach|hack|XSS|SQL.?injection|OWASP|pentest|infosec|cybersecurity|SAST|DAST|threat|patch|firewall|authentication|OAuth|JWT)\b/i,
  'AI':          /\b(AI\b|LLM|GPT|machine.?learning|deep.?learning|neural.?net|transformer|diffusion|ChatGPT|Gemini|Claude|Llama|Mistral|RAG|embedding|fine.?tun|artificial.?intelligence|generative|copilot|agentic|Ollama)\b/i,
  'Python':      /\b(Python|Django|Flask|FastAPI|pip|PyPI|pandas|numpy|scipy|jupyter|pydantic|SQLAlchemy|uv\b|ruff|pytest)\b/i,
  'JavaScript':  /\b(JavaScript|TypeScript|Node\.?js|React|Vue|Angular|Svelte|Next\.?js|Nuxt|Deno|Bun\b|npm|webpack|vite|esbuild|ESM|JSX|TSX)\b/i,
  'Java':        /\b(Java\b|Spring|Maven|Gradle|JVM|Kotlin|Quarkus|Micronaut|Jakarta|JDK|Hibernate)\b/i,
  'DevOps':      /\b(Docker|Kubernetes|k8s|CI\/CD|GitHub.?Actions|Jenkins|ArgoCD|Terraform|Ansible|Helm|AWS|Azure|GCP|cloud|DevOps|SRE|observability|Prometheus|Grafana|OpenTelemetry)\b/i,
  'Rust':        /\b(Rust\b|cargo\b|crate\b|Tokio|rustup|rustc|borrow.?checker|WebAssembly|WASM)\b/i,
  'Go':          /\b(Golang|Go lang|goroutine|gopher|pkg\.go\.dev)\b/i,
  'Architecture':/\b(microservice|monolith|event.?driven|CQRS|DDD|domain.?driven|API.?design|GraphQL|gRPC|system.?design|distributed|serverless|hexagonal|clean.?arch)\b/i,
  'Open Source': /\b(open.?source|OSS|FOSS|MIT license|Apache license|GPL|maintainer)\b/i,
};

function keywordClassify(title = '', summary = '', feedCategory = 'General') {
  const text = `${title} ${summary}`;
  for (const [cat, re] of Object.entries(CATEGORY_KEYWORDS)) {
    if (re.test(text)) return cat;
  }
  return feedCategory;
}

// Tier 2: Ollama local LLM (used in CI via GitHub Actions, optional locally)
const OLLAMA_MODEL  = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';
const OLLAMA_HOST   = process.env.OLLAMA_HOST  || 'http://127.0.0.1:11434';
const USE_LLM       = process.env.USE_LLM === '1';
const VALID_CATS    = ['General','Security','AI','Python','JavaScript','Java','DevOps','Open Source','Rust','Go','Architecture'];
const CACHE_FILE    = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.ai-category-cache.json');

let ollamaClient = null;
let aiCache      = {};

async function initClassifier() {
  // Always load the committed cache
  try { aiCache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')); } catch { aiCache = {}; }
  if (!USE_LLM) return;
  try {
    ollamaClient = new Ollama({ host: OLLAMA_HOST });
    await ollamaClient.list(); // ping — throws if Ollama isn't running
    console.log(`[classifier] Ollama online — using model ${OLLAMA_MODEL}`);
  } catch {
    console.warn('[classifier] Ollama not reachable — falling back to keyword classifier.');
    ollamaClient = null;
  }
}

async function saveCache() {
  await fs.writeFile(CACHE_FILE, JSON.stringify(aiCache, null, 2), 'utf8');
}

// ── Article summarizer ────────────────────────────────────────────────────
// Used when the RSS feed provides no snippet or a very short one (<40 chars).
const MIN_SUMMARY_LEN = 40;
const ARTICLE_TEXT_MAX_BYTES = 512 * 1024; // 512 KB cap when fetching article body
const ARTICLE_TEXT_MAX_CHARS = 3000;       // chars of body text fed to the LLM

/** Fetch an article page and return plain-text body content (best-effort). */
async function fetchArticleText(articleUrl) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), ARTICLE_TIMEOUT_MS);
  try {
    const resp = await fetch(articleUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!resp.ok) return null;

    const reader  = resp.body?.getReader?.();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder('utf-8');
      let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        html += decoder.decode(value, { stream: true });
        if (bytes >= ARTICLE_TEXT_MAX_BYTES) {
          try { reader.cancel(); } catch { /* ignore */ }
          break;
        }
      }
      html += decoder.decode();
    } else {
      html = await resp.text();
    }

    if (!html) return null;

    // Extract <body> if present, otherwise use the full HTML
    const bodyMatch = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    const bodyHtml  = bodyMatch ? bodyMatch[1] : html;

    // Strip scripts, styles, nav, footer, aside, then all tags → plain text
    const text = bodyHtml
      .replace(/<(script|style|nav|footer|aside|header)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g,  '&')
      .replace(/&lt;/g,   '<')
      .replace(/&gt;/g,   '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g,  "'")
      .replace(/\s+/g, ' ')
      .trim();

    return text.slice(0, ARTICLE_TEXT_MAX_CHARS) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function summarizeArticle(title = '', existingSummary = '', articleUrl = '') {
  if (!ollamaClient) return existingSummary;
  if (existingSummary.length >= MIN_SUMMARY_LEN) return existingSummary;

  const cacheKey = `summary::${title.slice(0, 120)}`;
  if (aiCache[cacheKey]) return aiCache[cacheKey];

  try {
    // Try to fetch the full article text; fall back to the RSS snippet
    let bodyText = articleUrl ? await fetchArticleText(articleUrl) : null;
    if (!bodyText && existingSummary) bodyText = existingSummary;

    const articleText = bodyText
      ? `Title: ${title}\n\nArticle content:\n${bodyText}`
      : `Title: ${title}`;

    const prompt =
      `You are a technical news editor writing for a developer audience.\n` +
      `Write a concise 2–3 sentence summary (max 60 words) of the article below.\n` +
      `Focus on: the core topic, the key technology or finding, and why it matters to developers.\n` +
      `Do NOT start with "This article", "The article", or simply restate the title.\n` +
      `Reply with only the summary text — no quotes, no bullet points, no labels.\n\n` +
      `${articleText}`;

    const resp = await ollamaClient.generate({
      model: OLLAMA_MODEL, prompt, stream: false,
      options: { temperature: 0.3, num_predict: 120 },
    });
    const summary = (resp.response || '').trim().replace(/^["']|["']$/g, '');
    if (summary.length > 10) {
      aiCache[cacheKey] = summary;
      return summary;
    }
  } catch (e) {
    console.warn(`[classifier] summarize failed for "${title.slice(0, 50)}": ${e.message}`);
  }
  return existingSummary;
}

async function classifyArticle(title = '', summary = '', feedCategory = 'General') {
  // 1. Check committed cache first
  const cacheKey = title.slice(0, 120);
  if (aiCache[cacheKey]) return aiCache[cacheKey];

  // 2. Keyword classifier (always available, instant)
  const kwResult = keywordClassify(title, summary, feedCategory);

  // 3. LLM override for ambiguous cases (only if Ollama is running)
  if (ollamaClient) {
    try {
      const prompt =
        `Classify this developer news article into EXACTLY ONE of these categories:\n` +
        `${VALID_CATS.join(', ')}\n\n` +
        `Title: ${title}\nSnippet: ${summary.slice(0, 200)}\n\n` +
        `Reply with only the category name, nothing else.`;
      const resp = await ollamaClient.generate({ model: OLLAMA_MODEL, prompt, stream: false,
        options: { temperature: 0, num_predict: 10 } });
      const raw = (resp.response || '').trim();
      const match = VALID_CATS.find(c => raw.toLowerCase().startsWith(c.toLowerCase()));
      const result = match || kwResult;
      aiCache[cacheKey] = result;
      return result;
    } catch (e) {
      console.warn(`[classifier] LLM call failed for "${title.slice(0,50)}": ${e.message}`);
    }
  }

  // 4. Fall back to keyword result (not cached — don't pollute cache with keyword results)
  return kwResult;
}

// ── Utilities ──────────────────────────────────────────────────────────────

function hashId(input) {
  return createHash('sha1').update(input).digest('hex').slice(0, 12);
}

function normalizeUrl(url) {
  if (!url) return null;
  try {
    // Decode HTML entities before parsing (feeds often encode & as &amp;)
    const decoded = String(url.trim())
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
    const u = new URL(decoded);
    if (!['http:', 'https:'].includes(u.protocol)) return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function stripHtml(html) {
  if (!html) return '';
  // Step 1: handle objects from the XML parser (e.g. { '#text': '...', '@_type': 'html' })
  let s = typeof html === 'object' && html !== null
    ? (html['#text'] || html['#cdata-section'] || '')
    : String(html);
  // Step 2: strip CDATA wrappers
  s = s.replace(/<!\[CDATA\[|\]\]>/g, '');
  // Step 3: decode HTML entities BEFORE stripping tags (some feeds entity-encode their HTML)
  s = s
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&amp;/g,  '&');
  // Step 4: strip script/style blocks, then img, figure, figcaption, then all remaining tags
  s = s
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/<figure[\s\S]*?<\/figure>/gi, '')
    .replace(/<figcaption[\s\S]*?<\/figcaption>/gi, '')
    .replace(/<[^>]+>/g, ' ');
  // Step 5: clean up whitespace and low-value trailing noise
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/\bComments\b\s*$/i, '')
    .replace(/\bRead more\b\.?\s*$/i, '')
    .replace(/\bContinue reading\b\.?\s*$/i, '')
    .replace(/\bView article\b\.?\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

function truncate(str, n = 220) {
  const s = (str || '').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function normalizeDate(raw) {
  if (!raw) return null;
  try {
    const d = new Date(String(raw).trim());
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

// ── Image extraction ───────────────────────────────────────────────────────

const BAD_PATH_PATTERNS = [
  'rss', 'logo', 'logos', 'icon', 'icons', 'favicon', 'avatar', 'avatars',
  'sprite', 'sprites', 'pixel', 'tracking', 'badge', 'badges',
  'placeholder', 'spacer', '1x1', 'blank', 'beacon', 'counter',
  'feedburner', 'feedproxy', 'analytics', 'stats', 'doubleclick',
  'googlesyndication', 'adservice', 'adsystem', 'quantserve',
  'chartbeat', 'scorecardresearch', 'gravatar', 'profile', 'author',
  'apple-touch', 'android-chrome', 'mstile',
  // Decorative layout corner/border images (e.g. LWN lcorner-ss.png)
  'lcorner', 'rcorner', 'corner', 'lcorner-ss',
];
const BAD_HOSTNAME_RE = /\b(feedburner|feedproxy|gravatar|doubleclick|googlesyndication|adservice|adsystem|quantserve|chartbeat|scorecardresearch)\b/i;
const TINY_SIZE_RE = /[_\-x×](?:16|32|48|64)(?:x|×|px|_|\b)/i;
// Specific blocked image URL patterns (checked against full URL)
const BAD_URL_RE = /static\.lwn\.net\/images\/l?corner/i;
const IMG_EXT    = /\.(jpe?g|png|webp|avif)(\?|$)/i;

function isBadImageUrl(url) {
  if (!url) return true;
  if (url.startsWith('data:')) return true;
  if (/\.svg(\?|$)/i.test(url)) return true;
  if (TINY_SIZE_RE.test(url)) return true;
  if (BAD_URL_RE.test(url)) return true;
  try {
    const u = new URL(url);
    if (BAD_HOSTNAME_RE.test(u.hostname)) return true;
    // Split path into segments and check each segment against known bad tokens
    const pathLower = u.pathname.toLowerCase();
    // Check if any segment or word in the path matches a bad pattern
    const segments = pathLower.split(/[/\-_.]+/).filter(Boolean);
    if (segments.some(seg => BAD_PATH_PATTERNS.includes(seg))) return true;
    // Also check for patterns as substrings in full path (catches compound names like "rss-32px")
    if (BAD_PATH_PATTERNS.some(p => pathLower.includes('/' + p + '/') || pathLower.endsWith('/' + p))) return true;
  } catch { /* keep */ }
  return false;
}

function scoreImage(url, source, w = 0, h = 0) {
  let score = 0;
  if (source === 'media:content' || source === 'media:thumbnail') score += 20;
  else if (source === 'enclosure') score += 15;
  else if (source === 'html-img')    score += 8;   // inline images in article HTML
  else if (source === 'html-srcset') score += 6;   // srcset images in article HTML
  if (IMG_EXT.test(url)) score += 10;
  if (w > 0 && h > 0) {
    score += Math.min(w * h, 800_000) / 12_000;
    const r = w / h;
    if (r < 0.5 || r > 4) score -= 8;
    if (r >= 1.2 && r <= 2.0) score += 5;
    // Penalise tiny images (likely icons/thumbnails)
    if (w < 200 || h < 100) score -= 12;
  }
  if (/\/(image|img|photo|thumb|hero|featured|cover|banner|post|article|upload|media|content)\b/i.test(url)) score += 6;
  if (isBadImageUrl(url)) score -= 30;
  return score;
}

/** Decode HTML entities in a URL string. */
function decodeHtmlEntities(str) {
  return String(str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Extract <img> URLs from an HTML string using regex (no DOM available in Node). */
function extractImagesFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const results = [];

  const imgRe = /<img\b[^>]+>/gi;
  let imgMatch;
  while ((imgMatch = imgRe.exec(html)) !== null) {
    const tag = imgMatch[0];

    const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    if (srcMatch) {
      const url = normalizeUrl(decodeHtmlEntities(srcMatch[1].trim()));
      const wMatch = tag.match(/\bwidth\s*=\s*["']?(\d+)/i);
      const hMatch = tag.match(/\bheight\s*=\s*["']?(\d+)/i);
      const w = wMatch ? parseInt(wMatch[1], 10) : 0;
      const h = hMatch ? parseInt(hMatch[1], 10) : 0;
      if (url && !isBadImageUrl(url)) {
        results.push({ url, source: 'html-img', w, h });
      }
    }

    const srcsetMatch = tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i);
    if (srcsetMatch) {
      const parts = srcsetMatch[1].split(',')
        .map(p => decodeHtmlEntities(p.trim().split(/\s+/)[0]))
        .filter(Boolean);
      const best = normalizeUrl(parts[parts.length - 1]);
      if (best && !isBadImageUrl(best)) {
        results.push({ url: best, source: 'html-srcset', w: 0, h: 0 });
      }
    }
  }

  return results;
}

function extractBestImage(item) {
  const candidates = [];

  // 1. media:content / media:thumbnail (highest confidence)
  for (const key of ['media:content', 'media:thumbnail']) {
    const node = item[key];
    if (node) {
      const nodes = Array.isArray(node) ? node : [node];
      for (const n of nodes) {
        const rawUrl = n['@_url'];
        const url = normalizeUrl(decodeHtmlEntities(rawUrl || ''));
        if (url && !isBadImageUrl(url)) {
          const w = parseInt(n['@_width']  || 0, 10) || 0;
          const h = parseInt(n['@_height'] || 0, 10) || 0;
          candidates.push({ url, source: key, w, h });
        }
      }
    }
  }

  // 2. RSS enclosure
  const enc = item.enclosure;
  if (enc) {
    const encNodes = Array.isArray(enc) ? enc : [enc];
    for (const e of encNodes) {
      const t = e['@_type'] || '';
      const rawU = e['@_url']  || '';
      const u = normalizeUrl(decodeHtmlEntities(rawU)) || rawU;
      if ((t.startsWith('image/') || IMG_EXT.test(u)) && !isBadImageUrl(u)) {
        candidates.push({ url: u, source: 'enclosure', w: 0, h: 0 });
      }
    }
  }

  // 3. Mine HTML payloads: content:encoded first (richer), then description/summary
  const htmlSources = [
    item['content:encoded'],
    item.content?.['#text'] || item.content,
    item.description,
    item.summary?.['#text'] || item.summary,
  ].filter(s => s && typeof s === 'string');

  for (const html of htmlSources) {
    candidates.push(...extractImagesFromHtml(html));
  }

  if (!candidates.length) return null;

  const scored = candidates
    .map(c => ({ ...c, score: scoreImage(c.url, c.source, c.w, c.h) }))
    .sort((a, b) => b.score - a.score);

  return scored[0]?.score > 0 ? scored[0].url : null;
}

// ── Feed parsers ───────────────────────────────────────────────────────────
// ── Article-page image resolver (Node-side; no CORS limits) ────────────────

/** Extract the first matching <meta>/<link> attribute from raw HTML. */
function extractMetaUrl(html, attr, valueRe) {
  if (!html) return null;
  // Match e.g. <meta property="og:image" content="..."> in any attribute order
  const re = new RegExp(
    `<(?:meta|link)\\b[^>]*\\b${attr}\\s*=\\s*["']${valueRe.source}["'][^>]*>`,
    'i'
  );
  const m = html.match(re);
  if (!m) return null;
  const tag = m[0];
  // Pull content="..." or href="..." from the matched tag
  const c = tag.match(/\b(?:content|href)\s*=\s*["']([^"']+)["']/i);
  return c ? decodeHtmlEntities(c[1]) : null;
}

/** Resolve a relative URL against a base; return null on failure. */
function absUrl(url, base) {
  if (!url) return null;
  try { return new URL(url, base).href; } catch { return null; }
}

/** Fetch an article page and extract og:image / twitter:image / first body <img>. */
async function fetchArticleImage(articleUrl) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), ARTICLE_TIMEOUT_MS);
  try {
    const resp = await fetch(articleUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (!resp.ok) return null;
    // Cap body size — we only need the head for OG tags
    const reader = resp.body?.getReader?.();
    let html = '';
    if (reader) {
      const decoder = new TextDecoder('utf-8');
      let bytes = 0;
      const MAX_BYTES = 256 * 1024; // 256 KB is plenty for <head>
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        html += decoder.decode(value, { stream: true });
        if (bytes >= MAX_BYTES || /<\/head>/i.test(html)) {
          try { reader.cancel(); } catch { /* ignore */ }
          break;
        }
      }
      html += decoder.decode();
    } else {
      html = await resp.text();
    }

    if (!html) return null;
    const finalUrl = resp.url || articleUrl;

    // Try OG / Twitter / image_src in priority order
    const metaCandidates = [
      extractMetaUrl(html, 'property', /og:image:secure_url/),
      extractMetaUrl(html, 'property', /og:image:url/),
      extractMetaUrl(html, 'property', /og:image/),
      extractMetaUrl(html, 'name',     /twitter:image:src/),
      extractMetaUrl(html, 'name',     /twitter:image/),
      extractMetaUrl(html, 'rel',      /image_src/),
    ];

    for (const raw of metaCandidates) {
      if (!raw) continue;
      const u = normalizeUrl(absUrl(raw, finalUrl));
      if (u && !isBadImageUrl(u)) return u;
    }

    // Fallback: first decent <img> in <body>
    const bodyMatch = html.match(/<body\b[\s\S]*$/i);
    const bodyHtml  = bodyMatch ? bodyMatch[0] : html;
    const bodyImgs  = extractImagesFromHtml(bodyHtml);
    for (const c of bodyImgs) {
      const u = normalizeUrl(absUrl(c.url, finalUrl));
      if (!u || isBadImageUrl(u)) continue;
      // Skip obviously tiny images
      if ((c.w && c.w < 200) || (c.h && c.h < 100)) continue;
      return u;
    }

    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Run an async worker over items with bounded concurrency. */
async function runLimited(items, limit, worker) {
  const queue = items.slice();
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(workers);
}

// ── Feed parsers ───────────────────────────────────────────────────────────
function parseRssItems(parsed, feed) {
  const channel = parsed?.rss?.channel || parsed?.channel;
  if (!channel) return [];
  const rawItems = channel.item || [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items.slice(0, MAX_PER_FEED).map(item => {
    const link = normalizeUrl(
      item.link || item.guid?.['#text'] || item.guid || ''
    );
    if (!link) return null;

    const title   = stripHtml(item.title || 'Untitled');
    const desc    = item['content:encoded'] || item.description || item.summary || '';
    const rawSnippet = truncate(stripHtml(desc));
    const summary = isLowValueSnippet(rawSnippet) ? '' : rawSnippet;
    const date    = normalizeDate(item.pubDate || item.published || item.updated);
    const image   = extractBestImage(item);

    return { id: hashId(link), title, link, source: feed.name, sourceId: feed.id, category: feed.category, publishedAt: date, summary, image, fallbackImage: getFallbackImage(feed.category), imageType: image ? 'real' : 'fallback', fetchedAt: new Date().toISOString() };
  }).filter(Boolean);
}

function parseAtomEntries(parsed, feed) {
  const root  = parsed?.feed;
  if (!root) return [];
  const rawEntries = root.entry || [];
  const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

  return entries.slice(0, MAX_PER_FEED).map(entry => {
    let link = null;
    const linkNode = entry.link;
    if (linkNode) {
      const links = Array.isArray(linkNode) ? linkNode : [linkNode];
      const alt  = links.find(l => l['@_rel'] === 'alternate' || !l['@_rel']);
      link = normalizeUrl(alt?.['@_href'] || alt?.['#text'] || '');
    }
    if (!link) link = normalizeUrl(entry.id || '');
    if (!link) return null;

    const title   = stripHtml(entry.title?.['#text'] || entry.title || 'Untitled');
    const desc    = entry.content?.['#text'] || entry.content || entry.summary?.['#text'] || entry.summary || '';
    const rawSnippet = truncate(stripHtml(desc));
    const summary = isLowValueSnippet(rawSnippet) ? '' : rawSnippet;
    const date    = normalizeDate(entry.updated || entry.published);
    const image   = extractBestImage(entry);

    return { id: hashId(link), title, link, source: feed.name, sourceId: feed.id, category: feed.category, publishedAt: date, summary, image, fallbackImage: getFallbackImage(feed.category), imageType: image ? 'real' : 'fallback', fetchedAt: new Date().toISOString() };
  }).filter(Boolean);
}

function parseFeedXml(xml, feed) {
  const parsed = XML_PARSER.parse(xml);
  const rssItems  = parseRssItems(parsed, feed);
  if (rssItems.length) return rssItems;
  return parseAtomEntries(parsed, feed);
}

// ── Fetch one feed ─────────────────────────────────────────────────────────

async function fetchOneFeed(feed) {
  const controller = new AbortController();
  const timeout    = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
  try {
    const resp = await fetch(feed.url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    return { feed, articles: parseFeedXml(xml, feed), ok: true };
  } catch (err) {
    return { feed, articles: [], ok: false, error: err.message };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  await initClassifier();

  const feedsPath = path.join(ROOT, 'data', 'feeds.json');
  const feedDefs  = JSON.parse(await fs.readFile(feedsPath, 'utf8'));
  const enabled   = feedDefs.filter(f => f.enabled !== false);

  console.log(`[build-feed] Fetching ${enabled.length} feeds…`);

  const results = await Promise.allSettled(enabled.map(fetchOneFeed));

  const allArticles = [];
  const health      = [];

  for (const result of results) {
    if (result.status === 'rejected') continue;
    const { feed, articles, ok, error } = result.value;
    health.push({ id: feed.id, name: feed.name, category: feed.category, ok, error: error || null, count: articles.length, fetchedAt: new Date().toISOString() });
    if (ok) allArticles.push(...articles);
    console.log(`  ${ok ? '✓' : '✗'} ${feed.name} — ${articles.length} articles${ok ? '' : ` (${error})`}`);
  }

  // Deduplicate by link
  const seen = new Set();
  const unique = allArticles.filter(a => {
    if (seen.has(a.link)) return false;
    seen.add(a.link);
    return true;
  });

  // Sort newest-first; undated go last
  unique.sort((a, b) => {
    const da = a.publishedAt ? new Date(a.publishedAt) : null;
    const db = b.publishedAt ? new Date(b.publishedAt) : null;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db - da;
  });

  const articles = unique.slice(0, MAX_ARTICLES);

  // ── AI / keyword article classification ───────────────────────────────────
  if (ollamaClient || true) { // keyword classifier always runs
    console.log(`[build-feed] Classifying ${articles.length} articles…`);
    let llmHits = 0;
    await runLimited(articles, 4, async a => {
      const prev = a.category;
      a.category = await classifyArticle(a.title, a.summary || '', a.category);
      a.fallbackImage = getFallbackImage(a.category);
      if (ollamaClient && a.category !== prev) llmHits++;
    });
    if (ollamaClient) {
      console.log(`[build-feed]   ↳ LLM reclassified ${llmHits}/${articles.length} articles`);
      await saveCache();
      console.log(`[build-feed]   ↳ Cache saved to .ai-category-cache.json`);
    }
  }

  // ── AI article summarization (fills missing/short snippets) ──────────────
  if (ollamaClient) {
    const needSummary = articles.filter(a => (a.summary || '').length < MIN_SUMMARY_LEN);
    console.log(`[build-feed] Summarizing ${needSummary.length} articles with missing/short snippets…`);
    let summarized = 0;
    await runLimited(needSummary, 4, async a => {
      const result = await summarizeArticle(a.title, a.summary || '', a.link);
      if (result && result !== a.summary) { a.summary = result; summarized++; }
    });
    console.log(`[build-feed]   ↳ Generated ${summarized} new summaries`);
    await saveCache();
  }

  // ── Resolve missing images by fetching the article page (Node has no CORS) ──
  const needImage = articles.filter(a => !a.image && a.link);
  if (needImage.length) {
    console.log(`[build-feed] Resolving og:image for ${needImage.length} articles…`);
    let resolved = 0;
    await runLimited(needImage, ARTICLE_FETCH_CONCURRENCY, async a => {
      const img = await fetchArticleImage(a.link);
      if (img) {
        a.image = img;
        a.imageType = 'real';
        resolved++;
      }
    });
    console.log(`[build-feed]   ↳ filled ${resolved}/${needImage.length} (${Math.round(resolved / needImage.length * 100)}%)`);
  }

  const failedCount  = health.filter(h => !h.ok).length;
  const successCount = health.filter(h => h.ok).length;

  const feedJson = {
    generatedAt: new Date().toISOString(),
    feedCount: enabled.length,
    articleCount: articles.length,
    successFeeds: successCount,
    failedFeeds: failedCount,
    articles,
  };

  const healthJson = { generatedAt: new Date().toISOString(), feeds: health };

  const publicDir = path.join(ROOT, 'public');
  await fs.mkdir(publicDir, { recursive: true });
  await fs.writeFile(path.join(publicDir, 'feed.json'),        JSON.stringify(feedJson,  null, 2), 'utf8');
  await fs.writeFile(path.join(publicDir, 'feed-health.json'), JSON.stringify(healthJson, null, 2), 'utf8');

  // ── Patch README badge so feed count stays in sync ──────────────────────
  const readmePath = path.join(ROOT, 'README.md');
  try {
    let readme = await fs.readFile(readmePath, 'utf8');
    // Replace the RSS_feeds badge count, e.g. RSS_feeds-32- → RSS_feeds-33-
    readme = readme.replace(
      /RSS_feeds-\d+-/,
      `RSS_feeds-${enabled.length}-`
    );
    // Replace the terminal block feed count line, e.g. "# 32 feeds · ..."
    readme = readme.replace(
      /# \d+ feeds · 0 paywalls · 100% signal/,
      `# ${enabled.length} feeds · 0 paywalls · 100% signal`
    );
    await fs.writeFile(readmePath, readme, 'utf8');
    console.log(`[build-feed] README badge updated to ${enabled.length} feeds.`);
  } catch (e) {
    console.warn('[build-feed] Could not patch README badge:', e.message);
  }

  console.log(`\n[build-feed] Done. ${articles.length} articles from ${successCount}/${enabled.length} feeds.`);
  console.log(`  Wrote public/feed.json and public/feed-health.json`);
}

main().catch(err => { console.error('[build-feed] Fatal:', err); process.exit(1); });

