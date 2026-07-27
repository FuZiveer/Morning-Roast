#!/usr/bin/env node
/**
 * Regenerate tools/valorant-lineup-icons.js from https://valorant-api.com/v1/agents
 * Usage: node tools/generate-valorant-lineup-icons.js
 */

const fs = require("fs");
const path = require("path");

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function agentSlug(name) {
  const slug = slugify(name);
  return slug === "kay-o" ? "kayo" : slug;
}

function slotLabel(slot) {
  const labels = {
    Ability1: "Ability 1",
    Ability2: "Ability 2",
    Grenade: "Grenade",
    Ultimate: "Ultimate",
    Passive: "Passive",
  };
  return labels[slot] || slot || "";
}

async function main() {
  const response = await fetch("https://valorant-api.com/v1/agents?isPlayableCharacter=true");
  if (!response.ok) throw new Error(`Valorant API failed: ${response.status}`);
  const payload = await response.json();
  const agents = (payload.data || [])
    .filter((entry) => entry.isPlayableCharacter !== false)
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const agentIcons = {};
  const agentLabels = {};
  const abilityIcons = {};
  const abilityAliases = { "snare-trap": "chokehold", trap: "chokehold" };

  for (const agent of agents) {
    const slug = agentSlug(agent.displayName);
    agentIcons[slug] = agent.displayIcon;
    agentLabels[slug] = slug === "kayo" ? "KAY/O" : agent.displayName;

    for (const ability of agent.abilities || []) {
      if (!ability.displayName || !ability.displayIcon) continue;
      const abilitySlug = slugify(ability.displayName);
      abilityIcons[`${slug}:${abilitySlug}`] = {
        src: ability.displayIcon,
        label: ability.displayName,
        description: String(ability.description || "").replace(/\s+/g, " ").trim(),
        slot: slotLabel(ability.slot),
      };
    }
  }

  const outPath = path.join(__dirname, "valorant-lineup-icons.js");
  const contents = `/** Generated from https://valorant-api.com/v1/agents — run: node tools/generate-valorant-lineup-icons.js */
(function (global) {
  global.LINEUP_VALORANT_AGENT_ICONS = ${JSON.stringify(agentIcons, null, 2)};
  global.LINEUP_VALORANT_AGENT_LABELS = ${JSON.stringify(agentLabels, null, 2)};
  global.LINEUP_VALORANT_ABILITY_ALIASES = ${JSON.stringify(abilityAliases, null, 2)};
  global.LINEUP_VALORANT_ABILITY_ICONS = ${JSON.stringify(abilityIcons, null, 2)};
})(typeof window !== "undefined" ? window : globalThis);
`;

  fs.writeFileSync(outPath, contents);
  console.log(`Wrote ${outPath}`);
  console.log(`Agents: ${Object.keys(agentIcons).length}, abilities: ${Object.keys(abilityIcons).length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
