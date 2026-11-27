import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { authFixture } from './auth-fixture.js';
import { recordAuditChange } from '../src/modules/audit-log/audit-log.events.js';

it('retains only the changed context marker for a detached lead', async () => {
  const f = await authFixture();
  try {
    await f.database.$transaction((tx) =>
      recordAuditChange(tx, {
        actor: null,
        source: 'system',
        entityType: 'lead',
        entityId: randomUUID(),
        action: 'lead.updated',
        before: {
          propertyId: null,
          propertyTitleSnapshot: 'private prior context',
        },
        after: { propertyId: null, propertyTitleSnapshot: null },
      }),
    );
    const event = await f.database.recordAuditEvent.findFirstOrThrow();
    expect(JSON.parse(event.changesJson)).toEqual([
      { field: 'propertyTitleSnapshot', redacted: true },
    ]);
    expect(event.actorName).toBeNull();
  } finally {
    await f.close();
  }
});
