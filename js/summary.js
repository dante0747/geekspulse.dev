/**
 * js/summary.js
 *
 * AI Summary modal — shows pre-cached summaries from feed.json,
 * or falls back to calling Ollama API (http://127.0.0.1:11434)
 * for on-the-fly generation when no snippet is available.
 */

const OLLAMA_HOST  = 'http://127.0.0.1:11434';
const OLLAMA_MODEL = 'qwen2.5:0.5b';

// ── Modal DOM ──────────────────────────────────────────────────────

let _modal = null;

function getModal() {
  if (_modal) return _modal;

  _modal = document.createElement('div');
  _modal.id = 'summaryModal';
  _modal.setAttribute('role', 'dialog');
  _modal.setAttribute('aria-modal', 'true');
  _modal.setAttribute('aria-labelledby', 'summaryModalTitle');
  _modal.innerHTML = `
    <div class="summary-backdrop" id="summaryBackdrop"></div>
    <div class="summary-dialog">
      <div class="summary-dialog__header">
        <span class="summary-ai-badge">
          <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>
          AI Summary
        </span>
        <button class="summary-close" id="summaryClose" aria-label="Close summary">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <h3 class="summary-dialog__title" id="summaryModalTitle"></h3>
      <div class="summary-dialog__body" id="summaryBody">
        <div class="summary-loading" id="summaryLoading" hidden>
          <span class="summary-spinner"></span>
          <span>Generating summary…</span>
        </div>
        <p class="summary-text" id="summaryText"></p>
        <p class="summary-error" id="summaryError" hidden></p>
      </div>
      <div class="summary-dialog__footer">
        <a class="card-link" id="summaryReadLink" href="#" target="_blank" rel="noopener noreferrer">Read full article →</a>
        <span class="summary-source" id="summarySource"></span>
      </div>
    </div>`;

  document.body.appendChild(_modal);

  document.getElementById('summaryBackdrop').addEventListener('click', closeSummaryModal);
  document.getElementById('summaryClose').addEventListener('click', closeSummaryModal);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && _modal.classList.contains('open')) closeSummaryModal();
  });

  return _modal;
}

// ── Public API ─────────────────────────────────────────────────────

export function initSummaryModal() {
  // Eagerly create the modal DOM so it's ready
  getModal();
}

export function openSummaryModal({ title, snippet, link, source }) {
  const modal = getModal();

  document.getElementById('summaryModalTitle').textContent = title || '';
  document.getElementById('summaryText').textContent = '';
  document.getElementById('summaryError').hidden = true;
  document.getElementById('summaryError').textContent = '';
  document.getElementById('summaryLoading').hidden = true;
  document.getElementById('summaryReadLink').href = link || '#';
  document.getElementById('summarySource').textContent = source ? `// ${source}` : '';

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  if (snippet && snippet.trim().length > 20) {
    // We already have a good summary from the feed cache
    document.getElementById('summaryText').textContent = snippet.trim();
  } else {
    // Try Ollama on-the-fly
    document.getElementById('summaryLoading').hidden = false;
    fetchOllamaSummary(title).then(text => {
      document.getElementById('summaryLoading').hidden = true;
      if (text) {
        document.getElementById('summaryText').textContent = text;
      } else {
        const errEl = document.getElementById('summaryError');
        errEl.textContent = 'No summary available. Make sure Ollama is running locally (http://127.0.0.1:11434) to generate summaries on-the-fly.';
        errEl.hidden = false;
      }
    });
  }

  // Focus the close button for accessibility
  setTimeout(() => document.getElementById('summaryClose')?.focus(), 50);
}

function closeSummaryModal() {
  if (!_modal) return;
  _modal.classList.remove('open');
  document.body.style.overflow = '';
}

// ── Ollama fetch ───────────────────────────────────────────────────

async function fetchOllamaSummary(title) {
  try {
    const resp = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        prompt: `Write a single sentence (max 30 words) summarising this developer news article.\nTitle: ${title}\nReply with only the sentence, no quotes, no prefix.`,
        stream: false,
        options: { temperature: 0.3, num_predict: 60 },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = (data.response || '').trim().replace(/^["']|["']$/g, '');
    return text.length > 10 ? text : null;
  } catch {
    return null;
  }
}

