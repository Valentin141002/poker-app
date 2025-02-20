// PokerGame.js
const { Hand } = require("pokersolver");

class PokerGame {
  constructor(players, io) {
    // players: tableau d'objets { id, socket, privateCards, chips, folded }
    this.players = players;
    this.io = io;
    this.deck = this.createDeck();
    this.communityCards = [];
    this.pot = 0;
    this.currentPhase = "pre-flop"; // "pre-flop", "flop", "turn", "river", "showdown"
    this.actions = {}; // Actions recueillies pendant le round courant
    this.currentPlayerIndex = 0; // Pour l'ordre de passage des joueurs
    this.timerDuration = 120000; // 2 minutes par round
    this.roundTimer = null;
    this.timerInterval = null;
    this.remainingTime = this.timerDuration;
    this.minimumBet = 10; // Mise minimale
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

  // Distribue 2 cartes à chaque joueur
  dealPrivateCards() {
    this.players.forEach(player => {
      player.privateCards = [this.deck.pop(), this.deck.pop()];
      player.folded = false; // Au début, personne n'est couché
    });
  }

  // Pré-tire les 5 cartes communes (de dos côté client) ; on les révélera au fil des phases
  preDealCommunityCards() {
    for (let i = 0; i < 5; i++) {
      this.communityCards.push(this.deck.pop());
    }
  }

  // Démarrer un round de mises pour la phase donnée
  startBettingRound(phase, onRoundComplete) {
    this.currentPhase = phase;
    this.actions = {}; // Réinitialiser les actions du round

    // Réinitialiser le timer et émettre l'info initiale
    this.remainingTime = this.timerDuration;
    this.io.in("gameRoom").emit("bettingRoundStart", {
      phase,
      pot: this.pot,
      timer: this.remainingTime,
    });
    console.log(`Round ${phase} démarré. Pot actuel: ${this.pot}`);

    // Initialiser l'ordre des joueurs pour ce round
    this.currentPlayerIndex = 0;
    this.notifyCurrentPlayer();

    // Démarrer l'intervalle pour mettre à jour le timer toutes les secondes
    this.timerInterval = setInterval(() => {
      this.remainingTime -= 1000;
      this.io.in("gameRoom").emit("timerUpdate", { remainingTime: this.remainingTime });
    }, 1000);

    // Démarrer le timer du round
    this.roundTimer = setTimeout(() => {
      console.log(`Timer écoulé pour le round ${phase}.`);
      clearInterval(this.timerInterval);
      // Pour chaque joueur qui n'a pas agi, action par défaut : fold
      this.players.forEach(player => {
        if (!this.actions[player.id] && !player.folded) {
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
      // Notifie seulement le joueur concerné
      currentPlayer.socket.emit("yourTurn", {
        minimumBet: this.minimumBet,
        phase: this.currentPhase,
      });
      // Informe tous les joueurs de qui est le joueur actuel
      this.io.in("gameRoom").emit("currentPlayer", { playerId: currentPlayer.id });
      console.log(`C'est le tour de ${currentPlayer.id}`);
    }
  }

  // Gérer l'action d'un joueur
  registerAction(playerId, actionData) {
    const player = this.players.find(p => p.id === playerId);
    if (!player || player.folded) {
      console.log(`Action ignorée pour ${playerId}, joueur introuvable ou déjà fold.`);
      return;
    }

    this.actions[playerId] = actionData;
    console.log(`Action de ${playerId}:`, actionData);

    // Gérer les différentes actions (fold, check, call, raise, all-in)
    switch (actionData.action) {
      case "fold":
        player.folded = true;
        break;
      case "check":
        // Ici, on suppose qu'aucune mise n'est en cours
        // Logique simplifiée
        break;
      case "call":
      case "raise":
      case "bet": {
        // Montant de la mise
        const amount = actionData.amount || 0;
        // Vérifier si le joueur a assez de jetons
        if (player.chips < amount) {
          console.log(`${playerId} n'a pas assez de jetons pour miser ${amount}.`);
          // Vous pouvez forcer un fold ou limiter à all-in
          break;
        }
        // Retirer les jetons du joueur
        player.chips -= amount;
        // Ajouter au pot
        this.pot += amount;
        // Notifier tout le monde de la mise à jour du pot
        this.io.in("gameRoom").emit("updatePot", { pot: this.pot });
        break;
      }
      case "all-in": {
        // Mise tous les jetons du joueur
        const amount = player.chips;
        player.chips = 0;
        player.allIn = true; // Marquer le joueur comme all-in
        this.pot += amount;
        this.io.in("gameRoom").emit("updatePot", { pot: this.pot });
        break;
      }
      default:
        console.log(`Action non reconnue: ${actionData.action}`);
        break;
    }

    // Passer au joueur suivant
    this.currentPlayerIndex = (this.currentPlayerIndex + 1) % this.players.length;

    // Vérifier si tous les joueurs ont agi (ou sont fold)
    const activePlayers = this.players.filter(p => !p.folded);
    const totalActions = Object.keys(this.actions).length;

    // Si tous les joueurs restants ont agi, on passe à la phase suivante
    if (totalActions >= activePlayers.length) {
      clearTimeout(this.roundTimer);
      clearInterval(this.timerInterval);
      this.advanceRound();
    } else {
      // Notifier le prochain joueur qui n'a pas encore agi et n'est pas fold
      let notified = false;
      for (let i = 0; i < activePlayers.length; i++) {
        const nextIndex = (this.currentPlayerIndex + i) % this.players.length;
        const nextPlayer = this.players[nextIndex];
        if (!nextPlayer.folded && !this.actions[nextPlayer.id]) {
          this.currentPlayerIndex = nextIndex;
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

  // Passer au round suivant (phase suivante)
  advanceRound() {
    clearInterval(this.timerInterval);
    console.log(`Round ${this.currentPhase} terminé. Actions recueillies:`, this.actions);

    // Réinitialiser actions pour la phase suivante
    this.actions = {};

    // Déterminer la phase suivante
    if (this.currentPhase === "pre-flop") {
      // Révéler les 3 premières cartes (flop)
      this.io.in("gameRoom").emit("flop", {
        cards: this.communityCards.slice(0, 3),
      });
      this.startBettingRound("flop", () => {});
    } else if (this.currentPhase === "flop") {
      // Révéler la 4e carte (turn)
      this.io.in("gameRoom").emit("turn", {
        card: this.communityCards[3],
      });
      this.startBettingRound("turn", () => {});
    } else if (this.currentPhase === "turn") {
      // Révéler la 5e carte (river)
      this.io.in("gameRoom").emit("river", {
        card: this.communityCards[4],
      });
      this.startBettingRound("river", () => {});
    } else if (this.currentPhase === "river") {
      // Showdown
      const winners = this.evaluateHands();
      this.players.forEach(player => {
        player.socket.emit("showdown", {
          communityCards: this.communityCards,
          pot: this.pot,
          winners: winners.map(w => w.playerId),
        });
      });
      console.log("Showdown terminé. Gagnants:", winners.map(w => w.playerId));
      // Ici, vous pouvez redistribuer le pot, etc.
    }
  }

  // Évaluer les mains
  evaluateHands() {
    const activePlayers = this.players.filter(p => !p.folded);
    if (activePlayers.length === 1) {
      // S'il ne reste qu'un joueur non fold, il gagne d'office
      return activePlayers.map(p => ({ playerId: p.id }));
    }
    const evaluations = activePlayers.map(player => {
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
    console.log(
      `Le joueur ${playerId} est prêt. (${this.readyPlayers.size}/${this.players.length})`
    );
    if (this.readyPlayers.size === this.players.length) {
      console.log("Tous les joueurs sont prêts. Démarrage de la partie.");
      this.startGame();
    }
  }

  // Démarrer la partie
  startGame() {
    // Attribuer 10 000 jetons à chaque joueur
    this.players.forEach(player => {
      player.chips = 10000;
      player.folded = false;
    });
    // Mélanger le deck
    this.shuffleDeck();
    // Distribuer 2 cartes privées à chaque joueur
    this.dealPrivateCards();
    // Préparer les 5 cartes communes
    this.preDealCommunityCards();

    // Envoyer les cartes privées à chaque joueur
    this.players.forEach(player => {
      player.socket.emit("privateCards", { cards: player.privateCards });
      console.log(`Cartes privées envoyées à ${player.id}`);
    });

    // Notifier tous les joueurs que la partie a commencé
    this.io.in("gameRoom").emit("gameStarted", {
      message: "La partie a commencé",
      pot: this.pot,
      communityCards: [], // On envoie un tableau vide si vous voulez montrer 5 cartes face cachée côté client
    });

    // Commencer le round pré-flop
    this.startBettingRound("pre-flop", () => {});
  }
}

module.exports = PokerGame;