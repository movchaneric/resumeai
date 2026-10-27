import {
  AlignmentType,
  CharacterSet,
  Document,
  LevelFormat,
  Packer,
  Paragraph,
  ShadingType,
  TabStopType,
  TextRun,
  LineRuleType,
} from "docx";
import type { IParagraphOptions } from "docx";
import { readFileSync } from "node:fs";
import { fontPath } from "@/export/fonts.js";
import type { FontName } from "@/export/fonts.js";
import type { Block, Run } from "@/export/layout.js";
import type { Sizes } from "@/export/sizes.js";

/*
 * The same blocks as the PDF, as Word paragraphs. Units: font sizes are half-points, spacing, indents,
 * margins and tab positions are twips (1/20 point), the page is A4 (210 x 297 mm).
 */

const GRAY_BAR = "e4e4e7";
const TEXT = "111111";
const A4_WIDTH_TWIPS = 11906;
const A4_HEIGHT_TWIPS = 16838;
/** Run font names. They are the families the fonts are embedded under. */
const BODY_FONT = "Figtree";
const NAME_FONT = "Poppins";
/** The heading face is its own family: Poppins SemiBold Italic's family name is "Poppins SemiBold". */
const HEADING_FONT = "Poppins SemiBold";
/** Typical line height of the body font, as a multiple of its size; turns `lineGap` into Word's line multiple. */
const LINE_HEIGHT = 1.2;
type FontOptions = NonNullable<ConstructorParameters<typeof Document>[0]["fonts"]>[number];
const BULLET_REF = "cv-bullet";

const twips = (points: number): number => Math.round(points * 20);
const halfPoints = (points: number): number => Math.round(points * 2);

const fontCache = new Map<FontName, Buffer>();
function fontBytes(name: FontName): Buffer {
  let bytes = fontCache.get(name);
  if (bytes === undefined) {
    bytes = readFileSync(fontPath(name));
    fontCache.set(name, bytes);
  }
  return bytes;
}

/**
 * docx embeds one entry per font name, with a regular face and optional bold, italic and bold italic faces.
 * Poppins has no regular face bundled and none is used, so its Bold file fills the regular slot too.
 */
function embeddedFonts(): FontOptions[] {
  return [
    { name: BODY_FONT, data: fontBytes("body"), bold: fontBytes("bodyBold"), italic: fontBytes("bodyItalic"), characterSet: CharacterSet.ANSI },
    { name: NAME_FONT, data: fontBytes("nameBold"), bold: fontBytes("nameBold"), characterSet: CharacterSet.ANSI },
    { name: HEADING_FONT, data: fontBytes("headingItalic"), italic: fontBytes("headingItalic"), characterSet: CharacterSet.ANSI },
  ];
}

/** Build the DOCX in memory (never written to disk). */
export async function renderDocx(blocks: Block[], sizes: Sizes): Promise<Buffer> {
  const margin = twips(sizes.margin);
  const contentWidth = A4_WIDTH_TWIPS - 2 * margin;
  const indent = twips(sizes.bulletIndent);
  const bodySize = halfPoints(sizes.body);
  // Word's "auto" line spacing is a multiple of the font's own line height, in 240ths.
  const spacing = (before: number, after = 0): NonNullable<IParagraphOptions["spacing"]> => ({
    before: twips(before),
    after: twips(after),
    line: Math.round(240 * (1 + sizes.lineGap / (sizes.body * LINE_HEIGHT))),
    lineRule: LineRuleType.AUTO,
  });

  const text = (value: string, run: Run & { font?: string; size?: number; spacing?: number } = { text: value }): TextRun =>
    new TextRun({
      text: value,
      bold: run.bold,
      italics: run.italic,
      font: run.font ?? BODY_FONT,
      size: run.size ?? bodySize,
      color: TEXT,
      characterSpacing: run.spacing,
    });

  const paragraph = (block: Block): Paragraph => {
    switch (block.kind) {
      case "name":
        return new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [text(block.text, { text: block.text, bold: true, font: NAME_FONT, size: halfPoints(sizes.name) })],
        });
      case "headline":
        return new Paragraph({
          spacing: { before: 0, after: twips(sizes.lineGap) },
          children: [text(block.text, { text: block.text, bold: true, font: NAME_FONT, size: halfPoints(sizes.headline) })],
        });
      case "contact":
        return new Paragraph({
          spacing: spacing(0),
          children:
            block.label === null
              ? [text(block.value)]
              : [text(`${block.label}: `, { text: "", bold: true }), text(block.value)],
        });
      case "heading":
        return new Paragraph({
          keepNext: true,
          spacing: spacing(sizes.sectionGap, sizes.headingGap),
          // Square, full-width light-gray bar: paragraph shading spans the text area.
          shading: { type: ShadingType.CLEAR, color: "auto", fill: GRAY_BAR },
          indent: { left: 0 },
          children: [text(block.text, { text: "", italic: true, font: HEADING_FONT, size: halfPoints(sizes.heading), spacing: 8 })],
        });
      case "entry":
        return new Paragraph({
          keepNext: true,
          spacing: spacing(sizes.entryGap),
          tabStops: [{ type: TabStopType.RIGHT, position: contentWidth }],
          children: [
            ...block.left.map((run) => text(run.text, run)),
            ...(block.right === null ? [] : [text("\t", { text: "" }), text(block.right, { text: "", italic: true })]),
          ],
        });
      case "note":
        return new Paragraph({ spacing: spacing(0), children: [text(block.text, { text: "", italic: true })] });
      case "bullet":
        return new Paragraph({
          numbering: { reference: BULLET_REF, level: 0 },
          alignment: AlignmentType.JUSTIFIED,
          spacing: spacing(sizes.bulletGap),
          children: [text(block.text)],
        });
      case "line":
        return new Paragraph({ alignment: AlignmentType.JUSTIFIED, spacing: spacing(sizes.bulletGap), children: [text(block.text)] });
    }
  };

  const doc = new Document({
    title: "CV",
    fonts: embeddedFonts(),
    styles: { default: { document: { run: { font: BODY_FONT, size: bodySize, color: TEXT } } } },
    numbering: {
      config: [
        {
          reference: BULLET_REF,
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: "•",
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: { indent: { left: indent, hanging: indent } },
                run: { font: BODY_FONT, size: bodySize, color: TEXT },
              },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: A4_WIDTH_TWIPS, height: A4_HEIGHT_TWIPS },
            margin: { top: margin, bottom: margin, left: margin, right: margin, header: 0, footer: 0 },
          },
        },
        children: blocks.map(paragraph),
      },
    ],
  });
  return Packer.toBuffer(doc);
}
