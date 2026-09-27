import { loadingMessages } from './config.js';

// ── HTML escaping & URL validation ───────────────────────────────

export function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

export function safeUrl(value) {
  if (!value) return '#';
  try {
    const u = new URL(String(value).trim());
    if (!['http:', 'https:'].includes(u.protocol)) return '#';
    return u.toString();
  } catch {
    return '#';
  }
}

// ── String / date helpers ─────────────────────────────────────────

export function catClass(cat) {
  return 'cat-' + cat.toLowerCase().replace(/\s+/g, '-');
}

export function relTime(dateStr) {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const s = (Date.now() - d) / 1000;
    if (s < 60)     return 'just now';
    if (s < 3600)   return `${Math.floor(s/60)}m ago`;
    if (s < 86400)  return `${Math.floor(s/3600)}h ago`;
    if (s < 604800) return `${Math.floor(s/86400)}d ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return ''; }
}

export function stripHtml(html) {
  if (!html) return '';
  const d = document.createElement('div');
  d.innerHTML = html;
  return d.textContent || d.innerText || '';
}

export function truncate(str, n = 160) {
  const s = (str || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n) + '…' : s;
}

export function readTime(title, snippet) {
  const words = ((title || '') + ' ' + (snippet || '')).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 200));
}

export function getText(el, tag) {
  const node = el.querySelector(tag);
  return node ? (node.textContent || '').trim() : '';
}

export function randomMsg() {
  return loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
}

// ── Share helper ──────────────────────────────────────────────────

export async function shareArticle(title, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url });
      return;
    } catch { /* user cancelled */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    showBmToast('🔗 Link copied to clipboard!');
  } catch {
    showBmToast('Copy: ' + url);
  }
}

// ── Screen-reader live region ─────────────────────────────────────

export function announce(message) {
  const el = document.getElementById('feedStatus');
  if (el) el.textContent = message;
}

// ── Focus management for dialogs ──────────────────────────────────

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Keep Tab / Shift+Tab inside `container`. Call from a keydown handler. */
export function trapTabKey(container, event) {
  if (event.key !== 'Tab' || !container) return;
  const items = Array.from(container.querySelectorAll(FOCUSABLE))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
  if (!items.length) return;
  const first = items[0];
  const last  = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault(); first.focus();
  }
}

/** Return focus to `el` if it is still in the document. */
export function restoreFocus(el) {
  if (el && typeof el.focus === 'function' && document.contains(el)) {
    el.focus({ preventScroll: true });
  }
}

// ── Animated counter ──────────────────────────────────────────────

export function animateCounter(el, target, duration = 800) {
  if (!el || isNaN(target)) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { el.textContent = target; return; }
  const start = performance.now();
  const tick  = now => {
    const p    = Math.min((now - start) / duration, 1);
    const ease = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.textContent = Math.round(target * ease);
    if (p < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// ── Toast notification ────────────────────────────────────────────

let toastTimer = null;

/**
 * Show a short status toast. Pass `action` ({ label, onClick }) to add a
 * button — e.g. "Undo" — which keeps the toast up a little longer.
 */
export function showBmToast(msg, action) {
  let toast = document.getElementById('bmToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'bmToast';
    toast.className = 'bm-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.toggle('has-action', Boolean(action));
  if (action && typeof action.onClick === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bm-toast-action';
    btn.textContent = action.label || 'Undo';
    btn.addEventListener('click', () => {
      action.onClick();
      toast.classList.remove('visible');
    });
    toast.appendChild(btn);
  }
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), action ? 6000 : 2400);
}
