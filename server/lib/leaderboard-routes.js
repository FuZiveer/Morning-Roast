const MAX_BODY_BYTES = 8192;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}

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

function createLeaderboardRoutes({ store, getCorsOrigin }) {
  function handleRequest(req, res, pathname) {
    const corsOrigin = getCorsOrigin(req) || "*";

    if (pathname === "/leaderboard") {
      if (req.method === "OPTIONS") {
        sendOptions(res, corsOrigin);
        return true;
      }

      if (req.method !== "GET") {
        sendJson(res, 405, { error: "method_not_allowed" }, corsOrigin);
        return true;
      }

      const url = new URL(req.url || "/", "http://localhost");
      const game = url.searchParams.get("game") || "";
      const mode = url.searchParams.get("mode") || "";
      const timer = url.searchParams.get("timer") || "";
      const userId = url.searchParams.get("userId") || "";
      const result = store.getLeaderboard(game, mode, timer, { userId: userId || null });

      if (result.error) {
        sendJson(res, 400, result, corsOrigin);
        return true;
      }

      sendJson(res, 200, result, corsOrigin);
      return true;
    }

    if (pathname === "/leaderboard/submit") {
      if (req.method === "OPTIONS") {
        sendOptions(res, corsOrigin);
        return true;
      }

      if (req.method !== "POST") {
        sendJson(res, 405, { error: "method_not_allowed" }, corsOrigin);
        return true;
      }

      readJsonBody(req)
        .then((body) => {
          const result = store.submitScore(body || {});
          if (result.error === "rate_limited") {
            sendJson(res, 429, result, corsOrigin);
            return;
          }
          if (result.error) {
            sendJson(res, 400, result, corsOrigin);
            return;
          }
          sendJson(res, 200, result, corsOrigin);
        })
        .catch((error) => {
          const message = error?.message === "Payload too large" ? "payload_too_large" : "invalid_json";
          sendJson(res, 400, { error: message }, corsOrigin);
        });

      return true;
    }

    return false;
  }

  return { handleRequest };
}

module.exports = { createLeaderboardRoutes };
