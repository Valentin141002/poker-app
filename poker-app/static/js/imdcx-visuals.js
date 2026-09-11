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

  function home(root) {
    root.classList.add('imdcx-home');
    root.querySelector('.quickplay-name').setAttribute('aria-label', 'Votre pseudo');
    root.querySelector('.quickplay-status').setAttribute('role', 'status');
    root.querySelectorAll('button[title]').forEach(button => button.setAttribute('aria-label', button.title));
    parallax(root, '.stat-tile, .hero-card-fan');
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
