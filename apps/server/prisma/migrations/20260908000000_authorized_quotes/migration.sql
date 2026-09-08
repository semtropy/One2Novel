CREATE TABLE "AuthorizedQuote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersionId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthorizedQuote_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "AuthorizedQuote_projectId_text_sourceVersionId_key" ON "AuthorizedQuote"("projectId", "text", "sourceVersionId");
CREATE INDEX "AuthorizedQuote_projectId_createdAt_idx" ON "AuthorizedQuote"("projectId", "createdAt");
