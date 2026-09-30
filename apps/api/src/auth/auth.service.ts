import { HttpException, HttpStatus, Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  private normalize(identifier: string) {
    const v = identifier.trim();
    return v.includes('@') ? v.toLowerCase() : v.replace(/\s+/g, '');
  }

  async sendOtp(rawIdentifier: string) {
    const identifier = this.normalize(rawIdentifier);

    const last = await this.prisma.otpCode.findFirst({
      where: { identifier },
      orderBy: { createdAt: 'desc' },
    });
    if (last && Date.now() - last.createdAt.getTime() < 30_000) {
      throw new HttpException('Wait 30 seconds before requesting another code', HttpStatus.TOO_MANY_REQUESTS);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.otpCode.deleteMany({ where: { identifier } });
    await this.prisma.otpCode.create({
      data: {
        identifier,
        codeHash: await bcrypt.hash(code, 8),
        expiresAt: new Date(Date.now() + 5 * 60_000),
      },
    });

    // DEV ONLY: a real SMS/email provider replaces this later
    console.log(`[DEV OTP] ${identifier} -> ${code}`);
    const isProd = this.config.get('NODE_ENV') === 'production';
    return isProd ? { message: 'OTP sent' } : { message: 'OTP sent (dev mode)', devOtp: code };
  }

  async verifyOtp(rawIdentifier: string, code: string) {
    const identifier = this.normalize(rawIdentifier);
    const otp = await this.prisma.otpCode.findFirst({
      where: { identifier },
      orderBy: { createdAt: 'desc' },
    });
    if (!otp || otp.expiresAt < new Date()) throw new BadRequestException('Code expired or not requested');
    if (otp.attempts >= 5) throw new BadRequestException('Too many attempts, request a new code');

    const ok = await bcrypt.compare(code, otp.codeHash);
    if (!ok) {
      await this.prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      throw new BadRequestException('Invalid code');
    }
    await this.prisma.otpCode.deleteMany({ where: { identifier } });

    const isEmail = identifier.includes('@');
    const where = isEmail ? { email: identifier } : { phone: identifier };
    const existing = await this.prisma.user.findUnique({ where });
    const user = existing ?? (await this.prisma.user.create({ data: where }));

    const tokens = await this.issueTokens(user.id);
    return { user, isNewUser: !existing, ...tokens };
  }

  private async issueTokens(userId: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: 15 * 60 },
    );
    const refreshToken = randomBytes(48).toString('hex');
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: sha256(refreshToken),
        expiresAt: new Date(Date.now() + 30 * 24 * 3600_000),
      },
    });
    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string) {
    const row = await this.prisma.refreshToken.findFirst({
      where: { tokenHash: sha256(refreshToken), revokedAt: null, expiresAt: { gt: new Date() } },
    });
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    return this.issueTokens(row.userId);
  }

  async logout(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: sha256(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { message: 'Logged out' };
  }

  me(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId } });
  }
}