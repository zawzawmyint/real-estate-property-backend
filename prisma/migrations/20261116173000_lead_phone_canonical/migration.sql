ALTER TABLE "Lead" ADD COLUMN "phoneCanonical" TEXT;
CREATE INDEX "Lead_phoneCanonical_idx" ON "Lead"("phoneCanonical");
