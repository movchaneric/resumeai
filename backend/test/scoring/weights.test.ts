import { describe, expect, it } from "vitest";
import { RequirementSchema } from "@resume-ai/shared";
import type { Importance, Requirement } from "@resume-ai/shared";
import { requirementWeight } from "@/scoring/weights.js";

const req = (importance: Importance, kind: Requirement["kind"]): Requirement =>
  RequirementSchema.parse({ id: "req1", text: "t", source: "t", kind, importance });

describe("requirementWeight", () => {
  it("weighs a must-have responsibility 1.5", () => {
    expect(requirementWeight(req("must_have", "responsibility"))).toBe(1.5);
  });
  it("weighs a must-have of any other kind 3", () => {
    expect(requirementWeight(req("must_have", "skill"))).toBe(3);
  });
  it("weighs a nice-to-have responsibility 0.5", () => {
    expect(requirementWeight(req("nice_to_have", "responsibility"))).toBe(0.5);
  });
  it("weighs a nice-to-have of any other kind 1", () => {
    expect(requirementWeight(req("nice_to_have", "skill"))).toBe(1);
  });
});
