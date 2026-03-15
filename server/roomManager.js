/**
 * roomManager.js
 * Manages creation, joining, and state of all active game rooms.
 */

const { v4: uuidv4 } = require('uuid');

// In-memory store: roomId -> Room object
const rooms = new Map();

// Player avatar colors palette
const AVATAR_COLORS = [
  '#8b5cf6', '#ec4899', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#3b82f6', '#84cc16',
];

/**
 * Generate a short human-readable room code (e.g. "XKCD")
 */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  // Ensure uniqueness
  if (rooms.has(code)) return generateRoomCode();
  return code;
}

/**
 * Create a new room.
 * @param {string} hostSocketId
 * @param {string} hostName
 * @returns Room object
 */
function createRoom(hostSocketId, hostName) {
  const roomId = generateRoomCode();
  const hostPlayer = {
    id: hostSocketId,
    name: hostName.trim().slice(0, 20),
    color: AVATAR_COLORS[0],
    score: 0,
    isHost: true,
  };

  const room = {
    id: roomId,
    host: hostSocketId,
    players: [hostPlayer],
    gameType: null,
    gameState: null,
    createdAt: Date.now(),
  };

  rooms.set(roomId, room);
  return room;
}

/**
 * Join an existing room.
 * @param {string} roomId
 * @param {string} socketId
 * @param {string} playerName
 * @returns { room, player } or throws an error message string
 */
function joinRoom(roomId, socketId, playerName) {
  const room = rooms.get(roomId.toUpperCase());
  if (!room) throw new Error('Room not found. Check the code and try again.');
  if (room.players.length >= 10) throw new Error('Room is full (max 10 players).');
  if (room.gameState && room.gameState.phase !== 'LOBBY') {
    throw new Error('A game is already in progress in this room.');
  }

  const existingNames = room.players.map((p) => p.name.toLowerCase());
  let name = playerName.trim().slice(0, 20);
  // Disambiguate duplicate names
  if (existingNames.includes(name.toLowerCase())) {
    name = `${name}2`;
  }

  const colorIndex = room.players.length % AVATAR_COLORS.length;
  const player = {
    id: socketId,
    name,
    color: AVATAR_COLORS[colorIndex],
    score: 0,
    isHost: false,
  };

  room.players.push(player);
  return { room, player };
}

/**
 * Remove a player from their room by socket ID.
 * @returns The updated room, or null if the room was deleted.
 */
function removePlayer(socketId) {
  for (const [roomId, room] of rooms.entries()) {
    const idx = room.players.findIndex((p) => p.id === socketId);
    if (idx === -1) continue;

    room.players.splice(idx, 1);

    if (room.players.length === 0) {
      rooms.delete(roomId);
      return null;
    }

    // If host left, reassign host
    if (room.host === socketId && room.players.length > 0) {
      room.host = room.players[0].id;
      room.players[0].isHost = true;
    }

    return room;
  }
  return null;
}

/**
 * Get a room by ID.
 */
function getRoom(roomId) {
  return rooms.get(roomId.toUpperCase()) || null;
}

/**
 * Get the room a given socket belongs to.
 */
function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.players.find((p) => p.id === socketId)) return room;
  }
  return null;
}

/**
 * Get a safe public view of a room (no sensitive internals).
 */
function publicRoom(room) {
  return {
    id: room.id,
    host: room.host,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      score: p.score,
      isHost: p.isHost,
    })),
    gameType: room.gameType,
    phase: room.gameState ? room.gameState.phase : 'LOBBY',
  };
}

module.exports = {
  createRoom,
  joinRoom,
  removePlayer,
  getRoom,
  getRoomBySocket,
  publicRoom,
};
