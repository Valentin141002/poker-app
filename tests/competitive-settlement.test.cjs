'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProgression } = require('../lib/progression');
const { createCompetitiveSettlement } = require('../lib/competitive-settlement');

function fixture(count = 10, options = {}) {
  const entries = {};
  let saves = 0;
  let id = 0;
  const published = [];
  const ensureEntry = name => entries[name] ||= { name, level: 'Q1', points: 0, multiplier: 5, needsWheelSpin: false };
  const save = () => { saves += 1; };
  const engine = createProgression({ getEntries: () => entries, ensureEntry, save, now: () => Date.parse('2026-09-12T12:00:00Z') });
  const dependencies = { engine, ensureEntry, save, publish: (name, receipt) => published.push({ name, ...receipt }), randomId: () => `run-${++id}` };
  const settlement = createCompetitiveSettlement(dependencies);
  const state = {
    roundNumber: 1,
    players: Array.from({ length: count }, (_, seat) => ({ label: `Player${seat}`, seat, id: `socket-${seat}`, status: '', bankroll: 20000, subtotal_bet: 0, total_bet_hand: 0 }))
  };
  settlement.begin(state, { roomId: 'table1', ...options });
  return { engine, entries, published, ensureEntry, state, settlement, dependencies, get saves() { return saves; } };
}
function bust(f, ...seats) {
  for (const seat of seats) {
    f.state.players[seat].status = 'BUST';
    f.state.players[seat].bankroll = 0;
  }
}
const pointsFor = (summary, name) => summary.receipts.find(receipt => receipt.name === name)?.basePoints;

test('final closure callback runs once after both persisted outcomes are recorded', () => {
  const f = fixture(2, { isFinal: true });
  const completions = [];
  const settlement = createCompetitiveSettlement({ ...f.dependencies, onComplete: (run, result) => {
    assert.equal(f.engine.profile('Player0').duel.played, 1);
    assert.equal(f.engine.profile('Player1').duel.played, 1);
    completions.push({ run, result });
  } });
  settlement.begin(f.state, { roomId: 'final-a', isFinal: true });
  bust(f, 1);
  settlement.settle(f.state);
  settlement.settle(f.state);
  assert.equal(completions.length, 1);
  assert.equal(completions[0].run.finished, true);
  assert.equal(completions[0].run.roomId, 'final-a');
  assert.equal(completions[0].result.winner, 'Player0');
});

test('a complete table awards one 30-point winner and one 10-point runner-up without adding the runner-up bonus to the winner', () => {
  const f = fixture();
  bust(f, 2, 3, 4, 5, 6, 7, 8, 9);
  const early = f.settlement.settle(f.state);
  assert.equal(early.finished, false);
  assert.equal(early.receipts.length, 8);
  assert.equal(early.receipts.every(receipt => receipt.basePoints === 0), true);
  bust(f, 1);
  f.state.players[0].status = 'WINNER';
  const result = f.settlement.settle(f.state, { finished: true, winnerName: 'Player0' });
  assert.equal(pointsFor(result, 'Player0'), 30);
  assert.equal(pointsFor(result, 'Player1'), 10);
  assert.equal(result.winnerReceipt.competitivePoints, 150);
  assert.equal(result.receipts.find(receipt => receipt.name === 'Player1').competitivePoints, 50);
  assert.equal(f.engine.profile('Player1').multiplier, 1);
  assert.equal(f.engine.profile('Player0').multiplier, 5);
  assert.equal(f.published.length, 10);
});

test('early eliminations clear the multiplier immediately and record a completed game only once', () => {
  const f = fixture();
  f.ensureEntry('Player9').points = 500;
  bust(f, 9);
  const result = f.settlement.settle(f.state);
  assert.equal(result.receipts.length, 1);
  assert.equal(result.receipts[0].basePoints, 0);
  const profile = f.engine.profile('Player9');
  assert.equal(profile.points, 500);
  assert.equal(profile.multiplier, 1);
  assert.equal(profile.gamesPlayed, 1);
  assert.equal(f.settlement.settle(f.state).receipts.length, 0);
  assert.equal(f.engine.profile('Player9').gamesPlayed, 1);
});

test('simultaneous final-hand busts choose exactly one runner-up using their pre-hand stacks', () => {
  const f = fixture();
  bust(f, 3, 4, 5, 6, 7, 8, 9);
  f.settlement.settle(f.state);
  f.state.roundNumber += 1;
  f.state.players[1].bankroll = 15000;
  f.state.players[2].bankroll = 35000;
  f.settlement.capture(f.state);
  bust(f, 1, 2);
  const result = f.settlement.settle(f.state);
  assert.equal(result.finished, true);
  assert.equal(pointsFor(result, 'Player1'), 0);
  assert.equal(pointsFor(result, 'Player2'), 10);
  assert.equal(pointsFor(result, 'Player0'), 30);
  assert.equal(result.receipts.filter(receipt => receipt.basePoints === 10).length, 1);
});

test('equal-stack simultaneous busts use the lower seat as a deterministic runner-up tiebreak', () => {
  const f = fixture();
  bust(f, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  const result = f.settlement.settle(f.state);
  assert.equal(pointsFor(result, 'Player1'), 10);
  assert.equal(result.receipts.filter(receipt => receipt.basePoints === 10).length, 1);
});

test('hand capture preserves initial stack when blinds have already been posted and ignores duplicate captures', () => {
  const f = fixture();
  f.state.roundNumber += 1;
  f.state.players[1].bankroll = 900;
  f.state.players[1].total_bet_hand = 100;
  f.state.players[2].bankroll = 950;
  f.state.players[2].total_bet_hand = 0;
  f.settlement.capture(f.state);
  f.state.players[2].bankroll = 5000;
  f.settlement.capture(f.state);
  bust(f, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  // Other participants began the same hand with 20000, so narrow the cohort
  // to two relevant contenders first for the stack comparison below.
  const run = f.settlement.metadata(f.state);
  assert.equal(run.participants.find(player => player.seat === 1).stackAtHandStart, 1000);
  assert.equal(run.participants.find(player => player.seat === 2).stackAtHandStart, 950);
});

test('calling finish twice does not grant XP, points, stats, notifications or another final ticket', () => {
  const f = fixture(10, { quickPlay: true });
  bust(f, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  const first = f.settlement.settle(f.state, { finished: true, winnerName: 'Player0' });
  assert.equal(first.winnerReceipt.basePoints, 30);
  assert.deepEqual(f.entries.Player0.pendingFinal, { id: 'run-1', at: first.winnerReceipt.at });
  delete f.entries.Player0.pendingFinal;
  const before = JSON.stringify(f.entries);
  const second = f.settlement.settle(f.state, { finished: true, winnerName: 'Player0' });
  assert.deepEqual(second.receipts, []);
  assert.equal(second.winnerReceipt, null);
  assert.equal(JSON.stringify(f.entries), before);
  assert.equal(f.published.length, 10);
});

test('persisted engine event IDs prevent replaying rewards or a consumed ticket from a reconstructed run', () => {
  const f = fixture(10, { quickPlay: true });
  bust(f, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  f.settlement.settle(f.state);
  delete f.entries.Player0.pendingFinal;
  const before = JSON.stringify(f.entries);
  const duplicate = createCompetitiveSettlement({ ...f.dependencies, randomId: () => 'run-1' });
  const state = { roundNumber: 1, players: f.state.players.map(player => ({ ...player, status: '', bankroll: 20000 })) };
  duplicate.begin(state, { roomId: 'table1', quickPlay: true });
  state.players.slice(1).forEach(player => { player.status = 'BUST'; player.bankroll = 0; });
  const result = duplicate.settle(state, { finished: true, winnerName: 'Player0' });
  assert.equal(result.receipts.length, 0);
  assert.equal(JSON.stringify(f.entries), before);
});

test('regular admin table victories keep points but do not mint quick-play final tickets', () => {
  const f = fixture();
  bust(f, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  f.settlement.settle(f.state);
  assert.equal(f.entries.Player0.pendingFinal, undefined);
  assert.equal(f.engine.profile('Player0').wins, 1);
});

test('championship final completion awards 50 and enables one multiplier wheel spin', () => {
  const f = fixture(2, { isFinal: true });
  bust(f, 1);
  const result = f.settlement.settle(f.state, { finished: true, winnerName: 'Player0' });
  assert.equal(result.winnerReceipt.basePoints, 50);
  assert.equal(result.winnerReceipt.kind, 'duel');
  assert.equal(pointsFor(result, 'Player1'), 0);
  assert.equal(f.entries.Player0.needsWheelSpin, true);
  assert.equal(f.engine.spin('Player0', 5).alreadySpun, false);
  assert.equal(f.engine.spin('Player0', 5).alreadySpun, true);
});

test('a hand winner is not rewarded while several tournament participants still have chips', () => {
  const f = fixture(2, { isFinal: true });
  f.state.players[0].status = 'WINNER';
  f.state.players[1].status = 'FOLD';
  const result = f.settlement.settle(f.state);
  assert.equal(result.finished, false);
  assert.deepEqual(result.receipts, []);
  assert.deepEqual(f.entries, {});
});

test('WAIT reconnects are preserved, but all remaining participants receive a result on forced completion', () => {
  const f = fixture();
  f.state.players[1].status = 'WAIT';
  f.state.players[1].id = null;
  assert.equal(f.settlement.settle(f.state).receipts.length, 0);
  for (let seat = 2; seat < 10; seat++) f.state.players[seat].status = 'WAIT';
  const result = f.settlement.settle(f.state, { finished: true, winnerName: 'Player0' });
  assert.equal(result.receipts.length, 10);
  assert.equal(pointsFor(result, 'Player1'), 10);
  assert.equal(f.settlement.metadata(f.state).participants.every(player => player.settled), true);
  assert.equal(f.engine.profile('Player1').multiplier, 1);
});

test('removed, inactive and replaced original participants lose once; substitute identities are never rewarded', () => {
  const f = fixture();
  f.state.players[7] = null;
  f.state.players[8].inactive = true;
  f.state.players[9].label = 'Substitute';
  const result = f.settlement.settle(f.state);
  assert.deepEqual(result.receipts.map(receipt => receipt.name), ['Player7', 'Player8', 'Player9']);
  assert.equal(f.entries.Substitute, undefined);
  assert.equal(f.engine.profile('Player9').multiplier, 1);
});

test('training, short tables and non-final duels award no competitive outcomes', () => {
  for (const [count, options] of [[10, { eligible: false }], [2, {}], [9, {}], [2, { isFinal: true, eligible: false }]]) {
    const f = fixture(count, options);
    f.state.players.slice(1).forEach(player => { player.status = 'BUST'; });
    assert.equal(f.settlement.settle(f.state, { finished: true, winnerName: 'Player0' }), null);
    assert.deepEqual(f.entries, {});
    assert.equal(f.published.length, 0);
  }
});

test('placeholders, bots, waiting and inactive seats cannot make an underfilled table eligible', () => {
  for (const replacement of [{ label: 'Seat 10' }, { label: '__proto__' }, { isBot: true }, { status: 'WAIT' }, { inactive: true }]) {
    const f = fixture();
    const state = { roundNumber: 1, players: f.state.players.map(player => ({ ...player })) };
    Object.assign(state.players[9], replacement);
    const result = f.settlement.begin(state, { roomId: 'table2' });
    assert.equal(result.eligible, false);
    assert.equal(f.settlement.settle(state, { finished: true, winnerName: 'Player0' }), null);
    assert.deepEqual(f.entries, {});
  }
});

test('private run tokens are absent from transmitted state and metadata snapshots cannot mutate the settlement', () => {
  const f = fixture();
  const original = JSON.stringify(f.state);
  const metadata = f.settlement.metadata(f.state);
  metadata.participants[0].name = 'Injected';
  metadata.participants[0].settled = true;
  metadata.id = 'fake';
  assert.equal(JSON.stringify(f.state), original);
  assert.equal(original.includes('run-1'), false);
  assert.equal(f.settlement.metadata(f.state).participants[0].name, 'Player0');
  assert.equal(f.settlement.begin(f.state, { roomId: 'table1' }).id, 'run-1');
  bust(f, 1, 2, 3, 4, 5, 6, 7, 8, 9);
  assert.equal(f.settlement.settle(f.state).winnerReceipt.id, 'table:run-1:0');
});
