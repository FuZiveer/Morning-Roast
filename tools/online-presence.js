/** Live visitor count via WebSocket presence server. */
(function (global) {
  const RECONNECT_BASE_MS = 1500;
  const RECONNECT_MAX_MS = 30000;

  /** @type {{ setHandlers: (handlers: object) => void, api: object } | null} */
  let activeSession = null;

  function resolveWsUrl() {
    const meta = document.querySelector('meta[name="morning-roast-presence-ws"]')?.content?.trim();
    if (meta) return meta;

    const host = global.location?.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      const port = global.location?.port;
      const protocol = global.location?.protocol === "https:" ? "wss" : "ws";
      const fallbackPort = port && port !== "80" && port !== "443" ? ":8080" : ":8080";
      return `${protocol}://${host}${fallbackPort}/presence`;
    }

    return "";
  }

  function initOnlinePresence(handlers = {}) {
    if (activeSession) {
      activeSession.setHandlers(handlers);
      return activeSession.api;
    }

    const url = resolveWsUrl();
    let ws = null;
    let connectGeneration = 0;
    let reconnectMs = RECONNECT_BASE_MS;
    let reconnectTimer = null;
    let closedByUser = false;
    let handlerRef = handlers;

    const getHandlers = () => handlerRef;

    const emitState = (state) => {
      getHandlers().onState?.(state);
    };

    const emitCount = (count) => {
      getHandlers().onCount?.(count);
    };

    const cleanupReconnect = () => {
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const closeSocket = () => {
      if (!ws) return;
      const socket = ws;
      ws = null;
      socket.close();
    };

    const scheduleReconnect = () => {
      cleanupReconnect();
      if (closedByUser || !url) return;
      reconnectTimer = setTimeout(connect, reconnectMs);
      reconnectMs = Math.min(Math.round(reconnectMs * 1.5), RECONNECT_MAX_MS);
    };

    function connect() {
      if (!url) {
        emitState("disabled");
        return;
      }

      cleanupReconnect();
      closeSocket();
      emitState("connecting");

      const generation = ++connectGeneration;
      let socket;

      try {
        socket = new WebSocket(url);
      } catch {
        emitState("offline");
        scheduleReconnect();
        return;
      }

      ws = socket;

      socket.addEventListener("open", () => {
        if (generation !== connectGeneration || ws !== socket) return;
        reconnectMs = RECONNECT_BASE_MS;
        emitState("live");
      });

      socket.addEventListener("message", (event) => {
        if (generation !== connectGeneration || ws !== socket) return;
        try {
          const data = JSON.parse(String(event.data || ""));
          if (data?.type === "count" && Number.isFinite(data.count)) {
            emitCount(Math.max(0, Math.round(data.count)));
          }
        } catch {
          /* ignore malformed payloads */
        }
      });

      socket.addEventListener("close", () => {
        if (generation !== connectGeneration) return;
        ws = null;
        emitState("offline");
        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        if (ws === socket) socket.close();
      });
    }

    function destroy() {
      closedByUser = true;
      cleanupReconnect();
      connectGeneration += 1;
      closeSocket();
      activeSession = null;
    }

    function reconnect() {
      closedByUser = false;
      reconnectMs = RECONNECT_BASE_MS;
      cleanupReconnect();
      closeSocket();
      scheduleReconnect();
    }

    const onPageHide = () => {
      if (closedByUser || !url) return;
      cleanupReconnect();
      connectGeneration += 1;
      closeSocket();
    };

    const onPageShow = (event) => {
      if (closedByUser || !url || !event.persisted) return;
      if (!ws || ws.readyState === WebSocket.CLOSED) {
        reconnectMs = RECONNECT_BASE_MS;
        connect();
      }
    };

    global.addEventListener("pagehide", onPageHide);
    global.addEventListener("pageshow", onPageShow);

    const api = { destroy, reconnect, getUrl: () => url };
    activeSession = {
      setHandlers(nextHandlers = {}) {
        handlerRef = nextHandlers;
      },
      api,
    };

    connect();

    return api;
  }

  global.MorningRoastPresence = {
    initOnlinePresence,
    resolveWsUrl,
  };
})(window);
