import type { RequestHandler } from "express";
import type { AccountDeletionService } from "@/services/accounts.js";

/** The HTTP edge for the signed-in Account. Runs behind `requireAccount`, which has already set `req.account`. */
export class AccountController {
  constructor(private readonly service: AccountDeletionService) {}

  get: RequestHandler = (req, res) => {
    res.json(req.account);
  };

  /** `204`: the Account, its sessions and its Owned Runs (with their checkpoints) are gone. */
  remove: RequestHandler = async (req, res) => {
    await this.service.deleteAccount(req.account!.accountId);
    res.status(204).end();
  };
}
