import type { RequestHandler } from 'express';
import type { createHealthService } from './health.service.js';

export function createHealthController(service: ReturnType<typeof createHealthService>): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      res.status(200).json(await service.check());
    } catch (error) {
      req.log.warn({ err: error }, 'Database health check failed');
      res.status(503).json({ status: 'error', database: 'down' });
    }
  };
}
