/**
 * gameManager.js
 * Manages all game logic for every supported game type.
 * Designed to be easily extended with new games.
 */

const roomManager = require('./roomManager');

// ─────────────────────────────────────────────
//  GAME REGISTRY
//  Add new games here by adding a key and handler module.
// ─────────────────────────────────────────────
const GAMES = {
  'who-is-it': require('./games/whoIsIt'),
};

/**
 * Return a list of available game metadata for the UI.
 */
function getAvailableGames() {
  return [
    {
      id: 'who-is-it',
      title: 'Who Is It?',
      description: 'Write a strange fact about yourself. Can your friends guess who wrote it?',
      longDescription: 'Everyone writes one strange or surprising fact about themselves. The facts are then revealed one at a time and the group votes on who they think wrote each one. Fool your friends for points, or guess correctly to score!',
      rules: [
        'Each player writes one personal fact — make it surprising!',
        'Facts are revealed one by one to the whole group.',
        'Vote for who you think wrote each fact.',
        '+1 point for guessing the right author.',
        '+2 points (for the author) for each player you fooled.',
        'Most points at the end wins.',
      ],
      minPlayers: 2,
      maxPlayers: 10,
      avgMinutes: 10,
      iconClass: 'fi-rr-incognito',
      bannerGradient: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
      comingSoon: false,
    },
    {
      id: 'drawing-dash',
      title: 'Drawing Dash',
      description: 'Draw a word in 60 seconds and race to guess what others are drawing.',
      longDescription: 'A fast-paced drawing and guessing game. One player draws a secret word while everyone else frantically types guesses. The faster you guess, the more points you earn!',
      rules: [],
      minPlayers: 3,
      maxPlayers: 12,
      avgMinutes: 15,
      iconClass: 'fi-rr-pencil',
      bannerGradient: 'linear-gradient(135deg, #06b6d4 0%, #10b981 100%)',
      comingSoon: true,
    },
    {
      id: 'quiz-blitz',
      title: 'Quiz Blitz',
      description: 'Race against the clock to answer trivia questions faster than your friends.',
      longDescription: 'Trivia meets speed. Answer questions correctly and quickly to climb the leaderboard. Categories rotate every round to keep everyone on their toes.',
      rules: [],
      minPlayers: 2,
      maxPlayers: 16,
      avgMinutes: 12,
      iconClass: 'fi-rr-lightbulb',
      bannerGradient: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
      comingSoon: true,
    },
    {
      id: 'reaction-rush',
      title: 'Reaction Rush',
      description: 'Tap, click, or mash — the fastest reaction wins.',
      longDescription: 'Pure reflex action. Match patterns, dodge obstacles, and out-react your friends in a series of rapid-fire mini challenges.',
      rules: [],
      minPlayers: 2,
      maxPlayers: 8,
      avgMinutes: 5,
      iconClass: 'fi-rr-bolt',
      bannerGradient: 'linear-gradient(135deg, #10b981 0%, #06b6d4 100%)',
      comingSoon: true,
    },
  ];
}

/**
 * Start a game in the given room.
 * @param {object} io - Socket.IO server instance
 * @param {string} roomId
 * @param {string} gameType
 */
function startGame(io, roomId, gameType) {
  const room = roomManager.getRoom(roomId);
  if (!room) return { error: 'Room not found.' };

  const handler = GAMES[gameType];
  if (!handler) return { error: `Unknown game type: ${gameType}` };

  if (room.players.length < 2) return { error: 'Need at least 2 players to start.' };

  room.gameType = gameType;

  // Initialize game state via the specific game handler
  handler.init(io, room);

  return { success: true };
}

/**
 * Handle a game-specific event dispatched from socket.js.
 * @param {object} io
 * @param {object} socket
 * @param {string} event
 * @param {*} data
 */
function handleGameEvent(io, socket, event, data) {
  const room = roomManager.getRoomBySocket(socket.id);
  if (!room || !room.gameType) return;

  const handler = GAMES[room.gameType];
  if (!handler) return;

  if (typeof handler.handleEvent === 'function') {
    handler.handleEvent(io, socket, room, event, data);
  }
}

/**
 * Notify the active game handler that a player has left a room.
 * Must be called BEFORE the player is removed from room.players so the
 * handler can still reference their ID in any snapshots.
 * @param {object} io
 * @param {string} socketId
 * @param {object} room  - The room the player is leaving
 */
function handlePlayerLeave(io, socketId, room) {
  if (!room || !room.gameType || !room.gameState) return;

  const handler = GAMES[room.gameType];
  if (!handler) return;

  if (typeof handler.handleLeave === 'function') {
    handler.handleLeave(io, socketId, room);
  }
}

module.exports = {
  getAvailableGames,
  startGame,
  handleGameEvent,
  handlePlayerLeave,
};
