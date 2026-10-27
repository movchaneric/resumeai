import type { ExtractedCv } from "@resume-ai/shared";

const range = { start: "2020", end: "2022", current: false };

/** A hand-written extracted CV with every section. */
export function fullCv(): ExtractedCv {
  return {
    contact: { name: "Ada Lovelace", headline: null, email: null, phone: null, location: null, links: [] },
    summary: "Engineer.",
    experience: [
      { company: "Acme", title: "Dev", location: null, dates: range, bullets: ["Built a", "Built b"] },
      { company: "Beta", title: "Lead", location: null, dates: range, bullets: ["Led c"] },
    ],
    education: [{ institution: "MIT", degree: "BSc", field: "CS", dates: range, bullets: ["Thesis"] }],
    skills: ["TypeScript", "SQL"],
    projects: [{ name: "Proj", url: null, dates: null, bullets: ["Shipped"] }],
    certifications: [{ name: "AWS", issuer: null, date: "2021" }],
    additionalSections: [{ title: "Experience", items: ["Volunteer a", "Volunteer b"] }],
  };
}
