/** Desktop app download page — Windows installer link + in-app detection. */
(function (global) {
  const DESKTOP_APP_VERSION = "1.0.0";
  const DESKTOP_INSTALLER_FALLBACK = `Morning-Roast-Setup-${DESKTOP_APP_VERSION}.exe`;
  const GITHUB_REPO = "FuZiveer/Morning-Roast";
  const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO}/releases`;
  const GITHUB_RELEASE_ACTION_URL = `https://github.com/${GITHUB_REPO}/actions/workflows/desktop-release.yml`;

  let cachedGitHubLookup = null;

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

  async function fetchGitHubReleases() {
    try {
      const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases`, {
        headers: { Accept: "application/vnd.github+json" },
        cache: "no-store",
      });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function pickRelease(releases, tag) {
    if (!Array.isArray(releases) || !releases.length) return null;
    const normalizedTag = String(tag || "").trim();
    if (normalizedTag) {
      const tagged = releases.find((release) => release?.tag_name === normalizedTag);
      if (tagged) return tagged;
    }
    return releases[0] || null;
  }

  function pickInstallerAsset(release, preferredName = "") {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    const preferred = String(preferredName || "").trim();
    if (preferred) {
      const exact = assets.find((asset) => asset?.name === preferred);
      if (exact?.browser_download_url) return exact;
    }
    return (
      assets.find(
        (asset) =>
          /\.exe$/i.test(String(asset?.name || "")) &&
          /Morning-Roast-Setup/i.test(String(asset?.name || "")),
      ) || null
    );
  }

  async function resolveGitHubInstaller(manifest) {
    if (cachedGitHubLookup) return cachedGitHubLookup;

    const releases = await fetchGitHubReleases();
    const release = pickRelease(releases, releaseTagFromManifest(manifest));
    if (!release) {
      cachedGitHubLookup = { available: false, releases: [] };
      return cachedGitHubLookup;
    }

    const installerName = String(manifest?.installer || DESKTOP_INSTALLER_FALLBACK).trim();
    const asset = pickInstallerAsset(release, installerName);
    if (!asset?.browser_download_url) {
      cachedGitHubLookup = { available: false, releases };
      return cachedGitHubLookup;
    }

    cachedGitHubLookup = {
      available: true,
      href: asset.browser_download_url,
      version:
        String(release.tag_name || "").replace(/^v/i, "") ||
        String(manifest?.version || DESKTOP_APP_VERSION),
      installerName: asset.name || installerName,
      tag: release.tag_name || releaseTagFromManifest(manifest),
    };
    return cachedGitHubLookup;
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

  function setPrimaryLinkState({ href, installerName, external, available }) {
    const { primaryLink } = getDownloadElements();
    if (!primaryLink) return;

    if (href) primaryLink.href = href;
    primaryLink.classList.toggle("is-unavailable", !available);
    primaryLink.setAttribute("aria-disabled", available ? "false" : "true");

    if (external && available) {
      primaryLink.removeAttribute("download");
      primaryLink.setAttribute("target", "_blank");
      primaryLink.setAttribute("rel", "noopener noreferrer");
      return;
    }

    primaryLink.removeAttribute("target");
    primaryLink.removeAttribute("rel");
    if (available && installerName && !external) {
      primaryLink.setAttribute("download", installerName);
    } else {
      primaryLink.removeAttribute("download");
    }
  }

  async function syncDownloadAvailability(manifest, githubInstall) {
    if (isDesktopRuntime()) return;

    const lookup = githubInstall || (await resolveGitHubInstaller(manifest));
    const tag = releaseTagFromManifest(manifest);

    if (lookup?.available && lookup.href) {
      setPrimaryLinkState({
        href: lookup.href,
        installerName: lookup.installerName,
        external: true,
        available: true,
      });
      setDownloadStatus("");
      return;
    }

    const installerName = String(manifest?.installer || DESKTOP_INSTALLER_FALLBACK).trim();
    const localHref = `./downloads/${installerName}`;
    const localAvailable = await probeSameOriginInstaller(localHref);

    if (localAvailable) {
      setPrimaryLinkState({
        href: localHref,
        installerName,
        external: false,
        available: true,
      });
      setDownloadStatus("");
      return;
    }

    setPrimaryLinkState({
      href: GITHUB_RELEASE_ACTION_URL,
      installerName,
      external: true,
      available: false,
    });

    setDownloadStatus(
      lookup?.releases?.length
        ? `Release ${tag} is not published yet. Open GitHub Actions → Desktop Release → Run workflow to build and upload the Windows installer.`
        : `No desktop release on GitHub yet. Open GitHub Actions → Desktop Release → Run workflow once to publish ${tag || "v1.0.0"}.`,
      { tone: "warn" },
    );
  }

  async function initDesktopDownloadPage() {
    cachedGitHubLookup = null;
    const els = getDownloadElements();
    const manifest = await fetchPublishedDesktopManifest();
    const githubInstall = await resolveGitHubInstaller(manifest);
    const version = String(
      githubInstall?.version || manifest?.version || DESKTOP_APP_VERSION,
    ).trim();

    els.versionEls?.forEach((node) => {
      node.textContent = version;
    });

    if (isDesktopRuntime()) {
      setDownloadNavVisible(false);
      els.runtimePanel?.removeAttribute("hidden");
      els.webPanel?.setAttribute("hidden", "");
      return;
    }

    setDownloadNavVisible(true);
    els.runtimePanel?.setAttribute("hidden", "");
    els.webPanel?.removeAttribute("hidden");
    await syncDownloadAvailability(manifest, githubInstall);
  }

  global.MorningRoastDesktopDownload = {
    init: initDesktopDownloadPage,
    refreshAvailability: async () => {
      cachedGitHubLookup = null;
      const manifest = await fetchPublishedDesktopManifest();
      await syncDownloadAvailability(manifest);
    },
    getDownloadHref: () => `./downloads/${DESKTOP_INSTALLER_FALLBACK}`,
    getVersion: () => DESKTOP_APP_VERSION,
    getReleasesUrl: () => GITHUB_RELEASES_URL,
    isDesktopRuntime,
  };
})(window);
