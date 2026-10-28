import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ChangeSchema,
  CvSchema,
  DateRangeSchema,
  ExtractedCvSchema,
  ExtractedJobProfileSchema,
  ItemIdSchema,
  ReviewDecisionSchema,
  ReviewFitSchema,
  ReviewSubmissionSchema,
  PartialDateSchema,
  RequirementIdSchema,
  ExitReasonSchema,
  RunIdSchema,
  RunViewSchema,
  StepKeySchema,
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
    contact: { name: "A", headline: null, email: null, phone: null, location: null, links: [] },
    summary: null,
    experience: [{ company: "Acme", title: "Dev", location: null, dates, bullets: ["Built APIs"] }],
    education: [],
    skills: ["TypeScript"],
    projects: [],
    certifications: [],
    additionalSections: [{ title: "Volunteering", items: ["Mentor"] }],
  };
  const withIds = {
    contact: { id: "contact", name: "A", headline: null, email: null, phone: null, location: null, links: [] },
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
  it("reads a CV without a headline (an older checkpoint) as null", () => {
    const { headline: _omit, ...oldContact } = withIds.contact;
    const parsed = CvSchema.parse({ ...withIds, contact: oldContact });
    expect(parsed.contact.headline).toBeNull();
  });
  it("keeps a headline on the identified CV", () => {
    const parsed = CvSchema.parse({ ...withIds, contact: { ...withIds.contact, headline: "Software engineer" } });
    expect(parsed.contact.headline).toBe("Software engineer");
  });
  it("requires the headline on the extracted CV (nullable, not optional)", () => {
    const { headline: _omit, ...noHeadline } = extracted.contact;
    expect(ExtractedCvSchema.safeParse({ ...extracted, contact: noHeadline }).success).toBe(false);
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
  it("accepts a remove with a target and its original text, and needs both", () => {
    const remove = { ...common, evidenceIds: [], requirementIds: [], op: "remove", targetItemId: "exp-1-b1", before: "a" };
    const parsed = ChangeSchema.parse(remove);
    expect(parsed.op === "remove" && parsed.before).toBe("a");
    expect(ChangeSchema.safeParse({ ...remove, before: undefined }).success).toBe(false);
    expect(ChangeSchema.safeParse({ ...remove, targetItemId: undefined }).success).toBe(false);
    expect(ChangeSchema.safeParse({ ...remove, targetItemId: "" }).success).toBe(false);
  });
  it("the dropped `origin` field is not required", () => {
    expect(ChangeSchema.safeParse({ ...common, op: "add", parentId: "exp-1", after: "b" }).success).toBe(true);
  });
});

describe("review fit", () => {
  it("is a fit with a step, or an overflow in lines, each with fittable", () => {
    expect(ReviewFitSchema.safeParse({ fits: true, step: 0, fittable: true }).success).toBe(true);
    expect(ReviewFitSchema.safeParse({ fits: false, overByLines: 3, fittable: false }).success).toBe(true);
  });
  it("rejects a fit with no step, an overflow with no lines or none over, and a missing fittable", () => {
    expect(ReviewFitSchema.safeParse({ fits: true, fittable: true }).success).toBe(false);
    expect(ReviewFitSchema.safeParse({ fits: false, fittable: true }).success).toBe(false);
    expect(ReviewFitSchema.safeParse({ fits: false, overByLines: 0, fittable: true }).success).toBe(false);
    expect(ReviewFitSchema.safeParse({ fits: true, step: 1 }).success).toBe(false);
  });
});

describe("review submission", () => {
  it("defaults drops to none, so a body without them still parses", () => {
    expect(ReviewSubmissionSchema.parse({ decisions: [{ changeId: "c1", decision: "accept" }] }).drops).toEqual([]);
  });
  it("takes Item IDs as drops", () => {
    expect(ReviewSubmissionSchema.parse({ decisions: [], drops: ["exp1.b2"] }).drops).toEqual(["exp1.b2"]);
  });
  it("rejects drops that are not a list of non-empty IDs, and a missing decisions list", () => {
    expect(ReviewSubmissionSchema.safeParse({ decisions: [], drops: "exp1.b2" }).success).toBe(false);
    expect(ReviewSubmissionSchema.safeParse({ decisions: [], drops: [""] }).success).toBe(false);
    expect(ReviewSubmissionSchema.safeParse({ drops: [] }).success).toBe(false);
  });
});

describe("review decision", () => {
  it("accepts each decision and the optional revision fields", () => {
    expect(ReviewDecisionSchema.safeParse({ changeId: "c1", decision: "accept" }).success).toBe(true);
    expect(ReviewDecisionSchema.safeParse({ changeId: "c1", decision: "reject" }).success).toBe(true);
    expect(ReviewDecisionSchema.safeParse({ changeId: "c1", decision: "revise", after: "My text" }).success).toBe(true);
    expect(ReviewDecisionSchema.safeParse({ changeId: "c2", decision: "revise", orderedItemIds: ["a", "b"] }).success).toBe(true);
  });

  it("rejects an unknown decision, a missing change id and a non-text `after`", () => {
    expect(ReviewDecisionSchema.safeParse({ changeId: "c1", decision: "skip" }).success).toBe(false);
    expect(ReviewDecisionSchema.safeParse({ decision: "accept" }).success).toBe(false);
    expect(ReviewDecisionSchema.safeParse({ changeId: "c1", decision: "revise", after: 3 }).success).toBe(false);
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
    contact: { id: "contact", name: "A", headline: null, email: null, phone: null, location: null, links: [] },
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
    originalCv: cv,
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
  it("lists the `fit` step between `tailor` and `review`", () => {
    const keys = StepKeySchema.options;
    expect(keys.indexOf("fit")).toBe(keys.indexOf("tailor") + 1);
    expect(keys.indexOf("review")).toBe(keys.indexOf("fit") + 1);
    const tailoring = { ...base, status: "tailoring", steps: [{ key: "fit", state: "running" }], iterations: { used: 1, max: 3 }, score: { before: 48, after: null } };
    expect(RunViewSchema.safeParse(tailoring).success).toBe(true);
  });

  it("parses tailoring with a score that has no `after` yet", () => {
    const tailoring = { ...base, status: "tailoring", iterations: { used: 1, max: 3 }, score: { before: 48, after: null } };
    expect(RunViewSchema.safeParse(tailoring).success).toBe(true);
  });
  it("parses awaiting_review with the coverage list, user evidence and the fit", () => {
    expect(RunViewSchema.safeParse({ ...base, status: "awaiting_review", ...review, fit: { fits: true, step: 2, fittable: true } }).success).toBe(true);
    expect(RunViewSchema.safeParse({ ...base, status: "awaiting_review", ...review, fit: { fits: false, overByLines: 4, fittable: false } }).success).toBe(true);
  });
  it("requires the fit in awaiting_review, and leaves it out of completed", () => {
    expect(RunViewSchema.safeParse({ ...base, status: "awaiting_review", ...review }).success).toBe(false);
    const completed = { ...base, status: "completed", ...review, onePage: true, download: { docx: "/runs/x/cv.docx", pdf: "/runs/x/cv.pdf" } };
    expect(RunViewSchema.parse(completed)).not.toHaveProperty("fit");
    expect(RunViewSchema.parse({ ...completed, fit: { fits: true, step: 0, fittable: true } })).not.toHaveProperty("fit");
  });
  it("requires originalCv in awaiting_review and completed", () => {
    const { originalCv: _omit, ...withoutOriginal } = review;
    const fit = { fits: true, step: 0, fittable: true };
    expect(RunViewSchema.safeParse({ ...base, status: "awaiting_review", ...withoutOriginal, fit }).success).toBe(false);
    const download = { docx: "/runs/x/cv.docx", pdf: "/runs/x/cv.pdf" };
    expect(RunViewSchema.safeParse({ ...base, status: "completed", ...withoutOriginal, onePage: true, download }).success).toBe(false);
    expect(RunViewSchema.safeParse({ ...base, status: "completed", ...review, originalCv: { ...cv, skills: [] }, onePage: true, download }).success).toBe(true);
  });
  it("parses completed with download links", () => {
    const completed = { ...base, status: "completed", ...review, onePage: true, download: { docx: "/runs/x/cv.docx", pdf: "/runs/x/cv.pdf" } };
    expect(RunViewSchema.safeParse(completed).success).toBe(true);
  });
  it("requires onePage on completed", () => {
    const completed = { ...base, status: "completed", ...review, download: { docx: "/runs/x/cv.docx", pdf: "/runs/x/cv.pdf" } };
    expect(RunViewSchema.safeParse(completed).success).toBe(false);
    expect(RunViewSchema.safeParse({ ...completed, onePage: false }).success).toBe(true);
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
