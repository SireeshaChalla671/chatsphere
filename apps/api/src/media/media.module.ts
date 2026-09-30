import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MediaController } from './media.controller.js';

@Module({
  imports: [AuthModule],
  controllers: [MediaController],
})
export class MediaModule {}
