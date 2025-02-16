const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const PokerGame = require("./PokerGame");

const app = express();

// Servir le contenu statique du dossier build (votre interface web)
app.use(express.static(path.join(__dirname, 'build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const server = http.createServer(app);
const io = socketIo(server);

// Rendre io globalement accessible pour PokerGame
global.io = io;

let waitingPlayers = [];
let currentGame = null;

io.on("connection", (socket) => {
  console.log(`Client connecté : ${socket.id}`);
  
  socket.on("joinGame", () => {
    waitingPlayers.push({ id: socket.id, socket });
    socket.join("gameRoom");
    io.in("gameRoom").emit("roomUpdate", { players: waitingPlayers.map(p => p.id) });
    console.log("Nombre de joueurs en attente:", waitingPlayers.length);
    
    // Démarrer la partie dès qu'on a au moins 2 joueurs
    if (waitingPlayers.length >= 2) {
      currentGame = new PokerGame(waitingPlayers, io);
      currentGame.startGame();
      waitingPlayers = [];
    }
  });
  
  socket.on("playerAction", (actionData) => {
    // actionData : { action: "bet" | "call" | "raise" | "fold", amount: number (optionnel) }
    if (currentGame) {
      currentGame.registerAction(socket.id, actionData);
    }
  });
  
  socket.on("disconnect", () => {
    console.log(`Client déconnecté : ${socket.id}`);
    waitingPlayers = waitingPlayers.filter(p => p.id !== socket.id);
    io.in("gameRoom").emit("roomUpdate", { players: waitingPlayers.map(p => p.id) });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));