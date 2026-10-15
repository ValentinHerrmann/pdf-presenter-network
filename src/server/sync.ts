import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { MIME, readJsonBody, send } from "./http-utils.js";
import { WebSocket, WebSocketServer } from "ws";

type Role = "presenter" | "audience";

interface Point {
  x: number;
  y: number;
}

interface Stroke {
  id: string;
  slide: number;
  points: Point[];
  color: string;
  width: number;
}

interface SyncState {
  slide: number;
  frozen: boolean;
  black: boolean;
  viewport: ViewportState;
  strokes: Record<string, Stroke[]>;
}

interface ViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface ClientMessage {
  type?: unknown;
  role?: unknown;
  slide?: unknown;
  value?: unknown;
  x?: unknown;
  y?: unknown;
  hidden?: unknown;
  id?: unknown;
  points?: unknown;
  color?: unknown;
  width?: unknown;
  scale?: unknown;
  offsetX?: unknown;
  offsetY?: unknown;
}

const LASER_COLORS = new Set(["#2563eb", "#dc2626", "#16a34a"]);

const MAX_STROKE_POINTS = 10_000;
const MAX_STROKES_PER_SLIDE = 2_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNormalized(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function parseMessage(data: WebSocket.RawData): ClientMessage | null {
  try {
    const parsed: unknown = JSON.parse(data.toString());
    return parsed && typeof parsed === "object" ? (parsed as ClientMessage) : null;
  } catch {
    return null;
  }
}

function validSlide(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}

function validPoint(value: unknown): value is Point {
  if (!value || typeof value !== "object") return false;
  const point = value as Partial<Point>;
  return isNormalized(point.x) && isNormalized(point.y);
}

function validViewport(message: ClientMessage): message is ClientMessage & ViewportState {
  return (
    isFiniteNumber(message.scale) && message.scale >= 1 && message.scale <= 4 &&
    isFiniteNumber(message.offsetX) && isFiniteNumber(message.offsetY)
  );
}

function validStroke(message: ClientMessage): message is ClientMessage & {
  id: string;
  slide: number;
  points: Point[];
  color: string;
  width: number;
} {
  return (
    typeof message.id === "string" &&
    message.id.length > 0 &&
    message.id.length <= 100 &&
    validSlide(message.slide) &&
    Array.isArray(message.points) &&
    message.points.length > 0 &&
    message.points.length <= MAX_STROKE_POINTS &&
    message.points.every(validPoint) &&
    typeof message.color === "string" &&
    message.color.length <= 40 &&
    isFiniteNumber(message.width) &&
    message.width > 0 &&
    message.width <= 100
  );
}

function broadcast(clients: Set<WebSocket>, message: object): void {
  const encoded = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(encoded);
  }
}

function snapshot(state: SyncState): object {
  return {
    type: "snapshot",
    slide: state.slide,
    frozen: state.frozen,
    black: state.black,
    viewport: state.viewport,
    strokes: state.strokes,
  };
}

const MAX_LOGGED_EVENTS = 1_000;
const LONG_POLL_TIMEOUT_MS = 20_000;

interface LoggedEvent {
  seq: number;
  message: object;
}

export interface SyncServer {
  /** HTTP long-poll fallback for networks that block WebSocket upgrades. */
  handleHttp(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<"handled" | "skip">;
  stop(): Promise<void>;
}

export function attachSyncServer(server: Server): SyncServer {
  const webSocketServer = new WebSocketServer({ server });
  const clients = new Set<WebSocket>();
  const roles = new Map<WebSocket, Role>();
  const state: SyncState = {
    slide: 1,
    frozen: false,
    black: false,
    viewport: { scale: 1, offsetX: 0, offsetY: 0 },
    strokes: {},
  };
  const events: LoggedEvent[] = [];
  let seq = 0;
  const waiters = new Set<() => void>();

  function publish(message: object): void {
    broadcast(clients, message);
    events.push({ seq: ++seq, message });
    if (events.length > MAX_LOGGED_EVENTS) events.shift();
    for (const wake of [...waiters]) wake();
  }

  function applyPresenterMessage(message: ClientMessage): void {
    switch (message.type) {
      case "slide":
        if (!validSlide(message.slide)) return;
        state.slide = message.slide;
        publish({ type: "slide", slide: state.slide });
        break;
      case "viewport":
        if (!validViewport(message)) return;
        state.viewport = {
          scale: message.scale,
          offsetX: message.offsetX,
          offsetY: message.offsetY,
        };
        publish({ type: "viewport", ...state.viewport });
        break;
      case "freeze":
        if (typeof message.value !== "boolean") return;
        state.frozen = message.value;
        publish({ type: "freeze", value: state.frozen });
        break;
      case "black":
        if (typeof message.value !== "boolean") return;
        state.black = message.value;
        publish({ type: "black", value: state.black });
        break;
      case "cursor":
        if (message.hidden === true) {
          publish({ type: "cursor", hidden: true });
        } else if (isNormalized(message.x) && isNormalized(message.y)) {
          publish({
            type: "cursor",
            x: message.x,
            y: message.y,
            color: LASER_COLORS.has(message.color as string)
              ? message.color
              : "#2563eb",
          });
        }
        break;
      case "stroke":
        if (!validStroke(message)) return;
        {
          const key = String(message.slide);
          const strokes = (state.strokes[key] ??= []);
          const stroke: Stroke = {
            id: message.id,
            slide: message.slide,
            points: message.points,
            color: message.color,
            width: message.width,
          };
          const index = strokes.findIndex((item) => item.id === message.id);
          if (index >= 0) strokes[index] = stroke;
          else {
            if (strokes.length >= MAX_STROKES_PER_SLIDE) return;
            strokes.push(stroke);
          }
          publish({ type: "stroke", ...stroke });
        }
        break;
      case "erase-stroke":
        if (!validSlide(message.slide) || typeof message.id !== "string") return;
        {
          const key = String(message.slide);
          const strokes = state.strokes[key] ?? [];
          state.strokes[key] = strokes.filter((stroke) => stroke.id !== message.id);
          publish({
            type: "erase-stroke",
            slide: message.slide,
            id: message.id,
          });
        }
        break;
      case "clear-slide":
        if (!validSlide(message.slide)) return;
        delete state.strokes[String(message.slide)];
        publish({ type: "clear-slide", slide: message.slide });
        break;
    }
  }

  /** Events after `since`, or a snapshot when the client is new or too far behind. */
  function eventsSince(since: number | null): object[] | null {
    const oldest = events[0]?.seq ?? seq + 1;
    if (since === null || since > seq || since < oldest - 1) return [snapshot(state)];
    if (since === seq) return null;
    return events.filter((event) => event.seq > since).map((event) => event.message);
  }

  function respondPoll(res: ServerResponse, messages: object[]): void {
    send(res, 200, JSON.stringify({ seq, events: messages }), MIME[".json"]);
  }

  async function handleHttp(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<"handled" | "skip"> {
    if (url.pathname !== "/api/sync") return "skip";

    if (req.method === "POST") {
      let body: unknown;
      try {
        body = await readJsonBody(req);
      } catch {
        send(res, 400, "Bad Request");
        return "handled";
      }
      if (body && typeof body === "object") {
        applyPresenterMessage(body as ClientMessage);
      }
      send(res, 204, "");
      return "handled";
    }

    if (req.method !== "GET") {
      send(res, 405, "Method Not Allowed");
      return "handled";
    }

    const sinceParam = Number(url.searchParams.get("since") ?? NaN);
    const since = Number.isInteger(sinceParam) ? sinceParam : null;
    const ready = eventsSince(since);
    if (ready) {
      respondPoll(res, ready);
      return "handled";
    }

    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        waiters.delete(finish);
        req.off("close", finish);
        resolve();
      };
      const timer = setTimeout(finish, LONG_POLL_TIMEOUT_MS);
      waiters.add(finish);
      req.on("close", finish);
    });
    if (!res.destroyed) respondPoll(res, eventsSince(since) ?? []);
    return "handled";
  }

  webSocketServer.on("connection", (client) => {
    clients.add(client);
    client.send(JSON.stringify(snapshot(state)));

    client.on("message", (data) => {
      const message = parseMessage(data);
      if (!message) return;

      if (message.type === "hello") {
        if (message.role === "presenter" || message.role === "audience") {
          roles.set(client, message.role);
          client.send(JSON.stringify(snapshot(state)));
        }
        return;
      }

      if (roles.get(client) !== "presenter") return;
      applyPresenterMessage(message);
    });

    client.on("close", () => {
      clients.delete(client);
      roles.delete(client);
    });
    client.on("error", () => {
      clients.delete(client);
      roles.delete(client);
    });
  });

  return {
    handleHttp,
    stop: () =>
      new Promise<void>((resolve) => {
        for (const wake of [...waiters]) wake();
        for (const client of clients) client.terminate();
        webSocketServer.close();
        resolve();
      }),
  };
}
