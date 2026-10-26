# #18 decisions: a steady Match Score

Settled in a grilling session (2026-10-26) after the two measurements on the issue. All decisions are owner-approved. Terms follow `CONTEXT.md`, which was updated in the same session.

Issue: [#18 Match Score varies by up to 15 points on identical input](https://github.com/movchaneric/resumeai/issues/18). Tickets are linked from it.

## What "fixed" means
- **Both kinds of stability.** The before → after gap inside a Run must be trustworthy, and the same CV and Job Description must give the same score across Runs. `CONTEXT.md` calls the Match Score "reproducible", so fixing only the in-Run gap would break that promise.
- Inside one Run the Job Profile never changes (it is extracted once, and only addressed Requirements are re-judged), so cause 2 below only moves the score across Runs. Cause 1 moves both.
- **Target**, on both jobs measured in #18: experiments A (end to end, 5 runs) and C (Coverage only, 10 runs) each have **range ≤ 5 points and stdev ≤ 1.5**. The exit router's `MIN_GAIN` is 2 points, so noise has to stay well below a real tailoring gain.

## The two causes (numbers in the #18 comments)
1. **Coverage verdicts on soft-skill Requirements flip**, between `partially_met` and `unmet`, and the flips are correlated within one call (a whole run comes out lenient or harsh). The unstable rule is "`partially_met` when an Item is related". Dominant on the soft-skill-heavy job.
2. **The Job Profile changes on every run**: wording, count and splitting. Dominant on the concrete job.

## T1: a cached Job Profile (cause 2)
- **Cache the Job Profile per Job Description.** The same text always gets the same Requirements. ADR [0007](../../adr/0007-cached-job-profile-shared-across-runs.md) records it, because it is the first store that outlives a Run.
- Rejected: steadier extraction alone (tighter rules, `seed`): OpenAI does not guarantee `seed`, and wording drifts at temperature 0, so it only shrinks the spread. Leaving it: the across-Run promise stays broken.
- **Key**: sha256 of the normalized Job Description text (trimmed, whitespace runs collapsed, line endings unified) together with an **extraction version**: the judge model name and a hash of the Job Profile system prompt and the extraction schema. A model or prompt change produces new keys, so stale entries are never hit and nobody has to remember a flush.
- **Each Run keeps its own copy.** On a hit the cached profile is copied into the Run's graph state, exactly like a freshly extracted one. A Run never refers to the cache row, so ADR 0003 still holds per Run, and an expired cache entry cannot break a Run.
- **Storage**: a new `app.job_profiles` table (Prisma, ADR 0005): `key`, `profile` (JSONB), `created_at`, `expires_at`. The raw Job Description text is not stored. `stores/jobProfiles.ts` implements a `JobProfileCache` interface (`get`, `put`) that the graph defines, as the service defines `GraphRunner`; `index.ts` passes the store into the runner. The `extract` node looks up, extracts on a miss, and saves.
- **Two Runs at once**: first write wins (insert, ignore on conflict), so every later Run agrees with the first saved profile.
- **Failure**: a failed `get` is a miss and a failed `put` is ignored. The span records `jobProfile.cache` = `hit`, `miss` or `error`. The cache only steadies the score; it must never fail a Run.
- **Expiry**: 7 days from creation, as for a Run (ADR 0002). Like Runs, expiry is enforced on read (`get` ignores expired rows); the TTL sweep planned for slice 6 deletes expired rows together with expired Runs. `DELETE /runs/:id` does not touch the cache, because the profile is not that Run's data.
- Accepted: a bad extraction (for example 14 responsibilities merged into one, seen once in #18) stays frozen for that Job Description for up to 7 days.
- **`stability`**: experiment A goes through the real cache (run 1 misses, the rest hit), so it measures what users get. `--no-cache` restores the old behaviour for comparison.

## T2: a soft-skill kind (cause 1)
- **A new Requirement kind, `soft_skill`**, assigned by Job Profile extraction: behaviours and ways of working (ownership, attention to detail, collaboration, iterating quickly, problem-solving mindset), not tools, tasks or duties. The label is an LLM's, but T1 caches it, so it is stable per Job Description.
- Rejected: a keyword list (brittle across phrasing and languages); Coverage flagging soft skills (puts the label back in the noisy call).
- **Binary verdict.** A `soft_skill` is `met` only when an Item describes the behaviour; otherwise `unmet`. There is no `partially_met`. The Coverage prompt states it, Requirements are rendered with their kind so the model can see it, and `coverageRules.ts` turns any `partially_met` on a `soft_skill` into `unmet` and counts it in `downgrades`, so the rule holds even when the model ignores it.
- **Weight**: kind factor 0.5, as for `responsibility` (ADR 0004).
- Rejected: leaving soft skills out of the score (changes what the score means for soft-skill-heavy jobs). Slice 5 can still turn unmet soft skills into Questions.
- **`responsibility` is unchanged.** "Ways of working" items move to `soft_skill`; real duties keep `partially_met`, where "related" is meaningful.

## In reserve, only if the target is missed
- A majority vote over several Coverage calls, or one call per Requirement. Both multiply LLM calls, including re-judges in the tailoring loop.
- Showing a score range.
- If A misses the target while C passes, the remaining spread comes from CV extraction (experiment D is no longer needed: once the cache exists, A is D).

## Out of scope
- The claim-check eval (how many tailor Changes the claim check accepts on made-up CVs): its own issue, near slice 5's "the claim check trusts User Evidence".
- Experiment D.

## Process
- One branch, `fix/18-score-stability`, and one PR. T1 and T2 are issues linked to #18, built test-first by Sonnet agents in separate worktrees and merged into the branch.
- Proof: the owner reruns `stability` on both jobs; the before and after spreads go to #18.
