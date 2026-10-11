// Audience view entry. Loaded via presenter.js barrel from audience.html.

import {
  readConfig,
  loadDocument,
  renderPage,
  clampSlide,
} from "./modules/pdf-render.js";
import { createWebSocketTransport } from "./modules/websocket.js";
import { createOverlay } from "./modules/overlay.js";

export async function initAudience() {
  const config = readConfig();
  const pdf = await loadDocument(config.pdfUrl);
  const total = pdf.numPages;
  const canvas = document.getElementById("slide-canvas");
  const overlayCanvas = document.getElementById("overlay-layer");
  const blackOverlay = document.getElementById("black-overlay");
  const freezeIndicator = document.getElementById("freeze-indicator");
  const status = document.getElementById("status");

  let currentSlide = 1;
  let frozenAt = null;
  const socket = createWebSocketTransport("audience");
  const strokesBySlide = new Map();
  const overlay = createOverlay({
    canvas,
    overlay: overlayCanvas,
    getStrokes: () => strokesBySlide.get(currentSlide) ?? [],
  });

  async function show(n) {
    const slide = clampSlide(n, total);
    if (frozenAt !== null) return;
    currentSlide = slide;
    overlay.setLaser({ hidden: true });
    overlay.redraw();
    await renderPage(pdf, slide, canvas);
    overlay.resize();
    if (status) status.textContent = `${slide} / ${total}`;
  }

  function setFrozen(frozen) {
    if (frozen) {
      frozenAt = currentSlide;
      freezeIndicator.classList.remove("hidden");
    } else {
      frozenAt = null;
      freezeIndicator.classList.add("hidden");
      show(currentSlide);
    }
  }

  function setBlack(on) {
    blackOverlay.classList.toggle("hidden", !on);
  }

  function setCursor(msg) {
    overlay.setLaser(msg);
  }

  socket.onMessage((msg) => {
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "slide":
        if (frozenAt === null) show(msg.slide);
        break;
      case "freeze":
        setFrozen(!!msg.value);
        break;
      case "black":
        setBlack(!!msg.value);
        break;
      case "cursor":
        setCursor(msg);
        break;
      case "stroke": {
        const strokes = strokesBySlide.get(msg.slide) ?? [];
        const index = strokes.findIndex((stroke) => stroke.id === msg.id);
        if (index >= 0) strokes[index] = msg;
        else strokes.push(msg);
        strokesBySlide.set(msg.slide, strokes);
        if (msg.slide === currentSlide) overlay.redraw();
        break;
      }
      case "erase-stroke":
        strokesBySlide.set(
          msg.slide,
          (strokesBySlide.get(msg.slide) ?? []).filter((stroke) => stroke.id !== msg.id),
        );
        if (msg.slide === currentSlide) overlay.redraw();
        break;
      case "clear-slide":
        strokesBySlide.delete(msg.slide);
        if (msg.slide === currentSlide) overlay.redraw();
        break;
      case "snapshot":
        for (const [slide, strokes] of Object.entries(msg.strokes ?? {})) {
          strokesBySlide.set(Number(slide), strokes);
        }
        frozenAt = null;
        show(msg.slide).then(() => setFrozen(!!msg.frozen));
        setBlack(!!msg.black);
        break;
    }
  });

  // Derive presenter URL from current location (works for both single and directory mode)
  const presenterUrl = window.location.pathname.replace(/\/?$/, "") + "/presenter";

  // Toolbar: show only when cursor is near top-right corner, hide otherwise
  const toolbar = document.getElementById("audience-toolbar");
  let hideTimer = null;
  function showToolbar() {
    if (!toolbar) return;
    toolbar.classList.add("visible");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!toolbar.matches(":hover")) toolbar.classList.remove("visible");
    }, 1500);
  }
  function hideToolbar() {
    if (!toolbar) return;
    toolbar.classList.remove("visible");
    clearTimeout(hideTimer);
  }
  window.addEventListener("mousemove", (ev) => {
    if (ev.clientX > window.innerWidth - 250 && ev.clientY < 80) {
      showToolbar();
    } else if (toolbar && !toolbar.matches(":hover")) {
      hideToolbar();
    }
  });
  if (toolbar) {
    toolbar.addEventListener("mouseleave", hideToolbar);
  }

  // Toolbar buttons
  document.getElementById("fullscreen-btn")?.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen();
    }
  });
  document.getElementById("presenter-btn")?.addEventListener("click", () => {
    window.open(presenterUrl, "_blank");
  });

  // Audience navigation is presenter-authoritative over the network.
  window.addEventListener("keydown", (ev) => {
    if (ev.key === "p" || ev.key === "P") {
      window.open(presenterUrl, "pdf-presenter-presenter");
    }
  });

  window.addEventListener("resize", () => {
    if (frozenAt === null) {
      renderPage(pdf, currentSlide, canvas).then(() => overlay.resize());
    }
  });

  await show(1);
}
