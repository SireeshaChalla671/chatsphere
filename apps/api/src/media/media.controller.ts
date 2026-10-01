import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FileInterceptor } from '@nestjs/platform-express';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

const UPLOAD_DIR = join(process.cwd(), 'uploads');
const INLINE_OK = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.ogg', '.m4a', '.wav', '.pdf']);

type UploadedFile_ = { buffer: Buffer; originalname: string; mimetype: string; size: number };
type Res_ = {
  sendFile: (name: string, opts: { root: string }) => void;
  setHeader: (k: string, v: string) => void;
  redirect: (status: number, url: string) => void;
};

@Controller('media')
export class MediaController {
  private s3: S3Client | null = null;
  private bucket = '';

  constructor(config: ConfigService) {
    const bucket = config.get<string>('S3_BUCKET');
    const key = config.get<string>('S3_ACCESS_KEY');
    const secret = config.get<string>('S3_SECRET_KEY');
    if (bucket && key && secret) {
      const endpoint = config.get<string>('S3_ENDPOINT');
      this.bucket = bucket;
      this.s3 = new S3Client({
        region: config.get<string>('S3_REGION') ?? 'auto',
        endpoint: endpoint || undefined,
        forcePathStyle: !!endpoint,
        credentials: { accessKeyId: key, secretAccessKey: secret },
      });
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async upload(@UploadedFile() file?: UploadedFile_) {
    if (!file) throw new BadRequestException('No file received');
    const ext = extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const filename = randomUUID() + ext;
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: filename, Body: file.buffer, ContentType: file.mimetype }));
    } else {
      await mkdir(UPLOAD_DIR, { recursive: true });
      await writeFile(join(UPLOAD_DIR, filename), file.buffer);
    }
    const mime = file.mimetype;
    const type = mime.startsWith('image/') ? 'IMAGE' : mime.startsWith('video/') ? 'VIDEO' : mime.startsWith('audio/') ? 'AUDIO' : 'DOCUMENT';
    return { type, url: '/media/' + filename, mime, name: file.originalname, size: file.size };
  }

  @Get(':filename')
  async serve(@Param('filename') filename: string, @Res() res: Res_) {
    if (!/^[a-f0-9-]{36}(\.[a-z0-9]{1,10})?$/i.test(filename)) throw new NotFoundException();
    const inline = INLINE_OK.has(extname(filename).toLowerCase());

    if (this.s3) {
      const url = await getSignedUrl(
        this.s3,
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: filename,
          ...(inline ? {} : { ResponseContentDisposition: 'attachment', ResponseContentType: 'application/octet-stream' }),
        }),
        { expiresIn: 300 },
      );
      return res.redirect(302, url);
    }

    try {
      await stat(join(UPLOAD_DIR, filename));
    } catch {
      throw new NotFoundException();
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    if (!inline) res.setHeader('Content-Disposition', 'attachment');
    res.sendFile(filename, { root: UPLOAD_DIR });
  }
}
