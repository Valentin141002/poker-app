'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class DemoClient {
  constructor(port) {
    this.state = null;
    this.states = [];
    this.acks = new Map();
    this.waiters = new Set();
    this.sequence = 0;
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/socket.io/?EIO=4&transport=websocket&demo=1`);
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket handshake timeout')), 6000);
      this.ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Socket failed')); });
      this.ws.addEventListener('message', event => {
        const frame = String(event.data);
        if (frame.startsWith('0')) this.ws.send('40');
        else if (frame === '2') this.ws.send('3');
        else if (frame.startsWith('40')) { clearTimeout(timer); resolve(); }
        else if (frame.startsWith('42')) {
          const [name, packet] = JSON.parse(frame.slice(frame.indexOf('[')));
          const state = name === 'updateTable' ? packet
            : ['startGame', 'updateMatch2'].includes(name) ? packet.gameState : null;
          if (!state?.demo) return;
          this.state = state;
          this.states.push(state);
          for (const waiter of this.waiters) {
            if (!waiter.predicate(state)) continue;
            clearTimeout(waiter.timer);
            this.waiters.delete(waiter);
            waiter.resolve(state);
          }
        } else if (frame.startsWith('43')) {
          const match = /^43(\d+)(\[.*)$/s.exec(frame);
          const ack = match && this.acks.get(Number(match[1]));
          if (!ack) return;
          clearTimeout(ack.timer);
          this.acks.delete(Number(match[1]));
          ack.resolve(JSON.parse(match[2])[0]);
        }
      });
    });
  }

  request(name, payload = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`No acknowledgement: ${name}`)), 6000);
      this.acks.set(id, { resolve, timer });
      this.ws.send(`42${id}${JSON.stringify([name, payload])}`);
    });
  }

  send(name, payload) { this.ws.send(`42${JSON.stringify([name, payload])}`); }

  waitFor(predicate, timeout = 16000) {
    if (this.state && predicate(this.state)) return Promise.resolve(this.state);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`State timeout: ${predicate}; last=${JSON.stringify(this.state)}`));
      }, timeout);
      this.waiters.add(waiter);
    });
  }

  close() {
    this.ws.close();
    for (const ack of this.acks.values()) clearTimeout(ack.timer);
    for (const waiter of this.waiters) clearTimeout(waiter.timer);
  }
}

async function isolatedServer(t) {
  // Only source code is copied. Fixtures never read the user's live databases.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'imdcx-hand-cycle-'));
  fs.copyFileSync(path.join(root, 'server.js'), path.join(directory, 'server.js'));
  fs.cpSync(path.join(root, 'lib'), path.join(directory, 'lib'), { recursive: true });
  const clients = [];
  let server;
  t.after(async () => {
    clients.forEach(client => client.close());
    if (server && server.exitCode === null && !server.signalCode) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill();
      await exited;
    }
    const resolved = fs.realpathSync(directory);
    assert.equal(path.dirname(resolved).toLowerCase(), fs.realpathSync(os.tmpdir()).toLowerCase());
    assert.ok(path.basename(resolved).startsWith('imdcx-hand-cycle-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  });
  const boot = `const http = require('node:http');
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(...args) {
      this.once('listening', () => process.send(this.address().port));
      return listen.apply(this, args);
    };
    require(process.argv[1]);`;
  server = spawn(process.execPath, ['-e', boot, path.join(directory, 'server.js')], {
    cwd: directory, windowsHide: true,
    env: { ...process.env, PORT: '0', NODE_PATH: path.join(root, 'node_modules'),
      ADMIN_FIXED_SCOPE: '', ADMIN_GATEWAY_TOKEN: '', ADMIN_SCOPE_HOST_MAP: '' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  let logs = '';
  server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
  server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-12000); });
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server timeout: ${logs}`)), 15000);
    server.once('message', value => { clearTimeout(timer); resolve(value); });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Server exited ${code}: ${logs}`)); });
  });
  return async seats => {
    const client = new DemoClient(port);
    clients.push(client);
    await client.ready;
    assert.equal((await client.request('demo:start', { seats })).ok, true);
    await client.waitFor(state => state.players.length === seats);
    return client;
  };
}

const token = state => ({ demoRoomID: state.demoRoomID, demoRound: state.roundNumber });
const decision = (state, extra) => ({ ...token(state), demoRevision: state.demoRevision,
  demoSeat: state.current_bettor_index, ...extra });
const chips = state => state.pot + state.players.reduce((sum, player) => sum + player.bankroll, 0);

async function completeHand(client, hideUntilOne = false) {
  for (let count = 0; client.state.phase !== 'reveal' && count < 100; count++) {
    const state = client.state;
    const actor = state.players[state.current_bettor_index];
    client.send('playerAction', decision(state, { type: state.current_bet > actor.subtotal_bet ? 'call' : 'check' }));
    await client.waitFor(next => next.demoRevision > state.demoRevision);
  }
  assert.equal(client.state.phase, 'reveal');
  while (!client.state.revealSeqDone) {
    const state = client.state;
    const seat = state.revealSeq.activeSeat;
    client.send('revealChoice', decision(state, { demoSeat: seat, hide: hideUntilOne }));
    await client.waitFor(next => next.revealSeqDone || next.revealSeq?.activeSeat !== seat);
  }
  return client.waitFor(state => state.roundEvaluated && state.revealSeqDone);
}

function assertNewHand(previous, state, seats) {
  assert.equal(state.roundNumber, previous.roundNumber + 1);
  assert.equal(state.phase, 'preflop');
  assert.notEqual(state.dealerIndex, previous.dealerIndex);
  assert.equal(chips(state), seats * 20000);
  assert.equal(state.roundEvaluated, false);
  assert.equal(state.revealSeqDone, false);
  assert.equal(state.revealSeq, null);
  assert.equal(state.revealWinnerDeadline, null);
  assert.ok(!state.demoRunningOut && !state.timeFrozen && !state.gameFinished);
  assert.ok(state.players.every(player => !player.revealStatus && player.status !== 'WINNER'));
  assert.equal(new Set(state.players.flatMap(player => [player.carda, player.cardb]).concat(state.board)).size, seats * 2 + 5);
}

test('demo hands use the server lifecycle and cannot advance twice', { timeout: 80000, concurrency: true }, async t => {
  const connect = await isolatedServer(t);
  await Promise.all([2, 10].map(seats => t.test(`${seats} seats: show, hide, automatic next and manual race`, async () => {
    const client = await connect(seats);
    for (const hideUntilOne of [false, true]) {
      const completed = await completeHand(client, hideUntilOne);
      assert.equal(chips(completed), seats * 20000);
      assert.ok(completed.players.some(player => player.status === 'WINNER'));
      const next = await client.waitFor(state => state.roundNumber > completed.roundNumber);
      assertNewHand(completed, next, seats);
      assert.equal(next.demoRoomID, completed.demoRoomID, 'automatic next uses the same room and engine');
    }

    // Complete another hand, then use the existing manual shortcut while its
    // automatic winner timer is armed. Replaying that click must not skip a hand.
    const completed = await completeHand(client);
    const request = token(completed);
    assert.equal((await client.request('demo:next', request)).ok, true);
    const next = await client.waitFor(state => state.demoRoomID !== completed.demoRoomID);
    assertNewHand(completed, next, seats);
    assert.equal((await client.request('demo:next', request)).ok, false);
    assert.equal((await client.request('demo:restart', request)).ok, false);
    assert.equal((await client.request('demo:next')).ok, false, 'an unversioned click cannot advance a hand');

    // Old betting/reveal callbacks and the canceled winner timer cannot touch
    // the replacement room. Leave more than the real ten-second winner delay.
    client.send('playerAction', decision(completed, { type: 'fold' }));
    client.send('revealChoice', decision(completed, { demoSeat: 0, hide: true }));
    await delay(10500);
    assert.equal(client.state.demoRoomID, next.demoRoomID);
    assert.equal(client.state.roundNumber, next.roundNumber);
    assert.equal(client.state.demoRevision, next.demoRevision);
    assert.equal(client.state.phase, 'preflop');

    const actor = next.players[next.current_bettor_index];
    client.send('playerAction', decision(next, { type: next.current_bet > actor.subtotal_bet ? 'call' : 'check' }));
    await client.waitFor(state => state.demoRevision > next.demoRevision);
    assert.equal(chips(client.state), seats * 20000, 'normal betting resumes');
    assert.equal((await client.request('demo:quit')).ok, true);
    const packets = client.states.length;
    await delay(500);
    assert.equal(client.states.length, packets, 'quit leaves no emitting timer');
    client.close();
  })));
});
