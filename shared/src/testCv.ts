import { ChangeSchema } from "./change.js";
import type { Change } from "./change.js";
import { CvSchema } from "./cv.js";
import type { Cv } from "./cv.js";

/** A made-up CV with IDs: exp1.b1-b2, exp2.b1, edu1.b1, skill1-3, proj1.b1, cert1, sec1.i1-i2. The same CV as the backend's `testCv`, with the IDs written out. */
export function testCv(): Cv {
  return CvSchema.parse({
    contact: {
      id: "contact",
      name: "Nora Quill",
      headline: null,
      email: "nora@example.com",
      phone: null,
      location: null,
      links: []
    },
    summary: {
      id: "summary",
      text: "Backend developer with 5 years of experience."
    },
    experience: [
      {
        id: "exp1",
        company: "Fernwood Labs",
        title: "Developer",
        location: null,
        dates: {
          start: "2020-01",
          end: "2022-06",
          current: false
        },
        bullets: [
          {
            id: "exp1.b1",
            text: "Built the backend for the orders service in Express"
          },
          {
            id: "exp1.b2",
            text: "Cut build time by 40% for 3 services"
          }
        ]
      },
      {
        id: "exp2",
        company: "Plum Co",
        title: "Intern",
        location: null,
        dates: {
          start: "2019",
          end: "2019",
          current: false
        },
        bullets: [
          {
            id: "exp2.b1",
            text: "Wrote internal tools"
          }
        ]
      }
    ],
    education: [
      {
        id: "edu1",
        institution: "Elm University",
        degree: "BSc",
        field: "Computing",
        dates: {
          start: "2020-01",
          end: "2022-06",
          current: false
        },
        bullets: [
          {
            id: "edu1.b1",
            text: "Thesis on caching"
          }
        ]
      }
    ],
    skills: [
      {
        id: "skill1",
        text: "TypeScript"
      },
      {
        id: "skill2",
        text: "SQL"
      },
      {
        id: "skill3",
        text: "Docker"
      }
    ],
    projects: [
      {
        id: "proj1",
        name: "Notes app",
        url: null,
        dates: null,
        bullets: [
          {
            id: "proj1.b1",
            text: "Shipped a notes app"
          }
        ]
      }
    ],
    certifications: [
      {
        id: "cert1",
        name: "Cloud Basics",
        issuer: null,
        date: "2021"
      }
    ],
    additionalSections: [
      {
        id: "sec1",
        title: "Volunteering",
        items: [
          {
            id: "sec1.i1",
            text: "Mentored 4 students in 2021"
          },
          {
            id: "sec1.i2",
            text: "Ran a coding club"
          }
        ]
      }
    ]
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
