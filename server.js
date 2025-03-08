const express = require('express');
const path = require('path');
const http = require('http');
const socketIo = require('socket.io');

// Création de l'application Express
const app = express();

// Création du serveur HTTP à partir d'Express
const server = http.createServer(app);

// Initialisation de Socket.io sur le serveur
const io = socketIo(server);

// Définition du port (utilise process.env.PORT pour Heroku)
const PORT = process.env.PORT || 3000;

// Middleware pour servir les fichiers statiques du dossier poker-app
app.use(express.static(path.join(__dirname, 'poker-app')));

// Pour toute autre route, renvoyer le fichier poker.html (point d'entrée de ton application)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'poker-app', 'poker.html'));
});

// Gestion des connexions Socket.io
io.on('connection', (socket) => {
  console.log(`Un utilisateur est connecté : ${socket.id}`);

  // Exemple d'événement : rejoindre une salle (table de poker)
  socket.on('joinRoom', (room) => {
    socket.join(room);
    console.log(`L'utilisateur ${socket.id} a rejoint la salle ${room}`);
    // Ici, tu peux émettre un message de bienvenue ou informer les autres utilisateurs de la salle.
    io.to(room).emit('message', `L'utilisateur ${socket.id} a rejoint la salle !`);
  });

  // Autres événements personnalisés, par exemple 'playerAction' ou 'updateGameState'
  socket.on('playerAction', (data) => {
    // Gère l'action du joueur et diffuse l'état mis à jour à tous les participants de la salle.
    console.log(`Action du joueur ${socket.id} :`, data);
    // Par exemple, émettre à tous les clients de la salle :
    io.to(data.room).emit('gameStateUpdate', data);
  });

  // Déconnexion de l'utilisateur
  socket.on('disconnect', () => {
    console.log(`L'utilisateur s'est déconnecté : ${socket.id}`);
  });
});

// Lancement du serveur
server.listen(PORT, () => {
  console.log(`Serveur en écoute sur le port ${PORT}`);
});