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
const io = socketIo(server, {
  cors: { origin: "*" },
});

// Exporter io globalement si nécessaire
global.io = io;

/**
 * Gestionnaire de tables pour répartir les joueurs dans plusieurs parties.
 */
class TableManager {
  constructor(io) {
    this.io = io;
    this.tables = []; // Array de tables (instances de PokerGame)
    this.maxPlayersPerTable = 10;
    this.tableIdCounter = 1;
  }

  createTable() {
    const table = new PokerGame([], this.io);
    // Affecte un identifiant unique à la table pour utiliser comme room
    table.id = `table-${this.tableIdCounter++}`;
    this.tables.push(table);
    return table;
  }

  findAvailableTable() {
    return this.tables.find(table => table.players.length < this.maxPlayersPerTable);
  }

  removeTable(table) {
    this.tables = this.tables.filter(t => t !== table);
  }

  assignPlayerToTable(newPlayer) {
    let table = this.findAvailableTable();
    if (!table) {
      table = this.createTable();
    }
    table.players.push(newPlayer);
    // Rejoindre la room correspondant à la table
    newPlayer.socket.join(table.id);
    // Mettre à jour la salle pour tous les joueurs de cette table
    this.io.to(table.id).emit("roomUpdate", {
      players: table.players.map(p => ({ id: p.id, name: p.name }))
    });
    console.log(`Player ${newPlayer.id} assigned to ${table.id}. Total players: ${table.players.length}`);
    if (table.players.length === this.maxPlayersPerTable) {
      console.log(`Table ${table.id} is full. Starting game.`);
      table.startGame();
    }
  }

  removePlayer(socketId) {
    for (let table of this.tables) {
      const index = table.players.findIndex(p => p.id === socketId);
      if (index !== -1) {
        table.players.splice(index, 1);
        // Mettre à jour la salle pour la table concernée
        this.io.to(table.id).emit("roomUpdate", {
          players: table.players.map(p => ({ id: p.id, name: p.name }))
        });
        // Si la table devient vide, on la supprime
        if (table.players.length === 0) {
          this.removeTable(table);
        }
        break;
      }
    }
  }

  handlePlayerAction(socketId, actionData) {
    // Trouver la table contenant le joueur
    for (let table of this.tables) {
      if (table.players.find(p => p.id === socketId)) {
        table.registerAction(socketId, actionData);
        break;
      }
    }
  }

  handleDisconnect(socketId) {
    this.removePlayer(socketId);
    // Vous pouvez émettre un événement global si nécessaire
    this.io.emit("playerDisconnected", { playerId: socketId });
  }
}

const tableManager = new TableManager(io);

io.on("connection", (socket) => {
  console.log(`Client connecté : ${socket.id}`);

  socket.on("joinGame", (playerName) => {
    // Crée un nouvel objet joueur, initialisé avec 10000 chips et un tableau vide pour les cartes privées
    const newPlayer = { 
      id: socket.id, 
      socket, 
      name: playerName || socket.id,
      chips: 10000,
      privateCards: []
    };
    tableManager.assignPlayerToTable(newPlayer);
  });

  socket.on("playerAction", (actionData) => {
    tableManager.handlePlayerAction(socket.id, actionData);
  });

  socket.on("chatMessage", (data) => {
    // data doit contenir { sender, message }
    console.log(`Message de ${data.sender}: ${data.message}`);
    // Vous pouvez choisir d'émettre ce message seulement pour la table du joueur,
    // ici on l'envoie globalement pour simplifier.
    io.emit("chatMessage", data);
  });

  socket.on("disconnect", () => {
    console.log(`Client déconnecté : ${socket.id}`);
    tableManager.handleDisconnect(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));