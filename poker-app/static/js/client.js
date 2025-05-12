// client.js
"use strict";

let socket; 
let myCardsRevealed = false,
    mySocketId = "", 
    mySeatIndex = null,
    revealedAllSeats = false, 
    currentGameState = null,
    lastPhase = null;   // ← pour détecter le passage reveal→preflop
let winnerAnnounced = false;  // empêche de ré-afficher plusieurs fois
let loserAnnounced = false;  // empêche de ré-afficher plusieurs fois

/** Actions utilisateur */
function human_fold()  { console.log("[client] Fold"); socket.emit("playerAction", { type: "fold"  }); }
function human_call()  {
  console.log("[client] Call");
  if (!currentGameState) return;
  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  if (meIdx < 0) return;
  const me = currentGameState.players[meIdx];
  const toCall = Math.max(0, (currentGameState.current_bet||0) - (me.subtotal_bet||0));
  socket.emit("playerAction", { type: "call", amount: toCall });
}
function human_check() { console.log("[client] Check"); socket.emit("playerAction", { type: "check" }); }

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
  if (fold) { fold.classList.remove("disabled"); internal_clickin_helper(fold, foldText, foldFunc); }
  if (call) { call.classList.remove("disabled"); internal_clickin_helper(call, callText, callFunc); }
}

function animateMyCards() {
  if (mySeatIndex === null) return;
  const mySeatEl = document.getElementById("seat" + mySeatIndex);
  if (!mySeatEl) return;

  const [c1, c2] = Array.from(mySeatEl.querySelectorAll(".holecards .card"));

  // 1) Fade-in du back
  [c1, c2].forEach(card => {
    // nettoie tout flip précédent
    card.style.transition = "";
    card.style.transform  = "";
    card.classList.remove("revealed", "visible");
    internal_setCard(card, "blinded", false, true);
    requestAnimationFrame(() => card.classList.add("visible"));
  });

  // 2) Après 5 secondes → flip propre
  setTimeout(() => {
    const me = currentGameState.players[mySeatIndex];
    if (!me) return;
    flipCardsSimultaneously(c1, c2, me.carda, me.cardb);
    myCardsRevealed = true;
  }, 5000);
}

/** Initialise la connexion et les handlers */
function initGame() {
  console.log("[client] initGame()");
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

  socket.on("connect", () => {
    mySocketId = socket.id;
    console.log("[client] connecté, id =", mySocketId);
    const name = localStorage.getItem("playername") || "Player";

    // On lit à la fois "table" et "match2" dans l'URL
    const params   = new URLSearchParams(window.location.search);
    const tableID  = params.get("table");
    const match2ID = params.get("match2");

    if (tableID) {
      socket.emit("joinGame", { name, table: tableID });
    } else if (match2ID) {
      // pour l’instant on ré-utilise le même événement joinGame : 
      // le serveur distinguera tablesConfig vs matches2Config
      socket.emit("joinGame", { name, table: match2ID });
    } else {
      alert("Aucun tableID ni match2ID fourni dans l'URL !");
      return;
    }
  });

  socket.on("updateWaitingRoom", data => {
    document.getElementById("waiting-count").textContent = data.waitingCount;
  });

  socket.on("startGame", data => {
    console.log("[client] startGame →", data.message);

    // 1) On enlève l'écran de chargement et on affiche la table
    document.getElementById("loading-screen")?.remove();
    gui_show_poker_table();

    // 2) On stocke l’état initial et notre index de siège
    currentGameState = data.gameState;
    mySeatIndex     = currentGameState.players.findIndex(p => p.id === mySocketId);

    // 2bis) On marque notre siège pour le CSS “bottom-left”
    const mySeatEl = document.getElementById("seat" + mySeatIndex);
    if (mySeatEl) mySeatEl.classList.add("my-seat");

    // 3) On expose pour gui_if.js
    window.gameState      = currentGameState;
    window.gameStatePhase = currentGameState.phase;

    // 4) On dessine l’UI initiale
    updateInterface(currentGameState);

    // 5) On force l’indicateur de tour dès le départ
    requestAnimationFrame(() => {
      updateTurnIndicator(currentGameState);
    });

    // 6) On lance l’animation de TA main
    animateMyCards();
  });

  socket.on("updateTable", data => {
    // 1) Mets à jour le reste de ton interface
    updateInterface(data);

    // 2) Affiche les blinds
    const sbEl = document.getElementById("small-blind");
    const bbEl = document.getElementById("big-blind");
    if (sbEl) sbEl.textContent = `SB: ${data.smallBlind}`;
    if (bbEl) bbEl.textContent = `BB: ${data.bigBlind}`;

    // 3) Réinitialisation des cartes quand on repasse de 'reveal' à 'preflop'
    if (lastPhase === "reveal" && data.phase === "preflop") {
      data.players.forEach((_, seatIdx) => {
        const seatEl = document.getElementById("seat" + seatIdx);
        if (!seatEl) return;
        seatEl.querySelectorAll(".holecards .card").forEach(card => {
          // On retire les animations de révélation
          card.style.transition = "";
          card.style.transform  = "";
          card.classList.remove("revealed", "visible");
          // On remet la carte face cachée
          internal_setCard(card, "blinded", false, true);
          // On relance l’animation d’apparition
          requestAnimationFrame(() => card.classList.add("visible"));
        });
      });

      // Relance l’animation de ta main
      myCardsRevealed = false;
      animateMyCards();
    }

    // 4) Sauvegarde la phase courante
    lastPhase = data.phase;

    if (data.mode === "hyper") {
      // – masque le bouton Dealer (utilise ton helper existant)
      gui_hide_dealer_button();
  
      // – masque “It’s your turn”
      const tm = document.getElementById("turn-message");
      if (tm) tm.textContent = "";
  
      // – retire la surbrillance du joueur actif
      document.querySelectorAll(".player-name").forEach(el => {
        el.style.backgroundColor = "";
        el.style.color           = "";
        el.style.boxShadow       = "";
      });
    }

  });

  // Liaison du bouton Raise
  const raiseBtn = document.getElementById("raise-button");
  if (raiseBtn) {
    raiseBtn.addEventListener("click", show_custom_raise);
  }
}

window.initGame = initGame;
function startGameHandler(data) {
  // … ton code existant …
  updateInterface(data.gameState);
  animateMyCards();
  lastPhase = data.gameState.phase;
}

socket.on("startGame", startGameHandler);

function resetAllBacks() {
  currentGameState.players.forEach((_, seatIdx) => {
    const seatEl = document.getElementById("seat" + seatIdx);
    if (!seatEl) return;
    seatEl.querySelectorAll(".holecards .card").forEach(card => {
      card.style.transition = "";
      card.style.transform  = "";
      card.classList.remove("revealed","visible");
      internal_setCard(card, "blinded", false, true);
      requestAnimationFrame(() => card.classList.add("visible"));
    });
  });
}

/** Met à jour toute l’UI */
function updateInterface(gameState) {
  window.gameState      = gameState;
  window.gameStatePhase = gameState.phase;
  currentGameState      = gameState;

  gui_show_poker_table();

  // 0bis) dealer only if active
  if (typeof gameState.dealerIndex === 'number'
      && gameState.players[gameState.dealerIndex].status !== 'BUST') {
    gui_place_dealer_button(gameState.dealerIndex);
  } else {
    gui_hide_dealer_button();
  }

  // 0) hide BUST players' cards outside reveal
  gameState.players.forEach((p, idx) => {
    if (p.status === 'BUST' && gameState.phase !== 'reveal') {
      gui_set_player_cards("", "", idx, false);
    }
  });

  // **on n’efface plus toutes les cartes ici !**

  // 1) noms, bankrolls & mises
  gameState.players.forEach((p, seatIdx) => {
    const isMe = p.id === mySocketId;
    gui_set_player_name(isMe ? "YOU" : p.label, seatIdx);
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

  // 2) pot
  gui_write_basic_general(gameState.pot);

  // 3) board
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

  // 4) “It’s Your Turn” s’affiche UNIQUEMENT en préflop
  updateTurnIndicator(gameState);

  // 5) highlight joueur actif (skip BUST)
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

  // 6) couleurs selon statut
  gameState.players.forEach((p,i) => {
    const el = document.querySelector(`#seat${i} .player-name`);
    if (!el) return;
    if (p.status==='FOLD')        { el.style.backgroundColor='gray';  el.style.color='black'; }
    else if (p.status==='BUST')   { el.style.backgroundColor='black'; el.style.color='white'; }
    else if (p.status==='WINNER') { el.style.backgroundColor='yellow';el.style.color='black'; el.style.boxShadow='0 0 8px yellow'; }
  });

  // 7) Fold/Check
  const myIdx    = gameState.players.findIndex(p=>p.id===mySocketId);
  const mePlayer = gameState.players[myIdx] || {};
  const isMyTurn = myIdx === gameState.current_bettor_index
                   && mePlayer.status !== 'BUST';
  if (isMyTurn) {
    gui_setup_fold_call_click(
      `<font color=red><u>F</u>old</font>`,
      `<font color=orange></font>`,
      human_fold, human_check
    );
  } else {
    gui_hide_fold_call_click();
  }

  // 8) Raise
  if (isMyTurn) enableRaiseButton();
  else           disableRaiseButton();

// 9) Reveal final : flip + fade, puis +5s pour win/lose
if (phase === 'reveal' && !revealedAllSeats) {
  // 9a) On enlève toute ancienne lueur
  document.querySelectorAll('.seat').forEach(seatEl => {
    seatEl.classList.remove('winning-hand');
  });

  // 9b) Flip + pose des cartes pour chaque joueur ENCORE en lice
  gameState.players.forEach((p, i) => {
    if (p.status === 'FOLD') return;
    const seat = document.getElementById('seat' + i);
    if (!seat) return;
    const c1 = seat.querySelector('.holecard1');
    const c2 = seat.querySelector('.holecard2');
    if (c1 && c2) {
      flipCardsSimultaneously(c1, c2, p.carda, p.cardb);
      setTimeout(() => {
        gui_set_player_cards(p.carda, p.cardb, i, false);
      }, 600);
    }
  });

  // 9c) Glow jaune autour du/des gagnant(s)
  const winners = gameState.players.filter(p => p.status === 'WINNER');
  winners.forEach(w => {
    const idx = gameState.players.indexOf(w);
    const seatEl = document.getElementById('seat' + idx);
    if (seatEl) seatEl.classList.add('winning-hand');
  });


  // 9d) Après 5 s, affiche overlay Victoire ou Défaite UNIQUEMENT pour toi
// … dans updateInterface, section 9d …
const me = gameState.players.find(p => p.id === mySocketId);
if (me) {
  setTimeout(() => {
    if (me.status === 'WINNER') {
      // (inchangé) overlay victoire pour toi
      const hand = me.handName || 'a winning hand';
      document.getElementById('end-game-message').textContent =
        `YOU wins the hand with ${hand}!`;
      showVictory('YOU');
    }
    else if (me.status === 'BUST') {
      // on détermine le gagnant et sa main
      const [champ] = gameState.players.filter(p => p.status === 'WINNER');
      if (champ) {
        const name = champ.id === mySocketId ? 'YOU' : champ.label;
        const hand = champ.handName || 'a winning hand';
        document.getElementById('end-game-message').textContent =
          `${name} wins with ${hand}!`;
      }
      // puis on affiche l’overlay défaite qui lira ce message
      showLosing();
    }
  }, 10000);
}
  revealedAllSeats = true;
}

  // 10) Reset préflop : on retire la lueur et le message
  if (phase === 'preflop') {
    revealedAllSeats = false;
    // retire lueur de tous les sièges
    document.querySelectorAll('.seat').forEach(seatEl => {
      seatEl.classList.remove('winning-hand');
    });
    // vide la barre du haut
    const endMsg = document.getElementById('end-game-message');
    if (endMsg) endMsg.textContent = '';
    winnerAnnounced = false;
    // enlève box-shadow des pseudos
    document.querySelectorAll('.player-name').forEach(el => {
      el.style.boxShadow = '';
    });
  }

}

function updateTurnIndicator(gameState) {
  let tm = document.getElementById("turn-message");
  if (!tm) {
    document.getElementById("top-black-bar").insertAdjacentHTML("beforeend",
      `<div id="turn-message" style="color:white;font-size:20px;padding:5px;"></div>`
    );
    tm = document.getElementById("turn-message");
  }

  // **1) On cache totalement hors de la phase “preflop”**
  if (gameState.phase !== "preflop") {
    tm.textContent = "";
    return;
  }

  // **2) Sinon, on affiche “It’s Your Turn” si c’est vraiment à toi**
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
// 8) Raise modal + calc…
// ───────────────────────
function show_custom_raise() {
  console.log("Raise modal");
  var html = `
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
  var m = document.getElementById("modal-box");
  if (m) { m.style.display="block"; m.style.bottom="0"; }
}

function calcAddDigit(d) {
  var disp = document.getElementById("calc-display");
  disp.textContent = disp.textContent==="0" ? ""+d : disp.textContent + d;
}
function calcSetValue(v) {
  document.getElementById("calc-display").textContent = ""+v;
}
function calcClear() {
  document.getElementById("calc-display").textContent = "0";
}
function calcClose() {
  document.getElementById("modal-box").style.display = "none";
}
function calcCall() {
  if (!currentGameState) {
    calcClose();
    return;
  }
  // Trouve ton index et ton joueur
  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  if (meIdx < 0) {
    calcClose();
    return;
  }
  const me = currentGameState.players[meIdx];
  // Calcule le montant à suivre
  const toCall = Math.max(0, (currentGameState.current_bet || 0) - (me.subtotal_bet || 0));

  if (toCall > 0) {
    // S’il y a vraiment un montant à suivre → call
    human_call();
  } else {
    // Sinon, on passe à check
    human_check();
  }

  calcClose();
}
function calcAllIn() { 
  if (!currentGameState) return;
  var me = currentGameState.players.find(p=>p.id===mySocketId);
  if (me) socket.emit("playerAction",{ type:"raise", amount: me.bankroll });
  calcClose();
}
function calcConfirm() {
  var v = parseInt(document.getElementById("calc-display").textContent,10)||0;
  socket.emit("playerAction",{ type:"raise", amount: v });
  calcClose();
}

/**
 * Affiche un overlay full‐screen animé pour célébrer la victoire.
 * @param {string} name Le nom du gagnant ("YOU" ou "Player X")
 */
function showVictory(name) {
  // 1) Crée l’overlay
  const ov = document.createElement("div");
  ov.id = "victory-overlay";
  ov.innerHTML = `<div id="victory-text">${name} WIN! 🎉</div>`;
  document.body.appendChild(ov);

  // 2) Anime l’apparition
  requestAnimationFrame(() => ov.classList.add("show"));
}

/** Désactive et grise le bouton Raise (custom-raise) */
function disableRaiseButton() {
  const btn = document.getElementById("custom-raise");
  if (!btn) return;
  btn.classList.add("disabled");
  btn.onclick = null;
}

/** Réactive et remonte le bouton Raise (custom-raise) */
function enableRaiseButton() {
  const btn = document.getElementById("custom-raise");
  if (!btn) return;
  btn.classList.remove("disabled");
  btn.style.display = "inline-block";
  btn.onclick = show_custom_raise;
}

function showLosing() {
  if (loserAnnounced) return;
  loserAnnounced = true;

  // Récupère le message du haut ("XXX wins with YYY!")
  const winnerMsg = document.getElementById("end-game-message")?.textContent || "";

  // Crée l’overlay complet
  const ov = document.createElement("div");
  ov.id = "losing-overlay";
  ov.innerHTML = `
    <div id="losing-text">
      <p style="
         font-size: 5rem;
         color: #ff9100;
         margin: 1rem 0;
         text-align: center;
       ">
        Vous êtes à sec ! Partie terminée.
      </p>
      ${ winnerMsg
         ? `<p style="
              font-size: 2rem;
              color: white;
              margin-top: 2rem;
              text-align: center;
            ">
              ${winnerMsg}
            </p>`
         : ``
      }
    </div>
  `;
  document.body.appendChild(ov);

  // Déclenche le fade‐in
  requestAnimationFrame(() => ov.classList.add("show"));
}
