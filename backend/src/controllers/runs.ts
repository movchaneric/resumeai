import type { Request, Response } from "express";
import { ApiError } from "@/utils/errors.js";
import type { Config } from "@/utils/config.js";
import type { RunsService } from "@/services/runs.js";

/** The HTTP edge of Runs: reads the request, calls the service, shapes the response. */
export class RunsController {
  constructor(
    private readonly service: RunsService,
    private readonly heartbeatMs: Config["sseHeartbeatMs"],
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

  get = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    res.json(await this.service.getRunView(req.params.id));
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
    const cleanup = () => {
      gone = true;
      clearInterval(heartbeat);
      unsubscribe?.();
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
