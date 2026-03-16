/**
 * server/games/drawingDash.js
 * Server-side logic for "Drawing Dash" – a Skribbl.io-style drawing & guessing game.
 *
 * Phases (all prefixed DD_ so client can identify them):
 *   LOBBY → DD_PICKING_WORD → DD_DRAWING → DD_ROUND_END → (repeat) → DD_GAME_OVER
 */

// ─────────────────────────────────────────────────────────────────────────────
//  WORD DICTIONARY
// ─────────────────────────────────────────────────────────────────────────────
const WORD_LIST = [
  // Animals
  'cat','dog','fish','bird','lion','bear','wolf','frog','duck','crab',
  'shark','whale','horse','snake','eagle','tiger','zebra','monkey','penguin','octopus',
  'jellyfish','butterfly','elephant','dinosaur','crocodile',
  // Objects
  'apple','banana','pizza','cake','burger','sword','shield','crown','ring','key',
  'lamp','chair','table','clock','phone','guitar','piano','drum','camera','rocket',
  'balloon','umbrella','backpack','candle','diamond','anchor','compass','telescope',
  'ladder','hammer','scissors','glasses','binoculars','trophy','treasure',
  // Places
  'beach','forest','desert','volcano','island','castle','lighthouse','igloo','farm',
  'cave','swamp','jungle','library','hospital','theater','prison','museum','school',
  // Actions
  'flying','swimming','sleeping','dancing','climbing','falling','running','jumping',
  'fishing','surfing','skiing','cooking','reading','singing','laughing','crying',
  'painting','hiding','melting','exploding',
  // Nature
  'sun','moon','star','cloud','rainbow','lightning','tornado','snowflake','fire',
  'mountain','waterfall','ocean','river','tree','flower','mushroom','cactus',
  // Misc / Fun
  'ghost','robot','wizard','ninja','pirate','zombie','alien','mermaid','vampire',
  'superhero','astronaut','knight','dragon','unicorn',
  'ice cream','hot dog','sushi','taco','sandwich','cookie',
  'birthday','christmas','halloween',
  'spaceship','submarine','helicopter','train','bicycle','skateboard','canoe',
];

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const CHOOSE_TIME      = 15;    // seconds to pick a word
const ROUND_TIME       = 110;   // seconds per drawing turn
const ROUND_END_WAIT   = 7000;  // ms before advancing after round ends

// Scoring — intentionally modest so games feel balanced
const SCORE_FIRST_GUESS      = 120;  // max points for the first correct guesser
const SCORE_GUESS_DECREMENT  = 12;   // subtract per rank position
const SCORE_MIN_GUESS        = 30;   // floor for guesser points
const SCORE_TIME_BONUS_MAX   = 40;   // extra pts awarded for guessing early
const SCORE_DRAWER_PER_GUESS = 18;   // drawer earns this per person who guesses
const SCORE_DRAWER_NO_GUESS  = 12;   // flat bonus to drawer when nobody guesses (still tried)

// Fraction of ROUND_TIME remaining when additional hint letters are revealed
const HINT_THRESHOLDS = [0.55, 0.25];

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickWords(count = 3) {
  return shuffle(WORD_LIST).slice(0, count);
}

function buildHintString(word, revealedIndices) {
  return word.split('').map((ch, i) => {
    if (ch === ' ') return ' ';
    return revealedIndices.includes(i) ? ch : '_';
  }).join('');
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function isCloseGuess(guess, word) {
  if (Math.abs(guess.length - word.length) > 2) return false;
  return levenshtein(guess, word) === 1;
}

function clearTimer(room) {
  const gs = room.gameState;
  if (!gs) return;
  if (gs._timer) {
    clearInterval(gs._timer);
    clearTimeout(gs._timer);
    gs._timer = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  GAME STATE CLASS
// ─────────────────────────────────────────────────────────────────────────────
class DrawingDashState {
  constructor(players, totalRounds) {
    this.players    = players;     // ref to room.players
    this.totalRounds = totalRounds;

    // Pre-generate every drawing turn: <totalRounds> shuffled passes through all players
    this.turnOrder = [];
    for (let r = 0; r < totalRounds; r++) {
      this.turnOrder.push(...shuffle(players.map((p) => p.id)));
    }

    this.turnIndex    = 0;
    this.drawerId     = this.turnOrder[0];

    this.phase        = null;
    this.wordChoices  = [];
    this.currentWord  = '';

    this.guessedIds   = [];        // ordered by guess time
    this.revealedIdx  = [];        // indices of revealed hint letters
    this.hintsGiven   = 0;

    this.drawCache    = [];        // recent draw events for replay on late-join (capped)
    this.chatHistory  = [];        // last 80 messages

    this.timeLeft     = CHOOSE_TIME;
    this._timer       = null;

    this.roundHistory = [];
  }

  get currentRound() {
    return Math.floor(this.turnIndex / this.players.length) + 1;
  }
  get totalTurns() {
    return this.turnOrder.length;
  }

  hint() {
    return buildHintString(this.currentWord, this.revealedIdx);
  }

  playerData() {
    return this.players.map((p) => ({
      id: p.id, name: p.name, color: p.color, score: p.score,
    }));
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  BROADCAST HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function emitPhase(io, room, extra = {}) {
  const gs = room.gameState;
  const base = {
    phase:        gs.phase,
    timeLeft:     gs.timeLeft,
    players:      gs.playerData(),
    drawerId:     gs.drawerId,
    drawerName:   (room.players.find((p) => p.id === gs.drawerId) || {}).name || '?',
    turnIndex:    gs.turnIndex,
    totalTurns:   gs.totalTurns,
    currentRound: gs.currentRound,
    totalRounds:  gs.totalRounds,
    hint:         gs.hint(),
    wordLength:   gs.currentWord.length,
    guessedCount: gs.guessedIds.length,
    chatHistory:  gs.chatHistory.slice(-30),
    ...extra,
  };

  room.players.forEach((p) => {
    const data = { ...base };
    data.isDrawer  = p.id === gs.drawerId;
    data.youGuessed = gs.guessedIds.includes(p.id);
    if (data.isDrawer) data.word = gs.currentWord;
    io.to(p.id).emit('phase_changed', { phase: gs.phase, data });
  });
}

function broadcastChat(io, room, msg) {
  const gs = room.gameState;
  gs.chatHistory.push(msg);
  if (gs.chatHistory.length > 80) gs.chatHistory.shift();
  io.to(room.id).emit('dd_chat_message', msg);
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

/** Begin the word-picking phase for the current drawer. */
function startPickingPhase(io, room) {
  const gs = room.gameState;
  clearTimer(room);

  gs.phase       = 'DD_PICKING_WORD';
  gs.wordChoices = pickWords(3);
  gs.currentWord = '';
  gs.guessedIds  = [];
  gs.revealedIdx = [];
  gs.hintsGiven  = 0;
  gs.drawCache   = [];
  gs.timeLeft    = CHOOSE_TIME;

  // All players see the phase; drawer privately gets word choices
  emitPhase(io, room);
  io.to(gs.drawerId).emit('dd_word_choices', { words: gs.wordChoices });

  // Countdown — auto-pick first word if drawer doesn't choose
  gs._timer = setInterval(() => {
    gs.timeLeft--;
    io.to(room.id).emit('timer_tick', { timeLeft: gs.timeLeft, phase: gs.phase });
    if (gs.timeLeft <= 0) {
      clearTimer(room);
      selectWord(io, room, gs.wordChoices[0]);
    }
  }, 1000);
}

/** Drawer has chosen a word — begin the drawing round. */
function selectWord(io, room, word) {
  const gs = room.gameState;
  clearTimer(room);

  gs.currentWord = word.toLowerCase().trim();
  gs.phase       = 'DD_DRAWING';
  gs.timeLeft    = ROUND_TIME;

  // Clear canvas for everyone
  io.to(room.id).emit('dd_draw', { type: 'clear' });

  emitPhase(io, room);

  gs._timer = setInterval(() => {
    gs.timeLeft--;
    io.to(room.id).emit('timer_tick', { timeLeft: gs.timeLeft, phase: gs.phase });

    // Hints
    const frac = gs.timeLeft / ROUND_TIME;
    if (gs.hintsGiven < HINT_THRESHOLDS.length && frac <= HINT_THRESHOLDS[gs.hintsGiven]) {
      revealHint(io, room);
    }

    // All eligible players guessed?
    const eligible = room.players.filter((p) => p.id !== gs.drawerId).length;
    if (eligible > 0 && gs.guessedIds.length >= eligible) {
      clearTimer(room);
      endRound(io, room);
      return;
    }

    if (gs.timeLeft <= 0) {
      clearTimer(room);
      endRound(io, room);
    }
  }, 1000);
}

/** Reveal one more letter from the current word. */
function revealHint(io, room) {
  const gs = room.gameState;
  const word = gs.currentWord;

  const unrevealed = word.split('').reduce((acc, ch, i) => {
    if (ch !== ' ' && !gs.revealedIdx.includes(i)) acc.push(i);
    return acc;
  }, []);

  if (!unrevealed.length) return;

  const idx = unrevealed[Math.floor(Math.random() * unrevealed.length)];
  gs.revealedIdx.push(idx);
  gs.hintsGiven++;

  io.to(room.id).emit('dd_hint', { hint: gs.hint() });
}

/** Handle an incoming guess from a player. */
function handleGuess(io, socket, room, rawText) {
  const gs = room.gameState;
  const player = room.players.find((p) => p.id === socket.id);
  if (!player) return;

  const text = rawText.trim().slice(0, 100);
  if (!text) return;

  // Drawer can't guess — broadcast as regular chat
  if (socket.id === gs.drawerId) {
    broadcastChat(io, room, {
      playerId: socket.id, name: player.name, color: player.color,
      text, isDrawer: true,
    });
    return;
  }

  // Already guessed — allow chatting but flag it
  if (gs.guessedIds.includes(socket.id)) {
    broadcastChat(io, room, {
      playerId: socket.id, name: player.name, color: player.color,
      text, alreadyGuessed: true,
    });
    return;
  }

  const guess = text.toLowerCase();
  const word  = gs.currentWord;

  if (guess === word) {
    // ── Correct! ────────────────────────────────────────────
    gs.guessedIds.push(socket.id);
    const rank = gs.guessedIds.length;
    // Base score decreases with rank; add time bonus so earlier guesses score more
    const base     = Math.max(SCORE_MIN_GUESS, SCORE_FIRST_GUESS - (rank - 1) * SCORE_GUESS_DECREMENT);
    const timeFrac = Math.max(0, gs.timeLeft / ROUND_TIME);
    const bonus    = Math.round(timeFrac * SCORE_TIME_BONUS_MAX);
    const pts      = base + bonus;
    player.score += pts;

    broadcastChat(io, room, {
      isSystem: true, isCorrect: true,
      text: `🎉 ${player.name} guessed the word!`,
    });

    io.to(room.id).emit('dd_player_guessed', {
      playerId: socket.id, name: player.name, score: pts,
      rank, players: gs.playerData(),
    });

    const eligible = room.players.filter((p) => p.id !== gs.drawerId).length;
    if (gs.guessedIds.length >= eligible) {
      clearTimer(room);
      endRound(io, room);
    }
  } else if (isCloseGuess(guess, word)) {
    // ── Close! ───────────────────────────────────────────────
    broadcastChat(io, room, {
      playerId: socket.id, name: player.name, color: player.color,
      text, isClose: true,
    });
  } else {
    // ── Regular guess ────────────────────────────────────────
    broadcastChat(io, room, {
      playerId: socket.id, name: player.name, color: player.color, text,
    });
  }
}

/** Wrap up the current drawing turn and show the reveal. */
function endRound(io, room) {
  const gs = room.gameState;
  clearTimer(room);
  gs.phase = 'DD_ROUND_END';

  // Award drawer
  const drawer = room.players.find((p) => p.id === gs.drawerId);
  if (drawer) {
    if (gs.guessedIds.length > 0) {
      // Points per person who guessed
      drawer.score += gs.guessedIds.length * SCORE_DRAWER_PER_GUESS;
    } else {
      // Nobody guessed — drawer still gets a small consolation bonus for trying
      drawer.score += SCORE_DRAWER_NO_GUESS;
    }
  }

  const entry = {
    drawerId:   gs.drawerId,
    drawerName: drawer ? drawer.name  : '?',
    drawerColor:drawer ? drawer.color : '#888',
    word:       gs.currentWord,
    guessedBy:  gs.guessedIds.map((id) => {
      const p = room.players.find((pl) => pl.id === id);
      return p ? { id, name: p.name, color: p.color } : { id, name: '?', color: '#888' };
    }),
  };
  gs.roundHistory.push(entry);

  broadcastChat(io, room, {
    isSystem: true, revealWord: true,
    text: `The word was: "${gs.currentWord}"`,
  });

  io.to(room.id).emit('phase_changed', {
    phase: 'DD_ROUND_END',
    data: {
      phase:        'DD_ROUND_END',
      word:         gs.currentWord,
      drawerId:     gs.drawerId,
      drawerName:   entry.drawerName,
      drawerColor:  entry.drawerColor,
      guessedBy:    entry.guessedBy,
      players:      gs.playerData(),
      turnIndex:    gs.turnIndex,
      totalTurns:   gs.totalTurns,
      currentRound: gs.currentRound,
      totalRounds:  gs.totalRounds,
    },
  });

  gs._timer = setTimeout(() => {
    gs.turnIndex++;
    if (gs.turnIndex >= gs.totalTurns) {
      endGame(io, room);
    } else {
      gs.drawerId = gs.turnOrder[gs.turnIndex];
      startPickingPhase(io, room);
    }
  }, ROUND_END_WAIT);
}

/** End the game and send the final scores. */
function endGame(io, room) {
  const gs = room.gameState;
  clearTimer(room);
  gs.phase = 'DD_GAME_OVER';

  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  io.to(room.id).emit('phase_changed', {
    phase: 'DD_GAME_OVER',
    data: {
      phase:        'DD_GAME_OVER',
      finalScores:  sorted.map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
      winner:       sorted[0],
      roundHistory: gs.roundHistory,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
function init(io, room) {
  room.gameState = new DrawingDashState(room.players, 3);
  startPickingPhase(io, room);
}

function handleEvent(io, socket, room, event, data) {
  const gs = room.gameState;
  if (!gs) return;

  switch (event) {
    // ── Drawer picks a word ──────────────────────────────────────────────────
    case 'dd_choose_word': {
      if (gs.phase !== 'DD_PICKING_WORD') return;
      if (socket.id !== gs.drawerId) return;

      let word = '';
      if (data.wordIndex !== undefined && gs.wordChoices[data.wordIndex]) {
        word = gs.wordChoices[data.wordIndex];
      } else if (data.custom) {
        word = String(data.custom).trim().replace(/\s+/g, ' ').slice(0, 30);
      }
      if (!word) return;

      clearTimer(room);
      selectWord(io, room, word);
      break;
    }

    // ── Drawing event (stroke / fill / clear) ────────────────────────────────
    case 'dd_draw': {
      if (gs.phase !== 'DD_DRAWING') return;
      if (socket.id !== gs.drawerId) return;

      // Cache for potential replay (cap at 3000 entries)
      gs.drawCache.push(data);
      if (gs.drawCache.length > 3000) gs.drawCache.shift();

      // Forward to all other players
      socket.to(room.id).emit('dd_draw', data);
      break;
    }

    // ── Chat / guess ─────────────────────────────────────────────────────────
    case 'dd_chat': {
      if (gs.phase !== 'DD_DRAWING') return;
      handleGuess(io, socket, room, String(data.text || ''));
      break;
    }

    // ── Host restarts the game ───────────────────────────────────────────────
    case 'restart_game': {
      if (socket.id !== room.host) return;
      if (gs.phase !== 'DD_GAME_OVER') return;
      room.players.forEach((p) => { p.score = 0; });
      init(io, room);
      break;
    }

    default: break;
  }
}

function handleLeave(io, socketId, room) {
  const gs = room.gameState;
  if (!gs || !['DD_PICKING_WORD', 'DD_DRAWING'].includes(gs.phase)) return;

  if (gs.phase === 'DD_PICKING_WORD' && socketId === gs.drawerId) {
    // Drawer left while picking — skip to next turn
    clearTimer(room);
    gs.turnIndex++;
    if (gs.turnIndex >= gs.totalTurns) {
      endGame(io, room);
    } else {
      gs.drawerId = gs.turnOrder[gs.turnIndex];
      startPickingPhase(io, room);
    }
    return;
  }

  if (gs.phase === 'DD_DRAWING') {
    if (socketId === gs.drawerId) {
      // Drawer disconnected — end the round early
      clearTimer(room);
      broadcastChat(io, room, { isSystem: true, text: 'The drawer left. Moving on…' });
      gs._timer = setTimeout(() => endRound(io, room), 2000);
      return;
    }

    // A guesser left — check if everyone remaining has guessed
    const remaining = room.players.filter((p) => p.id !== gs.drawerId && p.id !== socketId);
    if (remaining.length > 0 && remaining.every((p) => gs.guessedIds.includes(p.id))) {
      clearTimer(room);
      endRound(io, room);
    }
  }
}

module.exports = { init, handleEvent, handleLeave };
