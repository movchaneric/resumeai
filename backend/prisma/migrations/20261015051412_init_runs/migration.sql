-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "app";

-- CreateTable
CREATE TABLE "app"."runs" (
    "id" UUID NOT NULL,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "export_path" TEXT,
    "cv_text" TEXT NOT NULL,
    "jd_text" TEXT NOT NULL,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);
