/** Desktop app — auto-update UI + live website version checks. */
(function (global) {
  const WEB_VERSION_PATTERN = /APP_CACHE_VERSION\s*=\s*"([^"]+)"/;
  const CHECK_INTERVAL_MS = 2 * 60 * 1000;
  const AUTO_RELOAD_DELAY_MS = 500;

  let bannerEl = null;
  let unsubscribe = null;
  let webVersionTimer = null;
  let remoteBaseUrl = "";
  let applyingWebsiteUpdate = false;

  function isDesktopRuntime() {
    return Boolean(global.MorningRoastDesktop?.isDesktop);
  }

  function getCurrentWebVersion() {
    return document.documentElement.dataset.appCacheVersion || global.APP_CACHE_VERSION || "";
  }

  function isBlockingUiOpen() {
    return (
      document.body.classList.contains("username-onboarding-open") ||
      Boolean(document.querySelector(".trainer-settings-overlay.active"))
    );
  }

  async function fetchRemoteWebVersion(baseUrl) {
    const root = String(baseUrl || remoteBaseUrl || global.location.origin).trim();
    if (!root) return "";
    try {
      const scriptUrl = new URL("script.js", root.endsWith("/") ? root : `${root}/`);
      scriptUrl.search = `_=${Date.now()}`;
      const response = await fetch(scriptUrl.toString(), { cache: "no-store" });
      if (!response.ok) return "";
      const source = await response.text();
      return source.match(WEB_VERSION_PATTERN)?.[1] || "";
    } catch {
      return "";
    }
  }

  async function flushDesktopStorage() {
    try {
      await global.MorningRoastStorageBackup?.flushNow?.();
    } catch {
      /* ignore persistence errors */
    }
  }

  function ensureBanner() {
    if (bannerEl) return bannerEl;
    bannerEl = document.createElement("div");
    bannerEl.id = "desktop-update-banner";
    bannerEl.className = "desktop-update-banner";
    bannerEl.hidden = true;
    bannerEl.innerHTML = `
      <div class="desktop-update-banner-copy">
        <strong class="desktop-update-banner-title"></strong>
        <span class="desktop-update-banner-text"></span>
      </div>
      <div class="desktop-update-banner-actions"></div>`;
    document.body.appendChild(bannerEl);
    return bannerEl;
  }

  function hideBanner() {
    if (!bannerEl) return;
    bannerEl.hidden = true;
    document.body.classList.remove("has-desktop-update-banner");
  }

  function showBanner({ title, text, actions = [] }) {
    const banner = ensureBanner();
    const titleEl = banner.querySelector(".desktop-update-banner-title");
    const textEl = banner.querySelector(".desktop-update-banner-text");
    const actionsEl = banner.querySelector(".desktop-update-banner-actions");

    if (titleEl) titleEl.textContent = title || "Update available";
    if (textEl) textEl.textContent = text || "";

    if (actionsEl) {
      actionsEl.replaceChildren();
      actions.forEach(({ label, primary, onClick }) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `desktop-update-banner-btn${primary ? " desktop-update-banner-btn--primary" : ""}`;
        button.textContent = label;
        button.addEventListener("click", onClick);
        actionsEl.appendChild(button);
      });
    }

    banner.hidden = false;
    document.body.classList.add("has-desktop-update-banner");
  }

  async function applyWebsiteUpdate({ manual = false } = {}) {
    if (applyingWebsiteUpdate) return;
    applyingWebsiteUpdate = true;
    hideBanner();

    if (!manual) {
      global.Toast?.notify?.({
        message: "Updating Morning Roast to the latest version…",
        type: "info",
      });
    }

    await flushDesktopStorage();

    global.setTimeout(() => {
      global.MorningRoastDesktop?.reloadApp?.();
      applyingWebsiteUpdate = false;
    }, manual ? 0 : AUTO_RELOAD_DELAY_MS);
  }

  function handleAppUpdateStatus(payload = {}) {
    const state = String(payload.state || "").trim();

    if (state === "downloading") {
      showBanner({
        title: "Downloading desktop update",
        text: payload.message || "A new Morning Roast installer is downloading in the background.",
        actions: [],
      });
      return;
    }

    if (state === "ready") {
      showBanner({
        title: "Restart to update",
        text: payload.message || "The latest desktop build has finished downloading.",
        actions: [
          {
            label: "Restart now",
            primary: true,
            onClick: () => global.MorningRoastDesktop?.installUpdate?.(),
          },
          {
            label: "Later",
            onClick: hideBanner,
          },
        ],
      });
      return;
    }

    if (state === "checking" || state === "available") {
      return;
    }

    if (state === "idle" && payload.message) {
      global.Toast?.notify?.({ message: payload.message, type: "success" });
      return;
    }

    if (state === "error" && payload.message) {
      global.Toast?.notify?.({ message: payload.message, type: "error" });
      return;
    }

    if (state === "offline-fallback" && payload.message) {
      global.Toast?.notify?.({ message: payload.message, type: "info" });
    }
  }

  async function checkWebsiteVersion({ autoApply = false } = {}) {
    if (!isDesktopRuntime()) return;

    const current = getCurrentWebVersion();
    const remote = await fetchRemoteWebVersion();
    if (!remote || !current || remote === current) return;

    if (autoApply && !isBlockingUiOpen()) {
      await applyWebsiteUpdate();
      return;
    }

    showBanner({
      title: "Website update available",
      text: "Morning Roast has a newer web release. Reload to sync the latest tools and fixes.",
      actions: [
        {
          label: "Reload now",
          primary: true,
          onClick: () => {
            void applyWebsiteUpdate({ manual: true });
          },
        },
        {
          label: "Later",
          onClick: hideBanner,
        },
      ],
    });
  }

  async function initDesktopUpdateUi() {
    if (!isDesktopRuntime()) return;

    const info = (await global.MorningRoastDesktop?.getLoadInfo?.()) || {};
    remoteBaseUrl = String(info.remoteUrl || "https://morningroast.net/").trim();

    unsubscribe?.();
    unsubscribe = global.MorningRoastDesktop?.onUpdateStatus?.(handleAppUpdateStatus) || null;

    document.documentElement.dataset.desktopAppVersion = String(info.appVersion || global.MorningRoastDesktop?.appVersion || "");
    document.documentElement.dataset.desktopLoadMode = String(info.mode || "");

    if (webVersionTimer) clearInterval(webVersionTimer);

    const runVersionCheck = (autoApply = false) => {
      void checkWebsiteVersion({ autoApply });
    };

    runVersionCheck(true);
    global.addEventListener("morning-roast:app-loaded", () => runVersionCheck(true), { once: true });

    webVersionTimer = setInterval(() => {
      runVersionCheck(!isBlockingUiOpen());
    }, CHECK_INTERVAL_MS);

    global.addEventListener("focus", () => {
      runVersionCheck(!isBlockingUiOpen());
      global.MorningRoastDesktop?.checkForUpdates?.();
    });
  }

  global.MorningRoastDesktopUpdate = {
    init: initDesktopUpdateUi,
    checkWebsiteVersion,
    applyWebsiteUpdate,
  };
})(window);
