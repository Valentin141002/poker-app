// server.js
const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const http      = require('http');
const socketIo  = require('socket.io');
const crypto    = require('crypto');
const { Hand }  = require('pokersolver');
const { createProgression } = require('./lib/progression');
const { registerProgressionSocket } = require('./lib/progression-sockets');
const { createCompetitiveSettlement } = require('./lib/competitive-settlement');
const { registerDemoController } = require('./lib/demo-controller');
const levelsFile    = path.join(__dirname, 'playerLevels.json');
const DEFAULT_CREDITS = 60;
const DEFAULT_TIME_CREDITS = 10;

// Buffers d'attente
const waitingTables = {};   // tableID -> array de longueur 10
const waitingMatch2 = {};   // matchID -> array de longueur 2
let playerLevels   = {};

// ──────────────────────────────────────────────────────────────
// 0) Initialise Express
// ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ─────────────────────────────────────────
// ROUTES HTTP — ORDONNANCEMENT CORRECT
// ─────────────────────────────────────────

// ——— DIAGNOSTIC (tout en haut) ———
app.get('/__health', (_req, res) => {
  res.set('Cache-Control','no-store');
  res.json({ ok:true, time: Date.now() });
});

app.get('/__whereis_admin', (_req, res) => {
  const cand = [
    path.join(__dirname,'admin'),
    path.join(__dirname,'admin-app'),
    path.join(__dirname,'admin','dist'),
    path.join(__dirname,'admin-app','dist'),
    path.join(__dirname,'public','admin'),
  ];
  const found = [];
  for (const d of cand) {
    if (!fs.existsSync(d)) continue;
    const idx = ['index.html','admin.html'].find(f => fs.existsSync(path.join(d,f)));
    if (idx) {
      const s = fs.statSync(path.join(d, idx));
      found.push({ dir:d, entry:idx, bytes:s.size });
    }
  }
  res.set('Cache-Control','no-store');
  res.json({ found });
});

// =====================================================
// ADMIN : sert ./admin-app/admin.html et ses JS
// =====================================================
// ADMIN : sert ./admin-app/admin.html et ses JS
app.use('/admin', express.static(path.join(__dirname, 'admin-app')));

// /admin, /admin/ → admin.html
// (mais PAS /admin/getTables, /admin/getMatches2, etc.)
app.get(['/admin', '/admin/'], (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin-app', 'admin.html'));
});

app.get('/admin/:scope(q0|q1|q2|t1|t2|t3|t4)', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-app', 'admin.html'));
});

app.get('/admin/runtime-config', (req, res) => {
  const scopeCfg = getAdminScopeFromReq(req);
  res.json({
    scope: scopeCfg.key,
    label: scopeCfg.label,
    permissions: scopeCfg.permissions,
    levels: scopeCfg.levels,
    modes: scopeCfg.modes,
    fixedByEnv: HAS_ADMIN_FIXED_SCOPE
  });
});

// ——— FRONT DU JEU (statiques ensuite) ———
app.use('/static', express.static(path.join(__dirname, 'poker-app', 'static')));
app.use(express.static(path.join(__dirname, 'poker-app')));

// ──────────────────────────────────────────────────────────────
// 1) HTTP + Socket.IO setup
// ──────────────────────────────────────────────────────────────
const server = http.createServer(app);
const io     = socketIo(server);

function isSocketConnected(id) {
  return Boolean(id && io.sockets && io.sockets.sockets && io.sockets.sockets.get(id));
}

// ──────────────────────────────────────────────────────────────
// 2) Blinds configuration par mode
// ──────────────────────────────────────────────────────────────
const BLINDS = {
  beginner:   { SB: 5,     BB: 10     },
  normal:     { SB: 50,    BB: 100    },
  turbo:      { SB: 500,   BB: 1000   },
  highroller: { SB: 5000,  BB: 10000  },
  hyper:      { SB: 0,     BB: 0      }
};
// Hyper timing sync:
// start hand -> +3s all-in seats + hole-card reveal -> board starts right after reveal cinematic.
const HYPER_ALLIN_START_DELAY_MS = 3000;
const HYPER_BOARD_START_DELAY_MS = 7500;

const ADMIN_SCOPES = {
  main: {
    key: 'main',
    label: 'Admin principal',
    levels: ['Q0', 'Q1', 'Q2', 'T1', 'T2', 'T3', 'T4'],
    modes: Object.keys(BLINDS),
    permissions: {
      profiles: true,
      levels: true,
      credits: true,
      spectate: true,
      details: true,
      deleteRooms: true,
      gamesHistory: true
    }
  },
  q0: {
    key: 'q0',
    label: 'Admin Q0',
    levels: ['Q0'],
    modes: ['beginner', 'normal', 'turbo', 'highroller', 'hyper'],
    permissions: { profiles: false, levels: false, credits: false, spectate: false, details: false, deleteRooms: true, gamesHistory: false }
  },
  q1: {
    key: 'q1',
    label: 'Admin Q1',
    levels: ['Q1'],
    modes: ['turbo', 'highroller', 'hyper'],
    permissions: { profiles: false, levels: false, credits: false, spectate: false, details: false, deleteRooms: true, gamesHistory: false }
  },
  q2: {
    key: 'q2',
    label: 'Admin Q2',
    levels: ['Q2'],
    modes: ['turbo', 'highroller', 'hyper'],
    permissions: { profiles: false, levels: false, credits: false, spectate: false, details: false, deleteRooms: true, gamesHistory: false }
  },
  t1: {
    key: 't1',
    label: 'Admin T1',
    levels: ['T1'],
    modes: ['turbo'],
    permissions: { profiles: false, levels: false, credits: false, spectate: false, details: false, deleteRooms: true, gamesHistory: false }
  },
  t2: {
    key: 't2',
    label: 'Admin T2',
    levels: ['T2'],
    modes: ['turbo'],
    permissions: { profiles: false, levels: false, credits: false, spectate: false, details: false, deleteRooms: true, gamesHistory: false }
  },
  t3: {
    key: 't3',
    label: 'Admin T3',
    levels: ['T3'],
    modes: ['turbo'],
    permissions: { profiles: false, levels: false, credits: false, spectate: false, details: false, deleteRooms: true, gamesHistory: false }
  },
  t4: {
    key: 't4',
    label: 'Admin T4',
    levels: ['T4'],
    modes: ['turbo'],
    permissions: { profiles: false, levels: false, credits: false, spectate: false, details: false, deleteRooms: true, gamesHistory: false }
  }
};

const ADMIN_FIXED_SCOPE_ENV_RAW = String(process.env.ADMIN_FIXED_SCOPE || '').trim().toLowerCase();
const HAS_ADMIN_FIXED_SCOPE = Boolean(ADMIN_FIXED_SCOPE_ENV_RAW);
const ADMIN_GATEWAY_TOKEN = String(process.env.ADMIN_GATEWAY_TOKEN || '').trim();

function parseAdminScopeHostMap(raw) {
  const map = {};
  const txt = String(raw || '').trim();
  if (!txt) return map;
  try {
    const parsed = JSON.parse(txt);
    if (parsed && typeof parsed === 'object') {
      for (const [host, scope] of Object.entries(parsed)) {
        map[String(host).toLowerCase()] = String(scope || '').toLowerCase();
      }
      return map;
    }
  } catch {}
  txt.split(',').forEach(entry => {
    const [host, scope] = entry.split(':');
    if (!host || !scope) return;
    map[String(host).trim().toLowerCase()] = String(scope).trim().toLowerCase();
  });
  return map;
}

const ADMIN_SCOPE_HOST_MAP = parseAdminScopeHostMap(process.env.ADMIN_SCOPE_HOST_MAP);

// ──────────────────────────────────────────────────────────────
// 3) Persistence fichiers & helpers (séparés par type de partie)
// ──────────────────────────────────────────────────────────────
const tablesFile       = path.join(__dirname, 'tablesConfig.json');
const statsTableFile   = path.join(__dirname, 'playerStatsTable.json');
const statsMatch2File  = path.join(__dirname, 'playerStatsMatch2.json');
const gamesFile        = path.join(__dirname, 'gamesHistory.json');
const matches2File     = path.join(__dirname, 'matches2Config.json');
// timers par table/match
const turnTimersByTable   = {};
const turnTimersByMatch2  = {};
const revealTimersByRoom  = {};
// pour stocker les timers de chaque table / de chaque match2
const sosChatByClient = new Map();


let tablesConfig    = {};
let statsTable      = {};
let statsMatch2     = {};
let gamesHistory    = [];
let matches2Config  = {};

try { tablesConfig   = JSON.parse(fs.readFileSync(tablesFile,      'utf8')); } catch {}
try { statsTable     = JSON.parse(fs.readFileSync(statsTableFile,  'utf8')); } catch {}
try { statsMatch2    = JSON.parse(fs.readFileSync(statsMatch2File, 'utf8')); } catch {}
try { gamesHistory   = JSON.parse(fs.readFileSync(gamesFile,       'utf8')); } catch {}
try { matches2Config = JSON.parse(fs.readFileSync(matches2File,    'utf8')); } catch {}
try {
  playerLevels = JSON.parse(fs.readFileSync(levelsFile, 'utf8'));
} catch {
  playerLevels = {};
}

// --------- Page de fin (affichée au client) ----------
function renderEndArcade(opts = {}) {
  let title    = 'IMDCX';
  let subtitle = '';
  let message  = '';

  if (typeof opts === 'string') {
    subtitle = opts;
  } else if (opts && typeof opts === 'object') {
    if (opts.title)    title    = String(opts.title);
    if (opts.subtitle) subtitle = String(opts.subtitle);
    if (opts.message)  message  = String(opts.message);
  }

  return `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${title}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    html,body{margin:0;padding:0;height:100%;background:#000814;color:#e9f5ff;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;}
    .wrap{min-height:100%;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 20%,#00f7ff33 0,#000814 60%);}
    .card{padding:32px 40px;border-radius:24px;border:2px solid #00f7ff;box-shadow:0 0 40px #00f7ff55;background:rgba(4,12,30,0.95);max-width:520px;text-align:center;}
    h1{margin:0 0 16px;font-size:28px;letter-spacing:0.08em;text-transform:uppercase;color:#00f7ff;text-shadow:0 0 12px #00f7ffaa;}
    h2{margin:0 0 12px;font-size:18px;color:#a7c7ff;}
    p{margin:0 0 8px;font-size:15px;line-height:1.5;color:#dbe8ff;}
    .btn{margin-top:18px;display:inline-block;padding:10px 22px;border-radius:999px;border:1px solid #00f7ff;color:#00111f;background:#00f7ff;text-decoration:none;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;font-size:13px;}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>${title}</h1>
      ${subtitle ? `<h2>${subtitle}</h2>` : ''}
      ${message ? `<p>${message}</p>` : '<p>La partie est terminée.</p>'}
    </div>
  </div>
</body>
</html>`;
}

function displayPlayerLabel(player) {
  const seat = Number.isInteger(player?.seat) ? player.seat : null;
  return seat === null ? 'Player' : `Player ${seat + 1}`;
}

function sendEndPage(socket, mode, title, message) {
  const html = renderEndArcade({
    title: 'IMDCX',
    subtitle: title,
    message: message
  });
  socket.emit('endPage', { mode, html });
}

// Ré-initialisation des profils existants pour s'assurer que
// tous les modes existent dans chaque statsTable et statsMatch2
Object.values(statsTable).forEach(p => {
  p.byMode = p.byMode || {};
  Object.keys(BLINDS).forEach(mode => {
    if (!p.byMode[mode]) p.byMode[mode] = { played: 0, wins: 0 };
  });
});
Object.values(statsMatch2).forEach(p => {
  p.byMode = p.byMode || {};
  Object.keys(BLINDS).forEach(mode => {
    if (!p.byMode[mode]) p.byMode[mode] = { played: 0, wins: 0 };
  });
});

function saveTables()      { fs.writeFileSync(tablesFile,      JSON.stringify(tablesConfig,   null, 2), 'utf8'); }
function saveStatsTable()  { fs.writeFileSync(statsTableFile,  JSON.stringify(statsTable,     null, 2), 'utf8'); }
function saveStatsMatch2() { fs.writeFileSync(statsMatch2File, JSON.stringify(statsMatch2,    null, 2), 'utf8'); }
function saveGames()       { fs.writeFileSync(gamesFile,       JSON.stringify(gamesHistory,   null, 2), 'utf8'); }
function saveMatches2()    { fs.writeFileSync(matches2File,    JSON.stringify(matches2Config, null, 2), 'utf8'); }
function saveLevels() {
  const temporary = `${levelsFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(playerLevels, null, 2), 'utf8');
  fs.renameSync(temporary, levelsFile);
}

const LEVEL_STAGES = ['Q1', 'Q2', 'T1', 'T2', 'T3', 'T4', 'PASS_T5'];
const CREDIT_LEVELS = ['Q1', 'Q2', 'T1', 'T2', 'T3', 'T4'];
const LEVEL_LABELS = { PASS_T5: 'Passage en T5' };

function isTrainingLevel(level) {
  return String(level || '').trim().toUpperCase() === 'Q0';
}

function formatLevelLabel(level) {
  const key = String(level || '').trim().toUpperCase();
  return LEVEL_LABELS[key] || key || 'Q1';
}

function normalizeLevel(level) {
  if (typeof level === 'number' && Number.isFinite(level)) {
    const idx = Math.max(0, Math.min(LEVEL_STAGES.length - 1, Math.floor(level)));
    return LEVEL_STAGES[idx];
  }
  const raw = String(level || '').trim();
  if (!raw) return 'Q1';
  const upper = raw.toUpperCase();
  if (upper === 'T5' || upper === 'PASSAGE EN T5' || upper === 'PASSAGE EN T5 ') return 'PASS_T5';
  if (LEVEL_STAGES.includes(upper)) return upper;
  return 'Q1';
}

function normalizeCreditLevel(level) {
  const raw = String(level || '').trim().toUpperCase();
  if (raw === 'Q0') return 'Q0';
  return CREDIT_LEVELS.includes(raw) ? raw : 'Q1';
}

function normalizeAdminScopeKey(scope) {
  const key = String(scope || '').trim().toLowerCase();
  return ADMIN_SCOPES[key] ? key : 'main';
}

function getFixedAdminScopeConfig() {
  if (!HAS_ADMIN_FIXED_SCOPE) return null;
  return getAdminScopeConfig(ADMIN_FIXED_SCOPE_ENV_RAW);
}

function normalizeHostHeader(host) {
  return String(host || '').trim().toLowerCase().replace(/:\d+$/, '');
}

function inferAdminScopeKeyFromHost(host) {
  const normalizedHost = normalizeHostHeader(host);
  if (!normalizedHost) return null;

  const mapped = ADMIN_SCOPE_HOST_MAP[normalizedHost];
  if (mapped && ADMIN_SCOPES[mapped]) return mapped;

  const firstLabel = normalizedHost.split('.')[0] || '';
  const candidates = [
    firstLabel,
    firstLabel.replace(/-admin$/, ''),
    firstLabel.replace(/^admin-/, '')
  ];
  for (const candidate of candidates) {
    if (ADMIN_SCOPES[candidate]) return candidate;
  }
  return null;
}

function getTrustedGatewayScopeFromHeaders(headers) {
  if (!ADMIN_GATEWAY_TOKEN) return null;
  const token = String(headers?.['x-admin-gateway-token'] || '').trim();
  if (!token || token !== ADMIN_GATEWAY_TOKEN) return null;
  const scope = String(headers?.['x-admin-gateway-scope'] || '').trim().toLowerCase();
  return ADMIN_SCOPES[scope] ? scope : null;
}

function getAdminScopeConfig(scope) {
  return ADMIN_SCOPES[normalizeAdminScopeKey(scope)];
}

function getAdminScopeFromReq(req) {
  const trustedGatewayScope = getTrustedGatewayScopeFromHeaders(req?.headers || {});
  if (trustedGatewayScope) return getAdminScopeConfig(trustedGatewayScope);
  const fixed = getFixedAdminScopeConfig();
  if (fixed) return fixed;
  const hostScope = inferAdminScopeKeyFromHost(req?.headers?.host);
  if (hostScope) return getAdminScopeConfig(hostScope);
  return getAdminScopeConfig(req?.query?.scope || req?.params?.scope);
}

function getAdminScopeFromSocket(socket) {
  return getAdminScopeConfig(socket?.data?.adminScope);
}

function resolveSocketJoinAdminScope(socket, payload = {}) {
  const trustedGatewayScope = getTrustedGatewayScopeFromHeaders(socket?.handshake?.headers || {});
  if (trustedGatewayScope) return getAdminScopeConfig(trustedGatewayScope);
  const fixed = getFixedAdminScopeConfig();
  if (fixed) return fixed;
  const hostScope = inferAdminScopeKeyFromHost(socket?.handshake?.headers?.host);
  if (hostScope) return getAdminScopeConfig(hostScope);
  return getAdminScopeConfig(payload.scope);
}

function isScopeMain(scopeCfg) {
  return (scopeCfg?.key || 'main') === 'main';
}

function scopeAllowsLevel(scopeCfg, level) {
  if (!scopeCfg) return true;
  const normalized = normalizeCreditLevel(level);
  return Array.isArray(scopeCfg.levels) && scopeCfg.levels.includes(normalized);
}

function scopeAllowsMode(scopeCfg, mode) {
  if (!scopeCfg) return true;
  const key = String(mode || '').trim().toLowerCase();
  return Array.isArray(scopeCfg.modes) && scopeCfg.modes.includes(key);
}

function getRoomAdminMeta(roomID) {
  if (tablesConfig[roomID]) {
    const cfg = tablesConfig[roomID];
    return {
      roomID,
      type: 'table',
      level: normalizeCreditLevel(cfg.level),
      mode: String(cfg.mode || '').trim().toLowerCase()
    };
  }
  if (matches2Config[roomID]) {
    const cfg = matches2Config[roomID];
    return {
      roomID,
      type: 'match2',
      level: normalizeCreditLevel(cfg.level),
      mode: String(cfg.mode || '').trim().toLowerCase()
    };
  }
  return null;
}

function ensureMainAdminHttp(req, res, featureLabel) {
  const scopeCfg = getAdminScopeFromReq(req);
  if (isScopeMain(scopeCfg)) return scopeCfg;
  res.status(403).json({ error: `${featureLabel} reserve a l'admin principal.` });
  return null;
}

function ensureScopeCanCreate(scopeCfg, { level, mode }) {
  if (!scopeAllowsLevel(scopeCfg, level)) {
    return { ok: false, error: `Niveau ${normalizeCreditLevel(level)} non autorise pour ${scopeCfg.label}.` };
  }
  if (!scopeAllowsMode(scopeCfg, mode)) {
    return { ok: false, error: `Mode ${String(mode || '')} non autorise pour ${scopeCfg.label}.` };
  }
  return { ok: true };
}

function ensureScopeCanManageRoom(scopeCfg, roomID) {
  const meta = getRoomAdminMeta(roomID);
  if (!meta) return { ok: false, error: 'Partie introuvable.' };
  if (!scopeAllowsLevel(scopeCfg, meta.level)) {
    return { ok: false, error: `Acces refuse (${scopeCfg.label}) pour une partie ${meta.level}.` };
  }
  return { ok: true, meta };
}

function emitAdminRoomsUpdated(eventName, level) {
  io.to('admin').emit(eventName);
  const levelKey = String(level || '').trim().toLowerCase();
  if (ADMIN_SCOPES[levelKey]) {
    io.to(`admin:${levelKey}`).emit(eventName);
  }
}

function ensureCreditsByLevel(entry) {
  if (!entry) return null;
  if (!entry.creditsByLevel || typeof entry.creditsByLevel !== 'object') {
    const base = Number.isFinite(entry.credits) ? Math.max(0, Math.floor(entry.credits)) : DEFAULT_CREDITS;
    entry.creditsByLevel = {
      Q1: base, Q2: 0, T1: 0, T2: 0, T3: 0, T4: 0
    };
  }
  CREDIT_LEVELS.forEach(lvl => {
    if (!Number.isFinite(entry.creditsByLevel[lvl])) entry.creditsByLevel[lvl] = 0;
  });
  return entry.creditsByLevel;
}

function totalCredits(entry) {
  const by = ensureCreditsByLevel(entry);
  if (!by) return 0;
  return CREDIT_LEVELS.reduce((sum, lvl) => sum + (by[lvl] || 0), 0);
}

function highestCreditLevel(entry) {
  const by = ensureCreditsByLevel(entry);
  if (!by) return 'Q1';
  for (let i = CREDIT_LEVELS.length - 1; i >= 0; i--) {
    const lvl = CREDIT_LEVELS[i];
    if ((by[lvl] || 0) > 0) return lvl;
  }
  return 'Q1';
}

function moveCreditUp(entry, fromLevel) {
  const by = ensureCreditsByLevel(entry);
  if (!by) return;
  const from = normalizeCreditLevel(fromLevel);
  if ((by[from] || 0) <= 0) return;
  const idx = CREDIT_LEVELS.indexOf(from);
  const to = idx >= 0 && idx < CREDIT_LEVELS.length - 1 ? CREDIT_LEVELS[idx + 1] : from;
  by[from] = Math.max(0, (by[from] || 0) - 1);
  by[to] = (by[to] || 0) + 1;
  entry.level = highestCreditLevel(entry);
  entry.credits = totalCredits(entry);
}

function moveCreditToLevel(entry, fromLevel, toLevel) {
  const by = ensureCreditsByLevel(entry);
  if (!by) return false;
  const to = normalizeCreditLevel(toLevel);
  if (to === 'Q0') return false;
  let from = normalizeCreditLevel(fromLevel);
  if (from === 'Q0' || (by[from] || 0) <= 0) {
    from = null;
    for (let i = CREDIT_LEVELS.length - 1; i >= 0; i--) {
      const lvl = CREDIT_LEVELS[i];
      if ((by[lvl] || 0) > 0) {
        from = lvl;
        break;
      }
    }
  }
  if (!from) return false;
  if (from !== to) {
    by[from] = Math.max(0, (by[from] || 0) - 1);
    by[to] = (by[to] || 0) + 1;
  }
  entry.level = highestCreditLevel(entry);
  entry.credits = totalCredits(entry);
  return true;
}

function removeOneCredit(entry) {
  const by = ensureCreditsByLevel(entry);
  if (!by) return;
  for (let i = CREDIT_LEVELS.length - 1; i >= 1; i--) {
    const lvl = CREDIT_LEVELS[i];
    if ((by[lvl] || 0) > 0) {
      by[lvl] -= 1;
      entry.level = highestCreditLevel(entry);
      entry.credits = totalCredits(entry);
      return;
    }
  }
  if ((by.Q1 || 0) > 0) by.Q1 -= 1;
  entry.level = highestCreditLevel(entry);
  entry.credits = totalCredits(entry);
}

function ensurePromotionState(entry) {
  if (!entry) return null;
  if (!entry.promotionBo3 || typeof entry.promotionBo3 !== 'object') {
    entry.promotionBo3 = {};
  }
  if (!Number.isFinite(entry.t1Jokers)) {
    entry.t1Jokers = 0;
  }
  entry.t1Jokers = Math.max(0, Math.floor(entry.t1Jokers));
  return entry.promotionBo3;
}

function getPromotionBo3(entry, level) {
  const store = ensurePromotionState(entry);
  if (!store) return null;
  const key = normalizeCreditLevel(level);
  if (key === 'Q0') return null;
  if (!store[key] || typeof store[key] !== 'object') {
    store[key] = { active: false, wins: 0, losses: 0 };
  }
  const row = store[key];
  row.active = !!row.active;
  row.wins = Number.isFinite(row.wins) ? Math.max(0, Math.floor(row.wins)) : 0;
  row.losses = Number.isFinite(row.losses) ? Math.max(0, Math.floor(row.losses)) : 0;
  return row;
}

function startPromotionBo3(entry, level) {
  const bo3 = getPromotionBo3(entry, level);
  if (!bo3) return;
  bo3.active = true;
  bo3.wins = 0;
  bo3.losses = 0;
}

function registerPromotionDuel(entry, level, isWin) {
  const bo3 = getPromotionBo3(entry, level);
  if (!bo3) return null;
  if (!bo3.active) {
    bo3.active = true;
    bo3.wins = 0;
    bo3.losses = 0;
  }
  if (isWin) bo3.wins += 1;
  else bo3.losses += 1;
  return bo3;
}

function resetPromotionBo3(entry, level) {
  const bo3 = getPromotionBo3(entry, level);
  if (!bo3) return;
  bo3.active = false;
  bo3.wins = 0;
  bo3.losses = 0;
}

function grantT1Joker(entry) {
  ensurePromotionState(entry);
  entry.t1Jokers = (entry.t1Jokers || 0) + 1;
}

function consumeT1Joker(entry) {
  ensurePromotionState(entry);
  if ((entry.t1Jokers || 0) <= 0) return false;
  entry.t1Jokers -= 1;
  return true;
}

function canUseT1JokerOnLevel(level) {
  const key = normalizeCreditLevel(level);
  return key === 'T1' || key === 'T2' || key === 'T3' || key === 'T4';
}

function ensureCreditAtLevel(entry, level) {
  const by = ensureCreditsByLevel(entry);
  if (!by) return false;
  const to = normalizeCreditLevel(level);
  if (to === 'Q0') return false;
  if ((by[to] || 0) > 0) {
    entry.level = highestCreditLevel(entry);
    entry.credits = totalCredits(entry);
    return true;
  }
  for (let i = CREDIT_LEVELS.length - 1; i >= 0; i--) {
    const from = CREDIT_LEVELS[i];
    if ((by[from] || 0) <= 0) continue;
    by[from] -= 1;
    by[to] = (by[to] || 0) + 1;
    entry.level = highestCreditLevel(entry);
    entry.credits = totalCredits(entry);
    return true;
  }
  return false;
}

function applyDropToQ1WithCreditLoss(entry, fromLevel, reason) {
  if (!entry) return;
  removeOneCredit(entry);
  resetPromotionBo3(entry, fromLevel);
  entry.history.push({
    date: new Date().toISOString(),
    action: `${reason} -> Q1 (-1 credit)`
  });
}

function applyJokerReturnToT1(entry, fromLevel, reason) {
  if (!entry) return false;
  if (!canUseT1JokerOnLevel(fromLevel)) return false;
  if (!consumeT1Joker(entry)) return false;
  const moved = moveCreditToLevel(entry, fromLevel, 'T1');
  if (!moved) ensureCreditAtLevel(entry, 'T1');
  resetPromotionBo3(entry, fromLevel);
  entry.history.push({
    date: new Date().toISOString(),
    action: `${reason} -> T1 (joker)`
  });
  return true;
}

function applyDropToT1NoCreditLoss(entry, fromLevel, reason) {
  if (!entry) return;
  const moved = moveCreditToLevel(entry, fromLevel, 'T1');
  if (!moved) ensureCreditAtLevel(entry, 'T1');
  resetPromotionBo3(entry, fromLevel);
  entry.history.push({
    date: new Date().toISOString(),
    action: `${reason} -> T1 (credit conserve)`
  });
}

function getLevelIndex(level) {
  const key = normalizeLevel(level);
  const idx = LEVEL_STAGES.indexOf(key);
  return idx >= 0 ? idx : 0;
}

function getNextLevel(level) {
  const idx = getLevelIndex(level);
  if (idx >= LEVEL_STAGES.length - 1) return LEVEL_STAGES[LEVEL_STAGES.length - 1];
  return LEVEL_STAGES[idx + 1];
}

function ensurePlayerRecord(name) {
  const key = String(name || '').trim();
  if (!key || ['__proto__', 'constructor', 'prototype'].includes(key) || /[\u0000-\u001f\u007f]/.test(key)) return null;
  if (!Object.prototype.hasOwnProperty.call(playerLevels, key)) {
    playerLevels[key] = {
      name: key,
      level: 'Q1',
      wins: 0,
      history: [],
      credits: DEFAULT_CREDITS,
      timeCredits: DEFAULT_TIME_CREDITS,
      subscription: 'standard',
      points: 0,
      multiplier: null
    };
  }
  const entry = playerLevels[key];
  entry.level = normalizeLevel(entry.level);
  if (!Array.isArray(entry.history)) entry.history = [];
  if (entry.wins == null) entry.wins = 0;
  if (entry.credits == null) entry.credits = DEFAULT_CREDITS;
  if (!Number.isFinite(entry.timeCredits)) entry.timeCredits = DEFAULT_TIME_CREDITS;
  if (!entry.subscription) entry.subscription = 'standard';
  if (!Number.isFinite(entry.points)) entry.points = 0;
  if (!Number.isFinite(entry.multiplier) || entry.multiplier <= 1) entry.multiplier = null;
  if (typeof entry.needsWheelSpin !== 'boolean') entry.needsWheelSpin = false;
  ensurePromotionState(entry);
  ensureCreditsByLevel(entry);
  entry.level = highestCreditLevel(entry);
  entry.credits = totalCredits(entry);
  return entry;
}

function applyCreditsDelta(name, delta) {
  const entry = ensurePlayerRecord(name);
  if (!entry) return null;
  const by = ensureCreditsByLevel(entry);
  const next = (by.Q1 || 0) + (Number(delta) || 0);
  by.Q1 = Math.max(0, Math.floor(next));
  entry.credits = totalCredits(entry);
  entry.level = highestCreditLevel(entry);
  return entry.credits;
}

// — Championnat : points & multiplicateur de Bataille —
function applyChampionshipPoints(name, basePoints, { applyMultiplier = false } = {}) {
  const entry = ensurePlayerRecord(name);
  if (!entry) return null;
  const mult = applyMultiplier && entry.multiplier ? entry.multiplier : 1;
  entry.points = Math.max(0, Math.round((entry.points || 0) + basePoints * mult));
  return entry.points;
}

function resetMultiplier(name) {
  const entry = ensurePlayerRecord(name);
  if (!entry) return null;
  entry.multiplier = null;
  return entry;
}

function setMultiplier(name, value) {
  const entry = ensurePlayerRecord(name);
  if (!entry) return null;
  entry.multiplier = value;
  return entry;
}

function broadcastChampionshipLeaderboard() {
  const list = Object.values(playerLevels)
    .filter(e => e && e.name)
    .map(e => ({ name: e.name, points: e.points || 0, multiplier: e.multiplier || null }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 20);
  io.emit('championshipUpdated', list);
}

// Competitive progression is separate from the existing Q/T credit ladder.
const progression = createProgression({
  getEntries: () => playerLevels,
  ensureEntry: ensurePlayerRecord,
  save: saveLevels
});
let progressionBroadcastTimer = null;
function resolveProgressionName(socket) {
  const name = socket.playerData?.label || socket.data?.progressionName;
  return typeof name === 'string' && name.trim() && !/^Seat\s+\d+$/i.test(name) ? name.trim() : null;
}
function bindProgressionIdentity(socket, payload = {}) {
  const name = String(payload.name || '').trim();
  if (!name || name.length > 24 || !ensurePlayerRecord(name)) {
    throw Object.assign(new Error('Choisissez un pseudo valide de 1 à 24 caractères.'), { code: 'INVALID_NAME' });
  }
  if (socket.playerData?.label && socket.playerData.label !== name) {
    throw Object.assign(new Error('Votre profil est celui du joueur actuellement à table.'), { code: 'IDENTITY_LOCKED' });
  }
  socket.data.progressionName = name;
  if (typeof payload.clientKey === 'string' && payload.clientKey.length <= 160) socket._clientJoinKey = payload.clientKey;
  return name;
}
function publishProgression(name, receipt = null) {
  const dashboard = progression.dashboard(name);
  for (const playerSocket of io.sockets.sockets.values()) {
    if (resolveProgressionName(playerSocket) === name) playerSocket.emit('progression:updated', { dashboard, receipt });
  }
  if (!progressionBroadcastTimer) progressionBroadcastTimer = setTimeout(() => {
    progressionBroadcastTimer = null;
    broadcastChampionshipLeaderboard();
    io.emit('progression:rankingChanged');
  }, 100);
}
const competitiveSettlement = createCompetitiveSettlement({
  engine: progression, ensureEntry: ensurePlayerRecord, save: saveLevels, publish: publishProgression,
  onComplete(run) {
    if (run.kind === 'duel' && matches2Config[run.roomId]) {
      matches2Config[run.roomId].competitiveFinished = true;
      saveMatches2();
    }
  }
});

function applyCreditsSet(name, credits) {
  const entry = ensurePlayerRecord(name);
  if (!entry) return null;
  const by = ensureCreditsByLevel(entry);
  by.Q1 = Math.max(0, Math.floor(Number(credits)));
  entry.credits = totalCredits(entry);
  entry.level = highestCreditLevel(entry);
  return entry.credits;
}

function syncCreditsOnPlayers(players) {
  if (!Array.isArray(players)) return;
  players.forEach(p => {
    if (!p || !p.label || p.demo) return;
    const entry = ensurePlayerRecord(p.label);
    if (entry) {
      p.credits = totalCredits(entry);
      p.timeCredits = Number.isFinite(entry.timeCredits) ? entry.timeCredits : DEFAULT_TIME_CREDITS;
      p.subscription = entry.subscription || 'standard';
    }
  });
}

function decrementCreditsForPlayers(players) {
  if (!Array.isArray(players)) return;
  let changed = false;
  players.forEach(p => {
    if (!p || !p.id || !p.label || p.demo) return;
    const entry = ensurePlayerRecord(p.label);
    if (!entry) return;
    removeOneCredit(entry);
    changed = true;
  });
  if (changed) {
    saveLevels();
    io.to('admin').emit('profilesUpdated');
    io.to('admin').emit('levelsUpdated');
  }
}

// Heads-up : déclencher reveal si un joueur est ALL-IN et l'autre vient de s'aligner
function shouldRevealNowAfterCall(gs){
  if (!gs || !Array.isArray(gs.players)) return false;

  // joueurs encore en lice
  const alive = gs.players.filter(p => p && p.status !== 'FOLD' && p.status !== 'BUST' && p.status !== 'WAIT');
  if (alive.length !== 2) return false;

  const [A, B] = alive;
  const isAllInA = (A.status === 'ALLIN') || ((A.bankroll|0) === 0);
  const isAllInB = (B.status === 'ALLIN') || ((B.bankroll|0) === 0);

  // exactement UN seul all-in
  if (isAllInA === isAllInB) return false;

  // celui qui n'est pas all-in vient de couvrir la mise ET il lui reste des jetons
  const currentBet = gs.current_bet || Math.max(A.subtotal_bet||0, B.subtotal_bet||0);
  const caller = isAllInA ? B : A;

  const hasCovered = (caller.subtotal_bet || 0) >= currentBet;
  const stillHasChips = (caller.bankroll || 0) > 0;

  return hasCovered && stillHasChips;
}

// Utilise la même fonction que ton "double all-in" (ADAPTE LE NOM CI-DESSOUS)
function triggerRunoutAndReveal(gs, emitFn){
  // 👉 remplace par TA fonction existante (celle appelée quand les deux sont all-in) :
  if (typeof runAutoRunoutAndReveal === 'function') {
    runAutoRunoutAndReveal(gs, emitFn);
  } else if (typeof fastForwardToShowdown === 'function') {
    fastForwardToShowdown(gs, emitFn);
  } else {
    // fallback très basique
    gs.phase = 'reveal';
    if (emitFn) emitFn('updateTable', gs);
  }
}


// ──────────────────────────────────────────────────────────────
// 4) États en mémoire pour les parties en cours
// ──────────────────────────────────────────────────────────────
const waitingPlayersByTable      = {};
const gameStateByTable           = {};
const currentBetByTable          = {};
const currentMinRaiseByTable     = {};
const waitingPlayersByMatch2     = {};
const gameStateByMatch2          = {};
const currentBetByMatch2         = {};
const currentMinRaiseByMatch2    = {};
const pendingForcedStartsByRoom  = {};

// — Lobby "Jouer" (matchmaking automatique) —
let currentQuickTableID = null;
const quickPlayByClientKey = {};
const QUICKPLAY_MODE = 'normal';
const QUICKPLAY_LEVEL = 'Q1';

// — Championnat : mini-jeu Bataille pendant l'attente —
const battleQueueByTable    = {}; // tableID -> [{ seat, label, timer }]
const battleEnrolledByTable = {}; // tableID -> Set(seat) déjà inscrits (anti double-appariement au reload)
const battleDoneByTable     = {}; // tableID -> Set(seat) ayant terminé leur Bataille
const BATTLE_HUMAN_WAIT_MS  = 4000;

// — Championnat : face-à-face entre gagnants de table + roue à multiplicateur —
const finalsQueue               = []; // [{ label, clientKey }] au plus 1 en attente (paire dès que possible)
const finalsAssignmentByClientKey = {}; // clientKey -> { matchID, seat } (anti double-appariement au reload)
const WHEEL_OPTIONS = [
  { value: 1,  weight: 30 },
  { value: 2,  weight: 40 },
  { value: 5,  weight: 20 },
  { value: 10, weight: 10 }
];

function spinWheelValue() {
  const total = WHEEL_OPTIONS.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of WHEEL_OPTIONS) {
    if (r < o.weight) return o.value;
    r -= o.weight;
  }
  return WHEEL_OPTIONS[WHEEL_OPTIONS.length - 1].value;
}

// ──────────────────────────────────────────────
// Helpers de diffusion : joueurs + admin + spectateurs
// ──────────────────────────────────────────────
function broadcastTableState(tableID) {
  const state = gameStateByTable[tableID];
  if (!state) return;

  // joueurs
io.to(tableID).emit('updateTable', state);   // joueurs
  // admin
  io.to('admin').emit('updateTable', { tableID, gameState: state });
  // spectateurs
  io.to(`spectate-table:${tableID}`).emit('spectatorState', {
    type: 'table',
    tableID,
    gameState: state
  });
}

function broadcastMatch2State(matchID) {
  const state = gameStateByTable[matchID];
  if (!state) return;

  // joueurs
  io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
  // admin
  io.to('admin').emit('updateMatch2', { matchID, gameState: state });
  // spectateurs
  io.to(`spectate-match2:${matchID}`).emit('spectatorState', {
    type: 'match2',
    matchID,
    gameState: state
  });
}

// ──────────────────────────────────────────────────────────────
// 5) Endpoints Admin – Tables & Matchs 2 joueurs
// ──────────────────────────────────────────────────────────────

// (réinsérez aussi le POST createTable si vous l’aviez supprimé)
app.post('/admin/createTable', (req, res) => {
  const scopeCfg = getAdminScopeFromReq(req);
  const { players, mode, level, activeSeats: activeSeatsInput } = req.body;
  const totalSeats = 10;
  const activeSeatsRaw = parseInt(activeSeatsInput, 10);
  const activeSeats = Number.isInteger(activeSeatsRaw)
    ? Math.min(totalSeats, Math.max(2, activeSeatsRaw))
    : totalSeats;

  if (!Array.isArray(players)) {
    return res.status(400).json({ error: 'Liste de joueurs invalide.' });
  }
  const playersList = players.slice(0, totalSeats);
  while (playersList.length < totalSeats) playersList.push('');
  const filledCount = playersList
    .slice(0, activeSeats)
    .filter(p => String(p || '').trim() !== '').length;
  if (filledCount < 2) {
    return res.status(400).json({ error: 'Il faut au minimum 2 joueurs.' });
  }
  if (!BLINDS[mode]) {
    return res.status(400).json({ error: 'Mode de jeu invalide.' });
  }
  const scopeCreateCheck = ensureScopeCanCreate(scopeCfg, { level, mode });
  if (!scopeCreateCheck.ok) {
    return res.status(403).json({ error: scopeCreateCheck.error });
  }
  const normalizedPlayers = playersList.map((p, i) => {
    if (i >= activeSeats) return `Seat ${i + 1}`;
    const name = String(p || '').trim();
    return name || `Seat ${i + 1}`;
  });

  const tableID = crypto.randomBytes(4).toString('hex');
  tablesConfig[tableID] = {
    players: normalizedPlayers,
    mode,
    level: normalizeCreditLevel(level),
    activeSeats,
    totalSeats
  };
  saveTables();

  const base = `${req.protocol}://${req.get('host')}?table=${tableID}`;

  // on renvoie l’ID + un lien global + les liens par siège
  const seatLinks = normalizedPlayers.slice(0, activeSeats).map((name, seat) => ({
    seat,
    name,
    url: `${base}&seat=${seat}`
  }));
  const spectatorLink = `${base}&spectator=1`;

  res.json({
    tableID,
    link: base,
    seatLinks,
    spectatorLink
  });
  emitAdminRoomsUpdated('tablesUpdated', tablesConfig[tableID].level);
});

// Crée une table "Jouer" (matchmaking auto) — même structure qu'une table admin classique.
function createQuickTable() {
  const totalSeats = 10;
  const activeSeats = 10;
  const players = Array.from({ length: totalSeats }, (_, i) => `Seat ${i + 1}`);
  const tableID = crypto.randomBytes(4).toString('hex');
  tablesConfig[tableID] = {
    players,
    mode: QUICKPLAY_MODE,
    level: normalizeCreditLevel(QUICKPLAY_LEVEL),
    activeSeats,
    totalSeats,
    quickPlay: true
  };
  saveTables();
  emitAdminRoomsUpdated('tablesUpdated', tablesConfig[tableID].level);
  return tableID;
}

// ──────────────────────────────────────────────────────────────
// Championnat : mini-jeu Bataille — interactif, en 3 manches (1re à 2 victoires)
// ──────────────────────────────────────────────────────────────
function battleCardRank(card) { return parseInt(String(card).slice(1), 10); }

// Tire une carte au hasard (format identique à generateDeck(), ex: 'h14', 'd7').
function drawBattleCard() {
  return generateDeck()[0];
}

// Sessions de Bataille en cours, indexées par "tableID:seat" (une entrée par joueur humain).
const battleSessionsBySeat = {};
function battleSessionKey(tableID, seat) { return `${tableID}:${seat}`; }

app.get('/admin/getTables', (req, res) => {
  const scopeCfg = getAdminScopeFromReq(req);
  const list = Object.entries(tablesConfig).map(([tableID, cfg]) => {
    const lastGame = gamesHistory.filter(g => g.type === 'table' && g.tableID === tableID).pop();
    const st = gameStateByTable[tableID];
    const pendingStart = pendingForcedStartsByRoom[tableID];
    const started = Boolean(st) || Boolean(lastGame) || Boolean(pendingStart);
    return {
      tableID,
      mode: cfg.mode,
      level: cfg.level || 'Q1',
      activeSeats: Number.isInteger(cfg.activeSeats) ? cfg.activeSeats : 10,
      players: cfg.players,
      winner: lastGame ? lastGame.winner : null,
      started,
      paused: Boolean(st?.adminPaused)
    };
  }).filter(row => scopeAllowsLevel(scopeCfg, row.level));
  res.json(list);
});

// ──────────────────────────────────────────────────────────────
// 6) Endpoints Admin – Matchs 2 joueurs (avec dernier winner)
// ──────────────────────────────────────────────────────────────

app.post('/admin/createMatch2', (req, res) => {
  const scopeCfg = getAdminScopeFromReq(req);
  const { players, mode, level } = req.body;

  if (!Array.isArray(players) || players.length !== 2) {
    return res.status(400).json({ error: 'Il faut exactement 2 joueurs.' });
  }
  if (!BLINDS[mode]) {
    return res.status(400).json({ error: 'Mode de jeu invalide.' });
  }
  const scopeCreateCheck = ensureScopeCanCreate(scopeCfg, { level, mode });
  if (!scopeCreateCheck.ok) {
    return res.status(403).json({ error: scopeCreateCheck.error });
  }

  const matchID = crypto.randomBytes(4).toString('hex');
  matches2Config[matchID] = { players, mode, level: normalizeCreditLevel(level) };
  saveMatches2();

  const base = `${req.protocol}://${req.get('host')}?match2=${matchID}`;
  const seatLinks = players.map((name, seat) => ({
    seat,
    name,
    url: `${base}&seat=${seat}`
  }));
  const spectatorLink = `${base}&spectator=1`;

  res.json({
    matchID,
    link: base,
    seatLinks,
    spectatorLink
  });
  emitAdminRoomsUpdated('matches2Updated', matches2Config[matchID].level);
});
app.get('/admin/getMatches2', (req, res) => {
  const scopeCfg = getAdminScopeFromReq(req);
  const list = Object.entries(matches2Config).map(([matchID, cfg]) => {
    const lastGame = gamesHistory.filter(g => g.type === 'match2' && g.matchID === matchID).pop();
    const st = gameStateByTable[matchID];
    const pendingStart = pendingForcedStartsByRoom[matchID];
    const started = Boolean(st) || Boolean(lastGame) || Boolean(pendingStart);
    return {
      matchID,
      mode: cfg.mode,
      level: cfg.level || 'Q1',
      players: cfg.players,
      winner: lastGame ? lastGame.winner : null,
      started,
      paused: Boolean(st?.adminPaused)
    };
  }).filter(row => scopeAllowsLevel(scopeCfg, row.level));
  res.json(list);
});


// ──────────────────────────────────────────────────────────────
// 7) Endpoints Admin – communs
// ──────────────────────────────────────────────────────────────
// juste remplacer l’ancien :
app.get('/admin/getProfiles', (req, res) => {
  if (!ensureMainAdminHttp(req, res, 'Les profils')) return;
  const type = req.query.type; // 'table' ou 'match2'
  const stats = type === 'match2' ? statsMatch2 : statsTable;
  const list = Object.values(stats).map(p => {
    const entry = ensurePlayerRecord(p.name) || {};
    return {
      name: p.name,
      level: entry.level,
      creditsByLevel: entry.creditsByLevel || {},
      credits: entry.credits || 0,
      gamesPlayed: p.gamesPlayed,
      wins: p.wins,
      byMode: p.byMode
    };
  });
  res.json(list);
});

app.get('/admin/getLevels', (req, res) => {
  if (!ensureMainAdminHttp(req, res, 'Les niveaux')) return;
  // 1) union de tous les noms de joueurs
  const names = new Set([
    ...Object.keys(playerLevels),
    ...Object.keys(statsTable),
    ...Object.keys(statsMatch2)
  ]);

  // 2) construction du tableau
  const list = Array.from(names).map(name => {
    // entrée de niveau si elle existe, sinon on part de zéro
    const lvlEntry = ensurePlayerRecord(name) || { level: 'Q1', history: [], credits: DEFAULT_CREDITS };
    // parties/jours et victoires : on additionne les deux types de stats
    const played = (statsTable[name]?.gamesPlayed || 0)
                 + (statsMatch2[name]?.gamesPlayed || 0);
    const wins   = (statsTable[name]?.wins        || 0)
                 + (statsMatch2[name]?.wins        || 0);
    return {
      name,
      level:       lvlEntry.level,
      creditsByLevel: lvlEntry.creditsByLevel || {},
      timeCredits: Number.isFinite(lvlEntry.timeCredits) ? lvlEntry.timeCredits : DEFAULT_TIME_CREDITS,
      credits:     lvlEntry.credits,
      subscription: lvlEntry.subscription || 'standard',
      gamesPlayed: played,
      wins:        wins,
      history:     lvlEntry.history
    };
  });

  // 3) tri par niveau décroissant
  list.sort((a, b) => getLevelIndex(b.level) - getLevelIndex(a.level));

  res.json(list);
});

// --- Public: stats joueurs pour la table en cours (usage client PRO) ---
app.post('/api/playerStats', (req, res) => {
  const rawNames = Array.isArray(req.body?.names) ? req.body.names : [];
  const names = Array.from(new Set(rawNames.map(n => String(n || '').trim()).filter(Boolean)));
  const players = names.map(name => {
    const t = statsTable[name] || {};
    const m = statsMatch2[name] || {};
    const byMode = {};
    Object.keys(BLINDS).forEach(mode => {
      const tMode = t.byMode?.[mode] || { played: 0, wins: 0 };
      const mMode = m.byMode?.[mode] || { played: 0, wins: 0 };
      byMode[mode] = {
        played: (tMode.played || 0) + (mMode.played || 0),
        wins:   (tMode.wins   || 0) + (mMode.wins   || 0)
      };
    });
    return {
      name,
      gamesPlayed: (t.gamesPlayed || 0) + (m.gamesPlayed || 0),
      wins:        (t.wins        || 0) + (m.wins        || 0),
      table: {
        played: t.gamesPlayed || 0,
        wins:   t.wins        || 0
      },
      duel: {
        played: m.gamesPlayed || 0,
        wins:   m.wins        || 0
      },
      byMode
    };
  });
  res.json({ players });
});

app.post('/admin/updateLevel', (req, res) => {
  if (!ensureMainAdminHttp(req, res, 'La modification de niveau')) return;
  const name = String(req.body?.name || '').trim();
  const levelRaw = req.body?.level;
  if (!name) return res.status(400).json({ error: 'Nom manquant.' });
  const entry = ensurePlayerRecord(name);
  if (!entry) return res.status(404).json({ error: 'Profil introuvable.' });
  const next = normalizeLevel(levelRaw);
  const prev = entry.level;
  entry.level = next;
  entry.history.push({
    date: new Date().toISOString(),
    action: `Admin: niveau ${formatLevelLabel(prev)} -> ${formatLevelLabel(next)}`
  });
  saveLevels();
  io.to('admin').emit('levelsUpdated');
  io.to('admin').emit('profilesUpdated');
  res.json({ ok: true, level: entry.level });
});

app.post('/admin/setSubscription', (req, res) => {
  if (!ensureMainAdminHttp(req, res, "La modification d'abonnement")) return;
  const name = String(req.body?.name || '').trim();
  const subscription = String(req.body?.subscription || '').trim().toLowerCase();
  if (!name) return res.status(400).json({ error: 'Nom manquant.' });
  if (!['standard', 'pro'].includes(subscription)) {
    return res.status(400).json({ error: 'Abonnement invalide.' });
  }
  const entry = ensurePlayerRecord(name);
  if (!entry) return res.status(404).json({ error: 'Profil introuvable.' });
  entry.subscription = subscription;
  saveLevels();
  res.json({ ok: true, subscription: entry.subscription });
});

app.post('/admin/updateCredits', (req, res) => {
  if (!ensureMainAdminHttp(req, res, 'La modification de credits')) return;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom manquant.' });

  const hasSet = Number.isFinite(req.body?.credits);
  const hasDelta = Number.isFinite(req.body?.delta);
  if (!hasSet && !hasDelta) {
    return res.status(400).json({ error: 'credits ou delta requis.' });
  }

  const credits = hasSet
    ? applyCreditsSet(name, req.body.credits)
    : applyCreditsDelta(name, req.body.delta);

  saveLevels();
  io.to('admin').emit('profilesUpdated');
  io.to('admin').emit('levelsUpdated');
  for (const [id, state] of Object.entries(gameStateByTable)) {
    if (!state || !Array.isArray(state.players)) continue;
    let changed = false;
    state.players.forEach(p => {
      if (p && p.label === name) {
        p.credits = credits;
        changed = true;
      }
    });
    if (!changed) continue;
    if (matches2Config[id]) {
      io.to(id).emit('updateMatch2', { matchID: id, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID: id, gameState: state });
    } else {
      io.to(id).emit('updateTable', state);
      io.to('admin').emit('updateTable', { tableID: id, gameState: state });
    }
  }
  res.json({ ok: true, credits });
});

app.post('/admin/setCreditsByLevel', (req, res) => {
  if (!ensureMainAdminHttp(req, res, 'La modification des credits')) return;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Nom manquant.' });

  const rawLevel = String(req.body?.level || '').trim().toUpperCase();
  const rawValue = Number(req.body?.value);
  if (!Number.isFinite(rawValue)) {
    return res.status(400).json({ error: 'Valeur invalide.' });
  }
  const value = Math.max(0, Math.floor(rawValue));

  const entry = ensurePlayerRecord(name);
  if (!entry) return res.status(404).json({ error: 'Profil introuvable.' });

  if (rawLevel === 'TIME' || rawLevel === 'TIME_CREDIT' || rawLevel === 'TIME_CREDITS' || rawLevel === 'CREDIT_TIME' || rawLevel === 'CREDIT TIME') {
    const prev = Number.isFinite(entry.timeCredits) ? entry.timeCredits : DEFAULT_TIME_CREDITS;
    entry.timeCredits = value;
    entry.history.push({
      date: new Date().toISOString(),
      action: `Admin: time credit ${prev} -> ${value}`
    });
  } else {
    const level = normalizeCreditLevel(rawLevel);
    const by = ensureCreditsByLevel(entry);
    const prev = by[level] || 0;
    by[level] = value;
    entry.credits = totalCredits(entry);
    entry.level = highestCreditLevel(entry);
    entry.history.push({
      date: new Date().toISOString(),
      action: `Admin: credit ${level} ${prev} -> ${value}`
    });
  }

  entry.credits = totalCredits(entry);
  entry.level = highestCreditLevel(entry);

  saveLevels();
  io.to('admin').emit('profilesUpdated');
  io.to('admin').emit('levelsUpdated');

  const total = entry.credits;
  for (const [id, state] of Object.entries(gameStateByTable)) {
    if (!state || !Array.isArray(state.players)) continue;
    let changed = false;
    state.players.forEach(p => {
      if (p && p.label === name) {
        p.credits = total;
        changed = true;
      }
    });
    if (!changed) continue;
    if (matches2Config[id]) {
      io.to(id).emit('updateMatch2', { matchID: id, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID: id, gameState: state });
    } else {
      io.to(id).emit('updateTable', state);
      io.to('admin').emit('updateTable', { tableID: id, gameState: state });
    }
  }

  res.json({ ok: true, creditsByLevel: entry.creditsByLevel, timeCredits: entry.timeCredits, credits: total, level: entry.level });
});


app.get('/admin/getGames', (req, res) => {
  if (!ensureMainAdminHttp(req, res, "L'historique des parties")) return;
  res.json(gamesHistory);
});

app.delete('/admin/deleteTable/:tableID', (req, res) => {
  const scopeCfg = getAdminScopeFromReq(req);
  const id = req.params.tableID;
  if (!tablesConfig[id]) return res.status(404).json({ error: 'Table inconnue.' });
  if (!scopeCfg.permissions?.deleteRooms) {
    return res.status(403).json({ error: 'Suppression non autorisee pour cet admin.' });
  }
  const roomCheck = ensureScopeCanManageRoom(scopeCfg, id);
  if (!roomCheck.ok) return res.status(403).json({ error: roomCheck.error });
  const level = tablesConfig[id].level;
  delete tablesConfig[id]; saveTables();
  emitAdminRoomsUpdated('tablesUpdated', level);
  res.json({ ok: true });
});

app.delete('/admin/deleteMatch2/:matchID', (req, res) => {
  const scopeCfg = getAdminScopeFromReq(req);
  const id = req.params.matchID;
  if (!matches2Config[id]) return res.status(404).json({ error: 'Match introuvable.' });
  if (!scopeCfg.permissions?.deleteRooms) {
    return res.status(403).json({ error: 'Suppression non autorisee pour cet admin.' });
  }
  const roomCheck = ensureScopeCanManageRoom(scopeCfg, id);
  if (!roomCheck.ok) return res.status(403).json({ error: roomCheck.error });
  const level = matches2Config[id].level;
  delete matches2Config[id]; saveMatches2();
  emitAdminRoomsUpdated('matches2Updated', level);
  res.json({ ok: true });
});

app.delete('/admin/deleteProfile/:name', (req, res) => {
  if (!ensureMainAdminHttp(req, res, 'La suppression de profil')) return;
  const name = decodeURIComponent(req.params.name);
  let found = false;

  if (statsTable[name]) {
    delete statsTable[name];
    saveStatsTable();
    found = true;
  }
  if (statsMatch2[name]) {
    delete statsMatch2[name];
    saveStatsMatch2();
    found = true;
  }
  if (playerLevels[name]) {
    delete playerLevels[name];
    saveLevels();
    found = true;
  }

  if (!found) {
    return res.status(404).json({ error: 'Profil introuvable.' });
  }

  // Notifie tous les admins de rafraîchir leurs listes de profils
  io.to('admin').emit('profilesUpdated');
  res.json({ ok: true });
});

// 8bis) Gate HTTP : si partie finie ou joueur BUST, on sert directement la page de fin
// FRONT DU JEU : sert toujours poker.html à la racine
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'poker-app', 'poker.html'));
});


// ─────────────────────────────────────────
// 8) Static files & fallback (ADMIN + GAME)
// ─────────────────────────────────────────
const pathCandidates = [
  path.join(__dirname, 'admin'),                 // ./admin/index.html
  path.join(__dirname, 'admin-app'),             // ./admin-app/admin.html
  path.join(__dirname, 'admin', 'dist'),         // ./admin/dist/index.html (Vite/Webpack)
  path.join(__dirname, 'admin-app', 'dist'),     // ./admin-app/dist/index.html
  path.join(__dirname, 'public', 'admin'),       // ./public/admin/index.html
];

function pickAdminDir() {
  for (const p of pathCandidates) {
    const idx = fs.existsSync(p)
      ? (fs.existsSync(path.join(p, 'index.html')) ? 'index.html'
         : fs.existsSync(path.join(p, 'admin.html')) ? 'admin.html'
         : null)
      : null;
    if (idx) return { dir: p, entry: idx };
  }
  return null;
}

// ──────────────────────────────────────────────────────────────
// 8) Poker utility functions (deck, deal, blinds, bets…)
// ──────────────────────────────────────────────────────────────
function generateDeck() {
  const suits = ['h','d','c','s'], deck = [];
  for (let r = 2; r < 15; r++) suits.forEach(s => deck.push(s + r));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function distributeCards(state) {
  const deck = generateDeck();
  state.players.forEach(p => {
    p.carda = deck.shift();
    p.cardb = deck.shift();
  });
  state.board = [];
  deck.shift();
  state.board.push(deck.shift(), deck.shift(), deck.shift());
  deck.shift(); state.board.push(deck.shift());
  deck.shift(); state.board.push(deck.shift());
  state.phase = 'preflop';
  state.checkCount = 0;
  state.roundEvaluated = false;
  state.winReason = null;
}

function serverBet(roomID, idx, amount) {
  const isMatch2 = Boolean(matches2Config[roomID]);
  // 0) on récupère l’état de jeu et le joueur
  const G = gameStateByTable[roomID];
  if (!G) return false;
  const p = G.players[idx];
  if (!p || p.status === 'FOLD') return false;

  // 1) on fait ton code de pari habituel
  //    (on choisit la bonne paire cb/cr selon table vs match2)
  let cb = (isMatch2 ? currentBetByMatch2[roomID] : currentBetByTable[roomID]) || 0;
  let cr = (isMatch2 ? currentMinRaiseByMatch2[roomID] : currentMinRaiseByTable[roomID]) || 0;
  const minOpen = G.minOpen || 0;
  const isAllInAttempt = amount >= p.bankroll;
  if (cb === 0 && amount > 0 && amount < minOpen && !isAllInAttempt) return false;

  if (amount >= p.bankroll) {
    amount = p.bankroll;
    const old = cb;
    cb = Math.max(cb, p.subtotal_bet + amount);
    cr = Math.max(cr, cb - old);
    p.status = 'ALLIN';
  } else if (p.subtotal_bet + amount === cb) {
    p.status = 'CALL';
  } else if (p.subtotal_bet + amount < cb) {
    return false;
  } else {
    p.status = 'RAISE';
    const old = cb;
    cb = p.subtotal_bet + amount;
    cr = Math.max(cr, cb - old);
  }

  // 2) on met à jour l’état
  p.subtotal_bet += amount;
  p.bankroll    -= amount;
  G.pot         += amount;
  p.total_bet_hand = (p.total_bet_hand || 0) + amount;  // ← NEW
  G.current_bet  = cb;

  // Si le stack tombe à zéro, le joueur EST all-in (même si c'était un CALL exact)
if ((p.bankroll | 0) === 0 && p.status !== 'FOLD' && p.status !== 'BUST' && p.status !== 'WAIT') {
  p.status = 'ALLIN';
}
  
  // 3) on stocke dans le bon store
  if (isMatch2) {
    currentBetByMatch2[roomID]      = cb;
    currentMinRaiseByMatch2[roomID] = cr;
  } else {
    currentBetByTable[roomID]       = cb;
    currentMinRaiseByTable[roomID]  = cr;
  }

  // 4) on notifie les clients et relance le timer adapté
// 4) on notifie les clients (PAS de reset du timer ici !)
if (isMatch2) {
  broadcastMatch2State(roomID);
} else {
  broadcastTableState(roomID);
}

return true;
}

function isRoundComplete(roomID) {
  const G = gameStateByTable[roomID];
  if (!G) return false;
  const isMatch2 = Boolean(matches2Config[roomID]);

  const cb = (isMatch2 ? currentBetByMatch2[roomID] : currentBetByTable[roomID]) || 0;

  // joueurs encore en lice
  const active = G.players.filter(p => p.status !== 'FOLD' && p.status !== 'BUST' && p.status !== 'WAIT');

  // acteurs = peuvent encore agir (ni ALLIN, ni 0 stack)
  const actors = active.filter(p => !isSkippablePlayer(p)); // <= AU LIEU de juste '!== ALLIN'

  if (cb > 0) {
    // !!! IMPORTANT: s'il n'y a AUCUN acteur, ce n'est pas "complet" (sinon vacuité => true)
    if (actors.length === 0) return false;
    if (G.phase === 'preflop' && G.bbOptionPending) {
      const bbIdx = G.bigBlindIndex;
      if (Number.isInteger(bbIdx) && bbIdx >= 0 && bbIdx < G.players.length) {
        const bbPlayer = G.players[bbIdx];
        const bbCanAct = bbPlayer && !isSkippablePlayer(bbPlayer);
        if (bbCanAct) return false;
      }
    }
    // fin du tour quand tous les acteurs ont couvert la mise courante
    return actors.every(p => (p.subtotal_bet || 0) === cb);
  } else {
    // pas de mise : fin du tour quand tous les acteurs ont CHECK
    const requiredChecks = actors.length;
    if (requiredChecks === 0) return false; // pas d'acteurs => ne PAS avancer
    return (G.checkCount || 0) >= requiredChecks;
  }
}

// Helpers de sièges actifs + rotation (à mettre en haut du fichier, avant configureBlinds)
// Les joueurs en WAIT/BREAK restent éligibles aux blinds.
function isSeatActive(state, i) {
  const p = state.players[i];
  return !!p && p.status !== 'BUST' && ((p.bankroll | 0) > 0);
}

function nextActiveSeat(state, from) {
  const N = state.players.length;
  for (let step = 1; step <= N; step++) {
    const j = ((from + step) % N + N) % N;
    if (isSeatActive(state, j)) return j;
  }
  return -1; // si personne
}

function firstActiveSeat(state) {
  return nextActiveSeat(state, -1);
}

// Applique une blind en gérant le cas short stack → ALLIN
function applyBlind(st, seat, amt) {
  const p = st.players[seat];
  if (!p) return 0;
  const post = Math.min(amt, Math.max(0, p.bankroll | 0));
  if (post <= 0) return 0;

  p.subtotal_bet   = (p.subtotal_bet   || 0) + post;
  p.total_bet_hand = (p.total_bet_hand || 0) + post;
  p.bankroll      -= post;
  st.pot          += post;

  if (post < amt || (p.bankroll | 0) === 0) p.status = 'ALLIN';
  return post;
}

// ──────────────────────────────────────────────────────────────
// configureBlinds: double les blinds tous les 10 rounds pour 3 modes
// ──────────────────────────────────────────────────────────────
function configureBlinds(state, tableID) {
  // Helper local : applique une blind proprement
  function applyBlind(st, seat, amt) {
    const p = st.players[seat];
    if (!p) return 0;
    const waiting = p.status === 'WAIT' || Boolean(p.isBreak);
    const br = Math.max(0, p.bankroll | 0);
    if (br <= 0) {
      if (waiting) p.status = 'BUST';
      return 0;
    }
    const post = Math.min(amt, br);
    if (post <= 0) {
      if (waiting) p.status = 'BUST';
      return 0;
    }
    p.subtotal_bet   = (p.subtotal_bet || 0) + post;
    p.total_bet_hand = (p.total_bet_hand || 0) + post; // ← utile pour side-pots
    p.bankroll      -= post;
    st.pot          += post;

    if ((p.bankroll | 0) <= 0) {
      if (waiting) p.status = 'BUST';
      else p.status = 'ALLIN';
    }
    return post;
  }

  // Détermination du mode via la config
  let mode;
  if (tablesConfig[tableID])         mode = tablesConfig[tableID].mode;
  else if (matches2Config[tableID])  mode = matches2Config[tableID].mode;
  else {
    state.dealerIndex = state.current_bettor_index = -1;
    state.smallBlind  = state.bigBlind = 0;
    return;
  }

  // Blinds de base (+ éventuellement facteur d’augmentation)
  let { SB, BB } = BLINDS[mode];
  if (['beginner','normal','turbo'].includes(mode)) {
    const factor = 2 ** Math.floor((state.roundNumber - 1) / 10);
    SB *= factor;
    BB *= factor;
  }
  state.minOpen = BB;
  state.smallBlindAmount = SB;
  state.bigBlindAmount = BB;

  // Sièges encore actifs (non BUST et avec des jetons)
  // Rotation déterministe du bouton dealer (saute les joueurs BUST/0 stack)
  const activeSeats = state.players
    .map((p, i) => ({ i, p }))
    .filter(o => o.p && o.p.status !== 'BUST' && ((o.p.bankroll|0) > 0))
    .map(o => o.i);

  if (activeSeats.length < 2) {
    // Pas assez de joueurs pour poser des blinds → on sort
    return;
  }

  // ⚠️ Déclaré AVANT la première utilisation pour éviter le TDZ
  const nextActive = (i, step = 1) =>
    activeSeats[(activeSeats.indexOf(i) + step) % activeSeats.length];

  const lastDealer = state.dealerIndex;
  let dealer;

  // Si on a déjà un dealer : on donne le bouton au prochain joueur actif à gauche
  if (Number.isInteger(lastDealer)) {
    if (activeSeats.includes(lastDealer)) {
      dealer = nextActive(lastDealer, 1); // "ex-SB" devient dealer si toujours actif
    } else {
      // Le dealer précédent a bust : on prend le 1er actif après son index, sinon le 1er actif
      const after = activeSeats.find(i => i > lastDealer);
      dealer = (after !== undefined) ? after : activeSeats[0];
    }
  // Première main : dealer aléatoire parmi les joueurs actifs
  } else {
    dealer = activeSeats[Math.floor(Math.random() * activeSeats.length)];
  }

  state.dealerIndex = dealer; // on persiste le dealer pour la main suivante

  // Trouve SB et BB autour du dealer
  let sbSeat, bbSeat;

  const onlyTwo = activeSeats.length === 2;
  if (onlyTwo) {
    // Heads-up : le dealer POSTE la SB, l’autre poste la BB
    sbSeat = dealer;
    bbSeat = nextActive(dealer, 1);
  } else {
    // 3 joueurs et + : SB/BB classiques à gauche du dealer
    sbSeat = nextActive(dealer, 1);
    bbSeat = nextActive(dealer, 2);
  }

  state.smallBlindIndex = sbSeat;
  state.bigBlindIndex   = bbSeat;

  // Appliquer les blinds (met à jour pot, bankroll, subtotal_bet, total_bet_hand)
  applyBlind(state, sbSeat, SB);
  applyBlind(state, bbSeat, BB);

  // Met à jour les compteurs de mises courantes
  const isMatch2 = Boolean(matches2Config[tableID]);
  state.current_bet = BB;

  if (isMatch2) {
    currentBetByMatch2[tableID]      = BB;
    currentMinRaiseByMatch2[tableID] = BB;
  } else {
    currentBetByTable[tableID]       = BB;
    currentMinRaiseByTable[tableID]  = BB;
  }

  // Le premier à parler = joueur après la BB (actif, non skippable)
  {
    const N = state.players.length;
    let idx = bbSeat;
    let found = -1;
    for (let step = 1; step <= N; step++) {
      const j = (idx + step) % N;
      if (!isSkippablePlayer(state.players[j])) { found = j; break; }
    }
    state.current_bettor_index = found;
  }
  state.checkCount           = 0;
  {
    const bbPlayer = state.players[bbSeat];
    state.bbOptionPending = Boolean(
      BB > 0 &&
      Number.isInteger(bbSeat) &&
      bbPlayer &&
      !isSkippablePlayer(bbPlayer)
    );
  }
}


function handleHyperTie(tableID) {
  const state = gameStateByTable[tableID];
  if (!state) return false;

  // conversion cartes -> format Ah,7c…
  const conv = c => {
    const s = c[0], r = parseInt(c.slice(1),10);
    const M = {14:'A',13:'K',12:'Q',11:'J',10:'T'};
    return (M[r]||r) + s;
  };

  // Résolution des mains
  const solved = state.players.map(p =>
    (!p || p.inactive || ['FOLD','BUST','WAIT'].includes(p.status))
      ? null
      : Hand.solve([p.carda, p.cardb, ...state.board].map(conv))
  );
  const winners = Hand.winners(solved.filter(Boolean));

  // Si on a plus d’un gagnant -> tie
  if (winners.length > 1) {
    // Filtre les joueurs ex-æquo
    const tied = state.players.filter((p,i) =>
      solved[i] && winners.includes(solved[i])
    );

    // Remise à zéro du pot + ALLIN pour chacun
    state.pot = 0;
    tied.forEach(p => {
      const shove = Math.max(0, p.bankroll | 0);
      p.status = 'ALLIN';
      p.subtotal_bet = shove;
      p.total_bet_hand = shove;
      state.pot += shove;
      p.bankroll = 0;
    });

    // On ne garde que ces joueurs pour le tie-breaker
    state.players = tied;
    if (tied.length > 1) competitiveSettlement.settle(state);

    // Reset du meilleur pari
    currentBetByTable[tableID] = state.current_bet =
      Math.max(0, ...tied.map(p => p.subtotal_bet));

    // On repart en préflop
    state.phase           = 'preflop';
    state.roundEvaluated  = false;

    // Notifie clients
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
    io.to('admin').emit('updateTable', { tableID, gameState: state });
    return true;
  }

  return false;
}

/**
 * Même logique de tie‐break que handleHyperTie, mais pour les match2.
 * @return {boolean} true s’il y a eu un tie‐break (on relance un all‐in), false sinon.
 */
function handleHyperTie2(matchID) {
  const state = gameStateByTable[matchID]; // tu stockes aussi les match2 ici
  if (!state) return false;

  // conversion cartes → format "Ah","7c"…
  const conv = c => {
    const s = c[0], r = parseInt(c.slice(1), 10);
    const M = {14:'A',13:'K',12:'Q',11:'J',10:'T'};
    return (M[r] || r) + s;
  };

  // résolution des mains
  const solved = state.players.map(p =>
    (!p || p.inactive || ['FOLD','BUST','WAIT'].includes(p.status))
      ? null
      : Hand.solve([p.carda, p.cardb, ...state.board].map(conv))
  );
  const winners = Hand.winners(solved.filter(Boolean));

  // si on a plusieurs winners → tie
  if (winners.length > 1) {
    // on ne conserve que les joueurs ex-æquo
    const tied = state.players.filter((p,i) =>
      solved[i] && winners.includes(solved[i])
    );

    // reset du pot + auto‐all‐in sur ces joueurs
    state.pot = 0;
    tied.forEach(p => {
      const shove = Math.max(0, p.bankroll | 0);
      p.status = 'ALLIN';
      p.subtotal_bet = shove;
      p.total_bet_hand = shove;
      state.pot += shove;
      p.bankroll = 0;
    });

    // on remplace la liste des joueurs par ces ex-æquo
    state.players = tied;
    if (tied.length > 1) competitiveSettlement.settle(state);
    // juste après `state.players = tied;`
state.current_bettor_index = 0;   // ou l’indice que tu veux démarrer


    // reset du meilleur pari
    currentBetByMatch2[matchID] = state.current_bet =
      Math.max(0, ...tied.map(p => p.subtotal_bet));

    // on repart en préflop
    state.phase          = 'preflop';
    state.roundEvaluated = false;

    // notifie les clients
    io.to(matchID).emit('updateMatch2',   { matchID, gameState: state });
    io.to('admin').emit('updateMatch2',   { matchID, gameState: state });
    return true;
  }

  return false;
}


// ──────────────────────────────────────────────────────────────
// 9) tryStartGame: lance la partie dès que 10 joueurs ont rejoint
// ──────────────────────────────────────────────────────────────
function buildPlayersFromWaiting(cfg, waiting, totalSeats, activeSeats = totalSeats, opts = {}) {
  const joinSeats = opts.joinSeats || null;
  const slots = Array.from({ length: totalSeats }, (_, i) => waiting[i] || null);
  return slots.map((sock, i) => {
    if (i >= activeSeats) {
      return {
        id:           null,
        label:        '',
        credits:      0,
        bankroll:     0,
        carda:        '',
        cardb:        '',
        status:       'WAIT',
        inactive:     true,
        isBreak:      false,
        reconnectRestoreStatus: null,
        subtotal_bet: 0,
        missedCount:  0,
        warned:       false,
        seat:         i,
      };
    }
    if (sock && sock.playerData) {
      const label = cfg.players[i] || sock.playerData.label || `Player ${i + 1}`;
      const isPlaceholder = /^Seat\s+\d+$/i.test(label);
      const entry = cfg.demo || isPlaceholder ? null : ensurePlayerRecord(label);
      const forceJoinState = Boolean(joinSeats && joinSeats[i] === true);
      return {
        id:           sock.playerData.id,
        ...(cfg.demo ? { demo: true } : {}),
        label,
        credits:      entry ? entry.credits : 0,
        subscription: entry ? (entry.subscription || 'standard') : 'standard',
        bankroll:     20000,
        carda:        '',
        cardb:        '',
        // Joueur connecté après le clic START admin: il rejoint la main suivante.
        status:       forceJoinState ? 'WAIT' : '',
        isBreak:      false,
        reconnectRestoreStatus: null,
        subtotal_bet: 0,
        missedCount:  0,
        warned:       false,
        seat:         i,
      };
    }
    const label = cfg.players[i] || `Seat ${i + 1}`;
    const isPlaceholder = /^Seat\s+\d+$/i.test(label);
    const entry = cfg.demo || isPlaceholder ? null : ensurePlayerRecord(label);
    return {
      id:           null,
      label,
      credits:      entry ? entry.credits : 0,
      subscription: entry ? (entry.subscription || 'standard') : 'standard',
      bankroll:     20000,
      carda:        '',
      cardb:        '',
      status:       'WAIT',
      inactive:     false,
      isBreak:      false,
      reconnectRestoreStatus: null,
      subtotal_bet: 0,
      missedCount:  0,
      warned:       false,
      seat:         i,
    };
  });
}
function tryStartGame(tableID, opts = {}) {
  const cfg = tablesConfig[tableID];
  if (!cfg) return;

  const totalSeats = Number.isInteger(cfg.totalSeats) ? cfg.totalSeats : cfg.players.length;
  const activeSeats = Number.isInteger(cfg.activeSeats) ? cfg.activeSeats : totalSeats;

  // 1) Récupère la file fixe (tableau de longueur N, avec des null pour les sièges libres)
  const wait = waitingPlayersByTable[tableID] || [];

  // 2) Compte combien de sockets non-nulls
  const filledCount = wait.slice(0, activeSeats).filter(sock => sock !== null).length;
  const forceStart = Boolean(opts.force);
  const minPlayers = Number.isInteger(opts.minPlayers) ? opts.minPlayers : 2;

  // 3) Tant que tous les sièges ne sont pas occupés → on met à jour le waiting room
if (!forceStart && filledCount < activeSeats) {
  io.to(tableID).emit('updateWaitingRoom', {
    waitingCount: filledCount,
    totalSeats,
    activeSeats,
    level: cfg.level || 'Q1',
    seatsTaken: wait.map(s => Boolean(s)),
    seatLabels: cfg.players
  });
  io.to('admin').emit('updateWaitingRoom', {
    tableID,
    waitingCount: filledCount,
    totalSeats,
    activeSeats,
    level: cfg.level || 'Q1',
    seatsTaken: wait.map(s => Boolean(s)),
    seatLabels: cfg.players
  });
  return { ok: false, reason: 'waiting' };
}

  if (forceStart && filledCount < minPlayers) {
    return {
      ok: false,
      error: `Pas assez de joueurs connectes pour demarrer (${filledCount}/${minPlayers}).`
    };
  }

  const players = buildPlayersFromWaiting(cfg, wait, totalSeats, activeSeats, opts);
  const activeCount = players.filter(p => p.status !== 'BUST' && p.status !== 'WAIT').length;
  if (activeCount < minPlayers) {
    return {
      ok: false,
      error: `Pas assez de joueurs actifs pour demarrer (${activeCount}/${minPlayers}).`
    };
  }

  syncCreditsOnPlayers(players);

  // ──────────────────────────────────────────────────────────────
  // Initialisation de l'état de jeu (tous les sièges sont désormais remplis)
  // ──────────────────────────────────────────────────────────────
  const state = gameStateByTable[tableID] = {
    ...(cfg.demo ? { demo: true, demoRoomID: tableID, demoRevision: 0 } : {}),
    roundNumber: 1,
    players,
    pot:                  0,
    board:                [],
    current_bet:          0,
    current_bettor_index: 0,
    phase:                'preflop',
    checkCount:           0,
    roundEvaluated:       false,
    mode:                cfg.mode || 'normal',
    level:               cfg.level || 'Q1',
    totalSeats,
    activeSeats,
    
  // 🔽🔽🔽 NEW
  timeFrozen:        false, // timer figé ou pas
  timeFrozenFor:     null,  // seat concerné
  adminPaused:       false,
  revealWinnerDeadline: null,
  timeExtensionUsed: false, // TIME déjà utilisé pour ce tour ?
  calcPrimaryUsed:   false, // reset timer via calculatrice (phase normale)
  calcExtensionUsed: false, // reset timer via calculatrice (phase TIME)
  add30Used:         false, // +30s déjà utilisé pour ce tour ?
  add30BonusMs:      0,     // cumul des +30s pour ce tour
  revealSeq:         null,  // séquence de reveal en cours
  revealSeqDone:     false, // reveal séquentiel terminé
  allBreakPaused:    false,
  allBreakResumeSeat: null,
  allBreakJoinSeats:  null,
  };

  // Réinitialisation des montants courants
  competitiveSettlement.begin(state, { roomId: tableID, eligible: !cfg.demo && !isTrainingLevel(cfg.level), quickPlay: Boolean(cfg.quickPlay) });
  currentBetByTable[tableID]      = 0;
  currentMinRaiseByTable[tableID] = 0;

  // Distribution & blinds
  distributeCards(state);
  if (cfg.mode === 'hyper') {
    prepareHyperAutoState(tableID, false, state); // hyper pur: pas de timer/blinds/tour
  } else {
    configureBlinds(state, tableID);
  }

  // Lancement et premier update
 // 1) On fixe tout de suite le timer côté serveur
  if (cfg.mode !== 'hyper') resetTurnTimer(tableID); 
  // 2) On émet startGame et updateTable, désormais avec turnStartTime & turnDuration valides
io.to(tableID).emit('startGame', { tableID, mode: cfg.mode, gameState: state });
broadcastTableState(tableID);

  // Vider la file pour ne pas relancer
  waitingPlayersByTable[tableID] = [];

  // ──────────────────────────────────────────────────────────────
  // Mode hyper (all-in automatique + phases)
  // ──────────────────────────────────────────────────────────────
  if (cfg.mode === 'hyper') {
    const hyperPlayers = getHyperAutoAllInOrder(state);
    const boardStartMs = Math.max(
      HYPER_BOARD_START_DELAY_MS,
      HYPER_ALLIN_START_DELAY_MS + (hyperPlayers.length * 1000)
    );

    // 1) All-in un par un à partir de +3s
    hyperPlayers.forEach((p, i) => {
      setTimeout(() => {
        const shove = Math.max(0, p.bankroll | 0);
        p.status = 'ALLIN';
        p.subtotal_bet = (p.subtotal_bet || 0) + shove;
        p.total_bet_hand = (p.total_bet_hand || 0) + shove;
        state.pot += shove;
        p.bankroll = 0;
        currentBetByTable[tableID] = state.current_bet = Math.max(
          currentBetByTable[tableID] || 0,
          p.subtotal_bet
        );
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
        io.to('admin').emit('updateTable', { tableID, gameState: state });
      }, HYPER_ALLIN_START_DELAY_MS + (i * 1000));
    });

    // 2) Flop
    setTimeout(() => {
      state.phase = 'flop';
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, boardStartMs);

    // 3) Turn
    setTimeout(() => {
      state.phase = 'turn';
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, boardStartMs + 5000);

    // 4) River
    setTimeout(() => {
      state.phase = 'river';
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, boardStartMs + 10000);

    // 5) Showdown
    setTimeout(() => {
      state.phase = 'reveal';
      if (!state.roundEvaluated) {
        if (!handleHyperTie(tableID)) {
          evaluateRound(tableID, { skipRevealInit: true });
          // Hyper: auto-reveal all ALL-IN hands immediately (no HIDE/SHOW)
          initRevealSequence(tableID, false, { defaultAction: 'show', forceShowAllIn: true });
          state.roundEvaluated = true;
        }
      }
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, boardStartMs + 20000);
  }
  return { ok: true };
}


// ──────────────────────────────────────────────────────────────
// 9.5) tryStartMatch2: même logique, mais pour 2 joueurs
// ──────────────────────────────────────────────────────────────

function tryStartMatch2(matchID, opts = {}) {
  // 1) Récupère le buffer fixe de longueur 2 (initialisé dans joinGame)
  const waiting = waitingPlayersByMatch2[matchID] || [];
  const N       = matches2Config[matchID]?.players.length || 2;

  // 2) Compte combien de places sont déjà prises
  const takenCount = waiting.filter(s => s !== null).length;

  const forceStart = Boolean(opts.force);
  const minPlayers = Number.isInteger(opts.minPlayers) ? opts.minPlayers : 2;

  // 3) Tant que tous les sièges ne sont pas occupés → on envoie juste la waiting-room
if ((!forceStart && (waiting.length !== N || takenCount < N)) ||
    (forceStart && takenCount < minPlayers)) {
  io.to(matchID).emit('updateWaitingRoom', {
    matchID,
    waitingCount: takenCount,
    totalSeats: N,
    level: (matches2Config[matchID]?.level) || 'Q1'
  });
  io.to('admin').emit('updateWaitingRoom', {
    matchID,
    waitingCount: takenCount,
    totalSeats: N,
    level: (matches2Config[matchID]?.level) || 'Q1'
  });
  return {
    ok: false,
    error: `Pas assez de joueurs connectes pour demarrer (${takenCount}/${minPlayers}).`
  };
}

  // 4) Tous les sièges sont pris → on construit l’état initial du match
  const cfg   = matches2Config[matchID];
  const players = buildPlayersFromWaiting(cfg, waiting, N, N, opts);
  syncCreditsOnPlayers(players);
  const state = gameStateByTable[matchID] = {
    ...(cfg.demo ? { demo: true, demoRoomID: matchID, demoRevision: 0, totalSeats: N, activeSeats: N } : {}),
    roundNumber: 1,
    players,
    pot:                  0,
    board:                [],
    current_bet:          0,
    current_bettor_index: 0,
    phase:                'preflop',
    checkCount:           0,
    roundEvaluated:       false,
    mode:                cfg.mode || 'normal',
    level:               cfg.level || 'Q1',

    // 🔽🔽 Pour gérer le TIME en duel aussi
    timeFrozen:        false,
    timeFrozenFor:     null,
    adminPaused:       false,
    revealWinnerDeadline: null,
    timeExtensionUsed: false,
    calcPrimaryUsed:   false, // reset timer via calculatrice (phase normale)
    calcExtensionUsed: false, // reset timer via calculatrice (phase TIME)
    add30Used:         false, // +30s déjà utilisé pour ce tour ?
    add30BonusMs:      0,     // cumul des +30s pour ce tour
    revealSeq:         null,  // séquence de reveal en cours
    revealSeqDone:     false, // reveal séquentiel terminé
    allBreakPaused:    false,
    allBreakResumeSeat: null,
    allBreakJoinSeats:  null,
  };

  // 5) Réinitialisation des bets
  competitiveSettlement.begin(state, { roomId: matchID, isFinal: true, eligible: !cfg.demo && Boolean(cfg.isChampionshipFinal) && !isTrainingLevel(cfg.level) });
  currentBetByMatch2[matchID]      = 0;
  currentMinRaiseByMatch2[matchID] = 0;

  // 6) Distribution et blinds
  distributeCards(state);
  if (cfg.mode === 'hyper') {
    prepareHyperAutoState(matchID, true, state); // hyper pur: pas de timer/blinds/tour
  } else {
    configureBlinds(state, matchID);
  }

  // 7) Lancement de la partie
if (cfg.mode !== 'hyper') resetTurnTimer2(matchID);
io.to(matchID).emit('startGame', { matchID, mode: cfg.mode, gameState: state });
broadcastMatch2State(matchID);

  // 9) Réinitialise le buffer pour ne pas relancer
  waitingPlayersByMatch2[matchID] = Array(N).fill(null);

  // 10) Mode hyper-fast (identique à ton code existant)
  if (cfg.mode === 'hyper') {
    const hyperPlayers = getHyperAutoAllInOrder(state);
    const boardStartMs = Math.max(
      HYPER_BOARD_START_DELAY_MS,
      HYPER_ALLIN_START_DELAY_MS + (hyperPlayers.length * 1000)
    );

    // a) All-in un par un à partir de +3s
    hyperPlayers.forEach((p, i) => {
      setTimeout(() => {
        const shove = Math.max(0, p.bankroll | 0);
        p.status = 'ALLIN';
        p.subtotal_bet = (p.subtotal_bet || 0) + shove;
        p.total_bet_hand = (p.total_bet_hand || 0) + shove;
        state.pot += shove;
        p.bankroll = 0;
currentBetByMatch2[matchID] = state.current_bet =
  Math.max(currentBetByMatch2[matchID] || 0, p.subtotal_bet);

      // **DEUX UI** mis à jour
      io.to(matchID).emit('updateTable', state);
io.to(matchID).emit('updateMatch2', { matchID, gameState: gameStateByTable[matchID] });

io.to(`spectate-match2:${matchID}`).emit('spectatorState', {
  type: 'match2',
  matchID,
  gameState: gameStateByTable[matchID]
});
        io.to('admin').emit('updateMatch2', { matchID, gameState: state });
      }, HYPER_ALLIN_START_DELAY_MS + (i * 1000));
    });

    // b) Flop
    setTimeout(() => {
      state.phase = 'flop';
      io.to(matchID).emit('updateTable',  state);
io.to(matchID).emit('updateMatch2', { matchID, gameState: gameStateByTable[matchID] });

io.to(`spectate-match2:${matchID}`).emit('spectatorState', {
  type: 'match2',
  matchID,
  gameState: gameStateByTable[matchID]
});
      io.to('admin').emit('updateMatch2', { matchID, gameState: state });
    }, boardStartMs);

    // c) Turn (+5s)
    setTimeout(() => {
      state.phase = 'turn';
      io.to(matchID).emit('updateTable',  state);
io.to(matchID).emit('updateMatch2', { matchID, gameState: gameStateByTable[matchID] });

io.to(`spectate-match2:${matchID}`).emit('spectatorState', {
  type: 'match2',
  matchID,
  gameState: gameStateByTable[matchID]
});
      io.to('admin').emit('updateMatch2', { matchID, gameState: state });
    }, boardStartMs + 5000);

    // d) River (+5s)
    setTimeout(() => {
      state.phase = 'river';
      io.to(matchID).emit('updateTable',  state);
io.to(matchID).emit('updateMatch2', { matchID, gameState: gameStateByTable[matchID] });

io.to(`spectate-match2:${matchID}`).emit('spectatorState', {
  type: 'match2',
  matchID,
  gameState: gameStateByTable[matchID]
});
      io.to('admin').emit('updateMatch2', { matchID, gameState: state });
    }, boardStartMs + 10000);

    // e) Showdown (+10s)
    setTimeout(() => {
      state.phase = 'reveal';
      if (!state.roundEvaluated) {
        // tie-break
        if (!handleHyperTie2(matchID)) {
          evaluateRound2(matchID, { skipRevealInit: true });
          // Hyper: auto-reveal all ALL-IN hands immediately (no HIDE/SHOW)
          initRevealSequence(matchID, true, { defaultAction: 'show', forceShowAllIn: true });
          state.roundEvaluated = true;
        }
      }
      // mise à jour finale
      io.to(matchID).emit('updateTable', state);
io.to(matchID).emit('updateMatch2', { matchID, gameState: gameStateByTable[matchID] });

io.to(`spectate-match2:${matchID}`).emit('spectatorState', {
  type: 'match2',
  matchID,
  gameState: gameStateByTable[matchID]
});
      io.to('admin').emit('updateMatch2', { matchID, gameState: state });
    }, boardStartMs + 20000);
  }
  return { ok: true };
}



// ───────────────────────────────
// SIDE POTS — helpers
// ───────────────────────────────
function buildSidePots(state) {
  // contribution par joueur (toutes les mises comptent, meme si FOLD/BUST/WAIT)
  const contribs = state.players.map(p => (p && !p.inactive ? (p.total_bet_hand || 0) : 0));

  // niveaux de cap triés (ex: 1000, 2500, 4000 …)
  const caps = [...new Set(contribs.filter(c => c > 0))].sort((a, b) => a - b);

  const pots = [];
  let prev = 0;

  for (const cap of caps) {
    let amount = 0;
    const eligible = [];
    state.players.forEach((p, i) => {
      const c = contribs[i];
      if (c > prev) amount += Math.min(c, cap) - prev;
      if (p && !p.inactive && !['FOLD','BUST','WAIT'].includes(p.status) && c >= cap) {
        eligible.push(i);
      }
    });
    if (amount > 0 && eligible.length > 0) {
      pots.push({ amount, eligible }); // eligible = indices de joueurs qui peuvent gagner ce pot
    }
    prev = cap;
  }
  return pots;
}

function solveHands(state) {
  const conv = c => {
    const s = c[0], r = parseInt(c.slice(1), 10);
    const M = {14:'A',13:'K',12:'Q',11:'J',10:'T'};
    return (M[r] || r) + s;
  };
  const solved = state.players.map(p =>
    (!p || p.inactive || ['FOLD','BUST','WAIT'].includes(p.status)) ? null
      : Hand.solve([p.carda, p.cardb, ...state.board].map(conv))
  );
  return solved;
}

// split équitable en entiers ; distribue les restes +1 en round-robin
function distributeChipsEvenly(playersIdx, amount, state) {
  if (playersIdx.length === 0 || amount <= 0) return;
  const base = Math.floor(amount / playersIdx.length);
  let rem    = amount - base * playersIdx.length;

  playersIdx.forEach(i => state.players[i].bankroll += base);
  for (let k = 0; k < rem; k++) {
    state.players[ playersIdx[k % playersIdx.length] ].bankroll += 1;
  }
}

function isSkippablePlayer(p){
  return p.status === 'FOLD'
      || p.status === 'BUST'
      || p.status === 'ALLIN'
      || p.status === 'WAIT'
      || ((p.bankroll | 0) === 0); // 0 jeton => jamais la main
}

function getHyperAutoAllInOrder(state) {
  if (!state || !Array.isArray(state.players)) return [];
  const totalSeats = state.players.length;
  const activeSeats = Number.isInteger(state.activeSeats)
    ? Math.max(0, Math.min(totalSeats, state.activeSeats))
    : totalSeats;
  return Array.from({ length: activeSeats }, (_, idx) => ({ idx, p: state.players[idx] }))
    .filter(({ p }) => p && !p.inactive)
    .map(({ idx, p }) => {
      // En mode hyper, les sièges hors-ligne avec jetons restent "actifs" visuellement/logiquement.
      if (!p.isBreak && ((p.bankroll | 0) > 0) && (p.status === 'WAIT') && !p.id) {
        p.status = '';
      }
      // Corrige un état incohérent (BUST avec jetons restants).
      if (p.status === 'BUST' && ((p.bankroll | 0) > 0)) {
        p.status = p.isBreak ? 'WAIT' : '';
      }
      return { idx, p };
    })
    .filter(({ p }) => !(p.status === 'BUST' && ((p.bankroll | 0) <= 0)))
    .sort((a, b) => {
      const seatA = Number.isInteger(a.p.seat) ? a.p.seat : a.idx;
      const seatB = Number.isInteger(b.p.seat) ? b.p.seat : b.idx;
      return seatA - seatB;
    })
    .map(({ p }) => p);
}

function prepareHyperAutoState(roomID, isMatch2, state) {
  if (!state) return [];

  // Mode hyper "pur": pas de tour, pas de timer, pas de blinds.
  state.dealerIndex = -1;
  state.smallBlindIndex = -1;
  state.bigBlindIndex = -1;
  state.smallBlindAmount = 0;
  state.bigBlindAmount = 0;
  state.minOpen = 0;
  state.current_bet = 0;
  state.current_bettor_index = -1;
  state.bbOptionPending = false;
  state.turnStartTime = null;
  state.turnDuration = 0;
  state.timeFrozen = false;
  state.timeFrozenFor = null;
  state.checkCount = 0;

  if (isMatch2) {
    currentBetByMatch2[roomID] = 0;
    currentMinRaiseByMatch2[roomID] = 0;
  } else {
    currentBetByTable[roomID] = 0;
    currentMinRaiseByTable[roomID] = 0;
  }

  return getHyperAutoAllInOrder(state);
}

function emitHyperProgress(roomID, isMatch2, state) {
  io.to(roomID).emit('updateTable', state);
  if (isMatch2) {
    io.to(roomID).emit('updateMatch2', { matchID: roomID, gameState: gameStateByTable[roomID] });
    io.to(`spectate-match2:${roomID}`).emit('spectatorState', {
      type: 'match2',
      matchID: roomID,
      gameState: gameStateByTable[roomID]
    });
    io.to('admin').emit('updateMatch2', { matchID: roomID, gameState: state });
  } else {
    io.to(`spectate-table:${roomID}`).emit('spectatorState', {
      type: 'table',
      tableID: roomID,
      gameState: state
    });
    io.to('admin').emit('updateTable', { tableID: roomID, gameState: state });
  }
}

function scheduleHyperAutoHand(roomID, isMatch2) {
  const state = gameStateByTable[roomID];
  if (!state) return false;
  const cfg = isMatch2 ? matches2Config[roomID] : tablesConfig[roomID];
  if (!cfg || cfg.mode !== 'hyper') return false;

  const hyperPlayers = getHyperAutoAllInOrder(state);
  const boardStartMs = Math.max(
    HYPER_BOARD_START_DELAY_MS,
    HYPER_ALLIN_START_DELAY_MS + (hyperPlayers.length * 1000)
  );

  // 1) All-in un par un à partir de +3s
  hyperPlayers.forEach((p, i) => {
    setTimeout(() => {
      if (!gameStateByTable[roomID] || gameStateByTable[roomID] !== state) return;
      if (!p || p.inactive) return;
      if (p.status === 'BUST' && ((p.bankroll | 0) <= 0)) return;
      const shove = Math.max(0, p.bankroll | 0);
      p.status = 'ALLIN';
      p.subtotal_bet = (p.subtotal_bet || 0) + shove;
      p.total_bet_hand = (p.total_bet_hand || 0) + shove;
      state.pot += shove;
      p.bankroll = 0;

      if (isMatch2) {
        currentBetByMatch2[roomID] = state.current_bet =
          Math.max(currentBetByMatch2[roomID] || 0, p.subtotal_bet);
      } else {
        currentBetByTable[roomID] = state.current_bet =
          Math.max(currentBetByTable[roomID] || 0, p.subtotal_bet);
      }
      emitHyperProgress(roomID, isMatch2, state);
    }, HYPER_ALLIN_START_DELAY_MS + (i * 1000));
  });

  // 2) Flop
  setTimeout(() => {
    if (!gameStateByTable[roomID] || gameStateByTable[roomID] !== state) return;
    state.phase = 'flop';
    emitHyperProgress(roomID, isMatch2, state);
  }, boardStartMs);

  // 3) Turn
  setTimeout(() => {
    if (!gameStateByTable[roomID] || gameStateByTable[roomID] !== state) return;
    state.phase = 'turn';
    emitHyperProgress(roomID, isMatch2, state);
  }, boardStartMs + 5000);

  // 4) River
  setTimeout(() => {
    if (!gameStateByTable[roomID] || gameStateByTable[roomID] !== state) return;
    state.phase = 'river';
    emitHyperProgress(roomID, isMatch2, state);
  }, boardStartMs + 10000);

  // 5) Showdown
  setTimeout(() => {
    if (!gameStateByTable[roomID] || gameStateByTable[roomID] !== state) return;
    state.phase = 'reveal';
    if (!state.roundEvaluated) {
      if (isMatch2) {
        if (!handleHyperTie2(roomID)) {
          evaluateRound2(roomID, { skipRevealInit: true });
          initRevealSequence(roomID, true, { defaultAction: 'show', forceShowAllIn: true });
          state.roundEvaluated = true;
        }
      } else {
        if (!handleHyperTie(roomID)) {
          evaluateRound(roomID, { skipRevealInit: true });
          initRevealSequence(roomID, false, { defaultAction: 'show', forceShowAllIn: true });
          state.roundEvaluated = true;
        }
      }
    }
    emitHyperProgress(roomID, isMatch2, state);
  }, boardStartMs + 20000);

  return true;
}

const REVEAL_DECISION_MS = 5000;
const REVEAL_WINNER_MS = 10000;
const WINNER_SCREEN_DELAY_MS = 5000;
const revealFinishTimersByRoom = {};

function emitRoomState(roomID, isMatch2) {
  if (isMatch2) broadcastMatch2State(roomID);
  else broadcastTableState(roomID);
}

function clearRevealSequence(roomID, state) {
  if (revealTimersByRoom[roomID]) {
    clearTimeout(revealTimersByRoom[roomID]);
    delete revealTimersByRoom[roomID];
  }
  if (revealFinishTimersByRoom[roomID]) {
    clearTimeout(revealFinishTimersByRoom[roomID]);
    delete revealFinishTimersByRoom[roomID];
  }
  if (!state) return;
  state.revealSeq = null;
  state.revealSeqDone = false;
  state.revealWinnerDeadline = null;
  if (Array.isArray(state.players)) {
    state.players.forEach(p => {
      if (p) p.revealStatus = null;
    });
  }
}

function scheduleRevealDecisionTimeout(roomID, isMatch2, seat, ms) {
  if (gameStateByTable[roomID]?.demo) return;
  if (revealTimersByRoom[roomID]) {
    clearTimeout(revealTimersByRoom[roomID]);
    delete revealTimersByRoom[roomID];
  }
  const delay = Math.max(0, ms || REVEAL_DECISION_MS);
  revealTimersByRoom[roomID] = setTimeout(() => {
    const st = gameStateByTable[roomID];
    if (!st || !st.revealSeq || st.adminPaused) return;
    const defaultAction = st.revealSeq.defaultAction || 'show';
    applyRevealChoice(roomID, isMatch2, seat, defaultAction === 'hide');
  }, delay);
}

function markInShowdown(state, useRevealStatus = false) {
  if (!state || !Array.isArray(state.players)) return;
  state.players.forEach(p => {
    if (!p) return;
    const hidden = useRevealStatus && p.revealStatus === 'hide';
    p.inShowdown = !p.inactive && !['FOLD', 'BUST', 'WAIT'].includes(p.status) && !hidden;
  });
}

function applyRevealChoice(roomID, isMatch2, seat, hide) {
  const state = gameStateByTable[roomID];
  if (!state || !state.revealSeq) return;
  if (state.adminPaused) return;

  if (state.revealSeq.activeSeat !== seat) {
    const seq = state.revealSeq;
    const pos = Array.isArray(seq.order) ? seq.order.indexOf(seat) : -1;
    if (pos < 0 || pos < seq.index) return;
    // Pré-enregistre le choix si le joueur clique trop tôt
    const pEarly = state.players[seat];
    if (pEarly) pEarly.revealStatus = hide ? 'hide' : 'show';
    return;
  }
  const p = state.players[seat];
  if (!p) return;

  const forceShowAllIn = !!state.revealSeq.forceShowAllIn;
  if (forceShowAllIn) hide = false;

  const alivePlayers = state.players.filter(pl =>
    pl && !['FOLD','BUST','WAIT'].includes(pl.status)
  );
  const isLastAlive = alivePlayers.length === 1 && alivePlayers[0] === p;

  p.revealStatus = hide ? 'hide' : 'show';
  if (hide && !isLastAlive) {
    p.status = 'FOLD';
    p.inShowdown = false;
  }

  if (hide) {
    if (isLastAlive) {
      const winner = p;
      if (winner && winner.status !== 'WINNER') {
        winner.status = 'WINNER';
      }
      if (winner && winner.bankroll != null) {
        winner.bankroll += state.pot || 0;
      }
      state.pot = 0;
      state.winReason = {
        type: 'hide',
        winnerId: winner?.id,
        loserId: null
      };
      state.roundEvaluated = true;

      if (revealTimersByRoom[roomID]) {
        clearTimeout(revealTimersByRoom[roomID]);
        delete revealTimersByRoom[roomID];
      }
      if (revealFinishTimersByRoom[roomID]) {
        clearTimeout(revealFinishTimersByRoom[roomID]);
        delete revealFinishTimersByRoom[roomID];
      }
      if (state.revealSeq) {
        state.revealSeq.activeSeat = null;
        state.revealSeq.deadline = null;
        state.revealSeq.done = true;
      }
      state.revealSeqDone = true;

      emitRoomState(roomID, isMatch2);
      if (!revealFinishTimersByRoom[roomID]) {
        state.revealWinnerDeadline = Date.now() + REVEAL_WINNER_MS;
        revealFinishTimersByRoom[roomID] = setTimeout(() => {
          delete revealFinishTimersByRoom[roomID];
          dealNextHand(roomID);
        }, REVEAL_WINNER_MS);
      }
      return;
    }
    const remaining = state.players.filter(pl =>
      pl && !['FOLD','BUST','WAIT'].includes(pl.status)
    );
    if (remaining.length === 1) {
      const winner = remaining[0];
      winner.status = 'WINNER';
      if (winner.bankroll != null) {
        winner.bankroll += state.pot || 0;
      }
      state.pot = 0;
      state.winReason = {
        type: 'hide',
        winnerId: winner.id,
        loserId: p?.id
      };
      state.roundEvaluated = true;

      if (revealTimersByRoom[roomID]) {
        clearTimeout(revealTimersByRoom[roomID]);
        delete revealTimersByRoom[roomID];
      }
      if (revealFinishTimersByRoom[roomID]) {
        clearTimeout(revealFinishTimersByRoom[roomID]);
        delete revealFinishTimersByRoom[roomID];
      }
      if (state.revealSeq) {
        state.revealSeq.activeSeat = null;
        state.revealSeq.deadline = null;
        state.revealSeq.done = true;
      }
      state.revealSeqDone = true;

      emitRoomState(roomID, isMatch2);
      if (!revealFinishTimersByRoom[roomID]) {
        state.revealWinnerDeadline = Date.now() + REVEAL_WINNER_MS;
        revealFinishTimersByRoom[roomID] = setTimeout(() => {
          delete revealFinishTimersByRoom[roomID];
          dealNextHand(roomID);
        }, REVEAL_WINNER_MS);
      }
      return;
    }
  }

  state.revealSeq.index += 1;

  emitRoomState(roomID, isMatch2);
  advanceRevealSequence(roomID, isMatch2);
}

function endIfOnlyOneActiveAndOthersDisconnected(state) {
  if (!state || !Array.isArray(state.players)) return false;
  const active = state.players.filter(p => p && !p.inactive && p.status !== 'BUST' && p.status !== 'WAIT');
  if (active.length !== 1) return false;

  const winner = active[0];
  const others = state.players.filter(p => p && !p.inactive && p !== winner && p.status !== 'BUST');
  if (others.length === 0) return false;

  const hasBlockingWaiter = others.some(p => {
    if (p.status !== 'WAIT') return true;
    // WAIT connecte sans BREAK -> ne pas terminer la partie
    return (!p.isBreak && p.id);
  });
  if (hasBlockingWaiter) return false;

  let transferred = 0;
  state.players.forEach(p => {
    if (!p) return;
    if (p === winner) {
      p.status = 'WINNER';
      return;
    }
    const br = Math.max(0, p.bankroll | 0);
    if (br > 0) {
      transferred += br;
    }
    p.status = 'BUST';
    p.bankroll = 0;
  });
  if (winner && transferred > 0) {
    winner.bankroll = (winner.bankroll | 0) + transferred;
  }
  state.gameFinished = true;
  return true;
}

function finalizeRevealWinners(roomID, isMatch2) {
  const state = gameStateByTable[roomID];
  if (!state || state.roundEvaluated) return;
  const alive = state.players.filter(p => p && !p.inactive && !['FOLD','BUST','WAIT'].includes(p.status));
  if (alive.length === 1) {
    const winner = alive[0];
    if (winner && winner.status !== 'WINNER') winner.status = 'WINNER';
    if (winner && winner.bankroll != null) {
      winner.bankroll += state.pot || 0;
    }
    state.pot = 0;
    state.winReason = { type: 'single', winnerId: winner?.id, winnerLabel: winner?.label };
    state.roundEvaluated = true;
    emitRoomState(roomID, isMatch2);
    return;
  }
  if (isMatch2) evaluateRound2(roomID, { useRevealStatus: true, skipRevealInit: true });
  else evaluateRound(roomID, { useRevealStatus: true, skipRevealInit: true });
  state.roundEvaluated = true;
  emitRoomState(roomID, isMatch2);
}

function advanceRevealSequence(roomID, isMatch2) {
  const state = gameStateByTable[roomID];
  if (!state || !state.revealSeq) return;
  if (state.adminPaused) return;

  const seq = state.revealSeq;
  if (revealTimersByRoom[roomID]) {
    clearTimeout(revealTimersByRoom[roomID]);
    delete revealTimersByRoom[roomID];
  }

  if (seq.index >= seq.order.length) {
    seq.activeSeat = null;
    seq.deadline = null;
    seq.done = true;
    state.revealSeqDone = true;
    finalizeRevealWinners(roomID, isMatch2);
    emitRoomState(roomID, isMatch2);
    if (!revealFinishTimersByRoom[roomID]) {
      state.revealWinnerDeadline = Date.now() + REVEAL_WINNER_MS;
      revealFinishTimersByRoom[roomID] = setTimeout(() => {
        delete revealFinishTimersByRoom[roomID];
        dealNextHand(roomID);
      }, REVEAL_WINNER_MS);
    }
    return;
  }

  const seat = seq.order[seq.index];
  seq.activeSeat = seat;
  seq.deadline = state.demo ? null : Date.now() + REVEAL_DECISION_MS;

  const player = state.players[seat];
  if (player && (player.revealStatus === 'show' || player.revealStatus === 'hide')) {
    return applyRevealChoice(roomID, isMatch2, seat, player.revealStatus === 'hide');
  }
  // Hyper/all-in reveal: no player choice, every in-showdown hand is auto-shown.
  if (seq.forceShowAllIn && player) {
    player.revealStatus = 'show';
    seq.index += 1;
    emitRoomState(roomID, isMatch2);
    return advanceRevealSequence(roomID, isMatch2);
  }
  if (player?.id) {
    io.to(player.id).emit('revealPrompt', {
      seatIndex: seat,
      ms: REVEAL_DECISION_MS
    });
  }

  scheduleRevealDecisionTimeout(roomID, isMatch2, seat, REVEAL_DECISION_MS);

  emitRoomState(roomID, isMatch2);
}

function initRevealSequence(roomID, isMatch2, opts = {}) {
  const state = gameStateByTable[roomID];
  if (!state || !Array.isArray(state.players)) return;

  clearRevealSequence(roomID, state);
  const order = state.players
    .map((p, i) => (p && p.inShowdown ? i : -1))
    .filter(i => i >= 0);

  state.revealSeq = {
    order,
    index: 0,
    activeSeat: null,
    deadline: null,
    done: false,
    defaultAction: opts.defaultAction || 'show',
    forceShowAllIn: !!opts.forceShowAllIn
  };
  state.revealSeqDone = false;

  advanceRevealSequence(roomID, isMatch2);
}

function pauseGame(roomID, isMatch2, opts = {}) {
  const state = gameStateByTable[roomID];
  if (!state || state.adminPaused) return;
  const forceBreakAll = opts.forceBreakAll !== false;

  const now = Date.now();
  state.adminPaused = true;
  state.adminPause = {
    prevPlayers: state.players.map(p => p ? { status: p.status, isBreak: !!p.isBreak } : null),
    timeFrozen: state.timeFrozen,
    timeFrozenFor: state.timeFrozenFor,
    turnRemainingMs: null,
    revealRemainingMs: null,
    revealActiveSeat: null,
    revealWinnerRemainingMs: null
  };

  // Stop action timer and preserve remaining time
  if (['preflop','flop','turn','river'].includes(state.phase) && !state.timeFrozen) {
    const remaining = Math.max(0, (state.turnDuration || 0) - (now - (state.turnStartTime || now)));
    state.disconnectPaused = true;
    state.turnRemainingMs = remaining;
    state.adminPause.turnRemainingMs = remaining;
    if (turnTimersByTable[roomID]) {
      clearTimeout(turnTimersByTable[roomID]);
      delete turnTimersByTable[roomID];
    }
  }

  // Pause reveal decision timer if needed
  if (state.revealSeq && !state.revealSeq.done && state.revealSeq.activeSeat != null) {
    const remaining = Math.max(0, (state.revealSeq.deadline || now) - now);
    state.adminPause.revealRemainingMs = remaining;
    state.adminPause.revealActiveSeat = state.revealSeq.activeSeat;
    if (revealTimersByRoom[roomID]) {
      clearTimeout(revealTimersByRoom[roomID]);
      delete revealTimersByRoom[roomID];
    }
  }

  // Pause winner delay if it is running
  if (state.revealSeqDone && state.revealWinnerDeadline) {
    const remaining = Math.max(0, state.revealWinnerDeadline - now);
    state.adminPause.revealWinnerRemainingMs = remaining;
    if (revealFinishTimersByRoom[roomID]) {
      clearTimeout(revealFinishTimersByRoom[roomID]);
      delete revealFinishTimersByRoom[roomID];
    }
  }

  // Force all seats in BREAK (admin pause only)
  if (forceBreakAll) {
    state.players.forEach(p => {
      if (!p) return;
      p.isBreak = true;
      if (p.status !== 'BUST') p.status = 'WAIT';
    });
  }

  emitRoomState(roomID, isMatch2);
}

function shouldPauseForAllBreak(state) {
  if (!state || !Array.isArray(state.players)) return false;
  // On ne considère que les joueurs connectés
  const alive = state.players.filter(
    p => p && !p.inactive && p.status !== 'BUST' && isSocketConnected(p.id)
  );
  if (alive.length === 0) return false;
  return alive.every(p => p.status === 'WAIT' && p.isBreak);
}

function markAllBreakPause(state) {
  if (!state) return;
  state.allBreakPaused = true;
  state.allBreakResumeSeat = null;
  state.allBreakJoinSeats = state.players
    .map((p, i) => (p && !p.inactive && p.status !== 'BUST' && isSocketConnected(p.id)) ? i : -1)
    .filter(i => i >= 0);
}

function clearAllBreakPause(state) {
  if (!state) return;
  state.allBreakPaused = false;
  state.allBreakResumeSeat = null;
  state.allBreakJoinSeats = null;
}

function resumeFromAllBreak(roomID, isMatch2) {
  const state = gameStateByTable[roomID];
  if (!state || !state.adminPaused || !state.allBreakPaused) return;

  const hasJoiner = state.players.some(p => p && p.id && p.status === 'WAIT' && !p.isBreak);
  if (!hasJoiner) return;

  // On repart sur une nouvelle main dès qu'au moins un joueur a "JOIN"
  state.adminPaused = false;
  state.adminPause = null;
  clearAllBreakPause(state);
  dealNextHand(roomID);
  if (isMatch2) broadcastMatch2State(roomID);
  else broadcastTableState(roomID);
}

function resumeGame(roomID, isMatch2) {
  const state = gameStateByTable[roomID];
  if (!state || !state.adminPaused) return;

  const snap = state.adminPause || {};
  state.adminPaused = false;

  if (Array.isArray(snap.prevPlayers)) {
    state.players.forEach((p, i) => {
      if (!p || !snap.prevPlayers[i]) return;
      p.status = snap.prevPlayers[i].status;
      p.isBreak = snap.prevPlayers[i].isBreak;
    });
  }

  state.timeFrozen = !!snap.timeFrozen;
  state.timeFrozenFor = snap.timeFrozenFor ?? null;
  state.disconnectPaused = false;

  // Resume action timer with remaining time
  if (['preflop','flop','turn','river'].includes(state.phase) && !state.timeFrozen) {
    const remaining = typeof snap.turnRemainingMs === 'number' ? snap.turnRemainingMs : null;
    if (remaining != null) {
      const override = {
        turnStartTime: Date.now(),
        turnDuration: Math.max(1000, remaining)
      };
      if (isMatch2) resetTurnTimer2(roomID, false, true, override);
      else resetTurnTimer(roomID, false, true, override);
    }
  }

  // Resume reveal decision timer if needed
  if (state.revealSeq && !state.revealSeq.done && state.revealSeq.activeSeat != null) {
    const remaining = typeof snap.revealRemainingMs === 'number' ? snap.revealRemainingMs : REVEAL_DECISION_MS;
    state.revealSeq.deadline = Date.now() + remaining;
    const seat = state.revealSeq.activeSeat;
    const player = state.players[seat];
    if (player?.id) {
      io.to(player.id).emit('revealPrompt', { seatIndex: seat, ms: remaining });
    }
    scheduleRevealDecisionTimeout(roomID, isMatch2, seat, remaining);
  }

  // Resume winner delay if needed
  if (state.revealSeqDone && typeof snap.revealWinnerRemainingMs === 'number') {
    const remaining = Math.max(0, snap.revealWinnerRemainingMs);
    state.revealWinnerDeadline = Date.now() + remaining;
    revealFinishTimersByRoom[roomID] = setTimeout(() => {
      delete revealFinishTimersByRoom[roomID];
      dealNextHand(roomID);
    }, remaining);
  }

  emitRoomState(roomID, isMatch2);
}

// ──────────────────────────────────────────────────────────────
// 10) evaluateRound: showdown, pot, stats, notification
// ──────────────────────────────────────────────────────────────
function pickRestartSeat(state) {
  if (!state || !Array.isArray(state.players) || state.players.length === 0) return null;
  const N = state.players.length;
  const curIdx = Number.isInteger(state.current_bettor_index) ? state.current_bettor_index : 0;
  const isEligible = (p) => {
    if (!p || p.inactive) return false;
    if (['FOLD', 'BUST', 'ALLIN', 'WAIT'].includes(p.status)) return false;
    return (p.bankroll | 0) > 0;
  };
  for (let step = 0; step < N; step += 1) {
    const idx = (curIdx + step) % N;
    if (isEligible(state.players[idx])) return idx;
  }
  return null;
}

function forceResumeFromCurrentState(roomID, isMatch2) {
  const state = gameStateByTable[roomID];
  if (!state) return { ok: false, error: 'Partie non demarree.' };

  if (state.adminPaused) {
    resumeGame(roomID, isMatch2);
  }

  state.timeFrozen = false;
  state.timeFrozenFor = null;
  state.disconnectPaused = false;
  state.turnRemainingMs = null;
  state.add30Used = false;
  state.add30BonusMs = 0;
  state.timeExtensionUsed = false;
  state.calcPrimaryUsed = false;
  state.calcExtensionUsed = false;

  if (['preflop', 'flop', 'turn', 'river'].includes(state.phase)) {
    const seat = pickRestartSeat(state);
    if (seat == null) {
      startReveal(roomID);
      emitRoomState(roomID, isMatch2);
      return { ok: true, resumed: 'reveal' };
    }
    state.current_bettor_index = seat;
    const override = { turnStartTime: Date.now(), turnDuration: 30_000 };
    if (isMatch2) resetTurnTimer2(roomID, false, false, override);
    else resetTurnTimer(roomID, false, false, override);
    emitRoomState(roomID, isMatch2);
    return { ok: true, resumed: 'action' };
  }

  if (state.phase === 'reveal') {
    if (state.revealSeq && !state.revealSeq.done && state.revealSeq.activeSeat != null) {
      const now = Date.now();
      const remaining = Math.max(1000, (state.revealSeq.deadline || now + REVEAL_DECISION_MS) - now);
      state.revealSeq.deadline = now + remaining;
      scheduleRevealDecisionTimeout(roomID, isMatch2, state.revealSeq.activeSeat, remaining);
      emitRoomState(roomID, isMatch2);
      return { ok: true, resumed: 'reveal-choice' };
    }
    if (state.revealSeqDone) {
      const now = Date.now();
      const remaining = Math.max(0, (state.revealWinnerDeadline || now) - now);
      if (revealFinishTimersByRoom[roomID]) {
        clearTimeout(revealFinishTimersByRoom[roomID]);
      }
      revealFinishTimersByRoom[roomID] = setTimeout(() => {
        delete revealFinishTimersByRoom[roomID];
        dealNextHand(roomID);
      }, remaining);
      state.revealWinnerDeadline = now + remaining;
      emitRoomState(roomID, isMatch2);
      return { ok: true, resumed: 'reveal-finish' };
    }
    initRevealSequence(roomID, isMatch2);
    emitRoomState(roomID, isMatch2);
    return { ok: true, resumed: 'reveal-init' };
  }

  emitRoomState(roomID, isMatch2);
  return { ok: true, resumed: 'state-only' };
}

function evaluateRound(tableID, opts = {}) {
  const state = gameStateByTable[tableID];
  if (!state) return;
  const useRevealStatus = !!opts.useRevealStatus;
  const skipRevealInit = !!opts.skipRevealInit;

  // ── 1a) Marquer qui est allé jusqu'au showdown (ni FOLD ni BUST ni WAIT) ──
  markInShowdown(state, useRevealStatus);

  // ─────────────────────────────────────────────────────────────────
  // 1) Conversion interne des cartes en format "Ah", "7c", etc.
  // ─────────────────────────────────────────────────────────────────
  const conv = c => {
    const s = c[0];
    const r = parseInt(c.slice(1), 10);
    const m = {14:'A',13:'K',12:'Q',11:'J',10:'T'};
    return (m[r] || r) + s;
  };

  // ─────────────────────────────────────────────────────────────────
  // 2) Résolution des mains des joueurs encore en lice
  // ─────────────────────────────────────────────────────────────────
  const solved = state.players.map(p => {
    if (!p) return null;
    if (p.inactive || ['FOLD','BUST','WAIT'].includes(p.status)) return null;
    if (useRevealStatus && p.revealStatus === 'hide') return null;
    return Hand.solve([p.carda, p.cardb, ...state.board].map(conv));
  });
  const winners = Hand.winners(solved.filter(Boolean));
  const widx = solved
    .map((h, i) => h && winners.includes(h) ? i : -1)
    .filter(i => i >= 0);

  // ── 3) Distribution side-pots (main + annexes), y compris en cas d'égalité globale ──
const pots   = buildSidePots(state);
const potWinners = new Set();

// On marque le nom de main du (des) gagnant(s) par pot, et on distribue pot par pot
pots.forEach((pot, potIdx) => {
  // Trouve les meilleurs parmi les éligibles de ce pot
  const eligibleHands = pot.eligible
    .map(i => ({ i, h: solved[i] }))
    .filter(o => o.h); // garde seulement ceux qui ont une main valable

  if (eligibleHands.length === 0) return;

  const bestHands = Hand.winners(eligibleHands.map(o => o.h));
  const winnerIdxs = eligibleHands
    .filter(o => bestHands.includes(o.h))
    .map(o => o.i);

  // Optionnel: mémorise le nom de la main sur chaque gagnant (prend le premier nom)
  const name = bestHands[0]?.name;
  winnerIdxs.forEach(i => {
    potWinners.add(i);
    state.players[i].handName = name;
  });

  // Split du pot (entier) avec gestion du reliquat
  distributeChipsEvenly(winnerIdxs, pot.amount, state);
});

// Tout le pot global a été ventilé via side-pots
state.pot = 0;

// Statuts finaux (WINNER / BUST / '')
const newlyBusted = [];
state.players.forEach((p, i) => {
  if (!p || p.status === 'WAIT') return;
  if (potWinners.has(i)) {
    p.status = 'WINNER';
    return;
  }
  if (['FOLD', 'BUST'].includes(p.status)) return;
  p.status = p.bankroll > 0 ? '' : 'BUST';
  if (p.status === 'BUST' && p.label) {
    newlyBusted.push(p.label);
  }
});

  endIfOnlyOneActiveAndOthersDisconnected(state);
  competitiveSettlement.settle(state);

  // ─────────────────────────────────────────────────────────────────
  // 7) Historique & stats
  // ─────────────────────────────────────────────────────────────────
  // Si, par un cas rare, aucun gagnant n'a été déterminé → on skippe
  if (widx.length === 0) {
    console.warn(`evaluateRound(${tableID}) widx is empty, skipping stats.`);
    state.phase = 'reveal';
    if (!skipRevealInit) initRevealSequence(tableID, false);
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
    io.to('admin').emit('updateTable', { tableID, gameState: state });
    // relance la main suivante après 8s
    return;
   }
 
  const isTable10   = tableID in tablesConfig;
  const mode        = isTable10
    ? tablesConfig[tableID].mode
    : matches2Config[tableID].mode;
  const winnerLabel = state.players[widx[0]].label;
  if (!state.demo) {

  // Enregistre la partie
  gamesHistory.push({
    type:      isTable10 ? 'table' : 'match2',
    ...(isTable10 ? { tableID } : { matchID: tableID }),
    mode,
    winner:    winnerLabel,
    timestamp: new Date().toISOString()
  });
  saveGames();

  // MàJ des stats jouées/par mode et victoires
  state.players.forEach(p => {
    const lbl   = p.label;
    const stats = isTable10 ? statsTable : statsMatch2;
    if (!stats[lbl]) {
      stats[lbl] = {
        name:        lbl,
        gamesPlayed: 0,
        wins:        0,
        byMode:      Object.fromEntries(
          Object.keys(BLINDS).map(m => [m, { played:0, wins:0 }])
        )
      };
    }
    stats[lbl].gamesPlayed++;
    stats[lbl].byMode[mode].played++;
  });
  const statsWinner = isTable10
    ? statsTable[winnerLabel]
    : statsMatch2[winnerLabel];
  statsWinner.wins++;
  statsWinner.byMode[mode].wins++;
  if (isTable10) saveStatsTable(); else saveStatsMatch2();
  }

  // ─────────────────────────────────────────────────────────────────
  // 8) Tables 10 joueurs : BO3 de promotion + joker T1
  // ─────────────────────────────────────────────────────────────────
  const survivors   = state.players.filter(p => p && !p.inactive && p.status !== 'BUST' && p.status !== 'WAIT');
  const tableLevel = isTable10 ? normalizeCreditLevel(tablesConfig[tableID]?.level) : null;
  if (!state.demo && survivors.length === 1 && isTable10 && !isTrainingLevel(tableLevel)) {
    const finalWinner = survivors[0];
    state.players.forEach(p => {
      if (!p || !p.label || p.status === 'WAIT') return;
      const entry = ensurePlayerRecord(p.label);
      if (!entry) return;
      if (p.label === finalWinner.label) {
        startPromotionBo3(entry, tableLevel);
        if (tableLevel === 'T1') {
          entry.history.push({
            date: new Date().toISOString(),
            action: 'Gagne table T1 -> BO3 reset'
          });
        } else {
          entry.history.push({
            date: new Date().toISOString(),
            action: `Gagne table ${tableLevel} -> BO3 reset`
          });
        }
        return;
      }

      if (tableLevel === 'T1') {
        applyDropToQ1WithCreditLoss(entry, tableLevel, 'Perdu table T1');
        return;
      }

      if (tableLevel === 'T2' || tableLevel === 'T3' || tableLevel === 'T4') {
        applyDropToT1NoCreditLoss(entry, tableLevel, `Perdu table ${tableLevel}`);
        return;
      }

      applyDropToQ1WithCreditLoss(entry, tableLevel, `Perdu table ${tableLevel}`);
    });
    syncCreditsOnPlayers(state.players);
    saveLevels();
    io.to('admin').emit('profilesUpdated');
    io.to('admin').emit('levelsUpdated');
  }

  // Ranking rewards were settled above once per completed competitive game.

  // ─────────────────────────────────────────────────────────────────
  // 9) Émission des updates & notification de fin
  // ─────────────────────────────────────────────────────────────────
  if (isTable10) {
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
    io.to('admin').emit('updateTable',   { tableID, gameState: state });
    if (survivors.length === 1) {
      state.gameFinished = true;
      state.winReason = {
        winnerId: state.players[widx[0]]?.id,
        winnerLabel
      };
      setTimeout(() => {
        const quickPlay = Boolean(tablesConfig[tableID]?.quickPlay);
        io.to('admin').emit('tableFinished', { tableID, winner: winnerLabel, quickPlay });
        io.to(tableID).emit('tableFinished', { tableID, winner: winnerLabel, quickPlay });
        io.to(state.players[widx[0]].id)
          .emit('tableFinished', { tableID, winner: winnerLabel, quickPlay });
      }, WINNER_SCREEN_DELAY_MS);
    }
  } else {
    io.to(tableID).emit('updateMatch2',   { matchID: tableID, gameState: state });
    io.to('admin').emit('updateMatch2',   { matchID: tableID, gameState: state });
    if (survivors.length === 1) {
      state.gameFinished = true;
      state.winReason = {
        winnerId: state.players[widx[0]]?.id,
        winnerLabel
      };
      setTimeout(() => {
        io.to('admin').emit('match2Finished', { matchID: tableID, winner: winnerLabel });
        io.to(tableID).emit('match2Finished', { matchID: tableID, winner: winnerLabel });
        io.to(state.players[widx[0]].id)
          .emit('match2Finished', { matchID: tableID, winner: winnerLabel });
      }, WINNER_SCREEN_DELAY_MS);
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 10) Relance de la main suivante après 8s
  // ─────────────────────────────────────────────────────────────────
  // dealNextHand sera déclenché à la fin du reveal séquentiel
}

/**
 * Showdown pour un match 2-joueurs :
 * - Résout les mains
 * - Distribue le pot
 * - Met à jour stats & historique
 * - Émet updateMatch2 pour rafraîchir l’UI
 * - Émet match2Finished pour afficher le gagnant
 */
function evaluateRound2(matchID, opts = {}) {
  const state = gameStateByTable[matchID];
  if (!state) return;
  const useRevealStatus = !!opts.useRevealStatus;
  const skipRevealInit = !!opts.skipRevealInit;

  // ── 1a) Marquer qui est allé jusqu'au showdown (ni FOLD ni BUST ni WAIT) ──
  markInShowdown(state, useRevealStatus);

  // ─────────────────────────────────────────────────────────────────
  // 1) Conversion interne des cartes en format "Ah", "7c", etc.
  // ─────────────────────────────────────────────────────────────────
  const conv = c => {
    const s = c[0];
    const r = parseInt(c.slice(1), 10);
    const m = {14:'A',13:'K',12:'Q',11:'J',10:'T'};
    return (m[r] || r) + s;
  };

  // ─────────────────────────────────────────────────────────────────
  // 2) Résolution des mains pour ceux qui ne sont pas FOLD/BUST
  // ─────────────────────────────────────────────────────────────────
  const solved = state.players.map(p => {
    if (!p) return null;
    if (p.inactive || ['FOLD','BUST','WAIT'].includes(p.status)) return null;
    if (useRevealStatus && p.revealStatus === 'hide') return null;
    return Hand.solve([p.carda, p.cardb, ...state.board].map(conv));
  });
  const winners = Hand.winners(solved.filter(Boolean));
  const widx = solved
    .map((h, i) => h && winners.includes(h) ? i : -1)
    .filter(i => i >= 0);

  // ── 3) Gestion des égalités (split pot) ──
  if (widx.length > 1) {
    const pots = buildSidePots(state);
    const potWinners = new Set();
    pots.forEach(pot => {
      const eligibleHands = pot.eligible
        .map(i => ({ i, h: solved[i] }))
        .filter(o => o.h);
      if (eligibleHands.length === 0) return;
      const bestHands = Hand.winners(eligibleHands.map(o => o.h));
      const winnerIdxs = eligibleHands
        .filter(o => bestHands.includes(o.h))
        .map(o => o.i);
      const name = bestHands[0]?.name;
      winnerIdxs.forEach(i => {
        potWinners.add(i);
        state.players[i].handName = name;
      });
      distributeChipsEvenly(winnerIdxs, pot.amount, state);
    });
    state.pot = 0;
    state.players.forEach((p, i) => {
      if (!p || p.status === 'WAIT') return;
      if (potWinners.has(i)) {
        p.status = 'WINNER';
        return;
      }
      if (['FOLD', 'BUST'].includes(p.status)) return;
      p.status = p.bankroll > 0 ? '' : 'BUST';
    });
    state.phase = 'reveal';
    if (!skipRevealInit) initRevealSequence(matchID, true);
io.to(matchID).emit('updateMatch2', { matchID, gameState: gameStateByTable[matchID] });

io.to(`spectate-match2:${matchID}`).emit('spectatorState', {
  type: 'match2',
  matchID,
  gameState: gameStateByTable[matchID]
});
    io.to('admin').emit('updateMatch2', { matchID, gameState: state });
    return;
  }

  // ── 4) Cas d’un seul gagnant ──
  const winnerIdx = widx[0];
  const loserIdx  = state.players.findIndex((_, i) => i !== winnerIdx);
  const winner    = state.players[winnerIdx];
  const loser     = state.players[loserIdx];

  winner.status   = 'WINNER';
  winner.handName = solved[winnerIdx].name;

  // ── 5) Partage du pot ──
  {
    const pots = buildSidePots(state);
    pots.forEach(pot => {
      const eligibleHands = pot.eligible
        .map(i => ({ i, h: solved[i] }))
        .filter(o => o.h);
      if (eligibleHands.length === 0) return;
      const bestHands = Hand.winners(eligibleHands.map(o => o.h));
      const winnerIdxs = eligibleHands
        .filter(o => bestHands.includes(o.h))
        .map(o => o.i);
      distributeChipsEvenly(winnerIdxs, pot.amount, state);
    });
    state.pot = 0;
  }

  // ── 6) Éliminer ou reset les autres ──
  state.players.forEach((p, i) => {
    if (!widx.includes(i)) {
      if (p.status !== 'WAIT') p.status = p.bankroll > 0 ? '' : 'BUST';
    }
  });

  endIfOnlyOneActiveAndOthersDisconnected(state);
  competitiveSettlement.settle(state);

  // ─────────────────────────────────────────────────────────────────
  // 7) Historique & stats
  // ─────────────────────────────────────────────────────────────────
 
   // Si, par un cas rare, aucun gagnant n'a été déterminé → on skippe
  if (widx.length === 0) {
    console.warn(`evaluateRound2(${matchID}) widx is empty, skipping stats.`);
    state.phase = 'reveal';
    if (!skipRevealInit) initRevealSequence(matchID, true);

    // joueurs (duel)
    io.to(matchID).emit('updateMatch2', {
      matchID,
      gameState: state
    });

    // spectateurs duel
    io.to(`spectate-match2:${matchID}`).emit('spectatorState', {
      type: 'match2',
      matchID,
      gameState: state
    });

    // admin
    io.to('admin').emit('updateMatch2', {
      matchID,
      gameState: state
    });

    // prochaine main après 8s
    return;
  }
 
  const mode        = matches2Config[matchID].mode;
  const winnerLabel = winner.label;
  const loserLabel  = loser.label;
  if (!state.demo) {

  gamesHistory.push({
    type:      'match2',
    matchID,
    mode,
    winner:    winnerLabel,
    timestamp: new Date().toISOString()
  });
  saveGames();

  [winnerLabel, loserLabel].forEach(lbl => {
    if (!statsMatch2[lbl]) {
      statsMatch2[lbl] = {
        name:        lbl,
        gamesPlayed: 0,
        wins:        0,
        byMode:      Object.fromEntries(
          Object.keys(BLINDS).map(m => [m, { played:0, wins:0 }])
        )
      };
    }
    statsMatch2[lbl].gamesPlayed++;
    statsMatch2[lbl].byMode[mode].played++;
  });
  statsMatch2[winnerLabel].wins++;
  statsMatch2[winnerLabel].byMode[mode].wins++;
  saveStatsMatch2();
  }

  // ─────────────────────────────────────────────────────────────────
  // 8) Duels (1v1) : promotion en 2 victoires sur 3 + joker T1
  // ─────────────────────────────────────────────────────────────────
  const surv = state.players.filter(p => p && !p.inactive && p.status !== 'BUST' && p.status !== 'WAIT');
  if (!state.demo && surv.length === 1) {
    [winner, loser].forEach(p => ensurePlayerRecord(p.label));
    const matchLevel = normalizeCreditLevel(matches2Config[matchID]?.level);
    const isTraining = isTrainingLevel(matchLevel);

    if (!isTraining) {
      const wEntry = playerLevels[winner.label];
      const lEntry = playerLevels[loser.label];
      if (wEntry) {
        const bo3w = registerPromotionDuel(wEntry, matchLevel, true);
        const idx = CREDIT_LEVELS.indexOf(matchLevel);
        const next = idx >= 0 && idx < CREDIT_LEVELS.length - 1 ? CREDIT_LEVELS[idx + 1] : matchLevel;
        if (bo3w && bo3w.wins >= 2) {
          const wins = bo3w.wins;
          const losses = bo3w.losses;
          moveCreditUp(wEntry, matchLevel);
          resetPromotionBo3(wEntry, matchLevel);
          wEntry.wins = (wEntry.wins || 0) + 1;
          wEntry.history.push({
            date: new Date().toISOString(),
            action: `Gagne BO3 ${matchLevel} (${wins}-${losses}) -> ${next}`
          });
        } else if (bo3w) {
          wEntry.history.push({
            date: new Date().toISOString(),
            action: `Gagne duel ${matchLevel} -> BO3 ${bo3w.wins}-${bo3w.losses}`
          });
        }
      }
      if (lEntry) {
        const bo3l = registerPromotionDuel(lEntry, matchLevel, false);
        if (bo3l && bo3l.losses >= 2) {
          if (matchLevel === 'T1') {
            resetPromotionBo3(lEntry, matchLevel);
            lEntry.history.push({
              date: new Date().toISOString(),
              action: `Perdu BO3 ${matchLevel} (${bo3l.wins}-${bo3l.losses}) -> reste T1`
            });
          } else if (matchLevel === 'T2' || matchLevel === 'T3' || matchLevel === 'T4') {
            applyDropToT1NoCreditLoss(lEntry, matchLevel, `Perdu BO3 ${matchLevel} (${bo3l.wins}-${bo3l.losses})`);
          } else {
            applyDropToQ1WithCreditLoss(lEntry, matchLevel, `Perdu BO3 ${matchLevel} (${bo3l.wins}-${bo3l.losses})`);
          }
        } else if (bo3l) {
          lEntry.history.push({
            date: new Date().toISOString(),
            action: `Perdu duel ${matchLevel} -> BO3 ${bo3l.wins}-${bo3l.losses}`
          });
        }
      }

      syncCreditsOnPlayers(state.players);
      saveLevels();
      io.to('admin').emit('profilesUpdated');
      io.to('admin').emit('levelsUpdated');
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 9) Émission des updates & notification de fin
  // ─────────────────────────────────────────────────────────────────
  io.to(matchID) .emit('updateMatch2',   { matchID, gameState: state });
  io.to('admin') .emit('updateMatch2',   { matchID, gameState: state });
  if (surv.length === 1) {
    state.gameFinished = true;
    state.winReason = { winnerId: winner?.id, winnerLabel };

    competitiveSettlement.settle(state, { finished: true, winnerName: winnerLabel });

    setTimeout(() => {
      const isChampionshipFinal = Boolean(matches2Config[matchID]?.isChampionshipFinal);
      io.to('admin') .emit('match2Finished', { matchID, winner: winnerLabel, isChampionshipFinal });
      io.to(matchID).emit('match2Finished', { matchID, winner: winnerLabel, isChampionshipFinal });
      io.to(winner.id).emit('match2Finished',{ matchID, winner: winnerLabel, isChampionshipFinal });
    }, WINNER_SCREEN_DELAY_MS);
  }

  // ─────────────────────────────────────────────────────────────────
  // 10) Relance de la main suivante après 8s
  // ─────────────────────────────────────────────────────────────────
  const survivors = state.players.filter(p => p && !p.inactive && p.status !== 'BUST' && p.status !== 'WAIT');
  if (survivors.length > 1) {
    // dealNextHand sera déclenché à la fin du reveal séquentiel
  }
}

// ──────────────────────────────────────────────────────────────
// 11) dealNextHand: reset pour nouvelle donne
// ──────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────
// dealNextHand: reset + incrémentation du roundNumber
// ──────────────────────────────────────────────────────────────
/**
 * Lance la main suivante : reset de l'état, redistribution, puis émission
 * - pour une table à 10 joueurs  → updateTable + resetTurnTimer
 * - pour un duel (match2)       → updateMatch2 + resetTurnTimer2
 */
function dealNextHand(tableID) {
  const state = gameStateByTable[tableID];
  if (!state) return;
  if (state.demo) state.demoRunningOut = false;
  if (state.gameFinished) {
    competitiveSettlement.settle(state, { finished: true, winnerName: state.winReason?.winnerLabel });
    return;
  }

  clearRevealSequence(tableID, state);

  // 1) on passe au round suivant
  state.roundNumber++;

  // 2) reset du pot et des paris
  state.pot = 0;
  currentBetByTable[tableID]      = 0;
  currentMinRaiseByTable[tableID] = 0;
  state.current_bet    = 0;
  state.checkCount     = 0;
state.timeFrozen        = false;
state.timeFrozenFor     = null;
state.timeExtensionUsed = false;
state.calcPrimaryUsed = false;
state.calcExtensionUsed = false;
state.add30Used = false;
state.add30BonusMs = 0;
  state.roundEvaluated = false;

  // 3) réinitialisation du statut des joueurs
  state.players.forEach(p => {
    p.subtotal_bet = 0;
      p.total_bet_hand = 0;   // ← NEW
    if (p.status === 'BUST' && (p.bankroll | 0) > 0) {
      // Etat incoherent (ex: siege deconnecte marque BUST alors qu'il a encore des jetons)
      p.status = p.isBreak ? 'WAIT' : (p.id ? '' : 'WAIT');
    }
    if (p.status !== 'BUST') {
      if (p.isBreak) {
        p.status = 'WAIT';
      } else {
        p.status = p.id ? '' : 'WAIT';
      }
    }
  });

  // A reconnectable BUST seat with chips has now been restored. Settle only
  // permanent eliminations before considering a finish caused by absences.
  competitiveSettlement.settle(state);

  // Si un seul joueur actif reste et que tous les autres sont en BREAK ou hors-ligne,
  // on termine la partie et on declare ce joueur gagnant.
  const activePlayers = state.players.filter(p => p && !p.inactive && p.status !== 'WAIT' && p.status !== 'BUST');
  const otherNonBust = state.players.filter(p => p && !p.inactive && p.status !== 'BUST' && !activePlayers.includes(p));
  const hasBlockingWaiter = otherNonBust.some(p => p.status !== 'WAIT' || (!p.isBreak && p.id));
  if (activePlayers.length === 1 && otherNonBust.length > 0 && !hasBlockingWaiter) {
    const winner = activePlayers[0];
    if (winner) winner.status = 'WINNER';
    state.gameFinished = true;
    state.winReason = { winnerId: winner?.id, winnerLabel: winner?.label };
    state.phase = 'reveal';
    state.revealSeqDone = true;
    state.roundEvaluated = true;
    if (turnTimersByTable[tableID]) {
      clearTimeout(turnTimersByTable[tableID]);
      delete turnTimersByTable[tableID];
    }
    if (turnTimersByMatch2[tableID]) {
      clearTimeout(turnTimersByMatch2[tableID]);
      delete turnTimersByMatch2[tableID];
    }
    competitiveSettlement.settle(state, { finished: true, winnerName: winner?.label });
    if (matches2Config[tableID]) {
      io.to(tableID).emit('updateMatch2', { matchID: tableID, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID: tableID, gameState: state });
      setTimeout(() => {
        const isChampionshipFinal = Boolean(matches2Config[tableID]?.isChampionshipFinal);
        io.to('admin').emit('match2Finished', { matchID: tableID, winner: winner?.label, isChampionshipFinal });
        io.to(tableID).emit('match2Finished', { matchID: tableID, winner: winner?.label, isChampionshipFinal });
        if (winner?.id) io.to(winner.id).emit('match2Finished', { matchID: tableID, winner: winner?.label, isChampionshipFinal });
      }, WINNER_SCREEN_DELAY_MS);
    } else {
      io.to(tableID).emit('updateTable', state);
      io.to(`spectate-table:${tableID}`).emit('spectatorState', { type: 'table', tableID, gameState: state });
      io.to('admin').emit('updateTable', { tableID, gameState: state });
      setTimeout(() => {
        const quickPlay = Boolean(tablesConfig[tableID]?.quickPlay);
        io.to('admin').emit('tableFinished', { tableID, winner: winner?.label, quickPlay });
        io.to(tableID).emit('tableFinished', { tableID, winner: winner?.label, quickPlay });
        if (winner?.id) io.to(winner.id).emit('tableFinished', { tableID, winner: winner?.label, quickPlay });
      }, WINNER_SCREEN_DELAY_MS);
    }
    return;
  }

  // 4) redistribution des cartes et nouveaux blinds
  competitiveSettlement.capture(state);
  distributeCards(state);
  {
    const isMatch2 = Boolean(matches2Config[tableID]);
    const cfg = isMatch2 ? matches2Config[tableID] : tablesConfig[tableID];
    if (cfg && cfg.mode === 'hyper') {
      prepareHyperAutoState(tableID, isMatch2, state);
    } else {
      configureBlinds(state, tableID);
    }
  }

  // 5) émission vers clients et reset timer
// ── 5) émission vers clients ET reset du timer AVANT d'émettre
  {
    const isMatch2 = Boolean(matches2Config[tableID]);
    const cfg = isMatch2 ? matches2Config[tableID] : tablesConfig[tableID];
    if (cfg && cfg.mode === 'hyper') {
      prepareHyperAutoState(tableID, isMatch2, state); // hyper pur + normalisation avant rendu
      if (turnTimersByTable[tableID]) {
        clearTimeout(turnTimersByTable[tableID]);
        delete turnTimersByTable[tableID];
      }
      if (turnTimersByMatch2[tableID]) {
        clearTimeout(turnTimersByMatch2[tableID]);
        delete turnTimersByMatch2[tableID];
      }
      if (isMatch2) broadcastMatch2State(tableID);
      else broadcastTableState(tableID);
      scheduleHyperAutoHand(tableID, isMatch2);
      return;
    }
  }
if (matches2Config[tableID]) {
  resetTurnTimer2(tableID);
  broadcastMatch2State(tableID);
} else {
  resetTurnTimer(tableID);
  broadcastTableState(tableID);
}
}

/**
 * (Re)lance le timeout de 30s pour le prochain joueur de la table à 10 joueurs,
 * et élimine en cas de 5 passes consécutives.
 */
// ──────────────────────────────────────────────────────────────
// Table 10 joueurs
// ──────────────────────────────────────────────────────────────
// Table 10 joueurs
// POUR LES PARTIES 10 JOUEURS
// ── Table 10 joueurs ──
// ── Table 10 joueurs ──
function resetTurnTimer(tableID, isTimeExtension = false, preserveTurnFlags = false, overrideTiming = null) {
  if (gameStateByTable[tableID]?.demo) return;
  // Helper local : un joueur à ignorer pour l'action
  function isSkippablePlayer(p){
    return p.status === 'FOLD'
        || p.status === 'BUST'
        || p.status === 'ALLIN'
        || p.status === 'WAIT'
        || ((p.bankroll | 0) === 0); // 0 jeton => jamais la main
  }

  clearTimeout(turnTimersByTable[tableID]);

  const s = gameStateByTable[tableID];
  if (!s) return;

  const N      = s.players.length;
  const curIdx = s.current_bettor_index;
  if (!Number.isInteger(curIdx) || curIdx < 0 || curIdx >= N) return;

  let p = s.players[curIdx];

  // Si le joueur courant ne doit pas parler, on saute au suivant éligible
  if (isSkippablePlayer(p)) {
    let nextIdx = curIdx, guard = 0;
    do {
      nextIdx = (nextIdx + 1) % N;
      if (++guard > N) return; // sécurité anti-boucle
    } while (isSkippablePlayer(s.players[nextIdx]));
    s.current_bettor_index = nextIdx;
    return resetTurnTimer(tableID, isTimeExtension);
  }

  // Plus d'avertissement d'élimination pour inactivité.

  // Horloge serveur pour le client
  const now = Date.now();
  let remainingMs = (s.disconnectPaused && typeof s.turnRemainingMs === 'number' && s.turnRemainingMs > 0)
    ? s.turnRemainingMs
    : 30_000;
  let nextStartTime = now;
  let nextDuration = remainingMs;
  if (overrideTiming && Number.isFinite(overrideTiming.turnStartTime) && Number.isFinite(overrideTiming.turnDuration)) {
    nextStartTime = overrideTiming.turnStartTime;
    nextDuration = overrideTiming.turnDuration;
    remainingMs = Math.max(0, nextDuration - (now - nextStartTime));
  }
  s.turnStartTime      = nextStartTime;
  s.turnDuration       = nextDuration;
  s.timeFrozen         = false;
  s.timeFrozenFor      = null;
  s.disconnectPaused   = false;
  s.turnRemainingMs    = null;

  if (!preserveTurnFlags) {
    s.add30Used = false;
    s.add30BonusMs = 0;
    s.add30BonusMs = 0;
  }

  // Si on (re)démarre un tour "normal" (pas encore de TIME), on reset le flag
  if (!isTimeExtension && remainingMs === 30_000) {
    s.timeExtensionUsed = false;
    s.calcPrimaryUsed = false;
    s.calcExtensionUsed = false;
  }

  turnTimersByTable[tableID] = setTimeout(() => {
    const state = gameStateByTable[tableID];
    if (!state) return;

  // 1er timer (30s) → on fige, on NE force PAS l'action
    if (!isTimeExtension) {
      state.timeFrozen    = true;
      state.timeFrozenFor = state.current_bettor_index;

      // On informe tout le monde que le temps est écoulé pour ce joueur
      io.to(tableID).emit('turnTimeExpired', {
        tableID,
        seatIndex: state.current_bettor_index
      });
      io.to('admin').emit('turnTimeExpired', {
        tableID,
        seatIndex: state.current_bettor_index
      });

      // Pas de CHECK/FOLD auto, pas de changement de joueur
      return;
    }

    // ───────────────────────────────
    // 2ᵉ timer (TIME) : ancienne logique
    // ───────────────────────────────

    const s2 = gameStateByTable[tableID];
    if (!s2) return;

    const N2     = s2.players.length;
    const curIdx2= s2.current_bettor_index;
    if (!Number.isInteger(curIdx2) || curIdx2 < 0 || curIdx2 >= N2) return;
    const p2     = s2.players[curIdx2];

    // 1) Passe manquée → incrément (sans élimination auto)
    p2.missedCount = (p2.missedCount || 0) + 1;

    // 1bis) Runout auto uniquement s’il ne reste que 0 ou 1 joueur avec des jetons
    {
      const cbNow     = (currentBetByTable[tableID] || 0);
      const aliveNow  = s2.players.filter(pl => pl.status !== 'FOLD' && pl.status !== 'BUST' && pl.status !== 'WAIT');
      if (aliveNow.length >= 2) {
        const withChips    = aliveNow.filter(pl => (pl.bankroll || 0) > 0);
        const nbWithChips  = withChips.length;
        if (nbWithChips <= 1) {
          const covered = withChips.every(pl => (pl.subtotal_bet || 0) >= cbNow);
          if (covered) return startRevealAllIn(tableID);
        }
      }
    }

    // 2) Action forcée : on cherche le dernier joueur "acteur" (non skippable)
    let k = (curIdx2 - 1 + N2) % N2, guardPrev = 0;
    while (isSkippablePlayer(s2.players[k])) {
      k = (k - 1 + N2) % N2;
      if (++guardPrev > N2) { k = null; break; } // personne avant → traite comme CHECK
    }
    const prevAct = k === null ? 'CHECK' : s2.players[k].status;

    if ((s2.current_bet || 0) === 0 || prevAct === 'CHECK') {
      p2.status       = 'CHECK';
      s2.checkCount   = (s2.checkCount || 0) + 1;
    } else {
      p2.status = 'WAIT';
      p2.isBreak = true;
    }
    if (s2.phase === 'preflop' && curIdx2 === s2.bigBlindIndex) {
      s2.bbOptionPending = false;
    }

    // Plus de warning/élimination sur inactivité.

    // 3) Showdown all-in ?
    const alive = s2.players.filter(x => x.status !== 'FOLD' && x.status !== 'BUST' && x.status !== 'WAIT');
    if (alive.length > 0 && alive.every(x => x.status === 'ALLIN' || ((x.bankroll|0)===0))) {
      return startRevealAllIn(tableID);
    }

    // 4) Un seul survivant ?
    if (alive.length === 1) {
      return startReveal(tableID);
    }

    // 5) Fin de tour → phase suivante
    if (isRoundComplete(tableID)) {
      const PH = ['preflop','flop','turn','river','reveal'];
      const i  = PH.indexOf(s2.phase);
      if (i >= 0 && i < PH.length - 1) {
        s2.phase = PH[i + 1];

        // Reset des mises de la street & normalisation des statuts
        s2.players.forEach(pl => {
          pl.subtotal_bet = 0;
          if (!['FOLD','BUST','ALLIN','WAIT'].includes(pl.status)) pl.status = '';
          // garde-fou : si plus de stack, on force ALLIN (skippable aux prochains tours)
          if ((pl.bankroll | 0) === 0 && pl.status !== 'BUST' && pl.status !== 'WAIT') pl.status = 'ALLIN';
        });

        currentBetByTable[tableID]      = 0;
        currentMinRaiseByTable[tableID] = 0;
        s2.current_bet                  = 0;
        s2.checkCount                   = 0;
        s2.bbOptionPending              = false;
      }

      if (s2.phase === 'reveal') {
        return startReveal(tableID);
      }

      // Passe au joueur suivant pour la nouvelle street
      {
        let guardNext = 0;
        do {
          s2.current_bettor_index = (s2.current_bettor_index + 1) % N2;
          if (++guardNext > N2) return; // sécurité anti-boucle
        } while (isSkippablePlayer(s2.players[s2.current_bettor_index]));
      }

      resetTurnTimer(tableID, false);
io.to(tableID).emit('updateTable', s2);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: s2
});
      io.to('admin').emit('updateTable', { tableID, gameState: s2 });
      return;
    }

    // 6) Sinon, main courante continue → joueur suivant (en sautant les skippables)
    {
      let guardNext = 0;
      do {
        s2.current_bettor_index = (s2.current_bettor_index + 1) % N2;
        if (++guardNext > N2) return; // sécurité anti-boucle
      } while (isSkippablePlayer(s2.players[s2.current_bettor_index]));
    }

    resetTurnTimer(tableID, false);
io.to(tableID).emit('updateTable', s2);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: s2
});
    io.to('admin').emit('updateTable', { tableID, gameState: s2 });
  }, remainingMs);
}


// ── Duel 2 joueurs ──
// ── Duel 2 joueurs ──
function resetTurnTimer2(matchID, isTimeExtension = false, preserveTurnFlags = false, overrideTiming = null) {
  if (gameStateByTable[matchID]?.demo) return;
  clearTimeout(turnTimersByMatch2[matchID]);

  const s = gameStateByTable[matchID];
  if (!s) return;

  const j = s.current_bettor_index;
  if (!Number.isInteger(j) || j < 0 || j >= s.players.length) return;

  const p = s.players[j];

  // Plus d'avertissement d'elimination pour inactivite.
  // Horloge pour les clients
  const now = Date.now();
  let remainingMs = (s.disconnectPaused && typeof s.turnRemainingMs === 'number' && s.turnRemainingMs > 0)
    ? s.turnRemainingMs
    : 30_000;
  let nextStartTime = now;
  let nextDuration = remainingMs;
  if (overrideTiming && Number.isFinite(overrideTiming.turnStartTime) && Number.isFinite(overrideTiming.turnDuration)) {
    nextStartTime = overrideTiming.turnStartTime;
    nextDuration = overrideTiming.turnDuration;
    remainingMs = Math.max(0, nextDuration - (now - nextStartTime));
  }
  s.turnStartTime  = nextStartTime;
  s.turnDuration   = nextDuration;
  s.timeFrozen     = false;
  s.timeFrozenFor  = null;
  s.disconnectPaused   = false;
  s.turnRemainingMs    = null;

  if (!preserveTurnFlags) {
    s.add30Used = false;
  }

  // Si on repart sur un tour normal (pas encore de TIME), on reset le flag
  if (!isTimeExtension && remainingMs === 30_000) {
    s.timeExtensionUsed = false;
    s.calcPrimaryUsed = false;
    s.calcExtensionUsed = false;
  }

  turnTimersByMatch2[matchID] = setTimeout(() => {
    const state = gameStateByTable[matchID];
    if (!state) return;

    const curIdx = state.current_bettor_index;
    if (!Number.isInteger(curIdx) || curIdx < 0 || curIdx >= state.players.length) return;
    const player = state.players[curIdx];

    // 🧊 1ère échéance : on FREEZE seulement, on ne force pas l'action
    if (!isTimeExtension) {
      state.timeFrozen    = true;
      state.timeFrozenFor = curIdx;

      io.to(matchID).emit('turnTimeExpired', {
        matchID,
        seatIndex: curIdx
      });
      io.to('admin').emit('turnTimeExpired', {
        matchID,
        seatIndex: curIdx
      });

      // On attend soit un TIME, soit une action du joueur
      return;
    }

    // ⏱ 2ᵉ échéance (après TIME) : ANCIEN CODE de timeout complet

    // 1) Passe manquée
    player.missedCount = (player.missedCount || 0) + 1;

    // 2) Action forcée en fonction de la mise actuelle / action du précédent
    const prevIdx = (curIdx - 1 + state.players.length) % state.players.length;
    const prevAct = state.players[prevIdx].status;

    if ((state.current_bet || 0) === 0 || prevAct === 'CHECK') {
      // pas de pari en cours OU précédent a CHECK → CHECK forcé
      player.status     = 'CHECK';
      state.checkCount  = (state.checkCount || 0) + 1;
    } else {
      // sinon DROP -> PAUSE immediate
      player.status = 'WAIT';
      player.isBreak = true;
    }
    if (state.phase === 'preflop' && curIdx === state.bigBlindIndex) {
      state.bbOptionPending = false;
    }

    // Plus de warning/elimination sur inactivite.
    // 4) Si tout le monde est ALLIN → runout
    const alive = state.players.filter(x => x.status !== 'FOLD' && x.status !== 'BUST' && x.status !== 'WAIT');
    if (alive.length > 0 && alive.every(x => x.status === 'ALLIN')) {
      return startRevealAllIn(matchID);
    }

    // 5) Si un seul survivant → showdown direct
    if (alive.length === 1) {
      return startReveal(matchID);
    }

    // 6) Si le tour est complet (tous ont call/checked) → phase suivante
    if (isRoundComplete(matchID)) {
      const PH = ['preflop','flop','turn','river','reveal'];
      const i  = PH.indexOf(state.phase);
      if (i >= 0 && i < PH.length - 1) {
        state.phase = PH[i + 1];

        state.players.forEach(pl => {
          pl.subtotal_bet = 0;
          if (!['FOLD','BUST','ALLIN','WAIT'].includes(pl.status)) pl.status = '';
        });

        currentBetByMatch2[matchID]      = 0;
        currentMinRaiseByMatch2[matchID] = 0;
        state.current_bet                = 0;
        state.checkCount                 = 0;
        state.bbOptionPending            = false;
      }

      if (state.phase === 'reveal') {
        return startReveal(matchID);
      }

      // Passe au joueur suivant pour la nouvelle street
      {
        let guardNext = 0;
        do {
          state.current_bettor_index = (state.current_bettor_index + 1) % state.players.length;
          if (++guardNext > state.players.length) return; // sécurité anti-boucle
        } while (['FOLD','BUST','ALLIN','WAIT'].includes(state.players[state.current_bettor_index].status));
      }

      resetTurnTimer2(matchID, false);
io.to(matchID).emit('updateMatch2', { matchID, gameState: gameStateByTable[matchID] });

io.to(`spectate-match2:${matchID}`).emit('spectatorState', {
  type: 'match2',
  matchID,
  gameState: gameStateByTable[matchID]
});
      io.to('admin').emit('updateMatch2', { matchID, gameState: state });
      return;
    }

    // 7) Sinon, on passe au joueur suivant
    state.current_bettor_index = (curIdx + 1) % state.players.length;
    resetTurnTimer2(matchID, false);
io.to(matchID).emit('updateMatch2', { matchID, gameState: gameStateByTable[matchID] });

io.to(`spectate-match2:${matchID}`).emit('spectatorState', {
  type: 'match2',
  matchID,
  gameState: gameStateByTable[matchID]
});
    io.to('admin').emit('updateMatch2', { matchID, gameState: state });

  }, remainingMs);
}

/**
 * Passe au joueur suivant actif dans une table à 10 joueurs,
 * émet l’update et relance le timer.
 */
function advanceTurn(tableID) {
  const s = gameStateByTable[tableID];
  const N = s.players.length;
  let idx = s.current_bettor_index;
  let guard = 0;
  let found = null;
  do {
    idx = (idx + 1) % N;
    if (!['FOLD','BUST','ALLIN','WAIT'].includes(s.players[idx].status)) {
      found = idx;
      break;
    }
    guard++;
  } while (guard < N);
  // S'il n'y a qu'un seul joueur actif, on garde le même index
  if (found != null) s.current_bettor_index = found;
  resetTurnTimer(tableID);
io.to(tableID).emit('updateTable', s);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: s
});
  io.to('admin').emit('updateTable', { tableID, gameState: s });
}


/**
 * Même logique pour les duels 2 joueurs.
 */
function advanceTurn2(matchID) {
  const state = gameStateByTable[matchID];
  if (!state) return;

  // 1) on trouve l’indice du prochain joueur actif
  const N = state.players.length;
  let idx = state.current_bettor_index;
  let found = null;
  do {
    idx = (idx + 1) % N;
    if (!['FOLD', 'BUST', 'ALLIN', 'WAIT'].includes(state.players[idx].status)) {
      found = idx;
      break;
    }
  } while (idx !== state.current_bettor_index);

  if (found != null) state.current_bettor_index = found;

  // 2) on (re)lance le timer pour ce joueur
  resetTurnTimer2(matchID);

  // 3) on notifie le client avec la nouvelle gameState
  io.to(matchID).emit('updateMatch2',   { matchID, gameState: state });
  io.to('admin').emit('updateMatch2',   { matchID, gameState: state });
}


/**
 * Après un fold (naturel ou forcé), on gère
 * – le showdown si plus que 2 joueurs
 * – le reveal si nécessaire
 */
function handlePostFold(tableID) {
  const state = gameStateByTable[tableID];
  if (!state) return;

const alive = state.players.filter(p => !['FOLD','BUST','WAIT'].includes(p.status));
  if (alive.length === 1) {
    // plus qu’un survivant → showdown (startReveal appellera à son tour updateTable correctement)
    startReveal(tableID);
  } else {
    // sinon, on passe au suivant
    advanceTurn(tableID);  
    // → advanceTurn s’occupe désormais de resetTurnTimer AVANT emit
  }
}

function handlePostFold2(matchID, state) {
const alive = state.players.filter(p => !['FOLD','BUST','WAIT'].includes(p.status));
  if (alive.length <= 1) {
    // showdown ou prochaine main
    startReveal(matchID);
  } else {
    // passe au suivant et reloade le timer
    advanceTurn2(matchID);
  }
}


function startRevealAllIn(tableID) {
  const state = gameStateByTable[tableID];
  if (!state) return;
  if (state.demo) state.demoRunningOut = true;
  const alivePlayers = state.players.filter(p => p && !p.inactive && !['FOLD','BUST','WAIT'].includes(p.status));
  const hasMultipleAlive = alivePlayers.length > 1;
  const revealOpts = hasMultipleAlive
    ? { defaultAction: 'show', forceShowAllIn: true }
    : { defaultAction: 'hide', forceShowAllIn: false };

  // 1) S’il est déjà en « reveal », on évalue tout de suite
  if (state.phase === 'reveal') {
    if (!state.roundEvaluated) markInShowdown(state, false);
    if (!state.revealSeq || state.revealSeq.done) {
      initRevealSequence(tableID, Boolean(matches2Config[tableID]), revealOpts);
    }
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
    io.to('admin').emit('updateTable', { tableID, gameState: state });
    if (matches2Config[tableID]) {
      io.to(tableID).emit('updateMatch2', { matchID: tableID, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID: tableID, gameState: state });
    }
    return;
  }

  // 2) Idem : on calcule la suite des phases manquantes (flop/turn/river) en fonction de state.phase
  const phasesÀJouer = [];
  switch (state.phase) {
    case 'preflop':
      phasesÀJouer.push('flop','turn','river');
      break;
    case 'flop':
      phasesÀJouer.push('turn','river');
      break;
    case 'turn':
      phasesÀJouer.push('river');
      break;
    case 'river':
      break;
    default:
      phasesÀJouer.push('flop','turn','river');
      break;
  }

  // 3) Programmer chaque phase restante avec 2,5 s d’intervalle
  phasesÀJouer.forEach((phase, idx) => {
    const délai = idx * 2500;
    setTimeout(() => {
      if (state.demo && gameStateByTable[tableID] !== state) return;
      state.phase = phase;
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
      io.to('admin').emit('updateTable', { tableID, gameState: state });
      if (matches2Config[tableID]) {
        io.to(tableID).emit('updateMatch2', { matchID: tableID, gameState: state });
        io.to('admin').emit('updateMatch2', { matchID: tableID, gameState: state });
      }
    }, délai);
  });

  // 4) Enfin, passer au reveal après la dernière phase
  const finalDelay = phasesÀJouer.length > 0
    ? (phasesÀJouer.length - 1) * 2500 + 2500
    : 0;

  setTimeout(() => {
    if (state.demo && gameStateByTable[tableID] !== state) return;
    state.phase = 'reveal';
    if (!state.roundEvaluated) markInShowdown(state, false);
    if (!state.revealSeq || state.revealSeq.done) {
      initRevealSequence(tableID, Boolean(matches2Config[tableID]), revealOpts);
    }
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
    io.to('admin').emit('updateTable', { tableID, gameState: state });
    if (matches2Config[tableID]) {
      io.to(tableID).emit('updateMatch2', { matchID: tableID, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID: tableID, gameState: state });
    }
  }, finalDelay);
}

    // 4) Fonction utilitaire pour lancer le reveal et la prochaine main
// pour les modes normaux / hyper
/**
 * Lance la séquence « flop→turn→river→reveal » en s'adaptant
 * à l'état courant (state.phase). Ne recommence pas depuis le début.
 */
function startReveal(tableID, opts = {}) {
  const state = gameStateByTable[tableID];
  if (!state) return;
  if (state.demo) state.demoRunningOut = true;

  // 1) Si on est déjà en 'reveal', on n’a plus qu’à évaluer tout de suite
  if (state.phase === 'reveal') {
    // Si jamais on appelle startReveal alors qu’on est déjà en reveal,
    // on s’assure que l’éval n’est faite qu’une seule fois.
    if (!state.roundEvaluated) markInShowdown(state, false);
    if (!state.revealSeq || state.revealSeq.done) {
      initRevealSequence(tableID, Boolean(matches2Config[tableID]), opts);
    }
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
    io.to('admin').emit('updateTable', { tableID, gameState: state });
    if (matches2Config[tableID]) {
      io.to(tableID).emit('updateMatch2', { matchID: tableID, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID: tableID, gameState: state });
    }
    return;
  }

  // 2) On construit dynamiquement la liste des phases restantes
  //    en partant de state.phase actuel.
  //
  //    - Si on est en 'preflop', on ajoutera ['flop','turn','river']
  //    - Si on est déjà en 'flop', on ajoutera ['turn','river']
  //    - Si on est en 'turn', on ajoutera ['river']
  //    - Si on est en 'river', on n’ajoute rien (on passe directement au reveal)
  //
  const phasesÀJouer = [];
  switch (state.phase) {
    case 'preflop':
      phasesÀJouer.push('flop', 'turn', 'river');
      break;
    case 'flop':
      phasesÀJouer.push('turn', 'river');
      break;
    case 'turn':
      phasesÀJouer.push('river');
      break;
    case 'river':
      // plus rien à ajouter, on ira directement au reveal
      break;
    default:
      // si state.phase est autre (p. ex. '' ou 'waiting'),
      // on peut considérer qu’on part de preflop
      phasesÀJouer.push('flop', 'turn', 'river');
      break;
  }

  // 3) On programme chacune des phases restantes avec 2,5 s entre chaque étape
  phasesÀJouer.forEach((phase, idx) => {
    const délai = idx * 2500; // 0ms pour la première (flop), 2500ms pour la suivante (turn), etc.
    setTimeout(() => {
      if (state.demo && gameStateByTable[tableID] !== state) return;
      state.phase = phase;
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
      io.to('admin').emit('updateTable', { tableID, gameState: state });
      if (matches2Config[tableID]) {
        io.to(tableID).emit('updateMatch2', { matchID: tableID, gameState: state });
        io.to('admin').emit('updateMatch2', { matchID: tableID, gameState: state });
      }
    }, délai);
  });

  // 4) Après la dernière phase (river), on passe au reveal + évaluation.
  //    Si phasesÀJouer est vide (était déjà en river), finalDelay vaut 0.
  const finalDelay = phasesÀJouer.length > 0
    ? (phasesÀJouer.length - 1) * 2500 + 2500
    : 0;

  setTimeout(() => {
    if (state.demo && gameStateByTable[tableID] !== state) return;
    state.phase = 'reveal';
    if (!state.roundEvaluated) markInShowdown(state, false);
    if (!state.revealSeq || state.revealSeq.done) {
      initRevealSequence(tableID, Boolean(matches2Config[tableID]), opts);
    }
io.to(tableID).emit('updateTable', state);   // joueurs

io.to(`spectate-table:${tableID}`).emit('spectatorState', {  // spectateurs
  type: 'table',
  tableID,
  gameState: state
});
    io.to('admin').emit('updateTable', { tableID, gameState: state });
    if (matches2Config[tableID]) {
      io.to(tableID).emit('updateMatch2', { matchID: tableID, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID: tableID, gameState: state });
    }
  }, finalDelay);
}

// ──────────────────────────────────────────────────────────────
// 12) Socket.IO handlers
// ──────────────────────────────────────────────────────────────
io.on('connection', socket => {
registerDemoController(socket, {
  tables: tablesConfig, matches: matches2Config, states: gameStateByTable,
  tableWaiting: waitingPlayersByTable, matchWaiting: waitingPlayersByMatch2,
  startTable: tryStartGame, startMatch: tryStartMatch2, next: dealNextHand,
  clear(id, state) {
    clearRevealSequence(id, state);
    for (const timers of [turnTimersByTable, turnTimersByMatch2]) {
      clearTimeout(timers[id]);
      delete timers[id];
    }
    for (const bets of [currentBetByTable, currentBetByMatch2, currentMinRaiseByTable, currentMinRaiseByMatch2]) delete bets[id];
  }
});
registerProgressionSocket(socket, {
  engine: progression, resolveName: resolveProgressionName, bindIdentity: bindProgressionIdentity,
  publish: publishProgression, hasPlayer: name => Object.prototype.hasOwnProperty.call(playerLevels, name)
});
// Toujours dans io.on('connection', (socket) => { ... })

// Championnat : classement courant envoyé à la connexion.
{
  const list = Object.values(playerLevels)
    .filter(e => e && e.name)
    .map(e => ({ name: e.name, points: e.points || 0, multiplier: e.multiplier || null }))
    .sort((a, b) => b.points - a.points)
    .slice(0, 20);
  socket.emit('championshipUpdated', list);
}

// ─────────────────────────────────────────────
// Admin : rejoint la room "admin"
// ─────────────────────────────────────────────
socket.on('joinAdmin', (payload = {}) => {
  const scopeCfg = resolveSocketJoinAdminScope(socket, payload);
  socket.data = socket.data || {};
  socket.data.adminScope = scopeCfg.key;
  console.log('[admin] joinAdmin', socket.id, scopeCfg.key);
  socket.join('admin');
  socket.join(`admin:${scopeCfg.key}`);
});

socket.on('adminStartTable', (payload = {}, cb) => {
  const scopeCfg = getAdminScopeFromSocket(socket);
  const tableID = String(payload.tableID || '');
  if (!tableID) return cb?.({ ok: false, error: 'tableID manquant.' });
  const roomCheck = ensureScopeCanManageRoom(scopeCfg, tableID);
  if (!roomCheck.ok) return cb?.({ ok: false, error: roomCheck.error });
  if (gameStateByTable[tableID]) {
    return cb?.({ ok: false, error: 'La partie est deja en cours.' });
  }
  const cfg = tablesConfig[tableID];
  const totalSeats = Number.isInteger(cfg?.totalSeats) ? cfg.totalSeats : (cfg?.players?.length || 10);
  const activeSeats = Number.isInteger(cfg?.activeSeats) ? cfg.activeSeats : totalSeats;
  const waiting = (waitingPlayersByTable[tableID] || []).slice(0, activeSeats);
  const connectedCount = waiting.filter(Boolean).length;
  const initialSocketIds = waiting.filter(Boolean).map(s => s.id);
  const minPlayers = 2;
  if (connectedCount < minPlayers) {
    return cb?.({ ok: false, error: `Pas assez de joueurs connectes pour demarrer (${connectedCount}/${minPlayers}).` });
  }

  if (maybeStartRoomAfterPortalIntro(tableID, false, { force: true, minPlayers, initialSocketIds, joinSeats: {} })) {
    return cb?.({ ok: true });
  }

  pendingForcedStartsByRoom[tableID] = {
    isMatch2: false,
    minPlayers,
    initialSocketIds,
    joinSeats: {},
    requestedAt: Date.now()
  };
  return cb?.({
    ok: true,
    pending: true,
    message: 'Demarrage en attente: les joueurs connectes finissent leur intro.'
  });
});

socket.on('adminStartMatch2', (payload = {}, cb) => {
  const scopeCfg = getAdminScopeFromSocket(socket);
  const matchID = String(payload.matchID || '');
  if (!matchID) return cb?.({ ok: false, error: 'matchID manquant.' });
  const roomCheck = ensureScopeCanManageRoom(scopeCfg, matchID);
  if (!roomCheck.ok) return cb?.({ ok: false, error: roomCheck.error });
  if (gameStateByTable[matchID]) {
    return cb?.({ ok: false, error: 'La partie est deja en cours.' });
  }
  const waiting = waitingPlayersByMatch2[matchID] || [];
  const connectedCount = waiting.filter(Boolean).length;
  const initialSocketIds = waiting.filter(Boolean).map(s => s.id);
  const minPlayers = 2;
  if (connectedCount < minPlayers) {
    return cb?.({ ok: false, error: `Pas assez de joueurs connectes pour demarrer (${connectedCount}/${minPlayers}).` });
  }

  if (maybeStartRoomAfterPortalIntro(matchID, true, { force: true, minPlayers, initialSocketIds, joinSeats: {} })) {
    return cb?.({ ok: true });
  }

  pendingForcedStartsByRoom[matchID] = {
    isMatch2: true,
    minPlayers,
    initialSocketIds,
    joinSeats: {},
    requestedAt: Date.now()
  };
  return cb?.({
    ok: true,
    pending: true,
    message: 'Demarrage en attente: les joueurs connectes finissent leur intro.'
  });
});

socket.on('adminTogglePause', (payload = {}, cb) => {
  const scopeCfg = getAdminScopeFromSocket(socket);
  const roomID = payload.tableID ?? payload.matchID;
  if (!roomID) return cb?.({ ok: false, error: 'ID manquant.' });
  const roomCheck = ensureScopeCanManageRoom(scopeCfg, roomID);
  if (!roomCheck.ok) return cb?.({ ok: false, error: roomCheck.error });

  const isMatch2 = Boolean(payload.matchID);
  const state = gameStateByTable[roomID];
  if (!state) return cb?.({ ok: false, error: 'Partie non demarree.' });

  if (state.adminPaused) {
    resumeGame(roomID, isMatch2);
  } else {
    pauseGame(roomID, isMatch2);
  }
  cb?.({ ok: true, paused: gameStateByTable[roomID]?.adminPaused });
});

socket.on('adminRestartHand', (payload = {}, cb) => {
  const scopeCfg = getAdminScopeFromSocket(socket);
  const roomID = payload.tableID ?? payload.matchID;
  if (!roomID) return cb?.({ ok: false, error: 'ID manquant.' });
  const roomCheck = ensureScopeCanManageRoom(scopeCfg, roomID);
  if (!roomCheck.ok) return cb?.({ ok: false, error: roomCheck.error });

  const isMatch2 = Boolean(payload.matchID);
  const result = forceResumeFromCurrentState(roomID, isMatch2);
  cb?.(result);
});

// Spectateur : rejoint une room de spectate
// ─────────────────────────────────────────────
// Spectateur : rejoint une room de spectate
// ─────────────────────────────────────────────
socket.on('joinSpectator', (payload = {}) => {
  const { tableID, matchID } = payload;

  // 👉 Cas table 10 joueurs
  if (tableID) {
    const id = String(tableID);
    socket.join(`spectate-table:${id}`);
    console.log('[SPECTATOR] join table', id);

    // renvoie immédiatement l'état courant à ce spectateur
    const g = gameStateByTable[id];
    if (g) {
      socket.emit('spectatorState', {
        type: 'table',
        tableID: id,
        gameState: g
      });
    }
    return;
  }

  // 👉 Cas duel (match2)
  if (matchID) {
    const id = String(matchID);
    socket.join(`spectate-match2:${id}`);
    console.log('[SPECTATOR] join match2', id);

    const g = gameStateByTable[id];
    if (g) {
      socket.emit('spectatorState', {
        type: 'match2',
        matchID: id,
        gameState: g
      });
    }
  }
});

// ─────────────────────────────────────────────
// Joueurs : joinGame (tables 10j + match2)
// ─────────────────────────────────────────────
function tryStartQuickTable(roomID) {
  const config = tablesConfig[roomID];
  const buf = waitingPlayersByTable[roomID];
  if (!config || !buf || gameStateByTable[roomID]) return false;
  const activeSeats = Number.isInteger(config.activeSeats) ? config.activeSeats : config.totalSeats;
  const takenCount = buf.slice(0, activeSeats).filter(s => s !== null).length;
  if (takenCount < activeSeats) return false;
  if (config.quickPlay) {
    const done = battleDoneByTable[roomID];
    if (!done || done.size < activeSeats) return false;
  }
  if (roomID === currentQuickTableID) currentQuickTableID = null;
  return maybeStartRoomAfterPortalIntro(roomID, false);
}

// Crée les sessions de Bataille (1 ou 2, selon bot/humain) et notifie les joueurs.
function startBattle(tableID, playerA, playerB) {
  const isBot = !playerB;
  const progressionEventId = `battle:${crypto.randomUUID()}`;

  battleSessionsBySeat[battleSessionKey(tableID, playerA.seat)] = {
    tableID, seat: playerA.seat, myLabel: playerA.label,
    progressionEventId,
    opponentSeat: isBot ? null : playerB.seat,
    opponentLabel: isBot ? 'Bot' : playerB.label,
    isBot, scoreMine: 0, scoreTheirs: 0, round: 1, myCard: null, done: false
  };
  const sockA = waitingPlayersByTable[tableID]?.[playerA.seat];
  if (sockA && isSocketConnected(sockA.id)) {
    sockA.emit('battleStart', { opponentLabel: isBot ? 'Bot' : playerB.label, isBot, round: 1, scoreMine: 0, scoreTheirs: 0 });
  }

  if (!isBot) {
    battleSessionsBySeat[battleSessionKey(tableID, playerB.seat)] = {
      tableID, seat: playerB.seat, myLabel: playerB.label,
      progressionEventId,
      opponentSeat: playerA.seat, opponentLabel: playerA.label,
      isBot: false, scoreMine: 0, scoreTheirs: 0, round: 1, myCard: null, done: false
    };
    const sockB = waitingPlayersByTable[tableID]?.[playerB.seat];
    if (sockB && isSocketConnected(sockB.id)) {
      sockB.emit('battleStart', { opponentLabel: playerA.label, isBot: false, round: 1, scoreMine: 0, scoreTheirs: 0 });
    }
  }
}

// Applique le résultat d'une manche à UNE session (appelée une ou deux fois selon bot/humain).
function applyBattleRoundResult(session, myCard, theirCard) {
  const myRank = battleCardRank(myCard);
  const theirRank = battleCardRank(theirCard);
  let roundWinner = 'tie';
  if (myRank > theirRank) { session.scoreMine++; roundWinner = 'me'; }
  else if (theirRank > myRank) { session.scoreTheirs++; roundWinner = 'them'; }

  const matchOver = session.scoreMine >= 2 || session.scoreTheirs >= 2;
  const outcome = matchOver ? (session.scoreMine > session.scoreTheirs ? 'win' : 'lose') : null;

  const payload = {
    round: session.round,
    myCard, theirCard, roundWinner,
    scoreMine: session.scoreMine,
    scoreTheirs: session.scoreTheirs,
    matchOver,
    outcome,
    opponentLabel: session.opponentLabel
  };

  if (roundWinner !== 'tie') session.round++;
  session.myCard = null;

  if (matchOver) {
    session.done = true;
    if (session.isPractice) {
      payload.pointsEarned = 0;
    } else {
      const receipt = progression.recordGame(session.myLabel, {
        eventId: session.progressionEventId, kind: 'battle', won: outcome === 'win',
        eligible: !isTrainingLevel(tablesConfig[session.tableID]?.level)
      });
      if (receipt) publishProgression(session.myLabel, receipt);
      payload.pointsEarned = receipt?.competitivePoints || 0;
      if (!battleDoneByTable[session.tableID]) battleDoneByTable[session.tableID] = new Set();
      battleDoneByTable[session.tableID].add(session.seat);
      tryStartQuickTable(session.tableID);
    }
  }

  return payload;
}

// Inscrit un siège dans la file d'appariement Bataille de sa table : apparié avec
// le prochain adversaire humain dispo, sinon bot après un court délai (personne n'attend longtemps).
function enrollBattle(tableID, seat, label) {
  if (!battleQueueByTable[tableID]) battleQueueByTable[tableID] = [];
  const queue = battleQueueByTable[tableID];

  if (queue.length > 0) {
    const opponent = queue.shift();
    if (opponent.timer) clearTimeout(opponent.timer);
    startBattle(tableID, { seat, label }, { seat: opponent.seat, label: opponent.label });
    return;
  }

  const entry = { seat, label, timer: null };
  entry.timer = setTimeout(() => {
    const idx = queue.indexOf(entry);
    if (idx >= 0) queue.splice(idx, 1);
    startBattle(tableID, { seat, label }, null);
  }, BATTLE_HUMAN_WAIT_MS);
  queue.push(entry);
}

function maybeStartRoomAfterPortalIntro(roomID, isMatch2, opts = {}) {
  if (!roomID) return false;
  if (gameStateByTable[roomID]) return false;

  const cfg = isMatch2 ? matches2Config[roomID] : tablesConfig[roomID];
  if (!cfg) return false;

  const waiting = isMatch2
    ? (waitingPlayersByMatch2[roomID] || [])
    : (waitingPlayersByTable[roomID] || []);

  const totalSeats = Number.isInteger(cfg.totalSeats)
    ? cfg.totalSeats
    : (Array.isArray(cfg.players) ? cfg.players.length : waiting.length);
  const activeSeats = Number.isInteger(cfg.activeSeats) ? cfg.activeSeats : totalSeats;
  const relevant = waiting.slice(0, activeSeats);
  const forceStart = Boolean(opts.force);
  const minPlayers = Number.isInteger(opts.minPlayers) ? opts.minPlayers : 2;
  const initialSocketIds = Array.isArray(opts.initialSocketIds) ? opts.initialSocketIds : null;
  const joinSeats = (opts.joinSeats && typeof opts.joinSeats === 'object') ? opts.joinSeats : null;

  const connectedCount = relevant.filter(Boolean).length;
  if (forceStart) {
    if (connectedCount < minPlayers) return false;
  } else if (connectedCount !== activeSeats) {
    return false;
  }

  const introGroup = (forceStart && initialSocketIds)
    ? relevant.filter(s => s && initialSocketIds.includes(s.id))
    : relevant.filter(Boolean);
  const introGroupCount = introGroup.length;
  if (forceStart && introGroupCount < minPlayers) return false;

  const readyCount = introGroup.filter(s => s && s._portalIntroDone === true).length;
  if (readyCount !== introGroupCount) return false;

  console.log('[portalIntro] tous prets, demarrage de la partie', { roomID, isMatch2, forceStart, connectedCount, introGroupCount });
  if (isMatch2) {
    tryStartMatch2(roomID, forceStart ? { force: true, minPlayers, joinSeats } : {});
    delete waitingPlayersByMatch2[roomID];
  } else {
    tryStartGame(roomID, forceStart ? { force: true, minPlayers, joinSeats } : {});
    delete waitingPlayersByTable[roomID];
  }
  delete pendingForcedStartsByRoom[roomID];
  return true;
}

socket.on('portalIntroDone', (payload = {}) => {
  socket._portalIntroDone = true;

  const hintedRoom = payload.tableID || payload.table || payload.matchID || payload.match2 || null;
  const candidateRooms = new Set([...socket.rooms].filter(r => r !== socket.id));
  if (hintedRoom) candidateRooms.add(hintedRoom);

  candidateRooms.forEach(roomID => {
    const pending = pendingForcedStartsByRoom[roomID];
    if (waitingPlayersByTable[roomID]) {
      maybeStartRoomAfterPortalIntro(
        roomID,
        false,
        (pending && pending.isMatch2 === false)
          ? {
              force: true,
              minPlayers: pending.minPlayers || 2,
              initialSocketIds: pending.initialSocketIds || [],
              joinSeats: pending.joinSeats || {}
            }
          : {}
      );
    }
    if (waitingPlayersByMatch2[roomID]) {
      maybeStartRoomAfterPortalIntro(
        roomID,
        true,
        (pending && pending.isMatch2 === true)
          ? {
              force: true,
              minPlayers: pending.minPlayers || 2,
              initialSocketIds: pending.initialSocketIds || [],
              joinSeats: pending.joinSeats || {}
            }
          : {}
      );
    }
  });
});

socket.on('quickJoin', payload => {
  payload = payload || {};
  const clientKey = String(payload.clientKey || '').trim();
  if (clientKey) socket._clientJoinKey = clientKey;
  let name = String(payload.name || '').trim().slice(0, 24);
  if (!name) name = 'Joueur';
  try { bindProgressionIdentity(socket, { name, clientKey }); }
  catch (error) { socket.emit('joinError', error.message); return; }

  const isSeatFree = (tableID, seat) => {
    const cfg = tablesConfig[tableID];
    if (!cfg) return false;
    const buf = waitingPlayersByTable[tableID];
    const claimed = cfg.players[seat] && cfg.players[seat] !== `Seat ${seat + 1}`;
    const reserved = buf && buf[seat];
    return !claimed && !reserved;
  };

  // Anti double-clic : réutilise l'assignation précédente si toujours valable.
  const prev = clientKey ? quickPlayByClientKey[clientKey] : null;
  if (prev && tablesConfig[prev.table] && !gameStateByTable[prev.table]) {
    const buf = waitingPlayersByTable[prev.table];
    const seatTakenByOther = buf && buf[prev.seat] && buf[prev.seat].id !== socket.id;
    if (!seatTakenByOther) {
      return socket.emit('quickJoinAssigned', { table: prev.table, seat: prev.seat });
    }
  }

  let tableID = currentQuickTableID;
  if (!tableID || !tablesConfig[tableID] || gameStateByTable[tableID]) {
    tableID = createQuickTable();
    currentQuickTableID = tableID;
  }

  let cfg = tablesConfig[tableID];
  let seat = cfg.players.findIndex((_, i) => i < cfg.activeSeats && isSeatFree(tableID, i));
  if (seat === -1) {
    // Tous les sièges déjà réclamés avant qu'une partie ne démarre → nouvelle table.
    tableID = createQuickTable();
    currentQuickTableID = tableID;
    cfg = tablesConfig[tableID];
    seat = 0;
  }

  cfg.players[seat] = name;
  saveTables();
  if (clientKey) quickPlayByClientKey[clientKey] = { table: tableID, seat };

  console.log('[quickJoin] assignation', { tableID, seat, name });
  socket.emit('quickJoinAssigned', { table: tableID, seat });
});

// Championnat : mise en file du vainqueur d'une table pour le face-à-face.
socket.on('joinFinals', payload => {
  payload = payload || {};
  const clientKey = String(payload.clientKey || socket._clientJoinKey || '').trim().slice(0, 160);
  if (clientKey) socket._clientJoinKey = clientKey;
  const name = resolveProgressionName(socket);
  if (!name) return socket.emit('joinError', 'Identifiez-vous avant de rejoindre une finale.');
  const entry = ensurePlayerRecord(name);

  const prevAssignment = entry.finalAssignment;
  if (prevAssignment && matches2Config[prevAssignment.matchID]?.players[prevAssignment.seat] === name && !matches2Config[prevAssignment.matchID].competitiveFinished && !gameStateByTable[prevAssignment.matchID]?.gameFinished) {
    return socket.emit('finalsMatchAssigned', prevAssignment);
  }
  if (prevAssignment) { delete entry.finalAssignment; saveLevels(); }
  if (!entry.pendingFinal) return socket.emit('joinError', 'Remportez une table de 10 joueurs pour accéder à la finale.');

  const alreadyQueued = finalsQueue.find(e => e.label === name);
  if (alreadyQueued) {
    alreadyQueued.socketId = socket.id;
    alreadyQueued.clientKey = clientKey;
    return socket.emit('finalsWaiting', {});
  }

  for (let i = finalsQueue.length - 1; i >= 0; i--) {
    if (!playerLevels[finalsQueue[i].label]?.pendingFinal) finalsQueue.splice(i, 1);
  }
  if (finalsQueue.length > 0) {
    const opponent = finalsQueue.shift();
    const matchID = crypto.randomBytes(4).toString('hex');
    matches2Config[matchID] = {
      players: [opponent.label, name],
      mode: QUICKPLAY_MODE,
      level: normalizeCreditLevel(QUICKPLAY_LEVEL),
      isChampionshipFinal: true
    };
    saveMatches2();
    emitAdminRoomsUpdated('matches2Updated', matches2Config[matchID].level);

    const assignmentA = { matchID, seat: 0 };
    const assignmentB = { matchID, seat: 1 };
    const opponentEntry = ensurePlayerRecord(opponent.label);
    opponentEntry.finalAssignment = assignmentA;
    entry.finalAssignment = assignmentB;
    delete opponentEntry.pendingFinal;
    delete entry.pendingFinal;
    saveLevels();
    if (opponent.clientKey) finalsAssignmentByClientKey[opponent.clientKey] = assignmentA;
    if (clientKey) finalsAssignmentByClientKey[clientKey] = assignmentB;

    const oppSocket = opponent.socketId ? io.sockets.sockets.get(opponent.socketId) : null;
    if (oppSocket) oppSocket.emit('finalsMatchAssigned', assignmentA);
    socket.emit('finalsMatchAssigned', assignmentB);
    console.log('[joinFinals] appariement', { matchID, players: [opponent.label, name] });
    return;
  }

  finalsQueue.push({ label: name, clientKey, socketId: socket.id });
  socket.emit('finalsWaiting', {});
});

// Championnat : tirage de la roue à multiplicateur après une victoire en face-à-face.
socket.on('spinWheel', payload => {
  const name = resolveProgressionName(socket);
  if (!name) return;
  const result = progression.spin(name, spinWheelValue());
  socket.emit('wheelResult', result);
  publishProgression(name, result.receipt || null);
});

// Test/aperçu (écran d'accueil) : Bataille solo contre un bot, sans impact sur le classement.
socket.on('startPracticeBattle', () => {
  battleSessionsBySeat[`practice:${socket.id}`] = {
    tableID: null, seat: null, myLabel: 'Vous',
    opponentSeat: null, opponentLabel: 'Bot', isBot: true,
    scoreMine: 0, scoreTheirs: 0, round: 1, myCard: null, done: false,
    isPractice: true
  };
  socket.emit('battleStart', { opponentLabel: 'Bot', isBot: true, round: 1, scoreMine: 0, scoreTheirs: 0, practice: true });
});

// Test/aperçu : tirage de roue sans conséquence (ne modifie aucun multiplicateur persisté).
socket.on('previewSpinWheel', () => {
  socket.emit('wheelResult', { multiplier: spinWheelValue(), preview: true });
});

// Écran d'accueil : profil/statistiques résumés d'un joueur (points, rang, multiplicateur, parties).
socket.on('getHomeProfile', (payload) => {
  const name = String(payload?.name || '').trim();
  if (!name) { socket.emit('homeProfile', null); return; }
  const entry = ensurePlayerRecord(name);
  if (!entry) { socket.emit('homeProfile', null); return; }
  const sorted = Object.values(playerLevels)
    .filter(e => e && e.name && (e.points || 0) > 0)
    .sort((a, b) => (b.points || 0) - (a.points || 0));
  const rankIdx = sorted.findIndex(e => e.name === name);
  const t = statsTable[name] || {};
  const m = statsMatch2[name] || {};
  const gamesPlayed = (t.gamesPlayed || 0) + (m.gamesPlayed || 0);
  const wins = (t.wins || 0) + (m.wins || 0);
  socket.emit('homeProfile', {
    name,
    points: entry.points || 0,
    multiplier: entry.multiplier || null,
    rank: rankIdx >= 0 ? rankIdx + 1 : null,
    totalRanked: sorted.length,
    level: entry.level,
    credits: entry.credits || 0,
    gamesPlayed,
    wins,
    winRate: gamesPlayed ? Math.round((wins / gamesPlayed) * 100) : 0,
    table: { played: t.gamesPlayed || 0, wins: t.wins || 0 },
    duel: { played: m.gamesPlayed || 0, wins: m.wins || 0 }
  });
});

// Championnat : le joueur joue sa carte pour la manche de Bataille en cours.
socket.on('playBattleRound', payload => {
  payload = payload || {};
  const isPractice = Boolean(payload.practice);
  const tableID = payload.table;
  const seat = parseInt(payload.seat, 10);
  if (!isPractice && waitingPlayersByTable[tableID]?.[seat]?.id !== socket.id) return;
  const key = isPractice ? `practice:${socket.id}` : battleSessionKey(tableID, seat);
  const session = battleSessionsBySeat[key];
  if (!session || session.done || session.myCard) return;

  session.myCard = drawBattleCard();

  if (session.isBot) {
    const botCard = drawBattleCard();
    const result = applyBattleRoundResult(session, session.myCard, botCard);
    socket.emit('battleRoundResult', result);
    return;
  }

  const oppSession = battleSessionsBySeat[battleSessionKey(tableID, session.opponentSeat)];
  if (!oppSession) return;

  if (oppSession.myCard) {
    const myCardThisRound = session.myCard;
    const theirCardThisRound = oppSession.myCard;
    const resultMe = applyBattleRoundResult(session, myCardThisRound, theirCardThisRound);
    const resultThem = applyBattleRoundResult(oppSession, theirCardThisRound, myCardThisRound);
    socket.emit('battleRoundResult', resultMe);
    const oppSocket = waitingPlayersByTable[tableID]?.[session.opponentSeat];
    if (oppSocket && isSocketConnected(oppSocket.id)) oppSocket.emit('battleRoundResult', resultThem);
  } else {
    socket.emit('battleRoundWaiting', { round: session.round });
  }
});

socket.on('joinGame', payload => {
  console.log('[joinGame] payload brut :', payload);

  payload = payload || {};
  const incomingClientKey = String(payload.clientKey || '').trim();
  if (incomingClientKey) {
    socket._clientJoinKey = incomingClientKey;
  }

  // 0) Récupère roomID et type (table VS match2)
  const roomID   = payload.table  ?? payload.match2;
  const isMatch2 = Boolean(payload.match2);
  if (isMatch2 && matches2Config[roomID]?.competitiveFinished && !gameStateByTable[roomID]) {
    return socket.emit('joinError', 'Cette finale est terminée. Revenez à l’accueil pour continuer.');
  }

  if (!roomID) {
    // Pas de paramètres → on montre un écran d’accueil lisible
    return sendEndPage(
      socket,
      'lose',
      'Aucune partie détectée',
      'Ouvrez un lien du type /?table=ID&seat=N ou cliquez sur "Retour au lobby".'
    );
  }

  // 1) TENTATIVE DE RECONNEXION SI LA PARTIE TOURNE DÉJÀ
  const G = gameStateByTable[roomID];
  if (G) {
    console.log('[joinGame] Reconnexion sur partie existante', roomID);

    // 1.1) Vérifie le seat
    const seat = parseInt(payload.seat, 10);
    if (!Number.isInteger(seat) || seat < 0 || seat >= G.players.length) {
      return socket.emit('joinError', 'Paramètre seat manquant ou invalide.');
    }

    // On essaie d'abord par index, puis en fallback par p.seat
    let p = G.players[seat];
    if (!p) {
      p = G.players.find(player => player && player.seat === seat);
    }
    if (!p) {
      return socket.emit('joinError', 'Siège introuvable.');
    }

    // 1.2) Si un gagnant est déjà déterminé, on refuse l'accès (trop tard)
    const winnerPlayers = G.players.filter(pl => pl && pl.status === 'WINNER');
    const winnerNames = winnerPlayers.map(pl => displayPlayerLabel(pl));
    const winnerLabel =
      (winnerNames.length > 1) ? winnerNames.join(' et ') :
      (winnerNames[0] || (G.winReason && G.winReason.winnerId
        ? displayPlayerLabel(G.players.find(pl => pl && pl.id === G.winReason.winnerId)) || 'Player'
        : 'Player'));
    const gameAlreadyWon = Boolean(
      G.gameFinished ||
      (G.winReason && (G.winReason.winnerId || G.winReason.winnerLabel)) ||
      (G.revealSeqDone && winnerPlayers.length > 0) ||
      winnerPlayers.length > 0
    );
    // Partie terminee: on garde la table affichee cote client au reload.

    // 1.2.b) Si le joueur n'a plus de stack -> BUST + GAME OVER
    const noStack = (p.bankroll | 0) <= 0;
    const isAllInLike = p.status === 'ALLIN' || p.inShowdown;
    if (!gameAlreadyWon && noStack && !isAllInLike && p.status !== 'WINNER') {
      if (p.status !== 'BUST') p.status = 'BUST';
      return sendEndPage(
        socket,
        'lose',
        'GAME OVER',
        'Votre stack est à 0. Vous êtes éliminé.'
      );
    }

    // 1.2.c) Si la partie était en pause car tout le monde était en BREAK
    if (G.allBreakPaused) {
      // Reconnexion pendant "tout le monde en BREAK" -> reste en BREAK
      // (il devra appuyer sur PAUSE pour revenir directement)
      p.isBreak = true;
      p.status = 'WAIT';
      p.reconnectRestoreStatus = null;
      if (Array.isArray(G.allBreakJoinSeats)) {
        G.allBreakJoinSeats = G.allBreakJoinSeats.filter(s => s !== seat);
      }
      resumeFromAllBreak(roomID, isMatch2);
    }

    // Rechargement du même navigateur : on remplace l'ancien socket au lieu de bloquer.
    const liveSeatSocket = p.id ? io.sockets.sockets.get(p.id) : null;
    const liveSeatClientKey = String(liveSeatSocket?._clientJoinKey || '').trim();
    const sameLiveClient = Boolean(
      incomingClientKey &&
      liveSeatClientKey &&
      incomingClientKey === liveSeatClientKey
    );

    if (p.id && p.id !== socket.id && p.status !== 'BUST' && p.status !== 'WAIT') {
      if (sameLiveClient) {
        if (liveSeatSocket && typeof liveSeatSocket.disconnect === 'function') {
          liveSeatSocket.disconnect(true);
        }
      } else if (isSocketConnected(p.id)) {
        return socket.emit('joinError', 'Ce siège est déjà pris.');
      }
    }

    // 1.2) Si la partie est déjà terminée (1 seul survivant), on affiche une page de fin
    const survivors = G.players.filter(player => player.status !== 'BUST' && player.status !== 'WAIT');
    if (!gameAlreadyWon && survivors.length === 1) {
      const winnerLabel = displayPlayerLabel(survivors[0]) || 'Player';
      if (p.status !== 'BUST' && p.status !== 'WAIT') {
        return sendEndPage(
          socket,
          'win',
          'La partie est terminée, vous avez gagné 🎉',
          'Bravo !'
        );
      } else {
        return sendEndPage(
          socket,
          'lose',
          `Trop tard : ${winnerLabel} a déjà gagné.`,
          'Impossible de réintégrer cette table.'
        );
      }
    }

    // 1.3) Reconnexion réelle : on met à jour le socket.id et on renvoie l’état courant
    const prevId = p.id;
    p.id = socket.id;
    if (p._reconnectTimer) {
      clearTimeout(p._reconnectTimer);
      p._reconnectTimer = null;
    }
    if (p.status === 'WAIT' && !p.isBreak && p.reconnectRestoreStatus !== null) {
      p.status = p.reconnectRestoreStatus;
      p.reconnectRestoreStatus = null;
    }
    const phase = G.phase || '';
    const isActionPhase = ['preflop','flop','turn','river'].includes(phase);
    const entry = ensurePlayerRecord(p.label);
    if (entry) p.credits = entry.credits;
    socket.playerData = { id: socket.id, label: p.label, seat };
    socket.join(roomID);

    // IMPORTANT :
    // - Pour les duels (match2), le client attend { gameState }
    // - Pour les tables 10 joueurs, le client attend directement gameState (G)
    if (isMatch2) {
      io.to(socket.id).emit('updateMatch2', {
        matchID: roomID,
        gameState: G
      });
      broadcastMatch2State(roomID);
    } else {
      // 🔧 CORRECTION ICI : on envoie directement G (et pas { tableID, gameState: G })
      io.to(socket.id).emit('updateTable', G);
      broadcastTableState(roomID);
    }

    return;
  }

  // 2) AUCUNE GAME EN COURS → ON PASSE PAR LA WAITING ROOM.
  // Ne pas bloquer sur gamesHistory : après redémarrage serveur on peut
  // perdre l'état live en RAM alors que la room doit rester rejoignable/restartable.

  // 2.1) Sélectionne la config et le buffer d’attente
  const config     = isMatch2 ? matches2Config[roomID]   : tablesConfig[roomID];
  const waitingBuf = isMatch2 ? waitingPlayersByMatch2   : waitingPlayersByTable;

  if (!config) {
    // Config introuvable (table fermée / ID périmé)
    return sendEndPage(
      socket,
      'lose',
      'Partie introuvable',
      'La table est fermée (inactivité) ou l’ID est périmé.'
    );
  }

  // 3) Nombre de sièges possibles (10 ou 2)
  const totalSeats = Number.isInteger(config.totalSeats) ? config.totalSeats : config.players.length;
  const activeSeats = Number.isInteger(config.activeSeats) ? config.activeSeats : totalSeats;

  // 4) Initialise un tableau fixe [null,…] de longueur totalSeats
  if (!waitingBuf[roomID]) {
    waitingBuf[roomID] = Array(totalSeats).fill(null);
  }

  // 5) Lecture & validation du seat
  const seat = parseInt(payload.seat, 10);
  if (!Number.isInteger(seat) || seat < 0 || seat >= activeSeats) {
    return socket.emit(
      'joinError',
      `Paramètre seat manquant ou invalide : utilisez &seat=0…${activeSeats - 1}`
    );
  }

  // 6) Refuse si déjà réservé, sauf reprise légitime du même navigateur.
  const existingSeatSocket = waitingBuf[roomID][seat];
  if (existingSeatSocket) {
    const existingSocketId = existingSeatSocket.id;
    const isStillConnected = Boolean(existingSocketId && io.sockets.sockets.has(existingSocketId));
    const existingClientKey = String(existingSeatSocket._clientJoinKey || '').trim();
    const sameClient = Boolean(
      incomingClientKey &&
      existingClientKey &&
      incomingClientKey === existingClientKey
    );

    if (!isStillConnected || sameClient) {
      // Slot stale (ancien socket mort) OU reload du même navigateur.
      waitingBuf[roomID][seat] = null;
      if (sameClient && isStillConnected && typeof existingSeatSocket.disconnect === 'function') {
        existingSeatSocket.disconnect(true);
      }
    } else {
      return socket.emit('joinError', 'Ce siège est déjà pris.');
    }
  }

  // 7) Réserve ce siège pour ce socket
  waitingBuf[roomID][seat] = socket;
  socket._portalIntroDone = Boolean(payload.portalIntroDone || socket._portalIntroDone);
  const pendingStartCtx = pendingForcedStartsByRoom[roomID];
  if (pendingStartCtx && pendingStartCtx.isMatch2 === isMatch2) {
    const wasInInitialGroup = Array.isArray(pendingStartCtx.initialSocketIds)
      ? pendingStartCtx.initialSocketIds.includes(socket.id)
      : false;
    if (!wasInInitialGroup) {
      if (!pendingStartCtx.joinSeats || typeof pendingStartCtx.joinSeats !== 'object') {
        pendingStartCtx.joinSeats = {};
      }
      pendingStartCtx.joinSeats[seat] = true;
    }
  }
  const label = config.players[seat];
  socket.playerData = { id: socket.id, label, seat };

  // 8) Rejoint la room
  socket.join(roomID);
  console.log(
    '[joinGame] joueur en attente',
    { roomID, seat, label, isMatch2, totalSeats, activeSeats }
  );

  // 8bis) Championnat : inscription à la Bataille (tables "Jouer" uniquement)
  if (!isMatch2 && config.quickPlay) {
    if (!battleEnrolledByTable[roomID]) battleEnrolledByTable[roomID] = new Set();
    if (!battleEnrolledByTable[roomID].has(seat)) {
      battleEnrolledByTable[roomID].add(seat);
      enrollBattle(roomID, seat, label);
    } else {
      const session = battleSessionsBySeat[battleSessionKey(roomID, seat)];
      if (session && !session.done) {
        socket.emit('battleStart', {
          opponentLabel: session.opponentLabel,
          isBot: session.isBot,
          round: session.round,
          scoreMine: session.scoreMine,
          scoreTheirs: session.scoreTheirs
        });
      } else if (session && session.done) {
        socket.emit('battleAlreadyDone', {});
      }
    }
  }

  // 9) Si tous les sièges sont occupés → lancement de la partie
  const takenCount = waitingBuf[roomID].slice(0, activeSeats).filter(s => s !== null).length;
  const allTaken = takenCount === activeSeats;
  const pendingStart = pendingForcedStartsByRoom[roomID];
  if (pendingStart && pendingStart.isMatch2 === isMatch2) {
    if (maybeStartRoomAfterPortalIntro(roomID, isMatch2, {
      force: true,
      minPlayers: pendingStart.minPlayers || 2,
      initialSocketIds: pendingStart.initialSocketIds || [],
      joinSeats: pendingStart.joinSeats || {}
    })) {
      return;
    }
  }
  if (allTaken) {
    console.log('[joinGame] room complète → lancement de la partie', roomID);

    if (isMatch2) {
      if (maybeStartRoomAfterPortalIntro(roomID, isMatch2)) {
        return;
      }
    } else if (tryStartQuickTable(roomID)) {
      return;
    }
    // Table "Jouer" pleine mais Bataille(s) encore en cours : on attend
    // qu'elles se terminent (tryStartQuickTable est rappelé depuis startBattle).
  }

  // 10) Sinon on notifie le nombre de places prises (waiting room)
  const count = takenCount;

  const waitingPayload = {
    waitingCount: count,
    totalSeats,
    activeSeats,
    level: config.level || 'Q1',
    seatsTaken: waitingBuf[roomID].map(s => Boolean(s)),
    seatLabels: config.players,
    quickPlay: !isMatch2 && Boolean(config.quickPlay)
  };
  if (isMatch2) {
    waitingPayload.matchID = roomID; // pour ton admin.js
  } else {
    waitingPayload.tableID = roomID; // pour ton admin.js
  }

  console.log('[joinGame] updateWaitingRoom émis :', waitingPayload);

  // → vers tous les joueurs de cette room
  io.to(roomID).emit('updateWaitingRoom', waitingPayload);

  // → vers l’interface admin
  io.to('admin').emit('updateWaitingRoom', waitingPayload);
});

socket.on('playerAction', action => {
  if (!action || typeof action !== 'object') return;
  // 1) Récupération du contexte
  const rooms = [...socket.rooms].filter(r => r !== socket.id);
  if (!rooms.length) return;

  const table    = socket.demoRoomID || rooms[0];
  const isMatch2 = Boolean(matches2Config[table]);
  const state    = gameStateByTable[table];
  if (!state) return;
  if (state.adminPaused) return;

  const idx = state.demo && socket.demoRoomID === table
    ? state.current_bettor_index : state.players.findIndex(p => p.id === socket.id);
  if (idx < 0) return;
  if (state.demo && (state.gameFinished || state.demoRunningOut ||
      !['preflop', 'flop', 'turn', 'river'].includes(state.phase) ||
      action.demoRoomID !== table || action.demoRevision !== state.demoRevision ||
      action.demoRound !== state.roundNumber || action.demoSeat !== idx ||
      (action.type === 'raise' && (!Number.isFinite(action.amount) || action.amount < 0)))) return;

  const me = state.players[idx];

  // 🔒 1.a) Sécurité : si le joueur est BUST ou n’a plus de jetons → il ne peut plus agir
  if (me.status === 'BUST' || me.status === 'WAIT' || ((me.bankroll | 0) === 0)) {
    return; // on ignore silencieusement
  }

  // 🔒 1.b) Optionnel mais très conseillé : seulement le joueur dont c’est le tour peut agir
  if (idx !== state.current_bettor_index &&
      !['ALLIN','FOLD','BUST','WAIT'].includes(state.players[state.current_bettor_index]?.status || '')) {
    return; // ce n’est pas son tour → action ignorée
  }

  // 2) Ajustement du montant du call (tient compte de match2)
  if (action.type === 'call') {
    const cb = (isMatch2
      ? currentBetByMatch2[table]
      : currentBetByTable[table]
    ) || 0;
    action.amount = cb - (me.subtotal_bet || 0);
  }

  // 3) Application de l’action
  const prevCB = (isMatch2 ? currentBetByMatch2[table] : currentBetByTable[table]) || 0;
  let ok = false;

  if (action.type === 'fold') {
    me.status = 'FOLD';
    ok = true;

  } else if (
    action.type === 'check' &&
    me.subtotal_bet === (
      isMatch2
        ? currentBetByMatch2[table]
        : currentBetByTable[table]
    )
  ) {
    me.status = 'CHECK';
    state.checkCount++;
    ok = true;

  } else if (['call', 'raise'].includes(action.type)) {
    ok = serverBet(table, idx, action.amount);
  }

  if (!ok) return;
  if (state.demo) state.demoRevision++;

  if (state.phase === 'preflop') {
    if (idx === state.bigBlindIndex) state.bbOptionPending = false;
    const newCB = (isMatch2 ? currentBetByMatch2[table] : currentBetByTable[table]) || 0;
    if (state.bbOptionPending && newCB > prevCB) state.bbOptionPending = false;
  }

  // → Le joueur vient d'agir : on remet à zéro tout avertissement pendu
  io.to(socket.id).emit('clearWarningElimination');
  state.players[idx].missedCount = 0;
  state.players[idx].warned      = false;
  // Si le timer était figé pour ce joueur, on nettoie le flag
state.timeFrozen    = false;
state.timeFrozenFor = null;

  // === [NOUVEAU] TABLE 10 joueurs : auto-runout seulement si 0 ou 1 joueur a encore des jetons
  if (!isMatch2) {
    const s  = state;
    const cb = (currentBetByTable[table] || 0);

    const alive = s.players.filter(p => p.status !== 'FOLD' && p.status !== 'BUST' && p.status !== 'WAIT');
    if (alive.length >= 2) {
      const withChips   = alive.filter(p => (p.bankroll || 0) > 0);
      const nbWithChips = withChips.length;

      if (nbWithChips <= 1) {
        const covered = withChips.every(p => (p.subtotal_bet || 0) >= cb);
        if (covered) return startRevealAllIn(table);
      }
    }
  }

  // === HEADS-UP : all-in + call → runout + reveal ===
  if (isMatch2) {
    const aliveHU = state.players.filter(p => p.status !== 'FOLD' && p.status !== 'BUST' && p.status !== 'WAIT');
    if (aliveHU.length === 2) {
      const [A, B] = aliveHU;
      const isAllInA = (A.status === 'ALLIN') || ((A.bankroll|0) === 0);
      const isAllInB = (B.status === 'ALLIN') || ((B.bankroll|0) === 0);

      if (isAllInA !== isAllInB) {
        const caller  = isAllInA ? B : A;
        const cb      = (currentBetByMatch2[table] || 0);
        const covered = (caller.subtotal_bet || 0) >= cb;
        const hasChips= (caller.bankroll || 0) > 0;

        if (covered && (caller.status === 'CALL' || caller.status === 'RAISE' || caller.status === 'CHECK')) {
          return startRevealAllIn(table);
        }
      }
    }
  }

  // 4bis) Si tous les survivants sont ALLIN → showdown immédiat
  const active = state.players.filter(p => p.status !== 'FOLD' && p.status !== 'BUST' && p.status !== 'WAIT');
  if (active.length > 0 && active.every(p => p.status === 'ALLIN')) {
    return startRevealAllIn(table);
  }

  // 5) Si plus qu’un survivant → showdown
  if (active.length === 1) {
    return startReveal(table, { defaultAction: 'hide' });
  }

  // 6) Avance de phase si tout le monde a misé/call ou checké
  if (isRoundComplete(table)) {
    const PH = ['preflop','flop','turn','river','reveal'];
    const i  = PH.indexOf(state.phase);
    if (i >= 0 && i < PH.length - 1) {
      state.phase = PH[i + 1];
      state.players.forEach(p => {
        p.subtotal_bet = 0;
        if (!['FOLD','BUST','ALLIN','WAIT'].includes(p.status)) {
          p.status = '';
          if ((p.bankroll | 0) === 0 && p.status !== 'BUST' && p.status !== 'WAIT') p.status = 'ALLIN';
        }
      });

      if (isMatch2) {
        currentBetByMatch2[table]      = 0;
        currentMinRaiseByMatch2[table] = 0;
      } else {
        currentBetByTable[table]       = 0;
        currentMinRaiseByTable[table]  = 0;
      }
      state.current_bet = 0;
      state.checkCount  = 0;
      state.bbOptionPending = false;
    }
    if (state.phase === 'reveal') {
      return startReveal(table);
    }
  }

  // 7) Passe au joueur suivant
  const N = state.players.length;
  do {
    state.current_bettor_index = (state.current_bettor_index + 1) % N;
  } while (['FOLD','BUST','ALLIN','WAIT'].includes(state.players[state.current_bettor_index].status));

  // 8) Émet les updates + reset timer
if (isMatch2) {
  resetTurnTimer2(table);
  broadcastMatch2State(table);   // joueurs + admin + spectateurs
} else {
  resetTurnTimer(table);
  broadcastTableState(table);    // joueurs + admin + spectateurs
}
});

// ─────────────────────────────────────────────
// Bouton TIME (tables 10 joueurs)
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
socket.on('calculatorOpened', () => {
  const rooms = [...socket.rooms].filter(r => r !== socket.id);
  if (!rooms.length) return;

  const roomID   = rooms[0];
  const isMatch2 = Boolean(matches2Config[roomID]);

  const state = gameStateByTable[roomID];
  if (!state) return;

  const idx = state.players.findIndex(p => p && p.id === socket.id);
  if (idx < 0) return;

  if (idx !== state.current_bettor_index) return;
  if (!['preflop','flop','turn','river'].includes(state.phase)) return;

  // No reset while waiting for TIME
  if (state.timeFrozen) return;

  const isTimeExtension = Boolean(state.timeExtensionUsed);

  if (isTimeExtension) {
    if (state.calcExtensionUsed) return;
    state.calcExtensionUsed = true;
  } else {
    if (state.calcPrimaryUsed) return;
    state.calcPrimaryUsed = true;
  }

    const now = Date.now();
    const elapsed = now - (state.turnStartTime || now);
    const remaining = Math.max(0, (state.turnDuration || 0) - elapsed);
    const baseRemaining = Math.max(0, 30_000 - elapsed);
    const bonusCap = Math.max(0, state.add30BonusMs || 0);
    const bonusRemaining = Math.max(0, Math.min(bonusCap, remaining - baseRemaining));
    const override = { turnStartTime: now, turnDuration: 30_000 + bonusRemaining };

    if (isMatch2) {
      resetTurnTimer2(roomID, isTimeExtension, true, override);
      broadcastMatch2State(roomID);
    } else {
      resetTurnTimer(roomID, isTimeExtension, true, override);
      broadcastTableState(roomID);
    }
});
// Bouton TIME (tables 10 joueurs + duels)
// ─────────────────────────────────────────────
socket.on('requestTime', () => {
  const rooms = [...socket.rooms].filter(r => r !== socket.id);
  if (!rooms.length) return;

  const roomID   = rooms[0];
  const isMatch2 = Boolean(matches2Config[roomID]);

  const state = gameStateByTable[roomID];
  if (!state) return;

  const idx = state.players.findIndex(p => p && p.id === socket.id);
  if (idx < 0) return;

  const me = state.players[idx];

  // 1) Le joueur qui demande le TIME ne doit pas être celui qui doit jouer
  if (idx === state.current_bettor_index) return;

  // 2) Il doit encore être en lice
  if (['FOLD','BUST','WAIT'].includes(me.status) || ((me.bankroll | 0) === 0)) return;

  // 3) Le timer doit être figé pour le joueur courant
  if (!state.timeFrozen || state.timeFrozenFor !== state.current_bettor_index) return;

  // 4) TIME déjà utilisé pour ce tour ?
  if (state.timeExtensionUsed) return;

  // OK : on consomme le TIME
  state.timeFrozen        = false;
  state.timeFrozenFor     = null;
  state.timeExtensionUsed = true;

  // Notifie tout le monde
  if (isMatch2) {
    io.to(roomID).emit('timeGranted', {
      matchID:  roomID,
      seatIndex: state.current_bettor_index,
      duration: 30_000
    });
    // relance du timer en mode "extension"
    resetTurnTimer2(roomID, true, true);
  } else {
    io.to(roomID).emit('timeGranted', {
      tableID:  roomID,
      seatIndex: state.current_bettor_index,
      duration: 30_000
    });
    resetTurnTimer(roomID, true, true);
  }
});

// Bouton +30s : ajoute 30s au joueur courant (1x par tour)
socket.on('requestAdd30', () => {
  const rooms = [...socket.rooms].filter(r => r !== socket.id);
  if (!rooms.length) return;

  const roomID   = rooms[0];
  const isMatch2 = Boolean(matches2Config[roomID]);
  const state = gameStateByTable[roomID];
  if (!state) return;
  if (state.adminPaused) return;

  const levelRaw = isMatch2 ? matches2Config[roomID]?.level : tablesConfig[roomID]?.level;
  const isTraining = isTrainingLevel(normalizeCreditLevel(levelRaw));

  const idx = state.players.findIndex(p => p && p.id === socket.id);
  if (idx < 0) return;

  const me = state.players[idx];
  if (!me) return;

  if (idx !== state.current_bettor_index) return;
  if (!['preflop','flop','turn','river'].includes(state.phase)) return;
  const wasFrozen = state.timeFrozen && state.timeFrozenFor === idx;
  if (state.timeFrozen && !wasFrozen) return;
  // +30s peut être utilisé plusieurs fois par tour tant qu'il reste des crédits.
  if (['BUST','WAIT'].includes(me.status)) return;

  if (!isTraining) {
    const entry = ensurePlayerRecord(me.label);
    if (entry) {
      if (!Number.isFinite(entry.timeCredits)) entry.timeCredits = DEFAULT_TIME_CREDITS;
      if (entry.timeCredits > 0) {
        entry.timeCredits -= 1;
        entry.history.push({
          date: new Date().toISOString(),
          action: 'Time credit -1 (Add30)'
        });
      } else {
        const by = ensureCreditsByLevel(entry);
        if ((by.Q1 || 0) > 0) {
          by.Q1 -= 1;
          entry.history.push({
            date: new Date().toISOString(),
            action: 'Time credit 0 -> Q1 -1 (Add30)'
          });
        } else {
          // No time credits and no classic credits: do not allow +30s.
          entry.history.push({
            date: new Date().toISOString(),
            action: 'Time credit 0 -> Q1 0 (Add30)'
          });
          return;
        }
      }
      entry.credits = totalCredits(entry);
      entry.level = highestCreditLevel(entry);
      saveLevels();
      io.to('admin').emit('profilesUpdated');
      io.to('admin').emit('levelsUpdated');
      syncCreditsOnPlayers(state.players);
    }
  }

  const now = Date.now();
  const elapsed = now - (state.turnStartTime || now);
  const remaining = Math.max(0, (state.turnDuration || 0) - elapsed);
  const nextDuration = wasFrozen ? 30_000 : (state.turnDuration || 30_000) + 30_000;

  state.add30Used = true;
  state.add30BonusMs = (state.add30BonusMs || 0) + 30_000;
  state.disconnectPaused = false;
  state.turnRemainingMs = null;
  if (wasFrozen) {
    state.timeFrozen = false;
    state.timeFrozenFor = null;
    if (isMatch2) {
      io.to(roomID).emit('timeGranted', {
        matchID: roomID,
        seatIndex: idx,
        duration: 30_000
      });
    } else {
      io.to(roomID).emit('timeGranted', {
        tableID: roomID,
        seatIndex: idx,
        duration: 30_000
      });
    }
  }

  const override = {
    turnStartTime: wasFrozen ? now : (state.turnStartTime || now),
    turnDuration: nextDuration
  };

  if (isMatch2) {
    resetTurnTimer2(roomID, false, true, override);
    broadcastMatch2State(roomID);
  } else {
    resetTurnTimer(roomID, false, true, override);
    broadcastTableState(roomID);
  }
});

// SOS alert from player -> admin
socket.on('sosAlert', (payload = {}) => {
  const rooms = [...socket.rooms].filter(r => r !== socket.id);
  const roomID = rooms[0];
  const tableID = payload.tableID || null;
  const matchID = payload.matchID || null;
  const seatIndex = Number.isInteger(payload.seatIndex) ? payload.seatIndex : null;
  const playerLabel = String(payload.playerLabel || '').trim();
  if (!tableID && !matchID && !roomID) return;
  sosChatByClient.set(socket.id, {
    tableID: tableID || (matchID ? null : roomID),
    matchID: matchID || (tableID ? null : roomID),
    seatIndex,
    playerLabel
  });

  io.to('admin').emit('sosAlert', {
    tableID: tableID || (matchID ? null : roomID),
    matchID: matchID || (tableID ? null : roomID),
    seatIndex,
    playerLabel,
    clientId: socket.id,
    ts: Date.now()
  });
});

// SOS chat: player -> admin
socket.on('sosChatPlayerMessage', (payload = {}) => {
  const message = String(payload.message || '').trim();
  if (!message) return;
  const cached = sosChatByClient.get(socket.id) || {};
  io.to('admin').emit('sosChatMessage', {
    clientId: socket.id,
    tableID: payload.tableID || cached.tableID || null,
    matchID: payload.matchID || cached.matchID || null,
    seatIndex: Number.isInteger(payload.seatIndex) ? payload.seatIndex : cached.seatIndex,
    playerLabel: String(payload.playerLabel || cached.playerLabel || '').trim(),
    from: 'player',
    message,
    ts: Date.now()
  });
});

// SOS chat: admin -> player
socket.on('sosChatAdminMessage', (payload = {}) => {
  const clientId = payload.clientId;
  const message = String(payload.message || '').trim();
  if (!clientId || !message) return;
  io.to(clientId).emit('sosChatMessage', {
    from: 'admin',
    message,
    ts: Date.now()
  });
});

// Reveal : choix du joueur (cacher ses cartes) pendant la fenetre de 5s
socket.on('revealChoice', (payload = {}) => {
  const rooms = [...socket.rooms].filter(r => r !== socket.id);
  if (!rooms.length) return;

  const roomID   = socket.demoRoomID || rooms[0];
  const isMatch2 = Boolean(matches2Config[roomID]);
  const state = gameStateByTable[roomID];
  if (!state || !state.revealSeq) return;
  if (state.adminPaused) return;

  const idx = state.demo && socket.demoRoomID === roomID
    ? state.revealSeq.activeSeat : state.players.findIndex(p => p && p.id === socket.id);
  if (state.demo && (payload.demoRoomID !== roomID || payload.demoRound !== state.roundNumber || payload.demoSeat !== idx)) return;
  if (idx < 0) return;

  applyRevealChoice(roomID, isMatch2, idx, !!payload.hide);
});

// Bouton BREAK : met le joueur en WAIT (pause) ou le remet en "join next hand"
socket.on('toggleBreak', (payload = {}) => {
  const rooms = [...socket.rooms].filter(r => r !== socket.id);
  if (!rooms.length) return;

  const roomID   = rooms[0];
  const isMatch2 = Boolean(matches2Config[roomID]);
  const state = gameStateByTable[roomID];
  if (!state) return;
  if (state.adminPaused && !state.allBreakPaused) return;

  const idx = state.players.findIndex(p => p && p.id === socket.id);
  if (idx < 0) return;

  const p = state.players[idx];
  if (p.status === 'BUST') return;

  const nextBreak = (typeof payload.enabled === 'boolean') ? payload.enabled : !p.isBreak;
  if (nextBreak && p.status !== 'WAIT') {
    const activePlayers = state.players.filter(pl => pl && pl.status !== 'WAIT' && pl.status !== 'BUST');
    if (activePlayers.length <= 2) {
      socket.emit('breakDenied', {
        message: "Desole, vous ne pouvez plus vous mettre en BREAK lors d'un face a face."
      });
      return;
    }
  }
  p.isBreak = nextBreak;
  p.status = 'WAIT';

  // Si on était en pause "tout le monde en BREAK", le premier qui revient relance la partie
  if (state.allBreakPaused && !nextBreak) {
    // Retour immédiat en partie : on reprend la main en cours
    state.adminPaused = false;
    state.adminPause = null;
    state.disconnectPaused = false;
    state.turnRemainingMs = null;

    state.players.forEach((pl, i) => {
      if (!pl || pl.status === 'BUST') return;
      if (i === idx) {
        pl.isBreak = false;
        pl.status = '';
        pl.reconnectRestoreStatus = null;
        return;
      }
      if (isSocketConnected(pl.id)) {
        pl.isBreak = true;
        pl.status = 'WAIT';
      } else {
        pl.isBreak = false;
        pl.status = 'WAIT';
      }
    });

    // La main passe au joueur qui reprend
    state.current_bettor_index = idx;
    if (isMatch2) resetTurnTimer2(roomID);
    else resetTurnTimer(roomID);

    clearAllBreakPause(state);
    if (isMatch2) broadcastMatch2State(roomID);
    else broadcastTableState(roomID);
    return;
  }

  // Si tout le monde restant est en BREAK -> pause auto
  if (!state.adminPaused && shouldPauseForAllBreak(state)) {
    markAllBreakPause(state);
    // For the "all break" pause, only connected players are BREAK.
    state.players.forEach(p => {
      if (!p || p.inactive || p.status === 'BUST') return;
      if (isSocketConnected(p.id)) {
        p.isBreak = true;
        p.status = 'WAIT';
      } else {
        p.isBreak = false;
        if (p.status !== 'BUST') p.status = 'WAIT';
      }
    });
    pauseGame(roomID, isMatch2, { forceBreakAll: false });
    return;
  }

  const isActionPhase = ['preflop','flop','turn','river'].includes(state.phase);
  const wasCurrent = state.current_bettor_index === idx;
  if (isActionPhase && wasCurrent && nextBreak) {
    if (isMatch2) advanceTurn2(roomID);
    else advanceTurn(roomID);
    return;
  }
  if (isActionPhase && wasCurrent) {
    if (isMatch2) resetTurnTimer2(roomID);
    else resetTurnTimer(roomID);
  }

  if (isMatch2) broadcastMatch2State(roomID);
  else broadcastTableState(roomID);
});

  socket.on('disconnect', () => {
    if (socket.demoOnly) return;
    // ——————————————————————————————————————————
    // Déconnexion d’un socket
    // ——————————————————————————————————————————
    delete battleSessionsBySeat[`practice:${socket.id}`];
    sosChatByClient.delete(socket.id);
  
    // — Tables 10 joueurs —
    Object.keys(waitingPlayersByTable).forEach(tableID => {
      const buf = waitingPlayersByTable[tableID] || [];
      const hasGame = Boolean(gameStateByTable[tableID]);
      const cfg = tablesConfig[tableID];
      const totalSeats = (cfg && Array.isArray(cfg.players)) ? cfg.players.length : buf.length;
      const activeSeats = (cfg && Number.isInteger(cfg.activeSeats)) ? cfg.activeSeats : totalSeats;

      // 1) Libère le siège dans la waiting-room
      buf.forEach((s, idx) => {
        if (s && s.id === socket.id) {
          buf[idx] = null;
        }
      });

      // 2) Notifie le nombre de places prises
      const taken = buf.slice(0, activeSeats).filter(s => s !== null).length;
      const payload = {
        tableID,
        waitingCount: taken,
        totalSeats,
        activeSeats,
        level: (cfg && cfg.level) ? cfg.level : 'Q1',
        seatsTaken: buf.map(s => Boolean(s)),
        seatLabels: (cfg && Array.isArray(cfg.players)) ? cfg.players : [],
        quickPlay: Boolean(cfg && cfg.quickPlay)
      };
      if (!hasGame) {
        io.to(tableID).emit('updateWaitingRoom', payload);
        io.to('admin').emit('updateWaitingRoom', payload);
      }
  
    });
  
    // — Matchs 2 joueurs —
    Object.keys(waitingPlayersByMatch2).forEach(matchID => {
      const buf2 = waitingPlayersByMatch2[matchID] || [];
      const hasGame2 = Boolean(gameStateByTable[matchID]);
      const cfg2 = matches2Config[matchID];
      const totalSeats2 = (cfg2 && Array.isArray(cfg2.players)) ? cfg2.players.length : buf2.length;
  
      // 1) Libère le siège dans la waiting-room
      buf2.forEach((s, idx) => {
        if (s && s.id === socket.id) {
          buf2[idx] = null;
        }
      });
  
      // 2) Notifie le nombre de places prises
      const taken2 = buf2.filter(s => s !== null).length;
      const payload2 = {
        matchID,
        waitingCount: taken2,
        totalSeats: totalSeats2,
        level: (cfg2 && cfg2.level) ? cfg2.level : 'Q1',
        seatsTaken: buf2.map(s => Boolean(s)),
        seatLabels: (cfg2 && Array.isArray(cfg2.players)) ? cfg2.players : []
      };
      if (!hasGame2) {
        io.to(matchID).emit('updateWaitingRoom', payload2);
        io.to('admin').emit('updateWaitingRoom', payload2);
      }
  
    });
        // ─────────────────────────────────────────────
    // Libérer le seat dans les parties en cours
    // (pour autoriser la reconnexion du MÊME joueur)
    // ─────────────────────────────────────────────
    const touchedRooms = new Set();
    Object.keys(gameStateByTable).forEach(roomID => {
      const st = gameStateByTable[roomID];
      if (!st || !Array.isArray(st.players)) return;

      st.players.forEach((p, idx) => {
        if (p && p.id === socket.id) {
          // on libère juste l'id, on garde le seat + label + status
          p.id = null;
          p.reconnectRestoreStatus = p.status;
          if (!p.isBreak) {
            p.isBreak = false;
          }
          if (p._reconnectTimer) {
            clearTimeout(p._reconnectTimer);
          }
          const phase = st?.phase || '';
          const isActionPhase = ['preflop','flop','turn','river'].includes(phase);
          // Délai court pour éviter de basculer en WAIT sur un simple refresh
          if (p.status !== 'BUST' && !p.isBreak) {
            p._reconnectTimer = setTimeout(() => {
              if (p.id) return; // déjà reconnecté
              const phaseNow = st?.phase || '';
              const isActionPhaseNow = ['preflop','flop','turn','river'].includes(phaseNow);
              if (isActionPhaseNow) {
                p._reconnectTimer = null;
                return;
              }
              p.status = 'WAIT';
              p._reconnectTimer = null;
              st.turnRemainingMs = null;
              st.disconnectPaused = false;
              touchedRooms.add(roomID);
              if (matches2Config[roomID]) {
                broadcastMatch2State(roomID);
              } else {
                broadcastTableState(roomID);
              }
            }, 4000);
          } else {
            touchedRooms.add(roomID);
          }
        }
      });
    });

    // Si un joueur d'une partie en cours s'est déconnecté, on rafraîchit l'UI
    touchedRooms.forEach(roomID => {
      const st = gameStateByTable[roomID];
      if (!st) return;
      if (matches2Config[roomID]) {
        broadcastMatch2State(roomID);
      } else {
        broadcastTableState(roomID);
      }
    });
  });  
});

// ───────────────────────────────────────────────
// Helpers : envoi d'état aux spectateurs
// ───────────────────────────────────────────────

function sendSpectatorStateForTable(tableID) {
  const t = tables[tableID];
  if (!t || !t.gameState) return;

  io.to(`spectators-table-${tableID}`).emit('spectatorState', {
    type: 'table',
    tableID,
    gameState: t.gameState
  });
}

function sendSpectatorStateForMatch2(matchID) {
  const m = matches2[matchID];
  if (!m || !m.gameState) return;

  io.to(`spectators-match2-${matchID}`).emit('spectatorState', {
    type: 'match2',
    matchID,
    gameState: m.gameState
  });
}


// ──────────────────────────────────────────────────────────────
// 13) Lancement du serveur
// ──────────────────────────────────────────────────────────────


server.on('listening', () => console.log('[HTTP] listening on', server.address()));
server.on('error', (e) => console.error('[HTTP] server error:', e));
const PORT = process.env.PORT || 3000;
// Écoute explicitement en IPv4 pour éviter le piège "IPv6 only"
server.listen(PORT, '0.0.0.0', () =>
  console.log(`Serveur sur http://127.0.0.1:${PORT}`));





















