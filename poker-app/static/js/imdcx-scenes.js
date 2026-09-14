/* Dedicated application views. The previous screen is parked, never a backdrop. */
(() => {
  'use strict';
  let host = null;
  let active = null;
  let returnFocus = null;
  let returnScroll = null;
  let observer = null;
  const parked = new Map();
  const jobs = new Set();
  const ignored = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'TEMPLATE']);

  function park(element) {
    if (!(element instanceof HTMLElement) || element === host || ignored.has(element.tagName) || parked.has(element)) return;
    parked.set(element, {
      hidden: element.getAttribute('hidden'),
      inert: element.getAttribute('inert'),
      ariaHidden: element.getAttribute('aria-hidden'),
      display: element.style.getPropertyValue('display'),
      displayPriority: element.style.getPropertyPriority('display'),
      scrollTop: element.scrollTop,
      scrollLeft: element.scrollLeft
    });
    element.hidden = true;
    element.inert = true;
    element.setAttribute('aria-hidden', 'true');
    element.style.setProperty('display', 'none', 'important');
  }

  function restoreAttribute(element, name, value) {
    if (value === null) element.removeAttribute(name);
    else element.setAttribute(name, value);
  }

  function clearJobs() {
    jobs.forEach(job => clearTimeout(job));
    jobs.clear();
  }

  function retire(reason) {
    clearJobs();
    if (!active) return;
    const previous = active;
    active = null;
    previous.element.dispatchEvent(new CustomEvent('imdcx:scene-leave', { detail: { reason } }));
    previous.element.remove();
    previous.onLeave?.(reason);
  }

  function leave(element, reason = 'back') {
    if (!active || (element && element !== active.element)) return false;
    observer?.disconnect();
    observer = null;
    retire(reason);
    host?.remove();
    host = null;
    document.body.classList.remove('imdcx-scene-mode');
    document.documentElement.classList.remove('imdcx-scene-mode');
    document.body.removeAttribute('data-imdcx-screen');
    parked.forEach((state, node) => {
      if (!node.isConnected) return;
      restoreAttribute(node, 'hidden', state.hidden);
      restoreAttribute(node, 'inert', state.inert);
      restoreAttribute(node, 'aria-hidden', state.ariaHidden);
      if (state.display) node.style.setProperty('display', state.display, state.displayPriority);
      else node.style.removeProperty('display');
      node.scrollTop = state.scrollTop;
      node.scrollLeft = state.scrollLeft;
    });
    parked.clear();
    const focusTarget = returnFocus;
    const scrollTarget = returnScroll;
    returnFocus = null;
    returnScroll = null;
    if (focusTarget?.isConnected && !focusTarget.closest('[hidden], [inert]')) focusTarget.focus({ preventScroll: true });
    if (scrollTarget) window.scrollTo(scrollTarget.x, scrollTarget.y);
    document.dispatchEvent(new CustomEvent('imdcx:scene-changed', { detail: { screen: null } }));
    return true;
  }

  function enter(name, element, options = {}) {
    if (active?.element === element) return element;
    if (!host) {
      // The pre-existing portal video reveal runs on its own timers, independent of this
      // scene stack, and fades #poker-game-wrapper in via a body class over several seconds.
      // Parking it mid-flight would freeze that body class until its timers catch up, leaving
      // the table transparent (black) once this scene later hands the page back. Force it to
      // its finished state first so the table is already revealed underneath by the time we return.
      window.__imdcxFinishPortalIntro?.();
      returnFocus = document.activeElement;
      returnScroll = { x: window.scrollX, y: window.scrollY };
      host = document.createElement('main');
      host.id = 'imdcx-screen-root';
      Array.from(document.body.children).forEach(park);
      document.body.appendChild(host);
      document.body.classList.add('imdcx-scene-mode');
      document.documentElement.classList.add('imdcx-scene-mode');
      observer = new MutationObserver(records => {
        if (!host?.isConnected || (active && !active.element.isConnected)) {
          leave(null, 'removed');
          return;
        }
        records.forEach(record => {
          if (record.target === document.body) record.addedNodes.forEach(park);
        });
      });
      observer.observe(document.body, { childList: true });
      observer.observe(host, { childList: true });
    }
    retire('replaced');
    active = { element, onLeave: options.onLeave };
    element.dataset.screen = name;
    element.classList.add('imdcx-scene');
    element.tabIndex = -1;
    host.dataset.activeScreen = name;
    document.body.dataset.imdcxScreen = name;
    host.appendChild(element);
    window.scrollTo(0, 0);
    element.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('imdcx:scene-changed', { detail: { screen: name } }));
    return element;
  }

  function schedule(element, callback, delay) {
    const job = setTimeout(() => {
      jobs.delete(job);
      if (active?.element === element && element.isConnected) callback();
    }, delay);
    jobs.add(job);
    return job;
  }

  window.IMDCXScenes = Object.freeze({ enter, leave, schedule, isActive: element => active?.element === element });
})();
