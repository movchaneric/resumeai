import type { Request, Response } from "express";
import { ApiError } from "@/utils/errors.js";
import type { Config } from "@/utils/config.js";
import type { ExportFormat } from "@/export/index.js";
import type { RunsService } from "@/services/runs.js";
import type { OpenStreams } from "@/utils/openStreams.js";

const DOWNLOADS: Record<ExportFormat, { contentType: string }> = {
  pdf: { contentType: "application/pdf" },
  docx: { contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};

/** The HTTP edge of Runs: reads the request, calls the service, shapes the response. */
export class RunsController {
  constructor(
    private readonly service: RunsService,
    private readonly heartbeatMs: Config["sseHeartbeatMs"],
    private readonly streams: OpenStreams,
  ) {}

  create = async (req: Request, res: Response): Promise<void> => {
    if (!req.file) throw new ApiError("BAD_REQUEST", "Upload your CV in the `cv` field.");
    const id = await this.service.createRun({ cv: req.file.buffer, jobDescription: req.body?.jobDescription });
    res.status(201).location(`/runs/${id}`).json({ id });
  };

  /** `202`: the Answers are accepted and the Run resumes in the background; the client keeps polling `GET /runs/:id`. */
  answer = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await this.service.submitAnswers(req.params.id, req.body);
    res.status(202).json({ id: req.params.id });
  };

  /** `202`: the decisions are accepted and the Run resumes in the background (the final re-judge, then `completed`). */
  review = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await this.service.submitReview(req.params.id, req.body);
    res.status(202).json({ id: req.params.id });
  };

  /** `204`: the Run and everything stored for it are gone. */
  remove = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    await this.service.deleteRun(req.params.id);
    res.status(204).end();
  };

  get = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    res.json(await this.service.getRunView(req.params.id));
  };

  /** `GET /runs/:id/cv.pdf` and `cv.docx`: the file is built in memory and sent as an attachment; nothing is cached or stored. */
  download = (format: ExportFormat) => async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    const buffer = await this.service.exportCv(req.params.id, format);
    res
      .status(200)
      .set({ "Content-Type": DOWNLOADS[format].contentType, "Content-Disposition": `attachment; filename="tailored-cv.${format}"`, "Cache-Control": "no-store" })
      .send(buffer);
  };

  /**
   * `GET /runs/:id/events`: a Server-Sent Events stream of the Run's view. The headers go out with the first view, so an
   * unknown Run still gets the plain 404. A comment line every `heartbeatMs` keeps proxies from closing an idle stream.
   */
  events = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    let started = false;
    let heartbeat: NodeJS.Timeout | undefined;
    let unsubscribe: (() => void) | undefined;
    let gone = false;
    // Shutdown ends the stream through the registry; the `close` cleanup below then unsubscribes it.
    const unregister = this.streams.add({ end: () => new Promise<void>((resolve) => res.end(resolve)) });
    const cleanup = () => {
      gone = true;
      clearInterval(heartbeat);
      unsubscribe?.();
      unregister();
    };
    res.on("close", cleanup);
    const start = () => {
      if (started) return;
      started = true;
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
    };

    unsubscribe = await this.service.openRunStream(req.params.id, {
      send: (view) => {
        if (res.writableEnded) return;
        start();
        res.write(`event: run\ndata: ${JSON.stringify(view)}\n\n`);
      },
      close: () => {
        clearInterval(heartbeat);
        res.end();
      },
    });
    if (gone) return unsubscribe();
    if (!res.writableEnded) {
      heartbeat = setInterval(() => res.write(": ping\n\n"), this.heartbeatMs);
    }
  };
}
