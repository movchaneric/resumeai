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

  describe("whole-word matching for protected fields", () => {
    const withCompany = (company: string, title = "Dev") => {
      const c = cv();
      c.experience = [{ company, title, location: null, dates: { start: null, end: null, current: false }, bullets: [] }];
      c.education = [];
      c.certifications = [];
      c.summary = null;
      return c;
    };

    it("does not match a partial word in a title", () => {
      const r = checkVerbatim(withCompany("Acme", "Engineer"), "Acme Senior Engineering Manager");
      expect(r.issues).toEqual(['experience[0].title "Engineer" not found in the CV text']);
    });

    it("does not match Acme inside Acmex, but matches Acme Ltd and text start/end", () => {
      expect(checkVerbatim(withCompany("Acme"), "Acmex Ltd Dev").issues).toHaveLength(1);
      expect(checkVerbatim(withCompany("Acme"), "Acme Ltd Dev").issues).toEqual([]);
      expect(checkVerbatim(withCompany("Acme"), "Dev at Acme").issues).toEqual([]);
    });

    it("matches a multi-word title split across a line break", () => {
      expect(checkVerbatim(withCompany("Acme", "Senior Software Engineer"), "Acme\nSenior Software\nEngineer").issues).toEqual([]);
    });

    it("reports an empty protected value", () => {
      expect(checkVerbatim(withCompany(""), "Acme Dev").issues).toEqual(['experience[0].company "" not found in the CV text']);
    });
  });

  describe("months", () => {
    const monthIssues = (text: string, start: string | null, end: string | null = null) => {
      const c = cv();
      c.experience = [
        { company: "Acme Labs", title: "Software Engineer", location: null, dates: { start, end, current: false }, bullets: [] },
      ];
      c.education = [];
      c.certifications = [];
      c.summary = null;
      return checkVerbatim(c, text).issues;
    };

    it("rejects an invented month in a year range with a spaced dash, accepts the bare year", () => {
      const text = "Software Engineer — Acme Labs  2024- Present";
      expect(monthIssues(text, "2024-01")).toEqual([
        "experience[0].dates.start month 01 of 2024 not found in the CV text; if the CV gives only the year, write the year alone",
      ]);
      expect(monthIssues(text, "2024")).toEqual([]);
    });

    it("proves start and end months from abbreviations", () => {
      const text = "Software Engineer Acme Labs Jun 2017 - Feb 2020";
      expect(monthIssues(text, "2017-06", "2020-02")).toEqual([]);
    });

    it.each(["June 2017", "Sept. 2021", "06/2017", "6/2017", "2017-06", "2017/6", "06.2017", "Jun, 2017", "Jun-2017", "Jun/2017", "Jun.2017", "Jun - 2017", "2017 Jun", "2017-Jun", "2017 June", "2017, Jun"])(
      "proves the month in %s",
      (form) => {
        const year = form.match(/\d{4}/)![0];
        const month = year === "2021" ? "2021-09" : "2017-06";
        const text = `Software Engineer Acme Labs ${form}`;
        expect(monthIssues(text, month)).toEqual([]);
      },
    );

    it("does not let a larger number prove the month", () => {
      expect(monthIssues("Software Engineer Acme Labs 2017-061", "2017-06")).toHaveLength(1);
      expect(monthIssues("Software Engineer Acme Labs 12017-06", "2017-06")).toHaveLength(1);
    });

    it("does not take a longer word or number as the month name", () => {
      expect(monthIssues("Software Engineer Acme Labs 2017 Junior", "2017-06")).toHaveLength(1);
      expect(monthIssues("Software Engineer Acme Labs Jun-2018", "2017-06")).toHaveLength(1);
      expect(monthIssues("Software Engineer Acme Labs 2018 Jun and 2017", "2017-06")).toHaveLength(1);
    });

    describe("two-digit years", () => {
      it.each(["03/21 - 06/23", "Mar '21 - Jun '23", "Mar ’21 – Jun ’23", "Mar' 21 - Jun' 23", "Mar-21 - Jun-23"])(
        "proves the years and months in %s",
        (text) => {
          expect(monthIssues(`Software Engineer Acme Labs ${text}`, "2021-03", "2023-06")).toEqual([]);
        },
      );

      it("proves the year from an apostrophe year, but not a month", () => {
        const text = "Software Engineer Acme Labs since '21";
        expect(monthIssues(text, "2021")).toEqual([]);
        expect(monthIssues(text, "2021-03")).toEqual([
          "experience[0].dates.start month 03 of 2021 not found in the CV text; if the CV gives only the year, write the year alone",
        ]);
      });

      it("does not prove a year from a bare two-digit number", () => {
        expect(monthIssues("Software Engineer Acme Labs 21 projects", "2021")).toEqual([
          "experience[0].dates.start year 2021 not found in the CV text",
        ]);
      });

      it("does not prove a year from a longer number or the wrong month", () => {
        expect(monthIssues("Software Engineer Acme Labs 03/2021", "2020")).toHaveLength(1);
        expect(monthIssues("Software Engineer Acme Labs 03/21", "2021-04")).toHaveLength(1);
        expect(monthIssues("Software Engineer Acme Labs 13/21", "2021")).toHaveLength(1);
      });
    });

    it("does not prove the month when month and year are separate", () => {
      expect(monthIssues("Software Engineer Acme Labs Jun 2018 and 2017", "2017-06")).toHaveLength(1);
    });
  });
});
