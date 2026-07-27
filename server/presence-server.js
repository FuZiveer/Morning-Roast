#!/usr/bin/env node
const http = require("http");
const { WebSocketServer, WebSocket } = require("ws");
const { loadChatConfig, getPublicChatConfig } = require("./lib/chat-config");
const { createChatRoom } = require("./lib/chat-room");
const { createAssistantHandler } = require("./lib/assistant-handler");

const chatConfigRoot = loadChatConfig();
const chatSettings = chatConfigRoot.chat || {};
const PORT = Number(process.env.PORT) || 8080;
const PRESENCE_PATH = process.env.PRESENCE_PATH || "/presence";
const CHAT_PATH = process.env.CHAT_PATH || chatSettings.websocket?.path || "/chat";
const ASSISTANT_PATH = process.env.ASSISTANT_PATH || "/assistant/chat";
const PING_INTERVAL_MS = 30000;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

const presenceClients = new Set();
const DEFAULT_ACTIVITY = "Browsing";
const ALLOWED_ACTIVITIES = new Set([
  DEFAULT_ACTIVITY,
  "Converting Sensitivity",
  "Calculating eDPI",
  "Aim Training",
  "Converting Crosshair",
  "Watching Lineups",
  "Viewing Stats",
  "Community Chat",
]);

function isOriginAllowed(origin) {
  if (ALLOWED_ORIGINS.includes("*")) return true;
  return Boolean(origin) && ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ""));
}

function buildActivityBreakdown() {
  const activities = {};
  for (const client of presenceClients) {
    const activity = client.activity || DEFAULT_ACTIVITY;
    activities[activity] = (activities[activity] || 0) + 1;
  }
  return activities;
}

function broadcastPresenceCount() {
  const payload = JSON.stringify({
    type: "count",
    count: presenceClients.size,
    activities: buildActivityBreakdown(),
  });
  for (const client of presenceClients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

const chatRoom = chatSettings.enabled === false ? null : createChatRoom(chatConfigRoot);
const publicChatConfig = getPublicChatConfig(chatConfigRoot);
const handleAssistantRequest = createAssistantHandler({ isOriginAllowed });

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  const corsOrigin = ALLOWED_ORIGINS.includes("*") ? "*" : ALLOWED_ORIGINS[0] || "*";

  if (pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" });
    res.end("ok");
    return;
  }

  if (pathname === ASSISTANT_PATH) {
    handleAssistantRequest(req, res);
    return;
  }

  if (pathname === "/chat/config") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": corsOrigin,
      "Cache-Control": "public, max-age=60",
    });
    res.end(JSON.stringify(publicChatConfig));
    return;
  }

  if (pathname === "/chat/names/check") {
    const url = new URL(req.url || "/", "http://localhost");
    const name = url.searchParams.get("name") || "";
    const exceptUserId = url.searchParams.get("except") || "";
    const result = chatRoom
      ? chatRoom.checkDisplayName(name, { exceptUserId: exceptUserId || null })
      : { available: true };

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": corsOrigin,
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(result));
    return;
  }

  if (pathname === "/chat/history") {
    const history = chatRoom ? chatRoom.getHistory() : [];

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": corsOrigin,
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ history }));
    return;
  }

  if (pathname === "/lineups/comments") {
    const url = new URL(req.url || "/", "http://localhost");
    const game = url.searchParams.get("game") || "";
    const videoId = url.searchParams.get("videoId") || "";
    const viewerUserId = url.searchParams.get("userId") || "";
    const comments = chatRoom ? chatRoom.getLineupComments(game, videoId, { viewerUserId }) : [];

    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": corsOrigin,
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ game, videoId, comments }));
    return;
  }

  res.writeHead(404);
  res.end("Not Found");
});

const presenceWss = new WebSocketServer({ noServer: true });
const chatWss = chatRoom ? new WebSocketServer({ noServer: true }) : null;

server.on("upgrade", (req, socket, head) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;

  if (pathname === PRESENCE_PATH) {
    if (!isOriginAllowed(req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    presenceWss.handleUpgrade(req, socket, head, (client) => presenceWss.emit("connection", client));
    return;
  }

  if (chatWss && pathname === CHAT_PATH) {
    if (!isOriginAllowed(req.headers.origin)) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    chatWss.handleUpgrade(req, socket, head, (client) => chatWss.emit("connection", client));
    return;
  }

  socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
  socket.destroy();
});

presenceWss.on("connection", (client) => {
  client.isAlive = true;
  client.activity = DEFAULT_ACTIVITY;
  presenceClients.add(client);
  broadcastPresenceCount();

  client.on("pong", () => {
    client.isAlive = true;
  });

  client.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message?.type !== "activity") return;
    const activity = typeof message.activity === "string" ? message.activity : "";
    const next = ALLOWED_ACTIVITIES.has(activity) ? activity : DEFAULT_ACTIVITY;
    if (next === client.activity) return;
    client.activity = next;
    broadcastPresenceCount();
  });

  client.on("close", () => {
    if (presenceClients.delete(client)) broadcastPresenceCount();
  });

  client.on("error", () => {
    if (presenceClients.delete(client)) broadcastPresenceCount();
  });
});

if (chatWss && chatRoom) {
  chatWss.on("connection", (client) => chatRoom.handleConnection(client));
}

const pingInterval = setInterval(() => {
  for (const client of presenceClients) {
    if (!client.isAlive) {
      client.terminate();
      presenceClients.delete(client);
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
  broadcastPresenceCount();
  chatRoom?.pingClients?.();
}, PING_INTERVAL_MS);

presenceWss.on("close", () => clearInterval(pingInterval));
chatWss?.on("close", () => clearInterval(pingInterval));

server.listen(PORT, () => {
  console.log(`Presence server listening on :${PORT}${PRESENCE_PATH}`);
  console.log(`Site assistant proxy listening on :${PORT}${ASSISTANT_PATH}`);
  if (chatRoom) console.log(`Community chat listening on :${PORT}${CHAT_PATH}`);
});
