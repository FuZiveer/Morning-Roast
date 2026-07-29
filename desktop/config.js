/** Desktop app URLs and update intervals (override via env for staging). */
module.exports = {
  REMOTE_APP_URL: process.env.MORNING_ROAST_APP_URL || "https://morningroast.net/",
  UPDATE_FEED_URL: process.env.MORNING_ROAST_UPDATE_URL || "https://morningroast.net/downloads",
  REMOTE_REACH_TIMEOUT_MS: 5000,
  WEB_VERSION_CHECK_INTERVAL_MS: 10 * 60 * 1000,
  APP_UPDATE_CHECK_INTERVAL_MS: 4 * 60 * 60 * 1000,
};
