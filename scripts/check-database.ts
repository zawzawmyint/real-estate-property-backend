import { verifyLeadPhoneCanonical } from '../src/modules/leads/lead-phone-backfill.js';
import { verifyLeadSearch } from '../src/modules/leads/lead-search.js';
import { parseEnv } from '../src/config/env.js';
import { createDatabase } from '../src/infrastructure/database/client.js';
import { verifyPropertySearch } from '../src/modules/properties/property-search.js';

const env = parseEnv(process.env);
const db = await createDatabase(env.DATABASE_URL);

try {
  const result = await db.$queryRaw<
    Array<{ connected: bigint }>
  >`SELECT 1 AS connected`;

  if (Number(result[0]?.connected) !== 1)
    throw new Error('SQLite connection check failed');

  // Verify every delivered table is accessible without disclosing record data.
  await Promise.all([
    db.user.count(),
    db.account.count(),
    db.session.count(),
    db.verification.count(),
    db.property.count(),
    db.propertyPhoto.count(),
    db.propertyImportReceipt.count(),
    db.lead.count(),
    db.leadImportReceipt.count(),
    db.leadNote.count(),
    db.leadActivity.count(),
    db.lead.findFirst({ select: { temperature: true } }),
    db.leadActivity.findFirst({
      select: { previousTemperature: true, nextTemperature: true },
    }),
    db.leadSubmissionReceipt.count(),
    db.viewing.count(),
    db.task.count(),
    db.notification.count(),
    db.emailNotification.count(),
    db.emailNotification.findFirst({
      select: {
        recipientUserId: true,
        viewingId: true,
        taskId: true,
        sourceVersion: true,
        scheduledStartsAt: true,
        scheduledEndsAt: true,
      },
    }),
  ]);
  await verifyPropertySearch(db);
  await verifyLeadSearch(db);
  await verifyLeadPhoneCanonical(db);
  console.info(
    'SQLite connection, agency tables, property and lead search verified.',
  );
} finally {
  await db.$disconnect();
}
