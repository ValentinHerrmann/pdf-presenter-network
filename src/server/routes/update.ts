import type { IncomingMessage, ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import type { RouteResult } from "../types.js";
import { MIME, send } from "../http-utils.js";
import pkg from "../../../package.json" with { type: "json" };

const REPO = "ValentinHerrmann/pdf-presenter-network";
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface UpdateRouteDeps {
  uiDir: string;
}

type UpdateState = "idle" | "running" | "failed";

let latest: string | null = null;
let checkedAt = 0;
let checking: Promise<void> | null = null;
let state: UpdateState = "idle";

/** True for requests from this machine (loopback or one of its own addresses). */
function isLocalRequest(req: IncomingMessage): boolean {
  const address = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  if (address === "::1" || address.startsWith("127.")) return true;
  return Object.values(networkInterfaces()).some((list) =>
    list?.some((item) => item.address === address),
  );
}

function newer(candidate: string, current: string): boolean {
  const a = candidate.split(".").map(Number);
  const b = current.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
}

/** Latest release version from the `releases/latest` redirect, cached for an hour. */
async function refreshLatest(): Promise<void> {
  if (Date.now() - checkedAt < CHECK_INTERVAL_MS) return;
  checking ??= (async () => {
    try {
      const response = await fetch(`https://github.com/${REPO}/releases/latest`, {
        method: "HEAD",
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      const tag = response.headers.get("location")?.split("/").pop() ?? "";
      if (/^v\d+\.\d+\.\d+$/.test(tag)) latest = tag.slice(1);
      checkedAt = Date.now();
    } catch {
      // Offline: try again on the next request.
    } finally {
      checking = null;
    }
  })();
  await checking;
}

/**
 * Update check and in-place update, only for requests from this machine:
 *   - GET  /api/update → { current, latest, available, canUpdate, state }
 *   - POST /api/update → install the latest release, then exit so systemd
 *                        restarts the service on the new version.
 */
export async function handleUpdateRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  deps: UpdateRouteDeps,
): Promise<RouteResult> {
  if (url.pathname !== "/api/update") return "pass";
  if (!isLocalRequest(req)) {
    send(res, 403, "Forbidden");
    return "handled";
  }

  const projectRoot = resolve(deps.uiDir, "../..");
  const updateScript = join(projectRoot, "scripts", "update.sh");
  // Release install running as the systemd service, which restarts us on exit.
  const canUpdate =
    !existsSync(join(projectRoot, ".git")) &&
    existsSync(updateScript) &&
    Boolean(process.env.INVOCATION_ID);

  if (req.method === "GET") {
    await refreshLatest();
    send(
      res,
      200,
      JSON.stringify({
        current: pkg.version,
        latest,
        available: latest !== null && newer(latest, pkg.version),
        canUpdate,
        state,
      }),
      MIME[".json"],
    );
    return "handled";
  }

  if (req.method !== "POST") {
    send(res, 405, "Method Not Allowed");
    return "handled";
  }
  if (!canUpdate) {
    send(res, 409, "This installation cannot update itself");
    return "handled";
  }
  if (state === "running") {
    send(res, 409, "Update already running");
    return "handled";
  }

  state = "running";
  const child = spawn("sh", [updateScript], {
    stdio: "inherit",
    env: {
      ...process.env,
      PDF_PRESENTER_APP_ONLY: "1",
      // The service may have a minimal PATH; the installer needs this node.
      PATH: [dirname(process.execPath), process.env.PATH ?? ""].join(delimiter),
    },
  });
  child.on("error", () => {
    state = "failed";
  });
  child.on("exit", (code) => {
    if (code !== 0) {
      state = "failed";
      return;
    }
    console.log("Update installed; exiting so systemd restarts the service.");
    process.exit(75);
  });
  send(res, 202, "");
  return "handled";
}
