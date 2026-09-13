'use strict';

const { createHash } = require('node:crypto');

// All rewards in this module are called from server-owned outcomes. Browser
// payloads may request a claim or a cosmetic; they never supply XP or points.
const DAY_MS = 86400000;
const VERSION = 1;
const MAX_EVENTS = 1000;
const MAX_RECENT_REWARDS = 30;
const MAX_XP = 1000000000;
const MULTIPLIERS = Object.freeze([1, 2, 5, 10]);
const LEGACY_MULTIPLIERS = Object.freeze([1, 2, 3, 5, 10]);
const POINTS = Object.freeze({ tableWin: 30, tableRunnerUp: 10, duelWin: 50, battleWin: 2, levelUp: 10 });
const XP = Object.freeze({ tablePlayed: 40, tableWin: 80, tableRunnerUp: 30, duelPlayed: 30, duelWin: 100, battlePlayed: 20, battleWin: 30, pokerStreak: 50 });
const LOGIN_REWARDS = Object.freeze([50, 75, 100, 125, 150, 200, 300]);
const AVATARS = Object.freeze(['spade', 'diamond', 'crown', 'ace', 'comet', 'shield']);
const TIERS = Object.freeze([
  { level: 1, title: 'Rookie', frame: 'obsidian' },
  { level: 10, title: 'Challenger', frame: 'electric' },
  { level: 25, title: 'Strategist', frame: 'amethyst' },
  { level: 50, title: 'Legend', frame: 'champion' },
  { level: 100, title: 'IMDCX Master', frame: 'legend' }
]);
const MISSIONS = Object.freeze([
  { id: 'battle_play_3', title: 'Dans l’arène', description: 'Jouer 3 batailles réelles', target: 3, xp: 150, counter: 'played' },
  { id: 'battle_win_1', title: 'Première victoire', description: 'Gagner 1 bataille réelle', target: 1, xp: 100, counter: 'wins' },
  { id: 'battle_streak_3', title: 'Série parfaite', description: 'Gagner 3 batailles réelles de suite', target: 3, xp: 300, counter: 'bestStreak' }
]);
const ACHIEVEMENTS = Object.freeze([
  { id: 'first_win', name: 'Premier succès', description: 'Remporter une partie de poker', xp: 100, badge: 'first_win' },
  { id: 'table_champion', name: 'Maître de la table', description: 'Remporter une table de championnat', xp: 100, badge: 'table_champion' },
  { id: 'final_champion', name: 'Champion IMDCX', description: 'Remporter le duel final', xp: 150, badge: 'final_champion', frame: 'victory' },
  { id: 'triple_streak', name: 'Inarrêtable', description: 'Enchaîner 3 victoires de poker', xp: 150, badge: 'triple_streak' },
  { id: 'ten_wins', name: 'Compétiteur', description: 'Remporter 10 nouvelles parties de poker', xp: 250, badge: 'ten_wins' },
  { id: 'multiplier_master', name: 'Puissance dix', description: 'Obtenir un multiplicateur x10', xp: 100, badge: 'multiplier_master' }
]);
const owns = (obj, key) => !!obj && Object.prototype.hasOwnProperty.call(obj, key);
const integer = (value, max = Number.MAX_SAFE_INTEGER) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.floor(value))) : 0;
const validName = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100 && !['__proto__', 'constructor', 'prototype'].includes(value.trim()) && !/[\u0000-\u001f\u007f]/.test(value);
const keyFor = value => validName(value) ? value.trim() : null;
const dayKey = timestamp => new Date(timestamp).toISOString().slice(0, 10);
function weekInfo(timestamp) {
  const date = new Date(timestamp);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return { weekKey: dayKey(date.getTime()), resetAt: date.getTime() + 7 * DAY_MS };
}
function xpForLevel(level) {
  const completed = Math.max(0, integer(level) - 1);
  return 25 * completed * completed + 175 * completed;
}
function levelForXP(xp) {
  return 1 + Math.floor((Math.sqrt(30625 + 100 * integer(xp, MAX_XP)) - 175) / 50);
}
function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}
const clone = value => JSON.parse(JSON.stringify(value));
function emptyGames() { return { table: { played: 0, wins: 0 }, duel: { played: 0, wins: 0 }, battle: { played: 0, wins: 0 } }; }

function createProgression({ getEntries, ensureEntry, save = () => {}, now = () => Date.now() }) {
  if (typeof getEntries !== 'function' || typeof ensureEntry !== 'function') throw new TypeError('getEntries and ensureEntry are required');
  const timestamp = () => now();
  let normalizationPending = false;
  function normalize(entry, name) {
    const time = timestamp();
    const date = dayKey(time);
    const week = weekInfo(time).weekKey;
    const old = entry.progression;
    const p = old && typeof old === 'object' && !Array.isArray(old) ? old : {};
    entry.points = integer(entry.points);
    entry.multiplier = LEGACY_MULTIPLIERS.includes(entry.multiplier) && entry.multiplier > 1 ? entry.multiplier : null;
    entry.needsWheelSpin = entry.needsWheelSpin === true;
    p.version = VERSION;
    p.xp = integer(p.xp, MAX_XP);
    p.currentStreak = integer(p.currentStreak);
    p.bestStreak = Math.max(p.currentStreak, integer(p.bestStreak));
    p.bestMultiplier = Math.max(LEGACY_MULTIPLIERS.includes(p.bestMultiplier) ? p.bestMultiplier : 1, entry.multiplier || 1);
    p.wheelSequence = integer(p.wheelSequence);
    // Legacy playerStatsTable/Match2 count hands, not completed matches. Their
    // historical values stay in the existing statistics view; competition
    // totals start with actual outcomes recorded after this update.
    delete p.statsBaseline;
    const storedGames = p.games && typeof p.games === 'object' ? p.games : emptyGames();
    p.games = emptyGames();
    for (const kind of ['table', 'duel', 'battle']) {
      p.games[kind].played = integer(storedGames[kind] && storedGames[kind].played);
      p.games[kind].wins = Math.min(p.games[kind].played, integer(storedGames[kind] && storedGames[kind].wins));
    }
    p.week = p.week && p.week.key === week ? { key: week, points: integer(p.week.points) } : { key: week, points: 0 };
    const daily = p.daily && p.daily.key === date ? p.daily : {};
    p.daily = {
      key: date, played: integer(daily.played), wins: integer(daily.wins), streak: integer(daily.streak),
      bestStreak: Math.max(integer(daily.bestStreak), integer(daily.streak)),
      claimed: Array.isArray(daily.claimed) ? [...new Set(daily.claimed.filter(id => MISSIONS.some(mission => mission.id === id)))] : []
    };
    const login = p.login && typeof p.login === 'object' ? p.login : {};
    p.login = { lastClaimDay: typeof login.lastClaimDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(login.lastClaimDay) ? login.lastClaimDay : null, streak: integer(login.streak) };
    p.achievements = Array.isArray(p.achievements) ? p.achievements.filter((item, index, items) => item && ACHIEVEMENTS.some(achievement => achievement.id === item.id) && items.findIndex(other => other && other.id === item.id) === index).map(item => ({ id: item.id, at: integer(item.at) })) : [];
    p.friends = Array.isArray(p.friends) ? [...new Set(p.friends.map(keyFor).filter(friend => friend && friend !== name))].slice(0, 100) : [];
    p.seenEvents = Array.isArray(p.seenEvents) ? [...new Set(p.seenEvents.filter(id => typeof id === 'string' && id.length <= 200))].slice(-MAX_EVENTS) : [];
    p.recentRewards = Array.isArray(p.recentRewards) ? p.recentRewards.filter(item => item && typeof item.id === 'string' && typeof item.type === 'string').slice(-MAX_RECENT_REWARDS).map(item => ({
      id: item.id.slice(0, 200), type: item.type.slice(0, 30), kind: typeof item.kind === 'string' ? item.kind : null,
      won: item.won === true, basePoints: integer(item.basePoints), multiplier: LEGACY_MULTIPLIERS.includes(item.multiplier) ? item.multiplier : 1,
      competitivePoints: integer(item.competitivePoints), levelPoints: integer(item.levelPoints), points: integer(item.points), xp: integer(item.xp, MAX_XP),
      previousLevel: Math.max(1, integer(item.previousLevel)), level: Math.max(1, integer(item.level)),
      newAchievements: Array.isArray(item.newAchievements) ? item.newAchievements.filter(id => ACHIEVEMENTS.some(achievement => achievement.id === id)) : [], at: integer(item.at)
    })) : [];
    const pending = p.pendingMultiplier;
    p.pendingMultiplier = pending && typeof pending.choiceId === 'string' && LEGACY_MULTIPLIERS.includes(pending.currentMultiplier) && MULTIPLIERS.includes(pending.newMultiplier) ? { choiceId: pending.choiceId.slice(0, 200), currentMultiplier: pending.currentMultiplier, newMultiplier: pending.newMultiplier } : null;
    const unlocked = cosmetics(p);
    const custom = p.customization && typeof p.customization === 'object' ? p.customization : {};
    p.customization = {
      avatar: AVATARS.includes(custom.avatar) ? custom.avatar : 'spade',
      frame: unlocked.frames.includes(custom.frame) ? custom.frame : 'obsidian',
      title: unlocked.titles.includes(custom.title) ? custom.title : null
    };
    entry.progression = p;
    return entry;
  }
  function flushNormalization() {
    if (!normalizationPending) return;
    save();
    normalizationPending = false;
  }
  function get(name, create = true, persist = true) {
    const key = keyFor(name);
    if (!key) fail('INVALID_NAME', 'Nom de joueur invalide.');
    const entries = getEntries();
    let entry = owns(entries, key) ? entries[key] : null;
    if (!entry && create) entry = ensureEntry(key);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const before = JSON.stringify(entry);
    normalize(entry, key);
    if (before !== JSON.stringify(entry)) normalizationPending = true;
    if (persist) flushNormalization();
    return entry;
  }
  function cosmetics(p) {
    const level = levelForXP(p.xp);
    const tiers = TIERS.filter(tier => level >= tier.level);
    const achievements = ACHIEVEMENTS.filter(item => (p.achievements || []).some(unlocked => unlocked.id === item.id));
    return { avatars: [...AVATARS], frames: [...new Set([...tiers.map(tier => tier.frame), ...achievements.map(item => item.frame).filter(Boolean)])], titles: tiers.map(tier => tier.title), badges: achievements.map(item => item.badge) };
  }
  function publicProfile(name, entry) {
    const p = entry.progression;
    const table = { ...p.games.table };
    const duel = { ...p.games.duel };
    const gamesPlayed = table.played + duel.played;
    const wins = table.wins + duel.wins;
    const level = levelForXP(p.xp);
    const xpInLevel = p.xp - xpForLevel(level);
    const xpToNextLevel = xpForLevel(level + 1) - xpForLevel(level);
    const unlocked = cosmetics(p);
    const tierTitle = unlocked.titles[unlocked.titles.length - 1];
    return {
      name, points: entry.points, weeklyPoints: p.week.points, level, xp: p.xp, xpInLevel, xpToNextLevel,
      xpProgress: Math.min(100, Math.floor(xpInLevel / xpToNextLevel * 100)), title: p.customization.title || tierTitle, tierTitle,
      avatar: p.customization.avatar, frame: p.customization.frame, multiplier: entry.multiplier || 1,
      bestMultiplier: p.bestMultiplier, currentStreak: p.currentStreak, bestStreak: p.bestStreak,
      gamesPlayed, wins, winRate: gamesPlayed ? Math.round(wins / gamesPlayed * 1000) / 10 : 0,
      table, duel, battle: { ...p.games.battle },
      achievements: ACHIEVEMENTS.map(achievement => {
        const earned = p.achievements.find(item => item.id === achievement.id);
        return { ...achievement, unlocked: !!earned, unlockedAt: earned ? earned.at : null };
      }),
      unlocked, friends: [...p.friends]
    };
  }
  function profiles() {
    const entries = getEntries();
    const rows = Object.keys(entries).filter(validName).map(name => {
      const entry = get(name, false, false);
      return entry ? publicProfile(name, entry) : null;
    }).filter(Boolean);
    // A first ranking request can migrate many legacy players. Persist the
    // combined migration once instead of rewriting the file for each player.
    flushNormalization();
    return rows;
  }
  function sortedRows(category, name) {
    const entry = name ? get(name) : null;
    const friends = entry ? entry.progression.friends : [];
    const rows = profiles().filter(row => category !== 'friends' || row.name === name || friends.includes(row.name));
    const pointField = category === 'weekly' ? 'weeklyPoints' : 'points';
    rows.sort((a, b) => b[pointField] - a[pointField] || b.wins - a.wins || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return rows.map((row, index) => ({ ...row, rank: index + 1, isMe: row.name === name }));
  }
  function profile(name) {
    const key = keyFor(name);
    get(name);
    return sortedRows('global', key).find(row => row.name === key);
  }
  function leaderboard(name, category = 'global') {
    if (!['global', 'weekly', 'friends'].includes(category)) fail('INVALID_CATEGORY', 'Classement inconnu.');
    const key = keyFor(name);
    if (!key) fail('INVALID_NAME', 'Nom de joueur invalide.');
    const rows = sortedRows(category, key);
    return { category, ...weekInfo(timestamp()), rows: rows.slice(0, 100), me: rows.find(row => row.name === key) || null };
  }
  function nextLogin(p) {
    const today = dayKey(timestamp());
    const yesterday = dayKey(timestamp() - DAY_MS);
    const claimedToday = p.login.lastClaimDay === today;
    const streak = claimedToday ? Math.max(1, p.login.streak) : p.login.lastClaimDay === yesterday ? p.login.streak + 1 : 1;
    const day = (streak - 1) % LOGIN_REWARDS.length + 1;
    return { day, rewardXp: LOGIN_REWARDS[day - 1], streak, claimable: !claimedToday, claimedToday, rewards: [...LOGIN_REWARDS], resetAt: Date.parse(today) + DAY_MS };
  }
  function dashboard(name) {
    const entry = get(name);
    const p = entry.progression;
    return {
      profile: profile(name), dayKey: p.daily.key, resetAt: Date.parse(p.daily.key) + DAY_MS,
      missions: MISSIONS.map(mission => {
        const progress = Math.min(mission.target, p.daily[mission.counter]);
        const claimed = p.daily.claimed.includes(mission.id);
        const { counter, ...publicMission } = mission;
        return { ...publicMission, progress, completed: progress >= mission.target, claimed, claimable: progress >= mission.target && !claimed };
      }),
      login: nextLogin(p), recentRewards: clone(p.recentRewards).reverse(), pendingMultiplier: p.pendingMultiplier ? { ...p.pendingMultiplier } : null,
      wheelAvailable: entry.needsWheelSpin,
      finalAvailable: !!(entry.pendingFinal || entry.finalAssignment)
    };
  }
  function addPoints(entry, amount) {
    const points = integer(amount);
    const previous = entry.points;
    entry.points = Math.min(Number.MAX_SAFE_INTEGER, previous + points);
    entry.progression.week.points = Math.min(Number.MAX_SAFE_INTEGER, entry.progression.week.points + entry.points - previous);
    return entry.points - previous;
  }
  function award(entry, { id, type, kind = null, won = false, basePoints = 0, multiplier = 1, xp = 0, achievements = [] }) {
    const p = entry.progression;
    const previousLevel = levelForXP(p.xp);
    const previousXP = p.xp;
    const newAchievements = [];
    let earnedXP = xp;
    for (const achievement of ACHIEVEMENTS) {
      if (achievements.includes(achievement.id) && !p.achievements.some(item => item.id === achievement.id)) {
        p.achievements.push({ id: achievement.id, at: timestamp() });
        earnedXP += achievement.xp;
        newAchievements.push(achievement.id);
      }
    }
    p.xp = Math.min(MAX_XP, p.xp + integer(earnedXP, MAX_XP));
    const level = levelForXP(p.xp);
    const competitivePoints = addPoints(entry, basePoints * multiplier);
    const levelPoints = addPoints(entry, (level - previousLevel) * POINTS.levelUp);
    const receipt = { id, type, kind, won, basePoints, multiplier, competitivePoints, levelPoints, points: competitivePoints + levelPoints, xp: p.xp - previousXP, previousLevel, level, newAchievements, at: timestamp() };
    p.recentRewards.push(receipt);
    p.recentRewards = p.recentRewards.slice(-MAX_RECENT_REWARDS);
    return clone(receipt);
  }
  function recordGame(name, { eventId, kind, won = false, runnerUp = false, practice = false, eligible = true } = {}) {
    if (practice || !eligible) return null;
    if (!['table', 'duel', 'battle'].includes(kind)) fail('INVALID_GAME', 'Type de partie invalide.');
    if (typeof eventId !== 'string' || !eventId.trim() || eventId.length > 200) fail('INVALID_EVENT', 'Identifiant de résultat invalide.');
    if (typeof won !== 'boolean' || typeof runnerUp !== 'boolean') fail('INVALID_GAME', 'Résultat de partie invalide.');
    const entry = get(name);
    const p = entry.progression;
    if (p.seenEvents.includes(eventId)) return null;
    p.seenEvents.push(eventId);
    p.seenEvents = p.seenEvents.slice(-MAX_EVENTS);
    p.games[kind].played += 1;
    if (won) p.games[kind].wins += 1;
    let basePoints = 0;
    let xp = 0;
    const multiplier = entry.multiplier || 1;
    const achievements = [];
    if (kind === 'battle') {
      p.daily.played += 1;
      if (won) p.daily.wins += 1;
      p.daily.streak = won ? p.daily.streak + 1 : 0;
      p.daily.bestStreak = Math.max(p.daily.bestStreak, p.daily.streak);
      basePoints = won ? POINTS.battleWin : 0;
      xp = XP.battlePlayed + (won ? XP.battleWin : 0);
    } else {
      p.currentStreak = won ? p.currentStreak + 1 : 0;
      p.bestStreak = Math.max(p.bestStreak, p.currentStreak);
      if (kind === 'table') {
        basePoints = won ? POINTS.tableWin : runnerUp ? POINTS.tableRunnerUp : 0;
        xp = XP.tablePlayed + (won ? XP.tableWin : runnerUp ? XP.tableRunnerUp : 0);
        if (won) achievements.push('table_champion');
      } else {
        delete entry.finalAssignment;
        basePoints = won ? POINTS.duelWin : 0;
        xp = XP.duelPlayed + (won ? XP.duelWin : 0);
        if (won) {
          achievements.push('final_champion');
          entry.needsWheelSpin = true;
        }
      }
      if (won) {
        achievements.push('first_win');
        if (p.currentStreak >= 3) achievements.push('triple_streak');
        if (p.currentStreak > 0 && p.currentStreak % 3 === 0) xp += XP.pokerStreak;
        if (p.games.table.wins + p.games.duel.wins >= 10) achievements.push('ten_wins');
      }
    }
    const receipt = award(entry, { id: eventId, type: 'game', kind, won, basePoints, multiplier, xp, achievements });
    if (kind !== 'battle' && !won) {
      entry.multiplier = null;
      entry.needsWheelSpin = false;
      p.pendingMultiplier = null;
    }
    save();
    return receipt;
  }
  function claimMission(name, id) {
    const mission = MISSIONS.find(item => item.id === id);
    if (!mission) fail('INVALID_MISSION', 'Mission inconnue.');
    const entry = get(name);
    const p = entry.progression;
    if (p.daily.claimed.includes(id)) fail('ALREADY_CLAIMED', 'Récompense déjà récupérée.');
    if (p.daily[mission.counter] < mission.target) fail('NOT_READY', 'Mission encore en cours.');
    p.daily.claimed.push(id);
    const receipt = award(entry, { id: `mission:${p.daily.key}:${id}`, type: 'mission', xp: mission.xp });
    save();
    return receipt;
  }
  function claimLogin(name) {
    const entry = get(name);
    const login = nextLogin(entry.progression);
    if (!login.claimable) fail('ALREADY_CLAIMED', 'Récompense du jour déjà récupérée.');
    const date = dayKey(timestamp());
    entry.progression.login = { lastClaimDay: date, streak: login.streak };
    const receipt = award(entry, { id: `login:${date}`, type: 'login', xp: login.rewardXp });
    save();
    return receipt;
  }
  function spin(name, value) {
    if (!MULTIPLIERS.includes(value)) fail('INVALID_MULTIPLIER', 'Multiplicateur invalide.');
    const entry = get(name);
    const p = entry.progression;
    const previousMultiplier = entry.multiplier || 1;
    if (p.pendingMultiplier || !entry.needsWheelSpin) {
      return { alreadySpun: true, multiplier: p.pendingMultiplier ? p.pendingMultiplier.newMultiplier : previousMultiplier, previousMultiplier, choiceRequired: !!p.pendingMultiplier, choiceId: p.pendingMultiplier ? p.pendingMultiplier.choiceId : null };
    }
    entry.needsWheelSpin = false;
    p.wheelSequence += 1;
    p.bestMultiplier = Math.max(p.bestMultiplier, value);
    const choiceRequired = previousMultiplier > 1 && previousMultiplier !== value;
    const lastWin = [...p.seenEvents].reverse().find(id => id) || `legacy:${timestamp()}`;
    const choiceId = choiceRequired ? `wheel:${createHash('sha256').update(JSON.stringify([p.wheelSequence, lastWin, value])).digest('hex').slice(0, 32)}` : null;
    p.pendingMultiplier = choiceRequired ? { choiceId, currentMultiplier: previousMultiplier, newMultiplier: value } : null;
    if (!choiceRequired) entry.multiplier = value > 1 ? value : null;
    const receipt = value === 10 && !p.achievements.some(item => item.id === 'multiplier_master') ? award(entry, { id: `wheel-reward:${lastWin}`.slice(0, 200), type: 'achievement', achievements: ['multiplier_master'] }) : null;
    save();
    return { multiplier: value, previousMultiplier, choiceRequired, choiceId, alreadySpun: false, receipt };
  }
  function chooseMultiplier(name, { choiceId, choice } = {}) {
    if (!['keep', 'replace'].includes(choice)) fail('INVALID_CHOICE', 'Choix invalide.');
    const entry = get(name);
    const pending = entry.progression.pendingMultiplier;
    if (!pending || typeof choiceId !== 'string' || choiceId !== pending.choiceId) fail('NOT_READY', 'Ce choix de multiplicateur n’est plus disponible.');
    const multiplier = choice === 'keep' ? pending.currentMultiplier : pending.newMultiplier;
    entry.multiplier = multiplier > 1 ? multiplier : null;
    entry.progression.pendingMultiplier = null;
    save();
    return { multiplier, choice, choiceId };
  }
  function setFriend(name, friendName, add = true) {
    const key = keyFor(name);
    const friend = keyFor(friendName);
    if (!key || !friend || key === friend) fail('INVALID_FRIEND', 'Choisissez un autre joueur.');
    if (!owns(getEntries(), friend)) fail('INVALID_FRIEND', 'Joueur introuvable.');
    if (typeof add !== 'boolean') fail('INVALID_FRIEND', 'Action invalide.');
    const entry = get(key);
    const friends = entry.progression.friends;
    if (add && !friends.includes(friend)) {
      if (friends.length >= 100) fail('FRIEND_LIMIT', 'La liste est limitée à 100 joueurs.');
      friends.push(friend);
    } else if (!add) entry.progression.friends = friends.filter(item => item !== friend);
    save();
    return [...entry.progression.friends];
  }
  function customize(name, changes = {}) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) fail('INVALID_COSMETIC', 'Personnalisation invalide.');
    const entry = get(name);
    const available = cosmetics(entry.progression);
    const next = { ...entry.progression.customization };
    for (const [field, value] of Object.entries(changes)) {
      const list = { avatar: available.avatars, frame: available.frames, title: available.titles }[field];
      if (!Array.isArray(list) || !list.includes(value)) fail('INVALID_COSMETIC', 'Cet élément n’est pas disponible.');
      next[field] = value;
    }
    entry.progression.customization = next;
    save();
    return profile(name);
  }
  return { profile, dashboard, leaderboard, recordGame, claimMission, claimLogin, spin, chooseMultiplier, setFriend, customize };
}

module.exports = { createProgression, POINTS, XP, MULTIPLIERS, LEGACY_MULTIPLIERS, LOGIN_REWARDS, MISSIONS, ACHIEVEMENTS, TIERS, AVATARS, MAX_EVENTS, xpForLevel, levelForXP, weekInfo, dayKey };
