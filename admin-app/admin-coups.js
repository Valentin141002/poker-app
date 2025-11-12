/*!
 * admin-coups.js — Historique (Résumé + Détails + Timeline) avec persistance
 * - Persistance locale (localStorage)
 * - Freeze dès 'tableFinished' / 'match2Finished' (stop updates parasites)
 * - Onglet principal "Historique" séparé, rendu uniquement dans #panel-hist
 * - Segment "10 joueurs | 2 joueurs"
 * - Dé-duplication par ID (choix d’une clé primaire table:ID ou match2:ID)
 * - Pas de changement serveur requis (écoute window.socket / onAny)
 */
(function(){
  if (window.__ADMIN_COUPS_LOADED) return;
  window.__ADMIN_COUPS_LOADED = true;

  // -------------------------------------------------
  // Utils
  // -------------------------------------------------
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  // Filtre de type (10 joueurs / 2 joueurs)
  let __kindFilter = 'table'; // 'table' | 'match2'

  // Supprime toute ancienne injection "coups" hors de l'onglet Historique
  function cleanupLegacyPanels(){
    document.querySelectorAll('.coups-panel').forEach(el=>{
      if (!el.closest('#panel-hist')) el.remove();
    });
    const old = document.getElementById('panel-coups');
    if (old && !old.closest('#panel-hist')) old.remove();
  }

  function getHistMount(){ return document.querySelector('#panel-hist .coups-panel'); }
  function isHistVisible(){
    const ph = document.getElementById('panel-hist');
    return ph && !ph.hidden;
  }

  // -------------------------------------------------
  // Persistance locale
  // -------------------------------------------------
  const LS_KEY = 'adminCoupsStore.v2';
  const LS_MAX_GAMES   = 300;  // limites de sécurité
  const LS_MAX_ACTIONS = 5000;

  function save(){
    try{
      const payload = { ver:2, when:Date.now(), data:{}, finished:{} };
      for (const [k,g] of games){
        payload.data[k] = {
          handNo:  g.handNo,
          last:    g.last,
          actions: g.actions.slice(-500) // cap par game
        };
      }
      for (const [k,v] of finishedGames) payload.finished[k] = v;

      // hard caps
      const keys = Object.keys(payload.data).slice(-LS_MAX_GAMES);
      const slim = { ver:payload.ver, when:payload.when, data:{}, finished:payload.finished };
      let total=0;
      for (const k of keys){
        const a = payload.data[k].actions.length;
        if (total + a > LS_MAX_ACTIONS) break;
        slim.data[k] = payload.data[k];
        total += a;
      }
      localStorage.setItem(LS_KEY, JSON.stringify(slim));
    }catch(e){ /* ignore */ }
  }

  function load(){
    try{
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      if (!obj || obj.ver !== 2 || !obj.data) return;
      games.clear();
      for (const k of Object.keys(obj.data)){
        const v = obj.data[k];
        games.set(k, { handNo: v.handNo||1, last: v.last||null, actions: Array.isArray(v.actions)? v.actions:[] });
      }
      finishedGames.clear();
      if (obj.finished){
        for (const k of Object.keys(obj.finished)){
          finishedGames.set(k, obj.finished[k]);
        }
      }
    }catch(e){ /* ignore */ }
  }

  // -------------------------------------------------
  // Styles
  // -------------------------------------------------
  const style = document.createElement('style');
  style.textContent = `
    .coups-panel{ padding:12px; color: var(--text,#eee); }
    .coups-toolbar{ display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px; align-items:center; }
    .coups-toolbar select, .coups-toolbar input{ max-width: 260px; }
    .btn-sm{ padding:6px 10px; border:none; border-radius:8px; background: var(--accent,#9c27b0); color:#111; font-weight:700; cursor:pointer; }
    .muted{ color:#9aa; }
    .table-clean{ width:100%; border-collapse: collapse; }
    .table-clean th, .table-clean td{ padding:10px; border-bottom:1px solid #2c2c40; text-align:center; }
    .table-clean thead th{ color: var(--accent,#9c27b0); font-weight:700; }
    .table-clean tbody tr:hover{ background:#1b1b2a; }
    .badge{ display:inline-block; min-width:22px; padding:2px 8px; border-radius:999px; background:#31314a; color:#ddd; font-size:.75rem; }
    .pill{ display:inline-block; padding:2px 8px; border-radius:12px; font-size:.75rem; background:#3e3e5a; color:#ddd; }
    .pill.raise{ background:#ffd54f; color:#222; }
    .pill.allin{ background:#ef5350; color:#111; }
    .pill.fold{ background:#90a4ae; color:#111; }
    .accordion-details{ background:#151522; border:1px solid #2a2a40; border-radius:10px; margin:8px 0 18px; padding:10px; }
    .hand-title{ margin:6px 0 8px; font-weight:700; color: var(--accent,#9c27b0); }
    .coups-subtable{ width:100%; border-collapse: collapse; }
    .coups-subtable th, .coups-subtable td{ padding:6px 8px; border-bottom:1px dashed #2a2a40; text-align:center; }
    .coups-subtable thead th{ color:#c7c7f7; font-weight:600; }
    .right{ text-align:right; }
    .left{ text-align:left; }
    .nowrap{ white-space:nowrap; }
    .winner-badge{ display:inline-block; padding:2px 8px; border-radius:8px; background:#7ee787; color:#111; font-weight:700; }

    /* Segmented control 10j / 2j */
    .hist-tabs{ display:inline-flex; gap:0; padding:4px; border:1px solid #2a2a40; border-radius:12px; background:#0f1220; box-shadow:inset 0 1px 0 #0a0d18; }
    .hist-tabs button{ border:0; background:transparent; color:#9aa; padding:6px 12px; cursor:pointer; border-radius:8px; font-weight:600; }
    .hist-tabs button:hover{ color:#eaeaff; }
    .hist-tabs button.active{ background:#2a2a40; color:#fff; box-shadow:0 0 0 1px #3b3b5e inset; }
  `;
  document.head.appendChild(style);

  // -------------------------------------------------
  // Onglet principal "Historique"
  // -------------------------------------------------
  function ensureMainHistorique(){
    const main10 = document.getElementById('main-10');
    const main2  = document.getElementById('main-2');
    const mainNv = document.getElementById('main-niveaux');
    if (!main10 || !main2 || !mainNv) return null;

    // 1) Bouton "Historique" dans la barre des onglets principaux
    const bar = main10.parentElement;
    let btn = document.getElementById('main-hist');
    if (!btn){
      btn = document.createElement('button');
      btn.id = 'main-hist';
      btn.textContent = 'Historique';
      btn.className = mainNv.className.replace('active','').trim();
      bar.appendChild(btn);
    }

    // 2) Panel dédié
    let panel = document.getElementById('panel-hist');
    if (!panel){
      panel = document.createElement('div');
      panel.id = 'panel-hist';
      panel.className = 'panel';
      panel.hidden = true;
      panel.innerHTML = `
        <div class="hist-tabs" style="margin-bottom:10px;">
          <button id="hist-10" class="active" aria-pressed="true">10 joueurs</button>
          <button id="hist-2" aria-pressed="false">2 joueurs</button>
        </div>
        <div class="coups-panel">
          <div class="coups-toolbar">
            <label class="muted">Vue:</label>
            <select class="view-mode">
              <option value="resume" selected>Résumé (par game)</option>
              <option value="global">Timeline globale</option>
            </select>
            <input class="filter" type="text" placeholder="Filtrer par game/joueur/action…">
            <button class="btn-sm export">Exporter CSV</button>
          </div>
          <div class="coups-content"></div>
        </div>`;
      const pNiv = document.getElementById('panel-niveaux');
      (pNiv?.parentNode || document.body).insertBefore(panel, pNiv ? pNiv.nextSibling : null);

      // Toolbar Historique
      const vm = panel.querySelector('.view-mode');
      const ft = panel.querySelector('.filter');
      const ex = panel.querySelector('.export');
      vm.addEventListener('change', draw);
      ft.addEventListener('input', draw);
      ex.addEventListener('click', exportCSV);

      // Sous-onglets 10 / 2 → filtre de type
      const b10 = panel.querySelector('#hist-10');
      const b2  = panel.querySelector('#hist-2');
      const set = (k) => {
        __kindFilter = k;
        b10.classList.toggle('active', k==='table');
        b2.classList.toggle('active',  k==='match2');
        b10.setAttribute('aria-pressed', k==='table' ? 'true' : 'false');
        b2.setAttribute('aria-pressed', k==='match2' ? 'true' : 'false');
        draw();
      };
      b10.addEventListener('click', () => set('table'));
      b2.addEventListener('click',  () => set('match2'));
      set('table'); // défaut : 10 joueurs
    }

    // 3) Click "Historique"
    btn.addEventListener('click', () => {
      // Masque les autres panels principaux
      ['panel-10-create','panel-10-content','panel-2-create','panel-2-content','panel-niveaux']
        .forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
      [main10, main2, mainNv].forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Affiche l’historique + rendu
      panel.hidden = false;
      draw();
    });

    // 4) S’assurer qu’en cliquant sur un autre onglet, on masque l’historique
    function hideHist(){
      const ph = document.getElementById('panel-hist');
      const mh = document.getElementById('main-hist');
      if (ph) ph.hidden = true;
      if (mh) mh.classList.remove('active');
    }
    main10.addEventListener('click', hideHist);
    main2.addEventListener('click',  hideHist);
    mainNv.addEventListener('click', hideHist);

    // Nettoyage d’éventuels anciens blocs
    cleanupLegacyPanels();
    return panel;
  }

  let _histPanel = null;
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=> _histPanel = ensureMainHistorique());
  } else {
    _histPanel = ensureMainHistorique();
  }

  // -------------------------------------------------
  // Data store + canonisation de type (anti-doublons)
  // -------------------------------------------------
  // games[key] avec key = "table:ID" ou "match2:ID"
  const games = new Map();
  const finishedGames = new Map(); // key => { winner, when }

  // Mapping id -> 'table' | 'match2'
  const idKindMap = new Map();
  function canonicalKindFor(id, incomingKind, state){
    if (idKindMap.has(id)) return idKindMap.get(id);
    if (state && Array.isArray(state.players)){
      const k = state.players.length <= 2 ? 'match2' : 'table';
      idKindMap.set(id, k);
      return k;
    }
    idKindMap.set(id, incomingKind);
    return incomingKind;
  }
  function keyOf(kind,id){
    const k = idKindMap.get(id) || kind;
    return `${k}:${id}`;
  }
  function splitKey(k){
    const p = k.indexOf(':');
    return p>0 ? { kind:k.slice(0,p), id:k.slice(p+1) } : { kind:'table', id:k };
  }

  // Choix d’une clé primaire par ID (évite doubles affichages)
  function primaryKeyForId(id){
    const kT = `table:${id}`;
    const kM = `match2:${id}`;
    const hasT = games.has(kT);
    const hasM = games.has(kM);
    if (hasT && hasM){
      const nt = (games.get(kT)?.last?.names?.length) || 0;
      const nm = (games.get(kM)?.last?.names?.length) || 0;
      if (nm && nm <= 2 && (!nt || nt > 2)) return kM;
      if (nt && nt > 2 && (!nm || nm <= 2)) return kT;
      const pref = idKindMap.get(id);
      if (pref === 'match2') return kM;
      if (pref === 'table')  return kT;
      return kT; // fallback
    }
    return hasT ? kT : (hasM ? kM : null);
  }

  const fmt = (n)=> (n==null || isNaN(n)) ? '' : new Intl.NumberFormat().format(n);
  const esc = (s)=> String(s||'').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[m]||m));

  // Charger persistance au plus tôt
  load();

  function ensure(kind,id){
    const K = keyOf(kind,id);
    if (!games.has(K)) games.set(K, { handNo:1, last:null, actions:[] });
    return games.get(K);
  }

  function push(g, id, player, action, amount, pot){
    g.actions.push({ ts: Date.now(), id, hand: g.handNo, player, action, amount, pot });
    save();
    if (isHistVisible()) draw();
  }

  function normalize(s){
    const out = {
      pot: Number(s?.pot || 0),
      boardLen: Array.isArray(s?.board) ? s.board.filter(Boolean).length : 0,
      bets: [], bankrolls: [], statuses: [], names: []
    };
    const players = Array.isArray(s?.players) ? s.players : [];
    for (const p of players){
      out.bets.push(Number(p?.subtotal_bet || 0));
      out.bankrolls.push(Number(p?.bankroll ?? 0));
      out.statuses.push(String(p?.status || '').toUpperCase());
      out.names.push(p?.label || p?.name || '');
    }
    return out;
  }
  const sum = (a)=> a.reduce((x,y)=> x + (Number(y)||0), 0);
  const max = (a)=> a.reduce((m,v)=> Math.max(m, Number(v)||0), 0);

  function isFinished(kind,id){ return finishedGames.has(keyOf(kind,id)); }

  function markFinished(kind,id,winner){
    // Fige la catégorie canonique et l’autre, pour éviter tout "en cours" fantôme
    const kCanon = canonicalKindFor(id, kind, null);
    const fin = { winner: winner||'—', when: Date.now() };
    finishedGames.set(keyOf(kCanon,id), fin);
    finishedGames.set(keyOf(kCanon === 'table' ? 'match2' : 'table', id), fin);
    save();
    if (isHistVisible()) draw();
  }

  function onUpdate(kind, id, state){
    // Force catégorie canonique par ID
    kind = canonicalKindFor(id, kind, state);
    // ignore updates si terminé
    if (isFinished(kind,id)) return;

    const g = ensure(kind,id);
    const prev = g.last;
    const curr = normalize(state||{});
    if (!prev){ g.last = curr; save(); return; }

    const newHand = (prev.pot > 0 && curr.pot === 0 && sum(curr.bets) === 0) ||
                    (prev.boardLen > 0 && curr.boardLen === 0 && sum(curr.bets) === 0);
    if (newHand){
      g.handNo += 1;
      push(g, id, '—', 'NEW_HAND', null, 0);
    }

    const N = Math.max(prev.bets.length, curr.bets.length);
    const prevMax = max(prev.bets);
    for (let i=0;i<N;i++){
      const name  = curr.names[i] || `Seat ${i}`;
      const pbet  = Number(prev.bets[i]||0);
      const cbet  = Number(curr.bets[i]||0);
      const pstat = (prev.statuses[i]||'').toUpperCase();
      const cstat = (curr.statuses[i]||'').toUpperCase();
      const pbank = prev.bankrolls[i];
      const cbank = curr.bankrolls[i];

      if (pstat !== 'FOLD' && cstat === 'FOLD'){
        push(g, id, name, 'FOLD', null, curr.pot);
        continue;
      }
      if (cbet > pbet){
        const delta = cbet - pbet;
        let tag = 'CALL';
        if (prevMax === 0 && pbet === 0) tag = 'BET';
        else if (cbet > prevMax) tag = 'RAISE';
        if (cbank === 0 || cstat === 'ALLIN') tag = 'ALLIN';
        push(g, id, name, tag, delta, curr.pot);
        continue;
      }
      if ((pbank !== 0 && cbank === 0) || (pstat !== 'ALLIN' && cstat === 'ALLIN')){
        push(g, id, name, 'ALLIN', null, curr.pot);
        continue;
      }
    }
    g.last = curr;
    save();
  }

  // -------------------------------------------------
  // Rendering (toujours scoper à #panel-hist)
  // -------------------------------------------------
  function draw(){
    cleanupLegacyPanels(); // sécurité : jamais ailleurs que #panel-hist
    const mount = getHistMount();
    if (!mount) return;
    const content = mount.querySelector('.coups-content');
    const mode    = mount.querySelector('.view-mode').value;
    const filter  = mount.querySelector('.filter').value.trim().toLowerCase();

    // Construire la liste d'IDs uniques + choisir la clé primaire par ID
    const allIds = new Set();
    for (const k of games.keys()){ allIds.add(splitKey(k).id); }

    if (mode === 'global'){
      content.innerHTML = globalTableHTML();
      const tbody = content.querySelector('tbody');
      const rows  = [];

      for (const id of allIds){
        const K = primaryKeyForId(id);
        if (!K) continue;
        const { kind } = splitKey(K);
        if (__kindFilter && kind !== __kindFilter) continue;

        const g = games.get(K);
        if (!g) continue;

        for (const a of g.actions){
          if (a.action === 'NEW_HAND') continue;
          const text = `${id} ${a.player} ${a.action}`.toLowerCase();
          if (filter && !text.includes(filter)) continue;
          rows.push(globalRow(id, a));
        }
      }
      // tri simple (par HTML); on peut remplacer par un tri timestamp si tu veux
      rows.sort((A,B)=> A.localeCompare(B));
      tbody.innerHTML = rows.join('') || emptyRow(7);
      return;
    }

    // Résumé (par game)
    const rows = [];
    for (const id of allIds){
      const K = primaryKeyForId(id);
      if (!K) continue;
      const { kind } = splitKey(K);
      if (__kindFilter && kind !== __kindFilter) continue;

      const g = games.get(K);
      if (!g) continue;

      const S = summarize(K, g, id);
      const text = `${id} ${S.players.join(' ')}`.toLowerCase();
      if (filter && !text.includes(filter)) continue;

      rows.push(summaryRowHTML(S));
    }

    // Tri par dernière maj desc
    rows.sort((A,B)=>{
      const a = Number(A.match(/data-ts="(\d+)"/)?.[1]||0);
      const b = Number(B.match(/data-ts="(\d+)"/)?.[1]||0);
      return b - a;
    });

    content.innerHTML = summaryTableHTML(rows.join('') || emptyRow(11));

    // Bind des boutons Voir/masquer
    content.querySelectorAll('.btn-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const gid = btn.getAttribute('data-gid');
        const tr  = content.querySelector(`tr.summary[data-gid="${gid}"]`);
        let dr    = tr.nextElementSibling;
        if (dr && dr.classList.contains('details-row')) {
          dr.hidden = !dr.hidden;
          btn.textContent = dr.hidden ? 'Voir' : 'Masquer';
          return;
        }
        dr = document.createElement('tr');
        dr.className = 'details-row';
        dr.innerHTML = `<td colspan="11">${renderDetails(gid)}</td>`;
        tr.parentNode.insertBefore(dr, tr.nextSibling);
        btn.textContent = 'Masquer';
      });
    });
  }

  // -------------------------------------------------
  // Résumé helpers
  // -------------------------------------------------
  function summarize(k, g, gid){
    const acts = g.actions;
    let allins = 0, raises = 0, folds = 0, actionsCount = 0;
    let firstTs = null, lastTs = null, maxPot = 0;
    const players = new Set();
    let maxHand = 1;

    for (const a of acts){
      if (a.action === 'NEW_HAND') { maxHand = Math.max(maxHand, a.hand); continue; }
      actionsCount++;
      if (a.action === 'ALLIN') allins++;
      else if (a.action === 'RAISE') raises++;
      else if (a.action === 'FOLD') folds++;
      if (a.pot!=null) maxPot = Math.max(maxPot, Number(a.pot)||0);
      if (a.player && a.player !== '—') players.add(a.player);
      if (firstTs==null) firstTs = a.ts;
      lastTs = a.ts;
    }

    const fin = finishedGames.get(k);
    return {
      gid, ts: lastTs || Date.now(),
      hands: Math.max(maxHand, g.handNo || 1),
      actions: actionsCount,
      players: Array.from(players),
      allins, raises, folds, maxPot,
      start: firstTs, end: lastTs,
      finished: !!fin, winner: fin?.winner || null, finishedAt: fin?.when || null
    };
  }

  function summaryTableHTML(bodyRows){
    return `<table class="table-clean">
      <thead>
        <tr>
          <th>Game</th><th>Mains</th><th>Actions</th><th>Joueurs</th>
          <th>All-in</th><th>Raises</th><th>Folds</th><th>Pot max</th>
          <th>Dernière maj</th><th>État</th><th>Détails</th>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
  }

  function summaryRowHTML(S){
    const last = S.end ? new Date(S.end).toLocaleString() : '—';
    const players = S.players.slice(0,3).join(', ') + (S.players.length>3 ? ` (+${S.players.length-3})` : '');
    const state = S.finished
      ? `<span class="winner-badge">Winner: ${esc(S.winner||'—')}</span>`
      : `<span class="badge">En cours</span>`;
    return `<tr class="summary" data-gid="${esc(S.gid)}" data-ts="${S.ts}">
      <td class="nowrap left"><strong>${esc(S.gid)}</strong></td>
      <td>${S.hands}</td>
      <td>${S.actions}</td>
      <td class="left">${esc(players)}</td>
      <td><span class="badge">${S.allins}</span></td>
      <td><span class="badge">${S.raises}</span></td>
      <td><span class="badge">${S.folds}</span></td>
      <td class="right">${fmt(S.maxPot)}</td>
      <td class="nowrap">${last}</td>
      <td>${state}</td>
      <td><button class="btn-sm btn-toggle" data-gid="${esc(S.gid)}">Voir</button></td>
    </tr>`;
  }

  function renderDetails(gid){
    // Retrouver la game par ID via la clé primaire
    const K = primaryKeyForId(gid);
    const g = K ? games.get(K) : null;
    if (!g) return `<div class="accordion-details">Aucune donnée.</div>`;

    const byHand = new Map();
    for (const a of g.actions){
      if (!byHand.has(a.hand)) byHand.set(a.hand, []);
      if (a.action !== 'NEW_HAND') byHand.get(a.hand).push(a);
    }

    let out = `<div class="accordion-details">`;
    const fin = finishedGames.get(K);
    if (fin){
      out += `<div style="margin-bottom:8px;">${fin.finishedAt ? new Date(fin.finishedAt).toLocaleString()+' — ' : ''}<span class="winner-badge">Winner: ${esc(fin.winner||'—')}</span></div>`;
    }
    const hands = Array.from(byHand.keys()).sort((a,b)=> a-b);
    if (hands.length === 0) {
      out += `<em class="muted">Aucun coup enregistré pour cette game.</em>`;
    } else {
      for (const h of hands){
        const arr = byHand.get(h);
        out += `<div class="hand-block">
          <div class="hand-title">Main #${h}</div>
          <table class="coups-subtable">
            <thead><tr><th>Heure</th><th>Joueur</th><th>Action</th><th>Montant</th><th>Pot</th></tr></thead>
            <tbody>${arr.map(a => handRow(a)).join('') || `<tr><td colspan="5" class="muted">—</td></tr>`}</tbody>
          </table>
        </div>`;
      }
    }
    out += `</div>`;
    return out;
  }

  function handRow(a){
    const dt = new Date(a.ts).toLocaleString();
    const amt = (a.amount==null) ? '' : fmt(a.amount);
    const pot = (a.pot==null) ? '' : fmt(a.pot);
    const cls = a.action==='RAISE' ? 'raise' : (a.action==='ALLIN' ? 'allin' : (a.action==='FOLD' ? 'fold' : ''));
    return `<tr>
      <td class="nowrap">${dt}</td>
      <td class="left">${esc(a.player)}</td>
      <td><span class="pill ${cls}">${esc(a.action)}</span></td>
      <td class="right">${amt}</td>
      <td class="right">${pot}</td>
    </tr>`;
  }

  // Timeline global table helpers
  function globalTableHTML(){
    return `<table class="table-clean">
      <thead><tr><th>Game</th><th>Main #</th><th>Heure</th><th>Joueur</th><th>Action</th><th>Montant</th><th>Pot</th></tr></thead>
      <tbody></tbody>
    </table>`;
  }
  function globalRow(gid,a){
    const dt = new Date(a.ts).toLocaleString();
    const amt = (a.amount==null) ? '' : fmt(a.amount);
    const pot = (a.pot==null) ? '' : fmt(a.pot);
    const cls = a.action==='RAISE' ? 'raise' : (a.action==='ALLIN' ? 'allin' : (a.action==='FOLD' ? 'fold' : ''));
    return `<tr>
      <td>${esc(gid)}</td><td>${a.hand}</td><td class="nowrap">${dt}</td>
      <td class="left">${esc(a.player)}</td>
      <td><span class="pill ${cls}">${esc(a.action)}</span></td>
      <td class="right">${amt}</td><td class="right">${pot}</td>
    </tr>`;
  }
  function emptyRow(n){ return `<tr><td colspan="${n}"><em class="muted">Aucune action détectée…</em></td></tr>`; }

  // -------------------------------------------------
  // Export
  // -------------------------------------------------
  function exportCSV(){
    const lines = [['game','hand','ts','player','action','amount','pot','finished','winner']];
    const allIds = new Set();
    for (const k of games.keys()){ allIds.add(splitKey(k).id); }
    for (const id of allIds){
      const K = primaryKeyForId(id);
      if (!K) continue;
      const fin = finishedGames.get(K);
      const g   = games.get(K);
      if (!g) continue;
      for (const a of g.actions){
        if (a.action === 'NEW_HAND') continue;
        lines.push([id, a.hand, a.ts, a.player, a.action, a.amount ?? '', a.pot ?? '', fin ? 'yes' : 'no', fin?.winner ?? '']);
      }
    }
    const csv = lines.map(r => r.map(v => {
      const s = String(v ?? '');
      return (s.includes(',') || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g,'""')}"` : s;
    }).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
    const a = document.createElement('a'); a.href = url; a.download = 'coups_global.csv';
    document.body.appendChild(a); a.click();
    requestAnimationFrame(()=>{ URL.revokeObjectURL(url); a.remove(); });
  }

  // -------------------------------------------------
  // Sockets
  // -------------------------------------------------
  function attachSocket(sock){
    if (!sock) return;

    const tableEvents = ['updateTable', 'admin:updateTable', 'table:update'];
    const matchEvents = ['updateMatch2', 'admin:updateMatch2', 'match2:update'];

    for (const ev of tableEvents){
      sock.on(ev, (payload)=>{
        try{
          const id = payload.tableID || payload.id || payload.gameId || 'table';
          const gs = payload.gameState || payload.state || payload;
          onUpdate('table', id, gs);
        }catch(e){}
      });
    }
    for (const ev of matchEvents){
      sock.on(ev, (payload)=>{
        try{
          const id = payload.matchID || payload.id || payload.gameId || 'match2';
          const gs = payload.gameState || payload.state || payload;
          onUpdate('match2', id, gs);
        }catch(e){}
      });
    }

    // FINISH events → freeze
    sock.on('tableFinished', ({ tableID, winner }) => {
      try { markFinished('table', tableID, winner); } catch(e){}
    });
    sock.on('match2Finished', ({ matchID, winner }) => {
      try { markFinished('match2', matchID, winner); } catch(e){}
    });

    // Sniffer "secours"
    if (typeof sock.onAny === 'function'){
      sock.onAny((ev, payload)=>{
        try{
          if (ev === 'tableFinished'){
            const { tableID, winner } = payload||{};
            if (tableID) markFinished('table', tableID, winner);
            return;
          }
          if (ev === 'match2Finished'){
            const { matchID, winner } = payload||{};
            if (matchID) markFinished('match2', matchID, winner);
            return;
          }
          let kind=null, id=null, gs=null;
          if (payload && typeof payload === 'object'){
            if ('tableID' in payload || 'tableId' in payload) { kind='table';  id = payload.tableID || payload.tableId; }
            if ('matchID' in payload || 'matchId' in payload) { kind='match2'; id = payload.matchID || payload.matchId; }
            if (!id && ('id' in payload)) { id = payload.id; }
            gs = payload.gameState || payload.state || payload.gs || (Array.isArray(payload.players) || payload.pot!=null ? payload : null);
          }
          const name = String(ev).toLowerCase();
          if (!kind){
            if (name.includes('match')) kind='match2';
            else if (name.includes('table')) kind='table';
          }
          if (kind && id && gs && !isFinished(kind,id)) {
            onUpdate(kind, id, gs);
          }
        }catch(e){}
      });
    }
  }

  function initSockets(){
    if (window.socket && typeof window.socket.on === 'function'){
      attachSocket(window.socket);
    } else if (window.io){
      try { attachSocket(window.io()); } catch(e){}
      try { attachSocket(window.io('/admin')); } catch(e){}
    }
    // premier rendu après hydratation
    if (document.readyState === 'complete' && isHistVisible()){
      draw();
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', initSockets);
  } else {
    initSockets();
  }
})();
