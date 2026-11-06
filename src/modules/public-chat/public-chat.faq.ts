import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import { publicChatUnavailable } from './public-chat.errors.js';

const source = z.strictObject({
  id: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(64),
  title: z.string().trim().min(1).max(100),
  path: z.enum(['/contact', '/properties']),
  text: z.string().trim().min(1).max(1000),
});
const entries = z
  .array(source)
  .min(1)
  .max(50)
  .refine(
    (sources) => new Set(sources.map(({ id }) => id)).size === sources.length,
  );
const indexFile = z.strictObject({
  version: z.literal(1),
  embeddingModel: z.string().min(1).max(200),
  dimensions: z.number().int().min(1).max(8192),
  entries,
  vectors: z.array(z.array(z.number()).min(1).max(8192)).min(1).max(50),
});

export type FaqPassage = z.infer<typeof source>;

export interface FaqSearch {
  find(vector: readonly number[]): Promise<readonly FaqPassage[]>;
}

// Calibrated against the bundled demo FAQs with the default embedding model.
const minimumRelevance = 0.2;

function normalize(vector: readonly number[], dimensions: number) {
  if (vector.length !== dimensions) return null;

  const magnitude = Math.hypot(...vector);

  return magnitude > 0 && Number.isFinite(magnitude)
    ? vector.map((value) => value / magnitude)
    : null;
}

export function loadJsonFaqSearch(
  path: string,
  embeddingModel: string,
): FaqSearch {
  const file = indexFile.safeParse(
    JSON.parse(readFileSync(path, 'utf8')) as unknown,
  );

  if (
    !file.success ||
    file.data.embeddingModel !== embeddingModel ||
    file.data.entries.length !== file.data.vectors.length
  )
    throw new Error(
      'The FAQ index is incompatible. Rebuild it before enabling chat.',
    );

  const { dimensions, entries: passages, vectors } = file.data;
  const indexed = passages.map((passage, index) => {
    const vector = normalize(vectors[index] ?? [], dimensions);
    if (!vector) throw new Error('The FAQ index contains an invalid vector.');

    return { passage, vector };
  });

  return {
    async find(query) {
      const normalized = normalize(query, dimensions);
      if (!normalized) throw publicChatUnavailable();

      return indexed
        .map(({ passage, vector }) => ({
          passage,
          score: vector.reduce(
            (sum, value, i) => sum + value * normalized[i]!,
            0,
          ),
        }))
        .filter(({ score }) => score >= minimumRelevance)
        .sort((first, second) => second.score - first.score)
        .slice(0, 3)
        .map(({ passage }) => passage);
    },
  };
}

export async function writeJsonFaqIndex(
  path: string,
  catalog: unknown,
  embeddingModel: string,
  embedDocuments: (texts: readonly string[]) => Promise<number[][]>,
) {
  const passages = entries.parse(catalog);
  const vectors = await embedDocuments(
    passages.map(({ title, text }) => `${title}\n${text}`),
  );
  const dimensions = vectors[0]?.length ?? 0;
  const file = indexFile.parse({
    version: 1,
    embeddingModel,
    dimensions,
    entries: passages,
    vectors,
  });

  if (
    vectors.length !== passages.length ||
    vectors.some((vector) => !normalize(vector, dimensions))
  )
    throw new Error('The embedding provider returned an invalid FAQ index.');

  const pending = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(pending, `${JSON.stringify(file)}\n`, { flag: 'wx' });
    await rename(pending, path);
  } finally {
    await rm(pending, { force: true });
  }

  return { entries: passages.length, dimensions };
}
