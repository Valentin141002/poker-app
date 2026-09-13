'use strict';

const { randomUUID, createHash } = require('node:crypto');

const safeName = value => typeof value === 'string' && value.trim() && value.trim().length <= 100 && !['__proto__', 'constructor', 'prototype'].includes(value.trim()) && !/^Seat\s+\d+$/i.test(value.trim()) && !/[\u0000-\u001f\u007f]/.test(value) ? value.trim() : null;
const amount = value => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
const seatOf = (player, index) => Number.isInteger(player.seat) && player.seat >= 0 ? player.seat : index;
const handKey = state => Number.isInteger(state.roundNumber) && state.roundNumber >= 0 ? state.roundNumber : null;

function stackAtStart(player) {
  // total_bet_hand includes all streets and blinds. The fallback supports
  // older state objects where total_bet and subtotal_bet were separate.
  const committed = typeof player.total_bet_hand === 'number' && Number.isFinite(player.total_bet_hand)
    ? amount(player.total_bet_hand)
    : amount(player.total_bet) + amount(player.subtotal_bet);
  return amount(player.bankroll) + committed;
}

function createCompetitiveSettlement({ engine, ensureEntry, save = () => {}, publish = () => {}, onComplete = () => {}, randomId = randomUUID }) {
  if (!engine || typeof engine.recordGame !== 'function' || typeof ensureEntry !== 'function') throw new TypeError('engine and ensureEntry are required');
  const runs = new WeakMap();

  function metadata(state) {
    const run = state && runs.get(state);
    if (!run) return null;
    return {
      id: run.id, roomId: run.roomId, kind: run.kind, eligible: run.eligible, quickPlay: run.quickPlay,
      finished: run.finished, winner: run.winner,
      participants: run.participants.map(player => ({ name: player.name, seat: player.seat, stackAtHandStart: player.stackAtHandStart, settled: player.settled }))
    };
  }

  function findPlayer(state, participant) {
    if (!Array.isArray(state.players)) return null;
    return state.players.find((player, index) => player && seatOf(player, index) === participant.seat && safeName(player.label) === participant.name) || null;
  }

  function begin(state, { roomId = '', isFinal = false, eligible = true, quickPlay = false } = {}) {
    if (!state || typeof state !== 'object' || !Array.isArray(state.players)) return null;
    const existing = runs.get(state);
    // Starting the same live state twice must not create a second reward run.
    if (existing && !existing.finished) return metadata(state);
    const candidates = state.players.map((player, index) => {
      if (!player || player.inactive || player.isBot || player.bot || ['WAIT', 'BUST'].includes(player.status)) return null;
      const name = safeName(player.label);
      return name ? { name, seat: seatOf(player, index), stackAtHandStart: stackAtStart(player), settled: false } : null;
    }).filter(Boolean);
    const unique = new Set(candidates.map(player => player.name)).size === candidates.length && new Set(candidates.map(player => player.seat)).size === candidates.length;
    const suppliedId = String(randomId());
    const id = /^[a-zA-Z0-9_-]{1,120}$/.test(suppliedId) ? suppliedId : createHash('sha256').update(suppliedId).digest('hex');
    runs.set(state, {
      id, roomId: String(roomId), kind: isFinal ? 'duel' : 'table',
      eligible: eligible === true && unique && candidates.length === (isFinal ? 2 : 10),
      quickPlay: quickPlay === true, participants: candidates, round: handKey(state), finished: false, winner: null
    });
    return metadata(state);
  }

  function capture(state) {
    const run = state && runs.get(state);
    if (!run || !run.eligible || run.finished) return null;
    const round = handKey(state);
    if (round !== null && round === run.round) return metadata(state);
    for (const participant of run.participants) {
      if (participant.settled) continue;
      const player = findPlayer(state, participant);
      if (player && !player.inactive && player.status !== 'BUST') participant.stackAtHandStart = stackAtStart(player);
    }
    run.round = round;
    return metadata(state);
  }

  function settle(state, { finished = false, winnerName = null } = {}) {
    const run = state && runs.get(state);
    if (!run || !run.eligible) return null;
    if (run.finished) return { finished: true, winner: run.winner, receipts: [], winnerReceipt: null };
    const remaining = run.participants.filter(participant => !participant.settled);
    const newlyLost = remaining.filter(participant => {
      const player = findPlayer(state, participant);
      // WAIT alone may be a short reconnect/break. A missing/replaced seat,
      // inactive participant or explicit BUST is a permanent elimination.
      return !player || player.inactive || player.status === 'BUST';
    });
    const survivors = remaining.filter(participant => !newlyLost.includes(participant));
    const requestedFinish = finished === true || state.gameFinished === true;
    let winner = null;
    if (requestedFinish && safeName(winnerName)) winner = survivors.find(participant => participant.name === winnerName.trim()) || null;
    if (!winner && survivors.length === 1) winner = survivors[0];
    if (!winner && requestedFinish) {
      const markedWinners = survivors.filter(participant => findPlayer(state, participant).status === 'WINNER');
      if (markedWinners.length === 1) winner = markedWinners[0];
    }
    // A WINNER status on one hand is not enough: several players can still
    // have chips. Only a terminal server outcome or one survivor ends a run.
    const terminal = requestedFinish || survivors.length === 1;
    const losers = terminal ? remaining.filter(participant => participant !== winner) : newlyLost;
    const runnerUp = terminal && winner && run.kind === 'table'
      ? [...losers].sort((a, b) => b.stackAtHandStart - a.stackAtHandStart || a.seat - b.seat)[0] || null
      : null;
    const summary = { finished: terminal, winner: winner ? winner.name : null, receipts: [], winnerReceipt: null };

    function record(participant, won) {
      const receipt = engine.recordGame(participant.name, {
        eventId: `${run.kind}:${run.id}:${participant.seat}`,
        kind: run.kind, won, runnerUp: !won && participant === runnerUp, eligible: true
      });
      participant.settled = true;
      if (!receipt) return;
      if (won && run.kind === 'table' && run.quickPlay) {
        const entry = ensureEntry(participant.name);
        if (entry) {
          entry.pendingFinal = { id: run.id, at: receipt.at };
          save();
        }
      }
      const namedReceipt = { name: participant.name, ...receipt };
      summary.receipts.push(namedReceipt);
      if (won) summary.winnerReceipt = namedReceipt;
      publish(participant.name, receipt);
    }

    for (const participant of losers) record(participant, false);
    if (terminal && winner) record(winner, true);
    if (terminal) {
      run.finished = true;
      run.winner = winner ? winner.name : null;
      onComplete(metadata(state), summary);
    }
    return summary;
  }

  return { begin, capture, settle, metadata };
}

module.exports = { createCompetitiveSettlement };
