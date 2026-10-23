import { createServer } from "node:http";
import { deflateSync } from "node:zlib";
import { WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { attachSyncServer } from "../src/server/sync.js";
import { readSlideDurations } from "../src/ui/modules/slide-duration.js";

const resources: Array<() => Promise<void>> = [];

function nextMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      socket.off("error", onError);
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    };
    const onError = (error: Error) => {
      socket.off("message", onMessage);
      reject(error);
    };
    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}

async function openSocket(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
  return socket;
}

afterEach(async () => {
  while (resources.length > 0) await resources.pop()?.();
});

describe("WebSocket sync relay", () => {
  it("sends snapshots and relays presenter state to audiences", async () => {
    const httpServer = createServer();
    const sync = attachSyncServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind");
    resources.push(async () => {
      await sync.stop();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    const presenter = await openSocket(address.port);
    presenter.send(JSON.stringify({ type: "hello", role: "presenter" }));
    expect(await nextMessage(presenter)).toMatchObject({ type: "snapshot", slide: 1 });

    const audience = await openSocket(address.port);
    audience.send(JSON.stringify({ type: "hello", role: "audience" }));
    expect(await nextMessage(audience)).toMatchObject({ type: "snapshot", slide: 1 });

    presenter.send(JSON.stringify({ type: "slide", slide: 3 }));
    await expect(nextMessage(audience)).resolves.toMatchObject({ type: "slide", slide: 3 });

    presenter.send(
      JSON.stringify({
        type: "stroke",
        id: "stroke-1",
        slide: 3,
        points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }],
        color: "#ff4f4f",
        width: 4,
      }),
    );
    await expect(nextMessage(audience)).resolves.toMatchObject({
      type: "stroke",
      id: "stroke-1",
      slide: 3,
    });

    audience.send(JSON.stringify({ type: "slide", slide: 1 }));

    presenter.close();
    audience.close();
  });
  it("restores strokes to a reconnecting presenter and clears them on reset", async () => {
    const httpServer = createServer();
    const sync = attachSyncServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind");
    resources.push(async () => {
      await sync.stop();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    const first = await openSocket(address.port);
    first.send(JSON.stringify({ type: "hello", role: "presenter" }));
    await nextMessage(first);
    const stroke = {
      type: "stroke",
      id: "stroke-1",
      slide: 2,
      points: [{ x: 0.1, y: 0.2 }],
      color: "#2563eb",
      width: 4,
    };
    first.send(JSON.stringify(stroke));
    await nextMessage(first);
    first.close();

    const second = await openSocket(address.port);
    second.send(JSON.stringify({ type: "hello", role: "presenter" }));
    await expect(nextMessage(second)).resolves.toMatchObject({
      type: "snapshot",
      strokes: { "2": [expect.objectContaining({ id: "stroke-1" })] },
    });

    sync.reset();
    await expect(nextMessage(second)).resolves.toMatchObject({
      type: "snapshot",
      slide: 1,
      strokes: {},
    });
    second.close();
  });
});

describe("Shutdown announcement", () => {
  it("asks audiences to close on quit and only to wait on stop", async () => {
    const httpServer = createServer();
    const sync = attachSyncServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind");
    resources.push(async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    const audience = await openSocket(address.port);
    audience.send(JSON.stringify({ type: "hello", role: "audience" }));
    await nextMessage(audience);

    sync.announceShutdown(true);
    await expect(nextMessage(audience)).resolves.toEqual({ type: "shutdown", close: true });

    const other = await openSocket(address.port);
    other.send(JSON.stringify({ type: "hello", role: "audience" }));
    await nextMessage(other);
    const quitAgain = nextMessage(other);
    await sync.stop();
    // stop() after a quit announcement does not announce again.
    await expect(
      Promise.race([quitAgain.then(() => "message"), new Promise((r) => setTimeout(() => r("none"), 200))]),
    ).resolves.toBe("none");
  });

  it("ends a presentation without stopping: clears state and asks audiences to close", async () => {
    const httpServer = createServer();
    const sync = attachSyncServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind");
    resources.push(async () => {
      await sync.stop();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    const presenter = await openSocket(address.port);
    presenter.send(JSON.stringify({ type: "hello", role: "presenter" }));
    await nextMessage(presenter);
    presenter.send(JSON.stringify({ type: "slide", slide: 4 }));
    await nextMessage(presenter);

    sync.endPresentation();
    await expect(nextMessage(presenter)).resolves.toEqual({ type: "shutdown", close: true });

    const audience = await openSocket(address.port);
    audience.send(JSON.stringify({ type: "hello", role: "audience" }));
    await expect(nextMessage(audience)).resolves.toMatchObject({ type: "snapshot", slide: 1, strokes: {} });
    presenter.close();
    audience.close();
  });

  it("tells clients to wait when the server stops", async () => {
    const httpServer = createServer();
    const sync = attachSyncServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind");
    resources.push(async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });

    const audience = await openSocket(address.port);
    audience.send(JSON.stringify({ type: "hello", role: "audience" }));
    await nextMessage(audience);
    const shutdown = nextMessage(audience);
    await sync.stop();
    await expect(shutdown).resolves.toEqual({ type: "shutdown", close: false });
  });
});

describe("HTTP long-poll sync fallback", () => {
  it("serves snapshots, waits for presenter posts, and mirrors them to WebSocket audiences", async () => {
    const sync = { current: null as ReturnType<typeof attachSyncServer> | null };
    const httpServer = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      void sync.current!.handleHttp(req, res, url).then((result) => {
        if (result === "skip") res.writeHead(404).end();
      });
    });
    sync.current = attachSyncServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind");
    resources.push(async () => {
      await sync.current!.stop();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    });
    const base = `http://127.0.0.1:${address.port}/api/sync`;

    const first = (await (await fetch(base)).json()) as {
      seq: number;
      events: Array<Record<string, unknown>>;
    };
    expect(first.events).toEqual([expect.objectContaining({ type: "snapshot", slide: 1 })]);

    const audience = await openSocket(address.port);
    const wsMessage = new Promise<Record<string, unknown>>((resolve) => {
      audience.on("message", (data) => {
        const message = JSON.parse(data.toString()) as Record<string, unknown>;
        if (message.type === "slide") resolve(message);
      });
    });

    const longPoll = fetch(`${base}?since=${first.seq}`).then((r) => r.json());
    const post = await fetch(base, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "slide", slide: 3 }),
    });
    expect(post.status).toBe(204);

    await expect(longPoll).resolves.toMatchObject({
      seq: first.seq + 1,
      events: [{ type: "slide", slide: 3 }],
    });
    await expect(wsMessage).resolves.toMatchObject({ type: "slide", slide: 3 });

    const stale = (await (await fetch(`${base}?since=999`)).json()) as {
      events: Array<Record<string, unknown>>;
    };
    expect(stale.events).toEqual([expect.objectContaining({ type: "snapshot", slide: 3 })]);

    audience.close();
  });
});

function fakePdf(source: string | Uint8Array, pageObjects: number[]) {
  const data = typeof source === "string" ? new TextEncoder().encode(source) : source;
  return {
    getData: async () => data,
    numPages: pageObjects.length,
    getPage: async (n: number) => ({ ref: { num: pageObjects[n - 1], gen: 0 } }),
  };
}

describe("Beamer transition durations", () => {
  it("reads positive /Dur values in page order and treats other pages as manual", async () => {
    const pdf = fakePdf(
      "1 0 obj << /Type /Page /Dur 5 >> endobj " +
        "2 0 obj << /Type /Page >> endobj " +
        "3 0 obj << /Type /Page /Dur 0 >> endobj " +
        "4 0 obj << /Type /Pages >> endobj",
      [1, 2, 3],
    );
    await expect(readSlideDurations(pdf)).resolves.toEqual([5, null, null]);
  });

  it("maps durations by page reference, not object order", async () => {
    const pdf = fakePdf(
      "7 0 obj << /Type /Page /Dur 2 >> endobj " + "8 0 obj << /Type /Page >> endobj",
      [8, 7],
    );
    await expect(readSlideDurations(pdf)).resolves.toEqual([null, 2]);
  });

  it("reads page dicts packed in compressed object streams", async () => {
    const objects = ["<< /Type /Page /Dur 3 >>", "<< /Type /Page >>", "<< /Type /Pages >>"];
    let offset = 0;
    const pairs = objects.map((object, i) => {
      const pair = `${10 + i} ${offset}`;
      offset += object.length + 1;
      return pair;
    });
    const header = pairs.join(" ") + " ";
    const compressed = deflateSync(Buffer.from(header + objects.join(" "), "latin1"));
    const pdf = Buffer.concat([
      Buffer.from(
        `5 0 obj << /Type /ObjStm /N 3 /First ${header.length} /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
        "latin1",
      ),
      compressed,
      Buffer.from("\nendstream\nendobj ", "latin1"),
    ]);
    await expect(readSlideDurations(fakePdf(pdf, [11, 10]))).resolves.toEqual([null, 3]);
  });
});
