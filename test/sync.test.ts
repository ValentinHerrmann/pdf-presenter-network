import { createServer } from "node:http";
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
    const stopSync = attachSyncServer(httpServer);
    await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind");
    resources.push(async () => {
      await stopSync();
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
});

describe("Beamer transition durations", () => {
  it("reads positive /Dur values in page order and treats other pages as manual", async () => {
    const pdf = new TextEncoder().encode(
      "1 0 obj << /Type /Page /Dur 5 >> endobj " +
        "2 0 obj << /Type /Page >> endobj " +
        "3 0 obj << /Type /Page /Dur 0 >> endobj " +
        "4 0 obj << /Type /Pages >> endobj",
    );
    await expect(readSlideDurations({ getData: async () => pdf })).resolves.toEqual([5, null, null]);
  });
});