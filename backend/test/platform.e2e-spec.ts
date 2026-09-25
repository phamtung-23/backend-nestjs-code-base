import { REDIS_CLIENT, RedisClient } from '../src/redis/redis.constants';
import { createTestApp, nextIp, TestApp } from './utils/test-app';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('Platform (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  it('serves /health publicly with a request id and security headers', async () => {
    const res = await t.http().get('/health').expect(200);

    expect(res.body).toMatchObject({
      status: 'success',
      data: { database: 'up' },
    });
    expect(res.headers['x-request-id']).toMatch(UUID);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain(
      "default-src 'self'",
    );
  });

  it('answers unknown routes with the error envelope', async () => {
    const res = await t.http().get('/v1/nope?token=secret').expect(404);

    expect(res.body).toEqual({
      status: 'error',
      message: expect.any(String),
      data: null,
      error: {
        code: 404,
        errorCode: 'NOT_FOUND',
        details: null,
        requestId: res.headers['x-request-id'],
        path: '/v1/nope',
        timestamp: expect.any(String),
      },
    });
  });

  it('reports validation errors per field, including unknown properties', async () => {
    const res = await t
      .http()
      .post('/v1/auth/register')
      .send({ email: 'not-an-email', password: 'x', role: 'ADMIN' })
      .expect(400);

    expect(res.body.message).toBe('Validation failed');
    expect(res.body.error.errorCode).toBe('VALIDATION_FAILED');
    expect(
      res.body.error.details.map((d: { field: string }) => d.field),
    ).toEqual(expect.arrayContaining(['email', 'password', 'role']));
  });

  it('rejects malformed JSON with 400', async () => {
    const res = await t
      .http()
      .post('/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": ')
      .expect(400);

    expect(res.body.error.errorCode).toBe('BAD_REQUEST');
    expect(res.body.error.requestId).toMatch(UUID);
  });

  it('protects routes unless they are public', async () => {
    const res = await t.http().get('/v1/auth/profile').expect(401);
    expect(res.body.error.errorCode).toBe('UNAUTHENTICATED');
  });

  it('rate limits per client IP, with counters in Redis', async () => {
    const ip = nextIp();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await t
        .http(ip)
        .post('/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'Wrong1234' });
      statuses.push(res.status);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    const redis = t.app.get<RedisClient>(REDIS_CLIENT);
    expect((await redis.keys('throttle:*')).length).toBeGreaterThan(0);
    // Another client is unaffected
    await t
      .http()
      .post('/v1/auth/login')
      .send({ email: 'nobody@example.com', password: 'Wrong1234' })
      .expect(401);
  });
});
