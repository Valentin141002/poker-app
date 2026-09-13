/* IMDCX competitive hub. Presentation and acknowledged socket requests only.
   All rewards, identities, ranking and unlock decisions remain server-owned. */
(() => {
  'use strict';
  if (window.IMDCXProgression) return;

  const state = {
    socket: null, getName: () => '', view: 'leaderboard', category: 'global',
    dashboard: null, ranking: null, profile: null, targetName: '',
    shell: null, choice: null, requestId: 0, focusBefore: null, choiceFocus: null,
    overflowBefore: '', inertBefore: [], receipts: new Set(), listeners: null,
    busy: false, error: '', loading: false
  };
  const numberFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
  const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const escape = value => String(value == null ? '' : value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const num = value => numberFormat.format(Number.isFinite(Number(value)) ? Number(value) : 0);
  const integer = value => Math.max(0, Math.round(Number(value) || 0));
  const clamp = value => Math.min(100, Math.max(0, Number(value) || 0));
  const ownName = () => String(state.dashboard?.profile?.name || state.getName() || '');
  const sameName = (left, right) => String(left || '') === String(right || '');
  const initials = name => Array.from(String(name || '?').trim()).slice(0, 2).join('').toLocaleUpperCase();
  const focusables = root => Array.from(root.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')).filter(element => element.getClientRects().length && !element.closest('[hidden]'));

  const paths = {
    home: '<path d="m3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9"/>',
    trophy: '<path d="M8 3h8v5c0 4-2 6-4 6s-4-2-4-6V3Zm0 2H4v3c0 3 2 4 5 4m7-7h4v3c0 3-2 4-5 4M12 14v5m-5 2h10m-8-2h6"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18M5 6h14M5 18h14"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 2v6m10-6v6M3 11h18m-13 4h1m3 0h1m3 0h1m-9 3h1m3 0h1"/>',
    friends: '<circle cx="9" cy="8" r="3"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M16 5a3 3 0 0 1 0 6m3 10v-4a5 5 0 0 0-2-4"/>',
    chart: '<path d="M5 21V11m7 10V3m7 18V7"/>',
    bolt: '<path d="m14 2-9 12h6l-1 8 9-12h-6l1-8Z"/>',
    fire: '<path d="M13 2c2 6-4 6-2 11 1-2 3-3 4-4 5 5 5 12-3 13C3 21 2 13 7 7c-1 5 1 6 2 6C8 7 13 7 13 2Z"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    gift: '<rect x="3" y="9" width="18" height="4" rx="1"/><path d="M5 13v8h14v-8M12 9v12m0-12H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z"/>',
    star: '<path d="m12 2 3 6.5 7 1-5 5 1 7-6-3.5L6 21l1-6.5-5-5 7-1L12 2Z"/>',
    shield: '<path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z"/><path d="m8 12 3 3 5-6"/>',
    lock: '<rect x="5" y="10" width="14" height="12" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v3"/>',
    refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v6h-6"/>',
    crown: '<path d="m3 6 5 5 4-8 4 8 5-5-2 13H5L3 6Zm2 16h14"/>',
    spade: '<path d="M12 2C10 5 3 9 3 14a5 5 0 0 0 8 4l-2 4h6l-2-4a5 5 0 0 0 8-4c0-5-7-9-9-12Z"/>',
    diamond: '<path d="m12 2 9 10-9 10L3 12 9 2Z"/>',
    heart: '<path d="M12 21 3.5 12A5.7 5.7 0 0 1 12 4.5 5.7 5.7 0 0 1 20.5 12L12 21Z"/>',
    club: '<path d="M8 10a5 5 0 1 1 8 0 5 5 0 1 1-3 8l2 4H9l2-4a5 5 0 1 1-3-8Z"/>'
  };
  function icon(name, className = '') {
    return `<svg class="progression-icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spade}</svg>`;
  }

  const identityPalette = {
    spade: ['#a76bff', '#344cff', 'spade'], ace: ['#c6a5ff', '#4f34bc', 'star'],
    comet: ['#80b5ff', '#6628d2', 'globe'], shield: ['#65e2ce', '#155378', 'shield'],
    diamond: ['#ff71d8', '#7920ba', 'diamond'], heart: ['#ff78b8', '#691578', 'heart'],
    club: ['#65e2ce', '#155378', 'club'], crown: ['#ffd899', '#aa4f3e', 'crown'],
    phoenix: ['#ffad86', '#8d2ebd', 'fire'], wolf: ['#a0ccff', '#32449a', 'shield'],
    orbit: ['#80b5ff', '#6628d2', 'globe'], legend: ['#ffda9c', '#845329', 'crown'],
    master: ['#ece2ff', '#9160ef', 'star']
  };
  let avatarId = 0;
  function avatar(profile, className = '', showLevel = false) {
    const preset = String(profile.avatar || 'spade');
    const palette = identityPalette[preset] || identityPalette.spade;
    const unique = `progression-identity-${++avatarId}`;
    const frame = ['classic', 'violet', 'electric', 'gold', 'legend', 'master', 'neon', 'silver', 'rookie', 'challenger', 'strategist'].includes(profile.frame) ? profile.frame : 'classic';
    return `<span class="progression-avatar progression-frame-${frame} ${className}" style="--identity-light:${palette[0]};--identity-dark:${palette[1]}" aria-label="Avatar de ${escape(profile.name)}">
      <svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><defs>
        <radialGradient id="${unique}-bg" cx="35%" cy="20%" r="90%"><stop stop-color="${palette[1]}"/><stop offset=".6" stop-color="#111127"/><stop offset="1" stop-color="#060615"/></radialGradient>
        <linearGradient id="${unique}-metal" x1="20%" y1="0" x2="90%" y2="100%"><stop stop-color="#fff"/><stop offset=".4" stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient>
      </defs><circle cx="50" cy="50" r="48" fill="url(#${unique}-bg)"/>
      <path d="M5 76 33 10 96 53M3 52 71 7 93 85" stroke="${palette[0]}" opacity=".16"/>
      <path d="m50 9 31 19v37L50 86 19 65V28Z" fill="${palette[1]}" fill-opacity=".13" stroke="url(#${unique}-metal)" stroke-opacity=".65"/>
      <g transform="translate(32 21) scale(1.5)" fill="url(#${unique}-metal)" stroke="${palette[0]}" stroke-width=".4">${paths[palette[2]]}</g>
      <text x="50" y="80" text-anchor="middle" fill="#f6efff" font-family="Arial, sans-serif" font-size="15" font-weight="600" letter-spacing="2">${escape(initials(profile.name))}</text></svg>
      ${showLevel ? `<span class="progression-level" title="Niveau ${integer(profile.level) || 1}">${integer(profile.level) || 1}</span>` : ''}
    </span>`;
  }

  function progressBar(profile, compact = false) {
    const value = clamp(profile.xpProgress);
    return `<div class="progression-xp ${compact ? 'progression-xp-compact' : ''}">
      <div class="progression-xp-label"><span>Niveau ${integer(profile.level) || 1}</span><span>${escape(profile.tierTitle || 'Rookie')}</span></div>
      <div class="progression-progress" role="progressbar" aria-label="Progression du niveau" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}" aria-valuetext="${num(profile.xpInLevel)} sur ${num(profile.xpToNextLevel)} XP"><span style="width:${value}%"></span></div>
      <span class="progression-xp-count">${num(profile.xpInLevel)} / ${num(profile.xpToNextLevel)} XP</span>
    </div>`;
  }

  function button(action, label, iconName = '', attributes = '', className = '') {
    return `<button type="button" class="progression-button ${className}" data-progression-action="${action}" ${attributes}>${iconName ? icon(iconName) : ''}<span>${label}</span></button>`;
  }
  function metric(label, value, iconName, color = 'violet', extra = '') {
    return `<div class="progression-metric progression-tone-${color}">${icon(iconName)}<div><span>${label}</span><strong ${extra}>${value}</strong></div></div>`;
  }

  async function request(event, payload = {}) {
    if (state.socket?._progressionReady) await state.socket._progressionReady;
    return new Promise((resolve, reject) => {
      if (!state.socket || state.socket.connected === false) return reject(new Error('Connexion indisponible. Réessayez dans un instant.'));
      const timer = setTimeout(() => reject(new Error('Le serveur met trop de temps à répondre. Réessayez.')), 10000);
      try {
        state.socket.emit(event, payload, response => {
          clearTimeout(timer);
          if (!response || !response.ok) return reject(new Error(response?.error || 'Impossible de charger votre progression.'));
          resolve(response.data);
        });
      } catch (error) { clearTimeout(timer); reject(error); }
    });
  }

  function header() {
    const me = state.dashboard?.profile;
    return `<header class="progression-topbar">
      <button type="button" class="progression-brand" data-progression-action="close" aria-label="IMDCX, retour au jeu">${icon('spade')}<span>IMDCX<small>— POKER —</small></span></button>
      <p class="progression-motto">STRATÉGIE · PASSION · PROGRESSION</p>
      <div class="progression-account">${me ? `<button type="button" data-progression-action="profile" class="progression-account-button">${avatar(me)}<span>${escape(me.name)}<small>Niv. ${integer(me.level) || 1}</small></span></button>` : '<span class="progression-muted">Votre espace compétitif</span>'}
        <button type="button" class="progression-icon-button" data-progression-action="close" aria-label="Fermer et revenir au jeu" title="Revenir au jeu">${icon('close')}</button>
      </div>
    </header>`;
  }
  function sidebar() {
    const items = [['close', 'Jouer', 'home'], ['leaderboard', 'Classement', 'trophy'], ['profile', 'Mon profil', 'profile'], ['daily', 'Défis du jour', 'target']];
    return `<aside class="progression-sidebar"><nav aria-label="Navigation progression">${items.map(([view, label, itemIcon]) => `<button type="button" data-progression-action="${view}" class="progression-nav-item ${state.view === view ? 'is-active' : ''}" ${state.view === view ? 'aria-current="page"' : ''}>${icon(itemIcon)}<span>${label}</span>${view === 'daily' && availableRewards() ? '<i class="progression-nav-dot" aria-label="Récompense disponible"></i>' : ''}</button>`).join('')}</nav>
      <p class="progression-sidebar-note">PLUS QU’UN JEU<br>UNE COMMUNAUTÉ</p></aside>`;
  }
  function availableRewards() {
    return Boolean(state.dashboard?.login?.claimable || state.dashboard?.missions?.some(mission => mission.claimable));
  }
  function shellMarkup() {
    return `${header()}${sidebar()}<main class="progression-main" id="progression-main" tabindex="-1"><div id="progression-page"></div></main><p class="progression-action-status" id="progression-action-status" role="status" aria-live="polite"></p>`;
  }
  function createShell() {
    if (state.shell) return;
    const shell = document.createElement('section');
    shell.id = 'imdcx-progression';
    shell.className = 'progression-app';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-label', 'Espace compétitif IMDCX');
    shell.tabIndex = -1;
    state.focusBefore = document.activeElement;
    state.overflowBefore = document.body.style.overflow;
    state.inertBefore = Array.from(document.body.children).filter(element => !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName) && element.id !== 'progression-toasts' && element.id !== 'progression-choice').map(element => [element, element.inert]);
    state.inertBefore.forEach(([element]) => { element.inert = true; });
    document.body.style.overflow = 'hidden';
    document.body.appendChild(shell);
    state.shell = shell;
    shell.addEventListener('click', onClick);
    shell.addEventListener('submit', onSubmit);
    shell.innerHTML = shellMarkup();
    shell.focus({ preventScroll: true });
  }

  function title(kicker, heading, subtitle) {
    return `<div class="progression-page-heading"><span class="progression-eyebrow">${kicker}</span><h1 id="progression-page-title">${heading}</h1><p>${subtitle}</p></div>`;
  }
  function errorContent(message) {
    return `<div class="progression-empty progression-error" role="alert">${icon('refresh')}<h2>Connexion à votre progression</h2><p>${escape(message)}</p>${button('refresh', 'Réessayer', 'refresh')}</div>`;
  }
  function loadingContent() {
    return '<div class="progression-loading" role="status"><span class="progression-loader"></span><p>Chargement de votre espace compétitif…</p></div>';
  }
  function render() {
    if (!state.shell) return;
    const rankingPositions = new Map(Array.from(state.shell.querySelectorAll('[data-ranking-player]'), element => [element.dataset.rankingPlayer, element.getBoundingClientRect().top]));
    const scrollTop = state.shell.querySelector('.progression-main')?.scrollTop || 0;
    const focused = document.activeElement;
    const focusAction = state.shell.contains(focused) ? focused.dataset.progressionAction : null;
    const focusId = focused?.dataset.id;
    state.shell.innerHTML = shellMarkup();
    const page = state.shell.querySelector('#progression-page');
    page.innerHTML = state.error ? errorContent(state.error) : state.loading ? loadingContent() : state.view === 'leaderboard' ? leaderboardView() : state.view === 'profile' ? profileView() : dailyView();
    state.shell.setAttribute('aria-labelledby', state.shell.querySelector('#progression-page-title') ? 'progression-page-title' : '');
    state.shell.querySelector('.progression-main').scrollTop = scrollTop;
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) state.shell.querySelectorAll('[data-ranking-player]').forEach(element => {
      const previous = rankingPositions.get(element.dataset.rankingPlayer);
      const offset = previous - element.getBoundingClientRect().top;
      if (Number.isFinite(offset) && Math.abs(offset) > 2) element.animate([{ transform: `translateY(${offset}px)` }, { transform: 'translateY(0)' }], { duration: 450, easing: 'cubic-bezier(.2,.7,.3,1)' });
    });
    if (focusAction && !state.loading) {
      const candidates = Array.from(state.shell.querySelectorAll('[data-progression-action]'));
      const replacement = candidates.find(element => element.dataset.progressionAction === focusAction && (!focusId || element.dataset.id === focusId));
      (replacement || state.shell.querySelector('.progression-main')).focus({ preventScroll: true });
    }
  }

  function leaderboardView() {
    const data = state.ranking || { rows: [] };
    const rows = Array.isArray(data.rows) ? data.rows : [];
    const me = state.dashboard?.profile;
    const tabs = [['global', 'Global', 'globe'], ['weekly', 'Hebdomadaire', 'calendar'], ['friends', 'Amis', 'friends']];
    const top = rows.slice(0, 3);
    const other = rows.slice(3);
    let content = `${title(state.category === 'weekly' ? 'NOUVELLE SEMAINE · NOUVELLE CHANCE' : 'IMDCX · COMPÉTITION', 'CLASSEMENT', 'Les meilleurs aujourd’hui, les légendes demain')}
      <div class="progression-tabs" role="tablist" aria-label="Catégorie de classement">${tabs.map(([category, label, tabIcon]) => `<button type="button" class="progression-tab ${state.category === category ? 'is-active' : ''}" data-progression-action="category" data-category="${category}" role="tab" id="progression-tab-${category}" aria-selected="${state.category === category}" aria-controls="progression-ranking" tabindex="${state.category === category ? '0' : '-1'}">${icon(tabIcon)}<span>${label}</span></button>`).join('')}</div>
      <section id="progression-ranking" role="tabpanel" aria-labelledby="progression-tab-${state.category}">
      <div class="progression-ranking-note">${state.category === 'weekly' ? `Points gagnés cette semaine · nouveau classement ${formatDate(data.resetAt)}` : state.category === 'friends' ? 'Vous et les joueurs de votre liste d’amis' : 'Chaque victoire construit votre place dans le classement'}</div>`;
    if (top.length) {
      content += `<div class="progression-podium" aria-label="Les trois premiers">${top.map((profile, index) => podiumCard(profile, index + 1)).join('')}</div>`;
    } else {
      content += `<div class="progression-empty progression-podium-empty">${icon('trophy')}<h2>${state.category === 'friends' ? 'Votre cercle de compétition commence ici' : 'Le podium attend ses premiers joueurs'}</h2><p>${state.category === 'friends' ? 'Ajoutez un joueur depuis votre profil pour suivre votre progression ensemble.' : 'Jouez pour gagner vos premiers points et prendre votre place.'}</p>${button(state.category === 'friends' ? 'profile' : 'close', state.category === 'friends' ? 'Gérer mes amis' : 'Revenir au jeu', state.category === 'friends' ? 'friends' : 'arrow')}</div>`;
    }
    content += `<div class="progression-ranking-bottom"><section class="progression-board progression-panel" aria-label="Suite du classement">
      <div class="progression-board-heading"><h2>${state.category === 'weekly' ? 'La course de la semaine' : 'Dans la compétition'}</h2><span>${num(rows.length)} joueur${rows.length === 1 ? '' : 's'}</span></div>
      ${other.length ? `<div class="progression-table-wrap"><table class="progression-table"><thead><tr><th scope="col">#</th><th scope="col">Joueur</th><th scope="col">Niveau</th><th scope="col" aria-sort="descending">Points ↓</th><th scope="col">Taux de victoire</th><th scope="col">Victoires</th><th scope="col">Multiplicateur</th></tr></thead><tbody>${other.map(profile => rankingRow(profile)).join('')}</tbody></table></div>` : `<div class="progression-board-empty">${icon('spade')}<p>${top.length ? 'Les prochaines places sont à prendre.' : 'Les résultats apparaîtront après les premières parties.'}</p></div>`}
      ${data.me && !rows.some(profile => sameName(profile.name, data.me.name)) ? `<div class="progression-own-standing"><span>Votre position</span><strong>#${num(data.me.rank)} · ${escape(data.me.name)}</strong><span>${num(state.category === 'weekly' ? data.me.weeklyPoints : data.me.points)} points</span></div>` : ''}
      </section>${me ? personalPanel(me) : ''}</div></section>`;
    return content;
  }
  function podiumCard(profile, position) {
    const points = state.category === 'weekly' ? profile.weeklyPoints : profile.points;
    return `<button type="button" class="progression-podium-card progression-place-${position} ${profile.isMe ? 'is-me' : ''}" data-progression-action="profile" data-name="${escape(profile.name)}" aria-label="${position}${position === 1 ? 'er' : 'e'}, ${escape(profile.name)}, ${num(points)} points, voir le profil">
      <span class="progression-crown">${icon('crown')}<b>${position}</b></span>
      <span class="progression-podium-person">${avatar(profile, 'progression-avatar-podium', true)}
      <strong class="progression-podium-name">${escape(profile.name)}${profile.isMe ? '<small>VOUS</small>' : ''}</strong>
      <strong class="progression-podium-score">${num(points)}</strong><span class="progression-podium-label">POINTS</span>
      <span class="progression-podium-details"><span>${num(profile.wins)} victoires</span><span>${num(profile.winRate)} %</span><span>x${num(profile.multiplier || 1)}</span></span></span>
      <span class="progression-podium-base"><span>${escape(profile.title || profile.tierTitle || 'Rookie')}</span></span>
    </button>`;
  }
  function rankingRow(profile) {
    const mine = profile.isMe || sameName(profile.name, ownName());
    return `<tr data-ranking-player="${escape(profile.name)}" class="${mine ? 'is-me' : ''}"><td><strong>${num(profile.rank)}</strong></td>
      <td><button type="button" class="progression-player-link" data-progression-action="profile" data-name="${escape(profile.name)}">${avatar(profile)}<span>${escape(profile.name)}${mine ? '<small class="progression-you">VOUS</small>' : ''}</span></button></td>
      <td><span class="progression-level-inline">${integer(profile.level) || 1}</span></td>
      <td class="progression-points-cell">${num(state.category === 'weekly' ? profile.weeklyPoints : profile.points)}</td><td>${num(profile.winRate)} %</td><td>${num(profile.wins)}</td><td class="progression-multiplier-text">x${num(profile.multiplier || 1)}</td></tr>`;
  }
  function personalPanel(profile) {
    return `<aside class="progression-personal progression-panel"><h2>MES STATISTIQUES</h2><div class="progression-personal-identity">${avatar(profile, '', true)}<div><strong>${escape(profile.name)}</strong>${progressBar(profile, true)}</div></div>
      <div class="progression-metrics">${metric('Points', num(profile.points), 'trophy', 'gold', 'data-progression-points')}${metric('Taux de victoire', `${num(profile.winRate)} %`, 'chart', 'blue')}${metric('Série actuelle', `${num(profile.currentStreak)} victoire${integer(profile.currentStreak) === 1 ? '' : 's'}`, 'fire', 'pink')}${metric('Meilleur multiplicateur', `x${num(profile.bestMultiplier || 1)}`, 'bolt', 'violet')}</div>
      ${button('profile', 'Voir mon profil', 'arrow', '', 'progression-primary')}
      ${availableRewards() ? button('daily', 'Récompenses disponibles', 'gift', '', 'progression-reward-link') : ''}
      ${pendingBanner()}</aside>`;
  }

  function formatDate(value) {
    if (!value) return 'lundi à 00 h UTC';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : `le ${shortDate.format(date)} à 00 h UTC`;
  }
  function pendingBanner() {
    const choice = state.dashboard?.pendingMultiplier;
    if (choice) return `<div class="progression-pending">${icon('bolt')}<p>Un x${num(choice.newMultiplier)} vous attend.</p>${button('choice', 'Choisir', '', '', 'progression-button-small')}</div>`;
    if (state.dashboard?.wheelAvailable) return `<div class="progression-pending">${icon('bolt')}<p>Votre victoire a débloqué un tour de roue.</p>${button('resume-wheel', 'Tourner la roue', '', '', 'progression-button-small')}</div>`;
    if (state.dashboard?.finalAvailable) return `<div class="progression-pending">${icon('trophy')}<p>Votre place en finale vous attend.</p>${button('resume-final', 'Rejoindre la finale', '', '', 'progression-button-small')}</div>`;
    return '';
  }

  function profileView() {
    const profile = state.profile || state.dashboard?.profile;
    if (!profile) return errorContent('Ce profil n’est pas encore disponible.');
    const mine = sameName(profile.name, ownName());
    const isFriend = state.dashboard?.profile?.friends?.some(name => sameName(name, profile.name));
    const achievements = Array.isArray(profile.achievements) ? profile.achievements : [];
    return `${title('IDENTITÉ · AMBITION · PROGRESSION', mine ? 'MON PROFIL' : 'PROFIL JOUEUR', 'Le talent se joue. La légende se construit.')}
      <div class="progression-profile-layout"><section class="progression-player-card progression-panel">
        <span class="progression-player-card-kicker">IMDCX · PLAYER CARD</span>${avatar(profile, 'progression-avatar-hero', true)}
        <h2>${escape(profile.name)}</h2><span class="progression-title-badge">${escape(profile.title || profile.tierTitle || 'Rookie')}</span>
        ${progressBar(profile)}<div class="progression-player-card-score"><span>POINTS COMPÉTITIFS</span><strong data-progression-points>${num(profile.points)}</strong><small>${profile.rank ? `Rang global #${num(profile.rank)}` : 'En route vers le classement'}</small></div>
        <div class="progression-player-card-bottom"><span>${icon('shield')} ${num(profile.gamesPlayed)} parties</span><span>${icon('bolt')} x${num(profile.multiplier || 1)} actif</span></div>
        ${mine ? button('daily', 'Mes défis du jour', 'target', '', 'progression-primary') : button('friend', isFriend ? 'Retirer de mes amis' : 'Ajouter à mes amis', 'friends', `data-name="${escape(profile.name)}" data-add="${!isFriend}"`, 'progression-primary')}
      </section><div class="progression-profile-content"><section class="progression-panel progression-career"><div class="progression-section-heading"><div><span class="progression-kicker">CHAQUE PARTIE COMPTE</span><h2>Votre parcours compétitif</h2></div>${icon('chart')}</div>
        <div class="progression-metrics progression-metrics-career">${metric('Victoires', num(profile.wins), 'trophy', 'gold')}${metric('Taux de victoire', `${num(profile.winRate)} %`, 'chart', 'blue')}${metric('Meilleure série', `${num(profile.bestStreak)} victoire${integer(profile.bestStreak) === 1 ? '' : 's'}`, 'fire', 'pink')}${metric('Meilleur multiplicateur', `x${num(profile.bestMultiplier || 1)}`, 'bolt', 'violet')}</div>
        <div class="progression-career-notes"><span>Série actuelle <strong>${num(profile.currentStreak)}</strong></span><span>Cette semaine <strong>${num(profile.weeklyPoints)} pts</strong></span><span>Expérience totale <strong>${num(profile.xp)} XP</strong></span></div>${mine ? pendingBanner() : ''}
      </section><section class="progression-panel progression-achievements"><div class="progression-section-heading"><div><span class="progression-kicker">LES PREUVES DU PARCOURS</span><h2>Succès & distinctions</h2></div><span class="progression-count">${achievements.filter(item => item.unlocked).length} / ${achievements.length}</span></div>
        <div class="progression-achievement-grid">${achievements.length ? achievements.map(achievement => achievementCard(achievement)).join('') : '<p class="progression-muted">Les premiers succès se débloquent en jouant.</p>'}</div>
      </section>${mine ? customization(profile) : ''}</div></div>
      ${mine ? friendsSection(profile) : ''}`;
  }
  function achievementCard(achievement) {
    return `<article class="progression-achievement ${achievement.unlocked ? 'is-unlocked' : 'is-locked'}"><span class="progression-achievement-emblem">${icon(achievement.unlocked ? 'shield' : 'lock')}</span><div><h3>${escape(achievement.name)}</h3><p>${escape(achievement.description)}</p><span>${achievement.unlocked ? 'DÉBLOQUÉ' : `+${num(achievement.xp)} XP`}${achievement.frame ? ' · Cadre' : ''}</span></div></article>`;
  }

  const cosmeticLabels = { spade: 'As de pique', ace: 'As de pique', diamond: 'Diamant', heart: 'Cœur', club: 'Trèfle', crown: 'Couronne', phoenix: 'Phénix', wolf: 'Gardien', orbit: 'Orbite', classic: 'Classique', violet: 'Améthyste', electric: 'Électrique', gold: 'Or', legend: 'Légende', master: 'Maître', neon: 'Néon', silver: 'Argent', rookie: 'Rookie', challenger: 'Challenger', strategist: 'Stratège' };
  const cosmeticValue = item => typeof item === 'object' ? String(item.id || item.value || item.name || '') : String(item);
  const cosmeticLabel = item => typeof item === 'object' ? item.name || item.label || cosmeticValue(item) : cosmeticLabels[item] || item;
  function customization(profile) {
    const unlocked = profile.unlocked || {};
    const avatars = Array.isArray(unlocked.avatars) && unlocked.avatars.length ? unlocked.avatars : [profile.avatar || 'spade'];
    const frames = Array.isArray(unlocked.frames) && unlocked.frames.length ? unlocked.frames : [profile.frame || 'classic'];
    const titles = Array.isArray(unlocked.titles) && unlocked.titles.length ? unlocked.titles : [profile.title || profile.tierTitle || 'Rookie'];
    return `<section class="progression-panel progression-customize"><div class="progression-section-heading"><div><span class="progression-kicker">VOTRE SIGNATURE À LA TABLE</span><h2>Personnaliser mon identité</h2></div>${icon('spade')}</div>
      <form data-progression-form="customize"><fieldset><legend>Avatar</legend><div class="progression-avatar-options">${avatars.map(item => { const value = cosmeticValue(item); return `<label class="progression-avatar-option"><input type="radio" name="avatar" value="${escape(value)}" ${profile.avatar === value ? 'checked' : ''}>${avatar({ ...profile, avatar: value })}<span>${escape(cosmeticLabel(item))}</span></label>`; }).join('')}</div></fieldset>
      <div class="progression-form-row"><label>Cadre<select name="frame">${frames.map(item => { const value = cosmeticValue(item); return `<option value="${escape(value)}" ${profile.frame === value ? 'selected' : ''}>${escape(cosmeticLabel(item))}</option>`; }).join('')}</select></label><label>Titre<select name="title">${titles.map(item => { const value = cosmeticValue(item); return `<option value="${escape(value)}" ${profile.title === value ? 'selected' : ''}>${escape(cosmeticLabel(item))}</option>`; }).join('')}</select></label></div>
      <div class="progression-customize-footer"><p>Progressez pour débloquer de nouveaux cadres et titres.</p><button type="submit" class="progression-button progression-primary">${icon('check')}<span>Enregistrer</span></button></div></form></section>`;
  }
  function friendsSection(profile) {
    const friends = Array.isArray(profile.friends) ? profile.friends : [];
    return `<section class="progression-panel progression-friends"><div class="progression-section-heading"><div><span class="progression-kicker">PROGRESSER ENSEMBLE</span><h2>Mes amis <span class="progression-count">${friends.length}</span></h2></div>${button('category', 'Voir le classement amis', 'friends', 'data-category="friends"', 'progression-button-small')}</div>
      <form data-progression-form="friend" class="progression-friend-form"><label for="progression-friend-name">Ajouter un joueur à ma liste</label><div><input id="progression-friend-name" name="friendName" placeholder="Pseudo exact du joueur" maxlength="32" autocomplete="off" required><button type="submit" class="progression-button">${icon('friends')}<span>Ajouter</span></button></div><p>Suivez ses résultats dans votre classement amis.</p></form>
      <div class="progression-friend-list">${friends.length ? friends.map(name => `<div class="progression-friend">${button('profile', escape(name), 'profile', `data-name="${escape(name)}"`, 'progression-text-button')}${button('friend', 'Retirer', '', `data-name="${escape(name)}" data-add="false"`, 'progression-button-small')}</div>`).join('') : '<p class="progression-muted">Votre liste est vide. Ajoutez un joueur pour commencer.</p>'}</div></section>`;
  }

  function dailyView() {
    const dashboard = state.dashboard;
    if (!dashboard) return errorContent('Votre progression n’est pas disponible.');
    const profile = dashboard.profile;
    const login = dashboard.login || {};
    const missions = Array.isArray(dashboard.missions) ? dashboard.missions : [];
    const rewards = Array.isArray(login.rewards) ? login.rewards : [];
    return `${title('UN RENDEZ-VOUS AVEC VOTRE PROGRESSION', 'DÉFIS DU JOUR', 'Jouez avec ambition. Revenez avec une longueur d’avance.')}
      <div class="progression-daily-summary progression-panel"><div>${avatar(profile, '', true)}<div><strong>${escape(profile.name)}</strong><span>${escape(profile.tierTitle || 'Rookie')}</span></div></div>${progressBar(profile)}<div class="progression-login-streak">${icon('fire')}<strong>${num(login.streak)}<span>jour${integer(login.streak) === 1 ? '' : 's'} de connexion</span></strong></div></div>
      <section class="progression-panel progression-login"><div class="progression-section-heading"><div><span class="progression-kicker">LA RÉGULARITÉ EST RÉCOMPENSÉE</span><h2>Votre rendez-vous quotidien</h2></div><span class="progression-reset">Renouvellement ${formatDate(login.resetAt || dashboard.resetAt)}</span></div>
        <div class="progression-login-days">${rewards.map((xp, index) => loginDay(login, index + 1, xp)).join('')}</div>
        <div class="progression-login-footer"><p>${login.claimedToday ? 'Récompense du jour récupérée. À demain pour la suite.' : `Votre récompense du jour : +${num(login.rewardXp)} XP.`}</p>${button('claim-login', login.claimedToday ? 'Récupérée aujourd’hui' : `Récupérer +${num(login.rewardXp)} XP`, login.claimedToday ? 'check' : 'gift', login.claimable ? '' : 'disabled', 'progression-primary')}</div>
      </section>
      <div class="progression-section-heading progression-missions-heading"><div><span class="progression-kicker">DES OBJECTIFS POUR AVANCER</span><h2>Missions quotidiennes</h2></div><span class="progression-count">${missions.filter(mission => mission.claimed).length} / ${missions.length} récupérées</span></div>
      <div class="progression-missions">${missions.map((mission, index) => missionCard(mission, index)).join('')}</div>
      <div class="progression-daily-bottom"><section class="progression-panel progression-reward-history"><div class="progression-section-heading"><div><span class="progression-kicker">VOS DERNIERS GAINS</span><h2>Journal de progression</h2></div>${icon('chart')}</div>${rewardHistory(dashboard.recentRewards)}</section>
      <section class="progression-panel progression-rules"><span class="progression-kicker">COMPRENDRE VOS POINTS</span><h2>Chaque étape a sa récompense</h2><ol><li><span>Élimination précoce</span><strong>0 pt</strong></li><li><span>Finaliste de la table</span><strong>+10 pts</strong></li><li><span>Vainqueur de la table</span><strong>+30 pts</strong></li><li><span>Victoire du duel final</span><strong>+50 pts</strong></li></ol><p>Une table remportée puis un duel gagné rapportent <strong>80 points de base</strong>. Le multiplicateur actif s’applique aux récompenses compétitives suivantes.</p><p>Une défaite retire le multiplicateur. Vos points restent acquis. Chaque niveau gagné ajoute <strong>10 points</strong>.</p>${pendingBanner()}</section></div>`;
  }
  function loginDay(login, day, xp) {
    const current = Math.max(1, integer(login.day));
    const claimed = day < current || (day === current && login.claimedToday);
    const active = day === current && !login.claimedToday;
    return `<div class="progression-login-day ${claimed ? 'is-claimed' : ''} ${active ? 'is-today' : ''} ${day === 7 ? 'is-final' : ''}"><span>JOUR ${day}</span>${icon(claimed ? 'check' : day === 7 ? 'crown' : 'gift')}<strong>+${num(xp)} XP</strong><small>${claimed ? 'Récupéré' : active ? 'Aujourd’hui' : day === 7 ? 'Récompense finale' : 'À venir'}</small></div>`;
  }
  function missionCard(mission, index) {
    const percent = clamp((Number(mission.progress) / Math.max(1, Number(mission.target))) * 100);
    return `<article class="progression-mission progression-panel ${mission.claimable ? 'is-complete' : ''} ${mission.claimed ? 'is-claimed' : ''}"><div class="progression-mission-top"><span class="progression-mission-icon">${icon(['spade', 'trophy', 'fire'][index % 3])}</span><span class="progression-mission-xp">+${num(mission.xp)} XP</span></div><h3>${escape(mission.title)}</h3><p>${escape(mission.description)}</p><div class="progression-mission-progress"><span>${mission.claimed ? 'Mission accomplie' : mission.completed ? 'Objectif atteint' : 'Votre progression'}</span><strong>${num(Math.min(Number(mission.progress) || 0, Number(mission.target) || 0))} / ${num(mission.target)}</strong></div><div class="progression-progress" role="progressbar" aria-label="${escape(mission.title)}" aria-valuemin="0" aria-valuemax="${integer(mission.target)}" aria-valuenow="${Math.min(integer(mission.progress), integer(mission.target))}"><span style="width:${percent}%"></span></div>${button('claim-mission', mission.claimed ? 'Récompense récupérée' : mission.claimable ? 'Récupérer ma récompense' : 'En cours', mission.claimed ? 'check' : 'gift', `data-id="${escape(mission.id)}" ${mission.claimable ? '' : 'disabled'}`, mission.claimable ? 'progression-primary' : '')}</article>`;
  }
  function rewardLabel(receipt) {
    if (receipt.type === 'login' || receipt.type === 'daily-login') return 'Connexion quotidienne';
    if (receipt.type === 'mission') return 'Mission accomplie';
    if (receipt.type === 'achievement') return 'Succès débloqué';
    if (receipt.type === 'level') return 'Nouveau niveau';
    const kind = receipt.kind === 'table' ? 'Table de poker' : receipt.kind === 'duel' ? 'Duel final' : receipt.kind === 'battle' ? 'Bataille' : 'Partie';
    return receipt.type === 'game' ? `${kind} · ${receipt.won ? 'victoire' : 'terminée'}` : receipt.label || 'Récompense de progression';
  }
  function rewardHistory(receipts) {
    const items = Array.isArray(receipts) ? receipts.slice(0, 8) : [];
    return items.length ? `<ul class="progression-history">${items.map(receipt => `<li>${icon(receipt.won ? 'trophy' : receipt.type === 'game' ? 'spade' : 'gift')}<div><strong>${escape(rewardLabel(receipt))}</strong><span>${receipt.competitivePoints ? `${num(receipt.basePoints)} pts × ${num(receipt.multiplier || 1)}${receipt.levelPoints ? ` · +${num(receipt.levelPoints)} pts de niveau` : ''}` : receipt.levelPoints ? `+${num(receipt.levelPoints)} pts de niveau` : 'Votre parcours continue'}</span></div><p>${receipt.points ? `<strong>+${num(receipt.points)} pts</strong>` : ''}<span>+${num(receipt.xp)} XP</span></p></li>`).join('')}</ul>` : '<div class="progression-history-empty"><p>Vos prochaines récompenses apparaîtront ici.</p><span>Une partie, une mission, un nouveau niveau : chaque progrès compte.</span></div>';
  }

  async function loadPage(full = true) {
    const id = ++state.requestId;
    state.error = '';
    if (full) { state.loading = true; render(); }
    try {
      const name = state.getName();
      const dashboard = await request('progression:get', name ? { name } : {});
      if (id !== state.requestId) return;
      state.dashboard = dashboard;
      if (state.view === 'leaderboard') {
        const data = await request('progression:leaderboard', { category: state.category });
        if (id !== state.requestId) return;
        state.ranking = data;
      } else if (state.view === 'profile') {
        const target = state.targetName || dashboard?.profile?.name;
        if (sameName(target, dashboard?.profile?.name)) state.profile = dashboard.profile;
        else {
          const profile = await request('progression:profile', { name: target });
          if (id !== state.requestId) return;
          state.profile = profile;
        }
      }
      state.loading = false;
      render();
    } catch (error) {
      if (id !== state.requestId) return;
      state.error = error.message;
      state.loading = false;
      render();
    }
  }
  function setStatus(message, isError = false) {
    const status = state.shell?.querySelector('#progression-action-status');
    if (status) { status.textContent = message; status.classList.toggle('is-error', isError); }
    else if (message) showToast(message, isError ? 'error' : 'reward');
  }
  async function mutate(event, payload, trigger, successText) {
    if (state.busy) return;
    state.busy = true;
    if (trigger) trigger.disabled = true;
    setStatus('Enregistrement…');
    try {
      const data = await request(event, payload);
      const dashboard = data?.dashboard || (data?.profile ? data : null);
      if (dashboard) state.dashboard = dashboard;
      if (data?.receipt) receiptToast(data.receipt);
      if (state.shell) await loadPage(false);
      setStatus(successText || 'Votre progression est à jour.');
    } catch (error) { setStatus(error.message, true); }
    finally { state.busy = false; if (trigger?.isConnected) trigger.disabled = false; }
  }
  function onClick(event) {
    const trigger = event.target.closest('[data-progression-action]');
    if (!trigger || trigger.disabled) return;
    const action = trigger.dataset.progressionAction;
    if (action === 'close') return close();
    if (action === 'leaderboard' || action === 'daily') return open(action);
    if (action === 'profile') return open('profile', trigger.dataset.name || ownName());
    if (action === 'category') {
      state.category = ['global', 'weekly', 'friends'].includes(trigger.dataset.category) ? trigger.dataset.category : 'global';
      return open('leaderboard');
    }
    if (action === 'refresh') return loadPage();
    if (action === 'claim-mission') return mutate('progression:claimMission', { id: trigger.dataset.id }, trigger, 'Récompense de mission récupérée.');
    if (action === 'claim-login') return mutate('progression:claimLogin', {}, trigger, 'Récompense quotidienne récupérée.');
    if (action === 'friend') return mutate('progression:friend', { name: trigger.dataset.name, add: trigger.dataset.add === 'true' }, trigger, trigger.dataset.add === 'true' ? 'Joueur ajouté à votre liste d’amis.' : 'Joueur retiré de votre liste.');
    if (action === 'choice') return showMultiplierChoice(state.dashboard?.pendingMultiplier);
    if (action === 'resume-wheel' || action === 'resume-final') {
      close();
      document.dispatchEvent(new CustomEvent('imdcx:resume-reward', { detail: action }));
    }
  }
  function onSubmit(event) {
    const form = event.target.closest('[data-progression-form]');
    if (!form) return;
    event.preventDefault();
    const data = new FormData(form);
    const trigger = form.querySelector('[type="submit"]');
    if (form.dataset.progressionForm === 'customize') return mutate('progression:customize', { avatar: data.get('avatar'), frame: data.get('frame'), title: data.get('title') }, trigger, 'Votre identité a été mise à jour.');
    if (form.dataset.progressionForm === 'friend') {
      const name = String(data.get('friendName') || '').trim();
      if (name) mutate('progression:friend', { name, add: true }, trigger, 'Joueur ajouté à votre liste d’amis.');
    }
  }

  function close() {
    if (state.choice) closeChoice();
    if (!state.shell) return;
    ++state.requestId;
    state.shell.remove();
    state.shell = null;
    document.body.style.overflow = state.overflowBefore;
    state.inertBefore.forEach(([element, inert]) => { if (element.isConnected) element.inert = inert; });
    state.inertBefore = [];
    if (state.focusBefore?.isConnected) state.focusBefore.focus({ preventScroll: true });
  }
  function open(view = 'leaderboard', targetName = '') {
    state.view = ['leaderboard', 'profile', 'daily'].includes(view) ? view : 'leaderboard';
    state.targetName = state.view === 'profile' ? targetName : '';
    createShell();
    state.shell.querySelector('.progression-main')?.scrollTo(0, 0);
    return loadPage().then(() => state.shell?.querySelector('.progression-main')?.scrollTo(0, 0));
  }
  function refresh() { return loadPage(Boolean(state.shell && !state.dashboard)); }

  function showToast(message, type = 'reward', detail = '') {
    let container = document.getElementById('progression-toasts');
    if (!container) {
      container = document.createElement('div');
      container.id = 'progression-toasts';
      container.className = 'progression-toasts';
      container.setAttribute('role', 'status');
      container.setAttribute('aria-live', 'polite');
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `progression-toast progression-toast-${type}`;
    toast.innerHTML = `${icon(type === 'level' ? 'crown' : type === 'error' ? 'refresh' : 'gift')}<div><strong>${escape(message)}</strong>${detail ? `<span>${escape(detail)}</span>` : ''}</div>`;
    container.appendChild(toast);
    while (container.children.length > 3) container.firstElementChild.remove();
    setTimeout(() => toast.remove(), type === 'level' ? 9000 : 6500);
  }
  function receiptToast(receipt) {
    if (receipt.id && state.receipts.has(receipt.id)) return;
    if (receipt.id) state.receipts.add(receipt.id);
    if (state.receipts.size > 150) state.receipts.delete(state.receipts.values().next().value);
    const detail = [receipt.points ? `+${num(receipt.points)} points` : '', receipt.xp ? `+${num(receipt.xp)} XP` : ''].filter(Boolean).join(' · ');
    if (Number(receipt.level) > Number(receipt.previousLevel)) showToast(`Niveau ${num(receipt.level)} atteint`, 'level', detail);
    else if (detail) showToast(rewardLabel(receipt), 'reward', detail);
    if (receipt.newAchievements?.length) {
      const names = receipt.newAchievements.map(item => typeof item === 'string' ? item : item.name || item.id).join(' · ');
      showToast('Nouvelle distinction débloquée', 'level', names);
    }
    state.shell?.querySelectorAll('[data-progression-points]').forEach(element => {
      element.classList.remove('progression-earned');
      requestAnimationFrame(() => element.classList.add('progression-earned'));
    });
  }
  function onUpdated(payload) {
    const previousPoints = state.dashboard?.profile?.points;
    if (payload?.dashboard) {
      state.dashboard = payload.dashboard;
      if (state.choice && !payload.dashboard.pendingMultiplier) closeChoice();
      if (state.view === 'profile' && (!state.targetName || sameName(state.targetName, payload.dashboard.profile?.name))) state.profile = payload.dashboard.profile;
      if (state.shell && !state.loading) {
        render();
        if (state.view === 'leaderboard') loadPage(false);
      }
    }
    if (payload?.receipt) {
      receiptToast(payload.receipt);
      animatePoints(previousPoints, payload.dashboard?.profile?.points);
    }
  }
  function animatePoints(previous, next) {
    if (!Number.isFinite(previous) || !Number.isFinite(next) || next <= previous || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (state.view === 'profile' && state.targetName && !sameName(state.targetName, ownName())) return;
    const elements = Array.from(state.shell?.querySelectorAll('[data-progression-points]') || []);
    const started = performance.now();
    function tick(time) {
      const ratio = Math.min(1, (time - started) / 800);
      const value = previous + (next - previous) * (1 - Math.pow(1 - ratio, 3));
      elements.forEach(element => { if (element.isConnected) element.textContent = num(Math.round(value)); });
      if (ratio < 1 && elements.some(element => element.isConnected)) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  function bind(socket, nameOrNameGetter) {
    state.getName = typeof nameOrNameGetter === 'function' ? nameOrNameGetter : () => String(nameOrNameGetter || '');
    if (!socket || state.socket === socket) return window.IMDCXProgression;
    if (state.socket && state.listeners && typeof state.socket.off === 'function') {
      Object.entries(state.listeners).forEach(([event, listener]) => state.socket.off(event, listener));
    }
    state.socket = socket;
    state.listeners = {
      'progression:updated': onUpdated,
      'progression:rankingChanged': () => { if (state.shell && state.view === 'leaderboard' && !state.loading && !state.busy) loadPage(false); },
      connect: () => { if (state.shell) loadPage(false); },
      disconnect: () => { if (state.shell) setStatus('Connexion interrompue. Vos récompenses seront disponibles à la reconnexion.', true); }
    };
    Object.entries(state.listeners).forEach(([event, listener]) => socket.on(event, listener));
    return window.IMDCXProgression;
  }

  function showMultiplierChoice(payload) {
    const pending = payload?.pendingMultiplier || payload;
    if (!pending?.choiceId) return;
    if (state.choice) closeChoice();
    const overlay = document.createElement('div');
    overlay.id = 'progression-choice';
    overlay.className = 'progression-choice-backdrop';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'progression-choice-title');
    overlay.tabIndex = -1;
    state.choiceFocus = document.activeElement;
    state.choice = overlay;
    const otherInert = Array.from(document.body.children).filter(element => !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName) && element.id !== 'progression-toasts').map(element => [element, element.inert]);
    otherInert.forEach(([element]) => { element.inert = true; });
    overlay._inertBefore = otherInert;
    overlay.innerHTML = `<div class="progression-choice-card"><span class="progression-eyebrow">VICTOIRE COMPLÈTE · CHOIX STRATÉGIQUE</span><h2 id="progression-choice-title">La suite vous appartient.</h2><p>Choisissez le multiplicateur de vos prochaines récompenses compétitives.</p><div class="progression-choice-options"><button type="button" data-choice="keep" class="progression-choice-option"><span>VOTRE MULTIPLICATEUR</span><strong>x${num(pending.currentMultiplier || 1)}</strong><span class="progression-choice-option-label">Conserver l’actuel ${icon('shield')}</span></button><button type="button" data-choice="replace" class="progression-choice-option progression-choice-new"><span>OBTENU À LA ROUE</span><strong>x${num(pending.newMultiplier || 1)}</strong><span class="progression-choice-option-label">Choisir le nouveau ${icon('bolt')}</span></button></div><p class="progression-choice-help">Vos points restent acquis. Le multiplicateur choisi sera perdu à votre prochaine défaite.</p><p class="progression-choice-status" role="status" aria-live="polite"></p><button type="button" class="progression-text-button" data-choice="later">Décider plus tard</button></div>`;
    document.body.appendChild(overlay);
    overlay.focus({ preventScroll: true });
    overlay.addEventListener('click', async event => {
      const trigger = event.target.closest('[data-choice]');
      if (!trigger || trigger.disabled) return;
      if (trigger.dataset.choice === 'later') return closeChoice();
      const choices = overlay.querySelectorAll('button');
      choices.forEach(item => { item.disabled = true; });
      try {
        const data = await request('progression:chooseMultiplier', { choiceId: pending.choiceId, choice: trigger.dataset.choice });
        if (data?.dashboard) state.dashboard = data.dashboard;
        else if (data?.profile) state.dashboard = data;
        closeChoice();
        showToast(`Multiplicateur x${num(trigger.dataset.choice === 'keep' ? pending.currentMultiplier || 1 : pending.newMultiplier || 1)} actif`, 'reward', 'Prêt pour vos prochaines récompenses compétitives.');
        if (state.shell) loadPage(false);
      } catch (error) {
        overlay.querySelector('.progression-choice-status').textContent = error.message;
        choices.forEach(item => { item.disabled = false; });
      }
    });
  }
  function closeChoice() {
    const overlay = state.choice;
    if (!overlay) return;
    overlay._inertBefore?.forEach(([element, inert]) => { if (element.isConnected) element.inert = inert; });
    overlay.remove();
    state.choice = null;
    if (state.choiceFocus?.isConnected) state.choiceFocus.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', event => {
    const modal = state.choice || state.shell;
    if (!modal) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); return state.choice ? closeChoice() : close(); }
    if (event.key === 'Tab') {
      const items = focusables(modal);
      if (!items.length) { event.preventDefault(); return modal.focus(); }
      if (event.shiftKey && (document.activeElement === items[0] || !items.includes(document.activeElement))) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && (document.activeElement === items[items.length - 1] || !items.includes(document.activeElement))) { event.preventDefault(); items[0].focus(); }
    }
    if (!state.choice && event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const tabs = Array.from(state.shell.querySelectorAll('[role="tab"]'));
      const current = tabs.indexOf(event.target);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      state.category = tabs[next].dataset.category;
      loadPage(false).then(() => state.shell?.querySelector(`[data-category="${state.category}"]`)?.focus());
    }
  }, true);

  window.IMDCXProgression = Object.freeze({ bind, open, close, refresh, showMultiplierChoice });
})();
