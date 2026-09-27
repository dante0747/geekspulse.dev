import { REFRESH_OPTIONS } from './config.js';
import { PREF } from './storage.js';
import { showBmToast, trapTabKey, restoreFocus } from './utils.js';
import { getThemePref, setThemePref } from './theme.js';

const GEAR_ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>';

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light',  label: 'Light'  },
  { value: 'dark',   label: 'Dark'   },
];

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
  settingsBtn.type = 'button';
  settingsBtn.id = 'settingsBtn';
  settingsBtn.className = 'btn btn-ghost btn-sm';
  settingsBtn.title = 'Settings';
  settingsBtn.setAttribute('aria-label', 'Open settings');
  settingsBtn.setAttribute('aria-haspopup', 'dialog');
  settingsBtn.setAttribute('aria-expanded', 'false');
  settingsBtn.setAttribute('aria-controls', 'settingsPopover');
  settingsBtn.innerHTML = `${GEAR_ICON}<span class="btn-label">Settings</span>`;
  // Order in the nav: My Pulse · Settings · Support · (hamburger)
  const anchor = navActions.querySelector('[data-support]') || navActions.lastElementChild;
  navActions.insertBefore(settingsBtn, anchor);

  // Countdown badge
  const toolbarLeft = document.querySelector('.toolbar-left');
  if (toolbarLeft) {
    const cd = document.createElement('span');
    cd.id = 'autoRefreshCountdown';
    cd.className = 'auto-countdown';
    cd.style.display = 'none';
    toolbarLeft.appendChild(cd);
  }

  const opt = (attr, value, label, active) =>
    `<button type="button" class="settings-opt${active ? ' active' : ''}" ${attr}="${value}" aria-pressed="${active}">${label}</button>`;

  const popover = document.createElement('div');
  popover.id = 'settingsPopover';
  popover.className = 'settings-popover';
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-labelledby', 'settingsTitle');
  popover.innerHTML = `
    <div class="settings-header">
      <span class="settings-title" id="settingsTitle">Settings</span>
    </div>
    <div class="settings-section">
      <div class="settings-label" id="settingsThemeLabel">Theme</div>
      <div class="settings-options" id="themeOptions" role="group" aria-labelledby="settingsThemeLabel">
        ${THEME_OPTIONS.map(o => opt('data-theme-opt', o.value, o.label, getThemePref() === o.value)).join('')}
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-label" id="settingsViewLabel">Layout</div>
      <div class="settings-options" role="group" aria-labelledby="settingsViewLabel">
        ${opt('data-view', 'grid', 'Grid', getViewMode() === 'grid')}
        ${opt('data-view', 'list', 'List', getViewMode() === 'list')}
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-label" id="settingsRefreshLabel">Auto-refresh</div>
      <div class="settings-options" id="refreshOptions" role="group" aria-labelledby="settingsRefreshLabel">
        ${REFRESH_OPTIONS.map(o => opt('data-refresh', o.value, o.label, getAutoRefreshMin() === o.value)).join('')}
      </div>
    </div>
    <div class="settings-section">
      <div class="settings-label">Data</div>
      <button type="button" class="settings-opt settings-opt--danger" id="clearCacheBtn">
        <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Clear all site data
      </button>
    </div>
    <div class="settings-footer">
      <span class="settings-note">Preferences are saved in this browser only. Press <kbd>?</kbd> for keyboard shortcuts.</span>
    </div>`;
  document.body.appendChild(popover);

  let open = false;
  let returnFocusTo = null;
  const positionPopover = () => {
    const r = settingsBtn.getBoundingClientRect();
    popover.style.position = 'fixed';
    popover.style.top   = (r.bottom + 8) + 'px';
    popover.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    popover.style.left  = '';
  };
  const openPopover = () => {
    open = true;
    returnFocusTo = document.activeElement;
    positionPopover();
    popover.classList.add('open');
    settingsBtn.setAttribute('aria-expanded', 'true');
    const first = popover.querySelector('.settings-opt.active') || popover.querySelector('button');
    setTimeout(() => first?.focus(), 30);
  };
  const closePopover = ({ restore = true } = {}) => {
    if (!open) return;
    open = false;
    popover.classList.remove('open');
    settingsBtn.setAttribute('aria-expanded', 'false');
    if (restore) restoreFocus(returnFocusTo || settingsBtn);
  };

  settingsBtn.addEventListener('click', e => { e.stopPropagation(); open ? closePopover() : openPopover(); });
  document.addEventListener('click', e => {
    if (open && !popover.contains(e.target) && !settingsBtn.contains(e.target)) closePopover({ restore: false });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && open) closePopover(); });
  popover.addEventListener('keydown', e => trapTabKey(popover, e));
  window.addEventListener('resize', () => { if (open) positionPopover(); }, { passive: true });

  const syncGroup = (selector, isActive) => {
    popover.querySelectorAll(selector).forEach(b => {
      const active = isActive(b);
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  };

  // Theme
  popover.querySelector('#themeOptions').addEventListener('click', e => {
    const btn = e.target.closest('[data-theme-opt]');
    if (!btn) return;
    const value = setThemePref(btn.dataset.themeOpt);
    syncGroup('[data-theme-opt]', b => b.dataset.themeOpt === value);
  });

  // Auto-refresh
  popover.querySelector('#refreshOptions').addEventListener('click', e => {
    const btn = e.target.closest('[data-refresh]');
    if (!btn) return;
    setAutoRefreshMin(parseInt(btn.dataset.refresh, 10));
    PREF.set('autorefresh', getAutoRefreshMin());
    syncGroup('[data-refresh]', b => parseInt(b.dataset.refresh, 10) === getAutoRefreshMin());
    startAutoRefresh(getAutoRefreshMin());
  });

  // View toggle (applyView keeps the toolbar and these buttons in sync)
  popover.querySelectorAll('[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      setViewMode(btn.dataset.view);
      PREF.set('view', getViewMode());
      applyView();
      render({ keepLimit: true });
    });
  });

  // Clear cache
  popover.querySelector('#clearCacheBtn')?.addEventListener('click', () => {
    const overlay = document.createElement('div');
    overlay.className = 'cache-confirm-overlay';
    overlay.innerHTML = `
      <div class="cache-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cacheConfirmTitle" aria-describedby="cacheConfirmDesc">
        <div class="cache-confirm-icon">
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
        </div>
        <h3 id="cacheConfirmTitle" class="cache-confirm-title">Clear all site data?</h3>
        <p class="cache-confirm-desc" id="cacheConfirmDesc">This removes cached images, saved stories and every preference (theme, layout, topic, My Pulse, auto-refresh). The page will reload.<span class="cache-confirm-note">This can't be undone.</span></p>
        <div class="cache-confirm-actions">
          <button type="button" class="btn btn-secondary" id="cacheConfirmCancel">Cancel</button>
          <button type="button" class="btn cache-confirm-delete" id="cacheConfirmOk">Clear everything</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    closePopover({ restore: false });

    const dialog = overlay.querySelector('.cache-confirm-dialog');
    const onKey = e => {
      if (e.key === 'Escape') removeOverlay();
      else trapTabKey(dialog, e);
    };
    const removeOverlay = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      restoreFocus(settingsBtn);
    };
    overlay.querySelector('#cacheConfirmCancel').addEventListener('click', removeOverlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) removeOverlay(); });
    document.addEventListener('keydown', onKey);
    setTimeout(() => overlay.querySelector('#cacheConfirmCancel')?.focus(), 30);

    overlay.querySelector('#cacheConfirmOk').addEventListener('click', () => {
      const siteKeys = Object.keys(localStorage).filter(k =>
        k.startsWith('gp:') || k.startsWith('geeksup_') || k.startsWith('geekspulse.')
      );
      siteKeys.forEach(k => localStorage.removeItem(k));
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      showBmToast(`Cleared ${siteKeys.length} item${siteKeys.length !== 1 ? 's' : ''} — reloading…`);
      setTimeout(() => location.reload(), 1200);
    });
  });
}
