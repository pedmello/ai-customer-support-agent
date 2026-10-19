import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../errors/app-error.js';
import { Prisma } from '../generated/prisma/client.js';

export const notFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
};

export const errorHandler: ErrorRequestHandler = (error: unknown, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof AppError) {
    res.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data' } });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError &&
      ['P1001', 'P1002', 'P1008', 'P1017', 'P2024'].includes(error.code)) {
    req.log.error({ err: error }, 'Database unavailable');
    res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Service temporarily unavailable' } });
    return;
  }

  const type = typeof error === 'object' && error !== null && 'type' in error ? error.type : undefined;
  if (type === 'entity.parse.failed' || type === 'entity.too.large') {
    const tooLarge = type === 'entity.too.large';
    res.status(tooLarge ? 413 : 400).json({
      error: {
        code: tooLarge ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST',
        message: tooLarge ? 'Request payload too large' : 'Invalid request',
      },
    });
    return;
  }

  req.log.error({ err: error }, 'Unhandled request error');
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
};
