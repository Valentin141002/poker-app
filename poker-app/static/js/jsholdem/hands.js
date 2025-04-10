"use strict";

// Liste des tests dans l'ordre décroissant de force des combinaisons.
var tests = ["straight_flush", "four_of_a_kind", "full_house", "flush", "straight", "three_of_a_kind", "two_pair", "one_pair", "hi_card"];

/**
 * Parcourt les différents tests afin de déterminer les gagnants parmi les joueurs.
 * @param {Array} my_players - Tableau des joueurs à évaluer.
 * @returns {Array|null} Tableau indiquant pour chaque joueur s’il fait partie des gagnants, ou null si aucun n’a validé le test.
 */
function get_winners(my_players) {
  var winners;
  for (var i = 0; i < tests.length; i++) {
    winners = winners_helper(my_players, tests[i]);
    if (winners) {
      // Dès qu'un test valide des gagnants, on s'arrête
      break;
    }
  }
  return winners;
}

/**
 * Exécute le test demandé pour un joueur donné.
 * @param {string} string - Nom du test à exécuter.
 * @param {Object} player - Objet joueur.
 * @returns {Object} Résultat du test sous forme d'objet avec des informations (nombre de cartes nécessaires, etc.).
 */
function execute_test(string, player) {
  if (string === 'test_straight_flush') return test_straight_flush(player);
  if (string === 'test_four_of_a_kind') return test_four_of_a_kind(player);
  if (string === 'test_full_house') return test_full_house(player);
  if (string === 'test_flush') return test_flush(player);
  if (string === 'test_straight') return test_straight(player);
  if (string === 'test_three_of_a_kind') return test_three_of_a_kind(player);
  if (string === 'test_two_pair') return test_two_pair(player);
  if (string === 'test_one_pair') return test_one_pair(player);
  if (string === 'test_hi_card') return test_hi_card(player);
  alert("execute_test() cannot tokenize " + string);
}

/**
 * Compare les résultats de deux tests et retourne "a" si le premier gagne,
 * "b" si le second gagne ou "c" en cas d'égalité.
 */
function execute_compare(string, hand_in, best_hand) {
  if (string === 'compare_straight_flush') return compare_straight_flush(hand_in, best_hand);
  if (string === 'compare_four_of_a_kind') return compare_four_of_a_kind(hand_in, best_hand);
  if (string === 'compare_full_house') return compare_full_house(hand_in, best_hand);
  if (string === 'compare_flush') return compare_flush(hand_in, best_hand);
  if (string === 'compare_straight') return compare_straight(hand_in, best_hand);
  if (string === 'compare_three_of_a_kind') return compare_three_of_a_kind(hand_in, best_hand);
  if (string === 'compare_two_pair') return compare_two_pair(hand_in, best_hand);
  if (string === 'compare_one_pair') return compare_one_pair(hand_in, best_hand);
  if (string === 'compare_hi_card') return compare_hi_card(hand_in, best_hand);
  alert("execute_compare() cannot tokenize " + string);
}

/**
 * Pour un test donné, compare les résultats obtenus par chaque joueur et constitue le tableau des gagnants.
 */
function winners_helper(my_players, test) {
  var best;
  var winners = new Array(my_players.length);
  for (var i = 0; i < my_players.length; i++) {
    if (!my_players[i]) continue; // Joueur absent, BUST ou FOLD
    var a = execute_test("test_" + test, my_players[i]);
    var num_needed = a["num_needed"];
    if (num_needed > 0 || (num_needed === 0 && num_needed !== "0")) continue;
    if (typeof best === 'undefined') {
      best = a;
      winners = new Array(my_players.length);
      winners[i] = a;
    } else {
      var comp = execute_compare("compare_" + test, a, best);
      if (comp === "a") { // a remplace le meilleur
        best = a;
        winners = new Array(my_players.length);
        winners[i] = a;
      } else if (comp === "b") {
        // best reste inchangé
      } else if (comp === "c") { // Egalité, on ajoute ce joueur comme gagnant
        winners[i] = a;
      }
    }
  }
  for (i = 0; i < winners.length; i++) {
    if (winners[i]) return winners;
  }
  return null;
}

// --- Tests individuels pour chaque type de main ---

function test_straight_flush(player) {
  var my_cards = group_cards(player);
  var the_suit = get_predominant_suit(my_cards);
  var working_cards = new Array(8);
  var working_index = 0;
  for (var i = 0; i < 7; i++) {
    if (get_suit(my_cards[i]) === the_suit) {
      var my_rank = get_rank(my_cards[i]);
      working_cards[working_index++] = my_rank;
      if (my_rank === 14) {
        working_cards[7] = 1; // Considérer l'As comme valeur 1 aussi
      }
    }
  }
  // Remplacer les éventuels index undefined
  for (i = 0; i < working_cards.length; i++) {
    if (working_cards[i] == null) working_cards[i] = -1;
  }
  working_cards.sort(compNum);
  var absolute_longest_stretch = 0;
  var absolute_hi_card = 0;
  var current_longest_stretch = 1;
  var current_hi_card = 0;
  for (i = 0; i < 8; i++) {
    var a = working_cards[i];
    var b = working_cards[i + 1];
    if (a && b && a - b === 1) {
      current_longest_stretch++;
      if (current_hi_card < 1) current_hi_card = a;
    } else if (a) {
      if (current_longest_stretch > absolute_longest_stretch) {
        absolute_longest_stretch = current_longest_stretch;
        if (current_hi_card < 1) current_hi_card = a;
        absolute_hi_card = current_hi_card;
      }
      current_longest_stretch = 1;
      current_hi_card = 0;
    }
  }
  var num_mine = 0;
  for (i = 0; i < absolute_longest_stretch; i++) {
    if (the_suit + (absolute_hi_card - i) === player.carda || the_suit + (absolute_hi_card - i) === player.cardb)
      num_mine++;
  }
  var hash_result = {
    "straight_hi": absolute_hi_card,
    "num_needed": 5 - absolute_longest_stretch,
    "num_mine": num_mine,
    "hand_name": "Straight Flush"
  };
  return hash_result;
}

function compare_straight_flush(a, b) {
  return compare_straight(a, b);
}

function test_four_of_a_kind(player) {
  var my_cards = group_cards(player);
  var ranks = new Array(13).fill(0);
  for (var i = 0; i < my_cards.length; i++) {
    ranks[get_rank(my_cards[i]) - 2]++;
  }
  var four = "";
  var kicker = "";
  for (i = 0; i < 13; i++) {
    if (ranks[i] === 4) {
      four = i + 2;
    } else if (ranks[i] > 0) {
      kicker = i + 2;
    }
  }
  var num_mine = 0;
  if (get_rank(player.carda) === four) num_mine++;
  if (get_rank(player.cardb) === four) num_mine++;
  var num_needed = four ? 0 : 4;
  var hash_result = {
    "rank": four,
    "kicker": kicker,
    "num_needed": num_needed,
    "num_mine": num_mine,
    "hand_name": "Four of a Kind"
  };
  return hash_result;
}

function compare_four_of_a_kind(a, b) {
  if (a["rank"] > b["rank"]) return "a";
  if (b["rank"] > a["rank"]) return "b";
  if (a["kicker"] > b["kicker"]) return "a";
  if (b["kicker"] > a["kicker"]) return "b";
  return "c";
}

function test_full_house(player) {
  var my_cards = group_cards(player);
  var ranks = new Array(13).fill(0);
  for (var i = 0; i < my_cards.length; i++) {
    ranks[get_rank(my_cards[i]) - 2]++;
  }
  var three = "";
  var two = "";
  for (i = 0; i < 13; i++) {
    if (ranks[i] === 3) {
      if (three > two) {
        two = three;
      }
      three = i + 2;
    } else if (ranks[i] === 2) {
      two = i + 2;
    }
  }
  var num_needed = 5;
  var major_rank = "";
  var num_mine_major = 0;
  if (three) {
    num_needed -= 3;
    major_rank = three;
    if (get_rank(player.carda) === three) num_mine_major++;
    if (get_rank(player.cardb) === three) num_mine_major++;
  }
  var minor_rank = "";
  var num_mine_minor = 0;
  if (two) {
    num_needed -= 2;
    minor_rank = two;
    if (get_rank(player.carda) === two) num_mine_minor++;
    if (get_rank(player.cardb) === two) num_mine_minor++;
  }
  var hash_result = {
    "major_rank": major_rank,
    "num_mine_major": num_mine_major,
    "minor_rank": minor_rank,
    "num_mine_minor": num_mine_minor,
    "num_mine": num_mine_major + num_mine_minor,
    "num_needed": num_needed,
    "hand_name": "Full House"
  };
  return hash_result;
}

function compare_full_house(a, b) {
  if (a["major_rank"] > b["major_rank"]) return "a";
  if (b["major_rank"] > a["major_rank"]) return "b";
  if (a["minor_rank"] > b["minor_rank"]) return "a";
  if (b["minor_rank"] > a["minor_rank"]) return "b";
  return "c";
}

function test_flush(player) {
  var my_cards = group_cards(player);
  var the_suit = get_predominant_suit(my_cards);
  var working_cards = [];
  var num_in_flush = 0;
  for (var i = 0; i < my_cards.length; i++) {
    if (get_suit(my_cards[i]) === the_suit) {
      num_in_flush++;
      working_cards.push(get_rank(my_cards[i]));
    }
  }
  // Remplacer les éventuelles valeurs manquantes
  for (i = 0; i < working_cards.length; i++) {
    if (working_cards[i] == null) working_cards[i] = -1;
  }
  working_cards.sort(compNum);
  var hash_result = {};
  var num_mine = 0;
  for (i = 0; i < 5; i++) {
    hash_result["flush_" + i] = working_cards[i] || "";
    if (the_suit + working_cards[i] === player.carda || the_suit + working_cards[i] === player.cardb)
      num_mine++;
  }
  hash_result["num_needed"] = 5 - num_in_flush;
  hash_result["num_mine"] = num_mine;
  hash_result["suit"] = the_suit;
  hash_result["hand_name"] = "Flush";
  return hash_result;
}

function compare_flush(a, b) {
  for (var i = 0; i < 5; i++) {
    if (a["flush_" + i] > b["flush_" + i]) return "a";
    if (b["flush_" + i] > a["flush_" + i]) return "b";
  }
  return "c";
}

function test_straight(player) {
  var my_cards = group_cards(player);
  var working_cards = [];
  var ranks = new Array(13).fill(0);
  for (var i = 0; i < 7; i++) {
    var my_rank = get_rank(my_cards[i]);
    if (!ranks[my_rank - 2]) {
      ranks[my_rank - 2] = 1;
      working_cards.push(my_rank);
      if (my_rank === 14) working_cards[7] = 1; // L'As est considéré aussi comme 1
    }
  }
  for (i = 0; i < working_cards.length; i++) {
    if (working_cards[i] == null) working_cards[i] = -1;
  }
  working_cards.sort(compNum);
  var absolute_longest_stretch = 0;
  var absolute_hi_card = 0;
  var current_longest_stretch = 1;
  var current_hi_card = 0;
  for (i = 0; i < 8; i++) {
    var a = working_cards[i];
    var b = working_cards[i + 1];
    if (a && b && a - b === 1) {
      current_longest_stretch++;
      if (current_hi_card < 1) current_hi_card = a;
    } else if (a) {
      if (current_longest_stretch > absolute_longest_stretch) {
        absolute_longest_stretch = current_longest_stretch;
        if (current_hi_card < 1) current_hi_card = a;
        absolute_hi_card = current_hi_card;
      }
      current_longest_stretch = 1;
      current_hi_card = 0;
    }
  }
  var num_mine = 0;
  for (i = 0; i < absolute_longest_stretch; i++) {
    if (absolute_hi_card - i === get_rank(player.carda) ||
        absolute_hi_card - i === get_rank(player.cardb)) num_mine++;
  }
  var hash_result = {
    "straight_hi": absolute_hi_card,
    "num_needed": 5 - absolute_longest_stretch,
    "num_mine": num_mine,
    "hand_name": "Straight"
  };
  return hash_result;
}

function compare_straight(a, b) {
  if (a["straight_hi"] > b["straight_hi"]) return "a";
  if (b["straight_hi"] > a["straight_hi"]) return "b";
  return "c";
}

function test_three_of_a_kind(player) {
  var my_cards = group_cards(player);
  var ranks = new Array(13).fill(0);
  for (var i = 0; i < my_cards.length; i++) {
    ranks[get_rank(my_cards[i]) - 2]++;
  }
  var three = "";
  var kicker_1 = "";
  var kicker_2 = "";
  for (i = 0; i < 13; i++) {
    if (ranks[i] === 3) {
      three = i + 2;
    } else if (ranks[i] === 1) {
      kicker_2 = kicker_1;
      kicker_1 = i + 2;
    } else if (ranks[i] > 1) {
      kicker_1 = i + 2;
      kicker_2 = i + 2;
    }
  }
  var num_mine = 0;
  if (get_rank(player.carda) === three) num_mine++;
  if (get_rank(player.cardb) === three) num_mine++;
  var num_needed = three ? 0 : 3;
  var hash_result = {
    "rank": three,
    "num_needed": num_needed,
    "num_mine": num_mine,
    "kicker_1": kicker_1,
    "kicker_2": kicker_2,
    "hand_name": "Three of a Kind"
  };
  return hash_result;
}

function compare_three_of_a_kind(a, b) {
  if (a["rank"] > b["rank"]) return "a";
  if (b["rank"] > a["rank"]) return "b";
  if (a["kicker_1"] > b["kicker_1"]) return "a";
  if (b["kicker_1"] > a["kicker_1"]) return "b";
  if (a["kicker_2"] > b["kicker_2"]) return "a";
  if (b["kicker_2"] > a["kicker_2"]) return "b";
  return "c";
}

function test_two_pair(player) {
  var my_cards = group_cards(player);
  var ranks = new Array(13).fill(0);
  for (var i = 0; i < my_cards.length; i++) ranks[i] = 0;
  for (i = 0; i < my_cards.length; i++) ranks[get_rank(my_cards[i]) - 2]++;
  var first = "";
  var second = "";
  var kicker = "";
  for (i = 12; i > -1; i--) {
    if (ranks[i] === 2) {
      if (!first) {
        first = i + 2;
      } else if (!second) {
        second = i + 2;
      } else if (!kicker) {
        kicker = i + 2;
      } else {
        break;
      }
    } else if (!kicker && ranks[i] > 0) {
      kicker = i + 2;
    }
  }
  var num_mine = 0;
  if (get_rank(player.carda) === first || get_rank(player.carda) === second) num_mine++;
  if (get_rank(player.cardb) === first || get_rank(player.cardb) === second) num_mine++;
  var num_needed = first ? (second ? 0 : 1) : 2;
  var hash_result = {
    "rank_1": first,
    "rank_2": second,
    "num_needed": num_needed,
    "num_mine": num_mine,
    "kicker": kicker,
    "hand_name": "Two Pair"
  };
  return hash_result;
}

function compare_two_pair(a, b) {
  if (a["rank_1"] > b["rank_1"]) return "a";
  if (b["rank_1"] > a["rank_1"]) return "b";
  if (a["rank_2"] > b["rank_2"]) return "a";
  if (b["rank_2"] > a["rank_2"]) return "b";
  if (a["kicker"] > b["kicker"]) return "a";
  if (b["kicker"] > a["kicker"]) return "b";
  return "c";
}

function test_one_pair(player) {
  var my_cards = group_cards(player);
  var ranks = new Array(13).fill(0);
  for (var i = 0; i < my_cards.length; i++) {
    ranks[get_rank(my_cards[i]) - 2]++;
  }
  var pair = 0;
  var kicker_1 = "";
  var kicker_2 = "";
  var kicker_3 = "";
  for (i = 0; i < 13; i++) {
    if (ranks[i] === 2) {
      pair = i + 2;
    } else if (ranks[i] === 1) {
      kicker_3 = kicker_2;
      kicker_2 = kicker_1;
      kicker_1 = i + 2;
    } else if (ranks[i] > 2) {
      kicker_1 = i + 2;
      kicker_2 = i + 2;
      kicker_3 = i + 2;
    }
  }
  var num_mine = 0;
  if (get_rank(player.carda) === pair) num_mine++;
  if (get_rank(player.cardb) === pair) num_mine++;
  var num_needed = pair ? 0 : 1;
  var hash_result = {
    "rank": pair,
    "num_needed": num_needed,
    "num_mine": num_mine,
    "kicker_1": kicker_1,
    "kicker_2": kicker_2,
    "kicker_3": kicker_3,
    "hand_name": "One Pair"
  };
  return hash_result;
}

function compare_one_pair(a, b) {
  if (a["rank"] > b["rank"]) return "a";
  if (b["rank"] > a["rank"]) return "b";
  if (a["kicker_1"] > b["kicker_1"]) return "a";
  if (b["kicker_1"] > a["kicker_1"]) return "b";
  if (a["kicker_2"] > b["kicker_2"]) return "a";
  if (b["kicker_2"] > a["kicker_2"]) return "b";
  if (a["kicker_3"] > b["kicker_3"]) return "a";
  if (b["kicker_3"] > a["kicker_3"]) return "b";
  return "c";
}

function test_hi_card(player) {
  var my_cards = group_cards(player);
  var working_cards = [];
  for (var i = 0; i < my_cards.length; i++) {
    working_cards.push(get_rank(my_cards[i]));
  }
  for (i = 0; i < working_cards.length; i++) {
    if (working_cards[i] == null) working_cards[i] = -1;
  }
  working_cards.sort(compNum);
  var hash_result = {};
  for (i = 0; i < 5; i++) {
    hash_result["hi_card_" + i] = working_cards[i] || "";
  }
  hash_result["num_needed"] = 0;
  hash_result["hand_name"] = "High Card";
  return hash_result;
}

function compare_hi_card(a, b) {
  for (var i = 0; i < 5; i++) {
    if (a["hi_card_" + i] > b["hi_card_" + i]) return "a";
    if (b["hi_card_" + i] > a["hi_card_" + i]) return "b";
  }
  return "c";
}

// --- Fonctions d'accès aux cartes ---

function get_suit(card) {
  return card ? card.substring(0, 1) : "";
}

function get_rank(card) {
  return card ? (card.substring(1) - 0) : "";
}

/**
 * Retourne la couleur prédominante parmi l’ensemble des cartes d’un joueur.
 */
function get_predominant_suit(my_cards) {
  var suit_count = [0, 0, 0, 0];
  for (var i = 0; i < my_cards.length; i++) {
    var s = get_suit(my_cards[i]);
    if (s === "c") suit_count[0]++;
    else if (s === "s") suit_count[1]++;
    else if (s === "h") suit_count[2]++;
    else if (s === "d") suit_count[3]++;
  }
  var suit_index = 0;
  if (suit_count[1] > suit_count[suit_index]) suit_index = 1;
  if (suit_count[2] > suit_count[suit_index]) suit_index = 2;
  if (suit_count[3] > suit_count[suit_index]) suit_index = 3;
  if (suit_index === 0) return "c";
  if (suit_index === 1) return "s";
  if (suit_index === 2) return "h";
  if (suit_index === 3) return "d";
  return "";
}

/**
 * Rassemble les cartes communes (board) et les cartes privées d'un joueur.
 * @param {Object} player - Le joueur dont on veut regrouper les cartes.
 * @returns {Array} Tableau de 7 cartes (5 board + 2 privées)
 */
function group_cards(player) {
  var c = new Array(7);
  for (var i = 0; i < 5; i++) {
    c[i] = board[i];
  }
  c[5] = player.carda;
  c[6] = player.cardb;
  return c;
}

function compNum(a, b) {
  return b - a;
}