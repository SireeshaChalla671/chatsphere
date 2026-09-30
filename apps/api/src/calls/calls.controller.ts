import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CallsService } from './calls.service.js';
import { StartCallDto } from './calls.dto.js';

type Req_ = { user: { id: string } };

@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private calls: CallsService) {}

  @Post()
  start(@Req() req: Req_, @Body() dto: StartCallDto) {
    return this.calls.start(req.user.id, dto.chatId, dto.type);
  }

  @Get('history')
  history(@Req() req: Req_) {
    return this.calls.history(req.user.id);
  }

  @Post(':id/join')
  join(@Req() req: Req_, @Param('id') id: string) {
    return this.calls.join(req.user.id, id);
  }

  @Post(':id/decline')
  decline(@Req() req: Req_, @Param('id') id: string) {
    return this.calls.decline(req.user.id, id);
  }

  @Post(':id/leave')
  leave(@Req() req: Req_, @Param('id') id: string) {
    return this.calls.leave(req.user.id, id);
  }

  @Post(':id/mute/:userId')
  mute(@Req() req: Req_, @Param('id') id: string, @Param('userId') userId: string) {
    return this.calls.muteParticipant(req.user.id, id, userId);
  }

  @Post(':id/remove/:userId')
  remove(@Req() req: Req_, @Param('id') id: string, @Param('userId') userId: string) {
    return this.calls.removeParticipant(req.user.id, id, userId);
  }

  @Post(':id/end')
  end(@Req() req: Req_, @Param('id') id: string) {
    return this.calls.end(req.user.id, id);
  }
}
