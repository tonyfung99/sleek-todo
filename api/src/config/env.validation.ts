import * as Joi from 'joi';

export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  CORS_ORIGIN: string;
}

const schema = Joi.object<AppEnv>({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),
  JWT_SECRET: Joi.string().min(16).required(),
  CORS_ORIGIN: Joi.string().uri().default('http://localhost:5173'),
});

export function validateEnv(config: Record<string, unknown>): AppEnv {
  const { error, value } = schema.validate(config, { allowUnknown: true, abortEarly: false });
  if (error) {
    throw new Error(`Config validation error: ${error.message}`);
  }
  return value as AppEnv;
}
