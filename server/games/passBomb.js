/**
 * server/games/passBomb.js
 * Server-side logic for "Pass the Bomb" – real-time arena elimination game.
 *
 * Phases:
 *   LOBBY → PTB_COUNTDOWN → PTB_PLAYING → PTB_EXPLOSION → PTB_GAME_OVER
 *
 * One bomb, physics-based movement, collisions transfer the bomb,
 * bomb explodes when timer hits zero, last player standing wins.
 */

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const ARENA_W         = 800;
const ARENA_H         = 560;
const PLAYER_R        = 20;        // collision radius
const PLAYER_SPEED    = 200;       // px/s base speed
const TICK_MS         = 33;        // 30 fps server tick (reduces perceived input lag)
const BOMB_MIN        = 13;        // seconds
const BOMB_MAX        = 22;        // seconds
const COUNTDOWN_SECS  = 3;
const EXPLODE_PAUSE   = 2800;      // ms between explosion and new bomb
const PASS_COOLDOWN_MS = 1200;     // ms after receiving bomb before it can be transferred again
const PLACE_SCORES    = [100, 60, 40, 25, 15, 10, 5, 5, 5, 5];

// ─────────────────────────────────────────────────────────────────────────────
//  ARENA OBSTACLES  [x, y, w, h]
// ─────────────────────────────────────────────────────────────────────────────
const OBSTACLES = [
  // Four corner pillars
  [  40,  30, 80, 80 ],
  [ 680,  30, 80, 80 ],
  [  40, 450, 80, 80 ],
  [ 680, 450, 80, 80 ],
  // Centre dividers
  [ 330, 100, 140, 34 ],
  [ 330, 426, 140, 34 ],
  [ 120, 260,  34, 80 ],
  [ 646, 260,  34, 80 ],
];

// ─────────────────────────────────────────────────────────────────────────────
//  MODIFIERS
// ─────────────────────────────────────────────────────────────────────────────
const MODIFIER_POOL = [
  { id: 'speed_surge',   name: 'Speed Surge!',    icon: '⚡', color: '#22c55e', duration: 8  },
  { id: 'sticky_bomb',   name: 'Sticky Bomb!',    icon: '🧲', color: '#f97316', duration: 6  },
  { id: 'gravity_shift', name: 'Gravity Shift!',  icon: '🌀', color: '#8b5cf6', duration: 7  },
  { id: 'magnetic',      name: 'Magnetic Arena!', icon: '🔮', color: '#ec4899', duration: 6  },
  { id: 'teleport',      name: 'Teleport Chaos!', icon: '✨', color: '#06b6d4', duration: 0  }, // instant
];

// ─────────────────────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function randBetween(a, b) { return a + Math.random() * (b - a); }
function dist2(ax, ay, bx, by) { const dx = ax-bx, dy = ay-by; return dx*dx + dy*dy; }

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Test circle–AABB overlap */
function circleAABB(cx, cy, r, bx, by, bw, bh) {
  const nx = Math.max(bx, Math.min(cx, bx + bw));
  const ny = Math.max(by, Math.min(cy, by + bh));
  const dx = cx - nx, dy = cy - ny;
  return dx*dx + dy*dy < r*r;
}

/** Push circle p out of AABB. Mutates p.x, p.y. */
function resolveCircleAABB(p, bx, by, bw, bh, r) {
  if (!circleAABB(p.x, p.y, r, bx, by, bw, bh)) return;
  const nx = Math.max(bx, Math.min(p.x, bx + bw));
  const ny = Math.max(by, Math.min(p.y, by + bh));
  let dx = p.x - nx, dy = p.y - ny;
  const d = Math.sqrt(dx*dx + dy*dy);
  if (d < 0.0001) {
    // Centre is inside – push to nearest wall
    const oL = p.x - bx, oR = bx + bw - p.x, oT = p.y - by, oB = by + bh - p.y;
    const m  = Math.min(oL, oR, oT, oB);
    if (m === oL) p.x = bx - r;
    else if (m === oR) p.x = bx + bw + r;
    else if (m === oT) p.y = by - r;
    else               p.y = by + bh + r;
    return;
  }
  const penetration = r - d;
  if (penetration > 0) {
    p.x += (dx / d) * penetration;
    p.y += (dy / d) * penetration;
  }
}

/** Generate evenly-spread spawn ring positions */
function generateSpawnPositions(count) {
  const cx = ARENA_W / 2, cy = ARENA_H / 2;
  const rx = ARENA_W * 0.28, ry = ARENA_H * 0.28;
  return Array.from({ length: count }, (_, i) => {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
  });
}

/** Clear all active timers stored in gs */
function clearTimers(gs) {
  if (gs._tick)      { clearInterval(gs._tick);  gs._tick      = null; }
  if (gs._countdown) { clearInterval(gs._countdown); gs._countdown = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  GAME STATE
// ─────────────────────────────────────────────────────────────────────────────
class PassBombState {
  constructor(roomPlayers) {
    this.players = roomPlayers.map((rp) => ({
      id:         rp.id,
      name:       rp.name,
      color:      rp.color,
      x: 0, y: 0,
      vx: 0, vy: 0,
      inputDx: 0, inputDy: 0,
      hasBomb:    false,
      alive:      true,
      score:      rp.score || 0,
      stickyUntil: 0,
      passCooldownUntil: 0,
    }));

    this.phase          = 'PTB_COUNTDOWN';
    this.bombHolderId   = null;
    this.bombTimeLeft   = 0;
    this.bombMaxTime    = 0;
    this.countdownLeft  = COUNTDOWN_SECS;
    this.modifier       = null;
    this.modifierTLeft  = 0;
    this.nextModifier   = Date.now() + randBetween(12000, 20000);
    this.eliminationLog = [];  // { id, name, color } in order of elimination
    this.lastTickTime   = Date.now();
    this._tick          = null;
    this._countdown     = null;
  }

  alivePlayers() { return this.players.filter((p) => p.alive); }

  serialise() {
    return {
      phase:        this.phase,
      players:      this.players.map((p) => ({
        id:      p.id,
        name:    p.name,
        color:   p.color,
        x:       Math.round(p.x),
        y:       Math.round(p.y),
        hasBomb: p.hasBomb,
        alive:   p.alive,
        score:   p.score,
      })),
      bombHolderId:  this.bombHolderId,
      bombTimeLeft:  +this.bombTimeLeft.toFixed(2),
      bombMaxTime:   this.bombMaxTime,
      countdownLeft: this.countdownLeft,
      modifier:      this.modifier,
      modifierTLeft: +Math.max(0, this.modifierTLeft).toFixed(1),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PHASE CONTROLLERS
// ─────────────────────────────────────────────────────────────────────────────

function startCountdown(io, room) {
  const gs = room.gameState;
  clearTimers(gs);
  gs.phase         = 'PTB_COUNTDOWN';
  gs.countdownLeft = COUNTDOWN_SECS;

  // Spawn all players
  const alive = gs.players;
  const spawns = shuffle(generateSpawnPositions(alive.length));
  alive.forEach((p, i) => {
    Object.assign(p, { ...spawns[i], vx: 0, vy: 0, alive: true, hasBomb: false, stickyUntil: 0, passCooldownUntil: 0, inputDx: 0, inputDy: 0 });
  });

  io.to(room.id).emit('phase_changed', {
    phase: 'PTB_COUNTDOWN',
    data:  { ...gs.serialise() },
  });

  let cd = COUNTDOWN_SECS;
  gs._countdown = setInterval(() => {
    cd--;
    gs.countdownLeft = cd;
    io.to(room.id).emit('ptb_countdown', { count: cd });
    if (cd <= 0) {
      clearInterval(gs._countdown);
      gs._countdown = null;
      startPlaying(io, room);
    }
  }, 1000);
}

function startPlaying(io, room) {
  const gs = room.gameState;
  clearTimers(gs);
  gs.phase         = 'PTB_PLAYING';
  gs.modifier      = null;
  gs.modifierTLeft = 0;
  gs.nextModifier  = Date.now() + randBetween(12000, 20000);
  gs.eliminationLog = [];

  assignBomb(gs, null);

  io.to(room.id).emit('phase_changed', {
    phase: 'PTB_PLAYING',
    data:  gs.serialise(),
  });

  gs.lastTickTime = Date.now();
  gs._tick = setInterval(() => gameTick(io, room), TICK_MS);
}

function assignBomb(gs, excludeId) {
  gs.players.forEach((p) => { p.hasBomb = false; });
  const candidates = gs.alivePlayers().filter((p) => p.id !== excludeId);
  if (!candidates.length) return;
  const holder      = candidates[Math.floor(Math.random() * candidates.length)];
  holder.hasBomb    = true;
  gs.bombHolderId   = holder.id;
  gs.bombTimeLeft   = randBetween(BOMB_MIN, BOMB_MAX);
  gs.bombMaxTime    = gs.bombTimeLeft;
}

// ─────────────────────────────────────────────────────────────────────────────
//  GAME TICK  (runs at 20 fps)
// ─────────────────────────────────────────────────────────────────────────────
function gameTick(io, room) {
  const gs = room.gameState;
  if (gs.phase !== 'PTB_PLAYING') return;

  const now = Date.now();
  const dt  = Math.min((now - gs.lastTickTime) / 1000, 0.1);
  gs.lastTickTime = now;

  // ── Modifier lifecycle ──────────────────────────────────
  if (gs.modifier) {
    gs.modifierTLeft -= dt;
    if (gs.modifierTLeft <= 0) {
      gs.modifier = null;
      gs.modifierTLeft = 0;
      io.to(room.id).emit('ptb_modifier_end', {});
    }
  }
  if (!gs.modifier && now >= gs.nextModifier && gs.alivePlayers().length > 1) {
    activateModifier(io, room);
    gs.nextModifier = now + randBetween(18000, 36000);
  }

  const speedMult  = gs.modifier?.id === 'speed_surge'   ? 1.7 : 1.0;
  const gravMode   = gs.modifier?.id === 'gravity_shift';
  const magMode    = gs.modifier?.id === 'magnetic';
  const bombHolder = gs.players.find((p) => p.id === gs.bombHolderId && p.alive);
  const alive      = gs.alivePlayers();

  // ── Move players ────────────────────────────────────────
  for (const p of alive) {
    const spd = PLAYER_SPEED * speedMult;
    let sx = p.inputDx * spd;
    let sy = p.inputDy * spd;

    if (gravMode) {
      sx *= 0.55;
      sy = sy * 0.55 + spd * 0.38;
    }

    if (magMode && bombHolder && p.id !== bombHolder.id) {
      const dx = bombHolder.x - p.x;
      const dy = bombHolder.y - p.y;
      const d  = Math.sqrt(dx*dx + dy*dy) || 1;
      sx += (dx / d) * 70;
      sy += (dy / d) * 70;
    }

    p.vx = sx;
    p.vy = sy;
    p.x += sx * dt;
    p.y += sy * dt;

    // Arena boundary
    p.x = Math.max(PLAYER_R, Math.min(ARENA_W - PLAYER_R, p.x));
    p.y = Math.max(PLAYER_R, Math.min(ARENA_H - PLAYER_R, p.y));

    // Obstacle collision
    for (const obs of OBSTACLES) resolveCircleAABB(p, obs[0], obs[1], obs[2], obs[3], PLAYER_R);

    // Re-clamp after resolve
    p.x = Math.max(PLAYER_R, Math.min(ARENA_W - PLAYER_R, p.x));
    p.y = Math.max(PLAYER_R, Math.min(ARENA_H - PLAYER_R, p.y));
  }

  // ── Bomb transfer ───────────────────────────────────────
  if (bombHolder) {
    const isSticky  = gs.modifier?.id === 'sticky_bomb' || (bombHolder.stickyUntil > now);
    const isCooling = bombHolder.passCooldownUntil > now;
    if (!isSticky && !isCooling) {
      for (const other of alive) {
        if (other.id === bombHolder.id) continue;
        if (dist2(bombHolder.x, bombHolder.y, other.x, other.y) < (PLAYER_R * 2.1) ** 2) {
          transferBomb(io, room, bombHolder, other);
          break;
        }
      }
    }
  }

  // Refresh bombHolder reference after possible transfer
  const newHolder = gs.players.find((p) => p.id === gs.bombHolderId && p.alive);

  // ── Bomb timer ──────────────────────────────────────────
  if (gs.bombTimeLeft > 0 && newHolder) {
    gs.bombTimeLeft -= dt;
    if (gs.bombTimeLeft <= 0) {
      gs.bombTimeLeft = 0;
      clearTimers(gs);
      explodeBomb(io, room, newHolder);
      return;
    }
  } else if (!newHolder && alive.length > 0) {
    // Bomb holder left unexpectedly — reassign
    assignBomb(gs, null);
  }

  // ── Broadcast ───────────────────────────────────────────
  io.to(room.id).emit('ptb_state', gs.serialise());
}

// ─────────────────────────────────────────────────────────────────────────────
//  BOMB TRANSFER
// ─────────────────────────────────────────────────────────────────────────────
function transferBomb(io, room, from, to) {
  const gs = room.gameState;
  from.hasBomb   = false;
  to.hasBomb     = true;
  gs.bombHolderId = to.id;

  // Always apply a brief pass cooldown to prevent instant ping-pong transfers
  to.passCooldownUntil = Date.now() + PASS_COOLDOWN_MS;

  // Sticky modifier makes bomb stick for 3s after receiving
  if (gs.modifier?.id === 'sticky_bomb') {
    to.stickyUntil = Date.now() + 3000;
  }

  io.to(room.id).emit('ptb_bomb_transfer', {
    fromId:       from.id,
    fromName:     from.name,
    toId:         to.id,
    toName:       to.name,
    bombTimeLeft: +gs.bombTimeLeft.toFixed(2),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  EXPLOSION
// ─────────────────────────────────────────────────────────────────────────────
function explodeBomb(io, room, player) {
  const gs = room.gameState;
  gs.phase = 'PTB_EXPLOSION';
  player.alive    = false;
  player.hasBomb  = false;
  gs.eliminationLog.push({ id: player.id, name: player.name, color: player.color });

  io.to(room.id).emit('ptb_explosion', {
    eliminatedId:   player.id,
    eliminatedName: player.name,
    eliminatedColor:player.color,
    x: Math.round(player.x),
    y: Math.round(player.y),
    players: gs.serialise().players,
  });

  const alive = gs.alivePlayers();

  if (alive.length <= 1) {
    // Final winner
    const winner = alive[0] || null;

    // Score everyone based on survival order (1st place = last alive = winner)
    // eliminationLog: first element = first out (lowest place)
    // winner scores PLACE_SCORES[0]; last-eliminated = PLACE_SCORES[1]; etc.
    if (winner) {
      winner.score += PLACE_SCORES[0];
    }
    // Award scores in reverse elimination order (last eliminated = 2nd place)
    const reversed = [...gs.eliminationLog].reverse();
    reversed.forEach((entry, idx) => {
      const p = gs.players.find((pl) => pl.id === entry.id);
      if (p) p.score += PLACE_SCORES[idx + 1] || 5;
    });

    setTimeout(() => endGame(io, room, winner), EXPLODE_PAUSE);
  } else {
    // Continue with a new bomb
    setTimeout(() => {
      assignBomb(gs, player.id);
      gs.phase = 'PTB_PLAYING';

      io.to(room.id).emit('ptb_new_bomb', {
        holderId:    gs.bombHolderId,
        holderName:  gs.players.find((p) => p.id === gs.bombHolderId)?.name || '?',
        bombTimeLeft: +gs.bombTimeLeft.toFixed(2),
        bombMaxTime:  gs.bombMaxTime,
        players:      gs.serialise().players,
      });

      gs.lastTickTime = Date.now();
      gs._tick = setInterval(() => gameTick(io, room), TICK_MS);
    }, EXPLODE_PAUSE);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MODIFIERS
// ─────────────────────────────────────────────────────────────────────────────
function activateModifier(io, room) {
  const gs  = room.gameState;
  const mod = MODIFIER_POOL[Math.floor(Math.random() * MODIFIER_POOL.length)];

  if (mod.id === 'teleport') {
    // Instant – teleport all alive players
    const alive  = gs.alivePlayers();
    const spawns = shuffle(generateSpawnPositions(alive.length));
    alive.forEach((p, i) => {
      p.x = spawns[i].x;
      p.y = spawns[i].y;
      p.vx = 0;
      p.vy = 0;
    });
    io.to(room.id).emit('ptb_modifier', { modifier: mod, duration: 0 });
    return;
  }

  gs.modifier      = mod;
  gs.modifierTLeft = mod.duration;
  io.to(room.id).emit('ptb_modifier', { modifier: mod, duration: mod.duration });
}

// ─────────────────────────────────────────────────────────────────────────────
//  GAME OVER
// ─────────────────────────────────────────────────────────────────────────────
function endGame(io, room, winner) {
  const gs = room.gameState;
  clearTimers(gs);
  gs.phase = 'PTB_GAME_OVER';

  const sorted = [...gs.players].sort((a, b) => b.score - a.score);

  io.to(room.id).emit('phase_changed', {
    phase: 'PTB_GAME_OVER',
    data:  {
      phase:       'PTB_GAME_OVER',
      winner:      winner ? { id: winner.id, name: winner.name, color: winner.color, score: winner.score } : null,
      finalScores: sorted.map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
function init(io, room) {
  room.gameState = new PassBombState(room.players);
  startCountdown(io, room);
}

function handleEvent(io, socket, room, event, data) {
  const gs = room.gameState;
  if (!gs) return;

  switch (event) {

    case 'ptb_input': {
      if (gs.phase !== 'PTB_PLAYING') return;
      const p = gs.players.find((pl) => pl.id === socket.id && pl.alive);
      if (!p) return;
      p.inputDx = Math.max(-1, Math.min(1, data.dx || 0));
      p.inputDy = Math.max(-1, Math.min(1, data.dy || 0));
      break;
    }

    case 'restart_game': {
      if (socket.id !== room.host) return;
      if (gs.phase !== 'PTB_GAME_OVER') return;
      clearTimers(gs);
      room.players.forEach((p) => { p.score = 0; });
      init(io, room);
      break;
    }

    default: break;
  }
}

function handleLeave(io, socketId, room) {
  const gs = room.gameState;
  if (!gs || !['PTB_PLAYING', 'PTB_COUNTDOWN'].includes(gs.phase)) return;

  const p = gs.players.find((pl) => pl.id === socketId);
  if (!p || !p.alive) return;

  const hadBomb = p.hasBomb;
  p.alive   = false;
  p.hasBomb = false;

  const alive = gs.alivePlayers();

  if (hadBomb && alive.length > 0) {
    assignBomb(gs, socketId);
    io.to(room.id).emit('ptb_new_bomb', {
      holderId:    gs.bombHolderId,
      holderName:  gs.players.find((pl) => pl.id === gs.bombHolderId)?.name || '?',
      bombTimeLeft: +gs.bombTimeLeft.toFixed(2),
      bombMaxTime:  gs.bombMaxTime,
      players:      gs.serialise().players,
    });
  }

  if (alive.length <= 1) {
    clearTimers(gs);
    const winner = alive[0] || null;
    if (winner) winner.score += PLACE_SCORES[0];
    setTimeout(() => endGame(io, room, winner), 1500);
  }
}

module.exports = { init, handleEvent, handleLeave };
