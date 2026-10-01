import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer from 'nodemailer';

// Delivers one-time codes by email (SMTP) or SMS (Twilio REST). Does nothing when not configured.
@Injectable()
export class MailService {
  private readonly log = new Logger('Mail');
  private transport: ReturnType<typeof nodemailer.createTransport> | null = null;

  constructor(private config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    if (host) {
      const port = Number(config.get<string>('SMTP_PORT') ?? 587);
      const user = config.get<string>('SMTP_USER');
      this.transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: user ? { user, pass: config.get<string>('SMTP_PASS') } : undefined,
      });
    }
  }

  async sendOtp(identifier: string, code: string) {
    try {
      if (identifier.includes('@')) {
        if (!this.transport) return;
        await this.transport.sendMail({
          from: this.config.get<string>('SMTP_FROM') ?? 'ChatSphere <no-reply@example.com>',
          to: identifier,
          subject: 'Your ChatSphere code',
          text: `Your ChatSphere verification code is ${code}. It expires in 5 minutes.`,
        });
      } else {
        await this.sendSms(identifier, code);
      }
    } catch (e) {
      this.log.warn('OTP delivery failed: ' + (e as Error).message);
    }
  }

  private async sendSms(to: string, code: string) {
    const sid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const token = this.config.get<string>('TWILIO_AUTH_TOKEN');
    const from = this.config.get<string>('TWILIO_FROM');
    if (!sid || !token || !from) return;
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ To: to, From: from, Body: `Your ChatSphere code is ${code}. It expires in 5 minutes.` }),
    });
    if (!res.ok) throw new Error('Twilio responded ' + res.status);
  }
}
