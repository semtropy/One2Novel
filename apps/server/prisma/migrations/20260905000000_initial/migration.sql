-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "idea" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "requirements" JSONB NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "targetLength" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "chainEpoch" INTEGER NOT NULL DEFAULT 0,
    "headChapter" INTEGER NOT NULL DEFAULT 0,
    "headSnapshotId" TEXT,
    "openingId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Chapter" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "activeContentId" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "draft" TEXT NOT NULL DEFAULT '',
    "draftRevision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "Chapter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Artifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "baseSnapshotId" TEXT,
    "jobId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Artifact_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chapterId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "parentId" TEXT,
    "contextId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Content_chapterId_fkey" FOREIGN KEY ("chapterId") REFERENCES "Chapter" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Snapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "chapterNo" INTEGER NOT NULL,
    "parentId" TEXT,
    "canonId" TEXT NOT NULL,
    "deltaId" TEXT,
    "validationId" TEXT,
    "contentId" TEXT,
    "stateHash" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "checkpoint" BLOB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Snapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Snapshot_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Snapshot" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Snapshot_deltaId_fkey" FOREIGN KEY ("deltaId") REFERENCES "Delta" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Delta" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "baseSnapshotId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "hash" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "StoryEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "eventOrder" INTEGER NOT NULL,
    "payload" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "PropositionVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "propositionId" TEXT NOT NULL,
    "snapshotId" TEXT NOT NULL,
    "payload" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
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
    CONSTRAINT "Job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActiveCommand" (
    "projectId" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    CONSTRAINT "ActiveCommand_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActiveCommand_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JobEvent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JobEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL
);

-- CreateTable
CREATE TABLE "CommitReceipt" (
    "jobId" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "PlanningRecheck" (
    "snapshotId" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "ConfigVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ConfigPointer" (
    "kind" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0
);

-- CreateIndex
CREATE UNIQUE INDEX "Chapter_projectId_number_key" ON "Chapter"("projectId", "number");

-- CreateIndex
CREATE INDEX "Artifact_projectId_kind_createdAt_idx" ON "Artifact"("projectId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Snapshot_deltaId_key" ON "Snapshot"("deltaId");

-- CreateIndex
CREATE INDEX "Snapshot_projectId_chapterNo_idx" ON "Snapshot"("projectId", "chapterNo");

-- CreateIndex
CREATE UNIQUE INDEX "StoryEvent_contentId_eventOrder_key" ON "StoryEvent"("contentId", "eventOrder");

-- CreateIndex
CREATE INDEX "PropositionVersion_projectId_snapshotId_idx" ON "PropositionVersion"("projectId", "snapshotId");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActiveCommand_jobId_key" ON "ActiveCommand"("jobId");

-- CreateIndex
CREATE INDEX "JobEvent_jobId_id_idx" ON "JobEvent"("jobId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_scope_key_key" ON "Receipt"("scope", "key");
