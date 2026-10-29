CREATE TABLE "Viewing" (
"id" TEXT NOT NULL PRIMARY KEY, "submissionId" TEXT NOT NULL, "actorScope" TEXT NOT NULL, "payloadHash" TEXT NOT NULL,
"leadId" TEXT NOT NULL, "propertyId" TEXT NOT NULL, "propertyTitleSnapshot" TEXT NOT NULL, "propertyLocationSnapshot" TEXT,
"startsAt" DATETIME NOT NULL, "endsAt" DATETIME NOT NULL, "status" TEXT NOT NULL DEFAULT 'scheduled', "feedback" TEXT,
"version" INTEGER NOT NULL DEFAULT 1, "createdById" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
CONSTRAINT "Viewing_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
CONSTRAINT "Viewing_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
CONSTRAINT "Viewing_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE);
CREATE UNIQUE INDEX "Viewing_submissionId_key" ON "Viewing"("submissionId");
CREATE INDEX "Viewing_startsAt_id_idx" ON "Viewing"("startsAt", "id");
CREATE INDEX "Viewing_leadId_startsAt_id_idx" ON "Viewing"("leadId", "startsAt", "id");
CREATE INDEX "Viewing_propertyId_idx" ON "Viewing"("propertyId");
