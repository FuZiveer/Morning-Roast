const { app, BrowserWindow, shell, Menu, ipcMain, net } = require("electron");
const path = require("path");
const pkg = require("./package.json");
const config = require("./config");
const { startStaticServer } = require("./static-server");
const { initAutoUpdater, checkForAppUpdates, installPendingUpdate, disposeAutoUpdater } = require("./updater");

const isDev = !app.isPackaged;
let mainWindow = null;
let staticServer = null;
let appOrigin = "";
let loadMode = "local";

function resolveWebRoot() {
  if (isDev) return path.join(__dirname, "..");
  return path.join(process.resourcesPath, "app");
}

function normalizeRemoteUrl() {
  const base = String(config.REMOTE_APP_URL || "").trim();
  if (!base) return "";
  return base.endsWith("/") ? base : `${base}/`;
}

function canReachRemote(url) {
  return new Promise((resolve) => {
    const target = String(url || "").trim();
    if (!target) {
      resolve(false);
      return;
    }

    const request = net.request({ method: "HEAD", url: target });
    const timeout = setTimeout(() => {
      request.abort();
      resolve(false);
    }, config.REMOTE_REACH_TIMEOUT_MS);

    request.on("response", (response) => {
      clearTimeout(timeout);
      resolve(response.statusCode >= 200 && response.statusCode < 400);
    });

    request.on("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });

    request.end();
  });
}

async function startLocalAppOrigin() {
  const webRoot = resolveWebRoot();
  const started = await startStaticServer(webRoot);
  staticServer = started.server;
  return started.origin;
}

async function resolveStartupTarget() {
  if (isDev) {
    const origin = await startLocalAppOrigin();
    loadMode = "local";
    appOrigin = origin;
    return `${origin}/index.html`;
  }

  const remoteBase = normalizeRemoteUrl();
  const remoteReachable = remoteBase ? await canReachRemote(remoteBase) : false;
  if (remoteReachable) {
    loadMode = "remote";
    appOrigin = new URL(remoteBase).origin;
    return new URL("index.html", remoteBase).href;
  }

  const origin = await startLocalAppOrigin();
  loadMode = "local-fallback";
  appOrigin = origin;
  return `${origin}/index.html`;
}

async function fallbackToLocalContent() {
  if (loadMode === "local-fallback" || loadMode === "local") return false;
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  if (!staticServer) {
    appOrigin = await startLocalAppOrigin();
  }

  loadMode = "local-fallback";
  await mainWindow.loadURL(`${appOrigin}/index.html`);
  mainWindow.webContents.send("desktop-update-status", {
    state: "offline-fallback",
    message: "Live site unavailable — using bundled Morning Roast copy.",
  });
  return true;
}

function createAppMenu() {
  const template = [
    {
      label: "File",
      submenu: [{ role: "quit", label: "Exit Morning Roast" }],
    },
    {
      label: "View",
      submenu: [
        { role: "reload", label: "Reload" },
        { role: "forceReload", label: "Force reload" },
        { type: "separator" },
        { role: "resetZoom", label: "Actual size" },
        { role: "zoomIn", label: "Zoom in" },
        { role: "zoomOut", label: "Zoom out" },
        { type: "separator" },
        { role: "togglefullscreen", label: "Toggle fullscreen" },
        { type: "separator" },
        { role: "toggleDevTools", label: "Developer tools" },
      ],
    },
    {
      label: "Tools",
      submenu: [
        {
          label: "Sensitivity converter",
          click: () => navigateToHash("sensitivity-converter-tab"),
        },
        {
          label: "Crosshair converter",
          click: () => navigateToHash("crosshair-converter-tab"),
        },
        {
          label: "Aim trainer",
          click: () => navigateToHash("aim-training-tab"),
        },
        {
          label: "eDPI calculator",
          click: () => navigateToHash("edpi-calculator-tab"),
        },
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "Check for updates",
          click: () => {
            void checkForAppUpdates({ userInitiated: true });
          },
        },
        {
          label: "Morning Roast website",
          click: () => shell.openExternal(normalizeRemoteUrl() || "https://morningroast.net/"),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function navigateToHash(tabId) {
  if (!mainWindow) return;
  const id = String(tabId || "").replace(/^#/, "");
  if (!id) return;
  mainWindow.webContents.executeJavaScript(
    `(function () {
      if (typeof switchTab === "function") {
        switchTab(null, ${JSON.stringify(id)});
      }
    })();`,
  );
}

function shouldOpenExternally(url) {
  if (!url) return false;
  if (url.startsWith("about:blank")) return false;
  if (appOrigin && url.startsWith(appOrigin)) return false;
  if (url.startsWith("http://127.0.0.1:") || url.startsWith("http://localhost:")) return false;
  return /^https?:/i.test(url);
}

function registerIpcHandlers() {
  ipcMain.handle("desktop-get-load-mode", () => ({
    mode: loadMode,
    appVersion: pkg.version,
    remoteUrl: normalizeRemoteUrl(),
  }));

  ipcMain.on("desktop-check-updates", () => {
    void checkForAppUpdates({ userInitiated: true });
  });

  ipcMain.on("desktop-install-update", () => {
    installPendingUpdate();
  });

  ipcMain.on("desktop-reload-app", () => {
    mainWindow?.webContents?.reload();
  });

  ipcMain.on("desktop-open-downloads", () => {
    const url = new URL("./", normalizeRemoteUrl() || "https://morningroast.net/").href;
    shell.openExternal(`${url}download`);
  });
}

async function createMainWindow() {
  const webRoot = resolveWebRoot();
  const startupUrl = await resolveStartupTarget();

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    autoHideMenuBar: false,
    title: "Morning Roast",
    backgroundColor: "#0d0d0d",
    icon: path.join(webRoot, "assets", "logo.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (shouldOpenExternally(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (shouldOpenExternally(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("did-fail-load", (_event, errorCode, _description, validatedURL) => {
    if (errorCode === -3) return;
    if (loadMode !== "remote") return;
    if (!String(validatedURL || "").startsWith(normalizeRemoteUrl())) return;
    void fallbackToLocalContent();
  });

  await mainWindow.loadURL(startupUrl);
  initAutoUpdater(mainWindow, { isDev });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    registerIpcHandlers();
    createAppMenu();
    try {
      await createMainWindow();
    } catch (error) {
      console.error("Failed to start Morning Roast desktop app:", error);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    disposeAutoUpdater();
    if (staticServer) staticServer.close();
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      try {
        await createMainWindow();
      } catch (error) {
        console.error("Failed to reopen Morning Roast desktop app:", error);
      }
    }
  });
}
