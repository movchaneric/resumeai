import type { RunId } from "@resume-ai/shared";

type Listener = () => void;

/**
 * The in-process bus behind `RunEvents` (defined by the service layer; it has the same shape). One backend instance is
 * assumed, so a stream only sees Runs worked on by this process. Moving to Postgres LISTEN/NOTIFY would change only this class.
 */
export class InProcessRunEvents {
  private readonly listeners = new Map<RunId, Set<Listener>>();

  publish(runId: RunId): void {
    for (const listener of [...(this.listeners.get(runId) ?? [])]) {
      // A listener must not break the graph that publishes; its own errors are its business.
      try {
        listener();
      } catch (error) {
        console.error(`Run ${runId}: an event listener threw`, error);
      }
    }
  }

  subscribe(runId: RunId, listener: Listener): () => void {
    const set = this.listeners.get(runId) ?? new Set<Listener>();
    this.listeners.set(runId, set);
    // A wrapper per subscription, so subscribing the same function twice gives two independent subscriptions.
    const own: Listener = () => listener();
    set.add(own);
    return () => {
      set.delete(own);
      if (set.size === 0 && this.listeners.get(runId) === set) this.listeners.delete(runId);
    };
  }
}
