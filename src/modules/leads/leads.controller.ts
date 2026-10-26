import type { Request, Response } from 'express';
import type { Actor } from './leads.repository.js';
import type { LeadService } from './leads.service.js';
import {
  assignmentSchema,
  candidatesSchema,
  createSchema,
  inquirySchema,
  listSchema,
  noteSchema,
  pageSchema,
  parse,
  parseId,
  parseQuery,
  patchSchema,
  stageSchema,
} from './leads.schema.js';
const actor = (res: Response) => res.locals.staff as Actor;

export function createLeadController(service: LeadService) {
  return {
    async list(req: Request, res: Response) {
      res.json(
        await service.list(parseQuery(listSchema, req.originalUrl), actor(res)),
      );
    },

    async detail(req: Request, res: Response) {
      res.json(await service.detail(parseId(req.params.id), actor(res)));
    },

    async activity(req: Request, res: Response) {
      res.json(
        await service.activity(
          parseId(req.params.id),
          parseQuery(pageSchema, req.originalUrl).page,
          actor(res),
        ),
      );
    },

    async candidates(req: Request, res: Response) {
      res.json(
        await service.candidates(
          parseQuery(candidatesSchema, req.originalUrl),
          actor(res),
        ),
      );
    },

    async inquiry(req: Request, res: Response) {
      const result = await service.inquiry(
        parseId(req.params.propertyId),
        parse(inquirySchema, req.body),
      );
      res.status(result.replay ? 200 : 201).json({ received: true });
    },

    async create(req: Request, res: Response) {
      const result = await service.create(
        parse(createSchema, req.body),
        actor(res),
      );
      res.status(result.replay ? 200 : 201).json(result.lead);
    },

    async patch(req: Request, res: Response) {
      res.json(
        await service.patch(
          parseId(req.params.id),
          parse(patchSchema, req.body),
          actor(res),
        ),
      );
    },

    async assignment(req: Request, res: Response) {
      res.json(
        await service.assignment(
          parseId(req.params.id),
          parse(assignmentSchema, req.body),
          actor(res),
        ),
      );
    },

    async stage(req: Request, res: Response) {
      res.json(
        await service.stage(
          parseId(req.params.id),
          parse(stageSchema, req.body),
          actor(res),
        ),
      );
    },

    async note(req: Request, res: Response) {
      const result = await service.note(
        parseId(req.params.id),
        parse(noteSchema, req.body),
        actor(res),
      );
      res
        .status(result.replay ? 200 : 201)
        .json({ note: result.note, leadVersion: result.leadVersion });
    },
  };
}
