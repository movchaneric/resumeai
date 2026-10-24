// Dev script: runs Job Profile and CV extraction on local files against the configured model.
// No HTTP, no database. Run with `pnpm --filter backend extract <cv-file> <job-description-file> [--coverage] [--check]`.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import type { Cv } from "@resume-ai/shared";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import { extractCv } from "@/extraction/extractCv.js";
import { extractJobProfile } from "@/extraction/extractJobProfile.js";
import { assessCoverage } from "@/scoring/assessCoverage.js";
import { CoverageError } from "@/scoring/errors.js";
import { matchScore } from "@/scoring/matchScore.js";
import { LangChainLlmClient } from "@/llm/langChainLlmClient.js";
import { LlmSchemaError, LlmUnavailableError } from "@/llm/llmClient.js";
import { ApiError } from "@/utils/errors.js";
import { parseCv } from "@/parsing/parseCv.js";
import { loadConfig } from "@/utils/config.js";
import { setupTracing } from "@/utils/tracing.js";
import { CoverageKeySchema, ExpectedSchema, compareCoverageToKey, compareToExpected } from "./extractCheck.js";

const USAGE = `Usage: pnpm --filter backend extract <cv-file> <job-description-file> [--coverage] [--check]

  <cv-file>               PDF or DOCX
  <job-description-file>  plain text
  --coverage              after extraction, judge how well the CV covers each Requirement and print the score
  --check                 compare protected CV facts with <cv path without extension>.expected.json;
                          with --coverage, also compare verdicts with <job-description path without extension>.coverage.json
                          (a list of { "requirement": text, "verdict": "met" | "partially_met" | "unmet" }).
                          Coverage mismatches are warnings and do not change the exit code.

Paths are relative to the directory you ran pnpm from (pnpm sets INIT_CWD), or absolute.
Reads backend/.env. DATABASE_URL is not needed here; a placeholder is used when it is unset.`;

const base = process.env.INIT_CWD ?? process.cwd();
const timed = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    console.log(`[${label}] ${((performance.now() - start) / 1000).toFixed(1)} s`);
  }
};

function describeError(error: unknown): string {
  const issues = error instanceof ExtractionError || error instanceof LlmSchemaError || error instanceof CoverageError ? error.issues : [];
  const name = error instanceof Error ? error.name : "Error";
  const message = error instanceof Error ? error.message : String(error);
  const known = [ExtractionError, LlmSchemaError, CoverageError, LlmUnavailableError, NoRequirementsError, ApiError].some((c) => error instanceof c);
  return [`${known ? name : `Unexpected ${name}`}: ${message}`, ...issues.map((i) => `  - ${i}`)].join("\n");
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const check = args.includes("--check");
  const coverageFlag = args.includes("--coverage");
  const [cvArg, jdArg, ...rest] = args.filter((a) => a !== "--check" && a !== "--coverage");
  if (!cvArg || !jdArg || rest.length > 0) {
    console.error(USAGE);
    return 1;
  }
  const cvPath = resolve(base, cvArg);
  const jdPath = resolve(base, jdArg);

  let cvBuffer: Buffer;
  let jdText: string;
  try {
    cvBuffer = readFileSync(cvPath);
    jdText = readFileSync(jdPath, "utf8");
  } catch (error) {
    console.error(`Cannot read input: ${(error as Error).message}`);
    return 1;
  }
  let expected;
  if (check) {
    const expectedPath = resolve(cvPath, "..", `${basename(cvPath, extname(cvPath))}.expected.json`);
    try {
      expected = ExpectedSchema.parse(JSON.parse(readFileSync(expectedPath, "utf8")));
    } catch (error) {
      console.error(`Cannot use the answer key ${expectedPath}:\n${(error as Error).message}`);
      return 1;
    }
  }

  let coverageKey;
  if (check && coverageFlag) {
    const keyPath = resolve(jdPath, "..", `${basename(jdPath, extname(jdPath))}.coverage.json`);
    try {
      coverageKey = CoverageKeySchema.parse(JSON.parse(readFileSync(keyPath, "utf8")));
    } catch (error) {
      console.error(`Cannot use the coverage key ${keyPath}:\n${(error as Error).message}`);
      return 1;
    }
  }

  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  const config = loadConfig();
  const provider = setupTracing(config);
  const llm = new LangChainLlmClient(config.llm);
  const coverageLlm = new LangChainLlmClient({ ...config.llm, model: config.llm.coverageModel });
  console.log(`models: extraction ${config.llm.model}, coverage ${config.llm.coverageModel}`);

  try {
    const cvText = await parseCv(cvBuffer, config.limits);
    console.log(`----- CV TEXT (${cvText.length} chars) -----\n${cvText}\n----- END CV TEXT -----\n`);

    const jobProfile = await timed("extractJobProfile", () => extractJobProfile(llm, jdText));
    console.log(`----- JOB PROFILE -----\n${JSON.stringify(jobProfile, null, 2)}\n`);

    const { cv, softMismatches } = await timed("extractCv", () => extractCv(llm, cvText));
    console.log(`----- CV -----\n${JSON.stringify(cv, null, 2)}\n`);
    console.log(`softMismatches: ${softMismatches}`);

    if (coverageFlag) {
      const { coverage, downgrades } = await timed("assessCoverage", () => assessCoverage(coverageLlm, cv as Cv, jobProfile.requirements));
      console.log("----- COVERAGE -----");
      for (const requirement of jobProfile.requirements) {
        const c = coverage.find((x) => x.requirementId === requirement.id);
        console.log(`${requirement.id} [${requirement.importance}] ${requirement.text}`);
        console.log(`  verdict: ${c?.verdict ?? "missing"}  evidence: ${c && c.evidenceIds.length > 0 ? c.evidenceIds.join(", ") : "none"}`);
        console.log(`  reason: ${c?.reason ?? ""}`);
      }
      const score = matchScore(jobProfile.requirements, coverage);
      console.log(`downgrades: ${downgrades}`);
      console.log(`score: ${Math.round(score)} (unrounded ${score})\n`);
      if (coverageKey) {
        const warnings = compareCoverageToKey(jobProfile.requirements, coverage, coverageKey);
        if (warnings.length === 0) console.log("--check: coverage verdicts match the key");
        else console.warn(`--check: ${warnings.length} coverage warning(s)\n${warnings.map((m) => `  ${m}`).join("\n")}`);
      }
    }

    if (expected) {
      const mismatches = compareToExpected(cv as Cv, expected);
      if (mismatches.length === 0) console.log("--check: all protected facts match");
      else {
        console.error(`--check: ${mismatches.length} mismatch(es)\n${mismatches.map((m) => `  ${m}`).join("\n")}`);
        return 1;
      }
    }
    return 0;
  } catch (error) {
    console.error(describeError(error));
    return 1;
  } finally {
    await provider?.shutdown().catch(() => undefined);
  }
}

process.exitCode = await main();
