import type { Change, Cv } from "@resume-ai/shared";

export interface Place {
  /** The CV section: "Summary", "Experience", "Education", "Projects", "Skills", "Certifications" or the candidate's own heading. */
  section: string;
  /** The entry the Item sits under (the company, the project, the school, the extra section), or null. */
  entry: string | null;
}

/** Where an Item (or a parent, or a top-level list ID) is in the CV, for card titles and Evidence sources. */
export function locate(cv: Cv, id: string): Place {
  if (cv.contact.id === id) return { section: "Contact", entry: null };
  if (cv.summary?.id === id) return { section: "Summary", entry: null };
  for (const job of cv.experience) if (job.id === id || job.bullets.some((b) => b.id === id)) return { section: "Experience", entry: job.company };
  for (const school of cv.education) if (school.id === id || school.bullets.some((b) => b.id === id)) return { section: "Education", entry: school.institution };
  for (const project of cv.projects) if (project.id === id || project.bullets.some((b) => b.id === id)) return { section: "Projects", entry: project.name };
  if (id === "skills" || cv.skills.some((s) => s.id === id)) return { section: "Skills", entry: null };
  if (id === "experience") return { section: "Experience", entry: null };
  if (id === "education") return { section: "Education", entry: null };
  if (id === "projects") return { section: "Projects", entry: null };
  if (id === "certifications" || cv.certifications.some((c) => c.id === id)) return { section: "Certifications", entry: null };
  for (const section of cv.additionalSections) if (section.id === id || section.items.some((i) => i.id === id)) return { section: section.title, entry: null };
  return { section: "CV", entry: null };
}

/** The Item an `add` or `reorder` attaches to, or the one a `replace` or `remove` targets. */
export const anchorOf = (change: Change): string => (change.op === "add" || change.op === "reorder" ? change.parentId : change.targetItemId);

/** Every ID in reading order (top to bottom of the CV page), for sorting cards into CV order. */
export function readingOrder(cv: Cv): Map<string, number> {
  const order = new Map<string, number>();
  const add = (id: string) => order.set(id, order.size);
  add(cv.contact.id);
  if (cv.summary) add(cv.summary.id);
  add("experience");
  for (const job of cv.experience) {
    add(job.id);
    job.bullets.forEach((b) => add(b.id));
  }
  add("education");
  for (const school of cv.education) {
    add(school.id);
    school.bullets.forEach((b) => add(b.id));
  }
  add("projects");
  for (const project of cv.projects) {
    add(project.id);
    project.bullets.forEach((b) => add(b.id));
  }
  add("skills");
  cv.skills.forEach((s) => add(s.id));
  add("certifications");
  cv.certifications.forEach((c) => add(c.id));
  for (const section of cv.additionalSections) {
    add(section.id);
    section.items.forEach((i) => add(i.id));
  }
  return order;
}

/** Where a Change sits on the page: its target; an `add` just after the last child of its parent; a `reorder` at its list. */
export function positionOf(cv: Cv, order: Map<string, number>, change: Change): number {
  if (change.op === "replace" || change.op === "remove") return order.get(change.targetItemId) ?? Number.MAX_SAFE_INTEGER;
  if (change.op === "reorder") return order.get(change.parentId) ?? Number.MAX_SAFE_INTEGER;
  return lastChildPosition(cv, order, change.parentId) + 0.5;
}

function lastChildPosition(cv: Cv, order: Map<string, number>, parentId: string): number {
  const own = order.get(parentId) ?? Number.MAX_SAFE_INTEGER;
  const lists: Array<{ id: string; ids: string[] }> = [
    ...cv.experience.map((j) => ({ id: j.id as string, ids: j.bullets.map((b) => b.id as string) })),
    ...cv.education.map((j) => ({ id: j.id as string, ids: j.bullets.map((b) => b.id as string) })),
    ...cv.projects.map((j) => ({ id: j.id as string, ids: j.bullets.map((b) => b.id as string) })),
    { id: "skills", ids: cv.skills.map((s) => s.id as string) },
    ...cv.additionalSections.map((s) => ({ id: s.id as string, ids: s.items.map((i) => i.id as string) })),
  ];
  const last = lists.find((l) => l.id === parentId)?.ids.at(-1);
  return last ? (order.get(last) ?? own) : own;
}
