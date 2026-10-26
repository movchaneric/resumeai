-- CreateTable
CREATE TABLE "app"."job_profiles" (
    "key" TEXT NOT NULL,
    "profile" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_profiles_pkey" PRIMARY KEY ("key")
);
