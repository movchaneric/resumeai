import type { Cv } from "@resume-ai/shared";
import { layoutCv } from "@/export/layout.js";
import type { Block } from "@/export/layout.js";
import { renderPdf } from "@/export/pdfRenderer.js";
import type { PdfRender } from "@/export/pdfRenderer.js";
import { FLOOR_STEP, sizesForStep } from "@/export/sizes.js";
import type { Sizes } from "@/export/sizes.js";

/**
 * The first (largest) size step at which the CV fits one A4 page, or how far it runs over at the floor.
 * On a fit it also returns the CV's blocks and the PDF rendered at that step, so the caller does not repeat the work.
 * `overBy` is in points of content height past the first page at the smallest size (about 14 points is one line).
 */
export type Fit = { fits: true; step: number; sizes: Sizes; blocks: Block[]; pdf: PdfRender } | { fits: false; overBy: number };

/** Renders the blocks at a size: `renderPdf`, or a stand-in in a test that counts renders. */
export type RenderAt = (blocks: Block[], sizes: Sizes) => Promise<PdfRender>;

/**
 * Lays the CV out with PDFKit and counts pages: the PDF is the ruler for the DOCX too. Fit is monotonic (a smaller step never
 * runs longer), so it renders the floor first (no fit there means no fit anywhere, and its overflow is the answer), then
 * binary-searches steps 0 to the floor for the first that fits: at most 1 + ceil(log2(FLOOR_STEP)) renders instead of FLOOR_STEP + 1.
 */
export async function measureFit(cv: Cv, render: RenderAt = renderPdf): Promise<Fit> {
  const blocks = layoutCv(cv);
  const atFloor = await render(blocks, sizesForStep(FLOOR_STEP));
  if (atFloor.pages !== 1) return { fits: false, overBy: atFloor.overflow };

  let best = { step: FLOOR_STEP, pdf: atFloor };
  let low = 0;
  let high = FLOOR_STEP;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const pdf = await render(blocks, sizesForStep(mid));
    if (pdf.pages === 1) {
      best = { step: mid, pdf };
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return { fits: true, step: best.step, sizes: sizesForStep(best.step), blocks, pdf: best.pdf };
}
