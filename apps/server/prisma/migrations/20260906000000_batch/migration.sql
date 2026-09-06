ALTER TABLE "Job" ADD COLUMN "parentId" TEXT REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Job" ADD COLUMN "pauseRequested" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "Job_parentId_number_key" ON "Job"("parentId", "number");
