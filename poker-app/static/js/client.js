// client.js
"use strict";

let socket;
let myCardsRevealed   = false,
    mySocketId        = "",
    mySeatIndex       = null,
    revealedAllSeats  = false,
    currentGameState  = null,
    lastPhase         = null;   // ← pour détecter reveal→preflop
let winnerAnnounced   = false;  // empêche plusieurs affichages
let loserAnnounced    = false;  // idem
let overlayShown = false;
let gameMode = null;
let lastActiveIdx = null;
let timerInterval = null;
let lastTurnStartTime = null;
let justReconnected = false;

/** Actions utilisateur */
function human_fold() {
  console.log("[client] Fold");
  socket.emit("playerAction", { type: "fold" });
}
function human_call() {
  console.log("[client] Call");
  if (!currentGameState) return;
  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  if (meIdx < 0) return;
  const me = currentGameState.players[meIdx];
  const toCall = Math.max(0, (currentGameState.current_bet||0) - (me.subtotal_bet||0));
  socket.emit("playerAction", { type: "call", amount: toCall });
}
function human_check() {
  console.log("[client] Check");
  socket.emit("playerAction", { type: "check" });
}

/** Griser / activer Fold & Call */
function gui_hide_fold_call_click() {
  const fold = document.querySelector("#fold-button");
  const call = document.querySelector("#call-button");
  if (fold) { fold.classList.add("disabled"); fold.onclick = null; }
  if (call) { call.classList.add("disabled"); call.onclick = null; }
  gui_disable_shortcut_keys();
}
function gui_setup_fold_call_click(foldText, callText, foldFunc, callFunc) {
  const fold = document.querySelector("#fold-button");
  const call = document.querySelector("#call-button");
  if (fold) {
    fold.classList.remove("disabled");
    internal_clickin_helper(fold, foldText, foldFunc);
  }
  if (call) {
    call.classList.remove("disabled");
    internal_clickin_helper(call, callText, callFunc);
  }
}

/** Animation de vos cartes */
function animateMyCards() {
  if (mySeatIndex === null) return;
  const mySeatEl = document.getElementById("seat" + mySeatIndex);
  if (!mySeatEl) return;

  const [c1, c2] = Array.from(mySeatEl.querySelectorAll(".holecards .card"));

  // 1) Fade-in du back
  [c1, c2].forEach(card => {
    card.style.transition = "";
    card.style.transform  = "";
    card.classList.remove("revealed", "visible");
    internal_setCard(card, "blinded", false, true);
    requestAnimationFrame(() => card.classList.add("visible"));
  });

  // 2) Après 5s → flip
  setTimeout(() => {
    const me = currentGameState.players[mySeatIndex];
    if (!me) return;
    flipCardsSimultaneously(c1, c2, me.carda, me.cardb);
    myCardsRevealed = true;
  }, 5000);
}

/**
 * Démarre un intervalle qui, chaque seconde, calcule le temps restant
 * à partir de gameState.turnStartTime et gameState.turnDuration.
 */
function startClientTimerFromState(gameState) {
  clearInterval(timerInterval);

  const circle = document.getElementById('timer-circle');
  const textEl = document.getElementById('timer-text');
  const radius = 36;
  const C      = 2 * Math.PI * radius;
  circle.setAttribute('stroke-dasharray', C);

  function updateClock() {
    const now     = Date.now();
    let remaining = gameState.turnDuration - (now - gameState.turnStartTime);
    if (remaining < 0) remaining = 0;
    if (remaining > gameState.turnDuration) remaining = gameState.turnDuration;
    const leftSec = Math.ceil(remaining / 1000);

    const fraction = (gameState.turnDuration - remaining) / gameState.turnDuration;
    circle.setAttribute('stroke-dashoffset', fraction * C);

    if      (leftSec <= 5)    circle.setAttribute('stroke', 'red');
    else if (leftSec <= 15)   circle.setAttribute('stroke', 'orange');
    else                      circle.setAttribute('stroke', '#00e676');

    textEl.textContent = leftSec > 0 ? leftSec : '0';

    if (remaining <= 0) {
      clearInterval(timerInterval);
    }
  }

  // Affiche immédiatement l’état du timer
  updateClock();
  timerInterval = setInterval(updateClock, 1000);
}

/**
 * Même code que ton updateTable(data) original,
 * mais en utilisant `gs` comme gameState.
 */
// ──────────────────────────────────────────────────────────
// Nouvelle fonction pour relancer le timer depuis un turnStartTime
// ──────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────
// Mise à jour de resumeTimerFromState pour clampper remainingMs
// ──────────────────────────────────────────────────────────
function resumeTimerFromState(gs) {
  clearInterval(timerInterval);
  const circle = document.getElementById("timer-circle");
  const textEl = document.getElementById("timer-text");
  const radius = 36;
  const C      = 2 * Math.PI * radius;
  circle.setAttribute("stroke-dasharray", C);

  function updateClock() {
    const now     = Date.now();
    let remMs     = gs.turnDuration - (now - gs.turnStartTime);
    if (remMs < 0) remMs = 0;
    if (remMs > gs.turnDuration) remMs = gs.turnDuration;
    const leftSec = Math.floor(remMs / 1000);

    const fraction = (gs.turnDuration - remMs) / gs.turnDuration;
    circle.setAttribute("stroke-dashoffset", fraction * C);

    if      (leftSec <= 5)    circle.setAttribute("stroke", "red");
    else if (leftSec <= 15)   circle.setAttribute("stroke", "orange");
    else                      circle.setAttribute("stroke", "#00e676");

    textEl.textContent = leftSec;

    if (remMs <= 0) {
      clearInterval(timerInterval);
    }
  }

  updateClock();
  timerInterval = setInterval(updateClock, 1000);
}

// ──────────────────────────────────────────────────────────
// Fonction principale mise à jour de l’UI + timer
// ──────────────────────────────────────────────────────────
function handleGameStateUpdate(gs) {
  // 1) Mets à jour l’interface (ton code existant)
  updateInterface(gs);

  // 2) Reset cartes quand on repasse de reveal → preflop (inchangé)
  if (lastPhase === "reveal" && gs.phase === "preflop") {
    resetAllBacks();
    myCardsRevealed = false;
    animateMyCards();
    lastActiveIdx = null; // on force la relance du timer au prochain tour
    lastTurnStartTime = null;
  }
  lastPhase = gs.phase;

  // 3) Affiche SB/BB (inchangé)
  document.getElementById("small-blind").textContent = `SB: ${gs.smallBlind}`;
  document.getElementById("big-blind").textContent   = `BB: ${gs.bigBlind}`;

  // 4) Gestion du timer pour tout le monde
  const actionPhases   = ["preflop","flop","turn","river"];
  const timerContainer = document.getElementById("timer-container");

  if (actionPhases.includes(gs.phase)) {
    const activeIdx = gs.current_bettor_index;

    // → On ne relance le timer QUE si le turnStartTime envoyé par le serveur a changé
    if (gs.turnStartTime !== lastTurnStartTime) {
      // relance du timer en se basant sur le state du serveur
      startClientTimerFromState(gs);

      // on mémorise pour la prochaine comparaison
      lastTurnStartTime = gs.turnStartTime;
      lastActiveIdx     = activeIdx;
    }

    timerContainer.style.display = "block";
  } else {
    // pendant reveal ou autre, on stoppe et masque
    clearInterval(timerInterval);
    timerContainer.style.display = "none";
  }
}

/** Init connexion & handlers */
function initGame() {
  console.log("[client] initGame()");

  // ── 0) Parse des paramètres UNE FOIS ──
  const params    = new URLSearchParams(window.location.search);
  const tableID   = params.get("table");
  const match2ID  = params.get("match2");
  const seatParam = parseInt(params.get("seat"), 10);

  // Validation de base
  if (!tableID && !match2ID) {
    alert("URL invalide : vous devez passer ?table=XYZ&seat=N ou ?match2=ABC&seat=N");
    return;
  }
  if (!Number.isInteger(seatParam)) {
    alert("Paramètre seat manquant ou invalide : utilisez &seat=0…9 pour table ou &seat=0…1 pour match2");
    return;
  }
  mySeatIndex = seatParam;

  // ── 1) Connexion Socket.IO ──
  socket = io();

  socket.on("joinError", message => {
    document.body.innerHTML = `
      <div style="
        display:flex;
        align-items:center;
        justify-content:center;
        height:100vh;
        background:#000;
        color:#f33;
        font-size:24px;
        text-align:center;
        padding:20px;
      ">
        ${message}
      </div>
    `;
  });

  // ── 2) Fonction pour émettre joinGame à chaque (re)connexion ──
  function sendJoin() {
    const payload = {
      name: localStorage.getItem("playername") || "Player",
      seat: seatParam
    };
    if (tableID)  payload.table  = tableID;
    else          payload.match2 = match2ID;
    console.log("[client] emit joinGame", payload);
    socket.emit("joinGame", payload);
  }

  socket.on("connect", () => {
    mySocketId = socket.id;
    console.log("[client] connecté, id =", mySocketId);
    sendJoin();
  });

  // On va marquer “justReconnected” à true avant d’émettre joinGame
  socket.on("reconnect", attempt => {
    console.log(`[client] reconnexion #${attempt}`);
    justReconnected = true;
    sendJoin();
  });

  // ── 3) Waiting room ──
  socket.on("updateWaitingRoom", data => {
    const el = document.getElementById("waiting-count");
    if (!el) return;
    const max = data.matchID ? 2 : 10;
    el.textContent = `En attente de joueurs : ${data.waitingCount}/${max}`;
  });

  // ── 4) Démarrage du jeu ──
  socket.on("startGame", data => {
    console.log("[client] startGame →", data);
    document.getElementById("loading-screen")?.remove();
    gui_show_poker_table();
  
    // 1) Synchronisation du seat
    currentGameState = data.gameState;
    const foundIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
    if (foundIdx >= 0 && foundIdx !== mySeatIndex) {
      console.warn("Seat index mismatch:", mySeatIndex, "→", foundIdx);
      mySeatIndex = foundIdx;
    }
    const mySeatEl = document.getElementById("seat" + mySeatIndex);
    if (mySeatEl) mySeatEl.classList.add("my-seat");
  
    window.gameState      = currentGameState;
    window.gameStatePhase = currentGameState.phase;
  
    // 2) Reset visuel + UI
    resetAllBacks();
    updateInterface(currentGameState);
  
    // ← ICI : on lance le timer basé sur le state serveur (turnStartTime fourni par le serveur)
    startClientTimerFromState(currentGameState);
    lastTurnStartTime = currentGameState.turnStartTime;
    lastActiveIdx     = currentGameState.current_bettor_index;
  
    requestAnimationFrame(() => updateTurnIndicator(currentGameState));
    animateMyCards();
  });  

  // ── 5) Réceptions des mises à jour de partie ──
// ─── Handler pour les tables à 10 joueurs ───
socket.on("updateTable", data => {
  // a) Retrait de l’écran de chargement
  document.getElementById("loading-screen")?.remove();
  gui_show_poker_table();

  // b) Ré-ajoute toujours la classe "my-seat" sur votre chaise
  const mySeatEl = document.getElementById("seat" + mySeatIndex);
  if (mySeatEl && !mySeatEl.classList.contains("my-seat")) {
    mySeatEl.classList.add("my-seat");
  }

  // c) Mise à jour globale de l’UI (noms, pot, board, etc.)
  handleGameStateUpdate(data);

  // d) Si on vient de se reconnecter, on force l’affichage du dos des cartes
  //    et on **ne redémarre** PAS la logique “resetAllBacks/animateMyCards”
  if (justReconnected) {
    justReconnected = false;

    // Forcer le dos de carte pour VOTRE siège
    if (mySeatEl) {
      const c1 = mySeatEl.querySelector(".holecard1");
      const c2 = mySeatEl.querySelector(".holecard2");
      if (c1 && c2) {
        internal_setCard(c1, "blinded", false, true);
        internal_setCard(c2, "blinded", false, true);
      }
    }

    // Note : on ne fait pas “resetAllBacks()/animateMyCards()” ici.
    //       Le timer a déjà été relancé automatiquement par handleGameStateUpdate
    //       grâce à la comparaison turnStartTime != lastTurnStartTime.

    return;
  }

  // e) Sinon (mise à jour « live » classique), on relance resetAllBacks/animateMyCards si nécessaire
  const me = data.players[mySeatIndex];
  if (!myCardsRevealed && me.carda && me.cardb) {
    resetAllBacks();
    animateMyCards();
  }
});


// ─── Handler pour les duels 2-joueurs ───
socket.on("updateMatch2", ({ gameState }) => {
  // a) Retrait de l’écran de chargement
  document.getElementById("loading-screen")?.remove();
  gui_show_poker_table();

  // b) Ré-ajoute toujours "my-seat" sur votre chaise
  const mySeatEl = document.getElementById("seat" + mySeatIndex);
  if (mySeatEl && !mySeatEl.classList.contains("my-seat")) {
    mySeatEl.classList.add("my-seat");
  }

  // c) Mise à jour globale de l’UI
  handleGameStateUpdate(gameState);

  // d) Si reconnexion, on force le dos des cartes, mais on ne ré-anime pas
  if (justReconnected) {
    justReconnected = false;

    if (mySeatEl) {
      const c1 = mySeatEl.querySelector(".holecard1");
      const c2 = mySeatEl.querySelector(".holecard2");
      if (c1 && c2) {
        internal_setCard(c1, "blinded", false, true);
        internal_setCard(c2, "blinded", false, true);
      }
    }

    // Le timer a déjà été pris en compte par handleGameStateUpdate
    return;
  }

  // e) Sinon, si cartes pas encore révélées, on relance l’animation
  const me = gameState.players[mySeatIndex];
  if (!myCardsRevealed && me.carda && me.cardb) {
    resetAllBacks();
    animateMyCards();
  }
});

  // ── 6) Bouton Raise ──
  document.getElementById("raise-button")?.addEventListener("click", show_custom_raise);
}

window.initGame = initGame;


/** Réinitialise tous les backs (pour reveal→preflop) */
function resetAllBacks() {
  currentGameState.players.forEach((_, seatIdx) => {
    const seatEl = document.getElementById("seat" + seatIdx);
    if (!seatEl) return;
    seatEl.querySelectorAll(".holecards .card").forEach(card => {
      card.style.transition = "";
      card.style.transform  = "";
      card.classList.remove("revealed", "visible");
      internal_setCard(card, "blinded", false, true);
      requestAnimationFrame(() => card.classList.add("visible"));
    });
  });
}

/** Met à jour toute l’UI */
function updateInterface(gameState) {
  // 0) Garder les refs globales
  window.gameState      = gameState;
  window.gameStatePhase = gameState.phase;
  currentGameState      = gameState;

  // 1) Affiche la table
  gui_show_poker_table();

  // 3) Désactive et grise définitivement les sièges BUSTED
  gameState.players.forEach((p, i) => {
    if (p.status === 'BUST') {
      // a) Affiche "BUSTED" comme nom
      gui_set_player_name('BUSTED', i);
      // b) Bankroll = 0, pas de mise
      gui_set_bankroll(0, i);
      gui_set_bet('', i);
      // c) Grise visuel du siège
      const seatEl = document.getElementById('seat' + i);
      if (seatEl) seatEl.classList.add('disabled-seat');
      // d) Si c'est moi, cache tous mes contrôles
      if (i === mySeatIndex) {
        gui_hide_fold_call_click();
        disableRaiseButton();
      }
    }
  });

  // 4) Mode hyperfast → auto all-in en préflop
  if (gameMode === 'hyper' && currentGameState.phase === 'preflop' && !overlayShown) {    gui_hide_fold_call_click();
    disableRaiseButton();
    const me = gameState.players.find(p => p.id === mySocketId);
    if (me && me.bankroll > 0) {
      socket.emit("playerAction", { type: "raise", amount: me.bankroll });
    }
    overlayShown = true;
  }

  // Dealer
  if (
    typeof gameState.dealerIndex === 'number' &&
    gameState.players[gameState.dealerIndex].status !== 'BUST'
  ) {
    gui_place_dealer_button(gameState.dealerIndex);
  } else {
    gui_hide_dealer_button();
  }

  // Cache cartes BUST hors reveal
  gameState.players.forEach((p, idx) => {
    if (p.status === 'BUST' && gameState.phase !== 'reveal') {
      gui_set_player_cards("", "", idx, false);
    }
  });

  // Noms, bankrolls & mises
  gameState.players.forEach((p, seatIdx) => {
    const isMe = p.id === mySocketId;
    let displayName;
  
    if (p.status === 'BUST') {
      displayName = 'BUSTED';
    } else if (isMe) {
      displayName = 'YOU';
    } else {
      displayName = `Player${p.seat + 1}`; // générique
    }
  
    // ← ici on passe seatIdx, pas i
    gui_set_player_name(displayName, seatIdx);
    gui_set_bankroll(p.bankroll, seatIdx);

    let betText = "";
    if      (p.status === "FOLD")  betText = "DROPPED";
    else if (p.status === "CHECK") betText = "CHECK";
    else if (p.status === "CALL")  betText = `CALL (${p.subtotal_bet})`;
    else if (p.status === "RAISE") betText = `BET (${p.subtotal_bet})`;
    else if (p.status === "ALLIN") betText = `ALL IN (${p.subtotal_bet})`;
    else if (p.subtotal_bet > 0)   betText = `${p.subtotal_bet}`;

    gui_set_bet(betText, seatIdx);
  });

  // Pot
  gui_write_basic_general(gameState.pot);

  // Board
  const ids = ["flop1","flop2","flop3","turn","river"];
  ids.forEach(id => {
    const e = document.getElementById(id);
    if (e) e.style.visibility = "hidden";
  });
  const phase = gameState.phase;
  if (["flop","turn","river","reveal"].includes(phase)) {
    gameState.board.slice(0,3).forEach((c,i) => {
      gui_lay_board_card(i, c);
      document.getElementById(ids[i]).style.visibility = "visible";
    });
  }
  if (["turn","river","reveal"].includes(phase)) {
    gui_lay_board_card(3, gameState.board[3]);
    document.getElementById("turn").style.visibility = "visible";
  }
  if (["river","reveal"].includes(phase)) {
    gui_lay_board_card(4, gameState.board[4]);
    document.getElementById("river").style.visibility = "visible";
  }

  // Turn indicator
  updateTurnIndicator(gameState);

  // Highlight actif
  const activeIdx = gameState.current_bettor_index;
  gameState.players.forEach((p,i) => {
    const nameEl = document.querySelector(`#seat${i} .player-name`);
    if (!nameEl) return;
    if (i === activeIdx && p.status !== 'BUST') {
      nameEl.style.backgroundColor = 'orange';
      nameEl.style.color           = 'black';
    } else {
      nameEl.style.backgroundColor = '';
      nameEl.style.color           = '';
    }
  });

  // Couleurs selon statut
  gameState.players.forEach((p,i) => {
    const el = document.querySelector(`#seat${i} .player-name`);
    if (!el) return;
    if (p.status==='FOLD')        { el.style.backgroundColor='gray';  el.style.color='black'; }
    else if (p.status==='BUST')   { el.style.backgroundColor='black'; el.style.color='white'; }
    else if (p.status==='WINNER') { el.style.backgroundColor='yellow';el.style.color='black'; el.style.boxShadow='0 0 8px yellow'; }
  });

  // Fold/Check pour vous
  const myIdx    = gameState.players.findIndex(p=>p.id===mySocketId);
  const mePlayer = gameState.players[myIdx] || {};
  const isMyTurn = myIdx === gameState.current_bettor_index && mePlayer.status !== 'BUST';
  if (isMyTurn) {
    gui_setup_fold_call_click(
      `<font color="red"><u>F</u>old</font>`,
      `<font color="orange"></font>`,
      human_fold, human_check
    );
  } else {
    gui_hide_fold_call_click();
  }

  // Raise
  if (isMyTurn) enableRaiseButton();
  else           disableRaiseButton();

  // Reveal final
  if (phase === 'reveal' && !revealedAllSeats) {
    // 1) retire d’éventuels marquages précédents
    document.querySelectorAll('.seat').forEach(seatEl => {
      seatEl.classList.remove('winning-hand');
    });

    // 2) flip immédiat des cartes encore en lice
    gameState.players.forEach((p, i) => {
      if (!p.inShowdown) return;
      const seat = document.getElementById('seat' + i);
      if (!seat) return;
      const c1 = seat.querySelector('.holecard1');
      const c2 = seat.querySelector('.holecard2');
      if (c1 && c2) {
        flipCardsSimultaneously(c1, c2, p.carda, p.cardb);
        setTimeout(() => gui_set_player_cards(p.carda, p.cardb, i, false), 600);
      }
    });

// 3) après un délai, on affiche le message + surlignage + overlay
const REVEAL_DELAY = 5000; // 3s
setTimeout(() => {
  // on ne fait rien si on n'est plus en phase "reveal"
  if (currentGameState.phase !== 'reveal') return;

  // récupère le premier gagnant
  const winners = currentGameState.players.filter(p => p.status === 'WINNER');
  if (!winners.length) return;

  const w    = winners[0];
  const who  = w.id === mySocketId ? 'YOU' : w.label;
  const hand = w.handName || 'a winning hand';

  // texte de fin
  document.getElementById('end-game-message').textContent =
    `${who} wins the hand with ${hand}!`;

  // highlight gagnant
  const idx    = currentGameState.players.indexOf(w);
  const seatEl = document.getElementById('seat' + idx);
  if (seatEl) seatEl.classList.add('winning-hand');

  // overlay uniquement si vraiment terminé (un seul survivant)
  const survivors = currentGameState.players.filter(p => p.status !== 'BUST');
  if (survivors.length === 1) {
    if (w.id === mySocketId)      showVictory(who);
    else                           showLosing();
  }
}, REVEAL_DELAY);

    revealedAllSeats = true;
  }

    // → Au passage reveal → preflop, affiche l’overlay de défaite pour les BUST
    if (lastPhase === 'reveal' && phase === 'preflop') {
      const me = gameState.players.find(p => p.id === mySocketId);
      if (me && me.status === 'BUST') {
        // Le #end-game-message contient déjà "X wins the hand with Y"
        showLosing(); 
        // On ne clear pas tout de suite #end-game-message pour conserver le texte
        return;  // on sort pour garder l'overlay figé
      }
    }  

// Reset préflop
if (phase === 'preflop') {
  // Si on a déjà affiché l’overlay de défaite, on ne reset rien (return au-dessus)
  
  // sinon, on est un joueur actif → reset normal :
  revealedAllSeats = false;
  document.querySelectorAll('.seat').forEach(seatEl => {
    seatEl.classList.remove('winning-hand');
  });
  const endMsg = document.getElementById('end-game-message');
  if (endMsg) endMsg.textContent = '';
  const tm = document.getElementById('turn-message');
  if (tm) tm.textContent = '';
  winnerAnnounced = false;
  loserAnnounced  = false;
  overlayShown    = false;
  document.querySelectorAll('.player-name').forEach(el => {
    el.style.boxShadow = '';
  });
}

}

function startClientTimer() {
  clearInterval(timerInterval);
  const circle = document.getElementById('timer-circle');
  const textEl = document.getElementById('timer-text');
  const total  = 30;
  let left     = total;

  const radius = 36;
  const C      = 2 * Math.PI * radius;
  circle.setAttribute('stroke-dasharray', C);
  circle.setAttribute('stroke-dashoffset', 0);
  circle.setAttribute('stroke', '#00e676'); // vert de base

  textEl.textContent = left;

  timerInterval = setInterval(() => {
    left--;
    textEl.textContent = left > 0 ? left : '0';

    const progress = (total - left) / total;
    circle.setAttribute('stroke-dashoffset', progress * C);

    if (left <= 5)         circle.setAttribute('stroke', 'red');
    else if (left <= 15)   circle.setAttribute('stroke', 'orange');
    else                   circle.setAttribute('stroke', '#00e676');

    if (left <= 0) clearInterval(timerInterval);
  }, 1000);
}

/** Affiche “It’s Your Turn” en préflop */
function updateTurnIndicator(gameState) {
  let tm = document.getElementById("turn-message");
  if (!tm) {
    document.getElementById("top-black-bar").insertAdjacentHTML("beforeend",
      `<div id="turn-message" style="color:white;font-size:20px;padding:5px;"></div>`
    );
    tm = document.getElementById("turn-message");
  }

  if (gameState.phase !== "preflop") {
    tm.textContent = "";
    return;
  }

  const me = gameState.players.findIndex(p => p.id === mySocketId);
  if (
    me === gameState.current_bettor_index &&
    gameState.players[me].bankroll > gameState.players[me].subtotal_bet
  ) {
    tm.textContent = "It's Your Turn";
  } else {
    tm.textContent = "";
  }
}

// ───────────────────────
//  Raise modal & calc
// ───────────────────────
function show_custom_raise() {
  console.log("Raise modal");
  const html = `
    <div id="calc-container" class="calc-horizontal-layout">
      <div class="calc-col calc-col-display">
        <h3 class="calc-title">RAISE CALCULATOR</h3>
        <div id="calc-display" class="calc-display">0</div>
      </div>
      <div class="calc-col calc-col-actions">
        <button class="calc-btn half-btn" onclick="calcAllIn()">ALL-IN</button>
        <button class="calc-btn half-btn" onclick="calcCall()">CALL</button>
      </div>
      <div class="calc-col calc-col-presets">
        <button class="calc-btn third-btn" onclick="calcSetValue(50)">50</button>
        <button class="calc-btn third-btn" onclick="calcSetValue(100)">100</button>
        <button class="calc-btn third-btn" onclick="calcSetValue(200)">200</button>
      </div>
      <div class="calc-col calc-col-digits">
        <div class="calc-digit-grid">
          <button class="calc-btn" onclick="calcAddDigit(7)">7</button>
          <button class="calc-btn" onclick="calcAddDigit(8)">8</button>
          <button class="calc-btn" onclick="calcAddDigit(9)">9</button>
          <button class="calc-btn" onclick="calcAddDigit(4)">4</button>
          <button class="calc-btn" onclick="calcAddDigit(5)">5</button>
          <button class="calc-btn" onclick="calcAddDigit(6)">6</button>
          <button class="calc-btn" onclick="calcAddDigit(1)">1</button>
          <button class="calc-btn" onclick="calcAddDigit(2)">2</button>
          <button class="calc-btn" onclick="calcAddDigit(3)">3</button>
          <button class="calc-btn" onclick="calcAddDigit(0)">0</button>
          <button class="calc-btn" onclick="calcClear()">CLEAR</button>
          <button class="calc-btn" onclick="calcConfirm()">OK</button>
        </div>
      </div>
    </div>
    <div class="calc-row-close">
      <button class="calc-btn calc-close-btn" onclick="calcClose()">Close</button>
    </div>
  `;
  gui_write_modal_box(html);
  const m = document.getElementById("modal-box");
  if (m) { m.style.display = "block"; m.style.bottom = "0"; }
}

function calcAddDigit(d) {
  const disp = document.getElementById("calc-display");
  disp.textContent = disp.textContent === "0" ? "" + d : disp.textContent + d;
}
function calcSetValue(v) {
  document.getElementById("calc-display").textContent = "" + v;
}
function calcClear() {
  document.getElementById("calc-display").textContent = "0";
}
function calcClose() {
  document.getElementById("modal-box").style.display = "none";
}
function calcCall() {
  if (!currentGameState) { calcClose(); return; }
  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  if (meIdx < 0) { calcClose(); return; }
  const me = currentGameState.players[meIdx];
  const toCall = Math.max(0, (currentGameState.current_bet||0) - (me.subtotal_bet||0));
  if (toCall > 0) human_call();
  else human_check();
  calcClose();
}
function calcAllIn() {
  if (!currentGameState) return;
  const me = currentGameState.players.find(p => p.id === mySocketId);
  if (me) socket.emit("playerAction", { type:"raise", amount: me.bankroll });
  calcClose();
}
function calcConfirm() {
  const v = parseInt(document.getElementById("calc-display").textContent, 10) || 0;
  socket.emit("playerAction", { type:"raise", amount: v });
  calcClose();
}

/** Overlay victoire */
function showVictory(name) {
  const ov = document.createElement("div");
  ov.id = "victory-overlay";
  ov.innerHTML = `<div id="victory-text">${name} WIN! 🎉</div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("show"));
}

/** Désactive / réactive Raise */
function disableRaiseButton() {
  const btn = document.getElementById("custom-raise");
  if (!btn) return;
  btn.classList.add("disabled");
  btn.onclick = null;
}
function enableRaiseButton() {
  const btn = document.getElementById("custom-raise");
  if (!btn) return;
  btn.classList.remove("disabled");
  btn.style.display = "inline-block";
  btn.onclick = show_custom_raise;
}

/** Overlay défaite */
function showLosing() {
  if (loserAnnounced) return;
  loserAnnounced = true;

  const winnerMsg = document.getElementById("end-game-message")?.textContent || "";
  const extra = winnerMsg
    ? `<p style="
         font-size:2rem;
         color:white;
         margin-top:2rem;
         text-align:center;
       ">${winnerMsg}</p>`
    : "";

  const ov = document.createElement("div");
  ov.id = "losing-overlay";
  ov.innerHTML = `
    <div id="losing-text">
      <p style="
         font-size:5rem;
         color:#ff9100;
         margin:1rem 0;
         text-align:center;
       ">
        Vous êtes à sec ! Partie terminée.
      </p>
      ${extra}
    </div>
  `;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add("show"));
}