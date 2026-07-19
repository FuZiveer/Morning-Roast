/**
 * Account auth for Morning Roast: register, verify, login, me, resend.
 *
 * Env:
 *   JWT_SECRET=<long random string>
 *   PUBLIC_API_URL=https://your-api.onrender.com   (used to build verify links)
 *   PUBLIC_SITE_URL=https://your-site.example       (verify redirect target)
 *   VERIFY_TOKEN_TTL_HOURS=24 (optional)
 *   JWT_TTL_DAYS=7 (optional)
 */
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");
const mailer = require("./mailer");

const JWT_SECRET = process.env.JWT_SECRET || "";
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || "").replace(/\/$/, "");
const PUBLIC_SITE_URL = (process.env.PUBLIC_SITE_URL || "").replace(/\/$/, "");
const VERIFY_TTL_HOURS = Number(process.env.VERIFY_TOKEN_TTL_HOURS) || 24;
const JWT_TTL_DAYS = Number(process.env.JWT_TTL_DAYS) || 7;
const BCRYPT_COST = 12;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;

function isConfigured() {
  return Boolean(JWT_SECRET && db.isEnabled());
}

// --- Basic per-IP rate limiting -------------------------------------------
const rateBuckets = new Map();

function rateLimited(ip, action, max, windowMs) {
  const key = `${action}:${ip || "unknown"}`;
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.reset) {
    rateBuckets.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  bucket.count += 1;
  return bucket.count > max;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now > bucket.reset) rateBuckets.delete(key);
  }
}, 5 * 60 * 1000).unref?.();

// --- Helpers ---------------------------------------------------------------
function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function signToken(user) {
  return jwt.sign({ uid: user.id, username: user.username }, JWT_SECRET, {
    expiresIn: `${JWT_TTL_DAYS}d`,
  });
}

function verifyAuthToken(token) {
  if (!JWT_SECRET || !token) return null;
  try {
    const payload = jwt.verify(String(token), JWT_SECRET);
    if (!payload?.uid || !payload?.username) return null;
    return { userId: payload.uid, username: payload.username };
  } catch {
    return null;
  }
}

function bearerToken(authHeader) {
  const value = String(authHeader || "");
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function buildVerifyLink(token) {
  const base = PUBLIC_API_URL || "";
  return `${base}/auth/verify?token=${encodeURIComponent(token)}`;
}

function verifyRedirectUrl(status) {
  const base = PUBLIC_SITE_URL || "/";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}verified=${status}`;
}

async function issueVerification(user) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = sha256(rawToken);
  const expires = new Date(Date.now() + VERIFY_TTL_HOURS * 60 * 60 * 1000);
  await db.query(
    `UPDATE users SET verify_token_hash = $1, verify_expires = $2 WHERE id = $3`,
    [tokenHash, expires, user.id]
  );
  await mailer.sendVerifyEmail(user.email, user.username, buildVerifyLink(rawToken));
}

// --- Route handlers --------------------------------------------------------
// Each returns { status, json } or { status, redirect }.

async function register(body, ip) {
  if (!isConfigured() || !mailer.isEnabled()) {
    return { status: 503, json: { error: "Accounts are not available right now." } };
  }
  if (rateLimited(ip, "register", 5, 60 * 60 * 1000)) {
    return { status: 429, json: { error: "Too many attempts. Try again later." } };
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const username = String(body?.username || "").trim();
  const password = String(body?.password || "");

  if (!EMAIL_RE.test(email)) {
    return { status: 400, json: { error: "Enter a valid email address." } };
  }
  if (!USERNAME_RE.test(username)) {
    return {
      status: 400,
      json: { error: "Username must be 3-20 letters, numbers, or underscores." },
    };
  }
  if (password.length < 8 || password.length > 200) {
    return { status: 400, json: { error: "Password must be at least 8 characters." } };
  }

  const existing = await db.query(
    `SELECT id, verified FROM users WHERE lower(email) = $1 OR lower(username) = $2`,
    [email, username.toLowerCase()]
  );

  if (existing.rows.length > 0) {
    // Avoid leaking which field collided. If an unverified account matches both
    // email + username exactly, quietly re-send its verification email.
    const match = await db.query(
      `SELECT id, email, username FROM users WHERE lower(email) = $1 AND lower(username) = $2 AND verified = false`,
      [email, username.toLowerCase()]
    );
    if (match.rows.length === 1) {
      try {
        await issueVerification(match.rows[0]);
      } catch {
        /* ignore mail errors to avoid enumeration */
      }
    }
    return {
      status: 200,
      json: { ok: true, message: "If that account is available, a verification email was sent." },
    };
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
  const id = crypto.randomUUID();
  const user = { id, email, username };

  await db.query(
    `INSERT INTO users (id, email, username, password_hash, verified) VALUES ($1, $2, $3, $4, false)`,
    [id, email, username, passwordHash]
  );

  try {
    await issueVerification(user);
  } catch (err) {
    console.error("[auth] verification email failed:", err.message);
    return {
      status: 502,
      json: { error: "Account created but the verification email failed to send. Try Resend." },
    };
  }

  return {
    status: 200,
    json: { ok: true, message: "Check your email for a verification link." },
  };
}

async function verify(token) {
  if (!isConfigured()) {
    return { status: 503, json: { error: "Accounts are not available right now." } };
  }
  const tokenHash = sha256(String(token || ""));
  if (!token) {
    return { status: 302, redirect: verifyRedirectUrl(0) };
  }

  const result = await db.query(
    `SELECT id, verify_expires FROM users
       WHERE verify_token_hash = $1 AND verified = false
       LIMIT 1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row || !row.verify_expires || new Date(row.verify_expires).getTime() < Date.now()) {
    return { status: 302, redirect: verifyRedirectUrl(0) };
  }

  await db.query(
    `UPDATE users SET verified = true, verify_token_hash = NULL, verify_expires = NULL WHERE id = $1`,
    [row.id]
  );

  return { status: 302, redirect: verifyRedirectUrl(1) };
}

async function login(body, ip) {
  if (!isConfigured()) {
    return { status: 503, json: { error: "Accounts are not available right now." } };
  }
  if (rateLimited(ip, "login", 10, 15 * 60 * 1000)) {
    return { status: 429, json: { error: "Too many attempts. Try again later." } };
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const password = String(body?.password || "");
  if (!email || !password) {
    return { status: 400, json: { error: "Email and password are required." } };
  }

  const result = await db.query(
    `SELECT id, email, username, password_hash, verified FROM users WHERE lower(email) = $1 LIMIT 1`,
    [email]
  );
  const user = result.rows[0];

  // Constant-ish path: always run a compare to reduce timing signal.
  const hash = user?.password_hash || "$2a$12$0000000000000000000000000000000000000000000000000000";
  const passwordOk = await bcrypt.compare(password, hash);

  if (!user || !passwordOk) {
    return { status: 401, json: { error: "Invalid email or password." } };
  }
  if (!user.verified) {
    return { status: 403, json: { error: "Please verify your email first.", needsVerification: true } };
  }

  const token = signToken(user);
  return { status: 200, json: { token, username: user.username } };
}

async function me(authHeader) {
  if (!isConfigured()) {
    return { status: 503, json: { error: "Accounts are not available right now." } };
  }
  const auth = verifyAuthToken(bearerToken(authHeader));
  if (!auth) {
    return { status: 401, json: { error: "Not authenticated." } };
  }

  const result = await db.query(
    `SELECT email, username, verified FROM users WHERE id = $1 LIMIT 1`,
    [auth.userId]
  );
  const user = result.rows[0];
  if (!user) {
    return { status: 401, json: { error: "Not authenticated." } };
  }

  return {
    status: 200,
    json: { email: user.email, username: user.username, verified: user.verified },
  };
}

async function resend(body, ip) {
  if (!isConfigured() || !mailer.isEnabled()) {
    return { status: 503, json: { error: "Accounts are not available right now." } };
  }
  if (rateLimited(ip, "resend", 4, 60 * 60 * 1000)) {
    return { status: 429, json: { error: "Too many attempts. Try again later." } };
  }

  const email = String(body?.email || "").trim().toLowerCase();
  if (EMAIL_RE.test(email)) {
    const result = await db.query(
      `SELECT id, email, username FROM users WHERE lower(email) = $1 AND verified = false LIMIT 1`,
      [email]
    );
    const user = result.rows[0];
    if (user) {
      try {
        await issueVerification(user);
      } catch (err) {
        console.error("[auth] resend email failed:", err.message);
      }
    }
  }

  return {
    status: 200,
    json: { ok: true, message: "If that account needs verification, a new email was sent." },
  };
}

module.exports = {
  isConfigured,
  verifyAuthToken,
  register,
  verify,
  login,
  me,
  resend,
};
