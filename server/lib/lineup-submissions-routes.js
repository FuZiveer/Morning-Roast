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

function verifySubmitter(chatRoom, userId, submitterName) {
  if (!chatRoom?.verifyClientIdentity) return false;
  return chatRoom.verifyClientIdentity(userId, submitterName);
}

function verifyOwner(chatRoom, userId, displayName) {
  if (!chatRoom?.verifyOwnerIdentity) return false;
  return chatRoom.verifyOwnerIdentity(userId, displayName);
}

function createLineupSubmissionsRoutes({ chatRoom, store, corsOrigin = "*" }) {
  function notifyOwnersPending(submission) {
    chatRoom?.notifyOwners?.({
      type: "lineup_submission_pending",
      submission: store.toOwnerSubmission(submission, { videoBaseUrl: "" }),
      pendingCount: store.listPending().length,
    });
  }

  function broadcastReviewed(submission, action) {
    chatRoom?.broadcastAll?.({
      type: "lineup_submission_reviewed",
      action,
      submission: store.toPublicSubmission(submission, { videoBaseUrl: "" }),
      pendingCount: store.listPending().length,
    });
  }

  async function handleSubmit(req, res) {
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
        sendJson(res, 413, { error: result.error, message: "Video must be 50 MB or smaller." }, corsOrigin);
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
        sendJson(res, 413, { error: "video_too_large", message: "Video must be 50 MB or smaller." }, corsOrigin);
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

  function handleReview(req, res, id, action) {
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

      const result = store.reviewSubmission(id, action, displayName);
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

  function handleVideo(req, res, id) {
    if (req.method !== "GET") return false;

    const filePath = store.getVideoPath(id);
    if (!filePath) {
      res.writeHead(404, { "Access-Control-Allow-Origin": corsOrigin });
      res.end("Not Found");
      return true;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : "video/mp4";

    res.writeHead(200, {
      "Content-Type": mime,
      "Access-Control-Allow-Origin": corsOrigin,
      "Cache-Control": "public, max-age=86400",
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  function handlePendingPreview(req, res, id) {
    if (req.method !== "GET") return false;

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

    const ext = path.extname(filePath).toLowerCase();
    const mime =
      ext === ".webm" ? "video/webm" : ext === ".mov" ? "video/quicktime" : "video/mp4";

    res.writeHead(200, {
      "Content-Type": mime,
      "Access-Control-Allow-Origin": corsOrigin,
      "Cache-Control": "no-store",
    });
    fs.createReadStream(filePath).pipe(res);
    return true;
  }

  return {
    handleRequest(req, res, pathname) {
      if (pathname === "/lineups/submit") return handleSubmit(req, res);
      if (pathname === "/lineups/community") return handleCommunity(req, res);
      if (pathname === "/lineups/submissions/pending") return handlePending(req, res);

      const reviewMatch = pathname.match(/^\/lineups\/submissions\/([^/]+)\/(approve|reject)$/);
      if (reviewMatch) return handleReview(req, res, reviewMatch[1], reviewMatch[2]);

      const videoMatch = pathname.match(/^\/lineups\/video\/([^/]+)$/);
      if (videoMatch) return handleVideo(req, res, videoMatch[1]);

      const previewMatch = pathname.match(/^\/lineups\/submissions\/([^/]+)\/preview$/);
      if (previewMatch) return handlePendingPreview(req, res, previewMatch[1]);

      return false;
    },
    reviewSubmissionViaWs(id, action, reviewerName) {
      const result = store.reviewSubmission(id, action, reviewerName);
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
    listPendingForOwner() {
      return store.listPending();
    },
    toOwnerSubmission(entry, videoBaseUrl = "") {
      return store.toOwnerSubmission(entry, { videoBaseUrl });
    },
  };
}

module.exports = { createLineupSubmissionsRoutes };
