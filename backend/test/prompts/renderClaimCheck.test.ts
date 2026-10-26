import { describe, expect, it } from "vitest";
import { renderClaimCheck } from "@/prompts/renderClaimCheck.js";

describe("renderClaimCheck", () => {
  it("renders id, before, after and each Evidence text per Change", () => {
    const text = renderClaimCheck([
      { id: "c1", before: "Built the orders backend", after: "Built the orders service", evidence: ["Built the orders backend", "Used Express"] },
    ]);
    expect(text).toContain("[c1]");
    expect(text).toContain("Before: Built the orders backend");
    expect(text).toContain("After: Built the orders service");
    expect(text).toContain("- Built the orders backend");
    expect(text).toContain("- Used Express");
  });

  it("shows an empty before for an added Item", () => {
    const text = renderClaimCheck([{ id: "c2", before: "", after: "Wrote docs", evidence: ["Wrote docs"] }]);
    expect(text).toContain("Before: (none, new Item)");
  });
});

describe("renderClaimCheck with User Evidence", () => {
  it("renders the Answer text as the user's own statement, apart from the CV Evidence", () => {
    const text = renderClaimCheck([{ id: "r1.c1", before: "", after: "Ran a cluster", evidence: ["Wrote internal tools"], userEvidence: ["Ran a small cluster at Acme."] }]);
    expect(text).toContain("- Wrote internal tools");
    expect(text).toContain("The user's own statements");
    expect(text).toContain("- Ran a small cluster at Acme.");
  });

  it("has no such section when there is no User Evidence", () => {
    expect(renderClaimCheck([{ id: "r1.c1", before: "", after: "x", evidence: ["e"] }])).not.toContain("own statements");
  });
});
