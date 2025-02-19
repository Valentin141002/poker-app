// PokerGame.js
const { Hand } = require('pokersolver');

class PokerGame {
  constructor(players, io) {
    // players: tableau d'objets { id, socket }
    this.players = players;
    this.io = io;
    this.deck = this.createDeck();
    this.communityCards = [];
    this.pot = 0;
    this.currentPhase = "pre-flop"; // "pre-flop", "flop", "turn", "river", "showdown"
    this.actions = {}; // Actions recueillies pendant le round courant
    this.currentPlayerIndex = 0; // Pour l'ordre de passage des joueurs
    this.timerDuration = 120000; // Durée d'un round en ms (2 minutes)
    this.roundTimer = null;
    this.timerInterval = null;
    this.remainingTime = this.timerDuration;
    this.minimumBet = 10; // Mise minimale
    // Ensemble pour suivre les joueurs prêts (optionnel pour une logique de ready)
    this.readyPlayers = new Set();
  }
  
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
  
  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }
  
  dealPrivateCards() {
    this.players.forEach(player => {
      player.privateCards = [this.deck.pop(), this.deck.pop()];
    });
  }
  
  dealFlop() {
    this.deck.pop(); // Brûler une carte
    this.communityCards.push(this.deck.pop(), this.deck.pop(), this.deck.pop());
  }
  
  dealTurn() {
    this.deck.pop();
    this.communityCards.push(this.deck.pop());
  }
  
  dealRiver() {
    this.deck.pop();
    this.communityCards.push(this.deck.pop());
  }
  
  // Démarrer un round de mises interactif pour la phase donnée
  startBettingRound(phase, onRoundComplete) {
    this.currentPhase = phase;
    this.actions = {}; // Réinitialiser les actions du round

    // Réinitialiser le timer et émettre l'info initiale
    this.remainingTime = this.timerDuration;
    this.io.in("gameRoom").emit("bettingRoundStart", { phase, pot: this.pot, timer: this.remainingTime });
    console.log(`Round ${phase} démarré. Pot actuel: ${this.pot}`);

    // Initialiser l'ordre des joueurs pour ce round
    this.currentPlayerIndex = 0;
    this.notifyCurrentPlayer();

    // Démarrer l'intervalle pour mettre à jour le timer toutes les secondes
    this.timerInterval = setInterval(() => {
      this.remainingTime -= 1000;
      // Envoyer l'update du timer à tous les joueurs
      this.io.in("gameRoom").emit("timerUpdate", { remainingTime: this.remainingTime });
    }, 1000);

    // Démarrer le timer du round
    this.roundTimer = setTimeout(() => {
      console.log(`Timer écoulé pour le round ${phase}.`);
      clearInterval(this.timerInterval);
      // Pour chaque joueur qui n'a pas agi, appliquer une action par défaut (fold)
      this.players.forEach(player => {
        if (!this.actions[player.id]) {
          console.log(`Pas d'action pour ${player.id} - action par défaut: fold`);
          this.registerAction(player.id, { action: "fold" });
        }
      });
      this.advanceRound();
    }, this.timerDuration);
  }
  
  // Notifier le joueur dont c'est le tour
  notifyCurrentPlayer() {
    const currentPlayer = this.players[this.currentPlayerIndex];
    if (currentPlayer) {
      currentPlayer.socket.emit("yourTurn", { minimumBet: this.minimumBet, phase: this.currentPhase });
      console.log(`C'est le tour de ${currentPlayer.id}`);
    }
  }
  
  // Enregistrer l'action d'un joueur
  registerAction(playerId, actionData) {
    this.actions[playerId] = actionData;
    console.log(`Action de ${playerId}:`, actionData);

    // Mise à jour immédiate du pot pour bet, call ou raise
    if (actionData.action === "bet" || actionData.action === "raise" || actionData.action === "call") {
      this.pot += actionData.amount || 0;
      this.io.in("gameRoom").emit("updatePot", { pot: this.pot });
    }

    // Avancer à l'ordre du joueur suivant
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;
    
    // Si tous les joueurs ont agi, avancer immédiatement
    if (Object.keys(this.actions).length === this.players.length) {
      clearTimeout(this.roundTimer);
      clearInterval(this.timerInterval);
      this.advanceRound();
    } else {
      // Notifier le prochain joueur qui n'a pas encore agi
      let notified = false;
      for (let i = 0; i < this.players.length; i++) {
        const nextPlayer = this.players[(this.currentPlayerIndex + i) % this.players.length];
        if (!this.actions[nextPlayer.id]) {
          this.currentPlayerIndex = (this.currentPlayerIndex + i) % this.players.length;
          this.notifyCurrentPlayer();
          notified = true;
          break;
        }
      }
      if (!notified) {
        clearTimeout(this.roundTimer);
        clearInterval(this.timerInterval);
        this.advanceRound();
      }
    }
  }
  
  // Avancer au round suivant en fonction de la phase courante
  advanceRound() {
    clearInterval(this.timerInterval);
    console.log(`Round ${this.currentPhase} terminé. Actions recueillies:`, this.actions);

    // Transition vers la phase suivante
    if (this.currentPhase === "pre-flop") {
      this.dealFlop();
      this.io.in("gameRoom").emit("flop", { cards: this.communityCards.slice(0, 3) });
      this.startBettingRound("flop", () => {});
    } else if (this.currentPhase === "flop") {
      this.dealTurn();
      this.io.in("gameRoom").emit("turn", { card: this.communityCards[3] });
      this.startBettingRound("turn", () => {});
    } else if (this.currentPhase === "turn") {
      this.dealRiver();
      this.io.in("gameRoom").emit("river", { card: this.communityCards[4] });
      this.startBettingRound("river", () => {});
    } else if (this.currentPhase === "river") {
      // Showdown : évaluer les mains et déterminer le gagnant
      const winners = this.evaluateHands();
      this.players.forEach(player => {
        player.socket.emit("showdown", {
          communityCards: this.communityCards,
          pot: this.pot,
          winners: winners.map(w => w.playerId)
        });
      });
      console.log("Showdown terminé. Gagnants:", winners.map(w => w.playerId));
    }
  }
  
  // Évaluer les mains à l'aide de pokersolver
  evaluateHands() {
    const evaluations = this.players.map(player => {
      const fullHand = player.privateCards.concat(this.communityCards);
      const cardStrings = fullHand.map(c => c.rank + c.suit);
      const hand = Hand.solve(cardStrings);
      return { playerId: player.id, hand };
    });
    const winningHands = Hand.winners(evaluations.map(e => e.hand));
    return evaluations.filter(e => winningHands.includes(e.hand));
  }
  
  // Méthode appelée lorsqu'un joueur est prêt (optionnel)
  playerReady(playerId) {
    this.readyPlayers.add(playerId);
    console.log(`Le joueur ${playerId} est prêt. (${this.readyPlayers.size}/${this.players.length})`);
    if (this.readyPlayers.size === this.players.length) {
      console.log("Tous les joueurs sont prêts. Démarrage de la partie.");
      this.startGame();
    }
  }
  
  // Démarrer la partie une fois que tous les joueurs sont prêts
  startGame() {
    this.shuffleDeck();
    this.dealPrivateCards();
    // Envoyer les cartes privées à chaque joueur
    this.players.forEach(player => {
      player.socket.emit("privateCards", { cards: player.privateCards });
      console.log(`Cartes privées envoyées à ${player.id}`);
    });
    // Notifier tous les joueurs que la partie a commencé
    this.io.in("gameRoom").emit("gameStarted", {
      message: "La partie a commencé",
      pot: this.pot,
      communityCards: this.communityCards
    });
    // Démarrer le round de mise pré-flop interactif
    this.startBettingRound("pre-flop", () => {});
  }  
}

module.exports = PokerGame;