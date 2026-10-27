import type { Cv, ExtractedCv } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";

const range = (start: string | null, end: string | null, current = false) => ({ start, end, current });

/** A made-up CV with every section, a Headline, links, a current job and a bare-year date. */
export const fixtureExtracted: ExtractedCv = {
  contact: {
    name: "Nora Quill",
    headline: "Backend software engineer",
    email: "nora@example.com",
    phone: "+1 555 0100",
    location: "Springfield",
    links: [
      { label: "GitHub", url: "https://github.com/nora-quill" },
      { label: null, url: "https://nora.example.com/portfolio-site" },
    ],
  },
  summary: "Backend engineer with five years of experience building reliable order and billing services.",
  experience: [
    {
      company: "Fernwood Labs",
      title: "Senior Developer",
      location: "Remote",
      dates: range("2024", null, true),
      bullets: ["Built the orders service in Express and PostgreSQL.", "Cut build time by 40% across 3 services."],
    },
    {
      company: "Plum Co",
      title: "Developer",
      location: null,
      dates: range("2017-06", "2020-02"),
      bullets: ["Wrote internal tools for the support team."],
    },
  ],
  education: [{ institution: "Elm University", degree: "BSc", field: "Computing", dates: range("2012", "2016"), bullets: ["Thesis on caching."] }],
  skills: ["Languages: TypeScript, SQL", "Tools: Docker, Git"],
  projects: [
    { name: "Notes app", url: "https://notes.example.com", dates: range("2022-03", "2022-09"), bullets: ["Shipped a notes app with offline sync."] },
  ],
  certifications: [{ name: "Cloud Basics", issuer: "Example Academy", date: "2021-05" }],
  additionalSections: [{ title: "Volunteering", items: ["Mentored 4 students in 2021", "Ran a coding club"] }],
};

export function fixtureCv(): Cv {
  return assignCvIds(fixtureExtracted);
}

/** The fixture with `jobs` extra jobs of `bulletsPerJob` made-up bullets each. */
export function longCv(jobs: number, bulletsPerJob: number): Cv {
  const extra = Array.from({ length: jobs }, (_, j) => ({
    company: `Company ${j + 1}`,
    title: "Engineer",
    location: null,
    dates: range("2010", "2011"),
    bullets: Array.from({ length: bulletsPerJob }, (_, b) => `Delivered feature ${b + 1} for team ${j + 1}, reducing manual work and keeping the service reliable under load for customers.`),
  }));
  return assignCvIds({ ...fixtureExtracted, experience: [...fixtureExtracted.experience, ...extra] });
}
