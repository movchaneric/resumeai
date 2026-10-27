import { describe, expect, it } from "vitest";
import { POINTS_PER_LINE, fitOf } from "@/export/fit.js";
import { measureFit } from "@/export/measureFit.js";
import { fixtureCv, longCv } from "./exportCv.js";

describe("fitOf", () => {
  it("reports the step for a CV that fits at the normal size", async () => {
    expect(await fitOf(fixtureCv())).toEqual({ fits: true, step: 0 });
  });

  it("reports the step for a long CV that shrinks to fit", async () => {
    const cv = longCv(2, 6);
    const measured = await measureFit(cv);
    if (!measured.fits) throw new Error("fixture should fit after shrinking");
    expect(await fitOf(cv)).toEqual({ fits: true, step: measured.step });
    expect(measured.step).toBeGreaterThan(0);
  });

  it("reports a too-long CV as whole lines over, rounded up", async () => {
    const cv = longCv(4, 6);
    const measured = await measureFit(cv);
    if (measured.fits) throw new Error("fixture should be too long");
    const result = await fitOf(cv);
    expect(result).toEqual({ fits: false, overByLines: Math.ceil(measured.overBy / POINTS_PER_LINE) });
    expect(POINTS_PER_LINE).toBe(14);
    expect((result as { overByLines: number }).overByLines).toBeGreaterThan(0);
  });
});
