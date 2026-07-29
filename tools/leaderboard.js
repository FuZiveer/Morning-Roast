(function (global) {
  const PROFILE_DISPLAY_NAME_KEY = "profileDisplayName";
  const MODE_LABELS = {
    static: "Static",
    shrinking: "Shrink",
    tracking: "Track",
    flick: "Flick",
    switch: "Switch",
    strafe: "Strafe",
    micro: "Micro",
  };

  const panels = new Map();
  let apiBaseUrl = "";
  let initialized = false;

  function isLocalDevHost() {
    const host = global.location?.hostname;
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    if (!isLocalHost) return false;
    if (global.MorningRoastDesktop?.isDesktop) return false;
    return true;
  }

  function resolveApiBaseUrl() {
    if (apiBaseUrl) return apiBaseUrl;

    if (isLocalDevHost()) {
      const host = global.location.hostname;
      const protocol = global.location?.protocol === "https:" ? "https" : "http";
      apiBaseUrl = `${protocol}://${host}:8080`;
      return apiBaseUrl;
    }

    const meta = document.querySelector('meta[name="morning-roast-leaderboard-api"]')?.content?.trim();
    if (meta) {
      apiBaseUrl = meta.replace(/\/$/, "");
      return apiBaseUrl;
    }

    const presenceMeta = document.querySelector('meta[name="morning-roast-presence-ws"]')?.content?.trim();
    if (presenceMeta) {
      try {
        const url = new URL(presenceMeta);
        url.protocol = url.protocol === "wss:" ? "https:" : "http:";
        url.pathname = "";
        url.search = "";
        url.hash = "";
        apiBaseUrl = url.toString().replace(/\/$/, "");
        return apiBaseUrl;
      } catch {
        // fall through
      }
    }

    apiBaseUrl = "";
    return apiBaseUrl;
  }

  function getAuthorId() {
    return global.MorningRoastChat?.getAuthorId?.() || "";
  }

  function getDisplayName() {
    return String(global.localStorage?.getItem(PROFILE_DISPLAY_NAME_KEY) || "").trim();
  }

  function formatGameLabel(game) {
    if (!game) return "Unknown";
    const normalized = String(game).trim();
    if (!normalized) return "Unknown";
    return normalized
      .toLowerCase()
      .split(/\s+/)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function formatTimerLabel(timer) {
    return timer === "60" ? "60s" : `${timer}s`;
  }

  function formatReaction(reaction) {
    const value = Number(reaction);
    if (!Number.isFinite(value) || value <= 0 || value >= 9999) return "—";
    return `${value}ms`;
  }

  function formatScore(entry, scoreType) {
    if (scoreType === "accuracy") return `${entry.score}%`;
    return `${entry.score} hits`;
  }

  function formatMeta(entry, scoreType) {
    const parts = [formatScore(entry, scoreType)];
    if (scoreType !== "accuracy") parts.push(`${entry.accuracy}% acc`);
    parts.push(formatReaction(entry.reaction));
    return parts.join(" · ");
  }

  function getTrainerContext() {
    const trainer = global.aimTrainer;
    const game = String(trainer?.game || global.localStorage?.getItem("aimGame") || "Valorant").trim();
    const mode = String(trainer?.mode || global.localStorage?.getItem("aimMode") || "static").trim().toLowerCase();
    const timer = String(trainer?.sessionTimerId || global.localStorage?.getItem("aimTimer") || "15").trim();
    return {
      game: game.toUpperCase(),
      mode,
      timer,
      gameLabel: formatGameLabel(game),
      modeLabel: MODE_LABELS[mode] || mode,
      timerLabel: formatTimerLabel(timer),
    };
  }

  function getStatsContext() {
    const gameInput = document.getElementById("profile-game-search");
    const modeDropdown = document.getElementById("profile-mode-dropdown");
    const timerDropdown = document.getElementById("profile-timer-dropdown");

    const rawGame =
      gameInput?.dataset?.lastValid ||
      global.localStorage?.getItem("profileFilterGame") ||
      global.localStorage?.getItem("aimGame") ||
      "Aimlabs";
    const game = String(rawGame).trim().toUpperCase();
    const mode = String(modeDropdown?.dataset?.value || global.localStorage?.getItem("aimMode") || "static").trim().toLowerCase();
    const timer = String(timerDropdown?.dataset?.value || "15").trim();

    return {
      game,
      mode,
      timer,
      gameLabel: formatGameLabel(rawGame),
      modeLabel: MODE_LABELS[mode] || mode,
      timerLabel: formatTimerLabel(timer),
    };
  }

  function resolveContext(source) {
    return source === "stats" ? getStatsContext() : getTrainerContext();
  }

  async function fetchLeaderboard(context) {
    const base = resolveApiBaseUrl();
    if (!base) return { error: "offline", entries: [] };

    const params = new URLSearchParams({
      game: context.game,
      mode: context.mode,
      timer: context.timer,
    });
    const userId = getAuthorId();
    if (userId) params.set("userId", userId);

    try {
      const response = await fetch(`${base}/leaderboard?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        return { error: "unavailable", entries: [] };
      }
      return await response.json();
    } catch {
      return { error: "offline", entries: [] };
    }
  }

  async function submitScore(payload) {
    const base = resolveApiBaseUrl();
    if (!base) return { error: "offline" };

    try {
      const response = await fetch(`${base}/leaderboard/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return data.error ? data : { error: "submit_failed" };
      return data;
    } catch {
      return { error: "offline" };
    }
  }

  function renderPanel(panelEl, data, context) {
    if (!panelEl) return;

    const labelEl = panelEl.querySelector(".aim-leaderboard-board-label");
    const rankEl = panelEl.querySelector(".aim-leaderboard-user-rank");
    const statusEl = panelEl.querySelector(".aim-leaderboard-status");
    const listEl = panelEl.querySelector(".aim-leaderboard-entries");
    const authorId = getAuthorId();

    if (labelEl) {
      labelEl.textContent = `${context.gameLabel} · ${context.modeLabel} · ${context.timerLabel}`;
    }

    if (rankEl) {
      if (data?.userRank) {
        rankEl.textContent = `Ranked #${data.userRank} on this board`;
      } else if (authorId && getDisplayName().length >= 2) {
        rankEl.textContent = "Not ranked yet — post a scored run to appear";
      } else {
        rankEl.textContent = "Set a display name on Profile to appear on the board";
      }
    }

    if (statusEl) {
      if (data?.error === "offline") {
        statusEl.textContent = "Offline";
        statusEl.title = "Leaderboard server offline. Scores still save locally.";
      } else if (data?.error === "unavailable") {
        statusEl.textContent = "Unavailable";
        statusEl.title = "Leaderboard unavailable right now.";
      } else if (!data?.entries?.length) {
        statusEl.textContent = "Empty board";
        statusEl.title = "No scores yet — be the first to post a run.";
      } else {
        const total = data.total || data.entries.length;
        statusEl.textContent = `${total} player${total === 1 ? "" : "s"}`;
        statusEl.title = `${total} ranked player${total === 1 ? "" : "s"}`;
      }
    }

    if (!listEl) return;

    if (!data?.entries?.length) {
      listEl.innerHTML = "";
      listEl.classList.add("is-empty");
      return;
    }

    listEl.classList.remove("is-empty");
    const scoreType = data.scoreType || (context.mode === "tracking" ? "accuracy" : "hits");

    listEl.innerHTML = data.entries
      .map((entry) => {
        const isSelf = authorId && entry.userId === authorId;
        const rankClass =
          entry.rank === 1 ? " aim-leaderboard-rank--gold" :
          entry.rank === 2 ? " aim-leaderboard-rank--silver" :
          entry.rank === 3 ? " aim-leaderboard-rank--bronze" : "";
        const medalIcon =
          entry.rank === 1 ? "ri-vip-crown-fill aim-leaderboard-medal--gold" :
          entry.rank === 2 ? "ri-medal-line aim-leaderboard-medal--silver" :
          entry.rank === 3 ? "ri-award-line aim-leaderboard-medal--bronze" : "";
        const medalMarkup = medalIcon
          ? `<div class="control-group"><i class="${medalIcon} aim-leaderboard-medal" aria-hidden="true"></i></div>`
          : "";
        return `
          <div class="setting-block aim-leaderboard-entry${isSelf ? " aim-leaderboard-entry--self" : ""}">
            <div class="setting-text">
              <span><span class="aim-leaderboard-rank${rankClass}">#${entry.rank}</span> ${escapeHtml(entry.displayName)}</span>
              <p>${escapeHtml(formatMeta(entry, scoreType))}</p>
            </div>
            ${medalMarkup}
          </div>`;
      })
      .join("");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function refreshPanel(panelEl) {
    if (!panelEl) return;
    const source = panelEl.dataset.leaderboardContext || "trainer";
    const context = resolveContext(source);

    if (context.timer === "infinite") {
      renderPanel(panelEl, { entries: [], error: null, total: 0 }, context);
      const statusEl = panelEl.querySelector(".aim-leaderboard-status");
      if (statusEl) {
        statusEl.textContent = "Not ranked";
        statusEl.title = "Infinite sessions are not ranked. Use 15s, 30s, or 60s.";
      }
      const listEl = panelEl.querySelector(".aim-leaderboard-entries");
      if (listEl) {
        listEl.innerHTML = "";
        listEl.classList.add("is-empty");
      }
      return;
    }

    panelEl.classList.add("is-loading");
    const data = await fetchLeaderboard(context);
    panelEl.classList.remove("is-loading");
    renderPanel(panelEl, data, context);
  }

  async function refreshAll() {
    await Promise.all(Array.from(panels.keys()).map((panel) => refreshPanel(panel)));
  }

  function registerPanel(panelEl) {
    if (!panelEl || panels.has(panelEl)) return;
    panels.set(panelEl, true);

    const refreshBtn = panelEl.querySelector(".aim-leaderboard-refresh");
    refreshBtn?.addEventListener("click", () => refreshPanel(panelEl));
  }

  function canSubmitSession(session) {
    if (!session || session.finderEnabled) return false;
    if (session.timer === "infinite") return false;
    if (!["15", "30", "60"].includes(String(session.timer))) return false;
    const displayName = getDisplayName();
    if (displayName.length < 2) return false;
    if (!getAuthorId()) return false;
    return true;
  }

  async function submitFromSession(session) {
    if (!canSubmitSession(session)) return null;

    const payload = {
      userId: getAuthorId(),
      displayName: getDisplayName(),
      game: session.game,
      mode: session.mode,
      timer: session.timer,
      hits: session.hits,
      accuracy: session.accuracy,
      reaction: session.reaction,
      score: session.score,
      sens: session.sens,
      dpi: session.dpi,
    };

    const result = await submitScore(payload);
    if (result?.ok) {
      await refreshAll();
      if (result.improved && result.rank) {
        global.Toast?.notify?.({
          type: "success",
          title: "Leaderboard updated",
          message: `You are now #${result.rank} for this board.`,
        });
      }
    }
    return result;
  }

  function initDropdowns() {
    document.querySelectorAll(".aim-leaderboard-dropdown").forEach((dropdown) => {
      const trigger = dropdown.querySelector(".app-status-trigger");
      if (!trigger || dropdown.dataset.leaderboardDropdownBound) return;
      dropdown.dataset.leaderboardDropdownBound = "1";
      trigger.addEventListener("click", () => {
        const open = dropdown.classList.toggle("is-open");
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) {
          const panel = dropdown.querySelector("[data-leaderboard-panel]");
          if (panel) refreshPanel(panel);
        }
      });
    });
  }

  function init() {
    if (initialized) return;
    initialized = true;

    document.querySelectorAll("[data-leaderboard-panel]").forEach((panelEl) => {
      registerPanel(panelEl);
    });

    initDropdowns();
    global.addEventListener("profile-display-name-changed", () => refreshAll());
  }

  global.MorningRoastLeaderboard = {
    init,
    initDropdowns,
    refreshAll,
    refreshPanel,
    submitFromSession,
    getTrainerContext,
    getStatsContext,
    resolveApiBaseUrl,
  };
})(window);
