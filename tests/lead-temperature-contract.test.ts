import { fileURLToPath } from 'node:url';
import { bundle, createConfig, lint } from '@redocly/openapi-core';
import { expect, it } from 'vitest';

const operations = [
  ['/api/v1/staff/leads', 'get'],
  ['/api/v1/staff/leads', 'post'],
  ['/api/v1/staff/leads/export', 'get'],
  ['/api/v1/staff/leads/{id}/temperature', 'patch'],
] as const;

type Operation = {
  operationId?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: Array<{ name?: string }>;
};
type ResolvedContract = {
  paths: Record<string, Record<string, Operation>>;
  security?: Operation['security'];
  components: {
    securitySchemes: Record<
      string,
      { type?: string; in?: string; name?: string }
    >;
    schemas: Record<string, { properties?: Record<string, unknown> }>;
  };
};

it('semantically resolves referenced lead operations and their session-cookie security through the main API entry', async () => {
  const ref = fileURLToPath(
    new URL('../docs/api/openapi.yaml', import.meta.url),
  );
  const config = await createConfig({
    extends: [],
    rules: { 'security-defined': 'error' },
  });
  const resolved = await bundle({ ref, config, dereference: true });
  expect(
    resolved.problems
      .filter((problem) => problem.severity === 'error')
      .map((problem) => problem.message),
  ).toEqual([]);
  const pointers = operations.map(
    ([path, method]) =>
      `#/paths/${path.replaceAll('~', '~0').replaceAll('/', '~1')}/${method}`,
  );
  const problems = await lint({ ref, config });
  const authProblems = problems.filter(
    (problem) =>
      problem.ruleId === 'security-defined' &&
      problem.location.some((location) =>
        pointers.some(
          (pointer) =>
            location.pointer === pointer ||
            location.pointer?.startsWith(`${pointer}/`) === true,
        ),
      ),
  );
  expect(authProblems.map((problem) => problem.message)).toEqual([]);

  const document = resolved.bundle.parsed as ResolvedContract;
  const missingSchemes: string[] = [];
  for (const [path, item] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(item)) {
      if (
        ![
          'get',
          'post',
          'patch',
          'put',
          'delete',
          'head',
          'options',
          'trace',
        ].includes(method)
      )
        continue;
      for (const requirement of operation.security ?? document.security ?? []) {
        for (const name of Object.keys(requirement)) {
          if (!Object.hasOwn(document.components.securitySchemes, name))
            missingSchemes.push(`${method.toUpperCase()} ${path}: ${name}`);
        }
      }
    }
  }
  expect(missingSchemes).toEqual([]);
  for (const [path, method] of operations) {
    const operation = document.paths[path]?.[method];
    expect(operation, `${method.toUpperCase()} ${path}`).toBeDefined();
    const requirements = operation?.security ?? [];
    expect(requirements.length).toBeGreaterThan(0);
    for (const requirement of requirements) {
      expect(Object.keys(requirement).length).toBeGreaterThan(0);
      for (const name of Object.keys(requirement)) {
        expect(document.components.securitySchemes[name], name).toMatchObject({
          type: 'apiKey',
          in: 'cookie',
          name: 'agency.session',
        });
      }
    }
  }
  expect(
    document.paths['/api/v1/staff/leads/{id}/temperature']?.patch?.operationId,
  ).toBe('changeLeadTemperature');
  expect(document.paths['/api/v1/staff/leads']?.get?.parameters).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: 'temperature' })]),
  );
  expect(document.components.schemas.LeadActivity?.properties).toHaveProperty(
    'temperatureChange',
  );
});
