// Presenter view entry. Loaded via presenter.js barrel from presenter.html.
// This file is a thin orchestrator — all subsystem logic lives under
// ./modules/ and is composed here via factory functions.

import {
  readConfig,
  loadDocument,
  loadNotes,
  renderPage,
  clampSlide,
} from "./modules/pdf-render.js";
import { createTimer } from "./modules/timer.js";
import { createNotesEditor } from "./modules/notes-editor.js";
import { wireImportExport } from "./modules/import-export.js";
import { createRecordingDialog } from "./modules/recording-dialog.js";
import { createRecorder } from "./modules/recording.js";
import { createResizableLayout } from "./modules/resizable-layout.js";
import { createGridView } from "./modules/grid-view.js";
import { createWebSocketTransport } from "./modules/websocket.js";
import { createOverlay } from "./modules/overlay.js";
import { createLinkLayer } from "./modules/link-layer.js";
import { readSlideDurations } from "./modules/slide-duration.js";
import { createSlideViewport } from "./modules/slide-viewport.js";

export async function initPresenter() {
  const config = readConfig();
  const pdf = await loadDocument(config.pdfUrl);
  const total = pdf.numPages;
  const slideDurations = await readSlideDurations(pdf);
  const notesFile = await loadNotes(config.notesUrl);
  const notes = (notesFile && notesFile.notes) || {};

  const currentCanvas = document.getElementById("current-canvas");
  const nextCanvas = document.getElementById("next-canvas");
  const currentContainer = currentCanvas?.closest(".canvas-wrap");
  const nextContainer = nextCanvas?.closest(".canvas-wrap");
  const notesBody = document.getElementById("notes-body");
  const notesStatus = document.getElementById("notes-status");
  const notesHint = document.getElementById("notes-hint");
  const counter = document.getElementById("counter");
  const timerEl = document.getElementById("timer");
  const pdfNameEl = document.getElementById("pdf-name");
  const gridBtn = document.getElementById("grid-btn");
  const linkLayerEl = document.getElementById("link-layer");
  const overlayCanvas = document.getElementById("overlay-layer");
  const notesPanel = document.getElementById("notes-panel");
  const notesToggle = document.getElementById("toggle-notes");
  const leftColumn = document.querySelector(".col-left");

  if (pdfNameEl && config.pdfName) {
    pdfNameEl.textContent = config.pdfName;
    pdfNameEl.title = config.pdfName;
  }

  // Show "back to list" button when launched from directory mode
  if (config.listUrl) {
    const backBtn = document.getElementById("back-to-list");
    if (backBtn) {
      backBtn.href = config.listUrl;
      backBtn.classList.remove("hidden");
    }
    const openButton = document.getElementById("open-pdf");
    const openInput = document.getElementById("open-pdf-input");
    openButton?.classList.remove("hidden");
    openButton?.addEventListener("click", () => openInput?.click());
    openInput?.addEventListener("change", async () => {
      const file = openInput.files?.[0];
      if (!file || !openButton) return;
      openButton.disabled = true;
      openButton.textContent = "Opening...";
      try {
        const response = await fetch("/api/open", {
          method: "POST",
          headers: {
            "Content-Type": "application/pdf",
            "X-PDF-Name": file.name,
          },
          body: file,
        });
        if (!response.ok) throw new Error(await response.text());
        const result = await response.json();
        window.location.href = result.presenterUrl;
      } catch (err) {
        openButton.disabled = false;
        openButton.textContent = "Open PDF";
        alert(`Could not open PDF: ${err.message}`);
      }
      openInput.value = "";
    });
  }

  // "Audience" button — open audience view in new tab
  document.getElementById("open-audience")?.addEventListener("click", () => {
    const base = window.location.href.replace(/\/presenter\/?$/, "/");
    window.open(base, "_blank");
  });

  const socket = createWebSocketTransport("presenter");
  const strokesBySlide = new Map();
  let selectedTool = "link";
  let penColor = "#2563eb";
  let laserColor = "#2563eb";
  let overlay;
  let linkLayer;
  let transitionTimer = null;
  let notesHidden = true;

  function scheduleTransition() {
    if (transitionTimer !== null) window.clearTimeout(transitionTimer);
    transitionTimer = null;
    const seconds = slideDurations[currentSlide - 1];
    if (
      currentSlide >= total ||
      frozen ||
      blackedOut ||
      typeof seconds !== "number"
    ) {
      return;
    }
    transitionTimer = window.setTimeout(() => {
      transitionTimer = null;
      show(currentSlide + 1);
    }, seconds * 1000);
  }
  let currentSlide = 1;
  let frozen = false;
  let blackedOut = false;

  const editor = createNotesEditor({
    notesBody,
    statusEl: notesStatus,
    hintEl: notesHint,
    notesCache: notes,
    getCurrentSlide: () => currentSlide,
  });

  async function show(n) {
    const target = clampSlide(n, total);
    const slideChanged = target !== currentSlide;
    await editor.flushPending();
    currentSlide = target;
    counter.textContent = `${currentSlide} / ${total}`;
    editor.loadForSlide(currentSlide);
    if (slideChanged) {
      recorder.onSlideChanged(currentSlide);
      timer.resetSlide();
    }
    await Promise.all([
      renderPage(pdf, currentSlide, currentCanvas, currentContainer),
      currentSlide < total
        ? renderPage(pdf, currentSlide + 1, nextCanvas, nextContainer)
        : clearNext(),
    ]);
    await linkLayer?.render(currentSlide);
    slideViewport.reset();
    socket.send({ type: "slide", slide: currentSlide });
    overlay?.resize();
    scheduleTransition();
  }

  function strokesForSlide(slide) {
    return strokesBySlide.get(slide) ?? [];
  }

  overlay = createOverlay({
    canvas: currentCanvas,
    overlay: overlayCanvas,
    interactive: true,
    getTool: () => selectedTool,
    getPenColor: () => penColor,
    getStrokes: () => strokesForSlide(currentSlide),
    onStroke: (stroke) => {
      const strokes = strokesBySlide.get(currentSlide) ?? [];
      const index = strokes.findIndex((item) => item.id === stroke.id);
      if (index >= 0) strokes[index] = stroke;
      else strokes.push(stroke);
      strokesBySlide.set(currentSlide, strokes);
      overlay.redraw();
      socket.send({ type: "stroke", ...stroke, slide: currentSlide });
    },
    onErase: (id) => {
      const strokes = strokesForSlide(currentSlide).filter((stroke) => stroke.id !== id);
      strokesBySlide.set(currentSlide, strokes);
      overlay.redraw();
      socket.send({ type: "erase-stroke", slide: currentSlide, id });
    },
    onLaser: (point) => socket.send({ type: "cursor", ...point, color: laserColor }),
  });

  linkLayer = createLinkLayer({
    pdf,
    canvas: currentCanvas,
    layer: linkLayerEl,
    onNavigate: (slide) => show(slide),
  });

  const slideViewport = createSlideViewport({
    viewport: currentContainer,
    content: currentCanvas.closest(".slide-stack"),
    canPan: () => selectedTool === "link",
    onChange: ({ scale, offsetX, offsetY }) => {
      const zoomReset = document.getElementById("zoom-reset");
      if (zoomReset) zoomReset.textContent = `${Math.round(scale * 100)}%`;
      socket.send({ type: "viewport", scale, offsetX, offsetY });
    },
  });

  document.getElementById("prev-slide")?.addEventListener("click", () => show(currentSlide - 1));
  document.getElementById("next-slide")?.addEventListener("click", () => show(currentSlide + 1));
  document.getElementById("zoom-in")?.addEventListener("click", slideViewport.zoomIn);
  document.getElementById("zoom-out")?.addEventListener("click", slideViewport.zoomOut);
  document.getElementById("zoom-reset")?.addEventListener("click", slideViewport.reset);
  notesToggle?.addEventListener("click", () => {
    notesHidden = !notesHidden;
    notesPanel?.classList.toggle("notes-hidden", notesHidden);
    leftColumn?.classList.toggle("notes-collapsed", notesHidden);
    notesPanel?.setAttribute("aria-hidden", String(notesHidden));
    notesToggle.setAttribute("aria-expanded", String(!notesHidden));
    notesToggle.title = notesHidden ? "Show speaker notes" : "Hide speaker notes";
    notesToggle.setAttribute("aria-label", notesToggle.title);
    slideViewport.resize();
  });

  for (const button of document.querySelectorAll("[data-tool]")) {
    button.addEventListener("click", () => {
      selectedTool = button.dataset.tool;
      for (const candidate of document.querySelectorAll("[data-tool]")) {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      }
      overlay.setInteractive(selectedTool !== "link");
      linkLayerEl?.classList.toggle("active", selectedTool === "link");
    });
  }
  for (const button of document.querySelectorAll("[data-color]")) {
    button.addEventListener("click", () => {
      const color = button.dataset.color;
      const target = button.dataset.colorTarget;
      if (!color || (target !== "pen" && target !== "laser")) return;
      if (target === "pen") penColor = color;
      else laserColor = color;
      document.querySelector(`[data-tool="${target}"]`)?.click();
      for (const candidate of document.querySelectorAll(`[data-color-target="${target}"]`)) {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      }
    });
  }
  linkLayerEl?.classList.add("active");

  socket.onMessage((msg) => {
    if (msg.type === "snapshot") {
      strokesBySlide.clear();
      for (const [slide, strokes] of Object.entries(msg.strokes ?? {})) {
        strokesBySlide.set(Number(slide), strokes);
      }
      overlay.redraw();
    } else if (msg.type === "stroke" && msg.slide && msg.id) {
      const strokes = strokesBySlide.get(msg.slide) ?? [];
      const index = strokes.findIndex((stroke) => stroke.id === msg.id);
      if (index >= 0) strokes[index] = msg;
      else strokes.push(msg);
      strokesBySlide.set(msg.slide, strokes);
      if (msg.slide === currentSlide) overlay.redraw();
    } else if (msg.type === "erase-stroke" && msg.slide && msg.id) {
      strokesBySlide.set(
        msg.slide,
        strokesForSlide(msg.slide).filter((stroke) => stroke.id !== msg.id),
      );
      if (msg.slide === currentSlide) overlay.redraw();
    } else if (msg.type === "clear-slide" && msg.slide) {
      strokesBySlide.delete(msg.slide);
      if (msg.slide === currentSlide) overlay.redraw();
    } else if (msg.type === "viewport") {
      slideViewport.setState(msg);
    }
  });

  function clearNext() {
    const ctx = nextCanvas.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  }

  // ---- Import / export ----
  wireImportExport({
    exportBtn: document.getElementById("export-notes"),
    loadBtn: document.getElementById("load-notes"),
    loadInput: document.getElementById("load-notes-input"),
    statusEl: document.getElementById("notes-action-status"),
    config,
    notesCache: notes,
    flushPending: editor.flushPending,
    onLoaded: () => editor.loadForSlide(currentSlide),
  });

  // ---- Audio recording ----
  const dialog = createRecordingDialog({
    dialogEl: document.getElementById("record-dialog"),
    fileEl: document.getElementById("record-dialog-file"),
    rangeEl: document.getElementById("record-dialog-range"),
    durationEl: document.getElementById("record-dialog-duration"),
    sizeEl: document.getElementById("record-dialog-size"),
    segmentsEl: document.getElementById("record-dialog-segments"),
    errorEl: document.getElementById("record-dialog-error"),
    saveBtn: document.getElementById("record-dialog-save"),
    abandonBtn: document.getElementById("record-dialog-abandon"),
  });

  const recorder = createRecorder({
    config,
    getCurrentSlide: () => currentSlide,
    dialog,
    startBtn: document.getElementById("record-start"),
    pauseBtn: document.getElementById("record-pause"),
    stopBtn: document.getElementById("record-stop"),
    elapsedEl: document.getElementById("record-elapsed"),
    labelEl: document.getElementById("record-label"),
    indicatorEl: document.getElementById("record-indicator"),
  });

  function toggleFreeze() {
    frozen = !frozen;
    if (frozen) {
      if (transitionTimer !== null) window.clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    socket.send({ type: "freeze", value: frozen });
    if (!frozen) scheduleTransition();
  }

  function toggleBlack() {
    blackedOut = !blackedOut;
    if (blackedOut) {
      if (transitionTimer !== null) window.clearTimeout(transitionTimer);
      transitionTimer = null;
    }
    socket.send({ type: "black", value: blackedOut });
    if (!blackedOut) scheduleTransition();
  }

  window.addEventListener("keydown", (ev) => {
    // When the notes editor is focused, let keys behave normally — but give
    // Escape as an explicit way to leave the editor and return to slide nav.
    if (editor.isFocused()) {
      if (ev.key === "Escape") {
        ev.preventDefault();
        notesBody.blur();
      }
      return;
    }
    // Grid view owns the keyboard while open (arrows / Enter / Esc).
    if (gridView.isOpen()) return;
    if (ev.key === "ArrowRight" || ev.key === "PageDown" || ev.key === " ") {
      ev.preventDefault();
      show(currentSlide + 1);
    } else if (ev.key === "ArrowLeft" || ev.key === "PageUp") {
      ev.preventDefault();
      show(currentSlide - 1);
    } else if (ev.key === "Home") {
      show(1);
    } else if (ev.key === "End") {
      show(total);
    } else if (ev.key === "f" || ev.key === "F") {
      toggleFreeze();
    } else if (ev.key === "b" || ev.key === "B") {
      toggleBlack();
    } else if (ev.key === "r" || ev.key === "R") {
      timer.reset();
    } else if (ev.key === "g" || ev.key === "G") {
      ev.preventDefault();
      gridView.open();
    }
  });

  window.addEventListener("resize", () => {
    show(currentSlide);
    overlay.resize();
    slideViewport.resize();
  });

  // ---- Timer ----
  const timerResetBtn = document.getElementById("timer-reset");
  const countdownMs =
    typeof config.timerMinutes === "number" && config.timerMinutes > 0
      ? config.timerMinutes * 60 * 1000
      : null;
  const timer = createTimer({
    timerEl,
    resetBtnEl: timerResetBtn,
    countdownMs,
    slideTimerEl: document.getElementById("slide-timer-value"),
    slideResetBtnEl: document.getElementById("slide-timer-reset"),
  });

  // ---- Grid view ----
  const gridView = createGridView({
    pdf,
    total,
    getCurrentSlide: () => currentSlide,
    onSelect: (n) => show(n),
  });
  if (gridBtn) gridBtn.addEventListener("click", () => gridView.open());

  // ---- Resizable layout dividers ----
  createResizableLayout({
    layoutEl: document.querySelector(".layout"),
    colDividerEl: document.getElementById("divider-col"),
    leftColEl: document.querySelector(".col-left"),
    rowDividerLeftEl: document.getElementById("divider-row-left"),
    rightColEl: document.querySelector(".col-right"),
    rowDividerRightEl: document.getElementById("divider-row-right"),
    onResize: () => {
      show(currentSlide);
      overlay.resize();
      slideViewport.resize();
    },
  });

  await show(1);
  overlay.resize();
}
