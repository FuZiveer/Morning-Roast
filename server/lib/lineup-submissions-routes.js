const fs = require("fs");
const path = require("path");
const { parseMultipartRequest } = require("./parse-multipart");

function sendJson(res, status, body, corsOrigin) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": corsOrigin,
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function sendOptions(res, corsOrigin) {
  res.writeHead(204, {
    "Access-Control-Allow-Origin": corsOrigin,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  });
  res.end();
}

function resolveVideoBaseUrl(req) {
  const host = req.headers.host || "localhost";
  const proto = req.headers["x-forwarded-proto"] || "http";
  return `${proto}://${host}`;
}

function resolveVideoMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  return "video/mp4";
}

function streamVideoFile(req, res, filePath, { corsOrigin, cacheControl = "public, max-age=86400" } = {}) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404, { "Access-Control-Allow-Origin": corsOrigin });
    res.end("Not Found");
    return;
  }

  const fileSize = stat.size;
  const mime = resolveVideoMime(filePath);
  const range = req.headers.range;

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(String(range).trim());
    if (!match) {
      res.writeHead(416, {
        "Content-Range": `bytes */${fileSize}`,
        "Access-Control-Allow-Origin": corsOrigin,
      });
      res.end();
      return;
    }

    let start = match[1] ? Number.parseInt(match[1], 10) : 0;
    let end = match[2] ? Number.parseInt(match[2], 10) : fileSize - 1;
    if (!Number.isFinite(start) || start < 0) start = 0;
    if (!Number.isFinite(end) || end >= fileSize) end = fileSize - 1;

    if (start > end || start >= fileSize) {
      res.writeHead(416, {
        "Content-Range": `bytes */${fileSize}`,
        "Access-Control-Allow-Origin": corsOrigin,
      });
      res.end();
      return;
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": mime,
      "Access-Control-Allow-Origin": corsOrigin,
      "Cache-Control": cacheControl,
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  if (req.method === "HEAD") {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": mime,
      "Accept-Ranges": "bytes",
      "Access-Control-Allow-Origin": corsOrigin,
      "Cache-Control": cacheControl,
    });
    res.end();
    return;
  }

  res.writeHead(200, {
    "Content-Length": fileSize,
    "Content-Type": mime,
    "Accept-Ranges": "bytes",
    "Access-Control-Allow-Origin": corsOrigin,
    "Cache-Control": cacheControl,
  });
  fs.createReadStream(filePath).pipe(res);
}

function verifySubmitter(chatRoom, userId, submitterName) {
  if (!chatRoom?.verifyClientIdentity) return false;
  return chatRoom.verifyClientIdentity(userId, submitterName);
}

function verifyOwner(chatRoom, userId, displayName) {
  if (!chatRoom?.verifyOwnerIdentity) return false;
  return chatRoom.verifyOwnerIdentity(userId, displayName);
}

function createLineupSubmissionsRoutes({ chatRoom, store, corsOrigin: defaultCorsOrigin = "*", getCorsOrigin, publicBaseUrl = "" } = {}) {
  const videoBaseUrl = String(publicBaseUrl || "").replace(/\/$/, "");

  function corsOriginFor(req) {
    return (typeof getCorsOrigin === "function" ? getCorsOrigin(req) : null) || defaultCorsOrigin;
  }

  function notifyOwnersPending(submission) {
    chatRoom?.notifyOwners?.({
      type: "lineup_submission_pending",
      submission: store.toOwnerSubmission(submission, { videoBaseUrl }),
      pendingCount: store.listPending().length,
    });
  }

  function broadcastReviewed(submission, action) {
    chatRoom?.broadcastAll?.({
      type: "lineup_submission_reviewed",
      action,
      submission: store.toPublicSubmission(submission, { videoBaseUrl }),
      pendingCount: store.listPending().length,
    });
  }

  function broadcastUpdated(submission) {
    chatRoom?.broadcastAll?.({
      type: "lineup_submission_updated",
      submission: store.toOwnerSubmission(submission, { videoBaseUrl }),
    });
  }

  function broadcastDeleted(submission) {
    chatRoom?.broadcastAll?.({
      type: "lineup_submission_deleted",
      submission: store.toPublicSubmission(submission, { videoBaseUrl }),
      pendingCount: store.listPending().length,
    });
  }

  function readSubmissionMetadata(payload = {}) {
    const metadata = {};
    if (payload.title != null) metadata.title = payload.title;
    if (payload.map != null) metadata.map = payload.map;
    if (payload.game != null) metadata.game = payload.game;
    if (payload.side != null) metadata.side = payload.side;
    if (payload.submitterName != null) metadata.submitterName = payload.submitterName;
    else if (payload.name != null) metadata.submitterName = payload.name;
    if (payload.difficulty != null) metadata.difficulty = payload.difficulty;
    if (payload.agent != null) metadata.agent = payload.agent;
    if (payload.ability != null) metadata.ability = payload.ability;
    if (payload.utility != null) metadata.utility = payload.utility;
    return metadata;
  }

  async function handleSubmit(req, res) {
    const corsOrigin = corsOriginFor(req);
    if (req.method === "OPTIONS") {
      sendOptions(res, corsOrigin);
      return true;
    }
    if (req.method !== "POST") return false;

    try {
      const { fields, files } = await parseMultipartRequest(req);
      const userId = String(fields.userId || "").trim();
      const submitterName = String(fields.submitterName || fields.name || "").trim();
      const authorId = String(fields.authorId || "").trim();

      if (!userId || !submitterName) {
        sendJson(res, 400, { error: "identity_required", message: "Set a display name and connect to chat before submitting." }, corsOrigin);
        return true;
      }
      if (!verifySubmitter(chatRoom, userId, submitterName)) {
        sendJson(res, 403, { error: "not_connected", message: "Join community chat with your display name before submitting a lineup." }, corsOrigin);
        return true;
      }
      if (chatRoom.isOwnerDisplayName?.(submitterName) && !verifyOwner(chatRoom, userId, submitterName)) {
        sendJson(res, 403, { error: "reserved_username", message: "That username is reserved." }, corsOrigin);
        return true;
      }

      const videoFile = files.find((file) => file.field === "video") || files[0];
      const result = store.createPendingSubmission(
        { ...fields, userId, submitterName, authorId },
        videoFile?.buffer,
        { mime: videoFile?.mime, originalName: videoFile?.filename },
      );

      if (result.error === "invalid_fields") {
        sendJson(res, 400, { error: result.error, message: "Fill in all required lineup details." }, corsOrigin);
        return true;
      }
      if (result.error === "missing_video") {
        sendJson(res, 400, { error: result.error, message: "Attach a lineup video." }, corsOrigin);
        return true;
      }
      if (result.error === "invalid_video_type") {
        sendJson(res, 400, { error: result.error, message: "Upload an MP4, WebM, or MOV video." }, corsOrigin);
        return true;
      }
      if (result.error === "video_too_large") {
        sendJson(res, 413, { error: result.error, message: "Video must be 100 MB or smaller." }, corsOrigin);
        return true;
      }

      notifyOwnersPending(result.submission);
      sendJson(
        res,
        201,
        {
          ok: true,
          message: "Lineup submitted for review. FuZiveer will approve it if it looks good.",
          submissionId: result.submission.id,
        },
        corsOrigin,
      );
      return true;
    } catch (error) {
      if (error.message === "too_large") {
        sendJson(res, 413, { error: "video_too_large", message: "Video must be 100 MB or smaller." }, corsOrigin);
        return true;
      }
      if (error.message === "invalid_content_type") {
        sendJson(res, 400, { error: "invalid_content_type", message: "Invalid upload format." }, corsOrigin);
        return true;
      }
      console.warn("Lineup submit failed:", error.message);
      sendJson(res, 500, { error: "server_error", message: "Could not save lineup submission." }, corsOrigin);
      return true;
    }
  }

  function handleCommunity(req, res) {
    const corsOrigin = corsOriginFor(req);
    if (req.method === "OPTIONS") {
      sendOptions(res, corsOrigin);
      return true;
    }
    if (req.method !== "GET") return false;

    const url = new URL(req.url || "/", "http://localhost");
    const game = url.searchParams.get("game") || "";
    const videoBaseUrl = resolveVideoBaseUrl(req);
    const lineups = store.listApproved(game).map((entry) => store.toPublicSubmission(entry, { videoBaseUrl }));

    sendJson(res, 200, { game, lineups }, corsOrigin);
    return true;
  }

  function handlePending(req, res) {
    const corsOrigin = corsOriginFor(req);
    if (req.method === "OPTIONS") {
      sendOptions(res, corsOrigin);
      return true;
    }
    if (req.method !== "GET") return false;

    const url = new URL(req.url || "/", "http://localhost");
    const userId = url.searchParams.get("userId") || "";
    const displayName = url.searchParams.get("name") || "";

    if (!verifyOwner(chatRoom, userId, displayName)) {
      sendJson(res, 403, { error: "forbidden", message: "Owner access required." }, corsOrigin);
      return true;
    }

    const videoBaseUrl = resolveVideoBaseUrl(req);
    const pending = store.listPending().map((entry) => store.toOwnerSubmission(entry, { videoBaseUrl }));
    sendJson(res, 200, { pending, pendingCount: pending.length }, corsOrigin);
    return true;
  }

  function handleManage(req, res) {
    const corsOrigin = corsOriginFor(req);
    if (req.method === "OPTIONS") {
      sendOptions(res, corsOrigin);
      return true;
    }
    if (req.method !== "GET") return false;

    const url = new URL(req.url || "/", "http://localhost");
    const userId = url.searchParams.get("userId") || "";
    const displayName = url.searchParams.get("name") || "";

    if (!verifyOwner(chatRoom, userId, displayName)) {
      sendJson(res, 403, { error: "forbidden", message: "Owner access required." }, corsOrigin);
      return true;
    }

    const videoBaseUrl = resolveVideoBaseUrl(req);
    const pending = store.listPending().map((entry) => store.toOwnerSubmission(entry, { videoBaseUrl }));
    const approved = store.listApprovedForOwner().map((entry) => store.toOwnerSubmission(entry, { videoBaseUrl }));
    sendJson(res, 200, { pending, approved, pendingCount: pending.length }, corsOrigin);
    return true;
  }

  function handleReview(req, res, id, action) {
    const corsOrigin = corsOriginFor(req);
    if (req.method === "OPTIONS") {
      sendOptions(res, corsOrigin);
      return true;
    }
    if (req.method !== "POST") return false;

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        sendJson(res, 400, { error: "invalid_json" }, corsOrigin);
        return;
      }

      const userId = String(payload.userId || "").trim();
      const displayName = String(payload.displayName || payload.name || "").trim();
      if (!verifyOwner(chatRoom, userId, displayName)) {
        sendJson(res, 403, { error: "forbidden", message: "Owner access required." }, corsOrigin);
        return;
      }

      const result = store.reviewSubmission(id, action, displayName, readSubmissionMetadata(payload));
      if (result.error) {
        sendJson(res, 404, { error: result.error, message: "Submission not found or already reviewed." }, corsOrigin);
        return;
      }

      broadcastReviewed(result.submission, action);
      if (action === "approve") {
        chatRoom?.notifyOwners?.({
          type: "lineup_submission_pending",
          pendingCount: store.listPending().length,
        });
      }

      sendJson(res, 200, { ok: true, submission: store.toOwnerSubmission(result.submission) }, corsOrigin);
    });
    return true;
  }

  function handleEdit(req, res, id) {
    const corsOrigin = corsOriginFor(req);
    if (req.method === "OPTIONS") {
      sendOptions(res, corsOrigin);
      return true;
    }
    if (req.method !== "POST") return false;

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        sendJson(res, 400, { error: "invalid_json" }, corsOrigin);
        return;
      }

      const userId = String(payload.userId || "").trim();
      const displayName = String(payload.displayName || payload.name || "").trim();
      if (!verifyOwner(chatRoom, userId, displayName)) {
        sendJson(res, 403, { error: "forbidden", message: "Owner access required." }, corsOrigin);
        return;
      }

      const result = store.updateSubmissionMetadata(id, readSubmissionMetadata(payload), displayName);
      if (result.error) {
        sendJson(res, 404, { error: result.error, message: "Submission not found." }, corsOrigin);
        return;
      }

      broadcastUpdated(result.submission);
      sendJson(res, 200, { ok: true, submission: store.toOwnerSubmission(result.submission) }, corsOrigin);
    });
    return true;
  }

  async function handleReplaceVideo(req, res, id) {
    const corsOrigin = corsOriginFor(req);
    if (req.method === "OPTIONS") {
      sendOptions(res, corsOrigin);
      return true;
    }
    if (req.method !== "POST") return false;

    try {
      const { fields, files } = await parseMultipartRequest(req);
      const userId = String(fields.userId || "").trim();
      const displayName = String(fields.displayName || fields.name || "").trim();
      if (!verifyOwner(chatRoom, userId, displayName)) {
        sendJson(res, 403, { error: "forbidden", message: "Owner access required." }, corsOrigin);
        return true;
      }

      const videoFile = files.find((file) => file.field === "video") || files[0];
      const result = store.replaceSubmissionVideo(
        id,
        videoFile?.buffer,
        { mime: videoFile?.mime, originalName: videoFile?.filename },
        displayName,
      );

      if (result.error === "missing_video") {
        sendJson(res, 400, { error: result.error, message: "Attach a lineup video." }, corsOrigin);
        return true;
      }
      if (result.error === "invalid_video_type") {
        sendJson(res, 400, { error: result.error, message: "Upload an MP4, WebM, or MOV video." }, corsOrigin);
        return true;
      }
      if (result.error === "video_too_large") {
        sendJson(res, 413, { error: result.error, message: "Video must be 100 MB or smaller." }, corsOrigin);
        return true;
      }
      if (result.error) {
        sendJson(res, 404, { error: result.error, message: "Submission not found." }, corsOrigin);
        return true;
      }

      broadcastUpdated(result.submission);
      sendJson(res, 200, { ok: true, submission: store.toOwnerSubmission(result.submission) }, corsOrigin);
      return true;
    } catch (error) {
      if (error.message === "too_large") {
        sendJson(res, 413, { error: "video_too_large", message: "Video must be 100 MB or smaller." }, corsOrigin);
        return true;
      }
      if (error.message === "invalid_content_type") {
        sendJson(res, 400, { error: "invalid_content_type", message: "Invalid upload format." }, corsOrigin);
        return true;
      }
      console.warn("Lineup video replace failed:", error.message);
      sendJson(res, 500, { error: "server_error", message: "Could not replace lineup video." }, corsOrigin);
      return true;
    }
  }

  function handleDelete(req, res, id) {
    const corsOrigin = corsOriginFor(req);
    if (req.method === "OPTIONS") {
      sendOptions(res, corsOrigin);
      return true;
    }
    if (req.method !== "POST") return false;

    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      let payload = {};
      try {
        payload = body ? JSON.parse(body) : {};
      } catch {
        sendJson(res, 400, { error: "invalid_json" }, corsOrigin);
        return;
      }

      const userId = String(payload.userId || "").trim();
      const displayName = String(payload.displayName || payload.name || "").trim();
      if (!verifyOwner(chatRoom, userId, displayName)) {
        sendJson(res, 403, { error: "forbidden", message: "Owner access required." }, corsOrigin);
        return;
      }

      const result = store.deleteSubmission(id, displayName);
      if (result.error) {
        sendJson(res, 404, { error: result.error, message: "Submission not found." }, corsOrigin);
        return;
      }

      broadcastDeleted(result.submission);
      sendJson(res, 200, { ok: true, submission: store.toPublicSubmission(result.submission) }, corsOrigin);
    });
    return true;
  }

  function handleVideo(req, res, id) {
    const corsOrigin = corsOriginFor(req);
    if (req.method !== "GET" && req.method !== "HEAD") return false;

    const filePath = store.getVideoPath(id);
    if (!filePath) {
      res.writeHead(404, { "Access-Control-Allow-Origin": corsOrigin });
      res.end("Not Found");
      return true;
    }

    streamVideoFile(req, res, filePath, { corsOrigin, cacheControl: "public, max-age=86400" });
    return true;
  }

  function handlePendingPreview(req, res, id) {
    const corsOrigin = corsOriginFor(req);
    if (req.method !== "GET" && req.method !== "HEAD") return false;

    const entry = store.getById(id);
    if (!entry || entry.status !== "pending") {
      res.writeHead(404, { "Access-Control-Allow-Origin": corsOrigin });
      res.end("Not Found");
      return true;
    }

    const url = new URL(req.url || "/", "http://localhost");
    const userId = url.searchParams.get("userId") || "";
    const displayName = url.searchParams.get("name") || "";
    const isSubmitter = verifySubmitter(chatRoom, userId, displayName) && entry.submittedBy.userId === userId;
    if (!verifyOwner(chatRoom, userId, displayName) && !isSubmitter) {
      res.writeHead(403, { "Access-Control-Allow-Origin": corsOrigin });
      res.end("Forbidden");
      return true;
    }

    const filePath = path.join(store.uploadsDir, entry.videoFilename);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404, { "Access-Control-Allow-Origin": corsOrigin });
      res.end("Not Found");
      return true;
    }

    streamVideoFile(req, res, filePath, { corsOrigin, cacheControl: "no-store" });
    return true;
  }

  return {
    handleRequest(req, res, pathname) {
      if (pathname === "/lineups/submit") return handleSubmit(req, res);
      if (pathname === "/lineups/community") return handleCommunity(req, res);
      if (pathname === "/lineups/submissions/pending") return handlePending(req, res);
      if (pathname === "/lineups/submissions/manage") return handleManage(req, res);

      const editMatch = pathname.match(/^\/lineups\/submissions\/([^/]+)\/edit$/);
      if (editMatch) return handleEdit(req, res, editMatch[1]);

      const replaceVideoMatch = pathname.match(/^\/lineups\/submissions\/([^/]+)\/video$/);
      if (replaceVideoMatch) return handleReplaceVideo(req, res, replaceVideoMatch[1]);

      const deleteMatch = pathname.match(/^\/lineups\/submissions\/([^/]+)\/delete$/);
      if (deleteMatch) return handleDelete(req, res, deleteMatch[1]);

      const reviewMatch = pathname.match(/^\/lineups\/submissions\/([^/]+)\/(approve|reject)$/);
      if (reviewMatch) return handleReview(req, res, reviewMatch[1], reviewMatch[2]);

      const videoMatch = pathname.match(/^\/lineups\/video\/([^/]+)$/);
      if (videoMatch) return handleVideo(req, res, videoMatch[1]);

      const previewMatch = pathname.match(/^\/lineups\/submissions\/([^/]+)\/preview$/);
      if (previewMatch) return handlePendingPreview(req, res, previewMatch[1]);

      return false;
    },
    reviewSubmissionViaWs(id, action, reviewerName, metadata = {}) {
      const result = store.reviewSubmission(id, action, reviewerName, metadata);
      if (result.error) return result;
      broadcastReviewed(result.submission, action);
      if (action === "approve") {
        chatRoom?.notifyOwners?.({
          type: "lineup_submission_pending",
          pendingCount: store.listPending().length,
        });
      }
      return result;
    },
    editSubmissionViaWs(id, metadata, editorName) {
      const result = store.updateSubmissionMetadata(id, metadata, editorName);
      if (result.error) return result;
      broadcastUpdated(result.submission);
      return result;
    },
    deleteSubmissionViaWs(id, deleterName) {
      const result = store.deleteSubmission(id, deleterName);
      if (result.error) return result;
      broadcastDeleted(result.submission);
      return result;
    },
    listPendingForOwner() {
      return store.listPending();
    },
    listApprovedForOwner() {
      return store.listApprovedForOwner();
    },
    toOwnerSubmission(entry, overrideBaseUrl = "") {
      const base = String(overrideBaseUrl || videoBaseUrl || "").replace(/\/$/, "");
      return store.toOwnerSubmission(entry, { videoBaseUrl: base });
    },
  };
}

module.exports = { createLineupSubmissionsRoutes };
