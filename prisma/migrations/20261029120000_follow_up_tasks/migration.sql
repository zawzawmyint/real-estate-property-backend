CREATE TABLE "Task" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "submissionId" TEXT NOT NULL,
 "actorScope" TEXT NOT NULL,
 "payloadHash" TEXT NOT NULL,
 "leadId" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "notes" TEXT,
 "dueAt" DATETIME NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'open',
 "version" INTEGER NOT NULL DEFAULT 1,
 "completedAt" DATETIME,
 "cancelledAt" DATETIME,
 "createdById" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "Task_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Task_submissionId_key" ON "Task"("submissionId");
CREATE INDEX "Task_status_dueAt_id_idx" ON "Task"("status", "dueAt", "id");
CREATE INDEX "Task_leadId_status_dueAt_id_idx" ON "Task"("leadId", "status", "dueAt", "id");
