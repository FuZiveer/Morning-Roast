const AI_URL = process.env.POLLINATIONS_AI_URL || "https://text.pollinations.ai/openai";
const AI_MODEL = process.env.POLLINATIONS_MODEL || "openai-fast";
const API_KEY = process.env.POLLINATIONS_API_KEY || "";
const MIN_GAP_MS = Number(process.env.ASSISTANT_MIN_GAP_MS) || 4000;
const MAX_BODY_BYTES = 24000;

const lastRequestByIp = new Map();

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

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

function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((entry) => entry && (entry.role === "system" || entry.role === "user" || entry.role === "assistant"))
    .slice(-20)
    .map((entry) => ({
      role: entry.role,
      content: String(entry.content || "").slice(0, 4000),
    }))
    .filter((entry) => entry.content.trim());
}

function checkRateLimit(ip) {
  const now = Date.now();
  const last = lastRequestByIp.get(ip) || 0;
  if (now - last < MIN_GAP_MS) {
    return false;
  }
  lastRequestByIp.set(ip, now);
  return true;
}

async function forwardToPollinations(payload) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

  const response = await fetch(AI_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: AI_MODEL,
      messages: payload.messages,
      temperature: payload.temperature,
      max_tokens: payload.max_tokens,
    }),
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = new Error(data?.error?.message || data?.message || `Upstream AI failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  const answer = data?.choices?.[0]?.message?.content?.trim();
  if (!answer) {
    const error = new Error("Empty AI response");
    error.status = 502;
    throw error;
  }

  return answer;
}

function createAssistantHandler({ isOriginAllowed }) {
  return async function handleAssistantRequest(req, res) {
    const origin = req.headers.origin;
    const corsOrigin = origin && isOriginAllowed(origin) ? origin.replace(/\/$/, "") : null;

    if (req.method === "OPTIONS") {
      if (!corsOrigin) {
        res.writeHead(403);
        res.end();
        return;
      }
      res.writeHead(204, {
        "Access-Control-Allow-Origin": corsOrigin,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "86400",
      });
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {});
      res.end("Method Not Allowed");
      return;
    }

    if (!corsOrigin) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const ip = getClientIp(req);
    if (!checkRateLimit(ip)) {
      res.writeHead(429, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": corsOrigin,
      });
      res.end(JSON.stringify({ error: "Too many requests — wait a moment and try again." }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const messages = sanitizeMessages(body.messages);
      if (!messages.some((entry) => entry.role === "user")) {
        res.writeHead(400, {
          "Content-Type": "application/json; charset=utf-8",
          "Access-Control-Allow-Origin": corsOrigin,
        });
        res.end(JSON.stringify({ error: "Missing user message" }));
        return;
      }

      const answer = await forwardToPollinations({
        messages,
        temperature: Math.min(1, Math.max(0, Number(body.temperature ?? 0.7))),
        max_tokens: Math.min(700, Math.max(64, Number(body.max_tokens ?? 500))),
      });

      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": corsOrigin,
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: answer } }] }));
    } catch (error) {
      const status = error.status === 429 ? 429 : error.status === 402 ? 402 : error.status === 400 ? 400 : 502;
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": corsOrigin,
      });
      res.end(JSON.stringify({ error: error.message || "Assistant unavailable" }));
    }
  };
}

module.exports = {
  createAssistantHandler,
};
