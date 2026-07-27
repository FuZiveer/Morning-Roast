/** Lineup video comments — post, reply, like/dislike via community chat WebSocket. */
(function (global) {
  const COMMENTS_EVENT = "morning-roast:lineup-comments";
  const LINEUP_COMMENTS_STORAGE_KEY = "morningRoastLineupComments";
  const LINEUP_COMMENTS_DEFAULT_MAX = 200;

  const state = {
    game: "",
    videoId: "",
    lineupKey: "",
    comments: [],
    replyToId: "",
    expandedReplies: new Set(),
    loading: false,
  };

  let listEl = null;
  let formEl = null;
  let inputEl = null;
  let countEl = null;
  let hintEl = null;
  let submitBtn = null;
  let replyBannerEl = null;
  let replyBannerTextEl = null;
  let replyBannerCancelEl = null;

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatTime(timestamp) {
    const date = new Date(Number(timestamp) || 0);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function buildLineupKey(game, videoId) {
    const nextGame = String(game || "").trim().toLowerCase();
    const nextId = String(videoId || "").trim();
    if (!nextGame || !nextId) return "";
    return `${nextGame}:${nextId}`;
  }

  function normalizeStoredComment(comment) {
    if (!comment || typeof comment !== "object") return null;
    const id = String(comment.id || "").trim();
    const userId = String(comment.userId || "").trim();
    const name = String(comment.name || "").trim() || "Guest";
    const text = String(comment.text || "").trim();
    const at = Number(comment.at);
    const parentId = comment.parentId == null ? null : String(comment.parentId || "").trim() || null;
    if (!id || !text || !Number.isFinite(at)) return null;

    const stored = {
      id,
      parentId,
      userId,
      name,
      text,
      at,
      likes: Math.max(0, Number(comment.likes) || 0),
      dislikes: Math.max(0, Number(comment.dislikes) || 0),
      yourVote: comment.yourVote === 1 || comment.yourVote === -1 ? comment.yourVote : 0,
    };

    const avatar = String(comment.avatar || "").trim();
    if (avatar.startsWith("data:image/") && avatar.length <= 130000) stored.avatar = avatar;

    return stored;
  }

  function mergeComments(...lists) {
    const byId = new Map();
    for (const list of lists) {
      for (const comment of list || []) {
        const normalized = normalizeStoredComment(comment);
        if (normalized?.id) byId.set(normalized.id, normalized);
      }
    }
    return [...byId.values()].sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
  }

  function readLocalCommentStore() {
    try {
      const raw = global.localStorage?.getItem(LINEUP_COMMENTS_STORAGE_KEY);
      if (!raw) return { lineups: {} };
      const parsed = JSON.parse(raw);
      const lineups = parsed?.lineups;
      return { lineups: lineups && typeof lineups === "object" && !Array.isArray(lineups) ? lineups : {} };
    } catch {
      return { lineups: {} };
    }
  }

  function writeLocalCommentStore(store) {
    if (!global.localStorage) return;
    try {
      global.localStorage.setItem(
        LINEUP_COMMENTS_STORAGE_KEY,
        JSON.stringify({ version: 1, updatedAt: Date.now(), lineups: store.lineups || {} }),
      );
    } catch {
      // Storage full or unavailable.
    }
  }

  function readLocalCommentsForLineup(lineupKey, maxSize = LINEUP_COMMENTS_DEFAULT_MAX) {
    const key = String(lineupKey || "").trim();
    if (!key) return [];
    const store = readLocalCommentStore();
    const bucket = store.lineups[key];
    const list = Array.isArray(bucket?.comments) ? bucket.comments : [];
    return list
      .map(normalizeStoredComment)
      .filter(Boolean)
      .sort((a, b) => Number(a.at || 0) - Number(b.at || 0))
      .slice(-maxSize);
  }

  function persistCommentsForLineup(lineupKey, comments, maxSize = LINEUP_COMMENTS_DEFAULT_MAX) {
    const key = String(lineupKey || "").trim();
    if (!key) return;
    const normalized = mergeComments(comments).slice(-maxSize);
    const store = readLocalCommentStore();
    if (normalized.length) store.lineups[key] = { comments: normalized };
    else delete store.lineups[key];
    writeLocalCommentStore(store);
  }

  function readProfileIdentity() {
    return global.MorningRoastChat?.readProfileIdentity?.() || { name: "", bio: "", avatar: "" };
  }

  function getSelfUserId() {
    return global.MorningRoastChat?.getSelfUserId?.() || "";
  }

  function resolveCommentsHttpUrl(game, videoId) {
    const wsUrl = global.MorningRoastChat?.resolveChatWsUrl?.() || "";
    if (!wsUrl) return "";
    try {
      const url = new URL(wsUrl);
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      url.pathname = "/lineups/comments";
      url.search = "";
      url.hash = "";
      url.searchParams.set("game", String(game || "").trim().toLowerCase());
      url.searchParams.set("videoId", String(videoId || "").trim());
      const userId = getSelfUserId();
      if (userId) url.searchParams.set("userId", userId);
      return url.toString();
    } catch {
      return "";
    }
  }

  function sendPayload(payload) {
    return global.MorningRoastChat?.sendChatPayload?.(payload) || false;
  }

  function ensureChatJoined() {
    global.MorningRoastChat?.ensureChatJoined?.();
  }

  function initialsFromName(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) return "?";
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }

  function createCommentAvatar(name, avatarUrl) {
    const avatar = document.createElement("span");
    avatar.className = "lineup-comment-avatar";
    avatar.setAttribute("aria-hidden", "true");
    const src = String(avatarUrl || "").trim();
    if (src.startsWith("data:image/")) {
      avatar.style.backgroundImage = `url("${src.replace(/"/g, '\\"')}")`;
      avatar.classList.add("has-image");
    } else {
      avatar.textContent = initialsFromName(name);
    }
    return avatar;
  }

  function groupComments(comments) {
    const topLevel = [];
    const repliesByParent = new Map();
    for (const comment of comments) {
      if (comment.parentId) {
        const bucket = repliesByParent.get(comment.parentId) || [];
        bucket.push(comment);
        repliesByParent.set(comment.parentId, bucket);
      } else {
        topLevel.push(comment);
      }
    }
    topLevel.sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
    for (const bucket of repliesByParent.values()) {
      bucket.sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
    }
    return { topLevel, repliesByParent };
  }

  function upsertComment(comment) {
    if (!comment?.id) return;
    const index = state.comments.findIndex((entry) => entry.id === comment.id);
    if (index >= 0) state.comments[index] = comment;
    else state.comments.push(comment);
    state.comments.sort((a, b) => Number(a.at || 0) - Number(b.at || 0));
    if (state.lineupKey) persistCommentsForLineup(state.lineupKey, state.comments);
  }

  function applyComments(comments, { persist = true } = {}) {
    state.comments = mergeComments(comments);
    if (persist && state.lineupKey) persistCommentsForLineup(state.lineupKey, state.comments);
    renderComments();
  }

  function syncCount() {
    if (!countEl) return;
    const total = state.comments.length;
    countEl.textContent = total ? `${total} comment${total === 1 ? "" : "s"}` : "No comments yet";
  }

  function syncFormState() {
    const identity = readProfileIdentity();
    const hasName = Boolean(String(identity.name || "").trim());
    const connected = global.MorningRoastChat?.isChatConnected?.() || false;

    if (hintEl) {
      if (!hasName) {
        hintEl.textContent = "Set a display name on your Profile to comment.";
        hintEl.hidden = false;
      } else if (!connected) {
        hintEl.textContent = "Connecting to comment…";
        hintEl.hidden = false;
      } else {
        hintEl.hidden = true;
        hintEl.textContent = "";
      }
    }

    if (inputEl) {
      inputEl.disabled = !hasName || !connected || state.loading;
      inputEl.placeholder = state.replyToId ? "Write a reply…" : "Add a comment…";
    }
    if (submitBtn) submitBtn.disabled = !hasName || !connected || state.loading;
    if (formEl) formEl.hidden = !hasName;

    if (replyBannerEl) replyBannerEl.hidden = !state.replyToId;
    if (replyBannerTextEl && state.replyToId) {
      const parent = state.comments.find((entry) => entry.id === state.replyToId);
      replyBannerTextEl.textContent = parent ? `Replying to ${parent.name}` : "Replying";
    }
  }

  function renderVoteButtons(comment) {
    const likeActive = comment.yourVote === 1 ? " is-active" : "";
    const dislikeActive = comment.yourVote === -1 ? " is-active" : "";
    return `
      <div class="lineup-comment-votes">
        <button type="button" class="lineup-comment-vote lineup-comment-vote--like${likeActive}" data-comment-id="${escapeHtml(comment.id)}" data-vote="1" aria-label="Like comment">
          <i class="ri-thumb-up-line" aria-hidden="true"></i>
          <span>${Number(comment.likes) || 0}</span>
        </button>
        <button type="button" class="lineup-comment-vote lineup-comment-vote--dislike${dislikeActive}" data-comment-id="${escapeHtml(comment.id)}" data-vote="-1" aria-label="Dislike comment">
          <i class="ri-thumb-down-line" aria-hidden="true"></i>
          <span>${Number(comment.dislikes) || 0}</span>
        </button>
      </div>
    `;
  }

  function renderCommentActions(comment, { isReply = false } = {}) {
    const replyBtn = isReply
      ? ""
      : `<button type="button" class="lineup-comment-action" data-action="reply" data-comment-id="${escapeHtml(comment.id)}">Reply</button>`;
    return `
      <div class="lineup-comment-actions">
        ${renderVoteButtons(comment)}
        ${replyBtn}
      </div>
    `;
  }

  function renderCommentBody(comment, { isReply = false } = {}) {
    const article = document.createElement("article");
    article.className = `lineup-comment${isReply ? " lineup-comment--reply" : ""}`;
    article.dataset.commentId = comment.id;
    article.innerHTML = `
      <div class="lineup-comment-main">
        <div class="lineup-comment-meta">
          <strong class="lineup-comment-name">${escapeHtml(comment.name)}</strong>
          <time class="lineup-comment-time" datetime="${new Date(Number(comment.at) || 0).toISOString()}">${escapeHtml(formatTime(comment.at))}</time>
        </div>
        <p class="lineup-comment-text">${escapeHtml(comment.text)}</p>
        ${renderCommentActions(comment, { isReply })}
      </div>
    `;
    article.prepend(createCommentAvatar(comment.name, comment.avatar));
    return article;
  }

  function renderRepliesToggle(parentId, count) {
    const expanded = state.expandedReplies.has(parentId);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lineup-comment-replies-toggle";
    button.dataset.parentId = parentId;
    button.setAttribute("aria-expanded", expanded ? "true" : "false");
    button.innerHTML = `
      <i class="ri-arrow-${expanded ? "up" : "down"}-s-line" aria-hidden="true"></i>
      <span>${count} repl${count === 1 ? "y" : "ies"}</span>
    `;
    return button;
  }

  function renderComments() {
    if (!listEl) return;
    listEl.replaceChildren();

    const { topLevel, repliesByParent } = groupComments(state.comments);
    if (!topLevel.length) {
      const empty = document.createElement("p");
      empty.className = "lineup-video-comments-empty";
      empty.textContent = "Be the first to comment on this lineup.";
      listEl.appendChild(empty);
      syncCount();
      syncFormState();
      return;
    }

    for (const comment of topLevel) {
      const thread = document.createElement("div");
      thread.className = "lineup-comment-thread";
      thread.dataset.commentId = comment.id;
      thread.appendChild(renderCommentBody(comment));

      const replies = repliesByParent.get(comment.id) || [];
      if (replies.length) {
        thread.appendChild(renderRepliesToggle(comment.id, replies.length));

        const repliesWrap = document.createElement("div");
        repliesWrap.className = "lineup-comment-replies";
        repliesWrap.dataset.parentId = comment.id;
        repliesWrap.hidden = !state.expandedReplies.has(comment.id);
        for (const reply of replies) {
          repliesWrap.appendChild(renderCommentBody(reply, { isReply: true }));
        }
        thread.appendChild(repliesWrap);
      }

      listEl.appendChild(thread);
    }

    syncCount();
    syncFormState();
  }

  function setComments(comments, { persist = true } = {}) {
    applyComments(comments, { persist });
  }

  async function loadAndMergeComments(...sources) {
    if (!state.lineupKey) return;
    const merged = mergeComments(readLocalCommentsForLineup(state.lineupKey), ...sources);
    if (!merged.length && !sources.some((list) => Array.isArray(list) && list.length)) return;
    applyComments(merged);
  }

  function watchLineup() {
    if (!state.game || !state.videoId) return;
    ensureChatJoined();
    sendPayload({
      type: "lineup_comment_watch",
      game: state.game,
      videoId: state.videoId,
    });
  }

  async function fetchCommentsFallback() {
    const httpUrl = resolveCommentsHttpUrl(state.game, state.videoId);
    if (!httpUrl) return;
    try {
      const response = await fetch(httpUrl, { cache: "no-store" });
      if (!response.ok) return;
      const data = await response.json();
      if (buildLineupKey(state.game, state.videoId) !== buildLineupKey(data.game, data.videoId)) return;
      await loadAndMergeComments(data.comments || []);
    } catch {
      // ignore
    }
  }

  function clearReplyTarget() {
    state.replyToId = "";
    syncFormState();
  }

  function setReplyTarget(commentId) {
    state.replyToId = String(commentId || "").trim();
    if (state.replyToId) state.expandedReplies.add(state.replyToId);
    syncFormState();
    inputEl?.focus();
  }

  function toggleReplies(parentId) {
    const id = String(parentId || "").trim();
    if (!id) return;
    if (state.expandedReplies.has(id)) state.expandedReplies.delete(id);
    else state.expandedReplies.add(id);
    renderComments();
  }

  function submitComment(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed || !state.game || !state.videoId) return false;

    ensureChatJoined();
    const payload = {
      type: "lineup_comment",
      game: state.game,
      videoId: state.videoId,
      text: trimmed,
    };
    if (state.replyToId) payload.parentId = state.replyToId;

    const sent = sendPayload(payload);
    if (sent) {
      state.loading = true;
      syncFormState();
    }
    return sent;
  }

  function submitVote(commentId, vote) {
    if (!state.game || !state.videoId) return;
    const id = String(commentId || "").trim();
    const requestedVote = Number(vote);
    const comment = state.comments.find((entry) => entry.id === id);
    const nextVote = comment && comment.yourVote === requestedVote ? 0 : requestedVote;
    ensureChatJoined();
    sendPayload({
      type: "lineup_comment_vote",
      game: state.game,
      videoId: state.videoId,
      commentId: id,
      vote: nextVote,
    });
  }

  function handleCommentsEvent(event) {
    const message = event.detail;
    if (!message || !state.game || !state.videoId) return;

    const messageKey = message.lineupKey || buildLineupKey(message.game, message.videoId);
    const activeKey = buildLineupKey(state.game, state.videoId);
    if (messageKey !== activeKey) return;

    switch (message.type) {
      case "lineup_comments":
        void loadAndMergeComments(message.comments || []);
        state.loading = false;
        break;
      case "lineup_comment":
        if (message.comment) {
          upsertComment(message.comment);
          if (message.comment.parentId) state.expandedReplies.add(message.comment.parentId);
          renderComments();
        }
        state.loading = false;
        if (inputEl) inputEl.value = "";
        clearReplyTarget();
        break;
      case "lineup_comment_vote":
        if (message.comment) {
          upsertComment(message.comment);
          renderComments();
        }
        break;
      case "lineup_comment_failed":
        state.loading = false;
        renderComments();
        break;
      default:
        break;
    }
  }

  function bindUi() {
    if (!listEl || listEl.dataset.lineupCommentsBound === "1") return;
    listEl.dataset.lineupCommentsBound = "1";

    listEl.addEventListener("click", (event) => {
      const voteBtn = event.target.closest(".lineup-comment-vote");
      if (voteBtn && listEl.contains(voteBtn)) {
        event.preventDefault();
        submitVote(voteBtn.dataset.commentId || "", voteBtn.dataset.vote || "0");
        return;
      }

      const replyBtn = event.target.closest('[data-action="reply"]');
      if (replyBtn && listEl.contains(replyBtn)) {
        event.preventDefault();
        setReplyTarget(replyBtn.dataset.commentId || "");
        return;
      }

      const toggleBtn = event.target.closest(".lineup-comment-replies-toggle");
      if (toggleBtn && listEl.contains(toggleBtn)) {
        event.preventDefault();
        toggleReplies(toggleBtn.dataset.parentId || "");
      }
    });

    formEl?.addEventListener("submit", (event) => {
      event.preventDefault();
      const text = inputEl?.value || "";
      if (!submitComment(text)) {
        global.Toast?.notify?.({ message: "Could not send comment. Check your connection.", type: "error" });
      }
    });

    replyBannerCancelEl?.addEventListener("click", () => clearReplyTarget());

    global.addEventListener(COMMENTS_EVENT, handleCommentsEvent);
    global.addEventListener("morning-roast:chat-presence", syncFormState);
    global.addEventListener("morning-roast:chat-connected", () => {
      syncFormState();
      if (state.lineupKey) watchLineup();
    });
  }

  function open({ game, videoId } = {}) {
    const nextGame = String(game || "").trim().toLowerCase();
    const nextId = String(videoId || "").trim();
    if (!nextGame || !nextId) return;

    state.game = nextGame;
    state.videoId = nextId;
    state.lineupKey = buildLineupKey(nextGame, nextId);
    state.replyToId = "";
    state.expandedReplies = new Set();
    state.loading = false;

    applyComments(readLocalCommentsForLineup(state.lineupKey), { persist: false });
    watchLineup();
    void fetchCommentsFallback();
    syncFormState();
  }

  function close() {
    if (state.game && state.videoId) {
      sendPayload({ type: "lineup_comment_watch", game: "", videoId: "" });
    }
    state.game = "";
    state.videoId = "";
    state.lineupKey = "";
    state.comments = [];
    state.replyToId = "";
    state.expandedReplies = new Set();
    state.loading = false;
    renderComments();
  }

  function init() {
    listEl = document.getElementById("lineup-video-comments-list");
    formEl = document.getElementById("lineup-video-comments-form");
    inputEl = document.getElementById("lineup-video-comments-input");
    countEl = document.getElementById("lineup-video-comments-count");
    hintEl = document.getElementById("lineup-video-comments-hint");
    submitBtn = document.getElementById("lineup-video-comments-submit");
    replyBannerEl = document.getElementById("lineup-video-comments-reply-banner");
    replyBannerTextEl = document.getElementById("lineup-video-comments-reply-text");
    replyBannerCancelEl = document.getElementById("lineup-video-comments-reply-cancel");
    bindUi();
  }

  global.MorningRoastLineupComments = {
    init,
    open,
    close,
  };
})(window);
