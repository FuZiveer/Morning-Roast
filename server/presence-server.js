#!/usr/bin/env node
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT) || 8080;
const PRESENCE_PATH = process.env.PRESENCE_PATH || "/presence";
const PING_INTERVAL_MS = 30000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);
const clients = new Set();

function isOriginAllowed(origin) {
  if (ALLOWED_ORIGINS.includes("*")) return true;
  return Boolean(origin) && ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ""));
}

function broadcastCount() {
  const payload = JSON.stringify({ type: "count", count: clients.size });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

const server = http.createServer((req, res) => {
  if (new URL(req.url || "/", "http://localhost").pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end("ok");
    return;
  }
  res.writeHead(404);
  res.end("Not Found");
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  if (pathname !== PRESENCE_PATH) {
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }
  if (!isOriginAllowed(req.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (client) => wss.emit("connection", client));
});

wss.on("connection", (client) => {
  client.isAlive = true;
  clients.add(client);
  broadcastCount();

  client.on("pong", () => {
    client.isAlive = true;
  });
  client.on("close", () => {
    if (clients.delete(client)) broadcastCount();
  });
  client.on("error", () => {
    if (clients.delete(client)) broadcastCount();
  });
});

const pingInterval = setInterval(() => {
  for (const client of clients) {
    if (!client.isAlive) {
      client.terminate();
      clients.delete(client);
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
  broadcastCount();
}, PING_INTERVAL_MS);

wss.on("close", () => clearInterval(pingInterval));
server.listen(PORT, () => console.log(`Presence server listening on :${PORT}${PRESENCE_PATH}`));
