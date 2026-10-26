-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "searchName" TEXT NOT NULL,
    "searchPhone" TEXT NOT NULL,
    "searchEmail" TEXT NOT NULL,
    "searchPropertyTitle" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "budgetFils" BIGINT,
    "source" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'new',
    "propertyId" TEXT,
    "propertyTitleSnapshot" TEXT,
    "propertyLocationSnapshot" TEXT,
    "assignedAgentId" TEXT,
    "assignedAgentNameSnapshot" TEXT,
    "createdById" TEXT,
    "originalMessage" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Lead_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_assignedAgentId_fkey" FOREIGN KEY ("assignedAgentId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Lead_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "authorNameSnapshot" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadNote_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeadNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorNameSnapshot" TEXT,
    "type" TEXT NOT NULL,
    "noteId" TEXT,
    "previousStage" TEXT,
    "nextStage" TEXT,
    "previousAgentId" TEXT,
    "previousAgentName" TEXT,
    "nextAgentId" TEXT,
    "nextAgentName" TEXT,
    "changedFields" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeadActivity_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "LeadActivity_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "LeadNote" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LeadSubmissionReceipt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "operation" TEXT NOT NULL,
    "actorScope" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "noteId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadSubmissionReceipt_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "LeadSubmissionReceipt_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "LeadNote" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Lead_assignedAgentId_createdAt_id_idx" ON "Lead"("assignedAgentId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Lead_assignedAgentId_stage_createdAt_idx" ON "Lead"("assignedAgentId", "stage", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_source_createdAt_idx" ON "Lead"("source", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_updatedAt_id_idx" ON "Lead"("updatedAt", "id");

-- CreateIndex
CREATE INDEX "Lead_propertyId_idx" ON "Lead"("propertyId");

-- CreateIndex
CREATE INDEX "LeadNote_leadId_createdAt_id_idx" ON "LeadNote"("leadId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "LeadActivity_noteId_key" ON "LeadActivity"("noteId");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_createdAt_id_idx" ON "LeadActivity"("leadId", "createdAt", "id");
ALTER TABLE "User" ADD COLUMN "searchName" TEXT NOT NULL DEFAULT '';
