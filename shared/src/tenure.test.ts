import { describe, expect, it } from "vitest";
import { durationMonthsOf, formatTenure, tenureOf } from "./tenure.js";

const today = new Date("2026-11-01T12:00:00Z");
const range = (start: string | null, end: string | null, current = false) => ({ start, end, current });

describe("tenureOf", () => {
  it("gives a range for a bare-year start that runs to today", () => {
    expect(tenureOf(range("2024", null, true), today)).toEqual({ minMonths: 23, maxMonths: 34 });
  });
  it("is exact for a month start", () => {
    expect(tenureOf(range("2024-03", null, true), today)).toEqual({ minMonths: 32, maxMonths: 32 });
  });
  it("gives a range for a past role with bare years", () => {
    expect(tenureOf(range("2019", "2021"), today)).toEqual({ minMonths: 13, maxMonths: 35 });
  });
  it("is null when a date is unknown or there is no range", () => {
    expect(tenureOf(null, today)).toBeNull();
    expect(tenureOf(range(null, "2021"), today)).toBeNull();
    expect(tenureOf(range("2021", null), today)).toBeNull();
  });
  it("never goes below zero", () => {
    expect(tenureOf(range("2026", null, true), today)).toEqual({ minMonths: 0, maxMonths: 10 });
  });
});

describe("formatTenure", () => {
  it("formats a range and an exact value", () => {
    expect(formatTenure({ minMonths: 23, maxMonths: 34 }, today)).toBe("1y11m to 2y10m as of Nov 2026");
    expect(formatTenure({ minMonths: 32, maxMonths: 32 }, today)).toBe("2y8m as of Nov 2026");
    expect(formatTenure({ minMonths: 0, maxMonths: 24 }, today)).toBe("0m to 2y as of Nov 2026");
  });
});

describe("durationMonthsOf", () => {
  it("reads N+ years and N years", () => {
    expect(durationMonthsOf("Full Stack or Web development, 2+ years")).toBe(24);
    expect(durationMonthsOf("3 years of experience")).toBe(36);
    expect(durationMonthsOf("5+ yrs Python")).toBe(60);
  });
  it("leaves ranges, months and plain text to the model", () => {
    expect(durationMonthsOf("3-5 years")).toBeNull();
    expect(durationMonthsOf("6 months of React")).toBeNull();
    expect(durationMonthsOf("React")).toBeNull();
  });
});
