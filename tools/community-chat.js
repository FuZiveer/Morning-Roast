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
  const CHAT_FRIENDS_STORAGE_KEY = "morningRoastChatFriends";
  const CHAT_PROFILES_STORAGE_KEY = "morningRoastChatProfiles";
  const CHAT_AUTHOR_ID_KEY = "morningRoastChatAuthorId";
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
      placeholder: "Send a message",
      dm_placeholder: "Send a message",
      dm_offline_message: "That user is offline.",
      dm_title_prefix: "Chat with",
      messages_title: "Private",
      messages_empty: "No messages yet. Open a profile to start a chat.",
      dm_empty: "No dms open",
      public_chat_title: "Public",
      empty_state: "No messages yet. Say hi!",
      offline_message: "Chat is offline. Try again in a moment.",
      name_required_message: "Set a display name on your Profile before chatting.",
      name_taken_message: "That display name is already in use. Choose another one.",
      name_blocked_message: "That display name is not allowed.",
      reconnecting_message: "Reconnecting to chat…",
      connecting_message: "Connecting to chat…",
      loading_message: "Loading messages…",
    },
  };

  let activeSession = null;
  let dockApi = null;
  let chatSelfUserId = "";
  let onlineDisplayNames = new Set();
  let userProfiles = new Map();
  let profilesByName = new Map();

  function readProfileStore() {
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(CHAT_PROFILES_STORAGE_KEY) || "{}");
      return parsed?.profiles && typeof parsed.profiles === "object" ? parsed.profiles : {};
    } catch {
      return {};
    }
  }

  function writeProfileStore(profiles) {
    if (!global.localStorage) return;
    try {
      global.localStorage.setItem(
        CHAT_PROFILES_STORAGE_KEY,
        JSON.stringify({ version: 1, updatedAt: Date.now(), profiles: profiles || {} }),
      );
    } catch {
      // Storage full or unavailable.
    }
  }

  function normalizeSavedProfile(entry = {}, fallbackName = "") {
    const name = String(entry.name || fallbackName || "").trim() || "Guest";
    return {
      name,
      avatar: String(entry.avatar || "").trim(),
      bio: String(entry.bio || "").trim(),
      isOwner: Boolean(entry.isOwner),
      updatedAt: Number(entry.updatedAt) || 0,
    };
  }

  function loadProfilesFromStorage() {
    profilesByName = new Map();
    for (const [key, entry] of Object.entries(readProfileStore())) {
      profilesByName.set(key, normalizeSavedProfile(entry, key));
    }
  }

  function getProfileForDisplayName(name) {
    const key = normalizeDisplayNameKey(name);
    if (!key) return null;
    return profilesByName.get(key) || null;
  }

  function listSavedProfiles() {
    return [...profilesByName.entries()]
      .map(([key, entry]) => {
        const profile = normalizeSavedProfile(entry, key);
        return { key, ...profile };
      })
      .filter((profile) => profile.name && profile.name !== "Guest")
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function upsertSavedProfile(profile = {}) {
    const name = String(profile.name || "").trim();
    const key = normalizeDisplayNameKey(name);
    if (!key) return null;

    const existing = profilesByName.get(key) || normalizeSavedProfile({}, name);
    const avatar = String(profile.avatar ?? existing.avatar ?? "").trim();
    const bio = String(profile.bio ?? existing.bio ?? "").trim();
    const next = {
      name: name || existing.name,
      avatar,
      bio,
      isOwner: Boolean(profile.isOwner ?? existing.isOwner ?? isOwnerDisplayName(name)),
      updatedAt: Date.now(),
    };

    profilesByName.set(key, next);
    const store = readProfileStore();
    store[key] = next;
    writeProfileStore(store);
    return next;
  }

  function seedSavedProfilesFromHistory() {
    const names = new Map();

    readLocalChatHistory().forEach((message) => {
      const name = String(message?.name || "").trim();
      if (!name) return;
      const key = normalizeDisplayNameKey(name);
      if (!key) return;
      const existing = names.get(key) || { name, avatar: "", isOwner: false };
      names.set(key, {
        name,
        avatar: String(message.avatar || existing.avatar || "").trim(),
        isOwner: Boolean(message.isOwner || existing.isOwner || isOwnerDisplayName(name)),
      });
    });

    const dmStore = readDmStore();
    for (const list of Object.values(dmStore.threads || {})) {
      (Array.isArray(list) ? list : []).forEach((entry) => {
        [
          { name: entry?.fromName, avatar: entry?.fromAvatar, isOwner: entry?.fromIsOwner },
          { name: entry?.toName, avatar: entry?.toAvatar, isOwner: entry?.toIsOwner },
        ].forEach((profile) => {
          const name = String(profile.name || "").trim();
          if (!name) return;
          const key = normalizeDisplayNameKey(name);
          if (!key) return;
          const existing = names.get(key) || { name, avatar: "", isOwner: false };
          names.set(key, {
            name,
            avatar: String(profile.avatar || existing.avatar || "").trim(),
            isOwner: Boolean(profile.isOwner || existing.isOwner || isOwnerDisplayName(name)),
          });
        });
      });
    }

    names.forEach((profile, key) => {
      const saved = profilesByName.get(key);
      upsertSavedProfile({
        name: profile.name,
        avatar: profile.avatar || saved?.avatar || "",
        isOwner: profile.isOwner || saved?.isOwner,
        bio: saved?.bio || "",
      });
    });
  }

  function getProfileForMessage(message = {}) {
    const byName = getProfileForDisplayName(message.name);
    if (byName?.avatar || byName?.bio) return byName;
    const userId = String(message.userId || "").trim();
    if (userId && userProfiles.has(userId)) return userProfiles.get(userId);
    if (byName) return byName;
    if (message.avatar) {
      return {
        name: String(message.name || "Guest").trim() || "Guest",
        avatar: String(message.avatar || "").trim(),
        bio: "",
        isOwner: Boolean(message.isOwner),
      };
    }
    return byName;
  }

  loadProfilesFromStorage();
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

  function readAuthorId() {
    try {
      return String(global.localStorage?.getItem(CHAT_AUTHOR_ID_KEY) || "").trim();
    } catch {
      return "";
    }
  }

  function writeAuthorId(authorId) {
    const id = String(authorId || "").trim();
    if (!id || !global.localStorage) return;
    try {
      global.localStorage.setItem(CHAT_AUTHOR_ID_KEY, id);
    } catch {
      // Storage full or unavailable.
    }
  }

  function getOrCreateAuthorId() {
    const existing = readAuthorId();
    if (existing) return existing;
    const created =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `author-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    writeAuthorId(created);
    return created;
  }

  function isLocalDevHost() {
    const host = global.location?.hostname;
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    if (!isLocalHost) return false;
    if (global.MorningRoastDesktop?.isDesktop) return false;
    return true;
  }

  function resolveChatWsUrl(config) {
    const path = config?.websocket?.path || "/chat";

    if (isLocalDevHost()) {
      const host = global.location.hostname;
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
    const avatar = String(message.avatar || "").trim();
    if (avatar) stored.avatar = avatar;
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
    const fromAvatar = String(message.fromAvatar || message.avatar || "").trim();
    const toAvatar = String(message.toAvatar || "").trim();
    if (fromAvatar) stored.fromAvatar = fromAvatar;
    if (toAvatar) stored.toAvatar = toAvatar;
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

  function resolvePeerNameFromDmStore(userId, selfName = readProfileIdentity().name) {
    const id = String(userId || "").trim();
    if (!id) return "";
    const selfKey = normalizeDisplayNameKey(selfName);
    const store = readDmStore();
    for (const list of Object.values(store.threads || {})) {
      for (const message of Array.isArray(list) ? list : []) {
        const normalized = normalizeStoredDmMessage(message);
        if (!normalized) continue;
        if (normalized.fromUserId === id) {
          const name = String(normalized.fromName || "").trim();
          if (name && normalizeDisplayNameKey(name) !== selfKey) return name;
        }
        if (normalized.toUserId === id) {
          const name = String(normalized.toName || "").trim();
          if (name && normalizeDisplayNameKey(name) !== selfKey) return name;
        }
      }
    }
    return "";
  }

  function resolveUserIdFromDmStore(peerName) {
    const nameKey = normalizeDisplayNameKey(peerName);
    if (!nameKey) return "";
    const store = readDmStore();
    for (const list of Object.values(store.threads || {})) {
      for (const message of Array.isArray(list) ? list : []) {
        const normalized = normalizeStoredDmMessage(message);
        if (!normalized) continue;
        if (normalizeDisplayNameKey(normalized.fromName) === nameKey && normalized.fromUserId) {
          return normalized.fromUserId;
        }
        if (normalizeDisplayNameKey(normalized.toName) === nameKey && normalized.toUserId) {
          return normalized.toUserId;
        }
      }
    }
    return "";
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

  function readFriendsStore() {
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(CHAT_FRIENDS_STORAGE_KEY) || "{}");
      return parsed?.friends && typeof parsed.friends === "object" ? parsed.friends : {};
    } catch {
      return {};
    }
  }

  function writeFriendsStore(friends) {
    if (!global.localStorage) return;
    try {
      global.localStorage.setItem(
        CHAT_FRIENDS_STORAGE_KEY,
        JSON.stringify({ version: 1, updatedAt: Date.now(), friends: friends || {} }),
      );
    } catch {
      // Storage full or unavailable.
    }
  }

  function listSavedFriends() {
    const selfKey = normalizeDisplayNameKey(readProfileIdentity().name);
    return Object.entries(readFriendsStore())
      .filter(([key]) => key && key !== selfKey)
      .map(([key, entry]) => ({
        key,
        name: String(entry?.name || "").trim() || key,
        avatar: String(entry?.avatar || ""),
        isOwner: Boolean(entry?.isOwner),
        addedAt: Number(entry?.addedAt) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function isSavedFriend(displayName) {
    const key = normalizeDisplayNameKey(displayName);
    return key ? Boolean(readFriendsStore()[key]) : false;
  }

  function addSavedFriend(profile = {}) {
    const name = String(profile.name || "").trim();
    const key = normalizeDisplayNameKey(name);
    const selfKey = normalizeDisplayNameKey(readProfileIdentity().name);
    if (!key || key === selfKey) return false;

    const friends = readFriendsStore();
    friends[key] = {
      name,
      avatar: String(profile.avatar || friends[key]?.avatar || ""),
      isOwner: Boolean(profile.isOwner ?? friends[key]?.isOwner),
      addedAt: friends[key]?.addedAt || Date.now(),
    };
    writeFriendsStore(friends);
    global.dispatchEvent(new CustomEvent("morning-roast:chat-friends-changed"));
    return true;
  }

  function removeSavedFriend(displayName) {
    const key = normalizeDisplayNameKey(displayName);
    if (!key || !readFriendsStore()[key]) return false;

    const friends = readFriendsStore();
    delete friends[key];
    writeFriendsStore(friends);
    global.dispatchEvent(new CustomEvent("morning-roast:chat-friends-changed"));
    return true;
  }

  function syncSavedFriendAvatarsFromOnline(onlineUsers = []) {
    const friends = readFriendsStore();
    let changed = false;

    onlineUsers.forEach((user) => {
      const key = normalizeDisplayNameKey(user?.name);
      if (!key || !friends[key]) return;
      const avatar = String(user?.avatar || "").trim();
      if (avatar && friends[key].avatar !== avatar) {
        friends[key].avatar = avatar;
        changed = true;
      }
      const isOwner = Boolean(user?.isOwner);
      if (friends[key].isOwner !== isOwner) {
        friends[key].isOwner = isOwner;
        changed = true;
      }
    });

    if (changed) writeFriendsStore(friends);
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
    const subtitleEl = root.querySelector("#community-chat-subtitle");
    const titleEl = root.querySelector("#community-chat-title");
    const membersToggle = root.querySelector("#community-chat-members-toggle");
    const membersPopover = root.querySelector("#community-chat-members-popover");
    const membersListEl = root.querySelector("#community-chat-members-list");
    const profilePopover = root.querySelector("#community-chat-profile-popover");
    const profileLoadingEl = root.querySelector("#community-chat-profile-loading");
    const profileCloseBtn = root.querySelector("#community-chat-profile-close");
    const profileAvatarEl = root.querySelector("#community-chat-profile-avatar");
    const profileNameEl = root.querySelector("#community-chat-profile-name");
    const profileTagsEl = root.querySelector("#community-chat-profile-tags");
    const profileBioEl = root.querySelector("#community-chat-profile-bio");
    const profileMessageBtn = root.querySelector("#community-chat-profile-message");
    const sidebarEl = root.querySelector("#community-chat-sidebar");
    const lobbyBtn = root.querySelector("#community-chat-lobby-btn");
    const lobbyBadge = root.querySelector("#community-chat-lobby-badge");
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
    const messagesLoadingEl = root.querySelector("#community-chat-messages-loading");
    const messagesLoadingTextEl = root.querySelector("#community-chat-messages-loading-text");

    if (!panel || !messagesEl || !formEl || !inputEl) return null;

    const closedDmKeys = readClosedDmKeys();
    let activeProfileView = null;

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
      pendingChannelLoad: true,
      api: null,
    };

    const getMessagesLoadingText = () => {
      const ui = session.config.ui || DEFAULT_CONFIG.ui;
      if (session.state === "offline" && session.wsUrl && !session.stopped) {
        return ui.reconnecting_message || DEFAULT_CONFIG.ui.reconnecting_message;
      }
      if (session.state === "connecting") {
        return ui.connecting_message || DEFAULT_CONFIG.ui.connecting_message;
      }
      return ui.loading_message || DEFAULT_CONFIG.ui.loading_message;
    };

    const refreshMessagesLoading = () => {
      if (!messagesLoadingEl) return;
      const reconnecting = session.state === "offline" && session.wsUrl && !session.stopped;
      const show =
        session.state === "connecting" ||
        reconnecting ||
        session.pendingChannelLoad;
      messagesLoadingEl.hidden = !show;
      messagesEl.toggleAttribute("aria-busy", show);
      if (show && messagesLoadingTextEl) {
        messagesLoadingTextEl.textContent = getMessagesLoadingText();
      }
    };

    const finishChannelLoad = () => {
      session.pendingChannelLoad = false;
      refreshMessagesLoading();
    };

    const beginChannelLoad = () => {
      session.pendingChannelLoad = true;
      refreshMessagesLoading();
    };

    const upsertUserProfile = (userId, profile = {}) => {
      const id = String(userId || "").trim();
      if (!id) return;
      const merged = {
        ...userProfiles.get(id),
        ...profile,
        userId: id,
        name: String(profile.name ?? userProfiles.get(id)?.name ?? "").trim(),
        bio: String(profile.bio ?? userProfiles.get(id)?.bio ?? "").trim(),
        avatar: String(profile.avatar ?? userProfiles.get(id)?.avatar ?? "").trim(),
        isOwner: Boolean(profile.isOwner ?? userProfiles.get(id)?.isOwner),
      };
      userProfiles.set(id, merged);
      if (merged.name) upsertSavedProfile(merged);
    };

    const resolveMessageAvatar = (message) => {
      if (message?.avatar) return message.avatar;
      const saved = getProfileForDisplayName(message?.name);
      if (saved?.avatar) return saved.avatar;
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
      messagesEl.querySelectorAll(".community-chat-msg").forEach((item) => {
        const userId = item.dataset.userId || "";
        const userName = item.dataset.userName || "";
        const profile = getProfileForMessage({ userId, name: userName });
        const avatarEl = item.querySelector(".community-chat-avatar");
        if (!avatarEl) return;
        const name = profile?.name || userName || "Guest";
        applyAvatarToElement(avatarEl, name, profile?.avatar || "");
      });
    };

    const hydrateMessageProfiles = () => {
      loadProfilesFromStorage();
      seedSavedProfilesFromHistory();
      syncMessageAvatars();
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
      activeProfileView = null;
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
      const cached = userProfiles.get(id);
      if (cached?.name && normalizeDisplayNameKey(cached.name) !== normalizeDisplayNameKey("Guest")) {
        return cached;
      }

      const thread = getRecentDmEntries().find((entry) => entry.userId === id);
      if (thread?.name) {
        return {
          userId: id,
          name: thread.name,
          avatar: String(thread.avatar || cached?.avatar || "").trim(),
          isOwner: Boolean(thread.isOwner ?? cached?.isOwner),
        };
      }

      const storedName = resolvePeerNameFromDmStore(id);
      if (storedName) {
        const saved = getProfileForDisplayName(storedName);
        return {
          userId: id,
          name: storedName,
          avatar: String(cached?.avatar || saved?.avatar || "").trim(),
          isOwner: Boolean(cached?.isOwner ?? saved?.isOwner),
        };
      }

      return cached || { userId: id, name: "", avatar: "", isOwner: false };
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

    const getRecentDmEntries = () =>
      [...session.recentThreads.values()].filter(
        (thread) => thread.userId && thread.userId !== session.selfId,
      );

    const hasRecentThreadWith = (userId, name) => {
      const id = String(userId || "").trim();
      const nameKey = normalizeDisplayNameKey(name);
      return getRecentDmEntries().some(
        (thread) =>
          (id && thread.userId === id) ||
          (nameKey && normalizeDisplayNameKey(thread.name) === nameKey),
      );
    };

    const resolveProfileMessageTarget = (profile = {}) => {
      const name = String(profile.name || "Guest").trim() || "Guest";
      const userId = String(profile.userId || "").trim();
      const isSelf = Boolean(profile.isSelf) || (userId && userId === session.selfId);
      if (isSelf) {
        return { isSelf: true, canMessage: false, resolvedUserId: "", name, onlineUser: null };
      }

      const onlineUser = resolveOnlineUser(userId, name);
      let resolvedUserId = String(onlineUser?.userId || userId || "").trim();
      if (!resolvedUserId) {
        const threadMatch = getRecentDmEntries().find(
          (thread) => normalizeDisplayNameKey(thread.name) === normalizeDisplayNameKey(name),
        );
        resolvedUserId = String(threadMatch?.userId || "").trim();
      }
      if (!resolvedUserId) {
        const cachedByName = [...userProfiles.values()].find(
          (entry) => normalizeDisplayNameKey(entry.name) === normalizeDisplayNameKey(name),
        );
        resolvedUserId = String(cachedByName?.userId || "").trim();
      }

      const canMessage =
        session.state === "live" &&
        Boolean(resolvedUserId) &&
        (Boolean(onlineUser) || hasRecentThreadWith(resolvedUserId, name));

      return { isSelf: false, canMessage, resolvedUserId, name, onlineUser };
    };

    const refreshActiveProfileActions = () => {
      if (!activeProfileView || activeProfileView.isSelf) return;
      showProfilePopover(activeProfileView);
    };

    const cycleDmChannel = () => {
      const entries = getRecentDmEntries();
      if (!entries.length) return;

      const activeIndex = entries.findIndex((entry) => entry.userId === session.activeChannel);
      const nextIndex = activeIndex === -1 ? 0 : (activeIndex + 1) % entries.length;
      const next = entries[nextIndex];
      if (next.userId === session.activeChannel) return;
      void openDmChannel(next.userId, next);
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
        if (session.activeChannel !== userId || !session.panelOpen) total += count;
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

    const getLobbyUnreadCount = () => {
      if (session.panelOpen && session.activeChannel === "lobby") return 0;
      return session.lobbyUnread;
    };

    const syncNotifyBadges = () => {
      syncUnreadBadge(friendsBadge, getTotalDmUnread());
      syncUnreadBadge(lobbyBadge, getLobbyUnreadCount());
      syncUnreadBadge(chatToggleBadge, getToggleUnreadCount());
      const chatToggle = document.getElementById("community-chat-toggle");
      chatToggle?.classList.toggle("has-unread", getToggleUnreadCount() > 0);
    };

    const getActivePeer = () => {
      if (session.activeChannel === "lobby") return null;
      return getPeerProfile(session.activeChannel);
    };

    const resolveOnlineUser = (userId, name) => {
      const id = String(userId || "").trim();
      const nameKey = normalizeDisplayNameKey(name);
      if (id) {
        const byId = session.onlineUsers.find((user) => user.userId === id);
        if (byId) return byId;
      }
      if (!nameKey) return null;
      return session.onlineUsers.find((user) => normalizeDisplayNameKey(user.name) === nameKey) || null;
    };

    const showProfilePopover = (profile = {}) => {
      if (!profilePopover || !profileNameEl || !profileBioEl || !profileAvatarEl) return;

      const name = String(profile.name || "Guest").trim() || "Guest";
      const bio = String(profile.bio || "").trim();
      const loading = Boolean(profile.loading);
      const userId = String(profile.userId || "").trim();
      const isSelf = Boolean(profile.isSelf) || (userId && userId === session.selfId);
      const { canMessage, resolvedUserId, onlineUser } = resolveProfileMessageTarget({
        ...profile,
        name,
        userId,
        isSelf,
      });

      applyAvatarToElement(profileAvatarEl, name, profile.avatar);
      profileNameEl.textContent = name;
      if (profileTagsEl) {
        profileTagsEl.dataset.tagsExpanded = "0";
        renderChatProfileTags(profileTagsEl, name);
      }
      profileBioEl.textContent = bio || "No bio yet.";

      if (profileMessageBtn) {
        profileMessageBtn.hidden = !canMessage;
        profileMessageBtn.dataset.userId = canMessage ? resolvedUserId : "";
        profileMessageBtn.dataset.userName = canMessage ? name : "";
      }

      if (profileLoadingEl) profileLoadingEl.hidden = !loading;
      profilePopover?.toggleAttribute("aria-busy", loading);
      profilePopover?.classList.toggle("is-profile-loading", loading);

      profilePopover.hidden = false;
      profilePopover.setAttribute("aria-hidden", "false");
      profileCloseBtn?.focus({ preventScroll: true });

      activeProfileView = {
        userId: resolvedUserId,
        name,
        bio,
        avatar: String(profile.avatar || ""),
        isOwner: Boolean(profile.isOwner),
        isSelf,
        loading,
      };
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

      reopenDmThread(profile.name || fallback.name || "");
      trackRecentThread(id, profile);
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
      const onlineUser = resolveOnlineUser(id, cached?.name || fallback.name);
      const resolvedId = String(onlineUser?.userId || id).trim();
      const resolvedCached = userProfiles.get(resolvedId) || cached;
      const displayName = onlineUser?.name || resolvedCached?.name || fallback.name || "Guest";
      const saved = getProfileForDisplayName(displayName);
      const bio =
        resolvedCached?.bio || onlineUser?.bio || saved?.bio || String(fallback.bio || "").trim();
      const avatar =
        onlineUser?.avatar ||
        resolvedCached?.avatar ||
        saved?.avatar ||
        String(fallback.avatar || "").trim();

      showProfilePopover({
        userId: resolvedId,
        name: displayName,
        bio,
        avatar,
        isOwner: Boolean(
          onlineUser?.isOwner ?? resolvedCached?.isOwner ?? saved?.isOwner ?? fallback.isOwner,
        ),
        loading: session.state === "live" && Boolean(onlineUser),
      });
      if (session.state === "live" && onlineUser) requestUserProfile(resolvedId);
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
      const resolvedName =
        String(peerName || getPeerProfile(userId).name || resolvePeerNameFromDmStore(userId) || "").trim();
      const local = resolvedName ? getDmThread(resolvedName) : [];
      const merged = mergeHistoryMessages(local, history || []);
      if (!merged.length && messagesEl.querySelector(".community-chat-msg")) {
        finishChannelLoad();
        return;
      }

      syncActiveMessageIds();
      messagesEl.querySelectorAll(".community-chat-msg").forEach((node) => node.remove());
      session.messageIds.clear();
      merged.forEach((entry) => {
        renderMessage(dmToRenderMessage(entry, session.selfId), {
          isSelf: entry.fromUserId === session.selfId,
        });
      });
      if (resolvedName) persistDmThread(resolvedName, merged, getHistoryMaxSize(session.config));
      syncMessageAvatars();
      finishChannelLoad();
      updateUi();
    };

    const switchChannel = async (channel, meta = {}) => {
      const nextChannel = channel === "lobby" ? "lobby" : String(channel || "").trim();
      if (!nextChannel) return;
      beginChannelLoad();
      setFriendsMenuOpen(false);
      session.activeChannel = nextChannel;
      if (nextChannel === "lobby") session.lobbyUnread = 0;
      session.dmUnread.set(nextChannel, 0);
      syncActiveMessageIds();
      closeProfilePopover();

      messagesEl.querySelectorAll(".community-chat-msg").forEach((node) => node.remove());
      session.messageIds.clear();

      if (nextChannel === "lobby") {
        renderSidebar();
        await loadAndRenderHistory();
        finishChannelLoad();
        updateUi();
        return;
      }

      const peer = getPeerProfile(nextChannel);
      const metaName = String(meta.name || "").trim();
      const peerName = metaName || peer.name || resolvePeerNameFromDmStore(nextChannel);
      if (peerName) {
        reopenDmThread(peerName);
        trackRecentThread(nextChannel, {
          name: peerName,
          avatar: meta.avatar || peer.avatar,
          isOwner: meta.isOwner ?? peer.isOwner,
        });
      }
      renderSidebar();

      const local = peerName ? getDmThread(peerName) : [];
      local.forEach((entry) => {
        renderMessage(dmToRenderMessage(entry, session.selfId), {
          isSelf: entry.fromUserId === session.selfId,
        });
      });
      requestDmHistory(nextChannel, peerName);
      const canFetchDmHistory =
        session.state === "live" && session.socket?.readyState === WebSocket.OPEN;
      if (!canFetchDmHistory) finishChannelLoad();
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

      const iconWrap = document.createElement("span");
      iconWrap.className = "community-chat-sidebar-icon-wrap";
      iconWrap.appendChild(avatar);

      const label = document.createElement("span");
      label.className = "community-chat-sidebar-label community-chat-dm-label";
      label.textContent = name;

      const unread = session.dmUnread.get(userId) || 0;
      if (unread > 0 && (session.activeChannel !== userId || !session.panelOpen)) {
        const badge = document.createElement("span");
        badge.className = "community-chat-unread-badge community-chat-dm-item-unread";
        badge.textContent = formatUnreadCount(unread);
        badge.setAttribute("data-count", String(unread));
        iconWrap.appendChild(badge);
      }

      button.appendChild(iconWrap);
      button.appendChild(label);

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
      const maxHeight = Math.min(menuHeight, availableBelow);
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

    const createFriendMenuItem = (friend, onlineUser = null) => {
      const name = String(friend?.name || onlineUser?.name || "").trim();
      if (!name) return null;

      const userId = String(onlineUser?.userId || "").trim();
      const isOnline = Boolean(onlineUser?.userId);
      if (isOnline && userId === session.selfId) return null;

      const button = document.createElement("button");
      button.type = "button";
      button.role = "menuitem";
      button.className = "community-chat-friends-menu-item";
      button.classList.toggle("is-online", isOnline);
      button.classList.toggle("is-offline", !isOnline);
      button.setAttribute("aria-label", isOnline ? `${name} (online)` : `${name} (offline)`);

      const avatar = createChatAvatar(name, friend?.avatar || onlineUser?.avatar || "");
      avatar.classList.add("community-chat-friends-menu-avatar");
      button.appendChild(avatar);

      const label = document.createElement("span");
      label.className = "community-chat-friends-menu-name";
      label.textContent = name;
      button.appendChild(label);

      const status = document.createElement("span");
      status.className = "community-chat-friends-menu-status";
      status.classList.toggle("is-online", isOnline);
      status.classList.toggle("is-offline", !isOnline);
      status.setAttribute("aria-hidden", "true");
      button.appendChild(status);

      button.addEventListener("click", () => {
        setFriendsMenuOpen(false);
        if (isOnline) {
          openUserProfile(userId, onlineUser || friend);
          return;
        }
        showProfilePopover({
          userId: "",
          name: friend.name,
          bio: getProfileForDisplayName(friend.name)?.bio || "",
          avatar: friend.avatar || "",
          isOwner: Boolean(friend.isOwner),
          loading: false,
        });
      });

      return button;
    };

    const resolveMemberUserId = (name, onlineUser) => {
      const fromOnline = String(onlineUser?.userId || "").trim();
      if (fromOnline) return fromOnline;

      const nameKey = normalizeDisplayNameKey(name);
      if (!nameKey) return "";

      for (const [id, cached] of userProfiles.entries()) {
        if (normalizeDisplayNameKey(cached?.name) === nameKey) return String(id || "").trim();
      }

      const thread = getRecentDmEntries().find(
        (entry) => normalizeDisplayNameKey(entry.name) === nameKey,
      );
      if (thread?.userId) return String(thread.userId).trim();

      return resolveUserIdFromDmStore(name);
    };

    const openMemberProfile = (profile, onlineUser = null) => {
      const name = String(profile?.name || onlineUser?.name || "").trim();
      if (!name) return;

      const userId = resolveMemberUserId(name, onlineUser);
      const saved = getProfileForDisplayName(name);
      const payload = {
        userId,
        name,
        bio: String(onlineUser?.bio || profile?.bio || saved?.bio || "").trim(),
        avatar: String(onlineUser?.avatar || profile?.avatar || saved?.avatar || "").trim(),
        isOwner: Boolean(onlineUser?.isOwner ?? profile?.isOwner ?? saved?.isOwner),
      };

      setMembersPopoverOpen(false);

      if (userId && userId !== session.selfId) {
        openUserProfile(userId, payload);
        return;
      }

      showProfilePopover({ ...payload, loading: false });
    };

    const createMemberItem = (profile, onlineUser = null) => {
      const name = String(profile?.name || onlineUser?.name || "").trim();
      if (!name) return null;

      const userId = String(onlineUser?.userId || "").trim();
      const isOnline = Boolean(onlineUser?.userId);
      if (isOnline && userId === session.selfId) return null;

      const row = document.createElement("button");
      row.type = "button";
      row.role = "listitem";
      row.className = "community-chat-members-item";
      row.classList.toggle("is-online", isOnline);
      row.classList.toggle("is-offline", !isOnline);
      row.setAttribute("aria-label", `${name} (${isOnline ? "online" : "offline"}) — view profile`);

      const label = document.createElement("span");
      label.className = "community-chat-members-name";
      label.textContent = name;
      row.appendChild(label);

      const status = document.createElement("span");
      status.className = "community-chat-members-status";
      status.classList.toggle("is-online", isOnline);
      status.classList.toggle("is-offline", !isOnline);
      status.textContent = isOnline ? "Online" : "Offline";
      row.appendChild(status);

      row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openMemberProfile(profile, onlineUser);
      });

      return row;
    };

    const renderMembersList = () => {
      if (!membersListEl) return;
      membersListEl.replaceChildren();

      const onlineByName = new Map(
        session.onlineUsers
          .filter((user) => user.userId && user.name)
          .map((user) => [normalizeDisplayNameKey(user.name), user]),
      );

      const membersByKey = new Map();
      listSavedProfiles().forEach((profile) => {
        membersByKey.set(profile.key, profile);
      });
      session.onlineUsers.forEach((user) => {
        const key = normalizeDisplayNameKey(user.name);
        if (!key || membersByKey.has(key)) return;
        membersByKey.set(key, {
          key,
          name: user.name,
          avatar: user.avatar || "",
          bio: user.bio || "",
          isOwner: Boolean(user.isOwner),
        });
      });

      const members = [...membersByKey.values()].sort((a, b) => {
        const aOnline = onlineByName.has(a.key);
        const bOnline = onlineByName.has(b.key);
        if (aOnline !== bOnline) return aOnline ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      if (!members.length) {
        const empty = document.createElement("p");
        empty.className = "community-chat-members-empty";
        empty.textContent = "No members yet.";
        membersListEl.appendChild(empty);
        return;
      }

      members.forEach((member) => {
        const onlineUser = onlineByName.get(member.key) || null;
        const item = createMemberItem(member, onlineUser);
        if (item) membersListEl.appendChild(item);
      });
    };

    let membersPopoverOpen = false;

    const setMembersPopoverOpen = (open) => {
      if (!membersPopover || !membersToggle) return;
      membersPopoverOpen = Boolean(open);
      membersToggle.setAttribute("aria-expanded", membersPopoverOpen ? "true" : "false");
      membersToggle.classList.toggle("active", membersPopoverOpen);
      membersPopover.hidden = !membersPopoverOpen;
      if (membersPopoverOpen) {
        renderMembersList();
      }
    };

    const renderFriendsMenu = () => {
      if (!friendsOnlineListEl) return;
      friendsOnlineListEl.replaceChildren();

      const friends = listSavedFriends();
      if (!friends.length) {
        const empty = document.createElement("p");
        empty.className = "community-chat-friends-menu-empty";
        empty.textContent = "No friends yet. Open someone's profile and tap Add Friend.";
        friendsOnlineListEl.appendChild(empty);
        return;
      }

      const onlineByName = new Map(
        session.onlineUsers
          .filter((user) => user.userId && user.userId !== session.selfId)
          .map((user) => [normalizeDisplayNameKey(user.name), user]),
      );

      const sortedFriends = [...friends].sort((a, b) => {
        const aOnline = onlineByName.has(a.key);
        const bOnline = onlineByName.has(b.key);
        if (aOnline !== bOnline) return aOnline ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      sortedFriends.forEach((friend) => {
        const onlineUser = onlineByName.get(friend.key) || null;
        const item = createFriendMenuItem(friend, onlineUser);
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
        const entries = getRecentDmEntries();

        if (messagesHeadingEl) {
          messagesHeadingEl.hidden = false;
          messagesHeadingEl.disabled = entries.length === 0;
        }
        dmListEl.hidden = false;

        if (!entries.length) {
          const empty = document.createElement("p");
          empty.className = "community-chat-dm-empty";
          empty.textContent =
            session.config.ui?.dm_empty || DEFAULT_CONFIG.ui.dm_empty;
          dmListEl.appendChild(empty);
        } else {
          entries.forEach((user) => {
            const item = createDmSidebarItem(user);
            if (item) dmListEl.appendChild(item);
          });
        }
      }

      renderFriendsMenu();
      syncNotifyBadges();
    };

    const handleIncomingDm = (dm) => {
      const peerUserId = dm.fromUserId === session.selfId ? dm.toUserId : dm.fromUserId;
      let peerName = dm.fromUserId === session.selfId ? dm.toName : dm.fromName;
      const peerAvatar = dm.fromUserId === session.selfId ? dm.toAvatar : dm.fromAvatar;
      const peerIsOwner = dm.fromUserId === session.selfId ? dm.toIsOwner : dm.fromIsOwner;

      if (!String(peerName || "").trim() && peerUserId) {
        peerName = userProfiles.get(peerUserId)?.name || "";
      }

      upsertSavedProfile({
        name: dm.fromName,
        avatar: dm.fromAvatar,
        isOwner: Boolean(dm.fromIsOwner),
      });
      upsertSavedProfile({
        name: dm.toName,
        avatar: dm.toAvatar,
        isOwner: Boolean(dm.toIsOwner),
      });

      upsertUserProfile(peerUserId, {
        name: peerName,
        avatar: peerAvatar,
        isOwner: Boolean(peerIsOwner),
      });
      reopenDmThread(peerName);
      trackRecentThread(peerUserId, { name: peerName, avatar: peerAvatar, isOwner: peerIsOwner });
      persistDmThread(peerName, [dm], getHistoryMaxSize(session.config));

      const ids = getChannelMessageIds(peerUserId);
      if (ids.has(dm.id)) {
        renderSidebar();
        return;
      }

      const onThisDm = session.activeChannel === peerUserId;
      const shouldNotify = dm.fromUserId !== session.selfId && (!session.panelOpen || !onThisDm);

      if (onThisDm) {
        syncActiveMessageIds();
        renderMessage(dmToRenderMessage(dm, session.selfId), {
          isSelf: dm.fromUserId === session.selfId,
        });
      } else {
        ids.add(dm.id);
      }

      if (shouldNotify) {
        session.dmUnread.set(peerUserId, (session.dmUnread.get(peerUserId) || 0) + 1);
        playChatPingSound();
      }
      renderSidebar();
      refreshActiveProfileActions();
    };

    const setState = (state) => {
      session.state = state;
      panel.dataset.chatState = state;
      if (state === "disabled") {
        session.pendingChannelLoad = false;
      }
      refreshMessagesLoading();
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

      if (subtitleEl) {
        if (session.state === "live") {
          subtitleEl.textContent = "Connected to chat";
        } else if (session.state === "connecting") {
          subtitleEl.textContent =
            session.config.ui?.connecting_message || DEFAULT_CONFIG.ui.connecting_message;
        } else if (session.state === "disabled") {
          subtitleEl.textContent = session.config.ui?.offline_message || DEFAULT_CONFIG.ui.offline_message;
        } else {
          subtitleEl.textContent = "Offline";
        }
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
      const displayName = String(message.name || "Guest").trim() || "Guest";

      if (displayName) {
        upsertSavedProfile({
          name: displayName,
          avatar: avatarUrl,
          isOwner: Boolean(message.isOwner),
        });
      }

      if (message.userId) {
        upsertUserProfile(message.userId, {
          name: displayName,
          avatar: avatarUrl,
          isOwner: Boolean(message.isOwner),
        });
      }

      const item = document.createElement("div");
      item.className = `community-chat-msg community-chat-msg--${self ? "self" : "other"}`;
      item.dataset.messageId = message.id;
      if (message.userId) item.dataset.userId = message.userId;
      item.dataset.userName = displayName;

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
        if (message?.name || message?.avatar) {
          upsertSavedProfile({
            name: message.name,
            avatar: message.avatar,
            isOwner: Boolean(message.isOwner),
          });
        }
        renderMessage(message, { isSelf: isSelfMessage(message) });
      });
      hydrateMessageProfiles();
      updateUi();
    };

    const loadAndRenderHistory = async (...sources) => {
      if (session.activeChannel !== "lobby") return;
      const fromLocal = readLocalChatHistory();
      const fromHttp = session.wsUrl ? await fetchChatHistory(session.wsUrl) : [];
      const merged = mergeHistoryMessages(fromLocal, ...sources, fromHttp);
      if (merged.length) {
        renderHistory(merged);
        persistChatHistory(merged);
        return;
      }
      if (fromLocal.length) renderHistory(fromLocal);
    };

    const persistChatHistory = (messages) => {
      const existing = readLocalChatHistory();
      const merged = mergeHistoryMessages(existing, messages);
      if (!merged.length && existing.length) return;
      writeLocalChatHistory(merged.length ? merged : existing, getHistoryMaxSize(session.config));
    };

    const persistChatMessage = (message) => {
      const normalized = normalizeStoredHistoryMessage(message);
      if (!normalized) return;
      if (message?.name || message?.avatar) {
        upsertSavedProfile({
          name: message.name,
          avatar: normalized.avatar || message.avatar,
          isOwner: Boolean(message.isOwner),
        });
      }
      persistChatHistory(mergeHistoryMessages(readLocalChatHistory(), [normalized]));
    };

    const renderPresence = ({ online, chatOpen, users } = {}) => {
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
      syncSavedFriendAvatarsFromOnline(session.onlineUsers);
      hydrateMessageProfiles();
      renderSidebar();
      if (membersPopoverOpen) renderMembersList();
      refreshActiveProfileActions();
    };

    const sendPanelOpenState = (open) => {
      session.panelOpen = Boolean(open);
      if (session.panelOpen && session.activeChannel === "lobby") session.lobbyUnread = 0;
      if (session.panelOpen && session.activeChannel !== "lobby") {
        session.dmUnread.set(session.activeChannel, 0);
      }
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
          JSON.stringify({
            type: "join",
            name: identity.name,
            bio: identity.bio,
            avatar: identity.avatar,
            authorId: getOrCreateAuthorId(),
          }),
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
          const peer = getPeerProfile(session.activeChannel);
          reopenDmThread(peer.name);
          trackRecentThread(session.activeChannel, peer);
          session.socket?.send(JSON.stringify({ type: "dm", toUserId: session.activeChannel, text }));
          renderSidebar();
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
        hydrateMessageProfiles();
        global.dispatchEvent(new CustomEvent("morning-roast:chat-connected"));
        beginChannelLoad();
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
            if (session.activeChannel === "lobby") {
              await loadAndRenderHistory(message.history || []);
              finishChannelLoad();
            } else if (session.pendingChannelLoad) {
              requestDmHistory(session.activeChannel, getPeerProfile(session.activeChannel).name);
            }
            renderPresence({ online: message.online, chatOpen: message.chatOpen, users: [] });
            hydrateMessageProfiles();
            updateUi();
            break;
          case "joined":
            session.selfId = message.you?.id || session.selfId;
            chatSelfUserId = session.selfId;
            if (message.you?.authorId) writeAuthorId(message.you.authorId);
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
            global.MorningRoastLineupSubmissions?.onChatJoined?.();
            break;
          case "message": {
            const ids = getChannelMessageIds("lobby");
            if (ids.has(message.id)) break;
            const isSelf = isSelfMessage(message);
            if (!isSelf && (!session.panelOpen || session.activeChannel !== "lobby")) {
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
          case "dm_history": {
            const peerName = String(
              message.withUserName || getPeerProfile(message.withUserId).name || resolvePeerNameFromDmStore(message.withUserId) || "",
            ).trim();
            if (message.withUserId && peerName) {
              const merged = mergeHistoryMessages(getDmThread(peerName), message.history || []);
              persistDmThread(peerName, merged, getHistoryMaxSize(session.config));
            }
            if (message.withUserId && session.activeChannel === message.withUserId) {
              renderDmHistory(message.withUserId, message.history || [], peerName);
            }
            break;
          }
          case "presence":
            renderPresence(message);
            break;
          case "profile":
            upsertUserProfile(message.userId, message);
            syncMessageAvatars();
            if (pendingProfileUserId && pendingProfileUserId === message.userId) {
              showProfilePopover(message);
              pendingProfileUserId = "";
            } else if (
              activeProfileView &&
              (message.userId === activeProfileView.userId ||
                normalizeDisplayNameKey(message.name) === normalizeDisplayNameKey(activeProfileView.name))
            ) {
              showProfilePopover(message);
              pendingProfileUserId = "";
            }
            break;
          case "lineup_comments":
          case "lineup_comment":
          case "lineup_comment_vote":
            global.dispatchEvent(new CustomEvent("morning-roast:lineup-comments", { detail: message }));
            break;
          case "lineup_submission_pending":
          case "lineup_submission_list":
          case "lineup_submission_reviewed":
            global.MorningRoastLineupSubmissions?.handleChatMessage?.(message);
            break;
          case "lineup_submission_updated":
            global.MorningRoastLineupSubmissions?.handleChatMessage?.(message);
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
            if (message.code === "self_vote") {
              global.Toast?.notify?.({
                message: message.message || "You can't vote on your own comment.",
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
            if (message.code === "profile_not_found" && (pendingProfileUserId || activeProfileView)) {
              const lookupId = pendingProfileUserId || activeProfileView?.userId || "";
              const cached = lookupId ? userProfiles.get(lookupId) : null;
              const saved = getProfileForDisplayName(cached?.name || activeProfileView?.name);
              showProfilePopover({
                userId: lookupId,
                name: cached?.name || activeProfileView?.name || saved?.name || "Guest",
                bio: cached?.bio || saved?.bio || "",
                avatar: cached?.avatar || saved?.avatar || activeProfileView?.avatar || "",
                isOwner: Boolean(cached?.isOwner ?? saved?.isOwner ?? activeProfileView?.isOwner),
                loading: false,
              });
              pendingProfileUserId = "";
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
      global.attachUiTooltip(messagesHeadingEl, "Cycle through private chats", { placement: "right" });
    }

    lobbyBtn?.addEventListener("click", () => {
      void switchChannel("lobby");
    });

    messagesHeadingEl?.addEventListener("click", () => {
      cycleDmChannel();
    });

    dmCloseBtn?.addEventListener("click", () => {
      void switchChannel("lobby");
    });

    membersToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      setMembersPopoverOpen(!membersPopoverOpen);
    });

    membersPopover?.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    document.addEventListener("click", (event) => {
      if (!membersPopoverOpen) return;
      const target = event.target;
      if (membersPopover?.contains(target) || membersToggle?.contains(target)) return;
      setMembersPopoverOpen(false);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && membersPopoverOpen) {
        setMembersPopoverOpen(false);
        membersToggle?.focus();
      }
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
      if (event.key === CHAT_FRIENDS_STORAGE_KEY) {
        renderFriendsMenu();
      }
      if (event.key === CHAT_PROFILES_STORAGE_KEY) {
        hydrateMessageProfiles();
        if (membersPopoverOpen) renderMembersList();
      }
    });

    global.addEventListener("morning-roast:chat-friends-changed", () => {
      renderFriendsMenu();
    });

    const resumeChatConnection = () => {
      if (session.stopped || !session.wsUrl) return;
      const open = session.socket?.readyState === WebSocket.OPEN;
      if (session.state === "live" && open) return;
      session.reconnectMs = RECONNECT_BASE_MS;
      connect();
    };

    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) resumeChatConnection();
    });
    global.addEventListener("online", resumeChatConnection);

    session.api = {
      destroy() {
        session.stopped = true;
        clearReconnect();
        session.generation += 1;
        closeSocket();
        closeProfilePopover();
        setMembersPopoverOpen(false);
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

    refreshMessagesLoading();

    (async () => {
      const provisionalUrl = resolveChatWsUrl(DEFAULT_CONFIG);
      session.config = await fetchChatConfig(provisionalUrl);
      if (session.config.owners?.display_names?.length) {
        setOwnerDisplayNames(session.config.owners.display_names);
      }
      session.wsUrl = resolveChatWsUrl(session.config);
      hydrateRecentThreadsFromStorage(trackRecentThread, closedDmKeys);
      hydrateMessageProfiles();
      renderSidebar();
      updateUi();
      beginChannelLoad();
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
    getAuthorId: getOrCreateAuthorId,
    readAuthorId,
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
    getFriends: listSavedFriends,
    isFriend: isSavedFriend,
    addFriend: addSavedFriend,
    removeFriend: removeSavedFriend,
    getSavedProfile: getProfileForDisplayName,
    getMembers: listSavedProfiles,
  };
})(window);
