import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { context, trace } from "@opentelemetry/api";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveJobProfile } from "@/graph/jobProfileCache.js";
import { parseCv } from "@/parsing/parseCv.js";
import { loadConfig } from "@/utils/config.js";
import { withSpan } from "@/utils/spans.js";
import { jobProfileCacheKey } from "@/extraction/jobProfileKey.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { FakeJobProfileCache } from "../fakes/jobProfileCache.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { coverageAnswer, extractedCv, extractedJob } from "../runFixtures.js";

const JD = "We are hiring a backend developer with Node.js experience.";
const cvPdf = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf"));
const CV_TEXT = await parseCv(cvPdf, loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k" }).limits);
const KEY = jobProfileCacheKey(JD, "test-judge");

function setup(cache = new FakeJobProfileCache()) {
  const llm = new FakeLlmClient().enqueue("extract_cv", extractedCv);
  const judge = new FakeLlmClient().enqueue("assess_coverage", coverageAnswer);
  const runner = makeGraphRunner({ setStatus: async () => {} }, llm, judge, cache);
  const start = () => runner.start({ runId: "00000000-0000-4000-8000-000000000001" as never, cvText: CV_TEXT, jobDescriptionText: JD });
  const extractCalls = () => judge.calls.filter((c) => c.name === "extract_job_profile").length;
  return { cache, judge, start, extractCalls };
}

describe("extract node and the Job Profile cache", () => {
  it("uses a cached profile and makes no Job Profile model call", async () => {
    const { cache, start, extractCalls } = setup();
    cache.rows.set(KEY, { ...extractedJob, title: "Cached Title", requirements: [{ id: "req1", ...extractedJob.requirements[0]! }] } as never);
    const snapshot = await start();
    expect(extractCalls()).toBe(0);
    expect(snapshot.jobProfile?.title).toBe("Cached Title");
  });

  it("extracts on a miss, saves the profile and keeps it in the Run", async () => {
    const { cache, judge, start, extractCalls } = setup();
    judge.enqueue("extract_job_profile", extractedJob);
    const snapshot = await start();
    expect(extractCalls()).toBe(1);
    expect(cache.rows.get(KEY)).toEqual(snapshot.jobProfile);
  });

  it("extracts and still succeeds when reading the cache throws", async () => {
    const { cache, judge, start, extractCalls } = setup();
    cache.failGet = true;
    judge.enqueue("extract_job_profile", extractedJob);
    const snapshot = await start();
    expect(extractCalls()).toBe(1);
    expect(snapshot.jobProfile?.title).toBe("Backend Developer");
    expect(snapshot.scoreBefore).not.toBeNull();
  });

  it("succeeds when writing the cache throws", async () => {
    const { cache, judge, start } = setup();
    cache.failPut = true;
    judge.enqueue("extract_job_profile", extractedJob);
    const snapshot = await start();
    expect(snapshot.jobProfile?.title).toBe("Backend Developer");
    expect(cache.rows.size).toBe(0);
  });
});

describe("jobProfile.cache span attribute", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  beforeAll(() => provider.register());
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
    context.disable();
  });
  beforeEach(() => exporter.reset());

  async function outcome(cache: FakeJobProfileCache): Promise<unknown> {
    exporter.reset();
    const judgeLlm = new FakeLlmClient().enqueue("extract_job_profile", extractedJob);
    await withSpan("root", () => resolveJobProfile({ cache, judgeLlm, judgeModel: "test-judge" }, JD));
    return exporter.getFinishedSpans().find((s) => s.name === "root")!.attributes["jobProfile.cache"];
  }

  it("is miss, then hit, and error when reading fails", async () => {
    const cache = new FakeJobProfileCache();
    expect(await outcome(cache)).toBe("miss");
    expect(await outcome(cache)).toBe("hit");
    cache.failGet = true;
    expect(await outcome(cache)).toBe("error");
  });
});
