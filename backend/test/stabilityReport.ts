// Pure helpers for the score-stability dev script (test/stability.ts): argument parsing, matching Requirements across runs,
// stats and the markdown report. No model, no database. The report holds Requirement text (from the job description)
// and Item IDs only. It never takes CV text or Coverage reasons as input, so none can leak into the output.
import type { Coverage, CoverageVerdict, Cv, Requirement } from "@resume-ai/shared";
import { COVERAGE_VOTES } from "@/scoring/assessCoverage.js";
import { isClaimId } from "@/scoring/coverageRules.js";
import { VERDICT_CREDITS, requirementWeight } from "@/scoring/weights.js";

export const DEFAULTS = { runs: 5, coverageRuns: 10, parallel: 3, votes: COVERAGE_VOTES };

export type StabilityArgs =
  | { ok: true; cvArg: string; jdArg: string; runs: number; coverageRuns: number; parallel: number; votes: number; out?: string; noCache?: boolean; dumpEvidence?: boolean }
  | { ok: false };

const positiveInt = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n >= 1 ? n : undefined;
};

/** `<cv> <jd> [--runs N] [--coverage-runs M] [--parallel K] [--votes N] [--out file] [--no-cache] [--dump-evidence]`. Exactly two paths. */
export function parseStabilityArgs(args: string[]): StabilityArgs {
  const opts = { runs: DEFAULTS.runs, coverageRuns: DEFAULTS.coverageRuns, parallel: DEFAULTS.parallel, votes: DEFAULTS.votes };
  let out: string | undefined;
  let noCache = false;
  let dumpEvidence = false;
  const paths: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--runs" || arg === "--coverage-runs" || arg === "--parallel" || arg === "--votes") {
      const n = positiveInt(args[++i]);
      if (n === undefined) return { ok: false };
      if (arg === "--runs") opts.runs = n;
      else if (arg === "--coverage-runs") opts.coverageRuns = n;
      else if (arg === "--votes") opts.votes = n;
      else opts.parallel = n;
    } else if (arg === "--out") {
      out = args[++i];
      if (!out || out.startsWith("--")) return { ok: false };
    } else if (arg === "--no-cache") {
      noCache = true;
    } else if (arg === "--dump-evidence") {
      dumpEvidence = true;
    } else if (arg.startsWith("--")) {
      return { ok: false };
    } else paths.push(arg);
  }
  const [cvArg, jdArg, ...rest] = paths;
  if (!cvArg || !jdArg || rest.length > 0) return { ok: false };
  return { ok: true, cvArg, jdArg, ...opts, ...(out ? { out } : {}), ...(noCache ? { noCache } : {}), ...(dumpEvidence ? { dumpEvidence } : {}) };
}

/** Runs `fn` over 0..count-1 with at most `limit` calls in flight; results keep their index order. */
export async function mapPool<T>(count: number, limit: number, fn: (index: number) => Promise<T>): Promise<T[]> {
  const results = new Array<T>(count);
  let next = 0;
  const worker = async () => {
    while (next < count) {
      const index = next++;
      results[index] = await fn(index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, count) }, worker));
  return results;
}

/* ---------- stats ---------- */

export type Stats = { n: number; min: number; max: number; mean: number; stdev: number; range: number };

/** Population standard deviation. Returns undefined for an empty list. */
export function stats(values: number[]): Stats | undefined {
  if (values.length === 0) return undefined;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const stdev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { n: values.length, min, max, mean, stdev, range: max - min };
}

export const VERDICTS: CoverageVerdict[] = ["met", "partially_met", "unmet"];

export type VerdictCounts = Record<CoverageVerdict, number>;
const emptyVerdicts = (): VerdictCounts => ({ met: 0, partially_met: 0, unmet: 0 });

export function countVerdicts(coverage: Coverage[]): VerdictCounts {
  const counts = emptyVerdicts();
  for (const c of coverage) counts[c.verdict]++;
  return counts;
}

export function countBy<K extends string>(requirements: Requirement[], pick: (r: Requirement) => K): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of requirements) counts[pick(r)] = (counts[pick(r)] ?? 0) + 1;
  return counts;
}

/** Lowercase, collapse whitespace, trim surrounding whitespace and punctuation. */
export function normaliseText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "");
}

/* ---------- CV shape (experiment A) ---------- */

/** Item counts of an extracted CV, nothing else. No text, names, companies, titles or dates. */
export type CvShape = {
  summary: boolean;
  experience: number;
  experienceBullets: number;
  education: number;
  educationBullets: number;
  skills: number;
  projects: number;
  projectBullets: number;
  certifications: number;
  additionalSections: number;
  additionalItems: number;
};

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

export function cvShape(cv: Cv): CvShape {
  return {
    summary: cv.summary !== null,
    experience: cv.experience.length,
    experienceBullets: sum(cv.experience.map((e) => e.bullets.length)),
    education: cv.education.length,
    educationBullets: sum(cv.education.map((e) => e.bullets.length)),
    skills: cv.skills.length,
    projects: cv.projects.length,
    projectBullets: sum(cv.projects.map((p) => p.bullets.length)),
    certifications: cv.certifications.length,
    additionalSections: cv.additionalSections.length,
    additionalItems: sum(cv.additionalSections.map((s) => s.items.length)),
  };
}

/** Compact one-cell form: "sum 1, exp 3/12, edu 1/0, skills 20, proj 2/5, cert 1, add 1/4" (entries/bullets, sections/items). */
export function formatCvShape(s: CvShape): string {
  return [
    `sum ${s.summary ? 1 : 0}`,
    `exp ${s.experience}/${s.experienceBullets}`,
    `edu ${s.education}/${s.educationBullets}`,
    `skills ${s.skills}`,
    `proj ${s.projects}/${s.projectBullets}`,
    `cert ${s.certifications}`,
    `add ${s.additionalSections}/${s.additionalItems}`,
  ].join(", ");
}

/** One line saying whether every successful A run extracted a CV of the same shape. */
export function cvShapeSummary(shapes: CvShape[]): string {
  if (shapes.length === 0) return "CV shape: no successful runs.";
  const distinct = new Set(shapes.map(formatCvShape)).size;
  return distinct === 1
    ? `CV shape: identical across the ${shapes.length} successful runs.`
    : `CV shape: differs between runs (${distinct} distinct shapes in ${shapes.length} successful runs).`;
}

/* ---------- Experiment B: Job Profile stability ---------- */

export type ListStability = {
  runs: number;
  inAll: number;
  inSome: number;
  inOne: number;
  labelChanges: { text: string; runs: number; importances: string[]; kinds: string[] }[];
};

/** Matches Requirements across runs by normalised text. A Requirement counts once per run it appears in. */
export function listStability(profiles: Requirement[][]): ListStability {
  const byKey = new Map<string, { text: string; runs: number; importances: Set<string>; kinds: Set<string> }>();
  for (const requirements of profiles) {
    const seenInRun = new Set<string>();
    for (const r of requirements) {
      const key = normaliseText(r.text);
      const entry = byKey.get(key) ?? { text: r.text, runs: 0, importances: new Set(), kinds: new Set() };
      if (!seenInRun.has(key)) entry.runs++;
      seenInRun.add(key);
      entry.importances.add(r.importance);
      entry.kinds.add(r.kind);
      byKey.set(key, entry);
    }
  }
  const n = profiles.length;
  const entries = [...byKey.values()];
  return {
    runs: n,
    inAll: entries.filter((e) => e.runs === n).length,
    inSome: entries.filter((e) => e.runs > 1 && e.runs < n).length,
    inOne: entries.filter((e) => e.runs === 1).length,
    labelChanges: entries
      .filter((e) => e.runs > 1 && (e.importances.size > 1 || e.kinds.size > 1))
      .map((e) => ({ text: e.text, runs: e.runs, importances: [...e.importances].sort(), kinds: [...e.kinds].sort() })),
  };
}

/* ---------- Experiment C: Coverage verdict flips ---------- */

export type RequirementFlip = {
  id: string;
  importance: string;
  kind: string;
  text: string;
  counts: VerdictCounts;
  swing: number;
};

/** Score points a Requirement moves between its best and worst observed verdict: 100 × weight × (maxCredit − minCredit) / Σweights. */
export function scoreSwing(requirement: Requirement, verdicts: CoverageVerdict[], totalWeight: number): number {
  if (verdicts.length === 0 || totalWeight === 0) return 0;
  const credits = verdicts.map((v) => VERDICT_CREDITS[v]);
  return (100 * requirementWeight(requirement) * (Math.max(...credits) - Math.min(...credits))) / totalWeight;
}

export type CoverageAnalysis = {
  perRequirement: RequirementFlip[];
  flipped: RequirementFlip[];
  swingSum: number;
};

/** Tallies each Requirement's verdicts over repeated Coverage runs. `flipped` is sorted by swing, largest first. */
export function analyseCoverage(requirements: Requirement[], runs: Coverage[][]): CoverageAnalysis {
  const totalWeight = requirements.reduce((a, r) => a + requirementWeight(r), 0);
  const perRequirement = requirements.map((r) => {
    const seen: CoverageVerdict[] = [];
    const counts = emptyVerdicts();
    for (const run of runs) {
      const c = run.find((x) => x.requirementId === r.id);
      if (!c) continue;
      seen.push(c.verdict);
      counts[c.verdict]++;
    }
    return { id: r.id, importance: r.importance, kind: r.kind, text: r.text, counts, swing: scoreSwing(r, seen, totalWeight) };
  });
  const flipped = perRequirement.filter((f) => VERDICTS.filter((v) => f.counts[v] > 0).length > 1).sort((a, b) => b.swing - a.swing);
  return { perRequirement, flipped, swingSum: flipped.reduce((a, f) => a + f.swing, 0) };
}

/* ---------- Summary ---------- */

export const COVERAGE_DRIVEN_RATIO = 0.6;

export function summarise(aRange: number | undefined, cRange: number | undefined): string {
  const rule = `rule: Coverage-driven if C's range is at least ${COVERAGE_DRIVEN_RATIO * 100}% of A's`;
  if (aRange === undefined || cRange === undefined) return `Verdict: cannot tell, too few successful runs (${rule}).`;
  if (aRange === 0) return `Verdict: no spread in A, nothing to explain (${rule}).`;
  const ratio = cRange / aRange;
  const pct = `C range ${cRange.toFixed(1)} vs A range ${aRange.toFixed(1)}, ${(ratio * 100).toFixed(0)}%`;
  return ratio >= COVERAGE_DRIVEN_RATIO
    ? `Verdict: the spread looks driven by Coverage verdicts (${pct}; ${rule}).`
    : `Verdict: the spread looks driven by the Requirement list and CV extraction (${pct}; ${rule}).`;
}

/* ---------- Report ---------- */

export type EndToEndRun =
  | { ok: true; score: number; requirements: Requirement[]; coverage: Coverage[]; cvShape?: CvShape; softMismatches?: number }
  | { ok: false; error: string };

export type CoverageRun = { ok: true; coverage: Coverage[]; score: number } | { ok: false; error: string };

export type ReportInput = {
  runs: number;
  coverageRuns: number;
  endToEnd: EndToEndRun[];
  /** The Requirements Experiment C ran against (run 1's Job Profile), or undefined if no run produced one. */
  baseRequirements?: Requirement[];
  coverageOnly: CoverageRun[];
  /** Coverage calls per C run (majority vote). Stated in the C header when above 1. */
  votes?: number;
  /** Adds the cited Item IDs per C run for each flipped Requirement. Item IDs only, never reasons or CV text. */
  dumpEvidence?: boolean;
};

const f1 = (n: number) => n.toFixed(1);
const fmtCounts = (counts: Record<string, number>) =>
  Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ");
const statsLine = (s: Stats | undefined) =>
  s ? `n ${s.n}, min ${f1(s.min)}, max ${f1(s.max)}, range ${f1(s.range)}, mean ${f1(s.mean)}, stdev ${f1(s.stdev)}` : "no successful runs";

function failures(label: string, runs: { ok: boolean; error?: string }[]): string[] {
  const failed = runs.filter((r) => !r.ok);
  if (failed.length === 0) return [`${label}: ${runs.length}/${runs.length} runs succeeded.`];
  const names = new Map<string, number>();
  for (const r of failed) names.set(r.error ?? "Error", (names.get(r.error ?? "Error") ?? 0) + 1);
  const list = [...names].map(([name, n]) => `${name} x${n}`).join(", ");
  return [`${label}: ${runs.length - failed.length}/${runs.length} runs succeeded, ${failed.length} failed (${list}).`];
}

/** Per flipped Requirement, what each C run cited (Item IDs only), then whether met and partially_met runs cite the same Items. */
export function evidenceSection(flipped: RequirementFlip[], coverageOnly: CoverageRun[]): string[] {
  const lines = ["### Evidence per run for flipped Requirements", ""];
  if (flipped.length === 0) return [...lines, "None: no flipped Requirements."];
  const set = (ids: Set<string>) => `{${[...ids].sort().join(", ")}}`;
  const summaries: string[] = [];
  for (const f of flipped) {
    lines.push(`#### ${f.id}: ${cell(f.text)}`, "", "| Run | Verdict | Cited Items | Claims only |", "|---|---|---|---|");
    const cited: Record<CoverageVerdict, Set<string>> = { met: new Set(), partially_met: new Set(), unmet: new Set() };
    const seen = new Set<CoverageVerdict>();
    coverageOnly.forEach((run, i) => {
      const c = run.ok ? run.coverage.find((x) => x.requirementId === f.id) : undefined;
      if (!c) return;
      seen.add(c.verdict);
      for (const id of c.evidenceIds) cited[c.verdict].add(id);
      const claimsOnly = c.evidenceIds.length === 0 ? "—" : c.evidenceIds.every(isClaimId) ? "yes" : "no";
      lines.push(`| ${i + 1} | ${c.verdict} | ${c.evidenceIds.join(", ")} | ${claimsOnly} |`);
    });
    lines.push("");
    if (!seen.has("met") || !seen.has("partially_met")) {
      summaries.push(`- ${f.id}: no met versus partial comparison (verdicts seen: ${VERDICTS.filter((v) => seen.has(v)).join(", ")})`);
    } else {
      const [m, p] = [set(cited.met), set(cited.partially_met)];
      summaries.push(
        m === p
          ? `- ${f.id}: same evidence, different verdict (both cite ${m})`
          : `- ${f.id}: met runs cite ${m}, partial runs cite ${p} - different evidence`,
      );
    }
  }
  return [...lines, ...summaries];
}

export function renderReport(input: ReportInput): string {
  const okA = input.endToEnd.flatMap((r) => (r.ok ? [r] : []));
  const okC = input.coverageOnly.flatMap((r) => (r.ok ? [r] : []));
  const aStats = stats(okA.map((r) => r.score));
  const cStats = stats(okC.map((r) => r.score));
  const lines: string[] = ["# Match Score stability", ""];

  lines.push("## Experiment A: end to end", "", ...failures("A", input.endToEnd), "", `Score: ${statsLine(aStats)}`, "");
  if (okA.length > 0) {
    const withShape = okA.some((r) => r.cvShape);
    lines.push(
      `| Run | Score | Requirements | Importance | Kind | Verdicts (met / partial / unmet) |${withShape ? " CV Items (summary, entries/bullets, counts) | softMismatches |" : ""}`,
      `|---|---|---|---|---|---|${withShape ? "---|---|" : ""}`,
    );
    input.endToEnd.forEach((r, i) => {
      if (!r.ok) return void lines.push(`| ${i + 1} | failed | | | | |${withShape ? " | |" : ""}`);
      const v = countVerdicts(r.coverage);
      const shapeCells = withShape ? ` ${r.cvShape ? formatCvShape(r.cvShape) : ""} | ${r.softMismatches ?? ""} |` : "";
      lines.push(
        `| ${i + 1} | ${f1(r.score)} | ${r.requirements.length} | ${cell(fmtCounts(countBy(r.requirements, (x) => x.importance)))} | ${cell(fmtCounts(countBy(r.requirements, (x) => x.kind)))} | ${v.met} / ${v.partially_met} / ${v.unmet} |${shapeCells}`,
      );
    });
    lines.push("");
    if (withShape) lines.push(cvShapeSummary(okA.flatMap((r) => (r.cvShape ? [r.cvShape] : []))), "");
  }

  lines.push("## Experiment B: Job Profile", "");
  if (okA.length === 0) lines.push("No successful runs.", "");
  else {
    const counts = okA.map((r) => r.requirements.length);
    const cs = stats(counts)!;
    lines.push(`Requirement count: min ${cs.min}, max ${cs.max}, mean ${f1(cs.mean)}, stdev ${f1(cs.stdev)}.`, "");
    const ls = listStability(okA.map((r) => r.requirements));
    lines.push(
      `List stability over ${ls.runs} runs (Requirements matched by normalised text): ${ls.inAll} in all runs, ${ls.inSome} in some, ${ls.inOne} in only 1.`,
      "",
      "Exact text matching is a lower bound: a Requirement reworded between runs counts as two different ones, so real stability is at least this high.",
      "",
    );
    if (ls.labelChanges.length === 0) lines.push("Labels: no Requirement seen in several runs changed importance or kind.", "");
    else {
      lines.push(`Labels changed on ${ls.labelChanges.length} Requirement(s) seen in several runs:`, "", "| Requirement | Runs | Importance seen | Kind seen |", "|---|---|---|---|");
      for (const c of ls.labelChanges) lines.push(`| ${cell(c.text)} | ${c.runs} | ${c.importances.join(", ")} | ${c.kinds.join(", ")} |`);
      lines.push("");
    }
  }

  lines.push("## Experiment C: Coverage only", "", ...(input.votes && input.votes > 1 ? [`Votes per run: ${input.votes} Coverage calls, median verdict per Requirement (unmet < partially_met < met): the majority when there is one, partially_met when three calls all differ, the lower verdict of two.`, ""] : []), ...failures("C", input.coverageOnly), "", `Score: ${statsLine(cStats)}`, "");
  let analysis: CoverageAnalysis | undefined;
  if (input.baseRequirements && okC.length > 0) {
    analysis = analyseCoverage(input.baseRequirements, okC.map((r) => r.coverage));
    const range = cStats!.range;
    lines.push("### Verdicts per Requirement", "", "| Id | Importance | Kind | Requirement | met | partial | unmet |", "|---|---|---|---|---|---|---|");
    for (const f of analysis.perRequirement) {
      lines.push(`| ${f.id} | ${f.importance} | ${f.kind} | ${cell(f.text)} | ${f.counts.met} | ${f.counts.partially_met} | ${f.counts.unmet} |`);
    }
    lines.push("", `### Flipped Requirements (${analysis.flipped.length} of ${analysis.perRequirement.length}), by score swing`, "");
    if (analysis.flipped.length === 0) lines.push("None: every Requirement got the same verdict in every run.");
    else {
      lines.push("| Id | Importance | Kind | Requirement | met / partial / unmet | Swing (points) |", "|---|---|---|---|---|---|");
      for (const f of analysis.flipped) {
        lines.push(`| ${f.id} | ${f.importance} | ${f.kind} | ${cell(f.text)} | ${f.counts.met} / ${f.counts.partially_met} / ${f.counts.unmet} | ${f1(f.swing)} |`);
      }
      const share = range > 0 ? `${((analysis.swingSum / range) * 100).toFixed(0)}% of the observed range (${f1(range)} points)` : "the observed range is 0";
      lines.push("", `Swings add up to ${f1(analysis.swingSum)} points, ${share}. The sum can exceed 100% because flips rarely all land on the same run.`);
    }
    if (input.dumpEvidence) lines.push("", ...evidenceSection(analysis.flipped, input.coverageOnly));
    lines.push("");
  } else lines.push("No Coverage analysis: no Job Profile or no successful run.", "");

  lines.push("## Summary", "", `A score range: ${aStats ? f1(aStats.range) : "n/a"}. C score range: ${cStats ? f1(cStats.range) : "n/a"}.`, "");
  lines.push(summarise(aStats && aStats.n >= 2 ? aStats.range : undefined, cStats && cStats.n >= 2 ? cStats.range : undefined), "");
  return lines.join("\n");
}
