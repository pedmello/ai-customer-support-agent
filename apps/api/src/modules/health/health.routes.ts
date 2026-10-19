import { Router } from 'express';
import { createHealthController } from './health.controller.js';
import { createHealthService, type CheckDatabase } from './health.service.js';

export function createHealthRouter(checkDatabase: CheckDatabase) {
  const router = Router();
  router.get('/health', createHealthController(createHealthService(checkDatabase)));
  return router;
}
