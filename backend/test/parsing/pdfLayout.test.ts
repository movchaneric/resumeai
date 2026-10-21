import { describe, expect, it } from "vitest";
import { layoutPage, type TextItem } from "@/parsing/pdfLayout.js";

const W = 600;
const H = 12;
/** An item whose width is 6 per character, positioned in PDF space (y grows upward). */
const item = (str: string, x: number, y: number): TextItem => ({ str, x, y, width: str.length * 6, height: H });

describe("layoutPage", () => {
  it("returns an empty string for an empty page", () => {
    expect(layoutPage([], W)).toBe("");
    expect(layoutPage([item("   ", 10, 10)], W)).toBe("");
  });

  it("groups items into one line despite baseline jitter", () => {
    const text = layoutPage([item("Hello", 50, 700), item("world", 50 + 5 * 6 + 3, 702.5), item("Next", 50, 680)], W);
    expect(text).toBe("Hello world\nNext");
  });

  it("joins touching items with nothing and a wide gap with a separator", () => {
    const text = layoutPage([item("Senior Dev", 50, 700), item("eloper", 50 + 60, 700), item("2021 - Present", 450, 700)], W);
    expect(text).toBe("Senior Developer  2021 - Present");
  });

  it("reads a single-column page top to bottom, including right-aligned dates", () => {
    const items = [
      item("Name", 50, 750),
      item("Job one", 50, 720),
      item("2020 - 2021", 450, 720),
      item("A long bullet that spans across the whole width of the page for sure", 50, 700),
      item("Job two", 50, 680),
      item("2018 - 2020", 450, 680),
      item("Another long bullet that also spans across a good part of the page", 50, 660),
    ];
    expect(layoutPage(items, W)).toBe(
      [
        "Name",
        "Job one  2020 - 2021",
        "A long bullet that spans across the whole width of the page for sure",
        "Job two  2018 - 2020",
        "Another long bullet that also spans across a good part of the page",
      ].join("\n"),
    );
  });

  it("reads a two-column page as the left column, then the right", () => {
    const left = ["Side 1", "Side 2", "Side 3", "Side 4", "Side 5"];
    const rightCol = ["Main one", "Main two", "Main three", "Main four", "Main five"];
    // Interleave by y so a naive top-to-bottom read would alternate between columns. Left column is 150 wide, right starts at 250.
    const items = [
      ...left.map((s, i) => item(s + " sidebar text goes here", 30, 750 - i * 30)),
      ...rightCol.map((s, i) => item(s + " main column text here", 250, 750 - i * 30)),
    ];
    const lines = layoutPage(items, W).split("\n");
    expect(lines).toEqual([
      ...left.map((s) => s + " sidebar text goes here"),
      ...rightCol.map((s) => s + " main column text here"),
    ]);
  });
});
