export function createWebSocketTransport(role) {
  let socket = null;
  let closed = false;
  let reconnectTimer = null;
  const pending = [];
  const listeners = new Set();

  function connect() {
    if (closed) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}${window.location.pathname}`);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "hello", role }));
      while (pending.length > 0 && socket.readyState === WebSocket.OPEN) {
        socket.send(pending.shift());
      }
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      for (const listener of listeners) listener(message);
    });
    socket.addEventListener("close", () => {
      socket = null;
      if (!closed && reconnectTimer === null) {
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, 1000);
      }
    });
  }

  function send(message) {
    const encoded = JSON.stringify(message);
    if (socket?.readyState === WebSocket.OPEN) socket.send(encoded);
    else if (!closed) pending.push(encoded);
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
      socket?.close();
      socket = null;
    },
  };
}