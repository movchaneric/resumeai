import { ChangeSchema } from "@resume-ai/shared";
import type { Change, Cv } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";

const range = { start: "2020-01", end: "2022-06", current: false };

/** A made-up CV with IDs: exp1.b1-b2, exp2.b1, edu1.b1, skill1-3, proj1.b1, cert1, sec1.i1-i2. */
export function testCv(): Cv {
  return assignCvIds({
    contact: { name: "Nora Quill", headline: null, email: "nora@example.com", phone: null, location: null, links: [] },
    summary: "Backend developer with 5 years of experience.",
    experience: [
      {
        company: "Fernwood Labs",
        title: "Developer",
        location: null,
        dates: range,
        bullets: ["Built the backend for the orders service in Express", "Cut build time by 40% for 3 services"],
      },
      { company: "Plum Co", title: "Intern", location: null, dates: { start: "2019", end: "2019", current: false }, bullets: ["Wrote internal tools"] },
    ],
    education: [{ institution: "Elm University", degree: "BSc", field: "Computing", dates: range, bullets: ["Thesis on caching"] }],
    skills: ["TypeScript", "SQL", "Docker"],
    projects: [{ name: "Notes app", url: null, dates: null, bullets: ["Shipped a notes app"] }],
    certifications: [{ name: "Cloud Basics", issuer: null, date: "2021" }],
    additionalSections: [{ title: "Volunteering", items: ["Mentored 4 students in 2021", "Ran a coding club"] }],
  });
}

let counter = 0;
/** A valid Change with defaults; override any field. */
export function change(fields: Record<string, unknown>): Change {
  counter += 1;
  return ChangeSchema.parse({
    id: `chg${counter}`,
    rationale: "because",
    evidenceIds: [],
    requirementIds: ["req1"],
    status: "proposed",
    ...fields,
  });
}
