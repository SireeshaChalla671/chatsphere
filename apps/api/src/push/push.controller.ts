import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PushService } from './push.service.js';
import { SubscribeDto, UnsubscribeDto } from './push.dto.js';

type Req_ = { user: { id: string } };

@Controller('push')
export class PushController {
  constructor(private push: PushService) {}

  @Get('key')
  key() {
    return { key: this.push.publicKey };
  }

  @UseGuards(JwtAuthGuard)
  @Post('subscribe')
  subscribe(@Req() req: Req_, @Body() dto: SubscribeDto) {
    return this.push.subscribe(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('unsubscribe')
  unsubscribe(@Req() req: Req_, @Body() dto: UnsubscribeDto) {
    return this.push.unsubscribe(req.user.id, dto.endpoint);
  }
}
