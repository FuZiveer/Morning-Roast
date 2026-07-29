const { contextBridge, ipcRenderer } = require("electron");
const pkg = require("./package.json");

let initialStorage = {};
try {
  initialStorage = ipcRenderer.sendSync("desktop-storage-get-sync") || {};
} catch {
  initialStorage = {};
}

contextBridge.exposeInMainWorld("__MR_DESKTOP_STORAGE__", initialStorage);

contextBridge.exposeInMainWorld("MorningRoastDesktop", {
  isDesktop: true,
  platform: process.platform,
  appVersion: pkg.version,
  electronVersion: process.versions.electron,
  checkForUpdates() {
    ipcRenderer.send("desktop-check-updates");
  },
  installUpdate() {
    ipcRenderer.send("desktop-install-update");
  },
  reloadApp() {
    ipcRenderer.send("desktop-reload-app");
  },
  getLoadInfo() {
    return ipcRenderer.invoke("desktop-get-load-mode");
  },
  saveStorage(data) {
    return ipcRenderer.invoke("desktop-storage-save", data);
  },
  importStorage(data) {
    return ipcRenderer.invoke("desktop-storage-merge", data);
  },
  setAimTrainerActive(active) {
    ipcRenderer.send("desktop-set-aim-trainer-active", Boolean(active));
  },
  onUpdateStatus(callback) {
    if (typeof callback !== "function") return () => {};
    const listener = (_event, payload) => callback(payload || {});
    ipcRenderer.on("desktop-update-status", listener);
    return () => ipcRenderer.removeListener("desktop-update-status", listener);
  },
});
