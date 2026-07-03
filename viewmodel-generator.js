/* CS2 viewmodel command generator */
(function () {
  const LIMITS = {
    fov: { min: 54, max: 68, step: 1 },
    x: { min: -2.5, max: 2.5, step: 0.1 },
    y: { min: -2, max: 2, step: 0.1 },
    z: { min: -2, max: 2, step: 0.1 },
  };

  const PRESETS = {
    donk: { fov: 68, x: 2.5, y: 0, z: -1.5, presetpos: 2 },
    zywoo: { fov: 68, x: 2.5, y: 0, z: -1.5, presetpos: 1 },
    sh1ro: { fov: 65, x: 2.5, y: 2, z: -2, presetpos: 1 },
    xantares: { fov: 60, x: 1, y: 1, z: -1, presetpos: 1 },
  };

  const DEFAULTS = { ...PRESETS.donk };
  const SLIDER_MOTION_MS = 300;

  const state = { ...DEFAULTS, preset: "donk" };
  let motionFrame = 0;

  function clamp(key, value) {
    const { min, max, step } = LIMITS[key];
    const snapped = Math.round(value / step) * step;
    return Math.min(max, Math.max(min, Number(snapped.toFixed(step < 1 ? 1 : 0))));
  }

  function formatValue(key, value) {
    return key === "fov" ? String(Math.round(value)) : value.toFixed(1);
  }

  function buildViewmodelCommand(values) {
    return [
      `viewmodel_fov ${formatValue("fov", values.fov)}`,
      `viewmodel_offset_x ${formatValue("x", values.x)}`,
      `viewmodel_offset_y ${formatValue("y", values.y)}`,
      `viewmodel_offset_z ${formatValue("z", values.z)}`,
      `viewmodel_presetpos ${Math.round(values.presetpos)}`,
    ].join("; ");
  }

  function presetMatches(values) {
    return (
      Object.entries(PRESETS).find(([, preset]) =>
        Object.keys(LIMITS).every((key) => Math.abs(preset[key] - values[key]) < 0.05) &&
        Math.round(preset.presetpos) === Math.round(values.presetpos),
      )?.[0] || null
    );
  }

  function rangeProgress(key, value) {
    const { min, max } = LIMITS[key];
    if (max === min) return 0;
    return ((value - min) / (max - min)) * 100;
  }

  function syncSliderFill(slider, key, value) {
    if (!slider) return;
    slider.style.setProperty("--range-progress", `${rangeProgress(key, value)}%`);
  }

  function syncViewmodelPresetButtons() {
    const active = presetMatches(state);
    state.preset = active;
    document.querySelectorAll("[data-viewmodel-preset]").forEach((btn) => {
      btn.classList.toggle("active-preset", btn.dataset.viewmodelPreset === active);
    });
  }

  function syncViewmodelUi() {
    Object.keys(LIMITS).forEach((key) => {
      const slider = document.getElementById(`viewmodel-${key}`);
      const valueEl = document.getElementById(`viewmodel-${key}-val`);
      const formatted = formatValue(key, state[key]);
      if (slider) {
        slider.value = String(state[key]);
        syncSliderFill(slider, key, state[key]);
      }
      if (valueEl) valueEl.textContent = formatted;
    });

    const output = document.getElementById("viewmodel-output-code");
    if (output) output.textContent = buildViewmodelCommand(state);

    syncViewmodelPresetButtons();
    toggleVisibility?.(document.getElementById("viewmodel-copy"), true);
    toggleVisibility?.(document.getElementById("viewmodel-reset"), true);
  }

  function setViewmodelValue(key, rawValue) {
    if (!LIMITS[key]) return;
    cancelAnimationFrame(motionFrame);
    motionFrame = 0;
    state[key] = clamp(key, Number(rawValue));
    state.preset = presetMatches(state);
    syncViewmodelUi();
  }

  function easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
  }

  function animateViewmodelTo(target, presetName = null) {
    cancelAnimationFrame(motionFrame);
    const from = {
      fov: state.fov,
      x: state.x,
      y: state.y,
      z: state.z,
      presetpos: state.presetpos,
    };
    const to = {
      fov: clamp("fov", target.fov ?? DEFAULTS.fov),
      x: clamp("x", target.x ?? DEFAULTS.x),
      y: clamp("y", target.y ?? DEFAULTS.y),
      z: clamp("z", target.z ?? DEFAULTS.z),
      presetpos: Math.round(target.presetpos ?? DEFAULTS.presetpos),
    };

    state.presetpos = to.presetpos;
    if (presetName) state.preset = presetName;

    const reduceMotion = document.body.classList.contains("reduce-motion");
    if (reduceMotion) {
      Object.assign(state, to);
      if (presetName) state.preset = presetName;
      else state.preset = presetMatches(state);
      syncViewmodelUi();
      return;
    }

    const started = performance.now();

    function tick(now) {
      const t = Math.min(1, (now - started) / SLIDER_MOTION_MS);
      const e = easeOutCubic(t);
      Object.keys(LIMITS).forEach((key) => {
        state[key] = from[key] + (to[key] - from[key]) * e;
      });
      syncViewmodelUi();
      if (t < 1) {
        motionFrame = requestAnimationFrame(tick);
        return;
      }
      Object.assign(state, to);
      state.preset = presetName || presetMatches(state);
      syncViewmodelUi();
      motionFrame = 0;
    }

    motionFrame = requestAnimationFrame(tick);
  }

  function applyViewmodelPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    animateViewmodelTo(preset, name);
  }

  function resetViewmodelSettings() {
    animateViewmodelTo(DEFAULTS, "donk");
  }

  function initViewmodelGeneratorTab() {
    const section = document.getElementById("viewmodel-generator-tab");
    if (!section || initViewmodelGeneratorTab._init) return;
    initViewmodelGeneratorTab._init = true;

    Object.keys(LIMITS).forEach((key) => {
      const slider = document.getElementById(`viewmodel-${key}`);
      slider?.addEventListener("input", () => setViewmodelValue(key, slider.value));
    });

    document.querySelectorAll("[data-viewmodel-preset]").forEach((btn) => {
      btn.addEventListener("click", () => applyViewmodelPreset(btn.dataset.viewmodelPreset));
    });

    document.getElementById("viewmodel-copy")?.addEventListener("click", () => {
      const code = document.getElementById("viewmodel-output-code")?.textContent?.trim();
      if (!code) return;
      copyText?.(code, "Viewmodel commands copied.");
    });

    document.getElementById("viewmodel-reset")?.addEventListener("click", () => {
      confirmBeforeReset?.("Reset viewmodel settings to the donk preset?", () => resetViewmodelSettings());
    });

    Object.assign(state, DEFAULTS, { preset: "donk" });
    syncViewmodelUi();
  }

  window.initViewmodelGeneratorTab = initViewmodelGeneratorTab;
  window.updateViewmodelGeneratorUi = syncViewmodelUi;
})();
