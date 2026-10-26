-- A reset generation is authoritative even when old-password verification is already in flight.
ALTER TABLE "User" ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Session" ADD COLUMN "credentialVersion" INTEGER NOT NULL DEFAULT 0;
