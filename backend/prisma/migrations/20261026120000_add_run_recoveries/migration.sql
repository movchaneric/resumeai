-- AlterTable
ALTER TABLE "app"."runs" ADD COLUMN     "recoveries" INTEGER NOT NULL DEFAULT 0,
ADD CONSTRAINT "runs_recoveries_non_negative" CHECK ("recoveries" >= 0);
