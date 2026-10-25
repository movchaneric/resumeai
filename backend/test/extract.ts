// Dev script: runs Job Profile and CV extraction on local files against the configured model.
// No HTTP, no database. Run with `pnpm --filter backend extract <cv-file> <job-description-file> [--coverage] [--tailor] [--check]`.
// All the work runs under one `pipeline` span, so its chains group as one trace in Phoenix.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import type { Coverage, Cv, JobProfile } from "@resume-ai/shared";
import type { z } from "zod";
import type { RunSnapshot } from "@/services/runs.js";
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
import { formatCoverage, formatOutcome, formatRound, parseDevArgs, runInPipelineSpan, runTailorInMemory } from "./extractReport.js";

const USAGE = `Usage: pnpm --filter backend extract <cv-file> <job-description-file> [--coverage] [--tailor] [--check]

  <cv-file>               PDF or DOCX
  <job-description-file>  plain text
  --coverage              after extraction, judge how well the CV covers each Requirement (with its kind) and print the score
  --tailor                implies --coverage; run the whole Run graph in memory (no HTTP, no database) and print each
                          round: proposed Changes, rejections with stage and reason, the kept score, then the exit
                          reason and the score before and after. Extraction uses LLM_MODEL, the rest LLM_JUDGE_MODEL.
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
  const parsed = parseDevArgs(args);
  if (!parsed.ok) {
    console.error(USAGE);
    return 1;
  }
  const { cvArg, jdArg, check, tailor, coverage: coverageFlag } = parsed;
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
  let expected: z.infer<typeof ExpectedSchema> | undefined;
  if (check) {
    const expectedPath = resolve(cvPath, "..", `${basename(cvPath, extname(cvPath))}.expected.json`);
    try {
      expected = ExpectedSchema.parse(JSON.parse(readFileSync(expectedPath, "utf8")));
    } catch (error) {
      console.error(`Cannot use the answer key ${expectedPath}:\n${(error as Error).message}`);
      return 1;
    }
  }

  let coverageKey: z.infer<typeof CoverageKeySchema> | undefined;
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
  const judgeLlm = new LangChainLlmClient({ ...config.llm, model: config.llm.judgeModel });
  console.log(`models: extraction ${config.llm.model}, judge ${config.llm.judgeModel}`);

  try {
    return await runInPipelineSpan(async () => {
      const cvText = await parseCv(cvBuffer, config.limits);
      console.log(`----- CV TEXT (${cvText.length} chars) -----\n${cvText}\n----- END CV TEXT -----\n`);

      let jobProfile: JobProfile;
      let cv: Cv;
      let coverage: Coverage[] | undefined;
      let score: number | undefined;
      let tailored: RunSnapshot | undefined;
      if (tailor) {
        tailored = await timed("run graph", () =>
          runTailorInMemory({
            llm,
            judgeLlm,
            cvText,
            jobDescriptionText: jdText,
            onRound: (round) => console.log(`${formatRound(round).join("\n")}\n`),
          }),
        );
        jobProfile = tailored.jobProfile!;
        cv = tailored.cv!;
        coverage = tailored.coverageBefore!;
        score = tailored.scoreBefore!;
        console.log(`----- JOB PROFILE -----\n${JSON.stringify(jobProfile, null, 2)}\n`);
        console.log(`----- CV -----\n${JSON.stringify(cv, null, 2)}\n`);
      } else {
        jobProfile = await timed("extractJobProfile", () => extractJobProfile(llm, jdText));
        console.log(`----- JOB PROFILE -----\n${JSON.stringify(jobProfile, null, 2)}\n`);

        const extracted = await timed("extractCv", () => extractCv(llm, cvText));
        cv = extracted.cv as Cv;
        console.log(`----- CV -----\n${JSON.stringify(cv, null, 2)}\n`);
        console.log(`softMismatches: ${extracted.softMismatches}`);

        if (coverageFlag) {
          const assessed = await timed("assessCoverage", () => assessCoverage(judgeLlm, cv, jobProfile.requirements));
          coverage = assessed.coverage;
          score = matchScore(jobProfile.requirements, coverage);
          console.log(`downgrades: ${assessed.downgrades}`);
        }
      }

      if (coverage && score !== undefined) {
        console.log(`----- COVERAGE${tailor ? " (before tailoring)" : ""} -----`);
        console.log(formatCoverage(jobProfile.requirements, coverage).join("\n"));
        console.log(`score: ${Math.round(score)} (unrounded ${score})\n`);
        if (coverageKey) {
          const warnings = compareCoverageToKey(jobProfile.requirements, coverage, coverageKey);
          if (warnings.length === 0) console.log("--check: coverage verdicts match the key");
          else console.warn(`--check: ${warnings.length} coverage warning(s)\n${warnings.map((m) => `  ${m}`).join("\n")}`);
        }
      }

      if (tailored) {
        console.log(formatOutcome(tailored).join("\n") + "\n");
        console.log(`----- COVERAGE (after tailoring) -----\n${formatCoverage(jobProfile.requirements, tailored.coverage ?? []).join("\n")}\n`);
      }

      if (expected) {
        const mismatches = compareToExpected(cv, expected);
        if (mismatches.length === 0) console.log("--check: all protected facts match");
        else {
          console.error(`--check: ${mismatches.length} mismatch(es)\n${mismatches.map((m) => `  ${m}`).join("\n")}`);
          return 1;
        }
      }
      return 0;
    });
  } catch (error) {
    console.error(describeError(error));
    return 1;
  } finally {
    await provider?.shutdown().catch(() => undefined);
  }
}

process.exitCode = await main();
