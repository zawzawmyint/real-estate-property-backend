CREATE TABLE "RecordAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorKind" TEXT NOT NULL,
  "actorId" TEXT,
  "actorName" TEXT,
  "actorRole" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityLabel" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "changesJson" TEXT NOT NULL,
  "importId" TEXT,
  "importKind" TEXT,
  "createdCount" INTEGER
);
CREATE INDEX "RecordAuditEvent_occurredAt_id_idx" ON "RecordAuditEvent"("occurredAt", "id");
CREATE INDEX "RecordAuditEvent_entityType_entityId_occurredAt_id_idx" ON "RecordAuditEvent"("entityType", "entityId", "occurredAt", "id");
CREATE INDEX "RecordAuditEvent_actorId_occurredAt_id_idx" ON "RecordAuditEvent"("actorId", "occurredAt", "id");
CREATE INDEX "RecordAuditEvent_action_occurredAt_id_idx" ON "RecordAuditEvent"("action", "occurredAt", "id");
CREATE INDEX "RecordAuditEvent_importId_occurredAt_id_idx" ON "RecordAuditEvent"("importId", "occurredAt", "id");
CREATE TABLE "RecordAuditCoverage" (
  "id" INTEGER NOT NULL PRIMARY KEY CHECK ("id" = 1),
  "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "coverageVersion" INTEGER NOT NULL DEFAULT 1
);
INSERT INTO "RecordAuditCoverage" ("id") VALUES (1);
