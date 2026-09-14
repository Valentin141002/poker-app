'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const repository = path.resolve(__dirname, '..');
const timeoutMs = 6000;

// A small native protocol client keeps these integration tests independent of
// an optional socket.io-client dependency. Only JSON events/acks are needed.
class SocketClient {
  constructor(url) {
    this.events = new Map();
    this.waiters = new Map();
    this.acks = new Map();
    this.nextAck = 1;
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket handshake timed out')), timeoutMs);
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Socket connection failed')); });
      this.ws.addEventListener('message', event => {
        const frame = String(event.data);
        if (frame.startsWith('0')) this.ws.send('40');
        else if (frame === '2') this.ws.send('3');
        else if (frame.startsWith('40')) { clearTimeout(timer); resolve(this); }
        else if (frame.startsWith('42')) {
          const [name, payload] = JSON.parse(frame.slice(frame.indexOf('[')));
          if (name === 'demo:ready') this.demoRoomID = payload.roomID;
          const waiter = this.waiters.get(name)?.shift();
          if (waiter) { clearTimeout(waiter.timer); waiter.resolve(payload); }
          else {
            const queue = this.events.get(name) || [];
            queue.push(payload);
            this.events.set(name, queue.slice(-30));
          }
        } else if (frame.startsWith('43')) {
          const match = /^43(\d+)(\[.*)$/s.exec(frame);
          if (!match) return;
          const callback = this.acks.get(Number(match[1]));
          if (callback) {
            clearTimeout(callback.timer);
            this.acks.delete(Number(match[1]));
            callback.resolve(JSON.parse(match[2])[0]);
          }
        }
      });
    });
  }

  request(name, payload = {}) {
    const id = this.nextAck++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.acks.delete(id); reject(new Error(`No acknowledgement for ${name}`)); }, timeoutMs);
      this.acks.set(id, { resolve, timer });
      this.ws.send(`42${id}${JSON.stringify([name, payload])}`);
    });
  }

  next(name) {
    const queued = this.events.get(name);
    if (queued?.length) return Promise.resolve(queued.shift());
    return new Promise((resolve, reject) => {
      const pending = this.waiters.get(name) || [];
      const waiter = { resolve, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.set(name, (this.waiters.get(name) || []).filter(item => item !== waiter));
        reject(new Error(`No event ${name}`));
      }, timeoutMs);
      pending.push(waiter);
      this.waiters.set(name, pending);
    });
  }

  async sendFor(name, payload, responseName) {
    const response = this.next(responseName);
    this.ws.send(`42${JSON.stringify([name, payload])}`);
    return response;
  }

  close() {
    this.ws.close();
    for (const callback of this.acks.values()) clearTimeout(callback.timer);
    for (const pending of this.waiters.values()) for (const waiter of pending) clearTimeout(waiter.timer);
  }
}

function isolatedServer(initialPlayers) {
  // Copy code only. Never read or copy the repository's live JSON databases.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imdcx-progression-server-'));
  fs.copyFileSync(path.join(repository, 'server.js'), path.join(directory, 'server.js'));
  fs.mkdirSync(path.join(directory, 'lib'));
  for (const filename of ['progression.js', 'progression-sockets.js', 'competitive-settlement.js', 'demo-controller.js']) {
    fs.copyFileSync(path.join(repository, 'lib', filename), path.join(directory, 'lib', filename));
  }
  const fixtureData = {
    'playerLevels.json': initialPlayers,
    'tablesConfig.json': {}, 'matches2Config.json': {}, 'gamesHistory.json': [],
    'playerStatsTable.json': { Alice: { gamesPlayed: 4, wins: 2 } },
    'playerStatsMatch2.json': { Alice: { gamesPlayed: 3, wins: 1 } }
  };
  for (const [filename, value] of Object.entries(fixtureData)) {
    fs.writeFileSync(path.join(directory, filename), JSON.stringify(value));
  }
  let child;
  let port;
  const clients = [];

  async function start() {
    // Observe the real listen call to discover its OS-assigned port, without
    // changing the copied server source or reserving a potentially racy port.
    const boot = [
      "const http = require('node:http');",
      'const listen = http.Server.prototype.listen;',
      'http.Server.prototype.listen = function(...args) {',
      "  this.once('listening', () => process.send({ port: this.address().port }));",
      '  return listen.apply(this, args);',
      '};',
      'require(process.argv[1]);'
    ].join('\n');
    child = spawn(process.execPath, ['-e', boot, path.join(directory, 'server.js')], {
      cwd: directory, windowsHide: true,
      env: { ...process.env, PORT: '0', NODE_PATH: path.join(repository, 'node_modules'), ADMIN_FIXED_SCOPE: '', ADMIN_GATEWAY_TOKEN: '', ADMIN_SCOPE_HOST_MAP: '' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc']
    });
    let output = '';
    child.stdout.on('data', chunk => { output = (output + chunk).slice(-12000); });
    child.stderr.on('data', chunk => { output = (output + chunk).slice(-12000); });
    port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Isolated server did not start: ${output}`)), 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Isolated server exited (${code}): ${output}`)); });
      child.once('message', message => { clearTimeout(timer); resolve(message.port); });
    });
    assert.ok(Number.isInteger(port) && port > 0);
    const health = await fetch(`http://127.0.0.1:${port}/__health`);
    assert.equal((await health.json()).ok, true);
  }

  async function connect(name) {
    const socket = new SocketClient(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket`);
    clients.push(socket);
    await socket.ready;
    if (name) {
      const response = await socket.request('progression:identify', { name, clientKey: `integration-${name}` });
      assert.equal(response.ok, true, response.error);
    }
    return socket;
  }

  async function stop() {
    clients.splice(0).forEach(socket => socket.close());
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const stopped = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await stopped;
  }

  async function cleanup() {
    await stop();
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('imdcx-progression-server-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }

  return {
    start, stop, connect, cleanup,
    read: filename => JSON.parse(fs.readFileSync(path.join(directory, filename), 'utf8'))
  };
}

test('manual demo uses the live engine for every seat without writing accounts or statistics', { timeout: 100000 }, async t => {
  const isolated = isolatedServer({ P1: { name: 'P1', level: 'Q1', points: 123, multiplier: 5 } });
  t.after(() => isolated.cleanup());
  await isolated.start();
  const files = ['playerLevels.json', 'gamesHistory.json', 'playerStatsTable.json', 'playerStatsMatch2.json', 'tablesConfig.json', 'matches2Config.json'];
  const before = files.map(file => isolated.read(file));
  const clients = [];
  const send = (client, event, payload) => client.ws.send(`42${JSON.stringify([event, payload])}`);
  const waitState = async (client, seats, predicate) => {
    let last;
    for (let n = 0; n < 100; n++) {
      const packet = await client.next(seats === 2 ? 'updateMatch2' : 'updateTable').catch(error => {
        throw new Error(`${error.message}; ${predicate}; last=${JSON.stringify(last)}`);
      });
      const state = seats === 2 ? packet.gameState : packet;
      if (state.demoRoomID !== client.demoRoomID) continue;
      last = { room: state.demoRoomID, phase: state.phase, revision: state.demoRevision, actor: state.current_bettor_index, statuses: state.players.map(p => p.status) };
      if (predicate(state)) return state;
    }
    assert.fail('Expected demo state was not received');
  };
  const decision = (state, extra) => ({ demoRoomID: state.demoRoomID, demoRound: state.roundNumber,
    demoRevision: state.demoRevision, demoSeat: state.current_bettor_index, ...extra });

  for (const seats of [2, 10]) {
    t.diagnostic(`Playing ${seats} demo seats through all streets`);
    const client = await isolated.connect();
    clients.push(client);
    assert.equal((await client.request('demo:start', { seats })).ok, true);
    let state = (await client.next('startGame')).gameState;
    assert.equal(state.players.length, seats);
    assert.equal(state.demo, true);
    assert.equal(state.turnDuration, undefined);
    assert.deepEqual(state.players.map(p => p.label), Array.from({ length: seats }, (_, i) => `P${i + 1}`));
    assert.ok(state.players.every(p => p.demo && !p.bot && !p.isBot));
    assert.equal(new Set(state.players.flatMap(p => [p.carda, p.cardb]).concat(state.board)).size, seats * 2 + 5);
    const phases = new Set();
    const controlled = new Set();
    // Exercise the same call/check/raise handler through all four betting streets.
    for (let n = 0; state.phase !== 'reveal' && n < 80; n++) {
      phases.add(state.phase);
      controlled.add(state.current_bettor_index);
      const actor = state.players[state.current_bettor_index];
      const action = n === 0 ? { type: 'raise', amount: 300 - actor.subtotal_bet }
        : { type: state.current_bet > actor.subtotal_bet ? 'call' : 'check' };
      send(client, 'playerAction', decision(state, action));
      const revision = state.demoRevision;
      state = await waitState(client, seats, s => s.demoRevision > revision);
    }
    assert.equal(state.phase, 'reveal');
    assert.deepEqual([...phases], ['preflop', 'flop', 'turn', 'river']);
    assert.equal(controlled.size, seats);
    while (!state.revealSeqDone) {
      const seat = state.revealSeq.activeSeat;
      send(client, 'revealChoice', decision(state, { demoSeat: seat, hide: false }));
      state = await waitState(client, seats, s => s.revealSeqDone || s.revealSeq?.activeSeat !== seat);
    }
    if (!state.roundEvaluated) state = await waitState(client, seats, s => s.roundEvaluated);
    assert.equal(state.players.reduce((sum, p) => sum + p.bankroll, 0) + state.pot, 20000 * seats);

    const previous = state;
    assert.equal((await client.request('demo:next')).ok, true);
    state = await waitState(client, seats, s => s.demoRoomID !== previous.demoRoomID);
    assert.equal(state.roundNumber, previous.roundNumber + 1);
    assert.notEqual(state.dealerIndex, previous.dealerIndex);
    assert.equal(state.players.reduce((sum, p) => sum + p.bankroll, 0) + state.pot, 20000 * seats);
    // A stale decision must not control the next hand, nor can this socket claim rewards.
    send(client, 'playerAction', decision(previous, { type: 'fold' }));
    assert.equal((await client.request('progression:claimLogin', { name: 'P1' })).ok, false);
    assert.equal((await client.request('joinGame', { table: state.demoRoomID, seat: 0 })).ok, false);
    assert.equal((await client.request('demo:restart')).ok, true);
    state = (await client.next('startGame')).gameState;
    assert.equal(state.roundNumber, 1);
    assert.ok(state.players.every(p => p.bankroll + p.subtotal_bet === 20000));

    // Every all-in remains manual. The engine performs the board runout and payout.
    t.diagnostic(`Playing ${seats} manual all-ins`);
    for (let n = 0; n < seats; n++) {
      send(client, 'playerAction', decision(state, { type: 'raise', amount: state.players[state.current_bettor_index].bankroll }));
      const revision = state.demoRevision;
      state = await waitState(client, seats, s => s.demoRevision > revision);
    }
    state = await waitState(client, seats, s => s.roundEvaluated);
    assert.equal(state.players.reduce((sum, p) => sum + p.bankroll, 0) + state.pot, 20000 * seats);
    assert.ok(state.players.some(p => p.status === 'WINNER'));

    assert.equal((await client.request('demo:restart')).ok, true);
    state = (await client.next('startGame')).gameState;
    // Fold all but one player, then reset during the existing timed runout.
    t.diagnostic(`Resetting ${seats} seats during fold runout`);
    for (let n = 0; n < seats - 1; n++) {
      send(client, 'playerAction', decision(state, { type: 'fold' }));
      const revision = state.demoRevision;
      state = await waitState(client, seats, s => s.demoRevision > revision);
    }
    assert.equal((await client.request('demo:next')).ok, true);
    state = await waitState(client, seats, s => s.demoRoomID !== state.demoRoomID);
    assert.equal(state.players.reduce((sum, p) => sum + p.bankroll, 0) + state.pot, 20000 * seats);
  }
  // Wait past the normal 30-second turn timeout. There must be no automatic action
  // and no stale runout/next-hand update after the manual reset.
  clients.forEach(client => client.events.clear());
  await new Promise(resolve => setTimeout(resolve, 31000));
  clients.forEach(client => {
    assert.equal(client.events.get('updateTable')?.length || 0, 0);
    assert.equal(client.events.get('updateMatch2')?.length || 0, 0);
  });
  assert.deepEqual(files.map(file => isolated.read(file)), before);
  for (const client of clients) assert.equal((await client.request('demo:quit')).ok, true);
});

test('real server progression sockets persist rewards and finals inside an isolated fixture', { timeout: 40000 }, async t => {
  const day = new Date().toISOString().slice(0, 10);
  const player = (name, extra = {}) => ({ name, level: 'Q1', points: 100, multiplier: null, needsWheelSpin: false, ...extra });
  const isolated = isolatedServer({
    Alice: player('Alice', { progression: { daily: { key: day, played: 3, wins: 1, bestStreak: 1 } } }),
    Bob: player('Bob', { points: 77, multiplier: 2 }),
    WinnerA: player('WinnerA', { pendingFinal: { id: 'table-a', at: Date.now() } }),
    WinnerB: player('WinnerB', { pendingFinal: { id: 'table-b', at: Date.now() } }),
    WheelWinner: player('WheelWinner', { needsWheelSpin: true }),
    ChoiceWinner: player('ChoiceWinner', {
      multiplier: 5,
      progression: { pendingMultiplier: { choiceId: 'persisted-choice', currentMultiplier: 5, newMultiplier: 2 } }
    })
  });
  t.after(() => isolated.cleanup());
  await isolated.start();
  let alice = await isolated.connect('Alice');
  let assignmentA;
  let assignmentB;

  await t.test('claims use the server actor, reject replay, and preserve the legacy home profile', async () => {
    const anonymous = await isolated.connect();
    assert.equal((await anonymous.request('progression:claimLogin', { name: 'Alice' })).code, 'IDENTITY_REQUIRED');
    assert.equal((await anonymous.request('progression:identify', { name: '__proto__' })).ok, false);

    const claimed = await alice.request('progression:claimLogin', { name: 'Bob', xp: 999999, points: 999999 });
    assert.equal(claimed.ok, true);
    assert.equal(claimed.data.profile.name, 'Alice');
    assert.equal(claimed.data.profile.xp, 50);
    assert.equal(isolated.read('playerLevels.json').Bob.progression.xp, 0);
    assert.equal((await alice.request('progression:claimLogin')).code, 'ALREADY_CLAIMED');
    const mission = await alice.request('progression:claimMission', { name: 'Bob', id: 'battle_play_3' });
    assert.equal(mission.ok, true);
    assert.equal(mission.data.profile.xp, 200);
    assert.equal((await alice.request('progression:claimMission', { id: 'battle_play_3' })).code, 'ALREADY_CLAIMED');

    const home = await alice.sendFor('getHomeProfile', { name: 'Alice' }, 'homeProfile');
    assert.equal(home.name, 'Alice');
    assert.equal(home.level, 'Q1');
    assert.equal(home.gamesPlayed, 7);
    assert.equal(home.wins, 3);
    assert.equal(home.winRate, 43);
    assert.equal(home.points, mission.data.profile.points);
    assert.equal(mission.data.profile.level, 2);
    assert.equal(mission.data.profile.gamesPlayed, 0, 'legacy hand totals remain separate from completed competitive games');
  });

  await t.test('wheel rolls require actor entitlement and cannot be repeated', async () => {
    const denied = await alice.sendFor('spinWheel', { name: 'WheelWinner' }, 'wheelResult');
    assert.equal(denied.alreadySpun, true);
    assert.equal(isolated.read('playerLevels.json').WheelWinner.needsWheelSpin, true);
    const winner = await isolated.connect('WheelWinner');
    const spun = await winner.sendFor('spinWheel', {}, 'wheelResult');
    assert.equal(spun.alreadySpun, false);
    assert.ok([1, 2, 5, 10].includes(spun.multiplier));
    const replayed = await winner.sendFor('spinWheel', {}, 'wheelResult');
    assert.equal(replayed.alreadySpun, true);
    assert.equal(replayed.multiplier, spun.multiplier);
    assert.equal(isolated.read('playerLevels.json').WheelWinner.needsWheelSpin, false);
  });

  await t.test('a persisted wheel choice is returned intact without rerolling', async () => {
    const choice = await isolated.connect('ChoiceWinner');
    const dashboard = await choice.request('progression:get');
    assert.equal(dashboard.data.pendingMultiplier.choiceId, 'persisted-choice');
    const replayed = await choice.sendFor('spinWheel', {}, 'wheelResult');
    assert.equal(replayed.alreadySpun, true);
    assert.equal(replayed.choiceRequired, true);
    assert.equal(replayed.choiceId, 'persisted-choice');
    assert.equal(replayed.multiplier, 2);
    assert.equal((await choice.request('progression:chooseMultiplier', { choiceId: 'forged', choice: 'replace' })).ok, false);
    assert.equal(isolated.read('playerLevels.json').ChoiceWinner.multiplier, 5);
  });

  await t.test('only entitled actors enter finals, and pairing consumes both tickets once', async () => {
    const rejected = await alice.sendFor('joinFinals', { name: 'WinnerA' }, 'joinError');
    assert.match(rejected, /10 joueurs/);
    const winnerA = await isolated.connect('WinnerA');
    const winnerB = await isolated.connect('WinnerB');
    await winnerA.sendFor('joinFinals', { name: 'Alice' }, 'finalsWaiting');
    await winnerA.sendFor('joinFinals', {}, 'finalsWaiting');
    assert.equal(Object.keys(isolated.read('matches2Config.json')).length, 0);
    const waitingA = winnerA.next('finalsMatchAssigned');
    assignmentB = await winnerB.sendFor('joinFinals', {}, 'finalsMatchAssigned');
    assignmentA = await waitingA;
    assert.equal(assignmentA.matchID, assignmentB.matchID);
    assert.notEqual(assignmentA.seat, assignmentB.seat);
    const levels = isolated.read('playerLevels.json');
    assert.equal(levels.WinnerA.pendingFinal, undefined);
    assert.equal(levels.WinnerB.pendingFinal, undefined);
    assert.deepEqual(levels.WinnerA.finalAssignment, assignmentA);
    assert.deepEqual(levels.WinnerB.finalAssignment, assignmentB);
    assert.deepEqual(await winnerA.sendFor('joinFinals', {}, 'finalsMatchAssigned'), assignmentA);
    assert.equal(Object.keys(isolated.read('matches2Config.json')).length, 1);
  });

  await t.test('server restart preserves claims, final assignments, and pending multiplier choices', async () => {
    await isolated.stop();
    await isolated.start();
    alice = await isolated.connect('Alice');
    assert.equal((await alice.request('progression:claimLogin')).code, 'ALREADY_CLAIMED');
    assert.equal((await alice.request('progression:claimMission', { id: 'battle_play_3' })).code, 'ALREADY_CLAIMED');
    const winnerA = await isolated.connect('WinnerA');
    assert.deepEqual(await winnerA.sendFor('joinFinals', {}, 'finalsMatchAssigned'), assignmentA);
    assert.equal(Object.keys(isolated.read('matches2Config.json')).length, 1);
    const choice = await isolated.connect('ChoiceWinner');
    const dashboard = await choice.request('progression:get');
    assert.equal(dashboard.data.pendingMultiplier.choiceId, 'persisted-choice');
    const selected = await choice.request('progression:chooseMultiplier', { name: 'Bob', choiceId: 'persisted-choice', choice: 'replace' });
    assert.equal(selected.ok, true);
    assert.equal(selected.data.profile.multiplier, 2);
    assert.equal(selected.data.pendingMultiplier, null);
    assert.equal((await choice.request('progression:chooseMultiplier', { choiceId: 'persisted-choice', choice: 'replace' })).ok, false);
    const levels = isolated.read('playerLevels.json');
    assert.equal(levels.ChoiceWinner.multiplier, 2);
    assert.equal(levels.Bob.multiplier, 2);
  });
});
