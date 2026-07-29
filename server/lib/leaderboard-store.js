const crypto = require("crypto");
const { readJsonFile, writeJsonFile, resolveDataFile } = require("./safe-json-file");

const VALID_MODES = new Set(["static", "shrinking", "tracking", "flick", "switch", "strafe", "micro"]);
const VALID_TIMERS = new Set(["15", "30", "60"]);
const MAX_ENTRIES_PER_BOARD = 100;
const TOP_LIMIT = 50;
const SUBMIT_COOLDOWN_MS = 8000;
const MAX_DISPLAY_NAME = 32;

function resolveStorePath() {
  return resolveDataFile("leaderboard.json", "LEADERBOARD_PATH");
}

function boardKey(game, mode, timer) {
  return `${game}|${mode}|${timer}`;
}

function normalizeGame(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 48) return null;
  return raw.toUpperCase().replace(/\s+/g, " ");
}

function normalizeMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return VALID_MODES.has(mode) ? mode : null;
}

function normalizeTimer(value) {
  const timer = String(value || "").trim();
  return VALID_TIMERS.has(timer) ? timer : null;
}

function normalizeUserId(value) {
  const id = String(value || "").trim();
  if (!id || id.length > 64) return null;
  return id;
}

function normalizeDisplayName(value) {
  const name = String(value || "").trim().slice(0, MAX_DISPLAY_NAME);
  if (name.length < 2) return null;
  return name;
}

function clampInt(value, min, max) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function clampFloat(value, min, max) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function isTrackingMode(mode) {
  return mode === "tracking";
}

function compareScores(a, b, mode) {
  if (a.score !== b.score) return b.score - a.score;
  if (a.accuracy !== b.accuracy) return b.accuracy - a.accuracy;
  const reactionA = a.reaction > 0 && a.reaction < 9999 ? a.reaction : 9999;
  const reactionB = b.reaction > 0 && b.reaction < 9999 ? b.reaction : 9999;
  if (reactionA !== reactionB) return reactionA - reactionB;
  if (isTrackingMode(mode) && a.hits !== b.hits) return b.hits - a.hits;
  return (a.updatedAt || a.submittedAt || 0) - (b.updatedAt || b.submittedAt || 0);
}

function isBetterScore(incoming, existing, mode) {
  return compareScores(incoming, existing, mode) < 0;
}

function validateSubmission(payload) {
  const game = normalizeGame(payload.game);
  const mode = normalizeMode(payload.mode);
  const timer = normalizeTimer(payload.timer);
  const userId = normalizeUserId(payload.userId);
  const displayName = normalizeDisplayName(payload.displayName);

  if (!game || !mode || !timer || !userId || !displayName) {
    return { error: "invalid_payload" };
  }

  const hits = clampInt(payload.hits, 0, 100000);
  const accuracy = clampInt(payload.accuracy, 0, 100);
  const reaction = clampInt(payload.reaction, 0, 9999);
  const score = clampInt(payload.score, 0, 100000);

  if (isTrackingMode(mode)) {
    if (score !== accuracy) return { error: "invalid_score" };
  } else if (score !== hits) {
    return { error: "invalid_score" };
  }

  const sens = String(payload.sens || "").trim().slice(0, 16) || "0";
  const dpi = String(payload.dpi || "").trim().slice(0, 8) || "0";

  return {
    entry: {
      id: crypto.randomUUID(),
      userId,
      displayName,
      game,
      mode,
      timer,
      score,
      hits,
      accuracy,
      reaction,
      sens,
      dpi,
      submittedAt: Date.now(),
      updatedAt: Date.now(),
    },
  };
}

function createLeaderboardStore() {
  const storePath = resolveStorePath();
  let cache = null;

  function loadStore() {
    if (cache) return cache;
    const { data } = readJsonFile(storePath, { boards: {}, submitCooldown: {} }, "leaderboard store");
    cache = {
      boards: data.boards && typeof data.boards === "object" ? data.boards : {},
      submitCooldown: data.submitCooldown && typeof data.submitCooldown === "object" ? data.submitCooldown : {},
    };
    return cache;
  }

  function persistStore() {
    if (!cache) return;
    writeJsonFile(storePath, cache, "leaderboard store");
  }

  function getBoardEntries(game, mode, timer) {
    const store = loadStore();
    const key = boardKey(game, mode, timer);
    const board = store.boards[key];
    if (!board || !Array.isArray(board.entries)) return [];
    return board.entries.filter(Boolean);
  }

  function sortEntries(entries, mode) {
    return [...entries].sort((a, b) => compareScores(a, b, mode));
  }

  function trimBoard(entries, mode) {
    return sortEntries(entries, mode).slice(0, MAX_ENTRIES_PER_BOARD);
  }

  function getLeaderboard(game, mode, timer, { userId = null, limit = TOP_LIMIT } = {}) {
    const normalizedGame = normalizeGame(game);
    const normalizedMode = normalizeMode(mode);
    const normalizedTimer = normalizeTimer(timer);
    if (!normalizedGame || !normalizedMode || !normalizedTimer) {
      return { error: "invalid_query" };
    }

    const sorted = sortEntries(getBoardEntries(normalizedGame, normalizedMode, normalizedTimer), normalizedMode);
    const capped = sorted.slice(0, Math.min(Math.max(1, limit), TOP_LIMIT));

    let userRank = null;
    let userEntry = null;
    if (userId) {
      const index = sorted.findIndex((entry) => entry.userId === userId);
      if (index >= 0) {
        userRank = index + 1;
        userEntry = sorted[index];
      }
    }

    return {
      game: normalizedGame,
      mode: normalizedMode,
      timer: normalizedTimer,
      scoreType: isTrackingMode(normalizedMode) ? "accuracy" : "hits",
      total: sorted.length,
      entries: capped.map((entry, index) => ({
        rank: index + 1,
        userId: entry.userId,
        displayName: entry.displayName,
        score: entry.score,
        hits: entry.hits,
        accuracy: entry.accuracy,
        reaction: entry.reaction,
        sens: entry.sens,
        dpi: entry.dpi,
        submittedAt: entry.submittedAt,
        updatedAt: entry.updatedAt,
      })),
      userRank,
      userEntry: userEntry
        ? {
            rank: userRank,
            userId: userEntry.userId,
            displayName: userEntry.displayName,
            score: userEntry.score,
            hits: userEntry.hits,
            accuracy: userEntry.accuracy,
            reaction: userEntry.reaction,
            sens: userEntry.sens,
            dpi: userEntry.dpi,
            submittedAt: userEntry.submittedAt,
            updatedAt: userEntry.updatedAt,
          }
        : null,
    };
  }

  function submitScore(payload) {
    const validated = validateSubmission(payload);
    if (validated.error) return validated;

    const store = loadStore();
    const { entry } = validated;
    const now = Date.now();
    const lastSubmit = Number(store.submitCooldown[entry.userId]) || 0;
    if (now - lastSubmit < SUBMIT_COOLDOWN_MS) {
      return { error: "rate_limited", retryAfterMs: SUBMIT_COOLDOWN_MS - (now - lastSubmit) };
    }

    const key = boardKey(entry.game, entry.mode, entry.timer);
    if (!store.boards[key]) store.boards[key] = { entries: [] };

    const entries = getBoardEntries(entry.game, entry.mode, entry.timer);
    const existingIndex = entries.findIndex((row) => row.userId === entry.userId);

    let improved = false;
    let rank = null;

    if (existingIndex >= 0) {
      const existing = entries[existingIndex];
      if (isBetterScore(entry, existing, entry.mode)) {
        entries[existingIndex] = {
          ...existing,
          displayName: entry.displayName,
          score: entry.score,
          hits: entry.hits,
          accuracy: entry.accuracy,
          reaction: entry.reaction,
          sens: entry.sens,
          dpi: entry.dpi,
          updatedAt: now,
        };
        improved = true;
      } else {
        entries[existingIndex].displayName = entry.displayName;
      }
    } else {
      entries.push(entry);
      improved = true;
    }

    store.boards[key].entries = trimBoard(entries, entry.mode);
    store.submitCooldown[entry.userId] = now;
    persistStore();

    const sorted = sortEntries(store.boards[key].entries, entry.mode);
    rank = sorted.findIndex((row) => row.userId === entry.userId) + 1;

    return {
      ok: true,
      improved,
      rank,
      total: sorted.length,
      scoreType: isTrackingMode(entry.mode) ? "accuracy" : "hits",
      entry: {
        rank,
        userId: entry.userId,
        displayName: entry.displayName,
        score: entry.score,
        hits: entry.hits,
        accuracy: entry.accuracy,
        reaction: entry.reaction,
      },
    };
  }

  return {
    getLeaderboard,
    submitScore,
    resolveStorePath,
  };
}

module.exports = { createLeaderboardStore, resolveStorePath };
