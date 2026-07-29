/** User-submitted lineups — submit, owner review, community grid rendering. */
(function (global) {
  const SUBMISSIONS_EVENT = "morning-roast:lineup-submissions";
  const GAMES = ["valorant", "cs2"];
  const MAX_LINEUP_VIDEO_BYTES = 100 * 1024 * 1024;

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
  let communityEditOverlay = null;
  let ownerPendingReviewAlertShown = false;
  let queuedOwnerPendingAlert = null;

  function isAppLoadFinished() {
    return Boolean(global.__morningRoastAppLoaded) || !document.getElementById("app-loading-screen");
  }

  function flushQueuedOwnerPendingAlert() {
    if (!queuedOwnerPendingAlert) return;
    const { count } = queuedOwnerPendingAlert;
    queuedOwnerPendingAlert = null;
    notifyOwnerPendingReviews(count, { initial: true });
  }

  function onAppLoaded() {
    global.__morningRoastAppLoaded = true;
    flushQueuedOwnerPendingAlert();
  }

  function notifyOwnerPendingReviews(count, { initial = false, force = false } = {}) {
    if (!isOwner()) return;
    const pendingCount = Number(count) || 0;
    if (pendingCount <= 0) return;

    if (initial && !isAppLoadFinished()) {
      queuedOwnerPendingAlert = { count: pendingCount };
      return;
    }

    if (initial && ownerPendingReviewAlertShown && !force) return;
    if (initial) ownerPendingReviewAlertShown = true;

    const message =
      pendingCount === 1 ? "1 lineup is waiting for your review." : `${pendingCount} lineups are waiting for your review.`;
    showToast(message);
    global.MorningRoastChat?.playChatPingSound?.();
  }

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
    updateOwnerBanner();
    notifyOwnerPendingReviews(state.pendingCount, { initial: true });
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

  function confirmLineupDelete(message, action) {
    if (typeof global.confirmBeforeReset === "function") {
      global.confirmBeforeReset(message, action, {
        title: "Delete lineup?",
        okLabel: "Delete",
        force: true,
      });
      return;
    }
    if (global.confirm(message)) action();
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
    if (lineup.agent) {
      article.dataset.lineupAgent =
        typeof global.normalizeLineupValorantAgentSlug === "function"
          ? global.normalizeLineupValorantAgentSlug(lineup.agent)
          : String(lineup.agent).trim().toLowerCase();
    }
    if (lineup.ability) {
      article.dataset.lineupAbility =
        typeof global.normalizeLineupValorantAbilitySlug === "function"
          ? global.normalizeLineupValorantAbilitySlug(lineup.ability)
          : String(lineup.ability).trim().toLowerCase();
    }
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
    if (typeof global.applyLineupVideoCardBadges === "function") global.applyLineupVideoCardBadges(article);
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
    if (typeof global.applyLineupVideoCardBadges === "function") global.applyLineupVideoCardBadges(article);
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

  const communityManageState = {
    mode: "",
    game: "",
    selectedIds: new Set(),
    bulkDeletePending: 0,
  };

  function isCommunityDeleteMode(game) {
    return communityManageState.mode === "delete" && communityManageState.game === game;
  }

  function isCommunityEditMode(game) {
    return communityManageState.mode === "edit" && communityManageState.game === game;
  }

  function isCommunityManageMode(game) {
    return isCommunityDeleteMode(game) || isCommunityEditMode(game);
  }

  function getCommunityManageActions(game) {
    return getCommunitySection(game)?.querySelector(`[data-community-manage-root="${game}"]`);
  }

  function findCommunityLineupEntry(id, game) {
    if (!id) return null;
    const fromCommunity = state.communityByGame[game]?.find((entry) => entry.id === id);
    if (fromCommunity) return fromCommunity;
    return state.approved.find((entry) => entry.id === id) || null;
  }

  function syncCommunityManageSelectionUi(game) {
    const section = getCommunitySection(game);
    const grid = getCommunityGrid(game);
    const actions = getCommunityManageActions(game);
    if (!section || !grid || !actions) return;

    const deleteActive = isCommunityDeleteMode(game);
    const editActive = isCommunityEditMode(game);
    const manageActive = deleteActive || editActive;

    section.classList.toggle("lineup-community-section--delete-mode", deleteActive);
    section.classList.toggle("lineup-community-section--edit-mode", editActive);

    const editToggle = actions.querySelector(".lineup-community-edit-toggle");
    const deleteToggle = actions.querySelector(".lineup-community-delete-toggle");
    const editBar = actions.querySelector(".lineup-community-edit-bar");
    const deleteBar = actions.querySelector(".lineup-community-delete-bar");
    const countEl = actions.querySelector(".lineup-community-delete-count");
    const confirmBtn = actions.querySelector(".lineup-community-delete-confirm");
    const selectedCount = communityManageState.selectedIds.size;

    editToggle?.classList.toggle("hidden", manageActive);
    if (editToggle) editToggle.hidden = manageActive;
    deleteToggle?.classList.toggle("hidden", manageActive);
    if (deleteToggle) deleteToggle.hidden = manageActive;
    editBar?.classList.toggle("hidden", !editActive);
    if (editBar) editBar.hidden = !editActive;
    deleteBar?.classList.toggle("hidden", !deleteActive);
    if (deleteBar) deleteBar.hidden = !deleteActive;

    if (countEl) {
      countEl.textContent =
        selectedCount === 0
          ? "Select lineups to delete"
          : selectedCount === 1
            ? "1 lineup selected"
            : `${selectedCount} lineups selected`;
    }
    if (confirmBtn) confirmBtn.disabled = selectedCount === 0;

    grid.querySelectorAll(".lineup-video-card").forEach((card) => {
      const id = card.dataset.lineupSubmissionId || "";
      const selectable = manageActive && Boolean(id);
      card.classList.toggle("lineup-video-card--delete-selectable", deleteActive && Boolean(id));
      card.classList.toggle("lineup-video-card--edit-selectable", editActive && Boolean(id));

      let marker = card.querySelector(".lineup-community-delete-marker");
      if (!deleteActive || !id) {
        marker?.remove();
        card.classList.remove("lineup-video-card--delete-selected");
      } else {
        if (!marker) {
          marker = document.createElement("span");
          marker.className = "lineup-community-delete-marker";
          marker.setAttribute("aria-hidden", "true");
          card.querySelector(".lineup-video-embed")?.appendChild(marker);
        }
        const selected = communityManageState.selectedIds.has(id);
        card.classList.toggle("lineup-video-card--delete-selected", selected);
      }

      if (editActive && id) {
        card.setAttribute("role", "button");
        card.setAttribute("aria-label", `Edit ${getLineupCardTitle(card)}`);
        card.tabIndex = 0;
      } else if (deleteActive && id) {
        card.setAttribute("role", "button");
        card.setAttribute("aria-pressed", communityManageState.selectedIds.has(id) ? "true" : "false");
        card.tabIndex = 0;
      } else {
        card.removeAttribute("role");
        card.removeAttribute("aria-pressed");
        card.removeAttribute("aria-label");
        card.removeAttribute("tabindex");
      }
    });
  }

  function getLineupCardTitle(card) {
    return card?.querySelector(".lineup-video-title")?.textContent?.trim() || "lineup";
  }

  function setCommunityManageMode(game, mode) {
    const nextMode = mode === "delete" || mode === "edit" ? mode : "";
    if (nextMode) {
      GAMES.forEach((otherGame) => {
        if (otherGame !== game && communityManageState.game === otherGame) {
          communityManageState.mode = "";
          communityManageState.selectedIds.clear();
          syncCommunityManageSelectionUi(otherGame);
        }
      });
      communityManageState.game = game;
      communityManageState.mode = nextMode;
      if (nextMode === "edit") communityManageState.selectedIds.clear();
    } else if (communityManageState.game === game) {
      communityManageState.mode = "";
      communityManageState.game = "";
      communityManageState.selectedIds.clear();
    }
    syncCommunityManageSelectionUi(game);
  }

  function toggleCommunityCardSelection(card) {
    const id = card?.dataset?.lineupSubmissionId || "";
    if (!id || !isCommunityDeleteMode(communityManageState.game)) return;
    if (communityManageState.selectedIds.has(id)) communityManageState.selectedIds.delete(id);
    else communityManageState.selectedIds.add(id);
    syncCommunityManageSelectionUi(communityManageState.game);
  }

  function handleCommunityGridClick(event, game) {
    if (
      event.target.closest(
        ".lineup-video-agent-badge, .lineup-video-ability-badge, .lineup-video-utility-badge[data-lineup-cs2-utility], .lineup-video-utility-badge[data-lineup-valorant-utility]",
      )
    ) {
      return;
    }

    const grid = getCommunityGrid(game);
    const card = event.target.closest(".lineup-video-card");
    if (!card || !grid?.contains(card) || !card.dataset.lineupSubmissionId) return;

    if (isCommunityEditMode(game)) {
      event.preventDefault();
      event.stopPropagation();
      const entry = findCommunityLineupEntry(card.dataset.lineupSubmissionId, game);
      if (entry) openCommunityEditModal(entry, game);
      return;
    }

    if (!isCommunityDeleteMode(game)) return;
    event.preventDefault();
    event.stopPropagation();
    toggleCommunityCardSelection(card);
  }

  function handleCommunityGridKeydown(event, game) {
    if (!isCommunityManageMode(game) || (event.key !== "Enter" && event.key !== " ")) return;
    handleCommunityGridClick(event, game);
  }

  async function executeCommunityDelete(game, ids) {
    if (!ids.length) return;

    if (isLocalLineupPreview()) {
      ids.forEach((id) => removeSubmissionEntry(id));
      setCommunityManageMode(game, "");
      await refreshAllCommunityLineups();
      updateOwnerCommunityManageUi();
      showToast(ids.length === 1 ? "Preview mode — lineup removed locally." : "Preview mode — lineups removed locally.");
      return;
    }

    ids.forEach((id) => deleteSubmission(id));
    communityManageState.bulkDeletePending = ids.length;
    setCommunityManageMode(game, "");
    showToast(ids.length === 1 ? "Deleting community lineup…" : `Deleting ${ids.length} community lineups…`);
  }

  function confirmCommunityDelete(game) {
    const ids = [...communityManageState.selectedIds];
    if (!ids.length || !isCommunityDeleteMode(game)) return;

    const message =
      ids.length === 1
        ? "This community lineup and its video will be removed permanently."
        : `These ${ids.length} community lineups and their videos will be removed permanently.`;

    confirmLineupDelete(message, () => {
      void executeCommunityDelete(game, ids);
    });
  }

  function syncReviewItemGameFields(item) {
    if (!item) return;
    const game = getReviewItemGame(item);
    const isValorant = game === "valorant";
    const isCs2 = game === "cs2";
    ["agent", "ability", "utility"].forEach((field) => {
      const el = item.querySelector(`[data-review-field="${field}"]`);
      if (!el) return;
      const show = field === "utility" ? isCs2 : isValorant;
      el.classList.toggle("hidden", !show);
      el.hidden = !show;
    });
    if (isValorant) {
      populateReviewAgentList(item);
      const agent = item.querySelector('[data-field="agent"]')?.value || "";
      const ability = item.querySelector('[data-field="ability"]')?.value || "";
      void populateReviewAbilityList(item, agent, ability);
    } else {
      setReviewDropdownValue(item, "agent", "", "");
      setReviewDropdownValue(item, "ability", "", "");
      syncReviewTrailIcon(item, "agent", "");
      syncReviewTrailIcon(item, "ability", "");
    }
  }

  function buildReviewDifficultyListHtml() {
    return [1, 2, 3, 4, 5]
      .map((stars) => {
        const label = `${stars} star${stars === 1 ? "" : "s"}`;
        return `<button type="button" class="pref-dropdown-option" data-dropdown-value="${stars}" role="option"><span>${label}</span></button>`;
      })
      .join("");
  }

  function openCommunityEditModal(entry, game) {
    if (!entry?.id || !communityEditOverlay) return;
    setCommunityManageMode(game, "");

    const host = document.getElementById("lineup-community-edit-host");
    const status = document.getElementById("lineup-community-edit-status");
    if (!host) return;
    if (status) status.textContent = "";

    host.innerHTML = "";
    const item = document.createElement("article");
    item.className = "lineup-review-item setting-block";
    item.dataset.submissionId = entry.id;
    item.dataset.reviewMode = "published";

    const previewUrl = resolveSubmissionVideoUrl(entry, { mode: "published" });
    item.innerHTML = `
      <div class="lineup-review-item-main">
        ${renderEditableFields(entry)}
        ${previewUrl ? `<video class="lineup-review-item-video" src="${escapeHtml(previewUrl)}" controls playsinline preload="metadata"></video>` : ""}
      </div>`;
    host.appendChild(item);

    populateReviewMapList(item, entry.game || game, entry.map || "");
    initReviewItemDropdowns(item);
    syncReviewItemGameFields(item);
    initLineupFormFileInputs(item);
    closeAllReviewDropdowns();

    openOverlay(communityEditOverlay);
  }

  function closeCommunityEditModal() {
    document.querySelector("#lineup-community-edit-host video")?.pause?.();
    closeAllReviewDropdowns();
    closeOverlay(communityEditOverlay);
  }

  async function saveCommunityEditModal() {
    const item = document.querySelector("#lineup-community-edit-host .lineup-review-item");
    const id = item?.dataset.submissionId || "";
    if (!id || !item) return;

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
    if (!metadata.difficulty) {
      showToast("Difficulty is required.", "error");
      return;
    }

    if (isLocalLineupPreview()) {
      const entry =
        state.approved.find((row) => row.id === id) ||
        state.pending.find((row) => row.id === id) ||
        GAMES.flatMap((game) => state.communityByGame[game] || []).find((row) => row.id === id);
      if (entry) {
        entry.title = metadata.title;
        entry.map = metadata.map;
        entry.game = metadata.game;
        entry.side = metadata.side;
        entry.difficulty = metadata.difficulty;
        entry.submittedBy = entry.submittedBy && typeof entry.submittedBy === "object" ? entry.submittedBy : {};
        entry.submittedBy.name = metadata.submitterName;
        if (metadata.game === "valorant") {
          entry.agent = metadata.agent || "";
          entry.ability = metadata.ability || "";
          delete entry.utility;
        } else if (metadata.game === "cs2") {
          entry.utility = metadata.utility || "";
          delete entry.agent;
          delete entry.ability;
        }
        upsertSubmissionEntry({ ...entry, status: entry.status || "approved" });
        await refreshAllCommunityLineups();
        updateOwnerCommunityManageUi();
        closeCommunityEditModal();
        showToast("Preview mode — lineup updated locally.");
      }
      return;
    }

    const saved = await saveReviewItem(item, id, metadata);
    if (saved) closeCommunityEditModal();
  }

  function ensureCommunityManageControls(game) {
    const section = getCommunitySection(game);
    const head = section?.querySelector(".lineup-community-section-head");
    const grid = getCommunityGrid(game);
    if (!head || !grid || head.dataset.communityManageInit === "1") return;
    head.dataset.communityManageInit = "1";

    const main = document.createElement("div");
    main.className = "lineup-community-section-head-main";
    while (head.firstChild) main.appendChild(head.firstChild);
    head.appendChild(main);
    head.classList.add("lineup-community-section-head--with-actions");

    const actions = document.createElement("div");
    actions.className = "lineup-community-section-actions hidden";
    actions.dataset.communityManageRoot = game;
    actions.hidden = true;
    actions.innerHTML = `
      <button type="button" class="lineup-community-edit-toggle">Edit</button>
      <button type="button" class="lineup-community-delete-toggle">Delete</button>
      <div class="lineup-community-edit-bar hidden" hidden>
        <span class="lineup-community-edit-hint">Select a lineup to edit</span>
        <button type="button" class="lineup-community-edit-cancel">Cancel</button>
      </div>
      <div class="lineup-community-delete-bar hidden" hidden>
        <span class="lineup-community-delete-count">Select lineups to delete</span>
        <button type="button" class="lineup-community-delete-confirm" disabled>Delete selected</button>
        <button type="button" class="lineup-community-delete-cancel">Cancel</button>
      </div>`;
    head.appendChild(actions);

    actions.querySelector(".lineup-community-edit-toggle")?.addEventListener("click", () => {
      setCommunityManageMode(game, "edit");
    });
    actions.querySelector(".lineup-community-edit-cancel")?.addEventListener("click", () => {
      setCommunityManageMode(game, "");
    });
    actions.querySelector(".lineup-community-delete-toggle")?.addEventListener("click", () => {
      setCommunityManageMode(game, "delete");
    });
    actions.querySelector(".lineup-community-delete-cancel")?.addEventListener("click", () => {
      setCommunityManageMode(game, "");
    });
    actions.querySelector(".lineup-community-delete-confirm")?.addEventListener("click", () => {
      confirmCommunityDelete(game);
    });

    grid.addEventListener("click", (event) => handleCommunityGridClick(event, game), true);
    grid.addEventListener("keydown", (event) => handleCommunityGridKeydown(event, game), true);
  }

  function initCommunityManageControls() {
    GAMES.forEach((game) => ensureCommunityManageControls(game));
  }

  function updateOwnerCommunityManageUi() {
    const showOwnerTools = isOwner();
    GAMES.forEach((game) => {
      ensureCommunityManageControls(game);
      const section = getCommunitySection(game);
      const actions = getCommunityManageActions(game);
      if (!section || !actions) return;

      if (!showOwnerTools) {
        setCommunityManageMode(game, "");
        actions.hidden = true;
        actions.classList.add("hidden");
        return;
      }

      const hasCards = Boolean(getCommunityGrid(game)?.querySelector(".lineup-video-card"));
      const visible = hasCards && !section.hidden;
      actions.hidden = !visible;
      actions.classList.toggle("hidden", !visible);
      if (!visible) setCommunityManageMode(game, "");
      else if (isCommunityManageMode(game)) syncCommunityManageSelectionUi(game);
    });
  }

  const communityDeleteState = communityManageState;
  const updateOwnerCommunityDeleteUi = updateOwnerCommunityManageUi;
  const initCommunityDeleteControls = initCommunityManageControls;

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
    updateOwnerCommunityManageUi();
    if (isCommunityManageMode(game)) syncCommunityManageSelectionUi(game);
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

    if (banner && text) {
      const show = showOwnerTools && (state.pendingCount > 0 || isLocalLineupPreview());
      banner.hidden = !show;
      banner.classList.toggle("hidden", !show);
      if (isLocalLineupPreview() && state.pendingCount === 0) {
        text.textContent = "Review lineups (local preview)";
      } else {
        text.textContent =
          state.pendingCount === 1
            ? "1 lineup waiting for your review"
            : `${state.pendingCount} lineups waiting for your review`;
      }
    }

    updateOwnerCommunityManageUi();
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
    reviewField = "",
    hidden = false,
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
          : trailKind === "difficulty"
            ? `<span class="lineup-submit-trail-icon" data-review-trail="difficulty" aria-hidden="true">
                <i class="ri-star-fill lineup-submit-trail-fallback" aria-hidden="true"></i>
              </span>`
            : trailKind === "agent"
              ? `<span class="lineup-submit-trail-icon" data-review-trail="agent" aria-hidden="true">
                  <i class="ri-user-star-line lineup-submit-trail-fallback" aria-hidden="true"></i>
                  <img class="lineup-submit-trail-image game-option-icon" alt="" width="18" height="18" decoding="async" hidden />
                </span>`
              : trailKind === "ability"
                ? `<span class="lineup-submit-trail-icon" data-review-trail="ability" aria-hidden="true">
                    <i class="ri-flashlight-line lineup-submit-trail-fallback" aria-hidden="true"></i>
                    <img class="lineup-submit-trail-image game-option-icon" alt="" width="18" height="18" decoding="async" hidden />
                  </span>`
                : `<span class="lineup-submit-trail-icon" data-review-trail="game" aria-hidden="true">
              <i class="ri-gamepad-line lineup-submit-trail-fallback" aria-hidden="true"></i>
              <img class="lineup-submit-trail-image game-option-icon" alt="" width="18" height="18" decoding="async" hidden />
            </span>`;
    const reviewFieldAttr = reviewField ? ` data-review-field="${escapeHtml(reviewField)}"` : "";
    const hiddenClass = hidden ? " hidden" : "";
    const hiddenAttr = hidden ? " hidden" : "";

    return `
      <div class="lineup-form-field${hiddenClass}"${reviewFieldAttr}${hiddenAttr}>
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

  function buildReviewAgentListHtml() {
    const options = global.getLineupValorantAgentDropdownOptions?.() || [];
    return options
      .map(({ slug, label }) => {
        const iconHtml = global.renderLineupValorantAgentOptionIcon?.(slug) || "";
        return `<button type="button" class="pref-dropdown-option" data-dropdown-value="${escapeHtml(slug)}" role="option">${iconHtml}<span>${escapeHtml(label)}</span></button>`;
      })
      .join("");
  }

  function buildSubmitAgentListHtml() {
    return buildReviewAgentListHtml().replaceAll("data-dropdown-value", "data-submit-value");
  }

  function buildAbilityOptionsHtml(options, { submit = false } = {}) {
    const valueAttr = submit ? "data-submit-value" : "data-dropdown-value";
    if (!options.length) {
      return `<button type="button" class="pref-dropdown-option" disabled role="option"><span>Select an agent first</span></button>`;
    }
    return options
      .map(({ slug, label, icon }) => {
        const iconHtml = global.renderLineupValorantAbilityOptionIcon?.(icon) || "";
        return `<button type="button" class="pref-dropdown-option" ${valueAttr}="${escapeHtml(slug)}" role="option">${iconHtml}<span>${escapeHtml(label)}</span></button>`;
      })
      .join("");
  }

  function normalizeReviewAgentSlug(value) {
    if (typeof global.normalizeLineupValorantAgentSlug === "function") {
      return global.normalizeLineupValorantAgentSlug(value);
    }
    return String(value || "").trim().toLowerCase();
  }

  function getAgentDisplayLabel(slug) {
    if (!slug) return "";
    if (typeof global.getLineupValorantAgentDropdownLabel === "function") {
      return global.getLineupValorantAgentDropdownLabel(slug);
    }
    return slug;
  }

  async function getAbilityDisplayLabel(agentSlug, abilitySlug) {
    if (!abilitySlug) return "";
    if (typeof global.getLineupValorantAbilityDropdownLabel === "function") {
      return global.getLineupValorantAbilityDropdownLabel(agentSlug, abilitySlug);
    }
    return abilitySlug;
  }

  function populateSubmitAgents() {
    const list = document.getElementById("lineup-submit-agent-list");
    if (!list) return;
    list.innerHTML = buildSubmitAgentListHtml();
  }

  async function populateSubmitAbilities(agentSlug, selectedAbility = "") {
    const list = document.getElementById("lineup-submit-ability-list");
    if (!list) return;
    const normalizedAgent = normalizeReviewAgentSlug(agentSlug);
    if (!normalizedAgent) {
      list.innerHTML = buildAbilityOptionsHtml([], { submit: true });
      setSubmitDropdownValue("ability", "", "");
      syncSubmitTrailIcon("ability", "");
      return;
    }

    const staticOptions = global.getLineupValorantAbilityDropdownOptionsFromStatic?.(normalizedAgent) || [];
    if (!staticOptions.length) {
      list.innerHTML = `<button type="button" class="pref-dropdown-option" disabled role="option"><span>Loading abilities…</span></button>`;
    }
    const options =
      staticOptions.length > 0
        ? staticOptions
        : (await global.fetchLineupValorantAbilityDropdownOptions?.(normalizedAgent)) || [];
    list.innerHTML = buildAbilityOptionsHtml(options, { submit: true });
    if (selectedAbility) {
      const normalizedAbility =
        typeof global.normalizeLineupValorantAbilitySlug === "function"
          ? global.normalizeLineupValorantAbilitySlug(selectedAbility)
          : selectedAbility;
      const label = options.find((entry) => entry.slug === normalizedAbility)?.label || normalizedAbility;
      setSubmitDropdownValue("ability", normalizedAbility, label);
      syncSubmitTrailIcon("ability", normalizedAbility);
    } else {
      setSubmitDropdownValue("ability", "", "");
      syncSubmitTrailIcon("ability", "");
    }
  }

  function populateReviewAgentList(item) {
    const { list } = getReviewDropdownEls(item, "agent");
    if (!list) return;
    list.innerHTML = buildReviewAgentListHtml();
  }

  async function populateReviewAbilityList(item, agentSlug, selectedAbility = "") {
    const { list } = getReviewDropdownEls(item, "ability");
    if (!list) return;
    const normalizedAgent = normalizeReviewAgentSlug(agentSlug);
    if (!normalizedAgent) {
      list.innerHTML = buildAbilityOptionsHtml([]);
      setReviewDropdownValue(item, "ability", "", "");
      syncReviewTrailIcon(item, "ability", "");
      return;
    }

    const staticOptions = global.getLineupValorantAbilityDropdownOptionsFromStatic?.(normalizedAgent) || [];
    if (!staticOptions.length) {
      list.innerHTML = `<button type="button" class="pref-dropdown-option" disabled role="option"><span>Loading abilities…</span></button>`;
    }
    const options =
      staticOptions.length > 0
        ? staticOptions
        : (await global.fetchLineupValorantAbilityDropdownOptions?.(normalizedAgent)) || [];
    list.innerHTML = buildAbilityOptionsHtml(options);
    if (selectedAbility) {
      const normalizedAbility =
        typeof global.normalizeLineupValorantAbilitySlug === "function"
          ? global.normalizeLineupValorantAbilitySlug(selectedAbility)
          : selectedAbility;
      const label = options.find((entry) => entry.slug === normalizedAbility)?.label || normalizedAbility;
      setReviewDropdownValue(item, "ability", normalizedAbility, label);
      syncReviewTrailIcon(item, "ability", normalizedAbility);
    } else {
      setReviewDropdownValue(item, "ability", "", "");
      syncReviewTrailIcon(item, "ability", "");
    }
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
    requestAnimationFrame(() => {
      overlay.classList.add("active");
      global.syncBodyScrollLock?.();
    });
  }

  function closeOverlay(overlay) {
    if (!overlay) return;
    overlay.classList.remove("active");
    overlay.hidden = true;
    global.syncBodyScrollLock?.();
  }

  function readReviewItemFields(itemEl) {
    const title = itemEl.querySelector('[data-field="title"]')?.value?.trim() || "";
    const map = itemEl.querySelector('[data-field="map"]')?.value?.trim() || "";
    const game = itemEl.querySelector('[data-field="game"]')?.value?.trim() || "";
    const side = itemEl.querySelector('[data-field="side"]')?.value?.trim() || "";
    const difficulty = itemEl.querySelector('[data-field="difficulty"]')?.value?.trim() || "";
    const submitterName = itemEl.querySelector('[data-field="submitterName"]')?.value?.trim() || "";
    const agent = itemEl.querySelector('[data-field="agent"]')?.value?.trim() || "";
    const ability = itemEl.querySelector('[data-field="ability"]')?.value?.trim() || "";
    const utility = itemEl.querySelector('[data-field="utility"]')?.value?.trim() || "";
    const video = itemEl.querySelector('[data-field="video"]')?.files?.[0] || null;
    return { title, map, game, side, difficulty, submitterName, agent, ability, utility, video };
  }

  function buildReviewEditPayload(metadata) {
    return {
      title: metadata.title,
      map: metadata.map,
      game: metadata.game,
      side: metadata.side,
      difficulty: metadata.difficulty,
      submitterName: metadata.submitterName,
      agent: metadata.agent,
      ability: metadata.ability,
      utility: metadata.utility,
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
    if (file.size > MAX_LINEUP_VIDEO_BYTES) {
      showToast("Video must be 100 MB or smaller.", "error");
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
      difficulty: metadata.difficulty,
      submitterName: metadata.submitterName,
      agent: metadata.agent,
      ability: metadata.ability,
      utility: metadata.utility,
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
    const difficulty = entry.difficulty || "";
    const submissionId = entry.id || "";
    const isValorant = game === "valorant";
    const isCs2 = game === "cs2";
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
        ${buildReviewDropdownShell({
          key: "difficulty",
          label: "Difficulty",
          placeholder: "Select difficulty",
          trailKind: "difficulty",
          listHtml: buildReviewDifficultyListHtml(),
          value: difficulty,
          displayValue: getSubmitDropdownDisplayLabel("difficulty", difficulty),
          ariaLabel: "Difficulty",
          submissionId,
        })}
        ${buildReviewDropdownShell({
          key: "agent",
          label: "Agent",
          placeholder: "Select agent",
          trailKind: "agent",
          listHtml: buildReviewAgentListHtml(),
          value: normalizeReviewAgentSlug(entry.agent || ""),
          displayValue: getAgentDisplayLabel(entry.agent || ""),
          ariaLabel: "Agent",
          submissionId,
          reviewField: "agent",
          hidden: !isValorant,
        })}
        ${buildReviewDropdownShell({
          key: "ability",
          label: "Ability",
          placeholder: "Select ability",
          trailKind: "ability",
          listHtml: "",
          value: entry.ability || "",
          displayValue: entry.ability || "",
          ariaLabel: "Ability",
          submissionId,
          reviewField: "ability",
          hidden: !isValorant,
        })}
        <div class="lineup-form-field${isCs2 ? "" : " hidden"}" data-review-field="utility"${isCs2 ? "" : " hidden"}>
          <span>Utility</span>
          <select class="lineup-form-select" data-field="utility" aria-label="Utility">
            <option value="">Select utility</option>
            <option value="smoke"${entry.utility === "smoke" ? " selected" : ""}>Smoke</option>
            <option value="molotov"${entry.utility === "molotov" ? " selected" : ""}>Molotov</option>
            <option value="incendiary"${entry.utility === "incendiary" ? " selected" : ""}>Incendiary</option>
            <option value="he"${entry.utility === "he" ? " selected" : ""}>HE grenade</option>
            <option value="flashbang"${entry.utility === "flashbang" ? " selected" : ""}>Flashbang</option>
          </select>
        </div>
        <div class="lineup-form-field">
          <span>Replace video</span>
          <div class="lineup-form-file-wrap">
            <input type="file" class="lineup-form-file" data-field="video" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov" aria-label="Replace video" />
            <span class="lineup-form-file-text" data-placeholder="Select file">Select file</span>
          </div>
          <span class="lineup-form-hint">Optional. Upload a new MP4, WebM, or MOV (100 MB max).</span>
        </div>
      </div>`;
  }

  function renderReviewItem(entry) {
    const item = document.createElement("article");
    item.className = "lineup-review-item setting-block";
    item.dataset.submissionId = entry.id;
    item.dataset.reviewMode = "pending";

    const previewUrl = resolveSubmissionVideoUrl(entry, { mode: "pending" });

    item.innerHTML = `
      <div class="lineup-review-item-main">
        ${entry.callout ? `<p class="lineup-review-item-callout">${escapeHtml(entry.callout)}</p>` : ""}
        ${renderEditableFields(entry)}
        ${previewUrl ? `<video class="lineup-review-item-video" src="${escapeHtml(previewUrl)}" controls playsinline preload="metadata"></video>` : ""}
      </div>
      <div class="lineup-flow-actions lineup-review-item-actions">
        <button type="button" class="lineup-flow-btn lineup-review-save" data-submission-id="${escapeHtml(entry.id)}">Save changes</button>
        <button type="button" class="lineup-flow-btn lineup-flow-btn-cancel lineup-review-reject" data-submission-id="${escapeHtml(entry.id)}">Reject</button>
        <button type="button" class="lineup-flow-btn lineup-flow-btn-save lineup-review-approve" data-submission-id="${escapeHtml(entry.id)}">Approve</button>
      </div>`;
    return item;
  }

  function renderReviewList() {
    const listEl = document.getElementById("lineup-review-list");
    const emptyEl = document.getElementById("lineup-review-empty");
    if (!listEl || !emptyEl) return;

    listEl.innerHTML = "";
    if (!state.pending.length) {
      emptyEl.hidden = false;
      emptyEl.classList.remove("hidden");
    } else {
      emptyEl.hidden = true;
      emptyEl.classList.add("hidden");
      state.pending.forEach((entry) => listEl.appendChild(renderReviewItem(entry)));
    }

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

  const SUBMIT_FORM_DROPDOWN_KEYS = ["game", "map", "side", "difficulty", "agent", "ability"];
  const SUBMIT_STEP_DROPDOWN_KEY = {
    game: "game",
    map: "map",
    side: "side",
    difficulty: "difficulty",
    agent: "agent",
    ability: "ability",
  };
  const submitDropdownUi = {
    openKey: "",
    activeIndex: -1,
    repositionHandler: null,
    suppressFocusOpenKey: "",
  };

  function getSubmitDropdownKeyForStep(step) {
    return SUBMIT_STEP_DROPDOWN_KEY[step] || "";
  }

  function cancelSubmitDropdownBlurClose(key) {
    const { display } = getSubmitDropdownEls(key);
    if (display?._submitBlurTimeout != null) {
      clearTimeout(display._submitBlurTimeout);
      display._submitBlurTimeout = null;
    }
  }

  function cancelAllSubmitDropdownBlurCloses() {
    SUBMIT_FORM_DROPDOWN_KEYS.forEach((key) => cancelSubmitDropdownBlurClose(key));
  }

  function openSubmitDropdownWhenFocused(key) {
    if (!key || submitDropdownUi.suppressFocusOpenKey === key) return;
    const { display } = getSubmitDropdownEls(key);
    if (!display || document.activeElement !== display) return;
    openSubmitDropdown(key);
  }

  function deferOpenSubmitDropdown(key) {
    if (!key) return;
    window.setTimeout(() => openSubmitDropdownWhenFocused(key), 0);
  }

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
    if (key === "agent") return getAgentDisplayLabel(resolved);
    if (key === "ability") {
      const agent = getSubmitFormAgent();
      const option = getSubmitDropdownEls("ability").list?.querySelector(`[data-submit-value="${resolved}"]`);
      return getDropdownOptionLabel(option) || resolved.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    }
    return resolved;
  }

  function getSubmitFormAgent() {
    return document.getElementById("lineup-submit-agent")?.value?.trim() || "";
  }

  function getReviewDropdownDisplayLabel(item, key, value) {
    const resolved = String(value || "").trim();
    if (!resolved) return "";
    if (key === "side") return getSideDisplayLabel(resolved);
    if (key === "game") return getGameDisplayLabel(resolved);
    if (key === "map") return getMapDisplayLabel(getReviewItemGame(item), resolved);
    if (key === "difficulty") return getSubmitDropdownDisplayLabel("difficulty", resolved);
    if (key === "agent") return getAgentDisplayLabel(resolved);
    if (key === "ability") {
      const option = getReviewDropdownEls(item, "ability").list?.querySelector(`[data-dropdown-value="${resolved}"]`);
      return getDropdownOptionLabel(option) || resolved.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
    }
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
      return;
    }

    if (key === "agent") {
      const src = global.getLineupValorantAgentIconSrc?.(resolvedValue) || "";
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
      ensureSubmitTrailFallback(trail, "ri-user-star-line");
      trail.classList.remove("has-value");
      trail.removeAttribute("data-value");
      return;
    }

    if (key === "ability") {
      const agent = getSubmitFormAgent();
      const src = global.getLineupValorantAbilityIconSrc?.(agent, resolvedValue) || "";
      if (!src && resolvedValue && agent) {
        void global.fetchLineupValorantAbilityDropdownOptions?.(agent).then((options) => {
          const match = options.find((entry) => entry.slug === resolvedValue);
          if (match?.icon && image) {
            if (fallback) fallback.hidden = true;
            image.src = match.icon;
            image.hidden = false;
            trail.classList.add("has-value");
            trail.dataset.value = resolvedValue;
          }
        });
        if (!src) {
          ensureSubmitTrailFallback(trail, "ri-flashlight-line");
          if (resolvedValue) trail.classList.add("has-value");
          return;
        }
      }
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
      ensureSubmitTrailFallback(trail, "ri-flashlight-line");
      trail.classList.remove("has-value");
      trail.removeAttribute("data-value");
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

  const REVIEW_DROPDOWN_KEYS = ["game", "side", "map", "difficulty", "agent", "ability"];
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
      return;
    }

    if (key === "difficulty") {
      showSubmitTrailText(trail, resolvedValue ? `${resolvedValue}★` : "", "ri-star-fill");
      if (resolvedValue) trail.dataset.value = resolvedValue;
      return;
    }

    if (key === "agent") {
      const src = global.getLineupValorantAgentIconSrc?.(resolvedValue) || "";
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
      ensureSubmitTrailFallback(trail, "ri-user-star-line");
      trail.classList.remove("has-value");
      trail.removeAttribute("data-value");
      return;
    }

    if (key === "ability") {
      const agent = item.querySelector('[data-field="agent"]')?.value || "";
      const src = global.getLineupValorantAbilityIconSrc?.(agent, resolvedValue) || "";
      if (!src && resolvedValue && agent) {
        void global.fetchLineupValorantAbilityDropdownOptions?.(agent).then((options) => {
          const match = options.find((entry) => entry.slug === resolvedValue);
          if (match?.icon && image) {
            if (fallback) fallback.hidden = true;
            image.src = match.icon;
            image.hidden = false;
            trail.classList.add("has-value");
            trail.dataset.value = resolvedValue;
          }
        });
        if (!src) {
          ensureSubmitTrailFallback(trail, "ri-flashlight-line");
          if (resolvedValue) trail.classList.add("has-value");
          return;
        }
      }
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
      ensureSubmitTrailFallback(trail, "ri-flashlight-line");
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
    if (key === "ability") void ensureReviewAbilityOptionsLoaded(item);
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
    if (key === "game") {
      syncReviewItemMapOptions(item);
      syncReviewItemGameFields(item);
    }
    if (key === "agent") {
      setReviewDropdownValue(item, "ability", "", "");
      syncReviewTrailIcon(item, "ability", "");
      void populateReviewAbilityList(item, value, "");
    }
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
      event.stopPropagation();
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
    populateReviewAgentList(item);
    syncReviewSideOptionIcons(item, game);
    const agent = item.querySelector('[data-field="agent"]')?.value || "";
    const ability = item.querySelector('[data-field="ability"]')?.value || "";
    void populateReviewAbilityList(item, agent, ability);
    REVIEW_DROPDOWN_KEYS.forEach((key) => {
      const { dropdown } = getReviewDropdownEls(item, key);
      syncReviewTrailIcon(item, key, dropdown?.dataset.value || "");
    });
  }

  async function ensureSubmitAbilityOptionsLoaded() {
    const agent = getSubmitFormAgent();
    const { list, hidden } = getSubmitDropdownEls("ability");
    if (!list || !agent) return;
    if (!list.querySelector("[data-submit-value]:not([disabled])")) {
      await populateSubmitAbilities(agent, hidden?.value || "");
    }
  }

  async function ensureReviewAbilityOptionsLoaded(item) {
    const agent = item.querySelector('[data-field="agent"]')?.value || "";
    const { list, hidden } = getReviewDropdownEls(item, "ability");
    if (!list || !agent) return;
    if (!list.querySelector("[data-dropdown-value]:not([disabled])")) {
      await populateReviewAbilityList(item, agent, hidden?.value || "");
    }
  }

  function openSubmitDropdown(key) {
    closeAllReviewDropdowns();
    if (submitDropdownUi.openKey && submitDropdownUi.openKey !== key) {
      closeSubmitDropdown(submitDropdownUi.openKey);
    }
    const { dropdown, trigger, list, display } = getSubmitDropdownEls(key);
    if (!dropdown || !trigger || !list) return;
    if (key === "ability") void ensureSubmitAbilityOptionsLoaded();
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
      setSubmitDropdownValue("agent", "", "");
      setSubmitDropdownValue("ability", "", "");
      void populateSubmitAbilities("", "");
    }
    if (key === "agent") {
      setSubmitDropdownValue("ability", "", "");
      syncSubmitTrailIcon("ability", "");
      void populateSubmitAbilities(value, "");
    }
    cancelSubmitDropdownBlurClose(key);
    closeSubmitDropdown(key);
    getSubmitDropdownEls(key).display?.blur();
  }

  function resetSubmitFormDropdowns(game = "") {
    populateSubmitGames();
    populateSubmitAgents();
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
    setSubmitDropdownValue("agent", "", "");
    setSubmitDropdownValue("ability", "", "");
    void populateSubmitAbilities("", "");
    ["game", "map", "side", "difficulty", "agent", "ability"].forEach((dropdownKey) => syncSubmitTrailIcon(dropdownKey, ""));
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
      cancelSubmitDropdownBlurClose(key);
      display._submitBlurTimeout = window.setTimeout(() => {
        display._submitBlurTimeout = null;
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
      event.stopPropagation();
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
    populateSubmitAgents();
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

    const dropdownKey = getSubmitDropdownKeyForStep(nextStep);
    cancelAllSubmitDropdownBlurCloses();

    if (dropdownKey) {
      const { display } = getSubmitDropdownEls(dropdownKey);
      if (!display) return;
      requestAnimationFrame(() => {
        if (submitOverlay?.hidden) return;
        const nextField = form.querySelector(`[data-submit-step="${nextStep}"]`);
        if (!nextField || nextField.hidden) return;
        display.focus({ preventScroll: true });
        deferOpenSubmitDropdown(dropdownKey);
      });
      return;
    }

    const focusable = field.querySelector(
      'input:not([type="hidden"]):not([type="file"]), select, textarea, .game-search',
    );
    focusable?.focus({ preventScroll: true });
  }

  function initSubmitFormStepListeners() {
    const form = document.getElementById("lineup-submit-form");
    if (!form || form.dataset.submitStepsInit === "1") return;
    form.dataset.submitStepsInit = "1";

    const onTextInput = () => {
      syncSubmitFormSteps();
    };

    const advanceSubmitStepOnEnter = (step, event) => {
      if (event.key !== "Enter" || event.isComposing || event.shiftKey) return;
      if (!isSubmitStepComplete(step)) return;
      event.preventDefault();
      focusNextSubmitStep();
    };

    const usernameInput = document.getElementById("lineup-submit-username");
    usernameInput?.addEventListener("input", () => {
      syncSubmitUsernameFieldState();
      onTextInput();
    });
    usernameInput?.addEventListener("keydown", (event) => advanceSubmitStepOnEnter("username", event));

    const titleInput = document.getElementById("lineup-submit-title");
    titleInput?.addEventListener("input", onTextInput);
    titleInput?.addEventListener("keydown", (event) => advanceSubmitStepOnEnter("title", event));

    document.getElementById("lineup-submit-utility")?.addEventListener("change", () => {
      syncSubmitFormSteps();
    });
    document.getElementById("lineup-submit-utility")?.addEventListener("keydown", (event) => {
      advanceSubmitStepOnEnter("utility", event);
    });

    const videoInput = document.getElementById("lineup-submit-video");
    videoInput?.addEventListener("change", () => {
      syncLineupFormFileText(videoInput);
      syncSubmitFormSteps();
    });
  }

  function syncSubmitGameFields(game) {
    syncSubmitSideOptionIcons(game);
    const isValorant = game === "valorant";
    const agentField = document.getElementById("lineup-submit-agent-field");
    const abilityField = document.getElementById("lineup-submit-ability-field");
    if (agentField) {
      agentField.hidden = !isValorant;
      agentField.classList.toggle("hidden", !isValorant);
    }
    if (abilityField) {
      abilityField.hidden = !isValorant;
      abilityField.classList.toggle("hidden", !isValorant);
    }
    if (isValorant) populateSubmitAgents();
    else {
      setSubmitDropdownValue("agent", "", "");
      setSubmitDropdownValue("ability", "", "");
      void populateSubmitAbilities("", "");
    }
    ["map", "side", "difficulty", "agent", "ability"].forEach((key) => {
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
    const id =
      saveBtn?.dataset.submissionId ||
      approve?.dataset.submissionId ||
      reject?.dataset.submissionId ||
      "";
    if (!id || !item) return;

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

    if (!metadata.difficulty) {
      showToast("Difficulty is required.", "error");
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
    if (file.size > MAX_LINEUP_VIDEO_BYTES) {
      if (status) status.textContent = "Video must be 100 MB or smaller.";
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
    communityEditOverlay = document.getElementById("lineup-community-edit-overlay");

    if (isAppLoadFinished()) {
      global.__morningRoastAppLoaded = true;
    } else {
      global.addEventListener("morning-roast:app-loaded", onAppLoaded, { once: true });
    }

    document.getElementById("lineup-submit-lineup-owner-btn")?.addEventListener("click", openSubmitModal);
    document.getElementById("lineup-submit-lineup-btn")?.addEventListener("click", openSubmitModal);
    document.getElementById("lineup-submit-modal-close")?.addEventListener("click", closeSubmitModal);
    document.getElementById("lineup-submit-cancel")?.addEventListener("click", closeSubmitModal);
    document.getElementById("lineup-submit-form")?.addEventListener("submit", handleSubmitForm);
    document.getElementById("lineup-owner-review-open-btn")?.addEventListener("click", openReviewModal);
    document.getElementById("lineup-review-modal-close")?.addEventListener("click", closeReviewModal);
    document.getElementById("lineup-community-edit-close")?.addEventListener("click", closeCommunityEditModal);
    document.getElementById("lineup-community-edit-cancel")?.addEventListener("click", closeCommunityEditModal);
    document.getElementById("lineup-community-edit-save")?.addEventListener("click", () => {
      void saveCommunityEditModal();
    });

    submitOverlay?.addEventListener("click", (event) => {
      if (event.target === submitOverlay) closeSubmitModal();
    });
    reviewOverlay?.addEventListener("click", (event) => {
      if (event.target === reviewOverlay) closeReviewModal();
    });
    communityEditOverlay?.addEventListener("click", (event) => {
      if (event.target === communityEditOverlay) closeCommunityEditModal();
    });
    reviewOverlay?.querySelector(".lineup-flow-body")?.addEventListener("click", handleReviewListClick);

    global.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (communityEditOverlay && !communityEditOverlay.hidden) {
        closeCommunityEditModal();
        return;
      }
      if (communityManageState.game) {
        setCommunityManageMode(communityManageState.game, "");
        return;
      }
      if (submitDropdownUi.openKey) {
        closeAllSubmitDropdowns();
        return;
      }
      if (submitOverlay && !submitOverlay.hidden) closeSubmitModal();
      if (reviewOverlay && !reviewOverlay.hidden) closeReviewModal();
    });

    initSubmitFormDropdowns();
    initSubmitFormStepListeners();
    initCommunityManageControls();
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

    global.addEventListener("morning-roast:chat-connected", () => {
      void refreshAllCommunityLineups();
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
          if (message.submission) {
            notifyOwnerPendingReviews(message.pendingCount ?? state.pendingCount + 1);
          } else if (typeof message.pendingCount === "number") {
            state.pendingCount = message.pendingCount;
            updateOwnerBanner();
          }
          requestPendingList();
        }
        break;
      case "lineup_submission_list":
        if (isOwner()) {
          setPendingList(message.pending, message.pendingCount, message.approved);
          notifyOwnerPendingReviews(message.pendingCount ?? message.pending?.length ?? 0, { initial: true });
        }
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
        if (isOwner()) {
          if (communityManageState.bulkDeletePending > 0) {
            communityManageState.bulkDeletePending -= 1;
            if (communityManageState.bulkDeletePending === 0) {
              showToast("Community lineups deleted.");
            }
          } else {
            showToast("Community lineup deleted.");
          }
        }
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
    void refreshAllCommunityLineups();
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
