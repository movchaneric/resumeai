import { EventSource as PolyfillEventSource } from "eventsource";

/** jsdom has no EventSource. This one resolves relative URLs against the page and goes through `fetch`, so MSW's `sse()` handles it. */
class TestEventSource extends PolyfillEventSource {
  constructor(url: string | URL, init?: ConstructorParameters<typeof PolyfillEventSource>[1]) {
    super(new URL(String(url), window.location.href), init);
  }
}

export function installEventSource(): void {
  (globalThis as { EventSource: unknown }).EventSource = TestEventSource;
}
