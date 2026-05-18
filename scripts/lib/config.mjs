/**
 * scripts/lib/config.mjs
 * Shared constants, regex patterns, and the XML parser instance.
 */

import path           from 'node:path';
import { fileURLToPath } from 'node:url';
import { XMLParser }  from 'fast-xml-parser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Paths ──────────────────────────────────────────────────────────────────

/** Absolute path to the repository root. */
export const ROOT = path.resolve(__dirname, '../..');

// ── Fetch / pipeline tuning ────────────────────────────────────────────────

export const FEED_TIMEOUT_MS           = 10_000;
export const ARTICLE_TIMEOUT_MS        = 8_000;
export const ARTICLE_FETCH_CONCURRENCY = 8;
export const MAX_PER_FEED              = 15;
export const MIN_PER_CATEGORY          = 10;   // guarantee at least this many articles per category
export const MAX_PER_CATEGORY          = 100;  // cap any single category so it can't crowd out others
export const MIN_SUMMARY_LEN           = 40;
export const ARTICLE_TEXT_MAX_BYTES    = 512 * 1024; // 512 KB cap when fetching article body
export const ARTICLE_TEXT_MAX_CHARS    = 3_000;       // chars of body text fed to the LLM
export const IMAGE_HEAD_MAX_BYTES      = 256 * 1024; // 256 KB is plenty for reading <head>
export const USER_AGENT                = 'GeeksPulse/1.0 (+https://geekspulse.dev; feed-bot)';

// ── AI / Ollama ────────────────────────────────────────────────────────────

export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen2.5:0.5b';
export const OLLAMA_HOST  = process.env.OLLAMA_HOST  || 'http://127.0.0.1:11434';
export const USE_LLM      = process.env.USE_LLM === '1';
export const CACHE_FILE   = path.resolve(__dirname, '../..', '.ai-category-cache.json');

export const VALID_CATS = [
  'General', 'Security', 'AI', 'Python', 'JavaScript',
  'Java', 'DevOps', 'Open Source', 'Rust', 'Go', 'Architecture',
];

// ── XML parser ─────────────────────────────────────────────────────────────

export const XML_PARSER = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseTagValue: true,
  trimValues: true,
  processEntities: false,
  htmlEntities: false,
  stopNodes: ['*.description', '*.content', '*.content:encoded', '*.summary'],
});

// ── Category metadata ──────────────────────────────────────────────────────

export const CATEGORY_FALLBACK_IMAGES = {
  'General':      '/assets/fallbacks/general.svg',
  'Security':     '/assets/fallbacks/security.svg',
  'AI':           '/assets/fallbacks/ai.svg',
  'Python':       '/assets/fallbacks/python.svg',
  'JavaScript':   '/assets/fallbacks/javascript.svg',
  'DevOps':       '/assets/fallbacks/devops.svg',
  'Open Source':  '/assets/fallbacks/open-source.svg',
  'Java':         '/assets/fallbacks/java.svg',
  'Rust':         '/assets/fallbacks/rust.svg',
  'Go':           '/assets/fallbacks/go.svg',
  'Architecture': '/assets/fallbacks/architecture.svg',
};

export const CATEGORY_KEYWORDS = {
  'Security':    /\b(CVE|vulnerability|exploit|malware|ransomware|phishing|zero.?day|breach|hack|XSS|SQL.?injection|OWASP|pentest|infosec|cybersecurity|SAST|DAST|threat|patch|firewall|authentication|OAuth|JWT)\b/i,
  'AI':          /\b(AI\b|LLM|GPT|machine.?learning|deep.?learning|neural.?net|transformer|diffusion|ChatGPT|Gemini|Claude|Llama|Mistral|RAG|embedding|fine.?tun|artificial.?intelligence|generative|copilot|agentic|Ollama)\b/i,
  'Python':      /\b(Python|Django|Flask|FastAPI|pip|PyPI|pandas|numpy|scipy|jupyter|pydantic|SQLAlchemy|uv\b|ruff|pytest)\b/i,
  'JavaScript':  /\b(JavaScript|TypeScript|Node\.?js|React|Vue|Angular|Svelte|Next\.?js|Nuxt|Deno|Bun\b|npm|webpack|vite|esbuild|ESM|JSX|TSX)\b/i,
  'Java':        /\b(Java\b|Spring|Maven|Gradle|JVM|Kotlin|Quarkus|Micronaut|Jakarta|JDK|Hibernate)\b/i,
  'DevOps':      /\b(Docker|Kubernetes|k8s|CI\/CD|GitHub.?Actions|Jenkins|ArgoCD|Terraform|Ansible|Helm|AWS|Azure|GCP|cloud|DevOps|SRE|observability|Prometheus|Grafana|OpenTelemetry)\b/i,
  'Rust':        /\b(Rust\b|cargo\b|crate\b|Tokio|rustup|rustc|borrow.?checker|WebAssembly|WASM)\b/i,
  'Go':          /\b(Golang|Go lang|goroutine|gopher|pkg\.go\.dev)\b/i,
  'Architecture':/\b(microservice|monolith|event.?driven|CQRS|DDD|domain.?driven|API.?design|GraphQL|gRPC|system.?design|distributed|serverless|hexagonal|clean.?arch)\b/i,
  'Open Source': /\b(open.?source|OSS|FOSS|MIT license|Apache license|GPL|maintainer)\b/i,
};

// Sponsored-content patterns (regex tier — catches obvious cases without LLM)
export const SPONSORED_RE = /\b(sponsored|partner[ -]content|promoted|advertorial|advertisement|webinar|webcast|brought[ -]to[ -]you[ -]by|in[ -]partnership[ -]with|paid[ -]post|native[ -]ad|content[ -]marketing)\b/i;

// ── Image-filter constants ─────────────────────────────────────────────────

export const BAD_PATH_PATTERNS = [
  'rss', 'logo', 'logos', 'icon', 'icons', 'favicon', 'avatar', 'avatars',
  'sprite', 'sprites', 'pixel', 'tracking', 'badge', 'badges',
  'placeholder', 'spacer', '1x1', 'blank', 'beacon', 'counter',
  'feedburner', 'feedproxy', 'analytics', 'stats', 'doubleclick',
  'googlesyndication', 'adservice', 'adsystem', 'quantserve',
  'chartbeat', 'scorecardresearch', 'gravatar', 'profile', 'author',
  'apple-touch', 'android-chrome', 'mstile',
  // Decorative layout corner/border images (e.g. LWN lcorner-ss.png)
  'lcorner', 'rcorner', 'corner', 'lcorner-ss',
];
export const BAD_HOSTNAME_RE = /\b(feedburner|feedproxy|gravatar|doubleclick|googlesyndication|adservice|adsystem|quantserve|chartbeat|scorecardresearch)\b/i;
export const TINY_SIZE_RE    = /[_\-x×](?:16|32|48|64)(?:x|×|px|_|\b)/i;
export const BAD_URL_RE      = /static\.lwn\.net\/images\/l?corner/i;
export const IMG_EXT         = /\.(jpe?g|png|webp|avif)(\?|$)/i;

