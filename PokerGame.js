// PokerGame.js
const { Hand } = require("pokersolver");

class PokerGame {
  constructor(players, io) {
    // players: tableau d'objets { id, socket, [name], ... }
    this.players = players;
    this.io = io;
    this.deck = this.createDeck();
    this.communityCards = [];
    this.pot = 0;
    this.currentPhase = "pre-flop"; // Phases: pre-flop, flop, turn, river, showdown
    this.actions = {}; // Actions recueillies durant le round courant (clé: playerId)
    this.currentPlayerIndex = 0; // Pour déterminer l'ordre de passage
    this.timerDuration = 120000; // Durée du round en millisecondes (2 minutes)
    this.roundTimer = null;
    this.timerInterval = null;
    this.remainingTime = this.timerDuration;
    this.minimumBet = 50; // Mise minimale par défaut
    this.readyPlayers = new Set(); // Pour gérer la préparation de tous les joueurs
  }

  // Crée un deck standard de 52 cartes
  createDeck() {
    const suits = ["♠", "♥", "♦", "♣"];
    const ranks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
    let deck = [];
    for (let suit of suits) {
      for (let rank of ranks) {
        deck.push({ suit, rank });
      }
    }
    return deck;
  }

  // Mélange le deck avec l'algorithme de Fisher-Yates
  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  // Distribue 2 cartes privées à chaque joueur et initialise currentBet à 0
  dealPrivateCards() {
    this.players.forEach(player => {
      player.privateCards = [this.deck.pop(), this.deck.pop()];
      player.folded = false;
      player.allIn = false;
      player.currentBet = 0; // Réinitialiser pour le round de mise
    });
  }
  
  // Pré-délivre les 5 cartes communes pour le déroulement du jeu
  preDealCommunityCards() {
    this.communityCards = [];
    for (let i = 0; i < 5; i++) {
      this.communityCards.push(this.deck.pop());
    }
  }  

  // Démarre un round de mises pour la phase indiquée
  startBettingRound(phase) {
    this.currentPhase = phase;
    this.actions = {}; // Réinitialiser les actions du round
    this.remainingTime = this.timerDuration;

    // Notifier tous les joueurs du début du round
    this.io.in("gameRoom").emit("bettingRoundStart", {
      phase,
      pot: this.pot,
      timer: this.remainingTime,
    });
    console.log(`Round ${phase} démarré. Pot actuel: ${this.pot}`);

    // Réinitialiser l'ordre de passage pour ce round
    this.currentPlayerIndex = 0;
    this.notifyCurrentPlayer();

    // Démarrer le timer pour mettre à jour l'interface chaque seconde
    this.timerInterval = setInterval(() => {
      this.remainingTime -= 1000;
      this.io.in("gameRoom").emit("timerUpdate", { remainingTime: this.remainingTime });
    }, 1000);

    // Timer global du round : à l'expiration, auto-fold les joueurs inactifs et passe au round suivant
    this.roundTimer = setTimeout(() => {
      console.log(`Timer écoulé pour le round ${phase}.`);
      clearInterval(this.timerInterval);
      // Pour chaque joueur qui n'a pas agi et n'est pas déjà fold, appliquer un fold par défaut
      this.players.forEach(player => {
        if (!this.actions[player.id] && !player.folded) {
          console.log(`Aucune action pour ${player.id} - fold par défaut.`);
          this.registerAction(player.id, { action: "fold" });
        }
      });
      this.advanceRound();
    }, this.timerDuration);
  }

  // Notifie le joueur dont c'est le tour et informe la salle
  notifyCurrentPlayer() {
    const currentPlayer = this.players[this.currentPlayerIndex];
    if (currentPlayer && !currentPlayer.folded) {
      currentPlayer.socket.emit("yourTurn", {
        minimumBet: this.minimumBet,
        phase: this.currentPhase,
      });
      this.io.in("gameRoom").emit("currentPlayer", { playerId: currentPlayer.id });
      console.log(`C'est le tour de ${currentPlayer.id}`);
    } else if (currentPlayer) {
      // Si le joueur est déjà fold, on applique un fold automatique et passe au suivant
      this.registerAction(currentPlayer.id, { action: "fold" });
    }
  }

  // Enregistre et traite l'action d'un joueur
  registerAction(playerId, actionData) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.folded) {
      console.log(`Action ignorée pour ${playerId} (joueur introuvable ou déjà fold).`);
      return;
    }
  
    // Calculer le montant maximal déjà misé par les joueurs actifs
    const activePlayers = this.players.filter(p => !p.folded);
    const currentMaxBet = activePlayers.reduce((max, p) => {
      return (p.currentBet || 0) > max ? p.currentBet : max;
    }, 0);
  
    // Enregistrer l'action
    this.actions[playerId] = actionData;
    console.log(`Action de ${playerId}:`, actionData);
  
    switch (actionData.action) {
      case "fold":
        player.folded = true;
        break;
      case "check":
        // Le joueur doit avoir déjà misé le montant maximum pour checker
        if (player.currentBet < currentMaxBet) {
          console.log(`${player.id} ne peut pas checker, il doit call ou raise.`);
          return;
        }
        break;
      case "call": {
        const callAmount = currentMaxBet - (player.currentBet || 0);
        if (callAmount > player.chips) {
          console.log(`${player.id} n'a pas assez pour caller, il va all-in.`);
          actionData = { action: "all-in" };
        } else {
          player.chips -= callAmount;
          player.currentBet = (player.currentBet || 0) + callAmount;
          this.pot += callAmount;
        }
        this.io.in("gameRoom").emit("updatePot", { pot: this.pot });
        break;
      }
      case "raise":
      case "bet": {
        const amount = actionData.amount || 0;
        const callAmount = currentMaxBet - (player.currentBet || 0);
        if (amount < callAmount + this.minimumBet) {
          console.log(
            `${player.id} doit miser au moins ${callAmount + this.minimumBet} (call: ${callAmount}, minimum: ${this.minimumBet}).`
          );
          return;
        }
        if (amount > player.chips) {
          console.log(`${player.id} n'a pas assez de jetons pour miser ${amount}.`);
          return;
        }
        player.chips -= amount;
        player.currentBet = (player.currentBet || 0) + amount;
        this.pot += amount;
        this.io.in("gameRoom").emit("updatePot", { pot: this.pot });
        break;
      }
      case "all-in": {
        const amount = player.chips;
        player.currentBet = (player.currentBet || 0) + amount;
        player.chips = 0;
        player.allIn = true;
        this.pot += amount;
        this.io.in("gameRoom").emit("updatePot", { pot: this.pot });
        break;
      }
      default:
        console.log(`Action non reconnue: ${actionData.action}`);
        break;
    }
  
    // Passer au joueur suivant actif
    this.moveToNextPlayer();
  
    // Vérifier si tous les joueurs actifs ont agi
    const activePlayersRound = this.players.filter(p => !p.folded);
    if (Object.keys(this.actions).length >= activePlayersRound.length) {
      clearTimeout(this.roundTimer);
      clearInterval(this.timerInterval);
      this.advanceRound();
    } else {
      this.notifyCurrentPlayer();
    }
  }

  // Passe à l'ordre de passage du joueur suivant qui est actif et n'a pas encore agi
  moveToNextPlayer() {
    let nextIndex = (this.currentPlayerIndex + 1) % this.players.length;
    let count = 0;
    while (count < this.players.length) {
      const nextPlayer = this.players[nextIndex];
      if (!nextPlayer.folded && !this.actions[nextPlayer.id]) {
        this.currentPlayerIndex = nextIndex;
        return;
      }
      nextIndex = (nextIndex + 1) % this.players.length;
      count++;
    }
  }

  // Gère la transition entre les phases du jeu
  advanceRound() {
    clearInterval(this.timerInterval);
    console.log(`Fin du round ${this.currentPhase}. Actions recueillies:`, this.actions);
  
    // Réinitialiser les actions pour la nouvelle phase
    this.actions = {};
  
    if (this.currentPhase === "pre-flop") {
      // Révéler le flop (les 3 premières cartes communes)
      this.io.in("gameRoom").emit("flop", {
        cards: this.communityCards.slice(0, 3),
      });
      this.startBettingRound("flop");
    } else if (this.currentPhase === "flop") {
      // Révéler le turn (la 4e carte)
      this.io.in("gameRoom").emit("turn", {
        card: this.communityCards[3],
      });
      this.startBettingRound("turn");
    } else if (this.currentPhase === "turn") {
      // Révéler la river (la 5e carte)
      this.io.in("gameRoom").emit("river", {
        card: this.communityCards[4],
      });
      this.startBettingRound("river");
    } else if (this.currentPhase === "river") {
      // Phase de showdown : évaluation des mains
      const winners = this.evaluateHands();
      // Redistribution du pot aux gagnants
      this.distributePot(winners);
      this.io.in("gameRoom").emit("showdown", {
        communityCards: this.communityCards,
        pot: this.pot, // devrait être 0 après distribution
        winners: winners.map(w => w.playerId),
      });
      console.log("Showdown terminé. Gagnants:", winners.map(w => w.playerId));
      // Démarrer la prochaine main après un délai (ici 10 secondes)
      setTimeout(() => {
        this.resetHand();
      }, 10000);
    }
  }
  
  // Évalue les mains des joueurs actifs et retourne le(s) gagnant(s)
  evaluateHands() {
    const activePlayers = this.players.filter(p => !p.folded);
    // Si un seul joueur reste, il gagne automatiquement
    if (activePlayers.length === 1) {
      return activePlayers.map(p => ({ playerId: p.id }));
    }
    const evaluations = activePlayers.map(player => {
      const fullHand = player.privateCards.concat(this.communityCards);
      const cardStrings = fullHand.map(c => `${c.rank}${c.suit}`);
      const hand = Hand.solve(cardStrings);
      return { playerId: player.id, hand };
    });
    const winningHands = Hand.winners(evaluations.map(e => e.hand));
    return evaluations.filter(e => winningHands.includes(e.hand));
  }
  
  // Redistribue le pot aux gagnants, en partageant équitablement en cas d'égalité
  distributePot(winners) {
    if (winners.length === 0) return;
    const numWinners = winners.length;
    const share = Math.floor(this.pot / numWinners);
    winners.forEach(w => {
      const player = this.players.find(p => p.id === w.playerId);
      if (player) {
        player.chips += share;
      }
    });
    // Gérer le reste si le pot n'est pas exactement divisible
    const remainder = this.pot % numWinners;
    if (remainder > 0 && winners.length > 0) {
      const firstWinner = this.players.find(p => p.id === winners[0].playerId);
      if (firstWinner) {
        firstWinner.chips += remainder;
      }
    }
    this.pot = 0;
    // Notifier tous les joueurs de la mise à jour de leurs jetons
    this.io.in("gameRoom").emit("chipsUpdate", {
      players: this.players.map(p => ({ id: p.id, chips: p.chips }))
    });
  }
  
  // Réinitialise uniquement la main (table, deck, cartes privées et communes)
  // sans toucher aux jetons des joueurs. Les joueurs à court de jetons sont éliminés.
  resetHand() {
    // Éliminer les joueurs qui n'ont plus de jetons
    this.players = this.players.filter(player => player.chips > 0);
    // Réinitialiser l'état de chaque joueur pour la nouvelle main
    this.players.forEach(player => {
      player.currentBet = 0;
      player.privateCards = [];
      player.folded = false;
      player.allIn = false;
    });
    // Remise à zéro du pot
    this.pot = 0;
    // Créer et mélanger un nouveau deck
    this.deck = this.createDeck();
    this.shuffleDeck();
    // Pré-délivrer les 5 cartes communes pour la nouvelle main
    this.communityCards = [];
    this.preDealCommunityCards();
    // Distribuer 2 cartes privées à chaque joueur
    this.dealPrivateCards();
  
    // Notifier tous les joueurs qu'une nouvelle main commence
    this.io.in("gameRoom").emit("newHand", {
      message: "Nouvelle main, bonne chance !",
      communityCards: [], // côté client, on affiche les cartes communes cachées
      players: this.players.map(p => ({ id: p.id, chips: p.chips }))
    });
  
    // Démarrer le round de mise pre-flop pour la nouvelle main
    this.startBettingRound("pre-flop");
  }
  
  // Marque un joueur comme prêt, puis démarre la partie dès que tous sont prêts
  playerReady(playerId) {
    this.readyPlayers.add(playerId);
    console.log(`Le joueur ${playerId} est prêt (${this.readyPlayers.size}/${this.players.length})`);
    if (this.readyPlayers.size === this.players.length) {
      console.log("Tous les joueurs sont prêts. Démarrage de la partie.");
      this.startGame();
    }
  }
  
  // Démarre la partie : initialise les jetons, mélange le deck, distribue les cartes, etc.
  startGame() {
    // Attribuer 10 000 jetons à chaque joueur et réinitialiser leur état
    this.players.forEach(player => {
      player.chips = 10000;
      player.folded = false;
      player.allIn = false;
    });
    this.shuffleDeck();
    this.dealPrivateCards();
    this.preDealCommunityCards();
  
    // Envoyer les cartes privées à chaque joueur
    this.players.forEach(player => {
      player.socket.emit("privateCards", { cards: player.privateCards });
      console.log(`Cartes privées envoyées à ${player.id}`);
    });
  
    // Notifier tous les joueurs que la partie a commencé (les cartes communes restent cachées)
    this.io.in("gameRoom").emit("gameStarted", {
      message: "La partie a commencé",
      pot: this.pot,
      communityCards: [],
    });
  
    // Démarrer le round de mise pre-flop
    this.startBettingRound("pre-flop");
  }
  
  // Gère la déconnexion d'un joueur en cours de partie
  handleDisconnect(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      player.folded = true;
      console.log(`Le joueur ${playerId} est marqué comme fold à cause de la déconnexion.`);
      // Optionnel : vérifier s'il ne reste plus qu'un joueur actif pour terminer la partie
    }
  }
}

module.exports = PokerGame;