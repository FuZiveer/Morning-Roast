/** User-submitted lineups — submit, owner review, community grid rendering. */
(function (global) {
  const SUBMISSIONS_EVENT = "morning-roast:lineup-submissions";
  const GAMES = ["valorant", "cs2"];

  const state = {
    pending: [],
    approved: [],
    pendingCount: 0,
    communityByGame: { valorant: [], cs2: [] },
    loading: false,
    submitting: false,
    savingEditId: "",
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

  function resolveCommunityVideoUrl(lineup) {
    const direct = String(lineup?.videoUrl || "").trim();
    if (direct) return direct;
    const id = String(lineup?.id || "").trim();
    const base = resolveHttpBase();
    if (!id || !base) return "";
    let url = `${base}/lineups/video/${encodeURIComponent(id)}`;
    if (lineup?.updatedAt) url += `${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(lineup.updatedAt)}`;
    return url;
  }

  function resolveSubmissionVideoUrl(entry, { mode = "pending" } = {}) {
    const direct = String(entry?.videoUrl || "").trim();
    if (direct) {
      if (/^(https?:|data:|blob:)/i.test(direct)) return direct;
      if (typeof global.resolveAppAssetUrl === "function") return global.resolveAppAssetUrl(direct);
      return direct;
    }
    const id = String(entry?.id || "").trim();
    const base = resolveHttpBase();
    if (!id || !base) return "";
    let url;
    if (mode === "pending") {
      const identity = readIdentity();
      url = `${base}/lineups/submissions/${encodeURIComponent(id)}/preview?userId=${encodeURIComponent(identity.userId)}&name=${encodeURIComponent(identity.name)}`;
    } else {
      url = `${base}/lineups/video/${encodeURIComponent(id)}`;
    }
    if (entry?.updatedAt) url += `${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(entry.updatedAt)}`;
    return url;
  }

  function isLocalLineupPreview() {
    const protocol = global.location?.protocol || "";
    const host = global.location?.hostname || "";
    return protocol === "file:" || host === "localhost" || host === "127.0.0.1";
  }

  function resolveLocalPreviewAsset(path) {
    if (!path) return "";
    if (typeof global.resolveAppAssetUrl === "function") return global.resolveAppAssetUrl(path);
    return path;
  }

  function getLocalReviewPreviewSamples() {
    return {
      pending: [
        {
          id: "local-preview-pending",
          status: "pending",
          game: "cs2",
          title: "Window Smoke from Spawn",
          map: "mirage",
          side: "attacker",
          callout: "Window",
          difficulty: "1",
          utility: "smoke",
          videoUrl: resolveLocalPreviewAsset("assets/lineups/cs2/mirage/window-smoke-from-spawn.mp4"),
          submittedBy: { name: "PreviewUser" },
          updatedAt: "local-preview",
        },
      ],
      approved: [
        {
          id: "local-preview-published",
          status: "approved",
          game: "valorant",
          title: "Pearl B Push Flank",
          map: "pearl",
          side: "attacker",
          callout: "B Push",
          difficulty: "2",
          agent: "Veto",
          ability: "Snare Trap",
          videoUrl: resolveLocalPreviewAsset("assets/lineups/valorant/pearl/veto-pearl-attacker.mp4"),
          submittedBy: { name: "FuZiveer" },
          updatedAt: "local-preview",
        },
      ],
    };
  }

  function seedLocalReviewPreview() {
    if (!isLocalLineupPreview()) return;
    const samples = getLocalReviewPreviewSamples();
    state.pending = samples.pending;
    state.approved = samples.approved;
    state.pendingCount = state.pending.length;
  }

  function readIdentity() {
    const profile = global.MorningRoastChat?.readProfileIdentity?.() || { name: "", bio: "", avatar: "" };
    const identity = {
      userId: global.MorningRoastChat?.getSelfUserId?.() || "",
      authorId: global.MorningRoastChat?.getAuthorId?.() || global.MorningRoastChat?.readAuthorId?.() || "",
      name: String(profile.name || "").trim(),
    };
    if (!isLocalLineupPreview()) return identity;
    return {
      userId: identity.userId || "local-preview-user",
      authorId: identity.authorId || "local-preview-author",
      name: identity.name || "Local Preview",
    };
  }

  function isOwner() {
    if (isLocalLineupPreview()) return true;
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
    const formGame = getSubmitFormGame();
    if (formGame) return formGame;
    if (typeof global.getActiveLineupGame === "function") return global.getActiveLineupGame();
    const holder = document.querySelector(".lineup-videos-holder[data-active-game]");
    const game = holder?.dataset?.activeGame || "";
    return GAMES.includes(game) ? game : null;
  }

  function getSubmitFormGame() {
    const hidden = document.getElementById("lineup-submit-game");
    const value = hidden?.value?.trim() || getSubmitDropdownEls("game").dropdown?.dataset.value || "";
    return GAMES.includes(value) ? value : "";
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

  function isOwnerDisplayName(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return false;
    if (global.MorningRoastChat?.isOwnerDisplayName?.(trimmed)) return true;
    if (typeof global.isOwnerDisplayName === "function") return global.isOwnerDisplayName(trimmed);
    return trimmed.toLowerCase() === "fuziveer";
  }

  function isReservedSubmitUsername(name) {
    if (isOwner()) return false;
    return isOwnerDisplayName(name);
  }

  function isSubmitUsernameValid(name) {
    const trimmed = String(name || "").trim();
    if (!trimmed) return false;
    return !isReservedSubmitUsername(trimmed);
  }

  function syncSubmitUsernameFieldState() {
    const input = document.getElementById("lineup-submit-username");
    const hint = document.getElementById("lineup-submit-username-hint");
    const status = document.getElementById("lineup-submit-status");
    if (!input) return;

    const reserved = isReservedSubmitUsername(input.value);
    input.classList.toggle("lineup-form-input--invalid", reserved);
    input.setAttribute("aria-invalid", reserved ? "true" : "false");
    if (hint) {
      hint.hidden = !reserved;
      hint.classList.toggle("hidden", !reserved);
    }
    if (reserved) {
      if (status) status.textContent = "That username is reserved. Choose a different display name.";
      closeAllSubmitDropdowns();
    } else if (status?.textContent?.includes("reserved")) {
      status.textContent = "";
    }
  }

  function isOwnerLineup(lineup) {
    const name = lineup?.submittedBy?.name || "";
    return isOwnerDisplayName(name);
  }

  function getMainLineupGrid(game) {
    return document.getElementById(`lineup-${game}-grid`);
  }

  function clearOwnerSubmissionCards(game) {
    getMainLineupGrid(game)
      ?.querySelectorAll('.lineup-video-card[data-lineup-dynamic="submission"]')
      .forEach((card) => card.remove());
  }

  function buildLineupCardFootHtml(lineup, authorLabel) {
    return `
      <div class="lineup-video-card-foot">
        <div class="lineup-video-card-foot-body">
          <div class="lineup-video-card-headline">
            <h3 class="lineup-video-title">${escapeHtml(lineup.title || "Lineup")}</h3>
            <span class="lineup-video-card-headline-sep" aria-hidden="true"></span>
            <p class="lineup-community-author">${escapeHtml(authorLabel)}</p>
          </div>
          <div class="lineup-difficulty" data-lineup-difficulty="${escapeHtml(lineup.difficulty || "")}" aria-label="Difficulty: ${escapeHtml(lineup.difficulty || "")} stars">
            <span class="lineup-difficulty-heading">
              <span class="lineup-difficulty-label">Difficulty</span>
              <span class="lineup-difficulty-dot" aria-hidden="true"></span>
            </span>
            <span class="lineup-difficulty-stars" aria-hidden="true">${renderDifficultyStars(lineup.difficulty)}</span>
          </div>
        </div>
      </div>`;
  }

  function applyLineupCardDataset(article, lineup) {
    const videoUrl = resolveCommunityVideoUrl(lineup);
    article.dataset.lineupMap = lineup.map || "";
    article.dataset.lineupSide = lineup.side || "";
    article.dataset.lineupCallout = lineup.callout || "";
    article.dataset.lineupDifficulty = lineup.difficulty || "";
    article.dataset.lineupVideoId = lineup.videoId || "";
    article.dataset.lineupVideoUrl = videoUrl;
    article.dataset.lineupSearch = lineup.search || "";
    article.dataset.lineupSubmitter = lineup.submittedBy?.name || "";
    if (lineup.id) article.dataset.lineupSubmissionId = lineup.id;
    if (lineup.agent) article.dataset.lineupAgent = lineup.agent;
    if (lineup.ability) article.dataset.lineupAbility = lineup.ability;
    if (lineup.utility) article.dataset.lineupUtility = lineup.utility;
    if (lineup.posterUrl) article.dataset.lineupPosterUrl = lineup.posterUrl;
  }

  function buildOwnerLineupCard(lineup) {
    const article = document.createElement("article");
    article.className = "lineup-video-card";
    article.dataset.lineupSource = "owner";
    article.dataset.lineupDynamic = "submission";
    applyLineupCardDataset(article, lineup);
    article.innerHTML = `
      <div class="lineup-video-embed">
        <img class="lineup-video-embed-poster" alt="" decoding="async" loading="lazy" hidden />
      </div>
      ${buildLineupCardFootHtml(lineup, "By FuZiveer")}`;
    return article;
  }

  function buildCommunityCard(lineup) {
    const article = document.createElement("article");
    article.className = "lineup-video-card lineup-video-card--community";
    article.dataset.lineupSource = "community";
    applyLineupCardDataset(article, lineup);

    const submitter = `By ${lineup.submittedBy?.name || "Community"}`;
    article.innerHTML = `
      <div class="lineup-video-embed">
        <img class="lineup-video-embed-poster" alt="" decoding="async" loading="lazy" hidden />
      </div>
      ${buildLineupCardFootHtml(lineup, submitter)}`;
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
    const ownerItems = items.filter(isOwnerLineup);
    const communityItems = items.filter((lineup) => !isOwnerLineup(lineup));
    state.communityByGame[game] = communityItems;

    communityItems.forEach((lineup) => {
      grid.appendChild(buildCommunityCard(lineup));
    });

    clearOwnerSubmissionCards(game);
    const mainGrid = getMainLineupGrid(game);
    ownerItems.forEach((lineup) => {
      mainGrid?.appendChild(buildOwnerLineupCard(lineup));
    });

    const hasCards = communityItems.length > 0;
    section.hidden = !hasCards;
    section.classList.toggle("hidden", !hasCards);
    if (empty) {
      empty.hidden = hasCards;
      empty.classList.toggle("hidden", hasCards);
    }

    if (typeof global.refreshLineupVideoCards === "function") {
      global.refreshLineupVideoCards(grid);
      if (mainGrid) global.refreshLineupVideoCards(mainGrid);
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
    const ownerSubmitBtn = document.getElementById("lineup-submit-lineup-owner-btn");
    const submitBtn = document.getElementById("lineup-submit-lineup-btn");
    const showOwnerTools = isOwner();

    if (ownerSubmitBtn) {
      ownerSubmitBtn.hidden = !showOwnerTools;
      ownerSubmitBtn.classList.toggle("hidden", !showOwnerTools);
    }
    if (submitBtn) {
      submitBtn.hidden = showOwnerTools;
      submitBtn.classList.toggle("hidden", showOwnerTools);
    }

    if (!banner || !text) return;

    const show = showOwnerTools && (state.pendingCount > 0 || isLocalLineupPreview());
    banner.hidden = !show;
    banner.classList.toggle("hidden", !show);
    if (isLocalLineupPreview() && state.pendingCount === 0) {
      text.textContent = "Review lineups (local preview)";
      return;
    }
    text.textContent =
      state.pendingCount === 1
        ? "1 lineup waiting for your review"
        : `${state.pendingCount} lineups waiting for your review`;
  }

  function mapFromSlug(game, slug) {
    const maps = getLineupMaps(game);
    return maps.find((name) => mapToSlug(name) === mapToSlug(slug)) || slug;
  }

  function getGameDisplayLabel(game) {
    if (game === "cs2") return "CS2";
    if (game === "valorant") return "Valorant";
    return "";
  }

  function getSideDisplayLabel(side) {
    if (!side) return "";
    return side.charAt(0).toUpperCase() + side.slice(1);
  }

  function getMapDisplayLabel(game, slug) {
    if (!slug) return "";
    const maps = getLineupMaps(game);
    return maps.find((name) => mapToSlug(name) === mapToSlug(slug)) || slug;
  }

  function buildReviewDropdownShell({
    key,
    label,
    placeholder,
    trailKind,
    listHtml,
    value = "",
    displayValue = "",
    ariaLabel = label,
    submissionId = "",
  }) {
    const hasValue = Boolean(value);
    const trailHtml =
      trailKind === "map"
        ? `<span class="lineup-submit-trail-icon" data-review-trail="map" aria-hidden="true">
            <i class="ri-earth-line lineup-submit-trail-fallback" aria-hidden="true"></i>
            <img class="lineup-submit-trail-image" alt="" width="18" height="18" decoding="async" hidden />
          </span>`
        : trailKind === "side"
          ? `<span class="lineup-submit-trail-icon" data-review-trail="side" aria-hidden="true">
              <i class="ri-team-line lineup-submit-trail-fallback" aria-hidden="true"></i>
            </span>`
          : `<span class="lineup-submit-trail-icon" data-review-trail="game" aria-hidden="true">
              <i class="ri-gamepad-line lineup-submit-trail-fallback" aria-hidden="true"></i>
              <img class="lineup-submit-trail-image game-option-icon" alt="" width="18" height="18" decoding="async" hidden />
            </span>`;

    return `
      <div class="lineup-form-field">
        <span>${escapeHtml(label)}</span>
        <div class="custom-dropdown lineup-game-dropdown" data-review-dropdown="${escapeHtml(key)}" data-value="${escapeHtml(value)}">
          <div class="selected-view" data-review-trigger="${escapeHtml(key)}" aria-haspopup="listbox" aria-expanded="false" aria-label="${escapeHtml(ariaLabel)}">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <div class="input-wrapper">
              <input type="text" class="game-search" data-review-display="${escapeHtml(key)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" value="${escapeHtml(displayValue)}" />
              <button type="button" class="clear-btn" data-review-clear="${escapeHtml(key)}" aria-label="Clear ${escapeHtml(label.toLowerCase())}"${hasValue ? "" : " hidden"}>&times;</button>
            </div>
            ${trailHtml}
          </div>
          <div class="pref-dropdown-list hidden lineup-review-dropdown-list" data-review-list="${escapeHtml(key)}" data-review-submission="${escapeHtml(submissionId)}" role="listbox">${listHtml}</div>
          <input type="hidden" data-field="${escapeHtml(key)}" value="${escapeHtml(value)}" />
        </div>
      </div>`;
  }

  function getReviewGameIconName(gameKey) {
    if (gameKey === "cs2") return "CS2";
    if (gameKey === "valorant") return "Valorant";
    return getGameDisplayLabel(gameKey);
  }

  function getReviewGameIconSrc(gameKey) {
    const name = getReviewGameIconName(gameKey);
    if (!name) return "";
    if (typeof global.getGameIconSrc === "function") return global.getGameIconSrc(name) || "";
    const icons = {
      valorant: "https://cdn.simpleicons.org/valorant/FF4655",
      cs2: "https://cdn.simpleicons.org/counterstrike/DE9B35",
    };
    return icons[gameKey] || "";
  }

  function renderReviewGameOptionIcon(gameKey) {
    if (typeof global.renderGameOptionIcon === "function") {
      return global.renderGameOptionIcon(getReviewGameIconName(gameKey));
    }
    const src = getReviewGameIconSrc(gameKey);
    if (!src) return "";
    const name = getReviewGameIconName(gameKey);
    return `<img class="game-option-icon" src="${escapeHtml(src)}" alt="" width="18" height="18" decoding="async" data-game-icon-name="${escapeHtml(name)}" />`;
  }

  function buildReviewGameListHtml() {
    return GAMES.map((game) => {
      const label = getGameDisplayLabel(game);
      const iconHtml = renderReviewGameOptionIcon(game);
      return `<button type="button" class="pref-dropdown-option" data-dropdown-value="${escapeHtml(game)}" role="option">${iconHtml}<span>${escapeHtml(label)}</span></button>`;
    }).join("");
  }

  function buildReviewSideListHtml() {
    return ["attacker", "defender"]
      .map((side) => {
        const label = getSideDisplayLabel(side);
        return `<button type="button" class="pref-dropdown-option" data-dropdown-value="${escapeHtml(side)}" role="option"><span>${escapeHtml(label)}</span></button>`;
      })
      .join("");
  }

  function syncReviewItemMapOptions(item) {
    if (!item) return;
    const game = item.querySelector('[data-field="game"]')?.value || "valorant";
    const mapValue = item.querySelector('[data-field="map"]')?.value || "";
    populateReviewMapList(item, game, mapValue);
    syncReviewSideOptionIcons(item, game);
    const validSlugs = getLineupMaps(game).map(mapToSlug);
    if ((!mapValue || !validSlugs.includes(mapToSlug(mapValue))) && validSlugs.length) {
      const nextSlug = validSlugs[0];
      setReviewDropdownValue(item, "map", nextSlug, getMapDisplayLabel(game, nextSlug));
    }
  }

  function openOverlay(overlay) {
    if (!overlay) return;
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add("active"));
  }

  function closeOverlay(overlay) {
    if (!overlay) return;
    overlay.classList.remove("active");
    overlay.hidden = true;
  }

  function readReviewItemFields(itemEl) {
    const title = itemEl.querySelector('[data-field="title"]')?.value?.trim() || "";
    const map = itemEl.querySelector('[data-field="map"]')?.value?.trim() || "";
    const game = itemEl.querySelector('[data-field="game"]')?.value?.trim() || "";
    const side = itemEl.querySelector('[data-field="side"]')?.value?.trim() || "";
    const submitterName = itemEl.querySelector('[data-field="submitterName"]')?.value?.trim() || "";
    const video = itemEl.querySelector('[data-field="video"]')?.files?.[0] || null;
    return { title, map, game, side, submitterName, video };
  }

  function buildReviewEditPayload(metadata) {
    return {
      title: metadata.title,
      map: metadata.map,
      game: metadata.game,
      side: metadata.side,
      submitterName: metadata.submitterName,
    };
  }

  function refreshReviewItemVideoPreview(item, entry) {
    const video = item?.querySelector(".lineup-review-item-video");
    if (!video) return;
    const mode = item.dataset.reviewMode === "published" ? "published" : "pending";
    const url = resolveSubmissionVideoUrl(entry, { mode });
    if (!url) return;
    video.src = url;
    video.load();
  }

  async function uploadSubmissionVideo(id, file) {
    if (!file) return true;
    if (file.size > 50 * 1024 * 1024) {
      showToast("Video must be 50 MB or smaller.", "error");
      return false;
    }

    const identity = readIdentity();
    const url = resolveLineupApiUrl(`/lineups/submissions/${encodeURIComponent(id)}/video`);
    if (!url) {
      showToast("Upload server is unavailable.", "error");
      return false;
    }

    const formData = new FormData();
    formData.set("userId", identity.userId);
    formData.set("displayName", identity.name);
    formData.set("video", file);

    try {
      const response = await fetch(url, { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(data.message || "Could not replace video.", "error");
        return false;
      }
      if (data.submission) {
        upsertSubmissionEntry(data.submission);
        return data.submission;
      }
      return true;
    } catch {
      showToast("Video upload failed.", "error");
      return false;
    }
  }

  async function saveReviewItem(item, id, metadata, { approve = false } = {}) {
    if (state.savingEditId) return false;

    if (isLocalLineupPreview()) {
      showToast("Preview mode — styling only.");
      return false;
    }

    const saveBtn = item.querySelector(".lineup-review-save");
    const approveBtn = item.querySelector(".lineup-review-approve");
    state.savingEditId = id;
    if (saveBtn) saveBtn.disabled = true;
    if (approveBtn) approveBtn.disabled = true;

    try {
      if (metadata.video) {
        const uploaded = await uploadSubmissionVideo(id, metadata.video);
        if (!uploaded) return false;

        const videoInput = item.querySelector('[data-field="video"]');
        if (videoInput) videoInput.value = "";

        const entry =
          typeof uploaded === "object"
            ? uploaded
            : state.pending.find((row) => row.id === id) || state.approved.find((row) => row.id === id);
        if (entry) refreshReviewItemVideoPreview(item, entry);
      }

      if (approve) reviewSubmission(id, "approve", buildReviewEditPayload(metadata));
      else {
        saveSubmissionEdit(id, buildReviewEditPayload(metadata));
        showToast(metadata.video ? "Lineup saved." : "Lineup details saved.");
      }

      return true;
    } finally {
      state.savingEditId = "";
      if (saveBtn) saveBtn.disabled = false;
      if (approveBtn) approveBtn.disabled = false;
    }
  }

  function upsertSubmissionEntry(entry) {
    if (!entry?.id) return;
    if (entry.status === "pending") {
      const index = state.pending.findIndex((item) => item.id === entry.id);
      if (index >= 0) state.pending[index] = entry;
      else state.pending.push(entry);
      state.pending = state.pending.filter((item) => item.status === "pending");
    } else if (entry.status === "approved") {
      const index = state.approved.findIndex((item) => item.id === entry.id);
      if (index >= 0) state.approved[index] = entry;
      else state.approved.unshift(entry);
      state.approved = state.approved.filter((item) => item.status === "approved");
    }
  }

  function saveSubmissionEdit(id, metadata) {
    global.MorningRoastChat?.sendChatPayload?.({
      type: "lineup_submission_edit",
      submissionId: id,
      title: metadata.title,
      map: metadata.map,
      game: metadata.game,
      side: metadata.side,
      submitterName: metadata.submitterName,
    });
  }

  const FILE_INPUT_PLACEHOLDER = "Select file";

  function syncLineupFormFileText(input) {
    const wrap = input?.closest(".lineup-form-file-wrap");
    const textEl = wrap?.querySelector(".lineup-form-file-text");
    if (!wrap || !textEl) return;
    const file = input.files?.[0];
    textEl.textContent = file?.name || textEl.dataset.placeholder || FILE_INPUT_PLACEHOLDER;
    wrap.classList.toggle("has-file", Boolean(file));
  }

  function initLineupFormFileInput(input) {
    if (!input || input.dataset.lineupFileInit === "true") return;
    input.dataset.lineupFileInit = "true";
    input.addEventListener("change", () => syncLineupFormFileText(input));
    syncLineupFormFileText(input);
  }

  function initLineupFormFileInputs(root = document) {
    root.querySelectorAll(".lineup-form-file-wrap .lineup-form-file").forEach(initLineupFormFileInput);
  }

  function reviewSubmission(id, action, metadata = {}) {
    global.MorningRoastChat?.sendChatPayload?.({
      type: "lineup_submission_review",
      submissionId: id,
      action,
      title: metadata.title,
      map: metadata.map,
      game: metadata.game,
      side: metadata.side,
      submitterName: metadata.submitterName,
    });
  }

  function deleteSubmission(id) {
    global.MorningRoastChat?.sendChatPayload?.({
      type: "lineup_submission_delete",
      submissionId: id,
    });
  }

  function removeSubmissionEntry(id) {
    if (!id) return;
    state.pending = state.pending.filter((entry) => entry.id !== id);
    state.approved = state.approved.filter((entry) => entry.id !== id);
  }

  function renderEditableFields(entry) {
    const game = entry.game || "valorant";
    const side = entry.side || "";
    const map = entry.map || "";
    const submissionId = entry.id || "";
    return `
      <div class="lineup-review-item-fields lineup-flow-form">
        <div class="lineup-form-field">
          <span>Username</span>
          <input type="text" class="lineup-form-input" data-field="submitterName" maxlength="32" aria-label="Username" placeholder="Your display name" value="${escapeHtml(entry.submittedBy?.name || "")}" />
        </div>
        ${buildReviewDropdownShell({
          key: "game",
          label: "Game",
          placeholder: "Select game",
          trailKind: "game",
          listHtml: buildReviewGameListHtml(),
          value: game,
          displayValue: getGameDisplayLabel(game),
          ariaLabel: "Game",
          submissionId,
        })}
        ${buildReviewDropdownShell({
          key: "side",
          label: "Side",
          placeholder: "Select side",
          trailKind: "side",
          listHtml: buildReviewSideListHtml(),
          value: side,
          displayValue: getSideDisplayLabel(side),
          ariaLabel: "Side",
          submissionId,
        })}
        <div class="lineup-form-field">
          <span>Title</span>
          <input type="text" class="lineup-form-input" data-field="title" maxlength="120" aria-label="Title" placeholder="e.g. A Site Default Smoke" value="${escapeHtml(entry.title || "")}" />
        </div>
        ${buildReviewDropdownShell({
          key: "map",
          label: "Map",
          placeholder: "Select map",
          trailKind: "map",
          listHtml: "",
          value: map,
          displayValue: getMapDisplayLabel(game, map),
          ariaLabel: "Map",
          submissionId,
        })}
        <div class="lineup-form-field">
          <span>Replace video</span>
          <div class="lineup-form-file-wrap">
            <input type="file" class="lineup-form-file" data-field="video" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" aria-label="Replace video" />
            <span class="lineup-form-file-text" data-placeholder="Select file">Select file</span>
          </div>
          <span class="lineup-form-hint">Optional. Upload a new MP4, WebM, or MOV (50 MB max).</span>
        </div>
      </div>`;
  }

  function renderReviewItem(entry, { mode = "pending" } = {}) {
    const item = document.createElement("article");
    item.className = "lineup-review-item setting-block";
    item.dataset.submissionId = entry.id;
    item.dataset.reviewMode = mode;

    const previewUrl = resolveSubmissionVideoUrl(entry, { mode });

    item.innerHTML = `
      <div class="lineup-review-item-main">
        ${entry.callout ? `<p class="lineup-review-item-callout">${escapeHtml(entry.callout)}</p>` : ""}
        ${renderEditableFields(entry)}
        ${previewUrl ? `<video class="lineup-review-item-video" src="${escapeHtml(previewUrl)}" controls playsinline preload="metadata"></video>` : ""}
      </div>
      <div class="lineup-flow-actions lineup-review-item-actions">
        <button type="button" class="lineup-flow-btn${mode === "published" ? " lineup-flow-btn-save" : ""} lineup-review-save" data-submission-id="${escapeHtml(entry.id)}">Save changes</button>
        ${
          mode === "pending"
            ? `<button type="button" class="lineup-flow-btn lineup-flow-btn-cancel lineup-review-reject" data-submission-id="${escapeHtml(entry.id)}">Reject</button>`
            : `<button type="button" class="lineup-flow-btn lineup-flow-btn-cancel lineup-review-delete" data-submission-id="${escapeHtml(entry.id)}">Delete</button>`
        }
        ${
          mode === "pending"
            ? `<button type="button" class="lineup-flow-btn lineup-flow-btn-save lineup-review-approve" data-submission-id="${escapeHtml(entry.id)}">Approve</button>`
            : ""
        }
      </div>`;
    return item;
  }

  function renderReviewSection(listEl, emptyEl, entries, mode) {
    if (!listEl || !emptyEl) return;
    listEl.innerHTML = "";
    if (!entries.length) {
      emptyEl.hidden = false;
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.hidden = true;
    emptyEl.classList.add("hidden");
    entries.forEach((entry) => listEl.appendChild(renderReviewItem(entry, { mode })));
  }

  function renderReviewList() {
    renderReviewSection(
      document.getElementById("lineup-review-list"),
      document.getElementById("lineup-review-empty"),
      state.pending,
      "pending",
    );
    initLineupFormFileInputs(reviewOverlay);
    closeAllReviewDropdowns();
    reviewOverlay?.querySelectorAll(".lineup-review-item").forEach((item) => initReviewItemDropdowns(item));
  }

  function setSubmissionLists(pending, approved, pendingCount) {
    state.pending = Array.isArray(pending) ? pending : [];
    state.approved = Array.isArray(approved) ? approved : state.approved;
    state.pendingCount = Number.isFinite(Number(pendingCount)) ? Number(pendingCount) : state.pending.length;
    updateOwnerBanner();
    if (reviewOverlay && !reviewOverlay.hidden) renderReviewList();
  }

  function setPendingList(pending, pendingCount, approved) {
    setSubmissionLists(pending, approved ?? state.approved, pendingCount);
  }

  function requestPendingList() {
    if (!isOwner()) return;
    global.MorningRoastChat?.sendChatPayload?.({ type: "lineup_submission_list" });
  }

  function populateSubmitMaps(game) {
    const list = document.getElementById("lineup-submit-map-list");
    if (!list) return;
    const maps = getLineupMaps(game);
    list.innerHTML = maps
      .map((name) => {
        const slug = mapToSlug(name);
        const iconHtml =
          typeof global.renderLineupMapOptionIcon === "function"
            ? global.renderLineupMapOptionIcon(game, slug)
            : "";
        return `<button type="button" class="pref-dropdown-option" data-submit-value="${escapeHtml(slug)}" role="option">${iconHtml}<span>${escapeHtml(name)}</span></button>`;
      })
      .join("");
    setSubmitDropdownValue("map", "", "");
  }

  function populateSubmitGames() {
    const list = document.getElementById("lineup-submit-game-list");
    if (!list) return;
    list.innerHTML = GAMES.map((game) => {
      const label = getGameDisplayLabel(game);
      const iconHtml = renderReviewGameOptionIcon(game);
      return `<button type="button" class="pref-dropdown-option" data-submit-value="${escapeHtml(game)}" role="option">${iconHtml}<span>${escapeHtml(label)}</span></button>`;
    }).join("");
  }

  const SUBMIT_FORM_DROPDOWN_KEYS = ["game", "map", "side", "difficulty"];
  const submitDropdownUi = {
    openKey: "",
    activeIndex: -1,
    repositionHandler: null,
    suppressFocusOpenKey: "",
  };

  function getSubmitDropdownEls(key) {
    return {
      dropdown: document.getElementById(`lineup-submit-${key}-dropdown`),
      trigger: document.getElementById(`lineup-submit-${key}-trigger`),
      list: document.getElementById(`lineup-submit-${key}-list`),
      display: document.getElementById(`lineup-submit-${key}-display`),
      clearBtn: document.getElementById(`lineup-submit-${key}-clear`),
      hidden: document.getElementById(`lineup-submit-${key}`),
    };
  }

  function syncSubmitClearButton(key) {
    const { dropdown, clearBtn, hidden } = getSubmitDropdownEls(key);
    if (!clearBtn) return;
    const hasValue = Boolean(hidden?.value || dropdown?.dataset.value);
    clearBtn.hidden = !hasValue;
    clearBtn.style.display = hasValue ? "flex" : "none";
  }

  function resolveSubmitAssetUrl(path) {
    if (!path) return "";
    if (typeof global.resolveAppAssetUrl === "function") return global.resolveAppAssetUrl(path);
    return path;
  }

  function getSubmitMapIconSrc(game, slug) {
    if (!game || !slug) return "";
    if (typeof global.getLineupMapIconSrc === "function") return global.getLineupMapIconSrc(game, slug) || "";
    return global.LINEUP_MAP_ICONS?.[game]?.[slug] || "";
  }

  function getSubmitSideLabel(game, side) {
    if (!game || !side) return "";
    if (game === "cs2") {
      if (side === "attacker") return "T";
      if (side === "defender") return "CT";
    }
    if (game === "valorant") {
      if (side === "attacker") return "A";
      if (side === "defender") return "D";
    }
    return "";
  }

  function getDropdownOptionLabel(option) {
    if (!option) return "";
    const spans = option.querySelectorAll(":scope > span");
    for (let index = spans.length - 1; index >= 0; index -= 1) {
      const span = spans[index];
      if (!span.classList.contains("lineup-submit-side-option-text")) {
        return span.textContent?.trim() || "";
      }
    }
    return option.textContent?.trim() || "";
  }

  function getSubmitDropdownDisplayLabel(key, value) {
    const resolved = String(value || "").trim();
    if (!resolved) return "";
    if (key === "game") return getGameDisplayLabel(resolved);
    if (key === "side") return getSideDisplayLabel(resolved);
    if (key === "map") return getMapDisplayLabel(getSubmitFormGame() || getActiveGame(), resolved);
    if (key === "difficulty") {
      const stars = Number(resolved);
      if (Number.isFinite(stars) && stars > 0) return `${stars} star${stars === 1 ? "" : "s"}`;
    }
    return resolved;
  }

  function getReviewDropdownDisplayLabel(item, key, value) {
    const resolved = String(value || "").trim();
    if (!resolved) return "";
    if (key === "side") return getSideDisplayLabel(resolved);
    if (key === "game") return getGameDisplayLabel(resolved);
    if (key === "map") return getMapDisplayLabel(getReviewItemGame(item), resolved);
    return resolved;
  }

  function ensureSubmitTrailFallback(trail, iconClass) {
    let fallback = trail.querySelector(".lineup-submit-trail-fallback");
    if (!fallback) {
      fallback = document.createElement("i");
      fallback.setAttribute("aria-hidden", "true");
      trail.appendChild(fallback);
    }
    fallback.className = `${iconClass} lineup-submit-trail-fallback`;
    fallback.hidden = false;
    return fallback;
  }

  function showSubmitTrailText(trail, text, iconClass) {
    if (!trail) return;
    if (!text) {
      trail.textContent = "";
      ensureSubmitTrailFallback(trail, iconClass);
      trail.classList.remove("has-value");
      trail.removeAttribute("data-value");
      return;
    }
    trail.textContent = text;
    trail.classList.add("has-value");
  }

  function syncSubmitTrailIcon(key, value = "") {
    const trail = document.getElementById(`lineup-submit-${key}-trail`);
    if (!trail) return;
    const game = key === "game" ? String(value || "").trim() : getSubmitFormGame() || getActiveGame();
    const fallback = trail.querySelector(".lineup-submit-trail-fallback");
    const image = trail.querySelector(".lineup-submit-trail-image");
    const resolvedValue = String(value || "").trim();

    if (key === "game") {
      const src = getReviewGameIconSrc(resolvedValue);
      if (src && image) {
        if (fallback) fallback.hidden = true;
        image.src = src;
        image.hidden = false;
        trail.classList.add("has-value");
        trail.dataset.value = resolvedValue;
        return;
      }
      if (image) {
        image.hidden = true;
        image.removeAttribute("src");
      }
      ensureSubmitTrailFallback(trail, "ri-gamepad-line");
      trail.classList.remove("has-value");
      trail.removeAttribute("data-value");
      return;
    }

    if (key === "map") {
      const showMapFallback = () => {
        if (image) {
          image.hidden = true;
          image.removeAttribute("src");
        }
        ensureSubmitTrailFallback(trail, "ri-earth-line");
        trail.classList.remove("has-value");
        trail.removeAttribute("data-value");
      };

      const src = getSubmitMapIconSrc(game, resolvedValue);
      if (src && image) {
        const mapFallback = trail.querySelector(".lineup-submit-trail-fallback");
        if (mapFallback) mapFallback.hidden = true;
        image.src = src;
        image.hidden = false;
        trail.classList.add("has-value");
        trail.dataset.value = resolvedValue;
        return;
      }
      showMapFallback();
      return;
    }

    if (key === "side") {
      const label = getSubmitSideLabel(game, resolvedValue);
      showSubmitTrailText(trail, label, "ri-team-line");
      if (resolvedValue) trail.dataset.value = resolvedValue;
      return;
    }

    if (key === "difficulty") {
      showSubmitTrailText(trail, resolvedValue, "ri-star-fill");
      if (resolvedValue) trail.dataset.value = resolvedValue;
    }
  }

  function restoreSubmitDropdownDisplay(key) {
    const { dropdown, list, display, hidden } = getSubmitDropdownEls(key);
    if (!display || !list) return;
    list.querySelectorAll("[data-submit-value]").forEach((option) => {
      option.style.display = "";
    });
    const value = hidden?.value || dropdown?.dataset.value || "";
    const option = list.querySelector(`[data-submit-value="${value}"]`);
    display.value = getSubmitDropdownDisplayLabel(key, value) || getDropdownOptionLabel(option);
    syncSubmitClearButton(key);
  }

  function setSubmitDropdownValue(key, value, label) {
    const { dropdown, list, display, hidden } = getSubmitDropdownEls(key);
    if (!dropdown || !display || !hidden) return;
    dropdown.dataset.value = value || "";
    hidden.value = value || "";
    display.value = label || "";
    list?.querySelectorAll("[data-submit-value]").forEach((option) => {
      option.classList.toggle("active", option.dataset.submitValue === value);
    });
    syncSubmitClearButton(key);
    syncSubmitTrailIcon(key, value || "");
    syncSubmitFormSteps();
  }

  function getSubmitDropdownVisibleOptions(key) {
    const { list } = getSubmitDropdownEls(key);
    if (!list) return [];
    return Array.from(list.querySelectorAll("[data-submit-value]")).filter((option) => option.style.display !== "none");
  }

  function syncSubmitDropdownHover(key) {
    const visible = getSubmitDropdownVisibleOptions(key);
    visible.forEach((option, index) => option.classList.toggle("hover", index === submitDropdownUi.activeIndex));
    if (submitDropdownUi.activeIndex >= 0 && visible[submitDropdownUi.activeIndex]) {
      visible[submitDropdownUi.activeIndex].scrollIntoView({ block: "nearest" });
    }
  }

  const SUBMIT_DROPDOWN_LIST_MAX_HEIGHT = 250;

  function positionOpenSubmitDropdown() {
    const key = submitDropdownUi.openKey;
    if (!key) return;
    const { trigger, list } = getSubmitDropdownEls(key);
    if (!trigger || !list || list.classList.contains("hidden")) return;

    const gap = 6;
    const padding = 8;
    const maxPanelHeight = SUBMIT_DROPDOWN_LIST_MAX_HEIGHT;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;
    const viewportOffsetLeft = window.visualViewport?.offsetLeft ?? 0;
    const rect = trigger.getBoundingClientRect();
    const resolvedWidth = Math.max(rect.width, 0);

    list.style.width = `${Math.round(resolvedWidth)}px`;
    list.style.maxHeight = "";

    let left = rect.left;
    if (left + resolvedWidth > viewportOffsetLeft + viewportWidth - padding) {
      left = viewportOffsetLeft + viewportWidth - resolvedWidth - padding;
    }
    left = Math.max(viewportOffsetLeft + padding, left);
    list.style.left = `${Math.round(left)}px`;

    const spaceBelow = viewportOffsetTop + viewportHeight - rect.bottom - gap - padding;
    const spaceAbove = rect.top - viewportOffsetTop - gap - padding;
    const naturalHeight = list.scrollHeight;
    const heightCap = Math.min(naturalHeight, maxPanelHeight);
    const openUp = heightCap > spaceBelow && spaceAbove > spaceBelow;
    let available = Math.max(openUp ? spaceAbove : spaceBelow, 96);
    available = Math.min(available, maxPanelHeight);

    list.style.maxHeight = `${available}px`;
    list.classList.toggle("pref-dropdown-list-opens-up", openUp);

    const panelHeight = Math.min(list.scrollHeight, available);
    let top = openUp ? rect.top - panelHeight - gap : rect.bottom + gap;
    const minTop = viewportOffsetTop + padding;
    const maxTop = viewportOffsetTop + viewportHeight - padding - panelHeight;
    top = Math.max(minTop, Math.min(top, maxTop));
    list.style.top = `${Math.round(top)}px`;
  }

  function mountSubmitDropdownList(key) {
    const { dropdown, list } = getSubmitDropdownEls(key);
    if (!dropdown || !list) return;
    if (!list._portalAnchor) list._portalAnchor = dropdown;
    if (list.parentElement !== document.body) {
      document.body.appendChild(list);
      list.classList.add("pref-dropdown-list-portal", "lineup-submit-dropdown-list-portal");
    }
    dropdown.classList.add("is-open");
    list.classList.remove("hidden");
    positionOpenSubmitDropdown();
    requestAnimationFrame(() => positionOpenSubmitDropdown());
    if (!submitDropdownUi.repositionHandler) {
      submitDropdownUi.repositionHandler = () => positionOpenSubmitDropdown();
      global.addEventListener("resize", submitDropdownUi.repositionHandler);
      global.addEventListener("scroll", submitDropdownUi.repositionHandler, true);
      window.visualViewport?.addEventListener("resize", submitDropdownUi.repositionHandler);
      window.visualViewport?.addEventListener("scroll", submitDropdownUi.repositionHandler);
    }
  }

  function closeSubmitDropdown(key) {
    const { dropdown, trigger, list, display } = getSubmitDropdownEls(key);
    if (!dropdown || !list) return;
    dropdown.classList.remove("is-open");
    trigger?.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    if (list._portalAnchor && list.parentElement === document.body) {
      list._portalAnchor.appendChild(list);
    }
    list.classList.remove("pref-dropdown-list-portal", "lineup-submit-dropdown-list-portal", "pref-dropdown-list-opens-up");
    list.style.top = "";
    list.style.left = "";
    list.style.width = "";
    list.style.maxHeight = "";
    if (submitDropdownUi.openKey === key) {
      submitDropdownUi.openKey = "";
      submitDropdownUi.activeIndex = -1;
    }
    if (!submitDropdownUi.openKey && submitDropdownUi.repositionHandler) {
      global.removeEventListener("resize", submitDropdownUi.repositionHandler);
      global.removeEventListener("scroll", submitDropdownUi.repositionHandler, true);
      window.visualViewport?.removeEventListener("resize", submitDropdownUi.repositionHandler);
      window.visualViewport?.removeEventListener("scroll", submitDropdownUi.repositionHandler);
      submitDropdownUi.repositionHandler = null;
    }
  }

  function closeAllSubmitDropdowns() {
    SUBMIT_FORM_DROPDOWN_KEYS.forEach((key) => closeSubmitDropdown(key));
  }

  const REVIEW_DROPDOWN_KEYS = ["game", "side", "map"];
  const reviewDropdownUi = {
    openItem: null,
    openKey: "",
    activeIndex: -1,
    repositionHandler: null,
    suppressFocusOpen: null,
  };

  function getReviewDropdownEls(item, key) {
    if (!item) return {};
    const submissionId = item.dataset.submissionId || "";
    const dropdown = item.querySelector(`[data-review-dropdown="${key}"]`);
    const list =
      item.querySelector(`[data-review-list="${key}"]`) ||
      (submissionId
        ? document.querySelector(
            `.lineup-review-dropdown-list[data-review-list="${key}"][data-review-submission="${submissionId}"]`,
          )
        : null);
    return {
      dropdown,
      trigger: item.querySelector(`[data-review-trigger="${key}"]`),
      list,
      display: item.querySelector(`[data-review-display="${key}"]`),
      clearBtn: item.querySelector(`[data-review-clear="${key}"]`),
      hidden: item.querySelector(`[data-field="${key}"]`),
    };
  }

  function getReviewItemGame(item) {
    return item?.querySelector('[data-field="game"]')?.value || "valorant";
  }

  function syncReviewClearButton(item, key) {
    const { dropdown, clearBtn, hidden } = getReviewDropdownEls(item, key);
    if (!clearBtn) return;
    const hasValue = Boolean(hidden?.value || dropdown?.dataset.value);
    clearBtn.hidden = !hasValue;
    clearBtn.style.display = hasValue ? "flex" : "none";
  }

  function syncReviewTrailIcon(item, key, value = "") {
    const trail = item?.querySelector(`[data-review-trail="${key}"]`);
    if (!trail) return;
    const game = getReviewItemGame(item);
    const resolvedValue = String(value || "").trim();
    const fallback = trail.querySelector(".lineup-submit-trail-fallback");
    const image = trail.querySelector(".lineup-submit-trail-image");

    if (key === "map") {
      const src = getSubmitMapIconSrc(game, resolvedValue);
      if (src && image) {
        if (fallback) fallback.hidden = true;
        image.src = src;
        image.hidden = false;
        trail.classList.add("has-value");
        trail.dataset.value = resolvedValue;
        return;
      }
      if (image) {
        image.hidden = true;
        image.removeAttribute("src");
      }
      ensureSubmitTrailFallback(trail, "ri-earth-line");
      trail.classList.remove("has-value");
      trail.removeAttribute("data-value");
      return;
    }

    if (key === "side") {
      showSubmitTrailText(trail, getSubmitSideLabel(game, resolvedValue), "ri-team-line");
      if (resolvedValue) trail.dataset.value = resolvedValue;
      return;
    }

    if (key === "game") {
      const src = getReviewGameIconSrc(resolvedValue);
      if (src && image) {
        if (fallback) fallback.hidden = true;
        image.src = src;
        image.hidden = false;
        trail.classList.add("has-value");
        trail.dataset.value = resolvedValue;
        return;
      }
      if (image) {
        image.hidden = true;
        image.removeAttribute("src");
      }
      ensureSubmitTrailFallback(trail, "ri-gamepad-line");
      trail.classList.remove("has-value");
      trail.removeAttribute("data-value");
    }
  }

  function populateReviewMapList(item, game, selectedSlug = "") {
    const { list } = getReviewDropdownEls(item, "map");
    if (!list) return;
    list.innerHTML = getLineupMaps(game)
      .map((name) => {
        const slug = mapToSlug(name);
        const iconHtml =
          typeof global.renderLineupMapOptionIcon === "function"
            ? global.renderLineupMapOptionIcon(game, slug)
            : "";
        return `<button type="button" class="pref-dropdown-option" data-dropdown-value="${escapeHtml(slug)}" role="option">${iconHtml}<span>${escapeHtml(name)}</span></button>`;
      })
      .join("");
    if (selectedSlug) {
      setReviewDropdownValue(item, "map", selectedSlug, getMapDisplayLabel(game, selectedSlug));
    }
  }

  function syncReviewSideOptionIcons(item, game) {
    const { list } = getReviewDropdownEls(item, "side");
    if (!list) return;
    list.querySelectorAll("[data-dropdown-value]").forEach((option) => {
      const side = option.dataset.dropdownValue || "";
      const label = getSubmitSideLabel(game, side);
      let text = option.querySelector(".lineup-submit-side-option-text");
      if (!label) {
        text?.remove();
        return;
      }
      if (!text) {
        text = document.createElement("span");
        text.className = "lineup-submit-side-option-text";
        text.setAttribute("aria-hidden", "true");
        option.insertBefore(text, option.firstChild);
      }
      text.textContent = label;
    });
    syncReviewTrailIcon(item, "side", item.querySelector('[data-field="side"]')?.value || "");
  }

  function setReviewDropdownValue(item, key, value, label) {
    const { dropdown, list, display, hidden } = getReviewDropdownEls(item, key);
    if (!dropdown || !display || !hidden) return;
    dropdown.dataset.value = value || "";
    hidden.value = value || "";
    display.value = label || "";
    list?.querySelectorAll("[data-dropdown-value]").forEach((option) => {
      option.classList.toggle("active", option.dataset.dropdownValue === value);
    });
    syncReviewClearButton(item, key);
    syncReviewTrailIcon(item, key, value || "");
  }

  function getReviewDropdownVisibleOptions(item, key) {
    const { list } = getReviewDropdownEls(item, key);
    if (!list) return [];
    return Array.from(list.querySelectorAll("[data-dropdown-value]")).filter((option) => option.style.display !== "none");
  }

  function syncReviewDropdownHover(item, key) {
    const visible = getReviewDropdownVisibleOptions(item, key);
    visible.forEach((option, index) => option.classList.toggle("hover", index === reviewDropdownUi.activeIndex));
    if (reviewDropdownUi.activeIndex >= 0 && visible[reviewDropdownUi.activeIndex]) {
      visible[reviewDropdownUi.activeIndex].scrollIntoView({ block: "nearest" });
    }
  }

  function positionOpenReviewDropdown() {
    const item = reviewDropdownUi.openItem;
    const key = reviewDropdownUi.openKey;
    if (!item || !key) return;
    const { trigger, list } = getReviewDropdownEls(item, key);
    if (!trigger || !list || list.classList.contains("hidden")) return;

    const gap = 6;
    const padding = 8;
    const maxPanelHeight = SUBMIT_DROPDOWN_LIST_MAX_HEIGHT;
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const viewportOffsetTop = window.visualViewport?.offsetTop ?? 0;
    const viewportOffsetLeft = window.visualViewport?.offsetLeft ?? 0;
    const rect = trigger.getBoundingClientRect();
    const resolvedWidth = Math.max(rect.width, 0);

    list.style.width = `${Math.round(resolvedWidth)}px`;
    list.style.maxHeight = "";

    let left = rect.left;
    if (left + resolvedWidth > viewportOffsetLeft + viewportWidth - padding) {
      left = viewportOffsetLeft + viewportWidth - resolvedWidth - padding;
    }
    left = Math.max(viewportOffsetLeft + padding, left);
    list.style.left = `${Math.round(left)}px`;

    const spaceBelow = viewportOffsetTop + viewportHeight - rect.bottom - gap - padding;
    const spaceAbove = rect.top - viewportOffsetTop - gap - padding;
    const naturalHeight = list.scrollHeight;
    const heightCap = Math.min(naturalHeight, maxPanelHeight);
    const openUp = heightCap > spaceBelow && spaceAbove > spaceBelow;
    let available = Math.max(openUp ? spaceAbove : spaceBelow, 96);
    available = Math.min(available, maxPanelHeight);

    list.style.maxHeight = `${available}px`;
    list.classList.toggle("pref-dropdown-list-opens-up", openUp);

    const panelHeight = Math.min(list.scrollHeight, available);
    let top = openUp ? rect.top - panelHeight - gap : rect.bottom + gap;
    const minTop = viewportOffsetTop + padding;
    const maxTop = viewportOffsetTop + viewportHeight - padding - panelHeight;
    top = Math.max(minTop, Math.min(top, maxTop));
    list.style.top = `${Math.round(top)}px`;
  }

  function mountReviewDropdownList(item, key) {
    const { dropdown, list } = getReviewDropdownEls(item, key);
    if (!dropdown || !list) return;
    if (!list._portalAnchor) list._portalAnchor = dropdown;
    if (list.parentElement !== document.body) {
      document.body.appendChild(list);
      list.classList.add("pref-dropdown-list-portal", "lineup-submit-dropdown-list-portal", "lineup-review-dropdown-list");
    }
    dropdown.classList.add("is-open");
    list.classList.remove("hidden");
    positionOpenReviewDropdown();
    requestAnimationFrame(() => positionOpenReviewDropdown());
    if (!reviewDropdownUi.repositionHandler) {
      reviewDropdownUi.repositionHandler = () => positionOpenReviewDropdown();
      global.addEventListener("resize", reviewDropdownUi.repositionHandler);
      global.addEventListener("scroll", reviewDropdownUi.repositionHandler, true);
      window.visualViewport?.addEventListener("resize", reviewDropdownUi.repositionHandler);
      window.visualViewport?.addEventListener("scroll", reviewDropdownUi.repositionHandler);
    }
  }

  function closeReviewDropdown(item, key) {
    if (!item || !key) return;
    const { dropdown, trigger, list, display } = getReviewDropdownEls(item, key);
    if (!dropdown || !list) return;
    dropdown.classList.remove("is-open");
    trigger?.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    if (list._portalAnchor && list.parentElement === document.body) {
      list._portalAnchor.appendChild(list);
    }
    list.classList.remove(
      "pref-dropdown-list-portal",
      "lineup-submit-dropdown-list-portal",
      "lineup-review-dropdown-list",
      "pref-dropdown-list-opens-up",
    );
    list.style.top = "";
    list.style.left = "";
    list.style.width = "";
    list.style.maxHeight = "";
    if (reviewDropdownUi.openItem === item && reviewDropdownUi.openKey === key) {
      reviewDropdownUi.openItem = null;
      reviewDropdownUi.openKey = "";
      reviewDropdownUi.activeIndex = -1;
    }
    if (!reviewDropdownUi.openKey && reviewDropdownUi.repositionHandler) {
      global.removeEventListener("resize", reviewDropdownUi.repositionHandler);
      global.removeEventListener("scroll", reviewDropdownUi.repositionHandler, true);
      window.visualViewport?.removeEventListener("resize", reviewDropdownUi.repositionHandler);
      window.visualViewport?.removeEventListener("scroll", reviewDropdownUi.repositionHandler);
      reviewDropdownUi.repositionHandler = null;
    }
  }

  function closeAllReviewDropdowns() {
    if (reviewDropdownUi.openItem && reviewDropdownUi.openKey) {
      closeReviewDropdown(reviewDropdownUi.openItem, reviewDropdownUi.openKey);
    }
    reviewDropdownUi.openItem = null;
    reviewDropdownUi.openKey = "";
    reviewDropdownUi.activeIndex = -1;
  }

  function restoreReviewDropdownDisplay(item, key) {
    const { dropdown, list, display, hidden } = getReviewDropdownEls(item, key);
    if (!display) return;
    list?.querySelectorAll("[data-dropdown-value]").forEach((option) => {
      option.style.display = "";
    });
    const value = hidden?.value || dropdown?.dataset.value || "";
    const option = list?.querySelector(`[data-dropdown-value="${value}"]`);
    display.value = getReviewDropdownDisplayLabel(item, key, value) || getDropdownOptionLabel(option);
    syncReviewClearButton(item, key);
  }

  function openReviewDropdown(item, key) {
    closeAllSubmitDropdowns();
    if (reviewDropdownUi.openItem && reviewDropdownUi.openKey) {
      if (reviewDropdownUi.openItem !== item || reviewDropdownUi.openKey !== key) {
        closeReviewDropdown(reviewDropdownUi.openItem, reviewDropdownUi.openKey);
      }
    }
    const { dropdown, trigger, list, display } = getReviewDropdownEls(item, key);
    if (!dropdown || !trigger || !list) return;
    reviewDropdownUi.openItem = item;
    reviewDropdownUi.openKey = key;
    trigger.setAttribute("aria-expanded", "true");
    list.querySelectorAll("[data-dropdown-value]").forEach((option) => option.classList.remove("hover"));
    const visible = getReviewDropdownVisibleOptions(item, key);
    const selectedIndex = visible.findIndex((option) => option.dataset.dropdownValue === dropdown.dataset.value);
    reviewDropdownUi.activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    syncReviewDropdownHover(item, key);
    mountReviewDropdownList(item, key);
    display?.focus();
  }

  function selectReviewDropdownOption(item, key, option) {
    if (!option) return;
    const value = option.dataset.dropdownValue || "";
    const label = getReviewDropdownDisplayLabel(item, key, value) || getDropdownOptionLabel(option) || value;
    setReviewDropdownValue(item, key, value, label);
    closeReviewDropdown(item, key);
    getReviewDropdownEls(item, key).display?.blur();
    if (key === "game") syncReviewItemMapOptions(item);
  }

  function initReviewItemDropdown(item, key) {
    const { trigger, list, display, clearBtn } = getReviewDropdownEls(item, key);
    if (!trigger || !list || !display || display.dataset.reviewDropdownInit === "1") return;
    display.dataset.reviewDropdownInit = "1";

    const open = () => openReviewDropdown(item, key);
    const visible = () => getReviewDropdownVisibleOptions(item, key);

    trigger.addEventListener("mousedown", (event) => {
      if (event.target.closest(".pref-dropdown-list") || event.target.closest(".clear-btn")) return;
      event.preventDefault();
      display.focus();
    });

    display.addEventListener("focus", () => {
      if (reviewDropdownUi.suppressFocusOpen?.item === item && reviewDropdownUi.suppressFocusOpen?.key === key) {
        reviewDropdownUi.suppressFocusOpen = null;
        return;
      }
      display.dataset.lastValid = getReviewDropdownEls(item, key).dropdown?.dataset.value || "";
      display.value = "";
      list.querySelectorAll("[data-dropdown-value]").forEach((option) => {
        option.style.display = "";
        option.classList.remove("hover");
      });
      const options = visible();
      const selectedIndex = options.findIndex(
        (option) => option.dataset.dropdownValue === getReviewDropdownEls(item, key).dropdown?.dataset.value,
      );
      reviewDropdownUi.activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
      syncReviewDropdownHover(item, key);
      syncReviewClearButton(item, key);
      open();
    });

    display.addEventListener("blur", () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (active?.closest?.(".clear-btn")) {
          closeReviewDropdown(item, key);
          restoreReviewDropdownDisplay(item, key);
          return;
        }
        if (active && (list.contains(active) || trigger.contains(active))) return;
        closeReviewDropdown(item, key);
        restoreReviewDropdownDisplay(item, key);
      }, 120);
    });

    display.addEventListener("input", () => {
      const filter = display.value.trim().toLowerCase();
      list.querySelectorAll("[data-dropdown-value]").forEach((option) => {
        const label = option.querySelector("span")?.textContent?.trim().toLowerCase() || "";
        option.style.display = label.includes(filter) ? "" : "none";
      });
      const options = visible();
      if (options.length) {
        open();
        reviewDropdownUi.activeIndex = 0;
        syncReviewDropdownHover(item, key);
        positionOpenReviewDropdown();
      } else {
        closeReviewDropdown(item, key);
        reviewDropdownUi.activeIndex = -1;
      }
      syncReviewClearButton(item, key);
    });

    display.addEventListener("keydown", (event) => {
      const options = visible();
      if (!options.length) return;
      if (event.key === "ArrowDown") {
        reviewDropdownUi.activeIndex = (reviewDropdownUi.activeIndex + 1) % options.length;
        syncReviewDropdownHover(item, key);
        event.preventDefault();
      } else if (event.key === "ArrowUp") {
        reviewDropdownUi.activeIndex = (reviewDropdownUi.activeIndex - 1 + options.length) % options.length;
        syncReviewDropdownHover(item, key);
        event.preventDefault();
      } else if (event.key === "Enter" && reviewDropdownUi.activeIndex >= 0) {
        selectReviewDropdownOption(item, key, options[reviewDropdownUi.activeIndex]);
        event.preventDefault();
      } else if (event.key === "Escape") {
        closeReviewDropdown(item, key);
        restoreReviewDropdownDisplay(item, key);
        display.blur();
      }
    });

    const clearReviewDropdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      reviewDropdownUi.suppressFocusOpen = { item, key };
      setReviewDropdownValue(item, key, "", "");
      closeReviewDropdown(item, key);
      syncReviewClearButton(item, key);
      syncReviewTrailIcon(item, key, "");
      list.querySelectorAll("[data-dropdown-value]").forEach((option) => {
        option.style.display = "";
        option.classList.remove("hover");
      });
      if (document.activeElement === display) display.blur();
      window.setTimeout(() => {
        if (reviewDropdownUi.suppressFocusOpen?.item === item && reviewDropdownUi.suppressFocusOpen?.key === key) {
          reviewDropdownUi.suppressFocusOpen = null;
        }
      }, 0);
      if (key === "game") syncReviewItemMapOptions(item);
    };

    clearBtn?.addEventListener("mousedown", clearReviewDropdown);
    clearBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    list.addEventListener("mousedown", (event) => {
      const option = event.target.closest("[data-dropdown-value]");
      if (!option) return;
      event.preventDefault();
      selectReviewDropdownOption(item, key, option);
    });

    list.addEventListener("mouseover", (event) => {
      const option = event.target.closest("[data-dropdown-value]");
      if (!option) return;
      const options = visible();
      reviewDropdownUi.activeIndex = options.indexOf(option);
      syncReviewDropdownHover(item, key);
    });
  }

  function initReviewItemDropdowns(item) {
    if (!item) return;
    REVIEW_DROPDOWN_KEYS.forEach((key) => initReviewItemDropdown(item, key));
    const game = getReviewItemGame(item);
    populateReviewMapList(item, game, item.querySelector('[data-field="map"]')?.value || "");
    syncReviewSideOptionIcons(item, game);
    REVIEW_DROPDOWN_KEYS.forEach((key) => {
      const { dropdown } = getReviewDropdownEls(item, key);
      syncReviewTrailIcon(item, key, dropdown?.dataset.value || "");
    });
  }

  function openSubmitDropdown(key) {
    closeAllReviewDropdowns();
    if (submitDropdownUi.openKey && submitDropdownUi.openKey !== key) {
      closeSubmitDropdown(submitDropdownUi.openKey);
    }
    const { dropdown, trigger, list, display } = getSubmitDropdownEls(key);
    if (!dropdown || !trigger || !list) return;
    submitDropdownUi.openKey = key;
    trigger.setAttribute("aria-expanded", "true");
    list.querySelectorAll("[data-submit-value]").forEach((option) => option.classList.remove("hover"));
    const visible = getSubmitDropdownVisibleOptions(key);
    const selectedIndex = visible.findIndex((option) => option.dataset.submitValue === dropdown.dataset.value);
    submitDropdownUi.activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    syncSubmitDropdownHover(key);
    mountSubmitDropdownList(key);
    display?.focus();
  }

  function selectSubmitDropdownOption(key, option) {
    if (!option) return;
    const value = option.dataset.submitValue || "";
    const label = getSubmitDropdownDisplayLabel(key, value) || getDropdownOptionLabel(option) || value;
    setSubmitDropdownValue(key, value, label);
    if (key === "game") {
      populateSubmitMaps(value);
      syncSubmitGameFields(value);
      setSubmitDropdownValue("map", "", "");
      setSubmitDropdownValue("side", "", "");
    }
    closeSubmitDropdown(key);
    getSubmitDropdownEls(key).display?.blur();
    if (value) focusNextSubmitStep();
  }

  function resetSubmitFormDropdowns(game = "") {
    populateSubmitGames();
    if (game) {
      setSubmitDropdownValue("game", game, getGameDisplayLabel(game));
      populateSubmitMaps(game);
      syncSubmitGameFields(game);
    } else {
      setSubmitDropdownValue("game", "", "");
      populateSubmitMaps("");
      syncSubmitGameFields("");
    }
    setSubmitDropdownValue("side", "", "");
    setSubmitDropdownValue("difficulty", "", "");
    ["game", "map", "side", "difficulty"].forEach((dropdownKey) => syncSubmitTrailIcon(dropdownKey, ""));
    closeAllSubmitDropdowns();
  }

  function initSubmitFormDropdown(key) {
    const { trigger, list, display, clearBtn } = getSubmitDropdownEls(key);
    if (!trigger || !list || !display || display.dataset.submitDropdownInit === "1") return;
    display.dataset.submitDropdownInit = "1";

    const open = () => openSubmitDropdown(key);
    const visible = () => getSubmitDropdownVisibleOptions(key);

    trigger.addEventListener("mousedown", (event) => {
      if (event.target.closest(".pref-dropdown-list") || event.target.closest(".clear-btn")) return;
      event.preventDefault();
      display.focus();
    });

    display.addEventListener("focus", () => {
      if (submitDropdownUi.suppressFocusOpenKey === key) {
        submitDropdownUi.suppressFocusOpenKey = "";
        return;
      }
      display.dataset.lastValid = getSubmitDropdownEls(key).dropdown?.dataset.value || "";
      display.value = "";
      list.querySelectorAll("[data-submit-value]").forEach((option) => {
        option.style.display = "";
        option.classList.remove("hover");
      });
      const options = visible();
      const selectedIndex = options.findIndex(
        (option) => option.dataset.submitValue === getSubmitDropdownEls(key).dropdown?.dataset.value,
      );
      submitDropdownUi.activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
      syncSubmitDropdownHover(key);
      syncSubmitClearButton(key);
      open();
    });

    display.addEventListener("blur", () => {
      setTimeout(() => {
        const active = document.activeElement;
        if (active?.closest?.(".clear-btn")) {
          closeSubmitDropdown(key);
          restoreSubmitDropdownDisplay(key);
          return;
        }
        if (active && (list.contains(active) || trigger.contains(active))) return;
        closeSubmitDropdown(key);
        restoreSubmitDropdownDisplay(key);
      }, 120);
    });

    display.addEventListener("input", () => {
      const filter = display.value.trim().toLowerCase();
      list.querySelectorAll("[data-submit-value]").forEach((option) => {
        const label = option.querySelector("span")?.textContent?.trim().toLowerCase() || "";
        option.style.display = label.includes(filter) ? "" : "none";
      });
      const options = visible();
      if (options.length) {
        open();
        submitDropdownUi.activeIndex = 0;
        syncSubmitDropdownHover(key);
        positionOpenSubmitDropdown();
      } else {
        closeSubmitDropdown(key);
        submitDropdownUi.activeIndex = -1;
      }
      syncSubmitClearButton(key);
    });

    display.addEventListener("keydown", (event) => {
      const options = visible();
      if (!options.length) return;
      if (event.key === "ArrowDown") {
        submitDropdownUi.activeIndex = (submitDropdownUi.activeIndex + 1) % options.length;
        syncSubmitDropdownHover(key);
        event.preventDefault();
      } else if (event.key === "ArrowUp") {
        submitDropdownUi.activeIndex = (submitDropdownUi.activeIndex - 1 + options.length) % options.length;
        syncSubmitDropdownHover(key);
        event.preventDefault();
      } else if (event.key === "Enter" && submitDropdownUi.activeIndex >= 0) {
        selectSubmitDropdownOption(key, options[submitDropdownUi.activeIndex]);
        event.preventDefault();
      } else if (event.key === "Escape") {
        closeSubmitDropdown(key);
        restoreSubmitDropdownDisplay(key);
        display.blur();
      }
    });

    const clearSubmitDropdown = (event) => {
      event.preventDefault();
      event.stopPropagation();
      submitDropdownUi.suppressFocusOpenKey = key;
      setSubmitDropdownValue(key, "", "");
      closeSubmitDropdown(key);
      syncSubmitClearButton(key);
      syncSubmitTrailIcon(key, "");
      list.querySelectorAll("[data-submit-value]").forEach((option) => {
        option.style.display = "";
        option.classList.remove("hover");
      });
      if (document.activeElement === display) {
        display.blur();
      }
      window.setTimeout(() => {
        if (submitDropdownUi.suppressFocusOpenKey === key) {
          submitDropdownUi.suppressFocusOpenKey = "";
        }
      }, 0);
    };

    clearBtn?.addEventListener("mousedown", clearSubmitDropdown);
    clearBtn?.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    list.addEventListener("mousedown", (event) => {
      const option = event.target.closest("[data-submit-value]");
      if (!option) return;
      event.preventDefault();
      selectSubmitDropdownOption(key, option);
    });

    list.addEventListener("mouseover", (event) => {
      const option = event.target.closest("[data-submit-value]");
      if (!option) return;
      const options = visible();
      submitDropdownUi.activeIndex = options.indexOf(option);
      syncSubmitDropdownHover(key);
    });
  }

  function initSubmitFormDropdowns() {
    populateSubmitGames();
    SUBMIT_FORM_DROPDOWN_KEYS.forEach((key) => initSubmitFormDropdown(key));
    syncSubmitSideOptionIcons(getSubmitFormGame() || getActiveGame());
    SUBMIT_FORM_DROPDOWN_KEYS.forEach((key) => {
      const { dropdown } = getSubmitDropdownEls(key);
      syncSubmitTrailIcon(key, dropdown?.dataset.value || "");
    });
  }

  function syncSubmitSideOptionIcons(game) {
    const list = document.getElementById("lineup-submit-side-list");
    if (!list) return;
    list.querySelectorAll("[data-submit-value]").forEach((option) => {
      const side = option.dataset.submitValue || "";
      const label = getSubmitSideLabel(game, side);
      let text = option.querySelector(".lineup-submit-side-option-text");
      if (!label) {
        text?.remove();
        return;
      }
      if (!text) {
        text = document.createElement("span");
        text.className = "lineup-submit-side-option-text";
        text.setAttribute("aria-hidden", "true");
        option.insertBefore(text, option.firstChild);
      }
      text.textContent = label;
    });
  }

  function getSubmitFormStepOrder() {
    const game = getSubmitFormGame();
    const steps = ["username", "game", "title", "map", "side", "difficulty"];
    if (game === "valorant") steps.push("agent", "ability");
    else if (game === "cs2") steps.push("utility");
    steps.push("video");
    return steps;
  }

  function isSubmitStepComplete(step) {
    switch (step) {
      case "username":
        return isSubmitUsernameValid(document.getElementById("lineup-submit-username")?.value);
      case "game":
        return Boolean(getSubmitFormGame());
      case "title":
        return Boolean(document.getElementById("lineup-submit-title")?.value?.trim());
      case "map":
        return Boolean(document.getElementById("lineup-submit-map")?.value?.trim());
      case "side":
        return Boolean(document.getElementById("lineup-submit-side")?.value?.trim());
      case "difficulty":
        return Boolean(document.getElementById("lineup-submit-difficulty")?.value?.trim());
      case "agent":
        return Boolean(document.getElementById("lineup-submit-agent")?.value?.trim());
      case "ability":
        return Boolean(document.getElementById("lineup-submit-ability")?.value?.trim());
      case "utility":
        return Boolean(document.getElementById("lineup-submit-utility")?.value?.trim());
      case "video":
        return Boolean(document.getElementById("lineup-submit-video")?.files?.[0]);
      default:
        return false;
    }
  }

  function setSubmitStepVisible(el, visible) {
    if (!el) return;
    el.classList.toggle("lineup-form-step-hidden", !visible);
    el.hidden = !visible;
  }

  function syncSubmitFormSteps() {
    const form = document.getElementById("lineup-submit-form");
    if (!form) return;

    const steps = getSubmitFormStepOrder();
    let lastCompleteIndex = -1;
    for (let i = 0; i < steps.length; i += 1) {
      if (isSubmitStepComplete(steps[i])) lastCompleteIndex = i;
      else break;
    }

    const allComplete = steps.length > 0 && steps.every((step) => isSubmitStepComplete(step));

    form.querySelectorAll("[data-submit-step]").forEach((el) => {
      const step = el.dataset.submitStep || "";
      if (step === "actions") {
        setSubmitStepVisible(el, allComplete);
        return;
      }
      const stepIndex = steps.indexOf(step);
      if (stepIndex === -1) {
        setSubmitStepVisible(el, false);
        return;
      }
      setSubmitStepVisible(el, stepIndex <= lastCompleteIndex + 1);
    });
  }

  function focusNextSubmitStep() {
    const form = document.getElementById("lineup-submit-form");
    if (!form || submitOverlay?.hidden) return;

    const steps = getSubmitFormStepOrder();
    const nextStep = steps.find((step) => !isSubmitStepComplete(step));
    if (!nextStep) return;

    const field = form.querySelector(`[data-submit-step="${nextStep}"]`);
    if (!field || field.hidden) return;

    const focusable = field.querySelector(
      'input:not([type="hidden"]):not([type="file"]), select, textarea, .game-search',
    );
    focusable?.focus({ preventScroll: true });
  }

  function initSubmitFormStepListeners() {
    const form = document.getElementById("lineup-submit-form");
    if (!form || form.dataset.submitStepsInit === "1") return;
    form.dataset.submitStepsInit = "1";

    const onTextInput = () => syncSubmitFormSteps();

    document.getElementById("lineup-submit-username")?.addEventListener("input", () => {
      syncSubmitUsernameFieldState();
      syncSubmitFormSteps();
    });
    document.getElementById("lineup-submit-title")?.addEventListener("input", onTextInput);
    document.getElementById("lineup-submit-agent")?.addEventListener("input", onTextInput);
    document.getElementById("lineup-submit-ability")?.addEventListener("input", onTextInput);

    document.getElementById("lineup-submit-utility")?.addEventListener("change", () => {
      syncSubmitFormSteps();
      if (isSubmitStepComplete("utility")) focusNextSubmitStep();
    });

    const videoInput = document.getElementById("lineup-submit-video");
    videoInput?.addEventListener("change", () => {
      syncLineupFormFileText(videoInput);
      syncSubmitFormSteps();
    });
  }

  function syncSubmitGameFields(game) {
    syncSubmitSideOptionIcons(game);
    ["map", "side", "difficulty"].forEach((key) => {
      const { dropdown } = getSubmitDropdownEls(key);
      syncSubmitTrailIcon(key, dropdown?.dataset.value || "");
    });
  }

  function openSubmitModal() {
    if (!isLocalLineupPreview()) {
      global.MorningRoastChat?.ensureChatJoined?.();
      if (!global.MorningRoastChat?.isChatConnected?.()) {
        showToast("Connect to community chat before submitting a lineup.");
        return;
      }
    }

    const status = document.getElementById("lineup-submit-status");
    if (status) status.textContent = "";
    document.getElementById("lineup-submit-form")?.reset();
    resetSubmitFormDropdowns("");
    syncLineupFormFileText(document.getElementById("lineup-submit-video"));
    const identity = readIdentity();
    const usernameInput = document.getElementById("lineup-submit-username");
    if (usernameInput) usernameInput.value = identity.name || "";
    syncSubmitUsernameFieldState();
    syncSubmitFormSteps();

    openOverlay(submitOverlay);
    focusNextSubmitStep();
  }

  function closeSubmitModal() {
    closeAllSubmitDropdowns();
    closeOverlay(submitOverlay);
  }

  function openReviewModal() {
    if (!isOwner()) return;
    if (isLocalLineupPreview()) seedLocalReviewPreview();
    else requestPendingList();
    openOverlay(reviewOverlay);
    renderReviewList();
  }

  function closeReviewModal() {
    closeAllReviewDropdowns();
    document.querySelectorAll("#lineup-review-list video").forEach((video) => {
      try {
        video.pause();
      } catch {
        // ignore
      }
    });
    closeOverlay(reviewOverlay);
  }

  async function handleReviewListClick(event) {
    const item = event.target.closest(".lineup-review-item");
    const saveBtn = event.target.closest(".lineup-review-save");
    const approve = event.target.closest(".lineup-review-approve");
    const reject = event.target.closest(".lineup-review-reject");
    const deleteBtn = event.target.closest(".lineup-review-delete");
    const id =
      saveBtn?.dataset.submissionId ||
      approve?.dataset.submissionId ||
      reject?.dataset.submissionId ||
      deleteBtn?.dataset.submissionId ||
      "";
    if (!id || !item) return;

    if (deleteBtn) {
      if (isLocalLineupPreview()) {
        removeSubmissionEntry(id);
        setPendingList(state.pending, state.pendingCount, state.approved);
        showToast("Preview mode — lineup removed locally.");
        return;
      }
      if (!window.confirm("Delete this community lineup? The video will be removed permanently.")) return;
      deleteSubmission(id);
      return;
    }

    const metadata = readReviewItemFields(item);
    if (!metadata.submitterName) {
      showToast("Username is required.", "error");
      return;
    }
    if (!metadata.game) {
      showToast("Game is required.", "error");
      return;
    }
    if (!metadata.side) {
      showToast("Side is required.", "error");
      return;
    }
    if (!metadata.title) {
      showToast("Title is required.", "error");
      return;
    }
    if (!metadata.map) {
      showToast("Map is required.", "error");
      return;
    }

    if (saveBtn) {
      await saveReviewItem(item, id, metadata);
      return;
    }
    if (approve) {
      await saveReviewItem(item, id, metadata, { approve: true });
      return;
    }
    if (reject) {
      if (isLocalLineupPreview()) {
        showToast("Preview mode — styling only.");
        return;
      }
      reviewSubmission(id, "reject", metadata);
      return;
    }
  }

  async function handleSubmitForm(event) {
    event.preventDefault();
    if (state.submitting) return;

    const form = event.currentTarget;
    const status = document.getElementById("lineup-submit-status");
    const submitBtn = document.getElementById("lineup-submit-send");
    const videoInput = document.getElementById("lineup-submit-video");

    const game = getSubmitFormGame();
    if (!game) {
      if (status) status.textContent = "Select a game.";
      showToast("Select a game before submitting.");
      return;
    }

    const file = videoInput?.files?.[0];
    if (!file) {
      if (status) status.textContent = "Attach a lineup video.";
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      if (status) status.textContent = "Video must be 50 MB or smaller.";
      return;
    }

    if (isLocalLineupPreview()) {
      if (status) status.textContent = "Preview mode: submissions are disabled while viewing locally.";
      showToast("Preview mode — styling only.");
      return;
    }

    global.MorningRoastChat?.ensureChatJoined?.();
    const identity = readIdentity();
    const submitterName = form.querySelector('[name="submitterName"]')?.value?.trim() || identity.name;
    if (!submitterName) {
      if (status) status.textContent = "Enter a username.";
      showToast("Enter a username before submitting.");
      return;
    }
    if (isReservedSubmitUsername(submitterName)) {
      syncSubmitUsernameFieldState();
      syncSubmitFormSteps();
      if (status) status.textContent = "That username is reserved. Choose a different display name.";
      showToast("That username is reserved.", "error");
      document.getElementById("lineup-submit-username")?.focus();
      return;
    }
    if (!identity.userId) {
      showToast("Join community chat before submitting.");
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
    formData.set("submitterName", submitterName);
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

    document.getElementById("lineup-submit-lineup-owner-btn")?.addEventListener("click", openSubmitModal);
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

    document.getElementById("lineup-review-list")?.addEventListener("click", handleReviewListClick);

    global.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (submitDropdownUi.openKey) {
        closeAllSubmitDropdowns();
        return;
      }
      if (submitOverlay && !submitOverlay.hidden) closeSubmitModal();
      if (reviewOverlay && !reviewOverlay.hidden) closeReviewModal();
    });

    initSubmitFormDropdowns();
    initSubmitFormStepListeners();
    initLineupFormFileInputs(submitOverlay);
    initLineupFormFileInputs(reviewOverlay);

    document.addEventListener("mousedown", (event) => {
      if (!submitDropdownUi.openKey) return;
      const key = submitDropdownUi.openKey;
      const { dropdown, list } = getSubmitDropdownEls(key);
      if (dropdown?.contains(event.target) || list?.contains(event.target)) return;
      closeSubmitDropdown(key);
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
        if (isOwner()) setPendingList(message.pending, message.pendingCount, message.approved);
        break;
      case "lineup_submission_reviewed":
        if (isOwner()) {
          state.pending = state.pending.filter((entry) => entry.id !== message.submission?.id);
          if (message.action === "approve" && message.submission) {
            upsertSubmissionEntry({ ...message.submission, status: "approved" });
          }
          setPendingList(state.pending, message.pendingCount ?? state.pending.length, state.approved);
        }
        dispatch("reviewed", { action: message.action, submission: message.submission });
        void refreshAllCommunityLineups();
        if (message.action === "approve") showToast("Community lineup approved.");
        if (message.action === "reject" && isOwner()) showToast("Lineup rejected.");
        break;
      case "lineup_submission_updated":
        if (message.submission) {
          upsertSubmissionEntry(message.submission);
          if (isOwner()) {
            setPendingList(state.pending, state.pendingCount, state.approved);
            const item = document.querySelector(`.lineup-review-item[data-submission-id="${message.submission.id}"]`);
            if (item) refreshReviewItemVideoPreview(item, message.submission);
          }
          void refreshAllCommunityLineups();
        }
        break;
      case "lineup_submission_deleted":
        if (message.submission?.id) {
          removeSubmissionEntry(message.submission.id);
          if (isOwner()) {
            setPendingList(state.pending, message.pendingCount ?? state.pendingCount, state.approved);
          }
        }
        void refreshAllCommunityLineups();
        if (isOwner()) showToast("Community lineup deleted.");
        break;
      default:
        break;
    }
  }

  function init() {
    bindUi();
    void refreshAllCommunityLineups();
    if (isLocalLineupPreview()) seedLocalReviewPreview();
    else if (isOwner()) requestPendingList();
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
