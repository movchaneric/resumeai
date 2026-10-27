import type { Cv, ExtractedCv } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";

// A made-up CV that runs to about a page and a half at the smallest size: six jobs of five bullets each, so a
// Condensing test has plenty to reword and drop. Every name, company and sentence is invented; nothing comes from a real CV.

const range = (start: string, end: string | null) => ({ start, end, current: end === null });

const job = (company: string, title: string, dates: ReturnType<typeof range>, bullets: string[]) => ({ company, title, location: null, dates, bullets });

export const longExtracted: ExtractedCv = {
  contact: { name: "Mara Tindle", headline: "Platform engineer", email: "mara@example.com", phone: null, location: "Riverton", links: [] },
  summary:
    "Platform engineer with eight years of experience running reliable services for logistics and retail teams, from the first prototype to a stable production system that other teams build on every day.",
  experience: [
    job("Brightwater Systems", "Staff Engineer", range("2022", null), [
      "Led the move of the shipment tracking service from a single server to a clustered setup, which removed the weekly maintenance window for the whole warehouse team.",
      "Designed the event pipeline that feeds the delivery dashboards, handling 2 million events per day with a median delay under 3 seconds.",
      "Introduced load testing into the release process, so regressions in response time are caught before they reach customers.",
      "Mentored 6 engineers across 3 teams through code review, pairing sessions and a monthly design clinic.",
      "Wrote the runbooks for the on-call rotation and trained new members, cutting the time to resolve incidents by a third.",
    ]),
    job("Copperfield Retail", "Senior Developer", range("2019", "2022"), [
      "Built the stock reservation service used by the web shop and the mobile app, keeping reservations consistent during flash sales.",
      "Replaced a nightly batch job with a streaming import, so product data reaches the shop within minutes instead of the next morning.",
      "Reduced the monthly cloud bill by 28% by right-sizing databases, removing idle environments and tuning cache lifetimes.",
      "Ran the migration from a hand-written deployment script to a pipeline with automatic rollbacks across 12 services.",
      "Partnered with the support team to turn the most common complaints into a prioritised list of fixes, and delivered the top five.",
    ]),
    job("Lanternworks", "Developer", range("2016", "2019"), [
      "Developed the route planning API that dispatchers use to assign drivers, including the rules for time windows and vehicle capacity.",
      "Added structured logging and tracing to the planning service, which made slow requests easy to find and fix.",
      "Wrote integration tests against a copy of the production database schema, catching migration problems before release.",
      "Built an internal tool for importing partner price lists, replacing a manual spreadsheet process that took two days each month.",
      "Documented the public API and set up a sandbox so partner developers could try requests without asking for access.",
    ]),
    job("Hollis & Reed", "Junior Developer", range("2014", "2016"), [
      "Maintained the customer portal, fixing defects and adding small features requested by the account managers.",
      "Automated the weekly sales report, saving the finance team about four hours every week.",
      "Moved the portal's static assets to a content delivery network, halving page load time for remote users.",
      "Took part in the on-call rotation and wrote a short guide for the most frequent alerts.",
      "Reviewed pull requests from two interns and helped them ship their first features.",
    ]),
    job("Pinecrest Studio", "Intern", range("2013", "2014"), [
      "Built a small inventory app for the studio's print shop using a lightweight web framework and a relational database.",
      "Cleaned and migrated three years of order records from spreadsheets into the new database.",
      "Wrote the first automated tests for the studio's booking form and fixed the defects they found.",
      "Presented the app to the owners and collected feedback for the second version.",
      "Set up nightly backups and tested a restore so the data could be recovered after a failure.",
    ]),
    job("Marlowe Freight", "Student Assistant", range("2011", "2013"), [
      "Kept the depot's spreadsheet of pickups up to date and flagged late deliveries to the dispatcher every morning.",
      "Wrote a macro that merged the carrier reports into one sheet, which the team kept using for years afterwards.",
      "Answered customer questions about parcel status by phone and email during busy weeks before the holidays.",
      "Helped the depot manager prepare the monthly figures for the regional office.",
      "Trained two new assistants on the tracking system and the depot's filing routine.",
    ]),
  ],
  education: [
    {
      institution: "Alderbrook University",
      degree: "BSc",
      field: "Software Engineering",
      dates: range("2009", "2013"),
      bullets: ["Final project on scheduling deliveries for small fleets, graded with distinction.", "Teaching assistant for the databases course in the third year."],
    },
  ],
  skills: ["Languages: TypeScript, Go, SQL, Bash", "Platforms: Kubernetes, Terraform, PostgreSQL, Redis, Kafka", "Practices: incident response, load testing, code review, mentoring"],
  projects: [
    {
      name: "Parcelwatch",
      url: null,
      dates: range("2021", "2022"),
      bullets: ["Open source tool that shows the state of a parcel queue on a small dashboard, used by a few local shops.", "Wrote the contributor guide and reviewed outside patches for a year."],
    },
    {
      name: "Shelfsense",
      url: null,
      dates: range("2018", "2019"),
      bullets: [
        "Small service that predicts when a shelf will run empty from recent sales, built as a weekend project and later adopted by a neighbourhood grocer.",
        "Published the model notes and the test data so others could repeat the results.",
        "Gave a lightning talk about the project at a local developer evening.",
      ],
    },
  ],
  certifications: [{ name: "Cloud Operations Practitioner", issuer: "Example Academy", date: "2020" }],
  additionalSections: [{ title: "Talks", items: ["Talk on safe database migrations at a regional meetup in 2023", "Workshop on writing runbooks people actually read, 2022", "Panel on running small teams without a dedicated operations group, 2021"] }],
};

/** The CV text the extraction of `longExtracted` is checked against: every field written out, so the verbatim check passes. */
export function longCvText(): string {
  const cv = longExtracted;
  const lines: string[] = [cv.contact.name, cv.contact.headline ?? "", cv.contact.email ?? "", cv.contact.location ?? "", cv.summary ?? ""];
  for (const e of cv.experience) lines.push(`${e.title} ${e.company} ${e.dates?.start} ${e.dates?.end ?? "present"}`, ...e.bullets);
  for (const e of cv.education) lines.push(`${e.degree} ${e.field} ${e.institution} ${e.dates?.start} ${e.dates?.end}`, ...e.bullets);
  lines.push(...cv.skills);
  for (const p of cv.projects) lines.push(`${p.name} ${p.dates?.start} ${p.dates?.end}`, ...p.bullets);
  for (const c of cv.certifications) lines.push(`${c.name} ${c.issuer} ${c.date}`);
  for (const s of cv.additionalSections) lines.push(s.title, ...s.items);
  return lines.join("\n");
}

export function longCv(): Cv {
  return assignCvIds(longExtracted);
}
