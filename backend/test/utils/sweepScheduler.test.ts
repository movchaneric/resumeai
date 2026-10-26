import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSweepScheduler } from "@/utils/sweepScheduler.js";

const INTERVAL = 1000;

/** A pass that finishes only when the test calls `finish`, so a test can hold one in progress. */
function gatedPass() {
  const finishers: (() => void)[] = [];
  const pass = vi.fn(() => new Promise<void>((resolve) => finishers.push(resolve)));
  return { pass, finish: () => finishers.shift()!() };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createSweepScheduler", () => {
  it("runs nothing until started, then a first pass at once and one per interval", async () => {
    const pass = vi.fn(async () => {});
    const scheduler = createSweepScheduler(pass, INTERVAL);
    await vi.advanceTimersByTimeAsync(5 * INTERVAL);
    expect(pass).not.toHaveBeenCalled();

    scheduler.start();
    expect(pass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(pass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pass).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * INTERVAL);
    expect(pass).toHaveBeenCalledTimes(4);
    await scheduler.stop();
  });

  it("starts the first pass only when start is called, for example after recovery resolves", async () => {
    const pass = vi.fn(async () => {});
    const scheduler = createSweepScheduler(pass, INTERVAL);
    let recovered!: () => void;
    void new Promise<void>((resolve) => (recovered = resolve)).then(() => scheduler.start());
    await vi.advanceTimersByTimeAsync(3 * INTERVAL);
    expect(pass).not.toHaveBeenCalled();
    recovered();
    await vi.advanceTimersByTimeAsync(0);
    expect(pass).toHaveBeenCalledTimes(1);
    await scheduler.stop();
  });

  it("never overlaps passes: a slow pass delays the next one", async () => {
    const { pass, finish } = gatedPass();
    const scheduler = createSweepScheduler(pass, INTERVAL);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10 * INTERVAL);
    expect(pass).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(pass).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pass).toHaveBeenCalledTimes(2);
    finish();
    await scheduler.stop();
  });

  it("keeps going after a pass throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pass = vi.fn().mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
    const scheduler = createSweepScheduler(pass, INTERVAL);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(pass).toHaveBeenCalledTimes(2);
    await scheduler.stop();
  });

  it("does not keep the process alive: the timer is unref'd", async () => {
    const unref = vi.spyOn(globalThis, "setTimeout");
    const scheduler = createSweepScheduler(async () => {}, INTERVAL);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(unref).toHaveBeenCalled();
    const timer = unref.mock.results[0]!.value as NodeJS.Timeout;
    expect(timer.hasRef()).toBe(false);
    await scheduler.stop();
  });
});

describe("stop", () => {
  it("waits for a pass in progress, and no pass starts after", async () => {
    const { pass, finish } = gatedPass();
    const scheduler = createSweepScheduler(pass, INTERVAL);
    scheduler.start();
    let stopped = false;
    const stopping = scheduler.stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(10 * INTERVAL);
    expect(stopped).toBe(false);

    finish();
    await stopping;
    expect(stopped).toBe(true);
    await vi.advanceTimersByTimeAsync(10 * INTERVAL);
    expect(pass).toHaveBeenCalledTimes(1);
  });

  it("cancels the timer between passes and ignores a later start", async () => {
    const pass = vi.fn(async () => {});
    const scheduler = createSweepScheduler(pass, INTERVAL);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10 * INTERVAL);
    expect(pass).toHaveBeenCalledTimes(1);
  });
});
