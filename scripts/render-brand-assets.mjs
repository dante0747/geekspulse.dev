/**
 * scripts/render-brand-assets.mjs
 *
 * Renders the PNG brand assets from favicon.svg with headless Chromium
 * (Playwright, already a dev dependency):
 *
 *   icons/icon-192.png, icons/icon-512.png   transparent corners ("any")
 *   icons/maskable-512.png                   full-bleed, mark inside the safe zone
 *   icons/apple-touch-icon.png               full-bleed 180×180
 *   og-image.png                             1200×630 social preview card
 *
 * Run after changing the logo:  node scripts/render-brand-assets.mjs
 * Pass --logo path/to/logo.png to render the icons from a raster logo instead.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PANEL = '#0B0C0A';

const logoArg = process.argv.indexOf('--logo');
const logoPath = logoArg > -1 ? path.resolve(process.argv[logoArg + 1]) : path.join(ROOT, 'favicon.svg');
const logoExt = path.extname(logoPath).slice(1).toLowerCase();
const logoMime = logoExt === 'svg' ? 'image/svg+xml' : `image/${logoExt === 'jpg' ? 'jpeg' : logoExt}`;
const logoUrl = `data:${logoMime};base64,${(await fs.readFile(logoPath)).toString('base64')}`;

function iconHtml(size, { bleed, pad }) {
  const inner = Math.round(size * (1 - pad * 2));
  return `<!doctype html><html><body style="margin:0">
    <div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:${bleed ? PANEL : 'transparent'}">
      <img src="${logoUrl}" width="${inner}" height="${inner}" style="display:block">
    </div></body></html>`;
}

const OG_HTML = `<!doctype html><html><head>
<link href="https://fonts.googleapis.com/css2?family=Doto:wght@800..900&family=Martian+Mono:wdth,wght@75..112.5,400..700&family=Mona+Sans:wdth,wght@75..125,500..900&display=block" rel="stylesheet">
<style>
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; overflow: hidden; background: ${PANEL}; color: #EDEADC; font-family: 'Mona Sans', sans-serif; }
  .board { position: absolute; inset: 0; background-image: radial-gradient(circle, rgba(255,178,36,.13) 1.2px, transparent 1.8px); background-size: 16px 16px;
           -webkit-mask-image: linear-gradient(115deg, transparent 30%, #000 95%); }
  .glow  { position: absolute; inset: 0; background: radial-gradient(70% 90% at 100% 0%, rgba(255,178,36,.16), transparent 60%); }
  .wrap  { position: absolute; inset: 64px 72px 56px; display: flex; flex-direction: column; }
  .top   { display: flex; align-items: center; gap: 18px; }
  .top img { width: 72px; height: 72px; }
  .name  { font: 700 34px/1 'Martian Mono', monospace; font-stretch: 87.5%; letter-spacing: -.03em; }
  .name b { color: #FFB224; font-weight: 700; }
  .air   { margin-left: auto; display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: #FFB224; color: #140F05;
           font: 700 15px/1 'Martian Mono', monospace; letter-spacing: .16em; text-transform: uppercase; }
  .air i { width: 10px; height: 10px; border-radius: 50%; background: #D7261E; box-shadow: 0 0 10px #FF3B30; }
  h1     { margin-top: 54px; font-size: 84px; font-weight: 800; font-stretch: 80%; line-height: .96; letter-spacing: -.03em; max-width: 14ch; }
  h1 span { color: #8D8B7B; }
  h1::after { content: ''; display: inline-block; width: .42em; height: .78em; margin-left: .1em; vertical-align: -.04em; background: #FFB224; box-shadow: 0 0 22px rgba(255,178,36,.6); }
  .foot  { margin-top: auto; display: flex; align-items: flex-end; justify-content: space-between; gap: 40px; }
  .meta  { font: 500 19px/1.6 'Martian Mono', monospace; font-stretch: 87.5%; color: #B8B5A4; }
  .meta em { font-style: normal; color: #6EF08F; }
  .bars  { display: flex; align-items: flex-end; gap: 5px; height: 110px; }
  .bars i { width: 11px; background: linear-gradient(to top, rgba(255,178,36,.35), #FFB224); border-radius: 1px 1px 0 0; }
  .bars i:last-child { background: #6EF08F; box-shadow: 0 0 12px rgba(110,240,143,.6); }
</style></head><body>
  <div class="board"></div><div class="glow"></div>
  <div class="wrap">
    <div class="top"><img src="${logoUrl}" alt=""><div class="name">geeks<b>pulse</b>.dev</div><div class="air"><i></i>on air</div></div>
    <h1>Today's developer news, <span>minus the noise.</span></h1>
    <div class="foot">
      <p class="meta"><em>❯</em> 50+ hand-picked feeds · AI · security · DevOps<br>Rust · Go · Python · JS · Java · open source<br><em>❯</em> no ads · no paywalls · no algorithm</p>
      <div class="bars">${[18, 24, 14, 30, 22, 40, 34, 52, 46, 61, 55, 72, 66, 88, 70, 95, 80, 60, 74, 48, 36, 28, 20, 34]
        .map(h => `<i style="height:${h}%"></i>`).join('')}</div>
    </div>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();

const icons = [
  ['icons/icon-192.png',         192, { bleed: false, pad: 0 }],
  ['icons/icon-512.png',         512, { bleed: false, pad: 0 }],
  ['icons/maskable-512.png',     512, { bleed: true,  pad: 0.1 }],
  ['icons/apple-touch-icon.png', 180, { bleed: true,  pad: 0.04 }],
];
for (const [out, size, opts] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(iconHtml(size, opts));
  await page.screenshot({ path: path.join(ROOT, out), omitBackground: !opts.bleed });
  console.log(`[brand] ✓ ${out}`);
}

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(OG_HTML, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.join(ROOT, 'og-image.png') });
console.log('[brand] ✓ og-image.png');

await browser.close();
