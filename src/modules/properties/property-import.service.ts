import { randomUUID } from 'node:crypto';
import { serializeExport } from '../../shared/csv/export.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  serializedTransaction,
  type Database,
  type Transaction,
} from '../../infrastructure/database/transaction.js';
import { requireCurrentStaff } from '../auth/staff-actor.js';
import {
  recordAuditChange,
  appendImportCompleted,
} from '../audit-log/audit-log.events.js';
import type { Actor } from '../leads/leads.repository.js';
import { toData } from './properties.schema.js';
import {
  importColumns,
  importDigest,
  validateImport,
  type ImportCommit,
  type ImportIssue,
} from './property-import.schema.js';
import { propertyImportRepository as repository } from './property-import.repository.js';

export class ImportValidationError extends Error {
  constructor(
    public readonly issues: ImportIssue[],
    public readonly issueCount: number,
  ) {
    super('Fix every invalid row before importing.');
  }
}

async function authorize(identity: Actor, tx: Transaction) {
  const actor = await requireCurrentStaff(identity, tx);
  if (actor.role === 'agent')
    throw new AppError(403, 'FORBIDDEN', 'Access denied');
  return actor;
}

export function createPropertyImportService(database: Database) {
  return {
    async template(identity: Actor) {
      await serializedTransaction(database, (tx) => authorize(identity, tx));
      return serializeExport(importColumns, []);
    },
    async preview(csv: string, identity: Actor) {
      await serializedTransaction(database, (tx) => authorize(identity, tx));
      return validateImport(csv).preview;
    },
    async commit(input: ImportCommit, identity: Actor) {
      const digest = importDigest(input.csv);
      return serializedTransaction(database, async (tx) => {
        await repository.lock(input.submissionId, tx);
        const actor = await authorize(identity, tx);
        const receipt = await repository.receipt(input.submissionId, tx);

        if (
          receipt &&
          (receipt.actorId !== actor.id ||
            receipt.contentDigest !== digest ||
            receipt.schemaVersion !== input.schemaVersion)
        )
          throw new AppError(
            409,
            'IMPORT_CONFLICT',
            'This submission cannot be reused.',
          );

        if (input.schemaVersion !== 1 || input.digest !== digest)
          throw new AppError(
            409,
            'IMPORT_PREVIEW_STALE',
            'Preview this file again before importing.',
          );
        const result = validateImport(input.csv);
        if (!result.preview.valid)
          throw new ImportValidationError(
            result.preview.issues,
            result.preview.issueCount,
          );
        if (receipt) {
          return {
            submissionId: receipt.id,
            createdCount: receipt.createdCount,
            propertyIds: JSON.parse(receipt.propertyIdsJson) as string[],
            replayed: true,
          };
        }

        const auditImportId = randomUUID();
        const propertyIds: string[] = [];
        for (const row of result.inputs) {
          const property = await repository.create(
            {
              ...toData(row),
              title: row.title,
              purpose: row.purpose,
              publishingState: 'draft',
              availability: 'available',
              featured: false,
              isDemo: false,
            },
            tx,
          );
          await recordAuditChange(tx, {
            actor,
            entityType: 'property',
            entityId: property.id,
            action: 'property.created',
            after: property,
            import: { id: auditImportId, kind: 'property' },
          });
          propertyIds.push(property.id);
        }

        await repository.saveReceipt(
          {
            id: input.submissionId,
            actorId: actor.id,
            contentDigest: digest,
            schemaVersion: 1,
            createdCount: propertyIds.length,
            propertyIdsJson: JSON.stringify(propertyIds),
          },
          tx,
        );

        await appendImportCompleted(tx, {
          actor,
          id: auditImportId,
          kind: 'property',
          createdCount: propertyIds.length,
        });
        return {
          submissionId: input.submissionId,
          createdCount: propertyIds.length,
          propertyIds,
          replayed: false,
        };
      });
    },
  };
}
export type PropertyImportService = ReturnType<
  typeof createPropertyImportService
>;
