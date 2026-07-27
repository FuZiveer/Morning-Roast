const crypto = require("crypto");
const { WebSocket } = require("ws");
const { createChatModeration } = require("./chat-moderation");
const { createChatHistoryStore } = require("./chat-history-store");
const { createDmHistoryStore } = require("./dm-history-store");
const { createLineupCommentsStore, buildLineupKey } = require("./lineup-comments-store");

function sanitizeText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeAvatar(value, maxLength) {
  const next = String(value || "").trim();
  if (!next.startsWith("data:image/")) return "";
  if (next.length > maxLength) return "";
  return next;
}

function stripUrls(text) {
  return String(text || "")
    .replace(/https?:\/\/\S+/gi, "[link removed]")
    .replace(/\bwww\.\S+/gi, "[link removed]");
}

function createChatRoom(config, deps = {}) {
  const chatConfig = config.chat || {};
  const limits = chatConfig.limits || {};
  const requirements = chatConfig.requirements || {};
  const moderationConfig = chatConfig.moderation || {};

  const MAX_MESSAGE_LENGTH = Number(limits.max_message_length) || 500;
  const MAX_NAME_LENGTH = Number(limits.max_display_name_length) || 32;
  const MAX_BIO_LENGTH = Number(limits.max_bio_length) || 160;
  const MAX_AVATAR_LENGTH = Number(limits.max_avatar_length) || 130000;
  const HISTORY_SIZE = Number(limits.history_size) || 100;
  const RATE_LIMIT_MS = Number(limits.rate_limit_ms) || 1500;
  const MAX_MESSAGES_PER_MINUTE = Number(limits.max_messages_per_minute) || 20;
  const MAX_ONLINE_USERS_SHOWN = Number(limits.max_online_users_shown) || 24;
  const DM_HISTORY_SIZE = Number(limits.max_dm_history) || 100;
  const LINEUP_COMMENTS_SIZE = Number(limits.max_lineup_comments) || 200;
  const ownerDisplayNames = (Array.isArray(chatConfig.owners?.display_names) ? chatConfig.owners.display_names : [])
    .map((name) => String(name || "").trim().toLowerCase())
    .filter(Boolean);

  const moderation = createChatModeration(moderationConfig.blocked_words || []);
  const clients = new Set();
  const historyStore = createChatHistoryStore({ maxSize: HISTORY_SIZE });
  const dmHistoryStore = createDmHistoryStore({ maxSize: DM_HISTORY_SIZE });
  const lineupCommentsStore = createLineupCommentsStore({ maxCommentsPerLineup: LINEUP_COMMENTS_SIZE });

  function isOwnerDisplayName(name) {
    const normalized = sanitizeText(name, MAX_NAME_LENGTH).toLowerCase();
    if (!normalized) return false;
    return ownerDisplayNames.includes(normalized);
  }

  function getConnectedClient(userId) {
    const id = String(userId || "").trim();
    if (!id) return null;
    for (const client of clients) {
      if (client.userId === id && client.readyState === WebSocket.OPEN) return client;
    }
    return null;
  }

  function verifyClientIdentity(userId, displayName) {
    const client = getConnectedClient(userId);
    if (!client?.displayName) return false;
    return normalizeDisplayNameKey(client.displayName) === normalizeDisplayNameKey(displayName);
  }

  function verifyOwnerIdentity(userId, displayName) {
    if (!verifyClientIdentity(userId, displayName)) return false;
    return isOwnerDisplayName(displayName);
  }

  function notifyOwners(message) {
    const payload = serializeMessage(message);
    for (const client of clients) {
      if (!isOwnerDisplayName(client.displayName)) continue;
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  function broadcastAll(message) {
    const payload = serializeMessage(message);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(payload);
    }
  }

  function withOwnerFlag(entry) {
    return { ...entry, isOwner: isOwnerDisplayName(entry.name) };
  }

  function normalizeDisplayNameKey(name) {
    return sanitizeText(name, MAX_NAME_LENGTH).toLowerCase();
  }

  function isDisplayNameTaken(name, { exceptClient = null, exceptUserId = null } = {}) {
    const key = normalizeDisplayNameKey(name);
    if (!key) return false;

    for (const peer of clients) {
      if (peer === exceptClient) continue;
      if (exceptUserId && peer.userId === exceptUserId) continue;
      if (peer.displayName && normalizeDisplayNameKey(peer.displayName) === key) return true;
    }

    return false;
  }

  function checkDisplayName(name, { exceptClient = null, exceptUserId = null } = {}) {
    const displayName = sanitizeText(name, MAX_NAME_LENGTH);
    if (!displayName) return { available: false, reason: "empty" };
    if (moderation.isBlockedName(displayName)) return { available: false, reason: "blocked" };
    if (isDisplayNameTaken(displayName, { exceptClient, exceptUserId })) {
      return { available: false, reason: "taken" };
    }
    return { available: true };
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

  function chatPanelOpenCount() {
    let count = 0;
    for (const client of clients) {
      if (client.chatPanelOpen) count += 1;
    }
    return count;
  }

  function onlineUsersPayload() {
    const users = [];
    for (const client of clients) {
      if (!client.displayName) continue;
      users.push({
        userId: client.userId,
        name: client.displayName,
        avatar: client.avatar || "",
        isOwner: isOwnerDisplayName(client.displayName),
      });
    }
    users.sort((a, b) => a.name.localeCompare(b.name));
    return {
      type: "presence",
      online: clients.size,
      chatOpen: chatPanelOpenCount(),
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
    if (moderationConfig.strip_urls !== false) next = stripUrls(next);
    return moderation.censorText(next);
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
    return historyStore.push(entry);
  }

  function getHistoryPayload() {
    return historyStore.list().map(({ id, userId, name, text, at }) => withOwnerFlag({ id, userId, name, text, at }));
  }

  function buildWelcome(client) {
    return {
      type: "welcome",
      online: clients.size,
      chatOpen: chatPanelOpenCount(),
      history: getHistoryPayload(),
      you: {
        id: client.userId,
        name: client.displayName || "",
        avatar: client.avatar || "",
        isOwner: isOwnerDisplayName(client.displayName),
      },
      config: {
        limits: {
          max_message_length: MAX_MESSAGE_LENGTH,
          max_display_name_length: MAX_NAME_LENGTH,
          max_bio_length: MAX_BIO_LENGTH,
          max_avatar_length: MAX_AVATAR_LENGTH,
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
    const avatar = sanitizeAvatar(message.avatar, MAX_AVATAR_LENGTH);

    if (requirements.display_name_required && !displayName) {
      sendError(client, "name_required", chatConfig.ui?.name_required_message || "Display name required.");
      return;
    }

    if (requirements.bio_required && !bio) {
      sendError(client, "bio_required", "Add a bio on your Profile before chatting.");
      return;
    }

    if (displayName && moderation.isBlockedName(displayName)) {
      sendError(
        client,
        "name_blocked",
        chatConfig.ui?.name_blocked_message || "That display name is not allowed.",
      );
      return;
    }

    const nameCheck = checkDisplayName(displayName, { exceptClient: client });
    if (displayName && !nameCheck.available && nameCheck.reason === "taken") {
      sendError(
        client,
        "name_taken",
        chatConfig.ui?.name_taken_message || "That display name is already in use. Choose another one.",
      );
      return;
    }

    let authorId = String(message.authorId || client.authorId || "").trim();
    if (!authorId) authorId = crypto.randomUUID();
    client.authorId = authorId;

    const previousName = client.displayName;
    const previousAvatar = client.avatar;
    client.displayName = displayName;
    client.bio = bio;
    client.avatar = avatar;

    if (authorId && displayName) {
      lineupCommentsStore.updateAuthorIdentity(authorId, {
        userId: client.userId,
        name: displayName,
        previousName,
      });
    }

    send(client, {
      type: "joined",
      you: {
        id: client.userId,
        authorId: client.authorId,
        name: client.displayName,
        bio: client.bio,
        avatar: client.avatar,
        isOwner: isOwnerDisplayName(client.displayName),
      },
    });

    if (previousName !== client.displayName || previousAvatar !== client.avatar) {
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
        avatar: peer.avatar || "",
        isOwner: isOwnerDisplayName(peer.displayName),
      });
      return;
    }

    sendError(client, "profile_not_found", "That user is no longer online.");
  }

  function findClientByUserId(userId) {
    const id = String(userId || "").trim();
    if (!id) return null;
    for (const peer of clients) {
      if (peer.userId === id && peer.displayName) return peer;
    }
    return null;
  }

  function handleDmMessage(client, message) {
    if (!client.displayName) {
      sendError(client, "name_required", chatConfig.ui?.name_required_message || "Display name required.");
      return;
    }

    const toUserId = String(message.toUserId || "").trim();
    if (!toUserId) {
      sendError(client, "invalid_message", "Choose someone to message.");
      return;
    }
    if (toUserId === client.userId) {
      sendError(client, "invalid_message", "You cannot message yourself.");
      return;
    }

    const recipient = findClientByUserId(toUserId);
    if (!recipient) {
      sendError(client, "user_offline", chatConfig.ui?.dm_offline_message || "That user is offline.");
      return;
    }

    const gate = canSendMessage(client);
    if (!gate.ok) {
      sendError(client, gate.code, gate.message);
      return;
    }

    const text = normalizeMessageText(message.text);
    if (!text) {
      sendError(client, "invalid_message", "Message cannot be empty.");
      return;
    }

    const now = Date.now();
    client.lastMessageAt = now;
    client.recentMessageTimes = client.recentMessageTimes || [];
    client.recentMessageTimes.push(now);

    const dmKey = dmHistoryStore.conversationKey(client.displayName, recipient.displayName);
    const entry = dmHistoryStore.push(dmKey, {
      id: crypto.randomUUID(),
      fromUserId: client.userId,
      toUserId: recipient.userId,
      fromName: client.displayName,
      toName: recipient.displayName,
      text,
      at: now,
    });

    const payload = {
      type: "dm",
      ...entry,
      fromAvatar: client.avatar || "",
      toAvatar: recipient.avatar || "",
      fromIsOwner: isOwnerDisplayName(client.displayName),
      toIsOwner: isOwnerDisplayName(recipient.displayName),
    };

    send(client, payload);
    send(recipient, payload);
  }

  function handleDmHistory(client, message) {
    const withUserId = String(message.withUserId || "").trim();
    let peerName = String(message.withUserName || "").trim();
    const peer = findClientByUserId(withUserId);
    if (peer) peerName = peer.displayName;

    if (!client.displayName || !peerName) {
      send(client, { type: "dm_history", withUserId, withUserName: peerName, history: [] });
      return;
    }

    const dmKey = dmHistoryStore.conversationKey(client.displayName, peerName);
    const history = dmHistoryStore.list(dmKey).map((entry) => ({
      ...entry,
      fromIsOwner: isOwnerDisplayName(entry.fromName),
      toIsOwner: isOwnerDisplayName(entry.toName),
    }));

    send(client, {
      type: "dm_history",
      withUserId: peer?.userId || withUserId,
      withUserName: peerName,
      history,
    });
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

    const payload = withOwnerFlag({ type: "message", ...entry, avatar: client.avatar || "" });
    for (const peer of clients) {
      if (peer.readyState === WebSocket.OPEN) peer.send(serializeMessage(payload));
    }
  }

  function broadcastToLineupWatchers(lineupKey, message, except) {
    const payload = serializeMessage(message);
    for (const peer of clients) {
      if (peer === except) continue;
      if (peer.watchingLineupKey !== lineupKey) continue;
      if (peer.readyState === WebSocket.OPEN) peer.send(payload);
    }
  }

  function resolveLineupKey(message) {
    return buildLineupKey(message.game, message.videoId);
  }

  function handleLineupCommentWatch(client, message) {
    const lineupKey = resolveLineupKey(message);
    client.watchingLineupKey = lineupKey || null;

    if (!lineupKey) {
      send(client, { type: "lineup_comments", game: message.game || "", videoId: message.videoId || "", comments: [] });
      return;
    }

    send(client, {
      type: "lineup_comments",
      game: String(message.game || "").trim().toLowerCase(),
      videoId: String(message.videoId || "").trim(),
      lineupKey,
      comments: lineupCommentsStore.list(lineupKey, { viewerUserId: client.userId }),
    });
  }

  function handleLineupCommentPost(client, message) {
    if (!client.displayName) {
      sendError(client, "name_required", chatConfig.ui?.name_required_message || "Display name required.");
      return;
    }

    const lineupKey = resolveLineupKey(message);
    if (!lineupKey) {
      sendError(client, "invalid_message", "Invalid lineup.");
      return;
    }

    const gate = canSendMessage(client);
    if (!gate.ok) {
      sendError(client, gate.code, gate.message);
      return;
    }

    const text = normalizeMessageText(message.text);
    if (!text) {
      sendError(client, "invalid_message", "Comment cannot be empty.");
      return;
    }

    const parentId = message.parentId == null ? null : String(message.parentId || "").trim() || null;
    if (parentId) {
      const parent = lineupCommentsStore.list(lineupKey).find((entry) => entry.id === parentId);
      if (!parent || parent.parentId) {
        sendError(client, "invalid_message", "That comment cannot be replied to.");
        return;
      }
    }

    const now = Date.now();
    client.lastMessageAt = now;
    client.recentMessageTimes = client.recentMessageTimes || [];
    client.recentMessageTimes.push(now);

    const saved = lineupCommentsStore.pushComment(lineupKey, {
      id: crypto.randomUUID(),
      parentId,
      userId: client.userId,
      authorId: client.authorId || "",
      name: client.displayName,
      authorNameKeys: lineupCommentsStore.normalizeAuthorNameKey(client.displayName)
        ? [lineupCommentsStore.normalizeAuthorNameKey(client.displayName)]
        : [],
      text,
      at: now,
      avatar: client.avatar || "",
      likes: 0,
      dislikes: 0,
      votes: {},
    });

    if (!saved) {
      sendError(client, "comment_limit", "This lineup has reached the comment limit.");
      return;
    }

    const comment =
      lineupCommentsStore.list(lineupKey, { viewerUserId: client.userId }).find((entry) => entry.id === saved.id) ||
      saved;

    const payload = {
      type: "lineup_comment",
      game: String(message.game || "").trim().toLowerCase(),
      videoId: String(message.videoId || "").trim(),
      lineupKey,
      comment: withOwnerFlag({ ...comment, isOwner: isOwnerDisplayName(comment.name) }),
    };

    send(client, payload);
    broadcastToLineupWatchers(lineupKey, payload, client);
  }

  function handleLineupCommentVote(client, message) {
    if (!client.displayName) {
      sendError(client, "name_required", chatConfig.ui?.name_required_message || "Display name required.");
      return;
    }

    const lineupKey = resolveLineupKey(message);
    const commentId = String(message.commentId || "").trim();
    const voteValue = Number(message.vote);
    if (!lineupKey || !commentId) {
      sendError(client, "invalid_message", "Invalid vote.");
      return;
    }
    if (voteValue !== 1 && voteValue !== -1 && voteValue !== 0) {
      sendError(client, "invalid_message", "Invalid vote.");
      return;
    }

    const updated = lineupCommentsStore.vote(lineupKey, commentId, client.userId, voteValue, {
      authorId: client.authorId || "",
      displayName: client.displayName,
    });
    if (updated?.error === "self_vote") {
      sendError(client, "self_vote", "You can't vote on your own comment.");
      return;
    }
    if (!updated) {
      sendError(client, "invalid_message", "Comment not found.");
      return;
    }

    const payload = {
      type: "lineup_comment_vote",
      game: String(message.game || "").trim().toLowerCase(),
      videoId: String(message.videoId || "").trim(),
      lineupKey,
      comment: updated,
    };

    for (const peer of clients) {
      if (peer.watchingLineupKey !== lineupKey) continue;
      const nextComment = lineupCommentsStore.list(lineupKey, { viewerUserId: peer.userId }).find((entry) => entry.id === commentId);
      if (!nextComment) continue;
      send(peer, { ...payload, comment: nextComment });
    }
  }

  function handlePanelOpen(client, message) {
    const next = Boolean(message.open);
    if (client.chatPanelOpen === next) return;
    client.chatPanelOpen = next;
    broadcastPresence();
  }

  function handleLineupSubmissionList(client) {
    if (!isOwnerDisplayName(client.displayName)) {
      sendError(client, "forbidden", "Owner access required.");
      return;
    }
    const routes = deps.lineupSubmissionsRoutes;
    if (!routes) {
      send(client, { type: "lineup_submission_list", pending: [], pendingCount: 0 });
      return;
    }
    const pending = routes.listPendingForOwner().map((entry) => routes.toOwnerSubmission(entry));
    send(client, {
      type: "lineup_submission_list",
      pending,
      pendingCount: pending.length,
    });
  }

  function handleLineupSubmissionReview(client, message) {
    if (!isOwnerDisplayName(client.displayName)) {
      sendError(client, "forbidden", "Owner access required.");
      return;
    }
    const routes = deps.lineupSubmissionsRoutes;
    if (!routes) {
      sendError(client, "unavailable", "Lineup submissions are unavailable.");
      return;
    }

    const submissionId = String(message.submissionId || message.id || "").trim();
    const action = String(message.action || "").trim().toLowerCase();
    if (!submissionId || (action !== "approve" && action !== "reject")) {
      sendError(client, "invalid_message", "Invalid review request.");
      return;
    }

    const result = routes.reviewSubmissionViaWs(submissionId, action, client.displayName);
    if (result.error) {
      sendError(client, "not_found", "Submission not found or already reviewed.");
      return;
    }

    send(client, {
      type: "lineup_submission_reviewed",
      action,
      submission: routes.toOwnerSubmission(result.submission),
      pendingCount: routes.listPendingForOwner().length,
    });
  }

  function handleConnection(client) {
    client.isAlive = true;
    client.userId = crypto.randomUUID();
    client.displayName = "";
    client.bio = "";
    client.avatar = "";
    client.chatPanelOpen = false;
    client.watchingLineupKey = null;
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
        case "dm":
          handleDmMessage(client, message);
          break;
        case "dm_history":
          handleDmHistory(client, message);
          break;
        case "get_profile":
          handleGetProfile(client, message);
          break;
        case "panel_open":
          handlePanelOpen(client, message);
          break;
        case "lineup_comment_watch":
          handleLineupCommentWatch(client, message);
          break;
        case "lineup_comment":
          handleLineupCommentPost(client, message);
          break;
        case "lineup_comment_vote":
          handleLineupCommentVote(client, message);
          break;
        case "lineup_submission_list":
          handleLineupSubmissionList(client);
          break;
        case "lineup_submission_review":
          handleLineupSubmissionReview(client, message);
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
    getHistorySize: () => historyStore.size(),
    getHistory: () => getHistoryPayload(),
    checkDisplayName(name, options = {}) {
      return checkDisplayName(name, options);
    },
    isDisplayNameAvailable(name, options = {}) {
      return checkDisplayName(name, options).available;
    },
    getLineupComments(game, videoId, { viewerUserId = "" } = {}) {
      const lineupKey = buildLineupKey(game, videoId);
      if (!lineupKey) return [];
      return lineupCommentsStore.list(lineupKey, { viewerUserId });
    },
    verifyClientIdentity,
    verifyOwnerIdentity,
    notifyOwners,
    broadcastAll,
  };
}

module.exports = { createChatRoom };
