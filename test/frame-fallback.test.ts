import { describe, expect, it } from "vitest";
import { installFrameFallback } from "../src/ui/modules/frame-fallback.js";

type FrameCallback = (time: number) => void;

/** A window whose animation frames fire only when the test calls `frame()`. */
function fakeWindow() {
  const document = new EventTarget() as EventTarget & { visibilityState: string };
  document.visibilityState = "visible";
  let nativeId = 0;
  const native = new Map<number, FrameCallback>();
  const win = {
    document,
    MessageChannel,
    performance,
    setTimeout,
    clearTimeout,
    requestAnimationFrame(callback: FrameCallback) {
      native.set(++nativeId, callback);
      return nativeId;
    },
    cancelAnimationFrame(id: number) {
      native.delete(id);
    },
  } as unknown as Window & { document: typeof document; __pdfPresenterFrameFallback?: boolean };
  return {
    win,
    /** Fires all pending native frame callbacks, like one rendered frame. */
    frame(time = 1234) {
      const callbacks = [...native.values()];
      native.clear();
      for (const callback of callbacks) callback(time);
    },
    nativePending: () => native.size,
    hide() {
      document.visibilityState = "hidden";
      document.dispatchEvent(new Event("visibilitychange"));
    },
    show() {
      document.visibilityState = "visible";
      document.dispatchEvent(new Event("visibilitychange"));
    },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("frame fallback", () => {
  it("uses real frames when they come, and runs each callback once", async () => {
    const fake = fakeWindow();
    installFrameFallback(fake.win);
    const calls: number[] = [];
    fake.win.requestAnimationFrame((time) => calls.push(time));
    fake.frame(42);
    expect(calls).toEqual([42]);
    await wait(150); // past the watchdog: must not run again
    expect(calls).toEqual([42]);
  });

  it("runs callbacks without frames when the page is hidden", async () => {
    const fake = fakeWindow();
    installFrameFallback(fake.win);
    fake.hide();
    let ran = false;
    fake.win.requestAnimationFrame(() => { ran = true; });
    expect(fake.nativePending()).toBe(0);
    await wait(5);
    expect(ran).toBe(true);
  });

  it("moves callbacks that wait for a frame when the page gets hidden", async () => {
    const fake = fakeWindow();
    installFrameFallback(fake.win);
    let runs = 0;
    fake.win.requestAnimationFrame(() => { runs++; });
    fake.hide();
    expect(fake.nativePending()).toBe(0);
    await wait(5);
    expect(runs).toBe(1);
    await wait(150);
    fake.frame();
    expect(runs).toBe(1);
  });

  it("falls back after the watchdog when a visible page gets no frames, then stops waiting", async () => {
    const fake = fakeWindow();
    installFrameFallback(fake.win);
    let first = false;
    fake.win.requestAnimationFrame(() => { first = true; });
    await wait(50);
    expect(first).toBe(false);
    await wait(100);
    expect(first).toBe(true);

    // Frames are known to be missing: the next callback must not wait 100 ms.
    let second = false;
    fake.win.requestAnimationFrame(() => { second = true; });
    await wait(5);
    expect(second).toBe(true);

    // A real frame arrives again: back to normal frame timing.
    fake.frame();
    let third = false;
    fake.win.requestAnimationFrame(() => { third = true; });
    await wait(5);
    expect(third).toBe(false);
    fake.frame();
    expect(third).toBe(true);
  });

  it("cancels callbacks on every path", async () => {
    const fake = fakeWindow();
    installFrameFallback(fake.win);
    let runs = 0;
    const visible = fake.win.requestAnimationFrame(() => { runs++; });
    fake.win.cancelAnimationFrame(visible);
    fake.frame();
    await wait(150);
    fake.hide();
    const hidden = fake.win.requestAnimationFrame(() => { runs++; });
    fake.win.cancelAnimationFrame(hidden);
    await wait(5);
    expect(runs).toBe(0);
    fake.show();
  });

  it("returns truthy ids and installs only once", () => {
    const fake = fakeWindow();
    installFrameFallback(fake.win);
    const wrapped = fake.win.requestAnimationFrame;
    installFrameFallback(fake.win);
    expect(fake.win.requestAnimationFrame).toBe(wrapped);
    expect(fake.win.requestAnimationFrame(() => {})).toBeGreaterThan(0);
  });
});
