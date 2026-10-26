/** An open Run event stream, as shutdown sees it: `end` finishes the response and resolves once it has been flushed. */
export type OpenStream = { end: () => Promise<void> };

/** The streams open right now, so a shutdown can end them without touching ordinary requests. */
export class OpenStreams {
  private readonly open = new Set<OpenStream>();

  /** Registers a stream; the returned function removes it. */
  add(stream: OpenStream): () => void {
    this.open.add(stream);
    return () => void this.open.delete(stream);
  }

  async endAll(): Promise<void> {
    await Promise.all([...this.open].map((stream) => stream.end()));
  }
}
