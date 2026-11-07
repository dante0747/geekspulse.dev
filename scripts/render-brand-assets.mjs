/**
 * scripts/render-brand-assets.mjs
 *
 * Builds every brand asset from two master images in assets/brand/:
 *
 *   assets/brand/logo.png        square logo, transparent background
 *   assets/brand/og-source.jpg   link-preview artwork (any landscape size)
 *
 * Outputs
 *   favicon.ico                      16 / 32 / 48 px (PNG-in-ICO)
 *   icons/favicon-32.png             browser tab
 *   icons/logo-96.png                in-page logo (nav, footer, legal pages)
 *   icons/icon-192.png, icon-512.png PWA icons, transparent corners ("any")
 *   icons/maskable-512.png           PWA maskable, full-bleed, mark in safe zone
 *   icons/apple-touch-icon.png       180×180, full-bleed
 *   og-image.jpg                     1200×630 Open Graph / Twitter / WhatsApp /
 *                                    Telegram preview, kept under 300 KB
 *
 * Resizing runs in headless Chromium (Playwright is already a dev dependency).
 * Run: node scripts/render-brand-assets.mjs [--logo file] [--og file]
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT  = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PANEL = '#0B0C0A';
const OG_MAX_BYTES = 300 * 1024;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return path.resolve(i > -1 ? process.argv[i + 1] : path.join(ROOT, fallback));
};
const LOGO = arg('--logo', 'assets/brand/logo.png');
const OG   = arg('--og', 'assets/brand/og-source.jpg');

async function dataUrl(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');

/**
 * Draw `src` into a w×h canvas and return the encoded bytes.
 * fit: 'contain' (letterbox inside `inset`) or 'cover' (crop to fill).
 * Downscales in halving steps for a sharper result than one big jump.
 */
async function render(src, { w, h, fit = 'contain', inset = 0, bg = null, type = 'image/png', quality }) {
  const b64 = await page.evaluate(async ({ src, w, h, fit, inset, bg, type, quality }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    let source = img, sw = img.naturalWidth, sh = img.naturalHeight;

    // Target box for the image
    let dw, dh, dx, dy, sx = 0, sy = 0, cw = sw, ch = sh;
    if (fit === 'cover') {
      const scale = Math.max(w / sw, h / sh);
      cw = w / scale; ch = h / scale;
      sx = (sw - cw) / 2; sy = (sh - ch) / 2;
      dw = w; dh = h; dx = 0; dy = 0;
    } else {
      const box = Math.round(Math.min(w, h) * (1 - inset * 2));
      const scale = Math.min(box / sw, box / sh);
      dw = Math.round(sw * scale); dh = Math.round(sh * scale);
      dx = Math.round((w - dw) / 2); dy = Math.round((h - dh) / 2);
    }

    // Step down by halves until within 2× of the target
    let curW = cw, curH = ch;
    let step = document.createElement('canvas');
    step.width = Math.round(cw); step.height = Math.round(ch);
    step.getContext('2d').drawImage(source, sx, sy, cw, ch, 0, 0, step.width, step.height);
    while (curW / 2 >= dw && curH / 2 >= dh) {
      const next = document.createElement('canvas');
      next.width = Math.round(curW / 2); next.height = Math.round(curH / 2);
      const nx = next.getContext('2d');
      nx.imageSmoothingQuality = 'high';
      nx.drawImage(step, 0, 0, next.width, next.height);
      step = next; curW = next.width; curH = next.height;
    }

    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(step, 0, 0, step.width, step.height, dx, dy, dw, dh);
    return out.toDataURL(type, quality).split(',')[1];
  }, { src, w, h, fit, inset, bg, type, quality });
  return Buffer.from(b64, 'base64');
}

/** Pack PNG images into a single .ico (Vista+ PNG-compressed entries). */
function packIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, png }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...entries.map(e => e.png)]);
}

const write = async (rel, buf) => {
  await fs.writeFile(path.join(ROOT, rel), buf);
  console.log(`[brand] ✓ ${rel} (${Math.round(buf.length / 1024)} KB)`);
};

const logo = await dataUrl(LOGO);

await write('icons/favicon-32.png',       await render(logo, { w: 32,  h: 32 }));
await write('icons/logo-96.png',          await render(logo, { w: 96,  h: 96 }));
await write('icons/icon-192.png',         await render(logo, { w: 192, h: 192 }));
await write('icons/icon-512.png',         await render(logo, { w: 512, h: 512 }));
await write('icons/maskable-512.png',     await render(logo, { w: 512, h: 512, inset: 0.1, bg: PANEL }));
await write('icons/apple-touch-icon.png', await render(logo, { w: 180, h: 180, inset: 0.03, bg: PANEL }));

const ico = [];
for (const size of [16, 32, 48]) ico.push({ size, png: await render(logo, { w: size, h: size }) });
await write('favicon.ico', packIco(ico));

try {
  const og = await dataUrl(OG);
  let quality = 0.9, jpg;
  do {
    jpg = await render(og, { w: 1200, h: 630, fit: 'cover', bg: PANEL, type: 'image/jpeg', quality });
    quality -= 0.05;
  } while (jpg.length > OG_MAX_BYTES && quality > 0.5);
  await write('og-image.jpg', jpg);
} catch (err) {
  console.warn(`[brand] og-image skipped: ${err.message}`);
}

await browser.close();
