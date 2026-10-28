import { describe, expect, it } from "vitest";
import { POINTS_PER_LINE, fitOf } from "@/export/fit.js";
import { layoutCv } from "@/export/layout.js";
import { measureFit, type RenderAt } from "@/export/measureFit.js";
import { renderPdf } from "@/export/pdfRenderer.js";
import { FLOOR_STEP, sizesForStep } from "@/export/sizes.js";
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

describe("measureFit's binary search", () => {
  const MAX_RENDERS = 2 + Math.ceil(Math.log2(FLOOR_STEP - 1));

  /** The old way: render from step 0 up and stop at the first one-page render. */
  async function linearScan(cv: ReturnType<typeof fixtureCv>) {
    const blocks = layoutCv(cv);
    let overBy = 0;
    for (let step = 0; step <= FLOOR_STEP; step++) {
      const render = await renderPdf(blocks, sizesForStep(step));
      if (render.pages === 1) return { fits: true as const, step };
      overBy = render.overflow;
    }
    return { fits: false as const, overBy };
  }

  it("finds every possible first fitting step, or none, in 1 render at the normal size, 2 when over at the floor, and at most 5 otherwise", async () => {
    // A stand-in ruler: the CV fits from step `firstFit` on; `firstFit` 7 means it never fits.
    for (let firstFit = 0; firstFit <= FLOOR_STEP + 1; firstFit++) {
      const steps: number[] = [];
      const render: RenderAt = async (_blocks, sizes) => {
        steps.push(sizes.step);
        const fits = sizes.step >= firstFit;
        return { buffer: Buffer.alloc(0), pages: fits ? 1 : 2, overflow: fits ? 0 : 100 - sizes.step };
      };
      const fit = await measureFit(fixtureCv(), render);
      if (firstFit > FLOOR_STEP) {
        expect(fit).toEqual({ fits: false, overBy: 100 - FLOOR_STEP });
      } else {
        expect(fit).toMatchObject({ fits: true, step: firstFit });
      }
      if (firstFit === 0) expect(steps).toHaveLength(1);
      else if (firstFit > FLOOR_STEP) expect(steps).toHaveLength(2);
      else expect(steps.length).toBeLessThanOrEqual(MAX_RENDERS);
    }
  });

  it("returns what the linear scan returns on real renders, the long made-up CVs included", async () => {
    const cvs = [fixtureCv(), longCv(1, 4), longCv(2, 4), longCv(2, 6), longCv(3, 5), longCv(4, 6)];
    const results = [];
    for (const cv of cvs) {
      let renders = 0;
      const counted: RenderAt = (blocks, sizes) => {
        renders += 1;
        return renderPdf(blocks, sizes);
      };
      const fit = await measureFit(cv, counted);
      const expected = await linearScan(cv);
      if (expected.fits) {
        expect(fit).toMatchObject({ fits: true, step: expected.step });
      } else {
        expect(fit).toEqual({ fits: false, overBy: expected.overBy });
      }
      if (expected.fits && expected.step === 0) expect(renders).toBe(1);
      else if (!expected.fits) expect(renders).toBe(2);
      else expect(renders).toBeLessThanOrEqual(MAX_RENDERS);
      results.push(fit.fits ? fit.step : "over");
    }
    // The fixtures cover a fit at the normal size, fits after shrinking, and a CV that is over at the floor.
    expect(results).toContain(0);
    expect(results.some((r) => typeof r === "number" && r > 0)).toBe(true);
    expect(results).toContain("over");
  });
});
