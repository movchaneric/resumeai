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

const config = loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k", BETTER_AUTH_SECRET: "s".repeat(32) });
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
const coverageCalls = (judge: FakeLlmClient) => judge.calls.filter((c) => c.name === "assess_coverage").length;

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
    noChanges(judge).enqueueVoted("assess_coverage", { verdicts: [{ requirementId: "req3", reason: "r", evidenceIds: ["ue1"], verdict: "partially_met" }] });
    await runner.start(input);
    const snapshot = await runner.answer(runId, [answer({ kind: "has_experience", questionId: "q2", text: "Ran a small cluster at Acme." })]);
    expect(snapshot.userEvidence).toEqual([{ id: "ue1", questionId: "q2", requirementId: "req3", text: "Ran a small cluster at Acme." }]);
    expect(snapshot.confirmedGaps).toEqual([]);
    expect(statuses).toEqual(["extracting", "awaiting_answers", "tailoring", "awaiting_review"]);
  });

  it("turns no_experience into a Confirmed Gap and numbers User Evidence in Question order", async () => {
    const { runner, judge } = setup(verdicts("met", "unmet", "unmet", "met"));
    noChanges(judge).enqueueVoted("assess_coverage", { verdicts: [{ requirementId: "req3", reason: "r", evidenceIds: [], verdict: "unmet" }] });
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

describe("User Evidence and Confirmed Gaps in tailoring", () => {
  const fromAnswer = {
    op: "add",
    targetItemId: null,
    parentId: "exp1",
    text: "Operated a small cluster at Acme",
    orderedItemIds: null,
    evidenceIds: ["ue1"],
    requirementIds: ["req3"],
    rationale: "The user said so.",
  };
  const emptyRounds = { changes: [] };

  it("applies and re-judges an add Change that cites only User Evidence, and Coverage sees the Answer", async () => {
    const { runner, judge } = setup();
    judge
      .enqueueVoted("assess_coverage", { verdicts: [{ requirementId: "req3", reason: "r", evidenceIds: ["ue1"], verdict: "met" }] })
      .enqueue("tailor", { changes: [fromAnswer] }, emptyRounds, emptyRounds)
      .enqueue("claim_check", { verdicts: [{ id: "r1.c1", reason: "stated by the user", verdict: "supported" }] })
      .enqueueVoted("assess_coverage", { verdicts: [{ requirementId: "req3", reason: "r", evidenceIds: ["exp1.b2"], verdict: "met" }] });
    await runner.start(input);
    const snapshot = await runner.answer(runId, [answer({ kind: "has_experience", questionId: "q2", text: "Ran a small cluster at Acme." })]);

    const tailorPrompt = judge.calls.find((c) => c.name === "tailor")!.messages.map((m) => m.content).join("\n");
    expect(tailorPrompt).toContain("[ue1] (for req3) Ran a small cluster at Acme.");
    const claimPrompt = judge.calls.find((c) => c.name === "claim_check")!.messages.map((m) => m.content).join("\n");
    expect(claimPrompt).toContain("- Ran a small cluster at Acme.");

    expect(snapshot.changes.map((c) => c.id)).toEqual(["r1.c1"]);
    expect(snapshot.coverage!.find((c) => c.requirementId === "req3")!.verdict).toBe("met");

    // Every Coverage call after the Answers carries the User answers block for the Requirements it judges (the first one is the CV alone).
    const coveragePrompts = judge.calls.filter((c) => c.name === "assess_coverage").map((c) => c.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n"));
    expect(coveragePrompts[0]).not.toContain("User answers");
    for (const prompt of coveragePrompts.slice(3)) expect(prompt).toContain("[ue1] Kubernetes: Ran a small cluster at Acme.");
    expect(coveragePrompts.slice(-1)[0]).toContain("Operated a small cluster at Acme");
  });

  it("does not target Confirmed Gaps", async () => {
    const { runner, judge } = setup();
    noChanges(judge);
    await runner.start(input);
    await runner.answer(runId, [answer({ kind: "no_experience", questionId: "q1" })]);
    const tailorPrompt = judge.calls.find((c) => c.name === "tailor")!.messages.map((m) => m.content).join("\n");
    expect(tailorPrompt).not.toContain("[req2]");
    expect(tailorPrompt).toContain("[req3]");
  });

  it("stops with ceiling before any round when every not-met must-have is a Confirmed Gap", async () => {
    const { runner, statuses, judge } = setup(verdicts("met", "unmet", "unmet", "met"));
    await runner.start(input);
    const snapshot = await runner.answer(runId, [answer({ kind: "no_experience", questionId: "q1" }), answer({ kind: "no_experience", questionId: "q2" })]);
    expect(snapshot.exitReason).toBe("ceiling");
    expect(snapshot.rounds).toBe(0);
    expect(judge.calls.some((c) => c.name === "tailor")).toBe(false);
    expect(statuses).toEqual(["extracting", "awaiting_answers", "awaiting_review"]);
  });
});

describe("the rejudge_answers node (issue #90)", () => {
  const coverageFor = (requirementId: string, verdict: "met" | "partially_met" | "unmet", evidenceIds: string[]) => ({
    verdicts: [{ requirementId, reason: "model reason", evidenceIds, verdict }],
  });

  it("judges again only the Requirements the user described, merges them, and raises the score", async () => {
    const { runner, judge } = setup(verdicts("met", "unmet", "unmet", "unmet"));
    noChanges(judge).enqueueVoted("assess_coverage", coverageFor("req3", "met", ["ue1"]));
    const started = await runner.start(input);
    const snapshot = await runner.answer(runId, [answer({ kind: "has_experience", questionId: "q2", text: "Ran a small cluster at Acme." })]);

    expect(coverageCalls(judge)).toBe(6); // 3 votes for the first Coverage, 3 for the Answers
    const prompt = judge.calls.filter((c) => c.name === "assess_coverage").slice(-1)[0]!.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    expect(prompt).toContain("[req3]");
    expect(prompt).not.toMatch(/\[req[124]\]/);
    expect(prompt).toContain("User answers (the candidate's own words, not in the CV):\n[ue1] Kubernetes: Ran a small cluster at Acme.");

    const verdictOf = (id: string) => snapshot.coverage!.find((c) => c.requirementId === id)!;
    expect(verdictOf("req3")).toMatchObject({ verdict: "met", evidenceIds: ["ue1"] });
    for (const id of ["req1", "req2", "req4"]) expect(verdictOf(id).verdict).toBe(started.coverage!.find((c) => c.requirementId === id)!.verdict);
    expect(snapshot.scoreAfter!).toBeGreaterThan(started.scoreAfter!);
    // The first-Coverage baseline stays the CV as uploaded.
    expect(snapshot.scoreBefore).toBe(started.scoreBefore);
    expect(snapshot.coverageBefore).toEqual(started.coverageBefore);
  });

  it("makes no model call for a no_experience Answer or a skipped Question: the Requirement stays a Confirmed Gap", async () => {
    const { runner, judge } = setup();
    noChanges(judge);
    await runner.start(input);
    const before = coverageCalls(judge);
    const snapshot = await runner.answer(runId, [answer({ kind: "no_experience", questionId: "q1" })]);
    expect(coverageCalls(judge)).toBe(before);
    expect(snapshot.confirmedGaps).toEqual(["req2"]);
    expect(snapshot.coverage!.find((c) => c.requirementId === "req2")!.verdict).toBe("unmet");
  });

  it("makes no extra call when the Run never paused", async () => {
    const { runner, judge } = setup(verdicts("met", "met", "met", "unmet"));
    noChanges(judge);
    await runner.start(input);
    expect(coverageCalls(judge)).toBe(3);
  });

  it("names the re-judge with a span", async () => {
    const { runner, judge } = setup();
    noChanges(judge).enqueueVoted("assess_coverage", coverageFor("req3", "met", ["ue1"]));
    await runner.start(input);
    await runner.answer(runId, [answer({ kind: "has_experience", questionId: "q2", text: "Ran a small cluster at Acme." })]);
    expect(exporter.getFinishedSpans().some((s) => s.name === "rejudge_answers")).toBe(true);
  });

  it("keeps the verdicts and the Run going when the re-judge fails", async () => {
    const { runner, judge } = setup();
    noChanges(judge); // no Coverage response queued for the Answers: the call fails
    await runner.start(input);
    const snapshot = await runner.answer(runId, [answer({ kind: "has_experience", questionId: "q2", text: "Ran a small cluster at Acme." })]);
    expect(snapshot.userEvidence).toHaveLength(1);
    expect(snapshot.coverage!.find((c) => c.requirementId === "req3")!.verdict).toBe("unmet");
    expect(snapshot.exitReason).not.toBeNull();
  });
});
