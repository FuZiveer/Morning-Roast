/* CS2 ↔ Valorant crosshair converter — runs fully client-side */
(function () {
  const CS2_SHARECODE_PATTERN = /CSGO(-?[\w]{5}){5}$/i;
  const CS2_DICTIONARY = "ABCDEFGHJKLMNOPQRSTUVWXYZabcdefhijkmnopqrstuvwxyz23456789";
  const CS2_DICTIONARY_LEN = BigInt(CS2_DICTIONARY.length);

  const VAL_COLOR_PRESETS = ["#FFFFFF", "#00FF00", "#7FFF00", "#DFFF00", "#FFFF00", "#00FFFF", "#FF00FF", "#FF0000"];

  const CS2_COLOR_RGB = {
    0: [255, 0, 0],
    1: [50, 250, 50],
    2: [255, 255, 0],
    3: [0, 0, 255],
    4: [0, 255, 255],
    5: null,
  };

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeCs2ShareCodeInput(code) {
    return code.trim().replace(/\s+/g, "").replace(/^csgo/i, "CSGO");
  }

  function dec2bin(dec) {
    return (dec >>> 0).toString(2).padStart(3, "0");
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

  function hexToRgb(hex) {
    const clean = hex.replace("#", "");
    if (clean.length < 6) return null;
    return [parseInt(clean.slice(0, 2), 16), parseInt(clean.slice(2, 4), 16), parseInt(clean.slice(4, 6), 16)];
  }

  function nearestValorantColorIndex(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb) return 8;
    let best = 0;
    let bestDist = Infinity;
    VAL_COLOR_PRESETS.forEach((preset, idx) => {
      const prgb = hexToRgb(preset);
      const dist = (rgb[0] - prgb[0]) ** 2 + (rgb[1] - prgb[1]) ** 2 + (rgb[2] - prgb[2]) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = idx;
      }
    });
    return bestDist < 900 ? best : 8;
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
      return {
        size: clamp(Math.round(ch.size), 2, 30),
        gap: clamp(Math.round(Math.max(0, -ch.gap)), 0, 20),
        thickness: clamp(Math.max(1, Math.round(ch.thickness)), 1, 10),
        outlineThickness: clamp(Math.max(1, Math.round(ch.outlineThickness)), 1, 10),
        color: nearestAimTrainerColor(cs2ColorToHex(ch)),
        dot: Boolean(ch.dot),
        outline: Boolean(ch.outline),
      };
    }

    const val = preview.settings;
    return {
      size: clamp(Math.round(val.innerLength), 2, 30),
      gap: clamp(Math.round(val.innerOffset), 0, 20),
      thickness: clamp(Math.max(1, Math.round(val.innerThickness)), 1, 10),
      outlineThickness: clamp(Math.max(1, Math.round(val.outlineThickness)), 1, 10),
      color: nearestAimTrainerColor(valorantColorHex(val)),
      dot: Boolean(val.dot),
      outline: Boolean(val.outlines),
    };
  }

  function uint8ToInt8(number) {
    return (number << 24) >> 24;
  }

  function sumArray(array) {
    return array.reduce((prev, value) => prev + value, 0);
  }

  function shareCodeToBytes(shareCode) {
    const normalized = normalizeCs2ShareCodeInput(shareCode);
    if (!CS2_SHARECODE_PATTERN.test(normalized)) return null;

    const stripped = normalized.replace(/^CSGO|-/gi, "");
    const chars = Array.from(stripped).reverse();
    let big = 0n;
    chars.forEach((char) => {
      const idx = CS2_DICTIONARY.indexOf(char);
      if (idx === -1) throw new Error("invalid char");
      big = big * CS2_DICTIONARY_LEN + BigInt(idx);
    });

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

  function decodeCs2ShareCodeV4(bytes) {
    const checksum = sumArray(bytes.slice(1)) % 256;
    if (bytes[0] !== checksum) return null;

    return {
      gap: uint8ToInt8(bytes[2]) / 10,
      outlineThickness: bytes[3] / 2,
      r: bytes[4],
      g: bytes[5],
      b: bytes[6],
      alpha: bytes[7],
      outline: (bytes[10] & 8) === 8,
      color: bytes[10] & 7,
      thickness: bytes[12] / 10,
      dot: ((bytes[13] >> 4) & 1) === 1,
      t: ((bytes[13] >> 4) & 8) === 8,
      useAlpha: ((bytes[13] >> 4) & 4) === 4,
      style: (bytes[13] & 0xf) >> 1,
      size: bytes[14] / 10,
    };
  }

  function decodeCs2ShareCodeLegacy(bytes) {
    if (bytes.length < 16) return null;

    let byte2 = dec2bin(bytes[2]);
    let gap;
    if (byte2.length === 8 && byte2.startsWith("1")) {
      byte2 = byte2.padStart(32, "1");
      gap = Math.ceil(Number.parseInt(byte2, 2) / 10);
    } else {
      gap = Math.floor(bytes[2] / 10);
    }

    const byte10 = dec2bin(bytes[10]);
    const byte13 = dec2bin(bytes[13]).padStart(8, "0");
    const byte14 = dec2bin(bytes[14]).padStart(8, "0");
    const byte15 = dec2bin(bytes[15]);

    return {
      gap: clamp(gap, -12, 12),
      outlineThickness: clamp(bytes[3] / 2, 0, 3),
      r: clamp(bytes[4], 0, 255),
      g: clamp(bytes[5], 0, 255),
      b: clamp(bytes[6], 0, 255),
      alpha: clamp(bytes[7], 0, 255),
      outline: parseInt(byte10.substring(4, 5), 2) === 1,
      color: clamp(parseInt(byte10.substring(5, 8), 2), 1, 5),
      thickness: clamp(bytes[12] / 10, 0, 6),
      dot: parseInt(byte13.substring(3, 4), 2) === 1,
      t: parseInt(byte13.substring(0, 1), 2) === 1,
      useAlpha: parseInt(byte13.substring(1, 2), 2) === 1,
      style: clamp(parseInt(byte13.substring(4, 7), 2), 0, 5),
      size: clamp(Math.ceil(parseInt(byte15 + byte14, 2) / 10), 0, 100),
    };
  }

  function decodeCs2ShareCode(code) {
    try {
      const bytes = shareCodeToBytes(code);
      if (!bytes) return null;

      return decodeCs2ShareCodeV4(bytes) || decodeCs2ShareCodeLegacy(bytes);
    } catch {
      return null;
    }
  }

  function encodeCs2ShareCode(crosshair) {
    const bytes = [
      0,
      1,
      (crosshair.gap * 10) & 0xff,
      crosshair.outlineThickness * 2,
      crosshair.r,
      crosshair.g,
      crosshair.b,
      crosshair.alpha,
      0,
      0,
      (crosshair.color & 7) | (Number(crosshair.outline) << 3),
      0,
      crosshair.thickness * 10,
      (crosshair.style << 1) | (Number(crosshair.dot) << 4) | (Number(crosshair.useAlpha) << 6) | (Number(crosshair.t) << 7),
      crosshair.size * 10,
      0,
      0,
      0,
    ];
    bytes[0] = sumArray(bytes) & 0xff;
    return bytesToShareCode(bytes);
  }

  function cs2ColorToHex(ch) {
    const preset = CS2_COLOR_RGB[ch.color];
    if (preset && (!ch.r && !ch.g && !ch.b)) return rgbToHex(preset[0], preset[1], preset[2]);
    if (ch.r || ch.g || ch.b) return rgbToHex(ch.r, ch.g, ch.b);
    return preset ? rgbToHex(preset[0], preset[1], preset[2]) : "#00ff00";
  }

  function parseValorantCode(code) {
    const trimmed = code.trim();
    if (!trimmed.includes(";")) return null;

    const parts = trimmed.split(";");
    const pIndex = parts.indexOf("P");
    if (pIndex === -1) return null;

    let end = parts.length;
    ["A", "S", "NAME"].forEach((token) => {
      const idx = parts.indexOf(token, pIndex + 1);
      if (idx !== -1) end = Math.min(end, idx);
    });

    const settings = {
      colorIndex: 0,
      hexColor: "FFFFFF",
      outlines: true,
      outlineThickness: 1,
      outlineOpacity: 0.5,
      dot: false,
      dotThickness: 2,
      dotOpacity: 1,
      innerEnabled: true,
      innerLength: 6,
      innerThickness: 2,
      innerOffset: 3,
      innerOpacity: 0.8,
      outerEnabled: false,
    };

    for (let i = pIndex + 1; i < end; i += 2) {
      const key = parts[i];
      const raw = parts[i + 1];
      if (raw === undefined) break;

      switch (key) {
        case "c":
          settings.colorIndex = clamp(parseInt(raw, 10) || 0, 0, 8);
          break;
        case "u":
          settings.hexColor = raw.replace(/[^0-9a-fA-F]/g, "").slice(0, 8);
          break;
        case "h":
          settings.outlines = raw === "1";
          break;
        case "t":
          settings.outlineThickness = clamp(parseFloat(raw) || 1, 0, 6);
          break;
        case "o":
          settings.outlineOpacity = clamp(parseFloat(raw) || 0.5, 0, 1);
          break;
        case "d":
          settings.dot = raw === "1";
          break;
        case "z":
          settings.dotThickness = clamp(parseFloat(raw) || 2, 0, 6);
          break;
        case "a":
          settings.dotOpacity = clamp(parseFloat(raw) || 1, 0, 1);
          break;
        case "0b":
          settings.innerEnabled = raw === "1";
          break;
        case "0l":
          settings.innerLength = clamp(parseFloat(raw) || 0, 0, 20);
          break;
        case "0t":
          settings.innerThickness = clamp(parseFloat(raw) || 1, 0, 10);
          break;
        case "0o":
          settings.innerOffset = clamp(parseFloat(raw) || 0, 0, 20);
          break;
        case "0a":
          settings.innerOpacity = clamp(parseFloat(raw) || 1, 0, 1);
          break;
        case "1b":
          settings.outerEnabled = raw === "1";
          break;
        default:
          break;
      }
    }

    return settings;
  }

  function valorantColorHex(settings) {
    if (settings.colorIndex === 8 && settings.hexColor) return `#${settings.hexColor.slice(0, 6)}`;
    return VAL_COLOR_PRESETS[settings.colorIndex] || "#FFFFFF";
  }

  function buildValorantCode(settings) {
    const chunks = ["0", "P"];

    const colorIdx = settings.colorIndex;
    if (colorIdx === 8) {
      chunks.push("c", "8", "u", settings.hexColor.slice(0, 6).toUpperCase());
    } else if (colorIdx !== 0) {
      chunks.push("c", String(colorIdx));
    }

    if (!settings.outlines) {
      chunks.push("h", "0");
    } else {
      if (settings.outlineThickness !== 1) chunks.push("t", String(settings.outlineThickness));
      if (settings.outlineOpacity !== 0.5) chunks.push("o", String(settings.outlineOpacity));
    }

    if (settings.dot) {
      chunks.push("d", "1");
      if (settings.dotThickness !== 2) chunks.push("z", String(settings.dotThickness));
    }

    if (!settings.innerEnabled) {
      chunks.push("0b", "0");
    } else {
      chunks.push("0t", String(settings.innerThickness));
      chunks.push("0l", String(settings.innerLength));
      if (settings.innerOffset !== 3) chunks.push("0o", String(settings.innerOffset));
      if (settings.innerOpacity !== 1) chunks.push("0a", String(settings.innerOpacity));
    }

    chunks.push("0f", "0", "0m", "0", "1b", settings.outerEnabled ? "1" : "0");
    return chunks.join(";");
  }

  function cs2ToValorantSettings(ch) {
    const hex = cs2ColorToHex(ch);
    const colorIndex = nearestValorantColorIndex(hex);
    const innerLength = clamp(Math.round(ch.size + 1), 0, 10);
    const innerOffset = clamp(Math.round(Math.max(0, -ch.gap)), 0, 20);
    const innerThickness = clamp(Math.max(1, Math.round(ch.thickness)), 1, 10);

    return {
      colorIndex: colorIndex === 8 ? 8 : colorIndex,
      hexColor: hex.replace("#", "").toUpperCase(),
      outlines: ch.outline,
      outlineThickness: clamp(Math.round(ch.outlineThickness) || 1, 1, 6),
      outlineOpacity: ch.useAlpha ? clamp(ch.alpha / 255, 0.1, 1) : 0.5,
      dot: ch.dot,
      dotThickness: clamp(Math.max(1, Math.round(ch.thickness)), 1, 6),
      innerEnabled: !ch.t,
      innerLength,
      innerThickness,
      innerOffset,
      innerOpacity: ch.useAlpha ? clamp(ch.alpha / 255, 0.1, 1) : 1,
      outerEnabled: false,
    };
  }

  function valorantToCs2Settings(val) {
    const hex = valorantColorHex(val);
    const rgb = hexToRgb(hex) || [50, 250, 50];
    const colorIndex = val.colorIndex <= 7 ? val.colorIndex : 5;

    return {
      gap: -clamp(Math.round(val.innerOffset), 0, 12),
      outlineThickness: clamp(val.outlineThickness, 0, 3),
      r: rgb[0],
      g: rgb[1],
      b: rgb[2],
      alpha: Math.round((val.innerOpacity || 1) * 255),
      outline: val.outlines,
      color: colorIndex === 8 ? 5 : clamp(colorIndex, 1, 5),
      thickness: clamp(val.innerThickness / 2, 0.5, 6),
      t: !val.innerEnabled,
      useAlpha: true,
      dot: val.dot,
      style: 4,
      size: clamp(Math.round(val.innerLength - 1), 0, 100),
    };
  }

  function isCs2ShareCode(input) {
    return CS2_SHARECODE_PATTERN.test(normalizeCs2ShareCodeInput(input));
  }

  function isValorantCode(input) {
    return input.trim().includes(";") && (input.includes("P;") || input.startsWith("0;"));
  }

  function convertCrosshair(input, direction) {
    const trimmed = input.trim().replace(/\s+/g, direction === "cs2-to-val" ? "" : " ");
    if (!trimmed) return { ok: false, error: "Paste a crosshair code to convert." };

    if (direction === "cs2-to-val") {
      if (!isCs2ShareCode(trimmed) && !isValorantCode(trimmed)) {
        return { ok: false, error: "That doesn't look like a CS2 share code (CSGO-XXXXX-…)." };
      }
      if (isValorantCode(trimmed) && !isCs2ShareCode(trimmed)) {
        return { ok: false, error: "Switch to Valorant → CS2 or paste a CSGO share code." };
      }
      const decoded = decodeCs2ShareCode(trimmed);
      if (!decoded) return { ok: false, error: "Could not decode that CS2 share code." };
      const valSettings = cs2ToValorantSettings(decoded);
      return {
        ok: true,
        output: buildValorantCode(valSettings),
        preview: { game: "valorant", settings: valSettings },
        warnings: decoded.t ? ["CS2 T-style crosshair — converted as a standard cross."] : [],
      };
    }

    if (!isValorantCode(trimmed)) {
      return { ok: false, error: "That doesn't look like a Valorant crosshair code (0;P;…)." };
    }
    if (isCs2ShareCode(trimmed)) {
      return { ok: false, error: "Switch to CS2 → Valorant or paste a Valorant import code." };
    }
    const parsed = parseValorantCode(trimmed);
    if (!parsed) return { ok: false, error: "Could not parse that Valorant crosshair code." };
    const cs2 = valorantToCs2Settings(parsed);
    return {
      ok: true,
      output: encodeCs2ShareCode(cs2),
      preview: { game: "cs2", settings: cs2 },
      warnings: parsed.outerEnabled ? ["Valorant outer lines are ignored — CS2 uses a single cross layer."] : [],
    };
  }

  function drawValorantCrosshair(ctx, cx, cy, settings, scale) {
    const color = valorantColorHex(settings);
    const thickness = Math.max(1, settings.innerThickness * scale);
    const length = settings.innerLength * scale;
    const offset = settings.innerOffset * scale;
    const outlineW = settings.outlines ? Math.max(1, settings.outlineThickness * scale) : 0;
    const alpha = settings.innerOpacity ?? 1;

    const snap = (v, w) => (w % 2 === 0 ? Math.round(v) : Math.round(v - 0.5) + 0.5);
    const x = snap(cx, thickness);
    const y = snap(cy, thickness);

    const drawArm = (x1, y1, x2, y2) => {
      if (outlineW > 0) {
        ctx.strokeStyle = `rgba(0,0,0,${alpha})`;
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

    if (settings.innerEnabled && length > 0) {
      drawArm(x, y - offset - length, x, y - offset);
      drawArm(x, y + offset, x, y + offset + length);
      drawArm(x - offset - length, y, x - offset, y);
      drawArm(x + offset, y, x + offset + length, y);
    }

    if (settings.dot) {
      const dotSize = Math.max(1, (settings.dotThickness || 2) * scale);
      ctx.fillStyle = color.startsWith("#")
        ? `rgba(${parseInt(color.slice(1, 3), 16)},${parseInt(color.slice(3, 5), 16)},${parseInt(color.slice(5, 7), 16)},${settings.dotOpacity ?? 1})`
        : color;
      ctx.fillRect(Math.round(cx - dotSize / 2), Math.round(cy - dotSize / 2), dotSize, dotSize);
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
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(cx - dotSize / 2), Math.round(cy - dotSize / 2), dotSize, dotSize);
    }
  }

  const PREVIEW_BACKGROUNDS = [
    "assets/crosshair-preview-bg.png",
    "assets/crosshair-preview-bg-2.png",
    "assets/crosshair-preview-bg-3.png",
  ];
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

      img.decoding = "sync";
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
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
    if (!drawPreviewBackgroundImage(ctx, w, h, img)) drawPreviewBackgroundFallback(ctx, w, h);
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
    return (
      !document.body.classList.contains("reduce-motion") &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
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
    previewNote.textContent =
      state.zoom > 1
        ? `Preview is approximate at 1080p with ${state.zoom}× zoom.`
        : "Preview is approximate at 1080p reference scale.";
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
    };

    const open = () => {
      dropdown.classList.add("is-open");
      trigger.setAttribute("aria-expanded", "true");
      list.classList.remove("hidden");
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
      if (warningsEl) warningsEl.hidden = true;
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
    if (!section) return;

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
      window.addEventListener("resize", redrawCrosshairPreview, { passive: true });
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
      copyText?.("Crosshair applied to aim trainer.", "Crosshair applied to aim trainer.");
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

  preloadAllPreviewBackgrounds();

  window.initCrosshairConverterTab = initCrosshairConverterTab;
  window.updateCrosshairConverterUi = updateCrosshairConverterUi;
  window.setCrosshairConverterDirection = setCrosshairConverterDirection;
})();
