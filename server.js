const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");

const app = express();

// Servir les fichiers statiques du dossier build
app.use(express.static(path.join(__dirname, 'build')));

// Pour toute route non gérée, renvoyer index.html (pour le routage côté client)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

const server = http.createServer(app);
const io = socketIo(server);

// Logique Socket.IO (exemple simple)
const table = { players: [] };

io.on("connection", (socket) => {
  console.log(`Client connecté : ${socket.id}`);

  socket.on("joinGame", () => {
    table.players.push(socket.id);
    socket.join("table1");
    console.log(`Socket ${socket.id} a rejoint la table.`);
    console.log("Nombre de joueurs dans la table:", table.players.length);

    io.in("table1").emit("roomUpdate", { players: table.players });

    if (table.players.length >= 2) {
      console.log("Condition atteinte, démarrage de la partie.");
      io.in("table1").emit("gameStart", { message: "La partie démarre !" });
      setTimeout(() => {
        const winnerIndex = Math.floor(Math.random() * table.players.length);
        const winnerId = table.players[winnerIndex];
        console.log(`Partie terminée. Gagnant : ${winnerId}`);
        io.in("table1").emit("gameResult", { winnerId });
      }, 5000);
    }
  });

  socket.on("disconnect", () => {
    console.log(`Client déconnecté : ${socket.id}`);
    table.players = table.players.filter((id) => id !== socket.id);
    io.in("table1").emit("roomUpdate", { players: table.players });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Serveur lancé sur le port ${PORT}`));