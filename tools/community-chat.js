/** Real-time community chat over WebSocket (display name from Profile). */
(function (global) {
  const PROFILE_DISPLAY_NAME_KEY = "profileDisplayName";
  const PROFILE_BIO_KEY = "profileBio";
  const PROFILE_AVATAR_KEY = "profileAvatarImage";
  const RECONNECT_BASE_MS = 1500;
  const RECONNECT_MAX_MS = 30000;
  const CHAT_OPEN_EVENT = "morning-roast:chat-open";
  const ASSISTANT_OPEN_EVENT = "morning-roast:assistant-open";

  const DEFAULT_CONFIG = {
    enabled: true,
    websocket: { path: "/chat", production_url: "" },
    limits: { max_message_length: 500 },
    requirements: { display_name_required: true, bio_required: false },
    owners: { display_names: [] },
    ui: {
      title: "Community Chat",
      description: "Talk with other Morning Roast visitors in real time.",
      placeholder: "Message the lobby…",
      empty_state: "No messages yet. Say hi!",
      offline_message: "Chat is offline. Try again in a moment.",
      name_required_message: "Set a display name on your Profile before chatting.",
      name_taken_message: "That display name is already in use. Choose another one.",
      name_blocked_message: "That display name is not allowed.",
      reconnecting_message: "Reconnecting to chat…",
    },
  };

  let activeSession = null;
  let dockApi = null;
  let chatSelfUserId = "";
  let onlineDisplayNames = new Set();
  let userProfiles = new Map();
  let pendingProfileUserId = "";
  let lastNameCheckReason = "";
  let ownerDisplayNames = parseOwnerDisplayNames(
    document.querySelector('meta[name="morning-roast-owner-names"]')?.content,
  );

  function normalizeDisplayNameKey(name) {
    return String(name || "").trim().toLowerCase();
  }

  function syncOnlineDisplayNames(users = []) {
    onlineDisplayNames = new Set(
      users
        .map((user) => (typeof user === "string" ? user : user?.name || ""))
        .map((name) => normalizeDisplayNameKey(name))
        .filter(Boolean),
    );
    global.dispatchEvent(new CustomEvent("morning-roast:chat-presence"));
  }

  function isDisplayNameTakenOnline(name, { exceptSaved = true } = {}) {
    const key = normalizeDisplayNameKey(name);
    if (!key) return false;
    if (exceptSaved && key === normalizeDisplayNameKey(readProfileIdentity().name)) return false;
    return onlineDisplayNames.has(key);
  }

  function resolveDisplayNameCheckUrl(wsUrl, name, exceptUserId = "") {
    if (!wsUrl) return "";
    try {
      const url = new URL(wsUrl);
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      url.pathname = "/chat/names/check";
      url.search = "";
      url.hash = "";
      url.searchParams.set("name", String(name || "").trim());
      if (exceptUserId) url.searchParams.set("except", exceptUserId);
      return url.toString();
    } catch {
      return "";
    }
  }

  async function checkDisplayNameAvailability(name, { exceptUserId = "" } = {}) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return false;

    const saved = readProfileIdentity().name;
    if (normalizeDisplayNameKey(trimmed) === normalizeDisplayNameKey(saved)) return true;

    const wsUrl = activeSession?.wsUrl || resolveChatWsUrl(activeSession?.config || DEFAULT_CONFIG);
    const checkUrl = resolveDisplayNameCheckUrl(wsUrl, trimmed, exceptUserId || chatSelfUserId);
    if (checkUrl) {
      try {
        const response = await fetch(checkUrl, { cache: "no-store" });
        if (response.ok) {
          const data = await response.json();
          lastNameCheckReason = data.available ? "" : String(data.reason || "taken");
          return Boolean(data.available);
        }
      } catch {
        // fall through to online cache
      }
    }

    return !isDisplayNameTakenOnline(trimmed);
  }

  function parseOwnerDisplayNames(value) {
    return String(value || "")
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
  }

  function setOwnerDisplayNames(names) {
    ownerDisplayNames = parseOwnerDisplayNames(Array.isArray(names) ? names.join(",") : names);
  }

  function isOwnerDisplayName(name) {
    const normalized = String(name || "").trim().toLowerCase();
    if (!normalized) return false;
    return ownerDisplayNames.some((owner) => owner.trim().toLowerCase() === normalized);
  }

  function createOwnerPill() {
    const pill = document.createElement("span");
    pill.className = "owner-pill";
    pill.textContent = "Owner";
    return pill;
  }

  function createMemberPill() {
    const pill = document.createElement("span");
    pill.className = "member-pill";
    pill.textContent = "Member";
    return pill;
  }

  function getDisplayInitial(name) {
    const trimmed = String(name || "").trim();
    return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
  }

  function applyAvatarToElement(el, name, avatarUrl) {
    if (!el) return;
    el.replaceChildren();
    if (avatarUrl && String(avatarUrl).startsWith("data:image/")) {
      const img = document.createElement("img");
      img.src = avatarUrl;
      img.alt = "";
      img.className = "community-chat-avatar-image";
      el.classList.add("has-image");
      el.appendChild(img);
      return;
    }
    el.classList.remove("has-image");
    el.textContent = getDisplayInitial(name);
  }

  function createChatAvatar(name, avatarUrl) {
    const avatar = document.createElement("span");
    avatar.className = "community-chat-avatar";
    avatar.setAttribute("aria-hidden", "true");
    applyAvatarToElement(avatar, name, avatarUrl);
    return avatar;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(timestamp) {
    try {
      return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
    } catch {
      return "";
    }
  }

  function readProfileIdentity() {
    return {
      name: String(global.localStorage?.getItem(PROFILE_DISPLAY_NAME_KEY) || "").trim(),
      bio: String(global.localStorage?.getItem(PROFILE_BIO_KEY) || "").trim(),
      avatar: String(global.localStorage?.getItem(PROFILE_AVATAR_KEY) || "").trim(),
    };
  }

  function resolveChatWsUrl(config) {
    const host = global.location?.hostname;
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    const path = config?.websocket?.path || "/chat";

    if (isLocalHost) {
      const protocol = global.location?.protocol === "https:" ? "wss" : "ws";
      return `${protocol}://${host}:8080${path}`;
    }

    const meta = document.querySelector('meta[name="morning-roast-chat-ws"]')?.content?.trim();
    if (meta) return meta;

    const configured = config?.websocket?.production_url?.trim();
    if (configured) return configured;

    const presenceMeta = document.querySelector('meta[name="morning-roast-presence-ws"]')?.content?.trim();
    if (presenceMeta) {
      try {
        const url = new URL(presenceMeta);
        url.pathname = path;
        return url.toString();
      } catch {
        // fall through
      }
    }

    return "";
  }

  function resolveConfigHttpUrl(wsUrl) {
    if (!wsUrl) return "";
    try {
      const url = new URL(wsUrl);
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      url.pathname = "/chat/config";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  function resolveHistoryHttpUrl(wsUrl) {
    if (!wsUrl) return "";
    try {
      const url = new URL(wsUrl);
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      url.pathname = "/chat/history";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch {
      return "";
    }
  }

  async function fetchChatHistory(wsUrl) {
    const httpUrl = resolveHistoryHttpUrl(wsUrl);
    if (!httpUrl) return [];
    try {
      const response = await fetch(httpUrl, { cache: "no-store" });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.history) ? data.history : [];
    } catch {
      return [];
    }
  }

  async function fetchChatConfig(wsUrl) {
    const httpUrl = resolveConfigHttpUrl(wsUrl);
    if (!httpUrl) return { ...DEFAULT_CONFIG };
    try {
      const response = await fetch(httpUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return {
        ...DEFAULT_CONFIG,
        ...data,
        ui: { ...DEFAULT_CONFIG.ui, ...data.ui },
        owners: { display_names: data.owners?.display_names || DEFAULT_CONFIG.owners.display_names },
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function initCommunityChat(root = document.getElementById("community-chat-dock")) {
    if (!root || activeSession) return activeSession?.api;

    const panel = root.querySelector("#community-chat-panel");
    const messagesEl = root.querySelector("#community-chat-messages");
    const formEl = root.querySelector("#community-chat-form");
    const inputEl = root.querySelector("#community-chat-input");
    const sendBtn = root.querySelector("#community-chat-send");
    const statusEl = root.querySelector("#community-chat-status");
    const onlineEl = root.querySelector("#community-chat-online");
    const titleEl = root.querySelector("#community-chat-title");
    const profilePopover = root.querySelector("#community-chat-profile-popover");
    const profileCloseBtn = root.querySelector("#community-chat-profile-close");
    const profileAvatarEl = root.querySelector("#community-chat-profile-avatar");
    const profileNameEl = root.querySelector("#community-chat-profile-name");
    const profileTagsEl = root.querySelector("#community-chat-profile-tags");
    const profileBioEl = root.querySelector("#community-chat-profile-bio");

    if (!panel || !messagesEl || !formEl || !inputEl) return null;

    const session = {
      root,
      panel,
      config: { ...DEFAULT_CONFIG },
      wsUrl: "",
      socket: null,
      timer: null,
      reconnectMs: RECONNECT_BASE_MS,
      stopped: false,
      generation: 0,
      state: "connecting",
      selfId: "",
      messageIds: new Set(),
      api: null,
    };

    const upsertUserProfile = (userId, profile = {}) => {
      const id = String(userId || "").trim();
      if (!id) return;
      userProfiles.set(id, {
        ...userProfiles.get(id),
        ...profile,
        userId: id,
        name: String(profile.name ?? userProfiles.get(id)?.name ?? "").trim(),
        bio: String(profile.bio ?? userProfiles.get(id)?.bio ?? "").trim(),
        avatar: String(profile.avatar ?? userProfiles.get(id)?.avatar ?? "").trim(),
        isOwner: Boolean(profile.isOwner ?? userProfiles.get(id)?.isOwner),
      });
    };

    const resolveMessageAvatar = (message) => {
      if (message?.avatar) return message.avatar;
      if (message?.userId) return userProfiles.get(message.userId)?.avatar || "";
      return "";
    };

    const isSelfMessage = (message) => {
      if (message?.userId && session.selfId && message.userId === session.selfId) return true;
      const savedName = readProfileIdentity().name;
      if (!savedName || !message?.name) return false;
      return normalizeDisplayNameKey(message.name) === normalizeDisplayNameKey(savedName);
    };

    const syncMessageAvatars = () => {
      messagesEl.querySelectorAll(".community-chat-msg[data-user-id]").forEach((item) => {
        const profile = userProfiles.get(item.dataset.userId || "");
        const avatarEl = item.querySelector(".community-chat-avatar");
        if (!avatarEl || !profile) return;
        applyAvatarToElement(avatarEl, profile.name, profile.avatar);
      });
    };

    const requestUserProfile = (userId) => {
      if (!userId || userId === session.selfId) return;
      if (!session.socket || session.socket.readyState !== WebSocket.OPEN) return;
      pendingProfileUserId = userId;
      try {
        session.socket.send(JSON.stringify({ type: "get_profile", userId }));
      } catch {
        pendingProfileUserId = "";
      }
    };

    const closeProfilePopover = () => {
      if (!profilePopover) return;
      profilePopover.hidden = true;
      profilePopover.setAttribute("aria-hidden", "true");
      pendingProfileUserId = "";
    };

    const showProfilePopover = (profile = {}) => {
      if (!profilePopover || !profileNameEl || !profileBioEl || !profileAvatarEl) return;

      const name = String(profile.name || "Guest").trim() || "Guest";
      const bio = String(profile.bio || "").trim();
      const isOwner = Boolean(profile.isOwner);
      const loading = Boolean(profile.loading);

      applyAvatarToElement(profileAvatarEl, name, profile.avatar);
      profileNameEl.textContent = name;
      if (profileTagsEl) {
        profileTagsEl.replaceChildren();
        profileTagsEl.appendChild(createMemberPill());
        if (isOwner) profileTagsEl.appendChild(createOwnerPill());
      }
      profileBioEl.textContent = loading ? "Loading profile…" : bio || "No bio yet.";
      profilePopover.hidden = false;
      profilePopover.setAttribute("aria-hidden", "false");
      profileCloseBtn?.focus({ preventScroll: true });
    };

    const openUserProfile = (userId, fallback = {}) => {
      const id = String(userId || "").trim();
      if (!id || id === session.selfId) return;

      const cached = userProfiles.get(id);
      showProfilePopover({
        userId: id,
        name: cached?.name || fallback.name || "Guest",
        bio: cached?.bio || "",
        isOwner: Boolean(cached?.isOwner ?? fallback.isOwner),
        loading: session.state === "live",
      });
      if (session.state === "live") requestUserProfile(id);
    };

    const setState = (state) => {
      session.state = state;
      panel.dataset.chatState = state;
      updateUi();
    };

    const isNameAllowed = () => {
      const { name } = readProfileIdentity();
      if (!session.config.requirements?.display_name_required) return true;
      return Boolean(name);
    };

    const updateUi = () => {
      const offline = session.state !== "live";
      const nameOk = isNameAllowed();

      if (sendBtn) sendBtn.disabled = offline || !nameOk || !inputEl.value.trim();
      if (inputEl) {
        inputEl.disabled = offline || !nameOk;
        inputEl.maxLength = Number(session.config.limits?.max_message_length) || 500;
        inputEl.placeholder = nameOk
          ? session.config.ui?.placeholder || DEFAULT_CONFIG.ui.placeholder
          : session.config.ui?.name_required_message || DEFAULT_CONFIG.ui.name_required_message;
      }

      if (titleEl && session.config.ui?.title) titleEl.textContent = session.config.ui.title;

      if (statusEl) {
        statusEl.textContent = session.state === "live" ? "Online" : "Offline";
      }
    };

    const scrollToBottom = () => {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    const renderMessage = (message, { isSelf = false } = {}) => {
      if (!message?.id || session.messageIds.has(message.id)) return;
      session.messageIds.add(message.id);

      const self = isSelf || isSelfMessage(message);
      const avatarUrl = resolveMessageAvatar(message);

      if (message.userId) {
        upsertUserProfile(message.userId, {
          name: message.name,
          avatar: avatarUrl,
          isOwner: Boolean(message.isOwner),
        });
      }

      const item = document.createElement("div");
      item.className = `community-chat-msg community-chat-msg--${self ? "self" : "other"}`;
      item.dataset.messageId = message.id;
      if (message.userId) item.dataset.userId = message.userId;

      const head = document.createElement("div");
      head.className = "community-chat-msg-head";

      const time = document.createElement("time");
      time.dateTime = new Date(message.at).toISOString();
      time.textContent = formatTime(message.at);

      const avatar = createChatAvatar(message.name, avatarUrl);
      const nameWrap = document.createElement("span");
      nameWrap.className = "community-chat-name-wrap";
      const nameLabel = document.createElement("strong");
      nameLabel.textContent = message.name || "Guest";
      nameWrap.appendChild(nameLabel);
      if (message.isOwner) nameWrap.appendChild(createOwnerPill());

      if (self) {
        const identity = document.createElement("div");
        identity.className = "community-chat-msg-identity";
        identity.appendChild(avatar);
        identity.appendChild(nameWrap);
        head.appendChild(identity);
        head.appendChild(time);
      } else {
        const trigger = document.createElement("button");
        trigger.type = "button";
        trigger.className = "community-chat-profile-trigger";
        trigger.setAttribute("aria-label", `View ${message.name || "Guest"}'s profile`);
        trigger.appendChild(nameWrap);
        trigger.appendChild(avatar);
        trigger.addEventListener("click", () => {
          openUserProfile(message.userId, {
            name: message.name,
            isOwner: Boolean(message.isOwner),
          });
        });
        head.appendChild(time);
        head.appendChild(trigger);
      }

      item.appendChild(head);

      const bubble = document.createElement("div");
      bubble.className = "site-assistant-bubble";
      bubble.textContent = message.text || "";

      item.appendChild(bubble);
      messagesEl.appendChild(item);
      scrollToBottom();
    };

    const renderHistory = (history) => {
      messagesEl.querySelectorAll(".community-chat-msg").forEach((node) => node.remove());
      session.messageIds.clear();
      (history || []).forEach((message) => {
        renderMessage(message, { isSelf: isSelfMessage(message) });
      });
      syncMessageAvatars();
      updateUi();
    };

    const renderPresence = ({ online, users } = {}) => {
      if (onlineEl) onlineEl.textContent = Number.isFinite(online) ? String(Math.max(0, online)) : "0";
      syncOnlineDisplayNames(users);
      (users || []).forEach((user) => {
        const entry =
          typeof user === "string"
            ? { name: user, isOwner: isOwnerDisplayName(user) }
            : {
                userId: user?.userId || user?.id || "",
                name: user?.name || "",
                bio: user?.bio || "",
                avatar: user?.avatar || "",
                isOwner: Boolean(user?.isOwner),
              };
        if (entry.userId) upsertUserProfile(entry.userId, entry);
      });
      syncMessageAvatars();
    };

    const sendJoin = () => {
      if (!session.socket || session.socket.readyState !== WebSocket.OPEN) return;
      const identity = readProfileIdentity();
      try {
        session.socket.send(
          JSON.stringify({ type: "join", name: identity.name, bio: identity.bio, avatar: identity.avatar }),
        );
      } catch {
        // ignore
      }
    };

    const sendMessage = () => {
      const text = inputEl.value.trim();
      if (!text || session.state !== "live" || !isNameAllowed()) return;
      try {
        session.socket?.send(JSON.stringify({ type: "message", text }));
        inputEl.value = "";
        updateUi();
      } catch {
        setState("offline");
      }
    };

    const clearReconnect = () => {
      if (session.timer !== null) clearTimeout(session.timer);
      session.timer = null;
    };

    const closeSocket = () => {
      const socket = session.socket;
      session.socket = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    };

    const scheduleReconnect = () => {
      clearReconnect();
      if (session.stopped || !session.wsUrl) return;
      session.timer = setTimeout(connect, session.reconnectMs);
      session.reconnectMs = Math.min(Math.round(session.reconnectMs * 1.5), RECONNECT_MAX_MS);
    };

    function connect() {
      if (!session.wsUrl || session.config.enabled === false) {
        setState("disabled");
        return;
      }

      clearReconnect();
      closeSocket();
      setState("connecting");
      const generation = ++session.generation;
      const socket = new WebSocket(session.wsUrl);
      session.socket = socket;

      socket.addEventListener("open", () => {
        if (generation !== session.generation || session.socket !== socket) return;
        session.reconnectMs = RECONNECT_BASE_MS;
        setState("live");
        sendJoin();
      });

      socket.addEventListener("message", (event) => {
        if (generation !== session.generation || session.socket !== socket) return;
        let message;
        try {
          message = JSON.parse(String(event.data || ""));
        } catch {
          return;
        }

        switch (message?.type) {
          case "welcome":
            session.selfId = message.you?.id || "";
            chatSelfUserId = session.selfId;
            if (message.config?.ui) session.config.ui = { ...session.config.ui, ...message.config.ui };
            if (message.config?.limits) session.config.limits = { ...session.config.limits, ...message.config.limits };
            if (message.config?.requirements) session.config.requirements = { ...session.config.requirements, ...message.config.requirements };
            if (message.config?.owners?.display_names) {
              session.config.owners = { display_names: [...message.config.owners.display_names] };
              setOwnerDisplayNames(message.config.owners.display_names);
              global.dispatchEvent(new CustomEvent("morning-roast:owners-config"));
            }
            renderHistory(message.history || []);
            renderPresence({ online: message.online, users: [] });
            updateUi();
            break;
          case "joined":
            session.selfId = message.you?.id || session.selfId;
            chatSelfUserId = session.selfId;
            if (session.selfId) {
              upsertUserProfile(session.selfId, {
                name: message.you?.name || readProfileIdentity().name,
                bio: message.you?.bio || readProfileIdentity().bio,
                avatar: message.you?.avatar || readProfileIdentity().avatar,
                isOwner: Boolean(message.you?.isOwner),
              });
            }
            syncMessageAvatars();
            updateUi();
            break;
          case "message":
            renderMessage(message, { isSelf: isSelfMessage(message) });
            updateUi();
            break;
          case "presence":
            renderPresence(message);
            break;
          case "profile":
            upsertUserProfile(message.userId, message);
            if (pendingProfileUserId && pendingProfileUserId === message.userId) {
              showProfilePopover(message);
              pendingProfileUserId = "";
            }
            break;
          case "error":
            if (message.code === "name_required") updateUi();
            if (message.code === "name_taken") {
              global.Toast?.notify?.({
                message: message.message || session.config.ui?.name_taken_message || DEFAULT_CONFIG.ui.name_taken_message,
                type: "error",
              });
              global.dispatchEvent(new CustomEvent("morning-roast:display-name-taken"));
            }
            if (message.code === "name_blocked") {
              global.Toast?.notify?.({
                message: message.message || session.config.ui?.name_blocked_message || DEFAULT_CONFIG.ui.name_blocked_message,
                type: "error",
              });
              global.dispatchEvent(new CustomEvent("morning-roast:display-name-blocked"));
            }
            break;
          default:
            break;
        }
      });

      socket.addEventListener("close", () => {
        if (generation !== session.generation) return;
        session.socket = null;
        setState("offline");
        scheduleReconnect();
      });

      socket.addEventListener("error", () => socket.close());
    }

    formEl.addEventListener("submit", (event) => {
      event.preventDefault();
      sendMessage();
    });

    inputEl.addEventListener("input", updateUi);

    profileCloseBtn?.addEventListener("click", closeProfilePopover);
    profilePopover?.addEventListener("click", (event) => {
      if (event.target === profilePopover) closeProfilePopover();
    });

    global.addEventListener("storage", (event) => {
      if (
        event.key === PROFILE_DISPLAY_NAME_KEY ||
        event.key === PROFILE_BIO_KEY ||
        event.key === PROFILE_AVATAR_KEY
      ) {
        sendJoin();
        updateUi();
      }
    });

    session.api = {
      destroy() {
        session.stopped = true;
        clearReconnect();
        session.generation += 1;
        closeSocket();
        closeProfilePopover();
        userProfiles.clear();
        activeSession = null;
      },
      reconnect() {
        session.stopped = false;
        session.reconnectMs = RECONNECT_BASE_MS;
        connect();
      },
      refreshIdentity() {
        sendJoin();
        updateUi();
      },
      focusComposer() {
        if (!inputEl.disabled) inputEl.focus({ preventScroll: true });
      },
      closeProfile: closeProfilePopover,
      isProfileOpen: () => Boolean(profilePopover && !profilePopover.hidden),
      getState: () => session.state,
    };

    activeSession = session;

    (async () => {
      const provisionalUrl = resolveChatWsUrl(DEFAULT_CONFIG);
      session.config = await fetchChatConfig(provisionalUrl);
      if (session.config.owners?.display_names?.length) {
        setOwnerDisplayNames(session.config.owners.display_names);
      }
      session.wsUrl = resolveChatWsUrl(session.config);
      updateUi();

      const persistedHistory = await fetchChatHistory(session.wsUrl);
      if (persistedHistory.length) {
        renderHistory(persistedHistory);
      }

      connect();
    })();

    return session.api;
  }

  function initCommunityChatDock() {
    const dock = document.getElementById("community-chat-dock");
    const toggle = document.getElementById("community-chat-toggle");
    const panel = document.getElementById("community-chat-panel");
    const closeBtn = document.getElementById("community-chat-close");
    if (!dock || !toggle || !panel || initCommunityChatDock._init) return dockApi;
    initCommunityChatDock._init = true;

    let open = false;
    const chatApi = initCommunityChat(dock);

    const focusComposerInput = () => {
      if (!open) return;
      requestAnimationFrame(() => requestAnimationFrame(() => chatApi?.focusComposer?.()));
    };

    const setOpen = (next) => {
      const wasOpen = open;
      open = Boolean(next);
      dock.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close community chat" : "Open community chat");
      panel.setAttribute("aria-hidden", open ? "false" : "true");
      if (open && !wasOpen) {
        global.dispatchEvent(new CustomEvent(CHAT_OPEN_EVENT));
        focusComposerInput();
      }
      if (!open && wasOpen) {
        chatApi?.closeProfile?.();
        const active = document.activeElement;
        if (active instanceof HTMLElement && (panel.contains(active) || active === toggle)) {
          active.blur();
        }
      }
    };

    dockApi = {
      setOpen,
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen(!open),
      isOpen: () => open,
    };

    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      setOpen(!open);
    });
    closeBtn?.addEventListener("click", () => setOpen(false));

    panel.addEventListener("click", (event) => event.stopPropagation());

    panel.addEventListener(
      "wheel",
      (event) => {
        if (!open) return;

        const scrollEl = panel.querySelector("#community-chat-messages");
        if (!scrollEl) return;

        const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight;
        if (maxScroll <= 0) {
          event.preventDefault();
          return;
        }

        if (scrollEl.contains(event.target)) {
          const atTop = scrollEl.scrollTop <= 0;
          const atBottom = scrollEl.scrollTop >= maxScroll;
          if ((atTop && event.deltaY < 0) || (atBottom && event.deltaY > 0)) {
            event.preventDefault();
          }
          return;
        }

        event.preventDefault();
        scrollEl.scrollTop = Math.max(0, Math.min(maxScroll, scrollEl.scrollTop + event.deltaY));
      },
      { passive: false },
    );

    document.addEventListener("click", (event) => {
      if (!open) return;
      if (dock.contains(event.target)) return;
      setOpen(false);
    });

    global.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !open) return;
      if (chatApi?.isProfileOpen?.()) {
        event.preventDefault();
        chatApi.closeProfile();
        return;
      }
      event.preventDefault();
      setOpen(false);
    });

    global.addEventListener(ASSISTANT_OPEN_EVENT, () => setOpen(false));

    return dockApi;
  }

  function initCommunityChatEntrypoints() {
    initCommunityChatDock();
    return activeSession?.api;
  }

  global.MorningRoastChat = {
    initCommunityChat: initCommunityChatEntrypoints,
    initCommunityChatDock,
    openDock: () => dockApi?.open?.(),
    closeDock: () => dockApi?.close?.(),
    toggleDock: () => dockApi?.toggle?.(),
    resolveChatWsUrl,
    readProfileIdentity,
    isOwnerDisplayName,
    getOwnerDisplayNames: () => [...ownerDisplayNames],
    getSelfUserId: () => chatSelfUserId,
    isDisplayNameTakenOnline,
    checkDisplayNameAvailability,
    getDisplayNameTakenMessage: () =>
      activeSession?.config?.ui?.name_taken_message || DEFAULT_CONFIG.ui.name_taken_message,
    getDisplayNameBlockedMessage: () =>
      activeSession?.config?.ui?.name_blocked_message || DEFAULT_CONFIG.ui.name_blocked_message,
    getLastNameCheckReason: () => lastNameCheckReason,
  };
})(window);
