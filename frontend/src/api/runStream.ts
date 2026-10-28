import { RunViewSchema, type RunView } from "@resume-ai/shared";
import { apiUrl } from "@/api/config";
import { parseWith } from "@/api/http";

export interface RunStreamHandlers {
  /** One parsed view per `run` event. */
  onView: (view: RunView) => void;
  /** The stream broke or ended (the server closes it after a final view), or an event was not a valid view. */
  onError: (error: unknown) => void;
}

/**
 * Opens `GET /runs/:id/events`. Returns a function that closes it. The stream is closed on the first error so the browser
 * does not reconnect by itself: the caller decides what to do next (refetch, poll).
 */
export function openRunStream(id: string, { onView, onError }: RunStreamHandlers): () => void {
  const source = new EventSource(apiUrl(`/runs/${encodeURIComponent(id)}/events`));
  source.addEventListener("run", (event) => {
    try {
      onView(parseWith(RunViewSchema, JSON.parse((event as MessageEvent<string>).data)));
    } catch (error) {
      source.close();
      onError(error);
    }
  });
  source.addEventListener("error", (event) => {
    source.close();
    onError(event);
  });
  return () => source.close();
}
