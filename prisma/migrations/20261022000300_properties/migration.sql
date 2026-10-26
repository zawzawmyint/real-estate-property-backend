CREATE TABLE "Property" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "demoKey" TEXT,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "title" TEXT NOT NULL,
  "purpose" TEXT NOT NULL CHECK ("purpose" IN ('sale', 'rent')),
  "type" TEXT CHECK ("type" IN ('apartment', 'villa', 'townhouse', 'penthouse')),
  "description" TEXT,
  "priceFils" BIGINT CHECK ("priceFils" BETWEEN 1 AND 1000000000000),
  "city" TEXT,
  "community" TEXT,
  "bedrooms" INTEGER CHECK ("bedrooms" BETWEEN 0 AND 20),
  "bathrooms" INTEGER CHECK ("bathrooms" BETWEEN 0 AND 20),
  "areaHundredths" INTEGER CHECK ("areaHundredths" BETWEEN 1 AND 100000000),
  "ownerName" TEXT,
  "ownerPhone" TEXT,
  "publishingState" TEXT NOT NULL DEFAULT 'draft' CHECK ("publishingState" IN ('draft', 'published', 'archived')),
  "availability" TEXT NOT NULL DEFAULT 'available' CHECK ("availability" IN ('available', 'sold', 'rented')),
  "featured" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CHECK (("availability" != 'sold' OR "purpose" = 'sale') AND ("availability" != 'rented' OR "purpose" = 'rent'))
);
CREATE TABLE "PropertyPhoto" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "propertyId" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "position" INTEGER NOT NULL CHECK ("position" >= 0),
  "width" INTEGER NOT NULL CHECK ("width" BETWEEN 1 AND 2400),
  "height" INTEGER NOT NULL CHECK ("height" BETWEEN 1 AND 2400),
  FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "Property_publishingState_availability_createdAt_idx" ON "Property"("publishingState", "availability", "createdAt");
CREATE INDEX "Property_purpose_type_city_idx" ON "Property"("purpose", "type", "city");
CREATE INDEX "Property_updatedAt_idx" ON "Property"("updatedAt");
CREATE UNIQUE INDEX "Property_demoKey_key" ON "Property"("demoKey");
CREATE UNIQUE INDEX "PropertyPhoto_storageKey_key" ON "PropertyPhoto"("storageKey");
CREATE INDEX "PropertyPhoto_propertyId_position_idx" ON "PropertyPhoto"("propertyId", "position");
