/**
 * server/games/whoIsIt.js
 * Server-side logic for the "Who Is It?" game.
 *
 * Phases:
 *  LOBBY → WRITING_FACTS → VOTING → RESULT_REVEAL → (loop) → GAME_OVER
 */

const WRITING_TIME = 60;   // seconds for players to submit facts
const VOTING_TIME  = 30;   // seconds per voting round
const REVEAL_TIME  = 6000; // ms to show result before next round

// Points
const POINTS_CORRECT_GUESS  = 1;  // guesser gets this for a right answer
const POINTS_FOOL_PLAYERS   = 2;  // author gets this for each player fooled

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function emitPhase(io, room) {
  const gs = room.gameState;

  // During VOTING, send a per-player flag so the author can be shown
  // a watch-only UI without revealing the author to everyone.
  if (gs.phase === 'VOTING' && gs.currentFact) {
    const base = gs.publicData(false);
    room.players.forEach((p) => {
      io.to(p.id).emit('phase_changed', {
        phase: gs.phase,
        data: {
          ...base,
          youAreAuthor: p.id === gs.currentFact.authorId,
        },
      });
    });
    return;
  }

  io.to(room.id).emit('phase_changed', {
    phase: gs.phase,
    data: gs.publicData(),
  });
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function clearTimer(room) {
  if (room.gameState._timer) {
    clearInterval(room.gameState._timer);
    room.gameState._timer = null;
  }
}

// ─────────────────────────────────────────────
//  GAME STATE CLASS
// ─────────────────────────────────────────────
class WhoIsItState {
  constructor(players) {
    this.phase            = 'WRITING_FACTS';
    this.players          = players; // shallow ref to room.players
    this.facts            = {};      // socketId -> fact string
    this.factsQueue       = [];      // shuffled list of facts to show
    this.currentFact      = null;    // { authorId, text, index }
    this.votes            = {};      // socketId -> voted socketId
    this.eligibleVoterIds = new Set(); // snapshot of eligible voter IDs for the current round
    this.roundIndex       = 0;
    this.timeLeft         = WRITING_TIME;
    this._timer           = null;
  }

  // Returns only the data safe to broadcast to clients
  publicData(revealAuthor = false) {
    const base = {
      phase:       this.phase,
      timeLeft:    this.timeLeft,
      players:     this.players.map((p) => ({
        id:    p.id,
        name:  p.name,
        color: p.color,
        score: p.score,
      })),
      roundIndex:  this.roundIndex,
      totalFacts:  this.factsQueue.length,
      factSubmittedIds: Object.keys(this.facts),
    };

    if (this.currentFact) {
      base.factText  = this.currentFact.text;
      base.voteCount = Object.keys(this.votes).length;
      if (revealAuthor) {
        base.authorId = this.currentFact.authorId;
        base.votes    = { ...this.votes };
      }
    }

    return base;
  }
}

// ─────────────────────────────────────────────
//  PHASE CONTROLLERS
// ─────────────────────────────────────────────

/**
 * Start the writing phase.
 */
function startWritingPhase(io, room) {
  const gs = room.gameState;
  gs.phase    = 'WRITING_FACTS';
  gs.facts    = {};
  gs.timeLeft = WRITING_TIME;

  emitPhase(io, room);

  // Countdown timer
  clearTimer(room);
  gs._timer = setInterval(() => {
    gs.timeLeft--;
    io.to(room.id).emit('timer_tick', { timeLeft: gs.timeLeft, phase: gs.phase });

    if (gs.timeLeft <= 0) {
      clearTimer(room);
      // Fill in empty facts for anyone who didn't submit
      room.players.forEach((p) => {
        if (!gs.facts[p.id]) {
          gs.facts[p.id] = `${p.name} forgot to write a fact!`;
        }
      });
      startVotingRound(io, room);
    }
  }, 1000);
}

/**
 * Advance to the next voting round (or end the game).
 */
function startVotingRound(io, room) {
  const gs = room.gameState;
  clearTimer(room);

  // Build the queue once (first round)
  if (gs.factsQueue.length === 0) {
    gs.factsQueue = shuffle(
      Object.entries(gs.facts).map(([authorId, text]) => ({ authorId, text }))
    );
  }

  if (gs.roundIndex >= gs.factsQueue.length) {
    return endGame(io, room);
  }

  gs.currentFact = {
    ...gs.factsQueue[gs.roundIndex],
    index: gs.roundIndex,
  };
  gs.votes = {};

  // Snapshot eligible voters for this round (everyone except the fact's author).
  // Using a fixed snapshot means late disconnects won't shrink the
  // threshold and trigger a premature round-end.
  gs.eligibleVoterIds = new Set(
    room.players
      .filter((p) => p.id !== gs.currentFact.authorId)
      .map((p) => p.id)
  );

  gs.phase    = 'VOTING';
  gs.timeLeft = VOTING_TIME;

  emitPhase(io, room);

  clearTimer(room);
  gs._timer = setInterval(() => {
    gs.timeLeft--;
    io.to(room.id).emit('timer_tick', { timeLeft: gs.timeLeft, phase: gs.phase });

    if (gs.timeLeft <= 0) {
      clearTimer(room);
      revealResult(io, room);
    }
  }, 1000);
}

/**
 * Reveal who wrote the current fact.
 */
function revealResult(io, room) {
  const gs = room.gameState;
  clearTimer(room);

  // ── Award points ────────────────────────────────────
  const authorId = gs.currentFact.authorId;
  const author   = room.players.find((p) => p.id === authorId);
  let fooledCount = 0;

  Object.entries(gs.votes).forEach(([voterId, votedId]) => {
    if (voterId === authorId) return; // author can't vote for themselves

    if (votedId === authorId) {
      // Correct guess
      const guesser = room.players.find((p) => p.id === voterId);
      if (guesser) guesser.score += POINTS_CORRECT_GUESS;
    } else {
      // Author fooled this player
      fooledCount++;
    }
  });

  if (author) author.score += fooledCount * POINTS_FOOL_PLAYERS;

  gs.phase = 'RESULT_REVEAL';

  io.to(room.id).emit('phase_changed', {
    phase: 'RESULT_REVEAL',
    data:  gs.publicData(true), // include author reveal
  });

  // Auto-advance after REVEAL_TIME
  gs._timer = setTimeout(() => {
    gs.roundIndex++;
    startVotingRound(io, room);
  }, REVEAL_TIME);
}

/**
 * End the game and show final scores.
 */
function endGame(io, room) {
  const gs  = room.gameState;
  gs.phase  = 'GAME_OVER';
  clearTimer(room);

  const sorted = [...room.players].sort((a, b) => b.score - a.score);

  io.to(room.id).emit('phase_changed', {
    phase: 'GAME_OVER',
    data: {
      phase:        'GAME_OVER',
      finalScores:  sorted.map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
      winner:       sorted[0],
    },
  });
}

// ─────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────

/**
 * Called by gameManager when the host starts the game.
 */
function init(io, room) {
  room.gameState = new WhoIsItState(room.players);
  startWritingPhase(io, room);
}

/**
 * Route game-specific Socket.IO events.
 */
function handleEvent(io, socket, room, event, data) {
  const gs = room.gameState;
  if (!gs) return;

  switch (event) {
    // ── Player submits their fact ──────────────────────────────
    case 'submit_fact': {
      if (gs.phase !== 'WRITING_FACTS') return;
      const fact = String(data.fact || '').trim().slice(0, 200);
      if (!fact) return;

      gs.facts[socket.id] = fact;

      // Let everyone know how many have submitted
      io.to(room.id).emit('fact_submitted', {
        count:  Object.keys(gs.facts).length,
        total:  room.players.length,
        playerId: socket.id,
      });

      // All submitted? Move on immediately
      if (Object.keys(gs.facts).length >= room.players.length) {
        clearTimer(room);
        startVotingRound(io, room);
      }
      break;
    }

    // ── Player submits their vote ──────────────────────────────
    case 'submit_vote': {
      if (gs.phase !== 'VOTING') return;
      // Only players snapshotted at round-start may vote
      if (!gs.eligibleVoterIds.has(socket.id)) return;
      if (socket.id === gs.currentFact.authorId) return; // author doesn't vote
      // Prevent duplicate votes (use `in` – reliable even if value is falsy)
      if (socket.id in gs.votes) return;

      const votedId = data.votedPlayerId;
      // No voting for yourself
      if (votedId === socket.id) return;
      const validPlayer = room.players.find((p) => p.id === votedId);
      if (!validPlayer) return;

      gs.votes[socket.id] = votedId;

      const votedCount = Object.keys(gs.votes).length;
      io.to(room.id).emit('vote_update', {
        count: votedCount,
        total: gs.eligibleVoterIds.size, // all players in round
      });

      // All eligible players have voted?
      if (votedCount >= gs.eligibleVoterIds.size) {
        clearTimer(room);
        revealResult(io, room);
      }
      break;
    }

    // ── Host requests a new game (replay) ─────────────────────
    case 'restart_game': {
      if (socket.id !== room.host) return;
      if (gs.phase !== 'GAME_OVER') return;
      room.players.forEach((p) => { p.score = 0; });
      init(io, room);
      break;
    }

    default:
      break;
  }
}

/**
 * Called when a player leaves while a game is in progress.
 * If they were an eligible voter, remove them from the snapshot and
 * check whether the remaining eligible players have all voted.
 */
function handleLeave(io, socketId, room) {
  const gs = room.gameState;
  if (!gs || gs.phase !== 'VOTING') return;
  if (!gs.eligibleVoterIds.has(socketId)) return;

  gs.eligibleVoterIds.delete(socketId);

  // If the set is now empty everyone eligible has either voted or left.
  // Also check if all remaining eligible players already submitted votes.
  const pendingVoters = [...gs.eligibleVoterIds].filter((id) => !(id in gs.votes));
  if (pendingVoters.length === 0) {
    clearTimer(room);
    revealResult(io, room);
  }
}

module.exports = { init, handleEvent, handleLeave };
