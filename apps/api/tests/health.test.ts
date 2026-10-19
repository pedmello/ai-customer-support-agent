import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';

describe('GET /health', () => {
  it('returns 200 only after checking the database', async () => {
    const checkDatabase = vi.fn().mockResolvedValue(undefined);
    const response = await request(createApp({ checkDatabase })).get('/health');

    expect(checkDatabase).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', database: 'up' });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('returns 503 without exposing database error details', async () => {
    const checkDatabase = vi.fn().mockRejectedValue(new Error('postgresql://secret@internal/db'));
    const response = await request(createApp({ checkDatabase })).get('/health');

    expect(response.status).toBe(503);
    expect(response.body).toEqual({ status: 'error', database: 'down' });
    expect(response.text).not.toContain('secret');
  });
});
