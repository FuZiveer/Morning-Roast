/** User-submitted lineups — submit, owner review, community grid rendering. */
(function (global) {
  const SUBMISSIONS_EVENT = "morning-roast:lineup-submissions";
  const GAMES = ["valorant", "cs2"];

  const state = {
    pending: [],
    pendingCount: 0,
    communityByGame: { valorant: [], cs2: [] },
    loading: false,
    submitting: false,
  };

  let submitOverlay = null;
  let reviewOverlay = null;

  function escapeHtml(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function resolveHttpBase() {
    const wsUrl = global.MorningRoastChat?.resolveChatWsUrl?.() || "";
    if (!wsUrl) return "";
    try {
      const url = new URL(wsUrl);
      url.protocol = url.protocol === "wss:" ? "https:" : "http:";
      url.pathname = "";
      url.search = "";
      url.hash = "";
      return url.toString().replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  function resolveLineupApiUrl(path) {
    const base = resolveHttpBase();
    if (!base) return "";
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }

  function readIdentity() {
    const profile = global.MorningRoastChat?.readProfileIdentity?.() || { name: "", bio: "", avatar: "" };
    return {
      userId: global.MorningRoastChat?.getSelfUserId?.() || "",
      authorId: global.MorningRoastChat?.getAuthorId?.() || global.MorningRoastChat?.readAuthorId?.() || "",
      name: String(profile.name || "").trim(),
    };
  }

  function isOwner() {
    const identity = readIdentity();
    return global.MorningRoastChat?.isOwnerDisplayName?.(identity.name) || false;
  }

  function dispatch(type, detail = {}) {
    global.dispatchEvent(new CustomEvent(SUBMISSIONS_EVENT, { detail: { type, ...detail } }));
  }

  function showToast(message, type = "success") {
    if (global.Toast?.notify) {
      global.Toast.notify({ message, type });
      return;
    }
    dispatch("toast", { message });
  }

  function getActiveGame() {
    if (typeof global.getActiveLineupGame === "function") return global.getActiveLineupGame();
    const holder = document.querySelector(".lineup-videos-holder[data-active-game]");
    const game = holder?.dataset?.activeGame || "";
    return GAMES.includes(game) ? game : null;
  }

  function getLineupMaps(game) {
    if (typeof global.LINEUP_MAPS !== "undefined") return global.LINEUP_MAPS?.[game] || [];
    if (game === "valorant") {
      return ["Abyss", "Ascent", "Bind", "Breeze", "Corrode", "Fracture", "Haven", "Icebox", "Lotus", "Pearl", "Summit", "Sunset"];
    }
    return ["Alpine", "Ancient", "Anubis", "Cache", "Dust II", "Inferno", "Italy", "Mirage", "Nuke", "Office", "Overpass", "Stronghold", "Train", "Vertigo", "Warden"];
  }

  function mapToSlug(name) {
    return String(name || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
  }

  function renderDifficultyStars(level) {
    const n = Math.min(5, Math.max(0, Number(level) || 0));
    return Array.from({ length: 5 }, (_, i) => `<i class="ri-star-${i < n ? "fill" : "line"}"></i>`).join("");
  }

  function buildCommunityCard(lineup) {
    const article = document.createElement("article");
    article.className = "lineup-video-card lineup-video-card--community";
    article.dataset.lineupSource = "community";
    article.dataset.lineupMap = lineup.map || "";
    article.dataset.lineupSide = lineup.side || "";
    article.dataset.lineupCallout = lineup.callout || "";
    article.dataset.lineupDifficulty = lineup.difficulty || "";
    article.dataset.lineupVideoId = lineup.videoId || "";
    article.dataset.lineupVideoUrl = lineup.videoUrl || "";
    article.dataset.lineupSearch = lineup.search || "";
    article.dataset.lineupSubmitter = lineup.submittedBy?.name || "";
    if (lineup.agent) article.dataset.lineupAgent = lineup.agent;
    if (lineup.ability) article.dataset.lineupAbility = lineup.ability;
    if (lineup.utility) article.dataset.lineupUtility = lineup.utility;

    const submitter = escapeHtml(lineup.submittedBy?.name || "Community");
    article.innerHTML = `
      <div class="lineup-video-embed">
        <img class="lineup-video-embed-poster" alt="" decoding="async" loading="lazy" hidden />
      </div>
      <div class="lineup-video-card-foot">
        <div class="lineup-video-card-foot-body">
          <h3 class="lineup-video-title">${escapeHtml(lineup.title || "Lineup")}</h3>
          <p class="lineup-community-author">By ${submitter}</p>
          <div class="lineup-difficulty" data-lineup-difficulty="${escapeHtml(lineup.difficulty || "")}" aria-label="Difficulty: ${escapeHtml(lineup.difficulty || "")} stars">
            <span class="lineup-difficulty-heading">
              <span class="lineup-difficulty-label">Difficulty</span>
              <span class="lineup-difficulty-dot" aria-hidden="true"></span>
            </span>
            <span class="lineup-difficulty-stars" aria-hidden="true">${renderDifficultyStars(lineup.difficulty)}</span>
          </div>
        </div>
      </div>`;
    return article;
  }

  function getCommunityGrid(game) {
    return document.getElementById(`lineup-${game}-community-grid`);
  }

  function getCommunitySection(game) {
    return document.getElementById(`lineup-${game}-community-section`);
  }

  function getCommunityEmpty(game) {
    return document.getElementById(`lineup-${game}-community-empty`);
  }

  function renderCommunityLineups(game, lineups) {
    if (!GAMES.includes(game)) return;
    const grid = getCommunityGrid(game);
    const section = getCommunitySection(game);
    const empty = getCommunityEmpty(game);
    if (!grid || !section) return;

    grid.innerHTML = "";
    const items = Array.isArray(lineups) ? lineups : [];
    state.communityByGame[game] = items;

    items.forEach((lineup) => {
      grid.appendChild(buildCommunityCard(lineup));
    });

    const hasCards = items.length > 0;
    section.hidden = !hasCards;
    section.classList.toggle("hidden", !hasCards);
    if (empty) {
      empty.hidden = hasCards;
      empty.classList.toggle("hidden", hasCards);
    }

    if (typeof global.refreshLineupVideoCards === "function") {
      global.refreshLineupVideoCards(grid);
    }
    if (typeof global.applyLineupFilters === "function") {
      global.applyLineupFilters();
    }
  }

  async function fetchCommunityLineups(game) {
    const url = resolveLineupApiUrl(`/lineups/community?game=${encodeURIComponent(game)}`);
    if (!url) return [];
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data.lineups) ? data.lineups : [];
    } catch {
      return [];
    }
  }

  async function refreshAllCommunityLineups() {
    for (const game of GAMES) {
      const lineups = await fetchCommunityLineups(game);
      renderCommunityLineups(game, lineups);
    }
  }

  function updateOwnerBanner() {
    const banner = document.getElementById("lineup-owner-review-banner");
    const text = document.getElementById("lineup-owner-review-banner-text");
    if (!banner || !text) return;

    const show = isOwner() && state.pendingCount > 0;
    banner.hidden = !show;
    banner.classList.toggle("hidden", !show);
    text.textContent =
      state.pendingCount === 1
        ? "1 lineup waiting for your review"
        : `${state.pendingCount} lineups waiting for your review`;
  }

  function renderReviewList() {
    const list = document.getElementById("lineup-review-list");
    const empty = document.getElementById("lineup-review-empty");
    if (!list || !empty) return;

    list.innerHTML = "";
    if (!state.pending.length) {
      empty.hidden = false;
      empty.classList.remove("hidden");
      return;
    }

    empty.hidden = true;
    empty.classList.add("hidden");

    const identity = readIdentity();
    const base = resolveHttpBase();

    state.pending.forEach((entry) => {
      const item = document.createElement("article");
      item.className = "lineup-review-item";
      item.dataset.submissionId = entry.id;
      const previewUrl = base
        ? `${base}/lineups/submissions/${encodeURIComponent(entry.id)}/preview?userId=${encodeURIComponent(identity.userId)}&name=${encodeURIComponent(identity.name)}`
        : "";
      item.innerHTML = `
        <div class="lineup-review-item-main">
          <h4 class="lineup-review-item-title">${escapeHtml(entry.title || "Lineup")}</h4>
          <p class="lineup-review-item-meta">${escapeHtml(entry.game)} · ${escapeHtml(entry.map)} · ${escapeHtml(entry.side)} · by ${escapeHtml(entry.submittedBy?.name || "Guest")}</p>
          ${entry.callout ? `<p class="lineup-review-item-callout">${escapeHtml(entry.callout)}</p>` : ""}
          ${previewUrl ? `<video class="lineup-review-item-video" src="${escapeHtml(previewUrl)}" controls playsinline preload="metadata"></video>` : ""}
        </div>
        <div class="lineup-review-item-actions">
          <button type="button" class="button primary lineup-review-approve" data-submission-id="${escapeHtml(entry.id)}">Approve</button>
          <button type="button" class="button secondary lineup-review-reject" data-submission-id="${escapeHtml(entry.id)}">Reject</button>
        </div>`;
      list.appendChild(item);
    });
  }

  function setPendingList(pending, pendingCount) {
    state.pending = Array.isArray(pending) ? pending : [];
    state.pendingCount = Number.isFinite(Number(pendingCount)) ? Number(pendingCount) : state.pending.length;
    updateOwnerBanner();
    if (reviewOverlay && !reviewOverlay.hidden) renderReviewList();
  }

  function requestPendingList() {
    if (!isOwner()) return;
    global.MorningRoastChat?.sendChatPayload?.({ type: "lineup_submission_list" });
  }

  function reviewSubmission(id, action) {
    global.MorningRoastChat?.sendChatPayload?.({
      type: "lineup_submission_review",
      submissionId: id,
      action,
    });
  }

  function populateSubmitMaps(game) {
    const select = document.getElementById("lineup-submit-map");
    if (!select) return;
    const maps = getLineupMaps(game);
    select.innerHTML = maps.map((name) => `<option value="${escapeHtml(mapToSlug(name))}">${escapeHtml(name)}</option>`).join("");
  }

  function syncSubmitGameFields(game) {
    const agentField = document.getElementById("lineup-submit-agent-field");
    const abilityField = document.getElementById("lineup-submit-ability-field");
    const utilityField = document.getElementById("lineup-submit-utility-field");
    const isValorant = game === "valorant";
    const isCs2 = game === "cs2";
    agentField?.classList.toggle("hidden", !isValorant);
    if (agentField) agentField.hidden = !isValorant;
    abilityField?.classList.toggle("hidden", !isValorant);
    if (abilityField) abilityField.hidden = !isValorant;
    utilityField?.classList.toggle("hidden", !isCs2);
    if (utilityField) utilityField.hidden = !isCs2;
  }

  function openSubmitModal() {
    const game = getActiveGame();
    if (!game) {
      showToast("Select a game before submitting a lineup.");
      return;
    }

    global.MorningRoastChat?.ensureChatJoined?.();
    const identity = readIdentity();
    if (!identity.name) {
      showToast("Set a display name on your Profile before submitting a lineup.");
      return;
    }
    if (!global.MorningRoastChat?.isChatConnected?.()) {
      showToast("Connect to community chat before submitting a lineup.");
      return;
    }

    populateSubmitMaps(game);
    syncSubmitGameFields(game);
    const status = document.getElementById("lineup-submit-status");
    if (status) status.textContent = "";
    document.getElementById("lineup-submit-form")?.reset();
    populateSubmitMaps(game);

    submitOverlay.hidden = false;
    submitOverlay.classList.add("active");
    document.getElementById("lineup-submit-title")?.focus();
  }

  function closeSubmitModal() {
    if (!submitOverlay) return;
    submitOverlay.hidden = true;
    submitOverlay.classList.remove("active");
  }

  function openReviewModal() {
    if (!isOwner()) return;
    requestPendingList();
    reviewOverlay.hidden = false;
    reviewOverlay.classList.add("active");
    renderReviewList();
  }

  function closeReviewModal() {
    if (!reviewOverlay) return;
    reviewOverlay.hidden = true;
    reviewOverlay.classList.remove("active");
    document.getElementById("lineup-review-list")?.querySelectorAll("video").forEach((video) => {
      try {
        video.pause();
      } catch {
        // ignore
      }
    });
  }

  async function handleSubmitForm(event) {
    event.preventDefault();
    if (state.submitting) return;

    const game = getActiveGame();
    if (!game) {
      showToast("Select a game before submitting.");
      return;
    }

    global.MorningRoastChat?.ensureChatJoined?.();
    const identity = readIdentity();
    if (!identity.userId || !identity.name) {
      showToast("Join community chat with your display name before submitting.");
      return;
    }

    const form = event.currentTarget;
    const status = document.getElementById("lineup-submit-status");
    const submitBtn = document.getElementById("lineup-submit-send");
    const videoInput = document.getElementById("lineup-submit-video");
    const file = videoInput?.files?.[0];
    if (!file) {
      if (status) status.textContent = "Attach a lineup video.";
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      if (status) status.textContent = "Video must be 50 MB or smaller.";
      return;
    }

    const url = resolveLineupApiUrl("/lineups/submit");
    if (!url) {
      if (status) status.textContent = "Upload server is unavailable.";
      return;
    }

    const formData = new FormData(form);
    formData.set("game", game);
    formData.set("userId", identity.userId);
    formData.set("submitterName", identity.name);
    formData.set("authorId", identity.authorId);
    formData.set("video", file);

    state.submitting = true;
    if (submitBtn) submitBtn.disabled = true;
    if (status) status.textContent = "Uploading…";

    try {
      const response = await fetch(url, { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (status) status.textContent = data.message || "Could not submit lineup.";
        return;
      }
      closeSubmitModal();
      showToast(data.message || "Lineup sent to FuZiveer for review.");
    } catch {
      if (status) status.textContent = "Upload failed. Try again.";
    } finally {
      state.submitting = false;
      if (submitBtn) submitBtn.disabled = false;
    }
  }

  function bindUi() {
    submitOverlay = document.getElementById("lineup-submit-overlay");
    reviewOverlay = document.getElementById("lineup-review-overlay");

    document.getElementById("lineup-submit-lineup-btn")?.addEventListener("click", openSubmitModal);
    document.getElementById("lineup-submit-modal-close")?.addEventListener("click", closeSubmitModal);
    document.getElementById("lineup-submit-cancel")?.addEventListener("click", closeSubmitModal);
    document.getElementById("lineup-submit-form")?.addEventListener("submit", handleSubmitForm);
    document.getElementById("lineup-owner-review-open-btn")?.addEventListener("click", openReviewModal);
    document.getElementById("lineup-review-modal-close")?.addEventListener("click", closeReviewModal);

    submitOverlay?.addEventListener("click", (event) => {
      if (event.target === submitOverlay) closeSubmitModal();
    });
    reviewOverlay?.addEventListener("click", (event) => {
      if (event.target === reviewOverlay) closeReviewModal();
    });

    document.getElementById("lineup-review-list")?.addEventListener("click", (event) => {
      const approve = event.target.closest(".lineup-review-approve");
      const reject = event.target.closest(".lineup-review-reject");
      const id = approve?.dataset.submissionId || reject?.dataset.submissionId || "";
      if (!id) return;
      if (approve) reviewSubmission(id, "approve");
      if (reject) reviewSubmission(id, "reject");
    });

    global.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (submitOverlay && !submitOverlay.hidden) closeSubmitModal();
      if (reviewOverlay && !reviewOverlay.hidden) closeReviewModal();
    });

    global.addEventListener(SUBMISSIONS_EVENT, (event) => {
      const detail = event.detail || {};
      if (detail.type === "pending") {
        setPendingList(detail.pending, detail.pendingCount);
      }
      if (detail.type === "reviewed") {
        void refreshAllCommunityLineups();
      }
    });

    global.addEventListener("morning-roast:owners-config", () => {
      updateOwnerBanner();
      if (isOwner()) requestPendingList();
    });
  }

  function handleChatMessage(message) {
    switch (message?.type) {
      case "lineup_submission_pending":
        if (isOwner()) {
          if (message.submission) showToast("New lineup submission waiting for review.");
          if (typeof message.pendingCount === "number") {
            state.pendingCount = message.pendingCount;
            updateOwnerBanner();
          }
          requestPendingList();
        }
        break;
      case "lineup_submission_list":
        if (isOwner()) setPendingList(message.pending, message.pendingCount);
        break;
      case "lineup_submission_reviewed":
        if (isOwner()) {
          state.pending = state.pending.filter((entry) => entry.id !== message.submission?.id);
          setPendingList(state.pending, message.pendingCount ?? state.pending.length);
        }
        dispatch("reviewed", { action: message.action, submission: message.submission });
        void refreshAllCommunityLineups();
        if (message.action === "approve") showToast("Community lineup approved.");
        if (message.action === "reject" && isOwner()) showToast("Lineup rejected.");
        break;
      default:
        break;
    }
  }

  function init() {
    bindUi();
    void refreshAllCommunityLineups();
    if (isOwner()) requestPendingList();
    updateOwnerBanner();
  }

  function onChatJoined() {
    if (isOwner()) requestPendingList();
    updateOwnerBanner();
  }

  global.MorningRoastLineupSubmissions = {
    init,
    refreshAllCommunityLineups,
    renderCommunityLineups,
    handleChatMessage,
    openSubmitModal,
    openReviewModal,
    isOwner,
    onChatJoined,
  };
})(window);
