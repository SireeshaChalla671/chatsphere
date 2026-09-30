import { Body, Controller, Get, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { UsersService } from './users.service.js';
import { UpdateProfileDto } from './users.dto.js';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('me')
  getMe(@Req() req: { user: { id: string } }) {
    return this.users.getMe(req.user.id);
  }

  @Patch('me')
  updateMe(@Req() req: { user: { id: string } }, @Body() dto: UpdateProfileDto) {
    return this.users.updateMe(req.user.id, dto);
  }

  @Get('search')
  search(@Req() req: { user: { id: string } }, @Query('q') q = '') {
    return this.users.search(q, req.user.id);
  }
}