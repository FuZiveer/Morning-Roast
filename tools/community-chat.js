/** Real-time community chat over WebSocket (display name from Profile). */
(function (global) {
  const PROFILE_DISPLAY_NAME_KEY = "profileDisplayName";
  const PROFILE_BIO_KEY = "profileBio";
  const PROFILE_AVATAR_KEY = "profileAvatarImage";
  const RECONNECT_BASE_MS = 1500;
  const RECONNECT_MAX_MS = 30000;
  const CHAT_OPEN_EVENT = "morning-roast:chat-open";
  const ASSISTANT_OPEN_EVENT = "morning-roast:assistant-open";
  const CHAT_HISTORY_STORAGE_KEY = "morningRoastChatHistory";
  const CHAT_DM_STORAGE_KEY = "morningRoastChatDmHistory";
  const CHAT_CLOSED_DMS_KEY = "morningRoastChatClosedDms";
  const CHAT_HISTORY_DEFAULT_MAX = 100;

  const DEFAULT_CONFIG = {
    enabled: true,
    websocket: { path: "/chat", production_url: "" },
    limits: { max_message_length: 500 },
    requirements: { display_name_required: true, bio_required: false },
    owners: { display_names: [] },
    ui: {
      title: "Community Chat",
      description: "Talk with other Morning Roast visitors in real time.",
      placeholder: "Message public chat…",
      dm_placeholder: "Message privately…",
      dm_offline_message: "That user is offline.",
      dm_title_prefix: "Chat with",
      messages_title: "Messages",
      messages_empty: "No messages yet. Open a profile to start a chat.",
      public_chat_title: "Public",
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
    return normalized === "fuziveer";
  }

  function createOwnerPill() {
    const pill = document.createElement("span");
    pill.className = "owner-pill";
    pill.textContent = "Owner";
    return pill;
  }

  const CHAT_PROFILE_TAGS_VISIBLE = 4;

  function renderChatProfileTags(container, displayName) {
    if (!container) return;
    container.replaceChildren();

    const tagApi = global.MorningRoastProfileTags;
    const tags = tagApi?.getUnlockedTagsForDisplayName?.(displayName) || [];
    if (!tags.length) {
      container.hidden = true;
      return;
    }

    container.hidden = false;
    const expanded = container.dataset.tagsExpanded === "1";
    const visibleTags = expanded ? tags : tags.slice(0, CHAT_PROFILE_TAGS_VISIBLE);
    const hiddenCount = expanded ? 0 : Math.max(0, tags.length - CHAT_PROFILE_TAGS_VISIBLE);

    for (const tag of visibleTags) {
      const el = tagApi.createTagElement(tag.label, {
        unlocked: true,
        owner: Boolean(tag.owner),
        hint: tag.hint || "",
        id: tag.id,
      });
      container.appendChild(el);
    }

    if (hiddenCount > 0) {
      const moreBtn = document.createElement("button");
      moreBtn.type = "button";
      moreBtn.className = "community-chat-profile-tags-more";
      moreBtn.textContent = `${hiddenCount}+`;
      moreBtn.setAttribute("aria-expanded", "false");
      moreBtn.setAttribute("aria-label", `Show ${hiddenCount} more tags`);
      moreBtn.addEventListener("click", () => {
        container.dataset.tagsExpanded = "1";
        renderChatProfileTags(container, displayName);
      });
      container.appendChild(moreBtn);
    }
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

  const CHAT_PING_SOUND_KEY = "prefChatPingSound";
  const CHAT_PING_SOUNDS = Object.freeze([
    { id: "soft-bell", label: "Soft Bell", url: "assets/audio/soft-bell-ping.mp3" },
    { id: "bright-ping", label: "Bright Ping", url: "assets/audio/bright-ping.mp3" },
    { id: "warm-chime", label: "Warm Chime", url: "assets/audio/warm-chime.mp3" },
  ]);
  const chatPingAudioTemplates = new Map();

  function normalizeChatPingSoundId(id) {
    const value = String(id || "").trim();
    return CHAT_PING_SOUNDS.some((sound) => sound.id === value) ? value : CHAT_PING_SOUNDS[0].id;
  }

  function getChatPingSoundId() {
    return normalizeChatPingSoundId(global.localStorage?.getItem(CHAT_PING_SOUND_KEY) || CHAT_PING_SOUNDS[0].id);
  }

  function getChatPingSound() {
    return CHAT_PING_SOUNDS.find((sound) => sound.id === getChatPingSoundId()) || CHAT_PING_SOUNDS[0];
  }

  function setChatPingSoundId(id) {
    const normalized = normalizeChatPingSoundId(id);
    global.localStorage?.setItem(CHAT_PING_SOUND_KEY, normalized);
    return normalized;
  }

  function getChatPingAudioTemplate(url) {
    if (!chatPingAudioTemplates.has(url)) {
      const audio = new global.Audio(url);
      audio.preload = "auto";
      chatPingAudioTemplates.set(url, audio);
    }
    return chatPingAudioTemplates.get(url);
  }

  function getChatPingVolume() {
    const master =
      Math.max(
        0,
        Math.min(100, parseInt(global.localStorage?.getItem("prefMasterVolume") ?? "100", 10) || 0),
      ) / 100;
    const chatPing =
      Math.max(
        0,
        Math.min(100, parseInt(global.localStorage?.getItem("prefChatPingVolume") ?? "25", 10) || 0),
      ) / 100;
    return master * chatPing;
  }

  function playChatPingSound(overrideId) {
    const volume = getChatPingVolume();
    if (volume <= 0) return;

    const sound = overrideId
      ? CHAT_PING_SOUNDS.find((entry) => entry.id === normalizeChatPingSoundId(overrideId)) || getChatPingSound()
      : getChatPingSound();

    try {
      const audio = getChatPingAudioTemplate(sound.url).cloneNode();
      audio.volume = Math.min(1, volume);
      void audio.play();
    } catch {
      // ignore audio failures
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

  function formatChatOpenLabel(count) {
    const total = Math.max(0, Number(count) || 0);
    return total === 1 ? "1 member has chat open" : `${total} members have chat open`;
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

  function mergeHistoryMessages(...lists) {
    const byId = new Map();
    for (const list of lists) {
      for (const message of list || []) {
        if (message?.id) byId.set(message.id, message);
      }
    }
    return [...byId.values()].sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
  }

  function getHistoryMaxSize(config) {
    const size = Number(config?.limits?.history_size);
    return Number.isFinite(size) && size > 0 ? size : CHAT_HISTORY_DEFAULT_MAX;
  }

  function normalizeStoredHistoryMessage(message) {
    if (!message || typeof message !== "object") return null;
    const id = String(message.id || "").trim();
    const text = String(message.text || "").trim();
    const at = Number(message.at);
    if (!id || !text || !Number.isFinite(at)) return null;
    const stored = {
      id,
      userId: String(message.userId || "").trim(),
      name: String(message.name || "").trim() || "Guest",
      text,
      at,
    };
    if (message.isOwner) stored.isOwner = true;
    return stored;
  }

  function readLocalChatHistory() {
    try {
      const raw = global.localStorage?.getItem(CHAT_HISTORY_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed?.messages;
      return (Array.isArray(list) ? list : [])
        .map(normalizeStoredHistoryMessage)
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  function writeLocalChatHistory(messages, maxSize = CHAT_HISTORY_DEFAULT_MAX) {
    if (!global.localStorage) return;
    const normalized = mergeHistoryMessages(messages)
      .map(normalizeStoredHistoryMessage)
      .filter(Boolean)
      .slice(-maxSize);
    const payload = { version: 1, updatedAt: Date.now(), messages: normalized };
    try {
      global.localStorage.setItem(CHAT_HISTORY_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      try {
        const trimmed = normalized.slice(-Math.max(1, Math.floor(maxSize / 2)));
        global.localStorage.setItem(
          CHAT_HISTORY_STORAGE_KEY,
          JSON.stringify({ version: 1, updatedAt: Date.now(), messages: trimmed }),
        );
      } catch {
        // Storage full or unavailable.
      }
    }
  }

  function normalizeStoredDmMessage(message) {
    if (!message || typeof message !== "object") return null;
    const id = String(message.id || "").trim();
    const fromUserId = String(message.fromUserId || message.userId || "").trim();
    const toUserId = String(message.toUserId || "").trim();
    const fromName = String(message.fromName || message.name || "").trim();
    const toName = String(message.toName || "").trim();
    const text = String(message.text || "").trim();
    const at = Number(message.at);
    if (!id || !fromUserId || !toName || !fromName || !text || !Number.isFinite(at)) return null;
    const stored = { id, fromUserId, toUserId, fromName, toName, text, at };
    if (message.fromIsOwner || message.isOwner) stored.fromIsOwner = true;
    if (message.toIsOwner) stored.toIsOwner = true;
    return stored;
  }

  function readDmStore() {
    try {
      const raw = global.localStorage?.getItem(CHAT_DM_STORAGE_KEY);
      if (!raw) return { threads: {} };
      const parsed = JSON.parse(raw);
      const threads = parsed?.threads;
      return { threads: threads && typeof threads === "object" && !Array.isArray(threads) ? threads : {} };
    } catch {
      return { threads: {} };
    }
  }

  function writeDmStore(store) {
    if (!global.localStorage) return;
    try {
      global.localStorage.setItem(
        CHAT_DM_STORAGE_KEY,
        JSON.stringify({ version: 1, updatedAt: Date.now(), threads: store.threads || {} }),
      );
    } catch {
      // Storage full or unavailable.
    }
  }

  function dmThreadKey(peerName) {
    const key = normalizeDisplayNameKey(peerName);
    return key ? `name:${key}` : "";
  }

  function getDmThread(peerName) {
    const key = dmThreadKey(peerName);
    if (!key) return [];
    const store = readDmStore();
    const list = store.threads[key];
    return (Array.isArray(list) ? list : [])
      .map(normalizeStoredDmMessage)
      .filter(Boolean)
      .sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
  }

  function persistDmThread(peerName, messages, maxSize = CHAT_HISTORY_DEFAULT_MAX) {
    const key = dmThreadKey(peerName);
    if (!key) return;
    const store = readDmStore();
    const merged = mergeHistoryMessages(
      (Array.isArray(store.threads[key]) ? store.threads[key] : []).map(normalizeStoredDmMessage).filter(Boolean),
      messages.map(normalizeStoredDmMessage).filter(Boolean),
    ).slice(-maxSize);
    store.threads[key] = merged;
    writeDmStore(store);
  }

  function dmToRenderMessage(dm, selfId) {
    const self = dm.fromUserId === selfId;
    return {
      id: dm.id,
      userId: dm.fromUserId,
      name: dm.fromName,
      text: dm.text,
      at: dm.at,
      avatar: dm.fromAvatar || "",
      isOwner: Boolean(dm.fromIsOwner),
      isSelf: self,
    };
  }

  function hydrateRecentThreadsFromStorage(trackRecentThread, closedDmKeys) {
    const selfName = readProfileIdentity().name;
    const selfKey = normalizeDisplayNameKey(selfName);
    if (!selfKey) return;
    const store = readDmStore();
    for (const [threadKey, list] of Object.entries(store.threads || {})) {
      if (closedDmKeys?.has?.(threadKey)) continue;
      const messages = (Array.isArray(list) ? list : []).map(normalizeStoredDmMessage).filter(Boolean);
      const last = messages[messages.length - 1];
      if (!last) continue;
      const peerName = normalizeDisplayNameKey(last.fromName) === selfKey ? last.toName : last.fromName;
      const peerUserId = normalizeDisplayNameKey(last.fromName) === selfKey ? last.toUserId : last.fromUserId;
      if (peerName) trackRecentThread(peerUserId, { name: peerName });
    }
  }

  function readClosedDmKeys() {
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(CHAT_CLOSED_DMS_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []);
    } catch {
      return new Set();
    }
  }

  function writeClosedDmKeys(keys) {
    if (!global.localStorage) return;
    try {
      global.localStorage.setItem(CHAT_CLOSED_DMS_KEY, JSON.stringify([...keys]));
    } catch {
      // Storage full or unavailable.
    }
  }

  function formatUnreadCount(count) {
    const total = Math.max(0, Number(count) || 0);
    if (!total) return "";
    return total > 9 ? "9+" : String(total);
  }

  function syncUnreadBadge(el, count) {
    if (!el) return;
    const total = Math.max(0, Number(count) || 0);
    if (total <= 0) {
      el.hidden = true;
      el.textContent = "";
      el.removeAttribute("data-count");
      return;
    }
    el.hidden = false;
    el.textContent = formatUnreadCount(total);
    el.setAttribute("data-count", String(total));
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
    const onlineEl = root.querySelector("#community-chat-open-count");
    const titleEl = root.querySelector("#community-chat-title");
    const profilePopover = root.querySelector("#community-chat-profile-popover");
    const profileCloseBtn = root.querySelector("#community-chat-profile-close");
    const profileAvatarEl = root.querySelector("#community-chat-profile-avatar");
    const profileNameEl = root.querySelector("#community-chat-profile-name");
    const profileTagsEl = root.querySelector("#community-chat-profile-tags");
    const profileBioEl = root.querySelector("#community-chat-profile-bio");
    const profileMessageBtn = root.querySelector("#community-chat-profile-message");
    const sidebarEl = root.querySelector("#community-chat-sidebar");
    const lobbyBtn = root.querySelector("#community-chat-lobby-btn");
    const friendsBadge = root.querySelector("#community-chat-friends-badge");
    const messagesHeadingEl = root.querySelector(".community-chat-messages-heading");
    const friendsWrap = root.querySelector("#community-chat-friends");
    const friendsToggle = root.querySelector("#community-chat-friends-toggle");
    const friendsMenu = root.querySelector("#community-chat-friends-menu");
    const friendsOnlineListEl = root.querySelector("#community-chat-friends-online-list");
    const dmListEl = root.querySelector("#community-chat-friends-list");
    const dmCloseBtn = root.querySelector("#community-chat-dm-close");
    const chatToggleBadge = document.getElementById("community-chat-toggle-badge");
    const mainEl = root.querySelector(".community-chat-main");

    if (!panel || !messagesEl || !formEl || !inputEl) return null;

    const closedDmKeys = readClosedDmKeys();

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
      panelOpen: false,
      activeChannel: "lobby",
      lobbyUnread: 0,
      lobbyMessageIds: new Set(),
      dmMessageIds: new Map(),
      dmUnread: new Map(),
      onlineUsers: [],
      recentThreads: new Map(),
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
      if (profileMessageBtn) profileMessageBtn.hidden = true;
      if (profileTagsEl) profileTagsEl.dataset.tagsExpanded = "0";
    };

    const getChannelMessageIds = (channel) => {
      if (channel === "lobby") return session.lobbyMessageIds;
      if (!session.dmMessageIds.has(channel)) session.dmMessageIds.set(channel, new Set());
      return session.dmMessageIds.get(channel);
    };

    const syncActiveMessageIds = () => {
      session.messageIds = getChannelMessageIds(session.activeChannel);
    };

    const getPeerProfile = (userId) => {
      const id = String(userId || "").trim();
      return userProfiles.get(id) || { userId: id, name: "Guest", avatar: "", isOwner: false };
    };

    const trackRecentThread = (userId, profile = {}) => {
      const id = String(userId || "").trim();
      const name = String(profile.name || "").trim();
      if (!id || !name) return;
      const key = dmThreadKey(name);
      if (!key || closedDmKeys.has(key)) return;
      session.recentThreads.set(key, {
        userId: id,
        name,
        avatar: String(profile.avatar || "").trim(),
        isOwner: Boolean(profile.isOwner),
      });
    };

    const reopenDmThread = (peerName) => {
      const key = dmThreadKey(peerName);
      if (!key || !closedDmKeys.has(key)) return;
      closedDmKeys.delete(key);
      writeClosedDmKeys(closedDmKeys);
    };

    const removeDmThread = (userId, peerName) => {
      const id = String(userId || "").trim();
      const name = String(peerName || "").trim();
      const key = dmThreadKey(name);
      if (key) {
        session.recentThreads.delete(key);
        closedDmKeys.add(key);
        writeClosedDmKeys(closedDmKeys);
      }
      if (id) session.dmUnread.delete(id);
      if (session.activeChannel === id) void switchChannel("lobby");
      else {
        renderSidebar();
        syncNotifyBadges();
      }
    };

    const getTotalDmUnread = () => {
      let total = 0;
      session.dmUnread.forEach((count, userId) => {
        if (session.activeChannel !== userId) total += count;
      });
      return total;
    };

    const getToggleUnreadCount = () => {
      let total = getTotalDmUnread();
      if (!session.panelOpen || session.activeChannel !== "lobby") {
        total += session.lobbyUnread;
      }
      return total;
    };

    const syncNotifyBadges = () => {
      syncUnreadBadge(friendsBadge, getTotalDmUnread());
      syncUnreadBadge(chatToggleBadge, getToggleUnreadCount());
      const chatToggle = document.getElementById("community-chat-toggle");
      chatToggle?.classList.toggle("has-unread", getToggleUnreadCount() > 0);
    };

    const getActivePeer = () => {
      if (session.activeChannel === "lobby") return null;
      return getPeerProfile(session.activeChannel);
    };

    const showProfilePopover = (profile = {}) => {
      if (!profilePopover || !profileNameEl || !profileBioEl || !profileAvatarEl) return;

      const name = String(profile.name || "Guest").trim() || "Guest";
      const bio = String(profile.bio || "").trim();
      const loading = Boolean(profile.loading);
      const userId = String(profile.userId || "").trim();
      const isSelf = Boolean(profile.isSelf) || (userId && userId === session.selfId);

      applyAvatarToElement(profileAvatarEl, name, profile.avatar);
      profileNameEl.textContent = name;
      if (profileTagsEl) {
        profileTagsEl.dataset.tagsExpanded = "0";
        renderChatProfileTags(profileTagsEl, name);
      }
      profileBioEl.textContent = loading ? "Loading profile…" : bio || "No bio yet.";

      if (profileMessageBtn) {
        const canMessage = !isSelf && userId && session.state === "live";
        profileMessageBtn.hidden = !canMessage;
        profileMessageBtn.dataset.userId = canMessage ? userId : "";
        profileMessageBtn.dataset.userName = canMessage ? name : "";
      }

      profilePopover.hidden = false;
      profilePopover.setAttribute("aria-hidden", "false");
      profileCloseBtn?.focus({ preventScroll: true });
    };

    const openSelfProfile = (fallback = {}) => {
      const identity = readProfileIdentity();
      const name = String(identity.name || fallback.name || "Guest").trim() || "Guest";
      showProfilePopover({
        userId: session.selfId,
        name,
        bio: identity.bio || "",
        avatar: identity.avatar || "",
        isOwner: isOwnerDisplayName(name) || Boolean(fallback.isOwner),
        isSelf: true,
        loading: false,
      });
    };

    const openDmChannel = async (userId, fallback = {}) => {
      let id = String(userId || "").trim();
      if (!id || id === session.selfId) return;

      let profile = userProfiles.get(id) || fallback;
      const onlineMatch = session.onlineUsers.find(
        (user) =>
          user.userId &&
          normalizeDisplayNameKey(user.name) === normalizeDisplayNameKey(profile.name || fallback.name),
      );
      if (onlineMatch) {
        id = onlineMatch.userId;
        profile = onlineMatch;
      }

      trackRecentThread(id, profile);
      reopenDmThread(profile.name || fallback.name || "");
      closeProfilePopover();
      await switchChannel(id, profile);
      inputEl?.focus({ preventScroll: true });
    };

    const openUserProfile = (userId, fallback = {}) => {
      const id = String(userId || "").trim();
      if (!id) return;
      if (id === session.selfId || fallback.isSelf) {
        openSelfProfile(fallback);
        return;
      }

      const cached = userProfiles.get(id);
      showProfilePopover({
        userId: id,
        name: cached?.name || fallback.name || "Guest",
        bio: cached?.bio || "",
        avatar: cached?.avatar || "",
        isOwner: Boolean(cached?.isOwner ?? fallback.isOwner),
        loading: session.state === "live",
      });
      if (session.state === "live") requestUserProfile(id);
    };

    const requestDmHistory = (userId, userName) => {
      const id = String(userId || "").trim();
      if (!id || !session.socket || session.socket.readyState !== WebSocket.OPEN) return;
      try {
        session.socket.send(
          JSON.stringify({
            type: "dm_history",
            withUserId: id,
            withUserName: String(userName || getPeerProfile(id).name || "").trim(),
          }),
        );
      } catch {
        // ignore
      }
    };

    const renderDmHistory = (userId, history, peerName) => {
      if (session.activeChannel !== userId) return;
      syncActiveMessageIds();
      messagesEl.querySelectorAll(".community-chat-msg").forEach((node) => node.remove());
      session.messageIds.clear();
      (history || []).forEach((entry) => {
        renderMessage(dmToRenderMessage(entry, session.selfId), {
          isSelf: entry.fromUserId === session.selfId,
        });
      });
      if (peerName) persistDmThread(peerName, history, getHistoryMaxSize(session.config));
      syncMessageAvatars();
      updateUi();
    };

    const switchChannel = async (channel, meta = {}) => {
      const nextChannel = channel === "lobby" ? "lobby" : String(channel || "").trim();
      if (!nextChannel) return;
      setFriendsMenuOpen(false);
      session.activeChannel = nextChannel;
      if (nextChannel === "lobby") session.lobbyUnread = 0;
      session.dmUnread.set(nextChannel, 0);
      syncActiveMessageIds();
      closeProfilePopover();
      renderSidebar();

      messagesEl.querySelectorAll(".community-chat-msg").forEach((node) => node.remove());
      session.messageIds.clear();

      if (nextChannel === "lobby") {
        await loadAndRenderHistory();
        updateUi();
        return;
      }

      const peer = userProfiles.get(nextChannel) || meta;
      trackRecentThread(nextChannel, peer);
      const local = getDmThread(peer.name);
      local.forEach((entry) => {
        renderMessage(dmToRenderMessage(entry, session.selfId), {
          isSelf: entry.fromUserId === session.selfId,
        });
      });
      requestDmHistory(nextChannel, peer.name);
      updateUi();
    };

    const createDmSidebarItem = (user) => {
      const userId = String(user.userId || user.id || "").trim();
      const name = String(user.name || "").trim();
      if (!userId || !name || userId === session.selfId) return null;

      const wrap = document.createElement("div");
      wrap.className = "community-chat-dm-item-wrap";

      const button = document.createElement("button");
      button.type = "button";
      button.className = "community-chat-sidebar-item community-chat-dm-item";
      button.setAttribute("aria-label", `Open chat with ${name}`);
      if (session.activeChannel === userId) button.classList.add("active");

      const avatar = createChatAvatar(name, user.avatar || "");
      avatar.classList.add("community-chat-dm-avatar");
      button.appendChild(avatar);

      const label = document.createElement("span");
      label.className = "community-chat-sidebar-label community-chat-dm-label";
      label.textContent = name;
      button.appendChild(label);

      const unread = session.dmUnread.get(userId) || 0;
      if (unread > 0 && session.activeChannel !== userId) {
        const badge = document.createElement("span");
        badge.className = "community-chat-unread-badge community-chat-dm-item-unread";
        badge.textContent = formatUnreadCount(unread);
        badge.setAttribute("data-count", String(unread));
        button.appendChild(badge);
      }

      button.addEventListener("click", () => {
        void openDmChannel(userId, user);
      });

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "community-chat-dm-item-close";
      closeBtn.setAttribute("aria-label", `Close chat with ${name}`);
      closeBtn.innerHTML = '<i class="ri-close-line" aria-hidden="true"></i>';
      closeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeDmThread(userId, name);
      });

      wrap.appendChild(button);
      wrap.appendChild(closeBtn);
      return wrap;
    };

    let friendsMenuCloseTimer = 0;
    let friendsMenuCloseFallback = 0;
    let friendsMenuPositionFrame = 0;

    const getBorderWidthPx = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--border-width").trim();
      if (!raw) return 2;
      if (raw.endsWith("px")) return Number.parseFloat(raw) || 2;
      return Number.parseFloat(raw) || 2;
    };

    const syncFriendsMenuClasses = () => {
      if (!friendsMenu || !friendsWrap) return;
      friendsMenu.classList.toggle("is-open", friendsWrap.classList.contains("is-open"));
      friendsMenu.classList.toggle("is-closing", friendsWrap.classList.contains("is-closing"));
      friendsMenu.classList.toggle("is-menu-revealed", friendsWrap.classList.contains("is-menu-revealed"));
    };

    const portalFriendsMenu = () => {
      if (!friendsMenu || friendsMenu.classList.contains("is-portaled")) return;
      friendsMenu.classList.add("is-portaled");
      document.body.appendChild(friendsMenu);
    };

    const restoreFriendsMenu = () => {
      if (!friendsMenu || !friendsWrap) return;
      friendsMenu.classList.remove("is-portaled", "is-open", "is-closing", "is-menu-revealed");
      if (friendsMenu.parentElement !== friendsWrap) {
        friendsWrap.appendChild(friendsMenu);
      }
    };

    const getSidebarBorderMotionMs = () => {
      if (document.body.classList.contains("reduce-motion")) return 0;
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--button-motion-duration").trim();
      if (!raw) return 300;
      if (raw.endsWith("ms")) return Number.parseFloat(raw) || 300;
      if (raw.endsWith("s")) return (Number.parseFloat(raw) || 0.3) * 1000;
      return Number.parseFloat(raw) || 300;
    };

    const getSidebarFlyoutMotionMs = () => {
      if (document.body.classList.contains("reduce-motion")) return 0;
      const raw = getComputedStyle(document.documentElement)
        .getPropertyValue("--sidebar-flyout-motion-duration")
        .trim();
      if (!raw) return getSidebarBorderMotionMs();
      if (raw.endsWith("ms")) return Number.parseFloat(raw) || 300;
      if (raw.endsWith("s")) return (Number.parseFloat(raw) || 0.3) * 1000;
      return Number.parseFloat(raw) || 300;
    };

    const setChatSidebarMenuBorderGap = (sidebar, gapStart, gapEnd) => {
      if (!sidebar) return;
      sidebar.style.setProperty("--sidebar-menu-border-gap-start", `${gapStart}px`);
      sidebar.style.setProperty("--sidebar-menu-border-gap-end", `${gapEnd}px`);
    };

    const clearChatSidebarMenuBorderGap = (sidebar) => {
      if (!sidebar) return;
      sidebar.style.removeProperty("--sidebar-menu-border-gap-start");
      sidebar.style.removeProperty("--sidebar-menu-border-gap-end");
    };

    const clearChatFriendsMenuVars = () => {
      if (sidebarEl) {
        clearChatSidebarMenuBorderGap(sidebarEl);
        delete sidebarEl.dataset.borderRestoring;
      }
      friendsMenu?.style.removeProperty("top");
      friendsMenu?.style.removeProperty("left");
      friendsMenu?.style.removeProperty("max-height");
    };

    const computeChatFriendsMenuMetrics = () => {
      if (!sidebarEl || !friendsWrap || !friendsToggle || !friendsMenu) return null;

      const sidebarRect = sidebarEl.getBoundingClientRect();
      const toggleRect = friendsToggle.getBoundingClientRect();
      const borderWidth = getBorderWidthPx();
      const padding = 8;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;
      const viewportMenuTop = Math.round(toggleRect.top);
      const viewportMenuLeft = Math.round(sidebarRect.right - borderWidth);
      const offsetTop = Math.max(0, Math.round(toggleRect.top - sidebarRect.top));
      const menuHeight = friendsMenu.scrollHeight;
      const availableBelow = viewportOffsetTop + viewportHeight - padding - viewportMenuTop;
      const maxHeight = Math.max(Math.min(menuHeight, availableBelow), 120);
      const gapStart = offsetTop;
      const gapEnd = Math.max(gapStart, offsetTop + friendsMenu.offsetHeight);

      return { offsetTop, maxHeight, gapStart, gapEnd, viewportMenuTop, viewportMenuLeft };
    };

    const applyChatFriendsMenuMetrics = (metrics) => {
      if (!metrics || !friendsMenu) return;
      friendsMenu.style.top = `${metrics.viewportMenuTop}px`;
      friendsMenu.style.left = `${metrics.viewportMenuLeft}px`;
      friendsMenu.style.maxHeight = `${metrics.maxHeight}px`;
    };

    const openChatFriendsMenuBorderGap = (sidebar, gapStart, gapEnd, { onComplete } = {}) => {
      if (!sidebar) {
        onComplete?.();
        return;
      }

      if (document.body.classList.contains("reduce-motion") || !getSidebarBorderMotionMs()) {
        setChatSidebarMenuBorderGap(sidebar, gapStart, gapEnd);
        onComplete?.();
        return;
      }

      const gapCenter = Math.round((gapStart + gapEnd) / 2);
      sidebar.classList.add("sidebar-border-gap-no-transition");
      setChatSidebarMenuBorderGap(sidebar, gapCenter, gapCenter);
      requestAnimationFrame(() => {
        sidebar.classList.remove("sidebar-border-gap-no-transition");
        requestAnimationFrame(() => {
          setChatSidebarMenuBorderGap(sidebar, gapStart, gapEnd);
          window.setTimeout(() => onComplete?.(), getSidebarBorderMotionMs());
        });
      });
    };

    const closeChatFriendsMenuBorderGap = (sidebar, gapStart, gapEnd, onComplete) => {
      if (!sidebar) {
        onComplete?.();
        return;
      }

      const borderRestoreMs = getSidebarBorderMotionMs();
      if (document.body.classList.contains("reduce-motion") || !borderRestoreMs) {
        clearChatSidebarMenuBorderGap(sidebar);
        onComplete?.();
        return;
      }

      sidebar.dataset.borderRestoring = "true";
      const gapCenter = Math.round((gapStart + gapEnd) / 2);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setChatSidebarMenuBorderGap(sidebar, gapCenter, gapCenter);
          window.setTimeout(() => {
            delete sidebar.dataset.borderRestoring;
            clearChatSidebarMenuBorderGap(sidebar);
            onComplete?.();
          }, borderRestoreMs);
        });
      });
    };

    const syncChatFriendsMenuPosition = () => {
      if (!sidebarEl || !friendsWrap || !friendsMenu || !friendsWrap) return;
      if (sidebarEl.dataset.borderRestoring === "true") return;
      if (friendsWrap.classList.contains("is-closing")) return;

      if (friendsMenu.hidden) {
        clearChatFriendsMenuVars();
        return;
      }

      const metrics = computeChatFriendsMenuMetrics();
      if (!metrics) return;

      applyChatFriendsMenuMetrics(metrics);

      if (friendsWrap.classList.contains("is-open") && friendsWrap.classList.contains("is-menu-revealed")) {
        setChatSidebarMenuBorderGap(sidebarEl, metrics.gapStart, metrics.gapEnd);
      }
    };

    const stopFriendsMenuPositionTracking = () => {
      if (friendsMenuPositionFrame) cancelAnimationFrame(friendsMenuPositionFrame);
      friendsMenuPositionFrame = 0;
    };

    const startFriendsMenuPositionTracking = () => {
      stopFriendsMenuPositionTracking();
      const tick = () => {
        if (!friendsWrap?.classList.contains("is-open") && !friendsWrap?.classList.contains("is-closing")) {
          stopFriendsMenuPositionTracking();
          return;
        }
        syncChatFriendsMenuPosition();
        friendsMenuPositionFrame = requestAnimationFrame(tick);
      };
      tick();
    };

    const finishFriendsMenuClose = () => {
      if (!friendsWrap || !friendsMenu || !friendsToggle) return;
      clearTimeout(friendsMenuCloseFallback);
      stopFriendsMenuPositionTracking();
      friendsWrap.classList.remove("is-open", "is-closing", "is-menu-revealed");
      syncFriendsMenuClasses();
      friendsMenu.hidden = true;
      friendsMenu.setAttribute("aria-hidden", "true");
      friendsToggle.setAttribute("aria-expanded", "false");
      friendsToggle.classList.remove("active");
      clearChatFriendsMenuVars();
      restoreFriendsMenu();
    };

    const beginFriendsMenuOpen = () => {
      if (!friendsWrap || !friendsToggle || !friendsMenu || !sidebarEl) return;

      friendsWrap.classList.remove("is-closing", "is-menu-revealed");
      portalFriendsMenu();
      friendsWrap.classList.add("is-open");
      syncFriendsMenuClasses();
      friendsMenu.hidden = false;
      friendsMenu.setAttribute("aria-hidden", "false");
      friendsToggle.setAttribute("aria-expanded", "true");
      friendsToggle.classList.add("active");
      renderFriendsMenu();

      const revealFriendsMenu = () => {
        const metrics = computeChatFriendsMenuMetrics();
        if (!metrics) return;

        applyChatFriendsMenuMetrics(metrics);

        if (document.body.classList.contains("reduce-motion")) {
          setChatSidebarMenuBorderGap(sidebarEl, metrics.gapStart, metrics.gapEnd);
          friendsWrap.classList.add("is-menu-revealed");
          syncFriendsMenuClasses();
          startFriendsMenuPositionTracking();
          return;
        }

        openChatFriendsMenuBorderGap(sidebarEl, metrics.gapStart, metrics.gapEnd, {
          onComplete: () => {
            friendsWrap.classList.add("is-menu-revealed");
            syncFriendsMenuClasses();
            syncChatFriendsMenuPosition();
            startFriendsMenuPositionTracking();
          },
        });
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(revealFriendsMenu);
      });
    };

    const beginFriendsMenuClose = () => {
      if (!friendsWrap || !friendsMenu || !friendsToggle || !sidebarEl) return;

      friendsToggle.setAttribute("aria-expanded", "false");
      friendsToggle.classList.remove("active");

      const gapStart =
        parseFloat(sidebarEl.style.getPropertyValue("--sidebar-menu-border-gap-start")) || 0;
      const gapEnd =
        parseFloat(sidebarEl.style.getPropertyValue("--sidebar-menu-border-gap-end")) || gapStart;

      if (document.body.classList.contains("reduce-motion")) {
        friendsWrap.classList.remove("is-menu-revealed");
        friendsWrap.classList.add("is-closing");
        syncFriendsMenuClasses();
        finishFriendsMenuClose();
        return;
      }

      let borderCloseStarted = false;
      const flyoutMotionMs = getSidebarFlyoutMotionMs();

      const startBorderClose = () => {
        if (borderCloseStarted) return;
        borderCloseStarted = true;
        clearTimeout(friendsMenuCloseFallback);
        friendsMenu.removeEventListener("transitionend", onMenuEnd);
        closeChatFriendsMenuBorderGap(sidebarEl, gapStart, gapEnd, finishFriendsMenuClose);
      };

      const onMenuEnd = (event) => {
        if (event.target !== friendsMenu || event.propertyName !== "clip-path") return;
        startBorderClose();
      };

      const startMenuClose = () => {
        stopFriendsMenuPositionTracking();
        friendsWrap.classList.remove("is-menu-revealed");
        friendsWrap.classList.add("is-closing");
        syncFriendsMenuClasses();
        friendsMenu.addEventListener("transitionend", onMenuEnd);
        friendsMenuCloseFallback = window.setTimeout(() => {
          if (!borderCloseStarted) startBorderClose();
        }, flyoutMotionMs + 100);
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(startMenuClose);
      });
    };

    const setFriendsMenuOpen = (open) => {
      if (!friendsWrap || !friendsToggle || !friendsMenu) return;
      clearTimeout(friendsMenuCloseTimer);
      clearTimeout(friendsMenuCloseFallback);

      if (open) {
        if (friendsWrap.classList.contains("is-open")) return;
        beginFriendsMenuOpen();
        return;
      }

      if (friendsWrap.classList.contains("is-closing") || !friendsWrap.classList.contains("is-open")) {
        return;
      }

      beginFriendsMenuClose();
    };

    const scheduleFriendsMenuClose = () => {
      clearTimeout(friendsMenuCloseTimer);
      friendsMenuCloseTimer = window.setTimeout(() => {
        if (!friendsWrap?.classList.contains("is-open")) return;
        if (
          sidebarEl?.matches(":hover") ||
          friendsWrap.matches(":hover") ||
          friendsMenu?.matches(":hover")
        ) {
          return;
        }
        setFriendsMenuOpen(false);
      }, 120);
    };

    const handleSidebarMouseLeave = (event) => {
      const related = event.relatedTarget;
      if (related instanceof Node && friendsMenu?.contains(related)) return;

      if (friendsWrap?.classList.contains("is-open")) {
        cancelFriendsMenuClose();
        setFriendsMenuOpen(false);
      } else {
        scheduleFriendsMenuClose();
      }

      const active = document.activeElement;
      if (active instanceof HTMLElement && sidebarEl?.contains(active) && !friendsMenu?.contains(active)) {
        active.blur();
      }
    };

    const cancelFriendsMenuClose = () => {
      clearTimeout(friendsMenuCloseTimer);
    };

    const createFriendMenuItem = (user) => {
      const userId = String(user.userId || user.id || "").trim();
      const name = String(user.name || "").trim();
      if (!userId || !name || userId === session.selfId) return null;

      const button = document.createElement("button");
      button.type = "button";
      button.role = "menuitem";
      button.className = "community-chat-friends-menu-item";
      button.setAttribute("aria-label", `View ${name}'s profile`);

      const avatar = createChatAvatar(name, user.avatar || "");
      avatar.classList.add("community-chat-friends-menu-avatar");
      button.appendChild(avatar);

      const label = document.createElement("span");
      label.className = "community-chat-friends-menu-name";
      label.textContent = name;
      button.appendChild(label);

      button.addEventListener("click", () => {
        setFriendsMenuOpen(false);
        openUserProfile(userId, user);
      });

      return button;
    };

    const renderFriendsMenu = () => {
      if (!friendsOnlineListEl) return;
      friendsOnlineListEl.replaceChildren();

      const users = session.onlineUsers
        .filter((user) => user.userId && user.userId !== session.selfId)
        .sort((a, b) => a.name.localeCompare(b.name));

      if (!users.length) {
        const empty = document.createElement("p");
        empty.className = "community-chat-friends-menu-empty";
        empty.textContent = "No one online right now.";
        friendsOnlineListEl.appendChild(empty);
        return;
      }

      users.forEach((user) => {
        const item = createFriendMenuItem(user);
        if (item) friendsOnlineListEl.appendChild(item);
      });

      if (friendsWrap?.classList.contains("is-open")) {
        syncChatFriendsMenuPosition();
      }
    };

    const renderSidebar = () => {
      if (lobbyBtn) {
        const inLobby = session.activeChannel === "lobby";
        lobbyBtn.classList.toggle("active", inLobby);
        lobbyBtn.toggleAttribute("aria-current", inLobby);
      }

      if (dmListEl) {
        dmListEl.replaceChildren();
        const entries = [...session.recentThreads.values()].filter(
          (thread) => thread.userId && thread.userId !== session.selfId,
        );

        const hasDms = entries.length > 0;
        if (messagesHeadingEl) messagesHeadingEl.hidden = !hasDms;
        dmListEl.hidden = !hasDms;
        entries.forEach((user) => {
          const item = createDmSidebarItem(user);
          if (item) dmListEl.appendChild(item);
        });
      }

      renderFriendsMenu();
      syncNotifyBadges();
    };

    const handleIncomingDm = (dm) => {
      const peerUserId = dm.fromUserId === session.selfId ? dm.toUserId : dm.fromUserId;
      const peerName = dm.fromUserId === session.selfId ? dm.toName : dm.fromName;
      const peerAvatar = dm.fromUserId === session.selfId ? dm.toAvatar : dm.fromAvatar;
      const peerIsOwner = dm.fromUserId === session.selfId ? dm.toIsOwner : dm.fromIsOwner;

      upsertUserProfile(peerUserId, {
        name: peerName,
        avatar: peerAvatar,
        isOwner: Boolean(peerIsOwner),
      });
      trackRecentThread(peerUserId, { name: peerName, avatar: peerAvatar, isOwner: peerIsOwner });
      persistDmThread(peerName, [dm], getHistoryMaxSize(session.config));

      const ids = getChannelMessageIds(peerUserId);
      if (ids.has(dm.id)) {
        renderSidebar();
        return;
      }

      if (session.activeChannel === peerUserId) {
        syncActiveMessageIds();
        renderMessage(dmToRenderMessage(dm, session.selfId), {
          isSelf: dm.fromUserId === session.selfId,
        });
      } else if (dm.fromUserId !== session.selfId) {
        ids.add(dm.id);
        session.dmUnread.set(peerUserId, (session.dmUnread.get(peerUserId) || 0) + 1);
        playChatPingSound();
      } else {
        ids.add(dm.id);
      }
      renderSidebar();
    };

    const setState = (state) => {
      session.state = state;
      panel.dataset.chatState = state;
      if (state !== "live" && onlineEl) {
        onlineEl.textContent = formatChatOpenLabel(0);
      }
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
      const peer = getActivePeer();
      const inDm = session.activeChannel !== "lobby";

      if (sendBtn) sendBtn.disabled = offline || !nameOk || !inputEl.value.trim();
      if (inputEl) {
        inputEl.disabled = offline || !nameOk;
        inputEl.maxLength = Number(session.config.limits?.max_message_length) || 500;
        if (!nameOk) {
          inputEl.placeholder =
            session.config.ui?.name_required_message || DEFAULT_CONFIG.ui.name_required_message;
        } else if (inDm && peer?.name) {
          inputEl.placeholder =
            session.config.ui?.dm_placeholder || DEFAULT_CONFIG.ui.dm_placeholder;
        } else {
          inputEl.placeholder = session.config.ui?.placeholder || DEFAULT_CONFIG.ui.placeholder;
        }
      }

      if (titleEl) {
        if (inDm && peer?.name) {
          const prefix = session.config.ui?.dm_title_prefix || DEFAULT_CONFIG.ui.dm_title_prefix;
          titleEl.textContent = `${prefix} ${peer.name}`;
        } else {
          titleEl.textContent = session.config.ui?.public_chat_title || "Public";
        }
      }

      if (statusEl) {
        statusEl.textContent = session.state === "live" ? "Online" : "Offline";
      }

      if (profileMessageBtn && profileMessageBtn.dataset.userId) {
        profileMessageBtn.hidden = offline || profileMessageBtn.dataset.userId === session.selfId;
      }

      if (dmCloseBtn) dmCloseBtn.hidden = !inDm;
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
      if (isOwnerDisplayName(message.name)) nameWrap.appendChild(createOwnerPill());

      const trigger = document.createElement("button");
      trigger.type = "button";
      trigger.className = "community-chat-profile-trigger";
      trigger.setAttribute("aria-label", self ? "View your profile" : `View ${message.name || "Guest"}'s profile`);
      if (self) {
        trigger.appendChild(avatar);
        trigger.appendChild(nameWrap);
        head.appendChild(trigger);
        head.appendChild(time);
      } else {
        trigger.appendChild(nameWrap);
        trigger.appendChild(avatar);
        head.appendChild(time);
        head.appendChild(trigger);
      }
      trigger.addEventListener("click", () => {
        openUserProfile(message.userId || session.selfId, {
          name: message.name,
          isOwner: Boolean(message.isOwner),
          isSelf: self,
        });
      });

      item.appendChild(head);

      const bubble = document.createElement("div");
      bubble.className = "site-assistant-bubble";
      bubble.textContent = message.text || "";

      item.appendChild(bubble);
      messagesEl.appendChild(item);
      scrollToBottom();
    };

    const renderHistory = (history) => {
      if (!history?.length && messagesEl.querySelector(".community-chat-msg")) return;

      syncActiveMessageIds();
      messagesEl.querySelectorAll(".community-chat-msg").forEach((node) => node.remove());
      session.messageIds.clear();
      (history || []).forEach((message) => {
        renderMessage(message, { isSelf: isSelfMessage(message) });
      });
      syncMessageAvatars();
      updateUi();
    };

    const loadAndRenderHistory = async (...sources) => {
      if (session.activeChannel !== "lobby") return;
      const fromLocal = readLocalChatHistory();
      const fromHttp = session.wsUrl ? await fetchChatHistory(session.wsUrl) : [];
      const merged = mergeHistoryMessages(fromLocal, ...sources, fromHttp);
      if (!merged.length) return;
      renderHistory(merged);
      persistChatHistory(merged);
    };

    const persistChatHistory = (messages) => {
      writeLocalChatHistory(messages, getHistoryMaxSize(session.config));
    };

    const persistChatMessage = (message) => {
      const normalized = normalizeStoredHistoryMessage(message);
      if (!normalized) return;
      persistChatHistory(mergeHistoryMessages(readLocalChatHistory(), [normalized]));
    };

    const renderPresence = ({ online, chatOpen, users } = {}) => {
      const count = Number.isFinite(chatOpen) ? chatOpen : online;
      if (onlineEl) onlineEl.textContent = formatChatOpenLabel(count);
      syncOnlineDisplayNames(users);
      session.onlineUsers = (users || [])
        .map((user) =>
          typeof user === "string"
            ? { userId: "", name: user, avatar: "", isOwner: isOwnerDisplayName(user) }
            : {
                userId: user?.userId || user?.id || "",
                name: user?.name || "",
                bio: user?.bio || "",
                avatar: user?.avatar || "",
                isOwner: Boolean(user?.isOwner),
              },
        )
        .filter((user) => user.userId && user.name);
      session.onlineUsers.forEach((entry) => {
        if (entry.userId) upsertUserProfile(entry.userId, entry);
      });
      syncMessageAvatars();
      renderSidebar();
    };

    const sendPanelOpenState = (open) => {
      session.panelOpen = Boolean(open);
      if (session.panelOpen && session.activeChannel === "lobby") session.lobbyUnread = 0;
      if (!session.socket || session.socket.readyState !== WebSocket.OPEN) {
        syncNotifyBadges();
        return;
      }
      try {
        session.socket.send(JSON.stringify({ type: "panel_open", open: session.panelOpen }));
      } catch {
        // ignore
      }
      syncNotifyBadges();
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
        if (session.activeChannel === "lobby") {
          session.socket?.send(JSON.stringify({ type: "message", text }));
          global.MorningRoastProfileTags?.recordChatMessage?.();
        } else {
          session.socket?.send(JSON.stringify({ type: "dm", toUserId: session.activeChannel, text }));
        }
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
        global.dispatchEvent(new CustomEvent("morning-roast:chat-connected"));
        if (session.activeChannel === "lobby") {
          void loadAndRenderHistory();
        } else {
          void switchChannel(session.activeChannel, getPeerProfile(session.activeChannel));
        }
        sendJoin();
        sendPanelOpenState(session.panelOpen);
      });

      socket.addEventListener("message", async (event) => {
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
            await (session.activeChannel === "lobby"
              ? loadAndRenderHistory(message.history || [])
              : Promise.resolve());
            if (session.activeChannel !== "lobby") {
              requestDmHistory(session.activeChannel, getPeerProfile(session.activeChannel).name);
            }
            renderPresence({ online: message.online, chatOpen: message.chatOpen, users: [] });
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
          case "message": {
            const ids = getChannelMessageIds("lobby");
            if (ids.has(message.id)) break;
            const self = isSelfMessage(message);
            if (!self && (!session.panelOpen || session.activeChannel !== "lobby")) {
              session.lobbyUnread += 1;
              playChatPingSound();
            }
            if (session.activeChannel === "lobby") {
              syncActiveMessageIds();
              renderMessage(message, { isSelf });
            } else {
              ids.add(message.id);
            }
            persistChatMessage(message);
            syncNotifyBadges();
            updateUi();
            break;
          }
          case "dm":
            handleIncomingDm(message);
            updateUi();
            break;
          case "dm_history":
            if (message.withUserId && session.activeChannel === message.withUserId) {
              renderDmHistory(message.withUserId, message.history || [], message.withUserName);
            } else if (message.withUserId && message.withUserName) {
              persistDmThread(message.withUserName, message.history || [], getHistoryMaxSize(session.config));
            }
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
          case "lineup_comments":
          case "lineup_comment":
          case "lineup_comment_vote":
            global.dispatchEvent(new CustomEvent("morning-roast:lineup-comments", { detail: message }));
            break;
          case "error":
            if (message.code === "name_required") {
              updateUi();
              global.dispatchEvent(new CustomEvent("morning-roast:lineup-comments", { detail: message }));
            }
            if (message.code === "comment_limit") {
              global.Toast?.notify?.({
                message: message.message || "This lineup has reached the comment limit.",
                type: "error",
              });
              global.dispatchEvent(new CustomEvent("morning-roast:lineup-comments", { detail: { type: "lineup_comment_failed" } }));
            }
            if (message.code === "rate_limited") {
              global.Toast?.notify?.({
                message: message.message || "Slow down — wait a moment before sending another message.",
                type: "error",
              });
              global.dispatchEvent(new CustomEvent("morning-roast:lineup-comments", { detail: { type: "lineup_comment_failed" } }));
            }
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
            if (message.code === "user_offline") {
              global.Toast?.notify?.({
                message: message.message || session.config.ui?.dm_offline_message || DEFAULT_CONFIG.ui.dm_offline_message,
                type: "error",
              });
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

    if (typeof global.attachUiTooltip === "function") {
      global.attachUiTooltip(lobbyBtn, "Public chat", { placement: "right" });
      global.attachUiTooltip(friendsToggle, "Friends", { placement: "right" });
    }

    lobbyBtn?.addEventListener("click", () => {
      setFriendsMenuOpen(false);
      void switchChannel("lobby");
    });

    friendsToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (friendsWrap?.classList.contains("is-closing")) return;
      setFriendsMenuOpen(!friendsWrap?.classList.contains("is-open"));
    });

    friendsMenu?.addEventListener("click", (event) => {
      if (event.target.closest(".community-chat-friends-menu-item")) {
        setFriendsMenuOpen(false);
      }
    });

    friendsMenu?.addEventListener("mouseenter", cancelFriendsMenuClose);
    friendsMenu?.addEventListener("mouseleave", (event) => {
      const related = event.relatedTarget;
      if (related instanceof Node && sidebarEl?.contains(related)) return;
      if (friendsWrap?.classList.contains("is-open")) {
        cancelFriendsMenuClose();
        setFriendsMenuOpen(false);
      } else {
        scheduleFriendsMenuClose();
      }
    });

    friendsWrap?.addEventListener("mouseenter", cancelFriendsMenuClose);

    root.addEventListener("click", (event) => {
      if (event.target.closest("#community-chat-friends-toggle")) return;
      if (
        friendsWrap?.classList.contains("is-open") &&
        !friendsWrap.contains(event.target) &&
        !friendsMenu?.contains(event.target)
      ) {
        setFriendsMenuOpen(false);
      }
    });

    root.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && friendsWrap?.classList.contains("is-open")) {
        setFriendsMenuOpen(false);
        friendsToggle?.focus();
      }
    });

    dmCloseBtn?.addEventListener("click", () => {
      void switchChannel("lobby");
    });

    sidebarEl?.addEventListener("transitionend", (event) => {
      if (event.propertyName === "width") {
        syncChatFriendsMenuPosition();
      }
    });

    global.addEventListener("resize", () => syncChatFriendsMenuPosition());
    window.visualViewport?.addEventListener("resize", () => syncChatFriendsMenuPosition());

    sidebarEl?.addEventListener("mouseleave", handleSidebarMouseLeave);

    profileMessageBtn?.addEventListener("click", () => {
      const userId = profileMessageBtn.dataset.userId || "";
      const userName = profileMessageBtn.dataset.userName || "";
      if (!userId) return;
      void openDmChannel(userId, { name: userName });
    });

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
        finishFriendsMenuClose();
        activeSession = null;
      },
      reconnect() {
        session.stopped = false;
        session.reconnectMs = RECONNECT_BASE_MS;
        connect();
      },
      refreshIdentity() {
        sendJoin();
        sendPanelOpenState(session.panelOpen);
        updateUi();
      },
      setPanelOpen: sendPanelOpenState,
      focusComposer() {
        if (!inputEl.disabled) inputEl.focus({ preventScroll: true });
      },
      closeProfile: closeProfilePopover,
      isProfileOpen: () => Boolean(profilePopover && !profilePopover.hidden),
      getState: () => session.state,
      sendPayload(payload) {
        if (!session.socket || session.socket.readyState !== WebSocket.OPEN) return false;
        try {
          session.socket.send(JSON.stringify(payload));
          return true;
        } catch {
          return false;
        }
      },
      isConnected() {
        return session.state === "live" && session.socket?.readyState === WebSocket.OPEN;
      },
      ensureJoined() {
        sendJoin();
      },
      getWsUrl: () => session.wsUrl || "",
    };

    activeSession = session;

    (async () => {
      const provisionalUrl = resolveChatWsUrl(DEFAULT_CONFIG);
      session.config = await fetchChatConfig(provisionalUrl);
      if (session.config.owners?.display_names?.length) {
        setOwnerDisplayNames(session.config.owners.display_names);
      }
      session.wsUrl = resolveChatWsUrl(session.config);
      hydrateRecentThreadsFromStorage(trackRecentThread, closedDmKeys);
      renderSidebar();
      updateUi();
      if (session.activeChannel === "lobby") {
        const localHistory = readLocalChatHistory();
        if (localHistory.length) renderHistory(localHistory);
        await loadAndRenderHistory();
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
      chatApi?.setPanelOpen?.(open);
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
    resolveChatWsUrl: (config) => activeSession?.wsUrl || resolveChatWsUrl(config || DEFAULT_CONFIG),
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
    sendChatPayload: (payload) => activeSession?.api?.sendPayload?.(payload) || false,
    isChatConnected: () => activeSession?.api?.isConnected?.() || false,
    ensureChatJoined: () => {
      if (!activeSession?.api) initCommunityChatEntrypoints();
      activeSession?.api?.ensureJoined?.();
    },
    getChatPingSounds: () => CHAT_PING_SOUNDS.map((sound) => ({ ...sound })),
    getChatPingSoundId,
    getChatPingSound,
    setChatPingSoundId,
    playChatPingSound,
  };
})(window);
