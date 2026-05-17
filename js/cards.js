import { catMeta } from './config.js';
import { esc, safeUrl, catClass, relTime, readTime } from './utils.js';
import { isBookmarked } from './storage.js';

// ── Category icon helpers ─────────────────────────────────────────

export function catIconSm(category) {
  const meta = catMeta[category];
  if (!meta) return '';
  const svg = meta.icon.replace(/width="\d+" height="\d+"/, 'width="11" height="11"');
  return `<span style="display:inline-flex;align-items:center;color:${meta.color};margin-right:3px;flex-shrink:0">${svg}</span>`;
}

export function catIconCard(category) {
  const meta = catMeta[category];
  if (!meta) return '';
  const svg = meta.icon.replace(/width="\d+" height="\d+"/, 'width="18" height="18"');
  return `<span class="card-cat-icon" style="color:${meta.color}">${svg}</span>`;
}

// ── Card image placeholder ────────────────────────────────────────

export function cardPlaceholder(category, link) {
  const meta  = catMeta[category];
  const color = meta ? meta.color : '#94A3B8';
  const bigSvg = meta ? meta.icon.replace(/width="\d+" height="\d+"/, 'width="48" height="48"') : '';
  const tag = {
    'General':     '{ breaking; }',
    'Security':    'sudo cat news',
    'AI':          'model.predict()',
    'Python':      'import news',
    'JavaScript':  'const news = fetch()',
    'DevOps':      'kubectl get news',
    'Open Source': 'git pull origin',
    'Java':        'new News()',
    'Rust':        'fn read() -> News',
    'Go':          'go get news',
  }[category] || '> _';
  return `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="card-img-wrap card-placeholder" data-ph-cat="${esc(category)}" style="--ph-color:${color}" tabindex="-1" aria-hidden="true">
    <span class="card-placeholder__icon">${bigSvg}</span>
    <span class="card-placeholder__tag">${esc(tag)}</span>
    <span class="card-placeholder__grid"></span>
  </a>`;
}

// ── Grid card ─────────────────────────────────────────────────────

export function gridCard(a, i) {
  const date = relTime(a.date);
  const num  = String(i + 1).padStart(2, '0');
  const featured = i === 0;
  const bm = isBookmarked(a.link);
  const mins = readTime(a.title, a.snippet);
  const loadingAttr  = featured ? 'eager'  : 'lazy';
  const fetchpriAttr = featured ? 'high'   : 'auto';
  const imgSrc = safeUrl(a.image || a.fallbackImage || null) || null;
  const imgSrc_ = imgSrc === '#' ? null : imgSrc;
  const imgAlt = imgSrc_ ? `Article image for: ${a.title}` : `Category illustration for ${a.category}`;
  const imgHtml = imgSrc_
    ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" class="card-img-wrap" tabindex="-1" aria-hidden="true"><img class="card-img" src="${esc(imgSrc_)}" alt="${esc(imgAlt)}" loading="${loadingAttr}" fetchpriority="${fetchpriAttr}" decoding="async" referrerpolicy="no-referrer" width="640" height="360" sizes="(max-width:700px) 100vw,(max-width:1100px) 50vw,33vw" data-category="${esc(a.category)}" data-link="${esc(a.link)}"></a>`
    : cardPlaceholder(a.category, a.link);
  return `
    <article class="card${featured ? ' card-featured' : ''} ${catClass(a.category)}" data-card-idx="${i}" data-article-url="${esc(a.link)}" data-category="${esc(a.category)}">
      ${imgHtml}
      <div class="card-top">
        <span class="card-num">${num}</span>
        ${catIconCard(a.category)}
        <span class="card-cat ${catClass(a.category)}">${esc(a.category)}</span>
        ${date ? `<span class="card-date">${date}</span>` : ''}
        <button class="bm-btn${bm ? ' bm-active' : ''}" data-bm-link="${esc(a.link)}" title="${bm ? 'Remove bookmark' : 'Save to GeeksPulse bookmarks'}" aria-label="${bm ? 'Remove bookmark' : 'Bookmark this article'}">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="${bm ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>
      </div>
      <h2 class="card-title">
        <a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
      </h2>
      ${a.snippet ? `<p class="card-snippet">${esc(a.snippet)}</p>` : ''}
      <div class="card-footer">
        <div class="card-source">
          <span class="src-dot ${catClass(a.category)}"></span>
          <span>${esc(a.source)}</span>
          <span class="card-read-time">${mins} min read</span>
        </div>
        <div class="card-actions">
          <button class="card-summary-btn" data-summary-title="${esc(a.title)}" data-summary-snippet="${esc(a.snippet || '')}" data-summary-link="${esc(a.link)}" data-summary-source="${esc(a.source || '')}" title="AI Summary" aria-label="Show AI summary">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
          </button>
          <button class="card-share-btn" data-share-url="${esc(a.link)}" data-share-title="${esc(a.title)}" title="Share" aria-label="Share article">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
          <a class="card-link" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Read →</a>
        </div>
      </div>
    </article>`;
}

// ── List card ─────────────────────────────────────────────────────

export function listCard(a, i) {
  const date = relTime(a.date);
  const num  = String(i + 1).padStart(2, '0');
  const bm = isBookmarked(a.link);
  const mins = readTime(a.title, a.snippet);
  const listImgSrcRaw = safeUrl(a.image || a.fallbackImage || null) || null;
  const listImgSrc = listImgSrcRaw === '#' ? null : listImgSrcRaw;
  const listImgAlt = listImgSrc ? `Article image for: ${a.title}` : `Category illustration for ${a.category}`;
  const imgHtml = listImgSrc
    ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" class="card-img-wrap card-img-wrap--list" tabindex="-1" aria-hidden="true"><img class="card-img card-img--list" src="${esc(listImgSrc)}" alt="${esc(listImgAlt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="240" height="180" data-category="${esc(a.category)}" data-link="${esc(a.link)}"></a>`
    : `<span class="card-img-wrap card-img-wrap--list card-placeholder card-placeholder--list" style="--ph-color:${catMeta[a.category]?.color||'#94A3B8'}"><span class="card-placeholder__icon">${catMeta[a.category] ? catMeta[a.category].icon.replace(/width="\d+" height="\d+"/, 'width="28" height="28"') : ''}</span></span>`;
  return `
    <article class="card card-row ${catClass(a.category)}" data-card-idx="${i}" data-article-url="${esc(a.link)}" data-category="${esc(a.category)}">
      <span class="card-num">${num}</span>
      ${imgHtml}
      <div class="card-body">
        <div class="card-top">
          ${catIconCard(a.category)}
          <span class="card-cat ${catClass(a.category)}">${esc(a.category)}</span>
          ${date ? `<span class="card-date">${date}</span>` : ''}
          <button class="bm-btn${bm ? ' bm-active' : ''}" data-bm-link="${esc(a.link)}" title="${bm ? 'Remove bookmark' : 'Save to GeeksPulse bookmarks'}" aria-label="${bm ? 'Remove bookmark' : 'Bookmark this article'}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="${bm ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>
        <h2 class="card-title">
          <a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
        </h2>
        ${a.snippet ? `<p class="card-snippet card-snippet--sm">${esc(a.snippet)}</p>` : ''}
        <div class="card-source">
          <span class="src-dot ${catClass(a.category)}"></span>
          <span>${esc(a.source)}</span>
          <span class="card-read-time">${mins} min read</span>
        </div>
      </div>
      <div class="card-actions" style="flex-direction:column;gap:6px;">
        <button class="card-summary-btn" data-summary-title="${esc(a.title)}" data-summary-snippet="${esc(a.snippet || '')}" data-summary-link="${esc(a.link)}" data-summary-source="${esc(a.source || '')}" title="AI Summary" aria-label="Show AI summary">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
        </button>
        <button class="card-share-btn" data-share-url="${esc(a.link)}" data-share-title="${esc(a.title)}" title="Share" aria-label="Share article">
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
        </button>
        <a class="card-link" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Read →</a>
      </div>
    </article>`;
}

// ── Skeleton loading cards ────────────────────────────────────────

export function buildSkeletons(n = 8) {
  return Array.from({ length: n }, () => `
    <div class="skeleton-card">
      <div class="sk sk-chip"></div>
      <div class="sk sk-h1"></div>
      <div class="sk sk-h2"></div>
      <div class="sk sk-t1"></div>
      <div class="sk sk-t2"></div>
      <div class="sk sk-t3"></div>
      <div class="sk sk-foot"></div>
    </div>`).join('');
}

