import type { RequestHandler } from 'express';
import { AppError } from '../errors/app-error.js';

export function browserSecurity(allowedOrigins: readonly string[]): RequestHandler {
  return (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.vary('Origin');
    const origin = req.get('Origin');
    if ((origin && !allowedOrigins.includes(origin)) ||
        (!origin && req.get('Sec-Fetch-Site') === 'cross-site')) {
      throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin not allowed');
    }
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
      res.setHeader('Access-Control-Max-Age', '600');
      res.sendStatus(204);
      return;
    }
    next();
  };
}

export const requireJson: RequestHandler = (req, _res, next) => {
  if (!req.is('application/json')) {
    throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  next();
};
