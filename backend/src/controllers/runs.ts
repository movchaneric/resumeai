import type { Request, Response } from "express";
import { ApiError } from "@/utils/errors.js";
import type { RunsService } from "@/services/runs.js";

/** The HTTP edge of Runs: reads the request, calls the service, shapes the response. */
export class RunsController {
  constructor(private readonly service: RunsService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    if (!req.file) throw new ApiError("BAD_REQUEST", "Upload your CV in the `cv` field.");
    const jobDescription = typeof req.body?.jobDescription === "string" ? req.body.jobDescription : "";
    const id = await this.service.createRun({ cv: req.file.buffer, jobDescription });
    res.status(201).location(`/runs/${id}`).json({ id });
  };

  get = async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    res.json(await this.service.getRunView(req.params.id));
  };
}
