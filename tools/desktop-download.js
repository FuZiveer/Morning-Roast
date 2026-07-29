/** Desktop app download page — Windows installer link + in-app detection. */
(function (global) {
  const DESKTOP_APP_VERSION = "1.0.0";
  const DESKTOP_INSTALLER_FALLBACK = `Morning-Roast-Setup-${DESKTOP_APP_VERSION}.exe`;
  const GITHUB_REPO = "FuZiveer/Morning-Roast";

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

  function releaseTagFromManifest(manifest) {
    const explicit = String(manifest?.releaseTag || "").trim();
    if (explicit) return explicit;
    const version = String(manifest?.version || DESKTOP_APP_VERSION).trim();
    return version ? `v${version}` : "";
  }

  async function fetchGitHubRelease(tag) {
    const normalizedTag = String(tag || "").trim();
    const endpoint = normalizedTag
      ? `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${encodeURIComponent(normalizedTag)}`
      : `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

    try {
      const response = await fetch(endpoint, {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const data = await response.json();
      return data && typeof data === "object" ? data : null;
    } catch {
      return null;
    }
  }

  function pickInstallerAsset(release, preferredName = "") {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const preferred = String(preferredName || "").trim();
    if (preferred) {
      const exact = assets.find((asset) => asset?.name === preferred);
      if (exact?.browser_download_url) return exact;
    }
    return assets.find(
      (asset) =>
        /\.exe$/i.test(String(asset?.name || "")) &&
        /Morning-Roast-Setup/i.test(String(asset?.name || "")),
    ) || null;
  }

  async function resolveGitHubInstaller(manifest) {
    const release = await fetchGitHubRelease(releaseTagFromManifest(manifest));
    if (!release) return null;

    const installerName = String(manifest?.installer || DESKTOP_INSTALLER_FALLBACK).trim();
    const asset = pickInstallerAsset(release, installerName);
    if (!asset?.browser_download_url) return null;

    return {
      href: asset.browser_download_url,
      version: String(release.tag_name || "").replace(/^v/i, "") || String(manifest?.version || DESKTOP_APP_VERSION),
      installerName: asset.name || installerName,
    };
  }

  function isExternalInstallerHref(href) {
    if (!href || !/^https?:\/\//i.test(href)) return false;
    try {
      return new URL(href).origin !== global.location.origin;
    } catch {
      return true;
    }
  }

  async function probeSameOriginInstaller(href) {
    if (!href || isExternalInstallerHref(href)) return false;
    try {
      const response = await fetch(href, { method: "HEAD", cache: "no-store" });
      return response.ok;
    } catch {
      return false;
    }
  }

  function applyPrimaryLink({ href, installerName, external }) {
    const { primaryLink } = getDownloadElements();
    if (!primaryLink || !href) return;

    primaryLink.href = href;
    if (external) {
      primaryLink.removeAttribute("download");
      primaryLink.setAttribute("target", "_blank");
      primaryLink.setAttribute("rel", "noopener noreferrer");
    } else {
      primaryLink.setAttribute("download", installerName || "");
      primaryLink.removeAttribute("target");
      primaryLink.removeAttribute("rel");
    }
  }

  async function syncDownloadAvailability(manifest) {
    if (isDesktopRuntime()) return;

    const { primaryLink } = getDownloadElements();
    if (!primaryLink) return;

    const githubInstall = await resolveGitHubInstaller(manifest);
    if (githubInstall?.href) {
      applyPrimaryLink({
        href: githubInstall.href,
        installerName: githubInstall.installerName,
        external: true,
      });
      primaryLink.classList.remove("is-unavailable");
      primaryLink.setAttribute("aria-disabled", "false");
      setDownloadStatus("");
      return;
    }

    const installerName = String(manifest?.installer || DESKTOP_INSTALLER_FALLBACK).trim();
    const manifestUrl = String(manifest?.installerUrl || "").trim();
    const localHref = `./downloads/${installerName}`;
    const href = manifestUrl || localHref;
    const external = isExternalInstallerHref(href);

    applyPrimaryLink({ href, installerName, external });

    const available = external ? false : await probeSameOriginInstaller(href);
    primaryLink.classList.toggle("is-unavailable", !available);
    primaryLink.setAttribute("aria-disabled", available ? "false" : "true");

    if (available) {
      setDownloadStatus("");
      return;
    }

    const tag = releaseTagFromManifest(manifest);
    setDownloadStatus(
      `No GitHub release found for ${tag || "this version"} yet. Open Actions → Desktop Release → Run workflow, or push tag ${tag || "v1.0.0"} after merging the workflow file.`,
      { tone: "warn" },
    );
  }

  async function initDesktopDownloadPage() {
    const els = getDownloadElements();
    const manifest = await fetchPublishedDesktopManifest();
    const githubInstall = await resolveGitHubInstaller(manifest);
    const version = String(githubInstall?.version || manifest?.version || DESKTOP_APP_VERSION).trim();

    els.versionEls?.forEach((node) => {
      node.textContent = version;
    });

    if (githubInstall?.href) {
      applyPrimaryLink({
        href: githubInstall.href,
        installerName: githubInstall.installerName,
        external: true,
      });
    } else if (els.primaryLink) {
      const installerName = String(manifest?.installer || `Morning-Roast-Setup-${version}.exe`).trim();
      const href = String(manifest?.installerUrl || `./downloads/${installerName}`).trim();
      applyPrimaryLink({
        href,
        installerName,
        external: isExternalInstallerHref(href),
      });
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
    getDownloadHref: () => `./downloads/${DESKTOP_INSTALLER_FALLBACK}`,
    getVersion: () => DESKTOP_APP_VERSION,
    isDesktopRuntime,
  };
})(window);
