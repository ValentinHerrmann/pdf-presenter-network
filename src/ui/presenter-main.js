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
import { createCursorSync } from "./modules/cursor-sync.js";
import { createWebSocketTransport } from "./modules/websocket.js";
import { createOverlay } from "./modules/overlay.js";
import { readSlideDurations } from "./modules/slide-duration.js";

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
  const cursorSyncBtn = document.getElementById("cursor-sync-btn");
  const overlayCanvas = document.getElementById("overlay-layer");

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
  }

  // "Audience" button — open audience view in new tab
  document.getElementById("open-audience")?.addEventListener("click", () => {
    const base = window.location.href.replace(/\/presenter\/?$/, "/");
    window.open(base, "_blank");
  });

  const socket = createWebSocketTransport("presenter");
  const strokesBySlide = new Map();
  let selectedTool = "pen";
  let overlay;
  let transitionTimer = null;

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
    if (slideChanged) recorder.onSlideChanged(currentSlide);
    await Promise.all([
      renderPage(pdf, currentSlide, currentCanvas, currentContainer),
      currentSlide < total
        ? renderPage(pdf, currentSlide + 1, nextCanvas, nextContainer)
        : clearNext(),
    ]);
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
    onLaser: (point) => socket.send({ type: "cursor", ...point }),
  });

  for (const button of document.querySelectorAll("[data-tool]")) {
    button.addEventListener("click", () => {
      selectedTool = button.dataset.tool;
      for (const candidate of document.querySelectorAll("[data-tool]")) {
        const active = candidate === button;
        candidate.classList.toggle("active", active);
        candidate.setAttribute("aria-pressed", String(active));
      }
    });
  }

  socket.onMessage((msg) => {
    if (msg.type === "stroke" && msg.slide && msg.id) {
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
    } else if (ev.key === "l" || ev.key === "L") {
      ev.preventDefault();
      cursorSync.toggle();
      updateCursorSyncBtn();
    }
  });

  window.addEventListener("resize", () => {
    show(currentSlide);
    overlay.resize();
  });

  // ---- Timer ----
  const timerResetBtn = document.getElementById("timer-reset");
  const countdownMs =
    typeof config.timerMinutes === "number" && config.timerMinutes > 0
      ? config.timerMinutes * 60 * 1000
      : null;
  const timer = createTimer({ timerEl, resetBtnEl: timerResetBtn, countdownMs });

  // ---- Grid view ----
  const gridView = createGridView({
    pdf,
    total,
    getCurrentSlide: () => currentSlide,
    onSelect: (n) => show(n),
  });
  if (gridBtn) gridBtn.addEventListener("click", () => gridView.open());

  // ---- Cursor sync ----
  const cursorSync = createCursorSync({
    canvas: currentCanvas,
    send: (message) => socket.send(message),
  });
  function updateCursorSyncBtn() {
    if (!cursorSyncBtn) return;
    const on = cursorSync.isEnabled();
    cursorSyncBtn.textContent = `◉ Cursor sync: ${on ? "on" : "off"}`;
    cursorSyncBtn.setAttribute("aria-pressed", String(on));
    cursorSyncBtn.classList.toggle("active", on);
  }
  if (cursorSyncBtn) {
    cursorSyncBtn.addEventListener("click", () => {
      cursorSync.toggle();
      updateCursorSyncBtn();
    });
  }
  updateCursorSyncBtn();

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
    },
  });

  await show(1);
  overlay.resize();
}
