# Exports are rendered on demand, never stored

The Tailored CV is downloaded as DOCX or PDF. Each download reads the `completed` CV from the Run's checkpoint, renders the file in memory and streams it; no exported file is ever written. This amends ADR 0002, which said "extracted structure and exported files are kept until the TTL": now only the extracted structure is kept, so deleting a Run's row and checkpoints (`DELETE /runs/:id` and the TTL sweep) already removes everything, and `runs.export_path` goes.

Rendering needs no model call and takes milliseconds, and the result depends only on the stored CV and the template, so a stored copy would gain nothing. It would cost a second copy of the CV to delete, a partial-failure path between the file and the row, and a server tied to one disk.

**Consequences.** A template change applies to every Run on its next download, including Runs completed earlier; a download is not a frozen record of what the user saw before. If exports ever need to be frozen (accounts, a download history), store them then, with their deletion covered by the same TTL.

**Considered options.** Writing both files in an `export` graph node when the Run completes (the plan before slice 6b): stored personal data and cleanup for no speed gain. Rendering in the browser: the one-page measurement must run on the server anyway, to check a Review and to guide tailoring (slice 6c).
