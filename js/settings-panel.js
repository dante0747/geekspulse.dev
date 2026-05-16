import { REFRESH_OPTIONS } from './config.js';
import { PREF } from './storage.js';
import { showBmToast } from './utils.js';

/**
 * @param {object} ctx
 * @param {() => number}  ctx.getAutoRefreshMin
 * @param {(v: number) => void} ctx.setAutoRefreshMin
 * @param {() => string}  ctx.getViewMode
 * @param {(v: string) => void} ctx.setViewMode
 * @param {() => void}    ctx.applyView
 * @param {() => void}    ctx.render
 * @param {(min: number) => void} ctx.startAutoRefresh
 */
export function initSettings(ctx) {
  const { getAutoRefreshMin, setAutoRefreshMin, getViewMode, setViewMode, applyView, render, startAutoRefresh } = ctx;

  const navActions = document.querySelector('.nav-actions');
  if (!navActions) return;

  const settingsBtn = document.createElement('button');
  settingsBtn.id = 'settingsBtn';
  settingsBtn.className = 'btn btn-ghost btn-sm';
  settingsBtn.title = 'Settings';
  settingsBtn.setAttribute('aria-label', 'Open settings');
  settingsBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg><span class="btn-label"> Settings</span>';
  navActions.insertBefore(settingsBtn, navActions.lastElementChild);

  // Countdown badge
  const toolbarLeft = document.querySelector('.toolbar-left');
  if (toolbarLeft) {
    const cd = document.createElement('span');
    cd.id = 'autoRefreshCountdown';
    cd.className = 'auto-countdown';
    cd.style.display = 'none';
    toolbarLeft.appendChild(cd);
  }

  const popover = document.createElement('div');
  popover.id = 'settingsPopover';
  popover.className = 'settings-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Settings');
  popover.innerHTML = `
    <div class="settings-header">
      <span class="settings-title"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>Settings</span>
    </div>
    <div class="settings-section">
      <div class="settings-label">Auto-refresh</div>
      <div class="settings-options" id="refreshOptions">
        ${REFRESH_OPTIONS.map(o => `
          <button class="settings-opt${getAutoRefreshMin() === o.value ? ' active' : ''}"
                  data-refresh="${o.value}">${o.label}</button>
        `).join('')}
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-label">View</div>
      <div class="settings-options">
        <button class="settings-opt${getViewMode() === 'grid' ? ' active' : ''}" data-view="grid">Grid</button>
        <button class="settings-opt${getViewMode() === 'list' ? ' active' : ''}" data-view="list">List</button>
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-label">Cache</div>
      <button class="settings-opt settings-opt--danger" id="clearCacheBtn" style="width:100%;text-align:left;">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Clear all site data
      </button>
    </div>
    <div class="settings-footer">
      <span class="settings-note">// prefs saved in localStorage</span>
    </div>`;
  document.body.appendChild(popover);

  let open = false;
  const openPopover = () => {
    open = true;
    const r = settingsBtn.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.top   = (r.bottom + 8) + 'px';
    popover.style.right = (window.innerWidth - r.right) + 'px';
    popover.style.left  = '';
    popover.classList.add('open');
  };
  const closePopover = () => { open = false; popover.classList.remove('open'); };

  settingsBtn.addEventListener('click', e => { e.stopPropagation(); open ? closePopover() : openPopover(); });
  document.addEventListener('click', e => { if (open && !popover.contains(e.target)) closePopover(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopover(); });

  // Auto-refresh
  popover.querySelector('#refreshOptions').addEventListener('click', e => {
    const btn = e.target.closest('[data-refresh]');
    if (!btn) return;
    setAutoRefreshMin(parseInt(btn.dataset.refresh, 10));
    PREF.set('autorefresh', getAutoRefreshMin());
    popover.querySelectorAll('[data-refresh]').forEach(b =>
      b.classList.toggle('active', parseInt(b.dataset.refresh, 10) === getAutoRefreshMin())
    );
    startAutoRefresh(getAutoRefreshMin());
  });

  // View toggle
  popover.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      setViewMode(btn.dataset.view);
      PREF.set('view', getViewMode());
      applyView();
      render();
      popover.querySelectorAll('[data-view]').forEach(b =>
        b.classList.toggle('active', b.dataset.view === getViewMode())
      );
      document.getElementById('gridViewBtn')?.classList.toggle('active', getViewMode() === 'grid');
      document.getElementById('listViewBtn')?.classList.toggle('active', getViewMode() === 'list');
    });
  });

  // Clear cache
  popover.querySelector('#clearCacheBtn')?.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'cache-confirm-overlay';
    overlay.innerHTML = `
      <div class="cache-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cacheConfirmTitle">
        <div class="cache-confirm-icon">
          <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </div>
        <h3 id="cacheConfirmTitle" class="cache-confirm-title">Clear all site data?</h3>
        <p class="cache-confirm-desc">This will remove all cached images, bookmarks, and preferences (theme, view, filters, auto-refresh). The page will reload.<br/><span class="cache-confirm-note">// This action cannot be undone.</span></p>
        <div class="cache-confirm-actions">
          <button class="btn btn-ghost btn-sm" id="cacheConfirmCancel">Cancel</button>
          <button class="btn btn-sm cache-confirm-delete" id="cacheConfirmOk">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:5px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Yes, clear everything
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    closePopover();

    const removeOverlay = () => overlay.remove();
    overlay.querySelector('#cacheConfirmCancel').addEventListener('click', removeOverlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) removeOverlay(); });
    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') { removeOverlay(); document.removeEventListener('keydown', onKey); }
    });

    overlay.querySelector('#cacheConfirmOk').addEventListener('click', () => {
      const siteKeys = Object.keys(localStorage).filter(k =>
        k.startsWith('gp:') || k.startsWith('geeksup_') || k.startsWith('geekspulse.')
      );
      siteKeys.forEach(k => localStorage.removeItem(k));
      removeOverlay();
      showBmToast(`🗑️ Cache cleared (${siteKeys.length} item${siteKeys.length !== 1 ? 's' : ''}) — reloading…`);
      setTimeout(() => location.reload(), 1200);
    });
  });

}

