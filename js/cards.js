import { catMeta } from './config.js';
import { esc, safeUrl, catClass, relTime } from './utils.js';
import { isBookmarked } from './storage.js';

// ── Shared icons ──────────────────────────────────────────────────

const ICON_SHARE = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>`;

const NEW_BADGE = '<span class="card-new" title="Published since your last visit">New</span>';

function bookmarkIcon(active) {
  return `<svg viewBox="0 0 24 24" width="15" height="15" fill="${active ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>`;
}

// ── Summary button helper ─────────────────────────────────────────

function summaryBtn(a) {
  const isAi = a.summaryType === 'ai';
  const label = isAi ? 'AI Summary' : 'Article Snippet';
  const icon = isAi
    ? `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2z"/></svg>`
    : `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`;
  return `<button type="button" class="card-summary-btn${isAi ? '' : ' card-summary-btn--snippet'}" data-summary-title="${esc(a.title)}" data-summary-snippet="${esc(a.snippet || '')}" data-summary-type="${esc(a.summaryType || '')}" data-summary-link="${esc(a.link)}" data-summary-source="${esc(a.source || '')}" title="${label}" aria-label="Show ${label}">${icon}</button>`;
}

function shareBtn(a) {
  return `<button type="button" class="card-share-btn" data-share-url="${esc(a.link)}" data-share-title="${esc(a.title)}" title="Share" aria-label="Share article">${ICON_SHARE}</button>`;
}

function bookmarkBtn(a) {
  const bm = isBookmarked(a.link);
  return `<button type="button" class="bm-btn${bm ? ' bm-active' : ''}" data-bm-link="${esc(a.link)}" title="${bm ? 'Remove bookmark' : 'Save to GeeksPulse bookmarks'}" aria-label="${bm ? 'Remove bookmark' : 'Bookmark this article'}">${bookmarkIcon(bm)}</button>`;
}

// Source name doubles as a "more from this source" filter (handled in main.js).
function sourceBlock(a) {
  const name = esc(a.source || '');
  return `<div class="card-source"><span class="src-dot ${catClass(a.category)}" aria-hidden="true"></span><button type="button" class="card-source-name" data-source="${name}" title="More from ${name}">${name}</button></div>`;
}

function dateBlock(a) {
  const rel = relTime(a.date);
  if (!rel) return '';
  let iso = '';
  let full = '';
  try {
    const d = new Date(a.date);
    iso = d.toISOString();
    full = d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  } catch { /* relTime already validated the date */ }
  return `<span class="card-sep" aria-hidden="true">·</span><time class="card-date" datetime="${esc(iso)}" title="${esc(full)}">${esc(rel)}</time>`;
}

function catPill(a) {
  const label = a.category || 'General';
  return `<span class="card-cat ${catClass(a.category)}">${esc(label)}</span>`;
}

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
  const bigSvg = meta ? meta.icon.replace(/width="\d+" height="\d+"/, 'width="40" height="40"') : '';
  const tag = {
    'General':      '{ breaking; }',
    'Security':     'sudo cat news',
    'AI':           'model.predict()',
    'Python':       'import news',
    'JavaScript':   'await fetch(news)',
    'DevOps':       'kubectl get news',
    'Open Source':  'git pull origin',
    'Java':         'new News()',
    'Rust':         'fn read() -> News',
    'Go':           'go get news',
    'Architecture': 'design(system)',
  }[category] || '> _';
  return `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="card-img-wrap card-placeholder ${catClass(category || 'General')}" data-ph-cat="${esc(category)}" style="--ph-color:${color}" tabindex="-1" aria-hidden="true">
    <span class="card-placeholder__grid"></span>
    <span class="card-placeholder__icon">${bigSvg}</span>
    <span class="card-placeholder__tag">${esc(tag)}</span>
  </a>`;
}

// ── Grid card ─────────────────────────────────────────────────────

export function gridCard(a, i, { isNew = false } = {}) {
  const num  = String(i + 1).padStart(2, '0');
  const featured = i === 0;
  const loadingAttr  = featured ? 'eager'  : 'lazy';
  const fetchpriAttr = featured ? 'high'   : 'auto';
  const imgSrc = safeUrl(a.image || a.fallbackImage || null) || null;
  const imgSrc_ = imgSrc === '#' ? null : imgSrc;
  const imgHtml = imgSrc_
    ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" class="card-img-wrap" tabindex="-1" aria-hidden="true"><img class="card-img" src="${esc(imgSrc_)}" alt="" loading="${loadingAttr}" fetchpriority="${fetchpriAttr}" decoding="async" referrerpolicy="no-referrer" width="640" height="360" sizes="(max-width:700px) 100vw,(max-width:1100px) 50vw,33vw" data-category="${esc(a.category)}" data-link="${esc(a.link)}"></a>`
    : cardPlaceholder(a.category, a.link);
  return `
    <article class="card${featured ? ' card-featured' : ''} ${catClass(a.category)}" data-card-idx="${i}" data-article-url="${esc(a.link)}" data-category="${esc(a.category)}">
      ${imgHtml}
      <div class="card-body">
        <div class="card-top">
          <span class="card-num" aria-hidden="true">${num}</span>
          ${sourceBlock(a)}
          ${dateBlock(a)}
          ${isNew ? NEW_BADGE : ''}
        </div>
        <h3 class="card-title"><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a></h3>
        ${a.snippet ? `<p class="card-snippet">${esc(a.snippet)}</p>` : ''}
      </div>
      <div class="card-footer">
        <div class="card-meta">${catPill(a)}</div>
        <div class="card-actions">
          ${summaryBtn(a)}
          ${shareBtn(a)}
          ${bookmarkBtn(a)}
        </div>
      </div>
    </article>`;
}

// ── List card ─────────────────────────────────────────────────────

export function listCard(a, i, { isNew = false } = {}) {
  const num  = String(i + 1).padStart(2, '0');
  const listImgSrcRaw = safeUrl(a.image || a.fallbackImage || null) || null;
  const listImgSrc = listImgSrcRaw === '#' ? null : listImgSrcRaw;
  const meta = catMeta[a.category];
  const imgHtml = listImgSrc
    ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" class="card-img-wrap card-img-wrap--list" tabindex="-1" aria-hidden="true"><img class="card-img card-img--list" src="${esc(listImgSrc)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="240" height="180" data-category="${esc(a.category)}" data-link="${esc(a.link)}"></a>`
    : `<span class="card-img-wrap card-img-wrap--list card-placeholder card-placeholder--list ${catClass(a.category)}" style="--ph-color:${meta?.color || '#94A3B8'}" aria-hidden="true"><span class="card-placeholder__icon">${meta ? meta.icon.replace(/width="\d+" height="\d+"/, 'width="24" height="24"') : ''}</span></span>`;
  return `
    <article class="card card-row ${catClass(a.category)}" data-card-idx="${i}" data-article-url="${esc(a.link)}" data-category="${esc(a.category)}">
      <span class="card-num" aria-hidden="true">${num}</span>
      ${imgHtml}
      <div class="card-body">
        <div class="card-top">
          ${sourceBlock(a)}
          ${dateBlock(a)}
          <span class="card-sep" aria-hidden="true">·</span>
          ${catPill(a)}
          ${isNew ? NEW_BADGE : ''}
        </div>
        <h3 class="card-title"><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a></h3>
        ${a.snippet ? `<p class="card-snippet card-snippet--sm">${esc(a.snippet)}</p>` : ''}
      </div>
      <div class="card-actions">
        ${summaryBtn(a)}
        ${shareBtn(a)}
        ${bookmarkBtn(a)}
      </div>
    </article>`;
}

// ── Skeleton loading cards ────────────────────────────────────────

export function buildSkeletons(n = 8) {
  return Array.from({ length: n }, () => `
    <div class="skeleton-card" aria-hidden="true">
      <div class="sk sk-img"></div>
      <div class="sk sk-chip"></div>
      <div class="sk sk-h1"></div>
      <div class="sk sk-h2"></div>
      <div class="sk sk-t1"></div>
      <div class="sk sk-t2"></div>
      <div class="sk sk-t3"></div>
      <div class="sk sk-foot"></div>
    </div>`).join('');
}
