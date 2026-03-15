/**
 * socket.js
 * Registers all Socket.IO event handlers.
 */

const roomManager  = require('./roomManager');
const gameManager  = require('./gameManager');

const GAME_EVENTS = [
  // Who Is It?
  'submit_fact', 'submit_vote',
  // Drawing Dash
  'dd_choose_word', 'dd_draw', 'dd_chat',
  // Shared
  'restart_game',
];

module.exports = function registerSocketHandlers(io) {
  io.on('connection', (socket) => {
    console.log(`[+] Connected: ${socket.id}`);

    // ── Room: get available games ─────────────────────────────────
    socket.on('get_games', (_data, callback) => {
      callback({ games: gameManager.getAvailableGames() });
    });

    // ── Room: create ──────────────────────────────────────────────
    socket.on('create_room', ({ playerName } = {}, callback) => {
      if (!playerName || !playerName.trim()) {
        return callback({ error: 'Player name is required.' });
      }
      try {
        const room = roomManager.createRoom(socket.id, playerName);
        socket.join(room.id);
        console.log(`  Room ${room.id} created by ${playerName}`);
        callback({ room: roomManager.publicRoom(room) });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // ── Room: join ────────────────────────────────────────────────
    socket.on('join_room', ({ roomId, playerName } = {}, callback) => {
      if (!playerName || !playerName.trim()) {
        return callback({ error: 'Player name is required.' });
      }
      if (!roomId) return callback({ error: 'Room code is required.' });

      try {
        const { room, player } = roomManager.joinRoom(roomId, socket.id, playerName);
        socket.join(room.id);

        // Notify everyone else in the room
        socket.to(room.id).emit('player_joined', {
          player: { id: player.id, name: player.name, color: player.color },
          room:   roomManager.publicRoom(room),
        });

        console.log(`  ${playerName} joined room ${room.id}`);
        callback({ room: roomManager.publicRoom(room) });
      } catch (err) {
        callback({ error: err.message });
      }
    });

    // ── Room: start game ──────────────────────────────────────────
    socket.on('start_game', ({ gameType } = {}, callback) => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) return callback({ error: 'You are not in a room.' });
      if (room.host !== socket.id) return callback({ error: 'Only the host can start the game.' });
      if (!gameType) return callback({ error: 'No game type specified.' });

      const result = gameManager.startGame(io, room.id, gameType);
      if (result.error) return callback({ error: result.error });

      callback({ success: true });
    });

    // ── Room: get current state (reconnect helper) ────────────────
    socket.on('get_room_state', (_data, callback) => {
      const room = roomManager.getRoomBySocket(socket.id);
      if (!room) return callback({ error: 'Not in a room.' });
      callback({ room: roomManager.publicRoom(room) });
    });

    // ── Game-specific events ──────────────────────────────────────
    GAME_EVENTS.forEach((event) => {
      socket.on(event, (data) => {
        gameManager.handleGameEvent(io, socket, event, data);
      });
    });

    // ── Disconnect ────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[-] Disconnected: ${socket.id}`);

      // Notify the active game handler BEFORE the player is removed from
      // room.players so it can update any per-round snapshots.
      const roomBeforeRemoval = roomManager.getRoomBySocket(socket.id);
      if (roomBeforeRemoval) {
        gameManager.handlePlayerLeave(io, socket.id, roomBeforeRemoval);
      }

      const room = roomManager.removePlayer(socket.id);
      if (room) {
        io.to(room.id).emit('player_left', {
          playerId: socket.id,
          room:     roomManager.publicRoom(room),
        });
      }
    });
  });
};
