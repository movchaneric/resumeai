# Trace content is outside the Run deletion guarantee, so it is off by default

Phoenix traces from OpenInference record full prompts and outputs by default, which means CV text, contact details and the structured CV. ADR 0002 promises that Run data is deleted after its TTL or on demand, but `DELETE /runs/:id` and the TTL sweep do not touch Phoenix, so a recorded CV would outlive its Run indefinitely. We still want content in local traces, because seeing why the model misread a CV is the main use of Phoenix while tuning extraction on a local model.

So recording content is a config switch, `TRACE_CONTENT`, that defaults to `false`; only the local `.env.example` turns it on. `loadConfig` refuses to start when `NODE_ENV=production` and `TRACE_CONTENT=true`. Without content, spans keep timings, token counts, retries, failure reasons and the verbatim-mismatch count.

**Consequences.** Any deployment must set `NODE_ENV=production`; the deployment design (still open) inherits this requirement. Turning content on anywhere real users' CVs flow requires Phoenix retention at or below the Run TTL, and revisiting this ADR.

**Considered options.** Never recording content (safe, but leaves Phoenix nearly useless for debugging extraction) and always recording it until deployment (the same as this today, minus the guard someone would forget).
