/**
 * scripts/lib/classifier.mjs
 * Article category classification — keyword tier and optional Ollama LLM tier.
 */

import { CATEGORY_KEYWORDS, VALID_CATS, OLLAMA_MODEL } from './config.mjs';
import { ollamaClient, aiCache, saveCache }             from './ai.mjs';

// ── Tier 1: keyword rules (always works, zero dependencies) ────────────────

export function keywordClassify(title = '', summary = '', feedCategory = 'General') {
  const text = `${title} ${summary}`;
  for (const [cat, re] of Object.entries(CATEGORY_KEYWORDS)) {
    if (re.test(text)) return cat;
  }
  return feedCategory;
}

// ── Tier 2: Ollama local LLM (used in CI via GitHub Actions, optional locally) ──

export async function classifyArticle(title = '', summary = '', feedCategory = 'General') {
  // 1. For articles from dedicated (non-General) feeds, trust the feed's own
  //    category — keyword matching and LLM results often pull Python/Java/
  //    Rust/Go articles into AI/DevOps/Security because those patterns appear first.
  if (feedCategory !== 'General') return feedCategory;

  // 2. Check committed cache
  const cacheKey = title.slice(0, 120);
  if (aiCache[cacheKey]) return aiCache[cacheKey];

  // 3. Keyword classifier (always available, instant)
  const kwResult = keywordClassify(title, summary, feedCategory);

  // 4. LLM override for ambiguous cases (only if Ollama is running)
  if (ollamaClient) {
    try {
      const prompt =
        `You are a developer-news classifier. Classify the article below into EXACTLY ONE category.\n\n` +
        `Categories and what they cover:\n` +
        `- Security    : vulnerabilities, CVEs, exploits, malware, pentesting, cryptography, privacy\n` +
        `- AI          : machine learning, LLMs, neural networks, AI tools, data science, ML frameworks\n` +
        `- Python      : Python language, CPython, pip, Django, FastAPI, NumPy, PyPI, Python tooling\n` +
        `- JavaScript  : JS/TS, Node.js, browsers, npm, React, Vue, Angular, Deno, Bun, web APIs\n` +
        `- Java        : Java language, JVM, Spring, Maven, Gradle, Kotlin on JVM, Jakarta EE\n` +
        `- DevOps      : CI/CD, Docker, Kubernetes, Terraform, cloud infrastructure, monitoring, SRE\n` +
        `- Open Source : OSS project releases, licensing, community governance, contributions\n` +
        `- Rust        : Rust language, Cargo, crates.io, Rustup, Rust tooling\n` +
        `- Go          : Go language (Golang), Go modules, Go toolchain — NOT the word "go" generically\n` +
        `- Architecture: system design, microservices, distributed systems, databases, APIs, patterns\n` +
        `- General     : developer culture, career, tools, IDEs, productivity, or anything that does not fit above\n\n` +
        `Rules:\n` +
        `1. If the article is about an AI/ML tool written in Python, prefer AI over Python.\n` +
        `2. Only choose Python/JavaScript/Java/Rust/Go if the article is primarily about that language or its ecosystem.\n` +
        `3. Security articles about AI systems should be classified as Security, not AI.\n` +
        `4. Reply with ONLY the category name — no punctuation, no explanation.\n\n` +
        `Title: ${title}\nSnippet: ${summary.slice(0, 300)}\n\nCategory:`;
      const resp   = await ollamaClient.generate({
        model: OLLAMA_MODEL, prompt, stream: false,
        options: { temperature: 0, num_predict: 10 },
      });
      const raw    = (resp.response || '').trim();
      const match  = VALID_CATS.find(c => raw.toLowerCase().startsWith(c.toLowerCase()));
      const result = match || kwResult;
      aiCache[cacheKey] = result;
      return result;
    } catch (e) {
      console.warn(`[classifier] LLM call failed for "${title.slice(0, 50)}": ${e.message}`);
    }
  }

  // 5. Fall back to keyword result
  return kwResult;
}

