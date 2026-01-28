const gameData = {
  Valorant: 1.0,
  CS2: 3.181818,
  "Rainbow Six Siege": 12.216667,
  Rust: 0.622222,
};

const proDatabase = {
  Valorant: {
    low: ["Alfajer", "Demon1", "Less", "pANcada", "Chronicle", "Leo", "yay", "Nats"],
    average: ["Aspas", "Derke", "TenZ", "Zekken", "Cryocells", "Sayf", "Leaf", "cNed"],
    high: ["f0rsakeN", "something", "Asuna", "Hiko", "Primmie", "Jinggg", "Patiphan", "Governor"],
  },
  CS2: {
    low: ["Ropz", "NiKo", "ZywOo", "Jame", "Hunter-", "Rain", "B1t", "Kyojin"],
    average: ["m0NESY", "dev1ce", "s1mple", "Twistzz", "Broky", "Ax1Le", "Shox", "Get_RiGHT"],
    high: ["ELiGE", "Woxic", "Forest", "Xantares", "Stewie2K", "Jackz", "TabseN", "Smooya"],
  },
  General: {
    low: ["Pro Low"],
    average: ["Pro Average"],
    high: ["Pro High"],
  },
};

let isCopying = false;

function applyEdpiPreset(game, dpi, sens) {
  const eG = document.getElementById("edpi-game-search");
  const eD = document.getElementById("edpi-dpi");
  const eS = document.getElementById("edpi-sens");
  const eTabBtn = document.querySelector('[onclick*="edpi-calculator-tab"]');

  if (eG && eD && eS) {
    if (eTabBtn) eTabBtn.click();
    eG.value = game;
    eD.value = dpi;
    eS.value = sens;
    updateEDPI();
  }
}

function checkActivePresets() {
  const fG = document.getElementById("from-search")?.value || "";
  const tG = document.getElementById("to-search")?.value || "";
  const bS = parseFloat(document.getElementById("base-sens")?.value.replace(",", ".") || "0");
  const fD = parseFloat(document.getElementById("from-dpi")?.value || "0");
  const tD = parseFloat(document.getElementById("to-dpi")?.value || "0");

  document.querySelectorAll(".preset-btn").forEach((btn) => {
    const attr = btn.getAttribute("onclick") || "";
    const matches = attr.match(/'([^']+)',\s*([\d.]+),\s*([\d.]+)/);

    if (matches) {
      const pGame = matches[1];
      const pDpi = parseFloat(matches[2]);
      const pSens = parseFloat(matches[3]);
      const eG = document.getElementById("edpi-game-search")?.value || "";
      const eD = parseFloat(document.getElementById("edpi-dpi")?.value || "0");
      const eS = parseFloat(document.getElementById("edpi-sens")?.value.replace(",", ".") || "0");

      const isMatch = eG === pGame && eD === pDpi && eS === pSens;
      btn.classList.toggle("active-preset", isMatch);
    }
  });
}

function getAdvice(edpi, game) {
  if (game === "CS2") {
    if (edpi < 600) return "Low for CS2. Great for stability and long-range duels with the AWP or AK.";
    if (edpi <= 1000) return "The CS2 Sweet Spot. Perfect balance for spray control and entry fragging.";
    return "High for CS2. Allows for rapid 180s and clearing corners, but requires high precision control.";
  } else {
    if (edpi < 200) return "Low for Valorant. Ideal for steady holding and micro-corrections.";
    if (edpi <= 400) return "Valorant Standard. Most tactical pros sit in this range for maximum consistency.";
    return "High for Valorant. Great for reactive flicking and movement-based agents like Jett or Neon.";
  }
}

function switchTab(evt, id) {
  const sections = document.querySelectorAll(".section");
  const buttons = document.querySelectorAll(".button-container .button");
  sections.forEach((s) => (s.style.display = "none"));
  buttons.forEach((b) => b.classList.remove("active"));

  const target = document.getElementById(id);
  if (target) target.style.display = "flex";
  evt.currentTarget.classList.add("active");

  const suggestBox = document.getElementById("sens-suggestion");

  if (id === "sensitivity-converter-tab") {
    if (suggestBox) suggestBox.style.display = "none";
    updateConversion();
  } else if (id === "edpi-calculator-tab") {
    if (suggestBox) suggestBox.style.display = "none";
    updateEDPI();
  }
}

function toggleResetButton() {
  const resetBtn = document.getElementById("reset-btn");
  if (!resetBtn) return;
  const fG = document.getElementById("from-search").value;
  const tG = document.getElementById("to-search").value;
  const bS = document.getElementById("base-sens").value;
  const fD = document.getElementById("from-dpi").value;
  const tD = document.getElementById("to-dpi").value;
  const isDefault = fG === "" && tG === "" && bS === "" && fD === "800" && tD === "800";
  resetBtn.classList.toggle("is-default", isDefault);
}

function toggleEDPIResetButton() {
  const resetBtn = document.getElementById("edpi-reset");
  if (!resetBtn) return;
  const dpiVal = document.getElementById("edpi-dpi").value;
  const sensVal = document.getElementById("edpi-sens").value;
  const gameVal = document.getElementById("edpi-game-search").value;
  const isDefault = gameVal === "" && sensVal === "" && dpiVal === "";
  resetBtn.classList.toggle("is-default", isDefault);
}

function updateConversion() {
  const getVal = (id) => document.getElementById(id)?.value || "";
  const fromGame = getVal("from-search");
  const toGame = getVal("to-search");
  const baseSens = getVal("base-sens");
  const fDpi = parseFloat(getVal("from-dpi"));
  const tDpi = parseFloat(getVal("to-dpi"));
  const display = document.getElementById("new-sens-value");

  ["from", "to"].forEach((id) => {
    const btn = document.getElementById(`${id}-clear`);
    const input = document.getElementById(`${id}-search`);
    if (btn && input) btn.style.display = input.value ? "flex" : "none";
  });

  toggleResetButton();
  if (!display) return;
  const sens = parseFloat(baseSens.replace(",", "."));
  const isValid = fromGame && toGame && baseSens !== "" && !isNaN(fDpi) && !isNaN(tDpi);
  if (!isValid || fDpi === 0 || tDpi === 0 || isNaN(sens)) {
    display.innerText = "0.00";
    return;
  }
  const fromFactor = gameData[fromGame];
  const toFactor = gameData[toGame];
  if (fromFactor && toFactor) {
    const convertedSens = sens * (toFactor / fromFactor) * (fDpi / tDpi);
    display.innerText = convertedSens.toFixed(3);
  }
}

function updateEDPI() {
  const dpiVal = document.getElementById("edpi-dpi").value;
  const sensVal = document.getElementById("edpi-sens").value;
  const gameVal = document.getElementById("edpi-game-search").value;
  const display = document.getElementById("edpi-value");
  const pointer = document.getElementById("spectrum-pointer");
  const rankLabel = document.getElementById("edpi-rank");
  const proDisplay = document.getElementById("pro-comparison");
  const proName = document.getElementById("pro-name");
  const suggestBox = document.getElementById("sens-suggestion");
  const suggestText = document.getElementById("suggestion-text");
  const adviceDot = document.getElementById("advice-dot");
  const defaultBlue = "hsl(198, 93%, 60%)";

  toggleEDPIResetButton();

  const clearBtn = document.getElementById("edpi-game-clear");
  if (clearBtn) clearBtn.style.display = gameVal ? "flex" : "none";

  const rawEdpi = parseFloat(dpiVal) * parseFloat(sensVal.replace(",", "."));
  const edpi = Math.round(rawEdpi);

  if (gameVal === "" || isNaN(edpi) || edpi === 0) {
    if (display) display.innerText = "0";
    if (rankLabel) rankLabel.style.opacity = "0";
    if (proDisplay) proDisplay.style.opacity = "0";
    if (suggestBox) suggestBox.style.display = "none";
    if (pointer) {
      pointer.style.left = "0%";
      pointer.style.backgroundColor = defaultBlue;
      pointer.style.boxShadow = "none";
    }
    checkActivePresets();
    return;
  }

  if (display) display.innerText = edpi;

  let percent, color, label, tier;
  const isCS = gameVal === "CS2" || gameVal === "Counter-Strike 2";

  if (isCS) {
    if (edpi < 600) {
      label = "PRO LOW";
      color = "hsl(198, 93%, 60%)";
      tier = "low";
      percent = Math.min((edpi / 600) * 33, 33);
    } else if (edpi <= 1000) {
      label = "PRO AVERAGE";
      color = "hsl(var(--vibrant-red))";
      tier = "average";
      percent = 33 + ((edpi - 600) / 400) * 33;
    } else {
      label = "PRO HIGH";
      color = "hsl(43, 96%, 56%)";
      tier = "high";
      percent = Math.min(66 + ((edpi - 1000) / 1000) * 34, 100);
    }
  } else {
    if (edpi < 200) {
      label = "PRO LOW";
      color = "hsl(198, 93%, 60%)";
      tier = "low";
      percent = Math.min((edpi / 200) * 33, 33);
    } else if (edpi <= 400) {
      label = "PRO AVERAGE";
      color = "hsl(var(--vibrant-red))";
      tier = "average";
      percent = 33 + ((edpi - 200) / 200) * 33;
    } else {
      label = "PRO HIGH";
      color = "hsl(43, 96%, 56%)";
      tier = "high";
      percent = Math.min(66 + ((edpi - 400) / 600) * 34, 100);
    }
  }

  if (pointer) {
    pointer.style.left = `${percent}%`;
    pointer.style.backgroundColor = color;
    pointer.style.boxShadow = `0 0 1rem ${color}`;
  }
  if (rankLabel) {
    rankLabel.innerText = label;
    rankLabel.style.color = color;
    rankLabel.style.opacity = "1";
  }
  if (proDisplay && proName) {
    const gamePool = proDatabase[isCS ? "CS2" : "Valorant"] || proDatabase.General;
    const pros = gamePool[tier];
    proName.innerText = pros[Math.floor(Math.random() * pros.length)];
    proName.style.color = color;
    proDisplay.style.opacity = "1";
  }
  if (suggestBox && suggestText) {
    suggestText.innerText = getAdvice(edpi, isCS ? "CS2" : "Valorant");
    suggestBox.style.display = "block";
    if (adviceDot) adviceDot.style.backgroundColor = color;
  }
  checkActivePresets();
}

function handleInputValidation(input, callback) {
  const isDpiField = input.id.includes("-dpi");
  const isSensField = input.id === "base-sens" || input.id === "edpi-sens";

  input.addEventListener("input", () => {
    let val = input.value;
    const start = input.selectionStart;

    if (isDpiField) {
      val = val.replace(/[^0-9]/g, "");
    } else if (isSensField) {
      val = val.replace(/[^0-9.,]/g, "");
      const firstSeparatorIndex = val.search(/[.,]/);
      if (firstSeparatorIndex !== -1) {
        const prefix = val.substring(0, firstSeparatorIndex + 1);
        const rest = val.substring(firstSeparatorIndex + 1).replace(/[.,]/g, "");
        val = prefix + rest;
      }
    }

    if (val.length > 10) val = val.substring(0, 10);
    if (input.value !== val) {
      input.value = val;
      const offset = input.value.length < val.length ? -1 : 0;
      input.setSelectionRange(start + offset, start + offset);
    }
    callback();
  });
  input.addEventListener("focus", function () {
    setTimeout(() => this.select(), 0);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const fD = document.getElementById("from-dpi");
  const tD = document.getElementById("to-dpi");
  if (fD) fD.value = "800";
  if (tD) tD.value = "800";

  ["base-sens", "from-dpi", "to-dpi", "edpi-dpi", "edpi-sens"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      const callback = id.startsWith("edpi-") ? updateEDPI : updateConversion;
      handleInputValidation(el, callback);
    }
  });

  document.addEventListener("click", (e) => {
    ["from", "to", "edpi-game"].forEach((idPrefix) => {
      const list = document.getElementById(`${idPrefix}-list`);
      const input = document.getElementById(`${idPrefix}-search`);
      if (list && input && !input.contains(e.target) && !list.contains(e.target)) {
        list.classList.add("hidden");
      }
    });
  });

  ["from", "to", "edpi-game"].forEach((idPrefix) => {
    const list = document.getElementById(`${idPrefix}-list`);
    const input = document.getElementById(`${idPrefix}-search`);
    const clearBtn = document.getElementById(`${idPrefix}-clear`);
    if (!list || !input) return;

    let activeIndex = -1;
    const getVisible = () => Array.from(list.querySelectorAll(".game-option")).filter((o) => o.style.display !== "none");
    const syncUI = (visible) => {
      visible.forEach((opt, i) => opt.classList.toggle("hover", i === activeIndex));
      if (activeIndex >= 0 && visible[activeIndex]) {
        visible[activeIndex].scrollIntoView({ block: "nearest" });
      }
    };

    input.addEventListener("focus", () => {
      document.querySelectorAll(".dropdown-list").forEach((l) => l.classList.add("hidden"));
      input.value = "";
      list.querySelectorAll(".game-option").forEach((o) => {
        o.style.display = "flex";
        o.classList.remove("hover");
      });
      list.classList.remove("hidden");
      activeIndex = 0;
      syncUI(getVisible());
      if (idPrefix === "edpi-game") updateEDPI();
      else updateConversion();
    });

    input.addEventListener("keydown", (e) => {
      const visible = getVisible();
      if (!visible.length) return;
      if (e.key === "ArrowDown") {
        activeIndex = (activeIndex + 1) % visible.length;
        syncUI(visible);
        e.preventDefault();
      } else if (e.key === "ArrowUp") {
        activeIndex = (activeIndex - 1 + visible.length) % visible.length;
        syncUI(visible);
        e.preventDefault();
      } else if (e.key === "Enter" && activeIndex >= 0) {
        visible[activeIndex].dispatchEvent(new Event("mousedown"));
        e.preventDefault();
      } else if (e.key === "Escape") {
        list.classList.add("hidden");
        input.blur();
      }
    });

    input.addEventListener("input", () => {
      const filter = input.value.toLowerCase();
      list.querySelectorAll(".game-option").forEach((o) => (o.style.display = o.textContent.toLowerCase().includes(filter) ? "flex" : "none"));
      list.classList.remove("hidden");
      activeIndex = 0;
      syncUI(getVisible());
      if (idPrefix === "edpi-game") updateEDPI();
      else updateConversion();
    });

    if (clearBtn) {
      clearBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = "";
        list.classList.add("hidden");
        if (idPrefix === "edpi-game") updateEDPI();
        else updateConversion();
      });
    }

    list.querySelectorAll(".game-option").forEach((opt) => {
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = opt.querySelector(".game-name").textContent;
        list.classList.add("hidden");
        if (idPrefix === "edpi-game") updateEDPI();
        else updateConversion();
        input.blur();
      });
    });
  });

  document.getElementById("swap-btn")?.addEventListener("click", () => {
    const el = { fG: document.getElementById("from-search"), tG: document.getElementById("to-search"), fD: document.getElementById("from-dpi"), tD: document.getElementById("to-dpi"), bS: document.getElementById("base-sens"), res: document.getElementById("new-sens-value") };
    if (Object.values(el).every((x) => x)) {
      if (el.res.innerText !== "0.00") el.bS.value = el.res.innerText;
      [el.fG.value, el.tG.value] = [el.tG.value, el.fG.value];
      [el.fD.value, el.tD.value] = [el.tD.value, el.fD.value];
      updateConversion();
    }
  });

  document.getElementById("reset-btn")?.addEventListener("click", () => {
    ["from-search", "to-search", "base-sens"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const fD = document.getElementById("from-dpi");
    const tD = document.getElementById("to-dpi");
    if (fD) fD.value = "800";
    if (tD) tD.value = "800";
    updateConversion();
  });

  document.getElementById("edpi-reset")?.addEventListener("click", () => {
    const eG = document.getElementById("edpi-game-search");
    const eD = document.getElementById("edpi-dpi");
    const eS = document.getElementById("edpi-sens");
    if (eG) eG.value = "";
    if (eD) eD.value = "";
    if (eS) eS.value = "";
    updateEDPI();
  });

  document.querySelectorAll(".copy-button").forEach((btn) => {
    btn.addEventListener("click", function () {
      if (isCopying) return;
      const isEdpi = this.id === "edpi-copy";
      const val = document.getElementById(isEdpi ? "edpi-value" : "new-sens-value")?.innerText;
      if (!val || val === "0.00" || val === "0") {
        this.classList.add("vibrate");
        setTimeout(() => this.classList.remove("vibrate"), 300);
        return;
      }
      isCopying = true;
      const span = this.querySelector("span");
      const originalText = span ? span.innerText : "";
      navigator.clipboard.writeText(val).then(() => {
        this.classList.add("copied");
        if (span) span.innerText = "COPIED!";
        setTimeout(() => {
          this.classList.remove("copied");
          if (span) span.innerText = originalText;
          isCopying = false;
        }, 1500);
      });
    });
  });

  updateConversion();
  updateEDPI();
});
