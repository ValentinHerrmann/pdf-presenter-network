import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteResult } from "../types.js";
import { MIME, send } from "../http-utils.js";
import { listPdfsInDirectory, getPdfNotesStatus, type PdfNotesStatus } from "../../utils.js";

export interface ListingRouteDeps {
  dirPath: string;
  listingHtml: string;
  waitingHtml: string;
  getCurrentPdf: () => string | null;
  getCurrentAudienceHtml: () => string | null;
  getStatuses?: () => PdfNotesStatus[];
}

/**
 * Handles directory listing routes:
 *   - GET /  or  GET /list  → listing HTML page
 *   - GET /api/listing      → JSON array of PdfNotesStatus
 */
export async function handleListingRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: ListingRouteDeps,
): Promise<RouteResult> {
  const pathname = url.pathname;
  const method = req.method ?? "GET";
  if (method !== "GET" && method !== "HEAD") return "pass";

  if (pathname === "/") {
    const currentPdf = deps.getCurrentPdf();
    if (currentPdf) {
      const audienceHtml = deps.getCurrentAudienceHtml();
      if (audienceHtml) send(res, 200, audienceHtml, MIME[".html"]);
      else send(res, 503, "Audience is initializing");
    } else {
      send(res, 200, deps.waitingHtml, MIME[".html"]);
    }
    return "handled";
  }

  if (pathname === "/list") {
    send(res, 200, deps.listingHtml, MIME[".html"]);
    return "handled";
  }

  if (pathname === "/api/current") {
    const currentPdf = deps.getCurrentPdf();
    send(
      res,
      200,
      JSON.stringify({
        pdfName: currentPdf,
        audienceUrl: currentPdf ? "/" : null,
      }),
      MIME[".json"],
    );
    return "handled";
  }

  if (pathname === "/api/listing") {
    const statuses = deps.getStatuses?.() ?? listPdfsInDirectory(deps.dirPath).map((name) =>
      getPdfNotesStatus(deps.dirPath, name),
    );
    send(res, 200, JSON.stringify(statuses), MIME[".json"]);
    return "handled";
  }

  return "pass";
}
