import { describe, expect, it } from "vitest";
import type { RunId } from "@resume-ai/shared";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { makeGraphRunner } from "../fakes/runGraph.js";
import { assignCvIds } from "@/extraction/assignIds.js";
import { extractedCv } from "../runFixtures.js";

describe("LangGraphRunner.read on an older checkpoint", () => {
  it("reads a CV checkpointed without a headline as null", async () => {
    const runner = makeGraphRunner({ setStatus: async () => {} }, new FakeLlmClient());
    const cv = assignCvIds(extractedCv);
    const { headline: _omit, ...oldContact } = cv.contact;
    const oldState = { createdAt: "2026-01-01T00:00:00Z", next: [], tasks: [], values: { cv: { ...cv, contact: oldContact } } };
    // Stands in for the graph reading a checkpoint written before `headline` existed.
    (runner as unknown as { graph: { getState: () => Promise<unknown> } }).graph.getState = async () => oldState;

    const snapshot = await runner.read("11111111-1111-4111-8111-111111111111" as RunId);
    expect(snapshot?.cv?.contact.headline).toBe(null);
  });
});
