import { defineConfig } from 'vite';

export default defineConfig({
  // Serve from project root; index.html at root is the entry point
  root: '.',

  // 'public/' is already used for feed.json / feed-health.json / version.json –
  // Vite treats this directory as static assets served verbatim.
  publicDir: 'public',

  build: {
    // Output bundled app to dist/ for production deploy.
    // When deploying to GitHub Pages, point the deploy action at dist/.
    outDir: 'dist',
    emptyOutDir: true,

    rollupOptions: {
      // Vite auto-discovers <script type="module"> in index.html, no manual
      // entry configuration needed. Explicitly list output chunking strategy.
      output: {
        // Chunk vendor-like code (none here, but future-proof)
        manualChunks: undefined,
      },
    },

    // Inline assets ≤ 4 KB as base64 (default: 4096 bytes)
    assetsInlineLimit: 4096,

    // Generate source maps for production debugging
    sourcemap: false,
  },

  server: {
    // Local dev server – serves the static JSON files from public/
    port: 5173,
    open: true,
  },

  preview: {
    port: 4173,
  },
});

