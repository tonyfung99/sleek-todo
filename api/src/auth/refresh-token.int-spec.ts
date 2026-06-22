import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { startTestInfra, TestInfra } from '../../test/testcontainers';
import { TestAppModule } from '../test-support/test-app.module';

function refreshCookie(setCookie: string[] | undefined): string | undefined {
  return (setCookie ?? []).find((c) => c.startsWith('refresh_token='));
}

describe('Refresh-token rotation (integration)', () => {
  let infra: TestInfra;
  let app: INestApplication;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    infra = await startTestInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;
    process.env.JWT_SECRET = 'refresh-int-secret-0123456789';
    process.env.CORS_ORIGIN = 'http://localhost:5173';

    const moduleRef = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('register sets an httpOnly refresh cookie', async () => {
    const res = await http()
      .post('/auth/register')
      .send({ email: 'r1@x.com', password: 'password123', displayName: 'R1' })
      .expect(201);
    const cookie = refreshCookie(res.headers['set-cookie'] as unknown as string[]);
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(res.body.accessToken).toEqual(expect.any(String));
    // raw refresh token is never in the body
    expect(JSON.stringify(res.body)).not.toContain('refreshToken');
  });

  it('refresh rotates the token; the old cookie is then rejected', async () => {
    const reg = await http()
      .post('/auth/register')
      .send({ email: 'r2@x.com', password: 'password123', displayName: 'R2' })
      .expect(201);
    const firstCookie = refreshCookie(reg.headers['set-cookie'] as unknown as string[]) as string;

    // Use the refresh cookie → new access token + a rotated cookie.
    const refreshed = await http().post('/auth/refresh').set('Cookie', firstCookie).expect(201);
    const secondCookie = refreshCookie(
      refreshed.headers['set-cookie'] as unknown as string[],
    ) as string;
    expect(refreshed.body.accessToken).toEqual(expect.any(String));
    expect(secondCookie).toBeDefined();
    expect(secondCookie).not.toBe(firstCookie);

    // Reusing the now-rotated (revoked) first cookie fails.
    await http().post('/auth/refresh').set('Cookie', firstCookie).expect(401);
    // The new cookie still works.
    await http().post('/auth/refresh').set('Cookie', secondCookie).expect(201);
  });

  it('logout revokes the refresh token', async () => {
    const reg = await http()
      .post('/auth/register')
      .send({ email: 'r3@x.com', password: 'password123', displayName: 'R3' })
      .expect(201);
    const cookie = refreshCookie(reg.headers['set-cookie'] as unknown as string[]) as string;

    await http().post('/auth/logout').set('Cookie', cookie).expect(204);
    await http().post('/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('refresh without a cookie is unauthorized', async () => {
    await http().post('/auth/refresh').expect(401);
  });
});
