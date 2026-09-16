/* Presentation adapter for the existing table. No poker decisions. */
(() => {
  'use strict';
  function layoutSeatCards(table, state) {
    if (!table || !state) return false;
    if (!table.querySelector('.neon-table-ambience')) {
      const ambience = document.createElement('div');
      ambience.className = 'neon-table-ambience';
      ambience.setAttribute('aria-hidden', 'true');
      ['♥','♠','♦','♣'].forEach((suit, index) => {
        const icon = document.createElement('span');
        icon.className = `neon-suit neon-suit-${index}`;
        icon.textContent = suit; ambience.appendChild(icon);
      });
      table.appendChild(ambience);
    }
    const reveal = state.phase === 'reveal' || document.body.classList.contains('final-end-ui');
    const demoReveal = !!state.demo && reveal;
    table.classList.toggle('demo-seat-reveal', demoReveal);
    table.classList.toggle('seat-cards-reveal', reveal);
    if (!reveal && !['waiting', 'preflop', 'flop', 'turn', 'river'].includes(state.phase)) return false;
    const width = reveal ? 56 : 40, height = reveal ? 70 : 54, gap = reveal ? -30 : 5;
    table.style.setProperty('--seat-card-w', `${width}px`);
    table.style.setProperty('--seat-card-h', `${height}px`);
    table.style.setProperty('--seat-card-gap', `${gap}px`);
    const set = (element, properties) => {
      for (const [key, value] of Object.entries(properties)) element.style.setProperty(key, value, 'important');
    };
    table.querySelectorAll('.seat').forEach(seat => {
      const panel = seat.querySelector('.name-chips');
      if (!panel) return;
      const seatRect = seat.getBoundingClientRect();
      const scaleY = seat.offsetHeight ? seatRect.height / seat.offsetHeight : 1;
      const panelTop = reveal && scaleY > 0
        ? (panel.getBoundingClientRect().top - seatRect.top) / scaleY : panel.offsetTop;
      seat.style.setProperty('--table-panel-top', `${panelTop}px`);
      if (seat.classList.contains('my-seat') && !reveal) return;
      const hole = seat.querySelector('.holecards');
      const first = hole?.querySelector('.holecard1');
      const second = hole?.querySelector('.holecard2');
      if (!first || !second) return;
      const topRow = Number(seat.id.replace('seat', '')) < 5;
      set(hole, { position: 'absolute', left: '50%', top: `${panelTop + (reveal ? 62 : topRow ? 94 : 35)}px`,
        width: `${width * 2 + gap}px`, height: `${height + (reveal ? 13 : 0)}px`, transform: 'translateX(-50%)' });
      set(first, { position:'absolute', left: '0px', top: '0px', width: `${width}px`, height: `${height}px`, transform: reveal ? 'rotate(-7deg)' : 'none', 'z-index':'3' });
      set(second, { position:'absolute', left: `${width + gap}px`, top: reveal ? '13px' : '0px', width: `${width}px`, height: `${height}px`, transform: reveal ? 'rotate(7deg)' : 'none', 'z-index':'4' });
    });
    return true;
  }
  function layoutTouchUtilities(action, scale, enabled) {
    const groups = [
      ['odds-help-btn', 'btn-time', 'btn-add30'],
      ['break-btn'],
      ['stats-help-btn', 'rules-help-btn', 'sos-help-btn']
    ].map(ids => ids.map(id => document.getElementById(id)).filter(Boolean));
    if (!enabled) {
      groups.flat().forEach(button => button.style.removeProperty('scale'));
      return false;
    }
    const unit = Math.max(.01, scale);
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0;
    const width = viewport?.width || innerWidth;
    // Keep the existing utility row and handlers; give each visible button an
    // actual 34px touch surface even when the poker canvas is scaled down.
    groups.forEach((buttons, group) => {
      const visible = buttons.filter(button => button.offsetWidth && button.offsetHeight);
      const groupWidth = visible.length * 34 + Math.max(0, visible.length - 1) * 4;
      const start = group === 0 ? left + 10 : group === 1
        ? left + (width - groupWidth) / 2 : left + width - 10 - groupWidth;
      visible.forEach((button, index) => {
        button.style.setProperty('scale', String(34 / (button.offsetWidth * unit)));
        const rect = button.getBoundingClientRect();
        const delta = (start + index * 38 - rect.left) / unit;
        button.style.setProperty('left', `${button.offsetLeft + delta}px`, 'important');
        button.style.setProperty('right', 'auto', 'important');
      });
    });
    return true;
  }
  window.IMDCXTable = Object.freeze({ layoutSeatCards, layoutTouchUtilities });
})();
