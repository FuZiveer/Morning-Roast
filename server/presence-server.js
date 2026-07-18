#!/usr/bin/env node
/**
 * Morning Roast presence WebSocket server.
 *
 * Deploy anywhere that supports Node (Railway, Render, Fly.io, VPS, etc.).
 *
 * Env:
 *   PORT=8080
 *   PRESENCE_PATH=/presence
 *   ALLOWED_ORIGINS=https://your-site.example,http://localhost:5500
 *
 * Local:
 *   cd server && npm install && npm start
 *
 * Health check: GET /health
 * WebSocket:     ws://host:8080/presence
 */
const http = require("http");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8080;
const PATH = process.env.PRESENCE_PATH || "/presence";
const PING_INTERVAL_MS = 30000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

/** @type {Set<import('ws').WebSocket>} */
const clients = new Set();

function originAllowed(origin) {
  if (!origin) return ALLOWED_ORIGINS.includes("*");
  return ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
}

function broadcastCount() {
  const payload = JSON.stringify({ type: "count", count: clients.size });
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    res.end("ok");
    return;
  }

  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const host = req.headers.host || "localhost";
  const pathname = new URL(req.url || "/", `http://${host}`).pathname;
  if (pathname !== PATH) {
    socket.destroy();
    return;
  }

  if (!originAllowed(req.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

function removeClient(ws) {
  if (!clients.delete(ws)) return;
  broadcastCount();
}

wss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  clients.add(ws);
  ws.send(JSON.stringify({ type: "count", count: clients.size }));
  broadcastCount();

  ws.on("close", () => removeClient(ws));
  ws.on("error", () => removeClient(ws));
});

const pingInterval = setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) {
      ws.terminate();
      removeClient(ws);
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, PING_INTERVAL_MS);

wss.on("close", () => clearInterval(pingInterval));

server.listen(PORT, () => {
  console.log(`Morning Roast presence server listening on :${PORT}${PATH}`);
});
