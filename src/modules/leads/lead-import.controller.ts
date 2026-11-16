import type { Request, Response } from 'express';
import { parse } from './leads.schema.js';
import { commitSchema, previewSchema } from './lead-import.schema.js';
import {
  ImportValidationError,
  type LeadImportService,
} from './lead-import.service.js';

export function createLeadImportController(service: LeadImportService) {
  return {
    async template(_req: Request, res: Response) {
      const csv = await service.template(res.locals.staff);
      res
        .set({
          'Content-Type': 'text/csv; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'Content-Disposition':
            'attachment; filename="lead-import-template.csv"',
        })
        .send(csv);
    },
    async preview(req: Request, res: Response) {
      res.json(
        await service.preview(
          parse(previewSchema, req.body).csv,
          res.locals.staff,
        ),
      );
    },
    async commit(req: Request, res: Response) {
      try {
        const result = await service.commit(
          parse(commitSchema, req.body),
          res.locals.staff,
        );
        res.status(result.replayed ? 200 : 201).json(result);
      } catch (error) {
        if (!(error instanceof ImportValidationError)) throw error;
        res.status(422).json({
          error: {
            code: 'IMPORT_VALIDATION_FAILED',
            message: error.message,
            requestId: res.locals.requestId,
          },
          issues: error.issues,
          issueCount: error.issueCount,
        });
      }
    },
  };
}
