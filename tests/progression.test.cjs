'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProgression, POINTS, XP, MAX_EVENTS, LOGIN_REWARDS, xpForLevel, levelForXP, weekInfo } = require('../lib/progression');

function fixture(initial = {}, initialStats = {}) {
  const entries = JSON.parse(JSON.stringify(initial));
  const stats = JSON.parse(JSON.stringify(initialStats));
  let time = Date.parse('2026-09-12T12:00:00Z');
  let saves = 0;
  const dependencies = {
    getEntries: () => entries,
    ensureEntry: name => entries[name] ||= { name, level: 'Q1', points: 0, multiplier: null, needsWheelSpin: false },
    getStats: name => stats[name] || {},
    save: () => { saves += 1; },
    now: () => time
  };
  return { entries, stats, dependencies, engine: createProgression(dependencies), time: value => { time = typeof value === 'number' ? value : Date.parse(value); }, get saves() { return saves; } };
}
const outcome = (eventId, kind = 'table', won = false, options = {}) => ({ eventId, kind, won, ...options });
const hasCode = code => error => error && error.code === code;

test('completed finals clear durable assignments for winners and losers and expose only resumable rewards', () => {
  const f = fixture({
    Alice: { name: 'Alice', finalAssignment: { matchID: 'final-a', seat: 0 } },
    Bob: { name: 'Bob', finalAssignment: { matchID: 'final-a', seat: 1 } }
  });
  assert.equal(f.engine.dashboard('Alice').finalAvailable, true);
  f.engine.recordGame('Alice', outcome('final-a-winner', 'duel', true));
  f.engine.recordGame('Bob', outcome('final-a-loser', 'duel', false));
  const restarted = createProgression(f.dependencies);
  assert.equal(restarted.dashboard('Alice').finalAvailable, false);
  assert.equal(restarted.dashboard('Alice').wheelAvailable, true);
  assert.equal(restarted.dashboard('Bob').finalAvailable, false);
  assert.equal(restarted.dashboard('Bob').wheelAvailable, false);
});

test('legacy levels and points survive; historical hand stats remain separate from completed games', () => {
  const f = fixture({ Alice: { name: 'Alice', level: 'Q4', points: 874, multiplier: 3, credits: 250, needsWheelSpin: false } }, {
    Alice: { gamesPlayed: 32, wins: 17, table: { played: 20, wins: 10 }, duel: { played: 12, wins: 7 } }
  });
  const p = f.engine.profile('Alice');
  assert.equal(p.points, 874);
  assert.equal(p.weeklyPoints, 0);
  assert.equal(p.xp, 0);
  assert.equal(p.level, 1);
  assert.equal(p.gamesPlayed, 0);
  assert.equal(p.wins, 0);
  assert.equal(f.stats.Alice.gamesPlayed, 32);
  assert.equal(f.stats.Alice.wins, 17);
  assert.equal(p.multiplier, 3);
  assert.equal(f.entries.Alice.level, 'Q4');
  assert.equal(f.entries.Alice.credits, 250);
  assert.equal(p.achievements.filter(item => item.unlocked).length, 0);
  assert.equal('credits' in p, false);
  assert.equal('statsBaseline' in p, false);
  const saves = f.saves;
  f.engine.profile('Alice');
  assert.equal(f.saves, saves, 'a normalized read does not write again');
});

test('XP curve has exact boundaries and supports several level crossings', () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 200);
  assert.equal(xpForLevel(3), 450);
  assert.equal(levelForXP(199), 1);
  assert.equal(levelForXP(200), 2);
  assert.equal(levelForXP(449), 2);
  assert.equal(levelForXP(450), 3);
  for (const level of [10, 25, 50, 100, 999]) {
    assert.equal(levelForXP(xpForLevel(level)), level);
    assert.equal(levelForXP(xpForLevel(level) - 1), level - 1);
  }
});

test('table victory pays 30, runner-up pays 10, and elimination pays 0', () => {
  const f = fixture();
  const win = f.engine.recordGame('Winner', outcome('table-1', 'table', true, { runnerUp: true }));
  const runner = f.engine.recordGame('Second', outcome('table-1', 'table', false, { runnerUp: true }));
  const elimination = f.engine.recordGame('Early', outcome('table-1'));
  assert.equal(win.basePoints, 30, 'first and second place bonuses are nonadditive');
  assert.equal(win.competitivePoints, 30);
  assert.equal(runner.competitivePoints, 10);
  assert.equal(elimination.competitivePoints, 0);
  assert.equal(elimination.xp, XP.tablePlayed);
  assert.equal(f.engine.profile('Winner').wins, 1);
});

test('table and final duel victory yield 80 base competitive points and a wheel entitlement', () => {
  const f = fixture();
  const table = f.engine.recordGame('Alice', outcome('table-1', 'table', true));
  const duel = f.engine.recordGame('Alice', outcome('final-1', 'duel', true));
  assert.equal(table.competitivePoints + duel.competitivePoints, 80);
  assert.equal(f.entries.Alice.needsWheelSpin, true);
  assert.equal(f.engine.profile('Alice').currentStreak, 2);
});

test('active multiplier applies to competitive earnings, never level rewards', () => {
  const f = fixture({ Alice: { name: 'Alice', points: 0, multiplier: 10, level: 'Q1' } });
  const receipt = f.engine.recordGame('Alice', outcome('table-1', 'table', true));
  assert.equal(receipt.competitivePoints, 300);
  assert.equal(receipt.levelPoints, (receipt.level - receipt.previousLevel) * POINTS.levelUp);
  assert.equal(f.engine.profile('Alice').points, receipt.competitivePoints + receipt.levelPoints);
  assert.equal(f.engine.profile('Alice').weeklyPoints, receipt.points);
});

test('runner-up receives multiplied points before losing the multiplier; prior points remain', () => {
  const f = fixture({ Alice: { name: 'Alice', points: 100, multiplier: 5 } });
  const receipt = f.engine.recordGame('Alice', outcome('table-1', 'table', false, { runnerUp: true }));
  assert.equal(receipt.competitivePoints, 50);
  assert.equal(f.engine.profile('Alice').points, 150);
  assert.equal(f.engine.profile('Alice').multiplier, 1);
  assert.equal(f.entries.Alice.multiplier, null);
});

test('practice and ineligible outcomes grant nothing and do not create player records', () => {
  const f = fixture();
  assert.equal(f.engine.recordGame('Practice', outcome('p', 'battle', true, { practice: true })), null);
  assert.equal(f.engine.recordGame('Bot', outcome('b', 'table', true, { eligible: false })), null);
  assert.deepEqual(f.entries, {});
  assert.equal(f.saves, 0);
});

test('real battle wins preserve legacy +2 times multiplier and battle losses preserve poker multiplier and streak', () => {
  const f = fixture({ Alice: { name: 'Alice', points: 0, multiplier: 5 } });
  f.engine.recordGame('Alice', outcome('table-1', 'table', true));
  const receipt = f.engine.recordGame('Alice', outcome('battle-1', 'battle', true));
  assert.equal(receipt.competitivePoints, 10);
  f.engine.recordGame('Alice', outcome('battle-2', 'battle', false));
  const p = f.engine.profile('Alice');
  assert.equal(p.multiplier, 5);
  assert.equal(p.currentStreak, 1);
  assert.equal(p.gamesPlayed, 1);
  assert.deepEqual(p.battle, { played: 2, wins: 1 });
});

test('daily missions require real battle activity and a genuinely consecutive daily streak', () => {
  const f = fixture();
  f.engine.recordGame('Alice', outcome('practice', 'battle', true, { practice: true }));
  f.engine.recordGame('Alice', outcome('table', 'table', true));
  assert.equal(f.engine.dashboard('Alice').missions[0].progress, 0);
  f.engine.recordGame('Alice', outcome('b1', 'battle', true));
  f.engine.recordGame('Alice', outcome('b2', 'battle', false));
  f.engine.recordGame('Alice', outcome('b3', 'battle', true));
  f.engine.recordGame('Alice', outcome('b4', 'battle', true));
  let missions = f.engine.dashboard('Alice').missions;
  assert.equal(missions[0].claimable, true);
  assert.equal(missions[1].claimable, true);
  assert.equal(missions[2].progress, 2);
  assert.throws(() => f.engine.claimMission('Alice', 'battle_streak_3'), hasCode('NOT_READY'));
  f.engine.recordGame('Alice', outcome('b5', 'battle', true));
  missions = f.engine.dashboard('Alice').missions;
  assert.equal(missions[2].claimable, true);
  const beforeXP = f.engine.profile('Alice').xp;
  assert.equal(f.engine.claimMission('Alice', 'battle_play_3').xp, 150);
  assert.equal(f.engine.claimMission('Alice', 'battle_win_1').xp, 100);
  assert.equal(f.engine.claimMission('Alice', 'battle_streak_3').xp, 300);
  assert.equal(f.engine.profile('Alice').xp - beforeXP, 550);
  assert.throws(() => f.engine.claimMission('Alice', 'battle_play_3'), hasCode('ALREADY_CLAIMED'));
});

test('daily counters reset at UTC midnight and a prior daily streak cannot complete the new mission', () => {
  const f = fixture();
  f.time('2026-09-12T23:59:59Z');
  f.engine.recordGame('Alice', outcome('b1', 'battle', true));
  f.engine.recordGame('Alice', outcome('b2', 'battle', true));
  f.time('2026-09-13T00:00:00Z');
  f.engine.recordGame('Alice', outcome('b3', 'battle', true));
  const dashboard = f.engine.dashboard('Alice');
  assert.equal(dashboard.dayKey, '2026-09-13');
  assert.equal(dashboard.missions[0].progress, 1);
  assert.equal(dashboard.missions[2].progress, 1);
  assert.equal(dashboard.resetAt, Date.parse('2026-09-14T00:00:00Z'));
});

test('login rewards require explicit claims, persist idempotently and increase across seven UTC days', () => {
  const f = fixture();
  assert.equal(f.engine.dashboard('Alice').profile.xp, 0);
  const start = Date.parse('2026-09-12T12:00:00Z');
  for (let day = 0; day < 7; day++) {
    f.time(start + day * 86400000);
    const login = f.engine.dashboard('Alice').login;
    assert.equal(login.day, day + 1);
    assert.equal(login.rewardXp, LOGIN_REWARDS[day]);
    assert.equal(f.engine.claimLogin('Alice').xp, LOGIN_REWARDS[day]);
    assert.equal(f.engine.dashboard('Alice').login.claimedToday, true);
    assert.throws(() => createProgression(f.dependencies).claimLogin('Alice'), hasCode('ALREADY_CLAIMED'));
  }
  f.time(start + 7 * 86400000);
  assert.equal(f.engine.dashboard('Alice').login.day, 1);
  assert.equal(f.engine.dashboard('Alice').login.streak, 8);
  f.time(start + 9 * 86400000);
  assert.equal(f.engine.dashboard('Alice').login.streak, 1, 'missing a day resets the ladder');
});

test('weekly ranking resets Monday UTC, retains lifetime points and ignores legacy totals', () => {
  const f = fixture({ Alice: { name: 'Alice', points: 5000 }, Bob: { name: 'Bob', points: 10 } });
  f.time('2026-09-13T23:59:59Z');
  f.engine.recordGame('Bob', outcome('b1', 'battle', true));
  let ranking = f.engine.leaderboard('Alice', 'weekly');
  assert.equal(ranking.rows[0].name, 'Bob');
  assert.equal(ranking.weekKey, '2026-09-07');
  assert.equal(ranking.resetAt, Date.parse('2026-09-14T00:00:00Z'));
  f.time('2026-09-14T00:00:00Z');
  ranking = f.engine.leaderboard('Alice', 'weekly');
  assert.equal(ranking.weekKey, '2026-09-14');
  assert.equal(ranking.rows.every(row => row.weeklyPoints === 0), true);
  assert.equal(f.engine.profile('Alice').points, 5000);
  assert.equal(f.engine.profile('Bob').points, 12);
  assert.deepEqual(weekInfo(Date.parse('2026-09-14T23:59:59Z')), { weekKey: '2026-09-14', resetAt: Date.parse('2026-09-21T00:00:00Z') });
});

test('ranking uses deterministic tie ordering and friends categories contain only selected players', () => {
  const f = fixture({ Zoe: { points: 30 }, Bob: { points: 30 }, Alice: { points: 30 }, Charlie: { points: 80 } });
  assert.deepEqual(f.engine.leaderboard('Zoe').rows.map(row => row.name), ['Charlie', 'Alice', 'Bob', 'Zoe']);
  assert.deepEqual(f.engine.leaderboard('Zoe', 'friends').rows.map(row => row.name), ['Zoe']);
  assert.deepEqual(f.engine.setFriend('Zoe', 'Bob', true), ['Bob']);
  assert.deepEqual(f.engine.leaderboard('Zoe', 'friends').rows.map(row => row.name), ['Bob', 'Zoe']);
  f.engine.setFriend('Zoe', 'Bob', false);
  assert.equal(f.engine.leaderboard('Zoe', 'friends').rows.length, 1);
  assert.throws(() => f.engine.setFriend('Zoe', 'Missing', true), hasCode('INVALID_FRIEND'));
  assert.throws(() => f.engine.setFriend('Zoe', 'Zoe', true), hasCode('INVALID_FRIEND'));
});

test('ranking batches legacy migrations rather than saving once for every ranked player', () => {
  const entries = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`Player${index}`, { points: index }]));
  const f = fixture(entries);
  f.engine.leaderboard('Player0');
  assert.equal(f.saves, 2, 'one save for the viewer and one for the remaining migrations');
  f.engine.leaderboard('Player0');
  assert.equal(f.saves, 2);
});

test('recorded outcomes deduplicate across repeated calls and reconstructed engines', () => {
  const f = fixture();
  f.engine.recordGame('Alice', outcome('table-1', 'table', true));
  const before = JSON.stringify(f.entries);
  assert.equal(f.engine.recordGame('Alice', outcome('table-1', 'table', true)), null);
  assert.equal(createProgression(f.dependencies).recordGame('Alice', outcome('table-1', 'duel', true)), null);
  assert.equal(JSON.stringify(f.entries), before);
});

test('persisted event receipts and recent rewards remain bounded', () => {
  const f = fixture();
  for (let i = 0; i < MAX_EVENTS + 5; i++) f.engine.recordGame('Alice', outcome(`b${i}`, 'battle', false));
  assert.equal(f.entries.Alice.progression.seenEvents.length, MAX_EVENTS);
  assert.equal(f.entries.Alice.progression.recentRewards.length, 30);
  assert.equal(f.engine.recordGame('Alice', outcome(`b${MAX_EVENTS + 4}`, 'battle', false)), null);
});

test('spin consumes one entitlement, persists pending choice and rejects stale replacement requests', () => {
  const f = fixture({ Alice: { name: 'Alice', points: 0, multiplier: 5, needsWheelSpin: true } });
  const first = f.engine.spin('Alice', 2);
  assert.equal(first.choiceRequired, true);
  assert.equal(first.previousMultiplier, 5);
  assert.equal(f.engine.profile('Alice').multiplier, 5);
  assert.equal(f.entries.Alice.needsWheelSpin, false);
  const retry = createProgression(f.dependencies).spin('Alice', 10);
  assert.equal(retry.alreadySpun, true);
  assert.equal(retry.multiplier, 2);
  assert.equal(retry.choiceId, first.choiceId);
  assert.throws(() => f.engine.chooseMultiplier('Alice', { choiceId: 'stale', choice: 'replace' }), hasCode('NOT_READY'));
  assert.equal(f.engine.chooseMultiplier('Alice', { choiceId: first.choiceId, choice: 'keep' }).multiplier, 5);
  assert.throws(() => f.engine.chooseMultiplier('Alice', { choiceId: first.choiceId, choice: 'replace' }), hasCode('NOT_READY'));
});

test('wheel supports new x1 outcomes and preserves legacy x3 until replaced or lost', () => {
  const f = fixture({ Alice: { points: 0, multiplier: 3, needsWheelSpin: true } });
  const result = f.engine.spin('Alice', 1);
  assert.equal(result.previousMultiplier, 3);
  assert.equal(result.choiceRequired, true);
  assert.equal(f.engine.chooseMultiplier('Alice', { choiceId: result.choiceId, choice: 'replace' }).multiplier, 1);
  assert.equal(f.entries.Alice.multiplier, null);
  assert.throws(() => f.engine.spin('Alice', 3), hasCode('INVALID_MULTIPLIER'));
  assert.throws(() => f.engine.spin('Alice', '10'), hasCode('INVALID_MULTIPLIER'));
});

test('a new wheel entitlement cannot reuse an old choice token even with a long event identifier', () => {
  const f = fixture({ Alice: { points: 0, multiplier: 5, needsWheelSpin: true } });
  f.engine.recordGame('Alice', outcome('x'.repeat(195) + '1', 'duel', true));
  const first = f.engine.spin('Alice', 2);
  f.engine.chooseMultiplier('Alice', { choiceId: first.choiceId, choice: 'keep' });
  f.engine.recordGame('Alice', outcome('x'.repeat(195) + '2', 'duel', true));
  const second = f.engine.spin('Alice', 2);
  assert.notEqual(first.choiceId, second.choiceId);
  assert.throws(() => f.engine.chooseMultiplier('Alice', { choiceId: first.choiceId, choice: 'replace' }), hasCode('NOT_READY'));
  assert.equal(f.engine.profile('Alice').multiplier, 5);
});

test('poker loss invalidates outstanding wheel choices so old bonuses cannot be restored', () => {
  const f = fixture({ Alice: { points: 0, multiplier: 5, needsWheelSpin: true } });
  const choice = f.engine.spin('Alice', 10);
  f.engine.recordGame('Alice', outcome('table-loss'));
  assert.equal(f.engine.dashboard('Alice').pendingMultiplier, null);
  assert.equal(f.engine.profile('Alice').multiplier, 1);
  assert.throws(() => f.engine.chooseMultiplier('Alice', { choiceId: choice.choiceId, choice: 'keep' }), hasCode('NOT_READY'));
});

test('achievements unlock and award XP once, including frames and best multiplier', () => {
  const f = fixture();
  const win = f.engine.recordGame('Alice', outcome('final1', 'duel', true));
  assert.deepEqual(win.newAchievements.sort(), ['final_champion', 'first_win']);
  const next = f.engine.recordGame('Alice', outcome('final2', 'duel', true));
  assert.deepEqual(next.newAchievements, []);
  assert.equal(next.xp, XP.duelPlayed + XP.duelWin);
  assert.equal(f.engine.profile('Alice').unlocked.frames.includes('victory'), true);
  const spin = f.engine.spin('Alice', 10);
  assert.deepEqual(spin.receipt.newAchievements, ['multiplier_master']);
  assert.equal(f.engine.profile('Alice').bestMultiplier, 10);
  f.engine.recordGame('Alice', outcome('loss', 'duel', false));
  assert.equal(f.engine.profile('Alice').bestMultiplier, 10);
});

test('level milestone cosmetics are derived from XP and locked or external assets cannot be selected', () => {
  const f = fixture();
  f.engine.profile('Alice');
  assert.throws(() => f.engine.customize('Alice', { frame: 'legend' }), hasCode('INVALID_COSMETIC'));
  assert.throws(() => f.engine.customize('Alice', { avatar: 'https://evil.invalid/tracker.png' }), hasCode('INVALID_COSMETIC'));
  assert.throws(() => f.engine.customize('Alice', { points: 1000 }), hasCode('INVALID_COSMETIC'));
  f.entries.Alice.progression.xp = xpForLevel(25);
  const p = f.engine.profile('Alice');
  assert.equal(p.title, 'Strategist');
  assert.deepEqual(p.unlocked.titles, ['Rookie', 'Challenger', 'Strategist']);
  const updated = f.engine.customize('Alice', { avatar: 'crown', frame: 'amethyst', title: 'Challenger' });
  assert.equal(updated.avatar, 'crown');
  assert.equal(updated.frame, 'amethyst');
  assert.equal(updated.title, 'Challenger');
  assert.equal(updated.tierTitle, 'Strategist');
  assert.equal(updated.points, 0, 'reading migrated XP does not re-award historic level rewards');
});

test('malformed numeric progression fields cannot concatenate, go negative or leak arbitrary cosmetics', () => {
  const f = fixture({ Alice: { points: -10, multiplier: '10', level: 'Q2', progression: {
    xp: '99999', bestStreak: -1, bestMultiplier: 999, currentStreak: '5', customization: { avatar: '<script>', frame: 'legend', title: 'Boss' },
    daily: { key: '2026-09-12', played: '100', wins: -3, streak: Infinity }, seenEvents: [null, {}, 10], friends: ['__proto__', 'Alice', 'Bob', 'Bob']
  } } });
  const p = f.engine.profile('Alice');
  assert.equal(p.xp, 0);
  assert.equal(p.points, 0);
  assert.equal(p.multiplier, 1);
  assert.equal(p.currentStreak, 0);
  assert.equal(p.bestMultiplier, 1);
  assert.equal(p.avatar, 'spade');
  assert.equal(p.frame, 'obsidian');
  assert.deepEqual(p.friends, ['Bob']);
  assert.equal(f.engine.dashboard('Alice').missions[0].progress, 0);
  assert.equal(f.entries.Alice.level, 'Q2');
});

test('reserved prototype names and malformed events are rejected before records are created', () => {
  const f = fixture();
  for (const name of ['__proto__', 'constructor', 'prototype', '', 'a\u0000b']) {
    assert.throws(() => f.engine.profile(name), hasCode('INVALID_NAME'));
    assert.throws(() => f.engine.recordGame(name, outcome('id')), hasCode('INVALID_NAME'));
  }
  assert.throws(() => f.engine.recordGame('Alice', outcome('', 'table')), hasCode('INVALID_EVENT'));
  assert.throws(() => f.engine.recordGame('Alice', outcome('id', 'table', 'false')), hasCode('INVALID_GAME'));
  assert.deepEqual(f.entries, {});
  assert.equal({}.progression, undefined);
});

test('public profiles and receipts are detached from mutable stored arrays', () => {
  const f = fixture();
  const receipt = f.engine.recordGame('Alice', outcome('table', 'table', true));
  receipt.newAchievements.length = 0;
  const profile = f.engine.profile('Alice');
  profile.unlocked.frames.push('legend');
  profile.achievements[0].unlocked = false;
  profile.friends.push('Injected');
  assert.equal(f.engine.profile('Alice').friends.length, 0);
  assert.equal(f.engine.profile('Alice').unlocked.frames.includes('legend'), false);
  assert.equal(f.engine.dashboard('Alice').recentRewards[0].newAchievements.length, 2);
});
