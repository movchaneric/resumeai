import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter, NodeTracerProvider, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { Change, Coverage, Requirement, RunId } from "@resume-ai/shared";
import { FakeLlmClient } from "./fakes/fakeLlmClient.js";
import { extractedCv } from "./runFixtures.js";
import { COVERAGE_VOTES } from "@/scoring/assessCoverage.js";

/** One Coverage judgement is COVERAGE_VOTES parallel calls. */
const COVERAGE = Array.from({ length: COVERAGE_VOTES }, () => "assess_coverage");
import {
  formatChange,
  formatCoverage,
  formatOutcome,
  formatRound,
  parseDevArgs,
  runInPipelineSpan,
  runTailorInMemory,
} from "./extractReport.js";

const id = () => randomUUID() as RunId;

describe("parseDevArgs", () => {
  it("reads the paths and the flags", () => {
    expect(parseDevArgs(["cv.pdf", "jd.txt", "--check"])).toEqual({ ok: true, cvArg: "cv.pdf", jdArg: "jd.txt", check: true, tailor: false, coverage: false });
  });
  it("--tailor implies --coverage", () => {
    expect(parseDevArgs(["--tailor", "cv.pdf", "jd.txt"])).toMatchObject({ ok: true, tailor: true, coverage: true });
  });
  it("rejects a missing or extra path", () => {
    expect(parseDevArgs(["cv.pdf"]).ok).toBe(false);
    expect(parseDevArgs(["a", "b", "c"]).ok).toBe(false);
  });
});

const requirements = [
  { id: "req1", text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" },
  { id: "req2", text: "5+ years of backend work", source: "5+ years", kind: "experience", importance: "nice_to_have" },
] as unknown as Requirement[];
const coverage = [
  { requirementId: "req1", verdict: "met", evidenceIds: ["exp1.b1"], reason: "Built Node.js services." },
  { requirementId: "req2", verdict: "unmet", evidenceIds: [], reason: "Not shown." },
] as unknown as Coverage[];

const replace = {
  id: "r1.c1", op: "replace", targetItemId: "exp1.b1", before: "Built services.", after: "Built Node.js services.",
  rationale: "r", evidenceIds: ["exp1.b1"], requirementIds: ["req1"], status: "proposed",
} as unknown as Change;
const add = {
  id: "r1.c2", op: "add", parentId: "skills", after: "PostgreSQL",
  rationale: "r", evidenceIds: ["exp1.b1", "skill2"], requirementIds: ["req1", "req2"], status: "proposed",
} as unknown as Change;
const reorder = {
  id: "r1.c3", op: "reorder", parentId: "skills", orderedItemIds: ["skill2", "skill1"],
  rationale: "r", evidenceIds: [], requirementIds: ["req1"], status: "proposed",
} as unknown as Change;

describe("formatCoverage", () => {
  it("prints each Requirement's kind with its verdict, evidence and reason", () => {
    expect(formatCoverage(requirements, coverage)).toEqual([
      "req1 [must_have] [skill] Node.js",
      "  verdict: met  evidence: exp1.b1",
      "  reason: Built Node.js services.",
      "req2 [nice_to_have] [experience] 5+ years of backend work",
      "  verdict: unmet  evidence: none",
      "  reason: Not shown.",
    ]);
  });
  it("marks a Requirement with no verdict as missing", () => {
    expect(formatCoverage(requirements, [])[1]).toBe("  verdict: missing  evidence: none");
  });
});

describe("formatChange", () => {
  it("prints a replace as target, before -> after, evidence and Requirements", () => {
    expect(formatChange(replace)).toEqual([
      "r1.c1 replace exp1.b1",
      '  "Built services." -> "Built Node.js services."',
      "  evidence: exp1.b1  requirements: req1",
    ]);
  });
  it("prints an add with its parent and an empty before", () => {
    expect(formatChange(add)).toEqual([
      "r1.c2 add under skills",
      '  (new) -> "PostgreSQL"',
      "  evidence: exp1.b1, skill2  requirements: req1, req2",
    ]);
  });
  it("prints a reorder with the new order", () => {
    expect(formatChange(reorder)).toEqual([
      "r1.c3 reorder skills",
      "  order: skill2, skill1",
      "  evidence: none  requirements: req1",
    ]);
  });
});

describe("formatRound", () => {
  it("prints proposed Changes, rejections with stage and reason, and the kept score", () => {
    const lines = formatRound({
      round: 1, proposed: [replace, add], valid: [replace],
      rejections: [{ round: 1, change: add, stage: "claim_check", reason: "PostgreSQL is not in the evidence." }],
      roundScore: 72.5, kept: true, keptScore: 72.5, failed: false,
    });
    expect(lines).toEqual([
      "----- ROUND 1 -----",
      "proposed: 2, valid: 1, rejected: 1",
      "r1.c1 replace exp1.b1",
      '  "Built services." -> "Built Node.js services."',
      "  evidence: exp1.b1  requirements: req1",
      "r1.c2 add under skills  REJECTED (claim_check): PostgreSQL is not in the evidence.",
      '  (new) -> "PostgreSQL"',
      "  evidence: exp1.b1, skill2  requirements: req1, req2",
      "round kept: yes  round score: 72.5  kept score: 72.5",
    ]);
  });
  it("notes a failed round and a discarded one", () => {
    const failed = formatRound({ round: 2, proposed: [], valid: [], rejections: [], roundScore: null, kept: false, keptScore: 60, failed: true });
    expect(failed.some((l) => l.startsWith("round failed"))).toBe(true);
    expect(failed.at(-1)).toBe("round kept: no  round score: none  kept score: 60");
  });
});

describe("formatOutcome", () => {
  it("prints the exit reason and the score before and after, unrounded and rounded", () => {
    expect(formatOutcome({ exitReason: "plateau", rounds: 2, scoreBefore: 40.25, scoreAfter: 71.5 })).toEqual([
      "----- OUTCOME -----",
      "exit reason: plateau (2 rounds)",
      "score: 40 -> 72 (unrounded 40.25 -> 71.5)",
    ]);
  });
});

// Every protected field of `extractedCv` is quoted here, so the verbatim check passes.
const CV_TEXT = [
  "Jane Doe jane.doe@example.com Springfield",
  "Senior Backend Developer, Acme Corp, 2021 - present",
  "Designed and maintained Node.js services backed by PostgreSQL.",
  "BSc Computer Science, Springfield University, 2014 - 2018",
  "Skills: TypeScript, Node.js",
].join("\n");

describe("runTailorInMemory", () => {
  const job = {
    title: "Backend Developer",
    company: "Initech",
    requirements: [
      { text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" },
      { text: "PostgreSQL", source: "PostgreSQL", kind: "skill", importance: "must_have" },
    ],
  };
  const verdict = (requirementId: string, v: string, evidenceIds: string[]) => ({ requirementId, reason: "why", evidenceIds, verdict: v });
  const modelChange = {
    op: "add", targetItemId: null, parentId: "skills", text: "PostgreSQL", orderedItemIds: null,
    evidenceIds: ["exp1.b1"], requirementIds: ["req2"], rationale: "Shown by the Node.js services work",
  };

  it("runs the whole graph with the two clients and reports each round to the observer", async () => {
    const llm = new FakeLlmClient().enqueue("extract_cv", extractedCv);
    const judge = new FakeLlmClient()
      .enqueue("extract_job_profile", job)
      .enqueueVoted("assess_coverage", { verdicts: [verdict("req1", "met", ["exp1.b1"]), verdict("req2", "unmet", [])] })
      .enqueue("tailor", { changes: [modelChange] })
      .enqueue("claim_check", { verdicts: [{ id: "r1.c1", reason: "ok", verdict: "supported" }] })
      .enqueueVoted("assess_coverage", { verdicts: [verdict("req2", "met", ["exp1.b1"])] });
    const rounds: number[] = [];
    const snapshot = await runTailorInMemory({
      runId: id(), llm, judgeLlm: judge, cvText: CV_TEXT, jobDescriptionText: "made-up job",
      onRound: (r) => void rounds.push(r.round),
    });

    expect(llm.calls.map((c) => c.name)).toEqual(["extract_cv"]);
    expect(judge.calls.map((c) => c.name)).toEqual(["extract_job_profile", ...COVERAGE, "tailor", "claim_check", ...COVERAGE]);
    expect(rounds).toEqual([1]);
    expect(snapshot.exitReason).toBe("target_reached");
    expect(snapshot.scoreAfter).toBeGreaterThan(snapshot.scoreBefore!);
    expect(snapshot.changes).toHaveLength(1);
    expect(snapshot.exitReason).not.toBeNull();
  });
});

describe("runInPipelineSpan", () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  beforeAll(() => provider.register());
  afterAll(async () => {
    await provider.shutdown();
    trace.disable();
  });
  beforeEach(() => exporter.reset());

  it("wraps the work in one pipeline root span with a session id, and nests child spans under it", async () => {
    const { withSpan } = await import("@/utils/spans.js");
    const runId = id();
    const result = await runInPipelineSpan(runId, async () => withSpan("child", async () => 7));
    expect(result).toBe(7);
    const spans = exporter.getFinishedSpans();
    const root = spans.find((s) => s.name === "pipeline")!;
    const child = spans.find((s) => s.name === "child")!;
    expect(root.parentSpanContext).toBeUndefined();
    expect(child.parentSpanContext?.spanId).toBe(root.spanContext().spanId);
    expect(root.attributes["session.id"]).toBe(runId);
  });

  it("uses the given Run id as the session id", async () => {
    const [a, b] = [id(), id()];
    await runInPipelineSpan(a, async () => 1);
    await runInPipelineSpan(b, async () => 2);
    expect(exporter.getFinishedSpans().map((s) => s.attributes["session.id"])).toEqual([a, b]);
  });
});
