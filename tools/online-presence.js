/** Live visitor count via WebSocket presence server. */
(function (global) {
  const RECONNECT_BASE_MS = 1500;
  const RECONNECT_MAX_MS = 30000;

  /** @type {{ api: object, setHandlers: Function, onVisibilityChange: Function } | null} */
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

  function socketConnectingOrOpen(ws) {
    return ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN);
  }

  function initOnlinePresence(handlers = {}) {
    if (activeSession) {
      activeSession.setHandlers(handlers);
      return activeSession.api;
    }

    const url = resolveWsUrl();
    let ws = null;
    let reconnectMs = RECONNECT_BASE_MS;
    let reconnectTimer = null;
    let closedByUser = false;
    let intentionalClose = false;
    let lastCount = null;
    let handlersRef = { ...handlers };

    const setHandlers = (next = {}) => {
      handlersRef = { ...handlersRef, ...next };
    };

    const emitState = (state) => {
      handlersRef.onState?.(state, lastCount);
    };

    const emitCount = (count) => {
      lastCount = count;
      handlersRef.onCount?.(count);
      emitState("live");
    };

    const cleanupReconnect = () => {
      if (reconnectTimer != null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      cleanupReconnect();
      if (closedByUser || !url || document.hidden) return;
      reconnectTimer = setTimeout(connect, reconnectMs);
      reconnectMs = Math.min(Math.round(reconnectMs * 1.5), RECONNECT_MAX_MS);
    };

    const teardownSocket = () => {
      if (!ws) return;
      const socket = ws;
      ws = null;
      intentionalClose = true;
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* ignore */
      }
    };

    function bindSocket(socket) {
      socket.addEventListener("open", () => {
        reconnectMs = RECONNECT_BASE_MS;
      });

      socket.addEventListener("message", (event) => {
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
        if (ws !== socket) {
          intentionalClose = false;
          return;
        }
        ws = null;
        if (intentionalClose) {
          intentionalClose = false;
          return;
        }
        emitState("offline");
        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        if (ws !== socket) return;
        teardownSocket();
      });
    }

    function connect() {
      if (!url) {
        emitState("disabled");
        return;
      }
      if (document.hidden) return;
      if (socketConnectingOrOpen(ws)) return;

      cleanupReconnect();
      teardownSocket();
      intentionalClose = false;
      emitState("connecting");

      try {
        ws = new WebSocket(url);
      } catch {
        ws = null;
        emitState("offline");
        scheduleReconnect();
        return;
      }

      bindSocket(ws);
    }

    function destroy() {
      closedByUser = true;
      cleanupReconnect();
      teardownSocket();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (activeSession?.api === api) activeSession = null;
    }

    function reconnect() {
      closedByUser = false;
      reconnectMs = RECONNECT_BASE_MS;
      teardownSocket();
      connect();
    }

    function onVisibilityChange() {
      if (document.hidden) {
        cleanupReconnect();
        teardownSocket();
        return;
      }
      if (!closedByUser && !socketConnectingOrOpen(ws)) connect();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    const api = { destroy, reconnect, getUrl: () => url };
    activeSession = { api, setHandlers, onVisibilityChange };

    if ("requestIdleCallback" in global) {
      global.requestIdleCallback(() => connect(), { timeout: 3000 });
    } else {
      global.setTimeout(connect, 1500);
    }

    return api;
  }

  global.MorningRoastPresence = {
    initOnlinePresence,
    resolveWsUrl,
  };
})(window);
