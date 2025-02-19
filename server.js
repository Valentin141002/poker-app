// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const PokerGame = require("./PokerGame");

const app = express();

// Sert les fichiers statiques depuis le dossier "build"
app.use(express.static(path.join(__dirname, "build")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "build", "index.html"));
});

const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" },
});

global.io = io;

let waitingPlayers = [];
let currentGame = null;

io.on("connection", (socket) => {
  console.log(`Client connecté : ${socket.id}`);

  socket.on("joinGame", () => {
    waitingPlayers.push({ id: socket.id, socket });
    socket.join("gameRoom");
    io.in("gameRoom").emit("roomUpdate", { players: waitingPlayers.map(p => p.id) });
    console.log(`Nombre de joueurs en attente: ${waitingPlayers.length}`);

    if (waitingPlayers.length >= 2) {
      console.log("Démarrage de la partie...");
      currentGame = new PokerGame(waitingPlayers, io);
      currentGame.startGame();
      waitingPlayers = [];
    }
  });

  socket.on("playerAction", (actionData) => {
    if (currentGame) {
      currentGame.registerAction(socket.id, actionData);
    } else {
      console.log("Aucune partie en cours pour traiter l'action.");
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