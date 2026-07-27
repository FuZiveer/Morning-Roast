const fs = require("fs");
const path = require("path");

function readJsonFile(filePath, defaultValue, label = "JSON file") {
  if (!fs.existsSync(filePath)) {
    return { data: defaultValue, source: "missing" };
  }

  const tryParse = (targetPath) => {
    const raw = fs.readFileSync(targetPath, "utf8");
    return JSON.parse(raw);
  };

  try {
    return { data: tryParse(filePath), source: "primary" };
  } catch (primaryError) {
    const backupPath = `${filePath}.bak`;
    if (fs.existsSync(backupPath)) {
      try {
        const data = tryParse(backupPath);
        console.warn(`[data-persist] Restored ${label} from backup: ${backupPath}`);
        return { data, source: "backup", primaryError };
      } catch (backupError) {
        console.warn(`[data-persist] Backup unreadable for ${label}:`, backupError.message);
      }
    }
    console.warn(`[data-persist] Failed to load ${label} from ${filePath}:`, primaryError.message);
    return { data: defaultValue, source: "failed", primaryError };
  }
}

function writeJsonFile(filePath, data, label = "JSON file") {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(data, null, 0);
  const tempPath = `${filePath}.tmp`;
  const backupPath = `${filePath}.bak`;

  if (fs.existsSync(filePath)) {
    try {
      fs.copyFileSync(filePath, backupPath);
    } catch (error) {
      console.warn(`[data-persist] Could not backup ${label} before save:`, error.message);
    }
  }

  fs.writeFileSync(tempPath, payload, "utf8");
  fs.renameSync(tempPath, filePath);
}

function resolveDataRoot() {
  const configured = String(process.env.DATA_DIR || "").trim();
  if (!configured) return path.join(process.cwd(), "data");
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function resolveDataFile(relativeName, envKey) {
  const configured = String(process.env[envKey] || "").trim();
  if (configured) {
    return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
  }
  return path.join(resolveDataRoot(), relativeName);
}

module.exports = { readJsonFile, writeJsonFile, resolveDataRoot, resolveDataFile };
