-- CONTEXT.md avoids "JD": the column is named after the Job Description in full.
ALTER TABLE "app"."runs" RENAME COLUMN "jd_text" TO "job_description_text";
