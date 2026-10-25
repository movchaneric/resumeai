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
