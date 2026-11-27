import { fileURLToPath } from 'node:url';
import { bundle, createConfig, lint } from '@redocly/openapi-core';
import { expect, it } from 'vitest';
import { actions } from '../src/modules/audit-log/audit-log.changes.js';

it.each(['record-audit-log.openapi.yaml', 'openapi.yaml'])(
  'resolves the audit read contracts, action vocabulary and cookie requirements in %s',
  async (file) => {
    const ref = fileURLToPath(new URL('../docs/api/' + file, import.meta.url));
    const config = await createConfig({
      extends: [],
      rules: { 'security-defined': 'error', struct: 'error' },
    });
    const resolved = await bundle({ ref, config, dereference: true });
    expect(resolved.problems.filter((p) => p.severity === 'error')).toEqual([]);
    expect(
      (await lint({ ref, config }))
        .filter(
          (p) =>
            p.severity === 'error' &&
            (file !== 'openapi.yaml' ||
              p.location.some((l) => l.pointer?.includes('audit-log'))),
        )
        .map((p) => p.message),
    ).toEqual([]);
    const doc = resolved.bundle.parsed as {
      paths: Record<
        string,
        {
          get: {
            parameters: { name: string; required?: boolean }[];
            security: object[];
            responses: Record<string, unknown>;
          };
        }
      >;
      components: { schemas: { AuditAction: { enum: string[] } } };
    };
    expect(doc.components.schemas.AuditAction.enum.sort()).toEqual(
      [...actions].sort(),
    );
    for (const suffix of ['', '/actors']) {
      const resource = doc.paths['/api/v1/staff/audit-log' + suffix]!;
      expect(Object.keys(resource)).toEqual(['get']);
      expect(resource.get.security).toEqual([{ StaffCookie: [] }]);
      expect(Object.keys(resource.get.responses).sort()).toEqual([
        '200',
        '400',
        '401',
        '403',
        '500',
      ]);
      expect(
        resource.get.parameters.filter((p) => p.required).map((p) => p.name),
      ).toEqual(suffix ? [] : ['from', 'to']);
    }
  },
);
