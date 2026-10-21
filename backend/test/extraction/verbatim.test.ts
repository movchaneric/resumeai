import { describe, expect, it } from "vitest";
import { checkVerbatim } from "@/extraction/verbatim.js";
import { fullCv } from "./cvFixture.js";

const source = `Ada Lovelace
Engineer.
Acme, Inc. - Dev (2020 - 2022)
Built a   thing
Beta Lead 2020-2022
MIT B.Sc. Computer Science 2020 2022
AWS Certified 2021`;

function cv() {
  const c = fullCv();
  c.experience = [
    { company: "Acme, Inc.", title: "Dev", location: null, dates: { start: "2020", end: "2022", current: false }, bullets: ["Built a thing"] },
    { company: "Beta", title: "Lead", location: null, dates: { start: "2020", end: "2022", current: false }, bullets: [] },
  ];
  c.education = [{ institution: "MIT", degree: "B.Sc.", field: "Computer Science", dates: { start: "2020", end: "2022", current: false }, bullets: [] }];
  c.summary = "Engineer.";
  c.skills = [];
  c.projects = [];
  c.certifications = [{ name: "AWS", issuer: null, date: "2021" }];
  c.additionalSections = [];
  return c;
}

describe("checkVerbatim", () => {
  it("passes exact text", () => {
    expect(checkVerbatim(cv(), source)).toEqual({ issues: [], softMismatches: 0 });
  });

  it("passes case, whitespace and punctuation variants", () => {
    const c = cv();
    c.experience[0]!.company = "ACME INC";
    c.experience[0]!.bullets = ["built a\n thing!"];
    c.education[0]!.degree = "BSc";
    // "BSc" vs "B.Sc." differs after punctuation -> space ("b sc"), so this is a miss
    const r = checkVerbatim(c, source);
    expect(r.issues).toEqual(['education[0].degree "BSc" not found in the CV text']);
    c.education[0]!.degree = "b.sc";
    expect(checkVerbatim(c, source).issues).toEqual([]);
  });

  it("fails a changed title with a readable issue", () => {
    const c = cv();
    c.experience[1]!.title = "Senior Lead";
    expect(checkVerbatim(c, source).issues).toEqual(['experience[1].title "Senior Lead" not found in the CV text']);
  });

  it("fails a year missing from the source", () => {
    const c = cv();
    c.experience[0]!.dates = { start: "2019-05", end: "2022", current: false };
    expect(checkVerbatim(c, source).issues).toEqual(["experience[0].dates.start year 2019 not found in the CV text"]);
  });

  it("matches a year only as a whole number", () => {
    const c = cv();
    c.certifications[0]!.date = "2021";
    expect(checkVerbatim(c, "AWS 120219 only").issues.some((i) => i.includes("certifications[0].date"))).toBe(true);
  });

  it("counts a paraphrased bullet, summary or skill as a soft mismatch only", () => {
    const c = cv();
    c.experience[0]!.bullets = ["Created a thing", "Built a thing"];
    c.summary = "Something else";
    c.skills = ["Rust"];
    c.additionalSections = [{ title: "X", items: ["nope"] }];
    expect(checkVerbatim(c, source)).toEqual({ issues: [], softMismatches: 4 });
  });

  it("skips null fields", () => {
    const c = cv();
    c.education[0] = { institution: "MIT", degree: null, field: null, dates: { start: null, end: null, current: false }, bullets: [] };
    c.certifications[0] = { name: "AWS", issuer: null, date: null };
    expect(checkVerbatim(c, source).issues).toEqual([]);
  });

  it("works for non-Latin scripts", () => {
    const c = cv();
    c.experience = [{ company: "Яндекс", title: "Разработчик", location: null, dates: { start: "2020", end: null, current: true }, bullets: [] }];
    c.education = [];
    c.certifications = [];
    c.summary = null;
    expect(checkVerbatim(c, "ЯНДЕКС — разработчик, 2020 – н.в.").issues).toEqual([]);
    c.experience[0]!.title = "Менеджер";
    expect(checkVerbatim(c, "ЯНДЕКС — разработчик, 2020").issues).toHaveLength(1);
  });
});
