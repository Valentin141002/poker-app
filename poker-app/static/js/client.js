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
let clientRequestedReveal = false;   // évite d’émettre plusieurs fois
let _tableID = null, _match2ID = null; // on mémorise pour l’emit


/** Actions utilisateur */
// === Waiting pill (arcade) — init markup une seule fois ===
document.addEventListener('DOMContentLoaded', () => {
  const wc = document.getElementById('waiting-count');
  if (wc && !wc.dataset.arcadeInit) {
    wc.innerHTML = '<span class="dots">En attente de joueurs :</span> <span id="wc-line">0/0</span><span class="stars"></span>';
    wc.dataset.arcadeInit = '1';
    // Optionnel: s'assurer qu'il est visible quand tu l'utilises
    wc.style.display = 'block';
  }
});

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
  if (!currentGameState) return;

  // montant à payer = current_bet - ce que j'ai déjà mis
  const meIdx  = currentGameState.players.findIndex(p => p.id === mySocketId);
  if (meIdx < 0) return;
  const me     = currentGameState.players[meIdx];
  const toCall = Math.max(0, (currentGameState.current_bet || 0) - (me.subtotal_bet || 0));

  if (toCall > 0) {
    showErrorToast(`Mise en cours : vous devez CALL (${toCall}) ou RAISE.`);
    return; // ⛔️ on n'émet pas de "check"
  }
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
    setupBoardBacks(); // remets les dos au nouveau coup
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
_tableID  = tableID || null;
_match2ID = match2ID || null;


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

  document.addEventListener('keydown', (e) => {
  // ignore si on tape dans un champ
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    human_check(); // déclenche le garde-fou ci-dessus
  }
});

socket.on('endPage', (p) => {
  if (p && p.html) { document.open(); document.write(p.html); document.close(); }
});

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
      name: localStorage.getItem("playername") || "P",
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

  // Affichage du modal d’avertissement
// Au démarrage de votre initGame ou juste après la connexion socket :
socket.on('warningElimination', ({ message }) => {
  // si la modal existe déjà, on ne recrée pas
  if (document.getElementById('warning-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'warning-modal';
  overlay.innerHTML = `
    <div class="warning-content">
      <p>${message}</p>
      <button id="warning-ok">OK</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // fermeture au clic sur OK
  document.getElementById('warning-ok').onclick = () => {
    overlay.remove();
  };
}); 

  // Au démarrage du jeu, après `socket = io();`
socket.on('clearWarningElimination', () => {
  const warn = document.getElementById('elimination-warning');
  if (warn) warn.remove(); 
});

  // On va marquer “justReconnected” à true avant d’émettre joinGame
  socket.on("reconnect", attempt => {
    console.log(`[client] reconnexion #${attempt}`);
    justReconnected = true;
    sendJoin();
  });

// ── 3) Waiting room (arcade) ──
socket.on("updateWaitingRoom", data => {
  const el = document.getElementById("waiting-count");
  if (!el) return;

  const max = data.matchID ? 2 : 10;
  const ratioTxt = `${data.waitingCount}/${max}`;

  // 1) S'assure que le markup arcade est en place (si tu es arrivé ici avant DOMContentLoaded)
  if (!el.dataset.arcadeInit) {
    el.innerHTML = '<span class="dots">En attente de joueurs :</span> <span id="wc-line">0/0</span><span class="stars"></span>';
    el.dataset.arcadeInit = '1';
  }

  // 2) Met à jour le texte (si <span id="wc-line"> existe on l’utilise, sinon fallback)
  const line = el.querySelector('#wc-line');
  if (line) line.textContent = ratioTxt;
  else el.textContent = `En attente de joueurs : ${ratioTxt}`;

  // 3) Met à jour la barre de progression (CSS var --wc-pct)
  const pct = Math.min(100, Math.max(0, (data.waitingCount / max) * 100));
  el.style.setProperty('--wc-pct', pct + '%');

  // 4) (optionnel) garantit la visibilité quand la salle est active
  el.style.display = 'block';
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
    setupBoardBacks(); // 5 dos visibles dès le départ

  
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

const BOARD_IDS = ["flop1","flop2","flop3","turn","river"];
const CARD_BACK_URL = "cardback1.png"; // ← ton dos

function forceShow(el){
  if (!el) return;
  el.style.visibility = "visible";
  el.style.opacity    = "1";
  el.style.display    = el.style.display === "none" ? "" : el.style.display;
}

/** Peint le DOS en background sur un slot du board (id = flop1...river) */
function paintBoardBack(i){
  const slot = document.getElementById(BOARD_IDS[i]);
  if (!slot) return;
  slot.dataset.hasBack = "1";
  // fond dos visible même si l’intérieur est vide
  slot.style.backgroundImage    = `url("${CARD_BACK_URL}")`;
  slot.style.backgroundRepeat   = "no-repeat";
  slot.style.backgroundPosition = "center";
  slot.style.backgroundSize     = "contain";
  // assurer la présence visuelle
  forceShow(slot);
}

/** Pose les 5 dos (préflop) */
function setupBoardBacks(){
  for (let i = 0; i < 5; i++) paintBoardBack(i);
}

/** Nettoie le DOS d’un slot (avant de poser la face) */
function clearBoardBack(i){
  const slot = document.getElementById(BOARD_IDS[i]);
  if (!slot) return;
  delete slot.dataset.hasBack;
  slot.style.backgroundImage = "none";
}

/** Pose/MAJ une face avec un flip doux; enlève le dos au bon moment */
function setBoardFace(i, code, animate = true, delayMs = 0, durMs = 1300){
  const slot = document.getElementById(BOARD_IDS[i]);
  if (!slot || !code) return;

  // si la face est déjà posée, on force juste visible
  const faceKey = `face${i}`;
  if (slot.dataset[faceKey] === code) { forceShow(slot); return; }

  const applyFace = () => {
    // retirer le dos AVANT d’afficher la face
    clearBoardBack(i);

    if (typeof gui_lay_board_card === "function") {
      gui_lay_board_card(i, code);   // ✅ ton rendu habituel
    } else if (typeof internal_setCard === "function") {
      // si tes slots contiennent une .card interne :
      const inner = slot.querySelector('.card') || slot;
      internal_setCard(inner, code, false, true);
    }
    slot.dataset[faceKey] = code;
    forceShow(slot);
  };

  if (!animate) { applyFace(); return; }

  // flip doux (classe CSS ci-dessous)
  slot.style.setProperty('--flip-delay', `${delayMs}ms`);
  slot.style.setProperty('--flip-dur',   `${durMs}ms`);
  slot.classList.add('fy-flip-soft');

  // change la face à mi-parcours
  setTimeout(applyFace, delayMs + Math.floor(durMs / 2));

  const onEnd = () => {
    slot.classList.remove('fy-flip-soft');
    slot.style.removeProperty('--flip-delay');
    slot.style.removeProperty('--flip-dur');
    slot.removeEventListener('animationend', onEnd);
  };
  slot.addEventListener('animationend', onEnd);
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

  
// Après: gui_show_poker_table();
gameState.players.forEach((player, i) => {
  const seatEl = document.getElementById('seat' + i);
  if (!seatEl) return;

  const isBusted = player?.status === 'BUST';          // <-- plus de test sur bankroll
  const isZero   = !isBusted && ((player?.bankroll | 0) <= 0);

  seatEl.classList.toggle('is-bust', isBusted);
  seatEl.classList.toggle('is-zero', isZero);          // optionnel, style léger
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
      displayName = `P${p.seat + 1}`; // générique
    }
  
    // ← ici on passe seatIdx, pas i
    gui_set_player_name(displayName, seatIdx);
    gui_set_bankroll(p.bankroll, seatIdx);

    let betText = "";
    if      (p.status === "FOLD")  betText = "DROPPED";
    else if (p.status === "CHECK") betText = "CHECK";
    else if (p.status === "CALL")  betText = `CALL (${p.subtotal_bet})`;
    else if (p.status === "RAISE") betText = `+ (${p.subtotal_bet})`;
    else if (p.status === "ALLIN") betText = `ALL-IN (${p.subtotal_bet})`;
    else if (p.subtotal_bet > 0)   betText = `${p.subtotal_bet}`;

    gui_set_bet(betText, seatIdx);
    // ─────────────────────────────────────────────
// Déclenchement REVEAL côté serveur si ALL-IN est couvert
// (un joueur ALL-IN et au moins un autre a CALL, en gardant des jetons)
// ─────────────────────────────────────────────
if (!clientRequestedReveal) {
  const players = gameState.players || [];
  const allInIdx = players.findIndex(p =>
    p && (p.status === "ALLIN" || (p.bankroll|0) === 0)
  );

  if (allInIdx >= 0) {
    const currentBet = (gameState.current_bet || 0);

    // appelant qui "couvre" = a fait CALL au niveau du current_bet ET possède encore des jetons (pas all-in)
    const hasCoveringCaller = players.some((p, idx) =>
      idx !== allInIdx &&
      p &&
      p.status === "CALL" &&
      (p.subtotal_bet || 0) >= currentBet &&    // s'est aligné
      (p.bankroll || 0) > 0                     // et il reste du stack
    );

    if (hasCoveringCaller && window.socket) {
      clientRequestedReveal = true;
      socket.emit("clientRequestReveal", {
        reason: "allin_covered",
        table:  _tableID,
        match2: _match2ID
      });
      // Optionnel: log visible
      console.log("[client] clientRequestReveal → allin_covered", { currentBet, allInIdx });
    }
  }
}
  });

  // Pot
  gui_write_basic_general(gameState.pot);

  // Board
  const ids = ["flop1","flop2","flop3","turn","river"];
  ids.forEach(id => {
    const e = document.getElementById(id);
    if (e) e.style.visibility = "hidden";
  });
// === Board (on garde ta logique, on ajoute un flip) ===
// === Board (flip fort + stagger sur le flop) ===
// === Board (flip plus lent et cascade plus marquée) ===
// === Board (dos visibles en préflop → flip vers faces selon la phase) ===
// === Board : dos en préflop, flip vers faces par phase ===
const phase = gameState.phase;

// En préflop → toujours 5 dos visibles
if (phase === "preflop") {
  setupBoardBacks();
}

// FLOP (cascade lente 0 / 300 / 600 ms)
if (["flop","turn","river","reveal"].includes(phase)) {
  setBoardFace(0, gameState.board[0], true,   0, 1600);
  setBoardFace(1, gameState.board[1], true, 300, 1600);
  setBoardFace(2, gameState.board[2], true, 600, 1600);
}
// TURN
if (["turn","river","reveal"].includes(phase)) {
  setBoardFace(3, gameState.board[3], true,   0, 1600);
}
// RIVER
if (["river","reveal"].includes(phase)) {
  setBoardFace(4, gameState.board[4], true,   0, 1600);
}

  // Turn indicator
  updateTurnIndicator(gameState);

  // Highlight actif → on ajoute/enlève une classe, pas de style inline
const activeIdx = gameState.current_bettor_index;
gameState.players.forEach((p, i) => {
// dans ta boucle d'update pour chaque siège i
const seatEl = document.getElementById('seat' + i);
if (seatEl) seatEl.classList.toggle('is-allin-bg', p.status === 'ALLIN');
  const isActive = (i === activeIdx && p.status !== 'BUST');
  seatEl.classList.toggle('turn', isActive);

  // On nettoie toute ancienne coloration inline sur le libellé
  const nameEl = seatEl.querySelector('.player-name');
  if (nameEl) { nameEl.style.backgroundColor = ''; nameEl.style.color = ''; nameEl.style.boxShadow = ''; }
});

// Couleurs selon statut → classes (pas de style inline)
gameState.players.forEach((p, i) => {
  const seatEl = document.getElementById('seat' + i);
  if (!seatEl) return;
  seatEl.classList.remove('status-fold', 'status-bust', 'status-winner');
  if (p.status === 'FOLD')  seatEl.classList.add('status-fold');
  if (p.status === 'BUST')  seatEl.classList.add('status-bust');
  if (p.status === 'WINNER')seatEl.classList.add('status-winner');
});

  // Couleurs selon statut
// --- Turn indicator déjà OK (classe .turn) ---

// --- Statuts en classes (pas de style inline) ---
gameState.players.forEach((p, i) => {
  const seatEl = document.getElementById('seat' + i);
  if (!seatEl) return;

  // tour actif seulement si pas BUST/FOLD
  const isActive = (i === gameState.current_bettor_index && p.status !== 'BUST' && p.status !== 'FOLD');
  seatEl.classList.toggle('turn', isActive);

  // reset classes & inline hérités
  seatEl.classList.remove('status-fold','status-bust','status-winner');
  const nameEl = seatEl.querySelector('.player-name');
  if (nameEl) { nameEl.style.background = ''; nameEl.style.color = ''; nameEl.style.boxShadow = ''; }

  // applique la classe correspondant au statut
  if (p.status === 'FOLD')   seatEl.classList.add('status-fold');
  if (p.status === 'BUST')   seatEl.classList.add('status-bust');
  if (p.status === 'WINNER') seatEl.classList.add('status-winner');
});

  // Fold/Check pour vous
  const myIdx    = gameState.players.findIndex(p=>p.id===mySocketId);
  const mePlayer = gameState.players[myIdx] || {};
const isMyTurn = (
  myIdx === gameState.current_bettor_index &&
  mePlayer.status !== 'BUST' &&
  mePlayer.status !== 'ALLIN'
);
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
  seatEl.classList.remove('winning-hand','losing-hand');
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
// 3) après un délai, on affiche le winner + msg + (on démarre la période de “néon”)
const REVEAL_DELAY = 3000;       // 2s avant d'afficher le gagnant
const REVEAL_NEON_LINGER = 4000; // encore 4s de halo avant le cleanup préflop
     // +4.5s pendant lesquels le néon doit rester

setTimeout(() => {
  if (currentGameState.phase !== 'reveal') return;

  // indices des gagnants (gère ex-aequo)
  const winnerIdx = [];
  currentGameState.players.forEach((p, i) => {
    if (p.status === 'WINNER') winnerIdx.push(i);
  });
  if (!winnerIdx.length) return;

  // message
  const w    = currentGameState.players[winnerIdx[0]];
  const who  = w.id === mySocketId ? 'YOU' : w.label;
  const hand = w.handName || 'a winning hand';
  document.getElementById('end-game-message').textContent =
    `${who} wins the hand with ${hand}!`;

  // marquer les gagnants
  winnerIdx.forEach(i => {
    document.getElementById('seat' + i)?.classList.add('winning-hand');
  });

  // *** marquer les perdants (ceux qui étaient en showdown mais pas gagnants) ***
  currentGameState.players.forEach((p, i) => {
    if (p.inShowdown && !winnerIdx.includes(i)) {
      document.getElementById('seat' + i)?.classList.add('losing-hand');
    }
  });

  // faire durer le néon
  window._neonLingerUntil = Date.now() + 4000;

  // overlay fin de manche (inchangé)
  const survivors = currentGameState.players.filter(p => p.status !== 'BUST');
  if (survivors.length === 1) {
    if (w.id === mySocketId) showVictory(who);
    else                     showLosing();
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
// Reset préflop
if (phase === 'preflop') {
  // si on a montré l’overlay lose juste avant, on a déjà “figé” l’écran (cf. ton return)
  const doClear = () => {
    clientRequestedReveal = false;
    revealedAllSeats = false;
    document.querySelectorAll('.seat').forEach(seatEl => {
      seatEl.classList.remove('winning-hand','losing-hand');
    });
    const endMsg = document.getElementById('end-game-message');
    if (endMsg) endMsg.textContent = '';
    const tm = document.getElementById('turn-message');
    if (tm) tm.textContent = '';
    winnerAnnounced = false;
    loserAnnounced  = false;
    overlayShown    = false;
    document.querySelectorAll('.player-name').forEach(el => { el.style.boxShadow = ''; });
  };

  const wait = Math.max(0, (window._neonLingerUntil || 0) - Date.now());
  if (wait > 0) setTimeout(doClear, wait);
  else          doClear();
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
    <div class="raise-window">
      <div class="raise-head">
        <h3 class="raise-title">RAISE CALCULATOR</h3>
        <button class="calc-btn-x" type="button" title="Fermer" aria-label="Fermer" onclick="calcClose()">×</button>
      </div>

      <div class="raise-body">
        <div id="calc-container" class="calc-horizontal-layout">
          <div class="calc-col calc-col-display">
            <div class="calc-title">MONTANT</div>
            <div id="calc-display" class="calc-display">0</div>
          </div>

<div class="calc-col calc-col-actions">
  <button class="calc-btn btn-check" onclick="calcCheck()">CHECK</button>
  <button class="calc-btn btn-fold"  onclick="calcFold()">FOLD</button>

  <button class="calc-btn half-btn"  onclick="calcAllIn()">ALL-IN</button>
  <button class="calc-btn half-btn"  onclick="calcCall()">CALL</button>
</div>

<div class="calc-col calc-col-presets">
  <div class="chip-grid">
    <button class="chip chip-50"   type="button" onclick="calcAddAmount(50)"><span>50</span></button>
    <button class="chip chip-100"  type="button" onclick="calcAddAmount(100)"><span>100</span></button>
    <button class="chip chip-200"  type="button" onclick="calcAddAmount(200)"><span>200</span></button>
    <button class="chip chip-500"  type="button" onclick="calcAddAmount(500)"><span>500</span></button>
    <button class="chip chip-1000" type="button" onclick="calcAddAmount(1000)"><span>1000</span></button>
    <button class="chip chip-2000" type="button" onclick="calcAddAmount(2000)"><span>2000</span></button>
  </div>
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
              <button class="calc-btn" onclick="calcConfirm()">RAISE</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 1) Injecte la modale
  gui_write_modal_box(html);

  const overlay = document.getElementById('modal-box');
  if (!overlay) return;

  // 2) Thème + affichage centré
  overlay.classList.add('arcade');     // garde ton skin arcade
  overlay.style.display = 'flex';

  // 3) Nettoie tout ancien ancrage "barre du bas"
  ['bottom','left','right','top','transform','width','height'].forEach(p => overlay.style.removeProperty(p));

  // 4) Réglages de taille & typo (→ modifie les 2 constantes au besoin)
  const TARGET_WIDTH_PX = 700;   // ← un peu moins large (ex: 720 / 740 / 780)
  const FONT_BUMP_PX   = 2;      // ← +2 px sur les textes clés (mets 3 si tu veux plus grand)

  const win = overlay.querySelector('.raise-window');
  if (!win) return;

  // Désactiver CHECK s'il y a quelque chose à payer
let canCheck = false;
if (currentGameState) {
  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  if (meIdx >= 0) {
    const me = currentGameState.players[meIdx];
    const toCall = Math.max(0, (currentGameState.current_bet||0) - (me.subtotal_bet||0));
    canCheck = (toCall === 0);
  }
}
const checkBtn = win.querySelector('.btn-check');
if (checkBtn) {
  checkBtn.disabled = !canCheck;
  checkBtn.title = canCheck ? "" : "Check indisponible (mise en cours)";
}

  // largeur réduite
  win.style.width = TARGET_WIDTH_PX + 'px';

  // petit bump de typo (cible les éléments utiles)
  const raiseTitle = win.querySelector('.raise-title');
  if (raiseTitle) raiseTitle.style.fontSize = 'calc(10px + ' + FONT_BUMP_PX + 'px)';
  const calcTitle = win.querySelector('.calc-title');
  if (calcTitle)  calcTitle.style.fontSize  = 'calc(9px  + ' + FONT_BUMP_PX + 'px)';
  const calcDisplay = win.querySelector('.calc-display');
  if (calcDisplay)  calcDisplay.style.fontSize  = 'calc(16px + ' + FONT_BUMP_PX + 'px)';
  win.querySelectorAll('.calc-btn').forEach(b => { b.style.fontSize = 'calc(11px + ' + FONT_BUMP_PX + 'px)'; });

  // 5) Drag & drop (souris + tactile) sur toute la fenêtre sauf éléments interactifs
makeDraggable(win, overlay, win.querySelector('.raise-head'));

  // 6) Fermer sur clic hors fenêtre + ESC
  overlay.onclick = (e) => { if (e.target === overlay) calcClose(); };
  document.addEventListener('keydown', escToCloseOnce);
}

function makeDraggable(win, overlay, handle){
  if (!handle) return;

  win.style.position = 'absolute';

  const centerInOverlay = () => {
    const rO = overlay.getBoundingClientRect();
    const rW = win.getBoundingClientRect();
    win.style.left = Math.max(8, rO.width/2 - rW.width/2) + 'px';
    win.style.top  = Math.max(8, rO.height/2 - rW.height/2) + 'px';
  };
  centerInOverlay();

  handle.style.cursor = 'grab';
  handle.style.touchAction = 'none';

  let dragging = false, startX=0, startY=0, startLeft=0, startTop=0, pointerId=null;

  // ✅ tout élément bouton/contrôle (y compris la croix et les chips)
  const isInteractive = (el) =>
    !!(el && el.closest('button, [role="button"], input, select, textarea, a, .chip'));

  const onPointerDown = (e) => {
    // ⛔️ ne pas démarrer un drag si on clique sur un bouton (ex: la croix)
    if (isInteractive(e.target)) return;

    dragging = true;
    pointerId = e.pointerId;
    handle.setPointerCapture(pointerId);

    const r = win.getBoundingClientRect();
    const rO = overlay.getBoundingClientRect();
    startLeft = r.left - rO.left;
    startTop  = r.top  - rO.top;
    startX = e.clientX;
    startY = e.clientY;

    handle.style.cursor = 'grabbing';
    e.preventDefault(); // ok ici, on n’a pas cliqué un bouton
  };

  const onPointerMove = (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const box = overlay.getBoundingClientRect();
    const w   = win.getBoundingClientRect();

    let newLeft = startLeft + dx;
    let newTop  = startTop  + dy;
    const pad = 8;
    newLeft = Math.min(Math.max(newLeft, pad), Math.max(pad, box.width  - w.width  - pad));
    newTop  = Math.min(Math.max(newTop,  pad), Math.max(pad, box.height - w.height - pad));
    win.style.left = newLeft + 'px';
    win.style.top  = newTop  + 'px';
  };

  const onPointerUp = () => {
    if (pointerId !== null) { try { handle.releasePointerCapture(pointerId); } catch(_){} }
    dragging = false; pointerId = null;
    handle.style.cursor = 'grab';
  };

  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerUp);

  window.addEventListener('resize', () => {
    const box = overlay.getBoundingClientRect();
    const w = win.getBoundingClientRect();
    let left = parseFloat(win.style.left || '0');
    let top  = parseFloat(win.style.top  || '0');
    left = Math.min(left, Math.max(8, box.width  - w.width  - 8));
    top  = Math.min(top,  Math.max(8, box.height - w.height - 8));
    win.style.left = Math.max(left, 8) + 'px';
    win.style.top  = Math.max(top,  8) + 'px';
  });
}

function escToCloseOnce(ev){
  if (ev.key === 'Escape') {
    document.removeEventListener('keydown', escToCloseOnce);
    calcClose();
  }
}

function calcFold(){
  // utilise tes handlers natifs si présents, sinon émet direct
  if (typeof human_fold === 'function') {
    human_fold();
  } else if (window.socket) {
    socket.emit("playerAction", { type: "fold" });
  }
  calcClose();
}

function calcCheck(){
  // Check UNIQUEMENT si rien à payer
  if (!currentGameState) { calcClose(); return; }
  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  const me    = meIdx >= 0 ? currentGameState.players[meIdx] : null;
  const toCall = me ? Math.max(0, (currentGameState.current_bet||0) - (me.subtotal_bet||0)) : 0;

  if (toCall > 0) {
    alert("Check indisponible : une mise est en cours, vous devez au moins payer.");
    return; // on ne ferme pas la fenêtre pour que le joueur choisisse CALL/RAISE/FOLD
  }

  if (typeof human_check === 'function') {
    human_check();
  } else if (window.socket) {
    socket.emit("playerAction", { type: "check" });
  }
  calcClose();
}

function getCalcVal(){
  const el = document.getElementById('calc-display');
  if (!el) return 0;
  const n = parseInt((el.textContent || el.innerText || '0').replace(/[^\d]/g,''), 10);
  return isNaN(n) ? 0 : n;
}
function setCalcVal(v){
  const el = document.getElementById('calc-display');
  if (el) el.textContent = String(Math.max(0, Math.floor(v||0)));
}
function calcAddAmount(n){
  setCalcVal(getCalcVal() + Number(n||0));
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

/* === Close (nettoyage propre) === */
function calcClose(){
  const overlay = document.getElementById('modal-box');
  if (!overlay) return;
  overlay.style.display = 'none';
  overlay.innerHTML = '';
  overlay.onclick = null;
  overlay.classList.remove('arcade', 'wide'); // au cas où
  document.removeEventListener('keydown', escToCloseOnce);
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
  // 1) Lis le montant tapé
  const input = parseInt(
    document.getElementById("calc-display").textContent,
    10
  );
  if (!input || input <= 0) {
    return alert("Entrez un montant de mise supérieur à 0 !");
  }

  // 2) Émets directement un vrai RAISE sur ce montant
  console.log("[client] → RAISE", input);
  socket.emit("playerAction", {
    type:   "raise",
    amount: input
  });

  // 3) Ferme la modale
  calcClose();
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

/** Overlay ARCADE — commun */
function makeArcadeOverlay(kind, html) {
  // nettoie un ancien overlay éventuel
  const old1 = document.getElementById('victory-overlay');
  const old2 = document.getElementById('losing-overlay');
  old1?.remove(); old2?.remove();

  const ov = document.createElement('div');
  ov.id  = kind === 'win' ? 'victory-overlay' : 'losing-overlay';
  ov.className = 'arcade-overlay ' + (kind === 'win' ? 'win' : 'lose');
  ov.innerHTML = `
    <div class="ao-bg"></div>
    <div class="ao-card">
      <div class="ao-head">
        <h1 class="ao-title">${kind === 'win' ? 'YOU WIN!' : 'GAME OVER'}</h1>
        <button class="ao-x" aria-label="Fermer" onclick="this.closest('.arcade-overlay').remove()">×</button>
      </div>
      <div class="ao-body">${html}</div>
      <div class="ao-confetti" aria-hidden="true"></div>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));

  // === FX dynamiques pour le banner ===
initEndBannerFX(ov, { kind, autoCloseSec: 0 }); // mets 3..5 pour activer l'autoclose


  // confettis si win
  if (kind === 'win') {
    const box = ov.querySelector('.ao-confetti');
    const colors = ['#48d2ff','#7e59ff','#ffd447','#2bd38a','#ff6e5b'];
    for (let i=0;i<36;i++){
      const s = 8 + Math.random()*8;
      const el = document.createElement('i');
      el.style.cssText = `
        position:absolute; width:${s}px; height:${s*1.4}px; border-radius:2px;
        left:${(Math.random()*96+2)}%; top:-10vh; background:${colors[i%colors.length]};
        animation: ao-fall 1.6s ease-out ${Math.random()*0.6}s forwards`;
      box.appendChild(el);
    }
  }
}

/** Overlay victoire (remplace l’ancienne) */
function showVictory(name) {
  // ancien appel passait "YOU" ou le label — on compose le sous-titre
  const sub = `<p class="ao-sub">🎉 ${name} wins the hand! 🎉</p>`;
  makeArcadeOverlay('win', sub);
}

/** Overlay défaite (remplace l’ancienne) */
function showLosing() {
  if (typeof loserAnnounced !== 'undefined' && loserAnnounced) return;
  if (typeof loserAnnounced !== 'undefined') loserAnnounced = true;

  const winnerMsg = document.getElementById('end-game-message')?.textContent || '';
  const html = `
    <p class="ao-sub lose-main">Vous êtes à sec ! Partie terminée.</p>
    ${winnerMsg ? `<p class="ao-sub extra">${winnerMsg}</p>` : ''}`;
  makeArcadeOverlay('lose', html);
}

// add right after you append the overlay in makeArcadeOverlay(...)
if (kind === 'win') {
  const fx = ov.querySelector('.ao-confetti');
  fx.innerHTML = '';

  // 1) confetti (keep your current loop if you prefer)
  const colors = ['#48d2ff','#7e59ff','#ffd447','#2bd38a','#ff6e5b'];
  for (let i=0;i<28;i++){
    const s = 8 + Math.random()*8;
    const el = document.createElement('i');
    el.style.cssText = `
      position:absolute;width:${s}px;height:${s*1.4}px;border-radius:2px;
      left:${(Math.random()*96+2)}%; top:-10vh; background:${colors[i%colors.length]};
      animation: ao-fall 1.6s ease-out ${Math.random()*0.6}s forwards`;
    fx.appendChild(el);
  }

  // 2) chips burst
  const chipClasses = ['chip-50','chip-100','chip-200','chip-500','chip-1000'];
  for (let j=0;j<16;j++){
    const c = document.createElement('div');
    c.className = `chip-fx ${chipClasses[j % chipClasses.length]}`;
    c.style.left = (Math.random()*90 + 5) + '%';
    c.style.top  = '-8vh';
    c.style.animationDelay = (Math.random()*0.5 + 0.05) + 's';
    const inner = document.createElement('span'); c.appendChild(inner);
    fx.appendChild(c);
  }
}

function syncNonMySeatCardSize(){
  const table = document.querySelector('#poker_table, .poker-table');
  const ref = document.querySelector('#flop1, #board .boardcard, .board .card');
  if (!table || !ref) return;
  const r = ref.getBoundingClientRect();
  table.style.setProperty('--board-card-w', Math.round(r.width) + 'px');
  table.style.setProperty('--board-card-h', Math.round(r.height) + 'px');
}
window.addEventListener('load', syncNonMySeatCardSize);
window.addEventListener('resize', syncNonMySeatCardSize);
// appelle aussi cette fonction juste après le reveal du board


function showErrorToast(msg){
  let t = document.getElementById('toast');
  if (!t){
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(()=> t.classList.remove('show'), 2200);
}
