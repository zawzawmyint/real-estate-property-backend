import { fileURLToPath } from 'node:url';
import { bundle, createConfig, lint } from '@redocly/openapi-core';
import { expect, it } from 'vitest';

const path = '/api/v1/staff/reports/agent-performance';
interface Schema {
  pattern?: string;
  additionalProperties?: boolean;
  required?: string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}

it.each(['agent-performance.openapi.yaml', 'openapi.yaml'])(
  'resolves the reporting contract and cookie security in %s',
  async (file) => {
    const ref = fileURLToPath(new URL('../docs/api/' + file, import.meta.url));
    const config = await createConfig({
      extends: [],
      rules: { 'security-defined': 'error', struct: 'error' },
    });
    const resolved = await bundle({ ref, config, dereference: true });
    expect(resolved.problems.filter((p) => p.severity === 'error')).toEqual([]);
    const problems = await lint({ ref, config });
    expect(
      problems
        .filter(
          (p) =>
            p.severity === 'error' &&
            (file !== 'openapi.yaml' ||
              p.location.some((l) => l.pointer?.includes('agent-performance'))),
        )
        .map((p) => p.message),
    ).toEqual([]);
    const document = resolved.bundle.parsed as {
      paths: Record<
        string,
        {
          get: {
            operationId: string;
            security: Record<string, string[]>[];
            parameters: { name: string; schema: Schema }[];
            responses: Record<
              string,
              { content: { 'application/json': { schema: Schema } } }
            >;
          };
        }
      >;
      components: { securitySchemes: Record<string, unknown> };
    };
    const op = document.paths[path]!.get;
    expect(op.operationId).toBe('getAgentPerformanceReport');
    expect(op.security).toEqual([{ StaffCookie: [] }]);
    expect(document.components.securitySchemes.StaffCookie).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'agency.session',
    });
    expect(op.parameters.map((p) => p.name).sort()).toEqual([
      'agentId',
      'from',
      'page',
      'pageSize',
      'to',
    ]);
    for (const name of ['from', 'to']) {
      const pattern = op.parameters.find((parameter) => parameter.name === name)
        ?.schema.pattern;
      expect(pattern).toBeTruthy();
      const date = new RegExp(pattern!);
      expect(date.test('0000-01-01')).toBe(false);
      expect(date.test('0001-01-01')).toBe(true);
    }
    expect(Object.keys(op.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '422',
      '500',
    ]);
    const report = op.responses['200']!.content['application/json'].schema;
    function exact(schema: Schema, keys: string[]) {
      expect(schema.additionalProperties).toBe(false);
      expect(schema.required?.slice().sort()).toEqual(keys.slice().sort());
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
        keys.slice().sort(),
      );
    }
    exact(report, [
      'generatedAt',
      'timezone',
      'from',
      'to',
      'rangeStart',
      'rangeEndExclusive',
      'asOf',
      'scope',
      'page',
      'pageSize',
      'total',
      'items',
      'agentOptions',
      'coverage',
    ]);
    exact(report.properties!.items!.items!, [
      'agent',
      'leadsHandled',
      'dealsClosed',
      'assignmentEpisodes',
      'completedFollowUps',
      'averageFirstFollowUpSeconds',
      'awaitingFollowUp',
      'endedWithoutFollowUp',
    ]);
    exact(report.properties!.agentOptions!.items!, [
      'id',
      'name',
      'availability',
    ]);
    exact(report.properties!.coverage!, [
      'excludedActionCount',
      'excludedAssignmentEpisodeCount',
      'unattributedFirstWinCount',
      'hasLimitations',
    ]);
  },
);
