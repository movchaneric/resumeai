import { describe, expect, it } from "vitest";
import type { ExtractedJobProfile } from "@resume-ai/shared";
import { JOB_PROFILE_SYSTEM_PROMPT, extractJobProfile } from "@/extraction/extractJobProfile.js";
import { ExtractionError, NoRequirementsError } from "@/extraction/errors.js";
import { LlmSchemaError, LlmUnavailableError } from "@/llm/llmClient.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";

const NAME = "extract_job_profile";

const extracted: ExtractedJobProfile = {
  title: "Backend Engineer",
  company: "Acme",
  requirements: [
    { text: "Node.js, 5+ years", source: "5+ years of Node.js", kind: "skill", importance: "must_have" },
    { text: "PostgreSQL", source: "Experience with PostgreSQL", kind: "skill", importance: "nice_to_have" },
    { text: "Own deployments", source: "You will own deployments", kind: "responsibility", importance: "must_have" },
  ],
};

describe("extractJobProfile", () => {
  it("returns a Job Profile with req1..reqN IDs after one call", async () => {
    const llm = new FakeLlmClient().enqueue(NAME, extracted);

    const profile = await extractJobProfile(llm, "job text");

    expect(profile.title).toBe("Backend Engineer");
    expect(profile.requirements.map((r) => r.id)).toEqual(["req1", "req2", "req3"]);
    expect(profile.requirements[1]?.text).toBe("PostgreSQL");
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.messages.at(-1)).toEqual({ role: "user", content: "job text" });
    expect(llm.calls[0]?.messages[0]?.role).toBe("system");
  });

  it("retries once with the issues when the first answer is invalid", async () => {
    const llm = new FakeLlmClient().enqueue(
      NAME,
      new LlmSchemaError("bad", ["requirements.0.kind: Invalid enum value"]),
      extracted,
    );

    const profile = await extractJobProfile(llm, "job text");

    expect(profile.requirements).toHaveLength(3);
    expect(llm.calls).toHaveLength(2);
    const retryMessages = llm.calls[1]!.messages;
    expect(retryMessages.slice(0, llm.calls[0]!.messages.length)).toEqual(llm.calls[0]!.messages);
    const last = retryMessages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toContain("requirements.0.kind: Invalid enum value");
  });

  it("throws ExtractionError with the issues after two schema errors", async () => {
    const llm = new FakeLlmClient().enqueue(
      NAME,
      new LlmSchemaError("bad", ["a: wrong"]),
      new LlmSchemaError("bad again", ["b: still wrong"]),
    );

    const error = await extractJobProfile(llm, "job text").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as ExtractionError).issues).toEqual(["b: still wrong"]);
    expect(llm.calls).toHaveLength(2);
  });

  it("throws NoRequirementsError without retrying when there are no requirements", async () => {
    const llm = new FakeLlmClient().enqueue(NAME, { ...extracted, requirements: [] });

    await expect(extractJobProfile(llm, "job text")).rejects.toBeInstanceOf(NoRequirementsError);
    expect(llm.calls).toHaveLength(1);
  });

  it("lets LlmUnavailableError propagate without retrying", async () => {
    const llm = new FakeLlmClient().enqueue(NAME, new LlmUnavailableError("down"));

    await expect(extractJobProfile(llm, "job text")).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(llm.calls).toHaveLength(1);
  });
});

describe("JOB_PROFILE_SYSTEM_PROMPT", () => {
  it("offers the soft_skill kind and keeps duties as responsibility", () => {
    expect(JOB_PROFILE_SYSTEM_PROMPT).toContain("responsibility, soft_skill, other");
    expect(JOB_PROFILE_SYSTEM_PROMPT).toContain("Duties stay \"responsibility\"");
  });
});
