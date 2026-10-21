# 05 CV extraction

**Goal:** turn CV text into a validated `Cv` with stable Item IDs, where companies, titles, institutions, degrees, certification names and date years are proven to come from the CV text, retrying once with feedback.

**Waits for:** 02 and 03. Runs in parallel with 04.

**Plan sections:** `extractCv.ts`, `assignIds.ts` and `verbatim.ts` under "`backend/src/extraction/`" and their rows in "Tests" in `../plan.md`. Background: "Validation and retries" and "IDs" in `../decisions.md`; ADR 0004 (dates validated in two stages; IDs are branded; reserved `SectionId` values).

## What to build

1. **`extraction/assignIds.ts`**: pure `assignCvIds(extracted: ExtractedCv): Cv`. IDs, assigned in order:

   | Section | IDs |
   |---|---|
   | contact, summary | `contact`, `summary` |
   | experience | `exp1`, `exp1.b1` |
   | education | `edu1`, `edu1.b1` |
   | skills | `skill1` |
   | projects | `proj1`, `proj1.b1` |
   | certifications | `cert1` |
   | additional sections | `sec1`, `sec1.i1` |

   The prefix comes from the section type, never from the candidate's heading. Parse the result with `CvSchema`, which runs the refined `DateRangeSchema`. On failure throw something carrying readable issues (`experience[1].dates: End date is before start date`), so the caller can feed them back.
2. **`extraction/verbatim.ts`**: pure `checkVerbatim(cv: ExtractedCv, sourceText: string): { issues: string[]; softMismatches: number }`.
   - Normalize both sides: Unicode NFKC, lowercase, punctuation replaced by spaces (keep letters and digits of any script), whitespace collapsed.
   - Protected fields must be substrings of the normalized source: experience `company` and `title`, education `institution`, `degree` and `field`, certification `name`. Null fields are skipped. Each miss is an issue such as `experience[1].company "Acme Ltd" not found in the CV text`.
   - The four-digit year of every non-null `start`, `end` and certification `date` must appear in the source as a whole number.
   - Bullets, summary, skills and additional-section items that are not found only add to `softMismatches`.
3. **`extraction/extractCv.ts`**: `extractCv(llm: LlmClient, cvText: string): Promise<{ cv: Cv; softMismatches: number }>`.
   - System prompt (a named constant): copy text verbatim; the candidate's headings decide the section; dates as `YYYY` or `YYYY-MM`; `current: true` and `end: null` for Present/Current; a bare year stays a bare year (never invent a month); unknown headings go to `additionalSections` with the heading as `title`; the text may come from a two-column layout, so a sidebar block can appear before or after the main content.
   - `llm.structured(ExtractedCvSchema, messages, { name: "extract_cv" })`.
   - Then, in order: `normalizeDateRange` on every range; the **empty-CV rule** (no experience, education, projects or skills is an issue: "No CV content was found"); `checkVerbatim`; `assignCvIds`.
   - Any issue from the schema (`LlmSchemaError`), the empty-CV rule, the verbatim check or `assignCvIds` triggers one retry with a user message listing the issues. A second failure throws `ExtractionError` with the issues.
   - `LlmUnavailableError` is not retried; let it propagate.

## Tests (`backend/test/extraction/`, with `FakeLlmClient` and hand-written extracted objects)
- `assignIds.test.ts`: the full ID scheme on a CV with every section; IDs are unique; none equals a reserved `SectionId`; an end-before-start range fails with a readable issue.
- `verbatim.test.ts`: exact, case, whitespace and punctuation variants pass; a changed title fails with a readable issue; a year missing from the source fails; a paraphrased bullet only increments `softMismatches`; null fields are skipped.
- `extractCv.test.ts`: valid on the first try; verbatim failure then valid (the second call carries the issue); date refinement failure then valid; empty CV twice gives `ExtractionError`; `LlmUnavailableError` is not retried; `current: true` with an end date is normalized, not rejected.

## Acceptance
- `pnpm typecheck` passes; `pnpm --filter backend test test/extraction` passes.
- Touches only `extractCv.ts`, `assignIds.ts`, `verbatim.ts` and their tests.
