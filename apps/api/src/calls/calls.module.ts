import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { ChatsModule } from '../chats/chats.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { CallsController } from './calls.controller.js';
import { CallsService } from './calls.service.js';

@Module({
  imports: [AuthModule, ChatsModule, RealtimeModule],
  controllers: [CallsController],
  providers: [CallsService],
})
export class CallsModule {}
