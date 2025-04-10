// client.js

function initGame() {
    // Se connecter au serveur via Socket.IO
    const socket = io.connect();
  
    // Lors de la connexion, envoyer un événement "joinGame" avec le nom du joueur
    socket.on('connect', function () {
      console.log("Connecté au serveur avec l'ID : " + socket.id);
      const playerName = localStorage.getItem("playername") || "Player";
      socket.emit('joinGame', { name: playerName });
    });
  
    // Écouter l'événement 'updateTable'
    // Le serveur envoie désormais un objet gameState contenant :
    // { players: [...], pot: 0, currentBet: 0, ... }
    socket.on('updateTable', function (gameState) {
      console.log("Mise à jour de la table reçue :", gameState);
      
      // Déterminer le siège attribué au client en comparant l'id du socket
      gameState.players.forEach(function (player, index) {
        if (player && player.id === socket.id) {
          window.mySeat = index;
        }
      });
      
      // Mise à jour de l'affichage du pot et de la mise actuelle
      const potElem = document.getElementById("pot");
      const betElem = document.getElementById("currentBet");
      if (potElem) potElem.innerText = "Pot: " + gameState.pot;
      if (betElem) betElem.innerText = "Mise actuelle: " + gameState.currentBet;
  
      // Mise à jour de l'affichage des joueurs
      const players = gameState.players;
      for (let i = 0; i < players.length; i++) {
        const seatElem = document.getElementById("seat" + i);
        if (seatElem) {
          const nameElem = seatElem.querySelector('.player-name');
          if (players[i] !== null) {
            nameElem.innerText = players[i].name;
            // Si le joueur correspond à l'utilisateur actuel, mettre en évidence son siège
            if (socket.id === players[i].id) {
              seatElem.classList.add("you");
            } else {
              seatElem.classList.remove("you");
            }
          } else {
            nameElem.innerText = "";
          }
        }
      }
    });
  
    // Écouter d'éventuels messages simples envoyés par le serveur
    socket.on('message', function (msg) {
      console.log("Message du serveur :", msg);
    });
  
    // Fonction exposée pour envoyer des actions du joueur (ex. call, raise, fold)
    window.sendPlayerAction = function (actionType, amount) {
      socket.emit('playerAction', {
        type: actionType,
        amount: amount,
        // Optionnel : vous pouvez transmettre le siège connu si stocké dans socket.playerSeat
        seat: socket.playerSeat
      });
    };
  
    // Pour faciliter le débogage, on expose le socket globalement
    window.socket = socket;
  }
  
  // Initialiser le jeu lors du chargement de la page
  initGame();  