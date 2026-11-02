# Fix #90: Questions about what the CV already states, decisions

Bug and decisions: #90. A Run asked about React and Node.js (named in the skills list) and about "2+ years" for a role reading "2024 – now".

## Cause
- The Claim rule caps a Requirement whose only Evidence is the skills list or summary at partially met (slice 3, #18), and slice 5 asks a Question about every partially met must-have. Together, a skill named only in the skills list was always asked about.
- The Coverage prompt had no today's date and no tenure, and was told a bare year can't prove a duration.
- An Answer never reached Coverage. Only the Tailor read User Evidence, and Changes can't touch dates, so answering a duration Question changed nothing.

## Decisions (owner, 2026-11-01)
- **Skills list:** a `skill` Requirement partially met only through Claims keeps its 0.5 in the Match Score but isn't asked. Other kinds still ask (for example "Node.js backend development").
- **Tenure:**
  - Computed in code (`shared/src/tenure.ts`) as of an injected today. A bare-year start ranges from January to December of that year.
  - The Coverage prompt carries `Today:` and each dated Item's tenure, for example `2024 – present (1y11m to 2y10m as of Nov 2026)`. The tailor, claim-check and condense prompts don't.
  - A duration is met when the shortest tenure reaches it, and code corrects a met the dates can't prove.
  - A straddling range asks the start month, with the role named from the CV.
- **Answer loop:**
  - A new graph node `rejudge_answers`, after `collect_answers`, judges the answered Requirements again with the Answers as citable User Evidence (`ueN`).
  - Later re-judges also see them.
  - The Match Score before the Answers (`scoreBefore`) stays the CV as uploaded, so the gain from answering shows in Review.
  - A failed re-judge is logged and never fails the Run.

## Supersedes
- `03-scoring/decisions.md`: "a bare year cannot prove a duration", which lived in the prompt only.
- `05-questions/decisions.md`: User Evidence reaching the score only through Changes.
