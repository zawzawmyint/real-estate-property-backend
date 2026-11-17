import { createHash } from 'node:crypto';
import type { Transaction } from '../../infrastructure/database/transaction.js';
import { AppError } from '../../shared/errors/app-error.js';
import { eligibleAgent } from './leads.dto.js';
import type { Actor } from './leads.repository.js';
import {
  duplicateMatches,
  type DuplicateMatch,
} from './lead-duplicates.repository.js';

const hash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const duplicateSummary = (lead: DuplicateMatch) => ({
  id: lead.id,
  name: lead.name,
  phone: lead.phone!,
  stage: lead.stage as
    'new' | 'contacted' | 'viewing_scheduled' | 'offer' | 'won' | 'lost',
  assignedAgent: lead.assignedAgent
    ? {
        id: lead.assignedAgent.id,
        name: lead.assignedAgent.name,
        available: eligibleAgent(lead.assignedAgent),
      }
    : null,
});
export async function duplicateReview(
  phone: string,
  actor: Actor,
  excluded: string | null,
  tx: Transaction,
) {
  const matches = (await duplicateMatches([phone], actor, tx)).filter(
    (row) => row.id !== excluded,
  );
  return {
    canonicalPhone: phone,
    totalMatches: matches.length,
    matches: matches.slice(0, 20).map(duplicateSummary),
    truncated: matches.length > 20,
    reviewToken: hash([
      'lead-duplicate:v1',
      actor.id,
      actor.role,
      phone,
      excluded,
      matches.map((row) => row.id).sort(),
    ]),
  };
}
export type DuplicateReview = Awaited<ReturnType<typeof duplicateReview>>;
export class DuplicateReviewRequired extends AppError {
  constructor(
    public readonly duplicateReview: DuplicateReview | ImportDuplicateReview,
    isImport = false,
  ) {
    super(
      409,
      isImport
        ? 'IMPORT_DUPLICATE_REVIEW_REQUIRED'
        : 'LEAD_DUPLICATE_REVIEW_REQUIRED',
      isImport
        ? 'Preview and acknowledge matching phone numbers before importing.'
        : 'Review matching leads before saving a separate lead.',
    );
  }
}
export async function guardDuplicate(
  phone: string | null,
  actor: Actor,
  excluded: string | null,
  ack: { reviewToken: string } | undefined,
  tx: Transaction,
) {
  if (!phone) return;
  const review = await duplicateReview(phone, actor, excluded, tx);
  if (review.totalMatches && ack?.reviewToken !== review.reviewToken)
    throw new DuplicateReviewRequired(review);
}
export async function importDuplicateReview(
  rows: { rowNumber: number; phoneCanonical: string | null }[],
  digest: string,
  actor: Actor,
  tx: Transaction,
) {
  const phones = [
    ...new Set(
      rows.flatMap((row) => (row.phoneCanonical ? [row.phoneCanonical] : [])),
    ),
  ];
  const matches = await duplicateMatches(phones, actor, tx);
  const grouped = new Map<string, DuplicateMatch[]>();
  const files = new Map<string, number[]>();
  for (const match of matches) {
    const key = match.phoneCanonical!;
    const group = grouped.get(key) ?? [];
    group.push(match);
    grouped.set(key, group);
  }
  for (const row of rows)
    if (row.phoneCanonical) {
      const group = files.get(row.phoneCanonical) ?? [];
      group.push(row.rowNumber);
      files.set(row.phoneCanonical, group);
    }
  const membership = rows.map((row) => ({
    rowNumber: row.rowNumber,
    phone: row.phoneCanonical,
    ids: row.phoneCanonical
      ? (grouped.get(row.phoneCanonical) ?? []).map((match) => match.id).sort()
      : [],
    sameFile: row.phoneCanonical
      ? (files.get(row.phoneCanonical) ?? []).filter((n) => n !== row.rowNumber)
      : [],
  }));
  const warnings = membership
    .filter((row) => row.phone && (row.ids.length || row.sameFile.length))
    .map((row) => ({
      rowNumber: row.rowNumber,
      canonicalPhone: row.phone!,
      existingMatchCount: row.ids.length,
      matches: (grouped.get(row.phone!) ?? [])
        .slice(0, 5)
        .map(duplicateSummary),
      sameFileRowNumbers: row.sameFile.slice(0, 20),
      sameFileRowCount: row.sameFile.length,
    }));
  return {
    affectedRows: warnings.length,
    existingMatchRows: warnings.filter((row) => row.existingMatchCount > 0)
      .length,
    withinFileRows: warnings.filter((row) => row.sameFileRowCount > 0).length,
    warningCount: warnings.length,
    warnings: warnings.slice(0, 100),
    truncated: warnings.length > 100,
    reviewToken: hash([
      'lead-import-duplicate:v2',
      actor.id,
      actor.role,
      digest,
      membership,
    ]),
  };
}
export type ImportDuplicateReview = Awaited<
  ReturnType<typeof importDuplicateReview>
>;
