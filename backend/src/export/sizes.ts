/*
 * The size table. Step 0 is the normal layout (10.5pt body, 1.8 cm margins); each later step takes
 * 0.25pt off the body, scales everything else with it, and moves the margins linearly towards the
 * floor (9pt, 1.2 cm). Both renderers read sizes from here so a step means the same in PDF and DOCX.
 */

export const NORMAL_BODY_PT = 10.5;
export const FLOOR_BODY_PT = 9;
export const BODY_STEP_PT = 0.25;
export const NORMAL_MARGIN_CM = 1.8;
export const FLOOR_MARGIN_CM = 1.2;
/** Index of the smallest layout. */
export const FLOOR_STEP = Math.round((NORMAL_BODY_PT - FLOOR_BODY_PT) / BODY_STEP_PT);

const PT_PER_CM = 72 / 2.54;

/** All lengths are in points. */
export interface Sizes {
  step: number;
  body: number;
  name: number;
  headline: number;
  heading: number;
  /** Extra space between lines of one paragraph. */
  lineGap: number;
  /** Space above a section heading. */
  sectionGap: number;
  /** Space below a section heading bar. */
  headingGap: number;
  /** Space above an entry (a job, a project, ...). */
  entryGap: number;
  /** Space above and below the text in a heading bar. */
  barPadding: number;
  /** Corner radius of a heading bar. */
  barRadius: number;
  /** Inset of the heading text from the bar edge. */
  headingInset: number;
  /** Extra space between the letters of a heading. */
  headingSpacing: number;
  /** Space kept between an entry's text and the dates or URL at the end of its line. */
  rightGap: number;
  /** Space between bullets. */
  bulletGap: number;
  /** Indent of bullet text. */
  bulletIndent: number;
  margin: number;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

export function sizesForStep(step: number): Sizes {
  if (!Number.isInteger(step) || step < 0 || step > FLOOR_STEP) throw new RangeError(`Unknown size step ${step}`);
  const body = NORMAL_BODY_PT - BODY_STEP_PT * step;
  const scale = body / NORMAL_BODY_PT;
  const marginCm = NORMAL_MARGIN_CM + ((FLOOR_MARGIN_CM - NORMAL_MARGIN_CM) * step) / FLOOR_STEP;
  return {
    step,
    body,
    name: round2(22 * scale),
    headline: round2(12 * scale),
    heading: round2(10 * scale),
    lineGap: round2(1.8 * scale),
    sectionGap: round2(9 * scale),
    headingGap: round2(5 * scale),
    entryGap: round2(5 * scale),
    barPadding: round2(2.5 * scale),
    barRadius: round2(3 * scale),
    headingInset: round2(6 * scale),
    headingSpacing: round2(0.4 * scale),
    rightGap: round2(8 * scale),
    bulletGap: round2(1.5 * scale),
    bulletIndent: round2(12 * scale),
    margin: round2(marginCm * PT_PER_CM),
  };
}

/**
 * The sizes the DOCX uses for a CV whose PDF fits at `pdfStep`: one step smaller, because Word lays text out
 * a little looser than PDFKit, and the same as the PDF at the floor (there is no smaller step to take).
 */
export const docxSizes = (pdfStep: number): Sizes => sizesForStep(Math.min(pdfStep + 1, FLOOR_STEP));
