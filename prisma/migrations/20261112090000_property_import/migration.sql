CREATE TABLE "PropertyImportReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "createdCount" INTEGER NOT NULL,
  "propertyIdsJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
