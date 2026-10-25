import { describe, expect, it } from "vitest";
import { testDatabaseName } from "./globalSetup.js";

describe("testDatabaseName", () => {
  it("keeps the main checkout's database name", () => {
    expect(testDatabaseName("/Users/me/projects/resume-ai")).toBe("resume_ai_test");
  });

  it("gives a worktree its own name", () => {
    expect(testDatabaseName("/Users/me/projects/resume-ai-wt-05")).toBe("resume_ai_wt_05_test");
  });

  it("lowercases and collapses runs of other characters", () => {
    expect(testDatabaseName("/x/My Repo--v2.0")).toBe("my_repo_v2_0_test");
  });
});
