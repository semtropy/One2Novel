ALTER TABLE "Project" ADD COLUMN "planRevision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "PlanVersion" (
 "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "level" TEXT NOT NULL,
 "parentVersionId" TEXT, "supersedesVersionId" TEXT, "rangeStart" INTEGER NOT NULL,
 "rangeEnd" INTEGER NOT NULL, "payload" JSONB NOT NULL, "hash" TEXT NOT NULL,
 "baseSnapshotId" TEXT NOT NULL, "knowledgeHash" TEXT NOT NULL, "chainEpoch" INTEGER NOT NULL,
 "status" TEXT NOT NULL, "validationId" TEXT, "groupId" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "PlanVersion_projectId_level_status_idx" ON "PlanVersion"("projectId","level","status");
CREATE INDEX "PlanVersion_parentVersionId_idx" ON "PlanVersion"("parentVersionId");
