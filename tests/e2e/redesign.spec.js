/**
 * tests/e2e/redesign.spec.js
 * End-to-end coverage for the redesigned UI: layout, paging, deep links,
 * theming, keyboard use, panels/modals and the SEO-facing HTML.
 */

import { test, expect } from '@playwright/test';

// Keep the consent banner and the My Pulse nudge out of the way.
async function quiet(page) {
  await page.addInitScript(() => {
    localStorage.setItem('gp:analytics:consent', 'no');
    localStorage.setItem('gp:consent:seen', '1');
    localStorage.setItem('gp:pulse:seen', '1');
  });
}

async function ready(page, path = '/') {
  await quiet(page);
  await page.goto(path);
  await page.waitForSelector('#feedGrid article.card', { timeout: 15_000 });
}

const cards = page => page.locator('#feedGrid article.card');

// ── Layout ────────────────────────────────────────────────────────────────────

test.describe('layout', () => {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
    test(`the lead story starts above the fold on ${name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await ready(page);
      const box = await cards(page).first().boundingBox();
      expect(box.y).toBeLessThan(viewport.height * 0.75);
    });
  }

  test('the feed is paged and "Show more" appends the next page', async ({ page }) => {
    await ready(page);
    const initial = await cards(page).count();
    expect(initial).toBeLessThanOrEqual(60);
    test.skip(initial < 60, 'feed is smaller than one page');

    await expect(page.locator('#feedMoreStatus')).toContainText(`Showing ${initial} of`);
    await page.locator('#showMoreBtn').click();
    expect(await cards(page).count()).toBeGreaterThan(initial);
    // Keyboard users land on the first newly added story
    await expect(cards(page).nth(initial).locator('.card-title a')).toBeFocused();
  });

  test('the source directory in the footer lists every source', async ({ page }) => {
    await ready(page);
    const links = page.locator('#sources .source-group li a');
    expect(await links.count()).toBeGreaterThan(40);
    await page.locator('#sources').scrollIntoViewIfNeeded();
    await expect(page.locator('#sources-heading')).toBeVisible();
  });

  test('footer topic links filter the feed in place', async ({ page }) => {
    await ready(page);
    await page.locator('#sources a[data-filter="Security"]').click();
    await expect(page.locator('#sidebarFilters [data-cat="Security"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await cards(page).first().getAttribute('data-category')).toBe('Security');
  });
});

// ── Deep links ────────────────────────────────────────────────────────────────

test.describe('deep links', () => {
  test('?q= pre-fills and applies the search', async ({ page }) => {
    await ready(page, '/?q=rust');
    await expect(page.locator('#articleSearch')).toHaveValue('rust');
    const texts = await cards(page).evaluateAll(els => els.slice(0, 5).map(el => el.textContent.toLowerCase()));
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t).toContain('rust');
  });

  test('?topic= selects a topic (case-insensitive)', async ({ page }) => {
    await ready(page, '/?topic=security');
    await expect(page.locator('#sidebarFilters [data-cat="Security"]')).toHaveAttribute('aria-pressed', 'true');
    const cats = await cards(page).evaluateAll(els => els.slice(0, 5).map(el => el.dataset.category));
    expect(new Set(cats)).toEqual(new Set(['Security']));
  });

  test('?source= shows a single source and the filter can be cleared', async ({ page }) => {
    await ready(page, '/?source=Hacker+News');
    await expect(page.locator('#activeFilters')).toBeVisible();
    const sources = await cards(page).evaluateAll(els => els.map(el => el.querySelector('.card-source-name').textContent.trim()));
    expect(new Set(sources)).toEqual(new Set(['Hacker News']));

    await page.locator('#activeFilters [data-clear-source]').click();
    await expect(page.locator('#activeFilters')).toBeHidden();
    expect(page.url()).not.toContain('source=');
  });

  test('clicking a source name opens that source and updates the URL', async ({ page }) => {
    await ready(page);
    const btn = cards(page).nth(1).locator('.card-source-name');
    const name = (await btn.textContent()).trim();
    await btn.click();
    await expect(page).toHaveURL(/[?&]source=/);
    const sources = await cards(page).evaluateAll(els => els.map(el => el.querySelector('.card-source-name').textContent.trim()));
    expect(new Set(sources)).toEqual(new Set([name]));
  });
});

// ── Theme ─────────────────────────────────────────────────────────────────────

test.describe('theme', () => {
  test('Settings → Dark persists across reloads', async ({ page }) => {
    await ready(page);
    await page.locator('#settingsBtn').click();
    await page.locator('[data-theme-opt="dark"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.reload();
    await page.waitForSelector('#feedGrid article.card');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(bg).toBe('rgb(11, 12, 16)');
  });

  test.describe('with an OS dark preference', () => {
    test.use({ colorScheme: 'dark' });

    test('follows the OS theme by default', async ({ page }) => {
      await ready(page);
      await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
      const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
      expect(bg).toBe('rgb(11, 12, 16)');
    });
  });
});

// ── Keyboard ──────────────────────────────────────────────────────────────────

test.describe('keyboard', () => {
  test('j focuses the first story title and b saves it', async ({ page }) => {
    await ready(page);
    await page.locator('#latest-heading').click();
    await page.keyboard.press('j');
    await expect(cards(page).first().locator('.card-title a')).toBeFocused();
    await page.keyboard.press('b');
    await expect(cards(page).first().locator('.bm-btn')).toHaveClass(/bm-active/);
    await expect(page.locator('#sbBmCount')).toHaveText('1');
  });

  test('v toggles between grid and list view', async ({ page }) => {
    await ready(page);
    await page.locator('#latest-heading').click();
    await page.keyboard.press('v');
    await expect(page.locator('#feedGrid')).toHaveClass(/list-view/);
    await expect(page.locator('#listViewBtn')).toHaveAttribute('aria-pressed', 'true');
  });

  test('? opens the shortcuts dialog and Escape closes it', async ({ page }) => {
    await ready(page);
    await page.locator('#latest-heading').click();
    await page.keyboard.press('?');
    await expect(page.locator('#shortcutsDialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#shortcutsDialog')).toBeHidden();
  });
});

// ── Panels & modals ───────────────────────────────────────────────────────────

test.describe('panels', () => {
  test('My Pulse: hiding a topic shows the summary bar; Reset clears it', async ({ page }) => {
    await ready(page);
    await page.locator('#myPulseBtn').click();
    await expect(page.locator('#myPulseDrawer')).toBeVisible();
    await page.locator('[data-cat-chip="General"]').click();
    await page.locator('#myPulseDone').click();
    await expect(page.locator('#myPulseDrawer')).toBeHidden();
    await expect(page.locator('#myPulseBtn')).toBeFocused();

    const bar = page.locator('#pulseSummaryBar');
    await expect(bar).toBeVisible();
    await expect(bar).toContainText('1 topic hidden');
    const cats = await cards(page).evaluateAll(els => els.map(el => el.dataset.category));
    expect(cats).not.toContain('General');

    await page.locator('#pulseSummaryReset').click();
    await expect(bar).toBeHidden();
  });

  test('summary modal closes on Escape and returns focus to its trigger', async ({ page }) => {
    await ready(page);
    const trigger = cards(page).first().locator('.card-summary-btn');
    await trigger.click();
    await expect(page.locator('#summaryModal')).toHaveClass(/open/);
    await expect(page.locator('#summaryClose')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('#summaryModal')).not.toHaveClass(/open/);
    await expect(trigger).toBeFocused();
  });

  test('support modal only loads its QR code when opened', async ({ page }) => {
    await ready(page);
    const qr = page.locator('#ppModal .pp-qr');
    expect(await qr.getAttribute('src')).toBeNull();
    await page.locator('.nav-actions [data-support]').click();
    await expect(page.locator('#ppModal')).toHaveClass(/open/);
    expect(await qr.getAttribute('src')).toContain('qrserver');
    await page.keyboard.press('Escape');
    await expect(page.locator('#ppModal')).not.toHaveClass(/open/);
  });

  test('clearing saved stories can be undone', async ({ page }) => {
    await ready(page);
    await cards(page).first().locator('.bm-btn').click();
    await expect(page.locator('#sbBmCount')).toHaveText('1');
    await page.locator('#clearBookmarksBtn').click();
    await expect(page.locator('#sbBmCount')).toHaveText('0');
    await page.locator('#bmToast .bm-toast-action').click();
    await expect(page.locator('#sbBmCount')).toHaveText('1');
  });

  test('mobile menu opens, closes on Escape and returns focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await ready(page);
    await page.locator('#navHamburger').click();
    await expect(page.locator('#navDrawer')).toBeVisible();
    await expect(page.locator('#navHamburger')).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.locator('#navDrawer')).toBeHidden();
    await expect(page.locator('#navHamburger')).toBeFocused();
  });
});

// ── SEO & semantics ───────────────────────────────────────────────────────────

test.describe('SEO & semantics', () => {
  test('server HTML ships stories, sources and valid JSON-LD that matches the visible FAQ', async ({ request }) => {
    const html = await (await request.get('/')).text();
    expect((html.match(/class="card seo-card/g) || []).length).toBeGreaterThanOrEqual(10);
    expect(html).toContain('id="sources-heading"');

    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(m => JSON.parse(m[1]));
    const types = blocks.flatMap(b => (Array.isArray(b) ? b : [b])).map(b => b['@type']);
    expect(types).toEqual(expect.arrayContaining(['WebSite', 'ItemList', 'FAQPage']));

    const faq = blocks.find(b => b['@type'] === 'FAQPage');
    const visibleQuestions = [...html.matchAll(/<summary>([\s\S]*?)<\/summary>/g)].map(m => m[1].trim());
    expect(faq.mainEntity.map(q => q.name)).toEqual(visibleQuestions);
    for (const q of faq.mainEntity) expect(html).toContain(q.acceptedAnswer.text);
  });

  test('one h1, unique ids, alt text on images and a name on every button', async ({ page }) => {
    await ready(page);
    const report = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[id]')].map(el => el.id);
      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
      const unnamed = [...document.querySelectorAll('button')].filter(b => {
        const name = (b.getAttribute('aria-label') || b.textContent || b.getAttribute('title') || '').trim();
        return !name && !b.getAttribute('aria-labelledby');
      }).map(b => b.outerHTML.slice(0, 80));
      const noAlt = [...document.querySelectorAll('img')].filter(img => !img.hasAttribute('alt')).map(img => img.src);
      return { h1: document.querySelectorAll('h1').length, dupes, unnamed, noAlt };
    });
    expect(report.h1).toBe(1);
    expect(report.dupes).toEqual([]);
    expect(report.unnamed).toEqual([]);
    expect(report.noAlt).toEqual([]);
  });

  test('the manifest and service worker are served from the site root', async ({ request }) => {
    const manifest = await request.get('/manifest.json');
    expect(manifest.ok()).toBe(true);
    const m = await manifest.json();
    expect(m.icons.some(i => i.sizes === '512x512' && i.purpose === 'maskable')).toBe(true);
    for (const icon of m.icons) expect((await request.get(icon.src)).ok()).toBe(true);
    expect((await request.get('/sw.js')).ok()).toBe(true);
  });
});
