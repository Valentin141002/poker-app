/* Presentation and keyboard access for existing game windows. No game decisions. */
(() => {
  'use strict';
  const ids = ['modal-box', 'rules-modal', 'time-rules-modal', 'add30-rules-modal',
    'add30-confirm-modal', 'hide-rules-modal', 'show-rules-modal', 'sos-modal',
    'sos-chat-modal', 'odds-modal', 'stats-modal'];
  const stack = [];
  const openers = new WeakMap();
  const outsideFocus = new WeakMap();
  const closeSelector = '.popup-close, .rules-close, .odds-close, .stats-close';
  const focusable = surface => [...surface.querySelectorAll('button, [href], input, select, textarea, [tabindex]')]
    .filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  function sync(root) {
    const surface = root.querySelector('.raise-window, [role="dialog"]');
    if (surface && !surface.classList.contains('imdcx-popup-surface')) {
      surface.classList.add('imdcx-popup-surface');
      surface.setAttribute('role', 'dialog');
      surface.setAttribute('aria-modal', 'true');
      surface.tabIndex = -1;
    }
    const open = !!surface && getComputedStyle(root).display !== 'none'
      && getComputedStyle(root).visibility !== 'hidden';
    const index = stack.indexOf(root);
    if (open && index < 0) {
      openers.set(root, root.contains(document.activeElement) ? outsideFocus.get(root) : document.activeElement);
      stack.push(root);
      (surface.querySelector(closeSelector) || focusable(surface)[0] || surface).focus({ preventScroll: true });
    } else if (!open && index >= 0) {
      const wasTop = index === stack.length - 1;
      stack.splice(index, 1);
      const opener = openers.get(root);
      if (wasTop && opener?.isConnected) opener.focus({ preventScroll: true });
    }
    stack.forEach((entry, i) => {
      const order = String(i);
      if (entry.style.getPropertyValue('--popup-order') !== order) entry.style.setProperty('--popup-order', order);
    });
    document.body.classList.toggle('imdcx-popup-open', stack.length > 0);
  }
  function init() {
    const roots = ids.map(id => document.getElementById(id)).filter(Boolean);
    document.addEventListener('focusin', event => {
      roots.forEach(root => { if (!root.contains(event.target)) outsideFocus.set(root, event.target); });
    });
    ids.forEach(id => {
      const root = document.getElementById(id);
      if (!root) return;
      root.classList.add('imdcx-popup');
      sync(root);
      new MutationObserver(() => sync(root)).observe(root, {
        attributes: true, attributeFilter: ['class', 'style', 'aria-hidden'], childList: true
      });
    });
    document.addEventListener('keydown', event => {
      const root = stack.at(-1);
      const surface = root?.querySelector('.imdcx-popup-surface');
      if (!surface) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        surface.querySelector(closeSelector)?.click();
      } else if (event.key === 'Tab') {
        const items = focusable(surface);
        const first = items[0], last = items.at(-1);
        if (!first) { event.preventDefault(); surface.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !surface.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !surface.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    }, true);
  }
  function layoutCalculator(win, overlay) {
    overlay.classList.add('imdcx-popup');
    win.classList.add('imdcx-popup-surface');
    win.setAttribute('role', 'dialog');
    win.setAttribute('aria-modal', 'true');
    win.tabIndex = -1;
    win.setAttribute('aria-labelledby', 'raise-popup-title');
    const controller = new AbortController();
    const options = { signal: controller.signal };
    const fit = () => {
      // Natural-size text and controls. Only the content scrolls on short screens.
      ['position', 'left', 'top', 'right', 'bottom', 'width', 'height', 'maxWidth', 'maxHeight', 'margin', 'transform', 'transformOrigin']
        .forEach(property => { win.style[property] = ''; });
      win.style.animation = 'none';
      overlay.style.visibility = '';
    };
    fit();
    window.addEventListener('resize', fit, options);
    window.visualViewport?.addEventListener('resize', fit, options);
    // Use the existing movement function, also used by the four arrow buttons.
    const head = win.querySelector('.raise-head');
    let pointer = null;
    head.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button,input,.calc-move')) return;
      if (matchMedia('(pointer: coarse)').matches) return;
      event.preventDefault();
      pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      head.setPointerCapture(event.pointerId);
    }, options);
    head.addEventListener('pointermove', event => {
      if (pointer?.id !== event.pointerId) return;
      nudgeCalcWindow(win, event.clientX - pointer.x, event.clientY - pointer.y);
      pointer.x = event.clientX; pointer.y = event.clientY;
    }, options);
    const stop = () => { pointer = null; };
    head.addEventListener('pointerup', stop, options);
    head.addEventListener('pointercancel', stop, options);
    return () => controller.abort();
  }
  window.IMDCXPopups = Object.freeze({ layoutCalculator });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
