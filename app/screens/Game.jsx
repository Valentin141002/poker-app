import React, { useEffect, useState } from 'react';
import io from 'socket.io-client';

const SOCKET_SERVER_URL = "https://imdcx-fcfa0a3fc0a8.herokuapp.com/"; // URL de votre serveur

const GameScreen = () => {
  const [socket, setSocket] = useState(null);
  const [privateCards, setPrivateCards] = useState([]);
  const [communityCards, setCommunityCards] = useState([]);
  const [phase, setPhase] = useState("En attente");
  const [pot, setPot] = useState(0);
  const [gameMessage, setGameMessage] = useState("");
  const [players, setPlayers] = useState([]);
  const [isYourTurn, setIsYourTurn] = useState(false);
  
  useEffect(() => {
    const newSocket = io(SOCKET_SERVER_URL);
    setSocket(newSocket);
    
    newSocket.on("connect", () => {
      console.log("Connecté avec l'ID:", newSocket.id);
      newSocket.emit("joinGame");
    });
    
    newSocket.on("privateCards", data => {
      console.log("Cartes privées reçues:", data.cards);
      setPrivateCards(data.cards);
    });
    
    newSocket.on("roomUpdate", data => {
      setPlayers(data.players);
    });
    
    newSocket.on("bettingRoundStart", data => {
      setPhase(data.phase);
      setPot(data.pot);
      setGameMessage(`Round ${data.phase} commencé. Pot: ${data.pot}`);
      // On remet à false jusqu'à ce que le serveur indique que c'est votre tour
      setIsYourTurn(false);
    });
    
    newSocket.on("yourTurn", data => {
      setGameMessage(`C'est votre tour ! Mise minimale: ${data.minimumBet}`);
      setIsYourTurn(true);
    });
    
    newSocket.on("flop", data => {
      setCommunityCards(prev => [...prev, ...data.cards]);
      setPhase("Flop");
    });
    
    newSocket.on("turn", data => {
      setCommunityCards(prev => [...prev, data.card]);
      setPhase("Turn");
    });
    
    newSocket.on("river", data => {
      setCommunityCards(prev => [...prev, data.card]);
      setPhase("River");
    });
    
    newSocket.on("showdown", data => {
      setCommunityCards(data.communityCards);
      setPot(data.pot);
      setGameMessage("Showdown ! Vérifiez vos mains.");
      setIsYourTurn(false);
    });
    
    newSocket.on("gameResult", data => {
      setGameMessage(`Résultat: Gagnant(s): ${data.winners.join(", ")} - Pot: ${data.pot}`);
      setIsYourTurn(false);
    });
    
    return () => newSocket.disconnect();
  }, []);
  
  const sendAction = (action, amount = 0) => {
    if (socket && isYourTurn) {
      socket.emit("playerAction", { action, amount });
      console.log(`Action envoyée: ${action} ${amount}`);
      // Désactiver les boutons pour éviter d'envoyer plusieurs actions
      setIsYourTurn(false);
    }
  };
  
  return (
    <div style={{ fontFamily: 'Arial, sans-serif', padding: 20, textAlign: 'center' }}>
      <h1>Texas Hold'em Poker</h1>
      <p><strong>Phase :</strong> {phase}</p>
      <p><strong>Pot :</strong> {pot}</p>
      <p><strong>Message :</strong> {gameMessage}</p>
      
      <h2>Vos cartes privées</h2>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
        {privateCards.map((card, i) => (
          <div key={i} style={{ border: '1px solid #ccc', borderRadius: 4, padding: 10, width: 50, textAlign: 'center' }}>
            {card.rank}{card.suit}
          </div>
        ))}
      </div>
      
      <h2>Cartes communes</h2>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
        {communityCards.map((card, i) => (
          <div key={i} style={{ border: '1px solid #ccc', borderRadius: 4, padding: 10, width: 50, textAlign: 'center' }}>
            {card.rank}{card.suit}
          </div>
        ))}
      </div>
      
      {/* Affichez les boutons d'action seulement si c'est votre tour */}
      {isYourTurn && (
        <>
          <h2>Actions</h2>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
            <button onClick={() => sendAction("bet", 10)}>Miser 10</button>
            <button onClick={() => sendAction("call")}>Suivre</button>
            <button onClick={() => sendAction("raise", 20)}>Relancer 20</button>
            <button onClick={() => sendAction("fold")}>Se coucher</button>
          </div>
        </>
      )}
      
      <h2>Joueurs connectés</h2>
      <p>{players.join(", ")}</p>
    </div>
  );
};

export default GameScreen;
