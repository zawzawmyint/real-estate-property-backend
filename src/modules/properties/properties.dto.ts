import type { Storage } from '../../infrastructure/storage/storage.js';
import type { StaffRole } from '../auth/auth.js';
import type { PublicRecord, PropertyRecord } from './properties.repository.js';

type RecordWithPhotos =
  PublicRecord | Omit<PropertyRecord, 'ownerName' | 'ownerPhone'>;

export function propertyDto(
  record: RecordWithPhotos,
  storage: Storage,
  staffRole?: StaffRole,
  detail = false,
) {
  const photos = record.photos.map((photo) => ({
    id: photo.id,
    url: storage.resolveUrl(photo.storageKey),
    width: photo.width,
    height: photo.height,
  }));
  const base = {
    isDemo: record.isDemo,
    id: record.id,
    title: record.title,
    purpose: record.purpose,
    type: record.type,
    priceFils: record.priceFils === null ? null : Number(record.priceFils),
    city: record.city,
    community: record.community,
    bedrooms: record.bedrooms,
    bathrooms: record.bathrooms,
    areaSqft:
      record.areaHundredths === null
        ? null
        : `${Math.floor(record.areaHundredths / 100)}.${String(record.areaHundredths % 100).padStart(2, '0')}`,
  };

  if (!staffRole)
    return {
      ...base,
      coverPhoto: photos[0]!,
      ...(detail ? { description: record.description, photos } : {}),
    };

  const staff = record as PropertyRecord;

  return {
    ...base,
    description: staff.description,
    publishingState: staff.publishingState,
    availability: staff.availability,
    featured: staff.featured,
    photos,
    createdAt: staff.createdAt.toISOString(),
    updatedAt: staff.updatedAt.toISOString(),
    ...(staffRole === 'agent'
      ? {}
      : { ownerName: staff.ownerName, ownerPhone: staff.ownerPhone }),
  };
}
