const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const FILE_NAME = "user-storage.json";

function getFilePath() {
  return path.join(app.getPath("userData"), FILE_NAME);
}

function load() {
  try {
    const raw = fs.readFileSync(getFilePath(), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function save(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const filePath = getFilePath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data), "utf8");
  return true;
}

function merge(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return load();
  const next = { ...load(), ...patch };
  save(next);
  return next;
}

module.exports = {
  load,
  save,
  merge,
};
