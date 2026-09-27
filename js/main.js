'use strict';

import { categories, SPONSORED_RE, DAY_MS, CACHE_STALE_MS } from './config.js';
import { loadFeedsRegistry, getFeeds } from './feeds-registry.js';
import { gaEvent } from './analytics.js';
import { initConsent } from './consent.js';
import { PREF, loadPreferences, resetPreferences, hasActivePreferences, loadBookmarks, saveBookmarks, toggleBookmark } from './storage.js';
import { esc, catClass, relTime, randomMsg, announce, animateCounter, showBmToast, shareArticle } from './utils.js';
import { progressivelyResolveMissingImages, resolveArticleMetadataImage, updateCardImage } from './images.js';
import { loadFeedCache, fetchAllFromRSS, normaliseCachedArticle } from './feed.js';
import { gridCard, listCard, buildSkeletons, cardPlaceholder } from './cards.js';
import { initSettings } from './settings-panel.js';
import { initMyPulse } from './pulse-panel.js';
import { initPayPalModal } from './paypal-modal.js';
import { initSummaryModal, openSummaryModal } from './summary.js';
import { initTheme } from './theme.js';

// ── State ─────────────────────────────────────────────────────────

const PAGE_SIZE = 60;          // cards rendered per "page" of the feed
const LAST_VISIT_KEY = 'gp:lastVisit';

let allArticles    = [];
let activeFilter   = PREF.get('filter')      || 'All';
let activeSource   = null;
let viewMode       = PREF.get('view')        || 'grid';
let autoRefreshMin = parseInt(PREF.get('autorefresh') || '0', 10);
let isLoading      = false;
let failedFeeds    = 0;
let feedCount      = 0;
let generatedAt    = null;
let autoTimer      = null;
let countdownSecs  = 0;
let countdownTimer = null;
let searchQuery    = '';
let focusedCardIdx = -1;
let visibleLimit   = PAGE_SIZE;
let lastVisible    = [];
let registryReady  = Promise.resolve();
let previousVisit  = 0;

if (!categories.some(c => c.id === activeFilter)) activeFilter = 'All';
if (viewMode !== 'grid' && viewMode !== 'list') viewMode = 'grid';

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
const gridViewBtn    = $('gridViewBtn');
const listViewBtn    = $('listViewBtn');
const searchInput    = $('articleSearch');
const searchKbd      = $('searchKbd');
const sbFeeds        = $('sbFeeds');
const sbUpdated      = $('sbUpdated');
const sbFailed       = $('sbFailed');

const prefersReducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ── Preference-based filtering ────────────────────────────────────

function isSponsoredItem(a) {
  // Pre-built articles carry a `sponsored` flag stamped by build-feed.mjs
  // (regex + optional Ollama LLM pass). Trust it when present.
  if (a.sponsored === true) return true;
  // Live-fetched articles (loaded via CORS proxies at runtime) have no flag —
  // fall back to the regex which covers the obvious keyword signals.
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

function isNewArticle(a) {
  if (!previousVisit || !a.date) return false;
  const t = new Date(a.date).getTime();
  return Number.isFinite(t) && t > previousVisit && t <= Date.now();
}

// ── Render ────────────────────────────────────────────────────────

/** Articles for the active topic/source, before search and My Pulse filters. */
function baseArticles() {
  let base;
  if (activeFilter === 'Bookmarks') base = loadBookmarks();
  else base = activeFilter === 'All' ? allArticles : allArticles.filter(a => a.category === activeFilter);
  if (activeSource) base = base.filter(a => a.source === activeSource);
  return base;
}

function cardHtml(a, i, isListMode) {
  const opts = { isNew: isNewArticle(a) };
  return isListMode ? listCard(a, i, opts) : gridCard(a, i, opts);
}

function emptyStateHtml(base) {
  const isBookmarkView = activeFilter === 'Bookmarks';
  const prefs = loadPreferences();
  if (isBookmarkView && base.length === 0) {
    return emptyState('  [ saved stories ]\n  // nothing here yet', 'No saved stories yet.',
      'Use the bookmark icon on any story to keep it here — saved stories stay in this browser.');
  }
  if (searchQuery) {
    return emptyState('  grep -ri "' + searchQuery.slice(0, 18).replace(/[\\"]/g, '') + '"\n  // 0 matches', `No stories match “${esc(searchQuery)}”.`,
      'Try a different keyword, or <button type="button" class="empty-pulse-reset" data-clear-search>clear the search</button>.');
  }
  if (!isBookmarkView && allArticles.length > 0 && hasActivePreferences(prefs)) {
    return emptyState('  [ My Pulse ]\n  // filtered everything', 'No stories match your current Pulse.',
      'Try enabling more topics or <button type="button" class="empty-pulse-reset" data-pulse-reset>reset your filters</button>.');
  }
  return emptyState('  ¯\\_(ツ)_/¯\n  404: news not found', 'No stories for this filter.',
    'Try another topic, or refresh the feeds.');
}

function emptyState(art, title, sub) {
  return `
    <div class="empty-state visible">
      <div class="empty-art" aria-hidden="true">${esc(art)}</div>
      <div class="empty-title">${title}</div>
      <div class="empty-sub">${sub}</div>
    </div>`;
}

function render({ keepLimit = false } = {}) {
  // During the very first load keep the skeletons / server-rendered stories.
  if (isLoading && allArticles.length === 0) { renderActiveFilters(); syncUrl(); return; }
  const base = baseArticles();
  let visible = base;

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

  lastVisible = visible;
  if (!keepLimit) visibleLimit = PAGE_SIZE;

  feedGrid.innerHTML = '';
  feedGrid.classList.toggle('feed-filtered', activeFilter !== 'All');
  renderActiveFilters();
  syncUrl();

  if (visible.length === 0 && !isLoading) {
    feedGrid.innerHTML = emptyStateHtml(base);
    articleCount.style.display = 'none';
    announce('No stories match the current filters.');
    renderActivePulseSummary();
    updateShowMore();
    return;
  }

  articleCount.style.display = '';
  const totalUnfiltered = base.length;
  const noun = n => (n === 1 ? 'story' : 'stories');
  let countHtml = (visible.length < totalUnfiltered && activeFilter !== 'Bookmarks')
    ? `<strong>${visible.length}</strong> of ${totalUnfiltered} ${noun(totalUnfiltered)}`
    : `<strong>${visible.length}</strong> ${noun(visible.length)}`;
  const newCount = previousVisit ? visible.filter(isNewArticle).length : 0;
  if (newCount > 0) countHtml += ` · ${newCount} new since your last visit`;
  articleCount.innerHTML = countHtml;

  const isListMode = feedGrid.classList.contains('list-view');
  const page = visible.slice(0, visibleLimit);
  feedGrid.innerHTML = page.map((a, i) => cardHtml(a, i, isListMode)).join('');

  feedGrid.querySelectorAll('.card').forEach((el, i) => {
    el.style.setProperty('--i', Math.min(i, 20));
  });

  const seoFallback = document.getElementById('seoLatestFallback');
  if (seoFallback) seoFallback.style.display = 'none';

  announce(`${visible.length} ${noun(visible.length)} shown.`);
  renderActivePulseSummary();
  updateShowMore();
  setTimeout(progressivelyResolveMissingImages, 100);
}

// ── "Show more" paging ────────────────────────────────────────────

function updateShowMore() {
  const wrap = $('feedMore');
  if (!wrap) return;
  const shown = Math.min(visibleLimit, lastVisible.length);
  const remaining = lastVisible.length - shown;
  wrap.hidden = remaining <= 0 || isLoading;
  if (remaining > 0) {
    $('feedMoreStatus').textContent = `Showing ${shown} of ${lastVisible.length} stories`;
    $('showMoreBtn').textContent = `Show ${Math.min(PAGE_SIZE, remaining)} more`;
  }
}

/** Append the next page of cards without re-rendering existing ones. */
function showMore({ focusFirstNew = false } = {}) {
  const start = Math.min(visibleLimit, lastVisible.length);
  if (start >= lastVisible.length) return false;
  visibleLimit = start + PAGE_SIZE;
  const isListMode = feedGrid.classList.contains('list-view');
  const html = lastVisible.slice(start, visibleLimit).map((a, j) => cardHtml(a, start + j, isListMode)).join('');
  feedGrid.insertAdjacentHTML('beforeend', html);
  updateShowMore();
  const shown = Math.min(visibleLimit, lastVisible.length);
  announce(`Showing ${shown} of ${lastVisible.length} stories.`);
  gaEvent('show_more', { shown });
  setTimeout(progressivelyResolveMissingImages, 100);
  if (focusFirstNew) {
    feedGrid.querySelectorAll('.card')[start]?.querySelector('.card-title a')?.focus();
  }
  return true;
}

// ── Skeleton ──────────────────────────────────────────────────────

function showSkeletons(n = 8) {
  feedGrid.innerHTML = buildSkeletons(n);
}

// ── State setters ─────────────────────────────────────────────────

function setLoading() {
  statusDot.className = 'status-dot loading';
  statusText.textContent = randomMsg();
  statusText.removeAttribute('title');
  setRefreshBusy(true);
  hideError();
  // First load: skeletons (unless the server-rendered stories are already
  // showing). Later refreshes keep the current cards in place so the reader
  // never loses their scroll position.
  if (allArticles.length === 0) {
    const seoFallback = document.getElementById('seoLatestFallback');
    const fallbackVisible = seoFallback && seoFallback.style.display !== 'none';
    articleCount.style.display = 'none';
    showSkeletons(fallbackVisible ? 0 : 8);
    $('feedMore')?.setAttribute('hidden', '');
  }
}

function setLive() {
  const now = new Date();
  statusDot.className = allArticles.length ? 'status-dot live' : 'status-dot err';
  if (generatedAt && !isNaN(new Date(generatedAt))) {
    statusText.textContent = `Updated ${relTime(generatedAt)}`;
    statusText.title = `Feed built ${new Date(generatedAt).toLocaleString()} · loaded ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } else {
    statusText.textContent = `Loaded at ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
  setRefreshBusy(false);
  const total = feedCount || getFeeds().length;
  const statFeedsEl = document.getElementById('statFeeds');
  if (statFeedsEl && total) animateCounter(statFeedsEl, total, 700);
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayCount = allArticles.filter(a => { try { return new Date(a.date) >= todayStart; } catch { return false; } }).length;
  const statTodayEl = document.getElementById('statToday');
  if (statTodayEl) animateCounter(statTodayEl, todayCount, 800);
  const activeSourceCount = new Set(allArticles.map(a => a.source).filter(Boolean)).size;
  const statSourcesEl = document.getElementById('statSources');
  if (statSourcesEl) animateCounter(statSourcesEl, activeSourceCount, 850);
}

function setRefreshBusy(busy) {
  if (refreshBtnHero) {
    refreshBtnHero.disabled = busy;
    refreshBtnHero.setAttribute('aria-busy', String(busy));
  }
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

function updateBookmarkCount() {
  const sbBmCount = document.getElementById('sbBmCount');
  if (sbBmCount) sbBmCount.textContent = loadBookmarks().length;
}

function updateSidebarStats(cacheGeneratedAt) {
  const total = feedCount || getFeeds().length;
  if (sbFeeds)   sbFeeds.textContent = total ? `${Math.max(total - failedFeeds, 0)} / ${total}` : '–';
  if (sbUpdated) {
    const d = cacheGeneratedAt ? new Date(cacheGeneratedAt) : new Date();
    if (!isNaN(d)) {
      sbUpdated.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      sbUpdated.title = d.toLocaleString();
    } else {
      sbUpdated.textContent = '–';
    }
  }
  if (sbFailed) sbFailed.textContent = failedFeeds;
  updateBookmarkCount();
}

// ── Feed-health line ──────────────────────────────────────────────

async function loadFeedHealthBanner() {
  const bar = document.getElementById('feedHealthBar');
  if (!bar) return;
  try {
    const resp = await fetch('/public/feed-health.json', { cache: 'no-cache', signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return;
    const health = await resp.json();
    const total  = Array.isArray(health.feeds) ? health.feeds.length : (feedCount || getFeeds().length);
    const ok     = Array.isArray(health.feeds) ? health.feeds.filter(f => f.ok).length : (total - failedFeeds);
    const failed = total - ok;
    const failed_list = Array.isArray(health.feeds) ? health.feeds.filter(f => !f.ok) : [];
    let html = `<span class="fhb-dot${failed ? ' fhb-dot--warn' : ''}" aria-hidden="true"></span><span class="fhb-info">${ok} of ${total} feeds online</span>`;
    if (failed > 0 && failed_list.length > 0) {
      const items = failed_list.map(f => `<li>${esc(f.name)}${f.error ? ' — ' + esc(f.error.slice(0, 60)) : ''}</li>`).join('');
      html += `<details class="fhb-details"><summary>${failed} need${failed === 1 ? 's' : ''} attention</summary><ul>${items}</ul></details>`;
    }
    bar.innerHTML = html;
    if (health.generatedAt) {
      try { bar.title = `Feed health checked ${new Date(health.generatedAt).toLocaleString()}`; } catch { /* skip */ }
    }
    bar.style.display = '';
  } catch (e) {
    console.debug('[GeeksPulse] feed-health.json unavailable:', e.message);
  }
}

// ── Site version badge + "last updated" ──────────────────────────

let versionLoaded = false;
async function loadSiteVersion() {
  if (versionLoaded) return;
  const el = document.getElementById('siteVersion');
  const about = document.getElementById('aboutLastUpdated');
  if (!el && !about) return;
  try {
    const resp = await fetch('/public/version.json', { cache: 'no-cache', signal: AbortSignal.timeout(4000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const v = await resp.json();
    versionLoaded = true;
    if (el) {
      el.textContent = `${v.version} · ${v.commit}`;
      el.title = `Build #${v.build} (${v.date}) — view changelog on GitHub`;
    }
    if (about && v.date) {
      const d = new Date(v.date + 'T12:00:00');
      if (!isNaN(d)) about.textContent = `Last deployed ${d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`;
    }
  } catch {
    if (el) el.textContent = 'version unavailable';
  }
}

// ── GitHub stars (fetched only when the About card nears the viewport) ─

function initGitHubStars() {
  const countEl = document.getElementById('ghStarCount');
  const target  = document.getElementById('about') || countEl;
  if (!countEl || !target) return;
  const run = () => fetch('https://api.github.com/repos/dante0747/geekspulse.dev', { signal: AbortSignal.timeout(6000) })
    .then(r => (r.ok ? r.json() : null))
    .then(d => {
      if (d && d.stargazers_count != null) {
        const n = d.stargazers_count;
        countEl.textContent = n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
      }
    })
    .catch(() => {});
  if (!('IntersectionObserver' in window)) { run(); return; }
  const io = new IntersectionObserver(entries => {
    if (entries.some(en => en.isIntersecting)) { io.disconnect(); run(); }
  }, { rootMargin: '600px 0px' });
  io.observe(target);
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
      <button type="button" class="filter-item${isActive ? ' active' : ''}" data-cat="${esc(c.id)}" aria-pressed="${isActive}">
        <span class="fi-icon ${catClass(c.id)}" aria-hidden="true">${c.icon}</span>
        <span class="fi-label">${esc(c.label)}</span>
        <span class="fi-count">${count}</span>
      </button>`;
  }).join('');

  mobileFilters.innerHTML = categories.map(c => {
    const isActive = c.id === activeFilter;
    return `
    <button type="button" class="chip${isActive ? ' active' : ''}" data-cat="${esc(c.id)}" aria-pressed="${isActive}">
      <span class="chip-icon ${catClass(c.id)}" aria-hidden="true">${c.icon}</span>${esc(c.id)}
    </button>`;
  }).join('');

  syncClearChip();

  if (typeof window.__updateFiltersMask === 'function') {
    setTimeout(window.__updateFiltersMask, 50);
  }
}

// "✕ Clear" chip appears in the mobile row whenever a non-All topic is active.
function syncClearChip() {
  const existing = mobileFilters.querySelector('.chip-clear');
  if (activeFilter === 'All') { existing?.remove(); return; }
  if (existing) return;
  const clearChip = document.createElement('button');
  clearChip.type = 'button';
  clearChip.className = 'chip chip-clear';
  clearChip.textContent = '✕ Clear';
  clearChip.setAttribute('aria-label', 'Clear topic filter');
  clearChip.addEventListener('click', () => setFilter('All'));
  mobileFilters.appendChild(clearChip);
}

function syncFilterButtons() {
  [sidebarFilters, mobileFilters].forEach(container => {
    container.querySelectorAll('[data-cat]').forEach(btn => {
      const active = btn.dataset.cat === activeFilter;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
  });
  syncClearChip();
}

/** After a filter change, bring the top of the feed back into view. */
function scrollFeedIntoView() {
  const layout = document.getElementById('latest');
  if (!layout) return;
  if (layout.getBoundingClientRect().top < 0) {
    layout.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }
}

function setFilter(cat) {
  if (!categories.some(c => c.id === cat)) cat = 'All';
  activeFilter = cat;
  activeSource = null;
  PREF.set('filter', cat);
  gaEvent('filter_category', { category: cat });
  syncFilterButtons();
  render();
  scrollFeedIntoView();
}

function setSource(name) {
  activeSource = name ? String(name).trim().slice(0, 120) || null : null;
  if (activeSource && activeFilter !== 'All') {
    activeFilter = 'All';
    PREF.set('filter', 'All');
    syncFilterButtons();
  }
  if (activeSource) gaEvent('filter_source', { source: activeSource });
  render();
  scrollFeedIntoView();
}

function renderActiveFilters() {
  const el = document.getElementById('activeFilters');
  if (!el) return;
  if (!activeSource) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `<span class="af-label">Showing stories from</span>
    <button type="button" class="af-pill" data-clear-source aria-label="Show all sources (currently ${esc(activeSource)})">
      ${esc(activeSource)}
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </button>`;
}

// ── URL state (?q= search, ?topic= filter, ?source= source) ───────

function readUrlState() {
  let params;
  try { params = new URLSearchParams(location.search); } catch { return; }
  const topic = params.get('topic') || params.get('category') || params.get('filter');
  if (topic) {
    const t = topic.trim().toLowerCase();
    const match = categories.find(c => c.id.toLowerCase() === t || c.label.toLowerCase() === t);
    if (match) activeFilter = match.id;
  }
  const source = params.get('source');
  if (source && source.trim()) activeSource = source.trim().slice(0, 120);
  const q = params.get('q');
  if (q && q.trim()) {
    searchQuery = q.trim().slice(0, 200);
    if (searchInput) searchInput.value = searchQuery;
    if (searchKbd) searchKbd.style.display = 'none';
  }
}

/** Resolve a ?source= value to the registry's canonical spelling once it loads. */
function canonicaliseSource() {
  if (!activeSource) return;
  const lower = activeSource.toLowerCase();
  const hit = getFeeds().find(f => f.name.toLowerCase() === lower || f.id === lower);
  if (hit) activeSource = hit.name;
}

function syncUrl() {
  try {
    const url = new URL(location.href);
    const set = (k, v) => (v ? url.searchParams.set(k, v) : url.searchParams.delete(k));
    set('q', searchQuery);
    set('topic', activeFilter !== 'All' && activeFilter !== 'Bookmarks' ? activeFilter : '');
    set('source', activeSource || '');
    url.searchParams.delete('category');
    url.searchParams.delete('filter');
    if (url.href !== location.href) history.replaceState(history.state, '', url);
  } catch { /* non-critical */ }
}

// ── View mode ─────────────────────────────────────────────────────

function applyView() {
  feedGrid.classList.toggle('list-view', viewMode === 'list');
  gridViewBtn.classList.toggle('active', viewMode === 'grid');
  listViewBtn.classList.toggle('active', viewMode === 'list');
  gridViewBtn.setAttribute('aria-pressed', String(viewMode === 'grid'));
  listViewBtn.setAttribute('aria-pressed', String(viewMode === 'list'));
  document.querySelectorAll('#settingsPopover [data-view]').forEach(b => {
    b.classList.toggle('active', b.dataset.view === viewMode);
    b.setAttribute('aria-pressed', String(b.dataset.view === viewMode));
  });
}

function setView(mode) {
  viewMode = mode === 'list' ? 'list' : 'grid';
  PREF.set('view', viewMode);
  applyView();
  render({ keepLimit: true });
}

// ── Nav scroll effect + hamburger menu ───────────────────────────

function initNav() {
  const nav = document.querySelector('.top-nav');
  if (!nav) return;
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Hamburger menu
  const hamburger = document.getElementById('navHamburger');
  const drawer    = document.getElementById('navDrawer');
  const backdrop  = document.getElementById('navDrawerBackdrop');
  if (!hamburger || !drawer || !backdrop) return;

  function openDrawer() {
    hamburger.classList.add('open');
    drawer.classList.add('open');
    backdrop.classList.add('open');
    hamburger.setAttribute('aria-expanded', 'true');
    hamburger.setAttribute('aria-label', 'Close navigation menu');
    drawer.removeAttribute('aria-hidden');
    const firstLink = drawer.querySelector('.nav-drawer-link');
    if (firstLink) setTimeout(() => firstLink.focus(), 50);
    document.body.style.overflow = 'hidden';
  }

  function closeDrawer() {
    hamburger.classList.remove('open');
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    hamburger.setAttribute('aria-label', 'Open navigation menu');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    hamburger.focus();
  }

  hamburger.addEventListener('click', () => {
    if (drawer.classList.contains('open')) closeDrawer(); else openDrawer();
  });

  backdrop.addEventListener('click', closeDrawer);

  // Close when a link is tapped
  drawer.querySelectorAll('.nav-drawer-link').forEach(link => {
    link.addEventListener('click', closeDrawer);
  });

  // Close on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
  });

  // Focus trap within drawer
  drawer.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const focusable = Array.from(drawer.querySelectorAll('.nav-drawer-link'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last  = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  });

  // Close the drawer if the viewport grows past the mobile breakpoint
  window.matchMedia?.('(min-width: 900px)').addEventListener?.('change', e => {
    if (e.matches && drawer.classList.contains('open')) closeDrawer();
  });
}

// ── Mobile filter chip mask ───────────────────────────────────────

function initMobileFiltersMask() {
  const el = document.getElementById('mobileFilters');
  if (!el) return;
  function updateMask() {
    const atLeft  = el.scrollLeft <= 2;
    const atRight = el.scrollLeft >= el.scrollWidth - el.clientWidth - 2;
    el.classList.remove('mask-left', 'mask-right', 'mask-both');
    if (!atLeft && !atRight) el.classList.add('mask-both');
    else if (!atLeft) el.classList.add('mask-left');
    else if (!atRight) el.classList.add('mask-right');
  }
  el.addEventListener('scroll', updateMask, { passive: true });
  // re-check after filters build
  window.addEventListener('resize', updateMask, { passive: true });
  setTimeout(updateMask, 100);
  window.__updateFiltersMask = updateMask;
}

// ── Auto-refresh ──────────────────────────────────────────────────

function updateCountdownUI(secs) {
  const el = document.getElementById('autoRefreshCountdown');
  if (!el) return;
  if (!secs || secs <= 0) { el.textContent = ''; el.style.display = 'none'; return; }
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  el.textContent = `↻ ${m}:${String(s).padStart(2, '0')}`;
  el.title = 'Time until the next automatic refresh';
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
  const prefs = loadPreferences();
  const active = hasActivePreferences(prefs);
  document.getElementById('myPulseBtn')?.classList.toggle('has-active', active);
  if (!bar) return;
  if (!active) { bar.style.display = 'none'; return; }
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
    <span class="psb-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg></span>
    <span class="psb-label">My Pulse</span>
    ${parts.map(p => `<span class="psb-pill">${esc(p)}</span>`).join('')}
    <button type="button" class="psb-reset" id="pulseSummaryReset" aria-label="Reset My Pulse filters">Reset</button>
    <button type="button" class="psb-edit" id="pulseSummaryEdit" aria-label="Edit My Pulse filters">Edit</button>`;
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

function showStaleCacheBanner(builtAt) {
  let bar = document.getElementById('staleCacheBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'staleCacheBar';
    bar.className = 'stale-cache-bar';
    bar.setAttribute('role', 'status');
    const grid = feedGrid?.parentNode;
    if (grid) grid.insertBefore(bar, feedGrid);
  }
  try {
    const ageMs = Date.now() - new Date(builtAt).getTime();
    const hoursAgo = Math.max(1, Math.round(ageMs / 3_600_000));
    bar.innerHTML =
      `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>` +
      `<span>These stories are <strong>${hoursAgo}h old</strong> — the hourly rebuild may be running late.</span>` +
      `<button type="button" class="stale-cache-bar__refresh" id="staleCacheRefresh">Refresh now</button>`;
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
  const isRefresh = allArticles.length > 0;
  isLoading = true;
  failedFeeds = 0;
  setLoading();

  let cacheGeneratedAt = null;

  try {
    const data = await loadFeedCache();
    allArticles = data.articles.map(normaliseCachedArticle).filter(a => a.link && a.link !== '#');
    failedFeeds = data.failedFeeds || 0;
    cacheGeneratedAt = data.generatedAt || null;
    if (data.feedCount) { feedCount = data.feedCount; updateFeedCountSpans(data.feedCount); }
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
      await registryReady;
      const result = await fetchAllFromRSS();
      allArticles = result.articles;
      failedFeeds = result.failedCount;
    } catch (rssErr) {
      console.error('[GeeksPulse] Emergency RSS fallback also failed:', rssErr.message);
      allArticles = [];
      showError('Unable to load articles. Please try refreshing the page or check back later.');
    }
  }

  await registryReady;
  canonicaliseSource();
  generatedAt = cacheGeneratedAt;
  isLoading = false;
  setLive();
  updateSidebarStats(cacheGeneratedAt);
  loadFeedHealthBanner();
  loadSiteVersion();
  buildFilters();
  render({ keepLimit: isRefresh });

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

// ── Keyboard shortcuts ────────────────────────────────────────────

function isOverlayOpen() {
  return Boolean(document.querySelector(
    '#summaryModal.open, .pp-modal-backdrop.open, .my-pulse-drawer.open, .settings-popover.open, .cache-confirm-overlay, .nav-drawer.open, dialog[open]'
  ));
}

function moveCardFocus(step) {
  let cards = Array.from(feedGrid.querySelectorAll('.card'));
  if (!cards.length) return;
  let idx = focusedCardIdx + step;
  if (step > 0 && idx >= cards.length && showMore()) {
    cards = Array.from(feedGrid.querySelectorAll('.card'));
  }
  idx = Math.max(0, Math.min(idx, cards.length - 1));
  focusedCardIdx = idx;
  const card = cards[idx];
  card.querySelector('.card-title a')?.focus({ preventScroll: true });
  card.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
}

function openShortcutsDialog() {
  const dlg = document.getElementById('shortcutsDialog');
  if (dlg && !dlg.open && typeof dlg.showModal === 'function') {
    dlg.showModal();
    gaEvent('shortcuts_open', {});
  }
}

function initShortcutsDialog() {
  const dlg = document.getElementById('shortcutsDialog');
  if (!dlg) return;
  document.addEventListener('click', e => {
    if (e.target.closest('[data-shortcuts]')) { e.preventDefault(); openShortcutsDialog(); }
  });
  dlg.addEventListener('click', e => {
    // Clicks on the ::backdrop target the <dialog> element itself
    if (e.target === dlg || e.target.closest('[data-close-dialog]')) dlg.close();
  });
}

function initKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    const active = document.activeElement;
    const tag = active?.tagName?.toLowerCase();
    const inInput = tag === 'input' || tag === 'textarea' || tag === 'select' || active?.isContentEditable;

    if (e.key === 'Escape' && active === searchInput) {
      searchInput.blur();
      if (searchInput.value || searchQuery) { searchInput.value = ''; searchQuery = ''; render(); }
      if (searchKbd) searchKbd.style.display = '';
      return;
    }
    if (inInput || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (isOverlayOpen()) return;

    const cards = () => Array.from(feedGrid.querySelectorAll('.card'));
    switch (e.key) {
      case '/':
        e.preventDefault(); searchInput?.focus(); searchInput?.select();
        break;
      case 'r':
        fetchAll();
        break;
      case 'j':
      case 'k':
        e.preventDefault();
        moveCardFocus(e.key === 'j' ? 1 : -1);
        break;
      case 'o': {
        if (focusedCardIdx < 0) break;
        const link = cards()[focusedCardIdx]?.querySelector('.card-title a');
        if (link) window.open(link.href, '_blank', 'noopener,noreferrer');
        break;
      }
      case 'b': {
        if (focusedCardIdx < 0) break;
        cards()[focusedCardIdx]?.querySelector('.bm-btn')?.click();
        break;
      }
      case 'v':
        setView(viewMode === 'grid' ? 'list' : 'grid');
        break;
      case '?':
        e.preventDefault();
        openShortcutsDialog();
        break;
      default:
        break;
    }
  });
}

// ── Briefing header date ──────────────────────────────────────────

function renderBriefingDate() {
  const el = document.getElementById('briefingDate');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// ── Last-visit marker (for "new since your last visit") ──────────

function initLastVisit() {
  try {
    previousVisit = parseInt(localStorage.getItem(LAST_VISIT_KEY) || '0', 10) || 0;
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
  } catch { previousVisit = 0; }
}

// ── Init ──────────────────────────────────────────────────────────

async function init() {
  initTheme();
  initLastVisit();
  renderBriefingDate();
  readUrlState();

  // The feed registry only feeds the source list, counts and the emergency
  // RSS fallback — load it alongside the feed instead of blocking the UI.
  registryReady = loadFeedsRegistry().then(() => {
    const n = getFeeds().length;
    if (n && !feedCount) updateFeedCountSpans(n);
  });

  initNav();
  initMobileFiltersMask();
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
  initShortcutsDialog();
  initKeyboardShortcuts();
  initGitHubStars();
  applyView();
  buildFilters();
  updateBookmarkCount();

  // Expose public globals
  window.__setFilter    = setFilter;
  window.__setSource    = setSource;
  window.resetPreferences = resetPreferences;
  window.syncMyPulsePanelIfOpen = syncMyPulsePanelIfOpen;
  window.__pulseReset   = () => { resetPreferences(); render(); syncMyPulsePanelIfOpen(); };

  // Topic filters (bound once — the buttons inside are re-rendered)
  [sidebarFilters, mobileFilters].forEach(el => {
    el.addEventListener('click', e => {
      const btn = e.target.closest('[data-cat]');
      if (!btn) return;
      setFilter(btn.dataset.cat);
    });
  });

  // Any link or button carrying data-filter (footer source directory, etc.)
  document.addEventListener('click', e => {
    const link = e.target.closest('[data-filter]');
    if (!link || e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    setFilter(link.dataset.filter);
    document.getElementById('latest')?.scrollIntoView({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });

  document.getElementById('activeFilters')?.addEventListener('click', e => {
    if (e.target.closest('[data-clear-source]')) setSource(null);
  });

  gridViewBtn.addEventListener('click', () => setView('grid'));
  listViewBtn.addEventListener('click', () => setView('list'));

  if (refreshBtnHero) refreshBtnHero.addEventListener('click', () => {
    gaEvent('refresh_feeds', { trigger: 'refreshBtnHero' });
    fetchAll();
  });

  $('showMoreBtn')?.addEventListener('click', () => showMore({ focusFirstNew: true }));

  fetchAll().then(() => startAutoRefresh(autoRefreshMin));

  // Register Service Worker for offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).then(reg => {
      console.debug('[GeeksPulse] SW registered, scope:', reg.scope);
    }).catch(err => {
      console.warn('[GeeksPulse] SW registration failed:', err.message);
    });
  }

  // Clear bookmarks (with undo)
  const clearBmBtn = document.getElementById('clearBookmarksBtn');
  if (clearBmBtn) {
    clearBmBtn.addEventListener('click', () => {
      const previous = loadBookmarks();
      if (previous.length === 0) { showBmToast('No saved stories to clear'); return; }
      saveBookmarks([]);
      buildFilters();
      updateBookmarkCount();
      if (activeFilter === 'Bookmarks') render();
      else feedGrid.querySelectorAll('.bm-btn.bm-active').forEach(b => markBookmarkButton(b, false));
      showBmToast(`Cleared ${previous.length} saved ${previous.length === 1 ? 'story' : 'stories'}`, {
        label: 'Undo',
        onClick: () => {
          saveBookmarks(previous);
          buildFilters();
          updateBookmarkCount();
          render({ keepLimit: true });
        },
      });
    });
  }

  // Keep the keyboard cursor (j/k) in sync with Tab / click focus
  feedGrid.addEventListener('focusin', e => {
    const card = e.target.closest('.card');
    if (!card) return;
    focusedCardIdx = Array.prototype.indexOf.call(feedGrid.querySelectorAll('.card'), card);
  });

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
  function markBookmarkButton(btn, added) {
    const svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', added ? 'currentColor' : 'none');
    btn.classList.toggle('bm-active', added);
    btn.title = added ? 'Remove bookmark' : 'Save to GeeksPulse bookmarks';
    btn.setAttribute('aria-label', added ? 'Remove bookmark' : 'Bookmark this article');
  }

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
    markBookmarkButton(btn, added);
    showBmToast(added ? 'Saved to your library' : 'Removed from your library');
    buildFilters();
    updateBookmarkCount();
    if (activeFilter === 'Bookmarks') render({ keepLimit: true });
  });

  // Share delegation — on document so the server-rendered fallback cards work too
  document.addEventListener('click', e => {
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
      title:       btn.dataset.summaryTitle,
      snippet:     btn.dataset.summarySnippet,
      summaryType: btn.dataset.summaryType,
      link:        btn.dataset.summaryLink,
      source:      btn.dataset.summarySource,
    });
  });

  // Source name → "more from this source"
  feedGrid.addEventListener('click', e => {
    const btn = e.target.closest('.card-source-name[data-source]');
    if (!btn) return;
    e.preventDefault(); e.stopPropagation();
    setSource(btn.dataset.source);
  });

  // Empty-state actions
  feedGrid.addEventListener('click', e => {
    if (e.target.closest('[data-pulse-reset]')) { window.__pulseReset(); return; }
    if (e.target.closest('[data-clear-search]') && searchInput) {
      searchInput.value = ''; searchQuery = ''; render();
      if (searchKbd) searchKbd.style.display = '';
      searchInput.focus();
    }
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
      article_source: card.querySelector('.card-source-name')?.textContent?.trim() || '',
      article_category: card.dataset.category || '',
    });
  });

  // Search
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
        if (nlBtn) { nlBtn.disabled = false; nlBtn.textContent = 'Subscribe free'; }
      }
    });
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Initialise cookie/analytics consent (GDPR)
  initConsent();

  init();

  // Back to top button
  const btn = document.getElementById('backToTop');
  if (!btn) return;
  let visible = false;
  let hideTimer = null;

  function onScroll() {
    const shouldShow = window.scrollY > 900;
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
  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    document.querySelector('.logo')?.focus({ preventScroll: true });
  });
});
