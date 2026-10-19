import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { Prisma } from '../../src/generated/prisma/client.js';
import { createDatabase } from '../../src/integrations/database/prisma.js';
import { createCustomerRepository } from '../../src/modules/customers/customer.repository.js';
import { demoOrders } from '../../src/modules/customers/customer.service.js';
import { defaultSessionPolicy } from '../../src/modules/sessions/session.service.js';
import { hashSessionToken, newSessionToken } from '../../src/modules/sessions/session.tokens.js';
import { testDatabaseUrl } from '../helpers/test-database.js';

const database = createDatabase(testDatabaseUrl());
const allowedOrigins = ['http://localhost:3000', 'http://localhost:5173'];
const app = createApp({
  checkDatabase: async () => { await database.$queryRaw`SELECT 1`; },
  support: { database, sessionPolicy: defaultSessionPolicy, allowedOrigins },
});
const emails = new Set<string>();
function email() {
  const value = `integration-${randomUUID()}@example.test`;
  emails.add(value);
  return value;
}

function cookieOf(response: request.Response) {
  const cookies = response.headers['set-cookie'] as string[] | undefined;
  if (!cookies?.[0]) throw new Error('Expected a session cookie');
  return cookies[0].split(';')[0]!;
}

async function register() {
  const response = await request(app).post('/customers').send({ name: 'Cliente de teste', email: email() });
  expect(response.status).toBe(201);
  return { cookie: cookieOf(response), csrf: response.body.csrfToken as string, customerId: response.body.customer.customerId as string, response };
}

async function ownOrders(cookie: string) {
  const response = await request(app).get('/orders').set('Cookie', cookie);
  expect(response.status).toBe(200);
  return response.body.data as Array<{ orderId: string; status: string; cancelledAt: string | null; updatedAt: string }>;
}

function cancel(cookie: string, csrf: string, orderId: string) {
  return request(app).post(`/orders/${orderId}/cancel`).set('Cookie', cookie).set('X-CSRF-Token', csrf).send({});
}

beforeAll(async () => { await database.$connect(); });
afterAll(async () => {
  vi.restoreAllMocks();
  try {
    // Somente e-mails aleatórios gerados por esta execução; nunca truncate/reset.
    await database.customer.deleteMany({ where: { email: { in: [...emails] } } });
  } finally { await database.$disconnect(); }
});

describe('transactional registration', () => {
  it('persists a new customer, three consistent orders and only the session hash', async () => {
    const targetEmail = email();
    const response = await request(app).post('/customers').send({ name: '  Ana Silva  ', email: ` ${targetEmail.toUpperCase()} ` });
    expect(response.status).toBe(201);
    expect(response.body.customer).toEqual({ customerId: expect.any(String), name: 'Ana Silva', email: targetEmail });
    expect(response.body.customer.customerId).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.body).not.toHaveProperty('token');
    const cookie = cookieOf(response);
    const rawToken = cookie.split('=')[1]!;
    const session = await database.session.findFirstOrThrow({ where: { customerId: response.body.customer.customerId } });
    expect(session.tokenHash).toBe(hashSessionToken(rawToken));
    expect(JSON.stringify(session)).not.toContain(rawToken);
    expect(session.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const orders = await database.order.findMany({ where: { customerId: session.customerId }, include: { items: true } });
    expect(orders.map((order) => order.status).sort()).toEqual(['CANCELLED', 'PROCESSING', 'SHIPPED']);
    expect(new Set(orders.map((order) => order.orderId)).size).toBe(3);
    for (const order of orders) {
      expect(order.items).toHaveLength(1);
      expect(order.items[0]!.productId).toBeGreaterThan(0);
      expect(order.items[0]!.unitPriceCents).toBeGreaterThan(0);
      expect(order.cancelledAt !== null).toBe(order.status === 'CANCELLED');
    }
    const header = response.headers['set-cookie']?.[0];
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
    expect(header).not.toContain('Domain=');
    expect(header).not.toContain('Secure');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects a normalized duplicate without issuing a cookie or granting access', async () => {
    const targetEmail = email();
    const first = await request(app).post('/customers').send({ name: 'Original', email: targetEmail });
    const duplicate = await request(app).post('/customers').send({ name: 'Outra pessoa', email: ` ${targetEmail.toUpperCase()} ` });
    expect(first.status).toBe(201);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'Email already registered' } });
    expect(duplicate.headers['set-cookie']).toBeUndefined();
    expect((await request(app).get('/sessions/current')).status).toBe(401);
    expect(await database.customer.count({ where: { email: targetEmail } })).toBe(1);
  });

  it('does not replace an existing session when registering someone else’s email', async () => {
    const first = await register();
    const second = await register();
    const duplicate = await request(app).post('/customers').set('Cookie', second.cookie)
      .send({ name: 'Impostor', email: first.response.body.customer.email });
    expect(duplicate.status).toBe(409);
    expect(duplicate.headers['set-cookie']).toBeUndefined();
    const current = await request(app).get('/sessions/current').set('Cookie', second.cookie);
    expect(current.body.customer.customerId).toBe(second.customerId);
  });

  it('handles simultaneous registration of the same normalized email', async () => {
    const targetEmail = email();
    const responses = await Promise.all([
      request(app).post('/customers').send({ name: 'Primeiro', email: targetEmail }),
      request(app).post('/customers').send({ name: 'Segundo', email: targetEmail.toUpperCase() }),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    const customer = await database.customer.findUniqueOrThrow({ where: { email: targetEmail }, include: { orders: true, sessions: true } });
    expect(customer.orders).toHaveLength(3);
    expect(customer.sessions).toHaveLength(1);
  });

  it('rolls back the whole registration if session persistence fails', async () => {
    const existing = await register();
    const session = await database.session.findFirstOrThrow({ where: { customerId: existing.customerId } });
    const targetEmail = email();
    const before = await database.order.count();
    await expect(createCustomerRepository(database).register(
      { name: 'Rollback', email: targetEmail },
      { tokenHash: session.tokenHash, expiresAt: session.expiresAt }, demoOrders(new Date()),
    )).rejects.toBeDefined();
    expect(await database.customer.findUnique({ where: { email: targetEmail } })).toBeNull();
    expect(await database.order.count()).toBe(before);
  });

  it.each([
    { name: '', email: 'valid@example.test' },
    { name: 'Nome', email: 'invalid' },
    { name: 'Nome', email: 'valid@example.test', customerId: randomUUID() },
  ])('returns a standard validation error for invalid input', async (input) => {
    const response = await request(app).post('/customers').send(input);
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Invalid request data' } });
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('sets a host-prefixed Secure cookie for the configured HTTPS environment', async () => {
    const secureApp = createApp({ checkDatabase: async () => {}, support: {
      database, sessionPolicy: { ...defaultSessionPolicy, secure: true }, allowedOrigins: ['https://example.test'],
    } });
    const response = await request(secureApp).post('/customers').send({ name: 'HTTPS', email: email() });
    expect(response.status).toBe(201);
    expect(response.headers['set-cookie']?.[0]).toMatch(/^__Host-support_session=/);
    expect(response.headers['set-cookie']?.[0]).toContain('Secure');
  });
});

describe('sessions, browser security and Postman compatibility', () => {
  it('returns current customer, expiration and the same session-bound CSRF token', async () => {
    const customer = await register();
    const response = await request(app).get('/sessions/current').set('Cookie', customer.cookie);
    expect(response.status).toBe(200);
    expect(response.body.customer.customerId).toBe(customer.customerId);
    expect(response.body.csrfToken).toBe(customer.csrf);
    expect(response.body.session.expiresAt).toBe(customer.response.body.session.expiresAt);
    expect(response.body).not.toHaveProperty('tokenHash');
  });

  it.each([undefined, 'support_session=invalid', `support_session=${newSessionToken()}`, 'support_session=a; support_session=b'])
    ('rejects missing, malformed, unknown and ambiguous session cookies', async (cookie) => {
      const call = request(app).get('/orders');
      if (cookie) call.set('Cookie', cookie);
      const response = await call;
      expect(response.status).toBe(401);
      expect(response.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    });

  it('rejects expired sessions for both reads and cancellation', async () => {
    const customer = await register();
    const orders = await ownOrders(customer.cookie);
    await database.session.updateMany({ where: { customerId: customer.customerId }, data: { expiresAt: new Date(0) } });
    expect((await request(app).get('/orders').set('Cookie', customer.cookie)).status).toBe(401);
    expect((await cancel(customer.cookie, customer.csrf, orders[0]!.orderId)).status).toBe(401);
  });

  it('revokes the current session and rejects its old cookie', async () => {
    const customer = await register();
    const withoutCsrf = await request(app).delete('/sessions/current').set('Cookie', customer.cookie);
    expect(withoutCsrf.status).toBe(403);
    const response = await request(app).delete('/sessions/current').set('Cookie', customer.cookie).set('X-CSRF-Token', customer.csrf);
    expect(response.status).toBe(204);
    expect(response.headers['set-cookie']?.[0]).toContain('Expires=Thu, 01 Jan 1970');
    expect((await database.session.findFirstOrThrow({ where: { customerId: customer.customerId } })).revokedAt).not.toBeNull();
    expect((await request(app).get('/sessions/current').set('Cookie', customer.cookie)).status).toBe(401);
  });

  it('permits credentialed frontend requests and preflight with the CSRF header', async () => {
    const preflight = await request(app).options('/customers').set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,x-csrf-token');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(preflight.headers['access-control-allow-headers']).toContain('X-CSRF-Token');
    const response = await request(app).post('/customers').set('Origin', 'http://localhost:5173').send({ name: 'Web', email: email() });
    expect(response.status).toBe(201);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it.each(['https://attacker.example', 'null', 'http://localhost:5173.attacker.example'])
    ('blocks untrusted origins before creating a customer or exposing CSRF', async (origin) => {
      const targetEmail = email();
      const response = await request(app).post('/customers').set('Origin', origin).send({ name: 'CSRF', email: targetEmail });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('ORIGIN_NOT_ALLOWED');
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(await database.customer.count({ where: { email: targetEmail } })).toBe(0);
      const current = await request(app).get('/sessions/current').set('Origin', origin);
      expect(current.status).toBe(403);
      expect(current.body.csrfToken).toBeUndefined();
    });

  it('blocks simple form registration and cross-site fetch metadata', async () => {
    const form = await request(app).post('/customers').type('form').send({ name: 'Form', email: email() });
    expect(form.status).toBe(415);
    expect(form.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    const crossSite = await request(app).post('/customers').set('Sec-Fetch-Site', 'cross-site').send({ name: 'Form', email: email() });
    expect(crossSite.status).toBe(403);
  });

  it('keeps allowed CORS headers on malformed JSON responses', async () => {
    const response = await request(app).post('/customers').set('Origin', 'http://localhost:5173').type('json').send('{');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_REQUEST');
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });
});

describe('ownership and order cancellation', () => {
  it('lists only the current customer’s orders and supports bounded pagination', async () => {
    const first = await register();
    const second = await register();
    const a = await ownOrders(first.cookie);
    const b = await ownOrders(second.cookie);
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
    expect(a.some((order) => b.some((other) => other.orderId === order.orderId))).toBe(false);
    const page = await request(app).get('/orders?page=2&pageSize=2').set('Cookie', first.cookie);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 3, totalPages: 2 });
    expect((await request(app).get('/orders?pageSize=101').set('Cookie', first.cookie)).status).toBe(400);
    expect((await request(app).get(`/orders?customerId=${second.customerId}`).set('Cookie', first.cookie)).status).toBe(400);
  });

  it('returns identical not-found errors for foreign and missing orders on read and cancel', async () => {
    const first = await register();
    const second = await register();
    const own = (await ownOrders(first.cookie)).find((order) => order.status === 'PROCESSING')!;
    const foreign = await request(app).get(`/orders/${own.orderId}`).set('Cookie', second.cookie);
    const missing = await request(app).get(`/orders/${randomUUID()}`).set('Cookie', second.cookie);
    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    expect((await cancel(second.cookie, second.csrf, own.orderId)).body).toEqual(missing.body);
    expect((await database.order.findUniqueOrThrow({ where: { orderId: own.orderId } })).status).toBe('PROCESSING');
    expect((await request(app).get(`/orders/${own.orderId}`).set('Cookie', first.cookie)).status).toBe(200);
  });

  it('never accepts a customerId in a cancellation body', async () => {
    const customer = await register();
    const own = (await ownOrders(customer.cookie)).find((order) => order.status === 'PROCESSING')!;
    const response = await request(app).post(`/orders/${own.orderId}/cancel`).set('Cookie', customer.cookie)
      .set('X-CSRF-Token', customer.csrf).send({ customerId: customer.customerId });
    expect(response.status).toBe(400);
    expect((await database.order.findUniqueOrThrow({ where: { orderId: own.orderId } })).status).toBe('PROCESSING');
  });

  it('rejects invalid UUIDs without leaking query errors', async () => {
    const customer = await register();
    const response = await request(app).get('/orders/not-a-uuid').set('Cookie', customer.cookie);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects absent, incorrect and another session’s CSRF token without mutation', async () => {
    const customer = await register();
    const other = await register();
    const own = (await ownOrders(customer.cookie)).find((order) => order.status === 'PROCESSING')!;
    const missing = await request(app).post(`/orders/${own.orderId}/cancel`).set('Cookie', customer.cookie).send({});
    expect(missing.status).toBe(403);
    expect((await cancel(customer.cookie, 'invalid', own.orderId)).status).toBe(403);
    expect((await cancel(customer.cookie, other.csrf, own.orderId)).status).toBe(403);
    expect((await database.order.findUniqueOrThrow({ where: { orderId: own.orderId } })).status).toBe('PROCESSING');
  });

  it('cancels PROCESSING exactly once and preserves the timestamp on a repeated request', async () => {
    const customer = await register();
    const own = (await ownOrders(customer.cookie)).find((order) => order.status === 'PROCESSING')!;
    const first = await cancel(customer.cookie, customer.csrf, own.orderId);
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('CANCELLED');
    expect(first.body.data.cancelledAt).toEqual(expect.any(String));
    const second = await cancel(customer.cookie, customer.csrf, own.orderId);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ORDER_ALREADY_CANCELLED');
    const persisted = await database.order.findUniqueOrThrow({ where: { orderId: own.orderId } });
    expect(persisted.cancelledAt!.toISOString()).toBe(first.body.data.cancelledAt);
    expect(persisted.updatedAt.toISOString()).toBe(first.body.data.updatedAt);
  });

  it.each([['SHIPPED', 'ORDER_NOT_CANCELLABLE'], ['CANCELLED', 'ORDER_ALREADY_CANCELLED']])
    ('preserves status and timestamps when cancelling %s', async (status, code) => {
      const customer = await register();
      const own = (await ownOrders(customer.cookie)).find((order) => order.status === status)!;
      const response = await cancel(customer.cookie, customer.csrf, own.orderId);
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe(code);
      const after = await database.order.findUniqueOrThrow({ where: { orderId: own.orderId } });
      expect(after.status).toBe(status);
      expect(after.updatedAt.toISOString()).toBe(own.updatedAt);
      expect(after.cancelledAt?.toISOString() ?? null).toBe(own.cancelledAt);
    });

  it('allows only one transition across eight concurrent cancellation requests', async () => {
    const customer = await register();
    const own = (await ownOrders(customer.cookie)).find((order) => order.status === 'PROCESSING')!;
    const results = await Promise.all(Array.from({ length: 8 }, () => cancel(customer.cookie, customer.csrf, own.orderId)));
    expect(results.filter((result) => result.status === 200)).toHaveLength(1);
    expect(results.filter((result) => result.status === 409 && result.body.error.code === 'ORDER_ALREADY_CANCELLED')).toHaveLength(7);
    const winner = results.find((result) => result.status === 200)!;
    const persisted = await database.order.findUniqueOrThrow({ where: { orderId: own.orderId } });
    expect(persisted.cancelledAt!.toISOString()).toBe(winner.body.data.cancelledAt);
  });
});

describe('technical errors', () => {
  it('does not issue a session or expose driver details on registration failure', async () => {
    const targetEmail = email();
    vi.spyOn(database.customer, 'create').mockRejectedValueOnce(new Error('private password=secret stack database details'));
    const response = await request(app).post('/customers').send({ name: 'Failure', email: targetEmail });
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.text).not.toContain('secret');
    expect(await database.customer.count({ where: { email: targetEmail } })).toBe(0);
  });

  it('maps known database availability failures to a generic 503', async () => {
    const customer = await register();
    vi.spyOn(database.session, 'findFirst').mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('private connection', {
      code: 'P1001', clientVersion: '7.10.1',
    }));
    const response = await request(app).get('/orders').set('Cookie', customer.cookie);
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Service temporarily unavailable' } });
  });

  it('hides unexpected errors when consulting an order', async () => {
    const customer = await register();
    const own = (await ownOrders(customer.cookie))[0]!;
    vi.spyOn(database.order, 'findFirst').mockRejectedValueOnce(new Error('secret query internals'));
    const response = await request(app).get(`/orders/${own.orderId}`).set('Cookie', customer.cookie);
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(response.text).not.toContain('secret');
  });

  it('does not change an order if the cancellation transaction cannot run', async () => {
    const customer = await register();
    const own = (await ownOrders(customer.cookie)).find((order) => order.status === 'PROCESSING')!;
    vi.spyOn(database, '$transaction').mockRejectedValueOnce(new Error('private transaction error'));
    const response = await cancel(customer.cookie, customer.csrf, own.orderId);
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect((await database.order.findUniqueOrThrow({ where: { orderId: own.orderId } })).status).toBe('PROCESSING');
  });
});
