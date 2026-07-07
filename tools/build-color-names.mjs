import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(
  "C:/Users/tierp/.cursor/projects/c-Users-tierp-OneDrive-Documents-Coding/agent-tools/8fa56c99-8f16-41e1-8018-bf0d94c3c58c.txt",
  "utf8"
);
const match = src.match(/names:\s*\[([\s\S]*?)\]\s*\n\}/);
if (!match) throw new Error("Could not parse ntc names");

const entries = [...match[1].matchAll(/\["([0-9A-F]{6})",\s*"([^"]+)"\]/g)].map(([, hex, name]) => `${hex}:${name}`);
const compact = entries.join("|");
const outPath = path.join(__dirname, "../color-names.js");
const js = `/* Name That Color dataset (Chirag Mehta / ntc.js, CC BY 2.5) */
(function () {
  const COMPACT = ${JSON.stringify(compact)};

  function rgb(color) {
    return [
      parseInt(color.substring(1, 3), 16),
      parseInt(color.substring(3, 5), 16),
      parseInt(color.substring(5, 7), 16),
    ];
  }

  function hsl(color) {
    const channels = rgb(color).map((value) => value / 255);
    const [r, g, b] = channels;
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);
    const delta = max - min;
    const l = (min + max) / 2;
    let s = 0;
    if (l > 0 && l < 1) s = delta / (l < 0.5 ? 2 * l : 2 - 2 * l);
    let h = 0;
    if (delta > 0) {
      if (max === r && max !== g) h += (g - b) / delta;
      if (max === g && max !== b) h += 2 + (b - r) / delta;
      if (max === b && max !== r) h += 4 + (r - g) / delta;
      h /= 6;
    }
    return [Math.round(h * 255), Math.round(s * 255), Math.round(l * 255)];
  }

  let names = null;

  function ensureNames() {
    if (names) return names;
    names = COMPACT.split("|").map((entry) => {
      const splitAt = entry.indexOf(":");
      const hex = entry.slice(0, splitAt);
      const label = entry.slice(splitAt + 1).trim();
      const color = "#" + hex;
      const [r, g, b] = rgb(color);
      const [h, s, l] = hsl(color);
      return { hex, label, r, g, b, h, s, l };
    });
    return names;
  }

  function normalizeHex(color) {
    if (!color) return null;
    let value = String(color).trim().toUpperCase();
    if (!value.startsWith("#")) value = "#" + value;
    if (value.length === 4) {
      value =
        "#" +
        value[1] +
        value[1] +
        value[2] +
        value[2] +
        value[3] +
        value[3];
    }
    return /^#[0-9A-F]{6}$/.test(value) ? value : null;
  }

  function formatColorName(name) {
    if (!name || name.startsWith("Invalid Color:")) return "Custom";
    return name.replace(/\\s*\\/\\s*/g, " / ").replace(/\\s+/g, " ").trim();
  }

  const cache = new Map();

  function getAccentColorName(color) {
    const hex = normalizeHex(color);
    if (!hex) return "Custom";
    if (cache.has(hex)) return cache.get(hex);

    const list = ensureNames();
    const exact = list.find((entry) => "#" + entry.hex === hex);
    if (exact) {
      const label = formatColorName(exact.label);
      cache.set(hex, label);
      return label;
    }

    const [r, g, b] = rgb(hex);
    const [h, s, l] = hsl(hex);
    let best = null;
    let bestDistance = Infinity;

    for (const entry of list) {
      const rgbDistance =
        (r - entry.r) ** 2 + (g - entry.g) ** 2 + (b - entry.b) ** 2;
      const hslDistance =
        (h - entry.h) ** 2 + (s - entry.s) ** 2 + (l - entry.l) ** 2;
      const distance = rgbDistance + hslDistance * 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = entry;
      }
    }

    const label = formatColorName(best?.label || "Custom");
    cache.set(hex, label);
    return label;
  }

  window.getAccentColorName = getAccentColorName;
})();
`;

fs.writeFileSync(outPath, js);
console.log(`Wrote ${outPath} (${entries.length} colors, ${compact.length} bytes compact)`);
