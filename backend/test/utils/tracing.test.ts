import { context, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LangChainLlmClient } from "@/llm/langChainLlmClient.js";
import { instrumentLangChain } from "@/utils/tracing.js";
import { withSpan } from "@/utils/spans.js";

const Schema = z.object({ name: z.string() });
const messages = [{ role: "user" as const, content: "who?" }];
const options = { apiKey: "k", baseUrl: "http://llm.invalid/v1", model: "m", contextTokens: 16_384, timeoutMs: 5_000 };

// A short delay keeps the first call's end callbacks queued while the second call starts.
const slowFetch = (async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  return new Response(
    JSON.stringify({
      id: "c1",
      object: "chat.completion",
      created: 0,
      model: "m",
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: '{"name":"Ada"}' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}) as typeof fetch;

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
const savedBackground = process.env.LANGCHAIN_CALLBACKS_BACKGROUND;
let instrumentation: ReturnType<typeof instrumentLangChain>;

beforeAll(() => {
  provider.register();
  instrumentation = instrumentLangChain(provider, true);
});

afterAll(async () => {
  instrumentation.disable();
  await provider.shutdown();
  trace.disable();
  context.disable();
  if (savedBackground === undefined) delete process.env.LANGCHAIN_CALLBACKS_BACKGROUND;
  else process.env.LANGCHAIN_CALLBACKS_BACKGROUND = savedBackground;
});

describe("LangChain tracing", () => {
  it("keeps each model call in the trace of its own extraction span", async () => {
    const llm = new LangChainLlmClient(options, slowFetch);
    const roots = new Map<string, string>();
    for (const name of ["a", "b"]) {
      await withSpan(name, async (span) => {
        roots.set(name, span.spanContext().traceId);
        await llm.structured(Schema, messages, { name: "who" });
      });
    }
    await provider.forceFlush();

    const spans = exporter.getFinishedSpans();
    const modelSpans = spans.filter((s) => s.name === "ChatOpenAI");
    expect(modelSpans).toHaveLength(2);
    const traceIds = new Set(roots.values());
    for (const span of spans.filter((s) => s.name !== "a" && s.name !== "b")) {
      expect(traceIds.has(span.spanContext().traceId)).toBe(true);
    }
    // Each root owns exactly one ChatOpenAI span.
    for (const [, traceId] of roots) {
      expect(modelSpans.filter((s) => s.spanContext().traceId === traceId)).toHaveLength(1);
    }
  });
});
