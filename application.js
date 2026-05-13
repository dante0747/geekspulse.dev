/* ================================================================
   GeeksPulse — app.js
   // TODO: add dark mode  (already dark, genius)
   // TODO: add authentication  (it's a news reader, chill)
   // TODO: rewrite in Rust  (maybe next sprint)
   ================================================================ */

(() => {
  'use strict';

  // ── Google Analytics 4 event helper ─────────────────────────
  // Safely fires a GA4 custom event. No-ops if gtag is not loaded
  // (e.g. blocked by an ad-blocker) so it never breaks the app.
  function gaEvent(eventName, params) {
    try {
      if (typeof window.gtag === 'function') {
        window.gtag('event', eventName, params || {});
      }
    } catch (_) { /* silent fail */ }
  }

  // ── Feed loading strategy ────────────────────────────────────
  // PRIMARY PATH: load from pre-generated static cache (public/feed.json).
  // This is what runs on every normal page load — no external requests needed.
  //
  // EMERGENCY FALLBACK: if the static cache is missing or empty, the app
  // falls back to fetching RSS feeds directly via public CORS proxies.
  // This should NOT run during normal loads; it is only a safety net.
  //
  // CORS proxy notes (fallback only):
  // corsproxy.io returns a 200-OK JSON error blob for unregistered production
  // origins like https://geekspulse.dev. `resp.ok` is true so a naive chain
  // never falls through — hence the `looksLikeUsableBody` guard below.
  // Codetabs MUST use the trailing slash before `?`.
  const CORS_PROXIES = [
    url => 'https://api.codetabs.com/v1/proxy/?quest='     + encodeURIComponent(url),
    url => 'https://api.allorigins.win/raw?url='           + encodeURIComponent(url),
    url => 'https://corsproxy.io/?'                        + encodeURIComponent(url),
  ];
  // Kept for backward references; first proxy is the de-facto primary.
  const CORS_PROXY   = 'https://api.codetabs.com/v1/proxy/?quest=';
  // rss2json — emergency fallback only, may rate-limit on free tier
  const RSS2JSON     = 'https://api.rss2json.com/v1/api.json?rss_url=';

  /** True when the response body looks like real web content (not an error JSON). */
  function looksLikeUsableBody(text) {
    if (!text || text.length < 100) return false;
    const head = text.slice(0, 600).trimStart();
    // Detect known proxy error JSON envelopes (corsproxy.io etc.)
    // Example: {"error":"Free usage is limited to localhost and development environments. ..."}
    if (head.startsWith('{') || head.startsWith('[')) {
      if (
        /"error"\s*:/i.test(head) ||
        /(api[\s_-]?key|free usage|limited to localhost|not allowed|upgrade|rate ?limit|forbidden|quota|pricing)/i.test(head)
      ) {
        return false;
      }
    }
    // Generic Cloudflare / proxy error pages
    if (/temporarily rate limited|attention required|cloudflare/i.test(head) &&
        /<title|<html/i.test(head) === false) {
      return false;
    }
    return true;
  }

  /** Fetch a URL via a chain of public CORS proxies; returns response text or null.
   *  Tries each proxy until one returns a body that doesn't look like a proxy error. */
  async function fetchViaCorsProxy(targetUrl, { timeoutMs = 8000 } = {}) {
    for (const build of CORS_PROXIES) {
      try {
        const proxied = build(targetUrl);
        const resp = await fetch(proxied, {
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'follow',
          referrerPolicy: 'no-referrer',
        });
        if (!resp.ok) continue;
        const text = await resp.text();
        if (looksLikeUsableBody(text)) return text;
      } catch { /* try next proxy */ }
    }
    return null;
  }

  const MAX_ARTICLES = 300; // enough for all categories to have articles
  const MAX_PER_FEED = 15;  // cap per feed so high-volume sources don't crowd out others

  // ── Persistent preferences (all in localStorage) ─────────────
  const PREF = {
    get: k         => localStorage.getItem('geeksup_' + k),
    set: (k, v)    => localStorage.setItem('geeksup_' + k, v),
  };

  // ── Auto-refresh options (minutes; 0 = off) ───────────────────
  const REFRESH_OPTIONS = [
    { label: 'Off',  value: 0   },
    { label: '1m',   value: 1   },
    { label: '5m',   value: 5   },
    { label: '10m',  value: 10  },
    { label: '15m',  value: 15  },
    { label: '30m',  value: 30  },
    { label: '1h',   value: 60  },
  ];

  const feeds = [
    // ── General programming news ──────────────────────────────
    { name: 'Hacker News',       url: 'https://news.ycombinator.com/rss',                                 category: 'General'     },
    { name: 'Lobsters',          url: 'https://lobste.rs/rss',                                            category: 'General'     },
    { name: 'The Register',      url: 'https://www.theregister.com/headlines.atom',                       category: 'General'     },
    { name: 'Ars Technica',      url: 'https://feeds.arstechnica.com/arstechnica/technology-lab',         category: 'General'     },
    { name: 'InfoQ',             url: 'https://feed.infoq.com/',                                          category: 'General'     },
    { name: 'IEEE Spectrum',     url: 'https://spectrum.ieee.org/feeds/feed.rss',                         category: 'General'     },
    // ── Security ─────────────────────────────────────────────
    { name: 'Bleeping Computer', url: 'https://www.bleepingcomputer.com/feed/',                           category: 'Security'    },
    { name: 'The Hacker News',   url: 'https://feeds.feedburner.com/TheHackersNews',                     category: 'Security'    },
    { name: 'Krebs on Security', url: 'https://krebsonsecurity.com/feed/',                               category: 'Security'    },
    { name: 'Schneier on Security', url: 'https://www.schneier.com/feed/atom/',                          category: 'Security'    },
    { name: 'SANS Internet Storm', url: 'https://isc.sans.edu/rssfeed_full.xml',                         category: 'Security'    },
    // ── AI / ML ──────────────────────────────────────────────
    { name: 'MIT AI News',       url: 'https://news.mit.edu/topic/mitartificial-intelligence2-rss.xml',  category: 'AI'          },
    { name: 'Google AI Blog',    url: 'https://blog.google/technology/ai/rss/',                          category: 'AI'          },
    { name: 'The Gradient',      url: 'https://thegradient.pub/rss/',                                    category: 'AI'          },
    // ── Python ───────────────────────────────────────────────
    { name: 'Planet Python',     url: 'https://planetpython.org/rss20.xml',                              category: 'Python'      },
    { name: 'Real Python',       url: 'https://realpython.com/atom.xml',                                 category: 'Python'      },
    // ── JavaScript ───────────────────────────────────────────
    { name: 'JavaScript Weekly', url: 'https://javascriptweekly.com/rss/full.xml',                       category: 'JavaScript'  },
    { name: 'Node Weekly',       url: 'https://nodeweekly.com/rss/full.xml',                             category: 'JavaScript'  },
    { name: 'MDN Blog',          url: 'https://developer.mozilla.org/en-US/blog/rss.xml',                category: 'JavaScript'  },
    // ── DevOps ───────────────────────────────────────────────
    { name: 'Docker Blog',       url: 'https://www.docker.com/blog/feed/',                               category: 'DevOps'      },
    { name: 'Kubernetes Blog',   url: 'https://kubernetes.io/feed.xml',                                  category: 'DevOps'      },
    { name: 'HashiCorp Blog',    url: 'https://www.hashicorp.com/blog/feed.xml',                         category: 'DevOps'      },
    { name: 'AWS DevOps Blog',   url: 'https://aws.amazon.com/blogs/devops/feed/',                       category: 'DevOps'      },
    // ── Open Source ──────────────────────────────────────────
    { name: 'LWN.net',           url: 'https://lwn.net/headlines/rss',                                   category: 'Open Source' },
    { name: 'GitHub Blog',       url: 'https://github.blog/feed/',                                       category: 'Open Source' },
    // ── Java & Spring ─────────────────────────────────────────
    { name: 'Spring Blog',       url: 'https://spring.io/blog.atom',                                     category: 'Java'        },
    { name: 'InfoQ Java',        url: 'https://feed.infoq.com/java/',                                    category: 'Java'        },
    // ── Rust ─────────────────────────────────────────────────
    { name: 'Rust Blog',         url: 'https://blog.rust-lang.org/feed.xml',                             category: 'Rust'        },
    { name: 'This Week in Rust', url: 'https://this-week-in-rust.org/rss.xml',                           category: 'Rust'        },
    // ── Go ───────────────────────────────────────────────────
    { name: 'Go Blog',           url: 'https://go.dev/blog/feed.atom',                                   category: 'Go'          },
    { name: 'Go Weekly',         url: 'https://golangweekly.com/rss/full.xml',                           category: 'Go'          },
    { name: 'Dave Cheney',       url: 'https://dave.cheney.net/feed/atom',                               category: 'Go'          },
    // ── Architecture & System Design ─────────────────────────
    { name: 'Martin Fowler',          url: 'https://martinfowler.com/feed.atom',                             category: 'Architecture' },
    { name: 'InfoQ Architecture',     url: 'https://feed.infoq.com/architecture/',                           category: 'Architecture' },
    { name: 'AWS Architecture Blog',  url: 'https://aws.amazon.com/blogs/architecture/feed/',                category: 'Architecture' },
    { name: 'High Scalability',       url: 'http://feeds.feedburner.com/HighScalability',                   category: 'Architecture' },
    { name: 'Netflix Tech Blog',      url: 'https://netflixtechblog.com/feed',                               category: 'Architecture' },
    { name: 'Meta Engineering',       url: 'https://engineering.fb.com/feed/',                               category: 'Architecture' },
    { name: 'Uber Engineering',       url: 'https://www.uber.com/en-US/blog/engineering/rss/',               category: 'Architecture' },
  ];

  // SVG icons — paths sourced from Lucide Icons (lucide.dev) and Simple Icons (simpleicons.org)
  const CAT_SVG = {
    // Lucide: radio
    'All':
      `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/></svg>`,
    // Lucide: code-2
    'General':
      `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>`,
    // Lucide: shield-check
    'Security':
      `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/></svg>`,
    // Lucide: bot
    'AI':
      `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>`,
    // Simple Icons: python (official logo path, viewBox 0 0 24 24)
    'Python':
      `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M11.914 0C5.82 0 6.2 2.656 6.2 2.656l.007 2.752h5.814v.826H3.9S0 5.789 0 11.969C0 18.15 3.403 17.93 3.403 17.93h2.034v-2.853s-.11-3.403 3.347-3.403h5.768s3.24.052 3.24-3.13V3.26S18.302 0 11.914 0zm-3.22 1.874a1.04 1.04 0 0 1 1.04 1.04 1.04 1.04 0 0 1-1.04 1.04 1.04 1.04 0 0 1-1.04-1.04 1.04 1.04 0 0 1 1.04-1.04z"/><path d="M12.086 24c6.094 0 5.714-2.656 5.714-2.656l-.007-2.752h-5.814v-.826h8.121S24 18.211 24 12.031c0-6.18-3.403-5.961-3.403-5.961h-2.034v2.853s.11 3.403-3.347 3.403H9.448s-3.24-.052-3.24 3.13V18.74S5.698 24 12.086 24zm3.22-1.874a1.04 1.04 0 0 1-1.04-1.04 1.04 1.04 0 0 1 1.04-1.04 1.04 1.04 0 0 1 1.04 1.04 1.04 1.04 0 0 1-1.04 1.04z"/></svg>`,
    // Lucide: braces
    'JavaScript':
      `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/></svg>`,
    // Lucide: coffee
    'Java':
      `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 8h1a4 4 0 1 1 0 8h-1"/><path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z"/><line x1="6" x2="6" y1="2" y2="4"/><line x1="10" x2="10" y1="2" y2="4"/><line x1="14" x2="14" y1="2" y2="4"/></svg>`,
    // Lucide: layers
    'DevOps':
      `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>`,
    // Lucide: globe
    'Open Source':
      `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" x2="22" y1="12" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`,
    // Rust — exact paths from https://www.rust-lang.org/static/images/rust-logo-blk.svg
    'Rust':
      `<svg aria-hidden="true" viewBox="0 0 144 144" width="15" height="15" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><path d="m71.05 23.68c-26.06 0-47.27 21.22-47.27 47.27s21.22 47.27 47.27 47.27 47.27-21.22 47.27-47.27-21.22-47.27-47.27-47.27zm-.07 4.2a3.1 3.11 0 0 1 3.02 3.11 3.11 3.11 0 0 1 -6.22 0 3.11 3.11 0 0 1 3.2-3.11zm7.12 5.12a38.27 38.27 0 0 1 26.2 18.66l-3.67 8.28c-.63 1.43.02 3.11 1.44 3.75l7.06 3.13a38.27 38.27 0 0 1 .08 6.64h-3.93c-.39 0-.55.26-.55.64v1.8c0 4.24-2.39 5.17-4.49 5.4-2 .23-4.21-.84-4.49-2.06-1.18-6.63-3.14-8.04-6.24-10.49 3.85-2.44 7.85-6.05 7.85-10.87 0-5.21-3.57-8.49-6-10.1-3.42-2.25-7.2-2.7-8.22-2.7h-40.6a38.27 38.27 0 0 1 21.41-12.08l4.79 5.02c1.08 1.13 2.87 1.18 4 .09zm-44.2 23.02a3.11 3.11 0 0 1 3.02 3.11 3.11 3.11 0 0 1 -6.22 0 3.11 3.11 0 0 1 3.2-3.11zm74.15.14a3.11 3.11 0 0 1 3.02 3.11 3.11 3.11 0 0 1 -6.22 0 3.11 3.11 0 0 1 3.2-3.11zm-68.29.5h5.42v24.44h-10.94a38.27 38.27 0 0 1 -1.24-14.61l6.7-2.98c1.43-.64 2.08-2.31 1.44-3.74zm22.62.26h12.91c.67 0 4.71.77 4.71 3.8 0 2.51-3.1 3.41-5.65 3.41h-11.98zm0 17.56h9.89c.9 0 4.83.26 6.08 5.28.39 1.54 1.26 6.56 1.85 8.17.59 1.8 2.98 5.4 5.53 5.4h16.14a38.27 38.27 0 0 1 -3.54 4.1l-6.57-1.41c-1.53-.33-3.04.65-3.37 2.18l-1.56 7.28a38.27 38.27 0 0 1 -31.91-.15l-1.56-7.28c-.33-1.53-1.83-2.51-3.36-2.18l-6.43 1.38a38.27 38.27 0 0 1 -3.32-3.92h31.27c.35 0 .59-.06.59-.39v-11.06c0-.32-.24-.39-.59-.39h-9.15zm-14.43 25.33a3.11 3.11 0 0 1 3.02 3.11 3.11 3.11 0 0 1 -6.22 0 3.11 3.11 0 0 1 3.2-3.11zm46.05.14a3.11 3.11 0 0 1 3.02 3.11 3.11 3.11 0 0 1 -6.22 0 3.11 3.11 0 0 1 3.2-3.11z"/><path d="m115.68 70.95a44.63 44.63 0 0 1 -44.63 44.63 44.63 44.63 0 0 1 -44.63-44.63 44.63 44.63 0 0 1 44.63-44.63 44.63 44.63 0 0 1 44.63 44.63zm-.84-4.31 6.96 4.31-6.96 4.31 5.98 5.59-7.66 2.87 4.78 6.65-8.09 1.32 3.4 7.46-8.19-.29 1.88 7.98-7.98-1.88.29 8.19-7.46-3.4-1.32 8.09-6.65-4.78-2.87 7.66-5.59-5.98-4.31 6.96-4.31-6.96-5.59 5.98-2.87-7.66-6.65 4.78-1.32-8.09-7.46 3.4.29-8.19-7.98 1.88 1.88-7.98-8.19.29 3.4-7.46-8.09-1.32 4.78-6.65-7.66-2.87 5.98-5.59-6.96-4.31 6.96-4.31-5.98-5.59 7.66-2.87-4.78-6.65 8.09-1.32-3.4-7.46 8.19.29-1.88-7.98 7.98 1.88-.29-8.19 7.46 3.4 1.32-8.09 6.65 4.78 2.87-7.66 5.59 5.98 4.31-6.96 4.31 6.96 5.59-5.98 2.87 7.66 6.65-4.78 1.32 8.09 7.46-3.4-.29 8.19 7.98-1.88-1.88 7.98 8.19-.29-3.4 7.46 8.09 1.32-4.78 6.65 7.66 2.87z" fill-rule="evenodd" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/></svg>`,
    // Go — exact paths from https://go.dev/images/go-logo-white.svg (fill changed to currentColor)
    'Go':
      `<svg aria-hidden="true" viewBox="0 0 207 78" width="40" height="15" fill="currentColor" xmlns="http://www.w3.org/2000/svg"><g fill-rule="evenodd"><path d="m16.2 24.1c-.4 0-.5-.2-.3-.5l2.1-2.7c.2-.3.7-.5 1.1-.5h35.7c.4 0 .5.3.3.6l-1.7 2.6c-.2.3-.7.6-1 .6z"/><path d="m1.1 33.3c-.4 0-.5-.2-.3-.5l2.1-2.7c.2-.3.7-.5 1.1-.5h45.6c.4 0 .6.3.5.6l-.8 2.4c-.1.4-.5.6-.9.6z"/><path d="m25.3 42.5c-.4 0-.5-.3-.3-.6l1.4-2.5c.2-.3.6-.6 1-.6h20c.4 0 .6.3.6.7l-.2 2.4c0 .4-.4.7-.7.7z"/><g transform="translate(55)"><path d="m74.1 22.3c-6.3 1.6-10.6 2.8-16.8 4.4-1.5.4-1.6.5-2.9-1-1.5-1.7-2.6-2.8-4.7-3.8-6.3-3.1-12.4-2.2-18.1 1.5-6.8 4.4-10.3 10.9-10.2 19 .1 8 5.6 14.6 13.5 15.7 6.8.9 12.5-1.5 17-6.6.9-1.1 1.7-2.3 2.7-3.7-3.6 0-8.1 0-19.3 0-2.1 0-2.6-1.3-1.9-3 1.3-3.1 3.7-8.3 5.1-10.9.3-.6 1-1.6 2.5-1.6h36.4c-.2 2.7-.2 5.4-.6 8.1-1.1 7.2-3.8 13.8-8.2 19.6-7.2 9.5-16.6 15.4-28.5 17-9.8 1.3-18.9-.6-26.9-6.6-7.4-5.6-11.6-13-12.7-22.2-1.3-10.9 1.9-20.7 8.5-29.3 7.1-9.3 16.5-15.2 28-17.3 9.4-1.7 18.4-.6 26.5 4.9 5.3 3.5 9.1 8.3 11.6 14.1.6.9.2 1.4-1 1.7z"/><path d="m107.2 77.6c-9.1-.2-17.4-2.8-24.4-8.8-5.9-5.1-9.6-11.6-10.8-19.3-1.8-11.3 1.3-21.3 8.1-30.2 7.3-9.6 16.1-14.6 28-16.7 10.2-1.8 19.8-.8 28.5 5.1 7.9 5.4 12.8 12.7 14.1 22.3 1.7 13.5-2.2 24.5-11.5 33.9-6.6 6.7-14.7 10.9-24 12.8-2.7.5-5.4.6-8 .9zm23.8-40.4c-.1-1.3-.1-2.3-.3-3.3-1.8-9.9-10.9-15.5-20.4-13.3-9.3 2.1-15.3 8-17.5 17.4-1.8 7.8 2 15.7 9.2 18.9 5.5 2.4 11 2.1 16.3-.6 7.9-4.1 12.2-10.5 12.7-19.1z" fill-rule="nonzero"/></g></g></svg>`,
    // Lucide: network (Architecture / System Design)
    'Architecture':
      `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg>`,
  };

  const categories = [
    { id: 'All',         label: 'All news',    color: '#38BDF8', icon: CAT_SVG['All']         },
    { id: 'General',     label: 'General',     color: '#94A3B8', icon: CAT_SVG['General']     },
    { id: 'Security',    label: 'Security',    color: '#F43F5E', icon: CAT_SVG['Security']    },
    { id: 'AI',          label: 'AI / ML',     color: '#A855F7', icon: CAT_SVG['AI']          },
    { id: 'Python',      label: 'Python',      color: '#3B82F6', icon: CAT_SVG['Python']      },
    { id: 'JavaScript',  label: 'JavaScript',  color: '#FBBF24', icon: CAT_SVG['JavaScript']  },
    { id: 'Java',        label: 'Java',        color: '#F97316', icon: CAT_SVG['Java']        },
    { id: 'DevOps',      label: 'DevOps',      color: '#6366F1', icon: CAT_SVG['DevOps']      },
    { id: 'Open Source', label: 'Open Source', color: '#10B981', icon: CAT_SVG['Open Source'] },
    { id: 'Rust',        label: 'Rust',        color: '#CE422B', icon: CAT_SVG['Rust']        },
    { id: 'Go',          label: 'Go',           color: '#00ACD7', icon: CAT_SVG['Go']          },
    { id: 'Architecture', label: 'Architecture', color: '#2DD4BF', icon: CAT_SVG['Architecture'] },
    { id: 'Bookmarks',   label: 'Bookmarks',   color: '#EC4899', icon: `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>` },
  ];

  // Fast lookup: category id → { icon, color }
  const catMeta = Object.fromEntries(categories.map(c => [c.id, { icon: c.icon, color: c.color }]));

  // Render a scaled-down category icon for use inside card pills
  function catIconSm(category) {
    const meta = catMeta[category];
    if (!meta) return '';
    const svg = meta.icon.replace(/width="\d+" height="\d+"/, 'width="11" height="11"');
    return `<span style="display:inline-flex;align-items:center;color:${meta.color};margin-right:3px;flex-shrink:0">${svg}</span>`;
  }

  // Render a standalone category icon for cards (bigger, separate from the pill)
  // ── Card image placeholder (no image available) ──────────────
  function cardPlaceholder(category, link) {
    const meta = catMeta[category];
    const color = meta ? meta.color : '#94A3B8';
    const bigSvg = meta ? meta.icon.replace(/width="\d+" height="\d+"/, 'width="48" height="48"') : '';
    // Pick a fun tag line per category
    const tag = {
      'General':     '{ breaking; }',
      'Security':    'sudo cat news',
      'AI':          'model.predict()',
      'Python':      'import news',
      'JavaScript':  'const news = fetch()',
      'DevOps':      'kubectl get news',
      'Open Source': 'git pull origin',
      'Java':        'new News()',
      'Rust':        'fn read() -> News',
      'Go':          'go get news',
    }[category] || '> _';
    return `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="card-img-wrap card-placeholder" data-ph-cat="${esc(category)}" style="--ph-color:${color}" tabindex="-1" aria-hidden="true">
      <span class="card-placeholder__icon">${bigSvg}</span>
      <span class="card-placeholder__tag">${esc(tag)}</span>
      <span class="card-placeholder__grid"></span>
    </a>`;
  }

  function catIconCard(category) {
    const meta = catMeta[category];
    if (!meta) return '';
    const svg = meta.icon.replace(/width="\d+" height="\d+"/, 'width="18" height="18"');
    return `<span class="card-cat-icon" style="color:${meta.color}">${svg}</span>`;
  }

  // Rotating funny loading messages
  const loadingMessages = [
    'Fetching the latest developer pulse...',
    'Bribing the RSS gods...',
    'npm install news...',
    'git fetch --all-the-gossip...',
    'Untangling the internet...',
    'grep -r "good news" /dev/null...',
    'Reticulating dev splines...',
    'Parsing XML like it\'s 2005...',
    'curl -s https://dev.news | jq .',
  ];

  // ── Bookmarks ─────────────────────────────────────────────────
  const BOOKMARK_KEY = 'geeksup_bookmarks';

  function loadBookmarks() {
    try { return JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[]'); }
    catch { return []; }
  }

  function saveBookmarks(bms) {
    localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bms));
  }

  function isBookmarked(link) {
    return loadBookmarks().some(b => b.link === link);
  }

  function toggleBookmark(article) {
    let bms = loadBookmarks();
    const idx = bms.findIndex(b => b.link === article.link);
    if (idx === -1) {
      bms.unshift({ ...article, bookmarkedAt: new Date().toISOString() });
    } else {
      bms.splice(idx, 1);
    }
    saveBookmarks(bms);
    return idx === -1; // true = just bookmarked
  }

  // ── State ────────────────────────────────────────────────────
  let allArticles   = [];
  let activeFilter  = PREF.get('filter')  || 'All';
  let viewMode      = PREF.get('view')    || 'grid';
  let autoRefreshMin= parseInt(PREF.get('autorefresh') || '0', 10);
  let isLoading     = false;
  let failedFeeds   = 0;
  let autoTimer     = null;
  let countdownSecs = 0;
  let countdownTimer= null;
  let searchQuery   = '';       // current search string
  let focusedCardIdx = -1;      // keyboard navigation index

  // ── DOM ───────────────────────────────────────────────────────
  const $  = id => document.getElementById(id);
  const feedGrid       = $('feedGrid');
  const sidebarFilters = $('sidebarFilters');
  const mobileFilters  = $('mobileFilters');
  const statusDot      = $('statusDot');
  const statusText     = $('statusText');
  const articleCount   = $('articleCount');
  const errorBanner    = $('errorBanner');
  const errorMessage   = $('errorMessage');
  const refreshBtn     = $('refreshBtn');
  const refreshBtnHero = $('refreshBtnHero');
  const refreshIcon    = $('refreshIcon');
  const navStatus      = $('navStatus');
  const gridViewBtn    = $('gridViewBtn');
  const listViewBtn    = $('listViewBtn');
  const sbFeeds        = $('sbFeeds');
  const sbUpdated      = $('sbUpdated');
  const sbFailed       = $('sbFailed');
  const statArticles   = $('statArticles');

  // ── Utilities ─────────────────────────────────────────────────

  function esc(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Validate a URL: only allow http/https, strip everything else
  function safeUrl(value) {
    if (!value) return '#';
    try {
      const u = new URL(String(value).trim());
      if (!['http:', 'https:'].includes(u.protocol)) return '#';
      return u.toString();
    } catch {
      return '#';
    }
  }

  function catClass(cat) {
    return 'cat-' + cat.toLowerCase().replace(/\s+/g, '-');
  }

  function relTime(dateStr) {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      if (isNaN(d)) return '';
      const s = (Date.now() - d) / 1000;
      if (s < 60)     return 'just now';
      if (s < 3600)   return `${Math.floor(s/60)}m ago`;
      if (s < 86400)  return `${Math.floor(s/3600)}h ago`;
      if (s < 604800) return `${Math.floor(s/86400)}d ago`;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return ''; }
  }

  function stripHtml(html) {
    if (!html) return '';
    const d = document.createElement('div');
    d.innerHTML = html;
    return d.textContent || d.innerText || '';
  }

  function truncate(str, n = 160) {
    const s = (str || '').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n) + '…' : s;
  }

  // Estimate reading time (words / 200 wpm, minimum 1 min)
  function readTime(title, snippet) {
    const words = ((title || '') + ' ' + (snippet || '')).split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 200));
  }

  // Share an article — Web Share API with clipboard fallback
  async function shareArticle(title, url) {
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch { /* user cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      showBmToast('🔗 Link copied to clipboard!');
    } catch {
      showBmToast('Copy: ' + url);
    }
  }

  function getText(el, tag) {
    const node = el.querySelector(tag);
    return node ? (node.textContent || '').trim() : '';
  }

  function randomMsg() {
    return loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
  }

  // ── Image pipeline ────────────────────────────────────────────

  const IMAGE_CACHE_TTL            = 7 * 24 * 60 * 60 * 1000; // 7 days
  const IMAGE_NEG_CACHE_TTL        = 6 * 60 * 60 * 1000;      // 6h — re-try misses occasionally
  const IMAGE_METADATA_CONCURRENCY = 3;
  const _IMG_EXT = /\.(jpe?g|png|webp|avif)(\?|$)/i;

  // Tracks article URLs currently being fetched — prevents duplicate concurrent requests
  const resolvingImageUrls = new Set();

  // Bad URL patterns — tracking pixels, icons, logos, etc.
  const _BAD_URL_RE = /\b(logo|icon|favicon|avatar|sprite|pixel|tracking|badge|placeholder|spacer|1x1|blank|beacon|counter|feedburner|feedproxy|analytics|stats|doubleclick|googlesyndication|adservice|adsystem|quantserve|chartbeat|scorecardresearch|feedblitz|mailchimp|list-manage|gravatar)\b/i;

  function normalizeImageUrl(url, baseUrl) {
    if (!url) return null;
    if (url.startsWith('data:')) return null;
    try {
      const abs = new URL(url, baseUrl || location.href);
      // Mixed content: when the page is https, an http image will be silently
      // blocked by the browser (often without firing onerror reliably). Try to
      // upgrade to https; if that's not possible, treat as unusable here so the
      // pipeline can fall back to og:image / placeholder instead.
      if (abs.protocol === 'http:' && location.protocol === 'https:') {
        abs.protocol = 'https:';
      }
      return abs.href;
    } catch { return null; }
  }

  function isProbablyBadImageUrl(url) {
    if (!url) return true;
    const lower = String(url).toLowerCase();
    if (lower.startsWith('data:')) return true;
    if (lower.includes('base64')) return true;
    if (/\.svg(\?|$)/i.test(lower)) return true;
    try {
      const u = new URL(url, location.href);
      if (_BAD_URL_RE.test(u.hostname)) return true;
      if (_BAD_URL_RE.test(u.pathname)) return true;
    } catch { /* keep */ }
    return false;
  }

  function scoreImageCandidate(candidate) {
    const { url, source, width: w, height: h } = candidate;
    let score = candidate.score || 0;

    // High-confidence metadata sources
    if (source === 'og:image' || source === 'twitter:image') score += 30;
    else if (source === 'media:thumbnail' || source === 'media:content') score += 20;
    else if (source === 'enclosure' || source === 'itunes:image') score += 15;

    // Reward known good extensions
    if (_IMG_EXT.test(url)) score += 10;

    // Reward size and reasonable aspect ratio
    if (w > 0 && h > 0) {
      score += Math.min(w * h, 1200000) / 8000;  // stronger reward for larger images
      // Penalise images too small to look good in a card (both dimensions must be small)
      if (w < 400 && h < 200) score -= 20;
      const ratio = w / h;
      // Penalise extreme ratios (too narrow or too wide)
      if (ratio < 0.5 || ratio > 4) score -= 8;
      // Reward card-friendly aspect ratios (roughly 16:9 to 4:3)
      if (ratio >= 1.2 && ratio <= 2.0) score += 5;
    }

    // Reward editorial-sounding path segments
    if (/\/(image|img|photo|thumb|hero|featured|cover|banner|post|article|upload|media|content)\b/i.test(url)) score += 6;

    // Penalise bad patterns
    if (isProbablyBadImageUrl(url)) score -= 30;

    return score;
  }

  function parseSrcset(srcset, baseUrl) {
    return srcset
      .split(',')
      .map(part => part.trim())
      .map(part => {
        const pieces = part.split(/\s+/);
        const rawUrl = pieces[0];
        const descriptor = pieces[1] || '1x';
        if (!rawUrl) return null;
        let descriptorScore = 1;
        if (descriptor.endsWith('w')) {
          descriptorScore = parseInt(descriptor, 10);
        } else if (descriptor.endsWith('x')) {
          descriptorScore = parseFloat(descriptor) * 1000;
        }
        const url = normalizeImageUrl(rawUrl, baseUrl);
        if (!url) return null;
        return { url, descriptor, descriptorScore: Number.isFinite(descriptorScore) ? descriptorScore : 1 };
      })
      .filter(Boolean)
      .sort((a, b) => b.descriptorScore - a.descriptorScore);
  }

  function extractImageCandidatesFromHtml(html, baseUrl) {
    const candidates = [];
    const tmp = document.createElement('div');
    tmp.innerHTML = html;

    // <picture> sources
    tmp.querySelectorAll('picture source[srcset]').forEach(src => {
      const parsed = parseSrcset(src.getAttribute('srcset') || '', baseUrl);
      if (parsed.length) {
        const url = parsed[0].url;
        if (!isProbablyBadImageUrl(url)) {
          candidates.push({ url, source: 'picture-source', width: 0, height: 0, score: 0 });
        }
      }
    });

    // <img src>
    tmp.querySelectorAll('img[src]').forEach(img => {
      const rawSrc = img.getAttribute('src') || '';
      const url = normalizeImageUrl(rawSrc, baseUrl);
      if (!url || isProbablyBadImageUrl(url)) return;
      const w = parseInt(img.getAttribute('width')  || '0', 10) || 0;
      const h = parseInt(img.getAttribute('height') || '0', 10) || 0;
      const inFigure = !!img.closest('figure');
      candidates.push({ url, source: 'html-img', width: w, height: h, score: inFigure ? 8 : 0 });

      // Also check srcset on this img
      const srcset = img.getAttribute('srcset');
      if (srcset) {
        const parsed = parseSrcset(srcset, baseUrl);
        if (parsed.length && !isProbablyBadImageUrl(parsed[0].url)) {
          candidates.push({ url: parsed[0].url, source: 'html-srcset', width: 0, height: 0, score: 2 });
        }
      }
    });

    return candidates;
  }

  function extractImageCandidatesFromFeedItem(el, descHtml, contentHtml) {
    const candidates = [];

    // 1. <media:content> / <media:thumbnail>
    const mediaNS = 'http://search.yahoo.com/mrss/';
    for (const tag of ['content', 'thumbnail']) {
      const nodes = el.getElementsByTagNameNS(mediaNS, tag);
      for (let i = 0; i < nodes.length; i++) {
        const node   = nodes[i];
        const url    = node.getAttribute('url') || '';
        const medium = node.getAttribute('medium') || '';
        const w = parseInt(node.getAttribute('width')  || '0', 10) || 0;
        const h = parseInt(node.getAttribute('height') || '0', 10) || 0;
        if (url && !/^(audio|video)$/i.test(medium) && !isProbablyBadImageUrl(url)) {
          candidates.push({ url, source: tag === 'thumbnail' ? 'media:thumbnail' : 'media:content', width: w, height: h, score: 0 });
        }
      }
    }

    // 2. <enclosure type="image/..."> (RSS 2.0)
    const enc = el.querySelector('enclosure');
    if (enc) {
      const t = enc.getAttribute('type') || '';
      const u = enc.getAttribute('url')  || '';
      if ((t.startsWith('image/') || _IMG_EXT.test(u)) && !isProbablyBadImageUrl(u)) {
        candidates.push({ url: u, source: 'enclosure', width: 0, height: 0, score: 0 });
      }
    }

    // 3. <link rel="enclosure"> (Atom)
    el.querySelectorAll('link[rel="enclosure"]').forEach(link => {
      const t = link.getAttribute('type')  || '';
      const u = link.getAttribute('href')  || '';
      if ((t.startsWith('image/') || _IMG_EXT.test(u)) && !isProbablyBadImageUrl(u)) {
        candidates.push({ url: u, source: 'enclosure', width: 0, height: 0, score: 0 });
      }
    });

    // 4. iTunes image
    const itunes = el.getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', 'image')[0];
    if (itunes) {
      const href = itunes.getAttribute('href') || '';
      if (href && !isProbablyBadImageUrl(href)) {
        candidates.push({ url: href, source: 'itunes:image', width: 0, height: 0, score: 0 });
      }
    }

    // 5. Mine HTML payloads
    const htmlSources = [contentHtml, descHtml].filter(Boolean);
    for (const html of htmlSources) {
      candidates.push(...extractImageCandidatesFromHtml(html, location.href));
    }

    return candidates;
  }

  function pickBestImageCandidate(candidates) {
    if (!candidates.length) return null;
    const scored = candidates
      .filter(c => !isProbablyBadImageUrl(c.url))
      .map(c => ({ ...c, score: scoreImageCandidate(c) }));
    if (!scored.length) return null;
    scored.sort((a, b) => b.score - a.score);
    return scored[0];
  }

  /** Validate an image URL by actually loading it; resolves with dimensions or null. */
  function validateImageUrl(url, timeoutMs = 3500) {
    return new Promise(resolve => {
      if (!url) { resolve(null); return; }
      const img   = new Image();
      const timer = setTimeout(() => {
        img.onload = null; img.onerror = null;
        resolve(null);
      }, timeoutMs);
      img.onload = () => {
        clearTimeout(timer);
        const width  = img.naturalWidth;
        const height = img.naturalHeight;
        if (!width || !height) { resolve(null); return; }
        const ratio  = width / height;
        if (width < 240 || height < 120)   { resolve(null); return; }
        if (ratio < 0.7 || ratio > 3.2)    { resolve(null); return; }
        resolve({ url, width, height, ratio });
      };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    });
  }

  // extractImage — thin wrapper that uses the new pipeline
  function extractImage(el, descHtml, contentHtml) {
    const candidates = extractImageCandidatesFromFeedItem(el, descHtml, contentHtml);
    const best = pickBestImageCandidate(candidates);
    return best ? best.url : null;
  }

  // ── Image metadata cache ────────────────────────────────────

  function getCachedImage(articleUrl) {
    try {
      const raw = localStorage.getItem('gp:image:' + articleUrl);
      if (!raw) return null;
      const data = JSON.parse(raw);
      // Negative cache: we previously tried and found nothing usable.
      if (data && data.notFound) {
        if (Date.now() - data.savedAt > IMAGE_NEG_CACHE_TTL) {
          localStorage.removeItem('gp:image:' + articleUrl);
          return null;
        }
        return { notFound: true };
      }
      if (!data.url || isProbablyBadImageUrl(data.url)) {
        localStorage.removeItem('gp:image:' + articleUrl);
        return null;
      }
      if (Date.now() - data.savedAt > IMAGE_CACHE_TTL) {
        localStorage.removeItem('gp:image:' + articleUrl);
        return null;
      }
      return data;
    } catch { return null; }
  }

  function setCachedImage(articleUrl, imageData) {
    try {
      localStorage.setItem('gp:image:' + articleUrl, JSON.stringify({ ...imageData, savedAt: Date.now() }));
    } catch { /* quota exceeded — silently ignore */ }
  }

  /** Remember that this article has no usable image so we don't keep re-fetching it. */
  function setCachedImageMiss(articleUrl) {
    try {
      localStorage.setItem('gp:image:' + articleUrl, JSON.stringify({ notFound: true, savedAt: Date.now() }));
    } catch { /* ignore quota */ }
  }

  /** Extract the contents of the <head> section from raw HTML, or fall back to the first 50 KB.
   *  Returns the inner content (not the <head> tags themselves) so it can be safely parsed
   *  in a div without triggering browser fragment-context quirks. */
  function getHeadHtml(html) {
    if (!html) return '';
    // Capture everything BETWEEN <head> and </head> (not the tags themselves)
    const match = html.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
    if (match) return match[1];
    // Fallback: take up to 50 KB — enough to cover analytics-heavy preambles
    return html.slice(0, 50000);
  }

  /** Try to find the first reasonable <img> in the article body as a last
   *  resort when no og:/twitter: meta image is available. */
  function findBodyImageInHtml(html, baseUrl) {
    if (!html) return null;
    // Strip <head> so we don't accidentally hit favicon/preload icons
    const bodyHtml = html.replace(/<head[\s\S]*?<\/head>/i, '');
    const candidates = extractImageCandidatesFromHtml(bodyHtml, baseUrl);
    return pickBestImageCandidate(candidates);
  }

  /** Extract first image URL from a Markdown body (used for r.jina.ai fallback). */
  function findImageInMarkdown(md, baseUrl) {
    if (!md) return null;
    const re = /!\[[^\]]*\]\(([^)\s]+)/g;
    let m;
    while ((m = re.exec(md)) !== null) {
      const url = normalizeImageUrl(m[1], baseUrl);
      if (url && !isProbablyBadImageUrl(url) && _IMG_EXT.test(url)) return url;
    }
    return null;
  }

  /** Fetch article HTML via CORS proxy and extract og:/twitter: meta image. */
  async function resolveArticleMetadataImage(articleUrl) {
    if (!articleUrl) return null;

    const cached = getCachedImage(articleUrl);
    if (cached) {
      // Negative cache hit — skip re-fetching for a while
      if (cached.notFound) return null;
      return cached;
    }

    // Prevent duplicate concurrent fetches for the same URL
    if (resolvingImageUrls.has(articleUrl)) return null;
    resolvingImageUrls.add(articleUrl);

    try {
      const html = await fetchViaCorsProxy(articleUrl, { timeoutMs: 8000 });
      if (!html) {
        // All proxies failed — try r.jina.ai (returns markdown, very reliable, free)
        const jinaUrl = 'https://r.jina.ai/' + articleUrl;
        try {
          const r = await fetch(jinaUrl, {
            signal: AbortSignal.timeout(8000),
            referrerPolicy: 'no-referrer',
          });
          if (r.ok) {
            const md = await r.text();
            const imgUrl = findImageInMarkdown(md, articleUrl);
            if (imgUrl) {
              const v = await validateImageUrl(imgUrl);
              if (v) {
                const result = {
                  url: imgUrl,
                  source: 'jina-md',
                  width: v.width, height: v.height, ratio: v.ratio,
                  savedAt: Date.now(),
                };
                setCachedImage(articleUrl, result);
                return result;
              }
            }
          }
        } catch { /* ignore */ }
        setCachedImageMiss(articleUrl);
        return null;
      }

      // Parse the head's inner content in a div — more reliable than <template> for meta/link tags
      const tmp = document.createElement('div');
      tmp.innerHTML = getHeadHtml(html);

      const metaSelectors = [
        'meta[property="og:image"]',
        'meta[property="og:image:url"]',
        'meta[property="og:image:secure_url"]',
        'meta[name="twitter:image"]',
        'meta[name="twitter:image:src"]',
        'link[rel="image_src"]',
      ];

      for (const selector of metaSelectors) {
        const el = tmp.querySelector(selector);
        if (!el) continue;

        let imageUrl = el.getAttribute('content') || el.getAttribute('href') || null;
        // Normalize against the article URL so relative paths resolve correctly
        imageUrl = normalizeImageUrl(imageUrl, articleUrl);

        if (!imageUrl || isProbablyBadImageUrl(imageUrl)) continue;

        const validated = await validateImageUrl(imageUrl);
        if (!validated) continue;

        const result = {
          url: imageUrl,
          source: selector.includes('twitter') ? 'twitter:image' : 'og:image',
          width: validated.width,
          height: validated.height,
          ratio: validated.ratio,
          savedAt: Date.now(),
        };

        setCachedImage(articleUrl, result);
        return result;
      }

      // No og:/twitter: meta found OR all candidates failed validation
      // (e.g. hotlink-blocked CDNs returning 403). Try the article body.
      const bodyBest = findBodyImageInHtml(html, articleUrl);
      if (bodyBest && bodyBest.url) {
        const v = await validateImageUrl(bodyBest.url);
        if (v) {
          const result = {
            url: bodyBest.url,
            source: 'body-img',
            width: v.width, height: v.height, ratio: v.ratio,
            savedAt: Date.now(),
          };
          setCachedImage(articleUrl, result);
          return result;
        }
      }

      // Nothing usable — remember this so we don't keep re-fetching the URL
      setCachedImageMiss(articleUrl);
      return null;
    } catch (err) {
      console.warn('[GeeksPulse] Failed to resolve article metadata image', articleUrl, err);
      return null;
    } finally {
      resolvingImageUrls.delete(articleUrl);
    }
  }

  /** Run async worker over items with limited concurrency. */
  async function runLimited(items, limit, worker) {
    const queue = [...items];
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (queue.length) {
        await worker(queue.shift());
      }
    });
    await Promise.all(workers);
  }

  /** After the feed renders, find cards with no image and progressively resolve them. */
  async function progressivelyResolveMissingImages() {
    const cards = Array.from(
      feedGrid.querySelectorAll('.card[data-article-url]')
    ).filter(card => {
      const hasImage       = Boolean(card.querySelector('img.card-img'));
      const hasPlaceholder = Boolean(card.querySelector('.card-placeholder, .card-img-placeholder'));
      const state          = card.dataset.imageState;
      return !hasImage || hasPlaceholder || state === 'missing' || state === 'failed';
    });

    if (!cards.length) return;

    await runLimited(cards, IMAGE_METADATA_CONCURRENCY, async card => {
      const articleUrl = card.dataset.articleUrl;
      if (!articleUrl || articleUrl === '#') return;

      const cached = getCachedImage(articleUrl);
      if (cached) { updateCardImage(card, cached); return; }

      const imageData = await resolveArticleMetadataImage(articleUrl);
      if (imageData) updateCardImage(card, imageData);
    });
  }

  /** Replace the placeholder or broken image in a card with a real image. */
  function updateCardImage(cardEl, imageData) {
    if (!cardEl || !imageData || !imageData.url) return;

    const existing =
      cardEl.querySelector('.card-img-wrap') ||
      cardEl.querySelector('.card-placeholder') ||
      cardEl.querySelector('.card-img-placeholder');

    if (!existing) return;

    const category  = cardEl.dataset.category  || 'General';
    const link      = cardEl.dataset.articleUrl || '#';
    const isList    = cardEl.classList.contains('card-row');
    const isFeatured = cardEl.classList.contains('card-featured');
    const w         = isList ? 240 : 640;
    const h         = isList ? 180 : 360;
    const imgCls    = isList ? 'card-img card-img--list' : 'card-img';
    const wrapCls   = isList ? 'card-img-wrap card-img-wrap--list' : 'card-img-wrap';

    existing.outerHTML = `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer" class="${wrapCls}" tabindex="-1" aria-hidden="true"><img class="${imgCls}" src="${esc(imageData.url)}" alt="" loading="${isFeatured ? 'eager' : 'lazy'}" fetchpriority="${isFeatured ? 'high' : 'auto'}" decoding="async" referrerpolicy="no-referrer" width="${w}" height="${h}" sizes="(max-width:700px) 100vw,(max-width:1100px) 50vw,33vw" data-category="${esc(category)}" data-link="${esc(link)}"></a>`;

    cardEl.dataset.imageState = 'resolved';
  }

  // ── RSS XML parser ────────────────────────────────────────────
  function parseRssXml(xmlText, feed) {
    const parser = new DOMParser();
    const doc    = parser.parseFromString(xmlText, 'application/xml');

    // Check for parse error
    if (doc.querySelector('parsererror')) throw new Error('XML parse error');

    const items = [];

    // RSS 2.0
    doc.querySelectorAll('item').forEach(item => {
      const link = getText(item, 'link') ||
                   item.querySelector('link')?.getAttribute('href') || '#';
      // content:encoded is the richest HTML source; description is shorter summary
      const contentEncoded = getText(item, 'content\\:encoded') || '';
      const desc  = getText(item, 'description') || getText(item, 'summary') || contentEncoded;
      const date  = getText(item, 'pubDate') || getText(item, 'published') || getText(item, 'updated') || '';
      items.push({
        title:    getText(item, 'title') || 'Untitled',
        link,
        snippet:  truncate(stripHtml(desc)),
        image:    extractImage(item, desc, contentEncoded),
        date,
        source:   feed.name,
        category: feed.category,
      });
    });

    // Atom feed fallback
    if (items.length === 0) {
      doc.querySelectorAll('entry').forEach(entry => {
        const linkEl = entry.querySelector('link[rel="alternate"]') || entry.querySelector('link');
        const link   = linkEl ? (linkEl.getAttribute('href') || linkEl.textContent.trim()) : '#';
        const contentHtml = getText(entry, 'content') || '';
        const desc   = getText(entry, 'summary') || contentHtml;
        const date   = getText(entry, 'updated') || getText(entry, 'published') || '';
        items.push({
          title:    getText(entry, 'title') || 'Untitled',
          link,
          snippet:  truncate(stripHtml(desc)),
          image:    extractImage(entry, desc, contentHtml),
          date,
          source:   feed.name,
          category: feed.category,
        });
      });
    }

    return items;
  }

  // ── Fetch one feed via CORS proxy → XML ───────────────────────
  async function fetchFeedDirect(feed) {
    const text = await fetchViaCorsProxy(feed.url, { timeoutMs: 10000 });
    if (!text) throw new Error('All CORS proxies failed');
    return parseRssXml(text, feed);
  }

  // ── Fallback via rss2json ─────────────────────────────────────
  async function fetchFeedJson(feed) {
    const url  = RSS2JSON + encodeURIComponent(feed.url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    if (data.status !== 'ok') throw new Error(data.message || 'rss2json error');
    return (data.items || []).map(item => {
      const descHtml    = item.description || '';
      const contentHtml = item.content     || '';
      // rss2json exposes thumbnail directly — treat as a strong candidate
      const thumb = item.thumbnail || item.enclosure?.link || null;
      const candidates = [];
      if (thumb && !isProbablyBadImageUrl(thumb)) {
        candidates.push({ url: thumb, source: 'rss-thumbnail', width: 0, height: 0, score: 20 });
      }
      // Mine HTML payloads for additional candidates
      for (const html of [contentHtml, descHtml].filter(Boolean)) {
        candidates.push(...extractImageCandidatesFromHtml(html, location.href));
      }
      const best = pickBestImageCandidate(candidates);
      const image = best ? best.url : null;
      return {
        title:    item.title    || 'Untitled',
        link:     item.link     || item.url || '#',
        snippet:  truncate(stripHtml(descHtml || contentHtml)),
        image,
        date:     item.pubDate  || item.published || '',
        source:   feed.name,
        category: feed.category,
      };
    });
  }

  // ── Fetch one feed (direct first, json fallback) ──────────────
  async function fetchFeed(feed) {
    try {
      const items = await fetchFeedDirect(feed);
      if (items.length > 0) return items;
      // empty result — try fallback
      return await fetchFeedJson(feed);
    } catch (e) {
      console.warn(`[GeeksPulse] Direct fetch failed for ${feed.name}, trying rss2json…`, e.message);
      return await fetchFeedJson(feed);
    }
  }

  // ── Load from pre-built cache (public/feed.json) ─────────────
  async function loadFeedCache() {
    const resp = await fetch('/public/feed.json', { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
    if (!resp.ok) throw new Error(`Cache ${resp.status}`);
    const data = await resp.json();
    // Reject empty placeholder
    if (!data.generatedAt || !Array.isArray(data.articles) || data.articles.length === 0) {
      throw new Error('Cache empty or not yet generated');
    }
    return data;
  }

  // Normalise a cached article to match the internal shape used by render()
  function normaliseCachedArticle(a) {
    const rawImg  = a.image ? safeUrl(a.image) : null;
    const safeImg = rawImg && rawImg !== '#' ? normalizeImageUrl(rawImg, a.link) : null;
    // Use fallbackImage from generated data if no real image available
    const fallback = a.fallbackImage || null;
    return {
      title:         a.title    || 'Untitled',
      link:          safeUrl(a.link),
      snippet:       a.summary  || '',
      image:         safeImg,
      fallbackImage: fallback,
      imageType:     a.imageType || (safeImg ? 'real' : 'fallback'),
      date:          a.publishedAt || null,
      source:        a.source   || '',
      category:      a.category || 'General',
    };
  }

  // ── Fetch all feeds (called when cache miss or manual refresh) ─
  async function fetchAllFromRSS() {
    const results = await Promise.allSettled(feeds.map(fetchFeed));
    const articles = [];

    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        articles.push(...res.value.slice(0, MAX_PER_FEED));
      } else {
        failedFeeds++;
        console.warn(`[GeeksPulse] ${feeds[i].name} completely failed:`, res.reason?.message);
      }
    });

    articles.sort((a, b) => {
      const da = new Date(a.date), db = new Date(b.date);
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    return articles.slice(0, MAX_ARTICLES);
  }

  // ── Primary entry point: cache-first, RSS emergency fallback ─
  async function fetchAll() {
    if (isLoading) return;
    isLoading = true;
    failedFeeds = 0;
    setLoading();

    let cacheGeneratedAt = null;

    try {
      // ── Step 1: load static pre-built cache (primary path) ──
      const data = await loadFeedCache();
      allArticles = data.articles.map(normaliseCachedArticle).filter(a => a.link && a.link !== '#');
      failedFeeds = data.failedFeeds || 0;
      cacheGeneratedAt = data.generatedAt || null;
      // Update feed-count spans from the canonical count in the cache
      if (data.feedCount) updateFeedCountSpans(data.feedCount);
      console.info(`[GeeksPulse] Loaded ${allArticles.length} articles from feed cache (generated ${data.generatedAt}).`);
    } catch (cacheErr) {
      // ── Step 2: emergency browser-side RSS fallback ──────────
      // Runs ONLY if the static cache is missing or empty.
      // Uses public CORS proxies which may be rate-limited.
      console.warn('[GeeksPulse] Feed cache unavailable, attempting emergency RSS fallback…', cacheErr.message);
      try {
        allArticles = await fetchAllFromRSS();
      } catch (rssErr) {
        console.error('[GeeksPulse] Emergency RSS fallback also failed:', rssErr.message);
        allArticles = [];
        // Show explicit user-facing error state
        showError('Unable to load articles. Please try refreshing the page or check back later.');
      }
    }

    isLoading = false;
    setLive();
    updateSidebarStats(cacheGeneratedAt);
    loadFeedHealthBanner();
    buildFilters();
    render();

    if (allArticles.length > 0) hideError();
  }

  // ── Render articles ───────────────────────────────────────────
  function render() {
    let visible;
    if (activeFilter === 'Bookmarks') {
      visible = loadBookmarks();
    } else {
      visible = activeFilter === 'All'
        ? allArticles
        : allArticles.filter(a => a.category === activeFilter);
    }

    // Apply search query filter
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      visible = visible.filter(a =>
        (a.title  || '').toLowerCase().includes(q) ||
        (a.snippet|| '').toLowerCase().includes(q) ||
        (a.source || '').toLowerCase().includes(q)
      );
    }

    feedGrid.innerHTML = '';
    // Apply filtered class so CSS can color cards by category
    feedGrid.classList.toggle('feed-filtered', activeFilter !== 'All');

    if (visible.length === 0 && !isLoading) {
      const isBookmarkView = activeFilter === 'Bookmarks';
      feedGrid.innerHTML = `
        <div class="empty-state visible">
          <div class="empty-art">${isBookmarkView ? '  [ GeeksPulse Bookmarks ]\n  // folder is empty' : '  ¯\\_(ツ)_/¯\n  404: news not found'}</div>
          <div class="empty-title">${isBookmarkView ? 'No saved stories yet.' : 'No articles for this filter.'}</div>
          <div class="empty-sub">${isBookmarkView ? '// click the bookmark icon on any article to save it here' : '// try another category or refresh the feeds'}</div>
        </div>`;
      articleCount.style.display = 'none';
      return;
    }

    articleCount.style.display = '';
    articleCount.innerHTML = `<strong>${visible.length}</strong> stories`;

    const isListMode = feedGrid.classList.contains('list-view');
    feedGrid.innerHTML = visible.map((a, i) =>
      isListMode ? listCard(a, i) : gridCard(a, i)
    ).join('');

    // CSS-based stagger using --i custom property (no JS timers needed)
    feedGrid.querySelectorAll('.card').forEach((el, i) => {
      el.style.setProperty('--i', Math.min(i, 20));
    });

    // Hide the static SEO fallback — it's only needed for crawlers, not live JS users
    const seoFallback = document.getElementById('seoLatestFallback');
    if (seoFallback) seoFallback.style.display = 'none';

    if (statArticles) statArticles.textContent = allArticles.length;

    // Announce result to screen readers
    announce(`${visible.length} stories shown.`);

    // Progressively fill in missing images from article metadata
    setTimeout(progressivelyResolveMissingImages, 100);
  }

  function gridCard(a, i) {
    const date = relTime(a.date);
    const num  = String(i + 1).padStart(2, '0');
    const featured = i === 0;
    const bm = isBookmarked(a.link);
    const mins = readTime(a.title, a.snippet);
    const loadingAttr  = featured ? 'eager'  : 'lazy';
    const fetchpriAttr = featured ? 'high'   : 'auto';
    const imgSrc = a.image || a.fallbackImage || null;
    const imgAlt = a.image
      ? `Article image for: ${a.title}`
      : `Category illustration for ${a.category}`;
    const imgHtml = imgSrc
      ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" class="card-img-wrap" tabindex="-1" aria-hidden="true"><img class="card-img" src="${esc(imgSrc)}" alt="${esc(imgAlt)}" loading="${loadingAttr}" fetchpriority="${fetchpriAttr}" decoding="async" referrerpolicy="no-referrer" width="640" height="360" sizes="(max-width:700px) 100vw,(max-width:1100px) 50vw,33vw" data-category="${esc(a.category)}" data-link="${esc(a.link)}"></a>`
      : cardPlaceholder(a.category, a.link);
    return `
      <article class="card${featured ? ' card-featured' : ''} ${catClass(a.category)}" data-card-idx="${i}" data-article-url="${esc(a.link)}" data-category="${esc(a.category)}">
        ${imgHtml}
        <div class="card-top">
          <span class="card-num">${num}</span>
          ${catIconCard(a.category)}
          <span class="card-cat ${catClass(a.category)}">${esc(a.category)}</span>
          ${date ? `<span class="card-date">${date}</span>` : ''}
          <button class="bm-btn${bm ? ' bm-active' : ''}" data-bm-link="${esc(a.link)}" title="${bm ? 'Remove bookmark' : 'Save to GeeksPulse bookmarks'}" aria-label="${bm ? 'Remove bookmark' : 'Bookmark this article'}">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="${bm ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
          </button>
        </div>
        <h2 class="card-title">
          <a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
        </h2>
        ${a.snippet ? `<p class="card-snippet">${esc(a.snippet)}</p>` : ''}
        <div class="card-footer">
          <div class="card-source">
            <span class="src-dot ${catClass(a.category)}"></span>
            <span>${esc(a.source)}</span>
            <span class="card-read-time">${mins} min read</span>
          </div>
          <div class="card-actions">
            <button class="card-share-btn" data-share-url="${esc(a.link)}" data-share-title="${esc(a.title)}" title="Share" aria-label="Share article">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            </button>
            <a class="card-link" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">
              Read →
            </a>
          </div>
        </div>
      </article>`;
  }

  function listCard(a, i) {
    const date = relTime(a.date);
    const num  = String(i + 1).padStart(2, '0');
    const bm = isBookmarked(a.link);
    const mins = readTime(a.title, a.snippet);
    const listImgSrc = a.image || a.fallbackImage || null;
    const listImgAlt = a.image ? `Article image for: ${a.title}` : `Category illustration for ${a.category}`;
    const imgHtml = listImgSrc
      ? `<a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer" class="card-img-wrap card-img-wrap--list" tabindex="-1" aria-hidden="true"><img class="card-img card-img--list" src="${esc(listImgSrc)}" alt="${esc(listImgAlt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" width="240" height="180" data-category="${esc(a.category)}" data-link="${esc(a.link)}"></a>`
      : `<span class="card-img-wrap card-img-wrap--list card-placeholder card-placeholder--list" style="--ph-color:${catMeta[a.category]?.color||'#94A3B8'}"><span class="card-placeholder__icon">${catMeta[a.category] ? catMeta[a.category].icon.replace(/width="\d+" height="\d+"/, 'width="28" height="28"') : ''}</span></span>`;
    return `
      <article class="card card-row ${catClass(a.category)}" data-card-idx="${i}" data-article-url="${esc(a.link)}" data-category="${esc(a.category)}">
        <span class="card-num">${num}</span>
        ${imgHtml}
        <div class="card-body">
          <div class="card-top">
            ${catIconCard(a.category)}
            <span class="card-cat ${catClass(a.category)}">${esc(a.category)}</span>
            ${date ? `<span class="card-date">${date}</span>` : ''}
            <button class="bm-btn${bm ? ' bm-active' : ''}" data-bm-link="${esc(a.link)}" title="${bm ? 'Remove bookmark' : 'Save to GeeksPulse bookmarks'}" aria-label="${bm ? 'Remove bookmark' : 'Bookmark this article'}">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="${bm ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
            </button>
          </div>
          <h2 class="card-title">
            <a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
          </h2>
          ${a.snippet ? `<p class="card-snippet card-snippet--sm">${esc(a.snippet)}</p>` : ''}
          <div class="card-source">
            <span class="src-dot ${catClass(a.category)}"></span>
            <span>${esc(a.source)}</span>
            <span class="card-read-time">${mins} min read</span>
          </div>
        </div>
        <div class="card-actions" style="flex-direction:column;gap:6px;">
          <button class="card-share-btn" data-share-url="${esc(a.link)}" data-share-title="${esc(a.title)}" title="Share" aria-label="Share article">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
          </button>
          <a class="card-link" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Read →</a>
        </div>
      </article>`;
  }

  // ── Skeleton ─────────────────────────────────────────────────
  function showSkeletons(n = 8) {
    feedGrid.innerHTML = Array.from({ length: n }, () => `
      <div class="skeleton-card">
        <div class="sk sk-chip"></div>
        <div class="sk sk-h1"></div>
        <div class="sk sk-h2"></div>
        <div class="sk sk-t1"></div>
        <div class="sk sk-t2"></div>
        <div class="sk sk-t3"></div>
        <div class="sk sk-foot"></div>
      </div>`).join('');
  }

  // ── State setters ─────────────────────────────────────────────
  function setLoading() {
    statusDot.className = 'status-dot loading';
    statusText.textContent = randomMsg();
    if (navStatus) navStatus.textContent = 'geekspulse --fetch';
    articleCount.style.display = 'none';
    setRefreshBusy(true);
    showSkeletons(8);
    hideError();
    // Show the static SEO fallback above the skeleton while live feed is fetching
    const seoFallback = document.getElementById('seoLatestFallback');
    if (seoFallback) seoFallback.style.display = '';
  }

  function setLive() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    statusDot.className = 'status-dot live';
    statusText.textContent = `${allArticles.length} fresh stories loaded · Updated at ${timeStr}`;
    if (navStatus) navStatus.textContent = `✓ ${allArticles.length} articles`;
    setRefreshBusy(false);
    // Animate hero stat counters
    if (statArticles) animateCounter(statArticles, allArticles.length, 900);
    const statFeedsEl = document.getElementById('statFeeds');
    if (statFeedsEl) animateCounter(statFeedsEl, feeds.length, 700);
    // Today's stories count
    const todayStart = new Date(); todayStart.setHours(0,0,0,0);
    const todayCount = allArticles.filter(a => { try { return new Date(a.date) >= todayStart; } catch { return false; } }).length;
    const statTodayEl = document.getElementById('statToday');
    if (statTodayEl) animateCounter(statTodayEl, todayCount, 800);
    // Sync newsletter feed count
    const nlFeedCount = document.getElementById('newsletterFeedCount');
    if (nlFeedCount) nlFeedCount.textContent = feeds.length - failedFeeds;
  }

  function setRefreshBusy(busy) {
    [refreshBtn, refreshBtnHero].filter(Boolean).forEach(btn => { if (btn) btn.disabled = busy; });
    if (refreshIcon) refreshIcon.classList.toggle('spin', busy);
  }

  function updateSidebarStats(cacheGeneratedAt) {
    if (sbFeeds)   sbFeeds.textContent   = feeds.length - failedFeeds;
    if (sbUpdated) {
      if (cacheGeneratedAt) {
        try {
          const d = new Date(cacheGeneratedAt);
          sbUpdated.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          sbUpdated.title = d.toLocaleString();
        } catch { sbUpdated.textContent = '--'; }
      } else {
        sbUpdated.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }
    }
    if (sbFailed)  sbFailed.textContent  = failedFeeds;
    const sbBmCount = document.getElementById('sbBmCount');
    if (sbBmCount) sbBmCount.textContent = loadBookmarks().length;
  }

  /** Load feed-health.json and render the compact health banner above the feed grid. */
  async function loadFeedHealthBanner() {
    const bar = document.getElementById('feedHealthBar');
    if (!bar) return;
    try {
      const resp = await fetch('/public/feed-health.json', { cache: 'no-cache', signal: AbortSignal.timeout(5000) });
      if (!resp.ok) return;
      const health = await resp.json();
      const total   = Array.isArray(health.feeds) ? health.feeds.length : feeds.length;
      const ok      = Array.isArray(health.feeds) ? health.feeds.filter(f => f.ok).length : (total - failedFeeds);
      const failed  = total - ok;
      const failed_list = Array.isArray(health.feeds) ? health.feeds.filter(f => !f.ok) : [];
      let updatedStr = '';
      if (health.generatedAt) {
        try {
          const d = new Date(health.generatedAt);
          updatedStr = `Last updated ${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · `;
        } catch { /* skip */ }
      }
      const statusEmoji = failed === 0 ? '🟢' : '🟡';
      const onlineStr = `${ok}/${total} feeds online`;
      let html = `<span class="fhb-info">${statusEmoji} ${updatedStr}${onlineStr}</span>`;
      if (failed > 0 && failed_list.length > 0) {
        const items = failed_list.map(f => `<li>${esc(f.name)}${f.error ? ' — ' + esc(f.error.slice(0, 60)) : ''}</li>`).join('');
        html += `<details class="fhb-details"><summary>${failed} feed${failed > 1 ? 's' : ''} need${failed === 1 ? 's' : ''} attention</summary><ul>${items}</ul></details>`;
      }
      bar.innerHTML = html;
      bar.style.display = '';
    } catch (e) {
      // Health banner is non-critical; silently skip if unavailable
      console.debug('[GeeksPulse] feed-health.json unavailable for health bar:', e.message);
    }
  }

  function showError(msg) { errorMessage.textContent = msg; errorBanner.classList.add('visible'); }
  function hideError()    { errorBanner.classList.remove('visible'); }

  // ── Build sidebar + mobile filters ───────────────────────────
  function buildFilters() {
    const counts = {};
    allArticles.forEach(a => { counts[a.category] = (counts[a.category] || 0) + 1; });
    const bmCount = loadBookmarks().length;

    sidebarFilters.innerHTML = categories.map(c => {
      let count;
      if (c.id === 'All') count = allArticles.length;
      else if (c.id === 'Bookmarks') count = bmCount;
      else count = counts[c.id] || 0;
      const isActive = c.id === activeFilter;
      return `
        <button class="filter-item${isActive ? ' active' : ''}" data-cat="${esc(c.id)}" aria-pressed="${isActive}">
          <span class="fi-icon" style="color:${c.color}">${c.icon}</span>
          <span class="fi-label">${esc(c.label)}</span>
          <span class="fi-count">${count}</span>
        </button>`;
    }).join('');

    mobileFilters.innerHTML = categories.map(c => `
      <button class="chip${c.id === activeFilter ? ' active' : ''}" data-cat="${esc(c.id)}">
        <span style="color:${c.color};display:inline-flex;vertical-align:middle;margin-right:4px">${c.icon}</span>${esc(c.id)}
      </button>`).join('');

    [sidebarFilters, mobileFilters].forEach(el => {
      el.addEventListener('click', e => {
        const btn = e.target.closest('[data-cat]');
        if (!btn) return;
        setFilter(btn.dataset.cat);
      });
    });
  }

  window.__setFilter = function(cat) { setFilter(cat); };
  function setFilter(cat) {
    activeFilter = cat;
    PREF.set('filter', cat);
    gaEvent('filter_category', { category: cat });
    [sidebarFilters, mobileFilters].forEach(container => {
      container.querySelectorAll('[data-cat]').forEach(btn => {
        const active = btn.dataset.cat === cat;
        btn.classList.toggle('active', active);
        if (btn.hasAttribute('aria-pressed')) btn.setAttribute('aria-pressed', String(active));
      });
    });
    render();
  }

  // ── View toggle ───────────────────────────────────────────────
  function applyView() {
    feedGrid.classList.toggle('list-view', viewMode === 'list');
    gridViewBtn.classList.toggle('active', viewMode === 'grid');
    listViewBtn.classList.toggle('active', viewMode === 'list');
    gridViewBtn.setAttribute('aria-pressed', String(viewMode === 'grid'));
    listViewBtn.setAttribute('aria-pressed', String(viewMode === 'list'));
  }

  // ── Nav scroll effect ────────────────────────────────────────
  function initNav() {
    const nav = document.querySelector('.top-nav');
    if (!nav) return;
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // ── Animated counter ─────────────────────────────────────────
  function animateCounter(el, target, duration = 800) {
    if (!el || isNaN(target)) return;
    const start = performance.now();
    const from  = 0;
    const tick  = now => {
      const p = Math.min((now - start) / duration, 1);
      // ease out cubic
      const ease = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(from + (target - from) * ease);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  // ── Auto-refresh ─────────────────────────────────────────────
  function startAutoRefresh(minutes) {
    // clear existing timers
    clearInterval(autoTimer);
    clearInterval(countdownTimer);
    autoTimer = null; countdownTimer = null;
    updateCountdownUI(0);

    if (!minutes) return;

    countdownSecs = minutes * 60;
    updateCountdownUI(countdownSecs);

    countdownTimer = setInterval(() => {
      countdownSecs--;
      updateCountdownUI(countdownSecs);
      if (countdownSecs <= 0) clearInterval(countdownTimer);
    }, 1000);

    autoTimer = setInterval(() => {
      fetchAll().then(() => {
        // restart countdown after fetch
        startAutoRefresh(autoRefreshMin);
      });
    }, minutes * 60 * 1000);
  }

  function updateCountdownUI(secs) {
    const el = document.getElementById('autoRefreshCountdown');
    if (!el) return;
    if (!secs || secs <= 0) { el.textContent = ''; el.style.display = 'none'; return; }
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    el.textContent = `↻ ${m}:${String(s).padStart(2,'0')}`;
    el.style.display = '';
  }


  // ── Settings popover ──────────────────────────────────────────
  function initSettings() {
    // Inject settings button into nav-actions (before support button)
    const navActions = document.querySelector('.nav-actions');
    if (!navActions) return;

    const settingsBtn = document.createElement('button');
    settingsBtn.id = 'settingsBtn';
    settingsBtn.className = 'btn btn-ghost btn-sm';
    settingsBtn.title = 'Settings';
    settingsBtn.setAttribute('aria-label', 'Open settings');
    settingsBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg><span class="btn-label"> Settings</span>';
    settingsBtn.title = 'Settings';
    // insert before the support button (last child)
    navActions.insertBefore(settingsBtn, navActions.lastElementChild);

    // Inject countdown badge next to toolbar status
    const toolbarLeft = document.querySelector('.toolbar-left');
    if (toolbarLeft) {
      const cd = document.createElement('span');
      cd.id = 'autoRefreshCountdown';
      cd.className = 'auto-countdown';
      cd.style.display = 'none';
      toolbarLeft.appendChild(cd);
    }

    // Build popover
    const popover = document.createElement('div');
    popover.id = 'settingsPopover';
    popover.className = 'settings-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Settings');
    popover.innerHTML = `
      <div class="settings-header">
        <span class="settings-title"><svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>Settings</span>
      </div>
      <div class="settings-section">
        <div class="settings-label">Auto-refresh</div>
        <div class="settings-options" id="refreshOptions">
          ${REFRESH_OPTIONS.map(o => `
            <button class="settings-opt${autoRefreshMin === o.value ? ' active' : ''}"
                    data-refresh="${o.value}">${o.label}</button>
          `).join('')}
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-label">View</div>
        <div class="settings-options">
          <button class="settings-opt${viewMode === 'grid' ? ' active' : ''}" data-view="grid">Grid</button>
          <button class="settings-opt${viewMode === 'list' ? ' active' : ''}" data-view="list">List</button>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-label">Theme</div>
        <div class="settings-options">
          <button class="settings-opt${(PREF.get('theme') || 'dark') === 'dark' ? ' active' : ''}" data-theme-opt="dark">Dark</button>
          <button class="settings-opt${(PREF.get('theme') || 'dark') === 'light' ? ' active' : ''}" data-theme-opt="light">Light</button>
        </div>
      </div>
      <div class="settings-section">
        <div class="settings-label">Cache</div>
        <button class="settings-opt settings-opt--danger" id="clearCacheBtn" style="width:100%;text-align:left;">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>Clear all site data
        </button>
      </div>
      <div class="settings-footer">
        <span class="settings-note">// prefs saved in localStorage</span>
      </div>`;
    document.body.appendChild(popover);

    // Toggle popover
    let open = false;
    const openPopover = () => {
      open = true;
      const r = settingsBtn.getBoundingClientRect();
      popover.style.position = 'fixed';
      popover.style.top  = (r.bottom + 8) + 'px';
      popover.style.right = (window.innerWidth - r.right) + 'px';
      popover.style.left = '';
      popover.classList.add('open');
    };
    const closePopover = () => { open = false; popover.classList.remove('open'); };

    settingsBtn.addEventListener('click', e => {
      e.stopPropagation();
      open ? closePopover() : openPopover();
    });
    document.addEventListener('click', e => {
      if (open && !popover.contains(e.target)) closePopover();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closePopover(); });


    // Auto-refresh buttons
    popover.querySelector('#refreshOptions').addEventListener('click', e => {
      const btn = e.target.closest('[data-refresh]');
      if (!btn) return;
      autoRefreshMin = parseInt(btn.dataset.refresh, 10);
      PREF.set('autorefresh', autoRefreshMin);
      popover.querySelectorAll('[data-refresh]').forEach(b =>
        b.classList.toggle('active', parseInt(b.dataset.refresh,10) === autoRefreshMin)
      );
      startAutoRefresh(autoRefreshMin);
    });

    // View buttons inside settings
    popover.querySelectorAll('[data-view]').forEach(btn => {
      btn.addEventListener('click', () => {
        viewMode = btn.dataset.view;
        PREF.set('view', viewMode);
        applyView();
        render();
        popover.querySelectorAll('[data-view]').forEach(b =>
          b.classList.toggle('active', b.dataset.view === viewMode)
        );
        // sync main view toggle buttons too
        document.getElementById('gridViewBtn')?.classList.toggle('active', viewMode === 'grid');
        document.getElementById('listViewBtn')?.classList.toggle('active', viewMode === 'list');
      });
    });

    // Clear cache button inside settings
    popover.querySelector('#clearCacheBtn')?.addEventListener('click', () => {
      // Build confirmation dialog
      const overlay = document.createElement('div');
      overlay.className = 'cache-confirm-overlay';
      overlay.innerHTML = `
        <div class="cache-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cacheConfirmTitle">
          <div class="cache-confirm-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </div>
          <h3 id="cacheConfirmTitle" class="cache-confirm-title">Clear all site data?</h3>
          <p class="cache-confirm-desc">This will remove all cached images, bookmarks, and preferences (theme, view, filters, auto-refresh). The page will reload.<br/><span class="cache-confirm-note">// This action cannot be undone.</span></p>
          <div class="cache-confirm-actions">
            <button class="btn btn-ghost btn-sm" id="cacheConfirmCancel">Cancel</button>
            <button class="btn btn-sm cache-confirm-delete" id="cacheConfirmOk">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="margin-right:5px"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>Yes, clear everything
            </button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      closePopover();

      const removeOverlay = () => overlay.remove();

      overlay.querySelector('#cacheConfirmCancel').addEventListener('click', removeOverlay);
      overlay.addEventListener('click', e => { if (e.target === overlay) removeOverlay(); });
      document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { removeOverlay(); document.removeEventListener('keydown', onKey); }
      });

      overlay.querySelector('#cacheConfirmOk').addEventListener('click', () => {
        const siteKeys = Object.keys(localStorage).filter(k =>
          k.startsWith('gp:') || k.startsWith('geeksup_')
        );
        siteKeys.forEach(k => localStorage.removeItem(k));
        removeOverlay();
        showBmToast(`🗑️ Cache cleared (${siteKeys.length} item${siteKeys.length !== 1 ? 's' : ''}) — reloading…`);
        setTimeout(() => location.reload(), 1200);
      });
    });

    // Theme buttons inside settings
    popover.querySelectorAll('[data-theme-opt]').forEach(btn => {
      btn.addEventListener('click', () => {
        const newTheme = btn.dataset.themeOpt;
        if (newTheme === 'light') {
          document.documentElement.setAttribute('data-theme', 'light');
        } else {
          document.documentElement.removeAttribute('data-theme');
        }
        PREF.set('theme', newTheme);
        giscusTheme(newTheme);
        popover.querySelectorAll('[data-theme-opt]').forEach(b =>
          b.classList.toggle('active', b.dataset.themeOpt === newTheme)
        );
      });
    });
  }

  // ── PayPal QR modal ──────────────────────────────────────────
  function initPayPalModal() {
    const PAYPAL_ME = 'https://paypal.me/MajidAbarghooei';
    const QR_URL    = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=12&data=${encodeURIComponent(PAYPAL_ME)}`;

    // Inject modal HTML once
    const modal = document.createElement('div');
    modal.id = 'ppModal';
    modal.className = 'pp-modal-backdrop';
    modal.innerHTML = `
      <div class="pp-modal" role="dialog" aria-modal="true" aria-label="Support via PayPal">
        <button class="pp-close" aria-label="Close">✕</button>
        <div class="pp-icon"><svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7.076 21.337H2.47a.641.641 0 0 1-.633-.74L4.944.901C5.026.382 5.474 0 5.998 0h7.46c2.57 0 4.578.543 5.69 1.81 1.01 1.15 1.304 2.42 1.012 4.287-.023.143-.047.288-.077.437-.983 5.05-4.349 6.797-8.647 6.797h-2.19c-.524 0-.968.382-1.05.9l-1.12 7.106zm14.146-14.42a3.35 3.35 0 0 0-.607-.541c-.013.076-.026.175-.041.254-.93 4.778-4.005 7.201-9.138 7.201h-2.19a.563.563 0 0 0-.556.479l-1.187 7.527h-.506l-.24 1.516a.56.56 0 0 0 .554.647h3.882c.46 0 .85-.334.922-.788.06-.26.76-4.852.816-5.09a.932.932 0 0 1 .923-.788h.58c3.76 0 6.705-1.528 7.565-5.946.36-1.847.174-3.388-.777-4.471z"/></svg></div>
        <h3 class="pp-title">Support GeeksPulse</h3>
        <p class="pp-desc">Scan with your phone camera or PayPal app</p>
        <div class="pp-qr-wrap">
          <img src="${QR_URL}" alt="PayPal QR code" width="220" height="220" class="pp-qr" />
        </div>
        <a href="${PAYPAL_ME}" target="_blank" rel="noopener noreferrer" class="pp-link">
          Or open PayPal.me →
        </a>
        <p class="pp-thanks">// thank you, you absolute legend <svg aria-hidden="true" viewBox="0 0 16 16" width="13" height="13" fill="currentColor" style="vertical-align:-2px"><path d="M8 14s-6-3.9-6-8a4 4 0 0 1 6-3.44A4 4 0 0 1 14 6c0 4.1-6 8-6 8z"/></svg></p>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.classList.remove('open');
    modal.querySelector('.pp-close').addEventListener('click', close);
    modal.addEventListener('click', e => { if (e.target === modal) close(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

    // Wire all support buttons
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-support]');
      if (btn) { e.preventDefault(); modal.classList.add('open'); }
    });
  }

  // ── Bookmark toast ────────────────────────────────────────────
  let toastTimer = null;
  function showBmToast(msg) {
    let toast = document.getElementById('bmToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'bmToast';
      toast.className = 'bm-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 2400);
  }

  // ── Lazy-load Giscus comments ─────────────────────────────────
  function initGiscusLazy() {
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

  // ── Live-region for screen reader announcements ───────────────
  function announce(message) {
    const el = document.getElementById('feedStatus');
    if (el) el.textContent = message;
  }
  function giscusTheme(theme) {
    // Map site theme → a Giscus theme name
    const gTheme = theme === 'light' ? 'light' : 'dark_dimmed';
    // Update the script tag so a future page load picks the right default
    const script = document.getElementById('giscus-script');
    if (script) script.setAttribute('data-theme', gTheme);
    // Notify an already-loaded Giscus iframe via postMessage
    const iframe = document.querySelector('iframe.giscus-frame');
    if (iframe) {
      iframe.contentWindow.postMessage(
        { giscus: { setConfig: { theme: gTheme } } },
        'https://giscus.app'
      );
    }
  }

  function initTheme() {
    const savedTheme = PREF.get('theme') || 'dark';
    if (savedTheme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    // Sync Giscus with the restored theme (works if Giscus loaded before app.js runs)
    giscusTheme(savedTheme);

    // If Giscus iframe loads after us, catch it with a MutationObserver
    if (savedTheme !== 'dark') {
      const observer = new MutationObserver(() => {
        const iframe = document.querySelector('iframe.giscus-frame');
        if (iframe) {
          observer.disconnect();
          // Give the iframe a moment to finish initialising before sending the message
          setTimeout(() => giscusTheme(savedTheme), 300);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

  }

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    initTheme();

    // Sync all static feed-count placeholders to actual feeds.length
    ['heroFeedCount', 'termFeedCount'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.textContent = feeds.length;
    });
    // statFeeds is animated after fetch; seed it now so it's never stale on first paint
    const statFeedsEl = document.getElementById('statFeeds');
    if (statFeedsEl) statFeedsEl.textContent = feeds.length;

    /** Update all feed-count spans from a canonical count (e.g. from the pre-built cache). */
    function updateFeedCountSpans(count) {
      ['heroFeedCount', 'termFeedCount'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = count;
      });
      const sf = document.getElementById('statFeeds');
      if (sf) sf.textContent = count;
    }

    initNav();
    initSettings();
    initPayPalModal();
    initGiscusLazy();
    applyView();
    buildFilters();

    gridViewBtn.addEventListener('click', () => {
      viewMode = 'grid';
      PREF.set('view', viewMode);
      applyView();
      render();
    });
    listViewBtn.addEventListener('click', () => {
      viewMode = 'list';
      PREF.set('view', viewMode);
      applyView();
      render();
    });

    [refreshBtn, refreshBtnHero].filter(Boolean).forEach(btn => {
      if (btn) btn.addEventListener('click', () => {
        gaEvent('refresh_feeds', { trigger: btn.id || 'refresh_btn' });
        fetchAll();
      });
    });

    fetchAll().then(() => startAutoRefresh(autoRefreshMin));

    // Clear bookmarks button
    const clearBmBtn = document.getElementById('clearBookmarksBtn');
    if (clearBmBtn) {
      clearBmBtn.addEventListener('click', () => {
        if (loadBookmarks().length === 0) return;
        saveBookmarks([]);
        buildFilters();
        updateSidebarStats();
        if (activeFilter === 'Bookmarks') render();
        showBmToast('🗑️ All bookmarks cleared');
      });
    }

    // Initialize bookmark count
    updateSidebarStats();

    // Delegated image load handler — if the loaded image is smaller than the
    // card's display area, it would be upscaled and look blurry. Replace it
    // with the category placeholder instead. Capture phase to run reliably.
    feedGrid.addEventListener('load', async event => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (!img.classList.contains('card-img')) return;

      const nW = img.naturalWidth  || 0;
      const nH = img.naturalHeight || 0;
      // Ignore obviously invalid loads (handled by error path)
      if (nW === 0 || nH === 0) return;

      const wrap = img.closest('.card-img-wrap');
      const card = img.closest('.card');
      if (!wrap || !card) return;

      // Required size = rendered wrap size scaled by device pixel ratio (cap dpr at 2
      // to avoid being overly strict on retina screens). Fall back to declared
      // width/height attributes if layout hasn't measured the wrap yet.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = wrap.getBoundingClientRect();
      const targetW = (rect.width  || Number(img.getAttribute('width'))  || 0) * dpr;
      const targetH = (rect.height || Number(img.getAttribute('height')) || 0) * dpr;
      if (targetW === 0 || targetH === 0) return;

      // Allow a small tolerance (image may be slightly under target without
      // looking bad). Treat as "too small" if either dimension is < 80% of target.
      const TOL = 0.8;
      if (nW >= targetW * TOL && nH >= targetH * TOL) return;

      const category = card.dataset.category || img.dataset.category || 'General';
      const link     = card.dataset.articleUrl || img.dataset.link || '#';
      // Prevent the error handler from also firing if we strip the src
      img.onerror = null;
      wrap.outerHTML = cardPlaceholder(category, link);
    }, true);

    // Delegated image error handler — capture phase so it fires before bubbling stops.
    // Replaces broken images with a placeholder, then tries to resolve a metadata fallback.
    feedGrid.addEventListener('error', async event => {
      const img = event.target;
      if (!(img instanceof HTMLImageElement)) return;
      if (!img.classList.contains('card-img')) return;

      const card = img.closest('.card');
      const wrap = img.closest('.card-img-wrap');
      if (!card || !wrap) return;

      const category = card.dataset.category || img.dataset.category || 'General';
      const link     = card.dataset.articleUrl || img.dataset.link || '#';

      // Immediately replace the broken image with the category placeholder
      wrap.outerHTML = cardPlaceholder(category, link);

      if (!link || link === '#') return;

      // Then attempt to resolve a better image from the article's page metadata
      try {
        const imageData = await resolveArticleMetadataImage(link);
        if (imageData) updateCardImage(card, imageData);
      } catch (err) {
        console.warn('[GeeksPulse] Could not resolve fallback image after image error', err);
      }
    }, true);

    // Bookmark button delegation
    feedGrid.addEventListener('click', e => {
      const btn = e.target.closest('.bm-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const link = btn.dataset.bmLink;
      let article = allArticles.find(a => a.link === link)
                 || loadBookmarks().find(a => a.link === link);
      if (!article) return;
      const added = toggleBookmark(article);
      gaEvent(added ? 'bookmark_add' : 'bookmark_remove', {
        article_title: article.title,
        article_source: article.source,
        article_url: article.link,
      });
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', added ? 'currentColor' : 'none');
      btn.classList.toggle('bm-active', added);
      btn.title = added ? 'Remove bookmark' : 'Save to GeeksPulse bookmarks';
      btn.setAttribute('aria-label', added ? 'Remove bookmark' : 'Bookmark this article');
      showBmToast(added
        ? '🔖 Saved to GeeksPulse bookmarks'
        : '🗑️ Removed from bookmarks');
      buildFilters();
      if (activeFilter === 'Bookmarks') render();
    });

    // Share button delegation
    feedGrid.addEventListener('click', e => {
      const btn = e.target.closest('.card-share-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      gaEvent('share', {
        article_title: btn.dataset.shareTitle,
        article_url: btn.dataset.shareUrl,
      });
      shareArticle(btn.dataset.shareTitle, btn.dataset.shareUrl);
    });

    // Outbound article link tracking
    feedGrid.addEventListener('click', e => {
      const link = e.target.closest('a[href]');
      if (!link) return;
      const card = link.closest('.card');
      if (!card) return;
      const url = link.href;
      const title = card.querySelector('.card-title a')?.textContent?.trim() || '';
      const source = card.querySelector('.card-source span:nth-child(2)')?.textContent?.trim() || '';
      const category = card.dataset.category || '';
      gaEvent('select_content', {
        content_type: 'article',
        item_id: url,
        article_title: title,
        article_source: source,
        article_category: category,
      });
    });

    // ── Search ─────────────────────────────────────────────────    const searchInput = document.getElementById('articleSearch');
    const searchKbd   = document.getElementById('searchKbd');
    if (searchInput) {
      let debounceTimer;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          searchQuery = searchInput.value.trim();
          if (searchQuery.length >= 3) {
            gaEvent('search', { search_term: searchQuery });
          }
          render();
        }, 180);
      });
      searchInput.addEventListener('focus', () => {
        if (searchKbd) searchKbd.style.display = 'none';
      });
      searchInput.addEventListener('blur', () => {
        if (searchKbd && !searchInput.value) searchKbd.style.display = '';
      });
    }

    // ── Keyboard shortcuts ──────────────────────────────────────
    document.addEventListener('keydown', e => {
      // Don't intercept when focus is in an input/textarea
      const tag = document.activeElement?.tagName?.toLowerCase();
      const inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      if (e.key === '/' && !inInput) {
        e.preventDefault();
        searchInput?.focus();
        searchInput?.select();
        return;
      }
      if (e.key === 'Escape' && inInput) {
        searchInput?.blur();
        if (searchInput) { searchInput.value = ''; searchQuery = ''; render(); }
        return;
      }
      if (e.key === 'r' && !inInput && !e.ctrlKey && !e.metaKey) {
        fetchAll();
        return;
      }
      // j/k navigation
      if ((e.key === 'j' || e.key === 'k') && !inInput) {
        const cards = Array.from(feedGrid.querySelectorAll('.card'));
        if (!cards.length) return;
        e.preventDefault();
        focusedCardIdx = e.key === 'j'
          ? Math.min(focusedCardIdx + 1, cards.length - 1)
          : Math.max(focusedCardIdx - 1, 0);
        cards[focusedCardIdx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        cards[focusedCardIdx]?.querySelector('a')?.focus();
        return;
      }
      // o = open focused card
      if (e.key === 'o' && !inInput && focusedCardIdx >= 0) {
        const cards = Array.from(feedGrid.querySelectorAll('.card'));
        const link = cards[focusedCardIdx]?.querySelector('.card-title a');
        if (link) window.open(link.href, '_blank', 'noopener,noreferrer');
        return;
      }
    });

    // ── Newsletter form ─────────────────────────────────────────
    const nlForm = document.getElementById('newsletterForm');
    const nlMsg  = document.getElementById('newsletterMsg');
    const nlBtn  = document.getElementById('newsletterSubmit');
    if (nlForm) {
      nlForm.addEventListener('submit', async e => {
        e.preventDefault();
        const email = document.getElementById('newsletterEmail')?.value?.trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          showNlMsg('Please enter a valid email address.', 'error');
          return;
        }
        if (nlBtn) { nlBtn.disabled = true; nlBtn.textContent = 'Sending…'; }
        try {
          const res = await fetch(nlForm.action, {
            method: 'POST',
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ email, _subject: 'New GeeksPulse subscriber' }),
          });
          if (res.ok) {
            showNlMsg('🎉 You\'re subscribed! Check your inbox.', 'ok');
            nlForm.reset();
          } else {
            showNlMsg('Something went wrong. Try again.', 'error');
          }
        } catch {
          showNlMsg('Network error. Please try again.', 'error');
        } finally {
          if (nlBtn) { nlBtn.disabled = false; nlBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M22 2 11 13"/><path d="M22 2 15 22 11 13 2 9l20-7z"/></svg> Subscribe free'; }
        }
      });
    }
  }

  function showNlMsg(msg, type) {
    const el = document.getElementById('newsletterMsg');
    if (!el) return;
    el.textContent = msg;
    el.style.display = '';
    el.className = 'newsletter-msg ' + (type === 'ok' ? 'newsletter-msg--ok' : 'newsletter-msg--err');
  }

  document.addEventListener('DOMContentLoaded', init);

  // ── Back to top ───────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('backToTop');
    if (!btn) return;
    let visible = false;
    let hideTimer = null;

    function onScroll() {
      const shouldShow = window.scrollY > 300;
      if (shouldShow && !visible) {
        visible = true;
        clearTimeout(hideTimer);
        btn.classList.remove('hiding');
        btn.classList.add('visible');
      } else if (!shouldShow && visible) {
        visible = false;
        btn.classList.add('hiding');
        hideTimer = setTimeout(() => {
          btn.classList.remove('visible', 'hiding');
        }, 220);
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    // Run once in case page loads already scrolled
    onScroll();

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // ── Tweet Carousel ───────────────────────────────────────────
  (() => {
    const track    = document.getElementById('tweetTrack');
    const dotsWrap = document.getElementById('tweetDots');
    const prevBtn  = document.getElementById('tweetPrev');
    const nextBtn  = document.getElementById('tweetNext');
    if (!track || !dotsWrap || !prevBtn || !nextBtn) return;

    const cards = Array.from(track.querySelectorAll('.tweet-card'));
    let current = 0;
    let autoTimer = null;
    const AUTO_MS = 5000;

    function visibleCount() {
      const w = track.parentElement.offsetWidth;
      if (w >= 980) return 3;
      if (w >= 620) return 2;
      return 1;
    }

    function cardWidth() {
      const c = cards[0];
      const gap = 20;
      return c.offsetWidth + gap;
    }

    const maxIndex = () => Math.max(0, cards.length - visibleCount());

    function goTo(idx, animated = true) {
      current = Math.max(0, Math.min(idx, maxIndex()));
      track.style.transition = animated
        ? 'transform 0.45s cubic-bezier(0.25,0.8,0.25,1)'
        : 'none';
      track.style.transform = `translateX(-${current * cardWidth()}px)`;
      updateDots();
      updateNavBtns();
    }

    function updateDots() {
      const total = maxIndex() + 1;
      // Rebuild dots only if count changed
      if (dotsWrap.children.length !== total) {
        dotsWrap.innerHTML = '';
        for (let i = 0; i < total; i++) {
          const d = document.createElement('button');
          d.className = 'tweet-dot';
          d.setAttribute('role', 'tab');
          d.setAttribute('aria-label', `Go to slide ${i + 1}`);
          d.addEventListener('click', () => { goTo(i); resetAuto(); });
          dotsWrap.appendChild(d);
        }
      }
      Array.from(dotsWrap.children).forEach((d, i) => {
        d.classList.toggle('active', i === current);
        d.setAttribute('aria-selected', i === current ? 'true' : 'false');
      });
    }

    function updateNavBtns() {
      prevBtn.disabled = current === 0;
      nextBtn.disabled = current >= maxIndex();
    }

    function resetAuto() {
      clearInterval(autoTimer);
      autoTimer = setInterval(() => {
        goTo(current >= maxIndex() ? 0 : current + 1);
      }, AUTO_MS);
    }

    prevBtn.addEventListener('click', () => { goTo(current - 1); resetAuto(); });
    nextBtn.addEventListener('click', () => { goTo(current + 1); resetAuto(); });

    // ── Pointer-based swipe / drag (mouse + touch + pen) ──────────
    let dragging      = false;
    let pointerId     = null;
    let startX        = 0;
    let startY        = 0;
    let currentDx     = 0;
    let baseTranslate = 0;
    let axisLocked    = false;   // becomes true once we know horizontal vs vertical
    let isHorizontal  = false;
    let dragStartTime = 0;
    let suppressClick = false;
    const DRAG_THRESHOLD = 6;     // px before we decide axis
    const SWIPE_DISTANCE = 50;    // px to advance one slide
    const SWIPE_VELOCITY = 0.4;   // px/ms quick-flick threshold

    function onPointerDown(e) {
      // Ignore non-primary mouse buttons
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging      = true;
      axisLocked    = false;
      isHorizontal  = false;
      pointerId     = e.pointerId;
      startX        = e.clientX;
      startY        = e.clientY;
      currentDx     = 0;
      dragStartTime = performance.now();
      baseTranslate = -current * cardWidth();
      track.style.transition = 'none';
      clearInterval(autoTimer);
    }

    function onPointerMove(e) {
      if (!dragging || e.pointerId !== pointerId) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      if (!axisLocked) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        isHorizontal = Math.abs(dx) > Math.abs(dy);
        axisLocked   = true;
        if (isHorizontal) {
          track.style.cursor = 'grabbing';
          try { track.setPointerCapture(pointerId); } catch (_) {}
        } else {
          // Let the page scroll vertically; abandon drag.
          dragging = false;
          track.style.transition = 'transform 0.45s cubic-bezier(0.25,0.8,0.25,1)';
          track.style.transform = `translateX(${baseTranslate}px)`;
          resetAuto();
          return;
        }
      }

      if (isHorizontal) {
        e.preventDefault();
        // Apply mild rubber-banding at the edges
        let applied = dx;
        const atStart = current === 0 && dx > 0;
        const atEnd   = current >= maxIndex() && dx < 0;
        if (atStart || atEnd) applied = dx * 0.35;
        currentDx = applied;
        track.style.transform = `translateX(${baseTranslate + applied}px)`;
        suppressClick = Math.abs(dx) > DRAG_THRESHOLD;
      }
    }

    function endDrag(e) {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      track.style.cursor = '';
      try { track.releasePointerCapture(pointerId); } catch (_) {}

      if (!isHorizontal) { resetAuto(); return; }

      const dt       = Math.max(1, performance.now() - dragStartTime);
      const velocity = currentDx / dt; // px per ms (signed)
      let target = current;

      if (currentDx <= -SWIPE_DISTANCE || velocity <= -SWIPE_VELOCITY) {
        target = current + 1;
      } else if (currentDx >= SWIPE_DISTANCE || velocity >= SWIPE_VELOCITY) {
        target = current - 1;
      }

      goTo(target);
      resetAuto();

      // Suppress the synthetic click that follows a drag on tweet-card links
      if (suppressClick) {
        const blockClick = ev => { ev.preventDefault(); ev.stopPropagation(); };
        track.addEventListener('click', blockClick, { capture: true, once: true });
        setTimeout(() => track.removeEventListener('click', blockClick, { capture: true }), 0);
        suppressClick = false;
      }
    }

    track.style.touchAction = 'pan-y';
    track.style.cursor = 'grab';
    track.addEventListener('pointerdown',   onPointerDown);
    track.addEventListener('pointermove',   onPointerMove);
    track.addEventListener('pointerup',     endDrag);
    track.addEventListener('pointercancel', endDrag);
    // Prevent native image/link drag from hijacking the gesture
    track.addEventListener('dragstart', e => e.preventDefault());

    // Recalc on resize
    window.addEventListener('resize', () => goTo(Math.min(current, maxIndex()), false), { passive: true });

    // Pause on hover
    const section = track.closest('.tweet-carousel-section');
    if (section) {
      section.addEventListener('mouseenter', () => clearInterval(autoTimer));
      section.addEventListener('mouseleave', () => resetAuto());
    }

    // Init
    goTo(0, false);
    resetAuto();
  })();

})();
