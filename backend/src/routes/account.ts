import { Router } from "express";
import type { AccountController } from "@/controllers/account.js";
import { requireAccount } from "@/middleware/accounts.js";
import type { AccountsService } from "@/auth/accounts.js";

export function createAccountRouter(controller: AccountController, accounts: AccountsService): Router {
  const router = Router();
  router.get("/", requireAccount(accounts), controller.get);
  router.delete("/", requireAccount(accounts), controller.remove);
  return router;
}
