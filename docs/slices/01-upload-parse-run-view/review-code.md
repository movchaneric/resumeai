# Slice 1 code review

`/code-review medium` on the slice 1 diff. Ten findings; six were fixed in this slice.

## Fixed
- PDF document is destroyed after extraction (`loadingTask.destroy()`), including on early rejections.
- NUL characters are stripped from extracted CV text and the Job Description (Postgres TEXT rejects them; it was a 500).
- The scanned-PDF check counts non-whitespace characters only, so page separators cannot make a scan look like text.
- multer also limits `fields`, `parts` and `fieldNameSize`.
- The error handler checks `res.headersSent`, and unknown paths answer with the JSON `{ code, message }` shape instead of Express's HTML 404.
- The server closes and disconnects Prisma on SIGINT and SIGTERM.

## Not fixed, on purpose
- **Expired Runs are only hidden, not deleted.** Extracted CV text stays in `app.runs` after `expiresAt` until the slice 5 sweep, and `RunStore.delete` has no caller yet. This weakens the privacy promise in ADR 0002 in the meantime; do not ship publicly before slice 5.
- **The parse timeout does not stop the work.** `withTimeout` only stops waiting; a pathological PDF or a DOCX zip bomb can keep using CPU on the event loop after the client gets `EXTRACTION_FAILED`. Fix by parsing in a worker thread or child process that can be killed, and by capping decompressed DOCX size. Needed before untrusted public traffic.
- **`toRunView` always reports `extracting`.** Intended: slice 1 parks every Run there (see `decisions.md`). It must read `run.status` and real step state when slice 2 starts advancing Runs.
- **A DOCX over the character limit returns `TOO_MANY_PAGES`.** Agreed in the grilling session (one code for "CV too long"); the message differs. Revisit if the frontend needs to tell them apart.
