-- CreateTable
CREATE TABLE "EmailNotification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL DEFAULT 1,
    "leadId" TEXT,
    "replayOfId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payloadCiphertext" TEXT,
    "payloadIv" TEXT,
    "payloadTag" TEXT,
    "payloadKeyId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextAttemptAt" DATETIME NOT NULL,
    "expiresAt" DATETIME,
    "enqueuedAt" DATETIME,
    "submittedAt" DATETIME,
    "terminalAt" DATETIME,
    "leaseToken" TEXT,
    "leaseUntil" DATETIME,
    "dispatchAttempts" INTEGER NOT NULL DEFAULT 0,
    "sendAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastErrorCode" TEXT,
    "providerMessageId" TEXT,
    CONSTRAINT "EmailNotification_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailNotification_dedupeKey_key" ON "EmailNotification"("dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "EmailNotification_replayOfId_key" ON "EmailNotification"("replayOfId");

-- CreateIndex
CREATE INDEX "EmailNotification_status_nextAttemptAt_createdAt_id_idx" ON "EmailNotification"("status", "nextAttemptAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "EmailNotification_status_leaseUntil_idx" ON "EmailNotification"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "EmailNotification_terminalAt_id_idx" ON "EmailNotification"("terminalAt", "id");

-- CreateIndex
CREATE INDEX "EmailNotification_leadId_idx" ON "EmailNotification"("leadId");
