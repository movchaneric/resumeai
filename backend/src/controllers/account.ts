import type { RequestHandler } from "express";

/** The HTTP edge for the signed-in Account. Runs behind `requireAccount`, which has already set `req.account`. */
export class AccountController {
  get: RequestHandler = (req, res) => {
    res.json(req.account);
  };
}
