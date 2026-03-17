/**
 * server/games/passBomb.js
 * Server-side logic for "Pass the Bomb" – real-time arena elimination game.
 *
 * Phases:
 *   LOBBY → PTB_MAP_VOTE → PTB_COUNTDOWN → PTB_PLAYING → PTB_EXPLOSION → PTB_GAME_OVER
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
const TICK_MS         = 33;        // ~30 fps server tick
const PHYS_DT         = TICK_MS / 1000; // fixed physics timestep
const BOMB_MIN        = 20;        // seconds
const BOMB_MAX        = 30;        // seconds
const COUNTDOWN_SECS  = 3;
const VOTE_SECS       = 10;        // map vote duration
const EXPLODE_PAUSE   = 2800;      // ms between explosion and new bomb
const PASS_COOLDOWN_MS = 1200;     // ms after receiving bomb before it can be transferred again
const PLACE_SCORES    = [100, 60, 40, 25, 15, 10, 5, 5, 5, 5];

// ─────────────────────────────────────────────────────────────────────────────
//  MAPS  – each map has an id, name, description, icon, colors and obstacles
// ─────────────────────────────────────────────────────────────────────────────
const MAPS = [
  {
    id: 'classic',
    name: 'Classic Arena',
    desc: 'The original battleground – four pillars and center dividers.',
    icon: '🏟️',
    bg: '#09090f',
    gridColor: '#8b5cf6',
    borderColor: 'rgba(99,102,241,0.4)',
    obstacleColor: '#1a1c32',
    obstacleStroke: 'rgba(99,102,241,0.5)',
    obstacles: [
      [  40,  30, 80, 80 ],
      [ 680,  30, 80, 80 ],
      [  40, 450, 80, 80 ],
      [ 680, 450, 80, 80 ],
      [ 330, 100, 140, 34 ],
      [ 330, 426, 140, 34 ],
      [ 120, 260,  34, 80 ],
      [ 646, 260,  34, 80 ],
    ],
  },
  {
    id: 'the_maze',
    name: 'The Maze',
    desc: 'Tight corridors and dead ends – nowhere to hide for long.',
    icon: '🌀',
    bg: '#070d13',
    gridColor: '#06b6d4',
    borderColor: 'rgba(6,182,212,0.4)',
    obstacleColor: '#0c1a24',
    obstacleStroke: 'rgba(6,182,212,0.5)',
    obstacles: [
      // Vertical walls
      [ 160,   0,  28, 180 ],
      [ 160, 260,  28, 180 ],
      [ 400,   0,  28, 120 ],
      [ 400, 200,  28, 160 ],
      [ 400, 440,  28, 120 ],
      [ 612,   0,  28, 180 ],
      [ 612, 260,  28, 180 ],
      // Horizontal walls
      [   0, 180, 130,  28 ],
      [ 220, 130, 150,  28 ],
      [ 460, 100, 120,  28 ],
      [ 220, 350, 150,  28 ],
      [ 460, 400, 120,  28 ],
      [ 670, 180, 130,  28 ],
    ],
  },
  {
    id: 'open_field',
    name: 'Open Field',
    desc: 'Wide open space – pure speed and reflexes.',
    icon: '🌾',
    bg: '#0a0d07',
    gridColor: '#22c55e',
    borderColor: 'rgba(34,197,94,0.4)',
    obstacleColor: '#141e0f',
    obstacleStroke: 'rgba(34,197,94,0.5)',
    obstacles: [
      // Just two small center blocks
      [ 340, 240,  48, 80 ],
      [ 412, 240,  48, 80 ],
    ],
  },
  {
    id: 'fortress',
    name: 'The Fortress',
    desc: 'A central stronghold with narrow entrances.',
    icon: '🏰',
    bg: '#0d0a0f',
    gridColor: '#a855f7',
    borderColor: 'rgba(168,85,247,0.4)',
    obstacleColor: '#1a1028',
    obstacleStroke: 'rgba(168,85,247,0.5)',
    obstacles: [
      // Outer ring
      [  60,  40, 200,  28 ],
      [ 540,  40, 200,  28 ],
      [  60, 492, 200,  28 ],
      [ 540, 492, 200,  28 ],
      [  60,  40,  28, 180 ],
      [ 712,  40,  28, 180 ],
      [  60, 340,  28, 180 ],
      [ 712, 340,  28, 180 ],
      // Inner fortress
      [ 280, 180, 240,  24 ],
      [ 280, 356, 240,  24 ],
      [ 280, 180,  24, 100 ],
      [ 496, 280,  24, 100 ],
    ],
  },
  {
    id: 'chaos_grid',
    name: 'Chaos Grid',
    desc: 'Scattered obstacles everywhere – pure mayhem!',
    icon: '💥',
    bg: '#0f0907',
    gridColor: '#f97316',
    borderColor: 'rgba(249,115,22,0.4)',
    obstacleColor: '#1e1208',
    obstacleStroke: 'rgba(249,115,22,0.5)',
    obstacles: [
      // Scattered small blocks
      [ 100,  60,  50, 50 ],
      [ 250,  30,  50, 50 ],
      [ 500,  50,  50, 50 ],
      [ 660,  80,  50, 50 ],
      [  80, 200,  50, 50 ],
      [ 300, 170,  50, 50 ],
      [ 450, 150,  50, 50 ],
      [ 620, 220,  50, 50 ],
      [ 160, 340,  50, 50 ],
      [ 350, 310,  50, 50 ],
      [ 520, 330,  50, 50 ],
      [ 700, 360,  50, 50 ],
      [ 100, 460,  50, 50 ],
      [ 280, 470,  50, 50 ],
      [ 480, 460,  50, 50 ],
      [ 650, 480,  50, 50 ],
    ],
  },
];

/** Get obstacles for a given map id (defaults to classic) */
function getMapById(mapId) {
  return MAPS.find((m) => m.id === mapId) || MAPS[0];
}

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
  if (gs._tick)           { clearInterval(gs._tick);  gs._tick           = null; }
  if (gs._countdown)      { clearInterval(gs._countdown); gs._countdown = null; }
  if (gs._explodeTimeout) { clearTimeout(gs._explodeTimeout); gs._explodeTimeout = null; }
  if (gs._voteTimer)      { clearTimeout(gs._voteTimer); gs._voteTimer   = null; }
  if (gs._voteCountdown)  { clearInterval(gs._voteCountdown); gs._voteCountdown = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAP VOTING PHASE
// ─────────────────────────────────────────────────────────────────────────────
function startMapVote(io, room) {
  const gs = room.gameState;
  clearTimers(gs);
  gs.phase         = 'PTB_MAP_VOTE';
  gs.votes         = {};
  gs.voteTimeLeft  = VOTE_SECS;

  // Pick 3 random maps to vote on (always include variety)
  const shuffled   = shuffle(MAPS);
  gs.voteOptions   = shuffled.slice(0, 3).map((m) => m.id);

  const payload = {
    phase: 'PTB_MAP_VOTE',
    data: {
      phase:       'PTB_MAP_VOTE',
      maps:        gs.voteOptions.map((mid) => {
        const m = getMapById(mid);
        return { id: m.id, name: m.name, desc: m.desc, icon: m.icon,
                 bg: m.bg, gridColor: m.gridColor, borderColor: m.borderColor,
                 obstacleColor: m.obstacleColor, obstacleStroke: m.obstacleStroke,
                 obstacles: m.obstacles };
      }),
      votes:       {},
      timeLeft:    VOTE_SECS,
      players:     gs.players.map((p) => ({ id: p.id, name: p.name, color: p.color })),
    },
  };

  io.to(room.id).emit('phase_changed', payload);
  // Safety: ensure host receives the initial vote even if they somehow
  // miss the room broadcast (observed first-round host-only issue).
  if (room.host) io.to(room.host).emit('phase_changed', payload);

  // Countdown timer
  gs._voteCountdown = setInterval(() => {
    gs.voteTimeLeft--;
    io.to(room.id).emit('ptb_vote_tick', { timeLeft: gs.voteTimeLeft });
    if (gs.voteTimeLeft <= 0) {
      clearInterval(gs._voteCountdown);
      gs._voteCountdown = null;
      finaliseVote(io, room);
    }
  }, 1000);
}

function tallyVotes(gs) {
  const counts = {};
  for (const mid of gs.voteOptions) counts[mid] = 0;
  for (const mid of Object.values(gs.votes)) {
    if (counts[mid] !== undefined) counts[mid]++;
  }
  // Find highest
  let best = gs.voteOptions[0], bestN = 0;
  for (const [mid, n] of Object.entries(counts)) {
    if (n > bestN) { best = mid; bestN = n; }
  }
  return best;
}

function finaliseVote(io, room) {
  const gs = room.gameState;
  clearTimers(gs);
  const winnerId = tallyVotes(gs);
  gs.mapId = winnerId;
  gs.map   = getMapById(winnerId);

  io.to(room.id).emit('ptb_vote_result', {
    mapId:   winnerId,
    mapName: gs.map.name,
    mapIcon: gs.map.icon,
  });

  // Short delay then start countdown
  setTimeout(() => {
    startCountdown(io, room);
  }, 1800);
}

// ─────────────────────────────────────────────────────────────────────────────
//  GAME STATE
// ─────────────────────────────────────────────────────────────────────────────
class PassBombState {
  constructor(roomPlayers, mapId) {
    this.players = roomPlayers.map((rp) => ({
      id:         rp.id,
      name:       rp.name,
      color:      rp.color,
      x: 0, y: 0,
      vx: 0, vy: 0,
      inputDx: 0, inputDy: 0,
      inputSeq: 0,            // latest acknowledged input sequence number
      hasBomb:    false,
      alive:      true,
      score:      rp.score || 0,
      stickyUntil: 0,
      passCooldownUntil: 0,
    }));

    this.mapId          = mapId || 'classic';
    this.map            = getMapById(this.mapId);
    this.phase          = 'PTB_COUNTDOWN';
    this.bombHolderId   = null;
    this.bombTimeLeft   = 0;
    this.bombMaxTime    = 0;
    this.countdownLeft  = COUNTDOWN_SECS;
    this.modifier       = null;
    this.modifierTLeft  = 0;
    this.nextModifier   = Date.now() + randBetween(12000, 20000);
    this.eliminationLog = [];
    this.lastTickTime   = Date.now();
    this._tick          = null;
    this._countdown     = null;
    this._explodeTimeout = null;
    // Map voting state (used during PTB_MAP_VOTE)
    this.votes          = {};  // socketId → mapId
    this._voteTimer     = null;
    this._voteCountdown = null;
    this.voteTimeLeft   = VOTE_SECS;
  }

  alivePlayers() { return this.players.filter((p) => p.alive); }

  serialise() {
    return {
      phase:        this.phase,
      mapId:        this.mapId,
      players:      this.players.map((p) => ({
        id:      p.id,
        name:    p.name,
        color:   p.color,
        x:       +p.x.toFixed(2),
        y:       +p.y.toFixed(2),
        hasBomb: p.hasBomb,
        alive:   p.alive,
        score:   p.score,
        seq:     p.inputSeq,
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
    data:  { ...gs.serialise(), map: gs.map },
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
    data:  { ...gs.serialise(), map: gs.map },
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
//  GAME TICK  (fixed timestep for deterministic physics)
// ─────────────────────────────────────────────────────────────────────────────
function gameTick(io, room) {
  const gs = room.gameState;
  if (gs.phase !== 'PTB_PLAYING') return;

  const now = Date.now();
  const dt  = PHYS_DT; // fixed timestep – eliminates jitter from variable intervals
  const wallDt = Math.min((now - gs.lastTickTime) / 1000, 0.1);
  gs.lastTickTime = now;

  const obstacles = gs.map.obstacles;

  // ── Modifier lifecycle ──────────────────────────────────
  if (gs.modifier) {
    gs.modifierTLeft -= wallDt;
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
    for (const obs of obstacles) resolveCircleAABB(p, obs[0], obs[1], obs[2], obs[3], PLAYER_R);

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

    gs._explodeTimeout = setTimeout(() => { gs._explodeTimeout = null; endGame(io, room, winner); }, EXPLODE_PAUSE);
  } else {
    // Continue with a new bomb
    gs._explodeTimeout = setTimeout(() => {
      gs._explodeTimeout = null;
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
      players:     gs.serialise().players,
      winner:      winner ? { id: winner.id, name: winner.name, color: winner.color, score: winner.score } : null,
      finalScores: sorted.map((p) => ({ id: p.id, name: p.name, color: p.color, score: p.score })),
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
//  PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────
function init(io, room) {
  room.gameState = new PassBombState(room.players, 'classic');
  startMapVote(io, room);
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
      if (typeof data.seq === 'number') p.inputSeq = data.seq;
      break;
    }

    case 'ptb_vote': {
      if (gs.phase !== 'PTB_MAP_VOTE') return;
      if (!gs.voteOptions) return;
      const mapId = data && data.mapId;
      if (gs.voteOptions.includes(mapId)) {
        gs.votes[socket.id] = mapId;
        // Broadcast updated vote counts
        const counts = {};
        for (const mid of gs.voteOptions) counts[mid] = 0;
        for (const mid of Object.values(gs.votes)) {
          if (counts[mid] !== undefined) counts[mid]++;
        }
        io.to(room.id).emit('ptb_vote_update', {
          votes: counts,
          voterMap: gs.votes,
        });
      }
      break;
    }

    case 'restart_game': {
      if (socket.id !== room.host) return;
      if (gs.phase !== 'PTB_GAME_OVER' && gs.phase !== 'PTB_EXPLOSION') return;
      clearTimers(gs);
      if (gs._explodeTimeout) { clearTimeout(gs._explodeTimeout); gs._explodeTimeout = null; }
      room.players.forEach((p) => { p.score = 0; });
      init(io, room);
      break;
    }

    default: break;
  }
}

function handleLeave(io, socketId, room) {
  const gs = room.gameState;
  if (!gs || !['PTB_PLAYING', 'PTB_COUNTDOWN', 'PTB_MAP_VOTE'].includes(gs.phase)) return;

  // Remove vote if in voting phase
  if (gs.phase === 'PTB_MAP_VOTE') {
    delete gs.votes[socketId];
    return;
  }

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
    gs._explodeTimeout = setTimeout(() => { gs._explodeTimeout = null; endGame(io, room, winner); }, 1500);
  }
}

module.exports = { init, handleEvent, handleLeave };
