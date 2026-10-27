import { describe, expect, it } from "vitest";
import { RequirementSchema } from "@resume-ai/shared";
import { renderDropInput, renderRewordInput } from "@/prompts/renderCondense.js";

const items = [
  { id: "exp1.b1", text: "Short one" },
  { id: "summary", text: "A much longer summary text that goes on for a while" },
  { id: "exp2.b1", text: "A medium length bullet here" },
];
const requirements = [
  RequirementSchema.parse({ id: "req1", text: "Node.js", source: "s", kind: "skill", importance: "must_have" }),
  RequirementSchema.parse({ id: "req2", text: "Docker", source: "s", kind: "skill", importance: "nice_to_have" }),
];

describe("renderRewordInput", () => {
  it("tells the model how many lines over the CV is", () => {
    expect(renderRewordInput({ items, overByLines: 7 })).toContain("7 lines");
    expect(renderRewordInput({ items, overByLines: 1 })).toContain("about 1 line.");
  });

  it("lists the Items longest first, each with its ID and current text", () => {
    const text = renderRewordInput({ items, overByLines: 3 });
    const order = ["[summary]", "[exp2.b1]", "[exp1.b1]"].map((id) => text.indexOf(id));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(text).toContain("[exp1.b1] Short one");
  });

  it("does not change the order of the input list", () => {
    const copy = structuredClone(items);
    renderRewordInput({ items, overByLines: 3 });
    expect(items).toEqual(copy);
  });
});

describe("renderDropInput", () => {
  it("carries the lines over, the Requirements and only the offered bullets", () => {
    const text = renderDropInput({ bullets: [{ id: "exp1.b2", text: "Wrote internal tools" }], requirements, overByLines: 4 });
    expect(text).toContain("4 lines");
    expect(text).toContain("[req1] (skill, must-have) Node.js");
    expect(text).toContain("[req2] (skill, nice-to-have) Docker");
    expect(text).toContain("[exp1.b2] Wrote internal tools");
    expect(text).not.toContain("exp1.b1");
  });
});
