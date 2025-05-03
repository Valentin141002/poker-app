document.addEventListener('DOMContentLoaded', () => {
    const playersList = document.getElementById('players-list');
    // Génère 10 champs
    for (let i = 1; i <= 10; i++) {
      const inp = document.createElement('input');
      inp.name = 'player';
      inp.placeholder = `Joueur ${i}`;
      playersList.appendChild(inp);
    }
  
    document.getElementById('table-form').addEventListener('submit', async e => {
      e.preventDefault();
      const players = Array.from(document.getElementsByName('player'))
                           .map(inp => inp.value.trim())
                           .filter(v => v);
      if (players.length !== 10) {
        return alert('Veuillez remplir les 10 noms de joueurs.');
      }
      const mode = document.getElementById('mode').value;
      try {
        const res = await fetch('/admin/createTable', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ players, mode })
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        document.getElementById('result').innerHTML =
          `<p>Lien de la table :</p>
           <p><a href="${data.link}" target="_blank">${data.link}</a></p>`;
      } catch (err) {
        alert('Erreur : ' + err.message);
      }
    });
  });
  