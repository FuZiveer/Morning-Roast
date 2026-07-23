const fs = require("fs");
const path = require("path");

const BUILTIN_BLOCKED_WORDS = [
  "asshole",
  "asshat",
  "bastard",
  "bitch",
  "bitchy",
  "bollocks",
  "bullshit",
  "cock",
  "cocksucker",
  "cum",
  "cunt",
  "dammit",
  "damn",
  "dick",
  "dickhead",
  "dickwad",
  "douche",
  "douchebag",
  "dumbass",
  "fag",
  "faggot",
  "fuck",
  "fucked",
  "fucker",
  "fucking",
  "goddammit",
  "goddamn",
  "hitler",
  "horseshit",
  "jackass",
  "jerkoff",
  "kike",
  "kill yourself",
  "kys",
  "motherfucker",
  "nazi",
  "nigga",
  "nigger",
  "pedo",
  "pedophile",
  "piss",
  "pissed",
  "prick",
  "pussy",
  "rape",
  "rapist",
  "retard",
  "retarded",
  "shit",
  "shithead",
  "shitty",
  "skank",
  "slut",
  "spic",
  "twat",
  "wanker",
  "wetback",
  "whore",
];

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resolveBlockedWordsPath() {
  const configured = process.env.CHAT_BLOCKED_WORDS_PATH;
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  const candidates = [
    path.join(process.cwd(), "config", "chat-blocked-words.txt"),
    path.join(__dirname, "..", "..", "config", "chat-blocked-words.txt"),
    path.join(__dirname, "..", "config", "chat-blocked-words.txt"),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
}

function loadBlockedWords(extraWords = []) {
  const words = new Set();

  for (const word of BUILTIN_BLOCKED_WORDS) {
    const token = String(word || "").trim().toLowerCase();
    if (token.length >= 2) words.add(token);
  }

  for (const word of extraWords) {
    const token = String(word || "").trim().toLowerCase();
    if (token.length >= 2) words.add(token);
  }

  try {
    const filePath = resolveBlockedWordsPath();
    if (fs.existsSync(filePath)) {
      for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
        const token = line.replace(/#.*$/, "").trim().toLowerCase();
        if (token.length >= 2) words.add(token);
      }
    }
  } catch (error) {
    console.warn("Failed to load chat blocked words file:", error.message);
  }

  return [...words].sort((a, b) => b.length - a.length);
}

function normalizeForModeration(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[@4]/g, "a")
    .replace(/[3€]/g, "e")
    .replace(/[1!|]/g, "i")
    .replace(/[0]/g, "o")
    .replace(/[$5§]/g, "s")
    .replace(/[7+]/g, "t")
    .replace(/ph/g, "f");
}

function buildWordPattern(word) {
  const token = normalizeForModeration(word).replace(/\s+/g, "");
  if (!token) return null;
  const escaped = escapeRegExp(token);
  if (/^[a-z0-9]+$/i.test(token)) {
    return new RegExp(`(^|[^a-z0-9])(${escaped})(?=[^a-z0-9]|$)`, "gi");
  }
  return new RegExp(escaped, "gi");
}

function createChatModeration(blockedWordsInput = []) {
  const blockedWords = loadBlockedWords(blockedWordsInput);
  const patterns = blockedWords.map((word) => ({ word, pattern: buildWordPattern(word) })).filter((entry) => entry.pattern);

  function censorText(text) {
    let next = String(text || "");
    for (const { pattern } of patterns) {
      next = next.replace(pattern, (match, prefix = "", hit = "") => {
        const target = hit || match;
        return `${prefix}${"*".repeat(target.length)}`;
      });
    }
    return next;
  }

  function containsBlockedContent(text) {
    const raw = String(text || "");
    const normalized = normalizeForModeration(raw);
    const compact = normalized.replace(/[^a-z0-9\u0400-\u04ff\u0600-\u06ff\u4e00-\u9fff\uac00-\ud7af]+/gi, "");

    for (const word of blockedWords) {
      const token = normalizeForModeration(word).replace(/\s+/g, "");
      if (!token) continue;

      if (/^[a-z0-9]+$/i.test(token)) {
        const pattern = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}(?=[^a-z0-9]|$)`, "i");
        if (pattern.test(normalized)) return true;
      } else if (compact.includes(token) || normalized.includes(token)) {
        return true;
      }
    }

    return false;
  }

  function isBlockedName(name) {
    const normalized = normalizeForModeration(name);
    const compact = normalized.replace(/[^a-z0-9\u0400-\u04ff\u0600-\u06ff\u4e00-\u9fff\uac00-\ud7af]+/gi, "");
    if (!compact) return false;

    for (const word of blockedWords) {
      const token = normalizeForModeration(word).replace(/[^a-z0-9\u0400-\u04ff\u0600-\u06ff\u4e00-\u9fff\uac00-\ud7af]+/gi, "");
      if (!token) continue;
      if (compact === token) return true;

      const bounded = new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}($|[^a-z0-9])`, "i");
      if (bounded.test(normalized)) return true;

      if (/^[a-z0-9]+$/i.test(token)) {
        if (compact.startsWith(token) || compact.endsWith(token)) return true;
        if (token.length >= 5 && compact.includes(token)) return true;
      } else if (compact.includes(token)) {
        return true;
      }
    }

    return false;
  }

  return {
    blockedWords,
    censorText,
    containsBlockedContent,
    isBlockedName,
  };
}

module.exports = { createChatModeration, loadBlockedWords, normalizeForModeration };
