import { expect, it } from 'vitest';
import {
  toData,
  type PropertyInput,
} from '../src/modules/properties/properties.schema.js';

it('selects only allowed property write fields even if an internal caller supplies extra runtime properties', () => {
  const input = {
    title: 'A draft',
    purpose: 'sale',
    id: 'must-not-be-written',
    createdAt: new Date(),
    photos: [],
    arbitraryColumn: 'must-not-be-written',
  } as PropertyInput;

  expect(toData(input)).toEqual({
    title: 'A draft',
    searchTitle: 'a draft',
    purpose: 'sale',
  });
});

it('preserves all accepted property fields and converts stored numeric units', () => {
  const input: PropertyInput = {
    title: 'A home',
    purpose: 'rent',
    type: 'apartment',
    description: 'Description',
    priceFils: 123456789,
    city: 'Dubai',
    community: 'Marina',
    bedrooms: 0,
    bathrooms: 2,
    areaSqft: '745.25',
    ownerName: 'Owner',
    ownerPhone: '+971 50 123 4567',
    featured: false,
    publishingState: 'draft',
    availability: 'available',
  };
  const expected: Record<string, unknown> = {
    ...input,
    priceFils: 123456789n,
    areaHundredths: 74525,
    searchTitle: 'a home',
    searchCity: 'dubai',
    searchCommunity: 'marina',
  };

  delete expected.areaSqft;
  expect(toData(input)).toEqual(expected);
});

it('preserves explicit nulls while omitting undefined fields from partial updates', () => {
  expect(
    toData({
      title: undefined,
      description: null,
      priceFils: null,
      areaSqft: null,
      featured: false,
      bedrooms: 0,
      city: null,
    }),
  ).toEqual({
    description: null,
    priceFils: null,
    areaHundredths: null,
    featured: false,
    bedrooms: 0,
    city: null,
    searchCity: '',
  });
});
