/**
 * tests/unit/sponsored.test.mjs
 * Unit tests for SPONSORED_RE pattern and scripts/lib/sponsored.mjs
 */

import { describe, it, expect, vi } from 'vitest';

// Mock ai.mjs to disable LLM path
vi.mock('../../scripts/lib/ai.mjs', () => ({
  ollamaClient: null,
  aiCache: {},
  saveCache: vi.fn(),
}));

import { regexDetectSponsored, detectSponsored } from '../../scripts/lib/sponsored.mjs';
import { SPONSORED_RE } from '../../js/config.js';

// ── SPONSORED_RE (from js/config.js — runtime regex) ─────────────────────────

describe('SPONSORED_RE (runtime regex from js/config.js)', () => {
  it('detects "Sponsored post:"', () => {
    expect(SPONSORED_RE.test('Sponsored post: 10 tips for developers')).toBe(true);
  });

  it('detects "Partner content:"', () => {
    expect(SPONSORED_RE.test('Partner content: AWS re:Invent recap')).toBe(true);
  });

  it('detects "Brought to you by"', () => {
    expect(SPONSORED_RE.test('Brought to you by Datadog')).toBe(true);
  });

  it('does NOT detect genuine article', () => {
    expect(SPONSORED_RE.test('How we open-sourced our Go monorepo')).toBe(false);
  });

  it('detects "Promoted listing"', () => {
    expect(SPONSORED_RE.test('Promoted listing in the PyPI index')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(SPONSORED_RE.test('SPONSORED: big announcement')).toBe(true);
    expect(SPONSORED_RE.test('brought-to-you-by Acme')).toBe(true);
  });

  it('detects "advertorial"', () => {
    expect(SPONSORED_RE.test('advertorial: 5 cloud tools for teams')).toBe(true);
  });

  it('detects "webinar"', () => {
    expect(SPONSORED_RE.test('Join our upcoming webinar on cloud security')).toBe(true);
  });
});

// ── regexDetectSponsored (build-side function) ────────────────────────────────

describe('regexDetectSponsored', () => {
  it('detects sponsored in title', () => {
    expect(regexDetectSponsored('Sponsored: top devops tools', '')).toBe(true);
  });

  it('detects sponsored in summary', () => {
    expect(regexDetectSponsored('Article title', 'This content is brought to you by Acme Corp')).toBe(true);
  });

  it('does not detect genuine article', () => {
    expect(regexDetectSponsored('Python 3.14 released with new features', 'New features in Python')).toBe(false);
  });
});

// ── detectSponsored (without Ollama) ──────────────────────────────────────────

describe('detectSponsored (no Ollama)', () => {
  it('returns true for sponsored title', async () => {
    expect(await detectSponsored('Partner content: cloud tools', '')).toBe(true);
  });

  it('returns false for genuine article when ollamaClient is null', async () => {
    expect(await detectSponsored('How to optimise your React app', 'Performance tips for developers')).toBe(false);
  });
});

