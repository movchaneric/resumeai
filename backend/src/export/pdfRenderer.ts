import PDFDocument from "pdfkit";
import { fontPath } from "@/export/fonts.js";
import type { FontName } from "@/export/fonts.js";
import type { Block, TextSpan } from "@/export/layout.js";
import type { Sizes } from "@/export/sizes.js";
import { GRAY_BAR_HEX, TEXT_HEX } from "@/export/style.js";

/** What a render produced. `overflow` is 0 for a one-page result, else how far the content runs past the first page (points). */
export interface PdfRender {
  buffer: Buffer;
  pages: number;
  overflow: number;
}

const GRAY_BAR = `#${GRAY_BAR_HEX}`;
const TEXT = `#${TEXT_HEX}`;

/** Draw `blocks` on A4 pages in memory. Never touches the disk. */
export function renderPdf(blocks: Block[], sizes: Sizes): Promise<PdfRender> {
  const margin = sizes.margin;
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: margin, bottom: margin, left: margin, right: margin },
    bufferPages: true,
  });
  const names: FontName[] = ["nameBold", "headingItalic", "body", "bodyItalic", "bodyBold"];
  for (const name of names) doc.registerFont(name, fontPath(name));

  const chunks: Buffer[] = [];
  const done = new Promise<PdfRender>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve({ buffer: Buffer.concat(chunks), pages: pageCount, overflow }));
  });

  const left = margin;
  const width = doc.page.width - 2 * margin;
  const contentHeight = doc.page.height - 2 * margin;
  let pageCount = 1;
  let overflow = 0;

  /**
   * The y to start a block at, `gap` below the cursor. PDFKit only paginates between lines, so a block whose
   * first line would start below the bottom margin gets a new page here instead of being drawn off the page.
   */
  function startY(gap: number, minHeight: number): number {
    const y = doc.y + gap;
    if (y + minHeight <= doc.page.height - margin) return y;
    doc.addPage();
    return margin;
  }

  const bodyFont = (span?: TextSpan): FontName => (span?.bold ? "bodyBold" : span?.italic ? "bodyItalic" : "body");

  function drawEntry(spans: TextSpan[], right: string | null): void {
    const y = startY(sizes.entryGap, sizes.body * 1.4);
    doc.fillColor(TEXT).fontSize(sizes.body);
    let rightWidth = 0;
    if (right !== null) {
      doc.font("bodyItalic");
      rightWidth = doc.widthOfString(right) + sizes.rightGap;
    }
    spans.forEach((span, i) => {
      doc.font(bodyFont(span));
      const options = { width: width - rightWidth, lineGap: sizes.lineGap, continued: i < spans.length - 1 };
      if (i === 0) doc.text(span.text, left, y, options);
      else doc.text(span.text, options);
    });
    if (right !== null) {
      // Drawn after the left text so the text order reads title first; a URL or date stays on one line.
      const end = doc.y;
      doc.font("bodyItalic").text(right, left, y, { width, align: "right", lineBreak: false });
      doc.y = end;
    }
  }

  function drawBlock(block: Block): void {
    switch (block.kind) {
      case "name":
        doc.fillColor(TEXT).font("nameBold").fontSize(sizes.name).text(block.text, left, doc.y, { width });
        return;
      case "headline":
        doc.fillColor(TEXT).font("nameBold").fontSize(sizes.headline).text(block.text, left, doc.y, { width });
        doc.y += sizes.lineGap;
        return;
      case "contact": {
        doc.fillColor(TEXT).fontSize(sizes.body);
        // One line, never wrapped: a URL must not break across lines, so a contact line is not allowed to wrap.
        const options = { width, lineGap: sizes.lineGap, lineBreak: false };
        if (block.label === null) {
          doc.font("body").text(block.value, left, doc.y, options);
        } else {
          doc.font("bodyBold").text(`${block.label}: `, left, doc.y, { ...options, continued: true });
          doc.font("body").text(block.value, options);
        }
        return;
      }
      case "heading": {
        const height = sizes.heading * 1.25 + 2 * sizes.barPadding;
        const y = startY(sizes.sectionGap, height);
        doc.roundedRect(left, y, width, height, sizes.barRadius).fill(GRAY_BAR);
        doc.fillColor(TEXT).font("headingItalic").fontSize(sizes.heading);
        doc.text(block.text, left + sizes.headingInset, y + sizes.barPadding, {
          width: width - 2 * sizes.headingInset,
          lineBreak: false,
          characterSpacing: sizes.headingSpacing,
        });
        doc.y = y + height + sizes.headingGap;
        return;
      }
      case "entry":
        drawEntry(block.left, block.right);
        return;
      case "note":
        doc.fillColor(TEXT).font("bodyItalic").fontSize(sizes.body).text(block.text, left, doc.y, { width, lineGap: sizes.lineGap });
        return;
      case "bullet": {
        const y = startY(sizes.bulletGap, sizes.body * 1.4);
        doc.fillColor(TEXT).font("body").fontSize(sizes.body);
        doc.text("•", left, y, { width: sizes.bulletIndent, lineBreak: false });
        doc.text(block.text, left + sizes.bulletIndent, y, {
          width: width - sizes.bulletIndent,
          align: "justify",
          lineGap: sizes.lineGap,
        });
        return;
      }
      case "line":
        doc.fillColor(TEXT).font("body").fontSize(sizes.body);
        doc.text(block.text, left, startY(sizes.bulletGap, sizes.body * 1.4), { width, align: "justify", lineGap: sizes.lineGap });
        return;
    }
  }

  for (const block of blocks) drawBlock(block);

  pageCount = doc.bufferedPageRange().count;
  overflow = pageCount === 1 ? 0 : (pageCount - 1) * contentHeight + (doc.y - margin);
  doc.end();
  return done;
}
