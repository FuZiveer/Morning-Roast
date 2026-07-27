const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const VALID_GAMES = new Set(["valorant", "cs2"]);
const VALID_SIDES = new Set(["attacker", "defender"]);
const VALID_STATUSES = new Set(["pending", "approved", "rejected"]);
const VALID_DIFFICULTIES = new Set(["1", "2", "3", "4", "5"]);
const CS2_UTILITIES = new Set(["smoke", "molotov", "incendiary", "he", "flashbang"]);

function resolveStorePath() {
  const configured = process.env.LINEUP_SUBMISSIONS_PATH;
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  return path.join(process.cwd(), "data", "lineup-submissions.json");
}

function resolveUploadsDir() {
  const configured = process.env.LINEUP_UPLOADS_DIR;
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  return path.join(process.cwd(), "data", "lineup-uploads");
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeSubmission(entry) {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  const status = String(entry.status || "").trim().toLowerCase();
  const game = String(entry.game || "").trim().toLowerCase();
  const map = slugify(entry.map);
  const side = String(entry.side || "").trim().toLowerCase();
  const callout = String(entry.callout || "").trim().slice(0, 80);
  const title = String(entry.title || "").trim().slice(0, 120);
  const difficulty = String(entry.difficulty || "").trim();
  const videoId = String(entry.videoId || "").trim();
  const videoFilename = String(entry.videoFilename || "").trim();
  const submittedAt = Number(entry.submittedAt);
  if (!id || !VALID_STATUSES.has(status) || !VALID_GAMES.has(game) || !map || !VALID_SIDES.has(side)) return null;
  if (!title || !VALID_DIFFICULTIES.has(difficulty) || !videoId || !videoFilename || !Number.isFinite(submittedAt)) return null;

  const submitter = entry.submittedBy && typeof entry.submittedBy === "object" ? entry.submittedBy : {};
  const submittedBy = {
    userId: String(submitter.userId || "").trim(),
    authorId: String(submitter.authorId || "").trim(),
    name: String(submitter.name || "").trim().slice(0, 32) || "Guest",
  };

  const normalized = {
    id,
    status,
    game,
    map,
    side,
    callout,
    title,
    difficulty,
    videoId,
    videoFilename,
    submittedBy,
    submittedAt,
    reviewedAt: Number(entry.reviewedAt) || null,
    reviewedBy: String(entry.reviewedBy || "").trim() || null,
    search: String(entry.search || "").trim().toLowerCase(),
  };

  if (game === "valorant") {
    normalized.agent = slugify(entry.agent);
    normalized.ability = slugify(entry.ability);
  } else if (game === "cs2") {
    const utility = String(entry.utility || "").trim().toLowerCase();
    if (utility && CS2_UTILITIES.has(utility)) normalized.utility = utility;
  }

  return normalized;
}

function buildSearchText(submission) {
  return [
    submission.title,
    submission.callout,
    submission.map,
    submission.side,
    submission.game,
    submission.agent,
    submission.ability,
    submission.utility,
    submission.submittedBy?.name,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function toPublicSubmission(submission, { videoBaseUrl = "" } = {}) {
  if (!submission) return null;
  const videoUrl = videoBaseUrl ? `${videoBaseUrl.replace(/\/$/, "")}/lineups/video/${submission.id}` : "";
  return {
    id: submission.id,
    game: submission.game,
    map: submission.map,
    side: submission.side,
    callout: submission.callout,
    title: submission.title,
    difficulty: submission.difficulty,
    videoId: submission.videoId,
    videoUrl,
    agent: submission.agent || "",
    ability: submission.ability || "",
    utility: submission.utility || "",
    submittedBy: { ...submission.submittedBy },
    submittedAt: submission.submittedAt,
    approvedAt: submission.reviewedAt,
    search: submission.search || buildSearchText(submission),
  };
}

function toOwnerSubmission(submission, extras = {}) {
  if (!submission) return null;
  return {
    ...toPublicSubmission(submission, extras),
    status: submission.status,
    reviewedAt: submission.reviewedAt,
    reviewedBy: submission.reviewedBy,
  };
}

function createLineupSubmissionsStore({ filePath = resolveStorePath(), uploadsDir = resolveUploadsDir() } = {}) {
  let submissions = {};

  function load() {
    try {
      if (!fs.existsSync(filePath)) {
        submissions = {};
        return;
      }
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      const raw = parsed?.submissions && typeof parsed.submissions === "object" ? parsed.submissions : {};
      submissions = {};
      for (const [key, entry] of Object.entries(raw)) {
        const normalized = normalizeSubmission(entry);
        if (normalized) submissions[key] = normalized;
      }
    } catch (error) {
      console.warn(`Failed to load lineup submissions from ${filePath}:`, error.message);
      submissions = {};
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
            submissions,
          },
          null,
          0,
        ),
        "utf8",
      );
    } catch (error) {
      console.warn(`Failed to save lineup submissions to ${filePath}:`, error.message);
    }
  }

  function listPending() {
    return Object.values(submissions)
      .filter((entry) => entry.status === "pending")
      .sort((a, b) => a.submittedAt - b.submittedAt);
  }

  function listApproved(game = "") {
    const nextGame = String(game || "").trim().toLowerCase();
    return Object.values(submissions)
      .filter((entry) => entry.status === "approved" && (!nextGame || entry.game === nextGame))
      .sort((a, b) => (b.reviewedAt || b.submittedAt) - (a.reviewedAt || a.submittedAt));
  }

  function getById(id) {
    return submissions[String(id || "").trim()] || null;
  }

  function getVideoPath(id) {
    const entry = getById(id);
    if (!entry || entry.status !== "approved") return null;
    const filePathOnDisk = path.join(uploadsDir, entry.videoFilename);
    if (!fs.existsSync(filePathOnDisk)) return null;
    return filePathOnDisk;
  }

  function createPendingSubmission(payload, videoBuffer, { mime = "video/mp4", originalName = "lineup.mp4" } = {}) {
    const game = String(payload.game || "").trim().toLowerCase();
    const map = slugify(payload.map);
    const side = String(payload.side || "").trim().toLowerCase();
    const callout = String(payload.callout || "").trim().slice(0, 80);
    const title = String(payload.title || "").trim().slice(0, 120);
    const difficulty = String(payload.difficulty || "").trim();

    if (!VALID_GAMES.has(game) || !map || !VALID_SIDES.has(side) || !title || !VALID_DIFFICULTIES.has(difficulty)) {
      return { error: "invalid_fields" };
    }
    if (!videoBuffer?.length) return { error: "missing_video" };

    const ext = path.extname(originalName).toLowerCase();
    const allowedExt = new Set([".mp4", ".webm", ".mov"]);
    const safeExt = allowedExt.has(ext) ? ext : ".mp4";
    const allowedMime = /^video\/(mp4|webm|quicktime)$/i;
    if (!allowedMime.test(String(mime || ""))) return { error: "invalid_video_type" };
    if (videoBuffer.length > 50 * 1024 * 1024) return { error: "video_too_large" };

    const id = crypto.randomUUID();
    const videoId = `community-${id.slice(0, 8)}`;
    const videoFilename = `${id}${safeExt}`;

    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(uploadsDir, videoFilename), videoBuffer);

    const submittedBy = {
      userId: String(payload.userId || "").trim(),
      authorId: String(payload.authorId || "").trim(),
      name: String(payload.submitterName || payload.name || "").trim().slice(0, 32) || "Guest",
    };

    const entry = {
      id,
      status: "pending",
      game,
      map,
      side,
      callout,
      title,
      difficulty,
      videoId,
      videoFilename,
      submittedBy,
      submittedAt: Date.now(),
      reviewedAt: null,
      reviewedBy: null,
    };

    if (game === "valorant") {
      entry.agent = slugify(payload.agent);
      entry.ability = slugify(payload.ability);
    } else if (game === "cs2") {
      const utility = String(payload.utility || "").trim().toLowerCase();
      if (utility && CS2_UTILITIES.has(utility)) entry.utility = utility;
    }

    entry.search = buildSearchText(entry);
    submissions[id] = entry;
    save();
    return { submission: entry };
  }

  function reviewSubmission(id, action, reviewerName = "") {
    const entry = getById(id);
    if (!entry || entry.status !== "pending") return { error: "not_found" };

    if (action === "approve") {
      entry.status = "approved";
    } else if (action === "reject") {
      entry.status = "rejected";
      const filePathOnDisk = path.join(uploadsDir, entry.videoFilename);
      try {
        if (fs.existsSync(filePathOnDisk)) fs.unlinkSync(filePathOnDisk);
      } catch {
        // ignore cleanup errors
      }
    } else {
      return { error: "invalid_action" };
    }

    entry.reviewedAt = Date.now();
    entry.reviewedBy = String(reviewerName || "").trim() || null;
    save();
    return { submission: entry };
  }

  load();

  return {
    uploadsDir,
    listPending,
    listApproved,
    getById,
    getVideoPath,
    createPendingSubmission,
    reviewSubmission,
    toPublicSubmission,
    toOwnerSubmission,
  };
}

module.exports = {
  createLineupSubmissionsStore,
  resolveUploadsDir,
};
