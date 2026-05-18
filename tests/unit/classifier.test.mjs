/**
 * tests/unit/classifier.test.mjs
 * Unit tests for scripts/lib/classifier.mjs
 */

import { describe, it, expect, vi } from 'vitest';

// Mock ai.mjs to prevent Ollama LLM calls
vi.mock('../../scripts/lib/ai.mjs', () => ({
  ollamaClient: null,
  aiCache: {},
  saveCache: vi.fn(),
}));

import { keywordClassify, classifyArticle } from '../../scripts/lib/classifier.mjs';

// ── keywordClassify ───────────────────────────────────────────────────────────

describe('keywordClassify', () => {
  it('classifies security article', () => {
    expect(keywordClassify('CVE-2024 remote code execution', '')).toBe('Security');
  });

  it('classifies JavaScript article', () => {
    expect(keywordClassify('Building a React app with hooks', '')).toBe('JavaScript');
  });

  it('classifies DevOps article', () => {
    expect(keywordClassify('Kubernetes autoscaling deep dive', '')).toBe('DevOps');
  });

  it('classifies Python article', () => {
    expect(keywordClassify('Python 3.13 release notes', '')).toBe('Python');
  });

  it('classifies Rust article', () => {
    expect(keywordClassify('Rust 2024 edition changes', '')).toBe('Rust');
  });

  it('classifies Go article via Golang keyword', () => {
    expect(keywordClassify('Golang modules explained in depth', '')).toBe('Go');
  });

  it('falls back to feedCategory for non-matching text', () => {
    expect(keywordClassify('Some non-matching text about stuff', '', 'Java')).toBe('Java');
  });

  it('defaults to General for non-matching text without feedCategory', () => {
    expect(keywordClassify('Random unrelated text', '')).toBe('General');
  });
});

// ── classifyArticle ───────────────────────────────────────────────────────────

describe('classifyArticle (no Ollama)', () => {
  it('short-circuits immediately for non-General feed category', async () => {
    const result = await classifyArticle('Python tutorial', '', 'Python');
    expect(result).toBe('Python');
  });

  it('short-circuits for Java feed category', async () => {
    const result = await classifyArticle('Some article title', '', 'Java');
    expect(result).toBe('Java');
  });

  it('falls back to keywordClassify when feedCategory is General', async () => {
    const result = await classifyArticle('CVE-2024 exploit details', '', 'General');
    expect(result).toBe('Security');
  });

  it('returns General for unclassifiable General-feed articles', async () => {
    const result = await classifyArticle('Random thoughts on productivity', '', 'General');
    expect(result).toBe('General');
  });
});

