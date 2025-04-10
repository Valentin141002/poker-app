"use strict";

// --- Globales pour le joueur humain ---
var mySeat;           // Le siège assigné au joueur humain (à définir lors de la réception de l'état de table)
var userCardA = "";
var userCardB = "";
var userCardsRevealed = false;  // Permet de déclencher le flip qu'une seule fois

// --- Fonctions utilitaires ---
function gui_get_theme_mode_highlite_color() {
  // Retourne une couleur par défaut pour le surlignage (par exemple "blue")
  return "blue";
}

function internal_get_a_class_named(curr, searched_name) {
  if (!curr) {
    gui_log_to_history("internal_get_a_class_named, no curr for " + searched_name);
    return null;
  }
  var result = null;
  for (var i = 0; i < curr.childNodes.length; i++) {
    if (curr.childNodes[i].className === searched_name) {
      result = curr.childNodes[i];
      break;
    }
  }
  return result;
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
    // Cartes numériques 1 - 10
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

function internal_GetCardImageUrl(card) {
  var suit = card.substring(0, 1);
  var rank = parseInt(card.substring(1));
  rank = internal_FixTheRanking(rank); // Ex : 14 -> 'ace'
  suit = internal_FixTheSuiting(suit);     // Ex : 'c' -> 'clubs'
  return "url('static/images/" + rank + "_of_" + suit + ".png')";
}

function internal_setBackground(diva, image, opacity) {
  var style = diva.style;
  style.opacity = opacity;
  style['background-image'] = image;
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
  }
}

// --- Fonctions d'affichage de l'interface ---

function gui_hide_poker_table() {
  var table = document.getElementById('poker_table');
  table.style.visibility = 'hidden';
}

function gui_show_poker_table() {
  var table = document.getElementById('poker_table');
  table.style.visibility = 'visible';
}

function gui_set_player_name(name, seat) {
  var seatElem = document.getElementById("seat" + seat);
  if (!seatElem) return;
  var chipsDiv = internal_get_a_class_named(seatElem, 'name-chips');
  var nameDiv = internal_get_a_class_named(chipsDiv, 'player-name');
  // Afficher ou masquer le siège selon la présence du nom
  seatElem.style.visibility = name === "" ? 'hidden' : 'visible';
  nameDiv.textContent = name;
}

function gui_set_my_cards(card_a, card_b) {
  // Stocker les cartes réelles
  userCardA = card_a;
  userCardB = card_b;
  
  // Utiliser mySeat pour déterminer le conteneur du joueur
  var seat = (typeof mySeat !== 'undefined') ? mySeat : 0;
  var card1Elem = document.querySelector('#seat' + seat + ' .holecards .holecard1');
  var card2Elem = document.querySelector('#seat' + seat + ' .holecards .holecard2');
  
  if (!card1Elem || !card2Elem) {
    console.error("Les éléments de cartes pour le siège " + seat + " ne sont pas trouvés.");
    return;
  }
  
  if (!userCardsRevealed) {
    // Affichage initial des dos de cartes
    internal_setCard(card1Elem, "blinded", false);
    internal_setCard(card2Elem, "blinded", false);
    
    if (card_a !== "" && card_a !== undefined && card_b !== "" && card_b !== undefined) {
      flipCardsSimultaneously(card1Elem, card2Elem, card_a, card_b);
      userCardsRevealed = true;
    }
  } else {
    internal_setCard(card1Elem, card_a, false);
    internal_setCard(card2Elem, card_b, false);
  }
}

function internal_setCard(diva, card, folded, hidden) {
  hidden = hidden || false;
  var image = "url('static/images/cardback.png')";
  var opacity = 1.0;
  
  if (typeof card === 'undefined') {
    alert('Undefined card ' + card);
    opacity = 0.0;
  } else if (card === "") {
    opacity = 0.0;
  } else if (card === "blinded") {
    // Vérifie si l'élément appartient au joueur humain via mySeat
    if (typeof mySeat !== 'undefined' && diva.closest && diva.closest("#seat" + mySeat)) {
      if (diva.classList.contains("holecard1")) {
        image = "url('static/images/custom_I.png')";
      } else if (diva.classList.contains("holecard2")) {
        image = "url('static/images/custom_M.png')";
      } else {
        image = "url('static/images/cardbck.png')";
      }
    } else {
      image = "url('static/images/cardbck.png')";
    }
  } else {
    if (folded) {
      opacity = 0.5;
    }
    image = internal_GetCardImageUrl(card);
  }
  
  if (hidden) {
    opacity = 0;
    diva.classList.add("hidden");
  } else {
    diva.classList.remove("hidden");
  }  
  
  internal_setBackground(diva, image, opacity);
}

function flipCardsSimultaneously(cardElem1, cardElem2, newCard1, newCard2) {
  cardElem1.style.transition = "transform 0.6s ease";
  cardElem2.style.transition = "transform 0.6s ease";
  
  cardElem1.style.transform = "rotateY(90deg)";
  cardElem2.style.transform = "rotateY(90deg)";
  
  setTimeout(function() {
    internal_setCard(cardElem1, newCard1, false);
    internal_setCard(cardElem2, newCard2, false);
    cardElem1.style.transform = "rotateY(0deg)";
    cardElem2.style.transform = "rotateY(0deg)";
  }, 300);
}

function gui_hilite_player(hilite_color, name_color, seat) {
  var seatElem = document.getElementById("seat" + seat);
  if (!seatElem) return;
  var chipsDiv = internal_get_a_class_named(seatElem, 'name-chips');
  var nameDiv = internal_get_a_class_named(chipsDiv, 'player-name');
  
  nameDiv.style.color = name_color === "" ? chipsDiv.style.color : name_color;
  nameDiv.style.backgroundColor = hilite_color === "" ? chipsDiv.style.backgroundColor : hilite_color;
}

function gui_set_bankroll(amount, seat) {
  var seatElem = document.getElementById("seat" + seat);
  if (!seatElem) return;
  var chipsDiv = internal_get_a_class_named(seatElem, 'name-chips');
  var chipElem = internal_get_a_class_named(chipsDiv, 'chips');
  if (!isNaN(amount) && amount !== "") {
    amount = amount + " <img src='static/images/chip5.png' alt='jeton' style='vertical-align:middle; width:20px; height:20px;'>";
  }
  chipElem.innerHTML = amount;
}

function gui_set_bet(bet, seat) {
  var seatElem = document.getElementById("seat" + seat);
  if (!seatElem) return;
  var betDiv = internal_get_a_class_named(seatElem, 'bet');
  betDiv.textContent = bet;
}

function gui_set_player_cards(card_a, card_b, seat, folded) {
  // Si le siège correspond au joueur humain, on appelle gui_set_my_cards
  if (typeof mySeat !== 'undefined' && seat === mySeat) {
    gui_set_my_cards(card_a, card_b);
    return;
  } else {
    var seatElem = document.getElementById("seat" + seat);
    if (!seatElem) return;
    var cardsDiv = internal_get_a_class_named(seatElem, 'holecards');
    var card1 = internal_get_a_class_named(cardsDiv, 'card holecard1');
    var card2 = internal_get_a_class_named(cardsDiv, 'card holecard2');
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
  var boardElem = document.querySelector('#poker_table .board');
  if (!boardElem) return;
  var cardDiv = boardElem.querySelector('.' + current);
  internal_setCard(cardDiv, the_card);
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
  var boardElem = document.querySelector('#poker_table .board');
  if (!boardElem) return;
  var cardDiv = boardElem.querySelector('.' + current);
  internal_setCard(cardDiv, the_card);
}

function gui_write_basic_general(pot_size) {
  var table = document.getElementById('poker_table');
  var potDiv = table.querySelector('#pot .total-pot');
  var the_pot = 'Total pot: ' + pot_size;
  potDiv.innerHTML = the_pot;
}

function gui_write_basic_general_text(text) {
  var table = document.getElementById('poker_table');
  var potDiv = table.querySelector('#pot .total-pot');
  potDiv.style.visibility = 'visible';
  potDiv.innerHTML = text;
}

var log_text = [];
var log_index = 0;

function gui_log_to_history(text_to_write) {
  for (var idx = log_index; idx > 0; --idx) {
    log_text[idx] = log_text[idx - 1];
  }
  log_text[0] = text_to_write;
  if (log_index < 40) {
    log_index++;
  }
  var text_to_output = '<br><b>' + log_text[0] + '</b>';
  for (var idx = 1; idx < log_index; ++idx) {
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
  var button = document.getElementById('button');
  button.style.visibility = (seat < 0) ? 'hidden' : 'visible';
  button.className = 'seat' + seat + '-button';
}

function gui_hide_dealer_button() {
  gui_place_dealer_button(-3);
}

function gui_hide_fold_call_click() {
  var buttons = document.getElementById('action-options');
  var fold = buttons.querySelector('#fold-button');
  var call = buttons.querySelector('#call-button');
  // On masque uniquement le bouton Call, mais on laisse Fold affiché
  internal_clickin_helper(call, 0, 0);
  gui_disable_shortcut_keys();
}

function gui_setup_fold_call_click(show_fold, call_text, fold_func, call_func, key_ev) {
  var buttons = document.getElementById('action-options');
  var fold = buttons.querySelector('#fold-button');
  // On force l'affichage de fold
  internal_clickin_helper(fold, true, fold_func);
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

var calcValue = 0;

function show_custom_raise() {
  console.log("show_custom_raise appelée");
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
  var modal = document.getElementById("modal-box");
  if (modal) {
    modal.style.display = "block";
    modal.style.bottom = "0";
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

function calcSetValue(amount) {
  calcValue = amount;
  updateCalcDisplay();
}

function calcConfirm() {
  if (calcValue > 0) {
    handle_human_bet(calcValue);
    calcClose();
  } else {
    alert("Veuillez entrer un montant valide.");
  }
}

function calcAllIn() {
  if (typeof mySeat !== 'undefined' && players && players[mySeat]) {
    calcValue = players[mySeat].bankroll;
    updateCalcDisplay();
  } else {
    alert("Erreur: joueur non défini.");
  }
}

function calcCall() {
  human_call();
  calcClose();
}

function calcClose() {
  calcValue = 0;
  gui_write_modal_box("");
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
    modal.style.display = "flex";
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

document.addEventListener('DOMContentLoaded', function() {
  var raiseButton = document.getElementById("raise-button");
  if (raiseButton) {
    raiseButton.onclick = show_custom_raise;
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
  // Utilise une URL relative pour la production
  cardElem1.style.backgroundImage = "url('static/images/" + newCard1 + ".png')";
  cardElem2.style.backgroundImage = "url('static/images/" + newCard2 + ".png')";
  cardElem1.classList.add("visible");
  cardElem2.classList.add("visible");
}

function fadeInActionButtons() {
  var buttons = document.querySelectorAll('.action-button');
  buttons.forEach(function(btn) {
    btn.classList.add('fade-in');
  });
}

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
  var buttons = document.querySelectorAll('.action-button');
  buttons.forEach(function(btn) {
    btn.classList.add('initial-fade');
  });
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