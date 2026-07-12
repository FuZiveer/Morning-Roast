/** Site assistant — AI chat via Pollinations (no user accounts). */
(function (global) {
  const AI_URL = "https://text.pollinations.ai/openai";
  const AI_MODEL = "openai";
  const MIN_REQUEST_GAP_MS = 15000;
  const MAX_PAGE_CONTEXT = 5000;
  const MAX_HISTORY = 16;
  const TYPEWRITER_MIN_MS = 1400;
  const TYPEWRITER_MAX_MS = 7500;
  const MSG_EXIT_MS = 340;

  const conversation = [];
  let lastRequestAt = 0;

  function buildSystemPrompt() {
    const pageText =
      typeof document !== "undefined"
        ? String(document.body?.innerText || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, MAX_PAGE_CONTEXT)
        : "";
    return ["You are the Morning Roast site assistant. Answer clearly and make replies easy to scan.", "Format rules:", "- Open with one short summary sentence.", "- Put a blank line between sections.", '- Use bullet lines starting with "- " (one bullet per line).', "- Put key numbers on their own bullet (DPI, sens, eDPI, cm/360).", "- Use **bold** for important terms and `backticks` for values.", "- Keep answers concise (usually 4–8 bullets).", "- Only answer the visitor's question. Do not suggest tabs, links, or shortcuts unless they explicitly ask.", "", "SITE FACTS:", "Morning Roast: sensitivity converter, eDPI calculator, crosshair converter, aim trainer, lineups, stats.", "eDPI = DPI × sensitivity. cm/360 measures mouse travel per full turn.", "Recommended cm/360: tactical games ~40–60, arena ~25–35, battle royale ~30–45.", "Contact: Discord in More menu, email svitserk.morningstar@gmail.com.", pageText ? `PAGE EXCERPT:\n${pageText}` : ""].filter(Boolean).join("\n");
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

  async function throttleAi(signal) {
    const now = Date.now();
    const waitMs = MIN_REQUEST_GAP_MS - (now - lastRequestAt);
    if (waitMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(resolve, waitMs);
        if (!signal) return;
        if (signal.aborted) {
          window.clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        signal.addEventListener(
          "abort",
          () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    }
    lastRequestAt = Date.now();
  }

  async function callAi(messages, { maxTokens = 500, temperature = 0.7, signal } = {}) {
    await throttleAi(signal);

    const response = await fetch(AI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
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

  async function answerWithAi(userText, { signal } = {}) {
    ensureSystemMessage();
    const payload = [...conversation, { role: "user", content: userText }];
    const answer = await callAi(payload, { signal });

    conversation.push({ role: "user", content: userText });
    conversation.push({ role: "assistant", content: answer });
    trimHistory();
    return answer;
  }

  function popLastAssistantFromConversation() {
    const last = conversation[conversation.length - 1];
    if (last?.role === "assistant") conversation.pop();
  }

  async function regenerateAiReply({ signal } = {}) {
    ensureSystemMessage();
    const answer = await callAi(conversation, { temperature: 0.85, signal });
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
    html = html.replace(/(\d+(?:\.\d+)?(?:\s*[–-]\s*\d+(?:\.\d+)?)?)\s*(DPI|eDPI|dpi|edpi|cm\/360|in\/360|cm)\b/gi, (_, num, unit) => `<span class="site-assistant-metric"><span class="site-assistant-metric-value">${escapeHtml(num)}</span><span class="site-assistant-metric-unit">${escapeHtml(unit)}</span></span>`);
    html = html.replace(/\b(0\.\d{1,4})\b(?!\s*(?:DPI|eDPI|cm))/gi, (_, num) => `<span class="site-assistant-metric site-assistant-metric--sens"><span class="site-assistant-metric-value">${escapeHtml(num)}</span><span class="site-assistant-metric-unit">sens</span></span>`);

    codeSlots.forEach((code, index) => {
      html = html.replace(`__MR_CODE_${index}__`, code);
    });

    return html;
  }

  function prefersReducedMotion() {
    return document.body?.classList.contains("reduce-motion") || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
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

  function getReverseTypewriterDelay(plain, unitCount, mode) {
    return Math.max(4, Math.floor(getTypewriterDelay(plain, unitCount, mode) * 0.5));
  }

  async function reverseTypewriterText(el, { onScroll, isCancelled } = {}) {
    const current = el.textContent || "";
    if (!current) {
      el.textContent = "";
      return;
    }

    const { plain, units, mode } = getTypewriterUnits(current);
    const delay = getReverseTypewriterDelay(plain, units.length, mode);
    let built = current;

    el.classList.add("site-assistant-typewriter-slot--active");
    onScroll?.();

    if (mode === "char") {
      while (built.length && !isCancelled?.()) {
        built = built.slice(0, -1);
        el.textContent = built;
        onScroll?.();
        if (built.length) await sleep(delay);
      }
    } else {
      const liveUnits = built.split(/(\s+)/);
      while (liveUnits.length && !isCancelled?.()) {
        liveUnits.pop();
        built = liveUnits.join("");
        el.textContent = built;
        onScroll?.();
        if (liveUnits.length) await sleep(delay);
      }
    }

    el.classList.remove("site-assistant-typewriter-slot--active", "site-assistant-typewriter-slot--done");
    el.textContent = "";
    onScroll?.();
  }

  async function reverseTypingDots(bubble, { onScroll, isCancelled } = {}) {
    if (!bubble) return;

    if (!bubble.classList.contains("site-assistant-typing")) {
      bubble.classList.remove("site-assistant-bubble--dots-handoff");
      bubble.replaceChildren();
      return;
    }

    bubble.classList.add("site-assistant-bubble--dots-handoff");
    onScroll?.();
    await sleep(240);
    if (isCancelled?.()) return;

    bubble.classList.remove("site-assistant-typing", "site-assistant-bubble--dots-handoff");
    bubble.replaceChildren();
    onScroll?.();
  }

  function removeTypewriterSlot(slot) {
    if (!slot?.isConnected) return;
    const list = slot.closest("ul, ol");
    slot.remove();
    if (list?.classList.contains("site-assistant-list") && !list.children.length) {
      list.remove();
    }
  }

  async function reverseBotBubble(bubble, { onScroll, isCancelled } = {}) {
    if (!bubble) return;

    if (bubble.classList.contains("site-assistant-typing")) {
      await reverseTypingDots(bubble, { onScroll, isCancelled });
      return;
    }

    if (bubble.classList.contains("site-assistant-bubble--typing-text")) {
      bubble.classList.add("site-assistant-bubble--typing-text");
      await reverseTypewriterText(bubble, { onScroll, isCancelled });
      bubble.classList.remove("site-assistant-bubble--typing-text", "site-assistant-bubble--entering", "site-assistant-bubble--rich");
      bubble.replaceChildren();
      return;
    }

    const slots = [...bubble.querySelectorAll(".site-assistant-typewriter-slot")];
    for (let index = slots.length - 1; index >= 0; index -= 1) {
      if (isCancelled?.()) break;
      const slot = slots[index];
      if (!slot.isConnected) continue;

      if (slot.classList.contains("site-assistant-typewriter-slot--done")) {
        slot.textContent = slot.textContent;
        slot.classList.remove("site-assistant-typewriter-slot--done");
      }

      if ((slot.textContent || "").length) {
        await reverseTypewriterText(slot, { onScroll, isCancelled });
      } else {
        slot.classList.remove("site-assistant-typewriter-slot--active", "site-assistant-typewriter-slot--done");
      }

      removeTypewriterSlot(slot);
      onScroll?.();
    }

    bubble.classList.remove("site-assistant-bubble--rich", "site-assistant-bubble--entering");
    bubble.replaceChildren();
    onScroll?.();
  }

  function buildTypewriterSlotPlan(raw) {
    const slots = [];
    const blocks = parseAssistantBlocks(raw);

    if (!blocks.length) {
      slots.push({ kind: "p", text: raw, isLead: true });
      return slots;
    }

    blocks.forEach((block, index) => {
      if (block.type === "p") {
        slots.push({ kind: "p", text: block.text, isLead: index === 0 });
        return;
      }

      const listType = block.type === "ol" ? "ol" : "ul";
      block.items.forEach((item) => {
        slots.push({ kind: "li", text: item, listType });
      });
    });

    return slots;
  }

  function mountTypewriterSlot(content, slot, listState) {
    if (slot.kind === "p") {
      listState.node = null;
      listState.type = null;
      const paragraph = document.createElement("p");
      paragraph.className = slot.isLead ? "site-assistant-lead site-assistant-typewriter-slot" : "site-assistant-typewriter-slot";
      content.appendChild(paragraph);
      slot.el = paragraph;
      return;
    }

    if (!listState.node || listState.type !== slot.listType) {
      listState.node = document.createElement(slot.listType === "ol" ? "ol" : "ul");
      listState.node.className = "site-assistant-list";
      listState.type = slot.listType;
      content.appendChild(listState.node);
    }

    const item = document.createElement("li");
    item.className = "site-assistant-typewriter-slot";
    listState.node.appendChild(item);
    slot.el = item;
  }

  function buildBotBubbleContent(raw) {
    const body = document.createElement("div");
    body.className = "site-assistant-bubble-body";

    const content = document.createElement("div");
    content.className = "site-assistant-content";

    const blocks = parseAssistantBlocks(raw);
    if (!blocks.length) {
      const paragraph = document.createElement("p");
      paragraph.innerHTML = formatInlineHtml(raw);
      content.appendChild(paragraph);
    } else {
      blocks.forEach((block, index) => {
        if (block.type === "p") {
          const paragraph = document.createElement("p");
          paragraph.className = index === 0 ? "site-assistant-lead" : "";
          paragraph.innerHTML = formatInlineHtml(block.text);
          content.appendChild(paragraph);
          return;
        }
        const list = document.createElement(block.type === "ol" ? "ol" : "ul");
        list.className = "site-assistant-list";
        block.items.forEach((item) => {
          const li = document.createElement("li");
          li.innerHTML = formatInlineHtml(item);
          list.appendChild(li);
        });
        content.appendChild(list);
      });
    }

    body.appendChild(content);
    return body;
  }

  function createTypewriterBubbleBody(raw) {
    const body = document.createElement("div");
    body.className = "site-assistant-bubble-body site-assistant-bubble-body--entering";

    const content = document.createElement("div");
    content.className = "site-assistant-content";
    body.appendChild(content);

    return { body, content, slots: buildTypewriterSlotPlan(raw) };
  }

  async function morphTypingDotsToContent(bubble, { isCancelled } = {}) {
    if (!bubble.classList.contains("site-assistant-typing")) return;

    bubble.classList.add("site-assistant-bubble--dots-handoff");
    await sleep(240);
    if (isCancelled?.()) return;

    bubble.classList.remove("site-assistant-typing", "site-assistant-bubble--dots-handoff");
    bubble.replaceChildren();
  }

  async function typewriterIntoSlots(content, slots, { onScroll, isCancelled }) {
    const listState = { node: null, type: null };

    for (const slot of slots) {
      if (isCancelled?.()) return;
      mountTypewriterSlot(content, slot, listState);
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
      await morphTypingDotsToContent(bubble, { isCancelled });
      if (isCancelled?.()) return;
      renderBotBubble(bubble, raw, options);
      onScroll?.();
      return;
    }

    await morphTypingDotsToContent(bubble, { isCancelled });
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
    const { body, content, slots } = createTypewriterBubbleBody(raw);
    bubble.append(body);

    await typewriterIntoSlots(content, slots, { onScroll, isCancelled });
    if (isCancelled?.()) return;

    bubble.classList.remove("site-assistant-bubble--entering");
    onScroll?.();
  }

  function renderBotBubble(bubble, text, { simple = false } = {}) {
    const raw = String(text || "").trim();
    bubble.classList.toggle("site-assistant-bubble--rich", !simple);
    bubble.replaceChildren();

    if (simple) {
      bubble.textContent = raw;
      return;
    }

    bubble.append(buildBotBubbleContent(raw));
  }

  function getUserConversationIndex(userOrdinal) {
    let count = 0;
    for (let index = 0; index < conversation.length; index += 1) {
      if (conversation[index].role !== "user") continue;
      if (count === userOrdinal) return index;
      count += 1;
    }
    return -1;
  }

  function truncateConversationFromUser(userOrdinal) {
    const convIndex = getUserConversationIndex(userOrdinal);
    if (convIndex < 0) return false;
    conversation.splice(convIndex);
    return true;
  }

  function truncateConversationAfterUser(userOrdinal) {
    const convIndex = getUserConversationIndex(userOrdinal);
    if (convIndex < 0) return false;
    conversation.splice(convIndex + 1);
    return true;
  }

  function createRegenerateButton() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "site-assistant-regenerate";
    btn.setAttribute("aria-label", "Regenerate response");
    btn.innerHTML = '<i class="ri-refresh-line" aria-hidden="true"></i>';
    return btn;
  }

  function attachRegenerateButton(row) {
    if (!row?.classList.contains("site-assistant-msg--bot")) return;
    if (row.querySelector(".site-assistant-regenerate")) return;
    row.appendChild(createRegenerateButton());
  }

  function createUserMessageEl(text, userIndex) {
    const row = document.createElement("div");
    row.className = "site-assistant-msg site-assistant-msg--user";
    row.dataset.userIndex = String(userIndex);

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "site-assistant-edit";
    editBtn.setAttribute("aria-label", "Edit message");
    editBtn.innerHTML = '<i class="ri-pencil-line" aria-hidden="true"></i>';

    const bubble = document.createElement("div");
    bubble.className = "site-assistant-bubble";
    bubble.textContent = text;

    row.append(bubble, editBtn);
    return { row, bubble, editBtn };
  }

  function createMessageEl(role, text, userIndex = 0) {
    if (role === "user") return createUserMessageEl(text, userIndex);

    const row = document.createElement("div");
    row.className = `site-assistant-msg site-assistant-msg--${role}`;
    const bubble = document.createElement("div");
    bubble.className = "site-assistant-bubble";
    renderBotBubble(bubble, text);
    row.appendChild(bubble);
    attachRegenerateButton(row);
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

  function initToggleMagnetism(dock, toggle, { isLocked }) {
    if (typeof initMagneticPull !== "function") {
      return { lock() {}, unlock() {} };
    }
    return initMagneticPull(dock, {
      pullRadius: 100,
      followRadius: null,
      maxOffset: 42,
      pullXVar: "--site-assistant-toggle-pull-x",
      pullYVar: "--site-assistant-toggle-pull-y",
      isLocked,
      isBlocked: () => typeof isSiteAssistantPullBlocked === "function" && isSiteAssistantPullBlocked(),
      buttonSizeFallback: 64,
      hoverElement: toggle,
    });
  }

  function initSiteAssistant() {
    const root = document.getElementById("site-assistant");
    const dock = root?.querySelector(".site-assistant-dock");
    const toggle = document.getElementById("site-assistant-toggle");
    const panel = document.getElementById("site-assistant-panel");
    const closeBtn = document.getElementById("site-assistant-close");
    const clearBtn = document.getElementById("site-assistant-clear");
    const stopBtn = document.getElementById("site-assistant-stop");
    const form = document.getElementById("site-assistant-form");
    const input = document.getElementById("site-assistant-input");
    const sendBtn = form?.querySelector(".site-assistant-send");
    const messages = document.getElementById("site-assistant-messages");
    const offlineNotice = document.getElementById("site-assistant-offline");
    if (!root || !dock || !toggle || !panel || !form || !input || !messages) return;
    if (initSiteAssistant._init) return;
    initSiteAssistant._init = true;

    let open = false;
    let busy = false;
    let replyToken = 0;
    let stopping = false;
    let activeReply = null;
    let offline = !navigator.onLine;
    const toggleMagnet = initToggleMagnetism(dock, toggle, { isLocked: () => open });

    const hasChatMessages = () => messages.querySelector(".site-assistant-msg") != null;
    const hasMessageToSend = () => Boolean(String(input.value || "").trim());

    const syncComposerControls = () => {
      input.disabled = offline || busy;
      if (sendBtn) sendBtn.disabled = offline || busy || !hasMessageToSend();
      if (clearBtn) clearBtn.disabled = offline || busy || !hasChatMessages();
      if (stopBtn) {
        stopBtn.hidden = !busy;
        stopBtn.disabled = stopping;
      }
      root.classList.toggle("is-busy", busy);
    };

    const setConnectionOnline = (online) => {
      offline = !online;
      root.classList.toggle("is-offline", offline);
      if (offlineNotice) offlineNotice.hidden = !offline;
      syncComposerControls();
      if (offline && busy) stopResponse();
    };

    const setBusy = (next) => {
      busy = Boolean(next);
      syncComposerControls();
    };

    const trackActiveReply = (row, bubble, abortController, token) => {
      activeReply = { row, bubble, abortController, token, typewriterTask: null };
    };

    const clearActiveReply = () => {
      activeReply = null;
    };

    const stopResponse = async () => {
      if (!busy || stopping) return;
      const reply = activeReply;
      if (!reply?.row?.isConnected) return;

      stopping = true;
      if (stopBtn) stopBtn.disabled = true;
      reply.abortController?.abort();
      replyToken += 1;

      if (reply.typewriterTask) {
        await reply.typewriterTask.catch(() => {});
      }

      const { row, bubble } = reply;
      if (bubble?.isConnected) {
        if (!prefersReducedMotion()) {
          await reverseBotBubble(bubble, { onScroll: scrollMessages });
        }
        row.remove();
      }

      popLastAssistantFromConversation();
      clearActiveReply();
      stopping = false;
      setBusy(false);
      input.focus({ preventScroll: true });
    };

    const clearChat = async () => {
      if (busy && messages.querySelector(".site-assistant-msg--exiting")) return;

      activeReply?.abortController?.abort();
      replyToken += 1;
      stopping = false;
      clearActiveReply();

      const rows = [...messages.querySelectorAll(".site-assistant-msg")];
      if (rows.length) {
        setBusy(true);
        if (!prefersReducedMotion()) {
          rows.forEach((row) => row.classList.add("site-assistant-msg--exiting"));
          await sleep(MSG_EXIT_MS);
        }
      }

      messages.replaceChildren();
      conversation.length = 0;
      setBusy(false);
      syncComposerControls();
      input.focus({ preventScroll: true });
    };

    const setOpen = (next) => {
      const wasOpen = open;
      open = Boolean(next);
      root.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close site helper" : "Open site helper");
      panel.setAttribute("aria-hidden", open ? "false" : "true");
      if (open && !wasOpen) toggleMagnet.lock();
      if (!open && wasOpen) toggleMagnet.unlock();
      if (open) {
        if (!offline) requestAnimationFrame(() => input.focus({ preventScroll: true }));
      }
    };

    const scrollMessages = () => {
      messages.scrollTop = messages.scrollHeight;
    };

    const countUserMessages = () => messages.querySelectorAll(".site-assistant-msg--user").length;

    const removeMessagesAfterRow = (row) => {
      let next = row.nextElementSibling;
      while (next) {
        const sibling = next.nextElementSibling;
        next.remove();
        next = sibling;
      }
    };

    const closeMessageEditor = (row, { restore = true } = {}) => {
      if (!row?.classList.contains("site-assistant-msg--editing")) return;
      const bubble = row.querySelector(".site-assistant-bubble");
      const saved = row.dataset.editOriginal || "";
      row.classList.remove("site-assistant-msg--editing");
      delete row.dataset.editOriginal;
      if (!bubble) return;
      bubble.className = "site-assistant-bubble";
      bubble.replaceChildren();
      bubble.textContent = restore ? saved : bubble.textContent || saved;
    };

    const closeAllMessageEditors = ({ restore = true } = {}) => {
      messages.querySelectorAll(".site-assistant-msg--editing").forEach((row) => {
        closeMessageEditor(row, { restore });
      });
    };

    const openMessageEditor = (row) => {
      if (busy || offline || !row) return;
      closeAllMessageEditors();

      const bubble = row.querySelector(".site-assistant-bubble");
      if (!bubble) return;

      const current = bubble.textContent || "";
      row.dataset.editOriginal = current;
      row.classList.add("site-assistant-msg--editing");

      const editor = document.createElement("textarea");
      editor.className = "site-assistant-edit-input";
      editor.value = current;
      editor.maxLength = 280;
      editor.rows = Math.min(5, Math.max(2, current.split("\n").length + 1));
      editor.setAttribute("aria-label", "Edit your message");

      const actions = document.createElement("div");
      actions.className = "site-assistant-edit-actions";

      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "site-assistant-edit-save";
      saveBtn.textContent = "Send";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "site-assistant-edit-cancel";
      cancelBtn.textContent = "Cancel";

      actions.append(cancelBtn, saveBtn);
      bubble.className = "site-assistant-bubble site-assistant-bubble--editing";
      bubble.replaceChildren(editor, actions);

      const submitEdit = () => {
        const next = editor.value.trim();
        if (!next) return;
        submitEditedMessage(row, next);
      };

      cancelBtn.addEventListener("click", () => closeMessageEditor(row));
      saveBtn.addEventListener("click", submitEdit);
      editor.addEventListener("keydown", (event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          submitEdit();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          closeMessageEditor(row);
        }
      });

      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
      scrollMessages();
    };

    const sendBotReply = async (trimmed, { appendUser = true, regenerate = false } = {}) => {
      if ((!trimmed && !regenerate) || busy || offline) return;

      if (appendUser) {
        const userIndex = countUserMessages();
        messages.appendChild(createUserMessageEl(trimmed, userIndex).row);
      }

      const typing = createTypingEl();
      messages.appendChild(typing.row);
      scrollMessages();
      const token = ++replyToken;
      const abortController = new AbortController();
      trackActiveReply(typing.row, typing.bubble, abortController, token);
      setBusy(true);

      try {
        const answer = regenerate ? await regenerateAiReply({ signal: abortController.signal }) : await answerWithAi(trimmed, { signal: abortController.signal });
        if (token !== replyToken || stopping) return;
        const typewriterTask = typewriterBotBubble(
          typing.bubble,
          answer,
          {},
          {
            onScroll: scrollMessages,
            isCancelled: () => token !== replyToken || stopping,
          },
        );
        if (activeReply?.token === token) activeReply.typewriterTask = typewriterTask;
        await typewriterTask;
      } catch (error) {
        if (error?.name === "AbortError" || abortController.signal.aborted) return;
        if (token !== replyToken || stopping) return;
        const typewriterTask = typewriterBotBubble(
          typing.bubble,
          error?.message || "Sorry, I could not answer that right now. Try again in a few seconds.",
          {},
          {
            onScroll: scrollMessages,
            isCancelled: () => token !== replyToken || stopping,
          },
        );
        if (activeReply?.token === token) activeReply.typewriterTask = typewriterTask;
        await typewriterTask;
      } finally {
        if (token === replyToken && !stopping) {
          attachRegenerateButton(typing.row);
          clearActiveReply();
          setBusy(false);
          scrollMessages();
        }
      }
    };

    const getPrecedingUserRow = (botRow) => {
      let prev = botRow?.previousElementSibling;
      while (prev) {
        if (prev.classList.contains("site-assistant-msg--user")) return prev;
        prev = prev.previousElementSibling;
      }
      return null;
    };

    const regenerateResponse = async (botRow) => {
      if (busy || offline || !botRow) return;

      const userRow = getPrecedingUserRow(botRow);
      if (!userRow) return;

      const userText = userRow.querySelector(".site-assistant-bubble")?.textContent?.trim();
      const userOrdinal = Number.parseInt(userRow.dataset.userIndex || "", 10);
      if (!userText || Number.isNaN(userOrdinal)) return;

      closeAllMessageEditors();
      activeReply?.abortController?.abort();
      replyToken += 1;
      stopping = false;
      clearActiveReply();

      removeMessagesAfterRow(userRow);
      truncateConversationAfterUser(userOrdinal);
      scrollMessages();
      await sendBotReply(userText, { appendUser: false, regenerate: true });
    };

    const submitEditedMessage = async (row, trimmed) => {
      if (!trimmed || busy || offline) return;

      const userOrdinal = Number.parseInt(row.dataset.userIndex || "", 10);
      if (Number.isNaN(userOrdinal)) return;

      activeReply?.abortController?.abort();
      replyToken += 1;
      stopping = false;
      clearActiveReply();

      row.classList.remove("site-assistant-msg--editing");
      delete row.dataset.editOriginal;
      removeMessagesAfterRow(row);
      truncateConversationFromUser(userOrdinal);

      const bubble = row.querySelector(".site-assistant-bubble");
      if (bubble) {
        bubble.className = "site-assistant-bubble";
        bubble.replaceChildren();
        bubble.textContent = trimmed;
      }

      scrollMessages();
      await sendBotReply(trimmed, { appendUser: false });
    };

    const ask = async (text) => {
      const trimmed = String(text || "").trim();
      if (!trimmed || busy || offline) return;
      closeAllMessageEditors();
      await sendBotReply(trimmed);
    };

    toggle.addEventListener("click", () => setOpen(!open));
    closeBtn?.addEventListener("click", () => setOpen(false));
    clearBtn?.addEventListener("click", clearChat);
    stopBtn?.addEventListener("click", stopResponse);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value;
      if (!String(value || "").trim()) return;
      input.value = "";
      syncComposerControls();
      ask(value);
    });

    input.addEventListener("input", syncComposerControls);

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && open) {
        const editing = messages.querySelector(".site-assistant-msg--editing");
        if (editing) {
          event.preventDefault();
          closeMessageEditor(editing);
          return;
        }
        event.preventDefault();
        setOpen(false);
      }
    });

    messages.addEventListener("click", (event) => {
      if (busy || offline) return;
      const regenBtn = event.target.closest(".site-assistant-regenerate");
      if (regenBtn) {
        event.preventDefault();
        regenerateResponse(regenBtn.closest(".site-assistant-msg--bot"));
        return;
      }
      const editBtn = event.target.closest(".site-assistant-edit");
      if (editBtn) {
        event.preventDefault();
        const row = editBtn.closest(".site-assistant-msg--user");
        openMessageEditor(row);
        return;
      }
      const bubble = event.target.closest(".site-assistant-msg--user .site-assistant-bubble");
      if (bubble && !bubble.classList.contains("site-assistant-bubble--editing")) {
        openMessageEditor(bubble.closest(".site-assistant-msg--user"));
      }
    });

    document.addEventListener("pointerdown", (event) => {
      if (!open || busy) return;
      if (root.contains(event.target)) return;
      setOpen(false);
    });

    const syncConnection = () => setConnectionOnline(navigator.onLine);
    syncConnection();
    syncComposerControls();
    window.addEventListener("online", syncConnection);
    window.addEventListener("offline", syncConnection);
  }

  global.MorningRoastAssistant = Object.freeze({
    initSiteAssistant,
  });
})(typeof window !== "undefined" ? window : globalThis);
