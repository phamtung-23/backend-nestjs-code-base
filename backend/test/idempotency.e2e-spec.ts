import { randomUUID } from 'node:crypto';
import { createTestApp, TestApp, uniqueEmail } from './utils/test-app';

describe('Idempotency (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  // The same client (IP) retries, as a real client would
  const register = (ip: string, body: object, key?: string) => {
    const req = t.http(ip).post('/v1/auth/register');
    return (key ? req.set('Idempotency-Key', key) : req).send(body);
  };

  it('replays the first response for a retry with the same key', async () => {
    const ip = '10.250.0.1';
    const key = randomUUID();
    const body = { email: uniqueEmail('retry'), password: 'Passw0rd!' };

    const first = await register(ip, body, key).expect(201);
    const retry = await register(ip, body, key).expect(201);

    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(retry.body.data.id).toBe(first.body.data.id);
    expect(await t.prisma.user.count({ where: { email: body.email } })).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const ip = '10.250.0.2';
    const key = randomUUID();
    await register(
      ip,
      { email: uniqueEmail('a'), password: 'Passw0rd!' },
      key,
    ).expect(201);

    const res = await register(
      ip,
      { email: uniqueEmail('b'), password: 'Passw0rd!' },
      key,
    ).expect(422);
    expect(res.body.error.errorCode).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('replays business errors too, but a new key runs again', async () => {
    const ip = '10.250.0.3';
    const email = uniqueEmail('taken');
    await register(ip, { email, password: 'Passw0rd!' }).expect(201);

    const key = randomUUID();
    const first = await register(
      ip,
      { email, password: 'Passw0rd!' },
      key,
    ).expect(409);
    const retry = await register(
      ip,
      { email, password: 'Passw0rd!' },
      key,
    ).expect(409);

    expect(first.body.error.errorCode).toBe('AUTH_EMAIL_TAKEN');
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.error.errorCode).toBe('AUTH_EMAIL_TAKEN');
  });

  it('keeps keys of different clients apart', async () => {
    const key = randomUUID();
    const one = await register(
      '10.250.0.4',
      { email: uniqueEmail('one'), password: 'Passw0rd!' },
      key,
    ).expect(201);
    const two = await register(
      '10.250.0.5',
      { email: uniqueEmail('two'), password: 'Passw0rd!' },
      key,
    ).expect(201);

    expect(two.headers['idempotent-replayed']).toBeUndefined();
    expect(two.body.data.id).not.toBe(one.body.data.id);
  });

  it('does not store validation failures, so a corrected body can reuse the key', async () => {
    const ip = '10.250.0.7';
    const key = randomUUID();
    const email = uniqueEmail('fixed');

    const invalid = await register(
      ip,
      { email, password: 'short' },
      key,
    ).expect(400);
    expect(invalid.body.error.errorCode).toBe('VALIDATION_FAILED');

    const fixed = await register(
      ip,
      { email, password: 'Passw0rd!' },
      key,
    ).expect(201);
    expect(fixed.headers['idempotent-replayed']).toBeUndefined();
  });

  it('rejects malformed keys', async () => {
    const res = await register(
      '10.250.0.6',
      { email: uniqueEmail('bad-key'), password: 'Passw0rd!' },
      'short',
    ).expect(400);
    expect(res.body.error.errorCode).toBe('IDEMPOTENCY_KEY_INVALID');
  });
});
