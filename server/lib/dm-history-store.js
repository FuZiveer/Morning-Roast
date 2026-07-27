const fs = require("fs");
const path = require("path");

function resolveDmHistoryPath() {
  const configured = process.env.CHAT_DM_HISTORY_PATH;
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  return path.join(process.cwd(), "data", "chat-dm-history.json");
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

  function load() {
    try {
      if (!fs.existsSync(filePath)) {
        conversations = {};
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const raw = parsed?.conversations;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        conversations = {};
        return;
      }
      conversations = {};
      for (const [key, list] of Object.entries(raw)) {
        conversations[key] = (Array.isArray(list) ? list : [])
          .map(normalizeEntry)
          .filter(Boolean)
          .slice(-maxSize);
      }
    } catch (error) {
      console.warn(`Failed to load DM history from ${filePath}:`, error.message);
      conversations = {};
    }
  }

  function save() {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            version: 1,
            updatedAt: Date.now(),
            conversations,
          },
          null,
          0,
        ),
        "utf8",
      );
    } catch (error) {
      console.warn(`Failed to save DM history to ${filePath}:`, error.message);
    }
  }

  function list(key) {
    if (!key) return [];
    return (conversations[key] || []).map((entry) => ({ ...entry }));
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
    push,
    reload: load,
  };
}

module.exports = { createDmHistoryStore, conversationKey, resolveDmHistoryPath };
