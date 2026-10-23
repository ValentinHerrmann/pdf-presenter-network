import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteResult } from "../types.js";
import { isLocalRequest, send } from "../http-utils.js";
import type { SyncServer } from "../sync.js";

export interface QuitRouteDeps {
  sync: SyncServer;
}

/**
 * POST /api/quit (this machine only): tell audiences to close, then exit
 * cleanly. The systemd service uses Restart=on-failure, so it stays stopped
 * until the app launcher starts it again.
 */
export async function handleQuitRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: QuitRouteDeps,
): Promise<RouteResult> {
  if (url.pathname !== "/api/quit") return "pass";
  if (!isLocalRequest(req)) {
    send(res, 403, "Forbidden");
    return "handled";
  }
  if (req.method !== "POST") {
    send(res, 405, "Method Not Allowed");
    return "handled";
  }
  deps.sync.announceShutdown(true);
  send(res, 202, "");
  console.log("Quit requested; stopping the server.");
  setTimeout(() => process.kill(process.pid, "SIGTERM"), 500);
  return "handled";
}
