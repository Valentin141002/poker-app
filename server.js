const express = require("express");
const path = require("path");
const app = express();

// Servir les fichiers statiques depuis le dossier "src"
app.use(express.static(path.join(__dirname, 'src')));

// Pour toutes les autres routes, renvoyer index.html (qui doit être dans src)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

module.exports = app;