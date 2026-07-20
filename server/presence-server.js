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
 *   ALLOWED_ORIGINS=https://your-site.example,http://localhost:5501,http://127.0.0.1:5501
 *     (use * for dev; localhost and 127.0.0.1 are treated as equivalent on the same port)
 *
 *   # Accounts (optional; features auto-disable if unset):
 *   DATABASE_URL=postgres://...            (Neon / Supabase / Render Postgres)
 *   JWT_SECRET=<long random string>
 *   PUBLIC_API_URL=https://your-api.onrender.com
 *   PUBLIC_SITE_URL=https://your-site.example
 *   GMAIL_USER=you@gmail.com
 *   GMAIL_APP_PASSWORD=<google app password>
 *
 * Local:
 *   cd server && npm install && npm start
 *
 * Health check: GET /health
 * WebSocket:     ws://host:8080/presence
 *               ws://host:8080/chat
 * Auth API:      POST /auth/register, /auth/login, /auth/resend
 *                GET  /auth/verify, /auth/me
 */
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const db = require("./db");
const auth = require("./auth");

const PORT = Number(process.env.PORT) || 8080;
const PRESENCE_PATH = process.env.PRESENCE_PATH || "/presence";
const CHAT_PATH = process.env.CHAT_PATH || "/chat";
const PING_INTERVAL_MS = 30000;
const MAX_MESSAGES = 200;
const MAX_TEXT_LENGTH = 500;
const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

/** @type {Set<import('ws').WebSocket>} */
const presenceClients = new Set();

/** @type {Map<string, { id: string, userId: string, name: string, text: string, replyTo: string | null, createdAt: number, deleted: boolean }>} */
const chatMessages = new Map();
const chatMessageOrder = [];

/** @type {Map<import('ws').WebSocket, { userId: string | null, username: string | null }>} */
const chatClients = new Map();

function localDevOriginVariants(origin) {
  try {
    const url = new URL(origin);
    if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return [origin];
    const port = url.port ? `:${url.port}` : "";
    const altHost = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
    return [origin, `${url.protocol}//${altHost}${port}`];
  } catch {
    return [origin];
  }
}

function originAllowed(origin) {
  if (!origin) return ALLOWED_ORIGINS.includes("*");
  if (ALLOWED_ORIGINS.includes("*")) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return localDevOriginVariants(origin).some((candidate) => ALLOWED_ORIGINS.includes(candidate));
}

function corsHeaders(origin) {
  const allowOrigin = ALLOWED_ORIGINS.includes("*") ? "*" : originAllowed(origin) ? origin : "";
  const headers = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
  if (allowOrigin) headers["Access-Control-Allow-Origin"] = allowOrigin;
  return headers;
}

function clientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || "";
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
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

function publicChatMessage(record) {
  if (!record) return null;
  const out = {
    id: record.id,
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

function sendJson(res, status, body, origin) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(origin),
  });
  res.end(JSON.stringify(body));
}

async function handleAuthRoute(req, res, pathname) {
  const origin = req.headers.origin;
  const ip = clientIp(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders(origin));
    res.end();
    return;
  }

  try {
    if (pathname === "/auth/register" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await auth.register(body, ip);
      sendJson(res, result.status, result.json, origin);
      return;
    }

    if (pathname === "/auth/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await auth.login(body, ip);
      sendJson(res, result.status, result.json, origin);
      return;
    }

    if (pathname === "/auth/resend" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await auth.resend(body, ip);
      sendJson(res, result.status, result.json, origin);
      return;
    }

    if (pathname === "/auth/me" && req.method === "GET") {
      const result = await auth.me(req.headers.authorization);
      sendJson(res, result.status, result.json, origin);
      return;
    }

    if (pathname === "/auth/verify" && req.method === "GET") {
      const host = req.headers.host || "localhost";
      const token = new URL(req.url, `http://${host}`).searchParams.get("token");
      const result = await auth.verify(token);
      if (result.redirect) {
        res.writeHead(302, { Location: result.redirect });
        res.end();
        return;
      }
      sendJson(res, result.status, result.json, origin);
      return;
    }

    sendJson(res, 404, { error: "Not found" }, origin);
  } catch (err) {
    if (err.message === "Invalid JSON" || err.message === "Body too large") {
      sendJson(res, 400, { error: err.message }, origin);
      return;
    }
    console.error("[auth] route error:", err);
    sendJson(res, 500, { error: "Server error" }, origin);
  }
}

const server = http.createServer((req, res) => {
  const host = req.headers.host || "localhost";
  const pathname = new URL(req.url || "/", `http://${host}`).pathname;

  if (pathname === "/health") {
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
    res.end("ok");
    return;
  }

  if (pathname.startsWith("/auth/")) {
    handleAuthRoute(req, res, pathname);
    return;
  }

  res.writeHead(404, corsHeaders(req.headers.origin));
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

  clients.add(ws);
  broadcastCount();

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
      const identity = auth.verifyAuthToken(data.token);
      if (identity) {
        chatClients.set(ws, { userId: identity.userId, username: identity.username });
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "authed", username: identity.username }));
        }
      } else {
        // Read-only guest: receives history and broadcasts, cannot post.
        chatClients.set(ws, { userId: null, username: null });
        if (data.token) sendChatError(ws, "Your session expired. Please log in again.");
      }
      return;
    }

    const session = chatClients.get(ws);
    if (!session) {
      sendChatError(ws, "Send hello first");
      return;
    }

    if (data?.type === "chat") {
      if (!session.userId) {
        sendChatError(ws, "Log in to send messages.");
        return;
      }
      const text = sanitizeText(data.text);
      if (!text) return;

      const replyTo =
        data.replyTo && chatMessages.has(String(data.replyTo)) ? String(data.replyTo) : null;
      const record = {
        id: crypto.randomUUID(),
        userId: session.userId,
        name: session.username,
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
      if (!session.userId) return;
      const messageId = String(data.messageId || "");
      const record = chatMessages.get(messageId);
      if (!record || record.userId !== session.userId || record.deleted) return;
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

db.initSchema().catch((err) => {
  console.error("[db] Schema init failed:", err.message);
});

server.listen(PORT, () => {
  console.log(`Morning Roast realtime server listening on :${PORT}`);
  console.log(`  Presence: ${PRESENCE_PATH}`);
  console.log(`  Chat:     ${CHAT_PATH}`);
  console.log(`  Accounts: ${auth.isConfigured() ? "enabled" : "disabled (set DATABASE_URL + JWT_SECRET)"}`);
  console.log(`  CORS:     ${ALLOWED_ORIGINS.includes("*") ? "*" : ALLOWED_ORIGINS.join(", ")}`);
});
