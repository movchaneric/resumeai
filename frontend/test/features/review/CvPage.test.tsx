import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { applyDecisions } from "@resume-ai/shared";
import { CvPage } from "@/features/review";
import { reviewRunView } from "../../fixtures/runViews";
import { expectNoSeriousViolations } from "../../helpers/axe";

const run = reviewRunView();
// c1 and c4 kept, c2 and c3 and c5 rejected.
const changes = applyDecisions(
  run.changes,
  run.changes.map((c) => ({ changeId: c.id, decision: c.id === "c1" || c.id === "c4" ? ("accept" as const) : ("reject" as const) })),
);

describe("CvPage readOnly", () => {
  it("shows only the kept Changes' marks, with no buttons", async () => {
    const { container } = render(<CvPage cv={run.originalCv} changes={changes} readOnly />);
    expect(container.querySelector('[data-item-id="b1"] ins')).toHaveTextContent("Built an internal tool used by 40 engineers.");
    expect(container.querySelector('[data-item-id="b1"] del')).toHaveTextContent("Built an internal tool.");
    // rejected: b2 stays as it was, b3 stays, the rejected addition is not drawn at all
    expect(container.querySelector('[data-item-id="b2"]')).toHaveTextContent("Wrote reports for the team.");
    expect(container.querySelector('[data-item-id="b3"] del')).toBeNull();
    expect(screen.queryByText("Cut the import time in half.")).toBeNull();
    expect(screen.getByText(/Original order: Node.js, SQL/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(container.querySelector("[data-change-id]")).toBeNull();
    await expectNoSeriousViolations(container);
  });

  it("draws drops as struck text", () => {
    const { container } = render(<CvPage cv={run.originalCv} changes={changes} drops={["b2" as never]} readOnly />);
    expect(container.querySelector('[data-item-id="b2"] del')).toHaveTextContent("Wrote reports for the team.");
  });

  it("draws no reorder caption for a rejected reorder", () => {
    const rejected = applyDecisions(run.changes, run.changes.map((c) => ({ changeId: c.id, decision: "reject" as const })));
    render(<CvPage cv={run.originalCv} changes={rejected} readOnly />);
    expect(screen.queryByText(/Original order/)).toBeNull();
  });
});

describe("CvPage bullets", () => {
  it("puts the marker in a row of its own before the text, so it stays on the first line", () => {
    const { container } = render(<CvPage cv={run.originalCv} changes={changes} drops={["b2" as never]} />);
    for (const id of ["b1", "b2", "b4"]) {
      const li = container.querySelector<HTMLElement>(`[data-item-id="${id}"]`)!;
      // not a native list marker, which sits on the baseline of the last line of an inline-block child
      expect(li.className).not.toMatch(/list-disc|list-item/);
      const row = li.querySelector<HTMLElement>("[data-bullet-row]")!;
      expect(row.className).toMatch(/\bflex\b/);
      expect(row.className).toMatch(/items-start/);
      expect(row.className).toContain("before:content-['•']");
      expect(li.firstElementChild).toBe(row);
    }
  });
});
