/** Peer live chat with account auth via WebSocket + REST. */
(function (global) {
  const RECONNECT_BASE_MS = 1500;
  const RECONNECT_MAX_MS = 30000;
  const MAX_TEXT = 500;

  /** @type {{ api: object } | null} */
  let activeSession = null;

  function resolveWsUrl() {
    const meta = document.querySelector('meta[name="morning-roast-chat-ws"]')?.content?.trim();
    if (meta) return meta;

    const host = global.location?.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      const protocol = global.location?.protocol === "https:" ? "wss" : "ws";
      return `${protocol}://${host}:8080/chat`;
    }

    return "";
  }

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

  function socketConnectingOrOpen(ws) {
    return ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(ts) {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function initLiveChat(root = document.getElementById("live-chat")) {
    if (!root || initLiveChat._init) return activeSession?.api || null;
    initLiveChat._init = true;

    const url = resolveWsUrl();
    const auth = global.MorningRoastAuth || null;

    const panel = root.querySelector("#live-chat-panel");
    const toggle = root.querySelector("#live-chat-toggle");
    const closeBtn = root.querySelector("#live-chat-close");
    const messagesEl = root.querySelector("#live-chat-messages");
    const form = root.querySelector("#live-chat-form");
    const input = root.querySelector("#live-chat-input");
    const sendBtn = root.querySelector("#live-chat-send");
    const statusEl = root.querySelector("#live-chat-status");
    const subtitleEl = root.querySelector("#live-chat-subtitle");
    const offlineEl = root.querySelector("#live-chat-offline");
    const replyBar = root.querySelector("#live-chat-reply-bar");
    const replyLabel = root.querySelector("#live-chat-reply-label");
    const replyCancel = root.querySelector("#live-chat-reply-cancel");

    // Auth UI
    const accountBar = root.querySelector("#live-chat-account");
    const accountName = root.querySelector("#live-chat-account-name");
    const logoutBtn = root.querySelector("#live-chat-logout");
    const authGate = root.querySelector("#live-chat-auth");
    const authTabs = root.querySelectorAll("[data-auth-tab]");
    const loginForm = root.querySelector("#live-chat-login-form");
    const signupForm = root.querySelector("#live-chat-signup-form");
    const authMessage = root.querySelector("#live-chat-auth-message");
    const resendBtn = root.querySelector("#live-chat-resend");
    const loginEmail = root.querySelector("#live-chat-login-email");
    const loginPassword = root.querySelector("#live-chat-login-password");
    const signupUsername = root.querySelector("#live-chat-signup-username");
    const signupEmail = root.querySelector("#live-chat-signup-email");
    const signupPassword = root.querySelector("#live-chat-signup-password");

    if (!panel || !toggle || !messagesEl || !form || !input || !sendBtn) return null;

    let ws = null;
    let reconnectMs = RECONNECT_BASE_MS;
    let reconnectTimer = null;
    let closedByUser = false;
    let intentionalClose = false;
    let connected = false;
    let replyTo = null;
    let token = auth?.getToken?.() || "";
    let username = auth?.isAuthed?.() ? auth.getUser()?.username || null : null;
    let lastLoginEmail = "";
    /** @type {Map<string, object>} */
    const messageMap = new Map();
    let stickToBottom = true;

    const authAvailable = Boolean(auth?.getState?.().available);

    const setStatus = (state, detail = "") => {
      root.classList.remove("is-live", "is-connecting", "is-offline", "is-disabled");
      if (state) root.classList.add(`is-${state}`);
      if (statusEl) statusEl.title = detail || state || "";
      if (subtitleEl) {
        if (state === "live") subtitleEl.textContent = username ? `Signed in as ${username}` : "Chat with other visitors";
        else if (state === "connecting") subtitleEl.textContent = "Connecting…";
        else if (state === "disabled") subtitleEl.textContent = "Chat unavailable";
        else subtitleEl.textContent = "Reconnecting…";
      }
      if (offlineEl) offlineEl.hidden = state === "live" || state === "connecting";
      syncFormState();
    };

    const syncFormState = () => {
      const canSend = connected && Boolean(username) && input.value.trim().length > 0;
      sendBtn.disabled = !canSend;
    };

    const syncAuthUi = () => {
      const authed = Boolean(username);
      if (accountBar) accountBar.hidden = !authed;
      if (accountName) accountName.textContent = username || "—";
      if (form) form.hidden = !authed;
      if (authGate) authGate.hidden = authed || !authAvailable;
      if (subtitleEl && root.classList.contains("is-live")) {
        subtitleEl.textContent = authed ? `Signed in as ${username}` : "Chat with other visitors";
      }
      syncFormState();
    };

    const setAuthMessage = (text, kind = "info") => {
      if (!authMessage) return;
      authMessage.textContent = text || "";
      authMessage.classList.remove("is-error", "is-success");
      if (kind === "error") authMessage.classList.add("is-error");
      else if (kind === "success") authMessage.classList.add("is-success");
    };

    const cleanupReconnect = () => {
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      cleanupReconnect();
      if (closedByUser || !url || document.hidden) return;
      reconnectTimer = global.setTimeout(connect, reconnectMs);
      reconnectMs = Math.min(Math.round(reconnectMs * 1.5), RECONNECT_MAX_MS);
    };

    const teardownSocket = () => {
      if (!ws) return;
      const socket = ws;
      ws = null;
      connected = false;
      intentionalClose = true;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    };

    const sendPayload = (payload) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return false;
      ws.send(JSON.stringify(payload));
      return true;
    };

    const sendHello = () => {
      sendPayload({ type: "hello", token: token || undefined });
    };

    const clearReply = () => {
      replyTo = null;
      if (replyBar) replyBar.hidden = true;
    };

    const setReply = (message) => {
      if (!message || message.deleted || !username) return;
      replyTo = message.id;
      if (replyBar && replyLabel) {
        replyLabel.textContent = `Replying to ${message.name}: ${message.text.slice(0, 80)}`;
        replyBar.hidden = false;
      }
      input.focus();
    };

    const scrollToBottom = () => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    const renderMessageActions = (message, isOwn) => {
      const actions = document.createElement("div");
      actions.className = "live-chat-message-actions";

      if (username) {
        const replyBtn = document.createElement("button");
        replyBtn.type = "button";
        replyBtn.className = "live-chat-action-btn";
        replyBtn.setAttribute("aria-label", "Reply");
        replyBtn.innerHTML = '<i class="ri-reply-line" aria-hidden="true"></i><span>Reply</span>';
        replyBtn.addEventListener("click", () => setReply(message));
        actions.appendChild(replyBtn);
      }

      if (isOwn && !message.deleted) {
        const deleteBtn = document.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.className = "live-chat-action-btn live-chat-action-btn--danger";
        deleteBtn.setAttribute("aria-label", "Delete message");
        deleteBtn.innerHTML = '<i class="ri-delete-bin-line" aria-hidden="true"></i><span>Delete</span>';
        deleteBtn.addEventListener("click", () => {
          sendPayload({ type: "delete", messageId: message.id });
        });
        actions.appendChild(deleteBtn);
      }

      return actions;
    };

    const renderMessage = (message) => {
      const existing = messagesEl.querySelector(`[data-message-id="${message.id}"]`);
      const isOwn = Boolean(username) && message.name === username;
      const item = existing || document.createElement("article");
      item.className = `live-chat-message${isOwn ? " is-own" : ""}${message.deleted ? " is-deleted" : ""}`;
      item.dataset.messageId = message.id;

      const meta = document.createElement("div");
      meta.className = "live-chat-message-meta";
      meta.innerHTML = `<span class="live-chat-message-name">${escapeHtml(message.name)}</span><time class="live-chat-message-time" datetime="${new Date(message.createdAt).toISOString()}">${escapeHtml(formatTime(message.createdAt))}</time>`;

      const body = document.createElement("div");
      body.className = "live-chat-message-body";

      if (message.replyPreview && !message.deleted) {
        const quote = document.createElement("div");
        quote.className = "live-chat-message-quote";
        quote.innerHTML = `<span class="live-chat-message-quote-name">${escapeHtml(message.replyPreview.name)}</span><span class="live-chat-message-quote-text">${escapeHtml(message.replyPreview.text)}</span>`;
        body.appendChild(quote);
      }

      const text = document.createElement("p");
      text.className = "live-chat-message-text";
      text.textContent = message.deleted ? "Message deleted" : message.text;
      body.appendChild(text);

      if (message.deleted) {
        item.replaceChildren(meta, body);
      } else {
        item.replaceChildren(meta, body, renderMessageActions(message, isOwn));
      }

      if (!existing) {
        messagesEl.appendChild(item);
      }

      return item;
    };

    const upsertMessage = (message, { scroll = true } = {}) => {
      if (!message?.id) return;
      messageMap.set(message.id, message);
      renderMessage(message);
      if (scroll && stickToBottom) scrollToBottom();
    };

    const rerenderAll = () => {
      messagesEl.replaceChildren();
      for (const message of messageMap.values()) renderMessage(message);
      scrollToBottom();
    };

    const markDeleted = (messageId) => {
      const message = messageMap.get(messageId);
      if (!message) return;
      message.deleted = true;
      message.text = "";
      upsertMessage(message, { scroll: stickToBottom });
    };

    const bindSocket = (socket) => {
      socket.addEventListener("open", () => {
        connected = true;
        reconnectMs = RECONNECT_BASE_MS;
        sendHello();
        setStatus("live");
      });

      socket.addEventListener("message", (event) => {
        let data;
        try {
          data = JSON.parse(String(event.data || ""));
        } catch {
          return;
        }

        if (data?.type === "history" && Array.isArray(data.messages)) {
          messagesEl.replaceChildren();
          messageMap.clear();
          data.messages.forEach((message) => upsertMessage(message, { scroll: false }));
          scrollToBottom();
          return;
        }

        if (data?.type === "chat" && data.message) {
          upsertMessage(data.message);
          return;
        }

        if (data?.type === "deleted" && data.messageId) {
          markDeleted(String(data.messageId));
          return;
        }

        if (data?.type === "authed" && data.username) {
          if (username !== data.username) {
            username = data.username;
            syncAuthUi();
            rerenderAll();
          }
          return;
        }

        if (data?.type === "error" && data.message) {
          // Session likely expired server-side: drop local auth so the user re-logs in.
          if (/log in|session/i.test(data.message) && username) {
            auth?.logout();
          }
          setAuthMessage(data.message, "error");
        }
      });

      socket.addEventListener("close", () => {
        if (ws !== socket) {
          intentionalClose = false;
          return;
        }
        ws = null;
        connected = false;
        if (intentionalClose) {
          intentionalClose = false;
          return;
        }
        setStatus("offline");
        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        if (ws !== socket) return;
        teardownSocket();
      });
    };

    function connect() {
      if (!url) {
        setStatus("disabled", "No chat server configured");
        return;
      }
      if (document.hidden) return;
      if (socketConnectingOrOpen(ws)) return;

      cleanupReconnect();
      teardownSocket();
      intentionalClose = false;
      setStatus("connecting");

      try {
        ws = new WebSocket(url);
      } catch {
        ws = null;
        setStatus("offline");
        scheduleReconnect();
        return;
      }

      bindSocket(ws);
    }

    // --- Auth (delegated to MorningRoastAuth) -------------------------------
    // Reflect the shared auth state into the chat UI + socket identity.
    const onAuthChange = (state) => {
      token = state.token || "";
      const nextUsername = state.authed ? state.user?.username || null : null;
      const changed = nextUsername !== username;
      username = nextUsername;
      syncAuthUi();
      if (changed) rerenderAll();
      if (connected) sendHello();
      else if (username && url) connect();
    };

    // --- Panel open/close ---------------------------------------------------
    const openPanel = () => {
      root.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      panel.setAttribute("aria-hidden", "false");
      if (!connected && url) connect();
      global.setTimeout(() => (username ? input : loginEmail || input)?.focus(), 120);
    };

    const closePanel = () => {
      root.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
      panel.setAttribute("aria-hidden", "true");
      clearReply();
    };

    toggle.addEventListener("click", () => {
      if (root.classList.contains("is-open")) closePanel();
      else openPanel();
    });

    closeBtn?.addEventListener("click", closePanel);

    // --- Composer -----------------------------------------------------------
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = input.value.trim().slice(0, MAX_TEXT);
      if (!text || !connected || !username) return;

      const payload = { type: "chat", text };
      if (replyTo) payload.replyTo = replyTo;

      if (sendPayload(payload)) {
        input.value = "";
        clearReply();
        syncFormState();
      }
    });

    input.addEventListener("input", syncFormState);
    replyCancel?.addEventListener("click", clearReply);

    messagesEl.addEventListener("scroll", () => {
      const distance = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight;
      stickToBottom = distance < 48;
    });

    // --- Auth form handlers -------------------------------------------------
    const switchAuthTab = (tab) => {
      authTabs.forEach((btn) => {
        const active = btn.dataset.authTab === tab;
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-selected", active ? "true" : "false");
      });
      if (loginForm) loginForm.hidden = tab !== "login";
      if (signupForm) signupForm.hidden = tab !== "signup";
      setAuthMessage("");
      if (resendBtn) resendBtn.hidden = true;
    };

    authTabs.forEach((btn) => {
      btn.addEventListener("click", () => switchAuthTab(btn.dataset.authTab));
    });

    loginForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!auth) return;
      const email = loginEmail?.value.trim() || "";
      const password = loginPassword?.value || "";
      if (!email || !password) return;
      lastLoginEmail = email;
      setAuthMessage("Signing in…");
      if (resendBtn) resendBtn.hidden = true;
      const result = await auth.login(email, password);
      if (result.ok) {
        setAuthMessage("");
        if (loginPassword) loginPassword.value = "";
        return;
      }
      setAuthMessage(result.error || "Login failed.", "error");
      if (result.needsVerification && resendBtn) resendBtn.hidden = false;
    });

    signupForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!auth) return;
      const usernameVal = signupUsername?.value.trim() || "";
      const email = signupEmail?.value.trim() || "";
      const password = signupPassword?.value || "";
      if (!usernameVal || !email || !password) return;
      setAuthMessage("Creating account…");
      const result = await auth.register(usernameVal, email, password);
      if (result.ok) {
        setAuthMessage(result.message || "Check your email for a verification link.", "success");
        if (signupPassword) signupPassword.value = "";
      } else {
        setAuthMessage(result.error || "Sign up failed.", "error");
      }
    });

    resendBtn?.addEventListener("click", async () => {
      const email = lastLoginEmail || loginEmail?.value.trim() || "";
      if (!email || !auth) return;
      setAuthMessage("Sending verification email…");
      const result = await auth.resend(email);
      setAuthMessage(result.message || result.error || "Verification email sent.", result.ok ? "success" : "error");
      if (result.ok && resendBtn) resendBtn.hidden = true;
    });

    logoutBtn?.addEventListener("click", () => {
      auth?.logout();
      switchAuthTab("login");
    });

    const onVisibilityChange = () => {
      if (document.hidden) {
        cleanupReconnect();
        teardownSocket();
        setStatus("offline");
        return;
      }
      if (!closedByUser && !socketConnectingOrOpen(ws)) connect();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    const api = {
      open: openPanel,
      close: closePanel,
      reconnect: () => {
        closedByUser = false;
        reconnectMs = RECONNECT_BASE_MS;
        teardownSocket();
        connect();
      },
      destroy: () => {
        closedByUser = true;
        cleanupReconnect();
        teardownSocket();
        document.removeEventListener("visibilitychange", onVisibilityChange);
      },
      getUrl: () => url,
    };

    activeSession = { api };

    // Initial UI + auth state (auth is owned by MorningRoastAuth).
    if (!authAvailable && authGate) authGate.hidden = true;
    syncAuthUi();
    if (auth?.subscribe) auth.subscribe(onAuthChange);

    if ("requestIdleCallback" in global) {
      global.requestIdleCallback(() => connect(), { timeout: 4000 });
    } else {
      global.setTimeout(connect, 2000);
    }

    return api;
  }

  global.MorningRoastLiveChat = {
    initLiveChat,
    resolveWsUrl,
    resolveApiUrl,
  };
})(window);
