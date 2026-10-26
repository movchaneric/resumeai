import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ChangeSchema,
  CvSchema,
  DateRangeSchema,
  ExtractedCvSchema,
  ExtractedJobProfileSchema,
  ItemIdSchema,
  PartialDateSchema,
  RequirementIdSchema,
  ExitReasonSchema,
  RunIdSchema,
  RunViewSchema,
  normalizeDateRange,
  type ItemId,
  type RequirementId,
} from "./index.js";

const RUN_ID = "3f2b8c1e-5a47-4d6e-9b0a-1c2d3e4f5a6b";
const dates: { start: string | null; end: string | null; current: boolean } = {
  start: "2021-03",
  end: null,
  current: true,
};

describe("dates", () => {
  it("accepts YYYY and YYYY-MM", () => {
    expect(DateRangeSchema.safeParse({ start: "2019", end: "2021-12", current: false }).success).toBe(true);
  });
  it("rejects free-form dates", () => {
    expect(DateRangeSchema.safeParse({ start: "Jan 2021", end: null, current: true }).success).toBe(false);
    expect(DateRangeSchema.safeParse({ start: "2021-13", end: null, current: true }).success).toBe(false);
  });
  it("rejects a current range that has an end date", () => {
    expect(DateRangeSchema.safeParse({ start: "2021-03", end: "2022-01", current: true }).success).toBe(false);
  });
  it("rejects an end before the start", () => {
    expect(DateRangeSchema.safeParse({ start: "2022-05", end: "2021-01", current: false }).success).toBe(false);
  });
  it("compares bare years by their full span", () => {
    expect(DateRangeSchema.safeParse({ start: "2021-06", end: "2021", current: false }).success).toBe(true);
    expect(DateRangeSchema.safeParse({ start: "2021", end: "2021-01", current: false }).success).toBe(true);
    expect(DateRangeSchema.safeParse({ start: "2021-06", end: "2020", current: false }).success).toBe(false);
  });
  it("emits a JSON schema without \\d, which Ollama's grammar converter rejects", () => {
    const json = JSON.stringify(z.toJSONSchema(PartialDateSchema));
    expect(json).not.toContain("\\d");
    expect(json).toContain("[0-9]");
  });
  it("normalizes a stray end date on a current range", () => {
    const fixed = normalizeDateRange({ start: "2021-03", end: "2022-01", current: true });
    expect(fixed.end).toBeNull();
    expect(DateRangeSchema.safeParse(fixed).success).toBe(true);
  });
});

describe("cv", () => {
  const extracted = {
    contact: { name: "A", email: null, phone: null, location: null, links: [] },
    summary: null,
    experience: [{ company: "Acme", title: "Dev", location: null, dates, bullets: ["Built APIs"] }],
    education: [],
    skills: ["TypeScript"],
    projects: [],
    certifications: [],
    additionalSections: [{ title: "Volunteering", items: ["Mentor"] }],
  };
  const withIds = {
    contact: { id: "contact", name: "A", email: null, phone: null, location: null, links: [] },
    summary: { id: "summary", text: "Backend dev" },
    experience: [
      { id: "exp-1", company: "Acme", title: "Dev", location: null, dates, bullets: [{ id: "exp-1-b1", text: "Built APIs" }] },
    ],
    education: [],
    skills: [{ id: "skill-1", text: "TypeScript" }],
    projects: [],
    certifications: [],
    additionalSections: [{ id: "extra-1", title: "Volunteering", items: [{ id: "extra-1-i1", text: "Mentor" }] }],
  };

  it("parses an extracted CV", () => {
    expect(ExtractedCvSchema.safeParse(extracted).success).toBe(true);
  });
  it("requires every field (nullable, not optional)", () => {
    const { summary: _omit, ...missing } = extracted;
    expect(ExtractedCvSchema.safeParse(missing).success).toBe(false);
  });
  it("does not refine dates in the extraction schema", () => {
    const sloppy = structuredClone(extracted);
    sloppy.experience[0]!.dates = { start: "2021-03", end: "2022-01", current: true };
    expect(ExtractedCvSchema.safeParse(sloppy).success).toBe(true);
  });
  it("parses a CV with stable IDs", () => {
    expect(CvSchema.safeParse(withIds).success).toBe(true);
  });
  it("requires IDs on the identified CV", () => {
    expect(CvSchema.safeParse(extracted).success).toBe(false);
  });
  it("rejects invalid dates on the identified CV", () => {
    const bad = structuredClone(withIds);
    bad.experience[0]!.dates = { start: "2021-03", end: "2022-01", current: true };
    expect(CvSchema.safeParse(bad).success).toBe(false);
  });
});

describe("job profile", () => {
  it("parses atomic requirements", () => {
    const job = {
      title: "Backend Engineer",
      company: null,
      requirements: [
        { text: "Node.js, 5+ years", source: "5+ years of Node.js", kind: "skill", importance: "must_have" },
      ],
    };
    expect(ExtractedJobProfileSchema.safeParse(job).success).toBe(true);
    job.requirements[0]!.importance = "required" as never;
    expect(ExtractedJobProfileSchema.safeParse(job).success).toBe(false);
  });

  it("accepts the soft_skill kind", () => {
    const job = {
      title: null,
      company: null,
      requirements: [{ text: "Ownership", source: "You take ownership", kind: "soft_skill", importance: "must_have" }],
    };
    expect(ExtractedJobProfileSchema.safeParse(job).success).toBe(true);
  });
});

describe("change", () => {
  const common = {
    id: "chg-1",
    rationale: "r",
    evidenceIds: ["exp-1-b1"],
    requirementIds: ["req-1"],
    status: "proposed",
  };
  it("accepts replace, add, reorder", () => {
    expect(ChangeSchema.safeParse({ ...common, op: "replace", targetItemId: "exp-1-b1", before: "a", after: "b" }).success).toBe(true);
    expect(ChangeSchema.safeParse({ ...common, op: "add", parentId: "exp-1", after: "b" }).success).toBe(true);
    expect(ChangeSchema.safeParse({ ...common, op: "reorder", parentId: "exp-1", orderedItemIds: ["a", "b"] }).success).toBe(true);
  });
  it("addresses top-level lists by their reserved section IDs", () => {
    expect(ChangeSchema.safeParse({ ...common, op: "add", parentId: "skills", after: "Kubernetes" }).success).toBe(true);
    expect(ChangeSchema.safeParse({ ...common, op: "reorder", parentId: "skills", orderedItemIds: ["s1", "s2"] }).success).toBe(true);
  });
  it("keeps a user's revised text in `after`", () => {
    const revised = { ...common, status: "revised", op: "replace", targetItemId: "exp-1-b1", before: "a", after: "user text" };
    const parsed = ChangeSchema.parse(revised);
    expect(parsed.status).toBe("revised");
    expect(parsed.op === "replace" && parsed.after).toBe("user text");
  });
  it("rejects remove, and the dropped `origin` field is not required", () => {
    expect(ChangeSchema.safeParse({ ...common, op: "remove", targetItemId: "exp-1-b1" }).success).toBe(false);
    expect(ChangeSchema.safeParse({ ...common, op: "add", parentId: "exp-1", after: "b" }).success).toBe(true);
  });
});

describe("branded IDs", () => {
  it("do not mix at compile time", () => {
    const item: ItemId = ItemIdSchema.parse("exp-1");
    const req: RequirementId = RequirementIdSchema.parse("req-1");
    // @ts-expect-error a RequirementId is not an ItemId
    const wrongItem: ItemId = req;
    // @ts-expect-error an ItemId is not a RequirementId
    const wrongReq: RequirementId = item;
    expect([wrongItem, wrongReq]).toHaveLength(2);
  });
  it("require an unguessable Run ID", () => {
    expect(RunIdSchema.safeParse(RUN_ID).success).toBe(true);
    expect(RunIdSchema.safeParse("42").success).toBe(false);
  });
});

describe("run view", () => {
  const base = {
    id: RUN_ID,
    createdAt: "2026-10-12T09:14:00Z",
    expiresAt: "2026-10-19T09:14:00Z",
    job: null,
    steps: [{ key: "parse", state: "done" }],
  };
  const cv = {
    contact: { id: "contact", name: "A", email: null, phone: null, location: null, links: [] },
    summary: null,
    experience: [],
    education: [],
    skills: [],
    projects: [],
    certifications: [],
    additionalSections: [],
  };
  const review = {
    score: { before: 48, after: 71 },
    requirements: [
      {
        id: "req-3",
        text: "Node.js, 5+ years",
        importance: "must_have",
        before: "partially_met",
        after: { verdict: "met", evidenceIds: ["exp-1-b1", "ue-1"], reason: "Five years at Acme" },
        confirmedGap: false,
      },
    ],
    cv,
    changes: [],
    userEvidence: [{ id: "ue-1", questionId: "q-1", requirementId: "req-3", text: "Used Node.js at a startup" }],
    iterations: { used: 2, max: 3 },
    exitReason: "plateau",
  };

  it("accepts every exit reason, including error", () => {
    for (const reason of ["ceiling", "plateau", "max_iterations", "target_reached", "error"]) {
      expect(ExitReasonSchema.safeParse(reason).success).toBe(true);
    }
    expect(ExitReasonSchema.safeParse("other").success).toBe(false);
  });
  it("discriminates on status", () => {
    expect(RunViewSchema.safeParse({ ...base, status: "parsing" }).success).toBe(true);
    expect(RunViewSchema.safeParse({ ...base, status: "interrupted" }).success).toBe(true);
    expect(RunViewSchema.safeParse({ ...base, status: "failed", error: { code: "SCANNED_PDF", message: "m" } }).success).toBe(true);
    expect(RunViewSchema.safeParse({ ...base, status: "failed", error: { code: "JOB_DESCRIPTION_TOO_LONG", message: "m" } }).success).toBe(true);
  });
  it("parses awaiting_answers with questions", () => {
    const questions = [{ id: "q-1", requirementId: "req-3", text: "Have you used Kubernetes?" }];
    expect(RunViewSchema.safeParse({ ...base, status: "awaiting_answers", questions }).success).toBe(true);
  });
  it("parses tailoring with a score that has no `after` yet", () => {
    const tailoring = { ...base, status: "tailoring", iterations: { used: 1, max: 3 }, score: { before: 48, after: null } };
    expect(RunViewSchema.safeParse(tailoring).success).toBe(true);
  });
  it("parses awaiting_review with the coverage list and user evidence", () => {
    expect(RunViewSchema.safeParse({ ...base, status: "awaiting_review", ...review }).success).toBe(true);
  });
  it("parses completed with download links", () => {
    const completed = { ...base, status: "completed", ...review, download: { docx: "/runs/x/cv.docx", pdf: null } };
    expect(RunViewSchema.safeParse(completed).success).toBe(true);
  });
  it("no longer parses the retired scored status", () => {
    expect(RunViewSchema.safeParse({ ...base, status: "scored", score: 64, requirements: [] }).success).toBe(false);
  });
  it("accepts the failed step state", () => {
    const steps = [{ key: "coverage", state: "failed" }];
    expect(RunViewSchema.safeParse({ ...base, steps, status: "parsing" }).success).toBe(true);
    expect(RunViewSchema.safeParse({ ...base, steps: [{ key: "coverage", state: "broken" }], status: "parsing" }).success).toBe(false);
  });
  it("accepts the COVERAGE_FAILED error code", () => {
    expect(RunViewSchema.safeParse({ ...base, status: "failed", error: { code: "COVERAGE_FAILED", message: "m" } }).success).toBe(true);
  });
  it("requires status-specific data and a UUID run id", () => {
    expect(RunViewSchema.safeParse({ ...base, status: "awaiting_answers" }).success).toBe(false);
    expect(RunViewSchema.safeParse({ ...base, status: "awaiting_review" }).success).toBe(false);
    expect(RunViewSchema.safeParse({ ...base, id: "42", status: "parsing" }).success).toBe(false);
    expect(RunViewSchema.safeParse({ ...base, status: "failed", error: { code: "NOPE", message: "m" } }).success).toBe(false);
  });
  it("rejects timestamps with offsets (the backend emits Z)", () => {
    expect(RunViewSchema.safeParse({ ...base, createdAt: "2026-10-12T09:14:00+02:00", status: "parsing" }).success).toBe(false);
  });
});
