import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import { createMemoryCheckpointer } from "@/graph/memoryCheckpointer.js";
import { NODE_STATUS, buildRunGraph } from "@/graph/runGraph.js";
import { parseCv } from "@/parsing/parseCv.js";
import { loadConfig } from "@/utils/config.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { FakeJobProfileCache } from "../fakes/jobProfileCache.js";
import { extractedCv, extractedJob } from "../runFixtures.js";

const config = loadConfig({ DATABASE_URL: "x", OPENAI_API_KEY: "k" });
const cvText = await parseCv(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../fixtures/cv.pdf")), config.limits);

const job = {
  ...extractedJob,
  requirements: [
    { text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" },
    { text: "PostgreSQL", source: "PostgreSQL", kind: "skill", importance: "must_have" },
    { text: "Docker", source: "Docker", kind: "skill", importance: "nice_to_have" },
  ],
};
const verdicts = (...v: ("met" | "unmet")[]) => ({
  verdicts: v.map((verdict, i) => ({ requirementId: `req${i + 1}`, reason: "r", evidenceIds: verdict === "met" ? ["exp1.b1"] : [], verdict })),
});
const addSkill = (text: string, req: string) => ({
  op: "add", targetItemId: null, parentId: "skills", text, orderedItemIds: null, evidenceIds: ["exp1.b1"], requirementIds: [req], rationale: "Closer",
});

describe("a failing status write inside a tailoring round", () => {
  it.each(["begin_round", "tailor", "validate", "rejudge"] as const)(
    "in round 2 at %s ends the Run with exit reason error and keeps round 1",
    async (failingNode) => {
      const judge = new FakeLlmClient()
        .enqueue("extract_job_profile", job)
        .enqueueVoted("assess_coverage", verdicts("met", "unmet", "unmet"))
        .enqueue("tailor", { changes: [addSkill("PostgreSQL", "req2")] })
        .enqueue("claim_check", { verdicts: [{ id: "r1.c1", reason: "r", verdict: "supported" }] })
        .enqueueVoted("assess_coverage", { verdicts: [verdicts("met", "met").verdicts[1]] })
        .enqueue("tailor", { changes: [addSkill("Docker", "req3")] })
        .enqueue("claim_check", { verdicts: [{ id: "r2.c1", reason: "r", verdict: "supported" }] })
        .enqueueVoted("assess_coverage", { verdicts: [verdicts("met", "met", "met").verdicts[2]] });
      const llm = new FakeLlmClient().enqueue("extract_cv", extractedCv);
      let begun = 0;
      const graph = buildRunGraph({
        llm,
        judgeLlm: judge,
        judgeModel: "test-judge",
        jobProfileCache: new FakeJobProfileCache(),
        checkpointer: createMemoryCheckpointer(),
        onEnter: async (_runId, node) => {
          if (node === "begin_round") begun++;
          if (node === failingNode && begun === 2) throw new Error("db down");
        },
      });
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const config = { configurable: { thread_id: "run-1" } };
        await graph.invoke({ runId: "run-1", cvText, jobDescriptionText: "Backend developer" }, config);
        // The unmet must-haves pause the graph for Answers; this test is about the rounds, so skip every Question.
        const state = await graph.invoke(new Command({ resume: [] }), config);
        expect(state.exitReason).toBe("error");
        expect(state.changes.map((c) => c.id)).toEqual(["r1.c1"]);
        expect(state.scoreAfter).toBeGreaterThan(state.scoreBefore!);
      } finally {
        spy.mockRestore();
      }
    },
  );

  it("maps every node to a status", () => {
    expect(NODE_STATUS).toEqual({
      extract: "extracting",
      assess_coverage: "extracting",
      collect_answers: "awaiting_answers",
      begin_round: "tailoring",
      tailor: "tailoring",
      validate: "tailoring",
      rejudge: "tailoring",
      review: "awaiting_review",
    });
  });
});
