// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const PokerGame = require("./PokerGame");

const app = express();

// Sert les fichiers statiques depuis le dossier "build" pour le front-end
app.use(express.static(path.join(__dirname, "build")));

// Pour toutes les autres routes, on envoie le fichier index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

const server = http.createServer(app);

// Initialisation de Socket.io avec une configuration CORS simple
const io = socketIo(server, {
  cors: { origin: "*" },
});

// Optionnel : exporter io globalement si nécessaire ailleurs
global.io = io;

// Variables globales pour la gestion des joueurs en attente et de la partie en cours
let waitingPlayers = [];
let currentGame = null;

io.on("connection", (socket) => {
  console.log(`Client connecté : ${socket.id}`);

  // Lorsqu'un joueur rejoint la partie
  // On peut transmettre un pseudo en argument (ici playerName)
  socket.on("joinGame", (playerName) => {
    const newPlayer = { id: socket.id, socket, name: playerName || socket.id };
    waitingPlayers.push(newPlayer);
    socket.join("gameRoom");

    // Mise à jour de la salle pour tous les clients
    io.in("gameRoom").emit("roomUpdate", {
      players: waitingPlayers.map((p) => ({ id: p.id, name: p.name })),
    });
    console.log(`Nombre de joueurs en attente: ${waitingPlayers.length}`);

    // Démarrer la partie dès qu'il y a au moins 2 joueurs et qu'aucune partie n'est en cours
    if (waitingPlayers.length >= 2 && !currentGame) {
      console.log("Démarrage de la partie...");
      currentGame = new PokerGame(waitingPlayers, io);
      currentGame.startGame();
      // Réinitialiser la liste d'attente après le lancement de la partie
      waitingPlayers = [];
    }
  });

  // Gestion des actions des joueurs (fold, call, raise, etc.)
  socket.on("playerAction", (actionData) => {
    if (currentGame) {
      try {
        currentGame.registerAction(socket.id, actionData);
      } catch (err) {
        console.error(`Erreur lors de l'action du joueur ${socket.id}: `, err);
      }
    } else {
      console.log("Aucune partie en cours pour traiter l'action.");
    }
  });

  // Gestion de la déconnexion d'un joueur
  socket.on("disconnect", () => {
    console.log(`Client déconnecté : ${socket.id}`);

    // Retirer le joueur de la liste d'attente
    waitingPlayers = waitingPlayers.filter((p) => p.id !== socket.id);
    io.in("gameRoom").emit("roomUpdate", {
      players: waitingPlayers.map((p) => ({ id: p.id, name: p.name })),
    });
    
    // Si le joueur était en partie, le gérer dans la logique de jeu
    if (currentGame) {
      currentGame.handleDisconnect(socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));