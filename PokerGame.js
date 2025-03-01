// PokerGame.js
const { Hand } = require("pokersolver");

class PokerGame {
  constructor(players, io) {
    // players: tableau d'objets { id, socket, name, ... }
    this.players = players;
    this.io = io;
    this.deck = this.createDeck();
    this.communityCards = [];
    this.pot = 0;
    this.currentPhase = "pre-flop"; // Phases : pre-flop, flop, turn, river, showdown
    this.actions = {}; // Actions recueillies durant le round courant
    this.currentPlayerIndex = 0; // Pour déterminer l'ordre de passage
    this.timerDuration = 120000; // Durée du round (2 minutes)
    this.roundTimer = null;
    this.timerInterval = null;
    this.remainingTime = this.timerDuration;
    this.minimumBet = 50;
    this.readyPlayers = new Set();
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

  // Distribue 2 cartes privées à chaque joueur et réinitialise currentBet
  dealPrivateCards() {
    this.players.forEach(player => {
      player.privateCards = [this.deck.pop(), this.deck.pop()];
      player.folded = false;
      player.allIn = false;
      player.currentBet = 0;
    });
  }
  
  // Pré-délivre les 5 cartes communes
  preDealCommunityCards() {
    this.communityCards = [];
    for (let i = 0; i < 5; i++) {
      this.communityCards.push(this.deck.pop());
    }
  }  

  // Démarre un round de mises pour la phase indiquée
  startBettingRound(phase) {
    this.currentPhase = phase;
    this.actions = {};
    this.remainingTime = this.timerDuration;

    // Émission vers la room correspondant à cette table
    this.io.in(this.id).emit("bettingRoundStart", {
      phase,
      pot: this.pot,
      timer: this.remainingTime,
    });
    console.log(`Round ${phase} démarré. Pot actuel: ${this.pot}`);

    // Réinitialiser l'ordre de passage pour le round
    this.currentPlayerIndex = 0;
    this.notifyCurrentPlayer();

    // Mise à jour du timer chaque seconde
    this.timerInterval = setInterval(() => {
      this.remainingTime -= 1000;
      this.io.in(this.id).emit("timerUpdate", { remainingTime: this.remainingTime });
    }, 1000);

    // Timer global du round : à expiration, fold automatique des joueurs inactifs
    this.roundTimer = setTimeout(() => {
      console.log(`Timer écoulé pour le round ${phase}.`);
      clearInterval(this.timerInterval);
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
      this.io.in(this.id).emit("currentPlayer", { playerId: currentPlayer.id });
      console.log(`C'est le tour de ${currentPlayer.id}`);
    } else if (currentPlayer) {
      this.registerAction(currentPlayer.id, { action: "fold" });
    }
  }

  // Enregistre l'action d'un joueur et met à jour le jeu
  registerAction(playerId, actionData) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.folded) {
      console.log(`Action ignorée pour ${playerId} (joueur introuvable ou déjà fold).`);
      return;
    }
  
    const activePlayers = this.players.filter(p => !p.folded);
    const currentMaxBet = activePlayers.reduce((max, p) => {
      return (p.currentBet || 0) > max ? p.currentBet : max;
    }, 0);
  
    this.actions[playerId] = actionData;
    console.log(`Action de ${playerId}:`, actionData);
  
    switch (actionData.action) {
      case "fold":
        player.folded = true;
        break;
  
      case "check":
        if ((player.currentBet || 0) < currentMaxBet) {
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
        this.io.in(this.id).emit("updatePot", { pot: this.pot });
        break;
      }
  
      case "raise": {
        const amount = actionData.amount || 0;
        if (amount > player.chips) {
          console.log(`${player.id} n'a pas assez de jetons pour raise ${amount}.`);
          return;
        }
        player.chips -= amount;
        player.currentBet = (player.currentBet || 0) + amount;
        this.pot += amount;
        this.io.in(this.id).emit("updatePot", { pot: this.pot });
        break;
      }
  
      case "bet": {
        const amount = actionData.amount || 0;
        const callAmount = currentMaxBet - (player.currentBet || 0);
        if (amount < callAmount + this.minimumBet) {
          console.log(`${player.id} doit miser au moins ${callAmount + this.minimumBet} (call: ${callAmount}, minimum: ${this.minimumBet}).`);
          return;
        }
        if (amount > player.chips) {
          console.log(`${player.id} n'a pas assez de jetons pour miser ${amount}.`);
          return;
        }
        player.chips -= amount;
        player.currentBet = (player.currentBet || 0) + amount;
        this.pot += amount;
        this.io.in(this.id).emit("updatePot", { pot: this.pot });
        break;
      }
  
      case "all-in": {
        const amount = player.chips;
        player.currentBet = (player.currentBet || 0) + amount;
        player.chips = 0;
        player.allIn = true;
        this.pot += amount;
        this.io.in(this.id).emit("updatePot", { pot: this.pot });
        break;
      }
  
      default:
        console.log(`Action non reconnue: ${actionData.action}`);
        break;
    }
  
    this.io.in(this.id).emit("chipsUpdate", {
      players: this.players.map(p => ({ id: p.id, chips: p.chips }))
    });
    
    // Passage au joueur suivant actif
    this.moveToNextPlayer();
  
    const activePlayersRound = this.players.filter(p => !p.folded);
    if (Object.keys(this.actions).length >= activePlayersRound.length) {
      clearTimeout(this.roundTimer);
      clearInterval(this.timerInterval);
      this.advanceRound();
    } else {
      this.notifyCurrentPlayer();
    }
  }

  // Passe au joueur suivant actif
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
  
    this.actions = {};
  
    if (this.currentPhase === "pre-flop") {
      this.io.in(this.id).emit("flop", {
        cards: this.communityCards.slice(0, 3),
      });
      this.startBettingRound("flop");
    } else if (this.currentPhase === "flop") {
      this.io.in(this.id).emit("turn", {
        card: this.communityCards[3],
      });
      this.startBettingRound("turn");
    } else if (this.currentPhase === "turn") {
      this.io.in(this.id).emit("river", {
        card: this.communityCards[4],
      });
      this.startBettingRound("river");
    } else if (this.currentPhase === "river") {
      const winners = this.evaluateHands();
      if (winners && winners.length > 0) {
        this.distributePot(winners);
        this.io.in(this.id).emit("showdown", {
          communityCards: this.communityCards,
          pot: this.pot,
          winners: winners.map(w => w.playerId),
        });
        console.log("Showdown terminé. Gagnants:", winners.map(w => w.playerId));
        this.io.in(this.id).emit("newRound", {
          message: "La main est terminée. Une nouvelle main démarre dans 10 secondes."
        });
        setTimeout(() => {
          this.resetRoundState();
        }, 10000);
      } else {
        console.log("Aucun gagnant détecté lors du showdown.");
      }
    }
  }

  // Évalue les mains des joueurs actifs et retourne le(s) gagnant(s)
  evaluateHands() {
    const activePlayers = this.players.filter(p => !p.folded);
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
  
  // Redistribue le pot aux gagnants
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
    const remainder = this.pot % numWinners;
    if (remainder > 0 && winners.length > 0) {
      const firstWinner = this.players.find(p => p.id === winners[0].playerId);
      if (firstWinner) {
        firstWinner.chips += remainder;
      }
    }
    this.pot = 0;
    this.io.in(this.id).emit("chipsUpdate", {
      players: this.players.map(p => ({ id: p.id, chips: p.chips }))
    });
  }
  
  // Réinitialise l'état du round sans toucher aux soldes
  resetRoundState() {
    this.communityCards = [];
    this.pot = 0;
    this.actions = {};
    this.players.forEach(player => {
      player.currentBet = 0;
      player.folded = false;
      player.allIn = false;
    });
    this.deck = this.createDeck();
    this.shuffleDeck();
    this.io.in(this.id).emit("resetRound", {
      message: "La nouvelle main démarre maintenant !",
      pot: this.pot,
      communityCards: this.communityCards,
    });
  }
  
  // Démarre la partie : initialisation, mélange et distribution
  startGame() {
    this.players.forEach(player => {
      player.chips = 10000;
      player.privateCards = [];
      player.folded = false;
      player.allIn = false;
    });
    this.shuffleDeck();
    this.dealPrivateCards();
    this.preDealCommunityCards();
  
    this.players.forEach(player => {
      player.socket.emit("privateCards", { cards: player.privateCards });
      console.log(`Cartes privées envoyées à ${player.id}`);
    });
  
    console.log("Emission de gameStarted avec:", {
      message: "La partie a commencé",
      pot: this.pot,
      communityCards: []
    });
  
    this.io.in(this.id).emit("gameStarted", {
      message: "La partie a commencé",
      pot: this.pot,
      communityCards: [],
    });
  
    this.startBettingRound("pre-flop");
  }
  
  // Gère la déconnexion d'un joueur en cours de partie
  handleDisconnect(playerId) {
    const player = this.players.find(p => p.id === playerId);
    if (player) {
      player.folded = true;
      console.log(`Le joueur ${playerId} est marqué comme fold à cause de la déconnexion.`);
    }
  }
}

module.exports = PokerGame;