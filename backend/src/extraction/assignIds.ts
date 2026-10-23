import { CvSchema } from "@resume-ai/shared";
import type { Cv, ExtractedCv } from "@resume-ai/shared";
import { ExtractionError } from "@/extraction/errors.js";

const texts = (items: string[], prefix: string) => items.map((text, i) => ({ id: `${prefix}${i + 1}`, text }));

/**
 * Assigns the stable, position-based Item IDs and validates the result as a `Cv`
 * (which runs the refined date ranges). The prefix comes from the section type, never the heading.
 * Throws `ExtractionError` with readable `path: message` issues.
 */
export function assignCvIds(extracted: ExtractedCv): Cv {
  const withIds = {
    contact: { id: "contact", ...extracted.contact },
    summary: extracted.summary === null ? null : { id: "summary", text: extracted.summary },
    experience: extracted.experience.map((e, i) => ({
      id: `exp${i + 1}`,
      ...e,
      bullets: texts(e.bullets, `exp${i + 1}.b`),
    })),
    education: extracted.education.map((e, i) => ({
      id: `edu${i + 1}`,
      ...e,
      bullets: texts(e.bullets, `edu${i + 1}.b`),
    })),
    skills: texts(extracted.skills, "skill"),
    projects: extracted.projects.map((p, i) => ({
      id: `proj${i + 1}`,
      ...p,
      bullets: texts(p.bullets, `proj${i + 1}.b`),
    })),
    certifications: extracted.certifications.map((c, i) => ({ id: `cert${i + 1}`, ...c })),
    additionalSections: extracted.additionalSections.map((s, i) => ({
      id: `sec${i + 1}`,
      title: s.title,
      items: texts(s.items, `sec${i + 1}.i`),
    })),
  };

  const parsed = CvSchema.safeParse(withIds);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`);
    throw new ExtractionError("The extracted CV is invalid", issues);
  }
  return parsed.data;
}

/** `["experience", 1, "dates"]` -> `experience[1].dates` */
function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>(
    (acc, part) => (typeof part === "number" ? `${acc}[${part}]` : acc ? `${acc}.${String(part)}` : String(part)),
    "",
  );
}
