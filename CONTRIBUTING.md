# Contributing to GeeksPulse

Thanks for your interest in contributing! GeeksPulse is a small indie project and every contribution — big or small — is appreciated.

## Ways to contribute

| Type | How |
|---|---|
| 🐛 Bug report | [Open an issue](https://github.com/dante0747/geekspulse.dev/issues/new?template=bug_report.md) |
| 📡 Suggest a feed | [Open a feed request](https://github.com/dante0747/geekspulse.dev/issues/new?template=feed_request.md) |
| ✨ Feature idea | [Open a feature request](https://github.com/dante0747/geekspulse.dev/issues/new?template=feature_request.md) |
| 💻 Code change | Fork → branch → PR (see below) |

## Development setup

```bash
git clone https://github.com/dante0747/geekspulse.dev.git
cd geekspulse.dev
npm install

# Start the Vite dev server
npm run dev

# Or regenerate the feed cache first, then serve
npm run build:feed
npx serve .
```

Open [http://localhost:5173](http://localhost:5173) (Vite) or [http://localhost:3000](http://localhost:3000) (npx serve).

## Submitting a pull request

1. Fork the repo and create a branch: `git checkout -b feat/your-idea`
2. Make your changes.
3. Test locally with `npx serve .` — verify feeds load, filters work, bookmarks work.
4. If you changed feeds, run `npm run build:feed` and commit the updated `public/` files.
5. Open a PR with a clear description of what you changed and why.

## Adding a new RSS feed

1. Open `data/feeds.json`.
2. Add an entry:
   ```json
   {
     "id": "my-blog",
     "name": "My Blog",
     "url": "https://myblog.com/feed.xml",
     "category": "General",
     "enabled": true
   }
   ```
3. Run `npm run build:feed` to test it.
4. Commit `data/feeds.json` + updated `public/feed.json` + `public/feed-health.json`.

## Code style

- Vanilla JS ES modules — no frontend frameworks.
- Vite is used as the dev server and production bundler (`npm run dev` / `npm run build`).
- The frontend is split into **14 focused modules** under `js/`. Add new logic to the
  most relevant module, or create a new one and import it from `js/main.js`.
- `js/main.js` is the entry point: it owns app state, the `render()` loop, and all event wiring.
- Prefer descriptive variable names over clever one-liners.
- Keep accessibility in mind: ARIA labels, keyboard navigation.

## Questions?

Open an issue or start a discussion on GitHub.

