const { readJsonFile, writeJsonFile, resolveDataFile } = require("./safe-json-file");

function resolveDmHistoryPath() {
  return resolveDataFile("chat-dm-history.json", "CHAT_DM_HISTORY_PATH");
}

function normalizeNameKey(name) {
  return String(name || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function conversationKey(nameA, nameB) {
  const keys = [normalizeNameKey(nameA), normalizeNameKey(nameB)].filter(Boolean).sort();
  if (keys.length < 2) return "";
  return keys.join("|");
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  const fromUserId = String(entry.fromUserId || "").trim();
  const toUserId = String(entry.toUserId || "").trim();
  const fromName = String(entry.fromName || "").trim();
  const toName = String(entry.toName || "").trim();
  const text = String(entry.text || "").trim();
  const at = Number(entry.at);
  if (!id || !fromUserId || !toUserId || !fromName || !toName || !text || !Number.isFinite(at)) return null;
  return { id, fromUserId, toUserId, fromName, toName, text, at };
}

function createDmHistoryStore({ maxSize = 100, filePath = resolveDmHistoryPath() } = {}) {
  let conversations = {};
  let loadFailed = false;

  function load() {
    const result = readJsonFile(filePath, { conversations: {} }, "DM history");
    loadFailed = result.source === "failed";
    const raw = result.data?.conversations;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      if (!loadFailed) conversations = {};
      return;
    }
    conversations = {};
    for (const [key, list] of Object.entries(raw)) {
      conversations[key] = (Array.isArray(list) ? list : [])
        .map(normalizeEntry)
        .filter(Boolean)
        .slice(-maxSize);
    }
    if (loadFailed && Object.keys(conversations).length) loadFailed = false;
  }

  function save() {
    if (loadFailed && !Object.keys(conversations).length) {
      console.warn("[data-persist] Skipping save of empty DM history after failed load");
      return;
    }
    try {
      writeJsonFile(
        filePath,
        {
          version: 1,
          updatedAt: Date.now(),
          conversations,
        },
        "DM history",
      );
      loadFailed = false;
    } catch (error) {
      console.warn(`Failed to save DM history to ${filePath}:`, error.message);
    }
  }

  function list(key) {
    if (!key) return [];
    return (conversations[key] || []).map((entry) => ({ ...entry }));
  }

  function findPeerDisplayName(selfName, peerUserId) {
    const selfKey = normalizeNameKey(selfName);
    const id = String(peerUserId || "").trim();
    if (!selfKey || !id) return "";
    for (const [key, list] of Object.entries(conversations)) {
      if (!key.includes(selfKey)) continue;
      for (const entry of list || []) {
        if (entry.fromUserId === id) {
          const name = String(entry.fromName || "").trim();
          if (name && normalizeNameKey(name) !== selfKey) return name;
        }
        if (entry.toUserId === id) {
          const name = String(entry.toName || "").trim();
          if (name && normalizeNameKey(name) !== selfKey) return name;
        }
      }
    }
    return "";
  }

  function push(key, entry) {
    const normalized = normalizeEntry(entry);
    if (!key || !normalized) return null;
    if (!conversations[key]) conversations[key] = [];
    conversations[key].push(normalized);
    while (conversations[key].length > maxSize) conversations[key].shift();
    save();
    return normalized;
  }

  load();

  return {
    filePath,
    conversationKey,
    list,
    findPeerDisplayName,
    push,
    reload: load,
  };
}

module.exports = { createDmHistoryStore, conversationKey, resolveDmHistoryPath };
