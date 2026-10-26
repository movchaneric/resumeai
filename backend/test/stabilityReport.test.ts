import { describe, expect, it } from "vitest";
import type { Coverage, Cv, Requirement } from "@resume-ai/shared";
import { COVERAGE_VOTES } from "@/scoring/assessCoverage.js";
import {
  analyseCoverage,
  listStability,
  mapPool,
  evidenceSection,
  normaliseText,
  parseStabilityArgs,
  renderReport,
  scoreSwing,
  stats,
  summarise,
  cvShape,
  formatCvShape,
  cvShapeSummary,
  type CoverageRun,
  type EndToEndRun,
} from "./stabilityReport.js";

const req = (id: string, text: string, importance = "must_have", kind = "skill") =>
  ({ id, text, source: text, kind, importance }) as unknown as Requirement;
const cov = (requirementId: string, verdict: string) =>
  ({ requirementId, verdict, evidenceIds: ["exp1.b1"], reason: "r" }) as unknown as Coverage;

// weights: req1 3, req2 3, req3 1 -> total 7
const reqs = [req("req1", "Node.js"), req("req2", "5+ years backend"), req("req3", "Docker", "nice_to_have")];

describe("parseStabilityArgs", () => {
  it("uses the defaults", () => {
    expect(parseStabilityArgs(["cv.pdf", "jd.txt"])).toEqual({ ok: true, cvArg: "cv.pdf", jdArg: "jd.txt", runs: 5, coverageRuns: 10, parallel: 3, votes: COVERAGE_VOTES });
  });
  it("reads the options in any position", () => {
    expect(parseStabilityArgs(["--runs", "2", "cv.pdf", "--coverage-runs", "4", "jd.txt", "--parallel", "1", "--out", "r.md"])).toEqual({
      ok: true, cvArg: "cv.pdf", jdArg: "jd.txt", runs: 2, coverageRuns: 4, parallel: 1, votes: COVERAGE_VOTES, out: "r.md",
    });
  });
  it("reads --no-cache", () => {
    expect(parseStabilityArgs(["cv.pdf", "jd.txt", "--no-cache"])).toEqual({
      ok: true, cvArg: "cv.pdf", jdArg: "jd.txt", runs: 5, coverageRuns: 10, parallel: 3, votes: COVERAGE_VOTES, noCache: true,
    });
  });
  it("reads --dump-evidence", () => {
    expect(parseStabilityArgs(["cv.pdf", "jd.txt", "--dump-evidence"])).toEqual({
      ok: true, cvArg: "cv.pdf", jdArg: "jd.txt", runs: 5, coverageRuns: 10, parallel: 3, votes: COVERAGE_VOTES, dumpEvidence: true,
    });
  });
  it("reads --votes and accepts 20 coverage runs", () => {
    expect(parseStabilityArgs(["cv.pdf", "jd.txt", "--votes", "3", "--coverage-runs", "20"])).toMatchObject({ ok: true, votes: 3, coverageRuns: 20 });
  });
  it("accepts any positive votes, including 1 and even numbers", () => {
    for (const good of ["1", "2", "4"]) expect(parseStabilityArgs(["a", "b", "--votes", good])).toMatchObject({ ok: true, votes: Number(good) });
  });
  it("rejects non-positive votes", () => {
    for (const bad of ["0", "-1", "x"]) expect(parseStabilityArgs(["a", "b", "--votes", bad]).ok).toBe(false);
    expect(parseStabilityArgs(["a", "b", "--votes"]).ok).toBe(false);
  });
  it("rejects missing paths, bad numbers and unknown flags", () => {
    expect(parseStabilityArgs([]).ok).toBe(false);
    expect(parseStabilityArgs(["a"]).ok).toBe(false);
    expect(parseStabilityArgs(["a", "b", "c"]).ok).toBe(false);
    expect(parseStabilityArgs(["a", "b", "--runs", "0"]).ok).toBe(false);
    expect(parseStabilityArgs(["a", "b", "--runs"]).ok).toBe(false);
    expect(parseStabilityArgs(["a", "b", "--nope"]).ok).toBe(false);
    expect(parseStabilityArgs(["a", "b", "--out"]).ok).toBe(false);
  });
});

describe("mapPool", () => {
  it("keeps results in order and never exceeds the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const result = await mapPool(7, 3, async (i) => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return i * 2;
    });
    expect(result).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(peak).toBe(3);
  });
});

describe("stats", () => {
  it("computes min, max, mean and population stdev", () => {
    expect(stats([2, 4, 4, 4, 5, 5, 7, 9])).toMatchObject({ n: 8, min: 2, max: 9, mean: 5, stdev: 2, range: 7 });
  });
  it("is undefined for no values", () => {
    expect(stats([])).toBeUndefined();
  });
});

describe("scoreSwing", () => {
  it("a Requirement flipping between met and unmet swings 100 x weight / total weight", () => {
    expect(scoreSwing(reqs[0]!, ["met", "unmet", "met"], 7)).toBeCloseTo(300 / 7);
  });
  it("met and partially_met swings half as much", () => {
    expect(scoreSwing(reqs[2]!, ["met", "partially_met"], 7)).toBeCloseTo(50 / 7);
  });
  it("a steady verdict does not swing", () => {
    expect(scoreSwing(reqs[0]!, ["met", "met"], 7)).toBe(0);
  });
});

describe("analyseCoverage", () => {
  it("tallies verdicts, lists only flipped Requirements, sorted by swing", () => {
    const runs = [
      [cov("req1", "met"), cov("req2", "met"), cov("req3", "met")],
      [cov("req1", "unmet"), cov("req2", "met"), cov("req3", "unmet")],
      [cov("req1", "met"), cov("req2", "met"), cov("req3", "met")],
    ];
    const a = analyseCoverage(reqs, runs);
    expect(a.perRequirement[0]!.counts).toEqual({ met: 2, partially_met: 0, unmet: 1 });
    expect(a.flipped.map((f) => f.id)).toEqual(["req1", "req3"]);
    expect(a.flipped[0]!.swing).toBeCloseTo(300 / 7);
    expect(a.swingSum).toBeCloseTo(400 / 7);
  });
});

describe("matching across runs", () => {
  it("normalises case, whitespace and surrounding punctuation", () => {
    expect(normaliseText("  Node.JS,\n  5+  years. ")).toBe("node.js, 5+ years");
    expect(normaliseText("NODE.js")).toBe(normaliseText("node.JS."));
  });
  it("matches the same Requirement despite case and whitespace, and counts all/some/one", () => {
    const s = listStability([
      [req("req1", "Node.js"), req("req2", "Docker")],
      [req("req1", "  node.JS  "), req("req2", "Kubernetes")],
      [req("req1", "NODE.JS."), req("req2", "docker")],
    ]);
    expect(s).toMatchObject({ runs: 3, inAll: 1, inSome: 1, inOne: 1 });
  });
  it("reports importance and kind changes on Requirements seen in several runs", () => {
    const s = listStability([[req("req1", "Docker", "must_have", "skill")], [req("req1", "docker", "nice_to_have", "other")], [req("req1", "Only once", "must_have")]]);
    expect(s.labelChanges).toEqual([{ text: "Docker", runs: 2, importances: ["must_have", "nice_to_have"], kinds: ["other", "skill"] }]);
  });
});

describe("summarise", () => {
  it("applies the 60% rule", () => {
    expect(summarise(10, 6)).toContain("driven by Coverage verdicts");
    expect(summarise(10, 5.9)).toContain("driven by the Requirement list and CV extraction");
    expect(summarise(0, 0)).toContain("no spread");
    expect(summarise(undefined, 3)).toContain("cannot tell");
  });
});

describe("renderReport", () => {
  const good = (score: number, verdict: string): EndToEndRun => ({
    ok: true,
    score,
    requirements: reqs,
    coverage: [cov("req1", verdict), cov("req2", "met"), cov("req3", "unmet")],
  });
  const cRun = (verdict: string, score: number): CoverageRun => ({
    ok: true,
    score,
    coverage: [cov("req1", verdict), cov("req2", "met"), cov("req3", "unmet")],
  });

  it("counts a failed run, lists its error name and keeps the stats", () => {
    const report = renderReport({
      runs: 3,
      coverageRuns: 3,
      endToEnd: [good(60, "met"), { ok: false, error: "CoverageError" }, good(50, "unmet")],
      baseRequirements: reqs,
      coverageOnly: [cRun("met", 60), { ok: false, error: "LlmUnavailableError" }, cRun("unmet", 50)],
    });
    expect(report).toContain("A: 2/3 runs succeeded, 1 failed (CoverageError x1)");
    expect(report).toContain("C: 2/3 runs succeeded, 1 failed (LlmUnavailableError x1)");
    expect(report).toContain("n 2, min 50.0, max 60.0, range 10.0");
    expect(report).toContain("lower bound");
    expect(report).toContain("Verdict: the spread looks driven by Coverage verdicts");
  });

  it("survives a run where everything failed", () => {
    const report = renderReport({ runs: 1, coverageRuns: 1, endToEnd: [{ ok: false, error: "ExtractionError" }], coverageOnly: [] });
    expect(report).toContain("0/1 runs succeeded");
    expect(report).toContain("cannot tell");
  });

  it("contains no CV Item text", () => {
    const MARKER = "ZXQ-CV-MARKER-4417";
    const cv = {
      contact: { id: "contact", name: MARKER, email: `${MARKER}@example.com`, phone: MARKER, location: MARKER, links: [] },
      summary: { id: "summary", text: MARKER },
      experience: [{ id: "exp1", company: MARKER, title: MARKER, location: null, dates: { start: "2020", end: null, current: true }, bullets: [{ id: "exp1.b1", text: `Built ${MARKER}` }] }],
      education: [],
      skills: [{ id: "skill1", text: MARKER }],
      projects: [],
      certifications: [],
      additionalSections: [],
    } as unknown as Cv;
    // Coverage reasons can quote the CV; the report must not carry them.
    const quoting = (verdict: string) =>
      [{ requirementId: "req1", verdict, evidenceIds: ["exp1.b1"], reason: JSON.stringify(cv.experience[0]!.bullets) }] as unknown as Coverage[];
    const report = renderReport({
      runs: 2,
      coverageRuns: 2,
      endToEnd: [
        { ok: true, score: 60, requirements: reqs, coverage: quoting("met") },
        { ok: true, score: 50, requirements: reqs, coverage: quoting("unmet") },
      ],
      baseRequirements: reqs,
      coverageOnly: [
        { ok: true, score: 60, coverage: quoting("met") },
        { ok: true, score: 50, coverage: quoting("unmet") },
      ],
    });
    expect(report).toContain("Node.js");
    expect(report).not.toContain(MARKER);
    expect(report).not.toContain("exp1.b1");
  });
});

describe("evidenceSection", () => {
  const covE = (requirementId: string, verdict: string, evidenceIds: string[]) =>
    ({ requirementId, verdict, evidenceIds, reason: "SECRET-REASON" }) as unknown as Coverage;
  const okRun = (...coverage: Coverage[]): CoverageRun => ({ ok: true, score: 0, coverage });
  const flip = (id: string, text: string) => ({ id, importance: "must_have", kind: "skill", text, counts: { met: 1, partially_met: 1, unmet: 0 }, swing: 1 });

  it("lists one row per run with cited IDs and a Claims-only column, then a summary line", () => {
    const lines = evidenceSection(
      [flip("req4", "Node.js"), flip("req5", "Docker")],
      [
        okRun(covE("req4", "met", ["exp1.b2"]), covE("req5", "met", ["skill1", "summary"])),
        { ok: false, error: "LlmUnavailableError" },
        okRun(covE("req4", "partially_met", ["skill3"]), covE("req5", "partially_met", [])),
        okRun(covE("req4", "met", ["exp1.b2", "skill3"]), covE("req5", "met", ["skill1", "summary"])),
      ],
    ).join("\n");
    expect(lines).toContain("### Evidence per run for flipped Requirements");
    expect(lines).toContain("#### req4: Node.js");
    expect(lines).toContain("| Run | Verdict | Cited Items | Claims only |");
    expect(lines).toContain("| 1 | met | exp1.b2 | no |");
    expect(lines).toContain("| 3 | partially_met | skill3 | yes |");
    expect(lines).toContain("| 4 | met | exp1.b2, skill3 | no |");
    expect(lines).toContain("| 3 | partially_met |  | — |");
    expect(lines).not.toContain("| 2 |");
    expect(lines).toContain("- req4: met runs cite {exp1.b2, skill3}, partial runs cite {skill3} - different evidence");
    expect(lines).toContain("- req5: met runs cite {skill1, summary}, partial runs cite {} - different evidence");
    expect(lines).not.toContain("SECRET-REASON");
  });

  it("says same evidence when the sets match, and notes a missing met or partial side", () => {
    const lines = evidenceSection(
      [flip("req1", "A"), flip("req2", "B")],
      [
        okRun(covE("req1", "met", ["exp1.b1", "skill1"]), covE("req2", "met", ["exp1.b1"])),
        okRun(covE("req1", "partially_met", ["skill1", "exp1.b1"]), covE("req2", "unmet", [])),
      ],
    ).join("\n");
    expect(lines).toContain("- req1: same evidence, different verdict (both cite {exp1.b1, skill1})");
    expect(lines).toContain("- req2: no met versus partial comparison (verdicts seen: met, unmet)");
  });

  it("says none when nothing flipped", () => {
    expect(evidenceSection([], []).join("\n")).toContain("None");
  });
});

describe("renderReport with dumpEvidence", () => {
  const cRun = (verdict: string): CoverageRun => ({
    ok: true,
    score: 1,
    coverage: [
      { requirementId: "req1", verdict, evidenceIds: [verdict === "met" ? "exp1.b2" : "skill3"], reason: "r" },
      cov("req2", "met"),
      cov("req3", "unmet"),
    ] as unknown as Coverage[],
  });
  const input = { runs: 1, coverageRuns: 2, endToEnd: [], baseRequirements: reqs, coverageOnly: [cRun("met"), cRun("partially_met")] };

  it("adds the section after the flipped table only when asked", () => {
    const without = renderReport(input);
    const withDump = renderReport({ ...input, dumpEvidence: true });
    expect(without).not.toContain("Evidence per run");
    expect(withDump.indexOf("### Evidence per run for flipped Requirements")).toBeGreaterThan(withDump.indexOf("### Flipped Requirements"));
    expect(withDump.indexOf("### Evidence per run for flipped Requirements")).toBeLessThan(withDump.indexOf("## Summary"));
    expect(withDump).toContain("different evidence");
  });
});

describe("CV shape", () => {
  const item = (id: string) => ({ id, text: "SECRET" });
  const cv = {
    contact: { id: "contact", name: "SECRET" },
    summary: item("summary"),
    experience: [{ id: "exp1", company: "SECRET", bullets: [item("a"), item("b")] }, { id: "exp2", company: "SECRET", bullets: [item("c")] }],
    education: [{ id: "edu1", bullets: [] }],
    skills: [item("s1"), item("s2"), item("s3")],
    projects: [{ id: "proj1", bullets: [item("p")] }],
    certifications: [{ id: "cert1" }],
    additionalSections: [{ id: "add1", title: "SECRET", items: [item("i1"), item("i2")] }],
  } as unknown as Cv;

  it("counts Items only", () => {
    const shape = cvShape(cv);
    expect(shape).toEqual({
      summary: true, experience: 2, experienceBullets: 3, education: 1, educationBullets: 0, skills: 3,
      projects: 1, projectBullets: 1, certifications: 1, additionalSections: 1, additionalItems: 2,
    });
    expect(formatCvShape(shape)).toBe("sum 1, exp 2/3, edu 1/0, skills 3, proj 1/1, cert 1, add 1/2");
    expect(formatCvShape(shape)).not.toContain("SECRET");
  });

  it("adds columns to the A table and a one-line summary", () => {
    const shapeA = cvShape(cv);
    const shapeB = { ...shapeA, experienceBullets: 12 };
    const run = (shape: typeof shapeA, softMismatches: number): EndToEndRun => ({
      ok: true, score: 50, requirements: reqs, coverage: [cov("req1", "met"), cov("req2", "met"), cov("req3", "unmet")], cvShape: shape, softMismatches,
    });
    const same = renderReport({ runs: 2, coverageRuns: 0, endToEnd: [run(shapeA, 0), run(shapeA, 1)], coverageOnly: [] });
    expect(same).toContain("| CV Items (summary, entries/bullets, counts) | softMismatches |");
    expect(same).toContain("| sum 1, exp 2/3, edu 1/0, skills 3, proj 1/1, cert 1, add 1/2 | 1 |");
    expect(same).toContain("CV shape: identical across the 2 successful runs.");
    const differs = renderReport({ runs: 2, coverageRuns: 0, endToEnd: [run(shapeA, 0), run(shapeB, 0)], coverageOnly: [] });
    expect(differs).toContain("CV shape: differs between runs (2 distinct shapes in 2 successful runs).");
  });
});

describe("renderReport with votes", () => {
  const input = { runs: 1, coverageRuns: 1, endToEnd: [], baseRequirements: reqs, coverageOnly: [{ ok: true as const, score: 1, coverage: [cov("req1", "met")] }] };
  it("states the votes above 1 and is unchanged at 1", () => {
    expect(renderReport({ ...input, votes: 3 })).toContain("Votes per run: 3 Coverage calls, median verdict");
    expect(renderReport({ ...input, votes: 1 })).toBe(renderReport(input));
    expect(renderReport(input)).not.toContain("Votes per run");
  });
});
