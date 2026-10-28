import {
  serializedTransaction,
  type Database,
  type Transaction,
} from '../../infrastructure/database/transaction.js';
import type { Logger } from 'pino';
import type { Storage } from '../../infrastructure/storage/storage.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { StaffRole } from '../auth/auth.js';
import { propertyDto } from './properties.dto.js';
import {
  createPropertyRepository,
  type PropertyRecord,
} from './properties.repository.js';
import {
  toData,
  type CreatePropertyInput,
  type PropertyInput,
  type PropertyQuery,
} from './properties.schema.js';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Property not found');
const conflict = (message: string) => new AppError(409, 'CONFLICT', message);

function canWrite(role: StaffRole) {
  if (role === 'agent') throw new AppError(403, 'FORBIDDEN', 'Access denied');
}

function editable(property: PropertyRecord) {
  if (property.publishingState === 'archived')
    throw conflict('Restore the archived property before editing');
}

function validState(property: PropertyRecord, publishing: boolean) {
  if (
    (property.availability === 'sold' && property.purpose !== 'sale') ||
    (property.availability === 'rented' && property.purpose !== 'rent')
  )
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Availability does not match purpose',
    );
  if (property.publishingState === 'published') {
    const fields = [
      'type',
      'description',
      'priceFils',
      'city',
      'community',
      'bedrooms',
      'bathrooms',
      'areaHundredths',
      'ownerName',
      'ownerPhone',
    ] as const;

    if (
      fields.some((key) => property[key] === null) ||
      property.photos.length < 1 ||
      (publishing && property.availability !== 'available')
    )
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        'Publishing requires complete property fields, photos and available status',
      );
  }
}

export function createPropertyService(
  database: Database,
  storage: Storage,
  logger: Logger,
) {
  const repository = createPropertyRepository(database);

  async function locked(id: string, tx: Transaction) {
    await repository.lock(id, tx);

    const property = await repository.findInternal(id, tx);

    if (!property) throw notFound();

    return property;
  }

  async function cleanup(keys: string[], requestId: string) {
    for (const key of keys)
      try {
        await storage.delete(key);
      } catch {
        logger.error(
          { storageKey: key, requestId },
          'Public image cleanup failed; reconcile storage in a maintenance window',
        );
      }
  }

  return {
    async list(query: PropertyQuery, role?: StaffRole) {
      const result = await repository.list(
        query,
        role !== undefined,
        role !== undefined && role !== 'agent',
      );

      return {
        ...result,
        items: result.items.map((record) =>
          propertyDto(record as PropertyRecord, storage, role),
        ),
      };
    },

    async detail(id: string, role?: StaffRole) {
      const property = role
        ? await repository.findStaff(id, role !== 'agent')
        : await repository.findPublic(id);

      if (!property) throw notFound();

      return propertyDto(property, storage, role, true);
    },

    async create(input: CreatePropertyInput, role: StaffRole) {
      canWrite(role);

      const property = await serializedTransaction(database, (tx) =>
        repository.create(
          { ...toData(input), title: input.title, purpose: input.purpose },
          tx,
        ),
      );

      return propertyDto(property, storage, role);
    },

    async patch(id: string, input: PropertyInput, role: StaffRole) {
      canWrite(role);

      const property = await serializedTransaction(database, async (tx) => {
        const before = await locked(id, tx);

        if (
          before.publishingState === 'archived' &&
          (input.publishingState !== 'draft' || Object.keys(input).length !== 1)
        )
          throw conflict('Archived properties must be restored to draft first');

        const data = toData(input);
        const merged = { ...before, ...data };

        validState(
          merged,
          input.publishingState === 'published' &&
            before.publishingState !== 'published',
        );

        return repository.update(id, data, tx);
      });

      return propertyDto(property, storage, role);
    },

    async remove(id: string, role: StaffRole, requestId: string) {
      if (role !== 'admin')
        throw new AppError(403, 'FORBIDDEN', 'Access denied');

      const keys = await serializedTransaction(database, async (tx) => {
        const property = await locked(id, tx);

        if (property.publishingState !== 'archived')
          throw conflict('Archive the property before permanent deletion');

        await repository.remove(id, tx);

        return property.photos.map((photo) => photo.storageKey);
      });

      await cleanup(keys, requestId);
    },

    async assertUpload(id: string, role: StaffRole) {
      canWrite(role);

      const property = await repository.findInternal(id);

      if (!property) throw notFound();
      editable(property);
      if (property.photos.length >= 12)
        throw conflict('A property can have at most 12 photos');
    },

    async attachPhoto(
      id: string,
      image: { data: Buffer; width: number; height: number },
      role: StaffRole,
      requestId: string,
    ) {
      canWrite(role);

      const key = await storage.save(image.data, '.webp');
      let property: PropertyRecord;

      try {
        property = await serializedTransaction(database, async (tx) => {
          const before = await locked(id, tx);

          editable(before);
          if (before.photos.length >= 12)
            throw conflict('A property can have at most 12 photos');

          await repository.addPhoto(
            id,
            {
              storageKey: key,
              width: image.width,
              height: image.height,
              position: before.photos.length,
            },
            tx,
          );

          return (await repository.findInternal(id, tx))!;
        });
      } catch (error) {
        // A commit can succeed even when the client sees a rejection. Never
        // destroy a referenced file or guess when the database is unavailable.
        try {
          if (!(await repository.findPhotoReference(key)))
            await cleanup([key], requestId);
        } catch {
          logger.error(
            { storageKey: key, requestId },
            'Upload outcome unknown; retain public image for maintenance reconciliation',
          );
        }

        throw error;
      }

      return propertyDto(property, storage, role);
    },

    async orderPhotos(id: string, ids: string[], role: StaffRole) {
      canWrite(role);

      const property = await serializedTransaction(database, async (tx) => {
        const before = await locked(id, tx);

        editable(before);
        if (
          ids.length !== before.photos.length ||
          new Set(ids).size !== ids.length ||
          ids.some(
            (photoId) => !before.photos.some((photo) => photo.id === photoId),
          )
        )
          throw conflict(
            'Photo order must contain the current complete photo set',
          );

        for (const [position, photoId] of ids.entries())
          await repository.setPosition(photoId, position, tx);

        return (await repository.findInternal(id, tx))!;
      });

      return propertyDto(property, storage, role);
    },

    async removePhoto(
      id: string,
      photoId: string,
      role: StaffRole,
      requestId: string,
    ) {
      canWrite(role);

      const { property, key } = await serializedTransaction(
        database,
        async (tx) => {
          const before = await locked(id, tx);

          editable(before);

          const photo = before.photos.find((item) => item.id === photoId);

          if (!photo)
            throw new AppError(404, 'NOT_FOUND', 'Property photo not found');
          if (
            before.publishingState === 'published' &&
            before.photos.length === 1
          )
            throw conflict('Published properties must retain a photo');

          await repository.removePhoto(photoId, tx);

          const remaining = before.photos.filter((item) => item.id !== photoId);

          for (const [position, item] of remaining.entries())
            await repository.setPosition(item.id, position, tx);

          return {
            property: (await repository.findInternal(id, tx))!,
            key: photo.storageKey,
          };
        },
      );

      await cleanup([key], requestId);

      return propertyDto(property, storage, role);
    },
  };
}

export type PropertyService = ReturnType<typeof createPropertyService>;
