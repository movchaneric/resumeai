// Issue #90: the Questions step asked about React, Node.js and "2+ years" although the CV states all three.
// Both tests below are RED today and wrapped in `it.fails` so CI stays green: when the fix lands they start
// passing, vitest reports "expected to fail", and the fixer removes `.fails`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequirementSchema } from "@resume-ai/shared";
import type { Cv, ExtractedCv, Requirement } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";
import { assessCoverage } from "@/scoring/assessCoverage.js";
import { selectQuestions } from "@/tailoring/questions.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";

// A made-up person: skills lines name React and Node.js; one current role started in a bare year.
const extracted = (): ExtractedCv => ({
  contact: { name: "Ada Example", headline: null, email: null, phone: null, location: null, links: [] },
  summary: null,
  experience: [
    {
      company: "Acme Ltd",
      title: "Full stack developer",
      location: null,
      dates: { start: "2024", end: null, current: true },
      bullets: ["Built internal tools", "Designed REST APIs"],
    },
  ],
  education: [],
  skills: ["Frontend: React, Angular, HTML, CSS", "Backend: Node.js, Express, SQL"],
  projects: [],
  certifications: [],
  additionalSections: [],
});

const cv = (): Cv => assignCvIds(extracted());
const req = (id: string, text: string, kind: Requirement["kind"]): Requirement =>
  RequirementSchema.parse({ id, text, source: text, kind, importance: "must_have" });

afterEach(() => vi.useRealTimers());

describe("issue #90: information the CV states is lost before the Questions step", () => {
  // Seam 1: the Claim rule. skill1/skill2 are the skills lines naming React and Node.js. A model that says `met`
  // (the Requirement is a plain skill and the CV names it) is overruled to `partially_met`, and selectQuestions then asks.
  it.fails("does not ask about a skill Requirement that a skills line names exactly", async () => {
    const requirements = [req("req1", "React", "skill"), req("req2", "Node.js", "skill")];
    const llm = new FakeLlmClient().enqueue("assess_coverage", {
      verdicts: [
        { requirementId: "req1", reason: "Skills line names React.", evidenceIds: ["skill1"], verdict: "met" },
        { requirementId: "req2", reason: "Skills line names Node.js.", evidenceIds: ["skill2"], verdict: "met" },
      ],
    });
    const { coverage } = await assessCoverage(llm, cv(), requirements, { votes: 1 });
    expect(selectQuestions(requirements, coverage)).toEqual([]);
  });

  // Seam 2: the Coverage prompt. The only duration signal the model gets is "2024 – present". It is never told today's
  // date, and no tenure is computed, so it cannot prove "2+ years" (and the system prompt says a bare year cannot).
  it.fails("tells the Coverage model how long a current role has lasted, as of today", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
    const requirements = [req("req1", "Full Stack or Web development, 2+ years", "experience")];
    const llm = new FakeLlmClient().enqueue("assess_coverage", {
      verdicts: [{ requirementId: "req1", reason: "r", evidenceIds: ["exp1"], verdict: "met" }],
    });
    await assessCoverage(llm, cv(), requirements, { votes: 1 });
    const prompt = llm.calls[0]!.messages.filter((m) => m.role === "user").map((m) => m.content).join("\n");
    // Accept either the date or a computed tenure; both carry the missing information.
    expect(prompt).toMatch(/2026-11|November 2026|today|as of|\b2 years|\b2y|\b\d+ (years|months)/i);
  });
});
