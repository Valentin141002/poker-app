'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the actual server lifecycle functions with a deterministic clock.
// Integration tests separately cover dealing, betting and payouts over sockets.
const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const lifecycle = source.slice(source.indexOf('const REVEAL_DECISION_MS ='), source.indexOf('function pickRestartSeat('));
const runouts = source.slice(source.indexOf('function startRevealAllIn('), source.indexOf("io.on('connection', socket =>"));

function fixture({ demo = false, seats = 2 } = {}) {
  let now = 1000, serial = 0, dealt = 0, evaluated = 0;
  const timers = new Map();
  const emissions = [];
  const state = {
    demo, phase: 'reveal', roundNumber: 1, pot: 150,
    roundEvaluated: false, revealSeqDone: false,
    players: Array.from({ length: seats }, (_, i) => ({
      id: `player-${i}`, label: `P${i + 1}`, bankroll: 10000,
      status: i < 2 ? '' : 'FOLD', inShowdown: i < 2
    }))
  };
  const emit = () => emissions.push(JSON.parse(JSON.stringify(state)));
  const evaluate = () => {
    evaluated++;
    state.players[0].bankroll += state.pot;
    state.pot = 0;
    state.players[0].status = 'WINNER';
  };
  const context = vm.createContext({
    Date: { now: () => now },
    setTimeout: (callback, delay) => {
      const id = ++serial;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    gameStateByTable: { room: state },
    matches2Config: seats === 2 ? { room: {} } : {},
    turnTimersByTable: {}, turnTimersByMatch2: {}, revealTimersByRoom: {},
    io: { to: () => ({ emit }) },
    broadcastTableState: emit, broadcastMatch2State: emit,
    evaluateRound: evaluate, evaluateRound2: evaluate,
    isSocketConnected: () => true,
    resetTurnTimer: () => {}, resetTurnTimer2: () => {},
    dealNextHand: () => {
      dealt++;
      context.clearRevealSequence('room', state);
      state.roundNumber++;
      state.phase = 'preflop';
      state.roundEvaluated = false;
    }
  });
  vm.runInContext(lifecycle + '\n' + runouts, context);
  const tick = duration => {
    const end = now + duration;
    for (;;) {
      const next = [...timers].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, job] = next;
      now = job.at;
      timers.delete(id);
      job.callback();
    }
    now = end;
  };
  return { context, state, timers, emissions, tick, get dealt() { return dealt; }, get evaluated() { return evaluated; } };
}

for (const demo of [false, true]) {
  for (const seats of [2, 10]) {
    for (const outcome of ['show', 'hide', 'last-player-hide', 'all-in']) {
      test(`${demo ? 'demo' : 'live'} ${seats}: ${outcome} schedules exactly one next hand`, () => {
        const f = fixture({ demo, seats });
        const { context: c, state } = f;
        if (outcome === 'last-player-hide') {
          state.players[1].status = 'FOLD';
          state.players[1].inShowdown = false;
        }
        c.initRevealSequence('room', seats === 2, { forceShowAllIn: outcome === 'all-in' });
        if (outcome !== 'all-in') {
          c.applyRevealChoice('room', seats === 2, 0, outcome.includes('hide'));
          if (outcome === 'show') c.applyRevealChoice('room', seats === 2, 1, false);
        }
        assert.equal(state.roundEvaluated, true);
        assert.equal(state.revealSeqDone, true);
        assert.equal(state.pot, 0);
        assert.equal(f.timers.size, 1);
        assert.equal(f.emissions.at(-1).revealWinnerDeadline, 11000);
        const bankrolls = state.players.map(p => p.bankroll);
        const timer = [...f.timers.keys()][0];
        c.applyRevealChoice('room', seats === 2, 0, false);
        c.advanceRevealSequence('room', seats === 2);
        c.startReveal('room');
        c.startRevealAllIn('room');
        assert.equal([...f.timers.keys()][0], timer);
        assert.deepEqual(state.players.map(p => p.bankroll), bankrolls);
        f.tick(9999);
        assert.equal(f.dealt, 0);
        f.tick(1);
        assert.equal(f.dealt, 1);
        assert.equal(state.roundNumber, 2);
        assert.equal(state.revealWinnerDeadline, null);
        assert.equal(f.timers.size, 0);
        f.tick(30000);
        assert.equal(f.dealt, 1);
      });
    }
  }
}

test('winner pause/resume preserves remaining delay for live and demo rooms', () => {
  for (const demo of [false, true]) {
    const f = fixture({ demo });
    f.context.initRevealSequence('room', true, { forceShowAllIn: true });
    f.tick(3500);
    f.context.pauseGame('room', true);
    assert.equal(f.timers.size, 0);
    f.tick(20000);
    assert.equal(f.dealt, 0);
    f.context.resumeGame('room', true);
    f.context.resumeGame('room', true);
    assert.equal(f.timers.size, 1);
    f.tick(6499);
    assert.equal(f.dealt, 0);
    f.tick(1);
    assert.equal(f.dealt, 1);
  }
});

test('pausing a duel cancels its action timer too', () => {
  const f = fixture();
  f.state.phase = 'preflop';
  f.state.turnStartTime = 1000;
  f.state.turnDuration = 30000;
  f.context.turnTimersByMatch2.room = f.context.setTimeout(() => assert.fail('paused turn expired'), 30000);
  f.context.pauseGame('room', true);
  assert.equal(f.timers.size, 0);
  assert.equal(f.context.turnTimersByMatch2.room, undefined);
  f.tick(30000);
});

test('obsolete winner callbacks cannot consume a replacement timer or a later round', () => {
  const f = fixture();
  const c = f.context;
  f.state.roundEvaluated = f.state.revealSeqDone = true;
  c.scheduleNextHand('room');
  const stale = [...f.timers.values()][0].callback;
  c.clearRevealSequence('room', f.state);
  f.state.roundEvaluated = f.state.revealSeqDone = true;
  c.scheduleNextHand('room');
  stale();
  assert.equal(f.timers.size, 1);
  assert.equal(f.dealt, 0);
  f.state.roundNumber++;
  f.tick(10000);
  assert.equal(f.dealt, 0);
  assert.equal(f.timers.size, 0);
  c.scheduleNextHand('room');
  c.gameStateByTable.room = { ...f.state };
  f.tick(10000);
  assert.equal(f.dealt, 0);
});

test('reveal decision callback is removed, seat-scoped and honors zero remaining time', () => {
  const f = fixture();
  const c = f.context;
  c.initRevealSequence('room', true);
  const stale = [...f.timers.values()][0].callback;
  c.applyRevealChoice('room', true, 0, false);
  stale();
  assert.equal(f.state.revealSeq.activeSeat, 1);
  assert.equal(f.state.players[1].revealStatus, null);
  c.scheduleRevealDecisionTimeout('room', true, 1, 0);
  f.tick(0);
  assert.equal(f.state.revealSeqDone, true);
  assert.equal(c.revealTimersByRoom.room, undefined);
  assert.equal(f.timers.size, 1);
});

test('finished games never schedule a new hand', () => {
  const f = fixture();
  f.state.gameFinished = f.state.roundEvaluated = f.state.revealSeqDone = true;
  f.context.scheduleNextHand('room');
  assert.equal(f.timers.size, 0);
});

test('runout is scheduled once and is cancelled on room disposal or hand replacement', () => {
  for (const method of ['startReveal', 'startRevealAllIn']) {
    const f = fixture();
    f.state.phase = 'preflop';
    f.context[method]('room');
    f.context[method]('room');
    assert.equal(f.timers.size, 4);
    const stale = [...f.timers.values()].map(job => job.callback);
    f.context.clearHandRunout('room');
    f.state.roundNumber++;
    stale.forEach(callback => callback());
    assert.equal(f.timers.size, 0);
    assert.equal(f.state.phase, 'preflop');
    assert.equal(f.state.revealSeq, undefined);
  }
});

test('pause during runout preserves reveal players and resumes its remaining jobs once', () => {
  for (const method of ['startReveal', 'startRevealAllIn']) {
    const f = fixture();
    f.state.phase = 'preflop';
    f.context[method]('room');
    f.tick(1000);
    assert.equal(f.state.phase, 'flop');
    const stale = [...f.timers.values()].map(job => job.callback);
    f.context.pauseGame('room', true);
    assert.equal(f.timers.size, 0);
    f.tick(30000);
    stale.forEach(callback => callback());
    assert.equal(f.state.phase, 'flop');
    assert.equal(f.state.revealSeq, undefined);
    f.context.resumeGame('room', true);
    f.context.resumeGame('room', true);
    assert.equal(f.timers.size, 3);
    f.tick(1499);
    assert.equal(f.state.phase, 'flop');
    f.tick(1);
    assert.equal(f.state.phase, 'turn');
    f.tick(5000);
    assert.equal(f.state.phase, 'reveal');
    assert.deepEqual(Array.from(f.state.revealSeq.order), [0, 1]);
    f.tick(20000);
    assert.equal(f.dealt, 1);
    assert.equal(f.evaluated, 1);
    assert.equal(f.timers.size, 0);
  }
});
