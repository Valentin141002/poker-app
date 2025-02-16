// Game.jsx
import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import io from "socket.io-client";

// Remplacez par l'adresse IP locale de votre machine (trouvée via ipconfig/ifconfig) et le port 3000
const SOCKET_SERVER_URL = "https://imdcx-fcfa0a3fc0a8.herokuapp.com/";

const GameScreen = () => {
  const [socket, setSocket] = useState(null);
  const [players, setPlayers] = useState([]);
  const [gameMessage, setGameMessage] = useState("");
  const [winner, setWinner] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Créer la connexion au serveur Socket.IO
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connecté au serveur avec l'ID :", newSocket.id);
      // Envoyer l'événement "joinGame" dès la connexion
      newSocket.emit("joinGame");
    });

    // Mise à jour de la liste des joueurs
    newSocket.on("roomUpdate", (data) => {
      setPlayers(data.players);
    });

    // Début de la partie
    newSocket.on("gameStart", (data) => {
      setGameMessage(data.message);
      setLoading(false);
    });

    // Résultat de la partie
    newSocket.on("gameResult", (data) => {
      setWinner(data.winnerId);
      setGameMessage(data.winnerId === newSocket.id ? "Vous avez gagné !" : "Vous avez perdu.");
    });

    // Nettoyage lors du démontage
    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Table de Poker Interactive</Text>
      {loading ? (
        <ActivityIndicator style={{ marginVertical: 20 }} />
      ) : (
        <Text style={styles.info}>Joueurs dans la salle : {players.join(", ")}</Text>
      )}
      {gameMessage !== "" && <Text style={styles.message}>{gameMessage}</Text>}
      {winner && <Text style={styles.winner}>Gagnant : {winner}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 20 },
  header: { fontSize: 24, fontWeight: "bold", marginBottom: 20 },
  info: { marginVertical: 10, fontSize: 16 },
  message: { fontSize: 20, marginVertical: 10 },
  winner: { fontSize: 18, fontWeight: "bold", color: "green" }
});

export default GameScreen;