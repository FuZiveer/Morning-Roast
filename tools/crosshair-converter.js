/* CS2 ↔ Valorant crosshair converter — ports the exact conversion logic from cs2valcrosshair.com */
(function () {
  const CS2_SHARECODE_PATTERN = /^CSGO(-?[\w]{5}){5}$/;
  const CS2_DICTIONARY = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789";
  const CS2_DICTIONARY_LEN = BigInt(CS2_DICTIONARY.length);

  class ShareCodeError extends Error {
    constructor() {
      super("Invalid share code");
      this.name = "ShareCodeError";
    }
  }

  class CrosshairShareCodeError extends Error {
    constructor() {
      super("Invalid crosshair share code");
      this.name = "CrosshairShareCodeError";
    }
  }

  class ValorantCrosshairError extends Error {
    constructor() {
      super("Invalid Valorant crosshair code");
      this.name = "ValorantCrosshairError";
    }
  }

  const VAL_COLOR_PRESETS = ["#FFFFFF", "#00FF00", "#7FFF00", "#DFFF00", "#FFFF00", "#00FFFF", "#FF00FF", "#FF0000"];
  const VAL_COLOR_BY_INDEX = {
    0: "#FFFFFF",
    1: "#00FF00",
    2: "#7FFF00",
    3: "#DFFF00",
    4: "#FFFF00",
    5: "#00FFFF",
    6: "#FF00FF",
    7: "#FF0000",
  };

  const CS2_COLOR_RGB = {
    0: [255, 0, 0],
    1: [0, 255, 0],
    2: [255, 255, 0],
    3: [0, 0, 255],
    4: [0, 255, 255],
  };

  const CS2_SETTINGS_DEFAULT = {
    length: 5,
    red: 0,
    green: 255,
    blue: 0,
    gap: -2,
    alphaEnabled: true,
    alpha: 200,
    outlineEnabled: false,
    outline: 1,
    color: 1,
    thickness: 0.5,
    centerDotEnabled: false,
    splitDistance: 7,
    followRecoil: false,
    fixedCrosshairGap: 3,
    innerSplitAlpha: 1,
    outerSplitAlpha: 0.5,
    splitSizeRatio: 1,
    tStyleEnabled: false,
    deployedWeaponGapEnabled: false,
    style: 4,
  };

  const VAL_PRIMARY_DEFAULT = {
    c: 0,
    u: "FFFFFF",
    h: true,
    o: 0.5,
    t: 1,
    d: false,
    a: 1,
    z: 2,
    m: false,
    inner_lines: {
      b: true,
      a: 0.8,
      l: 6,
      v: 6,
      g: false,
      t: 2,
      o: 3,
      m: false,
      s: 1,
      f: true,
      e: 1,
    },
    outer_lines: {
      b: true,
      a: 0.35,
      l: 2,
      v: 2,
      g: false,
      t: 2,
      o: 10,
      m: true,
      s: 1,
      f: true,
      e: 1,
    },
  };

  const CS2_BASELINE_GAP = 5;
  const CS2_GAP_COLLAPSE = -6;
  const VAL_TO_CS2_LENGTH = 0.5;
  const VAL_TO_CS2_THICKNESS = 0.5;

  function cloneProfile(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createValorantProfile() {
    return {
      name: "Crosshair Profile",
      fade_crosshair_with_firing_error: true,
      use_advanced_options: false,
      override_all_primary_crosshairs_with_my_primary_crosshair: false,
      primary: cloneProfile(VAL_PRIMARY_DEFAULT),
      ads: cloneProfile(VAL_PRIMARY_DEFAULT),
      ads_copy_primary: true,
      sniper: { d: true, t: "FF0000", c: 7, s: 1, o: 0.8 },
    };
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function round1(value) {
    return Math.round(value * 10) / 10;
  }

  function bytesToHex(bytes) {
    return bytes.map((byte) => `0${(byte & 0xff).toString(16)}`.slice(-2)).join("");
  }

  function stringToByteArray(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i += 2) bytes.push(parseInt(str.slice(i, i + 2), 16));
    return bytes;
  }

  function rgbToHex(r, g, b) {
    return `#${[r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("")}`;
  }

  function rgbToCustomHex(r, g, b) {
    return [r, g, b]
      .map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0").toUpperCase())
      .join("");
  }

  function hexToRgb(hex) {
    const clean = hex.replace("#", "").slice(0, 6).padEnd(6, "0");
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
  }

  function uint8ToInt8(number) {
    return (number << 24) >> 24;
  }

  function sumArray(array) {
    return array.reduce((prev, value) => prev + value, 0);
  }

  function shareCodeToBytes(shareCode) {
    if (!shareCode.match(CS2_SHARECODE_PATTERN)) throw new ShareCodeError();

    const stripped = shareCode.replace(/CSGO|-/g, "");
    const chars = Array.from(stripped).reverse();
    let big = 0n;
    for (const char of chars) {
      big = big * CS2_DICTIONARY_LEN + BigInt(CS2_DICTIONARY.indexOf(char));
    }

    const str = big.toString(16).padStart(36, "0");
    return stringToByteArray(str);
  }

  function bytesToShareCode(bytes) {
    const hex = bytesToHex(bytes);
    let total = BigInt(`0x${hex}`);
    let chars = "";
    for (let i = 0; i < 25; i += 1) {
      const rem = total % CS2_DICTIONARY_LEN;
      chars += CS2_DICTIONARY[Number(rem)];
      total = total / CS2_DICTIONARY_LEN;
    }
    return `CSGO-${chars.slice(0, 5)}-${chars.slice(5, 10)}-${chars.slice(10, 15)}-${chars.slice(15, 20)}-${chars.slice(20, 25)}`;
  }

  function decodeCs2ShareCode(code) {
    const bytes = shareCodeToBytes(code);

    const checksum = sumArray(bytes.slice(1)) % 256;
    if (bytes[0] !== checksum) throw new CrosshairShareCodeError();

    return {
      gap: uint8ToInt8(bytes[2]) / 10,
      outline: bytes[3] / 2,
      red: bytes[4],
      green: bytes[5],
      blue: bytes[6],
      alpha: bytes[7],
      splitDistance: bytes[8] & 7,
      followRecoil: ((bytes[8] >> 4) & 8) === 8,
      fixedCrosshairGap: uint8ToInt8(bytes[9]) / 10,
      color: bytes[10] & 7,
      outlineEnabled: (bytes[10] & 8) === 8,
      innerSplitAlpha: (bytes[10] >> 4) / 10,
      outerSplitAlpha: (bytes[11] & 15) / 10,
      splitSizeRatio: (bytes[11] >> 4) / 10,
      thickness: bytes[12] / 10,
      centerDotEnabled: ((bytes[13] >> 4) & 1) === 1,
      deployedWeaponGapEnabled: ((bytes[13] >> 4) & 2) === 2,
      alphaEnabled: ((bytes[13] >> 4) & 4) === 4,
      tStyleEnabled: ((bytes[13] >> 4) & 8) === 8,
      style: (bytes[13] & 0xf) >> 1,
      length: bytes[14] / 10,
    };
  }

  function encodeCs2ShareCode(crosshair) {
    const bytes = [
      0,
      1,
      (crosshair.gap * 10) & 0xff,
      crosshair.outline * 2,
      crosshair.red,
      crosshair.green,
      crosshair.blue,
      crosshair.alpha,
      ((crosshair.splitDistance || 0) & 7) | (Number(crosshair.followRecoil) << 7),
      ((crosshair.fixedCrosshairGap || 0) * 10) & 0xff,
      (crosshair.color & 7) | (Number(crosshair.outlineEnabled) << 3) | (((crosshair.innerSplitAlpha ?? 1) * 10) << 4),
      ((crosshair.outerSplitAlpha ?? 0.5) * 10) | (((crosshair.splitSizeRatio ?? 1) * 10) << 4),
      crosshair.thickness * 10,
      (crosshair.style << 1) |
        (Number(crosshair.centerDotEnabled) << 4) |
        (Number(crosshair.deployedWeaponGapEnabled) << 5) |
        (Number(crosshair.alphaEnabled) << 6) |
        (Number(crosshair.tStyleEnabled) << 7),
      crosshair.length * 10,
      0,
      0,
      0,
    ];
    bytes[0] = sumArray(bytes) & 0xff;
    return bytesToShareCode(bytes);
  }

  function cs2ColorRgb(ch) {
    return CS2_COLOR_RGB[ch.color] ?? [ch.red, ch.green, ch.blue];
  }

  function cs2ColorToHex(ch) {
    const normalized = {
      color: ch.color,
      red: ch.red ?? ch.r,
      green: ch.green ?? ch.g,
      blue: ch.blue ?? ch.b,
    };
    const [r, g, b] = cs2ColorRgb(normalized);
    return rgbToHex(r, g, b);
  }

  function setValorantValue(target, key, raw) {
    const current = target[key];
    if (typeof current === "boolean") target[key] = Boolean(Number(raw));
    else if (typeof current === "number") target[key] = Number(raw);
    else if (typeof current === "string") target[key] = raw;
  }

  function applyValorantSection(section, payload) {
    const pairs = payload.split(";").filter(Boolean);
    for (let i = 0; i < pairs.length - 1; i += 2) {
      const key = pairs[i];
      const raw = pairs[i + 1];
      if (key.startsWith("0") || key.startsWith("1")) {
        const lines = key.startsWith("0") ? section.inner_lines : section.outer_lines;
        setValorantValue(lines, key.slice(1), raw);
      } else {
        if (key === "c" && raw !== "8") {
          const preset = VAL_COLOR_BY_INDEX[Number(raw)] ?? "#FFFFFF";
          section.u = preset.replace("#", "").slice(0, 6);
        }
        setValorantValue(section, key, raw);
      }
    }
  }

  function applyValorantSniperSection(sniper, payload) {
    const pairs = payload.split(";").filter(Boolean);
    for (let i = 0; i < pairs.length - 1; i += 2) {
      setValorantValue(sniper, pairs[i], pairs[i + 1]);
    }
  }

  function parseValorantCode(code) {
    const trimmed = code.trim();
    if (!trimmed || !/^\d/.test(trimmed)) throw new ValorantCrosshairError();

    const profile = createValorantProfile();
    const parts = trimmed.split(/(P|A|S|NAME);/g);

    const primaryIndex = parts.indexOf("P");
    if (primaryIndex >= 0) applyValorantSection(profile.primary, parts[primaryIndex + 1] ?? "");

    const adsIndex = parts.indexOf("A");
    if (adsIndex >= 0) applyValorantSection(profile.ads, parts[adsIndex + 1] ?? "");

    const sniperIndex = parts.indexOf("S");
    if (sniperIndex >= 0) applyValorantSniperSection(profile.sniper, parts[sniperIndex + 1] ?? "");

    const nameIndex = parts.indexOf("NAME");
    if (nameIndex >= 0) profile.name = (parts[nameIndex + 1] ?? "").replace(/^"|"$/g, "");

    return profile;
  }

  function valorantColorRgb(profile) {
    const colorIndex = profile.primary.c;
    if (colorIndex === 8) return hexToRgb(profile.primary.u ?? "FFFFFF");
    return hexToRgb(VAL_COLOR_BY_INDEX[colorIndex] ?? "#FFFFFF");
  }

  function valorantProfileToPreviewSettings(profile) {
    const primary = profile.primary;
    const inner = primary.inner_lines;
    const outer = primary.outer_lines;
    return {
      colorIndex: primary.c,
      hexColor: primary.u,
      outlines: primary.h,
      outlineThickness: primary.t,
      outlineOpacity: primary.o,
      dot: primary.d,
      dotThickness: primary.z,
      dotOpacity: primary.a,
      innerEnabled: inner.b && inner.l > 0,
      innerLength: inner.l,
      innerVertical: inner.g ? inner.v : inner.l,
      lengthNotLinked: inner.g,
      innerThickness: inner.t,
      innerOffset: inner.o,
      innerOpacity: inner.a,
      outerEnabled: outer.b && outer.l > 0,
      firingError: inner.f,
      movementError: inner.m,
    };
  }

  function valorantColorHex(settings) {
    if (settings.colorIndex === 8 && settings.hexColor) return `#${settings.hexColor.slice(0, 6)}`;
    return VAL_COLOR_PRESETS[settings.colorIndex] || "#FFFFFF";
  }

  function buildValorantCode(profile) {
    const inner = profile.primary.inner_lines;
    const chunks = ["0", "s;1", "P"];
    const hex = (profile.primary.u ?? "FFFFFF").slice(0, 6);
    chunks.push("c;8", `u;${hex}FF`);

    if (profile.primary.h) {
      chunks.push(`t;${profile.primary.t}`);
      chunks.push(`o;${profile.primary.o}`);
    } else {
      chunks.push("h;0");
    }

    chunks.push("b;1", "m;1");

    if (profile.primary.d) {
      chunks.push("d;1");
      chunks.push(`z;${profile.primary.z}`);
      chunks.push(`a;${profile.primary.a}`);
    }

    const defaults = VAL_PRIMARY_DEFAULT.inner_lines;
    if (inner.l !== defaults.l) chunks.push(`0l;${inner.l}`);

    const verticalLength = inner.g ? inner.v : inner.l;
    if (verticalLength !== defaults.v) chunks.push(`0v;${verticalLength}`);

    chunks.push(`0o;${inner.o}`);
    chunks.push(`0a;${inner.a}`);
    chunks.push(`0f;${+inner.f}`);
    chunks.push("1b;0");
    chunks.push("S", "c;0", "s;0.9", "o;1");
    return chunks.join(";");
  }

  function cs2ToValorantSettings(ch, { applyVisibilityFloor = true } = {}) {
    const profile = createValorantProfile();
    const notes = { lostFeatures: [], approximations: [] };
    const [red, green, blue] = cs2ColorRgb(ch);

    profile.primary.c = 8;
    profile.primary.u = rgbToCustomHex(red, green, blue);

    const outlines = ch.outlineEnabled && ch.outline > 0;
    profile.primary.h = outlines;
    if (outlines) {
      profile.primary.t = clamp(Math.round(ch.outline), 1, 6);
      profile.primary.o = 1;
    }

    profile.primary.d = ch.centerDotEnabled;
    if (ch.centerDotEnabled) {
      profile.primary.z = applyVisibilityFloor
        ? clamp(Math.round(ch.thickness * 2), 2, 6)
        : clamp(ch.thickness, 0.5, 6);
      profile.primary.a = round1(ch.alphaEnabled ? ch.alpha / 255 : 1);
    }

    const lengthScale = 2;
    const minLength = 2;
    const minThickness = 2;
    const thicknessScale = 2;
    const innerLength =
      applyVisibilityFloor && ch.length > 0
        ? clamp(Math.max(minLength, Math.round(ch.length * lengthScale)), 0, 20)
        : clamp(ch.length, 0, 20);
    const baselineOffset = Math.max(0, CS2_BASELINE_GAP + ch.gap);

    let innerOffset;
    if (applyVisibilityFloor) {
      innerOffset = ch.gap <= CS2_GAP_COLLAPSE ? 0 : clamp(Math.max(1, Math.round(baselineOffset)), 0, 20);
    } else {
      innerOffset = clamp(round1(baselineOffset), 0, 20);
    }

    let innerThickness = applyVisibilityFloor
      ? ch.thickness < 0.7
        ? 1
        : clamp(Math.max(minThickness, Math.round(ch.thickness * thicknessScale)), 1, 10)
      : clamp(ch.thickness, 0.1, 10);
    if (applyVisibilityFloor && innerLength > 0 && innerThickness > innerLength) innerThickness = innerLength;

    const innerOpacity = round1(ch.alphaEnabled ? ch.alpha / 255 : 1);
    const inner = profile.primary.inner_lines;
    inner.b = innerLength > 0;
    inner.l = innerLength;
    inner.v = innerLength;
    inner.t = innerThickness;
    inner.o = innerOffset;
    inner.a = innerOpacity;

    const classicStatic = ch.style === 4;
    inner.f = !classicStatic;
    inner.m = !classicStatic;
    profile.primary.outer_lines.b = false;

    if (ch.tStyleEnabled) notes.lostFeatures.push("T-style (no top line) — Valorant has no equivalent.");
    if (ch.followRecoil) notes.lostFeatures.push("Follow recoil — Valorant does not support recoil-following crosshairs.");
    if (ch.deployedWeaponGapEnabled) notes.lostFeatures.push("Per-weapon gap — Valorant has no per-weapon gap control.");
    if (ch.style === 5) notes.approximations.push("Legacy style approximated as dynamic Classic.");
    if (ch.gap < 0 && innerOffset === 0) {
      notes.approximations.push(
        `Negative gap (${ch.gap}) closes CS2's natural ~4px baseline gap — converted Valorant offset clamped to 0 (lines touch center).`,
      );
    }
    if (ch.length % 1 !== 0 || ch.thickness % 1 !== 0 || ch.outline % 1 !== 0 || ch.gap % 1 !== 0) {
      notes.approximations.push("CS2 sub-pixel sizes rounded to integers (Valorant uses integer pixels).");
    }

    return {
      profile,
      code: buildValorantCode(profile),
      notes,
    };
  }

  function valorantToCs2Settings(profile) {
    const cs2 = { ...CS2_SETTINGS_DEFAULT };
    const notes = { lostFeatures: [], approximations: [] };
    const [red, green, blue] = valorantColorRgb(profile);

    cs2.color = 5;
    cs2.red = red;
    cs2.green = green;
    cs2.blue = blue;

    const inner = profile.primary.inner_lines;
    cs2.length = inner.b ? clamp(round1(inner.l * VAL_TO_CS2_LENGTH), 0, 10) : 0;
    cs2.thickness = clamp(round1(inner.t * VAL_TO_CS2_THICKNESS), 0.1, 6);
    cs2.gap = clamp(round1(inner.o - CS2_BASELINE_GAP), -10, 10);
    cs2.alphaEnabled = true;
    cs2.alpha = clamp(Math.round(inner.a * 255), 0, 255);

    const dynamic = inner.f || inner.m;
    cs2.style = dynamic ? 0 : 4;

    const outlineOpacity = profile.primary.o;
    cs2.outlineEnabled = profile.primary.h && outlineOpacity > 0;
    cs2.outline = cs2.outlineEnabled ? clamp(profile.primary.t / 2, 0, 3) : 1;
    cs2.centerDotEnabled = profile.primary.d;
    cs2.followRecoil = false;
    cs2.tStyleEnabled = false;
    cs2.deployedWeaponGapEnabled = false;
    cs2.fixedCrosshairGap = cs2.gap;

    const outer = profile.primary.outer_lines;
    if (outer.b && outer.l > 0) {
      notes.lostFeatures.push(
        `Valorant outer lines (length ${outer.l}, offset ${outer.o}) discarded — CS2 has only one line set.`,
      );
    }
    if (profile.use_advanced_options && !profile.ads_copy_primary) {
      notes.lostFeatures.push("Separate ADS crosshair settings discarded — CS2 uses one crosshair for everything.");
    }
    if (profile.use_advanced_options) {
      notes.lostFeatures.push("Sniper-scope dot settings discarded — CS2 has no per-scope crosshair.");
    }
    if (cs2.outlineEnabled && outlineOpacity !== 1) {
      notes.approximations.push(`Valorant outline opacity (${outlineOpacity}) ignored — CS2 outlines have no separate opacity.`);
    }
    if (inner.g) {
      notes.lostFeatures.push("Asymmetric inner-line lengths (vertical ≠ horizontal) discarded — CS2 lines must be symmetric.");
    }

    return {
      cs2,
      code: encodeCs2ShareCode(cs2),
      notes,
    };
  }

  function cs2DecodedToPreviewSettings(ch) {
    return {
      gap: ch.gap,
      outlineThickness: ch.outline,
      r: ch.red,
      g: ch.green,
      b: ch.blue,
      alpha: ch.alpha,
      outline: ch.outlineEnabled,
      color: ch.color,
      thickness: ch.thickness,
      dot: ch.centerDotEnabled,
      t: ch.tStyleEnabled,
      useAlpha: ch.alphaEnabled,
      style: ch.style,
      size: ch.length,
    };
  }

  function formatConversionNotes(notes) {
    return [...(notes?.lostFeatures ?? []), ...(notes?.approximations ?? [])];
  }

  const AIM_TRAINER_COLORS = ["#00ff00", "#ffffff", "#00e5ff", "#ff00d4", "#ffea00"];

  function nearestAimTrainerColor(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return AIM_TRAINER_COLORS[0];
    let best = AIM_TRAINER_COLORS[0];
    let bestDist = Infinity;
    AIM_TRAINER_COLORS.forEach((preset) => {
      const prgb = hexToRgb(preset);
      const dist = (rgb[0] - prgb[0]) ** 2 + (rgb[1] - prgb[1]) ** 2 + (rgb[2] - prgb[2]) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = preset;
      }
    });
    return best;
  }

  function previewToAimTrainerCrosshair(preview) {
    if (!preview) return null;

    if (preview.game === "cs2") {
      const ch = preview.settings;
      const hasLines = ch.size > 0;
      return {
        lines: hasLines,
        size: hasLines ? clamp(Math.round(ch.size), 2, 30) : 10,
        gap: clamp(Math.round(Math.max(0, -ch.gap)), 0, 20),
        thickness: clamp(Math.max(1, Math.round(ch.thickness)), 1, 10),
        outlineThickness: clamp(Math.max(1, Math.round(ch.outlineThickness)), 1, 10),
        color: nearestAimTrainerColor(rgbToHex(ch.r, ch.g, ch.b)),
        dot: Boolean(ch.dot),
        outline: Boolean(ch.outline),
      };
    }

    const val = preview.settings;
    const hasLines = val.innerEnabled !== false && (val.innerLength ?? 0) > 0;
    return {
      lines: hasLines,
      size: hasLines ? clamp(Math.round(val.innerLength), 2, 30) : 10,
      gap: clamp(Math.round(val.innerOffset), 0, 20),
      thickness: clamp(Math.max(1, Math.round(val.innerThickness)), 1, 10),
      outlineThickness: clamp(Math.max(1, Math.round(val.outlineThickness)), 1, 10),
      color: nearestAimTrainerColor(valorantColorHex(val)),
      dot: Boolean(val.dot),
      outline: Boolean(val.outlines),
    };
  }

  function analyzeCrosshair(input, direction) {
    const trimmed = input.trim();
    if (!trimmed) return { kind: "empty" };

    try {
      if (direction === "cs2-to-val") {
        const decoded = decodeCs2ShareCode(trimmed);
        return { kind: "forward", cs2: decoded, conversion: cs2ToValorantSettings(decoded) };
      }
      const profile = parseValorantCode(trimmed);
      return { kind: "reverse", valorant: profile, conversion: valorantToCs2Settings(profile) };
    } catch (error) {
      return { kind: "error", message: error instanceof Error ? error.message : String(error) };
    }
  }

  function convertCrosshair(input, direction) {
    const analysis = analyzeCrosshair(input, direction);

    if (analysis.kind === "empty") return { ok: false, empty: true };
    if (analysis.kind === "error") return { ok: false, error: analysis.message };

    if (analysis.kind === "forward") {
      return {
        ok: true,
        output: analysis.conversion.code,
        preview: { game: "valorant", settings: valorantProfileToPreviewSettings(analysis.conversion.profile) },
        warnings: formatConversionNotes(analysis.conversion.notes),
      };
    }

    return {
      ok: true,
      output: analysis.conversion.code,
      preview: { game: "cs2", settings: cs2DecodedToPreviewSettings(analysis.conversion.cs2) },
      warnings: formatConversionNotes(analysis.conversion.notes),
    };
  }

  function drawValorantCrosshair(ctx, cx, cy, settings, scale) {
    const color = valorantColorHex(settings);
    const thickness = Math.max(1, settings.innerThickness * scale);
    const horizontalLength = settings.innerLength * scale;
    const verticalLength = (settings.lengthNotLinked ? settings.innerVertical : settings.innerLength) * scale;
    const offset = settings.innerOffset * scale;
    const outlineW = settings.outlines ? Math.max(1, settings.outlineThickness * scale) : 0;
    const outlineAlpha = settings.outlineOpacity ?? 0.5;
    const alpha = settings.innerOpacity ?? 1;

    const snap = (v, w) => (w % 2 === 0 ? Math.round(v) : Math.round(v - 0.5) + 0.5);
    const x = snap(cx, thickness);
    const y = snap(cy, thickness);

    const drawArm = (x1, y1, x2, y2) => {
      if (outlineW > 0) {
        ctx.strokeStyle = `rgba(0,0,0,${outlineAlpha})`;
        ctx.lineWidth = thickness + outlineW * 2;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
      ctx.strokeStyle = color.replace(")", `, ${alpha})`).replace("rgb", "rgba").replace("#", "");
      if (color.startsWith("#")) {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        ctx.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
      }
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    };

    if (settings.innerEnabled && (horizontalLength > 0 || verticalLength > 0)) {
      drawArm(x, y - offset - verticalLength, x, y - offset);
      drawArm(x, y + offset, x, y + offset + verticalLength);
      drawArm(x - offset - horizontalLength, y, x - offset, y);
      drawArm(x + offset, y, x + offset + horizontalLength, y);
    }

    if (settings.dot) {
      const dotSize = Math.max(1, (settings.dotThickness || 2) * scale);
      const dotLeft = Math.round(cx - dotSize / 2);
      const dotTop = Math.round(cy - dotSize / 2);
      const dotAlpha = settings.dotOpacity ?? 1;

      if (outlineW > 0) {
        const outlineSize = dotSize + outlineW * 2;
        const outlineLeft = Math.round(cx - outlineSize / 2);
        const outlineTop = Math.round(cy - outlineSize / 2);
        ctx.fillStyle = `rgba(0,0,0,${outlineAlpha})`;
        ctx.fillRect(outlineLeft, outlineTop, outlineSize, outlineSize);
      }

      if (color.startsWith("#")) {
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${r},${g},${b},${dotAlpha})`;
      } else {
        ctx.fillStyle = color;
      }
      ctx.fillRect(dotLeft, dotTop, dotSize, dotSize);
    }
  }

  function drawCs2Crosshair(ctx, cx, cy, ch, scale) {
    const color = cs2ColorToHex(ch);
    const size = Math.max(0, ch.size * scale);
    const gap = Math.max(0, -ch.gap * scale);
    const thickness = Math.max(1, ch.thickness * scale);
    const outlineExtra = ch.outline ? Math.max(1, ch.outlineThickness * scale) : 0;

    const snap = (v, w) => (w % 2 === 0 ? Math.round(v) : Math.round(v - 0.5) + 0.5);
    const x = snap(cx, thickness);
    const y = snap(cy, thickness);

    const drawLines = (stroke, lineWidth) => {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "butt";
      ctx.beginPath();
      if (!ch.t) {
        ctx.moveTo(x, y - gap);
        ctx.lineTo(x, y - gap - size);
        ctx.moveTo(x, y + gap);
        ctx.lineTo(x, y + gap + size);
      }
      ctx.moveTo(x - gap, y);
      ctx.lineTo(x - gap - size, y);
      ctx.moveTo(x + gap, y);
      ctx.lineTo(x + gap + size, y);
      ctx.stroke();
    };

    if (size > 0) {
      if (ch.outline) drawLines("#000000", thickness + outlineExtra * 2);
      drawLines(color, thickness);
    }

    if (ch.dot) {
      const dotSize = Math.max(1, Math.round(thickness));
      const dotLeft = Math.round(cx - dotSize / 2);
      const dotTop = Math.round(cy - dotSize / 2);

      if (ch.outline && outlineExtra > 0) {
        const outlineSize = dotSize + outlineExtra * 2;
        const outlineLeft = Math.round(cx - outlineSize / 2);
        const outlineTop = Math.round(cy - outlineSize / 2);
        ctx.fillStyle = "#000000";
        ctx.fillRect(outlineLeft, outlineTop, outlineSize, outlineSize);
      }

      ctx.fillStyle = color;
      ctx.fillRect(dotLeft, dotTop, dotSize, dotSize);
    }
  }

  function resolvePreviewAssetUrl(path) {
    if (typeof window.resolveAppAssetUrl === "function") return window.resolveAppAssetUrl(path);

    const script = document.querySelector('script[src*="script.js"]');
    if (!script?.src) return path;
    try {
      const { pathname } = new URL(script.src);
      const base = pathname.replace(/\/?script\.js$/i, "");
      const prefix = base.endsWith("/") ? base : `${base}/`;
      const clean = String(path).replace(/^\.\//, "").replace(/^\//, "");
      return `${prefix}${clean}`;
    } catch {
      return path;
    }
  }

  const PREVIEW_BACKGROUNDS = ["assets/crosshair-preview-bg.png", "assets/crosshair-preview-bg-2.png", "assets/crosshair-preview-bg-3.png"];
  const PREVIEW_REF_WIDTH = 1920;
  const PREVIEW_REF_HEIGHT = 1080;
  const previewBgCache = new Map();

  function loadPreviewBackground(index = state.bgIndex) {
    const src = PREVIEW_BACKGROUNDS[index];
    if (!src) return Promise.resolve(null);

    const cached = previewBgCache.get(src);
    if (cached?.complete && cached.naturalWidth > 0) return Promise.resolve(cached);

    return new Promise((resolve) => {
      const img = cached || new Image();
      if (!cached) previewBgCache.set(src, img);

      if (img.complete && img.naturalWidth > 0) {
        resolve(img);
        return;
      }

      img.decoding = "async";
      img.onload = () => resolve(img);
      img.onerror = () => {
        previewBgCache.delete(src);
        resolve(null);
      };
      img.src = resolvePreviewAssetUrl(src);
    });
  }

  function preloadAllPreviewBackgrounds() {
    return Promise.all(PREVIEW_BACKGROUNDS.map((_, index) => loadPreviewBackground(index)));
  }

  function getPreviewBgImageAt(index) {
    const src = PREVIEW_BACKGROUNDS[index];
    if (!src) return null;
    const img = previewBgCache.get(src);
    return img?.complete && img.naturalWidth > 0 ? img : null;
  }

  function setPreviewBackgroundIndex(nextIndex, direction = 1) {
    const total = PREVIEW_BACKGROUNDS.length;
    if (total <= 0 || bgSlideAnimation) return;

    const targetIndex = ((nextIndex % total) + total) % total;
    if (targetIndex === state.bgIndex) return;

    const fromIndex = state.bgIndex;
    const slideDirection = direction >= 0 ? 1 : -1;

    Promise.all([loadPreviewBackground(fromIndex), loadPreviewBackground(targetIndex)]).then(() => {
      if (!prefersCrosshairMotion()) {
        state.bgIndex = targetIndex;
        redrawCrosshairPreview();
        return;
      }
      startBgSlideAnimation(fromIndex, targetIndex, slideDirection);
    });
  }

  function redrawCrosshairPreview() {
    const canvas = document.getElementById("crosshair-converter-preview");
    if (!canvas) return;
    drawCrosshairPreview(canvas, state.lastPreview, getCrosshairPreviewZoom());
  }

  function drawPreviewBackgroundFallback(ctx, w, h) {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "hsl(220, 12%, 18%)");
    bg.addColorStop(1, "hsl(220, 10%, 12%)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
  }

  function drawPreviewBackgroundImage(ctx, w, h, img) {
    if (!img) return false;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, w, h);
    return true;
  }

  function drawCrosshairOnPreview(ctx, w, h, preview) {
    if (!preview) return;
    const scale = h / 1080;
    const cx = w / 2;
    const cy = h / 2;

    if (preview.game === "valorant") drawValorantCrosshair(ctx, cx, cy, preview.settings, scale);
    else drawCs2Crosshair(ctx, cx, cy, preview.settings, scale);
  }

  function drawPreviewSceneLayer(ctx, w, h, preview, bgIndex) {
    const img = getPreviewBgImageAt(bgIndex);
    if (!drawPreviewBackgroundImage(ctx, w, h, img)) {
      drawPreviewBackgroundFallback(ctx, w, h);
      loadPreviewBackground(bgIndex).then((loaded) => {
        if (loaded) redrawCrosshairPreview();
      });
    }
    drawCrosshairOnPreview(ctx, w, h, preview);
  }

  function resizeCrosshairPreviewCanvas(canvas) {
    if (!canvas) return false;

    const dpr = window.devicePixelRatio || 1;
    const nextW = Math.max(1, Math.round(PREVIEW_REF_WIDTH * dpr));
    const nextH = Math.max(1, Math.round(PREVIEW_REF_HEIGHT * dpr));
    if (canvas.width === nextW && canvas.height === nextH) return false;

    canvas.width = nextW;
    canvas.height = nextH;
    return true;
  }

  function drawCrosshairPreview(canvas, preview, zoom) {
    if (!canvas) return;
    resizeCrosshairPreviewCanvas(canvas);
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const z = Math.max(1, zoom || 1);

    ctx.clearRect(0, 0, w, h);
    ctx.save();

    if (z > 1) {
      ctx.translate(w / 2, h / 2);
      ctx.scale(z, z);
      ctx.translate(-w / 2, -h / 2);
    }

    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    if (bgSlideAnimation) {
      const progress = Math.min(1, (performance.now() - bgSlideAnimation.start) / BG_SLIDE_ANIMATION_MS);
      const t = easeInOutCubic(progress);
      const dir = bgSlideAnimation.direction;
      const fromX = dir === 1 ? -t * w : t * w;
      const toX = dir === 1 ? (1 - t) * w : -(1 - t) * w;

      ctx.save();
      ctx.translate(fromX, 0);
      drawPreviewSceneLayer(ctx, w, h, preview, bgSlideAnimation.fromIndex);
      ctx.restore();

      ctx.save();
      ctx.translate(toX, 0);
      drawPreviewSceneLayer(ctx, w, h, preview, bgSlideAnimation.toIndex);
      ctx.restore();
    } else {
      drawPreviewSceneLayer(ctx, w, h, preview, state.bgIndex);
    }

    ctx.restore();
  }

  const ZOOM_ANIMATION_MS = 300;
  const BG_SLIDE_ANIMATION_MS = 500;
  let zoomAnimationFrame = null;
  let bgSlideAnimation = null;
  let bgSlideAnimationFrame = null;

  function prefersCrosshairMotion() {
    return prefersCrosshairZoomMotion();
  }

  function setPreviewNavDisabled(disabled) {
    const prev = document.getElementById("crosshair-converter-preview-prev");
    const next = document.getElementById("crosshair-converter-preview-next");
    prev?.toggleAttribute("disabled", disabled);
    next?.toggleAttribute("disabled", disabled);
  }

  function cancelBgSlideAnimation() {
    if (bgSlideAnimationFrame !== null) {
      cancelAnimationFrame(bgSlideAnimationFrame);
      bgSlideAnimationFrame = null;
    }
    bgSlideAnimation = null;
    setPreviewNavDisabled(false);
  }

  function startBgSlideAnimation(fromIndex, toIndex, direction) {
    cancelBgSlideAnimation();
    const canvas = document.getElementById("crosshair-converter-preview");
    if (!canvas) {
      state.bgIndex = toIndex;
      return;
    }

    bgSlideAnimation = {
      fromIndex,
      toIndex,
      direction,
      start: performance.now(),
    };
    setPreviewNavDisabled(true);

    const tick = (now) => {
      if (!bgSlideAnimation) return;

      drawCrosshairPreview(canvas, state.lastPreview, getCrosshairPreviewZoom());

      const progress = Math.min(1, (now - bgSlideAnimation.start) / BG_SLIDE_ANIMATION_MS);
      if (progress < 1) {
        bgSlideAnimationFrame = requestAnimationFrame(tick);
        return;
      }

      state.bgIndex = bgSlideAnimation.toIndex;
      cancelBgSlideAnimation();
      drawCrosshairPreview(canvas, state.lastPreview, getCrosshairPreviewZoom());
    };

    bgSlideAnimationFrame = requestAnimationFrame(tick);
  }

  function prefersCrosshairZoomMotion() {
    return !document.body.classList.contains("reduce-motion") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
  }

  function cancelCrosshairZoomAnimation() {
    if (zoomAnimationFrame !== null) {
      cancelAnimationFrame(zoomAnimationFrame);
      zoomAnimationFrame = null;
    }
  }

  function getCrosshairPreviewZoom() {
    return state.displayZoom ?? state.zoom;
  }

  function updateCrosshairPreviewNote() {
    const previewNote = document.getElementById("crosshair-converter-preview-note");
    if (!previewNote) return;
    if (!state.lastPreview) {
      previewNote.textContent = "Preview appears after a valid code is converted.";
      return;
    }
    previewNote.textContent = state.zoom > 1 ? `Preview is approximate at 1080p with ${state.zoom}× zoom.` : "Preview is approximate at 1080p reference scale.";
  }

  function animateCrosshairPreviewZoom(targetZoom) {
    cancelCrosshairZoomAnimation();
    const canvas = document.getElementById("crosshair-converter-preview");
    if (!canvas) return;

    const fromZoom = getCrosshairPreviewZoom();
    state.zoom = targetZoom;
    updateCrosshairPreviewNote();

    if (!prefersCrosshairZoomMotion() || fromZoom === targetZoom) {
      state.displayZoom = targetZoom;
      drawCrosshairPreview(canvas, state.lastPreview, state.displayZoom);
      updateCrosshairPreviewNote();
      return;
    }

    const start = performance.now();

    const tick = (now) => {
      const progress = Math.min(1, (now - start) / ZOOM_ANIMATION_MS);
      state.displayZoom = fromZoom + (targetZoom - fromZoom) * easeInOutCubic(progress);
      drawCrosshairPreview(canvas, state.lastPreview, state.displayZoom);

      if (progress < 1) {
        zoomAnimationFrame = requestAnimationFrame(tick);
        return;
      }

      state.displayZoom = targetZoom;
      zoomAnimationFrame = null;
    };

    zoomAnimationFrame = requestAnimationFrame(tick);
  }

  let state = {
    direction: "cs2-to-val",
    zoom: 1,
    displayZoom: 1,
    bgIndex: 0,
    lastPreview: null,
  };

  const CROSSHAIR_DIRECTION_PARTS = {
    "cs2-to-val": { from: "CS2", to: "Valorant" },
    "val-to-cs2": { from: "Valorant", to: "CS2" },
  };

  function syncCrosshairDirectionDropdown(dir) {
    const label = document.getElementById("crosshair-converter-direction-label");
    const list = document.getElementById("crosshair-converter-direction-list");
    const parts = CROSSHAIR_DIRECTION_PARTS[dir] || CROSSHAIR_DIRECTION_PARTS["cs2-to-val"];
    if (label) {
      label.querySelector(".crosshair-direction-from").textContent = parts.from;
      label.querySelector(".crosshair-direction-to").textContent = parts.to;
    }
    list?.querySelectorAll("[data-crosshair-direction]").forEach((opt) => {
      opt.classList.toggle("active", opt.dataset.crosshairDirection === dir);
    });
  }

  function setCrosshairConverterDirection(dir) {
    if (dir !== "cs2-to-val" && dir !== "val-to-cs2") return;
    state.direction = dir;
    syncCrosshairDirectionDropdown(dir);
  }

  function initCrosshairDirectionDropdown() {
    const dropdown = document.getElementById("crosshair-converter-direction-dropdown");
    const trigger = document.getElementById("crosshair-converter-direction-trigger");
    const list = document.getElementById("crosshair-converter-direction-list");
    if (!dropdown || !trigger || !list || initCrosshairDirectionDropdown._init) return;
    initCrosshairDirectionDropdown._init = true;

    const close = () => {
      dropdown.classList.remove("is-open");
      trigger.setAttribute("aria-expanded", "false");
      list.classList.add("hidden");
      if (typeof unmountPrefDropdownPortal === "function") unmountPrefDropdownPortal(list);
    };

    const open = () => {
      if (typeof hideAllGameDropdownLists === "function") hideAllGameDropdownLists();
      initProfileModeDropdown?.close?.();
      initProfileTimerDropdown?.close?.();
      dropdown.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      list.classList.remove("hidden");
      if (typeof mountPrefDropdownPortal === "function") mountPrefDropdownPortal(list, trigger);
    };

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains("is-open")) close();
      else open();
    });

    trigger.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      if (dropdown.classList.contains("is-open")) close();
      else open();
    });

    list.querySelectorAll("[data-crosshair-direction]").forEach((opt) => {
      opt.addEventListener("click", () => {
        const dir = opt.dataset.crosshairDirection;
        if (!dir || dir === state.direction) {
          close();
          return;
        }
        setCrosshairConverterDirection(dir);
        updateCrosshairConverterUi();
        close();
      });
    });

    document.addEventListener("click", (e) => {
      if (dropdown.contains(e.target) || list.contains(e.target)) return;
      close();
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && dropdown.classList.contains("is-open")) {
        e.preventDefault();
        close();
        trigger.blur();
      }
    });

    syncCrosshairDirectionDropdown(state.direction);
  }

  function getCrosshairConverterOutputCode() {
    return document.getElementById("crosshair-converter-output-code")?.textContent?.trim() || "";
  }

  function setCrosshairConverterOutput(code) {
    const outputWrap = document.getElementById("crosshair-converter-output");
    const outputCode = document.getElementById("crosshair-converter-output-code");
    if (!outputWrap || !outputCode) return;

    const value = code?.trim() || "";
    outputCode.textContent = value;

    if (value) {
      outputWrap.classList.remove("is-empty");
    } else {
      outputWrap.classList.add("is-empty");
    }
  }

  function copyCrosshairConverterOutput() {
    const code = getCrosshairConverterOutputCode();
    if (!code) return;
    copyText?.(code, "Crosshair code copied.");
  }

  function updateCrosshairConverterUi() {
    const input = document.getElementById("crosshair-converter-input");
    const warningsEl = document.getElementById("crosshair-converter-warnings");
    const canvas = document.getElementById("crosshair-converter-preview");

    if (!input) return;

    const isCs2ToVal = state.direction === "cs2-to-val";
    if (input) input.placeholder = isCs2ToVal ? "CSGO-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX" : "0;P;c;1;0t;1;0l;4;0o;2;…";

    const result = convertCrosshair(input.value, state.direction);
    if (!result.ok) {
      setCrosshairConverterOutput("");
      state.lastPreview = null;
      if (warningsEl) {
        const hasError = Boolean(result.error);
        warningsEl.hidden = !hasError;
        warningsEl.textContent = hasError ? result.error : "";
        warningsEl.classList.toggle("is-error", hasError);
      }
      if (canvas) drawCrosshairPreview(canvas, null, getCrosshairPreviewZoom());
      updateCrosshairPreviewNote();
      toggleVisibility?.(document.getElementById("crosshair-converter-share"), false);
      toggleVisibility?.(document.getElementById("crosshair-converter-use"), false);
      toggleVisibility?.(document.getElementById("crosshair-converter-reset"), false);
      toggleVisibility?.(document.getElementById("crosshair-converter-copy"), false);
      return;
    }

    setCrosshairConverterOutput(result.output);
    state.lastPreview = result.preview;
    if (warningsEl) {
      warningsEl.classList.remove("is-error");
      warningsEl.hidden = !result.warnings?.length;
      warningsEl.textContent = result.warnings?.join(" ") || "";
    }
    if (canvas) {
      state.displayZoom = state.zoom;
      cancelCrosshairZoomAnimation();
      drawCrosshairPreview(canvas, result.preview, getCrosshairPreviewZoom());
    }
    updateCrosshairPreviewNote();
    toggleVisibility?.(document.getElementById("crosshair-converter-share"), true);
    toggleVisibility?.(document.getElementById("crosshair-converter-use"), true);
    toggleVisibility?.(document.getElementById("crosshair-converter-reset"), true);
    toggleVisibility?.(document.getElementById("crosshair-converter-copy"), true);
  }

  function initCrosshairConverterTab() {
    const section = document.getElementById("crosshair-converter-tab");
    if (!section || initCrosshairConverterTab._init) return;
    initCrosshairConverterTab._init = true;

    const input = document.getElementById("crosshair-converter-input");
    const copyBtn = document.getElementById("crosshair-converter-copy");
    const useBtn = document.getElementById("crosshair-converter-use");
    const resetBtn = document.getElementById("crosshair-converter-reset");
    const zoomSelector = document.getElementById("crosshair-converter-zoom-selector");
    const previewWrap = document.querySelector(".crosshair-converter-preview-wrap");
    const previewPrev = document.getElementById("crosshair-converter-preview-prev");
    const previewNext = document.getElementById("crosshair-converter-preview-next");

    initCrosshairDirectionDropdown();
    input?.addEventListener("input", updateCrosshairConverterUi);

    if (section && typeof IntersectionObserver !== "undefined" && !initCrosshairConverterTab._previewVisibilityObserver) {
      initCrosshairConverterTab._previewVisibilityObserver = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) redrawCrosshairPreview();
        },
        { threshold: 0.01 },
      );
      initCrosshairConverterTab._previewVisibilityObserver.observe(section);
    }

    if (!initCrosshairConverterTab._previewWindowResizeListener) {
      initCrosshairConverterTab._previewWindowResizeListener = true;
      window.addEventListener(
        "resize",
        () => {
          if (section?.style.display === "none") return;
          redrawCrosshairPreview();
        },
        { passive: true },
      );
    }

    if (previewWrap && typeof ResizeObserver !== "undefined" && !initCrosshairConverterTab._previewResizeObserver) {
      initCrosshairConverterTab._previewResizeObserver = new ResizeObserver(() => redrawCrosshairPreview());
      initCrosshairConverterTab._previewResizeObserver.observe(previewWrap);
    }

    previewPrev?.addEventListener("click", () => setPreviewBackgroundIndex(state.bgIndex - 1, -1));
    previewNext?.addEventListener("click", () => setPreviewBackgroundIndex(state.bgIndex + 1, 1));

    zoomSelector?.querySelectorAll("[data-crosshair-zoom]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const zoom = Number(btn.dataset.crosshairZoom);
        if (![1, 2, 4].includes(zoom) || zoom === state.zoom) return;
        zoomSelector.querySelectorAll("[data-crosshair-zoom]").forEach((b) => {
          b.classList.toggle("active", Number(b.dataset.crosshairZoom) === zoom);
        });
        updateAllToggleGliders?.();
        animateCrosshairPreviewZoom(zoom);
      });
    });

    copyBtn?.addEventListener("click", copyCrosshairConverterOutput);

    useBtn?.addEventListener("click", () => {
      if (!state.lastPreview) return;
      const mapped = previewToAimTrainerCrosshair(state.lastPreview);
      if (!mapped || typeof aimTrainer?.applyCrosshair !== "function") return;
      aimTrainer.applyCrosshair(mapped);
      window.Toast?.notify?.({ message: "Crosshair applied to aim trainer.", type: "success" });
    });

    resetBtn?.addEventListener("click", () => {
      confirmBeforeReset?.("Reset the crosshair converter fields?", () => {
        if (input) input.value = "";
        updateCrosshairConverterUi();
        input?.blur();
      });
    });

    updateCrosshairConverterUi();
    updateAllToggleGliders?.();
    preloadAllPreviewBackgrounds().then(() => redrawCrosshairPreview());
  }

  window.initCrosshairConverterTab = initCrosshairConverterTab;
  window.updateCrosshairConverterUi = updateCrosshairConverterUi;
  window.setCrosshairConverterDirection = setCrosshairConverterDirection;
})();
