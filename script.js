const gameData = {
  Valorant: 1.0,
  CS2: 3.181818,
  "Rainbow Six Siege": 12.216667,
  Rust: 0.622222,
};

const proDatabase = {
  Valorant: {
    low: ["Nats", "Yay", "Less", "Demon1", "Alfajer", "Chronicle", "Leo", "Zellsis"],
    average: ["Aspas", "TenZ", "Zekken", "Derke", "Cryocells", "Leaf", "Sayf", "trent"],
    high: ["something", "f0rsakeN", "Primmie", "Jinggg", "Asuna", "Governor", "Hyunmin", "Patiphan"],
  },
  CS2: {
    low: ["Jame", "B1t", "Rain", "Hunter-", "Nafany", "Interz", "Kyojin", "frozen"],
    average: ["NiKo", "Ropz", "ZywOo", "m0NESY", "Twistzz", "Broky", "dev1ce", "Jimpphat"],
    high: ["donk", "s1mple", "Woxic", "ELiGE", "Xantares", "Smooya", "Stewie2K", "forsyy"],
  },
  General: {
    low: ["Pro Low"],
    average: ["Pro Average"],
    high: ["Pro High"],
  },
};

let isCopying = false;

const aimTrainer = {
  hits: 0,
  totalClicks: 0,
  active: false,
  isCountingDown: false,
  showResults: false,
  targets: [],
  maxTargets: 3,
  startTime: 0,
  timeLeft: 30,
  avgTime: 0,
  canvas: null,
  ctx: null,
  timerId: null,
  audioCtx: null,
  camera: { yaw: 0, pitch: 0 },
  fov: 103,
  mode: "static",
  isMouseDown: false,
  trackingFrames: 0,
  totalTrackingFrames: 0,
  restartButton: { x: 0, y: 0, w: 200, h: 46, radius: 8 },
  init() {
    this.canvas = document.getElementById("aimCanvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.canvas.style.cursor = "none";

    const modeSelect = document.getElementById("trainer-mode");
    if (modeSelect) {
      modeSelect.addEventListener("change", (e) => {
        this.mode = e.target.value;
      });
    }

    const requestLock = () => {
      if (document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock();
      }
    };

    this.canvas.addEventListener("mousedown", (e) => {
      if (!document.fullscreenElement) return;
      this.isMouseDown = true;
      if (!this.active && !this.showResults && !this.isCountingDown) {
        requestLock();
      } else if (this.active) {
        this.handleHit(e);
      } else if (this.showResults) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
        const my = (e.clientY - rect.top) * (this.canvas.height / rect.height);
        const b = this.restartButton;
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          requestLock();
        }
      }
    });

    window.addEventListener("mouseup", () => {
      this.isMouseDown = false;
    });

    document.addEventListener("fullscreenchange", () => {
      const fsBtn = document.getElementById("fullscreen-trainer");
      const modeContainer = document.getElementById("trainer-controls");
      if (document.fullscreenElement) {
        if (fsBtn) fsBtn.style.display = "none";
        if (modeContainer) modeContainer.style.display = "none";
        this.handleResize();
      } else {
        if (fsBtn) fsBtn.style.display = "block";
        if (modeContainer) modeContainer.style.display = "flex";
        this.endGame();
        this.handleResize();
      }
    });

    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === this.canvas) {
        if (!this.active && !this.isCountingDown) this.startCountdown();
      } else {
        if (this.active) this.endGame();
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.handleCamera(e);
      }
    });

    const fsBtn = document.getElementById("fullscreen-trainer");
    if (fsBtn) {
      fsBtn.onclick = (e) => {
        e.stopPropagation();
        const container = this.canvas.parentElement;
        if (!document.fullscreenElement) {
          container.requestFullscreen().catch((err) => console.log(err));
        }
      };
    }

    window.addEventListener("resize", () => this.handleResize());
    this.handleResize();
    this.render();
  },
  playHitSound() {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = this.audioCtx.createOscillator();
    const gain = this.audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, this.audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, this.audioCtx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.05, this.audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(this.audioCtx.destination);
    osc.start();
    osc.stop(this.audioCtx.currentTime + 0.1);
  },
  handleResize() {
    if (document.fullscreenElement) {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
    } else {
      this.canvas.width = 800;
      this.canvas.height = 450;
    }
    this.render();
  },
  handleCamera(e) {
    const sens = parseFloat(document.getElementById("edpi-sens")?.value) || 1.0;
    const sensMultiplier = 0.0006;
    this.camera.yaw += e.movementX * sens * sensMultiplier;
    this.camera.pitch -= e.movementY * sens * sensMultiplier;
    const limit = Math.PI / 2.5;
    this.camera.pitch = Math.max(-limit, Math.min(limit, this.camera.pitch));
    this.render();
  },
  startCountdown() {
    this.isCountingDown = true;
    this.showResults = false;
    this.active = false;
    this.render();
    setTimeout(() => {
      this.isCountingDown = false;
      this.start();
    }, 1000);
  },
  start() {
    this.hits = 0;
    this.totalClicks = 0;
    this.trackingFrames = 0;
    this.totalTrackingFrames = 0;
    this.targets = [];
    this.camera = { yaw: 0, pitch: 0 };
    this.active = true;
    this.startTime = performance.now();
    this.timeLeft = 30;

    if (this.mode === "tracking") {
      this.spawnTarget();
      this.targets[0].vx = 0.005;
      this.targets[0].vy = 0.003;
      this.targets[0].radius = 0.045;
    } else {
      for (let i = 0; i < this.maxTargets; i++) this.spawnTarget();
    }

    if (this.timerId) clearInterval(this.timerId);
    this.timerId = setInterval(() => {
      const elapsed = (performance.now() - this.startTime) / 1000;
      this.timeLeft = Math.max(0, 30 - Math.floor(elapsed));
      this.updateGameLogic();
      if (this.timeLeft <= 0) this.endGame();
      this.render();
    }, 16);
  },
  updateGameLogic() {
    if (this.mode === "shrinking") {
      for (let i = this.targets.length - 1; i >= 0; i--) {
        this.targets[i].radius -= 0.0002;
        if (this.targets[i].radius <= 0.005) {
          this.targets.splice(i, 1);
          this.totalClicks++;
          this.spawnTarget();
        }
      }
    } else if (this.mode === "tracking") {
      this.totalTrackingFrames++;
      const t = this.targets[0];
      t.yaw += t.vx;
      t.pitch += t.vy;
      if (Math.abs(t.yaw) > 0.8) t.vx *= -1;
      if (Math.abs(t.pitch) > 0.4) t.vy *= -1;
      const dist = Math.sqrt(Math.pow(this.camera.yaw - t.yaw, 2) + Math.pow(this.camera.pitch - t.pitch, 2));
      if (this.isMouseDown && dist < t.radius) {
        this.trackingFrames++;
        if (this.trackingFrames % 10 === 0) this.playHitSound();
      }
    }
  },
  endGame() {
    this.active = false;
    this.showResults = true;
    if (this.mode === "tracking") {
      this.avgTime = (this.trackingFrames / 60).toFixed(2);
      this.hits = Math.round((this.trackingFrames / this.totalTrackingFrames) * 100);
    } else {
      this.avgTime = this.hits > 0 ? (30 / this.hits).toFixed(2) : 0;
    }
    if (document.pointerLockElement) document.exitPointerLock();
    clearInterval(this.timerId);
    this.render();
  },
  spawnTarget() {
    this.targets.push({
      yaw: (Math.random() - 0.5) * 1.0,
      pitch: (Math.random() - 0.5) * 0.5,
      radius: 0.035,
      vx: 0,
      vy: 0,
    });
  },
  handleHit(e) {
    if (this.showResults || this.isCountingDown || this.mode === "tracking") return;
    this.totalClicks++;
    let hitIdx = -1;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      const dist = Math.sqrt(Math.pow(this.camera.yaw - t.yaw, 2) + Math.pow(this.camera.pitch - t.pitch, 2));
      if (dist < t.radius) {
        hitIdx = i;
        break;
      }
    }
    if (hitIdx !== -1) {
      this.playHitSound();
      this.hits++;
      this.targets.splice(hitIdx, 1);
      this.spawnTarget();
    }
  },
  project(yaw, pitch, cx, cy, focalLength) {
    const relYaw = yaw - this.camera.yaw;
    const relPitch = pitch - this.camera.pitch;
    return {
      x: cx + relYaw * focalLength,
      y: cy - relPitch * focalLength,
    };
  },
  drawRoom(cx, cy, focalLength) {
    this.ctx.fillStyle = "#05080c";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const grad = this.ctx.createRadialGradient(cx, cy, 0, cx, cy, this.canvas.width);
    grad.addColorStop(0, "#0d141d");
    grad.addColorStop(1, "#05080c");
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.strokeStyle = "rgba(0, 242, 255, 0.08)";
    this.ctx.lineWidth = 1;
    const step = 0.25;
    for (let i = -12; i <= 12; i++) {
      const p1 = this.project(i * step, -5, cx, cy, focalLength);
      const p2 = this.project(i * step, 5, cx, cy, focalLength);
      if (p1 && p2) {
        this.ctx.beginPath();
        this.ctx.moveTo(p1.x, p1.y);
        this.ctx.lineTo(p2.x, p2.y);
        this.ctx.stroke();
      }
      const p3 = this.project(-10, i * step, cx, cy, focalLength);
      const p4 = this.project(10, i * step, cx, cy, focalLength);
      if (p3 && p4) {
        this.ctx.beginPath();
        this.ctx.moveTo(p3.x, p3.y);
        this.ctx.lineTo(p4.x, p4.y);
        this.ctx.stroke();
      }
    }
  },
  drawChart(x, y, label, value, max, unit, color) {
    const w = 240,
      h = 14;
    this.ctx.fillStyle = "rgba(255,255,255,0.05)";
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, w, h, 4);
    this.ctx.fill();
    const fillW = Math.max(10, Math.min(w, (value / max) * w));
    this.ctx.fillStyle = color;
    this.ctx.beginPath();
    this.ctx.roundRect(x, y, fillW, h, 4);
    this.ctx.fill();
    this.ctx.fillStyle = "white";
    this.ctx.font = "11px Inter";
    this.ctx.textAlign = "left";
    this.ctx.fillText(label, x, y - 8);
    this.ctx.textAlign = "right";
    this.ctx.fillText(`${value}${unit}`, x + w, y - 8);
  },
  render() {
    const cx = this.canvas.width / 2,
      cy = this.canvas.height / 2;
    const focalLength = this.canvas.width / ((this.fov * Math.PI) / 180);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.drawRoom(cx, cy, focalLength);

    if (!document.fullscreenElement) {
      this.canvas.style.cursor = "default";
      this.ctx.fillStyle = "rgba(5, 8, 12, 0.8)";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = "white";
      this.ctx.font = "bold 16px Inter";
      this.ctx.textAlign = "center";
      this.ctx.fillText("FULLSCREEN REQUIRED", cx, cy - 10);
      this.ctx.font = "12px Inter";
      this.ctx.fillStyle = "rgba(255,255,255,0.5)";
      this.ctx.fillText("CLICK THE BUTTON BELOW TO TRAIN", cx, cy + 20);
      return;
    }

    if (this.showResults) {
      this.canvas.style.cursor = "default";
      this.ctx.fillStyle = "rgba(5, 8, 12, 0.95)";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = "white";
      this.ctx.font = "bold 26px Inter";
      this.ctx.textAlign = "center";
      this.ctx.fillText("SESSION SUMMARY", cx, cy - 100);
      if (this.mode === "tracking") {
        this.drawChart(cx - 120, cy - 40, "TRACKING ACCURACY", this.hits, 100, "%", "#00f2ff");
        this.drawChart(cx - 120, cy + 10, "TIME ON TARGET", this.avgTime, 30, "s", "#ff4655");
      } else {
        const acc = this.totalClicks === 0 ? 0 : Math.round((this.hits / this.totalClicks) * 100);
        this.drawChart(cx - 120, cy - 40, "TOTAL HITS", this.hits, 80, "", "#ff4655");
        this.drawChart(cx - 120, cy + 10, "ACCURACY", acc, 100, "%", "#00f2ff");
        this.drawChart(cx - 120, cy + 60, "AVG TIME PER HIT", this.avgTime, 2, "s", "#ffb800");
      }
      const b = this.restartButton;
      b.x = cx - b.w / 2;
      b.y = cy + 120;
      this.ctx.fillStyle = "#ff4655";
      this.ctx.beginPath();
      this.ctx.roundRect(b.x, b.y, b.w, b.h, b.radius);
      this.ctx.fill();
      this.ctx.fillStyle = "white";
      this.ctx.font = "bold 13px Inter";
      this.ctx.textAlign = "center";
      this.ctx.fillText("START NEW SESSION", cx, b.y + 28);
      return;
    }

    if (this.isCountingDown) {
      this.ctx.fillStyle = "rgba(0,0,0,0.6)";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = "#ff4655";
      this.ctx.font = "bold 40px Inter";
      this.ctx.textAlign = "center";
      this.ctx.fillText("READY?", cx, cy);
      return;
    }

    if (!this.active && document.pointerLockElement !== this.canvas) {
      this.canvas.style.cursor = "default";
      this.ctx.fillStyle = "rgba(0,0,0,0.6)";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = "white";
      this.ctx.font = "bold 18px Inter";
      this.ctx.textAlign = "center";
      this.ctx.fillText("CLICK TO LOCK MOUSE & START", cx, cy);
      return;
    }

    this.canvas.style.cursor = "none";
    this.targets.forEach((t) => {
      const p = this.project(t.yaw, t.pitch, cx, cy, focalLength);
      if (p) {
        const r = t.radius * focalLength;
        const color1 = this.mode === "tracking" ? "#ffb800" : "#ff4655";
        const color2 = this.mode === "tracking" ? "#9e7200" : "#9e2a34";
        const grad = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        grad.addColorStop(0, color1);
        grad.addColorStop(1, color2);
        this.ctx.fillStyle = grad;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, Math.max(0, r), 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.strokeStyle = "rgba(255,255,255,0.8)";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
      }
    });

    this.ctx.fillStyle = "rgba(255,255,255,0.8)";
    this.ctx.font = "bold 13px Inter";
    this.ctx.textAlign = "center";
    if (this.mode === "tracking") {
      const acc = this.totalTrackingFrames === 0 ? 0 : Math.round((this.trackingFrames / this.totalTrackingFrames) * 100);
      this.ctx.fillText(`TRACKING ACCURACY: ${acc}%   TIME: ${this.timeLeft}s`, cx, this.canvas.height - 30);
    } else {
      const acc = this.totalClicks === 0 ? 0 : Math.round((this.hits / this.totalClicks) * 100);
      this.ctx.fillText(`HITS: ${this.hits}   ACC: ${acc}%   TIME: ${this.timeLeft}s`, cx, this.canvas.height - 30);
    }

    this.ctx.strokeStyle = "#00ff00";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.moveTo(cx - 10, cy);
    this.ctx.lineTo(cx - 4, cy);
    this.ctx.moveTo(cx + 4, cy);
    this.ctx.lineTo(cx + 10, cy);
    this.ctx.moveTo(cx, cy - 10);
    this.ctx.lineTo(cx, cy - 4);
    this.ctx.moveTo(cx, cy + 4);
    this.ctx.lineTo(cx, cy + 10);
    this.ctx.stroke();
  },
};

function applyEdpiPreset(game, dpi, sens) {
  const eG = document.getElementById("edpi-game-search"),
    eD = document.getElementById("edpi-dpi"),
    eS = document.getElementById("edpi-sens"),
    eTabBtn = document.querySelector('[onclick*="edpi-calculator-tab"]');
  if (eG && eD && eS) {
    if (eTabBtn) eTabBtn.click();
    eG.value = game;
    eD.value = dpi;
    eS.value = sens;
    updateEDPI();
  }
}

function updateEDPI() {
  const dpiVal = document.getElementById("edpi-dpi").value,
    sensVal = document.getElementById("edpi-sens").value,
    gameVal = document.getElementById("edpi-game-search").value,
    display = document.getElementById("edpi-value"),
    pointer = document.getElementById("spectrum-pointer"),
    rankLabel = document.getElementById("edpi-rank"),
    proDisplay = document.getElementById("pro-comparison"),
    proName = document.getElementById("pro-name"),
    suggestBox = document.getElementById("sens-suggestion"),
    suggestText = document.getElementById("suggestion-text"),
    adviceDot = document.getElementById("advice-dot"),
    defaultBlue = "hsl(198, 93%, 60%)";
  checkActivePresets();
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
    }
    return;
  }
  if (display) display.innerText = edpi;
  let percent, color, label, tier;
  const isCS = gameVal === "CS2" || gameVal === "Counter-Strike 2";
  if (isCS) {
    if (edpi < 700) {
      label = "PRO LOW";
      color = "hsl(198, 93%, 60%)";
      tier = "low";
      percent = Math.min((edpi / 700) * 33, 33);
    } else if (edpi < 1000) {
      label = "PRO AVERAGE";
      color = "hsl(var(--vibrant-red))";
      tier = "average";
      percent = 33 + ((edpi - 700) / 300) * 33;
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
    } else if (edpi < 320) {
      label = "PRO AVERAGE";
      color = "hsl(var(--vibrant-red))";
      tier = "average";
      percent = 33 + ((edpi - 200) / 120) * 33;
    } else {
      label = "PRO HIGH";
      color = "hsl(43, 96%, 56%)";
      tier = "high";
      percent = Math.min(66 + ((edpi - 320) / 480) * 34, 100);
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
    const activeBtn = document.querySelector(".preset-btn.active-preset"),
      activeName = activeBtn ? activeBtn.innerText.trim().toLowerCase() : null;
    const gamePool = proDatabase[isCS ? "CS2" : "Valorant"] || proDatabase.General;
    let pros = [...(gamePool[tier] || [])];
    if (activeName) {
      pros = pros.filter((p) => p.toLowerCase() !== activeName);
    }
    if (pros.length > 0) {
      proName.innerText = pros[Math.floor(Math.random() * pros.length)];
      proName.style.color = color;
      proDisplay.style.opacity = "1";
    }
  }
  if (suggestBox && suggestText) {
    suggestText.innerText = getAdvice(edpi, isCS ? "CS2" : "Valorant");
    suggestBox.style.display = "block";
    if (adviceDot) adviceDot.style.backgroundColor = color;
  }
  toggleEDPIResetButton();
}

function checkActivePresets() {
  const eG = document.getElementById("edpi-game-search")?.value || "",
    eD = parseFloat(document.getElementById("edpi-dpi")?.value || "0"),
    eS_val = document.getElementById("edpi-sens")?.value || "0",
    eS = parseFloat(eS_val.replace(",", "."));
  document.querySelectorAll(".preset-btn").forEach((btn) => {
    const attr = btn.getAttribute("onclick") || "",
      matches = attr.match(/'([^']+)',\s*([\d.]+),\s*([\d.]+)/);
    if (matches) {
      const isMatch = eG === matches[1] && eD === parseFloat(matches[2]) && eS === parseFloat(matches[3]);
      btn.classList.toggle("active-preset", isMatch);
    }
  });
}

function switchTab(evt, id) {
  const sections = document.querySelectorAll(".section"),
    buttons = document.querySelectorAll(".button-container .button");
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
  const isDefault = document.getElementById("from-search").value === "" && document.getElementById("to-search").value === "" && document.getElementById("base-sens").value === "" && document.getElementById("from-dpi").value === "800" && document.getElementById("to-dpi").value === "800";
  resetBtn.classList.toggle("is-default", isDefault);
}

function toggleEDPIResetButton() {
  const resetBtn = document.getElementById("edpi-reset");
  if (!resetBtn) return;
  const isDefault = document.getElementById("edpi-game-search").value === "" && document.getElementById("edpi-sens").value === "" && document.getElementById("edpi-dpi").value === "";
  resetBtn.classList.toggle("is-default", isDefault);
}

function updateConversion() {
  const fromGame = document.getElementById("from-search").value,
    toGame = document.getElementById("to-search").value,
    baseSens = document.getElementById("base-sens").value,
    fDpi = parseFloat(document.getElementById("from-dpi").value),
    tDpi = parseFloat(document.getElementById("to-dpi").value),
    display = document.getElementById("new-sens-value");
  ["from", "to"].forEach((id) => {
    const btn = document.getElementById(`${id}-clear`),
      input = document.getElementById(`${id}-search`);
    if (btn && input) btn.style.display = input.value ? "flex" : "none";
  });
  toggleResetButton();
  if (!display) return;
  const sens = parseFloat(baseSens.replace(",", "."));
  if (!fromGame || !toGame || baseSens === "" || isNaN(fDpi) || isNaN(tDpi) || fDpi === 0 || tDpi === 0 || isNaN(sens)) {
    display.innerText = "0.00";
    return;
  }
  const fromFactor = gameData[fromGame],
    toFactor = gameData[toGame];
  if (fromFactor && toFactor) {
    display.innerText = (sens * (toFactor / fromFactor) * (fDpi / tDpi)).toFixed(3);
  }
}

function getAdvice(edpi, game) {
  if (game === "CS2") {
    if (edpi < 700) return "Rock solid for long-range duels. This setting offers maximum precision for holding angles and pixel-perfect AWPing.";
    if (edpi < 1000) return "The competitive standard. A perfect blend of control and agility for entry-fragging and consistent spray patterns.";
    return "Ultra-fast response for close-quarters chaos. Ideal for hyper-aggressive playstyles and clearing 90-degree corners instantly.";
  } else {
    if (edpi < 200) return "Built for micro-adjustments and steady crosshair placement. Excellent for tactical agents who hold deep angles.";
    if (edpi < 320) return "Optimal balance for Valorant’s tactical pacing. Provides the stability needed for headshots while remaining agile.";
    return "High-octane sensitivity. Perfect for movement-heavy duelists like Jett or Neon who need to flick 180° in a heartbeat.";
  }
}

function handleInputValidation(input, callback) {
  const isDpiField = input.id.includes("-dpi"),
    isSensField = input.id === "base-sens" || input.id === "edpi-sens";
  input.addEventListener("input", () => {
    let val = input.value;
    const start = input.selectionStart;
    if (isDpiField) {
      val = val.replace(/[^0-9]/g, "");
    } else if (isSensField) {
      val = val.replace(/[^0-9.,]/g, "");
      const firstSeparatorIndex = val.search(/[.,]/);
      if (firstSeparatorIndex !== -1) {
        const prefix = val.substring(0, firstSeparatorIndex + 1),
          rest = val.substring(firstSeparatorIndex + 1).replace(/[.,]/g, "");
        val = prefix + rest;
      }
    }
    if (val.length > 10) val = val.substring(0, 10);
    if (input.value !== val) {
      input.value = val;
      input.setSelectionRange(start, start);
    }
    callback();
  });
  input.addEventListener("focus", function () {
    setTimeout(() => this.select(), 0);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const fD = document.getElementById("from-dpi"),
    tD = document.getElementById("to-dpi");
  if (fD) fD.value = "800";
  if (tD) tD.value = "800";
  ["base-sens", "from-dpi", "to-dpi", "edpi-dpi", "edpi-sens"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) handleInputValidation(el, id.startsWith("edpi-") ? updateEDPI : updateConversion);
  });
  document.addEventListener("click", (e) => {
    ["from", "to", "edpi-game"].forEach((idPrefix) => {
      const list = document.getElementById(`${idPrefix}-list`),
        input = document.getElementById(`${idPrefix}-search`);
      if (list && input && !input.contains(e.target) && !list.contains(e.target)) {
        list.classList.add("hidden");
      }
    });
  });
  ["from", "to", "edpi-game"].forEach((idPrefix) => {
    const list = document.getElementById(`${idPrefix}-list`),
      input = document.getElementById(`${idPrefix}-search`),
      clearBtn = document.getElementById(`${idPrefix}-clear`);
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
      list.querySelectorAll(".game-option").forEach((o) => {
        o.style.display = o.textContent.toLowerCase().includes(filter) ? "flex" : "none";
      });
      list.classList.remove("hidden");
      activeIndex = 0;
      syncUI(getVisible());
      if (idPrefix === "edpi-game") updateEDPI();
      else updateConversion();
    });
    list.querySelectorAll(".game-option").forEach((opt) => {
      opt.addEventListener("mouseenter", () => {
        const visible = getVisible();
        activeIndex = visible.indexOf(opt);
        syncUI(visible);
      });
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = opt.querySelector(".game-name").textContent;
        list.classList.add("hidden");
        if (idPrefix === "edpi-game") updateEDPI();
        else updateConversion();
        input.blur();
      });
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
  });
  document.getElementById("swap-btn")?.addEventListener("click", () => {
    const el = {
      fG: document.getElementById("from-search"),
      tG: document.getElementById("to-search"),
      fD: document.getElementById("from-dpi"),
      tD: document.getElementById("to-dpi"),
      bS: document.getElementById("base-sens"),
      res: document.getElementById("new-sens-value"),
    };
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
    const fD = document.getElementById("from-dpi"),
      tD = document.getElementById("to-dpi");
    if (fD) fD.value = "800";
    if (tD) tD.value = "800";
    updateConversion();
  });
  document.getElementById("edpi-reset")?.addEventListener("click", () => {
    const eG = document.getElementById("edpi-game-search"),
      eD = document.getElementById("edpi-dpi"),
      eS = document.getElementById("edpi-sens");
    if (eG) eG.value = "";
    if (eD) eD.value = "";
    if (eS) eS.value = "";
    updateEDPI();
  });
  document.querySelectorAll(".copy-button").forEach((btn) => {
    btn.addEventListener("click", function () {
      if (isCopying) return;
      const isEdpi = this.id === "edpi-copy",
        val = document.getElementById(isEdpi ? "edpi-value" : "new-sens-value")?.innerText;
      if (!val || val === "0.00" || val === "0") {
        this.classList.add("vibrate");
        setTimeout(() => this.classList.remove("vibrate"), 300);
        return;
      }
      isCopying = true;
      const span = this.querySelector("span"),
        originalText = span ? span.innerText : "";
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
  aimTrainer.init();
  updateConversion();
  updateEDPI();
});
