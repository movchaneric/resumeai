import type { Cv } from "@resume-ai/shared";
import { layoutCv } from "@/export/layout.js";
import type { Block } from "@/export/layout.js";
import { renderPdf } from "@/export/pdfRenderer.js";
import type { PdfRender } from "@/export/pdfRenderer.js";
import { FLOOR_STEP, sizesForStep } from "@/export/sizes.js";
import type { Sizes } from "@/export/sizes.js";

/**
 * The first size step at which the CV fits one A4 page, or how far it runs over at the floor.
 * On a fit it also returns the CV's blocks and the PDF rendered at that step, so the caller does not repeat the work.
 * `overBy` is in points of content height past the first page at the smallest size (about 14 points is one line).
 */
export type Fit = { fits: true; step: number; sizes: Sizes; blocks: Block[]; pdf: PdfRender } | { fits: false; overBy: number };

/** Lays the CV out with PDFKit at each step, largest first, and counts pages: the PDF is the ruler for the DOCX too. */
export async function measureFit(cv: Cv): Promise<Fit> {
  const blocks = layoutCv(cv);
  let overBy = 0;
  for (let step = 0; step <= FLOOR_STEP; step++) {
    const sizes = sizesForStep(step);
    const render = await renderPdf(blocks, sizes);
    if (render.pages === 1) return { fits: true, step, sizes, blocks, pdf: render };
    overBy = render.overflow;
  }
  return { fits: false, overBy };
}
