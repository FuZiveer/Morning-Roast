/** Morning Roast — site action registry, intent parsing, and live state for the AI assistant. */
(function (global) {
  const TAB_SIDEBAR = {
    "sensitivity-converter-tab": { sidebarButtonId: "sidebar-sensitivity-converter-button" },
    "edpi-calculator-tab": { sidebarButtonId: "sidebar-edpi-calculator-button" },
    "settings-tab": { sidebarButtonId: "sidebar-settings-button" },
    "stats-tab": { sidebarButtonId: "sidebar-stats-button" },
    "aim-training-tab": { sidebarButtonId: "sidebar-aim-training-button" },
    "lineup-tab": { sidebarButtonId: "sidebar-lineup-button" },
    "crosshair-converter-tab": { sidebarButtonId: "sidebar-misc-crosshair-button", miscMenu: true },
    "updates-tab": { sidebarButtonId: "updates-button", moreMenu: true },
    "keybinds-tab": { sidebarButtonId: "keybinds-button", moreMenu: true },
    "privacy-policy-tab": { sidebarButtonId: "privacy-policy-button", moreMenu: true },
    "terms-of-service-tab": { sidebarButtonId: "terms-of-service-button", moreMenu: true },
    "credit-tab": { sidebarButtonId: "credit-button", moreMenu: true },
  };

  const TAB_LABELS = {
    "sensitivity-converter-tab": "Sensitivity Converter",
    "edpi-calculator-tab": "eDPI Calculator",
    "crosshair-converter-tab": "Crosshair Converter",
    "aim-training-tab": "Aim Trainer",
    "stats-tab": "Stats",
    "lineup-tab": "Lineups",
    "settings-tab": "Settings",
    "updates-tab": "Changelog",
    "keybinds-tab": "Keybinds",
    "privacy-policy-tab": "Privacy Policy",
    "terms-of-service-tab": "Terms of Service",
    "credit-tab": "Credits",
  };

  const NAV_INTENT_PATTERN =
    /\b(take me to|show me|open|go to|where is|where can i find|find the|navigate to|bring me to|switch to|jump to)\b/i;

  const ACTION_INTENT_PATTERN =
    /\b(set|fill|change|use|put|calculate|convert|copy|share|reset|swap|restart|start|run|filter|select|pick|enable|disable|turn on|turn off)\b/i;

  const SITE_TAB_ACTIONS = [
    {
      pattern: /\b(accent color|accent theme|theme color|change accent)\b/i,
      tab: "settings-tab",
      navigate: {
        openButtonId: "open-theme-settings",
        settingsOverlay: "theme-settings-overlay",
        settingsSearchId: "theme-settings-search",
        search: "accent",
      },
    },
    {
      pattern: /\b(text size|font size|bigger text|smaller text)\b/i,
      tab: "settings-tab",
      navigate: {
        openButtonId: "open-general-settings",
        settingsOverlay: "general-settings-overlay",
        settingsSearchId: "general-settings-search",
        search: "text size",
      },
    },
    {
      pattern: /\b(volume|master volume|aim trainer volume|sound)\b/i,
      tab: "settings-tab",
      navigate: {
        openButtonId: "open-general-settings",
        settingsOverlay: "general-settings-overlay",
        settingsSearchId: "general-settings-search",
        search: "volume",
      },
    },
    {
      pattern: /\b(refresh rate|fps cap|ui refresh|high refresh)\b/i,
      tab: "settings-tab",
      navigate: {
        openButtonId: "open-general-settings",
        settingsOverlay: "general-settings-overlay",
        settingsSearchId: "general-settings-search",
        search: "refresh",
      },
    },
    {
      pattern: /\b(font family|change font|font style)\b/i,
      tab: "settings-tab",
      navigate: {
        openButtonId: "open-theme-settings",
        settingsOverlay: "theme-settings-overlay",
        settingsSearchId: "theme-settings-search",
        search: "font",
      },
    },
    {
      pattern: /\b(background pattern|bg pattern|particles|waves background)\b/i,
      tab: "settings-tab",
      navigate: {
        openButtonId: "open-theme-settings",
        settingsOverlay: "theme-settings-overlay",
        settingsSearchId: "theme-settings-search",
        search: "background",
      },
    },
    {
      pattern: /\b(distance unit|cm\/360 unit|360 unit|inches per 360)\b/i,
      tab: "settings-tab",
      navigate: {
        openButtonId: "open-general-settings",
        settingsOverlay: "general-settings-overlay",
        settingsSearchId: "general-settings-search",
        search: "distance",
      },
    },
    {
      pattern: /\b(high contrast|contrast mode)\b/i,
      tab: "settings-tab",
      navigate: {
        openButtonId: "open-general-settings",
        settingsOverlay: "general-settings-overlay",
        settingsSearchId: "general-settings-search",
        search: "contrast",
      },
    },
    {
      pattern: /\b(reduce motion|motion setting)\b/i,
      tab: "settings-tab",
      navigate: {
        openButtonId: "open-general-settings",
        settingsOverlay: "general-settings-overlay",
        settingsSearchId: "general-settings-search",
        search: "motion",
      },
    },
    {
      pattern: /\b(reaction time|reaction test)\b/i,
      tab: "settings-tab",
      overlay: { openButtonId: "open-reaction-test", overlayId: "reaction-test-overlay" },
    },
    {
      pattern: /\b(trainer settings|aim trainer settings|target spread|trainer crosshair)\b/i,
      tab: "aim-training-tab",
      navigate: {
        openButtonId: "open-trainer-settings",
        settingsOverlay: "trainer-settings-overlay",
        settingsSearchId: "trainer-settings-search",
        search: "target",
      },
    },
    { pattern: /\b(changelog|updates?\b|what'?s new|patch notes)\b/i, tab: "updates-tab" },
    { pattern: /\b(edpi|e dpi|effective dpi|cm\/360|cm360|in\/360)\b/i, tab: "edpi-calculator-tab" },
    {
      pattern: /\b(sens(itivity)? converter|convert(ing)? sens|convert(ing)? sensitivity|convert from|convert to|mouse sens convert)\b/i,
      tab: "sensitivity-converter-tab",
    },
    { pattern: /\b(crosshair|cross hair|reticle)\b/i, tab: "crosshair-converter-tab" },
    { pattern: /\b(aim trainer|aim training|train (my )?aim|flick trainer)\b/i, tab: "aim-training-tab" },
    {
      pattern: /\b(stats tab|my stats|saved stats|conversion history|last (calc|conversion|edpi)|personal best)\b/i,
      tab: "stats-tab",
    },
    { pattern: /\b(lineups?|smoke lineup|flash lineup|grenade lineup)\b/i, tab: "lineup-tab", lineupSearch: true },
    { pattern: /\b(keybinds?|keyboard shortcuts?|hotkeys?)\b/i, tab: "keybinds-tab" },
    { pattern: /\b(privacy policy|privacy)\b/i, tab: "privacy-policy-tab" },
    { pattern: /\b(terms of service|terms)\b/i, tab: "terms-of-service-tab" },
    { pattern: /\b(credits?|about|who made)\b/i, tab: "credit-tab" },
    { pattern: /\b(settings|preferences|general settings|theme settings)\b/i, tab: "settings-tab" },
  ];

  function readFieldValue(id) {
    const el = document.getElementById(id);
    if (!el) return "";
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      return String(el.value || "").trim();
    }
    return String(el.textContent || "").trim();
  }

  function getActiveTabId() {
    const visible = [...document.querySelectorAll(".section")].find((section) => section.style.display !== "none");
    return visible?.id || "";
  }

  function hasNavIntent(text) {
    return NAV_INTENT_PATTERN.test(text) || ACTION_INTENT_PATTERN.test(text);
  }

  function isInformationalOnly(text) {
    const lower = String(text || "").toLowerCase();
    if (hasNavIntent(text)) return false;
    if (/\b(convert|calculate|fill|set|copy|share|reset|swap|restart|filter|open|show me|go to)\b/i.test(lower)) {
      return false;
    }
    return /^\s*(what|how|why|when|explain|tell me|define|describe|is|are|can you explain)\b/i.test(lower);
  }

  function resolveGameFragment(fragment) {
    const raw = String(fragment || "")
      .trim()
      .replace(/[,.!?]+$/, "");
    if (!raw) return "";
    return global.MorningRoastGames?.resolveGameName(raw) || "";
  }

  function normalizeUserCommand(text) {
    let raw = String(text || "")
      .replace(/,/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    raw = raw.replace(/\b(\d*\.\d+)\s+(\d{3,5})\s*dpi\b/gi, "$1 sensitivity $2 dpi");

    return raw;
  }

  function extractSensitivityFromSegment(segment) {
    const part = String(segment || "");
    const beforeSens = part.match(/\b(\d+(?:[.,]\d+)?)\s*sens(?:itivity)?\b/i);
    if (beforeSens) return beforeSens[1].replace(",", ".");

    const decBeforeDpi = part.match(/\b(\d*\.\d+)\s+\d{3,5}\s*dpi\b/i);
    if (decBeforeDpi) return decBeforeDpi[1].replace(",", ".");

    const trailingDec = part.match(/\b(\d*\.\d+)\s*$/);
    if (trailingDec) return trailingDec[1].replace(",", ".");

    return "";
  }

  function extractGamesFromText(text) {
    const lower = String(text || "").toLowerCase();
    const needles = [
      ["counter-strike 2", "CS2"],
      ["counter strike 2", "CS2"],
      ["rainbow six siege", "Rainbow 6 Siege"],
      ["escape from tarkov", "Escape from Tarkov"],
      ["marvel rivals", "Marvel Rivals"],
      ["apex legends", "Apex Legends"],
      ["black ops", "Black Ops 7"],
      ["delta force", "Delta Force"],
      ["arc raiders", "ARC Raiders"],
      ["valorant", "Valorant"],
      ["overwatch", "Overwatch"],
      ["fortnite", "Fortnite"],
      ["aimlabs", "Aimlabs"],
      ["rainbow 6", "Rainbow 6 Siege"],
      ["tarkov", "Escape from Tarkov"],
      ["roblox", "Roblox"],
      ["apex", "Apex Legends"],
      ["cs2", "CS2"],
      ["rust", "Rust"],
      ["osu", "osu!"],
      ["r6", "Rainbow 6 Siege"],
    ];

    const hits = [];
    for (const [needle, game] of needles) {
      let index = 0;
      while ((index = lower.indexOf(needle, index)) !== -1) {
        hits.push({ game, start: index, end: index + needle.length });
        index += 1;
      }
    }

    hits.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));

    const found = [];
    const spans = [];
    for (const hit of hits) {
      if (found.includes(hit.game)) continue;
      const overlaps = spans.some(([start, end]) => hit.start < end && hit.end > start);
      if (overlaps) continue;
      found.push(hit.game);
      spans.push([hit.start, hit.end]);
    }

    return found;
  }

  function extractFromToGames(text) {
    const raw = String(text || "");

    const fromTo = raw.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+(?:at|with|using|on)\b|[,.!?]|$)/i);
    if (fromTo) {
      return {
        from: resolveGameFragment(fromTo[1]) || extractGamesFromText(fromTo[1])[0] || "",
        to: resolveGameFragment(fromTo[2]) || extractGamesFromText(fromTo[2])[0] || "",
      };
    }

    const toFrom = raw.match(/\bto\s+(.+?)\s+from\s+(.+?)(?:\s+(?:at|with|using|on)\b|[,.!?]|$)/i);
    if (toFrom) {
      return {
        from: resolveGameFragment(toFrom[2]) || extractGamesFromText(toFrom[2])[0] || "",
        to: resolveGameFragment(toFrom[1]) || extractGamesFromText(toFrom[1])[0] || "",
      };
    }

    const ordered = extractGamesFromText(raw);
    return { from: ordered[0] || "", to: ordered[1] || "" };
  }

  function extractDpiValues(text) {
    const matches = [...String(text || "").matchAll(/(\d{3,5})\s*dpi\b/gi)];
    if (matches.length >= 2) return { fromDpi: matches[0][1], toDpi: matches[1][1] };
    if (matches.length === 1) return { fromDpi: matches[0][1], toDpi: matches[0][1] };
    return { fromDpi: "", toDpi: "" };
  }

  function extractSensitivity(text) {
    const raw = normalizeUserCommand(text);
    const numberPattern = String.raw`\d+(?:[.,]\d+)?`;

    const fromSegment = raw.split(/\s+to\s+/i)[0] || raw;
    const segmentSens = extractSensitivityFromSegment(fromSegment);
    if (segmentSens) return segmentSens;

    const beforeSens = raw.match(new RegExp(String.raw`\b(${numberPattern})\s*sens(?:itivity)?\b`, "i"));
    if (beforeSens) return beforeSens[1].replace(",", ".");

    const explicit = raw.match(new RegExp(String.raw`\bsens(?:itivity)?\s*(?:of|at|is|:)?\s*(${numberPattern})\b`, "i"));
    if (explicit) return explicit[1].replace(",", ".");

    const convertMatch = raw.match(new RegExp(String.raw`\bconvert\s+(${numberPattern})\b`, "i"));
    if (convertMatch) return convertMatch[1].replace(",", ".");

    const decimal = raw.match(/\b(0\.\d{1,4})\b/);
    if (decimal) return decimal[1];

    return "";
  }

  function extractLineupGame(text) {
    const lower = String(text || "").toLowerCase();
    if (/\b(cs2|counter[\s-]?strike(?:\s*2)?|counterstrike)\b/i.test(lower)) return "cs2";
    if (/\b(valorant)\b/i.test(lower)) return "valorant";
    return null;
  }

  function extractLineupSearch(text) {
    const lower = String(text || "").toLowerCase();
    const terms = [
      ["flashbang", "flash"],
      ["incendiary", "incendiary"],
      ["smoke", "smoke"],
      ["flash", "flash"],
      ["molly", "molly"],
      ["grenade", "grenade"],
      ["molotov", "molotov"],
      ["a site", "a site"],
      ["b site", "b site"],
      ["mid", "mid"],
    ];
    for (const [pattern, value] of terms) {
      if (lower.includes(pattern)) return value;
    }
    if (/\bhe\b/.test(lower)) return "he";
    return "";
  }

  function extractLineupMap(text) {
    const lower = String(text || "").toLowerCase();
    const maps = [
      "dust ii",
      "dust 2",
      "mirage",
      "inferno",
      "nuke",
      "overpass",
      "ancient",
      "anubis",
      "vertigo",
      "ascent",
      "bind",
      "haven",
      "lotus",
      "sunset",
      "icebox",
      "breeze",
      "fracture",
      "pearl",
    ];
    for (const map of maps) {
      if (lower.includes(map)) return map.replace(/\s+/g, " ");
    }
    const onMap = lower.match(/\bon\s+([a-z0-9 ]+?)(?:\s+(?:smoke|flash|lineup|molly)|[,.!?]|$)/i);
    return onMap?.[1]?.trim() || "";
  }

  function extractLineupSide(text) {
    const lower = String(text || "").toLowerCase();
    if (/\b(attacker|attack|t side|t-side)\b/.test(lower)) return "attacker";
    if (/\b(defender|defense|ct side|ct-side)\b/.test(lower)) return "defender";
    return "";
  }

  function extractTrainerMode(text) {
    const lower = String(text || "").toLowerCase();
    const modes = [
      ["static", "static"],
      ["shrink", "shrinking"],
      ["shrinking", "shrinking"],
      ["track", "tracking"],
      ["tracking", "tracking"],
      ["flick", "flick"],
      ["switch", "switch"],
      ["strafe", "strafe"],
      ["micro", "micro"],
    ];
    for (const [needle, id] of modes) {
      if (lower.includes(needle)) return id;
    }
    return "";
  }

  function extractSiteAction(text) {
    const lower = String(text || "").toLowerCase();
    if (/\b(swap|switch)\s+(games?|from and to)\b/.test(lower) || /\bswap\s+converter\b/.test(lower)) {
      return "swapConverter";
    }
    if (/\b(copy|copy result|copy (sens|edpi|value))\b/.test(lower)) return "copy";
    if (/\b(share|share link)\b/.test(lower)) return "share";
    if (/\b(reset|clear)\s+(converter|calculator|fields|trainer|stats)\b/.test(lower)) return "reset";
    if (/\b(restart|reset)\s+(trainer|session|aim)\b/.test(lower)) return "restartTrainer";
    return "";
  }

  function extractCrosshairCode(text) {
    const codeMatch = String(text || "").match(/`([^`]+)`/);
    if (codeMatch) return codeMatch[1].trim();
    const quoted = String(text || "").match(/(?:code|crosshair)\s*[:=]?\s*["']([^"']+)["']/i);
    return quoted?.[1]?.trim() || "";
  }

  function getMatchedTabActions(userText) {
    const query = String(userText || "")
      .toLowerCase()
      .replace(/[^\w\s/%.°+-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!query) return [];

    const seen = new Set();
    const actions = [];
    for (const entry of SITE_TAB_ACTIONS) {
      if (!entry.pattern.test(query)) continue;
      const key = `${entry.tab}:${entry.navigate?.search || entry.pattern.source}`;
      if (seen.has(key)) continue;
      seen.add(key);
      actions.push(entry);
    }
    return actions;
  }

  function getBestTabAction(userText) {
    const actions = getMatchedTabActions(userText);
    return actions.find((action) => action.navigate || action.overlay || action.lineupSearch) || actions[0] || null;
  }

  function parseConversionPlan(userText) {
    const text = String(userText || "");
    const lower = text.toLowerCase();
    const sens = extractSensitivity(text);
    const dpis = extractDpiValues(text);
    const games = extractFromToGames(text);
    const listedGames = extractGamesFromText(text);

    const isEdpiIntent =
      /\b(edpi|e dpi|effective dpi)\b/i.test(lower) ||
      (/\bcm\/360\b/i.test(lower) && !/\bconvert\b/i.test(lower));

    const isConverterIntent =
      /\b(convert|conversion|translate|equivalent|same sens|from .+ to)\b/i.test(lower) ||
      (games.from && games.to) ||
      /\bsens(itivity)? converter\b/i.test(lower);

    if (isEdpiIntent && (sens || dpis.fromDpi || listedGames.length) && !isConverterIntent) {
      return {
        tab: "edpi-calculator-tab",
        ...TAB_SIDEBAR["edpi-calculator-tab"],
        edpi: { dpi: dpis.fromDpi, sens, game: listedGames[0] || games.from || "" },
      };
    }

    if (isConverterIntent && (sens || dpis.fromDpi || games.from || games.to)) {
      return {
        tab: "sensitivity-converter-tab",
        ...TAB_SIDEBAR["sensitivity-converter-tab"],
        conversion: {
          baseSens: sens,
          fromDpi: dpis.fromDpi,
          toDpi: dpis.toDpi || dpis.fromDpi,
          fromGame: games.from,
          toGame: games.to,
        },
      };
    }

    if (games.from && games.to && (sens || dpis.fromDpi)) {
      return {
        tab: "sensitivity-converter-tab",
        ...TAB_SIDEBAR["sensitivity-converter-tab"],
        conversion: {
          baseSens: sens,
          fromDpi: dpis.fromDpi,
          toDpi: dpis.toDpi || dpis.fromDpi,
          fromGame: games.from,
          toGame: games.to,
        },
      };
    }

    return null;
  }

  function parseTrainerPlan(userText) {
    const text = String(userText || "");
    const lower = text.toLowerCase();
    if (!/\b(trainer|aim train|aim training|flick|tracking|practice aim)\b/i.test(lower)) return null;

    const sens = extractSensitivity(text);
    const dpis = extractDpiValues(text);
    const game = extractGamesFromText(text)[0] || "";
    const mode = extractTrainerMode(text);

    if (!sens && !dpis.fromDpi && !game && !mode) return null;

    return {
      tab: "aim-training-tab",
      ...TAB_SIDEBAR["aim-training-tab"],
      trainer: {
        game,
        sens,
        dpi: dpis.fromDpi,
        mode,
      },
    };
  }

  function parseLineupPlan(userText) {
    const text = String(userText || "");
    const lower = text.toLowerCase();
    const hasLineup =
      /\b(lineups?|smoke|flash|molly|grenade|incendiary|molotov)\b/i.test(lower) ||
      (extractLineupGame(text) && /\blineups?\b/i.test(lower));

    if (!hasLineup) return null;

    const game = extractLineupGame(text);
    const search = extractLineupSearch(text);
    const map = extractLineupMap(text);
    const side = extractLineupSide(text);

    if (!hasNavIntent(text) && !game && !search && !map && isInformationalOnly(text)) return null;

    return {
      tab: "lineup-tab",
      ...TAB_SIDEBAR["lineup-tab"],
      lineup: { game, search, map, side },
    };
  }

  function shouldApplyTabAction(action, userText, plan) {
    if (!action?.tab) return false;
    if (plan.conversion || plan.edpi || plan.trainer || plan.lineup || plan.action || plan.overlay) return true;
    if (hasNavIntent(userText)) return true;
    if (action.lineupSearch && /\b(smoke|flash|molly|lineup|grenade)\b/i.test(userText)) return true;
    if (isInformationalOnly(userText)) return false;
    return false;
  }

  function parseSitePlan(userText) {
    const text = normalizeUserCommand(userText);

    const conversionPlan = parseConversionPlan(text);
    if (conversionPlan) return conversionPlan;

    const trainerPlan = parseTrainerPlan(text);
    if (trainerPlan) return trainerPlan;

    const lineupPlan = parseLineupPlan(text);
    if (lineupPlan) return lineupPlan;

    const siteAction = extractSiteAction(text);
    if (siteAction) {
      return { action: siteAction };
    }

    const lower = text.toLowerCase();

    if (/\b(changelog|updates?\b|what'?s new|patch notes|release notes)\b/i.test(lower) && hasNavIntent(text)) {
      return { tab: "updates-tab", ...TAB_SIDEBAR["updates-tab"] };
    }

    const crosshairCode = extractCrosshairCode(text);
    if (crosshairCode && /\b(crosshair|convert crosshair|cs2|valorant)\b/i.test(lower)) {
      return {
        tab: "crosshair-converter-tab",
        ...TAB_SIDEBAR["crosshair-converter-tab"],
        crosshair: { code: crosshairCode },
      };
    }

    const action = getBestTabAction(text);
    if (!action?.tab) return null;

    if (!shouldApplyTabAction(action, text, {})) return null;

    const sidebar = TAB_SIDEBAR[action.tab] || {};
    const plan = {
      tab: action.tab,
      sidebarButtonId: sidebar.sidebarButtonId || "",
      moreMenu: Boolean(sidebar.moreMenu),
      miscMenu: Boolean(sidebar.miscMenu),
    };

    if (action.navigate) {
      plan.settingsSearch = {
        openButtonId: action.navigate.openButtonId || "",
        overlay: action.navigate.settingsOverlay || "",
        searchId: action.navigate.settingsSearchId || "",
        query: action.navigate.search || "",
      };
    }

    if (action.overlay) {
      plan.overlay = action.overlay;
    }

    if (action.lineupSearch) {
      plan.lineup = {
        game: extractLineupGame(text),
        search: extractLineupSearch(text),
        map: extractLineupMap(text),
        side: extractLineupSide(text),
      };
    }

    return plan;
  }

  function hasActionIntent(text) {
    if (isInformationalOnly(text)) return false;
    const lower = normalizeUserCommand(text).toLowerCase();
    return (
      ACTION_INTENT_PATTERN.test(lower) ||
      NAV_INTENT_PATTERN.test(lower) ||
      /\b(convert|calculate|fill|set|copy|share|reset|swap|restart|filter|lineups?|open|show me|go to)\b/i.test(lower)
    );
  }

  function validateUserRequest(userText, plan) {
    const normalized = normalizeUserCommand(userText);

    if (!hasActionIntent(userText)) {
      return { ok: true, normalized, plan };
    }

    if (!plan || !planHasAutomation(plan)) {
      return {
        ok: false,
        normalized,
        message:
          "I couldn't quite understand that request. Please rephrase with clear details — for example: \"Convert 1.25 sens, 800 DPI from CS2 to Valorant.\"",
      };
    }

    if (/\bconvert\b/i.test(normalized) && /\bto\b/i.test(normalized)) {
      const games = extractFromToGames(normalized);
      if (!games.from || !games.to) {
        return {
          ok: false,
          normalized,
          message:
            "I need both a source game and a target game. Please rephrase — for example: \"Convert CS2, 1.25 sens, 800 DPI to Valorant, 800 DPI.\"",
        };
      }
    }

    return { ok: true, normalized, plan };
  }

  function getSiteState() {
    const lines = [];
    const activeTab = getActiveTabId();
    if (activeTab) lines.push(`Active tab: ${TAB_LABELS[activeTab] || activeTab}`);

    const fromGame = readFieldValue("from-search");
    const toGame = readFieldValue("to-search");
    const baseSens = readFieldValue("base-sens");
    const fromDpi = readFieldValue("from-dpi");
    const toDpi = readFieldValue("to-dpi");
    const convertedSens = readFieldValue("new-sens-value");
    if (fromGame || toGame || baseSens || fromDpi || toDpi || (convertedSens && convertedSens !== "0.00")) {
      lines.push("Sensitivity converter:");
      if (fromGame) lines.push(`- From game: ${fromGame}`);
      if (toGame) lines.push(`- To game: ${toGame}`);
      if (baseSens) lines.push(`- Base sensitivity: ${baseSens}`);
      if (fromDpi) lines.push(`- From DPI: ${fromDpi}`);
      if (toDpi) lines.push(`- To DPI: ${toDpi}`);
      if (convertedSens && convertedSens !== "0.00") lines.push(`- Converted sensitivity: ${convertedSens}`);
    }

    const edpiGame = readFieldValue("edpi-game-search");
    const edpiDpi = readFieldValue("edpi-dpi");
    const edpiSens = readFieldValue("edpi-sens");
    const edpiValue = readFieldValue("edpi-value");
    const edpiCm360 = readFieldValue("edpi-cm360");
    if (edpiGame || edpiDpi || edpiSens || (edpiValue && edpiValue !== "0")) {
      lines.push("eDPI calculator:");
      if (edpiGame) lines.push(`- Game: ${edpiGame}`);
      if (edpiDpi) lines.push(`- DPI: ${edpiDpi}`);
      if (edpiSens) lines.push(`- Sensitivity: ${edpiSens}`);
      if (edpiValue && edpiValue !== "0") lines.push(`- eDPI: ${edpiValue}`);
      if (edpiCm360) lines.push(`- cm/360: ${edpiCm360}`);
    }

    const crosshairInput = readFieldValue("crosshair-converter-input");
    const crosshairOutput = readFieldValue("crosshair-converter-output-code");
    if (crosshairInput || crosshairOutput) {
      lines.push("Crosshair converter:");
      if (crosshairInput) lines.push(`- Input: ${crosshairInput}`);
      if (crosshairOutput) lines.push(`- Output: ${crosshairOutput}`);
    }

    const trainerGame = readFieldValue("trainer-game-search");
    const trainerSens = readFieldValue("canvas-sens");
    const trainerDpi = readFieldValue("canvas-dpi");
    if (trainerGame || trainerSens || trainerDpi) {
      lines.push("Aim trainer:");
      if (trainerGame) lines.push(`- Game: ${trainerGame}`);
      if (trainerSens) lines.push(`- Sensitivity: ${trainerSens}`);
      if (trainerDpi) lines.push(`- DPI: ${trainerDpi}`);
    }

    const lineupGame = readFieldValue("lineup-game-search");
    const lineupSearch = readFieldValue("lineup-search");
    const lineupMap = readFieldValue("lineup-map-search");
    if (lineupGame || lineupSearch || lineupMap) {
      lines.push("Lineups:");
      if (lineupGame) lines.push(`- Game: ${lineupGame}`);
      if (lineupMap) lines.push(`- Map: ${lineupMap}`);
      if (lineupSearch) lines.push(`- Search: ${lineupSearch}`);
    }

    const lastSens = readFieldValue("last-sens-conv");
    const lastEdpi = readFieldValue("last-edpi-calc");
    if ((lastSens && lastSens !== "0.00") || (lastEdpi && lastEdpi !== "0")) {
      lines.push("Saved stats:");
      if (lastSens && lastSens !== "0.00") lines.push(`- Last conversion: ${lastSens}`);
      if (lastEdpi && lastEdpi !== "0") lines.push(`- Last eDPI: ${lastEdpi}`);
    }

    return lines.join("\n");
  }

  function getCapabilitiesPrompt() {
    return [
      "YOU CONTROL THE SITE. When the user asks to do something, the site executes actions automatically (navigation, filling forms, filters, settings).",
      "Capabilities:",
      "- Navigate any tab: sensitivity converter, eDPI calculator, aim trainer, lineups, stats, settings, changelog, keybinds.",
      "- Fill sensitivity converter (games, DPI, base sens) and eDPI calculator.",
      "- Configure aim trainer (game, sens, DPI, mode: static/flick/tracking/etc).",
      "- Filter lineups (game, utility search, map, attacker/defender side).",
      "- Open settings overlays: theme, general, trainer settings; highlight search terms.",
      "- Open reaction time test from settings.",
      "- Site actions: copy result, share link, swap converter games, reset fields, restart trainer.",
      "- Answer questions using LIVE VALUES below.",
      "Rules:",
      "- NEVER explain how to convert manually or give step-by-step conversion instructions. The site does it for the user.",
      "- NEVER tell users to open tabs, fill fields, or click buttons themselves when they asked you to do something.",
      "- For conversions/eDPI with specific values: do NOT repeat calculated numbers in chat — the site fills calculators.",
      "- After actions run, reply in 1 short sentence max (e.g. \"Done — check the converter.\"). No tutorials.",
      "- For informational questions (what is eDPI?), explain only — do not say you opened a tab unless you did.",
      "- Respect from/to order exactly as the user stated.",
      "- Users may separate details with commas (e.g. \"CS2, 1.25 sens, 800 DPI to Valorant, 800 DPI\") — parse all parts before acting.",
      "- If a site action request is unclear or missing required details, ask the user to rephrase instead of guessing.",
    ].join("\n");
  }

  function planHasAutomation(plan) {
    if (!plan) return false;
    return Boolean(
      plan.tab ||
        plan.conversion ||
        plan.edpi ||
        plan.trainer ||
        plan.lineup ||
        plan.settingsSearch ||
        plan.overlay ||
        plan.crosshair ||
        plan.action,
    );
  }

  global.MorningRoastActions = {
    TAB_SIDEBAR,
    TAB_LABELS,
    normalizeUserCommand,
    parseSitePlan,
    validateUserRequest,
    hasActionIntent,
    getSiteState,
    getCapabilitiesPrompt,
    planHasAutomation,
    hasNavIntent,
    isInformationalOnly,
  };
})(typeof window !== "undefined" ? window : globalThis);
