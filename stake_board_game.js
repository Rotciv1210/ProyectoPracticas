// ─── CONSTANTES ───────────────────────────────────────────────────────────────
const CELLS = 16;

const audioInicio = new Audio('audio/audio_inicio.mp3');
audioInicio.volume = 1;

const audioCartas = new Audio('audio/audio_cartas.mp3');
audioCartas.volume = 1;

const audioDerrota = new Audio('audio/derrota.mp3');
audioDerrota.volume = 1;

const audioVictoria = new Audio('audio/victoria.mp3');
audioVictoria.volume = 1;

const CARD_BACKS = ['card-back-a','card-back-b','card-back-c','card-back-d'];

const SPECIAL_EVENTS = {
  DOUBLE_WIN: {
    name: 'CARTA RARA',
    label: 'Carta Rara encontrada — ganas el doble',
    probability: 0.05
  },
  LOSE_HALF: {
    name: 'CARTA MALDITA',
    label: 'Carta maldita — pierdes la mitad',
    probability: 0.08
  },
  INSTANT_RACHA: {
    name: 'MANÁ EXTRA',
    label: 'Maná extra — tu racha sube 3',
    probability: 0.06
  },
  RESET_RACHA: {
    name: 'HECHIZO ROTO',
    label: 'Hechizo roto — racha a cero, recuperas la mitad',
    probability: 0.07
  },
  TRIPLE_WIN: {
    name: 'BLACK LOTUS',
    label: 'BLACK LOTUS — ganas el triple',
    probability: 0.04
  }
};

// ─── ESTADO ──────────────────────────────────────────────────────────────────
let gameState = {
  initialBalance: 10000,
  currentBalance: 10000,
  totalWins: 0,
  totalLosses: 0,
  currentStreak: 0,
  maxStreak: 0,
  specialEventsTriggered: 0,
  playedCells: new Set(),
  currentCell: null,
  currentBet: 0,
  eventOccurred: null,
  selectedBet: 100,
  selectedBetMode: 'fixed'
};

// ─── SPLASH ──────────────────────────────────────────────────────────────────
function startGame() {
  const splash = document.getElementById('splashScreen');

  splash.classList.add('hidden');
  document.getElementById('gameScreen').classList.add('visible');

  initializeBoard();
  updateUI();
}

function intentarReproducirAudio() {
  audioInicio.play()
    .then(() => {
      console.log('Audio iniciado');
    })
    .catch(() => {
      console.log('Autoplay bloqueado');
    });
}

// intentar apenas carga
window.addEventListener('load', () => {
  intentarReproducirAudio();
});

// si el navegador lo bloquea,
// cualquier interacción lo activará automáticamente
document.addEventListener('click', intentarReproducirAudio, { once: true });
document.addEventListener('touchstart', intentarReproducirAudio, { once: true });
document.addEventListener('mousemove', intentarReproducirAudio, { once: true });

// Alias por si el onclick del HTML lo llama directamente
window.startGame   = startGame;
window.goToSplash  = goToSplash;
window.closeResultModal = closeResultModal;
window.selectBet = selectBet;

// ─── TABLERO ─────────────────────────────────────────────────────────────────
// Mapa cellIndex → src imagen revelada (para zoom al hacer click posterior)
const revealedImages = {};

function initializeBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  Object.keys(revealedImages).forEach(k => delete revealedImages[k]);

  for (let i = 0; i < CELLS; i++) {
    const card = document.createElement('div');
    card.className = 'card';
    card.id = `cell-${i}`;
    card.setAttribute('data-index', i);
    card.innerHTML = `
      <div class="card-inner">
        <div class="card-face card-back">
          ${svgCardBack()}
        </div>
        <div class="card-face card-front"></div>
      </div>`;
    card.onclick = () => onCardClick(i);
    board.appendChild(card);
  }
}

function onCardClick(i) {
  if (gameState.playedCells.has(i)) {
    // Carta ya revelada → abrir en zoom
    if (revealedImages[i]) openCardZoom(revealedImages[i]);
  } else {
    playCell(i);
  }
}

function openCardZoom(src) {
  document.getElementById('cardZoomImg').src = src;
  document.getElementById('cardZoomOverlay').classList.remove('hidden');
}

function closeCardZoom() {
  document.getElementById('cardZoomOverlay').classList.add('hidden');
}
window.closeCardZoom = closeCardZoom;

function svgCardBack() {
  return `<svg viewBox="0 0 60 84" xmlns="http://www.w3.org/2000/svg">
    <rect width="60" height="84" rx="4" fill="#1a0533"/>
    <rect x="3" y="3" width="54" height="78" rx="3" fill="none" stroke="#6b21a8" stroke-width="1"/>
    <rect x="6" y="6" width="48" height="72" rx="2" fill="none" stroke="#4c1d95" stroke-width="0.5"/>
    <path d="M30 10 L50 74 L10 74 Z" fill="none" stroke="#7c3aed" stroke-width="0.8" opacity="0.4"/>
    <circle cx="30" cy="42" r="12" fill="none" stroke="#7c3aed" stroke-width="0.8" opacity="0.5"/>
    <circle cx="30" cy="42" r="6" fill="#4c1d95" opacity="0.6"/>
    <path d="M30 30 L34 38 L30 46 L26 38 Z" fill="#6b21a8" opacity="0.7"/>
  </svg>`;
}

// ─── IMÁGENES CARA FRONTAL ───────────────────────────────────────────────────
// Mapeo resultado → archivo en carpeta imagenes/
const CARD_IMAGES = {
  win: {
    TRIPLE_WIN:    'imagenes/black_lotus.png',
    DOUBLE_WIN:    'imagenes/carta_rara.png',
    INSTANT_RACHA: 'imagenes/mana_extra.png',
    default:       'imagenes/victoria.png',
  },
  lose: {
    LOSE_HALF:   'imagenes/maldicion.png',
    RESET_RACHA: 'imagenes/hechizo_roto.png',
    default:     'imagenes/derrota.png',
  }
};

function getCardImage(outcome, event) {
  const map = CARD_IMAGES[outcome];
  return (event && map[event]) ? map[event] : map.default;
}

function revealCardFront(cellIndex, outcome, event) {
  const front = document.querySelector(`#cell-${cellIndex} .card-front`);
  if (!front) return;
  const src = getCardImage(outcome, event);
  // Guardar para poder hacer zoom después
  revealedImages[cellIndex] = src;
  const img = document.createElement('img');
  img.src = src;
  img.alt = '';
  img.draggable = false;
  img.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;';
  front.innerHTML = '';
  front.appendChild(img);
}

// ─── APUESTA ─────────────────────────────────────────────────────────────────
function playCell(cellIndex) {
  if (gameState.playedCells.has(cellIndex)) return;

  // Validar que la apuesta sea válida
  if (gameState.selectedBet > gameState.currentBalance) {
    gameState.selectedBet = gameState.currentBalance;
  }

  gameState.currentCell = cellIndex;
  gameState.currentBet = gameState.selectedBet;

  executeRound();
}

function selectBet(value) {
  if (value === 'half') {
    gameState.selectedBetMode = 'half';
    gameState.selectedBet = Math.max(1, Math.floor(gameState.currentBalance * 0.5));
  }
  else if (value === 'all') {
    gameState.selectedBetMode = 'all'; 
    gameState.selectedBet = gameState.currentBalance;
  }
  else {
    gameState.selectedBetMode = 'fixed';
    gameState.selectedBet = value;
  }

  // Asegurar que la apuesta no supere el balance
  if (gameState.selectedBet > gameState.currentBalance) {
    gameState.selectedBet = gameState.currentBalance;
  }

  // Actualizar el display
  const display = document.getElementById('selectedBetDisplay');
  if (display) {
    display.textContent = gameState.selectedBet.toLocaleString();
  }

  // Sincronizar el input numérico por si usas uno (ej. con id="betAmount")
  const input = document.getElementById('betAmount');
  if (input) {
    input.value = gameState.selectedBet;
  }

  updateBetButtons();
}

function updateBetButtons() {
  document.querySelectorAll('.bet-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  let active = null;
  // Primero intenta buscar por el modo activo ('half' o 'all')
  if (gameState.selectedBetMode !== 'fixed') {
    active = document.querySelector(`[data-bet="${gameState.selectedBetMode}"]`);
  }

  // Si no lo encuentra o es modo fijo, busca por el número exacto
  if (!active) {
    active = document.querySelector(`[data-bet="${gameState.selectedBet}"]`);
  }

  if (active) active.classList.add('active');
}

// ─── RONDA ───────────────────────────────────────────────────────────────────
const RPS_BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
const RPS_KEYS  = ['rock', 'paper', 'scissors'];

function playUntilWinner() {
  let rounds = [], outcome;
  do {
    const p = RPS_KEYS[Math.floor(Math.random() * 3)];
    const c = RPS_KEYS[Math.floor(Math.random() * 3)];
    outcome  = p === c ? 'tie' : (RPS_BEATS[p] === c ? 'win' : 'lose');
    rounds.push({ p, c, outcome });
  } while (outcome === 'tie');
  return rounds;
}

function rpsLabel(key) {
  return { rock: 'Espada', paper: 'Escudo', scissors: 'Hechizo' }[key];
}

function checkSpecialEvent() {
  const rand = Math.random();
  let cum = 0;
  for (const [k, ev] of Object.entries(SPECIAL_EVENTS)) {
    cum += ev.probability;
    if (rand < cum) return k;
  }
  return null;
}

function executeRound() {
  gameState.playedCells.add(gameState.currentCell);
  const card = document.getElementById(`cell-${gameState.currentCell}`);
  card.classList.add('played');

  const rounds       = playUntilWinner();
  const final        = rounds[rounds.length - 1];
  const ties         = rounds.length - 1;
  const won          = final.outcome === 'win';
  const specialEvent = checkSpecialEvent();
  gameState.eventOccurred = specialEvent;

  // reveal: inyectar SVG en cara frontal ANTES de girar
  revealCardFront(gameState.currentCell, won ? 'win' : 'lose', specialEvent);
  
  // sonido al girar carta
  audioCartas.currentTime = 0;
  audioCartas.play().catch(() => {});
  requestAnimationFrame(() => card.classList.add('flipped'));

  let tieTxt = '';
  if (ties > 0) tieTxt = `<p class="tie-note">${ties} empate${ties > 1 ? 's' : ''} — se continuó la batalla</p>`;
  const finalTxt = `<p class="rps-result">${rpsLabel(final.p)} vs ${rpsLabel(final.c)}</p>`;

  setTimeout(() => {
    const titleEl  = document.getElementById('resultTitle');
    const textEl   = document.getElementById('resultText');
    const statusEl = document.getElementById('resultStatus');
    const amountEl = document.getElementById('resultAmount');
    const iconEl   = document.getElementById('resultIcon');

    textEl.innerHTML  = tieTxt + finalTxt;

    if (won) {
      processWin(specialEvent, titleEl, statusEl, amountEl, iconEl);
    } else {
      processLoss(specialEvent, titleEl, statusEl, amountEl, iconEl);
    }
    document.getElementById('resultModal').classList.remove('hidden');
  }, 350);
}

// ─── MATEMÁTICA STATELESS ────────────────────────────────────────────────────
function streakMultiplier(streak) {
  return 1.0 + Math.min(streak, 16) * 0.04;
}

function computePayout(bet, outcome, event, streakBefore) {
  const H = 0.72;
  if (outcome === 'win') {
    if (event === 'DOUBLE_WIN')    return Math.floor(bet * 1.44);
    if (event === 'TRIPLE_WIN')    return Math.floor(bet * 2.16);
    if (event === 'INSTANT_RACHA') return Math.floor(bet * H * (streakMultiplier(streakBefore) + 0.2));
    return Math.floor(bet * H * streakMultiplier(streakBefore));
  } else {
    if (event === 'LOSE_HALF')   return -Math.floor(bet * 0.5);
    if (event === 'RESET_RACHA') return -Math.floor(bet * 0.5);
    return -bet;
  }
}

function processWin(specialEvent, titleEl, statusEl, amountEl, iconEl) {
  const streakBefore = gameState.currentStreak;
  gameState.totalWins++;

  let eventName = '';
  if (specialEvent === 'INSTANT_RACHA') {
    gameState.currentStreak += 3;
    gameState.specialEventsTriggered++;
    eventName = SPECIAL_EVENTS.INSTANT_RACHA.name;
  } else if (specialEvent === 'DOUBLE_WIN') {
    gameState.currentStreak++;
    gameState.specialEventsTriggered++;
    eventName = SPECIAL_EVENTS.DOUBLE_WIN.name;
  } else if (specialEvent === 'TRIPLE_WIN') {
    gameState.currentStreak++;
    gameState.specialEventsTriggered++;
    eventName = SPECIAL_EVENTS.TRIPLE_WIN.name;
  } else {
    gameState.currentStreak++;
  }

  if (gameState.currentStreak > gameState.maxStreak) gameState.maxStreak = gameState.currentStreak;

  const delta = computePayout(gameState.currentBet, 'win', specialEvent, streakBefore);
  gameState.currentBalance += delta;

  titleEl.textContent   = eventName || 'VICTORIA';
  titleEl.className     = 'modal-title win';
  statusEl.textContent  = `+${delta.toLocaleString()} fichas`;
  statusEl.className    = 'result-status win';
  amountEl.textContent  = specialEvent ? SPECIAL_EVENTS[specialEvent].label : '';
  iconEl.innerHTML      = svgWin(specialEvent);

  const mult = streakMultiplier(gameState.currentStreak).toFixed(2);
  document.getElementById('streakInfo').textContent =
    `Racha: ${gameState.currentStreak}  |  Siguiente mult: x${mult}`;
}

function processLoss(specialEvent, titleEl, statusEl, amountEl, iconEl) {
  gameState.totalLosses++;

  let eventName = '';
  if (specialEvent === 'LOSE_HALF') {
    gameState.specialEventsTriggered++;
    eventName = SPECIAL_EVENTS.LOSE_HALF.name;
  } else if (specialEvent === 'RESET_RACHA') {
    gameState.currentStreak = 0;
    gameState.specialEventsTriggered++;
    eventName = SPECIAL_EVENTS.RESET_RACHA.name;
  } else {
    gameState.currentStreak = 0;
  }

  const delta = computePayout(gameState.currentBet, 'lose', specialEvent, gameState.currentStreak);
  gameState.currentBalance += delta;

  titleEl.textContent   = eventName || 'DERROTA';
  titleEl.className     = 'modal-title lose';
  statusEl.textContent  = `${delta.toLocaleString()} fichas`;
  statusEl.className    = 'result-status lose';
  amountEl.textContent  = specialEvent ? SPECIAL_EVENTS[specialEvent].label : '';
  iconEl.innerHTML      = svgLose(specialEvent);

  document.getElementById('streakInfo').textContent =
    specialEvent === 'LOSE_HALF'
      ? `Racha conservada: ${gameState.currentStreak}`
      : 'Racha reiniciada';
}

// ─── SVG ICONOS DE RESULTADO ──────────────────────────────────────────────────
function svgWin(event) {
  if (event === 'TRIPLE_WIN') return svgBlackLotus();
  return `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" width="80" height="80">
    <circle cx="40" cy="40" r="36" fill="#064e3b" stroke="#06d6a0" stroke-width="2"/>
    <path d="M24 40 L35 52 L56 28" stroke="#06d6a0" stroke-width="4" stroke-linecap="round" fill="none"/>
  </svg>`;
}

function svgLose(event) {
  return `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" width="80" height="80">
    <circle cx="40" cy="40" r="36" fill="#450a0a" stroke="#ef4444" stroke-width="2"/>
    <path d="M28 28 L52 52 M52 28 L28 52" stroke="#ef4444" stroke-width="4" stroke-linecap="round" fill="none"/>
  </svg>`;
}

function svgBlackLotus() {
  return `<svg viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg" width="80" height="80">
    <circle cx="40" cy="40" r="36" fill="#1a0533" stroke="#a855f7" stroke-width="2"/>
    <ellipse cx="40" cy="30" rx="10" ry="16" fill="#6b21a8" transform="rotate(-20,40,30)"/>
    <ellipse cx="40" cy="30" rx="10" ry="16" fill="#7c3aed" transform="rotate(20,40,30)"/>
    <ellipse cx="40" cy="28" rx="8" ry="14" fill="#9333ea"/>
    <ellipse cx="40" cy="52" rx="6" ry="4" fill="#4c1d95"/>
    <rect x="38" y="44" width="4" height="10" rx="2" fill="#4c1d95"/>
  </svg>`;
}

// ─── CERRAR MODALES ───────────────────────────────────────────────────────────
function closeResultModal() {
  document.getElementById('resultModal').classList.add('hidden');
  updateUI();
  if (gameState.currentBalance <= 0) { showBroke(); return; }
  if (gameState.playedCells.size === CELLS) showGameOver();
}

// ─── UI ───────────────────────────────────────────────────────────────────────
function updateUI() {
  if (gameState.selectedBetMode === 'half') {
    gameState.selectedBet = Math.max(1, Math.floor(gameState.currentBalance * 0.5));
  } else if (gameState.selectedBetMode === 'all') {
    gameState.selectedBet = gameState.currentBalance;
  }

  // Asegurar que la apuesta no supere el balance
  if (gameState.selectedBet > gameState.currentBalance) {
    gameState.selectedBet = gameState.currentBalance;
  }

  document.getElementById('balance').textContent = gameState.currentBalance.toLocaleString();
  document.getElementById('wins').textContent    = gameState.totalWins;
  document.getElementById('losses').textContent  = gameState.totalLosses;
  document.getElementById('streak').textContent  = gameState.currentStreak;
  const mult = (1 + gameState.currentStreak * 0.04).toFixed(2);
  document.getElementById('streakMulti').textContent = `x${mult}`;
  document.getElementById('cells').textContent   = `${gameState.playedCells.size}/16`;
  
  const betDisplay = document.getElementById('selectedBetDisplay');
  if (betDisplay) {
    betDisplay.textContent = gameState.selectedBet.toLocaleString();
  }

  // Sincronizar el campo input si existe en tu HTML
  const input = document.getElementById('betAmount');
  if (input) {
    input.value = gameState.selectedBet;
  }

  // 👇 Refrescar visualmente los botones para que el de 50% o MAX siga encendido
  updateBetButtons();
}

// ─── BROKE ───────────────────────────────────────────────────────────────────
function showBroke() {
  audioDerrota.currentTime = 0;
  audioDerrota.play().catch(() => console.log("Audio bloqueado por el navegador"));

  document.getElementById('brokeWins').textContent   = gameState.totalWins;
  document.getElementById('brokeCells').textContent  = gameState.playedCells.size;
  document.getElementById('brokeStreak').textContent = gameState.maxStreak;
  document.getElementById('brokeScreen').classList.remove('hidden');
}

function goToSplash() {
  gameState = {
    initialBalance: 10000, 
    currentBalance: 10000,
    totalWins: 0, 
    totalLosses: 0,
    currentStreak: 0, 
    maxStreak: 0,
    specialEventsTriggered: 0,
    playedCells: new Set(),
    currentCell: null,
    currentBet: 0,
    selectedBet: 100,
    selectedBetMode: 'fixed',
    eventOccurred: null
  };

  // Ocultar pantallas activas
  document.getElementById('brokeScreen').classList.add('hidden');
  document.getElementById('gameScreen').classList.remove('visible');
  document.getElementById('gameOverScreen').classList.add('hidden');

  // Resetear splash: eliminar inline styles que dejó la transición CSS
  const splash = document.getElementById('splashScreen');
  splash.removeAttribute('style');   // limpia opacity/pointerEvents inline
  splash.classList.remove('hidden'); // quita la clase que lo ocultaba

  initializeBoard();
  updateUI();
}

// ─── GAME OVER  ─────────────────────────────────────
function showGameOver() {
  const profit    = gameState.currentBalance - gameState.initialBalance;
  const cls       = profit >= 0 ? 'positive' : 'negative';
  
  if (profit >= 0) {
    // Si terminó con saldo positivo o igual (sin perder dinero)
    audioVictoria.currentTime = 0;
    audioVictoria.play().catch(() => console.log("Audio de victoria bloqueado por el navegador"));
  } else {
    // Si terminó con saldo negativo (perdiendo dinero)
    audioDerrota.currentTime = 0;
    audioDerrota.play().catch(() => console.log("Audio de derrota bloqueado por el navegador"));
  }

  document.getElementById('finalWins').textContent   = gameState.totalWins;
  document.getElementById('finalLosses').textContent = gameState.totalLosses;
  document.getElementById('finalMaxStreak').textContent = gameState.maxStreak;
  document.getElementById('finalEvents').textContent = gameState.specialEventsTriggered;
  document.getElementById('finalBalance').textContent = gameState.currentBalance.toLocaleString();
  document.getElementById('finalBalance').className   = `balance-value ${cls}`;
  document.getElementById('gameScreen').classList.remove('visible');
  document.getElementById('gameOverScreen').classList.remove('hidden');
}