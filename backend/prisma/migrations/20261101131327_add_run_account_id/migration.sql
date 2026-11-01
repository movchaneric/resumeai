-- AlterTable
ALTER TABLE "app"."runs" ADD COLUMN     "account_id" TEXT;

-- CreateIndex
CREATE INDEX "runs_account_id_idx" ON "app"."runs"("account_id");

-- AddForeignKey
ALTER TABLE "app"."runs" ADD CONSTRAINT "runs_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
