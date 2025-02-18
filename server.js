// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const PokerGame = require("./PokerGame");

const app = express();

// Sert les fichiers statiques depuis le dossier "build"
app.use(express.static(path.join(__dirname, "build")));

// Pour toutes les routes non reconnues, renvoie index.html (pour l'application SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

// Création du serveur HTTP
const server = http.createServer(app);

// Initialisation de Socket.IO
const io = socketIo(server, {
  cors: {
    origin: "*", // À ajuster selon vos besoins de sécurité
    methods: ["GET", "POST"],
  },
});

// Rendre io accessible globalement (optionnel, utile pour PokerGame)
global.io = io;

// Variables pour gérer les joueurs et la partie en cours
let waitingPlayers = [];
let currentGame = null;

// Gestion des connexions clients via Socket.IO
io.on("connection", (socket) => {
  console.log(`Client connecté : ${socket.id}`);

  // Lorsqu'un client envoie l'événement "joinGame"
  socket.on("joinGame", () => {
    // Ajoute le joueur à la liste d'attente
    waitingPlayers.push({ id: socket.id, socket });
    socket.join("gameRoom");
    console.log(`Le client ${socket.id} a rejoint la salle "gameRoom".`);

    // Notifie tous les membres de "gameRoom" avec la liste actuelle des joueurs
    io.in("gameRoom").emit("roomUpdate", {
      players: waitingPlayers.map((p) => p.id),
    });
    console.log(`Nombre de joueurs en attente : ${waitingPlayers.length}`);

    // Démarrer la partie dès qu'il y a au moins 2 joueurs
    if (waitingPlayers.length >= 2) {
      console.log("Démarrage de la partie avec les joueurs :", waitingPlayers.map((p) => p.id));
      currentGame = new PokerGame(waitingPlayers, io);
      currentGame.startGame();

      // Réinitialise la liste d'attente pour la prochaine partie
      waitingPlayers = [];
    }
  });

  // Réception des actions d'un joueur (bet, call, raise, fold, etc.)
  socket.on("playerAction", (actionData) => {
    if (currentGame) {
      currentGame.registerAction(socket.id, actionData);
    } else {
      console.log(`Action reçue de ${socket.id} mais aucune partie n'est en cours.`);
    }
  });

  // Gestion de la déconnexion d'un client
  socket.on("disconnect", () => {
    console.log(`Client déconnecté : ${socket.id}`);
    // Retire le joueur de la liste d'attente
    waitingPlayers = waitingPlayers.filter((p) => p.id !== socket.id);
    io.in("gameRoom").emit("roomUpdate", {
      players: waitingPlayers.map((p) => p.id),
    });
    // Vous pouvez ajouter ici une logique supplémentaire pour gérer les déconnexions en cours de partie
  });
});

// Lancer le serveur sur le port défini (par défaut 3000)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Serveur lancé sur le port ${PORT}`);
});