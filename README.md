# 🎮 GamesHub

A modern, real-time multiplayer mini-game platform for playing party games with friends.

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML5 · CSS3 · JavaScript (ES Modules) · Phaser 3 |
| Real-time | Socket.IO · WebSockets |
| Backend | Node.js · Express |
| Hosting | Railway (backend) · GitHub (version control) |

## Games

### 🕵️ Who Is It?
A social deduction party game. Each player writes a strange-but-true fact about themselves. The game then reveals facts one-by-one and players vote on who wrote each one. Points are awarded for correct guesses — and for fooling your friends!

**Scoring:**
- +1 pt for correctly guessing the author
- +2 pts for the author if they fool a player

## Project Structure

```
GamesHub/
├── server/
│   ├── server.js           # Express + Socket.IO entry point
│   ├── socket.js           # WebSocket event registration
│   ├── roomManager.js      # Room create/join/leave logic
│   ├── gameManager.js      # Game registry & dispatcher
│   └── games/
│       └── whoIsIt.js      # "Who Is It?" server-side logic
├── public/
│   ├── index.html          # Single-page app shell
│   ├── style.css           # Global dark-mode design system
│   ├── main.js             # Client app (Socket.IO + UI)
│   └── games/
│       └── who-is-it/
│           ├── game.js     # Phaser 3 game initializer
│           ├── ui.js       # Phaser animated background scene
│           └── logic.js    # Client-side game helpers
├── package.json
└── .env.example
```

## Getting Started

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Edit .env if needed (default port: 3000)
```

### 3. Run locally
```bash
# Development (auto-reload)
npm run dev

# Production
npm start
    ```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Play with friends
1. Open the site and click **Create a Room**
2. Enter your nickname
3. Share the room link with friends
4. Choose a game and click **Start Game**

## Deploying to Railway

1. Push this repo to GitHub
2. Connect the GitHub repo to a new Railway project
3. Railway auto-detects Node.js and runs `npm start`
4. Set the `PORT` environment variable if needed (Railway sets it automatically)

## Adding a New Game

1. Create a server handler: `server/games/myGame.js`
   - Export `init(io, room)` and `handleEvent(io, socket, room, event, data)`
2. Register it in `server/gameManager.js` under `GAMES` and `getAvailableGames()`
3. Create frontend assets: `public/games/my-game/`
4. Add UI handling for the new game phases in `public/main.js`

## Game Phase Flow

```
LOBBY → WRITING_FACTS (60s) → VOTING (30s per fact) → RESULT_REVEAL (6s) → repeat ...→ GAME_OVER
```

All state is managed server-side. Clients are authoritative consumers only.
