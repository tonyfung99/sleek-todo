import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    NODE_ENV: 'test',
    PORT: '3000',
    DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('passes with all required vars', () => {
    expect(() => validateEnv(valid)).not.toThrow();
  });

  it('coerces PORT to a number', () => {
    expect(validateEnv(valid).PORT).toBe(3000);
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL: _DATABASE_URL, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('throws when REDIS_URL is missing', () => {
    const { REDIS_URL: _REDIS_URL, ...rest } = valid;
    expect(() => validateEnv(rest)).toThrow(/REDIS_URL/);
  });
});
