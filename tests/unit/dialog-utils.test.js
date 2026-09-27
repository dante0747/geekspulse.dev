// @vitest-environment happy-dom
/**
 * tests/unit/dialog-utils.test.js
 * Focus trap and toast helpers in js/utils.js.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../js/config.js', () => ({ loadingMessages: ['Loading...'], catMeta: {} }));

import { trapTabKey, restoreFocus, showBmToast } from '../../js/utils.js';

function tabEvent(shiftKey = false) {
  return new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
}

describe('trapTabKey', () => {
  let box, first, middle, last;
  beforeEach(() => {
    document.body.innerHTML = '<div id="box"><button id="a">A</button><input id="m"><button id="b">B</button></div><button id="outside">x</button>';
    box = document.getElementById('box');
    first = document.getElementById('a');
    middle = document.getElementById('m');
    last = document.getElementById('b');
    // happy-dom has no layout; make the elements count as visible
    [first, middle, last].forEach(el => Object.defineProperty(el, 'offsetParent', { get: () => box }));
  });

  it('wraps Tab from the last element to the first', () => {
    last.focus();
    const e = tabEvent();
    trapTabKey(box, e);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    first.focus();
    trapTabKey(box, tabEvent(true));
    expect(document.activeElement).toBe(last);
  });

  it('leaves Tab alone in the middle of the container', () => {
    middle.focus();
    const e = tabEvent();
    trapTabKey(box, e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('ignores other keys', () => {
    last.focus();
    const e = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    trapTabKey(box, e);
    expect(e.defaultPrevented).toBe(false);
  });
});

describe('restoreFocus', () => {
  it('focuses an element that is still attached', () => {
    document.body.innerHTML = '<button id="t">t</button>';
    const t = document.getElementById('t');
    restoreFocus(t);
    expect(document.activeElement).toBe(t);
  });

  it('is a no-op for detached or missing elements', () => {
    expect(() => restoreFocus(document.createElement('button'))).not.toThrow();
    expect(() => restoreFocus(null)).not.toThrow();
  });
});

describe('showBmToast', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('creates a polite status region', () => {
    showBmToast('Saved');
    const toast = document.getElementById('bmToast');
    expect(toast.getAttribute('role')).toBe('status');
    expect(toast.textContent).toBe('Saved');
    expect(toast.classList.contains('visible')).toBe(true);
  });

  it('renders an action button that runs its callback', () => {
    const onClick = vi.fn();
    showBmToast('Cleared', { label: 'Undo', onClick });
    const btn = document.querySelector('#bmToast .bm-toast-action');
    expect(btn.textContent).toBe('Undo');
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(document.getElementById('bmToast').classList.contains('visible')).toBe(false);
  });

  it('drops a previous action button when reused without one', () => {
    showBmToast('Cleared', { label: 'Undo', onClick: () => {} });
    showBmToast('Saved');
    expect(document.querySelector('#bmToast .bm-toast-action')).toBeNull();
  });
});
