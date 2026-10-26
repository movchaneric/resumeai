// Dev script: measures why the Match Score varies on identical input (issue #18). Calls a real model.
// Run with `pnpm --filter backend stability <cv-file> <job-description-file> [--runs N] [--coverage-runs M] [--parallel K] [--votes N] [--out <file>] [--no-cache] [--dump-evidence]`.
// The markdown report goes to stdout (and to --out); progress goes to stderr. The report never contains CV text.
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Coverage, Cv, JobProfile, RunId } from "@resume-ai/shared";
import { extractCv } from "@/extraction/extractCv.js";
import { extractJobProfile } from "@/extraction/extractJobProfile.js";
import { resolveJobProfile } from "@/graph/jobProfileCache.js";
import { JobProfileStore } from "@/stores/jobProfiles.js";
import { createPrisma } from "@/utils/db.js";
import { assessCoverage } from "@/scoring/assessCoverage.js";
import { matchScore } from "@/scoring/matchScore.js";
import { LangChainLlmClient } from "@/llm/langChainLlmClient.js";
import { parseCv } from "@/parsing/parseCv.js";
import { loadConfig } from "@/utils/config.js";
import { setupTracing } from "@/utils/tracing.js";
import { runInPipelineSpan } from "./extractReport.js";
import { cvShape, mapPool, parseStabilityArgs, renderReport, voteCoverage, type CoverageRun, type EndToEndRun } from "./stabilityReport.js";

const USAGE = `Usage: pnpm --filter backend stability <cv-file> <job-description-file> [--runs N] [--coverage-runs M] [--parallel K] [--votes N] [--out <file>] [--no-cache] [--dump-evidence]

  <cv-file>               PDF or DOCX
  <job-description-file>  plain text
  --runs N                end-to-end runs for experiments A and B (default 5)
  --coverage-runs M       Coverage-only runs for experiment C, on run 1's Job Profile and CV (default 10)
  --votes N               odd N: each experiment C run makes N Coverage calls and keeps the majority verdict per Requirement
                          (no strict majority gives partially_met; evidence IDs come from the first call giving the winning
                          verdict). The report then uses the voted verdicts (default 1: one call, no vote)
  --parallel K            at most K model calls in flight (default 3)
  --out <file>            also write the markdown report to this file
  --no-cache              extract a fresh Job Profile in every run of experiment A (the behaviour before the cache).
                          Without it, experiment A reads the Job Profile through the real cache (needs the database):
                          the first run misses and extracts, the later runs hit. A profile cached by an earlier
                          run of this script, less than 7 days ago, is hit by run 1 too.
  --dump-evidence         add a section listing, for each flipped Requirement, the Item IDs each Coverage run cited
                          and whether met and partially_met runs cite the same Items (IDs only, no reasons or CV text)

Paths are relative to the directory you ran pnpm from (pnpm sets INIT_CWD), or absolute.
Reads backend/.env. DATABASE_URL is needed unless --no-cache is given (a placeholder is used then).
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
  const { cvArg, jdArg, runs, coverageRuns, parallel, votes, out, noCache, dumpEvidence } = parsed;

  let cvBuffer: Buffer;
  let jdText: string;
  try {
    cvBuffer = readFileSync(resolve(base, cvArg));
    jdText = readFileSync(resolve(base, jdArg), "utf8");
  } catch (error) {
    console.error(`Cannot read input: ${(error as Error).message}`);
    return 1;
  }

  if (noCache) process.env.DATABASE_URL ??= "postgresql://unused:unused@localhost:5432/unused";
  const config = loadConfig();
  const provider = setupTracing(config);
  const llm = new LangChainLlmClient(config.llm);
  const judgeLlm = new LangChainLlmClient({ ...config.llm, model: config.llm.judgeModel });
  const prisma = noCache ? undefined : createPrisma(config.databaseUrl);
  const jobProfileCache = prisma ? new JobProfileStore(prisma, { ttlMs: config.runTtlMs }) : undefined;
  const profileOf = (): Promise<JobProfile> =>
    jobProfileCache
      ? resolveJobProfile({ cache: jobProfileCache, judgeLlm, judgeModel: config.llm.judgeModel }, jdText)
      : extractJobProfile(judgeLlm, jdText);
  console.error(`models: extraction ${config.llm.model} (Job Profile ${config.llm.judgeModel}), judge ${config.llm.judgeModel}`);

  const start = performance.now();
  const progress = (label: string, done: number, total: number) =>
    console.error(`${label} ${done}/${total} done, ${Math.round((performance.now() - start) / 1000)} s`);

  try {
    return await runInPipelineSpan(randomUUID() as RunId, async () => {
      const cvText = await parseCv(cvBuffer, config.limits);

      // With the cache, run 1 must be the one that misses: fill the cache before the parallel runs start.
      if (jobProfileCache) await profileOf();

      let doneA = 0;
      const cvs: (Cv | undefined)[] = [];
      const endToEnd = await mapPool<EndToEndRun>(runs, parallel, async (i) => {
        try {
          const { requirements } = await profileOf();
          const { cv, softMismatches } = await extractCv(llm, cvText);
          const { coverage } = await assessCoverage(judgeLlm, cv as Cv, requirements);
          cvs[i] = cv as Cv;
          return { ok: true, score: matchScore(requirements, coverage), requirements, coverage, cvShape: cvShape(cv as Cv), softMismatches };
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
        // Every Coverage call (coverageRuns x votes) goes through one pool, so --parallel caps the model calls in flight.
        let doneC = 0;
        const calls = await mapPool<{ ok: true; coverage: Coverage[] } | { ok: false; error: string }>(coverageRuns * votes, parallel, async () => {
          try {
            return { ok: true, coverage: (await assessCoverage(judgeLlm, baseCv, baseRequirements)).coverage };
          } catch (error) {
            return { ok: false, error: errorName(error) };
          } finally {
            progress("C", ++doneC, coverageRuns * votes);
          }
        });
        coverageOnly = Array.from({ length: coverageRuns }, (_, r): CoverageRun => {
          const group = calls.slice(r * votes, (r + 1) * votes);
          const failed = group.find((c) => !c.ok);
          if (failed && !failed.ok) return { ok: false, error: failed.error };
          const answers = group.flatMap((c) => (c.ok ? [c.coverage] : []));
          const coverage = votes === 1 ? answers[0]! : voteCoverage(answers);
          return { ok: true, coverage, score: matchScore(baseRequirements, coverage) };
        });
      } else console.error("C skipped: no end-to-end run succeeded");

      const report = renderReport({ runs, coverageRuns, votes, endToEnd, baseRequirements, coverageOnly, dumpEvidence });
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
    await prisma?.$disconnect().catch(() => undefined);
  }
}

process.exitCode = await main();
