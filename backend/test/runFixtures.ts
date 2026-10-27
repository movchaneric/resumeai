import type { ExtractedCv } from "@resume-ai/shared";

const range = (start: string, end: string | null) => ({ start, end, current: end === null });

/** What a model would extract from the text of `fixtures/cv.pdf`; every protected field is quoted from it. */
export const extractedCv: ExtractedCv = {
  contact: { name: "Jane Doe", headline: null, email: "jane.doe@example.com", phone: null, location: "Springfield", links: [] },
  summary: null,
  experience: [
    {
      company: "Acme Corp",
      title: "Senior Backend Developer",
      location: null,
      dates: range("2021", null),
      bullets: ["Designed and maintained Node.js services backed by PostgreSQL."],
    },
  ],
  education: [
    { institution: "Springfield University", degree: "BSc", field: "Computer Science", dates: range("2014", "2018"), bullets: [] },
  ],
  skills: ["TypeScript", "Node.js"],
  projects: [],
  certifications: [],
  additionalSections: [],
};

export const extractedJob = {
  title: "Backend Developer",
  company: "Initech",
  requirements: [{ text: "Node.js", source: "Node.js", kind: "skill", importance: "must_have" }],
};

/** What a model would answer for `extractedJob` (one Requirement, `req1`) against `extractedCv`. */
export const coverageAnswer = {
  verdicts: [{ requirementId: "req1", reason: "Built Node.js services.", evidenceIds: ["exp1.b1"], verdict: "met" }],
};
