<div align="center">

```
  ██████╗ ███████╗███████╗██╗  ██╗███████╗██████╗ ██╗   ██╗██╗     ███████╗███████╗
 ██╔════╝ ██╔════╝██╔════╝██║ ██╔╝██╔════╝██╔══██╗██║   ██║██║     ██╔════╝██╔════╝
 ██║  ███╗█████╗  █████╗  █████╔╝ ███████╗██████╔╝██║   ██║██║     ███████╗█████╗  
 ██║   ██║██╔══╝  ██╔══╝  ██╔═██╗ ╚════██║██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝  
 ╚██████╔╝███████╗███████╗██║  ██╗███████║██║      ╚██████╔╝███████╗███████║███████╗
  ╚═════╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝╚═╝       ╚═════╝ ╚══════╝╚══════╝╚══════╝
```

**`{ GeeksPulse }` — Feel the pulse of dev.**

[![Live](https://img.shields.io/badge/status-live-39d353?style=flat-square&logo=statuspage&logoColor=black)](https://geekspulse.dev)
[![Feeds](https://img.shields.io/badge/RSS_feeds-39-58c8ff?style=flat-square&logo=rss&logoColor=black)](https://geekspulse.dev)
[![Paywalls](https://img.shields.io/badge/paywalls-0-39d353?style=flat-square)](https://geekspulse.dev)
[![No Ad Trackers](https://img.shields.io/badge/ad_trackers-none-ff5555?style=flat-square)](https://geekspulse.dev)
[![No Ads](https://img.shields.io/badge/ads-nope-bc8cff?style=flat-square)](https://geekspulse.dev)
[![Indie](https://img.shields.io/badge/built_by-one_dev_with_coffee-e3c55e?style=flat-square)](https://geekspulse.dev)

> *Your daily dev briefing, minus the noise.*

</div>

---

## `> geekspulse fetch --all --fresh`

```
✓ Hacker News ............. 30 stories
✓ Krebs on Security ....... 12 stories
✓ IEEE Spectrum ........... 18 stories
✓ GitHub Blog ............. 8 stories
✓ Google AI Blog .......... 10 stories
✓ Rust Blog ............... 6 stories
✓ Go Blog ................. 5 stories
# 39 feeds · 0 paywalls · 100% signal
✓ Ready. No paywalls. You're welcome.
▮
```

---

## 📡 What Is GeeksPulse?

GeeksPulse is a static developer-news site powered by a scheduled feed-generation pipeline. A Node.js script fetches and normalises RSS feeds into static JSON files, and the frontend renders from that cache for speed and reliability.

It pulls from **39 hand-picked RSS feeds** across 11 categories, sorts them newest-first, and presents them in a sleek cyberpunk UI — no doomscrolling Twitter required.

- 🚫 **No ads.** No VC money. No ad trackers.
- ⚡ **Static hosting.** The site is served as plain HTML/CSS/JS — no application server required.
- 🔓 **No paywalls.** Every article is directly accessible.
- 🧠 **No framework bloat.** Just clean, fast, modern vanilla web.

---

## ✨ Features

| Feature | Details |
|---|---|
| 📡 **39 RSS Feeds** | Hand-curated from the best dev sources on the web |
| 🗂️ **11 Categories** | General · Security · AI/ML · Python · JavaScript · Java · DevOps · Open Source · Rust · Go · Architecture |
| 🤖 **AI Summaries** | On-demand article summaries via pre-cached snippets or local Ollama fallback |
| ⚡ **Static Cache** | Articles pre-built by a Node.js pipeline; browser loads JSON instantly |
| 🔄 **Auto-Refresh** | Configurable: 1m · 5m · 10m · 15m · 30m · 1h |
| 🃏 **Grid & List View** | Toggle between layouts, preference saved locally |
| 💾 **localStorage Prefs** | Your filter, view mode & refresh interval persist across sessions |
| 💀 **Skeleton Loaders** | Shimmer placeholders while feeds are loading |
| 🎨 **Cyberpunk UI** | Dark theme, neon glows, glitch animations, scanline overlay |
| 🖥️ **Animated Terminal** | Hero terminal with staggered fade-in lines |
| ♿ **Accessible** | ARIA roles, labels, `aria-pressed`, keyboard navigation, `prefers-reduced-motion` |
| 📱 **Responsive** | Mobile-first with chip filters on small screens |
| 🔖 **Bookmarks** | Save articles to localStorage for later reading |
| ⌨️ **Keyboard Shortcuts** | `/` search · `j/k` navigate · `o` open · `r` refresh · `Esc` clear |
| 🏥 **Feed Health Panel** | Live status: last updated time, online/failed feed counts |
| ⏱️ **Reading Time** | Estimated read time displayed on every article card |
| 🔗 **Share Articles** | Web Share API with automatic clipboard fallback |

---

## 🗞️ Feed Sources

<details>
<summary><strong>📡 General</strong></summary>

- [Hacker News](https://news.ycombinator.com)
- [Lobsters](https://lobste.rs)
- [The Register](https://theregister.com)
- [Ars Technica](https://arstechnica.com)
- [InfoQ](https://infoq.com)
- [IEEE Spectrum](https://spectrum.ieee.org)

</details>

<details>
<summary><strong>🔐 Security</strong></summary>

- [Bleeping Computer](https://bleepingcomputer.com)
- [The Hacker News](https://thehackernews.com)
- [Krebs on Security](https://krebsonsecurity.com)
- [Schneier on Security](https://schneier.com)
- [SANS Internet Storm Center](https://isc.sans.edu)

</details>

<details>
<summary><strong>🤖 AI / ML</strong></summary>

- [MIT AI News](https://news.mit.edu)
- [Google AI Blog](https://blog.google/technology/ai)
- [The Gradient](https://thegradient.pub)

</details>

<details>
<summary><strong>🐍 Python</strong></summary>

- [Planet Python](https://planetpython.org)
- [Real Python](https://realpython.com)

</details>

<details>
<summary><strong>🟡 JavaScript</strong></summary>

- [JavaScript Weekly](https://javascriptweekly.com)
- [Node Weekly](https://nodeweekly.com)
- [MDN Blog](https://developer.mozilla.org/en-US/blog)

</details>

<details>
<summary><strong>🐳 DevOps</strong></summary>

- [Docker Blog](https://docker.com/blog)
- [Kubernetes Blog](https://kubernetes.io/blog)
- [HashiCorp Blog](https://hashicorp.com/blog)
- [AWS DevOps Blog](https://aws.amazon.com/blogs/devops)

</details>

<details>
<summary><strong>🌍 Open Source</strong></summary>

- [LWN.net](https://lwn.net)
- [GitHub Blog](https://github.blog)

</details>

<details>
<summary><strong>☕ Java</strong></summary>

- [Spring Blog](https://spring.io/blog)
- [InfoQ Java](https://infoq.com/java)

</details>

<details>
<summary><strong>🦀 Rust</strong></summary>

- [Rust Blog](https://blog.rust-lang.org)
- [This Week in Rust](https://this-week-in-rust.org)

</details>

<details>
<summary><strong>🐹 Go</strong></summary>

- [Go Blog](https://go.dev/blog)
- [Go Weekly](https://golangweekly.com)
- [Dave Cheney](https://dave.cheney.net)

</details>

<details>
<summary><strong>🏛️ Architecture</strong></summary>

- [Martin Fowler](https://martinfowler.com)
- [InfoQ Architecture](https://infoq.com/architecture)
- [AWS Architecture Blog](https://aws.amazon.com/blogs/architecture)
- [High Scalability](http://highscalability.com)
- [Netflix Tech Blog](https://netflixtechblog.com)
- [Meta Engineering](https://engineering.fb.com)
- [Cloudflare Blog](https://blog.cloudflare.com)

</details>

---

## 🏗️ Architecture

```js
const architecture = {
  hosting:    "Static files — no application server required",
  markup:     "HTML5",           // semantic, accessible
  styles:     "Vanilla CSS",     // custom properties, animations, grid
  logic:      "Vanilla JS",      // ES2022+ native ES modules, no bundler
  modules:    "js/ — 14 focused ES modules loaded via <script type=\"module\">",
  fonts:      ["JetBrains Mono", "Space Grotesk", "Bangers"],
  feedPipeline: "Node.js (scripts/build-feed.mjs)",
  storage:    "localStorage",    // preferences & bookmarks
  deps:       ["fast-xml-parser"], // build-time only, zero runtime deps
  analytics:  "Google Analytics (basic traffic insights)",
};
```

The frontend's primary data source is the pre-built `public/feed.json` file. If that file is missing or empty, the app silently falls back to fetching RSS feeds directly via browser-side CORS proxies — this is an emergency path only and is not used during normal page loads.

---

## ⚙️ Feed Pipeline

The `scripts/build-feed.mjs` script is a **Node 18+ server-side utility** that pre-fetches all feeds and writes a static JSON cache to `public/`. GitHub Actions runs this on a schedule to keep the cache fresh.

```bash
# Install the one build-time dependency
npm install

# Fetch all feeds and write public/feed.json + public/feed-health.json
npm run build:feed

# Regenerate sitemap.xml (homepage-only canonical URLs)
npm run build:sitemap

# Inject latest articles into index.html for SEO crawlers
npm run build:seo

# Run the full pipeline in order
npm run build
```

| Output file | Description |
|---|---|
| `public/feed.json` | Up to 300 deduplicated articles, sorted newest-first |
| `public/feed-health.json` | Per-feed health: ok/error/article count + last updated time |
| `sitemap.xml` | Minimal canonical sitemap (homepage only) |
| `index.html` | SEO fallback articles injected between `GENERATED_LATEST_ARTICLES_START/END` markers |

### How to add a new feed

1. Open `data/feeds.json`.
2. Add a new entry:
   ```json
   { "id": "my-blog", "name": "My Blog", "url": "https://myblog.com/feed.xml", "category": "General", "enabled": true }
   ```
3. Run `npm run build` to regenerate the cache.
4. Commit both `data/feeds.json` and the updated `public/feed.json`.

---

## 🚀 Running Locally

```bash
# Clone the repo
git clone https://github.com/dante0747/geekspulse.dev.git
cd geekspulse.dev

# Serve with any static server (required — file:// won't load /public/feed.json)
npx serve .
# or
python -m http.server 8080
```

Then open [http://localhost:8080](http://localhost:8080).

To regenerate the feed cache with live data:

```bash
npm install
npm run build
```

---

## 📂 Project Structure

```
geekspulse.dev/
├── index.html           # App shell — nav, hero, sidebar, feed grid
├── styles.css           # Full cyberpunk design system
├── js/                  # ES module source (loaded via <script type="module">)
│   ├── main.js          # Entry point — app state, render loop, event wiring
│   ├── config.js        # Static data: feeds list, categories, SVG icons, constants
│   ├── analytics.js     # GA4 event helper
│   ├── storage.js       # localStorage — preferences & bookmarks
│   ├── utils.js         # Pure utilities: esc, relTime, truncate, toast, etc.
│   ├── http.js          # CORS proxy chain (fetchViaCorsProxy)
│   ├── images.js        # Image pipeline: extraction, scoring, caching, resolution
│   ├── feed.js          # RSS/Atom parsing & feed fetching
│   ├── cards.js         # Card HTML generators (grid, list, skeleton, placeholder)
│   ├── feeds-registry.js # Feed registry loader — fetches & caches data/feeds.json at startup
│   ├── settings-panel.js # Settings popover (auto-refresh, view, theme, cache)
│   ├── pulse-panel.js   # My Pulse drawer (topic/source filters, presets)
│   ├── summary.js       # AI Summary modal — pre-cached snippets or Ollama fallback
│   └── paypal-modal.js  # PayPal support modal
├── favicon.svg          # SVG favicon
├── og-image.png         # Open Graph image
├── sitemap.xml          # SEO sitemap (auto-generated by scripts/generate-sitemap.mjs)
├── robots.txt           # Crawler rules
├── assets/
│   └── fallbacks/       # Category SVG fallback images (ai, security, devops, …)
├── data/
│   └── feeds.json       # Feed registry — 39 hand-curated RSS/Atom sources
├── public/
│   ├── feed.json        # Pre-built article cache (generated by build script)
│   ├── feed-health.json # Per-feed health report (generated by build script)
│   └── version.json     # Build version info (generated by build script)
└── scripts/
    ├── build-feed.mjs          # Node 18+ script: fetch → parse → dedupe → write JSON
    ├── generate-sitemap.mjs    # Generates sitemap.xml from data/feeds.json
    ├── generate-seo-content.mjs # Injects latest articles into index.html for SEO
    └── generate-version.mjs    # Writes public/version.json
```

---

## 🎨 Design System

The UI uses a cyberpunk-inspired design language with:

| Token | Value | Usage |
|---|---|---|
| `--cyan` | `#58c8ff` | Primary accent, links, glow |
| `--green` | `#39d353` | Live status, success |
| `--purple` | `#bc8cff` | Support, AI category |
| `--red` | `#ff5555` | Security category, errors |
| `--yellow` | `#e3c55e` | JS category, warnings |
| `--orange` | `#f07f2f` | Java category |
| `--bg` | `#080b12` | Page background |
| `--font` | `JetBrains Mono` | Everything |

Animations include: grid drift, scanlines, neon flicker, glitch, cursor blink, and card hover lifts. All animations respect the `prefers-reduced-motion` media query.

---

## 🔒 Privacy

GeeksPulse has no ads and no paywalls. It uses **Google Analytics** for basic traffic insights so the project owner can understand usage and improve the site. It does not use advertising trackers, sell user data, or personalise ads.

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Quick ways to help:
- 📡 Suggest a new RSS feed via [Issues](https://github.com/dante0747/geekspulse.dev/issues/new)
- 🐛 Report bugs or broken feeds
- ⭐ Star the repo to spread the word
- 💬 Open a PR — all skill levels welcome

---

## ☕ Support

GeeksPulse is **free and indie**. No ads, no investors, no data selling.  
If it saves you from opening 12 tabs today, consider tossing a coffee:

<div align="center">

[![Support via PayPal](https://img.shields.io/badge/Support_via-PayPal-bc8cff?style=for-the-badge&logo=paypal&logoColor=white)](https://paypal.me/MajidAbarghooei)

</div>

---

## Repository Metadata

Recommended settings for the GitHub repository:

**Description:**
Developer news without the noise — a fast, open-source RSS-powered news hub for software engineers.

**Website:**
https://geekspulse.dev/

**Suggested topics:**
`developer-news` `rss` `news-aggregator` `javascript` `static-site` `open-source` `ai-news` `security-news` `programming` `software-engineering`

---

<div align="center">

```
// thank you, you absolute legend ❤
```

**© 2026 GeeksPulse** — No ads. No paywalls. No ad trackers.

*Built for developers who like clean feeds, good tools, and fewer tabs.*

</div>
