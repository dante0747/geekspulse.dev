/**
 * scripts/lib/ai.mjs
 * Ollama client initialisation and shared AI cache.
 *
 * `ollamaClient` and `aiCache` are exported as live ESM bindings — every
 * module that imports them will always see the latest value after initOllama()
 * or loadCache() runs.
 */

import fs   from 'node:fs/promises';
import { Ollama } from 'ollama';
import { USE_LLM, OLLAMA_HOST, OLLAMA_MODEL, CACHE_FILE } from './config.mjs';

// ── Live-binding state (shared across all importing modules) ───────────────

export let ollamaClient = null;
export let aiCache      = {};

// ── Cache persistence ──────────────────────────────────────────────────────

export async function loadCache() {
  try { aiCache = JSON.parse(await fs.readFile(CACHE_FILE, 'utf8')); } catch { aiCache = {}; }
}

export async function saveCache() {
  await fs.writeFile(CACHE_FILE, JSON.stringify(aiCache, null, 2), 'utf8');
}

// ── Ollama initialisation ──────────────────────────────────────────────────

export async function initOllama() {
  await loadCache();
  if (!USE_LLM) return;
  try {
    ollamaClient = new Ollama({ host: OLLAMA_HOST });
    await ollamaClient.list(); // ping — throws if Ollama isn't running
    console.log(`[classifier] Ollama online — using model ${OLLAMA_MODEL}`);
  } catch {
    console.warn('[classifier] Ollama not reachable — falling back to keyword classifier.');
    ollamaClient = null;
  }
}

