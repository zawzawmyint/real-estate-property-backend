import { randomUUID } from 'node:crypto';
import {
  importDuplicateReview,
  DuplicateReviewRequired,
} from './lead-duplicates.service.js';
import { parseImport } from '../../shared/csv/parse-import.js';
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
import type { Actor } from './leads.repository.js';
import {
  importColumns,
  importDigest,
  validateImport,
  type ImportCommit,
  type ImportIssue,
} from './lead-import.schema.js';
import { leadImportRepository as repository } from './lead-import.repository.js';

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

export function createLeadImportService(database: Database) {
  return {
    async template(identity: Actor) {
      await serializedTransaction(database, (tx) => authorize(identity, tx));
      return serializeExport(importColumns, []);
    },
    async preview(csv: string, identity: Actor) {
      return serializedTransaction(database, async (tx) => {
        const actor = await authorize(identity, tx),
          result = validateImport(csv);
        return {
          ...result.preview,
          duplicateReview: await importDuplicateReview(
            result.duplicateRows,
            result.preview.digest,
            actor,
            tx,
          ),
        };
      });
    },
    async commit(input: ImportCommit, identity: Actor) {
      const digest = importDigest(input.csv, input.schemaVersion);
      return serializedTransaction(database, async (tx) => {
        await repository.lock(input.submissionId, tx);
        const actor = await authorize(identity, tx);
        const receipt = await repository.receipt(input.submissionId, tx);
        if (
          receipt &&
          (receipt.actorId !== actor.id ||
            receipt.contentDigest !== digest ||
            input.digest !== digest ||
            receipt.schemaVersion !== input.schemaVersion)
        )
          throw new AppError(
            409,
            'IMPORT_CONFLICT',
            'This submission cannot be reused.',
          );
        // Preserve UTF-8/CSV transport validation before replay without applying new domain rules.
        if (receipt) {
          parseImport(input.csv, {
            allowedHeaders: importColumns,
            requiredHeaders: ['name', 'purpose', 'source'],
            maxBytes: 1048576,
            maxRows: 500,
            maxRecordBytes: 65536,
          });
          return {
            submissionId: receipt.id,
            createdCount: receipt.createdCount,
            leadIds: JSON.parse(receipt.leadIdsJson) as string[],
            replayed: true,
          };
        }
        if (input.schemaVersion !== 2 || input.digest !== digest)
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

        const review = await importDuplicateReview(
          result.duplicateRows,
          digest,
          actor,
          tx,
        );
        if (
          review.affectedRows &&
          input.duplicateAcknowledgement?.reviewToken !== review.reviewToken
        )
          throw new DuplicateReviewRequired(review, true);
        const auditImportId = randomUUID();
        const leadIds: string[] = [];
        for (const row of result.inputs) {
          const lead = await repository.create(row, actor, tx);
          await recordAuditChange(tx, {
            actor,
            entityType: 'lead',
            entityId: lead.id,
            action: 'lead.created',
            after: lead,
            import: { id: auditImportId, kind: 'lead' },
          });
          await repository.activity(lead.id, actor, tx);
          leadIds.push(lead.id);
        }
        await repository.saveReceipt(
          {
            id: input.submissionId,
            actorId: actor.id,
            contentDigest: digest,
            leadIds,
          },
          tx,
        );
        await appendImportCompleted(tx, {
          actor,
          id: auditImportId,
          kind: 'lead',
          createdCount: leadIds.length,
        });
        return {
          submissionId: input.submissionId,
          createdCount: leadIds.length,
          leadIds,
          replayed: false,
        };
      });
    },
  };
}
export type LeadImportService = ReturnType<typeof createLeadImportService>;
