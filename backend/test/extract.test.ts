import type { Coverage, Cv, Requirement } from "@resume-ai/shared";
import { describe, expect, it } from "vitest";
import { compareToExpected, compareCoverageToKey, CoverageKeySchema, ExpectedSchema, type Expected } from "./extractCheck.js";

const range = (start: string | null, end: string | null, current = false) => ({ start, end, current });
const bullets = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, text: `bullet ${i}` }));

const cv = {
  experience: [
    { id: "e1", company: "Acme", title: "Dev", location: null, dates: range("2023-02", null, true), bullets: bullets(4) },
    { id: "e2", company: "Beta", title: "Lead", location: null, dates: range("2021-06", "2022-12"), bullets: bullets(2) },
  ],
  education: [{ id: "d1", institution: "MIT", degree: "BSc", field: null, dates: range(null, "2025"), bullets: [] }],
  certifications: [{ id: "c1", name: "AWS SAA", issuer: null, date: null }],
} as unknown as Cv;

const expected: Expected = {
  experience: [
    { company: "Acme", title: "Dev", start: "2023-02", end: null, current: true, bullets: 4 },
    { company: "Beta", title: "Lead", start: "2021-06", end: "2022-12", current: false, bullets: 2 },
  ],
  education: [{ institution: "MIT", degree: "BSc", start: null, end: "2025" }],
  certifications: ["AWS SAA"],
};

describe("compareToExpected", () => {
  it("returns nothing when everything matches (trimmed)", () => {
    const padded = { ...expected, certifications: ["  AWS SAA "] };
    expect(compareToExpected(cv, padded)).toEqual([]);
  });

  it("reports a wrong date with its path", () => {
    const wrong = structuredClone(expected);
    wrong.experience[1]!.start = "2021-01";
    expect(compareToExpected(cv, wrong)).toEqual(["experience[1].start: expected 2021-01, got 2021-06"]);
  });

  it("reports a missing job and an extra job", () => {
    const more = structuredClone(expected);
    more.experience.push({ company: "Gamma", title: "CTO", start: null, end: null, current: false, bullets: 0 });
    expect(compareToExpected(cv, more)).toEqual(["experience[2]: missing, expected CTO at Gamma"]);
    const fewer = { ...expected, experience: expected.experience.slice(0, 1) };
    expect(compareToExpected(cv, fewer)).toEqual(["experience[1]: extra, got Lead at Beta"]);
  });

  it("reports a wrong bullet count", () => {
    const wrong = structuredClone(expected);
    wrong.experience[0]!.bullets = 5;
    expect(compareToExpected(cv, wrong)).toEqual(["experience[0].bullets: expected 5, got 4"]);
  });
});

describe("ExpectedSchema", () => {
  it("rejects a malformed answer key", () => {
    expect(ExpectedSchema.safeParse({ experience: "x" }).success).toBe(false);
  });
});

describe("compareCoverageToKey", () => {
  const reqs = [
    { id: "req1", importance: "must_have", text: "Experience with TypeScript" },
    { id: "req2", importance: "nice_to_have", text: "Knowledge of  Kubernetes" },
  ] as unknown as Requirement[];
  const cov = (...verdicts: string[]) =>
    verdicts.map((verdict, i) => ({ requirementId: `req${i + 1}`, verdict, evidenceIds: [], reason: "r" })) as unknown as Coverage[];

  it("returns nothing when every entry matches", () => {
    const key = [
      { requirement: "experience with typescript", verdict: "met" as const },
      { requirement: "Knowledge of Kubernetes", verdict: "unmet" as const },
    ];
    expect(compareCoverageToKey(reqs, cov("met", "unmet"), key)).toEqual([]);
  });

  it("reports a verdict mismatch with both verdicts and the Requirement id", () => {
    const key = [{ requirement: "Experience with TypeScript", verdict: "met" as const }];
    expect(compareCoverageToKey(reqs, cov("partially_met", "unmet"), key)).toEqual([
      '"Experience with TypeScript": expected met, got partially_met (req1)',
    ]);
  });

  it("matches when the Requirement text is contained in the key text", () => {
    const key = [{ requirement: "Strong knowledge of Kubernetes in production", verdict: "met" as const }];
    expect(compareCoverageToKey(reqs, cov("met", "met"), key)).toEqual([]);
  });

  it("reports a key entry that matches no Requirement", () => {
    const key = [{ requirement: "Fluent Klingon", verdict: "met" as const }];
    expect(compareCoverageToKey(reqs, cov("met", "met"), key)).toEqual(['"Fluent Klingon": no Requirement matches this key entry']);
  });

  it("uses the first matching Requirement in Job Profile order", () => {
    const two = [...reqs, { id: "req3", importance: "must_have", text: "TypeScript experience with Experience with TypeScript" }] as unknown as Requirement[];
    const key = [{ requirement: "Experience with TypeScript", verdict: "unmet" as const }];
    expect(compareCoverageToKey(two, cov("met", "met", "met"), key)).toEqual(['"Experience with TypeScript": expected unmet, got met (req1)']);
  });
});

describe("CoverageKeySchema", () => {
  it("rejects an unknown verdict", () => {
    expect(CoverageKeySchema.safeParse([{ requirement: "x", verdict: "maybe" }]).success).toBe(false);
  });
});
