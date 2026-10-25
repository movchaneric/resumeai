// Dev script: measures why the Match Score varies on identical input (issue #18). Calls a real model.
// Run with `pnpm --filter backend stability <cv-file> <job-description-file> [--runs N] [--coverage-runs M] [--parallel K] [--out <file>]`.
// The markdown report goes to stdout (and to --out); progress goes to stderr. The report never contains CV text.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Cv, RunId } from "@resume-ai/shared";
import { extractCv } from "@/extraction/extractCv.js";
import { extractJobProfile } from "@/extraction/extractJobProfile.js";
import { assessCoverage } from "@/scoring/assessCoverage.js";
import { matchScore } from "@/scoring/matchScore.js";
import { LangChainLlmClient } from "@/llm/langChainLlmClient.js";
import { parseCv } from "@/parsing/parseCv.js";
import { loadConfig } from "@/utils/config.js";
import { setupTracing } from "@/utils/tracing.js";
import { runInPipelineSpan } from "./extractReport.js";
import { mapPool, parseStabilityArgs, renderReport, type CoverageRun, type EndToEndRun } from "./stabilityReport.js";

const USAGE = `Usage: pnpm --filter backend stability <cv-file> <job-description-file> [--runs N] [--coverage-runs M] [--parallel K] [--out <file>]

  <cv-file>               PDF or DOCX
  <job-description-file>  plain text
  --runs N                end-to-end runs for experiments A and B (default 5)
  --coverage-runs M       Coverage-only runs for experiment C, on run 1's Job Profile and CV (default 10)
  --parallel K            at most K model calls in flight (default 3)
  --out <file>            also write the markdown report to this file

Paths are relative to the directory you ran pnpm from (pnpm sets INIT_CWD), or absolute.
Reads backend/.env. DATABASE_URL is not needed; a placeholder is used when it is unset.
The report holds Requirement text and Item IDs only, never CV text.`;

const base = process.env.INIT_CWD ?? process.cwd();

/** Only the error class name goes in the report: messages can echo model output. */
const errorName = (error: unknown) => (error instanceof Error ? error.name : "Error");

async function main(): Promise<number> {
  const parsed = parseStabilityArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(USAGE);
    return 1;
  }
  const { cvArg, jdArg, runs, coverageRuns, parallel, out } = parsed;

  let cvBuffer: Buffer;
  let jdText: string;
  try {
    cvBuffer = readFileSync(resolve(base, cvArg));
    jdText = readFileSync(resolve(base, jdArg), "utf8");
  } catch (error) {
    console.error(`Cannot read input: ${(error as Error).message}`);
    return 1;
  }

  process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  const config = loadConfig();
  const provider = setupTracing(config);
  const llm = new LangChainLlmClient(config.llm);
  const judgeLlm = new LangChainLlmClient({ ...config.llm, model: config.llm.judgeModel });
  console.error(`models: extraction ${config.llm.model} (Job Profile ${config.llm.judgeModel}), judge ${config.llm.judgeModel}`);

  const start = performance.now();
  const progress = (label: string, done: number, total: number) =>
    console.error(`${label} ${done}/${total} done, ${Math.round((performance.now() - start) / 1000)} s`);

  try {
    return await runInPipelineSpan(randomUUID() as RunId, async () => {
      const cvText = await parseCv(cvBuffer, config.limits);

      let doneA = 0;
      const cvs: (Cv | undefined)[] = [];
      const endToEnd = await mapPool<EndToEndRun>(runs, parallel, async (i) => {
        try {
          const { requirements } = await extractJobProfile(judgeLlm, jdText);
          const { cv } = await extractCv(llm, cvText);
          const { coverage } = await assessCoverage(judgeLlm, cv as Cv, requirements);
          cvs[i] = cv as Cv;
          return { ok: true, score: matchScore(requirements, coverage), requirements, coverage };
        } catch (error) {
          return { ok: false, error: errorName(error) };
        } finally {
          progress("A", ++doneA, runs);
        }
      });

      const baseIndex = endToEnd.findIndex((r, i) => r.ok && cvs[i]);
      const baseRun = baseIndex >= 0 ? endToEnd[baseIndex] : undefined;
      const baseRequirements = baseRun?.ok ? baseRun.requirements : undefined;
      const baseCv = baseIndex >= 0 ? cvs[baseIndex] : undefined;

      let coverageOnly: CoverageRun[] = [];
      if (baseRequirements && baseCv) {
        let doneC = 0;
        coverageOnly = await mapPool<CoverageRun>(coverageRuns, parallel, async () => {
          try {
            const { coverage } = await assessCoverage(judgeLlm, baseCv, baseRequirements);
            return { ok: true, coverage, score: matchScore(baseRequirements, coverage) };
          } catch (error) {
            return { ok: false, error: errorName(error) };
          } finally {
            progress("C", ++doneC, coverageRuns);
          }
        });
      } else console.error("C skipped: no end-to-end run succeeded");

      const report = renderReport({ runs, coverageRuns, endToEnd, baseRequirements, coverageOnly });
      console.log(report);
      if (out) {
        writeFileSync(resolve(base, out), report + "\n");
        console.error(`report written to ${resolve(base, out)}`);
      }
      return 0;
    });
  } catch (error) {
    console.error(`Unexpected ${errorName(error)}`);
    return 1;
  } finally {
    await provider?.shutdown().catch(() => undefined);
  }
}

process.exitCode = await main();
