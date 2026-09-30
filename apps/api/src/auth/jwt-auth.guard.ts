import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private config: ConfigService) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Missing token');
    try {
      const payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
      req.user = { id: payload.sub };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}