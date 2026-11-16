import { serializeExport } from '../../shared/csv/export.js';
import { AppError } from '../../shared/errors/app-error.js';
import {
  serializedTransaction,
  type Database,
  type Transaction,
} from '../../infrastructure/database/transaction.js';
import { requireCurrentStaff } from '../auth/staff-actor.js';
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
        if (receipt)
          return {
            submissionId: receipt.id,
            createdCount: receipt.createdCount,
            leadIds: JSON.parse(receipt.leadIdsJson) as string[],
            replayed: true,
          };

        const leadIds: string[] = [];
        for (const row of result.inputs) {
          const lead = await repository.create(row, actor, tx);
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
