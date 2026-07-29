const { autoUpdater } = require("electron-updater");
const config = require("./config");

let mainWindow = null;
let checkTimer = null;

function sendStatus(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("desktop-update-status", payload);
}

function initAutoUpdater(window, { isDev = false } = {}) {
  mainWindow = window;
  if (isDev) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on("checking-for-update", () => {
    sendStatus({ state: "checking" });
  });

  autoUpdater.on("update-available", (info) => {
    sendStatus({
      state: "available",
      version: info.version,
      message: `Morning Roast ${info.version} is downloading…`,
    });
  });

  autoUpdater.on("update-not-available", (info) => {
    sendStatus({
      state: "idle",
      version: info?.version || "",
      message: "You're on the latest desktop build.",
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendStatus({
      state: "downloading",
      percent: Math.round(progress.percent || 0),
      message: `Downloading update… ${Math.round(progress.percent || 0)}%`,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    sendStatus({
      state: "ready",
      version: info.version,
      message: `Morning Roast ${info.version} is ready. Restart to finish updating.`,
    });
  });

  autoUpdater.on("error", (error) => {
    sendStatus({
      state: "error",
      message: error?.message || "Could not check for desktop updates.",
    });
  });

  void checkForAppUpdates({ userInitiated: false });

  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(() => {
    void checkForAppUpdates({ userInitiated: false });
  }, config.APP_UPDATE_CHECK_INTERVAL_MS);
}

async function checkForAppUpdates({ userInitiated = true } = {}) {
  if (process.env.NODE_ENV === "development") {
    if (userInitiated) {
      sendStatus({ state: "idle", message: "Updates are disabled in development builds." });
    }
    return;
  }

  try {
    await autoUpdater.checkForUpdates();
  } catch (error) {
    if (userInitiated) {
      sendStatus({
        state: "error",
        message: error?.message || "Could not reach the update server.",
      });
    }
  }
}

function installPendingUpdate() {
  autoUpdater.quitAndInstall(false, true);
}

function disposeAutoUpdater() {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = null;
  mainWindow = null;
}

module.exports = {
  initAutoUpdater,
  checkForAppUpdates,
  installPendingUpdate,
  disposeAutoUpdater,
};
