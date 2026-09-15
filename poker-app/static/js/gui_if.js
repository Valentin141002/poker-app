"use strict";

//  --- Not in the interface ---

function gui_get_theme_mode_highlite_color() {
  // Retourne une couleur par défaut pour le surlignage (par exemple "yellow")
  return "blue";
}

function internal_get_a_class_named(curr, searched_name) {
  if (!curr) {
    gui_log_to_history("internal_get_a_class_named, no curr for " + searched_name);
  }
  var notes = null;
  for (var i = 0; i < curr.childNodes.length; i++) {
    if (curr.childNodes[i].className === searched_name) {
      notes = curr.childNodes[i];
      break;
    }
  }
  return notes;
}

function internal_FixTheRanking(rank) {
  var ret_rank = 'NoRank';
  if (rank === 14) {
    ret_rank = 'ace';
  } else if (rank === 13) {
    ret_rank = 'king';
  } else if (rank === 12) {
    ret_rank = 'queen';
  } else if (rank === 11) {
    ret_rank = 'jack';
  } else if (rank > 0 && rank < 11) {
    // Normal card 1 - 10
    ret_rank = rank;
  } else {
    console.log(typeof rank);
    alert('Unknown rank ' + rank);
  }
  return ret_rank;
}

function internal_FixTheSuiting(suit) {
  if (suit === 'c') {
    suit = 'clubs';
  } else if (suit === 'd') {
    suit = 'diamonds';
  } else if (suit === 'h') {
    suit = 'hearts';
  } else if (suit === 's') {
    suit = 'spades';
  } else {
    alert('Unknown suit ' + suit);
    suit = 'yourself';
  }
  return suit;
}

function internal_IsFruityCardThemeActive() {
  return !!document.body?.classList.contains('tier-fruity-bg');
}

function internal_GetDisplayRank(rank) {
  if (rank === 'ace') return 'A';
  if (rank === 'king') return 'K';
  if (rank === 'queen') return 'Q';
  if (rank === 'jack') return 'J';
  if (String(rank) === '10') return 'T';
  return String(rank).toUpperCase();
}

function internal_GetRankValue(rank) {
  if (rank === 'ace') return 1;
  if (rank === 'jack') return 11;
  if (rank === 'queen') return 12;
  if (rank === 'king') return 13;
  return Number(rank) || 0;
}

function internal_GetFruitSuitPalette(suit) {
  if (suit === 'hearts') {
    return { rank: '#d96b43', border: '#1d1d1d', tint: '#fffdfa', shadow: '#f6d0b2' };
  }
  if (suit === 'diamonds') {
    return { rank: '#d63f50', border: '#1d1d1d', tint: '#fffdfd', shadow: '#f6c5cc' };
  }
  if (suit === 'clubs') {
    return { rank: '#2f984a', border: '#1d1d1d', tint: '#fcfffc', shadow: '#d0edcf' };
  }
  return { rank: '#5c7147', border: '#1d1d1d', tint: '#fcfdf9', shadow: '#d7e6ca' };
}

function internal_GetFruitSuitAssetPath(suit) {
  const relPathBySuit = {
    hearts: 'static/images/fruitcoeur.png',
    diamonds: 'static/images/fruitcarreau.png',
    clubs: 'static/images/fruittr%C3%A8fle.png',
    spades: 'static/images/fruitpique.png'
  };
  const relPath = relPathBySuit[suit] || relPathBySuit.spades;
  return `${window.location.origin}/${relPath}`;
}

const internal_FruitySuitAssetsPreloaded = new Set();

function internal_PreloadFruitySuitAssets() {
  ['hearts', 'diamonds', 'clubs', 'spades'].forEach((suit) => {
    const src = internal_GetFruitSuitAssetPath(suit);
    if (!src || internal_FruitySuitAssetsPreloaded.has(src)) return;
    internal_FruitySuitAssetsPreloaded.add(src);
    const img = new Image();
    img.decoding = 'async';
    img.loading = 'eager';
    img.src = src;
  });
}

function internal_GetFruitPipLayout(rankValue) {
  const layouts = {
    1: [{ x: 0, y: 0, s: 1.22 }],
    2: [{ x: 0, y: -138, s: 0.92 }, { x: 0, y: 138, s: 0.92, r: 180 }],
    3: [{ x: 0, y: -150, s: 0.88 }, { x: 0, y: 0, s: 0.96 }, { x: 0, y: 150, s: 0.88, r: 180 }],
    4: [{ x: -96, y: -132, s: 0.84 }, { x: 96, y: -132, s: 0.84 }, { x: -96, y: 132, s: 0.84, r: 180 }, { x: 96, y: 132, s: 0.84, r: 180 }],
    5: [{ x: -96, y: -132, s: 0.8 }, { x: 96, y: -132, s: 0.8 }, { x: 0, y: 0, s: 0.9 }, { x: -96, y: 132, s: 0.8, r: 180 }, { x: 96, y: 132, s: 0.8, r: 180 }],
    6: [{ x: -96, y: -152, s: 0.76 }, { x: 96, y: -152, s: 0.76 }, { x: -96, y: 0, s: 0.76 }, { x: 96, y: 0, s: 0.76 }, { x: -96, y: 152, s: 0.76, r: 180 }, { x: 96, y: 152, s: 0.76, r: 180 }],
    7: [{ x: -96, y: -152, s: 0.72 }, { x: 96, y: -152, s: 0.72 }, { x: 0, y: -70, s: 0.72 }, { x: -96, y: 0, s: 0.72 }, { x: 96, y: 0, s: 0.72 }, { x: -96, y: 152, s: 0.72, r: 180 }, { x: 96, y: 152, s: 0.72, r: 180 }],
    8: [{ x: -96, y: -154, s: 0.68 }, { x: 96, y: -154, s: 0.68 }, { x: 0, y: -84, s: 0.68 }, { x: -96, y: 0, s: 0.68 }, { x: 96, y: 0, s: 0.68 }, { x: 0, y: 84, s: 0.68, r: 180 }, { x: -96, y: 154, s: 0.68, r: 180 }, { x: 96, y: 154, s: 0.68, r: 180 }],
    9: [{ x: -96, y: -160, s: 0.64 }, { x: 96, y: -160, s: 0.64 }, { x: 0, y: -100, s: 0.64 }, { x: -96, y: -28, s: 0.64 }, { x: 96, y: -28, s: 0.64 }, { x: 0, y: 52, s: 0.64, r: 180 }, { x: -96, y: 160, s: 0.64, r: 180 }, { x: 96, y: 160, s: 0.64, r: 180 }, { x: 0, y: 126, s: 0.64, r: 180 }],
    10: [{ x: -96, y: -164, s: 0.6 }, { x: 96, y: -164, s: 0.6 }, { x: 0, y: -110, s: 0.6 }, { x: -96, y: -40, s: 0.6 }, { x: 96, y: -40, s: 0.6 }, { x: -96, y: 40, s: 0.6, r: 180 }, { x: 96, y: 40, s: 0.6, r: 180 }, { x: 0, y: 110, s: 0.6, r: 180 }, { x: -96, y: 164, s: 0.6, r: 180 }, { x: 96, y: 164, s: 0.6, r: 180 }]
  };
  return layouts[rankValue] || layouts[1];
}

function internal_BuildFruityCardBaseSvg(palette, rankLabel) {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 605 725">
      <defs>
        <linearGradient id="cardBg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#ffffff"/>
          <stop offset="100%" stop-color="${palette.tint}"/>
        </linearGradient>
        <radialGradient id="glow" cx="50%" cy="44%" r="54%">
          <stop offset="0%" stop-color="${palette.shadow}" stop-opacity=".35"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <rect x="10" y="10" width="585" height="705" rx="34" fill="url(#cardBg)" stroke="${palette.border}" stroke-width="10"/>
      <rect x="22" y="22" width="561" height="681" rx="28" fill="none" stroke="#ffffff" stroke-opacity=".65" stroke-width="2"/>
      <circle cx="302.5" cy="362" r="206" fill="url(#glow)"/>
    </svg>
  `;
  return `url("data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}")`;
}

function internal_BuildFruityCardFaceStyle(suit, rank, compact = false) {
  internal_PreloadFruitySuitAssets();
  const palette = internal_GetFruitSuitPalette(suit);
  const rankLabel = internal_GetDisplayRank(rank);
  const assetHref = `url("${internal_GetFruitSuitAssetPath(suit)}")`;
  const smallRankSize = compact ? '34' : '62';
  const bigRankSize = compact ? '142' : '270';
  const smallRankX = compact ? '118' : '106';
  const smallRankY = compact ? '122' : '122';
  const bigRankY = compact ? '392' : '458';
  const textSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 605 725">
      <g font-family="Arial Black, Trebuchet MS, Arial, sans-serif" font-weight="900" text-anchor="middle" dominant-baseline="middle">
        <text x="${smallRankX}" y="${smallRankY}" fill="#ffffff" stroke="${palette.rank}" stroke-width="${compact ? '8' : '10'}" paint-order="stroke fill" font-size="${smallRankSize}">${rankLabel}</text>
        <text x="302.5" y="${bigRankY}" fill="#ffffff" stroke="${palette.rank}" stroke-width="${compact ? '14' : '22'}" paint-order="stroke fill" font-size="${bigRankSize}">${rankLabel}</text>
      </g>
    </svg>
  `;
  const textLayer = `url("data:image/svg+xml;charset=UTF-8,${encodeURIComponent(textSvg)}")`;
  const images = [textLayer, assetHref, textLayer, assetHref, internal_BuildFruityCardBaseSvg(palette, rankLabel)];
  const sizes = compact
    ? ['100% 100%', '40px 40px', '100% 100%', '132px 132px', '100% 100%']
    : ['100% 100%', '78px 78px', '100% 100%', '300px 300px', '100% 100%'];
  const positions = compact
    ? ['center center', '46px 60px', 'center center', 'center 72%', 'center center']
    : ['center center', '58px 88px', 'center center', 'center calc(50% + 32px)', 'center center'];
  const repeats = ['no-repeat', 'no-repeat', 'no-repeat', 'no-repeat', 'no-repeat'];

  return {
    backgroundImage: images.join(', '),
    backgroundSize: sizes.join(', '),
    backgroundPosition: positions.join(', '),
    backgroundRepeat: repeats.join(', ')
  };
}

function internal_GetCardImageUrl(card) {
  var suit = card.substring(0, 1);
  var rank = parseInt(card.substring(1));
  rank = internal_FixTheRanking(rank); // 14 -> 'ace' etc
  suit = internal_FixTheSuiting(suit); // c  -> 'clubs' etc

  return "url('static/images/" + rank + "_of_" + suit + ".png')";
}

function internal_setBackground(diva, image, opacity) {
  var komage = diva.style;
  komage.opacity = opacity;
  komage['background-image'] = image;
}

function internal_clickin_helper(button, button_text, func_on_click) {
  if (button_text === 0) {
    button.style.visibility = 'hidden';
  } else {
    button.style.visibility = 'visible';
    if (button.id !== "fold-button") {
      button.innerHTML = button_text;
    } else {
      console.log("Ne pas modifier innerHTML pour le fold-button");
    }
    button.onclick = func_on_click;
    button.ontouchend = function(e) {
      e.preventDefault();
      func_on_click(e);
    };
  }
}

//  --- GUI stuff ---

function gui_hide_poker_table() {
  var table = document.getElementById('poker_table');
  table.style.visibility = 'hidden';
}

function gui_show_poker_table() {
  var table = document.getElementById('poker_table');
  table.style.visibility = 'visible';
}

function gui_set_player_name(name, seat) {
  var table = document.getElementById('poker_table');
  // Ici, nous recherchons directement l'élément correspondant au siège par son id
  var seatloc = document.getElementById("seat" + seat);
  if (!seatloc) return;
  
  // Trouver le conteneur de nom et jetons dans ce siège
  var chipsdiv = internal_get_a_class_named(seatloc, 'name-chips');
  var namediv = internal_get_a_class_named(chipsdiv, 'player-name');
  
  // Si aucun nom n'est défini, on masque le siège (sauf si marqué inactif)
  const isInactive = seatloc.classList.contains('inactive-seat');
  if (name === "" && !isInactive) {
    seatloc.style.visibility = 'hidden';
  } else {
    seatloc.style.visibility = 'visible';
  }
  namediv.textContent = name;
}

var userCardsRevealed = false; // Variable globale pour suivre si vos cartes ont été révélées

/**
 * Affiche (ou flippe) les cartes du joueur local.
 * @param {string} card_a - ex. "h14"
 * @param {string} card_b - ex. "s10"
 * @param {number} seat - numéro du siège client (ici 0)
 */
/** Affiche ou met à jour TES cartes (bottom‐left) SANS jamais flipper ici */
function gui_set_my_cards(card_a, card_b, seat) {
  const seatElem = document.getElementById("seat" + seat);
  if (!seatElem) return;
  const holecards = seatElem.querySelector(".holecards");
  const card1 = holecards.querySelector(".holecard1");
  const card2 = holecards.querySelector(".holecard2");
  if (!card1 || !card2) return;

  // 1) Pose la face ou le dos, mais ne lance pas de flip 3D
  internal_setCard(card1, card_a, false);
  internal_setCard(card2, card_b, false);

  // 2) Si on veut juste masquer (pre‐deal ou reset), on retire toute classe
  card1.classList.remove("deal-flip","revealed","visible");
  card2.classList.remove("deal-flip","revealed","visible");

  // 3) Si on est en phase “reveal” ET que mes cartes sont déjà signalées revealed,
  //    on montre la face en fondu (via .visible), sans flip
  if (gameState.phase === "reveal" && userCardsRevealed) {
    [card1,card2].forEach(c=>{
      c.style.transition = "opacity 0.6s ease";
      c.style.transform  = "none";
      c.classList.add("visible");
    });
  }
  // Aucun appel à flipCardsSimultaneously ici !
}

function internal_setCard(diva, card, folded, hidden = false) {
  // 1) Choix de l’image de dos
  let backImage;
  // ← on regarde si cet élément est dans VOTRE seat grâce à la classe .my-seat
  if (diva.closest && diva.closest('.seat.my-seat')) {
    // dos personnalisé pour VOTRE main
    backImage = (typeof window.getThemeCardAssetCssUrl === 'function')
      ? (diva.classList.contains("holecard1")
          ? window.getThemeCardAssetCssUrl('customI')
          : window.getThemeCardAssetCssUrl('customM'))
      : (diva.classList.contains("holecard1")
          ? "url('static/images/custom_I.png')"
          : "url('static/images/custom_M.png')");
  } else {
    // dos standard pour tous les autres sièges
    backImage = "url('static/images/cardbck.png')";
  }

  // 2) Image de face si ce n’est pas “blinded”
  const frontImage = (card && card !== "blinded")
    ? internal_GetCardImageUrl(card)
    : null;
  const frontSuit = (card && card !== "blinded")
    ? internal_FixTheSuiting(card.substring(0, 1))
    : null;
  const frontRank = (card && card !== "blinded")
    ? internal_FixTheRanking(parseInt(card.substring(1), 10))
    : null;

  // 3) Si pas de carte, on masque
  if (!card) {
    diva.style.opacity = 0;
    diva.style.backgroundImage = "";
    delete diva.dataset.cardCode;
    diva.classList.remove("revealed");
    return;
  }

  diva.dataset.cardCode = card;

  // 4) Si on affiche le dos (hidden ou “blinded”)
  if (hidden || card === "blinded") {
    diva.style.backgroundImage = backImage;
    diva.style.opacity = 1;
    diva.classList.remove("revealed");
    return;
  }

  // 5) Sinon on affiche la face
  if (frontImage && internal_IsFruityCardThemeActive()) {
    const fruityFace = internal_BuildFruityCardFaceStyle(
      frontSuit,
      frontRank,
      false
    );
    diva.style.backgroundImage = fruityFace.backgroundImage;
    diva.style.backgroundSize = fruityFace.backgroundSize;
    diva.style.backgroundPosition = fruityFace.backgroundPosition;
    diva.style.backgroundRepeat = fruityFace.backgroundRepeat;
  } else {
    diva.style.backgroundImage = frontImage;
    diva.style.backgroundSize = '';
    diva.style.backgroundPosition = '';
    diva.style.backgroundRepeat = '';
  }
  diva.style.opacity = folded ? 0.5 : 1;
  diva.classList.add("revealed");
}


function flipCardsSimultaneously(cardElem1, cardElem2, newCard1, newCard2, options = {}) {
  if (window.IMDCXMotion) {
    [cardElem1, cardElem2].forEach((el, n) => {
      const code = n === 0 ? newCard1 : newCard2;
      if (!el) return;
      el.style.transition = 'none';
      el.style.setProperty('transform', 'rotateY(0deg)', options.forceTransform ? 'important' : '');
      window.IMDCXMotion.flip(el, `show:${code}`, () => internal_setCard(el, code, false),
        { valid: options.isCurrent || (() => true), delay: n * 45 });
    });
    return;
  }
  const isCurrent = options.isCurrent || (() => true);
  const rotate = (el, value) => el.style.setProperty('transform', value, options.forceTransform ? 'important' : '');
  // 1) Réinitialise la rotation sans transition
  [cardElem1, cardElem2].forEach(el => {
    el.style.transition = 'none';
    rotate(el, 'rotateY(0deg)');
  });
  // Commit the starting pose before SHOW changes both seat ownership and layout.
  if (options.forceTransform) void cardElem1.offsetWidth;

  // 2) Au prochain frame, lance le demi‐flip vers 90°
  requestAnimationFrame(() => {
    if (!isCurrent()) return;
    [cardElem1, cardElem2].forEach(el => {
      el.style.transition = 'transform 0.3s ease';
      rotate(el, 'rotateY(90deg)');
    });
  });

  // 3) À mi‐chemin (~300ms), on swap l’image, puis reverse le flip
  setTimeout(() => {
    if (!isCurrent()) return;
    internal_setCard(cardElem1, newCard1, false);
    internal_setCard(cardElem2, newCard2, false);

    [cardElem1, cardElem2].forEach(el => {
      el.style.transition = 'transform 0.3s ease';
      rotate(el, 'rotateY(0deg)');
    });
  }, 300);
}

function gui_hilite_player(hilite_color, name_color, seat) {
  var table = document.getElementById('poker_table');
  var current = 'seat' + seat;
  var seatloc = table.children[current];
  var chipsdiv = internal_get_a_class_named(seatloc, 'name-chips');
  var namediv = internal_get_a_class_named(chipsdiv, 'player-name');
  
  // Appliquer la couleur du pseudo
  if (name_color === "") {
    namediv.style.color = chipsdiv.style.color;
  } else {
    namediv.style.color = name_color;
  }
  if (hilite_color === "") {
    namediv.style.backgroundColor = chipsdiv.style.backgroundColor;
  } else {
    namediv.style.backgroundColor = hilite_color;
  }
}

function gui_set_bankroll(amount, seat) {
  const table   = document.getElementById('poker_table');
  const seatEl  = table.children['seat' + seat];
  const chipsEl = internal_get_a_class_named(seatEl, 'name-chips');
  const nameEl  = internal_get_a_class_named(chipsEl, 'chips');

  // Vide ?
  if (amount == null || amount === '') { 
    nameEl.textContent = '';
    return;
  }

  // Nombre → format "fr-FR" (12 345)
  const n = Number(amount);
  if (Number.isFinite(n)) {
    nameEl.textContent = n.toLocaleString('fr-FR');
  } else {
    // Au cas où on reçoit déjà une string non numérique
    nameEl.textContent = String(amount);
  }
}

function gui_set_bet(bet, seat) {
  var table = document.getElementById('poker_table');
  var current = 'seat' + seat;
  var seatloc = table.children[current];
  var betdiv = internal_get_a_class_named(seatloc, 'bet');

  betdiv.textContent = bet;
}

// Dans client.js, remplace ton gui_set_player_cards par :
function gui_set_player_cards(card_a, card_b, seat, folded) {
  // 1) Si c'est ton siège, on met à jour la zone "bottom-left"
  if (seat === mySeatIndex) {
    // affiche ou cache selon folded/phase
    gui_set_my_cards(card_a, card_b, mySeatIndex);
  }
  
  // 2) Puis, on met à jour la représentation sur le siège correspondant
  const seatElem = document.getElementById("seat" + seat);
  if (!seatElem) return;
  
  const cardsDiv = seatElem.querySelector(".holecards");
  if (!cardsDiv) return;
  
  const card1 = cardsDiv.querySelector(".holecard1");
  const card2 = cardsDiv.querySelector(".holecard2");
  if (card1 && card2) {
    internal_setCard(card1, card_a, folded);
    internal_setCard(card2, card_b, folded);
  }
}

function gui_lay_board_card(n, the_card) {
  var current = '';
  if (n === 0) {
    current = 'flop1';
  } else if (n === 1) {
    current = 'flop2';
  } else if (n === 2) {
    current = 'flop3';
  } else if (n === 3) {
    current = 'turn';
  } else if (n === 4) {
    current = 'river';
  }
  var table = document.getElementById('poker_table');
  var seatloc = table.children.board;
  var cardsdiv = seatloc.children[current];
  internal_setCard(cardsdiv, the_card);
}

function gui_burn_board_card(n, the_card) {
  var current = '';
  if (n === 0) {
    current = 'burn1';
  } else if (n === 1) {
    current = 'burn2';
  } else if (n === 2) {
    current = 'burn3';
  }
  var table = document.getElementById('poker_table');
  var seatloc = table.children.board;
  var cardsdiv = seatloc.children[current];
  internal_setCard(cardsdiv, the_card);
}

function gui_write_basic_general(pot_size) {
  var table = document.getElementById('poker_table');
  var pot_div = table.children.pot;
  var total_div = pot_div.children['total-pot'];
  var the_pot = 'Pot : ' + pot_size;
  total_div.innerHTML = the_pot;
  window.IMDCXMotion?.potChanged(total_div, pot_size);
}

function gui_write_basic_general_text(text) {
  var table = document.getElementById('poker_table');
  var pot_div = table.children.pot;
  var total_div = pot_div.children['total-pot'];
  total_div.style.visibility = 'visible';
  total_div.innerHTML = text;
}

var log_text = [];
var log_index = 0;

function gui_log_to_history(text_to_write) {
  for (var idx = log_index; idx > 0; --idx) {
    log_text[idx] = log_text[idx - 1];
  }
  log_text[0] = text_to_write;
  if (log_index < 40) {
    log_index = log_index + 1;
  }
  var text_to_output = '<br><b>' + log_text[0] + '</b>';
  for (idx = 1; idx < log_index; ++idx) {
    text_to_output += '<br>' + log_text[idx];
  }
  var history = document.getElementById('history');
  history.innerHTML = text_to_output;
}

function gui_hide_log_window() {
  var history = document.getElementById('history');
  history.style.display = 'none';
}

function gui_place_dealer_button(seat) {
  var table_seat = seat;
  var button = document.getElementById('button');
  if (seat < 0) {
    button.style.visibility = 'hidden';
  } else {
    button.style.visibility = 'visible';
  }
  button.className = 'seat' + table_seat + '-button';
}

function gui_hide_dealer_button() {
  gui_place_dealer_button(-3);
}

function gui_hide_fold_call_click() {
  var buttons = document.getElementById('action-options');
  var fold = buttons.querySelector('#fold-button');
  var call = buttons.querySelector('#call-button');
  // On masque ou désactive seulement Call, pas Fold (ni Raise)
  // internal_clickin_helper(fold, 0, 0); // Ligne supprimée pour garder le bouton Fold affiché
  internal_clickin_helper(call, 0, 0);
  gui_disable_shortcut_keys();
}


function gui_setup_fold_call_click(show_fold, call_text, fold_func, call_func, key_ev) {
  var buttons = document.getElementById('action-options');
  // Utilisation de querySelector pour récupérer le bouton fold par son ID
  var fold = buttons.querySelector('#fold-button');
  // On force show_fold à true pour que le bouton reste affiché,
  // quel que soit le paramètre passé 
  // rgument
  internal_clickin_helper(fold, true, fold_func);

  // Pour le bouton call, on continue avec call_text et call_func comme d'habitude
  var call = buttons.querySelector('#call-button');
  internal_clickin_helper(call, call_text, call_func);
}

function gui_hide_game_response() {
  var response = document.getElementById('game-response');
  response.style.visibility = 'hidden';
}

function gui_show_game_response() {
  var response = document.getElementById('game-response');
  response.style.visibility = 'visible';
}

window.addEventListener('load', function() {
  // Injecter le bouton Raise dès le chargement
  var raiseContainer = document.getElementById('custom-raise');
  if (raiseContainer) {
    raiseContainer.innerHTML = "<a id='custom-raise' href='javascript:show_custom_raise()'></a>";
  }
});

function gui_write_game_response(text) {
  var response = document.getElementById('game-response');
  response.innerHTML = text;
}

function gui_set_game_response_font_color(color) {
  var response = document.getElementById('game-response');
  response.style.color = color;
}

function gui_write_guick_raise(text) {
  var response = document.getElementById('quick-raises');
  if (text === "") {
    response.style.visibility = 'hidden';
  } else {
    response.style.visibility = 'visible';
    response.innerHTML = text;
  }
}

function calcAddDigit(digit) {
  calcValue = calcValue * 10 + digit;
  updateCalcDisplay();
}

function calcClear() {
  calcValue = 0;
  updateCalcDisplay();
}

function calcAllIn() {
  if (typeof currentPlayer !== 'undefined' && currentPlayer.bankroll) {
    calcValue = currentPlayer.bankroll;
    updateCalcDisplay();
  } else {
    alert("Impossible de déterminer le montant All-In.");
  }
}

function calcClose() {
  calcValue = 0;
  gui_write_modal_box(""); // Cela devrait vider le contenu et masquer la modale
  // Forcer le réaffichage du bouton Raise
  var rb = document.getElementById("raise-button");
  if (rb) {
    rb.style.display = "inline-block";
  }
  console.log("calcClose executed, raise-button re-shown");
}

function updateCalcDisplay() {
  var display = document.getElementById("calc-display");
  if (display) {
    display.textContent = calcValue;
  }
}

function gui_write_modal_box(text) {
  var modal = document.getElementById('modal-box');
  if (text === "") {
    modal.style.display = "none";
    modal.innerHTML = "";
  } else {
    modal.innerHTML = text;
    modal.style.display = "block";
  }
}

function gui_write_end_game_modal(html) {
  var modal = document.getElementById("end-game-modal");
  if (modal) {
    modal.innerHTML = html;
    modal.style.display = "flex"; // ou "block", selon votre style
  }
}

function gui_initialize_css() {
  var item = document.getElementById('poker_table');
  var image = "url('static/images/poker_table.png')";
  internal_setBackground(item, image, 1.0);
}

function gui_enable_shortcut_keys(func) {
  document.addEventListener('keydown', func);
}

function gui_disable_shortcut_keys(func) {
  document.removeEventListener('keydown', func);
}

var calcValue = 0;

/* Ajoute un chiffre à la valeur saisie */
function calcAddDigit(digit) {
  calcValue = calcValue * 10 + digit;
  updateCalcDisplay();
}

/* Met la valeur à 0 */
function calcClear() {
  calcValue = 0;
  updateCalcDisplay();
}

/* Définir un montant rapide */
function calcSetValue(amount) {
  calcValue = amount;
  updateCalcDisplay();
}

/* Valider le montant saisi => handle_human_bet */
function calcConfirm() {
  if (calcValue > 0) {
    console.log("Emission de l'action RAISE avec montant :", calcValue);
    socket.emit('playerAction', { type: 'raise', amount: calcValue });
    calcClose(); // Fermer la calculatrice
  } else {
    alert("Veuillez entrer un montant valide.");
  }
}

/* ALL-IN => définit la valeur à la bankroll du joueur */
function calcAllIn() {
  if (players && players[0]) {
    calcValue = players[0].bankroll;
    updateCalcDisplay();
  } else {
    alert("Erreur: joueur non défini.");
  }
}

/* CALL => appelle la fonction de call (par ex. human_call) */
function calcCall() {
  human_call();
  calcClose();
}

/* Fermer la calculatrice */
function calcClose() {
  calcValue = 0;
  gui_write_modal_box("");
  // Optionnel : réafficher le bouton Raise
  var rb = document.getElementById("raise-button");
  if (rb) {
    rb.style.display = "inline-block";
  }
}

/* Met à jour l'affichage du montant dans la calculatrice */
function updateCalcDisplay() {
  var display = document.getElementById("calc-display");
  if (display) {
    display.textContent = calcValue;
  }
}

document.addEventListener('DOMContentLoaded', function() {
  var raiseButton = document.getElementById("raise-button");
  if (raiseButton) {
    raiseButton.onclick = show_calculator;
  }
});

function disablePlayerButtons() {
  var btns = document.querySelectorAll('.action-button');
  btns.forEach(function(btn) {
    btn.classList.add('disabled');
  });
}

function enablePlayerButtons() {
  var btns = document.querySelectorAll('.action-button');
  btns.forEach(function(btn) {
    btn.classList.remove('disabled');
  });
}

function revealCards(cardElem1, cardElem2, newCard1, newCard2) {
  // Met à jour l'image de fond pour révéler les vraies cartes
  cardElem1.style.backgroundImage = "url('http://localhost:3000/static/images/" + newCard1 + ".png')";
  cardElem2.style.backgroundImage = "url('http://localhost:3000/static/images/" + newCard2 + ".png')";
  
  // Ajoute la classe visible pour déclencher le fondu
  cardElem1.classList.add("visible");
  cardElem2.classList.add("visible");
}

function fadeInActionButtons() {
  var buttons = document.querySelectorAll('.action-button');
  buttons.forEach(function(btn) {
    btn.classList.add('fade-in');
  });
}

// Appeler la fonction après un court délai (par exemple, 300 ms) au chargement
window.onload = function() {
  setTimeout(fadeInActionButtons, 300);
};

function showActionButtons() {
  var ao = document.getElementById("action-options");
  if (ao) {
    ao.classList.add("visible");
  }
}

window.addEventListener('load', function() {
  // Sélectionnez tous vos boutons d'action
  var buttons = document.querySelectorAll('.action-button');
  // Ajoutez la classe initial-fade pour déclencher l'animation de fade-in
  buttons.forEach(function(btn) {
    btn.classList.add('initial-fade');
  });
  
  // Retirez la classe initial-fade après la durée de l'animation (0.6s)
  setTimeout(function() {
    buttons.forEach(function(btn) {
      btn.classList.remove('initial-fade');
    });
  }, 1000);
});

window.addEventListener('load', function() {
  var customRaiseBtn = document.getElementById('raise-button');
  if (customRaiseBtn) {
    customRaiseBtn.classList.add('initial-fade');
  }
});


function disableRaiseButton() {
  var raise = document.getElementById('raise-button');
  if (raise) {
    raise.classList.add('disabled');
  }
}

function enableRaiseButton() {
  var raise = document.getElementById('raise-button');
  if (raise) {
    raise.classList.remove('disabled');
  }
}
