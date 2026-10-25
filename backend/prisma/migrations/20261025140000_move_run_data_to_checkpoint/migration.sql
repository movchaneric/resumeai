-- Slice 4a (ADR 0003): Run data now lives in the graph checkpoint. Dev Runs held the old transitional
-- columns and have no checkpoint, so they are deleted. The `scored` status is gone; nothing else changes.
DELETE FROM "app"."runs";

-- AlterTable
ALTER TABLE "app"."runs" DROP COLUMN "cv_text",
DROP COLUMN "job_description_text",
DROP COLUMN "cv",
DROP COLUMN "job_profile",
DROP COLUMN "coverage";
