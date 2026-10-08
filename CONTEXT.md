# Resume AI

An app that takes a candidate's CV and a job description and produces a tailored CV that better fits that specific job, without inventing facts.

## Language

**CV**:
The candidate's original uploaded document (PDF or Word), and its structured form once extracted.
_Avoid_: Resume (in code and docs, pick one), profile

**Job Description**:
The raw text of the target job posting supplied by the candidate.
_Avoid_: JD, posting, vacancy

**Tailored CV**:
A new CV generated from the candidate's CV, adjusted to fit one Job Description and rendered into a template. It never invents facts.
_Avoid_: Improved CV, optimized CV, rewritten CV

**Change**:
One proposed modification to a single field of the CV, linked to the evidence that supports it. The user can accept, reject, or revise each Change.
_Avoid_: Suggestion, edit (edit means the user's own revision of a Change)

**Evidence**:
A piece of the CV, or a fact the user supplied during the session, that supports a Change or a Requirement Coverage verdict. User-supplied Evidence is trusted without LLM validation.
_Avoid_: Proof, source, reference

**Requirement**:
A single skill, qualification, or responsibility extracted from the Job Description, marked must-have or nice-to-have.
_Avoid_: Keyword, criterion

**Requirement Coverage**:
A judgment of how well the CV satisfies one Requirement (met, partially met, unmet), with the CV evidence cited.
_Avoid_: Match, hit

**Match Score**:
A reproducible number aggregated deterministically from all Requirement Coverage verdicts, weighting must-haves above nice-to-haves. It is not an ATS score and is not keyword-based.
_Avoid_: ATS score, rating, fit
