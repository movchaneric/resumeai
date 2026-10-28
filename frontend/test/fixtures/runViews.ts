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
