import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';

type Res = { status: (n: number) => { json: (b: unknown) => void } };

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Exceptions');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Res>();
    if (err instanceof HttpException) {
      const body = err.getResponse();
      return res.status(err.getStatus()).json(typeof body === 'string' ? { message: body } : body);
    }
    const code = (err as { code?: string })?.code;
    if (code && (code.startsWith('P100') || code === 'P2024')) {
      this.log.error('Database unavailable: ' + code);
      return res.status(503).json({ message: 'Service temporarily unavailable, please retry' });
    }
    this.log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    return res.status(500).json({ message: 'Internal server error' });
  }
}
