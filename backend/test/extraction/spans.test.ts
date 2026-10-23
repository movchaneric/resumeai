import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ExtractedJobProfile } from "@resume-ai/shared";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import { extractCv } from "@/extraction/extractCv.js";
import { extractJobProfile } from "@/extraction/extractJobProfile.js";
import { LlmSchemaError } from "@/llm/llmClient.js";
import { withSpan } from "@/utils/spans.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { fullCv } from "./cvFixture.js";

const cvText = `Ada Lovelace
Engineer.
Acme - Dev 2020 - 2022
Built a
Built b
Beta - Lead 2020 - 2022
Led c
MIT BSc CS 2020 2022
Thesis
TypeScript SQL
Proj Shipped
AWS 2021
Experience Volunteer a Volunteer b`;

const profile: ExtractedJobProfile = {
  title: "Backend Engineer",
  company: "Acme",
  requirements: [{ text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" }],
};

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });

beforeAll(() => {
  provider.register();
});

afterAll(async () => {
  await provider.shutdown();
  trace.disable();
  context.disable();
});

beforeEach(() => exporter.reset());

function finished(name: string): ReadableSpan {
  const spans = exporter.getFinishedSpans().filter((s) => s.name === name);
  expect(spans).toHaveLength(1);
  return spans[0]!;
}

describe("extraction spans", () => {
  it("names a Job Profile extraction span with zero retries", async () => {
    await extractJobProfile(new FakeLlmClient().enqueue("extract_job_profile", profile), "job text");

    const span = finished("extract_job_profile");
    expect(span.attributes["extraction.retries"]).toBe(0);
    expect(span.attributes["openinference.span.kind"]).toBe("CHAIN");
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("counts the retry after a schema failure", async () => {
    const llm = new FakeLlmClient().enqueue("extract_job_profile", new LlmSchemaError("bad", ["a: wrong"]), profile);
    await extractJobProfile(llm, "job text");

    expect(finished("extract_job_profile").attributes["extraction.retries"]).toBe(1);
  });

  it("marks NoRequirementsError on the span and still throws", async () => {
    const llm = new FakeLlmClient().enqueue("extract_job_profile", { ...profile, requirements: [] });
    await expect(extractJobProfile(llm, "job text")).rejects.toBeInstanceOf(NoRequirementsError);

    const span = finished("extract_job_profile");
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes["extraction.failure_reason"]).toBe("NoRequirementsError");
  });

  it("records the soft mismatch count on a CV extraction span", async () => {
    const llm = new FakeLlmClient().enqueue("extract_cv", fullCv());
    const { softMismatches } = await extractCv(llm, cvText);

    const span = finished("extract_cv");
    expect(span.attributes["extraction.soft_mismatches"]).toBe(softMismatches);
    expect(span.attributes["extraction.retries"]).toBe(0);
    expect(span.status.code).toBe(SpanStatusCode.OK);
  });

  it("records a double CV failure without any issue text", async () => {
    const llm = new FakeLlmClient().enqueue(
      "extract_cv",
      new LlmSchemaError("bad", ["secret-issue-one: wrong"]),
      new LlmSchemaError("bad", ["secret-issue-two: wrong"]),
    );
    await expect(extractCv(llm, cvText)).rejects.toBeInstanceOf(ExtractionError);

    const span = finished("extract_cv");
    expect(span.attributes["extraction.retries"]).toBe(1);
    expect(span.status.code).toBe(SpanStatusCode.ERROR);
    expect(span.attributes["extraction.failure_reason"]).toBe("ExtractionError");
    expect(span.status.message).toBeUndefined();
    expect(span.events).toHaveLength(0);
    expect(JSON.stringify([span.attributes, span.status, span.events])).not.toContain("secret-issue");
  });

  it("nests spans started inside fn under the extraction span", async () => {
    await withSpan("outer", async () => {
      await trace.getTracer("x").startActiveSpan("inner", async (inner) => inner.end());
    });

    const outer = finished("outer");
    const inner = finished("inner");
    expect(inner.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
  });
});
