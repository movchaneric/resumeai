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

describe("renderTailorInput with User Evidence and Confirmed Gaps", () => {
  const ue = (id: string, requirementId: string, text: string) => ({ id, questionId: "q1", requirementId, text }) as never;

  it("lists User Evidence in its own section as [ueN] (for reqM) text", () => {
    const text = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [], userEvidence: [ue("ue1", "req3", "Ran a small cluster at Acme.")] });
    expect(text).toContain("[ue1] (for req3) Ran a small cluster at Acme.");
    expect(text).toContain("User Evidence");
    expect(text).toContain("add");
  });

  it("omits the User Evidence section when there is none", () => {
    expect(renderTailorInput({ cv: cv(), requirements, coverage, rejections: [] })).not.toContain("User Evidence (");
  });

  it("targets Requirements with User Evidence first, ahead of the must-haves-first order", () => {
    const text = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [], userEvidence: [ue("ue1", "req4", "Did a thing.")] });
    const target = text.slice(text.indexOf("Requirements not met"), text.indexOf("Already met"));
    expect(target.indexOf("[req4]")).toBeLessThan(target.indexOf("[req3]"));
    expect(target.indexOf("[req3]")).toBeLessThan(target.indexOf("[req1]"));
  });

  it("leaves Confirmed Gaps out of the Requirements entirely", () => {
    const text = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [], confirmedGaps: ["req3" as never] });
    expect(text).not.toContain("[req3]");
    expect(text).toContain("[req1]");
  });

  it("tells the model the CV must fit one page and to prefer replace over add", () => {
    const text = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [], fit: { fits: true, step: 3, steps: 7 } });
    expect(text).toContain("must fit one page");
    expect(text).toContain("prefer \"replace\" over \"add\"");
  });

  it("states the fit status: the size step when it fits, the lines over when it does not", () => {
    const fits = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [], fit: { fits: true, step: 3, steps: 7 } });
    expect(fits).toContain("The draft fits one page at size step 3 of 7.");
    const over = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [], fit: { fits: false, overByLines: 5 } });
    expect(over).toContain("The draft is already over one page by 5 lines at the smallest size.");
    expect(over).not.toContain("fits one page at");
  });

  it("leaves out the fit section when no fit is given", () => {
    const text = renderTailorInput({ cv: cv(), requirements, coverage, rejections: [] });
    expect(text).not.toContain("one page");
  });
});
