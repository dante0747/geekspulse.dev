/* ================================================================
   GeeksPulse — app.js
   // TODO: add dark mode  (already dark, genius)
   // TODO: add authentication  (it's a news reader, chill)
   // TODO: rewrite in Rust  (maybe next sprint)
   ================================================================ */

(() => {
  'use strict';

  // ── Feeds ────────────────────────────────────────────────────
  // Primary: direct CORS proxy that returns raw XML
  const CORS_PROXY   = 'https://corsproxy.io/?';
  // Fallback: rss2json (may rate-limit on free tier)
  const RSS2JSON     = 'https://api.rss2json.com/v1/api.json?rss_url=';

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
    { name: 'OpenSource.com',    url: 'https://opensource.com/feed',                                     category: 'Open Source' },
    // ── Java & Spring ─────────────────────────────────────────
    { name: 'Spring Blog',       url: 'https://spring.io/blog.atom',                                     category: 'Java'        },
    { name: 'Baeldung',          url: 'https://www.baeldung.com/feed/',                                  category: 'Java'        },
    { name: 'Inside Java',       url: 'https://inside.java/feed/rss',                                    category: 'Java'        },
    { name: 'InfoQ Java',        url: 'https://feed.infoq.com/java/',                                    category: 'Java'        },
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
  };

  const categories = [
    { id: 'All',         label: 'All news',    color: '#58c8ff', icon: CAT_SVG['All']         },
    { id: 'General',     label: 'General',     color: '#6e7681', icon: CAT_SVG['General']     },
    { id: 'Security',    label: 'Security',    color: '#ff5555', icon: CAT_SVG['Security']    },
    { id: 'AI',          label: 'AI / ML',     color: '#bc8cff', icon: CAT_SVG['AI']          },
    { id: 'Python',      label: 'Python',      color: '#3fb950', icon: CAT_SVG['Python']      },
    { id: 'JavaScript',  label: 'JavaScript',  color: '#e3c55e', icon: CAT_SVG['JavaScript']  },
    { id: 'Java',        label: 'Java',        color: '#f07f2f', icon: CAT_SVG['Java']        },
    { id: 'DevOps',      label: 'DevOps',      color: '#58c8ff', icon: CAT_SVG['DevOps']      },
    { id: 'Open Source', label: 'Open Source', color: '#56b4d3', icon: CAT_SVG['Open Source'] },
    { id: 'Bookmarks',   label: 'Bookmarks',   color: '#6e7681', icon: `<svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>` },
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
  let autoTimer     = null;   // setInterval handle
  let countdownSecs = 0;      // seconds until next auto-refresh
  let countdownTimer= null;   // setInterval handle for countdown

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

  function getText(el, tag) {
    const node = el.querySelector(tag);
    return node ? (node.textContent || '').trim() : '';
  }

  function randomMsg() {
    return loadingMessages[Math.floor(Math.random() * loadingMessages.length)];
  }

  // ── Image extraction from a feed item/entry element ──────────
  function extractImage(el, descHtml) {
    // 1. <media:content url="..."> or <media:thumbnail url="...">
    const mediaNS = 'http://search.yahoo.com/mrss/';
    for (const tag of ['content', 'thumbnail']) {
      const node = el.getElementsByTagNameNS(mediaNS, tag)[0];
      if (node) {
        const url = node.getAttribute('url');
        if (url && /\.(jpe?g|png|gif|webp|svg)/i.test(url)) return url;
        if (url) return url;
      }
    }

    // 2. <enclosure type="image/...">
    const enc = el.querySelector('enclosure');
    if (enc) {
      const t = enc.getAttribute('type') || '';
      const u = enc.getAttribute('url') || '';
      if (t.startsWith('image/') || /\.(jpe?g|png|gif|webp)/i.test(u)) return u;
    }

    // 3. First <img src="..."> inside description/content HTML
    if (descHtml) {
      const tmp = document.createElement('div');
      tmp.innerHTML = descHtml;
      const img = tmp.querySelector('img[src]');
      if (img) {
        const src = img.getAttribute('src') || '';
        // Skip tiny tracking pixels (width/height <= 2)
        const w = parseInt(img.getAttribute('width') || '999', 10);
        const h = parseInt(img.getAttribute('height') || '999', 10);
        if (src && w > 2 && h > 2) return src;
        if (src && !img.getAttribute('width')) return src;
      }
    }

    // 4. og:image or similar inside item content (rare but happens)
    const itunes = el.getElementsByTagNameNS('http://www.itunes.com/dtds/podcast-1.0.dtd', 'image')[0];
    if (itunes) {
      const href = itunes.getAttribute('href');
      if (href) return href;
    }

    return null;
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
      const desc  = getText(item, 'description') || getText(item, 'summary') || getText(item, 'content\\:encoded') || '';
      const date  = getText(item, 'pubDate') || getText(item, 'published') || getText(item, 'updated') || '';
      items.push({
        title:    getText(item, 'title') || 'Untitled',
        link,
        snippet:  truncate(stripHtml(desc)),
        image:    extractImage(item, desc),
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
        const desc   = getText(entry, 'summary') || getText(entry, 'content') || '';
        const date   = getText(entry, 'updated') || getText(entry, 'published') || '';
        items.push({
          title:    getText(entry, 'title') || 'Untitled',
          link,
          snippet:  truncate(stripHtml(desc)),
          image:    extractImage(entry, desc),
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
    const url  = CORS_PROXY + encodeURIComponent(feed.url);
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
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
      const descHtml = item.description || item.content || '';
      // rss2json exposes thumbnail directly
      let image = item.thumbnail || item.enclosure?.link || null;
      // try extracting from description HTML if no direct image
      if (!image && descHtml) {
        const tmp = document.createElement('div');
        tmp.innerHTML = descHtml;
        const img = tmp.querySelector('img[src]');
        if (img) {
          const src = img.getAttribute('src') || '';
          const w = parseInt(img.getAttribute('width') || '999', 10);
          const h = parseInt(img.getAttribute('height') || '999', 10);
          if (src && w > 2 && h > 2) image = src;
          else if (src && !img.getAttribute('width')) image = src;
        }
      }
      return {
        title:    item.title    || 'Untitled',
        link:     item.link     || item.url || '#',
        snippet:  truncate(stripHtml(descHtml)),
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

  // ── Fetch all feeds ───────────────────────────────────────────
  async function fetchAll() {
    if (isLoading) return;
    isLoading = true;
    failedFeeds = 0;
    setLoading();

    const results = await Promise.allSettled(feeds.map(fetchFeed));
    const articles = [];

    results.forEach((res, i) => {
      if (res.status === 'fulfilled') {
        // cap per feed so high-volume sources don't drown out smaller ones
        articles.push(...res.value.slice(0, MAX_PER_FEED));
      } else {
        failedFeeds++;
        console.warn(`[GeeksPulse] ${feeds[i].name} completely failed:`, res.reason?.message);
      }
    });

    // Sort newest-first; undated items go to the end
    articles.sort((a, b) => {
      const da = new Date(a.date), db = new Date(b.date);
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    allArticles = articles.slice(0, MAX_ARTICLES);
    isLoading = false;

    setLive();
    updateSidebarStats();
    buildFilters();   // rebuild with real counts
    render();

    if (failedFeeds > 0) {
      console.info(`[GeeksPulse] ${failedFeeds} feed(s) failed silently — no drama.`);
      if (allArticles.length > 0) {
        showError(`${failedFeeds} feed(s) failed to load. Showing stories from ${feeds.length - failedFeeds} feeds.`);
      }
    } else {
      hideError();
    }
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

    // stagger fade-in
    feedGrid.querySelectorAll('.card').forEach((el, i) => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(6px)';
      setTimeout(() => {
        el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        el.style.opacity = '1';
        el.style.transform = 'translateY(0)';
      }, Math.min(i * 20, 350));
    });

    if (statArticles) statArticles.textContent = allArticles.length;
  }

  function gridCard(a, i) {
    const date = relTime(a.date);
    const num  = String(i + 1).padStart(2, '0');
    const featured = i === 0;
    const bm = isBookmarked(a.link);
    return `
      <article class="card${featured ? ' card-featured' : ''} ${catClass(a.category)}">
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
          </div>
          <a class="card-link" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">
            Read →
          </a>
        </div>
      </article>`;
  }

  function listCard(a, i) {
    const date = relTime(a.date);
    const num  = String(i + 1).padStart(2, '0');
    const bm = isBookmarked(a.link);
    return `
      <article class="card card-row ${catClass(a.category)}">
        <span class="card-num">${num}</span>
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
          </div>
        </div>
        <a class="card-link" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">Read →</a>
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
    if (navStatus) navStatus.textContent = 'geeksup --fetch';
    articleCount.style.display = 'none';
    setRefreshBusy(true);
    showSkeletons(8);
    hideError();
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
    if (statFeedsEl) animateCounter(statFeedsEl, feeds.length - failedFeeds, 700);
    // Update dynamic support strip tab count
    const tabsSavedEl = document.getElementById('tabsSaved');
    if (tabsSavedEl) animateCounter(tabsSavedEl, allArticles.length, 1200);
  }

  function setRefreshBusy(busy) {
    [refreshBtn, refreshBtnHero].filter(Boolean).forEach(btn => { if (btn) btn.disabled = busy; });
    if (refreshIcon) refreshIcon.classList.toggle('spin', busy);
  }

  function updateSidebarStats() {
    const now = new Date();
    if (sbFeeds)   sbFeeds.textContent   = feeds.length - failedFeeds;
    if (sbUpdated) sbUpdated.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (sbFailed)  sbFailed.textContent  = failedFeeds;
    const sbBmCount = document.getElementById('sbBmCount');
    if (sbBmCount) sbBmCount.textContent = loadBookmarks().length;
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
      return `
        <button class="filter-item${c.id === activeFilter ? ' active' : ''}" data-cat="${esc(c.id)}">
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

  function setFilter(cat) {
    activeFilter = cat;
    PREF.set('filter', cat);
    [sidebarFilters, mobileFilters].forEach(container => {
      container.querySelectorAll('[data-cat]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cat === cat);
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
    settingsBtn.innerHTML = '<svg aria-hidden="true" viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.22 3.22l1.06 1.06M11.72 11.72l1.06 1.06M3.22 12.78l1.06-1.06M11.72 4.28l1.06-1.06"/></svg><span class="btn-label"> Settings</span>';
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
        <span class="settings-title"><svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-3px;margin-right:6px"><circle cx="8" cy="8" r="2.5"/><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.22 3.22l1.06 1.06M11.72 11.72l1.06 1.06M3.22 12.78l1.06-1.06M11.72 4.28l1.06-1.06"/></svg>Settings</span>
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
        <div class="pp-icon">𝑷</div>
        <h3 class="pp-title">Support GeekSup</h3>
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

  // ── Init ──────────────────────────────────────────────────────
  function init() {
    // Cyberpunk theme — no data-theme attribute needed
    document.documentElement.removeAttribute('data-theme');
    initNav();
    initSettings();
    initPayPalModal();
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
      if (btn) btn.addEventListener('click', fetchAll);
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

    // Bookmark button delegation
    feedGrid.addEventListener('click', e => {
      const btn = e.target.closest('.bm-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      const link = btn.dataset.bmLink;
      // find article from allArticles or bookmarks list
      let article = allArticles.find(a => a.link === link)
                 || loadBookmarks().find(a => a.link === link);
      if (!article) return;
      const added = toggleBookmark(article);
      // update button UI immediately without full re-render
      const svg = btn.querySelector('svg');
      if (svg) svg.setAttribute('fill', added ? 'currentColor' : 'none');
      btn.classList.toggle('bm-active', added);
      btn.title = added ? 'Remove bookmark' : 'Save to GeeksPulse bookmarks';
      btn.setAttribute('aria-label', added ? 'Remove bookmark' : 'Bookmark this article');
      // toast notification
      showBmToast(added
        ? '🔖 Saved to GeeksPulse bookmarks'
        : '🗑️ Removed from bookmarks');
      // refresh sidebar filter count
      buildFilters();
      // if currently viewing bookmarks, re-render
      if (activeFilter === 'Bookmarks') render();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

})();
