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
let musicMuted     = false;
let musicStarted   = false;

function startLandingMusic() {
  if (!landingMusic) return;
  landingMusic.volume = 0.35;
  const p = landingMusic.play();
  if (p && p.catch) p.catch(() => {}); // suppress autoplay-blocked errors
  musicStarted = true;
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
  btnMusicToggle.addEventListener('click', () => {
    musicMuted = !musicMuted;
    if (landingMusic) landingMusic.muted = musicMuted;
    updateMusicIcon();
    // If we haven't started yet (autoplay blocked), start now on interaction
    if (!musicMuted && !musicStarted) startLandingMusic();
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

function spawnFloaters() {
  const container = $('landing-floaters');
  if (!container || container.children.length > 0) return;

  const configs = [
    // [size, startLeft%, startTop%, dx1, dy1, dx2, dy2, dx3, dy3, dur, delay, opacity, rotBase]
    [88,   8,  15, '70px',  '-90px', '130px', '30px',  '70px',  '120px', 34, 0,    0.50, '-6deg'],
    [70,  78,  10, '-80px', '-60px', '-140px','40px',  '-80px', '110px', 29, 3,    0.45, '5deg'],
    [105, 85,  55, '-90px', '-80px', '-160px','-20px', '-90px', '60px',  38, 7,    0.55, '0deg'],
    [62,  12,  70, '80px',  '-70px', '130px', '-10px', '80px',  '80px',  32, 12,   0.40, '8deg'],
    [78,  50,   5, '60px',  '80px',  '110px', '160px', '60px',  '220px', 42, 5,    0.50, '-4deg'],
    [95,  30,  80, '-70px', '-100px','-100px','-180px','-70px', '-260px',36, 9,    0.45, '7deg'],
    [58,  65,  88, '50px',  '-80px', '-20px', '-150px','50px',  '-230px',30, 16,   0.38, '-8deg'],
    [82,  20,  40, '-60px', '70px',  '-110px','140px', '-60px', '220px', 44, 2,    0.52, '4deg'],
    [66,  90,  75, '-80px', '-50px', '-150px','20px',  '-80px', '90px',  33, 18,   0.42, '-5deg'],
    [110, 45,  45, '50px',  '-70px', '30px',  '-130px','50px',  '-200px',50, 8,    0.35, '3deg'],
  ];

  configs.forEach(([size, left, top, dx1, dy1, dx2, dy2, dx3, dy3, dur, delay, op, rot0]) => {
    const img = document.createElement('img');
    img.src   = FLOATER_SRCS[Math.floor(Math.random() * FLOATER_SRCS.length)];
    img.alt   = '';
    img.className = 'floater';
    img.draggable = false;
    img.style.cssText = `
      width: ${size}px;
      left: ${left}%;
      top: ${top}%;
      --dur: ${dur}s;
      --delay: -${delay}s;
      --op: ${op};
      --rot0: ${rot0};
      --dx1: ${dx1}; --dy1: ${dy1};
      --dx2: ${dx2}; --dy2: ${dy2};
      --dx3: ${dx3}; --dy3: ${dy3};
      --rot1: ${Math.random() > 0.5 ? '10deg' : '-10deg'};
      --rot2: ${rot0};
      --rot3: ${Math.random() > 0.5 ? '-12deg' : '12deg'};
    `;
    container.appendChild(img);
  });
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
  } else {
    // Hide music toggle + pause music when leaving landing
    btnMusicToggle?.classList.add('hidden');
    stopLandingMusic();
  }
}

// Attempt autoplay on page load (landing is the default screen)
window.addEventListener('DOMContentLoaded', () => {
  spawnFloaters();
  startLandingMusic();
  // If autoplay was blocked, first interaction on the page will start it
  const startOnInteract = () => {
    if (!musicStarted && !musicMuted) startLandingMusic();
    window.removeEventListener('pointerdown', startOnInteract);
    window.removeEventListener('keydown',     startOnInteract);
  };
  window.addEventListener('pointerdown', startOnInteract);
  window.addEventListener('keydown',     startOnInteract);
});

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
  if (phase === 'WRITING_FACTS') updateTimerBar('timer-bar-writing', timeLeft, 60);
  if (phase === 'VOTING')        updateTimerBar('timer-bar-voting',  timeLeft, 30);
});

socket.on('fact_submitted', ({ count, total }) => {
  const el = $('facts-submitted-count');
  if (el) el.textContent = ` (${count}/${total} ready)`;
});

socket.on('vote_update', ({ count, total }) => {
  const el = $('votes-count');
  if (el) el.textContent = ` (${count}/${total} voted)`;
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

