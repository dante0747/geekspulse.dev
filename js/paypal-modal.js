import { trapTabKey, restoreFocus } from './utils.js';

export function initPayPalModal() {
  const PAYPAL_ME = 'https://paypal.me/MajidAbarghooei';
  const QR_URL    = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(PAYPAL_ME)}`;

  const modal = document.createElement('div');
  modal.id = 'ppModal';
  modal.className = 'pp-modal-backdrop';
  modal.innerHTML = `
    <div class="pp-modal" role="dialog" aria-modal="true" aria-labelledby="ppTitle" aria-describedby="ppDesc">
      <button type="button" class="pp-close" aria-label="Close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      <div class="pp-icon"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z"/></svg></div>
      <h3 class="pp-title" id="ppTitle">Support GeeksPulse</h3>
      <p class="pp-desc" id="ppDesc">Scan with your phone camera or the PayPal app — or open PayPal.me directly.</p>
      <div class="pp-qr-wrap">
        <img alt="QR code linking to paypal.me/MajidAbarghooei" width="220" height="220" class="pp-qr" decoding="async" />
      </div>
      <a href="${PAYPAL_ME}" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-block">Open PayPal.me</a>
      <p class="pp-thanks">Thank you — it genuinely keeps the project going <svg aria-hidden="true" viewBox="0 0 16 16" width="13" height="13" fill="currentColor"><path d="M8 14s-6-3.9-6-8a4 4 0 0 1 6-3.44A4 4 0 0 1 14 6c0 4.1-6 8-6 8z"/></svg></p>
    </div>`;
  document.body.appendChild(modal);

  const dialog = modal.querySelector('.pp-modal');
  const qr = modal.querySelector('.pp-qr');
  let returnFocusTo = null;

  const isOpen = () => modal.classList.contains('open');
  const open = () => {
    // The QR image is requested only when someone actually opens the modal.
    if (!qr.getAttribute('src')) qr.setAttribute('src', QR_URL);
    returnFocusTo = document.activeElement;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
    setTimeout(() => modal.querySelector('.pp-close')?.focus(), 30);
  };
  const close = () => {
    if (!isOpen()) return;
    modal.classList.remove('open');
    document.body.style.overflow = '';
    restoreFocus(returnFocusTo);
  };

  modal.querySelector('.pp-close').addEventListener('click', close);
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.addEventListener('keydown', e => {
    if (!isOpen()) return;
    if (e.key === 'Escape') close();
    else trapTabKey(dialog, e);
  });

  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-support]');
    if (btn) { e.preventDefault(); open(); }
  });
}
