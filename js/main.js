'use strict';

import { categories, catMeta, REFRESH_OPTIONS, SPONSORED_RE, DAY_MS, CACHE_STALE_MS } from './config.js';
import { loadFeedsRegistry, getFeeds } from './feeds-registry.js';
import { gaEvent } from './analytics.js';
import { PREF, loadPreferences, savePreferences, resetPreferences, hasActivePreferences, loadBookmarks, saveBookmarks, isBookmarked, toggleBookmark } from './storage.js';
import { esc, randomMsg, announce, animateCounter, showBmToast, shareArticle } from './utils.js';
import { progressivelyResolveMissingImages, resolveArticleMetadataImage, updateCardImage, getCachedImage } from './images.js';
import { loadFeedCache, fetchAllFromRSS, normaliseCachedArticle } from './feed.js';
import { gridCard, listCard, buildSkeletons, cardPlaceholder } from './cards.js';
import { initSettings } from './settings-panel.js';
import { initMyPulse } from './pulse-panel.js';
import { initPayPalModal } from './paypal-modal.js';
import { initSummaryModal, openSummaryModal } from './summary.js';

// ── State ─────────────────────────────────────────────────────────

let allArticles    = [];
let activeFilter   = PREF.get('filter')      || 'All';
let viewMode       = PREF.get('view')        || 'grid';
let autoRefreshMin = parseInt(PREF.get('autorefresh') || '0', 10);
let isLoading      = false;
let failedFeeds    = 0;
let autoTimer      = null;
let countdownSecs  = 0;
let countdownTimer = null;
let searchQuery    = '';
let focusedCardIdx = -1;

// ── DOM refs ──────────────────────────────────────────────────────

const $  = id => document.getElementById(id);
const feedGrid       = $('feedGrid');
const sidebarFilters = $('sidebarFilters');
const mobileFilters  = $('mobileFilters');
const statusDot      = $('statusDot');
const statusText     = $('statusText');
const articleCount   = $('articleCount');
const errorBanner    = $('errorBanner');
const errorMessage   = $('errorMessage');
const refreshBtnHero = $('refreshBtnHero');
const refreshIcon    = $('refreshIcon');
const navStatus      = $('navStatus');
const gridViewBtn    = $('gridViewBtn');
const listViewBtn    = $('listViewBtn');
const sbFeeds        = $('sbFeeds');
const sbUpdated      = $('sbUpdated');
const sbFailed       = $('sbFailed');
const statArticles   = null; // stat removed from UI

// ── Preference-based filtering ────────────────────────────────────

function isSponsoredItem(a) {
  return SPONSORED_RE.test([(a.title || ''), (a.snippet || ''), (a.source || '')].join(' '));
}

function isWithinAgeRange(a, maxAge) {
  if (maxAge === 'any' || !a.date) return true;
  try {
    const d = new Date(a.date);
    if (isNaN(d)) return true;
    const ageMs = Date.now() - d;
    if (maxAge === '24h') return ageMs <= DAY_MS;
    if (maxAge === '7d')  return ageMs <= 7  * DAY_MS;
    if (maxAge === '30d') return ageMs <= 30 * DAY_MS;
  } catch { return true; }
  return true;
}

function applyPreferencesFilter(articles, prefs) {
  return articles.filter(a => {
    if (prefs.blockedCategories.length && prefs.blockedCategories.includes(a.category)) return false;
    if (prefs.mutedSources.length && prefs.mutedSources.includes(a.source)) return false;
    if (prefs.hideSponsored && isSponsoredItem(a)) return false;
    if (!isWithinAgeRange(a, prefs.maxAge)) return false;
    return true;
  });
}

// ── Render ────────────────────────────────────────────────────────

function render() {
  let visible;
  if (activeFilter === 'Bookmarks') {
    visible = loadBookmarks();
  } else {
    visible = activeFilter === 'All'
      ? allArticles
      : allArticles.filter(a => a.category === activeFilter);
  }

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    visible = visible.filter(a =>
      (a.title  || '').toLowerCase().includes(q) ||
      (a.snippet|| '').toLowerCase().includes(q) ||
      (a.source || '').toLowerCase().includes(q)
    );
  }

  if (activeFilter !== 'Bookmarks') {
    visible = applyPreferencesFilter(visible, loadPreferences());
  }

  feedGrid.innerHTML = '';
  feedGrid.classList.toggle('feed-filtered', activeFilter !== 'All');

  if (visible.length === 0 && !isLoading) {
    const isBookmarkView = activeFilter === 'Bookmarks';
    const pulseFiltered  = !isBookmarkView && allArticles.length > 0 && hasActivePreferences(loadPreferences());
    feedGrid.innerHTML = `
      <div class="empty-state visible">
        <div class="empty-art">${pulseFiltered ? '  [ My Pulse ]\n  // filtered everything' : (isBookmarkView ? '  [ GeeksPulse Bookmarks ]\n  // folder is empty' : '  ¯\\_(ツ)_/¯\n  404: news not found')}</div>
        <div class="empty-title">${pulseFiltered ? 'No stories match your current Pulse.' : (isBookmarkView ? 'No saved stories yet.' : 'No articles for this filter.')}</div>
        <div class="empty-sub">${pulseFiltered
          ? `// try enabling more topics or <button class="empty-pulse-reset" onclick="window.__pulseReset()">resetting your filters</button>`
          : (isBookmarkView ? '// click the bookmark icon on any article to save it here' : '// try another category or refresh the feeds')
        }</div>
      </div>`;
    articleCount.style.display = 'none';
    renderActivePulseSummary();
    return;
  }

  articleCount.style.display = '';
  const totalUnfiltered = activeFilter === 'All'
    ? allArticles.length
    : (activeFilter === 'Bookmarks' ? loadBookmarks().length : allArticles.filter(a => a.category === activeFilter).length);
  const showingOf = (visible.length < totalUnfiltered && activeFilter !== 'Bookmarks')
    ? `<strong>${visible.length}</strong> of ${totalUnfiltered} stories`
    : `<strong>${visible.length}</strong> stories`;
  articleCount.innerHTML = showingOf;

  const isListMode = feedGrid.classList.contains('list-view');
  feedGrid.innerHTML = visible.map((a, i) => isListMode ? listCard(a, i) : gridCard(a, i)).join('');

  feedGrid.querySelectorAll('.card').forEach((el, i) => {
    el.style.setProperty('--i', Math.min(i, 20));
  });

  const seoFallback = document.getElementById('seoLatestFallback');
  if (seoFallback) seoFallback.style.display = 'none';

  if (statArticles) statArticles.textContent = allArticles.length;

  announce(`${visible.length} stories shown.`);
  renderActivePulseSummary();
  setTimeout(progressivelyResolveMissingImages, 100);
}

// ── Skeleton ──────────────────────────────────────────────────────

function showSkeletons(n = 8) {
  feedGrid.innerHTML = buildSkeletons(n);
}

// ── State setters ─────────────────────────────────────────────────

function setLoading() {
  statusDot.className = 'status-dot loading';
  statusText.textContent = randomMsg();
  if (navStatus) navStatus.textContent = 'geekspulse --fetch';
  articleCount.style.display = 'none';
  setRefreshBusy(true);
  showSkeletons();
  hideError();
  const seoFallback = document.getElementById('seoLatestFallback');
  if (seoFallback) seoFallback.style.display = '';
}

function setLive() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  statusDot.className = 'status-dot live';
  statusText.textContent = `${allArticles.length} fresh stories loaded · Updated at ${timeStr}`;
  if (navStatus) navStatus.textContent = `✓ ${allArticles.length} articles`;
  setRefreshBusy(false);
  if (statArticles) animateCounter(statArticles, allArticles.length, 900);
  const statFeedsEl = document.getElementById('statFeeds');
  if (statFeedsEl) animateCounter(statFeedsEl, getFeeds().length, 700);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayCount = allArticles.filter(a => { try { return new Date(a.date) >= todayStart; } catch { return false; } }).length;
  const statTodayEl = document.getElementById('statToday');
  if (statTodayEl) animateCounter(statTodayEl, todayCount, 800);
  const activeSourceCount = new Set(allArticles.map(a => a.source).filter(Boolean)).size;
  const statSourcesEl = document.getElementById('statSources');
  if (statSourcesEl) animateCounter(statSourcesEl, activeSourceCount, 850);
  const nlFeedCount = document.getElementById('newsletterFeedCount');
  if (nlFeedCount) nlFeedCount.textContent = getFeeds().length - failedFeeds;
}

function setRefreshBusy(busy) {
  if (refreshBtnHero) refreshBtnHero.disabled = busy;
  if (refreshIcon) refreshIcon.classList.toggle('spin', busy);
}

function showError(msg) { errorMessage.textContent = msg; errorBanner.classList.add('visible'); }
function hideError()    { errorBanner.classList.remove('visible'); }

// ── Sidebar stats ─────────────────────────────────────────────────

function updateFeedCountSpans(count) {
  ['heroFeedCount', 'termFeedCount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = count;
  });
  const sf = document.getElementById('statFeeds');
  if (sf) sf.textContent = count;
}

function updateSidebarStats(cacheGeneratedAt) {
  if (sbFeeds)   sbFeeds.textContent   = getFeeds().length - failedFeeds;
  if (sbUpdated) {
    if (cacheGeneratedAt) {
      try {
        const d = new Date(cacheGeneratedAt);
        sbUpdated.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        sbUpdated.title = d.toLocaleString();
      } catch { sbUpdated.textContent = '--'; }
    } else {
      sbUpdated.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  if (sbFailed) sbFailed.textContent = failedFeeds;
  const sbBmCount = document.getElementById('sbBmCount');
  if (sbBmCount) sbBmCount.textContent = loadBookmarks().length;
}

// ── Feed-health banner ────────────────────────────────────────────

async function loadFeedHealthBanner() {
  const bar = document.getElementById('feedHealthBar');
  if (!bar) return;
  try {
    const resp = await fetch('/public/feed-health.json', { cache: 'no-cache', signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return;
    const health = await resp.json();
    const total  = Array.isArray(health.feeds) ? health.feeds.length : getFeeds().length;
    const ok     = Array.isArray(health.feeds) ? health.feeds.filter(f => f.ok).length : (total - failedFeeds);
    const failed = total - ok;
    const failed_list = Array.isArray(health.feeds) ? health.feeds.filter(f => !f.ok) : [];
    let updatedStr = '';
    if (health.generatedAt) {
      try {
        const d = new Date(health.generatedAt);
        updatedStr = `Last updated ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · `;
      } catch { /* skip */ }
    }
    const statusEmoji = failed === 0 ? '🟢' : '🟡';
    let html = `<span class="fhb-info">${statusEmoji} ${updatedStr}${ok}/${total} feeds online</span>`;
    if (failed > 0 && failed_list.length > 0) {
      const items = failed_list.map(f => `<li>${esc(f.name)}${f.error ? ' — ' + esc(f.error.slice(0, 60)) : ''}</li>`).join('');
      html += `<details class="fhb-details"><summary>${failed} feed${failed > 1 ? 's' : ''} need${failed === 1 ? 's' : ''} attention</summary><ul>${items}</ul></details>`;
    }
    bar.innerHTML = html;
    bar.style.display = '';
  } catch (e) {
    console.debug('[GeeksPulse] feed-health.json unavailable:', e.message);
  }
}

// ── Site version badge ────────────────────────────────────────────

async function loadSiteVersion() {
  const el = document.getElementById('siteVersion');
  if (!el) return;
  try {
    const resp = await fetch('/public/version.json', { cache: 'no-cache', signal: AbortSignal.timeout(4000) });
    if (!resp.ok) return;
    const v = await resp.json();
    el.textContent = `// ${v.version} · ${v.commit} · ${v.date}`;
    el.title = `Build #${v.build} — click to view changelog`;
  } catch {
    el.textContent = '// version unavailable';
  }
}

// ── Filters ───────────────────────────────────────────────────────

function buildFilters() {
  const counts = {};
  allArticles.forEach(a => { counts[a.category] = (counts[a.category] || 0) + 1; });
  const bmCount = loadBookmarks().length;

  sidebarFilters.innerHTML = categories.map(c => {
    let count;
    if (c.id === 'All') count = allArticles.length;
    else if (c.id === 'Bookmarks') count = bmCount;
    else count = counts[c.id] || 0;
    const isActive = c.id === activeFilter;
    return `
      <button class="filter-item${isActive ? ' active' : ''}" data-cat="${esc(c.id)}" aria-pressed="${isActive}">
        <span class="fi-icon" style="color:${c.color}">${c.icon}</span>
        <span class="fi-label">${esc(c.label)}</span>
        <span class="fi-count">${count}</span>
      </button>`;
  }).join('');

  mobileFilters.innerHTML = categories.map(c => `
    <button class="chip${c.id === activeFilter ? ' active' : ''}" data-cat="${esc(c.id)}">
      <span style="color:${c.color};display:inline-flex;vertical-align:middle;margin-right:4px">${c.icon}</span>${esc(c.id)}
    </button>`).join('');

  [sidebarFilters, mobileFilters].forEach(el => {
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      setFilter(btn.dataset.cat);
    });
  });
}

function setFilter(cat) {
  activeFilter = cat;
  PREF.set('filter', cat);
  gaEvent('filter_category', { category: cat });
  [sidebarFilters, mobileFilters].forEach(container => {
    container.querySelectorAll('[data-cat]').forEach(btn => {
      const active = btn.dataset.cat === cat;
      btn.classList.toggle('active', active);
      if (btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', String(active));
    });
  });
  render();
}

// ── View mode ─────────────────────────────────────────────────────

function applyView() {
  feedGrid.classList.toggle('list-view', viewMode === 'list');
  gridViewBtn.classList.toggle('active', viewMode === 'grid');
  listViewBtn.classList.toggle('active', viewMode === 'list');
  gridViewBtn.setAttribute('aria-pressed', String(viewMode === 'grid'));
  listViewBtn.setAttribute('aria-pressed', String(viewMode === 'list'));
}

// ── Nav scroll effect ─────────────────────────────────────────────

function initNav() {
  const nav = document.querySelector('.top-nav');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

// ── Auto-refresh ──────────────────────────────────────────────────

function updateCountdownUI(secs) {
  const el = document.getElementById('autoRefreshCountdown');
  if (!el) return;
  if (!secs || secs <= 0) { el.textContent = ''; el.style.display = 'none'; return; }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  el.textContent = `↻ ${m}:${String(s).padStart(2, '0')}`;
  el.style.display = '';
}

function startAutoRefresh(minutes) {
  clearInterval(autoTimer);
  clearInterval(countdownTimer);
  autoTimer = null; countdownTimer = null;
  updateCountdownUI(0);
  if (!minutes) return;

  countdownSecs = minutes * 60;
  updateCountdownUI(countdownSecs);
  countdownTimer = setInterval(() => {
    countdownSecs--;
    updateCountdownUI(countdownSecs);
    if (countdownSecs <= 0) clearInterval(countdownTimer);
  }, 1000);
  autoTimer = setInterval(() => {
    fetchAll().then(() => startAutoRefresh(autoRefreshMin));
  }, minutes * 60 * 1000);
}

// ── My Pulse summary bar ──────────────────────────────────────────

function renderActivePulseSummary() {
  const bar = document.getElementById('pulseSummaryBar');
  if (!bar) return;
  const prefs = loadPreferences();
  if (!hasActivePreferences(prefs)) { bar.style.display = 'none'; return; }
  bar.style.display = '';
  const parts = [];
  if (prefs.blockedCategories.length) parts.push(`${prefs.blockedCategories.length} topic${prefs.blockedCategories.length === 1 ? '' : 's'} hidden`);
  if (prefs.mutedSources.length) parts.push(`${prefs.mutedSources.length} source${prefs.mutedSources.length === 1 ? '' : 's'} muted`);
  if (prefs.hideSponsored) parts.push('Sponsored hidden');
  if (prefs.maxAge !== 'any') {
    const ageLabels = { '24h': 'Last 24h', '7d': 'Last 7 days', '30d': 'Last 30 days' };
    parts.push(ageLabels[prefs.maxAge] || prefs.maxAge);
  }
  bar.innerHTML = `
    <span class="psb-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg></span>
    <span class="psb-label">// My Pulse:</span>
    ${parts.map(p => `<span class="psb-pill">${esc(p)}</span>`).join('')}
    <button class="psb-reset" id="pulseSummaryReset" aria-label="Reset My Pulse filters">Reset</button>
    <button class="psb-edit" id="pulseSummaryEdit" aria-label="Edit My Pulse filters">Edit →</button>`;
  document.getElementById('pulseSummaryReset')?.addEventListener('click', () => {
    resetPreferences(); render(); syncMyPulsePanelIfOpen();
  });
  document.getElementById('pulseSummaryEdit')?.addEventListener('click', openMyPulsePanel);
}

function openMyPulsePanel() {
  if (typeof window.__openMyPulse === 'function') window.__openMyPulse();
}

function syncMyPulsePanelIfOpen() {
  if (typeof window.__syncMyPulse === 'function') window.__syncMyPulse();
}

// ── Stale cache banner ────────────────────────────────────────────

function showStaleCacheBanner(generatedAt) {
  let bar = document.getElementById('staleCacheBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'staleCacheBar';
    bar.className = 'stale-cache-bar';
    const grid = feedGrid?.parentNode;
    if (grid) grid.insertBefore(bar, feedGrid);
  }
  try {
    const ageMs = Date.now() - new Date(generatedAt).getTime();
    const hoursAgo = Math.round(ageMs / 3_600_000);
    bar.innerHTML =
      `⚠️ Feed data is <strong>${hoursAgo}h old</strong> — consider refreshing.` +
      `<button class="stale-cache-bar__refresh" id="staleCacheRefresh">Refresh now</button>`;
    bar.classList.add('visible');
    document.getElementById('staleCacheRefresh')
      ?.addEventListener('click', () => { bar.classList.remove('visible'); fetchAll(); });
  } catch { /* bad date — skip */ }
}

function hideStaleCacheBanner() {
  document.getElementById('staleCacheBar')?.classList.remove('visible');
}

// ── Primary data loader ───────────────────────────────────────────

async function fetchAll() {
  if (isLoading) return;
  isLoading = true;
  failedFeeds = 0;
  setLoading();

  let cacheGeneratedAt = null;

  try {
    const data = await loadFeedCache();
    allArticles = data.articles.map(normaliseCachedArticle).filter(a => a.link && a.link !== '#');
    failedFeeds = data.failedFeeds || 0;
    cacheGeneratedAt = data.generatedAt || null;
    if (data.feedCount) updateFeedCountSpans(data.feedCount);
    console.info(`[GeeksPulse] Loaded ${allArticles.length} articles from cache (generated ${data.generatedAt}).`);
    // Warn if the cache is older than the stale threshold
    if (cacheGeneratedAt) {
      const ageMs = Date.now() - new Date(cacheGeneratedAt).getTime();
      if (ageMs > CACHE_STALE_MS) {
        showStaleCacheBanner(cacheGeneratedAt);
      } else {
        hideStaleCacheBanner();
      }
    }
  } catch (cacheErr) {
    console.warn('[GeeksPulse] Feed cache unavailable, attempting emergency RSS fallback…', cacheErr.message);
    try {
      const result = await fetchAllFromRSS();
      allArticles = result.articles;
      failedFeeds = result.failedCount;
    } catch (rssErr) {
      console.error('[GeeksPulse] Emergency RSS fallback also failed:', rssErr.message);
      allArticles = [];
      showError('Unable to load articles. Please try refreshing the page or check back later.');
    }
  }

  isLoading = false;
  setLive();
  updateSidebarStats(cacheGeneratedAt);
  loadFeedHealthBanner();
  loadSiteVersion();
  buildFilters();
  render();

  if (allArticles.length > 0) hideError();
}

// ── Newsletter form ───────────────────────────────────────────────

function showNlMsg(msg, type) {
  const el = document.getElementById('newsletterMsg');
  if (!el) return;
  el.textContent = msg;
  el.style.display = '';
  el.className = 'newsletter-msg ' + (type === 'ok' ? 'newsletter-msg--ok' : 'newsletter-msg--err');
}

// ── Init ──────────────────────────────────────────────────────────

async function init() {
  await loadFeedsRegistry();


  ['heroFeedCount', 'termFeedCount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = getFeeds().length;
  });
  const statFeedsEl = document.getElementById('statFeeds');
  if (statFeedsEl) statFeedsEl.textContent = getFeeds().length;

  initNav();
  initSettings({
    getAutoRefreshMin: ()  => autoRefreshMin,
    setAutoRefreshMin: v   => { autoRefreshMin = v; },
    getViewMode:       ()  => viewMode,
    setViewMode:       v   => { viewMode = v; },
    applyView,
    render,
    startAutoRefresh,
  });
  initMyPulse({ render, buildFilters });
  initPayPalModal();
  initSummaryModal();
  applyView();
  buildFilters();

  // Expose public globals
  window.__setFilter    = setFilter;
  window.resetPreferences = resetPreferences;
  window.syncMyPulsePanelIfOpen = syncMyPulsePanelIfOpen;
  window.__pulseReset   = () => { resetPreferences(); render(); syncMyPulsePanelIfOpen(); };

  gridViewBtn.addEventListener('click', () => {
    viewMode = 'grid'; PREF.set('view', viewMode); applyView(); render();
  });
  listViewBtn.addEventListener('click', () => {
    viewMode = 'list'; PREF.set('view', viewMode); applyView(); render();
  });

  if (refreshBtnHero) refreshBtnHero.addEventListener('click', () => {
    gaEvent('refresh_feeds', { trigger: 'refreshBtnHero' });
    fetchAll();
  });

  fetchAll().then(() => startAutoRefresh(autoRefreshMin));

  // Register Service Worker for offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
      console.debug('[GeeksPulse] SW registered, scope:', reg.scope);
    }).catch(err => {
      console.warn('[GeeksPulse] SW registration failed:', err.message);
    });
  }

  // Clear bookmarks
  const clearBmBtn = document.getElementById('clearBookmarksBtn');
  if (clearBmBtn) {
    clearBmBtn.addEventListener('click', () => {
      if (loadBookmarks().length === 0) return;
      saveBookmarks([]);
      buildFilters();
      updateSidebarStats();
      if (activeFilter === 'Bookmarks') render();
      showBmToast('🗑️ All bookmarks cleared');
    });
  }

  updateSidebarStats();

  // Image load quality guard — replace upscaled images with placeholder
  feedGrid.addEventListener('load', async event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('card-img')) return;
    const nW = img.naturalWidth || 0;
    const nH = img.naturalHeight || 0;
    if (nW === 0 || nH === 0) return;
    const wrap = img.closest('.card-img-wrap');
    const card = img.closest('.card');
    if (!wrap || !card) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = wrap.getBoundingClientRect();
    const targetW = (rect.width  || Number(img.getAttribute('width'))  || 0) * dpr;
    const targetH = (rect.height || Number(img.getAttribute('height')) || 0) * dpr;
    if (targetW === 0 || targetH === 0) return;
    const TOL = 0.8;
    if (nW >= targetW * TOL && nH >= targetH * TOL) return;
    const category = card.dataset.category || img.dataset.category || 'General';
    const link     = card.dataset.articleUrl || img.dataset.link || '#';
    img.onerror = null;
    wrap.outerHTML = cardPlaceholder(category, link);
  }, true);

  // Broken image handler — replace with placeholder, then try to resolve a better image
  feedGrid.addEventListener('error', async event => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.classList.contains('card-img')) return;
    const card = img.closest('.card');
    const wrap = img.closest('.card-img-wrap');
    if (!card || !wrap) return;
    const category = card.dataset.category || img.dataset.category || 'General';
    const link     = card.dataset.articleUrl || img.dataset.link || '#';
    wrap.outerHTML = cardPlaceholder(category, link);
    if (!link || link === '#') return;
    try {
      const imageData = await resolveArticleMetadataImage(link);
      if (imageData) updateCardImage(card, imageData);
    } catch (err) {
      console.warn('[GeeksPulse] Could not resolve fallback image after error', err);
    }
  }, true);

  // Bookmark delegation
  feedGrid.addEventListener('click', e => {
    const btn = e.target.closest('.bm-btn');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    const link = btn.dataset.bmLink;
    const article = allArticles.find(a => a.link === link) || loadBookmarks().find(a => a.link === link);
    if (!article) return;
    const added = toggleBookmark(article);
    gaEvent(added ? 'bookmark_add' : 'bookmark_remove', {
      article_title: article.title, article_source: article.source, article_url: article.link,
    });
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', added ? 'currentColor' : 'none');
    btn.classList.toggle('bm-active', added);
    btn.title = added ? 'Remove bookmark' : 'Save to GeeksPulse bookmarks';
    btn.setAttribute('aria-label', added ? 'Remove bookmark' : 'Bookmark this article');
    showBmToast(added ? '🔖 Saved to GeeksPulse bookmarks' : '🗑️ Removed from bookmarks');
    buildFilters();
    if (activeFilter === 'Bookmarks') render();
  });

  // Share delegation
  feedGrid.addEventListener('click', e => {
    const btn = e.target.closest('.card-share-btn');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    gaEvent('share', { article_title: btn.dataset.shareTitle, article_url: btn.dataset.shareUrl });
    shareArticle(btn.dataset.shareTitle, btn.dataset.shareUrl);
  });

  // Summary delegation
  feedGrid.addEventListener('click', e => {
    const btn = e.target.closest('.card-summary-btn');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    gaEvent('summary_open', { article_title: btn.dataset.summaryTitle, article_url: btn.dataset.summaryLink });
    openSummaryModal({
      title:   btn.dataset.summaryTitle,
      snippet: btn.dataset.summarySnippet,
      link:    btn.dataset.summaryLink,
      source:  btn.dataset.summarySource,
    });
  });

  // Outbound link tracking
  feedGrid.addEventListener('click', e => {
    const link = e.target.closest('a[href]');
    if (!link) return;
    const card = link.closest('.card');
    if (!card) return;
    gaEvent('select_content', {
      content_type: 'article',
      item_id: link.href,
      article_title: card.querySelector('.card-title a')?.textContent?.trim() || '',
      article_source: card.querySelector('.card-source span:nth-child(2)')?.textContent?.trim() || '',
      article_category: card.dataset.category || '',
    });
  });

  // Search
  const searchInput = document.getElementById('articleSearch');
  const searchKbd   = document.getElementById('searchKbd');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchQuery = searchInput.value.trim();
        if (searchQuery.length >= 3) gaEvent('search', { search_term: searchQuery });
        render();
      }, 180);
    });
    searchInput.addEventListener('focus', () => { if (searchKbd) searchKbd.style.display = 'none'; });
    searchInput.addEventListener('blur',  () => { if (searchKbd && !searchInput.value) searchKbd.style.display = ''; });
  }

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    const inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

    if (e.key === '/' && !inInput) {
      e.preventDefault(); searchInput?.focus(); searchInput?.select();
    } else if (e.key === 'Escape' && inInput) {
      searchInput?.blur();
      if (searchInput) { searchInput.value = ''; searchQuery = ''; render(); }
    } else if (e.key === 'r' && !inInput && !e.ctrlKey && !e.metaKey) {
      fetchAll();
    } else if ((e.key === 'j' || e.key === 'k') && !inInput) {
      const cards = Array.from(feedGrid.querySelectorAll('.card'));
      if (!cards.length) return;
      e.preventDefault();
      focusedCardIdx = e.key === 'j'
        ? Math.min(focusedCardIdx + 1, cards.length - 1)
        : Math.max(focusedCardIdx - 1, 0);
      cards[focusedCardIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      cards[focusedCardIdx]?.querySelector('a')?.focus();
    } else if (e.key === 'o' && !inInput && focusedCardIdx >= 0) {
      const cards = Array.from(feedGrid.querySelectorAll('.card'));
      const link = cards[focusedCardIdx]?.querySelector('.card-title a');
      if (link) window.open(link.href, '_blank', 'noopener,noreferrer');
    }
  });

  // Newsletter form
  const nlForm = document.getElementById('newsletterForm');
  const nlBtn  = document.getElementById('newsletterSubmit');
  if (nlForm) {
    nlForm.addEventListener('submit', async e => {
      e.preventDefault();
      const email = document.getElementById('newsletterEmail')?.value?.trim();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showNlMsg('Please enter a valid email address.', 'error');
        return;
      }
      if (nlBtn) { nlBtn.disabled = true; nlBtn.textContent = 'Sending…'; }
      try {
        const res = await fetch(nlForm.action, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ email, _subject: 'New GeeksPulse subscriber' }),
        });
        if (res.ok) { showNlMsg('🎉 You\'re subscribed! Check your inbox.', 'ok'); nlForm.reset(); }
        else showNlMsg('Something went wrong. Try again.', 'error');
      } catch {
        showNlMsg('Network error. Please try again.', 'error');
      } finally {
        if (nlBtn) { nlBtn.disabled = false; nlBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9l20-7z"/></svg> Subscribe free'; }
      }
    });
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  init();

  // Back to top button
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  let visible = false;
  let hideTimer = null;

  function onScroll() {
    const shouldShow = window.scrollY > 300;
    if (shouldShow && !visible) {
      visible = true;
      clearTimeout(hideTimer);
      btn.classList.remove('hiding');
      btn.classList.add('visible');
    } else if (!shouldShow && visible) {
      visible = false;
      btn.classList.add('hiding');
      hideTimer = setTimeout(() => btn.classList.remove('visible', 'hiding'), 220);
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  btn.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
});


