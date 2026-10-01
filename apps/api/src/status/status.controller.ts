import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { StatusService } from './status.service.js';
import { CreateStatusDto } from './status.dto.js';

type Req_ = { user: { id: string } };

@UseGuards(JwtAuthGuard)
@Controller('status')
export class StatusController {
  constructor(private status: StatusService) {}

  @Post()
  create(@Req() req: Req_, @Body() dto: CreateStatusDto) {
    return this.status.create(req.user.id, dto);
  }

  @Get()
  feed(@Req() req: Req_) {
    return this.status.feed(req.user.id);
  }

  @Post(':id/view')
  view(@Req() req: Req_, @Param('id') id: string) {
    return this.status.view(req.user.id, id);
  }

  @Get(':id/viewers')
  viewers(@Req() req: Req_, @Param('id') id: string) {
    return this.status.viewers(req.user.id, id);
  }

  @Delete(':id')
  remove(@Req() req: Req_, @Param('id') id: string) {
    return this.status.remove(req.user.id, id);
  }
}
