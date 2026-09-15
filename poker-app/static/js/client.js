// client.js
"use strict";

let socket;
let myCardsRevealed   = false,
    mySocketId        = "",
    mySeatIndex       = null,
    revealedAllSeats  = false,
    currentGameState  = null,
    lastPhase         = null;   // Ã¢â€ Â pour dÃƒÂ©tecter revealÃ¢â€ â€™preflop
let winnerAnnounced   = false;  // empÃƒÂªche plusieurs affichages
let loserAnnounced    = false;  // idem
let overlayShown = false;
let gameMode = null;
let lastActiveIdx = null;
let lastMyStatus = null;
let timerInterval = null;
let lastTurnStartTime = null;
let lastTurnDuration = null;
let justReconnected = false;
let clientRequestedReveal = false;   // ÃƒÂ©vite dÃ¢â‚¬â„¢ÃƒÂ©mettre plusieurs fois
let _tableID = null, _match2ID = null; // on mÃƒÂ©morise pour lÃ¢â‚¬â„¢emit
let _seatStorageScope = null;
let _spectatorStorageScope = false;
let _centeredTableOnce = false;
let eliminationKey = null;
let isMatch2 = false;
let isPublicSpectator = false;
let finalSeatLockTimers = [];
let myFreezeCardLockTimers = [];
let revealPromptTimer = null;
let revealPromptDeadline = null;
let revealShownSeats = new Set();
let revealDisplayedCards = {};
let lastCompletedRevealSnapshot = null;
let myLastKnownHoleCards = null;
let centerMessageMode = null; // 'turn' | 'winner' | 'winner-final' | 'lose' | null
let endStateLocked = false;
let centerMessagePulseInterval = null;
let centerMessagePulseTimeout = null;
let turnPulseActive = false;
let lastWinnerMessage = '';
let myCardsFlipTimer = null;
let myCardsBackLockUntil = 0;
let myCardAnimHandles = [];
let myCardAnimTimers = [];
let myCardAnimRunId = 0;
const MY_CARDS_REVEAL_DELAY_DEFAULT_MS = 5000;
const MY_CARDS_REVEAL_DELAY_HYPER_MS = 3000;
function getMyCardsRevealDelayMs() {
  return String(gameMode || '').toLowerCase() === 'hyper'
    ? MY_CARDS_REVEAL_DELAY_HYPER_MS
    : MY_CARDS_REVEAL_DELAY_DEFAULT_MS;
}
const myCardFacePreloaded = new Set();
let add30NoTimeWarned = false;
let add30ClassicConfirmed = false;
let add30ConfirmResolver = null;
let sosChatActive = false;
let sosChatMessages = [];
let calcRestoreHandled = false;
let reloadRestorePending = false;
let endStatePending = null;
let suppressWinnerMessage = false;
let restoreFinalWinnerOnlyView = false;
let lockRestoredFinalView = false;
let suppressFinalReplayAfterClose = false;
let lockedFinalWinnerSeat = null;
let lockedFinalWinnerCards = null;
let revealPhaseStartedAt = null;
let deferredFinalStateTimer = null;
let finalStateDeferred = false;
let deferredFinalStateSnapshot = null;
let revealSeatShowStartedAt = null;
let hyperRevealHoldUntil = 0;
let hyperRevealHoldCards = null;
let revealFlowToken = 0;
let skipRevealAfterFreezeClose = false;
let gameOverFreezeActive = false;
let gameOverFrozenSnapshot = null;
let pendingLiveSpectatorState = null;
let lockedEndStateSnapshot = null;
let lateJoinFinishedState = false;
let allInClashPrevSeats = new Set();
let allInClashOverlayTimeout = null;
let allInClashOverlayPhaseTimers = [];
let allInVsSparkAnimations = [];
let allInVsSparkStyleInjected = false;
let betBeamStyleInjected = false;
let betBeamFxLayer = null;
let betBeamFxSeq = 0;
let betChipThrowStyleInjected = false;
let betChipThrowLayer = null;
let betChipThrowSeq = 0;
let betChipPileLayer = null;
let betChipStackCounts = [0, 0, 0, 0, 0];
let betChipPileSnapshot = [];
let pendingBetChipPileAdds = [];
let betChipPileFlushTimer = null;
let initialLevelHint = '';
let fruityBgLayerEl = null;
let backgroundThemeOverride = 'auto'; // auto | forceDark | forceFruity
let backgroundToggleResizeBound = false;
let backgroundToggleReady = false;
let backgroundToggleCanShow = false;
let backgroundToggleRevealRaf = null;
let backgroundToggleLastAnchor = null;
let backgroundTransitionLayerEl = null;
let backgroundTransitionTimer = null;
const CARD_BACK_THEME_TRANSITION_MS = 720;

const THEMED_CARD_ASSETS = {
  fruity: {
    cardback: 'static/images/cardback1.png',
    customC: 'static/images/custom_C.png',
    customD: 'static/images/custom_D.png',
    customI: 'static/images/custom_I.png',
    customM: 'static/images/custom_M.png',
    customX: 'static/images/custom_X.png'
  },
  dark: {
    cardback: 'static/images/cardback2.png',
    customC: 'static/images/custom_C1.png',
    customD: 'static/images/custom_D1.png',
    customI: 'static/images/custom_I1.png',
    customM: 'static/images/custom_M1.png',
    customX: 'static/images/custom_X1.png'
  }
};

function isFruityThemeActive() {
  return !!document.body?.classList.contains('tier-fruity-bg');
}

function getCurrentThemeCardAssets() {
  return isFruityThemeActive() ? THEMED_CARD_ASSETS.fruity : THEMED_CARD_ASSETS.dark;
}

function resolveThemeAssetPath(relPath, absolute = false) {
  if (!relPath) return '';
  const normalized = String(relPath).replace(/\\/g, '/');
  if (!absolute) return normalized;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return `${window.location.origin}/${normalized.replace(/^\/+/, '')}`;
}

function getThemeCardAssetPath(kind, { absolute = false } = {}) {
  const assets = getCurrentThemeCardAssets();
  const relPath = assets?.[kind] || THEMED_CARD_ASSETS.fruity[kind] || '';
  return resolveThemeAssetPath(relPath, absolute);
}

function getThemeCardAssetCssUrl(kind, { absolute = false } = {}) {
  const path = getThemeCardAssetPath(kind, { absolute });
  return path ? `url("${path}")` : 'none';
}

function applyThemeCardAssetVariables() {
  const root = document.documentElement;
  if (!root) return;
  root.style.setProperty('--theme-cardback-image', getThemeCardAssetCssUrl('cardback', { absolute: true }));
  root.style.setProperty('--theme-custom-c-image', getThemeCardAssetCssUrl('customC', { absolute: true }));
  root.style.setProperty('--theme-custom-d-image', getThemeCardAssetCssUrl('customD', { absolute: true }));
  root.style.setProperty('--theme-custom-i-image', getThemeCardAssetCssUrl('customI', { absolute: true }));
  root.style.setProperty('--theme-custom-m-image', getThemeCardAssetCssUrl('customM', { absolute: true }));
  root.style.setProperty('--theme-custom-x-image', getThemeCardAssetCssUrl('customX', { absolute: true }));
}

function findThemeBackTransitionOverlay(host) {
  if (!host) return null;
  return Array.from(host.children || []).find((child) => child.classList?.contains('card-back-theme-transition')) || null;
}

function captureThemeBackgroundSnapshot(style) {
  if (!style) return null;
  return {
    backgroundImage: (style.backgroundImage && style.backgroundImage !== 'none') ? style.backgroundImage : '',
    backgroundSize: style.backgroundSize || 'cover',
    backgroundPosition: style.backgroundPosition || 'center',
    backgroundRepeat: style.backgroundRepeat || 'no-repeat'
  };
}

function snapshotsMatch(a, b) {
  if (!a || !b) return false;
  return a.backgroundImage === b.backgroundImage
    && a.backgroundSize === b.backgroundSize
    && a.backgroundPosition === b.backgroundPosition
    && a.backgroundRepeat === b.backgroundRepeat;
}

function animateThemeSurfaceSwap(host, applyNextSurfaceStyles) {
  if (!host || typeof applyNextSurfaceStyles !== 'function') return;

  const computedBefore = window.getComputedStyle(host);
  const previousSnapshot = captureThemeBackgroundSnapshot(computedBefore);

  applyNextSurfaceStyles();

  const computedAfter = window.getComputedStyle(host);
  const nextSnapshot = captureThemeBackgroundSnapshot(computedAfter);

  if (!previousSnapshot?.backgroundImage || previousSnapshot.backgroundImage === 'none') return;
  if (!nextSnapshot?.backgroundImage || nextSnapshot.backgroundImage === 'none') return;
  if (snapshotsMatch(previousSnapshot, nextSnapshot)) return;

  const existingOverlay = findThemeBackTransitionOverlay(host);
  if (existingOverlay) existingOverlay.remove();

  if (computedAfter.position === 'static') {
    host.style.position = 'relative';
  }

  const overlay = document.createElement('span');
  overlay.className = 'card-back-theme-transition';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.style.backgroundImage = previousSnapshot.backgroundImage;
  overlay.style.backgroundSize = previousSnapshot.backgroundSize;
  overlay.style.backgroundPosition = previousSnapshot.backgroundPosition;
  overlay.style.backgroundRepeat = previousSnapshot.backgroundRepeat;
  host.appendChild(overlay);

  host.classList.remove('card-back-theme-swap');
  void host.offsetWidth;
  host.classList.add('card-back-theme-swap');

  requestAnimationFrame(() => {
    overlay.classList.add('is-active');
  });

  window.setTimeout(() => {
    overlay.remove();
    host.classList.remove('card-back-theme-swap');
  }, CARD_BACK_THEME_TRANSITION_MS + 80);
}

function animateCardBackThemeSwap(host, nextBackgroundImage, { important = false } = {}) {
  if (!host || !nextBackgroundImage) return;

  animateThemeSurfaceSwap(host, () => {
    if (important) host.style.setProperty('background-image', nextBackgroundImage, 'important');
    else host.style.backgroundImage = nextBackgroundImage;
  });
}

function refreshVisibleCardFacesForTheme() {
  if (typeof internal_setCard !== 'function') return;
  document.querySelectorAll('.card.revealed[data-card-code], .boardcard.revealed[data-card-code]').forEach((cardEl) => {
    const code = String(cardEl.dataset.cardCode || '').trim();
    if (!code || code === 'blinded') return;
    const computedOpacity = Number.parseFloat(window.getComputedStyle(cardEl).opacity || '1');
    const folded = Number.isFinite(computedOpacity) && computedOpacity < 0.75;
    animateThemeSurfaceSwap(cardEl, () => {
      internal_setCard(cardEl, code, folded, false);
    });
  });
}

function scheduleFruityFaceRefreshBurst() {
  refreshVisibleCardFacesForTheme();
  requestAnimationFrame(() => refreshVisibleCardFacesForTheme());
  window.setTimeout(() => refreshVisibleCardFacesForTheme(), 120);
}

window.getThemeCardAssetPath = getThemeCardAssetPath;
window.getThemeCardAssetCssUrl = getThemeCardAssetCssUrl;
applyThemeCardAssetVariables();

function getLevelHintStorageKey() {
  if (_match2ID) return `bgLevel_match2_${_match2ID}`;
  if (_tableID) return `bgLevel_table_${_tableID}`;
  return null;
}

const TABLE_IMAGE_BY_LEVEL = Object.freeze({
  Q1: '/static/images/poker_table_rose.png',
  Q2: '/static/images/poker_table_bleu.png',
  T1: '/static/images/poker_table_vert.png',
  T2: '/static/images/poker_table_jaune.png',
  T3: '/static/images/poker_table_orange.png',
  T4: '/static/images/poker_table_rouge.png'
});

function normalizeTableLevel(levelRaw) {
  const level = String(levelRaw || '').trim().toUpperCase();
  return TABLE_IMAGE_BY_LEVEL[level] ? level : '';
}

function applyTableBackgroundForLevel(levelRaw) {
  const tableEl = document.getElementById('poker_table');
  if (!tableEl) return;
  const normalizedLevel = normalizeTableLevel(levelRaw);
  const imageUrl = TABLE_IMAGE_BY_LEVEL[normalizedLevel] || TABLE_IMAGE_BY_LEVEL.T1;
  tableEl.style.setProperty('background-image', `url("${imageUrl}")`, 'important');
}

function getBackgroundOverrideStorageKey() {
  const viewScope = _spectatorStorageScope
    ? 'spectator'
    : (Number.isInteger(_seatStorageScope) ? `seat_${_seatStorageScope}` : null);
  if (_match2ID && viewScope) return `bgOverride_match2_${_match2ID}_${viewScope}`;
  if (_tableID && viewScope) return `bgOverride_table_${_tableID}_${viewScope}`;
  if (_match2ID) return `bgOverride_match2_${_match2ID}`;
  if (_tableID) return `bgOverride_table_${_tableID}`;
  return null;
}

function loadBackgroundOverride() {
  const key = getBackgroundOverrideStorageKey();
  if (!key) return 'auto';
  try {
    const raw = String(localStorage.getItem(key) || '').trim();
    if (raw === 'forceDark' || raw === 'forceFruity') return raw;
  } catch (e) {}
  return 'auto';
}

function storeBackgroundOverride(mode) {
  const key = getBackgroundOverrideStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, mode);
  } catch (e) {}
}

function loadStoredLevelHint() {
  const key = getLevelHintStorageKey();
  if (!key) return '';
  try {
    return normalizeTableLevel(localStorage.getItem(key));
  } catch (e) {
    return '';
  }
}

function storeLevelHint(levelRaw) {
  const lvl = normalizeTableLevel(levelRaw);
  if (!lvl) return;
  const key = getLevelHintStorageKey();
  if (!key) return;
  try {
    localStorage.setItem(key, lvl);
  } catch (e) {}
}
const BET_CHIP_STACK_MAX_VISIBLE = 8;
const BET_CHIP_TEXTURES = [
  '/static/images/jetonbleu.png',
  '/static/images/jetonjaune.png',
  '/static/images/jetonrouge.png',
  '/static/images/jetonvert.png',
  '/static/images/jetonviolet.png'
];
let betChipTexturesPreloaded = false;
let betChipFxPrewarmed = false;
let revealSeatFireworkLockUntil = 0;
let foldDropStyleInjected = false;
let riverRevealBoostStyleInjected = false;
let checkPassStyleInjected = false;
let callPulseStyleInjected = false;
let betPulseStyleInjected = false;
let allInRedStyleInjected = false;
let handTornadoStyleInjected = false;
let handTornadoRunId = 0;
let handTornadoCleanupTimer = null;
let handTornadoBoardBacksBlockedUntil = 0;
let potBreakdownStyleInjected = false;
let potBreakdownPanelOpen = false;
let lastResolvedHandBreakdown = null;
const HAND_TORNADO_SWALLOW_MS = 1200;
const HAND_TORNADO_TOTAL_MS = 6800;

function ensureAllInVsSparkStyle() {
  if (allInVsSparkStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'allin-vs-spark-style';
  style.textContent = `
    #allin-vs-only-overlay .allin-vs-spark-layer .allin-vs-spark{
      position: absolute;
      left: 50%;
      top: 50%;
      border-radius: 999px;
      pointer-events: none;
      opacity: 0;
      transform: translate(-50%, -50%) rotate(var(--a, 0deg)) translate(var(--r, 120px)) scale(.2);
      animation: allinVsSparkBurst var(--dur, 1100ms) ease-out var(--delay, 0ms) infinite;
      will-change: transform, opacity;
    }
    @keyframes allinVsSparkBurst{
      0%{
        opacity: 0;
        transform: translate(-50%, -50%) rotate(var(--a, 0deg)) translate(calc(var(--r, 120px) - 10px)) scale(.15);
      }
      34%{
        opacity: 1;
        transform: translate(-50%, -50%) rotate(var(--a, 0deg)) translate(var(--r, 120px)) scale(1);
      }
      100%{
        opacity: 0;
        transform: translate(-50%, -50%) rotate(var(--a, 0deg)) translate(calc(var(--r, 120px) + 14px)) scale(.2);
      }
    }
    @keyframes allinVsSparkSpin{
      from{ transform: translate(-50%, -50%) rotate(0deg); }
      to{ transform: translate(-50%, -50%) rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
  allInVsSparkStyleInjected = true;
}

function ensureAllInClashOverlay() {
  let overlay = document.getElementById('allin-vs-only-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'allin-vs-only-overlay';
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="allin-vs-inner">
      <div class="allin-vs-spark-layer"></div>
      <div class="allin-vs-disc">
        <div class="allin-vs-text">VS</div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function triggerAllInClashOverlay() {
  if (window.IMDCXMotion) return; // Individual all-in feedback replaces the long VS overlay.
  const overlay = ensureAllInClashOverlay();
  if (!overlay) return;
  ensureAllInVsSparkStyle();

  const inner = overlay.querySelector('.allin-vs-inner');
  const sparkLayer = overlay.querySelector('.allin-vs-spark-layer');
  const disc = overlay.querySelector('.allin-vs-disc');
  const vs = overlay.querySelector('.allin-vs-text');
  const tableEl = document.getElementById('poker_table');
  const tableRect = tableEl?.getBoundingClientRect?.();
  if (!tableRect || tableRect.width <= 0 || tableRect.height <= 0) return;

  const tableWidth = Math.max(1, Math.round(tableRect.width));
  const tableHeight = Math.max(1, Math.round(tableRect.height));
  const discPx = Math.round(Math.max(140, Math.min(tableWidth * 0.42, tableHeight * 0.72, 360)));
  const vsPx = Math.round(Math.max(88, Math.min(discPx * 0.5, 240)));

  overlay.style.setProperty('position', 'fixed', 'important');
  overlay.style.setProperty('left', `${Math.round(tableRect.left)}px`, 'important');
  overlay.style.setProperty('top', `${Math.round(tableRect.top)}px`, 'important');
  overlay.style.setProperty('right', 'auto', 'important');
  overlay.style.setProperty('bottom', 'auto', 'important');
  overlay.style.setProperty('width', `${tableWidth}px`, 'important');
  overlay.style.setProperty('height', `${tableHeight}px`, 'important');
  overlay.style.setProperty('display', 'block', 'important');
  overlay.style.setProperty('pointer-events', 'none', 'important');
  overlay.style.setProperty('z-index', '2147483000', 'important');
  overlay.style.setProperty('opacity', '1', 'important');
  overlay.style.setProperty('background', 'transparent', 'important');
  overlay.style.setProperty('contain', 'layout paint style', 'important');
  overlay.style.setProperty('overflow', 'visible', 'important');

  if (inner) {
    inner.style.setProperty('position', 'absolute', 'important');
    inner.style.setProperty('left', '50%', 'important');
    inner.style.setProperty('top', '50%', 'important');
    inner.style.setProperty('overflow', 'visible', 'important');
    inner.style.setProperty('opacity', '0', 'important');
    inner.style.setProperty('transform', 'translate(-50%, -50%) scale(0.45) rotate(-6deg)', 'important');
    inner.style.setProperty('transition', 'transform 340ms cubic-bezier(.16,.74,.18,1), opacity 300ms ease-out, filter 300ms ease-out', 'important');
    inner.style.setProperty('filter', 'blur(5px) brightness(1.35)', 'important');
    inner.style.setProperty('text-align', 'center', 'important');
  }
  if (sparkLayer) {
    sparkLayer.style.setProperty('position', 'absolute', 'important');
    sparkLayer.style.setProperty('left', '50%', 'important');
    sparkLayer.style.setProperty('top', '50%', 'important');
    sparkLayer.style.setProperty('width', `${Math.round(discPx * 1.6)}px`, 'important');
    sparkLayer.style.setProperty('height', `${Math.round(discPx * 1.6)}px`, 'important');
    sparkLayer.style.setProperty('transform', 'translate(-50%, -50%)', 'important');
    sparkLayer.style.setProperty('pointer-events', 'none', 'important');
    sparkLayer.style.setProperty('z-index', '5', 'important');
    sparkLayer.style.setProperty('opacity', '1', 'important');
    sparkLayer.style.setProperty('mix-blend-mode', 'screen', 'important');
    sparkLayer.style.setProperty('animation', 'allinVsSparkSpin 3.6s linear infinite', 'important');
  }
  if (disc) {
    disc.style.setProperty('width', `${discPx}px`, 'important');
    disc.style.setProperty('height', `${discPx}px`, 'important');
    disc.style.setProperty('max-width', `${discPx}px`, 'important');
    disc.style.setProperty('max-height', `${discPx}px`, 'important');
    disc.style.setProperty('border-radius', '9999px', 'important');
    disc.style.setProperty('display', 'flex', 'important');
    disc.style.setProperty('align-items', 'center', 'important');
    disc.style.setProperty('justify-content', 'center', 'important');
    disc.style.setProperty('border', '10px solid rgba(255, 220, 220, .96)', 'important');
    disc.style.setProperty('background', 'radial-gradient(circle at 30% 30%, rgba(255,255,255,.30), rgba(255,255,255,0) 36%), radial-gradient(circle at 50% 50%, rgba(255,92,92,1), rgba(224,32,32,1) 56%, rgba(128,0,0,1) 100%)', 'important');
    disc.style.setProperty('box-shadow', '0 0 24px rgba(255,92,92,.95), 0 0 62px rgba(255,40,40,.78), inset 0 0 0 7px rgba(120,0,0,.65), inset 0 0 24px rgba(255,190,190,.25)', 'important');
  }
  if (vs) {
    vs.style.setProperty('font-family', '"Bangers", "Montserrat", sans-serif', 'important');
    vs.style.setProperty('font-weight', '900', 'important');
    vs.style.setProperty('font-size', `${vsPx}px`, 'important');
    vs.style.setProperty('line-height', '0.78', 'important');
    vs.style.setProperty('letter-spacing', `${Math.max(3, Math.round(vsPx * 0.035))}px`, 'important');
    vs.style.setProperty('color', '#fff2f2', 'important');
    vs.style.setProperty('text-shadow', '0 0 12px rgba(255,240,240,.85), 0 0 32px rgba(255,88,88,.95), 0 0 74px rgba(255,20,20,.82), 0 10px 0 rgba(0,0,0,.8)', 'important');
    vs.style.setProperty('-webkit-text-stroke', '4px rgba(88,22,0,.96)', 'important');
  }

  allInVsSparkAnimations.forEach((anim) => anim?.cancel?.());
  allInVsSparkAnimations = [];
  if (sparkLayer) {
    const sparkCount = 22;
    while (sparkLayer.children.length > sparkCount) sparkLayer.removeChild(sparkLayer.lastChild);
    while (sparkLayer.children.length < sparkCount) {
      const spark = document.createElement('span');
      spark.className = 'allin-vs-spark';
      sparkLayer.appendChild(spark);
    }
    Array.from(sparkLayer.children).forEach((spark, idx) => {
      const angle = (360 / sparkCount) * idx;
      const radius = Math.round(discPx * (0.58 + Math.random() * 0.20));
      const size = Math.round(Math.max(4, discPx * (0.028 + Math.random() * 0.015)));
      spark.style.setProperty('position', 'absolute', 'important');
      spark.style.setProperty('left', '50%', 'important');
      spark.style.setProperty('top', '50%', 'important');
      spark.style.setProperty('width', `${size}px`, 'important');
      spark.style.setProperty('height', `${size}px`, 'important');
      spark.style.setProperty('border-radius', '999px', 'important');
      spark.style.setProperty('background', 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,160,160,.96) 40%, rgba(255,56,56,.12) 100%)', 'important');
      spark.style.setProperty('box-shadow', '0 0 10px rgba(255,210,210,.98), 0 0 26px rgba(255,56,56,.94)', 'important');
      spark.style.setProperty('--a', `${angle}deg`, 'important');
      spark.style.setProperty('--r', `${radius}px`, 'important');
      spark.style.setProperty('--dur', `${900 + Math.round(Math.random() * 620)}ms`, 'important');
      spark.style.setProperty('--delay', `${Math.round(Math.random() * 360)}ms`, 'important');
      spark.style.setProperty('animation', 'allinVsSparkBurst var(--dur) ease-out var(--delay) infinite', 'important');
      spark.style.setProperty('opacity', '1', 'important');
    });
  }
  if (allInClashOverlayTimeout) clearTimeout(allInClashOverlayTimeout);
  allInClashOverlayPhaseTimers.forEach((t) => clearTimeout(t));
  allInClashOverlayPhaseTimers = [];

  const startTimer = setTimeout(() => {
    overlay.style.setProperty('opacity', '1', 'important');
    if (inner) {
      inner.style.setProperty('opacity', '1', 'important');
      inner.style.setProperty('transform', 'translate(-50%, -50%) scale(1) rotate(0deg)', 'important');
      inner.style.setProperty('filter', 'blur(0) brightness(1)', 'important');
    }
  }, 20);

  const fadeTimer = setTimeout(() => {
    if (inner) {
      inner.style.setProperty('opacity', '0', 'important');
      inner.style.setProperty('transform', 'translate(-50%, -50%) scale(1.12) rotate(0deg)', 'important');
      inner.style.setProperty('filter', 'blur(2px) brightness(1.1)', 'important');
    }
  }, 4500);

  allInClashOverlayPhaseTimers.push(startTimer, fadeTimer);
  allInClashOverlayTimeout = setTimeout(() => {
    if (inner) {
      inner.style.setProperty('opacity', '0', 'important');
      inner.style.setProperty('transform', 'translate(-50%, -50%) scale(0.45) rotate(-6deg)', 'important');
      inner.style.setProperty('filter', 'blur(5px) brightness(1.35)', 'important');
    }
    allInClashOverlayTimeout = null;
    allInClashOverlayPhaseTimers = [];
  }, getMyCardsRevealDelayMs());
}

function isAllInLikePlayer(player) {
  if (!player) return false;
  const status = String(player.status || '').toUpperCase();
  const isHandActive = status !== 'BUST' && status !== 'WAIT' && status !== 'FOLD';
  if (!isHandActive) return false;
  return status === 'ALLIN' || ((player.bankroll | 0) === 0);
}

function ensureMySeatClass() {
  const seats = Array.from(document.querySelectorAll('.seat'));
  seats.forEach((el) => el.classList.remove('my-seat'));
  if (isPublicSpectator || !Number.isInteger(mySeatIndex)) return null;
  const mySeatEl = document.getElementById("seat" + mySeatIndex);
  if (!mySeatEl) return null;
  mySeatEl.classList.add("my-seat");

  // Remove legacy inline seat-layout overrides that can pin my cards to the seat.
  const hole = mySeatEl.querySelector('.holecards');
  const c1 = mySeatEl.querySelector('.holecard1');
  const c2 = mySeatEl.querySelector('.holecard2');
  [hole, c1, c2].forEach((el) => {
    if (!el) return;
    [
      'position',
      'left',
      'top',
      'bottom',
      'width',
      'height',
      'transform'
    ].forEach((prop) => el.style.removeProperty(prop));
  });
  return mySeatEl;
}

function updateAllInClashState(gameState, activeSeats) {
  const tableEl = document.getElementById('poker_table');
  if (!tableEl || !Array.isArray(gameState?.players)) return;

  const allInSeats = [];
  gameState.players.forEach((p, i) => {
    const inactive = p?.inactive || (Number.isInteger(activeSeats) && i >= activeSeats);
    if (inactive || !p) return;
    if (isAllInLikePlayer(p)) allInSeats.push(i);
  });

  const isClash = allInSeats.length >= 2;
  const currentSet = new Set(allInSeats);
  const prevAllInCount = allInClashPrevSeats.size;

  Array.from(tableEl.classList).forEach((cls) => {
    if (/^table-allin-count-\d+$/.test(cls)) tableEl.classList.remove(cls);
  });
  tableEl.classList.remove('table-allin-clash');
  tableEl.dataset.allinCount = String(allInSeats.length);
  if (isClash) tableEl.classList.add(`table-allin-count-${Math.min(10, allInSeats.length)}`);

  // Trigger VS only once when the all-in count crosses from <2 to >=2.
  if (isClash && prevAllInCount < 2) {
    triggerAllInClashOverlay();
  }

  if (!isClash) {
    tableEl.classList.remove('table-allin-join-pop');
    if (tableEl._allInJoinPopTimeout) {
      clearTimeout(tableEl._allInJoinPopTimeout);
      tableEl._allInJoinPopTimeout = null;
    }
  }

  document.querySelectorAll('.seat').forEach((seatEl) => {
    seatEl.classList.remove('allin-clash-member', 'allin-join-burst');
  });

  // Keep VS-only animation: no table alarm ring and no extra clash seat effects.

  allInClashPrevSeats = currentSet;
}

function ensureBetBeamStyle() {
  if (betBeamStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'bet-beam-style';
  style.textContent = `
    #bet-beam-fx-layer{
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 2147482500;
      overflow: visible;
      contain: layout paint style;
    }
    #bet-beam-fx-layer .bet-beam-core{
      fill: none;
      stroke: url(#bet-beam-grad);
      stroke-width: 5.8;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      opacity: 0;
      animation: betBeamTravel 1650ms cubic-bezier(.2,.75,.2,1) forwards;
    }
    #bet-beam-fx-layer .bet-beam-glow{
      fill: none;
      stroke: url(#bet-beam-grad-soft);
      stroke-width: 14;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      opacity: 0;
      filter: blur(1.4px);
      animation: betBeamTravel 1650ms cubic-bezier(.2,.75,.2,1) forwards;
    }
    #bet-beam-fx-layer .bet-beam-trail{
      fill: none;
      stroke: rgba(88, 248, 214, 0.72);
      stroke-width: 3.2;
      stroke-linecap: round;
      opacity: 0;
      filter: drop-shadow(0 0 8px rgba(88, 248, 214, .55));
      animation: betBeamTrailHold 2300ms ease-out forwards;
    }
    #bet-beam-fx-layer .bet-beam-ring{
      fill: none;
      stroke: rgba(71, 255, 202, 0.95);
      stroke-width: 3.2;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      animation: betBeamRing 1200ms ease-out 380ms forwards;
    }
    #bet-beam-fx-layer .pot-scoop-line{
      fill: none;
      stroke: rgba(255, 190, 232, 0.92);
      stroke-width: 7.6;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      opacity: 0;
      filter: drop-shadow(0 0 10px rgba(255, 132, 206, .68));
      animation: potScoopLineFlow 1850ms cubic-bezier(.2,.72,.18,1) forwards;
    }
    #bet-beam-fx-layer .pot-scoop-glow{
      fill: none;
      stroke: rgba(255, 132, 206, 0.34);
      stroke-width: 16.5;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      opacity: 0;
      filter: blur(1.7px);
      animation: potScoopLineFlow 1850ms cubic-bezier(.2,.72,.18,1) forwards;
    }
    #bet-beam-fx-layer .pot-scoop-rocket{
      transform-box: fill-box;
      transform-origin: center;
      pointer-events: none;
    }
    #bet-beam-fx-layer .pot-scoop-rocket-head{
      fill: #ffe9ff;
      stroke: rgba(255, 138, 208, .95);
      stroke-width: 1.4;
      filter: drop-shadow(0 0 8px rgba(255, 152, 214, .95));
    }
    #bet-beam-fx-layer .pot-scoop-rocket-shine{
      fill: rgba(255, 255, 255, .95);
      opacity: .88;
    }
    #bet-beam-fx-layer .pot-scoop-rocket-core{
      fill: rgba(255, 108, 196, .95);
      stroke: rgba(255, 194, 236, .7);
      stroke-width: .9;
    }
    #bet-beam-fx-layer .pot-scoop-flame-outer{
      fill: rgba(255, 141, 76, .86);
      filter: drop-shadow(0 0 9px rgba(255, 145, 88, .9));
      animation: potScoopFlameFlicker 170ms ease-in-out infinite alternate;
      transform-origin: center;
    }
    #bet-beam-fx-layer .pot-scoop-flame-inner{
      fill: rgba(255, 233, 146, .95);
      animation: potScoopFlameFlicker 140ms ease-in-out infinite alternate;
      transform-origin: center;
    }
    #bet-beam-fx-layer .pot-scoop-burst-core{
      fill: rgba(255, 243, 178, .98);
      stroke: rgba(255, 165, 224, .9);
      stroke-width: 1.1;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      animation: potScoopBurstCore 620ms ease-out forwards;
      filter: drop-shadow(0 0 12px rgba(255, 206, 140, .9));
    }
    #bet-beam-fx-layer .pot-scoop-burst-ray{
      fill: none;
      stroke: rgba(255, 228, 148, .98);
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      opacity: 0;
      filter: drop-shadow(0 0 8px rgba(255, 172, 232, .8));
      animation: potScoopBurstRay 920ms ease-out var(--delay, 0ms) forwards;
    }
    #bet-beam-fx-layer .pot-scoop-burst-spark{
      fill: rgba(255, 246, 184, .98);
      stroke: rgba(255, 176, 228, .92);
      stroke-width: .8;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 9px rgba(255, 186, 236, .9));
      animation: potScoopBurstSpark 980ms ease-out var(--delay, 0ms) forwards;
    }
    #bet-beam-fx-layer .seat-firework-trace{
      fill: none;
      stroke: color-mix(in oklab, var(--firework-main, #ffd447) 72%, #fff 28%);
      stroke-width: 3.8;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      opacity: 0;
      filter: drop-shadow(0 0 8px color-mix(in oklab, var(--firework-main, #ffd447) 72%, #fff 28%));
      animation: seatFireworkTraceFlow var(--trace-dur, 1300ms) cubic-bezier(.18,.76,.2,1) forwards;
    }
    #bet-beam-fx-layer .seat-firework-trace-glow{
      fill: none;
      stroke: color-mix(in oklab, var(--firework-main, #ffd447) 52%, transparent 48%);
      stroke-width: 10.4;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      opacity: 0;
      filter: blur(1.6px);
      animation: seatFireworkTraceFlow var(--trace-dur, 1300ms) cubic-bezier(.18,.76,.2,1) forwards;
    }
    #bet-beam-fx-layer .seat-firework-rocket{
      transform-box: fill-box;
      transform-origin: center;
      pointer-events: none;
    }
    #bet-beam-fx-layer .seat-firework-rocket-head{
      fill: #fff4d2;
      stroke: rgba(255, 182, 88, .95);
      stroke-width: 1.2;
      filter: drop-shadow(0 0 7px rgba(255, 188, 92, .9));
    }
    #bet-beam-fx-layer .seat-firework-rocket-core{
      fill: color-mix(in oklab, var(--firework-main, #ffd447) 66%, #fff 34%);
      stroke: rgba(255, 255, 255, .7);
      stroke-width: .8;
    }
    #bet-beam-fx-layer .seat-firework-rocket-shine{
      fill: rgba(255, 255, 255, .98);
      opacity: .92;
    }
    #bet-beam-fx-layer .seat-firework-flame-outer{
      fill: rgba(255, 146, 76, .9);
      filter: drop-shadow(0 0 10px rgba(255, 154, 84, .92));
      animation: potScoopFlameFlicker 150ms ease-in-out infinite alternate;
      transform-origin: center;
    }
    #bet-beam-fx-layer .seat-firework-flame-inner{
      fill: rgba(255, 232, 153, .98);
      animation: potScoopFlameFlicker 120ms ease-in-out infinite alternate;
      transform-origin: center;
    }
    #bet-beam-fx-layer .seat-firework-burst-core{
      fill: color-mix(in oklab, var(--firework-main, #ffd447) 58%, #fff 42%);
      stroke: color-mix(in oklab, var(--firework-accent, #48d2ff) 70%, #fff 30%);
      stroke-width: 1.2;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 14px color-mix(in oklab, var(--firework-main, #ffd447) 65%, #fff 35%));
      animation: seatFireworkBurstCore 680ms ease-out forwards;
    }
    #bet-beam-fx-layer .seat-firework-burst-ray{
      fill: none;
      stroke: color-mix(in oklab, var(--firework-main, #ffd447) 72%, #fff 28%);
      stroke-width: 2.1;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      opacity: 0;
      filter: drop-shadow(0 0 9px color-mix(in oklab, var(--firework-accent, #48d2ff) 62%, #fff 38%));
      animation: seatFireworkBurstRay 980ms ease-out var(--delay, 0ms) forwards;
    }
    #bet-beam-fx-layer .seat-firework-burst-spark{
      fill: color-mix(in oklab, var(--firework-main, #ffd447) 72%, #fff 28%);
      stroke: color-mix(in oklab, var(--firework-accent, #48d2ff) 62%, #fff 38%);
      stroke-width: .8;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 10px color-mix(in oklab, var(--firework-main, #ffd447) 60%, #fff 40%));
      animation: seatFireworkBurstSpark 1020ms ease-out var(--delay, 0ms) forwards;
    }
    #bet-beam-fx-layer .seat-firework-shockwave{
      fill: none;
      stroke: color-mix(in oklab, var(--firework-main, #ffd447) 58%, #fff 42%);
      stroke-width: 2.4;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 12px color-mix(in oklab, var(--firework-accent, #48d2ff) 64%, #fff 36%));
      animation: seatFireworkShockwave 980ms cubic-bezier(.16,.84,.25,1) var(--shock-delay, 0ms) forwards;
    }
    #bet-beam-fx-layer .seat-firework-ember{
      fill: color-mix(in oklab, var(--firework-main, #ffd447) 50%, #fff 50%);
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 8px color-mix(in oklab, var(--firework-accent, #48d2ff) 58%, #fff 42%));
      animation: seatFireworkEmber 1480ms ease-out var(--delay, 0ms) forwards;
    }
    #bet-beam-fx-layer .mobile-seat-burst-core{
      fill: color-mix(in oklab, var(--firework-main, #ffd447) 64%, #fff 36%);
      stroke: color-mix(in oklab, var(--firework-accent, #48d2ff) 66%, #fff 34%);
      stroke-width: 1.1;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 10px color-mix(in oklab, var(--firework-main, #ffd447) 60%, #fff 40%));
      animation: mobileSeatBurstCore 620ms ease-out forwards;
    }
    #bet-beam-fx-layer .mobile-seat-burst-ring{
      fill: none;
      stroke: color-mix(in oklab, var(--firework-main, #ffd447) 62%, #fff 38%);
      stroke-width: 2.2;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 8px color-mix(in oklab, var(--firework-accent, #48d2ff) 56%, #fff 44%));
      animation: mobileSeatBurstRing 680ms ease-out forwards;
    }
    #bet-beam-fx-layer .mobile-seat-burst-spark{
      fill: color-mix(in oklab, var(--firework-main, #ffd447) 74%, #fff 26%);
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 6px color-mix(in oklab, var(--firework-main, #ffd447) 58%, #fff 42%));
      animation: mobileSeatBurstSpark 700ms ease-out var(--delay, 0ms) forwards;
    }
    #bet-beam-fx-layer .mobile-seat-burst-shockwave{
      fill: none;
      stroke: color-mix(in oklab, var(--firework-main, #ffd447) 62%, #fff 38%);
      stroke-width: 2.1;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 8px color-mix(in oklab, var(--firework-accent, #48d2ff) 56%, #fff 44%));
      animation: mobileSeatShockwave 800ms ease-out forwards;
    }
    #bet-beam-fx-layer .final-win-aura{
      fill: color-mix(in oklab, var(--final-main, #ffd447) 30%, transparent 70%);
      stroke: color-mix(in oklab, var(--final-accent, #48d2ff) 70%, #fff 30%);
      stroke-width: 2.2;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 20px color-mix(in oklab, var(--final-main, #ffd447) 62%, #fff 38%));
      animation: finalWinAura 1700ms cubic-bezier(.15,.8,.24,1) forwards;
    }
    #bet-beam-fx-layer .final-win-ring{
      fill: none;
      stroke: color-mix(in oklab, var(--final-main, #ffd447) 64%, #fff 36%);
      stroke-width: 2.8;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 14px color-mix(in oklab, var(--final-accent, #48d2ff) 62%, #fff 38%));
      animation: finalWinRing 1450ms ease-out var(--delay, 0ms) forwards;
    }
    #bet-beam-fx-layer .final-win-star{
      fill: color-mix(in oklab, var(--final-main, #ffd447) 68%, #fff 32%);
      stroke: color-mix(in oklab, var(--final-accent, #48d2ff) 66%, #fff 34%);
      stroke-width: 1.4;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 12px color-mix(in oklab, var(--final-main, #ffd447) 70%, #fff 30%));
      animation: finalWinStar 1220ms cubic-bezier(.2,.8,.2,1) forwards;
    }
    #bet-beam-fx-layer .final-win-shard{
      fill: none;
      stroke: color-mix(in oklab, var(--final-main, #ffd447) 72%, #fff 28%);
      stroke-width: 2.2;
      stroke-linecap: round;
      stroke-dasharray: 1;
      stroke-dashoffset: 1;
      opacity: 0;
      filter: drop-shadow(0 0 10px color-mix(in oklab, var(--final-accent, #48d2ff) 62%, #fff 38%));
      animation: finalWinShard 1120ms ease-out var(--delay, 0ms) forwards;
    }
    #bet-beam-fx-layer .final-win-comet{
      fill: color-mix(in oklab, var(--final-main, #ffd447) 62%, #fff 38%);
      stroke: color-mix(in oklab, var(--final-accent, #48d2ff) 62%, #fff 38%);
      stroke-width: .7;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: drop-shadow(0 0 9px color-mix(in oklab, var(--final-main, #ffd447) 58%, #fff 42%));
      animation: finalWinComet 1500ms ease-out var(--delay, 0ms) forwards;
    }
    #bet-beam-fx-layer .final-win-sweep{
      fill: none;
      stroke: color-mix(in oklab, var(--final-accent, #48d2ff) 46%, transparent 54%);
      stroke-width: 14;
      stroke-linecap: round;
      opacity: 0;
      transform-box: fill-box;
      transform-origin: center;
      filter: blur(1.2px);
      animation: finalWinSweep 980ms ease-out forwards;
    }
    @keyframes betBeamTravel{
      0%{ opacity: 0; stroke-dashoffset: 1; }
      12%{ opacity: 1; }
      78%{ opacity: 1; }
      100%{ opacity: 0; stroke-dashoffset: 0; }
    }
    @keyframes betBeamTrailHold{
      0%{ opacity: 0; }
      12%{ opacity: .35; }
      45%{ opacity: .85; }
      82%{ opacity: .7; }
      100%{ opacity: 0; }
    }
    @keyframes betBeamRing{
      0%{ opacity: 0; transform: scale(.28); }
      20%{ opacity: 1; }
      100%{ opacity: 0; transform: scale(2.4); }
    }
    @keyframes potScoopLineFlow{
      0%{ opacity: 0; stroke-dashoffset: 1; }
      18%{ opacity: .88; }
      58%{ opacity: .52; }
      100%{ opacity: 0; stroke-dashoffset: 0; }
    }
    @keyframes potScoopFlameFlicker{
      from{ transform: scale(1) translateY(0); }
      to{ transform: scale(.84, 1.18) translateY(1px); }
    }
    @keyframes potScoopBurstCore{
      0%{ opacity: 0; transform: scale(.2); }
      25%{ opacity: 1; transform: scale(1); }
      100%{ opacity: 0; transform: scale(1.8); }
    }
    @keyframes potScoopBurstRay{
      0%{ opacity: 0; stroke-dashoffset: 1; }
      16%{ opacity: 1; }
      100%{ opacity: 0; stroke-dashoffset: 0; }
    }
    @keyframes potScoopBurstSpark{
      0%{
        opacity: 0;
        transform: translate(0, 0) scale(.25);
      }
      18%{
        opacity: 1;
      }
      100%{
        opacity: 0;
        transform: translate(var(--dx, 0px), var(--dy, 0px)) scale(1);
      }
    }
    @keyframes seatFireworkTraceFlow{
      0%{ opacity: 0; stroke-dashoffset: 1; }
      14%{ opacity: .9; }
      72%{ opacity: .7; }
      100%{ opacity: 0; stroke-dashoffset: 0; }
    }
    @keyframes seatFireworkBurstCore{
      0%{ opacity: 0; transform: scale(.2); }
      22%{ opacity: 1; transform: scale(1); }
      100%{ opacity: 0; transform: scale(2); }
    }
    @keyframes seatFireworkBurstRay{
      0%{ opacity: 0; stroke-dashoffset: 1; }
      15%{ opacity: 1; }
      100%{ opacity: 0; stroke-dashoffset: 0; }
    }
    @keyframes seatFireworkBurstSpark{
      0%{
        opacity: 0;
        transform: translate(0, 0) scale(.2);
      }
      18%{
        opacity: 1;
      }
      100%{
        opacity: 0;
        transform: translate(var(--dx, 0px), var(--dy, 0px)) scale(1.05);
      }
    }
    @keyframes seatFireworkShockwave{
      0%{
        opacity: 0;
        transform: scale(.26);
      }
      16%{
        opacity: .95;
      }
      100%{
        opacity: 0;
        transform: scale(var(--shock-scale, 2.4));
      }
    }
    @keyframes seatFireworkEmber{
      0%{
        opacity: 0;
        transform: translate(0, 0) scale(.1);
      }
      20%{
        opacity: 1;
      }
      100%{
        opacity: 0;
        transform: translate(var(--dx, 0px), var(--dy, 0px)) scale(.9);
      }
    }
    @keyframes mobileSeatBurstCore{
      0%{ opacity: 0; transform: scale(.28); }
      28%{ opacity: 1; transform: scale(1); }
      100%{ opacity: 0; transform: scale(1.56); }
    }
    @keyframes mobileSeatBurstRing{
      0%{ opacity: 0; transform: scale(.35); }
      22%{ opacity: .9; }
      100%{ opacity: 0; transform: scale(1.9); }
    }
    @keyframes mobileSeatBurstSpark{
      0%{
        opacity: 0;
        transform: translate(0, 0) scale(.3);
      }
      22%{
        opacity: 1;
      }
      100%{
        opacity: 0;
        transform: translate(var(--dx, 0px), var(--dy, 0px)) scale(.95);
      }
    }
    @keyframes mobileSeatShockwave{
      0%{ opacity: 0; transform: scale(.24); }
      20%{ opacity: .86; }
      100%{ opacity: 0; transform: scale(var(--m-shock-scale, 2.2)); }
    }
    @keyframes finalWinAura{
      0%{ opacity: 0; transform: scale(.2); }
      26%{ opacity: .95; transform: scale(1.05); }
      100%{ opacity: 0; transform: scale(2.55); }
    }
    @keyframes finalWinRing{
      0%{ opacity: 0; transform: scale(.28); }
      20%{ opacity: 1; }
      100%{ opacity: 0; transform: scale(var(--ring-scale, 2.4)); }
    }
    @keyframes finalWinStar{
      0%{ opacity: 0; transform: scale(.22) rotate(-22deg); }
      30%{ opacity: .96; transform: scale(1) rotate(0deg); }
      100%{ opacity: 0; transform: scale(1.75) rotate(36deg); }
    }
    @keyframes finalWinShard{
      0%{ opacity: 0; stroke-dashoffset: 1; }
      16%{ opacity: 1; }
      100%{ opacity: 0; stroke-dashoffset: 0; }
    }
    @keyframes finalWinComet{
      0%{ opacity: 0; transform: translate(0, 0) scale(.18); }
      18%{ opacity: 1; }
      100%{ opacity: 0; transform: translate(var(--dx, 0px), var(--dy, 0px)) scale(1.02); }
    }
    @keyframes finalWinSweep{
      0%{ opacity: 0; transform: scale(.4) rotate(0deg); }
      24%{ opacity: .9; }
      100%{ opacity: 0; transform: scale(1.6) rotate(var(--sweep-rot, 100deg)); }
    }
    .seat.winner-mobile-seat-hit .name-chips{
      animation: mobileWinnerSeatPulse 760ms ease-out;
    }
    .seat.winner-grand-hit .name-chips{
      animation: grandWinnerSeatPulse 1340ms cubic-bezier(.12,.84,.24,1);
    }
    .seat.winner-final-cinematic-hit .name-chips{
      animation: winnerFinalCinematicPulse 1900ms cubic-bezier(.12,.82,.2,1);
    }
    @keyframes mobileWinnerSeatPulse{
      0%{
        filter: brightness(1);
        box-shadow: 0 0 0 rgba(255, 201, 91, 0);
      }
      30%{
        filter: brightness(1.24);
        box-shadow: 0 0 16px rgba(255, 201, 91, .72), 0 0 28px rgba(76, 224, 255, .38);
      }
      100%{
        filter: brightness(1);
        box-shadow: 0 0 0 rgba(255, 201, 91, 0);
      }
    }
    @keyframes grandWinnerSeatPulse{
      0%{
        filter: brightness(1);
        box-shadow: 0 0 0 rgba(255, 214, 111, 0), 0 0 0 rgba(72, 210, 255, 0);
      }
      26%{
        filter: brightness(1.4);
        box-shadow: 0 0 22px rgba(255, 214, 111, .92), 0 0 46px rgba(72, 210, 255, .65);
      }
      62%{
        filter: brightness(1.2);
        box-shadow: 0 0 16px rgba(255, 214, 111, .48), 0 0 30px rgba(72, 210, 255, .34);
      }
      100%{
        filter: brightness(1);
        box-shadow: 0 0 0 rgba(255, 214, 111, 0), 0 0 0 rgba(72, 210, 255, 0);
      }
    }
    @keyframes winnerFinalCinematicPulse{
      0%{
        filter: brightness(1) saturate(1);
        box-shadow: 0 0 0 rgba(255, 218, 114, 0), 0 0 0 rgba(72, 210, 255, 0);
      }
      24%{
        filter: brightness(1.56) saturate(1.22);
        box-shadow: 0 0 30px rgba(255, 218, 114, .98), 0 0 64px rgba(72, 210, 255, .74);
      }
      56%{
        filter: brightness(1.3) saturate(1.16);
        box-shadow: 0 0 22px rgba(255, 218, 114, .66), 0 0 42px rgba(72, 210, 255, .5);
      }
      100%{
        filter: brightness(1) saturate(1);
        box-shadow: 0 0 0 rgba(255, 218, 114, 0), 0 0 0 rgba(72, 210, 255, 0);
      }
    }
    .seat.bet-beam-origin-flash .name-chips{
      animation: betBeamSeatFlash 1300ms ease-out;
    }
    .seat.pot-scoop-target .name-chips{
      animation: potScoopSeatHit 1100ms ease-out;
    }
    @keyframes betBeamSeatFlash{
      0%{
        box-shadow: 0 0 0 rgba(46,255,188,0);
        filter: brightness(1);
      }
      40%{
        box-shadow: 0 0 24px rgba(46,255,188,.95), 0 0 54px rgba(0,184,255,.5);
        filter: brightness(1.35);
      }
      100%{
        box-shadow: 0 0 0 rgba(46,255,188,0);
        filter: brightness(1);
      }
    }
    @keyframes potScoopSeatHit{
      0%{
        filter: brightness(1);
        box-shadow: 0 0 0 rgba(255,122,204,0);
      }
      35%{
        filter: brightness(1.25);
        box-shadow: 0 0 18px rgba(255,122,204,.68), 0 0 36px rgba(255,122,204,.35);
      }
      100%{
        filter: brightness(1);
        box-shadow: 0 0 0 rgba(255,122,204,0);
      }
    }
    #pot.bet-beam-pot-hit{
      animation: betBeamPotHit 1300ms ease-out;
    }
    #pot.bet-beam-pot-hit #total-pot{
      animation: betBeamPotTextPop 1300ms ease-out;
    }
    @keyframes betBeamPotHit{
      0%{ filter: brightness(1) saturate(1); }
      40%{ filter: brightness(1.5) saturate(1.2); }
      100%{ filter: brightness(1) saturate(1); }
    }
    @keyframes betBeamPotTextPop{
      0%{ transform: scale(1); text-shadow: none; }
      40%{ transform: scale(1.1); text-shadow: 0 0 16px rgba(97,255,213,.8); }
      100%{ transform: scale(1); text-shadow: none; }
    }
  `;
  document.head.appendChild(style);
  betBeamStyleInjected = true;
}

function getFxViewportSize() {
  const vv = window.visualViewport;
  return {
    width: Math.max(1, Math.round(vv?.width || window.innerWidth || 1)),
    height: Math.max(1, Math.round(vv?.height || window.innerHeight || 1))
  };
}

function syncBetBeamFxLayerViewport(layer) {
  if (!layer) return;
  const viewport = getFxViewportSize();
  layer.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
  layer.setAttribute('width', String(viewport.width));
  layer.setAttribute('height', String(viewport.height));
  layer.style.width = `${viewport.width}px`;
  layer.style.height = `${viewport.height}px`;
}

function ensureBetBeamFxLayer() {
  if (betBeamFxLayer && document.body.contains(betBeamFxLayer)) {
    syncBetBeamFxLayerViewport(betBeamFxLayer);
    return betBeamFxLayer;
  }

  ensureBetBeamStyle();
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.id = 'bet-beam-fx-layer';
  syncBetBeamFxLayerViewport(svg);
  svg.setAttribute('aria-hidden', 'true');

  const defs = document.createElementNS(ns, 'defs');

  const grad = document.createElementNS(ns, 'linearGradient');
  grad.id = 'bet-beam-grad';
  grad.setAttribute('x1', '0%');
  grad.setAttribute('y1', '0%');
  grad.setAttribute('x2', '100%');
  grad.setAttribute('y2', '0%');
  grad.innerHTML = `
    <stop offset="0%" stop-color="rgba(57, 251, 191, 0.05)" />
    <stop offset="18%" stop-color="rgba(57, 251, 191, 0.96)" />
    <stop offset="72%" stop-color="rgba(50, 224, 255, 0.95)" />
    <stop offset="100%" stop-color="rgba(50, 224, 255, 0.1)" />
  `;

  const soft = document.createElementNS(ns, 'linearGradient');
  soft.id = 'bet-beam-grad-soft';
  soft.setAttribute('x1', '0%');
  soft.setAttribute('y1', '0%');
  soft.setAttribute('x2', '100%');
  soft.setAttribute('y2', '0%');
  soft.innerHTML = `
    <stop offset="0%" stop-color="rgba(57, 251, 191, 0.0)" />
    <stop offset="20%" stop-color="rgba(57, 251, 191, 0.5)" />
    <stop offset="78%" stop-color="rgba(50, 224, 255, 0.42)" />
    <stop offset="100%" stop-color="rgba(50, 224, 255, 0.0)" />
  `;
  defs.appendChild(grad);
  defs.appendChild(soft);
  svg.appendChild(defs);

  document.body.appendChild(svg);
  betBeamFxLayer = svg;
  return betBeamFxLayer;
}

function ensureBetChipThrowStyle() {
  if (betChipThrowStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'bet-chip-throw-style';
  style.textContent = `
    #bet-chip-throw-layer{
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      overflow: visible;
      z-index: 2;
      contain: layout paint style;
    }
    #bet-chip-throw-layer .bet-chip-throw{
      position: fixed;
      left: 0;
      top: 0;
      width: var(--chip-size, 24px);
      height: var(--chip-size, 24px);
      border-radius: 999px;
      pointer-events: none;
      will-change: transform, opacity, filter;
      transform: translate3d(-9999px, -9999px, 0);
      background: var(--chip-image, none) center / cover no-repeat;
      border: none;
      box-shadow: none;
      filter: none;
    }
    #bet-chip-pile-layer{
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      overflow: visible;
      z-index: 40;
      contain: layout paint style;
    }
    body.is-reveal #bet-chip-throw-layer{
      display: none !important;
    }
    body.is-reveal #bet-chip-pile-layer{
      z-index: 2 !important;
    }
    body.is-reveal :is(#poker_table, .poker-table){
      z-index: 12000 !important;
    }
    body.is-reveal #action-options{
      z-index: 12050 !important;
      pointer-events: none !important;
    }
    body.is-reveal :is(#poker_table, .poker-table) .seat{
      z-index: 12000 !important;
    }
    body.is-reveal :is(#poker_table, .poker-table) .seat .holecards,
    body.is-reveal :is(#poker_table, .poker-table) .seat .holecards .card,
    body.is-reveal :is(#poker_table, .poker-table) .seat .holecards .card::after{
      z-index: 12010 !important;
    }
    #center-message-zone.turn{
      z-index: 1200 !important;
    }
    #center-message-zone.winner,
    #center-message-zone.winner-final,
    #center-message-zone.lose{
      z-index: 20020 !important;
    }
    #bet-chip-pile-layer .bet-chip-pile-chip{
      position: absolute;
      left: 0;
      top: 0;
      width: var(--chip-size, 42px);
      height: var(--chip-size, 42px);
      border-radius: 999px;
      pointer-events: none;
      background: var(--chip-image, none) center / cover no-repeat;
      box-shadow: 0 2px 4px rgba(0,0,0,.38);
      filter: saturate(1.08) contrast(1.08);
      will-change: transform, opacity;
      opacity: 1;
    }
    #bet-chip-pile-layer .bet-chip-pile-base{
      position: absolute;
      left: 0;
      top: 0;
      width: var(--w, 120px);
      height: var(--h, 36px);
      border-radius: 999px;
      pointer-events: none;
      background: radial-gradient(ellipse at 50% 45%, rgba(0,0,0,.36) 0%, rgba(0,0,0,.22) 52%, rgba(0,0,0,0) 78%);
      filter: blur(.3px);
      opacity: .88;
      z-index: 80;
    }
    #bet-chip-throw-layer .bet-chip-impact{
      position: fixed;
      left: 0;
      top: 0;
      width: 12px;
      height: 12px;
      border-radius: 999px;
      pointer-events: none;
      background: radial-gradient(circle, rgba(255,245,196,.95), rgba(255,195,107,.28) 62%, transparent 72%);
      box-shadow: 0 0 14px rgba(255,196,96,.78);
      transform: translate3d(-9999px, -9999px, 0) scale(.3);
      opacity: 0;
      animation: betChipImpact 440ms ease-out forwards;
    }
    .seat.bet-chip-throw-origin .name-chips{
      animation: betChipSeatOrigin 620ms cubic-bezier(.2,.76,.2,1);
    }
    .seat.bet-chip-throw-hit .bet{
      animation: betChipSeatHit 520ms ease-out;
    }
    @keyframes betChipImpact{
      0%{ opacity: 0; transform: translate3d(var(--ix, 0px), var(--iy, 0px), 0) scale(.2); }
      20%{ opacity: 1; }
      100%{ opacity: 0; transform: translate3d(var(--ix, 0px), var(--iy, 0px), 0) scale(2.8); }
    }
    @keyframes betChipSeatOrigin{
      0%{ filter: brightness(1); }
      45%{ filter: brightness(1.22) saturate(1.15); }
      100%{ filter: brightness(1); }
    }
    @keyframes betChipSeatHit{
      0%{ transform: translateX(-50%) scale(1); text-shadow: 0 1px 2px rgba(0,0,0,.8); }
      40%{ transform: translateX(-50%) scale(1.12); text-shadow: 0 0 16px rgba(255,210,130,.95), 0 1px 2px rgba(0,0,0,.8); }
      100%{ transform: translateX(-50%) scale(1); text-shadow: 0 1px 2px rgba(0,0,0,.8); }
    }
  `;
  document.head.appendChild(style);
  betChipThrowStyleInjected = true;
}

function ensureBetChipThrowLayer() {
  if (betChipThrowLayer && document.body.contains(betChipThrowLayer)) return betChipThrowLayer;
  ensureBetChipThrowStyle();
  const layer = document.createElement('div');
  layer.id = 'bet-chip-throw-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  betChipThrowLayer = layer;
  return betChipThrowLayer;
}

function ensureBetChipPileLayer() {
  const tableEl = document.getElementById('poker_table');
  if (betChipPileLayer && document.body.contains(betChipPileLayer)) {
    if (tableEl && betChipPileLayer.parentElement !== tableEl) {
      tableEl.appendChild(betChipPileLayer);
    }
    return betChipPileLayer;
  }
  ensureBetChipThrowStyle();
  const layer = document.createElement('div');
  layer.id = 'bet-chip-pile-layer';
  layer.setAttribute('aria-hidden', 'true');
  if (tableEl) tableEl.appendChild(layer);
  else document.body.appendChild(layer);
  betChipPileLayer = layer;
  return betChipPileLayer;
}

function ensureBetChipTexturesPreloaded() {
  if (betChipTexturesPreloaded) return;
  BET_CHIP_TEXTURES.forEach((src) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = src;
  });
  betChipTexturesPreloaded = true;
}

function prewarmBetChipFx() {
  if (betChipFxPrewarmed) return;
  ensureBetChipThrowStyle();
  ensureBetChipThrowLayer();
  ensureBetChipPileLayer();
  ensureBetChipTexturesPreloaded();
  betChipFxPrewarmed = true;
}

function getCenterPoint(el) {
  if (!el || !el.getBoundingClientRect) return null;
  const rect = el.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function getBetChipPileAnchor() {
  const potEl = document.getElementById('pot');
  const tableEl = document.getElementById('poker_table');
  const potRect = potEl?.getBoundingClientRect?.();
  if (potRect && potRect.width > 0 && potRect.height > 0) {
    return {
      x: Math.max(18, potRect.left - Math.max(62, Math.min(120, potRect.width * 0.34))),
      y: potRect.top + (potRect.height * 0.58)
    };
  }
  const tableRect = tableEl?.getBoundingClientRect?.();
  if (tableRect && tableRect.width > 0 && tableRect.height > 0) {
    return {
      x: tableRect.left + (tableRect.width * 0.37),
      y: tableRect.top + (tableRect.height * 0.56)
    };
  }
  return null;
}

function resetBetChipPile() {
  const layer = ensureBetChipPileLayer();
  betChipStackCounts = [0, 0, 0, 0, 0];
  betChipPileSnapshot = [];
  pendingBetChipPileAdds = [];
  if (betChipPileFlushTimer) {
    clearTimeout(betChipPileFlushTimer);
    betChipPileFlushTimer = null;
  }
  if (layer) layer.innerHTML = '';
  clearBetChipPileSnapshotStorage();
}

function getBetChipStackLayout() {
  const potEl = document.getElementById('pot');
  const tableEl = document.getElementById('poker_table');
  const potRect = potEl?.getBoundingClientRect?.();
  if (potRect && potRect.width > 0 && potRect.height > 0) {
    const chipSize = Math.round(Math.max(44, Math.min(58, potRect.height * 0.68)));
    return {
      // Keep the pile clearly at the left side of the pot (not above it).
      baseX: Math.max(10, potRect.left - Math.round(chipSize * 2.0)),
      baseY: potRect.top + Math.round(potRect.height * 0.80),
      chipSize,
      stepX: Math.round(chipSize * 0.48),
      stepY: Math.max(3, Math.round(chipSize * 0.11))
    };
  }
  const tableRect = tableEl?.getBoundingClientRect?.();
  if (tableRect && tableRect.width > 0 && tableRect.height > 0) {
    const chipSize = Math.round(Math.max(42, Math.min(56, tableRect.width * 0.06)));
    return {
      baseX: tableRect.left + Math.round(tableRect.width * 0.315),
      baseY: tableRect.top + Math.round(tableRect.height * 0.60),
      chipSize,
      stepX: Math.round(chipSize * 0.48),
      stepY: Math.max(3, Math.round(chipSize * 0.11))
    };
  }
  return null;
}

function getChipTextureIndex(chipImage) {
  const idx = BET_CHIP_TEXTURES.indexOf(chipImage);
  return idx >= 0 ? idx : 0;
}

function getBetChipPileStorageKey() {
  if (_match2ID) return `betChipPile_match2_${_match2ID}`;
  if (_tableID) return `betChipPile_table_${_tableID}`;
  return null;
}

function persistBetChipPileSnapshot() {
  const key = getBetChipPileStorageKey();
  if (!key) return;
  try {
    const layer = ensureBetChipPileLayer();
    const baseEl = layer ? layer.querySelector('.bet-chip-pile-base') : null;
    const base = baseEl ? {
      left: Number.parseFloat(baseEl.style.left) || 0,
      top: Number.parseFloat(baseEl.style.top) || 0,
      width: Number.parseFloat(baseEl.style.getPropertyValue('--w')) || 0,
      height: Number.parseFloat(baseEl.style.getPropertyValue('--h')) || 0
    } : null;
    const payload = {
      version: 2,
      pot: Math.max(0, Number(currentGameState?.pot) || 0),
      base,
      chips: betChipPileSnapshot
    };
    sessionStorage.setItem(key, JSON.stringify(payload));
  } catch (e) {}
}

function clearBetChipPileSnapshotStorage() {
  const key = getBetChipPileStorageKey();
  if (!key) return;
  try { sessionStorage.removeItem(key); } catch (e) {}
}

function loadBetChipPileSnapshot(gs) {
  const key = getBetChipPileStorageKey();
  if (!key) return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.chips) || !parsed.chips.length) return null;

    const storedPot = Math.max(0, Number(parsed.pot) || 0);
    const statePot = Math.max(0, Number(gs?.pot) || 0);
    if (storedPot !== statePot) {
      sessionStorage.removeItem(key);
      return null;
    }
    return {
      version: Number(parsed.version) || 1,
      base: parsed.base || null,
      chips: parsed.chips
    };
  } catch (e) {
    return null;
  }
}

function renderBetChipPileFromSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.chips) || !snapshot.chips.length) return false;
  const layer = ensureBetChipPileLayer();
  if (!layer) return false;

  if (snapshot.base && Number.isFinite(Number(snapshot.base.width)) && Number.isFinite(Number(snapshot.base.height))) {
    let base = layer.querySelector('.bet-chip-pile-base');
    if (!base) {
      base = document.createElement('span');
      base.className = 'bet-chip-pile-base';
      layer.appendChild(base);
    }
    base.style.setProperty('--w', `${Math.max(0, Number(snapshot.base.width))}px`);
    base.style.setProperty('--h', `${Math.max(0, Number(snapshot.base.height))}px`);
    base.style.left = `${Number(snapshot.base.left) || 0}px`;
    base.style.top = `${Number(snapshot.base.top) || 0}px`;
  }

  betChipStackCounts = [0, 0, 0, 0, 0];
  const chips = snapshot.chips.slice(0, BET_CHIP_STACK_MAX_VISIBLE * 5);
  chips.forEach((entry, i) => {
    const textureIdx = Math.max(0, Math.min(BET_CHIP_TEXTURES.length - 1, Number(entry?.textureIdx) || 0));
    const chipImage = BET_CHIP_TEXTURES[textureIdx] || BET_CHIP_TEXTURES[0];
    const chip = document.createElement('span');
    chip.className = 'bet-chip-pile-chip';
    const size = Math.max(28, Number(entry?.size) || 48);
    const left = Number(entry?.left);
    const top = Number(entry?.top);
    const rotation = Number.isFinite(Number(entry?.rotation)) ? Number(entry.rotation) : 0;
    const z = Number.isFinite(Number(entry?.zIndex)) ? Number(entry.zIndex) : (100 + i);
    chip.style.setProperty('--chip-size', `${size}px`);
    chip.style.setProperty('--chip-image', `url("${chipImage}")`);
    chip.style.left = `${(Number.isFinite(left) ? left : 0).toFixed(2)}px`;
    chip.style.top = `${(Number.isFinite(top) ? top : 0).toFixed(2)}px`;
    chip.style.transform = `rotate(${rotation.toFixed(2)}deg)`;
    chip.style.zIndex = String(Math.round(z));
    layer.appendChild(chip);
    const slot = textureIdx % betChipStackCounts.length;
    if (betChipStackCounts[slot] < BET_CHIP_STACK_MAX_VISIBLE) betChipStackCounts[slot] += 1;
  });

  betChipPileSnapshot = chips.slice();
  return hasVisibleBetChipPile();
}

function toBetChipPileLayerPoint(layer, x, y) {
  if (!layer) return { x, y };
  const parent = layer.parentElement;
  const parentRect = parent?.getBoundingClientRect?.();
  if (parentRect && parentRect.width > 0 && parentRect.height > 0 && parent?.id === 'poker_table') {
    const rawW = Math.max(1, parent.clientWidth || parent.offsetWidth || 1);
    const rawH = Math.max(1, parent.clientHeight || parent.offsetHeight || 1);
    const scaleX = parentRect.width / rawW;
    const scaleY = parentRect.height / rawH;
    return {
      x: (x - parentRect.left) / Math.max(0.001, scaleX),
      y: (y - parentRect.top) / Math.max(0.001, scaleY)
    };
  }
  return { x, y };
}

function upsertBetChipPileBase(layer, layout) {
  if (!layer || !layout) return;
  let base = layer.querySelector('.bet-chip-pile-base');
  if (!base) {
    base = document.createElement('span');
    base.className = 'bet-chip-pile-base';
    layer.appendChild(base);
  }
  const width = Math.round(layout.chipSize * 3.6);
  const height = Math.round(layout.chipSize * 1.05);
  const left = Math.round(layout.baseX - (layout.chipSize * 1.15));
  const top = Math.round(layout.baseY - (height * 0.32));
  const pt = toBetChipPileLayerPoint(layer, left, top);
  base.style.setProperty('--w', `${width}px`);
  base.style.setProperty('--h', `${height}px`);
  base.style.left = `${pt.x}px`;
  base.style.top = `${pt.y}px`;
}

function flushPendingBetChipPileAdds() {
  if (betChipPileFlushTimer) {
    clearTimeout(betChipPileFlushTimer);
    betChipPileFlushTimer = null;
  }
  if (!pendingBetChipPileAdds.length) return;
  const layer = ensureBetChipPileLayer();
  const layout = getBetChipStackLayout();
  if (!layer || !layout) {
    betChipPileFlushTimer = setTimeout(flushPendingBetChipPileAdds, 32);
    return;
  }
  upsertBetChipPileBase(layer, layout);
  const queue = pendingBetChipPileAdds.splice(0);
  queue.forEach((chipImage) => addChipToBetPile(chipImage));
}

function addChipToBetPile(chipImage, opts = {}) {
  const layer = ensureBetChipPileLayer();
  const layout = getBetChipStackLayout();
  if (!layer || !layout) {
    pendingBetChipPileAdds.push(chipImage);
    if (pendingBetChipPileAdds.length > 80) pendingBetChipPileAdds.shift();
    if (!betChipPileFlushTimer) {
      betChipPileFlushTimer = setTimeout(flushPendingBetChipPileAdds, 32);
    }
    return;
  }
  upsertBetChipPileBase(layer, layout);

  const slot = getChipTextureIndex(chipImage) % betChipStackCounts.length;
  const current = betChipStackCounts[slot] || 0;
  if (current >= BET_CHIP_STACK_MAX_VISIBLE) return;
  betChipStackCounts[slot] = current + 1;

  // Grouped stack layout (3 back, 2 front) for a cleaner casino-style pile.
  const stackPos = [
    { x: -0.46, y: -0.18 }, // blue
    { x: -0.06, y: -0.32 }, // yellow
    { x:  0.42, y: -0.16 }, // red
    { x: -0.20, y:  0.04 }, // green
    { x:  0.24, y:  0.08 }  // violet
  ][slot];

  const level = current;
  const descriptor = opts?.descriptor || null;
  const jitterX = Number.isFinite(Number(descriptor?.jitterX)) ? Number(descriptor.jitterX) : (Math.random() * 0.8 - 0.4);
  const jitterY = Number.isFinite(Number(descriptor?.jitterY)) ? Number(descriptor.jitterY) : 0;
  const x = layout.baseX + Math.round(layout.chipSize * stackPos.x) + jitterX;
  // Compress vertical growth after the first chips so 10-player tables don't create a very tall pile.
  const compressedLevel = level <= 2 ? level : (2 + ((level - 2) * 0.55));
  const y = layout.baseY + Math.round(layout.chipSize * stackPos.y) - Math.round(compressedLevel * layout.stepY) + jitterY;
  const rotation = Number.isFinite(Number(descriptor?.rotation)) ? Number(descriptor.rotation) : (-1.2 + Math.random() * 2.4);

  const chip = document.createElement('span');
  chip.className = 'bet-chip-pile-chip';
  chip.style.setProperty('--chip-size', `${layout.chipSize}px`);
  chip.style.setProperty('--chip-image', `url("${chipImage}")`);
  const pt = toBetChipPileLayerPoint(layer, x, y);
  chip.style.left = `${pt.x.toFixed(2)}px`;
  chip.style.top = `${pt.y.toFixed(2)}px`;
  chip.style.transform = `rotate(${rotation.toFixed(2)}deg)`;
  chip.style.zIndex = String(100 + (level * 10) + slot);
  layer.appendChild(chip);

  if (!opts?.skipSnapshot) {
    const zIndex = 100 + (level * 10) + slot;
    betChipPileSnapshot.push({
      textureIdx: getChipTextureIndex(chipImage),
      left: Number(pt.x.toFixed(2)),
      top: Number(pt.y.toFixed(2)),
      size: layout.chipSize,
      rotation: Number(rotation.toFixed(3)),
      zIndex
    });
    const maxVisible = BET_CHIP_STACK_MAX_VISIBLE * betChipStackCounts.length;
    if (betChipPileSnapshot.length > maxVisible) {
      betChipPileSnapshot = betChipPileSnapshot.slice(betChipPileSnapshot.length - maxVisible);
    }
    persistBetChipPileSnapshot();
  }
}

function triggerBetChipImpactAt(x, y, size = 24) {
  const layer = ensureBetChipThrowLayer();
  if (!layer) return;
  const impact = document.createElement('span');
  impact.className = 'bet-chip-impact';
  const s = Math.max(10, Math.round(size * 0.46));
  impact.style.left = `${(x - (s * 0.5)).toFixed(2)}px`;
  impact.style.top = `${(y - (s * 0.5)).toFixed(2)}px`;
  impact.style.width = `${s}px`;
  impact.style.height = `${s}px`;
  impact.style.setProperty('--ix', `${(Math.random() * 5 - 2.5).toFixed(2)}px`);
  impact.style.setProperty('--iy', `${(Math.random() * 5 - 2.5).toFixed(2)}px`);
  layer.appendChild(impact);
  setTimeout(() => impact.remove(), 520);
}

function triggerBetBeam(seatIdx, betDelta = 0, attempt = 0) {
  const seatEl = document.getElementById('seat' + seatIdx);
  const potEl = document.getElementById('pot');
  if (!seatEl) return;

  const sourceAnchor = seatEl.querySelector('.name-chips') || seatEl.querySelector('.bet') || seatEl;
  const start = getCenterPoint(sourceAnchor);
  const pileAnchor = getBetChipPileAnchor();
  let end = pileAnchor ? { x: pileAnchor.x, y: pileAnchor.y } : getCenterPoint(potEl);
  if (!start || !end) {
    if (attempt < 4) {
      setTimeout(() => triggerBetBeam(seatIdx, betDelta, attempt + 1), 60 + (attempt * 40));
    }
    return;
  }

  let dx = end.x - start.x;
  let dy = end.y - start.y;
  let len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 24) {
    const potPt = getCenterPoint(potEl);
    if (!potPt) return;
    end = {
      x: start.x + (potPt.x - start.x) * 0.26,
      y: start.y + (potPt.y - start.y) * 0.26
    };
    dx = end.x - start.x;
    dy = end.y - start.y;
    len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 20) return;
  }

  const layer = ensureBetChipThrowLayer();
  if (!layer) {
    if (attempt < 4) {
      setTimeout(() => triggerBetBeam(seatIdx, betDelta, attempt + 1), 60 + (attempt * 40));
    }
    return;
  }
  ensureBetChipTexturesPreloaded();
  const deltaSafe = Math.max(0, Number(betDelta) || 0);
  const ux = dx / Math.max(1, len);
  const uy = dy / Math.max(1, len);
  const px = -uy;
  const py = ux;
  // Send a denser stream of chips from seat to pile.
  const throwCount = Math.max(3, Math.min(9, Math.round(3 + Math.log10(deltaSafe + 10) * 2.25)));
  const pileGain = Math.max(throwCount, Math.min(12, Math.round(2 + Math.log10(deltaSafe + 10) * 3.1)));

  for (let i = 0; i < throwCount; i += 1) {
    const chip = document.createElement('span');
    chip.className = 'bet-chip-throw';
    chip.setAttribute('data-chip-throw-id', String(++betChipThrowSeq));

    const chipImage = BET_CHIP_TEXTURES[(seatIdx + i) % BET_CHIP_TEXTURES.length];
    const size = Math.round(Math.max(20, Math.min(30, 21 + (len * 0.014) + (Math.random() * 3))));
    chip.style.setProperty('--chip-size', `${size}px`);
    chip.style.setProperty('--chip-image', `url("${chipImage}")`);
    chip.style.backgroundImage = `url("${chipImage}")`;
    layer.appendChild(chip);

    // Form chips on the seat and make them slide to the pile (no airborne arc).
    const lateralSpread = (Math.random() - 0.5) * 26;
    const queueBack = 8 + (i * 2.4) + (Math.random() * 3);
    const sx = (start.x - (size / 2)) - (ux * queueBack) + (px * lateralSpread);
    const sy = (start.y - (size / 2)) - (uy * queueBack) + (py * lateralSpread * 0.72);
    const tx = (end.x - (size / 2)) + (px * ((Math.random() - 0.5) * 16));
    const ty = (end.y - (size / 2)) + (py * ((Math.random() - 0.5) * 8));
    const pushX = sx + (ux * (10 + Math.random() * 10));
    const pushY = sy + (uy * (10 + Math.random() * 10));
    const midX = sx + ((tx - sx) * (0.52 + Math.random() * 0.1));
    const midY = sy + ((ty - sy) * (0.52 + Math.random() * 0.1));
    const spinStart = -8 + (Math.random() * 16);
    const spinMid = spinStart + (-64 + Math.random() * 128);
    const spinEnd = spinMid + (-40 + Math.random() * 80);
    const delay = i * 22 + Math.random() * 22;
    const dur = 560 + Math.random() * 180;

    const fly = chip.animate([
      { offset: 0, opacity: 1, transform: `translate3d(${sx.toFixed(2)}px, ${sy.toFixed(2)}px, 0) rotate(${spinStart.toFixed(2)}deg) scale(.98)` },
      { offset: 0.2, opacity: 1, transform: `translate3d(${pushX.toFixed(2)}px, ${pushY.toFixed(2)}px, 0) rotate(${(spinStart + ((spinMid - spinStart) * 0.28)).toFixed(2)}deg) scale(1)` },
      { offset: 0.72, opacity: 1, transform: `translate3d(${midX.toFixed(2)}px, ${midY.toFixed(2)}px, 0) rotate(${spinMid.toFixed(2)}deg) scale(1.01)` },
      { offset: 1, opacity: 1, transform: `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) rotate(${spinEnd.toFixed(2)}deg) scale(.95)` }
    ], {
      duration: dur,
      delay,
      easing: 'cubic-bezier(.18,.7,.22,1)',
      fill: 'forwards'
    });

    fly.onfinish = () => {
      if (!chip.isConnected) return;
      triggerBetChipImpactAt(tx + (size * 0.5), ty + (size * 0.5), size);
      addChipToBetPile(chipImage);
      chip.remove();
    };
  }

  const extraToStack = Math.max(0, pileGain - throwCount);
  for (let j = 0; j < extraToStack; j += 1) {
    const chipImage = BET_CHIP_TEXTURES[(seatIdx + throwCount + j) % BET_CHIP_TEXTURES.length];
    setTimeout(() => addChipToBetPile(chipImage), 48 + (j * 26));
  }

  seatEl.classList.remove('bet-chip-throw-origin');
  void seatEl.offsetWidth;
  seatEl.classList.add('bet-chip-throw-origin');
  if (seatEl._betChipOriginTimer) clearTimeout(seatEl._betChipOriginTimer);
  seatEl._betChipOriginTimer = setTimeout(() => {
    seatEl.classList.remove('bet-chip-throw-origin');
    seatEl._betChipOriginTimer = null;
  }, 700);

  if (potEl) {
    potEl.classList.remove('bet-beam-pot-hit');
    void potEl.offsetWidth;
    potEl.classList.add('bet-beam-pot-hit');
    if (potEl._betBeamPotTimer) clearTimeout(potEl._betBeamPotTimer);
    potEl._betBeamPotTimer = setTimeout(() => {
      potEl.classList.remove('bet-beam-pot-hit');
      potEl._betBeamPotTimer = null;
    }, 760);
  }
}

function maybeResetBetChipPile(prevState, nextState) {
  if (!nextState) return;
  const prevPhase = String(prevState?.phase || '').toLowerCase();
  const nextPhase = String(nextState.phase || '').toLowerCase();
  const enteringPreflop = nextPhase === 'preflop' && prevPhase !== 'preflop';
  // Keep chips visible for reveal -> preflop so vortex can swallow them.
  if ((enteringPreflop && prevPhase !== 'reveal') || nextPhase === 'waiting') {
    resetBetChipPile();
  }
}

function maybeTriggerBetBeam(prevState, nextState) {
  if (!prevState || !nextState) return;
  if (!Array.isArray(prevState.players) || !Array.isArray(nextState.players)) return;
  if (prevState.phase !== nextState.phase && String(nextState.phase) === 'preflop') return;

  const shots = [];
  const count = Math.min(prevState.players.length, nextState.players.length);
  for (let i = 0; i < count; i++) {
    const before = prevState.players[i];
    const after = nextState.players[i];
    if (!before || !after || after.inactive) continue;

    const status = String(after.status || '').toUpperCase();
    if (status === 'WAIT' || status === 'BUST' || status === 'FOLD') continue;

    const beforeBet = Math.max(0, Number(before.subtotal_bet) || 0);
    const afterBet = Math.max(0, Number(after.subtotal_bet) || 0);
    if (afterBet <= beforeBet) continue;

    shots.push({ seatIdx: i, delta: afterBet - beforeBet });
  }

  if (!shots.length) return;
  shots
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3)
    .forEach((shot, idx) => {
      setTimeout(() => triggerBetBeam(shot.seatIdx, shot.delta), idx * 220);
    });
}

function hasVisibleBetChipPile() {
  const layer = ensureBetChipPileLayer();
  if (!layer) return false;
  return !!layer.querySelector('.bet-chip-pile-chip');
}

function estimatePileChipsFromBet(amount) {
  const safe = Math.max(0, Number(amount) || 0);
  if (safe <= 0) return 0;
  return Math.max(1, Math.min(12, Math.round(2 + Math.log10(safe + 10) * 3.1)));
}

function restoreBetChipPileFromState(gs, { force = false, attempt = 0 } = {}) {
  if (!gs || !Array.isArray(gs.players)) return;
  const phase = String(gs.phase || '').toLowerCase();
  if (phase === 'waiting') {
    clearBetChipPileSnapshotStorage();
    return;
  }
  if (!force && hasVisibleBetChipPile()) return;

  const snapshot = loadBetChipPileSnapshot(gs);
  if (snapshot && Array.isArray(snapshot.chips) && snapshot.chips.length) {
    resetBetChipPile();
    if (Number(snapshot.version) >= 2 && renderBetChipPileFromSnapshot(snapshot)) {
      persistBetChipPileSnapshot();
      return;
    }
    if (Number(snapshot.version) === 1) {
      snapshot.chips.forEach((entry) => {
        const textureIdx = Math.max(0, Math.min(BET_CHIP_TEXTURES.length - 1, Number(entry?.textureIdx) || 0));
        const chipImage = BET_CHIP_TEXTURES[textureIdx] || BET_CHIP_TEXTURES[0];
        addChipToBetPile(chipImage, { descriptor: entry, skipSnapshot: true });
      });
      betChipPileSnapshot = snapshot.chips.slice(0, BET_CHIP_STACK_MAX_VISIBLE * betChipStackCounts.length);
      persistBetChipPileSnapshot();
      if (hasVisibleBetChipPile()) return;
    }
  }

  const contributors = [];
  gs.players.forEach((p, seatIdx) => {
    if (!p || p.inactive) return;
    const subtotal = Math.max(0, Number(p.subtotal_bet) || 0);
    if (subtotal <= 0) return;
    contributors.push({ seatIdx, subtotal });
  });
  if (!contributors.length) return;

  resetBetChipPile();
  contributors.forEach(({ seatIdx, subtotal }) => {
    const chipCount = estimatePileChipsFromBet(subtotal);
    for (let i = 0; i < chipCount; i += 1) {
      const chipImage = BET_CHIP_TEXTURES[(seatIdx + i) % BET_CHIP_TEXTURES.length];
      addChipToBetPile(chipImage);
    }
  });

  // On reload, table/pot nodes can be rebuilt just after first paint.
  // Retry a few times if the pile is still not visible.
  const shouldRetry = !hasVisibleBetChipPile();
  if (shouldRetry && attempt < 5) {
    const delays = [70, 150, 280, 460, 720];
    const ms = delays[Math.max(0, Math.min(delays.length - 1, attempt))];
    setTimeout(() => {
      if (hasVisibleBetChipPile()) return;
      restoreBetChipPileFromState(gs, { force: true, attempt: attempt + 1 });
    }, ms);
  }
}

function ensureFoldDropStyle() {
  if (foldDropStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'fold-drop-style';
  style.textContent = `
    .fold-drop-card{
      position: fixed;
      pointer-events: none;
      z-index: 2147482600;
      border-radius: 8px;
      overflow: hidden;
      will-change: transform, opacity, filter;
      backface-visibility: hidden;
      transform: translate3d(0,0,0);
      box-shadow: 0 8px 22px rgba(0,0,0,.38);
    }
    .fold-drop-impact{
      position: fixed;
      width: 14px;
      height: 14px;
      margin-left: -7px;
      margin-top: -7px;
      border-radius: 999px;
      pointer-events: none;
      z-index: 2147482599;
      border: 2px solid rgba(255, 214, 136, .9);
      box-shadow: 0 0 14px rgba(255, 170, 120, .8);
      animation: foldDropImpact 440ms ease-out forwards;
    }
    @keyframes foldDropImpact{
      0%{ opacity: 0; transform: scale(.35); }
      22%{ opacity: 1; }
      100%{ opacity: 0; transform: scale(2.6); }
    }
  `;
  document.head.appendChild(style);
  foldDropStyleInjected = true;
}

function createFoldDropClone(cardEl, opts = {}) {
  if (!cardEl || !cardEl.getBoundingClientRect) return null;
  let rect = cardEl.getBoundingClientRect();
  if (!rect) return null;
  const fallbackW = 64;
  const fallbackH = 92;
  const w = rect.width > 2 ? rect.width : fallbackW;
  const h = rect.height > 2 ? rect.height : fallbackH;
  if (w <= 0 || h <= 0) return null;

  const cs = window.getComputedStyle(cardEl);
  const forceBack = opts.forceBack === true;
  const backUrl = getThemeCardAssetCssUrl('cardback', { absolute: true });
  const clone = document.createElement('div');
  clone.className = 'fold-drop-card';
  clone.style.left = `${rect.left}px`;
  clone.style.top = `${rect.top}px`;
  clone.style.width = `${w}px`;
  clone.style.height = `${h}px`;
  clone.style.backgroundImage = forceBack ? backUrl : (cs.backgroundImage || backUrl);
  clone.style.backgroundSize = cs.backgroundSize || 'cover';
  clone.style.backgroundPosition = cs.backgroundPosition || 'center';
  clone.style.backgroundRepeat = cs.backgroundRepeat || 'no-repeat';
  clone.style.border = forceBack ? '1px solid rgba(255,255,255,.34)' : (cs.border || '1px solid rgba(255,255,255,.2)');
  clone.style.opacity = '1';
  rect = {
    left: rect.left,
    top: rect.top,
    width: w,
    height: h
  };
  return { clone, rect };
}

function triggerFoldDrop(seatIdx) {
  const seatEl = document.getElementById('seat' + seatIdx);
  const potEl = document.getElementById('pot');
  if (!seatEl || !potEl) return;

  ensureFoldDropStyle();
  const cards = Array.from(seatEl.querySelectorAll('.holecards .card'));
  if (!cards.length) return;
  const potRect = potEl.getBoundingClientRect();
  if (!potRect || potRect.width <= 0 || potRect.height <= 0) return;

  const targetX = potRect.left + (potRect.width / 2);
  const targetY = potRect.top + (potRect.height / 2) + 8;
  const showRealFaces = (seatIdx === mySeatIndex);

  cards.forEach((cardEl, idx) => {
    const built = createFoldDropClone(cardEl, { forceBack: !showRealFaces });
    if (!built) return;
    const { clone, rect } = built;
    if (!showRealFaces) {
      // If card slots are visually hidden for opponents, anchor clones near seat center.
      const seatRect = seatEl.getBoundingClientRect();
      if (seatRect && seatRect.width > 0 && seatRect.height > 0) {
        clone.style.left = `${seatRect.left + (seatRect.width * 0.5) - (rect.width * 0.5) + (idx === 0 ? -8 : 8)}px`;
        clone.style.top = `${seatRect.top + (seatRect.height * 0.35) - (rect.height * 0.5)}px`;
      }
    }
    document.body.appendChild(clone);

    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;
    const spread = idx === 0 ? -12 : 12;
    const endX = targetX + spread;
    const endY = targetY + (idx * 2);
    const dx = endX - startX;
    const dy = endY - startY;
    const rotMid = (idx === 0 ? -1 : 1) * (8 + Math.random() * 9);
    const rotEnd = (idx === 0 ? -1 : 1) * (20 + Math.random() * 16);

    const anim = clone.animate(
      [
        { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1, filter: 'brightness(1)' },
        { transform: `translate(${(dx * 0.55).toFixed(2)}px, ${(dy * 0.45 - 34).toFixed(2)}px) scale(.95) rotate(${rotMid.toFixed(2)}deg)`, opacity: .96, offset: 0.56, filter: 'brightness(1)' },
        { transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(.7) rotate(${rotEnd.toFixed(2)}deg)`, opacity: 0, filter: 'brightness(.9)' }
      ],
      {
        duration: 1850 + (idx * 220),
        easing: 'cubic-bezier(.2,.75,.2,1)',
        fill: 'forwards'
      }
    );
    anim.onfinish = () => clone.remove();
  });

  const impact = document.createElement('div');
  impact.className = 'fold-drop-impact';
  impact.style.left = `${targetX}px`;
  impact.style.top = `${targetY}px`;
  document.body.appendChild(impact);
  setTimeout(() => impact.remove(), 500);
}

function maybeTriggerFoldDrop(prevState, nextState) {
  if (!prevState || !nextState) return;
  if (!Array.isArray(prevState.players) || !Array.isArray(nextState.players)) return;
  if (!['preflop', 'flop', 'turn', 'river'].includes(String(nextState.phase || '').toLowerCase())) return;

  const count = Math.min(prevState.players.length, nextState.players.length);
  for (let i = 0; i < count; i++) {
    const before = prevState.players[i];
    const after = nextState.players[i];
    if (!before || !after || after.inactive) continue;
    const was = String(before.status || '').toUpperCase();
    const now = String(after.status || '').toUpperCase();
    if (was !== 'FOLD' && now === 'FOLD') {
      triggerFoldDrop(i);
    }
  }
}

function ensureHandTornadoStyle() {
  if (handTornadoStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'hand-tornado-style';
  style.textContent = `
    .hand-tornado-overlay{
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 2147482650;
      overflow: hidden;
      contain: layout paint style;
    }
    body.hand-tornado-active #board .boardcard,
    body.hand-tornado-active #board .boardcard .card,
    body.hand-tornado-active .seat .holecards .card{
      visibility: hidden !important;
      opacity: 0 !important;
    }
    body.hand-tornado-active #bet-chip-pile-layer,
    body.hand-tornado-active #bet-chip-throw-layer{
      opacity: 0 !important;
    }
    .hand-tornado-vortex{
      position: fixed;
      width: 240px;
      height: 240px;
      margin-left: -120px;
      margin-top: -120px;
      border-radius: 999px;
      pointer-events: none;
      background:
        radial-gradient(circle at 50% 50%, rgba(22, 36, 52, .94) 0%, rgba(22, 36, 52, .88) 24%, rgba(22, 36, 52, .22) 58%, rgba(22, 36, 52, 0) 74%),
        conic-gradient(from 0deg, rgba(132, 205, 255, .42), rgba(85, 170, 255, .14), rgba(255, 255, 255, .36), rgba(70, 148, 255, .18), rgba(132, 205, 255, .42));
      filter: blur(.2px) saturate(1.12);
      mix-blend-mode: screen;
      animation: handTornadoSpin 980ms linear infinite, handTornadoPulse 760ms ease-in-out infinite alternate;
      box-shadow:
        0 0 24px rgba(129, 207, 255, .58),
        0 0 72px rgba(77, 170, 255, .42),
        inset 0 0 32px rgba(255, 255, 255, .20);
    }
    .hand-tornado-vortex::before{
      content: "";
      position: absolute;
      inset: 16%;
      border-radius: 999px;
      background:
        radial-gradient(circle at 50% 50%, rgba(8, 15, 26, .92), rgba(8, 15, 26, .26) 52%, rgba(8, 15, 26, 0) 72%);
      animation: handTornadoCore 620ms ease-in-out infinite alternate;
    }
    .hand-tornado-card{
      position: fixed;
      pointer-events: none;
      border-radius: 8px;
      overflow: hidden;
      backface-visibility: hidden;
      transform: translate3d(0,0,0);
      box-shadow: 0 8px 22px rgba(0,0,0,.34);
      will-change: transform, opacity, filter;
    }
    .hand-tornado-particle{
      position: fixed;
      width: 8px;
      height: 8px;
      margin-left: -4px;
      margin-top: -4px;
      border-radius: 999px;
      pointer-events: none;
      z-index: 2147482652;
      background: radial-gradient(circle, rgba(255,255,255,.98), rgba(120,210,255,.72) 52%, rgba(120,210,255,0) 72%);
      mix-blend-mode: screen;
      box-shadow: 0 0 12px rgba(140,215,255,.85);
      will-change: transform, opacity;
    }
    .hand-tornado-chip{
      position: fixed;
      pointer-events: none;
      border-radius: 999px;
      overflow: hidden;
      backface-visibility: hidden;
      transform: translate3d(0,0,0);
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      will-change: transform, opacity, filter;
      box-shadow: 0 2px 5px rgba(0,0,0,.34);
      filter: saturate(1.05) contrast(1.04);
      z-index: 2147482651;
    }
    @keyframes handTornadoSpin{
      from { transform: rotate(0deg) scale(1); }
      to { transform: rotate(360deg) scale(1); }
    }
    @keyframes handTornadoPulse{
      from { opacity: .82; }
      to { opacity: 1; }
    }
    @keyframes handTornadoCore{
      from { transform: scale(.84); opacity: .72; }
      to { transform: scale(1); opacity: .96; }
    }
  `;
  document.head.appendChild(style);
  handTornadoStyleInjected = true;
}

function getHandTornadoBackImage() {
  const themedBack = getThemeCardAssetCssUrl('cardback', { absolute: true });
  if (themedBack) return themedBack;
  if (typeof CARD_BACK_URL === 'string' && CARD_BACK_URL.trim()) {
    if (/^url\(/i.test(CARD_BACK_URL)) return CARD_BACK_URL;
    return `url("${CARD_BACK_URL}")`;
  }
  return '';
}

function getHandTornadoMyCardElements() {
  if (!Number.isInteger(mySeatIndex) || mySeatIndex < 0) return [];
  const seatEl = document.getElementById('seat' + mySeatIndex);
  if (!seatEl) return [];
  return Array.from(seatEl.querySelectorAll('.holecards .card')).slice(0, 2);
}

function getHandTornadoBoardElements() {
  return ['flop1', 'flop2', 'flop3', 'turn', 'river']
    .map((id) => {
      const slot = document.getElementById(id);
      if (!slot) return null;
      return slot.querySelector('.card') || slot;
    })
    .filter(Boolean);
}

function collectHandTornadoSourceCards() {
  const result = [];
  const seen = new Set();
  const pushCard = (el, kind) => {
    if (!el || seen.has(el)) return;
    seen.add(el);
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width < 12 || rect.height < 18) return;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity || 1) < 0.05) return;
    result.push({ el, rect, cs, kind });
  };

  getHandTornadoBoardElements().forEach((el) => pushCard(el, 'board'));
  getHandTornadoMyCardElements().forEach((el) => pushCard(el, 'hole'));
  return result;
}

function collectHandTornadoSourceChips() {
  const result = [];
  const pushChip = (el) => {
    if (!el) return;
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width < 10 || rect.height < 10) return;
    const cs = window.getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity || 1) < 0.05) return;
    result.push({ el, rect, cs });
  };

  document.querySelectorAll('#bet-chip-pile-layer .bet-chip-pile-chip, #bet-chip-throw-layer .bet-chip-throw').forEach(pushChip);
  return result;
}

function collectHandTornadoTargets() {
  const targets = [];
  const boardEls = getHandTornadoBoardElements();
  const myEls = getHandTornadoMyCardElements();
  const all = [...boardEls, ...myEls];
  all.forEach((el, idx) => {
    const rect = el.getBoundingClientRect?.();
    if (!rect || rect.width < 12 || rect.height < 18) return;
    let backImage = getHandTornadoBackImage();
    if (idx >= boardEls.length) {
      const myCardIdx = idx - boardEls.length;
      backImage = getThemeCardAssetCssUrl(myCardIdx === 0 ? 'customI' : 'customM', { absolute: true }) || backImage;
    }
    targets.push({ rect, backImage });
  });
  return targets;
}

function triggerHandTornadoParticles(overlay, centerX, centerY, mode = 'in') {
  if (!overlay) return;
  const count = mode === 'in' ? 22 : 18;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'hand-tornado-particle';
    const angle = Math.random() * Math.PI * 2;
    const radius = 90 + Math.random() * 340;
    let sx;
    let sy;
    let ex;
    let ey;
    if (mode === 'in') {
      sx = centerX + Math.cos(angle) * radius;
      sy = centerY + Math.sin(angle) * (radius * 0.72);
      ex = centerX + (Math.random() * 16 - 8);
      ey = centerY + (Math.random() * 14 - 7);
    } else {
      sx = centerX + (Math.random() * 10 - 5);
      sy = centerY + (Math.random() * 8 - 4);
      ex = centerX + Math.cos(angle) * radius;
      ey = centerY + Math.sin(angle) * (radius * 0.74);
    }
    p.style.left = `${sx}px`;
    p.style.top = `${sy}px`;
    overlay.appendChild(p);

    const dx = ex - sx;
    const dy = ey - sy;
    const anim = p.animate(
      [
        { transform: 'translate(0px, 0px) scale(.35)', opacity: 0 },
        { transform: `translate(${(dx * 0.45).toFixed(2)}px, ${(dy * 0.42).toFixed(2)}px) scale(1)`, opacity: .95, offset: .35 },
        { transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(.28)`, opacity: 0 }
      ],
      {
        duration: (mode === 'in' ? 560 : 640) + Math.round(Math.random() * 320),
        delay: Math.round(Math.random() * 140),
        easing: 'cubic-bezier(.19,.75,.22,1)',
        fill: 'forwards'
      }
    );
    anim.onfinish = () => p.remove();
  }
}

function fadeOutHandTornadoSources(sources) {
  const touched = [];
  sources.forEach(({ el, kind }) => {
    if (!el || !el.style) return;
    touched.push({
      el,
      kind,
      opacity: el.style.opacity || '',
      transition: el.style.transition || ''
    });
  });
  touched.forEach(({ el }) => {
    el.style.transition = 'opacity 150ms ease-out';
    el.style.opacity = '0';
  });
  return touched;
}

function restoreHandTornadoSources(touched) {
  if (!Array.isArray(touched)) return;
  touched.forEach((item) => {
    if (!item?.el || !item.el.style) return;
    if (item.kind === 'board') return;
    item.el.style.opacity = item.opacity;
    item.el.style.transition = item.transition;
  });
}

function maybeTriggerHandTornado(prevState, nextState, opts = {}) {
  if (window.IMDCXMotion) return window.IMDCXMotion.newHand(prevState, nextState, opts);
  if (!prevState || !nextState) {
    document.body.classList.remove('hand-tornado-active');
    return false;
  }
  const prevPhase = String(prevState.phase || '').toLowerCase();
  const nextPhase = String(nextState.phase || '').toLowerCase();
  if (prevPhase !== 'reveal' || nextPhase !== 'preflop') {
    document.body.classList.remove('hand-tornado-active');
    return false;
  }

  const sources = collectHandTornadoSourceCards();
  if (sources.length < 2) {
    document.body.classList.remove('hand-tornado-active');
    return false;
  }

  const targets = collectHandTornadoTargets();
  if (!targets.length) {
    document.body.classList.remove('hand-tornado-active');
    return false;
  }
  const chipSources = collectHandTornadoSourceChips();

  ensureHandTornadoStyle();
  handTornadoRunId += 1;
  const runId = handTornadoRunId;
  let cleanupDelayMs = HAND_TORNADO_TOTAL_MS;
  handTornadoBoardBacksBlockedUntil = Date.now() + cleanupDelayMs;
  if (handTornadoCleanupTimer) {
    clearTimeout(handTornadoCleanupTimer);
    handTornadoCleanupTimer = null;
  }
  document.body.classList.remove('hand-tornado-active');
  document.querySelectorAll('.hand-tornado-overlay').forEach((el) => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'hand-tornado-overlay';
  const vortex = document.createElement('div');
  vortex.className = 'hand-tornado-vortex';
  overlay.appendChild(vortex);
  document.body.appendChild(overlay);
  document.body.classList.add('hand-tornado-active');

  const tableRect = document.getElementById('poker_table')?.getBoundingClientRect?.();
  const centerX = (tableRect && tableRect.width > 10)
    ? (tableRect.left + tableRect.width * 0.5)
    : ((window.innerWidth || 0) * 0.5);
  const centerY = (tableRect && tableRect.height > 10)
    ? (tableRect.top + tableRect.height * 0.5)
    : ((window.innerHeight || 0) * 0.5);

  vortex.style.left = `${centerX}px`;
  vortex.style.top = `${centerY}px`;
  triggerHandTornadoParticles(overlay, centerX, centerY, 'in');
  const sourceRestore = fadeOutHandTornadoSources(sources);

  const backImage = getHandTornadoBackImage();
  const byPos = (a, b) => {
    const ay = a.rect.top + a.rect.height * 0.5;
    const by = b.rect.top + b.rect.height * 0.5;
    if (Math.abs(ay - by) > 8) return ay - by;
    return (a.rect.left + a.rect.width * 0.5) - (b.rect.left + b.rect.width * 0.5);
  };
  const sortedSources = sources.slice().sort(byPos);
  const sortedTargets = targets.slice().sort(byPos);
  const count = Math.min(sortedSources.length, sortedTargets.length);
  let latestCardPlacementMs = 0;
  let latestChipSwallowMs = 0;

  sortedSources.slice(0, count).forEach((src, idx) => {
    const w = Math.max(16, src.rect.width);
    const h = Math.max(22, src.rect.height);
    const clone = document.createElement('div');
    clone.className = 'hand-tornado-card';
    clone.style.left = `${src.rect.left}px`;
    clone.style.top = `${src.rect.top}px`;
    clone.style.width = `${w}px`;
    clone.style.height = `${h}px`;
    clone.style.backgroundImage = (src.cs.backgroundImage && src.cs.backgroundImage !== 'none') ? src.cs.backgroundImage : backImage;
    clone.style.backgroundSize = src.cs.backgroundSize || 'cover';
    clone.style.backgroundPosition = src.cs.backgroundPosition || 'center';
    clone.style.backgroundRepeat = src.cs.backgroundRepeat || 'no-repeat';
    clone.style.border = src.cs.border || '1px solid rgba(255,255,255,.2)';
    overlay.appendChild(clone);

    const startCx = src.rect.left + (w * 0.5);
    const startCy = src.rect.top + (h * 0.5);
    const enterDx = (centerX - startCx) + (Math.random() * 30 - 15);
    const enterDy = (centerY - startCy) + (Math.random() * 24 - 12);
    const enterRot = (Math.random() * 440 - 220);

    const enterDuration = 860 + Math.round(Math.random() * 260);
    const enterAnim = clone.animate(
      [
        { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1, filter: 'brightness(1)' },
        { transform: `translate(${(enterDx * 0.7).toFixed(2)}px, ${(enterDy * 0.65).toFixed(2)}px) scale(.74) rotate(${(enterRot * 0.48).toFixed(2)}deg)`, opacity: .92, offset: 0.58, filter: 'brightness(.96)' },
        { transform: `translate(${enterDx.toFixed(2)}px, ${enterDy.toFixed(2)}px) scale(.24) rotate(${enterRot.toFixed(2)}deg)`, opacity: .22, filter: 'brightness(.84)' }
      ],
      {
        duration: enterDuration,
        easing: 'cubic-bezier(.19,.75,.22,1)',
        fill: 'forwards'
      }
    );

    enterAnim.onfinish = () => {
      if (runId !== handTornadoRunId) {
        clone.remove();
        return;
      }
      const target = sortedTargets[idx];
      if (!target) {
        clone.remove();
        return;
      }
      const endRect = target.rect;
      const endCx = endRect.left + endRect.width * 0.5;
      const endCy = endRect.top + endRect.height * 0.5;
      clone.style.left = `${centerX - (w * 0.5)}px`;
      clone.style.top = `${centerY - (h * 0.5)}px`;
      clone.style.opacity = '1';
      clone.style.filter = 'brightness(1)';
      clone.style.backgroundImage = target.backImage || backImage;
      clone.style.border = '1px solid rgba(255,255,255,.30)';

      const outDx = endCx - centerX;
      const outDy = endCy - centerY;
      const outDelay = 80 + Math.round(Math.random() * 180);
      const outDuration = 920 + Math.round(Math.random() * 260);
      latestCardPlacementMs = Math.max(latestCardPlacementMs, enterDuration + outDelay + outDuration);
      const outAnim = clone.animate(
        [
          { transform: 'translate(0px, 0px) scale(.16) rotate(0deg)', opacity: .84, filter: 'brightness(.82)' },
          { transform: `translate(${(outDx * 0.55).toFixed(2)}px, ${(outDy * 0.5 - 24).toFixed(2)}px) scale(.74) rotate(0deg)`, opacity: 1, offset: .58, filter: 'brightness(1.06)' },
          { transform: `translate(${outDx.toFixed(2)}px, ${outDy.toFixed(2)}px) scale(1) rotate(0deg)`, opacity: 1, filter: 'brightness(1)' }
        ],
        {
          duration: outDuration,
          delay: outDelay,
          easing: 'cubic-bezier(.17,.78,.26,1)',
          fill: 'forwards'
        }
      );
      outAnim.onfinish = () => {
        // Keep the redistributed clone visible at its target.
        // Overlay cleanup fades all clones out only after real backs are in place.
      };
    };
  });

  chipSources.forEach((src, idx) => {
    const w = Math.max(14, Math.round(src.rect.width));
    const h = Math.max(14, Math.round(src.rect.height));
    const chip = document.createElement('div');
    chip.className = 'hand-tornado-chip';
    chip.style.left = `${src.rect.left}px`;
    chip.style.top = `${src.rect.top}px`;
    chip.style.width = `${w}px`;
    chip.style.height = `${h}px`;
    chip.style.backgroundImage = src.cs.backgroundImage || 'none';
    overlay.appendChild(chip);

    const startCx = src.rect.left + (w * 0.5);
    const startCy = src.rect.top + (h * 0.5);
    const dx = centerX - startCx;
    const dy = centerY - startCy;
    const swirlX = (Math.random() * 80 - 40);
    const swirlY = (Math.random() * 60 - 30);
    const rotA = -520 + Math.random() * 1040;
    const rotB = rotA + (-720 + Math.random() * 1440);
    const delay = Math.round(Math.random() * 220);
    const dur = 1500 + Math.round(Math.random() * 900);
    latestChipSwallowMs = Math.max(latestChipSwallowMs, delay + dur);

    const anim = chip.animate(
      [
        { transform: 'translate(0px, 0px) scale(1) rotate(0deg)', opacity: 1, filter: 'brightness(1)' },
        {
          transform: `translate(${(dx * 0.48 + swirlX).toFixed(2)}px, ${(dy * 0.44 + swirlY).toFixed(2)}px) scale(.88) rotate(${rotA.toFixed(2)}deg)`,
          opacity: .96,
          offset: .42,
          filter: 'brightness(.98)'
        },
        {
          transform: `translate(${(dx * 0.82 + swirlX * 0.45).toFixed(2)}px, ${(dy * 0.8 + swirlY * 0.4).toFixed(2)}px) scale(.46) rotate(${rotB.toFixed(2)}deg)`,
          opacity: .72,
          offset: .78,
          filter: 'brightness(.9)'
        },
        {
          transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(.14) rotate(${(rotB * 1.26).toFixed(2)}deg)`,
          opacity: 0,
          filter: 'brightness(.78)'
        }
      ],
      {
        duration: dur,
        delay,
        easing: 'cubic-bezier(.16,.78,.22,1)',
        fill: 'forwards'
      }
    );
    anim.onfinish = () => chip.remove();
  });

  setTimeout(() => {
    if (runId !== handTornadoRunId) return;
    triggerHandTornadoParticles(overlay, centerX, centerY, 'out');
  }, 640);
  if (typeof opts.onSwallow === 'function') {
    setTimeout(() => {
      if (runId !== handTornadoRunId) return;
      try { opts.onSwallow(); } catch (e) {}
    }, Math.max(HAND_TORNADO_SWALLOW_MS, 1700));
  }
  cleanupDelayMs = Math.max(
    HAND_TORNADO_SWALLOW_MS + 900,
    (latestCardPlacementMs > 0 ? latestCardPlacementMs + 120 : 0),
    (latestChipSwallowMs > 0 ? latestChipSwallowMs + 240 : 0),
    3400
  );
  handTornadoBoardBacksBlockedUntil = Date.now() + cleanupDelayMs;

  handTornadoCleanupTimer = setTimeout(() => {
    if (runId !== handTornadoRunId) return;
    handTornadoBoardBacksBlockedUntil = 0;
    // Restore DOM opacity first, then let the new-hand reset repaint fresh backs/faces.
    // Restoring after onComplete can resurrect cards from the previous hand.
    restoreHandTornadoSources(sourceRestore);
    if (typeof opts.onComplete === 'function') {
      try { opts.onComplete(); } catch (e) {}
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (runId !== handTornadoRunId) return;
        vortex.remove();
        document.body.classList.remove('hand-tornado-active');
        const fade = overlay.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: 180, easing: 'ease-out', fill: 'forwards' }
        );
        fade.onfinish = () => overlay.remove();
      });
    });
    handTornadoCleanupTimer = null;
  }, cleanupDelayMs);
  return true;
}

function ensureRiverRevealBoostStyle() {
  if (riverRevealBoostStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'river-reveal-boost-style';
  style.textContent = `
    #board.river-reveal-boost{
      position: relative;
      isolation: isolate;
      animation: riverBoardBoostPulse 2400ms ease-out;
    }
    #board.river-reveal-boost::after{
      content: "";
      position: absolute;
      inset: -10px;
      border-radius: 22px;
      pointer-events: none;
      background:
        radial-gradient(ellipse at 50% 45%, rgba(255, 221, 116, .36), rgba(255, 221, 116, 0) 70%),
        radial-gradient(ellipse at 50% 50%, rgba(84, 255, 224, .24), rgba(84, 255, 224, 0) 76%);
      mix-blend-mode: screen;
      animation: riverBoardFlash 2400ms ease-out forwards;
      z-index: 4;
    }
    #river.river-card-boost{
      position: relative;
      z-index: 5;
      animation: riverCardBoost 2800ms cubic-bezier(.2,.78,.18,1);
      transform-origin: center center;
      will-change: transform, filter;
      box-shadow: 0 0 0 rgba(0,0,0,0);
    }
    #river.river-card-boost::before{
      content: "";
      position: absolute;
      inset: -14px;
      border-radius: 12px;
      pointer-events: none;
      background: radial-gradient(circle, rgba(255, 226, 126, .48), rgba(255, 226, 126, 0) 68%);
      animation: riverCardAura 2400ms ease-out forwards;
      z-index: -1;
    }
    #board .boardcard.river-all-cards-pulse{
      animation: riverAllCardsPulse 1800ms ease-out;
      transform-origin: center center;
      will-change: transform, filter;
    }
    @keyframes riverBoardBoostPulse{
      0%{ filter: brightness(1) saturate(1); }
      35%{ filter: brightness(1.22) saturate(1.14); }
      100%{ filter: brightness(1) saturate(1); }
    }
    @keyframes riverBoardFlash{
      0%{ opacity: 0; transform: scale(.92); }
      18%{ opacity: 1; transform: scale(1); }
      100%{ opacity: 0; transform: scale(1.06); }
    }
    @keyframes riverCardBoost{
      0%{
        transform: translateY(10px) scale(.9) rotateX(14deg);
        filter: brightness(1) saturate(1);
      }
      28%{
        transform: translateY(-6px) scale(1.1) rotateX(0deg);
        filter: brightness(1.4) saturate(1.2);
      }
      55%{
        transform: translateY(0) scale(1.02);
        filter: brightness(1.18) saturate(1.08);
      }
      100%{
        transform: translateY(0) scale(1);
        filter: brightness(1) saturate(1);
      }
    }
    @keyframes riverCardAura{
      0%{ opacity: 0; transform: scale(.55); }
      28%{ opacity: 1; transform: scale(1); }
      100%{ opacity: 0; transform: scale(1.5); }
    }
    @keyframes riverAllCardsPulse{
      0%{
        transform: scale(1);
        filter: brightness(1) saturate(1);
      }
      32%{
        transform: scale(1.07);
        filter: brightness(1.28) saturate(1.2);
      }
      100%{
        transform: scale(1);
        filter: brightness(1) saturate(1);
      }
    }
  `;
  document.head.appendChild(style);
  riverRevealBoostStyleInjected = true;
}

function triggerRiverRevealBoost() {
  const board = document.getElementById('board');
  const river = document.getElementById('river');
  if (!board || !river) return;
  ensureRiverRevealBoostStyle();

  board.classList.remove('river-reveal-boost');
  river.classList.remove('river-card-boost');
  const boardCards = ['flop1', 'flop2', 'flop3', 'turn', 'river']
    .map((id) => document.getElementById(id))
    .filter(Boolean);
  boardCards.forEach((el) => el.classList.remove('river-all-cards-pulse'));
  void board.offsetWidth;
  void river.offsetWidth;
  board.classList.add('river-reveal-boost');
  river.classList.add('river-card-boost');

  if (board._riverBoostTimer) clearTimeout(board._riverBoostTimer);
  if (board._riverAllPulseTimer) clearTimeout(board._riverAllPulseTimer);
  if (board._riverAllPulseClearTimer) clearTimeout(board._riverAllPulseClearTimer);
  if (river._riverBoostTimer) clearTimeout(river._riverBoostTimer);
  board._riverBoostTimer = setTimeout(() => {
    board.classList.remove('river-reveal-boost');
    board._riverBoostTimer = null;
  }, 2650);
  river._riverBoostTimer = setTimeout(() => {
    river.classList.remove('river-card-boost');
    river._riverBoostTimer = null;
  }, 3200);
  board._riverAllPulseTimer = setTimeout(() => {
    boardCards.forEach((el) => {
      el.classList.remove('river-all-cards-pulse');
      void el.offsetWidth;
      el.classList.add('river-all-cards-pulse');
    });
    board._riverAllPulseTimer = null;
  }, 2600);
  board._riverAllPulseClearTimer = setTimeout(() => {
    boardCards.forEach((el) => el.classList.remove('river-all-cards-pulse'));
    board._riverAllPulseClearTimer = null;
  }, 4700);
}

function maybeTriggerRiverRevealBoost(prevState, nextState) {
  if (!prevState || !nextState) return;
  const prevPhase = String(prevState.phase || '').toLowerCase();
  const nextPhase = String(nextState.phase || '').toLowerCase();
  const prevRiverKnown = Boolean(prevState.board?.[4]);
  const nextRiverKnown = Boolean(nextState.board?.[4]);

  const phaseCrossedToRiverWindow =
    (prevPhase !== nextPhase) &&
    (nextPhase === 'river' || nextPhase === 'reveal') &&
    (prevPhase !== 'river' && prevPhase !== 'reveal');

  const riverJustAppeared = !prevRiverKnown && nextRiverKnown;
  if (phaseCrossedToRiverWindow || riverJustAppeared) {
    triggerRiverRevealBoost();
  }
}

function ensureCheckPassStyle() {
  if (checkPassStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'check-pass-style';
  style.textContent = `
    :is(#poker_table, .poker-table) .seat.check-pass-tap .name-chips{
      animation: checkTapDouble 2600ms cubic-bezier(.2,.78,.18,1) !important;
      will-change: filter, box-shadow, background;
    }
    :is(#poker_table, .poker-table) .seat .name-chips{
      position: relative;
      overflow: visible;
    }
    :is(#poker_table, .poker-table) .seat .name-chips .check-tap-overlay{
      position: absolute;
      inset: -4px;
      border-radius: 12px;
      pointer-events: none;
      background:
        radial-gradient(circle at 50% 50%, rgba(116,255,174,.46), rgba(116,255,174,0) 68%),
        radial-gradient(circle at 50% 50%, rgba(255,255,255,.16), rgba(255,255,255,0) 72%);
      box-shadow:
        0 0 0 1px rgba(116,255,174,.65),
        0 0 16px rgba(116,255,174,.55);
      opacity: 0;
      transform: scale(.88);
      transform-origin: center center;
      animation: checkTapOverlayPulse 1300ms ease-out var(--d, 0ms) forwards;
      mix-blend-mode: screen;
      z-index: 2;
    }
    @keyframes checkTapOverlayPulse{
      0%{
        opacity: 0;
        transform: scale(.88);
      }
      20%{
        opacity: 1;
        transform: scale(1);
      }
      100%{
        opacity: 0;
        transform: scale(1.12);
      }
    }
    @keyframes checkTapDouble{
      0%{
        filter: brightness(1) saturate(1);
        box-shadow:
          0 0 0 rgba(116,255,174,0),
          inset 0 0 0 rgba(116,255,174,0);
      }
      28%{
        filter: brightness(1.3) saturate(1.18);
        box-shadow:
          0 0 22px rgba(116,255,174,.82),
          inset 0 0 24px rgba(116,255,174,.36);
      }
      52%{
        filter: brightness(1) saturate(1);
        box-shadow:
          0 0 0 rgba(116,255,174,0),
          inset 0 0 0 rgba(116,255,174,0);
      }
      84%{
        filter: brightness(1.32) saturate(1.2);
        box-shadow:
          0 0 24px rgba(116,255,174,.86),
          inset 0 0 26px rgba(116,255,174,.4);
      }
      100%{
        filter: brightness(1) saturate(1);
        box-shadow:
          0 0 0 rgba(116,255,174,0),
          inset 0 0 0 rgba(116,255,174,0);
      }
    }
  `;
  document.head.appendChild(style);
  checkPassStyleInjected = true;
}

function triggerCheckPass(seatIdx) {
  const seat = document.getElementById('seat' + seatIdx);
  if (!seat) return;
  ensureCheckPassStyle();
  document.querySelectorAll('.name-chips.check-tap-host').forEach((el) => {
    el.classList.remove('check-tap-host');
  });
  const chipBox = seat.querySelector('.name-chips');
  if (chipBox) {
    // Hard-reset any previous overlays from older CHECK events.
    chipBox.querySelectorAll('.check-tap-overlay').forEach((el) => el.remove());

    const makeTap = (delayMs) => {
      const tap = document.createElement('span');
      tap.className = 'check-tap-overlay';
      tap.style.setProperty('--d', `${delayMs}ms`);
      chipBox.appendChild(tap);
      setTimeout(() => tap.remove(), delayMs + 1460);
    };
    makeTap(0);
    makeTap(760);
  }

  seat.classList.remove('check-pass-tap');
  void seat.offsetWidth;
  seat.classList.add('check-pass-tap');
  if (seat._checkPassTimer) clearTimeout(seat._checkPassTimer);
  seat._checkPassTimer = setTimeout(() => {
    seat.classList.remove('check-pass-tap');
    seat._checkPassTimer = null;
  }, 2800);
}

function maybeTriggerCheckPass(prevState, nextState) {
  if (!prevState || !nextState) return;
  if (!Array.isArray(prevState.players) || !Array.isArray(nextState.players)) return;
  const phase = String(nextState.phase || '').toLowerCase();
  if (!['preflop', 'flop', 'turn', 'river', 'reveal'].includes(phase)) return;

  const count = Math.min(prevState.players.length, nextState.players.length);
  const prevActor = Number.isInteger(prevState.current_bettor_index) ? prevState.current_bettor_index : -1;
  if (prevActor < 0 || prevActor >= count) return;

  const before = prevState.players[prevActor];
  const after = nextState.players[prevActor];
  if (!before || !after || after.inactive) return;

  const prevPhase = String(prevState.phase || '').toLowerCase();
  const nextPhase = String(nextState.phase || '').toLowerCase();
  const phaseChanged = prevPhase !== nextPhase;
  const turnPassed = Number(nextState.current_bettor_index) !== prevActor;
  if (!phaseChanged && !turnPassed) return; // actor has not completed action yet

  const beforeBet = Math.max(0, Number(before.subtotal_bet) || 0);
  const prevCurrentBet = Math.max(0, Number(prevState.current_bet) || 0);
  const toCallBefore = Math.max(0, prevCurrentBet - beforeBet);
  const statusAfter = String(after.status || '').toUpperCase();
  const potDelta = Math.max(0, (Number(nextState.pot) || 0) - (Number(prevState.pot) || 0));
  const isActionPhaseTransition = phaseChanged && ['preflop', 'flop', 'turn', 'river'].includes(nextPhase);

  const isExplicitCheck = statusAfter === 'CHECK';
  const isImplicitStreetEndCheck =
    toCallBefore === 0 &&
    isActionPhaseTransition &&
    potDelta === 0 &&
    !['FOLD', 'BUST', 'RAISE', 'ALLIN', 'WINNER'].includes(statusAfter);
  const isZeroAmountCallOption =
    statusAfter === 'CALL' &&
    toCallBefore === 0 &&
    (phaseChanged || turnPassed) &&
    potDelta === 0;

  if (isExplicitCheck || isImplicitStreetEndCheck || isZeroAmountCallOption) {
    triggerCheckPass(prevActor);
  }
}

function ensureCallPulseStyle() {
  if (callPulseStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'call-pulse-style';
  style.textContent = `
    :is(#poker_table, .poker-table) .seat.call-pulse{
      outline: none !important;
      box-shadow: none !important;
    }
    :is(#poker_table, .poker-table) .seat.call-pulse .name-chips{
      --seat-neon: #a855f7 !important;
      background:
        radial-gradient(130% 95% at 50% 54%, rgba(168, 85, 247, .30), transparent 64%),
        linear-gradient(180deg, rgba(20,8,34,.80), rgba(20,8,34,.88)) !important;
      color: #e9d5ff !important;
      border-color: rgba(168, 85, 247, .98) !important;
      box-shadow:
        0 0 0 1px rgba(216, 180, 255, .95),
        0 0 18px rgba(168, 85, 247, .84),
        inset 0 0 16px rgba(192, 132, 252, .24);
      animation: callSeatPulseOnce 860ms cubic-bezier(.2,.78,.2,1) 1;
      will-change: box-shadow, border-color, filter;
    }
    :is(#poker_table, .poker-table) .seat.call-pulse .name-chips .player-name,
    :is(#poker_table, .poker-table) .seat.call-pulse .name-chips .chips{
      color: #e9d5ff !important;
      text-shadow: 0 0 7px rgba(168, 85, 247, .58), 0 1px 0 rgba(0,0,0,.75) !important;
    }
    :is(#poker_table, .poker-table) .seat.call-pulse .name-chips::before{
      background:
        radial-gradient(78% 60% at 50% 52%, rgba(168, 85, 247, .30), rgba(168, 85, 247, 0) 70%),
        repeating-linear-gradient(to bottom, rgba(224, 190, 255, .11) 0 1px, transparent 1px 4px) !important;
      opacity: .62 !important;
      animation: none !important;
    }
    :is(#poker_table, .poker-table) .seat.call-pulse .name-chips::after{
      padding: 2px !important;
      background: linear-gradient(90deg, #d8b4fe, #a855f7, #d8b4fe) !important;
      box-shadow:
        0 0 10px rgba(216, 180, 255, .90),
        0 0 30px rgba(168, 85, 247, .80) !important;
      animation: callRingPulseOnce 860ms ease-out 1 !important;
    }
    @keyframes callRingPulseOnce{
      0%{
        box-shadow:
          0 0 8px rgba(216, 180, 255, .60),
          0 0 16px rgba(168, 85, 247, .48);
      }
      45%{
        box-shadow:
          0 0 14px rgba(233, 213, 255, .98),
          0 0 40px rgba(168, 85, 247, .95);
      }
      100%{
        box-shadow:
          0 0 9px rgba(216, 180, 255, .68),
          0 0 20px rgba(168, 85, 247, .58);
      }
    }
    @keyframes callSeatPulseOnce{
      0%{
        filter: brightness(1) saturate(1);
        border-color: rgba(255, 166, 78, .70);
        box-shadow:
          0 0 0 1px rgba(255, 191, 122, .72),
          0 0 8px rgba(255, 132, 32, .45),
          inset 0 0 6px rgba(255, 182, 92, .18);
      }
      45%{
        filter: brightness(1.2) saturate(1.18);
        border-color: rgba(255, 178, 92, .98);
        box-shadow:
          0 0 0 1px rgba(255, 205, 146, .98),
          0 0 24px rgba(255, 130, 30, .92),
          inset 0 0 16px rgba(255, 190, 104, .35);
      }
      100%{
        filter: brightness(1) saturate(1);
        border-color: rgba(255, 166, 78, .80);
        box-shadow:
          0 0 0 1px rgba(255, 191, 122, .8),
          0 0 10px rgba(255, 132, 32, .52),
          inset 0 0 8px rgba(255, 182, 92, .2);
      }
    }
  `;
  document.head.appendChild(style);
  callPulseStyleInjected = true;
}

function ensureBetPulseStyle() {
  if (betPulseStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'bet-pulse-style';
  style.textContent = `
    :is(#poker_table, .poker-table) .seat.bet-pulse{
      outline: none !important;
      box-shadow: none !important;
    }
    :is(#poker_table, .poker-table) .seat.bet-pulse .name-chips{
      --seat-neon: #00ff66 !important;
      background:
        radial-gradient(130% 95% at 50% 54%, rgba(0, 255, 102, .42), transparent 64%),
        linear-gradient(180deg, rgba(4,28,16,.86), rgba(4,28,16,.94)) !important;
      color: #eafff2 !important;
      border-color: rgba(0, 255, 102, .99) !important;
      box-shadow:
        0 0 0 1px rgba(210, 255, 228, .98),
        0 0 30px rgba(0, 255, 102, .98),
        inset 0 0 18px rgba(120, 255, 175, .30);
      animation: betSeatPulseOnce 900ms cubic-bezier(.2,.78,.2,1) 1;
      will-change: box-shadow, border-color, filter;
    }
    :is(#poker_table, .poker-table) .seat.bet-pulse .name-chips .player-name,
    :is(#poker_table, .poker-table) .seat.bet-pulse .name-chips .chips{
      color: #eafff2 !important;
      text-shadow: 0 0 10px rgba(0, 255, 102, .8), 0 1px 0 rgba(0,0,0,.75) !important;
    }
    :is(#poker_table, .poker-table) .seat.bet-pulse .name-chips::before{
      background:
        radial-gradient(78% 60% at 50% 52%, rgba(0, 255, 102, .45), rgba(0, 255, 102, 0) 70%),
        repeating-linear-gradient(to bottom, rgba(220, 255, 236, .14) 0 1px, transparent 1px 4px) !important;
      opacity: .74 !important;
      animation: none !important;
    }
    :is(#poker_table, .poker-table) .seat.bet-pulse .name-chips::after{
      padding: 2px !important;
      background: linear-gradient(90deg, #d6ffe8, #00ff66, #d6ffe8) !important;
      box-shadow:
        0 0 16px rgba(214, 255, 232, .95),
        0 0 42px rgba(0, 255, 102, .92) !important;
      animation: betRingPulseOnce 900ms ease-out 1 !important;
    }
    @keyframes betRingPulseOnce{
      0%{
        box-shadow:
          0 0 10px rgba(214, 255, 232, .72),
          0 0 22px rgba(0, 255, 102, .6);
      }
      45%{
        box-shadow:
          0 0 20px rgba(234, 255, 242, .99),
          0 0 52px rgba(0, 255, 102, .99);
      }
      100%{
        box-shadow:
          0 0 12px rgba(214, 255, 232, .8),
          0 0 28px rgba(0, 255, 102, .7);
      }
    }
    @keyframes betSeatPulseOnce{
      0%{
        filter: brightness(1) saturate(1);
        border-color: rgba(0, 255, 102, .82);
      }
      45%{
        filter: brightness(1.3) saturate(1.26);
        border-color: rgba(120, 255, 175, .99);
      }
      100%{
        filter: brightness(1) saturate(1);
        border-color: rgba(0, 255, 102, .9);
      }
    }
  `;
  document.head.appendChild(style);
  betPulseStyleInjected = true;
}

function ensureAllInRedStyle() {
  if (allInRedStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'allin-red-style';
  style.textContent = `
    :is(#poker_table, .poker-table) .seat.is-allin-bg .name-chips{
      --seat-neon: #ff2d2d !important;
      background:
        radial-gradient(130% 95% at 50% 54%, rgba(255, 45, 45, .28), transparent 64%),
        linear-gradient(180deg, rgba(34,8,8,.82), rgba(34,8,8,.9)) !important;
      color: #ffd8d8 !important;
      border-color: rgba(255, 66, 66, .98) !important;
      box-shadow:
        0 0 0 1px rgba(255, 184, 184, .9),
        0 0 22px rgba(255, 45, 45, .84),
        inset 0 0 16px rgba(255, 120, 120, .2) !important;
      animation: allInRedSeatPulse 1600ms ease-in-out infinite !important;
      will-change: box-shadow, border-color, filter;
    }
    :is(#poker_table, .poker-table) .seat.is-allin-bg .name-chips .player-name,
    :is(#poker_table, .poker-table) .seat.is-allin-bg .name-chips .chips{
      color: #ffdede !important;
      text-shadow: 0 0 8px rgba(255, 92, 92, .56), 0 1px 0 rgba(0,0,0,.78) !important;
    }
    :is(#poker_table, .poker-table) .seat.is-allin-bg .name-chips::before{
      background:
        radial-gradient(78% 60% at 50% 52%, rgba(255, 60, 60, .32), rgba(255, 60, 60, 0) 70%),
        repeating-linear-gradient(to bottom, rgba(255, 210, 210, .1) 0 1px, transparent 1px 4px) !important;
      opacity: .68 !important;
      animation: allInRedInnerPulse 1600ms ease-in-out infinite !important;
    }
    :is(#poker_table, .poker-table) .seat.is-allin-bg .name-chips::after{
      padding: 2px !important;
      background: linear-gradient(90deg, #ffb4b4, #ff2d2d, #ffb4b4) !important;
      box-shadow:
        0 0 12px rgba(255, 170, 170, .86),
        0 0 34px rgba(255, 45, 45, .84) !important;
      animation: allInRedRingPulse 1600ms ease-in-out infinite !important;
    }
    @keyframes allInRedSeatPulse{
      0%, 100%{
        filter: brightness(1) saturate(1);
        border-color: rgba(255, 88, 88, .86);
        box-shadow:
          0 0 0 1px rgba(255, 184, 184, .84),
          0 0 16px rgba(255, 45, 45, .62),
          inset 0 0 10px rgba(255, 120, 120, .18);
      }
      50%{
        filter: brightness(1.28) saturate(1.24);
        border-color: rgba(255, 130, 130, .99);
        box-shadow:
          0 0 0 1px rgba(255, 214, 214, .98),
          0 0 34px rgba(255, 45, 45, .98),
          inset 0 0 18px rgba(255, 160, 160, .34);
      }
    }
    @keyframes allInRedInnerPulse{
      0%, 100%{ opacity: .5; }
      50%{ opacity: .95; }
    }
    @keyframes allInRedRingPulse{
      0%, 100%{
        box-shadow:
          0 0 10px rgba(255, 170, 170, .64),
          0 0 20px rgba(255, 45, 45, .52);
      }
      50%{
        box-shadow:
          0 0 16px rgba(255, 205, 205, .98),
          0 0 44px rgba(255, 45, 45, .98);
      }
    }
  `;
  document.head.appendChild(style);
  allInRedStyleInjected = true;
}

function triggerCallPulse(seatIdx) {
  const seat = document.getElementById('seat' + seatIdx);
  if (!seat) return;
  ensureCallPulseStyle();
  seat.classList.remove('call-pulse');
  void seat.offsetWidth;
  seat.classList.add('call-pulse');
  if (seat._callPulseTimer) clearTimeout(seat._callPulseTimer);
  seat._callPulseTimer = setTimeout(() => {
    seat.classList.remove('call-pulse');
    seat._callPulseTimer = null;
  }, 2300);
}

function triggerBetPulse(seatIdx) {
  const seat = document.getElementById('seat' + seatIdx);
  if (!seat) return;
  ensureBetPulseStyle();
  seat.classList.remove('bet-pulse');
  void seat.offsetWidth;
  seat.classList.add('bet-pulse');
  if (seat._betPulseTimer) clearTimeout(seat._betPulseTimer);
  seat._betPulseTimer = setTimeout(() => {
    seat.classList.remove('bet-pulse');
    seat._betPulseTimer = null;
  }, 3000);
}

function getSmallBlindIndexFromState(state) {
  if (!state) return null;
  if (typeof state.smallBlindIndex === 'number') return state.smallBlindIndex;
  if (typeof state.sbIndex === 'number') return state.sbIndex;
  if (typeof state.small_blind_index === 'number') return state.small_blind_index;
  return null;
}

function getSmallBlindAmountFromState(state) {
  if (!state) return 0;
  const raw = state.smallBlindAmount ?? state.smallBlind ?? state.sbAmount ?? state.small_blind ?? 0;
  return Math.max(0, Number(raw) || 0);
}

function maybeTriggerCallPulse(prevState, nextState) {
  if (!prevState || !nextState) return;
  if (!Array.isArray(prevState.players) || !Array.isArray(nextState.players)) return;
  const phase = String(nextState.phase || '').toLowerCase();
  if (!['preflop', 'flop', 'turn', 'river', 'reveal'].includes(phase)) return;

  const count = Math.min(prevState.players.length, nextState.players.length);
  const prevActor = Number.isInteger(prevState.current_bettor_index) ? prevState.current_bettor_index : -1;
  if (prevActor < 0 || prevActor >= count) return;

  const before = prevState.players[prevActor];
  const after = nextState.players[prevActor];
  if (!before || !after || after.inactive) return;

  const prevPhase = String(prevState.phase || '').toLowerCase();
  const nextPhase = String(nextState.phase || '').toLowerCase();
  const phaseChanged = prevPhase !== nextPhase;

  const beforeBet = Math.max(0, Number(before.subtotal_bet) || 0);
  const afterBet = Math.max(0, Number(after.subtotal_bet) || 0);
  const prevCurrentBet = Math.max(0, Number(prevState.current_bet) || 0);
  const toCallBefore = Math.max(0, prevCurrentBet - beforeBet);
  if (toCallBefore <= 0) return;

  const statusAfter = String(after.status || '').toUpperCase();
  const statusBefore = String(before.status || '').toUpperCase();
  if (statusAfter === 'FOLD' || statusAfter === 'BUST') return;

  // If the phase changes immediately after action, server may reset subtotal_bet/status
  // before emitting state. Use pot delta as fallback to infer the actor contribution.
  const potDelta = Math.max(0, (Number(nextState.pot) || 0) - (Number(prevState.pot) || 0));
  const actorDelta = phaseChanged ? potDelta : Math.max(0, afterBet - beforeBet);
  if (actorDelta <= 0) return;
  // Un all-in doit rester rouge immÃƒÂ©diatement (pas de pulse "call" violet).
  if (statusAfter === 'ALLIN' || ((Number(after.bankroll) || 0) <= 0)) return;

  const explicitCall = statusAfter === 'CALL';
  const exactCallByAmount = actorDelta >= toCallBefore;
  const phaseChangedLikelyCall =
    phaseChanged &&
    exactCallByAmount &&
    !['RAISE', 'ALLIN', 'FOLD', 'BUST'].includes(statusBefore);

  if (!(explicitCall || exactCallByAmount || phaseChangedLikelyCall)) return;

  triggerCallPulse(prevActor);
}

function maybeTriggerBetPulse(prevState, nextState) {
  if (!prevState || !nextState) return;
  if (!Array.isArray(prevState.players) || !Array.isArray(nextState.players)) return;
  if (prevState.phase !== nextState.phase && String(nextState.phase) === 'preflop') return;
  const phase = String(nextState.phase || '').toLowerCase();
  if (!['preflop', 'flop', 'turn', 'river', 'reveal'].includes(phase)) return;

  const count = Math.min(prevState.players.length, nextState.players.length);
  const prevActor = Number.isInteger(prevState.current_bettor_index) ? prevState.current_bettor_index : -1;
  if (prevActor < 0 || prevActor >= count) return;

  const before = prevState.players[prevActor];
  const after = nextState.players[prevActor];
  if (!before || !after || after.inactive) return;

  const prevPhase = String(prevState.phase || '').toLowerCase();
  const nextPhase = String(nextState.phase || '').toLowerCase();
  const phaseChanged = prevPhase !== nextPhase;

  const beforeBet = Math.max(0, Number(before.subtotal_bet) || 0);
  const afterBet = Math.max(0, Number(after.subtotal_bet) || 0);
  const prevCurrentBet = Math.max(0, Number(prevState.current_bet) || 0);
  const toCallBefore = Math.max(0, prevCurrentBet - beforeBet);
  const statusAfter = String(after.status || '').toUpperCase();
  if (statusAfter === 'FOLD' || statusAfter === 'BUST') return;
  if (statusAfter === 'ALLIN' || ((Number(after.bankroll) || 0) <= 0)) return;

  const potDelta = Math.max(0, (Number(nextState.pot) || 0) - (Number(prevState.pot) || 0));
  const actorDelta = phaseChanged ? potDelta : Math.max(0, afterBet - beforeBet);
  if (actorDelta <= 0) return;

  const sbIdx = getSmallBlindIndexFromState(nextState) ?? getSmallBlindIndexFromState(prevState);
  const sbAmount = getSmallBlindAmountFromState(nextState) || getSmallBlindAmountFromState(prevState);
  const isPreflopBlindWindow = nextPhase === 'preflop';
  const isNewPreflopHand = prevPhase !== 'preflop' && nextPhase === 'preflop';
  const isAutoSmallBlindPost =
    isPreflopBlindWindow &&
    Number.isInteger(sbIdx) &&
    prevActor === sbIdx &&
    sbAmount > 0 &&
    actorDelta <= (sbAmount + 0.0001) &&
    (
      // Usual hand start transition.
      isNewPreflopHand ||
      // Some servers emit multiple preflop snapshots while posting forced blinds.
      // In that case there is no amount to call yet for SB (forced post, not an action bet).
      toCallBefore <= 0
    );
  if (isAutoSmallBlindPost) return;

  const explicitRaise = statusAfter === 'RAISE';
  const betAboveCall = actorDelta > toCallBefore;
  if (!(explicitRaise || betAboveCall)) return;

  triggerBetPulse(prevActor);
}

function getQuadPoint(start, control, end, t) {
  const omt = 1 - t;
  return {
    x: (omt * omt * start.x) + (2 * omt * t * control.x) + (t * t * end.x),
    y: (omt * omt * start.y) + (2 * omt * t * control.y) + (t * t * end.y)
  };
}

function getQuadTangent(start, control, end, t) {
  return {
    x: 2 * (1 - t) * (control.x - start.x) + 2 * t * (end.x - control.x),
    y: 2 * (1 - t) * (control.y - start.y) + 2 * t * (end.y - control.y)
  };
}

function spawnPotScoopBurst(layer, end) {
  const ns = 'http://www.w3.org/2000/svg';
  const burst = document.createElementNS(ns, 'g');
  burst.setAttribute('data-pot-scoop-burst', String(++betBeamFxSeq));

  const core = document.createElementNS(ns, 'circle');
  core.setAttribute('cx', end.x.toFixed(2));
  core.setAttribute('cy', end.y.toFixed(2));
  core.setAttribute('r', '14');
  core.setAttribute('class', 'pot-scoop-burst-core');
  burst.appendChild(core);

  const rayCount = 14;
  for (let i = 0; i < rayCount; i++) {
    const a = (Math.PI * 2 * i) / rayCount + (Math.random() * 0.22);
    const dist = 46 + Math.random() * 44;
    const ray = document.createElementNS(ns, 'line');
    ray.setAttribute('x1', end.x.toFixed(2));
    ray.setAttribute('y1', end.y.toFixed(2));
    ray.setAttribute('x2', (end.x + Math.cos(a) * dist).toFixed(2));
    ray.setAttribute('y2', (end.y + Math.sin(a) * dist).toFixed(2));
    ray.setAttribute('pathLength', '1');
    ray.setAttribute('class', 'pot-scoop-burst-ray');
    ray.style.setProperty('--delay', `${Math.round(Math.random() * 140)}ms`);
    burst.appendChild(ray);
  }

  const sparkCount = 24;
  for (let i = 0; i < sparkCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const dist = 44 + Math.random() * 58;
    const spark = document.createElementNS(ns, 'circle');
    spark.setAttribute('cx', end.x.toFixed(2));
    spark.setAttribute('cy', end.y.toFixed(2));
    spark.setAttribute('r', (2.3 + Math.random() * 2.2).toFixed(2));
    spark.setAttribute('class', 'pot-scoop-burst-spark');
    spark.style.setProperty('--dx', `${(Math.cos(a) * dist).toFixed(2)}px`);
    spark.style.setProperty('--dy', `${(Math.sin(a) * dist).toFixed(2)}px`);
    spark.style.setProperty('--delay', `${Math.round(Math.random() * 170)}ms`);
    burst.appendChild(spark);
  }

  layer.appendChild(burst);
  setTimeout(() => burst.remove(), 1600);
}

function spawnSeatFireworkBurst(layer, end, theme = 0, power = 1) {
  const ns = 'http://www.w3.org/2000/svg';
  const burst = document.createElementNS(ns, 'g');
  burst.setAttribute('data-seat-firework-burst', String(++betBeamFxSeq));
  const fxPower = Math.max(0.7, Math.min(1.9, Number(power) || 1));
  const isGrandBurst = fxPower >= 1.22;

  const palettes = [
    { main: '#ffd447', accent: '#48d2ff' },
    { main: '#ff6e5b', accent: '#ffd447' },
    { main: '#48d2ff', accent: '#7e59ff' },
    { main: '#2bd38a', accent: '#48d2ff' }
  ];
  const palette = palettes[((Number(theme) || 0) % palettes.length + palettes.length) % palettes.length];
  burst.style.setProperty('--firework-main', palette.main);
  burst.style.setProperty('--firework-accent', palette.accent);

  const core = document.createElementNS(ns, 'circle');
  core.setAttribute('cx', end.x.toFixed(2));
  core.setAttribute('cy', end.y.toFixed(2));
  core.setAttribute('r', (15 + (fxPower * 4)).toFixed(2));
  core.setAttribute('class', 'seat-firework-burst-core');
  burst.appendChild(core);

  if (isGrandBurst) {
    const shock1 = document.createElementNS(ns, 'circle');
    shock1.setAttribute('cx', end.x.toFixed(2));
    shock1.setAttribute('cy', end.y.toFixed(2));
    shock1.setAttribute('r', (14 + (fxPower * 2)).toFixed(2));
    shock1.setAttribute('class', 'seat-firework-shockwave');
    shock1.style.setProperty('--shock-scale', (2.2 + (fxPower * 0.42)).toFixed(2));
    burst.appendChild(shock1);

    const shock2 = document.createElementNS(ns, 'circle');
    shock2.setAttribute('cx', end.x.toFixed(2));
    shock2.setAttribute('cy', end.y.toFixed(2));
    shock2.setAttribute('r', (11.5 + (fxPower * 1.7)).toFixed(2));
    shock2.setAttribute('class', 'seat-firework-shockwave');
    shock2.style.setProperty('--shock-delay', '120ms');
    shock2.style.setProperty('--shock-scale', (2.9 + (fxPower * 0.5)).toFixed(2));
    burst.appendChild(shock2);
  }

  const rayCount = Math.max(14, Math.round(18 * fxPower));
  for (let i = 0; i < rayCount; i++) {
    const a = (Math.PI * 2 * i) / rayCount + ((Math.random() - 0.5) * 0.28);
    const dist = (52 + Math.random() * 64) * (0.88 + (fxPower * 0.38));
    const ray = document.createElementNS(ns, 'line');
    ray.setAttribute('x1', end.x.toFixed(2));
    ray.setAttribute('y1', end.y.toFixed(2));
    ray.setAttribute('x2', (end.x + Math.cos(a) * dist).toFixed(2));
    ray.setAttribute('y2', (end.y + Math.sin(a) * dist).toFixed(2));
    ray.setAttribute('pathLength', '1');
    ray.setAttribute('class', 'seat-firework-burst-ray');
    ray.style.setProperty('--delay', `${Math.round(Math.random() * 120)}ms`);
    burst.appendChild(ray);
  }

  const sparkCount = Math.max(22, Math.round(30 * fxPower));
  for (let i = 0; i < sparkCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const dist = (58 + Math.random() * 90) * (0.84 + (fxPower * 0.35));
    const spark = document.createElementNS(ns, 'circle');
    spark.setAttribute('cx', end.x.toFixed(2));
    spark.setAttribute('cy', end.y.toFixed(2));
    spark.setAttribute('r', (1.7 + Math.random() * (2 + fxPower)).toFixed(2));
    spark.setAttribute('class', 'seat-firework-burst-spark');
    spark.style.setProperty('--dx', `${(Math.cos(a) * dist).toFixed(2)}px`);
    spark.style.setProperty('--dy', `${(Math.sin(a) * dist).toFixed(2)}px`);
    spark.style.setProperty('--delay', `${Math.round(Math.random() * 140)}ms`);
    burst.appendChild(spark);
  }

  if (isGrandBurst) {
    const emberCount = Math.round(14 + (fxPower * 8));
    for (let i = 0; i < emberCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const dist = (68 + Math.random() * 96) * (0.88 + (fxPower * 0.34));
      const ember = document.createElementNS(ns, 'circle');
      ember.setAttribute('cx', end.x.toFixed(2));
      ember.setAttribute('cy', end.y.toFixed(2));
      ember.setAttribute('r', (1 + Math.random() * 1.8).toFixed(2));
      ember.setAttribute('class', 'seat-firework-ember');
      ember.style.setProperty('--dx', `${(Math.cos(a) * dist).toFixed(2)}px`);
      ember.style.setProperty('--dy', `${(Math.sin(a) * dist).toFixed(2)}px`);
      ember.style.setProperty('--delay', `${Math.round(40 + Math.random() * 240)}ms`);
      burst.appendChild(ember);
    }
  }

  layer.appendChild(burst);
  setTimeout(() => burst.remove(), isGrandBurst ? 2350 : 1700);
}

function spawnMobileSeatWinnerBurst(layer, end, theme = 0, power = 1) {
  const ns = 'http://www.w3.org/2000/svg';
  const burst = document.createElementNS(ns, 'g');
  burst.setAttribute('data-mobile-seat-burst', String(++betBeamFxSeq));
  const fxPower = Math.max(0.85, Math.min(1.8, Number(power) || 1));

  const palettes = [
    { main: '#ffd447', accent: '#48d2ff' },
    { main: '#ff6e5b', accent: '#ffd447' },
    { main: '#48d2ff', accent: '#7e59ff' },
    { main: '#2bd38a', accent: '#48d2ff' }
  ];
  const palette = palettes[((Number(theme) || 0) % palettes.length + palettes.length) % palettes.length];
  burst.style.setProperty('--firework-main', palette.main);
  burst.style.setProperty('--firework-accent', palette.accent);

  const ring = document.createElementNS(ns, 'circle');
  ring.setAttribute('cx', end.x.toFixed(2));
  ring.setAttribute('cy', end.y.toFixed(2));
  ring.setAttribute('r', (12 + (fxPower * 2.1)).toFixed(2));
  ring.setAttribute('class', 'mobile-seat-burst-ring');
  burst.appendChild(ring);

  const core = document.createElementNS(ns, 'circle');
  core.setAttribute('cx', end.x.toFixed(2));
  core.setAttribute('cy', end.y.toFixed(2));
  core.setAttribute('r', (10 + (fxPower * 2.3)).toFixed(2));
  core.setAttribute('class', 'mobile-seat-burst-core');
  burst.appendChild(core);

  if (fxPower >= 1.18) {
    const shock = document.createElementNS(ns, 'circle');
    shock.setAttribute('cx', end.x.toFixed(2));
    shock.setAttribute('cy', end.y.toFixed(2));
    shock.setAttribute('r', (10 + (fxPower * 2.2)).toFixed(2));
    shock.setAttribute('class', 'mobile-seat-burst-shockwave');
    shock.style.setProperty('--m-shock-scale', (2 + (fxPower * 0.35)).toFixed(2));
    burst.appendChild(shock);
  }

  const sparkCount = Math.max(10, Math.round(10 * fxPower));
  for (let i = 0; i < sparkCount; i++) {
    const a = (Math.PI * 2 * i) / sparkCount + ((Math.random() - 0.5) * 0.22);
    const dist = (26 + Math.random() * 26) * (0.88 + (fxPower * 0.34));
    const spark = document.createElementNS(ns, 'circle');
    spark.setAttribute('cx', end.x.toFixed(2));
    spark.setAttribute('cy', end.y.toFixed(2));
    spark.setAttribute('r', (1.9 + Math.random() * 1.4).toFixed(2));
    spark.setAttribute('class', 'mobile-seat-burst-spark');
    spark.style.setProperty('--dx', `${(Math.cos(a) * dist).toFixed(2)}px`);
    spark.style.setProperty('--dy', `${(Math.sin(a) * dist).toFixed(2)}px`);
    spark.style.setProperty('--delay', `${Math.round(Math.random() * 90)}ms`);
    burst.appendChild(spark);
  }

  layer.appendChild(burst);
  setTimeout(() => burst.remove(), fxPower >= 1.18 ? 1480 : 1100);
}

function triggerMobileWinnerSeatExplosion(seatIdx, delayMs = 0, theme = 0, power = 1) {
  setTimeout(() => {
    const seatEl = document.getElementById('seat' + seatIdx);
    if (!seatEl) return;
    const targetAnchor = seatEl.querySelector('.name-chips') || seatEl;
    const end = getCenterPoint(targetAnchor);
    if (!end) return;

    const layer = ensureBetBeamFxLayer();
    if (!layer) return;
    const { width: viewW, height: viewH } = getFxViewportSize();
    layer.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    layer.setAttribute('width', String(viewW));
    layer.setAttribute('height', String(viewH));

    spawnMobileSeatWinnerBurst(layer, end, theme, power);

    seatEl.classList.remove('winner-mobile-seat-hit');
    seatEl.classList.remove('winner-grand-hit');
    void seatEl.offsetWidth;
    seatEl.classList.add((Number(power) || 1) >= 1.2 ? 'winner-grand-hit' : 'winner-mobile-seat-hit');
    if (seatEl._winnerMobileSeatTimer) clearTimeout(seatEl._winnerMobileSeatTimer);
    seatEl._winnerMobileSeatTimer = setTimeout(() => {
      seatEl.classList.remove('winner-mobile-seat-hit');
      seatEl.classList.remove('winner-grand-hit');
      seatEl._winnerMobileSeatTimer = null;
    }, (Number(power) || 1) >= 1.2 ? 1200 : 850);
  }, Math.max(0, Number(delayMs) || 0));
}

function triggerSeatFireworkToSeat(seatIdx, delayMs = 0, theme = 0, power = 1) {
  setTimeout(() => {
    const seatEl = document.getElementById('seat' + seatIdx);
    if (!seatEl) return;

    const targetAnchor = seatEl.querySelector('.name-chips') || seatEl;
    const end = getCenterPoint(targetAnchor);
    if (!end) return;

    const layer = ensureBetBeamFxLayer();
    if (!layer) return;
    const { width: viewW, height: viewH } = getFxViewportSize();
    layer.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    layer.setAttribute('width', String(viewW));
    layer.setAttribute('height', String(viewH));

    const start = {
      x: Math.max(18, Math.min(viewW - 18, end.x + ((Math.random() - 0.5) * 320))),
      y: viewH + 34 + (Math.random() * 36)
    };

    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.hypot(dx, dy);
    if (!Number.isFinite(len) || len < 40) return;

    const control = {
      x: (start.x + end.x) * 0.5 + (Math.random() - 0.5) * Math.min(150, len * 0.23),
      y: Math.min(start.y, end.y) - Math.max(140, Math.min(330, len * 0.44))
    };
    const d = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} Q ${control.x.toFixed(2)} ${control.y.toFixed(2)} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;

    const ns = 'http://www.w3.org/2000/svg';
    const shot = document.createElementNS(ns, 'g');
    shot.setAttribute('data-seat-firework-id', String(++betBeamFxSeq));
    const fxPower = Math.max(0.75, Math.min(1.9, Number(power) || 1));
    shot.style.setProperty('--firework-main', ['#ffd447', '#ff6e5b', '#48d2ff', '#2bd38a'][Math.abs(theme) % 4]);
    shot.style.setProperty('--trace-dur', `${Math.round((1250 + Math.random() * 360) * (1.08 - Math.min(0.24, (fxPower - 1) * 0.33)))}ms`);

    const glow = document.createElementNS(ns, 'path');
    glow.setAttribute('d', d);
    glow.setAttribute('pathLength', '1');
    glow.setAttribute('class', 'seat-firework-trace-glow');

    const line = document.createElementNS(ns, 'path');
    line.setAttribute('d', d);
    line.setAttribute('pathLength', '1');
    line.setAttribute('class', 'seat-firework-trace');

    const rocket = document.createElementNS(ns, 'g');
    rocket.setAttribute('class', 'seat-firework-rocket');
    rocket.style.setProperty('--firework-main', ['#ffd447', '#ff6e5b', '#48d2ff', '#2bd38a'][Math.abs(theme) % 4]);
    rocket.setAttribute('transform', `translate(${start.x.toFixed(2)} ${start.y.toFixed(2)}) rotate(0) scale(.74)`);

    const flameOuter = document.createElementNS(ns, 'ellipse');
    flameOuter.setAttribute('class', 'seat-firework-flame-outer');
    flameOuter.setAttribute('cx', '-12.5');
    flameOuter.setAttribute('cy', '0');
    flameOuter.setAttribute('rx', '8.1');
    flameOuter.setAttribute('ry', '4.6');

    const flameInner = document.createElementNS(ns, 'ellipse');
    flameInner.setAttribute('class', 'seat-firework-flame-inner');
    flameInner.setAttribute('cx', '-10.8');
    flameInner.setAttribute('cy', '0');
    flameInner.setAttribute('rx', '5.2');
    flameInner.setAttribute('ry', '2.8');

    const head = document.createElementNS(ns, 'ellipse');
    head.setAttribute('class', 'seat-firework-rocket-head');
    head.setAttribute('cx', '2');
    head.setAttribute('cy', '0');
    head.setAttribute('rx', '7.2');
    head.setAttribute('ry', '4.5');

    const core = document.createElementNS(ns, 'ellipse');
    core.setAttribute('class', 'seat-firework-rocket-core');
    core.setAttribute('cx', '1.2');
    core.setAttribute('cy', '0');
    core.setAttribute('rx', '4.2');
    core.setAttribute('ry', '2.9');

    const shine = document.createElementNS(ns, 'circle');
    shine.setAttribute('class', 'seat-firework-rocket-shine');
    shine.setAttribute('cx', '4.5');
    shine.setAttribute('cy', '-1.4');
    shine.setAttribute('r', '1.35');

    rocket.appendChild(flameOuter);
    rocket.appendChild(flameInner);
    rocket.appendChild(head);
    rocket.appendChild(core);
    rocket.appendChild(shine);

    shot.appendChild(glow);
    shot.appendChild(line);
    shot.appendChild(rocket);
    layer.appendChild(shot);

    const duration = 1420 + Math.random() * 380;
    const startTs = performance.now();
    let burstDone = false;
    let rafId = null;

    const tick = (ts) => {
      const raw = Math.max(0, Math.min(1, (ts - startTs) / duration));
      const eased = raw < 0.5
        ? 4 * raw * raw * raw
        : 1 - Math.pow(-2 * raw + 2, 3) / 2;
      const p = getQuadPoint(start, control, end, eased);
      const tan = getQuadTangent(start, control, end, eased);
      const ang = Math.atan2(tan.y, tan.x) * (180 / Math.PI);

      const sway = Math.sin(eased * Math.PI * 2.6) * Math.max(1.8, Math.min(6.5, len * 0.012));
      const zScale = 0.72 + (Math.sin(Math.PI * eased) * 0.34);
      rocket.setAttribute(
        'transform',
        `translate(${(p.x + sway).toFixed(2)} ${p.y.toFixed(2)}) rotate(${ang.toFixed(2)}) scale(${zScale.toFixed(3)})`
      );

      if (!burstDone && raw >= 0.96) {
        burstDone = true;
        spawnSeatFireworkBurst(layer, end, theme, fxPower);
        rocket.style.opacity = '0';
      }

      if (raw < 1) {
        rafId = requestAnimationFrame(tick);
        return;
      }
      shot.remove();
    };

    rafId = requestAnimationFrame(tick);
    setTimeout(() => {
      if (rafId != null) cancelAnimationFrame(rafId);
      shot.remove();
    }, duration + 1700);

    seatEl.classList.remove('pot-scoop-target');
    seatEl.classList.remove('winner-grand-hit');
    void seatEl.offsetWidth;
    seatEl.classList.add((Number(fxPower) || 1) >= 1.2 ? 'winner-grand-hit' : 'pot-scoop-target');
    if (seatEl._potScoopSeatTimer) clearTimeout(seatEl._potScoopSeatTimer);
    seatEl._potScoopSeatTimer = setTimeout(() => {
      seatEl.classList.remove('pot-scoop-target');
      seatEl.classList.remove('winner-grand-hit');
      seatEl._potScoopSeatTimer = null;
    }, (Number(fxPower) || 1) >= 1.2 ? 1500 : 1200);
  }, Math.max(0, Number(delayMs) || 0));
}

function buildFinalWinStarPoints(cx, cy, outerR, innerR, points = 8) {
  const pts = [];
  const step = Math.PI / points;
  let angle = -Math.PI / 2;
  for (let i = 0; i < points * 2; i++) {
    const r = (i % 2 === 0) ? outerR : innerR;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    angle += step;
  }
  return pts.join(' ');
}

function spawnFinalWinnerCinematicBurst(layer, end, theme = 0, scale = 1) {
  const ns = 'http://www.w3.org/2000/svg';
  const burst = document.createElementNS(ns, 'g');
  burst.setAttribute('data-final-winner-burst', String(++betBeamFxSeq));
  const fxScale = Math.max(0.9, Math.min(2, Number(scale) || 1));

  const palettes = [
    { main: '#ffd447', accent: '#48d2ff' },
    { main: '#ffcc66', accent: '#7ed0ff' },
    { main: '#ffe083', accent: '#8aa8ff' },
    { main: '#ffb86a', accent: '#54d6ff' }
  ];
  const palette = palettes[((Number(theme) || 0) % palettes.length + palettes.length) % palettes.length];
  burst.style.setProperty('--final-main', palette.main);
  burst.style.setProperty('--final-accent', palette.accent);

  const aura = document.createElementNS(ns, 'circle');
  aura.setAttribute('cx', end.x.toFixed(2));
  aura.setAttribute('cy', end.y.toFixed(2));
  aura.setAttribute('r', (22 * fxScale).toFixed(2));
  aura.setAttribute('class', 'final-win-aura');
  burst.appendChild(aura);

  const star = document.createElementNS(ns, 'polygon');
  star.setAttribute('points', buildFinalWinStarPoints(end.x, end.y, 28 * fxScale, 13.5 * fxScale, 8));
  star.setAttribute('class', 'final-win-star');
  burst.appendChild(star);

  const ringA = document.createElementNS(ns, 'circle');
  ringA.setAttribute('cx', end.x.toFixed(2));
  ringA.setAttribute('cy', end.y.toFixed(2));
  ringA.setAttribute('r', (20 * fxScale).toFixed(2));
  ringA.setAttribute('class', 'final-win-ring');
  ringA.style.setProperty('--ring-scale', (2.55 * fxScale).toFixed(2));
  burst.appendChild(ringA);

  const ringB = document.createElementNS(ns, 'circle');
  ringB.setAttribute('cx', end.x.toFixed(2));
  ringB.setAttribute('cy', end.y.toFixed(2));
  ringB.setAttribute('r', (16 * fxScale).toFixed(2));
  ringB.setAttribute('class', 'final-win-ring');
  ringB.style.setProperty('--delay', '140ms');
  ringB.style.setProperty('--ring-scale', (3.1 * fxScale).toFixed(2));
  burst.appendChild(ringB);

  const sweep = document.createElementNS(ns, 'ellipse');
  sweep.setAttribute('cx', end.x.toFixed(2));
  sweep.setAttribute('cy', end.y.toFixed(2));
  sweep.setAttribute('rx', (18 * fxScale).toFixed(2));
  sweep.setAttribute('ry', (18 * fxScale).toFixed(2));
  sweep.setAttribute('class', 'final-win-sweep');
  sweep.style.setProperty('--sweep-rot', `${Math.round((Math.random() - 0.5) * 60 + 120)}deg`);
  burst.appendChild(sweep);

  const shardCount = Math.round(16 + (fxScale * 7));
  for (let i = 0; i < shardCount; i++) {
    const a = (Math.PI * 2 * i) / shardCount + ((Math.random() - 0.5) * 0.24);
    const d = (72 + Math.random() * 92) * fxScale;
    const shard = document.createElementNS(ns, 'line');
    shard.setAttribute('x1', end.x.toFixed(2));
    shard.setAttribute('y1', end.y.toFixed(2));
    shard.setAttribute('x2', (end.x + Math.cos(a) * d).toFixed(2));
    shard.setAttribute('y2', (end.y + Math.sin(a) * d).toFixed(2));
    shard.setAttribute('pathLength', '1');
    shard.setAttribute('class', 'final-win-shard');
    shard.style.setProperty('--delay', `${Math.round(Math.random() * 160)}ms`);
    burst.appendChild(shard);
  }

  const cometCount = Math.round(24 + (fxScale * 10));
  for (let i = 0; i < cometCount; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = (84 + Math.random() * 128) * fxScale;
    const comet = document.createElementNS(ns, 'circle');
    comet.setAttribute('cx', end.x.toFixed(2));
    comet.setAttribute('cy', end.y.toFixed(2));
    comet.setAttribute('r', (1.4 + Math.random() * 2.4).toFixed(2));
    comet.setAttribute('class', 'final-win-comet');
    comet.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(2)}px`);
    comet.style.setProperty('--dy', `${(Math.sin(a) * d).toFixed(2)}px`);
    comet.style.setProperty('--delay', `${Math.round(Math.random() * 220)}ms`);
    burst.appendChild(comet);
  }

  layer.appendChild(burst);
  setTimeout(() => burst.remove(), 2350);
}

function triggerFinalWinnerCinematic(seatIdx, delayMs = 0, theme = 0, scale = 1) {
  setTimeout(() => {
    const seatEl = document.getElementById('seat' + seatIdx);
    if (!seatEl) return;
    const targetAnchor = seatEl.querySelector('.name-chips') || seatEl;
    const end = getCenterPoint(targetAnchor);
    if (!end) return;

    const layer = ensureBetBeamFxLayer();
    if (!layer) return;
    const { width: viewW, height: viewH } = getFxViewportSize();
    layer.setAttribute('viewBox', `0 0 ${viewW} ${viewH}`);
    layer.setAttribute('width', String(viewW));
    layer.setAttribute('height', String(viewH));

    spawnFinalWinnerCinematicBurst(layer, end, theme, scale);

    seatEl.classList.remove('winner-final-cinematic-hit');
    void seatEl.offsetWidth;
    seatEl.classList.add('winner-final-cinematic-hit');
    if (seatEl._winnerFinalSeatTimer) clearTimeout(seatEl._winnerFinalSeatTimer);
    seatEl._winnerFinalSeatTimer = setTimeout(() => {
      seatEl.classList.remove('winner-final-cinematic-hit');
      seatEl._winnerFinalSeatTimer = null;
    }, 1950);
  }, Math.max(0, Number(delayMs) || 0));
}

function triggerRevealWinnerFireworks(winnerSeats, options = {}) {
  if (window.IMDCXMotion) { window.IMDCXMotion.award(winnerSeats); return; }
  if (!Array.isArray(winnerSeats) || winnerSeats.length < 1) return;
  const isFinal = options?.isFinal === true;
  const now = Date.now();
  if (now < revealSeatFireworkLockUntil) return;
  revealSeatFireworkLockUntil = now + 3600;
  const useMobileFx = shouldUseMobileWinnerFx();

  if (useMobileFx) {
    if (winnerSeats.length === 1) {
      const idx = winnerSeats[0];
      if (isFinal) {
        triggerFinalWinnerCinematic(idx, 0, 0, 1.08);
        triggerFinalWinnerCinematic(idx, 300, 1, 1.02);
        triggerFinalWinnerCinematic(idx, 620, 2, 0.96);
      } else {
        triggerMobileWinnerSeatExplosion(idx, 0, 0, 1);
        triggerMobileWinnerSeatExplosion(idx, 220, 1, 1);
      }
      return;
    }
    winnerSeats.slice(0, 3).forEach((idx, order) => {
      triggerMobileWinnerSeatExplosion(idx, order * 170, order, 1);
    });
    return;
  }

  if (winnerSeats.length === 1) {
    const idx = winnerSeats[0];
    if (isFinal) {
      triggerFinalWinnerCinematic(idx, 0, 0, 1.18);
      triggerFinalWinnerCinematic(idx, 260, 1, 1.08);
      triggerFinalWinnerCinematic(idx, 560, 2, 0.98);
    } else {
      triggerSeatFireworkToSeat(idx, 0, 0, 1);
      triggerSeatFireworkToSeat(idx, 210, 1, 1);
      triggerSeatFireworkToSeat(idx, 420, 2, 1);
    }
    return;
  }

  winnerSeats.slice(0, 3).forEach((idx, order) => {
    triggerSeatFireworkToSeat(idx, order * 190, order, 1);
  });
}

function triggerPotScoopToSeat(seatIdx) {
  if (window.IMDCXMotion) { window.IMDCXMotion.scoop(seatIdx); return; }
  const seatEl = document.getElementById('seat' + seatIdx);
  const potEl = document.getElementById('pot');
  if (!seatEl || !potEl) return;

  const targetAnchor = seatEl.querySelector('.name-chips') || seatEl;
  const start = getCenterPoint(potEl);
  const end = getCenterPoint(targetAnchor);
  if (!start || !end) return;

  const layer = ensureBetBeamFxLayer();
  if (!layer) return;
  const viewport = getFxViewportSize();
  layer.setAttribute('viewBox', `0 0 ${viewport.width} ${viewport.height}`);
  layer.setAttribute('width', String(viewport.width));
  layer.setAttribute('height', String(viewport.height));

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len < 12) return;

  const midX = (start.x + end.x) * 0.5;
  const midY = (start.y + end.y) * 0.5;
  const arcUp = Math.max(90, Math.min(220, len * 0.52));
  const sideBend = Math.max(18, Math.min(62, len * 0.16));
  const sideSign = dx >= 0 ? 1 : -1;
  const control = {
    x: midX + (sideBend * sideSign),
    y: Math.min(start.y, end.y, midY) - arcUp
  };
  const d = `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} Q ${control.x.toFixed(2)} ${control.y.toFixed(2)} ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;

  const ns = 'http://www.w3.org/2000/svg';
  const shot = document.createElementNS(ns, 'g');
  shot.setAttribute('data-pot-scoop-id', String(++betBeamFxSeq));

  const glow = document.createElementNS(ns, 'path');
  glow.setAttribute('d', d);
  glow.setAttribute('pathLength', '1');
  glow.setAttribute('class', 'pot-scoop-glow');

  const line = document.createElementNS(ns, 'path');
  line.setAttribute('d', d);
  line.setAttribute('pathLength', '1');
  line.setAttribute('class', 'pot-scoop-line');

  const rocket = document.createElementNS(ns, 'g');
  rocket.setAttribute('class', 'pot-scoop-rocket');
  rocket.setAttribute('transform', `translate(${start.x.toFixed(2)} ${start.y.toFixed(2)}) rotate(0) scale(.72)`);

  const flameOuter = document.createElementNS(ns, 'ellipse');
  flameOuter.setAttribute('class', 'pot-scoop-flame-outer');
  flameOuter.setAttribute('cx', '-14');
  flameOuter.setAttribute('cy', '0');
  flameOuter.setAttribute('rx', '8.6');
  flameOuter.setAttribute('ry', '4.8');

  const flameInner = document.createElementNS(ns, 'ellipse');
  flameInner.setAttribute('class', 'pot-scoop-flame-inner');
  flameInner.setAttribute('cx', '-12.4');
  flameInner.setAttribute('cy', '0');
  flameInner.setAttribute('rx', '5.5');
  flameInner.setAttribute('ry', '2.9');

  const head = document.createElementNS(ns, 'ellipse');
  head.setAttribute('class', 'pot-scoop-rocket-head');
  head.setAttribute('cx', '2.2');
  head.setAttribute('cy', '0');
  head.setAttribute('rx', '7.6');
  head.setAttribute('ry', '4.9');

  const core = document.createElementNS(ns, 'ellipse');
  core.setAttribute('class', 'pot-scoop-rocket-core');
  core.setAttribute('cx', '1.4');
  core.setAttribute('cy', '0');
  core.setAttribute('rx', '4.6');
  core.setAttribute('ry', '3.1');

  const shine = document.createElementNS(ns, 'circle');
  shine.setAttribute('class', 'pot-scoop-rocket-shine');
  shine.setAttribute('cx', '4.8');
  shine.setAttribute('cy', '-1.5');
  shine.setAttribute('r', '1.45');

  rocket.appendChild(flameOuter);
  rocket.appendChild(flameInner);
  rocket.appendChild(head);
  rocket.appendChild(core);
  rocket.appendChild(shine);

  shot.appendChild(glow);
  shot.appendChild(line);
  shot.appendChild(rocket);
  layer.appendChild(shot);

  const duration = 1850;
  const startTs = performance.now();
  let burstDone = false;
  let rafId = null;

  const tick = (ts) => {
    const raw = Math.max(0, Math.min(1, (ts - startTs) / duration));
    const eased = raw < 0.5
      ? 4 * raw * raw * raw
      : 1 - Math.pow(-2 * raw + 2, 3) / 2;
    const p = getQuadPoint(start, control, end, eased);
    const tan = getQuadTangent(start, control, end, eased);
    const ang = Math.atan2(tan.y, tan.x) * (180 / Math.PI);

    const lift = -Math.sin(Math.PI * eased) * Math.max(12, Math.min(30, len * 0.09));
    const zScale = 0.68 + (Math.sin(Math.PI * eased) * 0.62);
    rocket.setAttribute(
      'transform',
      `translate(${p.x.toFixed(2)} ${(p.y + lift).toFixed(2)}) rotate(${ang.toFixed(2)}) scale(${zScale.toFixed(3)})`
    );

    if (!burstDone && raw >= 0.92) {
      burstDone = true;
      spawnPotScoopBurst(layer, end);
      rocket.style.opacity = '0';
    }

    if (raw < 1) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    shot.remove();
  };

  rafId = requestAnimationFrame(tick);
  setTimeout(() => {
    if (rafId != null) cancelAnimationFrame(rafId);
    shot.remove();
  }, duration + 1500);

  seatEl.classList.remove('pot-scoop-target');
  void seatEl.offsetWidth;
  seatEl.classList.add('pot-scoop-target');
  if (seatEl._potScoopSeatTimer) clearTimeout(seatEl._potScoopSeatTimer);
  seatEl._potScoopSeatTimer = setTimeout(() => {
    seatEl.classList.remove('pot-scoop-target');
    seatEl._potScoopSeatTimer = null;
  }, 1200);
}

try {
  reloadRestorePending = sessionStorage.getItem('pageReloadPending') === '1';
  sessionStorage.removeItem('pageReloadPending');
} catch (e) {
  reloadRestorePending = false;
}

function showReloadSyncWaitingOverlay() {
  if (!reloadRestorePending) return;
  const loading = document.getElementById('loading-screen');
  if (!loading) return;
  if (loading.parentElement !== document.body) {
    document.body.appendChild(loading);
  }
  const fruitField = document.getElementById('reload-fruit-field');
  // Keep the very first painted markup to avoid a visual "second loader" cut.
  // Rebuild only if the field is empty.
  if (fruitField && !fruitField.children.length) {
    const fruits = ['🍓', '🍍', '🍇', '🍉', '🍊', '🍒', '🍋', '🥝'];
    const count = 28;
    let html = '';
    for (let i = 0; i < count; i += 1) {
      const fruit = fruits[Math.floor(Math.random() * fruits.length)];
      const x = (Math.random() * 92 + 4).toFixed(2);
      const y = (Math.random() * 90 + 5).toFixed(2);
      const size = (16 + Math.random() * 14).toFixed(1);
      const delay = Math.floor(Math.random() * 2200);
      const duration = (5.4 + Math.random() * 3.8).toFixed(2);
      html += `<span class="reload-fruit" style="--x:${x}%;--y:${y}%;--s:${size}px;--d:${delay}ms;--t:${duration}s;">${fruit}</span>`;
    }
    fruitField.innerHTML = html;
  }
  const reloadLoader = document.getElementById('reload-sync-loader');
  // Same rule for the loader card: don't replace existing DOM if already present.
  if (reloadLoader && !reloadLoader.children.length) {
    reloadLoader.innerHTML = `
      <div class="fruit-loader-card" role="status" aria-live="polite">
        <div class="fruit-loader-title">Fruity Reload</div>
        <div class="fruit-loader-ring" aria-hidden="true">
          <span class="fruit-loader-core"></span>
          <span class="fruit-loader-dot orange" style="--a:0deg;--d:0ms;"></span>
          <span class="fruit-loader-dot red" style="--a:60deg;--d:120ms;"></span>
          <span class="fruit-loader-dot green" style="--a:120deg;--d:240ms;"></span>
          <span class="fruit-loader-dot blue" style="--a:180deg;--d:360ms;"></span>
          <span class="fruit-loader-dot orange" style="--a:240deg;--d:480ms;"></span>
          <span class="fruit-loader-dot red" style="--a:300deg;--d:600ms;"></span>
        </div>
        <div class="fruit-loader-track"><span></span></div>
        <div class="fruit-loader-text">Reconnexion a la table</div>
      </div>
    `;
  }
  loading.classList.add('reload-sync-mode');
  loading.style.display = 'flex';
}

function clearReloadPendingChrome() {
  document.documentElement.classList.remove('reload-pending');
}

function removeLoadingScreenNow() {
  const loading = document.getElementById('loading-screen');
  if (loading) loading.remove();
  clearReloadPendingChrome();
}

function hoistUiOverlaysToBody() {
  const ids = [
    'modal-box',
    'rules-modal',
    'time-rules-modal',
    'add30-rules-modal',
    'add30-confirm-modal',
    'hide-rules-modal',
    'show-rules-modal',
    'sos-modal',
    'sos-chat-modal',
    'odds-modal',
    'stats-modal',
    'end-game-modal'
  ];
  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.parentElement !== document.body) {
      document.body.appendChild(el);
    }
  });
}

function attachActionOptionsToGameContainer() {
  const game = document.getElementById('game-container');
  const action = document.getElementById('action-options');
  if (!game || !action) return;
  if (action.parentElement !== game) {
    game.appendChild(action);
  }
}

function isTouchMobileLayout(vw) {
  const width = Math.max(0, Number(vw) || 0);
  const ua = navigator.userAgent || '';
  const mobileUa = /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(ua);
  const coarsePointer = window.matchMedia?.('(pointer: coarse)')?.matches === true;
  return width <= 900 && (mobileUa || coarsePointer);
}

function shouldUseMobileWinnerFx() {
  const ua = navigator.userAgent || '';
  const mobileUa = /Android|webOS|iPhone|iPad|iPod|IEMobile|Opera Mini|Windows Phone/i.test(ua);
  const coarsePointer = (
    window.matchMedia?.('(pointer: coarse)')?.matches === true ||
    window.matchMedia?.('(any-pointer: coarse)')?.matches === true
  );
  const touchPoints = Number(navigator.maxTouchPoints || 0);
  const viewportW = Math.round(window.visualViewport?.width || window.innerWidth || 0);
  const likelyTouchDevice = coarsePointer || touchPoints > 0;
  return mobileUa || (likelyTouchDevice && viewportW <= 1280);
}

function applyResponsiveScale() {
  const wrapper = document.getElementById('poker-game-wrapper');
  const game = document.getElementById('game-container');
  if (!wrapper || !game) return;
  // A dedicated scene removes the table from layout. Measuring it then would
  // discard the bounds of seats, personal cards and action buttons.
  if (document.body.classList.contains('imdcx-scene-mode') || !game.getClientRects().length) return;

  attachActionOptionsToGameContainer();
  initializeSponsorImageFallbacks();

  const vv = window.visualViewport;
  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isIOSGoogleBrowser = isIOS && (/CriOS/i.test(ua) || /GSA/i.test(ua));
  const vw = Math.max(320, Math.round(vv?.width || window.innerWidth || 800));
  const vh = Math.max(320, Math.round(vv?.height || window.innerHeight || 600));
  const viewportLeft = Math.round(vv?.offsetLeft || 0);
  const viewportTop = Math.round(vv?.offsetTop || 0);

  const baseW = 800;
  const baseH = 600;
  const cssMarginTop = parseFloat(window.getComputedStyle(game).marginTop) || 0;
  const spectatorMode = Boolean(isPublicSpectator);
  // Keep mobile-only layout for touch/mobile devices only.
  // Narrow desktop windows must stay in desktop layout mode.
  const isSmallScreen = isTouchMobileLayout(vw);
  const padX = isSmallScreen
    ? 8
    : (spectatorMode ? 56 : 24);
  const desktopGapY = 20;
  const padY = isSmallScreen
    ? (spectatorMode ? 14 : 6)
    : (spectatorMode ? 34 : desktopGapY);
  const marginTop = isSmallScreen ? cssMarginTop : 0;

  const availW = Math.max(0, vw - padX * 2);
  const availH = Math.max(0, vh - padY * 2 - marginTop);

  // On phones: width-first fit with a very light overfill.
  // On larger screens: contain mode (fit both width and height).
  const fitScaleW = availW / baseW;
  const fitScaleH = availH / baseH;
  const edgeToEdgeBoost = isSmallScreen ? (isIOSGoogleBrowser ? 1.05 : 1.17) : 1;
  let scale = isSmallScreen ? (fitScaleW * edgeToEdgeBoost) : Math.min(fitScaleW, fitScaleH);
  if (spectatorMode) {
    // Public spectator view should be less zoomed to keep more table context on screen.
    scale *= (isSmallScreen ? 0.90 : 0.82);
  }

  // Keep sane bounds for very small/very large screens.
  const minScale = 0.46;
  const maxScale = isSmallScreen ? 1 : 10;
  scale = Math.max(minScale, Math.min(scale, maxScale));

  const scaledW = baseW * scale;
  const scaledH = baseH * scale;
  const mobileBiasX = 35;
  let offsetX = 0;
  if (isSmallScreen) {
    offsetX = Math.round(viewportLeft + (availW - scaledW) / 2 + mobileBiasX);
    // Prevent one-sided horizontal overflow on narrow Android/foldable viewports.
    const minOffsetX = Math.round(viewportLeft + availW - scaledW);
    const maxOffsetX = Math.round(viewportLeft);
    offsetX = Math.max(minOffsetX, Math.min(offsetX, maxOffsetX));
  }
  const spectatorShiftY = spectatorMode
    ? (isSmallScreen ? 8 : 14)
    : 0;
  const offsetY = Math.round(viewportTop + (availH - scaledH) / 2 + spectatorShiftY);

  wrapper.style.setProperty('--game-scale', scale.toFixed(4));
  wrapper.style.setProperty('--game-pad-x', `${padX}px`);
  wrapper.style.setProperty('--game-pad-y', `${padY}px`);
  wrapper.style.setProperty('--game-offset-x', `${offsetX}px`);
  wrapper.style.setProperty('--game-offset-y', `${offsetY}px`);

  document.documentElement.classList.toggle('lock-game-scroll', isSmallScreen);
  document.body.classList.toggle('lock-game-scroll', isSmallScreen);

  const viewportRight = viewportLeft + vw;
  const viewportBottom = viewportTop + vh;
  const safeLeft = viewportLeft + padX;
  const safeRight = viewportRight - padX;
  const safeTop = viewportTop + padY;
  const safeBottom = viewportBottom - padY;

  wrapper.style.height = `${vh}px`;
  wrapper.style.minHeight = `${vh}px`;
  wrapper.style.justifyContent = 'center';
  game.style.margin = '';
  if (isSmallScreen) {
    game.style.removeProperty('margin-top');
  } else {
    game.style.setProperty('margin-top', '0px', 'important');
  }
  game.style.transformOrigin = 'top center';
  game.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;

  if (!isSmallScreen) {
    let bounds = getGameplayBounds();
    if (bounds && bounds.width > 0 && bounds.height > 0) {
      const safeW = Math.max(1, safeRight - safeLeft);
      const safeH = Math.max(1, safeBottom - safeTop);
      const fitFactor = Math.min(1, safeW / bounds.width, safeH / bounds.height);
      if (fitFactor < 0.999) {
        scale *= fitFactor;
        wrapper.style.setProperty('--game-scale', scale.toFixed(4));
        game.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
        bounds = getGameplayBounds();
      }

      if (bounds) {
        const safeCenterX = (safeLeft + safeRight) / 2;
        const safeCenterY = (safeTop + safeBottom) / 2;
        const boundsCenterX = (bounds.left + bounds.right) / 2;
        const boundsCenterY = (bounds.top + bounds.bottom) / 2;
        const recenterX = Math.round(safeCenterX - boundsCenterX);
        const recenterY = Math.round(safeCenterY - boundsCenterY);
        if (Math.abs(recenterX) > 0 || Math.abs(recenterY) > 0) {
          offsetX += recenterX;
          wrapper.style.setProperty('--game-offset-x', `${offsetX}px`);
          wrapper.style.setProperty('--game-offset-y', `${offsetY + recenterY}px`);
          game.style.transform = `translate(${offsetX}px, ${offsetY + recenterY}px) scale(${scale})`;
        }
      }
    }
  }

  if (isSmallScreen) {
    let bounds = getGameplayBounds();
    // Preserve the phone layout, but fit its full height in landscape/short viewports.
    if (bounds && bounds.height > safeBottom - safeTop) {
      scale *= (safeBottom - safeTop) / bounds.height;
      wrapper.style.setProperty('--game-scale', scale.toFixed(4));
      game.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${scale})`;
      bounds = getGameplayBounds();
    }
    if (bounds) {
      const viewportCenterY = viewportTop + (vh / 2);
      const gameplayCenterY = (bounds.top + bounds.bottom) / 2;
      const recenterDeltaY = Math.round(viewportCenterY - gameplayCenterY);
      if (Math.abs(recenterDeltaY) > 1) {
        const centeredOffsetY = offsetY + recenterDeltaY;
        wrapper.style.setProperty('--game-offset-y', `${centeredOffsetY}px`);
        game.style.transform = `translate(${offsetX}px, ${centeredOffsetY}px) scale(${scale})`;
      }
    }
  }

  const adLayer = document.getElementById('sponsor-layer') || document.getElementById('ad-layer');
  const gameRect = game.getBoundingClientRect();
  const effectiveGameWidth = Math.round((gameRect?.width && gameRect.width > 0) ? gameRect.width : (baseW * scale));
  document.documentElement.style.setProperty('--effective-game-width', `${effectiveGameWidth}px`);
  if (adLayer) {
    if (isSmallScreen) {
      adLayer.style.removeProperty('--game-width');
      adLayer.style.removeProperty('--ad-game-gap');
    } else {
      adLayer.style.setProperty('--game-width', `${effectiveGameWidth}px`);
    }
  }

  layoutMobileEdgeButtons({
    vw,
    isSmallScreen,
    scale,
    offsetX
  });

  adjustMobileAdBanners(vw);
  alignMobileActionButtonsToViewportRight({ isSmallScreen, scale });
  alignMobileUtilityButtonsToViewportEdges({ isSmallScreen, scale });
  positionBackgroundToggleButton();
  requestAnimationFrame(() => {
    alignMobileActionButtonsToViewportRight({ isSmallScreen, scale });
    alignMobileUtilityButtonsToViewportEdges({ isSmallScreen, scale });
    positionBackgroundToggleButton();
    requestAnimationFrame(positionBackgroundToggleButton);
  });
}

function layoutMobileEdgeButtons({ vw, isSmallScreen, scale, offsetX }) {
  const ids = ['odds-help-btn', 'btn-time', 'btn-add30', 'stats-help-btn', 'rules-help-btn', 'sos-help-btn'];
  const els = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
  // Keep utility buttons inside the game layout so they follow game scaling/translation.
  // Remove any inline overrides previously applied by JS.
  ids.forEach((id) => {
    const el = els[id];
    if (!el) return;
    el.style.removeProperty('left');
    el.style.removeProperty('right');
    el.style.removeProperty('top');
    el.style.removeProperty('bottom');
    el.style.removeProperty('position');
    el.style.removeProperty('z-index');
    el.style.removeProperty('transform');
  });
}

function alignMobileActionButtonsToViewportRight({ isSmallScreen, scale }) {
  const action = document.getElementById('action-options');
  if (!action) return;
  let nextShift = 0;
  if (isSmallScreen) {
    action.style.setProperty('--mobile-action-shift-x', '0px');

    const vv = window.visualViewport;
    const viewportLeft = Math.round(vv?.offsetLeft || 0);
    const viewportRight = Math.round((vv?.offsetLeft || 0) + (vv?.width || window.innerWidth || 0));
    const safeScale = Math.max(0.01, Number(scale) || 1);
    const desiredRightGap = 10;
    const raiseBtn = document.getElementById('custom-raise');
    if (raiseBtn && raiseBtn.offsetWidth > 0 && raiseBtn.offsetHeight > 0) {
      const raiseRect = raiseBtn.getBoundingClientRect();
      nextShift = (viewportRight - desiredRightGap - raiseRect.right) / safeScale;

      const foldBtn = document.getElementById('fold-button');
      if (foldBtn && foldBtn.offsetWidth > 0 && foldBtn.offsetHeight > 0) {
        const foldRect = foldBtn.getBoundingClientRect();
        const shiftedFoldLeft = foldRect.left + (nextShift * safeScale);
        const minLeftGap = 6;
        if (shiftedFoldLeft < viewportLeft + minLeftGap) {
          nextShift += ((viewportLeft + minLeftGap) - shiftedFoldLeft) / safeScale;
        }
      }
    }
  }

  action.style.setProperty('--mobile-action-shift-x', `${nextShift.toFixed(2)}px`);
  const breakBtn = document.getElementById('break-btn');
  if (breakBtn) {
    if (isSmallScreen) {
      breakBtn.style.setProperty('left', 'calc(50% - var(--mobile-action-shift-x))', 'important');
      breakBtn.style.setProperty('transform', 'translateX(-50%)', 'important');
    } else {
      breakBtn.style.removeProperty('left');
      breakBtn.style.removeProperty('transform');
    }
  }
}

function alignMobileUtilityButtonsToViewportEdges({ isSmallScreen, scale }) {
  const action = document.getElementById('action-options');
  if (!action) return;
  if (window.IMDCXTable?.layoutTouchUtilities(action, scale, isSmallScreen)) return;
  if (!isSmallScreen) {
    action.style.removeProperty('--mobile-util-left-shift');
    action.style.removeProperty('--mobile-util-right-shift');
    return;
  }

  const vv = window.visualViewport;
  const viewportLeft = Math.round(vv?.offsetLeft || 0);
  const viewportRight = Math.round((vv?.offsetLeft || 0) + (vv?.width || window.innerWidth || 0));
  if (!viewportRight) return;

  const leftAnchor = document.getElementById('odds-help-btn');
  const rightAnchor = document.getElementById('sos-help-btn');
  if (!leftAnchor || !rightAnchor) return;

  const leftRect = leftAnchor.getBoundingClientRect();
  const rightRect = rightAnchor.getBoundingClientRect();
  if (leftRect.width <= 0 || rightRect.width <= 0) return;

  const gap = 10;
  const safeScale = Math.max(0.01, Number(scale) || 1);

  const leftDeltaScreen = (viewportLeft + gap) - leftRect.left;
  const leftDeltaGame = leftDeltaScreen / safeScale;
  const prevLeftShift = parseFloat(action.style.getPropertyValue('--mobile-util-left-shift') || '0') || 0;
  const nextLeftShift = prevLeftShift + leftDeltaGame;
  action.style.setProperty('--mobile-util-left-shift', `${nextLeftShift.toFixed(2)}px`);

  const rightDeltaScreen = (viewportRight - gap) - rightRect.right;
  const rightDeltaGame = rightDeltaScreen / safeScale;
  const prevRightShift = parseFloat(action.style.getPropertyValue('--mobile-util-right-shift') || '0') || 0;
  const nextRightShift = prevRightShift + rightDeltaGame;
  action.style.setProperty('--mobile-util-right-shift', `${nextRightShift.toFixed(2)}px`);
}

function getGameplayBounds() {
  const rects = [];
  const collect = (selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) rects.push(rect);
    });
  };

  collect('#poker_table');
  collect('#poker_table .holecards .card');
  collect('#board-placeholders .board-placeholder');
  collect('#board .boardcard');
  collect('#fold-button, #call-button, #custom-raise');
  collect('#odds-help-btn, #btn-time, #btn-add30, #break-btn, #rules-help-btn, #sos-help-btn');

  if (!rects.length) return null;

  let top = Number.POSITIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  rects.forEach((rect) => {
    if (rect.top < top) top = rect.top;
    if (rect.bottom > bottom) bottom = rect.bottom;
    if (rect.left < left) left = rect.left;
    if (rect.right > right) right = rect.right;
  });

  if (!Number.isFinite(top) || !Number.isFinite(bottom) || !Number.isFinite(left) || !Number.isFinite(right)) return null;
  return {
    top,
    bottom,
    left,
    right,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function adjustMobileAdBanners(vw) {
  const topBanner = document.querySelector('.sponsor-banner-top, .ad-banner-top');
  const bottomBanner = document.querySelector('.sponsor-banner-bottom, .ad-banner-bottom');
  if (!topBanner || !bottomBanner) return;

  const isPhoneLayout = vw <= 900;
  if (!isPhoneLayout) {
    topBanner.style.left = '';
    topBanner.style.right = '';
    topBanner.style.width = '';
    topBanner.style.top = '';
    topBanner.style.bottom = '';
    topBanner.style.height = '';
    bottomBanner.style.left = '';
    bottomBanner.style.right = '';
    bottomBanner.style.width = '';
    bottomBanner.style.top = '';
    bottomBanner.style.bottom = '';
    bottomBanner.style.height = '';
    return;
  }

  const vv = window.visualViewport;
  const viewportLeft = Math.max(0, Math.round(vv?.offsetLeft || 0));
  const viewportWidth = Math.round(vv?.width || window.innerWidth || document.documentElement.clientWidth || 0);
  const viewportTop = Math.max(0, Math.round(vv?.offsetTop || 0));
  const viewportHeight = Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight || 0);
  const viewportBottom = viewportTop + Math.max(0, viewportHeight);
  if (viewportWidth <= 0) return;
  if (viewportBottom <= 0) return;

  const sideInsetPx = 8;
  const bannerLeft = viewportLeft + sideInsetPx;
  const bannerWidth = Math.max(0, viewportWidth - sideInsetPx * 2);

  const topAnchorCandidates = [];
  const pushTop = (selector) => {
    document.querySelectorAll(selector).forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.height > 0) topAnchorCandidates.push(rect.top);
    });
  };

  // Protect all gameplay cards first (preflop hole cards + board cards/placeholders).
  pushTop('#poker_table .holecards .card');
  pushTop('#board-placeholders .board-placeholder');
  pushTop('#board .boardcard');

  // Fallback: table bounds if cards are not measurable yet.
  const tableRect = document.getElementById('poker_table')?.getBoundingClientRect();
  if (tableRect && tableRect.height > 0) topAnchorCandidates.push(tableRect.top);

  let topAnchor = Number.POSITIVE_INFINITY;
  topAnchorCandidates.forEach((v) => {
    if (v < topAnchor) topAnchor = v;
  });
  if (!Number.isFinite(topAnchor)) topAnchor = viewportTop;

  const actionButtons = Array.from(
    document.querySelectorAll('#fold-button, #call-button, #custom-raise')
  );

  let bottomAnchor = Number.NEGATIVE_INFINITY;
  actionButtons.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > bottomAnchor) bottomAnchor = rect.bottom;
  });
  if (!Number.isFinite(bottomAnchor)) {
    bottomAnchor = tableRect ? tableRect.bottom : viewportBottom;
  }

  const topGapPx = 8;
  const bottomGapPx = 8;
  const clampedTopAnchor = Math.max(viewportTop, Math.min(Math.floor(topAnchor) - topGapPx, viewportBottom));
  const clampedBottomAnchor = Math.max(viewportTop, Math.min(Math.ceil(bottomAnchor) + bottomGapPx, viewportBottom));

  const topHeight = Math.max(0, clampedTopAnchor - viewportTop);
  const bottomHeight = Math.max(0, viewportBottom - clampedBottomAnchor);

  topBanner.style.left = `${bannerLeft}px`;
  topBanner.style.right = 'auto';
  topBanner.style.width = `${bannerWidth}px`;
  topBanner.style.top = `${viewportTop}px`;
  topBanner.style.bottom = 'auto';
  topBanner.style.height = `${topHeight}px`;

  bottomBanner.style.left = `${bannerLeft}px`;
  bottomBanner.style.right = 'auto';
  bottomBanner.style.width = `${bannerWidth}px`;
  bottomBanner.style.top = `${clampedBottomAnchor}px`;
  bottomBanner.style.bottom = 'auto';
  bottomBanner.style.height = `${bottomHeight}px`;
}

let _resizeRaf = null;
let _responsiveLayoutInitialized = false;
function scheduleResponsiveScale() {
  if (_resizeRaf) return;
  _resizeRaf = requestAnimationFrame(() => {
    _resizeRaf = null;
    applyResponsiveScale();
  });
}

function refreshResponsiveScaleAfterRender() {
  scheduleResponsiveScale();
  requestAnimationFrame(scheduleResponsiveScale);
  requestAnimationFrame(() => {
    if (endStateLocked || document.body.classList.contains('final-end-ui')) {
      scheduleFinalSeatCardLock();
    }
  });
}

function applyPublicSpectatorReadOnlyUi() {
  if (!isPublicSpectator) return;
  ensurePublicSpectatorBackCards();
  const actionBox = document.getElementById("action-options");
  if (actionBox) {
    actionBox.style.removeProperty("display");
    actionBox.classList.add("spectator-readonly");
  }

  const foldBtn = document.getElementById("fold-button");
  const callBtn = document.getElementById("call-button");
  const raiseBtn = document.getElementById("custom-raise");
  if (foldBtn) {
    foldBtn.style.removeProperty("display");
    foldBtn.textContent = "FOLD";
    foldBtn.classList.add("disabled");
    foldBtn.setAttribute("aria-disabled", "true");
    foldBtn.onclick = null;
  }
  if (callBtn) {
    callBtn.style.removeProperty("display");
    callBtn.textContent = "CHECK";
    callBtn.classList.add("disabled");
    callBtn.setAttribute("aria-disabled", "true");
    callBtn.onclick = null;
  }
  if (raiseBtn) {
    raiseBtn.style.removeProperty("display");
    raiseBtn.classList.add("disabled");
    raiseBtn.setAttribute("aria-disabled", "true");
    raiseBtn.onclick = null;
    raiseBtn.setAttribute("href", "javascript:void(0)");
    if (!raiseBtn.textContent || !raiseBtn.textContent.trim()) {
      raiseBtn.textContent = "RAISE";
    }
  }

  ['stats-help-btn', 'rules-help-btn', 'odds-help-btn', 'btn-time', 'btn-add30', 'reveal-hide-btn', 'reveal-show-btn', 'sos-help-btn', 'break-btn']
    .forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = "none";
    });
}

function ensurePublicSpectatorBackCards() {
  if (!isPublicSpectator) return;
  let host = document.getElementById('public-spectator-back-cards');
  const table = document.getElementById('poker_table');
  if (!document.body || !table) return;
  if (!host) {
    host = document.createElement('div');
    host.id = 'public-spectator-back-cards';
    host.innerHTML = '<div class="spectator-back-card card1"></div><div class="spectator-back-card card2"></div>';
    document.body.appendChild(host);
  } else if (host.parentElement !== document.body) {
    document.body.appendChild(host);
  }

  const tableRect = table.getBoundingClientRect();
  if (!tableRect || tableRect.width <= 0 || tableRect.height <= 0) return;

  // Manual placement in the 800x600 design space, then scaled with table size.
  const scale = Math.max(0.45, tableRect.width / 800);
  const holeLeft = Math.round(tableRect.left + (65 * scale));
  const holeTop = Math.round(tableRect.top + (567 * scale));
  const cardW = Math.round(126 * scale);
  const cardH = Math.round(150 * scale);
  const cardGap = Math.round(6 * scale);
  const hostW = (cardW * 2) + cardGap;
  const hostH = cardH;
  const cardRadius = `${Math.max(8, Math.round(10 * scale))}px`;

  host.style.setProperty('position', 'fixed', 'important');
  host.style.setProperty('left', `${holeLeft}px`, 'important');
  host.style.setProperty('top', `${holeTop}px`, 'important');
  host.style.removeProperty('bottom');
  host.style.removeProperty('right');
  host.style.removeProperty('transform');
  host.style.setProperty('display', 'block', 'important');
  host.style.setProperty('width', `${hostW}px`, 'important');
  host.style.setProperty('height', `${hostH}px`, 'important');
  host.style.setProperty('z-index', '1800', 'important');
  host.style.setProperty('pointer-events', 'none', 'important');

  const cards = Array.from(host.querySelectorAll('.spectator-back-card'));
  cards.forEach((card, idx) => {
    const isFirst = idx === 0;
    card.style.setProperty('width', `${cardW}px`, 'important');
    card.style.setProperty('height', `${cardH}px`, 'important');
    card.style.setProperty('position', 'absolute', 'important');
    card.style.setProperty('left', `${isFirst ? 0 : (cardW + cardGap)}px`, 'important');
    card.style.setProperty('top', '0px', 'important');
    card.style.setProperty('border-radius', `${cardRadius}`, 'important');
    card.style.setProperty('overflow', 'hidden', 'important');
    card.style.setProperty('background-size', 'contain', 'important');
    card.style.setProperty('background-position', 'center', 'important');
    card.style.setProperty('background-repeat', 'no-repeat', 'important');
    card.style.setProperty('box-shadow', '0 4px 10px rgba(0,0,0,.38)', 'important');
    card.style.setProperty('opacity', '1', 'important');
    card.style.setProperty(
      'background-image',
      isFirst
        ? getThemeCardAssetCssUrl('customI', { absolute: true })
        : getThemeCardAssetCssUrl('customM', { absolute: true }),
      'important'
    );
  });
}

function applyPublicSpectatorSeatBacks(gameState) {
  if (!isPublicSpectator) return;
  // Public spectator keeps table cards fully driven by live game state.
  // We only render a passive local "personal cards" placeholder (backs only).
  document.querySelectorAll('#poker_table .seat.my-seat').forEach((seatEl) => {
    seatEl.classList.remove('my-seat');
  });
  ensurePublicSpectatorBackCards();
}


function initializeSponsorImageFallbacks() {
  const imgs = document.querySelectorAll('.sponsor-image, .ad-image');
  imgs.forEach((img) => {
    if (!img || img.dataset.fallbackBound === '1') return;
    img.dataset.fallbackBound = '1';

    img.addEventListener('error', () => {
      const current = img.getAttribute('src') || '';
      const fallback = img.getAttribute('data-fallback-src') || '';
      const relativeFallback = fallback.startsWith('/') ? fallback.slice(1) : fallback;

      if (fallback && current !== fallback) {
        img.setAttribute('src', fallback);
        return;
      }
      if (relativeFallback && current !== relativeFallback) {
        img.setAttribute('src', relativeFallback);
      }
    });
  });
}
function initializeResponsiveLayout() {
  if (_responsiveLayoutInitialized) return;
  _responsiveLayoutInitialized = true;
  hoistUiOverlaysToBody();
  attachActionOptionsToGameContainer();
  initializeSponsorImageFallbacks();
  prewarmBetChipFx();
  applyResponsiveScale();
}

window.addEventListener('resize', scheduleResponsiveScale);
window.addEventListener('orientationchange', scheduleResponsiveScale);
window.visualViewport?.addEventListener('resize', scheduleResponsiveScale);
window.visualViewport?.addEventListener('scroll', scheduleResponsiveScale);
document.addEventListener('imdcx:scene-changed', event => {
  if (event.detail?.screen !== null) return;
  // The scene manager has restored the real DOM before this notification.
  // Measure now to avoid a frame at the wrong scale, then settle late layout.
  applyResponsiveScale();
  syncNonMySeatCardSize();
  refreshResponsiveScaleAfterRender();
});
window.addEventListener('DOMContentLoaded', initializeResponsiveLayout);
window.addEventListener('load', initializeResponsiveLayout);

function setPotLeftMode(enabled) {
  const pot = document.getElementById('pot');
  if (!pot) return;
  pot.classList.toggle('pot-left', Boolean(enabled));
}

try {
  window.addEventListener('beforeunload', () => {
    try { sessionStorage.setItem('pageReloadPending', '1'); } catch (e) {}
  });
} catch (e) {}

function getCenterMessageEls() {
  const zone = document.getElementById('center-message-zone');
  const text = document.getElementById('center-message-text');
  const pot = document.getElementById('pot');
  return { zone, text, pot };
}

function syncCenterOverlayVisibility(hide) {
  const pot = document.getElementById('pot');
  if (pot) {
    if (hide) pot.style.visibility = 'hidden';
    else pot.style.removeProperty('visibility');
  }
  const chipPileLayer = document.getElementById('bet-chip-pile-layer');
  if (chipPileLayer) {
    if (hide) chipPileLayer.style.visibility = 'hidden';
    else chipPileLayer.style.removeProperty('visibility');
  }
  const triggerBtn = document.getElementById('pot-breakdown-trigger');
  if (hide) {
    if (triggerBtn) triggerBtn.style.display = 'none';
    return;
  }
  refreshPotBreakdownTriggerVisibility();
}

function showCenterMessage(text, mode) {
  const { zone, text: textEl } = getCenterMessageEls();
  if (!zone || !textEl) return;

  zone.classList.remove('turn', 'winner', 'winner-final', 'lose', 'pulse', 'active');
  if (!text) {
    textEl.textContent = '';
    syncCenterOverlayVisibility(false);
    return;
  }

  textEl.textContent = text;
  zone.classList.add('active');
  syncCenterOverlayVisibility(true);
  if (mode === 'turn') zone.classList.add('turn', 'pulse');
  if (mode === 'winner') zone.classList.add('winner');
  if (mode === 'winner-final') zone.classList.add('winner-final');
  if (mode === 'lose') zone.classList.add('lose');
}

function stopTurnPulse() {
  if (!turnPulseActive) return;
  clearInterval(centerMessagePulseInterval);
  clearTimeout(centerMessagePulseTimeout);
  centerMessagePulseInterval = null;
  centerMessagePulseTimeout = null;
  turnPulseActive = false;
  if (centerMessageMode === 'turn') {
    centerMessageMode = null;
    showCenterMessage('', null);
  }
}

function startTurnPulse() {
  if (turnPulseActive) return;
  turnPulseActive = true;
  centerMessageMode = 'turn';

  const pulse = () => {
    showCenterMessage("It's your turn", 'turn');
    centerMessagePulseTimeout = setTimeout(() => {
      if (centerMessageMode === 'turn') showCenterMessage('', null);
    }, 2000);
  };

  pulse();
  centerMessagePulseInterval = setInterval(pulse, 7000);
}

function showWinnerMessage(text, isFinal = false) {
  if (endStateLocked && centerMessageMode === 'lose') return;
  if (suppressWinnerMessage) return;
  stopTurnPulse();
  centerMessageMode = isFinal ? 'winner-final' : 'winner';
  lastWinnerMessage = text;
  showCenterMessage(text, isFinal ? 'winner-final' : 'winner');
}

function revealSeatLabel(p, idx) {
  if (!p) return 'P?';
  if (Number.isInteger(p.seat)) return `P${p.seat + 1}`;
  if (typeof p.label === 'string' && p.label.trim()) return p.label.trim();
  return `P${idx + 1}`;
}

function formatCompactLabels(labels, maxShown = 3) {
  const unique = [];
  labels.forEach((name) => {
    const n = String(name || '').trim();
    if (!n || unique.includes(n)) return;
    unique.push(n);
  });
  if (unique.length <= maxShown) return unique.join(', ');
  return `${unique.slice(0, maxShown).join(', ')} (+${unique.length - maxShown} autres)`;
}

function formatChipAmount(v) {
  const n = Math.max(0, Math.floor(Number(v) || 0));
  return n.toLocaleString('fr-FR');
}

function getPlayerContributionForPots(p) {
  if (!p || p.inactive) return 0;
  const total = Math.max(0, Math.floor(Number(p.total_bet_hand) || 0));
  if (total > 0) return total;
  return Math.max(0, Math.floor(Number(p.subtotal_bet) || 0));
}

function buildSidePotsFromState(state) {
  const players = Array.isArray(state?.players) ? state.players : [];
  const contribs = players.map((p) => getPlayerContributionForPots(p));
  const caps = [...new Set(contribs.filter((c) => c > 0))].sort((a, b) => a - b);
  const pots = [];
  let prev = 0;

  caps.forEach((cap) => {
    let amount = 0;
    const eligible = [];
    players.forEach((p, i) => {
      const c = contribs[i];
      if (c > prev) amount += Math.min(c, cap) - prev;
      if (p && !p.inactive && !['FOLD', 'BUST', 'WAIT'].includes(p.status) && c >= cap) {
        eligible.push(i);
      }
    });
    if (amount > 0 && eligible.length > 0) {
      pots.push({ amount, eligible, cap });
    }
    prev = cap;
  });

  return { pots, contribs };
}

function resolvePotWinnersForSeats(state, eligibleSeats, allowedWinnerSet = null) {
  if (!Array.isArray(eligibleSeats) || !eligibleSeats.length) return [];
  const players = Array.isArray(state?.players) ? state.players : [];

  try {
    if (typeof get_winners === 'function' && Array.isArray(state?.board) && state.board.length >= 5) {
      const localSeats = [];
      const localPlayers = [];
      eligibleSeats.forEach((seatIdx) => {
        const p = players[seatIdx];
        if (!p || !p.carda || !p.cardb) return;
        localSeats.push(seatIdx);
        localPlayers.push({
          name: revealSeatLabel(p, seatIdx),
          carda: p.carda,
          cardb: p.cardb
        });
      });

      if (localPlayers.length) {
        const boardBackup = window.board;
        window.board = state.board.slice(0, 5);
        const winners = get_winners(localPlayers) || [];
        window.board = boardBackup;

        let winnerSeats = winners
          .map((w, i) => (w ? localSeats[i] : null))
          .filter(Number.isInteger);
        if (allowedWinnerSet instanceof Set) {
          winnerSeats = winnerSeats.filter((seat) => allowedWinnerSet.has(seat));
        }
        winnerSeats = winnerSeats.filter((seat, idx, arr) => arr.indexOf(seat) === idx);
        if (winnerSeats.length) return winnerSeats;
      }
    }
  } catch (e) {}

  let fallback = eligibleSeats.slice();
  if (allowedWinnerSet instanceof Set) {
    fallback = fallback.filter((seat) => allowedWinnerSet.has(seat));
  }
  fallback = fallback.filter((seat, idx, arr) => arr.indexOf(seat) === idx);
  return fallback.slice(0, 1);
}

function distributePotAmountEvenly(winnerSeats, amount, payouts) {
  if (!Array.isArray(winnerSeats) || !winnerSeats.length || !Array.isArray(payouts) || amount <= 0) return;
  const base = Math.floor(amount / winnerSeats.length);
  let rem = amount - (base * winnerSeats.length);
  winnerSeats.forEach((seat) => {
    payouts[seat] = (Number(payouts[seat]) || 0) + base;
  });
  for (let k = 0; k < rem; k += 1) {
    const seat = winnerSeats[k % winnerSeats.length];
    payouts[seat] = (Number(payouts[seat]) || 0) + 1;
  }
}

function buildHandBreakdownFromRevealState(revealState, winnerIdx) {
  const players = Array.isArray(revealState?.players) ? revealState.players : [];
  const winnerSeats = (Array.isArray(winnerIdx) ? winnerIdx : []).filter(Number.isInteger);
  if (!players.length || !winnerSeats.length) return null;

  const winnerSet = new Set(winnerSeats);
  const { pots, contribs } = buildSidePotsFromState(revealState);
  const payouts = Array(players.length).fill(0);

  const potRows = pots.map((pot, idx) => {
    const winnerSeatsForPot = resolvePotWinnersForSeats(revealState, pot.eligible, winnerSet);
    distributePotAmountEvenly(winnerSeatsForPot, pot.amount, payouts);
    return {
      kind: idx === 0 ? 'main' : 'side',
      index: idx,
      amount: pot.amount,
      eligibleSeats: pot.eligible.slice(),
      winnerSeats: winnerSeatsForPot.slice()
    };
  });

  const mainWinnerSeats = potRows[0]?.winnerSeats?.length
    ? potRows[0].winnerSeats.slice()
    : [winnerSeats[0]];
  const mainSet = new Set(mainWinnerSeats);
  const sideWinnerSeats = potRows
    .slice(1)
    .flatMap((pot) => pot.winnerSeats || [])
    .filter((seat, idx, arr) => !mainSet.has(seat) && arr.indexOf(seat) === idx);

  const playerRows = players.map((p, i) => {
    const invested = contribs[i] || 0;
    const received = payouts[i] || 0;
    const net = received - invested;
    return {
      seat: i,
      label: revealSeatLabel(p, i),
      invested,
      received,
      net
    };
  });

  return {
    createdAt: Date.now(),
    mainWinnerSeats,
    sideWinnerSeats,
    pots: potRows,
    players: playerRows
  };
}

function makePotBreakdownStorageKey() {
  if (_match2ID) return `potBreakdown_match2_${_match2ID}`;
  if (_tableID) return `potBreakdown_table_${_tableID}`;
  return null;
}

function persistLastHandBreakdown() {
  try {
    const key = makePotBreakdownStorageKey();
    if (!key || !lastResolvedHandBreakdown) return;
    sessionStorage.setItem(key, JSON.stringify(lastResolvedHandBreakdown));
  } catch (e) {}
}

function restoreLastHandBreakdown() {
  try {
    if (lastResolvedHandBreakdown) return;
    const key = makePotBreakdownStorageKey();
    if (!key) return;
    const raw = sessionStorage.getItem(key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.pots) || !Array.isArray(parsed.players)) return;
    lastResolvedHandBreakdown = parsed;
  } catch (e) {}
}

function ensurePotBreakdownStyle() {
  if (potBreakdownStyleInjected) return;
  const style = document.createElement('style');
  style.id = 'pot-breakdown-style';
  style.textContent = `
    #pot{
      cursor: default;
      pointer-events: auto;
    }
    #pot #current-pot{
      display: none;
      margin-right: 8px;
    }
    #pot #total-pot{
      display: inline-block;
    }
    #pot-breakdown-trigger{
      position: absolute;
      left: 50%;
      top: calc(100% + 6px);
      transform: translateX(-50%);
      display: none;
      min-width: 138px;
      border: 1px solid rgba(255, 214, 150, 0.75);
      border-radius: 999px;
      background: linear-gradient(180deg, rgba(62, 40, 20, 0.94), rgba(30, 20, 12, 0.94));
      color: #ffe5bb;
      font: 800 12px/1 "Montserrat", sans-serif;
      text-transform: uppercase;
      letter-spacing: .45px;
      padding: 8px 12px;
      line-height: 1;
      white-space: nowrap;
      cursor: pointer;
      box-shadow: 0 6px 14px rgba(0, 0, 0, 0.35);
      z-index: 12060;
      pointer-events: auto;
    }
    #pot-breakdown-trigger:hover{
      filter: brightness(1.08);
    }
    #pot-breakdown-trigger:active{
      transform: translate(-50%, 1px);
    }
    #pot-breakdown-panel{
      position: fixed;
      inset: 0;
      z-index: 32000;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(4, 12, 16, 0.72);
      padding: 16px;
      box-sizing: border-box;
    }
    #pot-breakdown-panel.active{
      display: flex;
    }
    #pot-breakdown-panel .pot-breakdown-card{
      position: relative;
      width: min(1020px, 96vw);
      max-height: 82vh;
      overflow: auto;
      border-radius: 14px;
      border: 1px solid rgba(255, 196, 120, 0.45);
      background: linear-gradient(165deg, rgba(9, 20, 24, 0.96), rgba(21, 28, 16, 0.96));
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.58);
      color: #f4efe2;
      padding: 14px 14px 12px;
      font-family: "Montserrat", sans-serif;
    }
    #pot-breakdown-panel .pot-breakdown-close{
      position: absolute;
      right: 10px;
      top: 8px;
      width: 30px;
      height: 30px;
      border: 0;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
      color: #fff;
      font-size: 20px;
      line-height: 1;
      cursor: pointer;
    }
    #pot-breakdown-panel .pot-breakdown-title{
      font-family: "Bangers", "Montserrat", sans-serif;
      letter-spacing: 1px;
      font-size: 32px;
      color: #ffd492;
      margin: 0 0 10px;
      text-align: center;
      text-transform: uppercase;
    }
    #pot-breakdown-panel .pot-breakdown-columns{
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    #pot-breakdown-panel .pot-breakdown-col{
      border: 1px solid rgba(255,255,255,0.16);
      border-radius: 10px;
      background: rgba(9, 9, 9, 0.35);
      padding: 10px;
      min-height: 180px;
    }
    #pot-breakdown-panel .pot-breakdown-col h4{
      margin: 0 0 8px;
      font-size: 15px;
      text-transform: uppercase;
      letter-spacing: .4px;
      color: #ffcf8a;
    }
    #pot-breakdown-panel .pot-breakdown-row{
      font-size: 13px;
      line-height: 1.35;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    #pot-breakdown-panel .pot-breakdown-row:last-child{
      border-bottom: 0;
    }
    #pot-breakdown-panel .pot-breakdown-net-plus{
      color: #7ef6a3;
      font-weight: 700;
    }
    #pot-breakdown-panel .pot-breakdown-net-minus{
      color: #ff8f8f;
      font-weight: 700;
    }
    #pot-breakdown-panel .pot-breakdown-hint{
      margin-top: 8px;
      opacity: .82;
      font-size: 12px;
    }
    @media (max-width: 860px){
      #pot-breakdown-panel .pot-breakdown-columns{
        grid-template-columns: 1fr;
      }
      #pot-breakdown-panel .pot-breakdown-title{
        font-size: 26px;
      }
    }
  `;
  document.head.appendChild(style);
  potBreakdownStyleInjected = true;
}

function ensurePotBreakdownPanel() {
  ensurePotBreakdownStyle();
  let panel = document.getElementById('pot-breakdown-panel');
  if (panel) return panel;

  panel = document.createElement('div');
  panel.id = 'pot-breakdown-panel';
  panel.innerHTML = `
    <div class="pot-breakdown-card">
      <button class="pot-breakdown-close" id="pot-breakdown-close" type="button" aria-label="Close">x</button>
      <h3 class="pot-breakdown-title">Pot Breakdown</h3>
      <div class="pot-breakdown-columns">
        <section class="pot-breakdown-col">
          <h4>Main + Side Pots (Live)</h4>
          <div id="pot-breakdown-live"></div>
        </section>
        <section class="pot-breakdown-col">
          <h4>Derniere main (explication)</h4>
          <div id="pot-breakdown-last"></div>
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(panel);

  panel.addEventListener('click', (ev) => {
    if (ev.target === panel) closePotBreakdownPanel();
  });
  panel.querySelector('#pot-breakdown-close')?.addEventListener('click', closePotBreakdownPanel);
  return panel;
}

function renderLivePotsHtml(state) {
  const { pots } = buildSidePotsFromState(state);
  if (!pots.length) {
    return '<div class="pot-breakdown-row">Main pot: 0</div>';
  }
  return pots.map((pot, idx) => {
    const kindLabel = idx === 0 ? 'Main pot' : `Side pot ${idx}`;
    const eligibleNames = (pot.eligible || []).map((seat) => revealSeatLabel(state.players?.[seat], seat));
    return `<div class="pot-breakdown-row"><strong>${kindLabel}</strong>: ${formatChipAmount(pot.amount)} | Eligibles: ${formatCompactLabels(eligibleNames, 4)}</div>`;
  }).join('');
}

function renderLastHandHtml(breakdown) {
  if (!breakdown || !Array.isArray(breakdown.pots) || !Array.isArray(breakdown.players)) {
    return '<div class="pot-breakdown-row">Aucune main precedente resolue.</div>';
  }

  const potRows = breakdown.pots.map((pot) => {
    const potName = pot.kind === 'main' ? 'Main pot' : `Side pot ${pot.index}`;
    const winners = (pot.winnerSeats || []).map((seat) => breakdown.players[seat]?.label || `P${seat + 1}`);
    const winnerText = winners.length ? formatCompactLabels(winners, 4) : 'n/a';
    return `<div class="pot-breakdown-row"><strong>${potName}</strong>: ${formatChipAmount(pot.amount)} -> ${winnerText}</div>`;
  }).join('');

  const playerRows = breakdown.players
    .filter((p) => (p.invested > 0 || p.received > 0))
    .sort((a, b) => b.net - a.net)
    .map((p) => {
      const netClass = p.net >= 0 ? 'pot-breakdown-net-plus' : 'pot-breakdown-net-minus';
      const netPrefix = p.net >= 0 ? '+' : '-';
      return `<div class="pot-breakdown-row">${p.label}: mise ${formatChipAmount(p.invested)} | recu ${formatChipAmount(p.received)} | <span class="${netClass}">net ${netPrefix}${formatChipAmount(Math.abs(p.net))}</span></div>`;
    })
    .join('');

  return `${potRows}${playerRows ? `<div class="pot-breakdown-row"><strong>Net par joueur</strong></div>${playerRows}` : ''}<div class="pot-breakdown-hint">Le center message resume. Ici tu as le detail complet de la repartition.</div>`;
}

function renderPotBreakdownPanel() {
  if (!potBreakdownPanelOpen) return;
  restoreLastHandBreakdown();
  const panel = ensurePotBreakdownPanel();
  const liveEl = panel.querySelector('#pot-breakdown-live');
  const lastEl = panel.querySelector('#pot-breakdown-last');
  const liveState = currentGameState || window.gameState || {};
  if (liveEl) liveEl.innerHTML = renderLivePotsHtml(liveState);
  if (lastEl) lastEl.innerHTML = renderLastHandHtml(lastResolvedHandBreakdown);
}

function openPotBreakdownPanel() {
  const panel = ensurePotBreakdownPanel();
  potBreakdownPanelOpen = true;
  panel.classList.add('active');
  renderPotBreakdownPanel();
}

function closePotBreakdownPanel() {
  potBreakdownPanelOpen = false;
  const panel = document.getElementById('pot-breakdown-panel');
  panel?.classList.remove('active');
}

function shouldShowPotBreakdownTrigger() {
  const triggerBtn = document.getElementById('pot-breakdown-trigger');
  const pot = document.getElementById('pot');
  if (!triggerBtn || !pot) return false;
  const loading = document.getElementById('loading-screen');
  if (loading && loading.isConnected) return false;

  const gs = currentGameState || window.gameState;
  if (!gs || !Array.isArray(gs.players)) return false;
  if (gs.phase === 'waiting') return false;

  const cs = window.getComputedStyle(pot);
  if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
  return true;
}

function refreshPotBreakdownTriggerVisibility() {
  const triggerBtn = document.getElementById('pot-breakdown-trigger');
  if (!triggerBtn) return;
  const visible = shouldShowPotBreakdownTrigger();
  triggerBtn.style.display = visible ? 'block' : 'none';
  if (!visible && potBreakdownPanelOpen) closePotBreakdownPanel();
}

function setupPotBreakdownInteraction() {
  ensurePotBreakdownStyle();
  restoreLastHandBreakdown();
  const pot = document.getElementById('pot');
  if (!pot) return;
  const currentPotEl = document.getElementById('current-pot');
  if (currentPotEl) currentPotEl.textContent = 'POT';

  let triggerBtn = document.getElementById('pot-breakdown-trigger');
  const host = pot;
  if (!triggerBtn) {
    triggerBtn = document.createElement('button');
    triggerBtn.id = 'pot-breakdown-trigger';
    triggerBtn.type = 'button';
    triggerBtn.textContent = 'Details Pots';
  }
  if (triggerBtn.parentElement !== host) {
    host.appendChild(triggerBtn);
  }
  refreshPotBreakdownTriggerVisibility();
  if (pot.dataset.breakdownBound === '1') return;
  pot.dataset.breakdownBound = '1';
  window.addEventListener('resize', refreshPotBreakdownTriggerVisibility);
  window.addEventListener('orientationchange', refreshPotBreakdownTriggerVisibility);
  triggerBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (potBreakdownPanelOpen) closePotBreakdownPanel();
    else openPotBreakdownPanel();
  });
}

function buildRevealWinnerLabel(revealState, winnerIdx) {
  const players = Array.isArray(revealState?.players) ? revealState.players : [];
  const winnerSeats = (Array.isArray(winnerIdx) ? winnerIdx : []).filter(Number.isInteger);
  if (!winnerSeats.length) return '';

  const breakdown = buildHandBreakdownFromRevealState(revealState, winnerSeats);
  if (breakdown) {
    lastResolvedHandBreakdown = breakdown;
    persistLastHandBreakdown();
    if (potBreakdownPanelOpen) renderPotBreakdownPanel();
  }

  const mainWinnerSeats = breakdown?.mainWinnerSeats?.length ? breakdown.mainWinnerSeats : [winnerSeats[0]];
  const mainNames = mainWinnerSeats.map((i) => revealSeatLabel(players[i], i));
  if (mainNames.length <= 1) return `The Winner is : ${mainNames[0] || 'P?'}`;
  if (mainNames.length === 2) return `The Winner is : ${mainNames[0]} and ${mainNames[1]}`;
  return `The Winner is : ${mainNames.slice(0, -1).join(', ')} and ${mainNames[mainNames.length - 1]}`;
}

function clearWinnerMessage() {
  if ((centerMessageMode === 'winner' || centerMessageMode === 'winner-final') && !endStateLocked) {
    centerMessageMode = null;
    showCenterMessage('', null);
  }
  lastWinnerMessage = '';
}

/** Actions utilisateur */
// === Waiting pill (arcade) Ã¢â‚¬â€ init markup une seule fois ===
document.addEventListener('DOMContentLoaded', () => {
  const wc = document.getElementById('waiting-count');
  if (wc && !wc.dataset.arcadeInit) {
    wc.innerHTML = '<span class="dots">En attente de joueurs :</span> <span id="wc-line">0/0</span><span class="stars"></span>';
    wc.dataset.arcadeInit = '1';
    // Optionnel: s'assurer qu'il est visible quand tu l'utilises
    wc.style.display = 'block';
  }
});

function human_fold() {
  if (isPublicSpectator) return;
  console.log("[client] Fold");
  socket.emit("playerAction", { type: "fold" });
}
function human_call() {
  if (isPublicSpectator) return;
  console.log("[client] Call");
  if (!currentGameState) return;
  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  if (meIdx < 0) return;
  const me = currentGameState.players[meIdx];
  const toCall = Math.max(0, (currentGameState.current_bet||0) - (me.subtotal_bet||0));
  socket.emit("playerAction", { type: "call", amount: toCall });
}
function human_check_call() {
  if (isPublicSpectator) return;
  if (!currentGameState) return;
  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  if (meIdx < 0) return;
  const me = currentGameState.players[meIdx];
  const toCall = Math.max(0, (currentGameState.current_bet || 0) - (me.subtotal_bet || 0));
  if (toCall > 0) {
    human_call();
  } else {
    human_check();
  }
}
function human_check() {
  if (isPublicSpectator) return;
  console.log("[client] Check");
  if (!currentGameState) return;

  // montant ÃƒÂ  payer = current_bet - ce que j'ai dÃƒÂ©jÃƒÂ  mis
  const meIdx  = currentGameState.players.findIndex(p => p.id === mySocketId);
  if (meIdx < 0) return;
  const me     = currentGameState.players[meIdx];
  const toCall = Math.max(0, (currentGameState.current_bet || 0) - (me.subtotal_bet || 0));

  if (toCall > 0) {
    showErrorToast(`${toCall} engaged : click on X to Play`);
    return; // Ã¢â€ºâ€Ã¯Â¸Â on n'ÃƒÂ©met pas de "check"
  }
  socket.emit("playerAction", { type: "check" });
}

/** Griser / activer Fold & Call */
function gui_hide_fold_call_click() {
  const fold = document.querySelector("#fold-button");
  const call = document.querySelector("#call-button");
  if (fold) { fold.classList.add("disabled"); fold.onclick = null; }
  if (call) { call.classList.add("disabled"); call.onclick = null; }
  gui_disable_shortcut_keys();
}
function gui_setup_fold_call_click(foldText, callText, foldFunc, callFunc) {
  const fold = document.querySelector("#fold-button");
  const call = document.querySelector("#call-button");
  if (fold) {
    fold.classList.remove("disabled");
    internal_clickin_helper(fold, foldText, foldFunc);
  }
  if (call) {
    call.classList.remove("disabled");
    internal_clickin_helper(call, callText, callFunc);
  }
}

/** Animation de vos cartes */
function preloadMyCardFace(code) {
  if (!code || code === 'blinded' || typeof internal_GetCardImageUrl !== 'function') return;
  const cssUrl = internal_GetCardImageUrl(code);
  const match = typeof cssUrl === 'string'
    ? cssUrl.match(/url\((['"]?)(.*?)\1\)/i)
    : null;
  const src = match && match[2] ? match[2] : null;
  if (!src || myCardFacePreloaded.has(src)) return;
  myCardFacePreloaded.add(src);
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
}

function flipMyCardsWithLift3D(c1, c2, cardA, cardB) {
  if (window.IMDCXMotion && c1 && c2 && cardA && cardB) {
    const runId = myCardAnimRunId;
    const index = mySeatIndex;
    [c1, c2].forEach((el, n) => {
      const code = n === 0 ? cardA : cardB;
      window.IMDCXMotion.flip(el, `deal:${runId}:${code}`, () => {
        internal_setCard(el, code, false);
        el.classList.add('visible', 'revealed');
      }, { delay: n * 65, valid: () => runId === myCardAnimRunId && index === mySeatIndex });
    });
    return;
  }
  if (!c1 || !c2 || !cardA || !cardB) {
    if (typeof flipCardsSimultaneously === 'function') {
      flipCardsSimultaneously(c1, c2, cardA, cardB);
    }
    return;
  }

  const pairs = [
    { el: c1, code: cardA, delay: 0 },
    { el: c2, code: cardB, delay: 110 }
  ];

  myCardAnimHandles.forEach((a) => {
    try { a.cancel(); } catch (e) {}
  });
  myCardAnimHandles = [];
  myCardAnimTimers.forEach((t) => clearTimeout(t));
  myCardAnimTimers = [];

  const addAnimTimer = (fn, ms) => {
    const id = setTimeout(() => {
      myCardAnimTimers = myCardAnimTimers.filter((x) => x !== id);
      fn();
    }, ms);
    myCardAnimTimers.push(id);
    return id;
  };

  pairs.forEach(({ el, code, delay }) => {
    const wrap = (el.closest && el.closest('.holecard1, .holecard2')) || el;
    if (!wrap || !el) return;

    addAnimTimer(() => {
      wrap.classList.remove('my-card-3d-wrap');
      wrap.classList.remove('my-card-landing');
      wrap.style.removeProperty('--my3d-delay');
      wrap.style.animation = 'none';
      void wrap.offsetWidth;
      wrap.style.setProperty('--my3d-delay', `${delay}ms`);
      wrap.classList.add('my-card-3d-wrap');
      wrap.style.removeProperty('animation');
      el.classList.add('visible');
    }, 0);

    addAnimTimer(() => {
      internal_setCard(el, code, false);
      el.classList.add('revealed', 'visible', 'deal-flip');
    }, delay + 600);

    addAnimTimer(() => {
      wrap.classList.add('my-card-landing');
      el.classList.remove('my-card-halo');
      void el.offsetWidth;
      el.classList.add('my-card-halo');
    }, delay + 1200);

    addAnimTimer(() => {
      wrap.classList.remove('my-card-3d-wrap');
      wrap.classList.remove('my-card-landing');
      el.classList.remove('my-card-halo');
      wrap.style.removeProperty('--my3d-delay');
      wrap.style.removeProperty('animation');
    }, delay + 4320);
  });

}

function animateMyCards() {
  if (mySeatIndex === null) return;
  myCardAnimRunId += 1;
  const runId = myCardAnimRunId;
  const meNow = currentGameState?.players?.[mySeatIndex];
  if (meNow?.carda && meNow?.cardb) {
    rememberMyKnownHoleCards(meNow.carda, meNow.cardb);
  }
  const mySeatEl = document.getElementById("seat" + mySeatIndex);
  if (!mySeatEl) return;

  const [c1, c2] = Array.from(mySeatEl.querySelectorAll(".holecards .card"));
  if (!c1 || !c2) return;
  const revealDelayMs = getMyCardsRevealDelayMs();
  window.IMDCXMotion?.deal();
  myCardsBackLockUntil = Date.now() + revealDelayMs;

  // 1) Fade-in du back
  [c1, c2].forEach(card => {
    card.style.transition = "";
    card.style.transform  = "";
    card.classList.remove("revealed", "visible");
    card.classList.remove("deal-flip");
    internal_setCard(card, "blinded", false, true);
    requestAnimationFrame(() => card.classList.add("visible"));
  });

  // 2) AprÃƒÂ¨s 5s Ã¢â€ â€™ flip
  if (myCardsFlipTimer) clearTimeout(myCardsFlipTimer);
  myCardsFlipTimer = setTimeout(() => {
    if (runId !== myCardAnimRunId) return;
    const me = currentGameState?.players?.[mySeatIndex];
    if (!me || !me.carda || !me.cardb) return;
    rememberMyKnownHoleCards(me.carda, me.cardb);
    preloadMyCardFace(me.carda);
    preloadMyCardFace(me.cardb);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (runId !== myCardAnimRunId) return;
        flipMyCardsWithLift3D(c1, c2, me.carda, me.cardb);
      });
    });
    myCardsRevealed = true;
  }, revealDelayMs);
}

function resetMySeatBacks() {
  if (mySeatIndex === null) return;
  myCardAnimRunId += 1; // Invalidate queued visual frames as well as running flips.
  myCardsBackLockUntil = 0;
  const mySeatEl = document.getElementById("seat" + mySeatIndex);
  if (!mySeatEl) return;
  if (myCardsFlipTimer) {
    clearTimeout(myCardsFlipTimer);
    myCardsFlipTimer = null;
  }
  myCardAnimHandles.forEach((a) => {
    try { a.cancel(); } catch (e) {}
  });
  myCardAnimHandles = [];
  myCardAnimTimers.forEach((t) => clearTimeout(t));
  myCardAnimTimers = [];
  const cards = mySeatEl.querySelectorAll(".holecards .card");
  cards.forEach(card => {
    window.IMDCXMotion?.cancelCard(card);
    card.style.transition = "";
    card.style.transform  = "";
    card.classList.remove("revealed", "visible");
    card.classList.remove("deal-flip");
    card.classList.remove("my-card-3d-flip");
    card.classList.remove("my-card-halo");
    card.style.removeProperty('--my3d-delay');
    internal_setCard(card, "blinded", false, true);
    requestAnimationFrame(() => card.classList.add("visible"));
  });
  mySeatEl.querySelectorAll('.holecard1, .holecard2').forEach((wrap) => {
    wrap.classList.remove('my-card-3d-wrap');
    wrap.classList.remove('my-card-landing');
    wrap.style.removeProperty('--my3d-delay');
    wrap.style.removeProperty('transform');
    wrap.style.removeProperty('filter');
    wrap.style.removeProperty('animation');
  });
}

function setSpectatorButtonsDisabled(enabled) {
  const ids = [
    "rules-help-btn",
    "odds-help-btn",
    "break-btn",
    "btn-time",
    "btn-add30",
    "reveal-hide-btn",
    "reveal-show-btn"
  ];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("is-disabled", enabled);
    el.setAttribute("aria-disabled", enabled ? "true" : "false");
    if ("disabled" in el) el.disabled = enabled;
  });
  if (enabled) {
    // Keep personal stats accessible after bust / end-of-game.
    const statsBtn = document.getElementById('stats-help-btn');
    if (statsBtn) {
      statsBtn.classList.remove('is-disabled');
      statsBtn.setAttribute('aria-disabled', 'false');
      if ('disabled' in statsBtn) statsBtn.disabled = false;
    }
    gui_hide_fold_call_click();
    disableRaiseButton();
  }
}

function isLiveBustedSpectator(state = currentGameState) {
  const me = state?.players?.[mySeatIndex];
  return Boolean(me && me.status === 'BUST' && suppressFinalReplayAfterClose);
}

function clearMySeatHoleCardsForSpectator() {
  if (!Number.isInteger(mySeatIndex) || mySeatIndex < 0) return;
  gui_set_player_cards('blinded', 'blinded', mySeatIndex, false);
  const mySeatEl = document.getElementById('seat' + mySeatIndex);
  mySeatEl?.querySelectorAll('.holecards .card').forEach((card) => {
    card.classList.remove('deal-flip', 'revealed', 'my-card-halo');
    card.classList.add('visible');
    card.style.transition = '';
    card.style.transform = '';
  });
}

function renderNeutralLiveSpectatorView(state = currentGameState) {
  stopTurnPulse();
  hideRevealButton();
  clearWinnerMessage();
  centerMessageMode = null;
  showCenterMessage('', null);
  document.body.classList.remove('final-end-ui', 'final-winner-ui');
  clearLockedFinalWinnerSeatCards();
  clearScheduledFinalSeatCardLock();
  clearFinalSeatCardLockStyles();
  setupBoardBacks();

  const domSeats = Array.from(document.querySelectorAll('.seat'));
  domSeats.forEach((seatEl, idx) => {
    seatEl.classList.remove('final-winner', 'final-spectator', 'spectator-bust', 'winning-hand', 'losing-hand');
    if (idx === mySeatIndex) return;
    gui_set_player_cards('', '', idx, false);
  });
  clearMySeatHoleCardsForSpectator();
}

function applyBustSpectatorView(gameState) {
  const me = gameState?.players?.[mySeatIndex];
  if (!me || me.status !== 'BUST') return false;
  rememberMyKnownHoleCardsFromState(gameState);
  const isFinalLockActive = (
    endStateLocked ||
    gameOverFreezeActive ||
    document.body.classList.contains('final-end-ui')
  );
  if (isFinalLockActive) {
    const mySeatEl = ensureMySeatClass();
    if (mySeatEl) mySeatEl.classList.add("spectator-bust");
    setSpectatorButtonsDisabled(true);
    return true;
  }
  const isHyperRevealHold = (
    String(gameMode || '').toLowerCase() === 'hyper' &&
    gameState?.phase === 'reveal' &&
    Date.now() < hyperRevealHoldUntil
  );
  if (isHyperRevealHold && !suppressFinalReplayAfterClose) return false;
  const mySeatEl = ensureMySeatClass();
  if (mySeatEl) mySeatEl.classList.add("spectator-bust");
  if (isLiveBustedSpectator(gameState)) clearMySeatHoleCardsForSpectator();
  else resetMySeatBacks();
  myCardsRevealed = false;
  if (!endStateLocked) showCenterMessage('', null);
  setSpectatorButtonsDisabled(true);
  return true;
}

function applyFinalSpectatorView() {
  const mySeatEl = ensureMySeatClass();
  if (mySeatEl) mySeatEl.classList.add("final-spectator");
  resetMySeatBacks();
  myCardsRevealed = false;
  setSpectatorButtonsDisabled(true);
  return true;
}

function cloneSnapshotSafe(source) {
  if (!source) return null;
  try {
    return JSON.parse(JSON.stringify(source));
  } catch (e) {
    return source;
  }
}

function setLockedEndStateSnapshot(snapshot) {
  lockedEndStateSnapshot = cloneSnapshotSafe(snapshot);
}

function rememberMyKnownHoleCardsFromState(state) {
  const me = state?.players?.[mySeatIndex];
  if (me?.carda && me?.cardb) {
    myLastKnownHoleCards = { carda: me.carda, cardb: me.cardb };
  }
}

function rememberMyKnownHoleCards(carda, cardb) {
  if (!carda || !cardb) return;
  myLastKnownHoleCards = { carda, cardb };
}

function buildFreezeSnapshotFromState(state) {
  const snap = cloneSnapshotSafe(state);
  if (!snap || !Array.isArray(snap.players)) return null;
  Object.keys(revealDisplayedCards || {}).forEach((seatKey) => {
    const seatIdx = Number(seatKey);
    const cards = revealDisplayedCards[seatKey];
    if (!Number.isInteger(seatIdx) || !cards?.carda || !cards?.cardb) return;
    const p = snap.players?.[seatIdx];
    if (!p) return;
    if (!p.carda) p.carda = cards.carda;
    if (!p.cardb) p.cardb = cards.cardb;
  });
  if (Number.isInteger(mySeatIndex) && mySeatIndex >= 0 && myLastKnownHoleCards?.carda && myLastKnownHoleCards?.cardb) {
    const me = snap.players?.[mySeatIndex];
    if (me) {
      if (!me.carda) me.carda = myLastKnownHoleCards.carda;
      if (!me.cardb) me.cardb = myLastKnownHoleCards.cardb;
    }
  }
  return snap;
}

function getBestGameOverFreezeSnapshot() {
  const lockedSnap = cloneSnapshotSafe(lockedEndStateSnapshot);
  if (lockedSnap?.players?.length) return lockedSnap;
  const revealSnap = cloneSnapshotSafe(lastCompletedRevealSnapshot);
  if (revealSnap?.players?.length) return revealSnap;
  const currentSnap = cloneSnapshotSafe(currentGameState);
  if (currentSnap?.players?.length) return currentSnap;
  return null;
}

function applyLateJoinFinishedCardsMask(snapshot = null) {
  if (!lateJoinFinishedState) return;
  const source = snapshot || lockedEndStateSnapshot || currentGameState;
  if (!source || !Array.isArray(source.players)) return;

  setupBoardBacks();
  resetAllBacks(null, source);

  const winnerSeat = resolveFinalWinnerSeatForView(source);
  source.players.forEach((p, idx) => {
    const seatEl = document.getElementById('seat' + idx);
    if (!seatEl) return;

    seatEl.classList.remove('final-winner');
    if (p?.inactive || p?.status === 'WAIT') {
      gui_set_player_cards('', '', idx, false);
      return;
    }

    if (Number.isInteger(winnerSeat) && idx === winnerSeat) {
      gui_set_player_cards('', '', idx, false);
      seatEl.classList.add('final-winner');
      return;
    }

    gui_set_player_cards('blinded', 'blinded', idx, false);
    seatEl.querySelectorAll('.holecards .card').forEach((card) => {
      card.classList.remove('deal-flip', 'revealed');
      card.classList.add('visible');
    });
  });
}

function resolveFreezeSeatCards(snapshot, seatIdx) {
  if (!Number.isInteger(seatIdx) || seatIdx < 0) return null;
  const fromSnapshot = snapshot?.players?.[seatIdx];
  if (fromSnapshot?.carda && fromSnapshot?.cardb) {
    return { carda: fromSnapshot.carda, cardb: fromSnapshot.cardb };
  }
  const fromReveal = revealDisplayedCards?.[seatIdx];
  if (fromReveal?.carda && fromReveal?.cardb) {
    return { carda: fromReveal.carda, cardb: fromReveal.cardb };
  }
  if (seatIdx === mySeatIndex && myLastKnownHoleCards?.carda && myLastKnownHoleCards?.cardb) {
    return { carda: myLastKnownHoleCards.carda, cardb: myLastKnownHoleCards.cardb };
  }
  return null;
}

function resolveFreezeWinnerSeatAndCards(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.players)) return null;
  let winnerIdx = snapshot.players.findIndex(p => p && p.status === 'WINNER');
  if (winnerIdx < 0 && snapshot.winReason?.winnerId) {
    winnerIdx = snapshot.players.findIndex(p => p && p.id === snapshot.winReason.winnerId);
  }
  if (winnerIdx < 0) {
    winnerIdx = snapshot.players.findIndex(p => p && !p.inactive && p.status !== 'BUST' && p.status !== 'WAIT');
  }
  if (winnerIdx < 0) return null;
  const cards = resolveFreezeSeatCards(snapshot, winnerIdx);
  if (!cards?.carda || !cards?.cardb) return null;
  return { seat: winnerIdx, cards };
}

function enforceMyFreezeCardsVisible(snapshot = null) {
  const source = snapshot || gameOverFrozenSnapshot || lockedEndStateSnapshot || currentGameState;
  if (isFinalGameOverState(source)) return false;
  const myCards = resolveFreezeSeatCards(source, mySeatIndex);
  if (!myCards?.carda || !myCards?.cardb) return false;
  rememberMyKnownHoleCards(myCards.carda, myCards.cardb);
  const mySeatEl = document.getElementById('seat' + mySeatIndex);
  const hole1 = mySeatEl?.querySelector('.holecards .holecard1');
  const hole2 = mySeatEl?.querySelector('.holecards .holecard2');
  if (!hole1 || !hole2) return false;
  internal_setCard(hole1, myCards.carda, false, false);
  internal_setCard(hole2, myCards.cardb, false, false);
  [hole1, hole2].forEach((card) => {
    card.classList.remove('deal-flip');
    card.classList.add('revealed', 'visible');
  });
  mySeatEl.querySelectorAll('.holecards .card').forEach((card) => {
    card.classList.remove('deal-flip');
    card.classList.add('revealed', 'visible');
  });
  return true;
}

function clearScheduledMyFreezeCardLock() {
  myFreezeCardLockTimers.forEach((t) => clearTimeout(t));
  myFreezeCardLockTimers = [];
}

function scheduleMyFreezeCardLock(snapshot = null) {
  clearScheduledMyFreezeCardLock();
  enforceMyFreezeCardsVisible(snapshot);
  [40, 120, 260, 520, 900].forEach((delay) => {
    const t = setTimeout(() => {
      if (gameOverFreezeActive || (endStateLocked && centerMessageMode === 'lose')) {
        enforceMyFreezeCardsVisible(snapshot);
      }
    }, delay);
    myFreezeCardLockTimers.push(t);
  });
}

function renderGameOverFreezeSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.players)) return;
  // Freeze view must not show "next player to act" artifacts.
  stopTurnPulse();
  document.querySelectorAll('.seat.turn').forEach((seatEl) => seatEl.classList.remove('turn'));
  gui_hide_fold_call_click();

  // Keep my seat untouched here to avoid a one-frame hide/show flicker on GAME OVER.
  resetAllBacks(mySeatIndex);
  setupBoardBacks();

  if (lateJoinFinishedState) {
    const winnerFreeze = resolveFreezeWinnerSeatAndCards(snapshot);
    if (winnerFreeze) {
      lockedFinalWinnerSeat = winnerFreeze.seat;
      lockedFinalWinnerCards = {
        carda: winnerFreeze.cards.carda,
        cardb: winnerFreeze.cards.cardb
      };
    } else {
      lockFinalWinnerSeatFromState(snapshot);
    }
    applyLateJoinFinishedCardsMask(snapshot);
    clearScheduledMyFreezeCardLock();
    return;
  }

  for (let i = 0; i < 5; i += 1) {
    if (snapshot.board && snapshot.board[i]) {
      setBoardFace(i, snapshot.board[i], false, 0, 0);
    }
  }

  // Final game-over view: keep only winner cards + my busted personal cards.
  if (isFinalGameOverState(snapshot)) {
    const myFreezeCards = resolveFreezeSeatCards(snapshot, mySeatIndex);
    const winnerFreeze = resolveFreezeWinnerSeatAndCards(snapshot);
    snapshot.players.forEach((p, idx) => {
      const seatEl = document.getElementById('seat' + idx);
      if (!seatEl) return;
      const hole1 = seatEl.querySelector('.holecards .holecard1');
      const hole2 = seatEl.querySelector('.holecards .holecard2');
      const isMyFinalBustView = (
        idx === mySeatIndex &&
        p?.status === 'BUST' &&
        myFreezeCards?.carda &&
        myFreezeCards?.cardb &&
        hole1 &&
        hole2
      );
      const isWinnerSeatView = (
        winnerFreeze &&
        idx === winnerFreeze.seat &&
        winnerFreeze.cards?.carda &&
        winnerFreeze.cards?.cardb
      );
      if (isMyFinalBustView) {
        internal_setCard(hole1, myFreezeCards.carda, false, false);
        internal_setCard(hole2, myFreezeCards.cardb, false, false);
        [hole1, hole2].forEach((card) => {
          card.classList.remove('deal-flip');
          card.classList.add('revealed', 'visible');
        });
      } else if (isWinnerSeatView) {
        gui_set_player_cards(winnerFreeze.cards.carda, winnerFreeze.cards.cardb, idx, false);
        seatEl.querySelectorAll('.holecards .card').forEach((card) => {
          card.classList.remove('deal-flip');
          card.classList.add('revealed', 'visible');
        });
      } else {
        gui_set_player_cards('', '', idx, false);
        seatEl.querySelectorAll('.holecards .card').forEach((card) => {
          card.classList.remove('deal-flip', 'revealed', 'visible');
        });
      }
      seatEl.classList.remove('status-fold');
      seatEl.classList.toggle('status-bust', p?.status === 'BUST');
      seatEl.classList.toggle('status-winner', p?.status === 'WINNER');
      seatEl.classList.toggle('final-winner', Boolean(isWinnerSeatView || p?.status === 'WINNER'));
    });
    clearScheduledMyFreezeCardLock();
    return;
  }

  enforceMyFreezeCardsVisible(snapshot);

  const winnerFreeze = resolveFreezeWinnerSeatAndCards(snapshot);
  if (winnerFreeze) {
    lockedFinalWinnerSeat = winnerFreeze.seat;
    lockedFinalWinnerCards = {
      carda: winnerFreeze.cards.carda,
      cardb: winnerFreeze.cards.cardb
    };
  } else {
    lockFinalWinnerSeatFromState(snapshot);
  }
  renderLockedFinalWinnerSeatCards();
  enforceWinnerOnlyCardsInFinalView(snapshot);
  scheduleFinalSeatCardLock();
  scheduleMyFreezeCardLock(snapshot);
}

function isFinalGameOverState(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.players)) return false;
  const survivors = snapshot.players.filter((p) => p && !p.inactive && p.status !== 'BUST');
  return survivors.length <= 1;
}

function isLikelyFinalSnapshot(state) {
  if (!state || !Array.isArray(state.players)) return false;
  if (state.gameFinished === true) return true;
  const active = state.players.filter((p) => p && !p.inactive && p.status !== 'WAIT');
  const survivors = active.filter((p) => p.status !== 'BUST');
  return survivors.length <= 1;
}

function ensureGameOverFreezeCloseButton() {
  let btn = document.getElementById('gameover-freeze-close');
  if (btn) return btn;

  btn = document.createElement('button');
  btn.id = 'gameover-freeze-close';
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Rejoindre la partie en direct');
  btn.textContent = '\u00D7';
  btn.style.position = 'fixed';
  btn.style.top = '14px';
  btn.style.right = '14px';
  btn.style.width = '42px';
  btn.style.height = '42px';
  btn.style.border = '1px solid rgba(255,255,255,.7)';
  btn.style.borderRadius = '999px';
  btn.style.background = 'rgba(0,0,0,.55)';
  btn.style.color = '#fff';
  btn.style.fontSize = '30px';
  btn.style.lineHeight = '36px';
  btn.style.textAlign = 'center';
  btn.style.cursor = 'pointer';
  btn.style.zIndex = '2147483600';
  btn.style.padding = '0';
  btn.style.userSelect = 'none';

  btn.addEventListener('click', () => {
    if (!gameOverFreezeActive && !pendingLiveSpectatorState && !currentGameState) return;
    gameOverFreezeActive = false;
    gameOverFrozenSnapshot = null;
    btn.remove();

    endStateLocked = false;
    restoreFinalWinnerOnlyView = false;
    lockRestoredFinalView = false;
    // Once user exits freeze manually, keep live spectator mode until true reset/new game for this seat.
    suppressFinalReplayAfterClose = true;
    endStatePending = null;
    document.body.classList.remove('final-end-ui', 'final-winner-ui');
    centerMessageMode = null;
    showCenterMessage('', null);
    clearLockedFinalWinnerSeatCards();
    clearScheduledFinalSeatCardLock();
    clearScheduledMyFreezeCardLock();
    clearFinalSeatCardLockStyles();
    lockedEndStateSnapshot = null;
    revealedAllSeats = false;
    revealShownSeats = new Set();
    revealDisplayedCards = {};
    hyperRevealHoldUntil = 0;
    hyperRevealHoldCards = null;
    finalStateDeferred = false;
    deferredFinalStateSnapshot = null;
    revealSeatShowStartedAt = null;
    revealFlowToken += 1;
    window._neonLingerUntil = 0;
    clearWinnerMessage();
    centerMessageMode = null;
    showCenterMessage('', null);
    if (currentGameState?.players?.length) {
      resetAllBacks();
      setupBoardBacks();
    }
    document.querySelectorAll('.seat').forEach((seatEl) => {
      seatEl.classList.remove('final-winner', 'final-spectator', 'spectator-bust', 'winning-hand', 'losing-hand');
    });

    clearStoredEndState(_tableID, _match2ID, mySeatIndex);
    try { sessionStorage.setItem('forceLiveAfterClose', '1'); } catch (e) {}
    setLiveSpectatorReloadFlag(_tableID, _match2ID, mySeatIndex, true);
    const liveState = pendingLiveSpectatorState || currentGameState || null;
    pendingLiveSpectatorState = null;
    if (liveState?.players?.length) {
      currentGameState = liveState;
      removeLoadingScreenNow();
      if (liveState.phase === 'reveal') {
        skipRevealAfterFreezeClose = true;
        renderNeutralLiveSpectatorView(liveState);
      } else {
        skipRevealAfterFreezeClose = false;
        handleGameStateUpdate(liveState);
      }
      applyBustSpectatorView(liveState);
      refreshResponsiveScaleAfterRender();
      centerTableOnce();
      return;
    }
    // Fallback only when no live snapshot is available yet.
    window.location.reload();
    return;
  });

  document.body.appendChild(btn);
  return btn;
}

function enableGameOverFreeze(snapshot) {
  gameOverFreezeActive = true;
  gameOverFrozenSnapshot = cloneSnapshotSafe(snapshot || currentGameState);
  setLockedEndStateSnapshot(gameOverFrozenSnapshot);
  pendingLiveSpectatorState = null;
  const isFinalFreeze = isFinalGameOverState(gameOverFrozenSnapshot);
  if (isFinalFreeze) {
    document.getElementById('gameover-freeze-close')?.remove();
  } else {
    ensureGameOverFreezeCloseButton();
  }
  renderGameOverFreezeSnapshot(gameOverFrozenSnapshot);
}

function clearLockedFinalWinnerSeatCards() {
  lockedFinalWinnerSeat = null;
  lockedFinalWinnerCards = null;
}

function renderLockedFinalWinnerSeatCards() {
  const source = lockedEndStateSnapshot || gameOverFrozenSnapshot || currentGameState;
  if (isFinalGameOverState(source)) return false;
  if (lateJoinFinishedState) return false;
  if (!Number.isInteger(lockedFinalWinnerSeat) || !lockedFinalWinnerCards) return false;
  const { carda, cardb } = lockedFinalWinnerCards;
  if (!carda || !cardb) return false;

  gui_set_player_cards(carda, cardb, lockedFinalWinnerSeat, false);
  const seatEl = document.getElementById('seat' + lockedFinalWinnerSeat);
  if (!seatEl) return false;
  seatEl.classList.add('final-winner');
  seatEl.querySelectorAll('.holecards .card').forEach(card => card.classList.add('visible'));
  return true;
}

function resolveFinalWinnerSeatForView(source) {
  if (Number.isInteger(lockedFinalWinnerSeat) && lockedFinalWinnerSeat >= 0) {
    return lockedFinalWinnerSeat;
  }
  if (!source || !Array.isArray(source.players)) return null;
  let winnerSeat = source.players.findIndex((p) => p && p.status === 'WINNER');
  if (winnerSeat < 0 && source.winReason?.winnerId) {
    winnerSeat = source.players.findIndex((p) => p && p.id === source.winReason.winnerId);
  }
  if (winnerSeat < 0) {
    winnerSeat = source.players.findIndex((p) => p && !p.inactive && p.status !== 'BUST' && p.status !== 'WAIT');
  }
  return winnerSeat >= 0 ? winnerSeat : null;
}

function enforceWinnerOnlyCardsInFinalView(snapshot = null) {
  if (!restoreFinalWinnerOnlyView) return;
  const source = snapshot || lockedEndStateSnapshot || currentGameState;
  if (!source || !Array.isArray(source.players)) return;
  if (isFinalGameOverState(source)) return;

  const winnerSeat = resolveFinalWinnerSeatForView(source);
  if (!Number.isInteger(winnerSeat)) return;

  source.players.forEach((_, idx) => {
    if (idx === mySeatIndex) return;
    if (idx === winnerSeat) return;
    gui_set_player_cards('', '', idx, false);
    const seatEl = document.getElementById('seat' + idx);
    seatEl?.querySelectorAll('.holecards .card').forEach((card) => {
      card.classList.remove('revealed');
      card.classList.add('visible');
    });
  });
}

function lockFinalWinnerSeatFromState(gameState) {
  if (!gameState || !Array.isArray(gameState.players)) return false;

  const survivors = gameState.players.filter(p => p && p.status !== 'BUST' && !p.inactive);
  if (survivors.length !== 1) return false;

  let winnerIdx = gameState.players.findIndex(p => p && p.status === 'WINNER');
  if (winnerIdx < 0 && gameState.winReason?.winnerId) {
    winnerIdx = gameState.players.findIndex(p => p && p.id === gameState.winReason.winnerId);
  }
  if (winnerIdx < 0) {
    winnerIdx = gameState.players.findIndex(p => p && p.status !== 'BUST' && !p.inactive);
  }
  if (winnerIdx < 0) return false;

  const winner = gameState.players[winnerIdx];
  if (!winner?.carda || !winner?.cardb) return false;

  lockedFinalWinnerSeat = winnerIdx;
  lockedFinalWinnerCards = { carda: winner.carda, cardb: winner.cardb };
  return renderLockedFinalWinnerSeatCards();
}

function showFinalStatePlaceholder(kind) {
  stopTurnPulse();
  endStateLocked = true;
  if (kind === 'win') {
    document.body.classList.add('final-winner-ui', 'final-end-ui');
    centerMessageMode = 'winner-final';
    showCenterMessage('YOU WIN !!', 'winner-final');
  } else {
    document.body.classList.add('final-end-ui');
    centerMessageMode = 'lose';
    showCenterMessage('GAME OVER', 'lose');
  }
  if (currentGameState) lockFinalWinnerSeatFromState(currentGameState);
  applyFinalSpectatorView();
  resetAllBacks();
  setupBoardBacks();
  renderLockedFinalWinnerSeatCards();
  stopTimerUI();
}

/**
 * DÃƒÂ©marre un intervalle qui, chaque seconde, calcule le temps restant
 * ÃƒÂ  partir de gameState.turnStartTime et gameState.turnDuration.
 */
function startClientTimerFromState(gameState) {
  if (gameState?.demo) { stopTimerUI(); return; }
  clearInterval(timerInterval);

  const circle = document.getElementById('timer-circle');
  const textEl = document.getElementById('timer-text');
  const radius = 36;
  const C      = 2 * Math.PI * radius;
  circle.setAttribute('stroke-dasharray', C);

  function updateClock() {
    const now     = Date.now();
    let remaining = gameState.turnDuration - (now - gameState.turnStartTime);
    if (remaining < 0) remaining = 0;
    if (remaining > gameState.turnDuration) remaining = gameState.turnDuration;
    const leftSec = Math.ceil(remaining / 1000);

    const fraction = (gameState.turnDuration - remaining) / gameState.turnDuration;
    circle.setAttribute('stroke-dashoffset', fraction * C);

    if      (leftSec <= 5)    circle.setAttribute('stroke', 'red');
    else if (leftSec <= 15)   circle.setAttribute('stroke', 'orange');
    else                      circle.setAttribute('stroke', '#00e676');

    textEl.textContent = leftSec > 0 ? leftSec : '0';
    refreshCalcTimerDisplay();

    if (remaining <= 0) {
      clearInterval(timerInterval);
    }
  }

  // Affiche immÃƒÂ©diatement lÃ¢â‚¬â„¢ÃƒÂ©tat du timer
  updateClock();
  timerInterval = setInterval(updateClock, 1000);
}

function stopTimerUI() {
  clearInterval(timerInterval);
  const timerContainer = document.getElementById("timer-container");
  if (timerContainer) timerContainer.style.display = "none";
  setPotLeftMode(false);
}

function freezeTimerUI() {
  clearInterval(timerInterval);
  const timerContainer = document.getElementById("timer-container");
  const circle = document.getElementById("timer-circle");
  const textEl = document.getElementById("timer-text");
  if (timerContainer) timerContainer.style.display = "block";
  if (circle) {
    const radius = 36;
    const C = 2 * Math.PI * radius;
    circle.setAttribute("stroke-dasharray", C);
    circle.setAttribute("stroke-dashoffset", C);
    circle.setAttribute("stroke", "red");
  }
  if (textEl) textEl.textContent = "0";
  setPotLeftMode(true);
}

/**
 * MÃƒÂªme code que ton updateTable(data) original,
 * mais en utilisant `gs` comme gameState.
 */
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Nouvelle fonction pour relancer le timer depuis un turnStartTime
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Mise ÃƒÂ  jour de resumeTimerFromState pour clampper remainingMs
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function resumeTimerFromState(gs) {
  clearInterval(timerInterval);
  const circle = document.getElementById("timer-circle");
  const textEl = document.getElementById("timer-text");
  const radius = 36;
  const C      = 2 * Math.PI * radius;
  circle.setAttribute("stroke-dasharray", C);

  function updateClock() {
    const now     = Date.now();
    let remMs     = gs.turnDuration - (now - gs.turnStartTime);
    if (remMs < 0) remMs = 0;
    if (remMs > gs.turnDuration) remMs = gs.turnDuration;
    const leftSec = Math.floor(remMs / 1000);

    const fraction = (gs.turnDuration - remMs) / gs.turnDuration;
    circle.setAttribute("stroke-dashoffset", fraction * C);

    if      (leftSec <= 5)    circle.setAttribute("stroke", "red");
    else if (leftSec <= 15)   circle.setAttribute("stroke", "orange");
    else                      circle.setAttribute("stroke", "#00e676");

    textEl.textContent = leftSec;
    refreshCalcTimerDisplay();

    if (remMs <= 0) {
      clearInterval(timerInterval);
    }
  }

  updateClock();
  timerInterval = setInterval(updateClock, 1000);
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Fonction principale mise ÃƒÂ  jour de lÃ¢â‚¬â„¢UI + timer
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function isCalcOpen() {
  const overlay = document.getElementById('modal-box');
  return !!(overlay && overlay.style.display !== 'none' && overlay.querySelector('.raise-window'));
}

function getMyIndexFromState(gs) {
  if (!gs || !Array.isArray(gs.players)) return -1;
  return gs.players.findIndex(p => p && p.id === mySocketId);
}

function handleGameStateUpdate(gs) {
  prewarmBetChipFx();
  if (skipRevealAfterFreezeClose) {
    if (gs?.phase === 'reveal') {
      currentGameState = gs;
      renderNeutralLiveSpectatorView(gs);
      applyBustSpectatorView(gs);
      return;
    }
    skipRevealAfterFreezeClose = false;
  }
  const isHyperMode = String(gameMode || '').toLowerCase() === 'hyper';
  if (isHyperMode && finalStateDeferred && !endStateLocked && gs.phase !== 'reveal') {
    stopTurnPulse();
    stopTimerUI();
    hideRevealButton();
    return;
  }
  if (gs.phase === 'reveal' && lastPhase !== 'reveal') {
    revealPhaseStartedAt = Date.now();
    revealSeatShowStartedAt = null;
  }
  maybeForceFinalStateFromServer(gs);
  maybeResetFinalStateForFreshGame(gs);
  const prevState = currentGameState;
  window.IMDCXMotion?.prepare(prevState, gs);
  const isEnteringPreflopNow = (gs.phase === 'preflop' && prevState?.phase !== 'preflop');
  if (isEnteringPreflopNow && !endStateLocked) {
    const applyNewHandAllBacks = () => {
      resetAllBacks(null, gs);
      setupBoardBacks();
    };
    const tornadoStarted = maybeTriggerHandTornado(prevState, gs, {
      // During swallow/transition we keep slots empty; backs are applied on complete.
      onSwallow: () => {},
      onComplete: () => {
        applyNewHandAllBacks();
        resetBetChipPile();
      }
    });
    if (!tornadoStarted) {
      applyNewHandAllBacks();
      resetBetChipPile();
    }
    const meNow = Number.isInteger(mySeatIndex) ? gs.players?.[mySeatIndex] : null;
    if (meNow?.status === 'BUST' && suppressFinalReplayAfterClose) {
      clearMySeatHoleCardsForSpectator();
    }
  }
  if (isEnteringPreflopNow) {
    document.querySelectorAll('.seat').forEach((seatEl) => {
      seatEl.classList.remove('bet-pulse', 'call-pulse');
    });
  }
  // 1) Mets ÃƒÂ  jour lÃ¢â‚¬â„¢UI avec ton code existant
  updateInterface(gs);
  setupPotBreakdownInteraction();
  if (potBreakdownPanelOpen) renderPotBreakdownPanel();
  maybeResetBetChipPile(prevState, gs);
  if (!prevState || reloadRestorePending) {
    restoreBetChipPileFromState(gs, { force: reloadRestorePending });
  }
  if (window.IMDCXMotion) window.IMDCXMotion.state(prevState, gs);
  else {
    maybeTriggerBetBeam(prevState, gs);
    maybeTriggerFoldDrop(prevState, gs);
    maybeTriggerCheckPass(prevState, gs);
    maybeTriggerCallPulse(prevState, gs);
    maybeTriggerBetPulse(prevState, gs);
    maybeTriggerRiverRevealBoost(prevState, gs);
  }
  document.body.classList.toggle('is-reveal', gs.phase === 'reveal');
  if (gs.phase === 'reveal') {
    document.querySelectorAll('.seat.turn').forEach(seatEl => {
      seatEl.classList.remove('turn');
    });
  }
  const calcWasOpen = isCalcOpen();
  const myIdx = getMyIndexFromState(gs);
  if (calcWasOpen && myIdx >= 0 && myIdx !== gs.current_bettor_index) {
    calcClose();
  }
  const me = myIdx >= 0 ? gs.players[myIdx] : null;

  if (me) {
    const curStatus = me.status || '';
    if (calcWasOpen && (curStatus === 'FOLD' || curStatus === 'CHECK') && curStatus !== lastMyStatus) {
      calcClose();
    }
    lastMyStatus = curStatus;
  }
  if (
    calcWasOpen &&
    prevState &&
    getMyIndexFromState(prevState) >= 0 &&
    prevState.current_bettor_index === getMyIndexFromState(prevState) &&
    prevState.phase &&
    gs.phase &&
    prevState.phase !== gs.phase
  ) {
    calcClose();
  }

  // 1bis) DÃƒÂ©tection "souple" des indexes + montants de blinds
  const sbIdx =
    (typeof gs.smallBlindIndex === 'number')      ? gs.smallBlindIndex      :
    (typeof gs.sbIndex === 'number')             ? gs.sbIndex              :
    (typeof gs.small_blind_index === 'number')   ? gs.small_blind_index    :
    null;

  const bbIdx =
    (typeof gs.bigBlindIndex === 'number')       ? gs.bigBlindIndex        :
    (typeof gs.bbIndex === 'number')             ? gs.bbIndex              :
    (typeof gs.big_blind_index === 'number')     ? gs.big_blind_index      :
    null;

  // --- Reset des anciens badges SB / BB sur tous les siÃƒÂ¨ges ---
  document.querySelectorAll('.seat').forEach(seat => {
    seat.classList.remove('has-sb', 'has-bb');
  });

  // --- Appliquer SB / BB sur les bons siÃƒÂ¨ges, comme le dealer ---
  if (sbIdx != null && sbIdx >= 0) {
    const sbSeat = document.getElementById('seat' + sbIdx);
    if (sbSeat) sbSeat.classList.add('has-sb');
  }

  if (bbIdx != null && bbIdx >= 0) {
    const bbSeat = document.getElementById('seat' + bbIdx);
    if (bbSeat) bbSeat.classList.add('has-bb');
  }
  // DÃƒÂ©cale le bouton dealer si D et SB sont sur le mÃƒÂªme siÃƒÂ¨ge
  if (typeof gs.dealerIndex === 'number') {
    adjustDealerOffset(gs.dealerIndex, sbIdx);
  }

  const sbAmount =
    (gs.smallBlindAmount ?? gs.smallBlind ?? gs.sbAmount ?? gs.small_blind ?? null);

  const bbAmount =
    (gs.bigBlindAmount ?? gs.bigBlind ?? gs.bbAmount ?? gs.big_blind ?? null);

  // 1ter) Injection du stack + SB/BB dans .chips (ne touche pas aux textes de mise)
  if (Array.isArray(gs.players)) {
    gs.players.forEach((p, idx) => {
      const seatEl  = document.getElementById('seat' + idx);
      if (!seatEl || !p) return;

      const chipsEl = seatEl.querySelector('.chips');
      if (!chipsEl) return;

      // Joueur BUST Ã¢â€ â€™ juste 0
      if (p.status === 'BUST') {
        chipsEl.textContent = '0';
        return;
      }

      const lines = [];

      // 1) Bankroll (ligne du haut)
      const stack = (p.bankroll || 0);
      if (p.status === 'ALLIN') {
        lines.push('ALL-IN');
      } else {
        lines.push(stack.toLocaleString('fr-FR'));
      }

      // 2) SB / BB ne sont plus affichÃƒÂ©es dans .chips

      chipsEl.innerHTML = lines.join('<br>');
    });
  }

  // Nouvelle game (entree en preflop): on redemandera la confirmation credits classiques.
  if (gs.phase === "preflop" && lastPhase && lastPhase !== "preflop") {
    add30NoTimeWarned = false;
    add30ClassicConfirmed = false;
    refreshCreditsDisplay();
  }

  // 2) Reset cartes quand on repasse de reveal Ã¢â€ â€™ preflop
  if (lastPhase === "reveal" && gs.phase === "preflop") {
    if (!suppressFinalReplayAfterClose) {
      const survivors = (gs.players || []).filter(p => p && p.status !== 'BUST' && !p.inactive);
      if (!endStateLocked && survivors.length === 1) {
        const winner = survivors[0];
        if (winner?.id === mySocketId) showVictory("YOU");
        else showLosing(true);
      }
    }

    if (!endStateLocked) {
      clearLockedFinalWinnerSeatCards();
      resetAllBacks();
      myCardsRevealed = false;
      const meNow = Number.isInteger(mySeatIndex) ? gs.players?.[mySeatIndex] : null;
      if (!meNow || meNow.status !== 'BUST') animateMyCards();
      else resetMySeatBacks();
      setupBoardBacks();
      lastActiveIdx = null;
      lastTurnStartTime = null;
      lastTurnDuration = null;
      revealShownSeats = new Set();
      revealDisplayedCards = {};
      hideRevealButton();
      document.querySelectorAll('.seat').forEach(seatEl => {
        seatEl.classList.remove('winning-hand','losing-hand');
      });
    }

    // Ã¢Å¾â€¢ Nouveau coup Ã¢â€ â€™ plus de TIME
    window.currentFrozenSeat = null;
    clearStoredFrozenSeat();
    refreshTimeButtonVisibility();
    refreshAdd30ButtonVisibility();
    add30NoTimeWarned = false;
    add30ClassicConfirmed = false;
    refreshCreditsDisplay();
  }
  lastPhase = gs.phase;

  // 3) Gestion du timer pour tout le monde
  const actionPhases   = ["preflop","flop","turn","river"];
  const timerContainer = document.getElementById("timer-container");

  if (endStateLocked) {
    stopTimerUI();
  } else if (isHyperMode) {
    stopTimerUI();
    lastActiveIdx = gs.current_bettor_index;
  } else if (gs.adminPaused) {
    clearInterval(timerInterval);
    if (timerContainer) timerContainer.style.display = "none";
    setPotLeftMode(false);
  } else if (actionPhases.includes(gs.phase)) {
    if (gs.timeFrozen) {
      freezeTimerUI();
      setPotLeftMode(true);
      return;
    }
    const activeIdx = gs.current_bettor_index;

    if (typeof lastActiveIdx === 'number' && activeIdx !== lastActiveIdx) {
      calcClose();
    }

    // On ne relance le timer QUE si le turnStartTime envoyÃƒÂ© par le serveur a changÃƒÂ©
    if (gs.turnStartTime !== lastTurnStartTime || gs.turnDuration !== lastTurnDuration) {
      startClientTimerFromState(gs);  // relance du timer
      lastTurnStartTime = gs.turnStartTime;
      lastTurnDuration = gs.turnDuration;
    }

    lastActiveIdx = activeIdx;
    timerContainer.style.display = "block";
    setPotLeftMode(true);
  } else {
    // pendant reveal ou autre, on stoppe et masque
    clearInterval(timerInterval);
    timerContainer.style.display = "none";
    setPotLeftMode(false);
  }

    // 3bis) Si on avait un freeze TIME sur un joueur qui n'est plus le joueur actif,
  // on considÃƒÂ¨re que le TIME est terminÃƒÂ© et on masque le bouton.
  if (window.currentFrozenSeat != null) {
    const activeIdx = gs.current_bettor_index;

    // Si le tour est passÃƒÂ© ÃƒÂ  un autre joueur que celui qui ÃƒÂ©tait gelÃƒÂ©
    if (typeof activeIdx === 'number' && activeIdx !== window.currentFrozenSeat) {
      window.currentFrozenSeat = null;
      clearStoredFrozenSeat();      // on nettoie aussi le localStorage
      refreshTimeButtonVisibility();
      refreshAdd30ButtonVisibility();
    }
  }

  // 4) Ãƒâ‚¬ chaque update dÃ¢â‚¬â„¢ÃƒÂ©tat (10 joueurs OU duel),
  // on recalcule si le bouton TIME doit ÃƒÂªtre visible
  refreshTimeButtonVisibility();
  refreshAdd30ButtonVisibility();
  refreshCreditsDisplay();
  refreshCalcTimerDisplay();
  refreshCalcMathDisplay();
  refreshAdd30ButtonVisibility();
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// MÃƒÂ©moriser / relire l'ÃƒÂ©tat de fin (win / lose)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function rememberEndState(kind, snapshot = null) {
  try {
    if (!_tableID && !_match2ID) return;
    const seat = (typeof mySeatIndex === 'number') ? mySeatIndex : 'x';

    const key = _match2ID
      ? `endState_match2_${_match2ID}_${seat}`
      : `endState_table_${_tableID}_${seat}`;

    const payload = { kind, ts: Date.now() };
    if (snapshot) payload.snapshot = snapshot;
    localStorage.setItem(key, JSON.stringify(payload));
    if (kind === 'win' || kind === 'lose') {
      pushCalcStatsRecentResult(kind, snapshot);
    }
  } catch (e) {
    console.warn('Impossible de mÃƒÂ©moriser lÃ¢â‚¬â„¢ÃƒÂ©tat de fin', e);
  }
}

function getStoredEndState(tableID, match2ID, seat) {
  try {
    const key = match2ID
      ? `endState_match2_${match2ID}_${seat}`
      : `endState_table_${tableID}_${seat}`;

    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Erreur lecture ÃƒÂ©tat de fin', e);
    return null;
  }
}

function clearStoredEndState(tableID, match2ID, seat) {
  try {
    const key = match2ID
      ? `endState_match2_${match2ID}_${seat}`
      : `endState_table_${tableID}_${seat}`;
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('Erreur suppression ÃƒÂ©tat de fin', e);
  }
}

function makeLiveSpectatorReloadKey(tableID, match2ID, seat) {
  if (!Number.isInteger(seat)) return null;
  if (match2ID) return `liveSpectator_match2_${match2ID}_${seat}`;
  if (tableID) return `liveSpectator_table_${tableID}_${seat}`;
  return null;
}

function getLiveSpectatorReloadFlag(tableID, match2ID, seat) {
  try {
    const key = makeLiveSpectatorReloadKey(tableID, match2ID, seat);
    if (!key) return false;
    return sessionStorage.getItem(key) === '1';
  } catch (e) {
    return false;
  }
}

function setLiveSpectatorReloadFlag(tableID, match2ID, seat, enabled) {
  try {
    const key = makeLiveSpectatorReloadKey(tableID, match2ID, seat);
    if (!key) return;
    if (enabled) sessionStorage.setItem(key, '1');
    else sessionStorage.removeItem(key);
  } catch (e) {}
}

function resetFinalUiState() {
  endStateLocked = false;
  endStatePending = null;
  lateJoinFinishedState = false;
  winnerAnnounced = false;
  loserAnnounced = false;
  restoreFinalWinnerOnlyView = false;
  lockRestoredFinalView = false;
  suppressFinalReplayAfterClose = false;
  gameOverFreezeActive = false;
  gameOverFrozenSnapshot = null;
  lockedEndStateSnapshot = null;
  pendingLiveSpectatorState = null;
  centerMessageMode = null;
  lastWinnerMessage = '';
  document.body.classList.remove('final-end-ui', 'final-winner-ui');
  document.getElementById('gameover-freeze-close')?.remove();
  clearScheduledFinalSeatCardLock();
  clearScheduledMyFreezeCardLock();
  clearFinalSeatCardLockStyles();
  document.querySelectorAll('.seat').forEach((seatEl) => {
    seatEl.classList.remove('final-winner', 'final-spectator', 'winning-hand', 'losing-hand');
  });
  clearLockedFinalWinnerSeatCards();
  showCenterMessage('', null);
  if (deferredFinalStateTimer) {
    clearTimeout(deferredFinalStateTimer);
    deferredFinalStateTimer = null;
  }
  finalStateDeferred = false;
  deferredFinalStateSnapshot = null;
  revealPhaseStartedAt = null;
  revealSeatShowStartedAt = null;
  hyperRevealHoldUntil = 0;
  hyperRevealHoldCards = null;
  revealDisplayedCards = {};
  lastCompletedRevealSnapshot = null;
}

function deferFinalStateIfNeeded(runFinal) {
  const isHyper = String(gameMode || '').toLowerCase() === 'hyper';
  if (!isHyper || endStateLocked || typeof runFinal !== 'function') {
    runFinal?.();
    return;
  }

  const minSeatShowMs = 9000;
  const startedAt = Number.isFinite(revealSeatShowStartedAt)
    ? revealSeatShowStartedAt
    : (Number.isFinite(revealPhaseStartedAt) ? revealPhaseStartedAt : null);
  if (!startedAt) {
    runFinal();
    return;
  }

  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(0, minSeatShowMs - elapsed);
  if (remaining <= 0) {
    finalStateDeferred = false;
    deferredFinalStateSnapshot = null;
    runFinal();
    return;
  }

  const snapshotSource = currentGameState;
  if (snapshotSource) {
    try {
      deferredFinalStateSnapshot = JSON.parse(JSON.stringify(snapshotSource));
    } catch (e) {
      deferredFinalStateSnapshot = snapshotSource;
    }
  }
  finalStateDeferred = true;
  if (deferredFinalStateTimer) clearTimeout(deferredFinalStateTimer);
  deferredFinalStateTimer = setTimeout(() => {
    deferredFinalStateTimer = null;
    finalStateDeferred = false;
    if (deferredFinalStateSnapshot) {
      currentGameState = deferredFinalStateSnapshot;
    }
    deferredFinalStateSnapshot = null;
    if (!endStateLocked) runFinal();
  }, remaining);
}

function maybeResetFinalStateForFreshGame(gs) {
  if (lockRestoredFinalView && endStateLocked) return;
  if (!gs || !Array.isArray(gs.players)) return;
  const me = Number.isInteger(mySeatIndex) ? gs.players?.[mySeatIndex] : null;
  const isBustSpectator = !!me && me.status === 'BUST';
  if (isBustSpectator && suppressFinalReplayAfterClose) {
    setLiveSpectatorReloadFlag(_tableID, _match2ID, mySeatIndex, true);
  } else {
    setLiveSpectatorReloadFlag(_tableID, _match2ID, mySeatIndex, false);
  }
  const alive = gs.players.filter(p =>
    p && !p.inactive && p.status !== 'BUST' && p.status !== 'WAIT'
  );
  const looksLikeFreshGame = (gs.phase === 'preflop' && alive.length >= 2);
  // Keep suppression active while I remain busted spectator (after closing freeze manually).
  if (looksLikeFreshGame && !isBustSpectator) suppressFinalReplayAfterClose = false;
  const hasFinalLock = endStateLocked || endStatePending || winnerAnnounced || loserAnnounced;
  if (!looksLikeFreshGame || !hasFinalLock) return;
  if (isBustSpectator && suppressFinalReplayAfterClose) return;
  resetFinalUiState();
  clearStoredEndState(_tableID, _match2ID, mySeatIndex);
}

function maybeForceFinalStateFromServer(gs) {
  if (gs?.demo) return;
  if (suppressFinalReplayAfterClose) return;
  if (endStateLocked) return;
  if (!gs || !Array.isArray(gs.players)) return;

  const survivors = gs.players.filter(p =>
    p && !p.inactive && p.status !== 'BUST' && p.status !== 'WAIT'
  );
  const isServerFinished = gs.gameFinished === true;
  const isRevealFinal = gs.phase === 'reveal' && gs.revealSeqDone && survivors.length === 1;
  const hasWinnerMarker = Boolean(
    gs.winReason?.winnerId ||
    gs.players.some((p) => p && p.status === 'WINNER')
  );
  const isWinnerMarkedFinal = hasWinnerMarker && survivors.length <= 1;
  if (!isServerFinished && !isRevealFinal && !isWinnerMarkedFinal) return;

  const winnerByStatus = gs.players.find(p => p && p.status === 'WINNER');
  const winnerId = gs.winReason?.winnerId || winnerByStatus?.id || (survivors[0]?.id || null);
  const meBySeat = Number.isInteger(mySeatIndex) ? gs.players[mySeatIndex] : null;

  let isWinner = false;
  if (winnerId && meBySeat?.id) {
    isWinner = winnerId === meBySeat.id;
  } else if (winnerId && mySocketId) {
    isWinner = winnerId === mySocketId;
  } else if (survivors.length === 1 && meBySeat) {
    isWinner = survivors[0] === meBySeat || (!!survivors[0]?.id && survivors[0].id === meBySeat.id);
  }

  const hadHistory = Boolean(currentGameState || lastPhase);
  lateJoinFinishedState = !hadHistory;
  setLockedEndStateSnapshot(gs);
  deferFinalStateIfNeeded(() => {
    if (isWinner) showVictory("YOU");
    else showLosing(true);
  });
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// MÃƒÂ©mo du siÃƒÂ¨ge "gelÃƒÂ©" (TIME) par table/match2
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function makeTimeFreezeKey() {
  if (_match2ID) return `timeFreeze_match2_${_match2ID}`;
  if (_tableID)  return `timeFreeze_table_${_tableID}`;
  return null;
}

function storeFrozenSeat(seatIndex) {
  const key = makeTimeFreezeKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      seatIndex,
      ts: Date.now()
    }));
  } catch (e) {
    console.warn('storeFrozenSeat failed', e);
  }
}

function clearStoredFrozenSeat() {
  const key = makeTimeFreezeKey();
  if (!key) return;
  try {
    localStorage.removeItem(key);
  } catch (e) {
    console.warn('clearStoredFrozenSeat failed', e);
  }
}

function loadStoredFrozenSeat() {
  const key = makeTimeFreezeKey();
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (typeof data.seatIndex === 'number') {
      return data.seatIndex;
    }
    return null;
  } catch (e) {
    console.warn('loadStoredFrozenSeat failed', e);
    return null;
  }
}

function getOrCreateJoinClientKey() {
  const storageKey = 'poker_join_client_key';
  try {
    let key = localStorage.getItem(storageKey);
    if (!key) {
      key = `cj_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
      localStorage.setItem(storageKey, key);
    }
    return key;
  } catch (err) {
    return null;
  }
}

/** Écran d'accueil : pseudo + bouton "Jouer" (matchmaking auto, sans lien) */
// ── Championnat : overlays partagés (écran d'accueil ET partie réelle) ──
let championshipOverlayEl = null;
function ensureChampionshipOverlay() {
  if (championshipOverlayEl && document.body.contains(championshipOverlayEl)) return championshipOverlayEl;
  const el = document.createElement('div');
  el.className = 'battle-overlay';
  el.innerHTML = `
    <div class="battle-card-panel">
      <h2 id="champ-title">Championnat</h2>
      <div class="battle-status" id="champ-status"></div>
      <div id="champ-extra"></div>
    </div>
  `;
  document.body.appendChild(el);
  championshipOverlayEl = el;
  return el;
}

let battleViewEl = null;
let battleResolved = false;
let battleIsPractice = false;
let practiceBattleRequested = false;

function sceneHeaderHtml() {
  return `<header class="scene-header"><div class="scene-brand">${homeIcon('spade')}<span class="scene-brand-wordmark"><strong>IMDCX</strong><small>POKER</small></span><span class="scene-brand-caption">Plus qu’un jeu<br>Une communauté</span></div><button type="button" class="scene-exit" data-scene-action="back">← <span>Retour</span></button></header>`;
}

function sceneEnvironmentHtml(cards = false) {
  return `<div class="scene-environment" aria-hidden="true" inert><img class="scene-chip chip-left" src="static/images/phase1-poker-chip.webp" alt="" draggable="false"><img class="scene-chip chip-right" src="static/images/phase1-poker-chip.webp" alt="" draggable="false">${cards ? '<div class="scene-ornament-card card-left">♠</div><div class="scene-ornament-card card-right">♠</div>' : ''}</div>`;
}

function battleMetricsHtml(profile, side) {
  const number = value => Number.isFinite(Number(value)) ? Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : '—';
  const values = [profile?.points != null ? number(profile.points) : '—', profile?.rank ? `#${number(profile.rank)}` : '—', profile?.gamesPlayed ? `${number(profile.winRate)} %` : '—'];
  return ['Points', 'Rang', 'Victoires'].map((label, index) => `<div class="battle-metric">${homeIcon(['trophy', 'chart', 'target'][index])}<strong data-battle-stat="${side}-${index}">${values[index]}</strong><span>${label}</span></div>`).join('');
}

function setBattleRound(view, round) {
  view.querySelector('.battle-rounds').setAttribute('aria-label', `Manche ${round}`);
  view.querySelectorAll('.battle-rounds span').forEach((dot, i) => {
    dot.classList.toggle('is-active', i === Math.min(round - 1, 4));
    dot.classList.toggle('is-complete', i < round - 1);
  });
}

function battleCardBackHtml() {
  return `
    <div class="battle-card-flip">
      <div class="battle-card-flip-inner">
        <div class="battle-card-face battle-card-face-back"><span class="battle-card-face-glyph">${homeIcon('spade')}</span></div>
        <div class="battle-card-face battle-card-face-front"><img class="battle-card-photo-img" src="" alt="" draggable="false" /></div>
      </div>
    </div>
  `;
}

function revealBattleCard(slotEl, cardStr) {
  if (!slotEl) return;
  const flipEl = slotEl.querySelector('.battle-card-flip');
  const img = slotEl.querySelector('.battle-card-photo-img');
  if (!flipEl || !img || !cardStr) return;
  const suit = cardStr[0];
  const rank = parseInt(cardStr.slice(1), 10);
  const rankWord = { 11: 'jack', 12: 'queen', 13: 'king', 14: 'ace' }[rank] || String(rank);
  const suitWord = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' }[suit] || 'spades';
  img.src = `static/images/${rankWord}_of_${suitWord}.png`;
  flipEl.classList.remove('is-flipped');
  void flipEl.offsetWidth;
  requestAnimationFrame(() => flipEl.classList.add('is-flipped'));
}

function resetBattleSlot(slotEl) {
  if (slotEl) slotEl.innerHTML = battleCardBackHtml();
}

function ensureBattleView() {
  if (battleViewEl && window.IMDCXScenes.isActive(battleViewEl)) return battleViewEl;
  const el = document.createElement('section');
  el.className = 'imdcx-scene imdcx-battle';
  el.dataset.state = 'waiting';
  el.setAttribute('aria-labelledby', 'battle-title');
  el.innerHTML = `
    ${sceneEnvironmentHtml()}${sceneHeaderHtml()}
    <div class="scene-content">
      <div class="battle-heading"><div class="scene-kicker">Championnat · Saison 1</div><h1 id="battle-title">Bataille</h1>
        <div class="battle-score" id="battle-score" aria-label="Score"><span>Vous</span><strong id="battle-score-mine">0</strong><span aria-hidden="true">—</span><strong id="battle-score-theirs">0</strong><span id="battle-score-opponent">Adversaire</span></div>
      </div>
      <div class="battle-versus">
        <article class="battle-side battle-player">
          <div class="battle-avatar" id="battle-avatar-mine" aria-hidden="true">${homeIcon('spade')}</div>
          <h2 class="battle-name">Vous</h2><p class="battle-subtitle">Joueur IMDCX</p>
          <div class="battle-slot" id="battle-slot-mine">${battleCardBackHtml()}</div>
          <div class="battle-metrics">${battleMetricsHtml(latestProgressionDashboard?.profile || lastHomeProfile, 'mine')}</div>
          <p class="battle-quote">« Stratégie · Passion · Progression »</p>
        </article>
        <div class="battle-vs" aria-hidden="true"><strong>VS</strong><span class="battle-vs-brand">IMDCX</span><small>POKER<br>Play. Belong. Progress.</small></div>
        <article class="battle-side battle-opponent">
          <div class="battle-avatar battle-avatar-opp" id="battle-avatar-theirs" aria-hidden="true">${homeIcon('person')}</div>
          <h2 class="battle-name" id="battle-opponent-name">Adversaire</h2><p class="battle-subtitle" id="battle-opponent-subtitle">Face-à-face IMDCX</p>
          <div class="battle-slot" id="battle-slot-theirs">${battleCardBackHtml()}</div>
          <div class="battle-metrics">${battleMetricsHtml(null, 'theirs')}</div>
          <p class="battle-quote">« Calcul · Adaptation · Toujours plus loin »</p>
        </article>
      </div>
      <div class="battle-controls">
        <div class="battle-status" id="battle-status" role="status">Recherche d’un adversaire…</div>
        <div class="battle-rounds" aria-label="Manche 1">${Array.from({ length: 5 }, (_, i) => `<span class="${i === 0 ? 'is-active' : ''}" aria-hidden="true"></span>`).join('')}</div>
        <button type="button" class="battle-play-btn scene-action" id="battle-play-btn" hidden><span>Jouer ma carte</span>${homeIcon('arrow')}<span class="btn-spade-badge">${homeIcon('spade')}</span></button>
      </div>
    </div>
    <footer class="scene-footer"><p>Des joueurs aujourd’hui<br>Des légendes demain</p><p>♠ IMDCX POKER<br>Play. Belong. Progress.</p></footer>
  `;
  el.querySelector('#battle-play-btn').addEventListener('click', playBattleRound);
  el.querySelector('.scene-exit').addEventListener('click', () => window.IMDCXScenes.leave(el));
  window.IMDCXVisuals?.battle(el);
  window.IMDCXScenes.enter('battle', el, { onLeave: () => { if (battleViewEl === el) battleViewEl = null; practiceBattleRequested = false; } });
  battleViewEl = el;
  return el;
}

function updateBattleScore(scoreMine, scoreTheirs, opponentLabel) {
  const view = ensureBattleView();
  view.querySelector('#battle-score-mine').textContent = Number(scoreMine) || 0;
  view.querySelector('#battle-score-theirs').textContent = Number(scoreTheirs) || 0;
  view.querySelector('#battle-score-opponent').textContent = opponentLabel || 'Bot';
}

function showBattleWaitingView() {
  if (battleResolved) return;
  battleIsPractice = false;
  ensureBattleView();
}

function playBattleRound() {
  const overlay = battleViewEl;
  if (!overlay || !window.IMDCXScenes.isActive(overlay)) return;
  const btn = overlay.querySelector('#battle-play-btn');
  if (!btn || btn.disabled || btn.hidden) return;
  if (overlay.dataset.state === 'result') { window.IMDCXScenes.leave(overlay); return; }
  if (btn) { btn.disabled = true; btn.hidden = true; }
  overlay.dataset.state = 'waiting';
  const statusEl = overlay.querySelector('#battle-status');
  if (statusEl) statusEl.textContent = 'Vous jouez votre carte…';
  socket.emit('playBattleRound', battleIsPractice
    ? { practice: true }
    : { table: _tableID, seat: mySeatIndex });
}

// ── Roue à multiplicateur (résultats compétitifs x1/x2/x5/x10) ──
const WHEEL_SEGMENTS = [
  { value: 1,  angle: 180 },
  { value: 2,  angle: 270 },
  { value: 5,  angle: 90 },
  { value: 10, angle: 0 }
];
let wheelViewEl = null;
let wheelViewReward = null;
let wheelPreview = false;
function ensureWheelView(preview = false) {
  if (wheelViewEl && window.IMDCXScenes.isActive(wheelViewEl) && wheelPreview === preview) return wheelViewEl;
  wheelPreview = preview;
  const labels = WHEEL_SEGMENTS.map(seg =>
    `<div class="wheel-seg-label" data-angle="${seg.angle}" style="transform: rotate(${seg.angle}deg) translate(0,-65px) rotate(-${seg.angle}deg);">x${seg.value}</div>`
  ).join('');
  const el = document.createElement('section');
  el.className = 'imdcx-scene imdcx-wheel';
  el.dataset.state = 'ready';
  el.setAttribute('aria-labelledby', 'wheel-title');
  el.innerHTML = `
    ${sceneEnvironmentHtml(true)}${sceneHeaderHtml()}
    <div class="scene-content">
      <div class="wheel-heading"><div class="scene-kicker">Championnat · Saison 1</div><h1 id="wheel-title">Roue du multiplicateur</h1></div>
      <div class="wheel-stage">
      <div class="wheel-wrap">
        <div class="wheel-glow"></div>
        <div class="wheel-pointer"></div>
        <div class="wheel-bezel"></div>
        <div class="wheel-disc" id="wheel-disc">
          <div class="wheel-divider-ring"></div>
          ${labels}
        </div>
        <div class="wheel-center">${homeIcon('spade')}</div>
      </div>
      <div class="wheel-pedestal" aria-hidden="true"></div></div>
      <div class="wheel-result"><span>Multiplicateur sélectionné</span><strong class="wheel-result-value" id="wheel-result-value">—</strong></div>
      <div class="wheel-status" id="wheel-status" role="status">${preview ? 'Entraînement · aucun multiplicateur appliqué.' : 'Votre roue est prête.'}</div>
      <div class="wheel-choice" id="wheel-choice" hidden><p>Choisissez le multiplicateur de vos prochaines récompenses.</p><div class="wheel-choice-actions"><button type="button" data-wheel-choice="keep"></button><button type="button" data-wheel-choice="replace"></button></div></div>
      <button type="button" id="wheel-action-btn" class="scene-action"><span>Faire tourner</span><span class="btn-spade-badge">${homeIcon('spade')}</span></button>
    </div>
    <footer class="scene-footer"><p>IMDCX POKER<br>Play. Belong. Progress.</p></footer>
  `;
  el.querySelector('.scene-exit').addEventListener('click', () => window.IMDCXScenes.leave(el));
  el.querySelectorAll('[data-wheel-choice]').forEach(button => button.addEventListener('click', () => chooseWheelMultiplier(el, button.dataset.wheelChoice)));
  el.querySelector('#wheel-action-btn').addEventListener('click', event => {
    if (event.detail > 1) return;
    const button = el.querySelector('#wheel-action-btn');
    if (button.disabled || !window.IMDCXScenes.isActive(el)) return;
    if (el.dataset.state === 'result') { finishWheelView(el); return; }
    if (el.dataset.state !== 'ready') return;
    button.disabled = true;
    if (wheelViewReward) animateWheelView(el, wheelViewReward);
    else {
      el.dataset.state = 'waiting';
      el.querySelector('#wheel-status').textContent = 'Préparation du tirage…';
      socket.emit(preview ? 'previewSpinWheel' : 'spinWheel', {});
      window.IMDCXScenes.schedule(el, () => {
        if (el.dataset.state !== 'waiting') return;
        el.dataset.state = 'ready';
        button.disabled = false;
        el.querySelector('#wheel-status').textContent = 'Connexion interrompue. Réessayez.';
      }, 12000);
    }
  });
  window.IMDCXVisuals?.wheel(el, WHEEL_SEGMENTS);
  window.IMDCXScenes.enter('wheel', el, { onLeave: () => { window.IMDCXVisuals?.cancelSpin(el); if (wheelViewEl === el) { wheelViewEl = null; wheelViewReward = null; } } });
  wheelViewEl = el;
  return el;
}

function spinWheelTo(multiplier, preview, reward = {}) {
  if (!preview && championshipOverlayEl) championshipOverlayEl.remove();
  // Preview replies are relevant only while this particular view is waiting.
  if (preview && (!wheelViewEl || !window.IMDCXScenes.isActive(wheelViewEl) || wheelViewEl.dataset.state !== 'waiting' || !wheelPreview)) return;
  const overlay = ensureWheelView(preview);
  wheelPreview = !!preview;
  wheelViewReward = { ...reward, multiplier, preview: !!preview };
  if (preview || overlay.dataset.state === 'waiting') animateWheelView(overlay, wheelViewReward);
}

function finishWheelView(view) {
  window.IMDCXScenes.leave(view, 'continue');
}

function renderWheelChoice(view, reward) {
  if (reward.preview || !reward.choiceRequired || !reward.choiceId) return;
  const pending = latestProgressionDashboard?.pendingMultiplier;
  const current = reward.previousMultiplier || (pending?.choiceId === reward.choiceId ? pending.currentMultiplier : latestProgressionDashboard?.profile?.multiplier) || 1;
  view.querySelector('#wheel-choice').hidden = false;
  view.querySelector('[data-wheel-choice=keep]').textContent = `Conserver x${current}`;
  view.querySelector('[data-wheel-choice=replace]').textContent = `Choisir x${reward.multiplier}`;
  view.querySelector('#wheel-action-btn > span').textContent = 'Décider plus tard';
}

function chooseWheelMultiplier(view, choice) {
  if (!window.IMDCXScenes.isActive(view) || view.dataset.choiceBusy === 'true' || !wheelViewReward?.choiceId) return;
  const reward = wheelViewReward;
  view.dataset.choiceBusy = 'true';
  const controls = view.querySelectorAll('#wheel-choice button, #wheel-action-btn');
  controls.forEach(button => { button.disabled = true; });
  const status = view.querySelector('#wheel-status');
  status.textContent = 'Enregistrement du multiplicateur…';
  let answered = false;
  const showError = message => {
    if (!window.IMDCXScenes.isActive(view)) return;
    view.dataset.choiceBusy = 'false';
    controls.forEach(button => { button.disabled = false; });
    status.textContent = message;
  };
  window.IMDCXScenes.schedule(view, () => { if (!answered) showError('Connexion interrompue. Votre choix reste disponible, réessayez.'); }, 12000);
  socket.emit('progression:chooseMultiplier', { choiceId: reward.choiceId, choice }, response => {
    if (answered) return;
    answered = true;
    if (!response?.ok) { showError(response?.error || 'Impossible d’enregistrer ce choix. Réessayez.'); return; }
    const dashboard = response.data?.dashboard || response.data;
    if (dashboard?.profile) applyProgressionDashboard(dashboard);
    if (!window.IMDCXScenes.isActive(view)) return;
    view.dataset.choiceBusy = 'false';
    wheelViewReward = { ...reward, choiceRequired: false };
    view.querySelector('#wheel-choice').hidden = true;
    controls.forEach(button => { button.disabled = false; });
    view.querySelector('#wheel-action-btn > span').textContent = 'Continuer';
    status.textContent = `Multiplicateur x${dashboard?.profile?.multiplier || 1} actif. Prêt pour vos prochaines récompenses.`;
  });
}

function showPendingWheelChoice(pending) {
  if (!pending?.choiceId) return;
  const view = ensureWheelView(false);
  const multiplier = pending.newMultiplier;
  const segment = WHEEL_SEGMENTS.find(s => s.value === multiplier);
  if (segment) window.IMDCXVisuals?.spin(view, segment, 5 * 360 + (360 - segment.angle), 0);
  view.dataset.state = 'result';
  wheelViewReward = { multiplier, choiceId: pending.choiceId, previousMultiplier: pending.currentMultiplier, choiceRequired: true, preview: false };
  view.querySelector('#wheel-result-value').textContent = `x${multiplier}`;
  view.querySelector('#wheel-status').textContent = 'Vos points sont acquis. Choisissez votre multiplicateur.';
  const action = view.querySelector('#wheel-action-btn');
  action.disabled = false;
  renderWheelChoice(view, wheelViewReward);
}

function animateWheelView(overlay, reward) {
  const { multiplier, preview } = reward;
  if (overlay.dataset.state === 'spinning' || overlay.dataset.state === 'result') return;
  overlay.dataset.state = 'spinning';
  const action = overlay.querySelector('#wheel-action-btn');
  action.disabled = true;
  action.querySelector('span').textContent = 'Tirage en cours';
  const disc = overlay.querySelector('#wheel-disc');
  const labels = overlay.querySelectorAll('.wheel-seg-label');
  const statusEl = overlay.querySelector('#wheel-status');
  const seg = WHEEL_SEGMENTS.find(s => s.value === multiplier) || WHEEL_SEGMENTS[0];
  const finalRotation = 5 * 360 + (360 - seg.angle);
  const transition = 'transform 3.2s cubic-bezier(.12,.67,.16,1)';

  if (window.IMDCXVisuals) {
    window.IMDCXVisuals.spin(overlay, seg, finalRotation, 3200);
  } else {
    disc.style.transition = 'none';
    disc.style.transform = 'rotate(0deg)';
    labels.forEach(el => { el.style.transition = 'none'; });
    void disc.offsetWidth;

    disc.style.transition = transition;
    disc.style.transform = `rotate(${finalRotation}deg)`;
    labels.forEach(el => {
      const a = parseFloat(el.dataset.angle);
      el.style.transition = transition;
      // Le 1er rotate() place le label (suit la rotation du disque, parent), le dernier
      // compense l'orientation pour que le texte reste lisible une fois le disque arrêté.
      el.style.transform = `rotate(${a}deg) translate(0,-65px) rotate(${-a - finalRotation}deg)`;
    });
  }

  const presentResult = () => {
    if (!window.IMDCXScenes.isActive(overlay)) return;
    overlay.dataset.state = 'result';
    overlay.querySelector('#wheel-result-value').textContent = `x${multiplier}`;
    statusEl.textContent = preview ? 'Ceci est un aperçu, aucun multiplicateur appliqué.' : reward.choiceRequired ? 'Conservez votre multiplicateur actuel ou choisissez ce nouveau bonus.' : 'Votre multiplicateur pour les prochaines récompenses compétitives.';
    action.disabled = false;
    action.querySelector('span').textContent = 'Continuer';
    renderWheelChoice(overlay, reward);
  };
  const queueResult = () => window.IMDCXScenes.schedule(overlay, presentResult, 0);
  if (overlay.classList.contains('is-settled')) queueResult();
  else overlay.addEventListener('imdcx:spin-settled', queueResult, { once: true });
  if (!window.IMDCXVisuals) window.IMDCXScenes.schedule(overlay, presentResult, 3300);
}

// Enregistre les handlers championnat sur le socket courant — appelé depuis l'écran
// d'accueil (pseudo/aperçu) ET depuis initGame() une fois en partie, sur le même socket global.
let championshipHandlersRegistered = false;
function registerChampionshipHandlers() {
  if (championshipHandlersRegistered) return;
  championshipHandlersRegistered = true;
  window.IMDCXProgression?.bind(socket, () => currentProgressionName());
  socket.on('connect', () => identifyProgression(currentProgressionName()));
  if (socket.connected) identifyProgression(currentProgressionName());
  socket.on('progression:updated', ({ dashboard, receipt } = {}) => {
    if (dashboard) applyProgressionDashboard(dashboard);
    if (receipt?.kind === 'table' || receipt?.kind === 'duel') latestCompetitiveReceipts[receipt.kind] = receipt;
  });
  socket.on('finalsWaiting', () => {
    const overlay = ensureChampionshipOverlay();
    overlay.querySelector('#champ-status').textContent = 'En attente d’un adversaire pour le face-à-face…';
  });
  socket.on('finalsMatchAssigned', ({ matchID, seat }) => {
    window.location.href = `${window.location.pathname}?match2=${encodeURIComponent(matchID)}&seat=${seat}`;
  });

  socket.on('homeProfile', (data) => {
    lastHomeProfile = data;
    renderHomeStatsStrip(latestProgressionDashboard?.profile || data);
    const modal = document.getElementById('stats-modal-body');
    if (modal) renderStatsModal(data);
  });

  socket.on('battleStart', payload => {
    if (payload.practice && !practiceBattleRequested) return;
    battleResolved = false;
    battleIsPractice = Boolean(payload.practice);
    const overlay = ensureBattleView();
    overlay.dataset.state = 'ready';
    overlay.querySelector('#battle-opponent-name').textContent = payload.opponentLabel || 'Bot';
    const oppAvatar = overlay.querySelector('#battle-avatar-theirs');
    if (oppAvatar) {
      if (payload.practice || /^bot$/i.test(payload.opponentLabel || 'Bot')) {
        oppAvatar.innerHTML = '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M32 8v9M28 8a4 4 0 1 0 8 0a4 4 0 1 0-8 0"/><rect x="12" y="18" width="40" height="33" rx="12"/><path d="M7 28v13m50-13v13M22 43h20M22 55h20"/><circle cx="23" cy="32" r="3" fill="currentColor"/><circle cx="41" cy="32" r="3" fill="currentColor"/></svg>';
      } else oppAvatar.textContent = (payload.opponentLabel || '?').trim().charAt(0).toUpperCase() || '?';
    }
    overlay.querySelector('#battle-opponent-subtitle').textContent = payload.practice ? 'Entraînement · Sans impact' : 'Joueur IMDCX';
    setBattleRound(overlay, payload.round || 1);
    overlay.querySelector('#battle-status').textContent = `Manche ${payload.round || 1} — à vous de jouer !`;
    resetBattleSlot(overlay.querySelector('#battle-slot-mine'));
    resetBattleSlot(overlay.querySelector('#battle-slot-theirs'));
    updateBattleScore(payload.scoreMine || 0, payload.scoreTheirs || 0, payload.opponentLabel);
    const btn = overlay.querySelector('#battle-play-btn');
    if (btn) { btn.hidden = false; btn.disabled = false; }
  });

  socket.on('battleRoundWaiting', () => {
    const overlay = battleViewEl;
    if (!overlay || !window.IMDCXScenes.isActive(overlay)) return;
    overlay.dataset.state = 'waiting';
    const statusEl = overlay.querySelector('#battle-status');
    if (statusEl) statusEl.textContent = "En attente de l'adversaire…";
  });

  socket.on('battleAlreadyDone', () => {
    const overlay = battleViewEl;
    if (!overlay || !window.IMDCXScenes.isActive(overlay)) return;
    overlay.querySelector('#battle-status').textContent = 'Bataille déjà jouée — en attente des autres joueurs…';
    const btn = overlay.querySelector('#battle-play-btn');
    if (btn) btn.hidden = true;
    battleResolved = true;
  });

  socket.on('battleRoundResult', payload => {
    const overlay = battleViewEl;
    if (!overlay || !window.IMDCXScenes.isActive(overlay) || battleResolved) return;
    overlay.dataset.state = 'revealing';
    const slotMine = overlay.querySelector('#battle-slot-mine');
    const slotTheirs = overlay.querySelector('#battle-slot-theirs');
    const statusEl = overlay.querySelector('#battle-status');
    const btn = overlay.querySelector('#battle-play-btn');
    if (btn) { btn.disabled = true; btn.hidden = true; }

    revealBattleCard(slotMine, payload.myCard);
    revealBattleCard(slotTheirs, payload.theirCard);
    updateBattleScore(payload.scoreMine, payload.scoreTheirs, payload.opponentLabel);

    if (payload.roundWinner === 'tie') {
      statusEl.textContent = 'Égalité — on rejoue cette manche !';
    } else {
      statusEl.textContent = payload.roundWinner === 'me' ? 'Vous remportez la manche !' : `${payload.opponentLabel || 'Bot'} remporte la manche.`;
    }

    if (payload.matchOver) {
      battleResolved = true;
      window.IMDCXScenes.schedule(overlay, () => {
        overlay.dataset.state = 'result';
        const outcomeLabel = payload.outcome === 'win' ? 'Victoire !' : 'Défaite';
        statusEl.innerHTML = `<div class="battle-outcome ${payload.outcome}">${outcomeLabel}</div>` +
          (battleIsPractice ? '<div class="battle-points">Entraînement · sans impact</div>' : `<div class="battle-points">+${Number(payload.pointsEarned) || 0} pts</div>`);
        if (btn) { btn.querySelector('span').textContent = 'Continuer'; btn.disabled = false; btn.hidden = false; }
      }, 1100);
      return;
    }

    window.IMDCXScenes.schedule(overlay, () => {
      resetBattleSlot(slotMine);
      resetBattleSlot(slotTheirs);
      overlay.dataset.state = 'ready';
      setBattleRound(overlay, payload.round || 1);
      statusEl.textContent = `Manche ${payload.round} — à vous de jouer !`;
      if (btn) { btn.hidden = false; btn.disabled = false; }
    }, 1300);
  });

  socket.on('wheelResult', (reward = {}) => {
    const { multiplier, preview, alreadySpun } = reward;
    if (!multiplier) return;
    if (alreadySpun) {
      championshipOverlayEl?.remove();
      if (reward.choiceRequired) showPendingWheelChoice({ choiceId: reward.choiceId, currentMultiplier: reward.previousMultiplier, newMultiplier: multiplier });
      else if (wheelViewEl) window.IMDCXScenes.leave(wheelViewEl, 'already-spun');
      return;
    }
    spinWheelTo(multiplier, preview, reward);
  });

  socket.on('championshipUpdated', (list) => {
    if (!Array.isArray(list)) return;
    const podiumEl = document.getElementById('home-leaderboard-podium');
    const listEl = document.getElementById('home-leaderboard-list');
    if (!listEl) return;
    let myName = '';
    try { myName = localStorage.getItem('playername') || ''; } catch (e) {}

    const top3 = list.slice(0, 3);
    const rest = list.slice(3, 10);

    if (podiumEl) {
      if (top3.length) {
        const podiumOrder = [
          { row: top3[1], place: 2, cls: 'silver' },
          { row: top3[0], place: 1, cls: 'gold' },
          { row: top3[2], place: 3, cls: 'bronze' }
        ];
        podiumEl.innerHTML = podiumOrder.map(({ row, place, cls }) => {
          if (!row) return `<div class="podium-slot podium-empty"></div>`;
          const initial = (row.name || '?').trim().charAt(0).toUpperCase() || '?';
          return `
            <div class="podium-slot podium-${cls}${row.name === myName ? ' me' : ''}">
              ${place === 1 ? `<div class="podium-crown">${homeIcon('crown')}</div>` : ''}
              <div class="podium-avatar">${initial}</div>
              <div class="podium-name">${row.name}</div>
              ${row.multiplier ? `<div class="podium-mult">x${row.multiplier}</div>` : ''}
              <div class="podium-points">${row.points}<span>pts</span></div>
              <div class="podium-step">${place}</div>
            </div>
          `;
        }).join('');
        podiumEl.hidden = false;
      } else {
        podiumEl.innerHTML = '';
        podiumEl.hidden = true;
      }
    }

    if (!list.length) {
      listEl.innerHTML = '<li class="leaderboard-empty">Personne au classement pour l\'instant.</li>';
    } else {
      listEl.innerHTML = rest.map((row, i) => {
        const initial = (row.name || '?').trim().charAt(0).toUpperCase() || '?';
        return `
        <li class="leaderboard-row${row.name === myName ? ' me' : ''}">
          <span class="leaderboard-rank">${i + 4}</span>
          <span class="leaderboard-avatar">${initial}</span>
          <span class="leaderboard-name">${row.name}</span>
          ${row.multiplier ? `<span class="leaderboard-mult">x${row.multiplier}</span>` : ''}
          <span class="leaderboard-points">${row.points}</span>
        </li>
      `;
      }).join('');
    }

    const meEl = document.getElementById('home-leaderboard-me');
    if (meEl) {
      const myIndex = list.findIndex(r => r.name === myName);
      meEl.textContent = (myName && myIndex >= 10) ? `Vous : #${myIndex + 1} — ${list[myIndex].points} pts` : '';
    }
    if (myName) requestHomeProfile(myName);
  });
}

// ── Écran d'accueil : icônes + modal classement ──
function homeIcon(name) {
  const icons = {
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M7 4h10v4a5 5 0 0 1-5 5 5 5 0 0 1-5-5V4Z"/><path d="M7 5H4a2 2 0 0 0 2 4h1M17 5h3a2 2 0 0 1-2 4h-1"/><path d="M12 13v3m-3 4h6m-6 0a3 3 0 0 1 3-3 3 3 0 0 1 3 3"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 20V10m6 10V4m6 16v-7"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.4 7.4 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3h-4l-.3 2.4a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.4 7.4 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1L11 21h4l.3-2.4a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6Z"/></svg>',
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
    rank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2 3 14h7l-1 8 11-14h-7l1-6Z"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>',
    cards: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="6" width="12" height="15" rx="2"/><path d="M9 6V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2h-2"/></svg>',
    wheel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18M6.3 6.3l11.4 11.4M17.7 6.3 6.3 17.7"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>',
    spade: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C9 7 3 10.5 3 15a5 5 0 0 0 8.2 3.8c-.3 1.6-1 2.7-2.2 3.7h6c-1.2-1-1.9-2.1-2.2-3.7A5 5 0 0 0 21 15c0-4.5-6-8-9-13Z"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4 3 5-6 5 6 4-3-2 11H5L3 8Z"/></svg>',
    chevron: '<svg class="nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>'
  };
  return icons[name] || '';
}

let leaderboardModalEl = null;
function ensureLeaderboardModal() {
  if (leaderboardModalEl && document.body.contains(leaderboardModalEl)) return leaderboardModalEl;
  const el = document.createElement('div');
  el.className = 'app-modal leaderboard-modal';
  el.hidden = true;
  el.innerHTML = `
    <div class="app-modal-card leaderboard-modal-card">
      <div class="app-modal-header">
        <h2>${homeIcon('trophy')}<span>Classement</span></h2>
        <button type="button" class="modal-close">✕</button>
      </div>
      <div class="leaderboard-podium" id="home-leaderboard-podium"></div>
      <ul class="leaderboard-list" id="home-leaderboard-list"></ul>
      <div class="leaderboard-me" id="home-leaderboard-me"></div>
    </div>
  `;
  el.querySelector('.modal-close').addEventListener('click', () => { el.hidden = true; });
  el.addEventListener('click', (e) => { if (e.target === el) el.hidden = true; });
  document.body.appendChild(el);
  leaderboardModalEl = el;
  return el;
}

function openLeaderboardModal() {
  const modal = ensureLeaderboardModal();
  modal.hidden = false;
}

let statsModalEl = null;
function ensureStatsModal() {
  if (statsModalEl && document.body.contains(statsModalEl)) return statsModalEl;
  const el = document.createElement('div');
  el.className = 'app-modal stats-modal';
  el.hidden = true;
  el.innerHTML = `
    <div class="app-modal-card">
      <div class="app-modal-header">
        <h2>${homeIcon('chart')}<span>Statistiques</span></h2>
        <button type="button" class="modal-close">✕</button>
      </div>
      <div class="stats-modal-body" id="stats-modal-body">
        <div class="stats-empty">Jouez une première partie pour voir vos statistiques.</div>
      </div>
    </div>
  `;
  el.querySelector('.modal-close').addEventListener('click', () => { el.hidden = true; });
  el.addEventListener('click', (e) => { if (e.target === el) el.hidden = true; });
  document.body.appendChild(el);
  statsModalEl = el;
  return el;
}

function renderStatsModal(data) {
  const body = document.getElementById('stats-modal-body');
  if (!body) return;
  if (!data || !data.gamesPlayed) {
    body.innerHTML = '<div class="stats-empty">Jouez une première partie pour voir vos statistiques.</div>';
    return;
  }
  const rankText = data.rank ? `#${data.rank} sur ${data.totalRanked}` : 'Non classé';
  body.innerHTML = `
    <div class="stats-grid">
      <div class="stats-row"><span>Points de championnat</span><b>${data.points}</b></div>
      <div class="stats-row"><span>Rang</span><b>${rankText}</b></div>
      <div class="stats-row"><span>Multiplicateur actif</span><b>${data.multiplier ? `x${data.multiplier}` : 'x1'}</b></div>
      <div class="stats-row"><span>Parties jouées</span><b>${data.gamesPlayed}</b></div>
      <div class="stats-row"><span>Victoires</span><b>${data.wins}</b></div>
      <div class="stats-row"><span>Taux de victoire</span><b>${data.winRate}%</b></div>
    </div>
    <div class="stats-split">
      <div class="stats-split-card">
        <div class="stats-split-title">${homeIcon('cards')}<span>Tables (10 joueurs)</span></div>
        <div class="stats-split-line">${data.table.played} jouées · ${data.table.wins} gagnées</div>
      </div>
      <div class="stats-split-card">
        <div class="stats-split-title">${homeIcon('bolt')}<span>Face-à-face</span></div>
        <div class="stats-split-line">${data.duel.played} joués · ${data.duel.wins} gagnés</div>
      </div>
    </div>
  `;
}

function openStatsModal() {
  const modal = ensureStatsModal();
  modal.hidden = false;
  if (lastHomeProfile) renderStatsModal(lastHomeProfile);
}

let settingsModalEl = null;
function ensureSettingsModal() {
  if (settingsModalEl && document.body.contains(settingsModalEl)) return settingsModalEl;
  let storedName = '';
  try { storedName = localStorage.getItem('playername') || ''; } catch (e) {}
  const el = document.createElement('div');
  el.className = 'app-modal settings-modal';
  el.hidden = true;
  el.innerHTML = `
    <div class="app-modal-card">
      <div class="app-modal-header">
        <h2>${homeIcon('gear')}<span>Paramètres</span></h2>
        <button type="button" class="modal-close">✕</button>
      </div>
      <div class="settings-modal-body">
        <label class="settings-label" for="settings-name-input">Pseudo</label>
        <input type="text" id="settings-name-input" class="settings-name-input" maxlength="24" value="${storedName.replace(/"/g, '&quot;')}" placeholder="Votre pseudo" />
        <button type="button" class="neon-btn settings-save-btn" id="settings-save-btn">Enregistrer</button>
        <div class="settings-hint">Votre progression (points, statistiques) est liée à ce pseudo.</div>
      </div>
    </div>
  `;
  el.querySelector('.modal-close').addEventListener('click', () => { el.hidden = true; });
  el.addEventListener('click', (e) => { if (e.target === el) el.hidden = true; });
  el.querySelector('#settings-save-btn').addEventListener('click', () => {
    const input = el.querySelector('#settings-name-input');
    const name = (input.value || '').trim().slice(0, 24);
    if (name) {
      try { localStorage.setItem('playername', name); } catch (e) {}
      const homeNameInput = document.querySelector('.home-play-card .quickplay-name');
      if (homeNameInput) homeNameInput.value = name;
      updateHomeAvatar(name);
      requestHomeProfile(name);
    }
    el.hidden = true;
  });
  document.body.appendChild(el);
  settingsModalEl = el;
  return el;
}

function openSettingsModal() {
  const modal = ensureSettingsModal();
  const input = modal.querySelector('#settings-name-input');
  if (input) {
    let storedName = '';
    try { storedName = localStorage.getItem('playername') || ''; } catch (e) {}
    input.value = storedName;
  }
  modal.hidden = false;
}

function updateHomeAvatar(name) {
  const avatar = document.getElementById('home-avatar-initial');
  if (avatar) avatar.textContent = (name || '').trim().charAt(0).toUpperCase() || '?';
}

let lastHomeProfile = null;
let latestProgressionDashboard = null;
const latestCompetitiveReceipts = {};
function currentProgressionName() {
  const input = document.querySelector('.quickplay-name');
  if (input) return input.value.trim().slice(0, 24) || 'Joueur';
  try { return localStorage.getItem('playername') || 'Joueur'; } catch (_) { return 'Joueur'; }
}
function identifyProgression(name) {
  if (!socket) return Promise.resolve();
  socket._progressionReady = new Promise(resolve => {
    const timeout = setTimeout(() => resolve({ ok: false }), 10000);
    socket.emit('progression:identify', { name, clientKey: getOrCreateJoinClientKey() }, response => {
      clearTimeout(timeout);
      if (response?.ok) applyProgressionDashboard(response.data);
      resolve(response);
    });
  });
  return socket._progressionReady;
}
function applyProgressionDashboard(dashboard) {
  latestProgressionDashboard = dashboard;
  renderHomeStatsStrip(dashboard.profile);
  const badge = document.getElementById('home-progression-level');
  if (badge) badge.textContent = `Niv. ${dashboard.profile.level} · ${dashboard.profile.tierTitle}`;
  const daily = document.getElementById('home-daily-btn');
  if (daily) daily.classList.toggle('has-reward', !!(dashboard.login?.claimable || dashboard.missions?.some(m => m.claimable)));
  const resume = document.getElementById('home-resume-btn');
  if (resume) {
    resume.hidden = !(dashboard.pendingMultiplier || dashboard.wheelAvailable || dashboard.finalAvailable);
    resume.textContent = dashboard.pendingMultiplier ? 'Choisir mon multiplicateur' : dashboard.wheelAvailable ? 'Tourner ma roue' : 'Rejoindre ma finale';
  }
}
function resumeCompetitiveReward(action) {
  if (!socket) return;
  if (action === 'resume-final') return socket.emit('joinFinals', { clientKey: getOrCreateJoinClientKey() });
  if (action === 'resume-wheel' || latestProgressionDashboard?.wheelAvailable) ensureWheelView(false);
  else if (latestProgressionDashboard?.pendingMultiplier) showPendingWheelChoice(latestProgressionDashboard.pendingMultiplier);
  else socket.emit('joinFinals', { clientKey: getOrCreateJoinClientKey() });
}
document.addEventListener('imdcx:resume-reward', event => resumeCompetitiveReward(event.detail));
function requestHomeProfile(name) {
  if (!socket || !name) return;
  identifyProgression(name);
  socket.emit('getHomeProfile', { name });
}

function renderHomeStatsStrip(data) {
  const pointsEl = document.getElementById('stat-points');
  const rankEl = document.getElementById('stat-rank');
  const multEl = document.getElementById('stat-mult');
  const winrateEl = document.getElementById('stat-winrate');
  if (!pointsEl) return;
  if (!data) {
    pointsEl.textContent = '–'; rankEl.textContent = '–'; multEl.textContent = 'x1'; winrateEl.textContent = '–';
    return;
  }
  pointsEl.textContent = data.points || 0;
  rankEl.textContent = data.rank ? `#${data.rank}` : '—';
  multEl.textContent = data.multiplier ? `x${data.multiplier}` : 'x1';
  winrateEl.textContent = data.gamesPlayed ? `${data.winRate}%` : '–';
}

function showQuickPlayLobby() {
  try { sessionStorage.removeItem('pageReloadPending'); } catch (e) {}
  removeLoadingScreenNow();
  document.body.classList.add('lobby-mode', 'home-mode');
  document.body.classList.remove('portal-intro-pending', 'portal-intro-active');
  const intro = document.getElementById('portal-intro');
  if (intro) intro.remove();

  let storedName = '';
  try { storedName = localStorage.getItem('playername') || ''; } catch (e) {}

  const wrap = document.createElement('div');
  wrap.className = 'home-app';
  wrap.innerHTML = `
    <div class="home-topbar">
      <div class="home-brand"><span class="brand-badge">♠</span><span>POKER</span></div>
      <button type="button" class="home-avatar-btn" id="home-avatar-btn" title="Profil">
        <span id="home-avatar-initial">${(storedName || '').trim().charAt(0).toUpperCase() || '?'}</span>
      </button>
    </div>
    <div class="home-main">
      <div class="home-hero">
        <div class="hero-kicker">Championnat · Saison 1</div>
        <div class="hero-card-fan">
          <img class="hero-card-image" src="static/images/hero-card-fan.png" alt="" draggable="false" />
        </div>
        <h1 class="hero-title">IMDCX</h1>
        <div class="hero-divider"><span></span>${homeIcon('spade') || '♠'}<span></span></div>
        <div class="hero-tagline">Stratégie · Passion · Progression</div>
        <div class="home-play-card">
          <div class="quickplay-input-wrap">
            <span class="quickplay-input-icon">${homeIcon('person')}</span>
            <input type="text" class="quickplay-name" maxlength="24" placeholder="Votre pseudo" value="${storedName.replace(/"/g, '&quot;')}" />
          </div>
          <button type="button" class="quickplay-btn neon-btn"><span>Jouer</span>${homeIcon('arrow')}<span class="btn-spade-badge">${homeIcon('spade')}</span></button>
          <div class="quickplay-status"></div>
        </div>
      </div>
      <div class="home-stats-strip" id="home-stats-strip">
        <div class="stat-tile stat-points">
          <div class="stat-icon">${homeIcon('trophy')}</div>
          <div class="stat-value" id="stat-points">–</div>
          <div class="stat-label">Points</div>
        </div>
        <div class="stat-tile stat-rank">
          <div class="stat-icon">${homeIcon('rank')}</div>
          <div class="stat-value" id="stat-rank">–</div>
          <div class="stat-label">Rang</div>
        </div>
        <div class="stat-tile stat-mult">
          <div class="stat-icon">${homeIcon('bolt')}</div>
          <div class="stat-value" id="stat-mult">x1</div>
          <div class="stat-label">Multiplicateur</div>
        </div>
        <div class="stat-tile stat-winrate">
          <div class="stat-icon">${homeIcon('target')}</div>
          <div class="stat-value" id="stat-winrate">–</div>
          <div class="stat-label">Victoires</div>
        </div>
      </div>
      <div class="home-nav-row">
        <button type="button" class="home-nav-card" id="nav-classement-btn">${homeIcon('trophy')}<span>Classement</span>${homeIcon('chevron')}</button>
        <button type="button" class="home-nav-card" id="nav-stats-btn">${homeIcon('chart')}<span>Statistiques</span>${homeIcon('chevron')}</button>
        <button type="button" class="home-nav-card" id="nav-settings-btn">${homeIcon('gear')}<span>Paramètres</span>${homeIcon('chevron')}</button>
      </div>
    </div>
    <div class="home-dev-rail">
      <button type="button" class="home-dev-btn" id="preview-battle-btn" title="Tester la Bataille">${homeIcon('cards')}</button>
      <button type="button" class="home-dev-btn" id="preview-wheel-btn" title="Tester la roue">${homeIcon('wheel')}</button>
      <button type="button" class="home-dev-btn" id="manual-demo-btn">DÉMO</button>
    </div>
  `;
  window.IMDCXVisuals?.home(wrap);
  const progressLinks = document.createElement('div');
  progressLinks.className = 'progression-home-links';
  progressLinks.innerHTML = '<button type="button" id="home-profile-btn"><span id="home-progression-level">Mon profil</span></button><button type="button" id="home-daily-btn">Défis du jour<span class="progression-home-dot" aria-hidden="true"></span></button><button type="button" id="home-resume-btn" hidden>Reprendre ma récompense</button>';
  wrap.querySelector('.home-topbar').appendChild(progressLinks);
  progressLinks.querySelector('#home-profile-btn').addEventListener('click', () => window.IMDCXProgression?.open('profile'));
  progressLinks.querySelector('#home-daily-btn').addEventListener('click', () => window.IMDCXProgression?.open('daily'));
  progressLinks.querySelector('#home-resume-btn').addEventListener('click', () => resumeCompetitiveReward());
  document.body.appendChild(wrap);
  ensureLeaderboardModal();
  ensureStatsModal();
  ensureSettingsModal();
  renderHomeStatsStrip(null);

  const nameInput = wrap.querySelector('.quickplay-name');
  const btn = wrap.querySelector('.quickplay-btn');
  const status = wrap.querySelector('.quickplay-status');

  wrap.querySelector('#nav-classement-btn').addEventListener('click', () => {
    window.IMDCXProgression?.open('leaderboard');
  });
  wrap.querySelector('#nav-stats-btn').addEventListener('click', () => {
    openStatsModal();
  });
  wrap.querySelector('#nav-settings-btn').addEventListener('click', () => {
    openSettingsModal();
  });
  wrap.querySelector('#home-avatar-btn').addEventListener('click', () => {
    window.IMDCXProgression?.open('profile');
  });
  wrap.querySelector('#preview-battle-btn').addEventListener('click', () => {
    practiceBattleRequested = true;
    battleIsPractice = true;
    const view = ensureBattleView();
    view.querySelector('#battle-status').textContent = 'Recherche d’un adversaire…';
    socket.emit('startPracticeBattle');
  });
  wrap.querySelector('#preview-wheel-btn').addEventListener('click', () => {
    ensureWheelView(true);
  });
  wrap.querySelector('#manual-demo-btn').addEventListener('click', () => window.IMDCXDemo.selection());

  nameInput.addEventListener('blur', () => {
    const name = (nameInput.value || '').trim();
    if (name) { updateHomeAvatar(name); requestHomeProfile(name); }
  });

  socket = io();
  socket.on('connect', () => {
    registerChampionshipHandlers();
    if (storedName) requestHomeProfile(storedName);
  });
  socket.on('quickJoinAssigned', ({ table, seat }) => {
    window.location.href = `${window.location.pathname}?table=${encodeURIComponent(table)}&seat=${seat}`;
  });
  socket.on('joinError', (message) => {
    status.textContent = message || "Impossible de rejoindre une table, réessayez.";
    btn.disabled = false;
  });
  socket.on('connect_error', () => {
    status.textContent = "Connexion impossible, réessayez.";
    btn.disabled = false;
  });

  function trigger() {
    const name = (nameInput.value || '').trim().slice(0, 24) || 'Joueur';
    try { localStorage.setItem('playername', name); } catch (e) {}
    btn.disabled = true;
    status.textContent = "Recherche d'une table...";
    socket.emit('quickJoin', { name, clientKey: getOrCreateJoinClientKey() });
  }

  btn.addEventListener('click', trigger);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') trigger();
  });
}

/** Init connexion & handlers */
function initGame() {
  console.log("[client] initGame()");

  const earlyParams = new URLSearchParams(window.location.search);
  const demoSeats = Number(earlyParams.get('demo'));
  if ([2, 10].includes(demoSeats)) { window.IMDCXDemo.start(demoSeats); return; }
  const hasRoomParam = Boolean(earlyParams.get("table") || earlyParams.get("match2"));
  const spectatorEarly = ["1", "true", "yes", "on"].includes((earlyParams.get("spectator") || "").toLowerCase());
  if (!hasRoomParam && !spectatorEarly) {
    showQuickPlayLobby();
    return;
  }

  backgroundToggleReady = false;
  showReloadSyncWaitingOverlay();

  // Ã¢â€â‚¬Ã¢â€â‚¬ 0) Parse des paramÃƒÂ¨tres UNE FOIS Ã¢â€â‚¬Ã¢â€â‚¬
  const params    = new URLSearchParams(window.location.search);
  const tableID   = params.get("table");
  const match2ID  = params.get("match2");
  const levelHintRaw = String(params.get("level") || params.get("q") || '').trim().toUpperCase();
  const seatRaw = params.get("seat");
  const seatParam = parseInt(seatRaw, 10);
  const spectatorRaw = (params.get("spectator") || "").toLowerCase();
  isPublicSpectator = ["1", "true", "yes", "on"].includes(spectatorRaw);
  _tableID  = tableID || null;
  _match2ID = match2ID || null;
  _spectatorStorageScope = isPublicSpectator;
  _seatStorageScope = Number.isInteger(seatParam) ? seatParam : null;
  isMatch2 = !!match2ID;
  backgroundThemeOverride = loadBackgroundOverride();
  const storedLevelHint = loadStoredLevelHint();
  if (storedLevelHint) {
    initialLevelHint = storedLevelHint;
    applyTierBackgroundTheme({ level: storedLevelHint });
  }
  const normalizedUrlLevelHint = normalizeTableLevel(levelHintRaw);
  if (normalizedUrlLevelHint) {
    initialLevelHint = normalizedUrlLevelHint;
    storeLevelHint(normalizedUrlLevelHint);
    applyTierBackgroundTheme({ level: normalizedUrlLevelHint });
  }

  // Validation de base
  if (!tableID && !match2ID) {
    alert("URL invalide : utilisez ?table=XYZ&seat=N, ?match2=ABC&seat=N, ou ajoutez &spectator=1 pour un lien spectateur.");
    return;
  }
  if (!isPublicSpectator && !Number.isInteger(seatParam)) {
    alert("ParamÃƒÂ¨tre seat manquant ou invalide : utilisez &seat=0Ã¢â‚¬Â¦9 pour table ou &seat=0Ã¢â‚¬Â¦1 pour match2");
    return;
  }
  mySeatIndex = isPublicSpectator ? null : seatParam;
  if (isPublicSpectator) {
    document.body.classList.add('public-spectator-mode');
  }

  // Ã°Å¸â€â€™ VÃƒÂ©rifier si cette table est dÃƒÂ©jÃƒÂ  terminÃƒÂ©e pour ce joueur
  let forceLiveAfterClose = false;
  try {
    const legacyOneShot = sessionStorage.getItem('forceLiveAfterClose') === '1';
    forceLiveAfterClose = !isPublicSpectator && (legacyOneShot || getLiveSpectatorReloadFlag(tableID, match2ID, seatParam));
    if (legacyOneShot) sessionStorage.removeItem('forceLiveAfterClose');
  } catch (e) {}
  if (forceLiveAfterClose) {
    suppressFinalReplayAfterClose = true;
    setLiveSpectatorReloadFlag(tableID, match2ID, seatParam, true);
    clearStoredEndState(tableID, match2ID, seatParam);
  }
  const storedEnd = forceLiveAfterClose ? null : getStoredEndState(tableID, match2ID, seatParam);
  if (storedEnd && (storedEnd.kind === 'lose' || storedEnd.kind === 'win')) {
    restoreFinalWinnerOnlyView = true;
    lockRestoredFinalView = true;
  }
  if (storedEnd && storedEnd.kind === 'lose') {
    // Ã¢Â¬â€¦ cas "2Ã¡Âµâ€° coup" : on reste spectateur avec message
    console.log("[client] Partie dÃƒÂ©jÃƒÂ  perdue, vue spectateur");
    endStatePending = 'lose';
    endStateLocked = true;
  }
  if (storedEnd && storedEnd.kind === 'win') {
    console.log("[client] Partie dÃƒÂ©jÃƒÂ  gagnÃƒÂ©e, message persistant");
    endStatePending = 'win';
    endStateLocked = true;
  }
  if (storedEnd && storedEnd.snapshot) {
    try {
      // Restitue le dernier ÃƒÂ©tat connu immÃƒÂ©diatement
      const snap = storedEnd.snapshot;
      removeLoadingScreenNow();
      if (!mySocketId && snap?.players?.[mySeatIndex]?.id) {
        mySocketId = snap.players[mySeatIndex].id;
      }
      suppressWinnerMessage = true;
      currentGameState = snap;
      handleGameStateUpdate(snap);
      suppressWinnerMessage = false;
      if (storedEnd.kind === 'lose') showLosing(true);
      if (storedEnd.kind === 'win') showVictory("YOU");
      endStatePending = null;
    } catch (e) {
      console.warn("[client] restore snapshot failed", e);
      suppressWinnerMessage = false;
    }
  }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Restaurer un ÃƒÂ©ventuel TIME encore actif (aprÃƒÂ¨s reload) Ã¢â€â‚¬Ã¢â€â‚¬
  const frozen = loadStoredFrozenSeat();
  if (typeof frozen === 'number') {
    window.currentFrozenSeat = frozen;
    // le bouton ne s'affichera vraiment qu'aprÃƒÂ¨s le premier updateTable/updateMatch2,
    // quand currentGameState sera rempli.
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 1) Connexion Socket.IO Ã¢â€â‚¬Ã¢â€â‚¬
  socket = io();
  registerChampionshipHandlers();

  document.addEventListener('keydown', (e) => {
  // ignore si on tape dans un champ
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

  if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    e.stopImmediatePropagation();  // Ã¢Â¬â€¦Ã¢Â¬â€¦Ã¢Â¬â€¦ AJOUT IMPORTANT
    human_check(); // dÃƒÂ©clenche le garde-fou ci-dessus
  }
});

socket.on('endPage', (p) => {
  // Si on a dÃƒÂ©jÃƒÂ  un ÃƒÂ©tat final local restaurÃƒÂ©, on n'ÃƒÂ©crase jamais l'ÃƒÂ©cran.
  if (endStateLocked || endStatePending || currentGameState) return;
  if (p && p.html) { document.open(); document.write(p.html); document.close(); }
});

socket.on('roomFinishedNoState', (p) => {
  // Cas reload de partie terminÃƒÂ©e sans ÃƒÂ©tat serveur:
  // on garde l'ÃƒÂ©cran actuel (snapshot local si prÃƒÂ©sent).
  if (endStateLocked || endStatePending || currentGameState) return;
  removeLoadingScreenNow();
  if (p?.message) showErrorToast(p.message, 3000);
});

  socket.on("joinError", message => {
    document.body.innerHTML = `
      <div style="
        display:flex;
        align-items:center;
        justify-content:center;
        height:100vh;
        background:#000;
        color:#f33;
        font-size:24px;
        text-align:center;
        padding:20px;
      ">
        ${message}
      </div>
    `;
  });

  socket.on("breakDenied", ({ message } = {}) => {
    showErrorToast(message || "Break indisponible.");
  });

  // Ã¢â€â‚¬Ã¢â€â‚¬ 2) Fonction pour ÃƒÂ©mettre joinGame ÃƒÂ  chaque (re)connexion Ã¢â€â‚¬Ã¢â€â‚¬
  function sendJoin() {
    if (isPublicSpectator) {
      const payload = {};
      if (tableID) payload.tableID = tableID;
      else payload.matchID = match2ID;
      console.log("[client] emit joinSpectator", payload);
      socket.emit("joinSpectator", payload);
      return;
    }
    const payload = {
      name: localStorage.getItem("playername") || "P",
      seat: seatParam
    };
    const clientKey = getOrCreateJoinClientKey();
    if (clientKey) payload.clientKey = clientKey;
    if (tableID)  payload.table  = tableID;
    else          payload.match2 = match2ID;
    if (window.__portalIntroDone === true) {
      payload.portalIntroDone = true;
    }
    console.log("[client] emit joinGame", payload);
    socket.emit("joinGame", payload);
  }

  let portalIntroReadySent = false;
  function emitPortalIntroDoneToServer() {
    if (portalIntroReadySent) return;
    if (!socket || !socket.connected) return;
    portalIntroReadySent = true;
    socket.emit('portalIntroDone', {
      tableID: tableID || undefined,
      matchID: match2ID || undefined
    });
  }

  socket.on("connect", () => {
    mySocketId = socket.id;
    portalIntroReadySent = false;
    console.log("[client] connectÃƒÂ©, id =", mySocketId);
    sendJoin();
    if (window.__portalIntroDone === true) {
      emitPortalIntroDoneToServer();
    }
  });

  window.addEventListener('portalIntroDone', () => {
    emitPortalIntroDoneToServer();
  }, { once: true });

socket.on('turnTimeExpired', ({ tableID, seatIndex }) => {
  if (isPublicSpectator) return;
  // joueur dont le tour a dÃƒÂ©passÃƒÂ© les 30s
  window.currentFrozenSeat = seatIndex;
  if (currentGameState) currentGameState.timeFrozen = true;

  // Ã¢Å¾â€¢ on mÃƒÂ©morise le freeze pour survivre aux reloads
  storeFrozenSeat(seatIndex);

  // et on met ÃƒÂ  jour l'affichage local
  refreshTimeButtonVisibility();
  refreshAdd30ButtonVisibility();
});

socket.on('timeGranted', ({ tableID, seatIndex, duration }) => {
  if (isPublicSpectator) return;
  // 1) On libÃƒÂ¨re le "freeze" Ã¢â€ â€™ plus de bouton TIME
  window.currentFrozenSeat = null;
  clearStoredFrozenSeat();        // Ã°Å¸â€Â¥ on enlÃƒÂ¨ve aussi du localStorage
  refreshTimeButtonVisibility();
  refreshAdd30ButtonVisibility();

  // 2) Si on a un gameState en mÃƒÂ©moire, on redÃƒÂ©marre le timer
  if (currentGameState) {
    currentGameState.timeFrozen = false;
    if (seatIndex === currentGameState.current_bettor_index) {
      if (typeof duration === 'number' && duration > 0) {
        currentGameState.turnDuration = duration;
      }
      currentGameState.turnStartTime = Date.now();
      startClientTimerFromState(currentGameState);
      lastTurnStartTime = currentGameState.turnStartTime;
      lastTurnDuration = currentGameState.turnDuration;
    }
  }
  refreshAdd30ButtonVisibility();
});

socket.on('sosChatMessage', ({ message }) => {
  if (!message) return;
  sosChatMessages.push({ from: 'admin', text: message, ts: Date.now() });
  if (sosChatActive) {
    renderSosChatMessages();
  } else {
    setSosButtonMode(true);
  }
});

socket.on('revealPrompt', ({ seatIndex, ms }) => {
  if (isPublicSpectator) {
    hideRevealButton();
    return;
  }
  // Hyperfast: no HIDE/SHOW prompts, always auto-show
  if (gameMode === 'hyper') return;
  const promptSeat = Number(seatIndex);
  if (!Number.isInteger(promptSeat) || promptSeat !== Number(mySeatIndex)) {
    hideRevealButton();
    return;
  }
  showRevealButton(ms || 5000);
});

  // Affichage du modal dÃ¢â‚¬â„¢avertissement
// Au dÃƒÂ©marrage de votre initGame ou juste aprÃƒÂ¨s la connexion socket :
socket.on('warningElimination', ({ message }) => {
  // si la modal existe dÃƒÂ©jÃƒÂ , on ne recrÃƒÂ©e pas
  if (document.getElementById('warning-modal')) return;

  const overlay = document.createElement('div');
  overlay.id = 'warning-modal';
  overlay.innerHTML = `
    <div class="warning-content">
      <p>${message}</p>
      <button id="warning-ok">OK</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // fermeture au clic sur OK
  document.getElementById('warning-ok').onclick = () => {
    overlay.remove();
  };
}); 

  // Au dÃƒÂ©marrage du jeu, aprÃƒÂ¨s `socket = io();`
socket.on('clearWarningElimination', () => {
  const warn = document.getElementById('elimination-warning');
  if (warn) warn.remove(); 
});

  // On va marquer Ã¢â‚¬Å“justReconnectedÃ¢â‚¬Â ÃƒÂ  true avant dÃ¢â‚¬â„¢ÃƒÂ©mettre joinGame
socket.on("reconnect", attempt => {
    console.log(`[client] reconnexion #${attempt}`);
    justReconnected = true;
    sendJoin();
  });

function isMeWinnerFromFinishedPayload(winnerLabel) {
  const meBySeat = currentGameState?.players?.[mySeatIndex] || null;
  if (meBySeat?.id && mySocketId && meBySeat.id === mySocketId) {
    if (currentGameState?.winReason?.winnerId) {
      return currentGameState.winReason.winnerId === mySocketId;
    }
    if (typeof winnerLabel === 'string' && meBySeat.label) {
      return String(meBySeat.label) === String(winnerLabel);
    }
  }
  if (currentGameState?.winReason?.winnerId && mySocketId) {
    return currentGameState.winReason.winnerId === mySocketId;
  }
  if (typeof winnerLabel === 'string' && meBySeat?.label) {
    return String(meBySeat.label) === String(winnerLabel);
  }
  return false;
}

function applyFinishedStateFromServer(payload = {}) {
  if (suppressFinalReplayAfterClose) return;
  if (endStateLocked) return;
  const isWinner = isMeWinnerFromFinishedPayload(payload.winner);
  const hadHistory = Boolean(currentGameState || lastPhase);
  lateJoinFinishedState = !hadHistory;
  if (currentGameState) setLockedEndStateSnapshot(currentGameState);
  deferFinalStateIfNeeded(() => {
    if (isWinner) showVictory("YOU");
    else showLosing(true);
  });
}

socket.on('tableFinished', (payload = {}) => {
  applyFinishedStateFromServer(payload);
  if (payload.quickPlay && isMeWinnerFromFinishedPayload(payload.winner)) {
    setTimeout(() => joinChampionshipFinals(payload.winner), 6000);
  }
});

socket.on('match2Finished', (payload = {}) => {
  applyFinishedStateFromServer(payload);
  if (payload.isChampionshipFinal && isMeWinnerFromFinishedPayload(payload.winner)) {
    setTimeout(() => promptWheelSpin(payload.winner), 6000);
  }
});

// ── Championnat : face-à-face (l'aperçu de la roue et de la Bataille est mutualisé, voir plus bas) ──
function joinChampionshipFinals(myLabel) {
  const overlay = ensureChampionshipOverlay();
  overlay.querySelector('#champ-title').textContent = 'Table remportée !';
  const earned = latestCompetitiveReceipts.table?.competitivePoints ?? 30;
  overlay.querySelector('#champ-status').innerHTML = `<div class="battle-points">+${earned} pts de table</div><div>Prochaine étape : le duel final, +50 points de base.</div>`;
  socket.emit('joinFinals', { name: myLabel, clientKey: getOrCreateJoinClientKey() });
}

function promptWheelSpin(myLabel) {
  const overlay = ensureChampionshipOverlay();
  overlay.querySelector('#champ-title').textContent = 'Face-à-face remporté !';
  const earned = latestCompetitiveReceipts.duel?.competitivePoints ?? 50;
  overlay.querySelector('#champ-status').innerHTML = `<div class="battle-points">+${earned} pts de finale</div><div>30 + 50 = 80 points de base sur le parcours complet.</div><div>Tournez la roue du multiplicateur…</div>`;
  socket.emit('spinWheel', { name: myLabel });
}

// Ã¢â€â‚¬Ã¢â€â‚¬ 3) Waiting room (arcade) Ã¢â€â‚¬Ã¢â€â‚¬
// Ã¢â€â‚¬Ã¢â€â‚¬ 3) Waiting room (arcade) Ã¢â€â‚¬Ã¢â€â‚¬
function renderWaitingState(data) {
  const totalSeats = data.totalSeats || (data.matchID ? 2 : 10);
  const activeSeats = Number.isInteger(data.activeSeats) ? data.activeSeats : totalSeats;
  const taken = Array.isArray(data.seatsTaken)
    ? data.seatsTaken
    : Array.from({ length: totalSeats }, (_, i) => i < (data.waitingCount || 0));
  const labels = Array.isArray(data.seatLabels) && data.seatLabels.length
    ? data.seatLabels
    : Array.from({ length: totalSeats }, (_, i) => `Seat ${i + 1}`);

  const players = Array.from({ length: totalSeats }, (_, i) => ({
    id: (i === mySeatIndex && mySocketId) ? mySocketId : (taken[i] ? `seat-${i}` : null),
    label: (i < activeSeats && (i === mySeatIndex || taken[i])) ? labels[i] : '',
    bankroll: i < activeSeats ? 20000 : 0,
    carda: '',
    cardb: '',
    status: (i < activeSeats && (i === mySeatIndex || taken[i])) ? '' : 'WAIT',
    inactive: i >= activeSeats,
    subtotal_bet: 0,
    missedCount: 0,
    warned: false,
    seat: i
  }));

  const waitingLevel = normalizeTableLevel(data.level || data?.gameState?.level || currentGameState?.level || initialLevelHint || '');
  if (waitingLevel) {
    initialLevelHint = waitingLevel;
    storeLevelHint(waitingLevel);
  }

  const waitingState = {
    roundNumber: 1,
    players,
    pot: 0,
    board: [],
    current_bet: 0,
    current_bettor_index: 0,
    phase: 'waiting',
    checkCount: 0,
    roundEvaluated: false,
    dealerIndex: -1,
    level: waitingLevel,
    totalSeats,
    activeSeats
  };

  removeLoadingScreenNow();
  gui_show_poker_table();
  ensureMySeatClass();
  syncNonMySeatCardSize();
  updateInterface(waitingState);
  gui_set_my_cards("blinded", "blinded", mySeatIndex);
  const timerContainer = document.getElementById("timer-container");
  if (timerContainer) timerContainer.style.display = "none";
  refreshResponsiveScaleAfterRender();
  centerTableOnce();
}

// (Bataille interactive : fonctions et handlers définis plus haut, partagés avec l'écran d'accueil —
// voir registerChampionshipHandlers() / ensureBattleOverlay() avant showQuickPlayLobby())

// Waiting room -> show table immediately
socket.on("updateWaitingRoom", data => {
  if (isPublicSpectator) return;
  renderWaitingState(data);
  if (data && data.quickPlay && !battleResolved && Number.isInteger(mySeatIndex)) {
    showBattleWaitingView();
  }
});


  // Ã¢â€â‚¬Ã¢â€â‚¬ 4) DÃƒÂ©marrage du jeu Ã¢â€â‚¬Ã¢â€â‚¬
  socket.on("startGame", data => {
    if (isPublicSpectator) return;
    console.log("[client] startGame Ã¢â€ â€™", data);
    if (typeof data?.mode === 'string') gameMode = data.mode;
    removeLoadingScreenNow();
    gui_show_poker_table();
  
    // 1) Synchronisation du seat
    currentGameState = data.gameState;
    maybeResetFinalStateForFreshGame(currentGameState);
    const foundIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
    if (foundIdx >= 0 && foundIdx !== mySeatIndex) {
      console.warn("Seat index mismatch:", mySeatIndex, "Ã¢â€ â€™", foundIdx);
      mySeatIndex = foundIdx;
    }
    ensureMySeatClass();
  
    window.gameState      = currentGameState;
    window.gameStatePhase = currentGameState.phase;
  
    // 2) Reset visuel + UI
    resetAllBacks();
    updateInterface(currentGameState);
    setupBoardBacks(); // 5 dos visibles dÃƒÂ¨s le dÃƒÂ©part


    // Timer inutilisÃƒÂ© en hyper (mode all-in auto pur)
    if (String(gameMode || '').toLowerCase() === 'hyper') {
      stopTimerUI();
      lastTurnStartTime = null;
      lastTurnDuration = null;
    } else {
      startClientTimerFromState(currentGameState);
      lastTurnStartTime = currentGameState.turnStartTime;
      lastTurnDuration = currentGameState.turnDuration;
      lastTurnDuration = currentGameState.turnDuration;
    }
    lastActiveIdx     = currentGameState.current_bettor_index;
  
    requestAnimationFrame(() => updateTurnIndicator(currentGameState));
    const me = currentGameState.players?.[mySeatIndex];
    if (me?.status !== 'BUST') {
      animateMyCards();
    } else {
      applyBustSpectatorView(currentGameState);
    }
      refreshResponsiveScaleAfterRender();
      centerTableOnce();
  });  

  // Ã¢â€â‚¬Ã¢â€â‚¬ 5) RÃƒÂ©ceptions des mises ÃƒÂ  jour de partie Ã¢â€â‚¬Ã¢â€â‚¬
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Handler pour les tables ÃƒÂ  10 joueurs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
socket.on("updateTable", data => {
  if (isPublicSpectator) return;
  // a) Retrait de lÃ¢â‚¬â„¢ÃƒÂ©cran de chargement
  removeLoadingScreenNow();
  gui_show_poker_table();
  if (gameOverFreezeActive) {
    pendingLiveSpectatorState = data;
    currentGameState = data;
    return;
  }
  if (lockRestoredFinalView && endStateLocked) {
    pendingLiveSpectatorState = data;
    currentGameState = data;
    return;
  }

  // b) RÃƒÂ©-ajoute toujours la classe "my-seat" sur votre chaise
  const me = data.players?.[mySeatIndex];
  ensureMySeatClass();

  // c) Mise ÃƒÂ  jour globale de lÃ¢â‚¬â„¢UI (noms, pot, board, etc.)
  handleGameStateUpdate(data);
  if (String(gameMode || '').toLowerCase() === 'hyper' && finalStateDeferred && !endStateLocked) {
    return;
  }
  if (reloadRestorePending) {
    restoreMyCardsIfNeeded(data, { force: true });
    reloadRestorePending = false;
  }
  maybeRestoreCalculator(data);

  // d) Si on vient de se reconnecter, on force lÃ¢â‚¬â„¢affichage du dos des cartes
  //    et on **ne redÃƒÂ©marre** PAS la logique Ã¢â‚¬Å“resetAllBacks/animateMyCardsÃ¢â‚¬Â
  if (justReconnected) {
    justReconnected = false;

    resetMySeatBacks();
    restoreMyCardsIfNeeded(data, { force: true });
    applyBustSpectatorView(data);
    maybeRestoreCalculator(data);

    // Note : on ne fait pas Ã¢â‚¬Å“resetAllBacks()/animateMyCards()Ã¢â‚¬Â ici.
    //       Le timer a dÃƒÂ©jÃƒÂ  ÃƒÂ©tÃƒÂ© relancÃƒÂ© automatiquement par handleGameStateUpdate
    //       grÃƒÂ¢ce ÃƒÂ  la comparaison turnStartTime != lastTurnStartTime.

    return;
  }

  // e) Sinon (mise ÃƒÂ  jour Ã‚Â« live Ã‚Â» classique), on relance resetAllBacks/animateMyCards si nÃƒÂ©cessaire
  if (me?.status !== 'BUST' && !myCardsRevealed && me.carda && me.cardb && data.phase !== 'reveal') {
    restoreMyCardsIfNeeded(data);
  }
  applyBustSpectatorView(data);
  if (endStatePending && !suppressFinalReplayAfterClose) {
    if (endStatePending === 'lose') showLosing(true);
    if (endStatePending === 'win') showVictory("YOU");
    endStatePending = null;
  } else if (endStatePending && suppressFinalReplayAfterClose) {
    endStatePending = null;
  }
  refreshResponsiveScaleAfterRender();
});


// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬ Handler pour les duels 2-joueurs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
socket.on("updateMatch2", ({ gameState }) => {
  if (isPublicSpectator) return;
  // a) Retrait de lÃ¢â‚¬â„¢ÃƒÂ©cran de chargement
  removeLoadingScreenNow();
  gui_show_poker_table();
  if (gameOverFreezeActive) {
    pendingLiveSpectatorState = gameState;
    currentGameState = gameState;
    return;
  }
  if (lockRestoredFinalView && endStateLocked) {
    pendingLiveSpectatorState = gameState;
    currentGameState = gameState;
    return;
  }

  // b) RÃƒÂ©-ajoute toujours "my-seat" sur votre chaise
  const me = gameState.players?.[mySeatIndex];
  ensureMySeatClass();

  // c) Mise ÃƒÂ  jour globale de lÃ¢â‚¬â„¢UI
  handleGameStateUpdate(gameState);
  if (String(gameMode || '').toLowerCase() === 'hyper' && finalStateDeferred && !endStateLocked) {
    return;
  }
  if (reloadRestorePending) {
    restoreMyCardsIfNeeded(gameState, { force: true });
    reloadRestorePending = false;
  }
  maybeRestoreCalculator(gameState);

  // d) Si reconnexion, on force le dos des cartes, mais on ne rÃƒÂ©-anime pas
  if (justReconnected) {
    justReconnected = false;

    resetMySeatBacks();
    restoreMyCardsIfNeeded(gameState, { force: true });
    applyBustSpectatorView(gameState);
    maybeRestoreCalculator(gameState);

    // Le timer a dÃƒÂ©jÃƒÂ  ÃƒÂ©tÃƒÂ© pris en compte par handleGameStateUpdate
    return;
  }

  // e) Sinon, si cartes pas encore rÃƒÂ©vÃƒÂ©lÃƒÂ©es, on relance lÃ¢â‚¬â„¢animation
  if (me?.status !== 'BUST' && !myCardsRevealed && me.carda && me.cardb && gameState.phase !== 'reveal') {
    restoreMyCardsIfNeeded(gameState);
  }
  applyBustSpectatorView(gameState);
  if (endStatePending && !suppressFinalReplayAfterClose) {
    if (endStatePending === 'lose') showLosing(true);
    if (endStatePending === 'win') showVictory("YOU");
    endStatePending = null;
  } else if (endStatePending && suppressFinalReplayAfterClose) {
    endStatePending = null;
  }
  refreshResponsiveScaleAfterRender();
  centerTableOnce();
});

socket.on("spectatorState", (payload = {}) => {
  if (!isPublicSpectator) return;
  const gameState = payload.gameState;
  if (!gameState || !Array.isArray(gameState.players)) return;
  removeLoadingScreenNow();
  gui_show_poker_table();
  applyPublicSpectatorReadOnlyUi();
  mySeatIndex = null;
  ensureMySeatClass();
  handleGameStateUpdate(gameState);
  applyPublicSpectatorReadOnlyUi();
  applyPublicSpectatorSeatBacks(gameState);
  hideRevealButton();
  syncNonMySeatCardSize();
  refreshResponsiveScaleAfterRender();
  centerTableOnce();
});

  // Ã¢â€â‚¬Ã¢â€â‚¬ 6) Bouton Raise Ã¢â€â‚¬Ã¢â€â‚¬
  document.getElementById("raise-button")?.addEventListener("click", show_custom_raise);
}

window.initGame = initGame;


/** RÃƒÂ©initialise tous les backs (pour revealÃ¢â€ â€™preflop) */
function resetAllBacks(skipSeatIdx = null, sourceState = currentGameState) {
  if (!sourceState || !Array.isArray(sourceState.players)) return;
  if (sourceState === currentGameState && window.IMDCXDemo?.renderRevealCards(sourceState)) return;
  sourceState.players.forEach((player, seatIdx) => {
    if (Number.isInteger(skipSeatIdx) && seatIdx === skipSeatIdx) return;
    // A disclosed winning hand stays visible for its short award feedback.
    if (window.IMDCXMotion && sourceState.phase === 'reveal' && player?.status === 'WINNER' && player.revealStatus === 'show') return;
    const seatEl = document.getElementById("seat" + seatIdx);
    if (!seatEl) return;
    seatEl.querySelectorAll(".holecards .card").forEach(card => {
      window.IMDCXMotion?.cancelCard(card);
      card.style.transition = "";
      card.style.transform  = "";
      card.classList.remove("revealed", "visible");
      card.classList.remove("deal-flip", "my-card-3d-wrap", "my-card-landing", "my-card-halo");
      internal_setCard(card, "blinded", false, true);
      requestAnimationFrame(() => card.classList.add("visible"));
    });
  });
}

const BOARD_IDS = ["flop1","flop2","flop3","turn","river"];
const CARD_BACK_URL = "static/images/cardback1.png"; // fallback only
const boardFaceTimeouts = new Map();
let boardRenderEpoch = 0;

function cancelBoardFaceTimeout(i) {
  const pending = boardFaceTimeouts.get(i);
  if (pending) {
    clearTimeout(pending);
    boardFaceTimeouts.delete(i);
  }
}

function resetBoardRenderState() {
  boardRenderEpoch += 1;
  for (let i = 0; i < BOARD_IDS.length; i += 1) {
    cancelBoardFaceTimeout(i);
    const slot = document.getElementById(BOARD_IDS[i]);
    if (!slot) continue;
    window.IMDCXMotion?.cancelCard(slot);
    slot.classList.remove('fy-flip-soft');
    slot.style.removeProperty('--flip-delay');
    slot.style.removeProperty('--flip-dur');
    delete slot.dataset[`face${i}`];
  }
}

function forceShow(el){
  if (!el) return;
  el.style.visibility = "visible";
  el.style.opacity    = "1";
  el.style.display    = el.style.display === "none" ? "" : el.style.display;
}

/** Peint le DOS en background sur un slot du board (id = flop1...river) */
function paintBoardBack(i){
  const slot = document.getElementById(BOARD_IDS[i]);
  if (!slot) return;
  slot.dataset.hasBack = "1";
  slot.classList.remove('revealed');
  // fond dos visible mÃƒÂªme si lÃ¢â‚¬â„¢intÃƒÂ©rieur est vide
  slot.style.backgroundImage    = getThemeCardAssetCssUrl('cardback') || `url("${CARD_BACK_URL}")`;
  slot.style.backgroundRepeat   = "no-repeat";
  slot.style.backgroundPosition = "center";
  slot.style.backgroundSize     = "contain";
  // assurer la prÃƒÂ©sence visuelle
  forceShow(slot);
}

/** Pose les 5 dos (prÃƒÂ©flop) */
function setupBoardBacks(){
  resetBoardRenderState();
  for (let i = 0; i < 5; i++) {
    paintBoardBack(i);
  }
}

/** Nettoie le DOS dÃ¢â‚¬â„¢un slot (avant de poser la face) */
function clearBoardBack(i){
  const slot = document.getElementById(BOARD_IDS[i]);
  if (!slot) return;
  delete slot.dataset.hasBack;
  slot.style.backgroundImage = "none";
}

/** Pose/MAJ une face avec un flip doux; enlÃƒÂ¨ve le dos au bon moment */
function setBoardFace(i, code, animate = true, delayMs = 0, durMs = 1300){
  const slot = document.getElementById(BOARD_IDS[i]);
  if (!slot || !code) return;
  cancelBoardFaceTimeout(i);

  // si la face est dÃƒÂ©jÃƒÂ  posÃƒÂ©e, on force juste visible
  const faceKey = `face${i}`;
  if (slot.dataset[faceKey] === code) { forceShow(slot); return; }
  const renderEpoch = boardRenderEpoch;

  const applyFace = () => {
    if (renderEpoch !== boardRenderEpoch) return;
    // retirer le dos AVANT dÃ¢â‚¬â„¢afficher la face
    clearBoardBack(i);

    if (typeof gui_lay_board_card === "function") {
      gui_lay_board_card(i, code);   // Ã¢Å“â€¦ ton rendu habituel
    } else if (typeof internal_setCard === "function") {
      // si tes slots contiennent une .card interne :
      const inner = slot.querySelector('.card') || slot;
      internal_setCard(inner, code, false, true);
    }
    slot.dataset[faceKey] = code;
    forceShow(slot);
  };

  if (window.IMDCXMotion) {
    window.IMDCXMotion.flip(slot, `board:${renderEpoch}:${i}:${code}`, applyFace,
      { valid: () => renderEpoch === boardRenderEpoch, delay: Math.min(delayMs, i * 65), instant: !animate });
    return;
  }
  if (!animate) { applyFace(); return; }

  // flip doux (classe CSS ci-dessous)
  slot.style.setProperty('--flip-delay', `${delayMs}ms`);
  slot.style.setProperty('--flip-dur',   `${durMs}ms`);
  slot.classList.add('fy-flip-soft');

  // change la face ÃƒÂ  mi-parcours
  const timeoutId = setTimeout(() => {
    boardFaceTimeouts.delete(i);
    applyFace();
  }, delayMs + Math.floor(durMs / 2));
  boardFaceTimeouts.set(i, timeoutId);

  const onEnd = () => {
    slot.classList.remove('fy-flip-soft');
    slot.style.removeProperty('--flip-delay');
    slot.style.removeProperty('--flip-dur');
    slot.removeEventListener('animationend', onEnd);
  };
  slot.addEventListener('animationend', onEnd);
}


/** Met ÃƒÂ  jour toute lÃ¢â‚¬â„¢UI */
function ensureFruityBackgroundLayer() {
  if (fruityBgLayerEl || !document.body) return fruityBgLayerEl;
  const layer = document.createElement('div');
  layer.id = 'fruit-bg-layer';
  const fruitKinds = [
    'orange', 'strawberry', 'lemon', 'blueberry', 'apple', 'kiwi',
    'grape', 'peach', 'melon', 'pear', 'cherry', 'plum',
    'banana', 'watermelon', 'raspberry', 'coconut'
  ];
  const fruitCount = 88;
  const fruitIcons = ['🍉', '🍑', '🍓', '🍋', '🍊', '🍒', '🍇', '🍍', '🍎', '🍐', '🥝'];

  for (let idx = 0; idx < fruitCount; idx += 1) {
    const useIcon = Math.random() < 0.58;
    const kind = fruitKinds[Math.floor(Math.random() * fruitKinds.length)];
    const fruit = document.createElement('span');
    fruit.className = `fruit-float ${useIcon ? 'fruit-emoji' : `fruit-${kind}`}`;
    fruit.style.setProperty('--fruit-size', `${18 + Math.round(Math.random() * 34)}px`);
    if (useIcon) {
      fruit.textContent = fruitIcons[Math.floor(Math.random() * fruitIcons.length)];
      fruit.style.setProperty('--fruit-emoji-size', `${18 + Math.round(Math.random() * 22)}px`);
    }
    fruit.style.setProperty('--fruit-left', `${Math.round(Math.random() * 94)}%`);
    fruit.style.setProperty('--fruit-dur', `${12 + Math.round(Math.random() * 22)}s`);
    fruit.style.setProperty('--fruit-delay', `${Math.round(Math.random() * 2000) * -0.01}s`);
    fruit.style.setProperty('--fruit-drift', `${(Math.random() * 14 - 7).toFixed(2)}vw`);
    fruit.style.setProperty('--fruit-depth', `${0.42 + Math.random() * 0.58}`);
    fruit.style.zIndex = String((idx % 2) + 1);
    layer.appendChild(fruit);
  }

  document.body.appendChild(layer);
  fruityBgLayerEl = layer;
  return fruityBgLayerEl;
}

function ensureBackgroundTransitionLayer() {
  if (backgroundTransitionLayerEl || !document.body) return backgroundTransitionLayerEl;
  const layer = document.createElement('div');
  layer.id = 'bg-theme-transition-layer';
  document.body.appendChild(layer);
  backgroundTransitionLayerEl = layer;
  return backgroundTransitionLayerEl;
}

function triggerBackgroundThemeTransition(fromFruity, toFruity) {
  const layer = ensureBackgroundTransitionLayer();
  if (!layer) return;
  if (backgroundTransitionTimer) {
    clearTimeout(backgroundTransitionTimer);
    backgroundTransitionTimer = null;
  }
  layer.classList.remove('old-fruity', 'old-dark', 'target-fruity', 'target-dark', 'is-active');
  void layer.offsetWidth;
  layer.classList.add(fromFruity ? 'old-fruity' : 'old-dark');
  layer.classList.add(toFruity ? 'target-fruity' : 'target-dark');
  layer.classList.add('is-active');
  backgroundTransitionTimer = setTimeout(() => {
    layer.classList.remove('is-active');
    backgroundTransitionTimer = null;
  }, 5000);
}

function syncBackgroundToggleButtonUi() {
  const btn = document.getElementById('bg-theme-toggle');
  if (!btn) return;
  const fruityOn = document.body.classList.contains('tier-fruity-bg');
  // Show the icon of the target theme (what will happen on click).
  let iconEl = btn.querySelector('.bg-theme-toggle-icon');
  if (!iconEl) {
    iconEl = document.createElement('span');
    iconEl.className = 'bg-theme-toggle-icon';
    btn.textContent = '';
    btn.appendChild(iconEl);
  }
  iconEl.textContent = fruityOn ? '🌌' : '🍓';
  btn.title = fruityOn ? 'Passer au fond sombre' : 'Passer au fond fruité';
  btn.setAttribute('aria-label', btn.title);
}

function positionBackgroundToggleButton() {
  const btn = document.getElementById('bg-theme-toggle');
  if (!btn) return false;
  let anchored = false;

  const boardRects = Array.from(document.querySelectorAll('#board-placeholders .board-placeholder, #board .boardcard'))
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);
  const topSeatRects = [0, 1, 2, 3, 4]
    .map((idx) => document.querySelector(`#seat${idx} .name-chips`))
    .filter(Boolean)
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0);

  if (boardRects.length && topSeatRects.length) {
    const boardLeft = Math.min(...boardRects.map((r) => r.left));
    const boardRight = Math.max(...boardRects.map((r) => r.right));
    const boardBottom = Math.max(...boardRects.map((r) => r.bottom));
    const seatsTop = Math.min(...topSeatRects.map((r) => r.top));
    const edgeGapPx = 2;
    const rawAvailableGap = Math.floor(seatsTop - boardBottom - (edgeGapPx * 2));
    const targetSize = Math.max(12, rawAvailableGap);
    const halfW = Math.round(targetSize / 2);
    const gapCenterX = Math.round((boardLeft + boardRight) / 2);
    const topY = Math.round(boardBottom + edgeGapPx);

    btn.style.width = `${targetSize}px`;
    btn.style.height = `${targetSize}px`;
    btn.style.minWidth = `${targetSize}px`;
    btn.style.minHeight = `${targetSize}px`;
    btn.style.maxWidth = `${targetSize}px`;
    btn.style.maxHeight = `${targetSize}px`;
    btn.style.fontSize = `${Math.max(13, Math.round(targetSize * 0.5))}px`;

    btn.style.position = 'fixed';
    btn.style.left = `${Math.round(gapCenterX - halfW)}px`;
    btn.style.top = `${topY}px`;
    backgroundToggleLastAnchor = {
      left: Math.round(gapCenterX - halfW),
      top: topY,
      source: 'seat-board-gap'
    };
    anchored = true;
  }

  if (!anchored && backgroundToggleLastAnchor) {
    const fallbackWidth = Math.max(16, Math.round(btn.offsetWidth || 34));
    const fallbackHeight = Math.max(16, Math.round(btn.offsetHeight || 34));
    btn.style.position = 'fixed';
    btn.style.left = `${backgroundToggleLastAnchor.left}px`;
    btn.style.top = `${backgroundToggleLastAnchor.top}px`;
    btn.style.width = `${fallbackWidth}px`;
    btn.style.height = `${fallbackHeight}px`;
    anchored = true;
  }

  if (!anchored) {
    const table = document.getElementById('poker_table');
    const tr = table?.getBoundingClientRect?.();
    if (tr && tr.width > 0 && tr.height > 0) {
      const fallbackSize = 28;
      const halfW = Math.round(fallbackSize / 2);
      btn.style.position = 'fixed';
      btn.style.width = `${fallbackSize}px`;
      btn.style.height = `${fallbackSize}px`;
      btn.style.minWidth = `${fallbackSize}px`;
      btn.style.minHeight = `${fallbackSize}px`;
      btn.style.maxWidth = `${fallbackSize}px`;
      btn.style.maxHeight = `${fallbackSize}px`;
      btn.style.fontSize = `${Math.round(fallbackSize * 0.5)}px`;
      btn.style.left = `${Math.round(tr.left + (tr.width / 2) - halfW)}px`;
      btn.style.top = `${Math.round(tr.top + 84)}px`;
      backgroundToggleLastAnchor = {
        left: Math.round(tr.left + (tr.width / 2) - halfW),
        top: Math.round(tr.top + 84),
        source: 'table'
      };
      anchored = true;
    }
  }
  btn.style.visibility = (anchored && backgroundToggleCanShow) ? 'visible' : 'hidden';
  return anchored;
}

function scheduleBackgroundToggleReveal() {
  if (backgroundToggleRevealRaf) {
    cancelAnimationFrame(backgroundToggleRevealRaf);
    backgroundToggleRevealRaf = null;
  }
  const btn = document.getElementById('bg-theme-toggle');
  if (!btn) return;
  backgroundToggleCanShow = false;
  btn.style.visibility = 'hidden';

  let frameCount = 0;
  const tick = () => {
    backgroundToggleRevealRaf = null;
    if (!backgroundToggleReady) return;
    frameCount += 1;
    const anchored = positionBackgroundToggleButton();
    // Wait a couple of frames after anchor is measurable to avoid first-frame misplacement.
    if (anchored && frameCount >= 3) {
      backgroundToggleCanShow = true;
      positionBackgroundToggleButton();
      return;
    }
    if (frameCount < 14) {
      backgroundToggleRevealRaf = requestAnimationFrame(tick);
    }
  };
  backgroundToggleRevealRaf = requestAnimationFrame(tick);
}

function ensureBackgroundToggleButton() {
  if (!backgroundToggleReady) {
    backgroundToggleCanShow = false;
    const hiddenBtn = document.getElementById('bg-theme-toggle');
    if (hiddenBtn) hiddenBtn.style.display = 'none';
    return null;
  }
  const host = document.body;
  if (!host) return null;
  let btn = document.getElementById('bg-theme-toggle');
  if (btn) {
    btn.style.display = 'grid';
    if (!backgroundToggleCanShow) {
      btn.style.visibility = 'hidden';
      scheduleBackgroundToggleReveal();
    } else {
      positionBackgroundToggleButton();
    }
    return btn;
  }

  btn = document.createElement('button');
  btn.type = 'button';
  btn.id = 'bg-theme-toggle';
  btn.className = 'bg-theme-toggle';
  btn.style.display = 'grid';
  btn.style.visibility = 'hidden';
  btn.innerHTML = '<span class="bg-theme-toggle-icon">🍓</span>';
  btn.title = 'Changer le fond';
  btn.setAttribute('aria-label', 'Changer le fond');
  btn.addEventListener('click', () => {
    const fruityOn = document.body.classList.contains('tier-fruity-bg');
    backgroundThemeOverride = fruityOn ? 'forceDark' : 'forceFruity';
    storeBackgroundOverride(backgroundThemeOverride);
    applyTierBackgroundTheme(currentGameState || { level: initialLevelHint || '' });
  });
  host.appendChild(btn);
  scheduleBackgroundToggleReveal();
  if (!backgroundToggleResizeBound) {
    backgroundToggleResizeBound = true;
    window.addEventListener('resize', positionBackgroundToggleButton);
    window.addEventListener('scroll', positionBackgroundToggleButton, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', positionBackgroundToggleButton);
      window.visualViewport.addEventListener('scroll', positionBackgroundToggleButton);
    }
  }
  return btn;
}

function applyTierBackgroundTheme(gameState) {
  const body = document.body;
  if (!body) return;
  const wasFruity = body.classList.contains('tier-fruity-bg');
  const levelRaw = normalizeTableLevel(gameState?.level || initialLevelHint || '');
  applyTableBackgroundForLevel(levelRaw || initialLevelHint || '');
  const isLowTier = (levelRaw === 'Q1' || levelRaw === 'Q2');
  if (levelRaw) {
    initialLevelHint = levelRaw;
    storeLevelHint(levelRaw);
  }
  const paletteLevel = (levelRaw === 'Q1' || levelRaw === 'Q2')
    ? levelRaw
    : (initialLevelHint === 'Q2' ? 'Q2' : 'Q1');
  let isFruityTier = isLowTier;
  if (backgroundThemeOverride === 'forceDark') isFruityTier = false;
  if (backgroundThemeOverride === 'forceFruity') isFruityTier = true;
  const isQ1 = isFruityTier && paletteLevel === 'Q1';
  const isQ2 = isFruityTier && paletteLevel === 'Q2';

  if (wasFruity !== isFruityTier && backgroundToggleReady) {
    triggerBackgroundThemeTransition(wasFruity, isFruityTier);
  }

  body.classList.toggle('tier-fruity-bg', isFruityTier);
  body.classList.toggle('tier-q1-bg', isQ1);
  body.classList.toggle('tier-q2-bg', isQ2);
  applyThemeCardAssetVariables();
  if (typeof internal_PreloadFruitySuitAssets === 'function' && isFruityTier) {
    internal_PreloadFruitySuitAssets();
  }
  if (isFruityTier) scheduleFruityFaceRefreshBurst();
  else refreshVisibleCardFacesForTheme();

  const layer = ensureFruityBackgroundLayer();
  if (layer) {
    layer.classList.toggle('is-active', isFruityTier);
    layer.classList.toggle('is-q1', isQ1);
    layer.classList.toggle('is-q2', isQ2);
  }
  const bgBtn = ensureBackgroundToggleButton();
  if (bgBtn) {
    syncBackgroundToggleButtonUi();
    positionBackgroundToggleButton();
  }

  document.querySelectorAll('.seat.my-seat .holecards .holecard1, .seat.my-seat .holecards .holecard2').forEach((card) => {
    if (!card) return;
    if (card.classList.contains('revealed')) return;
    if (String(card.style.opacity || '') === '0') return;
    const isFirstCard = !!card.closest('.holecard1');
    animateCardBackThemeSwap(
      card,
      isFirstCard ? getThemeCardAssetCssUrl('customI') : getThemeCardAssetCssUrl('customM')
    );
  });

  document.querySelectorAll('#board [data-has-back="1"], #flop1[data-has-back="1"], #flop2[data-has-back="1"], #flop3[data-has-back="1"], #turn[data-has-back="1"], #river[data-has-back="1"]').forEach((slot) => {
    animateCardBackThemeSwap(slot, getThemeCardAssetCssUrl('cardback'));
  });

  document.querySelectorAll('.spectator-back-card').forEach((card, idx) => {
    animateCardBackThemeSwap(
      card,
      idx === 0 ? getThemeCardAssetCssUrl('customI', { absolute: true }) : getThemeCardAssetCssUrl('customM', { absolute: true }),
      { important: true }
    );
  });

  [
    ['fold-button', 'customD'],
    ['call-button', 'customC'],
    ['custom-raise', 'customX']
  ].forEach(([id, assetKind]) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    animateCardBackThemeSwap(
      btn,
      getThemeCardAssetCssUrl(assetKind, { absolute: true }),
      { important: true }
    );
  });
}

function updateInterface(gameState) {
  // 0) Garder les refs globales
  window.gameState      = gameState;
  window.gameStatePhase = gameState.phase;
  currentGameState      = gameState;
  backgroundToggleReady = String(gameState?.phase || '').toLowerCase() !== 'waiting';
  rememberMyKnownHoleCardsFromState(gameState);
  ensureAllInRedStyle();
  updateBreakButtonState(gameState);
  applyTierBackgroundTheme(gameState);

  // 1) Affiche la table
  gui_show_poker_table();
  ensureMySeatClass();
  syncNonMySeatCardSize();
  const domSeats = Array.from(document.querySelectorAll('.seat'));
  const totalSeats = Number.isInteger(gameState.totalSeats) ? gameState.totalSeats : domSeats.length;
  const activeSeats = Number.isInteger(gameState.activeSeats) ? gameState.activeSeats : totalSeats;
  domSeats.forEach((seatEl, i) => {
    const inactive = i >= activeSeats;
    seatEl.classList.toggle('inactive-seat', inactive);
    if (inactive) {
      seatEl.classList.remove('waiting-seat', 'join-seat', 'break-seat', 'is-bust', 'allin-text', 'turn');
      gui_set_player_name('', i);
      gui_set_bankroll('', i);
      gui_set_bet('', i);
      gui_set_player_cards('', '', i, false);
    }
  });

  // 3) DÃƒÂ©sactive et grise dÃƒÂ©finitivement les siÃƒÂ¨ges BUSTED
  gameState.players.forEach((p, i) => {
    if (p.status === 'BUST') {
      // a) Affiche "BUSTED" comme nom
      gui_set_player_name('BUSTED', i);
      // b) Bankroll = 0, pas de mise
      gui_set_bankroll(0, i);
      gui_set_bet('', i);
      // c) Grise visuel du siÃƒÂ¨ge
      const seatEl = document.getElementById('seat' + i);
      if (seatEl) seatEl.classList.add('disabled-seat');
      // d) Si c'est moi, cache tous mes contrÃƒÂ´les
      if (i === mySeatIndex) {
        gui_hide_fold_call_click();
        disableRaiseButton();
      }
    } else {
      const seatEl = document.getElementById('seat' + i);
      if (seatEl) seatEl.classList.remove('disabled-seat');
    }
  });

  
// AprÃƒÂ¨s: gui_show_poker_table();
gameState.players.forEach((player, i) => {
  const seatEl = document.getElementById('seat' + i);
  if (!seatEl) return;
  const isHyperFastMode = String(gameMode || '').toLowerCase() === 'hyper';

  const isInactive = player?.inactive || (Number.isInteger(activeSeats) && i >= activeSeats);
  if (isInactive) {
    seatEl.classList.add('inactive-seat');
    seatEl.classList.remove('waiting-seat', 'join-seat', 'break-seat', 'is-bust', 'allin-text', 'is-allin-bg', 'allin-burst', 'turn');
    const burstEl = seatEl.querySelector('.allin-burst-effect');
    if (burstEl) burstEl.classList.remove('active');
    if (seatEl._allInBurstTimeout) {
      clearTimeout(seatEl._allInBurstTimeout);
      seatEl._allInBurstTimeout = null;
    }
    seatEl.dataset.wasAllIn = '0';
    return;
  }

  const isBusted = player?.status === 'BUST';          // <-- plus de test sur bankroll
  const isWaiting = player?.status === 'WAIT';
  const isBreakWaiting = isWaiting && Boolean(player?.isBreak);
  const isJoinWaiting = isWaiting && !isBreakWaiting && Boolean(player?.id);
  const isZero   = !isBusted && ((player?.bankroll | 0) <= 0);
  const isAllIn = player?.status === 'ALLIN';
  const wasAllIn = seatEl.dataset.wasAllIn === '1';

  seatEl.classList.toggle('is-bust', isBusted);
  seatEl.classList.toggle('disabled-seat', isBusted);
  seatEl.classList.toggle('spectator-bust', isBusted && i === mySeatIndex);
  seatEl.classList.toggle('waiting-seat', isWaiting && !isJoinWaiting && !isBreakWaiting);
  seatEl.classList.toggle('join-seat', isJoinWaiting);
  seatEl.classList.toggle('break-seat', isBreakWaiting);
  seatEl.classList.toggle('is-zero', isZero);          // optionnel, style leger
  seatEl.classList.toggle('allin-text', isAllIn);
  seatEl.classList.toggle('is-allin-bg', isAllIn);

  const burstHost = seatEl.querySelector('.name-chips') || seatEl;
  let burstEl = burstHost.querySelector('.allin-burst-effect');
  if (!burstEl) {
    burstEl = seatEl.querySelector('.allin-burst-effect');
    if (burstEl && burstEl.parentElement !== burstHost) {
      burstHost.appendChild(burstEl);
    } else if (!burstEl) {
      burstEl = document.createElement('div');
      burstEl.className = 'allin-burst-effect';
      burstHost.appendChild(burstEl);
    }
  }

  if (isHyperFastMode) {
    seatEl.classList.remove('allin-burst');
    burstEl.classList.remove('active');
    if (seatEl._allInBurstTimeout) {
      clearTimeout(seatEl._allInBurstTimeout);
      seatEl._allInBurstTimeout = null;
    }
  } else if (isAllIn && !wasAllIn) {
    seatEl.classList.remove('allin-burst');
    void seatEl.offsetWidth;
    seatEl.classList.add('allin-burst');

    burstEl.classList.remove('active');
    void burstEl.offsetWidth;
    burstEl.classList.add('active');

    if (seatEl._allInBurstTimeout) clearTimeout(seatEl._allInBurstTimeout);
    seatEl._allInBurstTimeout = setTimeout(() => {
      seatEl.classList.remove('allin-burst');
      const currentBurstEl = seatEl.querySelector('.allin-burst-effect');
      if (currentBurstEl) currentBurstEl.classList.remove('active');
      seatEl._allInBurstTimeout = null;
    }, 5000);
  } else if (!isAllIn) {
    seatEl.classList.remove('allin-burst');
    burstEl.classList.remove('active');
    if (seatEl._allInBurstTimeout) {
      clearTimeout(seatEl._allInBurstTimeout);
      seatEl._allInBurstTimeout = null;
    }
  }

  seatEl.dataset.wasAllIn = isAllIn ? '1' : '0';
});

  updateAllInClashState(gameState, activeSeats);


  // 4) Mode hyper Ã¢â€ â€™ plus d'actions client (tout est pilotÃƒÂ© cÃƒÂ´tÃƒÂ© serveur)
  if (gameMode === 'hyper' && currentGameState.phase === 'preflop' && !overlayShown) {
    gui_hide_fold_call_click();
    disableRaiseButton();
    overlayShown = true;
  }

  // Dealer (masque en phase d'attente)
  if (gameState.phase === 'waiting') {
    gui_hide_dealer_button();
    clearInterval(timerInterval);
    const timerContainer = document.getElementById("timer-container");
    if (timerContainer) timerContainer.style.display = "none";
  } else if (
    Number.isInteger(gameState.dealerIndex) &&
    gameState.dealerIndex >= 0 &&
    gameState.dealerIndex < gameState.players.length &&
    gameState.players[gameState.dealerIndex] &&
    gameState.players[gameState.dealerIndex].status !== 'BUST'
  ) {
    gui_place_dealer_button(gameState.dealerIndex);
  } else {
    gui_hide_dealer_button();
  }

  // Cache cartes BUST hors reveal (sauf mon siÃƒÂ¨ge en spectateur : garder les dos I/M)
  gameState.players.forEach((p, idx) => {
    if (p.status === 'BUST' && gameState.phase !== 'reveal') {
      if (idx === mySeatIndex) {
        gui_set_player_cards("blinded", "blinded", idx, false);
      } else {
        gui_set_player_cards("", "", idx, false);
      }
    }
  });

  // Noms, bankrolls & mises
  gameState.players.forEach((p, seatIdx) => {
    const isInactive = p?.inactive || (Number.isInteger(activeSeats) && seatIdx >= activeSeats);
    if (isInactive) {
      gui_set_player_name('', seatIdx);
      gui_set_bankroll('', seatIdx);
      gui_set_bet('', seatIdx);
      return;
    }

    const isMe = p.id === mySocketId;
    const isWaiting = p?.status === 'WAIT';
    const isBreakWaiting = isWaiting && Boolean(p?.isBreak);
    const isJoinWaiting = isWaiting && !isBreakWaiting && Boolean(p?.id);
    let displayName;
  
    if (p.status === 'BUST') {
      displayName = 'BUSTED';
    } else if (isWaiting) {
      displayName = isMe ? 'YOU' : `P${p.seat + 1}`;
    } else if (isMe) {
      displayName = 'YOU';
    } else {
      displayName = `P${p.seat + 1}`; // gÃƒÂ©nÃƒÂ©rique
    }
  
    // Ã¢â€ Â ici on passe seatIdx, pas i
    gui_set_player_name(gameState.demo ? p.label : displayName, seatIdx);
    const displayStack = (p.status === 'BUST')
      ? 0
      : ((p.bankroll || 0) + (p.subtotal_bet || 0));
    gui_set_bankroll(displayStack, seatIdx);

    const isBottomSeat = seatIdx >= 5 && seatIdx <= 9;
    const formatBetAction = (label, amount) => {
      const safeAmount = Number(amount) || 0;
      if (!safeAmount) return label;
      const amountText = `(${safeAmount})`;
      return isBottomSeat ? `${amountText}\n${label}` : `${label}\n${amountText}`;
    };

    let betText = "";
    if      (isJoinWaiting)        betText = "JOIN";
    else if (isBreakWaiting)       betText = "BREAK";
    else if (isWaiting)            betText = (p.subtotal_bet > 0) ? `${p.subtotal_bet}` : "";
    else if (gameState.phase === 'reveal') {
      if (p.status === "WINNER") betText = "";
      else if (p.revealStatus === "hide") betText = "HIDE";
      else if (p.revealStatus === "show") betText = "SHOW";
      else if (p.status === "FOLD")  betText = "DROP";
      else betText = "";
    }
    else {
      if (p.status === "WINNER") betText = "";
      else if (p.revealStatus === "hide") betText = "HIDE";
      else if (p.revealStatus === "show") betText = "SHOW";
      else if (p.status === "FOLD")  betText = "DROP";
      else if (p.status === "CHECK") betText = "CHECK";
      else if (p.status === "CALL")  betText = formatBetAction("CALL", p.subtotal_bet);
      else if (p.status === "RAISE") betText = formatBetAction("+", p.subtotal_bet);
      else if (p.status === "ALLIN") betText = '';
      else if (p.subtotal_bet > 0)   betText = `${p.subtotal_bet}`;
    }

    gui_set_bet(betText, seatIdx);
    // Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// DÃƒÂ©clenchement REVEAL cÃƒÂ´tÃƒÂ© serveur si ALL-IN est couvert
// (un joueur ALL-IN et au moins un autre a CALL, en gardant des jetons)
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
if (!clientRequestedReveal) {
  const players = gameState.players || [];
  const allInIdx = players.findIndex(p =>
    p && (p.status === "ALLIN" || (p.bankroll|0) === 0)
  );

  if (allInIdx >= 0) {
    const currentBet = (gameState.current_bet || 0);

    // appelant qui "couvre" = a fait CALL au niveau du current_bet ET possÃƒÂ¨de encore des jetons (pas all-in)
    const hasCoveringCaller = players.some((p, idx) =>
      idx !== allInIdx &&
      p &&
      p.status === "CALL" &&
      (p.subtotal_bet || 0) >= currentBet &&    // s'est alignÃƒÂ©
      (p.bankroll || 0) > 0                     // et il reste du stack
    );

    if (hasCoveringCaller && window.socket) {
      clientRequestedReveal = true;
      socket.emit("clientRequestReveal", {
        reason: "allin_covered",
        table:  _tableID,
        match2: _match2ID
      });
      // Optionnel: log visible
      console.log("[client] clientRequestReveal Ã¢â€ â€™ allin_covered", { currentBet, allInIdx });
    }
  }
}
  });

  // Pot (affiche uniquement le pot "central", sans les mises visibles sur les siÃƒÂ¨ges)
  const subtotalSum = Array.isArray(gameState.players)
    ? gameState.players.reduce((acc, pl) => acc + (pl?.subtotal_bet || 0), 0)
    : 0;
  const potDisplay = Math.max(0, (gameState.pot || 0) - subtotalSum);
  gui_write_basic_general(potDisplay);

  // Board
  const ids = ["flop1","flop2","flop3","turn","river"];
  ids.forEach(id => {
    const e = document.getElementById(id);
    if (e) e.style.visibility = "visible";
  });
// === Board (on garde ta logique, on ajoute un flip) ===
// === Board (flip fort + stagger sur le flop) ===
// === Board (flip plus lent et cascade plus marquÃƒÂ©e) ===
// === Board (dos visibles en prÃƒÂ©flop Ã¢â€ â€™ flip vers faces selon la phase) ===
// === Board : dos en prÃƒÂ©flop, flip vers faces par phase ===
const phase = gameState.phase;
const boardBacksBlockedByTornado = Date.now() < handTornadoBoardBacksBlockedUntil;
const forceImmediateBoardRestore = reloadRestorePending || justReconnected;
const visibleBoardCount = (phase === "flop") ? 3
  : (phase === "turn") ? 4
  : (phase === "river" || phase === "reveal") ? 5
  : 0;

// Si fin de partie, on force les 5 dos (cartes bloquÃƒÂ©es)
if (endStateLocked) {
  const lockedBoard = lockedEndStateSnapshot?.board;
  if (Array.isArray(lockedBoard) && lockedBoard.some(Boolean)) {
    if (!boardBacksBlockedByTornado) setupBoardBacks();
    for (let i = 0; i < 5; i += 1) {
      if (lockedBoard[i]) {
        setBoardFace(i, lockedBoard[i], false, 0, 0);
      }
    }
  } else {
    if (!boardBacksBlockedByTornado) setupBoardBacks();
  }
} else {
  // En prÃƒÂ©flop / waiting Ã¢â€ â€™ toujours 5 dos visibles
  if (phase === "preflop" || phase === "waiting") {
    setupBoardBacks();
  }

  // FLOP (cascade lente 0 / 300 / 600 ms)
  if (["flop","turn","river","reveal"].includes(phase)) {
    setBoardFace(0, gameState.board[0], !forceImmediateBoardRestore, forceImmediateBoardRestore ? 0 : 0, forceImmediateBoardRestore ? 0 : 1600);
    setBoardFace(1, gameState.board[1], !forceImmediateBoardRestore, forceImmediateBoardRestore ? 0 : 300, forceImmediateBoardRestore ? 0 : 1600);
    setBoardFace(2, gameState.board[2], !forceImmediateBoardRestore, forceImmediateBoardRestore ? 0 : 600, forceImmediateBoardRestore ? 0 : 1600);
  }
  // TURN
  if (["turn","river","reveal"].includes(phase)) {
    setBoardFace(3, gameState.board[3], !forceImmediateBoardRestore, 0, forceImmediateBoardRestore ? 0 : 1600);
  }
  // RIVER
  if (["river","reveal"].includes(phase)) {
    setBoardFace(4, gameState.board[4], !forceImmediateBoardRestore, 0, forceImmediateBoardRestore ? 0 : 1600);
  }

  // Assure un dos visible pour les cartes non encore dÃƒÂ©voilÃƒÂ©es
  for (let i = 0; i < 5; i++) {
    if (i >= visibleBoardCount) {
      paintBoardBack(i);
    }
  }
}

  // Turn indicator
  updateTurnIndicator(gameState);

  const canShowTurnHighlight = shouldShowTurnHighlight(gameState);

  // Highlight actif Ã¢â€ â€™ on ajoute/enlÃƒÂ¨ve une classe, pas de style inline
const activeIdx = gameState.current_bettor_index;
gameState.players.forEach((p, i) => {
// dans ta boucle d'update pour chaque siÃƒÂ¨ge i
const seatEl = document.getElementById('seat' + i);
if (!seatEl) return;
const isInactive = p?.inactive || (Number.isInteger(activeSeats) && i >= activeSeats);
if (isInactive) {
  seatEl.classList.remove('is-allin-bg', 'turn');
  return;
}
seatEl.classList.toggle('is-allin-bg', p.status === 'ALLIN');
  const isActive = (
    canShowTurnHighlight &&
    !gameOverFreezeActive &&
    !endStateLocked &&
    i === activeIdx &&
    p.status !== 'BUST' &&
    p.status !== 'FOLD' &&
    p.status !== 'WAIT' &&
    p.status !== 'ALLIN'
  );
  seatEl.classList.toggle('turn', isActive);

  // On nettoie toute ancienne coloration inline sur le libellÃƒÂ©
  const nameEl = seatEl.querySelector('.player-name');
  if (nameEl) { nameEl.style.backgroundColor = ''; nameEl.style.color = ''; nameEl.style.boxShadow = ''; }
});

// Couleurs selon statut Ã¢â€ â€™ classes (pas de style inline)
gameState.players.forEach((p, i) => {
  const seatEl = document.getElementById('seat' + i);
  if (!seatEl) return;
  const isInactive = p?.inactive || (Number.isInteger(activeSeats) && i >= activeSeats);
  const isShownAtReveal = (
    gameState.phase === 'reveal' &&
    (
      p.revealStatus === 'show' ||
      (
        p.status !== 'FOLD' &&
        p.revealStatus !== 'hide' &&
        p.carda &&
        p.cardb
      )
    )
  );
  if (isInactive) {
    seatEl.classList.remove('status-fold', 'status-bust', 'status-winner');
    return;
  }
  seatEl.classList.remove('status-fold', 'status-bust', 'status-winner');
  if (p.status === 'FOLD' && !isShownAtReveal)  seatEl.classList.add('status-fold');
  if (p.status === 'BUST')  seatEl.classList.add('status-bust');
  if (p.status === 'WINNER')seatEl.classList.add('status-winner');
});

  // Couleurs selon statut
// --- Turn indicator dÃƒÂ©jÃƒÂ  OK (classe .turn) ---

// --- Statuts en classes (pas de style inline) ---
gameState.players.forEach((p, i) => {
  const seatEl = document.getElementById('seat' + i);
  if (!seatEl) return;
  const isInactive = p?.inactive || (Number.isInteger(activeSeats) && i >= activeSeats);
  const isShownAtReveal = (
    gameState.phase === 'reveal' &&
    (
      p.revealStatus === 'show' ||
      (
        p.status !== 'FOLD' &&
        p.revealStatus !== 'hide' &&
        p.carda &&
        p.cardb
      )
    )
  );
  if (isInactive) {
    seatEl.classList.remove('turn', 'status-fold','status-bust','status-winner');
    return;
  }

  // tour actif seulement si pas BUST/FOLD
  const isActive = (
    canShowTurnHighlight &&
    !gameOverFreezeActive &&
    !endStateLocked &&
    i === gameState.current_bettor_index &&
    p.status !== 'BUST' &&
    p.status !== 'FOLD' &&
    p.status !== 'WAIT' &&
    p.status !== 'ALLIN'
  );
  seatEl.classList.toggle('turn', isActive);

  // reset classes & inline hÃƒÂ©ritÃƒÂ©s
  seatEl.classList.remove('status-fold','status-bust','status-winner');
  const nameEl = seatEl.querySelector('.player-name');
  if (nameEl) { nameEl.style.background = ''; nameEl.style.color = ''; nameEl.style.boxShadow = ''; }

  // applique la classe correspondant au statut
  if (p.status === 'FOLD' && !isShownAtReveal)   seatEl.classList.add('status-fold');
  if (p.status === 'BUST')   seatEl.classList.add('status-bust');
  if (p.status === 'WINNER') seatEl.classList.add('status-winner');
});

  // Fold/Check pour vous
  const myIdx    = gameState.players.findIndex(p=>p.id===mySocketId);
  const mePlayer = gameState.players[myIdx] || {};
const bettorIdx = Number(gameState.current_bettor_index);
const isMyTurn = (
  Number.isInteger(myIdx) &&
  Number.isInteger(bettorIdx) &&
  myIdx === bettorIdx &&
  mePlayer.status !== 'BUST' &&
  mePlayer.status !== 'ALLIN'
);
  if (isMyTurn) {
    const callLabel = '';
    gui_setup_fold_call_click(
      `<font color="red"><u>F</u>old</font>`,
      callLabel,
      human_fold, human_check_call
    );
  } else {
    gui_hide_fold_call_click();
  }

  // Raise
  if (isMyTurn) enableRaiseButton();
  else           disableRaiseButton();

  // Reveal final
  if (phase === 'reveal') {
    const revealFreezeSnap = buildFreezeSnapshotFromState(gameState);
    if (revealFreezeSnap?.players?.length) {
      lastCompletedRevealSnapshot = revealFreezeSnap;
    }
    const isHyperRevealMode = String(gameMode || '').toLowerCase() === 'hyper';
    let lockedWinnerOnlySeat = null;
    if (endStateLocked) {
      if (!Number.isInteger(lockedFinalWinnerSeat)) {
        lockFinalWinnerSeatFromState(gameState);
      }
      if (Number.isInteger(lockedFinalWinnerSeat)) {
        lockedWinnerOnlySeat = lockedFinalWinnerSeat;
      } else if (restoreFinalWinnerOnlyView) {
        lockedWinnerOnlySeat = resolveFinalWinnerSeatForView(gameState);
        if (Number.isInteger(lockedWinnerOnlySeat) && lockedWinnerOnlySeat >= 0) {
          lockedFinalWinnerSeat = lockedWinnerOnlySeat;
        }
      }
      enforceWinnerOnlyCardsInFinalView(gameState);
    }
    if (String(gameMode || '').toLowerCase() === 'hyper' && hyperRevealHoldCards && Date.now() < hyperRevealHoldUntil) {
      Object.keys(hyperRevealHoldCards).forEach((seatKey) => {
        const seatIdx = Number(seatKey);
        const cards = hyperRevealHoldCards[seatKey];
        if (!Number.isInteger(seatIdx) || !cards?.carda || !cards?.cardb) return;
        if (Number.isInteger(lockedWinnerOnlySeat) && seatIdx !== lockedWinnerOnlySeat) return;
        gui_set_player_cards(cards.carda, cards.cardb, seatIdx, false);
        const seatEl = document.getElementById('seat' + seatIdx);
        seatEl?.querySelectorAll('.holecards .card').forEach(card => card.classList.add('visible'));
      });
    }

    if (revealShownSeats.size === 0) {
      document.querySelectorAll('.seat').forEach(seatEl => {
        seatEl.classList.remove('winning-hand','losing-hand');
      });
    }

    window.IMDCXDemo?.renderRevealCards(gameState);
    gameState.players.forEach((p, i) => {
      if (gameState.demo || p?.inactive || (Number.isInteger(activeSeats) && i >= activeSeats)) return;
      if (Number.isInteger(lockedWinnerOnlySeat) && i !== lockedWinnerOnlySeat) return;
      const isMe = p && p.id === mySocketId;
      const canShow = (p.revealStatus === 'show') || (
        isMe &&
        !isLiveBustedSpectator(gameState) &&
        p.status !== 'FOLD' &&
        p.carda &&
        p.cardb
      );
      if (!canShow) return;
      if (revealShownSeats.has(i)) return;
      const seat = document.getElementById('seat' + i);
      if (!seat) return;
      const c1 = seat.querySelector('.holecard1');
      const c2 = seat.querySelector('.holecard2');
      if (c1 && c2) {
        flipCardsSimultaneously(c1, c2, p.carda, p.cardb);
        if (!window.IMDCXMotion) setTimeout(() => gui_set_player_cards(p.carda, p.cardb, i, false), 600);
      }
      if (p?.carda && p?.cardb) {
        revealDisplayedCards[i] = { carda: p.carda, cardb: p.cardb };
      }
      revealShownSeats.add(i);
    });

    if (isHyperRevealMode && gameState.revealSeqDone && !Number.isFinite(revealSeatShowStartedAt)) {
      const showableSeats = [];
      gameState.players.forEach((p, i) => {
        if (p?.inactive || (Number.isInteger(activeSeats) && i >= activeSeats)) return;
        if (Number.isInteger(lockedWinnerOnlySeat) && i !== lockedWinnerOnlySeat) return;
        const isMe = p && p.id === mySocketId;
        const canShow = (p.revealStatus === 'show') || (
          isMe &&
          !isLiveBustedSpectator(gameState) &&
          p.status !== 'FOLD' &&
          p.carda &&
          p.cardb
        );
        if (canShow) showableSeats.push(i);
      });
      if (showableSeats.length > 0 && showableSeats.every(i => revealShownSeats.has(i))) {
        revealSeatShowStartedAt = Date.now();
      }
    }

    if (gameState.revealSeqDone && !revealedAllSeats) {
      const localRevealFlowToken = ++revealFlowToken;
      const nowTs = Date.now();
      const winnerRemainingMs = Number.isFinite(gameState.revealWinnerDeadline)
        ? Math.max(0, gameState.revealWinnerDeadline - nowTs)
        : 10000;
      const isHyperReveal = String(gameMode || '').toLowerCase() === 'hyper';
      if (isHyperReveal && !Number.isFinite(revealSeatShowStartedAt)) return;
      const SEAT_SHOW_MS = isHyperReveal
        ? 9000
        : 5000;
      const REVEAL_NEON_LINGER = 5000;
      const WINNER_MESSAGE_TO_END_MS = isHyperReveal ? 900 : 500;
      const seatShowBaseTs = isHyperReveal
        ? revealSeatShowStartedAt
        : Date.now();
      const seatShowRemainingMs = Math.max(0, (seatShowBaseTs + SEAT_SHOW_MS) - Date.now());
      if (isHyperReveal) {
        hyperRevealHoldUntil = seatShowBaseTs + SEAT_SHOW_MS;
        const holdFromDisplayed = Object.keys(revealDisplayedCards || {}).length > 0;
        if (holdFromDisplayed) {
          hyperRevealHoldCards = { ...revealDisplayedCards };
        } else {
          hyperRevealHoldCards = {};
          (gameState.players || []).forEach((p, i) => {
            if (!p || p.inactive || !p.carda || !p.cardb) return;
            if (p.status === 'WAIT') return;
            if (Number.isInteger(lockedWinnerOnlySeat) && i !== lockedWinnerOnlySeat) return;
            if (!Number.isInteger(lockedWinnerOnlySeat)) {
              const isMe = p && p.id === mySocketId;
              if (p.revealStatus !== 'show' && !(
                isMe &&
                !isLiveBustedSpectator(gameState) &&
                p.status !== 'FOLD'
              )) return;
            }
            hyperRevealHoldCards[i] = { carda: p.carda, cardb: p.cardb };
          });
        }
        Object.keys(hyperRevealHoldCards).forEach((seatKey) => {
          const seatIdx = Number(seatKey);
          const cards = hyperRevealHoldCards[seatKey];
          if (!Number.isInteger(seatIdx) || !cards?.carda || !cards?.cardb) return;
          if (Number.isInteger(lockedWinnerOnlySeat) && seatIdx !== lockedWinnerOnlySeat) return;
          gui_set_player_cards(cards.carda, cards.cardb, seatIdx, false);
          const seatEl = document.getElementById('seat' + seatIdx);
          seatEl?.querySelectorAll('.holecards .card').forEach(card => card.classList.add('visible'));
        });
      } else {
        hyperRevealHoldUntil = 0;
        hyperRevealHoldCards = null;
      }

      setTimeout(() => {
        if (localRevealFlowToken !== revealFlowToken) return;
        if (endStateLocked) return;
        const revealState = (currentGameState && currentGameState.phase === 'reveal')
          ? currentGameState
          : gameState;
        if (!revealState || !Array.isArray(revealState.players)) return;

        const winnerIdx = [];
        revealState.players.forEach((p, i) => {
          if (p.status === 'WINNER') winnerIdx.push(i);
        });
        if (!winnerIdx.length) return;
        const completedRevealSnap = buildFreezeSnapshotFromState(revealState);
        if (completedRevealSnap?.players?.length) {
          lastCompletedRevealSnapshot = completedRevealSnap;
        }

        const w = revealState.players[winnerIdx[0]];
        const survivors = revealState.players.filter(p => p && !p.inactive && p.status !== 'BUST' && p.status !== 'WAIT');
        const isFinalWinner = survivors.length === 1;
        const winnerLabel = buildRevealWinnerLabel(revealState, winnerIdx) || `Winner : ${winnerIdx.map(i => revealSeatLabel(revealState.players[i], i)).join(', ')}`;

        // For a regular hand result (not final game winner), hide all hole cards on winner announcement.
        // Only keep seat result highlights (winner/loser).
        if (!isFinalWinner) {
          // Keep my own 2 revealed cards visible until the reveal -> preflop tornado transition.
          resetAllBacks(mySeatIndex, revealState);
          if (!revealState.demo) {
            revealDisplayedCards = {};
            revealShownSeats.clear();
          }
        } else {
          // Final/frozen flow: keep winner-only cards if local player is busted spectator.
          const meRevealPlayer = revealState.players?.[mySeatIndex];
          const canForceWinnerCardsForLocalView = Boolean(
            meRevealPlayer && meRevealPlayer.status === 'BUST'
          );
          if (canForceWinnerCardsForLocalView) {
            resetAllBacks(mySeatIndex);
            winnerIdx.forEach((i) => {
              const p = revealState.players[i];
              if (!p?.carda || !p?.cardb) return;
              gui_set_player_cards(p.carda, p.cardb, i, false);
              const seatEl = document.getElementById('seat' + i);
              seatEl?.querySelectorAll('.holecards .card').forEach(card => card.classList.add('visible'));
            });
          }
        }

        // Keep my busted holecards visible during the reveal -> game over transition.
        const meReveal = revealState.players?.[mySeatIndex];
        if (isFinalWinner && !suppressFinalReplayAfterClose && meReveal && meReveal.status !== 'WAIT') {
          const myCards = resolveFreezeSeatCards(revealState, mySeatIndex);
          const mySeatEl = document.getElementById('seat' + mySeatIndex);
          const myC1 = mySeatEl?.querySelector('.holecards .holecard1');
          const myC2 = mySeatEl?.querySelector('.holecards .holecard2');
          if (myCards?.carda && myCards?.cardb && myC1 && myC2) {
            internal_setCard(myC1, myCards.carda, false, false);
            internal_setCard(myC2, myCards.cardb, false, false);
            [myC1, myC2].forEach((card) => {
              card.classList.remove('deal-flip');
              card.classList.add('revealed', 'visible');
            });
          }
        }

        // 3) Message winner au centre.
        showWinnerMessage(winnerLabel, isFinalWinner);
        if (!isFinalWinner) {
          triggerRevealWinnerFireworks(winnerIdx, { isFinal: false });
        } else if (winnerIdx.length === 1) {
          triggerRevealWinnerFireworks(winnerIdx, { isFinal: true });
        }
        if (winnerIdx.length === 1) {
          setTimeout(() => {
            if (localRevealFlowToken !== revealFlowToken) return;
            if (endStateLocked) return;
            triggerPotScoopToSeat(winnerIdx[0]);
          }, 180);
        }

        setTimeout(() => {
          if (localRevealFlowToken !== revealFlowToken) return;
          if (endStateLocked) return;
          const liveState = currentGameState || revealState;
          // Si la main suivante a dÃƒÂ©jÃƒÂ  dÃƒÂ©marrÃƒÂ©, on ne continue pas sauf en ÃƒÂ©tat final (1 survivant).
          if (!isFinalWinner && liveState.phase !== 'reveal') return;

          if (isFinalWinner) {
            lockFinalWinnerSeatFromState(revealState);
          } else {
            clearLockedFinalWinnerSeatCards();
          }

          winnerIdx.forEach(i => {
            document.getElementById('seat' + i)?.classList.add('winning-hand');
            if (isFinalWinner) {
              document.getElementById('seat' + i)?.classList.add('final-winner');
            }
          });

          revealState.players.forEach((p, i) => {
            if (p.inShowdown && !winnerIdx.includes(i)) {
              document.getElementById('seat' + i)?.classList.add('losing-hand');
            }
          });

          window._neonLingerUntil = Date.now() + REVEAL_NEON_LINGER;

          if (isFinalWinner) {
            if (w?.id === mySocketId) showVictory("YOU");
            else if (!suppressFinalReplayAfterClose) showLosing(true);
          }
        }, WINNER_MESSAGE_TO_END_MS);
      }, seatShowRemainingMs);

      revealedAllSeats = true;
    }

    const me = currentGameState.players.find(p => p && p.id === mySocketId);
    if (me && me.status === 'BUST' && !suppressFinalReplayAfterClose) {
      const isHyperRevealHold = (
        String(gameMode || '').toLowerCase() === 'hyper' &&
        Date.now() < hyperRevealHoldUntil
      );
      if (!isHyperRevealHold) {
        const myCards = resolveFreezeSeatCards(currentGameState, mySeatIndex);
        const mySeatEl = document.getElementById('seat' + mySeatIndex);
        const myC1 = mySeatEl?.querySelector('.holecards .holecard1');
        const myC2 = mySeatEl?.querySelector('.holecards .holecard2');
        if (myCards?.carda && myCards?.cardb && myC1 && myC2) {
          internal_setCard(myC1, myCards.carda, false, false);
          internal_setCard(myC2, myCards.cardb, false, false);
          [myC1, myC2].forEach((card) => {
            card.classList.remove('deal-flip');
            card.classList.add('revealed', 'visible');
          });
        }
      }
      if (centerMessageMode === 'winner') showCenterMessage('', null);
    }
    if (isLiveBustedSpectator(currentGameState)) {
      clearMySeatHoleCardsForSpectator();
    }
  } else {
    hideRevealButton();
    if (isLiveBustedSpectator(currentGameState)) {
      clearMySeatHoleCardsForSpectator();
    }
  }

// Au passage reveal -> preflop, securise l'etat final (win/lose) si la main suivante part trop vite.
if (lastPhase === 'reveal' && phase === 'preflop') {
  if (!suppressFinalReplayAfterClose) {
    const survivors = (gameState.players || []).filter(p => p && p.status !== 'BUST' && !p.inactive);
    if (!endStateLocked && survivors.length === 1) {
      const winner = survivors[0];
      if (winner?.id === mySocketId) showVictory("YOU");
      else showLosing(true);
    } else {
      const me = gameState.players.find(p => p.id === mySocketId);
      if (me && me.status === 'BUST') {
        showLosing(true);
      }
    }
  }
}

// Reset prÃƒÂ©flop : on nettoie les halos et le message
  // Reset prÃƒÂ©flop : on nettoie les halos et le message
  const isEnteringPreflop = (phase === 'preflop' && lastPhase !== 'preflop');
  if (isEnteringPreflop) {
    revealFlowToken += 1;
    lastCompletedRevealSnapshot = null;
    clientRequestedReveal = false;
    revealedAllSeats = false;
    hyperRevealHoldUntil = 0;
    hyperRevealHoldCards = null;
    revealDisplayedCards = {};
    if (!endStateLocked) clearLockedFinalWinnerSeatCards();

    document.querySelectorAll('.seat').forEach(seatEl => {
      seatEl.classList.remove('winning-hand', 'losing-hand');
      if (!endStateLocked) seatEl.classList.remove('final-winner');
    });
    // New hand hard reset: no leftover reveal faces on any seat.
    gameState.players.forEach((p, i) => {
      const isInactive = p?.inactive || (Number.isInteger(activeSeats) && i >= activeSeats);
      if (isInactive) return;
      if (p.status === 'BUST') {
        if (i === mySeatIndex) gui_set_player_cards('blinded', 'blinded', i, false);
        else gui_set_player_cards('', '', i, false);
        return;
      }
      if (p.status === 'WAIT') {
        gui_set_player_cards('', '', i, false);
        return;
      }
      gui_set_player_cards('blinded', 'blinded', i, false);
      const seatEl = document.getElementById('seat' + i);
      seatEl?.querySelectorAll('.holecards .card').forEach((card) => {
        card.classList.remove('deal-flip', 'revealed');
        card.classList.add('visible');
      });
    });
    if (isLiveBustedSpectator(gameState)) {
      clearMySeatHoleCardsForSpectator();
    }

    if (!endStateLocked) clearWinnerMessage();
  }

  if (endStateLocked) {
    lockFinalWinnerSeatFromState(gameState);
    renderLockedFinalWinnerSeatCards();
    enforceWinnerOnlyCardsInFinalView(gameState);
    applyLateJoinFinishedCardsMask(gameState);
    scheduleFinalSeatCardLock();
  }
} // Ã¢â€ Â fin de updateInterface

/** Affiche Ã¢â‚¬Å“ItÃ¢â‚¬â„¢s Your TurnÃ¢â‚¬Â en prÃƒÂ©flop */
function updateTurnIndicator(gameState) {
  if (gameOverFreezeActive) {
    stopTurnPulse();
    document.querySelectorAll('.seat.turn').forEach((seatEl) => seatEl.classList.remove('turn'));
    return;
  }
  if (centerMessageMode === 'winner' || centerMessageMode === 'winner-final' || centerMessageMode === 'lose' || endStateLocked) return;

  if (!shouldShowTurnHighlight(gameState)) {
    stopTurnPulse();
    showCenterMessage('', null);
    return;
  }

  const me = gameState.players.findIndex(p => p.id === mySocketId);
  const mePlayer = gameState.players[me];
  const canAct = (
    me >= 0 &&
    me === gameState.current_bettor_index &&
    mePlayer &&
    mePlayer.status !== 'BUST' &&
    mePlayer.status !== 'FOLD' &&
    mePlayer.status !== 'ALLIN' &&
    (mePlayer.bankroll || 0) > (mePlayer.subtotal_bet || 0)
  );

  if (canAct) {
    startTurnPulse();
  } else {
    stopTurnPulse();
    showCenterMessage('', null);
  }
}

function shouldShowTurnHighlight(gameState) {
  if (!gameState || !Array.isArray(gameState.players)) return false;
  const actionPhases = ["preflop", "flop", "turn", "river"];
  if (!actionPhases.includes(gameState.phase)) return false;

  const activeIdx = Number(gameState.current_bettor_index);
  if (!Number.isInteger(activeIdx) || activeIdx < 0 || activeIdx >= gameState.players.length) return false;

  const activePlayer = gameState.players[activeIdx];
  if (!activePlayer) return false;
  const status = String(activePlayer.status || '').toUpperCase();
  if (status === 'WAIT' || status === 'BUST' || status === 'FOLD' || status === 'ALLIN') return false;

  const turnStartTime = Number(gameState.turnStartTime);
  if (gameState.demo) return !gameState.demoRunningOut && !gameState.gameFinished;
  const turnDuration = Number(gameState.turnDuration);
  if (!Number.isFinite(turnStartTime) || !Number.isFinite(turnDuration) || turnDuration <= 0) return false;

  return true;
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
//  Raise modal & calc
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function getMyCreditsFromState() {
  if (!currentGameState || !Array.isArray(currentGameState.players)) return null;
  const me = currentGameState.players.find(p => p && p.id === mySocketId);
  const credits = me?.credits;
  return Number.isFinite(credits) ? credits : null;
}
function getCalcCreditsDisplayValue() {
  if (!currentGameState || !Array.isArray(currentGameState.players)) return null;
  const me = currentGameState.players.find(p => p && p.id === mySocketId);
  if (!me) return null;
  const timeCredits = Number.isFinite(me.timeCredits) ? Math.max(0, Math.floor(me.timeCredits)) : 0;
  const credits = Number.isFinite(me.credits) ? Math.max(0, Math.floor(me.credits)) : 0;
  if (timeCredits > 0 && !add30ClassicConfirmed) return timeCredits;
  if (timeCredits <= 0 && add30ClassicConfirmed) return credits;
  return timeCredits;
}
function refreshCreditsDisplay() {
  const el = document.getElementById('credits-display');
  if (!el) return;
  const credits = getCalcCreditsDisplayValue();
  el.textContent = credits != null ? String(credits) : '--';
}

function getMyTimeCreditsFromState() {
  if (!currentGameState || !Array.isArray(currentGameState.players)) return 0;
  const me = currentGameState.players.find(p => p && p.id === mySocketId);
  const tc = me?.timeCredits;
  return Number.isFinite(tc) ? Math.max(0, Math.floor(tc)) : 0;
}

function showAdd30CreditsMessage() {
  if (!currentGameState || !Array.isArray(currentGameState.players)) return;
  if (String(currentGameState.level || '').trim().toUpperCase() === 'Q0') {
    return true;
  }
  const me = currentGameState.players.find(p => p && p.id === mySocketId);
  if (!me) return;

  const timeCredits = Number.isFinite(me.timeCredits) ? Math.max(0, Math.floor(me.timeCredits)) : 0;
  const credits = Number.isFinite(me.credits) ? Math.max(0, Math.floor(me.credits)) : 0;

  if (timeCredits > 0) {
    add30NoTimeWarned = false;
    const remaining = Math.max(0, timeCredits - 1);
    if (remaining === 0) {
      showErrorToast(
        "Vous avez utilise tous vos credits TIME. La prochaine fois, un credit classique sera utilise.",
        5200
      );
    } else {
      showErrorToast(`Il vous reste ${remaining} credits TIME.`);
    }
    me.timeCredits = remaining;
    refreshCreditsDisplay();
    return true;
  }

  if (credits <= 0) {
    showErrorToast("Vous avez epuise vos credits TIME et credits classiques.", 4200);
    return false;
  }

  if (!add30NoTimeWarned) {
    showErrorToast("Vous n'avez plus de credit TIME. +30s va consommer un credit classique de partie.");
    add30NoTimeWarned = true;
  } else {
    const remaining = Math.max(0, credits - 1);
    showErrorToast(`Il vous reste ${remaining} credits classiques.`);
  }
  if (credits > 0) me.credits = Math.max(0, credits - 1);
  refreshCreditsDisplay();
  return true;
}

let calcPrevBetText = null;
let calcDefaultValue = 0;
let calcDigitOverwrite = false;
let calcBaseBet = 0;
let calcDragState = null;
let calcStatsOpen = false;
let calcFitCleanup = null;
const CALC_OPACITY_STORAGE_KEY = 'calcWindowOpacity';

function getCalcPosKey() {
  if (_match2ID) return `calcPos_match2_${_match2ID}`;
  if (_tableID) return `calcPos_table_${_tableID}`;
  return 'calcPos_unknown';
}

function getSavedCalcOpacity() {
  try {
    const raw = localStorage.getItem(CALC_OPACITY_STORAGE_KEY);
    const val = Number(raw);
    if (!Number.isFinite(val)) return 1;
    return Math.min(1, Math.max(0.35, val));
  } catch (e) {
    return 1;
  }
}

function applyCalcWindowOpacity(win, opacity){
  if (!win) return;
  const next = Math.min(1, Math.max(0.35, Number(opacity) || 1));
  win.style.opacity = String(next);
  win.dataset.calcOpacity = String(next);
}

function bindCalcOpacityControls(win){
  if (!win) return;
  const btn = win.querySelector('#calc-opacity-btn');
  const panel = win.querySelector('#calc-opacity-panel');
  const range = win.querySelector('#calc-opacity-range');
  const value = win.querySelector('#calc-opacity-value');
  if (!btn || !panel || !range || !value) return;
  if (btn.dataset.bound === '1') return;
  btn.dataset.bound = '1';

  const syncValue = (opacity) => {
    const pct = Math.round(opacity * 100);
    range.value = String(pct);
    value.textContent = `${pct}%`;
  };

  // Always open fully visible, then let the player lower opacity if needed.
  const initialOpacity = 1;
  applyCalcWindowOpacity(win, initialOpacity);
  syncValue(initialOpacity);

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    panel.hidden = !panel.hidden;
    btn.setAttribute('aria-expanded', panel.hidden ? 'false' : 'true');
  });

  range.addEventListener('input', () => {
    const opacity = Number(range.value || 100) / 100;
    applyCalcWindowOpacity(win, opacity);
    syncValue(opacity);
    try {
      localStorage.setItem(CALC_OPACITY_STORAGE_KEY, String(opacity));
    } catch (e) {}
  });
}

function clampCalcPos(x, y, rect) {
  const maxX = Math.max(0, window.innerWidth - rect.width);
  const maxY = Math.max(0, window.innerHeight - rect.height);
  return {
    x: Math.min(Math.max(0, x), maxX),
    y: Math.min(Math.max(0, y), maxY)
  };
}

function restoreCalcPosition(win) {
  if (!win) return;
  try {
    const raw = localStorage.getItem(getCalcPosKey());
    if (!raw) return;
    const pos = JSON.parse(raw);
    if (!pos || !Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    const rect = win.getBoundingClientRect();
    const clamped = clampCalcPos(pos.x, pos.y, rect);
    win.style.position = 'fixed';
    win.style.left = `${clamped.x}px`;
    win.style.top = `${clamped.y}px`;
    win.style.margin = '0';
    win.style.transform = 'none';
  } catch (e) {}
}

function saveCalcPosition(x, y) {
  try {
    localStorage.setItem(getCalcPosKey(), JSON.stringify({ x, y }));
  } catch (e) {}
}

function prepareCalcWindowForManualMove(win){
  if (!win) return 1;
  const rect = win.getBoundingClientRect();
  const rawW = Math.max(1, win.offsetWidth || rect.width || 1);
  const scale = Math.max(0.01, (rect.width || rawW) / rawW);
  win.style.position = 'fixed';
  win.style.margin = '0';
  win.style.left = `${rect.left}px`;
  win.style.top = `${rect.top}px`;
  win.style.transformOrigin = 'top left';
  win.style.transform = (Math.abs(scale - 1) < 0.001) ? 'none' : `scale(${scale})`;
  return scale;
}

function enableCalcDrag(win) {
  if (!win) return;
  const handle = win.querySelector('.raise-head');
  if (!handle) return;

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0 && e.pointerType !== 'touch') return;
    if (e.target && e.target.closest('button,input,.calc-head-actions')) return;
    e.preventDefault();
    const rect = win.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    calcDragState = {
      startX,
      startY,
      offsetX: startX - rect.left,
      offsetY: startY - rect.top
    };
    win.style.position = 'fixed';
    win.style.margin = '0';
    win.style.transform = 'none';
    handle.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e) => {
    if (!calcDragState) return;
    const rect = win.getBoundingClientRect();
    const nextX = e.clientX - calcDragState.offsetX;
    const nextY = e.clientY - calcDragState.offsetY;
    const clamped = clampCalcPos(nextX, nextY, rect);
    win.style.left = `${clamped.x}px`;
    win.style.top = `${clamped.y}px`;
  };

  const onPointerUp = () => {
    if (!calcDragState) return;
    const rect = win.getBoundingClientRect();
    saveCalcPosition(rect.left, rect.top);
    calcDragState = null;
  };

  handle.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
}

function nudgeCalcWindow(win, dx, dy){
  if (!win) return;
  prepareCalcWindowForManualMove(win);
  const rect = win.getBoundingClientRect();
  const curX = rect.left;
  const curY = rect.top;
  const next = clampCalcPos(curX + dx, curY + dy, rect);
  win.style.left = `${next.x}px`;
  win.style.top = `${next.y}px`;
  saveCalcPosition(next.x, next.y);
}

function bindCalcMoveControls(win){
  if (!win) return;
  const root = win.querySelector('.calc-move');
  if (!root) return;
  if (root.dataset.bound === '1') return;
  root.dataset.bound = '1';

  root.querySelectorAll('.calc-move-btn').forEach((btn) => {
    btn.addEventListener('pointerdown', (e) => {
      // Arrow taps should not start joystick drag mode.
      e.stopPropagation();
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const dx = Number(btn.dataset.dx || 0);
      const dy = Number(btn.dataset.dy || 0);
      nudgeCalcWindow(win, dx, dy);
    });
  });

  const setJoyOffset = (x = 0, y = 0) => {
    root.style.setProperty('--joy-x', `${x}px`);
    root.style.setProperty('--joy-y', `${y}px`);
  };

  let drag = null;
  const JOY_RADIUS = 10;

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0 && e.pointerType !== 'touch') return;
    e.preventDefault();
    prepareCalcWindowForManualMove(win);
    drag = { pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
    root.setPointerCapture?.(e.pointerId);
    setJoyOffset(0, 0);
  };

  const onPointerMove = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    e.preventDefault();

    const dx = e.clientX - drag.lastX;
    const dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (Math.abs(dx) > 0 || Math.abs(dy) > 0) nudgeCalcWindow(win, dx, dy);

    const rect = root.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let ox = e.clientX - cx;
    let oy = e.clientY - cy;
    const len = Math.hypot(ox, oy) || 1;
    if (len > JOY_RADIUS) {
      ox = (ox / len) * JOY_RADIUS;
      oy = (oy / len) * JOY_RADIUS;
    }
    setJoyOffset(Math.round(ox), Math.round(oy));
  };

  const endDrag = (e) => {
    if (!drag) return;
    if (e?.pointerId != null && e.pointerId !== drag.pointerId) return;
    const rect = win.getBoundingClientRect();
    saveCalcPosition(rect.left, rect.top);
    drag = null;
    setJoyOffset(0, 0);
  };

  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
}
function getMySubscription(){
  if (!currentGameState || !Array.isArray(currentGameState.players)) return 'standard';
  const me = currentGameState.players.find(p => p && p.id === mySocketId);
  const sub = (me?.subscription || 'standard').toLowerCase();
  const levelRaw = String(currentGameState.level || '').toUpperCase();
  const isLowTier = (levelRaw === 'Q1' || levelRaw === 'Q2');
  if (isLowTier) return 'standard';
  return sub === 'pro' ? 'pro' : 'standard';
}
// Slider is recreated with the modal; bind after render.

function getBigBlindValue(){
  if (!currentGameState) return 0;
  const bb =
    currentGameState.bigBlindAmount ??
    currentGameState.bigBlind ??
    currentGameState.bbAmount ??
    currentGameState.big_blind ??
    currentGameState.minOpen ??
    0;
  return Math.max(0, Math.floor(bb || 0));
}

function getBaseBetValue(){
  const bb = getBigBlindValue();
  const cur = Math.max(0, Math.floor(currentGameState?.current_bet || 0));
  // Use the last bet if any; otherwise fall back to big blind.
  return cur > 0 ? cur : bb;
}

function getDefaultBetValue(){
  const bb = getBigBlindValue();
  const cur = Math.max(0, Math.floor(currentGameState?.current_bet || 0));
  // New rule: if there is a bet, default is double that bet; otherwise BB.
  return cur > 0 ? (cur * 2) : bb;
}

function refreshCalcTimerDisplay() {
  const el = document.getElementById('calc-timer');
  if (!el) return;
  if (!currentGameState || !currentGameState.turnStartTime || !currentGameState.turnDuration) {
    el.textContent = '--';
    return;
  }
  const now = Date.now();
  let remaining = currentGameState.turnDuration - (now - currentGameState.turnStartTime);
  if (remaining < 0) remaining = 0;
  if (remaining > currentGameState.turnDuration) remaining = currentGameState.turnDuration;
  const leftSec = Math.ceil(remaining / 1000);
  el.textContent = String(leftSec);
}

function refreshCalcMathDisplay() {
  const left = document.getElementById('calc-left');
  if (!left) return;
  if (!currentGameState || !Array.isArray(currentGameState.players)) {
    left.textContent = 'STACK --';
    return;
  }
  const me = currentGameState.players.find(p => p && p.id === mySocketId);
  if (!me) {
    left.textContent = 'STACK --';
    return;
  }
  const total = getCalcVal();
  const subtotal = Math.max(0, Math.floor(me.subtotal_bet || 0));
  const delta = Math.max(0, total - subtotal);
  const stack = Math.max(0, Math.floor(me.bankroll || 0));
  const rest = Math.max(0, stack - delta);
  left.textContent = `STACK ${rest}`;
}

function updateCalcSliderBounds(){
  const slider = document.getElementById('calc-slider');
  if (!slider || !currentGameState) return;
  const meIdx = currentGameState.players.findIndex(p => p && p.id === mySocketId);
  const me = meIdx >= 0 ? currentGameState.players[meIdx] : null;
  const subtotal = Math.max(0, Math.floor(me?.subtotal_bet || 0));
  const stack = Math.max(0, Math.floor(me?.bankroll || 0));
  const minVal = Math.max(0, Math.floor(calcDefaultValue || 0));
  const maxVal = Math.max(minVal, Math.floor(subtotal + stack));
  slider.min = String(minVal);
  slider.max = String(maxVal);
  slider.step = "1";
  const cur = getCalcVal();
  const next = Math.min(Math.max(cur, minVal), maxVal);
  slider.value = String(next);
  updateCalcSliderFill(slider);
}

function bindCalcSlider(){
  const slider = document.getElementById('calc-slider');
  if (!slider) return;
  if (slider.dataset.bound === "1") return;
  const onMove = () => setCalcVal(Number(slider.value || 0));
  slider.addEventListener('input', onMove);
  slider.addEventListener('change', onMove);
  slider.dataset.bound = "1";
}

function updateCalcSliderFill(slider){
  if (!slider) return;
  const min = parseFloat(slider.min || "0");
  const max = parseFloat(slider.max || "0");
  const val = parseFloat(slider.value || "0");
  const pct = max > min ? Math.round(((val - min) / (max - min)) * 100) : 0;
  slider.style.backgroundImage =
    `linear-gradient(90deg, var(--popup-accent, #2bffb3) 0%, var(--popup-accent, #2bffb3) ${pct}%, var(--popup-panel, #1b2b45) ${pct}%, var(--popup-panel, #1b2b45) 100%)`;
  slider.style.backgroundBlendMode = 'normal';
}

function updateMySeatBetPreview(amount) {
  if (mySeatIndex == null) return;
  const seatEl = document.getElementById('seat' + mySeatIndex);
  const betEl = seatEl ? seatEl.querySelector('.bet') : null;
  if (!betEl) return;
  if (calcPrevBetText === null) {
    calcPrevBetText = betEl.textContent;
  }
  betEl.textContent = amount > 0 ? String(amount) : '';
}

function restoreMySeatBetPreview() {
  if (calcPrevBetText === null) return;
  const seatEl = document.getElementById('seat' + mySeatIndex);
  const betEl = seatEl ? seatEl.querySelector('.bet') : null;
  if (betEl) betEl.textContent = calcPrevBetText;
  calcPrevBetText = null;
}

function notifyCalculatorOpened() {
  if (!socket || !currentGameState) return;
  if (!['preflop','flop','turn','river'].includes(currentGameState.phase)) return;
  const meIdx = currentGameState.players.findIndex(p => p && p.id === mySocketId);
  if (meIdx !== currentGameState.current_bettor_index) return;
  if (currentGameState.timeFrozen) {
    if (window.currentFrozenSeat === meIdx) {
      socket.emit('requestAdd30');
      applyLocalAdd30(30000);
    }
    return;
  }
  socket.emit('calculatorOpened');
}

function applyLocalAdd30(durationMs = 30000) {
  if (!currentGameState) return;
  currentGameState.timeFrozen = false;
  window.currentFrozenSeat = null;
  clearStoredFrozenSeat();
  if (typeof durationMs === 'number' && durationMs > 0) {
    currentGameState.turnDuration = durationMs;
  }
  currentGameState.turnStartTime = Date.now();
  startClientTimerFromState(currentGameState);
  lastTurnStartTime = currentGameState.turnStartTime;
  lastTurnDuration = currentGameState.turnDuration;
  refreshTimeButtonVisibility();
  refreshAdd30ButtonVisibility();
}
function show_custom_raise(opts = {}) {
  console.log("Raise modal");

  if (!opts.skipNotify) {
    notifyCalculatorOpened();
  }
  setCalcOpenFlag(true);

  const isStandard = getMySubscription() !== 'pro';
  const subClass = isStandard ? 'calc-standard' : 'calc-pro';
  const bigBtnLabel = isStandard ? 'BET' : 'ALL-IN';
  const bigBtnOnclick = isStandard ? 'calcConfirm()' : 'calcAllIn()';
  const statsBtnHtml = isStandard
    ? ''
    : `<button class="calc-btn calc-add30-btn" id="calc-stats-btn" type="button" onclick="calcOpenStats('opponents')">ST</button>`;
  const actionButtonsHtml = `
    <button class="calc-btn half-btn calc-allin-btn" onclick="calcAllIn()">ALL-IN</button>
    <button class="calc-btn half-btn" onclick="calcClear()">CLEAR</button>
  `;
  const html = `
    <div class="raise-window ${subClass}">
      <div class="raise-head">
        <h3 class="raise-title" id="raise-popup-title">PLAYER BOARD</h3>
        <button class="popup-close" type="button" aria-label="Fermer le panneau de mise" onclick="calcClose()">×</button>
        <div class="calc-head-meta">
          <div class="calc-credits">CREDITS: <span id="credits-display">--</span></div>
          <div class="calc-timer">TIME: <span id="calc-timer">--</span></div>
        </div>
        <div class="calc-move" aria-label="Deplacer la calculatrice">
          <div class="calc-joy-base" aria-hidden="true"></div>
          <div class="calc-joy-ring" aria-hidden="true"></div>
          <div class="calc-joy-knob" aria-hidden="true"></div>
          <button class="calc-move-btn up" type="button" data-dx="0" data-dy="-20" aria-label="Haut">▲</button>
          <button class="calc-move-btn right" type="button" data-dx="20" data-dy="0" aria-label="Droite">▶</button>
          <button class="calc-move-btn down" type="button" data-dx="0" data-dy="20" aria-label="Bas">▼</button>
          <button class="calc-move-btn left" type="button" data-dx="-20" data-dy="0" aria-label="Gauche">◀</button>
        </div>
        <div id="calc-notice" class="calc-notice"></div>
        <div class="calc-head-actions">
          <button class="calc-btn calc-add30-btn" id="calc-add30-btn" type="button" onclick="calcAdd30Time()">30</button>
          <button class="calc-btn calc-add30-btn" id="calc-proba-btn" type="button" onclick="calcOpenOdds()">%</button>
          <button class="calc-btn calc-add30-btn" id="calc-opacity-btn" type="button" aria-expanded="false" title="Opacite calculatrice">◐</button>
          ${statsBtnHtml}
        </div>
        <div id="calc-opacity-panel" class="calc-opacity-panel" hidden>
          <label class="calc-opacity-label" for="calc-opacity-range">OPA</label>
          <input id="calc-opacity-range" type="range" min="35" max="100" step="5" value="100" />
          <span id="calc-opacity-value" class="calc-opacity-value">100%</span>
        </div>
      </div>

      <div class="raise-body">
        <div id="calc-container" class="calc-vertical-layout">
          
          <!-- Ligne du haut : MONTANT sur toute la largeur -->
          <div class="calc-row calc-row-display">
            <div class="calc-display-line">
              <div id="calc-left" class="calc-display-left">--</div>
              <div class="calc-amount-block"><span class="calc-amount-label">MONTANT</span><div id="calc-display" class="calc-display" aria-live="polite">0</div></div>
            </div>
          </div>
          <!-- Ligne principale : actions + chips + pot presets + digits -->
          <div class="calc-row calc-row-main">

            <div class="calc-col calc-col-actions">
              ${actionButtonsHtml}
            </div>

            <div class="calc-col calc-col-presets">
              <div class="chip-grid">
                <button class="chip chip-50" type="button" onclick="calcAddAmount(50)">
                  <span>50</span>
                </button>
                <button class="chip chip-100" type="button" onclick="calcAddAmount(100)">
                  <span>100</span>
                </button>
                <button class="chip chip-500" type="button" onclick="calcAddAmount(500)">
                  <span>500</span>
                </button>
                <button class="chip chip-1000" type="button" onclick="calcAddAmount(1000)">
                  <span>1000</span>
                </button>
                <button class="chip chip-5000" type="button" onclick="calcAddAmount(5000)">
                  <span>5000</span>
                </button>
              </div>
            </div>

            <!-- NOUVELLE COLONNE : presets liÃƒÂ©s au pot / mise -->
            <div class="calc-col calc-col-pot">
              <div class="pot-grid">
                <button class="calc-btn pot-btn" onclick="calcRaisePrevFactor(2)">x2 mise</button>
                <button class="calc-btn pot-btn" onclick="calcRaisePrevFactor(4)">x4 mise</button>
                <button class="calc-btn pot-btn" onclick="calcRaiseHalfPot()">½ POT</button>
                <button class="calc-btn pot-btn" onclick="calcRaiseFullPot()">POT</button>
              </div>
            </div>

            <div class="calc-col calc-col-digits">
  <div class="raise-digit-grid">
                <button class="calc-btn" onclick="calcAddDigit(7)">7</button>
                <button class="calc-btn" onclick="calcAddDigit(8)">8</button>
                <button class="calc-btn" onclick="calcAddDigit(9)">9</button>
                <button class="calc-btn" onclick="calcAddDigit(4)">4</button>
                <button class="calc-btn" onclick="calcAddDigit(5)">5</button>
                <button class="calc-btn" onclick="calcAddDigit(6)">6</button>
                <button class="calc-btn" onclick="calcAddDigit(1)">1</button>
                <button class="calc-btn" onclick="calcAddDigit(2)">2</button>
                <button class="calc-btn" onclick="calcAddDigit(3)">3</button>
                <button class="calc-btn ${isStandard ? 'calc-zero-wide' : ''}" onclick="calcAddDigit(0)">0</button>
                ${isStandard ? '' : `<button class="calc-btn calc-bet-wide" onclick="calcConfirm()">BET</button>`}
              </div>
              <button class="calc-btn calc-allin-big" onclick="${bigBtnOnclick}">${bigBtnLabel}</button>
            </div>

          </div>
          <div class="calc-row calc-row-slider">
            <div class="calc-slider-track-labels" aria-hidden="true">
              <span>25%</span><span>50%</span><span>75%</span><span>100%</span>
            </div>
            <input id="calc-slider" type="range" aria-label="Montant de la mise" min="0" max="0" value="0" step="1" />
            <div class="calc-slider-labels" aria-hidden="true">
              <span>25%</span><span>50%</span><span>75%</span><span>100%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Pre-hide before HTML injection to avoid one-frame oversized flash
  const preOverlay = document.getElementById('modal-box');
  if (preOverlay) preOverlay.style.visibility = 'hidden';

  // 1) Injecte la modale
  gui_write_modal_box(html);

  const overlay = document.getElementById('modal-box');
  if (!overlay) return;

  // 2) ThÃƒÂ¨me + affichage centrÃƒÂ©
  overlay.classList.add('arcade');
  overlay.style.visibility = 'hidden';
  overlay.style.display = 'flex';

  const win = overlay.querySelector('.raise-window');
  if (!win) return;
  bindCalcOpacityControls(win);
  let canCheck = false;
  let toCall = 0;
  if (currentGameState) {
    const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
    if (meIdx >= 0) {
      const me = currentGameState.players[meIdx];
      toCall = Math.max(0, (currentGameState.current_bet||0) - (me.subtotal_bet||0));
      canCheck = (toCall === 0);
    }
  }
  const checkBtn = win.querySelector('.btn-check');
  if (checkBtn) {
    checkBtn.disabled = !canCheck;
    checkBtn.title = canCheck ? "" : "Check indisponible (mise en cours)";
  }
  // Valeur par dÃƒÂ©faut ÃƒÂ  l'ouverture :
  // - si aucune mise : BB
  // - si une mise existe : double de la mise
  calcBaseBet = getBaseBetValue();
  calcDefaultValue = Math.max(0, Math.floor(getDefaultBetValue() || 0));
  // Clamp default to what the player can actually put in (subtotal + stack).
  const me = currentGameState?.players?.find(p => p && p.id === mySocketId);
  const subtotal = Math.max(0, Math.floor(me?.subtotal_bet || 0));
  const stack = Math.max(0, Math.floor(me?.bankroll || 0));
  const maxTotal = subtotal + stack;
  if (calcDefaultValue > maxTotal) calcDefaultValue = maxTotal;
  setCalcVal(calcDefaultValue);
  calcDigitOverwrite = true;
  updateCalcSliderBounds();
  bindCalcSlider();

  refreshCreditsDisplay();
  refreshCalcTimerDisplay();
  refreshCalcMathDisplay();

  if (calcFitCleanup) calcFitCleanup();
  calcFitCleanup = window.IMDCXPopups.layoutCalculator(win, overlay);
  bindCalcMoveControls(win);
  overlay.onclick = null;
}

function calcRaisePrevFactor(factor){
  if (!currentGameState) return;

  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  if (meIdx < 0) return;

  const me    = currentGameState.players[meIdx];
  const stack = me.bankroll || 0;

  // Mise de base : minimum a mettre (default), sinon grosse blinde
  const baseBet = Math.max(0, Math.floor(calcDefaultValue || getBaseBetValue() || 0));
  if (baseBet <= 0) return;

  // x2, x4 de cette mise
  let desired = Math.floor(baseBet * factor);

  // On ne dÃƒÂ©passe jamais mon stack
  if (desired > stack) desired = stack;
  if (desired <= 0) return;

  // On affiche seulement (validation via BET)
  calcSetValue(desired);
}

function calcRaiseHalfPot(){
  if (!currentGameState) return;
  const pot = currentGameState.pot || 0;
  if (pot <= 0) return;

  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  const me    = meIdx >= 0 ? currentGameState.players[meIdx] : null;
  const max   = me ? (me.bankroll || 0) : pot;

  let desired = Math.floor(pot / 2);
  if (desired > max) desired = max;
  if (desired <= 0) return;

  calcSetValue(desired);
}

function calcRaiseFullPot(){
  if (!currentGameState) return;
  const pot = currentGameState.pot || 0;
  if (pot <= 0) return;

  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  const me    = meIdx >= 0 ? currentGameState.players[meIdx] : null;
  const max   = me ? (me.bankroll || 0) : pot;

  let desired = Math.floor(pot);
  if (desired > max) desired = max;
  if (desired <= 0) return;

  calcSetValue(desired);
}


function escToCloseOnce(ev){
  if (ev.key === 'Escape') {
    document.removeEventListener('keydown', escToCloseOnce);
    calcClose();
  }
}

function calcFold(){
  // utilise tes handlers natifs si prÃƒÂ©sents, sinon ÃƒÂ©met direct
  if (typeof human_fold === 'function') {
    human_fold();
  } else if (window.socket) {
    socket.emit("playerAction", { type: "fold" });
  }
  calcClose();
}

function calcCheck(){
  // Check UNIQUEMENT si rien ÃƒÂ  payer
  if (!currentGameState) { calcClose(); return; }
  const meIdx = currentGameState.players.findIndex(p => p.id === mySocketId);
  const me    = meIdx >= 0 ? currentGameState.players[meIdx] : null;
  const toCall = me ? Math.max(0, (currentGameState.current_bet||0) - (me.subtotal_bet||0)) : 0;

  if (toCall > 0) {
    alert("Check indisponible : une mise est en cours, vous devez au moins payer.");
    return; // on ne ferme pas la fenÃƒÂªtre pour que le joueur choisisse CALL/RAISE/FOLD
  }

  if (typeof human_check === 'function') {
    human_check();
  } else if (window.socket) {
    socket.emit("playerAction", { type: "check" });
  }
  calcClose();
}

let calcBelowMinWarned = false;
let calcNoticeTimer = null;

function showCalcNotice(msg){
  const el = document.getElementById('calc-notice');
  if (el) el.textContent = msg || '';
}

function showCalcDisplayNotice(msg, restoreValue, durationMs = 1800){
  const el = document.getElementById('calc-display');
  if (!el) return;
  if (calcNoticeTimer) {
    clearTimeout(calcNoticeTimer);
    calcNoticeTimer = null;
  }
  const next = String(msg || '').trim();
  if (!next) return;
  el.textContent = next;
  el.classList.add('calc-display--notice');
  calcNoticeTimer = setTimeout(() => {
    calcNoticeTimer = null;
    el.classList.remove('calc-display--notice');
    const fallback = Number.isFinite(restoreValue) ? restoreValue : Math.max(0, Math.floor(calcDefaultValue || 0));
    setCalcVal(fallback);
  }, durationMs);
}

function minRaiseMessage(amount){
  const msg = `Mise minimum = ${amount}.`;
  showCalcDisplayNotice(msg, amount);
  return msg;
}

function isBbOptionPending(){
  if (!currentGameState || !Array.isArray(currentGameState.players)) return false;
  if (currentGameState.bbOptionPending === true) return true;
  if (currentGameState.phase !== 'preflop') return false;

  const bb = getBigBlindValue();
  if (bb <= 0) return false;

  const meIdx = currentGameState.players.findIndex(p => p && p.id === mySocketId);
  if (meIdx < 0) return false;

  const bbIdx =
    (typeof currentGameState.bigBlindIndex === 'number')   ? currentGameState.bigBlindIndex :
    (typeof currentGameState.bbIndex === 'number')         ? currentGameState.bbIndex :
    (typeof currentGameState.big_blind_index === 'number') ? currentGameState.big_blind_index :
    null;
  if (bbIdx == null || bbIdx !== meIdx) return false;

  const curBet = Math.max(0, Math.floor(currentGameState.current_bet || 0));
  const me = currentGameState.players[meIdx];
  const toCall = Math.max(0, curBet - (me?.subtotal_bet || 0));
  return toCall === 0 && curBet === bb;
}

function hasBbCallers(){
  if (!currentGameState || !Array.isArray(currentGameState.players)) return false;
  const bb = getBigBlindValue();
  if (bb <= 0) return false;

  const bbIdx =
    (typeof currentGameState.bigBlindIndex === 'number')   ? currentGameState.bigBlindIndex :
    (typeof currentGameState.bbIndex === 'number')         ? currentGameState.bbIndex :
    (typeof currentGameState.big_blind_index === 'number') ? currentGameState.big_blind_index :
    null;
  if (bbIdx == null) return false;

  return currentGameState.players.some((p, idx) => {
    if (!p || idx === bbIdx) return false;
    if (p.status === 'FOLD' || p.status === 'BUST' || p.status === 'WAIT') return false;
    return Math.max(0, Math.floor(p.subtotal_bet || 0)) >= bb;
  });
}

function getCalcVal(){
  const el = document.getElementById('calc-display');
  if (!el) return 0;
  const n = parseInt((el.textContent || el.innerText || '0').replace(/[^\d]/g,''), 10);
  return isNaN(n) ? 0 : n;
}
function setCalcVal(v){
  const el = document.getElementById('calc-display');
  const next = Math.max(0, Math.floor(v||0));
  if (calcNoticeTimer) {
    clearTimeout(calcNoticeTimer);
    calcNoticeTimer = null;
  }
  if (el) el.classList.remove('calc-display--notice');
  if (el) el.textContent = String(next);
  updateMySeatBetPreview(next);
  refreshCalcMathDisplay();
  const slider = document.getElementById('calc-slider');
  if (slider) {
    const minVal = parseInt(slider.min || '0', 10);
    const maxVal = parseInt(slider.max || '0', 10);
    const clamped = Math.min(Math.max(next, isNaN(minVal) ? 0 : minVal), isNaN(maxVal) ? next : maxVal);
    slider.value = String(clamped);
    updateCalcSliderFill(slider);
  }
  calcBelowMinWarned = false;
  showCalcNotice('');
}
function calcAddAmount(n){
  setCalcVal(getCalcVal() + Number(n||0));
}

function calcAddDigit(d) {
  if (calcDigitOverwrite) {
    calcDigitOverwrite = false;
    setCalcVal(Number(d));
    return;
  }
  const current = String(getCalcVal());
  const next = current === "0" ? String(d) : current + String(d);
  const parsed = parseInt(next, 10);
  setCalcVal(isNaN(parsed) ? 0 : parsed);
}
function calcSetValue(v) {
  setCalcVal(v);
}
function calcClear() {
  setCalcVal(calcDefaultValue);
  calcDigitOverwrite = true;
}

/* === Close (nettoyage propre) === */
function calcClose(){
  const overlay = document.getElementById('modal-box');
  if (!overlay) return;
  if (calcFitCleanup) {
    calcFitCleanup();
    calcFitCleanup = null;
  }
  overlay.style.visibility = '';
  overlay.style.display = 'none';
  overlay.innerHTML = '';
  overlay.onclick = null;
  overlay.classList.remove('arcade', 'wide'); // au cas oÃƒÂ¹
  document.removeEventListener('keydown', escToCloseOnce);
  calcDigitOverwrite = false;
  calcBelowMinWarned = false;
  showCalcNotice('');
  calcStatsOpen = false;
  setCalcOpenFlag(false);
}
async function calcAdd30Time() {
  if (!canUseAdd30()) return;
  const ok = await ensureAdd30ClassicConfirmedIfNeeded();
  if (!ok) return;
  const okMsg = showAdd30CreditsMessage();
  if (okMsg === false) return;
  socket.emit('requestAdd30');
  applyLocalAdd30(30000);
}
function calcAllIn() {
  if (!currentGameState) return;
  const me = currentGameState.players.find(p => p.id === mySocketId);
  if (!me) return;
  const subtotal = Math.max(0, Math.floor(me.subtotal_bet || 0));
  const stack = Math.max(0, Math.floor(me.bankroll || 0));
  setCalcVal(subtotal + stack);
  calcDigitOverwrite = true;
}
function calcConfirm() {
  // 1) Lis le montant tape
  const input = parseInt(
    document.getElementById("calc-display").textContent,
    10
  );
  if (!input || input <= 0) {
    return alert("Entrez un montant de mise superieur a 0 !");
  }
  const me = currentGameState?.players?.find(p => p && p.id === mySocketId);
  const subtotal = Math.max(0, Math.floor(me?.subtotal_bet || 0));
  const stack = Math.max(0, Math.floor(me?.bankroll || 0));
  const maxTotal = subtotal + stack;
  const isAllIn = input >= maxTotal;
  const minRequired = Math.max(0, Math.floor(calcDefaultValue || 0));
  if (minRequired > 0 && input < minRequired && !isAllIn) {
    minRaiseMessage(minRequired);
    return;
  }
  const delta = input - subtotal;
  if (delta <= 0) {
    showErrorToast("Montant invalide par rapport a votre mise actuelle.");
    return;
  }

  // 2) Emets directement un vrai RAISE sur ce montant
  console.log("[client] RAISE", input);
  socket.emit("playerAction", {
    type:   "raise",
    amount: delta
  });

  // 3) Ferme la modale
  calcClose();
}

function calcOpenOdds() {
  const btn = document.getElementById("odds-help-btn");
  if (btn) btn.click();
}

function calcCloseStats() {
  const modal = document.getElementById('stats-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  calcStatsOpen = false;
}

function calcOpenStats(defaultTab = 'opponents') {
  const modal = document.getElementById('stats-modal');
  if (!modal) return;
  bindStatsModal();
  if (getMySubscription() !== 'pro') defaultTab = 'me';
  calcSwitchStatsTab(defaultTab);
  if (modal.classList.contains('open')) {
    loadCalcStats();
    return;
  }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  calcStatsOpen = true;
  loadCalcStats();
}

let calcStatsActiveTab = 'opponents';

function canViewOpponentStats() {
  return getMySubscription() === 'pro';
}

function refreshStatsModalHeadingUi() {
  const titleEl = document.getElementById('stats-title');
  const subEl = document.querySelector('#stats-modal .stats-sub');
  if (!titleEl || !subEl) return;

  if (canViewOpponentStats()) {
    titleEl.textContent = 'Statistiques des joueurs';
    subEl.textContent = 'Donnees de la table en cours (PRO).';
    return;
  }

  titleEl.textContent = 'Mes statistiques';
  subEl.textContent = 'Passez a la version PRO pour voir les statistiques des autres joueurs.';
}

function refreshStatsTabsUi() {
  const tabsWrap = document.querySelector('#stats-modal .stats-tabs');
  const tabOpp = document.getElementById('stats-tab-opponents');
  const tabMe = document.getElementById('stats-tab-me');
  const panelOpp = document.getElementById('stats-panel-opponents');
  const panelMe = document.getElementById('stats-panel-me');
  const allowOpp = canViewOpponentStats();
  refreshStatsModalHeadingUi();
  if (!allowOpp && calcStatsActiveTab === 'opponents') {
    calcStatsActiveTab = 'me';
  }
  const isOpp = calcStatsActiveTab !== 'me';

  if (tabsWrap) {
    tabsWrap.style.display = allowOpp ? '' : 'none';
  }

  if (tabOpp) {
    tabOpp.hidden = !allowOpp;
    tabOpp.classList.toggle('active', isOpp);
    tabOpp.setAttribute('aria-selected', isOpp ? 'true' : 'false');
    tabOpp.tabIndex = isOpp ? 0 : -1;
  }
  if (tabMe) {
    tabMe.classList.toggle('active', !isOpp);
    tabMe.setAttribute('aria-selected', !isOpp ? 'true' : 'false');
    tabMe.tabIndex = !isOpp ? 0 : -1;
  }
  if (panelOpp) {
    const showOppPanel = allowOpp && isOpp;
    panelOpp.classList.toggle('active', showOppPanel);
    panelOpp.hidden = !showOppPanel;
  }
  if (panelMe) {
    panelMe.classList.toggle('active', !isOpp);
    panelMe.hidden = isOpp;
  }
}

function calcSwitchStatsTab(tab) {
  if (!canViewOpponentStats()) {
    calcStatsActiveTab = 'me';
  } else {
    calcStatsActiveTab = (tab === 'me') ? 'me' : 'opponents';
  }
  refreshStatsTabsUi();
}

function formatModeLabel(mode) {
  const key = String(mode || '').toLowerCase();
  const map = {
    hyper: 'Hyperfast',
    highroller: 'Highroller',
    turbo: 'Turbo',
    normal: 'Normal',
    beginner: 'Beginner'
  };
  return map[key] || (key ? key.toUpperCase() : 'MODE');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function calcStatsRecentKey(playerName) {
  const safe = String(playerName || '').trim().toLowerCase();
  if (!safe) return null;
  return `calc_stats_recent_${safe}`;
}

function pushCalcStatsRecentResult(kind, snapshot = null) {
  try {
    const gs = snapshot || currentGameState;
    const me = gs?.players?.[mySeatIndex];
    const name = String(me?.label || '').trim();
    const key = calcStatsRecentKey(name);
    if (!key) return;

    const item = {
      result: kind === 'win' ? 'W' : 'L',
      ts: Date.now(),
      mode: String(gs?.mode || gameMode || '').toLowerCase() || null,
      level: String(gs?.level || '').toUpperCase() || null,
      roomType: _match2ID ? 'duel' : 'table'
    };

    const prev = JSON.parse(localStorage.getItem(key) || '[]');
    const next = Array.isArray(prev) ? prev : [];
    next.unshift(item);
    localStorage.setItem(key, JSON.stringify(next.slice(0, 5)));
  } catch (e) {
    console.warn('pushCalcStatsRecentResult failed', e);
  }
}

function getCalcStatsRecentResults(playerName) {
  try {
    const key = calcStatsRecentKey(playerName);
    if (!key) return [];
    const raw = localStorage.getItem(key);
    const arr = JSON.parse(raw || '[]');
    return Array.isArray(arr) ? arr.slice(0, 5) : [];
  } catch (e) {
    return [];
  }
}

function formatCalcStatsDate(ts) {
  if (!Number.isFinite(ts)) return '--';
  try {
    return new Date(ts).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit'
    });
  } catch (e) {
    return '--';
  }
}

function renderMyStatsCardHtml(meSeat, meStats) {
  const me = meSeat || {};
  const stats = meStats || {
    gamesPlayed: 0,
    wins: 0,
    table: { played: 0, wins: 0 },
    duel: { played: 0, wins: 0 },
    byMode: {}
  };
  const playerName = String(me.label || 'Moi').trim() || 'Moi';
  const credits = Number.isFinite(me.credits) ? Math.max(0, Math.floor(me.credits)) : 0;
  const timeCredits = Number.isFinite(me.timeCredits) ? Math.max(0, Math.floor(me.timeCredits)) : 0;
  const statusLabel = String(me.status || '').toUpperCase() || 'ACTIF';
  const subLabel = String(me.subscription || 'standard').toUpperCase();
  const levelLabel = String(currentGameState?.level || me.level || '--').toUpperCase();
  const currentModeRaw = String(currentGameState?.mode || gameMode || '').trim().toLowerCase();
  const currentModeLabel = currentModeRaw ? formatModeLabel(currentModeRaw) : '--';
  const winRate = stats.gamesPlayed > 0 ? Math.round((stats.wins / stats.gamesPlayed) * 100) : 0;

  const topModes = Object.entries(stats.byMode || {})
    .map(([mode, val]) => ({ mode, played: val?.played || 0, wins: val?.wins || 0 }))
    .filter(m => m.played > 0)
    .sort((a, b) => (b.played - a.played) || (b.wins - a.wins))
    .slice(0, 3);
  const modesHtml = topModes.length
    ? topModes.map(m => `<span class="mode-pill">${escapeHtml(formatModeLabel(m.mode))}</span>`).join('')
    : '<span class="mode-empty">Aucun historique</span>';

  const recent = getCalcStatsRecentResults(playerName);
  const recentHtml = recent.length
    ? recent.map(item => {
        const win = item?.result === 'W';
        const mode = item?.mode ? formatModeLabel(item.mode) : (item?.roomType === 'duel' ? 'Duel' : 'Table');
        return `<span class="result-pill ${win ? 'win' : 'lose'}" title="${escapeHtml(mode)}">${win ? 'W' : 'L'} Ã¢â‚¬Â¢ ${escapeHtml(formatCalcStatsDate(item.ts))}</span>`;
      }).join('')
    : '<span class="mode-empty">Historique local vide (il se remplira après tes prochaines games)</span>';

  return `
    <div class="calc-stat-card me-profile-card${statusLabel === 'BUST' ? ' is-busted' : ''}">
      <div class="calc-stat-header">
        <div class="calc-stat-title">Profil</div>
        <div class="calc-stat-name">${escapeHtml(playerName)}</div>
        <div class="calc-stat-state">${escapeHtml(statusLabel)}</div>
      </div>

      <div class="calc-stat-modes calc-stat-badges">
        <span class="mode-label">Abonnement :</span><span class="mode-pill">${escapeHtml(subLabel)}</span>
        <span class="mode-label">Niveau :</span><span class="mode-pill">${escapeHtml(levelLabel)}</span>
      </div>

      <div class="calc-stat-grid calc-stat-grid-me">
        <div class="calc-stat-item"><span>Credits</span><strong>${credits}</strong></div>
        <div class="calc-stat-item"><span>Credits Time</span><strong>${timeCredits}</strong></div>
        <div class="calc-stat-item"><span>Games</span><strong>${stats.gamesPlayed}</strong></div>
        <div class="calc-stat-item"><span>Wins</span><strong>${stats.wins}</strong></div>
        <div class="calc-stat-item"><span>Winrate</span><strong>${winRate}%</strong></div>
        <div class="calc-stat-item"><span>10J jouees</span><strong>${stats.table.played}</strong></div>
        <div class="calc-stat-item"><span>10J gagnees</span><strong>${stats.table.wins}</strong></div>
        <div class="calc-stat-item"><span>Duels joues</span><strong>${stats.duel.played}</strong></div>
        <div class="calc-stat-item"><span>Duels gagnes</span><strong>${stats.duel.wins}</strong></div>
        <div class="calc-stat-item"><span>Mode en cours</span><strong>${escapeHtml(currentModeLabel)}</strong></div>
      </div>

      <div class="calc-stat-modes">
        <span class="mode-label">Modes favoris :</span>
        ${modesHtml}
      </div>

      <div class="calc-stat-recent">
        <div class="calc-stat-recent-title">5 dernieres games</div>
        <div class="calc-stat-recent-list">${recentHtml}</div>
      </div>
    </div>
  `;
}

async function loadCalcStats() {
  const listEl = document.getElementById('stats-list');
  const meEl = document.getElementById('stats-me');
  const noteEl = document.getElementById('stats-note');
  if (!listEl || !meEl || !noteEl) return;
  refreshStatsTabsUi();
  if (!currentGameState || !Array.isArray(currentGameState.players)) {
    listEl.innerHTML = '<div class="calc-stats-empty">Aucune table active.</div>';
    meEl.innerHTML = '<div class="calc-stats-empty">Aucune donnee de profil disponible.</div>';
    noteEl.textContent = '';
    return;
  }

  const seatPlayers = currentGameState.players
    .map((p, idx) => ({
      seat: idx,
      id: p?.id || null,
      label: (p && p.label) ? p.label : `Player ${idx + 1}`,
      status: p?.status || ''
    }))
    .filter(p => String(p.label || '').trim().length > 0);

  const meSeatIdxBySocket = seatPlayers.findIndex(p => p.id && p.id === mySocketId);
  const mySeatResolved = Number.isInteger(mySeatIndex) && mySeatIndex >= 0
    ? mySeatIndex
    : (meSeatIdxBySocket >= 0 ? meSeatIdxBySocket : -1);
  const meSeat = currentGameState.players[mySeatResolved] || currentGameState.players[mySeatIndex] || null;
  const opponentSeatPlayers = seatPlayers.filter(p => p.seat !== mySeatResolved);
  const allowOpp = canViewOpponentStats();
  const meNameForFetch = String(meSeat?.label || '').trim();
  const names = allowOpp
    ? seatPlayers.map(p => p.label)
    : (meNameForFetch ? [meNameForFetch] : []);

  listEl.innerHTML = '<div class="calc-stats-loading">Chargement...</div>';
  meEl.innerHTML = '<div class="calc-stats-loading">Chargement...</div>';
  noteEl.textContent = '';

  try {
    const res = await fetch('/api/playerStats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names })
    });
    if (!res.ok) throw new Error('bad_status');
    const data = await res.json();
    const map = new Map();
    (data?.players || []).forEach(p => {
      map.set(p.name, p);
    });

    const cards = allowOpp ? opponentSeatPlayers.map(p => {
      const stats = map.get(p.label) || {
        gamesPlayed: 0,
        wins: 0,
        table: { played: 0, wins: 0 },
        duel: { played: 0, wins: 0 },
        byMode: {}
      };

      const modes = Object.entries(stats.byMode || {})
        .map(([mode, val]) => ({
          mode,
          played: val?.played || 0,
          wins: val?.wins || 0
        }))
        .filter(m => m.played > 0)
        .sort((a, b) => (b.played - a.played) || (b.wins - a.wins))
        .slice(0, 2);

      const modesHtml = modes.length
        ? modes.map(m => `<span class="mode-pill">${escapeHtml(formatModeLabel(m.mode))}</span>`).join('')
        : '<span class="mode-empty">Ã¢â‚¬â€</span>';

      const stateLabel = (p.status === 'BUST') ? 'BUSTED' : 'ACTIF';
      const bustedClass = p.status === 'BUST' ? ' is-busted' : '';
      const seatLabel = `Player ${p.seat + 1}`;

      return `
        <div class="calc-stat-card${bustedClass}">
          <div class="calc-stat-header">
            <div class="calc-stat-title">${escapeHtml(seatLabel)}</div>
            <div class="calc-stat-name">${escapeHtml(p.label)}</div>
            <div class="calc-stat-state">${escapeHtml(stateLabel)}</div>
          </div>
          <div class="calc-stat-grid">
            <div class="calc-stat-item"><span>Games</span><strong>${stats.gamesPlayed}</strong></div>
            <div class="calc-stat-item"><span>Wins</span><strong>${stats.wins}</strong></div>
            <div class="calc-stat-item"><span>10J jouÃƒÂ©es</span><strong>${stats.table.played}</strong></div>
            <div class="calc-stat-item"><span>10J gagnÃƒÂ©es</span><strong>${stats.table.wins}</strong></div>
            <div class="calc-stat-item"><span>Duels jouÃƒÂ©s</span><strong>${stats.duel.played}</strong></div>
            <div class="calc-stat-item"><span>Duels gagnÃƒÂ©s</span><strong>${stats.duel.wins}</strong></div>
          </div>
          <div class="calc-stat-modes">
            <span class="mode-label">Modes :</span>
            ${modesHtml}
          </div>
        </div>
      `;
    }) : [];

    const meName = String(meSeat?.label || '').trim();
    const meStats = meName ? map.get(meName) : null;

    listEl.innerHTML = allowOpp
      ? (cards.join('') || '<div class="calc-stats-empty">Aucun adversaire.</div>')
      : '<div class="calc-stats-empty">Disponible en PRO.</div>';
    meEl.innerHTML = renderMyStatsCardHtml(meSeat, meStats);
    noteEl.textContent = '';
  } catch (e) {
    listEl.innerHTML = allowOpp
      ? '<div class="calc-stats-empty">Impossible de charger les stats adverses.</div>'
      : '<div class="calc-stats-empty">Disponible en PRO.</div>';
    meEl.innerHTML = renderMyStatsCardHtml(meSeat, null);
    noteEl.textContent = '';
  }
}

let statsModalBound = false;
function bindStatsModal() {
  if (statsModalBound) return;
  const modal = document.getElementById('stats-modal');
  if (!modal) return;
  modal.querySelectorAll('[data-stats-close]').forEach(el => {
    el.addEventListener('click', calcCloseStats);
  });
  modal.querySelectorAll('[data-stats-tab]').forEach(el => {
    el.addEventListener('click', () => {
      calcSwitchStatsTab(el.getAttribute('data-stats-tab'));
    });
  });
  refreshStatsTabsUi();
  statsModalBound = true;
}

/** DÃƒÂ©sactive / rÃƒÂ©active Raise */
function disableRaiseButton() {
  const btn = document.getElementById("custom-raise");
  if (!btn) return;
  btn.classList.add("disabled");
  btn.onclick = null;
}
function enableRaiseButton() {
  const btn = document.getElementById("custom-raise");
  if (!btn) return;
  btn.classList.remove("disabled");
  btn.style.display = "inline-block";
  btn.onclick = show_custom_raise;
}

function initRulesHelp(){
  const btn = document.getElementById("rules-help-btn");
  const modal = document.getElementById("rules-modal");
  const agentToggle = modal?.querySelector(".rules-agent-toggle");
  const agentInput = modal?.querySelector("#rules-agent-input");
  const agentBtn = modal?.querySelector("#rules-agent-btn");
  const agentMessages = modal?.querySelector("#rules-agent-messages");
  if (!btn || !modal) return;

  const appendMessage = (text, kind) => {
    if (!agentMessages) return;
    const div = document.createElement("div");
    div.className = "rules-agent-msg " + kind;
    div.textContent = text;
    agentMessages.appendChild(div);
    agentMessages.scrollTop = agentMessages.scrollHeight;
  };

  const sendAgent = () => {
    if (!agentInput || !agentInput.value.trim()) return;
    const q = agentInput.value.trim();
    agentInput.value = "";
    appendMessage(q, "user");
    setTimeout(() => {
      appendMessage("Je peux aider sur les regles, les cotes et les decisions simples. Dis-moi la phase et tes cartes.", "bot");
    }, 400);
  };

  const open = () => {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
  };
  const close = () => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    modal.classList.remove("show-agent");
  };

  btn.addEventListener("click", open);
  agentToggle?.addEventListener("click", () => {
    modal.classList.toggle("show-agent");
  });
  agentBtn?.addEventListener("click", sendAgent);
  agentInput?.addEventListener("keydown", e => {
    if (e.key === "Enter") sendAgent();
  });
  modal.addEventListener("click", e => {
    const target = e.target;
    if (target && target.getAttribute("data-rules-close") === "true") close();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") close();
  });
}

initRulesHelp();

function buildDeck(){
  const suits = ["h","d","c","s"];
  const deck = [];
  for (let r = 2; r < 15; r++) {
    for (const s of suits) deck.push(s + r);
  }
  return deck;
}

function getVisibleBoardByPhase(phase, board){
  const cap = (phase === "flop") ? 3
    : (phase === "turn") ? 4
    : (phase === "river" || phase === "reveal") ? 5
    : 0;
  return Array.isArray(board) ? board.slice(0, cap).filter(Boolean) : [];
}

function countActiveOpponents(gameState){
  if (!gameState || !Array.isArray(gameState.players)) return 0;
  return gameState.players.filter((p, idx) => {
    if (!p) return false;
    if (idx === mySeatIndex) return false;
    if (p.status === "FOLD" || p.status === "BUST" || p.status === "WAIT") return false;
    return true;
  }).length;
}

function drawRandom(deck){
  const idx = Math.floor(Math.random() * deck.length);
  return deck.splice(idx, 1)[0];
}

function computeOdds(){
  if (!currentGameState || mySeatIndex == null) {
    return { error: "Pas de partie en cours." };
  }
  const me = currentGameState.players[mySeatIndex];
  if (!me || !me.carda || !me.cardb) {
    return { error: "Tes cartes ne sont pas encore visibles." };
  }
  if (typeof get_winners !== "function") {
    return { error: "Calculateur indisponible." };
  }

  const phase = currentGameState.phase || "preflop";
  const boardVisible = getVisibleBoardByPhase(phase, currentGameState.board || []);
  const cardsToCome = Math.max(0, 5 - boardVisible.length);
  const opponents = countActiveOpponents(currentGameState);
  const sims = (opponents === 0) ? 1 : (cardsToCome >= 3 ? 5000 : 4000);

  const known = [me.carda, me.cardb, ...boardVisible];
  const deckBase = buildDeck().filter(c => !known.includes(c));
  const boardBackup = window.board;

  let wins = 0;
  let ties = 0;
  let losses = 0;

  for (let i = 0; i < sims; i++) {
    const deck = deckBase.slice();
    const simBoard = boardVisible.slice();

    while (simBoard.length < 5) simBoard.push(drawRandom(deck));

    const players = [{ name: "ME", carda: me.carda, cardb: me.cardb }];
    for (let o = 0; o < opponents; o++) {
      players.push({ name: "OPP" + (o + 1), carda: drawRandom(deck), cardb: drawRandom(deck) });
    }

    window.board = simBoard;
    const winners = get_winners(players);
    if (winners && winners[0]) {
      const winnerCount = winners.filter(Boolean).length;
      if (winnerCount === 1) wins++;
      else ties++;
    } else {
      losses++;
    }
  }

  window.board = boardBackup;

  const total = Math.max(1, wins + ties + losses);
  return {
    winPct: Math.round((wins / total) * 100),
    tiePct: Math.round((ties / total) * 100),
    losePct: Math.round((losses / total) * 100),
    sims: total,
    phase,
    opponents,
    cardsToCome
  };
}

function renderOdds(){
  const winEl = document.getElementById("odds-win");
  const tieEl = document.getElementById("odds-tie");
  const loseEl = document.getElementById("odds-lose");
  const phaseEl = document.getElementById("odds-phase");
  const oppsEl = document.getElementById("odds-opps");
  const leftEl = document.getElementById("odds-left");
  const simsEl = document.getElementById("odds-sims");
  const noteEl = document.getElementById("odds-note");

  if (winEl) winEl.textContent = "...";
  if (tieEl) tieEl.textContent = "...";
  if (loseEl) loseEl.textContent = "...";
  if (noteEl) noteEl.textContent = "Calcul en cours...";

  setTimeout(() => {
    const res = computeOdds();
    if (res.error) {
      if (noteEl) noteEl.textContent = res.error;
      if (winEl) winEl.textContent = "--%";
      if (tieEl) tieEl.textContent = "--%";
      if (loseEl) loseEl.textContent = "--%";
      return;
    }
    if (winEl) winEl.textContent = res.winPct + "%";
    if (tieEl) tieEl.textContent = res.tiePct + "%";
    if (loseEl) loseEl.textContent = res.losePct + "%";
    if (phaseEl) phaseEl.textContent = res.phase;
    if (oppsEl) oppsEl.textContent = String(res.opponents);
    if (leftEl) leftEl.textContent = String(res.cardsToCome);
    if (simsEl) simsEl.textContent = String(res.sims);
    if (noteEl) noteEl.textContent = "Resultat base sur des tirages aleatoires.";
  }, 30);
}

function initOddsHelp(){
  const btn = document.getElementById("odds-help-btn");
  const modal = document.getElementById("odds-modal");
  const recalcBtn = document.getElementById("odds-recalc-btn");
  if (!btn || !modal) return;

  const open = () => {
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    renderOdds();
  };
  const close = () => {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
  };

  btn.addEventListener("click", open);
  recalcBtn?.addEventListener("click", renderOdds);
  modal.addEventListener("click", e => {
    const target = e.target;
    if (target && target.getAttribute("data-odds-close") === "true") close();
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") close();
  });
}

initOddsHelp();

function updateBreakButtonState(gameState){
  const btn = document.getElementById("break-btn");
  if (!btn) return;
  const me = gameState?.players?.find(p => p && p.id === mySocketId);
  const isBreak = me?.status === 'WAIT' && Boolean(me?.isBreak);
  btn.classList.toggle('active', isBreak);
  btn.title = isBreak ? "BREAK actif" : "Prendre un break";
}

function initBreakButton(){
  const btn = document.getElementById("break-btn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    if (!socket || !currentGameState) return;
    const me = currentGameState.players.find(p => p && p.id === mySocketId);
    if (!me || me.status === 'BUST') return;
    const nextBreak = !(me.status === 'WAIT' && me.isBreak);
    socket.emit("toggleBreak", { enabled: nextBreak });
  });
}

initBreakButton();

function makeArcadeOverlay(kind, html, options = {}) {
  const { noClose = false } = options;

  // nettoie un ancien overlay ÃƒÂ©ventuel
  const old1 = document.getElementById('victory-overlay');
  const old2 = document.getElementById('losing-overlay');
  old1?.remove();
  old2?.remove();

  const ov = document.createElement('div');
  ov.id  = (kind === 'win') ? 'victory-overlay' : 'losing-overlay';
  ov.className = 'arcade-overlay ' + (kind === 'win' ? 'win' : 'lose');

  const title = (kind === 'win') ? 'YOU WIN!' : 'GAME OVER';

  ov.innerHTML = `
    <div class="ao-bg"></div>
    <div class="ao-card">
      <div class="ao-head">
        <h1 class="ao-title">${title}</h1>
        ${noClose ? '' : '<button class="ao-x" aria-label="Fermer">Ãƒâ€”</button>'}
      </div>
      <div class="ao-body">${html}</div>
      <div class="ao-confetti" aria-hidden="true"></div>
    </div>
  `;

  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('show'));

  // === Fermeture (seulement si noClose = false) ===
  if (!noClose) {
    const btnX = ov.querySelector('.ao-x');
    if (btnX) {
      btnX.addEventListener('click', () => ov.remove());
    }

    // clic en dehors de la carte Ã¢â€ â€™ fermer
    ov.addEventListener('click', (e) => {
      if (e.target === ov) ov.remove();
    });

    // ESC Ã¢â€ â€™ fermer
    const escHandler = (ev) => {
      if (ev.key === 'Escape') {
        document.removeEventListener('keydown', escHandler);
        ov.remove();
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  // === FX dynamiques pour le banner ===
  if (typeof initEndBannerFX === 'function') {
    initEndBannerFX(ov, { kind, autoCloseSec: 0 });
  }

  // confettis si win (comme avant)
  if (kind === 'win') {
    const fx = ov.querySelector('.ao-confetti');
    if (fx) {
      fx.innerHTML = '';

      // 1) confetti
      const colors = ['#48d2ff','#7e59ff','#ffd447','#2bd38a','#ff6e5b'];
      for (let i = 0; i < 28; i++) {
        const s = 8 + Math.random() * 8;
        const el = document.createElement('i');
        el.style.cssText = `
          position:absolute;width:${s}px;height:${s*1.4}px;border-radius:2px;
          left:${(Math.random()*96+2)}%; top:-10vh; background:${colors[i%colors.length]};
          animation: ao-fall 1.6s ease-out ${Math.random()*0.6}s forwards`;
        fx.appendChild(el);
      }

      // 2) chips burst
      const chipClasses = ['chip-50','chip-100','chip-200','chip-500','chip-1000'];
      for (let j = 0; j < 16; j++) {
        const c = document.createElement('div');
        c.className = `chip-fx ${chipClasses[j % chipClasses.length]}`;
        c.style.left = (Math.random()*90 + 5) + '%';
        c.style.top  = '-8vh';
        c.style.animationDelay = (Math.random()*0.5 + 0.05) + 's';
        const inner = document.createElement('span');
        c.appendChild(inner);
        fx.appendChild(c);
      }
    }
  }
}

function playWinExplosion3D() {
  const styleId = 'win-cinematic-style';
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .win-cinematic-fx{
        position: fixed;
        inset: 0;
        z-index: 2147483600;
        pointer-events: none;
        overflow: hidden;
      }
      .win-cinematic-fx .wc-vignette{
        position: absolute;
        inset: -15%;
        background:
          radial-gradient(circle at 50% 55%, rgba(255,220,128,.24) 0%, rgba(255,220,128,.07) 26%, rgba(10,14,22,.72) 72%, rgba(4,6,10,.92) 100%),
          conic-gradient(from 70deg at 50% 55%, rgba(72,210,255,.22), rgba(255,212,71,.24), rgba(126,89,255,.18), rgba(72,210,255,.22));
        animation: wc-vignette 3600ms ease-out forwards;
      }
      .win-cinematic-fx .wc-center-glow{
        position: absolute;
        left: 50%;
        top: 54%;
        width: 26vmin;
        height: 26vmin;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: radial-gradient(circle, rgba(255,244,182,.95) 0%, rgba(255,214,86,.52) 28%, rgba(72,210,255,.22) 56%, rgba(72,210,255,0) 80%);
        filter: blur(2px);
        animation: wc-centerGlow 3000ms cubic-bezier(.15,.82,.22,1) forwards;
      }
      .win-cinematic-fx .wc-ring{
        position: absolute;
        left: 50%;
        top: 54%;
        width: 24vmin;
        height: 24vmin;
        transform: translate(-50%, -50%) scale(.25);
        border-radius: 999px;
        border: 3px solid rgba(255,223,124,.92);
        box-shadow: 0 0 24px rgba(255,214,86,.56), inset 0 0 18px rgba(72,210,255,.36);
        opacity: 0;
        animation: wc-ring 2400ms ease-out var(--d, 0ms) forwards;
      }
      .win-cinematic-fx .wc-sweep{
        position: absolute;
        left: 50%;
        top: 54%;
        width: 50vmin;
        height: 5vmin;
        transform: translate(-50%, -50%) rotate(var(--r, 0deg)) scale(.6);
        border-radius: 999px;
        background: linear-gradient(90deg, transparent 0%, rgba(72,210,255,.7) 42%, rgba(255,218,108,.96) 52%, rgba(72,210,255,.7) 62%, transparent 100%);
        filter: blur(1.6px);
        opacity: 0;
        animation: wc-sweep 1700ms ease-out var(--d, 0ms) forwards;
      }
      .win-cinematic-fx .wc-shard{
        position: absolute;
        left: 50%;
        top: 54%;
        width: var(--l, 56px);
        height: 3px;
        transform: translate(-50%, -50%) rotate(var(--a, 0deg));
        transform-origin: 0 50%;
        background: linear-gradient(90deg, rgba(255,231,150,.98) 0%, rgba(72,210,255,.82) 68%, rgba(72,210,255,0) 100%);
        border-radius: 999px;
        opacity: 0;
        filter: drop-shadow(0 0 8px rgba(72,210,255,.68));
        animation: wc-shard 2100ms ease-out var(--d, 0ms) forwards;
      }
      .win-cinematic-fx .wc-comet{
        position: absolute;
        left: 50%;
        top: 54%;
        width: var(--s, 8px);
        height: var(--s, 8px);
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: radial-gradient(circle at 30% 30%, #fff 0%, #ffe39b 36%, #4cd6ff 78%, rgba(76,214,255,0) 100%);
        opacity: 0;
        filter: drop-shadow(0 0 8px rgba(255,214,86,.72));
        animation: wc-comet 2800ms ease-out var(--d, 0ms) forwards;
      }
      .win-cinematic-fx .wc-title-flash{
        position: absolute;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%) scale(.88);
        font: 900 clamp(34px, 8vw, 92px)/1 "Trebuchet MS", Verdana, sans-serif;
        letter-spacing: .1em;
        color: rgba(255,245,203,.95);
        text-shadow:
          0 0 10px rgba(255,228,140,.9),
          0 0 28px rgba(72,210,255,.75),
          0 0 54px rgba(72,210,255,.45);
        opacity: 0;
        animation: wc-title 2900ms cubic-bezier(.15,.82,.22,1) 120ms forwards;
      }
      @keyframes wc-vignette{
        0%{ opacity: 0; transform: scale(1.1); }
        24%{ opacity: 1; }
        100%{ opacity: 0; transform: scale(1); }
      }
      @keyframes wc-centerGlow{
        0%{ opacity: 0; transform: translate(-50%, -50%) scale(.2); }
        22%{ opacity: 1; transform: translate(-50%, -50%) scale(1); }
        100%{ opacity: 0; transform: translate(-50%, -50%) scale(2.7); }
      }
      @keyframes wc-ring{
        0%{ opacity: 0; transform: translate(-50%, -50%) scale(.24); }
        18%{ opacity: .96; }
        100%{ opacity: 0; transform: translate(-50%, -50%) scale(2.7); }
      }
      @keyframes wc-sweep{
        0%{ opacity: 0; transform: translate(-50%, -50%) rotate(var(--r,0deg)) scale(.4); }
        22%{ opacity: .92; }
        100%{ opacity: 0; transform: translate(-50%, -50%) rotate(calc(var(--r,0deg) + 42deg)) scale(1.4); }
      }
      @keyframes wc-shard{
        0%{ opacity: 0; transform: translate(-50%, -50%) rotate(var(--a, 0deg)) scaleX(.2); }
        18%{ opacity: 1; }
        100%{ opacity: 0; transform: translate(calc(-50% + var(--tx, 0px)), calc(-50% + var(--ty, 0px))) rotate(var(--a, 0deg)) scaleX(1); }
      }
      @keyframes wc-comet{
        0%{ opacity: 0; transform: translate(-50%, -50%) scale(.2); }
        18%{ opacity: 1; }
        100%{ opacity: 0; transform: translate(calc(-50% + var(--tx, 0px)), calc(-50% + var(--ty, 0px))) scale(1); }
      }
      @keyframes wc-title{
        0%{ opacity: 0; transform: translate(-50%, -50%) scale(.8); filter: blur(4px); }
        20%{ opacity: .98; transform: translate(-50%, -50%) scale(1.03); filter: blur(0); }
        70%{ opacity: .98; transform: translate(-50%, -50%) scale(1.03); filter: blur(0); }
        100%{ opacity: 0; transform: translate(-50%, -50%) scale(1.16); filter: blur(1px); }
      }
    `;
    document.head.appendChild(style);
  }

  const existing = document.getElementById('win-cinematic-fx');
  existing?.remove();

  const layer = document.createElement('div');
  layer.id = 'win-cinematic-fx';
  layer.className = 'win-cinematic-fx';

  const vignette = document.createElement('div');
  vignette.className = 'wc-vignette';
  layer.appendChild(vignette);

  const centerGlow = document.createElement('div');
  centerGlow.className = 'wc-center-glow';
  layer.appendChild(centerGlow);

  for (let r = 0; r < 4; r += 1) {
    const ring = document.createElement('div');
    ring.className = 'wc-ring';
    ring.style.setProperty('--d', `${r * 120}ms`);
    layer.appendChild(ring);
  }

  for (let s = 0; s < 3; s += 1) {
    const sweep = document.createElement('div');
    sweep.className = 'wc-sweep';
    sweep.style.setProperty('--d', `${50 + (s * 130)}ms`);
    sweep.style.setProperty('--r', `${-36 + (s * 54)}deg`);
    layer.appendChild(sweep);
  }

  const shardCount = 42;
  for (let i = 0; i < shardCount; i += 1) {
    const shard = document.createElement('i');
    const angle = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 420;
    shard.className = 'wc-shard';
    shard.style.setProperty('--a', `${(angle * 57.2958).toFixed(2)}deg`);
    shard.style.setProperty('--tx', `${(Math.cos(angle) * dist).toFixed(2)}px`);
    shard.style.setProperty('--ty', `${(Math.sin(angle) * dist).toFixed(2)}px`);
    shard.style.setProperty('--d', `${Math.round(Math.random() * 200)}ms`);
    shard.style.setProperty('--l', `${Math.round(30 + Math.random() * 78)}px`);
    layer.appendChild(shard);
  }

  const cometCount = 54;
  for (let t = 0; t < cometCount; t += 1) {
    const comet = document.createElement('i');
    const angle = Math.random() * Math.PI * 2;
    const dist = 170 + Math.random() * 700;
    comet.className = 'wc-comet';
    comet.style.setProperty('--tx', `${(Math.cos(angle) * dist).toFixed(2)}px`);
    comet.style.setProperty('--ty', `${(Math.sin(angle) * dist).toFixed(2)}px`);
    comet.style.setProperty('--d', `${Math.round(80 + Math.random() * 300)}ms`);
    comet.style.setProperty('--s', `${(4 + Math.random() * 9).toFixed(2)}px`);
    layer.appendChild(comet);
  }

  const flashText = document.createElement('div');
  flashText.className = 'wc-title-flash';
  flashText.textContent = 'VICTORY';
  layer.appendChild(flashText);

  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 4500);
}

function playLoseImpactFX() {
  const existing = document.getElementById('lose-impact-fx');
  existing?.remove();

  const layer = document.createElement('div');
  layer.id = 'lose-impact-fx';
  layer.className = 'lose-impact-fx';

  const vignette = document.createElement('div');
  vignette.className = 'lose-vignette';
  layer.appendChild(vignette);

  const pulse = document.createElement('div');
  pulse.className = 'lose-pulse';
  layer.appendChild(pulse);

  const slash = document.createElement('div');
  slash.className = 'lose-slash';
  layer.appendChild(slash);

  const shards = 42;
  for (let i = 0; i < shards; i += 1) {
    const node = document.createElement('i');
    const angle = Math.random() * Math.PI * 2;
    const dist = 140 + Math.random() * 520;
    const driftY = -120 + Math.random() * 280;
    const delay = Math.random() * 220;
    const dur = 1400 + Math.random() * 1700;
    const size = 3 + Math.random() * 9;

    node.className = 'shard';
    node.style.setProperty('--tx', `${Math.cos(angle) * dist}px`);
    node.style.setProperty('--ty', `${Math.sin(angle) * dist + driftY}px`);
    node.style.setProperty('--d', `${delay}ms`);
    node.style.setProperty('--t', `${dur}ms`);
    node.style.setProperty('--s', `${size}px`);
    layer.appendChild(node);
  }

  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 5200);
}

function showVictory(name) {
  if (currentGameState?.demo) return;
  // EmpÃƒÂªche d'afficher plusieurs fois l'overlay de victoire
  if (typeof winnerAnnounced !== 'undefined' && winnerAnnounced) return;
  if (typeof winnerAnnounced !== 'undefined') winnerAnnounced = true;

  const freezeSnapshot = getBestGameOverFreezeSnapshot();
  setLockedEndStateSnapshot(freezeSnapshot || currentGameState);
  // Ã°Å¸â€â€™ MÃƒÂ©moriser que cette partie est terminÃƒÂ©e par une victoire pour ce joueur
  rememberEndState('win', freezeSnapshot || currentGameState);
  playWinExplosion3D();
  stopTurnPulse();
  if (deferredFinalStateTimer) {
    clearTimeout(deferredFinalStateTimer);
    deferredFinalStateTimer = null;
  }
  finalStateDeferred = false;
  deferredFinalStateSnapshot = null;
  revealSeatShowStartedAt = null;
  endStateLocked = true;
  document.body.classList.add('final-winner-ui', 'final-end-ui');
  if (freezeSnapshot) lockFinalWinnerSeatFromState(freezeSnapshot);
  else if (currentGameState) lockFinalWinnerSeatFromState(currentGameState);

  centerMessageMode = 'winner-final';
  showCenterMessage('YOU WIN !!', 'winner-final');
  applyFinalSpectatorView();
  const mySeatEl = document.getElementById("seat" + mySeatIndex);
  if (mySeatEl) mySeatEl.classList.add('final-winner');
  if (freezeSnapshot) {
    renderGameOverFreezeSnapshot(freezeSnapshot);
  } else {
    resetAllBacks();
    setupBoardBacks();
    renderLockedFinalWinnerSeatCards();
  }
  if (lateJoinFinishedState) {
    applyLateJoinFinishedCardsMask(freezeSnapshot || currentGameState);
  }
  scheduleFinalSeatCardLock();
  stopTimerUI();
}

/** Overlay dÃƒÂ©faite (remplace lÃ¢â‚¬â„¢ancienne) */
function showLosing(final = false) {
  if (currentGameState?.demo) return;
  // EmpÃƒÂªche d'afficher plusieurs fois lÃ¢â‚¬â„¢overlay de dÃƒÂ©faite
  if (typeof loserAnnounced !== 'undefined' && loserAnnounced) return;
  if (typeof loserAnnounced !== 'undefined') loserAnnounced = true;

  const freezeSnapshot = getBestGameOverFreezeSnapshot();
  setLockedEndStateSnapshot(freezeSnapshot);
  // Ã°Å¸â€â€™ MÃƒÂ©moriser que cette partie est terminÃƒÂ©e par une dÃƒÂ©faite pour ce joueur
  rememberEndState('lose', freezeSnapshot);
  playLoseImpactFX();
  stopTurnPulse();
  if (deferredFinalStateTimer) {
    clearTimeout(deferredFinalStateTimer);
    deferredFinalStateTimer = null;
  }
  finalStateDeferred = false;
  deferredFinalStateSnapshot = null;
  revealSeatShowStartedAt = null;
  endStateLocked = true;
  document.body.classList.add('final-end-ui');
  if (freezeSnapshot) lockFinalWinnerSeatFromState(freezeSnapshot);

  centerMessageMode = 'lose';
  showCenterMessage('GAME OVER', 'lose');
  setSpectatorButtonsDisabled(true);
  enableGameOverFreeze(freezeSnapshot);
  if (lateJoinFinishedState) {
    applyLateJoinFinishedCardsMask(freezeSnapshot || currentGameState);
  }
  scheduleFinalSeatCardLock();
  stopTimerUI();
}

function clearScheduledFinalSeatCardLock() {
  finalSeatLockTimers.forEach((t) => clearTimeout(t));
  finalSeatLockTimers = [];
}

function scheduleFinalSeatCardLock() {
  if (!endStateLocked && !document.body.classList.contains('final-end-ui')) return;
  clearScheduledFinalSeatCardLock();
  enforceFinalSeatCardLock();
  [40, 120, 260, 520, 900].forEach((delay) => {
    const t = setTimeout(() => {
      if (endStateLocked || document.body.classList.contains('final-end-ui')) {
        enforceFinalSeatCardLock();
      }
    }, delay);
    finalSeatLockTimers.push(t);
  });
}

function enforceFinalSeatCardLock() {
  if (!endStateLocked && !document.body.classList.contains('final-end-ui')) return;
  const table = document.querySelector('#poker_table, .poker-table');
  if (!table) return;

  const setImp = (el, prop, value) => {
    if (!el) return;
    el.style.setProperty(prop, value, 'important');
  };

  const ref = document.querySelector('#flop1, #board .boardcard, .board .card');
  const seatW = Math.max(42, Math.round(ref?.offsetWidth || ref?.getBoundingClientRect?.().width || 120));
  const seatH = Math.max(58, Math.round(ref?.offsetHeight || ref?.getBoundingClientRect?.().height || 147));
  const seatGap = Number.parseFloat(getComputedStyle(table).getPropertyValue('--seat-card-gap')) || 2;
  const tableRect = table.getBoundingClientRect();
  const boardRect = ref?.getBoundingClientRect?.() || null;
  table.style.setProperty('--seat-card-w', `${seatW}px`);
  table.style.setProperty('--seat-card-h', `${seatH}px`);
  table.style.setProperty('--seat-card-gap', `${seatGap}px`);

  const seatEls = Array.from(table.querySelectorAll('.seat:not(.my-seat)'));
  seatEls.forEach((seatEl) => {
    const hole = seatEl.querySelector('.holecards');
    const c1 = seatEl.querySelector('.holecard1');
    const c2 = seatEl.querySelector('.holecard2');
    if (!hole || !c1 || !c2) return;

    const seatIdNum = Number(String(seatEl.id || '').replace('seat', ''));
    const isTopRow = Number.isInteger(seatIdNum) ? seatIdNum <= 4 : true;
    const panel = seatEl.querySelector('.name-chips');
    const seatRect = seatEl.getBoundingClientRect();
    const scaleY = (tableRect.height > 0 && table.offsetHeight > 0)
      ? (tableRect.height / table.offsetHeight)
      : 1;
    const topFromBoard = (boardRect && seatRect)
      ? Math.round((boardRect.bottom - seatRect.top) / Math.max(0.01, scaleY))
      : null;
    const fallbackTop = Number.isFinite(hole.offsetTop) ? Math.round(hole.offsetTop) : null;
    const holeTop = isTopRow
      ? (Number.isFinite(topFromBoard) ? topFromBoard : fallbackTop)
      : Math.round(panel ? (panel.offsetTop + 6) : (fallbackTop ?? 70));

    setImp(hole, 'position', 'absolute');
    setImp(hole, 'left', '50%');
    if (Number.isFinite(holeTop)) {
      setImp(hole, 'top', `${holeTop}px`);
    }
    setImp(hole, 'width', `${seatW}px`);
    setImp(hole, 'height', `${Math.round(seatH * 2 + seatGap)}px`);
    setImp(hole, 'transform', 'translateX(-50%) translateY(var(--reveal-seat-dy, 0px))');

    setImp(c1, 'left', '0px');
    setImp(c1, 'top', '0px');
    setImp(c1, 'width', `${seatW}px`);
    setImp(c1, 'height', `${seatH}px`);
    setImp(c1, 'transform', 'none');

    setImp(c2, 'left', '0px');
    setImp(c2, 'top', `${Math.round(seatH + seatGap)}px`);
    setImp(c2, 'width', `${seatW}px`);
    setImp(c2, 'height', `${seatH}px`);
    setImp(c2, 'transform', 'none');
  });
}

function clearFinalSeatCardLockStyles() {
  const table = document.querySelector('#poker_table, .poker-table');
  const seatEls = Array.from(document.querySelectorAll('.seat:not(.my-seat)'));
  seatEls.forEach((seatEl) => {
    const hole = seatEl.querySelector('.holecards');
    const c1 = seatEl.querySelector('.holecard1');
    const c2 = seatEl.querySelector('.holecard2');
    [hole, c1, c2].forEach((el) => {
      if (!el) return;
      ['position', 'left', 'top', 'width', 'height', 'transform'].forEach((prop) => el.style.removeProperty(prop));
    });
  });
  if (table) {
    table.style.removeProperty('--seat-card-w');
    table.style.removeProperty('--seat-card-h');
    table.style.removeProperty('--seat-card-gap');
  }
}

function syncNonMySeatCardSize(){
  if (currentGameState?.demo && currentGameState.phase === 'reveal') {
    if (window.IMDCXTable?.layoutSeatCards(document.getElementById('poker_table'), currentGameState)) return;
  }
  // During game-over freeze/final lock we keep current seat-card layout untouched.
  if (endStateLocked || gameOverFreezeActive || document.body.classList.contains('final-end-ui')) return;

  const table = document.querySelector('#poker_table, .poker-table');
  const ref = document.querySelector('#flop1, #board .boardcard, .board .card');
  if (!table || !ref) return;
  if (document.body.classList.contains('imdcx-scene-mode') || !table.getClientRects().length) return;
  if (window.IMDCXTable?.layoutSeatCards(table, currentGameState)) return;
  const boardW = Math.max(42, Math.round(ref.offsetWidth || ref.getBoundingClientRect().width || 0));
  const boardH = Math.max(58, Math.round(ref.offsetHeight || ref.getBoundingClientRect().height || 0));
  table.style.setProperty('--board-card-w', boardW + 'px');
  table.style.setProperty('--board-card-h', boardH + 'px');

  // Keep seat reveal cards exactly the same size as the 5 board cards (responsive across devices).
  const seatCardW = boardW;
  const seatCardH = boardH;
  const seatCardGap = -2;
  const xShiftPx = 0;
  // Small visual breathing room without changing the rest of the layout/buttons.
  const seatEdgeGapPx = 10;
  const topCardGapPx = -seatEdgeGapPx;      // lift top-row reveal cards a little
  const bottomCardGapPx = -seatEdgeGapPx;   // lower bottom-row reveal cards a little
  const viewportW = Math.round(window.visualViewport?.width || window.innerWidth || 0);
  const isMobileLayout = viewportW <= 1024;
  const seatCardsLiftPx = isMobileLayout ? 4 : 7; // slight lift on phone, a bit more on desktop
  // Mobile: lower bottom-row reveal cards slightly vs desktop.
  const bottomSeatAnchorGapPx = isMobileLayout ? 168 : 192;

  table.style.setProperty('--seat-card-w', seatCardW + 'px');
  table.style.setProperty('--seat-card-h', seatCardH + 'px');
  table.style.setProperty('--seat-card-gap', `${seatCardGap}px`);
  table.style.setProperty('--seat-card-x', `${xShiftPx}px`);
  table.style.setProperty('--seat-card-top', Math.round(-seatCardH * 0.92) + 'px');

  // Separate anchors for top-row seats and bottom-row seats.
  // Top row: first card just under the 5 board cards.
  // Bottom row: keep cards inside their seat block.
  const seatEls = Array.from(table.querySelectorAll('.seat:not(.my-seat)'));
  const tableMidY = (table.offsetHeight || 600) / 2;
  const isTopSeat = (seat) => ((seat.offsetTop || 0) + ((seat.offsetHeight || 120) / 2)) < tableMidY;
  const topSeat = seatEls.find((s) => isTopSeat(s));
  const botSeat = seatEls.find((s) => !isTopSeat(s));
  const boardRect = ref.getBoundingClientRect();
  const tableRect = table.getBoundingClientRect();
  const mySeatEl = Number.isInteger(mySeatIndex) ? document.getElementById('seat' + mySeatIndex) : null;
  const myHole = mySeatEl ? mySeatEl.querySelector('.holecards') : null;
  const myCardsRect = myHole ? myHole.getBoundingClientRect() : null;
  const actionIds = ['odds-help-btn', 'btn-time', 'btn-add30', 'break-btn', 'stats-help-btn', 'rules-help-btn', 'sos-help-btn'];
  const actionBottoms = actionIds
    .map((id) => document.getElementById(id))
    .filter(Boolean)
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
    .map((r) => r.bottom);
  const myCardsBottom = (myCardsRect && Number.isFinite(myCardsRect.bottom)) ? myCardsRect.bottom : Number.NaN;
  const bottomAnchorScreen = [myCardsBottom, ...actionBottoms]
    .filter((v) => Number.isFinite(v))
    .reduce((max, v) => Math.max(max, v), Number.NEGATIVE_INFINITY);

  if (topSeat) {
    const topY = Math.round((boardRect.bottom - tableRect.top) - topSeat.offsetTop + topCardGapPx);
    table.style.setProperty('--seat-holecards-top-top', `${topY}px`);
  }

  if (botSeat) {
    const botPanel = botSeat.querySelector('.name-chips');
    const botY = Math.round(botPanel ? (botPanel.offsetTop + 0) : 50);
    table.style.setProperty('--seat-holecards-top-bottom', `${botY}px`);
  }

  // Force inline placement to bypass legacy CSS conflicts.
  const setImp = (el, prop, value) => {
    if (!el) return;
    el.style.setProperty(prop, value, 'important');
  };
  seatEls.forEach((seat) => {
    const hole = seat.querySelector('.holecards');
    const c1 = seat.querySelector('.holecard1');
    const c2 = seat.querySelector('.holecard2');
    if (!hole || !c1 || !c2) return;

    const seatIdNum = Number(String(seat.id || '').replace('seat', ''));
    const isTopRow = Number.isInteger(seatIdNum) ? seatIdNum <= 4 : isTopSeat(seat);
    const panel = seat.querySelector('.name-chips');
    const baseTop = isTopRow
      ? Math.round((boardRect.bottom - tableRect.top) - seat.offsetTop + topCardGapPx)
      : Math.round(panel ? (panel.offsetTop + 6) : 50);
    const seatRect = seat.getBoundingClientRect();
    const scaleY = (tableRect.height > 0 && table.offsetHeight > 0)
      ? (tableRect.height / table.offsetHeight)
      : 1;

    let holeTop = baseTop;
    if (isTopRow) {
      // First top-row card starts exactly under the 5 board cards.
      const desiredScreenTop = boardRect.bottom + topCardGapPx;
      holeTop = Math.round((desiredScreenTop - seatRect.top) / Math.max(0.01, scaleY));
    } else if (Number.isFinite(bottomAnchorScreen)) {
      // Bottom-row second card sits just above the bottom line of utility buttons
      // (%, T, 30, Pause, ?, SOS) and my personal cards.
      const desiredSecondCardBottom = bottomAnchorScreen - bottomSeatAnchorGapPx - bottomCardGapPx;
      holeTop = Math.round(
        ((desiredSecondCardBottom - seatRect.top) / Math.max(0.01, scaleY))
        - (seatCardH * 2 + seatCardGap)
      );
    }
    holeTop -= seatCardsLiftPx;

    setImp(hole, 'position', 'absolute');
    setImp(hole, 'left', '50%');
    setImp(hole, 'top', `${holeTop}px`);
    setImp(hole, 'width', `${seatCardW}px`);
    setImp(hole, 'height', `${seatCardH * 2 + seatCardGap}px`);
    setImp(hole, 'transform', `translateX(calc(-50% + ${xShiftPx}px)) translateY(var(--reveal-seat-dy, 0px))`);

    setImp(c1, 'left', '0px');
    setImp(c1, 'top', '0px');
    setImp(c1, 'width', `${seatCardW}px`);
    setImp(c1, 'height', `${seatCardH}px`);

    setImp(c2, 'left', '0px');
    setImp(c2, 'top', `${seatCardH + seatCardGap}px`);
    setImp(c2, 'width', `${seatCardW}px`);
    setImp(c2, 'height', `${seatCardH}px`);
  });
}
window.addEventListener('load', syncNonMySeatCardSize);
window.addEventListener('resize', syncNonMySeatCardSize);
// appelle aussi cette fonction juste aprÃƒÂ¨s le reveal du board


function showErrorToast(msg, duration = 2200){
  let t = document.getElementById('toast');
  if (!t){
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(()=> t.classList.remove('show'), duration);
}

// Auto-init au chargement de la page (immÃƒÂ©diat pour que le layout/seats soient prÃƒÂªts pendant l'intro)
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.initGame === 'function') {
    window.initGame();
  } else {
    console.error('[client] initGame nÃ¢â‚¬â„¢est pas dÃƒÂ©finie');
  }
});


function moveDealerToSeat(seatIndex) {
  const seat   = document.getElementById(`seat${seatIndex}`);
  const button = document.getElementById('button');
  if (!seat || !button) return;

  // 0) enlever les anciennes classes seatX-button ÃƒÂ©ventuelles
  button.className = button.className
    .split(' ')
    .filter(c => !/^seat\d+-button$/.test(c))
    .join(' ')
    .trim();

  // 1) mettre le bouton dans le siÃƒÂ¨ge
  if (button.parentElement !== seat) {
    seat.appendChild(button);
  }

  // 2) sÃ¢â‚¬â„¢assurer que le siÃƒÂ¨ge est positionnÃƒÂ©
  const seatStyle = getComputedStyle(seat);
  if (seatStyle.position === 'static') {
    seat.style.position = 'relative';
  }

  button.style.display = 'block';
  button.style.position = 'absolute';

  // on laisse le CSS gÃƒÂ©rer top/bottom/left
  button.style.top = '';
  button.style.bottom = '';
  button.style.left = '';
  button.style.transform = '';
}


function gui_place_dealer_button(seatIndex) {
  const btn = document.getElementById('button');
  if (!btn) return;

  // 1) enlever lÃ¢â‚¬â„¢ancienne marque "dealer-seat" sur tous les siÃƒÂ¨ges
  document.querySelectorAll('.seat.dealer-seat').forEach(s => {
    s.classList.remove('dealer-seat');
  });

  // 2) dÃƒÂ©placer le bouton sur le bon siÃƒÂ¨ge
  moveDealerToSeat(seatIndex);

  // 3) marquer ce siÃƒÂ¨ge comme contenant le dealer
  const seat = document.getElementById('seat' + seatIndex);
  if (seat) {
    seat.classList.add('dealer-seat');
  }
}

function adjustDealerOffset(dealerSeatIdx, sbSeatIdx) {
  const btn = document.getElementById('button');
  if (!btn) return;

  // centrÃƒÂ© par dÃƒÂ©faut
  let tx = -50;

  // si dealer = SB, pousse vers la gauche
  if (dealerSeatIdx != null && sbSeatIdx != null && dealerSeatIdx === sbSeatIdx) {
    tx = -75; // teste -70 / -80 selon le rendu
  }

  btn.style.transform = `translateX(${tx}%)`;
}

function gui_hide_dealer_button() {
  const btn = document.getElementById('button');
  if (!btn) return;
  btn.style.display = 'none';
}

function centerTableOnce() {
  try {
    if (_centeredTableOnce) return;   // on ne le fait quÃ¢â‚¬â„¢une seule fois
    const vv = window.visualViewport;
    const vw = Math.max(320, Math.round(vv?.width || window.innerWidth || 800));
    if (!isTouchMobileLayout(vw)) {
      _centeredTableOnce = true;
      return;
    }

    const table = document.getElementById('poker_table');
    if (!table) return;
    if (document.body.classList.contains('imdcx-scene-mode') || !table.getClientRects().length) return;

    _centeredTableOnce = true;

    // on laisse le layout se poser
    setTimeout(() => {
      if (document.body.classList.contains('imdcx-scene-mode') || !table.getClientRects().length) {
        _centeredTableOnce = false;
        return;
      }
      const rect     = table.getBoundingClientRect();
      const pageTop  = window.scrollY + rect.top;
      const pageLeft = window.scrollX + rect.left;
      const viewH    = window.innerHeight || document.documentElement.clientHeight;
      const viewW    = window.innerWidth || document.documentElement.clientWidth;

      // centre vertical
      let targetTop = pageTop - (viewH - rect.height) / 2;
      if (targetTop < 0) targetTop = 0;

      // centre horizontal
      let targetLeft = pageLeft - (viewW - rect.width) / 2;
      if (targetLeft < 0) targetLeft = 0;

      window.scrollTo({
        top:  targetTop,
        left: targetLeft,
        behavior: 'auto'   // pas de scroll smooth pour ÃƒÂ©viter des effets chelous
      });
    }, 250);
  } catch (e) {
    console.error('centerTableOnce error:', e);
  }
}


const btnTime = document.getElementById('btn-time');
const btnAdd30 = document.getElementById('btn-add30');
const revealHideBtn = document.getElementById('reveal-hide-btn');
const revealShowBtn = document.getElementById('reveal-show-btn');
const sosHelpBtn = document.getElementById('sos-help-btn');
const timeRulesModal = document.getElementById('time-rules-modal');
const add30RulesModal = document.getElementById('add30-rules-modal');
const add30ConfirmModal = document.getElementById('add30-confirm-modal');
const hideRulesModal = document.getElementById('hide-rules-modal');
const showRulesModal = document.getElementById('show-rules-modal');
const sosModal = document.getElementById('sos-modal');
const sosSendBtn = document.getElementById('sos-send-btn');
const sosChatModal = document.getElementById('sos-chat-modal');
const sosChatMessagesEl = document.getElementById('sos-chat-messages');
const sosChatInput = document.getElementById('sos-chat-input');
const sosChatSendBtn = document.getElementById('sos-chat-send');

function showTimeRules() {
  if (!timeRulesModal) return;
  timeRulesModal.classList.add('open');
  timeRulesModal.setAttribute('aria-hidden', 'false');
}

function hideTimeRules() {
  if (!timeRulesModal) return;
  timeRulesModal.classList.remove('open');
  timeRulesModal.setAttribute('aria-hidden', 'true');
}

function showAdd30Rules() {
  if (!add30RulesModal) return;
  add30RulesModal.classList.add('open');
  add30RulesModal.setAttribute('aria-hidden', 'false');
}

function hideAdd30Rules() {
  if (!add30RulesModal) return;
  add30RulesModal.classList.remove('open');
  add30RulesModal.setAttribute('aria-hidden', 'true');
}

function showAdd30Confirm() {
  if (!add30ConfirmModal) return;
  add30ConfirmModal.classList.add('open');
  add30ConfirmModal.setAttribute('aria-hidden', 'false');
}
function hideAdd30Confirm() {
  if (!add30ConfirmModal) return;
  add30ConfirmModal.classList.remove('open');
  add30ConfirmModal.setAttribute('aria-hidden', 'true');
}

function requestAdd30ClassicConfirm() {
  return new Promise(resolve => {
    add30ConfirmResolver = resolve;
    showAdd30Confirm();
  });
}

function showHideRules() {
  if (!hideRulesModal) return;
  hideRulesModal.classList.add('open');
  hideRulesModal.setAttribute('aria-hidden', 'false');
}
function hideHideRules() {
  if (!hideRulesModal) return;
  hideRulesModal.classList.remove('open');
  hideRulesModal.setAttribute('aria-hidden', 'true');
}
function showShowRules() {
  if (!showRulesModal) return;
  showRulesModal.classList.add('open');
  showRulesModal.setAttribute('aria-hidden', 'false');
}
function hideShowRules() {
  if (!showRulesModal) return;
  showRulesModal.classList.remove('open');
  showRulesModal.setAttribute('aria-hidden', 'true');
}

function showSosModal() {
  if (!sosModal) return;
  sosModal.classList.add('open');
  sosModal.setAttribute('aria-hidden', 'false');
}
function hideSosModal() {
  if (!sosModal) return;
  sosModal.classList.remove('open');
  sosModal.setAttribute('aria-hidden', 'true');
}

function getSosPlayerLabel() {
  const label = currentGameState?.players?.[mySeatIndex]?.label;
  if (label) return label;
  if (Number.isInteger(mySeatIndex)) return `Seat ${mySeatIndex + 1}`;
  return 'Unknown';
}

function ensureRevealCardButtons() {
  const hideHost = document.getElementById('fold-button');
  const showHost = document.getElementById('call-button');
  const action = document.getElementById('action-options');
  if (!hideHost || !showHost || !action) return { hideBtn: null, showBtn: null };

  let hideBtn = action.querySelector('.reveal-card-btn.hide.reveal-overlay');
  if (!hideBtn) {
    hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'reveal-card-btn hide reveal-overlay';
    hideBtn.textContent = 'HIDE';
    hideBtn.classList.add('is-disabled');
    hideBtn.setAttribute('aria-disabled', 'true');
    const onHideTap = () => {
      if (hideBtn.classList.contains('is-disabled')) {
        showHideRules();
        return;
      }
      if (!socket) return;
      socket.emit('revealChoice', { hide: true });
      hideRevealButton();
    };
    hideBtn.addEventListener('click', onHideTap);
    action.appendChild(hideBtn);
  }

  let showBtn = action.querySelector('.reveal-card-btn.show.reveal-overlay');
  if (!showBtn) {
    showBtn = document.createElement('button');
    showBtn.type = 'button';
    showBtn.className = 'reveal-card-btn show reveal-overlay';
    showBtn.textContent = 'SHOW';
    showBtn.classList.add('is-disabled');
    showBtn.setAttribute('aria-disabled', 'true');
    const onShowTap = () => {
      if (showBtn.classList.contains('is-disabled')) {
        showShowRules();
        return;
      }
      if (!socket) return;
      socket.emit('revealChoice', { hide: false });
      hideRevealButton();
    };
    showBtn.addEventListener('click', onShowTap);
    action.appendChild(showBtn);
  }

  const syncOverlayToHost = (btn, host) => {
    if (!btn || !host) return;
    btn.style.position = 'absolute';
    btn.style.boxSizing = 'border-box';
    // offset* stays in the same coordinate space as #action-options, even when the table is CSS-scaled.
    if (host.offsetParent === action) {
      btn.style.left = `${host.offsetLeft}px`;
      btn.style.top = `${host.offsetTop}px`;
      btn.style.width = `${host.offsetWidth}px`;
      btn.style.height = `${host.offsetHeight}px`;
      return;
    }
    // Fallback for unexpected DOM layout.
    const actionRect = action.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    btn.style.left = `${hostRect.left - actionRect.left}px`;
    btn.style.top = `${hostRect.top - actionRect.top}px`;
    btn.style.width = `${hostRect.width}px`;
    btn.style.height = `${hostRect.height}px`;
  };

  syncOverlayToHost(hideBtn, hideHost);
  syncOverlayToHost(showBtn, showHost);

  return { hideBtn, showBtn };
}

function setSosButtonMode(active) {
  if (!sosHelpBtn) return;
  sosChatActive = Boolean(active);
  // Keep the SOS label even when chat mode is active.
  sosHelpBtn.textContent = 'SOS';
}

function renderSosChatMessages() {
  if (!sosChatMessagesEl) return;
  sosChatMessagesEl.innerHTML = '';
  sosChatMessages.forEach((msg) => {
    const div = document.createElement('div');
    div.className = `sos-chat-msg ${msg.from === 'admin' ? 'admin' : 'me'}`;
    div.textContent = msg.text;
    sosChatMessagesEl.appendChild(div);
  });
  sosChatMessagesEl.scrollTop = sosChatMessagesEl.scrollHeight;
}

function openSosChat() {
  if (!sosChatModal) return;
  sosChatModal.classList.add('open');
  sosChatModal.setAttribute('aria-hidden', 'false');
  renderSosChatMessages();
  sosChatInput?.focus();
}

function closeSosChat() {
  if (!sosChatModal) return;
  sosChatModal.classList.remove('open');
  sosChatModal.setAttribute('aria-hidden', 'true');
}

function sendSosChatMessage() {
  if (!socket) {
    showErrorToast('Connexion indisponible.');
    return;
  }
  const text = String(sosChatInput?.value || '').trim();
  if (!text) return;
  sosChatInput.value = '';
  const payload = {
    tableID: _tableID || null,
    matchID: _match2ID || null,
    seatIndex: Number.isInteger(mySeatIndex) ? mySeatIndex : null,
    playerLabel: getSosPlayerLabel(),
    message: text
  };
  socket.emit('sosChatPlayerMessage', payload);
  sosChatMessages.push({ from: 'me', text, ts: Date.now() });
  renderSosChatMessages();
}

function getCalcStorageKey() {
  if (_match2ID) return `calcOpen_match2_${_match2ID}`;
  if (_tableID) return `calcOpen_table_${_tableID}`;
  return 'calcOpen_unknown';
}
function setCalcOpenFlag(isOpen) {
  const key = getCalcStorageKey();
  try {
    sessionStorage.setItem(key, isOpen ? '1' : '0');
  } catch (e) {}
}
function wasCalcOpenFlag() {
  const key = getCalcStorageKey();
  try {
    return sessionStorage.getItem(key) === '1';
  } catch (e) {
    return false;
  }
}

function restoreMyCardsIfNeeded(gs, opts = {}) {
  const force = Boolean(opts && opts.force);
  let myIdx = getMyIndexFromState(gs);
  if (myIdx < 0 && Number.isInteger(mySeatIndex)) myIdx = mySeatIndex;
  if (myIdx < 0) return false;
  const me = gs.players?.[myIdx];
  if (!me || me.status === 'BUST') return false;
  if (me.revealStatus === 'hide') return false;
  if (!me.carda || !me.cardb) return false;
  if (!force && Date.now() < myCardsBackLockUntil) return false;
  rememberMyKnownHoleCards(me.carda, me.cardb);
  gui_set_player_cards(me.carda, me.cardb, myIdx, false);
  const seatEl = document.getElementById('seat' + myIdx);
  if (seatEl) {
    seatEl.querySelectorAll('.holecards .card').forEach(card => card.classList.add('visible'));
  }
  myCardsRevealed = true;
  return true;
}

function maybeRestoreCalculator(gs) {
  if (calcRestoreHandled) return;
  if (!wasCalcOpenFlag()) return;
  const myIdx = getMyIndexFromState(gs);
  if (myIdx < 0) return;
  calcRestoreHandled = true;
  const me = gs.players?.[myIdx];
  const canOpen =
    me &&
    !['BUST','WAIT','FOLD'].includes(me.status) &&
    ['preflop','flop','turn','river'].includes(gs.phase) &&
    gs.current_bettor_index === myIdx;
  if (canOpen) {
    show_custom_raise({ skipNotify: true });
  } else {
    setCalcOpenFlag(false);
  }
}

function setTimeButtonEnabled(enabled) {
  if (!btnTime) return;
  btnTime.classList.toggle('is-disabled', !enabled);
  btnTime.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

function setAdd30ButtonEnabled(enabled) {
  if (!btnAdd30) return;
  btnAdd30.classList.toggle('is-disabled', !enabled);
  btnAdd30.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}

function setCalcAdd30Enabled(enabled) {
  const calcBtn = document.getElementById('calc-add30-btn');
  if (!calcBtn) return;
  calcBtn.disabled = !enabled;
  calcBtn.classList.toggle('is-disabled', !enabled);
}

async function ensureAdd30ClassicConfirmedIfNeeded() {
  if (!currentGameState || !Array.isArray(currentGameState.players)) return true;
  if (String(currentGameState.level || '').trim().toUpperCase() === 'Q0') return true;
  const me = currentGameState.players.find(p => p && p.id === mySocketId);
  if (!me) return true;
  const timeCredits = Number.isFinite(me.timeCredits) ? Math.max(0, Math.floor(me.timeCredits)) : 0;
  const credits = Number.isFinite(me.credits) ? Math.max(0, Math.floor(me.credits)) : 0;
  if (timeCredits <= 0 && credits <= 0) {
    showErrorToast("Vous avez epuise vos credits TIME et credits classiques.", 4200);
    return false;
  }
  if (timeCredits > 0) return true;
  if (add30ClassicConfirmed) return true;
  const ok = await requestAdd30ClassicConfirm();
  if (ok) {
    add30ClassicConfirmed = true;
    refreshCreditsDisplay();
  }
  return ok;
}

function hideRevealButton() {
  const { hideBtn, showBtn } = ensureRevealCardButtons();
  document.body.classList.remove('reveal-choice-active');
  if (hideBtn) {
    hideBtn.style.display = 'none';
    hideBtn.classList.add('is-disabled');
    hideBtn.setAttribute('aria-disabled', 'true');
    hideBtn.textContent = 'HIDE';
  }
  if (showBtn) {
    showBtn.style.display = 'none';
    showBtn.classList.add('is-disabled');
    showBtn.setAttribute('aria-disabled', 'true');
    showBtn.textContent = 'SHOW';
  }
  if (revealHideBtn) revealHideBtn.style.display = 'none';
  if (revealShowBtn) revealShowBtn.style.display = 'none';

  if (revealPromptTimer) {
    clearInterval(revealPromptTimer);
    revealPromptTimer = null;
  }
  revealPromptDeadline = null;
}

function showRevealButton(ms) {
  const { hideBtn, showBtn } = ensureRevealCardButtons();
  if (!hideBtn && !showBtn) return;
  document.body.classList.add('reveal-choice-active');
  const deadline = Date.now() + (ms || 5000);
  revealPromptDeadline = deadline;
  if (hideBtn) {
    hideBtn.style.display = 'flex';
    hideBtn.classList.remove('is-disabled');
    hideBtn.setAttribute('aria-disabled', 'false');
  }
  if (showBtn) {
    showBtn.style.display = 'flex';
    showBtn.classList.remove('is-disabled');
    showBtn.setAttribute('aria-disabled', 'false');
  }
  if (revealHideBtn) revealHideBtn.style.display = 'none';
  if (revealShowBtn) revealShowBtn.style.display = 'none';

  if (currentGameState?.demo) {
    if (revealPromptTimer) clearInterval(revealPromptTimer);
    revealPromptDeadline = null;
    if (hideBtn) hideBtn.textContent = 'HIDE';
    if (showBtn) showBtn.textContent = 'SHOW';
    return;
  }

  const tick = () => {
    ensureRevealCardButtons();
    const remainingMs = Math.max(0, deadline - Date.now());
    const secs = Math.ceil(remainingMs / 1000);
    if (hideBtn) hideBtn.textContent = `HIDE\n${secs}`;
    if (showBtn) showBtn.textContent = `SHOW\n${secs}`;
    if (remainingMs <= 0) {
      hideRevealButton();
    }
  };

  tick();
  if (revealPromptTimer) clearInterval(revealPromptTimer);
  revealPromptTimer = setInterval(tick, 200);
}

function canUseAdd30() {
  if (!currentGameState) return false;
  if (!['preflop','flop','turn','river'].includes(currentGameState.phase)) return false;
  if (!Number.isInteger(mySeatIndex) || mySeatIndex < 0) return false;
  if (currentGameState.current_bettor_index !== mySeatIndex) return false;
  const me = currentGameState.players?.[mySeatIndex];
  if (!me) return false;
  if (['BUST','WAIT'].includes(me.status)) return false;
  return true;
}

if (btnTime) {
  setTimeButtonEnabled(false);
}

if (btnAdd30) {
  setAdd30ButtonEnabled(false);
}

if (revealHideBtn) {
  hideRevealButton();
  revealHideBtn.addEventListener('click', () => {
    if (revealHideBtn.classList.contains('is-disabled')) {
      showHideRules();
      return;
    }
    if (!socket) return;
    socket.emit('revealChoice', { hide: true });
    hideRevealButton();
  });
}
if (revealShowBtn) {
  hideRevealButton();
  revealShowBtn.addEventListener('click', () => {
    if (revealShowBtn.classList.contains('is-disabled')) {
      showShowRules();
      return;
    }
    if (!socket) return;
    socket.emit('revealChoice', { hide: false });
    hideRevealButton();
  });
}

if (sosHelpBtn) {
  sosHelpBtn.addEventListener('click', () => {
    if (sosChatActive) {
      openSosChat();
      return;
    }
    showSosModal();
  });
}

if (sosSendBtn) {
  sosSendBtn.addEventListener('click', () => {
    if (!socket) {
      showErrorToast('Connexion indisponible.');
      return;
    }
    const payload = {
      tableID: _tableID || null,
      matchID: _match2ID || null,
      seatIndex: Number.isInteger(mySeatIndex) ? mySeatIndex : null,
      playerLabel: getSosPlayerLabel()
    };
    socket.emit('sosAlert', payload);
    showErrorToast("Alerte envoyee a l'admin.", 2600);
    hideSosModal();
    setSosButtonMode(true);
    openSosChat();
  });
}

function refreshTimeButtonVisibility() {
  if (!btnTime) return;
  if (endStateLocked) {
    setTimeButtonEnabled(false);
    return;
  }

  const mySeat = mySeatIndex;
  const me     = currentGameState?.players?.[mySeat];

  if (!me || window.currentFrozenSeat == null) {
    setTimeButtonEnabled(false);
    return;
  }

  const isAlive =
    !['FOLD','BUST'].includes(me.status) &&
    ((me.bankroll || 0) > 0);

  const canUse = isAlive && (mySeat !== window.currentFrozenSeat);
  setTimeButtonEnabled(canUse);
}

function refreshAdd30ButtonVisibility() {
  const enabled = canUseAdd30();
  setAdd30ButtonEnabled(enabled);
  setCalcAdd30Enabled(enabled);
  if (getMyTimeCreditsFromState() > 0) {
    add30NoTimeWarned = false;
  }
}

if (btnTime) {
  btnTime.addEventListener('click', () => {
    if (btnTime.classList.contains('is-disabled')) {
      showTimeRules();
      return;
    }
    if (!socket) return;
    socket.emit('requestTime');
    setTimeButtonEnabled(false);
  });
}

if (btnAdd30) {
  btnAdd30.addEventListener('click', async () => {
    if (!canUseAdd30()) {
      showAdd30Rules();
      return;
    }
    const ok = await ensureAdd30ClassicConfirmedIfNeeded();
    if (!ok) return;
    const okMsg = showAdd30CreditsMessage();
    if (okMsg === false) return;
    socket.emit('requestAdd30');
    applyLocalAdd30(30000);
  });
}

if (timeRulesModal) {
  timeRulesModal.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.matches('[data-time-rules-close="true"]')) {
      hideTimeRules();
    }
  });
}

if (add30RulesModal) {
  add30RulesModal.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.matches('[data-add30-rules-close="true"]')) {
      hideAdd30Rules();
    }
  });
}
if (add30ConfirmModal) {
  add30ConfirmModal.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.matches('[data-add30-confirm-close="true"]')) {
      hideAdd30Confirm();
      if (add30ConfirmResolver) add30ConfirmResolver(false);
      add30ConfirmResolver = null;
      return;
    }
    const choice = target.getAttribute('data-add30-confirm');
    if (choice === 'yes' || choice === 'no') {
      hideAdd30Confirm();
      if (add30ConfirmResolver) add30ConfirmResolver(choice === 'yes');
      add30ConfirmResolver = null;
    }
  });
}
if (hideRulesModal) {
  hideRulesModal.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.matches('[data-hide-rules-close="true"]')) {
      hideHideRules();
    }
  });
}
if (showRulesModal) {
  showRulesModal.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.matches('[data-show-rules-close="true"]')) {
      hideShowRules();
    }
  });
}

if (sosModal) {
  sosModal.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.matches('[data-sos-close="true"]')) {
      hideSosModal();
    }
  });
}

if (sosChatModal) {
  sosChatModal.addEventListener('click', (e) => {
    const target = e.target;
    if (!target) return;
    if (target.matches('[data-sos-chat-close="true"]')) {
      closeSosChat();
    }
  });
}

if (sosChatSendBtn) {
  sosChatSendBtn.addEventListener('click', () => {
    sendSosChatMessage();
  });
}
if (sosChatInput) {
  sosChatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      sendSosChatMessage();
    }
  });
}



