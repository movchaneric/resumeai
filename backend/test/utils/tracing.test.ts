import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SpanStatusCode, context, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { LangChainLlmClient } from "@/llm/langChainLlmClient.js";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { buildRunGraph } from "@/graph/runGraph.js";
import { parseCv } from "@/parsing/parseCv.js";
import { loadConfig } from "@/utils/config.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";
import { guardExporter, instrumentLangChain } from "@/utils/tracing.js";
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

describe("LangChain tracing with content", () => {
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

describe("LangChain tracing without content", () => {
  const MARKER = "SECRET-MARKER";
  const memory = new InMemorySpanExporter();
  const hiddenProvider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(guardExporter(memory, false))],
  });
  let hiddenInstrumentation: ReturnType<typeof instrumentLangChain>;

  beforeAll(() => {
    // The first describe's afterAll has already run by now, so this provider can take over.
    trace.disable();
    context.disable();
    hiddenProvider.register();
    hiddenInstrumentation = instrumentLangChain(hiddenProvider, false);
  });

  afterAll(async () => {
    hiddenInstrumentation.disable();
    await hiddenProvider.shutdown();
    trace.disable();
    context.disable();
  });

  it("keeps model output out of error spans", async () => {
    const badFetch = (async () =>
      new Response(
        JSON.stringify({
          id: "c1",
          object: "chat.completion",
          created: 0,
          model: "m",
          choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: `${MARKER} is not json` } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    const llm = new LangChainLlmClient(options, badFetch);

    await expect(llm.structured(Schema, messages, { name: "who" })).rejects.toThrow();
    await hiddenProvider.forceFlush();

    const spans = memory.getFinishedSpans();
    expect(spans.some((s) => s.status.code === SpanStatusCode.ERROR)).toBe(true);
    const everything = JSON.stringify(
      spans.map((s) => ({ name: s.name, attributes: s.attributes, events: s.events, status: s.status })),
    );
    expect(everything).not.toContain("SECRET"); // V8 quotes only the first 10 characters of invalid JSON
    for (const span of spans) {
      expect(span.events.filter((e) => e.name === "exception")).toEqual([]);
      expect(span.status.message ?? "").toBe("");
    }
  });
});

describe("LangGraph tracing without content", () => {
  const CV_MARKER = "MARKER-CV-TEXT-91f3";
  const JD_MARKER = "MARKER-JD-TEXT-77b2";
  const memory = new InMemorySpanExporter();
  const hiddenProvider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(guardExporter(memory, false))],
  });
  let hiddenInstrumentation: ReturnType<typeof instrumentLangChain>;

  beforeAll(() => {
    trace.disable();
    context.disable();
    hiddenProvider.register();
    hiddenInstrumentation = instrumentLangChain(hiddenProvider, false);
  });

  afterAll(async () => {
    hiddenInstrumentation.disable();
    await hiddenProvider.shutdown();
    trace.disable();
    context.disable();
  });

  it("keeps the CV and Job Description text out of every span attribute and event", async () => {
    const config = loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k" });
    const pdfText = await parseCv(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf")), config.limits);
    const llm = new FakeLlmClient().enqueue("extract_cv", extractedCv);
    const judge = new FakeLlmClient().enqueue("extract_job_profile", extractedJob).enqueue("assess_coverage", coverageAnswer);
    const graph = buildRunGraph({ llm, judgeLlm: judge, checkpointer: createMemoryCheckpointer(), onEnter: async () => {} });

    await graph.invoke(
      { runId: "run-1", cvText: `${pdfText}\n${CV_MARKER}`, jobDescriptionText: `Backend developer ${JD_MARKER}` },
      { configurable: { thread_id: "run-1" } },
    );
    await hiddenProvider.forceFlush();

    const spans = memory.getFinishedSpans();
    expect(spans.length).toBeGreaterThan(0);
    const everything = JSON.stringify(spans.map((s) => ({ name: s.name, attributes: s.attributes, events: s.events, status: s.status })));
    expect(everything).not.toContain(CV_MARKER);
    expect(everything).not.toContain(JD_MARKER);
  });
});
