/**
 * server.js
 * Entry point for the GamesHub Node.js server.
 */

require('dotenv').config();

const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const cors    = require('cors');

const registerSocketHandlers = require('./socket');

const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
//  Express setup
// ─────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from /public
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA fallback – every unmatched GET returns index.html
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─────────────────────────────────────────────
//  HTTP + Socket.IO setup
// ─────────────────────────────────────────────
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

registerSocketHandlers(io);

// ─────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`\n🎮  GamesHub server running on http://localhost:${PORT}\n`);
});
