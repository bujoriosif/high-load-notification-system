import 'reflect-metadata';
import { join } from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useStaticAssets(join(process.cwd(), 'public'));
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  console.log(`Notification POC listening on http://localhost:${port}`);
  console.log(`Dashboard: http://localhost:${port}/dashboard.html`);
}

void bootstrap();
