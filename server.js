// server.js
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));

// Stockage simplifié des joueurs dans une table (pour débuter)
const table = { players: [] };

io.on("connection", (socket) => {
  console.log(`Client connecté : ${socket.id}`);

  // Quand le client envoie joinGame, on ajoute le joueur à la table
  socket.on("joinGame", () => {
    table.players.push(socket.id);
    socket.join("table1");
    console.log(`Socket ${socket.id} a rejoint la table.`);
    console.log(`Nombre de joueurs dans la table: ${table.players.length}`);

    // Envoyer la mise à jour à tous les joueurs de la table
    io.in("table1").emit("roomUpdate", { players: table.players });
    
    // Démarrer la partie dès que 2 joueurs (ou plus) sont connectés pour tester
    if (table.players.length >= 2) {
      console.log("Condition atteinte, démarrage de la partie.");
      io.in("table1").emit("gameStart", { message: "La partie démarre !" });
      
      // Après 5 secondes, simuler un résultat de partie
      setTimeout(() => {
        const winnerIndex = Math.floor(Math.random() * table.players.length);
        const winnerId = table.players[winnerIndex];
        console.log(`Partie terminée. Gagnant : ${winnerId}`);
        io.in("table1").emit("gameResult", { winnerId });
      }, 5000);
    }
  });

  // Gérer la déconnexion
  socket.on("disconnect", () => {
    console.log(`Client déconnecté : ${socket.id}`);
    table.players = table.players.filter((id) => id !== socket.id);
    io.in("table1").emit("roomUpdate", { players: table.players });
  });
});

server.listen(3000, () => console.log("Serveur lancé sur le port 3000"));
