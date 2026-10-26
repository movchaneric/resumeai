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
The Job Description in structured form: title, company, and its list of Requirements. It is cached per Job Description text (ADR 0007), so every Run on the same text gets the same Requirements.
_Avoid_: Parsed job, job data

**Run**:
One end-to-end tailoring session for a single CV and Job Description, from upload to exported Tailored CV. A Run is anonymous, addressed by an unguessable ID, and deleted after its time-to-live or on demand.
_Avoid_: Session, job, task, thread

**Pause**:
A point where a Run waits for the user: for Answers to its Questions, or for review of its Changes. A Pause is durable; it ends only when the user acts or the Run's time-to-live runs out.
_Avoid_: Interrupt, wait, hold

**Interrupted Run**:
A Run that a server stop cut off and that could not be resumed from where it was. It is final: the user starts a new Run. A Run a stop cut off that could be resumed simply carries on and is not an Interrupted Run.
_Avoid_: Crashed run, paused run, failed run (failed means the work itself broke)

**Confirmed Gap**:
A Requirement the user has said they cannot satisfy. It is not asked about again, the tailor does not target it, and it counts toward the point where no further improvement is possible. Its Coverage verdict is unchanged.
_Avoid_: Skipped question, missing skill

**Tailored CV**:
A new CV generated from the candidate's CV, adjusted to fit one Job Description and rendered into a template. It never invents facts.
_Avoid_: Improved CV, optimized CV, rewritten CV

**Change**:
One proposed modification to a single text Item of the CV (reword it, add a new Item, or reorder a list), linked to the Evidence that supports it. Its text may reword the Evidence and use the Job Description's wording, but states nothing the Evidence does not state: no new technologies, numbers, scope, roles or achievements. Dates, companies, titles and degrees are never changed. The user can accept, reject, or revise each Change; a revised Change carries the user's own text, is trusted, and is locked against further rewriting.
_Avoid_: Suggestion, edit (edit means the user's own revision of a Change)

**Evidence**:
A piece of the CV, or a fact the user supplied during the session, that supports a Change or a Requirement Coverage verdict.
_Avoid_: Proof, source, reference

**User Evidence**:
Evidence the user supplied by answering a Question. The fact is trusted: we never question whether it is true. A Change built on it is still checked against its text, like any Change against CV Evidence. It reaches the Match Score only through Changes that put it into the CV.
_Avoid_: User input, user claim

**Question**:
A prompt asking the user about a must-have Requirement that the CV leaves unmet or only partially met (Soft Skills included). At most five are asked, once, before tailoring.
_Avoid_: Prompt, query

**Answer**:
The user's reply to a Question: either a description of their experience, which becomes User Evidence, or a statement that they have none, which makes the Requirement a Confirmed Gap.
_Avoid_: Response, input

**Requirement**:
A single skill, qualification, responsibility or Soft Skill extracted from the Job Description, marked must-have or nice-to-have.
_Avoid_: Keyword, criterion

**Soft Skill**:
A Requirement (kind `soft_skill`) that asks for a behaviour or way of working, such as ownership, attention to detail, collaboration or iterating quickly, rather than a tool, task or duty. Its Coverage is met or unmet, never partially met.
_Avoid_: Trait, quality, people skill

**Requirement Coverage**:
A judgment of how well the CV satisfies one Requirement (met, partially met, unmet), with the CV evidence cited. A Requirement is met only when an Item shows it in use; a Claim alone makes it partially met at most, except for a language, which a Claim can meet. A duration ("3+ years") that the cited Items' dates cannot prove is partially met. A Soft Skill is met only when an Item describes the behaviour; otherwise it is unmet.
_Avoid_: Match, hit

**Claim**:
A mention of a skill or quality in the candidate's skills list or summary, without an Item that shows it in use (a job, project, education entry, certification, or an entry in another section).
_Avoid_: Keyword, buzzword, self-reported skill

**Match Score**:
A reproducible number from 0 to 100, aggregated deterministically from all Requirement Coverage verdicts, weighting must-haves above nice-to-haves, and responsibilities and Soft Skills below the other kinds of Requirement. It is not an ATS score and is not keyword-based.
_Avoid_: ATS score, rating, fit
