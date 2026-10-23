import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";

/**
 * Linked PDFs: `<name>.url` shortcut files (InternetShortcut format) in the
 * PDF directory point at a PDF on the web. Each open fetches the latest
 * version; the last good copy is cached and used when the fetch fails.
 */

const FETCH_TIMEOUT_MS = 20_000;

export function defaultCacheDir(): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(base, "pdf-presenter-network", "linked");
}

export function isLinkName(name: string): boolean {
  return extname(name).toLowerCase() === ".url";
}

export function listLinksInDirectory(dirPath: string): string[] {
  return readdirSync(dirPath)
    .filter(isLinkName)
    .sort((a, b) => a.localeCompare(b));
}

/** Parses an http(s) URL, or returns null. */
export function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/** The http(s) URL of a `.url` file, or null if missing or invalid. */
export function readLinkUrl(linkPath: string): string | null {
  try {
    const line = readFileSync(linkPath, "utf8")
      .split(/\r?\n/)
      .find((l) => /^URL=/i.test(l));
    return line ? (parseHttpUrl(line.slice(4))?.href ?? null) : null;
  } catch {
    return null;
  }
}

/** Creates `<name>.url`; fails if it already exists. */
export async function writeLinkFile(linkPath: string, url: string): Promise<void> {
  await writeFile(linkPath, `[InternetShortcut]\nURL=${url}\n`, { flag: "wx" });
}

function cachePathFor(url: string, cacheDir: string): string {
  return join(cacheDir, `${createHash("sha1").update(url).digest("hex")}.pdf`);
}

/** The cached copy of a linked PDF, if one was fetched before. */
export function cachedLinkedPdf(url: string, cacheDir = defaultCacheDir()): string | null {
  const path = cachePathFor(url, cacheDir);
  return existsSync(path) ? path : null;
}

export interface LinkedPdfResult {
  path: string;
  /** True when the fetch failed and an older cached copy is used. */
  stale: boolean;
  error?: string;
  fetchedAt?: string;
}

/**
 * Fetches the latest version into the cache. If that fails, falls back to
 * the cached copy (stale); without one it throws.
 */
export async function fetchLinkedPdf(
  url: string,
  cacheDir = defaultCacheDir(),
): Promise<LinkedPdfResult> {
  const path = cachePathFor(url, cacheDir);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (!data.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
      throw new Error("The URL does not return a PDF");
    }
    await mkdir(cacheDir, { recursive: true });
    const tmpPath = `${path}.${process.pid}.tmp`;
    await writeFile(tmpPath, data);
    await rename(tmpPath, path);
    return { path, stale: false };
  } catch (err) {
    // Node's fetch hides the reason (DNS, refused, …) in `cause`.
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    const message = err instanceof Error ? err.message : String(err);
    const error = cause ? `${message} (${cause})` : message;
    if (!existsSync(path)) throw new Error(error);
    return { path, stale: true, error, fetchedAt: statSync(path).mtime.toISOString() };
  }
}
