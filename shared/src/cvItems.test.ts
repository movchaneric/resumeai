import { describe, expect, it } from "vitest";
import { itemTexts } from "./cvItems.js";
import { testCv } from "./testCv.js";

describe("itemTexts", () => {
  it("includes the headline in the contact Item's text", () => {
    const cv = testCv();
    cv.contact.headline = "Backend engineer";
    expect(itemTexts(cv).get("contact")).toContain("Backend engineer");
  });

  it("leaves a null headline out", () => {
    expect(itemTexts(testCv()).get("contact")).not.toContain("null");
  });
});
