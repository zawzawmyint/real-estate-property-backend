import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import {
  agencyInquirySchema,
  createSchema,
  inquirySchema,
  patchSchema,
} from '../src/modules/leads/leads.schema.js';
import { agencyCatalogSchema } from '../src/modules/agency/agency.schema.js';

const contact = { submissionId: randomUUID(), name: 'Visitor' };
const schemas = [
  { schema: inquirySchema, base: contact },
  {
    schema: agencyInquirySchema,
    base: { ...contact, purpose: 'sale', message: 'Hello' },
  },
  {
    schema: createSchema,
    base: { ...contact, purpose: 'sale', source: 'call' },
  },
  { schema: patchSchema, base: { expectedVersion: 1 } },
];
it('canonicalizes every JavaScript whitespace before validating all lead phone inputs', () => {
  const whitespace =
    '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
  for (const { schema, base } of schemas) {
    for (const separator of whitespace) {
      expect(
        schema.parse({
          ...base,
          phone: `${separator}+971${separator}${separator}50-123${separator}`,
        }).phone,
      ).toBe('+971  50-123');
    }
    expect(
      schema.parse({ ...base, phone: `\t${'1'.repeat(40)}\n` }).phone,
    ).toBe('1'.repeat(40));
    for (const phone of [
      '\u00a0\t\n',
      '+ () -',
      '12',
      '1'.repeat(41),
      '+971\u200b50',
      'abc123',
      '+971.50',
    ]) {
      expect(
        schema.safeParse({ ...base, phone }).success,
        JSON.stringify(phone),
      ).toBe(false);
    }
  }
});
it('canonicalizes catalog phones while rejecting invalid contacts', () => {
  const agency = {
    name: 'Agency',
    isDemo: true,
    phone: '\t+971\u00a0\u202f50\n',
    email: null,
    address: null,
    officeHours: [],
    timeZone: 'Asia/Dubai',
    mapUrl: null,
  };
  const agent = {
    slug: 'agent',
    name: 'Agent',
    title: 'Advisor',
    specialties: [],
    portrait: null,
    isDemo: true,
    introduction: 'Hello',
    biography: ['Hello'],
    languages: [],
    publicPhone: agency.phone,
    publicEmail: null,
    published: true,
  };
  const result = agencyCatalogSchema.parse({ agency, agents: [agent] });
  expect(result.agency.phone).toBe('+971  50');
  expect(result.agents[0]?.publicPhone).toBe('+971  50');
  for (const phone of ['\t', '()', 'abc123', '1'.repeat(41)]) {
    expect(
      agencyCatalogSchema.safeParse({
        agency: { ...agency, phone },
        agents: [],
      }).success,
    ).toBe(false);
    expect(
      agencyCatalogSchema.safeParse({
        agency: { ...agency, phone: null },
        agents: [{ ...agent, publicPhone: phone }],
      }).success,
    ).toBe(false);
  }
});
