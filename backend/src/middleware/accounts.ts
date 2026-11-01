import type { RequestHandler } from "express";
import type { Account, AccountsService } from "@/auth/accounts.js";
import { ApiError } from "@/utils/errors.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `optionalAccount` and `requireAccount`: the signed-in Account, or `null` for a guest. */
      account?: Account | null;
    }
  }
}

/** Looks up the session and puts the Account on the request; a guest passes with `account` set to `null`. */
export function optionalAccount(accounts: AccountsService): RequestHandler {
  return (req, _res, next) => {
    accounts.accountOf(req).then((account) => {
      req.account = account;
      next();
    }, next);
  };
}

/** Like `optionalAccount`, but a guest is rejected with 401 `UNAUTHENTICATED`. */
export function requireAccount(accounts: AccountsService): RequestHandler {
  return (req, _res, next) => {
    accounts.accountOf(req).then((account) => {
      if (!account) return next(new ApiError("UNAUTHENTICATED", "Sign in to continue."));
      req.account = account;
      next();
    }, next);
  };
}
