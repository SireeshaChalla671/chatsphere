import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ChatsService } from './chats.service.js';
import { CreateDirectDto, SendMessageDto } from './chats.dto.js';

type Req_ = { user: { id: string } };

@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(private chats: ChatsService) {}

  @Post('direct')
  direct(@Req() req: Req_, @Body() dto: CreateDirectDto) {
    return this.chats.getOrCreateDirect(req.user.id, dto.userId);
  }

  @Get()
  list(@Req() req: Req_) {
    return this.chats.listChats(req.user.id);
  }

  @Get(':id/messages')
  messages(
    @Req() req: Req_,
    @Param('id') id: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.chats.getMessages(req.user.id, id, cursor, limit ? Number(limit) : 30);
  }

  @Post(':id/messages')
  send(@Req() req: Req_, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chats.sendMessage(req.user.id, id, dto.body, dto.clientId, dto.replyToId);
  }
}
