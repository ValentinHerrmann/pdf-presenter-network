// pdf.js draws a page in chunks and schedules each chunk with
// requestAnimationFrame. Browsers stop animation frames for windows that are
// not shown (minimized, on another workspace or desktop; on Wayland even
// while the page still reports "visible"). A render started there never
// finishes, so the audience stays on the old slide although the slide
// message arrived over the WebSocket.
//
// This wrapper runs a frame callback as a MessageChannel task (which, unlike
// timers, is not throttled in the background) when the page is hidden or
// when no frame came within FRAME_WATCHDOG_MS. Pages that get frames behave
// as before.

const FRAME_WATCHDOG_MS = 100;

export function installFrameFallback(win = window) {
  if (
    typeof win.requestAnimationFrame !== "function" ||
    typeof win.MessageChannel !== "function" ||
    win.__pdfPresenterFrameFallback
  ) {
    return;
  }
  win.__pdfPresenterFrameFallback = true;

  const doc = win.document;
  const nativeRequest = win.requestAnimationFrame.bind(win);
  const nativeCancel = win.cancelAnimationFrame.bind(win);
  const channel = new win.MessageChannel();
  // id -> { callback, nativeId, timer, queued }
  const pending = new Map();
  let nextId = 0;
  // Set when the watchdog fired: later callbacks skip waiting for a frame
  // until a real frame shows up again (probe).
  let framesStalled = false;
  let probeArmed = false;

  function detach(entry) {
    if (entry.nativeId !== null) nativeCancel(entry.nativeId);
    if (entry.timer !== null) win.clearTimeout(entry.timer);
    entry.nativeId = null;
    entry.timer = null;
  }

  function run(id, time) {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    detach(entry);
    entry.callback(time ?? win.performance.now());
  }

  function queue(id, entry) {
    detach(entry);
    if (entry.queued) return;
    entry.queued = true;
    channel.port2.postMessage(id);
  }

  function armProbe() {
    if (probeArmed) return;
    probeArmed = true;
    nativeRequest(() => {
      probeArmed = false;
      framesStalled = false;
    });
  }

  channel.port1.onmessage = (event) => run(event.data);

  win.requestAnimationFrame = (callback) => {
    if (typeof callback !== "function") return nativeRequest(callback);
    const id = ++nextId;
    const entry = { callback, nativeId: null, timer: null, queued: false };
    pending.set(id, entry);
    if (doc.visibilityState === "hidden" || framesStalled) {
      queue(id, entry);
      if (framesStalled) armProbe();
    } else {
      entry.nativeId = nativeRequest((time) => run(id, time));
      entry.timer = win.setTimeout(() => {
        entry.timer = null;
        framesStalled = true;
        armProbe();
        queue(id, entry);
      }, FRAME_WATCHDOG_MS);
    }
    return id;
  };

  win.cancelAnimationFrame = (id) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    detach(entry);
  };

  // A chunk scheduled just before the window was hidden would otherwise
  // wait for a frame that does not come.
  doc.addEventListener("visibilitychange", () => {
    if (doc.visibilityState !== "hidden") return;
    for (const [id, entry] of pending) queue(id, entry);
  });
}
