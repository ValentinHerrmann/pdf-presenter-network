// Shared PDF.js rendering helpers used by both audience and presenter views.

import * as pdfjsLib from "/assets/pdfjs/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/pdfjs/build/pdf.worker.mjs";

const DEFAULT_CONFIG = {
  pdfUrl: "/slides.pdf",
  notesUrl: "/notes.json",
  timerMinutes: null,
};

export function readConfig() {
  const el = document.getElementById("pdf-presenter-config");
  if (!el) return { ...DEFAULT_CONFIG };
  try {
    return JSON.parse(el.textContent || "{}");
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function loadDocument(url) {
  const task = pdfjsLib.getDocument({ url, isEvalSupported: false });
  return task.promise;
}

export async function loadNotes(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return { notes: {} };
    return await res.json();
  } catch {
    return { notes: {} };
  }
}

export async function renderPage(pdf, pageNumber, canvas, container = canvas?.parentElement) {
  if (!canvas) return;
  const page = await pdf.getPage(pageNumber);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const maxW = Math.max(1, container?.clientWidth ?? window.innerWidth);
  const maxH = Math.max(1, container?.clientHeight ?? window.innerHeight);

  const unscaled = page.getViewport({ scale: 1 });
  const scale = Math.min(maxW / unscaled.width, maxH / unscaled.height);
  const viewport = page.getViewport({ scale });

  const buffer = document.createElement("canvas");
  buffer.width = Math.floor(viewport.width * dpr);
  buffer.height = Math.floor(viewport.height * dpr);

  const bufferContext = buffer.getContext("2d");
  bufferContext.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: bufferContext, viewport }).promise;

  canvas.width = buffer.width;
  canvas.height = buffer.height;
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  const context = canvas.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.drawImage(buffer, 0, 0);
}

export function clampSlide(n, total) {
  if (total <= 0) return 1;
  return Math.max(1, Math.min(total, n));
}
