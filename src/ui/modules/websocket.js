// Sync transport: WebSocket first, HTTP long-poll fallback for networks
// (e.g. school/corporate proxies) that block WebSocket upgrades.

const WS_OPEN_TIMEOUT_MS = 3000;
const SYNC_URL = "/api/sync";

export function createWebSocketTransport(role) {
  let socket = null;
  let closed = false;
  let reconnectTimer = null;
  let openTimer = null;
  let everOpened = false;
  let httpMode = false;
  const pending = [];
  const listeners = new Set();

  function dispatch(message) {
    for (const listener of listeners) listener(message);
  }

  function connect() {
    if (closed || httpMode) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}${window.location.pathname}`);
    socket = ws;

    if (!everOpened) {
      openTimer = window.setTimeout(() => {
        openTimer = null;
        if (ws.readyState !== WebSocket.OPEN) switchToHttp();
      }, WS_OPEN_TIMEOUT_MS);
    }

    ws.addEventListener("open", () => {
      if (httpMode) return ws.close();
      everOpened = true;
      if (openTimer !== null) window.clearTimeout(openTimer);
      openTimer = null;
      ws.send(JSON.stringify({ type: "hello", role }));
      while (pending.length > 0 && ws.readyState === WebSocket.OPEN) {
        ws.send(pending.shift());
      }
    });
    ws.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      dispatch(message);
    });
    ws.addEventListener("close", () => {
      if (socket === ws) socket = null;
      if (httpMode) return;
      if (!everOpened) {
        switchToHttp();
        return;
      }
      if (!closed && reconnectTimer === null) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 1000);
      }
    });
  }

  // --- HTTP long-poll fallback ---

  let seq = null;
  let posting = false;
  const outbox = [];

  function switchToHttp() {
    if (closed || httpMode) return;
    httpMode = true;
    if (openTimer !== null) window.clearTimeout(openTimer);
    openTimer = null;
    const ws = socket;
    socket = null;
    ws?.close();
    while (pending.length > 0) enqueue(JSON.parse(pending.shift()));
    poll();
  }

  async function poll() {
    while (!closed) {
      try {
        const response = await fetch(seq === null ? SYNC_URL : `${SYNC_URL}?since=${seq}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`sync poll failed: ${response.status}`);
        const body = await response.json();
        seq = body.seq;
        for (const message of body.events) dispatch(message);
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    }
  }

  function enqueue(message) {
    // Laser moves fire rapidly; only the latest queued position matters.
    const last = outbox[outbox.length - 1];
    if (message.type === "cursor" && last?.type === "cursor") outbox[outbox.length - 1] = message;
    else outbox.push(message);
    flush();
  }

  async function flush() {
    if (posting) return;
    posting = true;
    while (outbox.length > 0 && !closed) {
      const message = outbox[0];
      try {
        await fetch(SYNC_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(message),
        });
        outbox.shift();
      } catch {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    }
    posting = false;
  }

  function send(message) {
    if (closed) return;
    if (httpMode) return enqueue(message);
    const encoded = JSON.stringify(message);
    if (socket?.readyState === WebSocket.OPEN) socket.send(encoded);
    else pending.push(encoded);
  }

  connect();

  return {
    send,
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (openTimer !== null) window.clearTimeout(openTimer);
      socket?.close();
      socket = null;
    },
  };
}
