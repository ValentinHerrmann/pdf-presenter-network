import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { RouteResult } from "../types.js";
import { isLocalRequest, isSafeFilename, MIME, readJsonBody, send } from "../http-utils.js";
import { fetchLinkedPdf, isLinkName, parseHttpUrl, readLinkUrl, writeLinkFile } from "../linked-pdfs.js";

export interface LinkRouteDeps {
  dirPath: string;
}

/**
 * Linked PDFs (directory mode):
 *   - POST /api/links {name, url}     → create `<name>.url` (this machine only)
 *   - DELETE /api/links?name=X.url    → remove the link file (this machine
 *                                       only; its notes stay)
 *   - POST /api/links/fetch?name=X.url → fetch the latest version
 *                                       → { stale, error?, fetchedAt? }
 */
export async function handleLinkRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: LinkRouteDeps,
): Promise<RouteResult> {
  if (url.pathname !== "/api/links" && url.pathname !== "/api/links/fetch") return "pass";
  const isDelete = url.pathname === "/api/links" && req.method === "DELETE";
  if (req.method !== "POST" && !isDelete) {
    send(res, 405, "Method Not Allowed");
    return "handled";
  }

  // Existing link named by ?name=, for fetch and delete.
  const name = url.searchParams.get("name") ?? "";
  const existingPath = join(deps.dirPath, name);
  const existingUrl = isSafeFilename(name) && isLinkName(name) ? readLinkUrl(existingPath) : null;

  if (isDelete) {
    if (!isLocalRequest(req)) {
      send(res, 403, "Links can only be removed on the presenter computer");
    } else if (!existingUrl) {
      send(res, 404, "Link not found");
    } else {
      await rm(existingPath);
      send(res, 204, "");
    }
    return "handled";
  }

  if (url.pathname === "/api/links/fetch") {
    const linkUrl = existingUrl;
    if (!linkUrl) {
      send(res, 404, "Link not found");
      return "handled";
    }
    try {
      const { stale, error, fetchedAt } = await fetchLinkedPdf(linkUrl);
      send(res, 200, JSON.stringify({ stale, error, fetchedAt }), MIME[".json"]);
    } catch (err) {
      send(res, 502, err instanceof Error ? err.message : String(err));
    }
    return "handled";
  }

  // Writes into the PDF directory and makes the server fetch a URL.
  if (!isLocalRequest(req)) {
    send(res, 403, "Links can only be added on the presenter computer");
    return "handled";
  }
  const body = (await readJsonBody(req)) as { name?: unknown; url?: unknown };
  const newName = typeof body.name === "string" ? body.name.trim() : "";
  const linkUrl = typeof body.url === "string" ? parseHttpUrl(body.url) : null;
  const fileName = `${newName}.url`;
  if (!newName || !isSafeFilename(fileName) || newName.startsWith(".")) {
    send(res, 400, "Invalid name");
    return "handled";
  }
  if (!linkUrl) {
    send(res, 400, "Only http(s) URLs are supported");
    return "handled";
  }
  const linkPath = join(deps.dirPath, fileName);
  if (existsSync(linkPath)) {
    send(res, 409, `${fileName} already exists`);
    return "handled";
  }

  // Fetch first so a wrong URL never leaves a link file behind.
  try {
    await fetchLinkedPdf(linkUrl.href);
  } catch (err) {
    send(res, 400, `Could not load the PDF: ${err instanceof Error ? err.message : err}`);
    return "handled";
  }
  await writeLinkFile(linkPath, linkUrl.href);
  send(
    res,
    200,
    JSON.stringify({ pdfName: fileName, presenterUrl: `/pdf/${encodeURIComponent(fileName)}/presenter` }),
    MIME[".json"],
  );
  return "handled";
}
