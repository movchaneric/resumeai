import { AccountSchema, ClaimRunsResponseSchema, MyRunsSchema, type Account, type ClaimRunItem, type ClaimRunsResponse, type MyRuns } from "@resume-ai/shared";
import { ApiError } from "@/api/errors";
import { jsonBody, requestJson, requestVoid } from "@/api/http";

/** `GET /account`: the signed-in Account, or `null` when signed out (`401` is an answer here, not an error). Anything else fails as an `ApiError`. */
export async function getAccount(): Promise<Account | null> {
  try {
    return await requestJson("/account", AccountSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

/** `DELETE /account` (`204`): the Account and its Owned Runs are gone. `409 RUN_BUSY` while a Run is still working. */
export function deleteAccount(): Promise<void> {
  return requestVoid("/account", { method: "DELETE" });
}

/** `GET /runs`: My Runs, the Account's unexpired Owned Runs, newest first. `401` when signed out. */
export function listRuns(): Promise<MyRuns> {
  return requestJson("/runs", MyRunsSchema);
}

/** `POST /runs/claim`: turns Guest Runs into Owned Runs. The server claims only the valid ones and returns their IDs. At most `MAX_CLAIM_IDS` per call. */
export function claimRuns(items: ClaimRunItem[]): Promise<ClaimRunsResponse> {
  return requestJson("/runs/claim", ClaimRunsResponseSchema, jsonBody({ runs: items }));
}
