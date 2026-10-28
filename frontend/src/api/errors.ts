/** Codes the client invents, next to the backend's `ApiErrorCode`s (which arrive as plain strings). */
export const CLIENT_ERROR_CODES = {
  /** The response was not what the shared schemas describe. */
  PARSE: "RESPONSE_PARSE_ERROR",
  /** No response at all: offline, refused, or the proxy is down. */
  NETWORK: "NETWORK_ERROR",
} as const;

/** A failed API call: the HTTP status (0 when there was no response), the backend's `code` and `message`, and any extra fields. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  /** The server answered, but not in a shape the shared schemas accept. */
  get isParseError(): boolean {
    return this.code === CLIENT_ERROR_CODES.PARSE;
  }

  get isNetworkError(): boolean {
    return this.code === CLIENT_ERROR_CODES.NETWORK;
  }
}

/** Builds an `ApiError` from an error response body `{ code, message, ...details }`; a body that is not JSON gets a plain one. */
export async function errorFromResponse(response: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string") {
    const { code, message, ...details } = body as { code: string; message?: unknown } & Record<string, unknown>;
    return new ApiError(response.status, code, typeof message === "string" ? message : "Something went wrong.", details);
  }
  return new ApiError(response.status, "INTERNAL", "Something went wrong.");
}
