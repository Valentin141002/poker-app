// server.js
const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const http      = require('http');
const socketIo  = require('socket.io');
const crypto    = require('crypto');
const { Hand }  = require('pokersolver');
const levelsFile    = path.join(__dirname, 'playerLevels.json');
let playerLevels   = {};

// ──────────────────────────────────────────────────────────────
// 0) Initialise Express
// ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ──────────────────────────────────────────────────────────────
// 1) HTTP + Socket.IO setup
// ──────────────────────────────────────────────────────────────
const server = http.createServer(app);
const io     = socketIo(server);

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

// ──────────────────────────────────────────────────────────────
// 3) Persistence fichiers & helpers (séparés par type de partie)
// ──────────────────────────────────────────────────────────────
const tablesFile       = path.join(__dirname, 'tablesConfig.json');
const statsTableFile   = path.join(__dirname, 'playerStatsTable.json');
const statsMatch2File  = path.join(__dirname, 'playerStatsMatch2.json');
const gamesFile        = path.join(__dirname, 'gamesHistory.json');
const matches2File     = path.join(__dirname, 'matches2Config.json');

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
  fs.writeFileSync(levelsFile, JSON.stringify(playerLevels, null, 2), 'utf8');
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


// ──────────────────────────────────────────────────────────────
// 5) Endpoints Admin – Tables & Matchs 2 joueurs
// ──────────────────────────────────────────────────────────────

// (réinsérez aussi le POST createTable si vous l’aviez supprimé)
app.post('/admin/createTable', (req, res) => {
  const { players, mode } = req.body;
  if (!Array.isArray(players) || players.length !== 10) return res.status(400).json({ error: 'Il faut exactement 10 joueurs.' });
  if (!BLINDS[mode]) return res.status(400).json({ error: 'Mode de jeu invalide.' });
  const tableID = crypto.randomBytes(4).toString('hex');
  tablesConfig[tableID] = { players, mode };
  saveTables();
  res.json({ link: `${req.protocol}://${req.get('host')}?table=${tableID}` });
});

app.get('/admin/getTables', (_req, res) => {
  const list = Object.entries(tablesConfig).map(([tableID, cfg]) => {
    const lastGame = gamesHistory.filter(g => g.type === 'table' && g.tableID === tableID).pop();
    return { tableID, mode: cfg.mode, players: cfg.players, winner: lastGame ? lastGame.winner : null };
  });
  res.json(list);
});

// ──────────────────────────────────────────────────────────────
// 6) Endpoints Admin – Matchs 2 joueurs (avec dernier winner)
// ──────────────────────────────────────────────────────────────

app.post('/admin/createMatch2', (req, res) => {
  const { players, mode } = req.body;
  if (!Array.isArray(players) || players.length !== 2) return res.status(400).json({ error: 'Il faut exactement 2 joueurs.' });
  if (!BLINDS[mode]) return res.status(400).json({ error: 'Mode de jeu invalide.' });
  const matchID = crypto.randomBytes(4).toString('hex');
  matches2Config[matchID] = { players, mode };
  saveMatches2();
  res.json({ link: `${req.protocol}://${req.get('host')}?match2=${matchID}` });
});

app.get('/admin/getMatches2', (_req, res) => {
  const list = Object.entries(matches2Config).map(([matchID, cfg]) => {
    const lastGame = gamesHistory.filter(g => g.type === 'match2' && g.matchID === matchID).pop();
    return { matchID, mode: cfg.mode, players: cfg.players, winner: lastGame ? lastGame.winner : null };
  });
  res.json(list);
});


// ──────────────────────────────────────────────────────────────
// 7) Endpoints Admin – communs
// ──────────────────────────────────────────────────────────────
// juste remplacer l’ancien :
app.get('/admin/getProfiles', (req, res) => {
  const type = req.query.type; // 'table' ou 'match2'
  const stats = type === 'match2' ? statsMatch2 : statsTable;
  const list = Object.values(stats).map(p => ({
    name: p.name,
    gamesPlayed: p.gamesPlayed,
    wins: p.wins,
    byMode: p.byMode
  }));
  res.json(list);
});

app.get('/admin/getLevels', (_req, res) => {
  // 1) union de tous les noms de joueurs
  const names = new Set([
    ...Object.keys(playerLevels),
    ...Object.keys(statsTable),
    ...Object.keys(statsMatch2)
  ]);

  // 2) construction du tableau
  const list = Array.from(names).map(name => {
    // entrée de niveau si elle existe, sinon on part de zéro
    const lvlEntry = playerLevels[name] || { level: 0, history: [] };
    // parties/jours et victoires : on additionne les deux types de stats
    const played = (statsTable[name]?.gamesPlayed || 0)
                 + (statsMatch2[name]?.gamesPlayed || 0);
    const wins   = (statsTable[name]?.wins        || 0)
                 + (statsMatch2[name]?.wins        || 0);
    return {
      name,
      level:       lvlEntry.level,
      gamesPlayed: played,
      wins:        wins,
      history:     lvlEntry.history
    };
  });

  // 3) tri par niveau décroissant
  list.sort((a, b) => b.level - a.level);

  res.json(list);
});


app.get('/admin/getGames', (_req, res) => {
  res.json(gamesHistory);
});

app.delete('/admin/deleteTable/:tableID', (req, res) => {
  const id = req.params.tableID;
  if (!tablesConfig[id]) return res.status(404).json({ error: 'Table inconnue.' });
  delete tablesConfig[id]; saveTables();
  io.to('admin').emit('tablesUpdated');
  res.json({ ok: true });
});

app.delete('/admin/deleteMatch2/:matchID', (req, res) => {
  const id = req.params.matchID;
  if (!matches2Config[id]) return res.status(404).json({ error: 'Match introuvable.' });
  delete matches2Config[id]; saveMatches2();
  io.to('admin').emit('matches2Updated');
  res.json({ ok: true });
});

app.delete('/admin/deleteProfile/:name', (req, res) => {
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


// ──────────────────────────────────────────────────────────────
// 8) Static files & fallback
// ──────────────────────────────────────────────────────────────
app.use('/admin', express.static(path.join(__dirname, 'admin-app')));
app.use(express.static(path.join(__dirname, 'poker-app')));
app.get('*', (_req, res) =>
  res.sendFile(path.join(__dirname, 'poker-app', 'poker.html'))
);

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
}

function serverBet(tableID, idx, amount) {
  const G = gameStateByTable[tableID], p = G.players[idx];
  if (p.status === 'FOLD') return false;
  let cb = currentBetByTable[tableID] || 0;
  let cr = currentMinRaiseByTable[tableID] || 0;
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
  p.subtotal_bet += amount;
  p.bankroll    -= amount;
  G.pot         += amount;
  currentBetByTable[tableID]      = cb;
  currentMinRaiseByTable[tableID] = cr;
  G.current_bet = cb;
  return true;
}

function isRoundComplete(tableID) {
  const G = gameStateByTable[tableID];
  const active = G.players.filter(p => p.status !== 'FOLD' && p.status !== 'BUST');
  const cb = currentBetByTable[tableID] || 0;
  if (cb > 0) return active.every(p => p.subtotal_bet === cb);
  return G.checkCount >= active.length;
}

function configureBlinds(state, tableID) {
  // détermine d’abord le mode, selon qu'on soit sur table 10j ou match2
  let mode;
  if (tablesConfig[tableID]) {
    mode = tablesConfig[tableID].mode;
  } else if (matches2Config[tableID]) {
    mode = matches2Config[tableID].mode;
  } else {
    // pas de config trouvée → pas de blinds
    state.dealerIndex = state.current_bettor_index = -1;
    state.smallBlind = state.bigBlind = 0;
    return;
  }

  // calcule les places actives
  const activeSeats = state.players
    .map((p, i) => ({ p, i }))
    .filter(o => o.p.status !== 'BUST' && o.p.bankroll > 0)
    .map(o => o.i);

  if (activeSeats.length < 2) {
    state.dealerIndex = state.current_bettor_index = -1;
    state.smallBlind = state.bigBlind = 0;
    return;
  }

  // choix du dealer & blinds
  const dealer = activeSeats[Math.floor(Math.random() * activeSeats.length)];
  state.dealerIndex = dealer;
  const { SB, BB } = BLINDS[mode];
  state.smallBlind = SB;
  state.bigBlind   = BB;

  const next = (i, step = 1) =>
    activeSeats[(activeSeats.indexOf(i) + step) % activeSeats.length];
  const sbSeat = next(dealer, 1), bbSeat = next(dealer, 2);

  // applique les blinds
  [ {seat: sbSeat, amt: SB}, {seat: bbSeat, amt: BB} ].forEach(({seat, amt}) => {
    state.players[seat].subtotal_bet += amt;
    state.players[seat].bankroll    -= amt;
    state.pot                       += amt;
  });

  currentBetByTable[tableID]      = BB;
  currentMinRaiseByTable[tableID] = BB;
  state.current_bet         = BB;
  state.current_bettor_index= next(bbSeat, 1);
  state.checkCount          = 0;
}

// ──────────────────────────────────────────────────────────────
// 9) tryStartGame: lance la partie dès que 10 joueurs ont rejoint
// ──────────────────────────────────────────────────────────────
function tryStartGame(tableID) {
  const waiting = waitingPlayersByTable[tableID] || [];
  if (waiting.length !== 10) {
    io.to(tableID).emit('updateWaitingRoom', { waitingCount: waiting.length });
    io.to('admin').emit('updateWaitingRoom', { tableID, waitingCount: waiting.length });
    return;
  }

  const cfg = tablesConfig[tableID];

  // ──────────────────────────────────────────────────────────────
  // Initialisation de l'état de jeu
  // ──────────────────────────────────────────────────────────────
  const state = gameStateByTable[tableID] = {
    players: waiting.map((sock, i) => ({
      id: sock.playerData.id,
      label: cfg.players[i],
      bankroll: 20000,
      carda: '',
      cardb: '',
      status: '',
      subtotal_bet: 0,
      seat: i
    })),
    pot: 0,
    board: [],
    current_bet: 0,
    current_bettor_index: 0,
    phase: 'preflop',
    checkCount: 0,
    roundEvaluated: false
  };

  // Réinitialisation des montants courants
  currentBetByTable[tableID]      = 0;
  currentMinRaiseByTable[tableID] = 0;

  // Distribution & blinds
  distributeCards(state);
  configureBlinds(state, tableID);

  // Lancement et premier update
  io.to(tableID).emit('startGame', { tableID, mode: cfg.mode, gameState: state });
  io.to(tableID).emit('updateTable', state);
  io.to('admin').emit('updateTable', { tableID, gameState: state });

  // Vider la file pour ne pas relancer
  waitingPlayersByTable[tableID] = [];

  // ──────────────────────────────────────────────────────────────
  // Mode hyper (all-in automatique + phases)
  // ──────────────────────────────────────────────────────────────
  if (cfg.mode === 'hyper') {
    const N = state.players.length; // = 10

    // 1) Auto all-in séquentiel
    state.players.forEach((p, i) => {
      setTimeout(() => {
        p.status = 'ALLIN';
        p.subtotal_bet = p.bankroll;
        state.pot += p.bankroll;
        p.bankroll = 0;
        currentBetByTable[tableID] = state.current_bet = Math.max(
          currentBetByTable[tableID] || 0,
          p.subtotal_bet
        );
        io.to(tableID).emit('updateTable', state);
        io.to('admin').emit('updateTable', { tableID, gameState: state });
      }, i * 1000);
    });

    // 2) Flop
    setTimeout(() => {
      state.phase = 'flop';
      io.to(tableID).emit('updateTable', state);
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, N * 1000);

    // 3) Turn
    setTimeout(() => {
      state.phase = 'turn';
      io.to(tableID).emit('updateTable', state);
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, N * 1000 + 5000);

    // 4) River
    setTimeout(() => {
      state.phase = 'river';
      io.to(tableID).emit('updateTable', state);
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, N * 1000 + 10000);

    // 5) Showdown
    setTimeout(() => {
      state.phase = 'reveal';
      if (!state.roundEvaluated) {
        evaluateRound(tableID);
        state.roundEvaluated = true;
      }
      io.to(tableID).emit('updateTable', state);
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, N * 1000 + 20000);
  }
}

// ──────────────────────────────────────────────────────────────
// 9.5) tryStartMatch2: même logique, mais pour 2 joueurs
// ──────────────────────────────────────────────────────────────
/**
 * Lancement d’un match 2-joueurs dès que 2 joueurs ont rejoint,
 * avec auto-all-in & phases “hyper” comme pour les tables à 10.
 */
function tryStartMatch2(matchID) {
  const waiting = waitingPlayersByMatch2[matchID] || [];
  if (waiting.length !== 2) { /* … */ return; }

  const cfg = matches2Config[matchID];
  const state = gameStateByTable[matchID] = {
    players: waiting.map((sock, i) => ({
      id: sock.playerData.id,
      label: cfg.players[i],
      bankroll: 20000,
      carda: '', cardb: '',
      status: '', subtotal_bet: 0,
      seat: i
    })),
    pot: 0,
    board: [],
    current_bet: 0,
    current_bettor_index: 0,
    phase: 'preflop',
    checkCount: 0,
    roundEvaluated: false
  };

  // 3) Réinit des paris
  currentBetByTable[matchID]      = 0;
  currentMinRaiseByTable[matchID] = 0;

  // 4) Distribution & blinds
  distributeCards(state);
  configureBlinds(state, matchID);

  // 5) Démarrage + **premiers** updates pour jeu & admin
  io.to(matchID).emit('startGame',    { tableID: matchID, mode: cfg.mode, gameState: state });
  io.to(matchID).emit('updateTable',  state);
  io.to(matchID).emit('updateMatch2', { matchID,    gameState: state });
  io.to('admin').emit('updateMatch2', { matchID,    gameState: state });

  // 6) Vide la file d’attente pour ne pas relancer
  waitingPlayersByMatch2[matchID] = [];

  // 7) Hyper-fast → auto-all-in + phases
  if (cfg.mode === 'hyper') {
    const N = state.players.length; // = 2

    // a) Auto-all-in séquentiel
    state.players.forEach((p, i) => {
      setTimeout(() => {
        p.status       = 'ALLIN';
        p.subtotal_bet = p.bankroll;
        state.pot     += p.bankroll;
        p.bankroll     = 0;
        currentBetByTable[matchID] = state.current_bet =
          Math.max(currentBetByTable[matchID]||0, p.subtotal_bet);

        // **DEUX UI** mis à jour
        io.to(matchID).emit('updateTable',  state);
        io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
        io.to('admin').emit('updateMatch2', { matchID, gameState: state });
      }, i * 1000);
    });

    // b) Flop
    setTimeout(() => {
      state.phase = 'flop';
      io.to(matchID).emit('updateTable',  state);
      io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID, gameState: state });
    }, N * 1000);

    // c) Turn (+5s)
    setTimeout(() => {
      state.phase = 'turn';
      io.to(matchID).emit('updateTable',  state);
      io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID, gameState: state });
    }, N * 1000 + 5000);

    // d) River (+5s)
    setTimeout(() => {
      state.phase = 'river';
      io.to(matchID).emit('updateTable',  state);
      io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID, gameState: state });
    }, N * 1000 + 10000);

    // e) Showdown (+10s)
    setTimeout(() => {
      state.phase = 'reveal';
      if (!state.roundEvaluated) {
        evaluateRound2(matchID);
        state.roundEvaluated = true;
      }

      // **DEUX UI** update final
      io.to(matchID).emit('updateTable',  state);
      io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID, gameState: state });

      // Notifie le(s) gagnant(s)
      const winners     = state.players.filter(p => p.status === 'WINNER').map(p => p.label);
      const winnerLabel = winners.join(', ');
      io.to(matchID).emit('match2Finished', { matchID, winner: winnerLabel });
      io.to('admin').emit('match2Finished', { matchID, winner: winnerLabel });
    }, N * 1000 + 20000);
  }
}

// ──────────────────────────────────────────────────────────────
// 10) evaluateRound: showdown, pot, stats, notification
// ──────────────────────────────────────────────────────────────
function evaluateRound(tableID) {
  const state = gameStateByTable[tableID];

  // 1) Conversion interne des cartes en format "Ah", "7c", etc.
  const conv = c => {
    const s = c[0];
    const r = parseInt(c.slice(1), 10);
    const m = {14:'A',13:'K',12:'Q',11:'J',10:'T'};
    return (m[r] || r) + s;
  };

  // 2) Résolution des mains des joueurs encore en lice
  const solved = state.players.map(p =>
    ['FOLD','BUST'].includes(p.status)
      ? null
      : Hand.solve([p.carda, p.cardb, ...state.board].map(conv))
  );
  const winners = Hand.winners(solved.filter(Boolean));
  const widx = solved
    .map((h, i) => h && winners.includes(h) ? i : -1)
    .filter(i => i >= 0);

  // 3) Marquer les gagnants
  widx.forEach(i => {
    state.players[i].status   = 'WINNER';
    state.players[i].handName = solved[i].name;
  });

  // 4) Partage du pot
  const share = Math.floor(state.pot / (widx.length || 1));
  widx.forEach(i => state.players[i].bankroll += share);

  // 5) Éliminer les autres
  state.players.forEach((p, i) => {
    if (!widx.includes(i)) p.status = 'BUST';
  });

  // 6) Historique & stats
  const isTable10   = tableID in tablesConfig;
  const mode        = isTable10
    ? tablesConfig[tableID].mode
    : matches2Config[tableID].mode;
  const winnerLabel = state.players[widx[0]].label;

  // Enregistre la partie terminée
  if (isTable10) {
    gamesHistory.push({
      type:      'table',
      tableID,
      mode,
      winner:    winnerLabel,
      timestamp: new Date().toISOString()
    });
  } else {
    gamesHistory.push({
      type:      'match2',
      matchID:   tableID,
      mode,
      winner:    winnerLabel,
      timestamp: new Date().toISOString()
    });
  }
  saveGames();

  // Met à jour le nombre de parties jouées et jouées par mode
  state.players.forEach(p => {
    const lbl = p.label;
    if (isTable10) {
      if (!statsTable[lbl]) {
        statsTable[lbl] = {
          name:        lbl,
          gamesPlayed: 0,
          wins:        0,
          byMode:      Object.fromEntries(
                         Object.keys(BLINDS).map(m => [m, { played: 0, wins: 0 }])
                       )
        };
      }
      statsTable[lbl].gamesPlayed++;
      statsTable[lbl].byMode[mode].played++;
    } else {
      if (!statsMatch2[lbl]) {
        statsMatch2[lbl] = {
          name:        lbl,
          gamesPlayed: 0,
          wins:        0,
          byMode:      Object.fromEntries(
                         Object.keys(BLINDS).map(m => [m, { played: 0, wins: 0 }])
                       )
        };
      }
      statsMatch2[lbl].gamesPlayed++;
      statsMatch2[lbl].byMode[mode].played++;
    }
  });

  // Met à jour les victoires et sauvegarde
  if (isTable10) {
    statsTable[winnerLabel].wins++;
    statsTable[winnerLabel].byMode[mode].wins++;
    saveStatsTable();
  } else {
    statsMatch2[winnerLabel].wins++;
    statsMatch2[winnerLabel].byMode[mode].wins++;
    saveStatsMatch2();
  }

  // ───────────────────────────────────────────────────────
  // MISE À JOUR DU SYSTÈME DE NIVEAUX
  // ───────────────────────────────────────────────────────
  state.players.forEach((p, i) => {
    const lbl = p.label;
    const won = widx.includes(i);

    // Initialisation si nécessaire
    if (!playerLevels[lbl]) {
      playerLevels[lbl] = {
        name:        lbl,
        level:       0,
        gamesPlayed: 0,
        wins:        0,
        history:     []
      };
    }

    // Compteurs généraux
    playerLevels[lbl].gamesPlayed++;
    if (won) {
      playerLevels[lbl].wins++;
    }

    // Si perdant à la table ⇒ réinitialisation au niveau 0
    if (!won && playerLevels[lbl].level !== 0) {
      playerLevels[lbl].level = 0;
      playerLevels[lbl].history.push({
        date:   new Date().toISOString(),
        action: 'Perdu à la table → niveau réinitialisé à 0'
      });
    }
  });

  saveLevels();

  // 7) Émission des updates
  if (isTable10) {
    io.to(tableID).emit('updateTable', state);
    io.to('admin').emit('updateTable',   { tableID, gameState: state });
    io.to('admin').emit('tableFinished', { tableID, winner: winnerLabel });
    io.to(state.players[widx[0]].id)
      .emit('tableFinished', { tableID, winner: winnerLabel });
  } else {
    io.to(tableID).emit('updateMatch2', { matchID: tableID, gameState: state });
    io.to('admin').emit('updateMatch2', { matchID: tableID, gameState: state });
    io.to('admin').emit('match2Finished', { matchID: tableID, winner: winnerLabel });
    io.to(state.players[widx[0]].id)
      .emit('match2Finished', { matchID: tableID, winner: winnerLabel });
  }
}

/**
 * Showdown pour un match 2-joueurs :
 * - Résout les mains
 * - Distribue le pot
 * - Met à jour stats & historique
 * - Émet updateMatch2 pour rafraîchir l’UI
 * - Émet match2Finished pour afficher le gagnant
 */
function evaluateRound2(matchID) {
  const state = gameStateByTable[matchID];
  if (!state) return;

  // 1) Conversion interne des cartes en format "Ah", "7c", etc.
  const conv = c => {
    const s = c[0];
    const r = parseInt(c.slice(1), 10);
    const m = {14:'A',13:'K',12:'Q',11:'J',10:'T'};
    return (m[r] || r) + s;
  };

  // 2) Résolution des mains pour ceux qui ne sont pas fold/bust
  const solved = state.players.map(p =>
    ['FOLD','BUST'].includes(p.status)
      ? null
      : Hand.solve([p.carda, p.cardb, ...state.board].map(conv))
  );
  const winners = Hand.winners(solved.filter(Boolean));
  const widx = solved
    .map((h, i) => h && winners.includes(h) ? i : -1)
    .filter(i => i >= 0);

  // 3) Marquer les gagnants
  widx.forEach(i => {
    state.players[i].status   = 'WINNER';
    state.players[i].handName = solved[i].name;
  });

  // 4) Partage du pot
  const share = Math.floor(state.pot / (widx.length || 1));
  widx.forEach(i => state.players[i].bankroll += share);

  // 5) Marque les autres comme éliminés
  state.players.forEach((p, i) => {
    if (!widx.includes(i)) p.status = 'BUST';
  });

  // 6) Historique & stats
  const mode        = matches2Config[matchID].mode;
  const winnerLabel = state.players[widx[0]].label;
  const loserIdx    = state.players.findIndex((_, i) => !widx.includes(i));
  const loserLabel  = state.players[loserIdx].label;

  // Enregistre la partie terminée
  gamesHistory.push({
    type:      'match2',
    matchID,
    mode,
    winner:    winnerLabel,
    timestamp: new Date().toISOString()
  });
  saveGames();

  // Met à jour parties jouées et parties par mode
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

  // Met à jour les victoires du gagnant
  statsMatch2[winnerLabel].wins++;
  statsMatch2[winnerLabel].byMode[mode].wins++;
  saveStatsMatch2();

  // ───────────────────────────────────────────────────────────
  // MISE À JOUR DU SYSTÈME DE NIVEAUX (1v1)
  // ───────────────────────────────────────────────────────────
  // Initialisation & compteurs généraux
  [winnerLabel, loserLabel].forEach(lbl => {
    if (!playerLevels[lbl]) {
      playerLevels[lbl] = {
        name:        lbl,
        level:       0,
        gamesPlayed: 0,
        wins:        0,
        history:     []
      };
    }
    playerLevels[lbl].gamesPlayed++;
    if (lbl === winnerLabel) {
      playerLevels[lbl].wins++;
    }
  });

  // Promotion du gagnant
  const oldLevelW = playerLevels[winnerLabel].level;
  const newLevelW = oldLevelW + 1;
  playerLevels[winnerLabel].level = newLevelW;
  playerLevels[winnerLabel].history.push({
    date:   new Date().toISOString(),
    action: `Vainqueur du duel → niveau monté de ${oldLevelW} à ${newLevelW}`
  });

  // Rétrogradation du perdant
  const oldLevelL = playerLevels[loserLabel].level;
  const newLevelL = Math.max(0, oldLevelL - 1);
  playerLevels[loserLabel].level = newLevelL;
  playerLevels[loserLabel].history.push({
    date:   new Date().toISOString(),
    action: `Perdant du duel → niveau descendu de ${oldLevelL} à ${newLevelL}`
  });

  saveLevels();

  // 7) Émission des updates
  io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
  io.to('admin').emit('updateMatch2',   { matchID, gameState: state });
  io.to('admin').emit('match2Finished', { matchID, winner: winnerLabel });
  io.to(state.players[widx[0]].id)
    .emit('match2Finished', { matchID, winner: winnerLabel });
}

// ──────────────────────────────────────────────────────────────
// 11) dealNextHand: reset pour nouvelle donne
// ──────────────────────────────────────────────────────────────
function dealNextHand(tableID) {
  const state = gameStateByTable[tableID];
  state.pot = 0;
  currentBetByTable[tableID]      = 0;
  currentMinRaiseByTable[tableID] = 0;
  state.current_bet    = 0;
  state.checkCount     = 0;
  state.roundEvaluated = false;
  state.players.forEach(p => {
    p.subtotal_bet = 0;
    if (p.status !== 'BUST') p.status = '';
  });
  distributeCards(state);
  configureBlinds(state, tableID);
  io.to(tableID).emit('updateTable', state);
  io.to('admin').emit('updateTable',{tableID,gameState:state});
}

// ──────────────────────────────────────────────────────────────
// 12) Socket.IO handlers
// ──────────────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.on('joinAdmin', () => socket.join('admin'));

  socket.on('joinGame', payload => {
    // on prend soit payload.table, soit payload.match2
    const roomID = payload.table ?? payload.match2;
    if (!roomID) {
      return socket.emit('joinError', 'Aucun tableID ni match2ID fourni.');
    }
  
    // 1) Partie 10 joueurs ?
    if (tablesConfig[roomID]) {
      waitingPlayersByTable[roomID] = waitingPlayersByTable[roomID] || [];
      const seat  = waitingPlayersByTable[roomID].length;
      const label = tablesConfig[roomID].players[seat];
      waitingPlayersByTable[roomID].push(socket);
      socket.playerData = { id: socket.id, label };
      socket.join(roomID);
      return tryStartGame(roomID);
    }
  
    // 2) Match 2 joueurs ?
    if (matches2Config[roomID]) {
      waitingPlayersByMatch2[roomID] = waitingPlayersByMatch2[roomID] || [];
      const seat  = waitingPlayersByMatch2[roomID].length;
      const label = matches2Config[roomID].players[seat];
      waitingPlayersByMatch2[roomID].push(socket);
      socket.playerData = { id: socket.id, label };
      socket.join(roomID);
      return tryStartMatch2(roomID);
    }
  
    // ni l’un ni l’autre
    socket.emit('joinError', 'Table ou match introuvable.');
  });  

  socket.on('playerAction', action => {
    const rooms = [...socket.rooms].filter(r=>r!==socket.id);
    if (!rooms.length) return;
    const table = rooms[0];
    const state = gameStateByTable[table];
    if (!state) return;
    const idx = state.players.findIndex(p=>p.id===socket.id);
    if (idx<0) return;
    const me = state.players[idx];

    if (action.type==='call') {
      action.amount = (currentBetByTable[table]||0) - (me.subtotal_bet||0);
    }
    let ok=false;
    if (action.type==='fold')      { me.status='FOLD'; ok=true; }
    else if (action.type==='check' && me.subtotal_bet===currentBetByTable[table]) {
      me.status='CHECK'; state.checkCount++; ok=true;
    }
    else if (['call','raise'].includes(action.type)) {
      ok = serverBet(table, idx, action.amount);
    }
    if (!ok) return;

    const active = state.players.filter(p=>p.status!=='FOLD');
    if (active.length>0 && active.every(p=>p.bankroll===0)) {
      state.phase='reveal';
      if (!state.roundEvaluated) { evaluateRound(table); state.roundEvaluated=true; }
      return setTimeout(()=> dealNextHand(table),5000);
    }

    const N=state.players.length;
    do {
      state.current_bettor_index = (state.current_bettor_index+1)%N;
    } while (['FOLD','BUST'].includes(state.players[state.current_bettor_index].status));

    if (isRoundComplete(table)) {
      const PH=['preflop','flop','turn','river','reveal'];
      const i=PH.indexOf(state.phase);
      if (i>=0 && i<PH.length-1) {
        state.phase = PH[i+1];
        state.players.forEach(p=>{
          p.subtotal_bet=0;
          if (p.status!=='FOLD') p.status='';
        });
        currentBetByTable[table]      = 0;
        currentMinRaiseByTable[table] = 0;
        state.current_bet=0;
        state.checkCount=0;
      }
      if (state.phase==='reveal' && !state.roundEvaluated) {
        evaluateRound(table);
        state.roundEvaluated=true;
        return setTimeout(()=> dealNextHand(table),5000);
      }
    }

    io.to(table).emit('updateTable', state);
    io.to('admin').emit('updateTable',{tableID:table,gameState:state});
  });

  socket.on('disconnect', () => {
    Object.keys(waitingPlayersByTable).forEach(table => {
      waitingPlayersByTable[table] = waitingPlayersByTable[table].filter(s=>s.id!==socket.id);
      const state = gameStateByTable[table];
      if (state) {
        state.players = state.players.filter(p=>p.id!==socket.id);
        io.to(table).emit('updateTable',state);
        io.to('admin').emit('updateTable',{tableID:table,gameState:state});
      }
      tryStartGame(table);
    });
  });
});

// ──────────────────────────────────────────────────────────────
// 13) Lancement du serveur
// ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur sur port ${PORT}`));
