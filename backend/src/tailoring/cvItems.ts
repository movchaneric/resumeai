import type { Cv } from "@resume-ai/shared";

type IdOnly = { id: string };

/** The ordered list of children under a parent: a top-level list, a job/project/education entry (its bullets) or an additional section (its items). */
export function childLists(cv: Cv): Map<string, IdOnly[]> {
  const lists = new Map<string, IdOnly[]>([
    ["experience", cv.experience],
    ["education", cv.education],
    ["skills", cv.skills],
    ["projects", cv.projects],
    ["certifications", cv.certifications],
  ]);
  for (const group of [cv.experience, cv.education, cv.projects]) {
    for (const entry of group) lists.set(entry.id, entry.bullets);
  }
  for (const section of cv.additionalSections) lists.set(section.id, section.items);
  return lists;
}

/** Parents that accept a new text Item: the skills list, an experience / education / project entry, an additional section. */
export function textParentIds(cv: Cv): Set<string> {
  const ids = new Set<string>(["skills"]);
  for (const group of [cv.experience, cv.education, cv.projects]) for (const entry of group) ids.add(entry.id);
  for (const section of cv.additionalSections) ids.add(section.id);
  return ids;
}

/** Every text Item (the only kind a `replace` may target): the summary, bullets, skills and additional-section items. */
export function textItems(cv: Cv): Map<string, { id: string; text: string }> {
  const items = new Map<string, { id: string; text: string }>();
  if (cv.summary) items.set(cv.summary.id, cv.summary);
  for (const group of [cv.experience, cv.education, cv.projects]) {
    for (const entry of group) for (const bullet of entry.bullets) items.set(bullet.id, bullet);
  }
  for (const skill of cv.skills) items.set(skill.id, skill);
  for (const section of cv.additionalSections) for (const item of section.items) items.set(item.id, item);
  return items;
}

/** Every ID in the CV, including contact, entries, additional sections and the reserved list names. */
export function allIds(cv: Cv): Set<string> {
  const ids = new Set<string>([cv.contact.id, "experience", "education", "skills", "projects", "certifications"]);
  for (const id of textItems(cv).keys()) ids.add(id);
  for (const group of [cv.experience, cv.education, cv.projects, cv.certifications, cv.additionalSections]) {
    for (const entry of group) ids.add(entry.id);
  }
  return ids;
}

/** The text a number check reads for each Item ID (entries and certifications included, as Evidence may cite them). */
export function itemTexts(cv: Cv): Map<string, string> {
  const texts = new Map<string, string>();
  for (const [id, item] of textItems(cv)) texts.set(id, item.text);
  const join = (parts: (string | null | undefined)[]) => parts.filter((p): p is string => !!p).join(" ");
  const range = (d: { start: string | null; end: string | null } | null) => (d ? join([d.start, d.end]) : "");
  texts.set(cv.contact.id, join([cv.contact.name, cv.contact.email, cv.contact.phone, cv.contact.location]));
  for (const e of cv.experience) texts.set(e.id, join([e.title, e.company, e.location, range(e.dates)]));
  for (const e of cv.education) texts.set(e.id, join([e.institution, e.degree, e.field, range(e.dates)]));
  for (const p of cv.projects) texts.set(p.id, join([p.name, p.url, range(p.dates)]));
  for (const c of cv.certifications) texts.set(c.id, join([c.name, c.issuer, c.date]));
  return texts;
}
