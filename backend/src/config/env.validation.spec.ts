import { NodeEnv, parseOrigins, validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://localhost:5432/app',
    JWT_SECRET: 'dev-access-secret',
    JWT_REFRESH_SECRET: 'dev-refresh-secret',
  };
  const strongSecrets = {
    JWT_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
  };

  it('applies defaults and converts types', () => {
    const env = validateEnv({ ...base, PORT: '4000' });
    expect(env).toMatchObject({
      NODE_ENV: NodeEnv.Development,
      PORT: 4000,
      API_VERSION: '1',
      REDIS_HOST: 'localhost',
      REDIS_PORT: 6379,
      OTP_MAX_ATTEMPTS: 5,
      SMTP_PORT: 587,
    });
  });

  it('treats empty strings as unset (docker compose passes unset vars as "")', () => {
    const env = validateEnv({ ...base, OTP_MAX_ATTEMPTS: '', API_PREFIX: '' });
    expect(env.OTP_MAX_ATTEMPTS).toBe(5);
    expect(env.API_PREFIX).toBeUndefined();
  });

  it('keeps variables it does not declare', () => {
    expect(validateEnv({ ...base, EXTRA_FLAG: 'on' })).toHaveProperty(
      'EXTRA_FLAG',
      'on',
    );
  });

  it('rejects missing required variables without printing values', () => {
    expect(() => validateEnv({ JWT_SECRET: 'top-secret-value' })).toThrow(
      /DATABASE_URL[\s\S]*JWT_REFRESH_SECRET/,
    );
    expect(() => validateEnv({ JWT_SECRET: 'top-secret-value' })).not.toThrow(
      /top-secret-value/,
    );
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['REDIS_PORT', '0'],
    ['OTP_MAX_ATTEMPTS', '50'],
    ['API_VERSION', 'v1'],
    ['NODE_ENV', 'staging'],
    ['SWAGGER_ENABLED', 'yes'],
  ])('rejects an invalid %s (%s)', (key, value) => {
    expect(() => validateEnv({ ...base, [key]: value })).toThrow(key);
  });

  it('parses SWAGGER_ENABLED booleans', () => {
    expect(
      validateEnv({ ...base, SWAGGER_ENABLED: 'false' }).SWAGGER_ENABLED,
    ).toBe(false);
    expect(
      validateEnv({ ...base, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED,
    ).toBe(true);
  });

  it('accepts exact http(s) origins', () => {
    expect(() =>
      validateEnv({
        ...base,
        ALLOWED_ORIGINS: 'https://app.example.com, http://localhost:3000',
      }),
    ).not.toThrow();
  });

  it.each([
    '*',
    'https://*.example.com',
    'https://app.example.com/path',
    'https://app.example.com/',
    'https://app.example.com?x=1',
    'https://app.example.com#top',
    'HTTPS://App.Example.com',
    'ftp://files.example.com',
    'app.example.com',
  ])('rejects the origin %s', (origin) => {
    expect(() => validateEnv({ ...base, ALLOWED_ORIGINS: origin })).toThrow(
      'ALLOWED_ORIGINS',
    );
  });

  describe('in production', () => {
    const production = { ...base, NODE_ENV: 'production' };

    it('requires secrets of at least 32 characters', () => {
      expect(() => validateEnv(production)).toThrow(
        /JWT_SECRET must be at least 32[\s\S]*JWT_REFRESH_SECRET must be at least 32/,
      );
    });

    it.each([
      'your-super-secret-jwt-key-here-change-in-production',
      'please-change-me-before-going-live-0123456789',
    ])('rejects placeholder secrets such as %s', (placeholder) => {
      expect(() =>
        validateEnv({
          ...production,
          JWT_SECRET: placeholder,
          JWT_REFRESH_SECRET: strongSecrets.JWT_REFRESH_SECRET,
        }),
      ).toThrow('JWT_SECRET still contains a placeholder value');
    });

    it('requires different access and refresh secrets', () => {
      const same = 'c'.repeat(40);
      expect(() =>
        validateEnv({
          ...production,
          JWT_SECRET: same,
          JWT_REFRESH_SECRET: same,
        }),
      ).toThrow('must be different');
    });

    it('accepts strong, distinct secrets', () => {
      expect(validateEnv({ ...production, ...strongSecrets }).NODE_ENV).toBe(
        NodeEnv.Production,
      );
    });
  });
});

describe('parseOrigins', () => {
  it('splits, trims and drops empty entries', () => {
    expect(parseOrigins(' https://a.com , ,http://b.com ')).toEqual([
      'https://a.com',
      'http://b.com',
    ]);
  });

  it('returns an empty list when unset', () => {
    expect(parseOrigins(undefined)).toEqual([]);
  });
});
