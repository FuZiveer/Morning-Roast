(function initMorningRoastProfileTags(global) {
  "use strict";

  const PROFILE_DISPLAY_NAME_KEY = "profileDisplayName";
  const PROFILE_TAGS_UNLOCKED_KEY = "profileTagsUnlocked";
  const SENS_CONVERSION_COUNT_KEY = "sensConversionCount";
  const LAST_SENS_CONV_SIG_KEY = "lastSensConvSig";

  const ACHIEVEMENT_TAGS = [
    {
      id: "member",
      label: "Member",
      hint: "Set a display name on your profile.",
      check: (stats) => stats.hasDisplayName,
    },
    {
      id: "converter",
      label: "Converter",
      hint: "Convert sensitivity between two games once.",
      check: (stats) => stats.sensConversions >= 1,
    },
    {
      id: "converter-pro",
      label: "Converter Pro",
      hint: "Convert sensitivity 25 times.",
      check: (stats) => stats.sensConversions >= 25,
    },
    {
      id: "converter-master",
      label: "Converter Master",
      hint: "Convert sensitivity 100 times.",
      check: (stats) => stats.sensConversions >= 100,
    },
    {
      id: "on-target",
      label: "On Target",
      hint: "Score 25 hits in one aim trainer session.",
      check: (stats) => stats.bestAimHits >= 25,
    },
    {
      id: "sharpshooter",
      label: "Sharpshooter",
      hint: "Score 50 hits in one aim trainer session.",
      check: (stats) => stats.bestAimHits >= 50,
    },
    {
      id: "elite-aim",
      label: "Elite Aim",
      hint: "Score 100 hits in one aim trainer session.",
      check: (stats) => stats.bestAimHits >= 100,
    },
    {
      id: "steady-hand",
      label: "Steady Hand",
      hint: "Reach 90% accuracy in one aim trainer session.",
      check: (stats) => stats.bestAimAccuracy >= 90,
    },
  ];

  function isOwnerDisplayName(name) {
    const normalized = String(name || "").trim().toLowerCase();
    return normalized === "fuziveer";
  }

  function getUnlockedSet() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PROFILE_TAGS_UNLOCKED_KEY) || "[]");
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  }

  function saveUnlockedSet(set) {
    localStorage.setItem(PROFILE_TAGS_UNLOCKED_KEY, JSON.stringify([...set]));
  }

  function getProfileTagStats() {
    let bestAimHits = 0;
    let bestAimAccuracy = 0;

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith("bestAimResults_")) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key) || "{}");
        bestAimHits = Math.max(bestAimHits, Number(data.hits) || 0);
        bestAimAccuracy = Math.max(bestAimAccuracy, Number(data.accuracy) || 0);
      } catch {
        /* ignore malformed entries */
      }
    }

    return {
      hasDisplayName: Boolean(String(localStorage.getItem(PROFILE_DISPLAY_NAME_KEY) || "").trim()),
      sensConversions: Math.max(0, parseInt(localStorage.getItem(SENS_CONVERSION_COUNT_KEY) || "0", 10) || 0),
      bestAimHits,
      bestAimAccuracy,
    };
  }

  function createTagElement(label, { unlocked = false, owner = false, hint = "", id = "" } = {}) {
    const tag = document.createElement("span");
    tag.className = "profile-tag";
    if (owner) tag.classList.add("profile-tag--owner");
    tag.classList.toggle("is-unlocked", unlocked);
    tag.classList.toggle("is-locked", !unlocked);
    tag.textContent = label;

    if (hint) {
      const tipId = `profile-tag-tip-${id || label.toLowerCase().replace(/\s+/g, "-")}`;
      tag.classList.add("has-tooltip");
      tag.tabIndex = 0;
      tag.setAttribute("aria-label", unlocked ? `${label} tag unlocked` : `${label}. Locked.`);
      tag.setAttribute("aria-describedby", tipId);

      const tooltip = document.createElement("span");
      tooltip.className = "profile-tag-tooltip";
      tooltip.id = tipId;
      tooltip.setAttribute("role", "tooltip");
      tooltip.textContent = hint;
      tag.appendChild(tooltip);
    } else {
      tag.setAttribute("aria-label", `${label} tag`);
    }

    return tag;
  }

  function renderProfileTags(displayName) {
    const container = document.getElementById("profile-tags");
    if (!container) return;

    const stats = getProfileTagStats();
    const unlocked = getUnlockedSet();
    container.replaceChildren();

    if (isOwnerDisplayName(displayName)) {
      container.appendChild(
        createTagElement("Owner", {
          unlocked: true,
          owner: true,
          hint: "Morning Roast site owner.",
          id: "owner",
        }),
      );
    }

    for (const tag of ACHIEVEMENT_TAGS) {
      const isUnlocked = unlocked.has(tag.id) || tag.check(stats);
      container.appendChild(createTagElement(tag.label, { unlocked: isUnlocked, hint: tag.hint, id: tag.id }));
    }
  }

  function checkUnlocks({ notify = false } = {}) {
    const stats = getProfileTagStats();
    const unlocked = getUnlockedSet();
    const newlyUnlocked = [];

    for (const tag of ACHIEVEMENT_TAGS) {
      if (unlocked.has(tag.id)) continue;
      if (!tag.check(stats)) continue;
      unlocked.add(tag.id);
      newlyUnlocked.push(tag);
    }

    if (!newlyUnlocked.length) return newlyUnlocked;

    saveUnlockedSet(unlocked);
    renderProfileTags(String(localStorage.getItem(PROFILE_DISPLAY_NAME_KEY) || "").trim());

    if (notify) {
      for (const tag of newlyUnlocked) {
        global.Toast?.notify?.({
          message: `New tag unlocked: ${tag.label}`,
          type: "success",
        });
      }
    }

    return newlyUnlocked;
  }

  function recordSensitivityConversion({ fromGame, toGame, baseSens, fromDpi, toDpi, result } = {}) {
    const signature = [fromGame, toGame, baseSens, fromDpi, toDpi, result].join("|");
    if (!fromGame || !toGame || !result || signature === localStorage.getItem(LAST_SENS_CONV_SIG_KEY)) {
      return getProfileTagStats().sensConversions;
    }

    localStorage.setItem(LAST_SENS_CONV_SIG_KEY, signature);
    const nextCount = getProfileTagStats().sensConversions + 1;
    localStorage.setItem(SENS_CONVERSION_COUNT_KEY, String(nextCount));
    checkUnlocks({ notify: true });
    return nextCount;
  }

  function bootstrap() {
    checkUnlocks({ notify: false });
    renderProfileTags(String(localStorage.getItem(PROFILE_DISPLAY_NAME_KEY) || "").trim());
  }

  global.MorningRoastProfileTags = {
    ACHIEVEMENT_TAGS,
    bootstrap,
    checkUnlocks,
    getProfileTagStats,
    isOwnerDisplayName,
    recordSensitivityConversion,
    renderProfileTags,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})(window);
