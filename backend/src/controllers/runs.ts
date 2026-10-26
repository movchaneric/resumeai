import type { Request, Response } from "express";
import { ApiError } from "@/utils/errors.js";
import type { RunsService } from "@/services/runs.js";

/** The HTTP edge of Runs: reads the request, calls the service, shapes the response. */
export class RunsController {
  constructor(private readonly service: RunsService) {}

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
}
