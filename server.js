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
// timers par table/match
const turnTimersByTable   = {};
const turnTimersByMatch2  = {};
// pour stocker les timers de chaque table / de chaque match2


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
  + res.json({ link: `${req.protocol}://${req.get('host')}?table=${tableID}` });});

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
  res.json({ link: `${req.protocol}://${req.get('host')}?match2=${matchID}` });});

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
  G.current_bet  = cb;

  // 3) on stocke dans le bon store
  if (isMatch2) {
    currentBetByMatch2[roomID]      = cb;
    currentMinRaiseByMatch2[roomID] = cr;
  } else {
    currentBetByTable[roomID]       = cb;
    currentMinRaiseByTable[roomID]  = cr;
  }

  // 4) on notifie les clients et relance le timer adapté
  if (isMatch2) {
    io.to(roomID).emit('updateMatch2',   { matchID: roomID, gameState: G });
    io.to('admin').emit('updateMatch2',   { matchID: roomID, gameState: G });
    resetTurnTimer2(roomID);
  } else {
    io.to(roomID).emit('updateTable',     G);
    io.to('admin').emit('updateTable',    { tableID: roomID, gameState: G });
    resetTurnTimer(roomID);
  }

  return true;
}

function isRoundComplete(tableID) {
  const G = gameStateByTable[tableID];
  const active = G.players.filter(p => p.status !== 'FOLD' && p.status !== 'BUST');
  const cb = currentBetByTable[tableID] || 0;
  if (cb > 0) return active.every(p => p.subtotal_bet === cb);
  return G.checkCount >= active.length;
}

// ──────────────────────────────────────────────────────────────
// configureBlinds: double les blinds tous les 10 rounds pour 3 modes
// ──────────────────────────────────────────────────────────────
function configureBlinds(state, tableID) {
  let mode;
  if (tablesConfig[tableID])      mode = tablesConfig[tableID].mode;
  else if (matches2Config[tableID]) mode = matches2Config[tableID].mode;
  else {
    state.dealerIndex = state.current_bettor_index = -1;
    state.smallBlind = state.bigBlind = 0;
    return;
  }

  // factor = 2^floor((roundNumber-1)/10) pour les 3 modes ciblés
  let { SB, BB } = BLINDS[mode];
  if (['beginner','normal','turbo'].includes(mode)) {
    const factor = 2 ** Math.floor((state.roundNumber - 1) / 10);
    SB *= factor;
    BB *= factor;
  }

  // places actives
  const activeSeats = state.players
    .map((p,i) => ({p,i}))
    .filter(o => o.p.status!=='BUST' && o.p.bankroll>0)
    .map(o => o.i);
  if (activeSeats.length < 2) {
    state.dealerIndex = state.current_bettor_index = -1;
    state.smallBlind = state.bigBlind = 0;
    return;
  }

  // choix aléatoire du dealer
  const dealer = activeSeats[Math.floor(Math.random() * activeSeats.length)];
  state.dealerIndex = dealer;
  state.smallBlind  = SB;
  state.bigBlind    = BB;

  // on trouve SB et BB seats
  const next = (i, step=1) =>
    activeSeats[(activeSeats.indexOf(i) + step) % activeSeats.length];
  const sbSeat = next(dealer,1), bbSeat = next(dealer,2);

  // application des blinds
  [ {seat:sbSeat,amt:SB}, {seat:bbSeat,amt:BB} ].forEach(({seat,amt})=>{
    state.players[seat].subtotal_bet += amt;
    state.players[seat].bankroll    -= amt;
    state.pot                       += amt;
  });

  // mise à jour des compteurs
  currentBetByTable[tableID]      = BB;
  currentMinRaiseByTable[tableID] = BB;
  state.current_bet         = BB;
  state.current_bettor_index= next(bbSeat,1);
  state.checkCount          = 0;
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
    ['FOLD','BUST'].includes(p.status)
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
      p.status       = 'ALLIN';
      p.subtotal_bet = p.bankroll;
      state.pot     += p.bankroll;
      p.bankroll     = 0;
    });

    // On ne garde que ces joueurs pour le tie-breaker
    state.players = tied;

    // Reset du meilleur pari
    currentBetByTable[tableID] = state.current_bet =
      Math.max(0, ...tied.map(p => p.subtotal_bet));

    // On repart en préflop
    state.phase           = 'preflop';
    state.roundEvaluated  = false;

    // Notifie clients
    io.to(tableID).emit('updateTable', state);
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
    ['FOLD','BUST'].includes(p.status)
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
      p.status       = 'ALLIN';
      p.subtotal_bet = p.bankroll;
      state.pot     += p.bankroll;
      p.bankroll     = 0;
    });

    // on remplace la liste des joueurs par ces ex-æquo
    state.players = tied;
    // juste après `state.players = tied;`
state.current_bettor_index = 0;   // ou l’indice que tu veux démarrer


    // reset du meilleur pari
    currentBetByTable[matchID] = state.current_bet =
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
function tryStartGame(tableID) {
  const cfg = tablesConfig[tableID];
  if (!cfg) return;

  const N = cfg.players.length; // normalement 10

  // 1) Récupère la file fixe (tableau de longueur N, avec des null pour les sièges libres)
  const wait = waitingPlayersByTable[tableID] || [];

  // 2) Compte combien de sockets non-nulls
  const filledCount = wait.filter(sock => sock !== null).length;

  // 3) Tant que tous les sièges ne sont pas occupés → on met à jour le waiting room
  if (filledCount < N) {
    io.to(tableID).emit('updateWaitingRoom', { waitingCount: filledCount });
    io.to('admin').emit('updateWaitingRoom', { tableID, waitingCount: filledCount });
    return;
  }

  // ──────────────────────────────────────────────────────────────
  // Initialisation de l'état de jeu (tous les sièges sont désormais remplis)
  // ──────────────────────────────────────────────────────────────
  const state = gameStateByTable[tableID] = {
    roundNumber: 1,
    players: wait.map((sock, i) => ({
      id:           sock.playerData.id,
      label:        cfg.players[i],
      bankroll:     20000,
      carda:        '',
      cardb:        '',
      status:       '',
      subtotal_bet: 0,
      missedCount:  0,
      seat:         i,
    })),
    pot:                  0,
    board:                [],
    current_bet:          0,
    current_bettor_index: 0,
    phase:                'preflop',
    checkCount:           0,
    roundEvaluated:       false
  };

  // Réinitialisation des montants courants
  currentBetByTable[tableID]      = 0;
  currentMinRaiseByTable[tableID] = 0;

  // Distribution & blinds
  distributeCards(state);
  configureBlinds(state, tableID);

  // Lancement et premier update
 // 1) On fixe tout de suite le timer côté serveur
  resetTurnTimer(tableID); 
  // 2) On émet startGame et updateTable, désormais avec turnStartTime & turnDuration valides
  io.to(tableID).emit('startGame',    { tableID, mode: cfg.mode, gameState: state });
  io.to(tableID).emit('updateTable',   state);
  io.to('admin').emit('updateTable',   { tableID, gameState: state });

  // Vider la file pour ne pas relancer
  waitingPlayersByTable[tableID] = [];

  // ──────────────────────────────────────────────────────────────
  // Mode hyper (all-in automatique + phases)
  // ──────────────────────────────────────────────────────────────
  if (cfg.mode === 'hyper') {
    const Np = state.players.length;

    // 1) Auto all-in séquentiel
    state.players.forEach((p, i) => {
      setTimeout(() => {
        p.status       = 'ALLIN';
        p.subtotal_bet = p.bankroll;
        state.pot     += p.bankroll;
        p.bankroll     = 0;
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
    }, Np * 1000);

    // 3) Turn
    setTimeout(() => {
      state.phase = 'turn';
      io.to(tableID).emit('updateTable', state);
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, Np * 1000 + 5000);

    // 4) River
    setTimeout(() => {
      state.phase = 'river';
      io.to(tableID).emit('updateTable', state);
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, Np * 1000 + 10000);

    // 5) Showdown
    setTimeout(() => {
      state.phase = 'reveal';
      if (!state.roundEvaluated) {
        if (!handleHyperTie(tableID)) {
          evaluateRound(tableID);
          state.roundEvaluated = true;
        }
      }
      io.to(tableID).emit('updateTable', state);
      io.to('admin').emit('updateTable', { tableID, gameState: state });
    }, Np * 1000 + 20000);
  }
}

// ──────────────────────────────────────────────────────────────
// 9.5) tryStartMatch2: même logique, mais pour 2 joueurs
// ──────────────────────────────────────────────────────────────

function tryStartMatch2(matchID) {
  // 1) Récupère le buffer fixe de longueur 2 (initialisé dans joinGame)
  const waiting = waitingPlayersByMatch2[matchID] || [];
  const N       = matches2Config[matchID]?.players.length || 2;

  // 2) Compte combien de places sont déjà prises
  const takenCount = waiting.filter(s => s !== null).length;

  // 3) Tant que tous les sièges ne sont pas occupés → on envoie juste la waiting-room
  if (waiting.length !== N || takenCount < N) {
    io.to(matchID).emit('updateWaitingRoom',   { matchID, waitingCount: takenCount });
    io.to('admin').emit('updateWaitingRoom', { matchID, waitingCount: takenCount });
    return;
  }

  // 4) Tous les sièges sont pris → on construit l’état initial du match
  const cfg   = matches2Config[matchID];
  const state = gameStateByTable[matchID] = {
    roundNumber: 1,
    players: waiting.map((sock, i) => ({
      id:           sock.playerData.id,
      label:        cfg.players[i],
      bankroll:     20000,
      carda:        '',
      cardb:        '',
      status:       '',
      subtotal_bet: 0,
      missedCount:  0,
      seat:         i
    })),
    pot:                  0,
    board:                [],
    current_bet:          0,
    current_bettor_index: 0,
    phase:                'preflop',
    checkCount:           0,
    roundEvaluated:       false
  };

  // 5) Réinitialisation des bets
  currentBetByMatch2[matchID]      = 0;
  currentMinRaiseByMatch2[matchID] = 0;

  // 6) Distribution et blinds
  distributeCards(state);
  configureBlinds(state, matchID);

  // 7) Lancement de la partie
  resetTurnTimer2(matchID);
  io.to(matchID).emit('startGame',    { matchID, mode: cfg.mode, gameState: state });
  io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
  io.to('admin').emit('updateMatch2', { matchID, gameState: state });

  // 9) Réinitialise le buffer pour ne pas relancer
  waitingPlayersByMatch2[matchID] = Array(N).fill(null);

  // 10) Mode hyper-fast (identique à ton code existant)
  if (cfg.mode === 'hyper') {
    const N2 = state.players.length;

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
        io.to(matchID).emit('updateTable', state);
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
        // tie-break
        if (!handleHyperTie2(matchID)) {
          evaluateRound2(matchID);
          state.roundEvaluated = true;
        }
      }
      // mise à jour finale
      io.to(matchID).emit('updateTable', state);
      io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
      io.to('admin').emit('updateMatch2', { matchID, gameState: state });
    }, N*1000 + 20000);
  }
}


// ──────────────────────────────────────────────────────────────
// 10) evaluateRound: showdown, pot, stats, notification
// ──────────────────────────────────────────────────────────────
function evaluateRound(tableID) {
  const state = gameStateByTable[tableID];
  if (!state) return;

  // ── 1a) Marquer qui est allé jusqu'au showdown (ni FOLD ni BUST) ──
  state.players.forEach(p => {
    p.inShowdown = !['FOLD', 'BUST'].includes(p.status);
  });

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
  const solved = state.players.map(p =>
    ['FOLD','BUST'].includes(p.status)
      ? null
      : Hand.solve([p.carda, p.cardb, ...state.board].map(conv))
  );
  const winners = Hand.winners(solved.filter(Boolean));
  const widx = solved
    .map((h, i) => h && winners.includes(h) ? i : -1)
    .filter(i => i >= 0);

  // ── 3) Gestion des égalités (split pot) ──
  if (widx.length > 1) {
    const share = Math.floor(state.pot / widx.length);
    widx.forEach(i => {
      const p = state.players[i];
      p.bankroll += share;
      p.status    = 'WINNER';
      p.handName  = solved[i].name;
    });
    state.players.forEach((p, i) => {
      if (!widx.includes(i)) {
        p.status = p.bankroll > 0 ? '' : 'BUST';
      }
    });
    state.phase = 'reveal';
    io.to(tableID).emit('updateTable', state);
    io.to('admin').emit('updateTable', { tableID, gameState: state });
    return setTimeout(() => dealNextHand(tableID), 8000);
  }

  // ── 4) Cas d’un seul gagnant ──
  widx.forEach(i => {
    const p = state.players[i];
    p.status   = 'WINNER';
    p.handName = solved[i].name;
  });

  // ── 5) Partage du pot ──
  const share = Math.floor(state.pot / (widx.length || 1));
  widx.forEach(i => state.players[i].bankroll += share);

  // ── 6) Éliminer les autres ou reset pour la main suivante ──
  state.players.forEach((p, i) => {
    if (!widx.includes(i)) {
      p.status = p.bankroll > 0 ? '' : 'BUST';
    }
  });

  // ─────────────────────────────────────────────────────────────────
  // 7) Historique & stats
  // ─────────────────────────────────────────────────────────────────
  // Si, par un cas rare, aucun gagnant n'a été déterminé → on skippe
  if (widx.length === 0) {
    console.warn(`evaluateRound(${tableID}) widx is empty, skipping stats.`);
    state.phase = 'reveal';
    io.to(tableID).emit('updateTable', state);
    io.to('admin').emit('updateTable', { tableID, gameState: state });
    // relance la main suivante après 8s
    return setTimeout(() => dealNextHand(tableID), 8000);
   }
 
  const isTable10   = tableID in tablesConfig;
  const mode        = isTable10
    ? tablesConfig[tableID].mode
    : matches2Config[tableID].mode;
  const winnerLabel = state.players[widx[0]].label;

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

  // ─────────────────────────────────────────────────────────────────
  // 8) Progression de niveau → **uniquement si plus qu'un survivant**
  // ─────────────────────────────────────────────────────────────────
  const survivors   = state.players.filter(p => p.status !== 'BUST');
  if (survivors.length === 1) {
    // finalWinner = seul survivant non-bust
    const finalWinner = survivors[0];
    // eliminated = tous les bustés
    const eliminated  = state.players.filter(p => p.status === 'BUST');

    // Assure la mémoire
    [finalWinner, ...eliminated].forEach(p => {
      if (!playerLevels[p.label]) {
        playerLevels[p.label] = { name:p.label, level:0, wins:0, history:[] };
      }
    });

    if (isTable10) {
      // ▶ Gagner la table → accès duel (pas de lvl change)
      const ent = playerLevels[finalWinner.label];
      ent.history.push({
        date: new Date().toISOString(),
        action: `Gagné table niveau ${ent.level} → accès duel`
      });
      // ▶ Perdre la table → reset niveau = 0
      eliminated.forEach(p => {
        const e2 = playerLevels[p.label];
        if (e2.level !== 0) {
          e2.history.push({
            date: new Date().toISOString(),
            action: 'Perdu table → retour niveau 0'
          });
          e2.level = 0;
        }
      });
    } else {
      // (normalement jamais atteint pour isTable10=false)
    }

    saveLevels();
  }

  // ─────────────────────────────────────────────────────────────────
  // 9) Émission des updates & notification de fin
  // ─────────────────────────────────────────────────────────────────
  if (isTable10) {
    io.to(tableID).emit('updateTable', state);
    io.to('admin').emit('updateTable',   { tableID, gameState: state });
    io.to('admin').emit('tableFinished', { tableID, winner: winnerLabel });
    io.to(state.players[widx[0]].id)
      .emit('tableFinished', { tableID, winner: winnerLabel });
  } else {
    io.to(tableID).emit('updateMatch2',   { matchID: tableID, gameState: state });
    io.to('admin').emit('updateMatch2',   { matchID: tableID, gameState: state });
    io.to('admin').emit('match2Finished', { matchID: tableID, winner: winnerLabel });
    io.to(state.players[widx[0]].id)
      .emit('match2Finished', { matchID: tableID, winner: winnerLabel });
  }

  // ─────────────────────────────────────────────────────────────────
  // 10) Relance de la main suivante après 8s
  // ─────────────────────────────────────────────────────────────────
  setTimeout(() => dealNextHand(tableID), 8000);
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

  // ── 1a) Marquer qui est allé jusqu'au showdown (ni FOLD ni BUST) ──
  state.players.forEach(p => {
    p.inShowdown = !['FOLD', 'BUST'].includes(p.status);
  });

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
  const solved = state.players.map(p =>
    ['FOLD','BUST'].includes(p.status)
      ? null
      : Hand.solve([p.carda, p.cardb, ...state.board].map(conv))
  );
  const winners = Hand.winners(solved.filter(Boolean));
  const widx = solved
    .map((h, i) => h && winners.includes(h) ? i : -1)
    .filter(i => i >= 0);

  // ── 3) Gestion des égalités (split pot) ──
  if (widx.length > 1) {
    const share = Math.floor(state.pot / widx.length);
    widx.forEach(i => {
      const p = state.players[i];
      p.bankroll += share;
      p.status    = 'WINNER';
      p.handName  = solved[i].name;
    });
    state.players.forEach((p, i) => {
      if (!widx.includes(i)) p.status = p.bankroll > 0 ? '' : 'BUST';
    });
    state.phase = 'reveal';
    io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
    io.to('admin').emit('updateMatch2', { matchID, gameState: state });
    return setTimeout(() => dealNextHand(matchID), 8000);
  }

  // ── 4) Cas d’un seul gagnant ──
  const winnerIdx = widx[0];
  const loserIdx  = state.players.findIndex((_, i) => i !== winnerIdx);
  const winner    = state.players[winnerIdx];
  const loser     = state.players[loserIdx];

  winner.status   = 'WINNER';
  winner.handName = solved[winnerIdx].name;

  // ── 5) Partage du pot ──
  const share = Math.floor(state.pot / (widx.length || 1));
  widx.forEach(i => state.players[i].bankroll += share);

  // ── 6) Éliminer ou reset les autres ──
  state.players.forEach((p, i) => {
    if (!widx.includes(i)) p.status = p.bankroll > 0 ? '' : 'BUST';
  });

  // ─────────────────────────────────────────────────────────────────
  // 7) Historique & stats
  // ─────────────────────────────────────────────────────────────────
 
   // Si, par un cas rare, aucun gagnant n'a été déterminé → on skippe
  if (widx.length === 0) {
    console.warn(`evaluateRound(${tableID}) widx is empty, skipping stats.`);
    state.phase = 'reveal';
    io.to(tableID).emit('updateTable', state);
    io.to('admin').emit('updateTable', { tableID, gameState: state });
    // relance la main suivante après 8s
    return setTimeout(() => dealNextHand(tableID), 8000);
   }
 
  const mode        = matches2Config[matchID].mode;
  const winnerLabel = winner.label;
  const loserLabel  = loser.label;

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

  // ─────────────────────────────────────────────────────────────────
  // 8) Progression de niveau (1v1) → **uniquement** si un seul survivant
  // ─────────────────────────────────────────────────────────────────
  const surv = state.players.filter(p => p.status !== 'BUST');
  if (surv.length === 1) {
    // Assurer les entrées en mémoire
    [winner, loser].forEach(p => {
      if (!playerLevels[p.label]) {
        playerLevels[p.label] = { name:p.label, level:0, wins:0, history:[] };
      }
    });

    // ▶ Gagner un duel → +1 niveau
    {
      const entry = playerLevels[winner.label];
      const oldL  = entry.level;
      const neu   = oldL + 1;
      entry.level = neu;
      entry.wins  = (entry.wins || 0) + 1;
      entry.history.push({
        date: new Date().toISOString(),
        action: `Gagné duel niveau ${oldL} → ${neu}`
      });
    }

    // ▶ Perdre un duel → –1 niveau (min 0)
    {
      const entry = playerLevels[loser.label];
      const oldL  = entry.level;
      const neu   = Math.max(0, oldL - 1);
      entry.level = neu;
      entry.history.push({
        date: new Date().toISOString(),
        action: `Perdu duel niveau ${oldL} → ${neu}`
      });
    }

    saveLevels();
  }

  // ─────────────────────────────────────────────────────────────────
  // 9) Émission des updates & notification de fin
  // ─────────────────────────────────────────────────────────────────
  io.to(matchID) .emit('updateMatch2',   { matchID, gameState: state });
  io.to('admin') .emit('updateMatch2',   { matchID, gameState: state });
  io.to('admin') .emit('match2Finished', { matchID, winner: winnerLabel });
  io.to(winner.id).emit('match2Finished',{ matchID, winner: winnerLabel });

  // ─────────────────────────────────────────────────────────────────
  // 10) Relance de la main suivante après 8s
  // ─────────────────────────────────────────────────────────────────
  const survivors = state.players.filter(p => p.status !== 'BUST');
  if (survivors.length > 1) {
    setTimeout(() => dealNextHand(matchID), 8000);
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

  // 1) on passe au round suivant
  state.roundNumber++;

  // 2) reset du pot et des paris
  state.pot = 0;
  currentBetByTable[tableID]      = 0;
  currentMinRaiseByTable[tableID] = 0;
  state.current_bet    = 0;
  state.checkCount     = 0;
  state.roundEvaluated = false;

  // 3) réinitialisation du statut des joueurs
  state.players.forEach(p => {
    p.subtotal_bet = 0;
    if (p.status !== 'BUST') p.status = '';
  });

  // 4) redistribution des cartes et nouveaux blinds
  distributeCards(state);
  configureBlinds(state, tableID);

  // 5) émission vers clients et reset timer
// ── 5) émission vers clients ET reset du timer AVANT d'émettre
if (matches2Config[tableID]) {
  // On fixe d'abord le timer (turnStartTime / turnDuration)
  resetTurnTimer2(tableID);
  // Puis on émet les mises à jour, que les clients récupèreront tout de suite
  io.to(tableID).emit('updateMatch2',   { matchID: tableID, gameState: state });
  io.to('admin').emit('updateMatch2',   { matchID: tableID, gameState: state });
} else {
  resetTurnTimer(tableID);
  io.to(tableID).emit('updateTable',    state);
  io.to('admin').emit('updateTable',    { tableID, gameState: state });
}
}

/**
 * (Re)lance le timeout de 30s pour le prochain joueur de la table à 10 joueurs,
 * et élimine en cas de 5 passes consécutives.
 */
function resetTurnTimer(tableID) {
  clearTimeout(turnTimersByTable[tableID]);
  const s = gameStateByTable[tableID];
  if (!s) return;

  const j = s.current_bettor_index;
  // garde-fou : l’indice doit être un entier valide
  if (!Number.isInteger(j) || j < 0 || j >= s.players.length) {
    console.warn(`resetTurnTimer: indice invalide (${j}) pour table ${tableID}`);
    return;
  }

    // ─── NOUVEAU : on mémorise le début du tour courant ───
  // (permettra au client de recalculer le temps restant à la reconnexion)
  s.turnStartTime    = Date.now();
  s.turnDuration     = 30_000; // 30 secondes
  // ─────────────────────────────────────────────────────

  turnTimersByTable[tableID] = setTimeout(() => {
    const p = s.players[j];
    // nouveau garde-fou : s.players[j] doit exister
    if (!p) {
      console.warn(`resetTurnTimer: aucun joueur à l’indice ${j} pour table ${tableID}`);
      return;
    }

    // 1) on incrémente le compteur de passes
    p.missedCount = (p.missedCount || 0) + 1;

    if (p.missedCount >= 5) {
      // → élimination définitive
      p.status   = 'BUST';
      p.bankroll = 0;

      // si, après ça, un seul survivant reste → fin de partie
      const alive = s.players.filter(pl => pl.status !== 'BUST');
      if (alive.length === 1) {
        startReveal(tableID);
      } else {
        handlePostFold(tableID);
      }

    } else {
      // → fold forcé classique
      p.status = 'FOLD';

      handlePostFold(tableID);
    }
  }, 30_000);
}

/**
 * (Re)lance le timeout de 30s pour le prochain joueur
 * dans un duel (match2), et élimine après 5 passes.
 */
function resetTurnTimer2(matchID) {
  clearTimeout(turnTimersByMatch2[matchID]);
  const s = gameStateByTable[matchID];
  if (!s) return;

  const j = s.current_bettor_index;
  if (!Number.isInteger(j) || j < 0 || j >= s.players.length) {
    console.warn(`resetTurnTimer2: indice invalide (${j}) pour match2 ${matchID}`);
    return;
  }

    // ─── NOUVEAU : début du tour pour le match 2 ───
    s.turnStartTime    = Date.now();
    s.turnDuration     = 30_000;
    // ─────────────────────────────────────────────────

  turnTimersByMatch2[matchID] = setTimeout(() => {
    const p = s.players[j];
    if (!p) {
      console.warn(`resetTurnTimer2: aucun joueur à l’indice ${j} pour match2 ${matchID}`);
      return;
    }

    p.missedCount = (p.missedCount || 0) + 1;

    if (p.missedCount >= 5) {
      p.status   = 'BUST';
      p.bankroll = 0;

      handlePostFold2(matchID, s);
    } else {
      p.status = 'FOLD';

      handlePostFold2(matchID, s);
    }
  }, 30_000);
}


/**
 * Passe au joueur suivant actif dans une table à 10 joueurs,
 * émet l’update et relance le timer.
 */
function advanceTurn(tableID) {
  const state = gameStateByTable[tableID];
  if (!state) return;

  const N = state.players.length;
  let idx = state.current_bettor_index;
  do {
    idx = (idx + 1) % N;
  } while (['FOLD','BUST'].includes(state.players[idx].status));

  state.current_bettor_index = idx;

  // 1) On appelle d’abord resetTurnTimer pour mettre à jour state.turnStartTime & state.turnDuration
  resetTurnTimer(tableID);

  // 2) Puis on émet updateTable AVEC le turnStartTime fraîchement calculé
  io.to(tableID).emit('updateTable', state);
  io.to('admin').emit('updateTable', { tableID, gameState: state });
}

/**
 * Même logique pour les duels 2 joueurs.
 */
function advanceTurn2(matchID) {
  const state = gameStateByTable[matchID];
  if (!state) return;

  const N = state.players.length;
  let idx = state.current_bettor_index;
  do {
    idx = (idx + 1) % N;
  } while (['FOLD','BUST'].includes(state.players[idx].status));

  state.current_bettor_index = idx;

  // 1) On reset d’abord le timer (set turnStartTime = Date.now())
  resetTurnTimer2(matchID);

  // 2) Puis on émet l’update AVEC le bon turnStartTime
  io.to(matchID).emit('updateMatch2', { matchID, gameState: state });
  io.to('admin').emit('updateMatch2', { matchID, gameState: state });
}

/**
 * Après un fold (naturel ou forcé), on gère
 * – le showdown si plus que 2 joueurs
 * – le reveal si nécessaire
 */
function handlePostFold(tableID) {
  const state = gameStateByTable[tableID];
  if (!state) return;

  const alive = state.players.filter(p => !['FOLD','BUST'].includes(p.status));
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
  const alive = state.players.filter(p => !['FOLD','BUST'].includes(p.status));
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

  // 1) S’il est déjà en « reveal », on évalue tout de suite
  if (state.phase === 'reveal') {
    if (!state.roundEvaluated) {
      if (matches2Config[tableID]) evaluateRound2(tableID);
      else                           evaluateRound(tableID);
      state.roundEvaluated = true;
    }
    io.to(tableID).emit('updateTable', state);
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
      state.phase = phase;
      io.to(tableID).emit('updateTable', state);
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
    state.phase = 'reveal';
    if (!state.roundEvaluated) {
      if (matches2Config[tableID]) evaluateRound2(tableID);
      else                           evaluateRound(tableID);
      state.roundEvaluated = true;
    }
    io.to(tableID).emit('updateTable', state);
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
function startReveal(tableID) {
  const state = gameStateByTable[tableID];
  if (!state) return;

  // 1) Si on est déjà en 'reveal', on n’a plus qu’à évaluer tout de suite
  if (state.phase === 'reveal') {
    // Si jamais on appelle startReveal alors qu’on est déjà en reveal,
    // on s’assure que l’éval n’est faite qu’une seule fois.
    if (!state.roundEvaluated) {
      if (matches2Config[tableID]) evaluateRound2(tableID);
      else                           evaluateRound(tableID);
      state.roundEvaluated = true;
    }
    io.to(tableID).emit('updateTable', state);
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
      state.phase = phase;
      io.to(tableID).emit('updateTable', state);
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
    state.phase = 'reveal';
    if (!state.roundEvaluated) {
      if (matches2Config[tableID]) evaluateRound2(tableID);
      else                           evaluateRound(tableID);
      state.roundEvaluated = true;
    }
    io.to(tableID).emit('updateTable', state);
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
  socket.on('joinAdmin', () => socket.join('admin'));

  socket.on('joinGame', payload => {
    // 0) Récupère roomID et type (table VS match2)
    const roomID   = payload.table  ?? payload.match2;
    const isMatch2 = Boolean(payload.match2);
    if (!roomID) {
      return socket.emit('joinError', 'Aucun tableID ni match2ID fourni.');
    }
  
    // 1.1) Si la partie est déjà lancée, on tente une RECONNEXION
    const G = gameStateByTable[roomID];
    if (G) {
      // 1.1.a) Vérifie le seat
      const seat = parseInt(payload.seat, 10);
      if (!Number.isInteger(seat) || seat < 0 || seat >= G.players.length) {
        return socket.emit('joinError', 'Paramètre seat manquant ou invalide.');
      }
      const p = G.players.find(p => p.seat === seat);
      if (!p) {
        return socket.emit('joinError', 'Siège introuvable.');
      }
  
      // 1.1.b) **NOUVEAU : détecte si la partie est déjà finie (un seul survivant)**
      const survivors = G.players.filter(player => player.status !== 'BUST');
      if (survivors.length === 1) {
        // → La partie est terminée
        if (p.status !== 'BUST') {
          // C’est lui le dernier survivant : c’est le gagnant
          return socket.emit('joinError', 'La partie est terminée, vous avez gagné.');
        } else {
          // Lui est busté : maintien du message d’élimination
          return socket.emit('joinError', 'Vous avez été éliminé.');
        }
      }
  
      // 1.1.c) Si la partie n’est pas terminée, on retombe sur le code initial :
      //        - si p.status === 'BUST' on renvoie « Vous avez été éliminé »
      //        - sinon on fait la reconnexion normalement
      if (p.status === 'BUST') {
        return socket.emit('joinError', 'Vous avez été éliminé.');
      }
  
      // → Mise à jour de l’ID du socket et renvoi de l’état courant
      p.id = socket.id;
      socket.playerData = { id: socket.id, label: p.label, seat };
      socket.join(roomID);
  
      // On renvoie l’état existant (updateTable ou updateMatch2 selon le type)
      io.to(socket.id).emit(
        matches2Config[roomID]
          ? 'updateMatch2'
          : 'updateTable',
        matches2Config[roomID]
          ? { matchID: roomID, gameState: G }
          : G
      );
      return;
    }
  
    // 2) Sélectionne la config et le buffer d’attente
    const config     = isMatch2 ? matches2Config[roomID]   : tablesConfig[roomID];
    const waitingBuf = isMatch2 ? waitingPlayersByMatch2   : waitingPlayersByTable;
    if (!config) {
      return socket.emit('joinError', 'Table ou match introuvable.');
    }
  
    // 3) Nombre de sièges possibles (10 ou 2)
    const totalSeats = config.players.length;
  
    // 4) Initialise un tableau fixe [null,…] de longueur totalSeats
    waitingBuf[roomID] = waitingBuf[roomID] || Array(totalSeats).fill(null);
  
    // 5) Lecture & validation du seat
    const seat = parseInt(payload.seat, 10);
    if (!Number.isInteger(seat) || seat < 0 || seat >= totalSeats) {
      return socket.emit('joinError',
        `Paramètre seat manquant ou invalide : utilisez &seat=0…${totalSeats - 1}`);
    }
  
    // 6) Refuse si déjà réservé
    if (waitingBuf[roomID][seat]) {
      return socket.emit('joinError', 'Ce siège est déjà pris.');
    }
  
    // 7) Réserve ce siège pour ce socket
    waitingBuf[roomID][seat] = socket;
    const label = config.players[seat];
    socket.playerData = { id: socket.id, label, seat };
  
    // 8) Rejoint la room
    socket.join(roomID);
  
    // 9) Si tous les sièges sont occupés → lancement de la partie
    if (waitingBuf[roomID].every(s => s !== null)) {
      return isMatch2
        ? tryStartMatch2(roomID)
        : tryStartGame(  roomID);
    }
  
    // 10) Sinon on notifie le nombre de places prises
    const count = waitingBuf[roomID].filter(s => s).length;
    if (isMatch2) {
      io.to(roomID).emit('updateWaitingRoom', { matchID: roomID, waitingCount: count });
      io.to('admin').emit('updateWaitingRoom', { matchID: roomID, waitingCount: count });
    } else {
      io.to(roomID).emit('updateWaitingRoom', { waitingCount: count });
      io.to('admin').emit('updateWaitingRoom', { tableID:  roomID, waitingCount: count });
    }
  });   

  socket.on('playerAction', action => {
    // 1) Récupération du contexte
    const rooms = [...socket.rooms].filter(r => r !== socket.id);
    if (!rooms.length) return;
    const table = rooms[0];
    const state = gameStateByTable[table];
    if (!state) return;
    const idx = state.players.findIndex(p => p.id === socket.id);
    if (idx < 0) return;
    const me = state.players[idx];
  
    // 2) Ajustement du montant du call
    if (action.type === 'call') {
      action.amount = (currentBetByTable[table] || 0) - (me.subtotal_bet || 0);
    }
  
    // 3) Application de l’action
    let ok = false;
    if (action.type === 'fold') {
      me.status = 'FOLD'; ok = true;
    } else if (action.type === 'check' && me.subtotal_bet === currentBetByTable[table]) {
      me.status = 'CHECK';
      state.checkCount++;
      ok = true;
    } else if (['call','raise'].includes(action.type)) {
      ok = serverBet(table, idx, action.amount);
    }    
    if (!ok) return;

    state.players[idx].missedCount = 0;

      // 4bis) Si tous les survivants sont ALLIN → showdown immédiat
      const active = state.players.filter(p => p.status !== 'FOLD' && p.status !== 'BUST');
      if (active.length > 0 && active.every(p => p.status === 'ALLIN')) {
        return startRevealAllIn(table); // ← on passe bien l’ID de la table      
      }

  // 5) Si plus qu’un survivant → showdown
  if (active.length === 1) {
    return startReveal(table);
  }
 
    // 5) Si plus qu’un survivant → showdown
    const alive = state.players.filter(p => p.status !== 'FOLD' && p.status !== 'BUST');
    if (alive.length === 1) {
      return startReveal(table);
    }
  
    // 6) Si tout le monde a misé/call (bet > 0) ou checké (bet = 0) → on avance de phase
    if (isRoundComplete(table)) {
      const PH = ['preflop','flop','turn','river','reveal'];
      const i  = PH.indexOf(state.phase);
      if (i >= 0 && i < PH.length - 1) {
        // On passe à la phase suivante
        state.phase = PH[i+1];
        // Réinitialise les petites mises et statuses temporaires
         state.players.forEach(p => {
            p.subtotal_bet = 0;
             // On ne reset que les joueurs encore en lice
            if (p.status !== 'FOLD' && p.status !== 'BUST') {
             p.status = '';
             }
           });
        currentBetByTable[table]      = 0;
        currentMinRaiseByTable[table] = 0;
        state.current_bet             = 0;
        state.checkCount              = 0;
      }
      // Si on vient d’arriver sur reveal → showdown
      if (state.phase === 'reveal') {
        return startReveal(table);
      }
    }
  
    // 7) On passe au prochain joueur
    const N = state.players.length;
    do {
      state.current_bettor_index = (state.current_bettor_index + 1) % N;
    } while (['FOLD','BUST'].includes(state.players[state.current_bettor_index].status));
  
    // 8) Émet les updates
// 8) On relance d'abord le timer côté serveur, puis on notifie
if (matches2Config[table]) {
  resetTurnTimer2(table);
  io.to(table).emit('updateMatch2',   { matchID: table, gameState: state });
  io.to('admin').emit('updateMatch2', { matchID: table, gameState: state });
} else {
  resetTurnTimer(table);
  io.to(table).emit('updateTable',   state);
  io.to('admin').emit('updateTable', { tableID: table, gameState: state });
}
  });  

  socket.on('disconnect', () => {
    // ——————————————————————————————————————————
    // Déconnexion d’un socket
    // ——————————————————————————————————————————
  
    // — Tables 10 joueurs —
    Object.keys(waitingPlayersByTable).forEach(tableID => {
      const buf = waitingPlayersByTable[tableID] || [];
  
      // 1) Libère le siège dans la waiting-room
      buf.forEach((s, idx) => {
        if (s && s.id === socket.id) {
          buf[idx] = null;
        }
      });
  
      // 2) Notifie le nombre de places prises
      const taken = buf.filter(s => s !== null).length;
      io.to(tableID).emit('updateWaitingRoom',    { waitingCount: taken });
      io.to('admin').emit('updateWaitingRoom',    { tableID, waitingCount: taken });
  
    });
  
    // — Matchs 2 joueurs —
    Object.keys(waitingPlayersByMatch2).forEach(matchID => {
      const buf2 = waitingPlayersByMatch2[matchID] || [];
  
      // 1) Libère le siège dans la waiting-room
      buf2.forEach((s, idx) => {
        if (s && s.id === socket.id) {
          buf2[idx] = null;
        }
      });
  
      // 2) Notifie le nombre de places prises
      const taken2 = buf2.filter(s => s !== null).length;
      io.to(matchID).emit('updateWaitingRoom',    { matchID, waitingCount: taken2 });
      io.to('admin').emit('updateWaitingRoom',    { matchID, waitingCount: taken2 });
  
    });
  });  
});

// ──────────────────────────────────────────────────────────────
// 13) Lancement du serveur
// ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
// au lieu de : server.listen(PORT, '127.0.0.1', …)
server.listen(PORT, '0.0.0.0', () => console.log(`Serveur sur port ${PORT}`));