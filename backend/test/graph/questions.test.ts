import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AnswerSchema, type Answer, type RunId, type RunStatus } from "@resume-ai/shared";
import { NODE_STATUS } from "@/graph/runGraph.js";
import { parseCv } from "@/parsing/parseCv.js";
import { loadConfig } from "@/utils/config.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { extractedCv, extractedJob } from "../runFixtures.js";

const config = loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k" });
const cvText = await parseCv(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf")), config.limits);
const runId = "11111111-1111-4111-8111-111111111111" as RunId;

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
beforeAll(() => provider.register());
afterAll(() => provider.shutdown());
beforeEach(() => exporter.reset());

const job = {
  ...extractedJob,
  requirements: [
    { text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" },
    { text: "PostgreSQL", source: "PostgreSQL", kind: "skill", importance: "must_have" },
    { text: "Kubernetes", source: "Kubernetes", kind: "skill", importance: "must_have" },
    { text: "Docker", source: "Docker", kind: "skill", importance: "nice_to_have" },
  ],
};
const verdicts = (...v: ("met" | "unmet" | "partially_met")[]) => ({
  verdicts: v.map((verdict, i) => ({ requirementId: `req${i + 1}`, reason: "r", evidenceIds: verdict === "met" ? ["exp1.b1"] : [], verdict })),
});
const answer = (value: unknown): Answer => AnswerSchema.parse(value);

/** A Run whose first Coverage leaves req2 and req3 (must-haves) and req4 (nice-to-have) unmet; tailoring then finds nothing. */
function setup(coverage = verdicts("met", "unmet", "unmet", "unmet")) {
  const statuses: RunStatus[] = [];
  const judge = new FakeLlmClient().enqueue("extract_job_profile", job).enqueueVoted("assess_coverage", coverage);
  const llm = new FakeLlmClient().enqueue("extract_cv", extractedCv);
  const runner = makeGraphRunner({ setStatus: async (_id, status) => void statuses.push(status) }, llm, judge);
  return { runner, statuses, judge };
}
const input = { runId, cvText, jobDescriptionText: "Backend developer" };
const noChanges = (judge: FakeLlmClient) => judge.enqueue("tailor", { changes: [] }, { changes: [] });

describe("the select_questions and collect_answers nodes", () => {
  it("maps the answer-collecting node to awaiting_answers", () => {
    expect(NODE_STATUS.collect_answers).toBe("awaiting_answers");
  });

  it("does not pause when only nice-to-haves are unmet", async () => {
    const { runner, statuses, judge } = setup(verdicts("met", "met", "met", "unmet"));
    noChanges(judge);
    const snapshot = await runner.start(input);
    expect(statuses).toEqual(["extracting", "tailoring", "awaiting_review"]);
    expect(snapshot.questions).toEqual([]);
  });

  it("does not ask when tailoring is skipped", async () => {
    const { runner, statuses } = setup(verdicts("met", "met", "met", "met"));
    const snapshot = await runner.start(input);
    expect(statuses).toEqual(["extracting", "awaiting_review"]);
    expect(snapshot.questions).toEqual([]);
  });

  it("pauses in awaiting_answers with the Questions in state", async () => {
    const { runner, statuses } = setup();
    const snapshot = await runner.start(input);
    expect(statuses).toEqual(["extracting", "awaiting_answers"]);
    expect(snapshot.questions.map((q) => [q.id, q.requirementId])).toEqual([["q1", "req2"], ["q2", "req3"]]);
    expect(snapshot.userEvidence).toEqual([]);
    expect((await runner.read(runId))?.questions).toEqual(snapshot.questions);
  });

  it("records User Evidence and Confirmed Gaps from the Answers, skips the rest, and goes on to review", async () => {
    const { runner, statuses, judge } = setup();
    noChanges(judge);
    await runner.start(input);
    const snapshot = await runner.answer(runId, [answer({ kind: "has_experience", questionId: "q2", text: "Ran a small cluster at Acme." })]);
    expect(snapshot.userEvidence).toEqual([{ id: "ue1", questionId: "q2", requirementId: "req3", text: "Ran a small cluster at Acme." }]);
    expect(snapshot.confirmedGaps).toEqual([]);
    expect(statuses).toEqual(["extracting", "awaiting_answers", "tailoring", "awaiting_review"]);
  });

  it("turns no_experience into a Confirmed Gap and numbers User Evidence in Question order", async () => {
    const { runner, judge } = setup(verdicts("met", "unmet", "unmet", "met"));
    noChanges(judge);
    await runner.start(input);
    const snapshot = await runner.answer(runId, [
      answer({ kind: "no_experience", questionId: "q1" }),
      answer({ kind: "has_experience", questionId: "q2", text: "Used it in a side project." }),
    ]);
    expect(snapshot.confirmedGaps).toEqual(["req2"]);
    expect(snapshot.userEvidence.map((u) => [u.id, u.requirementId])).toEqual([["ue1", "req3"]]);
  });

  it("treats an empty Answer list as skipping every Question", async () => {
    const { runner, judge } = setup();
    noChanges(judge);
    await runner.start(input);
    const snapshot = await runner.answer(runId, []);
    expect(snapshot.userEvidence).toEqual([]);
    expect(snapshot.confirmedGaps).toEqual([]);
    expect(snapshot.exitReason).toBe("ceiling");
  });

  it("runs the resumed work under a new root span with the same session id", async () => {
    const { runner, judge } = setup();
    noChanges(judge);
    await runner.start(input);
    exporter.reset();
    await runner.answer(runId, []);
    const roots = exporter.getFinishedSpans().filter((s) => !s.parentSpanContext);
    expect(roots.length).toBeGreaterThan(0);
    expect(roots.map((s) => s.attributes["session.id"])).toEqual(roots.map(() => runId));
  });
});
