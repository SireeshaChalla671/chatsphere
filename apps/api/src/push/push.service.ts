import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service.js';

export type PushPayload = { title: string; body: string; url?: string; tag?: string; requireInteraction?: boolean };

@Injectable()
export class PushService {
  private readonly log = new Logger('Push');
  readonly publicKey: string | null;

  constructor(private prisma: PrismaService, config: ConfigService) {
    const pub = config.get<string>('VAPID_PUBLIC_KEY');
    const priv = config.get<string>('VAPID_PRIVATE_KEY');
    if (pub && priv) {
      webpush.setVapidDetails(config.get<string>('VAPID_SUBJECT') ?? 'mailto:admin@example.com', pub, priv);
      this.publicKey = pub;
    } else {
      this.publicKey = null;
      this.log.warn('VAPID keys not set: push notifications are disabled');
    }
  }

  async subscribe(userId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    if (typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string') {
      throw new BadRequestException('Invalid subscription');
    }
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    });
    return { ok: true };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { ok: true };
  }

  async notify(userId: string, payload: PushPayload) {
    if (!this.publicKey) return;
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
            { TTL: 60 },
          );
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await this.prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
          } else {
            this.log.warn('Push failed: ' + (e as Error).message);
          }
        }
      }),
    );
  }
}
