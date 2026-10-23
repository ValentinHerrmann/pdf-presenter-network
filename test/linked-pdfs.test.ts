import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fetchLinkedPdf, readLinkUrl, writeLinkFile } from "../src/server/linked-pdfs.js";

const PDF = Buffer.from("%PDF-1.4\n% test\n");

let dir: string;
let server: Server;
let reply: { status: number; body: Buffer | string };

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "linked-pdfs-"));
  reply = { status: 200, body: PDF };
  server = createServer((_req, res) => {
    res.writeHead(reply.status);
    res.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  await rm(dir, { recursive: true, force: true });
});

function serverUrl(): string {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no address");
  return `http://127.0.0.1:${address.port}/deck/slides.pdf`;
}

describe("link files", () => {
  it("round-trips the URL and rejects non-http targets", async () => {
    const link = join(dir, "Deck.url");
    await writeLinkFile(link, "https://example.com/a.pdf");
    expect(readLinkUrl(link)).toBe("https://example.com/a.pdf");
    await expect(writeLinkFile(link, "https://example.com/b.pdf")).rejects.toThrow();

    const windows = join(dir, "Win.url");
    await writeFile(windows, "[InternetShortcut]\r\nIconIndex=0\r\nURL=https://example.com/c.pdf\r\n");
    expect(readLinkUrl(windows)).toBe("https://example.com/c.pdf");

    const local = join(dir, "Local.url");
    await writeFile(local, "[InternetShortcut]\nURL=file:///etc/passwd\n");
    expect(readLinkUrl(local)).toBeNull();
  });
});

describe("fetchLinkedPdf", () => {
  it("caches the latest version and falls back to it when the fetch fails", async () => {
    const cacheDir = join(dir, "cache");
    const fresh = await fetchLinkedPdf(serverUrl(), cacheDir);
    expect(fresh.stale).toBe(false);
    expect(await readFile(fresh.path)).toEqual(PDF);

    reply = { status: 500, body: "boom" };
    const fallback = await fetchLinkedPdf(serverUrl(), cacheDir);
    expect(fallback).toMatchObject({ path: fresh.path, stale: true, error: "HTTP 500" });
    expect(fallback.fetchedAt).toBeTruthy();

    reply = { status: 200, body: "<html>login</html>" };
    expect((await fetchLinkedPdf(serverUrl(), cacheDir)).stale).toBe(true);
    expect(await readFile(fresh.path)).toEqual(PDF);
  });

  it("throws without a cached copy", async () => {
    reply = { status: 404, body: "" };
    await expect(fetchLinkedPdf(serverUrl(), join(dir, "cache"))).rejects.toThrow("HTTP 404");
  });
});
