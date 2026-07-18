/** Live visitor count via WebSocket presence server. */
(function (global) {
  const RECONNECT_BASE_MS = 1500;
  const RECONNECT_MAX_MS = 30000;

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
    const url = resolveWsUrl();
    let ws = null;
    let reconnectMs = RECONNECT_BASE_MS;
    let reconnectTimer = null;
    let closedByUser = false;
    let lastCount = null;

    const emitState = (state) => {
      handlers.onState?.(state, lastCount);
    };

    const emitCount = (count) => {
      lastCount = count;
      handlers.onCount?.(count);
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
      emitState("connecting");

      try {
        ws = new WebSocket(url);
      } catch {
        ws = null;
        emitState("offline");
        scheduleReconnect();
        return;
      }

      ws.addEventListener("open", () => {
        reconnectMs = RECONNECT_BASE_MS;
        emitState("live");
      });

      ws.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(String(event.data || ""));
          if (data?.type === "count" && Number.isFinite(data.count)) {
            emitCount(Math.max(0, Math.round(data.count)));
          }
        } catch {
          /* ignore malformed payloads */
        }
      });

      ws.addEventListener("close", () => {
        ws = null;
        emitState("offline");
        scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        ws?.close();
      });
    }

    function destroy() {
      closedByUser = true;
      cleanupReconnect();
      ws?.close();
      ws = null;
    }

    function reconnect() {
      closedByUser = false;
      reconnectMs = RECONNECT_BASE_MS;
      ws?.close();
      connect();
    }

    connect();

    return { destroy, reconnect, getUrl: () => url };
  }

  global.MorningRoastPresence = {
    initOnlinePresence,
    resolveWsUrl,
  };
})(window);
