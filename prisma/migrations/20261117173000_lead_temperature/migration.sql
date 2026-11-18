ALTER TABLE "Lead" ADD COLUMN "temperature" TEXT NOT NULL DEFAULT 'unassessed';
ALTER TABLE "LeadActivity" ADD COLUMN "previousTemperature" TEXT;
ALTER TABLE "LeadActivity" ADD COLUMN "nextTemperature" TEXT;
CREATE INDEX "Lead_temperature_createdAt_id_idx" ON "Lead"("temperature", "createdAt", "id");
