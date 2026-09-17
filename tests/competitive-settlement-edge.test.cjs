'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createProgression } = require('../lib/progression');
const { createCompetitiveSettlement } = require('../lib/competitive-settlement');

function fixture() {
  const entries = {};
  const ensureEntry = name => entries[name] ||= { name, points: 0, multiplier: 5 };
  const engine = createProgression({ getEntries: () => entries, ensureEntry });
  const settlement = createCompetitiveSettlement({ engine, ensureEntry, randomId: () => 'edge-run' });
  const state = {
    roundNumber: 1,
    players: Array.from({ length: 10 }, (_, seat) => ({
      label: `Player${seat}`, seat, id: `socket${seat}`, status: '',
      bankroll: 20000, total_bet_hand: 0, subtotal_bet: 0,
      carda: seat === 0 || seat === 9 ? 'h14' : 'h13', cardb: 'd2'
    })),
    board: ['s3', 's4', 's5', 's6', 'c7'], pot: 0
  };
  settlement.begin(state, { roomId: 'room', quickPlay: true });
  return { state, entries, engine, settlement };
}

function runDealNextHand(f) {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = server.indexOf('function dealNextHand(tableID) {');
  const end = server.indexOf('function resetTurnTimer(', start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    gameStateByTable: { room: f.state },
    competitiveSettlement: f.settlement,
    currentBetByTable: {}, currentMinRaiseByTable: {},
    currentBetByMatch2: {}, currentMinRaiseByMatch2: {},
    matches2Config: {}, tablesConfig: { room: { mode: 'normal' } },
    turnTimersByTable: {}, turnTimersByMatch2: {},
    clearRevealSequence: () => {}, distributeCards: () => {},
    clearHandRunout: () => {}, clearHandTurnTimers: () => {},
    configureBlinds: () => {}, resetTurnTimer: () => {}, broadcastTableState: () => {}
  });
  vm.runInContext(server.slice(start, end), context);
  vm.runInContext('dealNextHand("room")', context);
}

test('a BUST status with remaining chips is repairable and must not create an irreversible loss', () => {
  const f = fixture();
  f.state.players[9].status = 'BUST';
  f.state.players[9].bankroll = 2500;
  runDealNextHand(f);
  assert.equal(f.state.players[9].status, '', 'dealNextHand restores this seat before settlement');
  assert.equal(f.settlement.metadata(f.state).participants[9].settled, false);
  assert.deepEqual(f.entries, {});
});

test('a reconnectable positive-stack BUST cannot award the other remaining player a premature victory', () => {
  const f = fixture();
  f.state.players.slice(2).forEach(player => { player.status = 'BUST'; player.bankroll = 0; });
  f.settlement.settle(f.state);
  f.state.players[1].status = 'BUST';
  f.state.players[1].bankroll = 2500;
  runDealNextHand(f);
  assert.equal(f.settlement.metadata(f.state).finished, false);
  assert.equal(f.entries.Player0?.pendingFinal, undefined);
  assert.equal(f.settlement.metadata(f.state).participants[1].settled, false);
});

test('explicit completed games still settle a forfeiting player who has chips', () => {
  const f = fixture();
  f.state.players.slice(1).forEach(player => { player.status = 'WAIT'; player.id = null; });
  const result = f.settlement.settle(f.state, { finished: true, winnerName: 'Player0' });
  assert.equal(result.finished, true);
  assert.equal(result.winnerReceipt.basePoints, 30);
  assert.equal(result.receipts.filter(receipt => receipt.basePoints === 10).length, 1);
  assert.equal(f.engine.profile('Player1').multiplier, 1);
});

test('dealNextHand preserves settlement and idempotency before the completed-game early return', () => {
  const f = fixture();
  f.state.players.slice(1).forEach(player => { player.status = 'WAIT'; player.id = null; });
  f.state.gameFinished = true;
  f.state.winReason = { winnerLabel: 'Player0' };
  runDealNextHand(f);
  assert.equal(f.settlement.metadata(f.state).finished, true);
  assert.equal(f.engine.profile('Player0').wins, 1);
  assert.equal(f.state.roundNumber, 1);
  const before = JSON.stringify(f.entries);
  runDealNextHand(f);
  assert.equal(JSON.stringify(f.entries), before);
});

test('the server hyper tiebreak settles removed contenders before the final runner-up is determined', () => {
  const f = fixture();
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = server.indexOf('function handleHyperTie(tableID) {');
  const end = server.indexOf('function handleHyperTie2(', start);
  assert.ok(start >= 0 && end > start, 'the existing hyper tiebreak functions must be available');
  const context = vm.createContext({
    gameStateByTable: { room: f.state },
    currentBetByTable: {},
    competitiveSettlement: f.settlement,
    Hand: {
      solve: cards => cards[0],
      winners: hands => hands.filter(hand => hand === 'Ah')
    },
    io: { to: () => ({ emit: () => {} }) }
  });
  vm.runInContext(server.slice(start, end), context);
  assert.equal(vm.runInContext('handleHyperTie("room")', context), true);
  assert.deepEqual(f.state.players.map(player => player.seat), [0, 9]);
  const early = f.settlement.metadata(f.state).participants.filter(player => player.settled);
  assert.equal(early.length, 8, 'all players outside the tiebreak are already eliminated');
  f.state.players[1].status = 'BUST';
  f.state.players[1].bankroll = 0;
  const result = f.settlement.settle(f.state, { finished: true, winnerName: 'Player0' });
  assert.equal(result.receipts.find(receipt => receipt.name === 'Player9')?.basePoints, 10);
  assert.equal(f.engine.profile('Player1').points, 0);
});
