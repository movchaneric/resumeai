# Resume AI

An app that takes a candidate's CV and a job description and produces a tailored CV that better fits that specific job, without inventing facts.

## Language

**CV**:
The candidate's original uploaded document (PDF or Word), and its standardized structured form once extracted. The original layout is discarded; the candidate's own headings guide which field content belongs to.
_Avoid_: Resume (in code and docs, pick one), profile

**Parsing**:
Reading the uploaded CV file into plain text. No model is involved; a file that cannot be read is rejected before a Run exists.
_Avoid_: Extraction (that is the next step), reading

**Extraction**:
Turning the CV text into the structured CV, and the Job Description into the Job Profile, with a model. Text is copied verbatim; dates, companies, titles and degrees must match the uploaded document.
_Avoid_: Parsing, structuring

**Section**:
A titled group of content in the CV. Core sections (contact, summary, experience, education, skills, projects, certifications) are typed; any other heading the candidate used becomes an additional section carrying that heading as its title.
_Avoid_: Block, category

**Item**:
A single addressable piece of CV content, such as one job, one bullet, or one skill. Every Item has a stable ID that never changes during a run, and Changes and Evidence refer to Items by that ID.
_Avoid_: Entry, node, element

**Job Description**:
The raw text of the target job posting supplied by the candidate.
_Avoid_: JD, posting, vacancy

**Job Profile**:
The Job Description in structured form: title, company, and its list of Requirements.
_Avoid_: Parsed job, job data

**Run**:
One end-to-end tailoring session for a single CV and Job Description, from upload to exported Tailored CV. A Run is anonymous, addressed by an unguessable ID, and deleted after its time-to-live or on demand.
_Avoid_: Session, job, task, thread

**Confirmed Gap**:
A Requirement the user has said they cannot satisfy. It is not asked about again and counts toward the point where no further improvement is possible.
_Avoid_: Skipped question, missing skill

**Tailored CV**:
A new CV generated from the candidate's CV, adjusted to fit one Job Description and rendered into a template. It never invents facts.
_Avoid_: Improved CV, optimized CV, rewritten CV

**Change**:
One proposed modification to a single text Item of the CV (reword it, add a new Item, or reorder a list), linked to the Evidence that supports it. Dates, companies, titles and degrees are never changed. The user can accept, reject, or revise each Change; a revised Change carries the user's own text, is trusted, and is locked against further rewriting.
_Avoid_: Suggestion, edit (edit means the user's own revision of a Change)

**Evidence**:
A piece of the CV, or a fact the user supplied during the session, that supports a Change or a Requirement Coverage verdict.
_Avoid_: Proof, source, reference

**User Evidence**:
Evidence the user supplied by answering a Question. It is trusted without LLM validation.
_Avoid_: User input, user claim

**Question**:
A prompt asking the user about an unmet must-have Requirement that has no usable Evidence in the CV.
_Avoid_: Prompt, query

**Answer**:
The user's reply to a Question: either a description of their experience, which becomes User Evidence, or a statement that they have none, which makes the Requirement a Confirmed Gap.
_Avoid_: Response, input

**Requirement**:
A single skill, qualification, or responsibility extracted from the Job Description, marked must-have or nice-to-have.
_Avoid_: Keyword, criterion

**Requirement Coverage**:
A judgment of how well the CV satisfies one Requirement (met, partially met, unmet), with the CV evidence cited.
_Avoid_: Match, hit

**Match Score**:
A reproducible number aggregated deterministically from all Requirement Coverage verdicts, weighting must-haves above nice-to-haves. It is not an ATS score and is not keyword-based.
_Avoid_: ATS score, rating, fit
