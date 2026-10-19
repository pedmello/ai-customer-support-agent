import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';

const app = createApp({ checkDatabase: async () => {} });

describe('HTTP foundation', () => {
  it('returns a consistent 404', async () => {
    const response = await request(app).get('/missing');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('rejects malformed JSON without exposing parser details', async () => {
    const response = await request(app).post('/missing').type('json').send('{"password":');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: 'INVALID_REQUEST', message: 'Invalid request' } });
  });

  it('limits JSON payloads', async () => {
    const response = await request(app).post('/missing').send({ text: 'x'.repeat(17_000) });
    expect(response.status).toBe(413);
    expect(response.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('serves the OpenAPI contract and Swagger UI', async () => {
    const spec = await request(app).get('/openapi.json');
    expect(spec.status).toBe(200);
    expect(spec.body.paths['/health'].get.responses).toHaveProperty('503');
    const swagger = await request(app).get('/docs/');
    expect(swagger.status).toBe(200);
    expect(swagger.text).toContain('swagger-ui');
    expect(swagger.headers['x-content-type-options']).toBe('nosniff');
  });
});
