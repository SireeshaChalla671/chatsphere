import { BadRequestException, Controller, Get, NotFoundException, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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
};

@Controller('media')
export class MediaController {
  @UseGuards(JwtAuthGuard)
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 25 * 1024 * 1024 } }))
  async upload(@UploadedFile() file?: UploadedFile_) {
    if (!file) throw new BadRequestException('No file received');
    await mkdir(UPLOAD_DIR, { recursive: true });
    const ext = extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 10);
    const filename = randomUUID() + ext;
    await writeFile(join(UPLOAD_DIR, filename), file.buffer);
    const mime = file.mimetype;
    const type = mime.startsWith('image/') ? 'IMAGE' : mime.startsWith('video/') ? 'VIDEO' : mime.startsWith('audio/') ? 'AUDIO' : 'DOCUMENT';
    return { type, url: '/media/' + filename, mime, name: file.originalname, size: file.size };
  }

  // Public but unguessable (random UUID names), so <img> and <audio> tags work without auth headers.
  @Get(':filename')
  async serve(@Param('filename') filename: string, @Res() res: Res_) {
    if (!/^[a-f0-9-]{36}(\.[a-z0-9]{1,10})?$/i.test(filename)) throw new NotFoundException();
    try {
      await stat(join(UPLOAD_DIR, filename));
    } catch {
      throw new NotFoundException();
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', 'sandbox');
    if (!INLINE_OK.has(extname(filename).toLowerCase())) res.setHeader('Content-Disposition', 'attachment');
    res.sendFile(filename, { root: UPLOAD_DIR });
  }
}
