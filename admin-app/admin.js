// admin-app/admin.js
console.log('>> admin.js chargÃ©');

document.addEventListener('DOMContentLoaded', () => {
  const ADMIN_SCOPE_UI = {
    main: { key: 'main', label: 'Admin principal', levels: ['Q0','Q1','Q2','T1','T2','T3','T4'], modes: ['beginner','normal','turbo','highroller','hyper'], canProfiles: true, canLevels: true, canGames: true, canSpectate: true, canDetails: true, canDelete: true, canSos: true },
    q0:   { key: 'q0', label: 'Admin Q0',        levels: ['Q0'], modes: ['beginner','normal','turbo','highroller','hyper'], canProfiles: false, canLevels: false, canGames: false, canSpectate: false, canDetails: false, canDelete: true, canSos: false },
    q1:   { key: 'q1', label: 'Admin Q1',        levels: ['Q1'], modes: ['turbo','highroller','hyper'], canProfiles: false, canLevels: false, canGames: false, canSpectate: false, canDetails: false, canDelete: true, canSos: false },
    q2:   { key: 'q2', label: 'Admin Q2',        levels: ['Q2'], modes: ['turbo','highroller','hyper'], canProfiles: false, canLevels: false, canGames: false, canSpectate: false, canDetails: false, canDelete: true, canSos: false },
    t1:   { key: 't1', label: 'Admin T1',        levels: ['T1'], modes: ['turbo'], canProfiles: false, canLevels: false, canGames: false, canSpectate: false, canDetails: false, canDelete: true, canSos: false },
    t2:   { key: 't2', label: 'Admin T2',        levels: ['T2'], modes: ['turbo'], canProfiles: false, canLevels: false, canGames: false, canSpectate: false, canDetails: false, canDelete: true, canSos: false },
    t3:   { key: 't3', label: 'Admin T3',        levels: ['T3'], modes: ['turbo'], canProfiles: false, canLevels: false, canGames: false, canSpectate: false, canDetails: false, canDelete: true, canSos: false },
    t4:   { key: 't4', label: 'Admin T4',        levels: ['T4'], modes: ['turbo'], canProfiles: false, canLevels: false, canGames: false, canSpectate: false, canDetails: false, canDelete: true, canSos: false }
  };

  function detectAdminScopeKey() {
    const host = String(location.hostname || '').toLowerCase();
    const firstLabel = (host.split('.')[0] || '').toLowerCase();
    const hostCandidates = [
      firstLabel,
      firstLabel.replace(/-admin$/, ''),
      firstLabel.replace(/^admin-/, '')
    ];
    for (const candidate of hostCandidates) {
      if (ADMIN_SCOPE_UI[candidate]) return candidate;
    }
    const parts = String(location.pathname || '').toLowerCase().split('/').filter(Boolean);
    const candidate = (parts[0] === 'admin' && parts[1]) ? parts[1] : 'main';
    return ADMIN_SCOPE_UI[candidate] ? candidate : 'main';
  }

  const adminScopeKey = detectAdminScopeKey();
  const adminScope = ADMIN_SCOPE_UI[adminScopeKey] || ADMIN_SCOPE_UI.main;

  function adminUrl(path, extraQuery = null) {
    const u = new URL(path, location.origin);
    if (adminScopeKey !== 'main') u.searchParams.set('scope', adminScopeKey);
    if (extraQuery && typeof extraQuery === 'object') {
      Object.entries(extraQuery).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
      });
    }
    return `${u.pathname}${u.search}${u.hash}`;
  }

  // SÃ©curisation du socket : si la librairie client socket.io n'est pas chargÃ©e,
  // on ne plante pas tout l'admin.
  let socket;

  if (typeof io === 'function') {
    socket = io();                  // connexion rÃ©elle
    window.socket = socket;
    socket.emit('joinAdmin', { scope: adminScopeKey });
  } else {
    console.error('[ADMIN] Socket.IO client introuvable, mode dÃ©gradÃ©.');
    // stub trÃ¨s simple pour Ã©viter les erreurs si le reste du code appelle socket.on / emit
    socket = {
      on()  { /* no-op */ },
      emit(){ /* no-op */ }
    };
    window.socket = socket;
  }
  // â€”
  // Live cache des Ã©tats
  // â€”
  const tablesData   = {};
  const matches2Data = {};
  const sosEvents    = [];
  const sosChats     = {};

  const LEVEL_OPTIONS = [
    { value: 'Q1', label: 'Q1' },
    { value: 'Q2', label: 'Q2' },
    { value: 'T1', label: 'T1' },
    { value: 'T2', label: 'T2' },
    { value: 'T3', label: 'T3' },
    { value: 'T4', label: 'T4' },
    { value: 'PASS_T5', label: 'Passage en T5' }
  ];

  if (adminScopeKey !== 'main') {
    document.title = `${adminScope.label} - Admin Poker`;
    const h1 = document.querySelector('header h1');
    if (h1) h1.textContent = adminScope.label;
  }

  function formatLevelLabel(level) {
    const key = String(level || '').trim().toUpperCase();
    if (key === 'PASS_T5' || key === 'T5' || key === 'PASSAGE EN T5') return 'Passage en T5';
    return key || 'Q1';
  }

  function normalizeLevelValue(level) {
    const key = String(level || '').trim().toUpperCase();
    if (key === 'PASS_T5' || key === 'T5' || key === 'PASSAGE EN T5') return 'PASS_T5';
    return LEVEL_OPTIONS.some(o => o.value === key) ? key : 'Q1';
  }

  const sosListEl = document.getElementById('sos-list');
  const sosEmptyEl = document.getElementById('sos-empty');
  const sosClearBtn = document.getElementById('sos-clear-btn');

  function renderSosList() {
    if (!sosListEl || !sosEmptyEl) return;
    sosListEl.innerHTML = '';
    if (!sosEvents.length) {
      sosEmptyEl.style.display = 'block';
      return;
    }
    sosEmptyEl.style.display = 'none';
    sosEvents.forEach((evt) => {
      const when = evt.ts ? new Date(evt.ts).toLocaleString('fr-FR') : 'Date inconnue';
      const location = evt.matchID ? `Match ${evt.matchID}` : `Table ${evt.tableID || '?'}`;
      const seatInfo = Number.isInteger(evt.seatIndex) ? `Seat ${evt.seatIndex + 1}` : 'Seat ?';
      const label = evt.playerLabel || 'Joueur';
      const clientId = evt.clientId || '';
      const div = document.createElement('div');
      div.className = 'sos-item';
      div.innerHTML = `
        <h3>${location}</h3>
        <p><strong>Joueur:</strong> ${label} (${seatInfo})</p>
        <p><strong>Moment:</strong> ${when}</p>
        <p><strong>Message:</strong> Alerte SOS declenchee.</p>
        <div class="sos-controls">
          <button class="sos-clear-btn sos-toggle-chat" type="button" data-client="${clientId}">
            Afficher le chat
          </button>
        </div>
        <div class="sos-chat-panel" data-client="${clientId}">
          <div class="sos-chat-messages-admin"></div>
          <div class="sos-chat-input">
            <input type="text" placeholder="Ecrire a ce joueur..." />
            <button type="button" class="sos-send-chat-btn">Envoyer</button>
          </div>
        </div>
      `;
      sosListEl.appendChild(div);
      renderSosChat(clientId, div);
    });
  }

  function renderSosChat(clientId, container) {
    if (!container) return;
    const messagesEl = container.querySelector('.sos-chat-messages-admin');
    if (!messagesEl) return;
    messagesEl.innerHTML = '';
    const msgs = sosChats[clientId] || [];
    msgs.forEach((msg) => {
      const div = document.createElement('div');
      div.className = `sos-chat-msg-admin ${msg.from === 'admin' ? 'me' : 'player'}`;
      div.textContent = msg.text;
      messagesEl.appendChild(div);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  if (sosClearBtn) {
    sosClearBtn.addEventListener('click', () => {
      sosEvents.length = 0;
      Object.keys(sosChats).forEach(k => delete sosChats[k]);
      renderSosList();
    });
  }

  if (sosListEl) {
    sosListEl.addEventListener('click', (e) => {
      const target = e.target;
      if (!target) return;
      if (target.classList.contains('sos-toggle-chat')) {
        const clientId = target.getAttribute('data-client');
        if (!clientId) return;
        const item = target.closest('.sos-item');
        const panel = item?.querySelector('.sos-chat-panel');
        if (!panel) return;
        const open = panel.classList.toggle('open');
        target.textContent = open ? 'Cacher le chat' : 'Afficher le chat';
        if (open) {
          renderSosChat(clientId, item);
          const input = panel.querySelector('input');
          input?.focus();
        }
        return;
      }
      if (target.classList.contains('sos-send-chat-btn')) {
        const item = target.closest('.sos-item');
        const panel = item?.querySelector('.sos-chat-panel');
        const input = panel?.querySelector('input');
        const clientId = panel?.getAttribute('data-client');
        if (!socket || !clientId || !input) return;
        const text = String(input.value || '').trim();
        if (!text) return;
        input.value = '';
        socket.emit('sosChatAdminMessage', { clientId, message: text });
        if (!sosChats[clientId]) sosChats[clientId] = [];
        sosChats[clientId].push({ from: 'admin', text, ts: Date.now() });
        renderSosChat(clientId, item);
      }
    });
    sosListEl.addEventListener('keydown', (e) => {
      const target = e.target;
      if (!target || target.tagName !== 'INPUT') return;
      if (e.key !== 'Enter') return;
      const item = target.closest('.sos-item');
      const panel = item?.querySelector('.sos-chat-panel');
      const clientId = panel?.getAttribute('data-client');
      if (!socket || !clientId) return;
      const text = String(target.value || '').trim();
      if (!text) return;
      target.value = '';
      socket.emit('sosChatAdminMessage', { clientId, message: text });
      if (!sosChats[clientId]) sosChats[clientId] = [];
      sosChats[clientId].push({ from: 'admin', text, ts: Date.now() });
      renderSosChat(clientId, item);
    });
  }

    // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Helper : copie avec fallback (clipboard ou prompt)
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Helper : copie avec fallback (clipboard ou textarea cachÃ©)
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  function copyToClipboardOrPrompt(text, feedbackSpan) {
    // 1) Contexte sÃ©curisÃ© â†’ API moderne
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      return navigator.clipboard.writeText(text)
        .then(() => {
          if (feedbackSpan) {
            feedbackSpan.textContent = 'Lien copiÃ© !';
            setTimeout(() => { feedbackSpan.textContent = ''; }, 2000);
          }
        })
        .catch(err => {
          console.warn('[ADMIN] Clipboard API a Ã©chouÃ©, fallback textarea :', err);
          return fallbackTextareaCopy(text, feedbackSpan);
        });
    }

    // 2) Fallback : textarea invisible + execCommand('copy')
    return fallbackTextareaCopy(text, feedbackSpan);
  }

  function fallbackTextareaCopy(text, feedbackSpan) {
    return new Promise((resolve, reject) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      ta.style.left = '-1000px';

      document.body.appendChild(ta);
      ta.select();

      try {
        const ok = document.execCommand('copy');
        document.body.removeChild(ta);

        if (ok) {
          if (feedbackSpan) {
            feedbackSpan.textContent = 'Lien copiÃ© !';
            setTimeout(() => { feedbackSpan.textContent = ''; }, 2000);
          }
          resolve();
        } else {
          if (feedbackSpan) {
            feedbackSpan.textContent = 'Impossible de copier.';
            setTimeout(() => { feedbackSpan.textContent = ''; }, 2000);
          }
          reject(new Error('execCommand copy failed'));
        }
      } catch (err) {
        document.body.removeChild(ta);
        console.error('[ADMIN] Fallback copy error :', err);
        if (feedbackSpan) {
          feedbackSpan.textContent = 'Copie non supportÃ©e.';
          setTimeout(() => { feedbackSpan.textContent = ''; }, 2000);
        }
        reject(err);
      }
    });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Tables 10 joueurs
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('updateTable', ({ tableID, gameState }) => {
    tablesData[tableID] = gameState;
    const dr = document.querySelector(`tr[data-table="${tableID}"] + .details-row`);
    if (dr && !dr.hidden) renderDetails(tableID, dr);
    const row = document.querySelector(`tr[data-table="${tableID}"]`);
    if (row) {
      const dot = row.querySelector('.status-dot');
      dot.classList.add('status-active');
      dot.classList.remove('status-inactive');
      const startBtn = row.querySelector('.start-btn');
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = 'Started';
      }
      const pauseBtn = row.querySelector('.pause-btn');
      if (pauseBtn) {
        pauseBtn.disabled = false;
        pauseBtn.textContent = gameState?.adminPaused ? 'Resume' : 'Pause';
      }
      const restartBtn = row.querySelector('.restart-btn');
      if (restartBtn) restartBtn.disabled = false;
    }
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Matchs 2 joueurs (face-Ã -face)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('updateMatch2', ({ matchID, gameState }) => {
    matches2Data[matchID] = gameState;
    const row = document.querySelector(`tr[data-match="${matchID}"]`);
    if (row) {
      const dot = row.querySelector('.status-dot');
      dot.classList.add('status-active');
      dot.classList.remove('status-inactive');
      const startBtn = row.querySelector('.start-btn');
      if (startBtn) {
        startBtn.disabled = true;
        startBtn.textContent = 'Started';
      }
      const pauseBtn = row.querySelector('.pause-btn');
      if (pauseBtn) {
        pauseBtn.disabled = false;
        pauseBtn.textContent = gameState?.adminPaused ? 'Resume' : 'Pause';
      }
      const restartBtn = row.querySelector('.restart-btn');
      if (restartBtn) restartBtn.disabled = false;
    }
    const dr = document.querySelector(`tr[data-match="${matchID}"] + .details-row`);
    if (dr && !dr.hidden) {
      renderMatch2Details(matchID, dr);
    }  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Waiting room (une seule fois pour les deux cas)
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('updateWaitingRoom', payload => {
    // payload contient soit tableID soit matchID
    if ('tableID' in payload) {
      const { tableID, waitingCount, activeSeats, totalSeats } = payload;
      tablesData[tableID] = tablesData[tableID] || {};
      tablesData[tableID].waitingCount = waitingCount;
      tablesData[tableID].waitingTotal = activeSeats || totalSeats;
      const dr = document.querySelector(`tr[data-table="${tableID}"] + .details-row`);
      if (dr && !dr.hidden) renderDetails(tableID, dr);
    } else if ('matchID' in payload) {
      const { matchID, waitingCount, totalSeats } = payload;
      matches2Data[matchID] = matches2Data[matchID] || {};
      matches2Data[matchID].waitingCount = waitingCount;
      matches2Data[matchID].waitingTotal = totalSeats;
      const dr = document.querySelector(`tr[data-match="${matchID}"] + .details-row`);
      if (dr && !dr.hidden) renderMatch2Details(matchID, dr);
    }
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Fin de partie : on met Ã  jour la colonne â€œWinnerâ€
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  socket.on('sosAlert', (payload = {}) => {
    const evt = {
      ts: payload.ts || Date.now(),
      tableID: payload.tableID || null,
      matchID: payload.matchID || null,
      seatIndex: Number.isInteger(payload.seatIndex) ? payload.seatIndex : null,
      playerLabel: payload.playerLabel || '',
      clientId: payload.clientId || null
    };
    sosEvents.unshift(evt);
    if (sosEvents.length > 200) sosEvents.pop();
    renderSosList();
  });

  socket.on('sosChatMessage', (payload = {}) => {
    const clientId = payload.clientId;
    const message = String(payload.message || '').trim();
    if (!clientId || !message) return;
    if (!sosChats[clientId]) sosChats[clientId] = [];
    sosChats[clientId].push({
      from: payload.from === 'admin' ? 'admin' : 'player',
      text: message,
      ts: payload.ts || Date.now()
    });
    renderSosList();
  });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Refresh forces quand on supprime en admin
  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  socket.on('tablesUpdated', ()    => { if (tabTables.classList.contains('active'))    fetchTables(); });
  socket.on('matches2Updated', () => { if (tabMatches2.classList.contains('active')) fetchMatches(); });

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Quand un profil est supprimÃ©, on rafraÃ®chit la vue
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
socket.on('profilesUpdated', () => {
  // si on est sur lâ€™onglet Profils (10 joueurs)
  if (tabProfiles10.classList.contains('active')) {
    const tbody10 = profilesPanel.querySelector('tbody');
    fetchProfiles(tbody10, 'table');
  }
  // si on est sur lâ€™onglet Profils (2 joueurs)
  if (tabProfiles2.classList.contains('active')) {
    const tbody2 = profiles2Panel.querySelector('tbody');
    fetchProfiles(tbody2, 'match2');
  }
});

socket.on('levelsUpdated', () => {
  if (mainNiv.classList.contains('active')) {
    fetchLevels();
  }
});


// â€¦ Ã  placer Ã  lâ€™intÃ©rieur de document.addEventListener('DOMContentLoaded', () => { â€¦ })

// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// Recherche dans lâ€™onglet Profils (10 joueurs + 2 joueurs)
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// Recherche dans lâ€™onglet Profils (10 joueurs + 2 joueurs)
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
function setupProfileSearch(inputId, tableSelector) {
  const inp = document.getElementById(inputId);
  if (!inp) {
    console.warn('[ADMIN] Champ de recherche introuvable :', inputId);
    return; // on n'active rien, mais on ne casse pas tout le script
  }

  inp.addEventListener('input', () => {
    const term = inp.value.trim().toLowerCase();
    document.querySelectorAll(`${tableSelector} tbody tr`).forEach(tr => {
      // on ignore les lignes de dÃ©tails
      if (tr.classList.contains('profile-details')) return;
      const name = (tr.dataset.name || '').toLowerCase();
      const show = name.includes(term);
      tr.style.display = show ? '' : 'none';
      // on masque aussi la ligne de dÃ©tails associÃ©e
      const dr = tr.nextElementSibling;
      if (dr && dr.classList.contains('profile-details')) {
        dr.style.display = show ? '' : 'none';
      }
    });
  });
}

// Profils 10
setupProfileSearch('profile-search', '#profiles-table');

// Profils 2 â†’ on nâ€™essaie que si tu ajoutes un input plus tard
// (si lâ€™input nâ€™existe pas, la fonction ne cassera rien)
setupProfileSearch('profile2-search', '#profiles2-table');


// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// Recherche dans lâ€™onglet Niveaux
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
const levelInput = document.getElementById('level-search');
if (levelInput) {
  levelInput.addEventListener('input', () => {
    const term = levelInput.value.trim().toLowerCase();
    document.querySelectorAll('#levels-table tbody tr').forEach(tr => {
      // on ignore les lignes dâ€™historique
      if (tr.classList.contains('history-details')) return;
      const nameCell = tr.querySelector('td:first-child');
      const name = (nameCell?.textContent || '').trim().toLowerCase();
      const show = name.includes(term);
      tr.style.display = show ? '' : 'none';
      // masque aussi la ligne dâ€™historique si elle existe juste aprÃ¨s
      const dr = tr.nextElementSibling;
      if (dr && dr.classList.contains('history-details')) {
        dr.style.display = show ? '' : 'none';
      }
    });
  });
} else {
  console.warn('[ADMIN] Champ de recherche niveaux introuvable : level-search');
}


  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Affichage des dÃ©tails â€œVoir plusâ€ (10-j)
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  function renderDetails(tableID, detailsRow) {
    const g = tablesData[tableID];
    const cell = detailsRow.querySelector('td');
    if (!g || (g.waitingCount===undefined && !g.players)) {
      cell.innerHTML = `<em>En attente d'informationsâ€¦</em>`;
      return;
    }
    if (g.waitingCount!==undefined && !g.players) {
      const total = g.waitingTotal || 10;
      cell.innerHTML = `<div><strong>En attente :</strong> ${g.waitingCount}/${total} joueurs</div>`;
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
                SiÃ¨ge ${p.seat+1} â€“ ${p.label}
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

  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Affichage des dÃ©tails â€œVoir plusâ€ (2-j)
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
/**
 * Affiche les dÃ©tails (pot, board, joueurs) dâ€™un match 2-joueurs
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
    cell.innerHTML = `<em>En attente d'informationsâ€¦</em>`;
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
              SiÃ¨ge ${p.seat+1} â€“ ${p.label}
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

  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Main tabs
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  const main10   = document.getElementById('main-10'),
        main2    = document.getElementById('main-2'),
        mainNiv  = document.getElementById('main-niveaux'),
        mainSos  = document.getElementById('main-sos');
  const create10 = document.getElementById('panel-10-create'),
        create2  = document.getElementById('panel-2-create');
  const content10= document.getElementById('panel-10-content'),
        content2 = document.getElementById('panel-2-content'),
        contentN = document.getElementById('panel-niveaux'),
        contentS = document.getElementById('panel-sos');
  function hideAll() {
    [create10, create2, content10, content2, contentN, contentS].forEach(e => e.hidden = true);
    [main10, main2, mainNiv, mainSos].forEach(e => e.classList.remove('active'));
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
  mainSos.addEventListener('click', () => {
    hideAll();
    mainSos.classList.add('active');
    contentS.hidden = false;
    renderSosList();
  });

  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Partie 10 sub-tabs
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
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

  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Partie 2 sub-tabs
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// Partie 2 sub-tabs (Ã  placer AVANT tout listener qui les utilise)
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
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

  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Create 10-player table form
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// RÃ©cupÃ©ration des Ã©lÃ©ments clÃ©s
const tableForm   = document.getElementById('table-form'),
      createBtn   = document.getElementById('create-btn'),
      result10    = document.getElementById('result');
const activeSeatsInput = document.getElementById('active-seats');

// Gestion du sÃ©lecteur de mode
const modeOpts10      = Array.from(document.querySelectorAll('#panel-10-create .mode-option'));
let selectedMode10    = modeOpts10[0].dataset.mode;
modeOpts10.forEach(o => o.addEventListener('click', () => {
  selectedMode10 = o.dataset.mode;
  modeOpts10.forEach(x => x.classList.toggle('active', x === o));
}));
modeOpts10[0].classList.add('active');

// SÃ©lecteur de niveau
const levelOpts10   = Array.from(document.querySelectorAll('#panel-10-create .level-option'));
let selectedLevel10 = 'Q1';
levelOpts10.forEach(o => o.addEventListener('click', () => {
  selectedLevel10 = o.dataset.level;
  levelOpts10.forEach(x => x.classList.toggle('active', x === o));
}));
const defaultQ1_10 = levelOpts10.find(o => o.dataset.level === 'Q1');
if (defaultQ1_10) defaultQ1_10.classList.add('active');
else if (levelOpts10[0]) levelOpts10[0].classList.add('active');

function normalizeActiveSeats(value) {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n)) return 10;
  return Math.min(10, Math.max(2, n));
}

function updateSeatInputs() {
  const activeSeats = normalizeActiveSeats(activeSeatsInput?.value);
  if (activeSeatsInput) activeSeatsInput.value = String(activeSeats);

  const inputs = Array.from(tableForm.elements['player']);
  inputs.forEach((input, idx) => {
    const row = input.closest('tr');
    const isActive = idx < activeSeats;
    input.disabled = !isActive;
    if (!isActive) input.value = '';
    if (row) row.classList.toggle('seat-disabled', !isActive);
  });
}

// Validation des noms avant activation du bouton
function checkTableInputs() {
  const activeSeats = normalizeActiveSeats(activeSeatsInput?.value);
  const inputs = Array.from(tableForm.elements['player']).slice(0, activeSeats);
  const filled = inputs.filter(i => i.value.trim() !== '').length;
  createBtn.disabled = filled < 2;
}
tableForm.querySelectorAll('input[name="player"]')
         .forEach(i => i.addEventListener('input', checkTableInputs));
if (activeSeatsInput) {
  activeSeatsInput.addEventListener('input', () => {
    updateSeatInputs();
    checkTableInputs();
  });
}
updateSeatInputs();
checkTableInputs();

// 1) Eventâ€delegation sur #result pour gÃ©rer tous les COPY
result10.addEventListener('click', e => {
  if (!e.target.classList.contains('copy-link-btn')) return;
  const btn  = e.target;
  const link = btn.dataset.link;
  if (!link) return alert("Erreur interne : lien introuvable.");

  const fb = btn.nextElementSibling;
  copyToClipboardOrPrompt(link, fb).catch(() => {
    alert('Impossible de copier le lien.');
  });
});

// 2) Submission du formulaire â†’ crÃ©ation de la table + gÃ©nÃ©ration des boutons COPY
// 2) Submission du formulaire â†’ crÃ©ation de la table + gÃ©nÃ©ration des boutons COPY
tableForm.addEventListener('submit', async e => {
  e.preventDefault();

  const players = Array.from(tableForm.elements['player'])
                       .map(i => i.value.trim());
  const activeSeats = normalizeActiveSeats(activeSeatsInput?.value);

  try {
    const res  = await fetch(adminUrl('/admin/createTable'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        players,
        mode: selectedMode10,
        level: selectedLevel10,
        activeSeats
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || res.statusText);

    // ðŸ” Normalisation de l'ID de table selon ce que renvoie le serveur
    const tableID =
      data.tableID   ||
      data.tableId   ||
      data.id        ||
      data.table;

    if (!tableID) {
      console.error('[ADMIN] createTable: tableID manquant dans la rÃ©ponse :', data);
      throw new Error('tableID manquant dans la rÃ©ponse serveur');
    }

    // On rÃ©cupÃ¨re les seatLinks renvoyÃ©s par le serveur si prÃ©sents
    const seatLinksFromServer = Array.isArray(data.seatLinks) ? data.seatLinks : [];

    const seatLinks = seatLinksFromServer.length
      ? seatLinksFromServer.map((sl, idx) => {
          const seatIndex = (sl.seat ?? idx);
          return {
            seat: seatIndex,
            name: sl.name || players[seatIndex] || `Joueur ${seatIndex + 1}`,
            url: sl.url || `${location.origin}/?table=${tableID}&seat=${seatIndex}`
          };
        })
      : players.slice(0, activeSeats).map((name, seat) => ({
          seat,
          name,
          url: `${location.origin}/?table=${tableID}&seat=${seat}`
        }));

    let html = `<p>Liens pour chaque siÃ¨ge (table ${tableID}) :</p>
                <ul style="list-style:none;padding:0;">`;

    seatLinks.forEach(sl => {
      html += `
        <li style="margin-bottom:6px;">
          SiÃ¨ge ${sl.seat + 1} (${sl.name || 'Joueur'}) :
          <button type="button"
                  class="copy-link-btn"
                  data-link="${sl.url}">
            COPY
          </button>
          <span class="copy-feedback"></span>
        </li>
      `;
    });
    html += '</ul>';

    result10.innerHTML = html;

    // RafraÃ®chissement de la liste des tables admin
    await fetchTables();

  } catch (err) {
    alert('Erreur crÃ©ation table : ' + err.message);
  }
});

  
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Create 2-player match form
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// Create 2-player match form
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
const matchForm  = document.getElementById('match2-form');
const create2Btn  = document.getElementById('create2-btn');
const result2     = document.getElementById('result2');

// Delegation pour tous les COPY buttons dans result2
result2.addEventListener('click', e => {
  if (!e.target.classList.contains('copy-link-btn')) return;
  const btn  = e.target;
  const link = btn.dataset.link;
  if (!link) return alert("Erreur interne : lien introuvable.");

  const fb = btn.nextElementSibling;
  copyToClipboardOrPrompt(link, fb).catch(() => {
    alert('Impossible de copier le lien.');
  });
});

// Mode selector (inchangÃ©)
const modeOpts2  = Array.from(document.querySelectorAll('#panel-2-create .mode-option'));
let selectedMode2 = modeOpts2[0].dataset.mode;
modeOpts2.forEach(o => o.addEventListener('click', () => {
  selectedMode2 = o.dataset.mode;
  modeOpts2.forEach(x => x.classList.toggle('active', x === o));
}));
modeOpts2[0].classList.add('active');

// SÃ©lecteur de niveau (match 2)
const levelOpts2   = Array.from(document.querySelectorAll('#panel-2-create .level-option'));
let selectedLevel2 = 'Q1';
levelOpts2.forEach(o => o.addEventListener('click', () => {
  selectedLevel2 = o.dataset.level;
  levelOpts2.forEach(x => x.classList.toggle('active', x === o));
}));
const defaultQ1_2 = levelOpts2.find(o => o.dataset.level === 'Q1');
if (defaultQ1_2) defaultQ1_2.classList.add('active');
else if (levelOpts2[0]) levelOpts2[0].classList.add('active');

function applyScopedOptionSet(options, allowedValues, onSelect) {
  const allowed = new Set((allowedValues || []).map(v => String(v).toLowerCase()));
  let firstVisible = null;
  options.forEach(opt => {
    const raw = String(opt.dataset.mode || opt.dataset.level || '').trim();
    const key = raw.toLowerCase();
    const visible = allowed.size === 0 || allowed.has(key);
    opt.hidden = !visible;
    if (visible && !firstVisible) firstVisible = opt;
    if (!visible) opt.classList.remove('active');
  });
  if (firstVisible) {
    options.forEach(o => o.classList.toggle('active', o === firstVisible));
    onSelect(firstVisible);
  }
}

function applyAdminScopeUiRestrictions() {
  if (adminScopeKey === 'main') return;

  // Onglets principaux: on garde seulement les parties (10j / 2j)
  if (mainNiv) mainNiv.hidden = true;
  if (mainSos) mainSos.hidden = true;
  if (contentN) contentN.hidden = true;
  if (contentS) contentS.hidden = true;

  // Sous-onglets: on garde seulement les listes de tables/matchs
  [tabProfiles10, tabGames10, tabProfiles2, tabGames2].forEach(el => {
    if (el) el.hidden = true;
  });

  // Panneaux interdits
  [profilesPanel, gamesPanel, profiles2Panel, games2Panel].forEach(el => {
    if (el) el.hidden = true;
  });

  // Restreint les modes et le niveau de creation
  applyScopedOptionSet(modeOpts10, adminScope.modes, (opt) => { selectedMode10 = opt.dataset.mode; });
  applyScopedOptionSet(modeOpts2,  adminScope.modes, (opt) => { selectedMode2 = opt.dataset.mode; });
  applyScopedOptionSet(levelOpts10, adminScope.levels, (opt) => { selectedLevel10 = opt.dataset.level; });
  applyScopedOptionSet(levelOpts2,  adminScope.levels, (opt) => { selectedLevel2 = opt.dataset.level; });
}

applyAdminScopeUiRestrictions();

// Validation des 2 noms
function checkMatchInputs(){
  const filled = Array.from(matchForm.elements['player2'])
                      .filter(i=>i.value.trim()!=='').length;
  create2Btn.disabled = filled !== 2;
}
matchForm.querySelectorAll('input[name="player2"]')
         .forEach(i=>i.addEventListener('input', checkMatchInputs));
checkMatchInputs();

// Submit â†’ crÃ©ation du match + gÃ©nÃ©ration des 2 liens COPY
matchForm.addEventListener('submit', async e => {
  e.preventDefault();
  const players = Array.from(matchForm.elements['player2'])
                       .map(i => i.value.trim());
  try {
    const res  = await fetch(adminUrl('/admin/createMatch2'),{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ players, mode:selectedMode2, level: selectedLevel2 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error||res.statusText);

    // GÃ©nÃ©ration des 2 boutons COPY
    // data.link = ex: https://â€¦/?match2=XYZ
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
    alert('Erreur crÃ©ation match : ' + err.message);
  }
});
  async function fetchLevels() {
    const tbody = document.querySelector('#levels-table tbody');
    tbody.innerHTML = '';
  
    try {
      const res  = await fetch(adminUrl('/admin/getLevels'));
      if (!res.ok) throw new Error(res.statusText);
      const list = await res.json();
  
      if (list.length === 0) {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td colspan="13" style="text-align:center;color:gray">
            Aucun joueur enregistré.
          </td>`;
        tbody.appendChild(tr);
        return;
      }
  
      list.forEach(p => {
        const lastChange = p.history.length
          ? p.history[p.history.length - 1].action
          : '';
        const by = p.creditsByLevel || {};

        const tr = document.createElement('tr');
        const sub = (p.subscription || 'standard').toLowerCase();
        tr.innerHTML = `
                    <td>${p.name}</td>
          <td>${by.Q1 ?? 0}</td>
          <td>${by.Q2 ?? 0}</td>
          <td>${by.T1 ?? 0}</td>
          <td>${by.T2 ?? 0}</td>
          <td>${by.T3 ?? 0}</td>
          <td>${by.T4 ?? 0}</td>
          <td>${Number.isFinite(p.timeCredits) ? p.timeCredits : 0}</td>
          <td>${p.gamesPlayed}</td>
          <td>${p.wins}</td>
          <td>
            <select class="sub-select">
              <option value="standard"${sub === 'standard' ? ' selected' : ''}>Standard</option>
              <option value="pro"${sub === 'pro' ? ' selected' : ''}>Pro</option>
            </select>
          </td>
          <td>${lastChange}</td>
          <td>
            <button class="history-btn">Historique</button>
            <button class="edit-credits-btn">Modifier</button>
          </td>
        `;
  
        tr.querySelector('.history-btn').addEventListener('click', () => {
          let dr = tr.nextElementSibling;
          if (dr && dr.classList.contains('history-details')) {
            dr.hidden = !dr.hidden;
            return;
          }
  
          const recent = p.history.slice(-10).reverse();
          dr = document.createElement('tr');
          dr.classList.add('history-details');
          dr.innerHTML = `
            <td colspan="13">
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

        tr.querySelector('.edit-credits-btn').addEventListener('click', () => {
          let next = tr.nextElementSibling;
          if (next && next.classList.contains('credits-editor')) {
            next.remove();
            return;
          }

          const levelOptions = ['Q1','Q2','T1','T2','T3','T4','TIME'];
          const editor = document.createElement('tr');
          editor.classList.add('credits-editor');
          editor.innerHTML = `
            <td colspan="13">
              <div class="history-container" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                <strong>Modifier crÃ©dits</strong>
                <label>CatÃ©gorie
                  <select class="credit-level">
                    ${levelOptions.map(l => `<option value="${l}">${l}</option>`).join('')}
                  </select>
                </label>
                <label>Valeur
                  <input class="credit-value" type="number" min="0" step="1" value="0" style="width:90px;">
                </label>
                <button class="credit-save">Enregistrer</button>
                <button class="credit-cancel" type="button">Annuler</button>
              </div>
            </td>
          `;

          const select = editor.querySelector('.credit-level');
          const input = editor.querySelector('.credit-value');
          const saveBtn = editor.querySelector('.credit-save');
          const cancelBtn = editor.querySelector('.credit-cancel');

          const setFromLevel = () => {
            const lvl = select.value;
            if (lvl === 'TIME') {
              input.value = Number.isFinite(p.timeCredits) ? p.timeCredits : 0;
            } else {
              input.value = Number(by[lvl] ?? 0);
            }
          };
          setFromLevel();
          select.addEventListener('change', setFromLevel);

          cancelBtn.addEventListener('click', () => editor.remove());
          saveBtn.addEventListener('click', async () => {
            const level = select.value;
            const value = Number(input.value);
            if (!Number.isFinite(value) || value < 0) {
              alert('Valeur invalide.');
              return;
            }
            saveBtn.disabled = true;
            try {
              const res = await fetch(adminUrl('/admin/setCreditsByLevel'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: p.name, level, value })
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || res.statusText);
              fetchLevels();
            } catch (err) {
              alert('Erreur: ' + err.message);
              saveBtn.disabled = false;
            }
          });

          let insertAfter = tr;
          if (insertAfter.nextElementSibling && insertAfter.nextElementSibling.classList.contains('history-details')) {
            insertAfter = insertAfter.nextElementSibling;
          }
          tr.parentNode.insertBefore(editor, insertAfter.nextSibling);
        });

        const subSelect = tr.querySelector('.sub-select');
        if (subSelect) {
          subSelect.addEventListener('change', async () => {
            const nextSub = subSelect.value;
            subSelect.disabled = true;
            try {
              const res = await fetch(adminUrl('/admin/setSubscription'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: p.name, subscription: nextSub })
              });
              const data = await res.json();
              if (!res.ok) throw new Error(data.error || res.statusText);
              subSelect.disabled = false;
            } catch (err) {
              alert('Erreur: ' + err.message);
              subSelect.value = sub;
              subSelect.disabled = false;
            }
          });
        }

        tbody.appendChild(tr);
      });
  
    } catch (err) {
      console.error('fetchLevels failed:', err);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="13" style="text-align:center;color:red">
          Échec du chargement des niveaux.
        </td>`;
      tbody.appendChild(tr);
    }
  }  
  
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Data fetchers
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
let previousTableIDs = [];  // MÃ©moire de lâ€™ordre des tables

async function fetchTables() {
  const tbody = document.querySelector('#tables-list tbody');
  tbody.innerHTML = '';

  try {
    const res  = await fetch(adminUrl('/admin/getTables'));
    const list = await res.json();

    // 1) Aucune table
    if (!list.length) {
      previousTableIDs = [];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="8" style="text-align:center;color:gray">
          Aucune table.
        </td>`;
      tbody.appendChild(tr);
      return;
    }

    // 2) IDs normalisÃ©s pour dÃ©tecter les nouvelles tables
    const currentIDs = list
      .map(t => t.tableID || t.tableId || t.id)
      .filter(Boolean);

    const oldIDs = previousTableIDs;
    const newIDs = currentIDs.filter(id => !oldIDs.includes(id));

    // 3) CrÃ©ation des lignes
    list.forEach(t => {
      const tableID = t.tableID || t.tableId || t.id;
      const dotClass = t.winner ? 'status-inactive' : 'status-active';

      // ðŸ”¢ NumÃ©ro de game en DÃ‰CROISSANT dans lâ€™affichage :
      // on compte combien de lignes existent dÃ©jÃ  dans le tbody,
      // puis on ajoute 1. Comme on insÃ¨re toujours en haut, la
      // derniÃ¨re crÃ©Ã©e aura le plus grand numÃ©ro (#X en haut).
      const gameNumber = tbody.children.length + 1;

  const tr = document.createElement('tr');
  tr.dataset.table = tableID;
  tr.innerHTML = `
  <td class="game-number-cell">#${gameNumber}</td>
  <td class="status-cell">
    <span class="status-dot ${dotClass}"></span>
  </td>
  <td>${tableID}</td>
  <td>${t.mode}</td>
  <td>${t.level || 'Q1'}</td>
  <td class="winner-cell">${t.winner || '-'}</td>
  <td>
    <button type="button" class="copy-links-btn">
      Liens
    </button>
  </td>
  <td>
    <button class="watch-btn">ðŸ‘ Watch</button>
    <button class="start-btn">Start</button>
    <button class="pause-btn">${t.paused ? 'Resume' : 'Pause'}</button>
    <button class="restart-btn">Restart hand</button>
    <button class="toggle-details-btn">Voir plus</button>
    <button class="delete-btn">Delete</button>
  </td>
`;
      if (!adminScope.canSpectate) tr.querySelector('.watch-btn')?.remove();
      if (!adminScope.canDetails) tr.querySelector('.toggle-details-btn')?.remove();
      if (!adminScope.canDelete) tr.querySelector('.delete-btn')?.remove();
      const startBtn = tr.querySelector('.start-btn');
      if (startBtn && tablesData[tableID]?.players) {
        startBtn.disabled = true;
        startBtn.textContent = 'Started';
      }
      const pauseBtn = tr.querySelector('.pause-btn');
      if (pauseBtn && !tablesData[tableID]?.players) {
        pauseBtn.disabled = true;
      }
      const restartBtn = tr.querySelector('.restart-btn');
      if (restartBtn && !tablesData[tableID]?.players) {
        restartBtn.disabled = true;
      }

      // â€”â€”â€” Bouton â€œLiensâ€ â€”â€”â€”
      tr.querySelector('.copy-links-btn').addEventListener('click', () => {
        let dr = tr.nextElementSibling;
        if (dr && dr.classList.contains('seat-links-row')) {
          dr.remove();
          return;
        }

      const base = `${location.origin}?table=${tableID}`;
      const seatsCount = Number.isInteger(t.activeSeats) ? t.activeSeats : 10;
      dr = document.createElement('tr');
      dr.classList.add('seat-links-row');
      dr.innerHTML = `
          <td colspan="8">
            <ul style="list-style:none;padding:8px;margin:0;">
              ${[...Array(seatsCount)].map((_, i) => `
                <li style="display:flex;align-items:center;gap:8px;padding:4px 0;">
                  SiÃ¨ge ${i+1} :
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

        dr.querySelectorAll('.copy-link-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const link = btn.dataset.link;
            const fb   = btn.nextElementSibling;
            if (!link) return alert("Erreur interne : lien introuvable.");
            copyToClipboardOrPrompt(link, fb).catch(() => {
              alert('Impossible de copier le lien.');
            });
          });
        });
      });

      // â€”â€”â€” Bouton â€œVoir plusâ€ â€”â€”â€”
      tr.querySelector('.toggle-details-btn')?.addEventListener('click', () => {
        let dr = tr.nextElementSibling;
        if (dr?.classList.contains('details-row')) {
          dr.hidden = !dr.hidden;
        } else {
          dr = document.createElement('tr');
          dr.classList.add('details-row');
          dr.innerHTML = `<td colspan="8"></td>`;
          tr.parentNode.insertBefore(dr, tr.nextSibling);
          renderDetails(tableID, dr);
        }
      });

      // â€”â€”â€” Bouton â€œDeleteâ€ â€”â€”â€”
      tr.querySelector('.delete-btn')?.addEventListener('click', async () => {
        if (!confirm(`Supprimer la table ${tableID} ?`)) return;
        try {
          const del = await fetch(adminUrl(`/admin/deleteTable/${tableID}`), {
            method: 'DELETE'
          });
          if (!del.ok) throw new Error(await del.text());
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

            // Bouton Start
      tr.querySelector('.start-btn').addEventListener('click', () => {
        if (!confirm(`Start table ${tableID} ?`)) return;
        socket.emit('adminStartTable', { tableID }, (resp) => {
          if (!resp || !resp.ok) {
            alert(resp?.error || 'Start failed.');
            return;
          }
          const btn = tr.querySelector('.start-btn');
          if (btn) {
            btn.disabled = true;
            btn.textContent = 'Started';
          }
          const pb = tr.querySelector('.pause-btn');
          if (pb) pb.disabled = false;
          const rb = tr.querySelector('.restart-btn');
          if (rb) rb.disabled = false;
        });
      });

      tr.querySelector('.pause-btn').addEventListener('click', () => {
        const isPaused = tr.querySelector('.pause-btn')?.textContent === 'Resume';
        const msg = isPaused ? `Reprendre la table ${tableID} ?` : `Mettre en pause la table ${tableID} ?`;
        if (!confirm(msg)) return;
        socket.emit('adminTogglePause', { tableID }, (resp) => {
          if (!resp || !resp.ok) {
            alert(resp?.error || 'Pause failed.');
            return;
          }
          const btn = tr.querySelector('.pause-btn');
          if (btn) btn.textContent = resp.paused ? 'Resume' : 'Pause';
        });
      });

      tr.querySelector('.restart-btn').addEventListener('click', () => {
        if (!confirm(`Relancer la main en cours (table ${tableID}) ?`)) return;
        socket.emit('adminRestartHand', { tableID }, (resp) => {
          if (!resp || !resp.ok) {
            alert(resp?.error || 'Restart failed.');
            return;
          }
        });
      });

tr.querySelector('.watch-btn')?.addEventListener('click', () => {
  // ouvre une nouvelle fenÃªtre spectateur pour cette table
  window.open(
    adminUrl('/admin/admin-spectate.html', { table: tableID }),
    '_blank',
    'width=1200,height=800'
  );
});

      // 4) Insertion EN HAUT (newest first)
      tbody.insertBefore(tr, tbody.firstChild);

      // 5) âœ¨ Surbrillance si nouvelle table
      if (newIDs.includes(tableID)) {
        tr.style.backgroundColor = '#3f8ed8';
        tr.getBoundingClientRect(); // force reflow
        tr.style.transition = 'background-color 2s ease';
        tr.style.backgroundColor = '';
      }
    });

    // 6) Mise Ã  jour de la mÃ©moire des IDs
    previousTableIDs = currentIDs;

  } catch (err) {
    console.error('fetchTables failed:', err);
  }
}
  
  
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Partie face-Ã -face (2 joueurs)
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
// Partie face-Ã -face (2 joueurs)
// â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
let previousMatchIDs2 = [];  // MÃ©moire pour les matchs 2

async function fetchMatches() {
  const tbody = document.querySelector('#matches2-list tbody');
  tbody.innerHTML = '';

  try {
    const res  = await fetch(adminUrl('/admin/getMatches2'));
    const list = await res.json();

    // 1) Aucun match en cours
    if (!list.length) {
      previousMatchIDs2 = [];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="8" style="text-align:center;color:gray">
          Aucun match en cours.
        </td>`;
      tbody.appendChild(tr);
      return;
    }

    // 2) RepÃ©rage des nouveaux IDs
    const currentIDs = list
      .map(m => m.matchID)
      .filter(Boolean);

    const oldIDs = previousMatchIDs2;
    const newIDs = currentIDs.filter(id => !oldIDs.includes(id));

    // 3) CrÃ©ation dâ€™une ligne <tr> par match
    list.forEach(m => {
      const dotClass = m.winner ? 'status-inactive' : 'status-active';

      // ðŸ”¢ NumÃ©ro de game en DÃ‰CROISSANT dans lâ€™affichage
      // (on insÃ¨re toujours en haut, donc la derniÃ¨re crÃ©Ã©e a le plus grand numÃ©ro)
      const gameNumber = tbody.children.length + 1;

  const tr = document.createElement('tr');
  tr.dataset.match = m.matchID;
tr.innerHTML = `
  <td class="game-number-cell">#${gameNumber}</td>
  <td class="status-cell">
    <span class="status-dot ${dotClass}"></span>
  </td>
  <td>${m.matchID}</td>
  <td>${m.mode}</td>
  <td>${m.level || 'Q1'}</td>
  <td class="winner-cell">${m.winner || 'â€”'}</td>
  <td>
    <button type="button" class="copy-links-btn">
      Liens
    </button>
  </td>
  <td>
    <button class="watch-btn">ðŸ‘ Watch</button>
    <button class="start-btn">Start</button>
    <button class="pause-btn">${m.paused ? 'Resume' : 'Pause'}</button>
    <button class="restart-btn">Restart hand</button>
    <button class="toggle-details-btn">Voir plus</button>
    <button class="delete-btn">Delete</button>
  </td>`;
      if (!adminScope.canSpectate) tr.querySelector('.watch-btn')?.remove();
      if (!adminScope.canDetails) tr.querySelector('.toggle-details-btn')?.remove();
      if (!adminScope.canDelete) tr.querySelector('.delete-btn')?.remove();
      const startBtn = tr.querySelector('.start-btn');
      if (startBtn && matches2Data[m.matchID]?.players) {
        startBtn.disabled = true;
        startBtn.textContent = 'Started';
      }
      const pauseBtn = tr.querySelector('.pause-btn');
      if (pauseBtn && !matches2Data[m.matchID]?.players) {
        pauseBtn.disabled = true;
      }
      const restartBtn = tr.querySelector('.restart-btn');
      if (restartBtn && !matches2Data[m.matchID]?.players) {
        restartBtn.disabled = true;
      }

      // â€” Bouton â€œLiensâ€ pour dÃ©rouler les 2 liens de siÃ¨ges
      tr.querySelector('.copy-links-btn').addEventListener('click', () => {
        let dr = tr.nextElementSibling;
        // si dÃ©jÃ  ouvert, on supprime
        if (dr && dr.classList.contains('seat-links-row')) {
          return dr.remove();
        }
        // sinon on crÃ©e la ligne des liens
        const base = `${location.origin}?match2=${m.matchID}`;
        dr = document.createElement('tr');
        dr.classList.add('seat-links-row');
        dr.innerHTML = `
          <td colspan="8">
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
            const fb   = btn.nextElementSibling;
            if (!link) return alert("Erreur interne : lien introuvable.");
            copyToClipboardOrPrompt(link, fb).catch(() => {
              alert('Impossible de copier le lien.');
            });
          });
        });
      });

      // â€” Bouton â€œVoir plusâ€ (dÃ©tails du match)
      tr.querySelector('.toggle-details-btn')?.addEventListener('click', () => {
        let dr = tr.nextElementSibling;
        if (dr?.classList.contains('details-row')) {
          return dr.hidden = !dr.hidden;
        }
        dr = document.createElement('tr');
        dr.classList.add('details-row');
        dr.innerHTML = `<td colspan="8"></td>`;
        tr.parentNode.insertBefore(dr, tr.nextSibling);
        renderMatch2Details(m.matchID, dr);
      });

      // â€” Bouton â€œDeleteâ€ pour supprimer le match
      tr.querySelector('.delete-btn')?.addEventListener('click', async () => {
        if (!confirm(`Supprimer le match ${m.matchID} ?`)) return;
        try {
          const del = await fetch(adminUrl(`/admin/deleteMatch2/${m.matchID}`), {
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

            // Bouton Start
tr.querySelector('.start-btn').addEventListener('click', () => {
  if (!confirm('Start match ' + m.matchID + ' ?')) return;
  socket.emit('adminStartMatch2', { matchID: m.matchID }, (resp) => {
    if (!resp || !resp.ok) {
      alert(resp?.error || 'Start failed.');
      return;
    }
    const btn = tr.querySelector('.start-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Started';
    }
    const pb = tr.querySelector('.pause-btn');
    if (pb) pb.disabled = false;
  });
});

tr.querySelector('.pause-btn').addEventListener('click', () => {
  const isPaused = tr.querySelector('.pause-btn')?.textContent === 'Resume';
  const msg = isPaused ? `Reprendre le match ${m.matchID} ?` : `Mettre en pause le match ${m.matchID} ?`;
  if (!confirm(msg)) return;
  socket.emit('adminTogglePause', { matchID: m.matchID }, (resp) => {
    if (!resp || !resp.ok) {
      alert(resp?.error || 'Pause failed.');
      return;
    }
    const btn = tr.querySelector('.pause-btn');
    if (btn) btn.textContent = resp.paused ? 'Resume' : 'Pause';
  });
});

tr.querySelector('.restart-btn').addEventListener('click', () => {
  if (!confirm(`Relancer la main en cours (match ${m.matchID}) ?`)) return;
  socket.emit('adminRestartHand', { matchID: m.matchID }, (resp) => {
    if (!resp || !resp.ok) {
      alert(resp?.error || 'Restart failed.');
      return;
    }
  });
});

tr.querySelector('.watch-btn')?.addEventListener('click', () => {
  window.open(
    adminUrl('/admin/admin-spectate.html', { match2: m.matchID }),
    '_blank',
    'width=1200,height=800'
  );
});
      // 4) Insertion et surlignage si nouveau
      tbody.insertBefore(tr, tbody.firstChild);
      if (newIDs.includes(m.matchID)) {
        tr.style.backgroundColor = '#3f8ed8';
        tr.getBoundingClientRect();        // force reflow
        tr.style.transition = 'background-color 2s ease';
        tr.style.backgroundColor = '';
      }
    });

    // 5) Mise Ã  jour de la mÃ©moire
    previousMatchIDs2 = currentIDs;

  } catch (err) {
    console.error('fetchMatches failed:', err);
  }
}

async function fetchProfiles(tbody, type) {
  tbody.innerHTML = '';
  try {
    // on passe le type en query-param
    const res  = await fetch(adminUrl('/admin/getProfiles', type ? { type } : null));
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
          <div class="profile-controls">
            <button class="toggle-profile-btn">Voir</button>
            <button class="delete-profile-btn">Suppr</button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);

      // 2) Toggle dÇ¸tails
      const toggleBtn = tr.querySelector('.toggle-profile-btn');
      toggleBtn.addEventListener('click', () => {
        let dr = tr.nextElementSibling;
        if (dr && dr.classList.contains('profile-details')) {
          dr.hidden = !dr.hidden;
          return;
        }

        // CrÇ¸e la ligne de dÇ¸tails
        dr = document.createElement('tr');
        dr.classList.add('profile-details');
        dr.innerHTML = `
            <td colspan="4">
              <div style="display:grid;grid-template-columns:repeat(${Object.keys(p.byMode).length},1fr);gap:8px;">
                ${Object.entries(p.byMode).map(([mode, stats]) => `
                  <div style="background:var(--bg-dark);padding:8px;border-radius:4px;">
                    <strong style="text-transform:capitalize;">${mode}</strong><br>
                    Parties jouÇ¸es : ${stats.played}<br>
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
          const del = await fetch(adminUrl(`/admin/deleteProfile/${encodeURIComponent(p.name)}`), {
            method: 'DELETE'
          });
          if (!del.ok) throw new Error(await del.text());
          // la mise ï¿½ï¿½ jour live par Socket.IO se chargera de rerendre la liste
        } catch (err) {
          alert('Erreur suppression : ' + err.message);
        }
      });
    });

  } catch (err) {
    console.error('fetchProfiles failed:', err);
    tbody.innerHTML = `<tr><td colspan="6">Impossible de charger les profils.</td></tr>`;
  }
}/**
 * RÃ©cupÃ¨re et affiche lâ€™historique des parties.
 * @param {HTMLTableSectionElement} tbody - Le <tbody> Ã  remplir.
 * @param {'table'|'match2'} type - 'table' pour 10 joueurs, 'match2' pour 2 joueurs.
 */
async function fetchGames(tbody, type) {
  tbody.innerHTML = ''; // on vide d'abord tout le <tbody>
  try {
    const res      = await fetch(adminUrl('/admin/getGames'));
    const allGames = await res.json();
    // on ne garde que les parties du type demandÃ©, triÃ©es par date (ancienne â†’ rÃ©cente)
    const filtered = allGames
      .filter(g => g.type === type)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // mapping des clÃ©s de mode vers leur libellÃ© complet
    const modeLabels = {
      beginner:   'Beginner',
      normal:     'Normal',
      turbo:      'Turbo',
      highroller: 'Highroller',
      hyper:      'Hyper-fast'
    };

    filtered.forEach((g, index) => {
      const tr          = document.createElement('tr');
      const displayType = type === 'table' ? '10 joueurs' : '2 joueurs';
      const displayMode = modeLabels[g.mode] || g.mode;
      const gameNumber  = index + 1; // Game #1, #2, #3, ...

      tr.innerHTML = `
        <td>${gameNumber}</td>
        <td>${displayType}</td>
        <td>${g.tableID || g.matchID}</td>
        <td>${displayMode}</td>
        <td>${g.winner}</td>
        <td>${new Date(g.timestamp).toLocaleString()}</td>
      `;

      tbody.appendChild(tr);
    });

    // message si aucune game Ã  afficher
    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td colspan="6" style="text-align:center; color:gray">
          Aucune partie Ã  afficher.
        </td>
      `;
      tbody.appendChild(tr);
    }

  } catch (err) {
    console.error('fetchGames failed:', err);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td colspan="6" style="text-align:center; color:red">
        Ã‰chec du chargement des parties.
      </td>
    `;
    tbody.appendChild(tr);
  }
}

  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  // Finally, initialize on Partie 10
  // â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”â€”
  main10.click();
});






