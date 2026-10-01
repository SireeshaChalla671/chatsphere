import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';

// Lets several API servers share one Socket.IO room space through Redis.
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor?: unknown;

  connectToRedis(url: string) {
    const pub = new Redis(url);
    const sub = pub.duplicate();
    pub.on('error', () => undefined);
    sub.on('error', () => undefined);
    this.adapterConstructor = createAdapter(pub, sub);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createIOServer(port: number, options?: any): any {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) server.adapter(this.adapterConstructor as never);
    return server;
  }
}
