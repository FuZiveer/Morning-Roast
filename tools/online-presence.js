/** Maintains one WebSocket connection for the live member count. */
(function (global) {
  const RECONNECT_BASE_MS = 1500;
  const RECONNECT_MAX_MS = 30000;
  let activeSession = null;

  function resolveWsUrl() {
    const configured = document.querySelector('meta[name="morning-roast-presence-ws"]')?.content?.trim();
    if (configured) return configured;

    const host = global.location?.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      const protocol = global.location?.protocol === "https:" ? "wss" : "ws";
      return `${protocol}://${host}:8080/presence`;
    }
    return "";
  }

  function initOnlinePresence(handlers = {}) {
    if (activeSession) {
      activeSession.handlers = handlers;
      return activeSession.api;
    }

    const url = resolveWsUrl();
    const session = {
      handlers,
      socket: null,
      timer: null,
      reconnectMs: RECONNECT_BASE_MS,
      stopped: false,
      generation: 0,
      api: null,
    };

    const emitState = (state) => session.handlers.onState?.(state);
    const clearReconnect = () => {
      if (session.timer !== null) clearTimeout(session.timer);
      session.timer = null;
    };
    const closeSocket = () => {
      const socket = session.socket;
      session.socket = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    };
    const scheduleReconnect = () => {
      clearReconnect();
      if (session.stopped || !url) return;
      session.timer = setTimeout(connect, session.reconnectMs);
      session.reconnectMs = Math.min(Math.round(session.reconnectMs * 1.5), RECONNECT_MAX_MS);
    };

    function connect() {
      if (!url) {
        emitState("disabled");
        return;
      }

      clearReconnect();
      closeSocket();
      emitState("connecting");
      const generation = ++session.generation;
      const socket = new WebSocket(url);
      session.socket = socket;

      socket.addEventListener("open", () => {
        if (generation !== session.generation || session.socket !== socket) return;
        session.reconnectMs = RECONNECT_BASE_MS;
        emitState("live");
      });

      socket.addEventListener("message", (event) => {
        if (generation !== session.generation || session.socket !== socket) return;
        try {
          const message = JSON.parse(String(event.data || ""));
          if (message?.type === "count" && Number.isFinite(message.count)) {
            session.handlers.onCount?.(Math.max(0, Math.round(message.count)));
          }
        } catch {
          // Ignore malformed server messages.
        }
      });

      socket.addEventListener("close", () => {
        if (generation !== session.generation) return;
        session.socket = null;
        emitState("offline");
        scheduleReconnect();
      });

      socket.addEventListener("error", () => socket.close());
    }

    session.api = {
      destroy() {
        session.stopped = true;
        clearReconnect();
        session.generation += 1;
        closeSocket();
        activeSession = null;
      },
      reconnect() {
        session.stopped = false;
        session.reconnectMs = RECONNECT_BASE_MS;
        connect();
      },
      getUrl: () => url,
    };

    activeSession = session;
    connect();
    return session.api;
  }

  global.MorningRoastPresence = { initOnlinePresence, resolveWsUrl };
})(window);
