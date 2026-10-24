import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LangChainLlmClient } from "@/llm/langChainLlmClient.js";
import { LlmSchemaError, LlmUnavailableError } from "@/llm/llmClient.js";

const Schema = z.object({ name: z.string(), age: z.number() });
const messages = [{ role: "user" as const, content: "who?" }];
const options = { apiKey: "k", baseUrl: "http://llm.invalid/v1", model: "m", contextTokens: 16_384, timeoutMs: 5_000 };

function completion(content: string) {
  return new Response(
    JSON.stringify({
      id: "c1",
      object: "chat.completion",
      created: 0,
      model: "m",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function client(fetchImpl: typeof fetch, overrides: Partial<typeof options> & { reasoningEffort?: string } = {}) {
  return new LangChainLlmClient({ ...options, ...overrides }, fetchImpl);
}

describe("LangChainLlmClient", () => {
  it("returns validated output and sends a strict json_schema without any network", async () => {
    let body: any;
    const llm = client((async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return completion('{"name":"Ada","age":36}');
    }) as typeof fetch);
    await expect(llm.structured(Schema, messages, { name: "who" })).resolves.toEqual({ name: "Ada", age: 36 });
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.name).toBe("who");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.temperature).toBe(0);
  });

  async function requestBody(overrides: Partial<{ reasoningEffort: string }>) {
    let body: any;
    const llm = client((async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body));
      return completion('{"name":"Ada","age":36}');
    }) as typeof fetch, overrides);
    await llm.structured(Schema, messages, { name: "who" });
    return body;
  }

  it('sends reasoning_effort "none" together with temperature 0', async () => {
    const body = await requestBody({ reasoningEffort: "none" });
    expect(body.reasoning_effort).toBe("none");
    expect(body.temperature).toBe(0);
  });

  it("sends a reasoning effort other than none without temperature", async () => {
    const body = await requestBody({ reasoningEffort: "low" });
    expect(body.reasoning_effort).toBe("low");
    expect(body).not.toHaveProperty("temperature");
  });

  it("maps invalid JSON to LlmSchemaError", async () => {
    const llm = client((async () => completion("not json at all")) as typeof fetch);
    await expect(llm.structured(Schema, messages, { name: "who" })).rejects.toBeInstanceOf(LlmSchemaError);
  });

  it("maps output that parses but breaks the schema to LlmSchemaError with path: message issues", async () => {
    const llm = client((async () => completion('{"name":"Ada","age":"old"}')) as typeof fetch);
    const err = await llm.structured(Schema, messages, { name: "who" }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmSchemaError);
    expect((err as LlmSchemaError).issues.length).toBeGreaterThan(0);
    expect((err as LlmSchemaError).issues[0]).toMatch(/age: /);
  });

  it("maps a reply with no content (a refusal or null content) to LlmSchemaError through the no-structured-output branch", async () => {
    const reply = (message: object) =>
      (async () =>
        new Response(
          JSON.stringify({
            id: "c1",
            object: "chat.completion",
            created: 0,
            model: "m",
            choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", ...message } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        )) as typeof fetch;
    for (const message of [{ content: null }, { content: null, refusal: "I cannot help with that" }]) {
      const err = await client(reply(message)).structured(Schema, messages, { name: "who" }).catch((e) => e);
      expect(err).toBeInstanceOf(LlmSchemaError);
      expect((err as LlmSchemaError).message).toBe('Model output for "who" could not be parsed');
      expect((err as LlmSchemaError).issues).toEqual(["the model returned no structured output"]);
    }
  });

  it("maps a call that outlives timeoutMs to LlmUnavailableError", async () => {
    // Honours the abort signal the OpenAI SDK passes, the way a real fetch does.
    const hanging = ((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;
    const err = await client(hanging, { timeoutMs: 20 }).structured(Schema, messages, { name: "who" }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect((err as LlmUnavailableError).cause).toBeDefined();
  });

  it("maps an HTTP 400 to LlmUnavailableError and keeps the cause", async () => {
    const llm = client((async () =>
      new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400, headers: { "content-type": "application/json" } })) as typeof fetch);
    const err = await llm.structured(Schema, messages, { name: "who" }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect((err as LlmUnavailableError).cause).toBeDefined();
  });

  it("maps a network failure to LlmUnavailableError", async () => {
    const llm = client((async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch);
    await expect(llm.structured(Schema, messages, { name: "who" })).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it("runs the context guard before any request", async () => {
    let called = false;
    const llm = client((async () => {
      called = true;
      return completion("{}");
    }) as typeof fetch, { contextTokens: 100 });
    await expect(llm.structured(Schema, [{ role: "user", content: "x".repeat(3000) }], { name: "who" })).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(called).toBe(false);
  });
});
