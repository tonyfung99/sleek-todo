import { ConfigService } from '@nestjs/config';
import { JwtModuleAsyncOptions } from '@nestjs/jwt';

export const jwtModuleOptions: JwtModuleAsyncOptions = {
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    secret: config.getOrThrow<string>('JWT_SECRET'),
    // Short-lived access token; longevity comes from the rotating refresh token.
    signOptions: { algorithm: 'HS256', expiresIn: '15m' },
  }),
};
