import type { Request, Response } from 'express';
import type { StaffRole } from '../auth/auth.js';
import type { PropertyService } from './properties.service.js';
import {
  createSchema,
  orderSchema,
  parse,
  parseId,
  parseQuery,
  patchSchema,
} from './properties.schema.js';
import { decodePropertyImage, readImageBody } from './properties.image.js';

const role = (res: Response) => res.locals.staff.role as StaffRole;

export function createPropertyController(service: PropertyService) {
  return {
    async publicList(req: Request, res: Response) {
      res.json(await service.list(parseQuery(req.originalUrl, false)));
    },

    async publicDetail(req: Request, res: Response) {
      res.json(await service.detail(parseId(req.params.id)));
    },

    async staffList(req: Request, res: Response) {
      res.json(
        await service.list(parseQuery(req.originalUrl, true), role(res)),
      );
    },

    async staffDetail(req: Request, res: Response) {
      res.json(await service.detail(parseId(req.params.id), role(res)));
    },

    async create(req: Request, res: Response) {
      const property = await service.create(
        parse(createSchema, req.body),
        role(res),
      );

      res
        .location(`/api/v1/staff/properties/${property.id}`)
        .status(201)
        .json(property);
    },

    async patch(req: Request, res: Response) {
      res.json(
        await service.patch(
          parseId(req.params.id),
          parse(patchSchema, req.body),
          role(res),
        ),
      );
    },

    async remove(req: Request, res: Response) {
      await service.remove(
        parseId(req.params.id),
        role(res),
        res.locals.requestId,
      );
      res.status(204).end();
    },

    async upload(req: Request, res: Response) {
      const image = await decodePropertyImage(
        await readImageBody(req),
        req.get('Content-Type')?.split(';')[0]?.trim() ?? '',
      );

      res
        .status(201)
        .json(
          await service.attachPhoto(
            parseId(req.params.id),
            image,
            role(res),
            res.locals.requestId,
          ),
        );
    },

    async order(req: Request, res: Response) {
      res.json(
        await service.orderPhotos(
          parseId(req.params.id),
          parse(orderSchema, req.body).photoIds,
          role(res),
        ),
      );
    },

    async removePhoto(req: Request, res: Response) {
      res.json(
        await service.removePhoto(
          parseId(req.params.id),
          parseId(req.params.photoId),
          role(res),
          res.locals.requestId,
        ),
      );
    },
  };
}
