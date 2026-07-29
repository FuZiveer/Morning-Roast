/** Maintains one WebSocket connection for the live member count. */
(function (global) {
  const RECONNECT_BASE_MS = 1500;
  const RECONNECT_MAX_MS = 30000;
  let activeSession = null;

  function isLocalDevHost() {
    const host = global.location?.hostname;
    const isLocalHost = host === "localhost" || host === "127.0.0.1";
    if (!isLocalHost) return false;
    if (global.MorningRoastDesktop?.isDesktop) return false;
    return true;
  }

  function resolveWsUrl() {
    if (isLocalDevHost()) {
      const host = global.location.hostname;
      const protocol = global.location?.protocol === "https:" ? "wss" : "ws";
      return `${protocol}://${host}:8080/presence`;
    }

    const configured = document.querySelector('meta[name="morning-roast-presence-ws"]')?.content?.trim();
    if (configured) return configured;

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
      activity: null,
      api: null,
    };

    const sendActivity = () => {
      const socket = session.socket;
      if (!session.activity || !socket || socket.readyState !== WebSocket.OPEN) return;
      try {
        socket.send(JSON.stringify({ type: "activity", activity: session.activity }));
      } catch {
        // Ignore send failures; activity re-sends on reconnect.
      }
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
        sendActivity();
      });

      socket.addEventListener("message", (event) => {
        if (generation !== session.generation || session.socket !== socket) return;
        try {
          const message = JSON.parse(String(event.data || ""));
          if (message?.type === "count" && Number.isFinite(message.count)) {
            session.handlers.onCount?.(Math.max(0, Math.round(message.count)));
            if (message.activities && typeof message.activities === "object") {
              session.handlers.onActivities?.(message.activities);
            }
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
      setActivity(activity) {
        const next = typeof activity === "string" && activity ? activity : null;
        if (next === session.activity) return;
        session.activity = next;
        sendActivity();
      },
      getUrl: () => url,
    };

    activeSession = session;
    connect();
    return session.api;
  }

  global.MorningRoastPresence = { initOnlinePresence, resolveWsUrl };
})(window);
