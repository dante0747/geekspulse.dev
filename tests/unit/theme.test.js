// @vitest-environment happy-dom
/**
 * tests/unit/theme.test.js
 * Theme preference persistence (js/theme.js).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getThemePref, setThemePref, applyTheme, initTheme } from '../../js/theme.js';

describe('theme preference', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    document.head.innerHTML = `
      <meta name="theme-color" media="(prefers-color-scheme: light)" content="#F6F6F4">
      <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0B0C10">`;
  });

  it('defaults to following the system', () => {
    expect(getThemePref()).toBe('system');
  });

  it('ignores unknown stored values', () => {
    localStorage.setItem('geeksup_theme', 'sepia');
    expect(getThemePref()).toBe('system');
  });

  it('persists an explicit choice under the key the inline head script reads', () => {
    setThemePref('dark');
    expect(localStorage.getItem('geeksup_theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('"system" clears the stored choice and the data-theme attribute', () => {
    setThemePref('light');
    setThemePref('system');
    expect(localStorage.getItem('geeksup_theme')).toBeNull();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it('forces both theme-color metas to the chosen theme and restores them for system', () => {
    applyTheme('dark');
    const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
    expect(metas.map(m => m.content)).toEqual(['#0B0C10', '#0B0C10']);
    applyTheme('system');
    expect(metas.map(m => m.content)).toEqual(['#F6F6F4', '#0B0C10']);
  });

  it('initTheme applies the stored preference', () => {
    localStorage.setItem('geeksup_theme', 'light');
    initTheme();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
