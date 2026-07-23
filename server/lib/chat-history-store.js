const fs = require("fs");
const path = require("path");

function resolveHistoryPath() {
  const configured = process.env.CHAT_HISTORY_PATH;
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }

  const candidates = [
    path.join(process.cwd(), "data", "chat-history.json"),
    path.join(__dirname, "..", "data", "chat-history.json"),
  ];
  return candidates[0];
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  const userId = String(entry.userId || "").trim();
  const name = String(entry.name || "").trim();
  const text = String(entry.text || "").trim();
  const at = Number(entry.at);
  if (!id || !userId || !name || !text || !Number.isFinite(at)) return null;
  return { id, userId, name, text, at };
}

function createChatHistoryStore({ maxSize = 100, filePath = resolveHistoryPath() } = {}) {
  let messages = [];

  function load() {
    try {
      if (!fs.existsSync(filePath)) {
        messages = [];
        return;
      }

      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const raw = Array.isArray(parsed) ? parsed : parsed?.messages;
      messages = (Array.isArray(raw) ? raw : [])
        .map(normalizeEntry)
        .filter(Boolean)
        .slice(-maxSize);
    } catch (error) {
      console.warn(`Failed to load chat history from ${filePath}:`, error.message);
      messages = [];
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
            messages,
          },
          null,
          0,
        ),
        "utf8",
      );
    } catch (error) {
      console.warn(`Failed to save chat history to ${filePath}:`, error.message);
    }
  }

  function list() {
    return messages.map((entry) => ({ ...entry }));
  }

  function push(entry) {
    const normalized = normalizeEntry(entry);
    if (!normalized) return null;
    messages.push(normalized);
    while (messages.length > maxSize) messages.shift();
    save();
    return normalized;
  }

  load();

  return {
    filePath,
    list,
    push,
    reload: load,
    size: () => messages.length,
  };
}

module.exports = { createChatHistoryStore, resolveHistoryPath };
