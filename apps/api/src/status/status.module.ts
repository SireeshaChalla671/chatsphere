import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { StatusController } from './status.controller.js';
import { StatusService } from './status.service.js';

@Module({
  imports: [AuthModule],
  controllers: [StatusController],
  providers: [StatusService],
})
export class StatusModule {}
