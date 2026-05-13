import { esc } from './utils.js';
import { fetchViaCorsProxy } from './http.js';

// ── Constants ─────────────────────────────────────────────────────

const IMAGE_CACHE_TTL            = 7 * 24 * 60 * 60 * 1000; // 7 days
const IMAGE_NEG_CACHE_TTL        = 6 * 60 * 60 * 1000;      // 6 h
export const IMAGE_METADATA_CONCURRENCY = 3;

const _IMG_EXT    = /\.(jpe?g|png|webp|avif)(\?|$)/i;
const _BAD_URL_RE = /\b(logo|icon|favicon|avatar|sprite|pixel|tracking|badge|placeholder|spacer|1x1|blank|beacon|counter|feedburner|feedproxy|analytics|stats|doubleclick|googlesyndication|adservice|adsystem|quantserve|chartbeat|scorecardresearch|feedblitz|mailchimp|list-manage|gravatar)\b/i;

// Prevents duplicate concurrent fetches
const resolvingImageUrls = new Set();

// ── URL normalisation & filtering ────────────────────────────────

export function normalizeImageUrl(url, baseUrl) {
  if (!url) return null;
  if (url.startsWith('data:')) return null;
  try {
    const abs = new URL(url, baseUrl || location.href);
    if (abs.protocol === 'http:' && location.protocol === 'https:') {
      abs.protocol = 'https:';
    }
    return abs.href;
  } catch { return null; }
}

export function isProbablyBadImageUrl(url) {
  if (!url) return true;
  const lower = String(url).toLowerCase();
  if (lower.startsWith('data:')) return true;
  if (lower.includes('base64')) return true;
  if (/\.svg(\?|$)/i.test(lower)) return true;
  try {
    const u = new URL(url, location.href);
    if (_BAD_URL_RE.test(u.hostname)) return true;
    if (_BAD_URL_RE.test(u.pathname)) return true;
  } catch { /* keep */ }
  return false;
}

// ── Scoring ───────────────────────────────────────────────────────

function scoreImageCandidate(candidate) {
  const { url, source, width: w, height: h } = candidate;
  let score = candidate.score || 0;

  if (source === 'og:image' || source === 'twitter:image') score += 30;
  else if (source === 'media:thumbnail' || source === 'media:content') score += 20;
  else if (source === 'enclosure' || source === 'itunes:image') score += 15;

  if (_IMG_EXT.test(url)) score += 10;

  if (w > 0 && h > 0) {
    score += Math.min(w * h, 1200000) / 8000;
    if (w < 400 && h < 200) score -= 20;
    const ratio = w / h;
    if (ratio < 0.5 || ratio > 4) score -= 8;
    if (ratio >= 1.2 && ratio <= 2.0) score += 5;
  }

  if (/\/(image|img|photo|thumb|hero|featured|cover|banner|post|article|upload|media|content)\b/i.test(url)) score += 6;
  if (isProbablyBadImageUrl(url)) score -= 30;

  return score;
}

// ── srcset parsing ────────────────────────────────────────────────

function parseSrcset(srcset, baseUrl) {
  return srcset
    .split(',')
    .map(part => part.trim())
    .map(part => {
      const pieces = part.split(/\s+/);
      const rawUrl = pieces[0];
      const descriptor = pieces[1] || '1x';
      if (!rawUrl) return null;
      let descriptorScore = 1;
      if (descriptor.endsWith('w')) {
        descriptorScore = parseInt(descriptor, 10);
      } else if (descriptor.endsWith('x')) {
        descriptorScore = parseFloat(descriptor) * 1000;
      }
      const url = normalizeImageUrl(rawUrl, baseUrl);
      if (!url) return null;
      return { url, descriptor, descriptorScore: Number.isFinite(descriptorScore) ? descriptorScore : 1 };
    })
    .filter(Boolean)
    .sort((a, b) => b.descriptorScore - a.descriptorScore);
}

// ── Candidate extraction ──────────────────────────────────────────

export function extractImageCandidatesFromHtml(html, baseUrl) {
  const candidates = [];
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  tmp.querySelectorAll('picture source[srcset]').forEach(src => {
    const parsed = parseSrcset(src.getAttribute('srcset') || '', baseUrl);
    if (parsed.length) {
      const url = parsed[0].url;
      if (!isProbablyBadImageUrl(url)) {
        candidates.push({ url, source: 'picture-source', width: 0, height: 0, score: 0 });
      }
    }
  });

  tmp.querySelectorAll('img[src]').forEach(img => {
    const rawSrc = img.getAttribute('src') || '';
    const url = normalizeImageUrl(rawSrc, baseUrl);
    if (!url || isProbablyBadImageUrl(url)) return;
    const w = parseInt(img.getAttribute('width')  || '0', 10) || 0;
    const h = parseInt(img.getAttribute('height') || '0', 10) || 0;
    const inFigure = !!img.closest('figure');
    candidates.push({ url, source: 'html-img', width: w, height: h, score: inFigure ? 8 : 0 });

    const srcset = img.getAttribute('srcset');
    if (srcset) {
      const parsed = parseSrcset(srcset, baseUrl);
      if (parsed.length && !isProbablyBadImageUrl(parsed[0].url)) {
        candidates.push({ url: parsed[0].url, source: 'html-srcset', width: 0, height: 0, score: 2 });
      }
    }
  });

  return candidates;
}

export function extractImageCandidatesFromFeedItem(el, descHtml, contentHtml) {
  const candidates = [];
  const mediaNS = 'http://search.yahoo.com/mrss/';

  for (const tag of ['content', 'thumbnail']) {
    const nodes = el.getElementsByTagNameNS(mediaNS, tag);
    for (let i = 0; i < nodes.length; i++) {
      const node   = nodes[i];
      const url    = node.getAttribute('url') || '';
      const medium = node.getAttribute('medium') || '';
      const w = parseInt(node.getAttribute('width')  || '0', 10) || 0;
      const h = parseInt(node.getAttribute('height') || '0', 10) || 0;
      if (url && !/^(audio|video)$/i.test(medium) && !isProbablyBadImageUrl(url)) {
        candidates.push({ url, source: tag === 'thumbnail' ? 'media:thumbnail' : 'media:content', width: w, height: h, score: 0 });
      }
    }
  }

  const enc = el.querySelector('enclosure');
  if (enc) {
    const t = enc.getAttribute('type') || '';
    const u = enc.getAttribute('url')  || '';
    if ((t.startsWith('image/') || _IMG_EXT.test(u)) && !isProbablyBadImageUrl(u)) {
      candidates.push({ url: u, source: 'enclosure', width: 0, height: 0, score: 0 });
    }
  }

  el.querySelectorAll('link[rel="enclosure"]').forEach(link => {
    const t = link.getAttribute('type')  || '';
    const u = link.getAttribute('href')  || '';
    if ((t.startsWith('image/') || _IMG_EXT.test(u)) && !isProbablyBadImageUrl(u)) {
      candidates.push({ url: u, source: 'enclosure', width: 0, height: 0, score: 0 });
    }
  });

  const itunes = el.getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', 'image')[0];
  if (itunes) {
    const href = itunes.getAttribute('href') || '';
    if (href && !isProbablyBadImageUrl(href)) {
      candidates.push({ url: href, source: 'itunes:image', width: 0, height: 0, score: 0 });
    }
  }

  for (const html of [contentHtml, descHtml].filter(Boolean)) {
    candidates.push(...extractImageCandidatesFromHtml(html, location.href));
  }

  return candidates;
}

export function pickBestImageCandidate(candidates) {
  if (!candidates.length) return null;
  const scored = candidates
    .filter(c => !isProbablyBadImageUrl(c.url))
    .map(c => ({ ...c, score: scoreImageCandidate(c) }));
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score);
  return scored[0];
}

export function extractImage(el, descHtml, contentHtml) {
  const candidates = extractImageCandidatesFromFeedItem(el, descHtml, contentHtml);
  const best = pickBestImageCandidate(candidates);
  return best ? best.url : null;
}

// ── Image validation ──────────────────────────────────────────────

export function validateImageUrl(url, timeoutMs = 3500) {
  return new Promise(resolve => {
    if (!url) { resolve(null); return; }
    const img   = new Image();
    const timer = setTimeout(() => {
      img.onload = null; img.onerror = null;
      resolve(null);
    }, timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      const width  = img.naturalWidth;
      const height = img.naturalHeight;
      if (!width || !height) { resolve(null); return; }
      const ratio  = width / height;
      if (width < 240 || height < 120)   { resolve(null); return; }
      if (ratio < 0.7 || ratio > 3.2)    { resolve(null); return; }
      resolve({ url, width, height, ratio });
    };
    img.onerror = () => { clearTimeout(timer); resolve(null); };
    img.referrerPolicy = 'no-referrer';
    img.src = url;
  });
}

// ── localStorage image cache ──────────────────────────────────────

export function getCachedImage(articleUrl) {
  try {
    const raw = localStorage.getItem('gp:image:' + articleUrl);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && data.notFound) {
      if (Date.now() - data.savedAt > IMAGE_NEG_CACHE_TTL) {
        localStorage.removeItem('gp:image:' + articleUrl);
        return null;
      }
      return { notFound: true };
    }
    if (!data.url || isProbablyBadImageUrl(data.url)) {
      localStorage.removeItem('gp:image:' + articleUrl);
      return null;
    }
    if (Date.now() - data.savedAt > IMAGE_CACHE_TTL) {
      localStorage.removeItem('gp:image:' + articleUrl);
      return null;
    }
    return data;
  } catch { return null; }
}

export function setCachedImage(articleUrl, imageData) {
  try {
    localStorage.setItem('gp:image:' + articleUrl, JSON.stringify({ ...imageData, savedAt: Date.now() }));
  } catch { /* quota exceeded */ }
}

export function setCachedImageMiss(articleUrl) {
  try {
    localStorage.setItem('gp:image:' + articleUrl, JSON.stringify({ notFound: true, savedAt: Date.now() }));
  } catch { /* ignore quota */ }
}

// ── Head extraction helpers ───────────────────────────────────────

function getHeadHtml(html) {
  if (!html) return '';
  const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (match) return match[1];
  return html.slice(0, 50000);
}

function findBodyImageInHtml(html, baseUrl) {
  if (!html) return null;
  const bodyHtml = html.replace(/<head[\s\S]*?<\/head>/i, '');
  const candidates = extractImageCandidatesFromHtml(bodyHtml, baseUrl);
  return pickBestImageCandidate(candidates);
}

function findImageInMarkdown(md, baseUrl) {
  if (!md) return null;
  const re = /!\[[^\]]*\]\(([^)\s]+)/g;
  let m;
  while ((m = re.exec(md)) !== null) {
    const url = normalizeImageUrl(m[1], baseUrl);
    if (url && !isProbablyBadImageUrl(url) && _IMG_EXT.test(url)) return url;
  }
  return null;
}

// ── Article metadata image resolver ──────────────────────────────

export async function resolveArticleMetadataImage(articleUrl) {
  if (!articleUrl) return null;

  const cached = getCachedImage(articleUrl);
  if (cached) {
    if (cached.notFound) return null;
    return cached;
  }

  if (resolvingImageUrls.has(articleUrl)) return null;
  resolvingImageUrls.add(articleUrl);

  try {
    const html = await fetchViaCorsProxy(articleUrl, { timeoutMs: 8000 });
    if (!html) {
      const jinaUrl = 'https://r.jina.ai/' + articleUrl;
      try {
        const r = await fetch(jinaUrl, { signal: AbortSignal.timeout(8000), referrerPolicy: 'no-referrer' });
        if (r.ok) {
          const md = await r.text();
          const imgUrl = findImageInMarkdown(md, articleUrl);
          if (imgUrl) {
            const v = await validateImageUrl(imgUrl);
            if (v) {
              const result = { url: imgUrl, source: 'jina-md', width: v.width, height: v.height, ratio: v.ratio, savedAt: Date.now() };
              setCachedImage(articleUrl, result);
              return result;
            }
          }
        }
      } catch { /* ignore */ }
      setCachedImageMiss(articleUrl);
      return null;
    }

    const tmp = document.createElement('div');
    tmp.innerHTML = getHeadHtml(html);

    const metaSelectors = [
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[property="og:image:secure_url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]',
      'link[rel="image_src"]',
    ];

    for (const selector of metaSelectors) {
      const el = tmp.querySelector(selector);
      if (!el) continue;
      let imageUrl = el.getAttribute('content') || el.getAttribute('href') || null;
      imageUrl = normalizeImageUrl(imageUrl, articleUrl);
      if (!imageUrl || isProbablyBadImageUrl(imageUrl)) continue;
      const validated = await validateImageUrl(imageUrl);
      if (!validated) continue;
      const result = {
        url: imageUrl,
        source: selector.includes('twitter') ? 'twitter:image' : 'og:image',
        width: validated.width, height: validated.height, ratio: validated.ratio,
        savedAt: Date.now(),
      };
      setCachedImage(articleUrl, result);
      return result;
    }

    const bodyBest = findBodyImageInHtml(html, articleUrl);
    if (bodyBest && bodyBest.url) {
      const v = await validateImageUrl(bodyBest.url);
      if (v) {
        const result = { url: bodyBest.url, source: 'body-img', width: v.width, height: v.height, ratio: v.ratio, savedAt: Date.now() };
        setCachedImage(articleUrl, result);
        return result;
      }
    }

    setCachedImageMiss(articleUrl);
    return null;
  } catch (err) {
    console.warn('[GeeksPulse] Failed to resolve article metadata image', articleUrl, err);
    return null;
  } finally {
    resolvingImageUrls.delete(articleUrl);
  }
}

// ── Concurrent worker ─────────────────────────────────────────────

export async function runLimited(items, limit, worker) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  });
  await Promise.all(workers);
}

// ── Progressive image resolution ──────────────────────────────────

export async function progressivelyResolveMissingImages() {
  const feedGrid = document.getElementById('feedGrid');
  if (!feedGrid) return;

  const cards = Array.from(feedGrid.querySelectorAll('.card[data-article-url]')).filter(card => {
    const hasImage       = Boolean(card.querySelector('img.card-img'));
    const hasPlaceholder = Boolean(card.querySelector('.card-placeholder, .card-img-placeholder'));
    const state          = card.dataset.imageState;
    return !hasImage || hasPlaceholder || state === 'missing' || state === 'failed';
  });

  if (!cards.length) return;

  await runLimited(cards, IMAGE_METADATA_CONCURRENCY, async card => {
    const articleUrl = card.dataset.articleUrl;
    if (!articleUrl || articleUrl === '#') return;
    const cached = getCachedImage(articleUrl);
    if (cached) { updateCardImage(card, cached); return; }
    const imageData = await resolveArticleMetadataImage(articleUrl);
    if (imageData) updateCardImage(card, imageData);
  });
}

// ── Card image updater ────────────────────────────────────────────

export function updateCardImage(cardEl, imageData) {
  if (!cardEl || !imageData || !imageData.url) return;

  const existing =
    cardEl.querySelector('.card-img-wrap') ||
    cardEl.querySelector('.card-placeholder') ||
    cardEl.querySelector('.card-img-placeholder');

  if (!existing) return;

  const category  = cardEl.dataset.category  || 'General';
  const link      = cardEl.dataset.articleUrl || '#';
  const isList    = cardEl.classList.contains('card-row');
  const isFeatured = cardEl.classList.contains('card-featured');
  const w         = isList ? 240 : 640;
  const h         = isList ? 180 : 360;
  const imgCls    = isList ? 'card-img card-img--list' : 'card-img';
  const wrapCls   = isList ? 'card-img-wrap card-img-wrap--list' : 'card-img-wrap';

  existing.outerHTML = `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="${wrapCls}" tabindex="-1" aria-hidden="true"><img class="${imgCls}" src="${esc(imageData.url)}" alt="" loading="${isFeatured ? 'eager' : 'lazy'}" fetchpriority="${isFeatured ? 'high' : 'auto'}" decoding="async" referrerpolicy="no-referrer" width="${w}" height="${h}" sizes="(max-width:700px) 100vw,(max-width:1100px) 50vw,33vw" data-category="${esc(category)}" data-link="${esc(link)}"></a>`;

  cardEl.dataset.imageState = 'resolved';
}

