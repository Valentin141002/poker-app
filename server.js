// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const PokerGame = require("./PokerGame");

const app = express();

// Servir les fichiers statiques depuis le dossier "build"
app.use(express.static(path.join(__dirname, 'build')));

// Pour toute autre route, renvoyer index.html (pour une application SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Création du serveur HTTP et de Socket.io
const server = http.createServer(app);
const io = socketIo(server);

// Optionnel : Rendre io accessible globalement (utile pour PokerGame par exemple)
global.io = io;

// Liste des joueurs en attente et variable pour la partie en cours
let waitingPlayers = [];
let currentGame = null;

// Gestion des connexions clients via Socket.io
io.on("connection", (socket) => {
  console.log(`Client connecté : ${socket.id}`);
  
  // Événement pour rejoindre le jeu
  socket.on("joinGame", () => {
    // Ajouter le joueur à la liste d'attente
    waitingPlayers.push({ id: socket.id, socket });
    
    // Faire rejoindre la salle "gameRoom" pour faciliter la communication de groupe
    socket.join("gameRoom");
    console.log(`Le client ${socket.id} a rejoint la salle "gameRoom".`);
    
    // Notifier tous les membres de "gameRoom" avec la liste des joueurs en attente
    io.in("gameRoom").emit("roomUpdate", { players: waitingPlayers.map(p => p.id) });
    console.log(`Nombre de joueurs en attente: ${waitingPlayers.length}`);
    
    // Démarrer la partie dès qu'il y a au moins 2 joueurs
    if (waitingPlayers.length >= 2) {
      console.log("Deux joueurs connectés, démarrage de la partie...");
      currentGame = new PokerGame(waitingPlayers, io);
      currentGame.startGame();
      
      // Réinitialiser la liste d'attente pour la prochaine partie
      waitingPlayers = [];
    }
  });
  
  // Événement pour recevoir une action d'un joueur (bet, call, raise, fold, etc.)
  socket.on("playerAction", (actionData) => {
    // actionData doit contenir par exemple { action: "bet" | "call" | "raise" | "fold", amount: number (optionnel) }
    if (currentGame) {
      currentGame.registerAction(socket.id, actionData);
    } else {
      console.log("Aucune partie en cours pour traiter l'action.");
    }
  });
  
  // Gérer la déconnexion d'un client
  socket.on("disconnect", () => {
    console.log(`Client déconnecté : ${socket.id}`);
    // Supprimer le joueur de la liste d'attente
    waitingPlayers = waitingPlayers.filter(p => p.id !== socket.id);
    io.in("gameRoom").emit("roomUpdate", { players: waitingPlayers.map(p => p.id) });
    
    // Ici, tu peux également ajouter une logique pour gérer les déconnexions durant une partie en cours
  });
});

// Lancer le serveur sur le port défini ou 3000 par défaut
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));