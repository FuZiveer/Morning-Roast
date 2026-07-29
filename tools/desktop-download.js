/** Desktop app download page — Windows installer link + in-app detection. */
(function (global) {
  const DESKTOP_APP_VERSION = "1.0.0";
  const DESKTOP_INSTALLER_FALLBACK = `Morning-Roast-Setup-${DESKTOP_APP_VERSION}.exe`;

  function isDesktopRuntime() {
    return Boolean(global.MorningRoastDesktop?.isDesktop);
  }

  function getDownloadElements() {
    return {
      sidebarBtn: document.getElementById("sidebar-download-button"),
      navBtn: document.getElementById("download-button"),
      homeBanner: document.getElementById("home-download-banner"),
      primaryLink: document.getElementById("download-app-primary"),
      statusEl: document.getElementById("download-app-status"),
      versionEls: document.querySelectorAll("[data-desktop-app-version]"),
      runtimePanel: document.getElementById("download-runtime-panel"),
      webPanel: document.getElementById("download-web-panel"),
    };
  }

  function setDownloadNavVisible(visible) {
    const { sidebarBtn, navBtn, homeBanner } = getDownloadElements();
    sidebarBtn?.toggleAttribute("hidden", !visible);
    sidebarBtn?.classList.toggle("hidden", !visible);
    navBtn?.toggleAttribute("hidden", !visible);
    navBtn?.classList.toggle("hidden", !visible);
    homeBanner?.toggleAttribute("hidden", !visible);
    homeBanner?.classList.toggle("hidden", !visible);
  }

  function setDownloadStatus(message, { tone = "muted" } = {}) {
    const { statusEl } = getDownloadElements();
    if (!statusEl) return;
    if (!message) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      statusEl.className = "download-status";
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.className = `download-status download-status--${tone}`;
  }

  async function fetchPublishedDesktopManifest() {
    try {
      const response = await fetch("./downloads/desktop-version.json", { cache: "no-store" });
      if (!response.ok) return null;
      const data = await response.json();
      return data && typeof data === "object" ? data : null;
    } catch {
      return null;
    }
  }

  async function probeInstallerAvailability(href) {
    if (!href) return false;
    try {
      const response = await fetch(href, { method: "HEAD", cache: "no-store" });
      return response.ok;
    } catch {
      return false;
    }
  }

  async function syncDownloadAvailability(manifest) {
    if (isDesktopRuntime()) return;

    const { primaryLink } = getDownloadElements();
    if (!primaryLink) return;

    const installerName = String(manifest?.installer || DESKTOP_INSTALLER_FALLBACK).trim();
    const href = `./downloads/${installerName}`;
    primaryLink.href = href;
    primaryLink.setAttribute("download", installerName);

    const available = await probeInstallerAvailability(href);
    primaryLink.classList.toggle("is-unavailable", !available);
    primaryLink.setAttribute("aria-disabled", available ? "false" : "true");

    if (available) {
      setDownloadStatus("");
      return;
    }

    setDownloadStatus(
      "Installer is not on the server yet. Build from the desktop folder, then run npm run release.",
      { tone: "warn" },
    );
  }

  async function initDesktopDownloadPage() {
    const els = getDownloadElements();
    const manifest = await fetchPublishedDesktopManifest();
    const version = String(manifest?.version || DESKTOP_APP_VERSION).trim();
    const installerName = String(manifest?.installer || `Morning-Roast-Setup-${version}.exe`).trim();

    els.versionEls?.forEach((node) => {
      node.textContent = version;
    });

    if (els.primaryLink) {
      els.primaryLink.href = `./downloads/${installerName}`;
      els.primaryLink.setAttribute("download", installerName);
    }

    if (isDesktopRuntime()) {
      setDownloadNavVisible(false);
      els.runtimePanel?.removeAttribute("hidden");
      els.webPanel?.setAttribute("hidden", "");
      return;
    }

    setDownloadNavVisible(true);
    els.runtimePanel?.setAttribute("hidden", "");
    els.webPanel?.removeAttribute("hidden");
    await syncDownloadAvailability(manifest);
  }

  global.MorningRoastDesktopDownload = {
    init: initDesktopDownloadPage,
    refreshAvailability: async () => {
      await syncDownloadAvailability(await fetchPublishedDesktopManifest());
    },
    getDownloadHref: () => {
      const installer = DESKTOP_INSTALLER_FALLBACK;
      return `./downloads/${installer}`;
    },
    getVersion: () => DESKTOP_APP_VERSION,
    isDesktopRuntime,
  };
})(window);
