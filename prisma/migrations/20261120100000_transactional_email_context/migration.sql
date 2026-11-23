ALTER TABLE "EmailNotification" ADD COLUMN "recipientUserId" TEXT;
ALTER TABLE "EmailNotification" ADD COLUMN "viewingId" TEXT;
ALTER TABLE "EmailNotification" ADD COLUMN "taskId" TEXT;
ALTER TABLE "EmailNotification" ADD COLUMN "sourceVersion" INTEGER;
ALTER TABLE "EmailNotification" ADD COLUMN "scheduledStartsAt" DATETIME;
ALTER TABLE "EmailNotification" ADD COLUMN "scheduledEndsAt" DATETIME;

CREATE INDEX "EmailNotification_viewingId_kind_scheduledStartsAt_scheduledEndsAt_status_idx"
ON "EmailNotification"("viewingId", "kind", "scheduledStartsAt", "scheduledEndsAt", "status");
