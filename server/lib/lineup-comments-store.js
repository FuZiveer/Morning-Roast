const fs = require("fs");
const path = require("path");

function resolveCommentsPath() {
  const configured = process.env.LINEUP_COMMENTS_PATH;
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }

  return path.join(process.cwd(), "data", "lineup-comments.json");
}

function buildLineupKey(game, videoId) {
  const nextGame = String(game || "").trim().toLowerCase();
  const nextId = String(videoId || "").trim();
  if (!nextGame || !nextId) return "";
  return `${nextGame}:${nextId}`;
}

function normalizeComment(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  const userId = String(entry.userId || "").trim();
  const name = String(entry.name || "").trim();
  const text = String(entry.text || "").trim();
  const at = Number(entry.at);
  const parentId = entry.parentId == null ? null : String(entry.parentId || "").trim() || null;
  if (!id || !userId || !name || !text || !Number.isFinite(at)) return null;

  const votesRaw = entry.votes && typeof entry.votes === "object" ? entry.votes : {};
  const votes = {};
  for (const [key, value] of Object.entries(votesRaw)) {
    const vote = Number(value);
    if (vote === 1 || vote === -1) votes[String(key)] = vote;
  }

  let likes = Number(entry.likes);
  let dislikes = Number(entry.dislikes);
  if (!Number.isFinite(likes) || !Number.isFinite(dislikes)) {
    likes = 0;
    dislikes = 0;
    for (const vote of Object.values(votes)) {
      if (vote === 1) likes += 1;
      if (vote === -1) dislikes += 1;
    }
  }

  return {
    id,
    parentId,
    userId,
    name,
    text,
    at,
    avatar: String(entry.avatar || ""),
    likes: Math.max(0, likes),
    dislikes: Math.max(0, dislikes),
    votes,
  };
}

function serializeComment(comment, viewerUserId = "") {
  const viewerId = String(viewerUserId || "").trim();
  const yourVote = viewerId && comment.votes[viewerId] ? comment.votes[viewerId] : 0;
  return {
    id: comment.id,
    parentId: comment.parentId,
    userId: comment.userId,
    name: comment.name,
    text: comment.text,
    at: comment.at,
    avatar: comment.avatar || "",
    likes: comment.likes,
    dislikes: comment.dislikes,
    yourVote,
  };
}

function createLineupCommentsStore({ maxCommentsPerLineup = 200, filePath = resolveCommentsPath() } = {}) {
  let lineups = {};

  function load() {
    try {
      if (!fs.existsSync(filePath)) {
        lineups = {};
        return;
      }

      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const raw = parsed?.lineups && typeof parsed.lineups === "object" ? parsed.lineups : {};
      lineups = {};

      for (const [key, bucket] of Object.entries(raw)) {
        const lineupKey = String(key || "").trim();
        if (!lineupKey) continue;
        const comments = (Array.isArray(bucket?.comments) ? bucket.comments : [])
          .map(normalizeComment)
          .filter(Boolean);
        if (comments.length) lineups[lineupKey] = { comments };
      }
    } catch (error) {
      console.warn(`Failed to load lineup comments from ${filePath}:`, error.message);
      lineups = {};
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
            lineups,
          },
          null,
          0,
        ),
        "utf8",
      );
    } catch (error) {
      console.warn(`Failed to save lineup comments to ${filePath}:`, error.message);
    }
  }

  function getBucket(lineupKey) {
    const key = String(lineupKey || "").trim();
    if (!key) return null;
    if (!lineups[key]) lineups[key] = { comments: [] };
    return lineups[key];
  }

  function findComment(lineupKey, commentId) {
    const bucket = lineups[String(lineupKey || "").trim()];
    if (!bucket) return null;
    const id = String(commentId || "").trim();
    return bucket.comments.find((comment) => comment.id === id) || null;
  }

  function list(lineupKey, { viewerUserId = "" } = {}) {
    const bucket = lineups[String(lineupKey || "").trim()];
    if (!bucket) return [];
    return bucket.comments.map((comment) => serializeComment(comment, viewerUserId));
  }

  function pushComment(lineupKey, entry) {
    const key = String(lineupKey || "").trim();
    const normalized = normalizeComment(entry);
    if (!key || !normalized) return null;

    const bucket = getBucket(key);
    if (bucket.comments.length >= maxCommentsPerLineup) return null;

    if (normalized.parentId) {
      const parent = findComment(key, normalized.parentId);
      if (!parent || parent.parentId) return null;
    }

    bucket.comments.push(normalized);
    save();
    return serializeComment(normalized);
  }

  function vote(lineupKey, commentId, userId, voteValue) {
    const key = String(lineupKey || "").trim();
    const id = String(commentId || "").trim();
    const voterId = String(userId || "").trim();
    const nextVote = Number(voteValue);
    if (!key || !id || !voterId) return null;
    if (nextVote !== 1 && nextVote !== -1 && nextVote !== 0) return null;

    const comment = findComment(key, id);
    if (!comment) return null;

    const prevVote = comment.votes[voterId] || 0;
    if (prevVote === nextVote) {
      return serializeComment(comment, voterId);
    }

    if (prevVote === 1) comment.likes = Math.max(0, comment.likes - 1);
    if (prevVote === -1) comment.dislikes = Math.max(0, comment.dislikes - 1);

    if (nextVote === 0) {
      delete comment.votes[voterId];
    } else {
      comment.votes[voterId] = nextVote;
      if (nextVote === 1) comment.likes += 1;
      if (nextVote === -1) comment.dislikes += 1;
    }

    save();
    return serializeComment(comment, voterId);
  }

  load();

  return {
    filePath,
    buildLineupKey,
    list,
    pushComment,
    vote,
    reload: load,
  };
}

module.exports = { createLineupCommentsStore, buildLineupKey, resolveCommentsPath };
