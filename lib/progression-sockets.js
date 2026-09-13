'use strict';

// The socket owns the acting identity. Payload names are used only to identify
// a public profile or a friend, never to choose who receives a reward.
const INVALID_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const PUBLIC_FIELDS = Object.freeze([
  'name', 'points', 'weeklyPoints', 'level', 'xp', 'xpInLevel', 'xpToNextLevel',
  'xpProgress', 'title', 'tierTitle', 'avatar', 'frame', 'multiplier',
  'bestMultiplier', 'currentStreak', 'bestStreak', 'gamesPlayed', 'wins',
  'winRate', 'table', 'duel', 'battle', 'achievements', 'rank', 'isMe'
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function validName(value) {
  return typeof value === 'string' && value.trim().length > 0 &&
    value.trim().length <= 100 && !INVALID_NAMES.has(value.trim()) &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function publicProfile(profile) {
  if (!profile || typeof profile !== 'object') return profile;
  return Object.fromEntries(PUBLIC_FIELDS.filter(key =>
    Object.prototype.hasOwnProperty.call(profile, key)
  ).map(key => [key, profile[key]]));
}

/**
 * Register acknowledgement-based progression requests on an existing socket.
 * Identity binding and private pushes are supplied by the application. Engine
 * mutations already persist their state, so this adapter never calls save().
 * hasPlayer must be supplied to look up profiles other than the actor's own.
 */
function registerProgressionSocket(socket, {
  engine, resolveName, bindIdentity, publish = () => {}, hasPlayer = () => false,
  now = () => Date.now(), rateLimit = 80
} = {}) {
  if (!socket || typeof socket.on !== 'function' || !engine ||
      typeof resolveName !== 'function' || typeof bindIdentity !== 'function') {
    throw new TypeError('socket, engine, resolveName and bindIdentity are required');
  }
  const limit = Number.isInteger(rateLimit) && rateLimit > 0 ? rateLimit : 80;
  let windowStarted = now();
  let requestCount = 0;

  function actor() {
    const name = resolveName(socket);
    if (!validName(name)) fail('IDENTITY_REQUIRED', 'Identifiez votre joueur pour continuer.');
    return name.trim();
  }

  function register(event, action) {
    socket.on(`progression:${event}`, async (payload, acknowledgement) => {
      if (typeof payload === 'function' && acknowledgement === undefined) {
        acknowledgement = payload;
        payload = undefined;
      }
      const respond = typeof acknowledgement === 'function' ? acknowledgement : () => {};
      let response;
      try {
        const time = now();
        if (time - windowStarted >= 60000 || time < windowStarted) {
          windowStarted = time;
          requestCount = 0;
        }
        requestCount += 1;
        if (requestCount > limit) fail('RATE_LIMITED', 'Trop de demandes. Réessayez dans un instant.');
        if (payload === undefined) payload = {};
        if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
            ![Object.prototype, null].includes(Object.getPrototypeOf(payload))) {
          fail('INVALID_PAYLOAD', 'Demande invalide.');
        }
        response = { ok: true, data: await action(payload) };
      } catch (error) {
        const hasCode = error && typeof error.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code);
        response = {
          ok: false,
          code: hasCode ? error.code : 'INTERNAL_ERROR',
          error: hasCode && typeof error.message === 'string' ? error.message.slice(0, 240) :
            'La progression est momentanément indisponible. Réessayez.'
        };
      }
      // An acknowledgement is optional. No private dashboard is emitted to a
      // shared room, and exceptions from an abandoned callback cannot escape.
      try { respond(response); } catch (_) { /* Client acknowledgement closed. */ }
    });
  }

  async function updated(name, receipt = null) {
    await publish(name, receipt);
    return engine.dashboard(name);
  }

  register('identify', async payload => {
    await bindIdentity(socket, payload);
    return engine.dashboard(actor());
  });

  register('get', () => engine.dashboard(actor()));

  register('leaderboard', payload => {
    const name = actor();
    const category = payload.category === undefined ? 'global' : payload.category;
    if (!['global', 'weekly', 'friends'].includes(category)) {
      fail('INVALID_CATEGORY', 'Classement inconnu.');
    }
    const ranking = engine.leaderboard(name, category);
    return {
      ...ranking,
      rows: ranking.rows.map(publicProfile),
      me: publicProfile(ranking.me)
    };
  });

  register('profile', payload => {
    const name = actor();
    const requested = payload.name === undefined ? name : payload.name;
    if (!validName(requested)) fail('INVALID_NAME', 'Nom de joueur invalide.');
    const target = requested.trim();
    if (target !== name && !hasPlayer(target)) fail('PLAYER_NOT_FOUND', 'Joueur introuvable.');
    const profile = engine.profile(target);
    if (!profile) fail('PLAYER_NOT_FOUND', 'Joueur introuvable.');
    return publicProfile(profile);
  });

  register('claimMission', payload => {
    const name = actor();
    if (typeof payload.id !== 'string' || !payload.id || payload.id.length > 100) {
      fail('INVALID_MISSION', 'Mission inconnue.');
    }
    return updated(name, engine.claimMission(name, payload.id));
  });

  register('claimLogin', () => {
    const name = actor();
    return updated(name, engine.claimLogin(name));
  });

  register('friend', payload => {
    const name = actor();
    if (!validName(payload.name) || (payload.add !== undefined && typeof payload.add !== 'boolean')) {
      fail('INVALID_FRIEND', 'Demande d’ami invalide.');
    }
    engine.setFriend(name, payload.name.trim(), payload.add === undefined ? true : payload.add);
    return updated(name);
  });

  register('customize', payload => {
    const name = actor();
    const changes = {};
    for (const field of ['avatar', 'frame', 'title']) {
      if (Object.prototype.hasOwnProperty.call(payload, field)) changes[field] = payload[field];
    }
    if (Object.keys(changes).length === 0) fail('INVALID_COSMETIC', 'Choisissez un élément à personnaliser.');
    engine.customize(name, changes);
    return updated(name);
  });

  register('chooseMultiplier', payload => {
    const name = actor();
    if (typeof payload.choiceId !== 'string' || !payload.choiceId || payload.choiceId.length > 200 ||
        !['keep', 'replace'].includes(payload.choice)) {
      fail('INVALID_CHOICE', 'Choix de multiplicateur invalide.');
    }
    return updated(name, engine.chooseMultiplier(name, { choiceId: payload.choiceId, choice: payload.choice }));
  });
}

module.exports = { registerProgressionSocket };
