import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type {
  ServerConfig,
  DirectoryConfig,
  StartedServer,
} from "./server/types.js";
import { send, notFound } from "./server/http-utils.js";
import { resolveUiDir, resolvePdfjsDir } from "./server/paths.js";
import { renderHtml, singlePdfMeta } from "./server/html-render.js";
import { createNotesUpdater } from "./server/notes-store.js";
import { handleNotesRoutes } from "./server/routes/notes.js";
import { handleRecordingRoutes } from "./server/routes/recording.js";
import { handleStaticRoutes } from "./server/routes/static.js";
import { handleListingRoutes } from "./server/routes/listing.js";
import { handlePdfProxyRoutes } from "./server/routes/pdf-proxy.js";
import { handleUploadRoutes } from "./server/routes/upload.js";
import { handleUpdateRoutes, refreshLatest } from "./server/routes/update.js";
import { handleSharedAssetRoutes } from "./server/routes/static.js";
import { attachSyncServer } from "./server/sync.js";
import { getPdfNotesStatus, listPdfsInDirectory, type PdfNotesStatus } from "./utils.js";

export type { ServerConfig, DirectoryConfig, StartedServer } from "./server/types.js";

export async function startServer(config: ServerConfig): Promise<StartedServer> {
  const uiDir = resolveUiDir(import.meta.url);
  const pdfjsDir = resolvePdfjsDir(import.meta.url);

  const meta = singlePdfMeta(config);
  const audienceHtml = await renderHtml(uiDir, "audience.html", meta);
  const presenterHtml = await renderHtml(uiDir, "presenter.html", meta);

  const updateNotes = createNotesUpdater(config.notesPath);

  const handler = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
    try {
      if ((await sync.handleHttp(req, res, url)) === "handled") return;
      if ((await handleUpdateRoutes(req, res, url, { uiDir })) === "handled") return;

      // Ordering: recording (most specific prefixes) → notes → static catch-all.
      if (
        (await handleRecordingRoutes(req, res, url, {
          pdfPath: config.pdfPath,
        })) === "handled"
      )
        return;

      if (
        (await handleNotesRoutes(req, res, url, {
          notesPath: config.notesPath,
          updateNotes,
        })) === "handled"
      )
        return;

      if (
        (await handleStaticRoutes(req, res, url, {
          audienceHtml,
          presenterHtml,
          pdfPath: config.pdfPath,
          notesPath: config.notesPath,
          uiDir,
          pdfjsDir,
        })) === "handled"
      )
        return;

      notFound(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) send(res, 500, `Internal Server Error: ${msg}`);
      else res.end();
    }
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
      }
      res.end(`Internal Server Error: ${msg}`);
    });
  });
  const sync = attachSyncServer(server);

  await new Promise<void>((resolveP, rejectP) => {
    server.once("error", rejectP);
    server.listen(config.port, "0.0.0.0", () => {
      server.off("error", rejectP);
      resolveP();
    });
  });
  void refreshLatest();

  return {
    port: config.port,
    stop: () =>
      new Promise<void>((resolveP, rejectP) => {
        sync.stop()
          .then(() => server.close((err) => (err ? rejectP(err) : resolveP())))
          .catch(rejectP);
      }),
  };
}

export async function startDirectoryServer(
  config: DirectoryConfig,
): Promise<StartedServer> {
  const { basename } = await import("node:path");
  const uiDir = resolveUiDir(import.meta.url);
  const pdfjsDir = resolvePdfjsDir(import.meta.url);
  const uploadDir = await mkdtemp(join(tmpdir(), "pdf-presenter-"));
  const uploadedPdfPaths = new Map<string, string>();
  let currentPdfName: string | null = null;
  let currentAudienceHtml: string | null = null;
  let currentPresenterHtml: string | null = null;

  async function savePdf(name: string, data: Buffer): Promise<string> {
    const baseName = basename(name).replace(/\.pdf$/i, "");
    let pdfName = `${baseName}.pdf`;
    let suffix = 2;
    while (
      listPdfsInDirectory(config.dirPath).includes(pdfName) ||
      uploadedPdfPaths.has(pdfName)
    ) {
      pdfName = `${baseName} (${suffix++}).pdf`;
    }
    const storedPath = join(uploadDir, pdfName);
    await writeFile(storedPath, data, { flag: "wx" });
    uploadedPdfPaths.set(pdfName, storedPath);
    return pdfName;
  }

  function getStatuses(): PdfNotesStatus[] {
    const originalStatuses = listPdfsInDirectory(config.dirPath).map((name) =>
      getPdfNotesStatus(config.dirPath, name),
    );
    const uploadedStatuses = [...uploadedPdfPaths.entries()].map(([name, path]) =>
      ({ ...getPdfNotesStatus(uploadDir, basename(path)), pdfName: name }),
    );
    return [...originalStatuses, ...uploadedStatuses].sort((a, b) =>
      a.pdfName.localeCompare(b.pdfName),
    );
  }

  const listingHtml = await renderHtml(uiDir, "listing.html", {
    dirName: basename(config.dirPath),
  });
  const waitingHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Waiting for presentation</title>
    <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg" />
    <link rel="manifest" href="/assets/audience.webmanifest" />
    <style>
      :root { color-scheme: dark; }
      html, body { height: 100%; margin: 0; }
      body { display: grid; place-items: center; background: #0d1117; color: #e6edf3; font: 16px system-ui, sans-serif; }
      main { text-align: center; }
      p { color: #8b949e; }
      a { color: #58a6ff; }
    </style>
  </head>
  <body>
    <main><h1>Waiting for presentation</h1><p>The audience view will appear when a presenter opens a PDF.</p><a href="/list">Open the PDF browser</a></main>
    <script>
      setInterval(async () => {
        const response = await fetch('/api/current', { cache: 'no-store' });
        const current = await response.json();
        if (current.audienceUrl) window.location.replace(current.audienceUrl);
      }, 1000);
    </script>
  </body>
</html>`;

  const handler = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const url = new URL(req.url ?? "/", `http://localhost:${config.port}`);
    try {
      if ((await sync.handleHttp(req, res, url)) === "handled") return;
      if ((await handleUpdateRoutes(req, res, url, { uiDir })) === "handled") return;

      if (
        (await handleUploadRoutes(req, res, url, { savePdf })) === "handled"
      )
        return;

      if (
        (await handleListingRoutes(req, res, url, {
          dirPath: config.dirPath,
          listingHtml,
          waitingHtml,
          getCurrentPdf: () => currentPdfName,
          getCurrentAudienceHtml: () => currentAudienceHtml,
          getCurrentPresenterHtml: () => currentPresenterHtml,
          getStatuses,
        })) === "handled"
      )
        return;

      if (
        (await handlePdfProxyRoutes(req, res, url, {
          dirPath: config.dirPath,
          uiDir,
          pdfjsDir,
          timerMinutes: config.timerMinutes,
          resolvePdfPath: (name) => uploadedPdfPaths.get(name),
          onPresenter: (name, audienceHtml, presenterHtml) => {
            if (name !== currentPdfName) sync.reset();
            currentPdfName = name;
            currentAudienceHtml = audienceHtml;
            currentPresenterHtml = presenterHtml;
          },
        })) === "handled"
      )
        return;

      if (
        (await handleSharedAssetRoutes(req, res, url, {
          uiDir,
          pdfjsDir,
        })) === "handled"
      )
        return;

      notFound(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) send(res, 500, `Internal Server Error: ${msg}`);
      else res.end();
    }
  };

  const server = createServer((req, res) => {
    handler(req, res).catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain" });
      }
      res.end(`Internal Server Error: ${msg}`);
    });
  });
  const sync = attachSyncServer(server);

  await new Promise<void>((resolveP, rejectP) => {
    server.once("error", rejectP);
    server.listen(config.port, "0.0.0.0", () => {
      server.off("error", rejectP);
      resolveP();
    });
  });
  void refreshLatest();

  return {
    port: config.port,
    stop: () =>
      new Promise<void>((resolveP, rejectP) => {
        sync.stop()
          .then(() => rm(uploadDir, { recursive: true, force: true }))
          .then(() => server.close((err) => (err ? rejectP(err) : resolveP())))
          .catch(rejectP);
      }),
  };
}
