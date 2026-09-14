/* Step 1 presentation adapter. Betting and reveal animations stay in the existing client. */
(() => {
  'use strict';
  function layoutSeatCards(table, state) {
    if (!state || !['waiting', 'preflop', 'flop', 'turn', 'river'].includes(state.phase)) return false;
    const width = 40, height = 54, gap = 5;
    table.style.setProperty('--seat-card-w', `${width}px`);
    table.style.setProperty('--seat-card-h', `${height}px`);
    table.style.setProperty('--seat-card-gap', `${gap}px`);
    const set = (element, properties) => {
      for (const [key, value] of Object.entries(properties)) element.style.setProperty(key, value, 'important');
    };
    table.querySelectorAll('.seat').forEach(seat => {
      const panel = seat.querySelector('.name-chips');
      if (!panel) return;
      seat.style.setProperty('--table-panel-top', `${panel.offsetTop}px`);
      if (seat.classList.contains('my-seat')) return;
      const hole = seat.querySelector('.holecards');
      const first = hole?.querySelector('.holecard1');
      const second = hole?.querySelector('.holecard2');
      if (!first || !second) return;
      const topRow = Number(seat.id.replace('seat', '')) < 5;
      set(hole, { position: 'absolute', left: '50%', top: `${panel.offsetTop + (topRow ? 94 : 35)}px`,
        width: `${width * 2 + gap}px`, height: `${height}px`, transform: 'translateX(-50%)' });
      set(first, { left: '0px', top: '0px', width: `${width}px`, height: `${height}px` });
      set(second, { left: `${width + gap}px`, top: '0px', width: `${width}px`, height: `${height}px` });
    });
    return true;
  }
  window.IMDCXTable = Object.freeze({ layoutSeatCards });
})();
