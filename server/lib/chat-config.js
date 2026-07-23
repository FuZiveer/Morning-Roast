const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const DEFAULT_CONFIG = {
  chat: {
    enabled: true,
    websocket: { path: "/chat", production_url: "" },
    limits: {
      max_message_length: 500,
      max_display_name_length: 32,
      max_bio_length: 160,
      history_size: 100,
      rate_limit_ms: 1500,
      max_messages_per_minute: 20,
      max_online_users_shown: 24,
    },
    requirements: { display_name_required: true, bio_required: false },
    ui: {
      title: "Community Chat",
      description: "Talk with other Morning Roast visitors in real time.",
      placeholder: "Message the lobby…",
      empty_state: "No messages yet. Say hi!",
      offline_message: "Chat is offline. Try again in a moment.",
      name_required_message: "Set a display name on your Profile before chatting.",
      name_taken_message: "That display name is already in use. Choose another one.",
      reconnecting_message: "Reconnecting to chat…",
    },
    moderation: { strip_urls: true, blocked_words: [] },
    owners: { display_names: [] },
  },
};

function deepMerge(base, override) {
  if (!override || typeof override !== "object") return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out[key] = deepMerge(out[key] || {}, value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

function resolveConfigPath() {
  const configured = process.env.CHAT_CONFIG_PATH;
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  const candidates = [
    path.join(process.cwd(), "config", "chat.yaml"),
    path.join(__dirname, "..", "..", "config", "chat.yaml"),
    path.join(__dirname, "..", "config", "chat.yaml"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function loadChatConfig() {
  const configPath = resolveConfigPath();
  let fileConfig = {};
  try {
    if (fs.existsSync(configPath)) {
      fileConfig = yaml.load(fs.readFileSync(configPath, "utf8")) || {};
    } else {
      console.warn(`Chat config not found at ${configPath}; using defaults.`);
    }
  } catch (error) {
    console.warn(`Failed to load chat config from ${configPath}:`, error.message);
  }

  const merged = deepMerge(DEFAULT_CONFIG, fileConfig);
  if (process.env.CHAT_PATH) merged.chat.websocket.path = process.env.CHAT_PATH;
  if (process.env.CHAT_ENABLED === "false") merged.chat.enabled = false;
  if (process.env.CHAT_OWNER_NAMES) {
    merged.chat.owners = {
      display_names: String(process.env.CHAT_OWNER_NAMES)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    };
  }
  return merged;
}

function getPublicChatConfig(config) {
  const chat = config.chat || {};
  return {
    enabled: Boolean(chat.enabled),
    websocket: {
      path: chat.websocket?.path || "/chat",
      production_url: chat.websocket?.production_url || "",
    },
    limits: { ...chat.limits },
    requirements: { ...chat.requirements },
    ui: { ...chat.ui },
    owners: {
      display_names: Array.isArray(chat.owners?.display_names) ? [...chat.owners.display_names] : [],
    },
  };
}

module.exports = { loadChatConfig, getPublicChatConfig, DEFAULT_CONFIG };
