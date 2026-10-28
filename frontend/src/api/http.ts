import type { z } from "zod";
import { apiUrl } from "@/api/config";
import { ApiError, CLIENT_ERROR_CODES, errorFromResponse } from "@/api/errors";

async function send(path: string, init?: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(apiUrl(path), init);
  } catch {
    throw new ApiError(0, CLIENT_ERROR_CODES.NETWORK, "Could not reach the server.");
  }
  if (!response.ok) throw await errorFromResponse(response);
  return response;
}

/** Parses a JSON value with a shared schema; a mismatch is an `ApiError` of its own kind. */
export function parseWith<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(200, CLIENT_ERROR_CODES.PARSE, "The server's answer was not in the expected shape.", { issues: result.error.issues });
  return result.data;
}

/** A request whose JSON response is parsed with `schema`. */
export async function requestJson<S extends z.ZodType>(path: string, schema: S, init?: RequestInit): Promise<z.output<S>> {
  const response = await send(path, init);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, CLIENT_ERROR_CODES.PARSE, "The server's answer was not valid JSON.");
  }
  return parseWith(schema, body);
}

/** A request with no body in the response (`204`). */
export async function requestVoid(path: string, init?: RequestInit): Promise<void> {
  await send(path, init);
}

export function jsonBody(value: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) };
}
