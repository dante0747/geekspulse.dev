import { PREF } from './storage.js';

// ── Giscus theme sync ─────────────────────────────────────────────

export function giscusTheme(theme) {
  const gTheme = theme === 'light' ? 'light' : 'dark_dimmed';
  const script = document.getElementById('giscus-script');
  if (script) script.setAttribute('data-theme', gTheme);
  const iframe = document.querySelector('iframe.giscus-frame');
  if (iframe) {
    iframe.contentWindow.postMessage(
      { giscus: { setConfig: { theme: gTheme } } },
      'https://giscus.app'
    );
  }
}

// ── Theme initialisation ──────────────────────────────────────────

export function initTheme() {
  const savedTheme = PREF.get('theme') || 'dark';
  if (savedTheme === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  giscusTheme(savedTheme);

  if (savedTheme !== 'dark') {
    const observer = new MutationObserver(() => {
      const iframe = document.querySelector('iframe.giscus-frame');
      if (iframe) {
        observer.disconnect();
        setTimeout(() => giscusTheme(savedTheme), 300);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }
}

// ── Lazy Giscus comments ──────────────────────────────────────────

export function initGiscusLazy() {
  const mount = document.getElementById('commentsMount');
  if (!mount) return;

  function loadGiscus() {
    if (document.getElementById('giscus-script')) return;
    const script = document.createElement('script');
    script.id = 'giscus-script';
    script.src = 'https://giscus.app/client.js';
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.dataset.repo = 'dante0747/geekspulse.dev';
    script.dataset.repoId = 'R_kgDOSZ3OMg';
    script.dataset.category = 'General';
    script.dataset.categoryId = 'DIC_kwDOSZ3OMs4C8xt4';
    script.dataset.mapping = 'pathname';
    script.dataset.theme = (PREF.get('theme') === 'light') ? 'light' : 'dark_dimmed';
    script.dataset.lang = 'en';
    mount.appendChild(script);
  }

  const observer = new IntersectionObserver(entries => {
    if (entries.some(e => e.isIntersecting)) {
      loadGiscus();
      observer.disconnect();
    }
  }, { rootMargin: '300px' });

  observer.observe(mount);
}

