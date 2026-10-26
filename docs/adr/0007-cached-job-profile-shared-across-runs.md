# A cached Job Profile is shared across Runs

The same Job Description produced a different Job Profile on every Run (wording, count and splitting of Requirements), which moved the Match Score by up to 10 points on identical input (#18). So the Job Profile is cached per Job Description in a new `app.job_profiles` table, keyed by a hash of the normalized Job Description text and an extraction version (judge model name plus a hash of the Job Profile prompt and schema). This amends ADR 0003: it is the first store whose data outlives a single Run.

The cache is a lookup only. On a hit the profile is copied into the Run's graph state, so each Run still holds all its own data in the checkpoint, and nothing in a Run refers to a cache row. First write wins when two Runs miss at once. A cache failure counts as a miss and never fails a Run. The raw Job Description text is not stored, only its hash and the profile.

**Retention.** A cached profile expires 7 days after it is created, the same TTL as a Run (ADR 0002), enforced on read; the TTL sweep (slice 6) deletes expired rows with expired Runs. `DELETE /runs/:id` leaves the cache alone: a Job Description is usually public text, and the profile belongs to no single Run. A pasted Job Description can still hold a recruiter's name, which is why the TTL applies at all.

**Consequences.** A changed model or prompt changes the key, so stale profiles are never served and no flush exists. A bad extraction stays frozen for that Job Description for up to 7 days. Accounts or saved Job Descriptions (ADR 0003's "revisit") would make this table the natural place to start.

**Considered options.** Steadier extraction alone (stricter splitting rules, temperature 0, OpenAI `seed`): `seed` is not guaranteed and wording drifts even at temperature 0, so it only shrinks the spread. Keeping the profile forever: a pasted Job Description could outlive every Run that used it. Deleting it with the last Run that used it: needs reference counting for little gain.
