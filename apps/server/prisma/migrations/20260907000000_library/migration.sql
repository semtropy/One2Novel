-- CreateTable
CREATE TABLE "LibraryCommand" (
    "scope" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    CONSTRAINT "LibraryCommand_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReferenceSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "originalHash" TEXT NOT NULL,
    "original" BLOB NOT NULL,
    "format" TEXT NOT NULL,
    "encoding" TEXT NOT NULL,
    "textId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "activeSplitId" TEXT,
    "activeModelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ReferenceSplit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferenceSplit_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ReferenceSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReferenceAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT NOT NULL,
    "splitId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNANALYZED',
    "totalChars" INTEGER NOT NULL,
    "completedChars" INTEGER NOT NULL DEFAULT 0,
    "registryHead" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReferenceAnalysis_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ReferenceSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ReferenceAnalysis_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "ReferenceSplit" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReferenceUnit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "chapterNo" INTEGER NOT NULL,
    "start" INTEGER NOT NULL,
    "end" INTEGER NOT NULL,
    "inputStart" INTEGER NOT NULL,
    "inputHash" TEXT NOT NULL,
    "registryVersion" INTEGER NOT NULL,
    "retrieval" JSONB,
    "payload" JSONB,
    "hash" TEXT,
    CONSTRAINT "ReferenceUnit_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ReferenceAnalysis" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReferenceEntity" (
    "rowId" TEXT NOT NULL PRIMARY KEY,
    "entityId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "throughUnit" INTEGER NOT NULL,
    "chapterNo" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    CONSTRAINT "ReferenceEntity_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ReferenceAnalysis" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ReferenceAggregate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "analysisId" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    CONSTRAINT "ReferenceAggregate_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "ReferenceAnalysis" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "activeVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "KnowledgeVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "sourceVersionId" TEXT,
    "publishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "KnowledgeItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KnowledgeBinding" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    CONSTRAINT "KnowledgeBinding_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KnowledgeBinding_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "KnowledgeVersion" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentId" TEXT,
    "pauseRequested" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT NOT NULL DEFAULT 'QUEUED',
    "number" INTEGER,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "chainEpoch" INTEGER NOT NULL,
    "baseSnapshotId" TEXT,
    "input" JSONB NOT NULL,
    "config" JSONB NOT NULL,
    "artifactRefs" JSONB NOT NULL,
    "httpUsed" INTEGER NOT NULL DEFAULT 0,
    "httpLimit" INTEGER NOT NULL DEFAULT 40,
    "bodyRepairs" INTEGER NOT NULL DEFAULT 0,
    "deltaRepairs" INTEGER NOT NULL DEFAULT 0,
    "bodyRepairLimit" INTEGER NOT NULL DEFAULT 2,
    "deltaRepairLimit" INTEGER NOT NULL DEFAULT 2,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "generationText" TEXT NOT NULL DEFAULT '',
    "generationComplete" BOOLEAN NOT NULL DEFAULT false,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("artifactRefs", "attempt", "baseSnapshotId", "bodyRepairLimit", "bodyRepairs", "cancelRequested", "chainEpoch", "config", "createdAt", "deltaRepairLimit", "deltaRepairs", "errorCode", "errorMessage", "generationComplete", "generationText", "httpLimit", "httpUsed", "id", "input", "kind", "number", "parentId", "pauseRequested", "projectId", "revision", "stage", "status", "updatedAt") SELECT "artifactRefs", "attempt", "baseSnapshotId", "bodyRepairLimit", "bodyRepairs", "cancelRequested", "chainEpoch", "config", "createdAt", "deltaRepairLimit", "deltaRepairs", "errorCode", "errorMessage", "generationComplete", "generationText", "httpLimit", "httpUsed", "id", "input", "kind", "number", "parentId", "pauseRequested", "projectId", "revision", "stage", "status", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");
CREATE UNIQUE INDEX "Job_parentId_number_key" ON "Job"("parentId", "number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "LibraryCommand_jobId_key" ON "LibraryCommand"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceSource_originalHash_key" ON "ReferenceSource"("originalHash");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceSource_textId_key" ON "ReferenceSource"("textId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceAnalysis_jobId_key" ON "ReferenceAnalysis"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceUnit_analysisId_number_key" ON "ReferenceUnit"("analysisId", "number");

-- CreateIndex
CREATE INDEX "ReferenceEntity_analysisId_throughUnit_idx" ON "ReferenceEntity"("analysisId", "throughUnit");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceEntity_analysisId_entityId_throughUnit_key" ON "ReferenceEntity"("analysisId", "entityId", "throughUnit");

-- CreateIndex
CREATE UNIQUE INDEX "ReferenceAggregate_analysisId_inputHash_key" ON "ReferenceAggregate"("analysisId", "inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeVersion_itemId_number_key" ON "KnowledgeVersion"("itemId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeBinding_projectId_versionId_key" ON "KnowledgeBinding"("projectId", "versionId");
