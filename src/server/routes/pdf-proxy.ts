import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { RouteResult } from "../types.js";
import { notFound, isSafeFilename, send } from "../http-utils.js";
import { renderHtml } from "../html-render.js";
import { createNotesUpdater } from "../notes-store.js";
import { notesPathFor } from "../../utils.js";
import { cachedLinkedPdf, fetchLinkedPdf, isLinkName, readLinkUrl } from "../linked-pdfs.js";
import { handleNotesRoutes } from "./notes.js";
import { handleRecordingRoutes } from "./recording.js";
import { handleStaticRoutes } from "./static.js";

export interface PdfProxyDeps {
  dirPath: string;
  uiDir: string;
  pdfjsDir: string;
  timerMinutes?: number;
  resolvePdfPath?: (pdfName: string) => string | undefined;
  onPresenter?: (
    pdfName: string,
    audienceHtml: string,
    presenterHtml: string,
  ) => void;
}

interface PerPdfCache {
  audienceHtml: string;
  presenterHtml: string;
  updateNotes: ReturnType<typeof createNotesUpdater>;
}

const cache = new Map<string, PerPdfCache>();

async function getOrCreateCache(
  pdfName: string,
  pdfPath: string,
  deps: PdfProxyDeps,
): Promise<PerPdfCache> {
  let entry = cache.get(pdfName);
  if (entry) return entry;

  const notesPath = notesPathFor(pdfPath);
  const prefix = `/pdf/${encodeURIComponent(pdfName)}`;

  const meta = {
    pdfUrl: `${prefix}/slides.pdf`,
    notesUrl: `${prefix}/notes.json`,
    pdfName: basename(pdfPath).replace(/\.url$/i, ".pdf"),
    timerMinutes: deps.timerMinutes ?? null,
    listUrl: "/list",
  };

  const [audienceHtml, presenterHtml] = await Promise.all([
    renderHtml(deps.uiDir, "audience.html", meta),
    renderHtml(deps.uiDir, "presenter.html", meta),
  ]);

  entry = {
    audienceHtml,
    presenterHtml,
    updateNotes: createNotesUpdater(notesPath),
  };
  cache.set(pdfName, entry);
  return entry;
}

/**
 * Handles per-PDF routes under `/pdf/<encoded-name>/...`.
 * Strips the prefix and delegates to existing route handlers.
 */
export async function handlePdfProxyRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: PdfProxyDeps,
): Promise<RouteResult> {
  const match = url.pathname.match(/^\/pdf\/([^/]+)(\/.*)?$/);
  if (!match) return "pass";

  const pdfName = decodeURIComponent(match[1]);
  const subPath = match[2] || "/";

  // Safety: validate filename and that it exists in dirPath
  if (!isSafeFilename(pdfName)) {
    notFound(res);
    return "handled";
  }
  const resolvedPdfPath = deps.resolvePdfPath?.(pdfName);
  const pdfPath = resolvedPdfPath ?? join(deps.dirPath, pdfName);
  const safePath = resolve(pdfPath);
  if ((!resolvedPdfPath && !safePath.startsWith(deps.dirPath + "/")) || !existsSync(pdfPath)) {
    notFound(res);
    return "handled";
  }

  // A linked PDF (`.url` file) keeps notes and recordings next to the link;
  // the PDF bytes come from the cache. Only opening the presenter fetches,
  // so audience reloads never hit the web.
  let slidesPath = pdfPath;
  if (!resolvedPdfPath && isLinkName(pdfName)) {
    const linkUrl = readLinkUrl(pdfPath);
    if (!linkUrl) {
      notFound(res);
      return "handled";
    }
    let cached = cachedLinkedPdf(linkUrl);
    if (!cached && subPath === "/presenter") {
      try {
        cached = (await fetchLinkedPdf(linkUrl)).path;
      } catch (err) {
        send(res, 502, `Could not load ${linkUrl}: ${err instanceof Error ? err.message : err}`);
        return "handled";
      }
    }
    if (!cached && subPath === "/slides.pdf") {
      notFound(res);
      return "handled";
    }
    slidesPath = cached ?? pdfPath;
  }

  const notesPath = notesPathFor(pdfPath);
  const perPdf = await getOrCreateCache(pdfName, pdfPath, deps);
  if (subPath === "/presenter") {
    deps.onPresenter?.(pdfName, perPdf.audienceHtml, perPdf.presenterHtml);
    send(res, 303, "", "text/plain; charset=utf-8", { Location: "/presenter" });
    return "handled";
  }

  // Build a sub-URL with the prefix stripped
  const subUrl = new URL(subPath + url.search, `http://localhost`);

  // Delegate to existing route handlers in the same order as single-PDF mode
  if (
    (await handleRecordingRoutes(req, res, subUrl, { pdfPath })) === "handled"
  )
    return "handled";

  if (
    (await handleNotesRoutes(req, res, subUrl, {
      notesPath,
      updateNotes: perPdf.updateNotes,
    })) === "handled"
  )
    return "handled";

  if (
    (await handleStaticRoutes(req, res, subUrl, {
      audienceHtml: perPdf.audienceHtml,
      presenterHtml: perPdf.presenterHtml,
      pdfPath: slidesPath,
      notesPath,
      uiDir: deps.uiDir,
      pdfjsDir: deps.pdfjsDir,
    })) === "handled"
  )
    return "handled";

  notFound(res);
  return "handled";
}
