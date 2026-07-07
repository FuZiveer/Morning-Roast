/** Game registry with per-game yaw (mouse-sensitivity.com reference values). */
(function (global) {
  const DEFAULT_FOV = 90;

  /** @type {Record<string, { yaw: number, fov?: number, multiplier: number }>} */
  const GAME_REGISTRY = Object.freeze({
    Aimlabs: { yaw: 0.05, fov: 103, multiplier: 1.4 },
    "Apex Legends": { yaw: 0.022, fov: 90, multiplier: 3.18 },
    "ARC Raiders": { yaw: 0.00136, fov: 90, multiplier: 51.43 },
    "Black Ops 7": { yaw: 0.0066, fov: 103, multiplier: 10.61 },
    CS2: { yaw: 0.022, fov: 90, multiplier: 3.18 },
    "Delta Force": { yaw: 0.01, fov: 103, multiplier: 7 },
    "Escape from Tarkov": { yaw: 0.125, fov: 90, multiplier: 0.56 },
    Fortnite: { yaw: 0.005555, fov: 103, multiplier: 12.6 },
    "Marvel Rivals": { yaw: 0.022, fov: 103, multiplier: 4.0 },
    Overwatch: { yaw: 0.0066, fov: 103, multiplier: 10.61 },
    "osu!": { yaw: 0.0795, fov: 90, multiplier: 0.88 },
    "Rainbow 6 Siege": { yaw: 0.00572958, fov: 90, multiplier: 12.22 },
    Roblox: { yaw: 0.3888, fov: 90, multiplier: 0.18 },
    Rust: { yaw: 0.1129, fov: 90, multiplier: 0.62 },
    Valorant: { yaw: 0.07, fov: 103, multiplier: 1 },
  });

  const GAME_ALIASES = Object.freeze({
    "call of duty: black ops 6": "Black Ops 7",
    "call of duty: black ops 7": "Black Ops 7",
    "black ops 6/7": "Black Ops 7",
    "call of duty: black ops 6/7": "Black Ops 7",
    "counter-strike 2": "CS2",
    "escape from tarkov": "Escape from Tarkov",
    "overwatch 2": "Overwatch",
    "rainbow six siege": "Rainbow 6 Siege",
  });

  function resolveGameName(game) {
    if (game == null) return null;
    const trimmed = String(game).trim();
    if (!trimmed) return null;
    if (GAME_REGISTRY[trimmed]) return trimmed;
    const lower = trimmed.toLowerCase();
    if (GAME_ALIASES[lower]) return GAME_ALIASES[lower];
    for (const name of Object.keys(GAME_REGISTRY)) {
      if (name.toLowerCase() === lower) return name;
    }
    return null;
  }

  function getGameYaw(game) {
    const resolved = resolveGameName(game);
    return resolved ? GAME_REGISTRY[resolved].yaw : null;
  }

  const GAME_MULTIPLIERS = Object.freeze(Object.fromEntries(Object.entries(GAME_REGISTRY).map(([name, entry]) => [name, entry.multiplier])));

  function getGameMultiplier(game) {
    const resolved = resolveGameName(game);
    return resolved ? GAME_MULTIPLIERS[resolved] : null;
  }

  function getGameConversionFactor(game) {
    return getGameMultiplier(game);
  }

  function convertSensitivity(fromSens, fromGame, toGame, fromDpi = 1, toDpi = 1) {
    const from = resolveGameName(fromGame);
    const to = resolveGameName(toGame);
    const sens = Number(fromSens);
    const fDpi = Number(fromDpi);
    const tDpi = Number(toDpi);
    const fromMult = from ? GAME_MULTIPLIERS[from] : null;
    const toMult = to ? GAME_MULTIPLIERS[to] : null;
    if (!from || !to || fromMult == null || toMult == null) return null;
    if (!Number.isFinite(sens) || sens <= 0) return null;
    if (!Number.isFinite(fDpi) || !Number.isFinite(tDpi) || fDpi <= 0 || tDpi <= 0) return null;
    return sens * (toMult / fromMult) * (fDpi / tDpi);
  }

  function buildTrainerConfigs() {
    const configs = {};
    for (const [name, entry] of Object.entries(GAME_REGISTRY)) {
      configs[name] = {
        constant: entry.yaw,
        fov: entry.fov ?? DEFAULT_FOV,
      };
    }
    return Object.freeze(configs);
  }

  const SUPPORTED_GAMES = Object.freeze(Object.keys(GAME_REGISTRY).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));

  global.MorningRoastGames = Object.freeze({
    GAME_REGISTRY,
    GAME_ALIASES,
    GAME_MULTIPLIERS,
    SUPPORTED_GAMES,
    resolveGameName,
    getGameYaw,
    getGameMultiplier,
    getGameConversionFactor,
    convertSensitivity,
    buildTrainerConfigs,
  });
})(typeof window !== "undefined" ? window : globalThis);
