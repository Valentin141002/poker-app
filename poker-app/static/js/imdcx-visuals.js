/* Optional presentation layer. No socket, storage, scoring, or navigation changes. */
(() => {
  'use strict';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const spins = new WeakMap();

  function parallax(root, selector) {
    let target = null;
    let frame = 0;
    let x = 0;
    let y = 0;
    function reset() {
      cancelAnimationFrame(frame);
      frame = 0;
      if (target) {
        target.style.removeProperty('--tilt-x');
        target.style.removeProperty('--tilt-y');
      }
      target = null;
    }
    root.addEventListener('pointermove', event => {
      if (reducedMotion.matches || !finePointer.matches) return reset();
      const next = event.target.closest(selector);
      if (target !== next) { reset(); target = next; }
      if (!target) return;
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        if (!target?.isConnected) return reset();
        const rect = target.getBoundingClientRect();
        target.style.setProperty('--tilt-x', `${(-(y - rect.top) / rect.height + 0.5) * 3}deg`);
        target.style.setProperty('--tilt-y', `${((x - rect.left) / rect.width - 0.5) * 3}deg`);
      });
    }, { passive: true });
    root.addEventListener('pointerleave', reset, { passive: true });
  }

  // Home motion has its own lifecycle so the existing battle and wheel stay isolated.
  // It renders only while pointer values change or ease back to their resting state.
  function homeMotion(root) {
    const surfaces = '.stat-tile, .quickplay-btn:not(:disabled), .home-nav-card:not(:disabled)';
    const room = root.querySelector('.home-scene-room');
    const props = root.querySelector('.home-scene-props');
    const controller = new AbortController();
    const flashes = new Map();
    let frame = 0;
    let lastTime = 0;
    let pointerInside = false;
    let pointerX = 0;
    let pointerY = 0;
    let rootRect = null;
    let surfaceRect = null;
    let activeSurface = null;
    let requestedSurface = null;
    let pressedButton = null;
    let sceneX = 0;
    let sceneY = 0;
    let tiltX = 0;
    let tiltY = 0;
    let glareX = 0;
    let glareY = 0;
    let connectedOnce = root.isConnected;

    const listen = (target, type, callback, options = {}) => target.addEventListener(type, callback, { ...options, signal: controller.signal });
    const clamp = value => Math.max(-1, Math.min(1, value));
    const canInteract = () => root.isConnected && !root.inert && !root.hidden && root.style.display !== 'none' && !document.hidden;
    const canMove = () => canInteract() && !reducedMotion.matches && finePointer.matches;

    function releaseSurface() {
      if (activeSurface) {
        activeSurface.classList.remove('is-home-active');
        activeSurface.style.removeProperty('--tilt-x');
        activeSurface.style.removeProperty('--tilt-y');
        const light = activeSurface.querySelector('.home-surface-light');
        light?.style.removeProperty('--glare-x');
        light?.style.removeProperty('--glare-y');
      }
      activeSurface = null;
      surfaceRect = null;
      tiltX = tiltY = glareX = glareY = 0;
    }

    function releasePress() {
      pressedButton?.classList.remove('is-home-pressed');
      pressedButton = null;
    }

    function reset() {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      pointerInside = false;
      requestedSurface = null;
      releaseSurface();
      releasePress();
      sceneX = sceneY = 0;
      for (const layer of [room, props]) {
        layer.style.removeProperty('--scene-x');
        layer.style.removeProperty('--scene-y');
      }
      for (const [button, timeout] of flashes) {
        clearTimeout(timeout);
        button.classList.remove('is-home-clicked');
      }
      flashes.clear();
    }

    function updateAvailability() {
      const paused = !canMove();
      root.classList.toggle('is-home-paused', paused);
      rootRect = null;
      surfaceRect = null;
      if (paused) reset();
    }

    function schedule() {
      if (!frame && canMove()) frame = requestAnimationFrame(paint);
    }

    function paint(time) {
      frame = 0;
      // A frame can observe a changed media query before its change event arrives.
      // Keep the paused CSS state and the cleared motion values in sync in both paths.
      if (!canMove()) return updateAvailability();
      const elapsed = lastTime ? Math.min(40, time - lastTime) : 16;
      const easing = 1 - Math.exp(-elapsed / 65);
      lastTime = time;
      rootRect ||= root.getBoundingClientRect();

      if (activeSurface !== requestedSurface) {
        releaseSurface();
        activeSurface = requestedSurface;
        if (activeSurface) {
          activeSurface.classList.add('is-home-active');
          surfaceRect = activeSurface.getBoundingClientRect();
        }
      }

      const targetSceneX = pointerInside ? clamp((pointerX - rootRect.left) / Math.max(1, rootRect.width) * 2 - 1) : 0;
      const targetSceneY = pointerInside ? clamp((pointerY - rootRect.top) / Math.max(1, rootRect.height) * 2 - 1) : 0;
      sceneX += (targetSceneX - sceneX) * easing;
      sceneY += (targetSceneY - sceneY) * easing;
      room.style.setProperty('--scene-x', `${(-sceneX * 7).toFixed(3)}px`);
      room.style.setProperty('--scene-y', `${(-sceneY * 5).toFixed(3)}px`);
      props.style.setProperty('--scene-x', `${(-sceneX * 14).toFixed(3)}px`);
      props.style.setProperty('--scene-y', `${(-sceneY * 10).toFixed(3)}px`);

      let settling = Math.abs(targetSceneX - sceneX) + Math.abs(targetSceneY - sceneY) > .002;
      if (activeSurface) {
        surfaceRect ||= activeSurface.getBoundingClientRect();
        const localX = Math.max(0, Math.min(surfaceRect.width, pointerX - surfaceRect.left));
        const localY = Math.max(0, Math.min(surfaceRect.height, pointerY - surfaceRect.top));
        const targetTiltX = -clamp(localY / Math.max(1, surfaceRect.height) * 2 - 1) * 3;
        const targetTiltY = clamp(localX / Math.max(1, surfaceRect.width) * 2 - 1) * 3;
        tiltX += (targetTiltX - tiltX) * easing;
        tiltY += (targetTiltY - tiltY) * easing;
        glareX += (localX - glareX) * easing;
        glareY += (localY - glareY) * easing;
        activeSurface.style.setProperty('--tilt-x', `${tiltX.toFixed(3)}deg`);
        activeSurface.style.setProperty('--tilt-y', `${tiltY.toFixed(3)}deg`);
        const light = activeSurface.querySelector('.home-surface-light');
        light?.style.setProperty('--glare-x', `${glareX.toFixed(2)}px`);
        light?.style.setProperty('--glare-y', `${glareY.toFixed(2)}px`);
        settling ||= Math.abs(targetTiltX - tiltX) + Math.abs(targetTiltY - tiltY) > .015 || Math.abs(localX - glareX) + Math.abs(localY - glareY) > .2;
      }
      if (settling) schedule();
      else {
        lastTime = 0;
        if (!pointerInside) {
          sceneX = sceneY = 0;
          for (const layer of [room, props]) {
            layer.style.removeProperty('--scene-x');
            layer.style.removeProperty('--scene-y');
          }
        }
      }
    }

    listen(root, 'pointermove', event => {
      if (!canMove() || event.pointerType === 'touch') return;
      pointerInside = true;
      pointerX = event.clientX;
      pointerY = event.clientY;
      requestedSurface = event.target.closest(surfaces);
      schedule();
    }, { passive: true });

    listen(root, 'pointerleave', () => {
      pointerInside = false;
      requestedSurface = null;
      releaseSurface();
      releasePress();
      schedule();
    }, { passive: true });

    listen(root, 'pointerdown', event => {
      if (!canInteract() || event.button !== 0) return;
      const button = event.target.closest('button:not(:disabled)');
      if (!button) return;
      releasePress();
      pressedButton = button;
      button.classList.add('is-home-pressed');
    }, { passive: true });
    listen(window, 'pointerup', releasePress, { passive: true });
    listen(window, 'pointercancel', releasePress, { passive: true });
    listen(window, 'blur', reset);

    // Capture the enabled state before existing actions disable a submitting button.
    // A click also covers keyboard activation; no default action is intercepted.
    listen(root, 'click', event => {
      if (!canInteract() || reducedMotion.matches) return;
      const button = event.target.closest('button:not(:disabled)');
      if (!button) return;
      clearTimeout(flashes.get(button));
      button.classList.add('is-home-clicked');
      flashes.set(button, setTimeout(() => {
        button.classList.remove('is-home-clicked');
        flashes.delete(button);
      }, 360));
    }, { capture: true });

    listen(window, 'resize', () => { rootRect = surfaceRect = null; }, { passive: true });
    listen(root, 'scroll', () => { rootRect = surfaceRect = null; }, { passive: true });
    listen(document, 'visibilitychange', updateAvailability);
    listen(reducedMotion, 'change', updateAvailability);
    listen(finePointer, 'change', updateAvailability);

    const availabilityObserver = new MutationObserver(updateAvailability);
    availabilityObserver.observe(root, { attributes: true, attributeFilter: ['inert', 'hidden', 'style'] });
    const lifecycleObserver = new MutationObserver(() => {
      if (root.isConnected) {
        if (!connectedOnce) { connectedOnce = true; updateAvailability(); }
        return;
      }
      if (!connectedOnce) return;
      reset();
      controller.abort();
      availabilityObserver.disconnect();
      lifecycleObserver.disconnect();
    });
    lifecycleObserver.observe(document.body, { childList: true });
    updateAvailability();
  }

  function home(root) {
    if (root.classList.contains('imdcx-home-luxury')) return;
    root.classList.add('imdcx-home', 'imdcx-home-luxury');
    root.insertAdjacentHTML('afterbegin', `<div class="home-scene" aria-hidden="true" inert>
      <div class="home-scene-room"></div><div class="home-scene-haze"></div>
      <div class="home-scene-props">
        ${['left', 'right'].map(side => `<div class="home-ornament home-ornament-card card-${side}">
          <span class="home-ornament-corner">A<br>♠</span><span class="home-ornament-suit">♠</span><span class="home-ornament-corner corner-bottom">A<br>♠</span>
        </div><div class="home-ornament home-ornament-chip chip-${side}"><span class="home-chip-rim"></span><span class="home-chip-face">♠</span></div>`).join('')}
      </div>
    </div>`);
    const brand = root.querySelector('.home-brand');
    if (brand) {
      const wordmark = brand.querySelector(':scope > span:last-child');
      if (wordmark) {
        wordmark.className = 'home-brand-wordmark';
        wordmark.innerHTML = '<strong>IMDCX</strong><small>POKER</small>';
      }
      brand.insertAdjacentHTML('beforeend', '<span class="home-brand-caption">Plus qu’un jeu<br>Une communauté</span>');
    }
    root.querySelector('.quickplay-name').setAttribute('aria-label', 'Votre pseudo');
    root.querySelector('.quickplay-status').setAttribute('role', 'status');
    root.querySelectorAll('button[title]').forEach(button => button.setAttribute('aria-label', button.title));
    root.querySelectorAll('.stat-tile').forEach((tile, index) => {
      tile.insertAdjacentHTML('beforeend', `<svg class="home-stat-wave" viewBox="0 0 260 90" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="home-wave-${index}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="currentColor" stop-opacity=".26"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
        <path d="M-10 26 C55 -2 94 114 170 62 S235 21 270 35 V90 H-10Z" fill="url(#home-wave-${index})"/>
        <path d="M-10 26 C55 -2 94 114 170 62 S235 21 270 35 M-10 73 C75 13 123 108 190 47 S252 15 270 20" fill="none" stroke="currentColor" stroke-width="1"/>
        <path d="M-10 60 C80 38 95 96 180 72 S245 41 270 51" fill="none" stroke="currentColor" stroke-opacity=".35" stroke-width=".6"/>
      </svg>`);
    });
    root.querySelector('.stat-rank .stat-icon').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 20V10M12 20V3M19 20V7"/></svg>';
    root.insertAdjacentHTML('beforeend', `<div class="home-footer"><p>Plus qu’un jeu<br>Une communauté</p><p>Des joueurs aujourd’hui<br>Des légendes demain</p></div>`);
    root.querySelectorAll('.quickplay-btn, .home-nav-card, .stat-tile').forEach(surface => {
      surface.insertAdjacentHTML('beforeend', '<span class="home-surface-light" aria-hidden="true"></span>');
      if (surface.matches('button')) surface.insertAdjacentHTML('beforeend', '<span class="home-contact-shadow" aria-hidden="true"></span>');
    });
    homeMotion(root);
  }

  function battle(root) {
    root.classList.add('imdcx-battle');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Bataille');
    root.querySelector('.battle-status').setAttribute('role', 'status');
    parallax(root, '.battle-side');
  }

  const polar = (radius, angle) => {
    const radians = (angle - 90) * Math.PI / 180;
    return `${(200 + radius * Math.cos(radians)).toFixed(3)},${(200 + radius * Math.sin(radians)).toFixed(3)}`;
  };

  function wheel(root, segments) {
    root.classList.add('imdcx-wheel');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-labelledby', 'wheel-title');
    root.querySelector('.wheel-status').setAttribute('role', 'status');
    root.querySelector('.wheel-wrap').setAttribute('aria-label', `Multiplicateurs : ${segments.map(s => `x${s.value}`).join(', ')}`);
    const colors = ['#ce83bb', '#c0bacf', '#75b5f5', '#ad85eb'];
    const materials = ['#281325', '#1c1c29', '#101e36', '#26183b'];
    const svg = `<svg class="premium-wheel-face" viewBox="0 0 400 400" aria-hidden="true">
      <defs>
        ${segments.map((seg, i) => `<radialGradient id="imdcx-segment-${i}" cx="50%" cy="50%" r="65%"><stop stop-color="#090a14"/><stop offset=".76" stop-color="${materials[i]}"/><stop offset="1" stop-color="${colors[i]}" stop-opacity=".6"/></radialGradient>`).join('')}
        <linearGradient id="imdcx-wheel-sheen" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ffffff" stop-opacity=".12"/><stop offset=".44" stop-color="#ffffff" stop-opacity="0"/><stop offset="1" stop-color="#000000" stop-opacity=".2"/></linearGradient>
      </defs>
      ${segments.map((seg, i) => {
        const start = seg.angle - 44;
        const end = seg.angle + 44;
        const path = `M ${polar(66, start)} L ${polar(192, start)} A 192 192 0 0 1 ${polar(192, end)} L ${polar(66, end)} A 66 66 0 0 0 ${polar(66, start)} Z`;
        return `<g class="premium-wheel-segment" data-value="${seg.value}" style="--segment-light:${colors[i]}">
          <path d="${path}" fill="url(#imdcx-segment-${i})" stroke="${colors[i]}" stroke-opacity=".6" stroke-width="1.3"/>
          <path d="${path}" fill="url(#imdcx-wheel-sheen)"/>
          <path class="premium-segment-highlight" d="${path}" fill="${colors[i]}" fill-opacity=".15" stroke="${colors[i]}" stroke-width="2"/>
          <path d="M ${polar(189, start + 1)} A 189 189 0 0 1 ${polar(189, end - 1)}" fill="none" stroke="${colors[i]}" stroke-opacity=".45" stroke-width="2"/>
        </g>`;
      }).join('')}
    </svg>`;
    root.querySelector('.wheel-disc').insertAdjacentHTML('afterbegin', svg);
    root.querySelectorAll('.wheel-seg-label').forEach((label, i) => {
      label.dataset.value = segments[i].value;
      label.style.color = colors[i];
    });
  }

  // Integral of a triangular acceleration phase followed by a cubic velocity decay.
  // Continuous velocity at the join, zero velocity at both ends, exact server-selected landing.
  function spinProgress(t) {
    const acceleration = 0.18;
    const peak = 1 / (acceleration / 2 + (1 - acceleration) / 4);
    if (t < acceleration) return peak * t * t / (2 * acceleration);
    const u = (t - acceleration) / (1 - acceleration);
    return peak * acceleration / 2 + peak * (1 - acceleration) * (1 - Math.pow(1 - u, 4)) / 4;
  }

  function spin(root, segment, finalRotation, duration) {
    spins.get(root)?.();
    const disc = root.querySelector('.wheel-disc');
    const labels = [...root.querySelectorAll('.wheel-seg-label')];
    const pointer = root.querySelector('.wheel-pointer');
    const radius = (disc.clientWidth || 244) * 0.337;
    let frame = 0;
    let tick = null;
    let previousBoundary = 0;
    let lastTick = -Infinity;
    const started = performance.now();
    disc.style.transition = 'none';
    labels.forEach(label => { label.style.transition = 'none'; label.classList.remove('is-winner'); });
    root.classList.remove('is-settled');
    root.classList.add('is-spinning');
    root.querySelectorAll('.premium-wheel-segment').forEach(el => el.classList.remove('is-winner'));
    root.querySelector('.wheel-status').textContent = 'Tirage en cours…';

    function paint(rotation) {
      disc.style.transform = `rotate(${rotation}deg)`;
      labels.forEach(label => {
        const angle = Number(label.dataset.angle);
        label.style.transform = `rotate(${angle}deg) translateY(-${radius}px) rotate(${-angle - rotation}deg)`;
      });
    }
    function cancel() {
      cancelAnimationFrame(frame);
      tick?.cancel();
      reducedMotion.removeEventListener('change', motionChange);
      spins.delete(root);
    }
    function finish() {
      paint(finalRotation);
      cancel();
      root.classList.remove('is-spinning');
      root.classList.add('is-settled');
      root.querySelectorAll(`[data-value="${segment.value}"]`).forEach(el => el.classList.add('is-winner'));
    }
    function motionChange() { if (reducedMotion.matches) finish(); }
    function animate(now) {
      if (!root.isConnected) return cancel();
      const t = Math.min(1, (now - started) / duration);
      const rotation = finalRotation * spinProgress(t);
      paint(rotation);
      const boundary = Math.floor(rotation / 90);
      if (boundary !== previousBoundary && now - lastTick > 75) {
        tick?.cancel();
        tick = pointer.animate([
          { transform: 'translateX(-50%) rotate(0deg)' },
          { transform: 'translateX(-50%) rotate(-7deg)', offset: 0.3 },
          { transform: 'translateX(-50%) rotate(0deg)' }
        ], { duration: 110, easing: 'ease-out' });
        lastTick = now;
      }
      previousBoundary = boundary;
      if (t < 1) frame = requestAnimationFrame(animate);
      else finish();
    }
    spins.set(root, cancel);
    reducedMotion.addEventListener('change', motionChange);
    paint(0);
    if (reducedMotion.matches) finish();
    else frame = requestAnimationFrame(animate);
  }

  window.IMDCXVisuals = Object.freeze({ home, battle, wheel, spin });
})();
