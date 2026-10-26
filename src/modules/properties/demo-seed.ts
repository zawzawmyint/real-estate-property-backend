import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { createDatabase } from '../../infrastructure/database/client.js';
import type { Storage } from '../../infrastructure/storage/storage.js';
import { decodePropertyImage } from './properties.image.js';
import { demoImageNames, demoProperties } from './demo-data.js';
import { propertySearchFields } from './property-search.js';

export function requireDemoSeedConsent(
  args: readonly string[],
  environment: string,
) {
  const flags = args[0] === '--' ? args.slice(1) : args;

  if (environment === 'production')
    throw new Error('Demo seeding is disabled in production.');
  if (flags.some((arg) => arg !== '--confirm-demo'))
    throw new Error('Unknown seed argument; no reset/delete mode exists.');
  if (!flags.includes('--confirm-demo'))
    throw new Error(
      'Pass --confirm-demo to explicitly add fictional sample inventory.',
    );
}

/** Only the explicit operator command calls this; ordinary HTTP cannot set demo identity. */
export async function seedDemoProperties(
  database: Awaited<ReturnType<typeof createDatabase>>,
  storage: Storage,
  imageDirectory = fileURLToPath(
    new URL('../../../fixtures/demo-properties/photos/', import.meta.url),
  ),
) {
  // Validate the complete source library before creating any records or files.
  const images = new Map<
    string,
    Awaited<ReturnType<typeof decodePropertyImage>>
  >();

  for (const name of demoImageNames)
    images.set(
      name,
      await decodePropertyImage(
        await readFile(join(imageDirectory, `${name}.webp`)),
        'image/webp',
      ),
    );

  let created = 0;
  let skipped = 0;

  for (const sample of demoProperties) {
    const demoKey = `avenor-demo-v1:${sample.key}`;

    if (
      await database.property.findUnique({
        where: { demoKey },
        select: { id: true },
      })
    ) {
      skipped++;

      continue;
    }

    const savedKeys: string[] = [];

    try {
      const galleryNames =
        sample.image === 'serene-bedroom'
          ? [sample.image, 'coastal-apartment']
          : [sample.image, 'serene-bedroom'];
      const photos = [];

      for (const [position, name] of galleryNames.entries()) {
        const image = images.get(name)!;
        const storageKey = await storage.save(image.data, '.webp');

        savedKeys.push(storageKey);
        photos.push({
          storageKey,
          position,
          width: image.width,
          height: image.height,
        });
      }

      // Nested create is atomic: a partial listing is never published without photos.
      await database.property.create({
        data: {
          demoKey,
          isDemo: true,
          title: sample.title,
          purpose: sample.purpose,
          type: sample.type,
          description: `Fictional demo property in ${sample.community}, Dubai. A welcoming ${sample.type} with ${sample.beds === 0 ? 'a thoughtfully arranged studio layout' : `${sample.beds} comfortable bedrooms`}, light-filled living spaces and a calm contemporary finish. This sample record and its AI-generated photographs are illustrative, not an offer for a real home. Images are reused from a small demo library and may not represent the listed layout or location.`,
          priceFils: BigInt(sample.price) * 100n,
          city: 'Dubai',
          community: sample.community,
          ...propertySearchFields({
            title: sample.title,
            city: 'Dubai',
            community: sample.community,
          }),
          bedrooms: sample.beds,
          bathrooms: sample.baths,
          areaHundredths: sample.area * 100,
          ownerName: 'Fictional demo owner',
          ownerPhone: '+000 000 000 000',
          publishingState: 'published',
          availability: 'available',
          featured: sample.featured,
          photos: { create: photos },
        },
      });
      created++;
    } catch (error) {
      let unreferenced: string[];

      try {
        const attached = await database.propertyPhoto.findMany({
          where: { storageKey: { in: savedKeys } },
          select: { storageKey: true },
        });
        const referenced = new Set(attached.map((photo) => photo.storageKey));

        unreferenced = savedKeys.filter((key) => !referenced.has(key));
      } catch {
        // An uncertain commit/reference check is safer as a recoverable orphan
        // than deleting a photo that may already belong to a saved property.
        for (const key of savedKeys)
          console.error(
            `Demo seed outcome uncertain; retain generated key ${key} for reconciliation`,
          );

        throw error;
      }

      const failures = await Promise.allSettled(
        unreferenced.map((key) => storage.delete(key)),
      );

      failures.forEach((result, index) => {
        if (result.status === 'rejected')
          console.error(
            `Demo seed cleanup needed for generated key ${unreferenced[index]}`,
          );
      });

      // A simultaneous operator run can win this deterministic unique key safely.
      if (
        await database.property.findUnique({
          where: { demoKey },
          select: { id: true },
        })
      )
        skipped++;
      else throw error;
    }
  }

  return { created, skipped };
}
