// admin-app/admin.js
console.log('>> admin.js chargé');

document.addEventListener('DOMContentLoaded', () => {
  const socket = io();
    window.socket = socket;           // ← AJOUT 1 : expose le socket globalement
  socket.emit('joinAdmin');

  // ——————————————————————————————————————————
  // Live cache des états
  // ——————————————————————————————————————————
  const tablesData   = {};
  const matches2Data = {};

  // ─────────────────────────────────────────────────────
  // Tables 10 joueurs
  // ─────────────────────────────────────────────────────
  socket.on('updateTable', ({ tableID, gameState }) => {
    tablesData[tableID] = gameState;
    const dr = document.querySelector(`tr[data-table="${tableID}"] + .details-row`);
    if (dr && !dr.hidden) renderDetails(tableID, dr);
    const row = document.querySelector(`tr[data-table="${tableID}"]`);
    if (row) {
      const dot = row.querySelector('.status-dot');
      dot.classList.add('status-active');
      dot.classList.remove('status-inactive');
    }
  });

  // ─────────────────────────────────────────────────────
  // Matchs 2 joueurs (face-à-face)
  // ─────────────────────────────────────────────────────
  socket.on('updateMatch2', ({ matchID, gameState }) => {
    matches2Data[matchID] = gameState;
    const row = document.querySelector(`tr[data-match="${matchID}"]`);
    if (row) {
      const dot = row.querySelector('.status-dot');
      dot.classList.add('status-active');
      dot.classList.remove('status-inactive');
    }
    const dr = document.querySelector(`tr[data-match="${matchID}"] + .details-row`);
    if (dr && !dr.hidden) {
      renderMatch2Details(matchID, dr);
    }  });

  // ────────────────────────────────────────────────────
  // Waiting room (une seule fois pour les deux cas)
  // ─────────────────────────────────────────────────────
  socket.on('updateWaitingRoom', payload => {
    // payload contient soit tableID soit matchID
    if ('tableID' in payload) {
      const { tableID, waitingCount } = payload;
      tablesData[tableID] = tablesData[tableID] || {};
      tablesData[tableID].waitingCount = waitingCount;
      const dr = document.querySelector(`tr[data-table="${tableID}"] + .details-row`);
      if (dr && !dr.hidden) renderDetails(tableID, dr);
    } else if ('matchID' in payload) {
      const { matchID, waitingCount } = payload;
      matches2Data[matchID] = matches2Data[matchID] || {};
      matches2Data[matchID].waitingCount = waitingCount;
      const dr = document.querySelector(`tr[data-match="${matchID}"] + .details-row`);
      if (dr && !dr.hidden) renderMatch2Details(matchID, dr);
    }
  });

  // ─────────────────────────────────────────────────────
  // Fin de partie : on met à jour la colonne “Winner”
  // ─────────────────────────────────────────────────────
  socket.on('tableFinished', ({ tableID, winner }) => {
    const row = document.querySelector(`tr[data-table="${tableID}"]`);
    if (row) row.querySelector('.winner-cell').textContent = winner;
    const dot = row.querySelector('.status-dot');
    dot.classList.add('status-inactive');
    dot.classList.remove('status-active');
  });
  socket.on('match2Finished', ({ matchID, winner }) => {
    const row = document.querySelector(`tr[data-match="${matchID}"]`);
    if (row) {
      row.querySelector('.winner-cell').textContent = winner;
      const dot = row.querySelector('.status-dot');
      dot.classList.add('status-inactive');
      dot.classList.remove('status-active');
    }
  });

  // ─────────────────────────────────────────────────────
  // Refresh forces quand on supprime en admin
  // ─────────────────────────────────────────────────────
  socket.on('tablesUpdated', ()    => { if (tabTables.classList.contains('active'))    fetchTables(); });
  socket.on('matches2Updated', () => { if (tabMatches2.classList.contains('active')) fetchMatches(); });

  // ────────────────────────────────────────────────────
// Quand un profil est supprimé, on rafraîchit la vue
// ────────────────────────────────────────────────────
socket.on('profilesUpdated', () => {
  // si on est sur l’onglet Profils (10 joueurs)
  if (tabProfiles10.classList.contains('active')) {
    const tbody10 = profilesPanel.querySelector('tbody');
    fetchProfiles(tbody10, 'table');
  }
  // si on est sur l’onglet Profils (2 joueurs)
  if (tabProfiles2.classList.contains('active')) {
    const tbody2 = profiles2Panel.querySelector('tbody');
    fetchProfiles(tbody2, 'match2');
  }
});


// … à placer à l’intérieur de document.addEventListener('DOMContentLoaded', () => { … })

// ——————————————————————————————————————————
// Recherche dans l’onglet Profils (10 joueurs + 2 joueurs)
// ——————————————————————————————————————————
function setupProfileSearch(inputId, tableSelector) {
  const inp = document.getElementById(inputId);
  inp.addEventListener('input', () => {
    const term = inp.value.trim().toLowerCase();
    document.querySelectorAll(`${tableSelector} tbody tr`).forEach(tr => {
      // on ignore les lignes de détails
      if (tr.classList.contains('profile-details')) return;
      const name = (tr.dataset.name || '').toLowerCase();
      const show = name.includes(term);
      tr.style.display = show ? '' : 'none';
      // on masque aussi la ligne de détails associée
      const dr = tr.nextElementSibling;
      if (dr && dr.classList.contains('profile-details')) {
        dr.style.display = show ? '' : 'none';
      }
    });
  });
}

// Profils 10
setupProfileSearch('profile-search', '#profiles-table');
// Profils 2
setupProfileSearch('level-search',   '#profiles2-table'); // si tu veux la même logique pour match2


// ——————————————————————————————————————————
// Recherche dans l’onglet Niveaux
// ——————————————————————————————————————————
const levelInput = document.getElementById('level-search');
levelInput.addEventListener('input', () => {
  const term = levelInput.value.trim().toLowerCase();
  document.querySelectorAll('#levels-table tbody tr').forEach(tr => {
    // on ignore les lignes d’historique
    if (tr.classList.contains('history-details')) return;
    const nameCell = tr.querySelector('td:first-child');
    const name = (nameCell?.textContent || '').trim().toLowerCase();
    const show = name.includes(term);
    tr.style.display = show ? '' : 'none';
    // masque aussi la ligne d’historique si elle existe juste après
    const dr = tr.nextElementSibling;
    if (dr && dr.classList.contains('history-details')) {
      dr.style.display = show ? '' : 'none';
    }
  });
});


  // ——————————————————————————————————————————
  // Affichage des détails “Voir plus” (10-j)
  // ——————————————————————————————————————————
  function renderDetails(tableID, detailsRow) {
    const g = tablesData[tableID];
    const cell = detailsRow.querySelector('td');
    if (!g || (g.waitingCount===undefined && !g.players)) {
      cell.innerHTML = `<em>En attente d'informations…</em>`;
      return;
    }
    if (g.waitingCount!==undefined && !g.players) {
      cell.innerHTML = `<div><strong>En attente :</strong> ${g.waitingCount}/10 joueurs</div>`;
      return;
    }
    cell.innerHTML = `
      <div style="padding:8px;">
        <div style="margin-bottom:12px;">
          <strong>Pot commun :</strong> ${g.pot} jetons<br>
          <strong>Cartes communes :</strong> ${g.board.join(', ')}
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
          ${g.players.map(p => `
            <div style="background:var(--bg-dark);padding:8px;border-radius:var(--radius);">
              <h4 style="margin:0 0 4px;color:var(--accent);">
                Siège ${p.seat+1} – ${p.label}
              </h4>
              <p>Mise : ${p.subtotal_bet}</p>
              <p>Bankroll : ${p.bankroll}</p>
              <p>Cartes : ${p.carda}, ${p.cardb}</p>
              <p>Statut : ${p.status || 'ACTIF'}</p>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  // ——————————————————————————————————————————
  // Affichage des détails “Voir plus” (2-j)
  // ——————————————————————————————————————————
/**
 * Affiche les détails (pot, board, joueurs) d’un match 2-joueurs
 */
function renderMatch2Details(matchID, detailsRow) {
  const g = matches2Data[matchID];
  const cell = detailsRow.querySelector('td');

  // cas "waiting room" pour 2 joueurs
  if (g.waitingCount !== undefined && !g.players) {
    cell.innerHTML = `
      <div>
        <strong>En attente de joueurs :</strong> ${g.waitingCount}/2
      </div>`;
    return;
  }

  // si on est vraiment en jeu
  if (!g.players) {
    cell.innerHTML = `<em>En attente d'informations…</em>`;
    return;
  }

  // affichage normal du board + joueurs
  cell.innerHTML = `
    <div style="padding:8px;">
      <div style="margin-bottom:12px;">
        <strong>Pot commun :</strong> ${g.pot} jetons<br>
        <strong>Cartes communes :</strong> ${g.board.join(', ')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;">
        ${g.players.map(p => `
          <div style="background:var(--bg-dark);padding:8px;border-radius:4px;">
            <h4 style="margin:0 0 4px;color:var(--accent);">
              Siège ${p.seat+1} – ${p.label}
            </h4>
            <p>Mise : ${p.subtotal_bet}</p>
            <p>Bankroll : ${p.bankroll}</p>
            <p>Cartes : ${p.carda}, ${p.cardb}</p>
            <p>Statut : ${p.status || 'ACTIF'}</p>
          </div>
        `).join('')}
      </div>
    </div>`;
}

  // ——————————————————————————————————————————
  // Main tabs
  // ——————————————————————————————————————————
  const main10   = document.getElementById('main-10'),
        main2    = document.getElementById('main-2'),
        mainNiv  = document.getElementById('main-niveaux');
  const create10 = document.getElementById('panel-10-create'),
        create2  = document.getElementById('panel-2-create');
  const content10= document.getElementById('panel-10-content'),
        content2 = document.getElementById('panel-2-content'),
        contentN = document.getElementById('panel-niveaux');
  function hideAll() {
    [create10, create2, content10, content2, contentN].forEach(e => e.hidden = true);
    [main10, main2, mainNiv].forEach(e => e.classList.remove('active'));
  }
  main10.addEventListener('click', () => {
    hideAll();
    main10.classList.add('active');
    create10.hidden = false;
    content10.hidden = false;
    tabTables.click();  // safe: tabTables is declared below
  });
  main2.addEventListener('click', () => {
    hideAll();
    main2.classList.add('active');
    create2.hidden = false;
    content2.hidden = false;
    tabMatches2.click();
  });
  mainNiv.addEventListener('click', () => {
    hideAll();
    mainNiv.classList.add('active');
    contentN.hidden = false;
    fetchLevels();
  });

  // ——————————————————————————————————————————
  // Partie 10 sub-tabs
  // ——————————————————————————————————————————
  const tabTables     = document.getElementById('tab-tables'),
        tabProfiles10 = document.getElementById('tab-profiles'),
        tabGames10    = document.getElementById('tab-games');
  const tablesPanel   = document.getElementById('tables-list').closest('table').parentNode,
        profilesPanel = document.getElementById('profiles-table').closest('table').parentNode,
        gamesPanel    = document.getElementById('games-table').closest('table').parentNode;
  function hideSub10() {
    [tablesPanel, profilesPanel, gamesPanel].forEach(e=>e.hidden=true);
    [tabTables, tabProfiles10, tabGames10].forEach(e=>e.classList.remove('active'));
  }
  tabTables.addEventListener('click',    ()=>{ hideSub10(); tabTables.classList.add('active'); tablesPanel.hidden=false; fetchTables(); });
  tabProfiles10.addEventListener('click', ()=>{
    hideSub10();
    tabProfiles10.classList.add('active');
    profilesPanel.hidden=false;
    fetchProfiles(profilesPanel.querySelector('tbody'));
  });  

  tabGames10.addEventListener('click',   ()=>{ hideSub10(); tabGames10.classList.add('active'); gamesPanel.hidden=false;    fetchGames(gamesPanel.querySelector('tbody'),'table'); });

  // ——————————————————————————————————————————
  // Partie 2 sub-tabs
  // ——————————————————————————————————————————
// ——————————————————————————————————————————
// Partie 2 sub-tabs (à placer AVANT tout listener qui les utilise)
// ——————————————————————————————————————————
const tabMatches2   = document.getElementById('tab-matches2');
const tabProfiles2  = document.getElementById('tab-profiles2');
const tabGames2     = document.getElementById('tab-games2');
const matches2Panel = document.getElementById('matches2-list')
                        .closest('table').parentNode;
const profiles2Panel= document.getElementById('profiles2-table')
                        .closest('table').parentNode;
const games2Panel   = document.getElementById('games2-table')
                        .closest('table').parentNode;

function hideSub2() {
  [matches2Panel, profiles2Panel, games2Panel].forEach(e => e.hidden = true);
  [tabMatches2, tabProfiles2, tabGames2].forEach(e => e.classList.remove('active'));
}

tabMatches2.addEventListener('click', () => {
  hideSub2();
  tabMatches2.classList.add('active');
  matches2Panel.hidden = false;
  fetchMatches();
});

tabProfiles2.addEventListener('click', () => {
  hideSub2();
  tabProfiles2.classList.add('active');
  profiles2Panel.hidden = false;
  fetchProfiles(profiles2Panel.querySelector('tbody'), 'match2');
});

tabGames2.addEventListener('click', () => {
  hideSub2();
  tabGames2.classList.add('active');
  games2Panel.hidden = false;
  fetchGames(games2Panel.querySelector('tbody'), 'match2');
});

  // ——————————————————————————————————————————
  // Create 10-player table form
  // ——————————————————————————————————————————
// Récupération des éléments clés
const tableForm   = document.getElementById('table-form'),
      createBtn   = document.getElementById('create-btn'),
      result10    = document.getElementById('result');

// Gestion du sélecteur de mode
const modeOpts10      = Array.from(document.querySelectorAll('#panel-10-create .mode-option'));
let selectedMode10    = modeOpts10[0].dataset.mode;
modeOpts10.forEach(o => o.addEventListener('click', () => {
  selectedMode10 = o.dataset.mode;
  modeOpts10.forEach(x => x.classList.toggle('active', x === o));
}));
modeOpts10[0].classList.add('active');

// Validation des 10 noms avant activation du bouton
function checkTableInputs() {
  const filled = Array.from(tableForm.elements['player'])
                      .filter(i => i.value.trim() !== '').length;
  createBtn.disabled = filled !== 10;
}
tableForm.querySelectorAll('input[name="player"]')
         .forEach(i => i.addEventListener('input', checkTableInputs));
checkTableInputs();

// 1) Event‐delegation sur #result pour gérer tous les COPY
result10.addEventListener('click', e => {
  if (!e.target.classList.contains('copy-link-btn')) return;
  const btn  = e.target;
  const link = btn.dataset.link;
  if (!link) return alert("Erreur interne : lien introuvable.");

  navigator.clipboard.writeText(link)
    .then(() => {
      const fb = btn.nextElementSibling;
      fb.textContent = 'Lien copié !';
      setTimeout(() => { fb.textContent = ''; }, 2000);
    })
    .catch(() => {
      alert('Impossible de copier le lien.');
    });
});

// 2) Submission du formulaire → création de la table + génération des boutons COPY
tableForm.addEventListener('submit', async e => {
  e.preventDefault();
  const players = Array.from(tableForm.elements['player'])
                       .map(i => i.value.trim());

  try {
    const res  = await fetch('/admin/createTable', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ players, mode: selectedMode10 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    // Génération des 10 boutons COPY
    const base = data.link; // ex: https://…/?table=XYZ
    let html = '<p>Liens pour chaque siège :</p><ul>';
    for (let i = 0; i < 10; i++) {
      html += `
        <li>
          Siège ${i+1} :
          <button type="button"
                  class="copy-link-btn"
                  data-link="${base}&seat=${i}">
            COPY
          </button>
          <span class="copy-feedback"></span>
        </li>
      `;
    }
    html += '</ul>';

    // Injection dans le DOM
    result10.innerHTML = html;

    // Rafraîchissement de la liste des tables admin
    await fetchTables();
  } catch (err) {
    alert('Erreur création table : ' + err.message);
  }
});
  
  // ——————————————————————————————————————————
  // Create 2-player match form
  // ——————————————————————————————————————————
// ——————————————————————————————————————————
// Create 2-player match form
// ——————————————————————————————————————————
const matchForm  = document.getElementById('match2-form');
const create2Btn  = document.getElementById('create2-btn');
const result2     = document.getElementById('result2');

// Delegation pour tous les COPY buttons dans result2
result2.addEventListener('click', e => {
  if (!e.target.classList.contains('copy-link-btn')) return;
  const btn  = e.target;
  const link = btn.dataset.link;
  if (!link) return alert("Erreur interne : lien introuvable.");
  navigator.clipboard.writeText(link)
    .then(() => {
      const fb = btn.nextElementSibling;
      fb.textContent = 'Lien copié !';
      setTimeout(() => fb.textContent = '', 2000);
    })
    .catch(() => alert('Impossible de copier le lien.'));
});

// Mode selector (inchangé)
const modeOpts2  = Array.from(document.querySelectorAll('#panel-2-create .mode-option'));
let selectedMode2 = modeOpts2[0].dataset.mode;
modeOpts2.forEach(o => o.addEventListener('click', () => {
  selectedMode2 = o.dataset.mode;
  modeOpts2.forEach(x => x.classList.toggle('active', x === o));
}));
modeOpts2[0].classList.add('active');

// Validation des 2 noms
function checkMatchInputs(){
  const filled = Array.from(matchForm.elements['player2'])
                      .filter(i=>i.value.trim()!=='').length;
  create2Btn.disabled = filled !== 2;
}
matchForm.querySelectorAll('input[name="player2"]')
         .forEach(i=>i.addEventListener('input', checkMatchInputs));
checkMatchInputs();

// Submit → création du match + génération des 2 liens COPY
matchForm.addEventListener('submit', async e => {
  e.preventDefault();
  const players = Array.from(matchForm.elements['player2'])
                       .map(i => i.value.trim());
  try {
    const res  = await fetch('/admin/createMatch2',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ players, mode:selectedMode2 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||res.statusText);

    // Génération des 2 boutons COPY
    // data.link = ex: https://…/?match2=XYZ
    const base = data.link;
    let html = '<p>Liens pour chaque joueur :</p><ul style="list-style:none;padding:0;">';
    for (let i = 0; i < 2; i++) {
      html += `
        <li style="margin-bottom:6px;">
          Player${i+1} :
          <button type="button"
                  class="copy-link-btn"
                  data-link="${base}&seat=${i}">
            COPY
          </button>
          <span class="copy-feedback"></span>
        </li>
      `;
    }
    html += '</ul>';

    result2.innerHTML = html;
    // refresh liste des matches
    fetchMatches();
  } catch(err) {
    alert('Erreur création match : ' + err.message);
  }
});

  async function fetchLevels() {
    const tbody = document.querySelector('#levels-table tbody');
    tbody.innerHTML = '';
  
    try {
      const res  = await fetch('/admin/getLevels');
      if (!res.ok) throw new Error(res.statusText);
      const list = await res.json();
  
      if (list.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td colspan="6" style="text-align:center;color:gray">
            Aucun joueur enregistré.
          </td>`;
        tbody.appendChild(tr);
        return;
      }
  
      list.forEach(p => {
        // Texte de la dernière action
        const lastChange = p.history.length
          ? p.history[p.history.length - 1].action
          : '';
  
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${p.name}</td>
          <td>${p.level}</td>
          <td>${p.gamesPlayed}</td>
          <td>${p.wins}</td>
          <td>${lastChange}</td>
          <td><button class="history-btn">Historique</button></td>
        `;
  
        tr.querySelector('.history-btn').addEventListener('click', () => {
          let dr = tr.nextElementSibling;
          if (dr && dr.classList.contains('history-details')) {
            dr.hidden = !dr.hidden;
            return;
          }
  
                 // On ne garde que les 10 dernières entrées, du plus récent en haut
                 const recent = p.history.slice(-10).reverse();
          
                 dr = document.createElement('tr');
                 dr.classList.add('history-details');
                 dr.innerHTML = `
                   <td colspan="6">
                     <div class="history-container">
                       <ul>
                         ${recent.map(h => `
                           <li>
                             <span class="history-date">
                               ${h.date.replace('T',' ').slice(0,19)}
                             </span>
                             <span class="history-action">
                               ${h.action}
                             </span>
                           </li>
                         `).join('')}
                       </ul>
                     </div>
                   </td>`;
          tr.parentNode.insertBefore(dr, tr.nextSibling);
        });
  
        tbody.appendChild(tr);
      });
  
    } catch (err) {
      console.error('fetchLevels failed:', err);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="6" style="text-align:center;color:red">
          Échec du chargement des niveaux.
        </td>`;
      tbody.appendChild(tr);
    }
  }  
  
  // ——————————————————————————————————————————
  // Data fetchers
  // ——————————————————————————————————————————
  let previousTableIDs = [];  // Mémoire de l’ordre des tables

  async function fetchTables() {
    const tbody = document.querySelector('#tables-list tbody');
    tbody.innerHTML = '';
  
    try {
      const res  = await fetch('/admin/getTables');
      const list = await res.json();
  
      // 1) Aucune table
      if (list.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td colspan="6" style="text-align:center;color:gray">
            Aucune table.
          </td>`;
        tbody.appendChild(tr);
        return;
      }
  
      // 2) Highlight des nouvelles tables
      const oldIDs = previousTableIDs;
      const newIDs = list.map(t => t.tableID)
                         .filter(id => !oldIDs.includes(id));
  
      // 3) Itération sur chaque table
      list.forEach(t => {
        const dotClass = t.winner ? 'status-inactive' : 'status-active';
  
        // ← Création de la ligne principale
        const tr = document.createElement('tr');
        tr.dataset.table = t.tableID;
        tr.innerHTML = `
          <td class="status-cell">
            <span class="status-dot ${dotClass}"></span>
          </td>
          <td>${t.tableID}</td>
          <td>${t.mode}</td>
          <td class="winner-cell">${t.winner || '—'}</td>
          <td>
            <button type="button" class="copy-links-btn">
              Liens
            </button>
          </td>
          <td>
            <button class="toggle-details-btn">Voir plus</button>
            <button class="delete-btn">Delete</button>
          </td>
        `;
  
        // ——— Bouton “Liens” ———
        tr.querySelector('.copy-links-btn').addEventListener('click', () => {
          // Toggle : si la ligne existe, on la supprime
          let dr = tr.nextElementSibling;
          if (dr && dr.classList.contains('seat-links-row')) {
            dr.remove();
            return;
          }
  
          // Sinon, on crée la ligne de liens de sièges
          const base = `${location.origin}?table=${t.tableID}`;
          dr = document.createElement('tr');
          dr.classList.add('seat-links-row');
          dr.innerHTML = `
            <td colspan="6">
              <ul style="list-style:none;padding:8px;margin:0;">
                ${[...Array(10)].map((_, i) => `
                  <li style="display:flex;align-items:center;gap:8px;padding:4px 0;">
                    Siège ${i+1} :
                    <button type="button"
                            class="copy-link-btn"
                            data-link="${base}&seat=${i}">
                      COPY
                    </button>
                    <span class="copy-feedback"></span>
                  </li>
                `).join('')}
              </ul>
            </td>
          `;
          tr.parentNode.insertBefore(dr, tr.nextSibling);
  
          // On bind les handlers COPY pour chaque bouton
          dr.querySelectorAll('.copy-link-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const link = btn.dataset.link;
              navigator.clipboard.writeText(link)
                .then(() => {
                  const fb = btn.nextElementSibling;
                  fb.textContent = 'Lien copié !';
                  setTimeout(() => { fb.textContent = ''; }, 2000);
                })
                .catch(() => alert('Impossible de copier le lien.'));
            });
          });
        });
  
        // ——— Bouton “Voir plus” (détails) ———
        tr.querySelector('.toggle-details-btn').addEventListener('click', () => {
          let dr = tr.nextElementSibling;
          if (dr?.classList.contains('details-row')) {
            dr.hidden = !dr.hidden;
          } else {
            dr = document.createElement('tr');
            dr.classList.add('details-row');
            dr.innerHTML = `<td colspan="5"></td>`;
            tr.parentNode.insertBefore(dr, tr.nextSibling);
            renderDetails(t.tableID, dr);
          }
        });
  
        // ——— Bouton “Delete” ———
        tr.querySelector('.delete-btn').addEventListener('click', async () => {
          if (!confirm(`Supprimer la table ${t.tableID} ?`)) return;
          try {
            const del = await fetch(`/admin/deleteTable/${t.tableID}`, {
              method: 'DELETE'
            });
            if (!del.ok) throw new Error(await del.text());
            // suppression de la ligne principale et de ses détails
            const dr = tr.nextElementSibling;
            if (dr?.classList.contains('details-row')
             || dr?.classList.contains('seat-links-row')) {
              dr.remove();
            }
            tr.remove();
          } catch (err) {
            alert('Erreur suppression : ' + err.message);
          }
        });
  
        // 4) Insertion en haut du tableau
        tbody.insertBefore(tr, tbody.firstChild);
  
        // 5) Surbrillance si nouveau
        if (newIDs.includes(t.tableID)) {
          tr.style.backgroundColor = '#3f8ed8';
          tr.getBoundingClientRect();
          tr.style.transition = 'background-color 2s ease';
          tr.style.backgroundColor = '';
        }
      });
  
      // 6) Mise à jour de la mémoire des IDs
      previousTableIDs = list.map(t => t.tableID);
  
    } catch (err) {
      console.error('fetchTables failed:', err);
    }
  }  
  
  
  // ——————————————————————————————————————————
  // Partie face-à-face (2 joueurs)
  // ——————————————————————————————————————————
  let previousMatchIDs2 = [];  // Mémoire pour les matchs 2
  
  async function fetchMatches() {
    const tbody = document.querySelector('#matches2-list tbody');
    tbody.innerHTML = '';
  
    try {
      const res  = await fetch('/admin/getMatches2');
      const list = await res.json();
  
      // 1) Aucun match en cours
      if (list.length === 0) {
        previousMatchIDs2 = [];
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td colspan="6" style="text-align:center;color:gray">
            Aucun match en cours.
          </td>`;
        return tbody.appendChild(tr);
      }
  
      // 2) Repérage des nouveaux IDs
      const oldIDs = previousMatchIDs2;
      const newIDs = list.map(m => m.matchID)
                         .filter(id => !oldIDs.includes(id));
  
      // 3) Création d’une ligne <tr> par match
      list.forEach(m => {
        const dotClass = m.winner ? 'status-inactive' : 'status-active';
        const tr = document.createElement('tr');
        tr.dataset.match = m.matchID;
        tr.innerHTML = `
          <td class="status-cell">
            <span class="status-dot ${dotClass}"></span>
          </td>
          <td>${m.matchID}</td>
          <td>${m.mode}</td>
          <td class="winner-cell">${m.winner || '—'}</td>
          <td>
            <button type="button" class="copy-links-btn">
              Liens
            </button>
          </td>
          <td>
            <button class="toggle-details-btn">Voir plus</button>
            <button class="delete-btn">Delete</button>
          </td>`;
  
        // — Bouton “Liens” pour dérouler les 2 liens de sièges
        tr.querySelector('.copy-links-btn').addEventListener('click', () => {
          let dr = tr.nextElementSibling;
          // si déjà ouvert, on supprime
          if (dr && dr.classList.contains('seat-links-row')) {
            return dr.remove();
          }
          // sinon on crée la ligne des liens
          const base = `${location.origin}?match2=${m.matchID}`;
          dr = document.createElement('tr');
          dr.classList.add('seat-links-row');
          dr.innerHTML = `
            <td colspan="6">
              <ul style="list-style:none;padding:8px;margin:0;">
                ${[0,1].map(i => `
                  <li style="display:flex;align-items:center;gap:8px;padding:4px 0;">
                    Player${i+1} :
                    <button type="button"
                            class="copy-link-btn"
                            data-link="${base}&seat=${i}">
                      COPY
                    </button>
                    <span class="copy-feedback"></span>
                  </li>
                `).join('')}
              </ul>
            </td>`;
          tr.parentNode.insertBefore(dr, tr.nextSibling);
  
          // binding des COPY buttons
          dr.querySelectorAll('.copy-link-btn').forEach(btn => {
            btn.addEventListener('click', () => {
              const link = btn.dataset.link;
              navigator.clipboard.writeText(link)
                .then(() => {
                  const fb = btn.nextElementSibling;
                  fb.textContent = 'Lien copié !';
                  setTimeout(() => fb.textContent = '', 2000);
                })
                .catch(() => alert('Impossible de copier le lien.'));
            });
          });
        });
  
        // — Bouton “Voir plus” (détails du match)
        tr.querySelector('.toggle-details-btn').addEventListener('click', () => {
          let dr = tr.nextElementSibling;
          if (dr?.classList.contains('details-row')) {
            return dr.hidden = !dr.hidden;
          }
          dr = document.createElement('tr');
          dr.classList.add('details-row');
          dr.innerHTML = `<td colspan="6"></td>`;
          tr.parentNode.insertBefore(dr, tr.nextSibling);
          renderMatch2Details(m.matchID, dr);
        });
  
        // — Bouton “Delete” pour supprimer le match
        tr.querySelector('.delete-btn').addEventListener('click', async () => {
          if (!confirm(`Supprimer le match ${m.matchID} ?`)) return;
          try {
            const del = await fetch(`/admin/deleteMatch2/${m.matchID}`, {
              method: 'DELETE'
            });
            if (!del.ok) throw new Error(await del.text());
            const next = tr.nextElementSibling;
            if (next?.classList.contains('seat-links-row') ||
                next?.classList.contains('details-row')) {
              next.remove();
            }
            tr.remove();
          } catch (err) {
            alert('Erreur suppression : ' + err.message);
          }
        });
  
        // 4) Insertion et surlignage si nouveau
        tbody.insertBefore(tr, tbody.firstChild);
        if (newIDs.includes(m.matchID)) {
          tr.style.backgroundColor = '#3f8ed8';
          tr.getBoundingClientRect();
          tr.style.transition = 'background-color 2s ease';
          tr.style.backgroundColor = '';
        }
      });
  
      // 5) Mise à jour de la mémoire
      previousMatchIDs2 = list.map(m => m.matchID);
  
    } catch (err) {
      console.error('fetchMatches failed:', err);
    }
  }

async function fetchProfiles(tbody, type) {
  tbody.innerHTML = '';
  try {
    // on passe le type en query-param
    const res  = await fetch(`/admin/getProfiles${type ? '?type='+type : ''}`);
    if (!res.ok) throw new Error(res.statusText);
    const list = await res.json();
    list.forEach(p => {
      const tr = document.createElement('tr');
      tr.dataset.name = p.name;
      tr.innerHTML = `
        <td>${p.name}</td>
        <td>${p.gamesPlayed}</td>
        <td>${p.wins}</td>
        <td>
          <button class="toggle-profile-btn">▶</button>
          <button class="delete-profile-btn">❌</button>
        </td>
      `;
      tbody.appendChild(tr);
  
        // 2) Toggle détails
        const toggleBtn = tr.querySelector('.toggle-profile-btn');
        toggleBtn.addEventListener('click', () => {
          let dr = tr.nextElementSibling;
          if (dr && dr.classList.contains('profile-details')) {
            dr.hidden = !dr.hidden;
            return;
          }
  
          // Crée la ligne de détails
          dr = document.createElement('tr');
          dr.classList.add('profile-details');
          dr.innerHTML = `
            <td colspan="4">
              <div style="display:grid;grid-template-columns:repeat(${Object.keys(p.byMode).length},1fr);gap:8px;">
                ${Object.entries(p.byMode).map(([mode, stats]) => `
                  <div style="background:var(--bg-dark);padding:8px;border-radius:4px;">
                    <strong style="text-transform:capitalize;">${mode}</strong><br>
                    Parties jouées : ${stats.played}<br>
                    Victoires : ${stats.wins}
                  </div>
                `).join('')}
              </div>
            </td>
          `;
          tr.parentNode.insertBefore(dr, tr.nextSibling);
        });
  
        // 3) Suppression de profil
        tr.querySelector('.delete-profile-btn').addEventListener('click', async () => {
          if (!confirm(`Supprimer le profil "${p.name}" ?`)) return;
          try {
            const del = await fetch(`/admin/deleteProfile/${encodeURIComponent(p.name)}`, {
              method: 'DELETE'
            });
            if (!del.ok) throw new Error(await del.text());
            // la mise à jour live par Socket.IO se chargera de rerendre la liste
          } catch (err) {
            alert('Erreur suppression : ' + err.message);
          }
        });
      });
  
  } catch (err) {
    console.error('fetchProfiles failed:', err);
    tbody.innerHTML = `<tr><td colspan="4">Impossible de charger les profils.</td></tr>`;
  }
}
/**
 * Récupère et affiche l’historique des parties.
 * @param {HTMLTableSectionElement} tbody - Le <tbody> à remplir.
 * @param {'table'|'match2'} type - 'table' pour 10 joueurs, 'match2' pour 2 joueurs.
 */
async function fetchGames(tbody, type) {
    tbody.innerHTML = ''; // on vide d'abord tout le <tbody>
    try {
      const res      = await fetch('/admin/getGames');
      const allGames = await res.json();
      // on ne garde que les parties du type demandé
      const filtered = allGames.filter(g => g.type === type);
  
      // mapping des clés de mode vers leur libellé complet
      const modeLabels = {
        beginner:   'Beginner',
        normal:     'Normal',
        turbo:      'Turbo',
        highroller: 'Highroller',
        hyper:      'Hyper-fast'
      };
  
      filtered.forEach(g => {
        const tr          = document.createElement('tr');
        const displayType = type === 'table' ? '10 joueurs' : '2 joueurs';
        const displayMode = modeLabels[g.mode] || g.mode;
  
        tr.innerHTML = `
          <td>${displayType}</td>
          <td>${g.tableID || g.matchID}</td>
          <td>${displayMode}</td>
          <td>${g.winner}</td>
          <td>${new Date(g.timestamp).toLocaleString()}</td>
        `;
  
        tbody.appendChild(tr);
      });
  
      // message si aucune game à afficher
      if (filtered.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td colspan="5" style="text-align:center; color:gray">
            Aucune partie à afficher.
          </td>
        `;
        tbody.appendChild(tr);
      }
  
    } catch (err) {
      console.error('fetchGames failed:', err);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="5" style="text-align:center; color:red">
          Échec du chargement des parties.
        </td>
      `;
      tbody.appendChild(tr);
    }
  }

  // ——————————————————————————————————————————
  // Finally, initialize on Partie 10
  // ——————————————————————————————————————————
  main10.click();
});

