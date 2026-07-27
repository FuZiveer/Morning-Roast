const fs = require("fs");
const { resolveDataRoot } = require("./safe-json-file");
const { resolveHistoryPath } = require("./chat-history-store");
const { resolveDmHistoryPath } = require("./dm-history-store");
const { resolveStorePath, resolveUploadsDir } = require("./lineup-submissions-store");
const { resolveCommentsPath } = require("./lineup-comments-store");

function logPersistedDataPaths() {
  const dataRoot = resolveDataRoot();
  const paths = [
    ["DATA_DIR", dataRoot],
    ["CHAT_HISTORY_PATH", resolveHistoryPath()],
    ["CHAT_DM_HISTORY_PATH", resolveDmHistoryPath()],
    ["LINEUP_SUBMISSIONS_PATH", resolveStorePath()],
    ["LINEUP_UPLOADS_DIR", resolveUploadsDir()],
    ["LINEUP_COMMENTS_PATH", resolveCommentsPath()],
  ];

  console.info("[data-persist] User data paths:");
  for (const [label, targetPath] of paths) {
    let status = "missing";
    try {
      if (fs.existsSync(targetPath)) {
        status = fs.statSync(targetPath).isDirectory() ? "directory" : "file";
      }
    } catch {
      status = "unreadable";
    }
    console.info(`  ${label}: ${targetPath} (${status})`);
  }

  if (!process.env.DATA_DIR && !process.env.RENDER_EXTERNAL_HOSTNAME) {
    console.info("[data-persist] Local dev mode — data is stored under ./data");
    return;
  }

  if (!process.env.DATA_DIR) {
    console.warn(
      "[data-persist] DATA_DIR is not set. Server redeploys may wipe chat history, lineup videos, and comments unless a persistent disk is mounted.",
    );
  }
}

module.exports = { logPersistedDataPaths };
