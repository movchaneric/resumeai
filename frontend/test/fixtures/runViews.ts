// Made-up Run views, built through the shared schema so a fixture can't drift from the API.
import { RunViewSchema, type RunView } from "@resume-ai/shared";

export const RUN_ID = "0b7e6f8e-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

const common = {
  id: RUN_ID,
  createdAt: "2026-10-27T10:00:00.000Z",
  expiresAt: "2026-11-03T10:00:00.000Z",
  job: { title: "Senior Backend Engineer", company: "Northwind Labs" },
  steps: [
    { key: "parse", state: "done" },
    { key: "extract", state: "running" },
  ],
};

const cv = {
  contact: { id: "contact", name: "Sam Example", headline: null, email: null, phone: null, location: null, links: [] },
  summary: null,
  experience: [
    {
      id: "exp1",
      company: "Acme Co",
      title: "Engineer",
      location: null,
      dates: { start: "2020", end: null, current: true },
      bullets: [{ id: "b1", text: "Built an internal tool." }],
    },
  ],
  education: [],
  skills: [],
  projects: [],
  certifications: [],
  additionalSections: [],
};

const change = (id: string) => ({
  id,
  op: "replace",
  targetItemId: "b1",
  before: "Built an internal tool.",
  after: "Built an internal tool used by 40 engineers.",
  rationale: "States the scale.",
  evidenceIds: ["b1"],
  requirementIds: ["r1"],
  status: "proposed",
});

const reviewFields = {
  score: { before: 54, after: 72 },
  requirements: [
    {
      id: "r1",
      text: "Node.js, 5+ years",
      importance: "must_have",
      before: "partially_met",
      after: { verdict: "met", evidenceIds: ["b1"], reason: "Built tools in Node.js." },
      confirmedGap: false,
    },
  ],
  cv,
  originalCv: cv,
  changes: [change("c1"), change("c2"), change("c3")],
  userEvidence: [],
  iterations: { used: 2, max: 3 },
  exitReason: "target_reached",
};

const VIEWS: Record<RunView["status"], unknown> = {
  parsing: { ...common, status: "parsing" },
  extracting: { ...common, status: "extracting" },
  awaiting_answers: { ...common, status: "awaiting_answers", questions: [{ id: "q1", requirementId: "r1", text: "Have you used Node.js?" }] },
  tailoring: { ...common, status: "tailoring", iterations: { used: 1, max: 3 }, score: { before: 54, after: null } },
  awaiting_review: { ...common, status: "awaiting_review", ...reviewFields, fit: { fits: true, step: 0, fittable: true } },
  completed: {
    ...common,
    status: "completed",
    ...reviewFields,
    onePage: true,
    download: { docx: `/runs/${RUN_ID}/cv.docx`, pdf: `/runs/${RUN_ID}/cv.pdf` },
  },
  failed: { ...common, status: "failed", error: { code: "NO_REQUIREMENTS", message: "No Requirements found." } },
  interrupted: { ...common, status: "interrupted" },
};

export const STATUSES = Object.keys(VIEWS) as RunView["status"][];

/** A valid view in `status`, with top-level fields replaced by `overrides`. The result is checked against `RunViewSchema`. */
export function runView<S extends RunView["status"]>(status: S, overrides: Record<string, unknown> = {}): Extract<RunView, { status: S }> {
  return RunViewSchema.parse({ ...(VIEWS[status] as object), ...overrides }) as Extract<RunView, { status: S }>;
}

type StepSpec = [key: string, state: "pending" | "running" | "done" | "failed"];

/** A `steps` array from `[key, state]` pairs, for the `overrides` of `runView`. */
export const stepsOf = (...specs: StepSpec[]) => specs.map(([key, state]) => ({ key, state }));

/** Steps of a Run that is tailoring: everything before is done, tailoring runs, the rest wait. */
export const TAILORING_STEPS = stepsOf(
  ["parse", "done"],
  ["extract", "done"],
  ["coverage", "done"],
  ["questions", "done"],
  ["tailor", "running"],
  ["fit", "pending"],
  ["review", "pending"],
);

// --- An awaiting_review view with one Change of each kind (replace, add, remove, reorder) ---

const job = (id: string, company: string, bullets: [string, string][]) => ({
  id,
  company,
  title: "Engineer",
  location: null,
  dates: { start: "2020", end: null, current: true },
  bullets: bullets.map(([bid, text]) => ({ id: bid, text })),
});

/**
 * The made-up CV of `reviewRunView`: Harbor Analytics (b1, b2, b3), Fieldstone (b4, its only bullet), skills s1 and s2.
 * Exported so a test can name its Items.
 */
export const REVIEW_CV = {
  ...cv,
  experience: [
    job("exp1", "Harbor Analytics", [
      ["b1", "Built an internal tool."],
      ["b2", "Wrote reports for the team."],
      ["b3", "Answered support emails."],
    ]),
    job("exp2", "Fieldstone", [["b4", "Ran the nightly import."]]),
  ],
  skills: [
    { id: "s1", text: "Node.js" },
    { id: "s2", text: "SQL" },
  ],
};

const reviewChange = (fields: Record<string, unknown>) => ({ rationale: "A reason.", evidenceIds: [], requirementIds: [], status: "proposed", ...fields });

/**
 * An `awaiting_review` view with five Changes and four Requirements:
 * - `c1` replaces b1 (Evidence b1, lists r1);
 * - `c2` adds a bullet to exp1 (Evidence ue1, lists r2);
 * - `c3` removes b3 (Condensing; lists nothing);
 * - `c4` reorders the skills (lists r3);
 * - `c5` replaces b2 (Evidence b2, lists r1).
 * Final verdicts cite: r1 b1 and b2, r2 ue1, r3 s1, r4 b4. Nothing lists r4. `fit` fits at step 0.
 */
export function reviewRunView(overrides: Record<string, unknown> = {}) {
  const requirement = (id: string, importance: string, evidenceIds: string[]) => ({
    id,
    text: `Requirement ${id}`,
    importance,
    before: "partially_met",
    after: { verdict: "met", evidenceIds, reason: `Why ${id} is met.` },
    confirmedGap: false,
  });
  return runView("awaiting_review", {
    cv: REVIEW_CV,
    originalCv: REVIEW_CV,
    requirements: [requirement("r1", "must_have", ["b1", "b2"]), requirement("r2", "must_have", ["ue1"]), requirement("r3", "nice_to_have", ["s1"]), requirement("r4", "must_have", ["b4"])],
    changes: [
      reviewChange({ id: "c1", op: "replace", targetItemId: "b1", before: "Built an internal tool.", after: "Built an internal tool used by 40 engineers.", evidenceIds: ["b1"], requirementIds: ["r1"] }),
      reviewChange({ id: "c2", op: "add", parentId: "exp1", after: "Cut the import time in half.", evidenceIds: ["ue1"], requirementIds: ["r2"] }),
      reviewChange({ id: "c3", op: "remove", targetItemId: "b3", before: "Answered support emails." }),
      reviewChange({ id: "c4", op: "reorder", parentId: "skills", orderedItemIds: ["s2", "s1"], requirementIds: ["r3"] }),
      reviewChange({ id: "c5", op: "replace", targetItemId: "b2", before: "Wrote reports for the team.", after: "Wrote weekly reports for 12 people.", evidenceIds: ["b2"], requirementIds: ["r1"] }),
    ],
    userEvidence: [{ id: "ue1", questionId: "q1", requirementId: "r2", text: "I cut the import time in half." }],
    ...overrides,
  });
}
