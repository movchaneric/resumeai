import { describe, expect, it } from "vitest";
import { ExtractionError } from "@/extraction/errors.js";
import { extractCv } from "@/extraction/extractCv.js";
import { LlmSchemaError, LlmUnavailableError } from "@/llm/llmClient.js";
import { FakeLlmClient } from "../fakes/fakeLlmClient.js";
import { fullCv } from "./cvFixture.js";

const cvText = `Ada Lovelace
Engineer.
Acme - Dev 2020 - 2022
Built a
Built b
Beta - Lead 2020 - 2022
Led c
MIT BSc CS 2020 2022
Thesis
TypeScript SQL
Proj Shipped
AWS 2021
Experience Volunteer a Volunteer b`;

const empty = () => ({
  ...fullCv(),
  experience: [],
  education: [],
  skills: [],
  projects: [],
});

describe("extractCv", () => {
  it("returns a Cv with IDs on the first valid response", async () => {
    const llm = new FakeLlmClient().enqueue("extract_cv", fullCv());
    const { cv, softMismatches } = await extractCv(llm, cvText);
    expect(cv.experience[0]?.id).toBe("exp1");
    expect(softMismatches).toBe(0);
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]?.messages[0]?.role).toBe("system");
    expect(llm.calls[0]?.messages.some((m) => m.content.includes("Ada Lovelace"))).toBe(true);
  });

  it("retries once after a verbatim failure, feeding the issue back", async () => {
    const bad = fullCv();
    bad.experience[0]!.company = "Acme Ltd";
    const llm = new FakeLlmClient().enqueue("extract_cv", bad, fullCv());
    const { cv } = await extractCv(llm, cvText);
    expect(cv.experience[0]?.company).toBe("Acme");
    expect(llm.calls).toHaveLength(2);
    const last = llm.calls[1]!.messages.at(-1)!;
    expect(last.role).toBe("user");
    expect(last.content).toContain('experience[0].company "Acme Ltd" not found in the CV text');
  });

  it("feeds an invented month back and accepts the bare year", async () => {
    const text = cvText.replace("Acme - Dev 2020 - 2022", "Acme - Dev 2024- Present");
    const bad = fullCv();
    bad.experience[0]!.dates = { start: "2024-01", end: null, current: true };
    const good = fullCv();
    good.experience[0]!.dates = { start: "2024", end: null, current: true };
    const llm = new FakeLlmClient().enqueue("extract_cv", bad, good);
    const { cv } = await extractCv(llm, text);
    expect(cv.experience[0]?.dates?.start).toBe("2024");
    expect(llm.calls[1]!.messages.at(-1)!.content).toContain(
      "experience[0].dates.start month 01 of 2024 not found in the CV text",
    );
  });

  it("retries once after a date refinement failure", async () => {
    const bad = fullCv();
    bad.experience[1]!.dates = { start: "2022", end: "2020", current: false };
    const llm = new FakeLlmClient().enqueue("extract_cv", bad, fullCv());
    await extractCv(llm, cvText);
    expect(llm.calls[1]!.messages.at(-1)!.content).toContain(
      "experience[1].dates: End date is before start date",
    );
  });

  it("retries once after a schema failure", async () => {
    const llm = new FakeLlmClient().enqueue(
      "extract_cv",
      new LlmSchemaError("bad", ["experience[0].company: Required"]),
      fullCv(),
    );
    await extractCv(llm, cvText);
    expect(llm.calls[1]!.messages.at(-1)!.content).toContain("experience[0].company: Required");
  });

  it("throws ExtractionError when the CV is empty twice", async () => {
    const llm = new FakeLlmClient().enqueue("extract_cv", empty(), empty());
    const error = await extractCv(llm, cvText).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ExtractionError);
    expect((error as ExtractionError).issues).toContain("No CV content was found");
    expect(llm.calls).toHaveLength(2);
  });

  it("throws ExtractionError when the second attempt also fails the verbatim check", async () => {
    const bad = fullCv();
    bad.experience[0]!.title = "Wizard";
    const llm = new FakeLlmClient().enqueue("extract_cv", bad, bad);
    await expect(extractCv(llm, cvText)).rejects.toBeInstanceOf(ExtractionError);
  });

  it("does not retry LlmUnavailableError", async () => {
    const llm = new FakeLlmClient().enqueue("extract_cv", new LlmUnavailableError("down"));
    await expect(extractCv(llm, cvText)).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(llm.calls).toHaveLength(1);
  });

  it("normalizes current: true with an end date instead of rejecting", async () => {
    const odd = fullCv();
    odd.experience[0]!.dates = { start: "2020", end: "2022", current: true };
    const llm = new FakeLlmClient().enqueue("extract_cv", odd);
    const { cv } = await extractCv(llm, cvText);
    expect(cv.experience[0]?.dates).toEqual({ start: "2020", end: null, current: true });
    expect(llm.calls).toHaveLength(1);
  });
});
