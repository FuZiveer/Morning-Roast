/** Shared account auth for Morning Roast: token + user state, REST calls, pub/sub. */
(function (global) {
  const TOKEN_KEY = "mrAuthToken";

  function resolveApiUrl() {
    const meta = document.querySelector('meta[name="morning-roast-api"]')?.content?.trim();
    if (meta) return meta.replace(/\/$/, "");

    const host = global.location?.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      const protocol = global.location?.protocol === "https:" ? "https" : "http";
      return `${protocol}://${host}:8080`;
    }

    return "";
  }

  const apiUrl = resolveApiUrl();

  function loadToken() {
    try {
      return localStorage.getItem(TOKEN_KEY) || "";
    } catch {
      return "";
    }
  }

  function saveToken(value) {
    try {
      if (value) localStorage.setItem(TOKEN_KEY, value);
      else localStorage.removeItem(TOKEN_KEY);
    } catch {
      /* ignore */
    }
  }

  let token = loadToken();
  /** @type {{ username: string, email?: string, verified?: boolean } | null} */
  let user = null;
  let refreshing = null;

  /** @type {Set<(state: object) => void>} */
  const listeners = new Set();

  function getState() {
    return {
      available: Boolean(apiUrl),
      authed: Boolean(token && user),
      hasToken: Boolean(token),
      token,
      user,
      apiUrl,
    };
  }

  function notify() {
    const snapshot = getState();
    listeners.forEach((fn) => {
      try {
        fn(snapshot);
      } catch {
        /* ignore listener errors */
      }
    });
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    try {
      fn(getState());
    } catch {
      /* ignore */
    }
    return () => listeners.delete(fn);
  }

  function fallbackError(status, fallback) {
    if (status === 404) {
      return "Account API not found — the server may need redeploying with the latest auth code.";
    }
    if (status === 503) {
      return "Accounts are unavailable right now (server not fully configured).";
    }
    if (status >= 500) {
      return "Server error. Try again in a moment.";
    }
    return fallback;
  }

  async function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (options.body) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${apiUrl}${path}`, { ...options, headers });
    let json = {};
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    return { ok: res.ok, status: res.status, json };
  }

  function setToken(next) {
    token = next || "";
    saveToken(token);
  }

  function clearSession() {
    setToken("");
    user = null;
    notify();
  }

  /** Validate the stored token and hydrate the user profile. */
  async function refresh() {
    if (!apiUrl) {
      return false;
    }
    if (!token) {
      if (user) {
        user = null;
        notify();
      }
      return false;
    }
    if (refreshing) return refreshing;

    refreshing = (async () => {
      try {
        const { ok, json } = await apiFetch("/auth/me", { method: "GET" });
        if (ok && json?.username) {
          user = { username: json.username, email: json.email, verified: json.verified };
          notify();
          return true;
        }
        // Token is invalid/expired server-side.
        clearSession();
        return false;
      } catch {
        // Network error — keep the token so we can retry, but report current state.
        return Boolean(user);
      } finally {
        refreshing = null;
      }
    })();

    return refreshing;
  }

  async function login(email, password) {
    if (!apiUrl) return { ok: false, error: "Accounts are unavailable right now." };
    try {
      const { ok, status, json } = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (ok && json?.token) {
        setToken(json.token);
        user = { username: json.username };
        notify();
        // Hydrate email/verified in the background.
        refresh();
        return { ok: true };
      }
      return {
        ok: false,
        error: json?.error || fallbackError(status, "Login failed."),
        needsVerification: status === 403 && Boolean(json?.needsVerification),
      };
    } catch {
      return { ok: false, error: "Network error. Try again." };
    }
  }

  async function register(username, email, password) {
    if (!apiUrl) return { ok: false, error: "Accounts are unavailable right now." };
    try {
      const { ok, status, json } = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username, email, password }),
      });
      if (ok) {
        return { ok: true, message: json?.message || "Check your email for a verification link." };
      }
      return { ok: false, error: json?.error || fallbackError(status, "Sign up failed.") };
    } catch {
      return { ok: false, error: "Network error. Try again." };
    }
  }

  async function resend(email) {
    if (!apiUrl) return { ok: false, error: "Accounts are unavailable right now." };
    try {
      const { json } = await apiFetch("/auth/resend", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      return { ok: true, message: json?.message || "Verification email sent." };
    } catch {
      return { ok: false, error: "Network error. Try again." };
    }
  }

  function logout() {
    clearSession();
  }

  global.MorningRoastAuth = {
    subscribe,
    getState,
    isAuthed: () => Boolean(token && user),
    hasToken: () => Boolean(token),
    getToken: () => token,
    getUser: () => user,
    refresh,
    login,
    register,
    resend,
    logout,
    apiFetch,
    apiUrl,
  };
})(window);
