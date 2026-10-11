import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteResult } from "../types.js";
import { isSafeFilename, MIME, readBinaryBody, send } from "../http-utils.js";

export interface UploadRouteDeps {
  savePdf: (name: string, data: Buffer) => Promise<string>;
}

export async function handleUploadRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: UploadRouteDeps,
): Promise<RouteResult> {
  if (url.pathname !== "/api/open") return "pass";
  if (req.method !== "POST") {
    send(res, 405, "Method Not Allowed");
    return "handled";
  }

  const contentType = req.headers["content-type"] ?? "";
  if (!contentType.toLowerCase().startsWith("application/pdf")) {
    send(res, 415, "Only PDF files can be opened");
    return "handled";
  }

  const requestedName = req.headers["x-pdf-name"];
  const name = typeof requestedName === "string" ? requestedName : "opened.pdf";
  if (!isSafeFilename(name) || !name.toLowerCase().endsWith(".pdf")) {
    send(res, 400, "Invalid PDF filename");
    return "handled";
  }

  try {
    const data = await readBinaryBody(req);
    const pdfName = await deps.savePdf(name, data);
    send(
      res,
      200,
      JSON.stringify({
        pdfName,
        presenterUrl: `/pdf/${encodeURIComponent(pdfName)}/presenter`,
      }),
      MIME[".json"],
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not open PDF";
    send(res, 400, message);
  }
  return "handled";
}
