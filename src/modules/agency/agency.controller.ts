import type { Request, Response } from 'express';
import type { AgencyService } from './agency.service.js';

export function createAgencyController(service: AgencyService) {
  return {
    agency(_req: Request, res: Response) {
      res.json(service.agency());
    },

    agents(_req: Request, res: Response) {
      res.json(service.agents());
    },

    agent(req: Request, res: Response) {
      res.json(service.agent(req.params.slug));
    },
  };
}
