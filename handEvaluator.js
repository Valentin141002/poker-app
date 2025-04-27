// handEvaluator.js

// Ici, tu dois copier tout ce dont on a besoin pour calculer les mains
// depuis ton hands.js :
//   - l'array `tests`
//   - la fonction `winners_helper`
//   - toutes les fonctions utilitaires (parsing, comparaison, etc.)
//   - la fonction get_winners elle-même

// Exemple minimal (à adapter / compléter !) :
const tests = [
    /* copie ici ton tableau de tests, ex ["royalflush", "straightflush", ...] */
  ];
  
  function winners_helper(players, test) {
    // copie ici la fonction winners_helper de hands.js
    // qui teste chaque joueur pour le type de main `test`
  }
  
  function get_winners(my_players) {
    let winners;
    for (let i = 0; i < tests.length; i++) {
      winners = winners_helper(my_players, tests[i]);
      if (winners) break;
    }
    return winners;
  }
  
  module.exports = { get_winners };
  