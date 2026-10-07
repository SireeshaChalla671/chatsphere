import { NestFactory } from '@nestjs/core';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import { RedisIoAdapter } from './realtime/redis-io.adapter.js';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { rateLimit } from './common/rate-limit.js';

async function bootstrap() {
  const log = new Logger('Bootstrap');
  process.on('unhandledRejection', (e) => log.error('Unhandled rejection: ' + String(e)));
  process.on('uncaughtException', (e) => log.error('Uncaught exception: ' + String(e)));

  const app = await NestFactory.create(AppModule);
  const prod = process.env.NODE_ENV === 'production';

  (app.getHttpAdapter().getInstance() as { set: (k: string, v: unknown) => void }).set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const mult = prod ? 1 : 20; // relaxed in development so load tests work
  app.use(rateLimit({ windowMs: 60_000, max: 600 * mult, authMax: 30 * mult }));

  const origins = process.env.WEB_ORIGIN?.split(',').map((s) => s.trim()).filter(Boolean);
  app.enableCors({ origin: origins?.length ? origins : true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const adapter = new RedisIoAdapter(app);
  adapter.connectToRedis(process.env.REDIS_URL ?? 'redis://localhost:6379');
  app.useWebSocketAdapter(adapter);

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
