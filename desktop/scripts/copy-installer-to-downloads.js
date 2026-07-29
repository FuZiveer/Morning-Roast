const fs = require("fs");
const path = require("path");

const version = require("../package.json").version;
const webCacheVersion = readWebCacheVersion();
const installerName = `Morning-Roast-Setup-${version}.exe`;
const distDir = path.join(__dirname, "..", "dist");
const targetDir = path.join(__dirname, "..", "..", "downloads");
const source = path.join(distDir, installerName);
const target = path.join(targetDir, installerName);

function readWebCacheVersion() {
  try {
    const scriptSource = fs.readFileSync(path.join(__dirname, "..", "..", "script.js"), "utf8");
    return scriptSource.match(/APP_CACHE_VERSION\s*=\s*"([^"]+)"/)?.[1] || "";
  } catch {
    return "";
  }
}

function copyIfExists(fileName) {
  const from = path.join(distDir, fileName);
  if (!fs.existsSync(from)) return false;
  fs.copyFileSync(from, path.join(targetDir, fileName));
  console.log(`Copied ${fileName} → downloads/`);
  return true;
}

if (!fs.existsSync(source)) {
  console.error(`Installer not found: ${source}`);
  console.error("Run npm run dist first.");
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log(`Copied ${installerName} → downloads/`);

copyIfExists("latest.yml");
copyIfExists(`${installerName}.blockmap`);

const manifest = {
  version,
  webCacheVersion,
  installer: installerName,
  updatedAt: new Date().toISOString(),
};

fs.writeFileSync(path.join(targetDir, "desktop-version.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log("Wrote downloads/desktop-version.json");
