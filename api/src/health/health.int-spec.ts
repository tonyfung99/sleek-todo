import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { startTestInfra, TestInfra } from '../../test/testcontainers';
import { HealthModule } from './health.module';

describe('Health (integration)', () => {
  let app: INestApplication;
  let infra: TestInfra;

  beforeAll(async () => {
    infra = await startTestInfra();
    process.env.DATABASE_URL = infra.databaseUrl;
    process.env.REDIS_URL = infra.redisUrl;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'postgres',
          url: infra.databaseUrl,
          autoLoadEntities: true,
          synchronize: false,
        }),
        HealthModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await infra?.stop();
  });

  it('GET /health/live returns ok', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({ status: 'ok' });
  });

  it('GET /health/ready reports db + redis up', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.info.database.status).toBe('up');
    expect(res.body.info.redis.status).toBe('up');
  });
});
