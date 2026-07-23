const crypto = require("crypto");
const { WebSocket } = require("ws");

function sanitizeText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsBlockedWord(text, blockedWords) {
  if (!Array.isArray(blockedWords) || !blockedWords.length) return false;
  const haystack = String(text || "").toLowerCase();
  return blockedWords.some((word) => {
    const token = String(word || "").trim().toLowerCase();
    if (!token) return false;
    return new RegExp(`\\b${escapeRegExp(token)}\\b`, "i").test(haystack);
  });
}

function stripUrls(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, "[link removed]")
    .replace(/\bwww\.\S+/gi, "[link removed]");
}

function createChatRoom(config) {
  const chatConfig = config.chat || {};
  const limits = chatConfig.limits || {};
  const requirements = chatConfig.requirements || {};
  const moderation = chatConfig.moderation || {};

  const MAX_MESSAGE_LENGTH = Number(limits.max_message_length) || 500;
  const MAX_NAME_LENGTH = Number(limits.max_display_name_length) || 32;
  const MAX_BIO_LENGTH = Number(limits.max_bio_length) || 160;
  const HISTORY_SIZE = Number(limits.history_size) || 100;
  const RATE_LIMIT_MS = Number(limits.rate_limit_ms) || 1500;
  const MAX_MESSAGES_PER_MINUTE = Number(limits.max_messages_per_minute) || 20;
  const MAX_ONLINE_USERS_SHOWN = Number(limits.max_online_users_shown) || 24;
  const ownerDisplayNames = (Array.isArray(chatConfig.owners?.display_names) ? chatConfig.owners.display_names : [])
    .map((name) => String(name || "").trim().toLowerCase())
    .filter(Boolean);

  const clients = new Set();
  const history = [];

  function isOwnerDisplayName(name) {
    const normalized = sanitizeText(name, MAX_NAME_LENGTH).toLowerCase();
    if (!normalized) return false;
    return ownerDisplayNames.includes(normalized);
  }

  function withOwnerFlag(entry) {
    return { ...entry, isOwner: isOwnerDisplayName(entry.name) };
  }

  function normalizeDisplayNameKey(name) {
    return sanitizeText(name, MAX_NAME_LENGTH).toLowerCase();
  }

  function isDisplayNameAvailable(name, { exceptClient = null, exceptUserId = null } = {}) {
    const key = normalizeDisplayNameKey(name);
    if (!key) return false;

    for (const peer of clients) {
      if (peer === exceptClient) continue;
      if (exceptUserId && peer.userId === exceptUserId) continue;
      if (peer.displayName && normalizeDisplayNameKey(peer.displayName) === key) return false;
    }

    return true;
  }

  function serializeMessage(message) {
    return JSON.stringify(message);
  }

  function broadcast(message, except) {
    const payload = serializeMessage(message);
    for (const client of clients) {
      if (client === except) continue;
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  function send(client, message) {
    if (client.readyState !== WebSocket.OPEN) return;
    client.send(serializeMessage(message));
  }

  function sendError(client, code, message) {
    send(client, { type: "error", code, message });
  }

  function onlineUsersPayload() {
    const users = [];
    for (const client of clients) {
      if (!client.displayName) continue;
      users.push({
        userId: client.userId,
        name: client.displayName,
        isOwner: isOwnerDisplayName(client.displayName),
      });
    }
    users.sort((a, b) => a.name.localeCompare(b.name));
    return {
      type: "presence",
      online: clients.size,
      users: users.slice(0, MAX_ONLINE_USERS_SHOWN),
    };
  }

  function broadcastPresence(except) {
    const payload = onlineUsersPayload();
    broadcast(payload, except);
    if (except) send(except, payload);
  }

  function normalizeMessageText(text) {
    let next = sanitizeText(text, MAX_MESSAGE_LENGTH);
    if (!next) return "";
    if (moderation.strip_urls) next = stripUrls(next);
    if (containsBlockedWord(next, moderation.blocked_words)) {
      return null;
    }
    return next;
  }

  function canSendMessage(client) {
    const now = Date.now();
    if (now - (client.lastMessageAt || 0) < RATE_LIMIT_MS) {
      return { ok: false, code: "rate_limited", message: "Slow down — wait a moment before sending another message." };
    }

    client.recentMessageTimes = (client.recentMessageTimes || []).filter((stamp) => now - stamp < 60000);
    if (client.recentMessageTimes.length >= MAX_MESSAGES_PER_MINUTE) {
      return { ok: false, code: "rate_limited", message: "You are sending messages too quickly." };
    }

    return { ok: true };
  }

  function pushHistory(entry) {
    history.push(entry);
    while (history.length > HISTORY_SIZE) history.shift();
    return entry;
  }

  function buildWelcome(client) {
    return {
      type: "welcome",
      online: clients.size,
      history: history.map(({ id, userId, name, text, at }) => withOwnerFlag({ id, userId, name, text, at })),
      you: {
        id: client.userId,
        name: client.displayName || "",
        isOwner: isOwnerDisplayName(client.displayName),
      },
      config: {
        limits: {
          max_message_length: MAX_MESSAGE_LENGTH,
          max_display_name_length: MAX_NAME_LENGTH,
          max_bio_length: MAX_BIO_LENGTH,
        },
        requirements: { ...requirements },
        ui: { ...chatConfig.ui },
        owners: {
          display_names: Array.isArray(chatConfig.owners?.display_names) ? [...chatConfig.owners.display_names] : [],
        },
      },
    };
  }

  function handleJoin(client, message) {
    const displayName = sanitizeText(message.name, MAX_NAME_LENGTH);
    const bio = sanitizeText(message.bio, MAX_BIO_LENGTH);

    if (requirements.display_name_required && !displayName) {
      sendError(client, "name_required", chatConfig.ui?.name_required_message || "Display name required.");
      return;
    }

    if (requirements.bio_required && !bio) {
      sendError(client, "bio_required", "Add a bio on your Profile before chatting.");
      return;
    }

    if (displayName && !isDisplayNameAvailable(displayName, { exceptClient: client })) {
      sendError(
        client,
        "name_taken",
        chatConfig.ui?.name_taken_message || "That display name is already in use. Choose another one.",
      );
      return;
    }

    const previousName = client.displayName;
    client.displayName = displayName;
    client.bio = bio;

    send(client, {
      type: "joined",
      you: {
        id: client.userId,
        name: client.displayName,
        bio: client.bio,
        isOwner: isOwnerDisplayName(client.displayName),
      },
    });

    if (previousName !== client.displayName) {
      broadcastPresence();
    }
  }

  function handleGetProfile(client, message) {
    const targetId = String(message.userId || "").trim();
    if (!targetId) return;

    for (const peer of clients) {
      if (peer.userId !== targetId || !peer.displayName) continue;
      send(client, {
        type: "profile",
        userId: peer.userId,
        name: peer.displayName,
        bio: peer.bio || "",
        isOwner: isOwnerDisplayName(peer.displayName),
      });
      return;
    }

    sendError(client, "profile_not_found", "That user is no longer online.");
  }

  function handleChatMessage(client, message) {
    if (!client.displayName) {
      sendError(client, "name_required", chatConfig.ui?.name_required_message || "Display name required.");
      return;
    }

    const gate = canSendMessage(client);
    if (!gate.ok) {
      sendError(client, gate.code, gate.message);
      return;
    }

    const text = normalizeMessageText(message.text);
    if (text === null) {
      sendError(client, "blocked", "Message blocked by moderation rules.");
      return;
    }
    if (!text) {
      sendError(client, "invalid_message", "Message cannot be empty.");
      return;
    }

    const now = Date.now();
    client.lastMessageAt = now;
    client.recentMessageTimes = client.recentMessageTimes || [];
    client.recentMessageTimes.push(now);

    const entry = pushHistory({
      id: crypto.randomUUID(),
      userId: client.userId,
      name: client.displayName,
      text,
      at: now,
    });

    const payload = withOwnerFlag({ type: "message", ...entry });
    for (const peer of clients) {
      if (peer.readyState === WebSocket.OPEN) peer.send(serializeMessage(payload));
    }
  }

  function handleConnection(client) {
    client.isAlive = true;
    client.userId = crypto.randomUUID();
    client.displayName = "";
    client.bio = "";
    client.lastMessageAt = 0;
    client.recentMessageTimes = [];
    clients.add(client);

    send(client, buildWelcome(client));
    broadcastPresence(client);

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

      switch (message?.type) {
        case "join":
          handleJoin(client, message);
          break;
        case "message":
          handleChatMessage(client, message);
          break;
        case "get_profile":
          handleGetProfile(client, message);
          break;
        default:
          break;
      }
    });

    client.on("close", () => {
      if (clients.delete(client)) broadcastPresence();
    });

    client.on("error", () => {
      if (clients.delete(client)) broadcastPresence();
    });
  }

  function pingClients() {
    for (const client of clients) {
      if (!client.isAlive) {
        client.terminate();
        clients.delete(client);
        continue;
      }
      client.isAlive = false;
      client.ping();
    }
    broadcastPresence();
  }

  return {
    handleConnection,
    pingClients,
    getOnlineCount: () => clients.size,
    getHistorySize: () => history.length,
    isDisplayNameAvailable(name, options = {}) {
      return isDisplayNameAvailable(name, options);
    },
  };
}

module.exports = { createChatRoom };
