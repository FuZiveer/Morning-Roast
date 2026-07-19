#!/usr/bin/env node
/**
 * Morning Roast realtime WebSocket server (presence + live chat).
 *
 * Deploy anywhere that supports Node (Railway, Render, Fly.io, VPS, etc.).
 *
 * Env:
 *   PORT=8080
 *   PRESENCE_PATH=/presence
 *   CHAT_PATH=/chat
 *   ALLOWED_ORIGINS=https://your-site.example,http://localhost:5500
 *
 * Local:
 *   cd server && npm install && npm start
 *
 * Health check: GET /health
 * WebSocket:     ws://host:8080/presence
 *               ws://host:8080/chat
 */
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8080;
const PRESENCE_PATH = process.env.PRESENCE_PATH || "/presence";
const CHAT_PATH = process.env.CHAT_PATH || "/chat";
const PING_INTERVAL_MS = 30000;
const MAX_MESSAGES = 200;
const MAX_TEXT_LENGTH = 500;
const MAX_NAME_LENGTH = 24;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

/** @type {Set<import('ws').WebSocket>} */
const presenceClients = new Set();

/** @type {Map<string, { id: string, clientId: string, name: string, text: string, replyTo: string | null, createdAt: number, deleted: boolean }>} */
const chatMessages = new Map();
const chatMessageOrder = [];

/** @type {Map<import('ws').WebSocket, { clientId: string, name: string }>} */
const chatClients = new Map();

function originAllowed(origin) {
  if (!origin) return ALLOWED_ORIGINS.includes("*");
  return ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
}

function broadcastPresenceCount() {
  const payload = JSON.stringify({ type: "count", count: presenceClients.size });
  for (const ws of presenceClients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function sanitizeText(text) {
  return String(text || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

function sanitizeName(name) {
  const clean = String(name || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return clean || "Guest";
}

function publicChatMessage(record) {
  if (!record) return null;
  const out = {
    id: record.id,
    clientId: record.clientId,
    name: record.name,
    text: record.deleted ? "" : record.text,
    replyTo: record.replyTo,
    createdAt: record.createdAt,
    deleted: Boolean(record.deleted),
  };

  if (record.replyTo && !record.deleted) {
    const parent = chatMessages.get(record.replyTo);
    if (parent && !parent.deleted) {
      out.replyPreview = {
        id: parent.id,
        name: parent.name,
        text: parent.text.slice(0, 120),
      };
    }
  }

  return out;
}

function addChatMessage(record) {
  chatMessages.set(record.id, record);
  chatMessageOrder.push(record.id);
  while (chatMessageOrder.length > MAX_MESSAGES) {
    const oldId = chatMessageOrder.shift();
    chatMessages.delete(oldId);
  }
}

function broadcastChat(payload) {
  const data = JSON.stringify(payload);
  for (const ws of chatClients.keys()) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

function sendChatError(ws, message) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify({ type: "error", message: String(message || "Request failed") }));
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

const presenceWss = new WebSocketServer({ noServer: true });
const chatWss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const host = req.headers.host || "localhost";
  const pathname = new URL(req.url || "/", `http://${host}`).pathname;

  if (pathname !== PRESENCE_PATH && pathname !== CHAT_PATH) {
    socket.destroy();
    return;
  }

  if (!originAllowed(req.headers.origin)) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  const target = pathname === CHAT_PATH ? chatWss : presenceWss;
  target.handleUpgrade(req, socket, head, (ws) => {
    target.emit("connection", ws, req);
  });
});

function removePresenceClient(ws) {
  if (!presenceClients.delete(ws)) return;
  broadcastPresenceCount();
}

presenceWss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  presenceClients.add(ws);
  broadcastPresenceCount();

  ws.on("close", () => removePresenceClient(ws));
  ws.on("error", () => removePresenceClient(ws));
});

chatWss.on("connection", (ws) => {
  ws.isAlive = true;
  ws.on("pong", () => {
    ws.isAlive = true;
  });

  const history = chatMessageOrder
    .map((id) => publicChatMessage(chatMessages.get(id)))
    .filter(Boolean);
  ws.send(JSON.stringify({ type: "history", messages: history }));

  ws.on("message", (raw) => {
    let data;
    try {
      data = JSON.parse(String(raw));
    } catch {
      return;
    }

    if (data?.type === "hello") {
      const clientId = String(data.clientId || "").trim().slice(0, 64);
      if (!clientId) {
        sendChatError(ws, "Missing client id");
        return;
      }
      chatClients.set(ws, { clientId, name: sanitizeName(data.name) });
      return;
    }

    const session = chatClients.get(ws);
    if (!session) {
      sendChatError(ws, "Send hello first");
      return;
    }

    if (data?.type === "rename") {
      session.name = sanitizeName(data.name);
      return;
    }

    if (data?.type === "chat") {
      const text = sanitizeText(data.text);
      if (!text) return;

      const replyTo =
        data.replyTo && chatMessages.has(String(data.replyTo)) ? String(data.replyTo) : null;
      const record = {
        id: crypto.randomUUID(),
        clientId: session.clientId,
        name: session.name,
        text,
        replyTo,
        createdAt: Date.now(),
        deleted: false,
      };
      addChatMessage(record);
      broadcastChat({ type: "chat", message: publicChatMessage(record) });
      return;
    }

    if (data?.type === "delete") {
      const messageId = String(data.messageId || "");
      const record = chatMessages.get(messageId);
      if (!record || record.clientId !== session.clientId || record.deleted) return;
      record.deleted = true;
      record.text = "";
      broadcastChat({ type: "deleted", messageId: record.id });
    }
  });

  ws.on("close", () => {
    chatClients.delete(ws);
  });
  ws.on("error", () => {
    chatClients.delete(ws);
  });
});

const pingInterval = setInterval(() => {
  for (const ws of presenceClients) {
    if (!ws.isAlive) {
      ws.terminate();
      removePresenceClient(ws);
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }

  for (const ws of chatClients.keys()) {
    if (!ws.isAlive) {
      ws.terminate();
      chatClients.delete(ws);
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, PING_INTERVAL_MS);

presenceWss.on("close", () => clearInterval(pingInterval));
chatWss.on("close", () => clearInterval(pingInterval));

server.listen(PORT, () => {
  console.log(`Morning Roast realtime server listening on :${PORT}`);
  console.log(`  Presence: ${PRESENCE_PATH}`);
  console.log(`  Chat:     ${CHAT_PATH}`);
});
