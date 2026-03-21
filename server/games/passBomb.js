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
const BOMB_HOLDER_SPEED_MULT = 1.22; // bomb holder is 22% faster so they can catch others
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
//  tileset / floorTile / wallTile are visual hints for the client renderer.
//  All tile coords are [row, col] into the packed 12×11 spritesheet (16px tiles).
// ─────────────────────────────────────────────────────────────────────────────
const MAPS = [
  // ── 1. Cursed Crypt ────────────────────────────────────────────────────────
  {
    id: 'cursed_crypt',
    name: 'Cursed Crypt',
    desc: 'Ancient stone passages and a cursed altar. Nowhere is truly safe.',
    icon: '💀',
    bg: '#07060e',
    gridColor: '#7c3aed',
    borderColor: 'rgba(109,40,217,0.55)',
    obstacleColor: '#1c1530',
    obstacleStroke: 'rgba(139,92,246,0.7)',
    tileset: 'dungeon',
    floorTile: [3, 6],   // bright stone floor
    wallTile:  [0, 0],   // darkest stone wall
    obstacles: [
      // Top-left L-chamber
      [  28,  28, 175,  28 ],
      [  28,  28,  28, 170 ],
      // Top-right L-chamber
      [ 597,  28, 175,  28 ],
      [ 744,  28,  28, 170 ],
      // Bottom-left L-chamber
      [  28, 504, 175,  28 ],
      [  28, 362,  28, 170 ],
      // Bottom-right L-chamber
      [ 597, 504, 175,  28 ],
      [ 744, 362,  28, 170 ],
      // Central cross altar
      [ 348, 204, 104,  24 ],   // horizontal arm
      [ 388, 160,  24, 240 ],   // vertical shaft
    ],
  },

  // ── 2. Cobblestone Plaza ───────────────────────────────────────────────────
  {
    id: 'cobblestone_plaza',
    name: 'Cobblestone Plaza',
    desc: 'A busy market square. Weave through the stalls or get cornered!',
    icon: '🏪',
    bg: '#0e0c07',
    gridColor: '#d97706',
    borderColor: 'rgba(217,119,6,0.5)',
    obstacleColor: '#26200e',
    obstacleStroke: 'rgba(245,158,11,0.65)',
    tileset: 'town',
    floorTile: [3, 0],   // cobblestone pavement
    wallTile:  [4, 7],   // building-detail tile
    obstacles: [
      // Left column of market stall pillars (spaced 100px apart)
      [ 108,  40,  44,  44 ],
      [ 108, 140,  44,  44 ],
      [ 108, 240,  44,  44 ],
      [ 108, 340,  44,  44 ],
      [ 108, 440,  44,  44 ],
      // Right column
      [ 648,  40,  44,  44 ],
      [ 648, 140,  44,  44 ],
      [ 648, 240,  44,  44 ],
      [ 648, 340,  44,  44 ],
      [ 648, 440,  44,  44 ],
      // Central covered market dividers
      [ 312, 158, 176,  24 ],
      [ 312, 378, 176,  24 ],
    ],
  },

  // ── 3. Shadow Labyrinth ────────────────────────────────────────────────────
  {
    id: 'shadow_labyrinth',
    name: 'Shadow Labyrinth',
    desc: 'Winding dungeon corridors. One wrong turn and you\'re trapped.',
    icon: '🌀',
    bg: '#050c12',
    gridColor: '#0891b2',
    borderColor: 'rgba(8,145,178,0.5)',
    obstacleColor: '#091620',
    obstacleStroke: 'rgba(6,182,212,0.65)',
    tileset: 'dungeon',
    floorTile: [3, 0],   // stone floor
    wallTile:  [1, 0],   // dark stone wall
    obstacles: [
      // Outer channel walls (touching arena edge for maze feel)
      [ 160,   0,  26, 200 ],
      [ 160, 280,  26, 280 ],
      [ 614,   0,  26, 200 ],
      [ 614, 280,  26, 280 ],
      // Inner vertical dividers
      [ 390,  60,  26, 150 ],
      [ 390, 340,  26, 160 ],
      // Horizontal cross-walls
      [   0, 192, 136,  26 ],
      [ 220, 130, 154,  26 ],
      [ 186, 348, 154,  26 ],
      [ 444, 106, 144,  26 ],
      [ 444, 408, 144,  26 ],
      [ 664, 192, 136,  26 ],
      // Center choke
      [ 338, 248,  48,  26 ],
      [ 414, 248,  48,  26 ],
    ],
  },

  // ── 4. Castle Siege ────────────────────────────────────────────────────────
  {
    id: 'castle_siege',
    name: 'Castle Siege',
    desc: 'Storm the inner keep or defend the outer walls. No easy path.',
    icon: '🏰',
    bg: '#0a0810',
    gridColor: '#9333ea',
    borderColor: 'rgba(147,51,234,0.5)',
    obstacleColor: '#18122a',
    obstacleStroke: 'rgba(168,85,247,0.65)',
    tileset: 'dungeon',
    floorTile: [3, 3],   // mid-tone stone
    wallTile:  [2, 0],   // medium stone wall
    obstacles: [
      // Outer battlements – four broken sections leave 4 cardinal gaps
      [  48,  48, 230,  26 ],   // outer top-left
      [ 522,  48, 230,  26 ],   // outer top-right
      [  48, 486, 230,  26 ],   // outer bot-left
      [ 522, 486, 230,  26 ],   // outer bot-right
      [  48,  48,  26, 190 ],   // outer left-top
      [  48, 322,  26, 190 ],   // outer left-bot
      [ 726,  48,  26, 190 ],   // outer right-top
      [ 726, 322,  26, 190 ],   // outer right-bot
      // Inner fortress – 8-piece wall with 4 entrance gaps (~80px each)
      [ 240, 160, 100,  24 ],   // inner top-left
      [ 460, 160, 100,  24 ],   // inner top-right   (gap 340-460 = 120px)
      [ 240, 376, 100,  24 ],   // inner bot-left
      [ 460, 376, 100,  24 ],   // inner bot-right
      [ 240, 184,  24,  80 ],   // inner left-top
      [ 240, 336,  24,  44 ],   // inner left-bot    (gap 264-336 = 72px)
      [ 536, 184,  24,  80 ],   // inner right-top
      [ 536, 336,  24,  44 ],   // inner right-bot
    ],
  },

  // ── 5. Enchanted Forest ────────────────────────────────────────────────────
  {
    id: 'enchanted_forest',
    name: 'Enchanted Forest',
    desc: 'Twisted ancient trees block every clean path. The bomb glows like a cursed lantern.',
    icon: '🌲',
    bg: '#040b06',
    gridColor: '#16a34a',
    borderColor: 'rgba(22,163,74,0.45)',
    obstacleColor: '#0d1e0c',
    obstacleStroke: 'rgba(34,197,94,0.6)',
    tileset: 'town',
    floorTile: [5, 0],   // earthy natural ground
    wallTile:  [4, 7],   // foliage / tree tile
    obstacles: [
      // Top-left grove
      [  76,  46,  46, 46 ],
      [ 132,  80,  46, 46 ],
      [  76, 132,  46, 46 ],
      // Top-center grove
      [ 356,  28,  46, 46 ],
      [ 412,  64,  46, 46 ],
      [ 356,  96,  46, 46 ],
      // Top-right grove
      [ 656,  60,  46, 46 ],
      [ 680, 116,  46, 46 ],
      // Left flank
      [  56, 264,  46, 46 ],
      [  56, 326,  46, 46 ],
      // Center ancient tree (bigger)
      [ 368, 220,  64, 80 ],
      // Right flank
      [ 698, 254,  46, 46 ],
      [ 698, 316,  46, 46 ],
      // Bottom-left grove
      [  96, 440,  46, 46 ],
      [ 148, 476,  46, 46 ],
      // Bottom-center
      [ 374, 432,  46, 46 ],
      [ 432, 462,  46, 46 ],
      // Bottom-right grove
      [ 638, 434,  46, 46 ],
      [ 684, 472,  46, 46 ],
    ],
  },
];

/** Get obstacles for a given map id (defaults to classic) */
function getMapById(mapId) {
  return MAPS.find((m) => m.id === mapId) || MAPS[0];
}

// ─────────────────────────────────────────────────────────────────────────────
//  PICKUP BOXES  – random buffs & debuffs scattered around the arena
// ─────────────────────────────────────────────────────────────────────────────
const PICKUP_BUFFS = [
  { id: 'speed_boost',  type: 'buff',   name: 'Speed Boost',  icon: '⚡', color: '#22c55e', duration: 6  },
  { id: 'shield',       type: 'buff',   name: 'Shield',       icon: '🛡️', color: '#3b82f6', duration: 8  },
  { id: 'ghost',        type: 'buff',   name: 'Ghost Mode',   icon: '👻', color: '#a855f7', duration: 4  },
  { id: 'swap',         type: 'buff',   name: 'Swap!',        icon: '🔀', color: '#06b6d4', duration: 0  },
  { id: 'freeze_aura',  type: 'buff',   name: 'Freeze Aura',  icon: '❄️', color: '#bae6fd', duration: 4  },
];
const PICKUP_DEBUFFS = [
  { id: 'slippery',     type: 'debuff', name: 'Slippery!',    icon: '🧊', color: '#ef4444', duration: 5  },
  { id: 'sticky',       type: 'debuff', name: 'Sticky Bomb',  icon: '🧲', color: '#f97316', duration: 4  },
  { id: 'blindness',    type: 'debuff', name: 'Blindness',    icon: '🙈', color: '#78716c', duration: 3  },
  { id: 'magnet',       type: 'debuff', name: 'Bomb Magnet',  icon: '🔮', color: '#ec4899', duration: 5  },
  { id: 'tiny',         type: 'debuff', name: 'Tiny!',        icon: '🐭', color: '#f59e0b', duration: 5  },
];

// Pre-defined box spawn points per map [x, y] — all in open walkable areas
const MAP_BOX_SPAWNS = {
  cursed_crypt:      [[230,170],[570,170],[230,390],[570,390],[400,280],[400,80],[400,480]],
  cobblestone_plaza: [[400,60],[400,280],[400,500],[250,280],[550,280],[190,340],[610,340]],
  shadow_labyrinth:  [[80,96],[720,96],[80,464],[720,464],[290,260],[510,260],[400,400]],
  castle_siege:      [[180,100],[620,100],[180,460],[620,460],[400,280],[80,280],[720,280]],
  enchanted_forest:  [[280,280],[520,280],[400,165],[200,390],[600,390],[400,420]],
};
const DEFAULT_BOX_SPAWNS = [[200,160],[600,160],[400,280],[200,400],[600,400]];

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
  if (gs._boxTimers)      { gs._boxTimers.forEach(clearTimeout); gs._boxTimers = []; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PICKUP BOX FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
function randPickup() {
  const isDebuff = Math.random() < 0.40; // 40% debuff, 60% buff
  const pool = isDebuff ? PICKUP_DEBUFFS : PICKUP_BUFFS;
  return pool[Math.floor(Math.random() * pool.length)];
}

function spawnBox(io, room, usedIdxs) {
  const gs     = room.gameState;
  const spawns = MAP_BOX_SPAWNS[gs.mapId] || DEFAULT_BOX_SPAWNS;
  const avail  = spawns.map((_, i) => i).filter((i) => !usedIdxs.includes(i));
  if (!avail.length) return null;
  const idx = avail[Math.floor(Math.random() * avail.length)];
  const [x, y] = spawns[idx];
  const def = randPickup();
  const box = { id: `box_${Date.now()}_${Math.random().toString(36).slice(2)}`, x, y, spawnIdx: idx, def };
  gs.boxes.push(box);
  io.to(room.id).emit('ptb_box_spawn', { id: box.id, x, y, def });
  return box;
}

function initBoxes(io, room) {
  const gs = room.gameState;
  gs.boxes     = [];
  gs._boxTimers = [];
  const spawns = MAP_BOX_SPAWNS[gs.mapId] || DEFAULT_BOX_SPAWNS;
  const count  = Math.min(2, spawns.length);
  const used   = [];
  for (let i = 0; i < count; i++) {
    const box = spawnBox(io, room, used);
    if (box) used.push(box.spawnIdx);
  }
}

function collectBox(io, room, player, box) {
  const gs  = room.gameState;
  const now = Date.now();
  gs.boxes  = gs.boxes.filter((b) => b.id !== box.id);
  const def = box.def;

  // Apply server-side effect
  switch (def.id) {
    case 'speed_boost':  player.speedBoostUntil = now + def.duration * 1000; break;
    case 'shield':       player.shieldUntil     = now + def.duration * 1000; break;
    case 'ghost':        player.ghostUntil      = now + def.duration * 1000; break;
    case 'swap': {
      const others = gs.alivePlayers().filter((p) => p.id !== player.id);
      if (others.length) {
        const t = others[Math.floor(Math.random() * others.length)];
        const tx = t.x; const ty = t.y;
        t.x = player.x; t.y = player.y;
        player.x = tx;  player.y = ty;
      }
      break;
    }
    case 'freeze_aura': {
      const until = now + def.duration * 1000;
      gs.alivePlayers().forEach((p) => { if (p.id !== player.id) p.frozenUntil = until; });
      break;
    }
    case 'slippery':  player.slipperyUntil = now + def.duration * 1000; break;
    case 'sticky':    player.stickyUntil   = now + def.duration * 1000; break;
    case 'blindness': player.blindUntil    = now + def.duration * 1000; break;
    case 'magnet':    player.magnetUntil   = now + def.duration * 1000; break;
    case 'tiny':      player.tinyUntil     = now + def.duration * 1000; break;
  }

  io.to(room.id).emit('ptb_box_collected', {
    id:            box.id,
    collecterId:   player.id,
    collectorName: player.name,
    def,
    blindUntil:    def.id === 'blindness' ? player.blindUntil : 0,
  });

  // Respawn a new box after 5-8 seconds
  const delay = 5000 + Math.random() * 3000;
  const timer = setTimeout(() => {
    if (!room.gameState || room.gameState.phase !== 'PTB_PLAYING') return;
    const usedIdxs = gs.boxes.map((b) => b.spawnIdx);
    spawnBox(io, room, usedIdxs);
  }, delay);
  gs._boxTimers.push(timer);
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
                 tileset: m.tileset, floorTile: m.floorTile, wallTile: m.wallTile,
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
      stickyUntil:      0,
      passCooldownUntil: 0,
      // pickup effect timestamps
      speedBoostUntil:  0,
      shieldUntil:      0,
      ghostUntil:       0,
      frozenUntil:      0,
      slipperyUntil:    0,
      blindUntil:       0,
      magnetUntil:      0,
      tinyUntil:        0,
    }));

    this.mapId          = mapId || 'classic';
    this.map            = getMapById(this.mapId);
    this.phase          = 'PTB_COUNTDOWN';
    this.bombHolderId   = null;
    this.bombTimeLeft   = 0;
    this.bombMaxTime    = 0;
    this.countdownLeft  = COUNTDOWN_SECS;
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
    // Pickup boxes
    this.boxes          = [];
    this._boxTimers     = [];
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
        // active effects (timestamps — client uses these for visual cues)
        speedBoostUntil: p.speedBoostUntil || 0,
        shieldUntil:     p.shieldUntil     || 0,
        ghostUntil:      p.ghostUntil      || 0,
        frozenUntil:     p.frozenUntil     || 0,
        slipperyUntil:   p.slipperyUntil   || 0,
        blindUntil:      p.blindUntil      || 0,
        magnetUntil:     p.magnetUntil     || 0,
        tinyUntil:       p.tinyUntil       || 0,
      })),
      bombHolderId:  this.bombHolderId,
      bombTimeLeft:  +this.bombTimeLeft.toFixed(2),
      bombMaxTime:   this.bombMaxTime,
      countdownLeft: this.countdownLeft,
      boxes:         this.boxes,
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
    Object.assign(p, { ...spawns[i], vx: 0, vy: 0, alive: true, hasBomb: false,
      stickyUntil: 0, passCooldownUntil: 0, inputDx: 0, inputDy: 0,
      speedBoostUntil: 0, shieldUntil: 0, ghostUntil: 0, frozenUntil: 0,
      slipperyUntil: 0, blindUntil: 0, magnetUntil: 0, tinyUntil: 0 });
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
  gs.phase          = 'PTB_PLAYING';
  gs.eliminationLog = [];

  assignBomb(gs, null);
  initBoxes(io, room);

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
  const dt  = PHYS_DT;
  gs.lastTickTime = now;

  const obstacles  = gs.map.obstacles;
  const bombHolder = gs.players.find((p) => p.id === gs.bombHolderId && p.alive);
  const alive      = gs.alivePlayers();

  // ── Move players ────────────────────────────────────────
  for (const p of alive) {
    const holderBoost = p.hasBomb                ? BOMB_HOLDER_SPEED_MULT : 1.0;
    const speedBuff   = (p.speedBoostUntil > now) ? 1.35                  : 1.0;
    const frozenMult  = (p.frozenUntil     > now) ? 0.5                   : 1.0;
    const spd = PLAYER_SPEED * holderBoost * speedBuff * frozenMult;

    // Slippery: invert controls
    const inv = (p.slipperyUntil > now) ? -1 : 1;
    let sx = p.inputDx * spd * inv;
    let sy = p.inputDy * spd * inv;

    // Magnet debuff: nudge the bomb holder toward this player
    if (p.magnetUntil > now && bombHolder && bombHolder.id !== p.id) {
      const mx = p.x - bombHolder.x;
      const my = p.y - bombHolder.y;
      const md = Math.sqrt(mx*mx + my*my) || 1;
      if (md < 260) {
        bombHolder.x += (mx / md) * 55 * dt;
        bombHolder.y += (my / md) * 55 * dt;
      }
    }

    p.vx = sx;
    p.vy = sy;
    p.x += sx * dt;
    p.y += sy * dt;

    // Arena boundary
    p.x = Math.max(PLAYER_R, Math.min(ARENA_W - PLAYER_R, p.x));
    p.y = Math.max(PLAYER_R, Math.min(ARENA_H - PLAYER_R, p.y));

    // Obstacle collision (ghost players pass through)
    if (!(p.ghostUntil > now)) {
      for (const obs of obstacles) resolveCircleAABB(p, obs[0], obs[1], obs[2], obs[3], PLAYER_R);
    }

    // Re-clamp after resolve
    p.x = Math.max(PLAYER_R, Math.min(ARENA_W - PLAYER_R, p.x));
    p.y = Math.max(PLAYER_R, Math.min(ARENA_H - PLAYER_R, p.y));
  }

  // ── Pickup box collection ────────────────────────────────
  const BOX_PICK_R2 = 28 * 28;
  for (const p of alive) {
    for (let i = gs.boxes.length - 1; i >= 0; i--) {
      const box = gs.boxes[i];
      if (dist2(p.x, p.y, box.x, box.y) < BOX_PICK_R2) {
        collectBox(io, room, p, box);
        break;
      }
    }
  }

  // ── Bomb transfer ───────────────────────────────────────
  if (bombHolder) {
    const isSticky  = (bombHolder.stickyUntil > now);
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
  const gs  = room.gameState;
  const now = Date.now();

  // Shield buff: block the transfer and consume the shield
  if (to.shieldUntil > now) {
    to.shieldUntil = 0;
    io.to(room.id).emit('ptb_shield_block', { blockerId: to.id, blockerName: to.name });
    return;
  }

  from.hasBomb    = false;
  to.hasBomb      = true;
  gs.bombHolderId = to.id;

  // Brief pass cooldown to prevent instant ping-pong
  to.passCooldownUntil = now + PASS_COOLDOWN_MS;

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
