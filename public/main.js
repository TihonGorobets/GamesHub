/**
 * main.js
 * GamesHub – Client application entry point.
 *
 * Navigation flow:
 *   Landing (nickname) → Hub (game grid) → Detail (pick create/join) → Lobby → Game
 *
 * Handles: Socket.IO, screen routing, lobby, and game orchestration.
 * The "Who Is It?" game UI is rendered via HTML panels (overlaid on the Phaser canvas).
 * Phaser is used for animated background scenes.
 */

import { WhoIsItGame } from '/games/who-is-it/game.js';

// ─────────────────────────────────────────────────────────
//  SOCKET
// ─────────────────────────────────────────────────────────
const socket = io({ autoConnect: true });

// ─────────────────────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────────────────────
let state = {
  myId:             null,
  room:             null,     // { id, host, players, gameType, phase }
  nickname:         null,
  selectedGameId:   null,
  allGames:         [],       // cached from server
  phaserGame:       null,
  hasSubmittedFact: false,
  hasVoted:         false,
};

// ─────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

// ─────────────────────────────────────────────────────────
//  LANDING MUSIC
// ─────────────────────────────────────────────────────────
const landingMusic = $('landing-music');
let musicMuted     = true;   // muted by default on first visit
let musicStarted   = false;
if (landingMusic) landingMusic.muted = true;

function startLandingMusic() {
  if (!landingMusic) return;
  if (musicMuted) return;
  landingMusic.volume = 0.35;
  const p = landingMusic.play();
  // Promise resolves only if playback actually starts (autoplay may be blocked)
  if (p && p.then) {
    p.then(() => { musicStarted = true; }).catch(() => { musicStarted = false; });
  } else {
    // Older browsers may not return a promise
    musicStarted = !landingMusic.paused;
  }
}
function stopLandingMusic() {
  if (!landingMusic) return;
  landingMusic.pause();
  landingMusic.currentTime = 0;
  musicStarted = false;
}

// Mute toggle button
const btnMusicToggle = $('btn-music-toggle');
const musicIcon      = $('music-icon');
function updateMusicIcon() {
  if (!musicIcon) return;
  musicIcon.className = musicMuted
    ? 'fi fi-rr-volume-mute'
    : 'fi fi-rr-volume';
  btnMusicToggle?.classList.toggle('muted', musicMuted);
}
if (btnMusicToggle) {
  // Reflect the default-muted state in the icon immediately
  updateMusicIcon();
  btnMusicToggle.addEventListener('click', () => {
    musicMuted = !musicMuted;
    if (landingMusic) landingMusic.muted = musicMuted;
    updateMusicIcon();
    // Unmuting for first time – start playback now
    if (!musicMuted && landingMusic && landingMusic.paused) startLandingMusic();
  });
}

// ─────────────────────────────────────────────────────────
//  FLOATING CHARACTERS (Among Us style)
// ─────────────────────────────────────────────────────────
const FLOATER_SRCS = [
  '/memes/igor_meme/igor1.png',
  '/memes/igor_meme/igor2.png',
  '/memes/igor_meme/igor3.png',
];

function isFloaterMobile() {
  return window.matchMedia && window.matchMedia('(max-width: 520px)').matches;
}
function rand(min, max) {
  return min + Math.random() * (max - min);
}

// ── JS-driven floater state ──────────────────────────────
let _floaterItems = [];   // { el, x, y, vx, vy, size }
let _floaterRaf   = null;
let _floaterLastTs = 0;

function spawnFloaters() {
  const container = $('landing-floaters');
  if (!container) return;
  container.innerHTML = '';
  _floaterItems = [];

  const sizeScale  = isFloaterMobile() ? 0.62 : 1;
  const baseSizes  = [130, 105, 155, 95, 120, 140, 88, 125, 100, 160];
  const opacities  = [0.55, 0.50, 0.58, 0.45, 0.55, 0.50, 0.42, 0.55, 0.48, 0.40];
  const W = window.innerWidth;
  const H = window.innerHeight;

  baseSizes.forEach((baseSize, i) => {
    const size = Math.round(baseSize * sizeScale);

    // Start anywhere on screen
    const x = rand(0, Math.max(0, W - size));
    const y = rand(0, Math.max(0, H - size));

    // Consistent direction throughout – no reversals
    const speed = rand(28, 55);
    const angle = rand(0, Math.PI * 2);
    const vx    = Math.cos(angle) * speed;
    const vy    = Math.sin(angle) * speed;

    const wrap = document.createElement('div');
    wrap.className = 'floater';
    wrap.style.cssText = `width:${size}px;opacity:${opacities[i]};`;
    wrap.style.transform = `translate(${x}px,${y}px)`;

    const img = document.createElement('img');
    img.src       = FLOATER_SRCS[Math.floor(Math.random() * FLOATER_SRCS.length)];
    img.alt       = '';
    img.className = 'floater-img';
    img.draggable = false;

    // ~half of floaters spin slowly (CSS handles this smoothly)
    if (Math.random() < 0.5) {
      img.classList.add('spin');
      img.style.setProperty('--spinDur',   `${rand(42, 92).toFixed(1)}s`);
      img.style.setProperty('--spinStart', `${rand(0, 360).toFixed(1)}deg`);
    }

    wrap.appendChild(img);
    container.appendChild(wrap);
    _floaterItems.push({ el: wrap, x, y, vx, vy, size });
  });
}

function _floaterTick(ts) {
  if (!_floaterRaf) return;
  const dt = Math.min((ts - _floaterLastTs) / 1000, 0.05);
  _floaterLastTs = ts;

  const W = window.innerWidth;
  const H = window.innerHeight;

  for (const f of _floaterItems) {
    f.x += f.vx * dt;
    f.y += f.vy * dt;

    // Wrap-around: exit one side → enter opposite
    const m = f.size;
    if      (f.x >  W + m) f.x = -m;
    else if (f.x < -m)     f.x =  W + m;
    if      (f.y >  H + m) f.y = -m;
    else if (f.y < -m)     f.y =  H + m;

    f.el.style.transform = `translate(${f.x}px,${f.y}px)`;
  }

  _floaterRaf = requestAnimationFrame(_floaterTick);
}

function startFloaterLoop() {
  if (_floaterRaf) return;
  _floaterLastTs = performance.now();
  _floaterRaf    = requestAnimationFrame(_floaterTick);
}

function stopFloaterLoop() {
  if (_floaterRaf) { cancelAnimationFrame(_floaterRaf); _floaterRaf = null; }
}

// ─────────────────────────────────────────────────────────
//  SCREEN ROUTING
// ─────────────────────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(`screen-${name}`).classList.add('active');

  if (name === 'landing') {
    // Show music toggle + try autoplay
    btnMusicToggle?.classList.remove('hidden');
    startLandingMusic();
    spawnFloaters();
    startFloaterLoop();
  } else {
    // Hide music toggle + pause music when leaving landing
    btnMusicToggle?.classList.add('hidden');
    stopLandingMusic();
    stopFloaterLoop();
  }
}

// Attempt autoplay on page load.
// ES modules are deferred — DOM is already ready when this runs, so we call directly.
spawnFloaters();
startFloaterLoop();
startLandingMusic();
// If autoplay was blocked by the browser, start on first interaction
const _startOnInteract = () => {
  if (!musicMuted && landingMusic && landingMusic.paused) startLandingMusic();
  window.removeEventListener('pointerdown', _startOnInteract);
  window.removeEventListener('keydown',     _startOnInteract);
};
window.addEventListener('pointerdown', _startOnInteract);
window.addEventListener('keydown',     _startOnInteract);

function showToast(msg, duration = 2800) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => t.classList.add('hidden'), duration);
}

function getInitial(name) {
  return (name || '?')[0].toUpperCase();
}

function updateTimerBar(barId, timeLeft, totalTime) {
  const bar = $(barId);
  if (!bar) return;
  const pct = Math.max(0, (timeLeft / totalTime) * 100);
  bar.style.width = pct + '%';
  bar.classList.toggle('danger', pct < 25);
}

function renderPlayerList(players) {
  const list  = $('lobby-player-list');
  const count = $('lobby-player-count');
  count.textContent = players.length;
  list.innerHTML = players.map((p) => `
    <div class="player-card">
      <div class="player-avatar-circle" style="background:${p.color}">${getInitial(p.name)}</div>
      <span class="player-card-name">${escHtml(p.name)}</span>
      ${p.isHost ? '<i class="fi fi-sr-crown host-crown" title="Host"></i>' : ''}
      ${p.id === socket.id ? '<span style="font-size:0.7rem;color:var(--text-dim)">(you)</span>' : ''}
    </div>
  `).join('');
}

function renderScoreboard(players) {
  const sb = $('game-scoreboard');
  if (!sb) return;
  // Scores are hidden during gameplay — revealed only at game over
  sb.innerHTML = players
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `
      <div class="score-chip-header">
        <div style="width:10px;height:10px;border-radius:50%;background:${p.color}"></div>
        <span>${escHtml(p.name)}</span>
      </div>
    `).join('');
}

function escHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ─────────────────────────────────────────────────────────
//  TEMPORARY MEME BUTTON
// ─────────────────────────────────────────────────────────
const MEME_VIDEO_SRC = '/memes/video5312398194624209429.mp4';
const MEME_SOUND_SRC = '/memes/the-rock-meme-sound-effect_INUb6uwK.mp3';

let memeAudio = null;

function openMemeOverlay() {
  const overlay = $('meme-overlay');
  const video = $('meme-video');
  if (!overlay || !video) return;

  overlay.classList.remove('hidden');

  // Load and play the video (user gesture -> should allow play)
  video.src = MEME_VIDEO_SRC;
  video.currentTime = 0;
  video.loop = true;
  video.controls = true;
  video.play().catch(() => {});
}

function closeMemeOverlay() {
  const overlay = $('meme-overlay');
  const video = $('meme-video');
  if (!overlay) return;

  overlay.classList.add('hidden');

  if (video) {
    try { video.pause(); } catch {}
    video.removeAttribute('src');
    video.load();
  }
  if (memeAudio) {
    try { memeAudio.pause(); } catch {}
    memeAudio.currentTime = 0;
  }
}

function handleDoNotClick() {
  const ok = window.confirm('Are you sure that you want to click it?');
  if (!ok) return;

  // Play sound every time on confirmation
  if (!memeAudio) memeAudio = new Audio(MEME_SOUND_SRC);
  try { memeAudio.pause(); } catch {}
  memeAudio.loop = false;
  memeAudio.currentTime = 0;
  memeAudio.play().catch(() => {});

  openMemeOverlay();
}

// ─────────────────────────────────────────────────────────
//  HUB – game card grid
// ─────────────────────────────────────────────────────────
function renderHub(games) {
  // Update header player badge
  const badge = $('hub-player-name');
  if (badge) badge.textContent = state.nickname;

  const grid = $('hub-grid');
  grid.innerHTML = games.map((g) => {
    if (g.comingSoon) {
      return `
        <div class="hub-card coming-soon">
          <div class="hub-card-banner" style="background:${g.bannerGradient || 'linear-gradient(135deg,#1a1d2e,#13151f)'}">
            <i class="fi ${g.iconClass}" aria-hidden="true"></i>
          </div>
          <div class="hub-card-body">
            <div class="hub-card-title">${escHtml(g.title)}</div>
            <div class="hub-card-desc">${escHtml(g.description)}</div>
            <div class="hub-card-footer">
              <span class="coming-soon-badge">Coming Soon</span>
            </div>
          </div>
        </div>`;
    }
    return `
      <div class="hub-card" data-game="${g.id}" role="button" tabindex="0"
           aria-label="Play ${escHtml(g.title)}">
        <div class="hub-card-banner" style="background:${g.bannerGradient || 'linear-gradient(135deg,#8b5cf6,#ec4899)'}">
          <i class="fi ${g.iconClass}" aria-hidden="true"></i>
        </div>
        <div class="hub-card-body">
          <div class="hub-card-title">${escHtml(g.title)}</div>
          <div class="hub-card-desc">${escHtml(g.description)}</div>
          <div class="hub-card-footer">
            <span class="hub-card-players">${g.minPlayers}–${g.maxPlayers} players</span>
            <button class="btn btn-primary btn-sm">Play</button>
          </div>
        </div>
      </div>`;
  }).join('');

  // Card click → detail
  grid.querySelectorAll('.hub-card:not(.coming-soon)').forEach((card) => {
    card.addEventListener('click', () => {
      const game = games.find((g) => g.id === card.dataset.game);
      if (!game) return;
      state.selectedGameId = game.id;
      renderDetail(game);
      showScreen('detail');
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') card.click();
    });
  });
}

// ─────────────────────────────────────────────────────────
//  DETAIL – game info + create / join inline
// ─────────────────────────────────────────────────────────
function renderDetail(game) {
  // Update header badge
  const badge = $('detail-player-name');
  if (badge) badge.textContent = state.nickname;

  // Artwork panel
  const artworkEl = $('detail-artwork');
  if (artworkEl) artworkEl.style.background = game.bannerGradient || 'linear-gradient(135deg,#8b5cf6,#ec4899)';
  const iconEl = $('detail-artwork-icon');
  if (iconEl) { iconEl.className = `fi ${game.iconClass} detail-artwork-icon`; }

  $('detail-title').textContent = game.title;
  $('detail-description').textContent = game.longDescription || game.description;

  // Rules list
  const rulesList = $('detail-rules-list');
  if (rulesList && game.rules && game.rules.length) {
    rulesList.innerHTML = game.rules.map((r) => `<li>${escHtml(r)}</li>`).join('');
  }

  // Meta badges
  const metaEl = $('detail-meta');
  if (metaEl) {
    metaEl.innerHTML = `
      <span class="detail-badge"><i class="fi fi-rr-users"></i> ${game.minPlayers}–${game.maxPlayers} players</span>
      <span class="detail-badge"><i class="fi fi-rr-clock"></i> ~${game.avgMinutes || 10} min</span>
    `;
  }

  // Reset join inline
  $('join-inline').classList.add('hidden');
  $('input-join-code').value = '';
  $('join-error').textContent = '';
  $('detail-error').textContent = '';
}

// ─────────────────────────────────────────────────────────
//  LOBBY
// ─────────────────────────────────────────────────────────
function enterLobby(room) {
  state.room = room;

  // Game tag
  const game = state.allGames.find((g) => g.id === state.selectedGameId);
  const tagEl = $('lobby-game-tag');
  if (tagEl && game) {
    tagEl.innerHTML = `<i class="fi ${game.iconClass}"></i> ${escHtml(game.title)}`;
  }

  $('lobby-code-big').textContent = room.id;
  renderPlayerList(room.players);

  const isHost = room.host === socket.id;
  $('lobby-host-controls').classList.toggle('hidden', !isHost);
  $('lobby-waiting-block').classList.toggle('hidden', isHost);

  showScreen('lobby');
}

function updateLobby(room) {
  state.room = room;
  renderPlayerList(room.players);
  const isHost = room.host === socket.id;
  $('lobby-host-controls').classList.toggle('hidden', !isHost);
  $('lobby-waiting-block').classList.toggle('hidden', isHost);
}

// ─────────────────────────────────────────────────────────
//  GAME
// ─────────────────────────────────────────────────────────
function enterGame(room) {
  state.room = room;

  // Route to the correct game screen
  if (state.selectedGameId === 'drawing-dash') {
    enterDrawingDash(room);
    return;
  }

  // Default: Who Is It?
  $('game-room-code').textContent = room.id;
  renderScoreboard(room.players);
  showScreen('game');
  $('game-overlay').classList.remove('hidden');

  if (!state.phaserGame) {
    state.phaserGame = WhoIsItGame.createBackground('phaser-container');
  }
}

// Show one panel, hide all others
function showPanel(id) {
  const panels = ['panel-writing', 'panel-voting', 'panel-result', 'panel-game-over'];
  panels.forEach((p) => {
    $(p).classList.toggle('hidden', p !== id);
  });
}

// ─── Writing Phase ────────────────────────────────────────
function showWritingPhase(data) {
  state.hasSubmittedFact = false;
  showPanel('panel-writing');

  $('fact-input').value = '';
  $('fact-char-count').textContent = '0';
  $('fact-submitted-notice').classList.add('hidden');
  $('btn-submit-fact').classList.remove('hidden');
  $('btn-submit-fact').disabled = false;

  setupTimerBar('timer-bar-writing', data.timeLeft, 60);
}

// ─── Voting Phase ─────────────────────────────────────────
function showVotingPhase(data) {
  state.hasVoted = false;
  showPanel('panel-voting');

  $('fact-card-text').textContent = data.factText;
  $('voting-round-badge').textContent = `Round ${data.roundIndex + 1} / ${data.totalFacts}`;
  $('voted-notice').classList.add('hidden');
  $('votes-count').textContent = '';

  const grid = $('vote-grid');
  const sub = document.querySelector('#panel-voting .panel-sub');

  if (data.youAreAuthor) {
    if (sub) sub.textContent = 'This one is yours — watch the guesses roll in…';
    grid.classList.add('hidden');
    grid.innerHTML = '';

    const notice = $('voted-notice');
    notice.classList.remove('hidden');
    notice.innerHTML = `
      <i class="fi fi-rr-eye" aria-hidden="true"></i>
      Waiting for others to vote… <span id="votes-count"></span>
    `;
  } else {
    if (sub) sub.textContent = 'Tap a player to vote';
    grid.classList.remove('hidden');
    grid.innerHTML = data.players
      .filter((p) => p.id !== socket.id)
      .map((p) => `
        <button class="vote-btn" data-pid="${p.id}">
          <div class="vote-avatar" style="background:${p.color}">${getInitial(p.name)}</div>
          <span>${escHtml(p.name)}</span>
        </button>
      `).join('');

    grid.querySelectorAll('.vote-btn').forEach((btn) => {
      btn.addEventListener('click', () => submitVote(btn.dataset.pid));
    });
  }

  setupTimerBar('timer-bar-voting', data.timeLeft, 30);
}

// ─── Result Phase ─────────────────────────────────────────
function showResultPhase(data) {
  showPanel('panel-result');

  // Dynamic title: round X of Y
  const panelTitle = document.querySelector('#panel-result .panel-title');
  if (panelTitle) {
    panelTitle.innerHTML =
      `<i class="fi fi-rr-chart-pie" aria-hidden="true"></i> Round ${data.roundIndex + 1} of ${data.totalFacts} — Results`;
  }

  // Hide author reveal — identity shown only at game over
  const authorReveal = $('author-reveal');
  if (authorReveal) authorReveal.classList.add('hidden');

  $('result-fact-text').textContent = data.factText;

  // Use server-provided aggregates (no individual votes sent)
  const eligibleTotal = data.totalEligible ?? Math.max(0, data.players.length - 1);
  const castCount     = data.castCount     ?? 0;
  const correctCount  = data.correctCount  ?? 0;
  const correctPct = eligibleTotal > 0 ? Math.round((correctCount / eligibleTotal) * 100) : 0;
  const castPct    = eligibleTotal > 0 ? Math.round((castCount    / eligibleTotal) * 100) : 0;

  $('result-vote-list').innerHTML = `
    <div class="result-summary">
      <span><i class="fi fi-rr-target" aria-hidden="true"></i> Guessed correctly: ${correctCount}/${eligibleTotal} (${correctPct}%)</span>
      <span><i class="fi fi-rr-check-circle" aria-hidden="true"></i> Participated: ${castCount}/${eligibleTotal} (${castPct}%)</span>
    </div>
    <p class="result-hint"><i class="fi fi-rr-lock" aria-hidden="true"></i> Author &amp; votes revealed at end of game!</p>
  `;

  // Scores hidden during gameplay — only shown at game over
  $('result-scores').innerHTML = '';

  let cd = 6;
  $('auto-advance-countdown').textContent = cd;
  const cdInterval = setInterval(() => {
    cd--;
    const el = $('auto-advance-countdown');
    if (el) el.textContent = cd;
    if (cd <= 0) clearInterval(cdInterval);
  }, 1000);

  renderScoreboard(data.players);
}

// ─── Game Over Phase ──────────────────────────────────────
function showGameOverPhase(data) {
  showPanel('panel-game-over');

  const rankClasses = ['rank-gold', 'rank-silver', 'rank-bronze'];
  $('leaderboard').innerHTML = data.finalScores.map((p, i) => `
    <div class="leaderboard-row" style="animation-delay:${i * 0.1}s">
      <span class="leaderboard-rank">
        ${i < 3 ? `<i class="fi fi-sr-trophy ${rankClasses[i]}"></i>` : i + 1}
      </span>
      <div class="player-avatar-circle" style="background:${p.color};width:32px;height:32px;font-size:0.85rem">
        ${getInitial(p.name)}
      </div>
      <span class="leaderboard-name">${escHtml(p.name)}</span>
      <span class="leaderboard-score">${p.score} pts</span>
    </div>`).join('');

  const isHost = state.room && state.room.host === socket.id;
  $('game-over-host-controls').classList.toggle('hidden', !isHost);

  // ── Round-by-round recap reveal ───────────────────────
  const rhEl = $('round-history');
  if (rhEl && data.roundHistory && data.roundHistory.length > 0) {
    rhEl.innerHTML = `
      <h3 class="rh-title"><i class="fi fi-rr-bulb" aria-hidden="true"></i> Who wrote what?</h3>
      ${data.roundHistory.map((r, i) => `
        <div class="rh-card" style="animation-delay:${i * 0.08}s">
          <div class="rh-round-badge">Round ${r.roundIndex + 1}</div>
          <div class="rh-fact-text">&ldquo;${escHtml(r.factText)}&rdquo;</div>
          <div class="rh-author-row">
            <div class="rh-dot" style="background:${r.authorColor}">${getInitial(r.authorName)}</div>
            <span class="rh-author-name">${escHtml(r.authorName)}</span>
            <span class="rh-badge author-badge">author</span>
          </div>
          ${r.votes.length > 0 ? `
            <div class="rh-votes">
              ${r.votes.map((v) => `
                <div class="rh-vote-row">
                  <span class="rh-voter">
                    <span class="rh-voter-dot" style="background:${v.voterColor}"></span>
                    ${escHtml(v.voterName)}
                  </span>
                  <span class="rh-verdict ${v.correct ? 'correct' : 'wrong'}">
                    ${v.correct
                      ? '<i class="fi fi-rr-check"></i> guessed right!'
                      : `<i class="fi fi-rr-cross-small"></i> voted <strong>${escHtml(v.votedName)}</strong>`}
                  </span>
                </div>
              `).join('')}
            </div>
          ` : '<p class="rh-no-votes">No votes cast this round</p>'}
        </div>
      `).join('')}
    `;
  } else if (rhEl) {
    rhEl.innerHTML = '';
  }
}

// ─────────────────────────────────────────────────────────
//  TIMER UTIL
// ─────────────────────────────────────────────────────────
function setupTimerBar(barId, initialTime, totalTime) {
  updateTimerBar(barId, initialTime, totalTime);
}

// ─────────────────────────────────────────────────────────
//  ACTIONS
// ─────────────────────────────────────────────────────────
function submitFact() {
  if (state.hasSubmittedFact) return;
  const fact = $('fact-input').value.trim();
  if (!fact) { showToast('Write something first!'); return; }

  socket.emit('submit_fact', { fact });
  state.hasSubmittedFact = true;

  $('btn-submit-fact').classList.add('hidden');
  $('fact-submitted-notice').classList.remove('hidden');
  $('facts-submitted-count').textContent = '';
}

function submitVote(playerId) {
  if (state.hasVoted) return;

  socket.emit('submit_vote', { votedPlayerId: playerId });
  state.hasVoted = true;

  $('vote-grid').querySelectorAll('.vote-btn').forEach((b) => {
    b.disabled = true;
    if (b.dataset.pid === playerId) b.classList.add('selected');
  });

  $('voted-notice').classList.remove('hidden');
}

// ─────────────────────────────────────────────────────────
//  DRAWING DASH  –  client-side logic
// ─────────────────────────────────────────────────────────

// Palette colours available to the drawer
const DD_PALETTE = [
  '#ffffff','#d4d4d4','#737373','#171717',
  '#ef4444','#f97316','#eab308','#22c55e',
  '#06b6d4','#3b82f6','#8b5cf6','#ec4899',
  '#b45309','#065f46','#1e3a5f','#4a044e',
];

// Local drawing state
const dd = {
  canvas:     null,
  ctx:        null,
  isDrawer:   false,
  tool:       'brush',  // brush | eraser | fill
  color:      '#171717',
  size:       10,
  drawing:    false,
  lastX:      0,
  lastY:      0,
  roundTime:  80,
  totalTime:  80,
  undoStack:  [],       // ImageData snapshots for undo
  fitBound:   false,
};
const DD_UNDO_MAX = 30;

// ── Enter the Drawing Dash screen ───────────────────────────
function enterDrawingDash(room) {
  state.room = room;
  $('dd-room-code').textContent = room.id;
  showScreen('drawing-dash');

  // One-time canvas setup
  if (!dd.canvas) {
    dd.canvas = $('dd-canvas');
    dd.canvas.width = 800;
    dd.canvas.height = 600;
    dd.ctx    = dd.canvas.getContext('2d', { alpha: false, willReadFrequently: true }) || dd.canvas.getContext('2d');
    ddClearCanvas();
    ddInitToolbar();
    ddInitCanvas();

    if (!dd.fitBound) {
      dd.fitBound = true;
      window.addEventListener('resize', ddFitCanvas);
      window.addEventListener('orientationchange', () => setTimeout(ddFitCanvas, 50));
    }
  }

  ddFitCanvas();
}

// ── Fit visible canvas (Skribbl-like 4:3 scaling) ───────────
function ddFitCanvas() {
  if (!dd.canvas) return;
  const wrap = $('dd-canvas-wrap');
  if (!wrap) return;

  const maxW = wrap.clientWidth;
  const maxH = wrap.clientHeight;
  if (!maxW || !maxH) return;

  let viewW = maxW;
  let viewH = (viewW * 3) / 4;
  if (viewH > maxH) {
    viewH = maxH;
    viewW = (viewH * 4) / 3;
  }

  dd.canvas.style.width = `${Math.floor(viewW)}px`;
  dd.canvas.style.height = `${Math.floor(viewH)}px`;
}

// ── Save canvas snapshot to undo stack ─────────────────────
function ddSaveUndo() {
  if (!dd.ctx) return;
  dd.undoStack.push(dd.ctx.getImageData(0, 0, dd.canvas.width, dd.canvas.height));
  if (dd.undoStack.length > DD_UNDO_MAX) dd.undoStack.shift();
}

// ── Perform undo ─────────────────────────────────────────────
function ddUndo() {
  if (!dd.isDrawer || !dd.ctx || dd.undoStack.length === 0) return;
  const snap = dd.undoStack.pop();
  dd.ctx.putImageData(snap, 0, 0);
  // Send snapshot to remote players
  const dataURL = dd.canvas.toDataURL('image/png');
  socket.emit('dd_draw', { type: 'undo-snapshot', dataURL });
}

// ── Clear the canvas to white ────────────────────────────────
function ddClearCanvas() {
  if (!dd.ctx) return;
  // Keep the bitmap fully opaque so page background never shows through.
  dd.ctx.globalCompositeOperation = 'source-over';
  dd.ctx.globalAlpha = 1;
  dd.ctx.fillStyle = '#ffffff';
  dd.ctx.fillRect(0, 0, dd.canvas.width, dd.canvas.height);
}

// ── Coordinate mapping (CSS-scaled canvas → logical 800×600) ─
function ddCanvasXY(e) {
  const rect   = dd.canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  const w = dd.canvas.width;
  const h = dd.canvas.height;
  const scaleX = w / rect.width;
  const scaleY = h / rect.height;
  const src    = e.touches ? e.touches[0] : e;
  const rawX = (src.clientX - rect.left) * scaleX;
  const rawY = (src.clientY - rect.top)  * scaleY;
  return {
    // Clamp to bitmap bounds so edge clicks still work
    x: Math.max(0, Math.min(w - 1, rawX)),
    y: Math.max(0, Math.min(h - 1, rawY)),
  };
}

// ── Canvas pointer/touch events (drawer only) ───────────────
function ddInitCanvas() {
  const c = dd.canvas;

  // Helper to begin a stroke
  const onDown = (e) => {
    if (!dd.isDrawer) return;
    e.preventDefault();
    const { x, y } = ddCanvasXY(e);

    if (dd.tool === 'fill') {
      ddSaveUndo();
      ddDoFill(x, y, dd.color);
      socket.emit('dd_draw', { type: 'fill', x, y, color: dd.color });
      return;
    }
    ddSaveUndo();
    dd.drawing = true;
    dd.lastX = x; dd.lastY = y;
    socket.emit('dd_draw', { type: 'begin', x, y, color: ddEffectiveColor(), size: dd.size });
    ddApplyDraw({ type: 'begin', x, y, color: ddEffectiveColor(), size: dd.size });
  };

  const onMove = (e) => {
    if (!dd.isDrawer || !dd.drawing) return;
    e.preventDefault();
    const { x, y } = ddCanvasXY(e);
    const ev = { type: 'move', x, y, color: ddEffectiveColor(), size: dd.size };
    socket.emit('dd_draw', ev);
    ddApplyDraw(ev);
  };

  const onUp = (e) => {
    if (!dd.drawing) return;
    dd.drawing = false;
    socket.emit('dd_draw', { type: 'end' });
    ddApplyDraw({ type: 'end' });
  };

  c.addEventListener('pointerdown', onDown);
  c.addEventListener('pointermove', onMove);
  c.addEventListener('pointerup',   onUp);
  c.addEventListener('pointerleave', onUp);

  // Keyboard undo (Ctrl+Z)
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && dd.isDrawer) {
      e.preventDefault();
      ddUndo();
    }
  });
}

function ddEffectiveColor() {
  return dd.tool === 'eraser' ? '#ffffff' : dd.color;
}

// ── Apply a draw event to the canvas ────────────────────────
function ddApplyDraw(ev) {
  if (!dd.ctx) return;
  const ctx = dd.ctx;

  if (ev.type === 'clear') { ddClearCanvas(); return; }

  // Restore a full snapshot (undo received from drawer)
  if (ev.type === 'undo-snapshot') {
    const img = new Image();
    img.onload = () => {
      // Flatten onto a white background and scale to cover the full canvas.
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, dd.canvas.width, dd.canvas.height);
      ctx.drawImage(img, 0, 0, dd.canvas.width, dd.canvas.height);
    };
    img.src = ev.dataURL;
    return;
  }

  if (ev.type === 'fill') {
    ddDoFill(ev.x, ev.y, ev.color);
    return;
  }

  if (ev.type === 'begin') {
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(ev.x, ev.y);
    ctx.strokeStyle = ev.color;
    ctx.lineWidth   = ev.size;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    return;
  }

  if (ev.type === 'move') {
    ctx.strokeStyle = ev.color;
    ctx.lineWidth   = ev.size;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.lineTo(ev.x, ev.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(ev.x, ev.y);
    return;
  }

  if (ev.type === 'end') {
    ctx.beginPath();
    return;
  }
}

// ── Flood fill ───────────────────────────────────────────────
function ddDoFill(startX, startY, hexColor) {
  const ctx    = dd.ctx;
  const width  = dd.canvas.width;
  const height = dd.canvas.height;

  const sx = Math.round(startX);
  const sy = Math.round(startY);
  if (sx < 0 || sx >= width || sy < 0 || sy >= height) return;

  const imgData = ctx.getImageData(0, 0, width, height);
  const data    = imgData.data;

  // Flatten any transparency onto white so page/background can never bleed through
  // and so flood fill works on a stable, opaque bitmap.
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 255) {
      const alpha = a / 255;
      data[i]     = Math.round(data[i]     * alpha + 255 * (1 - alpha));
      data[i + 1] = Math.round(data[i + 1] * alpha + 255 * (1 - alpha));
      data[i + 2] = Math.round(data[i + 2] * alpha + 255 * (1 - alpha));
      data[i + 3] = 255;
    }
  }

  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);

  const idx = (sy * width + sx) * 4;
  const tr  = data[idx], tg = data[idx + 1], tb = data[idx + 2], ta = data[idx + 3];

  if (tr === r && tg === g && tb === b && ta === 255) return; // already target colour

  const stack = [sx, sy];
  const visited = new Uint8Array(width * height);
  const tolerance = 6;
  function closeToTarget(pi) {
    return Math.abs(data[pi] - tr) <= tolerance
      && Math.abs(data[pi + 1] - tg) <= tolerance
      && Math.abs(data[pi + 2] - tb) <= tolerance
      && Math.abs(data[pi + 3] - ta) <= tolerance;
  }

  while (stack.length) {
    const cy = stack.pop();
    const cx = stack.pop();
    if (cx < 0 || cx >= width || cy < 0 || cy >= height) continue;
    const vi = cy * width + cx;
    if (visited[vi]) continue;
    const pi = vi * 4;
    if (!closeToTarget(pi)) continue;
    visited[vi] = 1;
    data[pi] = r; data[pi + 1] = g; data[pi + 2] = b; data[pi + 3] = 255;
    stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
  }
  ctx.putImageData(imgData, 0, 0);
}

// ── Build drawing toolbar ────────────────────────────────────
function ddInitToolbar() {
  // Palette swatches
  const palette = $('dd-palette');
  if (palette) {
    palette.innerHTML = DD_PALETTE.map((c) => `
      <div class="dd-color-swatch${c === dd.color ? ' active' : ''}" data-color="${c}"
           style="background:${c};${c === '#ffffff' ? 'border:1px solid #ccc;' : ''}"
           title="${c}"></div>
    `).join('');
    palette.querySelectorAll('.dd-color-swatch').forEach((s) => {
      s.addEventListener('click', () => {
        ddPickColor(s.dataset.color);
        palette.querySelectorAll('.dd-color-swatch').forEach((el) => el.classList.remove('active'));
        s.classList.add('active');
      });
    });
  }

  // Native colour picker
  const picker = $('dd-color-picker');
  if (picker) {
    picker.addEventListener('input', () => {
      ddPickColor(picker.value);
      // Deselect swatches since colour is custom
      if (palette) palette.querySelectorAll('.dd-color-swatch').forEach((el) => el.classList.remove('active'));
    });
  }

  // Tool buttons
  document.querySelectorAll('.dd-tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => ddSetTool(btn.dataset.tool));
  });

  // Size buttons
  document.querySelectorAll('.dd-size-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      dd.size = parseInt(btn.dataset.size, 10);
      document.querySelectorAll('.dd-size-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Undo button
  const undoBtn = $('dd-tool-undo');
  if (undoBtn) undoBtn.addEventListener('click', ddUndo);

  // Clear button
  const clearBtn = $('dd-tool-clear');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      ddSaveUndo();
      ddClearCanvas();
      socket.emit('dd_draw', { type: 'clear' });
    });
  }
}

function ddPickColor(hex) {
  dd.color = hex;
  if (dd.tool !== 'fill') ddSetTool('brush');
}

function ddSetTool(tool) {
  dd.tool = tool;
  document.querySelectorAll('.dd-tool-btn[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });
  if (dd.canvas) dd.canvas.style.cursor = (tool === 'fill') ? 'cell' : 'crosshair';
}

// ── Update timer ring ────────────────────────────────────────
const DD_ARC_LEN = 2 * Math.PI * 18; // 113.097…
function ddSetTimer(timeLeft, totalTime) {
  const arc = $('dd-timer-arc');
  const num = $('dd-timer-num');
  if (!arc || !num) return;
  const frac  = Math.max(0, timeLeft / totalTime);
  arc.style.strokeDashoffset = ((1 - frac) * DD_ARC_LEN).toFixed(2);
  arc.classList.toggle('danger', frac < 0.25);
  num.textContent = Math.max(0, Math.round(timeLeft));
}

// ── Render player list (sidebar) ────────────────────────────
function ddRenderPlayers(players, drawerId) {
  const el = $('dd-players-list');
  if (!el) return;
  el.innerHTML = players
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((p) => {
      const isDrawer  = p.id === drawerId;
      const guessed   = state._ddGuessedIds && state._ddGuessedIds.includes(p.id);
      let tag = '';
      if (isDrawer) tag = '<span class="dd-player-tag drawing">✏️</span>';
      else if (guessed) tag = '<span class="dd-player-tag guessed">✓</span>';
      return `
        <div class="dd-player-row${isDrawer ? ' is-drawer' : ''}${guessed ? ' has-guessed' : ''}">
          <div class="dd-player-avatar" style="background:${p.color}">${escHtml(p.name[0].toUpperCase())}</div>
          <span class="dd-player-name">${escHtml(p.name)}${p.id === socket.id ? ' <span style="opacity:.5">(you)</span>' : ''}</span>
          <span class="dd-player-score">${p.score}</span>
          ${tag}
        </div>`;
    }).join('');
}

// ── Append a chat message ───────────────────────────────────
function ddAddChat(msg) {
  const log = $('dd-chat-log');
  if (!log) return;
  const div = document.createElement('div');

  if (msg.isSystem) {
    div.className = 'dd-chat-msg system' + (msg.isCorrect ? ' correct' : '');
    div.textContent = msg.text;
  } else {
    div.className = 'dd-chat-msg' +
      (msg.isClose       ? ' close'           : '') +
      (msg.alreadyGuessed ? ' guessed-already' : '');
    div.innerHTML = `<span class="msg-name" style="color:${msg.color || '#8b5cf6'}">${escHtml(msg.name)}</span>${escHtml(msg.text)}`;
    if (msg.isClose) div.innerHTML += ' <em style="font-size:.72em;opacity:.8">(close!)</em>';
  }

  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

// ── Word-hint display (underscores + letters) ────────────────
function ddSetWordHint(hint, word) {
  const el = $('dd-word-hint');
  if (!el) return;
  if (word) {
    // Drawer sees the actual word
    el.textContent = word.toUpperCase();
    el.style.color = 'var(--primary)';
  } else if (hint) {
    el.textContent = hint.split('').join(' ').replace(/_/g, '＿');
    el.style.color = '';
  } else {
    el.textContent = '';
  }
}

// ── Phase handlers ───────────────────────────────────────────

function showDDPickingWord(data) {
  ddFitCanvas();
  state._ddGuessedIds = [];
  dd.isDrawer = (socket.id === data.drawerId);
  dd.undoStack = [];   // clear undo history between rounds

  ddSetTimer(data.timeLeft, 15);
  ddSetWordHint('', '');
  $('dd-round-label').textContent =
    `Round ${data.currentRound}/${data.totalRounds}  —  Turn ${data.turnIndex + 1}/${data.totalTurns}`;

  ddRenderPlayers(data.players, data.drawerId);

  // Clear canvas for new round
  ddClearCanvas();

  const waiting = $('dd-canvas-waiting');
  const waitText = $('dd-canvas-waiting-text');
  waiting.classList.remove('hidden');
  if (waitText) waitText.textContent = `${escHtml(data.drawerName)} is choosing a word…`;

  $('dd-tools').classList.add('hidden');

  // Disable chat during word picking
  const chatInput = $('dd-chat-input');
  const chatSend  = $('dd-chat-send');
  if (chatInput) { chatInput.disabled = true; chatInput.placeholder = 'Waiting for drawer…'; }
  if (chatSend)  chatSend.disabled = true;

  // Hide overlays
  $('dd-overlay-round-end').classList.add('hidden');
  $('dd-overlay-game-over').classList.add('hidden');

  if (dd.isDrawer) {
    // Show word-choice overlay (words come in dd_word_choices event)
    $('dd-overlay-picking').classList.remove('hidden');
    $('dd-pick-seconds').textContent = data.timeLeft;
  } else {
    $('dd-overlay-picking').classList.add('hidden');
  }
}

function showDDDrawing(data) {
  ddFitCanvas();
  state._ddGuessedIds = data.youGuessed ? [socket.id] : [];
  dd.isDrawer = data.isDrawer;
  dd.roundTime = 80;

  $('dd-overlay-picking').classList.add('hidden');
  $('dd-overlay-round-end').classList.add('hidden');
  $('dd-canvas-waiting').classList.add('hidden');

  ddSetTimer(data.timeLeft, 80);
  ddSetWordHint(data.hint, data.isDrawer ? data.word : null);
  $('dd-round-label').textContent =
    `Round ${data.currentRound}/${data.totalRounds}  —  Turn ${data.turnIndex + 1}/${data.totalTurns}`;

  ddRenderPlayers(data.players, data.drawerId);

  $('dd-tools').classList.toggle('hidden', !dd.isDrawer);
  dd.canvas.style.pointerEvents = dd.isDrawer ? 'auto' : 'none';

  const chatInput = $('dd-chat-input');
  const chatSend  = $('dd-chat-send');
  if (dd.isDrawer) {
    if (chatInput) { chatInput.disabled = true; chatInput.placeholder = 'You are drawing…'; }
    if (chatSend)  chatSend.disabled = true;
  } else {
    if (chatInput) { chatInput.disabled = data.youGuessed; chatInput.placeholder = data.youGuessed ? 'You guessed it!' : 'Guess the word…'; }
    if (chatSend)  chatSend.disabled = data.youGuessed;
  }

  // Replay cached chat history
  if (data.chatHistory && data.chatHistory.length) {
    const log = $('dd-chat-log');
    if (log) {
      log.innerHTML = '';
      data.chatHistory.forEach((m) => ddAddChat(m));
    }
  }
}

function showDDRoundEnd(data) {
  ddFitCanvas();
  $('dd-overlay-round-end').classList.remove('hidden');
  $('dd-overlay-picking').classList.add('hidden');
  $('dd-tools').classList.add('hidden');
  dd.canvas.style.pointerEvents = 'none';

  const chatInput = $('dd-chat-input');
  const chatSend  = $('dd-chat-send');
  if (chatInput) { chatInput.disabled = true; }
  if (chatSend)  chatSend.disabled = true;

  $('dd-reveal-word').textContent = (data.word || '').toUpperCase();

  $('dd-round-drawer-row').innerHTML =
    `<div class="dd-player-avatar" style="background:${data.drawerColor};width:24px;height:24px;font-size:.65rem;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;color:#fff">${escHtml(data.drawerName[0].toUpperCase())}</div>
     <span>${escHtml(data.drawerName)} was drawing</span>`;

  const guessedEl = $('dd-round-guessed');
  if (guessedEl) {
    if (data.guessedBy && data.guessedBy.length) {
      guessedEl.innerHTML = data.guessedBy.map((g) =>
        `<span class="dd-guessed-chip" style="background:${g.color}">${escHtml(g.name)}</span>`
      ).join('');
    } else {
      guessedEl.innerHTML = '<em style="color:var(--text-dim);font-size:.82rem">Nobody guessed it</em>';
    }
  }

  const scoresEl = $('dd-round-scores');
  if (scoresEl && data.players) {
    scoresEl.innerHTML = [...data.players]
      .sort((a, b) => b.score - a.score)
      .map((p) => `
        <div class="dd-score-row">
          <div style="width:10px;height:10px;border-radius:50%;background:${p.color};flex-shrink:0;"></div>
          <span style="flex:1">${escHtml(p.name)}</span>
          <span class="score-pts">${p.score} pts</span>
        </div>`
      ).join('');
  }

  ddRenderPlayers(data.players, data.drawerId);

  // Countdown display
  let cd = 7;
  $('dd-advance-cd').textContent = cd;
  const cdI = setInterval(() => {
    cd--;
    const el = $('dd-advance-cd');
    if (el) el.textContent = cd;
    if (cd <= 0) clearInterval(cdI);
  }, 1000);
}

function showDDGameOver(data) {
  $('dd-overlay-round-end').classList.add('hidden');
  $('dd-overlay-picking').classList.add('hidden');
  $('dd-overlay-game-over').classList.remove('hidden');

  const rankClass = ['rank-gold','rank-silver','rank-bronze'];
  $('dd-leaderboard').innerHTML = data.finalScores.map((p, i) => `
    <div class="leaderboard-row" style="animation-delay:${i * 0.1}s">
      <span class="leaderboard-rank">${i < 3 ? `<i class="fi fi-sr-trophy ${rankClass[i]}"></i>` : i + 1}</span>
      <div class="player-avatar-circle" style="background:${p.color};width:32px;height:32px;font-size:.85rem">${escHtml(p.name[0].toUpperCase())}</div>
      <span class="leaderboard-name">${escHtml(p.name)}</span>
      <span class="leaderboard-score">${p.score} pts</span>
    </div>`
  ).join('');

  // Round history
  const rhEl = $('dd-round-history');
  if (rhEl && data.roundHistory && data.roundHistory.length) {
    rhEl.innerHTML = `
      <h3 class="rh-title"><i class="fi fi-rr-gallery" aria-hidden="true"></i> Round recap</h3>
      ${data.roundHistory.map((r, i) => `
        <div class="rh-card" style="animation-delay:${i * 0.06}s">
          <div class="rh-round-badge">Turn ${i + 1}</div>
          <div class="rh-author-row">
            <div class="rh-dot" style="background:${r.drawerColor}">${r.drawerName[0].toUpperCase()}</div>
            <span class="rh-author-name">${escHtml(r.drawerName)}</span>
            <span class="rh-badge author-badge">drew</span>
            <strong style="margin-left:.3rem">${escHtml(r.word.toUpperCase())}</strong>
          </div>
          ${
            r.guessedBy.length
              ? `<div class="rh-votes">${r.guessedBy.map((g, gi) =>
                  `<div class="rh-vote-row">
                    <span class="rh-voter"><span class="rh-voter-dot" style="background:${g.color}"></span>${escHtml(g.name)}</span>
                    <span class="rh-verdict correct">#${gi + 1} guessed right!</span>
                  </div>`).join('')}</div>`
              : '<p class="rh-no-votes">Nobody guessed it</p>'
          }
        </div>`
      ).join('')}`;
  } else if (rhEl) {
    rhEl.innerHTML = '';
  }

  const isHost = state.room && state.room.host === socket.id;
  $('dd-game-over-host').classList.toggle('hidden', !isHost);
}

// ─────────────────────────────────────────────────────────
//  SOCKET EVENTS
// ─────────────────────────────────────────────────────────
socket.on('connect', () => {
  state.myId = socket.id;
});

socket.on('player_joined', ({ room }) => {
  state.room = room;
  if ($('screen-lobby').classList.contains('active')) {
    updateLobby(room);
  }
  showToast(`${room.players[room.players.length - 1].name} joined!`);
});

socket.on('player_left', ({ playerId, room }) => {
  state.room = room;
  if ($('screen-lobby').classList.contains('active')) {
    updateLobby(room);
  }
});

socket.on('phase_changed', ({ phase, data }) => {
  // ── Drawing Dash phases ──────────────────────────────────────
  if (phase.startsWith('DD_')) {
    if (!$('screen-drawing-dash').classList.contains('active')) {
      enterDrawingDash(state.room);
    }
    if (data.players) state.room.players = data.players;
    switch (phase) {
      case 'DD_PICKING_WORD': showDDPickingWord(data); break;
      case 'DD_DRAWING':      showDDDrawing(data);     break;
      case 'DD_ROUND_END':    showDDRoundEnd(data);    break;
      case 'DD_GAME_OVER':    showDDGameOver(data);    break;
    }
    return;
  }

  // ── Who Is It? phases ────────────────────────────────────────
  if (!$('screen-game').classList.contains('active')) {
    enterGame(state.room);
  }

  if (data.players) {
    state.room.players = data.players;
    renderScoreboard(data.players);
  }

  switch (phase) {
    case 'WRITING_FACTS':  showWritingPhase(data);  break;
    case 'VOTING':         showVotingPhase(data);    break;
    case 'RESULT_REVEAL':  showResultPhase(data);    break;
    case 'GAME_OVER':      showGameOverPhase(data);  break;
  }
});

socket.on('timer_tick', ({ timeLeft, phase }) => {
  // Who Is It?
  if (phase === 'WRITING_FACTS') updateTimerBar('timer-bar-writing', timeLeft, 60);
  if (phase === 'VOTING')        updateTimerBar('timer-bar-voting',  timeLeft, 30);
  // Drawing Dash
  if (phase === 'DD_PICKING_WORD') {
    ddSetTimer(timeLeft, 15);
    const el = $('dd-pick-seconds');
    if (el) el.textContent = timeLeft;
  }
  if (phase === 'DD_DRAWING') ddSetTimer(timeLeft, 80);
});

socket.on('fact_submitted', ({ count, total }) => {
  const el = $('facts-submitted-count');
  if (el) el.textContent = ` (${count}/${total} ready)`;
});

socket.on('vote_update', ({ count, total }) => {
  const el = $('votes-count');
  if (el) el.textContent = ` (${count}/${total} voted)`;
});

// ── Drawing Dash socket events ───────────────────────────────

socket.on('dd_word_choices', ({ words }) => {
  // Populate the word-choice overlay for the drawer
  const el = $('dd-word-choices');
  if (!el) return;
  el.innerHTML = words.map((w, i) => `
    <button class="dd-word-btn" data-idx="${i}">${escHtml(w.toUpperCase())}</button>
  `).join('');
  el.querySelectorAll('.dd-word-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      socket.emit('dd_choose_word', { wordIndex: parseInt(btn.dataset.idx, 10) });
      $('dd-overlay-picking').classList.add('hidden');
    });
  });
});

socket.on('dd_draw', (ev) => {
  // Remote draw events from the drawer
  ddApplyDraw(ev);
});

socket.on('dd_chat_message', (msg) => {
  ddAddChat(msg);
});

socket.on('dd_hint', ({ hint }) => {
  if (!dd.isDrawer) ddSetWordHint(hint, null);
  showToast('\uD83D\uDD0D A hint was revealed!', 1800);
});

socket.on('dd_player_guessed', ({ playerId, name, rank, score, players }) => {
  if (!state._ddGuessedIds) state._ddGuessedIds = [];
  if (!state._ddGuessedIds.includes(playerId)) state._ddGuessedIds.push(playerId);
  if (players) ddRenderPlayers(players, state.room ? state.room.gameState?.drawerId : null);
  if (playerId === socket.id) {
    const chatInput = $('dd-chat-input');
    const chatSend  = $('dd-chat-send');
    if (chatInput) { chatInput.disabled = true; chatInput.placeholder = `You guessed it! (+${score} pts)`; }
    if (chatSend)  chatSend.disabled = true;
    showToast(`🎉 Correct! +${score} points`, 2500);
  }
});

// ─────────────────────────────────────────────────────────
//  UI EVENT LISTENERS
// ─────────────────────────────────────────────────────────

// Temporary meme button (appears in multiple headers)
document.querySelectorAll('.btn-do-not-click').forEach((btn) => {
  btn.addEventListener('click', handleDoNotClick);
});

// Meme overlay close
if ($('btn-meme-close')) {
  $('btn-meme-close').addEventListener('click', closeMemeOverlay);
}
if ($('meme-overlay')) {
  $('meme-overlay').addEventListener('click', (e) => {
    if (e.target === $('meme-overlay')) closeMemeOverlay();
  });
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMemeOverlay();
});

// ── Screen 1: Landing ────────────────────────────────────
$('btn-landing-continue').addEventListener('click', handleLandingContinue);
$('input-nickname').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleLandingContinue();
});

function handleLandingContinue() {
  const name  = $('input-nickname').value.trim();
  const errEl = $('landing-error');
  if (!name) {
    errEl.textContent = 'Please enter a nickname.';
    return;
  }
  if (name.length > 20) {
    errEl.textContent = 'Nickname must be 20 characters or less.';
    return;
  }
  errEl.textContent = '';
  state.nickname = name;

  // Check URL param — if a room code is present, skip hub and go straight to join
  const params   = new URLSearchParams(location.search);
  const roomCode = params.get('room');
  if (roomCode) {
    loadGamesAndShowHub(() => {
      const game = state.allGames[0]; // default to first game
      if (game) {
        state.selectedGameId = game.id;
        renderDetail(game);
        $('join-inline').classList.remove('hidden');
        $('input-join-code').value = roomCode.toUpperCase();
        showScreen('detail');
      } else {
        showScreen('hub');
      }
    });
  } else {
    loadGamesAndShowHub();
  }
}

function loadGamesAndShowHub(cb) {
  socket.emit('get_games', {}, ({ games }) => {
    state.allGames = games;
    renderHub(games);
    if (cb) { cb(); return; }
    showScreen('hub');
  });
}

// ── Screen 2: Hub ────────────────────────────────────────
// (card clicks wired inside renderHub)

// ── Screen 3: Detail – create party ──────────────────────
$('btn-create-party').addEventListener('click', () => {
  const btnEl = $('btn-create-party');
  const errEl = $('detail-error');
  errEl.textContent = '';
  btnEl.disabled = true;

  socket.emit('create_room', { playerName: state.nickname }, (res) => {
    btnEl.disabled = false;
    if (res.error) {
      errEl.textContent = res.error;
      return;
    }
    state.myId  = socket.id;
    state.room  = res.room;
    enterLobby(res.room);
  });
});

// ── Screen 3: Detail – show join form ────────────────────
$('btn-show-join').addEventListener('click', () => {
  const inline = $('join-inline');
  const visible = !inline.classList.contains('hidden');
  inline.classList.toggle('hidden', visible);
  if (!visible) $('input-join-code').focus();
});

// ── Screen 3: Detail – confirm join ──────────────────────
$('btn-confirm-join').addEventListener('click', handleJoin);
$('input-join-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleJoin();
});
$('input-join-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

function handleJoin() {
  const code  = $('input-join-code').value.trim().toUpperCase();
  const errEl = $('join-error');
  errEl.textContent = '';

  if (!code || code.length !== 4) {
    errEl.textContent = 'Enter the 4-character room code.';
    return;
  }

  $('btn-confirm-join').disabled = true;
  socket.emit('join_room', { roomId: code, playerName: state.nickname }, (res) => {
    $('btn-confirm-join').disabled = false;
    if (res.error) {
      errEl.textContent = res.error;
      return;
    }
    state.myId  = socket.id;
    state.room  = res.room;
    // Try to infer game id from room
    if (res.room.gameType) state.selectedGameId = res.room.gameType;
    enterLobby(res.room);
  });
}

// ── Screen 3: Detail – back to hub ───────────────────────
$('btn-detail-back').addEventListener('click', () => showScreen('hub'));

// ── Screen 4: Lobby – copy invite link ───────────────────
$('btn-copy-link').addEventListener('click', () => {
  const code = $('lobby-code-big').textContent;
  const url  = `${location.origin}?room=${code}`;
  navigator.clipboard.writeText(url).then(() => showToast('Room link copied!'));
});

// ── Screen 4: Lobby – leave ──────────────────────────────
$('btn-lobby-leave').addEventListener('click', () => showScreen('hub'));

// ── Screen 4: Lobby – start game ─────────────────────────
$('btn-start-game').addEventListener('click', () => {
  const errEl = $('lobby-error');
  errEl.classList.add('hidden');
  $('btn-start-game').disabled = true;

  socket.emit('start_game', { gameType: state.selectedGameId }, (res) => {
    $('btn-start-game').disabled = false;
    if (res.error) {
      errEl.textContent = res.error;
      errEl.classList.remove('hidden');
    } else {
      enterGame(state.room);
    }
  });
});

// ── Screen 5: Game – writing phase ────────────────────────
$('fact-input').addEventListener('input', (e) => {
  $('fact-char-count').textContent = e.target.value.length;
});
$('btn-submit-fact').addEventListener('click', submitFact);

// ── Screen 5: Game – back to hub ─────────────────────────
$('btn-back-hub').addEventListener('click', () => showScreen('hub'));

// ── Screen 5: Game over actions ──────────────────────────
$('btn-play-again').addEventListener('click', () => {
  socket.emit('restart_game', {});
});
// ─────────────────────────────────────────────────────────
//  DRAWING DASH – UI EVENT LISTENERS
// ─────────────────────────────────────────────────────────

// Chat send
function ddSendChat() {
  const input = $('dd-chat-input');
  if (!input || input.disabled) return;
  const text = input.value.trim();
  if (!text) return;
  socket.emit('dd_chat', { text });
  input.value = '';
}
$('dd-chat-send').addEventListener('click', ddSendChat);
$('dd-chat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') ddSendChat();
});

// Custom word submit
$('dd-custom-submit').addEventListener('click', () => {
  const input = $('dd-custom-word');
  const word  = (input ? input.value : '').trim();
  if (!word) return;
  socket.emit('dd_choose_word', { custom: word });
  $('dd-overlay-picking').classList.add('hidden');
  if (input) input.value = '';
});
$('dd-custom-word').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('dd-custom-submit').click();
});

// Play Again / Back to Games
$('dd-play-again').addEventListener('click', () => { socket.emit('restart_game', {}); });
$('dd-back-hub').addEventListener('click', () => showScreen('hub'));
