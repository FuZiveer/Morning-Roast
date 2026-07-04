function canAnimateHeightResize() {
  return !document.body.classList.contains("reduce-motion") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function bindHeightResizeAnimation(el, { durationMs = 300, onSettle } = {}) {
  if (!el || el.dataset.resizeBound) return;
  el.dataset.resizeBound = "1";

  let lastHeight = el.offsetHeight;
  let animating = false;

  function settleHeight(animatedTo) {
    el.style.height = "";
    el.style.overflow = "";
    el.style.transition = ""; 
    animating = false;
    const actual = el.offsetHeight;
    lastHeight = actual;
    if (animatedTo != null && Math.abs(actual - animatedTo) > 1 && canAnimateHeightResize()) {
      runHeightAnimation(animatedTo, actual);
      return;
    }
    onSettle?.();
  }

  function runHeightAnimation(fromH, toH) {
    if (!canAnimateHeightResize() || animating || Math.abs(fromH - toH) < 1) {
      lastHeight = toH;
      return;
    }

    animating = true;
    el.style.overflow = "hidden";
    el.style.height = `${fromH}px`;
    el.style.transition = `height ${durationMs}ms cubic-bezier(0.4, 0, 0.2, 1)`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.style.height = `${toH}px`;
      });
    });

    const onEnd = (e) => {
      if (e.target !== el || e.propertyName !== "height") return;
      el.removeEventListener("transitionend", onEnd);
      settleHeight(toH);
    };

    el.addEventListener("transitionend", onEnd);
    setTimeout(() => {
      if (!animating) return;
      el.removeEventListener("transitionend", onEnd);
      settleHeight(toH);
    }, durationMs + 80);
  }

  if (typeof ResizeObserver === "undefined") return;

  new ResizeObserver((entries) => {
    if (animating) return;
    for (const entry of entries) {
      const target = entry.target;
      const newH = Math.round(entry.borderBoxSize?.[0]?.blockSize ?? target.offsetHeight);

      if (!target.dataset.resizeReady) {
        target.dataset.resizeReady = "1";
        lastHeight = newH;
        continue;
      }

      if (Math.abs(newH - lastHeight) < 1) continue;
      runHeightAnimation(lastHeight, newH);
    }
  }).observe(el);
}

const Toast = (() => {
  const DEFAULT_DURATION = 5000;
  const RESIZE_MS = 300;
  let layoutWatchInit = false;
  let repositionFrame = 0;

  function stackGapPx() {
    return parseFloat(getComputedStyle(document.documentElement).fontSize) * 0.5;
  }

  function bindToastResizeAnimation(toast) {
    bindHeightResizeAnimation(toast, {
      durationMs: RESIZE_MS,
      onSettle: () => toast._syncHoverPause?.(),
    });
  }

  function getStack() {
    let stack = document.getElementById("toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  let cachedNavBar = null;

  function applyReposition() {
    const stack = document.getElementById("toast-stack");
    if (!stack || !stack.children.length) return;

    if (!cachedNavBar) cachedNavBar = document.querySelector(".nav-bar");
    const gap = stackGapPx();
    const defaultTop = gap;

    let toastTop = defaultTop;
    if (cachedNavBar) {
      const navBottom = cachedNavBar.getBoundingClientRect().bottom;
      if (navBottom > defaultTop) {
        toastTop = navBottom + gap;
      }
    }

    stack.style.top = `${toastTop}px`;
  }

  function reposition() {
    const stack = document.getElementById("toast-stack");
    if (!stack || !stack.children.length) return;
    cancelAnimationFrame(repositionFrame);
    repositionFrame = requestAnimationFrame(applyReposition);
  }

  function initLayoutWatchers() {
    if (layoutWatchInit) return;
    layoutWatchInit = true;

    cachedNavBar = document.querySelector(".nav-bar");
    const stack = document.getElementById("toast-stack");

    if (typeof ResizeObserver !== "undefined") {
      if (cachedNavBar) new ResizeObserver(() => reposition()).observe(cachedNavBar);
      if (stack) new ResizeObserver(() => reposition()).observe(stack);
    }

    window.addEventListener("scroll", reposition, { passive: true });
  }

  window.addEventListener("resize", reposition);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      initLayoutWatchers();
      reposition();
    });
  } else {
    initLayoutWatchers();
    reposition();
  }

  function remove(toast) {
    if (!toast || toast.dataset.removing) return;
    toast.dataset.removing = "1";
    toast.classList.add("toast-out");
    toast.addEventListener(
      "animationend",
      () => {
        toast.remove();
        reposition();
      },
      { once: true },
    );
    setTimeout(() => toast.isConnected && toast.remove(), 400);
  }

  const NOTIFY_MAX = 5;
  const NOTIFY_VISIBLE = 3;
  const NOTIFY_GAP = 14;
  const NOTIFY_COLLAPSED_GAP = 14;
  const NOTIFY_DEFAULT_DURATION = 4000;
  const NOTIFY_ICONS = {
    success: '<i class="ri-checkbox-circle-fill"></i>',
    error: '<i class="ri-close-circle-fill"></i>',
    info: '<i class="ri-information-fill"></i>',
    default: '<i class="ri-notification-3-line"></i>',
  };

  let notifyStackBound = false;
  let notifyCollapseTimer = 0;

  function getNotifyToaster() {
    return document.getElementById("notify-toaster");
  }

  function getActiveNotifyToasts(stack) {
    return Array.from(stack.querySelectorAll(".notify-toast")).filter((toast) => !toast.dataset.removing);
  }

  function isNotifyExpanded(stack) {
    return stack.dataset.expanded === "true";
  }

  function isNotifyPointerInside() {
    const toaster = getNotifyToaster();
    const stack = document.querySelector(".notify-stack");
    if (!toaster || !stack) return false;
    if (toaster.matches(":hover") || stack.matches(":hover")) return true;
    if (stack.querySelector(".notify-toast:hover")) return true;
    if (stack.contains(document.activeElement)) return true;
    return false;
  }

  const NOTIFY_RING_RADIUS = 8;
  const NOTIFY_RING_LENGTH = 2 * Math.PI * NOTIFY_RING_RADIUS;

  function createNotifyTimerRing() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "notify-toast-timer");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("aria-hidden", "true");

    const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    track.setAttribute("class", "notify-toast-timer-track");
    track.setAttribute("cx", "10");
    track.setAttribute("cy", "10");
    track.setAttribute("r", String(NOTIFY_RING_RADIUS));

    const progress = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    progress.setAttribute("class", "notify-toast-timer-progress");
    progress.setAttribute("cx", "10");
    progress.setAttribute("cy", "10");
    progress.setAttribute("r", String(NOTIFY_RING_RADIUS));
    progress.style.strokeDasharray = `${NOTIFY_RING_LENGTH}`;
    progress.style.strokeDashoffset = "0";

    svg.appendChild(track);
    svg.appendChild(progress);
    return { svg, progress };
  }

  function setNotifyRingProgress(toast, fractionRemaining) {
    const ring = toast._timerRing;
    if (!ring) return;
    ring.style.strokeDashoffset = `${NOTIFY_RING_LENGTH * (1 - fractionRemaining)}`;
  }

  function freezeNotifyRemaining(toast) {
    if (!toast || toast._startedAt == null) return;
    toast._remaining = Math.max(0, (toast._remaining ?? NOTIFY_DEFAULT_DURATION) - (Date.now() - toast._startedAt));
    toast._startedAt = null;
  }

  function pauseNotifyTimer(toast) {
    if (!toast || toast.dataset.removing) return;
    freezeNotifyRemaining(toast);
    clearTimeout(toast._dismissTimeout);
    const duration = toast._duration || NOTIFY_DEFAULT_DURATION;
    const ring = toast._timerRing;
    if (ring) {
      ring.classList.add("paused");
      ring.classList.remove("running");
      ring.style.transition = "none";
      setNotifyRingProgress(toast, duration ? toast._remaining / duration : 0);
    }
  }

  function startNotifyTimer(toast) {
    if (!toast || toast.dataset.removing) return;
    const stack = toast.closest(".notify-stack") || document.querySelector(".notify-stack");
    if (!stack || isNotifyExpanded(stack)) return;

    clearTimeout(toast._dismissTimeout);
    if (toast._startedAt == null) toast._startedAt = Date.now();
    const duration = toast._duration || NOTIFY_DEFAULT_DURATION;
    const remaining = Math.max(0, toast._remaining ?? duration);
    const ring = toast._timerRing;

    if (ring) {
      ring.classList.remove("paused");
      const fraction = duration ? remaining / duration : 0;
      ring.style.transition = "none";
      setNotifyRingProgress(toast, fraction);
      void ring.offsetWidth;
      ring.style.transition = `stroke-dashoffset ${remaining}ms linear`;
      ring.classList.add("running");
      setNotifyRingProgress(toast, 0);
    }

    toast._dismissTimeout = window.setTimeout(() => removeNotify(toast), remaining);
  }

  function pauseAllNotifyTimers() {
    const stack = document.querySelector(".notify-stack");
    if (!stack) return;
    getActiveNotifyToasts(stack).forEach(pauseNotifyTimer);
  }

  function resumeAllNotifyTimers() {
    const stack = document.querySelector(".notify-stack");
    if (!stack) return;
    getActiveNotifyToasts(stack).forEach(startNotifyTimer);
  }

  function syncScrollButtonNotifyOffset(stackHeight) {
    document.documentElement.style.setProperty("--notify-stack-height", `${Math.max(0, stackHeight)}px`);
  }

  function layoutNotifyStack() {
    const stack = document.querySelector(".notify-stack");
    if (!stack) {
      syncScrollButtonNotifyOffset(0);
      return;
    }

    const toasts = getActiveNotifyToasts(stack);
    const expanded = isNotifyExpanded(stack);
    let offset = 0;

    toasts.forEach((toast, index) => {
      const height = toast.offsetHeight || Number(toast.dataset.initialHeight) || 54;
      toast.dataset.initialHeight = String(height);
      toast.style.setProperty("--index", String(index));
      toast.style.setProperty("--toasts-before", String(index));
      toast.style.setProperty("--z-index", String(100 - index));
      toast.style.setProperty("--offset", `${offset}px`);
      toast.style.setProperty("--initial-height", `${height}px`);
      toast.setAttribute("data-index", String(index));
      toast.setAttribute("data-front", index === 0 ? "true" : "false");
      toast.setAttribute("data-visible", index < NOTIFY_VISIBLE ? "true" : "false");

      if (expanded) offset += height + NOTIFY_GAP;
      else if (index < NOTIFY_VISIBLE - 1) offset += NOTIFY_COLLAPSED_GAP;
    });

    stack.querySelectorAll(".notify-toast[data-removed='true']").forEach((toast) => {
      const isFront = toast.getAttribute("data-front") === "true";
      toast.style.setProperty("--z-index", isFront ? "200" : "0");
    });

    if (!toasts.length) {
      stack.style.height = "0px";
      syncScrollButtonNotifyOffset(0);
      return;
    }

    if (expanded) {
      stack.style.height = `${Math.max(0, offset - NOTIFY_GAP)}px`;
    } else {
      const frontHeight = Number(toasts[0].dataset.initialHeight) || 54;
      const peekCount = Math.max(0, Math.min(toasts.length, NOTIFY_VISIBLE) - 1);
      stack.style.height = `${frontHeight + peekCount * NOTIFY_COLLAPSED_GAP}px`;
    }

    syncScrollButtonNotifyOffset(stack.offsetHeight || parseFloat(stack.style.height) || 0);
  }

  function setNotifyExpanded(expanded) {
    const stack = document.querySelector(".notify-stack");
    if (!stack) return;
    if (isNotifyExpanded(stack) === expanded) {
      if (expanded) layoutNotifyStack();
      return;
    }

    stack.dataset.expanded = expanded ? "true" : "false";
    stack.setAttribute("data-expanded", expanded ? "true" : "false");
    layoutNotifyStack();

    if (expanded) pauseAllNotifyTimers();
    else resumeAllNotifyTimers();
  }

  function cancelNotifyCollapse() {
    clearTimeout(notifyCollapseTimer);
    setNotifyExpanded(true);
  }

  function scheduleNotifyCollapse() {
    clearTimeout(notifyCollapseTimer);
    notifyCollapseTimer = window.setTimeout(() => {
      if (isNotifyPointerInside()) return;
      setNotifyExpanded(false);
    }, 200);
  }

  function bindNotifyStack(stack) {
    if (notifyStackBound) return;
    notifyStackBound = true;

    const toaster = stack.closest(".notify-toaster") || stack;

    toaster.addEventListener("pointerenter", cancelNotifyCollapse);
    toaster.addEventListener("pointerleave", scheduleNotifyCollapse);
    stack.addEventListener("focusin", cancelNotifyCollapse);
    stack.addEventListener("focusout", (event) => {
      if (!stack.contains(event.relatedTarget)) scheduleNotifyCollapse();
    });
  }

  function getNotifyStack() {
    let stack = document.querySelector(".notify-stack");
    if (!stack) {
      const section = document.createElement("section");
      section.id = "notify-toaster";
      section.className = "notify-toaster";
      section.setAttribute("aria-label", "Notifications");
      section.setAttribute("aria-live", "polite");
      stack = document.createElement("ol");
      stack.className = "toaster notify-stack";
      stack.setAttribute("data-x-position", "right");
      stack.setAttribute("data-y-position", "bottom");
      stack.dataset.expanded = "false";
      stack.setAttribute("data-expanded", "false");
      section.appendChild(stack);
      document.body.appendChild(section);
    }
    bindNotifyStack(stack);
    return stack;
  }

  function removeNotify(toast) {
    if (!toast || toast.dataset.removing) return;

    const isFront = toast.getAttribute("data-front") === "true";
    pauseNotifyTimer(toast);
    toast.dataset.removing = "1";
    toast.setAttribute("data-removed", "true");
    toast.style.setProperty("--z-index", isFront ? "200" : "0");
    layoutNotifyStack();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      toast.remove();
      layoutNotifyStack();
    };

    toast.addEventListener(
      "transitionend",
      (event) => {
        if (event.target === toast && (event.propertyName === "opacity" || event.propertyName === "transform")) finish();
      },
      { once: true },
    );
    setTimeout(finish, 400);
  }

  function notify(opts = {}) {
    const { message = "", type = "default", duration = NOTIFY_DEFAULT_DURATION } = opts;
    const text = String(message).trim();
    if (!text) return null;

    const stack = getNotifyStack();
    const active = getActiveNotifyToasts(stack);
    while (active.length >= NOTIFY_MAX) {
      const oldest = active.pop();
      removeNotify(oldest);
    }

    const toast = document.createElement("li");
    toast.className = "notify-toast";
    toast.setAttribute("data-type", type);
    toast.setAttribute("data-mounted", "false");
    toast.setAttribute("data-y-position", "bottom");
    toast.setAttribute("data-x-position", "right");
    toast.setAttribute("data-removed", "false");
    toast.setAttribute("data-dismissible", "false");
    toast._duration = duration;
    toast._remaining = duration;
    toast._startedAt = null;

    const icon = document.createElement("span");
    icon.className = "notify-toast-icon";
    icon.setAttribute("aria-hidden", "true");
    const { svg, progress } = createNotifyTimerRing();
    icon.appendChild(svg);
    icon.insertAdjacentHTML("beforeend", NOTIFY_ICONS[type] || NOTIFY_ICONS.default);
    toast._timerRing = progress;

    const messageEl = document.createElement("span");
    messageEl.className = "notify-toast-message";
    messageEl.textContent = text;

    toast.appendChild(icon);
    toast.appendChild(messageEl);
    stack.prepend(toast);

    requestAnimationFrame(() => {
      layoutNotifyStack();
      requestAnimationFrame(() => {
        toast.setAttribute("data-mounted", "true");
        layoutNotifyStack();
        startNotifyTimer(toast);
      });
    });

    return toast;
  }

  function show(opts = {}) {
    const { title = "", body = "", duration = DEFAULT_DURATION, copyText: copyValue } = opts;
    const plainBody = String(body)
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const parts = [];
    if (title) parts.push(title);
    if (plainBody) parts.push(plainBody);
    if (copyValue && !plainBody.includes(String(copyValue))) parts.push(String(copyValue));
    const message = parts.join(" · ") || "Notification";

    const titleLower = String(title).toLowerCase();
    let type = "default";
    if (/fail|error|cannot|could not/.test(titleLower) || /fail|error|could not/.test(plainBody.toLowerCase())) type = "error";
    else if (/complete|copied|success|optimal/.test(titleLower) || /copied|discovered|optimal/.test(plainBody.toLowerCase())) type = "success";
    else if (/tip|shortcut|keyboard|help/.test(titleLower) || /shortcut|press/.test(plainBody.toLowerCase())) type = "info";

    return notify({ message, type, duration });
  }

  return { show, notify, remove, reposition };
})();
window.Toast = Toast;

function notifyCopied(body) {
  const plain = typeof body === "string" ? body.replace(/<[^>]*>/g, "").trim() : "";
  Toast.notify({ message: plain || "Copied to clipboard", type: "success" });
}

function copyText(text, toastBody) {
  return navigator.clipboard
    .writeText(text)
    .then(() => notifyCopied(toastBody ?? `<b>${text}</b> has been copied.`))
    .catch(() => {
      Toast.notify({ message: "Could not copy to clipboard", type: "error" });
    });
}

const gameMultipliers = Object.freeze({
  "Call of Duty: Black Ops 7": 10.61,
  "Rainbow Six Siege": 12.22,
  "Escape From Tarkov": 0.56,
  "Apex Legends": 3.18,
  "ARC Raiders": 51.43,
  "Overwatch 2": 10.61,
  "Delta Force": 7.0,
  Fortnite: 12.6,
  Valorant: 1.0,
  Roblox: 0.18,
  Aimlabs: 1.4,
  "osu!": 0.88,
  Rust: 0.62,
  CS2: 3.18,
});

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

const edpiPresets = Object.freeze({
  Valorant: {
    color: "hsl(355, 100%, 64%)",
    presets: [
      { name: "Demon1", dpi: 1600, sens: 0.1 },
      { name: "TenZ", dpi: 1600, sens: 0.173 },
      { name: "Zekken", dpi: 1600, sens: 0.175 },
      { name: "aspas", dpi: 800, sens: 0.37 },
      { name: "f0rsakeN", dpi: 800, sens: 0.645 },
      { name: "ScreaM", dpi: 400, sens: 2.35 },
    ],
  },
  CS2: {
    color: "hsl(37, 90%, 51%)",
    presets: [
      { name: "ropz", dpi: 400, sens: 1.77 },
      { name: "ZywOo", dpi: 400, sens: 2 },
      { name: "m0NESY", dpi: 400, sens: 2.3 },
      { name: "donk", dpi: 800, sens: 1.25 },
      { name: "flameZ", dpi: 400, sens: 3 },
      { name: "s1mple", dpi: 400, sens: 3.09 },
    ],
  },
  "Apex Legends": {
    color: "hsl(0, 80%, 55%)",
    presets: [
      { name: "ImperialHal", dpi: 400, sens: 1.6 },
      { name: "Genburten", dpi: 400, sens: 2 },
      { name: "Sweet", dpi: 800, sens: 1.2 },
      { name: "Verhulst", dpi: 400, sens: 1.5 },
      { name: "HisWattson", dpi: 400, sens: 1.8 },
      { name: "Zer0", dpi: 800, sens: 1.1 },
    ],
  },
  "Rainbow Six Siege": {
    color: "hsl(210, 90%, 55%)",
    presets: [
      { name: "Beaulo", dpi: 1600, sens: 8 },
      { name: "Pengu", dpi: 400, sens: 12 },
      { name: "Shaiiko", dpi: 800, sens: 9 },
      { name: "Bryan", dpi: 400, sens: 14 },
      { name: "CTZN", dpi: 400, sens: 11 },
      { name: "Doki", dpi: 800, sens: 8.5 },
    ],
  },
  "Overwatch 2": {
    color: "hsl(28, 90%, 55%)",
    presets: [
      { name: "Sparkr", dpi: 800, sens: 5 },
      { name: "Kariv", dpi: 400, sens: 8.6 },
      { name: "Profit", dpi: 800, sens: 5.5 },
      { name: "Carpe", dpi: 800, sens: 6 },
      { name: "Happy", dpi: 1600, sens: 3 },
      { name: "Fleta", dpi: 800, sens: 5.2 },
    ],
  },
  Fortnite: {
    color: "hsl(265, 70%, 60%)",
    presets: [
      { name: "Bugha", dpi: 400, sens: 0.08 },
      { name: "Clix", dpi: 400, sens: 0.09 },
      { name: "Mongraal", dpi: 400, sens: 0.07 },
      { name: "Benjyfishy", dpi: 400, sens: 0.085 },
      { name: "Cooper", dpi: 800, sens: 0.05 },
      { name: "Peterbot", dpi: 400, sens: 0.075 },
    ],
  },
  "Call of Duty: Black Ops 7": {
    color: "hsl(95, 45%, 50%)",
    presets: [
      { name: "Scump", dpi: 800, sens: 6 },
      { name: "Shotzzy", dpi: 800, sens: 7 },
      { name: "aBeZy", dpi: 800, sens: 6.5 },
      { name: "Simp", dpi: 800, sens: 7.5 },
      { name: "Dashy", dpi: 800, sens: 6 },
      { name: "Cellium", dpi: 800, sens: 6.8 },
    ],
  },
  "Delta Force": {
    color: "hsl(150, 60%, 45%)",
    presets: [
      { name: "Balanced", dpi: 800, sens: 35 },
      { name: "Low", dpi: 400, sens: 30 },
      { name: "High", dpi: 1600, sens: 25 },
      { name: "Tracker", dpi: 800, sens: 28 },
      { name: "Flicker", dpi: 800, sens: 45 },
      { name: "Hybrid", dpi: 400, sens: 50 },
    ],
  },
  "Escape From Tarkov": {
    color: "hsl(40, 30%, 50%)",
    presets: [
      { name: "Balanced", dpi: 800, sens: 0.4 },
      { name: "Low", dpi: 400, sens: 0.45 },
      { name: "High", dpi: 1600, sens: 0.25 },
      { name: "Sniper", dpi: 800, sens: 0.3 },
      { name: "CQB", dpi: 800, sens: 0.5 },
      { name: "Hybrid", dpi: 400, sens: 0.6 },
    ],
  },
  Rust: {
    color: "hsl(15, 55%, 50%)",
    presets: [
      { name: "Balanced", dpi: 800, sens: 0.4 },
      { name: "Low", dpi: 400, sens: 0.5 },
      { name: "High", dpi: 1600, sens: 0.25 },
      { name: "AK Control", dpi: 800, sens: 0.3 },
      { name: "Aggressive", dpi: 800, sens: 0.55 },
      { name: "Hybrid", dpi: 400, sens: 0.65 },
    ],
  },
  Aimlabs: {
    color: "hsl(190, 80%, 50%)",
    presets: [
      { name: "Valorant-like", dpi: 800, sens: 0.4 },
      { name: "CS2-like", dpi: 400, sens: 1 },
      { name: "Low", dpi: 400, sens: 0.5 },
      { name: "High", dpi: 1600, sens: 0.3 },
      { name: "Tracking", dpi: 800, sens: 0.45 },
      { name: "Flicking", dpi: 800, sens: 0.6 },
    ],
  },
  "osu!": {
    color: "hsl(330, 80%, 60%)",
    presets: [
      { name: "Standard", dpi: 800, sens: 1 },
      { name: "Low", dpi: 400, sens: 1.5 },
      { name: "High", dpi: 1600, sens: 0.6 },
      { name: "Tablet-like", dpi: 800, sens: 0.8 },
      { name: "Stream", dpi: 800, sens: 1.2 },
      { name: "Jump", dpi: 1600, sens: 0.7 },
    ],
  },
  Roblox: {
    color: "hsl(0, 0%, 60%)",
    presets: [
      { name: "Balanced", dpi: 800, sens: 0.5 },
      { name: "Low", dpi: 400, sens: 0.6 },
      { name: "High", dpi: 1600, sens: 0.3 },
      { name: "Arsenal", dpi: 800, sens: 0.4 },
      { name: "Aggressive", dpi: 800, sens: 0.7 },
      { name: "Hybrid", dpi: 400, sens: 0.8 },
    ],
  },
  "ARC Raiders": {
    color: "hsl(180, 50%, 50%)",
    presets: [
      { name: "Balanced", dpi: 800, sens: 5 },
      { name: "Low", dpi: 400, sens: 6 },
      { name: "High", dpi: 1600, sens: 3 },
      { name: "Tracker", dpi: 800, sens: 4 },
      { name: "Aggressive", dpi: 800, sens: 7 },
      { name: "Hybrid", dpi: 400, sens: 8 },
    ],
  },
});

const trainerConfigs = {
  Aimlabs: { constant: 0.05, fov: 103 },
  "Apex Legends": { constant: 0.022, fov: 90 },
  "ARC Raiders": { constant: 0.00136, fov: 90 },
  "Call of Duty: Black Ops 7": { constant: 0.0066, fov: 103 },
  CS2: { constant: 0.022, fov: 90 },
  "Delta Force": { constant: 0.01, fov: 103 },
  "Escape From Tarkov": { constant: 0.125, fov: 90 },
  Fortnite: { constant: 0.0055, fov: 103 },
  "osu!": { constant: 0.0795, fov: 90 },
  "Overwatch 2": { constant: 0.0066, fov: 103 },
  "Rainbow Six Siege": { constant: 0.0057, fov: 90 },
  Roblox: { constant: 0.3888, fov: 90 },
  Rust: { constant: 0.1129, fov: 90 },
  Valorant: { constant: 0.07, fov: 103 },
};

const SUPPORTED_GAMES = Object.freeze(Object.keys(trainerConfigs).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));

/** Simple Icons brand marks for game dropdown options. */
const GAME_ICON_BRANDS = Object.freeze({
  Valorant: { slug: "valorant", color: "FF4655" },
  CS2: { slug: "counterstrike", color: "DE9B35" },
  "Apex Legends": { slug: "apexlegends", color: "DA292A" },
  Fortnite: { slug: "fortnite", color: "9D4DBB" },
  "Overwatch 2": { slug: "overwatch", color: "F99E1A" },
  "Rainbow Six Siege": { slug: "ubisoft", color: "0080FF" },
  Roblox: { slug: "roblox", color: "E2231A" },
  "osu!": { slug: "osu", color: "FF66AA" },
  "Call of Duty: Black Ops 7": { slug: "callofduty", color: "8B8B8B" },
});

function getGameIconSrc(gameName) {
  const brand = GAME_ICON_BRANDS[gameName];
  if (!brand) return "";
  return `https://cdn.simpleicons.org/${brand.slug}/${brand.color}`;
}

function getGameIconFallbackColor(gameName) {
  return edpiPresets[gameName]?.color || "hsl(0, 0%, 55%)";
}

function getGameIconInitial(gameName) {
  const cleaned = String(gameName || "").replace(/^[^A-Za-z0-9]+/, "");
  return (cleaned.charAt(0) || "?").toUpperCase();
}

function renderGameOptionIcon(gameName) {
  const src = getGameIconSrc(gameName);
  if (src) {
    return `<img class="game-option-icon" src="${src}" alt="" width="18" height="18" loading="lazy" decoding="async" />`;
  }
  const color = getGameIconFallbackColor(gameName);
  const initial = getGameIconInitial(gameName);
  return `<span class="game-option-icon game-option-icon--fallback" style="--game-icon-color:${color}" aria-hidden="true">${initial}</span>`;
}

const TRAINER_MODES = Object.freeze([
  { id: "static", label: "Static", icon: "ri-focus-3-line", scoreType: "hits", maxTargets: 4, spawnBand: { yaw: 0.2, pitch: 0.1 } },
  { id: "shrinking", label: "Shrink", icon: "ri-contract-left-right-line", scoreType: "hits", maxTargets: 4, spawnBand: { yaw: 0.2, pitch: 0.1 } },
  { id: "tracking", label: "Track", icon: "ri-drag-move-line", scoreType: "accuracy", maxTargets: 1 },
  { id: "flick", label: "Flick", icon: "ri-crosshair-2-line", scoreType: "hits", maxTargets: 1, spawnBand: { yaw: 0.24, pitch: 0.12 } },
  { id: "switch", label: "Switch", icon: "ri-arrow-left-right-line", scoreType: "hits", maxTargets: 2, spawnBand: { yaw: 0.2, pitch: 0.1 } },
  { id: "strafe", label: "Strafe", icon: "ri-run-line", scoreType: "hits", maxTargets: 3, movement: "strafe", spawnBand: { yaw: 0.2, pitch: 0.1 } },
  { id: "micro", label: "Micro", icon: "ri-zoom-in-line", scoreType: "hits", maxTargets: 4, spawnBand: { yaw: 0.12, pitch: 0.06 } },
]);

const TARGET_SHOT_DAMAGE = 50;

const FLICK_IDLE_MS = 90;
const FLICK_MAX_AGE_MS = 220;
const FLICK_SHOT_GAP_MS = 100;
const FLICK_MIN_DIST = 0.014;
const FLICK_MIN_SPEED = 0.32;
const FLICK_MAX_DURATION_MS = 320;
const FLICK_CLOSE_RADIUS_MULT = 3;
const FLICK_ALIGN_MIN = 0.55;
const FLICK_OVERSHOOT_OVER = 1.07;
const FLICK_OVERSHOOT_UNDER = 0.93;
const TARGET_FIRE_RATE_MS = 150;
const TRACKING_TARGET_MAX_HEALTH = 250;
const TRACKING_PHASE_SPEED_X = 0.0035;
const TRACKING_PHASE_SPEED_Y = 0.0021;
const TRACKING_YAW_AMP = 0.8;
const TRACKING_PITCH_AMP = 0.4;
const TRACKING_HOP_PITCH_AMP = 0.44;
const TRACKING_HOP_GROUND_PITCH = -0.1;
const TRACKING_DEPTH_RADIUS_MIN = 0.68;
const TRACKING_DEPTH_RADIUS_MAX = 1.32;
const TRACKING_PATTERNS = Object.freeze(["default", "hop", "depth"]);

function pickTrackingPattern() {
  return TRACKING_PATTERNS[Math.floor(Math.random() * TRACKING_PATTERNS.length)];
}
const DEFAULT_TARGET_MAX_HEALTH = 50;

function normalizeTrainerMode(mode) {
  return TRAINER_MODES.some((entry) => entry.id === mode) ? mode : "static";
}

function getTrainerModeDef(mode) {
  return TRAINER_MODES.find((entry) => entry.id === normalizeTrainerMode(mode)) || TRAINER_MODES[0];
}

function isTrainerAccuracyMode(mode) {
  return getTrainerModeDef(mode).scoreType === "accuracy";
}

function getModeMaxTargets(mode) {
  return getTrainerModeDef(mode).maxTargets;
}

function getTargetMaxHealth(mode, trackingHpMode = "limited") {
  if (!isTrainerAccuracyMode(mode)) return DEFAULT_TARGET_MAX_HEALTH;
  return normalizeTrackingHpMode(trackingHpMode) === "unlimited" ? Infinity : TRACKING_TARGET_MAX_HEALTH;
}

function normalizeTrackingHpMode(value) {
  return value === "unlimited" ? "unlimited" : "limited";
}

function syncTrackingHpSettingVisibility(mode) {
  const block = document.getElementById("tracking-hp-setting");
  if (!block) return;
  const show = normalizeTrainerMode(mode) === "tracking";
  block.hidden = !show;
  block.classList.toggle("hidden", !show);
  if (show) aimTrainer?.updateAllGliders?.();
}

function getModeSpawnBand(mode) {
  return getTrainerModeDef(mode).spawnBand || { yaw: 0.2, pitch: 0.1 };
}

function renderTrainerModeOptions(listEl) {
  if (!listEl) return;
  listEl.innerHTML = TRAINER_MODES.map((entry) => `<button type="button" class="pref-dropdown-option" data-trainer-mode="${entry.id}" role="option"><i class="${entry.icon} pref-dropdown-option-icon" aria-hidden="true"></i><span>${entry.label}</span></button>`).join("");
}

function syncProfileModeDropdownUi(mode) {
  const def = getTrainerModeDef(mode);
  const label = document.getElementById("profile-mode-label");
  const icon = document.getElementById("profile-mode-icon");
  const dropdown = document.getElementById("profile-mode-dropdown");
  const list = document.getElementById("profile-mode-list");
  if (label) label.textContent = def.label;
  if (icon) icon.className = `${def.icon} pref-dropdown-icon`;
  if (dropdown) dropdown.dataset.value = def.id;
  list?.querySelectorAll("[data-trainer-mode]").forEach((opt) => {
    opt.classList.toggle("active", opt.getAttribute("data-trainer-mode") === def.id);
  });
}

function initProfileModeDropdown() {
  const dropdown = document.getElementById("profile-mode-dropdown");
  const trigger = document.getElementById("profile-mode-trigger");
  const list = document.getElementById("profile-mode-list");
  if (!dropdown || !trigger || !list || initProfileModeDropdown._init) return;
  initProfileModeDropdown._init = true;

  renderTrainerModeOptions(list);
  syncProfileModeDropdownUi("static");

  const close = () => {
    dropdown.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    unmountPrefDropdownPortal(list);
  };

  const open = () => {
    initProfileTimerDropdown.close?.();
    hideAllGameDropdownLists();
    dropdown.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.classList.remove("hidden");
    mountPrefDropdownPortal(list, trigger);
  };

  initProfileModeDropdown.close = close;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("is-open")) close();
    else open();
  });

  list.querySelectorAll("[data-trainer-mode]").forEach((opt) => {
    opt.addEventListener("click", () => {
      const value = normalizeTrainerMode(opt.getAttribute("data-trainer-mode"));
      syncProfileModeDropdownUi(value);
      close();
      aimTrainer.displayResultsOnProfile();
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
}

const PROFILE_SESSION_TIMERS = Object.freeze([
  { id: "15", label: "15s" },
  { id: "30", label: "30s" },
  { id: "60", label: "60s" },
]);

function normalizeProfileTimer(timer) {
  const value = String(timer);
  return PROFILE_SESSION_TIMERS.some((entry) => entry.id === value) ? value : "15";
}

function renderProfileTimerOptions(listEl) {
  if (!listEl) return;
  listEl.innerHTML = PROFILE_SESSION_TIMERS.map((entry) => `<button type="button" class="pref-dropdown-option" data-profile-timer="${entry.id}" role="option"><i class="ri-time-line pref-dropdown-option-icon" aria-hidden="true"></i><span>${entry.label}</span></button>`).join("");
}

function syncProfileTimerDropdownUi(timer) {
  const value = normalizeProfileTimer(timer);
  const entry = PROFILE_SESSION_TIMERS.find((item) => item.id === value) || PROFILE_SESSION_TIMERS[0];
  const label = document.getElementById("profile-timer-label");
  const icon = document.getElementById("profile-timer-icon");
  const dropdown = document.getElementById("profile-timer-dropdown");
  const list = document.getElementById("profile-timer-list");
  if (label) label.textContent = entry.label;
  if (icon) icon.className = "ri-time-line pref-dropdown-icon";
  if (dropdown) dropdown.dataset.value = entry.id;
  list?.querySelectorAll("[data-profile-timer]").forEach((opt) => {
    opt.classList.toggle("active", opt.getAttribute("data-profile-timer") === entry.id);
  });
}

function initProfileTimerDropdown() {
  const dropdown = document.getElementById("profile-timer-dropdown");
  const trigger = document.getElementById("profile-timer-trigger");
  const list = document.getElementById("profile-timer-list");
  if (!dropdown || !trigger || !list || initProfileTimerDropdown._init) return;
  initProfileTimerDropdown._init = true;

  renderProfileTimerOptions(list);
  syncProfileTimerDropdownUi("15");

  const close = () => {
    dropdown.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    unmountPrefDropdownPortal(list);
  };

  const open = () => {
    initProfileModeDropdown.close?.();
    hideAllGameDropdownLists();
    dropdown.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.classList.remove("hidden");
    mountPrefDropdownPortal(list, trigger);
  };

  initProfileTimerDropdown.close = close;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("is-open")) close();
    else open();
  });

  list.querySelectorAll("[data-profile-timer]").forEach((opt) => {
    opt.addEventListener("click", () => {
      const value = normalizeProfileTimer(opt.getAttribute("data-profile-timer"));
      syncProfileTimerDropdownUi(value);
      close();
      aimTrainer.displayResultsOnProfile();
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
}

function initProfileStatsDropdowns() {
  document.querySelectorAll("#stats-tab .profile-stats-dropdown").forEach((dropdown) => {
    const trigger = dropdown.querySelector(".app-status-trigger");
    if (!trigger || dropdown.dataset.dropdownBound) return;
    dropdown.dataset.dropdownBound = "1";
    trigger.addEventListener("click", () => {
      const open = dropdown.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open && dropdown.querySelector("#profile-filter-panel")) {
        initProfileModeDropdown.close?.();
        initProfileTimerDropdown.close?.();
        hideAllGameDropdownLists();
      }
      if (open) requestProfileChartsRedraw();
    });
  });
}

function syncTrainerModeDropdownUi(mode) {
  const def = getTrainerModeDef(mode);
  const label = document.getElementById("trainer-mode-label");
  const icon = document.getElementById("trainer-mode-icon");
  const dropdown = document.getElementById("trainer-mode-dropdown");
  const list = document.getElementById("trainer-mode-list");
  if (label) label.textContent = def.label;
  if (icon) icon.className = `${def.icon} pref-dropdown-icon`;
  if (dropdown) dropdown.dataset.value = def.id;
  list?.querySelectorAll("[data-trainer-mode]").forEach((opt) => {
    opt.classList.toggle("active", opt.getAttribute("data-trainer-mode") === def.id);
  });
  syncTrackingHpSettingVisibility(def.id);
}

const TRAINER_SESSION_TIMERS = Object.freeze([
  { id: "15", label: "15s" },
  { id: "30", label: "30s" },
  { id: "60", label: "60s" },
  { id: "infinite", label: "Infinite" },
]);

function normalizeTrainerTimer(timer) {
  const value = String(timer);
  return TRAINER_SESSION_TIMERS.some((entry) => entry.id === value) ? value : "15";
}

function isInfiniteTrainerTimer(timerId) {
  return normalizeTrainerTimer(timerId) === "infinite";
}

const TRAINER_ASPECT_RATIOS = Object.freeze([
  { id: "16:9", label: "16:9", width: 16, height: 9 },
  { id: "16:10", label: "16:10", width: 16, height: 10 },
  { id: "4:3", label: "4:3", width: 4, height: 3 },
  { id: "5:4", label: "5:4", width: 5, height: 4 },
  { id: "3:2", label: "3:2", width: 3, height: 2 },
  { id: "21:9", label: "21:9", width: 21, height: 9 },
]);

function normalizeTrainerAspectRatio(ratio) {
  const value = String(ratio || "16:9");
  return TRAINER_ASPECT_RATIOS.some((entry) => entry.id === value) ? value : "16:9";
}

function getTrainerAspectRatioEntry(ratio) {
  const id = normalizeTrainerAspectRatio(ratio);
  return TRAINER_ASPECT_RATIOS.find((entry) => entry.id === id) || TRAINER_ASPECT_RATIOS[0];
}

const TRAINER_DEFAULT_ASPECT_RATIO = 16 / 9;

function getTrainerAspectHorizontalScale(ratio) {
  const entry = getTrainerAspectRatioEntry(ratio);
  return TRAINER_DEFAULT_ASPECT_RATIO / (entry.width / entry.height);
}

function getTrainerAspectVerticalScale(ratio) {
  const entry = getTrainerAspectRatioEntry(ratio);
  return entry.width / entry.height / TRAINER_DEFAULT_ASPECT_RATIO;
}

function renderTrainerAspectOptions(listEl) {
  if (!listEl) return;
  listEl.innerHTML = TRAINER_ASPECT_RATIOS.map((entry) => `<button type="button" class="pref-dropdown-option" data-trainer-aspect="${entry.id}" role="option"><i class="ri-aspect-ratio-line pref-dropdown-option-icon" aria-hidden="true"></i><span>${entry.label}</span></button>`).join("");
}

function syncTrainerAspectDropdownUi(ratio) {
  const entry = getTrainerAspectRatioEntry(ratio);
  const label = document.getElementById("trainer-aspect-label");
  const icon = document.getElementById("trainer-aspect-icon");
  const dropdown = document.getElementById("trainer-aspect-dropdown");
  const list = document.getElementById("trainer-aspect-list");
  if (label) label.textContent = entry.label;
  if (icon) icon.className = "ri-aspect-ratio-line pref-dropdown-icon";
  if (dropdown) dropdown.dataset.value = entry.id;
  list?.querySelectorAll("[data-trainer-aspect]").forEach((opt) => {
    opt.classList.toggle("active", opt.getAttribute("data-trainer-aspect") === entry.id);
  });
}

function applyTrainerAspectRatio(ratio) {
  const entry = getTrainerAspectRatioEntry(ratio);
  const container = document.querySelector(".flick-trainer-container");
  if (container) {
    container.style.setProperty("--trainer-aspect-ratio", `${entry.width} / ${entry.height}`);
    container.dataset.aspectRatio = entry.id;
  }
  localStorage.setItem("aimAspectRatio", entry.id);
  syncTrainerAspectDropdownUi(entry.id);
  aimTrainer?.handleResize?.();
}

function initTrainerAspectDropdown(savedRatio) {
  const dropdown = document.getElementById("trainer-aspect-dropdown");
  const trigger = document.getElementById("trainer-aspect-trigger");
  const list = document.getElementById("trainer-aspect-list");
  if (!dropdown || !trigger || !list || initTrainerAspectDropdown._init) return;
  initTrainerAspectDropdown._init = true;

  renderTrainerAspectOptions(list);

  const close = () => {
    dropdown.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    unmountPrefDropdownPortal(list);
  };

  const open = () => {
    initTrainerModeDropdown.close?.();
    initTrainerTimerDropdown.close?.();
    initBgPatternDropdown.close?.();
    dropdown.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.classList.remove("hidden");
    mountPrefDropdownPortal(list, trigger);
  };

  initTrainerAspectDropdown.close = close;
  syncTrainerAspectDropdownUi(savedRatio);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("is-open")) close();
    else open();
  });

  list.querySelectorAll("[data-trainer-aspect]").forEach((opt) => {
    opt.addEventListener("click", () => {
      aimTrainer.applyAspectRatio(opt.getAttribute("data-trainer-aspect"));
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
}

function renderTrainerTimerOptions(listEl) {
  if (!listEl) return;
  listEl.innerHTML = TRAINER_SESSION_TIMERS.map((entry) => `<button type="button" class="pref-dropdown-option" data-trainer-timer="${entry.id}" role="option"><i class="ri-time-line pref-dropdown-option-icon" aria-hidden="true"></i><span>${entry.label}</span></button>`).join("");
}

function syncTrainerTimerDropdownUi(timer) {
  const value = normalizeTrainerTimer(timer);
  const entry = TRAINER_SESSION_TIMERS.find((item) => item.id === value) || TRAINER_SESSION_TIMERS[0];
  const label = document.getElementById("trainer-timer-label");
  const icon = document.getElementById("trainer-timer-icon");
  const dropdown = document.getElementById("trainer-timer-dropdown");
  const list = document.getElementById("trainer-timer-list");
  if (label) label.textContent = entry.label;
  if (icon) icon.className = "ri-time-line pref-dropdown-icon";
  if (dropdown) dropdown.dataset.value = entry.id;
  list?.querySelectorAll("[data-trainer-timer]").forEach((opt) => {
    opt.classList.toggle("active", opt.getAttribute("data-trainer-timer") === entry.id);
  });
}

function initTrainerTimerDropdown(savedTimer) {
  const dropdown = document.getElementById("trainer-timer-dropdown");
  const trigger = document.getElementById("trainer-timer-trigger");
  const list = document.getElementById("trainer-timer-list");
  if (!dropdown || !trigger || !list || initTrainerTimerDropdown._init) return;
  initTrainerTimerDropdown._init = true;

  renderTrainerTimerOptions(list);

  const close = () => {
    dropdown.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    unmountPrefDropdownPortal(list);
  };

  const open = () => {
    initTrainerModeDropdown.close?.();
    initTrainerAspectDropdown.close?.();
    initBgPatternDropdown.close?.();
    dropdown.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.classList.remove("hidden");
    mountPrefDropdownPortal(list, trigger);
  };

  initTrainerTimerDropdown.close = close;
  syncTrainerTimerDropdownUi(savedTimer);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("is-open")) close();
    else open();
  });

  list.querySelectorAll("[data-trainer-timer]").forEach((opt) => {
    opt.addEventListener("click", () => {
      if (opt.disabled) return;
      const value = normalizeTrainerTimer(opt.getAttribute("data-trainer-timer"));
      aimTrainer.applySessionTimer(value);
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
}

function renderGameOptions(list, valueAttr = "data-game") {
  if (!list) return;
  list.innerHTML = SUPPORTED_GAMES.map(
    (name) =>
      `<button type="button" class="pref-dropdown-option" ${valueAttr}="${name}" role="option">${renderGameOptionIcon(name)}<span>${name}</span></button>`,
  ).join("");
}

function getGameOptionLabel(opt) {
  return opt.getAttribute("data-profile-game") || opt.getAttribute("data-value") || opt.getAttribute("data-game") || opt.querySelector("span")?.textContent.trim() || "";
}

const GAME_DROPDOWN_VALUE_ATTRS = {
  from: "data-game",
  to: "data-game",
  "edpi-game": "data-game",
  "trainer-game": "data-value",
  "profile-game": "data-profile-game",
};

const GAME_DROPDOWN_PREFIXES = Object.keys(GAME_DROPDOWN_VALUE_ATTRS);

const GAME_DROPDOWN_USE_PORTAL = {
  from: true,
  to: true,
  "edpi-game": true,
  "trainer-game": true,
  "profile-game": true,
};

function shouldPortalGameDropdown(idPrefix) {
  return GAME_DROPDOWN_USE_PORTAL[idPrefix] !== false;
}

function syncProfileGameDropdownUi(game) {
  const list = document.getElementById("profile-game-list");
  if (!list || !game) return;
  list.querySelectorAll("[data-profile-game]").forEach((opt) => {
    opt.classList.toggle("active", opt.getAttribute("data-profile-game") === game);
  });
}

let isCopying = false;

const elements = {};
const cacheElements = () => {
  const ids = ["base-sens", "from-dpi", "to-dpi", "new-sens-value", "from-search", "to-search", "edpi-dpi", "edpi-sens", "edpi-game-search", "edpi-value", "spectrum-pointer", "edpi-rank", "pro-comparison", "pro-name", "canvas-sens", "canvas-dpi", "profile-best-spatial-canvas", "profile-best-precision-canvas", "finder-reset-btn"];
  ids.forEach((id) => {
    elements[id] = document.getElementById(id);
  });
};

function scrollToTop(ms) {
  if (window.innerWidth <= 768) return;
  if (window.scrollY <= 0) return;
  setTimeout(() => {
    if (window.scrollY <= 0) return;
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }, ms);
}

function calculateCm360(sens, dpi, game) {
  const multipliers = { Valorant: 0.07, CS2: 0.022, "Apex Legends": 0.022, "Overwatch 2": 0.0066 };
  const m_yaw = multipliers[game] || 0.022;
  if (!sens || !dpi || sens <= 0 || dpi <= 0) return 0;

  return ((360 / (dpi * sens * m_yaw)) * 2.54).toFixed(1);
}

function toggleVisibility(element, isVisible) {
  if (!element) return;
  if (!element.classList.contains("fade-element")) {
    element.classList.add("fade-element");
  }
  if (isVisible) {
    element.classList.remove("hidden-fade");
    element.classList.add("visible-fade");
  } else {
    element.classList.remove("visible-fade");
    element.classList.add("hidden-fade");
  }
}

const DEFAULT_ACCENT = "344 99% 47%";

function hslComponentsToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const lit = l / 100;
  const c = (1 - Math.abs(2 * lit - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lit - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hue < 60) {
    r = c;
    g = x;
  } else if (hue < 120) {
    r = x;
    g = c;
  } else if (hue < 180) {
    g = c;
    b = x;
  } else if (hue < 240) {
    g = x;
    b = c;
  } else if (hue < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }
  const toHex = (n) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function normalizeAccent(hsl) {
  if (!hsl) return DEFAULT_ACCENT;
  const trimmed = hsl.trim();
  if (trimmed.startsWith("#")) {
    return normalizeAccent(hexToHslComponents(trimmed));
  }
  const cleaned = trimmed
    .replace(/^hsl[a]?\(/i, "")
    .replace(/\)$/, "")
    .split("/")[0]
    .trim();
  const parts = cleaned.split(/\s+/);
  if (parts.length < 3) return DEFAULT_ACCENT;
  const h = parts[0];
  const s = parts[1].endsWith("%") ? parts[1] : `${parts[1]}%`;
  const lRaw = parts[2].replace(/;$/, "");
  const l = lRaw.endsWith("%") ? lRaw : `${lRaw}%`;
  return `${h} ${s} ${l}`;
}

function hexToHslComponents(hex) {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const l = (max + min) / 2;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

function accentColorString(hsl) {
  const normalized = normalizeAccent(hsl);
  const [h, s, l] = normalized.split(/\s+/);
  return hslComponentsToHex(parseFloat(h), parseFloat(s), parseFloat(l));
}

const DEFAULT_ACCENT_HEX = accentColorString(DEFAULT_ACCENT);

function readAccentColor() {
  const root = document.documentElement;
  const inline = root.style.getPropertyValue("--accent-color").trim();
  if (inline) return inline;
  return getComputedStyle(root).getPropertyValue("--accent-color").trim() || DEFAULT_ACCENT_HEX;
}

function accentColor() {
  return readAccentColor();
}

function accentAlpha(a) {
  const color = readAccentColor();
  const rgb = color.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
  if (rgb) return `rgba(${rgb[1]}, ${rgb[2]}, ${rgb[3]}, ${a})`;
  const parts = normalizeAccent(color).split(/\s+/);
  return `hsla(${parts[0]} ${parts[1]} ${parts[2]} / ${a})`;
}

let appliedAccentKey = DEFAULT_ACCENT;
let accentTransitionCleanup = null;
let accentTransitionFallback = 0;

function clearAccentTransitionCleanup() {
  if (accentTransitionCleanup) {
    document.documentElement.removeEventListener("transitionend", accentTransitionCleanup);
    accentTransitionCleanup = null;
  }
  clearTimeout(accentTransitionFallback);
  accentTransitionFallback = 0;
  document.documentElement.classList.remove("accent-changing");
}

function finalizeAccentTransition(targetHex) {
  const root = document.documentElement;
  clearAccentTransitionCleanup();
  root.classList.add("accent-instant");
  root.style.setProperty("--accent-color", targetHex);
  requestAnimationFrame(() => root.classList.remove("accent-instant"));
}

function enableAccentTransitions() {
  const root = document.documentElement;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      root.classList.remove("accent-instant");
      root.classList.add("accent-ready");
      markAppLoadingReady("accent");
    });
  });
}

const appLoadingState = {
  fonts: false,
  accent: false,
  logo: false,
  entrance: false,
  dismissed: false,
};

function markAppLoadingReady(key) {
  if (appLoadingState[key] !== false) return;
  appLoadingState[key] = true;
  tryDismissAppLoadingScreen();
}

function tryDismissAppLoadingScreen() {
  if (appLoadingState.dismissed) return;
  if (!appLoadingState.fonts || !appLoadingState.accent || !appLoadingState.logo || !appLoadingState.entrance) return;

  const screen = document.getElementById("app-loading-screen");
  if (!screen) {
    document.body.classList.add("app-ready");
    return;
  }

  appLoadingState.dismissed = true;
  document.body.classList.add("app-ready");
  screen.classList.add("is-hiding");
  screen.setAttribute("aria-busy", "false");

  const removeScreen = () => {
    if (screen.isConnected) screen.remove();
  };

  if (document.body.classList.contains("reduce-motion")) {
    removeScreen();
    return;
  }

  screen.addEventListener("transitionend", removeScreen, { once: true });
  setTimeout(removeScreen, 500);
}

function initAppLoadingScreen() {
  const screen = document.getElementById("app-loading-screen");
  if (!screen) {
    document.body.classList.add("app-ready");
    return;
  }

  if (document.documentElement.classList.contains("accent-ready")) {
    markAppLoadingReady("accent");
  }

  if (document.documentElement.classList.contains("logo-mask-ready")) {
    markAppLoadingReady("logo");
  } else {
    const logoObserver = new MutationObserver(() => {
      if (!document.documentElement.classList.contains("logo-mask-ready")) return;
      logoObserver.disconnect();
      markAppLoadingReady("logo");
    });
    logoObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }

  if (document.fonts?.ready) {
    document.fonts.ready.then(() => markAppLoadingReady("fonts")).catch(() => markAppLoadingReady("fonts"));
  } else {
    markAppLoadingReady("fonts");
  }

  window.addEventListener(
    "load",
    () => {
      markAppLoadingReady("fonts");
    },
    { once: true },
  );
}

function initAppSidebar() {
  const sidebar = document.querySelector(".app-sidebar");
  if (!sidebar) return;

  sidebar.addEventListener("click", (event) => {
    const button = event.target.closest(".app-sidebar-item, .app-sidebar-logo, .app-sidebar-more-toggle, .app-sidebar-misc-toggle");
    if (button) requestAnimationFrame(() => button.blur());
  });

  sidebar.addEventListener("mouseleave", (event) => {
    const related = event.relatedTarget;
    if (related instanceof Node && sidebar.contains(related)) return;

    scheduleAppMoreMenuClose();
    scheduleAppMiscMenuClose();

    const active = document.activeElement;
    if (active instanceof HTMLElement && sidebar.contains(active) && active.matches("button")) {
      active.blur();
    }
  });

  sidebar.addEventListener("mouseenter", cancelAppMoreMenuClose);
  sidebar.addEventListener("mouseenter", cancelAppMiscMenuClose);

  initAppMoreMenu();
  initAppMiscMenu();
}

function syncMoreMenuBorder() {
  const sidebar = document.querySelector(".app-sidebar");
  const menu = document.getElementById("sidebar-more-menu");
  const more = document.getElementById("app-sidebar-more");
  if (!sidebar) return;

  const menuActive = more?.classList.contains("is-open") || more?.classList.contains("is-closing");
  if (!menuActive || !menu) {
    sidebar.style.removeProperty("--sidebar-border-cutoff");
    sidebar.style.removeProperty("--sidebar-border-cutoff-end");
    return;
  }

  sidebar.style.removeProperty("--sidebar-border-cutoff-end");

  const sidebarRect = sidebar.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  sidebar.style.setProperty("--sidebar-border-cutoff", `${Math.max(0, menuRect.top - sidebarRect.top)}px`);
}

function syncMiscMenuBorder({ freezeTop = false } = {}) {
  const sidebar = document.querySelector(".app-sidebar");
  const menu = document.getElementById("sidebar-misc-menu");
  const toggle = document.getElementById("sidebar-misc-button");
  const misc = document.getElementById("app-sidebar-misc");
  if (!sidebar) return;

  const menuActive = misc?.classList.contains("is-open") || misc?.classList.contains("is-closing");
  if (!menuActive || !menu) {
    sidebar.style.removeProperty("--misc-menu-top");
    sidebar.style.removeProperty("--sidebar-border-cutoff");
    sidebar.style.removeProperty("--sidebar-border-cutoff-end");
    return;
  }

  const sidebarRect = sidebar.getBoundingClientRect();
  const toggleRect = toggle?.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const topOffset = Math.round(
    toggleRect ? Math.max(0, toggleRect.top - sidebarRect.top) : Math.max(0, menuRect.top - sidebarRect.top),
  );
  const currentTop = sidebar.style.getPropertyValue("--misc-menu-top");

  if (!freezeTop || !currentTop) {
    sidebar.style.setProperty("--misc-menu-top", `${topOffset}px`);
    sidebar.style.setProperty("--sidebar-border-cutoff", `${topOffset}px`);
  }

  const topPx = parseFloat(sidebar.style.getPropertyValue("--misc-menu-top")) || topOffset;
  sidebar.style.setProperty("--sidebar-border-cutoff-end", `${Math.round(topPx + menu.offsetHeight)}px`);
}

function finishAppMoreMenuClose() {
  const more = document.getElementById("app-sidebar-more");
  const menu = document.getElementById("sidebar-more-menu");
  if (!more || !menu || more.classList.contains("is-open")) return;

  more.classList.remove("is-closing");
  menu.hidden = true;
  menu.setAttribute("aria-hidden", "true");
  syncMoreMenuBorder();
}

function setAppMoreMenuOpen(open) {
  const more = document.getElementById("app-sidebar-more");
  const toggle = document.getElementById("sidebar-more-button");
  const menu = document.getElementById("sidebar-more-menu");
  const sidebar = document.querySelector(".app-sidebar");
  if (!more || !toggle || !menu) return;

  clearTimeout(setAppMoreMenuOpen.closeTimer);
  clearTimeout(setAppMoreMenuOpen.closeFallback);

  if (open) {
    more.classList.remove("is-closing");
    setAppMiscMenuOpen(false);
    menu.hidden = false;
    menu.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      more.classList.add("is-open");
      requestAnimationFrame(() => {
        syncMoreMenuBorder();
        requestAnimationFrame(syncMoreMenuBorder);
      });
    });
    return;
  }

  if (!more.classList.contains("is-open")) return;

  toggle.setAttribute("aria-expanded", "false");
  more.classList.remove("is-open");
  more.classList.add("is-closing");

  if (sidebar) {
    sidebar.style.setProperty("--sidebar-border-cutoff", `${sidebar.getBoundingClientRect().height}px`);
  }

  if (document.body.classList.contains("reduce-motion")) {
    finishAppMoreMenuClose();
    return;
  }

  const onTransitionEnd = (event) => {
    if (event.target !== menu || event.propertyName !== "transform") return;
    menu.removeEventListener("transitionend", onTransitionEnd);
    clearTimeout(setAppMoreMenuOpen.closeFallback);
    finishAppMoreMenuClose();
  };

  menu.addEventListener("transitionend", onTransitionEnd);
  setAppMoreMenuOpen.closeFallback = window.setTimeout(() => {
    menu.removeEventListener("transitionend", onTransitionEnd);
    finishAppMoreMenuClose();
  }, 350);
}

setAppMoreMenuOpen.closeTimer = 0;
setAppMoreMenuOpen.closeFallback = 0;

function scheduleAppMoreMenuClose() {
  clearTimeout(setAppMoreMenuOpen.closeTimer);
  setAppMoreMenuOpen.closeTimer = window.setTimeout(() => {
    const more = document.getElementById("app-sidebar-more");
    const menu = document.getElementById("sidebar-more-menu");
    const sidebar = document.querySelector(".app-sidebar");
    if (!more?.classList.contains("is-open")) return;
    if (sidebar?.matches(":hover") || more.matches(":hover") || menu.matches(":hover")) return;
    setAppMoreMenuOpen(false);
  }, 120);
}

function cancelAppMoreMenuClose() {
  clearTimeout(setAppMoreMenuOpen.closeTimer);
}

function initAppMoreMenu() {
  const more = document.getElementById("app-sidebar-more");
  const toggle = document.getElementById("sidebar-more-button");
  const menu = document.getElementById("sidebar-more-menu");
  if (!more || !toggle || !menu) return;

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setAppMoreMenuOpen(!more.classList.contains("is-open"));
  });

  menu.addEventListener("click", (event) => {
    if (event.target.closest(".app-sidebar-more-item")) {
      setAppMoreMenuOpen(false);
    }
  });

  menu.addEventListener("mouseenter", cancelAppMoreMenuClose);

  menu.addEventListener("mouseleave", (event) => {
    const related = event.relatedTarget;
    const sidebar = document.querySelector(".app-sidebar");
    if (related instanceof Node && sidebar?.contains(related)) return;
    scheduleAppMoreMenuClose();
  });

  more.addEventListener("mouseenter", cancelAppMoreMenuClose);

  if (typeof ResizeObserver !== "undefined") {
    const sidebar = document.querySelector(".app-sidebar");
    new ResizeObserver(() => syncMoreMenuBorder()).observe(menu);
    sidebar?.addEventListener("transitionend", (event) => {
      if (event.propertyName === "width") syncMoreMenuBorder();
    });
  }

  window.addEventListener("resize", syncMoreMenuBorder);

  document.addEventListener("click", (event) => {
    if (more.classList.contains("is-open") && !more.contains(event.target)) {
      setAppMoreMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && more.classList.contains("is-open")) {
      setAppMoreMenuOpen(false);
      toggle.focus();
    }
  });
}

function finishAppMiscMenuClose() {
  const misc = document.getElementById("app-sidebar-misc");
  const menu = document.getElementById("sidebar-misc-menu");
  if (!misc || !menu || misc.classList.contains("is-open")) return;

  misc.classList.remove("is-closing");
  menu.hidden = true;
  menu.setAttribute("aria-hidden", "true");
  syncMiscMenuBorder();
}

function setAppMiscMenuOpen(open) {
  const misc = document.getElementById("app-sidebar-misc");
  const toggle = document.getElementById("sidebar-misc-button");
  const menu = document.getElementById("sidebar-misc-menu");
  const sidebar = document.querySelector(".app-sidebar");
  if (!misc || !toggle || !menu) return;

  clearTimeout(setAppMiscMenuOpen.closeTimer);
  clearTimeout(setAppMiscMenuOpen.closeFallback);

  if (open) {
    misc.classList.remove("is-closing");
    setAppMoreMenuOpen(false);
    menu.hidden = false;
    menu.setAttribute("aria-hidden", "false");
    toggle.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      misc.classList.add("is-open");
      requestAnimationFrame(() => {
        syncMiscMenuBorder();
        requestAnimationFrame(syncMiscMenuBorder);
      });
    });
    return;
  }

  if (!misc.classList.contains("is-open")) return;

  toggle.setAttribute("aria-expanded", "false");
  misc.classList.remove("is-open");
  misc.classList.add("is-closing");

  if (sidebar) {
    const sidebarHeight = sidebar.getBoundingClientRect().height;
    sidebar.style.setProperty("--sidebar-border-cutoff", `${sidebarHeight}px`);
    sidebar.style.setProperty("--sidebar-border-cutoff-end", `${sidebarHeight}px`);
  }

  if (document.body.classList.contains("reduce-motion")) {
    finishAppMiscMenuClose();
    return;
  }

  const onTransitionEnd = (event) => {
    if (event.target !== menu || event.propertyName !== "transform") return;
    menu.removeEventListener("transitionend", onTransitionEnd);
    clearTimeout(setAppMiscMenuOpen.closeFallback);
    finishAppMiscMenuClose();
  };

  menu.addEventListener("transitionend", onTransitionEnd);
  setAppMiscMenuOpen.closeFallback = window.setTimeout(() => {
    menu.removeEventListener("transitionend", onTransitionEnd);
    finishAppMiscMenuClose();
  }, 350);
}

setAppMiscMenuOpen.closeTimer = 0;
setAppMiscMenuOpen.closeFallback = 0;

function scheduleAppMiscMenuClose() {
  clearTimeout(setAppMiscMenuOpen.closeTimer);
  setAppMiscMenuOpen.closeTimer = window.setTimeout(() => {
    const misc = document.getElementById("app-sidebar-misc");
    const menu = document.getElementById("sidebar-misc-menu");
    const sidebar = document.querySelector(".app-sidebar");
    if (!misc?.classList.contains("is-open")) return;
    if (sidebar?.matches(":hover") || misc.matches(":hover") || menu?.matches(":hover")) return;
    setAppMiscMenuOpen(false);
  }, 120);
}

function cancelAppMiscMenuClose() {
  clearTimeout(setAppMiscMenuOpen.closeTimer);
}

function initAppMiscMenu() {
  const misc = document.getElementById("app-sidebar-misc");
  const toggle = document.getElementById("sidebar-misc-button");
  const menu = document.getElementById("sidebar-misc-menu");
  if (!misc || !toggle || !menu) return;

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    setAppMiscMenuOpen(!misc.classList.contains("is-open"));
  });

  menu.addEventListener("click", (event) => {
    if (event.target.closest(".app-sidebar-misc-item")) {
      setAppMiscMenuOpen(false);
    }
  });

  menu.addEventListener("mouseenter", cancelAppMiscMenuClose);
  menu.addEventListener("mouseleave", (event) => {
    const related = event.relatedTarget;
    const sidebar = document.querySelector(".app-sidebar");
    if (related instanceof Node && sidebar?.contains(related)) return;
    scheduleAppMiscMenuClose();
  });

  misc.addEventListener("mouseenter", cancelAppMiscMenuClose);

  const sidebar = document.querySelector(".app-sidebar");
  sidebar?.addEventListener("transitionend", (event) => {
    if (event.propertyName === "width") syncMiscMenuBorder({ freezeTop: true });
  });

  window.addEventListener("resize", () => syncMiscMenuBorder());

  document.addEventListener("click", (event) => {
    if (event.target.closest("#sidebar-misc-button")) return;
    if (misc.classList.contains("is-open") && !misc.contains(event.target)) {
      setAppMiscMenuOpen(false);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && misc.classList.contains("is-open")) {
      setAppMiscMenuOpen(false);
      toggle.focus();
    }
  });
}

function finishAppLoadingScreen() {
  const section = [...document.querySelectorAll(".section")].find((el) => el.style.display === "flex");
  if (!section || document.body.classList.contains("reduce-motion")) {
    markAppLoadingReady("entrance");
    return;
  }

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    markAppLoadingReady("entrance");
  };

  section.addEventListener(
    "animationend",
    (event) => {
      if (event.target === section && event.animationName === "scale-animation") settle();
    },
    { once: true },
  );

  setTimeout(settle, 360);
}

function commitAccentColor(normalized, { instant = false } = {}) {
  const root = document.documentElement;
  const targetHex = accentColorString(normalized);

  clearAccentTransitionCleanup();

  if (instant || document.body.classList.contains("reduce-motion")) {
    root.classList.add("accent-instant");
    root.style.setProperty("--accent-color", targetHex);
    requestAnimationFrame(() => root.classList.remove("accent-instant"));
    return;
  }

  accentTransitionCleanup = (event) => {
    if (event.target !== root || event.propertyName !== "--accent-color") return;
    finalizeAccentTransition(targetHex);
  };
  root.addEventListener("transitionend", accentTransitionCleanup);

  accentTransitionFallback = window.setTimeout(() => {
    finalizeAccentTransition(targetHex);
  }, 400);

  root.classList.remove("accent-instant");
  root.classList.add("accent-changing");
  root.style.setProperty("--accent-color", targetHex);
}

const APP_CACHE_VERSION = "morning-roast-v2";

function isConfirmResetEnabled() {
  return localStorage.getItem("prefConfirmReset") !== "false";
}

let appMasterVolume = 1;

function getMasterVolume() {
  return appMasterVolume;
}

function loadMasterVolume() {
  const saved = parseInt(localStorage.getItem("prefMasterVolume") ?? "100", 10);
  appMasterVolume = Math.max(0, Math.min(100, Number.isFinite(saved) ? saved : 100)) / 100;
}

function setMasterVolume(percent) {
  const pct = Math.max(0, Math.min(100, percent));
  appMasterVolume = pct / 100;
  localStorage.setItem("prefMasterVolume", String(pct));
}

function getAppAudioGain(baseGain = 0.05) {
  if (appMasterVolume <= 0) return 0;
  return baseGain * appMasterVolume;
}

let pendingResetAction = null;

function isScrollLockedByOverlay() {
  return document.getElementById("confirm-reset-overlay")?.classList.contains("active") || document.getElementById("theme-settings-overlay")?.classList.contains("active") || document.getElementById("general-settings-overlay")?.classList.contains("active") || document.getElementById("trainer-settings-overlay")?.classList.contains("active") || document.getElementById("reaction-test-overlay")?.classList.contains("active") || document.getElementById("lineup-video-overlay")?.classList.contains("active") || document.getElementById("lineup-badge-info-overlay")?.classList.contains("active");
}

function syncBodyScrollLock() {
  document.body.style.overflow = isScrollLockedByOverlay() ? "hidden" : "";
}

function closeConfirmReset() {
  const overlay = document.getElementById("confirm-reset-overlay");
  if (overlay) overlay.classList.remove("active");
  pendingResetAction = null;
  syncBodyScrollLock();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function confirmBeforeReset(message, action) {
  if (!isConfirmResetEnabled()) {
    action();
    return;
  }
  pendingResetAction = action;
  const overlay = document.getElementById("confirm-reset-overlay");
  const messageEl = document.getElementById("confirm-reset-message");
  if (messageEl) messageEl.textContent = message;
  if (overlay) overlay.classList.add("active");
  syncBodyScrollLock();
}

function initConfirmReset() {
  const overlay = document.getElementById("confirm-reset-overlay");

  document.getElementById("confirm-reset-cancel")?.addEventListener("click", closeConfirmReset);
  document.getElementById("confirm-reset-ok")?.addEventListener("click", () => {
    const action = pendingResetAction;
    closeConfirmReset();
    action?.();
  });
  overlay?.addEventListener("click", (e) => {
    if (e.target === overlay) closeConfirmReset();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay?.classList.contains("active")) {
      e.preventDefault();
      closeConfirmReset();
    }
  });
}

const SETTINGS_MODAL_OVERLAY_IDS = ["trainer-settings-overlay", "theme-settings-overlay", "general-settings-overlay"];

function openTrainerSettingsDropdownAncestors(node, overlay) {
  let current = node;
  while (current && current !== overlay) {
    if (current.classList?.contains("trainer-settings-dropdown")) {
      current.classList.add("is-open");
      current.querySelector(":scope > .app-status-trigger")?.setAttribute("aria-expanded", "true");
    }
    current = current.parentElement;
  }
}

function initTrainerSettingsDropdowns() {
  SETTINGS_MODAL_OVERLAY_IDS.forEach((overlayId) => {
    const overlay = document.getElementById(overlayId);
    if (!overlay) return;

    overlay.querySelectorAll(".trainer-settings-dropdown").forEach((dropdown) => {
      const trigger = dropdown.querySelector(".app-status-trigger");
      if (!trigger || dropdown.dataset.dropdownBound) return;
      dropdown.dataset.dropdownBound = "1";
      trigger.addEventListener("click", () => {
        const open = dropdown.classList.toggle("is-open");
        trigger.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) {
          setTimeout(() => {
            updateAllToggleGliders();
            if (overlayId === "trainer-settings-overlay" && typeof aimTrainer !== "undefined") {
              aimTrainer.updateAllGliders();
              drawTargetSpreadPreview(aimTrainer.targetSpreadLevel, { instant: true });
            }
          }, 320);
        }
      });
    });
  });
}

function resetTrainerSettingsDropdowns(overlayId) {
  const overlays = overlayId ? [document.getElementById(overlayId)].filter(Boolean) : SETTINGS_MODAL_OVERLAY_IDS.map((id) => document.getElementById(id)).filter(Boolean);

  overlays.forEach((overlay) => {
    overlay.querySelectorAll(".trainer-settings-dropdown").forEach((dropdown) => {
      dropdown.classList.remove("is-open");
      dropdown.querySelector(".app-status-trigger")?.setAttribute("aria-expanded", "false");
    });
  });

  initTrainerModeDropdown.close?.();
  initTrainerTimerDropdown.close?.();
  initTrainerAspectDropdown.close?.();
  initBgPatternDropdown.close?.();
}

function initOfflineStatus() {
  const connectionEl = document.getElementById("offline-connection");
  const swEl = document.getElementById("offline-sw");
  const cacheEl = document.getElementById("offline-cache-version");
  const readyEl = document.getElementById("offline-ready");
  if (!connectionEl) return;

  const dropdown = document.querySelector(".app-status-dropdown");
  const trigger = dropdown?.querySelector(".app-status-trigger");
  if (dropdown && trigger) {
    trigger.addEventListener("click", () => {
      const open = dropdown.classList.toggle("is-open");
      trigger.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  if (cacheEl) cacheEl.textContent = APP_CACHE_VERSION;

  const updateConnection = () => {
    const online = navigator.onLine;
    connectionEl.textContent = online ? "Online" : "Offline";
    connectionEl.className = online ? "is-online" : "is-offline";
  };

  updateConnection();
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);

  if (!("serviceWorker" in navigator)) {
    if (swEl) swEl.textContent = "Not supported";
    if (readyEl) readyEl.textContent = "No";
    return;
  }

  navigator.serviceWorker.ready
    .then(async (registration) => {
      if (swEl) {
        swEl.textContent = registration.active ? "Active" : "Waiting";
        if (registration.active) swEl.className = "is-ready";
      }
      try {
        const cache = await caches.open(APP_CACHE_VERSION);
        const keys = await cache.keys();
        const hasCore = keys.some((request) => request.url.includes("index.html"));
        if (readyEl) {
          readyEl.textContent = hasCore ? "Yes" : "Partial";
          if (hasCore) readyEl.className = "is-ready";
        }
      } catch {
        if (readyEl) readyEl.textContent = "No";
      }
    })
    .catch(() => {
      if (swEl) swEl.textContent = "Unavailable";
      if (readyEl) readyEl.textContent = "No";
    });
}

const EDPI_TIER_COLORS = Object.freeze({
  low: "hsl(198, 93%, 60%)",
  average: "hsl(344, 99%, 47%)",
  high: "hsl(43, 96%, 56%)",
});

const TARGET_COLORS = Object.freeze({
  red: { label: "Red", main: "hsl(344 99% 47%)", dark: "hsl(344 99% 25%)", swatch: "hsl(344 99% 47%)" },
  yellow: { label: "Yellow", main: "hsl(48 100% 50%)", dark: "hsl(40 100% 30%)", swatch: "hsl(48 100% 50%)" },
  purple: { label: "Purple", main: "hsl(265 84% 64%)", dark: "hsl(265 70% 38%)", swatch: "hsl(265 84% 64%)" },
});

const TARGET_SIZE_PRESETS = Object.freeze({
  easy: 32,
  medium: 24,
  hard: 18,
});

const HEALTH_BAR_COLORS = Object.freeze({
  green: { label: "Green", swatch: "#8ecc51", color: "#8ecc51" },
  yellow: { label: "Yellow", swatch: "#ccbc51", color: "#ccbc51" },
  red: { label: "Red", swatch: "#cc5151", color: "#cc5151" },
  blue: { label: "Blue", swatch: "#5180cc", color: "#5180cc" },
  purple: { label: "Purple", swatch: "#a351cc", color: "#a351cc" },
});

const HEALTH_BAR_ANIM_RATE = 10;
const HEALTH_BAR_TRAIL_RATE = 3.5;
const STANDBY_GRID_CELL = 30;
const TRAINING_GRID_CELL = 64;

const TARGET_SPREAD_KEY = "aimTargetSpread";
const TARGET_SPREAD_RECOMMENDED = 2;
const TARGET_SPREAD_LEVELS = Object.freeze([
  { id: 0, label: "Tight", scale: 0.5 },
  { id: 1, label: "Close", scale: 0.72 },
  { id: 2, label: "Balanced", scale: 1, recommended: true },
  { id: 3, label: "Wide", scale: 1.35 },
  { id: 4, label: "Far", scale: 1.75 },
]);

function normalizeTargetSpread(level) {
  const n = Number(level);
  if (!Number.isFinite(n)) return TARGET_SPREAD_RECOMMENDED;
  return Math.max(0, Math.min(TARGET_SPREAD_LEVELS.length - 1, Math.round(n)));
}

function getTargetSpreadDef(level) {
  return TARGET_SPREAD_LEVELS[normalizeTargetSpread(level)] || TARGET_SPREAD_LEVELS[TARGET_SPREAD_RECOMMENDED];
}

function getSpreadPreviewZoneSize(cssW, cssH, scale) {
  const maxScale = TARGET_SPREAD_LEVELS[TARGET_SPREAD_LEVELS.length - 1].scale;
  return {
    zoneW: cssW * (0.16 + (scale / maxScale) * 0.74),
    zoneH: cssH * (0.12 + (scale / maxScale) * 0.62),
  };
}

const spreadPreviewAnim = {
  scale: TARGET_SPREAD_LEVELS[TARGET_SPREAD_RECOMMENDED].scale,
  raf: null,
};

function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

function cancelSpreadPreviewAnimation() {
  if (spreadPreviewAnim.raf != null) {
    cancelAnimationFrame(spreadPreviewAnim.raf);
    spreadPreviewAnim.raf = null;
  }
}

function renderTargetSpreadPreviewCanvas(animScale) {
  const canvas = document.getElementById("target-spread-preview");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const cssW = canvas.clientWidth || 240;
  const cssH = canvas.clientHeight || 112;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cx = cssW / 2;
  const cy = cssH / 2;
  const { zoneW, zoneH } = getSpreadPreviewZoneSize(cssW, cssH, animScale);

  ctx.fillStyle = "hsl(0, 0%, 4%)";
  ctx.fillRect(0, 0, cssW, cssH);

  ctx.strokeStyle = "hsla(0, 0%, 100%, 0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, cssW - 1, cssH - 1, 10);
  ctx.stroke();

  ctx.strokeStyle = "hsla(0, 0%, 100%, 0.05)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const gx = (cssW / 4) * i;
    const gy = (cssH / 3) * i;
    ctx.beginPath();
    ctx.moveTo(gx, 6);
    ctx.lineTo(gx, cssH - 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(6, gy);
    ctx.lineTo(cssW - 6, gy);
    ctx.stroke();
  }

  const zx = cx - zoneW / 2;
  const zy = cy - zoneH / 2;
  const zoneGrad = ctx.createLinearGradient(zx, zy, zx + zoneW, zy + zoneH);
  zoneGrad.addColorStop(0, accentAlpha(0.16));
  zoneGrad.addColorStop(1, accentAlpha(0.04));
  ctx.fillStyle = zoneGrad;
  ctx.strokeStyle = accentAlpha(0.65);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.roundRect(zx, zy, zoneW, zoneH, 8);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);

  const dots = [
    [-0.58, -0.32],
    [0.48, -0.22],
    [-0.18, 0.5],
    [0.62, 0.38],
    [-0.68, 0.12],
    [0.08, -0.58],
  ];
  dots.forEach(([nx, ny]) => {
    const dx = cx + nx * zoneW * 0.46;
    const dy = cy + ny * zoneH * 0.46;
    ctx.fillStyle = accentAlpha(0.9);
    ctx.beginPath();
    ctx.arc(dx, dy, 3.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.9)";
    ctx.beginPath();
    ctx.arc(dx, dy, 1.2, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = "hsla(142, 71%, 45%, 0.95)";
  ctx.fillStyle = "hsla(142, 71%, 45%, 0.95)";
  ctx.lineWidth = 1.5;
  const gap = 3;
  const arm = 5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - gap - arm);
  ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap);
  ctx.lineTo(cx, cy + gap + arm);
  ctx.moveTo(cx - gap - arm, cy);
  ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy);
  ctx.lineTo(cx + gap + arm, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "hsla(0, 0%, 100%, 0.38)";
  ctx.font = "600 9px Inter, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("Screen spawn zone", 10, 8);
}

function drawTargetSpreadPreview(level, { instant = false } = {}) {
  const spreadSelector = document.getElementById("target-spread-selector");
  const targetScale = getTargetSpreadDef(level).scale;

  positionToggleGlider(spreadSelector);

  cancelSpreadPreviewAnimation();

  if (instant || !canAnimateHeightResize() || Math.abs(spreadPreviewAnim.scale - targetScale) < 0.001) {
    spreadPreviewAnim.scale = targetScale;
    renderTargetSpreadPreviewCanvas(targetScale);
    return;
  }

  const fromScale = spreadPreviewAnim.scale;
  const start = performance.now();
  const duration = 300;

  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    spreadPreviewAnim.scale = fromScale + (targetScale - fromScale) * easeOutCubic(t);
    renderTargetSpreadPreviewCanvas(spreadPreviewAnim.scale);
    if (t < 1) {
      spreadPreviewAnim.raf = requestAnimationFrame(tick);
    } else {
      spreadPreviewAnim.scale = targetScale;
      spreadPreviewAnim.raf = null;
    }
  };

  spreadPreviewAnim.raf = requestAnimationFrame(tick);
}

const CROSSHAIR_PRESETS = Object.freeze({
  classic: {
    label: "Classic",
    size: 10,
    gap: 4,
    thickness: 2,
    outlineThickness: 2,
    color: "#00ff00",
    dot: true,
    outline: false,
    flash: true,
  },
  valorant: {
    label: "Valorant",
    size: 4,
    gap: 2,
    thickness: 2,
    outlineThickness: 1,
    color: "#00e5ff",
    dot: true,
    outline: true,
    flash: true,
  },
  cs2: {
    label: "CS2",
    size: 3,
    gap: 0,
    thickness: 1,
    outlineThickness: 1,
    color: "#00ff00",
    dot: false,
    outline: true,
    flash: true,
  },
  minimal: {
    label: "Minimal",
    size: 6,
    gap: 3,
    thickness: 1,
    outlineThickness: 1,
    color: "#ffffff",
    dot: false,
    outline: false,
    flash: true,
  },
  bold: {
    label: "Bold",
    size: 12,
    gap: 5,
    thickness: 3,
    outlineThickness: 2,
    color: "#ffea00",
    dot: true,
    outline: true,
    flash: true,
  },
});

function positionToggleGlider(container) {
  if (!container) return;
  const activeBtn = container.querySelector(
    ".toggle-btn.active, .timer-btn.active, .spread-btn.active, .profile-mode-btn.active, .profile-timer-btn.active",
  );
  const glider = container.querySelector(".glider, .toggle-glider");
  if (!activeBtn || !glider || activeBtn.offsetWidth <= 0) return;

  const style = getComputedStyle(container);
  const padTop = parseFloat(style.paddingTop) || 0;
  const padBottom = parseFloat(style.paddingBottom) || 0;

  glider.style.transform = "";
  glider.style.left = `${activeBtn.offsetLeft}px`;
  glider.style.width = `${activeBtn.offsetWidth}px`;
  glider.style.top = `${padTop}px`;
  glider.style.height = `calc(100% - ${padTop + padBottom}px)`;
}

const GLIDER_SELECTOR_CONTAINERS =
  ".trainer-timer-selector, .trainer-toggle-selector, .trainer-spread-selector, .trainer-mode-trigger, .profile-mode-selector, .profile-timer-selector, .crosshair-converter-zoom-selector";

function updateAllToggleGliders() {
  document.querySelectorAll(GLIDER_SELECTOR_CONTAINERS).forEach(positionToggleGlider);
}

const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);

const UI_REFRESH_MODES = new Set(["60", "144", "max"]);

function normalizeUiRefreshMode(stored) {
  if (stored && UI_REFRESH_MODES.has(stored)) return stored;
  if (stored === "true") return "144";
  return "60";
}

const UiFpsCap = (() => {
  let mode = "60";
  let intervalId = null;
  let queue = [];
  let nextId = 1;
  let patched = false;

  function getIntervalMs() {
    if (mode === "max") return 0;
    if (mode === "144") return 1000 / 144;
    return 1000 / 60;
  }

  function flush() {
    if (!queue.length) return;
    const batch = queue.splice(0);
    const ts = performance.now();
    for (const item of batch) {
      if (!item.cancelled) {
        try {
          item.cb(ts);
        } catch (err) {
          console.error(err);
        }
      }
    }
  }

  function patchRaf() {
    if (patched) return;
    patched = true;
    window.requestAnimationFrame = (cb) => {
      const id = nextId++;
      queue.push({ id, cb, cancelled: false });
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      const item = queue.find((entry) => entry.id === id);
      if (item) item.cancelled = true;
    };
  }

  function unpatchRaf() {
    if (!patched) return;
    patched = false;
    window.requestAnimationFrame = nativeRequestAnimationFrame;
    window.cancelAnimationFrame = nativeCancelAnimationFrame;
    queue = [];
  }

  function stopInterval() {
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function applyMode() {
    stopInterval();
    if (mode === "max") {
      unpatchRaf();
      return;
    }
    patchRaf();
    intervalId = setInterval(flush, getIntervalMs());
  }

  return {
    setMode(nextMode) {
      mode = normalizeUiRefreshMode(nextMode);
      applyMode();
    },
  };
})();

function setUiRefreshMode(mode) {
  localStorage.setItem("prefUiRefresh", normalizeUiRefreshMode(mode));
  localStorage.removeItem("prefHighRefresh");
  UiFpsCap.setMode(mode);
}

UiFpsCap.setMode(normalizeUiRefreshMode(localStorage.getItem("prefUiRefresh") || localStorage.getItem("prefHighRefresh")));

const aimTrainer = {
  totalTimeTaken: 0,
  lastHitTime: 0,
  hits: 0,
  totalClicks: 0,
  active: false,
  isCountingDown: false,
  countdownValue: 3,
  showResults: false,
  showShareMenu: false,
  shareScoreCanvas: null,
  shareMenuPanel: { x: 0, y: 0, w: 0, h: 0 },
  shareMenuCancelBtn: { x: 0, y: 0, w: 0, h: 0, radius: 8 },
  shareMenuDownloadBtn: { x: 0, y: 0, w: 0, h: 0, radius: 8 },
  shareMenuCopyBtn: { x: 0, y: 0, w: 0, h: 0, radius: 8 },
  countdownTimer: null,
  targets: [],
  maxTargets: 4,
  startTime: 0,
  timeLeft: 30,
  canvas: null,
  ctx: null,
  animationId: null,
  lastSoundTime: 0,
  lastBeepTime: 0,
  lastBeepSecond: -1,
  timerPulseAlpha: 0,
  audioCtx: null,
  trainerVolume: 1,
  camera: { yaw: 0, pitch: 0 },
  game: "",
  fov: 103,
  mode: "static",
  trackingHpMode: "limited",
  sessionTimerId: "15",
  aspectRatioId: "16:9",
  isMouseDown: false,
  lastFireTime: 0,
  trackingFrames: 0,
  totalTrackingFrames: 0,
  isFlickingToNewTarget: false,
  lastFrameTime: 0,
  restartButton: { w: 180, h: 46, radius: 8 },
  shareButton: { w: 180, h: 46, radius: 8 },
  buttonDisabledUntil: 0,
  mx: 0,
  my: 0,
  standbyCanvasHover: false,
  standbyBubbleFill: 0,
  standbyWaveAnimTime: 0,
  standbyScanSpeed: 55,
  targetColorKey: "red",
  targetDifficulty: "easy",
  targetSpreadLevel: TARGET_SPREAD_RECOMMENDED,
  showTargetHealthBar: false,
  showTargetHealthText: false,
  showHitmarker: false,
  healthBarColorKey: "red",
  get targetColor() {
    return TARGET_COLORS[this.targetColorKey]?.main || TARGET_COLORS.red.main;
  },
  get targetColorDark() {
    return TARGET_COLORS[this.targetColorKey]?.dark || TARGET_COLORS.red.dark;
  },

  getTargetPixelRadius() {
    return TARGET_SIZE_PRESETS[this.targetDifficulty] ?? TARGET_SIZE_PRESETS.medium;
  },

  getFocalLength() {
    const w = this.canvas?.width || 800;
    const fovRad = (this.fov * Math.PI) / 180;
    return w / 2 / Math.tan(fovRad / 2);
  },

  getAspectHorizontalScale() {
    return getTrainerAspectHorizontalScale(this.aspectRatioId);
  },

  getAspectVerticalScale() {
    return getTrainerAspectVerticalScale(this.aspectRatioId);
  },

  getTargetRadius() {
    return this.getTargetPixelRadius() / this.getFocalLength();
  },

  getSpawnBand() {
    const base = getModeSpawnBand(this.mode);
    const scale = getTargetSpreadDef(this.targetSpreadLevel).scale;
    const aspectX = this.getAspectHorizontalScale();
    const aspectY = this.getAspectVerticalScale();
    return {
      yaw: base.yaw * scale * aspectX,
      pitch: base.pitch * scale * aspectY,
    };
  },

  getTargetScreenRadius(angularRadius) {
    const focal = this.getFocalLength();
    const aspectX = this.getAspectHorizontalScale();
    const rx = angularRadius * focal * aspectX;
    const ry = angularRadius * focal;
    return Math.max(rx, ry);
  },

  getSpawnTopMarginPx() {
    const rootPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return rootPx * 2;
  },

  spawnTooCloseToTop(yaw, pitch, radius) {
    if (!this.canvas) return false;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const focal = this.getFocalLength();
    const p = this.project(yaw, pitch, cx, cy, focal);
    const r = this.getTargetScreenRadius(radius);
    return p.y - r < this.getSpawnTopMarginPx();
  },

  targetOverlapsAt(yaw, pitch, radius, gapPx = 16) {
    if (!this.canvas || !this.targets.length) return false;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const focal = this.getFocalLength();
    const p = this.project(yaw, pitch, cx, cy, focal);
    const r = this.getTargetScreenRadius(radius);

    for (const other of this.targets) {
      const op = this.project(other.yaw, other.pitch, cx, cy, focal);
      const or = this.getTargetScreenRadius(other.radius);
      const dx = p.x - op.x;
      const dy = p.y - op.y;
      const minDist = r + or + gapPx;
      if (dx * dx + dy * dy < minDist * minDist) return true;
    }
    return false;
  },

  findOpenSpawnAngles(radius, gapPx = 16) {
    const band = this.getSpawnBand();
    const maxAttempts = 160;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const yaw = (Math.random() - 0.5) * band.yaw * 2;
      const pitch = (Math.random() - 0.5) * band.pitch * 2;
      if (!this.targetOverlapsAt(yaw, pitch, radius, gapPx) && !this.spawnTooCloseToTop(yaw, pitch, radius)) {
        return { yaw, pitch, valid: true };
      }
    }

    const gridSteps = 10;
    for (let gy = 0; gy < gridSteps; gy++) {
      for (let gx = 0; gx < gridSteps; gx++) {
        const yaw = -band.yaw + (gx / Math.max(1, gridSteps - 1)) * band.yaw * 2;
        const pitch = -band.pitch + (gy / Math.max(1, gridSteps - 1)) * band.pitch * 2;
        if (!this.targetOverlapsAt(yaw, pitch, radius, gapPx) && !this.spawnTooCloseToTop(yaw, pitch, radius)) {
          return { yaw, pitch, valid: true };
        }
      }
    }

    if (!this.canvas) return { yaw: 0, pitch: 0, valid: false };

    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const focal = this.getFocalLength();
    let bestYaw = 0;
    let bestPitch = 0;
    let bestGap = -1;

    for (let i = 0; i < 48; i++) {
      const yaw = (Math.random() - 0.5) * band.yaw * 2;
      const pitch = (Math.random() - 0.5) * band.pitch * 2;
      if (this.spawnTooCloseToTop(yaw, pitch, radius)) continue;
      const p = this.project(yaw, pitch, cx, cy, focal);
      const r = this.getTargetScreenRadius(radius);
      let nearestGap = Infinity;

      for (const other of this.targets) {
        const op = this.project(other.yaw, other.pitch, cx, cy, focal);
        const or = this.getTargetScreenRadius(other.radius);
        const dx = p.x - op.x;
        const dy = p.y - op.y;
        const dist = Math.hypot(dx, dy);
        nearestGap = Math.min(nearestGap, dist - (r + or));
      }

      if (nearestGap > bestGap) {
        bestGap = nearestGap;
        bestYaw = yaw;
        bestPitch = pitch;
      }
    }

    return { yaw: bestYaw, pitch: bestPitch, valid: bestGap > 0 };
  },

  strafeTargetsOverlap(i, j, gapPx = 12) {
    if (!this.canvas) return false;
    const a = this.targets[i];
    const b = this.targets[j];
    if (!a || !b) return false;
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const focal = this.getFocalLength();
    const pa = this.project(a.yaw, a.pitch, cx, cy, focal);
    const pb = this.project(b.yaw, b.pitch, cx, cy, focal);
    const ra = this.getTargetScreenRadius(a.radius);
    const rb = this.getTargetScreenRadius(b.radius);
    const dx = pa.x - pb.x;
    const dy = pa.y - pb.y;
    const minDist = ra + rb + gapPx;
    return dx * dx + dy * dy < minDist * minDist;
  },

  crosshair: {
    size: 10,
    gap: 4,
    thickness: 2,
    outlineThickness: 2,
    color: "#00ff00",
    dot: true,
    outline: false,
    flash: true,
  },
  hitMarkerAlpha: 0,
  lastHitTimeFull: 0,
  randomizerEnabled: false,
  targetRandomScale: 1.0,
  finderEnabled: false,
  randomScale: 1.0,
  randomizerTimer: 0,
  finderSessionIndex: 0,
  finderTrialSens: null,
  finderSessionResults: [],
  hitMarkers: [],
  misses: 0,
  underFlicks: 0,
  overFlicks: 0,
  sessionHits: [],
  sessionMisses: [],
  sessionOffsets: [],
  sessionPBs: { hits: false, accuracy: false, reaction: false },
  particles: [],
  missFlashAlpha: 0,
  flickStart: null,
  lastMovementTime: 0,
  recentFlick: null,

  setGame(game) {
    this.game = game;
    const config = trainerConfigs[game] || trainerConfigs.Valorant;
    this.fov = config.fov;
    localStorage.setItem("aimGame", game);
    const gameSearchInput = document.getElementById("trainer-game-search");
    if (gameSearchInput) gameSearchInput.value = game || "";
    syncGameClearButton("trainer-game-search", "trainer-game-clear");
    this.displayResultsOnProfile();
    this.render();
  },

  getAudioCtx() {
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this.audioCtx.state === "suspended") this.audioCtx.resume();
    return this.audioCtx;
  },

  getTrainerAudioGain(baseGain = 0.05) {
    if (this.trainerVolume <= 0 || getMasterVolume() <= 0) return 0;
    return baseGain * getMasterVolume() * this.trainerVolume;
  },

  setupTargetColor() {
    const saved = localStorage.getItem("aimTargetColor");
    if (saved && TARGET_COLORS[saved]) this.targetColorKey = saved;
    const selector = document.getElementById("target-color-selector");
    if (!selector) return;
    const btns = selector.querySelectorAll(".toggle-btn");
    btns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === this.targetColorKey);
      btn.addEventListener("click", () => {
        this.targetColorKey = btn.dataset.value;
        localStorage.setItem("aimTargetColor", this.targetColorKey);
        btns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.updateAllGliders();
      });
    });
  },

  setupTargetDifficulty() {
    const saved = localStorage.getItem("aimTargetDifficulty");
    if (saved && TARGET_SIZE_PRESETS[saved]) this.targetDifficulty = saved;
    const selector = document.getElementById("target-difficulty-selector");
    if (!selector) return;
    const btns = selector.querySelectorAll(".toggle-btn");
    btns.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.value === this.targetDifficulty);
      btn.addEventListener("click", () => {
        this.targetDifficulty = btn.dataset.value;
        localStorage.setItem("aimTargetDifficulty", this.targetDifficulty);
        btns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        this.updateAllGliders();
      });
    });
  },

  setupTargetHealthDisplay() {
    this.showTargetHealthBar = localStorage.getItem("aimTargetHealthBar") === "true";
    this.showTargetHealthText = localStorage.getItem("aimTargetHealthText") === "true";
    const hitmarkerStored = localStorage.getItem("aimHitmarker") ?? localStorage.getItem("aimXOnDeath");
    this.showHitmarker = hitmarkerStored === "true";

    const bindToggle = (selectorId, storageKey, prop) => {
      const selector = document.getElementById(selectorId);
      if (!selector) return;
      const btns = selector.querySelectorAll(".toggle-btn");
      const sync = () => {
        btns.forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.value === String(this[prop]));
        });
        positionToggleGlider(selector);
      };
      sync();
      btns.forEach((btn) => {
        btn.addEventListener("click", () => {
          this[prop] = btn.dataset.value === "true";
          localStorage.setItem(storageKey, String(this[prop]));
          btns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          positionToggleGlider(selector);
        });
      });
    };

    bindToggle("target-healthbar-selector", "aimTargetHealthBar", "showTargetHealthBar");
    bindToggle("target-health-text-selector", "aimTargetHealthText", "showTargetHealthText");
    bindToggle("target-hitmarker-selector", "aimHitmarker", "showHitmarker");

    const savedHealthBarColor = localStorage.getItem("aimHealthBarColor");
    if (savedHealthBarColor && HEALTH_BAR_COLORS[savedHealthBarColor]) {
      this.healthBarColorKey = savedHealthBarColor;
    } else if (savedHealthBarColor === "classic") {
      this.healthBarColorKey = "red";
      localStorage.setItem("aimHealthBarColor", "red");
    }

    const colorSelector = document.getElementById("health-bar-color-selector");
    const previewFill = document.getElementById("health-bar-preview-fill");
    const colorLabel = document.getElementById("health-bar-color-label");
    const colorPrev = document.getElementById("health-bar-color-prev");
    const colorNext = document.getElementById("health-bar-color-next");
    const colorKeys = Object.keys(HEALTH_BAR_COLORS);

    const setHealthBarColor = (key) => {
      if (!key || !HEALTH_BAR_COLORS[key]) return;
      this.healthBarColorKey = key;
      localStorage.setItem("aimHealthBarColor", key);
      syncHealthBarColorUi();
    };

    const syncHealthBarColorUi = () => {
      const preset = HEALTH_BAR_COLORS[this.healthBarColorKey] || HEALTH_BAR_COLORS.red;
      if (previewFill) previewFill.style.background = preset.color;
      if (colorLabel) colorLabel.textContent = preset.label;
      colorSelector?.querySelectorAll(".accent-swatch").forEach((btn) => {
        const active = btn.dataset.healthBarColor === this.healthBarColorKey;
        btn.classList.toggle("active", active);
        btn.setAttribute("aria-checked", String(active));
        btn.tabIndex = active ? 0 : -1;
      });
    };

    const activeHealthBarColorIndex = () => {
      const idx = colorKeys.indexOf(this.healthBarColorKey);
      return idx >= 0 ? idx : 0;
    };

    const selectHealthBarColorAt = (index) => {
      const nextIndex = ((index % colorKeys.length) + colorKeys.length) % colorKeys.length;
      setHealthBarColor(colorKeys[nextIndex]);
    };

    syncHealthBarColorUi();

    colorSelector?.querySelectorAll(".accent-swatch").forEach((btn) => {
      btn.addEventListener("click", () => setHealthBarColor(btn.dataset.healthBarColor));
    });

    colorPrev?.addEventListener("click", () => selectHealthBarColorAt(activeHealthBarColorIndex() - 1));
    colorNext?.addEventListener("click", () => selectHealthBarColorAt(activeHealthBarColorIndex() + 1));
  },

  setupTrackingHpMode() {
    this.trackingHpMode = normalizeTrackingHpMode(localStorage.getItem("aimTrackingHp"));
    const selector = document.getElementById("tracking-hp-selector");
    if (!selector) return;

    const btns = selector.querySelectorAll(".toggle-btn");
    const sync = () => {
      btns.forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.value === this.trackingHpMode);
      });
      positionToggleGlider(selector);
    };

    sync();
    syncTrackingHpSettingVisibility(this.mode);

    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.trackingHpMode = normalizeTrackingHpMode(btn.dataset.value);
        localStorage.setItem("aimTrackingHp", this.trackingHpMode);
        btns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        positionToggleGlider(selector);
      });
    });
  },

  getTrackingTargetMaxHealth() {
    return getTargetMaxHealth(this.mode, this.trackingHpMode);
  },

  isTrackingUnlimitedHp() {
    return isTrainerAccuracyMode(this.mode) && this.trackingHpMode === "unlimited";
  },

  getHealthBarFillStyle() {
    return HEALTH_BAR_COLORS[this.healthBarColorKey]?.color || HEALTH_BAR_COLORS.red.color;
  },

  updateTargetHealthDisplay(dt) {
    for (const t of this.targets) {
      const health = t.health ?? t.maxHealth ?? 0;
      if (t.displayHealth == null) t.displayHealth = health;
      if (t.trailHealth == null) t.trailHealth = health;

      if (health < t.displayHealth) {
        t.displayHealth += (health - t.displayHealth) * Math.min(1, dt * HEALTH_BAR_ANIM_RATE);
        if (t.displayHealth - health < 0.25) t.displayHealth = health;
      } else {
        t.displayHealth = health;
      }

      if (t.trailHealth > t.displayHealth) {
        t.trailHealth += (t.displayHealth - t.trailHealth) * Math.min(1, dt * HEALTH_BAR_TRAIL_RATE);
        if (t.trailHealth - t.displayHealth < 0.25) t.trailHealth = t.displayHealth;
      } else {
        t.trailHealth = t.displayHealth;
      }
    }
  },

  setupTargetSpread() {
    const saved = localStorage.getItem(TARGET_SPREAD_KEY);
    if (saved != null) this.targetSpreadLevel = normalizeTargetSpread(saved);

    const selector = document.getElementById("target-spread-selector");
    const label = document.getElementById("target-spread-label");
    const hint = document.getElementById("target-spread-hint");
    if (!selector) return;

    const btns = selector.querySelectorAll(".spread-btn");
    let spreadPreviewReady = false;

    const syncUi = ({ instantPreview = !spreadPreviewReady } = {}) => {
      const def = getTargetSpreadDef(this.targetSpreadLevel);
      btns.forEach((btn) => {
        btn.classList.toggle("active", Number(btn.dataset.spread) === def.id);
      });
      if (label) label.textContent = def.label;
      if (hint) {
        hint.textContent = def.recommended ? "Recommended" : "";
        hint.hidden = !def.recommended;
      }
      positionToggleGlider(selector);
      drawTargetSpreadPreview(this.targetSpreadLevel, { instant: instantPreview });
      spreadPreviewReady = true;
    };

    syncUi({ instantPreview: true });
    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        this.targetSpreadLevel = normalizeTargetSpread(btn.dataset.spread);
        localStorage.setItem(TARGET_SPREAD_KEY, String(this.targetSpreadLevel));
        syncUi();
      });
    });

    window.addEventListener("resize", () => {
      positionToggleGlider(selector);
      drawTargetSpreadPreview(this.targetSpreadLevel, { instant: true });
    });
  },

  drawCrosshairAt(ctx, cx, cy, crosshair, strokeOverride) {
    const { size, gap, thickness, outlineThickness, color, dot, outline } = crosshair;
    const snapAxis = (value, lineWidth) => (lineWidth % 2 === 0 ? Math.round(value) : Math.round(value - 0.5) + 0.5);
    const x = snapAxis(cx, thickness);
    const y = snapAxis(cy, thickness);

    const drawLines = (strokeStyle, lineWidth) => {
      ctx.strokeStyle = strokeStyle;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = "butt";
      ctx.beginPath();
      ctx.moveTo(x, y - gap);
      ctx.lineTo(x, y - gap - size);
      ctx.moveTo(x, y + gap);
      ctx.lineTo(x, y + gap + size);
      ctx.moveTo(x - gap, y);
      ctx.lineTo(x - gap - size, y);
      ctx.moveTo(x + gap, y);
      ctx.lineTo(x + gap + size, y);
      ctx.stroke();
    };

    if (outline) drawLines("#000000", thickness + outlineThickness * 2);
    drawLines(strokeOverride ?? color, thickness);
    if (dot) {
      const dotSize = Math.max(1, Math.round(thickness));
      const half = Math.floor(dotSize / 2);
      ctx.fillStyle = strokeOverride ?? color;
      ctx.fillRect(Math.round(cx) - half, Math.round(cy) - half, dotSize, dotSize);
    }
  },

  drawCrosshairPreview() {
    const c = document.getElementById("crosshair-preview");
    if (!c) return;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    this.drawCrosshairAt(ctx, c.width / 2, c.height / 2, this.crosshair);
  },

  setupCrosshair() {
    try {
      const saved = JSON.parse(localStorage.getItem("aimCrosshair"));
      if (saved && typeof saved === "object") {
        this.crosshair = { ...this.crosshair, ...saved };
      }
    } catch (e) {}

    const persist = () => localStorage.setItem("aimCrosshair", JSON.stringify(this.crosshair));

    const clearActivePreset = () => {
      document.querySelectorAll(".crosshair-preset-btn.active").forEach((btn) => btn.classList.remove("active"));
    };

    const syncCrosshairUI = () => {
      const colorOptions = document.getElementById("crosshair-color-options");
      const crosshairColorLabel = document.getElementById("crosshair-color-label");
      if (colorOptions) {
        colorOptions.querySelectorAll(".accent-swatch").forEach((btn) => {
          const isActive = btn.dataset.color === this.crosshair.color;
          btn.classList.toggle("active", isActive);
          btn.setAttribute("aria-checked", isActive ? "true" : "false");
          btn.tabIndex = isActive ? 0 : -1;
        });
        const activeBtn = colorOptions.querySelector(".accent-swatch.active");
        if (crosshairColorLabel && activeBtn) {
          crosshairColorLabel.textContent = activeBtn.getAttribute("aria-label") || "";
        }
      }

      const sliders = [
        { id: "ch-size", prop: "size", valId: "ch-size-val" },
        { id: "ch-gap", prop: "gap", valId: "ch-gap-val" },
        { id: "ch-thickness", prop: "thickness", valId: "ch-thickness-val" },
        { id: "ch-outline-thickness", prop: "outlineThickness", valId: "ch-outline-thickness-val" },
      ];
      sliders.forEach(({ id, prop, valId }) => {
        const input = document.getElementById(id);
        const valEl = document.getElementById(valId);
        if (!input) return;
        input.value = this.crosshair[prop];
        if (valEl) valEl.innerText = this.crosshair[prop];
      });

      const syncChToggle = (id, prop) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const activeVal = String(this.crosshair[prop]);
        sel.querySelectorAll(".toggle-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.value === activeVal);
        });
        positionToggleGlider(sel);
      };
      syncChToggle("ch-dot-selector", "dot");
      syncChToggle("ch-outline-selector", "outline");
      syncChToggle("ch-flash-selector", "flash");

      this.drawCrosshairPreview();
    };

    const applyCrosshairPreset = (presetKey) => {
      const preset = CROSSHAIR_PRESETS[presetKey];
      if (!preset) return;
      this.crosshair = { ...this.crosshair, ...preset };
      delete this.crosshair.label;
      persist();
      syncCrosshairUI();
      document.querySelectorAll(".crosshair-preset-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.preset === presetKey);
      });
    };

    const colorOptions = document.getElementById("crosshair-color-options");
    const crosshairColorPicker = document.getElementById("crosshair-color-picker");
    const crosshairColorPrev = document.getElementById("crosshair-color-prev");
    const crosshairColorNext = document.getElementById("crosshair-color-next");

    const getCrosshairColorSwatches = () => (colorOptions ? [...colorOptions.querySelectorAll(".accent-swatch")] : []);

    const selectCrosshairColor = (btn) => {
      if (!btn) return;
      this.crosshair.color = btn.dataset.color;
      clearActivePreset();
      persist();
      syncCrosshairUI();
    };

    const activeCrosshairColorIndex = () => {
      const swatches = getCrosshairColorSwatches();
      const idx = swatches.findIndex((btn) => btn.dataset.color === this.crosshair.color);
      return idx >= 0 ? idx : 0;
    };

    const selectCrosshairColorAt = (index) => {
      const swatches = getCrosshairColorSwatches();
      if (!swatches.length) return;
      const nextIndex = ((index % swatches.length) + swatches.length) % swatches.length;
      selectCrosshairColor(swatches[nextIndex]);
    };

    if (colorOptions) {
      getCrosshairColorSwatches().forEach((btn) => {
        btn.addEventListener("click", () => selectCrosshairColor(btn));
      });
    }

    crosshairColorPrev?.addEventListener("click", () => selectCrosshairColorAt(activeCrosshairColorIndex() - 1));
    crosshairColorNext?.addEventListener("click", () => selectCrosshairColorAt(activeCrosshairColorIndex() + 1));

    crosshairColorPicker?.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        selectCrosshairColorAt(activeCrosshairColorIndex() - 1);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        selectCrosshairColorAt(activeCrosshairColorIndex() + 1);
      }
    });

    const sliders = [
      { id: "ch-size", prop: "size", valId: "ch-size-val" },
      { id: "ch-gap", prop: "gap", valId: "ch-gap-val" },
      { id: "ch-thickness", prop: "thickness", valId: "ch-thickness-val" },
      { id: "ch-outline-thickness", prop: "outlineThickness", valId: "ch-outline-thickness-val" },
    ];
    sliders.forEach(({ id, prop, valId }) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener("input", () => {
        this.crosshair[prop] = parseInt(input.value);
        const valEl = document.getElementById(valId);
        if (valEl) valEl.innerText = input.value;
        clearActivePreset();
        persist();
        this.drawCrosshairPreview();
      });
    });

    const wireChToggle = (id, prop) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const btns = sel.querySelectorAll(".toggle-btn");
      btns.forEach((btn) => {
        btn.addEventListener("click", () => {
          this.crosshair[prop] = btn.dataset.value === "true";
          clearActivePreset();
          persist();
          syncCrosshairUI();
        });
      });
    };
    wireChToggle("ch-dot-selector", "dot");
    wireChToggle("ch-outline-selector", "outline");
    wireChToggle("ch-flash-selector", "flash");

    const presetContainer = document.getElementById("crosshair-presets");
    if (presetContainer) {
      presetContainer.querySelectorAll(".crosshair-preset-btn").forEach((btn) => {
        const presetKey = btn.dataset.preset;
        const preset = CROSSHAIR_PRESETS[presetKey];
        const miniCanvas = btn.querySelector(".crosshair-preset-canvas");
        if (miniCanvas && preset) {
          const ctx = miniCanvas.getContext("2d");
          ctx.clearRect(0, 0, miniCanvas.width, miniCanvas.height);
          this.drawCrosshairAt(ctx, miniCanvas.width / 2, miniCanvas.height / 2, preset);
        }
        btn.addEventListener("click", () => applyCrosshairPreset(presetKey));
      });
    }

    syncCrosshairUI();
    const presetKeys = ["size", "gap", "thickness", "outlineThickness", "color", "dot", "outline", "flash"];
    for (const [key, preset] of Object.entries(CROSSHAIR_PRESETS)) {
      if (presetKeys.every((prop) => this.crosshair[prop] === preset[prop])) {
        document.querySelectorAll(".crosshair-preset-btn").forEach((btn) => {
          btn.classList.toggle("active", btn.dataset.preset === key);
        });
        break;
      }
    }

    this.applyCrosshair = (overrides) => {
      if (!overrides || typeof overrides !== "object") return;
      this.crosshair = { ...this.crosshair, ...overrides };
      persist();
      clearActivePreset();
      syncCrosshairUI();
    };
  },

  syncSensInputFinderLock() {
    const input = elements["canvas-sens"];
    const container = input?.closest(".input-container-inner");
    if (!input || !container) return;
    input.disabled = this.finderEnabled;
    container.classList.toggle("sens-finder-locked", this.finderEnabled);
  },

  applySessionTimer(timerId) {
    const value = normalizeTrainerTimer(timerId);
    this.sessionTimerId = value;
    localStorage.setItem("aimTimer", value);
    syncTrainerTimerDropdownUi(value);
    this.syncTrainerTimerFinderLock();
  },

  applyAspectRatio(ratioId) {
    const value = normalizeTrainerAspectRatio(ratioId);
    this.aspectRatioId = value;
    applyTrainerAspectRatio(value);
  },

  getSessionTimerId() {
    const dropdown = document.getElementById("trainer-timer-dropdown");
    const uiValue = dropdown?.dataset?.value;
    if (uiValue) {
      this.sessionTimerId = normalizeTrainerTimer(uiValue);
    }
    return normalizeTrainerTimer(this.sessionTimerId);
  },

  getSessionElapsedSeconds() {
    if (!this.active) return 0;
    return Math.max(0, Math.floor((performance.now() - this.startTime) / 1000));
  },

  syncTrainerTimerFinderLock() {
    const list = document.getElementById("trainer-timer-list");
    if (!list) return;
    const locked = this.finderEnabled;
    list.querySelectorAll("[data-trainer-timer]").forEach((opt) => {
      const id = opt.getAttribute("data-trainer-timer");
      const disabled = locked && id !== "15";
      opt.disabled = disabled;
      opt.setAttribute("aria-disabled", disabled ? "true" : "false");
      opt.style.opacity = disabled ? "0.4" : "";
      opt.style.pointerEvents = disabled ? "none" : "";
    });
    if (locked && this.sessionTimerId !== "15") {
      this.sessionTimerId = "15";
      localStorage.setItem("aimTimer", "15");
      syncTrainerTimerDropdownUi("15");
    }
  },

  getTrainerMissingFields() {
    const missing = [];
    const game = (document.getElementById("trainer-game-search")?.value?.trim() || this.game || "").trim();
    if (!game) missing.push("game");

    const dpiRaw = elements["canvas-dpi"]?.value?.trim() || "";
    const dpi = parseFloat(dpiRaw.replace(",", "."));
    if (!dpiRaw || Number.isNaN(dpi) || dpi <= 0) missing.push("DPI");

    if (!this.finderEnabled) {
      const sensRaw = elements["canvas-sens"]?.value?.trim() || "";
      const sens = parseFloat(sensRaw.replace(",", "."));
      if (!sensRaw || Number.isNaN(sens) || sens <= 0) missing.push("sensitivity");
    }

    return missing;
  },

  isTrainerReadyToPlay() {
    return this.getTrainerMissingFields().length === 0;
  },

  showTrainerMissingToast() {
    const missing = this.getTrainerMissingFields();
    if (missing.length === 0) return;

    const label = missing.length === 1 ? missing[0] : missing.length === 2 ? `${missing[0]} and ${missing[1]}` : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
    const verb = missing.length === 1 ? "needs" : "need";
    const capitalized = label.charAt(0).toUpperCase() + label.slice(1);
    window.Toast?.notify({
      message: `${capitalized} ${verb} input before playing`,
      type: "error",
    });
  },

  init() {
    this.canvas = document.getElementById("aimCanvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    this.canvas.style.cursor = "default";

    const sensInput = document.getElementById("canvas-sens");
    const dpiInput = document.getElementById("canvas-dpi");
    const gameSearchInput = document.getElementById("trainer-game-search");

    if (localStorage.getItem("aimSens")) {
      if (sensInput) sensInput.value = localStorage.getItem("aimSens");
    }
    if (localStorage.getItem("aimDpi")) {
      if (dpiInput) dpiInput.value = localStorage.getItem("aimDpi");
    }
    if (localStorage.getItem("aimGame")) {
      const savedGame = localStorage.getItem("aimGame");
      this.game = savedGame;
      if (gameSearchInput) gameSearchInput.value = savedGame;
      const config = trainerConfigs[savedGame] || trainerConfigs.Valorant;
      this.fov = config.fov;
    }
    syncGameClearButton("trainer-game-search", "trainer-game-clear");

    const savedTimer = normalizeTrainerTimer(localStorage.getItem("aimTimer") || "15");
    this.sessionTimerId = savedTimer;

    const savedAspect = normalizeTrainerAspectRatio(localStorage.getItem("aimAspectRatio") || "16:9");
    this.aspectRatioId = savedAspect;
    applyTrainerAspectRatio(savedAspect);

    const savedMode = normalizeTrainerMode(localStorage.getItem("aimMode") || "static");
    this.mode = savedMode;
    syncTrainerModeDropdownUi(savedMode);

    const setupToggle = (selectorId, propertyName) => {
      const selector = document.getElementById(selectorId);
      if (!selector) return;
      const btns = selector.querySelectorAll(".toggle-btn");
      btns.forEach((btn) => {
        btn.addEventListener("click", () => {
          const isEnabled = btn.dataset.value === "true";
          this[propertyName] = isEnabled;

          btns.forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");

          if (isEnabled) {
            const otherSelectorId = selectorId === "finder-selector" ? "randomizer-selector" : "finder-selector";
            const otherProp = selectorId === "finder-selector" ? "randomizerEnabled" : "finderEnabled";
            this[otherProp] = false;

            const otherSelector = document.getElementById(otherSelectorId);
            if (otherSelector) {
              otherSelector.querySelectorAll(".toggle-btn").forEach((b) => {
                b.classList.toggle("active", b.dataset.value === "false");
              });
            }

            if (propertyName === "finderEnabled") {
              if (this.finderSessionIndex >= 10) {
                this.finderSessionIndex = 0;
                this.finderSessionResults = [];
                this.finderTrialSens = null;
              }

              if (this.finderTrialSens) {
                if (elements["canvas-sens"]) {
                  elements["canvas-sens"].value = this.finderTrialSens;
                  localStorage.setItem("aimSens", this.finderTrialSens);
                }
              } else {
                this.randomizeSessionSensitivity();
              }

              this.syncTrainerTimerFinderLock();
            }
          }

          this.syncSensInputFinderLock();
          if (elements["finder-reset-btn"]) elements["finder-reset-btn"].disabled = !this.finderEnabled;

          if (propertyName === "finderEnabled" && !isEnabled) {
            this.syncTrainerTimerFinderLock();
          }

          if (!this.randomizerEnabled) this.randomScale = 1.0;
          this.updateAllGliders();
        });
      });
    };

    initTrainerModeDropdown(savedMode);
    initTrainerTimerDropdown(savedTimer);
    initTrainerAspectDropdown(savedAspect);
    this.syncTrainerTimerFinderLock();
    setupToggle("finder-selector", "finderEnabled");
    setupToggle("randomizer-selector", "randomizerEnabled");
    this.syncSensInputFinderLock();
    this.setupTargetColor();
    this.setupTargetDifficulty();
    this.setupTargetHealthDisplay();
    this.setupTrackingHpMode();
    this.setupTargetSpread();
    this.setupCrosshair();

    const openSettingsBtn = document.getElementById("open-trainer-settings");
    const closeSettingsBtn = document.getElementById("close-trainer-settings");
    const settingsOverlay = document.getElementById("trainer-settings-overlay");

    if (openSettingsBtn && settingsOverlay) {
      openSettingsBtn.addEventListener("click", () => {
        settingsOverlay.classList.add("active");
        syncBodyScrollLock();

        setTimeout(() => {
          this.updateAllGliders();
          drawTargetSpreadPreview(this.targetSpreadLevel, { instant: true });
        }, 50);
      });
    }
    if (closeSettingsBtn && settingsOverlay) {
      closeSettingsBtn.addEventListener("click", () => {
        settingsOverlay.classList.remove("active");
        initTrainerModeDropdown.close?.();
        initTrainerTimerDropdown.close?.();
        resetSettingsModalSearch("trainer-settings-overlay");
        resetTrainerSettingsDropdowns("trainer-settings-overlay");
        syncBodyScrollLock();
      });
    }
    settingsOverlay?.addEventListener("click", (e) => {
      if (e.target === settingsOverlay) {
        settingsOverlay.classList.remove("active");
        initTrainerModeDropdown.close?.();
        initTrainerTimerDropdown.close?.();
        resetSettingsModalSearch("trainer-settings-overlay");
        syncBodyScrollLock();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && settingsOverlay?.classList.contains("active")) {
        e.preventDefault();
        settingsOverlay.classList.remove("active");
        initTrainerModeDropdown.close?.();
        initTrainerTimerDropdown.close?.();
        resetSettingsModalSearch("trainer-settings-overlay");
        syncBodyScrollLock();
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      }
    });

    sensInput.addEventListener("input", () => {
      if (sensInput) localStorage.setItem("aimSens", sensInput.value);
    });

    const finderResetBtn = elements["finder-reset-btn"];
    if (finderResetBtn) {
      finderResetBtn.disabled = !this.finderEnabled;
      finderResetBtn.addEventListener("click", () => {
        confirmBeforeReset("Reset the sensitivity finder progress?", () => this.resetFinder());
      });
    }

    dpiInput.addEventListener("input", () => {
      if (dpiInput) localStorage.setItem("aimDpi", dpiInput.value);
    });

    const requestLock = () => {
      if (document.pointerLockElement !== this.canvas) {
        try {
          const promise = this.canvas.requestPointerLock({
            unadjustedMovement: true,
          });
          if (promise && promise.catch) {
            promise.catch(() => this.canvas.requestPointerLock());
          }
        } catch (e) {
          this.canvas.requestPointerLock();
        }
      }
    };

    this.canvas.addEventListener("mousedown", (e) => {
      if (!this.isTrainerReadyToPlay()) {
        this.showTrainerMissingToast();
        return;
      }

      const rect = this.canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      const my = (e.clientY - rect.top) * (this.canvas.height / rect.height);

      if (this.isStandbyScreen() && !this.showResults && !this.isPointInStandbyBubble(mx, my)) {
        return;
      }

      if (!document.fullscreenElement) {
        this.canvas.parentElement.requestFullscreen().catch((err) => console.log(err));
        return;
      }
      this.isMouseDown = true;
      if (!this.active && !this.showResults && !this.isCountingDown) {
        requestLock();
      } else if (this.active) {
        if (!this.showResults && !this.isCountingDown) {
          this.tryFireAtRate(true);
        }
      } else if (this.showResults) {
        const rect = this.canvas.getBoundingClientRect();
        const mx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
        const my = (e.clientY - rect.top) * (this.canvas.height / rect.height);

        if (this.showShareMenu) {
          const action = this.getShareMenuAction(mx, my);
          if (action === "cancel" || action === "backdrop") this.closeShareMenu();
          else if (action === "download") this.downloadShareScore();
          else if (action === "copy") this.copyShareScore();
          return;
        }

        const b = this.restartButton;
        const sb = this.shareButton;
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          if (Date.now() < this.buttonDisabledUntil) return;
          requestLock();
        } else if (mx >= sb.x && mx <= sb.x + sb.w && my >= sb.y && my <= sb.y + sb.h) {
          if (Date.now() < this.buttonDisabledUntil) return;
          this.shareScore();
        }
      }
    });

    this.canvas.addEventListener("mousemove", (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mx = (e.clientX - rect.left) * (this.canvas.width / rect.width);
      this.my = (e.clientY - rect.top) * (this.canvas.height / rect.height);

      if (this.isStandbyScreen() && !this.showResults) {
        this.standbyCanvasHover = this.isPointInStandbyBubble(this.mx, this.my);
        this.canvas.style.cursor = this.standbyCanvasHover ? "pointer" : "default";
        return;
      }

      if (this.showResults && !document.pointerLockElement) {
        if (this.showShareMenu) {
          const action = this.getShareMenuAction(this.mx, this.my);
          this.canvas.style.cursor = action === "cancel" || action === "download" || action === "copy" ? "pointer" : "default";
          return;
        }

        const b = this.restartButton;
        const sb = this.shareButton;
        const isDisabled = Date.now() < this.buttonDisabledUntil;

        const isRestart = this.mx >= b.x && this.mx <= b.x + b.w && this.my >= b.y && this.my <= b.y + b.h;
        const isShare = this.mx >= sb.x && this.mx <= sb.x + sb.w && this.my >= sb.y && this.my <= sb.y + sb.h;
        this.canvas.style.cursor = !isDisabled && (isRestart || isShare) ? "pointer" : "default";
      }
    });

    this.canvas.addEventListener("mouseleave", () => {
      this.standbyCanvasHover = false;
      if (this.isStandbyScreen() && !this.showResults) {
        this.canvas.style.cursor = "default";
      }
    });

    window.addEventListener("mouseup", () => {
      this.isMouseDown = false;
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.showShareMenu) return;
      const tag = (e.target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
      e.preventDefault();
      this.closeShareMenu();
    });

    document.addEventListener("fullscreenchange", () => {
      const modeContainer = document.getElementById("trainer-controls");

      if (document.fullscreenElement) {
        if (modeContainer) modeContainer.style.display = "none";
      } else {
        if (modeContainer) modeContainer.style.display = "flex";

        if (this.countdownTimer) {
          clearTimeout(this.countdownTimer);
          this.countdownTimer = null;
        }

        this.active = false;
        this.showResults = false;
        this.showShareMenu = false;
        this.shareScoreCanvas = null;
        this.isCountingDown = false;
      }
      this.handleResize();
    });

    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === this.canvas) {
        if (!this.isTrainerReadyToPlay()) {
          document.exitPointerLock();
          this.showTrainerMissingToast();
          return;
        }
        if (this.showResults && Date.now() < this.buttonDisabledUntil) {
          document.exitPointerLock();
          return;
        }
        this.showResults = false;
        if (!this.active && !this.isCountingDown) this.startCountdown();
      } else {
        if (this.countdownTimer) {
          clearTimeout(this.countdownTimer);
          this.countdownTimer = null;
        }
        this.isCountingDown = false;

        if (this.active) this.endGame();
      }
    });

    document.addEventListener("mousemove", (e) => {
      if (document.pointerLockElement === this.canvas) {
        this.handleCamera(e);
      }
    });

    window.addEventListener("resize", () => this.handleResize());
    this.handleResize();
    window.addEventListener("resize", () => this.updateAllGliders());
    setTimeout(() => this.updateAllGliders(), 100);
    this.observeGliders();

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stopLoop();
      else this.resumeLoop();
    });
    document.addEventListener("fullscreenchange", () => {
      if (this.shouldRunLoop()) this.resumeLoop();
      else this.stopLoop();
    });

    if (this.shouldRunLoop()) this.resumeLoop();
    else this.render();
  },

  restartSession() {
    if (!this.canvas || !document.fullscreenElement) return false;
    if (!this.active && !this.isCountingDown) return false;
    if (!this.isTrainerReadyToPlay()) {
      this.showTrainerMissingToast();
      return false;
    }

    if (this.countdownTimer) {
      clearTimeout(this.countdownTimer);
      this.countdownTimer = null;
    }

    this.active = false;
    this.showResults = false;
    this.showShareMenu = false;
    this.shareScoreCanvas = null;
    this.targets = [];
    this.hitMarkers = [];
    this.isMouseDown = false;
    this.resetFlickTracking();
    this.startCountdown();
    return true;
  },

  drawRestartHint() {
    if (!this.ctx || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? this.canvas.width / rect.width : 1;
    const scaleY = rect.height > 0 ? this.canvas.height / rect.height : 1;
    const padX = 25 * scaleX;
    const padY = 25 * scaleY;

    this.ctx.save();
    this.ctx.globalAlpha = 0.25;
    this.ctx.fillStyle = "white";
    this.ctx.font = `600 ${Math.round(13 * scaleY)}px Inter`;
    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "bottom";
    this.ctx.fillText("Press R to restart", padX, this.canvas.height - padY);
    this.ctx.restore();
  },

  positionGlider(container) {
    positionToggleGlider(container);
  },

  updateAllGliders() {
    updateAllToggleGliders();
  },

  observeGliders() {
    if (typeof ResizeObserver === "undefined") return;
    const containers = [...document.querySelectorAll(GLIDER_SELECTOR_CONTAINERS)];
    const ro = new ResizeObserver((entries) => {
      entries.forEach((entry) => positionToggleGlider(entry.target));
    });
    containers.forEach((c) => ro.observe(c));
    this._gliderObserver = ro;
  },

  playHitSound() {
    const peakGain = this.getTrainerAudioGain(0.05);
    if (peakGain <= 0) return;
    try {
      const ctx = this.getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(peakGain, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } catch (e) {
      console.error("Audio failed:", e);
    }
  },

  playBeepSound() {
    const peakGain = this.getTrainerAudioGain(0.05);
    if (peakGain <= 0) return;
    try {
      const ctx = this.getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      gain.gain.setValueAtTime(peakGain, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } catch (e) {}
  },

  handleResize() {
    if (!this.canvas) return;
    const container = this.canvas.parentElement;
    if (!document.fullscreenElement && !container) return;

    const oldW = this.canvas.width;
    const oldH = this.canvas.height;

    if (document.fullscreenElement) {
      this.canvas.width = window.innerWidth;
      this.canvas.height = window.innerHeight;
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
    } else if (container && container.clientWidth > 0 && container.clientHeight > 0) {
      this.canvas.width = container.clientWidth;
      this.canvas.height = container.clientHeight;
      this.canvas.style.width = "";
      this.canvas.style.height = "";
    }

    if (this.particles.length > 0 && oldW > 0 && oldH > 0) {
      const scaleX = this.canvas.width / oldW;
      const scaleY = this.canvas.height / oldH;
      this.particles.forEach((p) => {
        p.x *= scaleX;
        p.y *= scaleY;
      });
    }

    this.render();
  },

  handleCamera(e) {
    const sensInput = elements["canvas-sens"];
    const sens = parseFloat(sensInput?.value?.replace(",", ".")) || 0;

    const config = trainerConfigs[this.game] || trainerConfigs.Valorant;
    const jitter = this.randomizerEnabled ? this.randomScale : 1.0;
    const rawMultiplier = sens * config.constant * (Math.PI / 180) * jitter;

    const deltaYaw = e.movementX * rawMultiplier;
    const deltaPitch = -e.movementY * rawMultiplier;
    this.recordCameraMovement(deltaYaw, deltaPitch);
    this.camera.pitch = Math.max(-Math.PI / 2.5, Math.min(Math.PI / 2.5, this.camera.pitch));
  },

  recordCameraMovement(deltaYaw, deltaPitch) {
    if (!this.active || this.showResults) return;

    const aspectX = this.getAspectHorizontalScale();
    const moveMag = Math.hypot(deltaYaw * aspectX, deltaPitch);
    if (moveMag < 0.000002) return;

    const now = performance.now();
    if (!this.flickStart || now - this.lastMovementTime > FLICK_IDLE_MS) {
      this.flickStart = { yaw: this.camera.yaw, pitch: this.camera.pitch, time: now };
    }

    this.camera.yaw += deltaYaw;
    this.camera.pitch += deltaPitch;
    this.lastMovementTime = now;

    const elapsed = now - this.flickStart.time;
    if (elapsed > FLICK_MAX_DURATION_MS) {
      this.flickStart = { yaw: this.camera.yaw, pitch: this.camera.pitch, time: now };
      return;
    }

    const travelYaw = (this.camera.yaw - this.flickStart.yaw) * aspectX;
    const travelPitch = this.camera.pitch - this.flickStart.pitch;
    const dist = Math.hypot(travelYaw, travelPitch);
    const speed = dist / Math.max(elapsed / 1000, 0.016);

    if (dist >= FLICK_MIN_DIST && speed >= FLICK_MIN_SPEED) {
      this.recentFlick = {
        startYaw: this.flickStart.yaw,
        startPitch: this.flickStart.pitch,
        endYaw: this.camera.yaw,
        endPitch: this.camera.pitch,
        speed,
        time: now,
        dist,
      };
    }
  },

  classifyMissFlick(nearest, missDist) {
    const flick = this.recentFlick;
    const now = performance.now();
    if (!flick || now - flick.time > FLICK_MAX_AGE_MS) return null;
    if (now - this.lastMovementTime > FLICK_SHOT_GAP_MS) return null;
    if (missDist > nearest.radius * FLICK_CLOSE_RADIUS_MULT) return null;
    if (flick.speed < FLICK_MIN_SPEED || flick.dist < FLICK_MIN_DIST) return null;

    const aspectX = this.getAspectHorizontalScale();
    const toTargetYaw = (nearest.yaw - flick.startYaw) * aspectX;
    const toTargetPitch = nearest.pitch - flick.startPitch;
    const flickYaw = (flick.endYaw - flick.startYaw) * aspectX;
    const flickPitch = flick.endPitch - flick.startPitch;

    const targetDist = Math.hypot(toTargetYaw, toTargetPitch);
    const flickDist = Math.hypot(flickYaw, flickPitch);
    if (targetDist < 0.001 || flickDist < 0.001) return null;

    const alignment = (toTargetYaw * flickYaw + toTargetPitch * flickPitch) / (targetDist * flickDist);
    if (alignment < FLICK_ALIGN_MIN) return null;

    const flickUnitYaw = flickYaw / flickDist;
    const flickUnitPitch = flickPitch / flickDist;
    const targetAlong = toTargetYaw * flickUnitYaw + toTargetPitch * flickUnitPitch;
    if (targetAlong < 0.003) return null;

    const overshootRatio = flickDist / targetAlong;
    if (overshootRatio > FLICK_OVERSHOOT_OVER) return { isOver: true };
    if (overshootRatio < FLICK_OVERSHOOT_UNDER) return { isOver: false };
    return null;
  },

  resetFlickTracking() {
    this.flickStart = null;
    this.lastMovementTime = 0;
    this.recentFlick = null;
  },

  startCountdown() {
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    this.isCountingDown = true;
    this.showResults = false;
    this.showShareMenu = false;
    this.shareScoreCanvas = null;
    this.active = false;
    this.countdownValue = 3;

    const tick = () => {
      if (this.countdownValue > 0) {
        this.playBeepSound();
        this.countdownTimer = setTimeout(() => {
          this.countdownValue--;
          tick();
        }, 1000);
      } else {
        this.isCountingDown = false;
        this.start();
        this.countdownTimer = null;
      }
    };
    tick();
  },

  start() {
    this.hits = 0;
    this.totalClicks = 0;
    this.totalTimeTaken = 0;
    this.lastHitTime = performance.now();
    this.lastFrameTime = performance.now();
    this.trackingFrames = 0;
    this.isFlickingToNewTarget = true;
    this.totalTrackingFrames = 0;
    this.damageShots = 0;
    this.lastFireTime = 0;
    this.targets = [];
    this.hitMarkers = [];
    this.sessionHits = [];
    this.sessionMisses = [];
    this.misses = 0;
    this.underFlicks = 0;
    this.overFlicks = 0;
    this.sessionOffsets = [];
    this.camera = { yaw: 0, pitch: 0 };
    this.resetFlickTracking();
    this.sessionTimerId = this.getSessionTimerId();
    this.startTime = performance.now();
    this.active = true;
    this.timeLeft = isInfiniteTrainerTimer(this.sessionTimerId) ? 0 : parseInt(this.sessionTimerId, 10);
    this.lastBeepSecond = -1;
    this.timerPulseAlpha = 0;
    this.randomizerTimer = 0;

    if (this.finderEnabled) {
      if (this.finderTrialSens === null) this.randomizeSessionSensitivity();
      else if (elements["canvas-sens"]) {
        elements["canvas-sens"].value = this.finderTrialSens;
        localStorage.setItem("aimSens", this.finderTrialSens);
      }
    }

    if (this.randomizerEnabled) this.randomizeSensitivity();
    else this.randomScale = 1.0;

    if (isTrainerAccuracyMode(this.mode)) {
      this.spawnTarget();
      this.initTrackingTargetMotion(this.targets[0]);
    } else {
      const count = getModeMaxTargets(this.mode);
      for (let i = 0; i < count; i++) this.spawnTarget();
    }

    this.stopLoop();
    this.resumeLoop();
  },

  randomizeSessionSensitivity() {
    const sensInput = elements["canvas-sens"];
    const dpiInput = elements["canvas-dpi"];
    if (!sensInput || !dpiInput) return;

    const dpi = parseFloat(dpiInput.value) || 800;
    const multiplier = gameMultipliers[this.game] || 1.0;

    const lowBound = 160 * multiplier;
    const highBound = 450 * multiplier;

    const key = `bestAimResults_${this.game.toUpperCase()}_${this.mode}_${this.sessionTimerId}`;
    const bestData = JSON.parse(localStorage.getItem(key));

    let trialSens;

    if (bestData && bestData.sens && Math.random() > 0.25) {
      const bestSens = parseFloat(bestData.sens);

      trialSens = bestSens * (0.88 + Math.random() * 0.24);
    } else {
      const targetEdpi = lowBound + Math.random() * (highBound - lowBound);
      trialSens = targetEdpi / dpi;
    }

    sensInput.value = trialSens.toFixed(3);
    this.finderTrialSens = trialSens.toFixed(3);
    localStorage.setItem("aimSens", trialSens.toFixed(3));
  },

  buildShareScoreCanvas() {
    const sCanvas = document.createElement("canvas");
    sCanvas.width = 1000;
    sCanvas.height = 1000;
    const sCtx = sCanvas.getContext("2d");

    const grad = sCtx.createLinearGradient(0, 0, 0, 1000);
    grad.addColorStop(0, "#0a0c10");
    grad.addColorStop(1, "#050608");
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 1000, 1000);

    sCtx.strokeStyle = accentAlpha(0.15);
    sCtx.lineWidth = 1;
    for (let i = 0; i < 1000; i += 50) {
      sCtx.beginPath();
      sCtx.moveTo(i, 0);
      sCtx.lineTo(i, 1000);
      sCtx.stroke();
      sCtx.beginPath();
      sCtx.moveTo(0, i);
      sCtx.lineTo(1000, i);
      sCtx.stroke();
    }

    sCtx.fillStyle = accentColor();
    sCtx.font = "bold 60px Inter";
    sCtx.textAlign = "center";
    sCtx.fillText("MORNING ROAST", 500, 120);
    sCtx.fillStyle = "white";
    sCtx.font = "24px Inter";
    sCtx.globalAlpha = 0.5;
    sCtx.fillText("AIM TRAINER PERFORMANCE REPORT", 500, 160);
    sCtx.globalAlpha = 1.0;

    const acc = isTrainerAccuracyMode(this.mode) ? (this.totalTrackingFrames === 0 ? 0 : Math.round((this.trackingFrames / this.totalTrackingFrames) * 100)) : this.totalClicks > 0 ? Math.ceil((this.hits / this.totalClicks) * 100) : 0;
    const reaction = this.hits > 0 ? (this.totalTimeTaken / this.hits).toFixed(0) : 0;

    const stats = [
      { label: "HITS", value: this.hits, color: "hsl(30, 35%, 64%)" },
      { label: "ACCURACY", value: acc + "%", color: "hsl(46, 65%, 52%)" },
      { label: "REACTION", value: reaction + "ms", color: "hsl(260, 60%, 70%)" },
    ];

    stats.forEach((s, i) => {
      const x = 200 + i * 300;
      sCtx.fillStyle = "white";
      sCtx.font = "bold 18px Inter";
      sCtx.globalAlpha = 0.4;
      sCtx.fillText(s.label, x, 280);
      sCtx.globalAlpha = 1.0;
      sCtx.fillStyle = s.color;
      sCtx.font = "bold 72px Inter";
      sCtx.fillText(s.value, x, 350);
    });

    sCtx.strokeStyle = "hsla(0, 0%, 100%, 0.1)";
    sCtx.beginPath();
    sCtx.moveTo(100, 420);
    sCtx.lineTo(900, 420);
    sCtx.stroke();

    sCtx.fillStyle = "white";
    sCtx.font = "bold 20px Inter";
    sCtx.fillText(`${this.game.toUpperCase()} • ${this.mode.toUpperCase()} MODE`, 500, 500);

    const mapScale = 2.6;
    const mapY = 780;

    this.drawSpatialMap(sCtx, 317, mapY, this.sessionHits, this.sessionMisses, mapScale);
    this.drawPrecisionMap(sCtx, 795, mapY, this.sessionOffsets, mapScale);

    sCtx.fillStyle = "white";
    sCtx.globalAlpha = 0.3;
    sCtx.font = "bold 16px Inter";
    sCtx.fillText("HTTPS://FUZIVEER.GITHUB.IO/MORNING-ROAST/", 500, 960);

    return sCanvas;
  },

  closeShareMenu() {
    this.showShareMenu = false;
    this.shareScoreCanvas = null;
  },

  shareMenuHit(mx, my, btn) {
    return mx >= btn.x && mx <= btn.x + btn.w && my >= btn.y && my <= btn.y + btn.h;
  },

  getShareMenuAction(mx, my) {
    if (this.shareMenuHit(mx, my, this.shareMenuCancelBtn)) return "cancel";
    if (this.shareMenuHit(mx, my, this.shareMenuDownloadBtn)) return "download";
    if (this.shareMenuHit(mx, my, this.shareMenuCopyBtn)) return "copy";
    const panel = this.shareMenuPanel;
    if (mx >= panel.x && mx <= panel.x + panel.w && my >= panel.y && my <= panel.y + panel.h) return "panel";
    return "backdrop";
  },

  drawShareMenu(cx, cy) {
    const w = this.canvas.width;
    const h = this.canvas.height;

    this.ctx.fillStyle = "hsla(0, 0%, 0%, 0.85)";
    this.ctx.fillRect(0, 0, w, h);

    const panelW = Math.min(w * 0.9, (384 * w) / 1000);
    const panelH = Math.max((170 * panelW) / 384, 140);
    const panelX = cx - panelW / 2;
    const panelY = cy - panelH / 2;
    const pad = (24 * panelW) / 384;
    const radius = (24 * panelW) / 384;

    this.shareMenuPanel = { x: panelX, y: panelY, w: panelW, h: panelH };

    this.ctx.fillStyle = "hsl(0, 0%, 5%)";
    this.ctx.beginPath();
    this.ctx.roundRect(panelX, panelY, panelW, panelH, radius);
    this.ctx.fill();
    this.ctx.strokeStyle = "hsl(0, 0%, 11%)";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();

    this.ctx.textAlign = "left";
    this.ctx.textBaseline = "top";
    this.ctx.fillStyle = "hsl(0, 0%, 100%)";
    const titleSize = Math.max(14, (17 * panelW) / 384);
    const subtitleSize = Math.max(12, (14 * panelW) / 384);
    const subtitleGap = (12 * panelW) / 384;
    const titleY = panelY + pad;
    this.ctx.font = `600 ${titleSize}px Inter`;
    this.ctx.fillText("Share score", panelX + pad, titleY);

    this.ctx.fillStyle = "hsl(0, 0%, 55%)";
    this.ctx.font = `${subtitleSize}px Inter`;
    this.ctx.fillText("Choose how to share your aim trainer score.", panelX + pad, titleY + titleSize + subtitleGap);

    const btnH = Math.max(28, (32 * panelW) / 384);
    const btnPadX = Math.max(10, (14 * panelW) / 384);
    const btnY = panelY + panelH - pad - btnH;
    const btnRadius = Math.max(6, (8 * panelW) / 384);
    const btnFont = `600 ${Math.max(11, (13 * panelW) / 384)}px Inter`;
    const buttons = [
      { ref: "shareMenuCancelBtn", label: "Cancel" },
      { ref: "shareMenuDownloadBtn", label: "Download image" },
      { ref: "shareMenuCopyBtn", label: "Copy image" },
    ];

    this.ctx.font = btnFont;
    const btnWidths = buttons.map(({ label }) => this.ctx.measureText(label).width + btnPadX * 2);
    const rowLeft = panelX + pad;
    const rowWidth = panelW - pad * 2;
    const totalBtnWidth = btnWidths.reduce((sum, width) => sum + width, 0);
    const btnSpacing = buttons.length > 1 ? (rowWidth - totalBtnWidth) / (buttons.length - 1) : 0;
    let x = rowLeft;

    buttons.forEach(({ ref, label }, index) => {
      const btnW = btnWidths[index];
      const btn = this[ref];
      btn.x = x;
      btn.y = btnY;
      btn.w = btnW;
      btn.h = btnH;
      btn.radius = btnRadius;

      const hover = this.shareMenuHit(this.mx, this.my, btn);
      this.ctx.fillStyle = hover ? "hsl(0, 0%, 10%)" : "hsl(0, 0%, 8%)";
      this.ctx.beginPath();
      this.ctx.roundRect(btn.x, btn.y, btn.w, btn.h, btn.radius);
      this.ctx.fill();
      this.ctx.strokeStyle = "hsl(0, 0%, 11%)";
      this.ctx.lineWidth = 2;
      this.ctx.stroke();

      this.ctx.fillStyle = "hsl(0, 0%, 100%)";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(label, btn.x + btn.w / 2, btn.y + btn.h / 2);

      x += btnW + btnSpacing;
    });

    this.ctx.textBaseline = "alphabetic";
  },

  downloadShareScore() {
    if (!this.shareScoreCanvas) return;
    const link = document.createElement("a");
    link.download = `MorningRoast_Score_${this.game}_${Date.now()}.png`;
    link.href = this.shareScoreCanvas.toDataURL("image/png");
    link.click();
    this.closeShareMenu();
  },

  copyShareScore() {
    const canvas = this.shareScoreCanvas;
    if (!canvas) return;

    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      Toast.notify({ message: "Image clipboard is not supported in this browser", type: "error" });
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        Toast.notify({ message: "Could not copy image to clipboard", type: "error" });
        return;
      }

      navigator.clipboard
        .write([new ClipboardItem({ "image/png": blob })])
        .then(() => {
          notifyCopied("Score image copied to clipboard.");
          this.closeShareMenu();
        })
        .catch(() => {
          Toast.notify({ message: "Could not copy image to clipboard", type: "error" });
        });
    }, "image/png");
  },

  shareScore() {
    this.shareScoreCanvas = this.buildShareScoreCanvas();
    this.showShareMenu = true;
  },

  resetFinder() {
    this.finderSessionIndex = 0;
    this.finderSessionResults = [];
    this.finderTrialSens = null;
    if (this.finderEnabled) this.randomizeSessionSensitivity();
    this.render();
  },

  isStandbyScreen() {
    return !document.fullscreenElement || (!this.active && !this.showResults && !this.isCountingDown);
  },

  isAimTabVisible() {
    const tab = document.getElementById("aim-training-tab");
    return !!tab && tab.style.display !== "none";
  },

  shouldRunLoop() {
    if (document.hidden) return false;
    if (document.fullscreenElement === this.canvas || document.fullscreenElement?.contains?.(this.canvas)) return true;
    return this.isAimTabVisible();
  },

  stopLoop() {
    if (this.animationId) {
      nativeCancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  },

  resumeLoop() {
    if (this.animationId || !this.shouldRunLoop()) return;
    this.lastFrameTime = performance.now();
    this.loop();
  },

  getRoundedRectPerimeterPoint(cx, cy, hw, hh, r, t) {
    r = Math.min(r, hw, hh);
    const topLen = Math.max(0, hw * 2 - 2 * r);
    const sideLen = Math.max(0, hh * 2 - 2 * r);
    const arcLen = (Math.PI / 2) * r;
    const perimeter = 2 * topLen + 2 * sideLen + 4 * arcLen;
    let d = (((t % 1) + 1) % 1) * perimeter;

    const left = cx - hw;
    const right = cx + hw;
    const top = cy - hh;
    const bottom = cy + hh;

    if (d <= topLen) return { x: left + r + d, y: top, nx: 0, ny: -1 };
    d -= topLen;

    if (d <= arcLen) {
      const a = -Math.PI / 2 + (d / arcLen) * (Math.PI / 2);
      const ax = right - r;
      const ay = top + r;
      return { x: ax + Math.cos(a) * r, y: ay + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
    }
    d -= arcLen;

    if (d <= sideLen) return { x: right, y: top + r + d, nx: 1, ny: 0 };
    d -= sideLen;

    if (d <= arcLen) {
      const a = (d / arcLen) * (Math.PI / 2);
      const ax = right - r;
      const ay = bottom - r;
      return { x: ax + Math.cos(a) * r, y: ay + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
    }
    d -= arcLen;

    if (d <= topLen) return { x: right - r - d, y: bottom, nx: 0, ny: 1 };
    d -= topLen;

    if (d <= arcLen) {
      const a = Math.PI / 2 + (d / arcLen) * (Math.PI / 2);
      const ax = left + r;
      const ay = bottom - r;
      return { x: ax + Math.cos(a) * r, y: ay + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
    }
    d -= arcLen;

    if (d <= sideLen) return { x: left, y: bottom - r - d, nx: -1, ny: 0 };
    d -= sideLen;

    const a = Math.PI + (d / arcLen) * (Math.PI / 2);
    const ax = left + r;
    const ay = top + r;
    return { x: ax + Math.cos(a) * r, y: ay + Math.sin(a) * r, nx: Math.cos(a), ny: Math.sin(a) };
  },

  traceStandbyWavyBubble(cx, cy, hw, hh, cornerR, animTime) {
    const reduceMotion = document.body.classList.contains("reduce-motion");
    const lobes = 11;
    const waveAmp = reduceMotion ? 4 : 4.5 + Math.sin(animTime * 2.1) * 1.5;
    const phase = reduceMotion ? 0 : animTime * 3.4;
    const steps = 96;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const pt = this.getRoundedRectPerimeterPoint(cx, cy, hw, hh, cornerR, t);
      const wave = Math.sin(t * Math.PI * 2 * lobes + phase) * waveAmp;
      const x = pt.x + pt.nx * wave;
      const y = pt.y + pt.ny * wave;
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    }
    this.ctx.closePath();
  },

  getStandbyPromptLayout() {
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const textY = cy + 7;
    const standbyText = document.fullscreenElement ? "CLICK TO START" : "CLICK TO OPEN";
    this.ctx.font = "bold 20px Inter";
    const metrics = this.ctx.measureText(standbyText);
    const textWidth = metrics.width;
    const textAscent = metrics.actualBoundingBoxAscent || 16;
    const textDescent = metrics.actualBoundingBoxDescent || 4;
    const textCenterY = textY - textAscent + (textAscent + textDescent) / 2;
    const glowPadX = 36;
    const glowPadY = 20;
    const bubblePad = 12;
    const hw = (textWidth + glowPadX * 2) / 2 + bubblePad;
    const hh = (textAscent + textDescent + glowPadY * 2) / 2 + bubblePad;

    return { cx, cy, textY, textCenterY, textWidth, textAscent, textDescent, hw, hh, cornerR: 18, standbyText };
  },

  isPointInStandbyBubble(mx, my) {
    if (!this.ctx || !this.canvas) return false;
    const layout = this.getStandbyPromptLayout();

    this.ctx.save();
    this.ctx.beginPath();
    this.traceStandbyWavyBubble(layout.cx, layout.textCenterY, layout.hw, layout.hh, layout.cornerR, this.standbyWaveAnimTime);
    const hit = this.ctx.isPointInPath(mx, my);
    this.ctx.restore();
    return hit;
  },

  drawStandbyPromptBubble({ cx, textY, textCenterY, textWidth, textAscent, textDescent, pulse, time, standbyText }) {
    const ctx = this.ctx;
    const glowPadX = 36;
    const glowPadY = 20;
    const bubblePad = 12;
    const hw = (textWidth + glowPadX * 2) / 2 + bubblePad;
    const hh = (textAscent + textDescent + glowPadY * 2) / 2 + bubblePad;
    const cornerR = 18;
    const fill = this.standbyBubbleFill;
    const waveTime = this.standbyWaveAnimTime;

    ctx.save();

    const glowW = textWidth + glowPadX * 2;
    const glowH = textAscent + textDescent + glowPadY * 2;
    const glowX = cx - glowW / 2;
    const glowY = textCenterY - glowH / 2;
    const bloomRadius = Math.hypot(glowW / 2, glowH / 2);
    const bloom = ctx.createRadialGradient(cx, textCenterY, 0, cx, textCenterY, bloomRadius);
    bloom.addColorStop(0, accentAlpha((0.5 + fill * 0.28) * pulse));
    bloom.addColorStop(0.42, accentAlpha((0.2 + fill * 0.18) * pulse));
    bloom.addColorStop(0.78, accentAlpha(0.05 * pulse));
    bloom.addColorStop(1, "transparent");
    ctx.fillStyle = bloom;
    ctx.beginPath();
    ctx.roundRect(glowX, glowY, glowW, glowH, 14);
    ctx.fill();

    ctx.beginPath();
    this.traceStandbyWavyBubble(cx, textCenterY, hw, hh, cornerR, waveTime);
    if (fill > 0.004) {
      const fillGrad = ctx.createRadialGradient(cx, textCenterY, 0, cx, textCenterY, Math.max(hw, hh) * 1.08);
      fillGrad.addColorStop(0, accentAlpha(0.48 * fill * pulse));
      fillGrad.addColorStop(0.55, accentAlpha(0.22 * fill * pulse));
      fillGrad.addColorStop(1, accentAlpha(0.03 * fill));
      ctx.fillStyle = fillGrad;
      ctx.fill();
    }

    ctx.beginPath();
    this.traceStandbyWavyBubble(cx, textCenterY, hw, hh, cornerR, waveTime);
    ctx.strokeStyle = accentAlpha(0.3 + fill * 0.5);
    ctx.lineWidth = 2;
    ctx.shadowBlur = 8 + fill * 12;
    ctx.shadowColor = accentAlpha(0.4 + fill * 0.35);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.beginPath();
    this.traceStandbyWavyBubble(cx, textCenterY, hw - 4, hh - 4, Math.max(8, cornerR - 4), waveTime + 0.65);
    ctx.strokeStyle = accentAlpha(0.1 + fill * 0.22);
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.shadowBlur = 10;
    ctx.shadowColor = accentAlpha(0.4 + fill * 0.25);
    ctx.fillStyle = "white";
    ctx.globalAlpha = 0.96;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = "bold 20px Inter";
    ctx.fillText(standbyText, cx, textY);
    ctx.shadowBlur = 0;
    ctx.restore();
  },

  createStandbyParticleFromSide(layout = null) {
    const size = Math.random() * 2 + 0.5;
    const alpha = Math.random() * 0.5 + 0.1;
    const margin = 12;
    const w = this.canvas?.width || 800;
    const h = this.canvas?.height || 450;
    const side = Math.floor(Math.random() * 4);
    let x;
    let y;

    if (side === 0) {
      x = Math.random() * w;
      y = margin;
    } else if (side === 1) {
      x = w - margin;
      y = Math.random() * h;
    } else if (side === 2) {
      x = Math.random() * w;
      y = h - margin;
    } else {
      x = margin;
      y = Math.random() * h;
    }

    let vx = (Math.random() - 0.5) * 0.3;
    let vy = (Math.random() - 0.5) * 0.3;
    if (layout) {
      const dx = layout.cx - x;
      const dy = layout.textCenterY - y;
      const dist = Math.hypot(dx, dy) || 1;
      vx += (dx / dist) * 0.06;
      vy += (dy / dist) * 0.06;
    }

    return {
      x,
      y,
      vx,
      vy,
      size,
      baseSize: size,
      alpha,
      baseAlpha: alpha,
      scanGlow: 0,
    };
  },

  createStandbyParticle(layout = null) {
    if (layout) return this.createStandbyParticleFromSide(layout);

    const size = Math.random() * 2 + 0.5;
    const alpha = Math.random() * 0.5 + 0.1;
    const x = this.canvas ? Math.random() * this.canvas.width : 0;
    const y = this.canvas ? Math.random() * this.canvas.height : 0;

    return {
      x,
      y,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      size,
      baseSize: size,
      alpha,
      baseAlpha: alpha,
      scanGlow: 0,
    };
  },

  ensureStandbyParticles() {
    if (!this.canvas || this.particles.length > 0) return;
    for (let i = 0; i < 70; i++) {
      this.particles.push(this.createStandbyParticle());
    }
  },

  getStandbyScanY(time = performance.now() / 1000) {
    if (!this.canvas) return 0;
    return (time * this.standbyScanSpeed) % this.canvas.height;
  },

  updateParticleScanGlow(dt) {
    if (!this.canvas) return;

    const scanY = this.getStandbyScanY();
    const h = this.canvas.height;
    const fadeOutRate = document.body.classList.contains("reduce-motion") ? 3.5 : 1.8;
    const fadeInRate = fadeOutRate * 2;
    const active = this.isStandbyScreen();

    for (const p of this.particles) {
      if (p.scanGlow == null) p.scanGlow = 0;

      if (active) {
        const direct = Math.abs(p.y - scanY);
        const scanDist = Math.min(direct, h - direct);
        const hitRadius = p.size + 10;

        if (scanDist <= hitRadius) {
          p.scanGlow += (1 - p.scanGlow) * Math.min(1, dt * fadeInRate);
        } else if (p.scanGlow > 0) {
          p.scanGlow += (0 - p.scanGlow) * Math.min(1, dt * fadeOutRate);
        }
      } else if (p.scanGlow > 0) {
        p.scanGlow += (0 - p.scanGlow) * Math.min(1, dt * fadeOutRate);
      }
    }
  },

  drawStandbyParticles(fillColor = accentColor(), glowSoft = accentAlpha(0.45), glowStrong = accentAlpha(0.75)) {
    this.ctx.save();
    this.particles.forEach((p) => {
      const glow = p.scanGlow || 0;
      if (glow > 0.04) {
        this.ctx.globalAlpha = p.alpha * glow * 0.42;
        this.ctx.fillStyle = fillColor;
        this.ctx.shadowBlur = 14 + glow * 22;
        this.ctx.shadowColor = glowStrong;
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.size * (1 + glow * 1.15), 0, Math.PI * 2);
        this.ctx.fill();
      }
      this.ctx.globalAlpha = p.alpha * (1 + glow * 0.5);
      this.ctx.fillStyle = fillColor;
      this.ctx.shadowBlur = 5 + glow * 18;
      this.ctx.shadowColor = glow > 0.04 ? glowStrong : glowSoft;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size * (1 + glow * 0.4), 0, Math.PI * 2);
      this.ctx.fill();
    });
    this.ctx.shadowBlur = 0;
    this.ctx.restore();
  },

  updateStandbyParticlePhysics(dt) {
    if (!this.canvas || !this.ctx) return;

    this.ensureStandbyParticles();
    const layout = this.getStandbyPromptLayout();
    const targetX = layout.cx;
    const targetY = layout.textCenterY;
    const bubbleSize = Math.max(layout.hw, layout.hh);
    const pullRadius = bubbleSize * 1.5;
    const absorbDist = 10;
    const bubbleCheckDist = bubbleSize * 1.15;
    const maxCanvasDist = Math.hypot(this.canvas.width / 2, this.canvas.height / 2);
    const reduceMotion = document.body.classList.contains("reduce-motion");
    const dtScale = Math.min(2.5, dt * 60);
    const globalHoverPull = this.standbyCanvasHover;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      if (p.baseSize == null) p.baseSize = p.size;
      if (p.baseAlpha == null) p.baseAlpha = p.alpha;

      p.x += p.vx * dtScale;
      p.y += p.vy * dtScale;

      const dx = targetX - p.x;
      const dy = targetY - p.y;
      const dist = Math.hypot(dx, dy);

      if (dist > 0.001) {
        if (globalHoverPull) {
          const nearness = Math.max(0, 1 - dist / maxCanvasDist);
          const pullStrength = (0.008 + nearness * nearness * 0.18) * (reduceMotion ? 0.35 : 1);
          p.vx += (dx / dist) * pullStrength * dtScale;
          p.vy += (dy / dist) * pullStrength * dtScale;

          const lingerRadius = bubbleSize * 2.4;
          if (dist < lingerRadius) {
            const t = 1 - dist / lingerRadius;
            p.alpha = Math.max(0.2, p.baseAlpha * (1 - t * 0.35));
            p.size = Math.max(0.35, p.baseSize * (1 - t * 0.25));
          } else {
            p.alpha += (p.baseAlpha - p.alpha) * 0.1 * dtScale;
            p.size += (p.baseSize - p.size) * 0.1 * dtScale;
          }

          if (dist < bubbleSize * 0.85) {
            const push = ((bubbleSize * 0.85 - dist) / bubbleSize) * 0.18;
            p.vx -= (dx / dist) * push * dtScale;
            p.vy -= (dy / dist) * push * dtScale;
          }
        } else if (dist < pullRadius) {
          const t = 1 - dist / pullRadius;
          const pullStrength = (0.12 + t * t * 1.35) * (reduceMotion ? 0.35 : 1);
          p.vx += (dx / dist) * pullStrength * dtScale;
          p.vy += (dy / dist) * pullStrength * dtScale;
          p.vx *= 1 - t * 0.035 * dtScale;
          p.vy *= 1 - t * 0.035 * dtScale;
          p.alpha = Math.max(0.04, p.baseAlpha * (1 - t * 0.9));
          p.size = Math.max(0.15, p.baseSize * (1 - t * 0.8));
        }
      }

      if (!globalHoverPull && dist >= pullRadius) {
        if (p.x < 0) p.x = this.canvas.width;
        if (p.x > this.canvas.width) p.x = 0;
        if (p.y < 0) p.y = this.canvas.height;
        if (p.y > this.canvas.height) p.y = 0;
        p.alpha += (p.baseAlpha - p.alpha) * 0.06 * dtScale;
        p.size += (p.baseSize - p.size) * 0.06 * dtScale;
      }

      const speed = Math.hypot(p.vx, p.vy);
      const maxSpeed = globalHoverPull ? 2.4 : 3.6;
      if (speed > maxSpeed) {
        p.vx = (p.vx / speed) * maxSpeed;
        p.vy = (p.vy / speed) * maxSpeed;
      }

      const nearBubble = dist < bubbleCheckDist;
      const absorbed = dist < absorbDist || (nearBubble && this.isPointInStandbyBubble(p.x, p.y));
      if (absorbed) {
        this.particles.splice(i, 1);
        this.particles.push(this.createStandbyParticleFromSide(layout));
      }
    }
  },

  updateResultsParticleDrift() {
    if (!this.canvas) return;

    this.ensureStandbyParticles();
    this.particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = this.canvas.width;
      if (p.x > this.canvas.width) p.x = 0;
      if (p.y < 0) p.y = this.canvas.height;
      if (p.y > this.canvas.height) p.y = 0;
    });
  },

  updateParticles(dt) {
    if (this.isStandbyScreen()) {
      this.updateStandbyParticlePhysics(dt);
    } else if (this.showResults) {
      this.updateResultsParticleDrift();
    }
    if (this.isStandbyScreen() || this.showResults) {
      this.updateParticleScanGlow(dt);
    }
  },

  randomizeSensitivity() {
    this.targetRandomScale = 0.75 + Math.random() * 0.6;
  },

  loop() {
    if (!this.shouldRunLoop()) {
      this.animationId = null;
      return;
    }

    const now = performance.now();
    const dt = (now - this.lastFrameTime) / 1000;
    this.lastFrameTime = now;

    if (this.isStandbyScreen()) {
      const targetFill = this.standbyCanvasHover ? 1 : 0;
      const fillSpeed = document.body.classList.contains("reduce-motion") ? 12 : 3.2;
      this.standbyBubbleFill += (targetFill - this.standbyBubbleFill) * Math.min(1, dt * fillSpeed);
      if (!document.body.classList.contains("reduce-motion")) {
        const waveRate = this.standbyCanvasHover ? 1 : 0.4;
        this.standbyWaveAnimTime += dt * waveRate;
      }
    } else {
      this.standbyBubbleFill = 0;
      this.standbyCanvasHover = false;
      this.standbyWaveAnimTime = 0;
    }

    const showParticles = this.isStandbyScreen() || this.showResults;
    if (showParticles) this.updateParticles(dt);

    if (this.active) {
      const timerId = this.getSessionTimerId();
      if (isInfiniteTrainerTimer(timerId)) {
        this.timeLeft = this.getSessionElapsedSeconds();
      } else {
        const elapsed = (now - this.startTime) / 1000;
        this.timeLeft = Math.max(0, parseInt(timerId, 10) - Math.floor(elapsed));
      }
      if (this.crosshair.flash && this.hitMarkerAlpha > 0) this.hitMarkerAlpha -= dt * 5;
      if (this.missFlashAlpha > 0) this.missFlashAlpha -= dt * 5;
      if (this.timerPulseAlpha > 0) this.timerPulseAlpha -= dt * 5;
      if (!isInfiniteTrainerTimer(timerId) && this.timeLeft > 0 && this.timeLeft <= 3) {
        if (this.lastBeepSecond !== this.timeLeft) {
          this.playBeepSound();
          this.lastBeepSecond = this.timeLeft;
          this.timerPulseAlpha = 1.0;
        }
      }

      for (let i = this.hitMarkers.length - 1; i >= 0; i--) {
        this.hitMarkers[i].alpha -= dt * 2;
        if (this.hitMarkers[i].alpha <= 0) this.hitMarkers.splice(i, 1);
      }
      this.updateGameLogic(dt);
      if (!isInfiniteTrainerTimer(timerId) && this.timeLeft <= 0) {
        this.endGame();
      }
    }
    this.render();
    this.animationId = nativeRequestAnimationFrame(() => this.loop());
  },

  updateGameLogic(dt) {
    this.updateTargetHealthDisplay(dt);
    if (this.randomizerEnabled) {
      this.randomizerTimer += dt;

      if (this.randomizerTimer >= 0.8) {
        this.randomizeSensitivity();
        this.randomizerTimer = 0;
      }

      this.randomScale += (this.targetRandomScale - this.randomScale) * (dt * 2.5);
    }
    if (this.mode === "shrinking") {
      for (let i = this.targets.length - 1; i >= 0; i--) {
        const shrinkStep = this.getTargetRadius() * 0.001125;
        const minRadius = this.getTargetRadius() * 0.125;
        this.targets[i].radius -= shrinkStep;
        if (this.targets[i].radius <= minRadius) {
          this.targets.splice(i, 1);
          this.totalClicks++;
          this.spawnTarget();
        }
      }
    } else if (getTrainerModeDef(this.mode).movement === "strafe") {
      for (let i = 0; i < this.targets.length; i++) {
        const t = this.targets[i];
        if (t.strafeHalfWidth == null) continue;
        t.strafeOffset = (t.strafeOffset || 0) + t.vx * dt * 60;
        if (Math.abs(t.strafeOffset) > t.strafeHalfWidth) {
          t.vx *= -1;
          t.strafeOffset = Math.sign(t.strafeOffset) * t.strafeHalfWidth;
        }
        t.yaw = t.strafeCenterYaw + t.strafeOffset;
      }
      for (let i = 0; i < this.targets.length; i++) {
        for (let j = i + 1; j < this.targets.length; j++) {
          if (this.strafeTargetsOverlap(i, j)) {
            this.targets[i].vx *= -1;
            this.targets[j].vx *= -1;
            this.targets[i].strafeOffset = Math.sign(this.targets[i].strafeOffset || 1) * Math.abs(this.targets[i].strafeOffset || 0);
            this.targets[j].strafeOffset = Math.sign(this.targets[j].strafeOffset || 1) * Math.abs(this.targets[j].strafeOffset || 0);
            this.targets[i].yaw = this.targets[i].strafeCenterYaw + this.targets[i].strafeOffset;
            this.targets[j].yaw = this.targets[j].strafeCenterYaw + this.targets[j].strafeOffset;
          }
        }
      }
    } else if (isTrainerAccuracyMode(this.mode)) {
      this.totalTrackingFrames++;
      const t = this.targets[0];
      if (t) {
        this.updateTrackingTargetMotion(t);

        const dist = this.getAngularDistance(this.camera.yaw, this.camera.pitch, t.yaw, t.pitch);
        if (this.isMouseDown && dist < t.radius) {
          this.trackingFrames++;

          if (this.isFlickingToNewTarget) {
            const now = performance.now();
            this.totalTimeTaken += now - this.lastHitTime;
            this.isFlickingToNewTarget = false;
          }
        }
      }
    }

    this.tryFireAtRate();
  },

  tryFireAtRate(force = false) {
    if (!this.active || this.showResults || this.isCountingDown || !this.isMouseDown) return;
    const now = performance.now();
    if (!force && now - this.lastFireTime < TARGET_FIRE_RATE_MS) return;
    this.fireShot();
  },

  updateTrackingTargetMotion(t) {
    t.phaseX = (t.phaseX || 0) + t.vx;
    t.phaseY = (t.phaseY || 0) + t.vy;
    this.applyTrackingTargetPosition(t);
  },

  applyTrackingTargetPosition(t) {
    const baseRadius = this.getTargetRadius();

    switch (t.trackingPattern) {
      case "hop":
        t.yaw = TRACKING_YAW_AMP * Math.sin(t.phaseX);
        t.pitch = TRACKING_HOP_GROUND_PITCH + TRACKING_HOP_PITCH_AMP * Math.pow(Math.sin(t.phaseY), 2);
        t.radius = baseRadius;
        break;
      case "depth": {
        const dir = Math.sin(t.phaseX);
        t.yaw = TRACKING_YAW_AMP * dir;
        t.pitch = TRACKING_PITCH_AMP * 0.45 * Math.sin(t.phaseY);
        const depthT = (dir + 1) / 2;
        t.radius = baseRadius * (TRACKING_DEPTH_RADIUS_MIN + (TRACKING_DEPTH_RADIUS_MAX - TRACKING_DEPTH_RADIUS_MIN) * depthT);
        break;
      }
      default:
        t.yaw = TRACKING_YAW_AMP * Math.sin(t.phaseX);
        t.pitch = TRACKING_PITCH_AMP * Math.sin(t.phaseY);
        t.radius = baseRadius;
    }
  },

  initTrackingTargetMotion(t, { phaseX, phaseY } = {}) {
    if (!t) return;
    t.trackingPattern = pickTrackingPattern();
    t.vx = TRACKING_PHASE_SPEED_X;
    t.vy = t.trackingPattern === "hop" ? TRACKING_PHASE_SPEED_Y * 1.65 : TRACKING_PHASE_SPEED_Y;

    if (phaseX == null || phaseY == null) {
      t.phaseX = Math.random() * Math.PI * 2;
      t.phaseY = Math.random() * Math.PI * 2;
    } else {
      t.phaseX = phaseX + (Math.random() - 0.5) * Math.PI * 0.5;
      t.phaseY = phaseY + (Math.random() - 0.5) * Math.PI * 0.5;
    }

    this.applyTrackingTargetPosition(t);
    const maxHealth = this.getTrackingTargetMaxHealth();
    t.maxHealth = maxHealth;
    t.health = maxHealth;
    t.displayHealth = maxHealth;
    t.trailHealth = maxHealth;
  },

  drawTargetHealthDisplay(x, y, radius, displayHealth, trailHealth, maxHealth) {
    const unlimited = !Number.isFinite(maxHealth);
    if (!unlimited && (!maxHealth || maxHealth <= 0)) return;
    if (!this.showTargetHealthBar && !this.showTargetHealthText) return;

    const innerW = Math.max(28, radius * 2.4);
    const innerH = 6;
    const padX = 5;
    const padY = 4;
    const outerW = innerW + padX * 2;
    const outerH = innerH + padY * 2;
    const gap = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const textGap = 4;
    const outerX = x - outerW / 2;
    const outerY = y - radius - gap - outerH;
    const innerX = outerX + padX;
    const innerY = outerY + padY;
    const displayPct = unlimited ? 1 : Math.max(0, Math.min(1, displayHealth / maxHealth));
    const trailPct = unlimited ? 1 : Math.max(0, Math.min(1, (trailHealth ?? displayHealth) / maxHealth));
    const healthText = unlimited ? "∞" : `${Math.max(0, Math.ceil(displayHealth))}`;

    const drawPill = (px, py, pw, ph) => {
      const pillRadius = Math.min(ph / 2, pw / 2);
      this.ctx.beginPath();
      this.ctx.roundRect(px, py, pw, ph, pillRadius);
      this.ctx.fill();
    };

    this.ctx.save();

    if (this.showTargetHealthBar) {
      this.ctx.fillStyle = "#3D3F42";
      drawPill(outerX, outerY, outerW, outerH);

      if (trailPct > displayPct) {
        this.ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
        drawPill(innerX, innerY, Math.max(innerH, innerW * trailPct), innerH);
      }

      if (displayPct > 0) {
        this.ctx.fillStyle = this.getHealthBarFillStyle();
        drawPill(innerX, innerY, Math.max(innerH, innerW * displayPct), innerH);
      }
    }

    if (this.showTargetHealthText) {
      this.ctx.fillStyle = "hsla(0, 0%, 100%, 0.75)";
      this.ctx.font = "bold 9px Inter";
      this.ctx.textAlign = "center";
      if (this.showTargetHealthBar) {
        this.ctx.textBaseline = "bottom";
        this.ctx.fillText(healthText, x, outerY - textGap);
      } else {
        const textY = y - radius - gap - innerH / 2;
        this.ctx.textBaseline = "middle";
        this.ctx.fillText(healthText, x, textY);
      }
    }

    this.ctx.restore();
  },

  drawSpatialMap(ctx, x, y, hits, misses, scale = 1) {
    const boxW = 196 * scale;
    const boxH = 110 * scale;
    const halfW = boxW / 2;
    const halfH = boxH / 2;
    const inset = 4 * scale;
    const mapR = 55;

    const points = [...(hits || []), ...(misses || [])];
    let maxAbsYaw = 0.2;
    let maxAbsPitch = 0.1;
    for (const point of points) {
      maxAbsYaw = Math.max(maxAbsYaw, Math.abs(point.yaw));
      maxAbsPitch = Math.max(maxAbsPitch, Math.abs(point.pitch));
    }

    const pointScale = Math.min((halfW - inset) / maxAbsYaw, (halfH - inset) / maxAbsPitch);

    ctx.save();
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.4)";
    ctx.font = `bold ${9 * scale}px Inter`;
    ctx.textAlign = "center";
    ctx.fillText("SPATIAL (CLICKS)", x, y - mapR * scale - 12 * scale);

    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.1)";
    ctx.lineWidth = 1 * scale;
    ctx.beginPath();
    ctx.roundRect(x - halfW, y - halfH, boxW, boxH, 16 * scale);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x - 5 * scale, y);
    ctx.lineTo(x + 5 * scale, y);
    ctx.moveTo(x, y - 5 * scale);
    ctx.lineTo(x, y + 5 * scale);
    ctx.stroke();

    ctx.beginPath();
    ctx.rect(x - halfW, y - halfH, boxW, boxH);
    ctx.clip();

    misses.forEach((m) => {
      const hx = x + m.yaw * pointScale;
      const hy = y - m.pitch * pointScale;
      ctx.fillStyle = "rgba(120, 120, 120, 0.4)";
      ctx.beginPath();
      ctx.arc(hx, hy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    });
    hits.forEach((h) => {
      const hx = x + h.yaw * pointScale;
      const hy = y - h.pitch * pointScale;
      ctx.fillStyle = accentAlpha(0.6);
      ctx.beginPath();
      ctx.arc(hx, hy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  },

  drawPrecisionMap(ctx, x, y, offsets, scale = 1) {
    const mapR = 55;
    ctx.save();
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.4)";
    ctx.font = `bold ${9 * scale}px Inter`;
    ctx.textAlign = "center";
    ctx.fillText("PRECISION (OFFSETS)", x, y - mapR * scale - 12 * scale);

    ctx.strokeStyle = "hsla(0, 0%, 100%, 0.1)";
    ctx.lineWidth = 1 * scale;
    for (let r = 1; r <= 3; r++) {
      ctx.beginPath();
      ctx.arc(x, y, (mapR / 3) * r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - 5 * scale, y);
    ctx.lineTo(x + 5 * scale, y);
    ctx.moveTo(x, y - 5 * scale);
    ctx.lineTo(x, y + 5 * scale);
    ctx.stroke();

    offsets.forEach((off) => {
      const hx = x + off.yaw * (1200 * scale);
      const hy = y - off.pitch * (1200 * scale);
      ctx.fillStyle = accentAlpha(0.7);
      ctx.beginPath();
      ctx.arc(hx, hy, 2 * scale, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  },

  redrawProfileCharts() {
    const { game, mode, timer } = getProfileAimContext();
    const key = `bestAimResults_${game}_${mode}_${timer}`;
    const saved = localStorage.getItem(key);
    const data = saved ? JSON.parse(saved) : null;

    const sCanvas = elements["profile-best-spatial-canvas"];
    const pCanvas = elements["profile-best-precision-canvas"];
    if (!sCanvas || !pCanvas) {
      renderProgressChart(game, mode, timer);
      return;
    }

    const spatialSize = measureStatsCanvasSize(sCanvas, 200);
    if (spatialSize && spatialSize.cssW >= 100 && spatialSize.cssH >= 100) {
      const spatial = prepareStatsCanvas(sCanvas, 200);
      const precision = prepareStatsCanvas(pCanvas, 200);
      if (spatial && precision) {
        const { ctx, cssW, cssH } = spatial;
        const { ctx: pCtx, cssW: pW, cssH: pH } = precision;
        const spatialScale = cssH / 200;
        const precisionScale = pH / 200;

        if (data?.sessionHits && data?.sessionMisses && data?.sessionOffsets) {
          this.drawSpatialMap(ctx, cssW / 2, cssH / 2 + 10, data.sessionHits, data.sessionMisses, spatialScale);
          this.drawPrecisionMap(pCtx, pW / 2, pH / 2 + 10, data.sessionOffsets, precisionScale);
        } else if (data) {
          ctx.fillStyle = "hsla(0, 0%, 100%, 0.2)";
          ctx.font = "10px Inter";
          ctx.textAlign = "center";
          ctx.fillText("NEW SESSION REQUIRED", cssW / 2, cssH / 2);
          pCtx.fillStyle = "hsla(0, 0%, 100%, 0.2)";
          pCtx.font = "10px Inter";
          pCtx.textAlign = "center";
          pCtx.fillText("NEW SESSION REQUIRED", pW / 2, pH / 2);
        } else {
          ctx.fillStyle = "hsla(0, 0%, 100%, 0.1)";
          ctx.font = "10px Inter";
          ctx.textAlign = "center";
          ctx.fillText("NO DATA FOUND", cssW / 2, cssH / 2);
          pCtx.fillStyle = "hsla(0, 0%, 100%, 0.1)";
          pCtx.font = "10px Inter";
          pCtx.textAlign = "center";
          pCtx.fillText("NO DATA FOUND", pW / 2, pH / 2);
        }
      }
    }

    renderProgressChart(game, mode, timer);
  },

  displayResultsOnProfile() {
    const { game, mode, timer } = getProfileAimContext();

    const key = `bestAimResults_${game}_${mode}_${timer}`;
    toggleProfileSensConvButtons();

    const saved = localStorage.getItem(key);

    const hitDisplay = document.getElementById("profile-best-hits");
    const missDisplay = document.getElementById("profile-best-misses");
    const accDisplay = document.getElementById("profile-best-accuracy");
    const reactDisplay = document.getElementById("profile-best-reaction-time");
    const dateDisplay = document.getElementById("profile-best-date");

    if (!saved) {
      if (hitDisplay) hitDisplay.innerText = "N/A";
      if (missDisplay) missDisplay.innerText = "N/A";
      if (accDisplay) accDisplay.innerText = "N/A";
      if (reactDisplay) reactDisplay.innerText = "N/A";
      if (dateDisplay) dateDisplay.innerText = "N/A";

      requestProfileChartsRedraw();
      return;
    }

    const data = JSON.parse(saved);
    if (hitDisplay) hitDisplay.innerText = data.hits || "0";
    if (missDisplay) missDisplay.innerText = data.misses || "0";
    if (accDisplay) accDisplay.innerText = (data.accuracy || "0") + "%";
    if (reactDisplay) {
      reactDisplay.innerText = data.reaction === 9999 ? "-" : data.reaction + "ms";
      reactDisplay.style.color = "hsl(260, 60%, 70%)";
    }
    if (dateDisplay) dateDisplay.innerText = data.date || "-";

    requestProfileChartsRedraw();
  },

  endGame() {
    this.active = false;
    this.showResults = true;
    this.showShareMenu = false;
    this.shareScoreCanvas = null;
    this.buttonDisabledUntil = Date.now() + 2000;
    if (document.pointerLockElement) document.exitPointerLock();

    const currentHits = this.hits;
    const currentAccuracy = isTrainerAccuracyMode(this.mode) ? (this.totalTrackingFrames === 0 ? 0 : Math.round((this.trackingFrames / this.totalTrackingFrames) * 100)) : this.totalClicks > 0 ? Math.ceil((this.hits / this.totalClicks) * 100) : 0;
    const currentReaction = this.hits > 0 ? (this.totalTimeTaken / this.hits).toFixed(0) : 0;

    const currentSens = elements["canvas-sens"]?.value || "0";
    const currentDpi = elements["canvas-dpi"]?.value || "0";

    const key = `bestAimResults_${this.game.toUpperCase()}_${this.mode}_${this.sessionTimerId}`;
    const bestData = JSON.parse(localStorage.getItem(key)) || { hits: 0, accuracy: 0, reaction: 9999 };

    try {
      const histKey = `aimHistory_${this.game.toUpperCase()}_${this.mode}_${this.sessionTimerId}`;
      const hist = JSON.parse(localStorage.getItem(histKey)) || [];
      hist.push({
        ts: Date.now(),
        hits: currentHits,
        accuracy: currentAccuracy,
        reaction: Number(currentReaction) || 0,
        score: isTrainerAccuracyMode(this.mode) ? currentAccuracy : currentHits,
        sens: currentSens,
        dpi: currentDpi,
      });
      if (hist.length > 50) hist.splice(0, hist.length - 50);
      localStorage.setItem(histKey, JSON.stringify(hist));
    } catch (e) {}

    this.sessionPBs = {
      hits: currentHits > bestData.hits,
      accuracy: currentAccuracy > bestData.accuracy,
      reaction: currentReaction < bestData.reaction && currentReaction > 0,
    };

    const isNewBest = this.sessionPBs.hits || this.sessionPBs.accuracy || this.sessionPBs.reaction || !bestData.sessionHits;

    if (isNewBest) {
      localStorage.setItem(
        key,
        JSON.stringify({
          hits: currentHits,
          accuracy: currentAccuracy,
          misses: this.misses,
          reaction: this.sessionPBs.reaction ? currentReaction : bestData.reaction || 9999,
          date: new Date().toLocaleDateString(),
          sens: currentSens,
          dpi: currentDpi,
          sessionHits: this.sessionHits,
          sessionMisses: this.sessionMisses,
          sessionOffsets: this.sessionOffsets,
        }),
      );
    }

    if (this.finderEnabled && this.timeLeft <= 0) {
      this.finderSessionResults.push({
        sens: parseFloat(currentSens),
        score: isTrainerAccuracyMode(this.mode) ? currentAccuracy : currentHits,
      });

      this.finderSessionIndex++;
      this.finderTrialSens = null;

      if (this.finderSessionIndex >= 10) {
        this.finishFinderCycle();
      }
    }

    this.displayResultsOnProfile();
    this.render();
  },

  finishFinderCycle() {
    const bestResult = this.finderSessionResults.reduce((prev, curr) => (curr.score > prev.score ? curr : prev));
    const finalSens = Number(bestResult.sens).toFixed(3);

    if (elements["canvas-sens"]) {
      elements["canvas-sens"].value = finalSens;
      localStorage.setItem("aimSens", finalSens);
    }

    this.showFinderNotification(finalSens);

    if (document.fullscreenElement) {
      document.exitFullscreen();
    }

    this.finderEnabled = false;
    this.finderSessionIndex = 0;
    this.finderSessionResults = [];
    this.finderTrialSens = null;
    this.syncSensInputFinderLock();
    if (elements["finder-reset-btn"]) elements["finder-reset-btn"].disabled = true;
    const finderSelector = document.getElementById("finder-selector");
    if (finderSelector) {
      finderSelector.querySelectorAll(".toggle-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.value === "false");
      });
    }

    this.syncTrainerTimerFinderLock();
    this.updateAllGliders();
  },

  showFinderNotification(finalSens) {
    window.Toast?.notify({
      message: `Optimal sensitivity discovered: ${finalSens}`,
      type: "success",
      duration: 5000,
    });
  },

  spawnTarget() {
    const modeDef = getTrainerModeDef(this.mode);
    const radius = this.getTargetRadius();
    const { yaw, pitch, valid } = this.findOpenSpawnAngles(radius);
    if (!valid) return;

    const target = {
      yaw,
      pitch,
      radius,
      vx: 0,
      vy: 0,
      maxHealth: this.getTrackingTargetMaxHealth(),
      health: this.getTrackingTargetMaxHealth(),
      displayHealth: this.getTrackingTargetMaxHealth(),
      trailHealth: this.getTrackingTargetMaxHealth(),
    };

    if (modeDef.movement === "strafe") {
      const spreadScale = getTargetSpreadDef(this.targetSpreadLevel).scale;
      target.strafeCenterYaw = yaw;
      target.strafeCenterPitch = pitch;
      target.strafeOffset = 0;
      target.strafeHalfWidth = (0.06 + Math.random() * 0.03) * spreadScale;
      target.vx = (Math.random() > 0.5 ? 1 : -1) * (0.0015 + Math.random() * 0.001);
    }

    this.targets.push(target);
  },

  fireShot() {
    let targetHit = null;
    let targetIndex = -1;
    for (let i = 0; i < this.targets.length; i++) {
      const t = this.targets[i];
      const dist = this.getAngularDistance(this.camera.yaw, this.camera.pitch, t.yaw, t.pitch);
      if (dist < t.radius) {
        targetHit = t;
        targetIndex = i;
        break;
      }
    }

    this.totalClicks++;

    if (targetHit) {
      const now = performance.now();
      const reactionTime = now - this.lastHitTime;
      this.damageShots++;
      const maxHealth = targetHit.maxHealth ?? this.getTrackingTargetMaxHealth();
      targetHit.maxHealth = maxHealth;
      const unlimitedHp = this.isTrackingUnlimitedHp();
      if (!unlimitedHp) {
        targetHit.health = Math.max(0, (targetHit.health ?? maxHealth) - TARGET_SHOT_DAMAGE);
        targetHit.trailHealth = Math.max(targetHit.trailHealth ?? targetHit.displayHealth ?? maxHealth, targetHit.displayHealth ?? maxHealth);
      }

      if (this.crosshair.flash) this.hitMarkerAlpha = 1.0;
      this.sessionHits.push({ yaw: this.camera.yaw, pitch: this.camera.pitch });
      this.sessionOffsets.push({
        yaw: this.camera.yaw - targetHit.yaw,
        pitch: this.camera.pitch - targetHit.pitch,
      });
      this.playHitSound();

      if (!unlimitedHp && targetHit.health <= 0) {
        if (this.showHitmarker) {
          this.hitMarkers.push({ yaw: targetHit.yaw, pitch: targetHit.pitch, alpha: 1.0, type: "" });
        }
        const killedPhaseX = targetHit.phaseX;
        const killedPhaseY = targetHit.phaseY;
        this.targets.splice(targetIndex, 1);

        this.hits++;
        if (this.randomizerEnabled) {
          this.randomizeSensitivity();
          this.randomizerTimer = 0;
        }
        if (reactionTime > 10) this.totalTimeTaken += reactionTime;
        this.lastHitTime = now;

        if (isTrainerAccuracyMode(this.mode)) {
          this.isFlickingToNewTarget = true;
          this.spawnTarget();
          this.initTrackingTargetMotion(this.targets[0], { phaseX: killedPhaseX, phaseY: killedPhaseY });
        } else if (this.targets.length < getModeMaxTargets(this.mode)) {
          this.spawnTarget();
        }
      }
    } else {
      this.misses++;
      this.missFlashAlpha = 1.0;
      this.sessionMisses.push({ yaw: this.camera.yaw, pitch: this.camera.pitch });

      if (this.targets.length > 0) {
        let nearest = this.targets[0];
        let minDist = this.getAngularDistance(this.camera.yaw, this.camera.pitch, nearest.yaw, nearest.pitch);
        for (let i = 1; i < this.targets.length; i++) {
          const d = this.getAngularDistance(this.camera.yaw, this.camera.pitch, this.targets[i].yaw, this.targets[i].pitch);
          if (d < minDist) {
            minDist = d;
            nearest = this.targets[i];
          }
        }

        const flickResult = this.classifyMissFlick(nearest, minDist);
        if (flickResult?.isOver) this.overFlicks++;
        else if (flickResult) this.underFlicks++;
      }
    }

    this.recentFlick = null;
    this.lastFireTime = performance.now();
  },

  handleHit() {
    if (this.showResults || this.isCountingDown) return;
    this.tryFireAtRate(true);
  },

  getAngularDistance(cameraYaw, cameraPitch, targetYaw, targetPitch) {
    let deltaYaw = targetYaw - cameraYaw;

    while (deltaYaw > Math.PI) deltaYaw -= 2 * Math.PI;
    while (deltaYaw < -Math.PI) deltaYaw += 2 * Math.PI;

    const deltaPitch = targetPitch - cameraPitch;
    const aspectX = this.getAspectHorizontalScale();
    return Math.sqrt(Math.pow(deltaYaw * aspectX, 2) + Math.pow(deltaPitch, 2));
  },

  project(yaw, pitch, cx, cy, focalLength) {
    const relYaw = yaw - this.camera.yaw;
    const relPitch = pitch - this.camera.pitch;
    const aspectX = this.getAspectHorizontalScale();
    const focal = focalLength ?? this.getFocalLength();
    return {
      x: cx + relYaw * focal * aspectX,
      y: cy - relPitch * focal,
    };
  },
  drawFinderUI() {
    if (!this.finderEnabled || !document.fullscreenElement) return;
    const pad = 24;
    const topY = 26;
    this.ctx.save();
    this.ctx.textBaseline = "top";
    this.ctx.fillStyle = accentAlpha(0.8);
    this.ctx.font = "bold 14px Inter";
    this.ctx.textAlign = "right";
    this.ctx.fillText(`FINDER: SESSION ${this.finderSessionIndex + 1}/10`, this.canvas.width - pad, topY);
    this.ctx.restore();
  },
  drawRandomizerUI() {
    if (!this.randomizerEnabled || !this.active) return;
    const cx = this.canvas.width / 2;
    const pad = 24;
    const w = 120;
    const h = 4;
    const y = this.canvas.height - pad - h;

    this.ctx.save();
    this.ctx.fillStyle = "hsla(0, 0%, 100%, 0.1)";
    this.ctx.beginPath();
    this.ctx.roundRect(cx - w / 2, y, w, h, 2);
    this.ctx.fill();

    const min = 0.5,
      max = 1.5;
    const ratio = Math.max(0, Math.min(1, (this.randomScale - min) / (max - min)));
    const fillX = cx - w / 2 + ratio * w;

    this.ctx.strokeStyle = "hsla(0, 0%, 100%, 0.2)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(cx, y - 4);
    this.ctx.lineTo(cx, y + h + 4);
    this.ctx.stroke();

    this.ctx.fillStyle = accentColor();
    this.ctx.font = "bold 10px Inter";
    this.ctx.textAlign = "center";
    this.ctx.fillText(`${this.randomScale.toFixed(2)}x`, fillX, y - 8);
    this.ctx.beginPath();
    this.ctx.arc(fillX, y + h / 2, 4, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  },
  drawChart(x, y, label, value, max, unit, color, isPB = false) {
    const w = 240,
      h = 14;
    this.ctx.fillStyle = "hsla(0, 0%, 100%, 0.05)";
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

    if (isPB) {
      const labelWidth = this.ctx.measureText(label).width;
      this.ctx.fillStyle = "hsl(46, 100%, 50%)";
      this.ctx.beginPath();
      this.ctx.roundRect(x + labelWidth + 8, y - 18, 22, 12, 3);
      this.ctx.fill();
      this.ctx.fillStyle = "black";
      this.ctx.font = "bold 8px Inter";
      this.ctx.fillText("PB", x + labelWidth + 12, y - 9);
    }

    this.ctx.fillStyle = "white";
    this.ctx.font = "11px Inter";
    this.ctx.textAlign = "right";
    this.ctx.fillText(`${value}${unit}`, x + w, y - 8);
  },

  drawSessionHud(cx) {
    const pad = 24;
    const topY = 26;
    let acc;
    if (isTrainerAccuracyMode(this.mode)) {
      acc = this.totalTrackingFrames === 0 ? 0 : Math.round((this.trackingFrames / this.totalTrackingFrames) * 100);
    } else {
      acc = this.totalClicks === 0 ? 0 : Math.ceil((this.hits / this.totalClicks) * 100);
    }

    this.ctx.save();
    this.ctx.textBaseline = "top";
    this.ctx.textAlign = "left";
    this.ctx.font = "bold 14px Inter";
    this.ctx.fillStyle = "hsla(0, 0%, 100%, 0.88)";
    const hitsLabel = isTrainerAccuracyMode(this.mode) ? "KILLS" : "HITS";
    this.ctx.fillText(`${hitsLabel}: ${this.hits}`, pad, topY);
    this.ctx.fillText(`ACC: ${acc}%`, pad, topY + 22);

    if (!isTrainerAccuracyMode(this.mode) && this.missFlashAlpha > 0) {
      this.ctx.save();
      this.ctx.globalAlpha = this.missFlashAlpha;
      this.ctx.fillStyle = "hsl(0, 100%, 55%)";
      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = "red";
      this.ctx.fillText(`ACC: ${acc}%`, pad, topY + 22);
      this.ctx.restore();
    }

    const timerId = this.getSessionTimerId();
    const timerSeconds = isInfiniteTrainerTimer(timerId) ? this.getSessionElapsedSeconds() : this.timeLeft;
    const timerText = `${timerSeconds}s`;
    const timerX = cx;
    const timerY = topY + 2;
    const timerFontSize = 24;
    const timerCenterY = timerY + timerFontSize * 0.45;
    const pulseScale = 1 + 0.1 * this.timerPulseAlpha;

    this.ctx.save();
    if (this.timerPulseAlpha > 0) {
      this.ctx.translate(timerX, timerCenterY);
      this.ctx.scale(pulseScale, pulseScale);
      this.ctx.translate(-timerX, -timerCenterY);
    }

    this.ctx.textAlign = "center";
    this.ctx.shadowBlur = 0;
    this.ctx.fillStyle = "hsla(0, 0%, 100%, 0.92)";
    this.ctx.font = `bold ${timerFontSize}px Inter`;
    this.ctx.fillText(timerText, timerX, timerY);

    if (this.timerPulseAlpha > 0) {
      this.ctx.save();
      this.ctx.globalAlpha = this.timerPulseAlpha;
      this.ctx.fillStyle = "hsl(0, 100%, 55%)";
      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = "red";
      this.ctx.fillText(timerText, timerX, timerY);
      this.ctx.restore();
    }

    this.ctx.restore();

    const bulletsHit = this.totalClicks - this.misses;
    const bulletsShot = this.totalClicks;
    const bulletCounter = `${bulletsHit} / ${bulletsShot}`;
    this.ctx.textAlign = "right";
    this.ctx.textBaseline = "alphabetic";
    this.ctx.font = "bold 13px Inter";
    this.ctx.shadowBlur = 0;
    this.ctx.fillStyle = "hsla(0, 0%, 100%, 0.8)";
    this.ctx.fillText(bulletCounter, this.canvas.width - pad, this.canvas.height - pad);

    if (this.missFlashAlpha > 0) {
      this.ctx.save();
      this.ctx.globalAlpha = this.missFlashAlpha;
      this.ctx.fillStyle = "hsl(0, 100%, 50%)";
      this.ctx.shadowBlur = 10;
      this.ctx.shadowColor = "red";
      this.ctx.fillText(bulletCounter, this.canvas.width - pad, this.canvas.height - pad);
      this.ctx.restore();
    }

    this.ctx.restore();
  },

  drawStandbyGrid(time = 0) {
    if (!this.canvas || !this.ctx) return;

    const gridSize = STANDBY_GRID_CELL;
    const scrollX = document.body.classList.contains("reduce-motion") ? 0 : (time * 20) % gridSize;
    const scrollY = document.body.classList.contains("reduce-motion") ? 0 : (time * 20) % gridSize;

    this.ctx.save();
    this.ctx.lineWidth = 1;
    this.ctx.strokeStyle = accentAlpha(0.15);
    this.ctx.beginPath();
    for (let x = scrollX; x < this.canvas.width; x += gridSize) {
      this.ctx.moveTo(x + 0.5, 0);
      this.ctx.lineTo(x + 0.5, this.canvas.height);
    }
    for (let y = scrollY; y < this.canvas.height; y += gridSize) {
      this.ctx.moveTo(0, y + 0.5);
      this.ctx.lineTo(this.canvas.width, y + 0.5);
    }
    this.ctx.stroke();
    this.ctx.restore();
  },

  drawWorldTrainingGrid(cx, cy, focalLength) {
    if (!this.canvas || !this.ctx) return;

    const aspectX = this.getAspectHorizontalScale();
    const focal = focalLength ?? this.getFocalLength();
    const cellYaw = TRAINING_GRID_CELL / (focal * aspectX);
    const cellPitch = TRAINING_GRID_CELL / focal;

    const yawHalf = cx / (focal * aspectX) + cellYaw;
    const pitchHalf = cy / focal + cellPitch;
    const yawMin = this.camera.yaw - yawHalf;
    const yawMax = this.camera.yaw + yawHalf;
    const pitchMin = this.camera.pitch - pitchHalf;
    const pitchMax = this.camera.pitch + pitchHalf;

    const yawStart = Math.floor(yawMin / cellYaw) * cellYaw;
    const yawEnd = Math.ceil(yawMax / cellYaw) * cellYaw;
    const pitchStart = Math.floor(pitchMin / cellPitch) * cellPitch;
    const pitchEnd = Math.ceil(pitchMax / cellPitch) * cellPitch;

    this.ctx.save();
    this.ctx.strokeStyle = "hsla(0, 0%, 100%, 0.05)";
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();

    for (let yaw = yawStart; yaw <= yawEnd + 1e-9; yaw += cellYaw) {
      const x = cx + (yaw - this.camera.yaw) * focal * aspectX;
      const yTop = cy - (pitchMax - this.camera.pitch) * focal;
      const yBottom = cy - (pitchMin - this.camera.pitch) * focal;
      this.ctx.moveTo(x + 0.5, yTop);
      this.ctx.lineTo(x + 0.5, yBottom);
    }

    for (let pitch = pitchStart; pitch <= pitchEnd + 1e-9; pitch += cellPitch) {
      const y = cy - (pitch - this.camera.pitch) * focal;
      const xLeft = cx + (yawMin - this.camera.yaw) * focal * aspectX;
      const xRight = cx + (yawMax - this.camera.yaw) * focal * aspectX;
      this.ctx.moveTo(xLeft, y + 0.5);
      this.ctx.lineTo(xRight, y + 0.5);
    }

    this.ctx.stroke();
    this.ctx.restore();
  },

  render() {
    if (!this.canvas || !this.ctx) return;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const cx = this.canvas.width / 2,
      cy = this.canvas.height / 2;

    const focalLength = this.getFocalLength();
    const time = performance.now() / 1000;
    const inFullscreenSession = Boolean(document.fullscreenElement);
    const isStandby = !inFullscreenSession || (!this.active && !this.showResults && !this.isCountingDown);
    const isTrainingView = inFullscreenSession && !this.showResults && (this.active || this.isCountingDown);

    this.ctx.fillStyle = "hsl(214, 41%, 3%)";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (isTrainingView) this.drawWorldTrainingGrid(cx, cy, focalLength);

    const showParticles = isStandby || this.showResults;

    const frameAccent = showParticles || isStandby ? accentColor() : null;
    const frameAccentAlpha04 = isStandby ? accentAlpha(0.4) : null;
    const frameAccentAlpha045 = showParticles ? accentAlpha(0.45) : null;
    const frameAccentAlpha075 = showParticles ? accentAlpha(0.75) : null;

    if (showParticles) {
      this.ensureStandbyParticles();
      this.drawStandbyParticles(frameAccent, frameAccentAlpha045, frameAccentAlpha075);
    }

    if (isStandby) {
      this.drawStandbyGrid(time);
      const overBubble = this.isPointInStandbyBubble(this.mx, this.my);
      if (overBubble !== this.standbyCanvasHover) {
        this.standbyCanvasHover = overBubble;
        this.canvas.style.cursor = overBubble ? "pointer" : "default";
      }

      const scanY = this.getStandbyScanY(time);
      this.ctx.strokeStyle = frameAccentAlpha04;
      this.ctx.beginPath();
      this.ctx.moveTo(0, scanY);
      this.ctx.lineTo(this.canvas.width, scanY);
      this.ctx.stroke();

      if (!document.fullscreenElement) {
        this.ctx.strokeStyle = "white";
        this.ctx.lineWidth = 2;
        const cornerSize = 20,
          pad = 30;
        const corners = [
          [pad, pad, 1, 1],
          [this.canvas.width - pad, pad, -1, 1],
          [pad, this.canvas.height - pad, 1, -1],
          [this.canvas.width - pad, this.canvas.height - pad, -1, -1],
        ];
        corners.forEach(([x, y, sx, sy]) => {
          this.ctx.beginPath();
          this.ctx.moveTo(x, y + cornerSize * sy);
          this.ctx.lineTo(x, y);
          this.ctx.lineTo(x + cornerSize * sx, y);
          this.ctx.stroke();
        });
      }

      this.ctx.save();
      const pulse = document.body.classList.contains("reduce-motion") ? 1 : 0.72 + Math.sin(time * 2.5) * 0.14;
      const layout = this.getStandbyPromptLayout();

      this.drawStandbyPromptBubble({
        ...layout,
        pulse,
        time,
      });

      this.ctx.strokeStyle = frameAccent;
      this.ctx.lineWidth = 2;
      this.ctx.beginPath();
      const bGap = 20,
        sideBracketSize = 8;
      const textWidth = layout.textWidth;
      this.ctx.moveTo(cx - textWidth / 2 - bGap, cy - sideBracketSize);
      this.ctx.lineTo(cx - textWidth / 2 - bGap - 5, cy - sideBracketSize);
      this.ctx.lineTo(cx - textWidth / 2 - bGap - 5, cy + sideBracketSize + 5);
      this.ctx.lineTo(cx - textWidth / 2 - bGap, cy + sideBracketSize + 5);
      this.ctx.moveTo(cx + textWidth / 2 + bGap, cy - sideBracketSize);
      this.ctx.lineTo(cx + textWidth / 2 + bGap + 5, cy - sideBracketSize);
      this.ctx.lineTo(cx + textWidth / 2 + bGap + 5, cy + sideBracketSize + 5);
      this.ctx.lineTo(cx + textWidth / 2 + bGap, cy + sideBracketSize + 5);
      this.ctx.stroke();
      this.ctx.restore();
      this.drawFinderUI();
      this.drawRandomizerUI();
      return;
    }

    if (this.showResults) {
      this.ctx.fillStyle = "hsla(214, 41%, 3%, 0.95)";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = "white";
      this.ctx.font = "bold 26px Inter";
      this.ctx.textAlign = "center";
      this.ctx.fillText("SESSION SUMMARY", cx, cy - 225);

      let acc;
      if (isTrainerAccuracyMode(this.mode)) {
        acc = this.totalTrackingFrames === 0 ? 0 : Math.round((this.trackingFrames / this.totalTrackingFrames) * 100);
      } else {
        acc = this.totalClicks === 0 ? 0 : Math.ceil((this.hits / this.totalClicks) * 100);
      }
      const reaction = this.hits > 0 ? (this.totalTimeTaken / this.hits).toFixed(0) : 0;

      const hitsChartMax = isInfiniteTrainerTimer(this.sessionTimerId) ? Math.max(this.hits, Math.ceil(this.timeLeft * 2) || 10) : Math.ceil(parseInt(this.sessionTimerId, 10) * 2.6);
      this.drawChart(cx - 120, cy - 194, "HITS", this.hits, hitsChartMax, "", "hsl(30, 35%, 64%)", this.sessionPBs.hits);
      this.drawChart(cx - 120, cy - 149, "MISSES", this.misses, 80, "", "hsl(0, 0%, 75%)", false);
      this.drawChart(cx - 120, cy - 104, "ACCURACY", acc, 100, "%", "hsl(46, 65%, 52%)", this.sessionPBs.accuracy);
      this.drawChart(cx - 120, cy - 59, "REACTION TIME", reaction, 1000, "ms", "hsl(260, 60%, 70%)", this.sessionPBs.reaction);

      const mapScale = 1.4;
      this.drawSpatialMap(this.ctx, cx - 102, cy + 72, this.sessionHits, this.sessionMisses, mapScale);
      this.drawPrecisionMap(this.ctx, cx + 162, cy + 72, this.sessionOffsets, mapScale);

      this.ctx.fillStyle = "white";
      this.ctx.font = "bold 11px Inter";
      this.ctx.textAlign = "center";
      this.ctx.globalAlpha = 0.7;
      this.ctx.fillText(`${this.underFlicks} UNDER-FLICKS | ${this.overFlicks} OVER-FLICKS`, cx, cy + 183);

      const b = this.restartButton;
      const sb = this.shareButton;
      const btnGap = 15;
      const totalBtnW = b.w + sb.w + btnGap;

      b.x = cx - totalBtnW / 2;
      b.y = cy + 206;
      sb.x = b.x + b.w + btnGap;
      sb.y = cy + 206;

      const isDisabled = Date.now() < this.buttonDisabledUntil;
      const restartLabel = isDisabled ? "WAIT..." : this.finderEnabled ? "Next Session" : "RESTART";

      this.ctx.globalAlpha = isDisabled ? 0.5 : 1.0;
      this.ctx.fillStyle = accentColor();
      this.ctx.beginPath();
      this.ctx.roundRect(b.x, b.y, b.w, b.h, b.radius);
      this.ctx.fill();

      this.ctx.fillStyle = "white";
      this.ctx.font = "bold 13px Inter";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(restartLabel, b.x + b.w / 2, b.y + b.h / 2);

      this.ctx.fillStyle = "hsla(0, 0%, 100%, 0.1)";
      this.ctx.beginPath();
      this.ctx.roundRect(sb.x, sb.y, sb.w, sb.h, sb.radius);
      this.ctx.fill();
      this.ctx.strokeStyle = "hsla(0, 0%, 100%, 0.2)";
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
      this.ctx.fillStyle = "white";
      this.ctx.fillText(isDisabled ? "WAIT..." : "SHARE SCORE", sb.x + sb.w / 2, sb.y + sb.h / 2);
      this.ctx.textBaseline = "alphabetic";

      if (isDisabled) {
        const now = Date.now();
        const ratio = Math.max(0, (this.buttonDisabledUntil - now) / 2000);
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(this.mx, this.my, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ratio);
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
        this.ctx.lineWidth = 3;
        this.ctx.lineCap = "round";
        this.ctx.stroke();
        this.ctx.restore();
      }

      this.ctx.globalAlpha = 1.0;
      if (this.showShareMenu) this.drawShareMenu(cx, cy);
      this.drawFinderUI();
      this.drawRandomizerUI();
      return;
    }

    if (this.isCountingDown) {
      this.ctx.fillStyle = "hsla(0, 0%, 0%, 0.6)";
      this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = "white";
      this.ctx.font = "bold 80px Inter";
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(String(this.countdownValue), cx, cy + 25);
      this.drawRestartHint();
      this.drawFinderUI();
      this.drawRandomizerUI();
      return;
    }

    this.drawFinderUI();
    this.drawRandomizerUI();
    this.canvas.style.cursor = "none";
    this.targets.forEach((t) => {
      const p = this.project(t.yaw, t.pitch, cx, cy, focalLength);
      const padding = 30;
      const onScreen = p.x >= padding && p.x <= this.canvas.width - padding && p.y >= padding && p.y <= this.canvas.height - padding;
      if (onScreen) {
        const aspectX = this.getAspectHorizontalScale();
        const rx = t.radius * focalLength * aspectX;
        const ry = t.radius * focalLength;
        const grad = this.ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(1, Math.max(rx, ry)));
        grad.addColorStop(0, this.targetColor);
        grad.addColorStop(1, this.targetColorDark);
        this.ctx.fillStyle = grad;
        this.ctx.beginPath();
        this.ctx.ellipse(p.x, p.y, Math.max(0, rx), Math.max(0, ry), 0, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.strokeStyle = "hsla(0, 0%, 100%, 0.8)";
        this.ctx.lineWidth = 2;
        this.ctx.stroke();
        this.drawTargetHealthDisplay(p.x, p.y, Math.max(rx, ry), t.displayHealth ?? t.health ?? t.maxHealth, t.trailHealth ?? t.displayHealth ?? t.health ?? t.maxHealth, t.maxHealth);
      } else {
        const dx = p.x - cx;
        const dy = p.y - cy;
        const angle = Math.atan2(dy, dx);
        const dist = Math.min(cx - padding, cy - padding);
        const ax = cx + Math.cos(angle) * dist;
        const ay = cy + Math.sin(angle) * dist;
        this.ctx.fillStyle = this.targetColor;
        this.ctx.save();
        this.ctx.translate(ax, ay);
        this.ctx.rotate(angle);
        this.ctx.beginPath();
        this.ctx.moveTo(15, 0);
        this.ctx.lineTo(-5, 8);
        this.ctx.lineTo(-5, -8);
        this.ctx.fill();
        this.ctx.restore();
      }
    });

    this.hitMarkers.forEach((m) => {
      const p = this.project(m.yaw, m.pitch, cx, cy, focalLength);
      this.ctx.strokeStyle = `rgba(255, 255, 255, ${m.alpha})`;
      this.ctx.lineWidth = 2;
      const s = 5;
      this.ctx.beginPath();
      this.ctx.moveTo(p.x - s, p.y - s);
      this.ctx.lineTo(p.x + s, p.y + s);
      this.ctx.moveTo(p.x + s, p.y - s);
      this.ctx.lineTo(p.x - s, p.y + s);
      this.ctx.stroke();

      if (m.type) {
        this.ctx.fillStyle = `rgba(255, 255, 255, ${m.alpha * 0.8})`;
        this.ctx.font = "bold 10px Inter";
        this.ctx.textAlign = "center";
        this.ctx.fillText(m.type, p.x, p.y - 15);
      }
    });

    this.drawSessionHud(cx);
    this.drawRestartHint();

    const strokeOverride = this.crosshair.flash && this.hitMarkerAlpha > 0 ? `rgba(255, 255, 255, ${this.hitMarkerAlpha})` : null;
    this.drawCrosshairAt(this.ctx, cx, cy, this.crosshair, strokeOverride);
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

function initEdpiPresetsResizeAnimation() {
  const box = document.getElementById("edpi-presets-box");
  if (box) bindHeightResizeAnimation(box);
}

let lastRenderedPresetGame = null;
function renderEdpiPresets(game) {
  const container = document.getElementById("edpi-presets-dynamic");
  if (!container) return;
  if (game === lastRenderedPresetGame) {
    checkActivePresets();
    return;
  }
  lastRenderedPresetGame = game;

  const data = edpiPresets[game];
  if (!game || !data) {
    container.innerHTML = '<p id="edpi-presets-hint" style="color: gray; font-size: 0.85rem; text-align: center; margin: 0.5rem 0">Select a game above to see its presets.</p>';
    return;
  }

  const buttons = data.presets
    .map((p) => {
      const g = game.replace(/'/g, "\\'");
      return `<button class="preset-btn" onclick="applyEdpiPreset('${g}', ${p.dpi}, ${p.sens})">${p.name}</button>`;
    })
    .join("");

  container.innerHTML = `
    <fieldset class="preset-topic-holder">
      <legend class="preset-topic" style="--preset-topic-color: ${data.color}">${game}</legend>
      <div class="preset-grid">${buttons}</div>
    </fieldset>`;
  checkActivePresets();
}

function updateEDPI() {
  const dpiVal = elements["edpi-dpi"].value,
    sensVal = elements["edpi-sens"].value,
    gameVal = elements["edpi-game-search"].value,
    display = elements["edpi-value"],
    pointer = elements["spectrum-pointer"],
    rankLabel = elements["edpi-rank"],
    proDisplay = elements["pro-comparison"],
    proName = elements["pro-name"],
    copyBtn = document.getElementById("edpi-copy"),
    shareBtn = document.getElementById("edpi-share-btn"),
    defaultColor = "white";

  const clearBtn = document.getElementById("edpi-game-clear");

  if (clearBtn) clearBtn.style.display = gameVal ? "flex" : "none";

  renderEdpiPresets(gameVal);

  const rawEdpi = parseFloat(dpiVal) * parseFloat(sensVal.replace(",", "."));
  const edpi = Math.round(rawEdpi);

  checkActivePresets();
  toggleEDPIResetButton();

  if (gameVal === "" || isNaN(edpi) || edpi === 0) {
    if (display) display.innerText = "0";
    if (rankLabel) rankLabel.style.opacity = "0";
    if (proDisplay) proDisplay.style.opacity = "0";
    hideSensSuggestion();
    if (pointer) {
      pointer.style.left = "0%";
      pointer.style.backgroundColor = defaultColor;
      pointer.style.boxShadow = "none";
    }
    toggleVisibility(copyBtn, false);
    toggleVisibility(shareBtn, false);
    return;
  }

  if (display) display.innerText = edpi;
  toggleVisibility(copyBtn, edpi !== 0);
  toggleVisibility(shareBtn, edpi !== 0);

  let percent, color, label, tier;
  const multiplier = gameMultipliers[gameVal] || 1.0;
  const lowThreshold = 200 * multiplier;
  const midThreshold = 320 * multiplier;

  if (edpi < lowThreshold) {
    label = "PRO LOW";
    color = EDPI_TIER_COLORS.low;
    tier = "low";
    percent = Math.min((edpi / lowThreshold) * 33, 33);
  } else if (edpi < midThreshold) {
    label = "PRO AVERAGE";
    color = EDPI_TIER_COLORS.average;
    tier = "average";
    percent = 33 + ((edpi - lowThreshold) / (midThreshold - lowThreshold)) * 33;
  } else {
    label = "PRO HIGH";
    color = EDPI_TIER_COLORS.high;
    tier = "high";
    percent = Math.min(66 + ((edpi - midThreshold) / (midThreshold * 1.5)) * 34, 100);
  }

  if (edpi > 0 && gameVal) {
    localStorage.setItem("lastEdpiCalc", edpi);
    localStorage.setItem("lastEdpiGame", gameVal);
    localStorage.setItem("lastEdpiSens", sensVal);
    localStorage.setItem("lastEdpiDpi", dpiVal);
    localStorage.setItem("lastEdpiColor", color);

    const pEdpi = document.getElementById("last-edpi-calc");
    const pGame = document.getElementById("profile-edpi-game");
    const pSens = document.getElementById("profile-edpi-sens");
    const pDpi = document.getElementById("profile-edpi-dpi");
    const pCm = document.getElementById("profile-edpi-cm");
    const pDot = document.getElementById("profile-edpi-status-dot");

    if (pEdpi) pEdpi.innerText = edpi;
    if (pGame) pGame.innerText = gameVal;
    if (pSens) pSens.innerText = sensVal;
    if (pDpi) pDpi.innerText = dpiVal;
    const cmVal = calculateCm360(parseFloat(sensVal.replace(",", ".")), parseFloat(dpiVal), gameVal);
    if (pCm) pCm.innerText = cmVal + "cm";
    if (pDot) {
      pDot.style.display = "block";
      pDot.style.backgroundColor = color;
    }
    localStorage.setItem("lastEdpiCm", cmVal);
  }

  toggleProfileSensConvButtons();
  updateGameInfoPanelVisibility();

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
    const poolKey = gameVal === "CS2" ? "CS2" : gameVal === "Valorant" ? "Valorant" : "General";
    const gamePool = proDatabase[poolKey] || proDatabase.General;
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
  if (isEdpiTabVisible()) {
    showTacticalAdvice(edpi, gameVal, tier);
  }
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

function updateGameInfoPanelVisibility() {
  const sensInfo = document.getElementById("sens-game-info");
  if (sensInfo) {
    const sFrom = localStorage.getItem("fromGame");
    const sTo = localStorage.getItem("toGame");
    const sVal = localStorage.getItem("lastSensConv");
    const hasSens = sFrom && sTo && sVal && sVal !== "0.00" && sVal !== "0";
    sensInfo.style.display = "";
    sensInfo.classList.toggle("is-empty", !hasSens);
  }

  const edpiInfo = document.getElementById("edpi-game-info");
  if (edpiInfo) {
    const eGame = localStorage.getItem("lastEdpiGame");
    const eVal = localStorage.getItem("lastEdpiCalc");
    const hasEdpi = eGame && eVal && eVal !== "0";
    edpiInfo.style.display = "";
    edpiInfo.classList.toggle("is-empty", !hasEdpi);
  }
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 768px)").matches;
}

let aimTrainerNode = null;
let aimTrainerAnchor = null;
let wasMobile = null;

function syncAimTrainerForViewport() {
  const mobile = isMobileViewport();
  if (mobile === wasMobile) return;

  if (mobile) {
    const node = document.getElementById("aim-training-tab");
    if (node) {
      aimTrainerAnchor = document.createComment("aim-training-tab-anchor");
      node.parentNode.insertBefore(aimTrainerAnchor, node);
      aimTrainerNode = node.parentNode.removeChild(node);
    }
  } else {
    if (aimTrainerNode && aimTrainerAnchor && aimTrainerAnchor.parentNode) {
      aimTrainerAnchor.parentNode.insertBefore(aimTrainerNode, aimTrainerAnchor);
      aimTrainerAnchor.parentNode.removeChild(aimTrainerAnchor);
      aimTrainerNode = null;
      aimTrainerAnchor = null;
    }
  }
  wasMobile = mobile;
}

const SENS_SUGGESTION_HIDDEN_TABS = new Set(["sensitivity-converter-tab", "aim-training-tab", "settings-tab", "stats-tab", "lineup-tab", "crosshair-converter-tab", "viewmodel-generator-tab", "privacy-policy-tab", "terms-of-service-tab", "keybinds-tab", "updates-tab", "credit-tab"]);

let lastTacticalAdviceKey = "";

function getEdpiAdviceTier(edpi, game) {
  const multiplier = gameMultipliers[game] || 1.0;
  const lowThreshold = 200 * multiplier;
  const midThreshold = 320 * multiplier;
  if (edpi < lowThreshold) return "low";
  if (edpi < midThreshold) return "average";
  return "high";
}

function showTacticalAdvice(edpi, game, tier = getEdpiAdviceTier(edpi, game)) {
  if (!isEdpiTabVisible() || !game || !edpi) return;
  const key = `${game}:${tier}`;
  if (key === lastTacticalAdviceKey) return;
  lastTacticalAdviceKey = key;
  const advice = getAdvice(edpi, game);
  if (!advice) return;
  Toast.notify({
    message: `Tactical advice: ${advice}`,
    type: "info",
    duration: 6000,
  });
}

function hideSensSuggestion() {
  lastTacticalAdviceKey = "";
}

function isEdpiTabVisible() {
  const edpiTab = document.getElementById("edpi-calculator-tab");
  return edpiTab && edpiTab.style.display !== "none";
}

const LINEUP_TAB_ENABLED = true;

const TAB_SLUGS = {
  "sensitivity-converter-tab": "sensitivity-converter",
  "edpi-calculator-tab": "edpi-calculator",
  "crosshair-converter-tab": "crosshair-converter",
  "viewmodel-generator-tab": "viewmodel-generator",
  "settings-tab": "settings",
  "stats-tab": "stats",
  "lineup-tab": "lineups",
  "aim-training-tab": "aim-training",
  "keybinds-tab": "keybinds",
  "updates-tab": "updates",
  "privacy-policy-tab": "privacy-policy",
  "terms-of-service-tab": "terms-of-service",
  "credit-tab": "credit",
};
const SLUG_TO_TAB = Object.fromEntries(Object.entries(TAB_SLUGS).map(([tabId, slug]) => [slug, tabId]));
const DEFAULT_TAB_ID = "sensitivity-converter-tab";
let isInitialRoute = true;

function getAppBasePath() {
  const script = document.querySelector('script[src*="script.js"]');
  const src = script?.getAttribute("src") || "script.js";
  try {
    const { pathname } = new URL(src, window.location.href);
    const base = pathname.replace(/\/?script\.js$/i, "");
    return base.endsWith("/") ? base : `${base}/`;
  } catch {
    return "/";
  }
}

function getTabSlugFromPath() {
  const base = getAppBasePath().replace(/\/$/, "");
  let path = window.location.pathname;
  if (base && path.startsWith(base)) {
    path = path.slice(base.length);
  }
  path = path.replace(/^\/+|\/+$/g, "");
  if (!path || path === "index.html") return "";
  return path.split("/")[0];
}

function getTabIdFromPath() {
  const slug = getTabSlugFromPath();
  if (!slug) return DEFAULT_TAB_ID;
  if (!LINEUP_TAB_ENABLED && slug === TAB_SLUGS["lineup-tab"]) return DEFAULT_TAB_ID;
  return SLUG_TO_TAB[slug] || DEFAULT_TAB_ID;
}

function getCurrentTabId() {
  for (const tabId of Object.keys(TAB_SLUGS)) {
    const section = document.getElementById(tabId);
    if (section && section.style.display !== "none") return tabId;
  }
  return DEFAULT_TAB_ID;
}

function syncUrlToTab(id, { replace = false, keepSearch = false } = {}) {
  const slug = TAB_SLUGS[id];
  if (!slug) return;

  const base = getAppBasePath().replace(/\/$/, "");
  const nextPath = `${base}/${slug}`;
  const search = keepSearch ? window.location.search : "";
  const nextUrl = `${nextPath}${search}${window.location.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (currentUrl === nextUrl || `${currentUrl}/` === nextUrl || currentUrl === `${nextUrl}/`) return;

  const state = { tab: id };
  if (replace) history.replaceState(state, "", nextUrl);
  else history.pushState(state, "", nextUrl);
}

function initTabRouting() {
  switchTab(null, getTabIdFromPath(), { updateHistory: false });

  window.addEventListener("popstate", () => {
    switchTab(null, getTabIdFromPath(), { updateHistory: false });
  });
}

const FOOTER_TAB_IDS = new Set(["keybinds-tab", "updates-tab", "privacy-policy-tab", "terms-of-service-tab", "credit-tab"]);

const MISC_TAB_IDS = new Set(["crosshair-converter-tab", "viewmodel-generator-tab"]);

const MISC_HOTKEY_TAB_ORDER = ["crosshair-converter-tab", "viewmodel-generator-tab"];
const MORE_HOTKEY_TAB_ORDER = ["keybinds-tab", "updates-tab", "privacy-policy-tab", "terms-of-service-tab", "credit-tab"];

const FOOTER_BUTTON_IDS = {
  "keybinds-tab": "keybinds-button",
  "updates-tab": "updates-button",
  "privacy-policy-tab": "privacy-policy-button",
  "terms-of-service-tab": "terms-of-service-button",
  "credit-tab": "credit-button",
};

const NAV_BUTTON_IDS = {
  "sensitivity-converter-tab": "sensitivity-converter-button",
  "edpi-calculator-tab": "edpi-calculator-button",
  "settings-tab": "settings-button",
  "stats-tab": "stats-button",
  "lineup-tab": "lineup-button",
  "aim-training-tab": "aim-training-button",
};

const LOGO_CYCLE_TAB_IDS = ["sensitivity-converter-tab", "edpi-calculator-tab", "crosshair-converter-tab", "viewmodel-generator-tab", "settings-tab", "stats-tab", "aim-training-tab", "lineup-tab", "keybinds-tab", "updates-tab", "privacy-policy-tab", "terms-of-service-tab", "credit-tab"];

function getLogoCycleTabIds() {
  return LOGO_CYCLE_TAB_IDS.filter((id) => {
    if (id === "lineup-tab" && !LINEUP_TAB_ENABLED) return false;
    if (id === "aim-training-tab" && isMobileViewport()) return false;
    return Boolean(document.getElementById(id));
  });
}

function cycleTabFromLogo(event) {
  event?.preventDefault();
  const ids = getLogoCycleTabIds();
  if (!ids.length) return;

  const current = getCurrentTabId();
  const currentIndex = ids.indexOf(current);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % ids.length;
  const nextId = ids[nextIndex];

  switchTab(event, nextId);
  if (FOOTER_TAB_IDS.has(nextId)) scrollToTop(350);
}

function closeMobileNavMiscMenu() {
  const dropdown = document.getElementById("nav-misc-dropdown");
  const toggle = document.getElementById("nav-misc-toggle");
  const menu = document.getElementById("nav-misc-menu");
  dropdown?.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
  if (menu) menu.hidden = true;
}

function closeMobileNavMoreMenu() {
  const dropdown = document.getElementById("nav-more-dropdown");
  const toggle = document.getElementById("nav-more-toggle");
  const menu = document.getElementById("nav-more-menu");
  dropdown?.classList.remove("is-open");
  toggle?.setAttribute("aria-expanded", "false");
  if (menu) menu.hidden = true;
}

function closeMobileNavMenu() {
  const navContainer = document.querySelector(".nav-menu-container");
  const mobileMenuBtn = document.getElementById("mobile-menu-toggle");
  navContainer?.classList.remove("active");
  mobileMenuBtn?.setAttribute("aria-expanded", "false");
  closeMobileNavMoreMenu();
  closeMobileNavMiscMenu();
}

function setMobileNavMiscOpen(open) {
  const dropdown = document.getElementById("nav-misc-dropdown");
  const toggle = document.getElementById("nav-misc-toggle");
  const menu = document.getElementById("nav-misc-menu");
  if (!dropdown || !toggle || !menu) return;
  if (open) closeMobileNavMoreMenu();
  dropdown.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  menu.hidden = !open;
}

function setMobileNavMoreOpen(open) {
  const dropdown = document.getElementById("nav-more-dropdown");
  const toggle = document.getElementById("nav-more-toggle");
  const menu = document.getElementById("nav-more-menu");
  if (!dropdown || !toggle || !menu) return;
  if (open) closeMobileNavMiscMenu();
  dropdown.classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  menu.hidden = !open;
}

function initMobileNavMiscMenu() {
  const toggle = document.getElementById("nav-misc-toggle");
  if (!toggle) return;

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = document.getElementById("nav-misc-menu");
    setMobileNavMiscOpen(menu?.hidden ?? true);
  });
}

function initMobileNavMoreMenu() {
  const toggle = document.getElementById("nav-more-toggle");
  if (!toggle) return;

  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = document.getElementById("nav-more-menu");
    setMobileNavMoreOpen(menu?.hidden ?? true);
  });
}

const LINEUP_GAME_STORAGE_KEY = "lineupGame";
const LINEUP_SIDE_STORAGE_KEY = "lineupSide";
const LINEUP_DIFFICULTY_STORAGE_KEY = "lineupDifficulty";
const LINEUP_MAP_STORAGE_PREFIX = "lineupMap:";
const LINEUP_SEARCH_STORAGE_PREFIX = "lineupSearch:";
const LINEUP_GAMES = new Set(["valorant", "cs2"]);
const LINEUP_GAME_OPTIONS = {
  valorant: {
    label: "Valorant",
    gameName: "Valorant",
    get iconSrc() {
      return getGameIconSrc("Valorant");
    },
  },
  cs2: {
    label: "CS2",
    gameName: "CS2",
    get iconSrc() {
      return getGameIconSrc("CS2");
    },
  },
};
const LINEUP_SIDES = new Set(["all", "attacker", "defender"]);
const LINEUP_DIFFICULTY_LEVELS = ["1", "2", "3", "4", "5"];
const LINEUP_MAPS = {
  valorant: ["Abyss", "Ascent", "Bind", "Breeze", "Corrode", "Fracture", "Haven", "Icebox", "Lotus", "Pearl", "Summit", "Sunset"],
  cs2: ["Alpine", "Ancient", "Anubis", "Cache", "Dust II", "Inferno", "Italy", "Mirage", "Nuke", "Office", "Overpass", "Stronghold", "Train", "Vertigo", "Warden"],
};

/** CS2 utility badge icons (smoke, molotov, incendiary, HE, flashbang). */
const LINEUP_CS2_UTILITIES = new Set(["smoke", "molotov", "incendiary", "he", "flashbang"]);
const LINEUP_CS2_UTILITY_ICONS = {
  smoke: "assets/lineup-utilities/cs2/smoke.png",
  molotov: "assets/lineup-utilities/cs2/molotov.png",
  incendiary: "assets/lineup-utilities/cs2/incendiary.png",
  he: "assets/lineup-utilities/cs2/he.png",
  flashbang: "assets/lineup-utilities/cs2/flashbang.png",
};
const LINEUP_CS2_SIDE_ICONS = {
  attacker: "assets/lineup-utilities/cs2/t.svg",
  defender: "assets/lineup-utilities/cs2/ct.svg",
};
const LINEUP_CS2_SIDE_LABELS = {
  attacker: "T",
  defender: "CT",
};
const LINEUP_CS2_UTILITY_LABELS = {
  smoke: "Smoke grenade",
  molotov: "Molotov",
  incendiary: "Incendiary grenade",
  he: "HE grenade",
  flashbang: "Flashbang",
};
const LINEUP_CS2_UTILITY_DESCRIPTIONS = {
  smoke: "Throws a smoke cloud that blocks vision. Use it to cross open areas safely, take map control, isolate angles, or execute onto a site by smoking common holding spots and one-ways.",
  molotov: "Creates a fire pool that damages players over time and blocks paths. Use it to clear tight angles, force enemies out of cover, delay retakes, or cut off rotations after taking space.",
  incendiary: "CT fire grenade that burns an area and denies movement. Use it to stop bomb plants, clear close corners like Banana or Apps, stall rushes, or punish enemies stacking a position.",
  he: "Explodes on impact for splash damage. Use it before peeking to soften enemies, finish low-health opponents, or chip common off-angles and boost spots so fights start in your favor.",
  flashbang: "Blinds players facing the burst. Pop it around corners before peeking to take duels, entry a site, or retake while enemies are white-screened. Bounce flashes to catch multiple angles.",
};

/** Valorant agent icons (valorant-api.com display icons). */
const LINEUP_VALORANT_AGENT_ICONS = {
  astra: "https://media.valorant-api.com/agents/41fb69c1-4189-7b37-f117-bcaf1e96f1bf/displayicon.png",
  breach: "https://media.valorant-api.com/agents/5f8d3a7f-467b-97f3-062c-13acf203c006/displayicon.png",
  brimstone: "https://media.valorant-api.com/agents/9f0d8ba9-4140-b941-57d3-a7ad57c6b417/displayicon.png",
  chamber: "https://media.valorant-api.com/agents/22697a3d-45bf-8dd7-4fec-84a9e28c69d7/displayicon.png",
  clove: "https://media.valorant-api.com/agents/1dbf2edd-4729-0984-3115-daa5eed44993/displayicon.png",
  cypher: "https://media.valorant-api.com/agents/117ed9e3-49f3-6512-3ccf-0cada7e3823b/displayicon.png",
  deadlock: "https://media.valorant-api.com/agents/cc8b64c8-4b25-4ff9-6e7f-37b4da43d235/displayicon.png",
  fade: "https://media.valorant-api.com/agents/dade69b4-4f5a-8528-247b-219e5a1facd6/displayicon.png",
  gekko: "https://media.valorant-api.com/agents/e370fa57-4757-3604-3648-499e1f642d3f/displayicon.png",
  harbor: "https://media.valorant-api.com/agents/95b78ed7-4637-86d9-7e41-71ba8c293152/displayicon.png",
  iso: "https://media.valorant-api.com/agents/0e38b510-41a8-5780-5e8f-568b2a4f2d6c/displayicon.png",
  jett: "https://media.valorant-api.com/agents/add6443a-41bd-e414-f6ad-e58d267f4e95/displayicon.png",
  kayo: "https://media.valorant-api.com/agents/601dbbe7-43ce-be57-2a40-4abd24953621/displayicon.png",
  killjoy: "https://media.valorant-api.com/agents/1e58de9c-4950-5125-93e9-a0aee9f98746/displayicon.png",
  miks: "https://media.valorant-api.com/agents/7c8a4701-4de6-9355-b254-e09bc2a34b72/displayicon.png",
  neon: "https://media.valorant-api.com/agents/bb2a4828-46eb-8cd1-e765-15848195d751/displayicon.png",
  omen: "https://media.valorant-api.com/agents/8e253930-4c05-31dd-1b6c-968525494517/displayicon.png",
  phoenix: "https://media.valorant-api.com/agents/eb93336a-449b-9c1b-0a54-a891f7921d69/displayicon.png",
  raze: "https://media.valorant-api.com/agents/f94c3b30-42be-e959-889c-5aa313dba261/displayicon.png",
  reyna: "https://media.valorant-api.com/agents/a3bfb853-43b2-7238-a4f1-ad90e9e46bcc/displayicon.png",
  sage: "https://media.valorant-api.com/agents/569fdd95-4d10-43ab-ca70-79becc718b46/displayicon.png",
  skye: "https://media.valorant-api.com/agents/6f2a04ca-43e0-be17-7f36-b3908627744d/displayicon.png",
  sova: "https://media.valorant-api.com/agents/320b2a48-4d9b-a075-30f1-1f93a9b638fa/displayicon.png",
  tejo: "https://media.valorant-api.com/agents/b444168c-4e35-8076-db47-ef9bf368f384/displayicon.png",
  veto: "https://media.valorant-api.com/agents/92eeef5d-43b5-1d4a-8d03-b3927a09034b/displayicon.png",
  viper: "https://media.valorant-api.com/agents/707eab51-4836-f488-046a-cda6bf494859/displayicon.png",
  vyse: "https://media.valorant-api.com/agents/efba5359-4016-a1e5-7626-b1ae76895940/displayicon.png",
  waylay: "https://media.valorant-api.com/agents/df1cb487-4902-002e-5c17-d28e83e78588/displayicon.png",
  yoru: "https://media.valorant-api.com/agents/7f94d92c-4234-0a36-9646-3a87eb8b5c89/displayicon.png",
};
const LINEUP_VALORANT_AGENT_LABELS = {
  kayo: "KAY/O",
};

const LINEUP_VALORANT_UTILITIES = new Set(["smoke", "flash", "molly", "recon"]);
const LINEUP_VALORANT_UTILITY_ICONS = {
  smoke: "assets/lineup-utilities/valorant/smoke.png",
  flash: "assets/lineup-utilities/valorant/flash.png",
  molly: "assets/lineup-utilities/valorant/molly.png",
  recon: "assets/lineup-utilities/valorant/recon.png",
};
const LINEUP_VALORANT_UTILITY_LABELS = {
  smoke: "Smoke",
  flash: "Flash",
  molly: "Molly",
  recon: "Recon",
};

/** Valorant agent ability icons for lineup embed badges (agent:ability slug). */
const LINEUP_VALORANT_ABILITY_ALIASES = {
  "snare-trap": "chokehold",
  trap: "chokehold",
};
const LINEUP_VALORANT_ABILITY_ICONS = {
  "veto:chokehold": {
    src: "https://media.valorant-api.com/agents/92eeef5d-43b5-1d4a-8d03-b3927a09034b/abilities/ability1/displayicon.png",
    label: "Chokehold",
    description: "EQUIP a viscous fragment of your mutation. FIRE to throw. The fragment deploys upon hitting the ground, creating a trap to hold enemies in place. Held enemies are Deafened, and Decayed. Enemies can destroy the trap before activation.",
    slot: "Ability 1",
  },
};

const lineupValorantAgentInfoCache = new Map();
const lineupValorantAbilityInfoCache = new Map();
const lineupValorantAgentBundleCache = new Map();

const LINEUP_VALORANT_ABILITY_SLOT_LABELS = {
  Ability1: "Ability 1",
  Ability2: "Ability 2",
  Grenade: "Grenade",
  Ultimate: "Ultimate",
  Passive: "Passive",
};

/** Map icon URLs keyed by game and map slug (Valorant API + MurkyYT/cs2-map-icons). */
const CS2_MAP_ICON_BASE = "https://raw.githubusercontent.com/MurkyYT/cs2-map-icons/main/images";
const LINEUP_MAP_ICONS = {
  cs2: {
    alpine: `${CS2_MAP_ICON_BASE}/cs_alpine.png`,
    ancient: `${CS2_MAP_ICON_BASE}/de_ancient.png`,
    anubis: `${CS2_MAP_ICON_BASE}/de_anubis.png`,
    cache: `${CS2_MAP_ICON_BASE}/de_cache.png`,
    "dust-ii": `${CS2_MAP_ICON_BASE}/de_dust2.png`,
    inferno: `${CS2_MAP_ICON_BASE}/de_inferno.png`,
    italy: `${CS2_MAP_ICON_BASE}/cs_italy.png`,
    mirage: `${CS2_MAP_ICON_BASE}/de_mirage.png`,
    nuke: `${CS2_MAP_ICON_BASE}/de_nuke.png`,
    office: `${CS2_MAP_ICON_BASE}/cs_office.png`,
    overpass: `${CS2_MAP_ICON_BASE}/de_overpass.png`,
    stronghold: `${CS2_MAP_ICON_BASE}/de_stronghold.png`,
    train: `${CS2_MAP_ICON_BASE}/de_train.png`,
    vertigo: `${CS2_MAP_ICON_BASE}/de_vertigo.png`,
    warden: `${CS2_MAP_ICON_BASE}/de_warden.png`,
  },
  valorant: {
    abyss: "https://media.valorant-api.com/maps/224b0a95-48b9-f703-1bd8-67aca101a61f/displayicon.png",
    ascent: "https://media.valorant-api.com/maps/7eaecc1b-4337-bbf6-6ab9-04b8f06b3319/displayicon.png",
    bind: "https://media.valorant-api.com/maps/2c9d57ec-4431-9c5e-2939-8f9ef6dd5cba/displayicon.png",
    breeze: "https://media.valorant-api.com/maps/2fb9a4fd-47b8-4e7d-a969-74b4046ebd53/displayicon.png",
    corrode: "https://media.valorant-api.com/maps/1c18ab1f-420d-0d8b-71d0-77ad3c439115/displayicon.png",
    fracture: "https://media.valorant-api.com/maps/b529448b-4d60-346e-e89e-00a4c527a405/displayicon.png",
    haven: "https://media.valorant-api.com/maps/2bee0dc9-4ffe-519b-1cbd-7fbe763a6047/displayicon.png",
    icebox: "https://media.valorant-api.com/maps/e2ad5c54-4114-a870-9641-8ea21279579a/displayicon.png",
    lotus: "https://media.valorant-api.com/maps/2fe4ed3a-450a-948b-6d6b-e89a78e680a9/displayicon.png",
    pearl: "https://media.valorant-api.com/maps/fd267378-4d1d-484f-ff52-77821ed10dc2/displayicon.png",
    summit: "https://media.valorant-api.com/maps/756da597-416b-c0f2-f47b-afbdf28670bc/displayicon.png",
    sunset: "https://media.valorant-api.com/maps/92584fbe-486a-b1b2-9faa-39b0f486b498/displayicon.png",
  },
};

/** Map callout names used for keyword chips and title parsing (longest match first). */
const LINEUP_MAP_CALLOUTS = {
  cs2: {
    mirage: ["Window", "Connector", "Bench", "Jungle", "Stairs", "Palace", "Catwalk", "Apartments", "Underpass", "Ticket", "Top Mid", "A Site", "B Site", "Short", "Market", "Van", "Con", "CT"],
    "dust-ii": ["Long", "Short", "Cat", "B Tunnels", "Mid Doors", "Xbox", "Pit", "A Site", "B Site"],
    inferno: ["Banana", "Pit", "Library", "Apps", "Apartments", "A Site", "B Site", "Mid", "Arch"],
    ancient: ["A Main", "B Main", "Mid", "Donut", "Temple", "Cave", "A Site", "B Site"],
    anubis: ["A Main", "B Main", "Mid", "Canal", "Heaven", "A Site", "B Site"],
    nuke: ["Ramp", "Secret", "Heaven", "Hell", "Outside", "A Site", "B Site"],
    overpass: ["Monster", "Short", "Long", "Heaven", "Bathrooms", "A Site", "B Site"],
    vertigo: ["A Ramp", "B Ramp", "Mid", "Scaffold", "A Site", "B Site"],
  },
  valorant: {
    bind: ["A Short", "A Long", "B Long", "B Short", "Hookah", "Showers", "U-Hall", "Heaven", "A Site", "B Site"],
    haven: ["A Long", "A Short", "C Long", "Garage", "Heaven", "A Site", "B Site", "C Site"],
    ascent: ["A Main", "B Main", "Mid", "Market", "Wine", "Tree", "Heaven", "A Site", "B Site"],
    split: ["A Main", "B Main", "Mid", "Heaven", "Mail", "Vents", "A Site", "B Site"],
    lotus: ["A Main", "B Main", "C Main", "A Rope", "B Rope", "Top Mid", "A Site", "B Site", "C Site"],
    pearl: ["B Push", "A Main", "B Main", "Mid", "Art", "Docks", "Tunnel", "Heaven", "A Site", "B Site"],
  },
};

function shuffleArray(items) {
  const list = [...items];
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function getLineupVideoId(card) {
  return card?.dataset.lineupVideoId?.trim() || "";
}

function resolveAppAssetUrl(path) {
  if (!path) return "";
  if (/^(https?:|data:|blob:)/i.test(path)) return path;
  const clean = String(path).replace(/^\.\//, "").replace(/^\//, "");
  return `${getAppBasePath()}${clean}`;
}

function getLineupVideoAssetPath(card) {
  const direct = card?.dataset.lineupVideoUrl?.trim();
  if (direct) return resolveAppAssetUrl(direct);

  const id = getLineupVideoId(card);
  if (!id) return "";

  const game = getLineupGameForCard(card);
  const map = (card?.dataset.lineupMap || "").toLowerCase();
  if (!game || !map) return "";

  return resolveAppAssetUrl(`assets/lineups/${game}/${map}/${id}.mp4`);
}

function getLineupVideoUrl(card) {
  return getLineupVideoAssetPath(card);
}

const LINEUP_VIDEO_SPEED_STORAGE_KEY = "lineup-video-speed";
const LINEUP_VIDEO_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const lineupVideoModalState = {
  baseUrl: "",
  speed: 1,
  shouldAutoplay: false,
};

function attemptLineupVideoAutoplay(player, { resumeTime = 0 } = {}) {
  if (!player || player.hidden || !lineupVideoModalState.shouldAutoplay) return;

  if (resumeTime > 0 && Number.isFinite(player.duration)) {
    player.currentTime = Math.min(resumeTime, player.duration);
  }

  if (player.paused) {
    player.play().catch(() => {});
  }

  syncLineupVideoControlsUi();
  syncLineupVideoOptionsUi();
}

function bindLineupVideoAutoplayEvents(player, { resumeTime = 0 } = {}) {
  if (!player || player.dataset.autoplayBound === "1") return;
  player.dataset.autoplayBound = "1";

  const boot = () => attemptLineupVideoAutoplay(player, { resumeTime });

  player.addEventListener("loadedmetadata", boot);
  player.addEventListener("loadeddata", boot);
  player.addEventListener("canplay", boot);
  player.addEventListener("canplaythrough", boot);
}

function getStoredLineupVideoSpeed() {
  const stored = Number(localStorage.getItem(LINEUP_VIDEO_SPEED_STORAGE_KEY));
  return LINEUP_VIDEO_SPEED_OPTIONS.includes(stored) ? stored : 1;
}

function formatLineupVideoSpeedLabel(speed) {
  if (speed === 1) return "Normal";
  return `${speed}×`;
}

function isLineupVideoOptionsMenuOpen() {
  const menu = document.getElementById("lineup-video-options-menu");
  return !!menu && !menu.classList.contains("hidden");
}

function closeLineupVideoOptionsMenu() {
  const menu = document.getElementById("lineup-video-options-menu");
  const btn = document.getElementById("lineup-video-options-btn");
  if (!menu || menu.classList.contains("hidden")) return false;

  menu.classList.add("hidden");
  btn?.setAttribute("aria-expanded", "false");
  return true;
}

function openLineupVideoOptionsMenu() {
  const menu = document.getElementById("lineup-video-options-menu");
  const btn = document.getElementById("lineup-video-options-btn");
  if (!menu || !btn) return;

  menu.classList.remove("hidden");
  btn.setAttribute("aria-expanded", "true");
}

function syncLineupVideoOptionsUi() {
  const speedList = document.getElementById("lineup-video-speed-list");
  if (!speedList) return;

  speedList.querySelectorAll("[data-lineup-speed]").forEach((btn) => {
    const speed = Number(btn.dataset.lineupSpeed);
    const active = speed === lineupVideoModalState.speed;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-checked", active ? "true" : "false");
  });
}

function setLineupVideoSpeed(speed) {
  const player = document.getElementById("lineup-video-modal-player");
  if (!player || player.hidden) return;

  lineupVideoModalState.speed = speed;
  localStorage.setItem(LINEUP_VIDEO_SPEED_STORAGE_KEY, String(speed));
  player.playbackRate = speed;
  syncLineupVideoOptionsUi();
}

function loadLineupVideoModalSource(url, { resumeTime = 0, autoplay = true } = {}) {
  const player = document.getElementById("lineup-video-modal-player");
  if (!player || !url) return false;

  lineupVideoModalState.shouldAutoplay = autoplay;
  player.onerror = null;
  player.hidden = false;
  player.src = url;
  player.playbackRate = lineupVideoModalState.speed;
  player.load();
  syncLineupVideoScrubPlayer();

  const bootPlayback = () => attemptLineupVideoAutoplay(player, { resumeTime });
  player.addEventListener("loadedmetadata", bootPlayback, { once: true });
  player.addEventListener("loadeddata", bootPlayback, { once: true });
  player.addEventListener("canplay", bootPlayback, { once: true });
  bootPlayback();
  return true;
}

function renderLineupVideoOptionsMenu() {
  const speedList = document.getElementById("lineup-video-speed-list");
  if (!speedList || speedList.dataset.rendered === "1") return;
  speedList.dataset.rendered = "1";

  speedList.innerHTML = LINEUP_VIDEO_SPEED_OPTIONS.map((speed) => {
    return `<button type="button" class="lineup-video-options-item" data-lineup-speed="${speed}" role="menuitemradio" aria-checked="false"><span class="lineup-video-options-item-label">${formatLineupVideoSpeedLabel(speed)}</span><i class="ri-check-line lineup-video-options-item-check" aria-hidden="true"></i></button>`;
  }).join("");

  speedList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-lineup-speed]");
    if (!btn) return;
    setLineupVideoSpeed(Number(btn.dataset.lineupSpeed));
  });
}

function initLineupVideoOptionsMenu() {
  renderLineupVideoOptionsMenu();

  const wrap = document.getElementById("lineup-video-options-wrap");
  const btn = document.getElementById("lineup-video-options-btn");
  if (!wrap || !btn || wrap.dataset.init === "1") return;
  wrap.dataset.init = "1";

  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    if (isLineupVideoOptionsMenuOpen()) closeLineupVideoOptionsMenu();
    else openLineupVideoOptionsMenu();
  });

  wrap.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  document.addEventListener("click", () => {
    closeLineupVideoOptionsMenu();
  });
}

function ensureLineupVideoBufferLoader(container) {
  let loader = container.querySelector(":scope > .lineup-video-buffer-loader");
  if (!loader) {
    loader = document.createElement("div");
    loader.className = "lineup-video-buffer-loader";
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-label", "Loading video");
    container.appendChild(loader);
  }
  return loader;
}

function setLineupVideoBuffering(container, on) {
  if (!container) return;
  container.classList.toggle("is-buffering", on);
}

function bindLineupVideoBufferUi(video, container) {
  if (!video || !container || video.dataset.bufferBound === "1") return;
  video.dataset.bufferBound = "1";
  ensureLineupVideoBufferLoader(container);
  if (container.classList.contains("lineup-video-embed")) {
    ensureLineupVideoEmbedProgress(container);
  }

  let hideTimer = 0;

  const kickProgress = () => startLineupVideoProgressLoop();

  const showBuffering = () => {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = 0;
    }
    setLineupVideoBuffering(container, true);
  };

  const hideBuffering = () => {
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hideTimer = 0;
      setLineupVideoBuffering(container, false);
    }, 120);
  };

  video.addEventListener("loadstart", showBuffering);
  video.addEventListener("waiting", showBuffering);
  video.addEventListener("seeking", showBuffering);
  video.addEventListener("stalled", showBuffering);
  video.addEventListener("playing", hideBuffering);
  video.addEventListener("canplay", hideBuffering);
  video.addEventListener("canplaythrough", hideBuffering);
  video.addEventListener("loadeddata", hideBuffering);
  video.addEventListener("seeked", hideBuffering);
  video.addEventListener("error", () => setLineupVideoBuffering(container, false));
  video.addEventListener("emptied", () => setLineupVideoBuffering(container, false));
  video.addEventListener("progress", kickProgress);
  video.addEventListener("loadedmetadata", kickProgress);
  video.addEventListener("loadeddata", kickProgress);
}

function applyLineupVideoSources(root = document) {
  const scope = root?.querySelectorAll ? root : document;
  scope.querySelectorAll(".lineup-video-card").forEach((card) => {
    const url = getLineupVideoUrl(card);
    const embed = card.querySelector(".lineup-video-embed");
    const preview = embed?.querySelector("video.lineup-video-preview");
    if (!embed) return;

    ensureLineupVideoEmbedProgress(embed);
    card.classList.toggle("lineup-video-card--no-source", !url);

    if (!url || !preview) {
      preview?.removeAttribute("src");
      if (preview) preview.hidden = false;
      setLineupVideoBuffering(embed, false);
      return;
    }

    preview.hidden = false;
    preview.muted = true;
    preview.playsInline = true;
    preview.preload = "metadata";
    const absoluteUrl = new URL(url, window.location.href).href;
    if (preview.src !== absoluteUrl) {
      preview.src = url;
      preview.load();
    }
    bindLineupVideoBufferUi(preview, embed);
  });

  enhanceLineupVideoCardFoots(scope);
}

function getLineupVideoTitle(card) {
  return card.querySelector(".lineup-video-title")?.textContent?.trim() || "";
}

function lineupAgentToSlug(name) {
  return name.trim().toLowerCase().replace(/\//g, "").replace(/\s+/g, "");
}

function lineupValorantAgentLabel(slug) {
  if (LINEUP_VALORANT_AGENT_LABELS[slug]) return LINEUP_VALORANT_AGENT_LABELS[slug];
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function getLineupValorantAgent(card) {
  const explicit = card.dataset.lineupAgent?.trim().toLowerCase();
  if (explicit && LINEUP_VALORANT_AGENT_ICONS[explicit]) return explicit;

  const haystack = [card.dataset.lineupVideoId, card.dataset.lineupSearch, getLineupVideoTitle(card)].filter(Boolean).join(" ").toLowerCase();

  const agents = Object.keys(LINEUP_VALORANT_AGENT_ICONS).sort((a, b) => b.length - a.length);
  for (const slug of agents) {
    const pattern = slug === "kayo" ? /\b(?:kayo|kay\/o)\b/ : new RegExp(`\\b${slug}\\b`);
    if (pattern.test(haystack)) return slug;
  }
  return null;
}

function getLineupValorantUtility(card) {
  const explicit = card.dataset.lineupUtility?.trim().toLowerCase();
  if (explicit && LINEUP_VALORANT_UTILITIES.has(explicit)) return explicit;

  const haystack = [card.dataset.lineupVideoId, card.dataset.lineupSearch, getLineupVideoTitle(card)].filter(Boolean).join(" ").toLowerCase();

  if (/\b(?:recon|dart|bolt|owl)\b/.test(haystack)) return "recon";
  if (/\b(?:molly|incendiary|fire|burn)\b/.test(haystack)) return "molly";
  if (/\b(?:flash|blind|paranoia|guiding)\b/.test(haystack)) return "flash";
  if (/\b(?:smoke|dark cover|sky smoke|cloud)\b/.test(haystack)) return "smoke";
  return null;
}

function getLineupCardUtility(card) {
  const game = getLineupGameForCard(card);
  if (game === "cs2") return getLineupCs2Utility(card);
  if (game === "valorant") return getLineupValorantUtility(card);
  return null;
}

function resolveCs2UtilityIconKey(card, utility) {
  if (utility !== "molotov" && utility !== "incendiary") return utility;

  const side = (card.dataset.lineupSide || "").toLowerCase();
  if (side === "defender") return "incendiary";
  if (side === "attacker") return "molotov";
  return utility;
}

function getLineupUtilityIconSrc(game, utility, card) {
  if (!utility) return null;
  let path = null;
  if (game === "cs2") {
    const key = resolveCs2UtilityIconKey(card, utility);
    path = LINEUP_CS2_UTILITY_ICONS[key] || null;
  } else if (game === "valorant") {
    path = LINEUP_VALORANT_UTILITY_ICONS[utility] || null;
  }
  return path ? resolveAppAssetUrl(path) : null;
}

function getLineupUtilityLabel(game, utility, card) {
  if (!utility) return "";
  if (game === "cs2") {
    const key = resolveCs2UtilityIconKey(card, utility);
    return LINEUP_CS2_UTILITY_LABELS[key] || utility;
  }
  if (game === "valorant") return LINEUP_VALORANT_UTILITY_LABELS[utility] || utility;
  return utility;
}

function renderLineupVideoCardMapIcon(card) {
  const foot = card.querySelector(".lineup-video-card-foot");
  if (!foot) return;

  let iconWrap = foot.querySelector(".lineup-video-card-foot-icon");
  let body = foot.querySelector(".lineup-video-card-foot-body");

  if (!body) {
    body = document.createElement("div");
    body.className = "lineup-video-card-foot-body";
    while (foot.firstChild) body.appendChild(foot.firstChild);
    foot.appendChild(body);
  }

  if (!iconWrap) {
    iconWrap = document.createElement("div");
    iconWrap.className = "lineup-video-card-foot-icon";
    iconWrap.setAttribute("aria-hidden", "true");
    foot.insertBefore(iconWrap, body);
  }

  const game = getLineupGameForCard(card);
  const mapSlug = (card.dataset.lineupMap || "").toLowerCase();
  const src = getLineupMapIconSrc(game, mapSlug);
  const iconTitle = lineupMapFromSlug(mapSlug, game) || mapSlug;

  if (src) {
    iconWrap.innerHTML = `<img src="${src}" alt="" loading="lazy" decoding="async" />`;
    iconWrap.classList.add("has-map-image");
  } else {
    iconWrap.innerHTML = '<i class="ri-map-2-line" aria-hidden="true"></i>';
    iconWrap.classList.remove("has-map-image");
  }

  if (iconTitle) iconWrap.title = iconTitle;
}

function getLineupValorantAbilityInfo(card) {
  const agent = getLineupValorantAgent(card);
  if (!agent) return null;

  let ability = card.dataset.lineupAbility?.trim().toLowerCase();
  if (!ability) return null;

  ability = LINEUP_VALORANT_ABILITY_ALIASES[ability] || ability;
  const entry = LINEUP_VALORANT_ABILITY_ICONS[`${agent}:${ability}`];
  if (!entry) return null;

  return { agent, ability, ...entry };
}

function getValorantAgentUuid(slug) {
  const icon = LINEUP_VALORANT_AGENT_ICONS[slug];
  return icon?.match(/\/agents\/([^/]+)\//)?.[1] || null;
}

function lineupValorantAbilitySlotLabel(slot) {
  return LINEUP_VALORANT_ABILITY_SLOT_LABELS[slot] || slot || "";
}

async function fetchValorantAgentBundle(agentSlug) {
  if (lineupValorantAgentBundleCache.has(agentSlug)) {
    return lineupValorantAgentBundleCache.get(agentSlug);
  }

  const uuid = getValorantAgentUuid(agentSlug);
  if (!uuid) return null;

  const response = await fetch(`https://valorant-api.com/v1/agents/${uuid}`);
  if (!response.ok) return null;

  const payload = await response.json();
  const data = payload?.data;
  if (!data) return null;

  lineupValorantAgentBundleCache.set(agentSlug, data);
  return data;
}

async function getValorantAgentInfo(agentSlug) {
  if (lineupValorantAgentInfoCache.has(agentSlug)) {
    return lineupValorantAgentInfoCache.get(agentSlug);
  }

  const data = await fetchValorantAgentBundle(agentSlug);
  if (!data) return null;

  const info = {
    name: data.displayName || lineupValorantAgentLabel(agentSlug),
    role: data.role?.displayName || "",
    description: data.description || "",
    icon: data.displayIcon || LINEUP_VALORANT_AGENT_ICONS[agentSlug] || "",
  };

  lineupValorantAgentInfoCache.set(agentSlug, info);
  return info;
}

function resolveValorantAbilityFromBundle(bundle, abilitySlug) {
  const resolved = LINEUP_VALORANT_ABILITY_ALIASES[abilitySlug] || abilitySlug;
  const normalized = resolved.toLowerCase();

  return bundle.abilities?.find((ability) => ability.displayName?.toLowerCase().replace(/\s+/g, "-") === normalized) || bundle.abilities?.find((ability) => ability.displayName?.toLowerCase() === normalized.replace(/-/g, " ")) || null;
}

async function getValorantAbilityInfo(agentSlug, abilitySlug) {
  const cacheKey = `${agentSlug}:${abilitySlug}`;
  if (lineupValorantAbilityInfoCache.has(cacheKey)) {
    return lineupValorantAbilityInfoCache.get(cacheKey);
  }

  const staticEntry = LINEUP_VALORANT_ABILITY_ICONS[`${agentSlug}:${LINEUP_VALORANT_ABILITY_ALIASES[abilitySlug] || abilitySlug}`];
  const bundle = await fetchValorantAgentBundle(agentSlug);
  const ability = bundle ? resolveValorantAbilityFromBundle(bundle, abilitySlug) : null;

  const info = {
    name: ability?.displayName || staticEntry?.label || lineupValorantAgentLabel(abilitySlug),
    slot: lineupValorantAbilitySlotLabel(ability?.slot) || staticEntry?.slot || "",
    description: ability?.description || staticEntry?.description || "",
    icon: ability?.displayIcon || staticEntry?.src || "",
    agentName: bundle?.displayName || lineupValorantAgentLabel(agentSlug),
  };

  if (!info.description && !info.icon) return staticEntry ? { ...info, ...staticEntry, name: staticEntry.label } : null;

  lineupValorantAbilityInfoCache.set(cacheKey, info);
  return info;
}

function setLineupBadgeInfoOverlayContent({ icon = "", title = "", meta = "", body = "" }) {
  const iconEl = document.getElementById("lineup-badge-info-icon");
  const titleEl = document.getElementById("lineup-badge-info-title");
  const metaEl = document.getElementById("lineup-badge-info-meta");
  const bodyEl = document.getElementById("lineup-badge-info-body");

  if (iconEl) {
    if (icon) {
      iconEl.src = icon;
      iconEl.hidden = false;
    } else {
      iconEl.removeAttribute("src");
      iconEl.hidden = true;
    }
  }
  if (titleEl) titleEl.textContent = title;
  if (metaEl) {
    metaEl.textContent = meta;
    metaEl.hidden = !meta;
  }
  if (bodyEl) bodyEl.textContent = body;
}

function openLineupBadgeInfoOverlay() {
  const overlay = document.getElementById("lineup-badge-info-overlay");
  if (!overlay) return;
  overlay.hidden = false;
  overlay.classList.add("active");
  syncBodyScrollLock();
  document.getElementById("lineup-badge-info-close")?.focus();
}

function closeLineupBadgeInfoOverlay() {
  const overlay = document.getElementById("lineup-badge-info-overlay");
  if (!overlay) return;
  overlay.classList.remove("active");
  overlay.hidden = true;
  syncBodyScrollLock();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function getLineupCs2UtilityInfo(card, utility = getLineupCardUtility(card)) {
  if (!utility) return null;
  const key = resolveCs2UtilityIconKey(card, utility);
  const description = LINEUP_CS2_UTILITY_DESCRIPTIONS[key];
  if (!description) return null;

  const iconPath = LINEUP_CS2_UTILITY_ICONS[key] || "";
  return {
    key,
    label: LINEUP_CS2_UTILITY_LABELS[key] || key,
    description,
    icon: iconPath ? resolveAppAssetUrl(iconPath) : "",
    meta: "Grenade utility",
  };
}

function openLineupCs2UtilityInfoPopover(card) {
  const info = getLineupCs2UtilityInfo(card);
  if (!info) return;

  openLineupBadgeInfoOverlay();
  setLineupBadgeInfoOverlayContent({
    icon: info.icon,
    title: info.label,
    meta: info.meta,
    body: info.description,
  });
}

async function openLineupAgentInfoPopover(agentSlug) {
  openLineupBadgeInfoOverlay();
  setLineupBadgeInfoOverlayContent({
    icon: LINEUP_VALORANT_AGENT_ICONS[agentSlug] || "",
    title: lineupValorantAgentLabel(agentSlug),
    meta: "Loading agent profile…",
    body: "",
  });

  const info = await getValorantAgentInfo(agentSlug);
  if (!info) {
    setLineupBadgeInfoOverlayContent({
      icon: LINEUP_VALORANT_AGENT_ICONS[agentSlug] || "",
      title: lineupValorantAgentLabel(agentSlug),
      meta: "",
      body: "Agent information is unavailable right now.",
    });
    return;
  }

  setLineupBadgeInfoOverlayContent({
    icon: info.icon,
    title: info.name,
    meta: info.role ? `${info.role} agent` : "Valorant agent",
    body: info.description,
  });
}

async function openLineupAbilityInfoPopover(agentSlug, abilitySlug) {
  const staticEntry = LINEUP_VALORANT_ABILITY_ICONS[`${agentSlug}:${LINEUP_VALORANT_ABILITY_ALIASES[abilitySlug] || abilitySlug}`];

  openLineupBadgeInfoOverlay();
  setLineupBadgeInfoOverlayContent({
    icon: staticEntry?.src || "",
    title: staticEntry?.label || abilitySlug,
    meta: "Loading ability details…",
    body: "",
  });

  const info = await getValorantAbilityInfo(agentSlug, abilitySlug);
  if (!info) {
    setLineupBadgeInfoOverlayContent({
      icon: staticEntry?.src || "",
      title: staticEntry?.label || abilitySlug,
      meta: staticEntry?.slot || "",
      body: staticEntry?.description || "Ability information is unavailable right now.",
    });
    return;
  }

  const metaParts = [info.slot, info.agentName ? `${info.agentName} ability` : ""].filter(Boolean);
  setLineupBadgeInfoOverlayContent({
    icon: info.icon,
    title: info.name,
    meta: metaParts.join(" · "),
    body: info.description,
  });
}

function initLineupBadgeInfoPopovers() {
  const overlay = document.getElementById("lineup-badge-info-overlay");
  const closeBtn = document.getElementById("lineup-badge-info-close");
  const lineupTab = document.getElementById("lineup-tab");
  if (!overlay || overlay.dataset.lineupBadgeInfoInit) return;
  overlay.dataset.lineupBadgeInfoInit = "1";

  closeBtn?.addEventListener("click", closeLineupBadgeInfoOverlay);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeLineupBadgeInfoOverlay();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("active")) {
      event.preventDefault();
      closeLineupBadgeInfoOverlay();
    }
  });

  lineupTab?.addEventListener("click", (event) => {
    const cs2UtilityBtn = event.target.closest(".lineup-video-utility-badge[data-lineup-cs2-utility]");
    const agentBtn = event.target.closest(".lineup-video-agent-badge[data-lineup-agent-info]");
    const abilityBtn = event.target.closest(".lineup-video-ability-badge[data-lineup-ability-agent]");
    if (!cs2UtilityBtn && !agentBtn && !abilityBtn) return;

    event.preventDefault();
    event.stopPropagation();

    if (cs2UtilityBtn) {
      const card = cs2UtilityBtn.closest(".lineup-video-card");
      if (card) openLineupCs2UtilityInfoPopover(card);
      return;
    }

    if (agentBtn) {
      openLineupAgentInfoPopover(agentBtn.dataset.lineupAgentInfo);
      return;
    }

    openLineupAbilityInfoPopover(abilityBtn.dataset.lineupAbilityAgent, abilityBtn.dataset.lineupAbilitySlug);
  });
}

function ensureLineupEmbedBadgeRow(embed) {
  let row = embed.querySelector(".lineup-video-embed-badges");
  if (!row) {
    row = document.createElement("div");
    row.className = "lineup-video-embed-badges";
    embed.appendChild(row);
  }
  return row;
}

function renderLineupValorantEmbedBadges(card) {
  const embed = card.querySelector(".lineup-video-embed");
  if (!embed) return;

  embed.querySelector(".lineup-video-agent-badge")?.remove();
  embed.querySelector(".lineup-video-ability-badge")?.remove();
  embed.querySelector(".lineup-video-embed-badges")?.remove();

  const agent = getLineupValorantAgent(card);
  const agentSrc = agent ? LINEUP_VALORANT_AGENT_ICONS[agent] : null;
  const abilityInfo = getLineupValorantAbilityInfo(card);
  if (!agentSrc && !abilityInfo) return;

  const row = ensureLineupEmbedBadgeRow(embed);

  if (agentSrc) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "lineup-video-agent-badge";
    badge.dataset.lineupAgentInfo = agent;
    badge.setAttribute("aria-label", `About ${lineupValorantAgentLabel(agent)}`);
    badge.innerHTML = `<img src="${agentSrc}" alt="" loading="lazy" decoding="async" />`;
    row.appendChild(badge);
  }

  if (abilityInfo) {
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "lineup-video-ability-badge";
    badge.dataset.lineupAbilityAgent = abilityInfo.agent;
    badge.dataset.lineupAbilitySlug = abilityInfo.ability;
    badge.setAttribute("aria-label", `About ${abilityInfo.label}`);
    badge.innerHTML = `<img src="${abilityInfo.src}" alt="" loading="lazy" decoding="async" />`;
    row.appendChild(badge);
  }
}

function renderLineupVideoAgentBadge(card) {
  const game = getLineupGameForCard(card);
  const embed = card.querySelector(".lineup-video-embed");
  if (!embed) return;

  if (game === "valorant") {
    embed.querySelector(".lineup-video-side-badge")?.remove();
    renderLineupValorantEmbedBadges(card);
    return;
  }

  if (game !== "cs2") {
    embed.querySelector(".lineup-video-embed-badges")?.remove();
    embed.querySelector(".lineup-video-agent-badge")?.remove();
    embed.querySelector(".lineup-video-ability-badge")?.remove();
    embed.querySelector(".lineup-video-side-badge")?.remove();
  }
}

function renderLineupCs2EmbedBadges(card) {
  const embed = card.querySelector(".lineup-video-embed");
  if (!embed) return;

  embed.querySelectorAll(":scope > .lineup-video-utility-badge, :scope > .lineup-video-side-badge").forEach((el) => el.remove());
  embed.querySelector(".lineup-video-agent-badge")?.remove();
  embed.querySelector(".lineup-video-ability-badge")?.remove();

  const utility = getLineupCardUtility(card);
  const utilitySrc = getLineupUtilityIconSrc("cs2", utility, card);
  const side = (card.dataset.lineupSide || "").toLowerCase();
  const sidePath = LINEUP_CS2_SIDE_ICONS[side];

  if (!utilitySrc && !sidePath) {
    embed.querySelector(".lineup-video-embed-badges")?.remove();
    return;
  }

  const row = ensureLineupEmbedBadgeRow(embed);
  row.classList.add("lineup-video-embed-badges--cs2");
  row.replaceChildren();

  if (utilitySrc) {
    const utilityLabel = getLineupUtilityLabel("cs2", utility, card);
    const badge = document.createElement("button");
    badge.type = "button";
    badge.className = "lineup-video-utility-badge";
    badge.dataset.lineupCs2Utility = utility;
    badge.setAttribute("aria-label", `About ${utilityLabel}`);
    badge.classList.add(side === "defender" ? "lineup-video-utility-badge--cs2-ct" : "lineup-video-utility-badge--cs2-t");
    badge.innerHTML = `<img src="${utilitySrc}" alt="" loading="lazy" decoding="async" />`;
    row.appendChild(badge);
  }

  if (sidePath) {
    const label = LINEUP_CS2_SIDE_LABELS[side] || side;
    const badge = document.createElement("div");
    badge.className = "lineup-video-side-badge";
    badge.dataset.lineupSide = side;
    badge.classList.toggle("lineup-video-side-badge--t", side === "attacker");
    badge.classList.toggle("lineup-video-side-badge--ct", side === "defender");
    badge.title = label;
    badge.setAttribute("aria-hidden", "true");
    badge.innerHTML = `<img src="${resolveAppAssetUrl(sidePath)}" alt="" loading="lazy" decoding="async" />`;
    row.appendChild(badge);
  }
}

function getLineupCs2Utility(card) {
  const explicit = card.dataset.lineupUtility?.trim().toLowerCase();
  if (explicit && LINEUP_CS2_UTILITIES.has(explicit)) return explicit;

  const haystack = [card.dataset.lineupVideoId, card.dataset.lineupSearch, getLineupVideoTitle(card)].filter(Boolean).join(" ").toLowerCase();

  if (/\bflash(?:bang)?\b/.test(haystack)) return "flashbang";
  if (/\b(?:he|hegrenade)\b/.test(haystack)) return "he";
  if (/\b(?:molotov|incendiary|inc)\b/.test(haystack)) return "molotov";
  if (/\bsmoke\b/.test(haystack)) return "smoke";
  return null;
}

function renderLineupVideoUtilityBadge(card) {
  const game = getLineupGameForCard(card);
  if (game === "cs2") {
    renderLineupCs2EmbedBadges(card);
    return;
  }
  if (game !== "valorant") return;

  const embed = card.querySelector(".lineup-video-embed");
  if (!embed) return;

  const utility = getLineupCardUtility(card);
  const src = getLineupUtilityIconSrc(game, utility, card);
  let badge = embed.querySelector(":scope > .lineup-video-utility-badge");

  if (!src) {
    badge?.remove();
    return;
  }

  if (badge && badge.tagName !== "DIV") {
    badge.remove();
    badge = null;
  }

  if (!badge) {
    badge = document.createElement("div");
    badge.className = "lineup-video-utility-badge";
    badge.setAttribute("aria-hidden", "true");
    embed.appendChild(badge);
  }

  const label = getLineupUtilityLabel(game, utility, card);
  delete badge.dataset.lineupCs2Utility;
  badge.title = label;
  badge.setAttribute("aria-hidden", "true");
  badge.removeAttribute("aria-label");
  badge.innerHTML = `<img src="${src}" alt="" loading="lazy" decoding="async" />`;
  badge.classList.add("lineup-video-utility-badge--valorant");
  badge.classList.remove("lineup-video-utility-badge--cs2-t", "lineup-video-utility-badge--cs2-ct");
}

function enhanceLineupVideoCardFoots(root = document) {
  root.querySelectorAll(".lineup-video-card").forEach((card) => {
    renderLineupVideoCardMapIcon(card);
    renderLineupVideoAgentBadge(card);
    renderLineupVideoUtilityBadge(card);
  });
}

function syncLineupSideFilterIcons(game = getActiveLineupGame()) {
  const showCs2 = game === "cs2";
  document.querySelectorAll(".lineup-side-icon[data-lineup-side-icon]").forEach((icon) => {
    const side = icon.dataset.lineupSideIcon;
    const path = LINEUP_CS2_SIDE_ICONS[side];
    if (path) icon.src = resolveAppAssetUrl(path);
    icon.hidden = !showCs2;
  });
  document.getElementById("lineup-side-selector")?.classList.toggle("lineup-side-selector--cs2", showCs2);
}

function getLineupGameForCard(card) {
  const grid = card.closest(".lineup-video-grid");
  if (grid?.id === "lineup-cs2-grid") return "cs2";
  if (grid?.id === "lineup-valorant-grid") return "valorant";
  return getActiveLineupGame();
}

function getLineupMapCallouts(game, mapSlug) {
  return LINEUP_MAP_CALLOUTS[game]?.[mapSlug] || [];
}

function getLineupCardCallout(card) {
  const explicit = card.dataset.lineupCallout?.trim();
  if (explicit) return explicit;

  const mapSlug = (card.dataset.lineupMap || "").toLowerCase();
  if (!mapSlug) return "";

  const game = getLineupGameForCard(card);
  const title = getLineupVideoTitle(card);
  if (!title) return "";

  const titleLower = title.toLowerCase();
  const callouts = [...getLineupMapCallouts(game, mapSlug)].sort((a, b) => b.length - a.length);
  for (const callout of callouts) {
    if (titleLower.includes(callout.toLowerCase())) return callout;
  }

  return "";
}

function applyLineupSearchHighlights(game = getActiveLineupGame()) {
  const lineupTab = document.getElementById("lineup-tab");
  if (lineupTab) clearSettingsSearchHighlights(lineupTab);
  if (!game) return;
  const grid = getLineupGrid(game);
  const query = getLineupSearchQuery(game).trim();
  if (!query || !grid) return;

  const filters = getLineupFilters(game);

  grid.querySelectorAll(".lineup-video-card").forEach((card) => {
    if (!lineupCardMatchesFilters(card, filters)) return;
    const title = card.querySelector(".lineup-video-title");
    if (title) highlightSearchMatches(title, query);
  });
}

function getActiveLineupGame() {
  const game = localStorage.getItem(LINEUP_GAME_STORAGE_KEY);
  return LINEUP_GAMES.has(game) ? game : null;
}

function getLineupGrid(game = getActiveLineupGame()) {
  if (!game) return null;
  return document.getElementById(`lineup-${game}-grid`);
}

function lineupMapToSlug(name) {
  return name.toLowerCase().replace(/\s+/g, "-");
}

function lineupMapFromSlug(slug, game) {
  return (LINEUP_MAPS[game] || []).find((name) => lineupMapToSlug(name) === slug) || null;
}

function getLineupMapSlugsWithVideos(game = getActiveLineupGame()) {
  const grid = getLineupGrid(game);
  const slugs = new Set();
  if (!grid) return slugs;

  grid.querySelectorAll(".lineup-video-card").forEach((card) => {
    const map = (card.dataset.lineupMap || "").toLowerCase().trim();
    if (map) slugs.add(map);
  });
  return slugs;
}

function lineupGameHasVideos(game = getActiveLineupGame()) {
  const grid = getLineupGrid(game);
  return !!grid?.querySelector(".lineup-video-card");
}

function resolveLineupMapFilter(game = getActiveLineupGame()) {
  if (!game) return "all";
  const stored = localStorage.getItem(`${LINEUP_MAP_STORAGE_PREFIX}${game}`) || "all";
  if (stored === "all") return "all";
  if (!lineupMapFromSlug(stored, game)) return "all";
  return stored;
}

function getLineupMapFilter(game = getActiveLineupGame()) {
  return resolveLineupMapFilter(game);
}

function getLineupMapDisplayLabel(slug, game = getActiveLineupGame()) {
  if (slug === "all") return "All maps";
  return lineupMapFromSlug(slug, game) || "All maps";
}

function getLineupMapIconSrc(game, slug) {
  if (slug === "all") return null;
  return LINEUP_MAP_ICONS[game]?.[slug] || null;
}

function renderLineupMapOptionIcon(game, slug) {
  if (slug === "all") {
    return `<i class="ri-earth-line pref-dropdown-option-icon" aria-hidden="true"></i>`;
  }
  const src = getLineupMapIconSrc(game, slug);
  if (!src) {
    return `<i class="ri-map-2-line pref-dropdown-option-icon" aria-hidden="true"></i>`;
  }
  return `<img class="lineup-map-option-icon" src="${src}" alt="" width="16" height="16" loading="lazy" decoding="async" />`;
}

function renderLineupMapOptions(game = getActiveLineupGame()) {
  const list = document.getElementById("lineup-map-list");
  const mapFilter = document.querySelector(".lineup-map-filter");
  if (!list) return;

  const maps = LINEUP_MAPS[game] || [];

  if (mapFilter) mapFilter.hidden = maps.length === 0;

  if (!maps.length) {
    list.innerHTML = "";
    hideLineupMapList();
    return;
  }

  const options = [
    `<button type="button" class="pref-dropdown-option" data-lineup-map="all" role="option">${renderLineupMapOptionIcon(game, "all")}<span>All maps</span></button>`,
    ...maps.map((name) => {
      const slug = lineupMapToSlug(name);
      return `<button type="button" class="pref-dropdown-option" data-lineup-map="${slug}" role="option">${renderLineupMapOptionIcon(game, slug)}<span>${name}</span></button>`;
    }),
  ];
  list.innerHTML = options.join("");
}

function renderLineupMapTriggerIcon(game, slug) {
  const container = document.getElementById("lineup-map-trigger-icon");
  if (!container) return;

  container.dataset.map = slug;

  if (slug === "all") {
    container.innerHTML = '<i class="ri-earth-line" aria-hidden="true"></i>';
    container.classList.remove("has-map-image");
    return;
  }

  const src = getLineupMapIconSrc(game, slug);
  if (src) {
    container.innerHTML = `<img src="${src}" alt="" width="20" height="20" loading="lazy" decoding="async" />`;
    container.classList.add("has-map-image");
    return;
  }

  container.innerHTML = '<i class="ri-map-2-line" aria-hidden="true"></i>';
  container.classList.remove("has-map-image");
}

function syncLineupMapDropdownUi(game = getActiveLineupGame()) {
  const input = document.getElementById("lineup-map-search");
  const list = document.getElementById("lineup-map-list");

  if (!game) {
    renderLineupMapTriggerIcon(null, "all");
    if (input && document.activeElement !== input) {
      input.value = "All maps";
      input.dataset.lastValid = "all";
    }
    list?.querySelectorAll("[data-lineup-map]").forEach((opt) => opt.classList.remove("active"));
    return;
  }

  const map = resolveLineupMapFilter(game);
  localStorage.setItem(`${LINEUP_MAP_STORAGE_PREFIX}${game}`, map);
  const label = getLineupMapDisplayLabel(map, game);

  renderLineupMapTriggerIcon(game, map);

  if (input && document.activeElement !== input) {
    input.value = label;
    input.dataset.lastValid = map;
  }

  list?.querySelectorAll("[data-lineup-map]").forEach((opt) => {
    opt.classList.toggle("active", opt.getAttribute("data-lineup-map") === map);
  });
}

function hideLineupMapList() {
  const list = document.getElementById("lineup-map-list");
  if (!list) return;
  list.classList.add("hidden");
  unmountPrefDropdownPortal(list);
}

function showLineupMapList() {
  const list = document.getElementById("lineup-map-list");
  const trigger = document.getElementById("lineup-map-trigger");
  if (!list || !trigger) return;

  hideAllGameDropdownLists();
  initLineupGameDropdown.close?.();
  initTrainerModeDropdown.close?.();
  initTrainerTimerDropdown.close?.();
  initTrainerAspectDropdown.close?.();
  initBgPatternDropdown.close?.();

  list.classList.remove("hidden");
  if (list.classList.contains("pref-dropdown-list-portal")) {
    startPrefDropdownPortalTracking(list, trigger);
    return;
  }
  mountPrefDropdownPortal(list, trigger);
}

function initLineupMapDropdown() {
  const input = document.getElementById("lineup-map-search");
  const list = document.getElementById("lineup-map-list");
  if (!input || !list || initLineupMapDropdown._init) return;
  initLineupMapDropdown._init = true;

  let activeIndex = -1;
  const getVisible = () => Array.from(list.querySelectorAll(".pref-dropdown-option")).filter((opt) => opt.style.display !== "none");
  const syncHover = (visible) => {
    visible.forEach((opt, i) => opt.classList.toggle("hover", i === activeIndex));
    if (activeIndex >= 0 && visible[activeIndex]) {
      visible[activeIndex].scrollIntoView({ block: "nearest" });
    }
  };
  const selectLineupMapOption = (opt) => {
    if (!opt) return;
    const slug = opt.getAttribute("data-lineup-map") || "all";
    setLineupMap(slug);
    input.value = opt.querySelector("span")?.textContent?.trim() || getLineupMapDisplayLabel(slug);
    hideLineupMapList();
    input.blur();
  };

  input.addEventListener("focus", () => {
    const previous = getLineupMapFilter();
    input.dataset.lastValid = previous;
    input.value = "";
    list.querySelectorAll(".pref-dropdown-option").forEach((opt) => {
      opt.style.display = "";
      opt.classList.remove("hover");
    });
    const visible = getVisible();
    const selectedIndex = visible.findIndex((opt) => opt.getAttribute("data-lineup-map") === previous);
    activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    syncHover(visible);
    showLineupMapList();
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      const map = getLineupMapFilter();
      input.value = getLineupMapDisplayLabel(map);
      input.dataset.lastValid = map;
    }, 120);
  });

  input.addEventListener("input", () => {
    const filter = input.value.toLowerCase();
    list.querySelectorAll(".pref-dropdown-option").forEach((opt) => {
      const label = opt.querySelector("span")?.textContent?.trim().toLowerCase() || "";
      opt.style.display = label.includes(filter) ? "" : "none";
    });
    showLineupMapList();
    activeIndex = 0;
    syncHover(getVisible());
  });

  input.addEventListener("keydown", (e) => {
    const visible = getVisible();
    if (!visible.length) return;
    if (e.key === "ArrowDown") {
      activeIndex = (activeIndex + 1) % visible.length;
      syncHover(visible);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      activeIndex = (activeIndex - 1 + visible.length) % visible.length;
      syncHover(visible);
      e.preventDefault();
    } else if (e.key === "Enter" && activeIndex >= 0) {
      selectLineupMapOption(visible[activeIndex]);
      e.preventDefault();
    } else if (e.key === "Escape") {
      hideLineupMapList();
      input.blur();
    }
  });

  list.addEventListener("mousedown", (e) => {
    const opt = e.target.closest(".pref-dropdown-option[data-lineup-map]");
    if (!opt) return;
    e.preventDefault();
    selectLineupMapOption(opt);
  });

  list.addEventListener("mouseover", (e) => {
    const opt = e.target.closest(".pref-dropdown-option");
    if (!opt) return;
    const visible = getVisible();
    activeIndex = visible.indexOf(opt);
    syncHover(visible);
  });
}

function getLineupCardSearchText(card) {
  const parts = [card.dataset.lineupSearch, card.dataset.lineupCallout, card.textContent];
  const mapSlug = card.dataset.lineupMap || "";
  if (mapSlug) {
    parts.push(mapSlug.replace(/-/g, " "));
    const label = lineupMapFromSlug(mapSlug, getActiveLineupGame());
    if (label) parts.push(label);
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function getLineupSearchQuery(game = getActiveLineupGame()) {
  if (!game) return "";
  return localStorage.getItem(`${LINEUP_SEARCH_STORAGE_PREFIX}${game}`) || "";
}

function getLineupSideFilter() {
  const side = localStorage.getItem(LINEUP_SIDE_STORAGE_KEY) || "all";
  return LINEUP_SIDES.has(side) ? side : "all";
}

function getLineupDifficultyFilter() {
  const raw = localStorage.getItem(LINEUP_DIFFICULTY_STORAGE_KEY) || "";
  return new Set(
    raw
      .split(",")
      .map((level) => level.trim())
      .filter((level) => LINEUP_DIFFICULTY_LEVELS.includes(level)),
  );
}

function setLineupDifficultyFilter(selected) {
  if (!selected.size) localStorage.removeItem(LINEUP_DIFFICULTY_STORAGE_KEY);
  else localStorage.setItem(LINEUP_DIFFICULTY_STORAGE_KEY, [...selected].sort().join(","));
}

function toggleLineupDifficulty(level) {
  if (!LINEUP_DIFFICULTY_LEVELS.includes(level)) return;
  const selected = getLineupDifficultyFilter();
  if (selected.has(level)) selected.delete(level);
  else selected.add(level);
  setLineupDifficultyFilter(selected);
  syncLineupFiltersUI();
}

function getLineupFilters(game = getActiveLineupGame()) {
  return {
    side: getLineupSideFilter(),
    map: getLineupMapFilter(game),
    query: getLineupSearchQuery(game).trim(),
    difficulties: getLineupDifficultyFilter(),
  };
}

function lineupCardMatchesFilters(card, { side, query, map, difficulties }) {
  const cardSide = (card.dataset.lineupSide || "").toLowerCase();
  const cardMap = (card.dataset.lineupMap || "").toLowerCase();
  const cardDifficulty = card.dataset.lineupDifficulty || "";
  const searchText = getLineupCardSearchText(card);
  const sideMatch = side === "all" || cardSide === side;
  const mapMatch = map === "all" || cardMap === map;
  const searchMatch = !query || searchText.includes(query.toLowerCase());
  const difficultyMatch = !difficulties?.size || difficulties.has(cardDifficulty);
  return sideMatch && mapMatch && searchMatch && difficultyMatch;
}

function getLineupFilterCounts(game = getActiveLineupGame()) {
  const grid = getLineupGrid(game);
  if (!grid) return { attacker: 0, defender: 0 };

  const filters = {
    ...getLineupFilters(game),
    side: "all",
  };

  let attacker = 0;
  let defender = 0;
  grid.querySelectorAll(".lineup-video-card").forEach((card) => {
    if (!lineupCardMatchesFilters(card, filters)) return;
    const cardSide = (card.dataset.lineupSide || "").toLowerCase();
    if (cardSide === "attacker") attacker += 1;
    else if (cardSide === "defender") defender += 1;
  });

  return { attacker, defender };
}

function updateLineupFilterCounts(game = getActiveLineupGame()) {
  const el = document.getElementById("lineup-filter-counts");
  if (!el) return;

  const { attacker, defender } = getLineupFilterCounts(game);
  el.textContent = `${attacker} attacker & ${defender} defender`;
}

function setLineupFilterEmptyState(grid, show) {
  let empty = grid.querySelector(".lineup-filter-empty-state");
  if (show) {
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "lineup-empty-state lineup-filter-empty-state";
      empty.textContent = "No lineups match your filters.";
      grid.appendChild(empty);
    }
    empty.hidden = false;
    empty.classList.remove("hidden");
    return;
  }
  empty?.remove();
}

const LINEUP_MAX_VISIBLE_BEFORE_SCROLL = 6;
const LINEUP_CARD_FADE_MS = 300;

const lineupGridAnimationState = {
  searchDebounceId: 0,
  resizeDebounceId: 0,
};

function canAnimateLineupCardFade() {
  return canAnimateHeightResize();
}

function isLineupCardDisplayed(card) {
  return !!card && !card.hidden && !card.classList.contains("hidden");
}

function getLineupGridColumnCount(grid) {
  const styles = getComputedStyle(grid);
  const template = styles.gridTemplateColumns || "";
  const cols = template.split(/\s+/).filter((part) => part && part !== "0px" && part !== "none").length;
  if (cols > 0) return cols;

  const gap = parseFloat(styles.columnGap || styles.gap) || 16;
  const minCol = 17.5 * 16;
  const width = grid.clientWidth;
  if (!width) return 1;
  return Math.max(1, Math.floor((width + gap) / (minCol + gap)));
}

function measureLineupVideosFixedHeight(panel) {
  const grid = panel?.querySelector(".lineup-video-grid");
  if (!grid) return null;

  const gridWidth = grid.clientWidth;
  if (!gridWidth) return null;

  const styles = getComputedStyle(grid);
  const gap = parseFloat(styles.rowGap || styles.gap) || 16;
  const cols = getLineupGridColumnCount(grid);
  const rows = Math.ceil(LINEUP_MAX_VISIBLE_BEFORE_SCROLL / cols);
  const cardWidth = (gridWidth - gap * Math.max(0, cols - 1)) / cols;
  // Embed is aspect-ratio 16/9; foot uses min-height 4.25rem (border-box).
  const cardHeight = cardWidth * (9 / 16) + 4.25 * 16;
  const gridHeight = rows * cardHeight + Math.max(0, rows - 1) * gap;

  const title = panel.querySelector(":scope > .settings-section-title");
  const titleStyle = title ? getComputedStyle(title) : null;
  const titleBlock = title
    ? title.offsetHeight + parseFloat(titleStyle.marginTop || 0) + parseFloat(titleStyle.marginBottom || 0)
    : 0;

  const holder = panel.closest(".lineup-videos-holder");
  const holderStyle = holder ? getComputedStyle(holder) : null;
  const holderPadding = holderStyle
    ? parseFloat(holderStyle.paddingTop || 0) + parseFloat(holderStyle.paddingBottom || 0)
    : 0;

  return holderPadding + titleBlock + gridHeight;
}

function releaseLineupVideosHolderHeight(holder = document.querySelector(".lineup-videos-holder")) {
  if (!holder) return;
  holder.style.height = "";
  holder.style.overflow = "";
  holder.style.transition = "";
}

function clearLineupVideosHolderFixedHeight(holder = document.querySelector(".lineup-videos-holder")) {
  if (!holder) return;
  holder.classList.remove("lineup-videos-holder--fixed");
  holder.style.removeProperty("--lineup-videos-fixed-height");
  releaseLineupVideosHolderHeight(holder);
}

function updateLineupVideosScrollState(game = getActiveLineupGame()) {
  const holder = document.querySelector(".lineup-videos-holder");
  if (!holder) return;

  if (!game) {
    clearLineupVideosHolderFixedHeight(holder);
    return;
  }

  const panel = document.getElementById(`lineup-${game}-panel`);
  const grid = getLineupGrid(game);
  if (!panel || !grid) {
    clearLineupVideosHolderFixedHeight(holder);
    return;
  }

  // Clear any stale resize-animation inline styles from older builds.
  delete holder.dataset.resizeBound;
  delete holder.dataset.resizeReady;
  releaseLineupVideosHolderHeight(holder);

  const fixedHeight = measureLineupVideosFixedHeight(panel);
  if (fixedHeight == null) {
    clearLineupVideosHolderFixedHeight(holder);
    const lineupTab = document.getElementById("lineup-tab");
    if (lineupTab && lineupTab.style.display !== "none") {
      scheduleLineupVideosScrollStateUpdate();
    }
    return;
  }

  holder.style.setProperty("--lineup-videos-fixed-height", `${Math.ceil(fixedHeight)}px`);
  holder.classList.add("lineup-videos-holder--fixed");
}

function refreshLineupVideosFixedHeight(game = getActiveLineupGame()) {
  updateLineupVideosScrollState(game);
  requestAnimationFrame(() => {
    updateLineupVideosScrollState(game);
    scheduleLineupVideosScrollStateUpdate();
  });
}

function clearLineupCardLeaveTimer(card) {
  if (!card._lineupLeaveTimer) return;
  clearTimeout(card._lineupLeaveTimer);
  card._lineupLeaveTimer = null;
}

function hideLineupCardInstant(card) {
  clearLineupCardLeaveTimer(card);
  card.classList.remove("lineup-video-card--entering", "lineup-video-card--leaving");
  card.hidden = true;
  card.classList.add("hidden");
}

function setLineupCardVisible(card, show, { onComplete } = {}) {
  clearLineupCardLeaveTimer(card);

  if (show) {
    card.classList.remove("lineup-video-card--leaving");
    card.hidden = false;
    card.classList.remove("hidden");

    if (canAnimateLineupCardFade()) {
      card.classList.add("lineup-video-card--entering");
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          card.classList.remove("lineup-video-card--entering");
        });
      });
    } else {
      card.classList.remove("lineup-video-card--entering");
    }

    onComplete?.();
    return;
  }

  const isVisible = !card.hidden && !card.classList.contains("hidden");
  if (!isVisible) {
    card.classList.remove("lineup-video-card--entering", "lineup-video-card--leaving");
    card.hidden = true;
    card.classList.add("hidden");
    onComplete?.();
    return;
  }

  if (!canAnimateLineupCardFade()) {
    card.classList.remove("lineup-video-card--entering", "lineup-video-card--leaving");
    card.hidden = true;
    card.classList.add("hidden");
    onComplete?.();
    return;
  }

  card.classList.remove("lineup-video-card--entering");
  card.classList.add("lineup-video-card--leaving");
  card._lineupLeaveTimer = setTimeout(() => {
    card._lineupLeaveTimer = null;
    card.classList.remove("lineup-video-card--leaving");
    card.hidden = true;
    card.classList.add("hidden");
    onComplete?.();
  }, LINEUP_CARD_FADE_MS);
}

function syncLineupFiltersVisibility(game = getActiveLineupGame()) {
  const container = document.getElementById("lineup-filters-container");
  const hasGame = LINEUP_GAMES.has(game);
  if (!container) return;
  container.hidden = !hasGame;
  container.classList.toggle("hidden", !hasGame);
}

function switchLineupGamePanels(nextGame) {
  const activeGame = LINEUP_GAMES.has(nextGame) ? nextGame : "";

  document.querySelectorAll("[data-lineup-game-panel]").forEach((panel) => {
    const show = !!activeGame && panel.dataset.lineupGamePanel === activeGame;
    panel.classList.toggle("hidden", !show);
    panel.hidden = !show;
  });

  const selector = document.getElementById("lineup-game-selector");
  if (selector) selector.dataset.activeGame = activeGame;
  document.querySelector(".lineup-videos-holder")?.setAttribute("data-active-game", activeGame);
  syncLineupFiltersVisibility(activeGame || null);
}

function syncLineupGameSelectorUi(game = getActiveLineupGame()) {
  const selector = document.getElementById("lineup-game-selector");
  const label = document.getElementById("lineup-game-label");
  const iconHost = document.getElementById("lineup-game-icon");
  const list = document.getElementById("lineup-game-list");
  const clearBtn = document.getElementById("lineup-game-clear");
  if (!selector) return;

  const activeGame = LINEUP_GAMES.has(game) ? game : "";
  const option = activeGame ? LINEUP_GAME_OPTIONS[activeGame] : null;

  selector.dataset.activeGame = activeGame;
  selector.dataset.value = activeGame;
  selector.classList.toggle("has-game", !!activeGame);
  if (label) label.textContent = option?.label || "Select game";
  if (clearBtn) {
    clearBtn.hidden = !activeGame;
    clearBtn.style.display = activeGame ? "flex" : "none";
  }

  if (iconHost) {
    if (option?.iconSrc) {
      if (iconHost.tagName === "IMG") {
        iconHost.className = "game-option-icon";
        iconHost.src = option.iconSrc;
      } else {
        const img = document.createElement("img");
        img.id = "lineup-game-icon";
        img.className = "game-option-icon";
        img.src = option.iconSrc;
        img.alt = "";
        img.width = 18;
        img.height = 18;
        img.decoding = "async";
        iconHost.replaceWith(img);
      }
    } else if (iconHost.tagName === "IMG") {
      const icon = document.createElement("i");
      icon.id = "lineup-game-icon";
      icon.className = "ri-gamepad-line pref-dropdown-icon";
      icon.setAttribute("aria-hidden", "true");
      iconHost.replaceWith(icon);
    } else {
      iconHost.className = "ri-gamepad-line pref-dropdown-icon";
    }
  }

  list?.querySelectorAll("[data-lineup-game]").forEach((opt) => {
    const active = opt.dataset.lineupGame === activeGame;
    opt.classList.toggle("active", active);
    opt.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function countVisibleLineupCards(grid) {
  return [...grid.querySelectorAll(".lineup-video-card")].filter(isLineupCardDisplayed).length;
}

const lineupFilterTransitionState = {
  token: 0,
};

function lineupDisplaySetsDiffer(grid, filters) {
  const allCards = [...grid.querySelectorAll(".lineup-video-card")];
  const targetIds = new Set(allCards.filter((card) => lineupCardMatchesFilters(card, filters)).map((card) => card));
  const displayedIds = new Set(allCards.filter(isLineupCardDisplayed));

  if (targetIds.size !== displayedIds.size) return true;
  for (const card of targetIds) {
    if (!displayedIds.has(card)) return true;
  }
  return false;
}

function lineupFiltersWillAnimate(grid, filters) {
  if (!canAnimateLineupCardFade()) return false;
  const cards = grid.querySelectorAll(".lineup-video-card");
  if (!cards.length) return false;
  return lineupDisplaySetsDiffer(grid, filters);
}

function applyLineupFiltersInstant(grid, game, filters) {
  const allCards = [...grid.querySelectorAll(".lineup-video-card")];
  const targetCards = allCards.filter((card) => lineupCardMatchesFilters(card, filters));

  allCards.forEach((card) => {
    if (targetCards.includes(card)) {
      clearLineupCardLeaveTimer(card);
      card.hidden = false;
      card.classList.remove("hidden", "lineup-video-card--entering", "lineup-video-card--leaving");
    } else {
      hideLineupCardInstant(card);
    }
  });

  setLineupFilterEmptyState(grid, targetCards.length === 0);
  applyLineupSearchHighlights(game);
  updateLineupVideosScrollState(game);
  updateLineupFilterCounts(game);
}

function fadeOutLineupCards(cards) {
  return new Promise((resolve) => {
    const exiting = cards.filter(isLineupCardDisplayed);
    if (!exiting.length) {
      resolve();
      return;
    }

    if (!canAnimateLineupCardFade()) {
      exiting.forEach(hideLineupCardInstant);
      resolve();
      return;
    }

    let remaining = exiting.length;
    exiting.forEach((card) => {
      setLineupCardVisible(card, false, {
        onComplete: () => {
          remaining -= 1;
          if (remaining === 0) resolve();
        },
      });
    });
  });
}

function fadeInLineupCards(cards) {
  return new Promise((resolve) => {
    if (!cards.length) {
      resolve();
      return;
    }

    if (!canAnimateLineupCardFade()) {
      cards.forEach((card) => {
        card.hidden = false;
        card.classList.remove("hidden", "lineup-video-card--entering", "lineup-video-card--leaving");
      });
      resolve();
      return;
    }

    cards.forEach((card) => {
      card.hidden = false;
      card.classList.remove("hidden", "lineup-video-card--leaving");
      card.classList.add("lineup-video-card--entering");
    });

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        cards.forEach((card) => card.classList.remove("lineup-video-card--entering"));
        setTimeout(resolve, LINEUP_CARD_FADE_MS);
      });
    });
  });
}

async function runLineupFilterTransition(grid, game, filters) {
  const token = ++lineupFilterTransitionState.token;
  const allCards = [...grid.querySelectorAll(".lineup-video-card")];
  const targetCards = allCards.filter((card) => lineupCardMatchesFilters(card, filters));
  const currentlyDisplayed = allCards.filter(isLineupCardDisplayed);

  if (currentlyDisplayed.length) {
    await fadeOutLineupCards(currentlyDisplayed);
    if (token !== lineupFilterTransitionState.token) return;
  }

  allCards.forEach(hideLineupCardInstant);
  setLineupFilterEmptyState(grid, targetCards.length === 0);

  if (!targetCards.length) {
    applyLineupSearchHighlights(game);
    updateLineupVideosScrollState(game);
    updateLineupFilterCounts(game);
    return;
  }

  applyLineupSearchHighlights(game);
  await fadeInLineupCards(targetCards);
  if (token !== lineupFilterTransitionState.token) return;

  updateLineupVideosScrollState(game);
  updateLineupFilterCounts(game);
}

function applyLineupFilters() {
  const game = getActiveLineupGame();
  const grid = getLineupGrid(game);
  if (!grid) return;

  const filters = getLineupFilters(game);

  const cards = grid.querySelectorAll(".lineup-video-card");
  const staticEmpty = grid.querySelector(":scope > .lineup-empty-state:not(.lineup-filter-empty-state)");

  if (!cards.length) {
    staticEmpty?.classList.remove("hidden");
    staticEmpty && (staticEmpty.hidden = false);
    setLineupFilterEmptyState(grid, false);
    updateLineupVideosScrollState(game);
    updateLineupFilterCounts(game);
    return;
  }

  staticEmpty?.classList.add("hidden");
  if (staticEmpty) staticEmpty.hidden = true;

  if (!lineupFiltersWillAnimate(grid, filters)) {
    applyLineupFiltersInstant(grid, game, filters);
    return;
  }

  runLineupFilterTransition(grid, game, filters);
}

function applyLineupGridStateInstant() {
  lineupFilterTransitionState.token += 1;
  const game = getActiveLineupGame();

  switchLineupGamePanels(game);

  document.querySelectorAll(".lineup-video-grid").forEach((grid) => {
    grid.classList.remove("lineup-video-grid--animating");
    grid.querySelectorAll(".lineup-video-card").forEach(hideLineupCardInstant);
  });

  const enterGrid = getLineupGrid(game);
  if (!enterGrid) {
    refreshLineupVideosFixedHeight(game);
    updateLineupFilterCounts(game);
    return;
  }

  const filters = getLineupFilters(game);

  const allCards = [...enterGrid.querySelectorAll(".lineup-video-card")];
  const staticEmpty = enterGrid.querySelector(":scope > .lineup-empty-state:not(.lineup-filter-empty-state)");

  if (!allCards.length) {
    staticEmpty?.classList.remove("hidden");
    if (staticEmpty) staticEmpty.hidden = false;
    setLineupFilterEmptyState(enterGrid, false);
    refreshLineupVideosFixedHeight(game);
    applyLineupSearchHighlights(game);
    updateLineupFilterCounts(game);
    return;
  }

  staticEmpty?.classList.add("hidden");
  if (staticEmpty) staticEmpty.hidden = true;

  const targetCards = allCards.filter((card) => lineupCardMatchesFilters(card, filters));
  allCards.forEach((card) => {
    if (targetCards.includes(card)) {
      clearLineupCardLeaveTimer(card);
      card.hidden = false;
      card.classList.remove("hidden", "lineup-video-card--entering", "lineup-video-card--leaving");
    } else {
      hideLineupCardInstant(card);
    }
  });

  setLineupFilterEmptyState(enterGrid, targetCards.length === 0);
  refreshLineupVideosFixedHeight(game);
  applyLineupSearchHighlights(game);
  updateLineupFilterCounts(game);
}

function syncLineupFiltersUiControls() {
  const game = getActiveLineupGame();
  const side = getLineupSideFilter();
  const search = getLineupSearchQuery(game);

  syncLineupSideFilterIcons(game);
  syncLineupMapDropdownUi(game);

  const sideSelector = document.getElementById("lineup-side-selector");
  sideSelector?.querySelectorAll(".toggle-btn[data-lineup-side]").forEach((btn) => {
    const active = btn.dataset.lineupSide === side;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  positionToggleGlider(sideSelector);

  const selectedDifficulties = getLineupDifficultyFilter();
  document.querySelectorAll(".lineup-difficulty-tag[data-lineup-difficulty]").forEach((btn) => {
    const level = btn.dataset.lineupDifficulty;
    const active = selectedDifficulties.has(level);
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  });

  const searchInput = document.getElementById("lineup-search");
  const clearBtn = document.getElementById("lineup-search-clear");
  if (searchInput && searchInput.value !== search) searchInput.value = search;
  if (clearBtn) clearBtn.style.display = search.trim() ? "flex" : "none";
}

function syncLineupFiltersUI() {
  syncLineupFiltersUiControls();
  applyLineupFilters();
}

function setLineupMap(map) {
  const game = getActiveLineupGame();
  if (!game) return;
  const nextMap = map === "all" || lineupMapFromSlug(map, game) ? map : "all";
  localStorage.setItem(`${LINEUP_MAP_STORAGE_PREFIX}${game}`, nextMap);
  syncLineupFiltersUI();
}

function setLineupSide(side) {
  const nextSide = LINEUP_SIDES.has(side) ? side : "all";
  localStorage.setItem(LINEUP_SIDE_STORAGE_KEY, nextSide);
  syncLineupFiltersUI();
}

function setLineupSearch(query) {
  const game = getActiveLineupGame();
  if (!game) return;
  localStorage.setItem(`${LINEUP_SEARCH_STORAGE_PREFIX}${game}`, query);
  applyLineupSearchHighlights(game);
  syncLineupFiltersUI();
}

function setLineupGame(game) {
  if (!LINEUP_GAMES.has(game)) return;
  localStorage.setItem(LINEUP_GAME_STORAGE_KEY, game);

  syncLineupGameSelectorUi(game);
  switchLineupGamePanels(game);
  renderLineupMapOptions(game);
  syncLineupFiltersUiControls();
  applyLineupVideoSources(getLineupGrid(game) || document);
  applyLineupFilters();
  refreshLineupVideosFixedHeight(game);
}

function clearLineupGame() {
  localStorage.removeItem(LINEUP_GAME_STORAGE_KEY);
  initLineupGameDropdown.close?.();
  syncLineupGameSelectorUi(null);
  switchLineupGamePanels(null);
  renderLineupMapOptions(null);
  syncLineupFiltersUiControls();
  applyLineupGridStateInstant();
  refreshLineupVideosFixedHeight(null);
}

function formatLineupVideoTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

const lineupVideoSeekState = {
  dragging: false,
  wasPlaying: false,
  scrubCaptureId: 0,
  pendingScrubTime: null,
  lastScrubCaptureAt: 0,
  scrubCaptureTimer: 0,
  progressLoopId: 0,
  lastProgressTs: 0,
};

const LINEUP_VIDEO_PROGRESS_THUMB_PX = 16;
const LINEUP_VIDEO_PROGRESS_ANIM_RATE = HEALTH_BAR_ANIM_RATE;
const LINEUP_VIDEO_PROGRESS_TRAIL_RATE = HEALTH_BAR_TRAIL_RATE;
const lineupVideoProgressAnimByVideo = new WeakMap();

function getLineupVideoProgressAnimState(video) {
  if (!lineupVideoProgressAnimByVideo.has(video)) {
    lineupVideoProgressAnimByVideo.set(video, {
      displayPlayed: 0,
      trailPlayed: 0,
      displayBuffer: 0,
      trailBuffer: 0,
    });
  }
  return lineupVideoProgressAnimByVideo.get(video);
}

function resetLineupVideoProgressAnimState(video) {
  if (!video) return;
  lineupVideoProgressAnimByVideo.delete(video);
}

function lineupProgressPctToTrackWidth(pct) {
  return Math.max(0, Math.min(100, pct));
}

function lineupProgressPctToThumbLeft(pct, wrap = document.getElementById("lineup-video-progress-wrap")) {
  const width = wrap?.clientWidth || 1;
  const clamped = Math.max(0, Math.min(100, pct));
  return (clamped / 100) * width;
}

function getLineupVideoBufferedEndPct(video) {
  if (!video?.duration || !Number.isFinite(video.duration) || video.duration <= 0) return 0;

  let end = 0;
  try {
    const time = video.currentTime ?? 0;
    for (let i = 0; i < video.buffered.length; i += 1) {
      const start = video.buffered.start(i);
      const bufferedEnd = video.buffered.end(i);
      end = Math.max(end, bufferedEnd);
      if (time >= start - 0.25 && time <= bufferedEnd + 0.25) {
        end = Math.max(end, bufferedEnd);
      }
    }

    // Some browsers expose ahead-buffer via seekable before buffered updates.
    if (end <= 0 && video.seekable?.length) {
      end = video.seekable.end(video.seekable.length - 1);
    }
  } catch {
    return 0;
  }

  return Math.max(0, Math.min(100, (end / video.duration) * 100));
}

function getLineupVideoPlayedPct(video) {
  if (!video?.duration || !Number.isFinite(video.duration)) return 0;
  return (video.currentTime / video.duration) * 100;
}

function stepLineupVideoProgressAnim(current, target, trail, dt, { snap = false } = {}) {
  if (snap || !canAnimateHeightResize()) {
    return { display: target, trail: target };
  }

  let display = current;
  let nextTrail = trail;

  if (target > display) {
    display += (target - display) * Math.min(1, dt * LINEUP_VIDEO_PROGRESS_ANIM_RATE);
    if (target - display < 0.05) display = target;
  } else {
    display = target;
  }

  if (nextTrail > display) {
    nextTrail += (display - nextTrail) * Math.min(1, dt * LINEUP_VIDEO_PROGRESS_TRAIL_RATE);
    if (nextTrail - display < 0.05) nextTrail = display;
  } else if (display > nextTrail) {
    nextTrail += (display - nextTrail) * Math.min(1, dt * LINEUP_VIDEO_PROGRESS_TRAIL_RATE);
    if (display - nextTrail < 0.05) nextTrail = display;
  } else {
    nextTrail = display;
  }

  return { display, trail: nextTrail };
}

function ensureLineupVideoEmbedProgress(embed) {
  if (!embed || embed.querySelector(".lineup-video-embed-progress")) return;

  const progress = document.createElement("div");
  progress.className = "lineup-video-embed-progress";
  progress.setAttribute("aria-hidden", "true");
  progress.innerHTML = `
    <div class="lineup-video-progress-track">
      <div class="lineup-video-progress-buffer">
        <div class="lineup-video-progress-buffer-trail"></div>
        <div class="lineup-video-progress-buffer-fill"></div>
      </div>
    </div>
  `;
  embed.appendChild(progress);
}

function getLineupVideoProgressUi(video) {
  if (!video) return null;

  if (video.id === "lineup-video-modal-player") {
    return {
      mode: "modal",
      wrap: document.getElementById("lineup-video-progress-wrap"),
      bufferTrail: document.getElementById("lineup-video-progress-buffer-trail"),
      bufferFill: document.getElementById("lineup-video-progress-buffer-fill"),
      playedTrail: document.getElementById("lineup-video-progress-played-trail"),
      playedFill: document.getElementById("lineup-video-progress-played"),
      thumb: document.getElementById("lineup-video-progress-thumb"),
      pctToWidth: (pct) => lineupProgressPctToTrackWidth(pct),
      pctToThumb: (pct) => lineupProgressPctToThumbLeft(pct),
    };
  }

  const embed = video.closest(".lineup-video-embed");
  const root = embed?.querySelector(".lineup-video-embed-progress");
  if (!embed || !root) return null;

  return {
    mode: "embed",
    root,
    bufferTrail: root.querySelector(".lineup-video-progress-buffer-trail"),
    bufferFill: root.querySelector(".lineup-video-progress-buffer-fill"),
    pctToWidth: (pct) => Math.max(0, Math.min(100, pct)),
  };
}

function applyLineupVideoProgressVisuals(ui, { playedDisplay, playedTrail, bufferDisplay, bufferTrail }) {
  if (!ui) return;

  if (ui.bufferTrail) ui.bufferTrail.style.width = `${ui.pctToWidth(bufferTrail)}%`;
  if (ui.bufferFill) ui.bufferFill.style.width = `${ui.pctToWidth(bufferDisplay)}%`;

  if (ui.mode === "modal") {
    if (ui.playedTrail) ui.playedTrail.style.width = `${ui.pctToWidth(playedTrail)}%`;
    if (ui.playedFill) ui.playedFill.style.width = `${ui.pctToWidth(playedDisplay)}%`;
    if (ui.thumb) ui.thumb.style.left = `${ui.pctToThumb(playedDisplay)}px`;
  }
}

function lineupVideoNeedsProgressUpdates(video, anim) {
  if (!video?.src) return false;
  if (!video.duration || !Number.isFinite(video.duration) || video.readyState < HTMLMediaElement.HAVE_METADATA) return true;
  if (video.networkState === HTMLMediaElement.NETWORK_LOADING) return true;
  if (!video.paused && !video.ended && !video.hidden) return true;

  const targetBuffer = getLineupVideoBufferedEndPct(video);
  if (targetBuffer < 99.5) return true;
  if (Math.abs(anim.displayBuffer - targetBuffer) > 0.05) return true;
  if (Math.abs(anim.trailBuffer - anim.displayBuffer) > 0.05) return true;

  if (video.id === "lineup-video-modal-player" && !video.hidden) {
    const targetPlayed = getLineupVideoPlayedPct(video);
    if (Math.abs(anim.displayPlayed - targetPlayed) > 0.05) return true;
    if (Math.abs(anim.trailPlayed - anim.displayPlayed) > 0.05) return true;
  }

  return false;
}

function setLineupVideoProgressTargets(video, { playedPct, bufferPct, snap = false, playedDisplayOnly = false } = {}) {
  const anim = getLineupVideoProgressAnimState(video);
  if (playedPct != null) {
    anim.displayPlayed = playedPct;
    if (!playedDisplayOnly) anim.trailPlayed = snap ? playedPct : anim.trailPlayed;
  }
  if (bufferPct != null) {
    anim.displayBuffer = bufferPct;
    anim.trailBuffer = snap ? bufferPct : anim.trailBuffer;
  }

  const ui = getLineupVideoProgressUi(video);
  if (!ui) return;

  applyLineupVideoProgressVisuals(ui, {
    playedDisplay: anim.displayPlayed,
    playedTrail: anim.trailPlayed,
    bufferDisplay: anim.displayBuffer,
    bufferTrail: anim.trailBuffer,
  });

  if (ui.mode === "embed" && ui.root) {
    const active = anim.displayBuffer > 0.05 || anim.trailBuffer > 0.05;
    ui.root.classList.toggle("is-active", active);
  }
}

function updateLineupVideoProgressForPlayer(video, dt, { snap = false } = {}) {
  const ui = getLineupVideoProgressUi(video);
  if (!ui) return false;

  const anim = getLineupVideoProgressAnimState(video);
  const targetBuffer = getLineupVideoBufferedEndPct(video);
  // Buffer should reflect loaded media immediately; trail can ease behind it.
  const bufferStep = stepLineupVideoProgressAnim(anim.displayBuffer, targetBuffer, anim.trailBuffer, dt, {
    snap: snap || targetBuffer > anim.displayBuffer,
  });
  anim.displayBuffer = bufferStep.display;
  anim.trailBuffer = bufferStep.trail;

  let playedDisplay = anim.displayPlayed;
  let playedTrail = anim.trailPlayed;

  if (ui.mode === "modal" && !lineupVideoSeekState.dragging) {
    const targetPlayed = getLineupVideoPlayedPct(video);
    const playedStep = stepLineupVideoProgressAnim(anim.displayPlayed, targetPlayed, anim.trailPlayed, dt, { snap });
    playedDisplay = playedStep.display;
    playedTrail = playedStep.trail;
    anim.displayPlayed = playedDisplay;
    anim.trailPlayed = playedTrail;
  }

  applyLineupVideoProgressVisuals(ui, {
    playedDisplay,
    playedTrail,
    bufferDisplay: anim.displayBuffer,
    bufferTrail: anim.trailBuffer,
  });

  if (ui.mode === "embed" && ui.root) {
    const active = targetBuffer > 0.05 && targetBuffer < 99.5;
    ui.root.classList.toggle("is-active", active || anim.trailBuffer > anim.displayBuffer + 0.05);
  }

  return lineupVideoNeedsProgressUpdates(video, anim);
}

function collectLineupVideoProgressTargets() {
  const videos = [];
  const modalPlayer = document.getElementById("lineup-video-modal-player");
  if (modalPlayer?.src) videos.push(modalPlayer);
  document.querySelectorAll("video.lineup-video-preview[src]").forEach((video) => videos.push(video));
  return videos;
}

function tickLineupVideoProgressAnim(ts) {
  lineupVideoSeekState.progressLoopId = 0;

  const lastTs = lineupVideoSeekState.lastProgressTs;
  const dt = lastTs ? Math.min(0.05, Math.max(0, (ts - lastTs) / 1000)) : 1 / 60;
  lineupVideoSeekState.lastProgressTs = ts;

  const overlay = document.getElementById("lineup-video-overlay");
  const modalActive = overlay?.classList.contains("active");
  const modalPlayer = document.getElementById("lineup-video-modal-player");
  let needsNextFrame = false;

  collectLineupVideoProgressTargets().forEach((video) => {
    if (updateLineupVideoProgressForPlayer(video, dt)) needsNextFrame = true;
  });

  if (modalActive && modalPlayer && !modalPlayer.hidden && modalPlayer.src && !lineupVideoSeekState.dragging) {
    updateLineupVideoProgressFromPlayer(modalPlayer);
    updateLineupVideoProgressForPlayer(modalPlayer, dt);
    if (!modalPlayer.paused || !modalPlayer.duration || modalPlayer.readyState < HTMLMediaElement.HAVE_METADATA) {
      needsNextFrame = true;
    }
  }

  if (needsNextFrame) {
    lineupVideoSeekState.progressLoopId = requestAnimationFrame(tickLineupVideoProgressAnim);
  } else {
    lineupVideoSeekState.lastProgressTs = 0;
  }
}

function startLineupVideoProgressLoop() {
  if (lineupVideoSeekState.progressLoopId) return;
  lineupVideoSeekState.progressLoopId = requestAnimationFrame(tickLineupVideoProgressAnim);
}

function stopLineupVideoProgressLoop() {
  if (!lineupVideoSeekState.progressLoopId) return;
  cancelAnimationFrame(lineupVideoSeekState.progressLoopId);
  lineupVideoSeekState.progressLoopId = 0;
  lineupVideoSeekState.lastProgressTs = 0;
}

function updateLineupVideoProgressBars({ playedPct, bufferPct, snap = false, playedDisplayOnly = false } = {}) {
  const player = document.getElementById("lineup-video-modal-player");
  if (!player) return;

  const nextBufferPct = bufferPct ?? getLineupVideoBufferedEndPct(player);
  const nextPlayedPct = playedPct ?? (lineupVideoSeekState.dragging ? null : getLineupVideoPlayedPct(player));

  setLineupVideoProgressTargets(player, {
    playedPct: nextPlayedPct,
    bufferPct: playedDisplayOnly ? null : nextBufferPct,
    snap,
    playedDisplayOnly,
  });

  if (!playedDisplayOnly) {
    updateLineupVideoProgressForPlayer(player, 1 / 60, { snap });
  }
  startLineupVideoProgressLoop();
}

function hideLineupVideoScrubPreview() {
  if (lineupVideoSeekState.scrubCaptureTimer) {
    clearTimeout(lineupVideoSeekState.scrubCaptureTimer);
    lineupVideoSeekState.scrubCaptureTimer = 0;
  }
  lineupVideoSeekState.pendingScrubTime = null;
  document.getElementById("lineup-video-scrub-preview")?.classList.add("hidden");
  document.getElementById("lineup-video-progress-wrap")?.classList.remove("is-dragging");
}

function positionLineupVideoScrubPreview(pct) {
  const preview = document.getElementById("lineup-video-scrub-preview");
  if (!preview) return;
  preview.style.left = `${lineupProgressPctToThumbLeft(pct)}px`;
}

function syncLineupVideoScrubPlayer() {
  const player = document.getElementById("lineup-video-modal-player");
  const scrubPlayer = document.getElementById("lineup-video-scrub-player");
  if (!player || !scrubPlayer || player.hidden || !player.src) {
    scrubPlayer?.removeAttribute("src");
    return;
  }

  if (scrubPlayer.src !== player.src) {
    scrubPlayer.src = player.src;
    scrubPlayer.load();
  }

  if (scrubPlayer.readyState < 1) {
    scrubPlayer.addEventListener(
      "loadedmetadata",
      () => {
        if (lineupVideoSeekState.pendingScrubTime != null) flushLineupVideoScrubFrame();
      },
      { once: true },
    );
  }
}

function flushLineupVideoScrubFrame() {
  lineupVideoSeekState.scrubCaptureTimer = 0;
  const captureTime = lineupVideoSeekState.pendingScrubTime;
  if (captureTime == null) return;

  const scrubPlayer = document.getElementById("lineup-video-scrub-player");
  const canvas = document.getElementById("lineup-video-scrub-canvas");
  if (!scrubPlayer || !canvas || !scrubPlayer.src) return;

  const captureId = ++lineupVideoSeekState.scrubCaptureId;
  lineupVideoSeekState.lastScrubCaptureAt = Date.now();
  const safeTime = Math.max(0, Math.min(captureTime, scrubPlayer.duration || captureTime));

  const drawFrame = () => {
    if (captureId !== lineupVideoSeekState.scrubCaptureId) return;
    const ctx = canvas.getContext("2d");
    if (!ctx || !scrubPlayer.videoWidth) return;
    ctx.drawImage(scrubPlayer, 0, 0, canvas.width, canvas.height);
  };

  if (Math.abs(scrubPlayer.currentTime - safeTime) < 0.08 && scrubPlayer.readyState >= 2) {
    drawFrame();
    return;
  }

  const onSeeked = () => {
    scrubPlayer.removeEventListener("seeked", onSeeked);
    drawFrame();
  };

  scrubPlayer.addEventListener("seeked", onSeeked);
  try {
    scrubPlayer.currentTime = safeTime;
  } catch {
    scrubPlayer.removeEventListener("seeked", onSeeked);
  }
}

function requestLineupVideoScrubFrame(time) {
  lineupVideoSeekState.pendingScrubTime = time;

  const now = Date.now();
  const elapsed = now - (lineupVideoSeekState.lastScrubCaptureAt || 0);
  const interval = 60;

  if (elapsed >= interval) {
    if (lineupVideoSeekState.scrubCaptureTimer) {
      clearTimeout(lineupVideoSeekState.scrubCaptureTimer);
      lineupVideoSeekState.scrubCaptureTimer = 0;
    }
    flushLineupVideoScrubFrame();
    return;
  }

  if (!lineupVideoSeekState.scrubCaptureTimer) {
    lineupVideoSeekState.scrubCaptureTimer = window.setTimeout(flushLineupVideoScrubFrame, interval - elapsed);
  }
}

function updateLineupVideoProgressFromPlayer(player) {
  const progress = document.getElementById("lineup-video-progress");
  const current = document.getElementById("lineup-video-time-current");
  if (!player?.duration || !progress || lineupVideoSeekState.dragging) return;

  const pct = (player.currentTime / player.duration) * 100;
  progress.value = String(pct);
  if (current) current.textContent = formatLineupVideoTime(player.currentTime);
}

function syncLineupVideoBufferUi() {
  const player = document.getElementById("lineup-video-modal-player");
  const duration = document.getElementById("lineup-video-time-duration");
  if (!player) return;

  if (!lineupVideoSeekState.dragging) {
    updateLineupVideoProgressBars({
      playedPct: getLineupVideoPlayedPct(player),
      bufferPct: getLineupVideoBufferedEndPct(player),
      snap: true,
    });
  } else {
    startLineupVideoProgressLoop();
  }
  if (duration && player.duration) duration.textContent = formatLineupVideoTime(player.duration);
}

function showLineupVideoScrubPreview(pct) {
  const player = document.getElementById("lineup-video-modal-player");
  const preview = document.getElementById("lineup-video-scrub-preview");
  const scrubTime = document.getElementById("lineup-video-scrub-time");
  if (!player?.duration || !preview || player.hidden) return;

  const time = (pct / 100) * player.duration;
  preview.classList.remove("hidden");
  positionLineupVideoScrubPreview(pct);
  if (scrubTime) scrubTime.textContent = formatLineupVideoTime(time);
  syncLineupVideoScrubPlayer();
  requestLineupVideoScrubFrame(time);
}

function handleLineupVideoProgressInput() {
  const player = document.getElementById("lineup-video-modal-player");
  const progress = document.getElementById("lineup-video-progress");
  const current = document.getElementById("lineup-video-time-current");
  if (!player?.duration || !progress) return;

  const pct = Number(progress.value);
  updateLineupVideoProgressBars({ playedPct: pct, snap: true });
  if (current) current.textContent = formatLineupVideoTime((pct / 100) * player.duration);
  showLineupVideoScrubPreview(pct);
}

function finishLineupVideoProgressSeek() {
  const player = document.getElementById("lineup-video-modal-player");
  const progress = document.getElementById("lineup-video-progress");
  if (!lineupVideoSeekState.dragging || !player || !progress) return;

  lineupVideoSeekState.dragging = false;
  flushLineupVideoScrubFrame();
  hideLineupVideoScrubPreview();

  if (player.duration) {
    player.currentTime = (Number(progress.value) / 100) * player.duration;
  }

  if (lineupVideoSeekState.wasPlaying) player.play().catch(() => {});
  syncLineupVideoControlsUi();
  if (lineupVideoModalState.shouldAutoplay && !player.paused) startLineupVideoProgressLoop();
}

const LINEUP_VIDEO_VOLUME_WHEEL_STEP = 0.05;

function handleLineupVideoVolumeWheel(event) {
  const overlay = document.getElementById("lineup-video-overlay");
  const player = document.getElementById("lineup-video-modal-player");
  if (!overlay?.classList.contains("active") || !player || player.hidden) return;

  const direction = Math.sign(event.deltaY);
  if (direction === 0) return;

  event.preventDefault();

  if (player.muted && direction < 0) player.muted = false;

  const next = Math.max(0, Math.min(1, player.volume + -direction * LINEUP_VIDEO_VOLUME_WHEEL_STEP));
  player.volume = next;
  player.muted = next === 0;
  syncLineupVideoControlsUi();
}

function syncLineupVideoControlsUi() {
  const player = document.getElementById("lineup-video-modal-player");
  const playBtn = document.getElementById("lineup-video-play");
  const muteBtn = document.getElementById("lineup-video-mute");
  const progress = document.getElementById("lineup-video-progress");
  const volume = document.getElementById("lineup-video-volume");
  const volumeLabel = document.getElementById("lineup-video-volume-label");
  const current = document.getElementById("lineup-video-time-current");
  const duration = document.getElementById("lineup-video-time-duration");
  if (!player || !playBtn || !muteBtn || !progress || !volume || !current || !duration) return;

  const playIcon = playBtn.querySelector("i");
  if (playIcon) {
    playIcon.className = player.paused ? "ri-play-fill" : "ri-pause-fill";
  }
  playBtn.setAttribute("aria-label", player.paused ? "Play" : "Pause");

  const muteIcon = muteBtn.querySelector("i");
  if (muteIcon) {
    if (player.muted || player.volume === 0) muteIcon.className = "ri-volume-mute-line";
    else if (player.volume < 0.5) muteIcon.className = "ri-volume-down-line";
    else muteIcon.className = "ri-volume-up-line";
  }
  muteBtn.setAttribute("aria-label", player.muted ? "Unmute" : "Mute");

  const pct = player.duration ? (player.currentTime / player.duration) * 100 : 0;

  if (!lineupVideoSeekState.dragging) {
    progress.value = String(pct);
    if (current) current.textContent = formatLineupVideoTime(player.currentTime);
    updateLineupVideoProgressBars({
      playedPct: pct,
      snap: player.paused || !canAnimateHeightResize(),
    });
  }

  startLineupVideoProgressLoop();

  volume.value = String(player.muted ? 0 : player.volume);
  if (volumeLabel) {
    volumeLabel.textContent = `${Math.round((player.muted ? 0 : player.volume) * 100)}%`;
  }

  duration.textContent = formatLineupVideoTime(player.duration);
}

function closeLineupVideoModal() {
  const overlay = document.getElementById("lineup-video-overlay");
  const player = document.getElementById("lineup-video-modal-player");
  if (!overlay) return;

  syncLineupVideoModalDifficulty("");
  closeLineupVideoOptionsMenu();
  hideLineupVideoScrubPreview();
  stopLineupVideoProgressLoop();
  lineupVideoSeekState.dragging = false;
  lineupVideoSeekState.wasPlaying = false;
  if (player) {
    resetLineupVideoProgressAnimState(player);
    setLineupVideoProgressTargets(player, { playedPct: 0, bufferPct: 0, snap: true });
  }
  player?.pause();
  if (player) {
    player.onerror = null;
    player.playbackRate = 1;
    player.removeAttribute("src");
    player.load();
  }
  const scrubPlayer = document.getElementById("lineup-video-scrub-player");
  if (scrubPlayer) {
    scrubPlayer.removeAttribute("src");
    scrubPlayer.load();
  }
  setLineupVideoBuffering(overlay?.querySelector(".lineup-video-modal-body"), false);

  lineupVideoModalState.baseUrl = "";
  lineupVideoModalState.speed = 1;
  lineupVideoModalState.shouldAutoplay = false;

  overlay.classList.remove("active");
  syncBodyScrollLock();
  startLineupVideoProgressLoop();
}

function renderLineupDifficultyStarsHtml(level) {
  const n = Math.min(5, Math.max(0, Number(level) || 0));
  return Array.from({ length: 5 }, (_, i) => `<i class="ri-star-${i < n ? "fill" : "line"}"></i>`).join("");
}

function syncLineupVideoModalDifficulty(level) {
  const el = document.getElementById("lineup-video-modal-difficulty");
  if (!el) return;

  const n = Number(level);
  if (!Number.isFinite(n) || n < 1 || n > 5) {
    el.hidden = true;
    el.innerHTML = "";
    el.removeAttribute("data-lineup-difficulty");
    el.removeAttribute("aria-label");
    return;
  }

  el.hidden = false;
  el.dataset.lineupDifficulty = String(n);
  el.setAttribute("aria-label", `Difficulty: ${n} star${n === 1 ? "" : "s"}`);
  el.innerHTML = `<span class="lineup-difficulty-heading"><span class="lineup-difficulty-label">Difficulty</span><span class="lineup-difficulty-dot" aria-hidden="true"></span></span><span class="lineup-difficulty-stars" aria-hidden="true">${renderLineupDifficultyStarsHtml(n)}</span>`;
}

function openLineupVideoModal(url, title = "", difficulty = "") {
  const overlay = document.getElementById("lineup-video-overlay");
  const player = document.getElementById("lineup-video-modal-player");
  const titleEl = document.getElementById("lineup-video-modal-title");
  if (!overlay || !player || !url) return;

  if (titleEl) titleEl.textContent = title;
  syncLineupVideoModalDifficulty(difficulty);

  closeLineupVideoOptionsMenu();

  lineupVideoModalState.baseUrl = url;
  lineupVideoModalState.speed = getStoredLineupVideoSpeed();
  lineupVideoModalState.shouldAutoplay = true;

  player.muted = false;
  player.volume = 1;
  const volume = document.getElementById("lineup-video-volume");
  if (volume) volume.value = "1";
  resetLineupVideoProgressAnimState(player);
  setLineupVideoProgressTargets(player, { playedPct: 0, bufferPct: 0, snap: true });

  loadLineupVideoModalSource(url, { resumeTime: 0, autoplay: true });

  overlay.classList.add("active");
  syncBodyScrollLock();
  syncLineupVideoControlsUi();
  syncLineupVideoOptionsUi();

  document.getElementById("lineup-video-modal-close")?.focus();
}

function enhanceLineupVideoEmbeds(root = document) {
  root.querySelectorAll(".lineup-video-embed").forEach((embed) => {
    if (embed.querySelector(".lineup-video-play-trigger")) return;

    const card = embed.closest(".lineup-video-card");
    const title = card ? getLineupVideoTitle(card) : "Play lineup video";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "lineup-video-play-trigger";
    trigger.setAttribute("aria-label", `Play ${title}`);
    trigger.innerHTML = '<i class="ri-play-fill" aria-hidden="true"></i>';
    embed.appendChild(trigger);
  });
}

function initLineupVideoModal() {
  const overlay = document.getElementById("lineup-video-overlay");
  const player = document.getElementById("lineup-video-modal-player");
  const closeBtn = document.getElementById("lineup-video-modal-close");
  const playBtn = document.getElementById("lineup-video-play");
  const muteBtn = document.getElementById("lineup-video-mute");
  const progress = document.getElementById("lineup-video-progress");
  const volume = document.getElementById("lineup-video-volume");
  const modal = overlay?.querySelector(".lineup-video-modal");
  if (!overlay || !player || overlay.dataset.lineupVideoModalInit) return;
  overlay.dataset.lineupVideoModalInit = "1";

  applyLineupVideoSources();
  enhanceLineupVideoEmbeds();
  initLineupVideoOptionsMenu();
  startLineupVideoProgressLoop();

  const modalBody = overlay.querySelector(".lineup-video-modal-body");
  bindLineupVideoBufferUi(player, modalBody);
  bindLineupVideoAutoplayEvents(player);

  document.querySelectorAll(".lineup-video-grid").forEach((grid) => {
    grid.addEventListener("click", (event) => {
      if (event.target.closest(".lineup-video-agent-badge, .lineup-video-ability-badge, .lineup-video-utility-badge[data-lineup-cs2-utility]")) return;

      const embed = event.target.closest(".lineup-video-embed");
      if (!embed || !grid.contains(embed)) return;

      const card = embed.closest(".lineup-video-card");
      const src = card ? getLineupVideoUrl(card) : "";
      if (!src) return;

      openLineupVideoModal(src, card ? getLineupVideoTitle(card) : "", card?.dataset.lineupDifficulty || "");
    });
  });

  closeBtn?.addEventListener("click", closeLineupVideoModal);

  modal?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  volume?.addEventListener("wheel", handleLineupVideoVolumeWheel, { passive: false });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeLineupVideoModal();
  });

  playBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (player.paused) {
      lineupVideoModalState.shouldAutoplay = true;
      player.play().catch(() => {});
    } else {
      lineupVideoModalState.shouldAutoplay = false;
      player.pause();
    }
    syncLineupVideoControlsUi();
  });

  muteBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    player.muted = !player.muted;
    if (!player.muted && player.volume === 0) player.volume = 0.5;
    syncLineupVideoControlsUi();
  });

  progress?.addEventListener("pointerdown", (event) => {
    if (!player.duration || player.hidden) return;
    stopLineupVideoProgressLoop();
    lineupVideoSeekState.dragging = true;
    lineupVideoSeekState.wasPlaying = !player.paused;
    lineupVideoSeekState.lastScrubCaptureAt = 0;
    player.pause();
    document.getElementById("lineup-video-progress-wrap")?.classList.add("is-dragging");

    const rect = progress.getBoundingClientRect();
    if (rect.width) {
      const pct = ((event.clientX - rect.left) / rect.width) * 100;
      progress.value = String(Math.max(0, Math.min(100, pct)));
      handleLineupVideoProgressInput();
    }

    progress.setPointerCapture(event.pointerId);
  });

  progress?.addEventListener("pointermove", (event) => {
    if (!lineupVideoSeekState.dragging || player.hidden || !player.duration) return;

    const rect = progress.getBoundingClientRect();
    if (!rect.width) return;
    const pct = ((event.clientX - rect.left) / rect.width) * 100;
    progress.value = String(Math.max(0, Math.min(100, pct)));
    handleLineupVideoProgressInput();
  });

  progress?.addEventListener("input", () => {
    if (!lineupVideoSeekState.dragging) {
      lineupVideoSeekState.dragging = true;
      lineupVideoSeekState.wasPlaying = !player.paused;
      player.pause();
      document.getElementById("lineup-video-progress-wrap")?.classList.add("is-dragging");
    }
    handleLineupVideoProgressInput();
  });

  progress?.addEventListener("pointerup", finishLineupVideoProgressSeek);
  progress?.addEventListener("pointercancel", finishLineupVideoProgressSeek);
  progress?.addEventListener("change", finishLineupVideoProgressSeek);
  progress?.addEventListener("blur", finishLineupVideoProgressSeek);
  progress?.addEventListener("keyup", (event) => {
    if (!lineupVideoSeekState.dragging) return;
    if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) {
      finishLineupVideoProgressSeek();
    }
  });

  volume?.addEventListener("input", () => {
    player.volume = Number(volume.value);
    player.muted = player.volume === 0;
    syncLineupVideoControlsUi();
  });

  player.addEventListener("timeupdate", () => {
    if (lineupVideoSeekState.dragging) return;
    syncLineupVideoControlsUi();
  });
  player.addEventListener("progress", syncLineupVideoBufferUi);
  player.addEventListener("loadeddata", syncLineupVideoBufferUi);
  player.addEventListener("canplay", syncLineupVideoBufferUi);
  player.addEventListener("canplaythrough", syncLineupVideoBufferUi);
  player.addEventListener("loadedmetadata", () => {
    syncLineupVideoScrubPlayer();
    syncLineupVideoControlsUi();
    syncLineupVideoOptionsUi();
  });
  player.addEventListener("play", () => {
    syncLineupVideoControlsUi();
    startLineupVideoProgressLoop();
  });
  player.addEventListener("pause", () => {
    syncLineupVideoControlsUi();
  });
  player.addEventListener("volumechange", syncLineupVideoControlsUi);
  player.addEventListener("ended", () => {
    syncLineupVideoControlsUi();
  });

  player.addEventListener("click", () => {
    if (player.paused) {
      lineupVideoModalState.shouldAutoplay = true;
      player.play().catch(() => {});
    } else {
      lineupVideoModalState.shouldAutoplay = false;
      player.pause();
    }
    syncLineupVideoControlsUi();
  });

  document.addEventListener("keydown", (event) => {
    if (!overlay.classList.contains("active")) return;
    if (event.key === "Escape") {
      if (closeLineupVideoOptionsMenu()) {
        event.preventDefault();
        return;
      }
      closeLineupVideoModal();
      return;
    }
    if (event.key === " " && !event.target.closest("input, textarea, select, button")) {
      if (player.hidden) return;
      event.preventDefault();
      if (player.paused) player.play().catch(() => {});
      else player.pause();
      syncLineupVideoControlsUi();
    }
  });
}

function initLineupPanelResizeAnimations() {
  document.querySelectorAll(".lineup-filters-panel").forEach((el) => {
    bindHeightResizeAnimation(el, { durationMs: 500 });
  });
}

function scheduleLineupVideosScrollStateUpdate() {
  clearTimeout(lineupGridAnimationState.resizeDebounceId);
  lineupGridAnimationState.resizeDebounceId = setTimeout(() => {
    updateLineupVideosScrollState();
  }, 120);
}

function initLineupGameDropdown() {
  const dropdown = document.getElementById("lineup-game-selector");
  const trigger = document.getElementById("lineup-game-trigger");
  const list = document.getElementById("lineup-game-list");
  const clearBtn = document.getElementById("lineup-game-clear");
  if (!dropdown || !trigger || !list || initLineupGameDropdown._init) return;
  initLineupGameDropdown._init = true;

  const close = () => {
    dropdown.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    unmountPrefDropdownPortal(list);
  };

  const open = () => {
    hideAllGameDropdownLists();
    hideLineupMapList();
    dropdown.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.classList.remove("hidden");
    mountPrefDropdownPortal(list, trigger);
  };

  initLineupGameDropdown.close = close;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("is-open")) close();
    else open();
  });

  clearBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearLineupGame();
  });

  list.querySelectorAll("[data-lineup-game]").forEach((opt) => {
    opt.addEventListener("click", () => {
      const value = opt.dataset.lineupGame;
      if (!LINEUP_GAMES.has(value) || value === getActiveLineupGame()) {
        close();
        return;
      }
      setLineupGame(value);
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
}

function initLineupTab() {
  const selector = document.getElementById("lineup-game-selector");
  if (!selector) return;

  initLineupPanelResizeAnimations();
  initLineupGameDropdown();
  initLineupMapDropdown();
  initLineupVideoModal();
  initLineupBadgeInfoPopovers();
  syncLineupGameSelectorUi();
  syncLineupFiltersUiControls();
  const activeGame = getActiveLineupGame();
  renderLineupMapOptions(activeGame);
  syncLineupMapDropdownUi(activeGame);
  switchLineupGamePanels(activeGame);
  applyLineupGridStateInstant();
  window.addEventListener("resize", scheduleLineupVideosScrollStateUpdate);

  const sideSelector = document.getElementById("lineup-side-selector");
  sideSelector?.addEventListener("click", (event) => {
    const btn = event.target.closest(".toggle-btn[data-lineup-side]");
    if (!btn || btn.classList.contains("active")) return;
    setLineupSide(btn.dataset.lineupSide);
  });

  document.getElementById("lineup-difficulty-filter")?.addEventListener("click", (event) => {
    const btn = event.target.closest(".lineup-difficulty-tag[data-lineup-difficulty]");
    if (!btn) return;
    toggleLineupDifficulty(btn.dataset.lineupDifficulty);
  });

  const searchInput = document.getElementById("lineup-search");
  const clearBtn = document.getElementById("lineup-search-clear");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const game = getActiveLineupGame();
      if (!game) return;
      localStorage.setItem(`${LINEUP_SEARCH_STORAGE_PREFIX}${game}`, searchInput.value);
      if (clearBtn) clearBtn.style.display = searchInput.value.trim() ? "flex" : "none";
      applyLineupSearchHighlights(game);
      clearTimeout(lineupGridAnimationState.searchDebounceId);
      lineupGridAnimationState.searchDebounceId = setTimeout(() => {
        applyLineupFilters();
      }, 350);
    });
  }
  if (clearBtn && searchInput) {
    clearBtn.addEventListener("click", () => {
      searchInput.value = "";
      setLineupSearch("");
      searchInput.focus();
    });
  }
}

function switchTab(_evt, id, { updateHistory = true } = {}) {
  if (id === "lineup-tab" && !LINEUP_TAB_ENABLED) return;

  if (id === "aim-training-tab" && isMobileViewport()) {
    id = "sensitivity-converter-tab";
  }

  document.querySelectorAll(".section").forEach((s) => (s.style.display = "none"));
  document.querySelectorAll(".app-sidebar-more-item.active").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".app-sidebar-misc-item.active").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".nav-bar .button-container .button, .nav-more-button, #nav-more-toggle, .nav-misc-button, #nav-misc-toggle").forEach((b) => b.classList.remove("active"));

  const target = document.getElementById(id);
  if (target) target.style.display = "flex";

  const moreToggle = document.getElementById("sidebar-more-button");
  const miscToggle = document.getElementById("sidebar-misc-button");

  if (FOOTER_TAB_IDS.has(id)) {
    document.querySelectorAll(".app-sidebar-item").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".nav-more-button").forEach((b) => b.classList.remove("active"));
    const footerBtn = document.getElementById(FOOTER_BUTTON_IDS[id]);
    if (footerBtn) footerBtn.classList.add("active");
    document.querySelector(`.nav-more-button[data-nav-tab="${id}"]`)?.classList.add("active");
    document.getElementById("nav-more-toggle")?.classList.add("active");
    moreToggle?.classList.add("active");
    miscToggle?.classList.remove("active");
  } else if (MISC_TAB_IDS.has(id)) {
    document.querySelectorAll(".app-sidebar-item").forEach((b) => b.classList.remove("active"));
    miscToggle?.classList.add("active");
    document.querySelector(`.app-sidebar-misc-item[data-sidebar-tab="${id}"]`)?.classList.add("active");
    document.querySelector(`.nav-misc-button[data-nav-tab="${id}"]`)?.classList.add("active");
    document.getElementById("nav-misc-toggle")?.classList.add("active");
    moreToggle?.classList.remove("active");
  } else {
    document.querySelectorAll(".app-sidebar-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sidebarTab === id);
    });
    document.querySelectorAll(".nav-more-button").forEach((b) => b.classList.remove("active"));
    document.getElementById("nav-more-toggle")?.classList.remove("active");
    moreToggle?.classList.remove("active");
    miscToggle?.classList.remove("active");
    const navBtn = NAV_BUTTON_IDS[id] ? document.getElementById(NAV_BUTTON_IDS[id]) : null;
    if (navBtn) navBtn.classList.add("active");
  }

  closeMobileNavMenu();
  setAppMoreMenuOpen(false);
  setAppMiscMenuOpen(false);

  if (SENS_SUGGESTION_HIDDEN_TABS.has(id)) {
    hideSensSuggestion();
  }

  if (id === "aim-training-tab") {
    setTimeout(() => {
      aimTrainer.handleResize();
      aimTrainer.updateAllGliders();
      aimTrainer.resumeLoop();
    }, 50);
  } else if (!aimTrainer.shouldRunLoop?.()) {
    aimTrainer.stopLoop?.();
  }

  if (id === "sensitivity-converter-tab" || id === "privacy-policy-tab" || id === "terms-of-service-tab") {
    if (id === "sensitivity-converter-tab") {
      updateConversion();
    }
  } else if (id === "edpi-calculator-tab") {
    updateEDPI();
  } else if (id === "crosshair-converter-tab") {
    setTimeout(() => {
      updateCrosshairConverterUi?.();
      updateAllToggleGliders();
    }, 50);
  } else if (id === "viewmodel-generator-tab") {
    setTimeout(() => {
      initViewmodelGeneratorTab?.();
      updateViewmodelGeneratorUi?.();
    }, 50);
  } else if (id === "settings-tab") {
    setTimeout(() => {
      aimTrainer.drawCrosshairPreview();
    }, 50);
  } else if (id === "stats-tab") {
    setTimeout(() => aimTrainer.displayResultsOnProfile(), 50);
  } else if (id === "lineup-tab") {
    setTimeout(() => {
      applyLineupVideoSources();
      syncLineupFiltersUiControls();
      applyLineupGridStateInstant();
      refreshLineupVideosFixedHeight();
      updateAllToggleGliders();
    }, 50);
  }
  updateGameInfoPanelVisibility();
  toggleProfileSensConvButtons();

  if (updateHistory && !isInitialRoute) {
    syncUrlToTab(id);
  }
}

function toggleResetButton() {
  const resetBtn = document.getElementById("reset-btn");
  if (!resetBtn) return;
  const isDefault = elements["from-search"].value === "" && elements["to-search"].value === "" && elements["base-sens"].value === "" && elements["from-dpi"].value === "800" && elements["to-dpi"].value === "800";
  toggleVisibility(resetBtn, !isDefault);
}

function toggleEDPIResetButton() {
  const resetBtn = document.getElementById("edpi-reset");
  if (!resetBtn) return;
  const gameVal = elements["edpi-game-search"].value;
  const sensVal = elements["edpi-sens"].value;
  const dpiVal = document.getElementById("edpi-dpi").value;
  const isDefault = gameVal === "" && (sensVal === "" || sensVal === "0") && (dpiVal === "" || dpiVal === "0");
  toggleVisibility(resetBtn, !isDefault);
}

function toggleProfileSensConvButtons() {
  const pResetBtn = document.getElementById("profile-sens-conv-reset");
  const pCopyBtn = document.getElementById("profile-sens-conv-copy");
  const profileDisplay = document.getElementById("last-sens-conv");
  const pVal = profileDisplay ? profileDisplay.innerText.trim() : "";
  const hasSens = pVal !== "" && pVal !== "0.00" && pVal !== "0" && pVal !== "-";

  if (pResetBtn) toggleVisibility(pResetBtn, hasSens);
  if (pCopyBtn) toggleVisibility(pCopyBtn, hasSens);

  const eResetBtn = document.getElementById("profile-edpi-calc-reset");
  const eCopyBtn = document.getElementById("profile-edpi-calc-copy");
  const edpiDisplay = document.getElementById("last-edpi-calc");
  const eVal = edpiDisplay ? edpiDisplay.innerText.trim() : "";
  const hasEdpi = eVal !== "" && eVal !== "0" && eVal !== "0.00" && eVal !== "-";

  if (eResetBtn) toggleVisibility(eResetBtn, hasEdpi);
  if (eCopyBtn) toggleVisibility(eCopyBtn, hasEdpi);

  const { game, mode, timer } = getProfileAimContext();
  if (!game) {
    syncProfileAimResetVisibility([], null);
    return;
  }

  const histKey = `aimHistory_${game}_${mode}_${timer}`;
  let hist = [];
  try {
    hist = JSON.parse(localStorage.getItem(histKey) || "[]");
  } catch (e) {}
  syncProfileAimResetVisibility(hist, resolveProgressChartSelectedDay(hist));
}

function updateConversion() {
  const fromGame = elements["from-search"].value,
    toGame = elements["to-search"].value,
    baseSens = elements["base-sens"].value,
    fDpi = parseFloat(elements["from-dpi"].value),
    tDpi = parseFloat(elements["to-dpi"].value),
    display = elements["new-sens-value"],
    copyBtn = document.getElementById("copy-btn"),
    shareBtn = document.getElementById("sens-share-btn");

  ["from", "to"].forEach((id) => {
    const btn = document.getElementById(`${id}-clear`),
      input = document.getElementById(`${id}-search`);
    if (btn && input) btn.style.display = input.value ? "flex" : "none";
  });

  toggleResetButton();
  updateGameInfoPanelVisibility();

  if (!display) return;

  const sens = parseFloat(baseSens.replace(",", "."));
  const fromFactor = gameMultipliers[fromGame];
  const toFactor = gameMultipliers[toGame];

  if (fromGame) {
    localStorage.setItem("fromGame", fromGame);
    const pFrom = document.getElementById("profile-from-game");
    if (pFrom) pFrom.innerText = fromGame;
  }
  if (toGame) {
    localStorage.setItem("toGame", toGame);
    const pTo = document.getElementById("profile-to-game");
    if (pTo) pTo.innerText = toGame;
  }

  if (!fromGame || !toGame || baseSens === "" || isNaN(fDpi) || isNaN(tDpi) || isNaN(sens) || !fromFactor || !toFactor || sens <= 0 || fDpi <= 0 || tDpi <= 0) {
    display.innerText = "0.00";
    toggleVisibility(copyBtn, false);
    toggleVisibility(shareBtn, false);
    toggleProfileSensConvButtons();
    updateGameInfoPanelVisibility();
    return;
  }

  const result = (sens * (toFactor / fromFactor) * (fDpi / tDpi)).toFixed(3);
  display.innerText = result;

  if (parseFloat(result) > 0) {
    localStorage.setItem("lastSensConv", result);
    localStorage.setItem("lastBaseSens", baseSens);
    localStorage.setItem("lastFromDpi", fDpi);
    localStorage.setItem("lastToDpi", tDpi);

    const profileDisplay = document.getElementById("last-sens-conv");
    const pBaseSens = document.getElementById("profile-base-sens");
    const pFromDpi = document.getElementById("profile-from-dpi");
    const pToDpi = document.getElementById("profile-to-dpi");

    if (profileDisplay) profileDisplay.innerText = result;
    if (pBaseSens) pBaseSens.innerText = baseSens;
    if (pFromDpi) pFromDpi.innerText = fDpi;
    if (pToDpi) pToDpi.innerText = tDpi;
  } else {
    localStorage.removeItem("lastSensConv");
  }

  toggleProfileSensConvButtons();
  updateGameInfoPanelVisibility();
  const hasResult = parseFloat(result) > 0;
  toggleVisibility(copyBtn, hasResult);
  toggleVisibility(shareBtn, hasResult);
}

window.addEventListener("storage", (e) => {
  if (e.key === "lastSensConv") {
    const profileDisplay = document.getElementById("last-sens-conv");
    if (profileDisplay) {
      profileDisplay.innerText = e.newValue || "0.00";
    }
    toggleProfileSensConvButtons();
    updateGameInfoPanelVisibility();
  }
  if (e.key === "lastEdpiCalc") {
    const pEdpi = document.getElementById("last-edpi-calc");
    if (pEdpi) pEdpi.innerText = e.newValue || "0.00";
    toggleProfileSensConvButtons();
    updateGameInfoPanelVisibility();
  }
  if (e.key === "lastEdpiColor") {
    const pDot = document.getElementById("profile-edpi-status-dot");
    if (pDot) {
      if (e.newValue) {
        pDot.style.display = "block";
        pDot.style.backgroundColor = e.newValue;
      } else {
        pDot.style.display = "none";
      }
    }
  }
});

const tacticalAdvice = {
  General: {
    low: ["Large mousepad required. You'll need the extra surface area for big arm swipes.", "Focus on arm aiming. Use your arm as the pivot point for large turns.", "Great for long-range precision. You'll find clicking heads at a distance much easier.", "Crosshair placement is key. Since flicking is slower, keep your aim where enemies will appear.", "Warm up your shoulder and elbow. Low sens is more physically demanding over long sessions.", "Perfect for 'Tac-Shooters'. Most tactical pros prefer this range for consistent clicking."],
    average: ["The 'Golden Ratio'. You have enough speed for 180s and enough control for micro-adjustments.", "Hybrid aiming style. Use your arm for large turns and your wrist for fine-tuning.", "Very versatile. This sensitivity works well across different roles and agent types.", "Easier to track moving targets. The balance helps keep your crosshair glued to enemies.", "Lower fatigue. You don't have to move your whole arm as much as low-sens players.", "Standard Pro range. Most top-tier players in Valorant and CS2 land in this bracket."],
    high: ["Wrist-heavy aiming. Use small, precise flick motions rather than large arm sweeps.", "Lighting fast 180s. You can react to flankers much faster than low-sens players.", "High precision mouse needed. Ensure your sensor can handle micro-movements without jitter.", "Keep a light grip. Tensing your hand too much will make your aim shaky at high speeds.", "Great for verticality. If you play agents with movement abilities, high sens helps you keep up.", "Focus on smoothness. Practice 'smooth tracking' drills to avoid jumpy crosshair movement."],
  },
  Valorant: {
    low: ["Valorant: Large mousepad required. You'll need the extra surface area for big arm swipes.", "Valorant: Focus on arm aiming. Use your elbow as the pivot point for large turns.", "Valorant: Great for long-range precision. You'll find clicking heads at a distance much easier.", "Valorant: Crosshair placement is key. Since flicking is slower, keep your aim where enemies will appear.", "Valorant: Warm up your shoulder and elbow. Low sens is more physically demanding over long sessions.", "Valorant: Perfect for 'Tac-Shooters'. Most tactical pros prefer this range for consistent clicking."],
    average: ["Valorant: The 'Golden Ratio'. You have enough speed for 180s and enough control for micro-adjustments.", "Valorant: Hybrid aiming style. Use your arm for large turns and your wrist for fine-tuning.", "Valorant: Very versatile. This sensitivity works well across different roles and agent types.", "Valorant: Easier to track moving targets. The balance helps keep your crosshair glued to enemies.", "Valorant: Lower fatigue. You don't have to move your whole arm as much as low-sens players.", "Valorant: Standard Pro range. Most top-tier players in Valorant and CS2 land in this bracket."],
    high: ["Valorant: Wrist-heavy aiming. Use small, precise flick motions rather than large arm sweeps.", "Valorant: Lighting fast 180s. You can react to flankers much faster than low-sens players.", "Valorant: High precision mouse needed. Ensure your sensor can handle micro-movements without jitter.", "Valorant: Keep a light grip. Tensing your hand too much will make your aim shaky at high speeds.", "Valorant: Great for verticality. If you play agents with movement abilities, high sens helps you keep up.", "Valorant: Focus on smoothness. Practice 'smooth tracking' drills to avoid jumpy crosshair movement."],
  },
  CS2: {
    low: ["CS2: Large mousepad required. You'll need the extra surface area for big arm swipes.", "CS2: Focus on arm aiming. Use your elbow as the pivot point for large turns.", "CS2: Great for long-range precision. You'll find clicking heads at a distance much easier.", "CS2: Crosshair placement is key. Since flicking is slower, keep your aim where enemies will appear.", "CS2: Warm up your shoulder and elbow. Low sens is more physically demanding over long sessions.", "CS2: Perfect for 'Tac-Shooters'. Most tactical pros prefer this range for consistent clicking."],
    average: ["CS2: The 'Golden Ratio'. You have enough speed for 180s and enough control for micro-adjustments.", "CS2: Hybrid aiming style. Use your arm for large turns and your wrist for fine-tuning.", "CS2: Very versatile. This sensitivity works well across different roles and agent types.", "CS2: Easier to track moving targets. The balance helps keep your crosshair glued to enemies.", "CS2: Lower fatigue. You don't have to move your whole arm as much as low-sens players.", "CS2: Standard Pro range. Most top-tier players in Valorant and CS2 land in this bracket."],
    high: ["CS2: Wrist-heavy aiming. Use small, precise flick motions rather than large arm sweeps.", "CS2: Lighting fast 180s. You can react to flankers much faster than low-sens players.", "CS2: High precision mouse needed. Ensure your sensor can handle micro-movements without jitter.", "CS2: Keep a light grip. Tensing your hand too much will make your aim shaky at high speeds.", "CS2: Great for verticality. If you play agents with movement abilities, high sens helps you keep up.", "CS2: Focus on smoothness. Practice 'smooth tracking' drills to avoid jumpy crosshair movement."],
  },
  "Call of Duty: Black Ops 7": {
    low: ["CoD: Best for holding lanes and long-range AR beams.", "CoD: Slide-canceling and 180s will be more physically demanding.", "CoD: Superior stability for high-magnification sniper scopes."],
    average: ["CoD: The versatile choice for SMG rushing and AR anchoring.", "CoD: Balanced for reactive flicking and target switching.", "CoD: Good for tracking through fast movement and omnimovement dives."],
    high: ["CoD: Essential for ultra-aggressive play and rapid room clearing.", "CoD: Reactive 180s to counter enemies coming from any direction.", "CoD: Perfect for tracking high-speed targets in close-quarters combat."],
  },
  "Rainbow Six Siege": {
    low: ["Siege: Pixel-perfect angle holding. Ideal for anchors on site.", "Siege: High stability for one-tap headshots through barricades.", "Siege: Focus on crosshair placement as room clearing requires arm swipes."],
    average: ["Siege: Great for flex players who switch between entry and support.", "Siege: Balanced for clearing utility and hitting moving targets.", "Siege: Enough control to hold tight peeks while still being able to flick."],
    high: ["Siege: Faster target acquisition when clearing multiple rooms.", "Siege: Easier to react to roamers and flankers behind you.", "Siege: Ideal for high-mobility ops and quick-scope entries."],
  },
  "Escape From Tarkov": {
    low: ["EFT: Maximum precision for long-distance sniping on Woods or Shoreline.", "EFT: Inertia feels heavy; low sens encourages deliberate movement.", "EFT: Superior control for managing horizontal recoil at a distance."],
    average: ["EFT: The standard for most PMC engagements and CQB.", "EFT: Balanced for loot-goblin speed and tactical precision.", "EFT: Good for tracking moving targets while wearing heavy armor."],
    high: ["EFT: Faster 180s to check your six in high-tension areas.", "EFT: Easier to manage mouse movement with heavy gear penalties.", "EFT: Better for aggressive 'point-firing' in close quarters."],
  },
  "Apex Legends": {
    low: ["Apex: Superior stability for long-range poke and sniping.", "Apex: Harder to track fast Octanes or Pathfinders up close.", "Apex: Focus on positioning; your arm will workout in close-range 1v1s."],
    average: ["Apex: Balanced for R-99 tracking and Peacekeeper flicks.", "Apex: The sweet spot for most Legends, providing mobility and control.", "Apex: Great for tracking through Horizon lifts and Valkyrie launches."],
    high: ["Apex: Essential for reactive tracking against strafing targets.", "Apex: Makes movement tech like tap-strafing much easier.", "Apex: Perfect for close-quarters submachine gun tracking."],
  },
  "ARC Raiders": {
    low: ["ARC: Best for precision shots on machine weakpoints.", "ARC: Stable aim for long-range scouting and sniper support.", "ARC: Arm movements are key for tracking large, slow-moving enemies."],
    average: ["ARC: Balanced for third-person perspective and combat mobility.", "ARC: Good for tracking flying drones and moving Raider units.", "ARC: The standard range for a mix of melee and ranged combat."],
    high: ["ARC: Quick reactions to unexpected machine ambushes.", "ARC: Faster 360-degree awareness in vertical environments.", "ARC: Essential for high-octane close-quarters evasion."],
  },
  "Overwatch 2": {
    low: ["OW2: Ideal for Hitscan heroes like Cassidy, Ashe, and Widowmaker.", "OW2: Very difficult for high-mobility heroes like Genji or Tracer.", "OW2: Precision is key; focus on headclick consistency."],
    average: ["OW2: The ultimate 'Flex' sensitivity. Handles most heroes well.", "OW2: Balanced for tracking as Soldier: 76 and flicking as Sojourn.", "OW2: Great for dealing with vertical movement from Pharah or Echo."],
    high: ["OW2: Necessary for Tracer blinks and Genji Dragonblade swings.", "OW2: Reactive tracking for fast-paced close-range tank brawls.", "OW2: Better for heroes that require frequent 180-degree turns."],
  },
  "Delta Force": {
    low: ["Delta Force: Precision is king in large-scale battlefield combat.", "Delta Force: Stable aim for vehicles and long-range tactical ops.", "Delta Force: Best for sniper specialists and designated marksmen."],
    average: ["Delta Force: Versatile for both infantry combat and vehicle gunning.", "Delta Force: Balanced for tracking infantry and reactive flicking.", "Delta Force: Good for mid-range engagements and clearing buildings."],
    high: ["Delta Force: Faster reaction times in hectic urban firefights.", "Delta Force: Easier to clear corners in high-risk zones.", "Delta Force: Best for high-speed assault roles and CQC."],
  },
  Fortnite: {
    low: ["Fortnite: Unrivaled shotgun precision. Every pellet counts.", "Fortnite: Editing and building will require significant arm movement.", "Fortnite: Best for passive play and long-range AR beams."],
    average: ["Fortnite: The hybrid choice for fast building and accurate aiming.", "Fortnite: Smooth enough for consistent piece control and box fighting.", "Fortnite: Great balance for rotating and tracking in end-game zones."],
    high: ["Fortnite: Flashy edits and rapid piece control are much easier.", "Fortnite: Reactive 180-degree box flips to counter unexpected players.", "Fortnite: Building is effortless, but keep a steady hand for AR tracking."],
  },
  Roblox: {
    low: ["Roblox: Best for FPS titles requiring high precision and control.", "Roblox: Stable aim for obstacle courses and long-range combat.", "Roblox: Focus on arm movement for consistent camera control."],
    average: ["Roblox: The versatile standard for a wide variety of mini-games.", "Roblox: Balanced for both casual play and competitive shooters.", "Roblox: Good for tracking moving parts in fast-paced games."],
    high: ["Roblox: Quick reactions for high-speed obstacle courses (Obbys).", "Roblox: Faster camera movement for casual social exploration.", "Roblox: Essential for fast-paced sword fighting or CQC."],
  },
  Aimlabs: {
    low: ["Aimlabs: Focus on precision tasks like Sixshot and Microflex.", "Aimlabs: Great for developing arm-aiming muscle memory.", "Aimlabs: Higher physical exertion; take breaks during long sessions."],
    average: ["Aimlabs: The benchmark range for general aim improvement.", "Aimlabs: Balanced for both flicking and tracking scenarios.", "Aimlabs: Ideal for Gridshot speed and SphereTrack smoothness."],
    high: ["Aimlabs: Best for high-speed target switching and reactiveness.", "Aimlabs: Focus on wrist precision for small target micro-flicks.", "Aimlabs: Perfect for close-range tracking and fast reaction tasks."],
  },
  "osu!": {
    low: ["osu!: High precision for small circles and technical maps.", "osu!: Requires large physical movements; prepare for high fatigue.", "osu!: Best for accuracy-focused players on lower BPM maps."],
    average: ["osu!: The standard balance for speed and aim consistency.", "osu!: Good for jumps and streams across a wide range of star ratings.", "osu!: Versatile for most playstyles and grip types."],
    high: ["osu!: Essential for high-speed jump maps and high BPM.", "osu!: Minimize physical movement to increase tapping speed.", "osu!: Perfect for small-area tablet users or high-DPI mouse players."],
  },
  Rust: {
    low: ["Rust: Superior control for managing high-recoil AK sprays.", "Rust: Precision for long-distance roof camping and bolt-action shots.", "Rust: Low sensitivity helps smooth out shaky tracking during raids."],
    average: ["Rust: The all-rounder for farming, roaming, and base defense.", "Rust: Balanced for bow fights and automatic weapon tracking.", "Rust: Versatile enough for both long-range and close-range combat."],
    high: ["Rust: Faster 180s to spot flankers while you're farming nodes.", "Rust: Better for hectic close-range building and rapid placement.", "Rust: Easier to clear corners while moving through tight monuments."],
  },
};

function getAdvice(edpi, game) {
  const multiplier = gameMultipliers[game] || 1.0;
  const lowThreshold = 200 * multiplier;
  const midThreshold = 320 * multiplier;
  let tier;

  if (edpi < lowThreshold) tier = "low";
  else if (edpi < midThreshold) tier = "average";
  else tier = "high";

  const adviceForGame = tacticalAdvice[game] || tacticalAdvice.General;
  const options = adviceForGame[tier];
  return options[Math.floor(Math.random() * options.length)];
}

function handleInputValidation(input, callback) {
  const isDpiField = input.id.includes("-dpi"),
    isSensField = input.id === "base-sens" || input.id === "edpi-sens" || input.id === "canvas-sens";
  input.addEventListener("input", () => {
    let val = input.value;
    const start = input.selectionStart;
    if (isDpiField) {
      val = val.replace(/[^0-9]/g, "");
    } else if (isSensField) {
      val = val.replace(/[^0-9.,]/g, "");
      if (val.startsWith(".") || val.startsWith(",")) {
        val = "0" + val;
      }

      const firstSeparatorIndex = val.search(/[.,]/);
      if (firstSeparatorIndex !== -1) {
        const prefix = val.substring(0, firstSeparatorIndex + 1),
          rest = val.substring(firstSeparatorIndex + 1).replace(/[.,]/g, "");
        val = prefix + rest;
      }
    }
    if (val.length > 10) val = val.substring(0, 10);
    if (input.value !== val) {
      const needsOffset = (val.startsWith("0.") || val.startsWith("0,")) && (input.value.startsWith(".") || input.value.startsWith(","));
      input.value = val;
      input.setSelectionRange(start + (needsOffset ? 1 : 0), start + (needsOffset ? 1 : 0));
    }
    callback();
  });
  input.addEventListener("focus", function () {
    setTimeout(() => this.select(), 0);
  });
}

function initReactionTest() {
  const test = document.getElementById("reaction-test");
  const msg = document.getElementById("reaction-msg");
  const sub = document.getElementById("reaction-sub");
  const lastEl = document.getElementById("reaction-last");
  const bestEl = document.getElementById("reaction-best");
  const avgEl = document.getElementById("reaction-avg");
  if (!test || !msg) return null;

  let state = "idle";
  let goTime = 0;
  let timeoutId = null;

  const times = JSON.parse(localStorage.getItem("reactionTimes") || "[]");
  const renderStats = () => {
    if (!times.length) {
      if (lastEl) lastEl.textContent = "-";
      if (bestEl) bestEl.textContent = "-";
      if (avgEl) avgEl.textContent = "-";
      return;
    }
    if (lastEl) lastEl.textContent = times[times.length - 1] + "ms";
    if (bestEl) bestEl.textContent = Math.min(...times) + "ms";
    if (avgEl) avgEl.textContent = Math.round(times.reduce((a, b) => a + b, 0) / times.length) + "ms";
  };
  renderStats();

  const setState = (s) => {
    test.classList.remove("idle", "waiting", "go", "result", "tooearly");
    test.classList.add(s);
    state = s;
    document.getElementById("reaction-test-overlay")?.setAttribute("data-reaction-state", s);
  };

  const reset = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    setState("idle");
    msg.innerText = "Click to start";
    sub.innerText = "Wait for green, then click as fast as you can";
  };

  const startWait = () => {
    setState("waiting");
    msg.innerText = "Wait for green...";
    sub.innerText = "Don't click yet";
    timeoutId = setTimeout(
      () => {
        timeoutId = null;
        setState("go");
        msg.innerText = "CLICK!";
        sub.innerText = "";
        goTime = performance.now();
      },
      1000 + Math.random() * 2500,
    );
  };

  test.addEventListener("click", () => {
    if (state === "idle" || state === "result" || state === "tooearly") {
      startWait();
    } else if (state === "waiting") {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
      setState("tooearly");
      msg.innerText = "Too early!";
      sub.innerText = "Click to try again";
    } else if (state === "go") {
      const rt = Math.round(performance.now() - goTime);
      setState("result");
      msg.innerText = rt + " ms";
      sub.innerText = "Click to try again";
      times.push(rt);
      if (times.length > 50) times.shift();
      localStorage.setItem("reactionTimes", JSON.stringify(times));
      renderStats();
    }
  });

  return { reset };
}

function initReactionTestMenu(controls) {
  const overlay = document.getElementById("reaction-test-overlay");
  const openBtn = document.getElementById("open-reaction-test");
  const closeBtn = document.getElementById("close-reaction-test");
  if (!overlay) return;

  const close = () => {
    controls?.reset?.();
    overlay.classList.remove("active");
    syncBodyScrollLock();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const open = () => {
    overlay.classList.add("active");
    syncBodyScrollLock();
  };

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("active")) {
      e.preventDefault();
      close();
    }
  });
}

function getProfileAimContext() {
  const game = getProfileGameFilter().toUpperCase();
  const mode = normalizeTrainerMode(document.getElementById("profile-mode-dropdown")?.dataset.value || "static");
  const timer = normalizeProfileTimer(document.getElementById("profile-timer-dropdown")?.dataset.value || "15");
  return { game, mode, timer };
}

const PROFILE_FILTER_GAME_KEY = "profileFilterGame";
const DEFAULT_PROFILE_FILTER_GAME = "Aimlabs";

function getProfileGameFilter() {
  const input = document.getElementById("profile-game-search");
  if (!input) return DEFAULT_PROFILE_FILTER_GAME;
  return resolveGameFromInput(input) || input.dataset.lastValid || localStorage.getItem(PROFILE_FILTER_GAME_KEY) || DEFAULT_PROFILE_FILTER_GAME;
}

function initProfileGameFilter() {
  const input = document.getElementById("profile-game-search");
  if (!input) return;

  const saved = localStorage.getItem(PROFILE_FILTER_GAME_KEY);
  const valid = (saved && SUPPORTED_GAMES.find((g) => g.toLowerCase() === saved.toLowerCase())) || DEFAULT_PROFILE_FILTER_GAME;

  input.value = valid;
  input.dataset.lastValid = valid;
  localStorage.setItem(PROFILE_FILTER_GAME_KEY, valid);
  syncProfileGameDropdownUi(valid);
}

function ensureProfileGameValue() {
  const input = document.getElementById("profile-game-search");
  if (!input) return DEFAULT_PROFILE_FILTER_GAME;

  const resolved = resolveGameFromInput(input);
  if (resolved) {
    input.value = resolved;
    input.dataset.lastValid = resolved;
    localStorage.setItem(PROFILE_FILTER_GAME_KEY, resolved);
    syncProfileGameDropdownUi(resolved);
    return resolved;
  }

  const restored = input.dataset.lastValid || localStorage.getItem(PROFILE_FILTER_GAME_KEY) || DEFAULT_PROFILE_FILTER_GAME;
  const validRestore = SUPPORTED_GAMES.find((g) => g.toLowerCase() === restored.toLowerCase()) || DEFAULT_PROFILE_FILTER_GAME;

  input.value = validRestore;
  input.dataset.lastValid = validRestore;
  localStorage.setItem(PROFILE_FILTER_GAME_KEY, validRestore);
  syncProfileGameDropdownUi(validRestore);
  return validRestore;
}

function resolveGameFromInput(input, listId) {
  if (!input) return null;
  const val = input.value.trim();
  if (!val) return null;
  const list = document.getElementById(listId || input.id.replace("-search", "-list"));
  if (!list) return null;

  const options = Array.from(list.querySelectorAll(".pref-dropdown-option"));
  const getOptionName = (opt) => getGameOptionLabel(opt);
  const exact = options.find((opt) => getOptionName(opt).toLowerCase() === val.toLowerCase());
  if (exact) return getOptionName(exact);

  const partial = options.find((opt) => getOptionName(opt).toLowerCase().startsWith(val.toLowerCase()));
  return partial ? getOptionName(partial) : null;
}

function syncGameClearButton(inputId, clearId) {
  const input = document.getElementById(inputId);
  const clearBtn = document.getElementById(clearId);
  if (!input || !clearBtn) return;
  const hasValue = Boolean(input.value.trim());
  clearBtn.hidden = !hasValue;
  clearBtn.style.display = hasValue ? "flex" : "none";
}

function clearAimHistoryForGame(game) {
  const prefix = `aimHistory_${game.toUpperCase()}_`;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix)) localStorage.removeItem(key);
  }
}

function clearAimHistoryForDay(game, mode, timer, dayKey) {
  const histKey = `aimHistory_${game}_${mode}_${timer}`;
  let hist = [];
  try {
    hist = JSON.parse(localStorage.getItem(histKey) || "[]");
  } catch (e) {}
  const { start, end } = getProgressDayWindow(dayKey);
  const remaining = hist.filter((entry) => !(entry?.ts >= start && entry?.ts <= end));
  if (remaining.length) localStorage.setItem(histKey, JSON.stringify(remaining));
  else localStorage.removeItem(histKey);
  return remaining;
}

function getProfilePersonalBest(game, mode, timer) {
  try {
    return JSON.parse(localStorage.getItem(`bestAimResults_${game}_${mode}_${timer}`) || "null");
  } catch (e) {
    return null;
  }
}

function profileAimResetWouldClear(game, mode, timer, hist, selectedDay) {
  if (!game) return false;
  const hasBest = !!getProfilePersonalBest(game, mode, timer);
  const hasDaySessions = !!selectedDay && getProgressSessionsForDay(hist || [], selectedDay).length > 0;
  return hasBest || hasDaySessions;
}

function buildProfileAimResetMessage(game, mode, timer, hist, selectedDay) {
  const hasBest = !!getProfilePersonalBest(game, mode, timer);
  const hasDaySessions = !!selectedDay && getProgressSessionsForDay(hist || [], selectedDay).length > 0;
  const dayLabel = selectedDay ? formatProgressDayLabel(selectedDay) : "";
  if (hasBest && hasDaySessions) return `Clear personal best and sessions on ${dayLabel}?`;
  if (hasBest) return "Clear personal best for this filter?";
  return `Clear sessions on ${dayLabel}?`;
}

function performProfileAimReset(game, mode, timer, selectedDay) {
  if (selectedDay) clearAimHistoryForDay(game, mode, timer, selectedDay);
  localStorage.removeItem(`bestAimResults_${game}_${mode}_${timer}`);
  hideProgressChartTooltip();
  aimTrainer.displayResultsOnProfile();
  requestProfileChartsRedraw();
}

function syncProfileAimResetVisibility(hist, selectedDay) {
  const aimResetBtn = document.getElementById("profile-aim-reset");
  if (!aimResetBtn) return;
  const { game, mode, timer } = getProfileAimContext();
  toggleVisibility(aimResetBtn, profileAimResetWouldClear(game, mode, timer, hist, selectedDay));
}

function measureStatsCanvasSize(canvas, fallbackH) {
  if (!canvas) return null;
  const style = getComputedStyle(canvas);
  const parent = canvas.parentElement;
  const fallback = fallbackH || 200;

  let cssH = canvas.offsetHeight;
  const declaredH = parseFloat(style.height);
  if (declaredH > 0 && (cssH < 1 || cssH < declaredH * 0.75)) cssH = declaredH;
  if (cssH < 1) cssH = fallback;

  let cssW = 1;
  if (parent?.clientWidth > 0) {
    const parentStyle = getComputedStyle(parent);
    const padX = parseFloat(parentStyle.paddingLeft) + parseFloat(parentStyle.paddingRight);
    cssW = parent.clientWidth - padX;
  }
  if (cssW < 1) {
    cssW = canvas.getBoundingClientRect().width;
  }

  return {
    cssW: Math.max(Math.round(cssW), 1),
    cssH: Math.max(Math.round(cssH), 1),
  };
}

function syncCanvasDisplaySize(canvas, cssH) {
  canvas.style.width = "100%";
  canvas.style.maxWidth = "100%";
  canvas.style.height = `${cssH}px`;
}

function prepareStatsCanvas(canvas, fallbackH) {
  if (!canvas) return null;
  const measured = measureStatsCanvasSize(canvas, fallbackH);
  if (!measured) return null;

  const { cssW, cssH } = measured;
  syncCanvasDisplaySize(canvas, cssH);

  const dpr = window.devicePixelRatio || 1;
  const pixelW = Math.round(cssW * dpr);
  const pixelH = Math.round(cssH * dpr);
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = pixelW;
    canvas.height = pixelH;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  return { ctx, cssW, cssH };
}

function scheduleProfileChartsRender(fn) {
  cancelAnimationFrame(scheduleProfileChartsRender._frame || 0);
  scheduleProfileChartsRender._frame = requestAnimationFrame(() => {
    scheduleProfileChartsRender._frame = requestAnimationFrame(fn);
  });
}

function requestProfileChartsRedraw() {
  scheduleProfileChartsRender(() => {
    const statsTab = document.getElementById("stats-tab");
    if (!statsTab || statsTab.style.display === "none") return;
    aimTrainer.redrawProfileCharts();
  });
}

function initProfileChartsWatcher() {
  if (initProfileChartsWatcher._init) return;
  if (typeof ResizeObserver === "undefined") return;
  initProfileChartsWatcher._init = true;

  const ro = new ResizeObserver(() => requestProfileChartsRedraw());
  const watch = (el) => el && ro.observe(el);

  watch(document.querySelector("#stats-tab .profile-stats-sections"));
  watch(document.querySelector("#stats-tab .result-container"));
  watch(document.getElementById("profile-best-spatial-canvas"));
  watch(document.getElementById("profile-best-precision-canvas"));
  watch(document.getElementById("aim-progress-canvas"));
  document.querySelectorAll("#stats-tab .aim-trainer-score-boxes-holder").forEach(watch);

  const statsTab = document.getElementById("stats-tab");
  if (statsTab) {
    new MutationObserver(() => requestProfileChartsRedraw()).observe(statsTab, {
      attributes: true,
      attributeFilter: ["style"],
    });
  }

  initProgressChartInteraction();
  initProgressChartCalendar();
}

let progressChartHoverIndex = -1;
const PROGRESS_CHART_DATE_KEY = "prefProgressChartDate";
const PROGRESS_CHART_HEIGHT = 228;
const PROGRESS_CHART_PAD = { x: 18, top: 14, bottom: 16 };
let progressCalendarView = { year: new Date().getFullYear(), month: new Date().getMonth() };

function getProgressDayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseProgressDayKey(dayKey) {
  const [year, month, day] = dayKey.split("-").map(Number);
  return { year, month, day };
}

function formatProgressDayLabel(dayKey) {
  const { year, month, day } = parseProgressDayKey(dayKey);
  if (!year || !month || !day) return dayKey;
  return new Date(year, month - 1, day).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getProgressDayWindow(dayKey) {
  const { year, month, day } = parseProgressDayKey(dayKey);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
  const end = new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  return { start, end };
}

function getProgressChartSelectedDay() {
  return localStorage.getItem(PROGRESS_CHART_DATE_KEY) || getProgressDayKey(Date.now());
}

function setProgressChartSelectedDay(dayKey) {
  if (dayKey) localStorage.setItem(PROGRESS_CHART_DATE_KEY, dayKey);
  else localStorage.removeItem(PROGRESS_CHART_DATE_KEY);
}

function getProgressDaysWithData(hist) {
  const days = new Set();
  hist.forEach((entry) => {
    if (entry?.ts) days.add(getProgressDayKey(entry.ts));
  });
  return days;
}

function resolveProgressChartSelectedDay(hist) {
  const todayKey = getProgressDayKey(Date.now());
  let selected = getProgressChartSelectedDay();
  const parsed = parseProgressDayKey(selected);
  if (!parsed.year || !parsed.month || !parsed.day) selected = todayKey;

  const { start } = getProgressDayWindow(selected);
  if (start > Date.now()) {
    selected = todayKey;
    setProgressChartSelectedDay(selected);
  }
  return selected;
}

function getProgressSessionsForDay(hist, dayKey) {
  const { start, end } = getProgressDayWindow(dayKey);
  return hist.filter((entry) => entry?.ts >= start && entry?.ts <= end).sort((a, b) => a.ts - b.ts);
}

function progressChartXForTime(ts, start, end, padX, cssW) {
  const width = cssW - padX * 2;
  if (end <= start || width <= 0) return padX + width / 2;
  const clamped = Math.max(start, Math.min(end, ts));
  return padX + ((clamped - start) / (end - start)) * width;
}

function renderProgressCalendarGrid(hist) {
  const grid = document.getElementById("aim-progress-cal-grid");
  const title = document.getElementById("aim-progress-cal-title");
  if (!grid || !title) return;

  const selected = resolveProgressChartSelectedDay(hist);
  const daysWithData = getProgressDaysWithData(hist);
  const { year, month } = progressCalendarView;
  const todayKey = getProgressDayKey(Date.now());
  const todayStart = getProgressDayWindow(todayKey).start;

  title.textContent = new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const nextMonthStart = new Date(year, month + 1, 1).getTime();

  grid.innerHTML = "";
  for (let i = 0; i < startOffset; i++) {
    grid.insertAdjacentHTML("beforeend", `<span class="aim-progress-cal-empty" aria-hidden="true"></span>`);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dayKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayStart = new Date(year, month, day).getTime();
    const isFuture = dayStart > todayStart;
    const classes = ["aim-progress-cal-day", daysWithData.has(dayKey) ? "has-data" : "", dayKey === selected ? "selected" : "", dayKey === todayKey ? "today" : "", isFuture ? "future" : ""].filter(Boolean).join(" ");

    grid.insertAdjacentHTML("beforeend", `<button type="button" class="${classes}" data-day="${dayKey}"${isFuture ? " disabled" : ""} aria-label="${formatProgressDayLabel(dayKey)}">${day}</button>`);
  }

  const nextBtn = document.getElementById("aim-progress-cal-next");
  if (nextBtn) nextBtn.disabled = nextMonthStart > todayStart;
}

function syncProgressChartDateUi(hist) {
  const selected = resolveProgressChartSelectedDay(hist);
  const label = document.getElementById("aim-progress-date-label");
  if (label) label.textContent = formatProgressDayLabel(selected);

  const parsed = parseProgressDayKey(selected);
  if (parsed.year && parsed.month) {
    progressCalendarView = { year: parsed.year, month: parsed.month - 1 };
  }
  renderProgressCalendarGrid(hist);
}

function closeProgressChartCalendar() {
  const picker = document.getElementById("aim-progress-date-picker");
  const trigger = document.getElementById("aim-progress-date-trigger");
  const panel = document.getElementById("aim-progress-calendar");
  picker?.classList.remove("is-open");
  trigger?.setAttribute("aria-expanded", "false");
  panel?.classList.add("hidden");
}

function openProgressChartCalendar() {
  const picker = document.getElementById("aim-progress-date-picker");
  const trigger = document.getElementById("aim-progress-date-trigger");
  const panel = document.getElementById("aim-progress-calendar");
  picker?.classList.add("is-open");
  trigger?.setAttribute("aria-expanded", "true");
  panel?.classList.remove("hidden");
}

function initProgressChartCalendar() {
  const picker = document.getElementById("aim-progress-date-picker");
  const trigger = document.getElementById("aim-progress-date-trigger");
  const panel = document.getElementById("aim-progress-calendar");
  const grid = document.getElementById("aim-progress-cal-grid");
  const prevBtn = document.getElementById("aim-progress-cal-prev");
  const nextBtn = document.getElementById("aim-progress-cal-next");
  if (!picker || !trigger || !panel || !grid || initProgressChartCalendar._init) return;
  initProgressChartCalendar._init = true;

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (picker.classList.contains("is-open")) closeProgressChartCalendar();
    else openProgressChartCalendar();
  });

  prevBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    progressCalendarView.month -= 1;
    if (progressCalendarView.month < 0) {
      progressCalendarView.month = 11;
      progressCalendarView.year -= 1;
    }
    const { game, mode, timer } = getProfileAimContext();
    const histKey = `aimHistory_${game}_${mode}_${timer}`;
    let hist = [];
    try {
      hist = JSON.parse(localStorage.getItem(histKey) || "[]");
    } catch (err) {}
    renderProgressCalendarGrid(hist);
  });

  nextBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    progressCalendarView.month += 1;
    if (progressCalendarView.month > 11) {
      progressCalendarView.month = 0;
      progressCalendarView.year += 1;
    }
    const { game, mode, timer } = getProfileAimContext();
    const histKey = `aimHistory_${game}_${mode}_${timer}`;
    let hist = [];
    try {
      hist = JSON.parse(localStorage.getItem(histKey) || "[]");
    } catch (err) {}
    renderProgressCalendarGrid(hist);
  });

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-day]");
    if (!btn || btn.disabled) return;
    setProgressChartSelectedDay(btn.getAttribute("data-day"));
    closeProgressChartCalendar();
    hideProgressChartTooltip();
    requestProfileChartsRedraw();
  });

  document.addEventListener("click", (e) => {
    if (!picker.contains(e.target)) closeProgressChartCalendar();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && picker.classList.contains("is-open")) {
      e.preventDefault();
      closeProgressChartCalendar();
      trigger.blur();
    }
  });
}

function formatProgressTooltipHtml(entry, mode) {
  const when = new Date(entry.ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const scoreLine = isTrainerAccuracyMode(mode) ? `${entry.score}% accuracy` : `${entry.score} hits`;
  const metaParts = [];
  if (!isTrainerAccuracyMode(mode)) metaParts.push(`${entry.accuracy}% acc`);
  if (entry.reaction > 0) metaParts.push(`${entry.reaction}ms react`);
  if (entry.sens != null && String(entry.sens).trim() !== "" && String(entry.sens) !== "0") {
    metaParts.push(`${entry.sens} sens`);
  }
  if (entry.dpi != null && String(entry.dpi).trim() !== "" && String(entry.dpi) !== "0") {
    metaParts.push(`${entry.dpi} dpi`);
  }
  const meta = metaParts.join(" · ");
  return `<div class="aim-progress-tooltip-score">${scoreLine}</div>${meta ? `<div class="aim-progress-tooltip-meta">${meta}</div>` : ""}<div class="aim-progress-tooltip-date">${when}</div>`;
}

function hideProgressChartTooltip() {
  const tooltip = document.getElementById("aim-progress-tooltip");
  const canvas = document.getElementById("aim-progress-canvas");
  if (tooltip) {
    tooltip.classList.add("hidden");
    tooltip.setAttribute("aria-hidden", "true");
  }
  if (canvas) canvas.style.cursor = "default";
  const changed = progressChartHoverIndex !== -1;
  progressChartHoverIndex = -1;
  return changed;
}

function showProgressChartTooltip(point, mode, cssW, cssH) {
  const tooltip = document.getElementById("aim-progress-tooltip");
  const chart = document.querySelector(".aim-progress-chart");
  const canvas = document.getElementById("aim-progress-canvas");
  if (!tooltip || !canvas || !chart) return;

  tooltip.innerHTML = formatProgressTooltipHtml(point.entry, mode);
  tooltip.classList.remove("hidden");
  tooltip.setAttribute("aria-hidden", "false");
  canvas.style.cursor = "pointer";

  const chartW = chart.clientWidth;
  const chartH = chart.clientHeight;
  if (!chartW || !chartH) return;

  const dotX = (point.x / cssW) * chartW;
  const dotY = (point.y / cssH) * chartH;
  const margin = 8;
  const gap = 10;

  tooltip.style.left = "0";
  tooltip.style.top = "0";
  tooltip.style.transform = "none";

  const tipW = tooltip.offsetWidth;
  const tipH = tooltip.offsetHeight;

  let left = dotX - tipW / 2;
  left = Math.max(margin, Math.min(left, chartW - tipW - margin));

  let top = dotY - tipH - gap;
  if (top < margin) top = dotY + gap;
  top = Math.max(margin, Math.min(top, chartH - tipH - margin));

  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function findProgressChartPoint(canvas, clientX, clientY) {
  const state = canvas._progressChartState;
  if (!state?.points?.length) return -1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return -1;
  const x = ((clientX - rect.left) / rect.width) * state.cssW;
  const y = ((clientY - rect.top) / rect.height) * state.cssH;
  const hitR = 12;
  for (let i = state.points.length - 1; i >= 0; i--) {
    const p = state.points[i];
    const dx = x - p.x;
    const dy = y - p.y;
    if (dx * dx + dy * dy <= hitR * hitR) return i;
  }
  return -1;
}

function initProgressChartInteraction() {
  if (initProgressChartInteraction._init) return;
  const canvas = document.getElementById("aim-progress-canvas");
  if (!canvas) return;
  initProgressChartInteraction._init = true;

  canvas.addEventListener("mousemove", (e) => {
    const idx = findProgressChartPoint(canvas, e.clientX, e.clientY);
    if (idx === progressChartHoverIndex) return;
    progressChartHoverIndex = idx;
    if (idx >= 0) {
      const state = canvas._progressChartState;
      showProgressChartTooltip(state.points[idx], state.mode, state.cssW, state.cssH);
    } else {
      hideProgressChartTooltip();
    }
    requestProfileChartsRedraw();
  });

  canvas.addEventListener("mouseleave", () => {
    if (hideProgressChartTooltip()) requestProfileChartsRedraw();
  });
}

function getProgressChartPoints(sessions, _dayStart, _dayEnd, padX, cssW, yFor) {
  if (!sessions.length) return [];

  const width = cssW - padX * 2;
  if (sessions.length === 1) {
    return [
      {
        x: padX,
        y: yFor(sessions[0].score),
        entry: sessions[0],
      },
    ];
  }

  const step = width / (sessions.length - 1);
  return sessions.map((entry, i) => ({
    x: padX + step * i,
    y: yFor(entry.score),
    entry,
  }));
}

function traceSmoothChartCurve(ctx, points, tension = 0.38) {
  if (!points.length) return;
  if (points.length === 1) {
    ctx.moveTo(points[0].x, points[0].y);
    return;
  }
  if (points.length === 2) {
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    return;
  }

  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const cp1x = p1.x + ((p2.x - p0.x) / 6) * tension;
    const cp1y = p1.y + ((p2.y - p0.y) / 6) * tension;
    const cp2x = p2.x - ((p3.x - p1.x) / 6) * tension;
    const cp2y = p2.y - ((p3.y - p1.y) / 6) * tension;
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }
}

function renderProgressChart(game, mode, timer) {
  const canvas = document.getElementById("aim-progress-canvas");
  if (!canvas) return;

  const label = document.getElementById("aim-progress-label");
  const modeLabel = mode.charAt(0).toUpperCase() + mode.slice(1);

  const measured = measureStatsCanvasSize(canvas, PROGRESS_CHART_HEIGHT);
  if (!measured || measured.cssW < 50 || measured.cssH < 50) return;

  const prepared = prepareStatsCanvas(canvas, PROGRESS_CHART_HEIGHT);
  if (!prepared) return;
  const { ctx, cssW, cssH: h } = prepared;

  if (!game) {
    canvas._progressChartState = null;
    hideProgressChartTooltip();
    closeProgressChartCalendar();
    if (label) label.textContent = "";
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.35)";
    ctx.font = "0.75rem Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Select a game to view daily progress", cssW / 2, h / 2);
    syncProfileAimResetVisibility([], null);
    return;
  }

  const histKey = `aimHistory_${game}_${mode}_${timer}`;
  let hist = [];
  if (localStorage.getItem(histKey) != null) {
    try {
      hist = JSON.parse(localStorage.getItem(histKey)) || [];
    } catch (e) {}
  }

  const selectedDay = resolveProgressChartSelectedDay(hist);
  syncProgressChartDateUi(hist);
  const { start: dayStart, end: dayEnd } = getProgressDayWindow(selectedDay);
  const sessions = getProgressSessionsForDay(hist, selectedDay);
  syncProfileAimResetVisibility(hist, selectedDay);

  if (label) {
    label.textContent = `${game} · ${modeLabel} · ${timer}s · ${formatProgressDayLabel(selectedDay)}`;
  }

  ctx.imageSmoothingEnabled = true;
  if (ctx.imageSmoothingQuality) ctx.imageSmoothingQuality = "high";

  const padX = PROGRESS_CHART_PAD.x;
  const padTop = PROGRESS_CHART_PAD.top;
  const padBottom = PROGRESS_CHART_PAD.bottom;
  const chartBottom = h - padBottom;
  const chartHeight = chartBottom - padTop;
  const stroke = accentColor();

  ctx.strokeStyle = "hsla(0,0%,100%,0.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 3; i++) {
    const y = padTop + (chartHeight / 3) * i;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(cssW - padX, y);
    ctx.stroke();
  }

  ctx.strokeStyle = "hsla(0,0%,100%,0.12)";
  ctx.beginPath();
  ctx.moveTo(padX, chartBottom);
  ctx.lineTo(cssW - padX, chartBottom);
  ctx.stroke();

  if (sessions.length < 1) {
    canvas._progressChartState = null;
    hideProgressChartTooltip();
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.35)";
    ctx.font = "0.75rem Inter, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`No sessions on ${formatProgressDayLabel(selectedDay)}`, cssW / 2, padTop + chartHeight / 2);
    return;
  }

  const data = sessions.map((d) => d.score);
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const scoreRange = max - min || 1;
  const yFor = (v) => chartBottom - ((v - min) / scoreRange) * chartHeight;
  const points = getProgressChartPoints(sessions, dayStart, dayEnd, padX, cssW, yFor);

  if (progressChartHoverIndex >= points.length) {
    hideProgressChartTooltip();
  }

  canvas._progressChartState = { points, cssW, cssH: h, mode };

  const grad = ctx.createLinearGradient(0, padTop, 0, chartBottom);
  grad.addColorStop(0, accentAlpha(0.4));
  grad.addColorStop(0.65, accentAlpha(0.12));
  grad.addColorStop(1, accentAlpha(0));

  if (data.length > 1) {
    ctx.beginPath();
    traceSmoothChartCurve(ctx, points);
    ctx.lineTo(points[points.length - 1].x, chartBottom);
    ctx.lineTo(points[0].x, chartBottom);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    traceSmoothChartCurve(ctx, points);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2.25;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  points.forEach(({ x, y }, i) => {
    const hovered = i === progressChartHoverIndex;
    const outerR = hovered ? 5 : 3;
    const innerR = hovered ? 2 : 1.5;
    ctx.beginPath();
    ctx.arc(x, y, outerR, 0, Math.PI * 2);
    ctx.fillStyle = stroke;
    ctx.fill();
    if (hovered) {
      ctx.beginPath();
      ctx.arc(x, y, outerR + 2, 0, Math.PI * 2);
      ctx.strokeStyle = accentAlpha(0.45);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y, innerR, 0, Math.PI * 2);
    ctx.fillStyle = "hsla(0, 0%, 100%, 0.85)";
    ctx.fill();
  });

  if (progressChartHoverIndex >= 0 && points[progressChartHoverIndex]) {
    const point = points[progressChartHoverIndex];
    showProgressChartTooltip(point, mode, cssW, h);
  }
}

function buildShareUrl(kind) {
  const base = getAppBasePath().replace(/\/$/, "");
  if (kind === "sens") {
    const url = new URL(`${window.location.origin}${base}/${TAB_SLUGS["sensitivity-converter-tab"]}`);
    const p = url.searchParams;
    p.set("t", "sens");
    p.set("fg", document.getElementById("from-search")?.value || "");
    p.set("tg", document.getElementById("to-search")?.value || "");
    p.set("s", document.getElementById("base-sens")?.value || "");
    p.set("fd", document.getElementById("from-dpi")?.value || "");
    p.set("td", document.getElementById("to-dpi")?.value || "");
    return url.toString();
  }

  if (kind === "crosshair") {
    const url = new URL(`${window.location.origin}${base}/${TAB_SLUGS["crosshair-converter-tab"]}`);
    const p = url.searchParams;
    p.set("t", "crosshair");
    p.set("dir", document.querySelector("#crosshair-converter-direction-list .pref-dropdown-option.active")?.dataset.crosshairDirection || "cs2-to-val");
    p.set("in", document.getElementById("crosshair-converter-input")?.value || "");
    return url.toString();
  }

  const tabId = "edpi-calculator-tab";
  const url = new URL(`${window.location.origin}${base}/${TAB_SLUGS[tabId]}`);
  const p = url.searchParams;
  p.set("t", "edpi");
  p.set("g", document.getElementById("edpi-game-search")?.value || "");
  p.set("s", document.getElementById("edpi-sens")?.value || "");
  p.set("d", document.getElementById("edpi-dpi")?.value || "");
  return url.toString();
}

function initShareButtons() {
  document.querySelectorAll(".share-button").forEach((btn) => {
    btn.addEventListener("click", function () {
      const kind = this.getAttribute("data-share");
      const link = buildShareUrl(kind);
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        navigator.share({ title: "Morning Roast", url: link }).catch(() => {});
        return;
      }
      copyText(link, "Share link has been copied.");
    });
  });
}

function applySharedParams() {
  const p = new URLSearchParams(window.location.search);
  const t = p.get("t");
  if (!t) return;

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el && v != null && v !== "") el.value = v;
  };

  if (t === "sens") {
    setVal("from-search", p.get("fg"));
    setVal("to-search", p.get("tg"));
    setVal("base-sens", p.get("s"));
    setVal("from-dpi", p.get("fd"));
    setVal("to-dpi", p.get("td"));
    updateConversion();
    document.getElementById("sidebar-sensitivity-converter-button")?.click();
  } else if (t === "edpi") {
    setVal("edpi-game-search", p.get("g"));
    setVal("edpi-sens", p.get("s"));
    setVal("edpi-dpi", p.get("d"));
    updateEDPI();
    document.getElementById("sidebar-edpi-calculator-button")?.click();
  } else if (t === "crosshair") {
    const dir = p.get("dir") === "val-to-cs2" ? "val-to-cs2" : "cs2-to-val";
    setVal("crosshair-converter-input", p.get("in"));
    document.getElementById("sidebar-misc-crosshair-button")?.click();
    setTimeout(() => {
      setCrosshairConverterDirection?.(dir);
      updateCrosshairConverterUi?.();
    }, 50);
  }
}

function initTabBlock() {
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const active = document.activeElement;
        if (active && active !== document.body && active !== document.documentElement) {
          active.blur();
        }
      }
    },
    true,
  );
}

function cycleHotkeyTab(tabOrder) {
  const visibleSection = Array.from(document.querySelectorAll(".section")).find((s) => s.style.display !== "none");
  const currentIndex = tabOrder.indexOf(visibleSection?.id);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % tabOrder.length : 0;
  const nextId = tabOrder[nextIndex];
  switchTab(null, nextId);
  if (FOOTER_TAB_IDS.has(nextId)) scrollToTop(350);
}

function initHotkeys() {
  const tabMap = {
    1: "sensitivity-converter-tab",
    2: "edpi-calculator-tab",
    4: "settings-tab",
    5: "stats-tab",
    6: "aim-training-tab",
  };
  document.addEventListener("keydown", (e) => {
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.repeat) return;

    if (e.key === "3") {
      cycleHotkeyTab(MISC_HOTKEY_TAB_ORDER);
      e.preventDefault();
    } else if (e.key === "7") {
      if (LINEUP_TAB_ENABLED) {
        switchTab(null, "lineup-tab");
      } else {
        cycleHotkeyTab(MORE_HOTKEY_TAB_ORDER);
      }
      e.preventDefault();
    } else if (tabMap[e.key]) {
      switchTab(null, tabMap[e.key]);
      e.preventDefault();
    } else if (e.key.toLowerCase() === "c") {
      const visibleSection = Array.from(document.querySelectorAll(".section")).find((s) => s.style.display !== "none");
      const copyBtn = visibleSection?.querySelector(".copy-button");
      if (copyBtn) {
        copyBtn.click();
        e.preventDefault();
      }
    } else if (e.key.toLowerCase() === "r") {
      if (typeof aimTrainer !== "undefined" && aimTrainer.restartSession?.()) {
        e.preventDefault();
      }
    } else if (e.key === "?") {
      switchTab(null, "keybinds-tab");
      scrollToTop(350);
      e.preventDefault();
    }
  });
}

function syncKeybindLabels() {
  const key7Label = document.getElementById("keybind-7-label");
  if (!key7Label) return;
  key7Label.textContent = LINEUP_TAB_ENABLED
    ? "Open Lineups"
    : "Cycle More pages (Keybinds / Updates / Privacy / Terms / Credit)";
}

function initLogoMask() {
  const img = new Image();
  img.decoding = "async";
  img.onload = () => {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) {
      document.documentElement.classList.add("logo-mask-ready");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      document.documentElement.classList.add("logo-mask-ready");
      return;
    }

    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, w, h);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const on = data[i + 3] >= 16 && lum > 28;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = on ? 255 : 0;
    }

    ctx.putImageData(imageData, 0, 0);
    document.documentElement.style.setProperty("--logo-mask", `url("${canvas.toDataURL("image/png")}")`);
    document.documentElement.classList.add("logo-mask-ready");
  };
  img.onerror = () => document.documentElement.classList.add("logo-mask-ready");
  img.src = "./logo.png";
}

function normalizeBgPattern(stored) {
  if (stored === "none" || stored === "grid" || stored === "dots" || stored === "particles") return stored;
  return "waves";
}

const BG_PATTERN_LABELS = {
  waves: "Waves",
  grid: "Grid",
  dots: "Dots",
  particles: "Particles",
  none: "None",
};

const BG_PATTERN_ICONS = {
  waves: "ri-pulse-line",
  grid: "ri-layout-grid-line",
  dots: "ri-more-2-fill",
  particles: "ri-sparkling-2-line",
  none: "ri-prohibited-line",
};

const bgParticles = {
  canvas: null,
  ctx: null,
  particles: [],
  frame: 0,
  width: 0,
  height: 0,
  _active: false,

  motionAllowed() {
    return !document.body.classList.contains("reduce-motion") && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  },

  init() {
    this.canvas = document.getElementById("bg-particles-canvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    window.addEventListener("resize", () => {
      if (this._active) this.resize(true);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) cancelAnimationFrame(this.frame);
      else if (this._active) this.loop();
    });
    this.sync();
  },

  sync() {
    const on = document.documentElement.dataset.bgPattern === "particles" && this.motionAllowed();
    if (on) this.start();
    else this.stop();
  },

  start() {
    if (this._active || !this.canvas || !this.ctx) return;
    this._active = true;
    this.canvas.classList.add("is-active");
    this.resize(true);
    this.loop();
  },

  stop() {
    this._active = false;
    cancelAnimationFrame(this.frame);
    this.canvas?.classList.remove("is-active");
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  },

  resize(reseed) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (reseed) this.seed();
  },

  seed() {
    const count = Math.min(80, Math.max(25, Math.round((this.width * this.height) / 18000)));
    this.particles = Array.from({ length: count }, () => ({
      x: Math.random() * this.width,
      y: Math.random() * this.height,
      r: Math.random() * 1.6 + 0.4,
      vx: (Math.random() - 0.5) * 0.25,
      vy: (Math.random() - 0.5) * 0.25,
      a: Math.random() * 0.35 + 0.08,
    }));
  },

  loop() {
    if (!this._active) return;
    this.frame = requestAnimationFrame(() => this.loop());
    this.draw();
  },

  draw() {
    const { ctx, width, height, particles } = this;
    ctx.clearRect(0, 0, width, height);
    for (const p of particles) {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < -5) p.x = width + 5;
      if (p.x > width + 5) p.x = -5;
      if (p.y < -5) p.y = height + 5;
      if (p.y > height + 5) p.y = -5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(0, 0%, 100%, ${p.a})`;
      ctx.fill();
    }
  },
};

function applyBgPattern(mode) {
  document.documentElement.dataset.bgPattern = normalizeBgPattern(mode);
  bgParticles.sync();
}

function syncBgPatternDropdownUi(value) {
  const normalized = normalizeBgPattern(value);
  const label = document.getElementById("bg-pattern-label");
  const icon = document.getElementById("bg-pattern-icon");
  const list = document.getElementById("bg-pattern-list");
  if (label) label.textContent = BG_PATTERN_LABELS[normalized] || normalized;
  if (icon) icon.className = `${BG_PATTERN_ICONS[normalized] || "ri-palette-line"} pref-dropdown-icon`;
  list?.querySelectorAll(".pref-dropdown-option").forEach((opt) => {
    opt.classList.toggle("active", opt.getAttribute("data-bg-pattern") === normalized);
  });
}

const prefDropdownPortalTrackers = new Map();

function positionPrefDropdownPortal(list, trigger) {
  if (!list || !trigger || !trigger.isConnected) return;
  const rect = trigger.getBoundingClientRect();
  list.style.top = `${rect.bottom + 6}px`;
  list.style.left = `${rect.left}px`;
  list.style.width = `${Math.max(rect.width, 0)}px`;
}

function syncPrefDropdownPortalPosition(list, trigger) {
  if (!list?.classList.contains("pref-dropdown-list-portal") || list.classList.contains("hidden")) return;
  positionPrefDropdownPortal(list, trigger);
}

function startPrefDropdownPortalTracking(list, trigger) {
  if (!list || !trigger) return;
  stopPrefDropdownPortalTracking(list);

  const onLayoutChange = () => syncPrefDropdownPortalPosition(list, trigger);

  let resizeObserver = null;
  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(onLayoutChange);
    resizeObserver.observe(trigger);
  }

  window.addEventListener("resize", onLayoutChange, { passive: true });
  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener("resize", onLayoutChange, { passive: true });
  visualViewport?.addEventListener("scroll", onLayoutChange, { passive: true });

  const tracker = { trigger, rafId: null, onLayoutChange, resizeObserver, visualViewport };
  prefDropdownPortalTrackers.set(list, tracker);

  onLayoutChange();

  const tick = () => {
    if (!prefDropdownPortalTrackers.has(list)) return;
    syncPrefDropdownPortalPosition(list, trigger);
    tracker.rafId = nativeRequestAnimationFrame(tick);
  };
  tracker.rafId = nativeRequestAnimationFrame(tick);
}

function stopPrefDropdownPortalTracking(list) {
  const tracker = prefDropdownPortalTrackers.get(list);
  if (!tracker) return;

  if (tracker.rafId != null) nativeCancelAnimationFrame(tracker.rafId);
  window.removeEventListener("resize", tracker.onLayoutChange);
  tracker.visualViewport?.removeEventListener("resize", tracker.onLayoutChange);
  tracker.visualViewport?.removeEventListener("scroll", tracker.onLayoutChange);
  tracker.resizeObserver?.disconnect();
  prefDropdownPortalTrackers.delete(list);
}

function bindPrefDropdownPortalListeners(list, trigger) {
  startPrefDropdownPortalTracking(list, trigger);
}

function unbindPrefDropdownPortalListeners(list) {
  stopPrefDropdownPortalTracking(list);
}

function mountPrefDropdownPortal(list, trigger) {
  if (!list || !trigger) return;
  if (!list._portalAnchor) list._portalAnchor = list.parentElement;
  list.classList.add("pref-dropdown-list-portal");
  document.body.appendChild(list);
  startPrefDropdownPortalTracking(list, trigger);
}

function unmountPrefDropdownPortal(list) {
  stopPrefDropdownPortalTracking(list);
  if (list._portalAnchor && list.parentElement === document.body) {
    list._portalAnchor.appendChild(list);
    delete list._portalAnchor;
  }
  list.classList.remove("pref-dropdown-list-portal");
  list.style.top = "";
  list.style.left = "";
  list.style.width = "";
}

function mountGameDropdownPortal(list, trigger) {
  mountPrefDropdownPortal(list, trigger);
}

function unmountGameDropdownPortal(list) {
  if (!list?.classList.contains("pref-dropdown-list-portal")) return;
  unmountPrefDropdownPortal(list);
}

function showGameDropdownList(idPrefix) {
  const list = document.getElementById(`${idPrefix}-list`);
  const trigger = document.getElementById(`${idPrefix}-trigger`);
  if (!list || !trigger) return;

  hideLineupMapList();
  hideAllGameDropdownLists(idPrefix);
  initProfileModeDropdown.close?.();
  initProfileTimerDropdown.close?.();

  list.classList.remove("hidden");
  if (idPrefix === "profile-game") {
    document.getElementById("stats-tab")?.classList.add("profile-game-list-open");
  }

  if (!shouldPortalGameDropdown(idPrefix)) {
    if (list.classList.contains("pref-dropdown-list-portal")) {
      unmountGameDropdownPortal(list);
    }
    return;
  }

  if (list.classList.contains("pref-dropdown-list-portal")) {
    startPrefDropdownPortalTracking(list, trigger);
    return;
  }

  mountGameDropdownPortal(list, trigger);
}

function hideGameDropdownList(idPrefix) {
  const list = document.getElementById(`${idPrefix}-list`);
  if (!list) return;

  list.classList.add("hidden");
  if (list.classList.contains("pref-dropdown-list-portal")) {
    unmountGameDropdownPortal(list);
  }
  if (idPrefix === "profile-game") {
    document.getElementById("stats-tab")?.classList.remove("profile-game-list-open");
  }
}

function hideAllGameDropdownLists(exceptPrefix) {
  GAME_DROPDOWN_PREFIXES.forEach((prefix) => {
    if (prefix !== exceptPrefix) hideGameDropdownList(prefix);
  });
}

function showProfileGameList() {
  showGameDropdownList("profile-game");
}

function hideProfileGameList() {
  hideGameDropdownList("profile-game");
}

function initTrainerModeDropdown(savedMode) {
  const dropdown = document.getElementById("trainer-mode-dropdown");
  const trigger = document.getElementById("trainer-mode-trigger");
  const list = document.getElementById("trainer-mode-list");
  if (!dropdown || !trigger || !list || initTrainerModeDropdown._init) return;
  initTrainerModeDropdown._init = true;

  renderTrainerModeOptions(list);

  const close = () => {
    dropdown.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    unmountPrefDropdownPortal(list);
  };

  const open = () => {
    initBgPatternDropdown.close?.();
    initTrainerTimerDropdown.close?.();
    initTrainerAspectDropdown.close?.();
    dropdown.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.classList.remove("hidden");
    mountPrefDropdownPortal(list, trigger);
  };

  initTrainerModeDropdown.close = close;
  syncTrainerModeDropdownUi(savedMode);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("is-open")) close();
    else open();
  });

  list.querySelectorAll("[data-trainer-mode]").forEach((opt) => {
    opt.addEventListener("click", () => {
      const value = normalizeTrainerMode(opt.getAttribute("data-trainer-mode"));
      aimTrainer.mode = value;
      localStorage.setItem("aimMode", value);
      syncTrainerModeDropdownUi(value);
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
}

function initBgPatternDropdown(savedValue) {
  const dropdown = document.getElementById("bg-pattern-dropdown");
  const trigger = document.getElementById("bg-pattern-trigger");
  const list = document.getElementById("bg-pattern-list");
  if (!dropdown || !trigger || !list || initBgPatternDropdown._init) return;
  initBgPatternDropdown._init = true;

  const close = () => {
    dropdown.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    unmountPrefDropdownPortal(list);
  };

  const open = () => {
    initTrainerModeDropdown.close?.();
    dropdown.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.classList.remove("hidden");
    mountPrefDropdownPortal(list, trigger);
  };

  initBgPatternDropdown.close = close;
  syncBgPatternDropdownUi(savedValue);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("is-open")) close();
    else open();
  });

  list.querySelectorAll(".pref-dropdown-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      const value = normalizeBgPattern(opt.getAttribute("data-bg-pattern"));
      applyBgPattern(value);
      localStorage.setItem("prefBgPattern", value);
      syncBgPatternDropdownUi(value);
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
}

function clearSettingsSearchHighlights(root) {
  root.querySelectorAll("mark.settings-search-match").forEach((mark) => {
    mark.replaceWith(document.createTextNode(mark.textContent));
  });
  root.querySelectorAll(".setting-text, .trainer-settings-dropdown-title, .lineup-video-title").forEach((el) => el.normalize());
}

function highlightSearchMatches(element, query, { skipButtons = true } = {}) {
  if (!query) return;
  element.normalize();
  const lowerQuery = query.toLowerCase();
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes = [];

  while (walker.nextNode()) {
    const parent = walker.currentNode.parentElement;
    if (!parent || parent.closest("mark.settings-search-match, .control-group, .pref-dropdown")) continue;
    if (skipButtons && parent.closest("button")) continue;
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach((node) => {
    const text = node.textContent;
    const lowerText = text.toLowerCase();
    let start = lowerText.indexOf(lowerQuery);
    if (start === -1) return;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;

    while (start !== -1) {
      if (start > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, start)));

      const mark = document.createElement("mark");
      mark.className = "settings-search-match";
      mark.textContent = text.slice(start, start + query.length);
      fragment.appendChild(mark);

      lastIndex = start + query.length;
      start = lowerText.indexOf(lowerQuery, lastIndex);
    }

    if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)));

    node.replaceWith(fragment);
  });
}

function highlightSettingsSearchMatches(element, query) {
  highlightSearchMatches(element, query, { skipButtons: true });
}

function applySettingsSearchHighlights(root, query) {
  if (!query) return;

  root.querySelectorAll(".setting-block:not(.is-filtered-out) .setting-text").forEach((el) => {
    highlightSettingsSearchMatches(el, query);
  });

  root.querySelectorAll(".trainer-settings-section:not(.is-filtered-out) .trainer-settings-dropdown-title").forEach((el) => {
    highlightSettingsSearchMatches(el, query);
  });
}

function initSettingsModalSearch({ overlayId, searchId, clearId }) {
  const overlay = document.getElementById(overlayId);
  const input = document.getElementById(searchId);
  const clearBtn = document.getElementById(clearId);
  if (!overlay || !input || !clearBtn) return;

  const sections = () => overlay.querySelectorAll(".trainer-settings-section");
  const blocks = () => overlay.querySelectorAll(".setting-block");

  const syncClear = () => {
    clearBtn.style.display = input.value.trim() ? "flex" : "none";
  };

  const filter = () => {
    const query = input.value.trim().toLowerCase();
    clearSettingsSearchHighlights(overlay);

    if (!query) {
      blocks().forEach((block) => block.classList.remove("is-filtered-out"));
      sections().forEach((section) => section.classList.remove("is-filtered-out"));
      if (SETTINGS_MODAL_OVERLAY_IDS.includes(overlayId)) resetTrainerSettingsDropdowns(overlayId);
      return;
    }

    blocks().forEach((block) => {
      const haystack = block.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      block.classList.toggle("is-filtered-out", !haystack.includes(query));
    });

    sections().forEach((section) => {
      const hasVisible = section.querySelector(".setting-block:not(.is-filtered-out)");
      section.classList.toggle("is-filtered-out", !hasVisible);
      if (SETTINGS_MODAL_OVERLAY_IDS.includes(overlayId) && hasVisible) {
        openTrainerSettingsDropdownAncestors(section, overlay);
      }
    });

    if (SETTINGS_MODAL_OVERLAY_IDS.includes(overlayId)) {
      blocks().forEach((block) => {
        if (!block.classList.contains("is-filtered-out")) {
          openTrainerSettingsDropdownAncestors(block, overlay);
        }
      });
      setTimeout(() => updateAllToggleGliders(), 340);
    }

    applySettingsSearchHighlights(overlay, query);
  };

  const reset = () => {
    input.value = "";
    filter();
    syncClear();
  };

  input.addEventListener("input", () => {
    filter();
    syncClear();
  });

  clearBtn.addEventListener("click", () => {
    reset();
    input.focus();
  });

  initSettingsModalSearch.reset = initSettingsModalSearch.reset || {};
  initSettingsModalSearch.reset[overlayId] = reset;
  syncClear();
}

function resetSettingsModalSearch(overlayId) {
  initSettingsModalSearch.reset?.[overlayId]?.();
}

function initThemeSettingsMenu() {
  const overlay = document.getElementById("theme-settings-overlay");
  const openBtn = document.getElementById("open-theme-settings");
  const closeBtn = document.getElementById("close-theme-settings");
  if (!overlay) return;

  const close = () => {
    overlay.classList.remove("active");
    initBgPatternDropdown.close?.();
    resetSettingsModalSearch("theme-settings-overlay");
    resetTrainerSettingsDropdowns("theme-settings-overlay");
    syncBodyScrollLock();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const open = () => {
    overlay.classList.add("active");
    syncBodyScrollLock();
    setTimeout(() => updateAllToggleGliders(), 50);
  };

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("active")) {
      e.preventDefault();
      close();
    }
  });
}

function initAudioSettings() {
  loadMasterVolume();

  const bindVolumeSlider = (sliderId, labelId, initialPct, onChange) => {
    const slider = document.getElementById(sliderId);
    const label = document.getElementById(labelId);
    if (!slider || !label) return;

    const apply = (pct) => {
      const clamped = Math.max(0, Math.min(100, pct));
      slider.value = String(clamped);
      label.textContent = `${clamped}%`;
      onChange(clamped);
    };

    apply(initialPct);

    slider.addEventListener("input", () => {
      apply(parseInt(slider.value, 10) || 0);
    });
  };

  bindVolumeSlider("master-volume", "master-volume-label", Math.round(getMasterVolume() * 100), setMasterVolume);

  const savedTrainerVolume = Math.max(0, Math.min(100, parseInt(localStorage.getItem("aimTrainerVolume") ?? "100", 10) || 0));
  bindVolumeSlider("aim-trainer-volume", "aim-trainer-volume-label", savedTrainerVolume, (pct) => {
    aimTrainer.trainerVolume = pct / 100;
    localStorage.setItem("aimTrainerVolume", String(pct));
  });
}

function initGeneralSettingsMenu() {
  const overlay = document.getElementById("general-settings-overlay");
  const openBtn = document.getElementById("open-general-settings");
  const closeBtn = document.getElementById("close-general-settings");
  if (!overlay) return;

  const close = () => {
    overlay.classList.remove("active");
    resetSettingsModalSearch("general-settings-overlay");
    resetTrainerSettingsDropdowns("general-settings-overlay");
    syncBodyScrollLock();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const open = () => {
    overlay.classList.add("active");
    syncBodyScrollLock();
    setTimeout(() => updateAllToggleGliders(), 50);
  };

  openBtn?.addEventListener("click", open);
  closeBtn?.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay.classList.contains("active")) {
      e.preventDefault();
      close();
    }
  });
}

function initPreferences() {
  const root = document.documentElement;
  const body = document.body;

  const applyAccent = (hsl, { instant = false } = {}) => {
    const normalized = normalizeAccent(hsl);
    if (appliedAccentKey === normalized) return;
    appliedAccentKey = normalized;
    commitAccentColor(normalized, { instant });
  };
  const applyFontSize = (scale) => {
    root.style.fontSize = `${16 * parseFloat(scale)}px`;
    requestProfileChartsRedraw();
  };
  const applyContrast = (on) => body.classList.toggle("high-contrast", on);
  const applyMotion = (on) => {
    body.classList.toggle("reduce-motion", on);
    bgParticles.sync();
  };

  const savedAccent = localStorage.getItem("prefAccent");
  const savedFont = localStorage.getItem("prefFontSize");
  const savedContrast = localStorage.getItem("prefContrast") === "true";
  const savedMotion = localStorage.getItem("prefMotion") === "true";
  const savedRefresh = normalizeUiRefreshMode(localStorage.getItem("prefUiRefresh") || localStorage.getItem("prefHighRefresh"));
  const savedConfirmReset = localStorage.getItem("prefConfirmReset") !== "false";
  const savedBgPattern = normalizeBgPattern(localStorage.getItem("prefBgPattern"));

  if (savedAccent) applyAccent(savedAccent, { instant: true });
  if (savedFont) applyFontSize(savedFont);
  applyContrast(savedContrast);
  applyMotion(savedMotion);
  applyBgPattern(savedBgPattern);
  initBgPatternDropdown(savedBgPattern);
  bgParticles.init();
  setUiRefreshMode(savedRefresh);

  const accentGrid = document.getElementById("accent-grid");
  const accentPicker = document.getElementById("accent-picker");
  const accentPrev = document.getElementById("accent-prev");
  const accentNext = document.getElementById("accent-next");
  const accentLabel = document.getElementById("accent-picker-label");

  const getAccentSwatches = () => (accentGrid ? [...accentGrid.querySelectorAll(".accent-swatch")] : []);

  const syncAccentSwatchState = (activeBtn) => {
    getAccentSwatches().forEach((btn) => {
      const isActive = btn === activeBtn;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-checked", isActive ? "true" : "false");
      btn.tabIndex = isActive ? 0 : -1;
    });
    if (accentLabel && activeBtn) accentLabel.textContent = activeBtn.getAttribute("aria-label") || "";
  };

  const selectAccentSwatch = (btn) => {
    if (!btn || !accentGrid) return;
    const val = btn.getAttribute("data-accent");
    syncAccentSwatchState(btn);
    applyAccent(val);
    localStorage.setItem("prefAccent", normalizeAccent(val));
  };

  const activeAccentIndex = () => {
    const swatches = getAccentSwatches();
    const idx = swatches.findIndex((btn) => btn.classList.contains("active"));
    return idx >= 0 ? idx : 0;
  };

  const selectAccentAt = (index) => {
    const swatches = getAccentSwatches();
    if (!swatches.length) return;
    const nextIndex = ((index % swatches.length) + swatches.length) % swatches.length;
    selectAccentSwatch(swatches[nextIndex]);
  };

  if (accentGrid) {
    getAccentSwatches().forEach((btn) => {
      const val = btn.getAttribute("data-accent");
      const isActive = savedAccent ? normalizeAccent(val) === normalizeAccent(savedAccent) : val === DEFAULT_ACCENT;
      if (isActive) syncAccentSwatchState(btn);
      btn.addEventListener("click", () => selectAccentSwatch(btn));
    });
    if (!getAccentSwatches().some((btn) => btn.classList.contains("active"))) {
      syncAccentSwatchState(getAccentSwatches()[0]);
    }
  }

  accentPrev?.addEventListener("click", () => selectAccentAt(activeAccentIndex() - 1));
  accentNext?.addEventListener("click", () => selectAccentAt(activeAccentIndex() + 1));

  accentPicker?.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      selectAccentAt(activeAccentIndex() - 1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      selectAccentAt(activeAccentIndex() + 1);
    }
  });

  const wireToggle = (selectorId, attr, onChange, savedValue) => {
    const sel = document.getElementById(selectorId);
    if (!sel) return;
    const btns = sel.querySelectorAll(".toggle-btn");
    btns.forEach((btn) => {
      const val = btn.getAttribute(attr);
      if (savedValue != null && val === savedValue) {
        btns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      }
      btn.addEventListener("click", () => {
        btns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        onChange(btn.getAttribute(attr));
        positionToggleGlider(sel);
      });
    });
    positionToggleGlider(sel);
  };

  wireToggle(
    "confirm-reset-selector",
    "data-confirm-reset",
    (v) => {
      localStorage.setItem("prefConfirmReset", v);
    },
    savedConfirmReset ? "true" : "false",
  );

  wireToggle(
    "fontsize-selector",
    "data-fontsize",
    (v) => {
      applyFontSize(v);
      localStorage.setItem("prefFontSize", v);
    },
    savedFont,
  );
  wireToggle(
    "contrast-selector",
    "data-contrast",
    (v) => {
      applyContrast(v === "true");
      localStorage.setItem("prefContrast", v);
    },
    savedContrast ? "true" : "false",
  );
  wireToggle(
    "motion-selector",
    "data-motion",
    (v) => {
      applyMotion(v === "true");
      localStorage.setItem("prefMotion", v);
    },
    savedMotion ? "true" : "false",
  );
  wireToggle(
    "refresh-selector",
    "data-refresh",
    (v) => {
      setUiRefreshMode(v);
    },
    savedRefresh,
  );

  initAudioSettings();

  requestAnimationFrame(() => updateAllToggleGliders());
  enableAccentTransitions();
}

document.addEventListener("DOMContentLoaded", () => {
  initAppLoadingScreen();
  initAppSidebar();
  initMobileNavMoreMenu();
  initMobileNavMiscMenu();
  if (LINEUP_TAB_ENABLED) initLineupTab();
  initCrosshairConverterTab?.();
  initViewmodelGeneratorTab?.();
  cacheElements();
  initLogoMask();
  renderGameOptions(document.getElementById("from-list"), "data-game");
  renderGameOptions(document.getElementById("to-list"), "data-game");
  renderGameOptions(document.getElementById("edpi-game-list"), "data-game");
  renderGameOptions(document.getElementById("trainer-game-list"), "data-value");
  renderGameOptions(document.getElementById("profile-game-list"), "data-profile-game");
  syncProfileGameDropdownUi(localStorage.getItem(PROFILE_FILTER_GAME_KEY) || DEFAULT_PROFILE_FILTER_GAME);
  initPreferences();
  initSettingsModalSearch({
    overlayId: "theme-settings-overlay",
    searchId: "theme-settings-search",
    clearId: "theme-settings-search-clear",
  });
  initSettingsModalSearch({
    overlayId: "general-settings-overlay",
    searchId: "general-settings-search",
    clearId: "general-settings-search-clear",
  });
  initSettingsModalSearch({
    overlayId: "trainer-settings-overlay",
    searchId: "trainer-settings-search",
    clearId: "trainer-settings-search-clear",
  });
  initThemeSettingsMenu();
  initGeneralSettingsMenu();
  initConfirmReset();
  initOfflineStatus();
  initTrainerSettingsDropdowns();
  initProfileChartsWatcher();
  initShareButtons();
  window.addEventListener("load", () => requestProfileChartsRedraw());
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => requestProfileChartsRedraw()).catch(() => {});
  }
  initHotkeys();
  initTabBlock();
  syncKeybindLabels();
  initReactionTestMenu(initReactionTest());
  initEdpiPresetsResizeAnimation();

  const fD = document.getElementById("from-dpi"),
    tD = document.getElementById("to-dpi");
  if (fD) fD.value = "800";
  if (tD) tD.value = "800";
  ["base-sens", "from-dpi", "to-dpi", "edpi-dpi", "edpi-sens", "canvas-sens", "canvas-dpi"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) handleInputValidation(el, id.startsWith("edpi-") ? updateEDPI : id.startsWith("canvas-") ? () => {} : updateConversion);
  });

  const sequences = [
    ["base-sens", "from-dpi", "to-dpi"],
    ["edpi-sens", "edpi-dpi"],
    ["canvas-sens", "canvas-dpi"],
  ];

  sequences.forEach((sequence) => {
    sequence.forEach((id, index) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            const nextId = sequence[index + 1];
            if (nextId) {
              e.preventDefault();
              document.getElementById(nextId)?.focus();
            }
          }
        });
      }
    });
  });

  const mobileMenuBtn = document.getElementById("mobile-menu-toggle");
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener("click", () => {
      const navContainer = document.querySelector(".nav-menu-container");
      if (navContainer) {
        const open = navContainer.classList.toggle("active");
        mobileMenuBtn.setAttribute("aria-expanded", open ? "true" : "false");
        if (open && document.getElementById("nav-more-toggle")?.classList.contains("active")) {
          setMobileNavMoreOpen(true);
        } else if (open && document.getElementById("nav-misc-toggle")?.classList.contains("active")) {
          setMobileNavMiscOpen(true);
        } else if (!open) {
          closeMobileNavMoreMenu();
          closeMobileNavMiscMenu();
        }
      }
    });
  }

  document.addEventListener("click", (e) => {
    const navContainer = document.querySelector(".nav-menu-container");
    if (navContainer && navContainer.classList.contains("active") && !navContainer.contains(e.target) && mobileMenuBtn && !mobileMenuBtn.contains(e.target)) {
      closeMobileNavMenu();
    }
    ["from", "to", "edpi-game", "trainer-game", "profile-game"].forEach((idPrefix) => {
      const list = document.getElementById(`${idPrefix}-list`),
        input = document.getElementById(`${idPrefix}-search`),
        trigger = document.getElementById(`${idPrefix}-trigger`);
      if (list && input && !input.contains(e.target) && !list.contains(e.target) && !(trigger && trigger.contains(e.target))) {
        hideGameDropdownList(idPrefix);
      }
    });
    const lineupMapList = document.getElementById("lineup-map-list");
    const lineupMapInput = document.getElementById("lineup-map-search");
    const lineupMapTrigger = document.getElementById("lineup-map-trigger");
    if (lineupMapList && lineupMapInput && !lineupMapInput.contains(e.target) && !lineupMapList.contains(e.target) && !(lineupMapTrigger && lineupMapTrigger.contains(e.target))) {
      hideLineupMapList();
    }
  });
  ["from", "to", "edpi-game", "trainer-game", "profile-game"].forEach((idPrefix) => {
    const list = document.getElementById(`${idPrefix}-list`),
      input = document.getElementById(`${idPrefix}-search`),
      clearBtn = document.getElementById(`${idPrefix}-clear`);
    if (!list || !input) return;
    const isProfileGame = idPrefix === "profile-game";
    const valueAttr = GAME_DROPDOWN_VALUE_ATTRS[idPrefix] || "data-game";
    const optionSelector = ".pref-dropdown-option";
    const getOptionLabel = (opt) => getGameOptionLabel(opt);
    const syncClear = () => syncGameClearButton(`${idPrefix}-search`, `${idPrefix}-clear`);
    let activeIndex = -1;
    const getVisible = () => Array.from(list.querySelectorAll(optionSelector)).filter((o) => o.style.display !== "none");
    const syncUI = (visible) => {
      visible.forEach((opt, i) => opt.classList.toggle("hover", i === activeIndex));
      if (activeIndex >= 0 && visible[activeIndex]) {
        visible[activeIndex].scrollIntoView({ block: "nearest" });
      }
    };
    input.addEventListener("focus", () => {
      hideAllGameDropdownLists(idPrefix);

      if (isProfileGame) {
        const previous = resolveGameFromInput(input) || input.dataset.lastValid || localStorage.getItem(PROFILE_FILTER_GAME_KEY) || DEFAULT_PROFILE_FILTER_GAME;
        input.dataset.lastValid = previous;
        input.value = "";

        list.querySelectorAll(optionSelector).forEach((o) => {
          o.style.display = "";
          o.classList.remove("hover");
        });
        const options = getVisible();
        const selectedIndex = options.findIndex((o) => getOptionLabel(o).toLowerCase() === previous.toLowerCase());
        activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
        syncUI(options);
        syncProfileGameDropdownUi(previous);
        showGameDropdownList(idPrefix);
        return;
      }

      input.value = "";
      syncClear();
      list.querySelectorAll(optionSelector).forEach((o) => {
        o.style.display = "";
        o.classList.remove("hover");
      });
      activeIndex = 0;
      syncUI(getVisible());
      showGameDropdownList(idPrefix);
      if (idPrefix === "edpi-game") {
        updateEDPI();
      } else if (idPrefix !== "trainer-game") {
        updateConversion();
        updateGameInfoPanelVisibility();
        toggleProfileSensConvButtons();
      }
    });
    input.addEventListener("blur", () => {
      if (idPrefix === "profile-game") {
        setTimeout(() => {
          ensureProfileGameValue();
          aimTrainer.displayResultsOnProfile();
        }, 120);
        return;
      }
      if (idPrefix === "trainer-game") {
        setTimeout(() => {
          const game = aimTrainer.game || localStorage.getItem("aimGame") || "";
          if (game) input.value = game;
          syncClear();
        }, 120);
      }
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
        hideGameDropdownList(idPrefix);
        input.blur();
      }
    });
    input.addEventListener("input", () => {
      const filter = input.value.toLowerCase();
      list.querySelectorAll(optionSelector).forEach((o) => {
        o.style.display = getOptionLabel(o).toLowerCase().includes(filter) ? "" : "none";
      });
      showGameDropdownList(idPrefix);
      syncClear();
      activeIndex = 0;
      syncUI(getVisible());
      if (idPrefix === "edpi-game") updateEDPI();
      else if (idPrefix !== "trainer-game" && idPrefix !== "profile-game") updateConversion();
    });
    list.querySelectorAll(optionSelector).forEach((opt) => {
      opt.addEventListener("mouseenter", () => {
        const visible = getVisible();
        activeIndex = visible.indexOf(opt);
        syncUI(visible);
      });
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const modeVal = opt.getAttribute(valueAttr) || getOptionLabel(opt);
        input.value = getOptionLabel(opt);
        hideGameDropdownList(idPrefix);
        if (isProfileGame) syncProfileGameDropdownUi(modeVal);
        syncClear();
        if (idPrefix === "trainer-game" && modeVal) {
          aimTrainer.setGame(modeVal);
        } else if (isProfileGame && modeVal) {
          input.dataset.lastValid = input.value;
          localStorage.setItem(PROFILE_FILTER_GAME_KEY, input.value);
          aimTrainer.displayResultsOnProfile();
        } else if (idPrefix === "edpi-game") {
          updateEDPI();
        } else {
          updateConversion();
        }
        input.blur();
      });
    });
    if (clearBtn) {
      clearBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = "";
        hideGameDropdownList(idPrefix);
        syncClear();
        if (idPrefix === "edpi-game") updateEDPI();
        else if (idPrefix === "trainer-game") {
          localStorage.removeItem("aimGame");
          aimTrainer.game = "";
          aimTrainer.fov = trainerConfigs.Valorant.fov;
          aimTrainer.displayResultsOnProfile();
          aimTrainer.render();
        } else updateConversion();
      });
    }
    syncClear();
  });
  ["from", "to", "edpi-game", "trainer-game"].forEach((idPrefix) => {
    syncGameClearButton(`${idPrefix}-search`, `${idPrefix}-clear`);
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
    confirmBeforeReset("Reset the sensitivity converter fields?", () => {
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
  });
  document.getElementById("profile-sens-conv-reset")?.addEventListener("click", () => {
    confirmBeforeReset("Clear saved sensitivity converter stats?", () => {
      localStorage.removeItem("lastSensConv");
      localStorage.removeItem("fromGame");
      localStorage.removeItem("toGame");
      localStorage.removeItem("lastBaseSens");
      localStorage.removeItem("lastFromDpi");
      localStorage.removeItem("lastToDpi");

      const profileDisplay = document.getElementById("last-sens-conv");
      const pFrom = document.getElementById("profile-from-game");
      const pTo = document.getElementById("profile-to-game");
      const pBaseSens = document.getElementById("profile-base-sens");
      const pFromDpi = document.getElementById("profile-from-dpi");
      const pToDpi = document.getElementById("profile-to-dpi");

      if (profileDisplay) profileDisplay.innerText = "0.00";
      if (pFrom) pFrom.innerText = "";
      if (pTo) pTo.innerText = "";
      if (pBaseSens) pBaseSens.innerText = "-";
      if (pFromDpi) pFromDpi.innerText = "-";
      if (pToDpi) pToDpi.innerText = "-";

      toggleProfileSensConvButtons();
      updateGameInfoPanelVisibility();
    });
  });
  document.getElementById("profile-edpi-calc-reset")?.addEventListener("click", () => {
    confirmBeforeReset("Clear saved eDPI calculator stats?", () => {
      localStorage.removeItem("lastEdpiCalc");
      localStorage.removeItem("lastEdpiGame");
      localStorage.removeItem("lastEdpiSens");
      localStorage.removeItem("lastEdpiDpi");
      localStorage.removeItem("lastEdpiColor");
      localStorage.removeItem("lastEdpiCm");

      const pEdpi = document.getElementById("last-edpi-calc");
      const pGame = document.getElementById("profile-edpi-game");
      const pSens = document.getElementById("profile-edpi-sens");
      const pDpi = document.getElementById("profile-edpi-dpi");
      const pDot = document.getElementById("profile-edpi-status-dot");

      if (pEdpi) pEdpi.innerText = "0.00";
      if (pGame) pGame.innerText = "";
      if (pSens) pSens.innerText = "-";
      if (pDpi) pDpi.innerText = "-";
      if (pDot) pDot.style.display = "none";

      toggleProfileSensConvButtons();
      updateGameInfoPanelVisibility();
    });
  });
  document.getElementById("profile-aim-reset")?.addEventListener("click", () => {
    const { game, mode, timer } = getProfileAimContext();
    if (!game) return;

    const histKey = `aimHistory_${game}_${mode}_${timer}`;
    let hist = [];
    try {
      hist = JSON.parse(localStorage.getItem(histKey) || "[]");
    } catch (e) {}
    const selectedDay = resolveProgressChartSelectedDay(hist);
    if (!profileAimResetWouldClear(game, mode, timer, hist, selectedDay)) return;

    confirmBeforeReset(buildProfileAimResetMessage(game, mode, timer, hist, selectedDay), () => {
      performProfileAimReset(game, mode, timer, selectedDay);
    });
  });
  document.getElementById("edpi-reset")?.addEventListener("click", () => {
    confirmBeforeReset("Reset the eDPI calculator fields?", () => {
      const eG = document.getElementById("edpi-game-search"),
        eD = document.getElementById("edpi-dpi"),
        eS = document.getElementById("edpi-sens");
      if (eG) eG.value = "";
      if (eD) eD.value = "";
      if (eS) eS.value = "";
      updateEDPI();
    });
  });
  document.querySelectorAll(".copy-button").forEach((btn) => {
    btn.addEventListener("click", function () {
      if (isCopying) return;
      if (this.id === "crosshair-converter-copy" || this.id === "viewmodel-copy") return;

      const isProfileSensCopy = this.id === "profile-sens-conv-copy";
      const isProfileEdpiCopy = this.id === "profile-edpi-calc-copy";
      const isMainEdpi = this.id === "edpi-copy";

      const sourceId = isProfileSensCopy ? "last-sens-conv" : isProfileEdpiCopy ? "last-edpi-calc" : isMainEdpi ? "edpi-value" : "new-sens-value";
      const val = document.getElementById(sourceId)?.innerText?.trim();

      if (!val || val === "0.00" || val === "0" || val === "" || val === "-") {
        this.classList.add("vibrate");
        setTimeout(() => this.classList.remove("vibrate"), 300);
        return;
      }

      isCopying = true;
      copyText(val).finally(() => {
        isCopying = false;
      });
    });
  });

  const scrollButton = document.getElementById("backToTopButton");

  let scrollButtonFrame = 0;
  function syncScrollButton() {
    if (!scrollButton) return;
    if (window.innerWidth <= 768) {
      scrollButton.classList.remove("is-visible");
      scrollButton.setAttribute("aria-hidden", "true");
      return;
    }
    const visible = window.scrollY > 300;
    scrollButton.classList.toggle("is-visible", visible);
    scrollButton.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  function scheduleSyncScrollButton() {
    if (scrollButtonFrame) return;
    scrollButtonFrame = requestAnimationFrame(() => {
      scrollButtonFrame = 0;
      syncScrollButton();
    });
  }

  window.addEventListener("scroll", scheduleSyncScrollButton, { passive: true });

  function onWindowResize() {
    syncScrollButton();
    requestProfileChartsRedraw();
    syncAimTrainerForViewport();
  }

  window.addEventListener("resize", onWindowResize);
  window.addEventListener("orientationchange", syncAimTrainerForViewport);
  syncScrollButton();
  syncAimTrainerForViewport();

  if (scrollButton) {
    scrollButton.setAttribute("aria-hidden", "true");
    scrollButton.addEventListener("click", () => {
      scrollToTop(0);
    });
  }

  initProfileModeDropdown();
  initProfileTimerDropdown();
  initProfileStatsDropdowns();

  const savedFromGame = localStorage.getItem("fromGame");
  const savedToGame = localStorage.getItem("toGame");
  const savedSens = localStorage.getItem("lastSensConv");
  const savedBaseSens = localStorage.getItem("lastBaseSens");
  const savedFromDpi = localStorage.getItem("lastFromDpi");
  const savedToDpi = localStorage.getItem("lastToDpi");
  const savedEdpi = localStorage.getItem("lastEdpiCalc");
  const savedEdpiGame = localStorage.getItem("lastEdpiGame");
  const savedEdpiSens = localStorage.getItem("lastEdpiSens");
  const savedEdpiDpi = localStorage.getItem("lastEdpiDpi");
  const savedEdpiColor = localStorage.getItem("lastEdpiColor");
  const savedEdpiCm = localStorage.getItem("lastEdpiCm");

  const pFrom = document.getElementById("profile-from-game");
  const pTo = document.getElementById("profile-to-game");
  const profileDisplay = document.getElementById("last-sens-conv");
  const pBaseSens = document.getElementById("profile-base-sens");
  const pFromDpi = document.getElementById("profile-from-dpi");
  const pToDpi = document.getElementById("profile-to-dpi");
  const pEdpi = document.getElementById("last-edpi-calc");
  const pEdpiGame = document.getElementById("profile-edpi-game");
  const pEdpiSens = document.getElementById("profile-edpi-sens");
  const pEdpiDpi = document.getElementById("profile-edpi-dpi");
  const pEdpiCm = document.getElementById("profile-edpi-cm");
  const pEdpiDot = document.getElementById("profile-edpi-status-dot");

  if (savedFromGame && pFrom) pFrom.innerText = savedFromGame;
  if (savedToGame && pTo) pTo.innerText = savedToGame;
  if (savedSens && profileDisplay) profileDisplay.innerText = savedSens;
  if (savedBaseSens && pBaseSens) pBaseSens.innerText = savedBaseSens;
  if (savedFromDpi && pFromDpi) pFromDpi.innerText = savedFromDpi;
  if (savedToDpi && pToDpi) pToDpi.innerText = savedToDpi;
  if (savedEdpi && pEdpi) pEdpi.innerText = savedEdpi;
  if (savedEdpiGame && pEdpiGame) pEdpiGame.innerText = savedEdpiGame;
  if (savedEdpiSens && pEdpiSens) pEdpiSens.innerText = savedEdpiSens;
  if (savedEdpiDpi && pEdpiDpi) pEdpiDpi.innerText = savedEdpiDpi;
  if (savedEdpiCm && pEdpiCm) pEdpiCm.innerText = savedEdpiCm + "cm";
  if (savedEdpiColor && pEdpiDot) {
    pEdpiDot.style.display = "block";
    pEdpiDot.style.backgroundColor = savedEdpiColor;
  }

  aimTrainer.init();
  initProfileGameFilter();
  if (getCurrentTabId() === "stats-tab") aimTrainer.displayResultsOnProfile();
  updateConversion();
  updateEDPI();

  toggleProfileSensConvButtons();
  updateGameInfoPanelVisibility();
  isInitialRoute = true;
  initTabRouting();
  applySharedParams();
  syncUrlToTab(getCurrentTabId(), { replace: true, keepSearch: Boolean(new URLSearchParams(window.location.search).get("t")) });
  isInitialRoute = false;
  scrollToTop(350);
  finishAppLoadingScreen();
});

window.switchTab = switchTab;
window.cycleTabFromLogo = cycleTabFromLogo;
window.scrollToTop = scrollToTop;
window.applyEdpiPreset = applyEdpiPreset;
