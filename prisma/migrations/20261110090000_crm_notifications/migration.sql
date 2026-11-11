CREATE TABLE "Notification" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "recipientId" TEXT NOT NULL,
 "type" TEXT NOT NULL,
 "leadId" TEXT NOT NULL,
 "viewingId" TEXT,
 "taskId" TEXT,
 "occurrenceKey" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL,
 "readAt" DATETIME,
 "retiredAt" DATETIME,
 CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "Notification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "Notification_viewingId_fkey" FOREIGN KEY ("viewingId") REFERENCES "Viewing" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "Notification_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Notification_recipientId_occurrenceKey_key" ON "Notification"("recipientId", "occurrenceKey");
CREATE INDEX "Notification_recipientId_retiredAt_createdAt_id_idx" ON "Notification"("recipientId", "retiredAt", "createdAt", "id");
CREATE INDEX "Notification_recipientId_retiredAt_readAt_idx" ON "Notification"("recipientId", "retiredAt", "readAt");
CREATE INDEX "Notification_leadId_retiredAt_idx" ON "Notification"("leadId", "retiredAt");
CREATE INDEX "Notification_taskId_retiredAt_idx" ON "Notification"("taskId", "retiredAt");
