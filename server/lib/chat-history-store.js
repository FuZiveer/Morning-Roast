const { readJsonFile, writeJsonFile, resolveDataFile } = require("./safe-json-file");

function resolveHistoryPath() {
  return resolveDataFile("chat-history.json", "CHAT_HISTORY_PATH");
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
  let loadFailed = false;

  function load() {
    const result = readJsonFile(filePath, { messages: [] }, "chat history");
    loadFailed = result.source === "failed";
    const raw = Array.isArray(result.data) ? result.data : result.data?.messages;
    messages = (Array.isArray(raw) ? raw : [])
      .map(normalizeEntry)
      .filter(Boolean)
      .slice(-maxSize);
    if (loadFailed && messages.length) loadFailed = false;
  }

  function save() {
    if (loadFailed && !messages.length) {
      console.warn("[data-persist] Skipping save of empty chat history after failed load");
      return;
    }
    try {
      writeJsonFile(
        filePath,
        {
          version: 1,
          updatedAt: Date.now(),
          messages,
        },
        "chat history",
      );
      loadFailed = false;
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
