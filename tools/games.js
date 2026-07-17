/** Game registry with per-game yaw (mouse-sensitivity.com reference values). */
(function (global) {
  const DEFAULT_FOV = 90;

  /** cm/360 tier bands + recommended ranges by genre. */
  const SENS_PROFILES = Object.freeze({
    tactical: Object.freeze({
      highBelow: 40,
      lowAbove: 55,
      recommendedMin: 40,
      recommendedMax: 60,
      why: "Slow settings stop your crosshair from shaking during small micro-adjustments.",
      proExample: "Most Valorant and CS2 pros use roughly 45–50 cm/360.",
    }),
    arena: Object.freeze({
      highBelow: 25,
      lowAbove: 35,
      recommendedMin: 25,
      recommendedMax: 35,
      why: "Fast settings help you track flying targets and spin 180 degrees quickly.",
      proExample: "Overwatch 2 pros playing Tracer or Genji lean closer to 24–28 cm/360.",
    }),
    battle_royale: Object.freeze({
      highBelow: 30,
      lowAbove: 45,
      recommendedMin: 30,
      recommendedMax: 45,
      why: "Moderate settings let you balance close-range shotgun fights with mid-range rifle tracking.",
      proExample: "Apex Legends and Call of Duty players heavily favor roughly 34–38 cm/360.",
    }),
  });

  /** @type {Record<string, { yaw: number, fov?: number, multiplier: number, genre: keyof typeof SENS_PROFILES }>} */
  const GAME_REGISTRY = Object.freeze({
    Aimlabs: { yaw: 0.05, fov: 103, multiplier: 1.4, genre: "arena" },
    "Apex Legends": { yaw: 0.022, fov: 90, multiplier: 3.18, genre: "arena" },
    "ARC Raiders": { yaw: 0.00136, fov: 90, multiplier: 51.43, genre: "battle_royale" },
    "Black Ops 7": { yaw: 0.0066, fov: 103, multiplier: 10.61, genre: "battle_royale" },
    CS2: { yaw: 0.022, fov: 90, multiplier: 3.18, genre: "tactical" },
    "Delta Force": { yaw: 0.01, fov: 103, multiplier: 7, genre: "tactical" },
    "Escape from Tarkov": { yaw: 0.125, fov: 90, multiplier: 0.56, genre: "tactical" },
    Fortnite: { yaw: 0.005555, fov: 103, multiplier: 12.6, genre: "battle_royale" },
    "Marvel Rivals": { yaw: 0.022, fov: 103, multiplier: 4.0, genre: "arena" },
    Overwatch: { yaw: 0.0066, fov: 103, multiplier: 10.61, genre: "arena" },
    "osu!": { yaw: 0.0795, fov: 90, multiplier: 0.88, genre: "arena" },
    "Rainbow 6 Siege": { yaw: 0.00572958, fov: 90, multiplier: 12.22, genre: "tactical" },
    Roblox: { yaw: 0.3888, fov: 90, multiplier: 0.18, genre: "battle_royale" },
    Rust: { yaw: 0.1129, fov: 90, multiplier: 0.62, genre: "battle_royale" },
    Valorant: { yaw: 0.07, fov: 103, multiplier: 1, genre: "tactical" },
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

  const GAME_DISPLAY_NAMES = Object.freeze({
    CS2: "Counter-Strike 2",
    Overwatch: "Overwatch 2",
    "Rainbow 6 Siege": "Rainbow Six Siege",
    "Black Ops 7": "Call of Duty: Black Ops 7",
  });

  function getGameDisplayName(game) {
    const resolved = resolveGameName(game);
    if (!resolved) return game == null ? "" : String(game).trim();
    return GAME_DISPLAY_NAMES[resolved] || resolved;
  }

  /** Match only the label shown in dropdowns (not internal keys or aliases). */
  function resolveGameFromDisplayName(label) {
    if (label == null) return null;
    const trimmed = String(label).trim();
    if (!trimmed) return null;
    const lower = trimmed.toLowerCase();
    for (const name of Object.keys(GAME_REGISTRY)) {
      const display = (GAME_DISPLAY_NAMES[name] || name).toLowerCase();
      if (display === lower) return name;
    }
    return null;
  }

  function resolveGameName(game) {
    if (game == null) return null;
    const trimmed = String(game).trim();
    if (!trimmed) return null;
    if (GAME_REGISTRY[trimmed]) return trimmed;
    const fromDisplay = resolveGameFromDisplayName(trimmed);
    if (fromDisplay) return fromDisplay;
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

  function getGameSensProfile(game) {
    const resolved = resolveGameName(game);
    if (!resolved) return null;
    return SENS_PROFILES[GAME_REGISTRY[resolved].genre] || SENS_PROFILES.battle_royale;
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
    GAME_DISPLAY_NAMES,
    GAME_MULTIPLIERS,
    SENS_PROFILES,
    SUPPORTED_GAMES,
    resolveGameName,
    resolveGameFromDisplayName,
    getGameDisplayName,
    getGameYaw,
    getGameSensProfile,
    getGameMultiplier,
    getGameConversionFactor,
    convertSensitivity,
    buildTrainerConfigs,
  });
})(typeof window !== "undefined" ? window : globalThis);
