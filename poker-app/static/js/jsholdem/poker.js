/*
If you improve this software or find a bug, please let me know: orciu@users.sourceforge.net
Project home page: http://sourceforge.net/projects/jsholdem/
*/
"use strict";

var START_DATE;
var NUM_ROUNDS;
var STOP_AUTOPLAY = 0;
var RUN_EM = 0;
var STARTING_BANKROLL = 500;
var SMALL_BLIND;
var BIG_BLIND;
var BG_HILITE = 'gold';           // "#EFEF30",
var global_speed = 1;
var HUMAN_WINS_AGAIN;
var HUMAN_GOES_ALL_IN;
var cards = new Array(52);
var players;
var board, deck_index, button_index;
var current_bettor_index, current_bet_amount, current_min_raise;

function leave_pseudo_alert () {
  gui_write_modal_box("");
}

function my_pseudo_alert (text) {
  var html = "<div class='end-game-content'>" +
               "<p class='end-game-text'>" + text + "</p>" +
"</div>";  gui_write_end_game_modal(html);
}

function hideEndGameModal() {
  var modal = document.getElementById("end-game-modal");
  if (modal) {
    modal.style.display = "none";
  }
}

function gui_write_end_game_modal(html) {
  var modal = document.getElementById("end-game-modal");
  if (modal) {
    modal.innerHTML = html;
    modal.style.display = "flex";  // Affiche le modal en flex (pour centrer)
  }
}

window.addEventListener('load', function() {
  var modal = document.getElementById('end-game-modal');
  if (modal) {
    modal.style.display = "none";
  }
});


function player (name, bankroll, carda, cardb, status, total_bet,
                 subtotal_bet) {
  this.name = name;
  this.bankroll = bankroll;
  this.carda = carda;
  this.cardb = cardb;
  this.status = status;
  this.total_bet = total_bet;
  this.subtotal_bet = subtotal_bet;
}

// See stackoverflow.com/questions/16427636/check-if-localstorage-is-available
function has_local_storage () {
  try {
    var storage = window['localStorage'];
    var x = '__storage_test__';
    storage.setItem(x, x);
    storage.removeItem(x);
    return true;
  }
  catch (e) {
    return false;
  }
}

function oldInitGame() {
  if (!has_local_storage()) {
    my_pseudo_alert("Your browser does not support localStorage - try a more modern browser.");
    return;
  }
  setTimeout(function() {
    document.getElementById("action-options").style.display = "flex";
  }, 100);
  // Commenter gui_hide_poker_table() pour tester
  // gui_hide_poker_table();
  gui_hide_log_window();
  gui_hide_dealer_button();
  gui_hide_game_response();
  new_game ();
  new_game_continues ();
}

function updateTurnIndicator(gameState) {
  var turnMessageElem = document.getElementById('turn-message');
  if (!turnMessageElem) {
    var topBar = document.getElementById('top-black-bar');
    if (topBar) {
      topBar.innerHTML += "<div id='turn-message' style='color: white; font-size: 20px; padding-top: 5px;'></div>";
    }
    turnMessageElem = document.getElementById('turn-message');
  }
  // Si mon siège (mySocketId) correspond à gameState.current_bettor_index...
  if (gameState.current_bettor_index === gameState.players.findIndex(p=>p.id===mySocketId) &&
      gameState.players[gameState.current_bettor_index].bankroll > gameState.players[gameState.current_bettor_index].subtotal_bet) {
    turnMessageElem.innerHTML = "It's Your Turn";
  } else {
    turnMessageElem.innerHTML = "";
  }
}

function handle_how_many_reply(opponents) {
  gui_write_modal_box("");
  write_settings_frame();
  new_game_continues(opponents);
  gui_initialize_css();         // Charge les images de fond
  gui_show_game_response();
}

// Remplace complètement l'ancienne fonction ask_how_many_opponents par une version qui force le nombre d'adversaires
function ask_how_many_opponents() {
  // Ici, on force le nombre d'adversaires à 9 (ce qui donne 10 joueurs au total)
  handle_how_many_reply(9);
}

function clear_player_cards (count) {
  count = count + 1; // Count that human too
  for (var pl = 0; pl < count; ++pl) {
    gui_set_player_cards("", "", pl);
    gui_set_player_name("", pl);
    gui_set_bet("", pl);
    gui_set_bankroll("", pl);
  }
}

function new_game () {
  START_DATE = new Date();
  NUM_ROUNDS = 0;
  HUMAN_WINS_AGAIN = 0;
  ask_how_many_opponents();
}

function new_game_continues(req_no_opponents) {
  // Création des adversaires (Player 2 à Player 10)
  var my_players = [
    new player("Player 2", 0, "", "", "", 0, 0),
    new player("Player 3", 0, "", "", "", 0, 0),
    new player("Player 4", 0, "", "", "", 0, 0),
    new player("Player 5", 0, "", "", "", 0, 0),
    new player("Player 6", 0, "", "", "", 0, 0),
    new player("Player 7", 0, "", "", "", 0, 0),
    new player("Player 8", 0, "", "", "", 0, 0),
    new player("Player 9", 0, "", "", "", 0, 0),
    new player("Player 10", 0, "", "", "", 0, 0)
  ];

  // On crée un tableau players dont le premier élément sera le joueur humain
  players = new Array(req_no_opponents + 1);
  var stored_name = getLocalStorage("playername");
  // Pour le joueur humain, on utilise le nom stocké
  var player_name = stored_name ? stored_name : "YOU";
  players[0] = new player(player_name, 0, "", "", "", 0, 0);

  // Trier my_players en extrayant le numéro dans le nom (ex. "Player 2" -> 2) pour un tri croissant
  my_players.sort(function(a, b) {
    var numA = parseInt(a.name.split(" ")[1], 10);
    var numB = parseInt(b.name.split(" ")[1], 10);
    return numA - numB;
  });

  // Affecter les adversaires dans players à partir de l'index 1
  for (var i = 1; i < players.length; i++) {
    players[i] = my_players[i - 1];
  }
  
  // Optionnel : on peut réattribuer les noms pour être certain de l'ordre
  // Ici, on renomme les joueurs de sorte que players[0] soit "Player 1", players[1] "Player 2", etc.
  players.forEach(function(p, idx) {
    var number = idx + 1; // Numérotation 1 à n
    if (number === 1) {
      // Le joueur humain
      p.name = "YOU";
  }});

  // Suite de l'initialisation
  clear_player_cards(my_players.length);
  reset_player_statuses(0);
  clear_bets();

  // Affecter un bankroll de 20 000 jetons à chaque joueur
  players.forEach(function(p) {
    p.bankroll = 20000;
  });

  // Choix aléatoire du bouton pour le dealer
  button_index = Math.floor(Math.random() * players.length);
  new_round();
}

function number_of_active_players () {
  var num_playing = 0;
  var i;
  for (i = 0; i < players.length; i++) {
    if (has_money(i)) {
      num_playing += 1;
    }
  }
  return num_playing;
}

function new_round () {
  RUN_EM = 0;
  NUM_ROUNDS++;
  // Clear buttons

  var messageElem = document.getElementById('end-game-message');
if (messageElem) {
  messageElem.innerHTML = "";
}

  var num_playing = number_of_active_players();
  if (num_playing < 2) {
    gui_setup_fold_call_click("Start a new game",
                              0,
                              new_game,
                              new_game);
    return;
  }
  HUMAN_GOES_ALL_IN = 0;
  reset_player_statuses(1);
  clear_bets();
  clear_pot();
  current_min_raise = 0;
  collect_cards();
  button_index = get_next_player_position(button_index, 1);
  var i;
  for (i = 0; i < players.length; i++) {
    write_player(i, 0, 0);
  }

  for (i = 0; i < board.length; i++) {
    if (i > 4) {        // board.length != 5
      continue;
    }
    board[i] = "";
    gui_lay_board_card(i, board[i]);     // Clear the board
  }
  for (i = 0; i < 3; i++) {
    board[i] = "";
    gui_burn_board_card(i, board[i]);
  }
  var message = "<tr><td><font size=+2><b></b></font>";
  gui_write_game_response(message);
  shuffle();
  blinds_and_deal();
}

function collect_cards () {
  board = new Array(6);
  for (var i = 0; i < players.length; i++) {
    players[i].carda = "";
    players[i].cardb = "";
  }
}

function new_shuffle () {
  function get_random_int (max) {
    return Math.floor(Math.random() * max);
  }
  var len = cards.length;
  for (var i = 0; i < len; ++i) {
    var j = i + get_random_int(len - i);
    var tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
}

function shuffle () {
  new_shuffle();
  deck_index = 0;
}

function blinds_and_deal () {
  SMALL_BLIND = 5;
  BIG_BLIND = 10;
  var num_playing = number_of_active_players();
  if (num_playing == 3) {
    SMALL_BLIND = 10;
    BIG_BLIND = 20;
  } else if (num_playing < 3) {
    SMALL_BLIND = 25;
    BIG_BLIND = 50;
  }
  var small_blind = get_next_player_position(button_index, 1);
  the_bet_function(small_blind, SMALL_BLIND);
  write_player(small_blind, 0, 0);
  var big_blind = get_next_player_position(small_blind, 1);
  the_bet_function(big_blind, BIG_BLIND);
  write_player(big_blind, 0, 0);
  players[big_blind].status = "OPTION";
  current_bettor_index = get_next_player_position(big_blind, 1);
  deal_and_write_a();
}

function unroll_player (starting_player, player_pos, final_call) {
  var next_player = get_next_player_position(player_pos, 1);
  write_player(player_pos, 0, 0);
  if (starting_player == next_player) {
    setTimeout(final_call, 250 * global_speed);
  } else {
    setTimeout(unroll_player, 250 * global_speed,
               starting_player, next_player, final_call);
  }
}

function deal_and_write_a () {
  var current_player;
  var start_player;

  start_player = current_player = get_next_player_position(button_index, 1);
  // Deal cards to players still active
  do {
    players[current_player].carda = cards[deck_index++];
    current_player = get_next_player_position(current_player, 1);
  } while (current_player != start_player);

  // and now show the cards
  current_player = get_next_player_position(button_index, 1);
  unroll_player(current_player, current_player, deal_and_write_b);
}

// Make a small delay before starting the bets
function delay_for_main () {
  setTimeout(main, 1000);
}

function deal_and_write_b () {
  var current_player = button_index;
  for (var i = 0; i < players.length; i++) {
    current_player = get_next_player_position(current_player, 1);
    if (players[current_player].cardb) {
      break;
    }
    players[current_player].cardb = cards[deck_index++];
  }

  current_player = get_next_player_position(button_index, 1);
  unroll_player(current_player, current_player, delay_for_main);
}

function go_to_betting () {
  if (get_num_betting() > 1) {
    setTimeout(main, 1000 * global_speed);
  } else {
    setTimeout(ready_for_next_card, 1000 * global_speed);
  }
}

function unroll_table (last_pos, current_pos, final_call) {
  gui_lay_board_card(current_pos, board[current_pos]);

  if (current_pos == last_pos) {
    setTimeout(final_call, 150 * global_speed);
  } else {
    setTimeout(unroll_table, 150 * global_speed,
               last_pos, current_pos + 1, final_call);
  }
}

function deal_flop () {
  var burn = cards[deck_index++];
  burn = 'blinded';
  gui_burn_board_card(0, burn);
  var message = "<tr><td><font size=+2><b></b></font>";
  gui_write_game_response(message);
  for (var i = 0; i < 3; i++) {
    board[i] = cards[deck_index++];
  }

  // Place 3 first cards
  setTimeout(unroll_table, 1000, /*last_pos*/2, /*start_pos*/0, go_to_betting);
}

function deal_fourth () {
  var burn = cards[deck_index++];
  burn = 'blinded';
  gui_burn_board_card(1, burn);
  var message = "<tr><td><font size=+2><b></b></font>";
  gui_write_game_response(message);
  board[3] = cards[deck_index++];

  // Place 4th card
  setTimeout(unroll_table, 1000, /*last_pos*/3, /*start_pos*/3, go_to_betting);
}

function deal_fifth () {
  var burn = cards[deck_index++];
  burn = 'blinded';
  gui_burn_board_card(2, burn);
  var message = "<tr><td><font size=+2><b></b></font>";
  gui_write_game_response(message);
  board[4] = cards[deck_index++];

  // Place 5th card
  setTimeout(unroll_table, 1000, /*last_pos*/4, /*start_pos*/4, go_to_betting);
}

function updateTurnMessage() {
  var turnMessageElem = document.getElementById('turn-message');
  if (!turnMessageElem) {
    var topBar = document.getElementById('top-black-bar');
    if (topBar) {
      topBar.innerHTML += "<div id='turn-message' style='color: white; font-size: 20px; padding-top: 5px;'></div>";
    }
    turnMessageElem = document.getElementById('turn-message');
  }
  
  // Afficher "It's Your Turn" uniquement si c'est votre tour
  // et que vous n'êtes pas all-in (bankroll supérieure à la mise actuelle)
  if (current_bettor_index === 0 && players[0].bankroll > players[0].subtotal_bet) {
    turnMessageElem.innerHTML = "It's Your Turn";
  } else {
    turnMessageElem.innerHTML = "";
  }
}

function main () {
  var increment_bettor_index = 0;
  
  // Active/désactive les boutons selon si c'est le tour du joueur humain
  if (current_bettor_index === 0) {
    enablePlayerButtons();  // C'est votre tour, activez les boutons
  } else {
    disablePlayerButtons(); // Sinon, désactivez-les
  }
  
  // Mise à jour du message de tour (affichera "It's Your Turn" si applicable)
  updateTurnMessage();
  
  if (players[current_bettor_index].status == "BUST" ||
      players[current_bettor_index].status == "FOLD") {
    increment_bettor_index = 1;
  } else if (!has_money(current_bettor_index)) {
    players[current_bettor_index].status = "CALL";
    increment_bettor_index = 1;
  } else if (players[current_bettor_index].status == "CALL" &&
             players[current_bettor_index].subtotal_bet == current_bet_amount) {
    increment_bettor_index = 1;
  } else {
    players[current_bettor_index].status = "";
    if (current_bettor_index == 0) {
      // Pour le joueur humain, configuration des boutons CALL/CHECK et FOLD
      var call_button_text = "";
      var fold_button_text = "<font color=red><u>F</u>old</font>";
      var to_call = current_bet_amount - players[0].subtotal_bet;
      if (to_call > players[0].bankroll) {
        to_call = players[0].bankroll;
      }
      var that_is_not_the_key_you_are_looking_for;
      
      // Si aucun montant à suivre : le bouton CALL est remplacé par "Check"
// … dans main(), au moment où tu construis call_button_text / fold_button_text …
var to_call = current_bet_amount - players[0].subtotal_bet;

// Si rien à suivre → on passe en mode CHECK
// ... à l’intérieur de main(), juste après avoir calculé `to_call` :
call_button_text = "<font color=orange>Check</font>";
fold_button_text = "<font color=red><u>F</u>old</font>";

that_is_not_the_key_you_are_looking_for = function(key) {
  if (key === 67) {      // C → check
    human_check();
    return false;        // on intercepte la touche
  }
  if (key === 70) {      // F → fold
    human_fold();
    return false;
  }
  return true;
};
      // Configuration des raccourcis clavier
      var ret_function = function (key_event) {
        actual_function(key_event.keyCode, key_event);
      };

      var actual_function = function (key, key_event) {
        if (that_is_not_the_key_you_are_looking_for(key)) {
          return;
        }
        gui_disable_shortcut_keys(ret_function);
        if (key_event != null) {
          key_event.preventDefault();
        }
      };

      var do_fold = function () {
        actual_function(70, null);
      };
      var do_call = function () {
        actual_function(67, null);
      };
      // Configuration rapide des mises de relance (Quick Raise)
      var quick_values = new Array(6);
      if (to_call < players[0].bankroll) {
        quick_values[0] = current_min_raise;
      }
      var quick_start = quick_values[0];
      if (quick_start < 20) {
        quick_start = 20;
      } else {
        quick_start = current_min_raise + 20;
      }
      var i;
      for (i = 0; i < 5; i++) {
        if (quick_start + 20 * i < players[0].bankroll) {
          quick_values[i + 1] = quick_start + 20 * i;
        }
      }
      var bet_or_raise = "";
      if (to_call > 0) {
        bet_or_raise = "";
      }
      var quick_bets = "<b> " + bet_or_raise + "</b><br>";
      // Insertion du bouton Raise (déjà présent dans votre interface)
      quick_bets += "<a id='raise-button' href='javascript:show_raise_button()'></a>&nbsp;&nbsp;&nbsp;";
      var html9 = "<td><table align=center><tr><td align=center>";
      var html10 = quick_bets + "</td></tr></table></td></tr></table></body></html>";
      gui_write_guick_raise(html9 + html10);       
      
      // Éventuellement, écrire un message (ici vide)
      var message = "<tr><td><font size=+2><b></b></font>";
      gui_write_game_response(message);
      
      write_player(0, 1, 0);
      return;      
    } else {
      // Pour les bots ou autres joueurs
      write_player(current_bettor_index, 1, 0);
      setTimeout(bet_from_bot, 777 * global_speed, current_bettor_index);
      return;
    }
  }
  
  // Vérification si tous les joueurs peuvent passer au prochain tour
  var can_break = true;
  for (var j = 0; j < players.length; j++) {
    var s = players[j].status;
    if (s == "OPTION") {
      can_break = false;
      break;
    }
    if (s != "BUST" && s != "FOLD") {
      if (has_money(j) && players[j].subtotal_bet < current_bet_amount) {
        can_break = false;
        break;
      }
    }  
  }
  
  if (increment_bettor_index) {
    current_bettor_index = get_next_player_position(current_bettor_index, 1);
  }
  
  if (can_break) {
    setTimeout(ready_for_next_card, 999 * global_speed);
  } else {
    setTimeout(main, 999 * global_speed);
  }
  
  if (current_bettor_index === 0) {
    // On s'assure que le bouton Raise est visible
    var rb = document.getElementById("raise-button");
    if (rb) {
      rb.style.display = "inline-block";
    }
    // Met à jour le message de tour (affichera "It's Your Turn" uniquement si le joueur n'est pas all-in)
    updateTurnMessage();
  }
}

var global_pot_remainder = 0;

// Variable globale (à déclarer en haut de votre fichier, par exemple)
var revealPhase = false;

function handle_end_of_round() {
  var candidates = new Array(players.length);
  var allocations = new Array(players.length);
  var winning_hands = new Array(players.length);
  var my_total_bets_per_player = new Array(players.length);

  // Initialisation des allocations et récupération des joueurs actifs
  var i;
  var still_active_candidates = 0;
  for (i = 0; i < players.length; i++) {
    allocations[i] = 0;
    my_total_bets_per_player[i] = players[i].total_bet;
    if (players[i].status !== "FOLD" && players[i].status !== "BUST") {
      candidates[i] = players[i];
      still_active_candidates++;
    }
  }

  var my_total_pot_size = get_pot_size();
  var my_best_hand_name = "";
  var best_hand_players;
  var current_pot_to_split = 0;
  var pot_remainder = 0;
  if (global_pot_remainder) {
    gui_log_to_history("transferring global pot remainder " + global_pot_remainder);
    pot_remainder = global_pot_remainder;
    my_total_pot_size += global_pot_remainder;
    global_pot_remainder = 0;
  }

  // Distribution du pot
  while (my_total_pot_size > (pot_remainder + 0.9) && still_active_candidates) {
    var winners = get_winners(candidates);
    if (!best_hand_players) {
      best_hand_players = winners;
    }
    if (!winners) {
      my_pseudo_alert("No winners for the pot ");
      pot_remainder = my_total_pot_size;
      my_total_pot_size = 0;
      break;
    }

    var lowest_winner_bet = my_total_pot_size * 2;
    var num_winners = 0;
    for (i = 0; i < winners.length; i++) {
      if (!winners[i]) {
        continue;
      }
      if (!my_best_hand_name) {
        my_best_hand_name = winners[i]["hand_name"];
      }
      num_winners++;
      if (my_total_bets_per_player[i] < lowest_winner_bet) {
        lowest_winner_bet = my_total_bets_per_player[i];
      }
    }

    current_pot_to_split = pot_remainder;
    pot_remainder = 0;
    for (i = 0; i < players.length; i++) {
      if (lowest_winner_bet >= my_total_bets_per_player[i]) {
        current_pot_to_split += my_total_bets_per_player[i];
        my_total_bets_per_player[i] = 0;
      } else {
        current_pot_to_split += lowest_winner_bet;
        my_total_bets_per_player[i] -= lowest_winner_bet;
      }
    }

    var share = Math.floor(current_pot_to_split / num_winners);
    pot_remainder = current_pot_to_split - share * num_winners;

    for (i = 0; i < winners.length; i++) {
      if (my_total_bets_per_player[i] < 0.01) {
        candidates[i] = null;
      }
      if (!winners[i]) {
        continue;
      }
      my_total_pot_size -= share;
      allocations[i] += share;
      winning_hands[i] = winners[i].hand_name;
    }

    // Recalcule du nombre de candidats encore actifs
    still_active_candidates = 0;
    for (i = 0; i < candidates.length; i++) {
      if (candidates[i] != null) {
        still_active_candidates++;
      }
    }
    if (still_active_candidates === 0) {
      pot_remainder = my_total_pot_size;
    }
    gui_log_to_history("End of iteration");
  } // Fin de la répartition du pot

  global_pot_remainder = pot_remainder;
  pot_remainder = 0;
  var winner_text = "";
  var human_loses = 0;

  // Passage en mode reveal final : affiche les vraies cartes pour les joueurs encore en jeu
  revealPhase = true;
  for (i = 0; i < players.length; i++) {
    var hilite = 0;
    if (best_hand_players && best_hand_players[i]) {
      hilite = 2;
    } else if (players[i].status !== "FOLD" && players[i].status !== "BUST") {
      hilite = 1;
    }
    write_player(i, hilite, 1);
  }

  // Traitement des allocations et mise à jour finale de l'affichage
  for (i = 0; i < allocations.length; i++) {
    if (allocations[i] > 0) {
      var a_string = "" + allocations[i];
      var dot_index = a_string.indexOf(".");
      if (dot_index > 0) {
        a_string = "" + a_string + "00";
        allocations[i] = a_string.substring(0, dot_index + 3) - 0;
      }
      winner_text += winning_hands[i] + " gives " + allocations[i] +
                     " to " + players[i].name + ". ";
      players[i].bankroll += allocations[i];
      if (best_hand_players && best_hand_players[i]) {
        write_player(i, 2, 1);
      } else {
        write_player(i, 1, 1);
      }
    } else {
      if (!has_money(i) && players[i].status !== "BUST") {
        players[i].status = "BUST";
        if (i === 0) {
          human_loses = 1;
        }
      }
      if (players[i].status !== "FOLD") {
        write_player(i, 0, 1);
      }
    }
  }

  if (allocations[0] > 5) {
    HUMAN_WINS_AGAIN++;
  } else {
    HUMAN_WINS_AGAIN = 0;
  }

  var detail = "";
  for (i = 0; i < players.length; i++) {
    if (players[i].total_bet == 0 && players[i].status == "BUST") {
      continue;
    }
    detail += players[i].name + " bet " + players[i].total_bet + " & got " +
              allocations[i] + ".\n";
  }
  detail = " <a href='javascript:alert(\"" + detail + "\")'></a>";

  var quit_text = "<font color=red></font>";
  var quit_func = new_game;
  var continue_text = "<font color=green></font>";
  var continue_func = new_round;

  if (players[0].status == "BUST" && !human_loses) {
    continue_text = 0;
    quit_func = function() {
      parent.STOP_AUTOPLAY = 1;
    };
    setTimeout(autoplay_new_round, 1500 + 1100 * global_speed);
  } else {
    // Lancer automatiquement le prochain round après 8 secondes
    setTimeout(function() {
      continue_func();
      // Réinitialisation pour le prochain round
      revealPhase = false;
    }, 8000);
  }

  var num_playing = number_of_active_players();
  if (num_playing < 2) {
    for (i = 0; i < players.length; i++) {
      if (has_money(i)) {
        players[i].bankroll += pot_remainder;
        pot_remainder = 0;
      }
    }
  }
  if (pot_remainder) {
    var local_text = "There is " + pot_remainder + " put into next pot\n";
    detail += local_text;
  }
  console.log("winner_text:", winner_text, "detail:", detail, "pot:", get_pot_size_html());

  // --- AFFICHAGE DU MESSAGE DE FIN DE ROUND ---
  // Construction du contenu final du message
  var finalMessageContent =
      "<div id='pot-display'>" + (get_pot_size_html() || "") + "</div>" +
      "<div id='winning-text'>Winning: " + (winner_text || "") + "</div>" +
      "<div id='round-detail'>" + (detail || "") + "</div>";

  // Vérifie si le conteneur "end-game-message" existe déjà
  var endMsgElem = document.getElementById('end-game-message');
  if (!endMsgElem) {
    // S'il n'existe pas, le créer et l'insérer via gui_write_game_response
    var containerHTML = "<div id='end-game-message' style='position: fixed; top: 50px; left: 50%; transform: translateX(-50%);'></div>";
    gui_write_game_response(containerHTML);
    endMsgElem = document.getElementById('end-game-message');
  }
  // Met à jour le contenu du conteneur avec le message final (une seule fois)
  endMsgElem.innerHTML = finalMessageContent;

  // Configuration des boutons Fold/Call/Raise
  gui_setup_fold_call_click(quit_text,
                            continue_text,
                            quit_func,
                            continue_func);

  var elapsed_milliseconds = ((new Date()) - START_DATE);
  var elapsed_time = makeTimeString(elapsed_milliseconds);


  if (human_loses == 1) {
    var finalMessageContent =
      "<div style='display: block; color: orange !important; font-size: 18px !important;'>" +
        "Sorry, You Lost." +
      "</div>" +
      "<div style='display: block; color: orange !important; font-size: 18px !important; white-space: normal !important;'>" +
        (winner_text || "").replace(/\n/g, "<br>") +
      "</div>";
      
    document.getElementById('end-game-message').innerHTML = finalMessageContent;
    my_pseudo_alert("Sorry, You Lost.\n" + winner_text);
  }  
}

function autoplay_new_round () {
  if (STOP_AUTOPLAY > 0) {
    STOP_AUTOPLAY = 0;
    new_game();
  } else {
    new_round();
  }
}

function ready_for_next_card () {
  var num_betting = get_num_betting();
  var i;
  for (i = 0; i < players.length; i++) {
    players[i].total_bet += players[i].subtotal_bet;
  }
  clear_bets();
  if (board[4]) {
    handle_end_of_round();
    return;
  }
  current_min_raise = BIG_BLIND;
  reset_player_statuses(2);
  if (players[button_index].status == "FOLD") {
    players[get_next_player_position(button_index, -1)].status = "OPTION";
  } else {
    players[button_index].status = "OPTION";
  }
  current_bettor_index = get_next_player_position(button_index, 1);
  var show_cards = 0;
  if (num_betting < 2) {
    show_cards = 1;
  }

  if (!RUN_EM) {
    for (i = 0; i < players.length; i++) { // <-- UNROLL
      if (players[i].status != "BUST" && players[i].status != "FOLD") {
        write_player(i, 0, show_cards);
      }
    }
  }

  if (num_betting < 2) {
    RUN_EM = 1;
  }
  if (!board[0]) {
    deal_flop();
  } else if (!board[3]) {
    deal_fourth();
  } else if (!board[4]) {
    deal_fifth();
  }
}

function the_bet_function (player_index, bet_amount) {
  if (players[player_index].status == "FOLD") {
    return 0;
    // FOLD ;
  } else if (bet_amount >= players[player_index].bankroll) { // ALL IN
    bet_amount = players[player_index].bankroll;

    var old_current_bet = current_bet_amount;

    if (players[player_index].subtotal_bet + bet_amount > current_bet_amount) {
      current_bet_amount = players[player_index].subtotal_bet + bet_amount;
    }

    // current_min_raise should be calculated earlier ? <--
    var new_current_min_raise = current_bet_amount - old_current_bet;
    if (new_current_min_raise > current_min_raise) {
      current_min_raise = new_current_min_raise;
    }
    players[player_index].status = "CALL";
  } else if (bet_amount + players[player_index].subtotal_bet ==
             current_bet_amount) { // CALL
    players[player_index].status = "CALL";
  } else if (current_bet_amount >
             players[player_index].subtotal_bet + bet_amount) { // 2 SMALL
    // COMMENT OUT TO FIND BUGS
    if (player_index == 0) {
      my_pseudo_alert("The current bet to match is " + current_bet_amount +
                      "\nYou must bet a total of at least " +
                      (current_bet_amount - players[player_index].subtotal_bet) +
                      " or fold.");
    }
    return 0;
  } else if (bet_amount + players[player_index].subtotal_bet >
             current_bet_amount && // RAISE 2 SMALL
             get_pot_size() > 0 &&
             bet_amount + players[player_index].subtotal_bet - current_bet_amount < current_min_raise) {
    // COMMENT OUT TO FIND BUGS
    if (player_index == 0) {
      my_pseudo_alert("Minimum raise is currently " + current_min_raise + ".");
    }
    return 0;
  } else { // RAISE
    players[player_index].status = "CALL";

    var previous_current_bet = current_bet_amount;
    current_bet_amount = players[player_index].subtotal_bet + bet_amount;

    if (get_pot_size() > 0) {
      current_min_raise = current_bet_amount - previous_current_bet;
      if (current_min_raise < BIG_BLIND) {
        current_min_raise = BIG_BLIND;
      }
    }
  }
  players[player_index].subtotal_bet += bet_amount;
  players[player_index].bankroll -= bet_amount;
  var current_pot_size = get_pot_size();
  gui_write_basic_general(current_pot_size);
  return 1;
}

function handle_human_bet(bet_amount) {
  if (bet_amount < 0 || isNaN(bet_amount)) bet_amount = 0;
  var to_call = current_bet_amount - players[0].subtotal_bet;
  console.log("to_call:", to_call, "subtotal_bet:", players[0].subtotal_bet, "current_bet_amount:", current_bet_amount);
  bet_amount += to_call;
  console.log("Total bet_amount after adding to_call:", bet_amount);
  var is_ok_bet = the_bet_function(0, bet_amount);
  document.getElementById("raise-button").style.display = "none";
  if (is_ok_bet) {
    players[0].status = "CALL";
    current_bettor_index = get_next_player_position(0, 1);
    write_player(0, 0, 0);
    main();
  } else {
    crash_me();
  }
}

function bet_from_bot (x) {
  var b = 0;
  var n = current_bet_amount - players[x].subtotal_bet;
  if (!board[0]) b = bot_get_preflop_bet();
  else b = bot_get_postflop_bet();
  if (b >= players[x].bankroll) { // ALL IN
    players[x].status = "";
  } else if (b < n) { // BET 2 SMALL
    b = 0;
    players[x].status = "FOLD";
  } else if (b == n) { // CALL
    players[x].status = "CALL";
  } else if (b > n) {
    if (b - n < current_min_raise) { // RAISE 2 SMALL
      b = n;
      players[x].status = "CALL";
    } else {
      players[x].status = ""; // RAISE
    }
  }
  if (the_bet_function(x, b) == 0) {
    players[x].status = "FOLD";
    the_bet_function(x, 0);
  }
  write_player(current_bettor_index, 0, 0);
  current_bettor_index = get_next_player_position(current_bettor_index, 1);
  main();
}

// Variable globale de phase de révélation
var revealPhase = false;  // false pendant la partie, true au moment du reveal final

function write_player(n, hilite, show_cards) {
  var carda = "";
  var cardb = "";
  var name_background_color = "";
  var name_font_color = "";
  
  // Définir les couleurs selon l'état du joueur
  if (hilite == 1) {            // Joueur actif
    name_background_color = BG_HILITE;
    name_font_color = 'black';
  } else if (hilite == 2) {       // Joueur gagnant
    name_background_color = 'red';
  }
  if (players[n].status == "FOLD") {
    name_font_color = 'black';
    name_background_color = 'gray';
  }
  if (players[n].status == "BUST") {
    name_font_color = 'white';
    name_background_color = 'black';
  }
  gui_hilite_player(name_background_color, name_font_color, n);

  // Appliquer la classe "winning-hand" si nécessaire
  var seatElem = document.getElementById("seat" + n);
  if (seatElem) {
    if (hilite == 2) {
      seatElem.classList.add("winning-hand");
    } else {
      seatElem.classList.remove("winning-hand");
    }
  }
  
  // Pour le joueur humain, on force l'affichage de ses cartes même s'il est BUST ou FOLD
  if (n === 0 && (players[0].status == "BUST" || players[0].status == "FOLD")) {
    show_cards = true;
  }
  
  // Pour la première carte
  if (players[n].carda) {
    if (n === 0) {
      // Le joueur humain voit toujours ses cartes
      carda = players[n].carda;
    } else if (players[n].status == "FOLD") {
      // Si le joueur est fold, on laisse en "blinded"
      carda = "blinded";
    } else {
      // Pour les autres joueurs, utilise le paramètre show_cards pour déterminer l'affichage
      carda = show_cards ? players[n].carda : "blinded";
    }
  }
  
  // Pour la deuxième carte
  if (players[n].cardb) {
    if (n === 0) {
      cardb = players[n].cardb;
    } else if (players[n].status == "FOLD") {
      cardb = "blinded";
    } else {
      cardb = show_cards ? players[n].cardb : "blinded";
    }
  }
  
  if (n == button_index) {
    gui_place_dealer_button(n);
  }
  
  var bet_text = "TO BE OVERWRITTEN";
  var allin = "Bet:";
  
  if (players[n].status == "FOLD") {
    bet_text = "DROPED (" + (players[n].subtotal_bet + players[n].total_bet) + ")";
    if (n == 0) {
      HUMAN_GOES_ALL_IN = 0;
    }
  } else if (players[n].status == "BUST") {
    bet_text = "BUSTED";
    if (n == 0) {
      HUMAN_GOES_ALL_IN = 0;
    }
  } else if (!has_money(n)) {
    bet_text = "ALL IN (" + (players[n].subtotal_bet + players[n].total_bet) + ")";
    if (n == 0) {
      HUMAN_GOES_ALL_IN = 1;
    }
  } else {
    bet_text = allin + "$" + players[n].subtotal_bet + " (" + (players[n].subtotal_bet + players[n].total_bet) + ")";
  }
  
  gui_set_player_name(players[n].name, n);
  gui_set_bet(bet_text, n);
  gui_set_bankroll(players[n].bankroll, n);
  gui_set_player_cards(carda, cardb, n, false);
}

function make_readable_rank (r) {
  if (r < 11) {
    return r;
  } else if (r == 11) {
    return "J";
  } else if (r == 12) {
    return "Q";
  } else if (r == 13) {
    return "K";
  } else if (r == 14) {
    return "A";
  }
}

function get_pot_size () {
  var p = 0;
  for (var i = 0; i < players.length; i++) {
    p += players[i].total_bet + players[i].subtotal_bet;
  }
  return p;
}

function get_pot_size_html () {
  return "";
}

function clear_bets () {
  for (var i = 0; i < players.length; i++) {
    players[i].subtotal_bet = 0;
  }
  current_bet_amount = 0;
}

function clear_pot () {
  for (var i = 0; i < players.length; i++) {
    players[i].total_bet = 0;
  }
}

function reset_player_statuses (type) {
  for (var i = 0; i < players.length; i++) {
    if (type == 0) {
      players[i].status = "";
    } else if (type == 1 && players[i].status != "BUST") {
      players[i].status = "";
    } else if (type == 2 &&
               players[i].status != "FOLD" &&
               players[i].status != "BUST") {
      players[i].status = "";
    }
  }
}

function get_num_betting () {
  var n = 0;
  for (var i = 0; i < players.length; i++) {
    if (players[i].status != "FOLD" &&
        players[i].status != "BUST" &&
        has_money(i)) {
      n++;
    }
  }
  return n;
}

function change_name () {
  var name = prompt("What is your name?", getLocalStorage("playername"));
  if (!name) {
    return;
  }
  if (!players) {
    my_pseudo_alert("Too early to get a name");
    return;
  }
  if (name.length > 14) {
    my_pseudo_alert("Too long, I will call you Sue");
    name = "Sue";
  }
  players[0].name = name;
  write_player(0, 0, 0);
  setLocalStorage("playername", name);
}

function help_func () {
  var win = window.open('help.html', '_blank');
  win.focus();
}

function update_func () {
  var url = 'https://sourceforge.net/projects/js-css-poker/files/';
  var win = window.open(url, '_blank');
  win.focus();
}

function write_settings_frame () {
  var default_speed = 2;
  var speed_i = getLocalStorage("gamespeed");
  if (speed_i == "") {
    speed_i = default_speed;
  }
  if (speed_i == null ||
      (speed_i != 0 &&
       speed_i != 1 &&
       speed_i != 2 &&
       speed_i != 3 &&
       speed_i != 4)) {
    speed_i = default_speed;
  }
  set_speed(speed_i);
}

function index2speed (index) {
  var speeds = ['2', '1', '.6', '.3', '0.01'];
  return speeds[index];
}

function set_speed (index) {
  global_speed = index2speed(index);
  setLocalStorage("gamespeed", index);
}

function set_raw_speed (selector_index) {
  // check that selector_index = [1,5]
  if (selector_index < 1 || selector_index > 5) {
    my_pseudo_alert("Cannot set speed to " + selector_index);
    selector_index = 3;
  }
  var index = selector_index - 1;
  set_speed(index);
}

function get_next_player_position (i, delta) {
  var j = 0;
  var step = 1;
  if (delta < 0) step = -1;

  var loop_on = 0;
  do {
    i += step;
    if (i >= players.length) {
      i = 0;
    } else {
      if (i < 0) {
        i = players.length - 1;
      }
    }

    // Check if we can stop
    loop_on = 0;
    if (players[i].status == "BUST") loop_on = 1;
    if (players[i].status == "FOLD") loop_on = 1;
    if (++j < delta) loop_on = 1;
  } while (loop_on);

  return i;
}

function getLocalStorage (key) {
  return localStorage.getItem(key);
}

function setLocalStorage (key, value) {
  return localStorage.setItem(key, value);
}

function has_money (i) {
  if (players[i].bankroll >= 0.01) {
    return true;
  }
  return false;
}

function compRan () {
  return 0.5 - Math.random();
}

function my_local_subtime (invalue, fractionizer) {
  var quotient = 0;
  var remainder = invalue;
  if (invalue > fractionizer) {
    quotient = Math.floor(invalue / fractionizer);
    remainder = invalue - quotient * fractionizer;
  }
  return [quotient, remainder];
}

function getTimeText (string, number, text) {
  if (number == 0) return string;
  if (string.length > 0) {
    string += " ";
  }
  if (number == 1) {
    string = string + "1 " + text;
  } else {
    string = string + number + " " + text + "s";
  }
  return string;
}

function makeTimeString (milliseconds) {
  var _MS_PER_SECOND = 1000;
  var _MS_PER_MINUTE = 1000 * 60;
  var _MS_PER_HOUR = _MS_PER_MINUTE * 60;
  var _MS_PER_DAY = 1000 * 60 * 60 * 24;
  var _MS_PER_WEEK = _MS_PER_DAY * 7;
  var weeks = 0;
  var days = 0;
  var hours = 0;
  var minutes = 0;
  var seconds = 0;
  [weeks, milliseconds] = my_local_subtime(milliseconds, _MS_PER_WEEK);
  [days, milliseconds] = my_local_subtime(milliseconds, _MS_PER_DAY);
  [hours, milliseconds] = my_local_subtime(milliseconds, _MS_PER_HOUR);
  [minutes, milliseconds] = my_local_subtime(milliseconds, _MS_PER_MINUTE);
  [seconds, milliseconds] = my_local_subtime(milliseconds, _MS_PER_SECOND);

  var string = "";
  string = getTimeText(string, weeks, "week");
  string = getTimeText(string, days, "day");
  string = getTimeText(string, hours, "hour");
  string = getTimeText(string, minutes, "minute");
  string = getTimeText(string, seconds, "second");

  return (string);
}

