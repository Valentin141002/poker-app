'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { registerProgressionSocket } = require('../lib/progression-sockets');

function fixture({ identified = true, rateLimit = 80, overrides = {} } = {}) {
  const calls = [];
  const handlers = new Map();
  let time = 1000000;
  const socket = { player: identified ? 'Alice' : null, on: (event, handler) => handlers.set(event, handler) };
  const method = (name, result) => (...args) => { calls.push([name, ...args]); return result; };
  const privateProfile = { name: 'Bob', points: 30, rank: 2, friends: ['Private friend'], pendingMultiplier: { choiceId: 'secret' }, unlocked: { frames: ['secret'] } };
  const engine = {
    dashboard: method('dashboard', { profile: { name: 'Alice' }, missions: [] }),
    leaderboard: method('leaderboard', { category: 'global', rows: [privateProfile], me: privateProfile }),
    profile: method('profile', privateProfile),
    claimMission: method('claimMission', { type: 'mission', xp: 100 }),
    claimLogin: method('claimLogin', { type: 'login', xp: 50 }),
    setFriend: method('setFriend', ['Bob']),
    customize: method('customize', { name: 'Alice' }),
    chooseMultiplier: method('chooseMultiplier', { multiplier: 5, choice: 'keep' }),
    ...overrides
  };
  registerProgressionSocket(socket, {
    engine,
    resolveName: socket => socket.player,
    bindIdentity: (socket, payload) => {
      calls.push(['bindIdentity', payload]);
      if (payload.name !== 'Alice' || payload.clientKey !== 'alice-key') {
        const error = new Error('Identité invalide.');
        error.code = 'IDENTITY_CONFLICT';
        throw error;
      }
      socket.player = 'Alice';
    },
    hasPlayer: name => name === 'Bob',
    publish: method('publish', undefined),
    now: () => time,
    rateLimit
  });
  async function request(event, payload = {}) {
    let response;
    await handlers.get(`progression:${event}`)(payload, value => { response = value; });
    return response;
  }
  return { request, calls, handlers, socket, advance: milliseconds => { time += milliseconds; } };
}

test('identification binds the socket before reading its own dashboard', async () => {
  const f = fixture({ identified: false });
  assert.equal((await f.request('get')).code, 'IDENTITY_REQUIRED');
  assert.equal((await f.request('identify', { name: 'Alice', clientKey: 'wrong-key' })).code, 'IDENTITY_CONFLICT');
  assert.equal(f.calls.filter(call => call[0] === 'dashboard').length, 0);
  const response = await f.request('identify', { name: 'Alice', clientKey: 'alice-key' });
  assert.equal(response.ok, true);
  assert.deepEqual(f.calls.at(-1), ['dashboard', 'Alice']);
});

test('all account mutations use the socket actor rather than a supplied account', async () => {
  const f = fixture();
  const requests = [
    ['claimMission', { id: 'battle_win_1', name: 'Mallory' }, ['claimMission', 'Alice', 'battle_win_1']],
    ['claimLogin', { name: 'Mallory' }, ['claimLogin', 'Alice']],
    ['customize', { avatar: 'ace', name: 'Mallory', points: 999999 }, ['customize', 'Alice', { avatar: 'ace' }]],
    ['friend', { name: 'Bob', add: true, player: 'Mallory' }, ['setFriend', 'Alice', 'Bob', true]],
    ['chooseMultiplier', { name: 'Mallory', choiceId: 'wheel:1', choice: 'keep', multiplier: 10 }, ['chooseMultiplier', 'Alice', { choiceId: 'wheel:1', choice: 'keep' }]]
  ];
  for (const [event, payload, expectedCall] of requests) {
    f.calls.length = 0;
    assert.equal((await f.request(event, payload)).ok, true);
    assert.deepEqual(f.calls[0], expectedCall);
    assert.equal(f.calls[1][0], 'publish');
    assert.equal(f.calls[1][1], 'Alice');
    assert.deepEqual(f.calls[2], ['dashboard', 'Alice']);
  }
});

test('claims and reads are unavailable before authoritative identification', async () => {
  const f = fixture({ identified: false });
  for (const [event, payload] of [
    ['get', {}], ['leaderboard', { category: 'global' }], ['profile', { name: 'Bob' }],
    ['claimMission', { id: 'battle_win_1' }], ['claimLogin', {}],
    ['friend', { name: 'Bob' }], ['customize', { avatar: 'ace' }],
    ['chooseMultiplier', { choiceId: 'wheel:1', choice: 'replace' }]
  ]) {
    assert.equal((await f.request(event, payload)).code, 'IDENTITY_REQUIRED');
  }
  assert.equal(f.calls.length, 0);
});

test('replayed reward errors are returned without publishing or mutating twice', async () => {
  let claimCount = 0;
  const f = fixture({ overrides: {
    claimLogin: () => {
      claimCount += 1;
      if (claimCount > 1) {
        const error = new Error('Récompense du jour déjà récupérée.');
        error.code = 'ALREADY_CLAIMED';
        throw error;
      }
      return { type: 'login', xp: 50 };
    }
  } });
  assert.equal((await f.request('claimLogin')).ok, true);
  f.calls.length = 0;
  const response = await f.request('claimLogin');
  assert.equal(response.ok, false);
  assert.equal(response.code, 'ALREADY_CLAIMED');
  assert.match(response.error, /déjà/);
  assert.equal(f.calls.length, 0);
});

test('public profile lookups cannot create arbitrary players or leak private fields', async () => {
  const f = fixture();
  assert.equal((await f.request('profile', { name: 'Unknown' })).code, 'PLAYER_NOT_FOUND');
  assert.equal(f.calls.length, 0);
  const response = await f.request('profile', { name: 'Bob' });
  assert.equal(response.ok, true);
  assert.deepEqual(response.data, { name: 'Bob', points: 30, rank: 2 });
  assert.deepEqual(f.calls, [['profile', 'Bob']]);
  for (const name of ['__proto__', 'constructor', 'prototype', 'A\u0000B']) {
    assert.equal((await f.request('profile', { name })).code, 'INVALID_NAME');
  }
});

test('leaderboard categories use the actor and public rows', async () => {
  const f = fixture();
  const response = await f.request('leaderboard', { category: 'friends', name: 'Mallory' });
  assert.equal(response.ok, true);
  assert.deepEqual(f.calls[0], ['leaderboard', 'Alice', 'friends']);
  assert.deepEqual(response.data.rows, [{ name: 'Bob', points: 30, rank: 2 }]);
  assert.equal(Object.hasOwn(response.data.me, 'friends'), false);
  assert.equal((await f.request('leaderboard', { category: '__proto__' })).code, 'INVALID_CATEGORY');
});

test('malformed payloads and invalid claim inputs fail safely before engine calls', async () => {
  const f = fixture();
  for (const payload of [null, [], 'Alice', 3, true, new Date(), Object.create({})]) {
    assert.equal((await f.request('get', payload)).code, 'INVALID_PAYLOAD');
  }
  assert.equal((await f.request('claimMission', { id: {} })).code, 'INVALID_MISSION');
  assert.equal((await f.request('friend', { name: 'Bob', add: 'false' })).code, 'INVALID_FRIEND');
  assert.equal((await f.request('customize', { points: 100 })).code, 'INVALID_COSMETIC');
  assert.equal((await f.request('chooseMultiplier', { choiceId: 1, choice: 'replace' })).code, 'INVALID_CHOICE');
  assert.equal(f.calls.length, 0);
});

test('rate limit resets after one minute and does not invoke the engine when exceeded', async () => {
  const f = fixture({ rateLimit: 2 });
  assert.equal((await f.request('get')).ok, true);
  assert.equal((await f.request('get')).ok, true);
  assert.equal((await f.request('get')).code, 'RATE_LIMITED');
  assert.equal(f.calls.length, 2);
  f.advance(60000);
  assert.equal((await f.request('get')).ok, true);
  assert.equal(f.calls.length, 3);
});

test('requests support optional acknowledgements and hide unexpected internal errors', async () => {
  const f = fixture({ overrides: { claimLogin: () => { throw new Error('private database path'); } } });
  await f.handlers.get('progression:claimLogin')({});
  const response = await f.request('claimLogin');
  assert.equal(response.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(response.error, /database|path/);
  let readResponse;
  await f.handlers.get('progression:get')(result => { readResponse = result; });
  assert.equal(readResponse.ok, true);
  await f.handlers.get('progression:get')({}, () => { throw new Error('closed callback'); });
});
