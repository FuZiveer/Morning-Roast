#!/usr/bin/env node
/**
 * Regenerate tools/lineup-map-posters.js
 * Valorant: https://valorant-api.com/v1/maps (splash art)
 * CS2: https://github.com/MurkyYT/cs2-map-icons (thumb_paths)
 * Usage: node tools/generate-lineup-map-posters.js
 */

const fs = require("fs");
const path = require("path");

const VALORANT_MAPS = [
  "Abyss",
  "Ascent",
  "Bind",
  "Breeze",
  "Corrode",
  "Fracture",
  "Haven",
  "Icebox",
  "Lotus",
  "Pearl",
  "Summit",
  "Sunset",
];

const CS2_SLUG_TO_INTERNAL = {
  alpine: "cs_alpine",
  ancient: "de_ancient",
  anubis: "de_anubis",
  cache: "de_cache",
  "dust-ii": "de_dust2",
  inferno: "de_inferno",
  italy: "cs_italy",
  mirage: "de_mirage",
  nuke: "de_nuke",
  office: "cs_office",
  overpass: "de_overpass",
  stronghold: "de_stronghold",
  train: "de_train",
  vertigo: "de_vertigo",
  warden: "de_warden",
};

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchValorantPosters() {
  const response = await fetch("https://valorant-api.com/v1/maps");
  if (!response.ok) throw new Error(`Valorant API failed: ${response.status}`);
  const payload = await response.json();
  const maps = payload.data || [];
  const posters = {};

  for (const name of VALORANT_MAPS) {
    const entry = maps.find((map) => map.displayName === name);
    if (!entry?.splash) throw new Error(`Missing Valorant splash for ${name}`);
    posters[slugify(name)] = entry.splash;
  }

  return posters;
}

async function fetchCs2Posters() {
  const response = await fetch(
    "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/data/available.json"
  );
  if (!response.ok) throw new Error(`CS2 map icons JSON failed: ${response.status}`);
  const payload = await response.json();
  const maps = payload.maps || {};
  const posters = {};

  for (const [slug, internalName] of Object.entries(CS2_SLUG_TO_INTERNAL)) {
    const entry = maps[internalName];
    const url = entry?.thumb_paths?.[0] || entry?.path;
    if (!url) throw new Error(`Missing CS2 poster for ${slug} (${internalName})`);
    posters[slug] = url;
  }

  return posters;
}

async function main() {
  const [valorant, cs2] = await Promise.all([fetchValorantPosters(), fetchCs2Posters()]);
  const outPath = path.join(__dirname, "lineup-map-posters.js");
  const contents = `/** Generated — run: node tools/generate-lineup-map-posters.js */
(function (global) {
  global.LINEUP_MAP_POSTERS = ${JSON.stringify({ valorant, cs2 }, null, 2)};
  global.LINEUP_LOCAL_MAP_POSTERS = {
    valorant: ["pearl"],
    cs2: ["mirage"],
  };
})(typeof window !== "undefined" ? window : globalThis);
`;

  fs.writeFileSync(outPath, contents);
  console.log(`Wrote ${outPath}`);
  console.log(`Valorant maps: ${Object.keys(valorant).length}, CS2 maps: ${Object.keys(cs2).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
