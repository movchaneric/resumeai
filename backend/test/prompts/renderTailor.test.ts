import { describe, expect, it } from "vitest";
import { ChangeSchema, CoverageSchema, RequirementSchema } from "@resume-ai/shared";
import type { Change, Coverage, Cv, Requirement } from "@resume-ai/shared";
import { assignCvIds } from "@/extraction/assignIds.js";
import { renderCv } from "@/prompts/renderCv.js";
import { renderTailorInput } from "@/prompts/renderTailor.js";
import { fullCv } from "../extraction/cvFixture.js";

const cv = (): Cv => assignCvIds(fullCv());
const req = (id: string, importance: "must_have" | "nice_to_have"): Requirement =>
  RequirementSchema.parse({ id, text: `text ${id}`, source: "s", kind: "skill", importance });
const cov = (requirementId: string, verdict: "met" | "partially_met" | "unmet", reason = `reason ${requirementId}`): Coverage =>
  CoverageSchema.parse({ requirementId, verdict, evidenceIds: verdict === "unmet" ? [] : ["exp1.b1"], reason });

const requirements = [
  req("req1", "nice_to_have"),
  req("req2", "must_have"),
  req("req3", "must_have"),
  req("req4", "nice_to_have"),
];
const coverage = [cov("req1", "unmet"), cov("req2", "met"), cov("req3", "partially_met"), cov("req4", "partially_met")];

describe("renderTailorInput", () => {
  it("includes the CV with IDs", () => {
    const text = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [] });
    expect(text).toContain(renderCv(cv()));
  });

  it("lists not-met Requirements first with must-haves before nice-to-haves, each with verdict and reason", () => {
    const text = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [] });
    const at = (s: string) => text.indexOf(s);
    expect(at("[req3]")).toBeGreaterThan(-1);
    expect(at("[req3]")).toBeLessThan(at("[req1]"));
    expect(at("[req1]")).toBeLessThan(at("[req4]"));
    expect(text).toContain("[req3] (must-have) text req3 | partially_met: reason req3");
    expect(text).toContain("[req1] (nice-to-have) text req1 | unmet: reason req1");
  });

  it("puts met Requirements in a separate context section after the not-met ones", () => {
    const text = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [] });
    const ctx = text.indexOf("Already met (context");
    expect(ctx).toBeGreaterThan(text.indexOf("[req4]"));
    expect(text.indexOf("[req2]")).toBeGreaterThan(ctx);
  });

  it("omits the rejections section when there are none", () => {
    const text = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [] });
    expect(text).not.toContain("Rejected");
  });

  it("lists earlier rejections with round, target, new text and reason", () => {
    const change: Change = ChangeSchema.parse({
      id: "c1",
      op: "replace",
      targetItemId: "exp1.b1",
      before: "Built a",
      after: "Designed a",
      rationale: "r",
      evidenceIds: ["exp1.b1"],
      requirementIds: ["req3"],
      status: "proposed",
    });
    const text = renderTailorInput({
      cv: cv(),
      requirements,
      coverage,
      rejections: [{ round: 1, change, reason: "claims a design role" }],
    });
    expect(text).toContain("Rejected earlier");
    expect(text).toContain("round 1");
    expect(text).toContain("exp1.b1");
    expect(text).toContain("Designed a");
    expect(text).toContain("claims a design role");
  });
});
