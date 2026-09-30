import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ChatsService } from './chats.service.js';
import { AddMembersDto, CreateDirectDto, CreateGroupDto, SendMessageDto } from './chats.dto.js';

type Req_ = { user: { id: string } };

@UseGuards(JwtAuthGuard)
@Controller('chats')
export class ChatsController {
  constructor(private chats: ChatsService) {}

  @Post('direct')
  direct(@Req() req: Req_, @Body() dto: CreateDirectDto) {
    return this.chats.getOrCreateDirect(req.user.id, dto.userId);
  }

  @Post('group')
  group(@Req() req: Req_, @Body() dto: CreateGroupDto) {
    return this.chats.createGroup(req.user.id, dto.name, dto.identifiers);
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

  @Post(':id/members')
  addMembers(@Req() req: Req_, @Param('id') id: string, @Body() dto: AddMembersDto) {
    return this.chats.addMembers(req.user.id, id, dto.identifiers);
  }

  @Delete(':id/members/:userId')
  removeMember(@Req() req: Req_, @Param('id') id: string, @Param('userId') userId: string) {
    return this.chats.removeMember(req.user.id, id, userId);
  }

  @Post(':id/leave')
  leave(@Req() req: Req_, @Param('id') id: string) {
    return this.chats.leaveGroup(req.user.id, id);
  }
}
