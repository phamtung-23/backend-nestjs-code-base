import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createTestApp, TestApp, uniqueEmail } from './utils/test-app';

const PASSWORD = 'Passw0rd!';

describe('Audit log (e2e)', () => {
  let t: TestApp;
  let adminToken: string;

  beforeAll(async () => {
    t = await createTestApp();

    const email = uniqueEmail('admin');
    await t.prisma.user.create({
      data: {
        email,
        password: await bcrypt.hash(PASSWORD, 10),
        role: UserRole.ADMIN,
        isEmailVerified: true,
      },
    });
    adminToken = (
      await t
        .http()
        .post('/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.data.accessToken;
  });

  afterAll(async () => {
    await t.app.close();
  });

  const listAs = (token: string, query = '') =>
    t
      .http()
      .get(`/v1/audit-logs${query}`)
      .set('Authorization', `Bearer ${token}`);

  const signUpAndLogIn = async (ip: string) => {
    const email = uniqueEmail('audited');
    const user = (
      await t
        .http(ip)
        .post('/v1/auth/register')
        .send({ email, password: PASSWORD })
        .expect(201)
    ).body.data;
    const otpCode = await t.mailbox.code(email, 'verification');
    await t
      .http(ip)
      .post('/v1/auth/verify-email')
      .send({ email, otpCode, password: PASSWORD })
      .expect(200);
    const session = (
      await t
        .http(ip)
        .post('/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200)
    ).body.data;
    return { email, userId: user.id as string, session };
  };

  it('records who did what, from where, in the same request', async () => {
    const ip = '10.240.0.1';
    const { userId } = await signUpAndLogIn(ip);

    const res = await listAs(
      adminToken,
      `?actorId=${userId}&sort=createdAt`,
    ).expect(200);
    const entries = res.body.data as Array<Record<string, unknown>>;

    expect(entries.map((entry) => entry.action)).toEqual([
      'user.registered',
      'user.email_verified',
      'session.started',
    ]);
    expect(entries[2]).toMatchObject({
      entity: 'session',
      metadata: { method: 'password' },
      ipAddress: ip,
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
  });

  it('records failed logins of existing accounts', async () => {
    const { email, userId } = await signUpAndLogIn('10.240.0.2');
    await t
      .http()
      .post('/v1/auth/login')
      .send({ email, password: 'Wrong1234' })
      .expect(401);

    // Written in the background so it doesn't affect response time
    let failures: unknown[] = [];
    for (let attempt = 0; attempt < 50 && failures.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      failures = (
        await listAs(
          adminToken,
          `?entityId=${userId}&action=user.login_failed`,
        ).expect(200)
      ).body.data;
    }
    expect(failures).toHaveLength(1);
  });

  it('paginates, projects and validates the query', async () => {
    const ids = (res: { body: { data: Array<{ id: string }> } }) =>
      res.body.data.map((entry) => entry.id);

    const first = await listAs(adminToken, '?limit=2&fields=id,action').expect(
      200,
    );
    expect(first.body.meta).toEqual({
      limit: 2,
      hasMore: true,
      nextCursor: expect.any(String),
    });
    // createdAt is read to build the cursor but not returned unless asked for
    expect(Object.keys(first.body.data[0]).sort()).toEqual(['action', 'id']);

    // Two pages of 2 are exactly one page of 4: nothing skipped or repeated
    const second = await listAs(
      adminToken,
      `?limit=2&cursor=${first.body.meta.nextCursor}`,
    ).expect(200);
    const four = await listAs(adminToken, '?limit=4').expect(200);
    expect([...ids(first), ...ids(second)]).toEqual(ids(four));

    // A bare date as upper bound covers the whole day
    const today = new Date().toISOString().slice(0, 10);
    const sameDay = await listAs(
      adminToken,
      `?createdFrom=${today}&createdTo=${today}`,
    ).expect(200);
    expect(sameDay.body.data.length).toBeGreaterThan(0);

    const invalid = [
      '?sort=ipAddress',
      '?sort=action',
      '?sort=createdAt,-createdAt',
      '?fields=password',
      '?cursor=not-a-cursor',
      `?cursor=${first.body.meta.nextCursor}!!`,
      // A cursor belongs to the sort of the page it came from
      `?sort=createdAt&cursor=${first.body.meta.nextCursor}`,
    ];
    for (const query of invalid) {
      const res = await listAs(adminToken, query).expect(400);
      expect(res.body.error.errorCode).toBe('INVALID_QUERY_PARAM');
    }
  });

  it('keeps paging when the row the cursor points at is deleted meanwhile', async () => {
    const ids = (res: { body: { data: Array<{ id: string }> } }) =>
      res.body.data.map((entry) => entry.id);
    const [first, rest] = await Promise.all([
      listAs(adminToken, '?limit=2&sort=createdAt').expect(200),
      listAs(adminToken, '?limit=4&sort=createdAt').expect(200),
    ]);

    // e.g. the retention job purging the oldest entries
    await t.prisma.auditLog.delete({ where: { id: ids(first)[1] } });

    const next = await listAs(
      adminToken,
      `?limit=2&sort=createdAt&cursor=${first.body.meta.nextCursor}`,
    ).expect(200);
    expect(ids(next)).toEqual(ids(rest).slice(2));
  });

  it.each([
    ['a limit above 100', '?limit=101'],
    ['a date that is not ISO-8601', '?createdFrom=hello%202026'],
    ['an impossible day', '?createdTo=2026-02-30'],
    ['a malformed actor id', '?actorId=x'],
    ['search (not supported here)', '?search=password'],
    ['include (entries have no relations)', '?include=actor'],
    ['an unknown parameter', '?foo=1'],
    ['page (cursor pagination only)', '?page=2'],
  ])('returns 400 VALIDATION_FAILED for %s', async (_case, query) => {
    const res = await listAs(adminToken, query).expect(400);
    expect(res.body.error.errorCode).toBe('VALIDATION_FAILED');
  });

  it('records the session a password change starts', async () => {
    const { userId, session } = await signUpAndLogIn('10.240.0.4');
    await t
      .http()
      .post('/v1/auth/change-password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'NewPassw0rd!' })
      .expect(200);

    const res = await listAs(
      adminToken,
      `?actorId=${userId}&sort=-createdAt&limit=2`,
    ).expect(200);
    expect(
      res.body.data.map((entry: { action: string }) => entry.action),
    ).toEqual(
      expect.arrayContaining(['user.password_changed', 'session.started']),
    );
    expect(
      res.body.data.find(
        (entry: { action: string }) => entry.action === 'session.started',
      ).metadata,
    ).toEqual({ method: 'password_change' });
  });

  it('is only available to admins', async () => {
    const { session } = await signUpAndLogIn('10.240.0.3');

    const forbidden = await listAs(session.accessToken).expect(403);
    expect(forbidden.body.error.errorCode).toBe('FORBIDDEN');
    await t.http().get('/v1/audit-logs').expect(401);
  });
});
