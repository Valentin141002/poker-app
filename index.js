// index.js
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const Table = require('./table'); // On importe notre module de gestion de la table

// Configure Express
const app = express();

// Servir le contenu statique depuis le dossier public (à adapter si tu utilises un autre dossier, ex. poker-app)
app.use(express.static(path.join(__dirname, 'public')));

// Créer le serveur HTTP
const server = http.createServer(app);

// Configurer Socket.IO sur le serveur HTTP
const io = socketIo(server);

// Création d'une instance de Table pour 10 joueurs
const table = new Table(10);

// Lorsqu'un client se connecte
io.on('connection', (socket) => {
  console.log("Un joueur s'est connecté : " + socket.id);

  // Événement pour rejoindre la partie
  socket.on('joinGame', (playerData) => {
    const seat = table.assignSeat(playerData);
    if (seat === -1) {
      socket.emit('tableFull', { message: 'La table est pleine' });
      return;
    }
    socket.playerSeat = seat;
    console.log("Joueur " + playerData.name + " assigné au siège " + seat);
    
    // Diffuser l'état mis à jour de la table à tous les clients
    io.emit('updateTable', table.getState());
  });

  // Écoute d'autres événements de jeu (call, raise, fold, etc.)
  socket.on('playerAction', (actionData) => {
    console.log("Action reçue de " + socket.id, actionData);
    // Ici, intégrer la logique de jeu côté serveur :
    // - Vérifier la validité de l'action (ex. call, raise, fold)
    // - Mettre à jour la table (pot, mises, etc.)
    
    // Exemple simplifié : on diffuse directement l'état actuel
    io.emit('updateTable', table.getState());
  });

  // Gérer la déconnexion d'un joueur
  socket.on('disconnect', () => {
    const seat = socket.playerSeat;
    if (seat !== undefined && seat !== null) {
      table.removePlayer(seat);
      console.log("Joueur du siège " + seat + " déconnecté.");
      io.emit('updateTable', table.getState());
    }
  });
});

// Lancer le serveur sur le port indiqué (par exemple 3000)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("Serveur démarré sur le port " + PORT);
});