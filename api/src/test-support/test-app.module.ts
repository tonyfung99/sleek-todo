import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { HealthModule } from '../health/health.module';
import { ListsModule } from '../lists/lists.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RedisModule } from '../redis/redis.module';
import { TodosModule } from '../todos/todos.module';
import { UsersModule } from '../users/users.module';

// Integration-only root module: schema via synchronize, no migrations,
// no pino transport. DATABASE_URL / REDIS_URL / JWT_SECRET / CORS_ORIGIN
// must be set on process.env before importing this (see int-specs).
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'postgres',
      url: process.env.DATABASE_URL,
      autoLoadEntities: true,
      synchronize: true,
    }),
    RedisModule,
    HealthModule,
    UsersModule,
    AuthModule,
    ListsModule,
    TodosModule,
    RealtimeModule,
  ],
  providers: [
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({ whitelist: true, transform: true }),
    },
  ],
})
export class TestAppModule {}
