import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateProfileDto } from './users.dto.js';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getMe(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  updateMe(id: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({ where: { id }, data: dto });
  }

  async search(query: string, currentUserId: string) {
    const q = query.trim();
    if (q.length < 3) return [];
    return this.prisma.user.findMany({
      where: {
        id: { not: currentUserId },
        OR: [
          { email: { equals: q.toLowerCase() } },
          { phone: { equals: q.replace(/\s+/g, '') } },
          { name: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: { id: true, name: true, avatarUrl: true, about: true },
      take: 20,
    });
  }
}