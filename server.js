// server.js
const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');
const Table = require('./table'); // Importation du module Table

// Création de l'application Express
const app = express();

// Servir les fichiers statiques depuis poker-app (poker.html, CSS, JS, images, etc.)
app.use(express.static(path.join(__dirname, 'poker-app')));

// Pour toute route, renvoyer le fichier poker.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'poker-app', 'poker.html'));
});

// Création du serveur HTTP
const server = http.createServer(app);

// Initialisation de Socket.IO
const io = socketIo(server);

// Définition du port
const PORT = process.env.PORT || 3000;

// Mode multijoueur activé
const modeMultiplayer = true;

// Création d'une instance de Table
const table = new Table(10);

// Gestion des connexions Socket.IO
io.on('connection', (socket) => {
  console.log(`Un joueur est connecté : ${socket.id}`);

  // Quand un joueur rejoint le jeu
  socket.on('joinGame', (playerData) => {
    if (modeMultiplayer) {
      const seat = table.assignSeat(playerData);
      if (seat === -1) {
        socket.emit('tableFull', { message: 'La table est complète.' });
        return;
      }
      socket.playerSeat = seat;
      console.log(`${playerData.name} a rejoint la table au siège ${seat}`);
      // On émet l'état actuel de la table à tous les clients
      io.emit('updateTable', table.getState());
    }
    // Brancher le mode solo ou la gestion des bots ici le cas échéant
  });

  // Gérer les actions des joueurs (Call, Raise, Fold, etc.)
  socket.on('playerAction', (data) => {
    console.log(`Action du joueur ${socket.id} (siège ${socket.playerSeat}) :`, data);
    // Ici, intégrez la logique de jeu pour traiter l'action du joueur
    // Mise à jour du pot, vérification de la validité de l'action, etc.
    // Par simplicité, on réémet l'état de la table pour l'instant
    io.emit('updateTable', table.getState());
  });

  // Gestion de la déconnexion
  socket.on('disconnect', () => {
    const seat = socket.playerSeat;
    if (seat !== undefined && seat !== null) {
      table.removePlayer(seat);
      console.log(`Le joueur au siège ${seat} s'est déconnecté.`);
      io.emit('updateTable', table.getState());
    }
  });
});

// Lancement du serveur
server.listen(PORT, () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);
});