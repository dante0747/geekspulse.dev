/**
 * js/consent.js
 *
 * Manages cookie/analytics consent for GDPR compliance.
 * - Shows a dismissible banner on first visit.
 * - Dynamically loads GA4 only when the user accepts.
 * - Stores the decision in localStorage under 'gp:analytics:consent'.
 *   Value 'yes' = accepted, 'no' = declined.
 */

const GA_ID          = 'G-M63R1H30X2';
const CONSENT_KEY    = 'gp:analytics:consent';
const BANNER_SEEN_KEY = 'gp:consent:seen';

/** Dynamically inject GA4 after consent. */
function loadGA4() {
  if (typeof window.gtag === 'function') return; // already loaded
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID, { anonymize_ip: true });
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
  document.head.appendChild(s);
}

/** Accept analytics consent. */
export function acceptConsent() {
  localStorage.setItem(CONSENT_KEY, 'yes');
  localStorage.setItem(BANNER_SEEN_KEY, '1');
  loadGA4();
  removeBanner();
}

/** Decline analytics consent. */
export function declineConsent() {
  localStorage.setItem(CONSENT_KEY, 'no');
  localStorage.setItem(BANNER_SEEN_KEY, '1');
  removeBanner();
}

function removeBanner() {
  document.getElementById('cookieBanner')?.remove();
}

/** Show the consent banner. */
function showBanner() {
  if (document.getElementById('cookieBanner')) return;
  const banner = document.createElement('div');
  banner.id = 'cookieBanner';
  banner.className = 'cookie-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', 'Cookie consent');
  banner.setAttribute('aria-live', 'polite');
  banner.innerHTML = `
    <div class="cookie-banner-inner">
      <p class="cookie-banner-text">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-right:6px;vertical-align:-2px"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/></svg>
        GeeksPulse uses <strong>Google Analytics</strong> to understand how visitors use the site. No ads, no profiling.
        <a href="/privacy.html" style="color:var(--cyan);white-space:nowrap">Privacy Policy</a>
      </p>
      <div class="cookie-banner-actions">
        <button id="cookieAccept" class="btn btn-primary btn-sm">Accept</button>
        <button id="cookieDecline" class="btn btn-ghost btn-sm">Decline</button>
      </div>
    </div>`;
  document.body.appendChild(banner);
  document.getElementById('cookieAccept')?.addEventListener('click', acceptConsent);
  document.getElementById('cookieDecline')?.addEventListener('click', declineConsent);
}

/** Initialise consent logic. Called once on page load. */
export function initConsent() {
  const stored = localStorage.getItem(CONSENT_KEY);
  if (stored === 'yes') {
    loadGA4();
    return;
  }
  if (stored === 'no') {
    return; // user already declined
  }
  // No decision yet — show banner after a short delay so it doesn't flash instantly
  setTimeout(showBanner, 1500);
}

