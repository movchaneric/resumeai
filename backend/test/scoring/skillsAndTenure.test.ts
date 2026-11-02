// Issue #90: the Questions step asked about React, Node.js and "2+ years" although the CV states all three.
// These tests run the real Coverage chain with a fake model, then Question selection, with "today" pinned.
import { describe, expect, it } from "vitest";
import { QuestionIdSchema, RequirementSchema, UserEvidenceIdSchema } from "@resume-ai/shared";
import type { Cv, DateRange, Requirement } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";
import { assessCoverage } from "@/scoring/assessCoverage.js";

import { DURATION_DOWNGRADE_REASON } from "@/scoring/coverageRules.js";
import { matchScore } from "@/scoring/matchScore.js";
import { selectQuestions } from "@/tailoring/questions.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";

const TODAY = new Date("2026-11-01T12:00:00Z");

// A made-up person: the skills lines name React and Node.js; one role, whose dates each test sets.
const cvWith = (dates: DateRange): Cv =>
  assignCvIds({
    contact: { name: "Ada Example", headline: null, email: null, phone: null, location: null, links: [] },
    summary: null,
    experience: [{ company: "Acme Ltd", title: "Full stack developer", location: null, dates, bullets: ["Built internal tools", "Designed REST APIs"] }],
    education: [],
    skills: ["Frontend: React, Angular, HTML, CSS", "Backend: Node.js, Express, SQL"],
    projects: [],
    certifications: [],
    additionalSections: [],
  });
const current = (start: string): DateRange => ({ start, end: null, current: true });
const req = (id: string, text: string, kind: Requirement["kind"]): Requirement =>
  RequirementSchema.parse({ id, text, source: text, kind, importance: "must_have" });
const answer = (...verdicts: [string, "met" | "partially_met" | "unmet", string[]][]) => ({
  verdicts: verdicts.map(([requirementId, verdict, evidenceIds]) => ({ requirementId, reason: "model reason", evidenceIds, verdict })),
});

/** Runs Coverage with one fake-model call, then selects Questions. Returns what the model was shown too. */
async function run(cv: Cv, requirements: Requirement[], modelAnswer: ReturnType<typeof answer>) {
  const llm = new FakeLlmClient().enqueue("assess_coverage", modelAnswer);
  const { coverage } = await assessCoverage(llm, cv, requirements, { votes: 1, today: TODAY });
  const prompt = llm.calls[0]!.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  return { coverage, prompt, questions: selectQuestions(requirements, coverage, cv, TODAY) };
}

describe("a skill named only in the skills list", () => {
  it("stays partially met, scores 0.5 and gives no Question", async () => {
    const requirements = [req("req1", "React", "skill"), req("req2", "Node.js", "skill")];
    const { coverage, questions } = await run(cvWith(current("2024")), requirements, answer(["req1", "met", ["skill1"]], ["req2", "met", ["skill2"]]));
    expect(coverage.map((c) => c.verdict)).toEqual(["partially_met", "partially_met"]);
    expect(matchScore(requirements, coverage)).toBe(50);
    expect(questions).toEqual([]);
  });

  it("still asks when the Requirement is an experience, not a skill", async () => {
    const requirements = [req("req1", "React frontend development", "experience")];
    const { questions } = await run(cvWith(current("2024")), requirements, answer(["req1", "met", ["skill1"]]));
    expect(questions.map((q) => q.requirementId)).toEqual(["req1"]);
  });

  it("still asks when a skill is partially met on a non-Claim Item", async () => {
    const requirements = [req("req1", "Node.js", "skill")];
    const { questions } = await run(cvWith(current("2024")), requirements, answer(["req1", "partially_met", ["exp1.b1"]]));
    expect(questions.map((q) => q.requirementId)).toEqual(["req1"]);
  });
});

describe("tenure", () => {
  const twoYears = [req("req1", "Full Stack or Web development, 2+ years", "experience")];

  it("gives the model today's date and each dated Item's tenure range", async () => {
    const { prompt } = await run(cvWith(current("2024")), twoYears, answer(["req1", "partially_met", ["exp1"]]));
    expect(prompt).toContain("Today: 2026-11-01");
    expect(prompt).toContain("2024 – present (1y11m to 2y10m as of Nov 2026)");
  });

  it("computes a month-precise start exactly", async () => {
    const { prompt } = await run(cvWith(current("2024-03")), twoYears, answer(["req1", "met", ["exp1"]]));
    expect(prompt).toContain("2024-03 – present (2y8m as of Nov 2026)");
  });

  it("is met with no Question when even the shortest tenure reaches the duration", async () => {
    const { coverage, questions } = await run(cvWith(current("2022")), twoYears, answer(["req1", "met", ["exp1"]]));
    expect(coverage[0]!.verdict).toBe("met");
    expect(questions).toEqual([]);
  });

  it("asks the start month when the range straddles the duration", async () => {
    const { coverage, questions } = await run(cvWith(current("2024")), twoYears, answer(["req1", "partially_met", ["exp1"]]));
    expect(coverage[0]!.verdict).toBe("partially_met");
    expect(questions).toEqual([
      {
        id: "q1",
        requirementId: "req1",
        text: "Your CV shows Full stack developer at Acme Ltd from 2024 to now. Which month in 2024 did you start? The job asks for Full Stack or Web development, 2+ years.",
      },
    ]);
  });

  it("downgrades a model `met` that the shortest tenure does not prove", async () => {
    const { coverage } = await run(cvWith(current("2024")), twoYears, answer(["req1", "met", ["exp1", "exp1.b1"]]));
    expect(coverage[0]).toMatchObject({ verdict: "partially_met", reason: DURATION_DOWNGRADE_REASON });
  });

  it("gives a past role with bare years a range, and a straddling verdict against 2+ years", async () => {
    const past: DateRange = { start: "2019", end: "2021", current: false };
    const { coverage, prompt, questions } = await run(cvWith(past), twoYears, answer(["req1", "met", ["exp1"]]));
    expect(prompt).toContain("2019 – 2021 (1y1m to 2y11m as of Nov 2026)");
    expect(coverage[0]!.verdict).toBe("partially_met");
    expect(questions[0]!.text).toContain("from 2019 to 2021. Which month in 2019 did you start?");
  });

  it("leaves a duration it cannot parse to the model", async () => {
    const requirements = [req("req1", "Several years of full stack work", "experience")];
    const { coverage } = await run(cvWith(current("2024")), requirements, answer(["req1", "met", ["exp1"]]));
    expect(coverage[0]!.verdict).toBe("met");
  });

  it("lets an Answer with a start month make the duration met, citing the User answer", async () => {
    const cv = cvWith(current("2024"));
    const userEvidence = [
      { id: UserEvidenceIdSchema.parse("ue1"), questionId: QuestionIdSchema.parse("q1"), requirementId: twoYears[0]!.id, text: "Started in March 2024." },
    ];
    const llm = new FakeLlmClient().enqueue("assess_coverage", answer(["req1", "met", ["exp1", "ue1"]]));
    const { coverage } = await assessCoverage(llm, cv, twoYears, { votes: 1, today: TODAY, userEvidence });
    const prompt = llm.calls[0]!.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    expect(prompt).toContain("User answers (the candidate's own words, not in the CV):\n[ue1] Full Stack or Web development, 2+ years: Started in March 2024.");
    expect(coverage[0]).toMatchObject({ verdict: "met", evidenceIds: ["exp1", "ue1"], reason: "model reason" });
  });

  it("still rejects a User answer ID that does not exist", async () => {
    const llm = new FakeLlmClient().enqueue("assess_coverage", answer(["req1", "met", ["ue9"]]), answer(["req1", "partially_met", ["exp1"]]));
    await assessCoverage(llm, cvWith(current("2024")), twoYears, { votes: 1, today: TODAY });
    expect(llm.calls).toHaveLength(2); // the unknown ID forced a retry
  });
});
