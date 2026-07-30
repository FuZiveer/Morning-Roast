(function initDesktopStorage(global) {
  const desktop = global.MorningRoastDesktop;
  if (!desktop?.isDesktop) return;

  const FLUSH_DEBOUNCE_MS = 700;
  const CRITICAL_STORAGE_KEYS = new Set([
    "profileDisplayName",
    "profileBio",
    "profileAvatarImage",
    "profileSetupComplete",
    "morningRoastChatAuthorId",
  ]);
  let flushTimer = null;
  let patching = false;

  function dumpLocalStorage() {
    const data = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key != null) data[key] = localStorage.getItem(key);
    }
    return data;
  }

  function scheduleFlush() {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flushNow();
    }, FLUSH_DEBOUNCE_MS);
  }

  async function flushNow() {
    if (typeof desktop.saveStorage !== "function") return;
    try {
      await desktop.saveStorage(dumpLocalStorage());
    } catch {
      /* ignore persistence errors */
    }
  }

  function applyStorage(data, { replace = false } = {}) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return;
    patching = true;
    try {
      if (replace) localStorage.clear();
      Object.entries(data).forEach(([key, value]) => {
        if (value == null) return;
        localStorage.setItem(key, String(value));
      });
    } finally {
      patching = false;
    }
  }

  function patchLocalStorage() {
    const proto = Storage.prototype;
    const originalSetItem = proto.setItem;
    const originalRemoveItem = proto.removeItem;
    const originalClear = proto.clear;

    proto.setItem = function setItem(key, value) {
      originalSetItem.call(this, key, value);
      if (!patching) {
        if (CRITICAL_STORAGE_KEYS.has(String(key))) void flushNow();
        else scheduleFlush();
      }
    };

    proto.removeItem = function removeItem(key) {
      originalRemoveItem.call(this, key);
      if (!patching) scheduleFlush();
    };

    proto.clear = function clear() {
      originalClear.call(this);
      if (!patching) scheduleFlush();
    };
  }

  function downloadJson(filename, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function exportSettings() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      origin: global.location?.origin || "",
      data: dumpLocalStorage(),
    };
    downloadJson(`morning-roast-backup-${Date.now()}.json`, payload);
    return payload;
  }

  async function importSettingsFromObject(raw, { merge = true } = {}) {
    const source = raw?.data && typeof raw.data === "object" ? raw.data : raw;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error("Invalid backup file.");
    }
    applyStorage(source, { replace: !merge });
    if (typeof desktop.importStorage === "function") {
      await desktop.importStorage(source);
    } else {
      await flushNow();
    }
    return Object.keys(source).length;
  }

  function importSettingsFromFile(file, options) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(String(reader.result || "{}"));
          const count = await importSettingsFromObject(parsed, options);
          resolve(count);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = () => reject(reader.error || new Error("Could not read backup file."));
      reader.readAsText(file);
    });
  }

  patchLocalStorage();

  global.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushNow();
  });
  global.addEventListener("pagehide", () => {
    void flushNow();
  });

  global.MorningRoastStorageBackup = {
    dumpLocalStorage,
    applyStorage,
    exportSettings,
    importSettingsFromFile,
    importSettingsFromObject,
    flushNow,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      void flushNow();
    });
  } else {
    void flushNow();
  }
})(window);

(function initStorageBackupUi(global) {
  const exportBtn = document.getElementById("storage-backup-export-btn");
  const importBtn = document.getElementById("storage-backup-import-btn");
  const importInput = document.getElementById("storage-backup-import-input");
  const statusEl = document.getElementById("storage-backup-status");

  if (!exportBtn && !importBtn) return;

  function setStatus(message, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.hidden = !message;
    statusEl.classList.toggle("is-error", isError);
  }

  exportBtn?.addEventListener("click", () => {
    try {
      global.MorningRoastStorageBackup?.exportSettings?.();
      setStatus("Backup downloaded.");
    } catch (error) {
      setStatus(error?.message || "Export failed.", true);
    }
  });

  importBtn?.addEventListener("click", () => {
    importInput?.click();
  });

  importInput?.addEventListener("change", async () => {
    const file = importInput.files?.[0];
    importInput.value = "";
    if (!file) return;
    try {
      const count = await global.MorningRoastStorageBackup.importSettingsFromFile(file, { merge: true });
      setStatus(`Imported ${count} saved settings. Reloading…`);
      global.setTimeout(() => global.location.reload(), 450);
    } catch (error) {
      setStatus(error?.message || "Import failed.", true);
    }
  });
})(window);
