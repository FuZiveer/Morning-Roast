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

function prefersReducedUiMotion() {
  return document.body?.classList.contains("reduce-motion") || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
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
      syncSiteAssistantNotifyVisibility(false);
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
      syncSiteAssistantNotifyVisibility(false);
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
    syncSiteAssistantNotifyVisibility(true);
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

function stripEmptyNativeTitles(root = document) {
  const nodes = [];
  if (root instanceof Element) {
    if (root.hasAttribute("title")) nodes.push(root);
    root.querySelectorAll("[title]").forEach((el) => nodes.push(el));
  } else if (root instanceof Document || root === document) {
    document.querySelectorAll("[title]").forEach((el) => nodes.push(el));
  }
  nodes.forEach((el) => {
    if (!String(el.getAttribute("title") ?? "").trim()) el.removeAttribute("title");
  });
}

function initEmptyTitleGuard() {
  stripEmptyNativeTitles();
  if (initEmptyTitleGuard._init) return;
  initEmptyTitleGuard._init = true;

  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes" && mutation.attributeName === "title") {
        const el = mutation.target;
        if (el instanceof Element && el.hasAttribute("title") && !String(el.getAttribute("title") ?? "").trim()) {
          el.removeAttribute("title");
        }
        return;
      }
      mutation.addedNodes.forEach((node) => {
        if (node instanceof Element) stripEmptyNativeTitles(node);
      });
    });
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["title"],
  });
}

function attachUiTooltip(element, text, { placement = "top", id = "" } = {}) {
  if (!(element instanceof HTMLElement)) return;
  const label = String(text ?? "").trim();
  element.removeAttribute("title");
  if (!label) {
    element.classList.remove("has-ui-tooltip");
    element.querySelector(":scope > .ui-tooltip")?.remove();
    delete element.dataset.tooltipPlacement;
    return;
  }

  element.classList.add("has-ui-tooltip");
  element.dataset.tooltipPlacement = placement;

  let tip = element.querySelector(":scope > .ui-tooltip");
  if (!tip) {
    tip = document.createElement("span");
    tip.className = "ui-tooltip";
    tip.setAttribute("role", "tooltip");
    element.appendChild(tip);
    if (element.dataset.uiTooltipBound !== "1") {
      element.dataset.uiTooltipBound = "1";
      element.addEventListener("mousedown", (event) => event.preventDefault());
    }
  }

  if (id) tip.id = id;
  else tip.removeAttribute("id");
  tip.textContent = label;
}

window.attachUiTooltip = attachUiTooltip;

function syncSiteAssistantNotifyVisibility(hasActiveToasts) {
  const assistant = document.getElementById("site-assistant");
  if (!assistant) return;
  assistant.classList.toggle("has-notify", Boolean(hasActiveToasts));
}

function copyTextFallback(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (_) {
    ok = false;
  }
  textarea.remove();
  return ok;
}

function copyText(text, toastBody) {
  const value = String(text ?? "").trim();
  if (!value) return Promise.resolve();

  const onSuccess = () => notifyCopied(toastBody ?? `<b>${value}</b> has been copied.`);
  const onFailure = () => Toast.notify({ message: "Could not copy to clipboard", type: "error" });

  if (navigator.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(value)
      .then(onSuccess)
      .catch(() => (copyTextFallback(value) ? onSuccess() : onFailure()));
  }

  return Promise.resolve().then(() => (copyTextFallback(value) ? onSuccess() : onFailure()));
}

const trainerConfigs = MorningRoastGames.buildTrainerConfigs();

const SUPPORTED_GAMES = MorningRoastGames.SUPPORTED_GAMES;

function getGameDisplayName(game) {
  return MorningRoastGames.getGameDisplayName(game);
}

function resolveStoredGameName(stored) {
  if (!stored) return null;
  return MorningRoastGames.resolveGameName(stored);
}

function getGameConversionFactor(game) {
  return MorningRoastGames.getGameConversionFactor(game);
}

function resolveConverterGameInput(idPrefix) {
  const input = elements[`${idPrefix}-search`] || document.getElementById(`${idPrefix}-search`);
  if (!input) return null;
  return getCommittedGameFromInput(input);
}

function getConverterGameState(input) {
  if (!input) return "";
  const committed = getCommittedGameFromInput(input);
  if (committed) return committed;
  const lastValid = input.dataset.lastValid || "";
  return lastValid ? MorningRoastGames.resolveGameName(lastValid) || "" : "";
}

function setConverterGameState(input, game) {
  if (!input) return;
  const resolved = game ? MorningRoastGames.resolveGameName(game) || game : "";
  input.dataset.lastValid = resolved;
  input.value = resolved ? getGameDisplayName(resolved) : "";
}

function resolveEdpiGameInput() {
  const input = elements["edpi-game-search"] || document.getElementById("edpi-game-search");
  if (!input) return null;
  return getCommittedGameFromInput(input);
}

/** Simple Icons + fallback colors for game dropdowns and triggers. */
const GAME_ICON_DEFS = Object.freeze({
  Aimlabs: { fallback: "hsl(190, 80%, 50%)" },
  "Apex Legends": { slug: "ea", color: "DA292A", fallback: "hsl(0, 80%, 55%)" },
  "ARC Raiders": { slug: "ea", color: "6BB7FF", fallback: "hsl(200, 70%, 55%)" },
  "Black Ops 7": { slug: "activision", color: "000000", fallback: "hsl(95, 45%, 50%)" },
  CS2: { slug: "counterstrike", color: "DE9B35", fallback: "hsl(37, 90%, 51%)" },
  "Delta Force": { fallback: "hsl(150, 60%, 45%)" },
  "Escape from Tarkov": { fallback: "hsl(40, 30%, 50%)" },
  Fortnite: { slug: "fortnite", color: "9D4DBB", fallback: "hsl(265, 70%, 60%)" },
  "Marvel Rivals": { fallback: "hsl(355, 85%, 55%)" },
  Overwatch: { slug: "activision", color: "FA9C1E", fallback: "hsl(28, 90%, 55%)" },
  "osu!": { slug: "osu", color: "FF66AA", fallback: "hsl(330, 80%, 60%)" },
  "Rainbow 6 Siege": { slug: "ubisoft", color: "0080FF", fallback: "hsl(210, 90%, 55%)" },
  Roblox: { slug: "roblox", color: "E2231A", fallback: "hsl(0, 0%, 60%)" },
  Rust: { slug: "rust", color: "CE422B", fallback: "hsl(15, 55%, 50%)" },
  Valorant: { slug: "valorant", color: "FF4655", fallback: "hsl(355, 100%, 64%)" },
});

const DEFAULT_GAME_TRIGGER_ICON = '<svg class="icon-game" viewBox="0 0 24 24" fill="none" stroke="hsl(0, 0%, 27%)" stroke-width="2" aria-hidden="true"><path d="M6 12h4M8 10v4M15 11h.01M18 13h.01"/><path d="M15 5H9a7 7 0 0 0-7 7v4a3 3 0 0 0 3 3 5 5 0 0 1 3-1h8a5 5 0 0 1 3 1 3 3 0 0 0 3-3v-4a7 7 0 0 0-7-7Z"/></svg>';

const GAME_TRIGGER_PREFIXES = ["from", "to", "edpi-game", "trainer-game", "profile-game", "lineup-game"];

function resolveGameIconName(gameName) {
  return MorningRoastGames.resolveGameName(gameName) || gameName || "";
}

function getGameIconDef(gameName) {
  const resolved = resolveGameIconName(gameName);
  return GAME_ICON_DEFS[resolved] || null;
}

function getGameIconSrc(gameName) {
  const resolved = resolveGameIconName(gameName);
  const def = GAME_ICON_DEFS[resolved];
  if (!def?.slug) return "";
  return `https://cdn.simpleicons.org/${def.slug}/${def.color || "ffffff"}`;
}

function getGameIconFallbackColor(gameName) {
  const def = getGameIconDef(gameName);
  return def?.fallback || "hsl(0, 0%, 55%)";
}

function getGameIconInitial(gameName) {
  const cleaned = String(gameName || "").replace(/[^A-Za-z0-9]/g, "");
  return (cleaned.charAt(0) || "?").toUpperCase();
}

function renderGameIconFallbackMarkup(gameName, className = "game-option-icon") {
  const resolved = resolveGameIconName(gameName);
  const color = getGameIconFallbackColor(resolved);
  const initial = getGameIconInitial(resolved);
  return `<span class="${className} game-option-icon--fallback" style="--game-icon-color:${color}" aria-hidden="true">${initial}</span>`;
}

function renderGameOptionIcon(gameName) {
  const resolved = resolveGameIconName(gameName);
  const src = getGameIconSrc(resolved);
  if (src) {
    return `<img class="game-option-icon" src="${src}" alt="" width="18" height="18" loading="lazy" decoding="async" data-game-icon-name="${encodeURIComponent(resolved)}" />`;
  }
  return renderGameIconFallbackMarkup(resolved);
}

function renderGameTriggerIconContent(gameName) {
  const resolved = resolveGameIconName(gameName);
  const src = getGameIconSrc(resolved);
  if (src) {
    return `<img class="game-option-icon game-trigger-icon__img" src="${src}" alt="" width="18" height="18" decoding="async" data-game-icon-name="${encodeURIComponent(resolved)}" />`;
  }
  return renderGameIconFallbackMarkup(resolved, "game-option-icon game-trigger-icon__img");
}

function ensureGameTriggerIconSlot(trigger) {
  if (!trigger) return null;
  let slot = trigger.querySelector(".game-trigger-icon");
  if (slot) return slot;

  const svg = trigger.querySelector(".icon-game");
  if (!svg) return null;

  slot = document.createElement("span");
  slot.className = "game-trigger-icon icon-game";
  slot.setAttribute("aria-hidden", "true");
  slot.dataset.defaultIcon = DEFAULT_GAME_TRIGGER_ICON;
  svg.replaceWith(slot);
  slot.innerHTML = DEFAULT_GAME_TRIGGER_ICON;
  return slot;
}

function syncGameTriggerIcon(idPrefix) {
  const trigger = document.getElementById(`${idPrefix}-trigger`);
  const slot = ensureGameTriggerIconSlot(trigger);
  if (!slot) return;

  let gameName = "";
  if (idPrefix === "lineup-game") {
    const activeGame = getActiveLineupGame();
    gameName = activeGame ? LINEUP_GAME_OPTIONS[activeGame]?.gameName || "" : "";
  } else {
    const input = document.getElementById(`${idPrefix}-search`);
    gameName = getCommittedGameFromInput(input) || "";
  }

  slot.innerHTML = gameName ? renderGameTriggerIconContent(gameName) : slot.dataset.defaultIcon || DEFAULT_GAME_TRIGGER_ICON;
}

function syncAllGameTriggerIcons() {
  GAME_TRIGGER_PREFIXES.forEach(syncGameTriggerIcon);
}

function handleGameIconError(img) {
  if (!(img instanceof HTMLImageElement)) return;
  const name = decodeURIComponent(img.dataset.gameIconName || "");
  if (!name) return;
  const isTrigger = img.classList.contains("game-trigger-icon__img");
  const replacement = document.createElement("span");
  replacement.innerHTML = renderGameIconFallbackMarkup(name, isTrigger ? "game-option-icon game-trigger-icon__img" : "game-option-icon");
  img.replaceWith(replacement.firstElementChild);
}

function initGameIconErrorFallback() {
  document.addEventListener(
    "error",
    (e) => {
      const target = e.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (!target.classList.contains("game-option-icon") && !target.classList.contains("game-trigger-icon__img")) return;
      handleGameIconError(target);
    },
    true,
  );
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
    initBgBackdropControl.close?.();
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
    initBgBackdropControl.close?.();
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
  list.innerHTML = SUPPORTED_GAMES.map((name) => `<button type="button" class="pref-dropdown-option" ${valueAttr}="${name}" role="option">${renderGameOptionIcon(name)}<span>${getGameDisplayName(name)}</span></button>`).join("");
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

const clipboardState = {
  isCopying: false,
};

const elements = {};
const cacheElements = () => {
  const ids = ["base-sens", "from-dpi", "to-dpi", "new-sens-value", "from-search", "to-search", "edpi-dpi", "edpi-sens", "edpi-dpi-b", "edpi-sens-b", "edpi-game-search", "edpi-value", "edpi-value-b", "edpi-cm360", "edpi-compare-gap", "spectrum-pointer", "spectrum-pointer-b", "edpi-rank", "edpi-rank-b", "canvas-sens", "canvas-dpi", "profile-best-spatial-canvas", "profile-best-precision-canvas", "finder-reset-btn"];
  ids.forEach((id) => {
    elements[id] = document.getElementById(id);
  });
};

function scrollToTop(ms = 0, { allowMobile = false, instant = false } = {}) {
  if (!allowMobile && window.innerWidth <= 768) return;

  const apply = () => {
    window.scrollTo({
      top: 0,
      left: 0,
      behavior: instant ? "instant" : "smooth",
    });
  };

  if (ms > 0) {
    setTimeout(() => {
      if (!instant && window.scrollY <= 0) return;
      apply();
    }, ms);
    return;
  }

  if (!instant && window.scrollY <= 0) return;
  apply();
  if (instant) requestAnimationFrame(apply);
}

const DISTANCE_360_UNIT_KEY = "prefDistance360Unit";
const DEFAULT_DISTANCE_360_UNIT = "cm";
const CM360_INCH_TO_CM = 2.54;

function getDistance360Unit() {
  return localStorage.getItem(DISTANCE_360_UNIT_KEY) === "in" ? "in" : "cm";
}

function calculateCm360Value(sens, dpi, game) {
  const yaw = MorningRoastGames.getGameYaw(game);
  if (!sens || !dpi || sens <= 0 || dpi <= 0 || yaw == null || yaw <= 0) return null;
  return (360 * CM360_INCH_TO_CM) / (dpi * sens * yaw);
}

function calculateIn360Value(sens, dpi, game) {
  const cm = calculateCm360Value(sens, dpi, game);
  return cm == null ? null : cm / CM360_INCH_TO_CM;
}

function formatEdpiInlineDistance360(sens, dpi, game, unit = getDistance360Unit()) {
  const value = unit === "in" ? calculateIn360Value(sens, dpi, game) : calculateCm360Value(sens, dpi, game);
  const label = `${unit}/360`;
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  return `${value.toFixed(3)} ${label}`;
}

function setEdpiCm360Display(sens, dpi, game) {
  const cmDisplay = elements["edpi-cm360"];
  if (!cmDisplay) return;
  const text = formatEdpiInlineDistance360(sens, dpi, game);
  const visible = Boolean(text);
  cmDisplay.textContent = text;
  cmDisplay.hidden = !visible;
  toggleVisibility(cmDisplay, visible);
}

function formatDistance360(sens, dpi, game, unit = getDistance360Unit()) {
  const value = unit === "in" ? calculateIn360Value(sens, dpi, game) : calculateCm360Value(sens, dpi, game);
  if (value == null || !Number.isFinite(value)) {
    return unit === "in" ? "- in/360" : "- cm/360";
  }
  return `${value.toFixed(2)} ${unit}/360`;
}

function formatDistance360Short(sens, dpi, game, unit = getDistance360Unit()) {
  const value = unit === "in" ? calculateIn360Value(sens, dpi, game) : calculateCm360Value(sens, dpi, game);
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(3)} ${unit}`;
}

function formatDistance360ShortFromCm(cmValue, unit = getDistance360Unit()) {
  const cm = parseFloat(cmValue);
  if (!cm || !Number.isFinite(cm) || cm <= 0) return "-";
  const value = unit === "in" ? cm / CM360_INCH_TO_CM : cm;
  return `${value.toFixed(3)} ${unit}`;
}

function formatRecommendedSpectrumDistance(cmValue, unit = getDistance360Unit()) {
  const cm = parseFloat(cmValue);
  if (!cm || !Number.isFinite(cm) || cm <= 0) return "";
  if (unit === "in") return `${(cm / CM360_INCH_TO_CM).toFixed(1)} in`;
  return `${Math.round(cm)} cm`;
}

function refreshDistance360Displays() {
  updateEDPI();
  const savedEdpiCm = localStorage.getItem("lastEdpiCm");
  const profileCm = document.getElementById("profile-edpi-cm");
  if (profileCm && savedEdpiCm) {
    profileCm.textContent = formatDistance360ShortFromCm(savedEdpiCm);
  }
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

const DEFAULT_ACCENT = "330 99% 46%";

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

function hsvToHsl(h, s, v) {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const val = v / 100;
  const l = val * (1 - sat / 2);
  let sl = 0;
  if (l > 0 && l < 1) sl = (val - l) / Math.min(l, 1 - l);
  return { h: hue, s: sl * 100, l: l * 100 };
}

function hslToHsv(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = s / 100;
  const lit = l / 100;
  const v = lit + sat * Math.min(lit, 1 - lit);
  let sv = 0;
  if (v > 0) sv = 2 * (1 - lit / v);
  return { h: hue, s: sv * 100, v: v * 100 };
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

function parseAccentHexInput(raw) {
  if (!raw) return null;
  let value = String(raw).trim().toUpperCase();
  if (!value.startsWith("#")) value = `#${value}`;
  if (value.length === 4) {
    value = `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`;
  }
  return /^#[0-9A-F]{6}$/.test(value) ? value : null;
}

function accentColorString(hsl) {
  const normalized = normalizeAccent(hsl);
  const [h, s, l] = normalized.split(/\s+/);
  return hslComponentsToHex(parseFloat(h), parseFloat(s), parseFloat(l));
}

function accentOnColor(hex) {
  const raw = hex.replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const toLinear = (channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance > 0.62 ? "hsl(0, 0%, 5%)" : "hsl(0, 0%, 100%)";
}

function syncAccentContrastColor(hex) {
  document.documentElement.style.setProperty("--accent-on-color", accentOnColor(hex));
}

function syncAccentCustomSwatchStyle(element, color) {
  if (!element) return;
  const hexValue = accentColorString(color);
  element.style.setProperty("--swatch", hexValue);
  element.style.setProperty("--swatch-on-color", accentOnColor(hexValue));
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

const accentRuntime = {
  appliedKey: DEFAULT_ACCENT,
  transitionCleanup: null,
  transitionFallback: 0,
};

function clearAccentTransitionCleanup() {
  if (accentRuntime.transitionCleanup) {
    document.documentElement.removeEventListener("transitionend", accentRuntime.transitionCleanup);
    accentRuntime.transitionCleanup = null;
  }
  clearTimeout(accentRuntime.transitionFallback);
  accentRuntime.transitionFallback = 0;
  document.documentElement.classList.remove("accent-changing");
}

function finalizeAccentTransition(targetHex) {
  const root = document.documentElement;
  clearAccentTransitionCleanup();
  root.classList.add("accent-instant");
  syncAccentContrastColor(targetHex);
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
  assets: false,
  dismissed: false,
};

const APP_LOADING_PROGRESS_WEIGHTS = {
  fonts: 8,
  accent: 7,
  logo: 7,
  entrance: 8,
  assets: 70,
};

const appLoadingAssetProgress = {
  total: 0,
  loaded: 0,
};

function getAppLoadingProgressPercent() {
  let percent = 0;

  for (const [key, weight] of Object.entries(APP_LOADING_PROGRESS_WEIGHTS)) {
    if (key === "assets") {
      if (appLoadingState.assets) {
        percent += weight;
      } else if (appLoadingAssetProgress.total > 0) {
        percent += weight * (appLoadingAssetProgress.loaded / appLoadingAssetProgress.total);
      }
      continue;
    }
    if (appLoadingState[key]) percent += weight;
  }

  return Math.min(100, Math.round(percent));
}

function updateAppLoadingProgressUI() {
  const bar = document.getElementById("app-loading-progress-bar");
  const label = document.getElementById("app-loading-progress-label");
  const meter = document.getElementById("app-loading-progress");
  if (!bar || !label) return;

  const percent = getAppLoadingProgressPercent();
  bar.style.width = `${percent}%`;
  label.textContent = `${percent}%`;
  meter?.setAttribute("aria-valuenow", String(percent));
  syncAppLoadingBarWidth();
}

function syncAppLoadingBarWidth() {
  const screen = document.getElementById("app-loading-screen");
  const title = document.querySelector("#app-loading-stage .app-loading-label");
  const progress = document.getElementById("app-loading-progress");
  if (!screen || !title || !progress) return;
  const width = Math.ceil(title.getBoundingClientRect().width);
  screen.style.setProperty("--app-loading-bar-width", `${width}px`);
}

function initAppLoadingBarWidthSync() {
  const title = document.querySelector("#app-loading-stage .app-loading-label");
  if (!title || initAppLoadingBarWidthSync._init) return;
  initAppLoadingBarWidthSync._init = true;

  const sync = () => syncAppLoadingBarWidth();
  sync();

  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(sync);
    observer.observe(title);
  }

  window.addEventListener("resize", sync);
  document.fonts?.ready?.then(sync).catch(() => {});
}

function markAppLoadingReady(key) {
  if (appLoadingState[key] !== false) return;
  appLoadingState[key] = true;
  updateAppLoadingProgressUI();
  tryDismissAppLoadingScreen();
}

function waitForImageUrl(url) {
  if (!url) return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = "async";
    const finish = () => {
      if (typeof img.decode === "function") return img.decode().then(resolve).catch(resolve);
      resolve();
    };
    img.onload = finish;
    img.onerror = () => resolve();
    img.src = url;
  });
}

const APP_LOCAL_IMAGE_PATHS = [
  "assets/logo.png",
  "assets/crosshair-preview-bg.png",
  "assets/crosshair-preview-bg-2.png",
  "assets/crosshair-preview-bg-3.png",
  "assets/backgrounds/sunset-lake.jpg",
  "assets/backgrounds/synthwave-peaks.jpg",
  "assets/backgrounds/neon-city-street.jpg",
  "assets/backgrounds/purple-stag-lake.jpg",
  "assets/backgrounds/moon-mountain-stars.jpg",
  "assets/backgrounds/rustic-coffee-bar.jpg",
  "assets/backgrounds/prismatic-ridge.jpg",
  "assets/backgrounds/cosmic-burst.jpg",
  "assets/backgrounds/dark-wood.jpg",
  "assets/backgrounds/royal-damask.jpg",
  "assets/backgrounds/charcoal-slate.jpg",
  "assets/backgrounds/neon-flame-stream.jpg",
  "assets/backgrounds/magenta-paper-glow.jpg",
  "assets/backgrounds/aged-parchment.jpg",
  "assets/backgrounds/magenta-fluid-waves.jpg",
  "assets/backgrounds/crimson-wire-mesh.jpg",
  "assets/backgrounds/ember-low-poly.jpg",
  "assets/backgrounds/prismatic-low-poly.jpg",
  "assets/backgrounds/cyan-magenta-plexus.jpg",
  "assets/backgrounds/neon-shard-streaks.jpg",
  "assets/backgrounds/magenta-light-trails.jpg",
  "assets/backgrounds/blue-crystal-poly.jpg",
  "assets/backgrounds/diagonal-prism-streaks.jpg",
  "assets/backgrounds/purple-nebula.jpg",
  "assets/backgrounds/neon-crystal-shards.jpg",
  "assets/backgrounds/violet-tree-canopy.jpg",
  "assets/backgrounds/japanese-maple-autumn.jpg",
  "assets/backgrounds/dark-ferns.jpg",
  "assets/lineups/cs2/mirage/thumbnail.webp",
  "assets/lineups/valorant/pearl/thumbnail.webp",
  "assets/lineup-utilities/cs2/flashbang.png",
  "assets/lineup-utilities/cs2/he.png",
  "assets/lineup-utilities/cs2/incendiary.png",
  "assets/lineup-utilities/cs2/molotov.png",
  "assets/lineup-utilities/cs2/smoke.png",
  "assets/lineup-utilities/cs2/ct.svg",
  "assets/lineup-utilities/cs2/t.svg",
  "assets/lineup-utilities/valorant/flash.png",
  "assets/lineup-utilities/valorant/molly.png",
  "assets/lineup-utilities/valorant/recon.png",
  "assets/lineup-utilities/valorant/smoke.png",
  "assets/lineup-utilities/valorant/a.svg",
  "assets/lineup-utilities/valorant/d.svg",
];

function addAppLoadingImageUrl(urls, pathOrUrl) {
  if (!pathOrUrl) return;
  if (/^(https?:|data:|blob:)/i.test(pathOrUrl)) {
    urls.add(pathOrUrl);
    return;
  }
  const clean = String(pathOrUrl).replace(/^\.\//, "").replace(/^\//, "");
  if (typeof resolveAppAssetUrl === "function") {
    urls.add(resolveAppAssetUrl(clean));
    return;
  }
  urls.add(`${getAppBasePath()}${clean}`);
}

function collectAppLoadingImageUrls() {
  const urls = new Set();

  APP_LOCAL_IMAGE_PATHS.forEach((path) => addAppLoadingImageUrl(urls, path));

  for (const img of document.images) {
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!src) continue;
    try {
      addAppLoadingImageUrl(urls, new URL(src, window.location.href).href);
    } catch {
      addAppLoadingImageUrl(urls, src);
    }
  }

  return [...urls];
}

function collectAppLoadingImageWaiters() {
  return collectAppLoadingImageUrls().map((url) => waitForImageUrl(url));
}

function initAppLoadingAssetsReady() {
  if (initAppLoadingAssetsReady._started) return;
  initAppLoadingAssetsReady._started = true;

  const settle = () => markAppLoadingReady("assets");
  const loadPromise = document.readyState === "complete" ? Promise.resolve() : new Promise((resolve) => window.addEventListener("load", resolve, { once: true }));

  loadPromise
    .then(() => {
      const urls = collectAppLoadingImageUrls();
      appLoadingAssetProgress.total = urls.length;
      appLoadingAssetProgress.loaded = 0;
      updateAppLoadingProgressUI();

      if (!urls.length) return;
      return Promise.all(
        urls.map((url) =>
          waitForImageUrl(url).finally(() => {
            appLoadingAssetProgress.loaded += 1;
            updateAppLoadingProgressUI();
          }),
        ),
      );
    })
    .then(settle)
    .catch(settle);

  // Failsafe so a stalled asset never traps the loading screen.
  window.setTimeout(settle, 30000);
}

/** Unit cubic-bezier easing (matches CSS cubic-bezier). */
function createCubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const sampleDX = (t) => (3 * ax * t + 2 * bx) * t + cx;

  const solveT = (x) => {
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const dx = sampleDX(t);
      if (Math.abs(dx) < 1e-6) break;
      const diff = sampleX(t) - x;
      if (Math.abs(diff) < 1e-7) return t;
      t -= diff / dx;
    }
    let lo = 0;
    let hi = 1;
    t = x;
    for (let i = 0; i < 20; i += 1) {
      const xEst = sampleX(t);
      if (Math.abs(xEst - x) < 1e-7) return t;
      if (x > xEst) lo = t;
      else hi = t;
      t = (lo + hi) / 2;
    }
    return t;
  };

  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return sampleY(solveT(x));
  };
}

const APP_LOADING_SPLIT_EASE = createCubicBezier(0.7, 0, 0.25, 1);

function syncAppLoadingSliceAngle(screen) {
  if (!screen) return null;
  const w = screen.clientWidth;
  const h = screen.clientHeight;
  if (w <= 0 || h <= 0) return null;
  // Corner clip (TR↔BL) angle — matches the panel diagonal, not a hard-coded -45deg.
  const angleDeg = -Math.atan2(h, w) * (180 / Math.PI);
  screen.style.setProperty("--app-loading-slice-angle", `${angleDeg}deg`);
  // Slide halves apart along the perpendicular into each clipped region.
  const len = Math.hypot(w, h) || 1;
  const dist = Math.max(w, h) * 1.1;
  const ax = (-h / len) * dist;
  const ay = (-w / len) * dist;
  screen.style.setProperty("--app-loading-split-a-x", `${ax}px`);
  screen.style.setProperty("--app-loading-split-a-y", `${ay}px`);
  screen.style.setProperty("--app-loading-split-b-x", `${-ax}px`);
  screen.style.setProperty("--app-loading-split-b-y", `${-ay}px`);
  return { ax, ay };
}

function animateAppLoadingSplit(screen, durationMs, onDone) {
  const panelA = screen.querySelector(".app-loading-panel--a");
  const panelB = screen.querySelector(".app-loading-panel--b");
  const geometry = syncAppLoadingSliceAngle(screen);
  if (!panelA || !panelB || !geometry) {
    onDone?.();
    return;
  }

  const { ax, ay } = geometry;
  panelA.style.transition = "none";
  panelB.style.transition = "none";
  panelA.style.transform = "translate3d(0, 0, 0)";
  panelB.style.transform = "translate3d(0, 0, 0)";
  // Gap between halves can receive clicks; panels keep blocking where they still cover.
  screen.style.pointerEvents = "none";
  panelA.style.pointerEvents = "auto";
  panelB.style.pointerEvents = "auto";
  document.body.classList.add("app-loading-splitting");
  screen.classList.add("is-splitting");

  let start = null;
  let rafId = 0;

  const tick = (now) => {
    if (start == null) start = now;
    const t = Math.min(1, (now - start) / durationMs);
    const e = APP_LOADING_SPLIT_EASE(t);
    const x = ax * e;
    const y = ay * e;
    panelA.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    panelB.style.transform = `translate3d(${-x}px, ${-y}px, 0)`;

    if (t < 1) {
      rafId = requestAnimationFrame(tick);
      return;
    }
    onDone?.();
  };

  // Double rAF so the idle transform paints before the first eased frame.
  requestAnimationFrame(() => {
    rafId = requestAnimationFrame(tick);
  });

  return () => cancelAnimationFrame(rafId);
}

function prepareAppLoadingSplit(screen) {
  const stage = screen.querySelector("#app-loading-stage");
  const panelA = screen.querySelector(".app-loading-panel--a");
  const panelB = screen.querySelector(".app-loading-panel--b");
  if (!stage || !panelA || !panelB) return false;
  syncAppLoadingSliceAngle(screen);

  [panelA, panelB].forEach((panel) => {
    const clone = stage.cloneNode(true);
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach((el) => el.removeAttribute("id"));
    // Logo has already become the blade — keep stage bg only in the split halves.
    clone.querySelector(".app-loading-logo-shell")?.remove();
    clone.querySelector(".app-loading-label")?.remove();
    clone.querySelector(".app-loading-progress")?.remove();
    const edge = panel.querySelector(".app-loading-panel-edge");
    panel.replaceChildren(clone);
    if (edge) panel.appendChild(edge);
  });

  return true;
}

function liftAppLoadingBlade(screen) {
  const shell = screen.querySelector("#app-loading-stage .app-loading-logo-shell");
  if (!shell) return null;
  shell.classList.add("app-loading-blade");
  screen.appendChild(shell);
  return shell;
}

function tryDismissAppLoadingScreen() {
  if (appLoadingState.dismissed) return;
  if (!appLoadingState.fonts || !appLoadingState.accent || !appLoadingState.logo || !appLoadingState.entrance || !appLoadingState.assets) return;

  const screen = document.getElementById("app-loading-screen");
  if (!screen) {
    document.body.classList.add("app-ready");
    queueUsernameOnboardingAfterLoad();
    return;
  }

  appLoadingState.dismissed = true;
  document.body.classList.add("app-ready", "app-loading");
  screen.setAttribute("aria-busy", "false");

  const removeScreen = () => {
    document.body.classList.remove("app-loading", "app-loading-splitting");
    if (screen.isConnected) screen.remove();
    queueUsernameOnboardingAfterLoad();
  };

  if (document.body.classList.contains("reduce-motion") || prefersReducedUiMotion()) {
    removeScreen();
    return;
  }

  const borderFillMs = 480;
  const labelFadeMs = 280;
  const morphMs = 720;
  const sliceMs = 720;
  const splitMs = 1750;
  const splitFallbackMs = borderFillMs + labelFadeMs + morphMs + sliceMs + splitMs + 300;

  // 1) Border fills fully accent when load completes
  screen.classList.add("is-border-ready");

  // 2) Label fades first
  window.setTimeout(() => {
    screen.classList.add("is-label-fading");
  }, borderFillMs);

  // 3) Logo morphs into the red blade line
  window.setTimeout(() => {
    syncAppLoadingSliceAngle(screen);
    liftAppLoadingBlade(screen);
    void screen.offsetWidth;
    screen.classList.add("is-morphing");
  }, borderFillMs + labelFadeMs);

  // 4) Red line expands across the screen
  window.setTimeout(
    () => {
      prepareAppLoadingSplit(screen);
      void screen.offsetWidth;
      screen.classList.add("is-slicing");
    },
    borderFillMs + labelFadeMs + morphMs,
  );

  // 5) Halves split with red edge borders (rAF-driven for smooth motion)
  window.setTimeout(
    () => {
      animateAppLoadingSplit(screen, splitMs, removeScreen);
    },
    borderFillMs + labelFadeMs + morphMs + sliceMs,
  );

  setTimeout(removeScreen, splitFallbackMs);
}

function initAppLoadingScreen() {
  const screen = document.getElementById("app-loading-screen");
  if (!screen) {
    document.body.classList.add("app-ready");
    queueUsernameOnboardingAfterLoad();
    return;
  }

  syncAppLoadingSliceAngle(screen);
  const onSliceResize = () => {
    if (!screen.isConnected) {
      window.removeEventListener("resize", onSliceResize);
      return;
    }
    syncAppLoadingSliceAngle(screen);
  };
  window.addEventListener("resize", onSliceResize);

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

  initAppLoadingAssetsReady();
  initAppLoadingBarWidthSync();
  updateAppLoadingProgressUI();
}

function initAppSidebar() {
  const sidebar = document.querySelector(".app-sidebar");
  if (!sidebar) return;

  sidebar.addEventListener("click", (event) => {
    const button = event.target.closest(".app-sidebar-item, .app-sidebar-more-toggle, .app-sidebar-misc-toggle");
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
  syncMiscTabUi();
  if (MISC_TAB_ENABLED) initAppMiscMenu();
}

function syncMiscTabUi() {
  const misc = document.getElementById("app-sidebar-misc");
  const navMisc = document.getElementById("nav-misc-dropdown");
  if (misc) misc.hidden = false;
  if (navMisc) navMisc.hidden = false;
}

const sidebarMenuCloseCallbacks = {
  more: null,
  misc: null,
};

function getSidebarBorderMotionMs() {
  if (document.body.classList.contains("reduce-motion")) return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--button-motion-duration").trim();
  if (!raw) return 300;
  if (raw.endsWith("ms")) return Number.parseFloat(raw) || 300;
  if (raw.endsWith("s")) return (Number.parseFloat(raw) || 0.3) * 1000;
  return Number.parseFloat(raw) || 300;
}

function getBorderWidthPx() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--border-width").trim();
  if (!raw) return 2;
  if (raw.endsWith("px")) return Number.parseFloat(raw) || 2;
  return Number.parseFloat(raw) || 2;
}

function getMoreMenuBorderGapEnd(sidebarRect) {
  return Math.round(sidebarRect.height + getBorderWidthPx());
}

function queueSidebarMenuCloseCallback(kind, callback) {
  if (!callback) return;
  const previous = sidebarMenuCloseCallbacks[kind];
  sidebarMenuCloseCallbacks[kind] = previous
    ? () => {
        previous();
        callback();
      }
    : callback;
}

function flushSidebarMenuCloseCallback(kind) {
  const callback = sidebarMenuCloseCallbacks[kind];
  sidebarMenuCloseCallbacks[kind] = null;
  callback?.();
}

function isAppSidebarMenuActive(kind) {
  const root = document.getElementById(kind === "more" ? "app-sidebar-more" : "app-sidebar-misc");
  return Boolean(root?.classList.contains("is-open") || root?.classList.contains("is-closing"));
}

function clearSidebarMenuBorderGap(sidebar) {
  if (!sidebar) return;
  sidebar.style.removeProperty("--sidebar-menu-border-gap-start");
  sidebar.style.removeProperty("--sidebar-menu-border-gap-end");
}

function closeSidebarMenuBorderGap(sidebar, gapStart, gapEnd, onComplete) {
  if (!sidebar) {
    onComplete?.();
    return;
  }

  const borderRestoreMs = getSidebarBorderMotionMs();
  if (document.body.classList.contains("reduce-motion") || !borderRestoreMs) {
    clearSidebarMenuBorderGap(sidebar);
    onComplete?.();
    return;
  }

  sidebar.dataset.borderRestoring = "true";
  const gapCenter = Math.round((gapStart + gapEnd) / 2);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setSidebarMenuBorderGap(sidebar, gapCenter, gapCenter);
      window.setTimeout(() => {
        clearSidebarBorderRestoring(sidebar);
        clearSidebarMenuBorderGap(sidebar);
        onComplete?.();
      }, borderRestoreMs);
    });
  });
}

function clearSidebarBorderRestoring(sidebar) {
  if (!sidebar) return;
  delete sidebar.dataset.borderRestoring;
}

function setSidebarMenuBorderGap(sidebar, gapStart, gapEnd) {
  if (!sidebar) return;
  sidebar.style.setProperty("--sidebar-menu-border-gap-start", `${gapStart}px`);
  sidebar.style.setProperty("--sidebar-menu-border-gap-end", `${gapEnd}px`);
}

function computeMoreMenuBorderMetrics() {
  const sidebar = document.querySelector(".app-sidebar");
  const menu = document.getElementById("sidebar-more-menu");
  const toggle = document.getElementById("sidebar-more-button");
  if (!sidebar || !menu || !toggle) return null;

  const sidebarRect = sidebar.getBoundingClientRect();
  const toggleRect = toggle.getBoundingClientRect();
  const { viewportHeight, viewportOffsetTop } = getViewportInsets(0);
  const viewportBottom = viewportOffsetTop + viewportHeight;
  let menuTop = Math.round(toggleRect.top);

  const contentHeight = menu.scrollHeight;
  const availableBelowToggle = viewportBottom - menuTop;
  if (contentHeight > availableBelowToggle) {
    menuTop = Math.max(viewportOffsetTop, viewportBottom - contentHeight);
  }

  const gapStart = Math.max(0, Math.round(menuTop - sidebarRect.top));
  const gapEnd = getMoreMenuBorderGapEnd(sidebarRect);
  return { menuTop, gapStart, gapEnd };
}

function computeMiscMenuBorderMetrics() {
  const sidebar = document.querySelector(".app-sidebar");
  const menu = document.getElementById("sidebar-misc-menu");
  const toggle = document.getElementById("sidebar-misc-button");
  if (!sidebar || !menu || !toggle) return null;

  const sidebarRect = sidebar.getBoundingClientRect();
  const toggleRect = toggle.getBoundingClientRect();
  const { padding, viewportHeight, viewportOffsetTop } = getViewportInsets();
  let viewportMenuTop = Math.round(toggleRect.top);

  const menuHeight = menu.scrollHeight;
  const maxTop = viewportOffsetTop + viewportHeight - padding - menuHeight;
  viewportMenuTop = Math.min(viewportMenuTop, Math.max(viewportOffsetTop + padding, maxTop));
  const maxHeight = Math.max(viewportOffsetTop + viewportHeight - viewportMenuTop - padding, 120);

  const gapStart = Math.max(0, Math.round(viewportMenuTop - sidebarRect.top));
  const gapEnd = Math.max(gapStart, Math.round(viewportMenuTop - sidebarRect.top + menu.offsetHeight));
  return { viewportMenuTop, maxHeight, gapStart, gapEnd };
}

function openSidebarMenuBorderGap(sidebar, gapStart, gapEnd, { onComplete } = {}) {
  if (!sidebar) {
    onComplete?.();
    return;
  }

  if (document.body.classList.contains("reduce-motion") || !getSidebarBorderMotionMs()) {
    setSidebarMenuBorderGap(sidebar, gapStart, gapEnd);
    onComplete?.();
    return;
  }

  const gapCenter = Math.round((gapStart + gapEnd) / 2);
  sidebar.classList.add("sidebar-border-gap-no-transition");
  setSidebarMenuBorderGap(sidebar, gapCenter, gapCenter);
  requestAnimationFrame(() => {
    sidebar.classList.remove("sidebar-border-gap-no-transition");
    requestAnimationFrame(() => {
      setSidebarMenuBorderGap(sidebar, gapStart, gapEnd);
      const borderRestoreMs = getSidebarBorderMotionMs();
      window.setTimeout(() => onComplete?.(), borderRestoreMs);
    });
  });
}

function finishAppSidebarMenuCloseInstant(kind) {
  const isMore = kind === "more";
  const root = document.getElementById(isMore ? "app-sidebar-more" : "app-sidebar-misc");
  const menu = document.getElementById(isMore ? "sidebar-more-menu" : "sidebar-misc-menu");
  const toggle = document.getElementById(isMore ? "sidebar-more-button" : "sidebar-misc-button");
  const sidebar = document.querySelector(".app-sidebar");
  if (!root || !menu || !toggle) return;

  toggle.setAttribute("aria-expanded", "false");
  menu.hidden = true;
  menu.setAttribute("aria-hidden", "true");
  root.classList.remove("is-open", "is-closing", "is-menu-revealed");
  clearSidebarMenuBorderGap(sidebar);
  if (isMore) syncMoreMenuBorder();
  else syncMiscMenuBorder();
  flushSidebarMenuCloseCallback(kind);
}

function beginAppSidebarMenuClose(kind) {
  if (document.body.classList.contains("reduce-motion")) {
    finishAppSidebarMenuCloseInstant(kind);
    return;
  }

  const isMore = kind === "more";
  const root = document.getElementById(isMore ? "app-sidebar-more" : "app-sidebar-misc");
  const menu = document.getElementById(isMore ? "sidebar-more-menu" : "sidebar-misc-menu");
  const toggle = document.getElementById(isMore ? "sidebar-more-button" : "sidebar-misc-button");
  const sidebar = document.querySelector(".app-sidebar");
  if (!root || !menu || !toggle) return;

  toggle.setAttribute("aria-expanded", "false");
  root.classList.remove("is-menu-revealed");
  root.classList.add("is-closing");

  const gapStart = parseFloat(sidebar?.style.getPropertyValue("--sidebar-menu-border-gap-start")) || 0;
  const gapEnd = parseFloat(sidebar?.style.getPropertyValue("--sidebar-menu-border-gap-end")) || gapStart;

  let finished = false;
  let borderCloseStarted = false;
  let closeFallback = 0;

  const startBorderClose = () => {
    if (borderCloseStarted) return;
    borderCloseStarted = true;
    clearTimeout(closeFallback);
    menu.removeEventListener("transitionend", onMenuEnd);
    closeSidebarMenuBorderGap(sidebar, gapStart, gapEnd, finish);
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(closeFallback);
    menu.removeEventListener("transitionend", onMenuEnd);
    menu.hidden = true;
    menu.setAttribute("aria-hidden", "true");
    root.classList.remove("is-open", "is-closing", "is-menu-revealed");
    if (isMore) syncMoreMenuBorder();
    else syncMiscMenuBorder();
    flushSidebarMenuCloseCallback(kind);
  };

  const borderRestoreMs = getSidebarBorderMotionMs();
  if (!borderRestoreMs) {
    startBorderClose();
    return;
  }

  const onMenuEnd = (event) => {
    if (event.target !== menu || event.propertyName !== "clip-path") return;
    startBorderClose();
  };

  menu.addEventListener("transitionend", onMenuEnd);
  closeFallback = window.setTimeout(() => {
    if (!borderCloseStarted) startBorderClose();
  }, borderRestoreMs + 100);
}

function beginAppMoreMenuOpen() {
  const more = document.getElementById("app-sidebar-more");
  const toggle = document.getElementById("sidebar-more-button");
  const menu = document.getElementById("sidebar-more-menu");
  const sidebar = document.querySelector(".app-sidebar");
  if (!more || !toggle || !menu) return;

  more.classList.remove("is-closing", "is-menu-revealed");
  menu.hidden = false;
  menu.setAttribute("aria-hidden", "false");
  toggle.setAttribute("aria-expanded", "true");

  const metrics = computeMoreMenuBorderMetrics();
  if (!sidebar || !metrics) return;

  sidebar.style.setProperty("--more-menu-top", `${metrics.menuTop}px`);

  if (document.body.classList.contains("reduce-motion")) {
    setSidebarMenuBorderGap(sidebar, metrics.gapStart, metrics.gapEnd);
    more.classList.add("is-open", "is-menu-revealed");
    return;
  }

  more.classList.add("is-open");
  openSidebarMenuBorderGap(sidebar, metrics.gapStart, metrics.gapEnd, {
    onComplete: () => {
      more.classList.add("is-menu-revealed");
      syncMoreMenuBorder();
    },
  });
}

function beginAppMiscMenuOpen() {
  const misc = document.getElementById("app-sidebar-misc");
  const toggle = document.getElementById("sidebar-misc-button");
  const menu = document.getElementById("sidebar-misc-menu");
  const sidebar = document.querySelector(".app-sidebar");
  if (!misc || !toggle || !menu) return;

  misc.classList.remove("is-closing", "is-menu-revealed");
  menu.hidden = false;
  menu.setAttribute("aria-hidden", "false");
  toggle.setAttribute("aria-expanded", "true");

  const metrics = computeMiscMenuBorderMetrics();
  if (!sidebar || !metrics) return;

  sidebar.style.setProperty("--misc-menu-top", `${metrics.viewportMenuTop}px`);
  sidebar.style.setProperty("--misc-menu-max-height", `${metrics.maxHeight}px`);

  if (document.body.classList.contains("reduce-motion")) {
    setSidebarMenuBorderGap(sidebar, metrics.gapStart, metrics.gapEnd);
    misc.classList.add("is-open", "is-menu-revealed");
    return;
  }

  misc.classList.add("is-open");
  openSidebarMenuBorderGap(sidebar, metrics.gapStart, metrics.gapEnd, {
    onComplete: () => {
      misc.classList.add("is-menu-revealed");
      syncMiscMenuBorder();
    },
  });
}

const DROPDOWN_LIST_MAX_HEIGHT = 250;

function getViewportInsets(padding = 8) {
  return {
    padding,
    viewportHeight: window.visualViewport?.height ?? window.innerHeight,
    viewportWidth: window.visualViewport?.width ?? window.innerWidth,
    viewportOffsetTop: window.visualViewport?.offsetTop ?? 0,
    viewportOffsetLeft: window.visualViewport?.offsetLeft ?? 0,
  };
}

function positionFloatingPanel(panel, trigger, { gap = 6, panelWidth = null, matchTriggerWidth = true, maxPanelHeight = DROPDOWN_LIST_MAX_HEIGHT } = {}) {
  if (!panel || !trigger || !trigger.isConnected) return;

  const { padding, viewportHeight, viewportWidth, viewportOffsetTop, viewportOffsetLeft } = getViewportInsets();
  const rect = trigger.getBoundingClientRect();
  const resolvedWidth = panelWidth ?? (matchTriggerWidth ? Math.max(rect.width, 0) : panel.offsetWidth || rect.width);

  panel.style.width = `${resolvedWidth}px`;
  panel.style.maxHeight = "";

  let left = rect.left;
  if (left + resolvedWidth > viewportOffsetLeft + viewportWidth - padding) {
    left = viewportOffsetLeft + viewportWidth - resolvedWidth - padding;
  }
  left = Math.max(viewportOffsetLeft + padding, left);
  panel.style.left = `${left}px`;

  const spaceBelow = viewportOffsetTop + viewportHeight - rect.bottom - gap - padding;
  const spaceAbove = rect.top - viewportOffsetTop - gap - padding;
  const naturalHeight = panel.scrollHeight;
  const heightCap = maxPanelHeight == null ? naturalHeight : Math.min(naturalHeight, maxPanelHeight);
  const openUp = heightCap > spaceBelow && spaceAbove > spaceBelow;
  let available = Math.max(openUp ? spaceAbove : spaceBelow, 96);
  if (maxPanelHeight != null) {
    available = Math.min(available, maxPanelHeight);
  }

  panel.style.maxHeight = `${available}px`;
  panel.classList.toggle("pref-dropdown-list-opens-up", openUp);

  const panelHeight = Math.min(panel.scrollHeight, available);
  let top = openUp ? rect.top - panelHeight - gap : rect.bottom + gap;
  const minTop = viewportOffsetTop + padding;
  const maxTop = viewportOffsetTop + viewportHeight - padding - panelHeight;
  top = Math.max(minTop, Math.min(top, maxTop));

  panel.style.top = `${top}px`;
}

function syncMoreMenuBorder() {
  const sidebar = document.querySelector(".app-sidebar");
  const menu = document.getElementById("sidebar-more-menu");
  const toggle = document.getElementById("sidebar-more-button");
  const more = document.getElementById("app-sidebar-more");
  const misc = document.getElementById("app-sidebar-misc");
  if (!sidebar) return;

  if (sidebar.dataset.borderRestoring === "true") return;

  if (misc?.classList.contains("is-open")) {
    syncMiscMenuBorder();
    return;
  }

  const menuActive = more?.classList.contains("is-open") || more?.classList.contains("is-closing");
  if (!menuActive || !menu) {
    if (misc?.classList.contains("is-closing")) {
      syncMiscMenuBorder();
      return;
    }
    sidebar.style.removeProperty("--more-menu-top");
    clearSidebarMenuBorderGap(sidebar);
    return;
  }

  if (more?.classList.contains("is-closing") && menu.hidden) return;

  const sidebarRect = sidebar.getBoundingClientRect();
  const toggleRect = toggle?.getBoundingClientRect();
  if (!toggleRect) return;

  const { viewportHeight, viewportOffsetTop } = getViewportInsets(0);
  const viewportBottom = viewportOffsetTop + viewportHeight;
  let menuTop = Math.round(toggleRect.top);

  if (!menu.hidden) {
    const contentHeight = menu.scrollHeight;
    const availableBelowToggle = viewportBottom - menuTop;
    if (contentHeight > availableBelowToggle) {
      menuTop = Math.max(viewportOffsetTop, viewportBottom - contentHeight);
    }
  }

  sidebar.style.setProperty("--more-menu-top", `${menuTop}px`);
  const gapStart = Math.max(0, Math.round(menuTop - sidebarRect.top));
  const gapEnd = getMoreMenuBorderGapEnd(sidebarRect);
  sidebar.style.setProperty("--sidebar-menu-border-gap-start", `${gapStart}px`);
  sidebar.style.setProperty("--sidebar-menu-border-gap-end", `${gapEnd}px`);
}

function syncMiscMenuBorder({ freezeTop = false } = {}) {
  const sidebar = document.querySelector(".app-sidebar");
  const menu = document.getElementById("sidebar-misc-menu");
  const toggle = document.getElementById("sidebar-misc-button");
  const misc = document.getElementById("app-sidebar-misc");
  const more = document.getElementById("app-sidebar-more");
  if (!sidebar) return;

  if (sidebar.dataset.borderRestoring === "true") return;

  if (more?.classList.contains("is-open")) {
    syncMoreMenuBorder();
    return;
  }

  const menuActive = misc?.classList.contains("is-open") || misc?.classList.contains("is-closing");
  if (!menuActive || !menu) {
    if (more?.classList.contains("is-closing")) {
      syncMoreMenuBorder();
      return;
    }
    sidebar.style.removeProperty("--misc-menu-top");
    sidebar.style.removeProperty("--misc-menu-max-height");
    clearSidebarMenuBorderGap(sidebar);
    return;
  }

  if (misc?.classList.contains("is-closing") && menu.hidden) return;

  const sidebarRect = sidebar.getBoundingClientRect();
  const toggleRect = toggle?.getBoundingClientRect();
  if (!toggleRect) return;

  const { padding, viewportHeight, viewportOffsetTop } = getViewportInsets();
  let viewportMenuTop = Math.round(toggleRect.top);
  const currentTop = sidebar.style.getPropertyValue("--misc-menu-top");

  if (!freezeTop || !currentTop) {
    sidebar.style.removeProperty("--misc-menu-max-height");
    if (!menu.hidden) {
      const menuHeight = menu.scrollHeight;
      const maxTop = viewportOffsetTop + viewportHeight - padding - menuHeight;
      viewportMenuTop = Math.min(viewportMenuTop, Math.max(viewportOffsetTop + padding, maxTop));
      sidebar.style.setProperty("--misc-menu-max-height", `${Math.max(viewportOffsetTop + viewportHeight - viewportMenuTop - padding, 120)}px`);
    }
    sidebar.style.setProperty("--misc-menu-top", `${viewportMenuTop}px`);
  }

  const topPx = parseFloat(sidebar.style.getPropertyValue("--misc-menu-top")) || viewportMenuTop;
  const gapStart = Math.max(0, Math.round(topPx - sidebarRect.top));
  const gapEnd = Math.max(gapStart, Math.round(topPx - sidebarRect.top + menu.offsetHeight));
  sidebar.style.setProperty("--sidebar-menu-border-gap-start", `${gapStart}px`);
  sidebar.style.setProperty("--sidebar-menu-border-gap-end", `${gapEnd}px`);
}

function setAppMoreMenuOpen(open, { onComplete } = {}) {
  const more = document.getElementById("app-sidebar-more");
  const toggle = document.getElementById("sidebar-more-button");
  const menu = document.getElementById("sidebar-more-menu");
  if (!more || !toggle || !menu) return;

  clearTimeout(setAppMoreMenuOpen.closeTimer);
  clearTimeout(setAppMoreMenuOpen.closeFallback);

  if (open) {
    if (more.classList.contains("is-open")) {
      onComplete?.();
      return;
    }

    if (isAppSidebarMenuActive("misc")) {
      setAppMiscMenuOpen(false, {
        onComplete: () => setAppMoreMenuOpen(true, { onComplete }),
      });
      return;
    }

    beginAppMoreMenuOpen();
    onComplete?.();
    return;
  }

  if (more.classList.contains("is-closing")) {
    queueSidebarMenuCloseCallback("more", onComplete);
    return;
  }

  if (!more.classList.contains("is-open")) {
    onComplete?.();
    return;
  }

  if (onComplete) queueSidebarMenuCloseCallback("more", onComplete);
  beginAppSidebarMenuClose("more");
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
    if (more.classList.contains("is-closing")) return;
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

function setAppMiscMenuOpen(open, { onComplete } = {}) {
  const misc = document.getElementById("app-sidebar-misc");
  const toggle = document.getElementById("sidebar-misc-button");
  const menu = document.getElementById("sidebar-misc-menu");
  if (!misc || !toggle || !menu) return;

  clearTimeout(setAppMiscMenuOpen.closeTimer);
  clearTimeout(setAppMiscMenuOpen.closeFallback);

  if (open) {
    if (misc.classList.contains("is-open")) {
      onComplete?.();
      return;
    }

    if (isAppSidebarMenuActive("more")) {
      setAppMoreMenuOpen(false, {
        onComplete: () => setAppMiscMenuOpen(true, { onComplete }),
      });
      return;
    }

    beginAppMiscMenuOpen();
    onComplete?.();
    return;
  }

  if (misc.classList.contains("is-closing")) {
    queueSidebarMenuCloseCallback("misc", onComplete);
    return;
  }

  if (!misc.classList.contains("is-open")) {
    onComplete?.();
    return;
  }

  if (onComplete) queueSidebarMenuCloseCallback("misc", onComplete);
  beginAppSidebarMenuClose("misc");
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
    if (misc.classList.contains("is-closing")) return;
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
  const section = [...document.querySelectorAll(".section")].find((el) => isSectionActive(el));
  if (!section || document.body.classList.contains("reduce-motion")) {
    section?.classList.remove("is-tab-entering");
    markAppLoadingReady("entrance");
    return;
  }

  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    section.classList.remove("is-tab-entering");
    markAppLoadingReady("entrance");
  };

  section.addEventListener(
    "animationend",
    (event) => {
      if (event.target === section && event.animationName === "tab-enter") settle();
    },
    { once: true },
  );

  setTimeout(settle, 220);
}

function commitAccentColor(normalized, { instant = false } = {}) {
  const root = document.documentElement;
  const targetHex = accentColorString(normalized);
  syncAccentContrastColor(targetHex);

  clearAccentTransitionCleanup();

  if (instant || document.body.classList.contains("reduce-motion")) {
    root.classList.add("accent-instant");
    root.style.setProperty("--accent-color", targetHex);
    requestAnimationFrame(() => root.classList.remove("accent-instant"));
    return;
  }

  accentRuntime.transitionCleanup = (event) => {
    if (event.target !== root || event.propertyName !== "--accent-color") return;
    finalizeAccentTransition(targetHex);
  };
  root.addEventListener("transitionend", accentRuntime.transitionCleanup);

  accentRuntime.transitionFallback = window.setTimeout(() => {
    finalizeAccentTransition(targetHex);
  }, 400);

  root.classList.remove("accent-instant");
  root.classList.add("accent-changing");
  root.style.setProperty("--accent-color", targetHex);
}

const APP_CACHE_VERSION = "morning-roast-v371";

if (typeof document !== "undefined") {
  document.documentElement.dataset.appCacheVersion = APP_CACHE_VERSION;
}
if (typeof window !== "undefined") {
  window.APP_CACHE_VERSION = APP_CACHE_VERSION;
}

function isConfirmResetEnabled() {
  return localStorage.getItem("prefConfirmReset") !== "false";
}

const audioState = {
  masterVolume: 1,
};

function getMasterVolume() {
  return audioState.masterVolume;
}

function loadMasterVolume() {
  const saved = parseInt(localStorage.getItem("prefMasterVolume") ?? "100", 10);
  audioState.masterVolume = Math.max(0, Math.min(100, Number.isFinite(saved) ? saved : 100)) / 100;
}

function setMasterVolume(percent) {
  const pct = Math.max(0, Math.min(100, percent));
  audioState.masterVolume = pct / 100;
  localStorage.setItem("prefMasterVolume", String(pct));
}

function getAppAudioGain(baseGain = 0.05) {
  if (audioState.masterVolume <= 0) return 0;
  return baseGain * audioState.masterVolume;
}

const resetDialogState = {
  pendingAction: null,
  restore: null,
};

const CONFIRM_DIALOG_DEFAULTS = {
  title: "Confirm reset",
  okLabel: "Reset",
};

function readConfirmDialogLabels() {
  return {
    title: document.getElementById("confirm-reset-title")?.textContent?.trim() || CONFIRM_DIALOG_DEFAULTS.title,
    okLabel: document.getElementById("confirm-reset-ok")?.textContent?.trim() || CONFIRM_DIALOG_DEFAULTS.okLabel,
  };
}

function setConfirmDialogContent({ title, message, okLabel }) {
  const titleEl = document.getElementById("confirm-reset-title");
  const messageEl = document.getElementById("confirm-reset-message");
  const okBtn = document.getElementById("confirm-reset-ok");
  if (titleEl && title) titleEl.textContent = title;
  if (messageEl && message != null) messageEl.textContent = message;
  if (okBtn && okLabel) okBtn.textContent = okLabel;
}

function restoreConfirmDialogLabels() {
  if (!resetDialogState.restore) return;
  setConfirmDialogContent(resetDialogState.restore);
  resetDialogState.restore = null;
}

function isElementOverlayOpen(el) {
  if (!el?.classList.contains("active")) return false;
  if (el.hidden) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  return true;
}

function isScrollLockedByOverlay() {
  if (isUsernameOnboardingOpen()) return true;
  return [...document.querySelectorAll(".trainer-settings-overlay, .lineup-flow-overlay, .lineup-video-overlay, .lineup-badge-info-overlay, .confirm-reset-overlay")].some(
    isElementOverlayOpen,
  );
}

function syncBodyScrollLock() {
  const locked = isScrollLockedByOverlay();
  document.documentElement.style.overflow = locked ? "hidden" : "";
  document.body.style.overflow = locked ? "hidden" : "";
  document.body.classList.toggle("overlay-scroll-locked", locked);
}

function closeConfirmReset() {
  const overlay = document.getElementById("confirm-reset-overlay");
  if (overlay) overlay.classList.remove("active");
  resetDialogState.pendingAction = null;
  restoreConfirmDialogLabels();
  syncBodyScrollLock();
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function confirmBeforeReset(message, action, options = {}) {
  const { title = CONFIRM_DIALOG_DEFAULTS.title, okLabel = CONFIRM_DIALOG_DEFAULTS.okLabel, force = false } = options;
  if (!force && !isConfirmResetEnabled()) {
    action();
    return;
  }
  resetDialogState.pendingAction = action;
  resetDialogState.restore = readConfirmDialogLabels();
  setConfirmDialogContent({ title, message, okLabel });
  const overlay = document.getElementById("confirm-reset-overlay");
  if (overlay) overlay.classList.add("active");
  syncBodyScrollLock();
}

function initConfirmReset() {
  const overlay = document.getElementById("confirm-reset-overlay");

  document.getElementById("confirm-reset-cancel")?.addEventListener("click", closeConfirmReset);
  document.getElementById("confirm-reset-ok")?.addEventListener("click", () => {
    const action = resetDialogState.pendingAction;
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

const SETTINGS_MODAL_TAB_CONFIG = {
  "trainer-settings-overlay": { selectorId: "trainer-settings-tab-selector", defaultTab: "session" },
  "theme-settings-overlay": { selectorId: "theme-settings-tab-selector", defaultTab: "appearance" },
  "general-settings-overlay": { selectorId: "general-settings-tab-selector", defaultTab: "performance" },
};

function getSettingsModalTabSelector(overlay) {
  const config = SETTINGS_MODAL_TAB_CONFIG[overlay?.id];
  return config ? overlay.querySelector(`#${config.selectorId}`) : null;
}

function openTrainerSettingsDropdownAncestors(node, overlay) {
  const sectionsRoot = overlay?.querySelector(".trainer-settings-sections");
  const section = node.closest(".trainer-settings-section[data-settings-tab]");
  if (section && sectionsRoot?.classList.contains("is-search-mode")) {
    section.hidden = false;
    section.classList.add("is-active");
    return;
  }

  if (SETTINGS_MODAL_TAB_CONFIG[overlay?.id]) return;

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

  if (!overlayId) {
    SETTINGS_MODAL_OVERLAY_IDS.forEach((id) => {
      syncSettingsModalSearchMode(document.getElementById(id), false);
      resetSettingsModalTabs(id);
    });
  } else if (SETTINGS_MODAL_TAB_CONFIG[overlayId]) {
    syncSettingsModalSearchMode(document.getElementById(overlayId), false);
    resetSettingsModalTabs(overlayId);
  }

  initTrainerModeDropdown.close?.();
  initTrainerTimerDropdown.close?.();
  initTrainerAspectDropdown.close?.();
  initBgBackdropControl.close?.();
  initFontFamilyDropdown.close?.();
}

function setSettingsModalTab(tabId, { overlay = null, overlayId = overlay?.id, updateGliders = true } = {}) {
  const resolvedOverlay = overlay || document.getElementById(overlayId);
  const config = SETTINGS_MODAL_TAB_CONFIG[resolvedOverlay?.id];
  if (!resolvedOverlay || !config) return;

  const sectionsRoot = resolvedOverlay.querySelector(".trainer-settings-sections");
  const selector = getSettingsModalTabSelector(resolvedOverlay);
  if (!sectionsRoot || !selector || sectionsRoot.classList.contains("is-search-mode")) return;

  const resolvedTab = tabId || config.defaultTab;

  sectionsRoot.querySelectorAll(".trainer-settings-section[data-settings-tab]").forEach((section) => {
    const active = section.dataset.settingsTab === resolvedTab;
    section.classList.toggle("is-active", active);
    section.hidden = !active;
  });

  selector.querySelectorAll(".toggle-btn[data-settings-tab]").forEach((btn) => {
    const active = btn.dataset.settingsTab === resolvedTab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });

  if (updateGliders) {
    syncToggleGlider(selector);
    if (resolvedOverlay.id === "trainer-settings-overlay" && typeof aimTrainer !== "undefined") {
      aimTrainer.updateAllGliders?.();
      drawTargetSpreadPreview?.(aimTrainer.targetSpreadLevel, { instant: true });
    }
  }
}

function resetSettingsModalTabs(overlayId) {
  const config = SETTINGS_MODAL_TAB_CONFIG[overlayId];
  if (!config) return;
  setSettingsModalTab(config.defaultTab, { overlayId });
}

function syncSettingsModalSearchMode(overlay, searching) {
  if (!overlay || !SETTINGS_MODAL_TAB_CONFIG[overlay.id]) return;

  const sectionsRoot = overlay.querySelector(".trainer-settings-sections");
  const tabBar = overlay.querySelector(".trainer-settings-tab-bar");
  if (!sectionsRoot) return;

  sectionsRoot.classList.toggle("is-search-mode", searching);
  if (tabBar) tabBar.hidden = searching;

  if (searching) {
    sectionsRoot.querySelectorAll(".trainer-settings-section[data-settings-tab]").forEach((section) => {
      const visible = !section.classList.contains("is-filtered-out");
      section.hidden = !visible;
      section.classList.toggle("is-active", visible);
    });
    return;
  }

  const config = SETTINGS_MODAL_TAB_CONFIG[overlay.id];
  const activeTab = getSettingsModalTabSelector(overlay)?.querySelector(".toggle-btn.active")?.dataset.settingsTab || config.defaultTab;
  setSettingsModalTab(activeTab, { overlay });
}

function initSettingsModalTabs() {
  if (initSettingsModalTabs._init) return;
  initSettingsModalTabs._init = true;

  SETTINGS_MODAL_OVERLAY_IDS.forEach((overlayId) => {
    const overlay = document.getElementById(overlayId);
    const selector = getSettingsModalTabSelector(overlay);
    const config = SETTINGS_MODAL_TAB_CONFIG[overlayId];
    if (!overlay || !selector || !config) return;

    selector.querySelectorAll(".toggle-btn[data-settings-tab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setSettingsModalTab(btn.dataset.settingsTab, { overlay });
      });
    });

    setSettingsModalTab(config.defaultTab, { overlay, updateGliders: false });
    syncToggleGlider(selector);
    observeSettingsModalTabGlider(selector);
  });
}

function observeSettingsModalTabGlider(selector) {
  if (!selector || typeof ResizeObserver === "undefined" || selector.dataset.gliderObserved) return;
  selector.dataset.gliderObserved = "1";

  const ro = new ResizeObserver(() => syncToggleGlider(selector));
  ro.observe(selector);
  selector.querySelectorAll(".toggle-btn[data-settings-tab]").forEach((btn) => ro.observe(btn));
  selector._settingsTabGliderObserver = ro;
}

const PROFILE_DISPLAY_NAME_KEY = "profileDisplayName";
const PROFILE_BIO_KEY = "profileBio";
const PROFILE_AVATAR_KEY = "profileAvatarImage";
const PROFILE_DISPLAY_NAME_COOLDOWN_KEY = "profileDisplayNameChangedAt";
const PROFILE_BIO_MAX = 160;
const PROFILE_DISPLAY_NAME_MAX = 32;
const PROFILE_DISPLAY_NAME_COOLDOWN_MS = 2 * 60 * 60 * 1000;
const PROFILE_AVATAR_MAX_BYTES = 120000;
const PROFILE_AVATAR_MAX_DIM = 256;

let profileDisplayNameCooldownTimer = null;
const profileDisplayNameConfirmState = {
  pendingName: "",
};

let profileDisplayNameTaken = false;
let profileDisplayNameAvailabilityToken = 0;
let profileDisplayNameAvailabilityTimer = null;

function getDisplayNameTakenMessage() {
  return window.MorningRoastChat?.getDisplayNameTakenMessage?.() || "That display name is already in use. Choose another one.";
}

function getDisplayNameBlockedMessage() {
  return window.MorningRoastChat?.getDisplayNameBlockedMessage?.() || "That display name is not allowed.";
}

function getDisplayNameValidationMessage() {
  if (window.MorningRoastChat?.getLastNameCheckReason?.() === "blocked") {
    return getDisplayNameBlockedMessage();
  }
  return getDisplayNameTakenMessage();
}

async function checkDisplayNameAvailability(name) {
  if (typeof window.MorningRoastChat?.checkDisplayNameAvailability === "function") {
    return window.MorningRoastChat.checkDisplayNameAvailability(name);
  }
  return true;
}

function setProfileDisplayNameTaken(taken) {
  profileDisplayNameTaken = Boolean(taken);
  syncProfileDisplayNameUi();
}

function scheduleDisplayNameAvailabilityCheck(name) {
  if (profileDisplayNameAvailabilityTimer !== null) {
    window.clearTimeout(profileDisplayNameAvailabilityTimer);
    profileDisplayNameAvailabilityTimer = null;
  }

  const draft = String(name || "").trim();
  const saved = getSavedDisplayName();
  if (!draft || draft.toLowerCase() === saved.toLowerCase()) {
    setProfileDisplayNameTaken(false);
    return;
  }

  profileDisplayNameAvailabilityTimer = window.setTimeout(async () => {
    profileDisplayNameAvailabilityTimer = null;
    const token = ++profileDisplayNameAvailabilityToken;
    const available = await checkDisplayNameAvailability(draft);
    if (token !== profileDisplayNameAvailabilityToken) return;
    setProfileDisplayNameTaken(!available);
  }, 350);
}

function getSavedDisplayName() {
  return String(localStorage.getItem(PROFILE_DISPLAY_NAME_KEY) || "").trim();
}

function getDisplayNameCooldownEndsAt() {
  const changedAt = Number(localStorage.getItem(PROFILE_DISPLAY_NAME_COOLDOWN_KEY));
  if (!Number.isFinite(changedAt) || changedAt <= 0) return 0;
  return changedAt + PROFILE_DISPLAY_NAME_COOLDOWN_MS;
}

function getDisplayNameCooldownRemainingMs() {
  const endsAt = getDisplayNameCooldownEndsAt();
  if (!endsAt) return 0;
  return Math.max(0, endsAt - Date.now());
}

function isDisplayNameOnCooldown() {
  return getDisplayNameCooldownRemainingMs() > 0;
}

function formatDisplayNameCooldownRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function getDisplayNameCooldownMessage(ms = getDisplayNameCooldownRemainingMs()) {
  return `You can change your display name again in ${formatDisplayNameCooldownRemaining(ms)}.`;
}

function startDisplayNameCooldown() {
  localStorage.setItem(PROFILE_DISPLAY_NAME_COOLDOWN_KEY, String(Date.now()));
}

function scheduleProfileDisplayNameCooldownRefresh() {
  if (profileDisplayNameCooldownTimer !== null) {
    window.clearTimeout(profileDisplayNameCooldownTimer);
    profileDisplayNameCooldownTimer = null;
  }

  const remaining = getDisplayNameCooldownRemainingMs();
  if (remaining <= 0) {
    syncProfileDisplayNameUi();
    return;
  }

  profileDisplayNameCooldownTimer = window.setTimeout(() => {
    profileDisplayNameCooldownTimer = null;
    syncProfileDisplayNameUi();
    if (getDisplayNameCooldownRemainingMs() > 0) {
      scheduleProfileDisplayNameCooldownRefresh();
    }
  }, 1000);
}

function syncProfileDisplayNameUi() {
  const nameInput = document.getElementById("profile-display-name");
  const hintEl = document.getElementById("profile-display-name-hint");
  const actionsEl = document.getElementById("profile-display-name-actions");
  const saveBtn = document.getElementById("profile-display-name-save");
  const cancelBtn = document.getElementById("profile-display-name-cancel");
  if (!nameInput) return;

  const saved = getSavedDisplayName();
  const draft = String(nameInput.value || "").trim();
  const remaining = getDisplayNameCooldownRemainingMs();
  const onCooldown = remaining > 0;
  const hasDraft = draft !== saved;
  const missingName = !draft;
  const canEdit = !onCooldown;

  nameInput.readOnly = onCooldown;
  nameInput.classList.toggle("is-locked", onCooldown);
  nameInput.setAttribute("aria-invalid", missingName && hasDraft ? "true" : "false");

  if (hintEl) {
    hintEl.classList.remove("is-cooldown", "is-error");

    if (onCooldown) {
      hintEl.hidden = false;
      hintEl.classList.add("is-cooldown");
      hintEl.textContent = getDisplayNameCooldownMessage(remaining);
    } else if (missingName && saved) {
      hintEl.hidden = false;
      hintEl.classList.add("is-error");
      hintEl.textContent = "Display name is required. You can't remove your name.";
    } else if (missingName && !saved) {
      hintEl.hidden = false;
      hintEl.classList.add("is-error");
      hintEl.textContent = "Choose a display name — it's required for chat and your profile.";
    } else if (profileDisplayNameTaken && hasDraft && !missingName) {
      hintEl.hidden = false;
      hintEl.classList.add("is-error");
      hintEl.textContent = getDisplayNameValidationMessage();
    } else {
      hintEl.hidden = true;
      hintEl.textContent = "";
    }
  }

  if (actionsEl) actionsEl.hidden = onCooldown;
  if (cancelBtn) cancelBtn.disabled = !canEdit || !hasDraft;
  if (saveBtn) saveBtn.disabled = !canEdit || !hasDraft || missingName || profileDisplayNameTaken;
}

function applyProfileDisplayName(name, { startCooldown = false } = {}) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;

  const value = persistProfileFields({ name: trimmed });
  if (!value) return false;

  if (startCooldown) startDisplayNameCooldown();

  const nameInput = document.getElementById("profile-display-name");
  if (nameInput) nameInput.value = value;

  window.MorningRoastChat?.initCommunityChat?.()?.refreshIdentity?.();
  setProfileDisplayNameTaken(false);
  syncProfileDisplayNameUi();
  scheduleProfileDisplayNameCooldownRefresh();
  return true;
}

function revertProfileDisplayNameDraft() {
  const nameInput = document.getElementById("profile-display-name");
  if (!nameInput) return;
  nameInput.value = getSavedDisplayName();
  profileDisplayNameAvailabilityToken += 1;
  setProfileDisplayNameTaken(false);
}

function openProfileDisplayNameConfirm(name) {
  const overlay = document.getElementById("profile-display-name-overlay");
  if (!overlay) {
    applyProfileDisplayName(name, { startCooldown: true });
    return;
  }

  profileDisplayNameConfirmState.pendingName = name;
  overlay.classList.add("active");
  overlay.setAttribute("aria-hidden", "false");
  syncBodyScrollLock();
}

function closeProfileDisplayNameConfirm() {
  const overlay = document.getElementById("profile-display-name-overlay");
  if (overlay) {
    overlay.classList.remove("active");
    overlay.setAttribute("aria-hidden", "true");
  }
  profileDisplayNameConfirmState.pendingName = "";
  syncBodyScrollLock();
}

async function handleProfileDisplayNameSave() {
  const nameInput = document.getElementById("profile-display-name");
  if (!nameInput) return;

  const draft = String(nameInput.value || "").trim();
  const saved = getSavedDisplayName();

  if (!draft) {
    Toast.notify({ message: "Display name is required. You can't remove your name.", type: "error" });
    syncProfileDisplayNameUi();
    return;
  }

  if (draft === saved) {
    syncProfileDisplayNameUi();
    return;
  }

  if (isDisplayNameOnCooldown()) {
    Toast.notify({
      message: getDisplayNameCooldownMessage(),
      type: "error",
    });
    syncProfileDisplayNameUi();
    return;
  }

  const available = await checkDisplayNameAvailability(draft);
  if (!available) {
    setProfileDisplayNameTaken(true);
    Toast.notify({ message: getDisplayNameValidationMessage(), type: "error" });
    return;
  }

  if (saved) {
    openProfileDisplayNameConfirm(draft);
    return;
  }

  applyProfileDisplayName(draft, { startCooldown: false });
}

function initProfileDisplayNameConfirm() {
  const overlay = document.getElementById("profile-display-name-overlay");
  if (!overlay || initProfileDisplayNameConfirm._init) return;
  initProfileDisplayNameConfirm._init = true;

  document.getElementById("profile-display-name-overlay-cancel")?.addEventListener("click", closeProfileDisplayNameConfirm);
  document.getElementById("profile-display-name-overlay-confirm")?.addEventListener("click", async () => {
    const name = profileDisplayNameConfirmState.pendingName;
    closeProfileDisplayNameConfirm();
    if (!name) return;

    const available = await checkDisplayNameAvailability(name);
    if (!available) {
      setProfileDisplayNameTaken(true);
      Toast.notify({ message: getDisplayNameValidationMessage(), type: "error" });
      return;
    }

    applyProfileDisplayName(name, { startCooldown: true });
  });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) closeProfileDisplayNameConfirm();
  });

  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !overlay.classList.contains("active")) return;
    event.preventDefault();
    closeProfileDisplayNameConfirm();
  });
}

function parseOwnerDisplayNames(value) {
  return String(value || "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

function getOwnerDisplayNames() {
  const fromChat = window.MorningRoastChat?.getOwnerDisplayNames?.();
  if (Array.isArray(fromChat) && fromChat.length) return fromChat;
  return parseOwnerDisplayNames(document.querySelector('meta[name="morning-roast-owner-names"]')?.content);
}

function isOwnerDisplayName(name) {
  const normalized = String(name || "")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return normalized === "fuziveer";
}

function hasStoredDisplayName() {
  return Boolean(String(localStorage.getItem(PROFILE_DISPLAY_NAME_KEY) || "").trim());
}

function isUsernameOnboardingOpen() {
  return document.getElementById("username-onboarding-overlay")?.classList.contains("active");
}

function getStoredProfileAvatar() {
  return localStorage.getItem(PROFILE_AVATAR_KEY) || "";
}

function persistProfileAvatar(dataUrl) {
  if (!dataUrl) {
    localStorage.removeItem(PROFILE_AVATAR_KEY);
    return "";
  }
  localStorage.setItem(PROFILE_AVATAR_KEY, dataUrl);
  return dataUrl;
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read image"));
    reader.readAsDataURL(file);
  });
}

function compressProfileAvatarDataUrl(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, PROFILE_AVATAR_MAX_DIM / Math.max(image.width, image.height));
      const width = Math.max(1, Math.round(image.width * scale));
      const height = Math.max(1, Math.round(image.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Could not process image"));
        return;
      }
      ctx.drawImage(image, 0, 0, width, height);

      let quality = 0.88;
      let dataUrl = canvas.toDataURL("image/jpeg", quality);
      while (dataUrl.length > PROFILE_AVATAR_MAX_BYTES && quality > 0.45) {
        quality -= 0.08;
        dataUrl = canvas.toDataURL("image/jpeg", quality);
      }
      resolve(dataUrl);
    };
    image.onerror = () => reject(new Error("Invalid image file"));
    image.src = source;
  });
}

async function prepareProfileAvatarFile(file) {
  if (!file || !String(file.type || "").startsWith("image/")) {
    throw new Error("Choose an image file");
  }
  const raw = await loadImageFromFile(file);
  return compressProfileAvatarDataUrl(raw);
}

function syncProfileAvatar(name) {
  const avatar = document.getElementById("profile-avatar");
  const img = document.getElementById("profile-avatar-image");
  const fallback = document.getElementById("profile-avatar-fallback");
  const removeBtn = document.getElementById("profile-avatar-remove");
  if (!avatar || !fallback) return;

  const trimmed = String(name ?? localStorage.getItem(PROFILE_DISPLAY_NAME_KEY) ?? "").trim();
  fallback.textContent = trimmed ? trimmed.charAt(0).toUpperCase() : "?";

  const dataUrl = getStoredProfileAvatar();
  if (img && dataUrl) {
    img.src = dataUrl;
    img.hidden = false;
    avatar.classList.add("has-image");
    if (removeBtn) removeBtn.hidden = false;
    return;
  }

  if (img) {
    img.hidden = true;
    img.removeAttribute("src");
  }
  avatar.classList.remove("has-image");
  if (removeBtn) removeBtn.hidden = true;
}

function syncProfilePreview(name) {
  const nameEl = document.getElementById("profile-preview-name");
  const trimmedName = String(name || "").trim();

  if (nameEl) {
    nameEl.textContent = trimmedName || "Your name";
    nameEl.classList.toggle("is-empty", !trimmedName);
  }

  window.MorningRoastProfileTags?.renderProfileTags?.(trimmedName);
  window.MorningRoastProfileTags?.checkUnlocks?.({ notify: false });
}

function syncProfileBioCount(length) {
  const countEl = document.getElementById("profile-bio-count");
  if (countEl) countEl.textContent = `${length} / ${PROFILE_BIO_MAX}`;
}

function persistProfileFields({ name, bio } = {}) {
  if (name != null) {
    const previous = getSavedDisplayName();
    const value = String(name).trim().slice(0, PROFILE_DISPLAY_NAME_MAX);
    if (!value) return getSavedDisplayName() || null;
    localStorage.setItem(PROFILE_DISPLAY_NAME_KEY, value);
    window.MorningRoastProfileTags?.onDisplayNameChanged?.(previous, value);
    syncProfileAvatar(value);
    syncProfilePreview(value);
    return value;
  }

  if (bio != null) {
    const value = String(bio).trim().slice(0, PROFILE_BIO_MAX);
    localStorage.setItem(PROFILE_BIO_KEY, value);
    syncProfileBioCount(value.length);
    return value;
  }

  return null;
}

function syncProfileTabFromStorage() {
  const nameInput = document.getElementById("profile-display-name");
  const bioInput = document.getElementById("profile-bio");
  if (!nameInput || !bioInput) return;

  const savedName = getSavedDisplayName();
  const savedBio = localStorage.getItem(PROFILE_BIO_KEY) || "";

  nameInput.value = savedName;
  bioInput.value = savedBio;
  syncProfileAvatar(savedName);
  syncProfilePreview(savedName);
  syncProfileBioCount(savedBio.length);
  syncProfileDisplayNameUi();
  scheduleProfileDisplayNameCooldownRefresh();
}

function initProfileTab() {
  const nameInput = document.getElementById("profile-display-name");
  const bioInput = document.getElementById("profile-bio");
  const avatarButton = document.getElementById("profile-avatar-button");
  const avatarInput = document.getElementById("profile-avatar-input");
  const avatarRemove = document.getElementById("profile-avatar-remove");
  const nameSaveBtn = document.getElementById("profile-display-name-save");
  const nameCancelBtn = document.getElementById("profile-display-name-cancel");
  if (!nameInput || !bioInput || initProfileTab._init) return;
  initProfileTab._init = true;

  syncProfileTabFromStorage();

  avatarButton?.addEventListener("click", () => {
    avatarInput?.click();
  });

  avatarInput?.addEventListener("change", async () => {
    const file = avatarInput.files?.[0];
    avatarInput.value = "";
    if (!file) return;

    try {
      const dataUrl = await prepareProfileAvatarFile(file);
      persistProfileAvatar(dataUrl);
      syncProfileAvatar(getSavedDisplayName());
      window.MorningRoastChat?.initCommunityChat?.()?.refreshIdentity?.();
    } catch (error) {
      Toast.notify({ message: error?.message || "Could not update profile picture", type: "error" });
    }
  });

  avatarRemove?.addEventListener("click", () => {
    persistProfileAvatar("");
    syncProfileAvatar(getSavedDisplayName());
    window.MorningRoastChat?.initCommunityChat?.()?.refreshIdentity?.();
  });

  nameInput.addEventListener("input", () => {
    syncProfileDisplayNameUi();
    scheduleDisplayNameAvailabilityCheck(nameInput.value);
  });

  nameInput.addEventListener("blur", () => {
    const saved = getSavedDisplayName();
    const draft = String(nameInput.value || "").trim();
    if (saved && !draft) {
      nameInput.value = saved;
      syncProfileDisplayNameUi();
    }
  });

  nameInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || nameInput.readOnly) return;
    event.preventDefault();
    handleProfileDisplayNameSave();
  });

  nameSaveBtn?.addEventListener("click", handleProfileDisplayNameSave);
  nameCancelBtn?.addEventListener("click", revertProfileDisplayNameDraft);

  bioInput.addEventListener("input", () => {
    persistProfileFields({ bio: bioInput.value });
  });

  bioInput.addEventListener("change", () => {
    bioInput.value = persistProfileFields({ bio: bioInput.value }) ?? "";
  });

  bioInput.addEventListener("focus", () => {
    bioInput.closest(".profile-field")?.classList.add("is-focused");
  });

  bioInput.addEventListener("blur", () => {
    bioInput.closest(".profile-field")?.classList.remove("is-focused");
  });

  window.addEventListener("morning-roast:owners-config", () => {
    window.MorningRoastProfileTags?.renderProfileTags?.(getSavedDisplayName());
  });

  window.addEventListener("morning-roast:chat-presence", () => {
    scheduleDisplayNameAvailabilityCheck(nameInput.value);
  });

  window.addEventListener("morning-roast:display-name-taken", () => {
    handleDisplayNameTakenConflict();
  });
}

function clearSavedDisplayName() {
  const previous = getSavedDisplayName();
  if (!previous) return;

  localStorage.removeItem(PROFILE_DISPLAY_NAME_KEY);
  localStorage.removeItem(PROFILE_DISPLAY_NAME_COOLDOWN_KEY);
  window.MorningRoastProfileTags?.onDisplayNameChanged?.(previous, "");

  const nameInput = document.getElementById("profile-display-name");
  if (nameInput) nameInput.value = "";

  syncProfileAvatar("");
  syncProfilePreview("");
  setProfileDisplayNameTaken(false);
  syncProfileDisplayNameUi();
  scheduleProfileDisplayNameCooldownRefresh();
  window.MorningRoastChat?.initCommunityChat?.()?.refreshIdentity?.();
}

function handleDisplayNameTakenConflict() {
  clearSavedDisplayName();
  openUsernameOnboarding({ force: true });
}

function openUsernameOnboarding({ force = false } = {}) {
  initUsernameOnboarding();
  if (isUsernameOnboardingOpen()) return;
  if (!force && hasStoredDisplayName()) return;

  const overlay = document.getElementById("username-onboarding-overlay");
  const input = document.getElementById("username-onboarding-input");
  const submit = document.getElementById("username-onboarding-submit");
  if (!overlay || !input) return;

  overlay.classList.add("active");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("username-onboarding-open");
  syncBodyScrollLock();

  input.value = "";
  if (submit) submit.disabled = true;

  requestAnimationFrame(() => {
    input.focus();
  });
}

function closeUsernameOnboarding() {
  const overlay = document.getElementById("username-onboarding-overlay");
  if (!overlay) return;
  overlay.classList.remove("active");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("username-onboarding-open");
  syncBodyScrollLock();
}

async function completeUsernameOnboarding(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) return false;

  const available = await checkDisplayNameAvailability(trimmed);
  if (!available) {
    Toast.notify({ message: getDisplayNameValidationMessage(), type: "error" });
    const onboardingInput = document.getElementById("username-onboarding-input");
    const onboardingSubmit = document.getElementById("username-onboarding-submit");
    if (onboardingInput) onboardingInput.value = "";
    if (onboardingSubmit) onboardingSubmit.disabled = true;
    return false;
  }

  const value = persistProfileFields({ name: trimmed });
  if (!value) return false;

  const nameInput = document.getElementById("profile-display-name");
  if (nameInput) nameInput.value = value;

  window.MorningRoastChat?.initCommunityChat?.()?.refreshIdentity?.();
  window.MorningRoastProfileTags?.checkUnlocks?.({ notify: true, force: true });
  closeUsernameOnboarding();
  return true;
}

function notifyAppLoaded() {
  if (window.__morningRoastAppLoaded) return;
  window.__morningRoastAppLoaded = true;
  window.dispatchEvent(new CustomEvent("morning-roast:app-loaded"));
}

function queueUsernameOnboardingAfterLoad() {
  notifyAppLoaded();
  if (hasStoredDisplayName()) return;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => openUsernameOnboarding());
  });
}

function initUsernameOnboarding() {
  const overlay = document.getElementById("username-onboarding-overlay");
  const form = document.getElementById("username-onboarding-form");
  const input = document.getElementById("username-onboarding-input");
  const submit = document.getElementById("username-onboarding-submit");
  if (!overlay || !form || !input || initUsernameOnboarding._init) return;
  initUsernameOnboarding._init = true;

  const syncSubmitState = () => {
    if (submit) submit.disabled = !input.value.trim();
  };

  input.addEventListener("input", syncSubmitState);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!(await completeUsernameOnboarding(input.value))) return;
    input.value = "";
    syncSubmitState();
  });

  overlay.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  window.addEventListener(
    "keydown",
    (event) => {
      if (!isUsernameOnboardingOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );
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
  ctx.font = canvasFont("600 9px");
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
    lines: true,
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
    lines: true,
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
    lines: true,
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
    lines: true,
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
    lines: true,
    dot: true,
    outline: true,
    flash: true,
  },
  dotOnly: {
    label: "Dot",
    size: 10,
    gap: 0,
    thickness: 2,
    outlineThickness: 1,
    color: "#00ff00",
    lines: false,
    dot: true,
    outline: false,
    flash: true,
  },
});

function positionToggleGlider(container) {
  if (!container) return;
  const activeBtn = container.querySelector(".toggle-btn.active, .timer-btn.active, .spread-btn.active, .profile-mode-btn.active, .profile-timer-btn.active");
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

function syncToggleGlider(container) {
  if (!container) return;
  positionToggleGlider(container);
  requestAnimationFrame(() => {
    positionToggleGlider(container);
    requestAnimationFrame(() => positionToggleGlider(container));
  });
  window.setTimeout(() => positionToggleGlider(container), 320);
}

const GLIDER_SELECTOR_CONTAINERS = ".trainer-timer-selector, .trainer-toggle-selector, .trainer-spread-selector, .trainer-mode-trigger, .profile-mode-selector, .profile-timer-selector, .crosshair-converter-zoom-selector, .trainer-settings-tab-selector";

function collectToggleGliderContainers(root) {
  if (!root) return [];
  const containers = root.matches?.(GLIDER_SELECTOR_CONTAINERS) ? [root] : [];
  root.querySelectorAll(GLIDER_SELECTOR_CONTAINERS).forEach((container) => {
    if (!containers.includes(container)) containers.push(container);
  });
  return containers;
}

function updateAllToggleGliders() {
  document.querySelectorAll(GLIDER_SELECTOR_CONTAINERS).forEach(positionToggleGlider);
}

function updateToggleGlidersIn(root) {
  collectToggleGliderContainers(root).forEach(positionToggleGlider);
}

function syncToggleGlidersIn(root) {
  collectToggleGliderContainers(root).forEach(syncToggleGlider);
}

function isSectionActive(section) {
  return !!section?.classList.contains("is-active");
}

const tabSwitchUi = {
  sections: null,
  sidebarItems: null,
  moreItems: null,
  miscItems: null,
  navButtons: null,
  moreNavButtons: null,
};

function getTabSwitchUi() {
  if (tabSwitchUi.sections) return tabSwitchUi;
  tabSwitchUi.sections = [...document.querySelectorAll(".section")];
  tabSwitchUi.sidebarItems = [...document.querySelectorAll(".app-sidebar-item")];
  tabSwitchUi.moreItems = [...document.querySelectorAll(".app-sidebar-more-item")];
  tabSwitchUi.miscItems = [...document.querySelectorAll(".app-sidebar-misc-item")];
  tabSwitchUi.navButtons = [...document.querySelectorAll(".nav-bar .button-container .button, .nav-more-button, #nav-more-toggle, .nav-misc-button, #nav-misc-toggle")];
  tabSwitchUi.moreNavButtons = [...document.querySelectorAll(".nav-more-button")];
  return tabSwitchUi;
}

let tabActivationFrame = 0;

function finishTabEnterAnimation(event) {
  if (event.animationName !== "tab-enter") return;
  event.currentTarget.classList.remove("is-tab-entering");
}

function runTabActivation(id) {
  closeAllTabActionMenus();

  if (id === "aim-training-tab") {
    aimTrainer.handleResize();
    aimTrainer.updateAllGliders();
    aimTrainer.resumeLoop();
  } else if (!aimTrainer.shouldRunLoop?.()) {
    aimTrainer.stopLoop?.();
  }

  if (id === "sensitivity-converter-tab") {
    updateConversion();
  } else if (id === "edpi-calculator-tab") {
    updateEDPI();
    syncEdpiSpectrumPointerTooltip();
  } else if (id === "crosshair-converter-tab") {
    ensureCrosshairConverterLoaded()
      .then(() => {
        initCrosshairConverterTab?.();
        updateCrosshairConverterUi?.();
        updateToggleGlidersIn(document.getElementById("crosshair-converter-tab"));
      })
      .catch(() => {});
  } else if (id === "settings-tab") {
    aimTrainer.drawCrosshairPreview();
  } else if (id === "stats-tab") {
    aimTrainer.displayResultsOnProfile();
    updateToggleGlidersIn(document.getElementById("stats-tab"));
    toggleProfileSensConvButtons();
  } else if (id === "profile-tab") {
    syncProfileTabFromStorage();
    window.MorningRoastChat?.initCommunityChat?.()?.refreshIdentity?.();
  } else if (id === "lineup-tab") {
    applyLineupVideoSources();
    syncLineupFiltersUiControls();
    applyLineupGridStateInstant();
    refreshLineupVideosFixedHeight();
    updateToggleGlidersIn(document.getElementById("lineup-tab"));
  }

  updateGameInfoPanelVisibility();
}

function queueTabActivation(id) {
  if (tabActivationFrame) nativeCancelAnimationFrame(tabActivationFrame);
  tabActivationFrame = nativeRequestAnimationFrame(() => {
    nativeRequestAnimationFrame(() => {
      tabActivationFrame = 0;
      runTabActivation(id);
    });
  });
}

const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);

const UI_REFRESH_MODES = new Set(["60", "144", "max"]);

function normalizeUiRefreshMode(stored) {
  if (stored && UI_REFRESH_MODES.has(stored)) return stored;
  if (stored === "true") return "144";
  return "max";
}

const UiFpsCap = (() => {
  let mode = "max";
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
  bgParticles.sync();
  bgStars.sync();
  bgFlow.sync();
}

UiFpsCap.setMode(normalizeUiRefreshMode(localStorage.getItem("prefUiRefresh") || localStorage.getItem("prefHighRefresh")));

function parseAimSensValue(raw) {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  const parsed = parseFloat(trimmed.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function formatAimSensValue(value) {
  return Number(value).toFixed(3);
}

function persistAimSensStorage(rawOrNumber) {
  const parsed = typeof rawOrNumber === "number" ? rawOrNumber : parseAimSensValue(rawOrNumber);
  if (parsed == null) {
    localStorage.removeItem("aimSens");
    return null;
  }
  const formatted = formatAimSensValue(parsed);
  localStorage.setItem("aimSens", formatted);
  return formatted;
}

function loadAimSensInput(input) {
  if (!input) return;
  const parsed = parseAimSensValue(localStorage.getItem("aimSens"));
  if (parsed == null) {
    input.value = "";
    localStorage.removeItem("aimSens");
    return;
  }
  input.value = formatAimSensValue(parsed);
}

function syncAimSensInputFromField(input, { formatInput = false } = {}) {
  if (!input) return;
  const parsed = parseAimSensValue(input.value);
  if (parsed == null) {
    input.value = "";
    localStorage.removeItem("aimSens");
    return;
  }
  const formatted = formatAimSensValue(parsed);
  if (formatInput) input.value = formatted;
  localStorage.setItem("aimSens", formatted);
}

const aimTrainer = {
  totalTimeTaken: 0,
  lastHitTime: 0,
  hits: 0,
  kills: 0,
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
    return this.getRootFontPx() * 2;
  },

  getRootFontPx() {
    return this._rootFontPx || 16;
  },

  syncLayoutMetricsCache() {
    this._rootFontPx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
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

  findOpenSpawnAngles(radius, gapPx = 16, { quick = false } = {}) {
    const band = this.getSpawnBand();
    if (!this.canvas) return { yaw: 0, pitch: 0, valid: false };

    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    const focal = this.getFocalLength();
    const aspectX = this.getAspectHorizontalScale();
    const screenR = this.getTargetScreenRadius(radius);
    const topMargin = this.getSpawnTopMarginPx();
    const maxAttempts = quick ? 36 : 160;

    const isValidSpawn = (yaw, pitch) => {
      const px = cx + (yaw - this.camera.yaw) * focal * aspectX;
      const py = cy - (pitch - this.camera.pitch) * focal;
      if (py - screenR < topMargin) return false;

      for (const other of this.targets) {
        const ox = cx + (other.yaw - this.camera.yaw) * focal * aspectX;
        const oy = cy - (other.pitch - this.camera.pitch) * focal;
        const or = this.getTargetScreenRadius(other.radius);
        const dx = px - ox;
        const dy = py - oy;
        const minDist = screenR + or + gapPx;
        if (dx * dx + dy * dy < minDist * minDist) return false;
      }
      return true;
    };

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const yaw = (Math.random() - 0.5) * band.yaw * 2;
      const pitch = (Math.random() - 0.5) * band.pitch * 2;
      if (isValidSpawn(yaw, pitch)) return { yaw, pitch, valid: true };
    }

    const gridSteps = quick ? 6 : 10;
    for (let gy = 0; gy < gridSteps; gy++) {
      for (let gx = 0; gx < gridSteps; gx++) {
        const yaw = -band.yaw + (gx / Math.max(1, gridSteps - 1)) * band.yaw * 2;
        const pitch = -band.pitch + (gy / Math.max(1, gridSteps - 1)) * band.pitch * 2;
        if (isValidSpawn(yaw, pitch)) return { yaw, pitch, valid: true };
      }
    }

    if (quick) {
      for (let i = 0; i < 8; i++) {
        const yaw = (Math.random() - 0.5) * band.yaw * 2;
        const pitch = (Math.random() - 0.5) * band.pitch * 2;
        if (!this.spawnTooCloseToTop(yaw, pitch, radius)) return { yaw, pitch, valid: true };
      }
      return { yaw: 0, pitch: 0, valid: false };
    }

    let bestYaw = 0;
    let bestPitch = 0;
    let bestGap = -1;

    for (let i = 0; i < 48; i++) {
      const yaw = (Math.random() - 0.5) * band.yaw * 2;
      const pitch = (Math.random() - 0.5) * band.pitch * 2;
      if (this.spawnTooCloseToTop(yaw, pitch, radius)) continue;
      const px = cx + (yaw - this.camera.yaw) * focal * aspectX;
      const py = cy - (pitch - this.camera.pitch) * focal;
      let nearestGap = Infinity;

      for (const other of this.targets) {
        const ox = cx + (other.yaw - this.camera.yaw) * focal * aspectX;
        const oy = cy - (other.pitch - this.camera.pitch) * focal;
        const or = this.getTargetScreenRadius(other.radius);
        nearestGap = Math.min(nearestGap, Math.hypot(px - ox, py - oy) - (screenR + or));
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
    lines: true,
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
    const resolved = game ? MorningRoastGames.resolveGameName(game) || game : "";
    this.game = resolved;
    const config = trainerConfigs[resolved] || trainerConfigs.Valorant;
    this.fov = config.fov;
    localStorage.setItem("aimGame", resolved);
    const gameSearchInput = document.getElementById("trainer-game-search");
    if (gameSearchInput) {
      gameSearchInput.dataset.lastValid = resolved;
      gameSearchInput.value = resolved ? getGameDisplayName(resolved) : "";
    }
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
    const { size, gap, thickness, outlineThickness, color, dot, outline, lines = true } = crosshair;
    const showLines = lines !== false && size > 0;
    const fillColor = strokeOverride ?? color;
    const outlinePad = Math.max(1, Math.round(outlineThickness));
    const snapAxis = (value, lineWidth) => (lineWidth % 2 === 0 ? Math.round(value) : Math.round(value - 0.5) + 0.5);

    const drawLines = (strokeStyle, lineWidth) => {
      if (!showLines) return;
      const x = snapAxis(cx, lineWidth);
      const y = snapAxis(cy, lineWidth);
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

    if (outline) drawLines("#000000", thickness + outlinePad * 2);
    drawLines(fillColor, thickness);

    if (dot) {
      const dotSize = Math.max(1, Math.round(thickness));
      const dotLeft = Math.round(cx) - Math.floor(dotSize / 2);
      const dotTop = Math.round(cy) - Math.floor(dotSize / 2);

      if (outline) {
        const outlineSize = dotSize + outlinePad * 2;
        const outlineLeft = Math.round(cx) - Math.floor(outlineSize / 2);
        const outlineTop = Math.round(cy) - Math.floor(outlineSize / 2);
        ctx.fillStyle = "#000000";
        ctx.fillRect(outlineLeft, outlineTop, outlineSize, outlineSize);
      }

      ctx.fillStyle = fillColor;
      ctx.fillRect(dotLeft, dotTop, dotSize, dotSize);
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
        if (this.crosshair.lines === undefined) this.crosshair.lines = true;
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
      syncChToggle("ch-lines-selector", "lines");
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
    wireChToggle("ch-lines-selector", "lines");
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
    const presetKeys = ["size", "gap", "thickness", "outlineThickness", "color", "lines", "dot", "outline", "flash"];
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
    const gameInput = document.getElementById("trainer-game-search");
    const game = MorningRoastGames.resolveGameName(gameInput?.value?.trim()) || gameInput?.dataset.lastValid || this.game || "";
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
    this.syncLayoutMetricsCache();

    const sensInput = document.getElementById("canvas-sens");
    const dpiInput = document.getElementById("canvas-dpi");
    const gameSearchInput = document.getElementById("trainer-game-search");

    loadAimSensInput(sensInput);
    if (localStorage.getItem("aimDpi")) {
      if (dpiInput) dpiInput.value = localStorage.getItem("aimDpi");
    }
    if (localStorage.getItem("aimGame")) {
      const savedGame = MorningRoastGames.resolveGameName(localStorage.getItem("aimGame")) || localStorage.getItem("aimGame");
      this.game = savedGame;
      if (gameSearchInput) {
        gameSearchInput.dataset.lastValid = savedGame;
        gameSearchInput.value = getGameDisplayName(savedGame);
      }
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
                  persistAimSensStorage(this.finderTrialSens);
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
          syncToggleGlider(document.getElementById("trainer-settings-tab-selector"));
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

    if (sensInput) {
      sensInput.addEventListener("input", () => {
        if (this.finderEnabled) return;
        const parsed = parseAimSensValue(sensInput.value);
        if (parsed != null) {
          persistAimSensStorage(parsed);
        } else if (!sensInput.value.trim()) {
          localStorage.removeItem("aimSens");
        }
      });
      sensInput.addEventListener("blur", () => {
        if (this.finderEnabled) return;
        syncAimSensInputFromField(sensInput, { formatInput: true });
      });
    }

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
    this.cancelScheduledSpawn();
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
    this.ctx.font = canvasFont(`600 ${Math.round(13 * scaleY)}px`);
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
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(440, t + 0.06);
      gain.gain.setValueAtTime(peakGain, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
      osc.start(t);
      osc.stop(t + 0.07);
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
    this.syncLayoutMetricsCache();
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
    this.kills = 0;
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
        persistAimSensStorage(this.finderTrialSens);
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
    const multiplier = getGameConversionFactor(this.game);

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
    persistAimSensStorage(trialSens);
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
    sCtx.font = canvasFont("bold 60px");
    sCtx.textAlign = "center";
    sCtx.fillText("MORNING ROAST", 500, 120);
    sCtx.fillStyle = "white";
    sCtx.font = canvasFont("24px");
    sCtx.globalAlpha = 0.5;
    sCtx.fillText("AIM TRAINER PERFORMANCE REPORT", 500, 160);
    sCtx.globalAlpha = 1.0;

    const acc = isTrainerAccuracyMode(this.mode) ? (this.totalTrackingFrames === 0 ? 0 : Math.round((this.trackingFrames / this.totalTrackingFrames) * 100)) : this.totalClicks > 0 ? Math.ceil((this.hits / this.totalClicks) * 100) : 0;
    const reaction = this.kills > 0 ? (this.totalTimeTaken / this.kills).toFixed(0) : 0;

    const stats = [
      { label: "HITS", value: this.hits, color: "hsl(30, 35%, 64%)" },
      { label: "ACCURACY", value: acc + "%", color: "hsl(46, 65%, 52%)" },
      { label: "REACTION", value: reaction + "ms", color: "hsl(260, 60%, 70%)" },
    ];

    stats.forEach((s, i) => {
      const x = 200 + i * 300;
      sCtx.fillStyle = "white";
      sCtx.font = canvasFont("bold 18px");
      sCtx.globalAlpha = 0.4;
      sCtx.fillText(s.label, x, 280);
      sCtx.globalAlpha = 1.0;
      sCtx.fillStyle = s.color;
      sCtx.font = canvasFont("bold 72px");
      sCtx.fillText(s.value, x, 350);
    });

    sCtx.strokeStyle = "hsla(0, 0%, 100%, 0.1)";
    sCtx.beginPath();
    sCtx.moveTo(100, 420);
    sCtx.lineTo(900, 420);
    sCtx.stroke();

    sCtx.fillStyle = "white";
    sCtx.font = canvasFont("bold 20px");
    sCtx.fillText(`${this.game.toUpperCase()} • ${this.mode.toUpperCase()} MODE`, 500, 500);

    const mapScale = 2.6;
    const mapY = 780;

    this.drawSpatialMap(sCtx, 317, mapY, this.sessionHits, this.sessionMisses, mapScale);
    this.drawPrecisionMap(sCtx, 795, mapY, this.sessionOffsets, mapScale);

    sCtx.fillStyle = "white";
    sCtx.globalAlpha = 0.3;
    sCtx.font = canvasFont("bold 16px");
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
    this.ctx.font = canvasFont(`600 ${titleSize}px`);
    this.ctx.fillText("Share score", panelX + pad, titleY);

    this.ctx.fillStyle = "hsl(0, 0%, 55%)";
    this.ctx.font = canvasFont(`${subtitleSize}px`);
    this.ctx.fillText("Choose how to share your aim trainer score.", panelX + pad, titleY + titleSize + subtitleGap);

    const btnH = Math.max(28, (32 * panelW) / 384);
    const btnPadX = Math.max(10, (14 * panelW) / 384);
    const btnY = panelY + panelH - pad - btnH;
    const btnRadius = Math.max(6, (8 * panelW) / 384);
    const btnFont = canvasFont(`600 ${Math.max(11, (13 * panelW) / 384)}px`);
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
    return isSectionActive(document.getElementById("aim-training-tab"));
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
    this.ctx.font = canvasFont("bold 20px");
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
    ctx.font = canvasFont("bold 20px");
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
          this.scheduleSpawnTarget();
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
    const gap = this.getRootFontPx();
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
      this.ctx.font = canvasFont("bold 9px");
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
    ctx.font = canvasFont(`bold ${9 * scale}px`);
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
    ctx.font = canvasFont(`bold ${9 * scale}px`);
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
          ctx.font = canvasFont("10px");
          ctx.textAlign = "center";
          ctx.fillText("NEW SESSION REQUIRED", cssW / 2, cssH / 2);
          pCtx.fillStyle = "hsla(0, 0%, 100%, 0.2)";
          pCtx.font = canvasFont("10px");
          pCtx.textAlign = "center";
          pCtx.fillText("NEW SESSION REQUIRED", pW / 2, pH / 2);
        } else {
          ctx.fillStyle = "hsla(0, 0%, 100%, 0.1)";
          ctx.font = canvasFont("10px");
          ctx.textAlign = "center";
          ctx.fillText("NO DATA FOUND", cssW / 2, cssH / 2);
          pCtx.fillStyle = "hsla(0, 0%, 100%, 0.1)";
          pCtx.font = canvasFont("10px");
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
    this.cancelScheduledSpawn();
    this.showResults = true;
    this.showShareMenu = false;
    this.shareScoreCanvas = null;
    this.buttonDisabledUntil = Date.now() + 2000;
    if (document.pointerLockElement) document.exitPointerLock();

    const currentHits = this.hits;
    const currentAccuracy = isTrainerAccuracyMode(this.mode) ? (this.totalTrackingFrames === 0 ? 0 : Math.round((this.trackingFrames / this.totalTrackingFrames) * 100)) : this.totalClicks > 0 ? Math.ceil((this.hits / this.totalClicks) * 100) : 0;
    const currentReaction = this.kills > 0 ? (this.totalTimeTaken / this.kills).toFixed(0) : 0;

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
    window.MorningRoastProfileTags?.checkUnlocks?.({ notify: true });
    this.render();
  },

  finishFinderCycle() {
    const bestResult = this.finderSessionResults.reduce((prev, curr) => (curr.score > prev.score ? curr : prev));
    const finalSens = Number(bestResult.sens).toFixed(3);

    if (elements["canvas-sens"]) {
      elements["canvas-sens"].value = finalSens;
      persistAimSensStorage(finalSens);
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

  spawnTarget({ quick = false } = {}) {
    const modeDef = getTrainerModeDef(this.mode);
    const radius = this.getTargetRadius();
    const { yaw, pitch, valid } = this.findOpenSpawnAngles(radius, 16, { quick });
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

  scheduleSpawnTarget(trackingMotion = null) {
    if (!this.active || this.showResults) return;
    if (this.targets.length >= getModeMaxTargets(this.mode)) return;

    if (this._spawnScheduleId != null) {
      if (trackingMotion) this._spawnScheduleTracking = trackingMotion;
      return;
    }

    this._spawnScheduleTracking = trackingMotion;
    this._spawnScheduleId = nativeRequestAnimationFrame(() => {
      this._spawnScheduleId = null;
      const motion = this._spawnScheduleTracking;
      this._spawnScheduleTracking = null;
      if (!this.active || this.showResults) return;
      if (this.targets.length >= getModeMaxTargets(this.mode)) return;

      this.spawnTarget({ quick: true });
      if (motion && this.targets[0]) {
        this.initTrackingTargetMotion(this.targets[0], motion);
      }
    });
  },

  cancelScheduledSpawn() {
    if (this._spawnScheduleId != null) {
      nativeCancelAnimationFrame(this._spawnScheduleId);
      this._spawnScheduleId = null;
    }
    this._spawnScheduleTracking = null;
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
      this.hits++;
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

        this.kills++;
        if (this.randomizerEnabled) {
          this.randomizeSensitivity();
          this.randomizerTimer = 0;
        }
        if (reactionTime > 10) this.totalTimeTaken += reactionTime;
        this.lastHitTime = now;

        if (isTrainerAccuracyMode(this.mode)) {
          this.isFlickingToNewTarget = true;
          this.scheduleSpawnTarget({ phaseX: killedPhaseX, phaseY: killedPhaseY });
        } else if (this.targets.length < getModeMaxTargets(this.mode)) {
          this.scheduleSpawnTarget();
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
    this.ctx.font = canvasFont("bold 14px");
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
    this.ctx.font = canvasFont("bold 10px");
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
    this.ctx.font = canvasFont("11px");
    this.ctx.textAlign = "left";
    this.ctx.fillText(label, x, y - 8);

    if (isPB) {
      const labelWidth = this.ctx.measureText(label).width;
      this.ctx.fillStyle = "hsl(46, 100%, 50%)";
      this.ctx.beginPath();
      this.ctx.roundRect(x + labelWidth + 8, y - 18, 22, 12, 3);
      this.ctx.fill();
      this.ctx.fillStyle = "black";
      this.ctx.font = canvasFont("bold 8px");
      this.ctx.fillText("PB", x + labelWidth + 12, y - 9);
    }

    this.ctx.fillStyle = "white";
    this.ctx.font = canvasFont("11px");
    this.ctx.textAlign = "right";
    this.ctx.fillText(`${value}${unit}`, x + w, y - 8);
  },

  drawSessionHud(cx) {
    const pad = 24;
    const topY = 26;

    this.ctx.save();
    this.ctx.textBaseline = "top";

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
    this.ctx.font = canvasFont(`bold ${timerFontSize}px`);
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

    const bulletsHit = this.hits;
    const bulletsShot = this.totalClicks;
    const bulletCounter = `${bulletsHit} / ${bulletsShot}`;
    this.ctx.textAlign = "right";
    this.ctx.textBaseline = "alphabetic";
    this.ctx.font = canvasFont("bold 13px");
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
      this.ctx.font = canvasFont("bold 26px");
      this.ctx.textAlign = "center";
      this.ctx.fillText("SESSION SUMMARY", cx, cy - 225);

      let acc;
      if (isTrainerAccuracyMode(this.mode)) {
        acc = this.totalTrackingFrames === 0 ? 0 : Math.round((this.trackingFrames / this.totalTrackingFrames) * 100);
      } else {
        acc = this.totalClicks === 0 ? 0 : Math.ceil((this.hits / this.totalClicks) * 100);
      }
      const reaction = this.kills > 0 ? (this.totalTimeTaken / this.kills).toFixed(0) : 0;

      const hitsChartMax = isInfiniteTrainerTimer(this.sessionTimerId) ? Math.max(this.hits, Math.ceil(this.timeLeft * 2) || 10) : Math.ceil(parseInt(this.sessionTimerId, 10) * 2.6);
      this.drawChart(cx - 120, cy - 194, "HITS", this.hits, hitsChartMax, "", "hsl(30, 35%, 64%)", this.sessionPBs.hits);
      this.drawChart(cx - 120, cy - 149, "MISSES", this.misses, 80, "", "hsl(0, 0%, 75%)", false);
      this.drawChart(cx - 120, cy - 104, "ACCURACY", acc, 100, "%", "hsl(46, 65%, 52%)", this.sessionPBs.accuracy);
      this.drawChart(cx - 120, cy - 59, "REACTION TIME", reaction, 1000, "ms", "hsl(260, 60%, 70%)", this.sessionPBs.reaction);

      const mapScale = 1.4;
      this.drawSpatialMap(this.ctx, cx - 102, cy + 72, this.sessionHits, this.sessionMisses, mapScale);
      this.drawPrecisionMap(this.ctx, cx + 162, cy + 72, this.sessionOffsets, mapScale);

      this.ctx.fillStyle = "white";
      this.ctx.font = canvasFont("bold 11px");
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
      this.ctx.font = canvasFont("bold 13px");
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
      this.ctx.font = canvasFont("bold 80px");
      this.ctx.textAlign = "center";
      this.ctx.textBaseline = "middle";
      this.ctx.fillText(String(this.countdownValue), cx, cy + 25);
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
        this.ctx.font = canvasFont("bold 10px");
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

const debounceTimers = {
  edpi: 0,
  conversion: 0,
};

/** After profile stats reset, don't rewrite saved stats from current calculator inputs until the user edits them. */
let profileSensStatsPaused = false;
let profileEdpiStatsPaused = false;

function scheduleUpdateEDPI() {
  profileEdpiStatsPaused = false;
  clearTimeout(debounceTimers.edpi);
  debounceTimers.edpi = setTimeout(updateEDPI, 64);
}

function getEdpiSpectrumBounds(game) {
  const yaw = MorningRoastGames.getGameYaw(game);
  const profile = MorningRoastGames.getGameSensProfile(game);
  if (yaw == null || yaw <= 0 || !profile) return null;
  // cm/360 ↔ eDPI: cm = (360 * 2.54) / (edpi * yaw)
  const edpiFromCm = (cm) => (360 * CM360_INCH_TO_CM) / (cm * yaw);
  // Low = above lowAbove cm/360 · average = highBelow–lowAbove · high = below highBelow
  const lowThreshold = edpiFromCm(profile.lowAbove);
  const midThreshold = edpiFromCm(profile.highBelow);
  const maxCm = Math.max(8, Math.round(profile.highBelow * 0.4));
  const recommendedMinEdpi = edpiFromCm(profile.recommendedMax);
  const recommendedMaxEdpi = edpiFromCm(profile.recommendedMin);
  return {
    lowThreshold,
    midThreshold,
    maxEdpi: Math.max(Math.round(edpiFromCm(maxCm)), Math.round(midThreshold) + 1),
    profile,
    recommendedMinEdpi,
    recommendedMaxEdpi,
    recommendedMinCm: profile.recommendedMin,
    recommendedMaxCm: profile.recommendedMax,
  };
}

function updateEdpiSpectrumRecommended(bounds) {
  const marks = document.getElementById("edpi-spectrum-recommended");
  if (!marks) return;

  if (!bounds?.profile) {
    if (marks.hidden) {
      marks.classList.remove("is-visible");
      return;
    }
    marks.classList.remove("is-visible");
    const onFadeOut = (event) => {
      if (event.target !== marks || event.propertyName !== "opacity") return;
      marks.removeEventListener("transitionend", onFadeOut);
      if (!marks.classList.contains("is-visible")) marks.hidden = true;
    };
    marks.addEventListener("transitionend", onFadeOut);
    return;
  }

  const minMark = marks.querySelector('[data-mark="min"]');
  const maxMark = marks.querySelector('[data-mark="max"]');
  // Higher cm/360 = lower eDPI = further left on the bar.
  const leftPct = edpiToSpectrumPercent(bounds.recommendedMinEdpi, bounds);
  const rightPct = edpiToSpectrumPercent(bounds.recommendedMaxEdpi, bounds);
  const nextLeft = Math.min(leftPct, rightPct);
  const nextWidth = Math.abs(rightPct - leftPct);
  // Snap layout on first show so fade-in doesn't also slide from 0.
  const shouldSnap = marks.hidden || !marks.classList.contains("is-visible");

  if (shouldSnap) marks.classList.add("is-snapping");

  if (maxMark) {
    const maxLabel = formatRecommendedSpectrumDistance(bounds.recommendedMaxCm);
    maxMark.style.left = `${leftPct}%`;
    maxMark.setAttribute("data-label", maxLabel);
    attachUiTooltip(maxMark, `Recommended ${maxLabel}/360`);
  }
  if (minMark) {
    const minLabel = formatRecommendedSpectrumDistance(bounds.recommendedMinCm);
    minMark.style.left = `${rightPct}%`;
    minMark.setAttribute("data-label", minLabel);
    attachUiTooltip(minMark, `Recommended ${minLabel}/360`);
  }
  marks.style.setProperty("--rec-left", `${nextLeft}%`);
  marks.style.setProperty("--rec-width", `${nextWidth}%`);
  const rangeLabel = `${formatRecommendedSpectrumDistance(bounds.recommendedMinCm)}–${formatRecommendedSpectrumDistance(bounds.recommendedMaxCm)}`;
  attachUiTooltip(
    marks,
    `Recommended ${rangeLabel}/360. ${bounds.profile.why} ${bounds.profile.proExample}`,
  );

  marks.hidden = false;
  if (shouldSnap) {
    marks.classList.remove("is-visible");
    void marks.offsetWidth;
    marks.classList.remove("is-snapping");
    marks.classList.add("is-visible");
  } else {
    marks.classList.add("is-visible");
  }
}

function edpiToSpectrumPercent(edpi, bounds) {
  const { lowThreshold, midThreshold, maxEdpi } = bounds;
  const value = Math.min(maxEdpi, Math.max(0, edpi));
  if (value <= 0) return 0;
  if (value <= lowThreshold) return (value / lowThreshold) * 33;
  if (value <= midThreshold) return 33 + ((value - lowThreshold) / (midThreshold - lowThreshold)) * 33;
  return 66 + ((value - midThreshold) / (maxEdpi - midThreshold)) * 34;
}

function spectrumPercentToEdpi(percent, bounds) {
  const pct = Math.min(100, Math.max(0, percent));
  const { lowThreshold, midThreshold, maxEdpi } = bounds;
  let edpi;
  if (pct <= 0) {
    edpi = 0;
  } else if (pct <= 33) {
    edpi = (pct / 33) * lowThreshold;
  } else if (pct <= 66) {
    edpi = lowThreshold + ((pct - 33) / 33) * (midThreshold - lowThreshold);
  } else {
    edpi = midThreshold + ((pct - 66) / 34) * (maxEdpi - midThreshold);
  }
  return Math.min(maxEdpi, Math.max(0, Math.round(edpi)));
}

function formatSensForTargetEdpi(edpi, dpi) {
  if (!dpi || !Number.isFinite(dpi) || dpi <= 0) return "";
  const target = Math.round(edpi);
  if (target <= 0) return "0";
  for (let decimals = 1; decimals <= 8; decimals++) {
    const sens = (target / dpi).toFixed(decimals);
    if (Math.round(Number(sens) * dpi) === target) return sens;
  }
  // Prefer a value that still rounds back to the exact eDPI.
  const exact = target / dpi;
  for (let decimals = 6; decimals <= 12; decimals++) {
    const sens = exact.toFixed(decimals);
    if (Math.round(Number(sens) * dpi) === target) return sens;
  }
  return exact.toFixed(8);
}

function getEdpiSpectrumTierStyle(edpi, bounds) {
  const { lowThreshold, midThreshold } = bounds;
  if (edpi < lowThreshold) {
    return { label: "PRO LOW", color: EDPI_TIER_COLORS.low, tier: "low" };
  }
  if (edpi <= midThreshold) {
    return { label: "PRO AVERAGE", color: EDPI_TIER_COLORS.average, tier: "average" };
  }
  return { label: "PRO HIGH", color: EDPI_TIER_COLORS.high, tier: "high" };
}

const edpiSpectrumDrag = {
  active: false,
  pointerId: null,
  lastEdpi: null,
  setup: "a",
};

const edpiSpectrumHintState = {
  dismissed: false,
  lastValueText: null,
};

let edpiCompareMode = "single";

function isEdpiCompareMode() {
  return edpiCompareMode === "compare";
}

function getEdpiSetupElements(setup = "a") {
  if (setup === "b") {
    return {
      dpi: elements["edpi-dpi-b"] || document.getElementById("edpi-dpi-b"),
      sens: elements["edpi-sens-b"] || document.getElementById("edpi-sens-b"),
      pointer: elements["spectrum-pointer-b"] || document.getElementById("spectrum-pointer-b"),
      rank: elements["edpi-rank-b"] || document.getElementById("edpi-rank-b"),
      value: elements["edpi-value-b"] || document.getElementById("edpi-value-b"),
    };
  }
  return {
    dpi: elements["edpi-dpi"] || document.getElementById("edpi-dpi"),
    sens: elements["edpi-sens"] || document.getElementById("edpi-sens"),
    pointer: elements["spectrum-pointer"] || document.getElementById("spectrum-pointer"),
    rank: elements["edpi-rank"] || document.getElementById("edpi-rank"),
    value: elements["edpi-value"] || document.getElementById("edpi-value"),
  };
}

function syncEdpiCompareModeUi(mode = edpiCompareMode) {
  const compare = mode === "compare";
  const selector = document.getElementById("edpi-compare-selector");
  const fields = document.getElementById("edpi-compare-fields");
  const pointerB = getEdpiSetupElements("b").pointer;
  const rankB = getEdpiSetupElements("b").rank;
  const valueB = getEdpiSetupElements("b").value;
  const colB = document.querySelector('#edpi-calculator-tab .edpi-value-col[data-edpi-col="b"]');
  const valuesSep = document.querySelector('#edpi-calculator-tab .edpi-value-col[data-edpi-col="sep"]');
  const gap = elements["edpi-compare-gap"] || document.getElementById("edpi-compare-gap");
  const sensLabel = document.getElementById("edpi-sens-label");
  const dpiLabel = document.getElementById("edpi-dpi-label");
  const resultLabel = document.querySelector("#edpi-calculator-tab .edpi-info-row .result-label");
  const tab = document.getElementById("edpi-calculator-tab");

  tab?.classList.toggle("is-compare", compare);
  if (fields) fields.hidden = !compare;
  if (colB) colB.hidden = !compare;
  if (valuesSep) valuesSep.hidden = !compare;

  selector?.querySelectorAll(".toggle-btn[data-edpi-compare]").forEach((btn) => {
    const active = btn.dataset.edpiCompare === mode;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  syncToggleGlider(selector);

  if (sensLabel) {
    sensLabel.innerHTML = compare ? '<i class="ri-focus-3-line" aria-hidden="true"></i> Sensitivity A' : '<i class="ri-focus-3-line" aria-hidden="true"></i> Sensitivity';
  }
  if (dpiLabel) {
    dpiLabel.innerHTML = compare ? '<i class="ri-mouse-line" aria-hidden="true"></i> DPI A' : '<i class="ri-mouse-line" aria-hidden="true"></i> DPI';
  }
  if (resultLabel) {
    resultLabel.innerHTML = compare ? '<i class="ri-speed-line" aria-hidden="true"></i> eDPI A · <span class="edpi-label-b">B</span>' : '<i class="ri-speed-line" aria-hidden="true"></i> Total EDPI';
  }

  if (pointerB) {
    pointerB.hidden = !compare;
    pointerB.setAttribute("aria-hidden", compare ? "false" : "true");
    pointerB.tabIndex = compare ? 0 : -1;
  }
  if (!compare) {
    if (rankB) {
      rankB.style.opacity = "0";
      rankB.textContent = "";
    }
    if (valueB) {
      valueB.textContent = "";
    }
    if (gap) {
      gap.hidden = true;
      gap.textContent = "";
      toggleVisibility(gap, false);
    }
  }
}

function setEdpiCompareMode(mode) {
  edpiCompareMode = mode === "compare" ? "compare" : "single";
  syncEdpiCompareModeUi(edpiCompareMode);
  updateEDPI();
}

function initEdpiCompareMode() {
  const selector = document.getElementById("edpi-compare-selector");
  if (!selector || initEdpiCompareMode._init) return;
  initEdpiCompareMode._init = true;

  edpiCompareMode = "single";
  localStorage.removeItem("edpiCompareMode");
  syncEdpiCompareModeUi(edpiCompareMode);

  selector.addEventListener("click", (event) => {
    const btn = event.target.closest(".toggle-btn[data-edpi-compare]");
    if (!btn || btn.classList.contains("active")) return;
    setEdpiCompareMode(btn.dataset.edpiCompare);
  });
}

function syncEdpiSpectrumPointerTooltip() {
  const tip = document.getElementById("spectrum-pointer-tooltip");
  if (!tip) return;
  const show = getCurrentTabId() === "edpi-calculator-tab" && !edpiSpectrumHintState.dismissed;
  tip.hidden = !show;
  tip.classList.toggle("is-visible", show);
}

function dismissEdpiSpectrumPointerTooltip() {
  if (edpiSpectrumHintState.dismissed) return;
  edpiSpectrumHintState.dismissed = true;
  syncEdpiSpectrumPointerTooltip();
}

function setEdpiValueDisplay(nextText) {
  const display = elements["edpi-value"];
  if (!display) return;
  const next = String(nextText);
  const prev = edpiSpectrumHintState.lastValueText;
  if (prev != null && prev !== next && getCurrentTabId() === "edpi-calculator-tab") {
    dismissEdpiSpectrumPointerTooltip();
  }
  edpiSpectrumHintState.lastValueText = next;
  display.innerText = next;
}

function getCurrentEdpiValue(bounds, setup = "a") {
  const { dpi: dpiInput, sens: sensInput } = getEdpiSetupElements(setup);
  const dpi = parseFloat(dpiInput?.value);
  const sens = parseFloat(String(sensInput?.value || "").replace(",", "."));
  if (!bounds || !Number.isFinite(dpi) || dpi <= 0) return 0;
  if (!Number.isFinite(sens) || sens < 0) return 0;
  return Math.min(bounds.maxEdpi, Math.max(0, Math.round(sens * dpi)));
}

function setEdpiFromSpectrumValue(edpi, setup = "a") {
  const { dpi: dpiInput, sens: sensInput } = getEdpiSetupElements(setup);
  const gameVal = resolveEdpiGameInput();
  const dpi = parseFloat(dpiInput?.value);
  const bounds = getEdpiSpectrumBounds(gameVal);
  if (!bounds || !dpiInput || !sensInput || !Number.isFinite(dpi) || dpi <= 0) return false;

  const nextEdpi = Math.min(bounds.maxEdpi, Math.max(0, Math.round(edpi)));
  const sens = formatSensForTargetEdpi(nextEdpi, dpi);
  if (sens === "") return false;

  sensInput.value = sens;
  edpiSpectrumDrag.lastEdpi = nextEdpi;
  updateEDPI();
  return true;
}

function applyEdpiSpectrumPointerFromClientX(clientX, setup = edpiSpectrumDrag.setup || "a") {
  const container = document.querySelector("#edpi-calculator-tab .spectrum-container");
  const { pointer } = getEdpiSetupElements(setup);
  const gameVal = resolveEdpiGameInput();
  const bounds = getEdpiSpectrumBounds(gameVal);
  if (!container || !bounds) return;

  const rect = container.getBoundingClientRect();
  if (!rect.width) return;
  const percent = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
  // Follow the cursor instantly while dragging; value still snaps to whole eDPI.
  if (pointer && edpiSpectrumDrag.active && edpiSpectrumDrag.setup === setup) {
    pointer.style.transition = "none";
    pointer.style.left = `${percent}%`;
  }
  const target = spectrumPercentToEdpi(percent, bounds);
  if (target === (edpiSpectrumDrag.lastEdpi ?? getCurrentEdpiValue(bounds, setup))) return;
  setEdpiFromSpectrumValue(target, setup);
}

function nudgeEdpiSpectrum(delta, setup = "a") {
  const gameVal = resolveEdpiGameInput();
  const bounds = getEdpiSpectrumBounds(gameVal);
  if (!bounds) return;
  setEdpiFromSpectrumValue(getCurrentEdpiValue(bounds, setup) + delta, setup);
}

function bindEdpiSpectrumPointer(pointer, setup) {
  const container = document.querySelector("#edpi-calculator-tab .spectrum-container");
  if (!container || !pointer) return;

  const canDrag = () => {
    const { dpi: dpiInput } = getEdpiSetupElements(setup);
    const dpi = parseFloat(dpiInput?.value);
    const gameVal = resolveEdpiGameInput();
    return Boolean(getEdpiSpectrumBounds(gameVal) && Number.isFinite(dpi) && dpi > 0);
  };

  const stopDrag = (event) => {
    if (!edpiSpectrumDrag.active || edpiSpectrumDrag.setup !== setup) return;
    if (event?.pointerId != null && edpiSpectrumDrag.pointerId != null && event.pointerId !== edpiSpectrumDrag.pointerId) return;
    edpiSpectrumDrag.active = false;
    edpiSpectrumDrag.pointerId = null;
    edpiSpectrumDrag.lastEdpi = null;
    edpiSpectrumDrag.setup = "a";
    container.classList.remove("is-dragging");
    pointer.classList.remove("is-dragging");
    pointer.style.transition = "";
    try {
      pointer.releasePointerCapture?.(event.pointerId);
    } catch (_) {}
    updateEDPI();
  };

  const startDrag = (event) => {
    if (event.button != null && event.button !== 0) return;
    if (setup === "b" && !isEdpiCompareMode()) return;
    if (!canDrag()) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = getEdpiSpectrumBounds(resolveEdpiGameInput());
    edpiSpectrumDrag.active = true;
    edpiSpectrumDrag.pointerId = event.pointerId;
    edpiSpectrumDrag.setup = setup;
    edpiSpectrumDrag.lastEdpi = getCurrentEdpiValue(bounds, setup);
    container.classList.add("is-dragging");
    pointer.classList.add("is-dragging");
    pointer.style.transition = "none";
    pointer.setPointerCapture?.(event.pointerId);
    pointer.focus({ preventScroll: true });
  };

  pointer.addEventListener("pointerdown", startDrag);
  pointer.addEventListener("pointermove", (event) => {
    if (!edpiSpectrumDrag.active || edpiSpectrumDrag.setup !== setup || event.pointerId !== edpiSpectrumDrag.pointerId) return;
    event.preventDefault();
    applyEdpiSpectrumPointerFromClientX(event.clientX, setup);
  });
  pointer.addEventListener("pointerup", stopDrag);
  pointer.addEventListener("pointercancel", stopDrag);

  pointer.addEventListener("keydown", (event) => {
    if (setup === "b" && !isEdpiCompareMode()) return;
    if (!canDrag()) return;
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      nudgeEdpiSpectrum(-step, setup);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      nudgeEdpiSpectrum(step, setup);
    } else if (event.key === "Home") {
      event.preventDefault();
      setEdpiFromSpectrumValue(0, setup);
    } else if (event.key === "End") {
      const bounds = getEdpiSpectrumBounds(resolveEdpiGameInput());
      if (bounds) setEdpiFromSpectrumValue(bounds.maxEdpi, setup);
    }
  });
}

function initEdpiSpectrumDrag() {
  const container = document.querySelector("#edpi-calculator-tab .spectrum-container");
  const pointerA = elements["spectrum-pointer"] || document.getElementById("spectrum-pointer");
  const pointerB = elements["spectrum-pointer-b"] || document.getElementById("spectrum-pointer-b");
  if (!container || !pointerA || initEdpiSpectrumDrag._init) return;
  initEdpiSpectrumDrag._init = true;

  pointerA.setAttribute("role", "slider");
  pointerA.setAttribute("aria-label", "eDPI setup A");
  pointerA.setAttribute("aria-valuemin", "0");
  pointerA.tabIndex = 0;
  bindEdpiSpectrumPointer(pointerA, "a");

  if (pointerB) {
    pointerB.setAttribute("role", "slider");
    pointerB.setAttribute("aria-label", "eDPI setup B");
    pointerB.setAttribute("aria-valuemin", "0");
    bindEdpiSpectrumPointer(pointerB, "b");
  }
}

function paintEdpiSpectrumPointer(pointer, edpi, bounds, color, { dragging = false, defaultColor = "white" } = {}) {
  if (!pointer) return;
  if (!bounds) {
    if (!dragging) pointer.style.left = "0%";
    pointer.style.backgroundColor = defaultColor;
    pointer.style.boxShadow = "none";
    pointer.setAttribute("aria-valuenow", "0");
    pointer.setAttribute("aria-disabled", "true");
    return;
  }

  const safeEdpi = Number.isFinite(edpi) ? edpi : 0;
  const percent = edpiToSpectrumPercent(safeEdpi, bounds);
  if (!dragging) pointer.style.left = `${percent}%`;
  if (!Number.isFinite(edpi) || edpi <= 0) {
    pointer.style.backgroundColor = defaultColor;
    pointer.style.boxShadow = "none";
  } else {
    pointer.style.backgroundColor = color;
    pointer.style.boxShadow = dragging ? "none" : `0 0 1rem ${color}`;
  }
  pointer.setAttribute("aria-valuenow", String(safeEdpi));
  pointer.setAttribute("aria-valuetext", `${safeEdpi} eDPI`);
  pointer.setAttribute("aria-valuemax", String(bounds.maxEdpi));
  pointer.setAttribute("aria-disabled", "false");
}

function updateEdpiCompareSide(gameVal, bounds) {
  const compare = isEdpiCompareMode();
  const { dpi: dpiInput, sens: sensInput, pointer, rank, value } = getEdpiSetupElements("b");
  const colB = document.querySelector('#edpi-calculator-tab .edpi-value-col[data-edpi-col="b"]');
  const valuesSep = document.querySelector('#edpi-calculator-tab .edpi-value-col[data-edpi-col="sep"]');
  const gap = elements["edpi-compare-gap"] || document.getElementById("edpi-compare-gap");
  const defaultColor = "white";

  if (!compare) {
    if (pointer) {
      pointer.hidden = true;
      pointer.setAttribute("aria-hidden", "true");
    }
    if (colB) colB.hidden = true;
    if (valuesSep) valuesSep.hidden = true;
    if (rank) {
      rank.style.opacity = "0";
      rank.textContent = "";
    }
    if (value) {
      value.textContent = "";
    }
    if (gap) {
      gap.hidden = true;
      toggleVisibility(gap, false);
    }
    return;
  }

  const dpiVal = dpiInput?.value || "";
  const sensVal = sensInput?.value || "";
  const rawEdpi = parseFloat(dpiVal) * parseFloat(String(sensVal).replace(",", "."));
  const edpi = Math.round(rawEdpi);
  const valid = Boolean(gameVal && bounds && Number.isFinite(edpi) && edpi > 0);
  const draggingB = edpiSpectrumDrag.active && edpiSpectrumDrag.setup === "b";

  if (pointer) {
    pointer.hidden = false;
    pointer.setAttribute("aria-hidden", "false");
  }
  if (colB) colB.hidden = false;
  if (valuesSep) valuesSep.hidden = false;

  if (!valid) {
    if (value) {
      value.textContent = "0";
    }
    if (rank) {
      rank.style.opacity = "0";
      rank.textContent = "";
    }
    paintEdpiSpectrumPointer(pointer, 0, bounds, defaultColor, { dragging: draggingB, defaultColor });
    if (gap) {
      gap.hidden = true;
      gap.textContent = "";
      toggleVisibility(gap, false);
    }
    return;
  }

  const spectrumStyle = getEdpiSpectrumTierStyle(edpi, bounds);
  if (value) {
    value.textContent = String(edpi);
  }
  if (rank) {
    rank.innerText = spectrumStyle.label;
    rank.style.color = spectrumStyle.color;
    rank.style.opacity = "1";
  }
  paintEdpiSpectrumPointer(pointer, edpi, bounds, spectrumStyle.color, { dragging: draggingB, defaultColor });

  const sensA = parseFloat(String(elements["edpi-sens"]?.value || "").replace(",", "."));
  const dpiA = parseFloat(elements["edpi-dpi"]?.value);
  const sensB = parseFloat(String(sensVal).replace(",", "."));
  const dpiB = parseFloat(dpiVal);
  const cmA = calculateCm360Value(sensA, dpiA, gameVal);
  const cmB = calculateCm360Value(sensB, dpiB, gameVal);
  if (gap && cmA != null && cmB != null && Number.isFinite(cmA) && Number.isFinite(cmB) && cmA > 0 && cmB > 0) {
    const unit = getDistance360Unit();
    const deltaCm = Math.abs(cmA - cmB);
    const delta = unit === "in" ? deltaCm / CM360_INCH_TO_CM : deltaCm;
    gap.textContent = `Δ ${delta.toFixed(3)} ${unit}/360`;
    gap.hidden = false;
    toggleVisibility(gap, true);
  } else if (gap) {
    gap.hidden = true;
    gap.textContent = "";
    toggleVisibility(gap, false);
  }
}

function updateEDPI() {
  const dpiVal = elements["edpi-dpi"].value,
    sensVal = elements["edpi-sens"].value,
    gameVal = resolveEdpiGameInput(),
    pointer = elements["spectrum-pointer"],
    rankLabel = elements["edpi-rank"],
    copyBtn = document.getElementById("edpi-copy"),
    shareBtn = document.getElementById("edpi-share-btn"),
    defaultColor = "white";

  const clearBtn = document.getElementById("edpi-game-clear");

  if (clearBtn) clearBtn.style.display = gameVal ? "flex" : "none";

  const rawEdpi = parseFloat(dpiVal) * parseFloat(sensVal.replace(",", "."));
  const edpi = Math.round(rawEdpi);
  const draggingA = edpiSpectrumDrag.active && edpiSpectrumDrag.setup === "a";

  toggleEDPIResetButton();

  if (!gameVal || isNaN(edpi) || edpi === 0) {
    setEdpiValueDisplay("0");
    setEdpiCm360Display(parseFloat(sensVal.replace(",", ".")), parseFloat(dpiVal), gameVal);
    if (rankLabel) rankLabel.style.opacity = "0";
    const dpiReady = Number.isFinite(parseFloat(dpiVal)) && parseFloat(dpiVal) > 0;
    const boundsReady = gameVal && dpiReady ? getEdpiSpectrumBounds(gameVal) : null;
    updateEdpiSpectrumRecommended(boundsReady);
    paintEdpiSpectrumPointer(pointer, 0, boundsReady, defaultColor, { dragging: draggingA, defaultColor });
    updateEdpiCompareSide(gameVal, boundsReady);
    toggleVisibility(copyBtn, false);
    toggleVisibility(shareBtn, false);
    syncTabActionMenuStateByWrapId("edpi-action-menu-wrap");
    return;
  }

  setEdpiValueDisplay(edpi);
  const sensNum = parseFloat(sensVal.replace(",", "."));
  const dpiNum = parseFloat(dpiVal);
  setEdpiCm360Display(sensNum, dpiNum, gameVal);
  toggleVisibility(copyBtn, edpi !== 0);
  toggleVisibility(shareBtn, edpi !== 0);
  syncTabActionMenuStateByWrapId("edpi-action-menu-wrap");

  let color, label;
  const bounds = getEdpiSpectrumBounds(gameVal);
  if (!bounds) {
    updateEdpiSpectrumRecommended(null);
    if (rankLabel) rankLabel.style.opacity = "0";
    paintEdpiSpectrumPointer(pointer, 0, null, defaultColor, { dragging: draggingA, defaultColor });
    updateEdpiCompareSide(gameVal, null);
    toggleProfileSensConvButtons();
    updateGameInfoPanelVisibility();
    syncTabActionMenuStateByWrapId("edpi-action-menu-wrap");
    return;
  }

  updateEdpiSpectrumRecommended(bounds);

  const spectrumStyle = getEdpiSpectrumTierStyle(edpi, bounds);
  label = spectrumStyle.label;
  color = spectrumStyle.color;

  if (edpi > 0 && gameVal && !profileEdpiStatsPaused) {
    localStorage.setItem("lastEdpiCalc", edpi);
    localStorage.setItem("lastEdpiSens", sensVal);
    localStorage.setItem("lastEdpiDpi", dpiVal);
    localStorage.setItem("lastEdpiColor", color);
    localStorage.setItem("lastEdpiGame", gameVal);

    const pEdpi = document.getElementById("last-edpi-calc");
    const pGame = document.getElementById("profile-edpi-game");
    const pSens = document.getElementById("profile-edpi-sens");
    const pDpi = document.getElementById("profile-edpi-dpi");
    const pCm = document.getElementById("profile-edpi-cm");
    const pDot = document.getElementById("profile-edpi-status-dot");

    if (pEdpi) pEdpi.innerText = edpi;
    if (pGame) pGame.innerText = getGameDisplayName(gameVal);
    if (pSens) pSens.innerText = sensVal;
    if (pDpi) pDpi.innerText = dpiVal;
    const cmVal = calculateCm360Value(sensNum, dpiNum, gameVal);
    if (pCm) pCm.textContent = formatDistance360Short(sensNum, dpiNum, gameVal);
    if (pDot) {
      pDot.style.display = "block";
      pDot.style.backgroundColor = color;
    }
    if (cmVal != null) localStorage.setItem("lastEdpiCm", String(cmVal));
  }

  toggleProfileSensConvButtons();
  updateGameInfoPanelVisibility();

  paintEdpiSpectrumPointer(pointer, edpi, bounds, color, { dragging: draggingA, defaultColor });
  if (rankLabel) {
    rankLabel.innerText = label;
    rankLabel.style.color = color;
    rankLabel.style.opacity = "1";
  }
  updateEdpiCompareSide(gameVal, bounds);
}

function hasProfileStatValue(el) {
  const val = el?.innerText?.trim() ?? "";
  return val !== "" && val !== "0.00" && val !== "0" && val !== "-";
}

function updateGameInfoPanelVisibility() {
  const sensInfo = document.getElementById("sens-game-info");
  const sensVal = document.getElementById("last-sens-conv");
  if (sensInfo) {
    sensInfo.classList.toggle("is-empty", !hasProfileStatValue(sensVal));
  }

  const edpiInfo = document.getElementById("edpi-game-info");
  const edpiVal = document.getElementById("last-edpi-calc");
  if (edpiInfo) {
    edpiInfo.classList.toggle("is-empty", !hasProfileStatValue(edpiVal));
  }
}

function isMobileViewport() {
  return window.matchMedia("(max-width: 768px)").matches;
}

const trainerViewport = {
  node: null,
  anchor: null,
  wasMobile: null,
};

function syncAimTrainerForViewport() {
  const mobile = isMobileViewport();
  if (mobile === trainerViewport.wasMobile) return;

  if (mobile) {
    const node = document.getElementById("aim-training-tab");
    if (node) {
      trainerViewport.anchor = document.createComment("aim-training-tab-anchor");
      node.parentNode.insertBefore(trainerViewport.anchor, node);
      trainerViewport.node = node.parentNode.removeChild(node);
    }
  } else {
    if (trainerViewport.node && trainerViewport.anchor && trainerViewport.anchor.parentNode) {
      trainerViewport.anchor.parentNode.insertBefore(trainerViewport.node, trainerViewport.anchor);
      trainerViewport.anchor.parentNode.removeChild(trainerViewport.anchor);
      trainerViewport.node = null;
      trainerViewport.anchor = null;
    }
  }
  trainerViewport.wasMobile = mobile;
}

const LINEUP_TAB_ENABLED = true;
const MISC_TAB_ENABLED = true;

const miscLoaderState = {
  crosshairConverterPromise: null,
};

function ensureCrosshairConverterLoaded() {
  if (typeof window.initCrosshairConverterTab === "function") return Promise.resolve();
  if (!miscLoaderState.crosshairConverterPromise) {
    miscLoaderState.crosshairConverterPromise = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./tools/crosshair-converter.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load tools/crosshair-converter.js"));
      document.head.appendChild(script);
    });
  }
  return miscLoaderState.crosshairConverterPromise;
}

const TAB_SLUGS = {
  "home-tab": "home",
  "download-tab": "download",
  "sensitivity-converter-tab": "sensitivity-converter",
  "edpi-calculator-tab": "edpi-calculator",
  "crosshair-converter-tab": "crosshair-converter",
  "settings-tab": "settings",
  "stats-tab": "stats",
  "profile-tab": "profile",
  "lineup-tab": "lineups",
  "aim-training-tab": "aim-training",
  "keybinds-tab": "keybinds",
  "updates-tab": "updates",
  "privacy-policy-tab": "privacy-policy",
  "terms-of-service-tab": "terms-of-service",
  "credit-tab": "credit",
};
const SLUG_TO_TAB = Object.fromEntries(Object.entries(TAB_SLUGS).map(([tabId, slug]) => [slug, tabId]));
const DEFAULT_TAB_ID = "home-tab";
const routeState = {
  isInitial: true,
};

function getAppBasePath() {
  const script = document.querySelector('script[src*="script.js"]');
  if (!script?.src) return "/";
  try {
    const { pathname } = new URL(script.src);
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
  if (!MISC_TAB_ENABLED && slug === TAB_SLUGS["crosshair-converter-tab"]) return DEFAULT_TAB_ID;
  return SLUG_TO_TAB[slug] || DEFAULT_TAB_ID;
}

function getCurrentTabId() {
  for (const tabId of Object.keys(TAB_SLUGS)) {
    const section = document.getElementById(tabId);
    if (isSectionActive(section)) return tabId;
  }
  return DEFAULT_TAB_ID;
}

function syncUrlToTab(id, { replace = false, keepSearch = false } = {}) {
  if (!(id in TAB_SLUGS)) return;
  const slug = TAB_SLUGS[id];

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
  getTabSwitchUi();
  switchTab(null, getTabIdFromPath(), { updateHistory: false });

  window.addEventListener("popstate", () => {
    switchTab(null, getTabIdFromPath(), { updateHistory: false });
  });
}

const FOOTER_TAB_IDS = new Set(["keybinds-tab", "updates-tab", "privacy-policy-tab", "terms-of-service-tab", "credit-tab"]);

const MISC_TAB_IDS = new Set(["sensitivity-converter-tab", "edpi-calculator-tab", "aim-training-tab", "crosshair-converter-tab", "lineup-tab", "stats-tab"]);

const MORE_HOTKEY_TAB_ORDER = ["keybinds-tab", "updates-tab", "privacy-policy-tab", "terms-of-service-tab", "credit-tab"];

const MISC_HOTKEY_TAB_ORDER = ["sensitivity-converter-tab", "edpi-calculator-tab", "crosshair-converter-tab", "lineup-tab", "aim-training-tab", "stats-tab"];

const TOOLS_TAB_LABELS = {
  "sensitivity-converter-tab": "Sensitivity",
  "edpi-calculator-tab": "eDPI",
  "crosshair-converter-tab": "Crosshair",
  "lineup-tab": "Lineups",
  "aim-training-tab": "Aim Trainer",
  "stats-tab": "Aim stats",
};

const MAIN_TAB_HOTKEYS = {
  1: "home-tab",
  3: "profile-tab",
  4: "settings-tab",
};

function getMiscHotkeyTabOrder() {
  if (!MISC_TAB_ENABLED) return [];
  return MISC_HOTKEY_TAB_ORDER.filter((id) => {
    if (id === "lineup-tab" && !LINEUP_TAB_ENABLED) return false;
    if (id === "crosshair-converter-tab" && !MISC_TAB_ENABLED) return false;
    if (id === "aim-training-tab" && isMobileViewport()) return false;
    return true;
  });
}

function getTabIdForNumberHotkey(key) {
  return MAIN_TAB_HOTKEYS[key] || null;
}

const FOOTER_BUTTON_IDS = {
  "keybinds-tab": "keybinds-button",
  "updates-tab": "updates-button",
  "privacy-policy-tab": "privacy-policy-button",
  "terms-of-service-tab": "terms-of-service-button",
  "credit-tab": "credit-button",
};

const NAV_BUTTON_IDS = {
  "home-tab": "home-button",
  "download-tab": "download-button",
  "profile-tab": "profile-button",
  "settings-tab": "settings-button",
};

const LOGO_CYCLE_TAB_IDS = ["home-tab", "download-tab", "sensitivity-converter-tab", "edpi-calculator-tab", "crosshair-converter-tab", "settings-tab", "stats-tab", "profile-tab", "aim-training-tab", "lineup-tab", "keybinds-tab", "updates-tab", "privacy-policy-tab", "terms-of-service-tab", "credit-tab"];

function getLogoCycleTabIds() {
  return LOGO_CYCLE_TAB_IDS.filter((id) => {
    if (id === "download-tab" && window.MorningRoastDesktopDownload?.isDesktopRuntime?.()) return false;
    if (id === "lineup-tab" && !LINEUP_TAB_ENABLED) return false;
    if (id === "crosshair-converter-tab" && !MISC_TAB_ENABLED) return false;
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
const lineupSession = {
  activeGame: null,
};
const LINEUP_SIDE_STORAGE_KEY = "lineupSide";
const LINEUP_DIFFICULTY_STORAGE_KEY = "lineupDifficulty";
const LINEUP_FAVORITES_STORAGE_KEY = "lineupFavorites";
const LINEUP_FAVORITES_ONLY_STORAGE_KEY = "lineupFavoritesOnly";
const LINEUP_SEARCH_STORAGE_PREFIX = "lineupSearch:";
const lineupMapFilterByGame = new Map();
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
    label: "Counter-Strike 2",
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
const LINEUP_VALORANT_SIDE_ICONS = {
  attacker: "assets/lineup-utilities/valorant/a.svg",
  defender: "assets/lineup-utilities/valorant/d.svg",
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

/** Valorant agent/ability icons from tools/valorant-lineup-icons.js (valorant-api.com). */
const LINEUP_VALORANT_AGENT_ICONS = globalThis.LINEUP_VALORANT_AGENT_ICONS || {};
const LINEUP_VALORANT_AGENT_LABELS = globalThis.LINEUP_VALORANT_AGENT_LABELS || {};
const LINEUP_VALORANT_AGENT_SLUG_ALIASES = {
  "kay-o": "kayo",
  "kay/o": "kayo",
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
const LINEUP_VALORANT_UTILITY_DESCRIPTIONS = {
  smoke: "Creates a smoke cloud that blocks vision. Use it to take space safely, isolate angles, execute onto a site, or delay pushes while your team moves.",
  flash: "Blinds enemies who look at the burst. Pop it before peeking to win entry duels, clear common off-angles, or set up a coordinated site take.",
  molly: "Creates a fire zone that damages over time and denies space. Use it to clear corners, stop plants or defuses, stall retakes, or force enemies out of cover.",
  recon: "Reveals enemy positions through walls or along a path. Use it to gather info before committing, check common holds, or set up picks for your team.",
};
const LINEUP_EMBED_BADGE_CLICK_SELECTOR =
  ".lineup-video-agent-badge[data-lineup-agent-info], .lineup-video-ability-badge[data-lineup-ability-agent], .lineup-video-utility-badge[data-lineup-cs2-utility], .lineup-video-utility-badge[data-lineup-valorant-utility]";

function isLineupEmbedBadgeClickTarget(target) {
  return Boolean(target?.closest?.(LINEUP_EMBED_BADGE_CLICK_SELECTOR));
}

/** Valorant agent ability icons for lineup embed badges (agent:ability slug). */
const LINEUP_VALORANT_ABILITY_ALIASES = globalThis.LINEUP_VALORANT_ABILITY_ALIASES || {
  "snare-trap": "chokehold",
  trap: "chokehold",
};
const LINEUP_VALORANT_ABILITY_ICONS = globalThis.LINEUP_VALORANT_ABILITY_ICONS || {};

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

/** Card poster URLs from tools/lineup-map-posters.js (Valorant splash + CS2 thumbs). */
const LINEUP_MAP_POSTERS = globalThis.LINEUP_MAP_POSTERS || {};
const LINEUP_LOCAL_MAP_POSTERS = Object.fromEntries(
  Object.entries(globalThis.LINEUP_LOCAL_MAP_POSTERS || { valorant: ["pearl"], cs2: ["mirage"] }).map(([game, slugs]) => [
    game,
    new Set((slugs || []).map((slug) => String(slug).toLowerCase())),
  ])
);

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

function getLineupMapPosterUrl(game, mapSlug) {
  const slug = String(mapSlug || "").toLowerCase();
  if (!game || !slug) return "";
  return LINEUP_MAP_POSTERS[game]?.[slug] || "";
}

function getLineupVideoPosterAssetPath(card) {
  const direct = card?.dataset.lineupPosterUrl?.trim();
  if (direct) return resolveAppAssetUrl(direct);

  const game = getLineupGameForCard(card);
  const map = (card?.dataset.lineupMap || "").toLowerCase();
  if (game && map) {
    if (LINEUP_LOCAL_MAP_POSTERS[game]?.has(map)) {
      return resolveAppAssetUrl(`assets/lineups/${game}/${map}/thumbnail.webp`);
    }
    const remotePoster = getLineupMapPosterUrl(game, map);
    if (remotePoster) return remotePoster;
    return resolveAppAssetUrl(`assets/lineups/${game}/${map}/thumbnail.webp`);
  }

  const videoUrl = getLineupVideoAssetPath(card);
  if (!videoUrl) return "";
  return videoUrl.replace(/\.(mp4|webm|mov)(\?.*)?$/i, "-poster.jpg$2");
}

const LINEUP_VIDEO_POSTER_ROOT_MARGIN = "200px 0px";
const LINEUP_VIDEO_SPEED_STORAGE_KEY = "lineup-video-speed";
const LINEUP_VIDEO_SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

const lineupVideoLoader = {
  observer: null,
  observed: new WeakSet(),
};

const lineupVideoModalState = {
  baseUrl: "",
  posterUrl: "",
  speed: 1,
  shouldAutoplay: false,
  loadToken: 0,
  openedAt: 0,
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

function loadLineupVideoModalSource(url, { posterUrl = "", resumeTime = 0, autoplay = true } = {}) {
  const player = document.getElementById("lineup-video-modal-player");
  if (!player || !url) return false;

  const loadToken = ++lineupVideoModalState.loadToken;
  lineupVideoModalState.shouldAutoplay = autoplay;
  player.onerror = null;
  player.hidden = false;
  player.pause();
  player.removeAttribute("src");
  player.load();

  if (posterUrl) {
    player.poster = posterUrl;
  } else {
    player.removeAttribute("poster");
  }

  player.playbackRate = lineupVideoModalState.speed;
  syncLineupVideoScrubPlayer();

  const bootPlayback = () => {
    if (loadToken !== lineupVideoModalState.loadToken) return;
    attemptLineupVideoAutoplay(player, { resumeTime });
    syncLineupVideoBufferUi();
  };

  const onReady = () => {
    if (loadToken !== lineupVideoModalState.loadToken) return;
    bootPlayback();
  };

  player.addEventListener("loadedmetadata", onReady, { once: true });
  player.addEventListener("canplay", onReady, { once: true });

  player.src = url;
  player.load();
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

  let hideTimer = 0;

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
  video.addEventListener("progress", () => startLineupVideoProgressLoop());
  video.addEventListener("loadedmetadata", () => startLineupVideoProgressLoop());
  video.addEventListener("loadeddata", () => startLineupVideoProgressLoop());
}

function ensureLineupVideoPosterElement(embed) {
  let poster = embed.querySelector("img.lineup-video-embed-poster");
  if (!poster) {
    poster = document.createElement("img");
    poster.className = "lineup-video-embed-poster";
    poster.alt = "";
    poster.decoding = "async";
    poster.loading = "lazy";
    embed.prepend(poster);
  }
  embed.querySelector("video.lineup-video-preview")?.remove();
  return poster;
}

function resetLineupVideoPosterElement(poster) {
  if (!poster) return;
  poster.classList.remove("is-loaded", "is-error");
  poster.removeAttribute("src");
  delete poster.dataset.loadedSrc;
  delete poster.dataset.failedSrc;
}

function loadLineupVideoPoster(card, { force = false } = {}) {
  const embed = card?.querySelector(".lineup-video-embed");
  if (!embed || (!force && embed.dataset.posterLoading === "1")) return;

  const posterUrl = getLineupVideoPosterAssetPath(card);
  const videoUrl = getLineupVideoUrl(card);
  const poster = ensureLineupVideoPosterElement(embed);

  card.classList.toggle("lineup-video-card--no-source", !videoUrl);

  if (!videoUrl) {
    resetLineupVideoPosterElement(poster);
    delete poster.dataset.loadedSrc;
    embed.dataset.posterLoaded = "1";
    embed.dataset.posterLoading = "0";
    return;
  }

  if (!posterUrl) {
    resetLineupVideoPosterElement(poster);
    delete poster.dataset.loadedSrc;
    embed.dataset.posterLoaded = "1";
    embed.dataset.posterLoading = "0";
    return;
  }

  const absolutePosterUrl = new URL(posterUrl, window.location.href).href;
  if (!force && poster.dataset.loadedSrc === absolutePosterUrl && poster.classList.contains("is-loaded")) {
    embed.dataset.posterLoaded = "1";
    embed.dataset.posterLoading = "0";
    return;
  }

  if (!force && embed.dataset.posterLoaded === "1" && poster.classList.contains("is-error") && poster.dataset.failedSrc === absolutePosterUrl) {
    return;
  }

  embed.dataset.posterLoading = "1";
  poster.classList.remove("is-loaded", "is-error");

  const finish = () => {
    embed.dataset.posterLoading = "0";
    embed.dataset.posterLoaded = "1";
  };

  poster.onload = () => {
    poster.dataset.loadedSrc = absolutePosterUrl;
    delete poster.dataset.failedSrc;
    poster.classList.add("is-loaded");
    poster.classList.remove("is-error");
    finish();
  };

  poster.onerror = () => {
    poster.dataset.failedSrc = absolutePosterUrl;
    delete poster.dataset.loadedSrc;
    poster.classList.add("is-error");
    poster.classList.remove("is-loaded");
    poster.removeAttribute("src");
    finish();
  };

  if (poster.getAttribute("src") !== posterUrl) {
    poster.src = posterUrl;
  } else if (poster.complete && poster.naturalWidth > 0) {
    poster.onload?.();
  }
}

function observeLineupVideoCard(card) {
  if (!card || lineupVideoLoader.observed.has(card)) return;
  initLineupVideoLazyLoader();
  lineupVideoLoader.observed.add(card);
  lineupVideoLoader.observer?.observe(card);
}

function unobserveLineupVideoCard(card) {
  lineupVideoLoader.observer?.unobserve(card);
  lineupVideoLoader.observed.delete(card);
}

function initLineupVideoLazyLoader() {
  if (lineupVideoLoader.observer) return;

  if (typeof IntersectionObserver === "undefined") {
    lineupVideoLoader.observer = null;
    return;
  }

  lineupVideoLoader.observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const card = entry.target;
        if (!(card instanceof HTMLElement) || !card.classList.contains("lineup-video-card")) return;

        if (entry.isIntersecting) {
          loadLineupVideoPoster(card);
        }
      });
    },
    { root: null, rootMargin: LINEUP_VIDEO_POSTER_ROOT_MARGIN, threshold: 0.01 },
  );
}

function refreshLineupVideoCards(root = document) {
  const scope = root?.querySelectorAll ? root : document;

  scope.querySelectorAll(".lineup-video-card").forEach((card) => {
    const embed = card.querySelector(".lineup-video-embed");
    if (!embed) return;

    ensureLineupVideoPosterElement(embed);
    embed.querySelector(".lineup-video-embed-progress")?.remove();
    card.classList.toggle("lineup-video-card--no-source", !getLineupVideoUrl(card));

    if (card.hidden || card.classList.contains("hidden")) {
      unobserveLineupVideoCard(card);
      return;
    }

    observeLineupVideoCard(card);
    loadLineupVideoPoster(card);
  });

  enhanceLineupVideoEmbeds(scope);

  enhanceLineupVideoCardFoots(scope);
  scope.querySelectorAll(".lineup-video-card").forEach((card) => {
    ensureLineupVideoFavoriteButton(card);
  });
  initLineupCardTilt(scope);
}

function applyLineupVideoSources(root = document) {
  refreshLineupVideoCards(root);
}

function getLineupVideoTitle(card) {
  return card.querySelector(".lineup-video-title")?.textContent?.trim() || "";
}

function lineupAgentToSlug(name) {
  return name.trim().toLowerCase().replace(/\//g, "").replace(/\s+/g, "");
}

function lineupValorantAgentLabel(slug) {
  if (LINEUP_VALORANT_AGENT_LABELS[slug]) return LINEUP_VALORANT_AGENT_LABELS[slug];
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeLineupValorantAgentSlug(raw) {
  const slug = String(raw || "")
    .trim()
    .toLowerCase();
  if (!slug) return "";
  if (LINEUP_VALORANT_AGENT_SLUG_ALIASES[slug]) return LINEUP_VALORANT_AGENT_SLUG_ALIASES[slug];
  if (LINEUP_VALORANT_AGENT_ICONS[slug]) return slug;
  const compact = slug.replace(/-/g, "");
  if (LINEUP_VALORANT_AGENT_ICONS[compact]) return compact;
  for (const agentSlug of Object.keys(LINEUP_VALORANT_AGENT_ICONS)) {
    if (lineupValorantAgentLabel(agentSlug).toLowerCase().replace(/\s+/g, "-") === slug) return agentSlug;
  }
  return slug;
}

function normalizeLineupValorantAbilitySlug(raw) {
  const slug = String(raw || "")
    .trim()
    .toLowerCase();
  if (!slug) return "";
  return LINEUP_VALORANT_ABILITY_ALIASES[slug] || slug;
}

function slugifyLineupAbilityName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function getLineupValorantAgentDropdownOptions() {
  return Object.keys(LINEUP_VALORANT_AGENT_ICONS)
    .sort((a, b) => lineupValorantAgentLabel(a).localeCompare(lineupValorantAgentLabel(b)))
    .map((slug) => ({
      slug,
      label: lineupValorantAgentLabel(slug),
      icon: LINEUP_VALORANT_AGENT_ICONS[slug],
    }));
}

function renderLineupValorantAgentOptionIcon(slug) {
  const src = LINEUP_VALORANT_AGENT_ICONS[normalizeLineupValorantAgentSlug(slug)];
  if (!src) return "";
  return `<img class="game-option-icon lineup-agent-option-icon" src="${src}" alt="" width="18" height="18" decoding="async" loading="lazy" />`;
}

function renderLineupValorantAbilityOptionIcon(iconSrc) {
  if (!iconSrc) return `<i class="ri-flashlight-line pref-dropdown-option-icon" aria-hidden="true"></i>`;
  return `<img class="game-option-icon lineup-ability-option-icon" src="${iconSrc}" alt="" width="18" height="18" decoding="async" loading="lazy" />`;
}

function getLineupValorantAgentIconSrc(slug) {
  return LINEUP_VALORANT_AGENT_ICONS[normalizeLineupValorantAgentSlug(slug)] || "";
}

function getLineupValorantAbilityIconSrc(agentSlug, abilitySlug) {
  const agent = normalizeLineupValorantAgentSlug(agentSlug);
  const ability = normalizeLineupValorantAbilitySlug(abilitySlug);
  return LINEUP_VALORANT_ABILITY_ICONS[`${agent}:${ability}`]?.src || "";
}

function getLineupValorantAbilityDropdownOptionsFromStatic(agentSlug) {
  const normalizedAgent = normalizeLineupValorantAgentSlug(agentSlug);
  if (!normalizedAgent) return [];
  return Object.entries(LINEUP_VALORANT_ABILITY_ICONS)
    .filter(([key]) => key.startsWith(`${normalizedAgent}:`))
    .map(([key, entry]) => ({
      slug: key.split(":")[1],
      label: entry.label,
      icon: entry.src,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function fetchLineupValorantAbilityDropdownOptions(agentSlug) {
  const staticOptions = getLineupValorantAbilityDropdownOptionsFromStatic(agentSlug);
  if (staticOptions.length) return staticOptions;

  const normalizedAgent = normalizeLineupValorantAgentSlug(agentSlug);
  if (!normalizedAgent) return [];

  const bundle = await fetchValorantAgentBundle(normalizedAgent);
  if (!bundle?.abilities?.length) return [];

  return bundle.abilities
    .filter((ability) => ability.displayName && ability.displayIcon)
    .map((ability) => ({
      slug: slugifyLineupAbilityName(ability.displayName),
      label: ability.displayName,
      icon: ability.displayIcon,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function getLineupValorantAgentDropdownLabel(slug) {
  return lineupValorantAgentLabel(normalizeLineupValorantAgentSlug(slug));
}

async function getLineupValorantAbilityDropdownLabel(agentSlug, abilitySlug) {
  const normalizedAgent = normalizeLineupValorantAgentSlug(agentSlug);
  const normalizedAbility = normalizeLineupValorantAbilitySlug(abilitySlug);
  if (!normalizedAgent || !normalizedAbility) return "";

  const staticEntry = LINEUP_VALORANT_ABILITY_ICONS[`${normalizedAgent}:${normalizedAbility}`];
  if (staticEntry?.label) return staticEntry.label;

  const options = await fetchLineupValorantAbilityDropdownOptions(normalizedAgent);
  return options.find((entry) => entry.slug === normalizedAbility)?.label || normalizedAbility.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function getLineupValorantAgent(card) {
  const explicit = normalizeLineupValorantAgentSlug(card.dataset.lineupAgent);
  if (explicit) return explicit;

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

  if (iconTitle) attachUiTooltip(iconWrap, iconTitle);
}

function getLineupValorantAbilityInfo(card) {
  const agent = getLineupValorantAgent(card);
  if (!agent) return null;

  let ability = card.dataset.lineupAbility?.trim().toLowerCase();
  if (!ability) return null;

  ability = normalizeLineupValorantAbilitySlug(ability);
  const entry = LINEUP_VALORANT_ABILITY_ICONS[`${agent}:${ability}`];
  if (entry) return { agent, ability, ...entry };

  return {
    agent,
    ability,
    src: "",
    label: ability
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
    description: "",
  };
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

function openLineupValorantUtilityInfoPopover(card) {
  const utility = getLineupCardUtility(card);
  if (!utility) return;

  openLineupBadgeInfoOverlay();
  setLineupBadgeInfoOverlayContent({
    icon: getLineupUtilityIconSrc("valorant", utility, card) || "",
    title: getLineupUtilityLabel("valorant", utility, card),
    meta: "Utility type",
    body: LINEUP_VALORANT_UTILITY_DESCRIPTIONS[utility] || "Utility information is unavailable right now.",
  });
}

async function openLineupAgentInfoPopover(agentSlug) {
  const agent = normalizeLineupValorantAgentSlug(agentSlug);
  openLineupBadgeInfoOverlay();
  setLineupBadgeInfoOverlayContent({
    icon: getLineupValorantAgentIconSrc(agent) || "",
    title: lineupValorantAgentLabel(agent),
    meta: "Loading agent profile…",
    body: "",
  });

  const info = await getValorantAgentInfo(agent);
  if (!info) {
    setLineupBadgeInfoOverlayContent({
      icon: getLineupValorantAgentIconSrc(agent) || "",
      title: lineupValorantAgentLabel(agent),
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
  const agent = normalizeLineupValorantAgentSlug(agentSlug);
  const ability = normalizeLineupValorantAbilitySlug(abilitySlug);
  const staticEntry = LINEUP_VALORANT_ABILITY_ICONS[`${agent}:${ability}`];

  openLineupBadgeInfoOverlay();
  setLineupBadgeInfoOverlayContent({
    icon: staticEntry?.src || getLineupValorantAbilityIconSrc(agent, ability) || "",
    title: staticEntry?.label || abilitySlug,
    meta: staticEntry?.slot || "",
    body: staticEntry?.description || "",
  });

  if (staticEntry?.description) return;

  setLineupBadgeInfoOverlayContent({
    icon: staticEntry?.src || getLineupValorantAbilityIconSrc(agent, ability) || "",
    title: staticEntry?.label || abilitySlug,
    meta: "Loading ability details…",
    body: "",
  });

  const info = await getValorantAbilityInfo(agent, ability);
  if (!info) {
    setLineupBadgeInfoOverlayContent({
      icon: staticEntry?.src || getLineupValorantAbilityIconSrc(agent, ability) || "",
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

  const handleBadgeClick = (event) => {
    const cs2UtilityBtn = event.target.closest(".lineup-video-utility-badge[data-lineup-cs2-utility]");
    const valorantUtilityBtn = event.target.closest(".lineup-video-utility-badge[data-lineup-valorant-utility]");
    const agentBtn = event.target.closest(".lineup-video-agent-badge[data-lineup-agent-info]");
    const abilityBtn = event.target.closest(".lineup-video-ability-badge[data-lineup-ability-agent]");
    if (!cs2UtilityBtn && !valorantUtilityBtn && !agentBtn && !abilityBtn) return;

    event.preventDefault();
    event.stopPropagation();

    if (cs2UtilityBtn) {
      const card = cs2UtilityBtn.closest(".lineup-video-card");
      if (card) openLineupCs2UtilityInfoPopover(card);
      return;
    }

    if (valorantUtilityBtn) {
      const card = valorantUtilityBtn.closest(".lineup-video-card");
      if (card) openLineupValorantUtilityInfoPopover(card);
      return;
    }

    if (agentBtn) {
      openLineupAgentInfoPopover(agentBtn.dataset.lineupAgentInfo);
      return;
    }

    openLineupAbilityInfoPopover(abilityBtn.dataset.lineupAbilityAgent, abilityBtn.dataset.lineupAbilitySlug);
  };

  lineupTab?.addEventListener("click", handleBadgeClick, true);
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
  const agentSrc = agent ? getLineupValorantAgentIconSrc(agent) : "";
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
    if (abilityInfo.src) {
      badge.innerHTML = `<img src="${abilityInfo.src}" alt="" loading="lazy" decoding="async" />`;
    } else {
      badge.dataset.lineupAbilityPending = "1";
      badge.setAttribute("aria-busy", "true");
    }
    row.appendChild(badge);
  }
}

async function hydrateLineupValorantAbilityBadge(card) {
  if (getLineupGameForCard(card) !== "valorant") return;

  const abilityRaw = card.dataset.lineupAbility?.trim();
  if (!abilityRaw) return;

  const agent = getLineupValorantAgent(card);
  if (!agent) return;

  const embed = card.querySelector(".lineup-video-embed");
  if (!embed) return;

  const info = await getValorantAbilityInfo(agent, abilityRaw);
  if (!info?.icon) {
    embed.querySelector(".lineup-video-ability-badge[data-lineup-ability-pending]")?.remove();
    return;
  }

  const row = embed.querySelector(".lineup-video-embed-badges") || ensureLineupEmbedBadgeRow(embed);
  let badge = row.querySelector(".lineup-video-ability-badge");
  if (!badge) {
    badge = document.createElement("button");
    badge.type = "button";
    badge.className = "lineup-video-ability-badge";
    row.appendChild(badge);
  }

  badge.dataset.lineupAbilityAgent = agent;
  badge.dataset.lineupAbilitySlug = normalizeLineupValorantAbilitySlug(abilityRaw);
  badge.removeAttribute("aria-busy");
  delete badge.dataset.lineupAbilityPending;
  badge.setAttribute("aria-label", `About ${info.name}`);
  badge.innerHTML = `<img src="${info.icon}" alt="" loading="lazy" decoding="async" />`;
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
    attachUiTooltip(badge, label);
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

  if (badge && badge.tagName !== "BUTTON") {
    badge.remove();
    badge = null;
  }

  if (!badge) {
    badge = document.createElement("button");
    badge.type = "button";
    badge.className = "lineup-video-utility-badge";
    badge.setAttribute("aria-label", `About ${getLineupUtilityLabel(game, utility, card)}`);
    embed.appendChild(badge);
  }

  const label = getLineupUtilityLabel(game, utility, card);
  delete badge.dataset.lineupCs2Utility;
  badge.dataset.lineupValorantUtility = utility;
  badge.removeAttribute("aria-hidden");
  badge.setAttribute("aria-label", `About ${label}`);
  badge.innerHTML = `<img src="${src}" alt="" loading="lazy" decoding="async" />`;
  badge.classList.add("lineup-video-utility-badge--valorant");
  badge.classList.remove("lineup-video-utility-badge--cs2-t", "lineup-video-utility-badge--cs2-ct");
}

function isLineupCuratedGridCard(card) {
  const gridId = card.closest(".lineup-video-grid")?.id || "";
  return gridId === "lineup-valorant-grid" || gridId === "lineup-cs2-grid";
}

function ensureLineupVideoCardAuthor(card) {
  if (!isLineupCuratedGridCard(card)) return;

  const body = card.querySelector(".lineup-video-card-foot-body") || card.querySelector(".lineup-video-card-foot");
  if (!body) return;
  if (body.querySelector(".lineup-video-card-headline .lineup-community-author")) return;

  const title =
    body.querySelector(":scope > .lineup-video-title") || body.querySelector(".lineup-video-card-headline .lineup-video-title");
  if (!title) return;

  let headline = title.closest(".lineup-video-card-headline");
  if (!headline) {
    headline = document.createElement("div");
    headline.className = "lineup-video-card-headline";
    title.replaceWith(headline);
    headline.appendChild(title);
  }

  if (headline.querySelector(".lineup-community-author")) return;

  const sep = document.createElement("span");
  sep.className = "lineup-video-card-headline-sep";
  sep.setAttribute("aria-hidden", "true");
  headline.appendChild(sep);

  const author = document.createElement("p");
  author.className = "lineup-community-author";
  author.textContent = "By FuZiveer";
  headline.appendChild(author);
}

function applyLineupVideoCardBadges(card) {
  if (!card) return;
  renderLineupVideoAgentBadge(card);
  renderLineupVideoUtilityBadge(card);
  if (getLineupGameForCard(card) === "valorant" && card.dataset.lineupAbility?.trim()) {
    void hydrateLineupValorantAbilityBadge(card);
  }
}

function enhanceLineupVideoCardFoots(root = document) {
  root.querySelectorAll(".lineup-video-card").forEach((card) => {
    renderLineupVideoCardMapIcon(card);
    applyLineupVideoCardBadges(card);
    ensureLineupVideoCardAuthor(card);
  });
}

/** Mouse-follow 3D tilt (SCALE_X / SCALE_Y match the lineup card tilt demo). */
function initCardTilt(selector, { tiltXVar = "--card-tilt-x", tiltYVar = "--card-tilt-y", tiltingClass = "is-tilting" } = {}, root = document) {
  const SCALE_X = 2;
  const SCALE_Y = 3.5;
  const scope = root?.querySelectorAll ? root : document;

  scope.querySelectorAll(selector).forEach((card) => {
    if (!(card instanceof HTMLElement) || card.dataset.tiltBound === "1") return;
    card.dataset.tiltBound = "1";

    let mouseHover = false;
    let mousePosition = { x: 0, y: 0 };
    let cardSize = { width: 0, height: 0 };
    let currentX = 0;
    let currentY = 0;
    let targetX = 0;
    let targetY = 0;
    let animating = false;
    let lastTs = 0;

    const applyTilt = () => {
      card.style.setProperty(tiltXVar, `${currentX}deg`);
      card.style.setProperty(tiltYVar, `${currentY}deg`);
    };

    const measureCard = () => {
      const rect = card.getBoundingClientRect();
      cardSize = { width: rect.width, height: rect.height };
      return rect;
    };

    const updateTargets = () => {
      if (!mouseHover || prefersReducedUiMotion() || cardSize.width <= 0 || cardSize.height <= 0) {
        targetX = 0;
        targetY = 0;
        return;
      }
      const nx = (mousePosition.x / cardSize.width) * 2 - 1;
      const ny = (mousePosition.y / cardSize.height) * 2 - 1;
      targetY = nx * SCALE_X;
      targetX = -ny * SCALE_Y;
    };

    const tick = (ts) => {
      const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0.016;
      lastTs = ts;
      const follow = mouseHover ? 0.22 : 0.16;
      const t = 1 - Math.pow(1 - follow, dt * 60);
      currentX += (targetX - currentX) * t;
      currentY += (targetY - currentY) * t;

      if (Math.abs(currentX) < 0.01 && Math.abs(targetX) < 0.01) currentX = 0;
      if (Math.abs(currentY) < 0.01 && Math.abs(targetY) < 0.01) currentY = 0;

      applyTilt();

      if (Math.abs(currentX - targetX) > 0.01 || Math.abs(currentY - targetY) > 0.01 || Math.abs(currentX) > 0.01 || Math.abs(currentY) > 0.01) {
        requestAnimationFrame(tick);
      } else {
        currentX = targetX;
        currentY = targetY;
        applyTilt();
        animating = false;
      }
    };

    const schedule = () => {
      if (animating) return;
      animating = true;
      lastTs = 0;
      requestAnimationFrame(tick);
    };

    card.addEventListener("pointerenter", (event) => {
      if (prefersReducedUiMotion()) return;
      mouseHover = true;
      card.classList.add(tiltingClass);
      const rect = measureCard();
      mousePosition = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      updateTargets();
      schedule();
    });

    card.addEventListener("pointermove", (event) => {
      if (!mouseHover || prefersReducedUiMotion()) return;
      const rect = measureCard();
      mousePosition = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      updateTargets();
      schedule();
    });

    card.addEventListener("pointerleave", () => {
      mouseHover = false;
      card.classList.remove(tiltingClass);
      targetX = 0;
      targetY = 0;
      schedule();
    });
  });
}

function initLineupCardTilt(root = document) {
  initCardTilt(".lineup-video-card", { tiltXVar: "--lineup-tilt-x", tiltYVar: "--lineup-tilt-y" }, root);
}

function initHomeFeatureCardTilt(root = document) {
  initCardTilt(".home-feature-card", { tiltXVar: "--home-tilt-x", tiltYVar: "--home-tilt-y" }, root);
}

function syncLineupSideFilterIcons(game = getActiveLineupGame()) {
  const sideIcons = game === "cs2" ? LINEUP_CS2_SIDE_ICONS : game === "valorant" ? LINEUP_VALORANT_SIDE_ICONS : null;
  document.querySelectorAll(".lineup-side-icon[data-lineup-side-icon]").forEach((icon) => {
    const side = icon.dataset.lineupSideIcon;
    const path = sideIcons?.[side];
    if (path) icon.src = resolveAppAssetUrl(path);
    const inDuo = Boolean(icon.closest(".lineup-side-icon-duo"));
    if (!inDuo) icon.hidden = !path;
  });
  document.querySelectorAll(".lineup-side-icon-duo").forEach((duo) => {
    duo.hidden = !sideIcons;
  });
  const selector = document.getElementById("lineup-side-selector");
  selector?.classList.toggle("lineup-side-selector--cs2", game === "cs2");
  selector?.classList.toggle("lineup-side-selector--valorant", game === "valorant");
}

function getLineupGameForCard(card) {
  const grid = card.closest(".lineup-video-grid");
  if (grid?.id === "lineup-cs2-grid" || grid?.id === "lineup-cs2-community-grid") return "cs2";
  if (grid?.id === "lineup-valorant-grid" || grid?.id === "lineup-valorant-community-grid") return "valorant";
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
  const query = getLineupSearchQuery(game).trim();
  if (!query) return;

  const filters = getLineupFilters(game);

  getLineupGridsForGame(game).forEach((grid) => {
    grid.querySelectorAll(".lineup-video-card").forEach((card) => {
      if (!lineupCardMatchesFilters(card, filters)) return;
      const title = card.querySelector(".lineup-video-title");
      if (title) highlightSearchMatches(title, query);
    });
  });
}

function getActiveLineupGame() {
  return LINEUP_GAMES.has(lineupSession.activeGame) ? lineupSession.activeGame : null;
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
  const stored = lineupMapFilterByGame.get(game) || "all";
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

  const map = getLineupMapFilter(game);
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

function isFocusInsideDropdownList(list) {
  const active = document.activeElement;
  return !!(list && active instanceof Node && list.contains(active));
}

function resetGameSearchDropdownOptions(list, optionSelector = ".pref-dropdown-option") {
  if (!list) return;
  list.querySelectorAll(optionSelector).forEach((opt) => {
    opt.style.display = "";
    opt.classList.remove("hover");
  });
}

function restoreGameSearchDropdown(idPrefix) {
  const list = document.getElementById(`${idPrefix}-list`);
  const input = document.getElementById(`${idPrefix}-search`);
  if (!input) return;

  resetGameSearchDropdownOptions(list);

  if (idPrefix === "profile-game") {
    ensureProfileGameValue();
    aimTrainer.displayResultsOnProfile();
    syncGameTriggerIcon(idPrefix);
    return;
  }

  if (idPrefix === "trainer-game") {
    const game = MorningRoastGames.resolveGameName(aimTrainer.game || localStorage.getItem("aimGame") || "") || "";
    input.dataset.lastValid = game;
    input.value = game ? getGameDisplayName(game) : "";
    syncGameClearButton(`${idPrefix}-search`, `${idPrefix}-clear`);
    syncGameTriggerIcon(idPrefix);
    return;
  }

  const resolved = getCommittedGameFromInput(input) || resolveStoredGameName(input.dataset.lastValid);
  if (resolved) {
    input.dataset.lastValid = resolved;
    input.value = getGameDisplayName(resolved);
  } else {
    const fallback = input.dataset.lastValid ? getGameDisplayName(input.dataset.lastValid) : "";
    input.value = fallback;
  }
  syncGameClearButton(`${idPrefix}-search`, `${idPrefix}-clear`);

  if (idPrefix === "edpi-game") {
    updateEDPI();
  } else {
    updateConversion();
    updateGameInfoPanelVisibility();
    toggleProfileSensConvButtons();
  }
  syncGameTriggerIcon(idPrefix);
}

function dismissGameSearchDropdown(idPrefix, { force = false } = {}) {
  const list = document.getElementById(`${idPrefix}-list`);
  const input = document.getElementById(`${idPrefix}-search`);
  if (!list || !input) return;
  if (!force && input === document.activeElement) return;

  hideGameDropdownList(idPrefix);
  restoreGameSearchDropdown(idPrefix);
}

function restoreLineupGameSearchInput() {
  const input = document.getElementById("lineup-game-search");
  const list = document.getElementById("lineup-game-list");
  if (!input) return;

  resetGameSearchDropdownOptions(list, "[data-lineup-game]");

  const game = getActiveLineupGame();
  const option = game ? LINEUP_GAME_OPTIONS[game] : null;
  input.value = option?.label || "";
  input.dataset.lastValid = game || "";
  syncGameClearButton("lineup-game-search", "lineup-game-clear");
  syncGameTriggerIcon("lineup-game");
}

function dismissLineupGameSearchDropdown({ force = false } = {}) {
  const list = document.getElementById("lineup-game-list");
  const input = document.getElementById("lineup-game-search");
  if (!list || !input) return;
  if (!force && input === document.activeElement) return;

  hideLineupGameList();
  restoreLineupGameSearchInput();
}

function restoreLineupMapSearchInput() {
  const input = document.getElementById("lineup-map-search");
  const list = document.getElementById("lineup-map-list");
  if (!input) return;

  resetGameSearchDropdownOptions(list);

  const game = getActiveLineupGame();
  if (!game) {
    input.value = "All maps";
    input.dataset.lastValid = "all";
    return;
  }

  const map = resolveLineupMapFilter(game);
  input.value = getLineupMapDisplayLabel(map, game);
  input.dataset.lastValid = map;
}

function dismissLineupMapSearchDropdown({ force = false } = {}) {
  const list = document.getElementById("lineup-map-list");
  const input = document.getElementById("lineup-map-search");
  if (!list || !input) return;
  if (!force && input === document.activeElement) return;

  hideLineupMapList();
  restoreLineupMapSearchInput();
}

function dismissAllSearchDropdowns({ force = false } = {}) {
  GAME_DROPDOWN_PREFIXES.forEach((idPrefix) => dismissGameSearchDropdown(idPrefix, { force }));
  dismissLineupGameSearchDropdown({ force });
  dismissLineupMapSearchDropdown({ force });
}

function initSearchDropdownFocusLossHandlers() {
  if (initSearchDropdownFocusLossHandlers._init) return;
  initSearchDropdownFocusLossHandlers._init = true;

  window.addEventListener("blur", () => dismissAllSearchDropdowns({ force: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") dismissAllSearchDropdowns({ force: true });
  });
}

function hideLineupGameList() {
  const dropdown = document.getElementById("lineup-game-selector");
  const trigger = document.getElementById("lineup-game-trigger");
  const list = document.getElementById("lineup-game-list");
  if (!list) return;
  dropdown?.classList.remove("is-open");
  trigger?.setAttribute("aria-expanded", "false");
  list.classList.add("hidden");
  unmountPrefDropdownPortal(list);
}

function showLineupGameList() {
  const dropdown = document.getElementById("lineup-game-selector");
  const trigger = document.getElementById("lineup-game-trigger");
  const list = document.getElementById("lineup-game-list");
  if (!dropdown || !trigger || !list) return;

  hideAllGameDropdownLists();
  dismissLineupMapSearchDropdown({ force: true });
  initTrainerModeDropdown.close?.();
  initTrainerTimerDropdown.close?.();
  initTrainerAspectDropdown.close?.();
  initBgBackdropControl.close?.();

  dropdown.classList.add("is-open");
  trigger.setAttribute("aria-expanded", "true");
  list.classList.remove("hidden");
  if (list.classList.contains("pref-dropdown-list-portal")) {
    startPrefDropdownPortalTracking(list, trigger);
    return;
  }
  mountPrefDropdownPortal(list, trigger);
}

function hideLineupMapList() {
  const dropdown = document.querySelector(".lineup-map-dropdown");
  const list = document.getElementById("lineup-map-list");
  if (!list) return;
  dropdown?.classList.remove("is-open");
  list.classList.add("hidden");
  unmountPrefDropdownPortal(list);
}

function showLineupMapList() {
  const dropdown = document.querySelector(".lineup-map-dropdown");
  const list = document.getElementById("lineup-map-list");
  const trigger = document.getElementById("lineup-map-trigger");
  if (!list || !trigger) return;

  hideAllGameDropdownLists();
  dismissLineupGameSearchDropdown({ force: true });
  initTrainerModeDropdown.close?.();
  initTrainerTimerDropdown.close?.();
  initTrainerAspectDropdown.close?.();
  initBgBackdropControl.close?.();

  dropdown?.classList.add("is-open");
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
      if (isFocusInsideDropdownList(list)) return;
      dismissLineupMapSearchDropdown();
    }, 120);
  });

  input.addEventListener("input", () => {
    const filter = input.value.toLowerCase();
    list.querySelectorAll(".pref-dropdown-option").forEach((opt) => {
      const label = opt.querySelector("span")?.textContent?.trim().toLowerCase() || "";
      opt.style.display = label.includes(filter) ? "" : "none";
    });
    const visible = getVisible();
    if (visible.length) {
      showLineupMapList();
      activeIndex = 0;
      syncHover(visible);
    } else {
      hideLineupMapList();
      activeIndex = -1;
    }
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

function getLineupFavoriteIds() {
  try {
    const raw = JSON.parse(localStorage.getItem(LINEUP_FAVORITES_STORAGE_KEY) || "[]");
    if (!Array.isArray(raw)) return new Set();
    return new Set(raw.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()));
  } catch (_) {
    return new Set();
  }
}

function setLineupFavoriteIds(ids) {
  const list = [...ids];
  if (!list.length) localStorage.removeItem(LINEUP_FAVORITES_STORAGE_KEY);
  else localStorage.setItem(LINEUP_FAVORITES_STORAGE_KEY, JSON.stringify(list));
}

function getLineupCardFavoriteId(card) {
  return (card?.dataset?.lineupVideoId || "").trim();
}

function isLineupFavorite(id) {
  if (!id) return false;
  return getLineupFavoriteIds().has(id);
}

function toggleLineupFavorite(id) {
  if (!id) return false;
  const favorites = getLineupFavoriteIds();
  if (favorites.has(id)) favorites.delete(id);
  else favorites.add(id);
  setLineupFavoriteIds(favorites);
  return favorites.has(id);
}

function getLineupFavoritesOnly() {
  return localStorage.getItem(LINEUP_FAVORITES_ONLY_STORAGE_KEY) === "1";
}

function setLineupFavoritesOnly(enabled) {
  if (enabled) localStorage.setItem(LINEUP_FAVORITES_ONLY_STORAGE_KEY, "1");
  else localStorage.removeItem(LINEUP_FAVORITES_ONLY_STORAGE_KEY);
}

function toggleLineupFavoritesOnly() {
  setLineupFavoritesOnly(!getLineupFavoritesOnly());
  syncLineupFiltersUI();
}

function syncLineupFavoriteButton(btn, favorited) {
  if (!btn) return;
  btn.classList.toggle("is-favorite", favorited);
  const label = favorited ? "Remove from favorites" : "Add to favorites";
  btn.setAttribute("aria-pressed", favorited ? "true" : "false");
  btn.setAttribute("aria-label", label);
  attachUiTooltip(btn, label);
  const icon = btn.querySelector("i");
  if (icon) icon.className = favorited ? "ri-heart-fill" : "ri-heart-line";
}

function ensureLineupVideoFavoriteButton(card) {
  const id = getLineupCardFavoriteId(card);
  if (!id) return;

  card.querySelector(".lineup-video-embed .lineup-video-favorite-btn")?.remove();

  const body = card.querySelector(".lineup-video-card-foot-body") || card.querySelector(".lineup-video-card-foot");
  if (!body) return;

  let meta = body.querySelector(".lineup-video-card-foot-meta");
  if (!meta) {
    meta = document.createElement("div");
    meta.className = "lineup-video-card-foot-meta";
    const difficulty = body.querySelector(".lineup-difficulty");
    if (difficulty) {
      difficulty.replaceWith(meta);
      meta.appendChild(difficulty);
    } else {
      body.appendChild(meta);
    }
  }

  let btn = meta.querySelector(".lineup-video-favorite-btn");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lineup-video-favorite-btn";
    btn.innerHTML = '<i class="ri-heart-line" aria-hidden="true"></i>';
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const next = toggleLineupFavorite(id);
      syncLineupFavoriteButton(btn, next);
      card.classList.toggle("is-favorite", next);
      if (getLineupFavoritesOnly()) syncLineupFiltersUI();
    });
    meta.appendChild(btn);
  }

  const favorited = isLineupFavorite(id);
  card.classList.toggle("is-favorite", favorited);
  syncLineupFavoriteButton(btn, favorited);
}

function getLineupFilters(game = getActiveLineupGame()) {
  return {
    side: getLineupSideFilter(),
    map: getLineupMapFilter(game),
    query: getLineupSearchQuery(game).trim(),
    difficulties: getLineupDifficultyFilter(),
    favoritesOnly: getLineupFavoritesOnly(),
  };
}

function lineupCardMatchesFilters(card, { side, query, map, difficulties, favoritesOnly }) {
  const cardSide = (card.dataset.lineupSide || "").toLowerCase();
  const cardMap = (card.dataset.lineupMap || "").toLowerCase();
  const cardDifficulty = card.dataset.lineupDifficulty || "";
  const searchText = getLineupCardSearchText(card);
  const sideMatch = side === "all" || cardSide === side;
  const mapMatch = map === "all" || cardMap === map;
  const searchMatch = !query || searchText.includes(query.toLowerCase());
  const difficultyMatch = !difficulties?.size || difficulties.has(cardDifficulty);
  const favoriteMatch = !favoritesOnly || isLineupFavorite(getLineupCardFavoriteId(card));
  return sideMatch && mapMatch && searchMatch && difficultyMatch && favoriteMatch;
}

function setLineupFilterEmptyState(grid, show, { favoritesOnly = false } = {}) {
  let empty = grid.querySelector(".lineup-filter-empty-state");
  if (show) {
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "lineup-empty-state lineup-filter-empty-state";
      grid.appendChild(empty);
    }
    empty.textContent = favoritesOnly ? (getLineupFavoriteIds().size ? "No favorite lineups match your filters." : "No favorite lineups yet.") : "No lineups match your filters.";
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

  const holder = panel.closest(".lineup-videos-holder");
  const head = holder?.querySelector("#lineup-videos-panel-head");
  const headStyle = head ? getComputedStyle(head) : null;
  const headBlock = head && !head.hidden && !head.classList.contains("hidden") ? head.offsetHeight + parseFloat(headStyle.marginTop || 0) + parseFloat(headStyle.marginBottom || 0) : 0;

  const holderStyle = holder ? getComputedStyle(holder) : null;
  const holderPadding = holderStyle ? parseFloat(holderStyle.paddingTop || 0) + parseFloat(holderStyle.paddingBottom || 0) : 0;

  return holderPadding + headBlock + gridHeight;
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
    if (lineupTab && isSectionActive(lineupTab)) {
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

const LINEUP_PANEL_HEAD_ICONS = {
  valorant: "ri-fire-line",
  cs2: "ri-fire-line",
};

function syncLineupVideosPanelHead(game = getActiveLineupGame()) {
  const head = document.getElementById("lineup-videos-panel-head");
  const title = document.getElementById("lineup-videos-panel-title");
  if (!head || !title) return;

  const activeGame = LINEUP_GAMES.has(game) ? game : "";
  const show = !!activeGame;
  head.hidden = !show;
  head.classList.toggle("hidden", !show);
  if (!show) return;

  const option = LINEUP_GAME_OPTIONS[activeGame];
  const icon = LINEUP_PANEL_HEAD_ICONS[activeGame] || "ri-fire-line";
  const label = `${option?.label || activeGame} lineups`;
  title.innerHTML = `<i class="${icon}" aria-hidden="true"></i> ${label}`;
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
  syncLineupVideosPanelHead(activeGame || null);
}

function syncLineupGameSelectorUi(game = getActiveLineupGame()) {
  const selector = document.getElementById("lineup-game-selector");
  const input = document.getElementById("lineup-game-search");
  const list = document.getElementById("lineup-game-list");
  if (!selector) return;

  const activeGame = LINEUP_GAMES.has(game) ? game : "";
  const option = activeGame ? LINEUP_GAME_OPTIONS[activeGame] : null;

  selector.dataset.activeGame = activeGame;
  selector.dataset.value = activeGame;
  selector.classList.toggle("has-game", !!activeGame);

  if (input && document.activeElement !== input) {
    input.value = option?.label || "";
    input.dataset.lastValid = activeGame;
  }
  syncGameClearButton("lineup-game-search", "lineup-game-clear");

  list?.querySelectorAll("[data-lineup-game]").forEach((opt) => {
    const active = opt.dataset.lineupGame === activeGame;
    opt.classList.toggle("active", active);
    opt.setAttribute("aria-selected", active ? "true" : "false");
  });
  syncGameTriggerIcon("lineup-game");
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

  setLineupFilterEmptyState(grid, targetCards.length === 0, { favoritesOnly: filters.favoritesOnly });
  applyLineupSearchHighlights(game);
  refreshLineupVideoCards(grid);
  updateLineupVideosScrollState(game);
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
  setLineupFilterEmptyState(grid, targetCards.length === 0, { favoritesOnly: filters.favoritesOnly });

  if (!targetCards.length) {
    applyLineupSearchHighlights(game);
    updateLineupVideosScrollState(game);
    return;
  }

  applyLineupSearchHighlights(game);
  await fadeInLineupCards(targetCards);
  if (token !== lineupFilterTransitionState.token) return;

  refreshLineupVideoCards(grid);
  updateLineupVideosScrollState(game);
}

function getLineupCommunityGrid(game = getActiveLineupGame()) {
  if (!game) return null;
  return document.getElementById(`lineup-${game}-community-grid`);
}

function getLineupGridsForGame(game = getActiveLineupGame()) {
  return [getLineupGrid(game), getLineupCommunityGrid(game)].filter(Boolean);
}

function applyLineupFilters() {
  const game = getActiveLineupGame();
  if (!game) return;

  const filters = getLineupFilters(game);
  const grid = getLineupGrid(game);
  const communityGrid = getLineupCommunityGrid(game);

  if (grid) {
    const cards = grid.querySelectorAll(".lineup-video-card");
    const staticEmpty = grid.querySelector(":scope > .lineup-empty-state:not(.lineup-filter-empty-state)");

    if (!cards.length) {
      staticEmpty?.classList.remove("hidden");
      staticEmpty && (staticEmpty.hidden = false);
      setLineupFilterEmptyState(grid, false);
    } else {
      staticEmpty?.classList.add("hidden");
      if (staticEmpty) staticEmpty.hidden = true;

      if (!lineupFiltersWillAnimate(grid, filters)) {
        applyLineupFiltersInstant(grid, game, filters);
      } else {
        runLineupFilterTransition(grid, game, filters);
      }
    }
  }

  if (communityGrid) {
    applyLineupFiltersInstant(communityGrid, game, filters);
  }

  if (!grid && !communityGrid) return;
  if (grid && !grid.querySelector(".lineup-video-card")) {
    updateLineupVideosScrollState(game);
  }
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
  const filters = getLineupFilters(game);

  function applyCommunityGridFilters() {
    const communityGrid = getLineupCommunityGrid(game);
    if (!communityGrid) return;
    const communityCards = [...communityGrid.querySelectorAll(".lineup-video-card")];
    const communityTargets = communityCards.filter((card) => lineupCardMatchesFilters(card, filters));
    communityCards.forEach((card) => {
      if (communityTargets.includes(card)) {
        clearLineupCardLeaveTimer(card);
        card.hidden = false;
        card.classList.remove("hidden", "lineup-video-card--entering", "lineup-video-card--leaving");
      } else {
        hideLineupCardInstant(card);
      }
    });
    setLineupFilterEmptyState(communityGrid, communityTargets.length === 0, { favoritesOnly: filters.favoritesOnly });
    refreshLineupVideoCards(communityGrid);
  }

  if (!enterGrid) {
    refreshLineupVideosFixedHeight(game);
    applyCommunityGridFilters();
    applyLineupSearchHighlights(game);
    return;
  }

  const allCards = [...enterGrid.querySelectorAll(".lineup-video-card")];
  const staticEmpty = enterGrid.querySelector(":scope > .lineup-empty-state:not(.lineup-filter-empty-state)");

  if (!allCards.length) {
    staticEmpty?.classList.remove("hidden");
    if (staticEmpty) staticEmpty.hidden = false;
    setLineupFilterEmptyState(enterGrid, false);
    refreshLineupVideosFixedHeight(game);
    applyCommunityGridFilters();
    applyLineupSearchHighlights(game);
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

  setLineupFilterEmptyState(enterGrid, targetCards.length === 0, { favoritesOnly: filters.favoritesOnly });
  refreshLineupVideosFixedHeight(game);
  refreshLineupVideoCards(enterGrid);
  applyLineupSearchHighlights(game);
  applyCommunityGridFilters();
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

  const favoritesOnly = getLineupFavoritesOnly();
  const favoritesFilter = document.getElementById("lineup-favorites-filter");
  if (favoritesFilter) {
    favoritesFilter.classList.toggle("active", favoritesOnly);
    favoritesFilter.setAttribute("aria-pressed", favoritesOnly ? "true" : "false");
  }

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
  lineupMapFilterByGame.set(game, nextMap);
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
  lineupSession.activeGame = game;

  syncLineupGameSelectorUi(game);
  switchLineupGamePanels(game);
  renderLineupMapOptions(game);
  syncLineupFiltersUiControls();
  applyLineupVideoSources(getLineupGrid(game) || document);
  applyLineupFilters();
  refreshLineupVideosFixedHeight(game);
}

function clearLineupGame() {
  lineupSession.activeGame = null;
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
  pendingScrubTime: null,
  lastScrubCaptureAt: 0,
  scrubCaptureTimer: 0,
  scrubDragTimer: 0,
  scrubSeekInFlight: false,
  progressLoopId: 0,
  lastProgressTs: 0,
};

const LINEUP_VIDEO_SCRUB_CAPTURE_INTERVAL_MS = 1;
const LINEUP_VIDEO_SCRUB_SEEK_EPSILON = 0.001;
const LINEUP_VIDEO_SKIP_SECONDS = 5;

const LINEUP_VIDEO_PROGRESS_THUMB_PX = 16;
const LINEUP_VIDEO_PROGRESS_ANIM_RATE = HEALTH_BAR_ANIM_RATE;
const LINEUP_VIDEO_PROGRESS_TRAIL_RATE = HEALTH_BAR_TRAIL_RATE;
const lineupVideoProgressAnimByVideo = new WeakMap();

function getLineupVideoProgressAnimState(video) {
  if (!lineupVideoProgressAnimByVideo.has(video)) {
    lineupVideoProgressAnimByVideo.set(video, {
      displayPlayed: 0,
      trailPlayed: 0,
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

function getLineupVideoProgressUi(video) {
  if (!video || video.id !== "lineup-video-modal-player") return null;

  return {
    mode: "modal",
    wrap: document.getElementById("lineup-video-progress-wrap"),
    playedTrail: document.getElementById("lineup-video-progress-played-trail"),
    playedFill: document.getElementById("lineup-video-progress-played"),
    thumb: document.getElementById("lineup-video-progress-thumb"),
    pctToWidth: (pct) => lineupProgressPctToTrackWidth(pct),
    pctToThumb: (pct) => lineupProgressPctToThumbLeft(pct),
  };
}

function applyLineupVideoProgressVisuals(ui, { playedDisplay, playedTrail }) {
  if (!ui || ui.mode !== "modal") return;

  if (ui.playedTrail) ui.playedTrail.style.width = `${ui.pctToWidth(playedTrail)}%`;
  if (ui.playedFill) ui.playedFill.style.width = `${ui.pctToWidth(playedDisplay)}%`;
  if (ui.thumb) ui.thumb.style.left = `${ui.pctToThumb(playedDisplay)}px`;
}

function lineupVideoNeedsProgressUpdates(video, anim) {
  if (!video?.src) return false;
  if (!video.duration || !Number.isFinite(video.duration) || video.readyState < HTMLMediaElement.HAVE_METADATA) return true;
  if (video.networkState === HTMLMediaElement.NETWORK_LOADING) return true;
  if (!video.paused && !video.ended && !video.hidden) return true;

  if (video.id === "lineup-video-modal-player" && !video.hidden) {
    const targetPlayed = getLineupVideoPlayedPct(video);
    if (Math.abs(anim.displayPlayed - targetPlayed) > 0.05) return true;
    if (Math.abs(anim.trailPlayed - anim.displayPlayed) > 0.05) return true;
  }

  return false;
}

function setLineupVideoProgressTargets(video, { playedPct, snap = false, playedDisplayOnly = false } = {}) {
  const anim = getLineupVideoProgressAnimState(video);
  if (playedPct != null) {
    anim.displayPlayed = playedPct;
    if (!playedDisplayOnly) anim.trailPlayed = snap ? playedPct : anim.trailPlayed;
  }

  const ui = getLineupVideoProgressUi(video);
  if (!ui) return;

  applyLineupVideoProgressVisuals(ui, {
    playedDisplay: anim.displayPlayed,
    playedTrail: anim.trailPlayed,
  });
}

function updateLineupVideoProgressForPlayer(video, dt, { snap = false } = {}) {
  const ui = getLineupVideoProgressUi(video);
  if (!ui) return false;

  const anim = getLineupVideoProgressAnimState(video);
  let playedDisplay = anim.displayPlayed;
  let playedTrail = anim.trailPlayed;

  if (!lineupVideoSeekState.dragging) {
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
  });

  return lineupVideoNeedsProgressUpdates(video, anim);
}

function collectLineupVideoProgressTargets() {
  const modalPlayer = document.getElementById("lineup-video-modal-player");
  return modalPlayer?.src ? [modalPlayer] : [];
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

function updateLineupVideoProgressBars({ playedPct, snap = false, playedDisplayOnly = false } = {}) {
  const player = document.getElementById("lineup-video-modal-player");
  if (!player) return;

  const nextPlayedPct = playedPct ?? (lineupVideoSeekState.dragging ? null : getLineupVideoPlayedPct(player));

  setLineupVideoProgressTargets(player, {
    playedPct: nextPlayedPct,
    snap,
    playedDisplayOnly,
  });

  if (!playedDisplayOnly) {
    updateLineupVideoProgressForPlayer(player, 1 / 60, { snap });
  }
  startLineupVideoProgressLoop();
}

function hideLineupVideoScrubPreview() {
  stopLineupVideoScrubDragLoop();
  if (lineupVideoSeekState.scrubCaptureTimer) {
    clearTimeout(lineupVideoSeekState.scrubCaptureTimer);
    lineupVideoSeekState.scrubCaptureTimer = 0;
  }
  lineupVideoSeekState.pendingScrubTime = null;
  lineupVideoSeekState.scrubSeekInFlight = false;
  document.getElementById("lineup-video-scrub-preview")?.classList.add("hidden");
  document.getElementById("lineup-video-progress-wrap")?.classList.remove("is-dragging");
}

function stopLineupVideoScrubDragLoop() {
  if (!lineupVideoSeekState.scrubDragTimer) return;
  clearInterval(lineupVideoSeekState.scrubDragTimer);
  lineupVideoSeekState.scrubDragTimer = 0;
}

function startLineupVideoScrubDragLoop() {
  if (lineupVideoSeekState.scrubDragTimer) return;
  lineupVideoSeekState.scrubDragTimer = window.setInterval(() => {
    if (!lineupVideoSeekState.dragging) {
      stopLineupVideoScrubDragLoop();
      return;
    }
    flushLineupVideoScrubFrame();
  }, LINEUP_VIDEO_SCRUB_CAPTURE_INTERVAL_MS);
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

  const safeTime = Math.max(0, Math.min(captureTime, scrubPlayer.duration || captureTime));

  const drawFrame = () => {
    const ctx = canvas.getContext("2d");
    if (!ctx || !scrubPlayer.videoWidth) return;
    ctx.drawImage(scrubPlayer, 0, 0, canvas.width, canvas.height);
    lineupVideoSeekState.lastScrubCaptureAt = performance.now();
  };

  if (Math.abs(scrubPlayer.currentTime - safeTime) <= LINEUP_VIDEO_SCRUB_SEEK_EPSILON && scrubPlayer.readyState >= 2) {
    drawFrame();
    return;
  }

  if (lineupVideoSeekState.scrubSeekInFlight) return;

  lineupVideoSeekState.scrubSeekInFlight = true;

  const finishSeek = () => {
    lineupVideoSeekState.scrubSeekInFlight = false;
    drawFrame();

    const latest = lineupVideoSeekState.pendingScrubTime;
    if (latest == null) return;
    const latestSafe = Math.max(0, Math.min(latest, scrubPlayer.duration || latest));
    if (Math.abs(latestSafe - scrubPlayer.currentTime) > LINEUP_VIDEO_SCRUB_SEEK_EPSILON) {
      flushLineupVideoScrubFrame();
    }
  };

  try {
    scrubPlayer.addEventListener("seeked", finishSeek, { once: true });
    if (typeof scrubPlayer.fastSeek === "function") {
      scrubPlayer.fastSeek(safeTime);
    } else {
      scrubPlayer.currentTime = safeTime;
    }
  } catch {
    scrubPlayer.removeEventListener("seeked", finishSeek);
    lineupVideoSeekState.scrubSeekInFlight = false;
  }
}

function requestLineupVideoScrubFrame(time) {
  lineupVideoSeekState.pendingScrubTime = time;

  if (lineupVideoSeekState.dragging) {
    startLineupVideoScrubDragLoop();
    flushLineupVideoScrubFrame();
    return;
  }

  if (lineupVideoSeekState.scrubCaptureTimer) {
    clearTimeout(lineupVideoSeekState.scrubCaptureTimer);
    lineupVideoSeekState.scrubCaptureTimer = 0;
  }
  flushLineupVideoScrubFrame();
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
  stopLineupVideoScrubDragLoop();
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

function seekLineupVideoBySeconds(delta) {
  const player = document.getElementById("lineup-video-modal-player");
  if (!player || player.hidden || !Number.isFinite(player.duration)) return;

  player.currentTime = Math.max(0, Math.min(player.duration, player.currentTime + delta));
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

  window.MorningRoastLineupComments?.close?.();

  syncLineupVideoModalDifficulty("");
  closeLineupVideoOptionsMenu();
  hideLineupVideoScrubPreview();
  stopLineupVideoProgressLoop();
  lineupVideoSeekState.dragging = false;
  lineupVideoSeekState.wasPlaying = false;
  if (player) {
    resetLineupVideoProgressAnimState(player);
    setLineupVideoProgressTargets(player, { playedPct: 0, snap: true });
  }
  lineupVideoModalState.loadToken += 1;
  player?.pause();
  if (player) {
    player.onerror = null;
    player.playbackRate = 1;
    player.removeAttribute("poster");
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
  lineupVideoModalState.posterUrl = "";
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

function openLineupVideoModal(url, title = "", difficulty = "", posterUrl = "", context = {}) {
  const overlay = document.getElementById("lineup-video-overlay");
  const player = document.getElementById("lineup-video-modal-player");
  const titleEl = document.getElementById("lineup-video-modal-title");
  if (!overlay || !player || !url) return;

  if (titleEl) titleEl.textContent = title;
  syncLineupVideoModalDifficulty(difficulty);
  closeLineupVideoOptionsMenu();

  const game = String(context.game || "").trim().toLowerCase();
  const videoId = String(context.videoId || "").trim();
  if (game && videoId) {
    window.MorningRoastLineupComments?.open?.({ game, videoId });
  } else {
    window.MorningRoastLineupComments?.close?.();
  }

  lineupVideoModalState.baseUrl = url;
  lineupVideoModalState.posterUrl = posterUrl;
  lineupVideoModalState.speed = getStoredLineupVideoSpeed();
  lineupVideoModalState.shouldAutoplay = true;

  player.muted = false;
  player.volume = 1;
  const volume = document.getElementById("lineup-video-volume");
  if (volume) volume.value = "1";
  resetLineupVideoProgressAnimState(player);
  setLineupVideoProgressTargets(player, { playedPct: 0, snap: true });

  // Show the modal before loading media so a progress/UI error can't block open.
  lineupVideoModalState.openedAt = performance.now();
  overlay.classList.add("active");
  overlay.hidden = false;
  syncBodyScrollLock();

  try {
    loadLineupVideoModalSource(url, { posterUrl, resumeTime: 0, autoplay: true });
    syncLineupVideoControlsUi();
    syncLineupVideoOptionsUi();
  } catch (error) {
    console.error("Failed to open lineup video:", error);
  }

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
  const skipBackBtn = document.getElementById("lineup-video-skip-back");
  const skipForwardBtn = document.getElementById("lineup-video-skip-forward");
  const muteBtn = document.getElementById("lineup-video-mute");
  const progress = document.getElementById("lineup-video-progress");
  const volume = document.getElementById("lineup-video-volume");
  const modal = overlay?.querySelector(".lineup-video-modal");
  if (!overlay || !player || overlay.dataset.lineupVideoModalInit) return;
  overlay.dataset.lineupVideoModalInit = "1";

  // Bind open/close first so a later setup error can't leave clicks dead.
  document.querySelectorAll(".lineup-video-grid").forEach((grid) => {
    grid.addEventListener("click", (event) => {
      const card = event.target.closest(".lineup-video-card");
      if (!card || !grid.contains(card) || card.classList.contains("lineup-video-card--no-source")) return;
      if (isLineupEmbedBadgeClickTarget(event.target)) return;

      const playTrigger = event.target.closest(".lineup-video-play-trigger");
      const embed = event.target.closest(".lineup-video-embed");
      if (!playTrigger && !embed) return;

      const src = getLineupVideoUrl(card);
      if (!src) return;

      event.preventDefault();
      openLineupVideoModal(src, getLineupVideoTitle(card), card.dataset.lineupDifficulty || "", getLineupVideoPosterAssetPath(card), {
        game: getLineupGameForCard(card),
        videoId: getLineupVideoId(card),
      });
    });
  });

  closeBtn?.addEventListener("click", closeLineupVideoModal);

  modal?.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  overlay.addEventListener("click", (event) => {
    if (event.target !== overlay) return;
    // Ignore the same click that opened the modal (backdrop can appear under the cursor).
    if (performance.now() - lineupVideoModalState.openedAt < 350) return;
    closeLineupVideoModal();
  });

  try {
    applyLineupVideoSources();
    initLineupVideoLazyLoader();
    enhanceLineupVideoEmbeds();
    initLineupVideoOptionsMenu();
    startLineupVideoProgressLoop();

    const modalBody = overlay.querySelector(".lineup-video-modal-body");
    bindLineupVideoBufferUi(player, modalBody);
    bindLineupVideoAutoplayEvents(player);
  } catch (error) {
    console.error("Failed to initialize lineup video UI:", error);
  }

  volume?.addEventListener("wheel", handleLineupVideoVolumeWheel, { passive: false });

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

  skipBackBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    seekLineupVideoBySeconds(-LINEUP_VIDEO_SKIP_SECONDS);
  });

  skipForwardBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    seekLineupVideoBySeconds(LINEUP_VIDEO_SKIP_SECONDS);
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
    startLineupVideoScrubDragLoop();

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
      startLineupVideoScrubDragLoop();
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
  const input = document.getElementById("lineup-game-search");
  const list = document.getElementById("lineup-game-list");
  const clearBtn = document.getElementById("lineup-game-clear");
  if (!input || !list || initLineupGameDropdown._init) return;
  initLineupGameDropdown._init = true;

  initLineupGameDropdown.close = hideLineupGameList;

  let activeIndex = -1;
  const getVisible = () => Array.from(list.querySelectorAll("[data-lineup-game]")).filter((opt) => opt.style.display !== "none");
  const syncHover = (visible) => {
    visible.forEach((opt, i) => opt.classList.toggle("hover", i === activeIndex));
    if (activeIndex >= 0 && visible[activeIndex]) {
      visible[activeIndex].scrollIntoView({ block: "nearest" });
    }
  };
  const getOptionLabel = (opt) => opt.querySelector("span")?.textContent?.trim() || "";
  const selectLineupGameOption = (opt) => {
    if (!opt) return;
    const value = opt.dataset.lineupGame;
    if (!LINEUP_GAMES.has(value)) return;
    if (value !== getActiveLineupGame()) {
      setLineupGame(value);
    } else {
      syncLineupGameSelectorUi(value);
    }
    hideLineupGameList();
    input.blur();
  };

  input.addEventListener("focus", () => {
    const previous = getActiveLineupGame() || "";
    input.dataset.lastValid = previous;
    input.value = "";
    list.querySelectorAll("[data-lineup-game]").forEach((opt) => {
      opt.style.display = "";
      opt.classList.remove("hover");
    });
    const visible = getVisible();
    const selectedIndex = visible.findIndex((opt) => opt.dataset.lineupGame === previous);
    activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
    syncHover(visible);
    syncGameClearButton("lineup-game-search", "lineup-game-clear");
    showLineupGameList();
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (isFocusInsideDropdownList(list)) return;
      dismissLineupGameSearchDropdown();
    }, 120);
  });

  input.addEventListener("input", () => {
    const filter = input.value.toLowerCase();
    list.querySelectorAll("[data-lineup-game]").forEach((opt) => {
      opt.style.display = getOptionLabel(opt).toLowerCase().includes(filter) ? "" : "none";
    });
    const visible = getVisible();
    if (visible.length) {
      showLineupGameList();
      activeIndex = 0;
      syncHover(visible);
    } else {
      hideLineupGameList();
      activeIndex = -1;
    }
    syncGameClearButton("lineup-game-search", "lineup-game-clear");
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
      selectLineupGameOption(visible[activeIndex]);
      e.preventDefault();
    } else if (e.key === "Escape") {
      hideLineupGameList();
      input.blur();
    }
  });

  list.addEventListener("mousedown", (e) => {
    const opt = e.target.closest("[data-lineup-game]");
    if (!opt) return;
    e.preventDefault();
    selectLineupGameOption(opt);
  });

  list.addEventListener("mouseover", (e) => {
    const opt = e.target.closest("[data-lineup-game]");
    if (!opt) return;
    const visible = getVisible();
    activeIndex = visible.indexOf(opt);
    syncHover(visible);
  });

  clearBtn?.addEventListener("mousedown", (e) => {
    e.preventDefault();
    input.value = "";
    input.dataset.lastValid = "";
    hideLineupGameList();
    syncGameClearButton("lineup-game-search", "lineup-game-clear");
    if (getActiveLineupGame()) clearLineupGame();
  });
}

function initLineupTab() {
  const selector = document.getElementById("lineup-game-selector");
  if (!selector) return;

  initLineupPanelResizeAnimations();
  initLineupGameDropdown();
  initLineupMapDropdown();
  initLineupVideoModal();
  window.MorningRoastLineupComments?.init?.();
  window.MorningRoastLineupSubmissions?.init?.();
  initLineupBadgeInfoPopovers();
  initLineupCardTilt();
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

  document.getElementById("lineup-favorites-filter")?.addEventListener("click", () => {
    toggleLineupFavoritesOnly();
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

const TAB_ACTIVITY_LABELS = {
  "sensitivity-converter-tab": "Converting Sensitivity",
  "edpi-calculator-tab": "Calculating eDPI",
  "aim-training-tab": "Aim Training",
  "crosshair-converter-tab": "Converting Crosshair",
  "lineup-tab": "Watching Lineups",
  "stats-tab": "Viewing Aim stats",
  "profile-tab": "Viewing Profile",
};
const DEFAULT_ACTIVITY_LABEL = "Browsing";

let presenceApi = null;
let presenceIsLive = false;
let presenceState = "connecting";
let presenceActivityCounts = {};

function activityLabelForTab(id) {
  return TAB_ACTIVITY_LABELS[id] || DEFAULT_ACTIVITY_LABEL;
}

function reportActivityForTab(id) {
  presenceApi?.setActivity?.(activityLabelForTab(id));
}

function isPresencePopupOpen() {
  const overlay = document.getElementById("presence-activity-overlay");
  return Boolean(overlay) && overlay.classList.contains("active");
}

function renderPresenceActivityPopup() {
  const list = document.getElementById("presence-activity-list");
  const empty = document.getElementById("presence-activity-empty");
  const summary = document.getElementById("presence-activity-summary");
  if (!list || !empty) return;

  const entries = Object.entries(presenceActivityCounts)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const total = entries.reduce((sum, [, count]) => sum + count, 0);

  if (summary) {
    if (presenceState === "connecting") {
      summary.textContent = "Connecting to the live member count…";
    } else if (presenceState !== "live") {
      summary.textContent = "Live member count is currently unavailable.";
    } else {
      summary.textContent = total === 1 ? "1 member online right now." : `${total} members online right now.`;
    }
  }

  list.innerHTML = "";
  if (!entries.length) {
    empty.textContent = presenceState === "live" ? "No activity to show yet." : "Activity will appear once the live connection is available.";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  for (const [label, count] of entries) {
    const item = document.createElement("li");
    item.className = "presence-activity-item";
    const name = document.createElement("span");
    name.className = "presence-activity-name";
    name.textContent = label;
    const value = document.createElement("span");
    value.className = "presence-activity-value";
    value.textContent = String(count);
    item.append(name, value);
    list.append(item);
  }
}

function setPresencePopupOpen(open) {
  const trigger = document.getElementById("app-sidebar-presence");
  const overlay = document.getElementById("presence-activity-overlay");
  if (!trigger || !overlay) return;

  if (open) {
    renderPresenceActivityPopup();
    overlay.classList.add("active");
    trigger.setAttribute("aria-expanded", "true");
    syncBodyScrollLock();
  } else {
    overlay.classList.remove("active");
    trigger.setAttribute("aria-expanded", "false");
    syncBodyScrollLock();
  }
}

function togglePresencePopup() {
  setPresencePopupOpen(!isPresencePopupOpen());
}

function initPresenceActivityPopup() {
  const trigger = document.getElementById("app-sidebar-presence");
  const overlay = document.getElementById("presence-activity-overlay");
  if (!trigger || !overlay) return;
  const closeBtn = document.getElementById("close-presence-activity");

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    togglePresencePopup();
  });

  closeBtn?.addEventListener("click", () => setPresencePopupOpen(false));

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) setPresencePopupOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isPresencePopupOpen()) {
      setPresencePopupOpen(false);
      trigger.focus();
    }
  });
}

function switchTab(_evt, id, { updateHistory = true } = {}) {
  if (isUsernameOnboardingOpen()) return;
  if (id === "lineup-tab" && !LINEUP_TAB_ENABLED) return;
  if (id === "crosshair-converter-tab" && !MISC_TAB_ENABLED) return;

  if (id === "aim-training-tab" && isMobileViewport()) {
    id = "sensitivity-converter-tab";
  }

  const previousId = getCurrentTabId();
  if (previousId === id) {
    closeMobileNavMenu();
    setAppMoreMenuOpen(false);
    setAppMiscMenuOpen(false);
    return;
  }

  const ui = getTabSwitchUi();
  const target = document.getElementById(id);
  if (!target) return;

  for (const section of ui.sections) {
    const active = section === target;
    section.classList.toggle("is-active", active);
    if (active) {
      section.classList.add("is-tab-entering");
      section.addEventListener("animationend", finishTabEnterAnimation, { once: true });
    } else {
      section.classList.remove("is-tab-entering");
    }
  }

  ui.moreItems.forEach((b) => b.classList.remove("active"));
  ui.miscItems.forEach((b) => b.classList.remove("active"));
  ui.navButtons.forEach((b) => b.classList.remove("active"));

  const moreToggle = document.getElementById("sidebar-more-button");
  const miscToggle = document.getElementById("sidebar-misc-button");

  if (FOOTER_TAB_IDS.has(id)) {
    ui.sidebarItems.forEach((b) => b.classList.remove("active"));
    ui.moreNavButtons.forEach((b) => b.classList.remove("active"));
    const footerBtn = document.getElementById(FOOTER_BUTTON_IDS[id]);
    if (footerBtn) footerBtn.classList.add("active");
    document.querySelector(`.nav-more-button[data-nav-tab="${id}"]`)?.classList.add("active");
    document.getElementById("nav-more-toggle")?.classList.add("active");
    moreToggle?.classList.add("active");
    miscToggle?.classList.remove("active");
  } else if (MISC_TAB_IDS.has(id)) {
    ui.sidebarItems.forEach((b) => b.classList.remove("active"));
    miscToggle?.classList.add("active");
    document.querySelector(`.app-sidebar-misc-item[data-sidebar-tab="${id}"]`)?.classList.add("active");
    document.querySelector(`.nav-misc-button[data-nav-tab="${id}"]`)?.classList.add("active");
    document.getElementById("nav-misc-toggle")?.classList.add("active");
    moreToggle?.classList.remove("active");
  } else {
    ui.sidebarItems.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.sidebarTab === id);
    });
    ui.moreNavButtons.forEach((b) => b.classList.remove("active"));
    document.getElementById("nav-more-toggle")?.classList.remove("active");
    moreToggle?.classList.remove("active");
    miscToggle?.classList.remove("active");
    const navBtn = NAV_BUTTON_IDS[id] ? document.getElementById(NAV_BUTTON_IDS[id]) : null;
    if (navBtn) navBtn.classList.add("active");
  }

  closeMobileNavMenu();
  setAppMoreMenuOpen(false);
  setAppMiscMenuOpen(false);

  if (previousId === "aim-training-tab" && id !== "aim-training-tab") {
    aimTrainer.stopLoop?.();
  }

  queueTabActivation(id);
  reportActivityForTab(id);

  if (updateHistory && !routeState.isInitial) {
    syncUrlToTab(id);
  }

  if (!routeState.isInitial) {
    scrollToTop(0, { allowMobile: true, instant: true });
  }
}

function toggleResetButton() {
  const resetBtn = document.getElementById("reset-btn");
  if (!resetBtn) return;
  const isDefault = elements["from-search"].value === "" && elements["to-search"].value === "" && elements["base-sens"].value === "" && elements["from-dpi"].value === "800" && elements["to-dpi"].value === "800";
  toggleVisibility(resetBtn, !isDefault);
  syncTabActionMenuStateByWrapId("sens-action-menu-wrap");
}

function isTabActionMenuOpen(wrap) {
  const menu = wrap.querySelector(".tab-action-menu");
  return !!menu && !menu.classList.contains("hidden");
}

function closeTabActionMenu(wrap) {
  const menu = wrap.querySelector(".tab-action-menu");
  const btn = wrap.querySelector(".tab-action-menu-trigger");
  if (!menu || menu.classList.contains("hidden")) return false;

  menu.classList.add("hidden");
  btn?.setAttribute("aria-expanded", "false");
  return true;
}

function closeAllTabActionMenus(exceptWrap = null) {
  document.querySelectorAll(".tab-action-menu-wrap").forEach((wrap) => {
    if (wrap !== exceptWrap) closeTabActionMenu(wrap);
  });
}

function openTabActionMenu(wrap) {
  const menu = wrap.querySelector(".tab-action-menu");
  const btn = wrap.querySelector(".tab-action-menu-trigger");
  if (!menu || !btn || btn.classList.contains("hidden-fade")) return;

  closeAllTabActionMenus(wrap);
  menu.classList.remove("hidden");
  btn.setAttribute("aria-expanded", "true");
}

function syncTabActionMenuState(wrap) {
  const btn = wrap.querySelector(".tab-action-menu-trigger");
  const items = wrap.querySelectorAll(".tab-action-menu-item");
  if (!btn) return;

  const hasVisibleAction = [...items].some((item) => item.classList.contains("visible-fade"));
  toggleVisibility(btn, hasVisibleAction);
  if (!hasVisibleAction) closeTabActionMenu(wrap);
}

function syncTabActionMenuStateByWrapId(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (wrap) syncTabActionMenuState(wrap);
}

function initTabActionMenus() {
  if (!initTabActionMenus._listeners) {
    initTabActionMenus._listeners = true;
    document.addEventListener("click", () => closeAllTabActionMenus());
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeAllTabActionMenus();
    });
  }

  document.querySelectorAll(".tab-action-menu-wrap").forEach((wrap) => {
    if (wrap.dataset.init === "1") {
      syncTabActionMenuState(wrap);
      return;
    }
    wrap.dataset.init = "1";

    const btn = wrap.querySelector(".tab-action-menu-trigger");
    const menu = wrap.querySelector(".tab-action-menu");
    if (!btn || !menu) return;

    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      if (isTabActionMenuOpen(wrap)) closeTabActionMenu(wrap);
      else openTabActionMenu(wrap);
    });

    wrap.addEventListener("click", (event) => {
      event.stopPropagation();
    });

    menu.querySelectorAll(".tab-action-menu-item").forEach((item) => {
      item.addEventListener("click", () => closeTabActionMenu(wrap));
    });

    syncTabActionMenuState(wrap);
  });
}

function toggleEDPIResetButton() {
  const resetBtn = document.getElementById("edpi-reset");
  if (!resetBtn) return;
  const sensVal = elements["edpi-sens"].value;
  const dpiVal = document.getElementById("edpi-dpi").value;
  const gameVal = elements["edpi-game-search"]?.value || "";
  const isDefaultA = (sensVal === "" || sensVal === "0") && (dpiVal === "" || dpiVal === "0" || dpiVal === "800") && gameVal === "";
  let isDefault = isDefaultA;
  if (isEdpiCompareMode()) {
    const sensB = elements["edpi-sens-b"]?.value || "";
    const dpiB = elements["edpi-dpi-b"]?.value || "";
    const isDefaultB = (sensB === "" || sensB === "0") && (dpiB === "" || dpiB === "0" || dpiB === "800");
    isDefault = isDefaultA && isDefaultB;
  }
  toggleVisibility(resetBtn, !isDefault);
  syncTabActionMenuStateByWrapId("edpi-action-menu-wrap");
}

function clearEdpiGameDropdown() {
  const input = document.getElementById("edpi-game-search");
  if (input) {
    input.value = "";
    input.dataset.lastValid = "";
  }
  syncGameClearButton("edpi-game-search", "edpi-game-clear");
  syncGameTriggerIcon("edpi-game");
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

  syncTabActionMenuStateByWrapId("profile-sens-action-menu-wrap");
  syncTabActionMenuStateByWrapId("profile-edpi-action-menu-wrap");

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

function scheduleUpdateConversion() {
  profileSensStatsPaused = false;
  clearTimeout(debounceTimers.conversion);
  debounceTimers.conversion = setTimeout(updateConversion, 64);
}

function updateConversion() {
  const fromGame = resolveConverterGameInput("from"),
    toGame = resolveConverterGameInput("to"),
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

  if (fromGame && !profileSensStatsPaused) {
    localStorage.setItem("fromGame", fromGame);
    const pFrom = document.getElementById("profile-from-game");
    if (pFrom) pFrom.innerText = getGameDisplayName(fromGame);
  }
  if (toGame && !profileSensStatsPaused) {
    localStorage.setItem("toGame", toGame);
    const pTo = document.getElementById("profile-to-game");
    if (pTo) pTo.innerText = getGameDisplayName(toGame);
  }

  const converted = MorningRoastGames.convertSensitivity(sens, fromGame, toGame, fDpi, tDpi);

  if (converted == null) {
    display.innerText = "0.00";
    toggleVisibility(copyBtn, false);
    toggleVisibility(shareBtn, false);
    toggleProfileSensConvButtons();
    updateGameInfoPanelVisibility();
    syncTabActionMenuStateByWrapId("sens-action-menu-wrap");
    return;
  }

  const result = converted.toFixed(3);
  display.innerText = result;

  if (parseFloat(result) > 0 && !profileSensStatsPaused) {
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

    window.MorningRoastProfileTags?.recordSensitivityConversion?.({
      fromGame,
      toGame,
      baseSens,
      fromDpi: fDpi,
      toDpi: tDpi,
      result,
    });
  }

  toggleProfileSensConvButtons();
  updateGameInfoPanelVisibility();
  const hasResult = parseFloat(result) > 0;
  toggleVisibility(copyBtn, hasResult);
  toggleVisibility(shareBtn, hasResult);
  syncTabActionMenuStateByWrapId("sens-action-menu-wrap");
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
  if (e.key === "lastEdpiGame") {
    const pGame = document.getElementById("profile-edpi-game");
    if (pGame) pGame.innerText = e.newValue ? getGameDisplayName(e.newValue) : "-";
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

function handleInputValidation(input, callback) {
  const isDpiField = input.id.includes("-dpi"),
    isSensField = input.id === "base-sens" || input.id === "edpi-sens" || input.id === "edpi-sens-b" || input.id === "canvas-sens";
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
  return getCommittedGameFromInput(input) || resolveStoredGameName(input.dataset.lastValid) || resolveStoredGameName(localStorage.getItem(PROFILE_FILTER_GAME_KEY)) || DEFAULT_PROFILE_FILTER_GAME;
}

function initProfileGameFilter() {
  const input = document.getElementById("profile-game-search");
  if (!input) return;

  const saved = localStorage.getItem(PROFILE_FILTER_GAME_KEY);
  const valid = resolveStoredGameName(saved) || DEFAULT_PROFILE_FILTER_GAME;

  input.value = getGameDisplayName(valid);
  input.dataset.lastValid = valid;
  localStorage.setItem(PROFILE_FILTER_GAME_KEY, valid);
  syncProfileGameDropdownUi(valid);
}

function ensureProfileGameValue() {
  const input = document.getElementById("profile-game-search");
  if (!input) return DEFAULT_PROFILE_FILTER_GAME;

  const resolved = getCommittedGameFromInput(input);
  if (resolved) {
    input.value = getGameDisplayName(resolved);
    input.dataset.lastValid = resolved;
    localStorage.setItem(PROFILE_FILTER_GAME_KEY, resolved);
    syncProfileGameDropdownUi(resolved);
    return resolved;
  }

  const restored = input.dataset.lastValid || localStorage.getItem(PROFILE_FILTER_GAME_KEY) || DEFAULT_PROFILE_FILTER_GAME;
  const validRestore = resolveStoredGameName(restored) || DEFAULT_PROFILE_FILTER_GAME;

  input.value = getGameDisplayName(validRestore);
  input.dataset.lastValid = validRestore;
  localStorage.setItem(PROFILE_FILTER_GAME_KEY, validRestore);
  syncProfileGameDropdownUi(validRestore);
  return validRestore;
}

function getCommittedGameFromInput(input) {
  if (!input) return null;
  const val = input.value.trim();
  if (val) {
    const fromDisplay = MorningRoastGames.resolveGameFromDisplayName(val);
    if (fromDisplay) return fromDisplay;

    const list = document.getElementById(input.id.replace("-search", "-list"));
    if (list) {
      const options = Array.from(list.querySelectorAll(".pref-dropdown-option"));
      const exact = options.find((opt) => {
        const key = getGameOptionLabel(opt);
        return getGameDisplayName(key).toLowerCase() === val.toLowerCase();
      });
      if (exact) return getGameOptionLabel(exact);
    }
  }

  return resolveStoredGameName(input.dataset.lastValid || "");
}

function resolveGameFromInput(input, listId) {
  if (!input) return null;
  const val = input.value.trim();
  if (!val) return null;
  const fromDisplay = MorningRoastGames.resolveGameFromDisplayName(val);
  if (fromDisplay) return fromDisplay;
  const list = document.getElementById(listId || input.id.replace("-search", "-list"));
  if (!list) return null;

  const options = Array.from(list.querySelectorAll(".pref-dropdown-option"));
  const getOptionName = (opt) => getGameOptionLabel(opt);
  const lower = val.toLowerCase();
  const exact = options.find((opt) => getGameDisplayName(getOptionName(opt)).toLowerCase() === lower);
  if (exact) return getOptionName(exact);

  const partial = options.find((opt) => getGameDisplayName(getOptionName(opt)).toLowerCase().startsWith(lower));
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
    if (!statsTab || !isSectionActive(statsTab)) return;
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
      attributeFilter: ["class"],
    });
  }

  initProgressChartInteraction();
  initProgressChartCalendar();
}

const progressUi = {
  chartHoverIndex: -1,
  calendarView: { year: new Date().getFullYear(), month: new Date().getMonth() },
};
const PROGRESS_CHART_DATE_KEY = "prefProgressChartDate";
const PROGRESS_CHART_DATE_ANCHOR_KEY = "prefProgressChartDateAnchor";
const PROGRESS_CHART_HEIGHT = 228;
const PROGRESS_CHART_PAD = { x: 18, top: 14, bottom: 16 };

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
  const todayKey = getProgressDayKey(Date.now());

  let anchor = "";
  try {
    anchor = sessionStorage.getItem(PROGRESS_CHART_DATE_ANCHOR_KEY) || "";
  } catch (err) {}

  if (anchor !== todayKey) {
    try {
      sessionStorage.setItem(PROGRESS_CHART_DATE_ANCHOR_KEY, todayKey);
      sessionStorage.setItem(PROGRESS_CHART_DATE_KEY, todayKey);
    } catch (err) {}
    return todayKey;
  }

  try {
    return sessionStorage.getItem(PROGRESS_CHART_DATE_KEY) || todayKey;
  } catch (err) {
    return todayKey;
  }
}

function setProgressChartSelectedDay(dayKey) {
  const todayKey = getProgressDayKey(Date.now());
  const resolved = dayKey || todayKey;
  try {
    sessionStorage.setItem(PROGRESS_CHART_DATE_ANCHOR_KEY, todayKey);
    sessionStorage.setItem(PROGRESS_CHART_DATE_KEY, resolved);
  } catch (err) {}
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
  const { year, month } = progressUi.calendarView;
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
    progressUi.calendarView = { year: parsed.year, month: parsed.month - 1 };
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

  try {
    localStorage.removeItem(PROGRESS_CHART_DATE_KEY);
  } catch (err) {}

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (picker.classList.contains("is-open")) closeProgressChartCalendar();
    else openProgressChartCalendar();
  });

  prevBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    progressUi.calendarView.month -= 1;
    if (progressUi.calendarView.month < 0) {
      progressUi.calendarView.month = 11;
      progressUi.calendarView.year -= 1;
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
    progressUi.calendarView.month += 1;
    if (progressUi.calendarView.month > 11) {
      progressUi.calendarView.month = 0;
      progressUi.calendarView.year += 1;
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

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const todayKey = getProgressDayKey(Date.now());
    if (progressUi.lastKnownProgressDayKey && progressUi.lastKnownProgressDayKey !== todayKey) {
      requestProfileChartsRedraw();
    }
    progressUi.lastKnownProgressDayKey = todayKey;
  });
  progressUi.lastKnownProgressDayKey = getProgressDayKey(Date.now());
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
  const changed = progressUi.chartHoverIndex !== -1;
  progressUi.chartHoverIndex = -1;
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
    if (idx === progressUi.chartHoverIndex) return;
    progressUi.chartHoverIndex = idx;
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
    ctx.font = canvasFont("0.75rem");
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
    label.textContent = `${getGameDisplayName(game)} · ${modeLabel} · ${timer}s · ${formatProgressDayLabel(selectedDay)}`;
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
    ctx.font = canvasFont("0.75rem");
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

  if (progressUi.chartHoverIndex >= points.length) {
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
    const hovered = i === progressUi.chartHoverIndex;
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

  if (progressUi.chartHoverIndex >= 0 && points[progressUi.chartHoverIndex]) {
    const point = points[progressUi.chartHoverIndex];
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
    ensureCrosshairConverterLoaded()
      .then(() => {
        setCrosshairConverterDirection?.(dir);
        updateCrosshairConverterUi?.();
      })
      .catch(() => {});
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
  const visibleSection = getTabSwitchUi().sections.find((s) => isSectionActive(s));
  const currentIndex = tabOrder.indexOf(visibleSection?.id);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % tabOrder.length : 0;
  const nextId = tabOrder[nextIndex];
  switchTab(null, nextId);
}

function initHotkeys() {
  document.addEventListener("keydown", (e) => {
    if (isUsernameOnboardingOpen()) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.repeat) return;

    const tabKey = Number(e.key);
    if (tabKey === 1 || tabKey === 3 || tabKey === 4) {
      const tabId = getTabIdForNumberHotkey(tabKey);
      if (tabId) {
        switchTab(null, tabId);
        e.preventDefault();
      }
      return;
    }

    if (tabKey === 2) {
      const miscOrder = getMiscHotkeyTabOrder();
      if (miscOrder.length) {
        cycleHotkeyTab(miscOrder);
        e.preventDefault();
      }
      return;
    }

    if (tabKey === 5) {
      cycleHotkeyTab(MORE_HOTKEY_TAB_ORDER);
      e.preventDefault();
      return;
    }

    if (e.key.toLowerCase() === "c") {
      const visibleSection = getTabSwitchUi().sections.find((s) => isSectionActive(s));
      const copyBtn = visibleSection?.querySelector(".copy-button");
      if (copyBtn) {
        copyBtn.click();
        e.preventDefault();
      }
    } else if (e.key.toLowerCase() === "r") {
      if (typeof aimTrainer !== "undefined" && aimTrainer.restartSession?.()) {
        e.preventDefault();
      }
    }
  });
}

function syncKeybindLabels() {
  const key2Row = document.getElementById("keybind-2-row");
  const key2Label = document.getElementById("keybind-2-label");
  const miscOrder = getMiscHotkeyTabOrder();

  if (key2Row) key2Row.hidden = miscOrder.length === 0;
  if (key2Label && miscOrder.length) {
    const names = miscOrder.map((id) => TOOLS_TAB_LABELS[id] || id).join(" / ");
    key2Label.textContent = `Cycle Tools pages (${names})`;
  }
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
  img.src = "./assets/logo.png";
}

const BG_STAR_COUNT = 80;
const BG_STAR_SPAWN_EDGES = ["top", "left", "bottom"];

function normalizeBgPattern(stored) {
  if (stored === "none" || stored === "grid" || stored === "dots" || stored === "flow" || stored === "particles" || stored === "stars") {
    return stored;
  }
  return "waves";
}

const BG_PATTERN_LABELS = {
  waves: "Waves",
  grid: "Grid",
  dots: "Dots",
  flow: "Flow",
  particles: "Particles",
  stars: "Stars",
  none: "None",
};

const BG_PATTERN_ICONS = {
  waves: "ri-pulse-line",
  grid: "ri-layout-grid-line",
  dots: "ri-more-2-fill",
  flow: "ri-arrow-right-line",
  particles: "ri-sparkling-2-line",
  stars: "ri-meteor-line",
  none: "ri-prohibited-line",
};

const BG_IMAGE_IDS = ["sunset-lake", "synthwave-peaks", "neon-city-street", "purple-stag-lake", "moon-mountain-stars", "rustic-coffee-bar", "prismatic-ridge", "cosmic-burst", "dark-wood", "royal-damask", "charcoal-slate", "neon-flame-stream", "magenta-paper-glow", "aged-parchment", "magenta-fluid-waves", "crimson-wire-mesh", "ember-low-poly", "prismatic-low-poly"];

const DEFAULT_BG_IMAGE = "magenta-fluid-waves";
const DEFAULT_BG_BACKDROP_MODE = "image";

const BG_IMAGE_LEGACY_MAP = {
  midnight: "sunset-lake",
  amber: "synthwave-peaks",
  arctic: "sunset-lake",
  "wallpaper-1": "sunset-lake",
  "wallpaper-2": "synthwave-peaks",
  "wallpaper-3": "sunset-lake",
  "wallpaper-4": "neon-city-street",
  "crimson-shards": "neon-city-street",
  "wallpaper-5": "prismatic-ridge",
  "wallpaper-6": "cosmic-burst",
  "wallpaper-7": "sunset-lake",
  "wallpaper-8": "dark-wood",
  "wallpaper-9": "royal-damask",
  "magenta-plexus": "sunset-lake",
};

function normalizeBgImage(stored) {
  if (BG_IMAGE_LEGACY_MAP[stored]) return BG_IMAGE_LEGACY_MAP[stored];
  return BG_IMAGE_IDS.includes(stored) ? stored : "none";
}

const BG_IMAGE_LABELS = {
  none: "None",
  "sunset-lake": "Sunset Lake",
  "synthwave-peaks": "Synthwave Peaks",
  "neon-city-street": "Neon City Street",
  "purple-stag-lake": "Purple Stag Lake",
  "moon-mountain-stars": "Moon Mountain Stars",
  "rustic-coffee-bar": "Rustic Coffee Bar",
  "prismatic-ridge": "Prismatic Ridge",
  "cosmic-burst": "Cosmic Burst",
  "dark-wood": "Dark Wood",
  "royal-damask": "Royal Damask",
  "charcoal-slate": "Charcoal Slate",
  "neon-flame-stream": "Neon Flame Stream",
  "magenta-paper-glow": "Magenta Paper Glow",
  "aged-parchment": "Aged Parchment",
  "magenta-fluid-waves": "Magenta Fluid Waves",
  "crimson-wire-mesh": "Crimson Wire Mesh",
  "ember-low-poly": "Ember Low Poly",
  "prismatic-low-poly": "Prismatic Low Poly",
};

const BG_IMAGE_ICONS = {
  none: "ri-prohibited-line",
  "sunset-lake": "ri-landscape-line",
  "synthwave-peaks": "ri-contrast-2-line",
  "neon-city-street": "ri-building-4-line",
  "purple-stag-lake": "ri-landscape-line",
  "moon-mountain-stars": "ri-moon-clear-line",
  "rustic-coffee-bar": "ri-cup-line",
  "prismatic-ridge": "ri-sparkling-2-line",
  "cosmic-burst": "ri-planet-line",
  "dark-wood": "ri-layout-row-line",
  "royal-damask": "ri-vip-crown-line",
  "charcoal-slate": "ri-layout-row-line",
  "neon-flame-stream": "ri-fire-line",
  "magenta-paper-glow": "ri-artboard-line",
  "aged-parchment": "ri-file-paper-2-line",
  "magenta-fluid-waves": "ri-contrast-2-line",
  "crimson-wire-mesh": "ri-grid-line",
  "ember-low-poly": "ri-shape-line",
  "prismatic-low-poly": "ri-shapes-line",
};

const BG_BACKDROP_PATTERN_ORDER = ["waves", "grid", "dots", "flow", "particles", "stars"];
const BG_BACKDROP_IMAGE_ORDER = [...BG_IMAGE_IDS];

function normalizeBgBackdropMode(stored, pattern, image) {
  if (stored === "pattern" || stored === "image" || stored === "none") return stored;
  const normPattern = normalizeBgPattern(pattern);
  const normImage = normalizeBgImage(image);
  if (normPattern === "particles" || normPattern === "stars" || normPattern === "flow") return "pattern";
  if (normPattern === "none" && normImage === "none") return "none";
  if (normImage !== "none") return "image";
  return "pattern";
}

function getDefaultBgBackdropValue(mode) {
  if (mode === "image") {
    const saved = normalizeBgImage(localStorage.getItem("prefBgImage"));
    return saved !== "none" ? saved : DEFAULT_BG_IMAGE;
  }
  if (mode === "pattern") {
    const saved = normalizeBgPattern(localStorage.getItem("prefBgPattern"));
    return saved !== "none" ? saved : "waves";
  }
  return "none";
}

function getBgBackdropLabels(mode) {
  return mode === "image" ? BG_IMAGE_LABELS : BG_PATTERN_LABELS;
}

function getBgBackdropIcons(mode) {
  return mode === "image" ? BG_IMAGE_ICONS : BG_PATTERN_ICONS;
}

function normalizeBgBackdropValue(mode, value) {
  return mode === "image" ? normalizeBgImage(value) : normalizeBgPattern(value);
}

function getBgBackdropOptionOrder(mode) {
  return mode === "image" ? BG_BACKDROP_IMAGE_ORDER : BG_BACKDROP_PATTERN_ORDER;
}

function randomBgStarSpawn(edge) {
  const chosen = edge || BG_STAR_SPAWN_EDGES[Math.floor(Math.random() * BG_STAR_SPAWN_EDGES.length)];
  if (chosen === "left") {
    return {
      top: `${8 + Math.random() * 72}%`,
      left: `${-18 - Math.random() * 10}%`,
    };
  }
  if (chosen === "bottom") {
    return {
      top: `${92 + Math.random() * 14}%`,
      left: `${8 + Math.random() * 55}%`,
    };
  }
  return {
    top: `${-16 - Math.random() * 10}%`,
    left: `${8 + Math.random() * 78}%`,
  };
}

function mountBgStars(root, { count = BG_STAR_COUNT, animate = true } = {}) {
  if (!root) return null;
  root.innerHTML = "";
  root.classList.add("bg-stars");
  root.dataset.bgStarCount = String(count);

  const field = document.createElement("div");
  field.className = "bg-starfield";
  for (let i = 0; i < count; i += 1) {
    const dot = document.createElement("span");
    dot.className = "bg-starfield-dot";
    const size = 1 + Math.random() * 1.5;
    dot.style.setProperty("--dot-x", `${(Math.random() * 100).toFixed(2)}%`);
    dot.style.setProperty("--dot-y", `${(Math.random() * 100).toFixed(2)}%`);
    dot.style.setProperty("--dot-size", `${size.toFixed(2)}px`);
    dot.style.setProperty("--dot-opacity", String((0.28 + Math.random() * 0.55).toFixed(2)));
    dot.style.setProperty("--dot-delay", `${(Math.random() * 4).toFixed(2)}s`);
    field.appendChild(dot);
  }
  root.appendChild(field);

  function applyBgStarSpawn(star) {
    const spawn = randomBgStarSpawn();
    star.style.setProperty("--star-top", spawn.top);
    star.style.setProperty("--star-left", spawn.left);
    star.style.setProperty("--star-duration", `${(1.8 + Math.random() * 1.8).toFixed(2)}s`);
    star.style.setProperty("--star-length", `${(5.5 + Math.random() * 3.75).toFixed(2)}rem`);
    star.style.setProperty("--star-thickness", Math.random() > 0.55 ? "0.1rem" : "0.125rem");
    star.style.setProperty("--star-opacity", String((0.35 + Math.random() * 0.5).toFixed(2)));
  }

  const stars = [];
  for (let i = 0; i < count; i += 1) {
    const star = document.createElement("span");
    star.className = "bg-star";
    applyBgStarSpawn(star);
    root.appendChild(star);
    stars.push(star);
  }

  const timers = [];
  let stopped = false;
  let lastIndex = -1;

  function shootOne() {
    if (stopped || !animate || !stars.length) return;

    let index = Math.floor(Math.random() * stars.length);
    if (stars.length > 1 && index === lastIndex) {
      index = (index + 1 + Math.floor(Math.random() * (stars.length - 1))) % stars.length;
    }
    lastIndex = index;

    const star = stars[index];
    applyBgStarSpawn(star);
    star.classList.remove("is-shooting");
    void star.offsetWidth;
    star.classList.add("is-shooting");

    const durationMs = (parseFloat(star.style.getPropertyValue("--star-duration")) || 2.4) * 1000;
    let settled = false;
    const settle = () => {
      if (settled || stopped) return;
      settled = true;
      star.removeEventListener("animationend", onEnd);
      star.classList.remove("is-shooting");
      scheduleNext();
    };
    const onEnd = (event) => {
      if (event.target !== star) return;
      if (event.animationName && event.animationName !== "bg-shooting-star") return;
      settle();
    };
    star.addEventListener("animationend", onEnd);
    timers.push(setTimeout(settle, durationMs + 60));
  }

  function scheduleNext() {
    if (stopped || !animate) return;
    const wait = 1000 + Math.random() * 4000;
    timers.push(setTimeout(shootOne, wait));
  }

  if (animate) scheduleNext();

  return {
    count,
    schedule: animate ? "solo-1-5" : "static",
    destroy() {
      stopped = true;
      while (timers.length) clearTimeout(timers.pop());
      root.innerHTML = "";
      delete root.dataset.bgStarCount;
    },
  };
}

const bgStars = {
  layer: null,
  controller: null,

  motionAllowed() {
    return !document.body.classList.contains("reduce-motion");
  },

  ensure() {
    this.layer = document.getElementById("bg-stars");
    return this.layer;
  },

  sync() {
    const layer = this.ensure();
    if (!layer) return;
    const patternOn = document.documentElement.dataset.bgPattern === "stars";
    if (!patternOn) {
      if (this.controller) {
        this.controller.destroy();
        this.controller = null;
      }
      return;
    }
    const animate = this.motionAllowed();
    const schedule = animate ? "solo-1-5" : "static";
    if (this.controller?.count === BG_STAR_COUNT && this.controller?.schedule === schedule) return;
    this.controller?.destroy();
    this.controller = mountBgStars(layer, { count: BG_STAR_COUNT, animate });
  },
};

const DEFAULT_FONT_FAMILY_ID = "inter";

const FONT_FAMILY_IDS = new Set(["inter", "roboto", "poppins", "space-grotesk", "dm-sans", "montserrat", "open-sans", "lato", "nunito", "raleway", "ubuntu", "source-sans-3", "work-sans", "outfit", "manrope", "oswald", "rubik", "lexend", "plus-jakarta-sans", "figtree"]);

const FONT_FAMILY_STACKS = {
  inter: '"Inter", sans-serif',
  roboto: '"Roboto", sans-serif',
  poppins: '"Poppins", sans-serif',
  "space-grotesk": '"Space Grotesk", sans-serif',
  "dm-sans": '"DM Sans", sans-serif',
  montserrat: '"Montserrat", sans-serif',
  "open-sans": '"Open Sans", sans-serif',
  lato: '"Lato", sans-serif',
  nunito: '"Nunito", sans-serif',
  raleway: '"Raleway", sans-serif',
  ubuntu: '"Ubuntu", sans-serif',
  "source-sans-3": '"Source Sans 3", sans-serif',
  "work-sans": '"Work Sans", sans-serif',
  outfit: '"Outfit", sans-serif',
  manrope: '"Manrope", sans-serif',
  oswald: '"Oswald", sans-serif',
  rubik: '"Rubik", sans-serif',
  lexend: '"Lexend", sans-serif',
  "plus-jakarta-sans": '"Plus Jakarta Sans", sans-serif',
  figtree: '"Figtree", sans-serif',
};

const FONT_FAMILY_LABELS = {
  inter: "Inter",
  roboto: "Roboto",
  poppins: "Poppins",
  "space-grotesk": "Space Grotesk",
  "dm-sans": "DM Sans",
  montserrat: "Montserrat",
  "open-sans": "Open Sans",
  lato: "Lato",
  nunito: "Nunito",
  raleway: "Raleway",
  ubuntu: "Ubuntu",
  "source-sans-3": "Source Sans 3",
  "work-sans": "Work Sans",
  outfit: "Outfit",
  manrope: "Manrope",
  oswald: "Oswald",
  rubik: "Rubik",
  lexend: "Lexend",
  "plus-jakarta-sans": "Plus Jakarta Sans",
  figtree: "Figtree",
};

const GOOGLE_FONT_URLS = {
  inter: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  roboto: "https://fonts.googleapis.com/css2?family=Roboto:ital,wght@0,100..900;1,100..900&display=swap",
  poppins: "https://fonts.googleapis.com/css2?family=Poppins:ital,wght@0,100..900;1,100..900&display=swap",
  "space-grotesk": "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300..700&display=swap",
  "dm-sans": "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap",
  montserrat: "https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,100..900;1,100..900&display=swap",
  "open-sans": "https://fonts.googleapis.com/css2?family=Open+Sans:ital,wght@0,300..800;1,300..800&display=swap",
  lato: "https://fonts.googleapis.com/css2?family=Lato:ital,wght@0,100;0,300;0,400;0,700;0,900;1,100;1,300;1,400;1,700;1,900&display=swap",
  nunito: "https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,200..1000;1,200..1000&display=swap",
  raleway: "https://fonts.googleapis.com/css2?family=Raleway:ital,wght@0,100..900;1,100..900&display=swap",
  ubuntu: "https://fonts.googleapis.com/css2?family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,500;1,700&display=swap",
  "source-sans-3": "https://fonts.googleapis.com/css2?family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap",
  "work-sans": "https://fonts.googleapis.com/css2?family=Work+Sans:ital,wght@0,100..900;1,100..900&display=swap",
  outfit: "https://fonts.googleapis.com/css2?family=Outfit:wght@100..900&display=swap",
  manrope: "https://fonts.googleapis.com/css2?family=Manrope:wght@200..800&display=swap",
  oswald: "https://fonts.googleapis.com/css2?family=Oswald:wght@200..700&display=swap",
  rubik: "https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,300..900;1,300..900&display=swap",
  lexend: "https://fonts.googleapis.com/css2?family=Lexend:wght@100..900&display=swap",
  "plus-jakarta-sans": "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,200..800;1,200..800&display=swap",
  figtree: "https://fonts.googleapis.com/css2?family=Figtree:ital,wght@0,300..900;1,300..900&display=swap",
};

const loadedGoogleFonts = new Set(["inter"]);

function ensureGoogleFontLoaded(fontId) {
  const id = normalizeFontFamily(fontId);
  if (loadedGoogleFonts.has(id)) return;
  const href = GOOGLE_FONT_URLS[id];
  if (!href) return;
  loadedGoogleFonts.add(id);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function preloadFontPickerFamilies() {
  FONT_FAMILY_IDS.forEach((id) => ensureGoogleFontLoaded(id));
}

function getAppFontFamilyStack() {
  const stack = getComputedStyle(document.documentElement).getPropertyValue("--app-font-family").trim();
  return stack || FONT_FAMILY_STACKS.inter;
}

function getTextSizeScale() {
  const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--text-size-scale"));
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function canvasFont(descriptor) {
  const scale = getTextSizeScale();
  const scaled = String(descriptor).replace(/(\d+(?:\.\d+)?)(px|rem)/g, (_, size, unit) => `${parseFloat(size) * scale}${unit}`);
  return `${scaled} ${getAppFontFamilyStack()}`;
}

function normalizeFontFamily(stored) {
  const value = String(stored || "inter")
    .trim()
    .toLowerCase();
  return FONT_FAMILY_IDS.has(value) ? value : DEFAULT_FONT_FAMILY_ID;
}

function getFontFamilyDisplayLabel(id) {
  const normalized = normalizeFontFamily(id);
  const name = FONT_FAMILY_LABELS[normalized] || normalized;
  if (normalized !== DEFAULT_FONT_FAMILY_ID) return name;
  return `${name} <span class="font-family-default-tag">(default)</span>`;
}

function applyFontFamily(value) {
  const normalized = normalizeFontFamily(value);
  ensureGoogleFontLoaded(normalized);
  const stack = FONT_FAMILY_STACKS[normalized] || FONT_FAMILY_STACKS.inter;
  document.documentElement.style.setProperty("--app-font-family", stack);
  document.documentElement.dataset.fontFamily = normalized;
  requestProfileChartsRedraw();
  aimTrainer?.render?.();
  if (typeof renderTargetSpreadPreviewCanvas === "function") {
    renderTargetSpreadPreviewCanvas(spreadPreviewAnim.scale);
  }
}

function syncFontFamilyDropdownUi(value) {
  const normalized = normalizeFontFamily(value);
  const label = document.getElementById("font-family-label");
  const list = document.getElementById("font-family-list");
  if (label) {
    label.innerHTML = getFontFamilyDisplayLabel(normalized);
    label.dataset.fontFamily = normalized;
  }
  list?.querySelectorAll(".pref-dropdown-option").forEach((opt) => {
    opt.classList.toggle("active", opt.getAttribute("data-font-family") === normalized);
  });
}

const bgParticles = {
  canvas: null,
  ctx: null,
  particles: [],
  width: 0,
  height: 0,
  _active: false,
  _rafId: null,
  _lastTime: 0,

  motionAllowed() {
    return !document.body.classList.contains("reduce-motion");
  },

  init() {
    this.canvas = document.getElementById("bg-particles-canvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    window.addEventListener("resize", () => {
      if (document.documentElement.dataset.bgPattern !== "particles") return;
      if (this._active) this.resize(true);
      else if (this.canvas?.classList.contains("is-active")) this.showStatic();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stopAnimation();
      else if (this._active) this.startAnimation();
    });
    this.sync();
  },

  sync() {
    const on = document.documentElement.dataset.bgPattern === "particles";
    if (!on) {
      this.stop();
      return;
    }
    if (!this.canvas || !this.ctx) return;
    if (this.motionAllowed()) this.start();
    else this.showStatic();
  },

  showStatic() {
    this._active = false;
    this.stopAnimation();
    if (!this.canvas || !this.ctx) return;
    this.canvas.classList.add("is-active");
    this.resize(true);
    this.draw(0);
  },

  start() {
    if (!this.canvas || !this.ctx) return;
    this._active = true;
    this.canvas.classList.add("is-active");
    this.resize(true);
    this.startAnimation();
  },

  stop() {
    this._active = false;
    this.stopAnimation();
    this.canvas?.classList.remove("is-active");
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  },

  startAnimation() {
    if (!this._active) return;
    this.stopAnimation();
    this._lastTime = 0;
    this._rafId = nativeRequestAnimationFrame((time) => this.tick(time));
  },

  stopAnimation() {
    if (this._rafId != null) {
      nativeCancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._lastTime = 0;
  },

  tick(time) {
    if (!this._active) {
      this._rafId = null;
      return;
    }

    if (!this._lastTime) this._lastTime = time;
    const dt = Math.min((time - this._lastTime) / 1000, 0.05);
    this._lastTime = time;

    this.draw(dt);
    this._rafId = nativeRequestAnimationFrame((nextTime) => this.tick(nextTime));
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
      vx: (Math.random() - 0.5) * 15,
      vy: (Math.random() - 0.5) * 15,
      a: Math.random() * 0.4 + 0.18,
    }));
  },

  draw(dt) {
    const { ctx, width, height, particles } = this;
    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.x < -5) p.x = width + 5;
      if (p.x > width + 5) p.x = -5;
      if (p.y < -5) p.y = height + 5;
      if (p.y > height + 5) p.y = -5;
    }

    const linkDistance = Math.min(150, Math.max(95, Math.min(width, height) * 0.14));
    const linkDistanceSq = linkDistance * linkDistance;

    const highContrast = document.documentElement.classList.contains("high-contrast");
    const alphaBoost = highContrast ? 3 : 1;

    for (let i = 0; i < particles.length; i++) {
      const a = particles[i];
      for (let j = i + 1; j < particles.length; j++) {
        const b = particles[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const distSq = dx * dx + dy * dy;
        if (distSq > linkDistanceSq) continue;

        const dist = Math.sqrt(distSq);
        const lineAlpha = Math.min(0.55, (1 - dist / linkDistance) * 0.24 * alphaBoost);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `hsla(0, 0%, 100%, ${lineAlpha})`;
        ctx.lineWidth = highContrast ? 1.25 : 1;
        ctx.stroke();
      }
    }

    for (const p of particles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, highContrast ? p.r * 1.15 : p.r, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(0, 0%, 100%, ${Math.min(0.85, p.a * alphaBoost)})`;
      ctx.fill();
    }
  },
};

const BG_FLOW_SPACING = 34;
const BG_FLOW_DIRECTIONS = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
const BG_FLOW_TRAIL_POINTS = 16;

const bgFlow = {
  canvas: null,
  ctx: null,
  travelers: [],
  width: 0,
  height: 0,
  cols: 0,
  rows: 0,
  _dpr: 1,
  _dotLayer: null,
  _active: false,
  _rafId: null,
  _lastTime: 0,

  motionAllowed() {
    return !document.body.classList.contains("reduce-motion");
  },

  init() {
    this.canvas = document.getElementById("bg-flow-canvas");
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext("2d");
    window.addEventListener("resize", () => {
      if (document.documentElement.dataset.bgPattern !== "flow") return;
      if (this._active) this.resize(true);
      else if (this.canvas?.classList.contains("is-active")) this.showStatic();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stopAnimation();
      else if (this._active) this.startAnimation();
    });
    this.sync();
  },

  sync() {
    const on = document.documentElement.dataset.bgPattern === "flow";
    if (!on) {
      this.stop();
      return;
    }
    if (!this.canvas || !this.ctx) return;
    if (this.motionAllowed()) this.start();
    else this.showStatic();
  },

  showStatic() {
    this._active = false;
    this.stopAnimation();
    if (!this.canvas || !this.ctx) return;
    this.canvas.classList.add("is-active");
    this.resize(true);
    this.draw(0);
  },

  start() {
    if (!this.canvas || !this.ctx) return;
    this._active = true;
    this.canvas.classList.add("is-active");
    this.resize(true);
    this.startAnimation();
  },

  stop() {
    this._active = false;
    this.stopAnimation();
    this.canvas?.classList.remove("is-active");
    if (this.ctx && this.canvas) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  },

  startAnimation() {
    if (!this._active) return;
    this.stopAnimation();
    this._lastTime = 0;
    this._rafId = nativeRequestAnimationFrame((time) => this.tick(time));
  },

  stopAnimation() {
    if (this._rafId != null) {
      nativeCancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._lastTime = 0;
  },

  tick(time) {
    if (!this._active) {
      this._rafId = null;
      return;
    }

    if (!this._lastTime) this._lastTime = time;
    const dt = Math.min((time - this._lastTime) / 1000, 0.05);
    this._lastTime = time;

    this.draw(dt);
    this._rafId = nativeRequestAnimationFrame((nextTime) => this.tick(nextTime));
  },

  resize(reseed) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this._dpr = dpr;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cols = Math.max(2, Math.ceil(this.width / BG_FLOW_SPACING) + 1);
    this.rows = Math.max(2, Math.ceil(this.height / BG_FLOW_SPACING) + 1);
    this.buildDotLayer();
    if (reseed) this.seed();
  },

  // The lattice never moves, so it is rasterised once per resize and blitted
  // each frame instead of re-stroking a few thousand arcs.
  buildDotLayer() {
    const dpr = this._dpr;
    const layer = this._dotLayer || (this._dotLayer = document.createElement("canvas"));
    layer.width = Math.round(this.width * dpr);
    layer.height = Math.round(this.height * dpr);
    const lctx = layer.getContext("2d");
    lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lctx.clearRect(0, 0, this.width, this.height);
    lctx.fillStyle = "hsl(0, 0%, 100%)";
    for (let gy = 0; gy < this.rows; gy++) {
      for (let gx = 0; gx < this.cols; gx++) {
        lctx.beginPath();
        lctx.arc(gx * BG_FLOW_SPACING, gy * BG_FLOW_SPACING, 1.15, 0, Math.PI * 2);
        lctx.fill();
      }
    }
  },

  seed() {
    const count = Math.min(22, Math.max(6, Math.round((this.width * this.height) / 62000)));
    this.travelers = Array.from({ length: count }, () => this.spawn(true));
  },

  spawn(scatterAge) {
    const life = 7 + Math.random() * 9;
    return {
      gx: Math.floor(Math.random() * this.cols),
      gy: Math.floor(Math.random() * this.rows),
      dir: Math.floor(Math.random() * 4),
      t: Math.random(),
      speed: 1 + Math.random() * 1.4,
      life,
      age: scatterAge ? Math.random() * life * 0.7 : 0,
      trail: [],
    };
  },

  advance(traveler, dt) {
    traveler.age += dt;
    traveler.t += traveler.speed * dt;

    while (traveler.t >= 1) {
      traveler.t -= 1;
      const dir = BG_FLOW_DIRECTIONS[traveler.dir];
      traveler.gx += dir.x;
      traveler.gy += dir.y;

      if (traveler.gx < 0 || traveler.gx >= this.cols || traveler.gy < 0 || traveler.gy >= this.rows) {
        return false;
      }

      // Mostly carry straight on, occasionally take a 90-degree turn. Never
      // double back, so the path always reads as following the lattice.
      const roll = Math.random();
      if (roll > 0.72) traveler.dir = (traveler.dir + (roll > 0.86 ? 1 : 3)) % 4;
    }

    return traveler.age < traveler.life;
  },

  headPosition(traveler) {
    const dir = BG_FLOW_DIRECTIONS[traveler.dir];
    return {
      x: (traveler.gx + dir.x * traveler.t) * BG_FLOW_SPACING,
      y: (traveler.gy + dir.y * traveler.t) * BG_FLOW_SPACING,
    };
  },

  draw(dt) {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);

    const highContrast = document.documentElement.classList.contains("high-contrast");

    if (this._dotLayer) {
      ctx.globalAlpha = highContrast ? 0.16 : 0.07;
      ctx.drawImage(this._dotLayer, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-color").trim() || "#ef0141";
    const peakAlpha = highContrast ? 0.85 : 0.5;

    ctx.strokeStyle = accent;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 0; i < this.travelers.length; i++) {
      const traveler = this.travelers[i];

      if (dt > 0 && !this.advance(traveler, dt)) {
        this.travelers[i] = this.spawn(false);
        continue;
      }

      const head = this.headPosition(traveler);
      traveler.trail.push(head);
      if (traveler.trail.length > BG_FLOW_TRAIL_POINTS) traveler.trail.shift();

      const fadeIn = Math.min(1, traveler.age / 0.8);
      const fadeOut = Math.min(1, Math.max(0, (traveler.life - traveler.age) / 1.2));
      const fade = Math.min(fadeIn, fadeOut);
      if (fade <= 0) continue;

      const trail = traveler.trail;
      ctx.lineWidth = 1.4;
      for (let p = 1; p < trail.length; p++) {
        const from = trail[p - 1];
        const to = trail[p];
        // Skip the wrap-around segment created when a traveler respawns.
        if (Math.abs(to.x - from.x) > BG_FLOW_SPACING || Math.abs(to.y - from.y) > BG_FLOW_SPACING) continue;
        ctx.globalAlpha = (p / trail.length) * peakAlpha * fade * 0.55;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
      }

      const dir = BG_FLOW_DIRECTIONS[traveler.dir];
      const angle = Math.atan2(dir.y, dir.x);
      ctx.globalAlpha = peakAlpha * fade;
      ctx.lineWidth = 1.6;
      ctx.save();
      ctx.translate(head.x, head.y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-4.6, -3);
      ctx.lineTo(0, 0);
      ctx.lineTo(-4.6, 3);
      ctx.stroke();
      ctx.restore();
    }

    ctx.globalAlpha = 1;
  },
};

function applyBgPattern(mode) {
  document.documentElement.dataset.bgPattern = normalizeBgPattern(mode);
  bgParticles.sync();
  bgStars.sync();
  bgFlow.sync();
}

function applyBgImage(mode) {
  const normalized = normalizeBgImage(mode);
  if (normalized === "none") {
    delete document.documentElement.dataset.bgImage;
  } else {
    document.documentElement.dataset.bgImage = normalized;
  }
}

function syncGlassThemeFromBackdrop(mode) {
  const on = mode === "image";
  document.documentElement.classList.toggle("glass-theme", on);
  document.body.classList.toggle("glass-theme", on);
}

function applyBgBackdrop(mode, value) {
  const normalizedMode = mode === "image" ? "image" : mode === "none" ? "none" : "pattern";
  if (normalizedMode === "image") {
    const image = normalizeBgImage(value);
    const resolved = image === "none" ? DEFAULT_BG_IMAGE : image;
    applyBgImage(resolved);
    applyBgPattern("none");
    localStorage.setItem("prefBgImage", resolved);
  } else if (normalizedMode === "none") {
    applyBgPattern("none");
    applyBgImage("none");
  } else {
    const pattern = normalizeBgPattern(value);
    const resolved = pattern === "none" ? "waves" : pattern;
    applyBgPattern(resolved);
    applyBgImage("none");
    localStorage.setItem("prefBgPattern", resolved);
  }
  localStorage.setItem("prefBgBackdropMode", normalizedMode);
  syncGlassThemeFromBackdrop(normalizedMode);
}

function getBgBackdropLabelPool() {
  return [...new Set([...Object.values(BG_PATTERN_LABELS), ...Object.values(BG_IMAGE_LABELS)])];
}

function syncBgBackdropTriggerWidth() {
  const dropdown = document.getElementById("bg-backdrop-dropdown");
  const trigger = document.getElementById("bg-backdrop-trigger");
  if (!dropdown || !trigger) return;

  let measurer = syncBgBackdropTriggerWidth._measurer;
  if (!measurer) {
    measurer = document.createElement("button");
    measurer.type = "button";
    measurer.className = "pref-dropdown-trigger";
    measurer.setAttribute("aria-hidden", "true");
    measurer.tabIndex = -1;
    measurer.style.cssText = "position:absolute;top:-9999px;left:-9999px;visibility:hidden;pointer-events:none;width:max-content;";
    measurer.innerHTML =
      '<span class="pref-dropdown-value"><i class="ri-pulse-line pref-dropdown-icon" aria-hidden="true"></i><span data-bg-backdrop-measure-label></span></span><i class="ri-arrow-down-s-line pref-dropdown-chevron" aria-hidden="true"></i>';
    document.body.appendChild(measurer);
    syncBgBackdropTriggerWidth._measurer = measurer;
  }

  const labelEl = measurer.querySelector("[data-bg-backdrop-measure-label]");
  if (!labelEl) return;

  let maxWidth = 0;
  for (const label of getBgBackdropLabelPool()) {
    labelEl.textContent = label;
    maxWidth = Math.max(maxWidth, measurer.offsetWidth);
  }

  if (maxWidth > 0) {
    dropdown.style.width = `${maxWidth}px`;
    dropdown.style.minWidth = `${maxWidth}px`;
  }
}

function renderBgBackdropList(mode, activeValue) {
  const list = document.getElementById("bg-backdrop-list");
  if (!list) return;

  const labels = getBgBackdropLabels(mode);
  const icons = getBgBackdropIcons(mode);
  const normalizedValue = normalizeBgBackdropValue(mode, activeValue);

  list.innerHTML = getBgBackdropOptionOrder(mode)
    .map((value) => {
      const activeClass = value === normalizedValue ? " active" : "";
      return `<button type="button" class="pref-dropdown-option${activeClass}" data-bg-backdrop-value="${value}" role="option"><i class="${icons[value] || "ri-palette-line"} pref-dropdown-option-icon" aria-hidden="true"></i><span>${labels[value] || value}</span></button>`;
    })
    .join("");
}

function syncBgBackdropUi(mode, value) {
  const normalizedMode = mode === "image" ? "image" : mode === "none" ? "none" : "pattern";
  const normalizedValue = normalizedMode === "none" ? "none" : normalizeBgBackdropValue(normalizedMode, value);
  const labels = getBgBackdropLabels(normalizedMode);
  const icons = getBgBackdropIcons(normalizedMode);
  const label = document.getElementById("bg-backdrop-label");
  const icon = document.getElementById("bg-backdrop-icon");
  const modeSelector = document.getElementById("bg-backdrop-mode-selector");
  const dropdown = document.getElementById("bg-backdrop-dropdown");
  const control = document.querySelector(".bg-backdrop-control");

  if (label) {
    label.textContent = normalizedMode === "none" ? "None" : labels[normalizedValue] || normalizedValue;
  }
  if (icon) {
    icon.className = normalizedMode === "none" ? "ri-prohibited-line pref-dropdown-icon" : `${icons[normalizedValue] || "ri-palette-line"} pref-dropdown-icon`;
  }

  if (dropdown) {
    dropdown.hidden = normalizedMode === "none";
  }
  control?.classList.toggle("is-backdrop-none", normalizedMode === "none");

  if (modeSelector) {
    modeSelector.querySelectorAll(".toggle-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-bg-backdrop-mode") === normalizedMode);
    });
    positionToggleGlider(modeSelector);
  }

  if (normalizedMode !== "none") {
    renderBgBackdropList(normalizedMode, normalizedValue);
  }

  requestAnimationFrame(() => syncBgBackdropTriggerWidth());
}

const prefDropdownPortalTrackers = new Map();

function positionPrefDropdownPortal(list, trigger) {
  positionFloatingPanel(list, trigger, { gap: 6, matchTriggerWidth: true });
}

function positionAccentCustomPanelPortal(panel, trigger) {
  positionFloatingPanel(panel, trigger, { gap: 6, panelWidth: 232, matchTriggerWidth: false, maxPanelHeight: null });
}

function syncPrefDropdownPortalPosition(list, trigger) {
  if (!list?.classList.contains("pref-dropdown-list-portal") || list.classList.contains("hidden")) return;
  if (typeof list._portalPositionFn === "function") {
    list._portalPositionFn(list, trigger);
    return;
  }
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
  list.classList.remove("pref-dropdown-list-opens-up");
  list.style.top = "";
  list.style.left = "";
  list.style.width = "";
  list.style.maxHeight = "";
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

  dismissLineupMapSearchDropdown({ force: true });
  dismissLineupGameSearchDropdown({ force: true });
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
    initBgBackdropControl.close?.();
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

function initBgBackdropControl(savedMode, savedPattern, savedImage) {
  const dropdown = document.getElementById("bg-backdrop-dropdown");
  const trigger = document.getElementById("bg-backdrop-trigger");
  const list = document.getElementById("bg-backdrop-list");
  const modeSelector = document.getElementById("bg-backdrop-mode-selector");
  if (!dropdown || !trigger || !list || !modeSelector || initBgBackdropControl._init) return;
  initBgBackdropControl._init = true;

  let currentMode = normalizeBgBackdropMode(savedMode, savedPattern, savedImage);

  const close = () => {
    dropdown.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    unmountPrefDropdownPortal(list);
  };

  const open = () => {
    initTrainerModeDropdown.close?.();
    initFontFamilyDropdown.close?.();
    dropdown.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.classList.remove("hidden");
    mountPrefDropdownPortal(list, trigger);
  };

  initBgBackdropControl.close = close;
  syncBgBackdropUi(currentMode, currentMode === "image" ? savedImage : currentMode === "pattern" ? savedPattern : "none");

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("is-open")) close();
    else open();
  });

  list.addEventListener("click", (e) => {
    const opt = e.target.closest(".pref-dropdown-option");
    if (!opt || !list.contains(opt)) return;
    const value = opt.getAttribute("data-bg-backdrop-value");
    applyBgBackdrop(currentMode, value);
    syncBgBackdropUi(currentMode, value);
    close();
  });

  modeSelector.querySelectorAll(".toggle-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rawMode = btn.getAttribute("data-bg-backdrop-mode");
      const mode = rawMode === "image" ? "image" : rawMode === "none" ? "none" : "pattern";
      currentMode = mode;
      localStorage.setItem("prefBgBackdropMode", mode);
      const value = getDefaultBgBackdropValue(mode);
      applyBgBackdrop(mode, value);
      syncBgBackdropUi(mode, value);
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

function initFontFamilyDropdown(savedValue) {
  const dropdown = document.getElementById("font-family-dropdown");
  const trigger = document.getElementById("font-family-trigger");
  const list = document.getElementById("font-family-list");
  if (!dropdown || !trigger || !list || initFontFamilyDropdown._init) return;
  initFontFamilyDropdown._init = true;

  const close = () => {
    dropdown.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    list.classList.add("hidden");
    unmountPrefDropdownPortal(list);
  };

  const open = () => {
    preloadFontPickerFamilies();
    initTrainerModeDropdown.close?.();
    initBgBackdropControl.close?.();
    dropdown.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    list.classList.remove("hidden");
    mountPrefDropdownPortal(list, trigger);
  };

  initFontFamilyDropdown.close = close;
  syncFontFamilyDropdownUi(savedValue);

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (dropdown.classList.contains("is-open")) close();
    else open();
  });

  list.querySelectorAll(".pref-dropdown-option").forEach((opt) => {
    opt.addEventListener("click", () => {
      const value = normalizeFontFamily(opt.getAttribute("data-font-family"));
      applyFontFamily(value);
      localStorage.setItem("prefFontFamily", value);
      syncFontFamilyDropdownUi(value);
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
      if (SETTINGS_MODAL_TAB_CONFIG[overlayId]) {
        syncSettingsModalSearchMode(overlay, false);
        resetSettingsModalTabs(overlayId);
      } else if (SETTINGS_MODAL_OVERLAY_IDS.includes(overlayId)) {
        resetTrainerSettingsDropdowns(overlayId);
      }
      return;
    }

    blocks().forEach((block) => {
      const haystack = block.textContent.replace(/\s+/g, " ").trim().toLowerCase();
      block.classList.toggle("is-filtered-out", !haystack.includes(query));
    });

    sections().forEach((section) => {
      const hasVisible = section.querySelector(".setting-block:not(.is-filtered-out)");
      section.classList.toggle("is-filtered-out", !hasVisible);
    });

    if (SETTINGS_MODAL_TAB_CONFIG[overlayId]) {
      syncSettingsModalSearchMode(overlay, true);
      setTimeout(() => {
        updateAllToggleGliders();
        syncToggleGlider(getSettingsModalTabSelector(overlay));
      }, 340);
    } else if (SETTINGS_MODAL_OVERLAY_IDS.includes(overlayId)) {
      sections().forEach((section) => {
        if (!section.classList.contains("is-filtered-out")) {
          openTrainerSettingsDropdownAncestors(section, overlay);
        }
      });
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
    initBgBackdropControl.close?.();
    initFontFamilyDropdown.close?.();
    resetSettingsModalSearch("theme-settings-overlay");
    resetTrainerSettingsDropdowns("theme-settings-overlay");
    syncBodyScrollLock();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const open = () => {
    overlay.classList.add("active");
    syncBodyScrollLock();
    setTimeout(() => {
      updateAllToggleGliders();
      syncToggleGlider(getSettingsModalTabSelector(overlay));
    }, 50);
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

  const savedChatPingVolume = Math.max(
    0,
    Math.min(100, parseInt(localStorage.getItem("prefChatPingVolume") ?? "25", 10) || 0),
  );
  bindVolumeSlider("chat-ping-volume", "chat-ping-volume-label", savedChatPingVolume, (pct) => {
    localStorage.setItem("prefChatPingVolume", String(pct));
  });

  initChatPingSoundSettings();
}

function initChatPingSoundSettings() {
  const chat = window.MorningRoastChat;
  const label = document.getElementById("chat-ping-sound-label");
  const prev = document.getElementById("chat-ping-sound-prev");
  const next = document.getElementById("chat-ping-sound-next");
  if (!chat?.getChatPingSounds || !label || !prev || !next) return;

  const syncLabel = () => {
    label.textContent = chat.getChatPingSound()?.label || chat.getChatPingSounds()[0]?.label || "Soft Bell";
  };

  const selectAt = (index) => {
    const sounds = chat.getChatPingSounds();
    if (!sounds.length) return;
    const normalized = ((index % sounds.length) + sounds.length) % sounds.length;
    chat.setChatPingSoundId(sounds[normalized].id);
    syncLabel();
    chat.playChatPingSound?.();
  };

  const activeIndex = () => {
    const sounds = chat.getChatPingSounds();
    const idx = sounds.findIndex((sound) => sound.id === chat.getChatPingSoundId());
    return idx >= 0 ? idx : 0;
  };

  syncLabel();

  prev.addEventListener("click", () => selectAt(activeIndex() - 1));
  next.addEventListener("click", () => selectAt(activeIndex() + 1));
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
    setTimeout(() => {
      updateAllToggleGliders();
      syncToggleGlider(getSettingsModalTabSelector(overlay));
    }, 50);
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
    if (accentRuntime.appliedKey === normalized) return;
    accentRuntime.appliedKey = normalized;
    commitAccentColor(normalized, { instant });
  };
  const applyFontSize = (scale) => {
    const normalized = parseFloat(scale) || 1;
    root.style.fontSize = "16px";
    root.style.setProperty("--text-size-scale", String(normalized));
    requestProfileChartsRedraw();
    aimTrainer?.render?.();
    if (typeof renderTargetSpreadPreviewCanvas === "function") {
      renderTargetSpreadPreviewCanvas(spreadPreviewAnim.scale);
    }
    requestAnimationFrame(() => updateAllToggleGliders());
    requestAnimationFrame(() => syncBgBackdropTriggerWidth());
  };
  const applyContrast = (on) => {
    root.classList.toggle("high-contrast", on);
    body.classList.toggle("high-contrast", on);
  };
  const applyMotion = (on) => {
    body.classList.toggle("reduce-motion", on);
    bgParticles.sync();
    bgStars.sync();
    bgFlow.sync();
  };

  const savedAccent = localStorage.getItem("prefAccent");
  const savedFont = localStorage.getItem("prefFontSize");
  const savedContrast = localStorage.getItem("prefContrast") === "true";
  const savedMotion = localStorage.getItem("prefMotion") === "true";
  const savedRefresh = normalizeUiRefreshMode(localStorage.getItem("prefUiRefresh") || localStorage.getItem("prefHighRefresh"));
  const savedConfirmReset = localStorage.getItem("prefConfirmReset") !== "false";
  const savedDistance360Unit = getDistance360Unit();
  const savedBgPattern = normalizeBgPattern(localStorage.getItem("prefBgPattern"));
  const savedBgImageRaw = localStorage.getItem("prefBgImage");
  const savedBgImage = savedBgImageRaw == null ? DEFAULT_BG_IMAGE : normalizeBgImage(savedBgImageRaw);
  const savedBgBackdropModeRaw = localStorage.getItem("prefBgBackdropMode");
  const savedBgBackdropMode = normalizeBgBackdropMode(savedBgBackdropModeRaw, savedBgPattern, savedBgImage);
  const savedFontFamily = normalizeFontFamily(localStorage.getItem("prefFontFamily"));

  applyAccent(savedAccent || DEFAULT_ACCENT, { instant: true });
  applyFontSize(savedFont || "1");
  applyFontFamily(savedFontFamily);
  applyContrast(savedContrast);
  bgParticles.init();
  bgFlow.init();
  applyMotion(savedMotion);
  applyBgBackdrop(savedBgBackdropMode, savedBgBackdropMode === "image" ? savedBgImage : savedBgBackdropMode === "pattern" ? savedBgPattern : "none");
  initBgBackdropControl(savedBgBackdropMode, savedBgPattern, savedBgImage);
  initFontFamilyDropdown(savedFontFamily);
  setUiRefreshMode(savedRefresh);

  const accentGrid = document.getElementById("accent-grid");
  const accentPicker = document.getElementById("accent-picker");
  const accentPrev = document.getElementById("accent-prev");
  const accentNext = document.getElementById("accent-next");
  const accentLabel = document.getElementById("accent-picker-label");
  const accentColorInput = document.getElementById("accent-color-input");
  const accentCustomSwatch = document.getElementById("accent-custom-color");
  const accentCustomPanel = document.getElementById("accent-custom-panel");
  const accentCustomSpectrum = document.getElementById("accent-custom-spectrum");
  const accentCustomSpectrumCursor = document.getElementById("accent-custom-spectrum-cursor");
  const accentCustomHue = document.getElementById("accent-custom-hue");
  const accentCustomHex = document.getElementById("accent-custom-hex");
  const accentCustomHexSwatch = document.getElementById("accent-custom-hex-swatch");

  const getAccentSwatches = () => (accentGrid ? [...accentGrid.querySelectorAll(".accent-swatch[data-accent]")] : []);

  const parseAccentHsl = (accent) => {
    const normalized = normalizeAccent(accent);
    const [h, s, l] = normalized.split(/\s+/);
    return {
      h: parseFloat(h) || 0,
      s: parseFloat(s) || 0,
      l: parseFloat(l) || 0,
    };
  };

  const clampAccentChannel = (value, min, max) => Math.min(max, Math.max(min, value));

  const customAccentState = { h: 330, s: 99, l: 46, sv: 99, vv: 46, open: false };

  const syncCustomAccentHslFromSpectrum = () => {
    Object.assign(customAccentState, hsvToHsl(customAccentState.h, customAccentState.sv, customAccentState.vv));
  };

  const syncCustomAccentSpectrumFromHsl = () => {
    const hsv = hslToHsv(customAccentState.h, customAccentState.s, customAccentState.l);
    customAccentState.sv = hsv.s;
    customAccentState.vv = hsv.v;
  };

  const setAccentCustomPanelOpen = (open) => {
    customAccentState.open = open;
    if (!accentCustomPanel) {
      accentCustomSwatch?.setAttribute("aria-expanded", "false");
      return;
    }

    if (open) {
      initBgBackdropControl.close?.();
      initFontFamilyDropdown.close?.();
      initTrainerModeDropdown.close?.();
      accentCustomPanel.classList.remove("hidden");
      accentCustomPanel.hidden = false;
      accentCustomPanel._portalPositionFn = positionAccentCustomPanelPortal;
      mountPrefDropdownPortal(accentCustomPanel, accentCustomSwatch);
    } else {
      accentCustomPanel.classList.add("hidden");
      accentCustomPanel.hidden = true;
      unmountPrefDropdownPortal(accentCustomPanel);
      delete accentCustomPanel._portalPositionFn;
    }

    accentCustomSwatch?.setAttribute("aria-expanded", open ? "true" : "false");
  };

  const selectCustomAccent = (hex) => {
    syncAccentSwatchState(null, { custom: true });
    if (accentColorInput) accentColorInput.value = hex;
    if (accentCustomSwatch) syncAccentCustomSwatchStyle(accentCustomSwatch, hex);
    applyAccent(hex);
    localStorage.setItem("prefAccent", normalizeAccent(hex));
  };

  const renderAccentCustomPicker = ({ apply = false } = {}) => {
    const { h, s, l } = customAccentState;
    const hex = hslComponentsToHex(h, s, l);
    const pure = `hsl(${h} 100% 50%)`;

    accentCustomSpectrum?.style.setProperty("--accent-custom-pure", pure);
    if (accentCustomHue) accentCustomHue.value = String(Math.round(h));
    if (accentCustomSpectrumCursor) {
      accentCustomSpectrumCursor.style.left = `${customAccentState.sv}%`;
      accentCustomSpectrumCursor.style.top = `${100 - customAccentState.vv}%`;
    }
    if (accentCustomHex && document.activeElement !== accentCustomHex) {
      accentCustomHex.value = hex.toUpperCase();
      accentCustomHex.classList.remove("invalid");
    }
    if (accentCustomHexSwatch) accentCustomHexSwatch.style.backgroundColor = hex;
    accentCustomSpectrum?.setAttribute("aria-valuenow", String(Math.round(customAccentState.sv)));
    if (accentColorInput) accentColorInput.value = hex;
    if (accentCustomSwatch) syncAccentCustomSwatchStyle(accentCustomSwatch, hex);
    if (apply) selectCustomAccent(hex);
  };

  const loadAccentCustomPickerFromAccent = (accent) => {
    Object.assign(customAccentState, parseAccentHsl(accent));
    syncCustomAccentSpectrumFromHsl();
    renderAccentCustomPicker();
  };

  const setAccentCustomFromSpectrumPoint = (clientX, clientY, { apply = true } = {}) => {
    if (!accentCustomSpectrum) return;
    const rect = accentCustomSpectrum.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    customAccentState.sv = clampAccentChannel(((clientX - rect.left) / rect.width) * 100, 0, 100);
    customAccentState.vv = clampAccentChannel((1 - (clientY - rect.top) / rect.height) * 100, 0, 100);
    syncCustomAccentHslFromSpectrum();
    renderAccentCustomPicker({ apply });
  };

  const initAccentCustomPicker = () => {
    if (!accentCustomSpectrum || initAccentCustomPicker._init) return;
    initAccentCustomPicker._init = true;

    let draggingSpectrum = false;

    const stopSpectrumDrag = () => {
      draggingSpectrum = false;
    };

    accentCustomSpectrum.addEventListener("pointerdown", (e) => {
      draggingSpectrum = true;
      accentCustomSpectrum.setPointerCapture?.(e.pointerId);
      setAccentCustomFromSpectrumPoint(e.clientX, e.clientY);
    });
    accentCustomSpectrum.addEventListener("pointermove", (e) => {
      if (!draggingSpectrum) return;
      setAccentCustomFromSpectrumPoint(e.clientX, e.clientY);
    });
    accentCustomSpectrum.addEventListener("pointerup", stopSpectrumDrag);
    accentCustomSpectrum.addEventListener("pointercancel", stopSpectrumDrag);
    accentCustomSpectrum.addEventListener("lostpointercapture", stopSpectrumDrag);

    accentCustomSpectrum.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 5 : 1;
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        customAccentState.sv = clampAccentChannel(customAccentState.sv - step, 0, 100);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        customAccentState.sv = clampAccentChannel(customAccentState.sv + step, 0, 100);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        customAccentState.vv = clampAccentChannel(customAccentState.vv + step, 0, 100);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        customAccentState.vv = clampAccentChannel(customAccentState.vv - step, 0, 100);
      } else {
        return;
      }
      syncCustomAccentHslFromSpectrum();
      renderAccentCustomPicker({ apply: true });
    });

    accentCustomHue?.addEventListener("input", () => {
      customAccentState.h = clampAccentChannel(Number(accentCustomHue.value) || 0, 0, 360);
      syncCustomAccentHslFromSpectrum();
      renderAccentCustomPicker({ apply: true });
    });

    const syncAccentCustomHexValidity = () => {
      if (!accentCustomHex) return;
      const trimmed = accentCustomHex.value.trim();
      accentCustomHex.classList.toggle("invalid", trimmed !== "" && !parseAccentHexInput(trimmed));
    };

    const commitAccentCustomHexInput = () => {
      if (!accentCustomHex) return;
      const parsed = parseAccentHexInput(accentCustomHex.value);
      if (!parsed) {
        accentCustomHex.value = hslComponentsToHex(customAccentState.h, customAccentState.s, customAccentState.l).toUpperCase();
        accentCustomHex.classList.remove("invalid");
        return;
      }
      accentCustomHex.value = parsed;
      accentCustomHex.classList.remove("invalid");
      Object.assign(customAccentState, parseAccentHsl(parsed));
      syncCustomAccentSpectrumFromHsl();
      renderAccentCustomPicker({ apply: true });
    };

    accentCustomHex?.addEventListener("input", () => {
      syncAccentCustomHexValidity();
      const parsed = parseAccentHexInput(accentCustomHex.value);
      if (!parsed) return;
      Object.assign(customAccentState, parseAccentHsl(parsed));
      syncCustomAccentSpectrumFromHsl();
      renderAccentCustomPicker({ apply: true });
    });

    accentCustomHex?.addEventListener("blur", commitAccentCustomHexInput);
    accentCustomHex?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        accentCustomHex.blur();
      }
    });

    accentCustomSwatch?.addEventListener("click", (e) => {
      e.stopPropagation();
      const nextOpen = !customAccentState.open;
      if (nextOpen) {
        loadAccentCustomPickerFromAccent(accentColorInput?.value || readAccentColor());
        syncAccentSwatchState(null, { custom: true });
        selectCustomAccent(hslComponentsToHex(customAccentState.h, customAccentState.s, customAccentState.l));
      }
      setAccentCustomPanelOpen(nextOpen);
    });

    document.addEventListener("pointerdown", (e) => {
      if (!customAccentState.open) return;
      const target = e.target;
      if (target instanceof Node && accentCustomSwatch?.contains(target)) return;
      if (target instanceof Node && accentCustomPanel?.contains(target)) return;
      setAccentCustomPanelOpen(false);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && customAccentState.open) setAccentCustomPanelOpen(false);
    });
  };

  const findMatchingAccentSwatch = (accent) => {
    const normalized = normalizeAccent(accent);
    return getAccentSwatches().find((btn) => normalizeAccent(btn.getAttribute("data-accent")) === normalized) || null;
  };

  const setCustomAccentLabel = (color) => {
    const hex = String(color || "")
      .trim()
      .startsWith("#")
      ? color
      : accentColorString(color);
    const name = typeof getAccentColorName === "function" ? getAccentColorName(hex) : "Custom";
    if (accentLabel) accentLabel.textContent = name;
    accentCustomSwatch?.setAttribute("aria-label", name);
  };

  const syncAccentSwatchState = (activeBtn, { custom = false } = {}) => {
    getAccentSwatches().forEach((btn) => {
      const isActive = !custom && btn === activeBtn;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-checked", isActive ? "true" : "false");
      btn.tabIndex = isActive ? 0 : -1;
    });
    accentCustomSwatch?.classList.toggle("active", custom);
    accentCustomSwatch?.setAttribute("aria-checked", custom ? "true" : "false");
    if (!custom) setAccentCustomPanelOpen(false);
    if (accentLabel) {
      if (custom) setCustomAccentLabel(accentColorInput?.value || readAccentColor());
      else if (activeBtn) accentLabel.textContent = activeBtn.getAttribute("aria-label") || "";
    }
  };

  const syncAccentUI = (accent) => {
    const normalized = normalizeAccent(accent);
    const hex = accentColorString(normalized);
    const matching = findMatchingAccentSwatch(normalized);
    if (accentColorInput) accentColorInput.value = hex;
    if (accentCustomSwatch) syncAccentCustomSwatchStyle(accentCustomSwatch, hex);
    loadAccentCustomPickerFromAccent(normalized);
    if (matching) syncAccentSwatchState(matching);
    else syncAccentSwatchState(null, { custom: true });
  };

  const selectAccentSwatch = (btn) => {
    if (!btn || !accentGrid) return;
    const val = btn.getAttribute("data-accent");
    syncAccentSwatchState(btn);
    if (accentColorInput) accentColorInput.value = accentColorString(val);
    if (accentCustomSwatch) syncAccentCustomSwatchStyle(accentCustomSwatch, accentColorInput.value);
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
      btn.addEventListener("click", () => selectAccentSwatch(btn));
    });
    initAccentCustomPicker();
    syncAccentUI(savedAccent || DEFAULT_ACCENT);
  }

  accentColorInput?.addEventListener("input", () => {
    loadAccentCustomPickerFromAccent(accentColorInput.value);
    selectCustomAccent(accentColorInput.value);
    setAccentCustomPanelOpen(true);
  });

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

  const matchesToggleSavedValue = (val, saved) => {
    if (saved == null) return false;
    const valNum = parseFloat(val);
    const savedNum = parseFloat(saved);
    if (Number.isFinite(valNum) && Number.isFinite(savedNum)) {
      return Math.abs(valNum - savedNum) < 0.001;
    }
    return val === saved;
  };

  const syncUiSizeSelectors = (value) => {
    document.querySelectorAll(".ui-size-selector").forEach((sel) => {
      const btns = sel.querySelectorAll(".toggle-btn");
      btns.forEach((btn) => {
        btn.classList.toggle("active", matchesToggleSavedValue(btn.getAttribute("data-fontsize"), value));
      });
      positionToggleGlider(sel);
    });
  };

  const wireToggle = (selectorId, attr, onChange, savedValue) => {
    const sel = document.getElementById(selectorId);
    if (!sel) return;
    const btns = sel.querySelectorAll(".toggle-btn");
    btns.forEach((btn) => {
      const val = btn.getAttribute(attr);
      if (matchesToggleSavedValue(val, savedValue)) {
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

  const initUiSizeSelectors = (savedValue) => {
    document.querySelectorAll(".ui-size-selector").forEach((sel) => {
      sel.querySelectorAll(".toggle-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const value = btn.getAttribute("data-fontsize");
          applyFontSize(value);
          localStorage.setItem("prefFontSize", value);
          syncUiSizeSelectors(value);
        });
      });
    });
    syncUiSizeSelectors(savedValue || "1");
  };

  wireToggle(
    "confirm-reset-selector",
    "data-confirm-reset",
    (v) => {
      localStorage.setItem("prefConfirmReset", v);
    },
    savedConfirmReset ? "true" : "false",
  );

  initUiSizeSelectors(savedFont);
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
    "distance360-unit-selector",
    "data-distance360-unit",
    (v) => {
      localStorage.setItem(DISTANCE_360_UNIT_KEY, v === "in" ? "in" : "cm");
      refreshDistance360Displays();
    },
    savedDistance360Unit,
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

const changelogUi = {
  calendarView: { year: new Date().getFullYear(), month: new Date().getMonth() },
};

function resetChangelogCalendarToToday() {
  const now = new Date();
  changelogUi.calendarView = { year: now.getFullYear(), month: now.getMonth() };
}

function getChangelogReleaseDates(panel) {
  const releaseDates = new Map();
  panel.querySelectorAll(".changelog-date-group").forEach((group) => {
    const date = group.dataset.changelogDate;
    if (!date) return;
    const timeEl = group.querySelector(".changelog-date");
    releaseDates.set(date, timeEl?.textContent.trim() || formatProgressDayLabel(date));
  });
  return releaseDates;
}

function renderChangelogCalendarGrid(releaseDates, selected) {
  const grid = document.getElementById("changelog-cal-grid");
  const title = document.getElementById("changelog-cal-title");
  if (!grid || !title) return;

  const { year, month } = changelogUi.calendarView;
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
    const hasRelease = releaseDates.has(dayKey);
    const dayStart = new Date(year, month, day).getTime();
    const isFuture = dayStart > todayStart;
    const classes = ["aim-progress-cal-day", hasRelease ? "has-data" : "", selected !== "all" && dayKey === selected ? "selected" : "", dayKey === todayKey ? "today" : ""].filter(Boolean).join(" ");
    const disabled = !hasRelease || isFuture;

    grid.insertAdjacentHTML("beforeend", `<button type="button" class="${classes}" data-day="${dayKey}"${disabled ? " disabled" : ""} aria-label="${releaseDates.get(dayKey) || formatProgressDayLabel(dayKey)}">${day}</button>`);
  }

  const nextBtn = document.getElementById("changelog-cal-next");
  if (nextBtn) nextBtn.disabled = nextMonthStart > todayStart;
}

function getChangelogInitialReleaseKey(panel) {
  const releaseGroup = panel.querySelector('.changelog-date-group[data-changelog-release="true"]');
  if (releaseGroup?.dataset.changelogDate) return releaseGroup.dataset.changelogDate;
  return [...getChangelogReleaseDates(panel).keys()].sort()[0] || null;
}

function initChangelogDateFilter() {
  const picker = document.getElementById("changelog-date-picker");
  const trigger = document.getElementById("changelog-date-trigger");
  const label = document.getElementById("changelog-date-label");
  const calendar = document.getElementById("changelog-calendar");
  const initialBtn = document.getElementById("changelog-calendar-initial");
  const allBtn = document.getElementById("changelog-calendar-all");
  const grid = document.getElementById("changelog-cal-grid");
  const prevBtn = document.getElementById("changelog-cal-prev");
  const nextBtn = document.getElementById("changelog-cal-next");
  const panel = document.getElementById("changelog-panel");
  if (!picker || !trigger || !label || !calendar || !initialBtn || !allBtn || !grid || !panel || initChangelogDateFilter._init) return;
  initChangelogDateFilter._init = true;

  const groups = [...panel.querySelectorAll(".changelog-date-group")];
  const releaseDates = getChangelogReleaseDates(panel);
  const initialReleaseKey = getChangelogInitialReleaseKey(panel);
  let selected = "all";

  const syncCalendarUi = () => {
    allBtn.classList.toggle("active", selected === "all");
    allBtn.setAttribute("aria-pressed", selected === "all" ? "true" : "false");
    initialBtn.classList.toggle("active", initialReleaseKey !== null && selected === initialReleaseKey);
    initialBtn.setAttribute("aria-pressed", initialReleaseKey !== null && selected === initialReleaseKey ? "true" : "false");
    if (selected !== "all") {
      const parsed = parseProgressDayKey(selected);
      if (parsed.year && parsed.month) {
        changelogUi.calendarView = { year: parsed.year, month: parsed.month - 1 };
      }
    }
    renderChangelogCalendarGrid(releaseDates, selected);
  };

  const closeCalendar = () => {
    picker.classList.remove("is-open");
    trigger.setAttribute("aria-expanded", "false");
    calendar.classList.add("hidden");
  };

  const openCalendar = () => {
    if (selected === "all") resetChangelogCalendarToToday();
    picker.classList.add("is-open");
    trigger.setAttribute("aria-expanded", "true");
    calendar.classList.remove("hidden");
    syncCalendarUi();
  };

  const applyFilter = () => {
    groups.forEach((group) => {
      const show = selected === "all" || group.dataset.changelogDate === selected;
      group.classList.toggle("is-filtered-out", !show);
    });
  };

  const setSelection = (value) => {
    selected = value;
    label.textContent = value === "all" ? "All dates" : releaseDates.get(value) || formatProgressDayLabel(value);
    syncCalendarUi();
    applyFilter();
    closeCalendar();
  };

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (picker.classList.contains("is-open")) closeCalendar();
    else openCalendar();
  });

  allBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    resetChangelogCalendarToToday();
    setSelection("all");
  });

  initialBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (initialReleaseKey) setSelection(initialReleaseKey);
  });

  prevBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    changelogUi.calendarView.month -= 1;
    if (changelogUi.calendarView.month < 0) {
      changelogUi.calendarView.month = 11;
      changelogUi.calendarView.year -= 1;
    }
    renderChangelogCalendarGrid(releaseDates, selected);
  });

  nextBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    changelogUi.calendarView.month += 1;
    if (changelogUi.calendarView.month > 11) {
      changelogUi.calendarView.month = 0;
      changelogUi.calendarView.year += 1;
    }
    renderChangelogCalendarGrid(releaseDates, selected);
  });

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-day]");
    if (!btn || btn.disabled) return;
    setSelection(btn.getAttribute("data-day"));
  });

  document.addEventListener("click", (e) => {
    if (!picker.contains(e.target)) closeCalendar();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && picker.classList.contains("is-open")) {
      e.preventDefault();
      closeCalendar();
      trigger.blur();
    }
  });

  applyFilter();
}

document.addEventListener("DOMContentLoaded", () => {
  initEmptyTitleGuard();
  initAppLoadingScreen();
  initAppSidebar();
  const presenceEl = document.getElementById("app-sidebar-presence");
  const presenceCountEl = document.getElementById("online-member-count");
  presenceApi =
    window.MorningRoastPresence?.initOnlinePresence?.({
      onCount(count) {
        if (presenceCountEl) presenceCountEl.textContent = String(count);
        presenceEl?.classList.add("has-count");
      },
      onActivities(activities) {
        presenceActivityCounts = activities || {};
        if (isPresencePopupOpen()) renderPresenceActivityPopup();
      },
      onState(state) {
        presenceState = state;
        presenceIsLive = state === "live";
        if (!presenceIsLive) presenceActivityCounts = {};
        if (isPresencePopupOpen()) renderPresenceActivityPopup();
        if (!presenceEl) return;
        presenceEl.classList.toggle("is-live", state === "live");
        presenceEl.classList.toggle("is-offline", state === "offline" || state === "disabled");
      },
    }) || null;
  initPresenceActivityPopup();
  reportActivityForTab(getCurrentTabId());
  initHomeFeatureCardTilt();
  window.MorningRoastDesktopDownload?.init?.();
  window.MorningRoastDesktopUpdate?.init?.();
  initMobileNavMoreMenu();
  syncMiscTabUi();
  if (MISC_TAB_ENABLED) initMobileNavMiscMenu();
  if (LINEUP_TAB_ENABLED) initLineupTab();
  if (MISC_TAB_ENABLED) {
    ensureCrosshairConverterLoaded()
      .then(() => initCrosshairConverterTab?.())
      .catch(() => {});
  }
  initChangelogDateFilter();
  cacheElements();
  initEdpiSpectrumDrag();
  initEdpiCompareMode();
  initSearchDropdownFocusLossHandlers();
  initLogoMask();
  renderGameOptions(document.getElementById("from-list"), "data-game");
  renderGameOptions(document.getElementById("to-list"), "data-game");
  renderGameOptions(document.getElementById("edpi-game-list"), "data-game");
  renderGameOptions(document.getElementById("trainer-game-list"), "data-value");
  renderGameOptions(document.getElementById("profile-game-list"), "data-profile-game");
  initGameIconErrorFallback();
  syncAllGameTriggerIcons();
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
  initProfileDisplayNameConfirm();
  window.MorningRoastAssistant?.initSiteAssistant?.();
  initProfileTab();
  initUsernameOnboarding();
  window.MorningRoastChat?.initCommunityChat?.();
  initTrainerSettingsDropdowns();
  initSettingsModalTabs();
  initProfileChartsWatcher();
  initShareButtons();
  initTabActionMenus();
  window.addEventListener("load", () => requestProfileChartsRedraw());
  if (document.fonts?.ready) {
    document.fonts.ready.then(() => requestProfileChartsRedraw()).catch(() => {});
  }
  initHotkeys();
  initTabBlock();
  syncKeybindLabels();
  initReactionTestMenu(initReactionTest());
  const fD = document.getElementById("from-dpi"),
    tD = document.getElementById("to-dpi");
  if (fD) fD.value = "800";
  if (tD) tD.value = "800";
  ["base-sens", "from-dpi", "to-dpi", "edpi-dpi", "edpi-sens", "edpi-dpi-b", "edpi-sens-b", "canvas-sens", "canvas-dpi"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) handleInputValidation(el, id.startsWith("edpi-") ? scheduleUpdateEDPI : id.startsWith("canvas-") ? () => {} : scheduleUpdateConversion);
  });

  const sequences = [
    ["base-sens", "from-dpi", "to-dpi"],
    ["edpi-sens", "edpi-dpi"],
    ["edpi-sens-b", "edpi-dpi-b"],
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
        dismissGameSearchDropdown(idPrefix, { force: true });
      }
    });
    const lineupMapList = document.getElementById("lineup-map-list");
    const lineupMapInput = document.getElementById("lineup-map-search");
    const lineupMapTrigger = document.getElementById("lineup-map-trigger");
    if (lineupMapList && lineupMapInput && !lineupMapInput.contains(e.target) && !lineupMapList.contains(e.target) && !(lineupMapTrigger && lineupMapTrigger.contains(e.target))) {
      dismissLineupMapSearchDropdown();
    }
    const lineupGameList = document.getElementById("lineup-game-list");
    const lineupGameInput = document.getElementById("lineup-game-search");
    const lineupGameTrigger = document.getElementById("lineup-game-trigger");
    if (lineupGameList && lineupGameInput && !lineupGameInput.contains(e.target) && !lineupGameList.contains(e.target) && !(lineupGameTrigger && lineupGameTrigger.contains(e.target))) {
      dismissLineupGameSearchDropdown();
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
        const previous = getCommittedGameFromInput(input) || input.dataset.lastValid || localStorage.getItem(PROFILE_FILTER_GAME_KEY) || DEFAULT_PROFILE_FILTER_GAME;
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

      const committed = getCommittedGameFromInput(input);
      if (committed) input.dataset.lastValid = committed;
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
      setTimeout(() => {
        if (isFocusInsideDropdownList(list)) return;
        dismissGameSearchDropdown(idPrefix);
      }, 120);
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
        const display = getGameDisplayName(getOptionLabel(o)).toLowerCase();
        o.style.display = display.includes(filter) ? "" : "none";
      });
      const visible = getVisible();
      if (visible.length) {
        showGameDropdownList(idPrefix);
        activeIndex = 0;
        syncUI(visible);
      } else {
        hideGameDropdownList(idPrefix);
        activeIndex = -1;
      }
      syncClear();
      if (idPrefix === "edpi-game") scheduleUpdateEDPI();
      else if (idPrefix !== "trainer-game" && idPrefix !== "profile-game") scheduleUpdateConversion();
      if (idPrefix !== "profile-game") syncGameTriggerIcon(idPrefix);
    });
    list.querySelectorAll(optionSelector).forEach((opt) => {
      opt.addEventListener("mouseenter", () => {
        const visible = getVisible();
        activeIndex = visible.indexOf(opt);
        syncUI(visible);
      });
      opt.addEventListener("mousedown", (e) => {
        e.preventDefault();
        const modeVal = MorningRoastGames.resolveGameName(opt.getAttribute(valueAttr) || getOptionLabel(opt)) || getOptionLabel(opt);
        input.value = getGameDisplayName(modeVal);
        input.dataset.lastValid = modeVal;
        hideGameDropdownList(idPrefix);
        if (isProfileGame) syncProfileGameDropdownUi(modeVal);
        syncClear();
        if (idPrefix === "trainer-game" && modeVal) {
          aimTrainer.setGame(modeVal);
        } else if (isProfileGame && modeVal) {
          localStorage.setItem(PROFILE_FILTER_GAME_KEY, modeVal);
          aimTrainer.displayResultsOnProfile();
        } else if (idPrefix === "edpi-game") {
          profileEdpiStatsPaused = false;
          updateEDPI();
        } else {
          profileSensStatsPaused = false;
          updateConversion();
        }
        syncGameTriggerIcon(idPrefix);
        input.blur();
      });
    });
    if (clearBtn) {
      clearBtn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        input.value = "";
        input.dataset.lastValid = "";
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
        syncGameTriggerIcon(idPrefix);
      });
    }
    syncClear();
  });
  ["from", "to", "edpi-game", "trainer-game"].forEach((idPrefix) => {
    syncGameClearButton(`${idPrefix}-search`, `${idPrefix}-clear`);
  });
  const swapBtn = document.getElementById("swap-btn");
  let swapBtnRotation = 0;
  swapBtn?.addEventListener("click", () => {
    const el = {
      fG: document.getElementById("from-search"),
      tG: document.getElementById("to-search"),
      fD: document.getElementById("from-dpi"),
      tD: document.getElementById("to-dpi"),
      bS: document.getElementById("base-sens"),
      res: document.getElementById("new-sens-value"),
    };
    if (Object.values(el).every((x) => x)) {
      swapBtnRotation -= 180;
      swapBtn.style.setProperty("--swap-btn-rotate", `${swapBtnRotation}deg`);
      if (el.res.innerText !== "0.00") el.bS.value = el.res.innerText;
      const fromGame = getConverterGameState(el.fG);
      const toGame = getConverterGameState(el.tG);
      setConverterGameState(el.fG, toGame);
      setConverterGameState(el.tG, fromGame);
      syncGameClearButton("from-search", "from-clear");
      syncGameClearButton("to-search", "to-clear");
      [el.fD.value, el.tD.value] = [el.tD.value, el.fD.value];
      updateConversion();
      syncGameTriggerIcon("from");
      syncGameTriggerIcon("to");
    }
  });
  document.getElementById("reset-btn")?.addEventListener("click", () => {
    confirmBeforeReset("Reset the sensitivity converter fields?", () => {
      setConverterGameState(document.getElementById("from-search"), "");
      setConverterGameState(document.getElementById("to-search"), "");
      const baseSens = document.getElementById("base-sens");
      if (baseSens) baseSens.value = "";
      const fD = document.getElementById("from-dpi"),
        tD = document.getElementById("to-dpi");
      if (fD) fD.value = "800";
      if (tD) tD.value = "800";
      syncGameClearButton("from-search", "from-clear");
      syncGameClearButton("to-search", "to-clear");
      updateConversion();
      syncGameTriggerIcon("from");
      syncGameTriggerIcon("to");
    });
  });
  document.getElementById("profile-sens-conv-reset")?.addEventListener("click", () => {
    confirmBeforeReset("Clear saved sensitivity converter stats?", () => {
      profileSensStatsPaused = true;
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
      if (pFrom) pFrom.innerText = "-";
      if (pTo) pTo.innerText = "-";
      if (pBaseSens) pBaseSens.innerText = "-";
      if (pFromDpi) pFromDpi.innerText = "-";
      if (pToDpi) pToDpi.innerText = "-";

      toggleProfileSensConvButtons();
      updateGameInfoPanelVisibility();
    });
  });
  document.getElementById("profile-edpi-calc-reset")?.addEventListener("click", () => {
    confirmBeforeReset("Clear saved eDPI calculator stats?", () => {
      profileEdpiStatsPaused = true;
      localStorage.removeItem("lastEdpiCalc");
      localStorage.removeItem("lastEdpiSens");
      localStorage.removeItem("lastEdpiDpi");
      localStorage.removeItem("lastEdpiColor");
      localStorage.removeItem("lastEdpiCm");
      localStorage.removeItem("lastEdpiGame");

      const pEdpi = document.getElementById("last-edpi-calc");
      const pGame = document.getElementById("profile-edpi-game");
      const pSens = document.getElementById("profile-edpi-sens");
      const pDpi = document.getElementById("profile-edpi-dpi");
      const pCm = document.getElementById("profile-edpi-cm");
      const pDot = document.getElementById("profile-edpi-status-dot");

      if (pEdpi) pEdpi.innerText = "0.00";
      if (pGame) pGame.innerText = "-";
      if (pSens) pSens.innerText = "-";
      if (pDpi) pDpi.innerText = "-";
      if (pCm) pCm.textContent = "-";
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
      const eD = document.getElementById("edpi-dpi");
      const eS = document.getElementById("edpi-sens");
      const eDb = document.getElementById("edpi-dpi-b");
      const eSb = document.getElementById("edpi-sens-b");
      if (eD) eD.value = "800";
      if (eS) eS.value = "";
      if (isEdpiCompareMode()) {
        if (eDb) eDb.value = "800";
        if (eSb) eSb.value = "";
      }
      clearEdpiGameDropdown();
      updateEDPI();
    });
  });
  document.querySelectorAll(".copy-button").forEach((btn) => {
    if (!btn.getAttribute("type")) btn.setAttribute("type", "button");
    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (clipboardState.isCopying) return;
      if (this.id === "crosshair-converter-copy") return;

      const isProfileSensCopy = this.id === "profile-sens-conv-copy";
      const isProfileEdpiCopy = this.id === "profile-edpi-calc-copy";
      const isMainEdpi = this.id === "edpi-copy";

      const sourceId = isProfileSensCopy ? "last-sens-conv" : isProfileEdpiCopy ? "last-edpi-calc" : isMainEdpi ? "edpi-value" : "new-sens-value";
      const source = document.getElementById(sourceId);
      const val = (source?.textContent || source?.innerText || "").trim();

      if (!val || val === "0.00" || val === "0" || val === "" || val === "-") {
        this.classList.add("vibrate");
        setTimeout(() => this.classList.remove("vibrate"), 300);
        return;
      }

      clipboardState.isCopying = true;
      copyText(val).finally(() => {
        clipboardState.isCopying = false;
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
    syncKeybindLabels();
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
  const savedEdpiSens = localStorage.getItem("lastEdpiSens");
  const savedEdpiDpi = localStorage.getItem("lastEdpiDpi");
  const savedEdpiColor = localStorage.getItem("lastEdpiColor");
  const savedEdpiCm = localStorage.getItem("lastEdpiCm");
  const savedEdpiGame = localStorage.getItem("lastEdpiGame");

  localStorage.removeItem(LINEUP_GAME_STORAGE_KEY);

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

  if (savedFromGame && pFrom) pFrom.innerText = getGameDisplayName(savedFromGame);
  else if (pFrom) pFrom.innerText = "-";
  if (savedToGame && pTo) pTo.innerText = getGameDisplayName(savedToGame);
  else if (pTo) pTo.innerText = "-";
  if (savedSens && profileDisplay) profileDisplay.innerText = savedSens;
  if (savedBaseSens && pBaseSens) pBaseSens.innerText = savedBaseSens;
  if (savedFromDpi && pFromDpi) pFromDpi.innerText = savedFromDpi;
  if (savedToDpi && pToDpi) pToDpi.innerText = savedToDpi;
  if (savedEdpi && pEdpi) pEdpi.innerText = savedEdpi;
  if (savedEdpiGame && pEdpiGame) pEdpiGame.innerText = getGameDisplayName(savedEdpiGame);
  else if (pEdpiGame) pEdpiGame.innerText = "-";
  if (savedEdpiSens && pEdpiSens) pEdpiSens.innerText = savedEdpiSens;
  if (savedEdpiDpi && pEdpiDpi) pEdpiDpi.innerText = savedEdpiDpi;
  if (savedEdpiCm && pEdpiCm) pEdpiCm.textContent = formatDistance360ShortFromCm(savedEdpiCm);
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
  routeState.isInitial = true;
  initTabRouting();
  applySharedParams();
  syncAllGameTriggerIcons();
  syncUrlToTab(getCurrentTabId(), { replace: true, keepSearch: Boolean(new URLSearchParams(window.location.search).get("t")) });
  routeState.isInitial = false;
  scrollToTop(350);
  finishAppLoadingScreen();
});

window.switchTab = switchTab;
window.cycleTabFromLogo = cycleTabFromLogo;
window.scrollToTop = scrollToTop;
window.resolveAppAssetUrl = resolveAppAssetUrl;
window.getGameIconSrc = getGameIconSrc;
window.renderGameOptionIcon = renderGameOptionIcon;
window.getLineupMapIconSrc = getLineupMapIconSrc;
window.renderLineupMapOptionIcon = renderLineupMapOptionIcon;
window.getActiveLineupGame = getActiveLineupGame;
window.setLineupGame = setLineupGame;
window.syncBodyScrollLock = syncBodyScrollLock;
window.refreshLineupVideoCards = refreshLineupVideoCards;
window.confirmBeforeReset = confirmBeforeReset;
window.applyLineupVideoCardBadges = applyLineupVideoCardBadges;
window.normalizeLineupValorantAgentSlug = normalizeLineupValorantAgentSlug;
window.normalizeLineupValorantAbilitySlug = normalizeLineupValorantAbilitySlug;
window.getLineupValorantAgentDropdownOptions = getLineupValorantAgentDropdownOptions;
window.renderLineupValorantAgentOptionIcon = renderLineupValorantAgentOptionIcon;
window.renderLineupValorantAbilityOptionIcon = renderLineupValorantAbilityOptionIcon;
window.fetchLineupValorantAbilityDropdownOptions = fetchLineupValorantAbilityDropdownOptions;
window.getLineupValorantAbilityDropdownOptionsFromStatic = getLineupValorantAbilityDropdownOptionsFromStatic;
window.getLineupValorantAgentDropdownLabel = getLineupValorantAgentDropdownLabel;
window.getLineupValorantAbilityDropdownLabel = getLineupValorantAbilityDropdownLabel;
window.getLineupValorantAgentIconSrc = getLineupValorantAgentIconSrc;
window.getLineupValorantAbilityIconSrc = getLineupValorantAbilityIconSrc;
