/** Site assistant — AI chat via Pollinations (no user accounts). */
(function (global) {
  const AI_URL = "https://text.pollinations.ai/openai";
  const AI_MODEL = "openai";
  const MIN_REQUEST_GAP_MS = 15000;
  const MAX_PAGE_CONTEXT = 5000;
  const MAX_HISTORY = 16;
  const TYPEWRITER_MIN_MS = 1400;
  const TYPEWRITER_MAX_MS = 7500;

  const conversation = [];
  let lastRequestAt = 0;

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[^\w\s/%.°+-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildSystemPrompt() {
    const pageText =
      typeof document !== "undefined"
        ? String(document.body?.innerText || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, MAX_PAGE_CONTEXT)
        : "";
    return [
      "You are the Morning Roast site assistant. Answer clearly and make replies easy to scan.",
      "Format rules:",
      "- Open with one short summary sentence.",
      "- Put a blank line between sections.",
      "- Use bullet lines starting with \"- \" (one bullet per line).",
      "- Put key numbers on their own bullet (DPI, sens, eDPI, cm/360).",
      "- Use **bold** for important terms and `backticks` for values.",
      "- Keep answers concise (usually 4–8 bullets).",
      "",
      "SITE FACTS:",
      "Morning Roast: sensitivity converter, eDPI calculator, crosshair converter, aim trainer, lineups, stats.",
      "eDPI = DPI × sensitivity. cm/360 measures mouse travel per full turn.",
      "Recommended cm/360: tactical games ~40–60, arena ~25–35, battle royale ~30–45.",
      "Contact: Discord in More menu, email svitserk.morningstar@gmail.com.",
      pageText ? `PAGE EXCERPT:\n${pageText}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function ensureSystemMessage() {
    const prompt = buildSystemPrompt();
    if (!conversation.length || conversation[0].role !== "system") {
      conversation.unshift({ role: "system", content: prompt });
      return;
    }
    conversation[0].content = prompt;
  }

  function trimHistory() {
    while (conversation.length > MAX_HISTORY) {
      if (conversation[0]?.role === "system") {
        if (conversation.length <= 1) break;
        conversation.splice(1, 1);
      } else {
        conversation.shift();
      }
    }
  }

  async function throttleAi() {
    const now = Date.now();
    const waitMs = MIN_REQUEST_GAP_MS - (now - lastRequestAt);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastRequestAt = Date.now();
  }

  async function callAi(messages, { maxTokens = 500, temperature = 0.7 } = {}) {
    await throttleAi();

    const response = await fetch(AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: AI_MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(response.status === 429 ? "Too many requests — wait a moment and try again." : `AI request failed (${response.status})`);
    }

    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content?.trim();
    if (!answer) throw new Error("Empty AI response");
    return answer;
  }

  function getLocalWelcome() {
    return "Hi! Welcome to Morning Roast — ask me anything about sensitivity, eDPI, or how the site works.";
  }

  async function fetchWelcomeMessage() {
    ensureSystemMessage();
    const systemMessages = conversation.filter((entry) => entry.role === "system");
    const welcomePrompt =
      "The visitor just opened the Morning Roast site helper chat. Reply with a simple, friendly hello in 1–2 short sentences. Briefly mention you can help with Morning Roast, sensitivity, and gaming questions. Plain text only — no bullets, lists, or buttons.";

    const answer = await callAi([...systemMessages, { role: "user", content: welcomePrompt }], {
      maxTokens: 80,
      temperature: 0.8,
    });

    conversation.push({ role: "assistant", content: answer });
    trimHistory();
    return answer;
  }

  async function answerWithAi(userText) {
    ensureSystemMessage();
    const payload = [...conversation, { role: "user", content: userText }];
    const answer = await callAi(payload);

    conversation.push({ role: "user", content: userText });
    conversation.push({ role: "assistant", content: answer });
    trimHistory();
    return answer;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  const TAB_ACTIONS = [
    { pattern: /\b(edpi|e dpi|effective dpi|cm\/360|cm360|in\/360)\b/i, tab: "edpi-calculator-tab", label: "Open eDPI calculator" },
    {
      pattern: /\b(sens(itivity)? converter|convert(ing)? sens|convert(ing)? sensitivity|convert from|convert to|mouse sens convert)\b/i,
      tab: "sensitivity-converter-tab",
      label: "Open sensitivity converter",
    },
    { pattern: /\b(crosshair|cross hair|reticle)\b/i, tab: "crosshair-converter-tab", label: "Open crosshair converter" },
    { pattern: /\b(aim trainer|aim training|train (my )?aim)\b/i, tab: "aim-training-tab", label: "Open aim trainer" },
    {
      pattern: /\b(stats tab|my stats|saved stats|conversion history|last (calc|conversion|edpi))\b/i,
      tab: "stats-tab",
      label: "Open stats",
    },
    { pattern: /\b(lineups?|smoke lineup|flash lineup|grenade lineup)\b/i, tab: "lineup-tab", label: "Open lineups" },
    { pattern: /\b(settings|preferences|general settings|accent color|text size|distance unit)\b/i, tab: "settings-tab", label: "Open settings" },
  ];

  function parseAssistantBlocks(text) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const blocks = [];
    let listItems = [];
    let listType = null;

    const flushList = () => {
      if (!listItems.length) return;
      blocks.push({ type: listType || "ul", items: listItems.slice() });
      listItems = [];
      listType = null;
    };

    for (const line of lines) {
      const bullet = line.match(/^[-•*]\s+(.+)$/);
      const numbered = line.match(/^\d+[.)]\s+(.+)$/);
      if (bullet) {
        if (listType === "ol") flushList();
        listType = "ul";
        listItems.push(bullet[1]);
        continue;
      }
      if (numbered) {
        if (listType === "ul") flushList();
        listType = "ol";
        listItems.push(numbered[1]);
        continue;
      }

      const inlineList = line.match(/^(.+?:)\s+[-•*]\s+(.+)$/);
      if (inlineList) {
        flushList();
        blocks.push({ type: "p", text: inlineList[1] });
        listType = "ul";
        listItems.push(inlineList[2]);
        continue;
      }

      flushList();
      blocks.push({ type: "p", text: line });
    }

    flushList();
    return blocks;
  }

  function formatInlineHtml(text) {
    let html = escapeHtml(text);
    const codeSlots = [];

    html = html.replace(/`([^`]+)`/g, (_, inner) => {
      const token = `__MR_CODE_${codeSlots.length}__`;
      codeSlots.push(`<code class="site-assistant-code">${inner}</code>`);
      return token;
    });

    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong class="site-assistant-strong">$1</strong>');
    html = html.replace(
      /(\d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?)\s*(DPI|eDPI|dpi|edpi|cm\/360|in\/360|cm)\b/gi,
      (_, num, unit) =>
        `<span class="site-assistant-metric"><span class="site-assistant-metric-value">${escapeHtml(num)}</span><span class="site-assistant-metric-unit">${escapeHtml(unit)}</span></span>`,
    );
    html = html.replace(
      /\b(0\.\d{1,4})\b(?!\s*(?:DPI|eDPI|cm))/gi,
      (_, num) =>
        `<span class="site-assistant-metric site-assistant-metric--sens"><span class="site-assistant-metric-value">${escapeHtml(num)}</span><span class="site-assistant-metric-unit">sens</span></span>`,
    );

    codeSlots.forEach((code, index) => {
      html = html.replace(`__MR_CODE_${index}__`, code);
    });

    return html;
  }

  function getSuggestedActions(userText) {
    const query = normalize(userText);
    if (!query) return [];

    const seen = new Set();
    const actions = [];
    for (const entry of TAB_ACTIONS) {
      if (!entry.pattern.test(query)) continue;
      if (seen.has(entry.tab)) continue;
      seen.add(entry.tab);
      actions.push({ tab: entry.tab, label: entry.label });
    }
    return actions;
  }

  function prefersReducedMotion() {
    return (
      document.body?.classList.contains("reduce-motion") ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
    );
  }

  function stripMarkdownForTyping(text) {
    return String(text || "")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/`([^`]+)`/g, "$1")
      .replace(/^[-•*]\s+/gm, "")
      .replace(/\n{2,}/g, "\n")
      .trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function getTypewriterUnits(text) {
    const plain = stripMarkdownForTyping(text);
    if (plain.length <= 140) {
      return { plain, units: [...plain], mode: "char" };
    }
    return { plain, units: plain.split(/(\s+)/), mode: "word" };
  }

  function getTypewriterDelay(plain, unitCount, mode) {
    const targetMs = Math.min(TYPEWRITER_MAX_MS, Math.max(TYPEWRITER_MIN_MS, plain.length * 20));
    const meaningfulUnits = mode === "word" ? Math.max(1, plain.split(/\s+/).filter(Boolean).length) : unitCount;
    if (mode === "char") {
      return Math.min(30, Math.max(14, Math.floor(targetMs / Math.max(1, unitCount))));
    }
    return Math.min(55, Math.max(22, Math.floor(targetMs / Math.max(1, meaningfulUnits))));
  }

  function buildBotBubbleContent(raw, { showActions = true, forTypewriter = false, userText = "" } = {}) {
    const slots = [];
    const body = document.createElement("div");
    body.className = forTypewriter
      ? "site-assistant-bubble-body site-assistant-bubble-body--entering"
      : "site-assistant-bubble-body";

    const content = document.createElement("div");
    content.className = "site-assistant-content";

    const blocks = parseAssistantBlocks(raw);
    if (!blocks.length) {
      const paragraph = document.createElement("p");
      if (forTypewriter) {
        paragraph.className = "site-assistant-typewriter-slot";
        slots.push({ el: paragraph, text: raw });
      } else {
        paragraph.innerHTML = formatInlineHtml(raw);
      }
      content.appendChild(paragraph);
    } else {
      blocks.forEach((block, index) => {
        if (block.type === "p") {
          const paragraph = document.createElement("p");
          paragraph.className = index === 0 ? "site-assistant-lead site-assistant-typewriter-slot" : "site-assistant-typewriter-slot";
          if (!forTypewriter) {
            paragraph.classList.remove("site-assistant-typewriter-slot");
            if (index === 0) paragraph.className = "site-assistant-lead";
            paragraph.innerHTML = formatInlineHtml(block.text);
          } else {
            if (index !== 0) paragraph.classList.remove("site-assistant-lead");
            slots.push({ el: paragraph, text: block.text });
          }
          content.appendChild(paragraph);
          return;
        }
        const list = document.createElement(block.type === "ol" ? "ol" : "ul");
        list.className = forTypewriter ? "site-assistant-list site-assistant-list--typing" : "site-assistant-list";
        block.items.forEach((item) => {
          const li = document.createElement("li");
          if (forTypewriter) {
            li.className = "site-assistant-typewriter-slot";
            slots.push({ el: li, text: item });
          } else {
            li.innerHTML = formatInlineHtml(item);
          }
          list.appendChild(li);
        });
        content.appendChild(list);
      });
    }

    body.appendChild(content);

    let actionRow = null;
    if (showActions) {
      const actions = getSuggestedActions(userText);
      if (actions.length) {
        actionRow = document.createElement("div");
        actionRow.className = forTypewriter
          ? "site-assistant-actions site-assistant-actions--pending"
          : "site-assistant-actions";
        actions.forEach((action) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "site-assistant-action";
          button.dataset.tab = action.tab;
          button.textContent = action.label;
          actionRow.appendChild(button);
        });
        body.appendChild(actionRow);
      }
    }

    return { body, slots, actionRow };
  }

  async function morphTypingDotsToContent(bubble) {
    if (!bubble.classList.contains("site-assistant-typing")) return;

    bubble.classList.add("site-assistant-bubble--dots-handoff");
    await sleep(240);
    bubble.classList.remove("site-assistant-typing", "site-assistant-bubble--dots-handoff");
    bubble.replaceChildren();
  }

  async function typewriterIntoSlots(slots, { onScroll, isCancelled }) {
    for (const slot of slots) {
      if (isCancelled?.()) return;
      const { plain, units, mode } = getTypewriterUnits(slot.text);
      const delay = getTypewriterDelay(plain, units.length, mode);
      let built = "";

      slot.el.classList.add("site-assistant-typewriter-slot--active");
      onScroll?.();

      for (const unit of units) {
        if (isCancelled?.()) return;
        built += unit;
        slot.el.textContent = built;
        onScroll?.();
        const wait = mode === "word" && !unit.trim() ? 0 : delay;
        if (wait > 0) await sleep(wait);
      }

      slot.el.classList.remove("site-assistant-typewriter-slot--active");
      slot.el.classList.add("site-assistant-typewriter-slot--done");
      slot.el.innerHTML = formatInlineHtml(slot.text);
      onScroll?.();
    }
  }

  async function typewriterBotBubble(bubble, text, options = {}, { onScroll, isCancelled } = {}) {
    const raw = String(text || "").trim();
    if (!raw) return;

    if (prefersReducedMotion()) {
      await morphTypingDotsToContent(bubble);
      renderBotBubble(bubble, raw, options);
      onScroll?.();
      return;
    }

    await morphTypingDotsToContent(bubble);
    if (isCancelled?.()) return;

    if (options.simple) {
      bubble.classList.add("site-assistant-bubble--typing-text", "site-assistant-bubble--entering");
      const { plain, units, mode } = getTypewriterUnits(raw);
      const delay = getTypewriterDelay(plain, units.length, mode);
      let built = "";

      for (const unit of units) {
        if (isCancelled?.()) return;
        built += unit;
        bubble.textContent = built;
        onScroll?.();
        const wait = mode === "word" && !unit.trim() ? 0 : delay;
        if (wait > 0) await sleep(wait);
      }

      if (isCancelled?.()) return;
      bubble.classList.remove("site-assistant-bubble--typing-text");
      bubble.textContent = raw;
      onScroll?.();
      return;
    }

    bubble.classList.add("site-assistant-bubble--rich", "site-assistant-bubble--entering");
    const { body, slots, actionRow } = buildBotBubbleContent(raw, { ...options, forTypewriter: true });
    bubble.append(body);

    await typewriterIntoSlots(slots, { onScroll, isCancelled });
    if (isCancelled?.()) return;

    bubble.classList.remove("site-assistant-bubble--entering");
    if (actionRow) {
      actionRow.classList.remove("site-assistant-actions--pending");
      actionRow.classList.add("site-assistant-actions--visible");
    }
    onScroll?.();
  }

  function renderBotBubble(bubble, text, { showActions = true, simple = false, userText = "" } = {}) {
    const raw = String(text || "").trim();
    bubble.classList.toggle("site-assistant-bubble--rich", !simple);
    bubble.replaceChildren();

    if (simple) {
      bubble.textContent = raw;
      return;
    }

    const { body } = buildBotBubbleContent(raw, { showActions, forTypewriter: false, userText });
    bubble.append(body);
  }

  function createMessageEl(role, text) {
    const row = document.createElement("div");
    row.className = `site-assistant-msg site-assistant-msg--${role}`;
    const bubble = document.createElement("div");
    bubble.className = "site-assistant-bubble";
    if (role === "bot") renderBotBubble(bubble, text);
    else bubble.textContent = text;
    row.appendChild(bubble);
    return { row, bubble };
  }

  function createTypingEl() {
    const row = document.createElement("div");
    row.className = "site-assistant-msg site-assistant-msg--bot";
    const bubble = document.createElement("div");
    bubble.className = "site-assistant-bubble site-assistant-typing";
    bubble.innerHTML = "<span></span><span></span><span></span>";
    row.appendChild(bubble);
    return { row, bubble };
  }

  function initSiteAssistant() {
    const root = document.getElementById("site-assistant");
    const toggle = document.getElementById("site-assistant-toggle");
    const panel = document.getElementById("site-assistant-panel");
    const closeBtn = document.getElementById("site-assistant-close");
    const clearBtn = document.getElementById("site-assistant-clear");
    const form = document.getElementById("site-assistant-form");
    const input = document.getElementById("site-assistant-input");
    const sendBtn = form?.querySelector(".site-assistant-send");
    const messages = document.getElementById("site-assistant-messages");
    if (!root || !toggle || !panel || !form || !input || !messages) return;
    if (initSiteAssistant._init) return;
    initSiteAssistant._init = true;

    let open = false;
    let busy = false;
    let greeted = false;
    let welcomeRequest = 0;
    let replyToken = 0;

    const setBusy = (next) => {
      busy = Boolean(next);
      input.disabled = busy;
      if (sendBtn) sendBtn.disabled = busy;
      if (clearBtn) clearBtn.disabled = busy;
      root.classList.toggle("is-busy", busy);
    };

    const loadWelcome = async () => {
      if (messages.childElementCount || busy) return;

      const requestId = ++welcomeRequest;
      const typing = createTypingEl();
      messages.appendChild(typing.row);
      scrollMessages();
      setBusy(true);
      greeted = true;

      try {
        let answer = null;
        try {
          answer = await fetchWelcomeMessage();
        } catch (_) {
          answer = getLocalWelcome();
          conversation.push({ role: "assistant", content: answer });
        }
        if (requestId !== welcomeRequest) return;
        await typewriterBotBubble(typing.bubble, answer, { simple: true, showActions: false }, {
          onScroll: scrollMessages,
          isCancelled: () => requestId !== welcomeRequest,
        });
      } catch (_) {
        if (requestId !== welcomeRequest) return;
        typing.row.remove();
        greeted = false;
      } finally {
        if (requestId === welcomeRequest) {
          setBusy(false);
          scrollMessages();
        }
      }
    };

    const clearChat = () => {
      welcomeRequest += 1;
      replyToken += 1;
      messages.replaceChildren();
      conversation.length = 0;
      greeted = true;
      setBusy(false);
      input.focus({ preventScroll: true });
    };

    const setOpen = (next) => {
      open = Boolean(next);
      root.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      panel.setAttribute("aria-hidden", open ? "false" : "true");
      if (open) {
        if (!greeted && !messages.childElementCount) {
          loadWelcome();
        }
        requestAnimationFrame(() => input.focus({ preventScroll: true }));
      }
    };

    const scrollMessages = () => {
      messages.scrollTop = messages.scrollHeight;
    };

    const ask = async (text) => {
      const trimmed = String(text || "").trim();
      if (!trimmed || busy) return;

      messages.appendChild(createMessageEl("user", trimmed).row);

      const typing = createTypingEl();
      messages.appendChild(typing.row);
      scrollMessages();
      const token = ++replyToken;
      setBusy(true);

      try {
        const answer = await answerWithAi(trimmed);
        if (token !== replyToken) return;
        await typewriterBotBubble(typing.bubble, answer, { userText: trimmed }, {
          onScroll: scrollMessages,
          isCancelled: () => token !== replyToken,
        });
      } catch (error) {
        if (token !== replyToken) return;
        await typewriterBotBubble(
          typing.bubble,
          error?.message || "Sorry, I could not answer that right now. Try again in a few seconds.",
          { userText: trimmed },
          {
            onScroll: scrollMessages,
            isCancelled: () => token !== replyToken,
          },
        );
      } finally {
        if (token === replyToken) {
          setBusy(false);
          scrollMessages();
        }
      }
    };

    toggle.addEventListener("click", () => setOpen(!open));
    closeBtn?.addEventListener("click", () => setOpen(false));
    clearBtn?.addEventListener("click", clearChat);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value;
      input.value = "";
      ask(value);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        setOpen(false);
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (!open || busy) return;
      if (root.contains(event.target)) return;
      setOpen(false);
    });

    messages.addEventListener("click", (event) => {
      const action = event.target.closest(".site-assistant-action");
      if (action?.dataset.tab) {
        event.preventDefault();
        window.switchTab?.(null, action.dataset.tab);
        setOpen(false);
      }
    });
  }

  global.MorningRoastAssistant = Object.freeze({
    initSiteAssistant,
  });
})(typeof window !== "undefined" ? window : globalThis);
