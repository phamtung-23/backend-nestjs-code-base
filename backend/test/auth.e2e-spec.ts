import { createHash } from 'node:crypto';
import { createTestApp, nextIp, TestApp, uniqueEmail } from './utils/test-app';

const PASSWORD = 'Passw0rd!';
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const otherCode = (code: string) => (code === '000000' ? '111111' : '000000');

interface Session {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string };
}

describe('Authentication (e2e)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });

  afterAll(async () => {
    await t.app.close();
  });

  const register = (email: string, password = PASSWORD) =>
    t.http().post('/v1/auth/register').send({ email, password });

  const verify = async (email: string, password = PASSWORD) => {
    const otpCode = await t.mailbox.code(email, 'verification');
    await t
      .http()
      .post('/v1/auth/verify-email')
      .send({ email, otpCode, password })
      .expect(200);
  };

  const login = async (email: string, password = PASSWORD): Promise<Session> =>
    (
      await t
        .http()
        .post('/v1/auth/login')
        .send({ email, password })
        .expect(200)
    ).body.data;

  const refresh = (refreshToken: string) =>
    t.http().post('/v1/auth/refresh-token').send({ refreshToken });

  const verifiedUser = async (label: string) => {
    const email = uniqueEmail(label);
    await register(email).expect(201);
    await verify(email);
    return email;
  };

  it('registers, requires email verification, then logs in', async () => {
    const email = uniqueEmail('signup');

    const created = await register(`  ${email.toUpperCase()} `).expect(201);
    expect(created.body.data).toMatchObject({
      email,
      isEmailVerified: false,
    });
    expect(created.body.data).not.toHaveProperty('password');

    const duplicate = await register(email.toUpperCase()).expect(409);
    expect(duplicate.body.error.errorCode).toBe('AUTH_EMAIL_TAKEN');

    const early = await t
      .http()
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(403);
    expect(early.body.error.errorCode).toBe('AUTH_EMAIL_NOT_VERIFIED');

    const code = await t.mailbox.code(email, 'verification');
    const wrongPassword = await t
      .http()
      .post('/v1/auth/verify-email')
      .send({ email, otpCode: code, password: 'Wrong1234' })
      .expect(401);
    expect(wrongPassword.body.error.errorCode).toBe('AUTH_INVALID_CREDENTIALS');
    const wrongCode = await t
      .http()
      .post('/v1/auth/verify-email')
      .send({ email, otpCode: otherCode(code), password: PASSWORD })
      .expect(422);
    expect(wrongCode.body.error.errorCode).toBe('AUTH_INVALID_CODE');
    await verify(email);

    const session = await login(email);
    expect(Object.keys(session).sort()).toEqual([
      'accessToken',
      'refreshToken',
      'user',
    ]);
    const profile = await t
      .http()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
    expect(profile.body.data.email).toBe(email);
  });

  it('never accepts a refresh token as an access token', async () => {
    const session = await login(await verifiedUser('confusion'));
    await t
      .http()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.refreshToken}`)
      .expect(401);
  });

  it('rotates refresh tokens and revokes the session when a rotated token is reused', async () => {
    const email = await verifiedUser('rotation');
    const first = await login(email);
    const second = (await refresh(first.refreshToken).expect(200)).body.data;

    // Reused right away: most likely two tabs, so only this request fails
    await refresh(first.refreshToken).expect(401);
    const third = (await refresh(second.refreshToken).expect(200)).body.data;

    // Reused after the grace window: the token was copied
    await t.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(first.refreshToken) },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });
    const reused = await refresh(first.refreshToken).expect(401);
    expect(reused.body.error.errorCode).toBe('AUTH_INVALID_REFRESH_TOKEN');
    await refresh(third.refreshToken).expect(401);

    // Other sessions of the same user are unaffected
    const other = await login(email);
    await refresh(other.refreshToken).expect(200);
  });

  it('stores refresh tokens only as hashes', async () => {
    const session = await login(await verifiedUser('hashing'));
    const stored = await t.prisma.refreshToken.findFirst({
      where: { tokenHash: sha256(session.refreshToken) },
    });
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored)).not.toContain(session.refreshToken);

    // No column left that could hold the token itself
    const columns = await t.prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'refresh_tokens'`;
    expect(columns.map((column) => column.column_name)).not.toContain('token');
  });

  it('logout ends the session; logout-all ends every session', async () => {
    const email = await verifiedUser('logout');
    const a = await login(email);
    const aRotated = (await refresh(a.refreshToken).expect(200)).body.data;

    // Logging out with an older token of the session still ends it
    await t
      .http()
      .post('/v1/auth/logout')
      .send({ refreshToken: a.refreshToken })
      .expect(200);
    await refresh(aRotated.refreshToken).expect(401);
    await t
      .http()
      .post('/v1/auth/logout')
      .send({ refreshToken: 'not-a-token' })
      .expect(200);

    const b = await login(email);
    const c = await login(email);
    await t
      .http()
      .post('/v1/auth/logout-all')
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(200);
    await refresh(b.refreshToken).expect(401);
    await refresh(c.refreshToken).expect(401);
  });

  it('changing the password keeps this session and ends the others', async () => {
    const email = await verifiedUser('change');
    const current = await login(email);
    const other = await login(email);

    const wrong = await t
      .http()
      .post('/v1/auth/change-password')
      .set('Authorization', `Bearer ${current.accessToken}`)
      .send({ currentPassword: 'Nope1234', newPassword: 'N3wPassword!' })
      .expect(422);
    expect(wrong.body.error.errorCode).toBe('AUTH_CURRENT_PASSWORD_INCORRECT');

    const changed = await t
      .http()
      .post('/v1/auth/change-password')
      .set('Authorization', `Bearer ${current.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'N3wPassword!' })
      .expect(200);

    await refresh(other.refreshToken).expect(401);
    await refresh(changed.body.data.refreshToken).expect(200);
    await t
      .http()
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(401);
    await login(email, 'N3wPassword!');
  });

  it('password reset replaces the password and ends every session', async () => {
    const email = await verifiedUser('reset');
    const before = await login(email);

    await t.http().post('/v1/auth/forgot-password').send({ email }).expect(200);
    const code = await t.mailbox.code(email, 'password-reset');
    await t
      .http()
      .post('/v1/auth/reset-password')
      .send({ email, otpCode: otherCode(code), newPassword: 'R3setPass!' })
      .expect(422);
    await t
      .http()
      .post('/v1/auth/reset-password')
      .send({ email, otpCode: code, newPassword: 'R3setPass!' })
      .expect(200);

    await refresh(before.refreshToken).expect(401);
    await login(email, 'R3setPass!');
  });

  it('protects against someone registering another person email first', async () => {
    const email = uniqueEmail('victim');
    await register(email, 'Att4ckerPass!').expect(201);

    // The squatter can't use the account: it isn't verified
    await t
      .http()
      .post('/v1/auth/login')
      .send({ email, password: 'Att4ckerPass!' })
      .expect(403);

    // The owner receives the codes but can't verify without the squatter's password
    const verification = await t.mailbox.code(email, 'verification');
    await t
      .http()
      .post('/v1/auth/verify-email')
      .send({ email, otpCode: verification, password: 'Own3rGuess!' })
      .expect(401);

    // Login by code works for the owner and doesn't unlock the squatter's password
    await t.http().post('/v1/auth/send-otp').send({ email }).expect(200);
    const loginCode = await t.mailbox.code(email, 'login');
    await t
      .http()
      .post('/v1/auth/verify-otp')
      .send({ email, otpCode: loginCode })
      .expect(200);
    await t
      .http()
      .post('/v1/auth/login')
      .send({ email, password: 'Att4ckerPass!' })
      .expect(403);

    // A reset hands the account to the owner
    await t.http().post('/v1/auth/forgot-password').send({ email }).expect(200);
    const resetCode = await t.mailbox.code(email, 'password-reset');
    await t
      .http()
      .post('/v1/auth/reset-password')
      .send({ email, otpCode: resetCode, newPassword: 'Own3rPass!' })
      .expect(200);
    await t
      .http()
      .post('/v1/auth/login')
      .send({ email, password: 'Att4ckerPass!' })
      .expect(401);
    const owner = await login(email, 'Own3rPass!');
    expect(owner.user).toMatchObject({ email });
  });

  it('kills a code after 5 wrong guesses', async () => {
    const email = uniqueEmail('lockout');
    await register(email).expect(201);
    const code = await t.mailbox.code(email, 'verification');

    for (let i = 0; i < 5; i++) {
      await t
        .http()
        .post('/v1/auth/verify-email')
        .send({ email, otpCode: otherCode(code), password: PASSWORD })
        .expect(422);
    }
    await t
      .http()
      .post('/v1/auth/verify-email')
      .send({ email, otpCode: code, password: PASSWORD })
      .expect(422);
  });

  it('limits how often codes are issued per account', async () => {
    const email = await verifiedUser('cooldown');
    await t.http().post('/v1/auth/forgot-password').send({ email }).expect(200);
    await t.mailbox.code(email, 'password-reset');
    await t.http().post('/v1/auth/forgot-password').send({ email }).expect(200);
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(t.mailbox.sentCount(email, 'password-reset')).toBe(1);
  });

  it('answers public flows the same way for unknown emails', async () => {
    const email = await verifiedUser('known');
    const unknown = uniqueEmail('unknown');

    for (const path of ['forgot-password', 'send-otp', 'resend-verification']) {
      const known = await t.http().post(`/v1/auth/${path}`).send({ email });
      const other = await t
        .http()
        .post(`/v1/auth/${path}`)
        .send({ email: unknown });
      expect(other.status).toBe(known.status);
      expect(other.body.message).toBe(known.body.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(t.mailbox.sentCount(unknown, 'password-reset')).toBe(0);
  });

  it('disabled accounts lose access immediately', async () => {
    const email = await verifiedUser('disabled');
    const session = await login(email);
    await t.prisma.user.update({ where: { email }, data: { isActive: false } });

    await t
      .http()
      .get('/v1/auth/profile')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(401);
    await refresh(session.refreshToken).expect(401);
    const res = await t
      .http(nextIp())
      .post('/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(403);
    expect(res.body.error.errorCode).toBe('AUTH_ACCOUNT_DISABLED');
  });
});
