-- AlterTable
ALTER TABLE "app"."runs" ADD COLUMN     "cv" JSONB,
ADD COLUMN     "error_code" TEXT,
ADD COLUMN     "error_message" TEXT,
ADD COLUMN     "job_profile" JSONB;
