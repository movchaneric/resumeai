export type SweepScheduler = {
  /** Runs the first pass now, then one every `intervalMs`. Does nothing after `stop` or if already started. */
  start(): void;
  /** Cancels the timer and resolves once a pass in progress has finished. No pass starts after it is called. */
  stop(): Promise<void>;
};

/**
 * Runs `pass` repeatedly. The next pass is scheduled when the previous one ends, so passes never overlap and a slow
 * pass just delays the next. The timer is unref'd, so it never keeps the process alive. `pass` should not throw; if it
 * does the error is logged and the schedule goes on.
 */
export function createSweepScheduler(pass: () => Promise<unknown>, intervalMs: number): SweepScheduler {
  let timer: NodeJS.Timeout | undefined;
  let running: Promise<void> | undefined;
  let started = false;
  let stopped = false;

  const run = (): void => {
    timer = undefined;
    if (stopped) return;
    running = pass()
      .catch((error: unknown) => console.error("Sweep pass failed", error))
      .then(() => {
        running = undefined;
        if (stopped) return;
        timer = setTimeout(run, intervalMs);
        timer.unref();
      });
  };

  return {
    start() {
      if (started || stopped) return;
      started = true;
      run();
    },
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      await running;
    },
  };
}
