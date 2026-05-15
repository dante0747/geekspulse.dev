import { categories } from './config.js';
import { getFeeds } from './feeds-registry.js';
import { loadPreferences, savePreferences, resetPreferences, PULSE_PREF_KEY } from './storage.js';
import { esc, showBmToast } from './utils.js';

/**
 * @param {object} ctx
 * @param {() => void} ctx.render
 * @param {() => void} ctx.buildFilters
 */
export function initMyPulse({ render, buildFilters }) {
  const navActions = document.querySelector('.nav-actions');
  if (!navActions) return;

  const myPulseBtn = document.createElement('button');
  myPulseBtn.id = 'myPulseBtn';
  myPulseBtn.className = 'btn btn-ghost btn-sm';
  myPulseBtn.title = 'My Pulse — customize your feed';
  myPulseBtn.setAttribute('aria-label', 'Open My Pulse signal filters');
  myPulseBtn.setAttribute('aria-haspopup', 'dialog');
  myPulseBtn.innerHTML = `<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg><span class="btn-label"> My Pulse</span>`;
  const settingsBtn = document.getElementById('settingsBtn');
  navActions.insertBefore(myPulseBtn, settingsBtn || navActions.lastElementChild);

  // Summary bar (inserted before feedGrid by main.js via window.__insertPulseSummary)
  const feedGrid = document.getElementById('feedGrid');
  const summaryBar = document.createElement('div');
  summaryBar.id = 'pulseSummaryBar';
  summaryBar.className = 'pulse-summary-bar';
  summaryBar.setAttribute('aria-live', 'polite');
  summaryBar.style.display = 'none';
  feedGrid?.parentNode?.insertBefore(summaryBar, feedGrid);

  const backdrop = document.createElement('div');
  backdrop.id = 'myPulseBackdrop';
  backdrop.className = 'my-pulse-backdrop';
  const drawer = document.createElement('div');
  drawer.id = 'myPulseDrawer';
  drawer.className = 'my-pulse-drawer';
  drawer.setAttribute('role', 'dialog');
  drawer.setAttribute('aria-label', 'My Pulse — Signal Filters');
  drawer.setAttribute('aria-modal', 'true');
  document.body.appendChild(backdrop);
  document.body.appendChild(drawer);

  const filterCategories = categories.filter(c => c.id !== 'All' && c.id !== 'Bookmarks');
  const sourceNames = getFeeds().map(f => f.name);
  const AGE_OPTIONS = [
    { value: 'any', label: 'Any time' },
    { value: '24h', label: 'Last 24h' },
    { value: '7d',  label: 'Last 7 days' },
    { value: '30d', label: 'Last 30 days' },
  ];
  const PRESETS = [
    { label: 'Backend',  cats: ['General','Java','Python','Go','Rust','Architecture'] },
    { label: 'Frontend', cats: ['JavaScript'] },
    { label: 'DevOps',   cats: ['DevOps'] },
    { label: 'Security', cats: ['Security'] },
    { label: 'AI',       cats: ['AI'] },
  ];

  function buildDrawerContent() {
    const prefs = loadPreferences();
    drawer.innerHTML = `
      <div class="mpd-header">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
          <span class="mpd-title"><svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>My Pulse</span>
          <button class="mpd-close" id="myPulseClose" aria-label="Close My Pulse panel">✕</button>
        </div>
        <div class="mpd-subtitle">// customize your developer signal</div>
      </div>
      <div class="mpd-body">
        <div class="settings-section">
          <div class="settings-label">Noise Filters</div>
          <label class="mpd-toggle">
            <input type="checkbox" id="mpHideSponsored" ${prefs.hideSponsored ? 'checked' : ''} aria-label="Hide sponsored and promotional content" />
            <span class="mpd-toggle-track" aria-hidden="true"></span>
            <span class="mpd-toggle-label">Hide sponsored / promotional content</span>
          </label>
        </div>
        <div class="settings-section">
          <div class="settings-label">Article Age</div>
          <div class="settings-options" id="mpAgeOptions" role="group" aria-label="Filter by article age">
            ${AGE_OPTIONS.map(o => `<button class="settings-opt${prefs.maxAge === o.value ? ' active' : ''}" data-age="${o.value}" aria-pressed="${prefs.maxAge === o.value}">${o.label}</button>`).join('')}
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-label" style="display:flex;justify-content:space-between;align-items:center">
            <span>Topics <span class="mpd-count" id="mpCatCount">${prefs.blockedCategories.length > 0 ? `(${prefs.blockedCategories.length} hidden)` : ''}</span></span>
            <button class="mpd-link" id="mpShowAllCats" aria-label="Show all topics">Show all</button>
          </div>
          <div class="mpd-chip-group" id="mpCategoryChips" role="group" aria-label="Topic filters">
            ${filterCategories.map(c => {
              const blocked = prefs.blockedCategories.includes(c.id);
              return `<button class="mpd-chip${blocked ? ' mpd-chip--muted' : ''}" data-cat-chip="${esc(c.id)}" aria-pressed="${blocked}" title="${blocked ? 'Show' : 'Hide'} ${esc(c.label)} articles" style="--chip-color:${c.color}">
                <span aria-hidden="true" style="display:inline-flex;align-items:center;color:${blocked ? 'var(--ink3)' : c.color};margin-right:4px">${c.icon.replace(/width="\d+" height="\d+"/, 'width="11" height="11"')}</span>${esc(c.id)}
              </button>`;
            }).join('')}
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-label" style="display:flex;justify-content:space-between;align-items:center">
            <span>Sources <span class="mpd-count" id="mpSrcCount">${prefs.mutedSources.length > 0 ? `(${prefs.mutedSources.length} muted)` : ''}</span></span>
            <button class="mpd-link" id="mpUnmuteAll" aria-label="Unmute all sources">Unmute all</button>
          </div>
          <div class="mpd-source-list" id="mpSourceList" role="group" aria-label="Source mute controls">
            ${sourceNames.map(name => {
              const muted = prefs.mutedSources.includes(name);
              return `<button class="mpd-source${muted ? ' mpd-source--muted' : ''}" data-src-mute="${esc(name)}" aria-pressed="${muted}" title="${muted ? 'Unmute' : 'Mute'} ${esc(name)}">
                <span class="mpd-src-name">${esc(name)}</span>
                <span class="mpd-src-badge">${muted ? 'muted' : '✓ live'}</span>
              </button>`;
            }).join('')}
          </div>
        </div>
        <div class="settings-section">
          <div class="settings-label">Quick Presets</div>
          <div class="settings-options" role="group" aria-label="Topic presets">
            ${PRESETS.map(p => `<button class="settings-opt mpd-preset" data-preset='${JSON.stringify(p.cats)}' title="Show only ${p.label} topics">${p.label}</button>`).join('')}
          </div>
        </div>
      </div>
      <div class="mpd-footer">
        <button class="settings-opt settings-opt--danger mpd-reset-btn" id="mpResetBtn" aria-label="Reset all My Pulse filters to defaults">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-5"/></svg>Reset to defaults
        </button>
        <span class="settings-note">// prefs saved in localStorage</span>
      </div>`;
    wireDrawerEvents();
  }

  function wireDrawerEvents() {
    drawer.querySelector('#myPulseClose')?.addEventListener('click', closeDrawer);

    drawer.querySelector('#mpHideSponsored')?.addEventListener('change', e => {
      const p = loadPreferences();
      p.hideSponsored = e.target.checked;
      savePreferences(p);
      render();
    });

    drawer.querySelector('#mpAgeOptions')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-age]');
      if (!btn) return;
      const p = loadPreferences();
      p.maxAge = btn.dataset.age;
      savePreferences(p);
      drawer.querySelectorAll('[data-age]').forEach(b => {
        b.classList.toggle('active', b.dataset.age === p.maxAge);
        b.setAttribute('aria-pressed', String(b.dataset.age === p.maxAge));
      });
      render();
    });

    drawer.querySelector('#mpCategoryChips')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-cat-chip]');
      if (!btn) return;
      const cat = btn.dataset.catChip;
      const p = loadPreferences();
      const idx = p.blockedCategories.indexOf(cat);
      if (idx === -1) p.blockedCategories.push(cat);
      else p.blockedCategories.splice(idx, 1);
      savePreferences(p);
      const blocked = p.blockedCategories.includes(cat);
      btn.classList.toggle('mpd-chip--muted', blocked);
      btn.setAttribute('aria-pressed', String(blocked));
      btn.title = (blocked ? 'Show' : 'Hide') + ' ' + cat + ' articles';
      const icon = btn.querySelector('span:first-child');
      const catObj = categories.find(c => c.id === cat);
      if (icon && catObj) icon.style.color = blocked ? 'var(--ink3)' : catObj.color;
      const countEl = drawer.querySelector('#mpCatCount');
      if (countEl) countEl.textContent = p.blockedCategories.length > 0 ? `(${p.blockedCategories.length} hidden)` : '';
      render();
    });

    drawer.querySelector('#mpShowAllCats')?.addEventListener('click', () => {
      const p = loadPreferences();
      p.blockedCategories = [];
      savePreferences(p);
      buildDrawerContent();
      render();
    });

    drawer.querySelector('#mpSourceList')?.addEventListener('click', e => {
      const btn = e.target.closest('[data-src-mute]');
      if (!btn) return;
      const src = btn.dataset.srcMute;
      const p = loadPreferences();
      const idx = p.mutedSources.indexOf(src);
      if (idx === -1) p.mutedSources.push(src);
      else p.mutedSources.splice(idx, 1);
      savePreferences(p);
      const muted = p.mutedSources.includes(src);
      btn.classList.toggle('mpd-source--muted', muted);
      btn.setAttribute('aria-pressed', String(muted));
      btn.title = (muted ? 'Unmute' : 'Mute') + ' ' + src;
      const badge = btn.querySelector('.mpd-src-badge');
      if (badge) badge.textContent = muted ? 'muted' : '✓ live';
      const countEl = drawer.querySelector('#mpSrcCount');
      if (countEl) countEl.textContent = p.mutedSources.length > 0 ? `(${p.mutedSources.length} muted)` : '';
      render();
    });

    drawer.querySelector('#mpUnmuteAll')?.addEventListener('click', () => {
      const p = loadPreferences();
      p.mutedSources = [];
      savePreferences(p);
      buildDrawerContent();
      render();
    });

    drawer.querySelectorAll('.mpd-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        try {
          const cats = JSON.parse(btn.dataset.preset);
          const p = loadPreferences();
          const allCatIds = filterCategories.map(c => c.id);
          p.blockedCategories = allCatIds.filter(id => !cats.includes(id));
          savePreferences(p);
          buildDrawerContent();
          render();
        } catch { /* ignore */ }
      });
    });

    drawer.querySelector('#mpResetBtn')?.addEventListener('click', () => {
      resetPreferences();
      buildDrawerContent();
      render();
      showBmToast('✨ My Pulse reset to defaults');
    });
  }

  function openDrawer() {
    buildDrawerContent();
    drawer.classList.add('open');
    backdrop.classList.add('open');
    myPulseBtn.setAttribute('aria-expanded', 'true');
    if (!localStorage.getItem('gp:pulse:seen')) localStorage.setItem('gp:pulse:seen', '1');
    const nudge = document.getElementById('pulseNudge');
    if (nudge) nudge.remove();
    setTimeout(() => {
      const firstFocus = drawer.querySelector('button,input');
      if (firstFocus) firstFocus.focus();
    }, 80);
  }

  function closeDrawer() {
    drawer.classList.remove('open');
    backdrop.classList.remove('open');
    myPulseBtn.setAttribute('aria-expanded', 'false');
    myPulseBtn.focus();
  }

  window.__openMyPulse = openDrawer;
  window.__syncMyPulse = () => { if (drawer.classList.contains('open')) buildDrawerContent(); };

  myPulseBtn.addEventListener('click', () => {
    drawer.classList.contains('open') ? closeDrawer() : openDrawer();
  });
  backdrop.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) closeDrawer();
  });

  // First-time onboarding nudge
  if (!localStorage.getItem('gp:pulse:seen') && !localStorage.getItem(PULSE_PREF_KEY)) {
    setTimeout(() => {
      const nudge = document.createElement('div');
      nudge.id = 'pulseNudge';
      nudge.className = 'pulse-nudge';
      nudge.setAttribute('role', 'status');
      nudge.innerHTML = `
        <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;color:var(--cyan)"><path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z"/></svg>
        <span>Customize your Pulse in 30 seconds.</span>
        <button class="pulse-nudge-btn" id="pulseNudgeOpen">Set up My Pulse →</button>
        <button class="pulse-nudge-close" aria-label="Dismiss this message" id="pulseNudgeDismiss">✕</button>`;
      const healthBar = document.getElementById('feedHealthBar');
      const anchor = healthBar || feedGrid;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(nudge, anchor.nextSibling || anchor);
      document.getElementById('pulseNudgeOpen')?.addEventListener('click', () => { nudge.remove(); openDrawer(); });
      document.getElementById('pulseNudgeDismiss')?.addEventListener('click', () => { nudge.remove(); localStorage.setItem('gp:pulse:seen', '1'); });
      setTimeout(() => { nudge.remove(); }, 10000);
    }, 1500);
  }
}

